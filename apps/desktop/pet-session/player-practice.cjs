// Media player view for the session overlay (descriptor kind "player"):
// guided meditation and peaceful visualization. Plays a track's narrated
// segments in order with a short gap between them. Audio arrives through the
// host media cache (openpets-session-media:), resolved one segment at a time
// with the next one prefetched. Compact card: the shell header carries the
// cover and track (its menu lists the tracks), then a two-line caption, one
// progress row, and a centred previous / play / next transport. If a segment
// cannot load (offline, first listen), its caption stays up for a reading
// pause and the track moves on, so the practice still works as a guided text.

const TEXT_ONLY_SEGMENT_MS = 9000;

const svgIcon = (paths, strokeWidth = 2) => {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="${strokeWidth}" aria-hidden="true">${paths}</svg>`;
};
const filledIcon = (paths) => {
  return `<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true">${paths}</svg>`;
};

// lucide:headphones, skip-back, skip-forward, volume-2, volume-x, play, pause, check, rotate-ccw
const headphonesPaths = '<path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"/>';
const skipBackPaths = '<path d="M17.971 4.285A2 2 0 0 1 21 6v12a2 2 0 0 1-3.029 1.715l-9.997-5.998a2 2 0 0 1-.003-3.432zM3 20V4"/>';
const skipForwardPaths = '<path d="M21 4v16M6.029 4.285A2 2 0 0 0 3 6v12a2 2 0 0 0 3.029 1.715l9.997-5.998a2 2 0 0 0 .003-3.432z"/>';
const volumeOnPaths = '<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298zM16 9a5 5 0 0 1 0 6m3.364 3.364a9 9 0 0 0 0-12.728"/>';
const volumeOffPaths = '<path d="M11 4.702a.7.7 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.7.7 0 0 0 11 19.298zm5.5 9.798l5-5m-5 0l5 5"/>';
const playPaths = '<path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"/>';
const pausePaths = '<rect width="5" height="18" x="14" y="3" rx="1"/><rect width="5" height="18" x="5" y="3" rx="1"/>';
const checkPaths = '<path d="M20 6L9 17l-5-5"/>';
const restartPaths = '<path d="M3 12a9 9 0 1 0 9-9a9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>';

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

  const caption = el("div", "session-player-caption");
  caption.setAttribute("aria-live", "polite");

  const progress = el("div", "session-player-progress");
  const partLabel = el("span", "session-player-part");
  const bar = el("div", "session-player-bar");
  const barFill = el("div", "session-player-bar-fill");
  bar.appendChild(barFill);
  const timeLabel = el("span", "session-player-time");
  progress.appendChild(partLabel);
  progress.appendChild(bar);
  progress.appendChild(timeLabel);

  const extraControls = el("div", "session-player-controls");
  const makeControl = (paths, labelKey, position, onClick) => {
    const button = el("button", `session-player-btn is-${position}`);
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

  // Previous restarts the current part first, like a music player.
  const previousButton = makeControl(skipBackPaths, "previousPart", "prev", () => {
    if (segmentState === "playing" && audio.currentTime > 3) {
      audio.currentTime = 0;
      return;
    }
    skipTo(segmentIndex - 1);
  });
  const nextButton = makeControl(skipForwardPaths, "nextPart", "next", () => {
    const track = selectedTrack();
    if (!track) return;
    if (segmentIndex >= track.segments.length - 1) {
      if (running()) finishSegment();
      return;
    }
    skipTo(segmentIndex + 1);
  });
  const muteButton = makeControl(volumeOnPaths, "muteAudio", "mute", () => {
    muted = !muted;
    audio.muted = muted;
    renderControls();
  });

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
    let status = "";
    if (segmentState === "text-only") status = ui.chromeText("mediaUnavailable");
    else if (segmentState === "loading") status = ui.chromeText("mediaLoading");
    caption.dataset.status = status;
    const shownPart = runState === "complete" ? track.segments.length : segmentIndex + 1;
    partLabel.textContent = `${shownPart}/${track.segments.length}`;
    partLabel.setAttribute("title", ui.chromeText("partOf", { n: shownPart, total: track.segments.length }));
  };

  const renderControls = () => {
    const runState = ui.runState();
    const live = runState === "active" || runState === "paused";
    previousButton.disabled = !live;
    nextButton.disabled = !live;
    muteButton.innerHTML = svgIcon(muted ? volumeOffPaths : volumeOnPaths, 2.2);
    for (const button of extraControls.children) {
      const key = button === muteButton ? (muted ? "unmuteAudio" : "muteAudio") : button.dataset.labelKey;
      button.setAttribute("aria-label", ui.chromeText(key));
      button.setAttribute("title", ui.chromeText(key));
    }
  };

  /** The header shows the track's cover (the practice icon when there is none). */
  const renderCover = () => {
    const track = selectedTrack();
    if (track?.coverUrl) {
      widgets.topbarIcon.classList.add("has-cover");
      widgets.topbarIcon.innerHTML = "";
      const img = el("img");
      img.alt = "";
      img.src = track.coverUrl;
      img.addEventListener("error", () => {
        widgets.topbarIcon.classList.remove("has-cover");
        widgets.topbarIcon.innerHTML = svgIcon(headphonesPaths);
      });
      widgets.topbarIcon.appendChild(img);
    } else {
      widgets.topbarIcon.classList.remove("has-cover");
      widgets.topbarIcon.innerHTML = svgIcon(headphonesPaths);
    }
  };

  return {
    kind: "player",
    topRows: [caption, progress],
    extraControls,
    footerActiveKey: "footerListening",
    compact: true,
    hidesSharedRows: true,
    hidesCount: true,

    enter(next) {
      selectedTrackId = next.trackId;
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

    /** Round icon-only play/pause for the compact transport. */
    primaryContent(runState) {
      if (runState === "active") return filledIcon(pausePaths);
      if (runState === "complete") return svgIcon(checkPaths, 2.8);
      return filledIcon(playPaths);
    },

    /** No Restart while listening; "Again" becomes an icon once finished. */
    secondaryContent(runState) {
      if (runState === "active" || runState === "paused") return null;
      if (runState === "complete") return svgIcon(restartPaths, 2.2);
      return undefined;
    },

    /** Header: the track, then practice · category (or the run status). */
    headerText(runState) {
      const current = descriptor();
      const track = selectedTrack();
      if (!current || !track) return null;
      let status = [current.title, track.subtitle, current.narrationNote].filter(Boolean).join(" · ");
      if (runState === "countdown") status = ui.chromeText("getReady");
      else if (runState === "paused") status = ui.chromeText("paused");
      else if (runState === "complete") status = ui.chromeText("complete");
      return { title: track.title, subtitle: status };
    },

    headerMenuItems() {
      const current = selectedTrack();
      return (descriptor()?.tracks ?? []).map((track) => ({
        label: track.title,
        imageUrl: track.coverUrl,
        iconSvg: svgIcon(headphonesPaths),
        current: track.id === current?.id,
        select: () => selectTrack(track.id),
      }));
    },

    renderStatics() {
      ui.setPhaseColor([0.55, 0.62, 1.0], "#8c9eff");
      renderCover();
      renderSegment();
      renderControls();
    },

    renderProgressMeta() {
      renderSegment();
      renderControls();
    },

    renderIdle() {},

    runningPhase() {
      return null;
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
      if (timeLabel.textContent !== timeText) timeLabel.textContent = timeText;
    },

    deactivate() {
      generation += 1;
      stopAudio();
      widgets.topbarIcon.classList.remove("has-cover");
    },
  };
}

module.exports = { createPlayerPractice };
