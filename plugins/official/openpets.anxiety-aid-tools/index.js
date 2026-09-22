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
export const MENU_MEDITATION_PAUSE = "meditation-pause";
export const MENU_MEDITATION_RESUME = "meditation-resume";
export const MENU_MEDITATION_STOP = "meditation-stop";
export const MENU_VISUALIZATION_PAUSE = "visualization-pause";
export const MENU_VISUALIZATION_RESUME = "visualization-resume";
export const MENU_VISUALIZATION_STOP = "visualization-stop";

const MENU_PAUSE_IDS = new Set([MENU_PAUSE, MENU_PMR_PAUSE, MENU_MEDITATION_PAUSE, MENU_VISUALIZATION_PAUSE]);
const MENU_RESUME_IDS = new Set([MENU_RESUME, MENU_PMR_RESUME, MENU_MEDITATION_RESUME, MENU_VISUALIZATION_RESUME]);
const MENU_STOP_IDS = new Set([MENU_STOP, MENU_PMR_STOP, MENU_GROUNDING_STOP, MENU_MEDITATION_STOP, MENU_VISUALIZATION_STOP]);

export const STORAGE_KEY_AUDIO_CUES = "audioCues";
export const STORAGE_KEY_LAST_GUIDED_PATTERN = "lastGuidedPattern";
export const STORAGE_KEY_LAST_MEDITATION = "lastMeditation";
export const STORAGE_KEY_LAST_VISUALIZATION = "lastVisualization";

export const PRACTICE_IDS = ["breathing", "guided-breathing", "pmr", "grounding", "meditation", "visualization"];

/** Narration lives on AAT's R2; the host downloads and caches each segment. */
export const MEDIA_ORIGIN = "https://r2.anxietyaidtools.com";

/** AAT guided meditation sessions, grouped as on the website. */
export const MEDITATION_SESSIONS = [
  { id: "physiological-sigh-reset", category: "anxiety", group: "grounded", segments: 7 },
  { id: "structural-realignment-protocol", category: "anxiety", group: "grounded", segments: 13 },
  { id: "vagus-nerve-delta-descent", category: "sleep", group: "grounded", segments: 14 },
  { id: "kinetic-grounding-sequence", category: "walking", group: "grounded", segments: 10 },
  { id: "hypnagogic-induction-sequence", category: "sleep", group: "grounded", segments: 13 },
  { id: "oceanic-consciousness-projection", category: "mindfulness", group: "spiritual", segments: 12 },
  { id: "infinite-horizon-projection", category: "mindfulness", group: "spiritual", segments: 11 },
  { id: "metta-loving-kindness-protocol", category: "mindfulness", group: "spiritual", segments: 12 },
];
export const MEDITATION_IDS = MEDITATION_SESSIONS.map((session) => session.id);

/** AAT peaceful visualization scenes; each is seven narrated steps. */
export const VISUALIZATION_SCENES = [
  "mountainPeakSunrise",
  "tranquilForestGrove",
  "peacefulOceanBeach",
  "sereneGardenParadise",
  "starlitMeadowNight",
  "cozyRainyCabin",
  "mistyLakesideDawn",
  "sunlitDesertOasis",
  "floatingCloudSanctuary",
];
const VISUALIZATION_STEPS = 7;

/**
 * AAT records narration in en, es, pt, and zh (and languages OpenPets does not
 * ship). Other host locales hear English with translated captions.
 */
export function narrationLanguage(locale) {
  const value = String(locale || "en").toLowerCase();
  if (value.startsWith("es")) return "es";
  if (value.startsWith("pt")) return "pt";
  if (value.startsWith("zh")) return "zh";
  return "en";
}

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

/**
 * Guided patterns with the AAT cue pair timed to each: the inhale cue runs
 * through the hold after it, the exhale cue through the hold after that.
 */
