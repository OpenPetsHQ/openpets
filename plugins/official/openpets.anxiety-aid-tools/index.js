// Anxiety Aid Tools (openpets.anxiety-aid-tools) — SDK v3 calm practices.
//
// The OpenPets companion of https://anxietyaidtools.com/. Supports simple
// breathing (Calm 4-6), guided breathing (box, 4-7-8, energizing, quick
// reset), progressive muscle relaxation (PMR), and 5-4-3-2-1 grounding: the host
// renders the session overlay (night-sky orb, step track, bottom card) around
// the pet and a dedicated Info window from the declarative descriptor below;
// this plugin owns patterns and steps, the localized knowledge layer (how it
// works, the science with linked studies, tips), practice switching, and
// pet-menu session controls.

export const SITE_URL = "https://anxietyaidtools.com/";

export const MENU_PAUSE = "breathing-pause";
export const MENU_RESUME = "breathing-resume";
export const MENU_STOP = "breathing-stop";
export const MENU_PMR_PAUSE = "pmr-pause";
export const MENU_PMR_RESUME = "pmr-resume";
export const MENU_PMR_STOP = "pmr-stop";
export const MENU_GROUNDING_STOP = "grounding-stop";

export const STORAGE_KEY_AUDIO_CUES = "audioCues";
export const STORAGE_KEY_LAST_PRACTICE = "lastPractice";
export const STORAGE_KEY_LAST_GUIDED_PATTERN = "lastGuidedPattern";

export const PRACTICE_IDS = ["breathing", "guided-breathing", "pmr", "grounding"];

/** 5-4-3-2-1 grounding senses (AAT grounding), in countdown order. */
export const GROUNDING_SENSES = [
  { id: "see", icon: "eye", items: 5 },
  { id: "touch", icon: "hand", items: 4 },
  { id: "hear", icon: "ear", items: 3 },
  { id: "smell", icon: "flower", items: 2 },
  { id: "taste", icon: "coffee", items: 1 },
];

/** Guided breathing patterns (AAT guided breathing). Holds say which way the lungs are. */
export const GUIDED_PATTERNS = [
  { id: "box", cycles: 8, phases: [["in", 4], ["hold-full", 4], ["out", 4], ["hold-empty", 4]] },
  { id: "calming", cycles: 4, phases: [["in", 4], ["hold-full", 7], ["out-long", 8]] },
  { id: "energizing", cycles: 8, phases: [["in", 4], ["hold-full", 4], ["out", 6]] },
  { id: "quick", cycles: 6, phases: [["in", 3], ["hold-full", 3], ["out", 3]] },
];
export const GUIDED_PATTERN_IDS = GUIDED_PATTERNS.map((pattern) => pattern.id);

export const PMR_GROUP_IDS = [
  "right-hand",
  "left-hand",
  "right-arm",
  "left-arm",
  "forehead",
  "face",
  "jaw",
  "neck",
  "shoulders",
  "upper-back",
  "abdomen",
  "lower-back",
  "hips",
  "right-thigh",
  "left-thigh",
  "right-calf",
  "left-calf",
  "right-foot",
  "left-foot",
];

/** Bullet counts per group. Arms have four tense steps; everything else has three. */
export const PMR_CUE_COUNTS = {
  "right-hand": { tense: 3, release: 3 },
  "left-hand": { tense: 3, release: 3 },
  "right-arm": { tense: 4, release: 3 },
  "left-arm": { tense: 4, release: 3 },
  forehead: { tense: 3, release: 3 },
  face: { tense: 3, release: 3 },
  jaw: { tense: 3, release: 3 },
  neck: { tense: 3, release: 3 },
  shoulders: { tense: 3, release: 3 },
  "upper-back": { tense: 3, release: 3 },
  abdomen: { tense: 3, release: 3 },
  "lower-back": { tense: 3, release: 3 },
  hips: { tense: 3, release: 3 },
  "right-thigh": { tense: 3, release: 3 },
  "left-thigh": { tense: 3, release: 3 },
  "right-calf": { tense: 3, release: 3 },
  "left-calf": { tense: 3, release: 3 },
  "right-foot": { tense: 3, release: 3 },
  "left-foot": { tense: 3, release: 3 },
};

