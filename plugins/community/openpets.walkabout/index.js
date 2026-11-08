// Walkabout (openpets.walkabout) — makes your pet roam the screen with style.
// Supports three modes: wander, follow-cursor, patrol.
/// <reference types="@open-pets/plugin-sdk" />

// ── Constants ─────────────────────────────────────────────────────────────────

export const SCHEDULE_ID = "walkabout-tick";
export const STATUS_ACTIVE = "walkabout";
export const CONFIG_KEY = "config";
export const PINNED_PET_COMMAND_ID = "walkabout.pinned-pet-toggle";
const disabledPinnedPetsStorageKey = "disabled-pinned-pets";
const dragResumeDelayMs = 1000;

/** Duration multipliers per speed setting (ms per move). */
export const SPEED_DURATION = {
  slow: 1800,
  normal: 1100,
  brisk: 600,
};

/** Wander distance per move step (px) — work-area clamped by host. */
export const WANDER_DISTANCE = 120;

/** Patrol uses fixed x-steps; y is kept from current position. */
export const PATROL_STEP_X = 220;

// ── Config helpers ─────────────────────────────────────────────────────────────

/**
 * @param {string|undefined} value
 * @returns {"wander"|"follow-cursor"|"patrol"}
 */
export function normalizeMode(value) {
  const valid = ["wander", "follow-cursor", "patrol"];
  return valid.includes(value) ? value : "wander";
}

/**
 * @param {string|undefined} value
 * @returns {"slow"|"normal"|"brisk"}
 */
export function normalizeSpeed(value) {
  const valid = ["slow", "normal", "brisk"];
  return valid.includes(value) ? value : "slow";
}

/**
 * @param {string|number|undefined} value
 * @returns {number} interval in ms
 */
export function normalizeInterval(value) {
  const n = Number(value);
  if (Number.isFinite(n) && n >= 1 && n <= 120) return Math.floor(n) * 1000;
  return 10000;
}

/**
 * @param {unknown} raw
 * @returns {{ mode: string, speed: string, intervalMs: number, pauseWhenBusy: boolean }}
 */
export function cleanConfig(raw) {
  const c = raw && typeof raw === "object" ? raw : {};
  return {
    mode: normalizeMode(c.mode),
    speed: normalizeSpeed(c.speed),
    intervalMs: normalizeInterval(c.interval ?? 10),
    pauseWhenBusy: c.pauseWhenBusy !== false,
  };
}

// ── Patrol helpers ─────────────────────────────────────────────────────────────

/**
 * Computes the next patrol target given current position.
 * Alternates left and right by PATROL_STEP_X.
 *
 * @param {{ x: number, y: number }} position
 * @param {boolean} goingRight
 * @returns {{ target: { x: number, y: number }, nextDirection: boolean }}
 */
export function nextPatrolTarget(position, goingRight) {
  const dx = goingRight ? PATROL_STEP_X : -PATROL_STEP_X;
  return {
    target: { x: position.x + dx, y: position.y },
    nextDirection: !goingRight,
  };
}

// ── Mode runners ───────────────────────────────────────────────────────────────

function getPetHandle(ctx, petId) {
  if (petId === "default") return ctx.pet;
  if (petId.startsWith("pinned:")) return ctx.pets.getPinned(petId);
  return ctx.pets.get(petId);
}

/**
 * Starts wander mode. Returns a stop function.
 * @param {import("@open-pets/plugin-sdk").OpenPetsContext} ctx
 * @param {ReturnType<typeof cleanConfig>} cfg
 * @param {string} petId
 * @returns {() => void}
 */
export function startWander(ctx, cfg, petId = "default") {
  const pet = getPetHandle(ctx, petId);
  let active = true;
  let busy = false;

  async function step() {
    if (!active || busy) return;
    busy = true;
    try {
      await pet.wander({
        distance: WANDER_DISTANCE,
        durationMs: SPEED_DURATION[cfg.speed],
      });
    } catch (err) {
      ctx.log.warn("wander step failed", err?.message);
    } finally {
      busy = false;
    }
  }

  // Initial step after a short delay so the plugin feels alive immediately.
  const initialTimer = setTimeout(() => { void step(); }, 400);
  const intervalId = setInterval(() => { void step(); }, cfg.intervalMs);

  return function stop() {
    active = false;
    clearTimeout(initialTimer);
    clearInterval(intervalId);
  };
}

/**
 * Starts follow-cursor mode. Returns a stop function.
 * @param {import("@open-pets/plugin-sdk").OpenPetsContext} ctx
 * @param {ReturnType<typeof cleanConfig>} cfg
 * @param {string} petId
 * @returns {() => void}
 */
