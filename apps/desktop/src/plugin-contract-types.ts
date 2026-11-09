export type PluginRuntime = "declarative";
export type KnownPluginRuntime = PluginRuntime | "javascript";
export type PluginPermission =
  | "pet:speak" | "pet:reaction" | "pet:move" | "timer" | "schedule" | "storage" | "status" | "commands" | "network"
  | "pet:interact" | "pet:pin" | "pet:animate" | "pet:speak:dynamic" | "pet:drop" | "pets:read" | "pets:manage"
  | "audio" | "events" | "ui:toast" | "ui:panel" | "ui:delivery" | "ui:session" | "notify" | "bus" | "ai" | "secrets"
  | "voice:speak" | "voice:listen" | "auth" | "files" | "system:openExternal" | "system:metrics" | "clipboard" | "network:write" | "network:local";
export type PluginIcon = "plugin" | "bell" | "timer" | "github" | "heart" | "sparkles" | "coffee" | "focus" | "droplet";

export type PluginCatalogEntry = { readonly id: string; readonly name: string; readonly version: string; readonly description: string; readonly runtime: "declarative"; readonly icon?: PluginIcon; readonly permissions: readonly PluginPermission[]; readonly downloadUrl: string; readonly sha256: string; readonly minOpenPetsVersion?: string };
export type PluginCatalogEntryV2 = Omit<PluginCatalogEntry, "runtime"> & { readonly runtime: KnownPluginRuntime; readonly iconDataUrl?: string; readonly sdkVersion?: string; readonly maxOpenPetsVersion?: string; readonly disabled?: boolean; readonly deprecated?: boolean; readonly statusReason?: string; readonly network?: { readonly hosts: readonly string[] }; readonly publisherType?: "official" | "community" };
export type PluginCatalog = { readonly version: 1; readonly generatedAt: string; readonly plugins: readonly PluginCatalogEntry[] } | { readonly version: 2; readonly generatedAt: string; readonly plugins: readonly PluginCatalogEntryV2[] };
