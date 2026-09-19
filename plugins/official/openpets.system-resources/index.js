/// <reference types="@open-pets/plugin-sdk" />

export const SCHEDULE_ID = "system-resources-tick";
export const ALERT_COOLDOWN_MS = 10 * 60_000;
export const DEFAULT_POLL_SECONDS = 10;
export const DEFAULT_ALERT_PERCENT = 90;

const pinnedBubbles = new WeakMap();
const lastAlerts = new WeakMap();
const lastSnapshots = new WeakMap();
const pollActive = new WeakMap();
const scheduleGenerations = new WeakMap();

export function clampPercent(value) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function toneFor(percent) {
  if (percent == null) return "slate";
  if (percent >= 90) return "red";
  if (percent >= 70) return "amber";
  return "green";
}

export function hottestMetric(snapshot) {
  const rows = [
    ["cpu", snapshot.cpu],
    ["ram", snapshot.ram],
    ["gpu", snapshot.gpu],
    ["disk", snapshot.disk],
  ];
  let hottest = null;
  for (const [key, value] of rows) {
    if (value == null) continue;
    if (!hottest || value > hottest.value) {
      hottest = { key, value };
    }
  }
  return hottest;
}

export function mergeSnapshot(hostMetrics = {}, now = Date.now()) {
  return {
    cpu: clampPercent(hostMetrics.cpuPercent) ?? 0,
    ram: clampPercent(hostMetrics.memUsedPercent) ?? 0,
    gpu: clampPercent(hostMetrics.gpuPercent),
    disk: clampPercent(hostMetrics.diskUsedPercent),
    sampledAt: now,
  };
}

export function readConfig(raw = {}) {
  const pollSeconds = Number(raw.pollSeconds ?? DEFAULT_POLL_SECONDS);
  const alertPercent = Number(raw.alertPercent ?? DEFAULT_ALERT_PERCENT);
  return {
    showHud: raw.showHud !== false,
    speakAlerts: raw.speakAlerts !== false,
    pollSeconds: Math.max(5, Math.min(60, Number.isFinite(pollSeconds) ? pollSeconds : DEFAULT_POLL_SECONDS)),
    alertPercent: Math.max(70, Math.min(99, Number.isFinite(alertPercent) ? alertPercent : DEFAULT_ALERT_PERCENT)),
  };
}

function getPinned(ctx) {
  return pinnedBubbles.get(ctx) ?? null;
}

function setPinned(ctx, handle) {
  if (handle) pinnedBubbles.set(ctx, handle);
  else pinnedBubbles.delete(ctx);
}

function getGeneration(ctx) {
  return scheduleGenerations.get(ctx) ?? 0;
}

function nextGeneration(ctx) {
  const next = getGeneration(ctx) + 1;
  scheduleGenerations.set(ctx, next);
  return next;
}

function isActive(ctx) {
  return Boolean(pollActive.get(ctx));
}

export async function isHudVisible(ctx, cfg) {
  const settings = cfg ?? readConfig((await ctx.config.get()) ?? {});
  if (settings.showHud === false) return false;
  const stored = await ctx.storage.get("hudVisible");
  if (stored === false) return false;
  return true;
}

export function hudSpec(ctx, snapshot) {
  const items = [];
  if (snapshot.cpu != null) {
    items.push({
      icon: ctx.assets.icon("cpu"),
      value: snapshot.cpu,
      tone: toneFor(snapshot.cpu),
      label: ctx.t("hud.cpu"),
    });
  }
  if (snapshot.ram != null) {
    items.push({
      icon: ctx.assets.icon("ram"),
      value: snapshot.ram,
      tone: toneFor(snapshot.ram),
      label: ctx.t("hud.ram"),
    });
  }
  if (snapshot.gpu != null) {
    items.push({
      icon: ctx.assets.icon("gpu"),
      value: snapshot.gpu,
      tone: toneFor(snapshot.gpu),
      label: ctx.t("hud.gpu"),
    });
  }
  if (snapshot.disk != null) {
    items.push({
      icon: ctx.assets.icon("disk"),
      value: snapshot.disk,
      tone: toneFor(snapshot.disk),
      label: ctx.t("hud.disk"),
    });
  }
  return {
    tone: "info",
    sticky: true,
    pin: true,
    dismissOn: [],
    priority: "normal",
    hud: { items },
  };
}

