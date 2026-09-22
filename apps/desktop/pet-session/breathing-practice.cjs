// Breathing practice view for the session overlay (descriptor kind
// "breathing"). Owns the phase clock over the selected pattern, the cycle
// dots, the timer · lungs · pace tiles, the phase segment track, the breath
// value that drives the orb, and — when the descriptor carries more than one
// pattern (guided breathing) — the pattern chips under the card header.

const PHASE_STYLE = {
  in: { nameKey: "inhale", guidanceKey: "inhaleGuidance", color: [0.42, 0.68, 1.0], css: "#7ab3ff" },
  hold: { nameKey: "hold", guidanceKey: "holdGuidance", color: [0.72, 0.62, 1.0], css: "#b7a4ff" },
  out: { nameKey: "exhale", guidanceKey: "exhaleGuidance", color: [0.30, 0.86, 0.78], css: "#4fdcc5" },
};

// lucide:leaf (via better-icons/Iconify)
const leafIconSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true"><path d="M11 20a10 10 0 0 0 10-10a25.9 25.9 0 0 0-1.04-7.281a1 1 0 0 0-1.755-.325C15.833 5.5 13 5.5 9.8 6.1A7 7 0 0 0 11 20"/><path d="M2 21a5 5 0 0 1 2.911-4.544C7.613 15.212 8.351 15.24 11 13"/></svg>';

const maxCycleDots = 16;

