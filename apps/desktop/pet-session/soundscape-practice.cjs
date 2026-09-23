// Soundscape view for the session overlay (descriptor kind "soundscape"):
// relaxing sounds. Mixes a scene's layers with Web Audio from files the host
// downloads and caches (openpets-session-media:) — looping beds (crossfaded
// at the loop boundary) plus accents on random or "wave" intervals with
// per-play volume, pan, and pitch variation. Pause suspends the audio clock,
// so pending crossfades keep their place. Offers a master volume, mute, a
// scene picker, and a sleep timer that fades out and completes the run.

const SLEEP_FADE_SECONDS = 8;

const svgIcon = (paths, strokeWidth = 2) => {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="${strokeWidth}" aria-hidden="true">${paths}</svg>`;
};

// lucide:waves, volume-2, volume-x, check, moon, skip-back, skip-forward, play, pause, rotate-ccw
const wavesPaths = '<path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2c2.5 0 2.5-2 5-2c1.3 0 1.9.5 2.5 1M2 12c.6.5 1.2 1 2.5 1c2.5 0 2.5-2 5-2c2.6 0 2.4 2 5 2c2.5 0 2.5-2 5-2c1.3 0 1.9.5 2.5 1M2 18c.6.5 1.2 1 2.5 1c2.5 0 2.5-2 5-2c2.6 0 2.4 2 5 2c2.5 0 2.5-2 5-2c1.3 0 1.9.5 2.5 1"/>';
const volumeOnPaths = '<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298zM16 9a5 5 0 0 1 0 6m3.364 3.364a9 9 0 0 0 0-12.728"/>';
const volumeOffPaths = '<path d="M11 4.702a.7.7 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.7.7 0 0 0 11 19.298zm5.5 9.798l5-5m-5 0l5 5"/>';
const skipBackPaths = '<path d="M17.971 4.285A2 2 0 0 1 21 6v12a2 2 0 0 1-3.029 1.715l-9.997-5.998a2 2 0 0 1-.003-3.432zM3 20V4"/>';
const skipForwardPaths = '<path d="M21 4v16M6.029 4.285A2 2 0 0 0 3 6v12a2 2 0 0 0 3.029 1.715l9.997-5.998a2 2 0 0 0 .003-3.432z"/>';
const playPaths = '<path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"/>';
const pausePaths = '<rect width="5" height="18" x="14" y="3" rx="1"/><rect width="5" height="18" x="5" y="3" rx="1"/>';
const restartPaths = '<path d="M3 12a9 9 0 1 0 9-9a9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>';
const checkPaths = '<path d="M20 6L9 17l-5-5"/>';
const moonPaths = '<path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"/>';

const filledIcon = (paths) => {
  return `<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true">${paths}</svg>`;
};

const el = (tag, className) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  return element;
};

const pick = (range) => {
  if (typeof range === "number") return range;
  if (!range) return 0;
  return range.min + Math.random() * (range.max - range.min);
};

const toStereo = (pan) => (pan - 0.5) * 2;