export async function updateHud(ctx, snapshot, cfg, expectedGen) {
  const visible = await isHudVisible(ctx, cfg);
  if (!visible) {
    const pinned = getPinned(ctx);
    if (pinned) {
      setPinned(ctx, null);
      try {
        await pinned.dismiss();
      } catch {}
    }
    return;
  }

  if (!isActive(ctx)) return;
  if (expectedGen !== undefined && getGeneration(ctx) !== expectedGen) return;

  const spec = hudSpec(ctx, snapshot);
  const pinned = getPinned(ctx);
  if (pinned) {
    try {
      await pinned.update(spec);
      return;
    } catch {
      setPinned(ctx, null);
    }
  }

  if (!isActive(ctx)) return;
  if (expectedGen !== undefined && getGeneration(ctx) !== expectedGen) return;

  try {
    const bubble = await ctx.ui.bubble(spec);
    if (
      !isActive(ctx) ||
      (expectedGen !== undefined && getGeneration(ctx) !== expectedGen) ||
      !(await isHudVisible(ctx, cfg))
    ) {
      try {
        await bubble.dismiss();
      } catch {}
      return;
    }
    bubble.onDismiss(() => {
      if (getPinned(ctx)?.id === bubble.id) {
        setPinned(ctx, null);
      }
    });
    setPinned(ctx, bubble);
  } catch (error) {
    try {
      await ctx.log?.warn?.("Failed to create resource HUD bubble", {
        reason: error instanceof Error ? error.message : String(error),
      });
    } catch {}
  }
}

export async function collectSnapshot(ctx, now = Date.now()) {
  let hostMetrics = null;
  try {
    hostMetrics = await ctx.system.metrics();
  } catch (error) {
    try {
      await ctx.log?.warn?.("Failed to sample system metrics", {
        reason: error instanceof Error ? error.message : String(error),
      });
    } catch {}
  }

  if (!hostMetrics || typeof hostMetrics !== "object") {
    const last = lastSnapshots.get(ctx) ?? (await ctx.storage.get("snapshot"));
    if (last && typeof last === "object" && typeof last.cpu === "number" && typeof last.ram === "number") {
      return { ...last, sampledAt: now };
    }
    return mergeSnapshot({}, now);
  }

  const snapshot = mergeSnapshot(hostMetrics, now);
  lastSnapshots.set(ctx, snapshot);
  return snapshot;
}

export async function publishStatus(ctx, snapshot) {
  const hasExtended = snapshot.gpu != null || snapshot.disk != null;
  const key = hasExtended ? "status.lineFull" : "status.line";
  const text = ctx.t(key, {
    cpu: `${snapshot.cpu}%`,
    ram: `${snapshot.ram}%`,
    gpu: `${snapshot.gpu ?? 0}%`,
    disk: `${snapshot.disk ?? 0}%`,
  });
  const hottest = hottestMetric(snapshot);
  const tone = hottest && hottest.value >= 90 ? "error" : hottest && hottest.value >= 70 ? "warning" : "info";
  try {
    await ctx.status.set({ text, tone });
  } catch {}
}

export async function maybeAlert(ctx, snapshot, now = Date.now(), cfg) {
  const settings = cfg ?? readConfig((await ctx.config.get()) ?? {});
  if (!settings.speakAlerts) return null;
  const hottest = hottestMetric(snapshot);
  if (!hottest || hottest.value < settings.alertPercent) return null;

  const previous = lastAlerts.get(ctx) ?? (await ctx.storage.get("lastAlertAt")) ?? 0;
  if (now - previous < ALERT_COOLDOWN_MS) return null;
  lastAlerts.set(ctx, now);
  await ctx.storage.set("lastAlertAt", now);

  try {
    await ctx.pet.react("error", { showMessage: false });
    await ctx.pet.speak(
      ctx.t("speech.alert", {
        label: ctx.t(`hud.${hottest.key}`),
        value: String(hottest.value),
      }),
    );
  } catch (error) {
    try {
      await ctx.log?.warn?.("Failed to speak resource load alert", {
        reason: error instanceof Error ? error.message : String(error),
      });
    } catch {}
  }
  return hottest;
}

export async function tick(ctx, now = Date.now()) {
  const gen = getGeneration(ctx);
  const cfg = readConfig((await ctx.config.get()) ?? {});
  const snapshot = await collectSnapshot(ctx, now);
  await ctx.storage.set("snapshot", snapshot);
  await updateHud(ctx, snapshot, cfg, gen);
  await publishStatus(ctx, snapshot);
  await maybeAlert(ctx, snapshot, now, cfg);
  return snapshot;
}