function cueLines(t, id, phase, count) {
  const lines = [];
  for (let index = 1; index <= count; index += 1) {
    lines.push(t(`pmr.group.${id}.${phase}.${index}`));
  }
  return lines;
}

export const CITATIONS = [
  {
    label: "Ma X. et al. (2017). The Effect of Diaphragmatic Breathing on Attention, Negative Affect and Stress in Healthy Adults. Frontiers in Psychology, 8:874.",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC5455070/",
  },
  {
    label: "Zaccaro A. et al. (2018). How Breath-Control Can Change Your Life: A Systematic Review on Psycho-Physiological Correlates of Slow Breathing. Frontiers in Human Neuroscience, 12:353.",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC6137615/",
  },
  {
    label: "Russo M.A., Santarelli D.M., O'Rourke D. (2017). The physiological effects of slow breathing in the healthy human. Breathe, 13(4):298-309.",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC5709795/",
  },
  {
    label: "Systematic review: breathing retraining across 16 studies in panic disorder and agoraphobia.",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC9954474/",
  },
  {
    label: "Controlled trial: guided deep-breathing exercise and anxiety in hospitalized patients (DASS-21).",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC11535222/",
  },
  {
    label: "Clinical study: three months of daily regulated breathing practice in generalized anxiety disorder (BAI).",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC8989478/",
  },
];

export const PMR_CITATIONS = [
  {
    label: "Liu K. et al. (2020). Positive effects of a progressive muscle relaxation program on depression and sleep quality in patients with COVID-19. Complement Ther Clin Pract, 39:101132.",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC7102525/",
  },
  {
    label: "Randomized controlled trial (2022): progressive muscle relaxation significantly reduced anxiety scores on DASS-21 in nurses in high-stress settings.",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC10844009/",
  },
  {
    label: "Ghafari S. et al. (2014). Effectiveness of progressive muscle relaxation on test anxiety among nursing students. J Educ Health Promot, 3:117.",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC4280725/",
  },
  {
    label: "Merakou K. et al. (2022). Progressive muscle relaxation training for anxiety reduction in nursing students during clinical practice. Int J Environ Res Public Health, 19(8):4873.",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC9047807/",
  },
];

export const GROUNDING_CITATIONS = [
  {
    label: "Li L. et al. (2025). Mindful energy balance exercise protocol as an adjunctive intervention for pediatric Tourette syndrome: a randomized controlled trial. Scientific Reports.",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC12550066/",
  },
  {
    label: "Palmer D.D.G. et al. (2023). Outcomes of an Integrated Multidisciplinary Clinic for People with Functional Neurological Disorder. Movement Disorders Clinical Practice.",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC10272915/",
  },
  {
    label: "Myers L. et al. (2021). Using evidence-based psychotherapy to tailor treatment for patients with functional neurological disorders. Epilepsy & Behavior Reports.",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC8515382/",
  },
];

export function buildCalmPattern(t) {
  return {
    id: "calm",
    name: t("pattern.name"),
    hint: t("pattern.hint"),
    phases: [
      { kind: "in", seconds: 4, label: t("phase.in.label") },
      { kind: "out", seconds: 6, label: t("phase.out.label") },
    ],
    cycles: 10,
  };
}

function guidedPhase(t, step, seconds) {
  if (step === "in") return { kind: "in", seconds, label: t("phase.in.label") };
  if (step === "out") return { kind: "out", seconds, label: t("phase.out.label") };
  if (step === "out-long") return { kind: "out", seconds, label: t("guided.phase.outLong") };
  if (step === "hold-full") return { kind: "hold", seconds, label: t("guided.phase.holdFull") };
  return { kind: "hold", seconds, label: t("guided.phase.holdEmpty") };
}

export function buildGuidedPatterns(t) {
  return GUIDED_PATTERNS.map((pattern) => ({
    id: pattern.id,
    name: t(`guided.pattern.${pattern.id}.name`),
    hint: t(`guided.pattern.${pattern.id}.hint`),
    phases: pattern.phases.map(([step, seconds]) => guidedPhase(t, step, seconds)),
    cycles: pattern.cycles,
  }));
}

