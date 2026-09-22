// Simple Timer (openpets.simple-timer) — a standalone SDK v3 one-shot timer.
//
// The host owns every visible surface. This plugin persists absolute wall-clock
// timestamps, reconciles them on startup, and uses a serialized operation queue
// so stale schedule callbacks cannot resurrect or re-fire a timer.

/// <reference types="@open-pets/plugin-sdk" />

export const STORAGE_KEY = "timer";
export const EXPIRY_SCHEDULE_ID = "simple-timer-expiry";
export const HUD_REFRESH_SCHEDULE_ID = "simple-timer-hud-refresh";
export const SNOOZE_MS = 5 * 60_000;
export const ADD_MINUTES = 5;
export const MAX_DURATION_MS = 24 * 60 * 60_000;
export const MAX_LABEL_LENGTH = 80;
export const PRESET_MINUTES = Object.freeze([5, 15, 25, 30, 60]);

const STORAGE_VERSION = 1;
const DEFAULT_PRESET_MINUTES = 25;
const MIN_DURATION_MS = 60_000;
const HUD_REFRESH_MS = 60_000;
const COMMAND_IDS = [
  "start-timer",
  "timer-5",
  "timer-15",
  "timer-25",
  "timer-30",
  "timer-60",
  "pause-resume-timer",
  "add-five-minutes",
  "cancel-timer",
  "show-timer",
];

const contextStates = new WeakMap();
const activeContexts = new Set();

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteInteger(value) {
  return typeof value === "number" && Number.isInteger(value) && Number.isFinite(value);
}

function isPositiveInteger(value) {
  return isFiniteInteger(value) && value > 0;
}

function numericInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && Number.isFinite(number) ? number : null;
}

/** Normalize optional user text at the command boundary. */
export function cleanLabel(value) {
  const text = typeof value === "string" ? value.trim().replace(/[\r\n]+/g, " ").replace(/\s+/g, " ") : "";
  return (text || "").slice(0, MAX_LABEL_LENGTH).trim() || null;
}

/** Resolve a command form's preset/custom fields to a bounded duration. */
export function durationForValues(values = {}) {
  const customMinutes = numericInteger(values.customMinutes);
  if (customMinutes !== null && customMinutes > 0) {
    if (customMinutes > MAX_DURATION_MS / 60_000) return null;
    return customMinutes * 60_000;
  }

  const preset = numericInteger(values.preset ?? DEFAULT_PRESET_MINUTES);
  if (!PRESET_MINUTES.includes(preset)) return null;
  return preset * 60_000;
}

