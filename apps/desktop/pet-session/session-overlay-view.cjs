// ---------------------------------------------------------------------------
// Practice session overlay (ui:session) — the host-rendered surface around
// the default pet. The host coordinator sends a validated descriptor over
// "openpets:session-overlay"; this shell owns the card chrome (header,
// shared progress rows, controls, footer), the run state machine and lead-in
// countdown, the frame loop, phase audio cues, runtime geometry, and reports
// control events back. Each descriptor kind has a practice view
// (breathing-practice.cjs, pmr-practice.cjs, grounding-practice.cjs) that
// owns its clock, its own card rows, and what the shared rows and the orb
// show. Practices may also override the primary/secondary buttons (grounding
// uses Next/Back) and opt out of pausing. The header doubles as the practice
// picker on the idle and completed card.
// ---------------------------------------------------------------------------

const { createSessionOrb } = require("./orb-renderer.cjs");
const { createBreathingPractice } = require("./breathing-practice.cjs");
const { createPmrPractice } = require("./pmr-practice.cjs");
const { createGroundingPractice } = require("./grounding-practice.cjs");

const IDLE_COLOR = [0.45, 0.62, 0.98];
const ORB_CARD_GAP = 10;
const CARD_TOP_INSET = 14;
/** Clearance below the orb for its rim glow. */
const ORB_BOTTOM_RIM = 16;

// Host-localized chrome strings arrive with the descriptor; English is the
// in-place fallback so a missing key never renders blank.
const chromeFallback = {
  inhale: "Inhale", hold: "Hold", exhale: "Exhale",
  inhaleGuidance: "Breathe in slowly", holdGuidance: "Hold gently", exhaleGuidance: "Breathe out slowly",
  paused: "Paused", pausedGuidance: "Resume when you're ready",
  complete: "Complete", completeGuidance: "Nice work. Take a moment.",
  idleGuidance: "Press start when you're ready",
  pause: "Pause", resume: "Resume", start: "Start", done: "Done", restart: "Restart", again: "Again",
  remaining: "remaining", elapsed: "elapsed", breathPace: "breath pace",
  cyclesCount: "{count} cycles", cycleN: "cycle {n}", untilStopped: "until stopped",
  footerBreathing: "breathing with {name}", footerComplete: "nicely done", footerReady: "ready when you are",
  close: "Close", about: "About this technique",
  mute: "Mute breathing cues", unmute: "Unmute breathing cues",
  getReady: "Get ready", getReadyGuidance: "Settle in — we begin in a moment", startNow: "Start now",
  tense: "Tense", release: "Release", groupProgress: "{n} / {total}", footerRelaxing: "relaxing with {name}",
  currentChoice: "Current", next: "Next", back: "Back", finish: "Finish", noticed: "noticed",
  footerGrounding: "grounding with {name}", switchPractice: "Switch practice",
};

// Icons from better-icons/Iconify. Pause/play are filled so the primary pill
// glyph stays solid at 13px.
const icons = {
  // lucide:volume-2 / lucide:volume-x
  volumeOn: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true"><path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298zM16 9a5 5 0 0 1 0 6m3.364 3.364a9 9 0 0 0 0-12.728"/></svg>',
  volumeOff: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true"><path d="M11 4.702a.7.7 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.7.7 0 0 0 11 19.298zm5.5 9.798l5-5m-5 0l5 5"/></svg>',
  // lucide:x
  close: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>',
  // lucide:timer
  timer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true"><path d="M10 2h4m-2 12l3-3"/><circle cx="12" cy="14" r="8"/></svg>',
  // tabler:lungs
  lungs: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" aria-hidden="true"><path d="M6.081 20C7.693 20 9 18.665 9 17.02V7.257C9 6.563 8.448 6 7.768 6c-.205 0-.405.052-.584.15l-.13.083C5.594 7.292 4.622 8.88 3.65 12.057q-.63 2.055-.648 4.775c-.012 1.675 1.261 3.054 2.877 3.161zm11.839 0C16.307 20 15 18.665 15 17.02V7.257C15 6.563 15.552 6 16.233 6c.204 0 .405.052.584.15l.13.083c1.46 1.059 2.432 2.647 3.405 5.824q.63 2.055.648 4.775c.012 1.675-1.261 3.054-2.878 3.161zM9 12a3 3 0 0 0 3-3a3 3 0 0 0 3 3m-3-8v5"/></svg>',
  // lucide:audio-waveform
  waveform: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true"><path d="M2 13a2 2 0 0 0 2-2V7a2 2 0 0 1 4 0v13a2 2 0 0 0 4 0V4a2 2 0 0 1 4 0v13a2 2 0 0 0 4 0v-4a2 2 0 0 1 2-2"/></svg>',
  // lucide:info
  info: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4m0-4h.01"/></svg>',
  // lucide:chevron-down, lucide:check
  chevronDown: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.4" aria-hidden="true"><path d="m6 9l6 6l6-6"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.6" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>',
  // lucide:leaf (fallback practice icon)
  leaf: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true"><path d="M11 20a10 10 0 0 0 10-10a25.9 25.9 0 0 0-1.04-7.281a1 1 0 0 0-1.755-.325C15.833 5.5 13 5.5 9.8 6.1A7 7 0 0 0 11 20"/><path d="M2 21a5 5 0 0 1 2.911-4.544C7.613 15.212 8.351 15.24 11 13"/></svg>',
  // lucide:pause, lucide:play, lucide:check, lucide:rotate-ccw
  pause: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true"><rect width="5" height="18" x="14" y="3" rx="1"/><rect width="5" height="18" x="5" y="3" rx="1"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true"><path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"/></svg>',
  done: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.6" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>',
  restart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.2" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9a9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>',
};

