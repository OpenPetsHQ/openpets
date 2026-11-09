import { canonicalizePluginPermissions, type PluginIcon, type PluginPermission, type KnownPluginRuntime } from "./plugin-manifest.js";
import type { PluginCatalog } from "./plugin-contract-types.js";
export type { PluginCatalog, PluginCatalogEntry, PluginCatalogEntryV2 } from "./plugin-contract-types.js";


const catalogFields = new Set(["version", "generatedAt", "plugins"]);
const entryFields = new Set(["id", "name", "version", "description", "runtime", "icon", "permissions", "downloadUrl", "sha256", "minOpenPetsVersion"]);
const entryFieldsV2 = new Set([...entryFields, "iconDataUrl", "sdkVersion", "maxOpenPetsVersion", "disabled", "deprecated", "statusReason", "network", "publisherType"]);
const idPattern = /^[a-z0-9][a-z0-9._-]{1,62}[a-z0-9]$/;
const versionPattern = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const shaPattern = /^[0-9a-f]{64}$/;
const iconDataUrlPattern = /^data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+$/;
const supportedPluginIcons = new Set(["plugin", "bell", "timer", "github", "heart", "sparkles", "coffee", "focus", "droplet"]);

export function validatePluginCatalog(input: unknown): PluginCatalog {
  if (!isRecord(input)) throw new Error("Plugin catalog must be an object.");
  rejectUnknown(input, catalogFields, "catalog");
  if (input.version !== 1 && input.version !== 2) throw new Error("Plugin catalog version must be 1 or 2.");
  requireString(input.generatedAt, "generatedAt", 1, 128);
  if (!Array.isArray(input.plugins)) throw new Error("Plugin catalog plugins must be an array.");
  if (input.plugins.length > 1000) throw new Error("Plugin catalog contains too many plugins.");
  const seen = new Set<string>();
  const plugins = input.plugins.map((entry, index) => {
    if (!isRecord(entry)) throw new Error(`Plugin catalog entry ${index} must be an object.`);
    rejectUnknown(entry, input.version === 2 ? entryFieldsV2 : entryFields, `plugins[${index}]`);
    const id = requireString(entry.id, "id", 3, 64, idPattern);
    if (seen.has(id)) throw new Error(`Duplicate plugin id: ${id}`);
    seen.add(id);
    const permissions = canonicalizePluginPermissions(entry.permissions);
    const base = { id, name: requireString(entry.name, "name", 1, 120), version: requireString(entry.version, "version", 1, 80, versionPattern), description: requireString(entry.description, "description", 0, 1000), runtime: requireRuntime(entry.runtime, input.version), icon: normalizeIcon(entry.icon), permissions, downloadUrl: requireString(entry.downloadUrl, "downloadUrl", 1, 2048), sha256: requireString(entry.sha256, "sha256", 64, 64, shaPattern), minOpenPetsVersion: entry.minOpenPetsVersion === undefined ? undefined : requireString(entry.minOpenPetsVersion, "minOpenPetsVersion", 1, 80, versionPattern) };
    if (input.version === 1) return base;
    const hasNetworkPermission = permissions.includes("network");
    if (base.runtime === "javascript" && entry.sdkVersion === undefined) throw new Error("Invalid plugin catalog sdkVersion.");
    if (base.runtime === "javascript" && permissions.includes("timer")) throw new Error("Invalid plugin catalog permissions.");
    if (hasNetworkPermission && entry.network === undefined) throw new Error("Invalid plugin catalog network.hosts.");
    if (!hasNetworkPermission && entry.network !== undefined) throw new Error("Invalid plugin catalog network.hosts.");
    return { ...base, iconDataUrl: entry.iconDataUrl === undefined ? undefined : requireString(entry.iconDataUrl, "iconDataUrl", 1, 100_000, iconDataUrlPattern), sdkVersion: entry.sdkVersion === undefined ? undefined : requireString(entry.sdkVersion, "sdkVersion", 1, 80, versionPattern), maxOpenPetsVersion: entry.maxOpenPetsVersion === undefined ? undefined : requireString(entry.maxOpenPetsVersion, "maxOpenPetsVersion", 1, 80, versionPattern), disabled: entry.disabled === undefined ? undefined : requireBoolean(entry.disabled, "disabled"), deprecated: entry.deprecated === undefined ? undefined : requireBoolean(entry.deprecated, "deprecated"), statusReason: entry.statusReason === undefined ? undefined : requireString(entry.statusReason, "statusReason", 1, 500), network: normalizeNetwork(entry.network), publisherType: normalizePublisherType(entry.publisherType) };
  });
  return { version: input.version, generatedAt: String(input.generatedAt), plugins } as PluginCatalog;
}

function requireRuntime(value: unknown, catalogVersion: unknown): KnownPluginRuntime { if (value !== "declarative" && !(catalogVersion === 2 && value === "javascript")) throw new Error(catalogVersion === 2 ? 'Plugin runtime must be "declarative" or "javascript".' : 'Plugin runtime must be "declarative".'); return value; }
function normalizeIcon(value: unknown): PluginIcon | undefined { if (value === undefined) return undefined; if (typeof value !== "string" || !supportedPluginIcons.has(value)) throw new Error("Invalid plugin catalog icon."); return value as PluginIcon; }
function requireBoolean(value: unknown, name: string): boolean { if (typeof value !== "boolean") throw new Error(`Invalid plugin catalog ${name}.`); return value; }
function normalizeNetwork(value: unknown): { readonly hosts: readonly string[] } | undefined { if (value === undefined) return undefined; if (!isRecord(value) || !Array.isArray(value.hosts)) throw new Error("Invalid plugin catalog network.hosts."); rejectUnknown(value, new Set(["hosts"]), "network"); return { hosts: value.hosts.map((host) => requireString(host, "network.hosts", 1, 253, /^[a-z0-9.-]+(?::\d{1,5})?$/i)) }; }
function normalizePublisherType(value: unknown): "official" | "community" { if (value === undefined) return "official"; if (value !== "official" && value !== "community") throw new Error("Invalid plugin catalog publisherType."); return value; }
function requireString(value: unknown, name: string, min: number, max: number, pattern?: RegExp): string { if (typeof value !== "string" || value.length < min || value.length > max || (min > 0 && value.trim() === "")) throw new Error(`Invalid plugin catalog ${name}.`); if (pattern && !pattern.test(value)) throw new Error(`Invalid plugin catalog ${name}.`); return value; }
function rejectUnknown(record: Record<string, unknown>, allowed: Set<string>, path: string): void { for (const key of Object.keys(record)) if (!allowed.has(key)) throw new Error(`Unknown field ${path}.${key}.`); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
