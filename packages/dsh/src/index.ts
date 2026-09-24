import type { Context } from "@deepseek-ai/cordis";

export {
  classifyDshEvent,
  createOpenPetsDshClient,
  createOpenPetsDshRuntime,
  registerDshListeners,
  type DshCordisApi,
  type DshAgentStatus,
  type DshEventName,
  type DshEventDecision,
  type OpenPetsDshOptions,
  type OpenPetsDshRuntime,
} from "./runtime.js";

import { registerDshListeners, type OpenPetsDshOptions } from "./runtime.js";

export const name = "@open-pets/dsh";

/** Configuration options for the OpenPets DSH plugin. */
export interface Config extends OpenPetsDshOptions {
  /** Master switch to enable or disable OpenPets notifications. Default: true. */
  enabled?: boolean;
}

/** Install the OpenPets listeners into the DSH Cordis context. */
export function apply(ctx: Context, config: Config = {}): void {
  if (config.enabled === false) return;
  registerDshListeners(ctx, config);
}
