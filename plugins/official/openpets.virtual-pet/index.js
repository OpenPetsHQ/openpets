// Virtual Pet (openpets.virtual-pet) — SDK v3 Virtual Pet companion.

export const SCHEDULE_ID = "virtual-pet-tick";

const pinnedBubbles = new WeakMap();

function getPinnedBubble(ctx) {
  return pinnedBubbles.get(ctx) ?? null;
}

function setPinnedBubble(ctx, handle) {
  if (handle) pinnedBubbles.set(ctx, handle);
  else pinnedBubbles.delete(ctx);
}

export function cleanState(state = {}) {
  const current = state && typeof state === "object" ? state : {};
  const careCounts = current.careCounts && typeof current.careCounts === "object" ? current.careCounts : {};
  return {
    hunger: typeof current.hunger === "number" ? Math.max(0, Math.min(100, current.hunger)) : 80,
    energy: typeof current.energy === "number" ? Math.max(0, Math.min(100, current.energy)) : 80,
    happiness: typeof current.happiness === "number" ? Math.max(0, Math.min(100, current.happiness)) : 80,
    affection: typeof current.affection === "number" ? Math.max(0, Math.min(100, current.affection)) : 50,
    level: typeof current.level === "number" ? Math.max(1, current.level) : 1,
    xp: typeof current.xp === "number" ? Math.max(0, current.xp) : 0,
    careCounts: {
      fed: typeof careCounts.fed === "number" ? careCounts.fed : 0,
      played: typeof careCounts.played === "number" ? careCounts.played : 0,
      petted: typeof careCounts.petted === "number" ? careCounts.petted : 0,
      napped: typeof careCounts.napped === "number" ? careCounts.napped : 0,
    },
    lastSeenAt: typeof current.lastSeenAt === "number" ? current.lastSeenAt : 0,
    lastNudgeAt: typeof current.lastNudgeAt === "number" ? current.lastNudgeAt : 0,
    sleptUntil: typeof current.sleptUntil === "number" ? current.sleptUntil : 0,
    lastActionAt: typeof current.lastActionAt === "number" ? current.lastActionAt : 0,
  };
}

export function getMood(state, now) {
  if (now < state.sleptUntil) {
    return "sleeping";
  }
  if (state.hunger < 30) {
    return "hungry";
  }
  if (state.energy < 30) {
    return "tired";
  }
  if (state.happiness < 30) {
    return "bored";
  }
  if ((state.hunger + state.energy + state.happiness + state.affection) / 4 >= 75) {
    return "happy";
  }
  return "content";
}

function wakeUpIfSleeping(state, now) {
  if (state.sleptUntil > now) {
    return { ...state, sleptUntil: 0 };
  }
  return state;
}

export function addXp(state, amount) {
  let xp = state.xp + amount;
  let level = state.level;
  let leveledUp = false;
  while (xp >= level * 50) {
    xp -= level * 50;
    level += 1;
    leveledUp = true;
  }
  return { xp, level, leveledUp };
}

export function applyDecay(state, elapsedMs, now) {
  const lastSeen = state.lastSeenAt || now;
  
  let sleepMs = 0;
  if (state.sleptUntil > lastSeen) {
    const sleepEnd = Math.min(state.sleptUntil, now);
    sleepMs = sleepEnd - lastSeen;
  }
  const wakeMs = Math.max(0, elapsedMs - sleepMs);
  
  const sleepHours = sleepMs / 3600000;
  const wakeHours = wakeMs / 3600000;
  
  // Stats decay per hour: hunger (-2), energy (-3), happiness (-2), affection (-1)
  // During sleep: hunger (-2), energy reacts (+15), happiness (-0.5), affection stays same
  const newHunger = state.hunger - wakeHours * 2 - sleepHours * 2;
  const newEnergy = state.energy - wakeHours * 3 + sleepHours * 15;
  const newHappiness = state.happiness - wakeHours * 2 - sleepHours * 0.5;
  const newAffection = state.affection - wakeHours * 1;
  
  return {
    ...state,
    hunger: Math.max(0, Math.min(100, newHunger)),
    energy: Math.max(0, Math.min(100, newEnergy)),
    happiness: Math.max(0, Math.min(100, newHappiness)),
    affection: Math.max(0, Math.min(100, newAffection)),
  };
}