export function buildPractices(t) {
  return [
    { id: "breathing", name: t("practice.breathing"), icon: "leaf" },
    { id: "guided-breathing", name: t("practice.guided"), icon: "timer" },
    { id: "pmr", name: t("practice.pmr"), icon: "person-standing" },
    { id: "grounding", name: t("practice.grounding"), icon: "anchor" },
  ];
}

export function buildGroundingSteps(t) {
  return GROUNDING_SENSES.map((sense) => {
    const items = [];
    for (let index = 1; index <= sense.items; index += 1) {
      items.push({
        text: t(`grounding.${sense.id}.item${index}.text`),
        guidance: t(`grounding.${sense.id}.item${index}.guidance`),
      });
    }
    return {
      id: sense.id,
      label: t(`grounding.${sense.id}.label`),
      title: t(`grounding.${sense.id}.title`),
      prompt: t(`grounding.${sense.id}.prompt`),
      icon: sense.icon,
      items,
    };
  });
}

export function buildPmrSteps(ctx) {
  const t = typeof ctx === "function" ? ctx : (key) => ctx.t(key);
  const assets = typeof ctx === "function" ? undefined : ctx?.assets;
  const svg = assets?.svg ? (name) => assets.svg(name) : (name) => ({ kind: "svg", name });
  const tenseLabel = t("pmr.phase.tense");
  const releaseLabel = t("pmr.phase.release");
  return PMR_GROUP_IDS.map((id) => {
    const counts = PMR_CUE_COUNTS[id];
    const tenseCues = cueLines(t, id, "tense", counts.tense);
    const releaseCues = cueLines(t, id, "release", counts.release);
    return {
      id,
      name: t(`pmr.group.${id}.name`),
      tenseSeconds: 10,
      releaseSeconds: 10,
      tenseLabel,
      releaseLabel,
      tenseCues,
      releaseCues,
      tenseCue: tenseCues[0],
      releaseCue: releaseCues[0],
      tenseIllustration: svg(`pmr-${id}-tense`),
      releaseIllustration: svg(`pmr-${id}-release`),
    };
  });
}

