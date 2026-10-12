import { define as definePlugin, type Context } from "@opencode/plugin/promise/plugin";

import { sanitizeOpenCodeExcludedReactions, validateOpenPetsPetArg } from "./opencode-previews.js";
import { createOpenPetsOpenCodeRuntime, type OpenCodePluginOptions, type OpenCodePluginRuntime } from "./opencode-plugin-runtime.js";

export const openPetsOpenCodePluginId = "open-pets-opencode";

const plugin = definePlugin({
  id: openPetsOpenCodePluginId,
  async setup(context) {
    const runtime = createOpenPetsOpenCodeRuntime(readPluginOptions(context.options));
    const abortController = new AbortController();
    const registrations: Array<{ dispose: () => Promise<void> }> = [];
    let eventConsumer = Promise.resolve();
    let stopping: Promise<void> | undefined;

    const stop = (): Promise<void> => {
      stopping ??= teardown(runtime, abortController, registrations, eventConsumer);
      return stopping;
    };

    try {
      const events = context.event.subscribe({ signal: abortController.signal });
      eventConsumer = consumeEvents(events, abortController.signal, runtime);
      registrations.push(await context.session.hook("prompt", () => {
        runtime.prompt();
      }));
      registrations.push(await context.tool.hook("execute.before", (event) => {
        runtime.toolBefore(event.tool, event.input);
      }));
      registrations.push(await context.tool.hook("execute.after", (event) => {
        runtime.toolAfter(event);
      }));
    } catch (error) {
      await stop();
      throw error;
    }

    return stop;
  },
});

export default plugin;

async function consumeEvents(events: AsyncIterable<unknown>, signal: AbortSignal, runtime: OpenCodePluginRuntime): Promise<void> {
  try {
    for await (const envelope of events) {
      if (signal.aborted) break;
      runtime.event(envelope);
    }
  } catch (error) {
    if (!signal.aborted) runtime.reportError("event subscription failed", error);
  }
}

async function teardown(
  runtime: OpenCodePluginRuntime,
  abortController: AbortController,
  registrations: ReadonlyArray<{ dispose: () => Promise<void> }>,
  eventConsumer: Promise<void>,
): Promise<void> {
  abortController.abort();
  const cleanup = runtime.cleanup();
  const disposals = registrations.map(async (registration) => {
    try {
      await registration.dispose();
    } catch (error) {
      runtime.reportError("hook dispose failed", error);
    }
  });
  await Promise.all([cleanup, ...disposals]);
  await eventConsumer;
}

function readPluginOptions(options: Context["options"]): OpenCodePluginOptions {
  const pet = readPetOption(options.pet);
  const debug = typeof options.debug === "boolean" ? options.debug : undefined;
  const excludeReactions = Array.isArray(options.excludeReactions)
    ? sanitizeOpenCodeExcludedReactions(options.excludeReactions)
    : undefined;

  return {
    ...(pet === undefined ? {} : { pet }),
    ...(debug === undefined ? {} : { debug }),
    ...(excludeReactions === undefined ? {} : { excludeReactions }),
  };
}

function readPetOption(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error("Invalid OpenPets pet id.");
  return validateOpenPetsPetArg(value);
}
