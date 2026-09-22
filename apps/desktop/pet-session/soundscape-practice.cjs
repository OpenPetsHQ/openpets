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

// lucide:waves, volume-2, volume-x, chevron-down, check, moon
const wavesPaths = '<path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2c2.5 0 2.5-2 5-2c1.3 0 1.9.5 2.5 1M2 12c.6.5 1.2 1 2.5 1c2.5 0 2.5-2 5-2c2.6 0 2.4 2 5 2c2.5 0 2.5-2 5-2c1.3 0 1.9.5 2.5 1M2 18c.6.5 1.2 1 2.5 1c2.5 0 2.5-2 5-2c2.6 0 2.4 2 5 2c2.5 0 2.5-2 5-2c1.3 0 1.9.5 2.5 1"/>';
const volumeOnPaths = '<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298zM16 9a5 5 0 0 1 0 6m3.364 3.364a9 9 0 0 0 0-12.728"/>';
const volumeOffPaths = '<path d="M11 4.702a.7.7 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.7.7 0 0 0 11 19.298zm5.5 9.798l5-5m-5 0l5 5"/>';
const chevronDownPaths = '<path d="m6 9l6 6l6-6"/>';
const checkPaths = '<path d="M20 6L9 17l-5-5"/>';
const moonPaths = '<path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"/>';

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
  let sceneMenuOpen = false;
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

  const row = el("div", "session-player");
  const sceneButton = el("button", "session-player-track");
  sceneButton.type = "button";
  sceneButton.setAttribute("aria-haspopup", "menu");
  const cover = el("span", "session-player-cover");
  const coverImg = el("img", "session-player-cover-img");
  coverImg.alt = "";
  coverImg.addEventListener("error", () => {
    coverImg.removeAttribute("src");
    cover.classList.add("is-empty");
  });
  cover.appendChild(coverImg);
  const texts = el("span", "session-player-texts");
  const titleRow = el("span", "session-player-title-row");
  const sceneTitle = el("span", "session-player-title");
  const sceneChevron = el("span", "session-player-chevron");
  sceneChevron.innerHTML = svgIcon(chevronDownPaths, 2.4);
  titleRow.appendChild(sceneTitle);
  titleRow.appendChild(sceneChevron);
  const sceneSubtitle = el("span", "session-player-subtitle");
  texts.appendChild(titleRow);
  texts.appendChild(sceneSubtitle);
  sceneButton.appendChild(cover);
  sceneButton.appendChild(texts);
  row.appendChild(sceneButton);
  const sceneMenu = el("div", "session-track-menu");
  sceneMenu.setAttribute("role", "menu");
  row.appendChild(sceneMenu);

  const statusLine = el("div", "session-sound-status");

  const timerRow = el("div", "session-sound-timer");
  const timerIcon = el("span", "session-sound-timer-icon");
  timerIcon.innerHTML = svgIcon(moonPaths);
  const timerChips = el("div", "session-sound-timer-chips");
  timerRow.appendChild(timerIcon);
  timerRow.appendChild(timerChips);

  const volumeRow = el("label", "session-sound-volume");
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
  volumeRow.appendChild(volumeIcon);
  volumeRow.appendChild(volumeInput);

  const extraControls = el("div", "session-player-controls");
  const muteButton = el("button", "session-player-btn");
  muteButton.type = "button";
  muteButton.addEventListener("click", () => {
    muted = !muted;
    applyMasterVolume();
    renderControls();
  });
  extraControls.appendChild(muteButton);

  // --- Scene picker -----------------------------------------------------------

  const canPickScene = () => (descriptor()?.scenes.length ?? 0) > 1;

  const setSceneMenuOpen = (open) => {
    sceneMenuOpen = open && canPickScene();
    row.classList.toggle("is-menu-open", sceneMenuOpen);
    sceneButton.setAttribute("aria-expanded", sceneMenuOpen ? "true" : "false");
    if (sceneMenuOpen) renderSceneMenu();
  };

  const selectScene = (sceneId) => {
    if (sceneId === selectedSceneId && ui.runState() !== "complete") return;
    const live = ui.runState() === "active" || ui.runState() === "paused";
    selectedSceneId = sceneId;
    if (ui.runState() === "complete") ui.returnToIdle();
    ui.send({ type: "patternChanged", patternId: sceneId });
    if (live) void startScene();
    ui.renderStatics();
  };

  const renderSceneMenu = () => {
    sceneMenu.textContent = "";
    const current = selectedScene();
    for (const scene of descriptor()?.scenes ?? []) {
      const option = el("button", "session-track-option");
      option.type = "button";
      option.setAttribute("role", "menuitemradio");
      const isCurrent = scene.id === current?.id;
      option.setAttribute("aria-checked", isCurrent ? "true" : "false");
      option.classList.toggle("is-current", isCurrent);
      const thumb = el("span", "session-track-thumb");
      if (scene.coverUrl) {
        const img = el("img");
        img.alt = "";
        img.src = scene.coverUrl;
        thumb.appendChild(img);
      } else {
        thumb.innerHTML = svgIcon(wavesPaths);
      }
      const name = el("span", "session-track-name");
      name.textContent = scene.title;
      const mark = el("span", "session-track-mark");
      if (isCurrent) mark.innerHTML = svgIcon(checkPaths, 2.6);
      option.appendChild(thumb);
      option.appendChild(name);
      option.appendChild(mark);
      option.addEventListener("click", () => {
        setSceneMenuOpen(false);
        selectScene(scene.id);
      });
      sceneMenu.appendChild(option);
    }
  };

  sceneButton.addEventListener("click", () => setSceneMenuOpen(!sceneMenuOpen));
  document.addEventListener("mousedown", (event) => {
    if (!sceneMenuOpen || !(event.target instanceof Element)) return;
    if (sceneMenu.contains(event.target) || sceneButton.contains(event.target)) return;
    setSceneMenuOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && sceneMenuOpen) {
      event.stopImmediatePropagation();
      setSceneMenuOpen(false);
    }
  }, true);

  // --- Rendering ------------------------------------------------------------

  const renderTimerChips = () => {
    const choices = [null, ...(descriptor()?.timerMinutes ?? [])];
    timerChips.textContent = "";
    for (const minutes of choices) {
      const chip = el("button", "session-sound-chip");
      chip.type = "button";
      chip.textContent = minutes === null ? ui.chromeText("noTimer") : ui.chromeText("minutesShort", { n: minutes });
      const selected = minutes === timerMinutes;
      chip.classList.toggle("is-selected", selected);
      chip.setAttribute("aria-pressed", selected ? "true" : "false");
      chip.addEventListener("click", () => {
        timerMinutes = minutes;
        renderTimerChips();
        renderStatus();
      });
      timerChips.appendChild(chip);
    }
    timerRow.setAttribute("aria-label", ui.chromeText("sleepTimer"));
    timerIcon.setAttribute("title", ui.chromeText("sleepTimer"));
  };

  const remainingMs = () => (timerMinutes === null ? null : Math.max(0, timerMinutes * 60000 - elapsedMs));

  const renderStatus = () => {
    const runState = ui.runState();
    let text = "";
    if (status === "preparing") text = ui.chromeText("preparingSounds", { n: preparedCount, total: loopCount });
    else if (status === "unavailable") text = ui.chromeText("soundsUnavailable");
    else if (runState === "active" || runState === "paused") {
      const remaining = remainingMs();
      text = remaining === null
        ? ui.chromeText("playingFor", { time: ui.formatClock(elapsedMs / 1000) })
        : ui.chromeText("stopsIn", { time: ui.formatClock(remaining / 1000) });
    }
    statusLine.textContent = text;
    statusLine.classList.toggle("is-warning", status === "unavailable");
  };

  const renderControls = () => {
    muteButton.innerHTML = svgIcon(muted || volume === 0 ? volumeOffPaths : volumeOnPaths, 2.2);
    const key = muted ? "unmuteAudio" : "muteAudio";
    muteButton.setAttribute("aria-label", ui.chromeText(key));
    muteButton.setAttribute("title", ui.chromeText(key));
    volumeInput.setAttribute("aria-label", ui.chromeText("volume"));
    volumeIcon.innerHTML = svgIcon(muted || volume === 0 ? volumeOffPaths : volumeOnPaths);
  };

  const renderScene = () => {
    const scene = selectedScene();
    if (!scene) return;
    sceneTitle.textContent = scene.title;
    sceneSubtitle.textContent = scene.subtitle ?? "";
    sceneChevron.style.display = canPickScene() ? "" : "none";
    sceneButton.classList.toggle("is-pickable", canPickScene());
    sceneButton.setAttribute("aria-label", ui.chromeText("chooseTrack"));
    if (scene.coverUrl) {
      cover.classList.remove("is-empty");
      if (coverImg.getAttribute("src") !== scene.coverUrl) coverImg.src = scene.coverUrl;
    } else {
      coverImg.removeAttribute("src");
      cover.classList.add("is-empty");
    }
  };

  return {
    kind: "soundscape",
    topRows: [row, statusLine, timerRow, volumeRow],
    extraControls,
    footerActiveKey: "footerListening",
    hidesSharedRows: true,
    hidesCount: true,

    enter(next) {
      selectedSceneId = next.sceneId;
      timerMinutes = null;
      setSceneMenuOpen(false);
    },

    update(next) {
      if (next.sceneId !== selectedSceneId) selectScene(next.sceneId);
      else ui.renderStatics();
    },

    reset() {
      generation += 1;
      closeContext();
      elapsedMs = 0;
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

    secondaryContent(runState) {
      return runState === "active" || runState === "paused" ? null : undefined;
    },

    renderStatics() {
      widgets.topbarIcon.innerHTML = svgIcon(wavesPaths);
      renderScene();
      renderTimerChips();
      renderStatus();
      renderControls();
    },

    renderProgressMeta() {
      renderStatus();
    },

    renderIdle() {},

    runningPhase() {
      const current = descriptor();
      const scene = selectedScene();
      if (!current || !scene) return null;
      ui.setPhaseColor([0.45, 0.72, 1.0], "#73b8ff");
      return { name: current.title, guidance: scene.title };
    },

    renderPhaseDetails() {
      renderStatus();
    },

    breathTarget(nowSeconds) {
      const runState = ui.runState();
      if (runState === "active") return 0.3 + 0.1 * Math.sin(nowSeconds * 0.35);
      return 0.22 + 0.05 * Math.sin(nowSeconds * 0.8);
    },

    /** The status line shows whole seconds; refresh it when the second changes. */
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
      setSceneMenuOpen(false);
      status = "idle";
    },
  };
}

module.exports = { createSoundscapePractice };