function createBreathingPractice(ui) {
  const { widgets } = ui;

  let selectedPatternId = null;
  let phaseIndex = 0;
  let cycleIndex = 0;
  let phaseElapsedMs = 0;

  // --- Pattern chips (guided breathing) -----------------------------------

  const chipsRow = document.createElement("div");
  chipsRow.className = "session-pattern-chips";
  chipsRow.setAttribute("role", "group");
  let chipsRenderedFor = null;

  const selectedPattern = () => {
    const descriptor = ui.descriptor();
    if (!descriptor || descriptor.kind !== "breathing") return null;
    return descriptor.patterns.find((pattern) => pattern.id === selectedPatternId) ?? descriptor.patterns[0];
  };

  const formatCount = (seconds) => {
    return Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  };

  const patternTiming = (pattern) => pattern.phases.map((phase) => formatCount(phase.seconds)).join("-");

  const isRunLocked = () => {
    const runState = ui.runState();
    return runState === "countdown" || runState === "active" || runState === "paused";
  };

  const handleChipClick = (patternId) => {
    if (isRunLocked()) return;
    if (ui.runState() === "complete") {
      ui.returnToIdle();
    } else if (patternId === selectedPatternId) {
      return;
    }
    selectPattern(patternId);
  };

  const renderChips = () => {
    const descriptor = ui.descriptor();
    const patterns = descriptor && descriptor.kind === "breathing" ? descriptor.patterns : [];
    if (patterns.length <= 1) {
      chipsRow.style.display = "none";
      chipsRow.textContent = "";
      chipsRenderedFor = null;
      return;
    }

    chipsRow.style.display = "";
    if (chipsRenderedFor !== patterns) {
      chipsRenderedFor = patterns;
      chipsRow.textContent = "";
      for (const pattern of patterns) {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "session-pattern-chip";
        chip.dataset.patternId = pattern.id;
        if (pattern.hint) chip.title = pattern.hint;

        const name = document.createElement("span");
        name.className = "session-chip-name";
        name.textContent = pattern.name;
        const timing = document.createElement("span");
        timing.className = "session-chip-timing";
        timing.textContent = patternTiming(pattern);

        chip.appendChild(name);
        chip.appendChild(timing);
        chip.addEventListener("click", () => handleChipClick(pattern.id));
        chipsRow.appendChild(chip);
      }
    }

    const current = selectedPattern();
    const locked = isRunLocked();
    chipsRow.classList.toggle("is-locked", locked);
    for (const chip of chipsRow.children) {
      const isSelected = Boolean(current && chip.dataset.patternId === current.id);
      chip.classList.toggle("is-selected", isSelected);
      chip.setAttribute("aria-pressed", isSelected ? "true" : "false");
      chip.disabled = locked && !isSelected;
    }
  };

  // --- Clock ----------------------------------------------------------------

  const phasePresentation = (phase) => {
    const base = PHASE_STYLE[phase.kind] ?? PHASE_STYLE.in;
    const hasLabel = typeof phase.label === "string" && phase.label;
    return {
      name: ui.chromeText(base.nameKey),
      guidance: hasLabel ? phase.label : ui.chromeText(base.guidanceKey),
      color: base.color,
      css: base.css,
    };
  };

  const breathTargetFor = (phase, progress) => {
    if (!phase) return 0.25;
    if (phase.kind === "in") return ui.easeInOutSine(progress);
    if (phase.kind === "out") return 1 - ui.easeInOutSine(progress);
    // Hold keeps the lungs where the previous phase left them.
    const pattern = selectedPattern();
    if (!pattern) return 0.5;
    const previous = pattern.phases[(phaseIndex + pattern.phases.length - 1) % pattern.phases.length];
    return previous && previous.kind === "out" ? 0.06 : 1;
  };

  const cycleSeconds = (pattern) => pattern.phases.reduce((sum, phase) => sum + phase.seconds, 0);

  const cycleProgressWithinCycle = (pattern, phaseProgress) => {
    if (!pattern) return 0;
    const total = cycleSeconds(pattern);
    let elapsed = 0;
    for (let index = 0; index < phaseIndex; index += 1) elapsed += pattern.phases[index].seconds;
    const current = pattern.phases[phaseIndex];
    elapsed += (current ? current.seconds : 0) * phaseProgress;
    return total > 0 ? Math.min(1, elapsed / total) : 0;
  };

  const formatPace = (pattern) => {
    const seconds = cycleSeconds(pattern);
    if (seconds <= 0) return "";
    const perMinute = 60 / seconds;
    const rounded = Math.round(perMinute * 10) / 10;
    return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)} / min`;
  };

  const runningPhase = () => {
    const runState = ui.runState();
    const pattern = selectedPattern();
    if (!pattern || (runState !== "active" && runState !== "paused")) return null;
    return pattern.phases[phaseIndex];
  };

  const selectPattern = (patternId) => {
    selectedPatternId = patternId;
    ui.resetClock();
    const pattern = selectedPattern();
    if (ui.runState() === "active") {
      ui.stopCuePlayback();
      if (pattern && pattern.phases[0]) ui.playPhaseCue(pattern.phases[0].kind);
    }
    ui.renderStatics();
    ui.send({ type: "patternChanged", patternId: pattern ? pattern.id : patternId });
  };

  // --- Rendering ------------------------------------------------------------

  const renderStepTrack = () => {
    widgets.steps.textContent = "";
    const pattern = selectedPattern();
    if (!pattern) return;
    for (const phase of pattern.phases) {
      ui.appendStepSegment(phase.seconds, `${phasePresentation(phase).name} · ${ui.formatSeconds(phase.seconds)}`);
    }
  };

  const updateStepStates = () => {
    const runState = ui.runState();
    const stepElements = widgets.steps.children;
    const running = runState === "active" || runState === "paused";
    for (let index = 0; index < stepElements.length; index += 1) {
      const step = stepElements[index];
      step.classList.toggle("is-active", running && index === phaseIndex);
      step.classList.toggle("is-done", (running && index < phaseIndex) || runState === "complete");
    }
  };

  return {
    kind: "breathing",
    topRows: [chipsRow],
    footerActiveKey: "footerBreathing",

    enter(descriptor) {
      selectedPatternId = descriptor.patternId;
    },

    update(descriptor) {
      if (selectedPatternId !== descriptor.patternId) {
        selectPattern(descriptor.patternId);
      } else {
        ui.renderStatics();
      }
    },

    reset() {
      phaseIndex = 0;
      cycleIndex = 0;
      phaseElapsedMs = 0;
    },

    canStart() {
      return Boolean(selectedPattern());
    },

    eventProgress() {
      const pattern = selectedPattern();
      return { patternId: pattern ? pattern.id : null, cycle: cycleIndex + 1 };
    },

    onBegin() {
      const pattern = selectedPattern();
      if (pattern) ui.playPhaseCue(pattern.phases[0].kind);
    },

    /** Advance the phase clock; returns the completion payload when the run ends. */
    advance(deltaMs, nowSeconds) {
      const pattern = selectedPattern();
      if (!pattern) return null;
      phaseElapsedMs += deltaMs;
      let guard = 0;
      while (guard < 16) {
        guard += 1;
        const phase = pattern.phases[phaseIndex];
        const phaseMs = phase.seconds * 1000;
        if (phaseElapsedMs < phaseMs) break;
        phaseElapsedMs -= phaseMs;
        phaseIndex += 1;
        ui.triggerPulse(nowSeconds);
        if (phaseIndex >= pattern.phases.length) {
          phaseIndex = 0;
          cycleIndex += 1;
          if (pattern.cycles !== null && cycleIndex >= pattern.cycles) {
            phaseElapsedMs = 0;
            return { patternId: pattern.id, cycles: pattern.cycles };
          }
          ui.renderProgressMeta();
        }
        ui.playPhaseCue(pattern.phases[phaseIndex].kind);
        ui.renderPhaseText();
      }
      return null;
    },

    renderStatics() {
      widgets.topbarIcon.innerHTML = leafIconSvg;
      widgets.lungsTile.style.flex = "";
      widgets.lungsIcon.style.display = "";
      widgets.phaseWord.style.display = "none";
      widgets.paceTile.style.display = "";

      renderChips();
      renderStepTrack();

      // Cycle dots for short finite runs; a slim bar otherwise.
      const pattern = selectedPattern();
      const useDots = Boolean(pattern && pattern.cycles !== null && pattern.cycles <= maxCycleDots);
      widgets.dotsBox.style.display = useDots ? "" : "none";
      widgets.dotsBar.style.display = useDots ? "none" : "";
      if (useDots) {
        widgets.dotsBox.textContent = "";
        for (let index = 0; index < pattern.cycles; index += 1) {
          const dot = document.createElement("span");
          dot.className = "session-dot";
          widgets.dotsBox.appendChild(dot);
        }
      }

      if (pattern) {
        widgets.paceValue.textContent = formatPace(pattern);
        widgets.paceLabel.textContent = ui.chromeText("breathPace");
      }
    },

    renderProgressMeta() {
      const runState = ui.runState();
      const pattern = selectedPattern();
      if (!pattern) return;
      const { dotsCount, dotsBox } = widgets;

      if (pattern.cycles !== null) {
        dotsCount.innerHTML = "";
        if (runState === "idle" || runState === "countdown") {
          dotsCount.textContent = ui.chromeText("cyclesCount", { count: pattern.cycles });
        } else {
          const displayCycle = runState === "complete" ? pattern.cycles : Math.min(cycleIndex + 1, pattern.cycles);
          const current = document.createElement("span");
          current.className = "count-current";
          current.textContent = String(displayCycle);
          dotsCount.appendChild(current);
          dotsCount.appendChild(document.createTextNode(` / ${pattern.cycles}`));
        }
      } else {
        const beforeRun = runState === "idle" || runState === "countdown";
        dotsCount.textContent = beforeRun ? ui.chromeText("untilStopped") : ui.chromeText("cycleN", { n: cycleIndex + 1 });
      }

      const running = runState === "active" || runState === "paused";
      const dots = dotsBox.children;
      for (let index = 0; index < dots.length; index += 1) {
        const done = runState === "complete" || (running && index < cycleIndex);
        const isCurrent = running && index === cycleIndex;
        dots[index].classList.toggle("is-done", done);
        dots[index].classList.toggle("is-current", isCurrent);
      }
    },

    renderIdle() {},

    /** Phase name/guidance for the header during a run; also sets the phase color. */
    runningPhase() {
      const pattern = selectedPattern();
      if (!pattern) return null;
      const phase = pattern.phases[phaseIndex];
      const presentation = phasePresentation(phase);
      ui.setPhaseColor(presentation.color, presentation.css);
      return { name: presentation.name, guidance: presentation.guidance };
    },

    renderPhaseDetails() {
      updateStepStates();
    },

    breathTarget(nowSeconds, settlingToStart) {
      const runState = ui.runState();
      if (runState === "complete") return 0.3;
      if (settlingToStart) return 0.02;
      if (runState === "idle" || runState === "countdown") return 0.22 + 0.06 * Math.sin(nowSeconds * 0.8);
      const phase = runningPhase();
      const phaseProgress = phase ? Math.min(1, phaseElapsedMs / (phase.seconds * 1000)) : 0;
      return breathTargetFor(phase, phaseProgress);
    },

    /** Per-frame DOM: phase countdown, session timer, cycle bar, lungs, active step fill. */
    renderFrame(breathValue, phaseCss) {
      const runState = ui.runState();
      const pattern = selectedPattern();
      if (!pattern) return;
      const phase = runningPhase();
      const phaseProgress = phase ? Math.min(1, phaseElapsedMs / (phase.seconds * 1000)) : 0;

      if (phase && runState === "active") {
        const remaining = Math.max(0, Math.ceil((phase.seconds * 1000 - phaseElapsedMs) / 1000));
        ui.setCountText(String(remaining));
      }

      // Session timer tile (whole-session remaining, or elapsed when endless)
      // plus the slim per-cycle bar.
      const secondsPerCycle = cycleSeconds(pattern);
      const withinCycleSeconds = runState === "idle" ? 0 : cycleProgressWithinCycle(pattern, phaseProgress) * secondsPerCycle;
      const elapsedSeconds = cycleIndex * secondsPerCycle + withinCycleSeconds;
      let timerText;
      if (pattern.cycles !== null) {
        const totalSeconds = pattern.cycles * secondsPerCycle;
        timerText = ui.formatClock(runState === "complete" ? 0 : totalSeconds - elapsedSeconds);
        widgets.timerLabel.textContent = ui.chromeText("remaining");
      } else {
        timerText = ui.formatClock(elapsedSeconds);
        widgets.timerLabel.textContent = ui.chromeText("elapsed");
      }
      if (widgets.timerValue.textContent !== timerText) widgets.timerValue.textContent = timerText;
      if (widgets.dotsBar.style.display !== "none") {
        widgets.dotsBarFill.style.width = `${Math.min(100, (withinCycleSeconds / Math.max(1, secondsPerCycle)) * 100)}%`;
      }

      widgets.lungsIcon.style.transform = `scale(${(0.88 + 0.24 * breathValue).toFixed(3)})`;
      widgets.lungsIcon.style.color = runState === "active" ? phaseCss : "";

      if (phase) {
        const fills = widgets.steps.querySelectorAll(".session-step-fill");
        const activeFill = fills[phaseIndex];
        if (activeFill) activeFill.style.width = `${phaseProgress * 100}%`;
      }
    },

    deactivate() {
      chipsRow.textContent = "";
      chipsRenderedFor = null;
    },
  };
}

module.exports = { createBreathingPractice };
