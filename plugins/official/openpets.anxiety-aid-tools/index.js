// Anxiety Aid Tools (openpets.anxiety-aid-tools) — SDK v3 calm practices.
//
// The OpenPets companion of https://anxietyaidtools.com/. The first practice
// is simple breathing (Calm 4-6): the host renders the session overlay (orb,
// phase ring, step track) around the pet and a dedicated Info window from the
// declarative descriptor below; this plugin owns the pattern, the localized
// knowledge layer (how it works, the science with linked studies, tips), and
// the pet-menu session controls.

export const SITE_URL = "https://anxietyaidtools.com/";

const MENU_PAUSE = "breathing-pause";
const MENU_RESUME = "breathing-resume";
const MENU_STOP = "breathing-stop";

const CITATIONS = [
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

export const STORAGE_KEY_AUDIO_CUES = "audioCues";

export function buildDescriptor(ctx, autoStart, audioCuesEnabled) {
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
  };
}

async function setSessionMenu(ctx, mode) {
  const items = mode === "running"
    ? [
      { id: MENU_PAUSE, title: ctx.t("menu.pause") },
      { id: MENU_STOP, title: ctx.t("menu.stop") },
    ]
    : mode === "paused"
      ? [
        { id: MENU_RESUME, title: ctx.t("menu.resume") },
        { id: MENU_STOP, title: ctx.t("menu.stop") },
      ]
      : [];
  try {
    await ctx.ui.menu.setItems(items);
  } catch (error) {
    ctx.log.warn("session menu update failed", { reason: String(error && error.message ? error.message : error) });
  }
}

async function openSession(ctx, state, autoStart) {
  const audioCuesEnabled = (await ctx.storage.get(STORAGE_KEY_AUDIO_CUES)) !== false;
  const session = await ctx.ui.session(buildDescriptor(ctx, autoStart, audioCuesEnabled));
  state.session = session;
  session.onEvent((event) => {
    if (!event || state.session !== session) return;
    if (event.type === "started" || event.type === "resumed") {
      void setSessionMenu(ctx, "running");
    } else if (event.type === "paused") {
      void setSessionMenu(ctx, "paused");
    } else if (event.type === "completed") {
      void setSessionMenu(ctx, "none");
    } else if (event.type === "audioToggled") {
      void ctx.storage.set(STORAGE_KEY_AUDIO_CUES, event.enabled).catch(() => undefined);
    } else if (event.type === "stopped") {
      state.session = null;
      void setSessionMenu(ctx, "none");
    }
  });
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
      ctx.ui.menu.onSelect((id) => {
        const session = state.session;
        if (!session) return;
        if (id === MENU_PAUSE) void session.pause().catch(() => undefined);
        else if (id === MENU_RESUME) void session.resume().catch(() => undefined);
        else if (id === MENU_STOP) void session.stop().catch(() => undefined);
      });
    },
    async stop() {},
  });
}

export default register;
