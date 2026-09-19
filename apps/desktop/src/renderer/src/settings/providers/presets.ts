import {
  providerSupportsRole,
  type ProviderPreset,
  type ProviderRole,
} from "../../../../provider-contract.js";
import type { ProviderControlCenterSnapshot } from "./types.js";

export type CustomProviderTemplate = {
  readonly id: "custom";
  readonly label: "Custom Endpoint";
};

/** UI-only blank form action; it is not a provider catalog entry. */
export const CUSTOM_TEMPLATE: CustomProviderTemplate = Object.freeze({
  id: "custom",
  label: "Custom Endpoint",
});

export function getPresetCatalog(
  snapshot?: Pick<ProviderControlCenterSnapshot, "presets"> | null,
): readonly ProviderPreset[] {
  return snapshot?.presets ?? [];
}

export function getPresetsByRole(
  presets: readonly ProviderPreset[],
  role: ProviderRole,
): readonly ProviderPreset[] {
  return presets.filter((preset) => providerSupportsRole(preset.adapter, role));
}

export function getPresetById(
  id: string,
  presets: readonly ProviderPreset[],
): ProviderPreset | undefined {
  return presets.find((preset) => preset.id === id);
}

export function generateRandomProfileId(prefix = "provider"): string {
  const cleanPrefix = prefix.toLowerCase().replace(/[^a-z0-9]/g, "-").slice(0, 16);
  const randomSuffix = Math.random().toString(36).substring(2, 6);
  return `${cleanPrefix}-${randomSuffix}`;
}
