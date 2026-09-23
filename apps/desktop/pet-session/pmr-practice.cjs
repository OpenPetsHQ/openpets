// Progressive muscle relaxation view for the session overlay (descriptor kind
// "pmr"). Owns the tense/release clock over the muscle-group steps, the pose
// illustration well, the side-by-side tense/release cue lists, the two-segment
// step track, and the orb target (tense gathers the orb, release opens it).

const PMR_TENSE_COLOR = [0.90, 0.64, 0.42];
const PMR_TENSE_CSS = "#e6a36b";
const PMR_RELEASE_COLOR = [0.30, 0.86, 0.78];
const PMR_RELEASE_CSS = "#4fdcc5";

const personIconSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true"><circle cx="12" cy="5" r="1"/><path d="m9 20l3-6l3 6M6 8l6 2l6-2m-6 2v4"/></svg>';

function createPmrPractice(ui) {
  const { widgets } = ui;

  let stepIndex = 0;
  let stepPhase = "tense"; // "tense" | "release"
  let phaseElapsedMs = 0;
  let currentIllustrationUrl = "";
  let illustrationVisible = false;
  let cuesVisible = false;
  let lastRenderedCuesStep = null;

  const steps = () => {
    const descriptor = ui.descriptor();
    return descriptor && descriptor.kind === "pmr" && Array.isArray(descriptor.steps) ? descriptor.steps : [];
  };

  // --- DOM ------------------------------------------------------------------

  // Pose illustration well: fixed height so tense/release swaps do not jump
  // the card. Hidden when the step has no declared pose image.
  const illustrationWell = document.createElement("div");
  illustrationWell.className = "session-illustration";
  const illustrationImg = document.createElement("img");
  illustrationImg.className = "session-illustration-img";
  illustrationImg.alt = "";
  illustrationWell.appendChild(illustrationImg);

  const hideIllustration = () => {
    illustrationWell.style.display = "none";
    if (!illustrationVisible) return;
    illustrationVisible = false;
    currentIllustrationUrl = "";
    illustrationImg.removeAttribute("src");
    ui.scheduleGeometry();
  };

  illustrationImg.addEventListener("error", () => {
    if (illustrationVisible) hideIllustration();
  });

  // Cue row: side-by-side exercise step bullets (tense & release).
  const cuesRow = document.createElement("div");
  cuesRow.className = "session-pmr-cues";

  const makeCueColumn = (phaseClass) => {
    const column = document.createElement("div");
    column.className = `session-cues-col ${phaseClass}`;
    const header = document.createElement("div");
    header.className = "session-cues-header";
    const title = document.createElement("span");
    title.className = "session-cues-title";
    header.appendChild(title);
    const list = document.createElement("ol");
    list.className = "session-cues-list";
    column.appendChild(header);
    column.appendChild(list);
    return { column, title, list };
  };

  const tense = makeCueColumn("is-tense");
  const release = makeCueColumn("is-release");
  cuesRow.appendChild(tense.column);
  cuesRow.appendChild(release.column);

  const hideCues = () => {
    cuesRow.style.display = "none";
    if (!cuesVisible) return;
    cuesVisible = false;
    lastRenderedCuesStep = null;
    ui.scheduleGeometry();
  };

  // --- Clock ----------------------------------------------------------------

  /** The step the card shows: first before the run, last after it. */
  const displayedStep = () => {
    const runState = ui.runState();
    const list = steps();
    if (runState === "idle" || runState === "countdown") return list[0] ?? null;
    if (runState === "complete") return list[Math.max(0, list.length - 1)] ?? null;
    return list[stepIndex] ?? list[0] ?? null;
  };

  const phaseSeconds = (step) => (stepPhase === "tense" ? step.tenseSeconds : step.releaseSeconds);

  const hasCueLists = (step) => Boolean(
    step &&
    Array.isArray(step.tenseCues) &&
    step.tenseCues.length > 0 &&
    Array.isArray(step.releaseCues) &&
    step.releaseCues.length > 0
  );

  const phaseWordFor = (step) => {
    return stepPhase === "tense"
      ? (step.tenseLabel || ui.chromeText("tense"))
      : (step.releaseLabel || ui.chromeText("release"));
  };

  // --- Rendering ------------------------------------------------------------

  const renderIllustration = () => {
    const runState = ui.runState();
    const activeStep = displayedStep();
    let targetUrl = null;
    if (runState === "idle" || runState === "countdown") {
      targetUrl = activeStep?.tenseImageUrl ?? null;
    } else if (runState === "complete") {
      targetUrl = activeStep?.releaseImageUrl ?? activeStep?.tenseImageUrl ?? null;
    } else {
      targetUrl = (stepPhase === "tense" ? activeStep?.tenseImageUrl : activeStep?.releaseImageUrl) ?? null;
    }

    const hasUrl = typeof targetUrl === "string" && targetUrl.trim().length > 0;
    if (!hasUrl) {
      hideIllustration();
      return;
    }

    if (!illustrationVisible) {
      illustrationVisible = true;
      illustrationWell.style.display = "flex";
      ui.scheduleGeometry();
    }

    if (currentIllustrationUrl !== targetUrl) {
      currentIllustrationUrl = targetUrl;
      illustrationImg.src = targetUrl;
      illustrationImg.alt = activeStep?.name ? String(activeStep.name) : "";
    }
  };

  const populateCueList = (listEl, items) => {
    listEl.textContent = "";
    for (let i = 0; i < items.length; i += 1) {
      const item = document.createElement("li");
      item.className = "session-cue-item";
      const badge = document.createElement("span");
      badge.className = "session-cue-badge";
      badge.textContent = String(i + 1);
      const text = document.createElement("span");
      text.className = "session-cue-text";
      text.textContent = String(items[i]);
      item.appendChild(badge);
      item.appendChild(text);
      listEl.appendChild(item);
    }
  };

  const renderCues = () => {
    const runState = ui.runState();
    const activeStep = displayedStep();
    if (!hasCueLists(activeStep)) {
      hideCues();
      return;
    }

    if (!cuesVisible) {
      cuesVisible = true;
      cuesRow.style.display = "grid";
      ui.scheduleGeometry();
    }

    tense.title.textContent = activeStep.tenseLabel || ui.chromeText("tense");
    release.title.textContent = activeStep.releaseLabel || ui.chromeText("release");

    if (lastRenderedCuesStep !== activeStep) {
      lastRenderedCuesStep = activeStep;
      populateCueList(tense.list, activeStep.tenseCues);
      populateCueList(release.list, activeStep.releaseCues);
    }

    const running = runState === "active" || runState === "paused";
    const isTenseActive = running && stepPhase === "tense";
    const isReleaseActive = (running && stepPhase === "release") || runState === "complete";

    tense.column.classList.toggle("is-active", isTenseActive);
    release.column.classList.toggle("is-active", isReleaseActive);
    cuesRow.classList.toggle("has-active", isTenseActive || isReleaseActive);
  };

  const renderStepTrack = () => {
    widgets.steps.textContent = "";
    const list = steps();
    const step = list[stepIndex] ?? list[0];
    if (!step) return;
    ui.appendStepSegment(step.tenseSeconds, `${step.tenseLabel || ui.chromeText("tense")} · ${ui.formatSeconds(step.tenseSeconds)}`);
    ui.appendStepSegment(step.releaseSeconds, `${step.releaseLabel || ui.chromeText("release")} · ${ui.formatSeconds(step.releaseSeconds)}`);
  };

  const updateStepStates = () => {
    const runState = ui.runState();
    const stepElements = widgets.steps.children;
    const running = runState === "active" || runState === "paused";
    const activeIdx = stepPhase === "tense" ? 0 : 1;
    for (let index = 0; index < stepElements.length; index += 1) {
      const step = stepElements[index];
      step.classList.toggle("is-active", running && index === activeIdx);
      step.classList.toggle("is-done", (running && index < activeIdx) || runState === "complete");
    }
  };

  return {
    kind: "pmr",
    topRows: [illustrationWell, cuesRow],
    footerActiveKey: "footerRelaxing",

    enter() {
      lastRenderedCuesStep = null;
    },

    update() {
      ui.renderStatics();
    },

    reset() {
      stepIndex = 0;
      stepPhase = "tense";
      phaseElapsedMs = 0;
    },

    canStart() {
      return steps().length > 0;
    },

    eventProgress() {
      return { patternId: "pmr", cycle: 1 };
    },

    onBegin() {},

    /** Advance the tense/release clock; returns the completion payload when the run ends. */
    advance(deltaMs, nowSeconds) {
      const list = steps();
      phaseElapsedMs += deltaMs;
      let guard = 0;
      while (guard < 32) {
        guard += 1;
        const step = list[stepIndex];
        if (!step) break;
        const phaseMs = phaseSeconds(step) * 1000;
        if (phaseElapsedMs < phaseMs) break;
        phaseElapsedMs -= phaseMs;
        ui.triggerPulse(nowSeconds);
        if (stepPhase === "tense") {
          stepPhase = "release";
        } else {
          stepPhase = "tense";
          stepIndex += 1;
          if (stepIndex >= list.length) {
            phaseElapsedMs = 0;
            return { patternId: "pmr", cycles: 1 };
          }
          renderStepTrack();
          ui.renderProgressMeta();
        }
        ui.renderPhaseText();
      }
      return null;
    },

    renderStatics() {
      widgets.topbarIcon.innerHTML = personIconSvg;
      widgets.lungsTile.style.flex = "1 1 0";
      widgets.lungsIcon.style.display = "none";
      widgets.phaseWord.style.display = "";
      widgets.paceTile.style.display = "none";

      renderStepTrack();
      widgets.dotsBox.style.display = "none";
      widgets.dotsBar.style.display = "";
    },

    renderProgressMeta() {
      const runState = ui.runState();
      const totalSteps = steps().length;
      const { dotsCount } = widgets;
      dotsCount.innerHTML = "";
      if (runState === "idle" || runState === "countdown") {
        dotsCount.textContent = ui.chromeText("groupProgress", { n: 1, total: totalSteps });
        return;
      }
      const displayStep = runState === "complete" ? totalSteps : Math.min(stepIndex + 1, totalSteps);
      const current = document.createElement("span");
      current.className = "count-current";
      current.textContent = String(displayStep);
      dotsCount.appendChild(current);
      dotsCount.appendChild(document.createTextNode(` / ${totalSteps}`));
    },

    renderIdle() {
      widgets.phaseWord.textContent = ui.chromeText("tense");
    },

    /** Step name + cue for the header during a run; also sets the phase color. */
    runningPhase() {
      const list = steps();
      const step = list[stepIndex] ?? list[0];
      if (!step) return null;
      const phaseWordText = phaseWordFor(step);
      const cue = stepPhase === "tense" ? (step.tenseCue || step.tenseLabel) : (step.releaseCue || step.releaseLabel);
      if (stepPhase === "tense") {
        ui.setPhaseColor(PMR_TENSE_COLOR, PMR_TENSE_CSS);
      } else {
        ui.setPhaseColor(PMR_RELEASE_COLOR, PMR_RELEASE_CSS);
      }
      widgets.phaseWord.textContent = phaseWordText;
      return { name: step.name, guidance: hasCueLists(step) ? phaseWordText : cue };
    },

    renderPhaseDetails() {
      updateStepStates();
      renderIllustration();
      renderCues();
    },

    breathTarget(nowSeconds, settlingToStart) {
      const runState = ui.runState();
      if (runState === "complete") return 0.3;
      if (settlingToStart) return 0.35;
      if (runState === "idle" || runState === "countdown") return 0.22 + 0.06 * Math.sin(nowSeconds * 0.8);
      const step = steps()[stepIndex];
      const phaseProgress = step ? Math.min(1, phaseElapsedMs / (phaseSeconds(step) * 1000)) : 0;
      const eased = ui.easeInOutSine(phaseProgress);
      // Tense gathers the orb inward. Release lets it open, short of a full
      // inhale balloon — the opposite of the breathing swell.
      return stepPhase === "tense"
        ? 0.45 - eased * (0.45 - 0.08)
        : 0.08 + eased * (0.62 - 0.08);
    },

    /** Per-frame DOM: phase countdown, session timer, progress bar, step fills. */
    renderFrame() {
      const runState = ui.runState();
      const list = steps();
      const running = runState === "active" || runState === "paused";
      const step = list[stepIndex];

      if (runState === "active" && step) {
        const remaining = Math.max(0, Math.ceil((phaseSeconds(step) * 1000 - phaseElapsedMs) / 1000));
        ui.setCountText(String(remaining));
      }

      const totalSeconds = list.reduce((sum, s) => sum + s.tenseSeconds + s.releaseSeconds, 0);
      let elapsedSeconds = 0;
      for (let i = 0; i < stepIndex && i < list.length; i += 1) {
        elapsedSeconds += list[i].tenseSeconds + list[i].releaseSeconds;
      }
      if (step && running) {
        elapsedSeconds += stepPhase === "tense"
          ? phaseElapsedMs / 1000
          : step.tenseSeconds + phaseElapsedMs / 1000;
      }
      const remainingSeconds = runState === "complete" ? 0 : Math.max(0, totalSeconds - elapsedSeconds);
      const timerText = ui.formatClock(remainingSeconds);
      if (widgets.timerValue.textContent !== timerText) widgets.timerValue.textContent = timerText;
      widgets.timerLabel.textContent = ui.chromeText("remaining");

      if (widgets.dotsBar.style.display !== "none") {
        let progressFraction = elapsedSeconds / Math.max(1, totalSeconds);
        if (runState === "complete") progressFraction = 1;
        else if (runState === "idle" || runState === "countdown") progressFraction = 0;
        widgets.dotsBarFill.style.width = `${Math.min(100, Math.max(0, progressFraction * 100))}%`;
      }

      const fills = widgets.steps.querySelectorAll(".session-step-fill");
      if (!step || fills.length < 2) return;
      if (running) {
        const progress = Math.min(1, phaseElapsedMs / (phaseSeconds(step) * 1000));
        fills[0].style.width = stepPhase === "tense" ? `${progress * 100}%` : "100%";
        fills[1].style.width = stepPhase === "tense" ? "0%" : `${progress * 100}%`;
      } else if (runState === "complete") {
        fills[0].style.width = "100%";
        fills[1].style.width = "100%";
      } else {
        fills[0].style.width = "0%";
        fills[1].style.width = "0%";
      }
    },

    deactivate() {
      hideIllustration();
      hideCues();
    },
  };
}

module.exports = { createPmrPractice };