export function startFollowCursor(ctx, cfg, petId = "default") {
  const pet = getPetHandle(ctx, petId);
  // Lag 0 = instant (brisk), 0.85 = slow trail, 0.7 = normal.
  const lagBySpeed = { slow: 0.88, normal: 0.72, brisk: 0.45 };
  const lag = lagBySpeed[cfg.speed];

  let stopped = false;
  pet.followCursor({ enabled: true, lag }).catch((err) => {
    if (!stopped) ctx.log.warn("followCursor failed", err?.message);
  });

  return function stop() {
    stopped = true;
    pet.followCursor({ enabled: false }).catch(() => {});
  };
}

/**
 * Starts patrol mode. Returns a stop function.
 * @param {import("@open-pets/plugin-sdk").OpenPetsContext} ctx
 * @param {ReturnType<typeof cleanConfig>} cfg
 * @param {string} petId
 * @returns {() => void}
 */
export function startPatrol(ctx, cfg, petId = "default") {
  const pet = getPetHandle(ctx, petId);
  let active = true;
  let busy = false;
  let goingRight = true;

  async function step() {
    if (!active || busy) return;
    busy = true;
    try {
      const state = await pet.getState();
      const { target, nextDirection } = nextPatrolTarget(state.position, goingRight);
      goingRight = nextDirection;
      await pet.moveTo(target, { durationMs: SPEED_DURATION[cfg.speed], easing: "ease-in-out" });
    } catch (err) {
      ctx.log.warn("patrol step failed", err?.message);
    } finally {
      busy = false;
    }
  }

  const initialTimer = setTimeout(() => { void step(); }, 300);
  const intervalId = setInterval(() => { void step(); }, cfg.intervalMs);

  return function stop() {
    active = false;
    clearTimeout(initialTimer);
    clearInterval(intervalId);
  };
}

// ── Mode factory ───────────────────────────────────────────────────────────────

/**
 * Starts the appropriate mode and returns its stop function.
 * @param {import("@open-pets/plugin-sdk").OpenPetsContext} ctx
 * @param {ReturnType<typeof cleanConfig>} cfg
 * @param {string} petId
 * @returns {() => void}
 */
function startModeRunner(ctx, cfg, petId = "default") {
  switch (cfg.mode) {
    case "follow-cursor": return startFollowCursor(ctx, cfg, petId);
    case "patrol":        return startPatrol(ctx, cfg, petId);
    default:              return startWander(ctx, cfg, petId);
  }
}

export function startMode(ctx, cfg, petId = "default") {
  return startModeRunner(ctx, cfg, petId);
}

function createPetRunner(ctx, petId, cfg, onResume) {
  const pet = getPetHandle(ctx, petId);
  let active = true;
  let activityResumeTimer = null;
  let dragResumeTimer = null;
  let activityResumeGeneration = 0;
  let modeStopped = false;
  const pauseReasons = new Set();
  let stopMode = startMode(ctx, cfg, petId);

  function stopModeIfRunning() {
    if (modeStopped) return Promise.resolve();
    stopMode();
    modeStopped = true;
    return pet.cancelMove().catch(() => {});
  }

  function resumeIfUnpaused() {
    if (!active || pauseReasons.size > 0 || !modeStopped) return;
    stopMode = startMode(ctx, cfg, petId);
    modeStopped = false;
    onResume();
  }

  return {
    pause() {
      if (!active) return Promise.resolve();
      pauseReasons.add("activity");
      const canceledMove = stopModeIfRunning();
      const generation = ++activityResumeGeneration;
      clearTimeout(activityResumeTimer);
      activityResumeTimer = setTimeout(() => {
        if (!active || generation !== activityResumeGeneration) return;
        activityResumeTimer = null;
        pauseReasons.delete("activity");
        resumeIfUnpaused();
      }, cfg.intervalMs * 2);
      return canceledMove;
    },
    pauseForDrag() {
      if (!active) return Promise.resolve();
      clearTimeout(dragResumeTimer);
      dragResumeTimer = null;
      pauseReasons.add("drag");
      return stopModeIfRunning();
    },
    resumeAfterDrag() {
      if (!active || !pauseReasons.delete("drag")) return;
      dragResumeTimer = setTimeout(() => {
        dragResumeTimer = null;
        resumeIfUnpaused();
      }, dragResumeDelayMs);
    },
    stop() {
      if (!active) return Promise.resolve();
      active = false;
      activityResumeGeneration += 1;
      clearTimeout(activityResumeTimer);
      activityResumeTimer = null;
      clearTimeout(dragResumeTimer);
      dragResumeTimer = null;
      pauseReasons.clear();
      return stopModeIfRunning();
    },
  };
}

// ── Plugin entry ───────────────────────────────────────────────────────────────

