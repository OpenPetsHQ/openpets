const activePanels = new WeakMap();

const DEFAULT_CONFIG = {
  soundEnabled: true,
  defaultTool: "smash",
};

const STRING_KEYS = [
  "plugin.name",
  "plugin.description",
  "command.open.title",
  "command.open.description",
  "config.soundEnabled.label",
  "config.soundEnabled.description",
  "config.defaultTool.label",
  "config.defaultTool.description",
  "tool.smash",
  "tool.paint",
  "tool.stamp",
  "tool.erase",
  "panel.hud.tool",
  "panel.hud.score",
  "panel.subtitle.title",
  "panel.subtitle.hint",
  "panel.subtitle.safety",
  "panel.option.color",
  "panel.option.size",
  "panel.option.symbol",
  "panel.option.eraserRadius",
  "panel.color.teal",
  "panel.color.red",
  "panel.color.purple",
  "panel.color.yellow",
  "panel.color.white",
  "panel.size.small",
  "panel.size.medium",
  "panel.size.large",
  "panel.symbol.star",
  "panel.symbol.heart",
  "panel.symbol.fire",
  "panel.symbol.gem",
  "panel.symbol.rocket",
  "panel.symbol.sparkles",
  "panel.desktop.work",
  "panel.desktop.files",
  "panel.desktop.notes",
  "panel.sound.mute",
  "panel.sound.enable",
  "panel.button.help",
  "panel.button.clearCanvas",
  "panel.help.heading",
  "panel.help.description",
  "panel.help.close",
];

function panelStrings(ctx) {
  return Object.fromEntries(STRING_KEYS.map((key) => [key, ctx.t(key)]));
}

function panelConfig(value) {
  const config = value && typeof value === "object" ? value : {};
  return {
    soundEnabled: typeof config.soundEnabled === "boolean"
      ? config.soundEnabled
      : DEFAULT_CONFIG.soundEnabled,
    defaultTool: typeof config.defaultTool === "string"
      ? config.defaultTool
      : DEFAULT_CONFIG.defaultTool,
  };
}

async function sendInit(ctx, state) {
  if (state.stopped || !state.panel) return;
  const panel = state.panel;
  const sequence = ++state.initSequence;
  const config = panelConfig(await ctx.config.get());
  if (state.stopped || state.panel !== panel || sequence !== state.initSequence) return;
  try {
    await panel.postMessage({
      type: "init",
      config,
      strings: panelStrings(ctx),
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Plugin panel is no longer open.") {
      if (state.panel === panel) {
        state.panel = undefined;
        state.initSequence += 1;
        state.unsubscribeConfig?.();
        state.unsubscribeConfig = undefined;
      }
      return;
    }
    throw error;
  }
}

function releaseState(ctx, state) {
  if (activePanels.get(ctx) === state) activePanels.delete(ctx);
}

async function createPanel(ctx, state) {
  const panel = await ctx.ui.panel({
    panel: "playground",
    title: ctx.t("plugin.name"),
    width: 900,
    height: 640,
  });

  if (state.stopped || activePanels.get(ctx) !== state) {
    await panel.close();
    return undefined;
  }

  state.panel = panel;
  panel.onMessage(async (message) => {
    if (
      state.stopped
      || state.panel !== panel
      || !message
      || typeof message !== "object"
      || !["ready", "request-init"].includes(message.type)
    ) {
      return;
    }
    await sendInit(ctx, state);
  });

  state.unsubscribeConfig = ctx.config.onChange(() => sendInit(ctx, state));

  await sendInit(ctx, state);
  if (state.stopped || state.panel !== panel) {
    await panel.close();
    return undefined;
  }

  await panel.show();
  if (state.stopped || state.panel !== panel) {
    await panel.close();
    return undefined;
  }
  return panel;
}

export async function openPlaygroundPanel(ctx) {
  let state = activePanels.get(ctx);
  if (!state) {
    state = {
      panel: undefined,
      opening: undefined,
      stopped: false,
      unsubscribeConfig: undefined,
      initSequence: 0,
    };
    activePanels.set(ctx, state);
  }
  if (state.stopped) return undefined;
  if (state.opening) return state.opening;

  const opening = openPanel(ctx, state);
  state.opening = opening;
  try {
    return await opening;
  } catch (error) {
    state.unsubscribeConfig?.();
    state.unsubscribeConfig = undefined;
    const panel = state.panel;
    state.panel = undefined;
    releaseState(ctx, state);
    if (panel) {
      try {
        await panel.close();
      } catch (closeError) {
        throw new AggregateError(
          [error, closeError],
          "Opening the playground panel failed and cleanup could not close it.",
        );
      }
    }
    throw error;
  } finally {
    if (state.opening === opening) state.opening = undefined;
  }
}

async function openPanel(ctx, state) {
  if (state.panel) {
    try {
      await state.panel.show();
      if (!state.stopped) return state.panel;
      return undefined;
    } catch {
      state.panel = undefined;
      state.unsubscribeConfig?.();
      state.unsubscribeConfig = undefined;
    }
  }
  if (state.stopped) return undefined;
  return createPanel(ctx, state);
}

export function register(OpenPetsPlugin) {
  OpenPetsPlugin.register({
    async start(ctx) {
      const icon = ctx.assets.icon("desktop-playground");
      await ctx.commands.register(
        {
          id: "open",
          title: "$t:command.open.title",
          description: "$t:command.open.description",
          icon,
        },
        () => openPlaygroundPanel(ctx),
      );
    },
    async stop(ctx) {
      const state = activePanels.get(ctx);
      if (!state) return;

      state.stopped = true;
      state.unsubscribeConfig?.();
      state.unsubscribeConfig = undefined;

      let openingError;
      if (state.opening) {
        try {
          await state.opening;
        } catch (error) {
          openingError = error;
        }
      }

      const panel = state.panel;
      state.panel = undefined;

      if (panel) await panel.close();
      if (openingError) throw openingError;
    },
  });
}
