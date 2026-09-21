// Anxiety Aid Tools (openpets.anxiety-aid-tools) — SDK v3 calm practices.
//
// The OpenPets companion of https://anxietyaidtools.com/. The first practice
// is breathing: the host renders the session overlay (orb, phase ring, step
// track, Info sheet) around the pet from the declarative descriptor below;
// this plugin owns the patterns, the knowledge layer, and last-used state.

export const STORAGE_KEY_LAST_PATTERN = "lastPatternId";
export const SITE_URL = "https://anxietyaidtools.com/";

export const BREATH_PATTERNS = [
  {
    id: "calm",
    name: "Calm 4-6",
    hint: "longer exhale",
    phases: [
      { kind: "in", seconds: 4, label: "Breathe in slowly" },
      { kind: "out", seconds: 6, label: "Breathe out slowly" },
    ],
    cycles: 10,
  },
  {
    id: "box",
    name: "Box",
    hint: "focus under pressure",
    phases: [
      { kind: "in", seconds: 4, label: "Breathe in" },
      { kind: "hold", seconds: 4, label: "Hold, lungs full" },
      { kind: "out", seconds: 4, label: "Breathe out" },
      { kind: "hold", seconds: 4, label: "Hold, lungs empty" },
    ],
    cycles: 8,
  },
  {
    id: "fourSevenEight",
    name: "4-7-8",
    hint: "wind-down",
    phases: [
      { kind: "in", seconds: 4, label: "Breathe in through the nose" },
      { kind: "hold", seconds: 7, label: "Hold gently" },
      { kind: "out", seconds: 8, label: "Breathe out through the mouth" },
    ],
    cycles: 6,
  },
  {
    id: "energizing",
    name: "Energizing",
    hint: "midday reset",
    phases: [
      { kind: "in", seconds: 4, label: "Breathe in fully" },
      { kind: "hold", seconds: 4, label: "Hold briefly" },
      { kind: "out", seconds: 6, label: "Release slowly" },
    ],
    cycles: 8,
  },
  {
    id: "quickReset",
    name: "Quick Reset",
    hint: "about a minute",
    phases: [
      { kind: "in", seconds: 3, label: "Breathe in" },
      { kind: "hold", seconds: 3, label: "Hold" },
      { kind: "out", seconds: 3, label: "Breathe out" },
    ],
    cycles: 7,
  },
];

const SHARED_CITATIONS = [
  {
    label: "Zaccaro A. et al. (2018). How Breath-Control Can Change Your Life: A Systematic Review on Psycho-Physiological Correlates of Slow Breathing. Frontiers in Human Neuroscience, 12:353.",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC6137615/",
  },
  {
    label: "Russo M.A., Santarelli D.M., O'Rourke D. (2017). The physiological effects of slow breathing in the healthy human. Breathe, 13(4):298-309.",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC5709795/",
  },
  {
    label: "Ma X. et al. (2017). The Effect of Diaphragmatic Breathing on Attention, Negative Affect and Stress in Healthy Adults. Frontiers in Psychology, 8:874.",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC5455070/",
  },
  {
    label: "Lehrer P.M., Gevirtz R. (2014). Heart rate variability biofeedback: how and why does it work? Frontiers in Psychology, 5:756.",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC4104929/",
  },
];

const DISCLAIMER = "These exercises support everyday calm. They are not therapy and do not treat anxiety disorders or any medical condition. If a breathing exercise ever feels uncomfortable or makes you dizzy, stop and let your breath return to normal.";