async function playActionSound(ctx) {
  try {
    const cfg = (await ctx.config.get()) ?? {};
    if (cfg.sound) {
      await ctx.audio.play(cfg.sound);
    }
  } catch {}
}

export async function updatePinned(ctx, state, now = Date.now()) {
  let showStats = true;
  try {
    const cfg = (await ctx.config.get()) ?? {};
    if (cfg.showStats === false) showStats = false;
  } catch {}

  if (!showStats) {
    const pinned = getPinnedBubble(ctx);
    if (pinned) {
      try { await pinned.dismiss(); } catch {}
      setPinnedBubble(ctx, null);
    }
    return;
  }

  const spec = {
    tone: "info",
    sticky: true,
    pin: true,
    dismissOn: [],
    priority: "normal",
    hud: {
      items: [
        { icon: "food", value: state.hunger, tone: "amber", label: ctx.t("hud.food") },
        { icon: "zap", value: state.energy, tone: "blue", label: ctx.t("hud.energy") },
        { icon: "play", value: state.happiness, tone: "green", label: ctx.t("hud.play") },
        { icon: "heart", value: state.affection, tone: "pink", label: ctx.t("hud.bond") },
      ],
    },
  };
  
  const pinnedBubble = getPinnedBubble(ctx);
  if (pinnedBubble) {
    try {
      await pinnedBubble.update(spec);
      return;
    } catch {
      setPinnedBubble(ctx, null);
    }
  }
  
  try {
    const nextBubble = await ctx.ui.bubble(spec);
    nextBubble.onDismiss(() => {
      if (getPinnedBubble(ctx)?.id === nextBubble.id) {
        setPinnedBubble(ctx, null);
      }
    });
    setPinnedBubble(ctx, nextBubble);
  } catch {}
}

export async function maybeNudge(ctx, state, now = Date.now()) {
  const isHungry = state.hunger < 30;
  const isTired = state.energy < 30;
  const isBored = state.happiness < 30;
  const isNeglected = state.affection < 30;
  
  if (isHungry || isTired || isBored || isNeglected) {
    const nudgeCooldown = 6 * 3600_000;
    if (state.lastNudgeAt === 0 || now - state.lastNudgeAt >= nudgeCooldown) {
      state.lastNudgeAt = now;
      await ctx.storage.set("state", state);
      
      let speechKey = "nudge.neglected";
      if (isHungry) speechKey = "nudge.hungry";
      else if (isTired) speechKey = "nudge.tired";
      else if (isBored) speechKey = "nudge.bored";
      else if (isNeglected) speechKey = "nudge.neglected";
      
      try {
        await ctx.pet.speak(ctx.t(speechKey));
      } catch {}
    }
  }
}

async function scheduleNextTick(ctx, now = Date.now()) {
  try {
    await ctx.schedule.cancel(SCHEDULE_ID);
    // Check/tick every 15 minutes.
    const checkInterval = 15 * 60_000;
    await ctx.schedule.once(SCHEDULE_ID, checkInterval, () => reconcile(ctx));
  } catch {}
}

