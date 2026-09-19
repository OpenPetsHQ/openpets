import {
  defaultProviderAuth,
  providerDefinition,
  providerSupportsRole,
  type ProviderAdapter,
  type ProviderAuth,
  type ProviderCredentialPolicy,
  type ProviderHeader,
  type ProviderHeaderPatch,
  type ProviderPreset,
  type ProviderProfile,
  type ProviderRole,
} from "../../../../provider-contract.js";

export {
  defaultProviderAuth,
  providerDefinition,
  providerSupportsRole,
  type ProviderAdapter,
  type ProviderAuth,
  type ProviderCredentialPolicy,
  type ProviderHeader,
  type ProviderHeaderPatch,
  type ProviderPreset,
  type ProviderProfile,
  type ProviderRole,
} from "../../../../provider-contract.js";

export type CredentialPolicy = ProviderCredentialPolicy;

type PublicProviderProfile<T> = T extends ProviderProfile
  ? Omit<T, "headers" | "secretRef">
  : never;

export type ProviderProfileSummary = PublicProviderProfile<ProviderProfile> & {
  readonly realtimeModel?: string;
  readonly voice?: string;
  readonly headerNames: readonly string[];
  readonly hasCredential: boolean;
};

export type ProviderSelections = {
  readonly text: string | null;
  readonly stt: string | null;
  readonly tts: string | null;
};

export type ProviderStatusState = "ready" | "disabled" | "invalid" | "missing-secret" | "unsupported";

export type ProviderStatus = {
  readonly role: ProviderRole | "realtime";
  readonly state: ProviderStatusState;
  readonly code: string;
  readonly message: string;
  readonly profileId?: string;
};

export type ProviderGates = {
  readonly allowPluginAudio: boolean;
  readonly allowDynamicSpeech: boolean;
  readonly allowPluginVoice: boolean;
  readonly allowMicrophone: boolean;
  readonly quietHours: {
    readonly enabled: boolean;
    readonly start: string;
    readonly end: string;
  };
};

export type ProviderGatesPatch = Partial<Omit<ProviderGates, "quietHours">> & {
  readonly quietHours?: Partial<ProviderGates["quietHours"]>;
};

export type ProviderControlCenterSnapshot = {
  readonly gates: ProviderGates;
  readonly profiles: readonly ProviderProfileSummary[];
  readonly selections: ProviderSelections;
  readonly statuses: Readonly<Record<ProviderRole | "realtime", ProviderStatus>>;
  readonly presets: readonly ProviderPreset[];
};

export type ProviderProfileInput = ProviderProfile;
export type ProviderProfilePatch = {
  id?: ProviderProfile["id"];
  label?: ProviderProfile["label"];
  adapter?: ProviderAdapter;
  model?: ProviderProfile["model"];
  realtimeModel?: string | null;
  voice?: string | null;
  baseUrl?: string | null;
  auth?: ProviderAuth | null;
  headers?: readonly ProviderHeader[];
  headerPatch?: readonly ProviderHeaderPatch[];
};

export type ProviderConfigurationSaveInput = {
  readonly isEditing: boolean;
  readonly profileId: string;
  readonly payload: ProviderProfileInput | ProviderProfilePatch;
  readonly credentialValue?: string;
  readonly activatedRoles: readonly ProviderRole[];
  readonly deactivatedRoles: readonly ProviderRole[];
};

export type ProviderConfigurationTestResult =
  | { readonly kind: "text"; readonly detail: string }
  | { readonly kind: "stt"; readonly detail: string }
  | { readonly kind: "tts"; readonly bytes: Uint8Array; readonly mimeType: "audio/mpeg" }
  | { readonly kind: "realtime"; readonly detail: string }
  | { readonly kind: "system-tts" };

export function profileSupportsRole(
  profile: { adapter: ProviderAdapter },
  role: ProviderRole,
): boolean {
  return providerSupportsRole(profile.adapter, role);
}

export function isLocalEndpointUrl(url?: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host === "[::1]" ||
      host.endsWith(".local")
    ) {
      return true;
    }
    const octets = host.split(".").map(Number);
    if (
      octets.length === 4 &&
      octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)
    ) {
      if (
        octets[0] === 10 ||
        octets[0] === 127 ||
        (octets[0] === 192 && octets[1] === 168) ||
        (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
      ) {
        return true;
      }
    }
  } catch {
    const lower = url.toLowerCase();
    return (
      lower.includes("127.0.0.1") ||
      lower.includes("localhost") ||
      lower.includes("::1") ||
      lower.includes(".local")
    );
  }
  return false;
}

export function getProfileCredentialPolicy(profile: {
  adapter: ProviderAdapter;
  baseUrl?: string;
  credentialMode?: ProviderCredentialPolicy;
}): ProviderCredentialPolicy {
  if (profile.credentialMode) return profile.credentialMode;
  const definition = providerDefinition(profile.adapter);
  if (definition.credentialPolicy === "none") return "none";
  if (isLocalEndpointUrl(profile.baseUrl)) return "optional";
  return definition.credentialPolicy;
}

export function getDefaultAuthHeader(adapter: ProviderAdapter): string {
  return defaultProviderAuth(adapter).headerName;
}

export function getDefaultAuthStrategy(adapter: ProviderAdapter): "bearer" | "raw" {
  return defaultProviderAuth(adapter).strategy;
}