const PATTERN_INFO = {
  calm: {
    focus: "Calm 4-6 breathes in for four seconds and out for six. The exhale is deliberately longer than the inhale: a long, slow out-breath is the fastest reliable lever on the body's calming reflexes, which is why this is the default pattern.",
    science: "Slow breathing around six breaths per minute increases vagal (parasympathetic) activity and heart-rate variability, and reviews report reduced arousal and anxiety symptoms after even short practices. Exhalation is when the vagus nerve slows the heart, so extending the out-breath amplifies the effect.",
    when: "Use it whenever you notice tension building — before a meeting, after a hard message, between tasks. Most people feel their shoulders drop within the first three or four cycles; the full ten cycles take under two minutes.",
  },
  box: {
    focus: "Box breathing moves through four equal sides: in, hold, out, hold, four seconds each. The even rhythm gives a racing mind a simple structure to hold on to, which is why it is taught for performing under pressure.",
    science: "The brief holds slow the overall breath rate to roughly four breaths per minute, well inside the slow-breathing range shown to raise heart-rate variability and steady attention. The counting itself also works as an anchoring task that interrupts spiralling thoughts.",
    when: "Reach for Box when you need focus rather than sleep: before a presentation, during a stressful review, when your thoughts race. If the four-second holds feel strained, drop to three seconds — the evenness matters more than the length.",
  },
  fourSevenEight: {
    focus: "4-7-8 breathes in for four, holds for seven, and releases for a long eight-second exhale. Popularised by Dr. Andrew Weil from pranayama practice, it is the most sedating pattern in this set.",
    science: "The exhale is twice as long as the inhale, which strongly favours the parasympathetic side of the nervous system, and the extended hold lets carbon dioxide rise slightly, deepening the sense of release on the out-breath. It shares the physiology of the slow-breathing studies cited below.",
    when: "Best in the evening or before sleep, or after an acute stress spike. The long hold takes practice — if seven seconds feels like straining, start with in 3, hold 5, out 6 as a custom pattern and work up.",
  },
  energizing: {
    focus: "Energizing keeps a full four-second inhale and a short hold, then releases over six. It is a reset rather than a sedative: enough slow-breathing physiology to clear tension, brisk enough to leave you alert.",
    science: "Short breath-holds after the inhale briefly raise oxygen saturation of attention-related brain regions, while the six-second exhale keeps the pattern inside the calming slow-breathing range. Studies of brief daily breathing practice report better sustained attention and lower cortisol.",
    when: "Use it mid-afternoon instead of another coffee, between deep-work blocks, or before switching to a task that needs fresh focus. Eight cycles take about two minutes.",
  },
  quickReset: {
    focus: "Quick Reset is the smallest useful practice: three seconds in, three held, three out, seven times. It exists so that 'I don't have time' is never true — the whole session is about a minute.",
    science: "Even one minute of paced breathing measurably slows heart rate and shifts breathing from the chest toward the diaphragm. The benefit compounds with repetition across the day more than with session length.",
    when: "Between meetings, after a jarring notification, in a queue, before answering a difficult message. If you only remember one pattern in a stressful moment, this is the one to remember.",
  },
};

export function buildSessionInfo(patternId) {
  const info = PATTERN_INFO[patternId] ?? PATTERN_INFO.calm;
  return {
    intro: "A short, guided breathing practice. Follow the orb: it grows as you breathe in and settles as you breathe out. You do not need to read any of this to start.",
    sections: [
      { heading: "This pattern", body: info.focus },
      { heading: "The science", body: info.science },
      { heading: "When to practice", body: info.when },
      {
        heading: "Tips",
        body: "Breathe through your nose if you can, into the belly rather than the chest. Let the shoulders stay heavy. If you lose the rhythm, just rejoin on the next inhale — there is no wrong way to do this.",
      },
    ],
    citations: SHARED_CITATIONS,
    disclaimer: DISCLAIMER,
    site: { label: "Anxiety Aid Tools", url: SITE_URL },
  };
}

export function resolvePatternId(storedValue) {
  return BREATH_PATTERNS.some((pattern) => pattern.id === storedValue) ? storedValue : "calm";
}

function buildDescriptor(patternId, autoStart) {
  return {
    kind: "breathing",
    title: "Breathing",
    subtitle: "Anxiety Aid Tools",
    patterns: BREATH_PATTERNS,
    patternId,
    autoStart,
    info: buildSessionInfo(patternId),
  };
}

async function openSession(ctx, state, autoStart) {
  const stored = await ctx.storage.get(STORAGE_KEY_LAST_PATTERN);
  const patternId = resolvePatternId(stored);
  const session = await ctx.ui.session(buildDescriptor(patternId, autoStart));
  state.session = session;
  session.onEvent((event) => {
    void handleSessionEvent(ctx, state, session, event);
  });
}

async function handleSessionEvent(ctx, state, session, event) {
  if (!event || state.session !== session) return;
  if (event.type === "patternChanged") {
    try {
      await ctx.storage.set(STORAGE_KEY_LAST_PATTERN, event.patternId);
      await session.update({ info: buildSessionInfo(event.patternId) });
    } catch (error) {
      ctx.log.warn("pattern change handling failed", { reason: String(error && error.message ? error.message : error) });
    }
    return;
  }
  if (event.type === "started") {
    try {
      await ctx.storage.set(STORAGE_KEY_LAST_PATTERN, event.patternId);
    } catch (error) {
      ctx.log.warn("last pattern save failed", { reason: String(error && error.message ? error.message : error) });
    }
  }
  if (event.type === "stopped" && state.session === session) {
    state.session = null;
  }
}

export function register(OpenPetsPlugin) {
  OpenPetsPlugin.register({
    async start(ctx) {
      const state = { session: null };
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
        () => openSession(ctx, state, true),
      );
    },
    async stop() {},
  });
}

export default register;