export async function feed(ctx, now = Date.now(), { speak = true } = {}) {
  const state = cleanState(await ctx.storage.get("state"));
  const cleanActive = wakeUpIfSleeping(state, now);
  
  const hunger = Math.min(100, cleanActive.hunger + 25);
  const xpInfo = addXp(cleanActive, 5);
  const careCounts = { ...cleanActive.careCounts, fed: cleanActive.careCounts.fed + 1 };
  
  const newState = {
    ...cleanActive,
    hunger,
    xp: xpInfo.xp,
    level: xpInfo.level,
    careCounts,
    lastActionAt: now,
    lastSeenAt: now,
  };
  
  await ctx.storage.set("state", newState);
  await playActionSound(ctx);

  try {
    await ctx.pet.react("celebrating", { showMessage: false });
    if (speak) {
      if (xpInfo.leveledUp) {
        await ctx.pet.speak(ctx.t("speech.levelup"));
      } else {
        const idx = Math.floor(Math.random() * 4);
        await ctx.pet.speak(ctx.t(`speech.feed.${idx}`));
      }
    }
  } catch {}
  
  await updatePinned(ctx, newState, now);
  return newState;
}

export async function play(ctx, now = Date.now(), { speak = true } = {}) {
  const state = cleanState(await ctx.storage.get("state"));
  const cleanActive = wakeUpIfSleeping(state, now);
  
  const happiness = Math.min(100, cleanActive.happiness + 25);
  const energy = Math.max(0, cleanActive.energy - 15);
  const xpInfo = addXp(cleanActive, 5);
  const careCounts = { ...cleanActive.careCounts, played: cleanActive.careCounts.played + 1 };
  
  const newState = {
    ...cleanActive,
    happiness,
    energy,
    xp: xpInfo.xp,
    level: xpInfo.level,
    careCounts,
    lastActionAt: now,
    lastSeenAt: now,
  };
  
  await ctx.storage.set("state", newState);
  await playActionSound(ctx);

  try {
    await ctx.pet.react("celebrating", { showMessage: false });
    if (speak) {
      if (xpInfo.leveledUp) {
        await ctx.pet.speak(ctx.t("speech.levelup"));
      } else {
        const idx = Math.floor(Math.random() * 4);
        await ctx.pet.speak(ctx.t(`speech.play.${idx}`));
      }
    }
  } catch {}
  
  await updatePinned(ctx, newState, now);
  return newState;
}

export async function pet(ctx, now = Date.now(), { speak = true } = {}) {
  const state = cleanState(await ctx.storage.get("state"));
  const cleanActive = wakeUpIfSleeping(state, now);
  
  const affection = Math.min(100, cleanActive.affection + 15);
  const happiness = Math.min(100, cleanActive.happiness + 10);
  const xpInfo = addXp(cleanActive, 3);
  const careCounts = { ...cleanActive.careCounts, petted: cleanActive.careCounts.petted + 1 };
  
  const newState = {
    ...cleanActive,
    affection,
    happiness,
    xp: xpInfo.xp,
    level: xpInfo.level,
    careCounts,
    lastActionAt: now,
    lastSeenAt: now,
  };
  
  await ctx.storage.set("state", newState);
  await playActionSound(ctx);

  try {
    await ctx.pet.react("waving", { showMessage: false });
    if (speak) {
      if (xpInfo.leveledUp) {
        await ctx.pet.speak(ctx.t("speech.levelup"));
      } else {
        const idx = Math.floor(Math.random() * 4);
        await ctx.pet.speak(ctx.t(`speech.pet.${idx}`));
      }
    }
  } catch {}
  
  await updatePinned(ctx, newState, now);
  return newState;
}

export async function nap(ctx, now = Date.now(), { speak = true } = {}) {
  const state = cleanState(await ctx.storage.get("state"));
  
  const energy = Math.min(100, state.energy + 40);
  const sleptUntil = now + 15 * 60_000;
  const xpInfo = addXp(state, 5);
  const careCounts = { ...state.careCounts, napped: state.careCounts.napped + 1 };
  
  const newState = {
    ...state,
    energy,
    sleptUntil,
    xp: xpInfo.xp,
    level: xpInfo.level,
    careCounts,
    lastActionAt: now,
    lastSeenAt: now,
  };
  
  await ctx.storage.set("state", newState);
  await playActionSound(ctx);

  try {
    await ctx.pet.react("waiting", { showMessage: false });
    if (speak) {
      if (xpInfo.leveledUp) {
        await ctx.pet.speak(ctx.t("speech.levelup"));
      } else {
        const idx = Math.floor(Math.random() * 4);
        await ctx.pet.speak(ctx.t(`speech.nap.${idx}`));
      }
    }
  } catch {}
  
  await updatePinned(ctx, newState, now);
  return newState;
}

