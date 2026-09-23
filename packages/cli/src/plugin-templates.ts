/**
 * SDK v3 plugin templates for `openpets plugin new --template <name>` (§18.4).
 * Each template ships a typed entry, a valid manifestVersion-3 manifest, a
 * passing test built on `@open-pets/plugin-sdk/testing`, and a README.
 */

export type PluginTemplateName = "blank" | "reminder" | "ambient" | "ai-chat" | "tamagotchi" | "calendar";

export const pluginTemplateNames: readonly PluginTemplateName[] = ["blank", "reminder", "ambient", "ai-chat", "tamagotchi", "calendar"];

export type PluginTemplateContext = { readonly id: string; readonly name: string };

export type PluginTemplate = {
  readonly description: string;
  readonly permissions: readonly string[];
  readonly configSchema: Record<string, unknown>;
  readonly entry: (ctx: PluginTemplateContext) => string;
  readonly test: (ctx: PluginTemplateContext) => string;
  /**
   * Templates that localize host-rendered strings (`$t:` manifest refs) and
   * runtime-composed bodies (`ctx.t(...)`) ship a source `locales/en.json`.
   * Returns the flat dotted key map; the scaffolder writes it verbatim.
   */
  readonly locales?: (ctx: PluginTemplateContext) => Record<string, string>;
};

const sharedTestHeader = `import assert from "node:assert/strict";
import { createTestHarness } from "@open-pets/plugin-sdk/testing";
import { register } from "./index.js";
`;

