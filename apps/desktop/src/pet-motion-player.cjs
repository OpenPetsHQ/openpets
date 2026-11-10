const { motionMaxClipBytes } = require('@open-pets/pet-format/motion');
const encodedCacheBudget = 48 * 1024 * 1024;

/** Decodes one clip at a time, keeping the last presented canvas across replacements. */
function createPetMotionPlayer({ document, loadBytes, createDecoder, now, setTimeout, clearTimeout, onError, onWillPresent, onPresented }) {
  let current = null;
  let canvas = null;
  let context = null;
  let canvasGeometry = null;
  let canvasPresentationId = null;
  let paused = false;
  let disposed = false;
  const encoded = new Map();
  let encodedBytes = 0;

  function stop() {
    if (!current) return;
    clearTimeout(current.timer);
    current.frame?.close();
    current.decoder?.close();
    current = null;
  }

  async function bytesFor(url) {
    if (encoded.has(url)) {
      const bytes = encoded.get(url);
      encoded.delete(url);
      encoded.set(url, bytes);
      return bytes;
    }
    const bytes = await loadBytes(url);
    if (!(bytes instanceof Uint8Array) || !bytes.byteLength || bytes.byteLength > motionMaxClipBytes) {
      throw new Error('Motion clip bytes are unavailable or oversized.');
    }
    if (disposed || bytes.byteLength > encodedCacheBudget) return bytes;
    while (encodedBytes + bytes.byteLength > encodedCacheBudget && encoded.size) {
      const oldest = encoded.keys().next().value;
      encodedBytes -= encoded.get(oldest).byteLength;
      encoded.delete(oldest);
    }
    encoded.set(url, bytes);
    encodedBytes += bytes.byteLength;
    return bytes;
  }

  function mount() {
    const base = document.querySelector('.pet-shell .sprite[data-motion-body]');
    if (!base || !canvas || !canvasGeometry) return;
    const { width, height, pixelsPerUnit } = canvasGeometry;
    canvas.style.cssText = `position:absolute;left:0;top:0;width:${width / pixelsPerUnit}px;height:${height / pixelsPerUnit}px;pointer-events:none;`;
    if (canvas.parentNode !== base) base.appendChild(canvas);
    base.style.backgroundImage = 'none';
    base.style.animation = 'none';
  }

  function schedule(playback, callback) {
    clearTimeout(playback.timer);
    playback.callback = callback;
    if (!paused && current === playback) {
      playback.timer = setTimeout(callback, Math.max(0, playback.due - now()));
    }
  }

  async function prepare(playback) {
    try {
      const result = await playback.decoder.decode({ frameIndex: playback.index, completeFramesOnly: true });
      if (disposed || current !== playback) {
        result.image.close();
        return;
      }
      const geometry = playback.appearance.assets.metadata.geometry;
      if (result.image.displayWidth !== geometry.width || result.image.displayHeight !== geometry.height) {
        result.image.close();
        throw new Error('Motion frame dimensions changed.');
      }
      playback.frame = result.image;
      if (playback.still || (paused && !playback.started)) present(playback);
      else schedule(playback, () => present(playback));
    } catch (error) {
      fail(playback, error);
    }
  }

  function fail(playback, error) {
    if (disposed || current !== playback) return;
    stop();
    onError?.({ message: String(error?.message ?? error), clipId: playback.clipId });
    playback.onFailed(error);
  }

  function present(playback) {
    if ((paused && playback.started) || current !== playback || !playback.frame) return;
    const geometry = playback.appearance.assets.metadata.geometry;
    const frame = playback.frame;
    playback.frame = null;
    try {
      const appearance = playback.appearance;
      // Replacement pixels must exist before the stage and its geometry are committed.
      if (!canvas || canvasPresentationId !== appearance.presentationId || canvasGeometry !== geometry) {
        const replacement = document.createElement('canvas');
        replacement.className = 'motion-pet-canvas';
        replacement.width = geometry.width;
        replacement.height = geometry.height;
        const replacementContext = replacement.getContext('2d', { willReadFrequently: true });
        if (!replacementContext) throw new Error('Motion canvas is unavailable.');
        replacementContext.drawImage(frame, 0, 0);
        if (onWillPresent && !onWillPresent(appearance)) {
          frame.close();
          fail(playback, new Error('Motion presentation is no longer current.'));
          return;
        }
        if (!document.querySelector('.pet-shell .sprite[data-motion-body]')) throw new Error('Motion body mount is unavailable.');
        canvas?.remove();
        canvas = replacement;
        context = replacementContext;
        canvasGeometry = geometry;
        canvasPresentationId = appearance.presentationId;
      } else {
        if (onWillPresent && !onWillPresent(appearance)) {
          frame.close();
          fail(playback, new Error('Motion presentation is no longer current.'));
          return;
        }
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(frame, 0, 0);
      }
      frame.close();
      mount();
      onPresented?.(appearance);
      if (!playback.started) {
        playback.started = true;
        playback.onStarted();
        if (current !== playback) return;
      }
      if (playback.still) {
        playback.decoder.close();
        playback.decoder = null;
        return;
      }
      const duration = playback.verified.frameDurationsMs[playback.index] / (playback.clip.playbackRate ?? 1);
      playback.due = Math.max(playback.due, now()) + duration;
      if (paused) playback.remaining = duration;
      playback.index += 1;
      if (playback.index === playback.clip.frames) {
        schedule(playback, () => {
          if (current !== playback) return;
          playback.onEnd();
        });
      } else {
        void prepare(playback);
      }
    } catch (error) {
      frame.close();
      fail(playback, error);
    }
  }

  async function play(appearance, clipId, callbacks) {
    stop();
    if (disposed) return;
    const descriptor = appearance.assets;
    const clip = descriptor.metadata.clips[clipId];
    const verified = descriptor.verifiedClips[clipId];
    const playback = { appearance, clipId, clip, verified, ...callbacks, index: 0, due: now(), timer: null, decoder: null, frame: null, started: false };
    current = playback;
    try {
      if (!clip || !verified || !descriptor.urls[clipId]) throw new Error('Motion clip is unavailable.');
      const bytes = await bytesFor(descriptor.urls[clipId]);
      if (current !== playback || disposed) return;
      playback.decoder = createDecoder({ data: bytes, type: 'image/webp', preferAnimation: true });
      await playback.decoder.tracks.ready;
      if (current !== playback || disposed) return;
      if (playback.decoder.tracks.selectedTrack?.frameCount !== clip.frames) throw new Error('Motion clip frame count changed.');
      playback.due = now();
      await prepare(playback);
    } catch (error) {
      fail(playback, error);
    }
  }

  function setPaused(value) {
    if (paused === value) return;
    paused = value;
    if (!current) return;
    if (paused) {
      current.remaining = Math.max(0, current.due - now());
      clearTimeout(current.timer);
    } else if (current.callback) {
      current.due = now() + (current.remaining ?? 0);
      schedule(current, current.callback);
    }
  }

  function remaining() {
    if (!current?.verified) return Infinity;
    const rate = current.clip.playbackRate ?? 1;
    return Math.max(0, current.due - now()) + current.verified.frameDurationsMs.slice(current.index).reduce((a, b) => a + b, 0) / rate;
  }

  function hitTest(x, y) {
    if (!canvas || !context || !canvas.isConnected) return null;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    let nx = (x - rect.left) / rect.width;
    const ny = (y - rect.top) / rect.height;
    if (nx < 0 || nx >= 1 || ny < 0 || ny >= 1) return false;
    if (document.documentElement.dataset.flipX === 'true') nx = 1 - nx;
    const px = Math.min(canvas.width - 1, Math.floor(nx * canvas.width));
    const py = Math.min(canvas.height - 1, Math.floor(ny * canvas.height));
    const data = context.getImageData(Math.max(0, px - 1), Math.max(0, py - 1), Math.min(3, canvas.width - Math.max(0, px - 1)), Math.min(3, canvas.height - Math.max(0, py - 1))).data;
    for (let i = 3; i < data.length; i += 4) if (data[i] >= 64) return true;
    return false;
  }

  function dispose() {
    disposed = true;
    stop();
    canvas?.remove();
    canvas = null;
    context = null;
    canvasGeometry = null;
    canvasPresentationId = null;
    encoded.clear();
    encodedBytes = 0;
  }
  function clear() {
    stop();
    canvas?.remove();
    canvas = null;
    context = null;
    canvasGeometry = null;
    canvasPresentationId = null;
  }
  return { play, stop, clear, setPaused, remaining, mount, hitTest, dispose };
}
module.exports = { createPetMotionPlayer };