export async function showStatus(ctx, now = Date.now(), { speak = true } = {}) {
  const state = cleanState(await ctx.storage.get("state"));
  await updatePinned(ctx, state, now);
  
  const mood = getMood(state, now);
  if (speak) {
    try {
      await ctx.pet.speak(ctx.t(`speech.status.${mood}`));
    } catch {}
  }
  return state;
}

export async function reconcile(ctx, now = Date.now()) {
  const rawState = await ctx.storage.get("state");
  const state = cleanState(rawState);
  
  let updatedState;
  if (state.lastSeenAt > 0) {
    const elapsedMs = Math.max(0, now - state.lastSeenAt);
    updatedState = applyDecay(state, elapsedMs, now);
  } else {
    updatedState = state;
  }
  
  updatedState.lastSeenAt = now;
  const savedState = cleanState(updatedState);
  await ctx.storage.set("state", savedState);
  
  await updatePinned(ctx, savedState, now);
  await maybeNudge(ctx, savedState, now);
  await scheduleNextTick(ctx, now);
  return savedState;
}

const assistantInputSchema = {
  type: "object",
  additionalProperties: false,
};

function assistantStateResult(action, state, now) {
  return {
    ok: true,
    action,
    mood: getMood(state, now),
    state: cleanState(state),
  };
}

async function runAssistantAction(ctx, action, actionHandler) {
  const now = Date.now();
  const state = await actionHandler(ctx, now, { speak: false });
  return assistantStateResult(action, state, now);
}

async function registerAssistantCapabilities(ctx) {
  const capabilities = [
    ["virtual-pet.status", "Read the virtual pet's current care stats and mood.", (context) => runAssistantAction(context, "status", showStatus)],
    ["virtual-pet.feed", "Feed the virtual pet and return its updated care stats.", (context) => runAssistantAction(context, "feed", feed)],
    ["virtual-pet.play", "Play with the virtual pet and return its updated care stats.", (context) => runAssistantAction(context, "play", play)],
    ["virtual-pet.pet", "Pet the virtual pet and return its updated care stats.", (context) => runAssistantAction(context, "pet", pet)],
    ["virtual-pet.nap", "Put the virtual pet down for a nap and return its updated care stats.", (context) => runAssistantAction(context, "nap", nap)],
  ];

  for (const [id, description, handler] of capabilities) {
    await ctx.assistant.registerCapability(
      { id, description, inputSchema: assistantInputSchema },
      () => handler(ctx),
    );
  }
}

export function register(OpenPetsPlugin) {
  OpenPetsPlugin.register({
    async start(ctx) {
      await reconcile(ctx);
      await registerAssistantCapabilities(ctx);
      
      try {
        ctx.events.on("pet:clicked", () => pet(ctx));
      } catch {}
      
      const icon = ctx.assets.icon("virtual-pet");
      
      await ctx.commands.register({ id: "feed", title: "$t:command.feed.title", description: "$t:command.feed.description", icon }, () => feed(ctx));
      await ctx.commands.register({ id: "play", title: "$t:command.play.title", description: "$t:command.play.description", icon }, () => play(ctx));
      await ctx.commands.register({ id: "pet", title: "$t:command.pet.title", description: "$t:command.pet.description", icon }, () => pet(ctx));
      await ctx.commands.register({ id: "nap", title: "$t:command.nap.title", description: "$t:command.nap.description", icon }, () => nap(ctx));
      await ctx.commands.register({ id: "status", title: "$t:command.status.title", description: "$t:command.status.description", icon }, () => showStatus(ctx));
    },
    async stop() {},
  });
}