export function buildGuidedPatterns(t, assets) {
  const sound = assets?.sound ? (name) => assets.sound(name) : (name) => ({ kind: "sound", name });
  return GUIDED_PATTERNS.map((pattern) => ({
    id: pattern.id,
    name: t(`guided.pattern.${pattern.id}.name`),
    hint: t(`guided.pattern.${pattern.id}.hint`),
    phases: pattern.phases.map(([step, seconds]) => guidedPhase(t, step, seconds)),
    cycles: pattern.cycles,
    cues: {
      inhale: sound(`guided-${pattern.id}-in`),
      exhale: sound(`guided-${pattern.id}-out`),
    },
  }));
}

export function buildPractices(t) {
  return [
    { id: "breathing", name: t("practice.breathing"), icon: "leaf" },
    { id: "guided-breathing", name: t("practice.guided"), icon: "timer" },
    { id: "pmr", name: t("practice.pmr"), icon: "person-standing" },
    { id: "grounding", name: t("practice.grounding"), icon: "anchor" },
    { id: "meditation", name: t("practice.meditation"), icon: "headphones" },
    { id: "visualization", name: t("practice.visualization"), icon: "sparkles" },
  ];
}

export function buildVisualizationTracks(t, locale) {
  const language = narrationLanguage(locale);
  return VISUALIZATION_SCENES.map((scene) => {
    const segments = [];
    for (let index = 1; index <= VISUALIZATION_STEPS; index += 1) {
      segments.push({
        audioUrl: `${MEDIA_ORIGIN}/peaceful-visualization/${language}/${scene}/${String(index).padStart(2, "0")}.mp3`,
        caption: t(`visualization.${scene}.caption${index}`),
      });
    }
    return {
      id: scene,
      title: t(`visualization.${scene}.title`),
      subtitle: t(`visualization.${scene}.subtitle`),
      segments,
    };
  });
}