export const pluginTemplates: Record<PluginTemplateName, PluginTemplate> = {
  blank: {
    description: "A minimal starting point with one command.",
    permissions: ["pet:speak", "pet:reaction", "commands", "status"],
    configSchema: {},
    entry: ({ name }) => `/// <reference types="@open-pets/plugin-sdk" />

export function register(OpenPetsPlugin) {
  OpenPetsPlugin.register({
    async start(ctx) {
      await ctx.status.set({ text: ${JSON.stringify(`${name} is ready`)}, tone: "info" });

      await ctx.commands.register(
        { id: "say-hello", title: "Say hello", description: "Get a friendly greeting." },
        async () => {
          await ctx.pet.speak(${JSON.stringify(`Hello from ${name}!`)});
          await ctx.pet.react("waving");
        },
      );
    },

    async stop() {},
  });
}
`,
    test: () => `${sharedTestHeader}
const h = createTestHarness(register, { permissions: ["pet:speak", "pet:reaction", "commands", "status"] });
await h.start();
await h.runCommand("say-hello");
h.expectSpoke(/hello/i);
h.expectReacted("waving");
console.log("blank template tests passed.");
`,
  },

  reminder: {
    description:
      "Quick local reminders delivered with ctx.ui.alert: sound, a sticky bubble you can snooze, and optional notification. Fully localized via $t: + ctx.t().",
    permissions: ["pet:speak", "pet:interact", "audio", "schedule", "storage", "commands", "status", "notify"],
    configSchema: {
      soundEnabled: { type: "boolean", label: "$t:config.soundEnabled.label", description: "$t:config.soundEnabled.description", default: true },
      osNotification: { type: "boolean", label: "$t:config.osNotification.label", description: "$t:config.osNotification.description", default: true },
      customSound: { type: "sound", label: "$t:config.customSound.label", description: "$t:config.customSound.description" },
    },
    entry: () => `/// <reference types="@open-pets/plugin-sdk" />
//
// Quick reminders that mirror the shipped openpets.reminders reference plugin.
// Keeps a "Set reminder…" form plus 15/30/60-minute presets, but delivers with
// the acknowledge pattern: ctx.ui.alert(...) with Done / Snooze 5m actions,
// optional custom sound, and optional OS notification. Host-rendered
// static strings use $t: manifest refs; every runtime-composed body flows
// through ctx.t(key, vars) so the host can localize it.

export const MAX_REMINDERS = 10;
export const MAX_MESSAGE_LENGTH = 140;
export const MAX_DELAY_MS = 24 * 60 * 60 * 1000;
export const SNOOZE_MS = 5 * 60 * 1000;

export function cleanMessage(value, fallback = "Reminder time.") {
  const text =
    typeof value === "string"
      ? value.trim().replace(/[\\r\\n]+/g, " ").replace(/\\s+/g, " ")
      : "";
  return (text || fallback).slice(0, MAX_MESSAGE_LENGTH).trim() || fallback;
}

export function durationMs(values = {}) {
  const hours = Math.max(0, Math.min(23, Math.round(Number(values.hours ?? 0))));
  const minutes = Math.max(0, Math.min(59, Math.round(Number(values.minutes ?? 0))));
  const ms = (hours * 60 + minutes) * 60_000;
  if (ms < 60_000 || ms > MAX_DELAY_MS) {
    throw new Error("Reminder duration must be 1 minute to 24 hours.");
  }
  return ms;
}

export async function getReminders(ctx) {
  const reminders = await ctx.storage.get("reminders");
  return Array.isArray(reminders)
    ? reminders
        .filter(
          (r) =>
            r &&
            typeof r.id === "string" &&
            typeof r.dueAt === "number" &&
            typeof r.message === "string",
        )
        .slice(0, MAX_REMINDERS)
    : [];
}

async function saveReminders(ctx, reminders) {
  const list = reminders.slice(0, MAX_REMINDERS);
  await ctx.storage.set("reminders", list);
  await updateStatus(ctx, list.length);
  return list;
}

async function updateStatus(ctx, count) {
  const text = count > 0 ? ctx.t("status.active", { count }) : ctx.t("status.none");
  await ctx.status.set({ text, tone: "info" });
}

export async function scheduleReminder(ctx, reminder) {
  const delay = Math.max(1, reminder.dueAt - Date.now());
  await ctx.schedule.once(reminder.id, delay, () => fireReminder(ctx, reminder.id));
}

export async function addReminder(ctx, message, delayMs) {
  const reminders = (await getReminders(ctx)).filter((r) => r.dueAt > Date.now());
  if (reminders.length >= MAX_REMINDERS) {
    throw new Error(ctx.t("error.tooMany", { max: MAX_REMINDERS }));
  }
  const reminder = {
    id: \`reminder-\${Date.now().toString(36)}-\${Math.floor(Math.random() * 1e6).toString(36)}\`.slice(0, 64),
    message: cleanMessage(message, ctx.t("reminder.defaultMessage")),
    dueAt: Date.now() + delayMs,
  };
  reminders.push(reminder);
  await saveReminders(ctx, reminders);
  await scheduleReminder(ctx, reminder);
  await ctx.pet.speak(ctx.t("speech.set", { minutes: Math.max(1, Math.round(delayMs / 60_000)) }));
  return reminder;
}

async function deliver(ctx, message, { missed = false } = {}) {
  const config = (await ctx.config.get()) ?? {};
  const soundEnabled = config.soundEnabled !== false;
  const osNotification = config.osNotification !== false;

  const text = missed ? ctx.t("bubble.missed", { message }) : ctx.t("bubble.due", { message });

  let alert;
  try {
    alert = await ctx.ui.alert({
      text,
      icon: "bell",
      tone: "info",
      sound: soundEnabled ? config.customSound || "alert" : undefined,
      notify: osNotification
        ? { title: ctx.t("notify.title"), body: missed ? ctx.t("notify.bodyMissed", { message }) : message }
        : undefined,
      dismissOn: ["petClick", "click", "action"],
      actions: [
        { id: "done", label: ctx.t("action.done"), style: "primary" },
        { id: "snooze", label: ctx.t("action.snooze") },
      ],
    });
  } catch {
    try {
      await ctx.pet.speak(text);
    } catch {
      // last resort already attempted.
    }
  }

  if (alert) {
    alert.onAction(async (actionId) => {
      if (actionId === "snooze") {
        await addReminder(ctx, message, SNOOZE_MS);
      }
    });
  }

}

export async function fireReminder(ctx, id) {
  const reminders = await getReminders(ctx);
  const item = reminders.find((r) => r.id === id);
  await saveReminders(ctx, reminders.filter((r) => r.id !== id));
  if (!item) return false;
  await deliver(ctx, item.message);
  return true;
}

export async function reconcile(ctx) {
  await ctx.schedule.cancelAll();
  const now = Date.now();
  const reminders = await getReminders(ctx);
  const future = reminders.filter((r) => r.dueAt > now);
  const overdue = reminders.filter((r) => r.dueAt <= now);
  await saveReminders(ctx, future);
  for (const item of future) await scheduleReminder(ctx, item);
  for (const item of overdue) await deliver(ctx, item.message, { missed: true });
}

async function showReminderList(ctx) {
  const reminders = await getReminders(ctx);
  const now = Date.now();
  const pending = reminders.filter((r) => r.dueAt > now);
  if (!pending.length) {
    await ctx.pet.speak(ctx.t("speech.none"));
    await ctx.ui.menu.setItems([]);
    return;
  }
  await ctx.ui.menu.setItems(
    pending.slice(0, MAX_REMINDERS).map((reminder) => ({
      id: \`cancel:\${reminder.id}\`.slice(0, 64),
      title: ctx.t("menu.item", {
        minutes: Math.max(1, Math.ceil((reminder.dueAt - now) / 60_000)),
        message: reminder.message,
      }),
      icon: "bell",
      onSelect: async () => {
        await ctx.schedule.cancel(reminder.id);
        const remaining = (await getReminders(ctx)).filter((r) => r.id !== reminder.id);
        await saveReminders(ctx, remaining);
        await ctx.pet.speak(ctx.t("speech.cancelled", { message: reminder.message }));
        await showReminderList(ctx);
      },
    })),
  );
}

export function register(OpenPetsPlugin) {
  OpenPetsPlugin.register({
    async start(ctx) {
      await reconcile(ctx);

      await ctx.commands.register(
        {
          id: "set-reminder",
          title: "$t:command.setReminder.title",
          description: "$t:command.setReminder.description",
          form: {
            submitLabel: "$t:command.setReminder.submit",
            fields: [
              { id: "message", type: "textarea", label: "$t:form.message.label", required: true, maxLength: MAX_MESSAGE_LENGTH },
              { id: "hours", type: "number", label: "$t:form.hours.label", default: 0, min: 0, max: 23 },
              { id: "minutes", type: "number", label: "$t:form.minutes.label", default: 15, min: 0, max: 59 },
            ],
          },
        },
        async (values) => addReminder(ctx, values.message, durationMs(values)),
      );

      await ctx.commands.register(
        { id: "reminder-15", title: "$t:command.reminder15.title", description: "$t:command.reminder15.description" },
        () => addReminder(ctx, ctx.t("reminder.defaultMessage"), 15 * 60_000),
      );
      await ctx.commands.register(
        { id: "reminder-30", title: "$t:command.reminder30.title", description: "$t:command.reminder30.description" },
        () => addReminder(ctx, ctx.t("reminder.defaultMessage"), 30 * 60_000),
      );
      await ctx.commands.register(
        { id: "reminder-60", title: "$t:command.reminder60.title", description: "$t:command.reminder60.description" },
        () => addReminder(ctx, ctx.t("reminder.defaultMessage"), 60 * 60_000),
      );

      await ctx.commands.register(
        { id: "view-reminders", title: "$t:command.viewReminders.title", description: "$t:command.viewReminders.description" },
        () => showReminderList(ctx),
      );

      await ctx.commands.register(
        { id: "clear-reminders", title: "$t:command.clearReminders.title", description: "$t:command.clearReminders.description" },
        async () => {
          await ctx.schedule.cancelAll();
          await saveReminders(ctx, []);
          await ctx.ui.menu.setItems([]);
          await ctx.pet.speak(ctx.t("speech.cleared"));
        },
      );
    },
    async stop() {},
  });
}
`,
    test: () => `import assert from "node:assert/strict";
import { createTestHarness } from "@open-pets/plugin-sdk/testing";
import { register, cleanMessage, durationMs, MAX_REMINDERS } from "./index.js";

const PERMISSIONS = [
  "pet:speak",
  "pet:interact",
  "audio",
  "schedule",
  "storage",
  "commands",
  "status",
  "notify",
];

const LOCALES = {
  en: JSON.parse(
    await (await import("node:fs/promises")).readFile(new URL("./locales/en.json", import.meta.url), "utf8"),
  ),
};

// --- pure helper unit checks --------------------------------------------
assert.equal(cleanMessage("  hello\\nthere  "), "hello there");
assert.equal(cleanMessage("", "fallback"), "fallback");
assert.equal(durationMs({ hours: 1, minutes: 30 }), 90 * 60_000);
assert.throws(() => durationMs({ hours: 0, minutes: 0 }));
assert.equal(MAX_REMINDERS, 10);

// 1) Setting a reminder via the form schedules it, then fires with the
//    acknowledge pattern (sound + bubble + notification).
{
  const h = createTestHarness(register, {
    permissions: PERMISSIONS,
    config: { soundEnabled: true, osNotification: true, customSound: "gong" },
    locales: LOCALES,
    nowMs: 1_000_000,
  });
  await h.start();

  await h.runCommand("set-reminder", { message: "Drink water", hours: 0, minutes: 30 });
  h.expectStored("reminders", (v) => Array.isArray(v) && v.length === 1 && v[0].message === "Drink water");

  await h.clock.advance("31m");
  h.expectBubble({ icon: "bell", tone: "info", sticky: true, priority: "high" });
  h.expectBubble({ textMatch: /Drink water/ });
  h.expectNotified(/Drink water/);
  assert.equal(h.calls.alerts.length, 1, "expected ctx.ui.alert delivery");
  assert.ok(h.calls.sounds.some((s) => s.sound === "gong"), "expected the custom alert sound to play");
  h.expectStored("reminders", (v) => Array.isArray(v) && v.length === 0);
  h.expectNoErrors();
}

// 2) A preset fires and the Snooze action reschedules +5m.
{
  const h = createTestHarness(register, {
    permissions: PERMISSIONS,
    config: { soundEnabled: false, osNotification: false },
    locales: LOCALES,
    nowMs: 2_000_000,
  });
  await h.start();
  await h.runCommand("reminder-15");
  h.expectStored("reminders", (v) => v.length === 1);

  await h.clock.advance("16m");
  const bubble = h.calls.bubbles[h.calls.bubbles.length - 1];
  assert.deepEqual(bubble.spec.actions?.map((a) => a.id), ["done", "snooze"]);
  await h.fireBubbleAction(bubble.handle.id, "snooze");
  h.expectStored("reminders", (v) => v.length === 1 && v[0].dueAt > h.clock.now());
  h.expectNoErrors();
}

// 3) clear-reminders cancels everything.
{
  const h = createTestHarness(register, { permissions: PERMISSIONS, locales: LOCALES });
  await h.start();
  await h.runCommand("reminder-15");
  await h.runCommand("clear-reminders");
  h.expectStored("reminders", (v) => Array.isArray(v) && v.length === 0);
  h.expectSpoke(/cleared/i);
  h.expectNoErrors();
}

console.log("reminder template tests passed.");
`,
    locales: () => ({
      "config.soundEnabled.label": "Play a sound",
      "config.soundEnabled.description": "Play an alert sound when a reminder is due.",
      "config.osNotification.label": "Show a system notification",
      "config.osNotification.description": "Also post a desktop notification when a reminder is due.",
      "config.customSound.label": "Custom alert sound",
      "config.customSound.description": "Optional sound to play instead of the default alert sound.",

      "command.setReminder.title": "Set reminder…",
      "command.setReminder.description": "Create a quick local reminder.",
      "command.setReminder.submit": "Set Reminder",
      "command.reminder15.title": "15 min reminder",
      "command.reminder15.description": "Set a reminder for 15 minutes from now.",
      "command.reminder30.title": "30 min reminder",
      "command.reminder30.description": "Set a reminder for 30 minutes from now.",
      "command.reminder60.title": "1 hour reminder",
      "command.reminder60.description": "Set a reminder for 1 hour from now.",
      "command.viewReminders.title": "View reminders",
      "command.viewReminders.description": "List pending reminders and cancel any of them.",
      "command.clearReminders.title": "Clear reminders",
      "command.clearReminders.description": "Cancel all pending reminders.",

      "form.message.label": "Message",
      "form.hours.label": "Hours",
      "form.minutes.label": "Minutes",

      "reminder.defaultMessage": "Reminder time.",

      "status.active": "{count} reminder(s) active",
      "status.none": "No active reminders",

      "speech.set": "Reminder set for {minutes} min from now.",
      "speech.none": "No active reminders.",
      "speech.cleared": "Reminders cleared.",
      "speech.cancelled": "Cancelled: {message}",

      "bubble.due": "{message}",
      "bubble.missed": "Missed while away: {message}",

      "action.done": "Done",
      "action.snooze": "Snooze 5m",

      "menu.item": "in {minutes} min: {message}",

      "notify.title": "Quick Reminders",
      "notify.bodyMissed": "Missed while away: {message}",

      "error.tooMany": "Quick Reminders can keep up to {max} active reminders.",
    }),
  },

  ambient: {
    description: "Gentle ambient presence driven by the senses bus.",
    permissions: ["pet:speak", "pet:reaction", "schedule", "events", "status"],
    configSchema: {
      checkInMinutes: { type: "number", label: "Check-in minutes", default: 45, min: 10, max: 480 },
    },
    entry: () => `/// <reference types="@open-pets/plugin-sdk" />

export function register(OpenPetsPlugin) {
  OpenPetsPlugin.register({
    async start(ctx) {
      const config = await ctx.config.get();
      const intervalMinutes = Math.max(10, Number(config.checkInMinutes ?? 45));

      await ctx.schedule.every("ambient-check-in", intervalMinutes * 60_000, async () => {
        await ctx.pet.speak("Still here with you.");
      });

      ctx.events.on("idle:exit", () => {
        void ctx.pet.react("waving");
      });

      ctx.events.on("pet:clicked", () => {
        void ctx.pet.react("celebrating");
      });

      ctx.events.on("day:partChanged", (event) => {
        if (event.part === "evening") void ctx.pet.speak("Evening already. Pace yourself.");
      });
    },
  });
}
`,
    test: () => `${sharedTestHeader}
const h = createTestHarness(register, {
  permissions: ["pet:speak", "pet:reaction", "schedule", "events", "status"],
  config: { checkInMinutes: 45 },
});
await h.start();
h.expectScheduled("ambient-check-in");
await h.clock.advance("45m");
h.expectSpoke(/still here/i);
await h.emit("pet:clicked", { petId: "default" });
h.expectReacted("celebrating");
await h.emit("day:partChanged", { part: "evening" });
h.expectSpoke(/evening/i);
h.expectNoErrors();
console.log("ambient template tests passed.");
`,
  },

  "ai-chat": {
    description: "A chat pet on the host AI gateway with model-generated speech.",
    permissions: ["pet:speak", "pet:speak:dynamic", "pet:interact", "pet:reaction", "commands", "status", "ai"],
    configSchema: {
      personality: { type: "textarea", label: "Personality", default: "You are a tiny upbeat desktop pet. Reply in one short sentence.", maxLength: 500 },
    },
    entry: () => `/// <reference types="@open-pets/plugin-sdk" />

export function register(OpenPetsPlugin) {
  OpenPetsPlugin.register({
    async start(ctx) {
      await ctx.commands.register(
        {
          id: "ask-pet",
          title: "Ask the pet…",
          form: { fields: [{ id: "question", type: "text", label: "Question", maxLength: 300, required: true }], submitLabel: "Ask" },
        },
        async (values) => {
          if (!(await ctx.ai.available())) {
            await ctx.pet.speak("No AI provider is set up yet.");
            return;
          }
          const config = await ctx.config.get();
          await ctx.pet.react("thinking");
          const bubble = await ctx.pet.speak({ text: "…", dynamic: true, sticky: true });
          let answer = "";
          await ctx.ai.stream(
            { system: String(config.personality ?? ""), messages: [{ role: "user", content: String(values?.question ?? "") }], maxTokens: 200 },
            (token) => {
              answer += token;
              void bubble.update({ markdown: answer, dynamic: true });
            },
          );
          await bubble.update({ markdown: answer, dynamic: true, sticky: false, durationMs: 12_000 });
          await ctx.pet.react("success");
        },
      );
    },
  });
}
`,
    test: () => `${sharedTestHeader}
const h = createTestHarness(register, {
  permissions: ["pet:speak", "pet:speak:dynamic", "pet:interact", "pet:reaction", "commands", "status", "ai"],
});
h.ai.mock(() => "I feel sleepy but happy.");
await h.start();
await h.runCommand("ask-pet", { question: "How do you feel?" });
assert.equal(h.calls.aiCalls.length, 1);
h.expectReacted("success");
const live = h.calls.bubbles.find((bubble) => bubble.spec.dynamic);
assert.ok(live, "asked question produced a dynamic bubble");
assert.ok(live.updates.length > 0, "streaming updated the bubble in place");
console.log("ai-chat template tests passed.");
`,
  },

  tamagotchi: {
    description: "A virtual pet with needs, moods, feeding, and a live stats pin.",
    permissions: ["pet:speak", "pet:interact", "pet:pin", "pet:reaction", "commands", "status", "schedule", "storage", "events", "audio", "notify"],
    configSchema: {
      decayMinutes: { type: "number", label: "Need decay minutes", default: 30, min: 10, max: 240 },
    },
    entry: ({ name }) => `/// <reference types="@open-pets/plugin-sdk" />

const clamp = (value) => Math.max(0, Math.min(100, Math.round(value)));

export function register(OpenPetsPlugin) {
  OpenPetsPlugin.register({
    async start(ctx) {
      const config = await ctx.config.get();
      const decayMinutes = Math.max(10, Number(config.decayMinutes ?? 30));

      const loadStats = async () => {
        const stats = (await ctx.storage.get("stats")) ?? { hunger: 80, energy: 80, affection: 60, lastSeen: Date.now() };
        // Catch up decay across restarts/sleep from wall-clock time.
        const elapsedTicks = Math.floor((Date.now() - (stats.lastSeen ?? Date.now())) / (decayMinutes * 60_000));
        if (elapsedTicks > 0) {
          stats.hunger = clamp(stats.hunger - elapsedTicks * 6);
          stats.energy = clamp(stats.energy - elapsedTicks * 4);
          stats.affection = clamp(stats.affection - elapsedTicks * 3);
        }
        stats.lastSeen = Date.now();
        await ctx.storage.set("stats", stats);
        return stats;
      };

      const moodOf = (stats) => {
        if (stats.hunger < 25) return "hungry";
        if (stats.energy < 25) return "sleepy";
        if (stats.affection < 25) return "lonely";
        return "happy";
      };

      let pinned = null;
      const refreshPin = async (stats) => {
        const mood = moodOf(stats);
        const text = mood === "happy"
          ? \`Mood: happy · 🍖 \${stats.hunger} ⚡ \${stats.energy} ♥ \${stats.affection}\`
          : \`I'm \${mood}! · 🍖 \${stats.hunger} ⚡ \${stats.energy} ♥ \${stats.affection}\`;
        if (pinned) { await pinned.update({ text }); return; }
        pinned = await ctx.pet.speak({ text, pin: true, icon: "heart", priority: mood === "happy" ? "low" : "high" });
        pinned.onDismiss(() => { pinned = null; });
      };

      const applyMood = async (stats) => {
        const mood = moodOf(stats);
        if (mood === "hungry") await ctx.pet.react("waiting");
        else if (mood === "sleepy") await ctx.pet.react("idle");
        else if (mood === "lonely") await ctx.pet.react("error");
        else await ctx.pet.react("success");
        await refreshPin(stats);
      };

      const stats = await loadStats();
      await applyMood(stats);

      await ctx.schedule.every("decay", decayMinutes * 60_000, async () => {
        const current = await loadStats();
        current.hunger = clamp(current.hunger - 6);
        current.energy = clamp(current.energy - 4);
        current.affection = clamp(current.affection - 3);
        await ctx.storage.set("stats", current);
        await applyMood(current);
        if (moodOf(current) !== "happy") {
          await ctx.notify.notify({ title: ${JSON.stringify(name)}, body: "Your pet needs attention." });
        }
      });

      ctx.events.on("pet:clicked", async () => {
        const current = await loadStats();
        current.affection = clamp(current.affection + 8);
        await ctx.storage.set("stats", current);
        await ctx.pet.speak({ text: "♥", icon: "heart", durationMs: 1500, priority: "low" });
        await applyMood(current);
      });

      await ctx.commands.register({ id: "feed", title: "Feed", priority: 10 }, async () => {
        const current = await loadStats();
        current.hunger = clamp(current.hunger + 30);
        await ctx.storage.set("stats", current);
        await ctx.audio.play("nom").catch(() => undefined);
        await ctx.pet.speak({ text: "Nom nom!", icon: "food", durationMs: 2500 });
        await applyMood(current);
      });

      await ctx.commands.register({ id: "play", title: "Play", priority: 9 }, async () => {
        const current = await loadStats();
        current.affection = clamp(current.affection + 15);
        current.energy = clamp(current.energy - 10);
        await ctx.storage.set("stats", current);
        await ctx.pet.react("celebrating");
        await applyMood(current);
      });

      await ctx.commands.register({ id: "nap", title: "Nap time" }, async () => {
        const current = await loadStats();
        current.energy = clamp(current.energy + 40);
        await ctx.storage.set("stats", current);
        await ctx.pet.speak("Zzz…");
        await applyMood(current);
      });
    },
  });
}
`,
    test: () => `${sharedTestHeader}
const PERMISSIONS = ["pet:speak", "pet:interact", "pet:pin", "pet:reaction", "commands", "status", "schedule", "storage", "events", "audio", "notify"];
const h = createTestHarness(register, { permissions: PERMISSIONS, config: { decayMinutes: 30 } });
await h.start();
h.expectScheduled("decay");
h.expectStored("stats", (stats) => stats.hunger <= 100 && stats.hunger >= 0);
h.expectBubble({ pin: true });

await h.runCommand("feed");
h.expectSpoke(/nom/i);
h.expectStored("stats", (stats) => stats.hunger >= 80);

await h.emit("pet:clicked", { petId: "default" });
h.expectStored("stats", (stats) => stats.affection > 60);

// Needs decay over time and the pet complains when neglected.
await h.clock.advance("4h");
h.expectStored("stats", (stats) => stats.hunger < 100);
h.expectNoErrors();
console.log("tamagotchi template tests passed.");
`,
  },

  calendar: {
    description: "Calendar companion: .ics import, countdown pin, event reminders.",
    permissions: ["pet:speak", "pet:interact", "pet:pin", "pet:reaction", "commands", "status", "schedule", "storage", "files", "notify"],
    configSchema: {
      reminderMinutes: { type: "number", label: "Remind before (minutes)", default: 10, min: 1, max: 120 },
    },
    entry: () => `/// <reference types="@open-pets/plugin-sdk" />

const parseIcs = (text) => {
  const events = [];
  for (const block of text.split("BEGIN:VEVENT").slice(1)) {
    const summary = /SUMMARY:(.*)/.exec(block)?.[1]?.trim();
    const start = /DTSTART(?:;[^:]*)?:(\\d{8}T\\d{6}Z?)/.exec(block)?.[1];
    if (!summary || !start) continue;
    const iso = start.replace(/^(\\d{4})(\\d{2})(\\d{2})T(\\d{2})(\\d{2})(\\d{2})(Z?)$/, "$1-$2-$3T$4:$5:$6$7");
    const startsAt = Date.parse(iso);
    if (Number.isFinite(startsAt)) events.push({ summary: summary.slice(0, 120), startsAt });
  }
  return events.sort((a, b) => a.startsAt - b.startsAt);
};

export function register(OpenPetsPlugin) {
  OpenPetsPlugin.register({
    async start(ctx) {
      const config = await ctx.config.get();
      const reminderMinutes = Math.max(1, Number(config.reminderMinutes ?? 10));
      let pinned = null;

      const armReminders = async () => {
        const events = (await ctx.storage.get("events")) ?? [];
        const upcoming = events.filter((event) => event.startsAt > Date.now());
        await ctx.storage.set("events", upcoming);
        const next = upcoming[0];
        if (!next) { if (pinned) { await pinned.dismiss(); pinned = null; } return; }
        const label = \`Next: \${next.summary}\`;
        if (pinned) await pinned.update({ text: label });
        else {
          pinned = await ctx.pet.speak({ text: label, pin: true, icon: "timer" });
          pinned.onDismiss(() => { pinned = null; });
        }
        const remindAt = new Date(next.startsAt - reminderMinutes * 60_000).toISOString();
        await ctx.schedule.at("next-event-reminder", remindAt, async () => {
          // Drop the reminded event first so re-arming never repeats it.
          const remaining = ((await ctx.storage.get("events")) ?? []).filter((event) => !(event.summary === next.summary && event.startsAt === next.startsAt));
          await ctx.storage.set("events", remaining);
          await ctx.notify.notify({ title: "Upcoming event", body: next.summary });
          await ctx.pet.speak({ text: \`\${next.summary} in \${reminderMinutes} min\`, icon: "bell", sticky: true, actions: [{ id: "ok", label: "OK", style: "primary" }] });
          await ctx.pet.react("waiting");
          await armReminders();
        });
      };

      await ctx.commands.register({ id: "import-ics", title: "Import calendar (.ics)" }, async () => {
        const files = await ctx.files.pick({ accept: [".ics"] });
        if (files.length === 0) return;
        const text = await files[0].readText();
        const events = parseIcs(text).filter((event) => event.startsAt > Date.now()).slice(0, 50);
        await ctx.storage.set("events", events);
        await ctx.pet.speak(\`Imported \${events.length} upcoming events.\`);
        await armReminders();
      });

      await ctx.commands.register({ id: "whats-next", title: "What's next?" }, async () => {
        const events = (await ctx.storage.get("events")) ?? [];
        const next = events.find((event) => event.startsAt > Date.now());
        await ctx.pet.speak(next ? \`Next up: \${next.summary}\` : "Nothing on the calendar.");
      });

      await armReminders();
    },
  });
}
`,
    test: () => `${sharedTestHeader}
const PERMISSIONS = ["pet:speak", "pet:interact", "pet:pin", "pet:reaction", "commands", "status", "schedule", "storage", "files", "notify"];
const h = createTestHarness(register, { permissions: PERMISSIONS, config: { reminderMinutes: 10 } });
const startsAt = new Date(h.clock.now() + 60 * 60_000);
const stamp = startsAt.toISOString().replace(/[-:]/g, "").replace(/\\.\\d{3}/, "");
h.files.provide([{ name: "work.ics", text: "BEGIN:VEVENT\\nSUMMARY:Standup\\nDTSTART:" + stamp + "\\nEND:VEVENT" }]);
await h.start();
await h.runCommand("import-ics");
h.expectSpoke(/imported 1 upcoming/i);
h.expectBubble({ pin: true });
h.expectScheduled("next-event-reminder");
await h.clock.advance("51m");
h.expectNotified(/standup/i);
h.expectNoErrors();
console.log("calendar template tests passed.");
`,
  },
};
