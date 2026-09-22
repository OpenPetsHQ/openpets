// Media player view for the session overlay (descriptor kind "player"):
// guided meditation and peaceful visualization. Plays a track's narrated
// segments in order with a short gap between them. Audio arrives through the
// host media cache (openpets-session-media:), resolved one segment at a time
// with the next one prefetched. The compact card shows the cover, title,
// the current segment's caption, overall progress, and player controls; the
// shared dots/tiles/track rows are hidden. If a segment cannot load (offline,
// first listen), its caption stays up for a reading pause and the track moves
// on, so the practice still works as a guided text.

const TEXT_ONLY_SEGMENT_MS = 9000;

const svgIcon = (paths, strokeWidth = 2) => {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="${strokeWidth}" aria-hidden="true">${paths}</svg>`;
};

// lucide:headphones, rotate-ccw, skip-back, skip-forward, volume-2, volume-x, chevron-down, check
const headphonesPaths = '<path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"/>';
const rewindPaths = '<path d="M3 12a9 9 0 1 0 9-9a9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>';
const skipBackPaths = '<path d="M17.971 4.285A2 2 0 0 1 21 6v12a2 2 0 0 1-3.029 1.715l-9.997-5.998a2 2 0 0 1-.003-3.432zM3 20V4"/>';
const skipForwardPaths = '<path d="M21 4v16M6.029 4.285A2 2 0 0 0 3 6v12a2 2 0 0 0 3.029 1.715l9.997-5.998a2 2 0 0 0 .003-3.432z"/>';
const volumeOnPaths = '<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298zM16 9a5 5 0 0 1 0 6m3.364 3.364a9 9 0 0 0 0-12.728"/>';
const volumeOffPaths = '<path d="M11 4.702a.7.7 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.7.7 0 0 0 11 19.298zm5.5 9.798l5-5m-5 0l5 5"/>';
const chevronDownPaths = '<path d="m6 9l6 6l6-6"/>';
const checkPaths = '<path d="M20 6L9 17l-5-5"/>';

const el = (tag, className) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  return element;
};

function createPlayerPractice(ui) {
  const { widgets } = ui;

  let selectedTrackId = null;
  let segmentIndex = 0;
  let listenedMs = 0;
  let segmentDurations = [];
  let muted = false;
  let generation = 0; // bumps on every reset/track change so stale loads are ignored
  let gapTimer = null;
  let textOnlyTimer = null;
  let segmentState = "idle"; // idle | loading | playing | gap | text-only
  let pendingPlay = false; // resume a segment that was paused while loading
  let trackMenuOpen = false;

  const audio = new Audio();
  audio.preload = "auto";

  const descriptor = () => {
    const current = ui.descriptor();
    return current && current.kind === "player" ? current : null;
  };

  const selectedTrack = () => {
    const current = descriptor();
    if (!current) return null;
    return current.tracks.find((track) => track.id === selectedTrackId) ?? current.tracks[0];
  };

  // --- DOM ------------------------------------------------------------------

  const row = el("div", "session-player");
  const trackButton = el("button", "session-player-track");
  trackButton.type = "button";
  trackButton.setAttribute("aria-haspopup", "menu");
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
  const trackTitle = el("span", "session-player-title");
  const trackChevron = el("span", "session-player-chevron");
  trackChevron.innerHTML = svgIcon(chevronDownPaths, 2.4);
  titleRow.appendChild(trackTitle);
  titleRow.appendChild(trackChevron);
  const trackSubtitle = el("span", "session-player-subtitle");
  texts.appendChild(titleRow);
  texts.appendChild(trackSubtitle);
  trackButton.appendChild(cover);
  trackButton.appendChild(texts);
  row.appendChild(trackButton);

  const caption = el("div", "session-player-caption");
  caption.setAttribute("aria-live", "polite");

  const progress = el("div", "session-player-progress");
  const bar = el("div", "session-player-bar");
  const barFill = el("div", "session-player-bar-fill");
  bar.appendChild(barFill);
  const meta = el("div", "session-player-meta");
  const metaLeft = el("span", "session-player-part");
  const metaRight = el("span", "session-player-time");
  meta.appendChild(metaLeft);
  meta.appendChild(metaRight);
  progress.appendChild(bar);
  progress.appendChild(meta);

  const trackMenu = el("div", "session-track-menu");
  trackMenu.setAttribute("role", "menu");

  const extraControls = el("div", "session-player-controls");
  const makeControl = (paths, labelKey, onClick) => {
    const button = el("button", "session-player-btn");
    button.type = "button";
    button.innerHTML = svgIcon(paths, 2.2);
    button.dataset.labelKey = labelKey;
    button.addEventListener("click", onClick);
    extraControls.appendChild(button);
    return button;
  };

  // --- Playback -------------------------------------------------------------

  const clearTimers = () => {
    if (gapTimer) clearTimeout(gapTimer);
    if (textOnlyTimer) clearTimeout(textOnlyTimer);
    gapTimer = null;
    textOnlyTimer = null;
  };

  const stopAudio = () => {
    clearTimers();
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    segmentState = "idle";
    pendingPlay = false;
  };

  const running = () => ui.runState() === "active";

  const prefetch = (index) => {
    const track = selectedTrack();
    const segment = track?.segments[index];
    if (segment) void ui.resolveMedia(segment.audioUrl);
  };

  const finishSegment = () => {
    const track = selectedTrack();
    if (!track) return;
    const duration = Number.isFinite(audio.duration) ? audio.duration * 1000 : 0;
    if (segmentState === "playing" && duration > 0) {
      segmentDurations[segmentIndex] = duration;
      listenedMs = segmentDurations.slice(0, segmentIndex + 1).reduce((sum, value) => sum + (value || 0), 0);
    }
    if (segmentIndex >= track.segments.length - 1) {
      stopAudio();
      ui.completeRun({ patternId: track.id, cycles: track.segments.length });
      return;
    }
    segmentState = "gap";
    const gapMs = Math.max(0, Number(descriptor()?.segmentGapSeconds ?? 2) * 1000);
    gapTimer = setTimeout(() => {
      gapTimer = null;
      if (running()) playSegment(segmentIndex + 1);
    }, gapMs);
  };

  audio.addEventListener("ended", () => {
    if (segmentState === "playing") finishSegment();
  });

  /** Load and play one segment; stale loads (after a reset or skip) are dropped. */
  const playSegment = async (index) => {
    const track = selectedTrack();
    if (!track || !track.segments[index]) return;
    clearTimers();
    segmentIndex = index;
    segmentState = "loading";
    pendingPlay = true;
    renderSegment();
    const loadGeneration = ++generation;
    const localUrl = await ui.resolveMedia(track.segments[index].audioUrl);
    if (loadGeneration !== generation) return;
    if (!localUrl) {
      // Offline or unavailable: keep the words on screen and move on.
      segmentState = "text-only";
      renderSegment();
      textOnlyTimer = setTimeout(() => {
        textOnlyTimer = null;
        if (running() && loadGeneration === generation) finishSegment();
      }, TEXT_ONLY_SEGMENT_MS);
      return;
    }
    audio.src = localUrl;
    audio.muted = muted;
    audio.currentTime = 0;
    segmentState = "playing";
    renderSegment();
    if (running() && pendingPlay) {
      pendingPlay = false;
      void audio.play().catch(() => undefined);
    }
    prefetch(index + 1);
  };

  const skipTo = (index) => {
    const track = selectedTrack();
    if (!track) return;
    const bounded = Math.max(0, Math.min(track.segments.length - 1, index));
    listenedMs = segmentDurations.slice(0, bounded).reduce((sum, value) => sum + (value || 0), 0);
    audio.pause();
    if (running()) void playSegment(bounded);
    else {
      segmentIndex = bounded;
      segmentState = "idle";
      renderSegment();
    }
  };

  const rewindButton = makeControl(rewindPaths, "rewind", () => {
    if (segmentState === "playing" && audio.currentTime > 1) {
      audio.currentTime = Math.max(0, audio.currentTime - 15);
      return;
    }
    skipTo(segmentIndex - 1);
  });
  const previousButton = makeControl(skipBackPaths, "previousPart", () => {
    if (segmentState === "playing" && audio.currentTime > 3) {
      audio.currentTime = 0;
      return;
    }
    skipTo(segmentIndex - 1);
  });
  const nextButton = makeControl(skipForwardPaths, "nextPart", () => {
    const track = selectedTrack();
    if (!track) return;
    if (segmentIndex >= track.segments.length - 1) {
      if (running()) finishSegment();
      return;
    }
    skipTo(segmentIndex + 1);
  });
  const muteButton = makeControl(volumeOnPaths, "muteAudio", () => {
    muted = !muted;
    audio.muted = muted;
    renderControls();
  });

  // --- Track picker ---------------------------------------------------------

  const canPickTrack = () => (descriptor()?.tracks.length ?? 0) > 1;

  const setTrackMenuOpen = (open) => {
    trackMenuOpen = open && canPickTrack();
    row.classList.toggle("is-menu-open", trackMenuOpen);
    trackButton.setAttribute("aria-expanded", trackMenuOpen ? "true" : "false");
    if (trackMenuOpen) renderTrackMenu();
  };

  const selectTrack = (trackId) => {
    if (trackId === selectedTrackId && ui.runState() !== "complete") return;
    const wasRunning = running() || ui.runState() === "paused";
    selectedTrackId = trackId;
    if (ui.runState() === "complete") ui.returnToIdle();
    ui.resetClock();
    ui.send({ type: "patternChanged", patternId: trackId });
    ui.renderStatics();
    if (wasRunning && running()) void playSegment(0);
  };

  const renderTrackMenu = () => {
    trackMenu.textContent = "";
    const current = selectedTrack();
    for (const track of descriptor()?.tracks ?? []) {
      const option = el("button", "session-track-option");
      option.type = "button";
      option.setAttribute("role", "menuitemradio");
      const isCurrent = track.id === current?.id;
      option.setAttribute("aria-checked", isCurrent ? "true" : "false");
      option.classList.toggle("is-current", isCurrent);
      const thumb = el("span", "session-track-thumb");
      if (track.coverUrl) {
        const img = el("img");
        img.alt = "";
        img.src = track.coverUrl;
        thumb.appendChild(img);
      } else {
        thumb.innerHTML = svgIcon(headphonesPaths);
      }
      const name = el("span", "session-track-name");
      name.textContent = track.title;
      const mark = el("span", "session-track-mark");
      if (isCurrent) mark.innerHTML = svgIcon(checkPaths, 2.6);
      option.appendChild(thumb);
      option.appendChild(name);
      option.appendChild(mark);
      option.addEventListener("click", () => {
        setTrackMenuOpen(false);
        selectTrack(track.id);
      });
      trackMenu.appendChild(option);
    }
  };

  trackButton.addEventListener("click", () => setTrackMenuOpen(!trackMenuOpen));
  document.addEventListener("mousedown", (event) => {
    if (!trackMenuOpen || !(event.target instanceof Element)) return;
    if (trackMenu.contains(event.target) || trackButton.contains(event.target)) return;
    setTrackMenuOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && trackMenuOpen) {
      event.stopImmediatePropagation();
      setTrackMenuOpen(false);
    }
  }, true);
  row.appendChild(trackMenu);

  // --- Rendering ------------------------------------------------------------

  const formatMs = (ms) => ui.formatClock(Math.max(0, ms) / 1000);

  const renderSegment = () => {
    const track = selectedTrack();
    if (!track) return;
    const segment = track.segments[segmentIndex];
    const runState = ui.runState();
    let text = segment?.caption ?? "";
    if (runState === "idle" || runState === "countdown") text = track.segments[0]?.caption ?? "";
    caption.textContent = text;
    caption.classList.toggle("is-loading", segmentState === "loading");
    caption.dataset.status = segmentState === "text-only" ? ui.chromeText("mediaUnavailable") : segmentState === "loading" ? ui.chromeText("mediaLoading") : "";
    metaLeft.textContent = ui.chromeText("partOf", {
      n: runState === "complete" ? track.segments.length : segmentIndex + 1,
      total: track.segments.length,
    });
  };

  const renderControls = () => {
    const runState = ui.runState();
    const live = runState === "active" || runState === "paused";
    for (const button of [rewindButton, previousButton, nextButton]) {
      button.disabled = !live;
    }
    muteButton.innerHTML = svgIcon(muted ? volumeOffPaths : volumeOnPaths, 2.2);
    for (const button of extraControls.children) {
      const key = button === muteButton ? (muted ? "unmuteAudio" : "muteAudio") : button.dataset.labelKey;
      button.setAttribute("aria-label", ui.chromeText(key));
      button.setAttribute("title", ui.chromeText(key));
    }
  };

  const renderTrack = () => {
    const current = descriptor();
    const track = selectedTrack();
    if (!track || !current) return;
    trackTitle.textContent = track.title;
    trackSubtitle.textContent = [track.subtitle, current.narrationNote].filter(Boolean).join(" · ");
    trackChevron.style.display = canPickTrack() ? "" : "none";
    trackButton.classList.toggle("is-pickable", canPickTrack());
    trackButton.setAttribute("aria-label", ui.chromeText("chooseTrack"));
    if (track.coverUrl) {
      cover.classList.remove("is-empty");
      if (coverImg.getAttribute("src") !== track.coverUrl) coverImg.src = track.coverUrl;
    } else {
      coverImg.removeAttribute("src");
      cover.classList.add("is-empty");
      cover.dataset.icon = "headphones";
    }
  };

  return {
    kind: "player",
    topRows: [row, caption, progress],
    extraControls,
    footerActiveKey: "footerListening",
    hidesSharedRows: true,
    hidesCount: true,

    enter(next) {
      selectedTrackId = next.trackId;
      setTrackMenuOpen(false);
    },

    update(next) {
      if (next.trackId !== selectedTrackId) selectTrack(next.trackId);
      else ui.renderStatics();
    },

    reset() {
      generation += 1;
      stopAudio();
      segmentIndex = 0;
      listenedMs = 0;
      segmentDurations = [];
    },

    canStart() {
      return Boolean(selectedTrack());
    },

    eventProgress() {
      return { patternId: selectedTrack()?.id ?? null, cycle: segmentIndex + 1 };
    },

    onBegin() {
      void playSegment(0);
    },

    onPause() {
      if (segmentState === "playing") audio.pause();
      if (segmentState === "loading") pendingPlay = false;
      // A gap or text-only pause picks up where it left off on resume.
      clearTimers();
    },

    onResume() {
      if (segmentState === "playing") void audio.play().catch(() => undefined);
      else if (segmentState === "loading") pendingPlay = true;
      else if (segmentState === "gap" || segmentState === "text-only") finishSegment();
      // Skipped or switched track while paused: start the waiting segment.
      else if (segmentState === "idle") void playSegment(segmentIndex);
    },

    onStop() {
      generation += 1;
      stopAudio();
    },

    advance() {
      return null;
    },

    /** During a run a live segment's own play/pause is the source of truth. */
    secondaryContent(runState) {
      return runState === "active" || runState === "paused" ? null : undefined;
    },

    renderStatics() {
      widgets.topbarIcon.innerHTML = svgIcon(headphonesPaths);
      renderTrack();
      renderSegment();
      renderControls();
    },

    renderProgressMeta() {
      renderSegment();
      renderControls();
    },

    renderIdle() {},

    runningPhase() {
      const current = descriptor();
      const track = selectedTrack();
      if (!current || !track) return null;
      ui.setPhaseColor([0.55, 0.62, 1.0], "#8c9eff");
      return { name: current.title, guidance: track.title };
    },

    renderPhaseDetails() {
      renderSegment();
      renderControls();
    },

    breathTarget(nowSeconds) {
      const runState = ui.runState();
      if (runState === "complete") return 0.3;
      if (runState === "active") return 0.32 + 0.12 * Math.sin(nowSeconds * 0.55);
      return 0.22 + 0.05 * Math.sin(nowSeconds * 0.8);
    },

    /** Per frame: overall progress (by parts) and listened time. */
    renderFrame() {
      const track = selectedTrack();
      if (!track) return;
      const runState = ui.runState();
      const total = track.segments.length;
      let within = 0;
      if (segmentState === "playing" && Number.isFinite(audio.duration) && audio.duration > 0) {
        within = Math.min(1, audio.currentTime / audio.duration);
      } else if (segmentState === "gap" || segmentState === "text-only") {
        within = 1;
      }
      let fraction = (segmentIndex + within) / total;
      if (runState === "complete") fraction = 1;
      else if (runState === "idle" || runState === "countdown") fraction = 0;
      barFill.style.width = `${Math.min(100, Math.max(0, fraction * 100))}%`;

      const currentMs = segmentState === "playing" ? audio.currentTime * 1000 : 0;
      const timeText = formatMs(listenedMs + currentMs);
      if (metaRight.textContent !== timeText) metaRight.textContent = timeText;
    },

    deactivate() {
      generation += 1;
      stopAudio();
      setTrackMenuOpen(false);
    },
  };
}

module.exports = { createPlayerPractice };