function createSoundscapePractice(ui) {
  const { widgets } = ui;

  let selectedSceneId = null;
  let timerMinutes = null; // null = no sleep timer
  let elapsedMs = 0;
  let volume = 0.8;
  let muted = false;
  let status = "idle"; // idle | preparing | playing | unavailable | ending
  let preparedCount = 0;
  let loopCount = 0;
  let lastStatusSecond = -1;

  // Mixer state, rebuilt per run.
  let context = null;
  let master = null;
  let generation = 0;
  let timers = new Set();
  const buffers = new Map(); // url -> Promise<AudioBuffer | null>

  const descriptor = () => {
    const current = ui.descriptor();
    return current && current.kind === "soundscape" ? current : null;
  };

  const selectedScene = () => {
    const current = descriptor();
    if (!current) return null;
    return current.scenes.find((scene) => scene.id === selectedSceneId) ?? current.scenes[0];
  };

  // --- Mixer ----------------------------------------------------------------

  const later = (ms, fn) => {
    const handle = setTimeout(() => {
      timers.delete(handle);
      fn();
    }, Math.max(0, ms));
    timers.add(handle);
  };

  const clearTimers = () => {
    for (const handle of timers) clearTimeout(handle);
    timers = new Set();
  };

  const effectiveVolume = () => (muted ? 0 : volume);

  const ensureContext = () => {
    if (context) return context;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    context = new AudioContextClass();
    master = context.createGain();
    master.gain.value = effectiveVolume();
    master.connect(context.destination);
    return context;
  };

  const closeContext = () => {
    clearTimers();
    buffers.clear();
    const closing = context;
    context = null;
    master = null;
    if (closing) void closing.close().catch(() => undefined); // closing a closed context is harmless
  };

  const loadBuffer = (url) => {
    let pending = buffers.get(url);
    if (!pending) {
      pending = (async () => {
        const localUrl = await ui.resolveMedia(url);
        if (!localUrl || !context) return null;
        const response = await fetch(localUrl);
        if (!response.ok) return null;
        const bytes = await response.arrayBuffer();
        if (!context) return null;
        return context.decodeAudioData(bytes);
      })().catch(() => null);
      buffers.set(url, pending);
    }
    return pending;
  };

  /** source → gain → panner → master; returns the nodes. */
  const connectVoice = (buffer, panValue, rate) => {
    const source = context.createBufferSource();
    source.buffer = buffer;
    if (rate) source.playbackRate.value = rate;
    const gain = context.createGain();
    gain.gain.value = 0;
    source.connect(gain);
    let tail = gain;
    if (panValue !== undefined && context.createStereoPanner) {
      const panner = context.createStereoPanner();
      panner.pan.value = toStereo(panValue);
      gain.connect(panner);
      tail = panner;
    }
    tail.connect(master);
    return { source, gain };
  };

  const startLoop = (layer, buffer, runGeneration) => {
    const crossfade = Math.min(layer.crossfade ?? 0, buffer.duration / 3);
    const layerVolume = pick(layer.volume);
    const pan = layer.pan === undefined ? undefined : pick(layer.pan);

    const playInstance = (fadeIn, previous) => {
      if (runGeneration !== generation || !context) return;
      const { source, gain } = connectVoice(buffer, pan);
      const now = context.currentTime;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(layerVolume, now + Math.max(0.05, fadeIn));
      if (crossfade <= 0) {
        source.loop = true;
        source.start(now);
        return;
      }
      source.start(now);
      if (previous) {
        previous.gain.gain.setValueAtTime(previous.gain.gain.value, now);
        previous.gain.gain.linearRampToValueAtTime(0, now + crossfade);
        previous.source.stop(now + crossfade + 0.05);
      }
      // Timers pause with the page, and the audio clock pauses on suspend,
      // so the hand-off stays aligned to this instance's end.
      const startedAt = now;
      const scheduleNext = () => {
        if (runGeneration !== generation || !context) return;
        const remaining = startedAt + buffer.duration - crossfade - context.currentTime;
        if (remaining > 0.25) {
          later(remaining * 1000, scheduleNext);
          return;
        }
        playInstance(crossfade, { source, gain });
      };
      later((buffer.duration - crossfade) * 1000, scheduleNext);
    };
    playInstance(layer.fadeIn ?? 0.5, null);
  };

  const scheduleAccent = (layer, runGeneration, state) => {
    const interval = layer.interval;
    let delay = pick({ min: interval.min, max: interval.max });
    if (interval.type === "wave") {
      delay = state.current;
      const step = (interval.increment ?? 5) * state.direction;
      const next = state.current + step;
      if (next >= interval.max) {
        state.direction = -1;
        state.current = interval.max;
      } else if (next <= interval.min) {
        state.direction = 1;
        state.current = interval.min;
      } else {
        state.current = next;
      }
    }
    const fire = async () => {
      if (runGeneration !== generation || !context) return;
      if (context.state !== "running") {
        // Paused: try again shortly instead of stacking accents on resume.
        later(1000, fire);
        return;
      }
      const file = layer.files[Math.floor(Math.random() * layer.files.length)];
      const buffer = await loadBuffer(file);
      if (buffer && runGeneration === generation && context) {
        const rate = layer.pitch ? pick(layer.pitch) : 1;
        const gainValue = pick(layer.volume);
        const pan = layer.pan === undefined ? undefined : pick(layer.pan);
        const { source, gain } = connectVoice(buffer, pan, rate);
        const now = context.currentTime;
        const naturalLength = buffer.duration / rate;
        const length = Math.min(layer.duration ?? naturalLength, naturalLength);
        const fadeIn = Math.min(layer.fadeIn ?? 0.1, length / 2);
        const fadeOut = Math.min(layer.fadeOut ?? 0.3, length / 2);
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(gainValue, now + Math.max(0.02, fadeIn));
        gain.gain.setValueAtTime(gainValue, now + length - fadeOut);
        gain.gain.linearRampToValueAtTime(0, now + length);
        source.start(now);
        source.stop(now + length + 0.05);
      }
      scheduleAccent(layer, runGeneration, state);
    };
    later(delay * 1000, fire);
  };

  const startScene = async () => {
    const scene = selectedScene();
    if (!scene) return;
    generation += 1;
    const runGeneration = generation;
    closeContext();
    ensureContext();
    const loops = scene.layers.filter((layer) => layer.loop);
    const accents = scene.layers.filter((layer) => !layer.loop);
    loopCount = loops.length;
    preparedCount = 0;
    status = "preparing";
    renderStatus();

    // Beds first; accents load lazily on their first turn.
    let started = 0;
    await Promise.all(loops.map(async (layer) => {
      const buffer = await loadBuffer(layer.files[0]);
      if (runGeneration !== generation) return;
      preparedCount += 1;
      renderStatus();
      if (!buffer) return;
      startLoop(layer, buffer, runGeneration);
      started += 1;
    }));
    if (runGeneration !== generation) return;
    if (started === 0) {
      status = "unavailable";
      renderStatus();
      return;
    }
    status = "playing";
    renderStatus();
    for (const layer of accents) {
      const state = { current: layer.interval?.min ?? 10, direction: 1 };
      scheduleAccent(layer, runGeneration, state);
      for (const file of layer.files) void loadBuffer(file); // prefetch into the host cache
    }
    if (ui.runState() === "paused") void context?.suspend();
  };

  const applyMasterVolume = () => {
    if (!master || !context) return;
    const now = context.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.linearRampToValueAtTime(effectiveVolume(), now + 0.15);
  };

  const beginSleepFade = () => {
    const scene = selectedScene();
    status = "ending";
    renderStatus();
    if (master && context) {
      const now = context.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(master.gain.value, now);
      master.gain.linearRampToValueAtTime(0, now + SLEEP_FADE_SECONDS);
    }
    const runGeneration = generation;
    later(SLEEP_FADE_SECONDS * 1000, () => {
      if (runGeneration !== generation) return;
      generation += 1;
      closeContext();
      status = "idle";
      ui.completeRun({ patternId: scene?.id ?? null, cycles: 1 });
    });
  };

  // --- DOM ------------------------------------------------------------------

  // One row: volume slider and the sleep-timer button.
  const mixRow = el("div", "session-sound-row");
  const volumeIcon = el("span", "session-sound-volume-icon");
  volumeIcon.innerHTML = svgIcon(volumeOnPaths);
  const volumeInput = el("input", "session-sound-volume-input");
  volumeInput.type = "range";
  volumeInput.min = "0";
  volumeInput.max = "100";
  volumeInput.value = String(Math.round(volume * 100));
  volumeInput.addEventListener("input", () => {
    volume = Number(volumeInput.value) / 100;
    if (muted && volume > 0) muted = false;
    applyMasterVolume();
    renderControls();
  });
  const timerButton = el("button", "session-sound-timer-btn");
  timerButton.type = "button";
  timerButton.addEventListener("click", () => {
    const choices = [null, ...(descriptor()?.timerMinutes ?? [])];
    const index = choices.indexOf(timerMinutes);
    timerMinutes = choices[(index + 1) % choices.length];
    renderTimer();
    ui.renderPhaseText();
  });
  mixRow.appendChild(volumeIcon);
  mixRow.appendChild(volumeInput);
  mixRow.appendChild(timerButton);

  const extraControls = el("div", "session-player-controls");
  const makeControl = (paths, position, onClick) => {
    const button = el("button", `session-player-btn is-${position}`);
    button.type = "button";
    button.innerHTML = svgIcon(paths, 2.2);
    button.addEventListener("click", onClick);
    extraControls.appendChild(button);
    return button;
  };

  // --- Scenes -----------------------------------------------------------------

  const selectScene = (sceneId) => {
    if (sceneId === selectedSceneId && ui.runState() !== "complete") return;
    const live = ui.runState() === "active" || ui.runState() === "paused";
    selectedSceneId = sceneId;
    if (ui.runState() === "complete") ui.returnToIdle();
    ui.send({ type: "patternChanged", patternId: sceneId });
    if (live) void startScene();
    ui.renderStatics();
  };

  /** Previous / next step through the scenes, wrapping around. */
  const stepScene = (direction) => {
    const scenes = descriptor()?.scenes ?? [];
    if (scenes.length < 2) return;
    const index = scenes.findIndex((scene) => scene.id === selectedScene()?.id);
    const next = scenes[(index + direction + scenes.length) % scenes.length];
    selectScene(next.id);
  };

  const previousButton = makeControl(skipBackPaths, "prev", () => stepScene(-1));
  const nextButton = makeControl(skipForwardPaths, "next", () => stepScene(1));
  const muteButton = makeControl(volumeOnPaths, "mute", () => {
    muted = !muted;
    applyMasterVolume();
    renderControls();
  });

  // --- Rendering ------------------------------------------------------------

  const remainingMs = () => (timerMinutes === null ? null : Math.max(0, timerMinutes * 60000 - elapsedMs));

  const renderTimer = () => {
    timerButton.innerHTML = `${svgIcon(moonPaths)}<span>${timerMinutes === null ? "∞" : ui.escapeChromeText("minutesShort", { n: timerMinutes })}</span>`;
    timerButton.classList.toggle("is-set", timerMinutes !== null);
    timerButton.setAttribute("aria-label", ui.chromeText("sleepTimer"));
    timerButton.setAttribute("title", `${ui.chromeText("sleepTimer")}: ${timerMinutes === null ? ui.chromeText("noTimer") : ui.chromeText("minutesShort", { n: timerMinutes })}`);
  };

  /** The live status line, shown as the header subtitle during a run. */
  const statusText = () => {
    const runState = ui.runState();
    if (status === "preparing") return ui.chromeText("preparingSounds", { n: preparedCount, total: loopCount });
    if (status === "unavailable") return ui.chromeText("soundsUnavailable");
    if (runState === "paused") return ui.chromeText("paused");
    if (runState === "active") {
      const remaining = remainingMs();
      return remaining === null
        ? ui.chromeText("playingFor", { time: ui.formatClock(elapsedMs / 1000) })
        : ui.chromeText("stopsIn", { time: ui.formatClock(remaining / 1000) });
    }
    return null;
  };

  // The mixer reports progress through the header.
  const renderStatus = () => ui.renderPhaseText();

  const renderControls = () => {
    const multiple = (descriptor()?.scenes.length ?? 0) > 1;
    previousButton.disabled = !multiple;
    nextButton.disabled = !multiple;
    const silent = muted || volume === 0;
    muteButton.innerHTML = svgIcon(silent ? volumeOffPaths : volumeOnPaths, 2.2);
    volumeIcon.innerHTML = svgIcon(silent ? volumeOffPaths : volumeOnPaths);
    const muteKey = muted ? "unmuteAudio" : "muteAudio";
    muteButton.setAttribute("aria-label", ui.chromeText(muteKey));
    muteButton.setAttribute("title", ui.chromeText(muteKey));
    previousButton.setAttribute("aria-label", ui.chromeText("previousPart"));
    nextButton.setAttribute("aria-label", ui.chromeText("nextPart"));
    volumeInput.setAttribute("aria-label", ui.chromeText("volume"));
  };

  const renderCover = () => {
    const scene = selectedScene();
    if (scene?.coverUrl) {
      widgets.topbarIcon.classList.add("has-cover");
      widgets.topbarIcon.innerHTML = "";
      const img = el("img");
      img.alt = "";
      img.src = scene.coverUrl;
      img.addEventListener("error", () => {
        widgets.topbarIcon.classList.remove("has-cover");
        widgets.topbarIcon.innerHTML = svgIcon(wavesPaths);
      });
      widgets.topbarIcon.appendChild(img);
    } else {
      widgets.topbarIcon.classList.remove("has-cover");
      widgets.topbarIcon.innerHTML = svgIcon(wavesPaths);
    }
  };

  return {
    kind: "soundscape",
    topRows: [mixRow],
    extraControls,
    footerActiveKey: "footerListening",
    compact: true,
    hidesSharedRows: true,
    hidesCount: true,

    enter(next) {
      selectedSceneId = next.sceneId;
      timerMinutes = null;
    },

    update(next) {
      if (next.sceneId !== selectedSceneId) selectScene(next.sceneId);
      else ui.renderStatics();
    },

    reset() {
      generation += 1;
      closeContext();
      elapsedMs = 0;
      lastStatusSecond = -1;
      status = "idle";
    },

    canStart() {
      return Boolean(selectedScene());
    },

    eventProgress() {
      return { patternId: selectedScene()?.id ?? null, cycle: 1 };
    },

    onBegin() {
      void startScene();
    },

    onPause() {
      void context?.suspend().catch(() => undefined);
    },

    onResume() {
      void context?.resume().catch(() => undefined);
    },

    onStop() {
      generation += 1;
      closeContext();
      status = "idle";
    },

    /** Only the elapsed clock and the sleep timer move here. */
    advance(deltaMs) {
      if (status === "ending") return null;
      elapsedMs += deltaMs;
      const remaining = remainingMs();
      if (remaining !== null && remaining <= 0) beginSleepFade();
      return null;
    },

    primaryContent(runState) {
      if (runState === "active") return filledIcon(pausePaths);
      if (runState === "complete") return svgIcon(checkPaths, 2.8);
      return filledIcon(playPaths);
    },

    secondaryContent(runState) {
      if (runState === "active" || runState === "paused") return null;
      if (runState === "complete") return svgIcon(restartPaths, 2.2);
      return undefined;
    },

    /** Header: the scene, then its categories or the live mixer status. */
    headerText() {
      const current = descriptor();
      const scene = selectedScene();
      if (!current || !scene) return null;
      const live = statusText();
      const subtitle = live ?? [current.title, scene.subtitle].filter(Boolean).join(" · ");
      return { title: scene.title, subtitle };
    },

    headerMenuItems() {
      const current = selectedScene();
      return (descriptor()?.scenes ?? []).map((scene) => ({
        label: scene.title,
        imageUrl: scene.coverUrl,
        iconSvg: svgIcon(wavesPaths),
        current: scene.id === current?.id,
        select: () => selectScene(scene.id),
      }));
    },

    renderStatics() {
      ui.setPhaseColor([0.45, 0.72, 1.0], "#73b8ff");
      renderCover();
      renderTimer();
      renderControls();
    },

    renderProgressMeta() {},

    renderIdle() {},

    runningPhase() {
      return null;
    },

    renderPhaseDetails() {},

    breathTarget(nowSeconds) {
      const runState = ui.runState();
      if (runState === "active") return 0.3 + 0.1 * Math.sin(nowSeconds * 0.35);
      return 0.22 + 0.05 * Math.sin(nowSeconds * 0.8);
    },

    /** The status shows whole seconds; refresh it when the second changes. */
    renderFrame() {
      if (ui.runState() !== "active") return;
      const second = Math.floor(elapsedMs / 1000);
      if (second === lastStatusSecond) return;
      lastStatusSecond = second;
      renderStatus();
    },

    deactivate() {
      generation += 1;
      closeContext();
      status = "idle";
      widgets.topbarIcon.classList.remove("has-cover");
    },
  };
}

module.exports = { createSoundscapePractice };