export function buildSessionInfo(t, logo) {
  return {
    intro: t("info.intro"),
    sections: [
      {
        heading: t("info.how.heading"),
        body: t("info.how.body"),
        cards: [
          { title: t("info.how.card1.title"), body: t("info.how.card1.body"), icon: "activity" },
          { title: t("info.how.card2.title"), body: t("info.how.card2.body"), icon: "wind" },
          { title: t("info.how.card3.title"), body: t("info.how.card3.body"), icon: "trending-down" },
        ],
      },
      {
        heading: t("info.science.heading"),
        body: t("info.science.body"),
        cards: [
          { title: t("info.science.card1.title"), body: t("info.science.card1.body"), icon: "heart-pulse", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC11535222/" },
          { title: t("info.science.card2.title"), body: t("info.science.card2.body"), icon: "shield-check", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC9954474/" },
          { title: t("info.science.card3.title"), body: t("info.science.card3.body"), icon: "brain", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC8989478/" },
        ],
      },
      {
        heading: t("info.when.heading"),
        items: [t("info.when.item1"), t("info.when.item2"), t("info.when.item3"), t("info.when.item4")],
      },
      {
        heading: t("info.notice.heading"),
        items: [t("info.notice.item1"), t("info.notice.item2"), t("info.notice.item3"), t("info.notice.item4")],
      },
      {
        heading: t("info.tips.heading"),
        cards: [
          { title: t("info.tips.card1.title"), body: t("info.tips.card1.body"), icon: "person-standing" },
          { title: t("info.tips.card2.title"), body: t("info.tips.card2.body"), icon: "armchair" },
          { title: t("info.tips.card3.title"), body: t("info.tips.card3.body"), icon: "calendar-check" },
        ],
      },
    ],
    citations: CITATIONS,
    disclaimer: t("info.disclaimer"),
    site: { label: t("info.site.label"), url: SITE_URL },
    ...(logo ? { logo } : {}),
  };
}

const GUIDED_PATTERN_ICONS = { box: "square", calming: "moon", energizing: "zap", quick: "timer" };

/**
 * Guided breathing Info: every pattern as a card (the selected one marked, as
 * on AAT's guided breathing page), then the shared breathing knowledge.
 */
export function buildGuidedInfo(t, logo, patternId) {
  const patternCards = GUIDED_PATTERN_IDS.map((id) => ({
    title: t(`guided.pattern.${id}.heading`),
    body: t(`guided.pattern.${id}.body`),
    detail: t(`guided.pattern.${id}.detail`),
    icon: GUIDED_PATTERN_ICONS[id],
    ...(id === patternId ? { highlighted: true } : {}),
  }));
  return {
    intro: t("guided.info.intro"),
    sections: [
      {
        heading: t("guided.info.patterns.heading"),
        body: t("guided.info.patterns.body"),
        cards: patternCards,
      },
      {
        heading: t("info.how.heading"),
        body: t("guided.info.how.body"),
        cards: [
          { title: t("guided.info.how.card1.title"), body: t("guided.info.how.card1.body"), icon: "activity" },
          { title: t("guided.info.how.card2.title"), body: t("guided.info.how.card2.body"), icon: "timer" },
          { title: t("guided.info.how.card3.title"), body: t("guided.info.how.card3.body"), icon: "brain" },
        ],
      },
      {
        heading: t("info.science.heading"),
        body: t("info.science.body"),
        cards: [
          { title: t("info.science.card1.title"), body: t("info.science.card1.body"), icon: "heart-pulse", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC11535222/" },
          { title: t("info.science.card2.title"), body: t("info.science.card2.body"), icon: "shield-check", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC9954474/" },
          { title: t("info.science.card3.title"), body: t("info.science.card3.body"), icon: "brain", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC8989478/" },
        ],
      },
      {
        heading: t("info.when.heading"),
        items: [t("guided.info.when.item1"), t("guided.info.when.item2"), t("guided.info.when.item3"), t("guided.info.when.item4")],
      },
      {
        heading: t("info.notice.heading"),
        items: [t("info.notice.item1"), t("info.notice.item2"), t("info.notice.item3"), t("info.notice.item4")],
      },
      {
        heading: t("info.tips.heading"),
        cards: [
          { title: t("guided.info.tips.card1.title"), body: t("guided.info.tips.card1.body"), icon: "calendar-check" },
          { title: t("guided.info.tips.card2.title"), body: t("guided.info.tips.card2.body"), icon: "armchair" },
          { title: t("guided.info.tips.card3.title"), body: t("guided.info.tips.card3.body"), icon: "shield-check" },
        ],
      },
    ],
    citations: CITATIONS,
    disclaimer: t("guided.info.disclaimer"),
    site: { label: t("info.site.label"), url: SITE_URL },
    ...(logo ? { logo } : {}),
  };
}

/**
 * Grounding Info. The science section says plainly that the evidence covers
 * sensory grounding inside wider programs, not 5-4-3-2-1 alone.
 */
export function buildGroundingInfo(t, logo) {
  return {
    intro: t("grounding.info.intro"),
    sections: [
      {
        heading: t("info.how.heading"),
        body: t("grounding.info.how.body"),
        cards: [
          { title: t("grounding.info.how.card1.title"), body: t("grounding.info.how.card1.body"), icon: "eye" },
          { title: t("grounding.info.how.card2.title"), body: t("grounding.info.how.card2.body"), icon: "brain" },
          { title: t("grounding.info.how.card3.title"), body: t("grounding.info.how.card3.body"), icon: "anchor" },
        ],
      },
      {
        heading: t("info.science.heading"),
        body: t("grounding.info.science.body"),
        cards: [
          { title: t("grounding.info.science.card1.title"), body: t("grounding.info.science.card1.body"), icon: "heart-pulse", url: GROUNDING_CITATIONS[0].url },
          { title: t("grounding.info.science.card2.title"), body: t("grounding.info.science.card2.body"), icon: "activity", url: GROUNDING_CITATIONS[1].url },
          { title: t("grounding.info.science.card3.title"), body: t("grounding.info.science.card3.body"), icon: "shield-check", url: GROUNDING_CITATIONS[2].url },
        ],
      },
      {
        heading: t("info.when.heading"),
        items: [t("grounding.info.when.item1"), t("grounding.info.when.item2"), t("grounding.info.when.item3"), t("grounding.info.when.item4")],
      },
      {
        heading: t("info.notice.heading"),
        items: [t("grounding.info.notice.item1"), t("grounding.info.notice.item2"), t("grounding.info.notice.item3"), t("grounding.info.notice.item4")],
      },
      {
        heading: t("info.tips.heading"),
        cards: [
          { title: t("grounding.info.tips.card1.title"), body: t("grounding.info.tips.card1.body"), icon: "timer" },
          { title: t("grounding.info.tips.card2.title"), body: t("grounding.info.tips.card2.body"), icon: "eye" },
          { title: t("grounding.info.tips.card3.title"), body: t("grounding.info.tips.card3.body"), icon: "anchor" },
        ],
      },
    ],
    citations: GROUNDING_CITATIONS,
    disclaimer: t("grounding.info.disclaimer"),
    site: { label: t("info.site.label"), url: SITE_URL },
    ...(logo ? { logo } : {}),
  };
}

export function buildPmrInfo(t, logo) {
  return {
    intro: t("pmr.info.intro"),
    sections: [
      {
        heading: t("pmr.info.how.heading"),
        body: t("pmr.info.how.body"),
        cards: [
          { title: t("pmr.info.how.card1.title"), body: t("pmr.info.how.card1.body"), icon: "activity" },
          { title: t("pmr.info.how.card2.title"), body: t("pmr.info.how.card2.body"), icon: "shield-check" },
          { title: t("pmr.info.how.card3.title"), body: t("pmr.info.how.card3.body"), icon: "person-standing" },
        ],
      },
      {
        heading: t("pmr.info.science.heading"),
        body: t("pmr.info.science.body"),
        cards: [
          { title: t("pmr.info.science.card1.title"), body: t("pmr.info.science.card1.body"), icon: "heart-pulse", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC7102525/" },
          { title: t("pmr.info.science.card2.title"), body: t("pmr.info.science.card2.body"), icon: "shield-check", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC10844009/" },
          { title: t("pmr.info.science.card3.title"), body: t("pmr.info.science.card3.body"), icon: "brain", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC9047807/" },
        ],
      },
      {
        heading: t("pmr.info.when.heading"),
        items: [t("pmr.info.when.item1"), t("pmr.info.when.item2"), t("pmr.info.when.item3"), t("pmr.info.when.item4")],
      },
      {
        heading: t("pmr.info.notice.heading"),
        items: [t("pmr.info.notice.item1"), t("pmr.info.notice.item2"), t("pmr.info.notice.item3"), t("pmr.info.notice.item4")],
      },
      {
        heading: t("pmr.info.tips.heading"),
        cards: [
          { title: t("pmr.info.tips.card1.title"), body: t("pmr.info.tips.card1.body"), icon: "armchair" },
          { title: t("pmr.info.tips.card2.title"), body: t("pmr.info.tips.card2.body"), icon: "activity" },
          { title: t("pmr.info.tips.card3.title"), body: t("pmr.info.tips.card3.body"), icon: "calendar-check" },
        ],
      },
    ],
    citations: PMR_CITATIONS,
    disclaimer: t("pmr.info.disclaimer"),
    site: { label: t("info.site.label"), url: SITE_URL },
    ...(logo ? { logo } : {}),
  };
}

export function buildBreathingDescriptor(ctx, autoStart, audioCuesEnabled) {
  const t = (key) => ctx.t(key);
  return {
    kind: "breathing",
    title: t("session.title"),
    subtitle: t("session.subtitle"),
    patterns: [buildCalmPattern(t)],
    patternId: "calm",
    autoStart,
    info: buildSessionInfo(t, ctx.assets.svg("logo")),
    audio: {
      inhale: ctx.assets.sound("breath-in"),
      exhale: ctx.assets.sound("breath-out"),
      enabled: audioCuesEnabled !== false,
    },
    practices: buildPractices(t),
    practiceId: "breathing",
  };
}

export function buildGuidedDescriptor(ctx, autoStart, audioCuesEnabled, patternId = GUIDED_PATTERN_IDS[0]) {
  const t = (key) => ctx.t(key);
  const selected = GUIDED_PATTERN_IDS.includes(patternId) ? patternId : GUIDED_PATTERN_IDS[0];
  return {
    kind: "breathing",
    title: t("guided.session.title"),
    subtitle: t("guided.session.subtitle"),
    patterns: buildGuidedPatterns(t),
    patternId: selected,
    autoStart,
    info: buildGuidedInfo(t, ctx.assets.svg("logo"), selected),
    audio: {
      inhale: ctx.assets.sound("breath-in"),
      exhale: ctx.assets.sound("breath-out"),
      enabled: audioCuesEnabled !== false,
    },
    practices: buildPractices(t),
    practiceId: "guided-breathing",
  };
}

export function buildGroundingDescriptor(ctx, autoStart) {
  const t = (key) => ctx.t(key);
  return {
    kind: "grounding",
    title: t("grounding.session.title"),
    subtitle: t("grounding.session.subtitle"),
    steps: buildGroundingSteps(t),
    autoStart,
    // Self-paced: the first sense is the calm start, no lead-in countdown.
    countdownSeconds: 0,
    info: buildGroundingInfo(t, ctx.assets.svg("logo")),
    practices: buildPractices(t),
    practiceId: "grounding",
  };
}

export function buildPmrDescriptor(ctx, autoStart) {
  const t = (key) => ctx.t(key);
  return {
    kind: "pmr",
    title: t("pmr.session.title"),
    subtitle: t("pmr.session.subtitle"),
    steps: buildPmrSteps(ctx),
    autoStart,
    info: buildPmrInfo(t, ctx.assets.svg("logo")),
    practices: buildPractices(t),
    practiceId: "pmr",
  };
}

export function buildDescriptor(ctx, autoStart, audioCuesEnabled, practiceId = "breathing", guidedPatternId) {
  if (practiceId === "pmr") {
    return buildPmrDescriptor(ctx, autoStart);
  }
  if (practiceId === "guided-breathing") {
    return buildGuidedDescriptor(ctx, autoStart, audioCuesEnabled, guidedPatternId);
  }
  if (practiceId === "grounding") {
    return buildGroundingDescriptor(ctx, autoStart);
  }
  return buildBreathingDescriptor(ctx, autoStart, audioCuesEnabled);
}

/** Pet-menu items per practice. Grounding is self-paced, so it only offers Stop. */
function sessionMenuItems(ctx, mode, practiceId) {
  if (mode === "none") return [];
  if (practiceId === "grounding") {
    return [{ id: MENU_GROUNDING_STOP, title: ctx.t("menu.grounding.stop") }];
  }
  const isPmr = practiceId === "pmr";
  const stop = { id: isPmr ? MENU_PMR_STOP : MENU_STOP, title: ctx.t(isPmr ? "menu.pmr.stop" : "menu.stop") };
  if (mode === "paused") {
    return [{ id: isPmr ? MENU_PMR_RESUME : MENU_RESUME, title: ctx.t(isPmr ? "menu.pmr.resume" : "menu.resume") }, stop];
  }
  return [{ id: isPmr ? MENU_PMR_PAUSE : MENU_PAUSE, title: ctx.t(isPmr ? "menu.pmr.pause" : "menu.pause") }, stop];
}

async function setSessionMenu(ctx, mode, practiceId = "breathing") {
  try {
    await ctx.ui.menu.setItems(sessionMenuItems(ctx, mode, practiceId));
  } catch (error) {
    ctx.log.warn("session menu update failed", { reason: String(error && error.message ? error.message : error) });
  }
}

/** Remember the picked guided pattern and mark it in Info. */
async function selectGuidedPattern(ctx, session, patternId) {
  if (!GUIDED_PATTERN_IDS.includes(patternId)) return;
  await ctx.storage.set(STORAGE_KEY_LAST_GUIDED_PATTERN, patternId).catch(() => undefined);
  const t = (key) => ctx.t(key);
  try {
    await session.update({ patternId, info: buildGuidedInfo(t, ctx.assets.svg("logo"), patternId) });
  } catch (error) {
    ctx.log.warn("guided pattern info update failed", { patternId, reason: String(error && error.message ? error.message : error) });
  }
}

async function openSession(ctx, state, autoStart, requestedPracticeId) {
  let practiceId = requestedPracticeId;
  if (!practiceId) {
    const stored = await ctx.storage.get(STORAGE_KEY_LAST_PRACTICE);
    practiceId = PRACTICE_IDS.includes(stored) ? stored : "breathing";
  }
  await ctx.storage.set(STORAGE_KEY_LAST_PRACTICE, practiceId).catch(() => undefined);

  const audioCuesEnabled = (await ctx.storage.get(STORAGE_KEY_AUDIO_CUES)) !== false;
  const guidedPatternId = practiceId === "guided-breathing"
    ? await ctx.storage.get(STORAGE_KEY_LAST_GUIDED_PATTERN)
    : undefined;
  const descriptor = buildDescriptor(ctx, autoStart, audioCuesEnabled, practiceId, guidedPatternId);

  const session = await ctx.ui.session(descriptor);
  state.session = session;
  state.practiceId = practiceId;

  session.onEvent((event) => {
    if (!event || state.session !== session) return;
    if (event.type === "started" || event.type === "resumed") {
      void setSessionMenu(ctx, "running", practiceId);
    } else if (event.type === "paused") {
      void setSessionMenu(ctx, "paused", practiceId);
    } else if (event.type === "completed") {
      void setSessionMenu(ctx, "none");
    } else if (event.type === "patternChanged" && practiceId === "guided-breathing") {
      void selectGuidedPattern(ctx, session, event.patternId);
    } else if (event.type === "audioToggled") {
      void ctx.storage.set(STORAGE_KEY_AUDIO_CUES, event.enabled).catch(() => undefined);
    } else if (event.type === "practiceSelected") {
      void openSession(ctx, state, false, event.practiceId);
    } else if (event.type === "stopped") {
      if (state.session === session && event.reason !== "replaced") {
        state.session = null;
        void setSessionMenu(ctx, "none");
      }
    }
  });
}

export function register(OpenPetsPlugin) {
  OpenPetsPlugin.register({
    async start(ctx) {
      const state = { session: null, practiceId: "breathing" };
      await ctx.commands.register(
        {
          id: "open-anxiety-aid-tools",
          title: "$t:command.open.title",
          description: "$t:command.open.description",
        },
        () => openSession(ctx, state, false),
      );
      await ctx.commands.register(
        {
          id: "start-breathing",
          title: "$t:command.start.title",
          description: "$t:command.start.description",
        },
        () => openSession(ctx, state, true, "breathing"),
      );
      await ctx.commands.register(
        {
          id: "start-guided-breathing",
          title: "$t:command.startGuided.title",
          description: "$t:command.startGuided.description",
        },
        () => openSession(ctx, state, true, "guided-breathing"),
      );
      await ctx.commands.register(
        {
          id: "start-pmr",
          title: "$t:command.startPmr.title",
          description: "$t:command.startPmr.description",
        },
        () => openSession(ctx, state, true, "pmr"),
      );
      await ctx.commands.register(
        {
          id: "start-grounding",
          title: "$t:command.startGrounding.title",
          description: "$t:command.startGrounding.description",
        },
        () => openSession(ctx, state, true, "grounding"),
      );
      ctx.ui.menu.onSelect((id) => {
        const session = state.session;
        if (!session) return;
        if (id === MENU_PAUSE || id === MENU_PMR_PAUSE) void session.pause().catch(() => undefined);
        else if (id === MENU_RESUME || id === MENU_PMR_RESUME) void session.resume().catch(() => undefined);
        else if (id === MENU_STOP || id === MENU_PMR_STOP || id === MENU_GROUNDING_STOP) void session.stop().catch(() => undefined);
      });
    },
    async stop() {},
  });
}

export default register;