/**
 * Plugin registration (called by the OpenPets runtime).
 * @param {import("@open-pets/plugin-sdk").OpenPetsPluginEntry} OpenPetsPlugin
 */
export function register(OpenPetsPlugin) {
  let cleanup = async () => {};

  OpenPetsPlugin.register({
    async start(ctx) {
      await cleanup();
      let active = true;
      let cfg = cleanConfig({});
      const disabledPinnedPets = new Set();
      const draggingPets = new Set();
      const runners = new Map();
      const movementOwners = new Map();
      const ownershipOperations = new Map();
      let currentPets = [];
      let commandRefresh = Promise.resolve();
      let configChanges = Promise.resolve();
      let configRevision = 0;
      let unsubPets = () => {};
      let unsubConfig = () => {};
      let unsubActivity = () => {};
      let unsubDragStart = () => {};
      let unsubDragEnd = () => {};

      cleanup = async function stopWalkabout() {
        if (!active) return;
        active = false;
        const cancelMoves = [...runners.values()].map((runner) => runner.stop());
        runners.clear();
        draggingPets.clear();
        const releaseOwners = [...movementOwners.entries()].map(([petId, pet]) => {
          movementOwners.delete(petId);
          return setMovementOwnership(petId, pet, false).catch(() => undefined);
        });
        unsubPets();
        unsubConfig();
        unsubActivity();
        unsubDragStart();
        unsubDragEnd();
        await Promise.all([...releaseOwners, ...cancelMoves]);
        await configChanges.catch(() => undefined);
        await commandRefresh.catch(() => undefined);
        await ctx.commands.unregister(PINNED_PET_COMMAND_ID).catch(() => {});
        await ctx.status.clear().catch(() => {});
      };

      function setMovementOwnership(petId, pet, owned) {
        const previous = ownershipOperations.get(petId) ?? Promise.resolve();
        const operation = previous.catch(() => undefined).then(() => pet.setAutomaticMovement(owned));
        ownershipOperations.set(petId, operation);
        return operation;
      }

      cfg = cleanConfig(await ctx.config.get());
      if (!active) return;

      try {
        const storedDisabled = await ctx.storage.get(disabledPinnedPetsStorageKey);
        if (Array.isArray(storedDisabled)) {
          for (const petId of storedDisabled) {
            if (typeof petId === "string" && /^pinned:[A-Za-z0-9._:-]{1,120}$/.test(petId)) {
              disabledPinnedPets.add(petId);
            }
          }
        }
      } catch (err) {
        ctx.log.warn("could not load per-pet movement preferences", err?.message);
      }
      if (!active) return;

      function reconcileRunners() {
        const controllable = currentPets.filter((pet) => pet.kind === "default" || pet.kind === "pinned");
        const desiredIds = new Set(controllable.map((pet) => pet.id));
        for (const petId of movementOwners.keys()) {
          if (desiredIds.has(petId)) continue;
          movementOwners.delete(petId);
        }
        for (const petId of draggingPets) {
          if (!desiredIds.has(petId)) draggingPets.delete(petId);
        }
        // Drag ownership lasts while Walkabout controls the pet, even when its
        // individual wander timer is paused, so repositioning never becomes a fling.
        for (const pet of controllable) {
          if (movementOwners.has(pet.id)) continue;
          const petHandle = getPetHandle(ctx, pet.id);
          movementOwners.set(pet.id, petHandle);
          void setMovementOwnership(pet.id, petHandle, true).catch((err) => {
            if (movementOwners.get(pet.id) === petHandle) movementOwners.delete(pet.id);
            ctx.log.warn("could not register automatic movement", err?.message);
          });
        }
        for (const [petId, runner] of runners) {
          if (!desiredIds.has(petId) || (petId !== "default" && disabledPinnedPets.has(petId))) {
            void runner.stop();
            runners.delete(petId);
          }
        }
        for (const pet of controllable) {
          if (pet.kind === "pinned" && disabledPinnedPets.has(pet.id)) continue;
          if (runners.has(pet.id)) continue;
          let runner;
          runner = createPetRunner(ctx, pet.id, cfg, () => {
            if (!active || runners.get(pet.id) !== runner || pet.id !== "default") return;
            ctx.status.set({ text: ctx.t("status.active", { mode: cfg.mode }), tone: "info" }).catch(() => {});
          });
          runners.set(pet.id, runner);
          if (draggingPets.has(pet.id)) void runner.pauseForDrag();
        }
      }

      function refreshPinnedPetCommand() {
        commandRefresh = commandRefresh.catch(() => undefined).then(async () => {
          if (!active) return;
          const pinnedPets = currentPets.filter((pet) => pet.kind === "pinned");
          if (pinnedPets.length === 0) {
            await ctx.commands.unregister(PINNED_PET_COMMAND_ID);
            return;
          }

          const enabledPet = pinnedPets.find((pet) => !disabledPinnedPets.has(pet.id));
          const options = pinnedPets.map((pet) => {
            const name = pet.name.length > 60 ? `${pet.name.slice(0, 57)}…` : pet.name;
            const label = ctx.t(disabledPinnedPets.has(pet.id) ? "command.pet.paused" : "command.pet.moving", { name });
            return { label, value: pet.id };
          });
          await ctx.commands.register({
            id: PINNED_PET_COMMAND_ID,
            title: ctx.t("command.toggle.title"),
            description: ctx.t("command.toggle.description"),
            form: {
              fields: [{
                id: "petId",
                type: "select",
                label: ctx.t("command.toggle.field"),
                default: enabledPet?.id ?? pinnedPets[0].id,
                options,
              }],
              submitLabel: ctx.t("command.toggle.submit"),
            },
          }, async (values = {}) => {
            if (!active) return;
            const selectedId = typeof values.petId === "string" ? values.petId : "";
            const selectedPet = currentPets.find((pet) => pet.id === selectedId && pet.kind === "pinned");
            if (!selectedPet) return;
            if (disabledPinnedPets.has(selectedId)) disabledPinnedPets.delete(selectedId);
            else disabledPinnedPets.add(selectedId);
            reconcileRunners();
            try {
              await ctx.storage.set(disabledPinnedPetsStorageKey, [...disabledPinnedPets]);
            } catch (err) {
              ctx.log.warn("could not save per-pet movement preferences", err?.message);
            }
            await refreshPinnedPetCommand();
          });
        }).catch((err) => {
          ctx.log.warn("pinned pet movement command update failed", err?.message);
        });
        return commandRefresh;
      }

      // Set a visible status so the user can see the plugin is active.
      await ctx.status.set({ text: ctx.t("status.active", { mode: cfg.mode }), tone: "info" });
      if (!active) return;

      let petListRevision = 0;
      unsubPets = ctx.pets.onChange((pets) => {
        if (!active) return;
        petListRevision += 1;
        currentPets = pets;
        reconcileRunners();
        void refreshPinnedPetCommand();
      });
      const initialRevision = petListRevision;
      const initialPets = await ctx.pets.list();
      if (!active) return;
      if (petListRevision === initialRevision) {
        currentPets = initialPets;
        reconcileRunners();
      }
      await refreshPinnedPetCommand();
      if (!active) return;

      // React to config changes — tear down old mode, spin up new one.
      unsubConfig = ctx.config.onChange((newRaw) => {
        const revision = ++configRevision;
        cfg = cleanConfig(newRaw);
        configChanges = configChanges.catch(() => undefined).then(async () => {
          if (!active || revision !== configRevision) return;
          const previousRunners = [...runners.values()];
          runners.clear();
          await Promise.all(previousRunners.map((runner) => runner.stop()));
          if (!active || revision !== configRevision) return;
          reconcileRunners();
          await ctx.status.set({ text: ctx.t("status.active", { mode: cfg.mode }), tone: "info" });
        });
        return configChanges;
      });

      // Preserve the original busy-pause behavior for the default pet. Pinned pets
      // are user-owned and continue their independent movement while an agent works.
      unsubActivity = ctx.events.on("agent:activity", async (event) => {
        if (!cfg.pauseWhenBusy) return;
        if ((event?.surface ?? "default") !== "default") return; // ignore other surfaces
        if (event?.petId && event.petId !== "default") return;   // ignore other sessions' pets
        if (event?.active !== true) return;                    // only react to activity pulses
        const defaultRunner = runners.get("default");
        if (!defaultRunner) return;
        await defaultRunner.pause();
        await ctx.status.set({ text: ctx.t("status.paused"), tone: "warning" });
      });

      // A manual reposition owns the window until dragEnd. Pausing just this
      // pet's runner prevents a new move during the drag or immediately after it.
      unsubDragStart = ctx.events.on("pet:dragStart", (event) => {
        if (typeof event?.petId !== "string") return;
        const draggedPet = currentPets.find((pet) => pet.id === event.petId && (pet.kind === "default" || pet.kind === "pinned"));
        if (!draggedPet) return;
        draggingPets.add(event.petId);
        void runners.get(event.petId)?.pauseForDrag();
      });
      unsubDragEnd = ctx.events.on("pet:dragEnd", (event) => {
        if (typeof event?.petId !== "string") return;
        draggingPets.delete(event.petId);
        runners.get(event.petId)?.resumeAfterDrag();
      });

    },
    async stop() {
      await cleanup();
      cleanup = async () => {};
    },
  });
}