export function buildMeditationTracks(t, locale, assets) {
  const image = assets?.image ? (name) => assets.image(name) : (name) => ({ kind: "image", name });
  const language = narrationLanguage(locale);
  return MEDITATION_SESSIONS.map((session) => {
    const segments = [];
    for (let index = 1; index <= session.segments; index += 1) {
      const file = String(index).padStart(2, "0");
      segments.push({
        audioUrl: `${MEDIA_ORIGIN}/guided-meditation/${language}/${session.id}/${file}.mp3`,
        caption: t(`meditation.${session.id}.caption${index}`),
      });
    }
    return {
      id: session.id,
      title: t(`meditation.${session.id}.title`),
      subtitle: t(`meditation.category.${session.category}`),
      cover: image(`meditation-${session.id}`),
      segments,
    };
  });
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

export const MEDITATION_CITATIONS = [
  {
    label: "Goyal M. et al. (2014). Meditation programs for psychological stress and well-being: a systematic review and meta-analysis. JAMA Internal Medicine, 174(3):357–368.",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC4142584/",
  },
  {
    label: "Hofmann S.G. et al. (2010). The effect of mindfulness-based therapy on anxiety and depression: a meta-analytic review. Journal of Consulting and Clinical Psychology, 78(2):169–183.",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC2848393/",
  },
  {
    label: "Hofmann S.G., Grossman P., Hinton D.E. (2011). Loving-kindness and compassion meditation: potential for psychological interventions. Clinical Psychology Review, 31(7):1126–1132.",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC3176989/",
  },
];

export const VISUALIZATION_CITATIONS = [
  {
    label: "Parizad N. et al. (2021). Effect of guided imagery on anxiety, muscle pain, and vital signs in patients with COVID-19: a randomized controlled trial. Complementary Therapies in Clinical Practice, 43:101335.",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC7982304/",
  },
  {
    label: "Forward J.B. et al. (2015). Effect of structured touch and guided imagery for pain and anxiety in elective joint replacement patients: a randomized controlled trial. The Permanente Journal, 19(4):18–28.",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC4625990/",
  },
  {
    label: "Kumari D., Patil J. (2023). Guided imagery for anxiety disorder: therapeutic efficacy and changes in quality of life. Industrial Psychiatry Journal, 32(Suppl 1):S191–S195.",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC10871407/",
  },
];

export function buildVisualizationInfo(t, logo) {
  return {
    intro: t("visualization.info.intro"),
    sections: [
      {
        heading: t("info.how.heading"),
        body: t("visualization.info.how.body"),
        cards: [
          { title: t("visualization.info.how.card1.title"), body: t("visualization.info.how.card1.body"), icon: "leaf" },
          { title: t("visualization.info.how.card2.title"), body: t("visualization.info.how.card2.body"), icon: "sparkles" },
          { title: t("visualization.info.how.card3.title"), body: t("visualization.info.how.card3.body"), icon: "calendar-check" },
        ],
      },
      {
        heading: t("info.science.heading"),
        body: t("visualization.info.science.body"),
        cards: [
          { title: t("visualization.info.science.card1.title"), body: t("visualization.info.science.card1.body"), icon: "heart-pulse", url: VISUALIZATION_CITATIONS[0].url },
          { title: t("visualization.info.science.card2.title"), body: t("visualization.info.science.card2.body"), icon: "activity", url: VISUALIZATION_CITATIONS[1].url },
          { title: t("visualization.info.science.card3.title"), body: t("visualization.info.science.card3.body"), icon: "brain", url: VISUALIZATION_CITATIONS[2].url },
        ],
      },
      {
        heading: t("info.when.heading"),
        items: [t("visualization.info.when.item1"), t("visualization.info.when.item2"), t("visualization.info.when.item3"), t("visualization.info.when.item4")],
      },
      {
        heading: t("info.tips.heading"),
        cards: [
          { title: t("visualization.info.tips.card1.title"), body: t("visualization.info.tips.card1.body"), icon: "headphones" },
          { title: t("visualization.info.tips.card2.title"), body: t("visualization.info.tips.card2.body"), icon: "eye" },
          { title: t("visualization.info.tips.card3.title"), body: t("visualization.info.tips.card3.body"), icon: "anchor" },
        ],
      },
    ],
    citations: VISUALIZATION_CITATIONS,
    disclaimer: t("visualization.info.disclaimer"),
    site: { label: t("info.site.label"), url: SITE_URL },
    ...(logo ? { logo } : {}),
  };
}

/** Meditation Info: the sessions (current one marked), then the shared knowledge. */
export function buildMeditationInfo(t, logo, trackId) {
  const sessionCards = (group) => MEDITATION_SESSIONS
    .filter((session) => session.group === group)
    .map((session) => ({
      title: t(`meditation.${session.id}.title`),
      body: t(`meditation.${session.id}.about`),
      detail: t(`meditation.category.${session.category}`),
      icon: session.group === "grounded" ? "leaf" : "sparkles",
      ...(session.id === trackId ? { highlighted: true } : {}),
    }));
  return {
    intro: t("meditation.info.intro"),
    sections: [
      { heading: t("meditation.info.grounded.heading"), cards: sessionCards("grounded") },
      { heading: t("meditation.info.spiritual.heading"), cards: sessionCards("spiritual") },
      {
        heading: t("info.how.heading"),
        body: t("meditation.info.how.body"),
        cards: [
          { title: t("meditation.info.how.card1.title"), body: t("meditation.info.how.card1.body"), icon: "headphones" },
          { title: t("meditation.info.how.card2.title"), body: t("meditation.info.how.card2.body"), icon: "heart-pulse" },
          { title: t("meditation.info.how.card3.title"), body: t("meditation.info.how.card3.body"), icon: "brain" },
        ],
      },
      {
        heading: t("info.science.heading"),
        body: t("meditation.info.science.body"),
        cards: [
          { title: t("meditation.info.science.card1.title"), body: t("meditation.info.science.card1.body"), icon: "activity", url: MEDITATION_CITATIONS[0].url },
          { title: t("meditation.info.science.card2.title"), body: t("meditation.info.science.card2.body"), icon: "shield-check", url: MEDITATION_CITATIONS[1].url },
          { title: t("meditation.info.science.card3.title"), body: t("meditation.info.science.card3.body"), icon: "sparkles", url: MEDITATION_CITATIONS[2].url },
        ],
      },
      {
        heading: t("info.when.heading"),
        items: [t("meditation.info.when.item1"), t("meditation.info.when.item2"), t("meditation.info.when.item3"), t("meditation.info.when.item4")],
      },
      {
        heading: t("info.tips.heading"),
        cards: [
          { title: t("meditation.info.tips.card1.title"), body: t("meditation.info.tips.card1.body"), icon: "headphones" },
          { title: t("meditation.info.tips.card2.title"), body: t("meditation.info.tips.card2.body"), icon: "armchair" },
          { title: t("meditation.info.tips.card3.title"), body: t("meditation.info.tips.card3.body"), icon: "calendar-check" },
        ],
      },
    ],
    citations: MEDITATION_CITATIONS,
    disclaimer: t("meditation.info.disclaimer"),
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
    patterns: buildGuidedPatterns(t, ctx.assets),
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

export function buildMeditationDescriptor(ctx, autoStart, trackId = MEDITATION_IDS[0]) {
  const t = (key) => ctx.t(key);
  const selected = MEDITATION_IDS.includes(trackId) ? trackId : MEDITATION_IDS[0];
  const locale = ctx.locale ?? "en";
  const englishForOtherLocale = narrationLanguage(locale) === "en" && !String(locale).toLowerCase().startsWith("en");
  return {
    kind: "player",
    title: t("meditation.session.title"),
    subtitle: t("meditation.session.subtitle"),
    tracks: buildMeditationTracks(t, locale, ctx.assets),
    trackId: selected,
    autoStart,
    countdownSeconds: 3,
    segmentGapSeconds: 1.5,
    ...(englishForOtherLocale ? { narrationNote: t("meditation.narrationNote") } : {}),
    info: buildMeditationInfo(t, ctx.assets.svg("logo"), selected),
    practices: buildPractices(t),
    practiceId: "meditation",
  };
}

export function buildVisualizationDescriptor(ctx, autoStart, trackId = VISUALIZATION_SCENES[0]) {
  const t = (key) => ctx.t(key);
  const selected = VISUALIZATION_SCENES.includes(trackId) ? trackId : VISUALIZATION_SCENES[0];
  const locale = ctx.locale ?? "en";
  const englishForOtherLocale = narrationLanguage(locale) === "en" && !String(locale).toLowerCase().startsWith("en");
  return {
    kind: "player",
    title: t("visualization.session.title"),
    subtitle: t("visualization.session.subtitle"),
    tracks: buildVisualizationTracks(t, locale),
    trackId: selected,
    autoStart,
    countdownSeconds: 3,
    segmentGapSeconds: 1.5,
    ...(englishForOtherLocale ? { narrationNote: t("meditation.narrationNote") } : {}),
    info: buildVisualizationInfo(t, ctx.assets.svg("logo")),
    practices: buildPractices(t),
    practiceId: "visualization",
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

/** `selectionId` is the remembered pattern (guided breathing) or track (meditation). */
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
  if (practiceId === "meditation") {
    return buildMeditationDescriptor(ctx, autoStart, guidedPatternId);
  }
  if (practiceId === "visualization") {
    return buildVisualizationDescriptor(ctx, autoStart, guidedPatternId);
  }
  return buildBreathingDescriptor(ctx, autoStart, audioCuesEnabled);
}

/** Pet-menu items per practice. Grounding is self-paced, so it only offers Stop. */
function sessionMenuItems(ctx, mode, practiceId) {
  if (mode === "none") return [];
  if (practiceId === "grounding") {
    return [{ id: MENU_GROUNDING_STOP, title: ctx.t("menu.grounding.stop") }];
  }
  if (practiceId === "meditation") {
    const stopItem = { id: MENU_MEDITATION_STOP, title: ctx.t("menu.meditation.stop") };
    if (mode === "paused") return [{ id: MENU_MEDITATION_RESUME, title: ctx.t("menu.meditation.resume") }, stopItem];
    return [{ id: MENU_MEDITATION_PAUSE, title: ctx.t("menu.meditation.pause") }, stopItem];
  }
  if (practiceId === "visualization") {
    const stopItem = { id: MENU_VISUALIZATION_STOP, title: ctx.t("menu.visualization.stop") };
    if (mode === "paused") return [{ id: MENU_VISUALIZATION_RESUME, title: ctx.t("menu.visualization.resume") }, stopItem];
    return [{ id: MENU_VISUALIZATION_PAUSE, title: ctx.t("menu.visualization.pause") }, stopItem];
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

/** Remember the picked meditation and mark it in Info. */
async function selectMeditation(ctx, session, trackId) {
  if (!MEDITATION_IDS.includes(trackId)) return;
  await ctx.storage.set(STORAGE_KEY_LAST_MEDITATION, trackId).catch(() => undefined);
  const t = (key) => ctx.t(key);
  try {
    await session.update({ info: buildMeditationInfo(t, ctx.assets.svg("logo"), trackId) });
  } catch (error) {
    ctx.log.warn("meditation info update failed", { trackId, reason: String(error && error.message ? error.message : error) });
  }
}

async function openSession(ctx, state, autoStart, practiceId) {
  const audioCuesEnabled = (await ctx.storage.get(STORAGE_KEY_AUDIO_CUES)) !== false;
  let guidedPatternId;
  if (practiceId === "guided-breathing") guidedPatternId = await ctx.storage.get(STORAGE_KEY_LAST_GUIDED_PATTERN);
  else if (practiceId === "meditation") guidedPatternId = await ctx.storage.get(STORAGE_KEY_LAST_MEDITATION);
  else if (practiceId === "visualization") guidedPatternId = await ctx.storage.get(STORAGE_KEY_LAST_VISUALIZATION);
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
    } else if (event.type === "patternChanged" && practiceId === "meditation") {
      void selectMeditation(ctx, session, event.patternId);
    } else if (event.type === "patternChanged" && practiceId === "visualization" && VISUALIZATION_SCENES.includes(event.patternId)) {
      void ctx.storage.set(STORAGE_KEY_LAST_VISUALIZATION, event.patternId).catch(() => undefined);
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
          id: "start-breathing",
          title: "$t:practice.breathing",
          description: "$t:command.start.description",
        },
        () => openSession(ctx, state, true, "breathing"),
      );
      await ctx.commands.register(
        {
          id: "start-guided-breathing",
          title: "$t:practice.guided",
          description: "$t:command.startGuided.description",
        },
        () => openSession(ctx, state, true, "guided-breathing"),
      );
      await ctx.commands.register(
        {
          id: "start-pmr",
          title: "$t:practice.pmr",
          description: "$t:command.startPmr.description",
        },
        () => openSession(ctx, state, true, "pmr"),
      );
      await ctx.commands.register(
        {
          id: "start-grounding",
          title: "$t:practice.grounding",
          description: "$t:command.startGrounding.description",
        },
        () => openSession(ctx, state, true, "grounding"),
      );
      await ctx.commands.register(
        {
          id: "start-meditation",
          title: "$t:practice.meditation",
          description: "$t:command.startMeditation.description",
        },
        () => openSession(ctx, state, true, "meditation"),
      );
      await ctx.commands.register(
        {
          id: "start-visualization",
          title: "$t:practice.visualization",
          description: "$t:command.startVisualization.description",
        },
        () => openSession(ctx, state, true, "visualization"),
      );
      ctx.ui.menu.onSelect((id) => {
        const session = state.session;
        if (!session) return;
        if (MENU_PAUSE_IDS.has(id)) void session.pause().catch(() => undefined);
        else if (MENU_RESUME_IDS.has(id)) void session.resume().catch(() => undefined);
        else if (MENU_STOP_IDS.has(id)) void session.stop().catch(() => undefined);
      });
    },
    async stop() {},
  });
}

export default register;