export async function showHud(ctx) {
  await ctx.storage.set("hudVisible", true);
  return await tick(ctx);
}

export async function hideHud(ctx) {
  await ctx.storage.set("hudVisible", false);
  const pinned = getPinned(ctx);
  if (pinned) {
    setPinned(ctx, null);
    try {
      await pinned.dismiss();
    } catch {}
  }
}

export async function speakSnapshot(ctx) {
  const snapshot = await collectSnapshot(ctx, Date.now());
  const hasExtended = snapshot.gpu != null || snapshot.disk != null;
  const key = hasExtended ? "speech.snapshotFull" : "speech.snapshot";
  const text = ctx.t(key, {
    cpu: `${snapshot.cpu}%`,
    ram: `${snapshot.ram}%`,
    gpu: `${snapshot.gpu ?? 0}%`,
    disk: `${snapshot.disk ?? 0}%`,
  });
  try {
    await ctx.pet.speak(text);
  } catch {}
  return snapshot;
}

export async function armSchedule(ctx) {
  const gen = getGeneration(ctx);
  const cfg = readConfig((await ctx.config.get()) ?? {});
  const intervalMs = cfg.pollSeconds * 1000;
  try {
    await ctx.schedule.cancel(SCHEDULE_ID);
  } catch {}
  if (!isActive(ctx) || getGeneration(ctx) !== gen) return;
  try {
    await ctx.schedule.once(SCHEDULE_ID, intervalMs, async () => {
      if (!isActive(ctx) || getGeneration(ctx) !== gen) return;
      try {
        await tick(ctx);
      } catch (error) {
        try {
          await ctx.log?.warn?.("system-resources tick failed", {
            reason: error instanceof Error ? error.message : String(error),
          });
        } catch {}
      } finally {
        if (isActive(ctx) && getGeneration(ctx) === gen) {
          try {
            await armSchedule(ctx);
          } catch (error) {
            try {
              await ctx.log?.warn?.("system-resources schedule rearm failed", {
                reason: error instanceof Error ? error.message : String(error),
              });
            } catch {}
          }
        }
      }
    });
  } catch {}
}

export function register(OpenPetsPlugin) {
  let activeContext;
  OpenPetsPlugin.register({
    async start(ctx) {
      activeContext = ctx;
      pollActive.set(ctx, true);
      nextGeneration(ctx);

      const storedAlert = await ctx.storage.get("lastAlertAt");
      if (typeof storedAlert === "number") {
        lastAlerts.set(ctx, storedAlert);
      }

      await tick(ctx);
      await armSchedule(ctx);

      ctx.config.onChange(async () => {
        if (!isActive(ctx)) return;
        nextGeneration(ctx);
        await armSchedule(ctx);
        await tick(ctx);
      });

      const icon = ctx.assets.icon("system-resources");

      await ctx.commands.register(
        {
          id: "show",
          title: "$t:command.show.title",
          description: "$t:command.show.description",
          icon,
        },
        () => showHud(ctx),
      );

      await ctx.commands.register(
        {
          id: "hide",
          title: "$t:command.hide.title",
          description: "$t:command.hide.description",
          icon,
        },
        () => hideHud(ctx),
      );

      await ctx.commands.register(
        {
          id: "snapshot",
          title: "$t:command.snapshot.title",
          description: "$t:command.snapshot.description",
          icon,
        },
        () => speakSnapshot(ctx),
      );

      if (ctx.assistant?.registerCapability) {
        await ctx.assistant.registerCapability(
          {
            id: "resources.get",
            description: "Read current CPU, RAM, and optional GPU and system-volume disk usage percents from the host.",
            inputSchema: { type: "object", properties: {}, additionalProperties: false },
          },
          async () => {
            const snapshot = await collectSnapshot(ctx);
            const result = {
              cpuPercent: snapshot.cpu,
              ramPercent: snapshot.ram,
            };
            if (snapshot.gpu != null) {
              result.gpuPercent = snapshot.gpu;
            }
            if (snapshot.disk != null) {
              result.diskPercent = snapshot.disk;
            }
            return result;
          },
        );
      }
    },
    async stop() {
      const current = activeContext;
      activeContext = undefined;
      if (!current) return;
      pollActive.set(current, false);
      nextGeneration(current);
      try {
        await current.schedule.cancel(SCHEDULE_ID);
      } catch {}
      const pinned = getPinned(current);
      if (pinned) {
        setPinned(current, null);
        try {
          await pinned.dismiss();
        } catch {}
      }
    },
  });
}
