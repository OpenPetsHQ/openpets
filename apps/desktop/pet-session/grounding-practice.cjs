// Grounding practice view for the session overlay (descriptor kind
// "grounding", e.g. 5-4-3-2-1). Self-paced: there is no phase clock. Owns the
// current sense's checklist, the per-item dots, the elapsed/noticed tiles,
// the one-segment-per-sense track, Next/Back, and an orb that brightens as
// senses are completed. Checking items is optional — Next always works, so
// the practice never feels like a test.

const SENSE_COLORS = [
  { rgb: [0.42, 0.68, 1.0], css: "#7ab3ff" },
  { rgb: [0.30, 0.86, 0.78], css: "#4fdcc5" },
  { rgb: [0.72, 0.62, 1.0], css: "#b7a4ff" },
  { rgb: [0.94, 0.72, 0.42], css: "#f0b86b" },
  { rgb: [0.95, 0.56, 0.69], css: "#f28fb0" },
];

const svgIcon = (paths, strokeWidth = 2) => {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="${strokeWidth}" aria-hidden="true">${paths}</svg>`;
};

// lucide:anchor, lucide:check, lucide:arrow-right, lucide:chevron-left, lucide:circle-check
const circleCheckPaths = '<circle cx="12" cy="12" r="10"/><path d="m9 12l2 2l4-4"/>';
const anchorPaths = '<path d="M12 6v16m7-9l2-1a9 9 0 0 1-18 0l2 1m4-2h6"/><circle cx="12" cy="4" r="2"/>';
const checkPaths = '<path d="M20 6L9 17l-5-5"/>';
const arrowRightPaths = '<path d="M5 12h14m-7-7l7 7l-7 7"/>';
const chevronLeftPaths = '<path d="m15 18l-6-6l6-6"/>';

function createGroundingPractice(ui) {
  const { widgets } = ui;

  let stepIndex = 0;
  let checked = [];
  let elapsedMs = 0;
  let renderedListFor = null;

  const steps = () => {
    const descriptor = ui.descriptor();
    return descriptor && descriptor.kind === "grounding" ? descriptor.steps : [];
  };

  const senseColor = (index) => SENSE_COLORS[index % SENSE_COLORS.length];

  const currentStep = () => {
    const list = steps();
    if (ui.runState() === "complete") return list[list.length - 1] ?? null;
    return list[stepIndex] ?? list[0] ?? null;
  };

  const displayedIndex = () => {
    const list = steps();
    return ui.runState() === "complete" ? Math.max(0, list.length - 1) : stepIndex;
  };

  const checkedIn = (index) => checked[index] ?? new Set();

  const totals = () => {
    const list = steps();
    let found = 0;
    let total = 0;
    list.forEach((step, index) => {
      total += step.items.length;
      found += checkedIn(index).size;
    });
    return { found, total };
  };

  /** 0…1 journey through the senses; a checked item nudges the current sense forward. */
  const progressFraction = () => {
    const list = steps();
    if (list.length === 0) return 0;
    if (ui.runState() === "complete") return 1;
    if (ui.runState() !== "active") return 0;
    const step = list[stepIndex];
    const within = step ? checkedIn(stepIndex).size / step.items.length : 0;
    return Math.min(1, (stepIndex + within * 0.9) / list.length);
  };

  // --- Checklist (practice row) ------------------------------------------

  const list = document.createElement("ul");
  list.className = "session-grounding-list";

  const toggleItem = (itemIndex) => {
    if (ui.runState() !== "active") return;
    const set = checkedIn(stepIndex);
    if (set.has(itemIndex)) set.delete(itemIndex);
    else set.add(itemIndex);
    checked[stepIndex] = set;
    ui.triggerPulse(performance.now() / 1000);
    renderChecklistState();
    ui.renderProgressMeta();
    renderTrackFill();
  };

  /** Finished card: one row per sense with how many things were noticed. */
  const renderSummary = () => {
    if (renderedListFor === "summary") return;
    renderedListFor = "summary";
    list.textContent = "";
    list.classList.add("is-summary");
    steps().forEach((step, index) => {
      const row = document.createElement("li");
      row.className = "session-grounding-summary";
      row.style.setProperty("--sense-color", senseColor(index).css);
      const icon = document.createElement("span");
      icon.className = "session-grounding-summary-icon";
      icon.innerHTML = svgIcon(step.iconPaths ?? anchorPaths);
      const label = document.createElement("span");
      label.className = "session-grounding-summary-label";
      label.textContent = step.prompt;
      const count = document.createElement("span");
      count.className = "session-grounding-summary-count";
      count.textContent = `${checkedIn(index).size} / ${step.items.length}`;
      row.appendChild(icon);
      row.appendChild(label);
      row.appendChild(count);
      list.appendChild(row);
    });
    ui.scheduleGeometry();
  };

  const renderChecklist = () => {
    if (ui.runState() === "complete") {
      renderSummary();
      return;
    }
    list.classList.remove("is-summary");
    const step = currentStep();
    if (!step) {
      list.textContent = "";
      renderedListFor = null;
      return;
    }
    if (renderedListFor !== step) {
      renderedListFor = step;
      list.textContent = "";
      step.items.forEach((item, itemIndex) => {
        const row = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        button.className = "session-grounding-item";
        button.dataset.itemIndex = String(itemIndex);

        const box = document.createElement("span");
        box.className = "session-grounding-check";
        box.innerHTML = svgIcon(checkPaths, 3);

        const texts = document.createElement("span");
        texts.className = "session-grounding-texts";
        const text = document.createElement("span");
        text.className = "session-grounding-text";
        text.textContent = item.text;
        texts.appendChild(text);
        if (item.guidance) {
          const guidance = document.createElement("span");
          guidance.className = "session-grounding-guidance";
          guidance.textContent = item.guidance;
          texts.appendChild(guidance);
        }

        button.appendChild(box);
        button.appendChild(texts);
        button.addEventListener("click", () => toggleItem(itemIndex));
        row.appendChild(button);
        list.appendChild(row);
      });
      ui.scheduleGeometry();
    }
    renderChecklistState();
  };

  const renderChecklistState = () => {
    const runState = ui.runState();
    const set = runState === "complete" ? checkedIn(displayedIndex()) : checkedIn(stepIndex);
    const interactive = runState === "active";
    list.classList.toggle("is-inert", !interactive);
    for (const button of list.querySelectorAll(".session-grounding-item")) {
      const isChecked = set.has(Number(button.dataset.itemIndex));
      button.classList.toggle("is-checked", isChecked);
      button.setAttribute("aria-pressed", isChecked ? "true" : "false");
      button.tabIndex = interactive ? 0 : -1;
    }
  };

  // --- Shared rows ----------------------------------------------------------

  const renderStepTrack = () => {
    widgets.steps.textContent = "";
    for (const step of steps()) {
      ui.appendStepSegment(1, `${step.items.length} · ${step.label}`);
    }
    renderTrackFill();
  };

  const renderTrackFill = () => {
    const runState = ui.runState();
    const list = steps();
    const fills = widgets.steps.querySelectorAll(".session-step-fill");
    const segments = widgets.steps.children;
    list.forEach((step, index) => {
      let fraction = 0;
      if (runState === "complete" || (runState === "active" && index < stepIndex)) {
        fraction = 1;
      } else if (runState === "active" && index === stepIndex) {
        fraction = checkedIn(index).size / step.items.length;
      }
      if (fills[index]) {
        fills[index].style.width = `${fraction * 100}%`;
        fills[index].style.background = senseColor(index).css;
      }
      if (segments[index]) {
        segments[index].classList.toggle("is-active", runState === "active" && index === stepIndex);
        segments[index].classList.toggle("is-sense-done", fraction >= 1);
      }
    });
  };

  const moveTo = (nextIndex) => {
    stepIndex = nextIndex;
    ui.triggerPulse(performance.now() / 1000);
    ui.renderStatics();
  };

  return {
    kind: "grounding",
    topRows: [list],
    footerActiveKey: "footerGrounding",
    pausable: false,
    countUnit: "",
    paceIconSvg: svgIcon(circleCheckPaths),

    enter() {
      renderedListFor = null;
    },

    update() {
      ui.renderStatics();
    },

    reset() {
      stepIndex = 0;
      checked = steps().map(() => new Set());
      elapsedMs = 0;
      renderedListFor = null;
    },

    canStart() {
      return steps().length > 0;
    },

    eventProgress() {
      return { patternId: "grounding", cycle: stepIndex + 1 };
    },

    onBegin() {},

    /** No phase clock: only the elapsed time moves. */
    advance(deltaMs) {
      elapsedMs += deltaMs;
      return null;
    },

    primaryContent(runState) {
      if (runState !== "active") return null;
      const isLast = stepIndex >= steps().length - 1;
      const label = ui.escapeChromeText(isLast ? "finish" : "next");
      return isLast
        ? `${svgIcon(checkPaths, 2.6)}<span>${label}</span>`
        : `<span>${label}</span>${svgIcon(arrowRightPaths, 2.4)}`;
    },

    onPrimary(runState) {
      if (runState !== "active") return false;
      if (stepIndex >= steps().length - 1) {
        ui.completeRun({ patternId: "grounding", cycles: totals().found });
      } else {
        moveTo(stepIndex + 1);
      }
      return true;
    },

    /** Back replaces Restart during a run; hidden on the first sense. */
    secondaryContent(runState) {
      if (runState !== "active") return undefined;
      if (stepIndex === 0) return null;
      return `${svgIcon(chevronLeftPaths, 2.4)}<span>${ui.escapeChromeText("back")}</span>`;
    },

    onSecondary(runState) {
      if (runState !== "active") return false;
      if (stepIndex > 0) moveTo(stepIndex - 1);
      return true;
    },

    renderStatics() {
      const runState = ui.runState();
      const step = currentStep();
      const showSense = runState === "active" && step?.iconPaths;
      widgets.topbarIcon.innerHTML = svgIcon(showSense ? step.iconPaths : anchorPaths);

      widgets.lungsTile.style.flex = "";
      widgets.lungsIcon.style.display = "none";
      widgets.phaseWord.style.display = "";
      widgets.phaseWord.classList.add("is-icon");
      const tilePaths = runState === "active" && step?.iconPaths ? step.iconPaths : anchorPaths;
      widgets.phaseWord.innerHTML = svgIcon(tilePaths, 1.8);
      widgets.phaseWord.style.color = runState === "active" ? senseColor(stepIndex).css : "";
      widgets.paceTile.style.display = "";
      widgets.paceLabel.textContent = ui.chromeText("noticed");

      // Per-item dots for the current sense; the finished card shows only the total.
      const finished = runState === "complete";
      widgets.dotsBox.style.display = "";
      widgets.dotsBar.style.display = "none";
      widgets.dotsBox.textContent = "";
      for (let index = 0; !finished && index < (step?.items.length ?? 0); index += 1) {
        const dot = document.createElement("span");
        dot.className = "session-dot";
        widgets.dotsBox.appendChild(dot);
      }

      renderChecklist();
      renderStepTrack();
    },

    renderProgressMeta() {
      const step = currentStep();
      if (!step) return;
      const { found, total } = totals();
      const finished = ui.runState() === "complete";
      const set = checkedIn(stepIndex);
      const current = document.createElement("span");
      current.className = "count-current";
      current.textContent = String(finished ? found : set.size);
      widgets.dotsCount.textContent = "";
      widgets.dotsCount.appendChild(current);
      widgets.dotsCount.appendChild(document.createTextNode(` / ${finished ? total : step.items.length}`));

      const dots = widgets.dotsBox.children;
      for (let index = 0; index < dots.length; index += 1) {
        dots[index].classList.toggle("is-done", set.has(index));
        dots[index].classList.remove("is-current");
      }

      widgets.paceValue.textContent = `${found} / ${total}`;
    },

    renderIdle() {},

    /** Sense title + prompt for the header; the big number is the sense's count. */
    runningPhase() {
      const step = currentStep();
      if (!step) return null;
      const color = senseColor(stepIndex);
      ui.setPhaseColor(color.rgb, color.css);
      ui.setCountText(String(step.items.length));
      return { name: step.title, guidance: step.prompt };
    },

    renderPhaseDetails() {
      renderChecklistState();
      renderTrackFill();
    },

    breathTarget(nowSeconds) {
      const runState = ui.runState();
      if (runState === "complete") return 0.82;
      if (runState !== "active") return 0.22 + 0.06 * Math.sin(nowSeconds * 0.8);
      // Settling in: the orb brightens and opens a little with every sense.
      return 0.16 + 0.6 * progressFraction() + 0.03 * Math.sin(nowSeconds * 0.9);
    },

    renderFrame() {
      const runState = ui.runState();
      const seconds = runState === "idle" ? 0 : elapsedMs / 1000;
      const timerText = ui.formatClock(seconds);
      if (widgets.timerValue.textContent !== timerText) widgets.timerValue.textContent = timerText;
      widgets.timerLabel.textContent = ui.chromeText("elapsed");
    },

    deactivate() {
      list.textContent = "";
      renderedListFor = null;
      widgets.phaseWord.classList.remove("is-icon");
      widgets.phaseWord.style.color = "";
      widgets.phaseWord.textContent = "";
    },
  };
}

module.exports = { createGroundingPractice };