const easeInOutSine = (t) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, t)));

const formatClock = (totalSeconds) => {
  const clamped = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
};

const formatSeconds = (seconds) => {
  return Number.isInteger(seconds) ? `${seconds}s` : `${seconds.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}s`;
};

const el = (tag, className) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  return element;
};

function installDefaultPetSession({ ipcRenderer, escapeHtml }) {
  if (document.documentElement?.dataset?.petRole !== "default") return;

  // The stylesheet ships static fallback geometry; the source of truth is a
  // runtime measurement of the real rendered sprite and session card, applied
  // as :root CSS variable overrides so the orb hugs the pet, the pet sits at
  // the orb centre, and the orb rests on the card for any pet asset or scale.
  const readGeometryVar = (name, fallback) => {
    const raw = Number(getComputedStyle(document.documentElement).getPropertyValue(name));
    return Number.isFinite(raw) && raw > 0 ? raw : fallback;
  };
  let orbRadius = readGeometryVar("--session-orb-radius", 140);

  let chromeStrings = { ...chromeFallback };
  const chromeText = (key, vars) => {
    const own = chromeStrings[key];
    let text = typeof own === "string" && own ? own : chromeFallback[key] ?? "";
    if (vars) {
      for (const [name, value] of Object.entries(vars)) {
        text = text.split(`{${name}}`).join(String(value));
      }
    }
    return text;
  };
  const escapeChromeText = (key, vars) => escapeHtml(chromeText(key, vars));

  let descriptor = null;
  let practice = null;
  let runState = "idle"; // idle | countdown | active | paused | complete
  let countdownRemainingMs = 0;
  let lastFrameAt = 0;
  let rafHandle = null;
  let pulseStartedAt = -10;
  let breathValue = 0;
  let currentColor = IDLE_COLOR.slice();
  let targetColor = IDLE_COLOR.slice();
  let currentPhaseCss = "#7ab3ff";
  let lastCountdownText = "";

  const sendSessionEvent = (payload) => {
    ipcRenderer.send("openpets:session-overlay-event", payload);
  };

  // --- Phase audio cues ----------------------------------------------------
  // Host-gated by the global plugin-audio setting and quiet hours; toggled by
  // the header mute button.
  // audioCues: { enabled, allowed, pair: {inhaleEl, exhaleEl}, patterns: {id: pair} }
  // Patterns with their own timed cues use them; others fall back to `pair`.
  let audioCues = null;
  const cueElementsByUrl = new Map();

  const cueElementFor = (dataUrl) => {
    if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:audio/")) return null;
    const cached = cueElementsByUrl.get(dataUrl);
    if (cached) return cached;
    const element = new Audio();
    element.preload = "auto";
    element.src = dataUrl;
    cueElementsByUrl.set(dataUrl, element);
    return element;
  };

  const cuePairFor = (raw) => ({
    inhaleEl: cueElementFor(raw?.inhaleDataUrl),
    exhaleEl: cueElementFor(raw?.exhaleDataUrl),
  });

  const stopCuePlayback = () => {
    for (const element of cueElementsByUrl.values()) {
      element.pause();
      element.currentTime = 0;
    }
  };

  const playPhaseCue = (phaseKind, patternId) => {
    if (!audioCues || !audioCues.enabled || !audioCues.allowed || runState !== "active") return;
    const pair = (patternId && audioCues.patterns[patternId]) || audioCues.pair;
    let element = null;
    if (phaseKind === "in") element = pair.inhaleEl;
    else if (phaseKind === "out") element = pair.exhaleEl;
    if (!element) return;
    stopCuePlayback();
    element.volume = 0.9;
    element.currentTime = 0;
    void element.play().catch(() => undefined);
  };

  const hasAnyCue = () => {
    if (!audioCues) return false;
    const pairs = [audioCues.pair, ...Object.values(audioCues.patterns)];
    return pairs.some((pair) => pair.inhaleEl || pair.exhaleEl);
  };

  const applyAudioPayload = (raw) => {
    if (!raw || typeof raw !== "object") {
      stopCuePlayback();
      audioCues = null;
      cueElementsByUrl.clear();
      return;
    }
    const patterns = {};
    if (raw.patterns && typeof raw.patterns === "object") {
      for (const [patternId, pairRaw] of Object.entries(raw.patterns)) {
        patterns[patternId] = cuePairFor(pairRaw);
      }
    }
    audioCues = {
      enabled: raw.enabled !== false,
      allowed: raw.allowed === true,
      pair: cuePairFor(raw),
      patterns,
    };
  };

  // --- DOM -----------------------------------------------------------------

  const root = el("div", "openpets-session-overlay");
  root.setAttribute("role", "region");
  root.setAttribute("aria-label", "Practice session");

  const orbCanvas = el("canvas", "session-orb-canvas");
  root.appendChild(orbCanvas);

  const card = el("div", "session-card");

  // Row 1: the header. Idle shows the practice title; during a run it doubles
  // as the phase HUD (phase name, guidance, live countdown).
  const header = el("div", "session-card-header");
  // Icon + titles form the practice picker trigger when switching is offered.
  const headerSwitch = el("button", "session-header-switch");
  headerSwitch.type = "button";
  headerSwitch.setAttribute("aria-haspopup", "menu");
  headerSwitch.setAttribute("aria-expanded", "false");
  const headerIcon = el("div", "session-header-icon");
  const headerTitles = el("div", "session-header-titles");
  const phaseNameRow = el("div", "session-header-title-row");
  const phaseName = el("div", "session-header-title");
  const headerChevron = el("span", "session-header-chevron");
  headerChevron.innerHTML = icons.chevronDown;
  phaseNameRow.appendChild(phaseName);
  phaseNameRow.appendChild(headerChevron);
  const phaseGuidance = el("div", "session-header-subtitle");
  headerTitles.appendChild(phaseNameRow);
  headerTitles.appendChild(phaseGuidance);
  headerSwitch.appendChild(headerIcon);
  headerSwitch.appendChild(headerTitles);
  const phaseCount = el("div", "session-header-count");
  const phaseCountValue = el("span");
  const phaseCountUnit = el("span", "count-unit");
  phaseCountUnit.textContent = "s";
  phaseCount.appendChild(phaseCountValue);
  phaseCount.appendChild(phaseCountUnit);
  const audioBtn = el("button", "session-close-btn session-audio-btn");
  audioBtn.type = "button";
  audioBtn.style.display = "none";
  const closeBtn = el("button", "session-close-btn");
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Close session");
  closeBtn.setAttribute("title", "Close (Esc)");
  closeBtn.innerHTML = icons.close;
  header.appendChild(headerSwitch);
  header.appendChild(phaseCount);
  header.appendChild(audioBtn);
  header.appendChild(closeBtn);
  card.appendChild(header);

  // Practice picker: opens above the card from the header.
  const practiceMenu = el("div", "session-practice-menu");
  practiceMenu.setAttribute("role", "menu");
  card.appendChild(practiceMenu);

  // Practice-owned rows (pose + cues for PMR, pattern chips for guided
  // breathing) mount here, between the header and the shared progress rows.
  const practiceRows = el("div", "session-practice-rows");
  card.appendChild(practiceRows);

  // Shared row: cycle/step dots (or a slim bar) + count.
  const dotsRow = el("div", "session-dots-row");
  const dotsBox = el("div", "session-dots");
  const dotsBar = el("div", "session-dots-bar");
  const dotsBarFill = el("div", "session-dots-bar-fill");
  dotsBar.appendChild(dotsBarFill);
  const dotsCount = el("div", "session-dots-count");
  dotsRow.appendChild(dotsBox);
  dotsRow.appendChild(dotsBar);
  dotsRow.appendChild(dotsCount);
  card.appendChild(dotsRow);

  // Shared row: session timer · middle tile (lungs or phase word) · pace.
  const tiles = el("div", "session-tiles");
  const makeLabeledTile = (iconSvg) => {
    const tile = el("div", "session-tile");
    const icon = el("div", "session-tile-icon");
    icon.innerHTML = iconSvg;
    const content = el("div", "session-tile-content");
    const value = el("div", "session-tile-value");
    const label = el("div", "session-tile-label");
    content.appendChild(value);
    content.appendChild(label);
    tile.appendChild(icon);
    tile.appendChild(content);
    return { tile, icon, value, label };
  };
  const timerTile = makeLabeledTile(icons.timer);
  timerTile.label.textContent = "remaining";
  const lungsTile = el("div", "session-tile is-middle");
  const lungsIcon = el("div", "session-lungs");
  lungsIcon.setAttribute("aria-hidden", "true");
  lungsIcon.innerHTML = icons.lungs;
  const phaseWord = el("div", "session-tile-value");
  phaseWord.style.display = "none";
  lungsTile.appendChild(lungsIcon);
  lungsTile.appendChild(phaseWord);
  const paceTile = makeLabeledTile(icons.waveform);
  paceTile.label.textContent = "breath pace";
  tiles.appendChild(timerTile.tile);
  tiles.appendChild(lungsTile);
  tiles.appendChild(paceTile.tile);
  card.appendChild(tiles);

  // Shared row: the phase segment track (practices fill the segments).
  const steps = el("div", "session-steps");
  card.appendChild(steps);

  // Controls: Info · Restart (or a practice's secondary) · primary.
  const controls = el("div", "session-controls");
  const infoBtn = el("button", "session-info-btn");
  infoBtn.type = "button";
  infoBtn.setAttribute("aria-label", "About this technique");
  infoBtn.setAttribute("title", "About this technique");
  infoBtn.innerHTML = icons.info;
  const controlsSpacer = el("div", "session-controls-spacer");
  const restartBtn = el("button", "session-ghost-btn");
  restartBtn.type = "button";
  const primaryBtn = el("button", "session-primary-btn");
  primaryBtn.type = "button";
  controls.appendChild(infoBtn);
  controls.appendChild(controlsSpacer);
  controls.appendChild(restartBtn);
  controls.appendChild(primaryBtn);
  card.appendChild(controls);

  // Footer: paws + companion line.
  const footer = el("div", "session-footer");
  card.appendChild(footer);

  root.appendChild(card);
  document.body.appendChild(root);

  // --- Runtime geometry ----------------------------------------------------
  // The card sits at the top; the orb wraps the pet near its resting spot
  // below it. Measures the real rendered sprite and card, then sizes the orb
  // to the band under the card and lifts the pet only as far as the orb's
  // rim needs, for any pet asset and scale.

  const parseCurrentPetLift = (hitbox) => {
    const transform = getComputedStyle(hitbox).transform;
    if (!transform || transform === "none") return 0;
    const match = /matrix\(([^)]+)\)/.exec(transform);
    if (!match) return 0;
    const parts = match[1].split(",").map((value) => Number(value.trim()));
    const translateY = parts.length === 6 && Number.isFinite(parts[5]) ? parts[5] : 0;
    return -translateY;
  };

  const applySessionGeometry = () => {
    if (!descriptor) return;
    const sprite = document.querySelector(".installed-sprite, .sprite");
    const hitbox = document.querySelector(".pet-hitbox");
    if (!sprite || !hitbox) return;
    const cardHeight = Math.max(110, Math.round(card.getBoundingClientRect().height));
    const spriteRect = sprite.getBoundingClientRect();
    if (spriteRect.height <= 0 || window.innerHeight <= 0) return;

    // The lift transform may already (or still) be applied; subtracting the
    // live translation recovers the sprite's resting centre.
    const currentLift = parseCurrentPetLift(hitbox);
    const restCenterY = spriteRect.top + spriteRect.height / 2 + currentLift;

    // Keep the orb (rim glow included) inside the band under the card.
    const cardBottom = CARD_TOP_INSET + cardHeight + ORB_CARD_GAP;
    const bandHeight = window.innerHeight - cardBottom - ORB_BOTTOM_RIM;
    const maxRadius = Math.max(96, Math.floor(bandHeight / 2));
    orbRadius = Math.max(96, Math.min(Math.min(240, maxRadius), Math.round(spriteRect.height)));

    // Centre the orb on the resting pet when it fits; otherwise raise it just
    // enough for the rim, and never into the card.
    const restCenterFromBottom = window.innerHeight - restCenterY;
    const lowestCenter = ORB_BOTTOM_RIM + orbRadius;
    const highestCenter = window.innerHeight - cardBottom - orbRadius;
    const orbCenterBottom = Math.round(Math.min(highestCenter, Math.max(lowestCenter, restCenterFromBottom)));
    const petLift = Math.max(0, Math.round(orbCenterBottom - restCenterFromBottom));

    reportContentHeight({
      cardHeight,
      spriteHeight: Math.round(spriteRect.height),
      spriteClass: sprite.className,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
      orbRadius,
      petLift,
    });

    const rootStyle = document.documentElement.style;
    rootStyle.setProperty("--session-orb-radius", String(orbRadius));
    rootStyle.setProperty("--session-orb-center-bottom", String(orbCenterBottom));
    rootStyle.setProperty("--session-pet-lift", `${petLift}px`);
  };

  // Report the carrier height this layout needs (card + gap + orb + rim) so
  // the host fits the window to it; the orb size depends on the pet, not on
  // the current window, so the report is stable once the window matches.
  let lastReportedHeight = 0;
  const reportContentHeight = (measure) => {
    const neededRadius = Math.max(96, Math.min(240, Math.round(measure.spriteHeight)));
    const needed = Math.round(CARD_TOP_INSET + measure.cardHeight + ORB_CARD_GAP + neededRadius * 2 + ORB_BOTTOM_RIM);
    if (Math.abs(needed - lastReportedHeight) < 2) return;
    lastReportedHeight = needed;
    ipcRenderer.send("openpets:session-overlay-content-height", { height: needed, ...measure });
  };

  const scheduleSessionGeometry = () => {
    requestAnimationFrame(() => requestAnimationFrame(applySessionGeometry));
  };

  window.addEventListener("resize", () => {
    if (descriptor) scheduleSessionGeometry();
  });

  const orb = createSessionOrb(orbCanvas);

  // --- Rendering -----------------------------------------------------------

  const triggerPulse = (nowSeconds) => {
    pulseStartedAt = nowSeconds;
  };

  const setPhaseColor = (rgb, css) => {
    targetColor = rgb;
    currentPhaseCss = css;
    document.documentElement.style.setProperty("--session-phase-color", css);
  };

  const setCountText = (text) => {
    if (text === lastCountdownText) return;
    lastCountdownText = text;
    phaseCountValue.textContent = text;
  };

  const appendStepSegment = (seconds, labelText) => {
    const step = el("div", "session-step");
    step.style.flexGrow = String(Math.max(1, seconds));
    const bar = el("div", "session-step-bar");
    bar.appendChild(el("div", "session-step-fill"));
    const label = el("div", "session-step-label");
    label.textContent = labelText;
    step.appendChild(bar);
    step.appendChild(label);
    steps.appendChild(step);
  };

  const petCompanionName = () => {
    const name = document.documentElement.dataset.petDisplayName;
    return typeof name === "string" && name.trim() ? name.trim() : "your pet";
  };

  const renderPhaseText = () => {
    if (!descriptor || !practice) return;
    if (runState === "complete") {
      phaseName.textContent = chromeText("complete");
      phaseGuidance.textContent = chromeText("completeGuidance");
      phaseCount.style.display = "none";
    } else if (runState === "countdown") {
      phaseName.textContent = chromeText("getReady");
      phaseGuidance.textContent = chromeText("getReadyGuidance");
      phaseCount.style.display = "";
    } else if (runState === "idle") {
      phaseName.textContent = descriptor.title;
      phaseGuidance.textContent = descriptor.subtitle ?? chromeText("idleGuidance");
      phaseCount.style.display = "none";
      practice.renderIdle();
    } else {
      const phase = practice.runningPhase();
      if (!phase) return;
      const paused = runState === "paused";
      phaseName.textContent = paused ? chromeText("paused") : phase.name;
      phaseGuidance.textContent = paused ? chromeText("pausedGuidance") : phase.guidance;
      phaseCount.style.display = paused ? "none" : "";
    }
    practice.renderPhaseDetails();
  };

  /** Dots/bar state, the count label, and the paw footer line. */
  const renderProgressMeta = () => {
    if (!descriptor || !practice) return;
    practice.renderProgressMeta();
    let footerText;
    if (runState === "complete") footerText = chromeText("footerComplete");
    else if (runState === "idle" || runState === "countdown") footerText = chromeText("footerReady");
    else footerText = chromeText(practice.footerActiveKey, { name: petCompanionName() });
    footer.textContent = `🐾  ${footerText}  🐾`;
  };

  const primaryButtonContent = () => {
    const custom = practice.primaryContent?.(runState);
    if (custom) return custom;
    if (runState === "countdown") return `${icons.play}<span>${escapeChromeText("startNow")}</span>`;
    if (runState === "active") return `${icons.pause}<span>${escapeChromeText("pause")}</span>`;
    if (runState === "paused") return `${icons.play}<span>${escapeChromeText("resume")}</span>`;
    if (runState === "complete") return `${icons.done}<span>${escapeChromeText("done")}</span>`;
    return `${icons.play}<span>${escapeChromeText("start")}</span>`;
  };

  const currentPracticeId = () => descriptor.practiceId ?? descriptor.kind;

  // --- Practice picker ---------------------------------------------------

  let practiceMenuOpen = false;

  const canSwitchPractice = () => {
    const practices = descriptor?.practices;
    return Boolean(practices && practices.length > 1 && (runState === "idle" || runState === "complete"));
  };

  const setPracticeMenuOpen = (open) => {
    practiceMenuOpen = open && canSwitchPractice();
    card.classList.toggle("is-practice-menu-open", practiceMenuOpen);
    headerSwitch.setAttribute("aria-expanded", practiceMenuOpen ? "true" : "false");
    if (practiceMenuOpen) renderPracticeMenu();
  };

  const renderPracticeMenu = () => {
    practiceMenu.textContent = "";
    const currentId = currentPracticeId();
    for (const choice of descriptor.practices ?? []) {
      const option = el("button", "session-practice-option");
      option.type = "button";
      option.setAttribute("role", "menuitemradio");
      const isCurrent = choice.id === currentId;
      option.setAttribute("aria-checked", isCurrent ? "true" : "false");
      option.classList.toggle("is-current", isCurrent);

      const icon = el("span", "session-practice-option-icon");
      icon.innerHTML = choice.iconPaths
        ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" aria-hidden="true">${choice.iconPaths}</svg>`
        : icons.leaf;
      const name = el("span", "session-practice-option-name");
      name.textContent = choice.name;
      const mark = el("span", "session-practice-option-mark");
      if (isCurrent) mark.innerHTML = icons.check;

      option.appendChild(icon);
      option.appendChild(name);
      option.appendChild(mark);
      option.addEventListener("click", () => {
        setPracticeMenuOpen(false);
        if (!isCurrent) sendSessionEvent({ type: "practiceSelected", practiceId: choice.id });
      });
      practiceMenu.appendChild(option);
    }
  };

  const renderPracticeSwitch = () => {
    const switchable = canSwitchPractice();
    headerSwitch.classList.toggle("is-switchable", switchable);
    headerSwitch.tabIndex = switchable ? 0 : -1;
    headerSwitch.setAttribute("aria-label", switchable ? chromeText("switchPractice") : "");
    headerChevron.style.display = switchable ? "" : "none";
    if (!switchable && practiceMenuOpen) setPracticeMenuOpen(false);
  };

  const renderAudioButton = () => {
    const available = Boolean(audioCues && audioCues.allowed && hasAnyCue());
    audioBtn.style.display = available ? "" : "none";
    if (!available) return;
    const muted = !audioCues.enabled;
    audioBtn.innerHTML = muted ? icons.volumeOff : icons.volumeOn;
    audioBtn.setAttribute("aria-label", chromeText(muted ? "unmute" : "mute"));
    audioBtn.setAttribute("title", chromeText(muted ? "unmute" : "mute"));
    audioBtn.setAttribute("aria-pressed", muted ? "true" : "false");
  };

  const renderStatics = () => {
    if (!descriptor || !practice) return;
    practice.renderStatics();

    renderAudioButton();
    closeBtn.setAttribute("aria-label", chromeText("close"));
    closeBtn.setAttribute("title", `${chromeText("close")} (Esc)`);
    infoBtn.setAttribute("aria-label", chromeText("about"));
    infoBtn.setAttribute("title", chromeText("about"));
    card.classList.toggle("is-complete", runState === "complete");
    primaryBtn.innerHTML = primaryButtonContent();
    // A practice may replace Restart (grounding shows Back): undefined keeps
    // the default, null hides the button, a string is the button content.
    const secondary = practice.secondaryContent?.(runState);
    if (secondary === undefined) {
      restartBtn.innerHTML = `${icons.restart}<span>${escapeChromeText(runState === "complete" ? "again" : "restart")}</span>`;
      restartBtn.style.display = runState === "idle" || runState === "countdown" ? "none" : "";
    } else {
      restartBtn.innerHTML = secondary ?? "";
      restartBtn.style.display = secondary ? "" : "none";
    }
    infoBtn.style.display = descriptor.info ? "" : "none";
    phaseCountUnit.textContent = practice.countUnit ?? "s";
    paceTile.icon.innerHTML = practice.paceIconSvg ?? icons.waveform;
    renderPracticeSwitch();

    renderProgressMeta();
    renderPhaseText();
    // Card contents can change its height across states, and the orb stack is
    // anchored to the card — re-measure after this render settles.
    scheduleSessionGeometry();
  };

  // --- Run control ---------------------------------------------------------

  const resetClock = () => {
    practice?.reset();
    lastCountdownText = "";
  };

  const eventProgress = () => practice.eventProgress();

  const completeRun = (completion) => {
    runState = "complete";
    stopCuePlayback();
    sendSessionEvent({ type: "completed", patternId: completion.patternId, cycles: completion.cycles });
    renderStatics();
  };

  const beginActiveRun = () => {
    if (!descriptor || !practice) return;
    resetClock();
    breathValue = Math.min(breathValue, 0.05);
    runState = "active";
    triggerPulse(performance.now() / 1000);
    renderStatics();
    practice.onBegin();
    sendSessionEvent({ type: "started", patternId: eventProgress().patternId });
  };

  const startRun = () => {
    if (!descriptor || !practice || !practice.canStart()) return;
    const countdownSeconds = Number(descriptor.countdownSeconds);
    if (Number.isFinite(countdownSeconds) && countdownSeconds > 0) {
      resetClock();
      runState = "countdown";
      countdownRemainingMs = countdownSeconds * 1000;
      renderStatics();
      return;
    }
    beginActiveRun();
  };

  const pauseRun = () => {
    if (practice.pausable === false) return;
    runState = "paused";
    stopCuePlayback();
    const progress = eventProgress();
    sendSessionEvent({ type: "paused", patternId: progress.patternId, cycle: progress.cycle });
    renderStatics();
  };

  const resumeRun = () => {
    runState = "active";
    const progress = eventProgress();
    sendSessionEvent({ type: "resumed", patternId: progress.patternId, cycle: progress.cycle });
    renderStatics();
  };

  const stopRun = () => {
    stopCuePlayback();
    const progress = eventProgress();
    sendSessionEvent({ type: "stopped", patternId: progress.patternId, cycle: progress.cycle });
    runState = "idle";
    resetClock();
    renderStatics();
  };

  /** Back to the idle card after a completed run (e.g. picking another pattern). */
  const returnToIdle = () => {
    runState = "idle";
    resetClock();
  };

  const dismissOverlay = () => {
    sendSessionEvent({ type: "dismissed" });
  };

  // --- Practices -----------------------------------------------------------

  const ui = {
    descriptor: () => descriptor,
    runState: () => runState,
    chromeText,
    escapeChromeText,
    completeRun,
    send: sendSessionEvent,
    playPhaseCue,
    stopCuePlayback,
    triggerPulse,
    setPhaseColor,
    setCountText,
    appendStepSegment,
    scheduleGeometry: scheduleSessionGeometry,
    renderStatics,
    renderPhaseText,
    renderProgressMeta,
    resetClock,
    returnToIdle,
    easeInOutSine,
    formatClock,
    formatSeconds,
    widgets: {
      topbarIcon: headerIcon,
      dotsBox,
      dotsBar,
      dotsBarFill,
      dotsCount,
      timerValue: timerTile.value,
      timerLabel: timerTile.label,
      lungsTile,
      lungsIcon,
      phaseWord,
      paceTile: paceTile.tile,
      paceValue: paceTile.value,
      paceLabel: paceTile.label,
      steps,
    },
  };

  const practiceViews = {
    breathing: createBreathingPractice(ui),
    pmr: createPmrPractice(ui),
    grounding: createGroundingPractice(ui),
  };

  const mountPractice = (next) => {
    if (practice === next) return;
    practice?.deactivate();
    practice = next;
    practiceRows.replaceChildren(...(next ? next.topRows : []));
  };

  // --- Frame loop ----------------------------------------------------------

  const frame = (now) => {
    rafHandle = null;
    if (!descriptor || !practice) return;
    const nowSeconds = now / 1000;
    const deltaMs = lastFrameAt > 0 ? Math.min(120, now - lastFrameAt) : 0;
    lastFrameAt = now;

    if (runState === "active") {
      const completion = practice.advance(deltaMs, nowSeconds);
      if (completion) completeRun(completion);
    }

    // Lead-in countdown before the first phase.
    if (runState === "countdown") {
      countdownRemainingMs -= deltaMs;
      if (countdownRemainingMs <= 0) {
        beginActiveRun();
      } else {
        setCountText(String(Math.max(1, Math.ceil(countdownRemainingMs / 1000))));
      }
    }

    const settlingToStart = runState === "countdown" && countdownRemainingMs < 1600;
    const breathTarget = practice.breathTarget(nowSeconds, settlingToStart);
    const smoothing = runState === "active" ? 0.16 : 0.05;
    breathValue += (breathTarget - breathValue) * smoothing;

    for (let channel = 0; channel < 3; channel += 1) {
      const target = runState === "active" ? targetColor[channel] : IDLE_COLOR[channel];
      currentColor[channel] += (target - currentColor[channel]) * 0.06;
    }

    practice.renderFrame(breathValue, currentPhaseCss);

    let energy = 1.0;
    if (runState === "paused") energy = 0.55;
    else if (runState === "idle") energy = 0.7;
    else if (runState === "countdown") energy = 0.8;
    orb.draw({
      radius: orbRadius,
      time: nowSeconds,
      breath: breathValue,
      energy,
      pulse: pulseStartedAt,
      tint: currentColor,
    });

    rafHandle = requestAnimationFrame(frame);
  };

  const startFrameLoop = () => {
    if (rafHandle === null) {
      lastFrameAt = 0;
      rafHandle = requestAnimationFrame(frame);
    }
  };

  const stopFrameLoop = () => {
    if (rafHandle !== null) {
      cancelAnimationFrame(rafHandle);
      rafHandle = null;
    }
  };

  // --- Controls ------------------------------------------------------------

  primaryBtn.addEventListener("click", () => {
    if (!descriptor || !practice) return;
    if (practice.onPrimary?.(runState)) return;
    if (runState === "active") pauseRun();
    else if (runState === "paused") resumeRun();
    else if (runState === "complete") dismissOverlay();
    else if (runState === "countdown") beginActiveRun();
    else startRun();
  });

  restartBtn.addEventListener("click", () => {
    if (!descriptor || !practice || runState === "idle") return;
    if (practice.onSecondary?.(runState)) return;
    startRun();
  });

  headerSwitch.addEventListener("click", () => {
    if (!descriptor || !canSwitchPractice()) return;
    setPracticeMenuOpen(!practiceMenuOpen);
  });

  document.addEventListener("mousedown", (event) => {
    if (!practiceMenuOpen || !(event.target instanceof Element)) return;
    if (practiceMenu.contains(event.target) || headerSwitch.contains(event.target)) return;
    setPracticeMenuOpen(false);
  });

  audioBtn.addEventListener("click", () => {
    if (!audioCues) return;
    audioCues.enabled = !audioCues.enabled;
    if (!audioCues.enabled) stopCuePlayback();
    renderAudioButton();
    sendSessionEvent({ type: "audioToggled", enabled: audioCues.enabled });
  });

  infoBtn.addEventListener("click", () => {
    if (!descriptor?.info) return;
    // The host opens the dedicated Info window in response.
    sendSessionEvent({ type: "infoOpened" });
  });

  closeBtn.addEventListener("click", dismissOverlay);

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !descriptor) return;
    // Escape closes the practice picker first, then the overlay.
    if (practiceMenuOpen) {
      setPracticeMenuOpen(false);
      return;
    }
    dismissOverlay();
  });

  // --- Descriptor intake ---------------------------------------------------

  const applyPayload = (payload) => {
    const isObject = payload && typeof payload === "object";
    if (isObject && payload.chrome && typeof payload.chrome === "object") {
      chromeStrings = { ...chromeFallback, ...payload.chrome };
    }
    applyAudioPayload(isObject ? payload.audio : null);

    const previous = descriptor;
    const next = isObject && payload.descriptor && typeof payload.descriptor === "object" ? payload.descriptor : null;
    const nextPractice = next ? practiceViews[next.kind] ?? null : null;
    descriptor = nextPractice ? next : null;

    if (!descriptor) {
      lastReportedHeight = 0;
      document.documentElement.dataset.sessionOpen = "false";
      runState = "idle";
      resetClock();
      stopFrameLoop();
      mountPractice(null);
      return;
    }

    document.documentElement.dataset.sessionOpen = "true";
    const practiceChanged = Boolean(
      previous && (previous.kind !== descriptor.kind || previous.practiceId !== descriptor.practiceId)
    );
    if (!previous || practiceChanged) {
      // A new practice opens at the host's estimate; always re-report.
      lastReportedHeight = 0;
      setPracticeMenuOpen(false);
      mountPractice(nextPractice);
      practice.enter(descriptor);
      runState = "idle";
      resetClock();
      renderStatics();
      startFrameLoop();
      if (descriptor.autoStart) startRun();
    } else {
      practice.update(descriptor);
    }
  };

  ipcRenderer.on("openpets:session-overlay", (_event, payload) => applyPayload(payload));

  // Plugin-driven controls (pet menu commands relayed through the host).
  ipcRenderer.on("openpets:session-overlay-control", (_event, action) => {
    if (!descriptor || !practice || !eventProgress().patternId) return;
    if (action === "pause" && runState === "active") pauseRun();
    else if (action === "resume" && runState === "paused") resumeRun();
    else if (action === "stop" && (runState === "active" || runState === "paused")) stopRun();
  });

  ipcRenderer
    .invoke("openpets:session-overlay-get")
    .then((existing) => {
      if (existing && !descriptor) applyPayload(existing);
    })
    .catch(() => {});
}

module.exports = { installDefaultPetSession };
