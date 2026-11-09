/** Owns one animated WebP decoder and at most one prefetched VideoFrame. */
function createPetMotionPlayer(options) {
  const {
    document,
    loadBytes,
    createDecoder,
    now,
    setTimeout,
    clearTimeout,
    onError,
  } = options;
  let configuration = null;
  let canvas = null;
  let context = null;
  let playback = null;
  let requestedState = "idle";
  let pendingOnce = null;
  let completedState = null;
  let paused = false;
  let suspended = false;
  let disposed = false;
  let generation = 0;
  const encoded = new Map();
  let encodedBytes = 0;

  const closePlayback = () => {
    generation += 1;
    if (!playback) {
      return;
    }
    clearTimeout(playback.timer);
    playback.nextFrame?.close();
    playback.nextFrame = null;
    playback.decoder?.close();
    playback = null;
  };

  const readState = () => {
    const root = document.documentElement.dataset;
    if (root.motionState === "run-left" || root.motionState === "run-right") {
      const right = root.motionState === "run-right";
      return right !== (root.flipX === "true")
        ? "running-right"
        : "running-left";
    }
    return configuration?.pack.animations[root.reactionState]
      ? root.reactionState
      : "idle";
  };

  const targetState = () => {
    if (pendingOnce) {
      return pendingOnce;
    }
    return completedState === requestedState ? "idle" : requestedState;
  };

  const fail = (error, token) => {
    if (disposed || token !== generation) {
      return;
    }
    const state = playback?.state;
    closePlayback();
    canvas?.remove();
    canvas = null;
    context = null;
    const base = document.querySelector(".sprite[data-motion-preview]");
    if (base) {
      base.style.backgroundImage = "";
      base.style.animation = "";
    }
    document.documentElement.dataset.motionPreviewError = String(
      error?.message ?? error,
    );
    onError({ state, message: String(error?.message ?? error) });
  };

  const bytesFor = async (url) => {
    if (encoded.has(url)) {
      const data = encoded.get(url);
      encoded.delete(url);
      encoded.set(url, data);
      return data;
    }
    const data = await loadBytes(url);
    if (
      !(data instanceof Uint8Array) ||
      data.byteLength === 0 ||
      data.byteLength > 32 * 1024 * 1024
    ) {
      throw new Error("Motion clip bytes are unavailable or oversized.");
    }
    if (disposed) {
      return data;
    }
    while (encodedBytes + data.byteLength > 48 * 1024 * 1024 && encoded.size) {
      const oldest = encoded.keys().next().value;
      encodedBytes -= encoded.get(oldest).byteLength;
      encoded.delete(oldest);
    }
    encoded.set(url, data);
    encodedBytes += data.byteLength;
    return data;
  };

  const mount = () => {
    const base = document.querySelector(".sprite[data-motion-preview]");
    if (!base || !configuration || !canvas) {
      return;
    }
    const { width, height, anchor, pixelsPerUnit } = configuration.pack;
    canvas.style.cssText = `position:absolute;width:${width / pixelsPerUnit}px;height:${height / pixelsPerUnit}px;left:${96 - anchor.x / pixelsPerUnit}px;top:${201 - anchor.y / pixelsPerUnit}px;`;
    base.style.backgroundImage = "none";
    base.style.animation = "none";
    if (canvas.parentNode !== base) {
      base.appendChild(canvas);
    }
  };

  const schedule = (current, callback) => {
    clearTimeout(current.timer);
    current.resume = callback;
    if (paused || suspended || playback !== current) {
      return;
    }
    current.timer = setTimeout(callback, Math.max(0, current.due - now()));
  };

  const boundary = (current) => {
    if (playback !== current || paused || suspended) {
      return;
    }
    const animation = configuration.pack.animations[current.state];
    const target = targetState();
    if (current.phase === "enter") {
      void begin(current.state, "clip");
    } else if (current.phase === "exit") {
      void begin(target, "enter");
    } else if (animation.play === "once") {
      if (requestedState === current.state) {
        completedState = current.state;
      }
      void begin(targetState(), "enter");
    } else if (target !== current.state) {
      if (animation.exit) {
        void begin(current.state, "exit");
      } else {
        void begin(target, "enter");
      }
    } else {
      // Reuse the current decoder for a loop. Native durations remain authoritative.
      current.index = 0;
      void prepareFrame(current);
    }
  };

  const present = (current) => {
    if (playback !== current || paused || suspended || !current.nextFrame) {
      return;
    }
    const frame = current.nextFrame;
    current.nextFrame = null;
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.className = "motion-pet-canvas";
      canvas.width = configuration.pack.width;
      canvas.height = configuration.pack.height;
      context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) {
        frame.close();
        fail(new Error("Motion canvas is unavailable."), current.token);
        return;
      }
    }
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(frame, 0, 0);
    const duration = frame.duration / 1000;
    frame.close();
    if (!Number.isFinite(duration) || duration < 16 || duration > 1000) {
      fail(new Error("Motion frame has invalid timing."), current.token);
      return;
    }
    mount();
    const root = document.documentElement.dataset;
    root.motionPreviewState = current.state;
    root.motionPreviewPhase = current.phase;
    current.due = Math.max(current.due, now()) + duration;
    current.index += 1;
    if (current.index >= current.clip.frames) {
      schedule(current, () => boundary(current));
    } else {
      void prepareFrame(current);
    }
  };

  const prepareFrame = async (current) => {
    try {
      const result = await current.decoder.decode({
        frameIndex: current.index,
        completeFramesOnly: true,
      });
      if (playback !== current || disposed) {
        result.image.close();
        return;
      }
      if (
        result.image.displayWidth !== configuration.pack.width ||
        result.image.displayHeight !== configuration.pack.height
      ) {
        result.image.close();
        throw new Error("Motion frame dimensions changed.");
      }
      current.nextFrame = result.image;
      schedule(current, () => present(current));
    } catch (error) {
      fail(error, current.token);
    }
  };

  const begin = async (state, phase) => {
    if (!configuration || disposed || suspended) {
      return;
    }
    closePlayback();
    const animation = configuration.pack.animations[state];
    if (state === pendingOnce) {
      pendingOnce = null;
    }
    if (phase === "enter" && !animation.enter) {
      phase = "clip";
    }
    const clip = animation[phase];
    const current = {
      state,
      phase,
      clip,
      token: generation,
      decoder: null,
      nextFrame: null,
      index: 0,
      timer: null,
      due: now(),
      resume: null,
    };
    playback = current;
    try {
      const data = await bytesFor(configuration.urls[clip.file]);
      if (playback !== current || disposed) {
        return;
      }
      current.decoder = createDecoder({
        data,
        type: "image/webp",
        preferAnimation: true,
      });
      await current.decoder.tracks.ready;
      if (playback !== current || disposed) {
        return;
      }
      if (current.decoder.tracks.selectedTrack?.frameCount !== clip.frames) {
        throw new Error("Motion clip frame count does not match its manifest.");
      }
      current.due = now();
      await prepareFrame(current);
    } catch (error) {
      fail(error, current.token);
    }
  };

  const refresh = () => {
    if (disposed) {
      return;
    }
    const base = document.querySelector(".sprite[data-motion-preview]");
    if (!base) {
      closePlayback();
      canvas?.remove();
      canvas = null;
      context = null;
      configuration = null;
      requestedState = "idle";
      completedState = null;
      pendingOnce = null;
      delete document.documentElement.dataset.motionPreviewError;
      return;
    }
    if (!configuration) {
      try {
        const json = base.dataset.motionPreview;
        if (typeof json !== "string" || json.length > 32 * 1024) {
          throw new Error("Invalid motion preview configuration.");
        }
        configuration = JSON.parse(json);
      } catch (error) {
        fail(error, generation);
        return;
      }
    }
    const nextState = readState();
    if (nextState !== requestedState) {
      completedState = null;
      // A short host reaction may expire before the current loop reaches its
      // neutral boundary. Keep the latest one-shot until it actually starts.
      if (configuration.pack.animations[nextState].play === "once") {
        pendingOnce = nextState;
      }
    }
    requestedState = nextState;
    document.documentElement.dataset.motionPreviewRequested = nextState;
    const nextPaused = document.documentElement.dataset.paused === "true";
    const wasPaused = paused;
    paused = nextPaused;
    const nextSuspended = Boolean(
      document.querySelector(
        ".plugin-sprite-override, .native-activity-sprite",
      ),
    );
    if (nextSuspended !== suspended) {
      suspended = nextSuspended;
      if (suspended) {
        closePlayback();
      }
    }
    mount();
    if (paused && playback) {
      clearTimeout(playback.timer);
    }
    if (
      !suspended &&
      !playback &&
      !document.documentElement.dataset.motionPreviewError
    ) {
      void begin(targetState(), "enter");
    } else if (wasPaused && !paused && playback) {
      // Resume from the displayed frame, without skipping ahead over the pause.
      playback.due = now();
      if (playback.resume) {
        schedule(playback, playback.resume);
      }
    }
  };

  const hitTest = (clientX, clientY) => {
    if (!canvas || !context || suspended || !canvas.isConnected) {
      return null;
    }
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }
    let x = (clientX - rect.left) / rect.width;
    const y = (clientY - rect.top) / rect.height;
    if (x < 0 || x >= 1 || y < 0 || y >= 1) {
      return false;
    }
    if (document.documentElement.dataset.flipX === "true") {
      x = 1 - x;
    }
    const px = Math.min(canvas.width - 1, Math.floor(x * canvas.width));
    const py = Math.min(canvas.height - 1, Math.floor(y * canvas.height));
    const pixels = context.getImageData(px - 1, py - 1, 3, 3).data;
    for (let i = 3; i < pixels.length; i += 4) {
      if (pixels[i] >= 64) {
        return true;
      }
    }
    return false;
  };

  const dispose = () => {
    disposed = true;
    closePlayback();
    canvas?.remove();
    canvas = null;
    context = null;
    encoded.clear();
    encodedBytes = 0;
  };

  return { refresh, hitTest, dispose };
}

module.exports = { createPetMotionPlayer };