/** Format the remaining duration as a stable, compact countdown string. */
export function formatRemaining(remainingMs) {
  const totalSeconds = Math.max(0, Math.ceil(Number(remainingMs) / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const paddedMinutes = String(minutes).padStart(2, "0");
  const paddedSeconds = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${paddedMinutes}:${paddedSeconds}` : `${minutes}:${paddedSeconds}`;
}

/** Parse untrusted persisted data into one of the three timer states. */
export function parseStoredTimer(value) {
  if (!isRecord(value) || value.version !== STORAGE_VERSION || typeof value.timerId !== "string" || value.timerId.length === 0) return null;
  if (!isPositiveInteger(value.startedAt) || !isPositiveInteger(value.durationMs) || value.durationMs > MAX_DURATION_MS) return null;
  if (value.label !== null && typeof value.label !== "string") return null;
  const common = {
    version: STORAGE_VERSION,
    timerId: value.timerId,
    label: cleanLabel(value.label),
    startedAt: value.startedAt,
    durationMs: value.durationMs,
  };

  if (value.phase === "running" && isPositiveInteger(value.endsAt) && value.endsAt >= value.startedAt) {
    return { ...common, phase: "running", endsAt: value.endsAt };
  }
  if (value.phase === "paused" && isPositiveInteger(value.remainingMs) && value.remainingMs <= value.durationMs) {
    return { ...common, phase: "paused", remainingMs: value.remainingMs };
  }
  if (
    value.phase === "expired" &&
    isPositiveInteger(value.expiredAt) &&
    value.expiredAt >= value.startedAt &&
    (value.alertShownAt === null || isPositiveInteger(value.alertShownAt))
  ) {
    return { ...common, phase: "expired", expiredAt: value.expiredAt, alertShownAt: value.alertShownAt };
  }
  return null;
}

function newContextState() {
  return {
    generation: 0,
    sequence: 0,
    queue: Promise.resolve(),
    hud: null,
    alert: null,
    stopped: false,
  };
}

function stateFor(ctx) {
  let state = contextStates.get(ctx);
  if (!state) {
    state = newContextState();
    contextStates.set(ctx, state);
    activeContexts.add(ctx);
  }
  return state;
}

function activateContext(ctx) {
  const state = stateFor(ctx);
  state.generation += 1;
  state.queue = Promise.resolve();
  state.hud = null;
  state.alert = null;
  state.stopped = false;
  activeContexts.add(ctx);
}

function isCurrent(ctx, token) {
  const state = contextStates.get(ctx);
  return Boolean(state && !state.stopped && state.generation === token);
}

function enqueue(ctx, operation) {
  const state = stateFor(ctx);
  const previous = state.queue;
  const current = previous.catch(() => undefined).then(operation);
  state.queue = current.catch(() => undefined);
  return current;
}

function lifecycle(ctx, operation, expectedToken) {
  const state = contextStates.get(ctx);
  if (!state || state.stopped || (expectedToken !== undefined && state.generation !== expectedToken)) return Promise.resolve();
  return enqueue(ctx, () => {
    const current = stateFor(ctx);
    if (current.stopped || (expectedToken !== undefined && current.generation !== expectedToken)) return undefined;
    const token = ++current.generation;
    return operation(token);
  });
}

// Display refreshes are serialized, but must not advance the generation: the
// expiry schedule shares the timer generation and remains valid while the HUD
// is refreshed once per minute.
function queuedRefresh(ctx, operation, expectedToken) {
  const state = contextStates.get(ctx);
  if (!state || state.stopped || (expectedToken !== undefined && state.generation !== expectedToken)) return Promise.resolve();
  return enqueue(ctx, () => {
    const current = stateFor(ctx);
    if (current.stopped || (expectedToken !== undefined && current.generation !== expectedToken)) return undefined;
    return operation(current.generation);
  });
}

async function readTimer(ctx) {
  return parseStoredTimer(await ctx.storage.get(STORAGE_KEY));
}

async function updateStatus(ctx, timer, token) {
  if (!isCurrent(ctx, token)) return;
  if (!timer) {
    await ctx.status.set({ text: ctx.t("status.ready"), tone: "info" });
    return;
  }
  const label = timer.label ?? ctx.t("timer.defaultLabel");
  if (timer.phase === "expired") {
    await ctx.status.set({ text: ctx.t("status.expired", { label }), tone: "warning" });
    return;
  }
  const remaining = timer.phase === "paused" ? timer.remainingMs : Math.max(0, timer.endsAt - Date.now());
  const key = timer.phase === "paused" ? "status.paused" : "status.running";
  await ctx.status.set({ text: ctx.t(key, { label, remaining: formatRemaining(remaining) }), tone: timer.phase === "paused" ? "warning" : "info" });
}

async function saveTimer(ctx, timer, token) {
  if (!isCurrent(ctx, token)) return false;
  if (timer) await ctx.storage.set(STORAGE_KEY, timer);
  else await ctx.storage.delete(STORAGE_KEY);
  if (!isCurrent(ctx, token)) return false;
  await updateStatus(ctx, timer, token);
  return true;
}

async function cancelSchedules(ctx, token) {
  if (!isCurrent(ctx, token)) return;
  await ctx.schedule.cancel(EXPIRY_SCHEDULE_ID);
  if (!isCurrent(ctx, token)) return;
  await ctx.schedule.cancel(HUD_REFRESH_SCHEDULE_ID);
}

async function dismissHud(ctx, token) {
  if (!isCurrent(ctx, token)) return;
  const state = stateFor(ctx);
  const hud = state.hud;
  state.hud = null;
  if (!hud) return;
  try {
    await hud.dismiss();
  } catch {}
}

async function dismissAlert(ctx, token) {
  if (!isCurrent(ctx, token)) return;
  const state = stateFor(ctx);
  const alert = state.alert;
  state.alert = null;
  if (!alert) return;
  try {
    await alert.handle.dismiss();
  } catch {}
}

function remainingMs(timer, now = Date.now()) {
  if (!timer) return 0;
  if (timer.phase === "paused") return timer.remainingMs;
  if (timer.phase === "expired") return 0;
  return Math.max(0, timer.endsAt - now);
}

function progressValue(timer, now = Date.now()) {
  if (!timer || timer.phase === "expired") return 0;
  const remaining = remainingMs(timer, now);
  return Math.max(0, Math.min(100, Math.round((1 - remaining / timer.durationMs) * 100)));
}

function hudSpec(ctx, timer) {
  const label = timer.label ?? ctx.t("timer.defaultLabel");
  const remaining = formatRemaining(remainingMs(timer));
  const paused = timer.phase === "paused";
  return {
    hud: {
      items: [{
        icon: "timer",
        value: progressValue(timer),
        label: ctx.t(paused ? "hud.paused" : "hud.running", { label, remaining }),
        tone: paused ? "amber" : "blue",
      }],
    },
    tone: paused ? "warning" : "info",
    sticky: true,
    pin: true,
    priority: "normal",
    actions: paused
      ? [
          { id: "toggle", label: ctx.t("action.resume"), style: "primary", dismissesBubble: false },
          { id: "add-5", label: ctx.t("action.addFive"), dismissesBubble: false },
          { id: "cancel", label: ctx.t("action.cancel"), style: "danger" },
        ]
      : [
          { id: "toggle", label: ctx.t("action.pause"), style: "primary", dismissesBubble: false },
          { id: "add-5", label: ctx.t("action.addFive"), dismissesBubble: false },
          { id: "cancel", label: ctx.t("action.cancel"), style: "danger" },
        ],
  };
}

async function updateHud(ctx, timer, token, { create = true } = {}) {
  if (!isCurrent(ctx, token)) return;
  if (!timer || timer.phase === "expired") {
    await dismissHud(ctx, token);
    return;
  }
  const state = stateFor(ctx);
  const hud = state.hud;
  const spec = hudSpec(ctx, timer);
  if (hud) {
    try {
      await hud.update(spec);
      return;
    } catch {
      state.hud = null;
    }
  }
  if (!create || !isCurrent(ctx, token)) return;
  const nextHud = await ctx.ui.bubble(spec);
  if (!isCurrent(ctx, token)) {
    try {
      await nextHud.dismiss();
    } catch {}
    return;
  }
  nextHud.onAction((actionId) => {
    if (stateFor(ctx).hud?.id !== nextHud.id) return undefined;
    return handleHudAction(ctx, actionId);
  });
  nextHud.onDismiss(() => {
    if (stateFor(ctx).hud?.id === nextHud.id) stateFor(ctx).hud = null;
  });
  state.hud = nextHud;
}

async function scheduleExpiry(ctx, timer, token) {
  if (!isCurrent(ctx, token)) return;
  await ctx.schedule.cancel(EXPIRY_SCHEDULE_ID);
  if (!isCurrent(ctx, token) || timer.phase !== "running") return;
  await ctx.schedule.at(EXPIRY_SCHEDULE_ID, new Date(timer.endsAt).toISOString(), () => expireTimer(ctx, timer.timerId, token));
  if (!isCurrent(ctx, token)) await ctx.schedule.cancel(EXPIRY_SCHEDULE_ID);
}

async function scheduleHudRefresh(ctx, timer, token) {
  if (!isCurrent(ctx, token)) return;
  await ctx.schedule.cancel(HUD_REFRESH_SCHEDULE_ID);
  if (!isCurrent(ctx, token) || timer.phase !== "running") return;
  await ctx.schedule.once(HUD_REFRESH_SCHEDULE_ID, HUD_REFRESH_MS, () => refreshHud(ctx, timer.timerId, token));
  if (!isCurrent(ctx, token)) await ctx.schedule.cancel(HUD_REFRESH_SCHEDULE_ID);
}

async function config(ctx) {
  const value = await ctx.config.get();
  return isRecord(value) ? value : {};
}

function alertText(ctx, timer) {
  return ctx.t("alert.text", { label: timer.label ?? ctx.t("timer.defaultLabel") });
}

async function showExpiryAlert(ctx, timer, token) {
  if (!isCurrent(ctx, token) || timer.phase !== "expired" || timer.alertShownAt !== null) return;
  const state = stateFor(ctx);
  if (state.alert?.timerId === timer.timerId) return;
  const settings = await config(ctx);
  if (!isCurrent(ctx, token)) return;
  const label = timer.label ?? ctx.t("timer.defaultLabel");
  const soundEnabled = settings.soundEnabled !== false;
  const osNotification = settings.osNotification !== false;
  const text = alertText(ctx, timer);
  let alert = null;
  try {
    alert = await ctx.ui.alert({
      text,
      indicator: { icon: "timer", label: ctx.t("alert.title"), tone: "warning", color: "#d97706", background: "#fef3c7", borderColor: "#fbbf24" },
      tone: "warning",
      sound: soundEnabled ? settings.customSound || "alert" : undefined,
      notify: osNotification ? { title: ctx.t("notify.title"), body: ctx.t("notify.body", { label }), sound: soundEnabled } : undefined,
      dismissOn: ["action"],
      actions: [
        { id: "snooze", label: ctx.t("action.snooze"), style: "primary" },
        { id: "dismiss", label: ctx.t("action.dismiss") },
      ],
    });
  } catch {
    try {
      await ctx.pet.speak(text);
    } catch {}
  }
  if (!isCurrent(ctx, token)) {
    if (alert) {
      try {
        await alert.dismiss();
      } catch {}
    }
    return;
  }
  if (alert) {
    state.alert = { timerId: timer.timerId, handle: alert };
    alert.onAction((actionId) => {
      if (stateFor(ctx).alert?.handle.id !== alert.id) return undefined;
      if (actionId === "snooze") return snoozeExpired(ctx, timer.timerId);
      if (actionId === "dismiss") return dismissExpired(ctx, timer.timerId);
    });
    alert.onDismiss(() => {
      if (stateFor(ctx).alert?.handle.id === alert.id) stateFor(ctx).alert = null;
    });
  }
  const latest = await readTimer(ctx);
  if (!isCurrent(ctx, token) || !latest || latest.phase !== "expired" || latest.timerId !== timer.timerId) return;
  await saveTimer(ctx, { ...latest, alertShownAt: Date.now() }, token);
}

async function expireTimerImpl(ctx, timerId, token, { scheduled = false } = {}) {
  const timer = await readTimer(ctx);
  if (!isCurrent(ctx, token) || !timer || timer.timerId !== timerId || timer.phase !== "running") return false;
  if (!scheduled && timer.endsAt > Date.now()) {
    await scheduleExpiry(ctx, timer, token);
    await scheduleHudRefresh(ctx, timer, token);
    return false;
  }
  await cancelSchedules(ctx, token);
  if (!isCurrent(ctx, token)) return false;
  const expired = {
    version: STORAGE_VERSION,
    timerId: timer.timerId,
    label: timer.label,
    startedAt: timer.startedAt,
    durationMs: timer.durationMs,
    phase: "expired",
    expiredAt: timer.endsAt,
    alertShownAt: null,
  };
  await saveTimer(ctx, expired, token);
  if (!isCurrent(ctx, token)) return false;
  await dismissHud(ctx, token);
  await showExpiryAlert(ctx, expired, token);
  return true;
}

export function expireTimer(ctx, timerId, expectedToken) {
  return lifecycle(ctx, (token) => expireTimerImpl(ctx, timerId, token, { scheduled: true }), expectedToken);
}

async function refreshHudImpl(ctx, timerId, token) {
  const timer = await readTimer(ctx);
  if (!isCurrent(ctx, token)) return;
  if (!timer || timer.timerId !== timerId) {
    await cancelSchedules(ctx, token);
    await updateStatus(ctx, null, token);
    await updateHud(ctx, null, token);
    return;
  }
  if (timer.phase === "running" && timer.endsAt <= Date.now()) {
    await expireTimerImpl(ctx, timerId, token, { scheduled: true });
    return;
  }
  await updateStatus(ctx, timer, token);
  await updateHud(ctx, timer, token);
  if (timer.phase === "running") await scheduleHudRefresh(ctx, timer, token);
}

export function refreshHud(ctx, timerId, expectedToken) {
  return queuedRefresh(ctx, (token) => refreshHudImpl(ctx, timerId, token), expectedToken);
}

function makeRunningTimer(ctx, durationMs, label) {
  const state = stateFor(ctx);
  state.sequence += 1;
  const now = Date.now();
  return {
    version: STORAGE_VERSION,
    timerId: `timer-${now.toString(36)}-${state.sequence.toString(36)}`,
    label: cleanLabel(label),
    startedAt: now,
    durationMs,
    phase: "running",
    endsAt: now + durationMs,
  };
}

async function startTimerImpl(ctx, durationMs, label, token) {
  const timer = makeRunningTimer(ctx, durationMs, label);
  await cancelSchedules(ctx, token);
  if (!isCurrent(ctx, token)) return undefined;
  await dismissHud(ctx, token);
  if (!isCurrent(ctx, token)) return undefined;
  await dismissAlert(ctx, token);
  if (!isCurrent(ctx, token)) return undefined;
  await saveTimer(ctx, timer, token);
  if (!isCurrent(ctx, token)) return undefined;
  await scheduleExpiry(ctx, timer, token);
  await scheduleHudRefresh(ctx, timer, token);
  await updateHud(ctx, timer, token);
  return timer;
}

export function startTimer(ctx, durationMs, label) {
  if (!isPositiveInteger(durationMs) || durationMs < MIN_DURATION_MS || durationMs > MAX_DURATION_MS) {
    return Promise.reject(new Error("Timer duration must be 1 minute to 24 hours."));
  }
  return lifecycle(ctx, (token) => startTimerImpl(ctx, durationMs, label, token));
}

async function togglePauseImpl(ctx, token) {
  const timer = await readTimer(ctx);
  if (!isCurrent(ctx, token)) return;
  if (!timer || timer.phase === "expired") {
    await ctx.pet.speak(ctx.t("speech.none"));
    return;
  }
  if (timer.phase === "running" && timer.endsAt <= Date.now()) {
    await expireTimerImpl(ctx, timer.timerId, token, { scheduled: true });
    return;
  }
  await cancelSchedules(ctx, token);
  if (!isCurrent(ctx, token)) return;
  if (timer.phase === "running") {
    const paused = { ...timer, phase: "paused", remainingMs: Math.max(1, timer.endsAt - Date.now()) };
    delete paused.endsAt;
    await saveTimer(ctx, paused, token);
    await updateHud(ctx, paused, token);
    return;
  }
  const resumed = { ...timer, phase: "running", endsAt: Date.now() + timer.remainingMs };
  delete resumed.remainingMs;
  await saveTimer(ctx, resumed, token);
  await scheduleExpiry(ctx, resumed, token);
  await scheduleHudRefresh(ctx, resumed, token);
  await updateHud(ctx, resumed, token);
}

export function pauseOrResume(ctx, expectedToken) {
  return lifecycle(ctx, (token) => togglePauseImpl(ctx, token), expectedToken);
}

async function addFiveImpl(ctx, token) {
  const timer = await readTimer(ctx);
  if (!isCurrent(ctx, token)) return;
  if (!timer || timer.phase === "expired") {
    await ctx.pet.speak(ctx.t("speech.none"));
    return;
  }
  if (timer.phase === "running" && timer.endsAt <= Date.now()) {
    await expireTimerImpl(ctx, timer.timerId, token, { scheduled: true });
    return;
  }
  if (timer.durationMs >= MAX_DURATION_MS) {
    await ctx.pet.speak(ctx.t("speech.maxDuration"));
    return;
  }
  const extension = Math.min(ADD_MINUTES * 60_000, MAX_DURATION_MS - timer.durationMs);
  const updated = timer.phase === "running"
    ? { ...timer, durationMs: timer.durationMs + extension, endsAt: timer.endsAt + extension }
    : { ...timer, durationMs: timer.durationMs + extension, remainingMs: timer.remainingMs + extension };
  await cancelSchedules(ctx, token);
  await saveTimer(ctx, updated, token);
  if (updated.phase === "running") {
    await scheduleExpiry(ctx, updated, token);
    await scheduleHudRefresh(ctx, updated, token);
  }
  await updateHud(ctx, updated, token);
}

export function addFiveMinutes(ctx, expectedToken) {
  return lifecycle(ctx, (token) => addFiveImpl(ctx, token), expectedToken);
}

async function clearTimerImpl(ctx, token) {
  const timer = await readTimer(ctx);
  if (!isCurrent(ctx, token)) return;
  await cancelSchedules(ctx, token);
  if (!isCurrent(ctx, token)) return;
  await saveTimer(ctx, null, token);
  if (!isCurrent(ctx, token)) return;
  await dismissHud(ctx, token);
  await dismissAlert(ctx, token);
  return timer;
}

export function cancelTimer(ctx, expectedToken) {
  return lifecycle(ctx, (token) => clearTimerImpl(ctx, token), expectedToken);
}

async function snoozeExpiredImpl(ctx, timerId, token) {
  const timer = await readTimer(ctx);
  if (!isCurrent(ctx, token) || !timer || timer.timerId !== timerId || timer.phase !== "expired") return false;
  const resumed = makeRunningTimer(ctx, SNOOZE_MS, timer.label);
  resumed.timerId = timer.timerId;
  await cancelSchedules(ctx, token);
  await saveTimer(ctx, resumed, token);
  await scheduleExpiry(ctx, resumed, token);
  await scheduleHudRefresh(ctx, resumed, token);
  await updateHud(ctx, resumed, token);
  stateFor(ctx).alert = null;
  return true;
}

export function snoozeExpired(ctx, timerId, expectedToken) {
  return lifecycle(ctx, (token) => snoozeExpiredImpl(ctx, timerId, token), expectedToken);
}

async function dismissExpiredImpl(ctx, timerId, token) {
  const timer = await readTimer(ctx);
  if (!isCurrent(ctx, token) || !timer || timer.timerId !== timerId || timer.phase !== "expired") return false;
  await clearTimerImpl(ctx, token);
  return true;
}

export function dismissExpired(ctx, timerId, expectedToken) {
  return lifecycle(ctx, (token) => dismissExpiredImpl(ctx, timerId, token), expectedToken);
}

async function reconcileImpl(ctx, token) {
  await cancelSchedules(ctx, token);
  if (!isCurrent(ctx, token)) return;
  const timer = await readTimer(ctx);
  if (!isCurrent(ctx, token)) return;
  if (!timer) {
    await dismissHud(ctx, token);
    await updateStatus(ctx, null, token);
    return;
  }
  if (timer.phase === "running" && timer.endsAt <= Date.now()) {
    await expireTimerImpl(ctx, timer.timerId, token, { scheduled: true });
    return;
  }
  await updateStatus(ctx, timer, token);
  await updateHud(ctx, timer, token);
  if (timer.phase === "running") {
    await scheduleExpiry(ctx, timer, token);
    await scheduleHudRefresh(ctx, timer, token);
  } else if (timer.phase === "expired" && timer.alertShownAt === null) {
    await showExpiryAlert(ctx, timer, token);
  }
}

export function reconcile(ctx) {
  return lifecycle(ctx, (token) => reconcileImpl(ctx, token));
}

async function showTimerImpl(ctx, token) {
  const timer = await readTimer(ctx);
  if (!isCurrent(ctx, token)) return;
  if (!timer) {
    await ctx.pet.speak(ctx.t("speech.none"));
    return;
  }
  if (timer.phase === "expired" && timer.alertShownAt === null) {
    await showExpiryAlert(ctx, timer, token);
    return;
  }
  if (timer.phase === "expired") {
    await ctx.pet.speak(ctx.t("speech.expired", { label: timer.label ?? ctx.t("timer.defaultLabel") }));
    return;
  }
  await updateStatus(ctx, timer, token);
  await updateHud(ctx, timer, token);
}

export function showTimer(ctx) {
  return lifecycle(ctx, (token) => showTimerImpl(ctx, token));
}

async function handleHudAction(ctx, actionId) {
  if (actionId === "toggle") return pauseOrResume(ctx);
  if (actionId === "add-5") return addFiveMinutes(ctx);
  if (actionId === "cancel") return cancelTimer(ctx);
}

function commandForm() {
  return {
    submitLabel: "$t:command.start.submit",
    fields: [
      {
        id: "preset",
        type: "select",
        label: "$t:form.preset.label",
        default: String(DEFAULT_PRESET_MINUTES),
        options: PRESET_MINUTES.map((minutes) => ({ value: String(minutes), label: `$t:form.preset.${minutes}` })),
      },
      {
        id: "customMinutes",
        type: "number",
        label: "$t:form.customMinutes.label",
        default: 0,
        min: 0,
        max: MAX_DURATION_MS / 60_000,
      },
      {
        id: "label",
        type: "text",
        label: "$t:form.label.label",
        maxLength: MAX_LABEL_LENGTH,
      },
    ],
  };
}

async function startFromValues(ctx, values = {}) {
  const durationMs = durationForValues(values);
  if (durationMs === null) {
    await ctx.pet.speak(ctx.t("speech.invalidDuration"));
    return;
  }
  await startTimer(ctx, durationMs, values.label);
}

async function stopContext(ctx) {
  const state = contextStates.get(ctx);
  if (!state) return;
  state.generation += 1;
  state.stopped = true;
  const pending = state.queue.catch(() => undefined);
  await pending;
  const hud = state.hud;
  const alert = state.alert;
  state.hud = null;
  state.alert = null;
  for (const scheduleId of [EXPIRY_SCHEDULE_ID, HUD_REFRESH_SCHEDULE_ID]) {
    try {
      await ctx.schedule.cancel(scheduleId);
    } catch {}
  }
  for (const commandId of COMMAND_IDS) {
    try {
      await ctx.commands.unregister(commandId);
    } catch {}
  }
  try {
    await ctx.status.clear();
  } catch {}
  for (const handle of [hud, alert?.handle]) {
    if (!handle) continue;
    try {
      await handle.dismiss();
    } catch {}
  }
  activeContexts.delete(ctx);
}

export function register(OpenPetsPlugin) {
  OpenPetsPlugin.register({
    async start(ctx) {
      activateContext(ctx);
      await reconcile(ctx);
      await ctx.commands.register({ id: "start-timer", title: "$t:command.start.title", description: "$t:command.start.description", icon: "timer", form: commandForm(), placement: "top", featured: true }, (values) => startFromValues(ctx, values));
      for (const minutes of PRESET_MINUTES) {
        await ctx.commands.register({
          id: `timer-${minutes}`,
          title: `$t:command.preset${minutes}.title`,
          description: `$t:command.preset${minutes}.description`,
          icon: "timer",
        }, () => startTimer(ctx, minutes * 60_000));
      }
      await ctx.commands.register({ id: "pause-resume-timer", title: "$t:command.pauseResume.title", description: "$t:command.pauseResume.description", icon: "timer" }, () => pauseOrResume(ctx));
      await ctx.commands.register({ id: "add-five-minutes", title: "$t:command.addFive.title", description: "$t:command.addFive.description", icon: "timer" }, () => addFiveMinutes(ctx));
      await ctx.commands.register({ id: "cancel-timer", title: "$t:command.cancel.title", description: "$t:command.cancel.description", icon: "timer" }, () => cancelTimer(ctx));
      await ctx.commands.register({ id: "show-timer", title: "$t:command.show.title", description: "$t:command.show.description", icon: "timer" }, () => showTimer(ctx));
    },
    async stop() {
      await Promise.all([...activeContexts].map((ctx) => stopContext(ctx)));
    },
  });
}
