import type {
  AssistantJsonObject,
  PetAssistantCapability,
  PetAssistantCapabilitySnapshot,
  PetAssistantTool,
} from "./pet-assistant-types.js";

const providerSafeName = /^[a-z0-9_-]+$/;
export const PET_ASSISTANT_PROVIDER_TOOL_NAME_MAX_BYTES = 64;
const shortIdentitySuffixLength = 8;
const fullIdentitySuffixLength = 16;

export type PetAssistantToolTarget = {
  readonly pluginId: string;
  readonly capabilityId: string;
  readonly description: string;
  readonly handle: PetAssistantCapability["handle"];
};

export type PetAssistantToolSet = {
  readonly tools: readonly PetAssistantTool[];
  readonly targetsByName: ReadonlyMap<string, PetAssistantToolTarget>;
  readonly snapshot: PetAssistantCapabilitySnapshot;
};

type ProviderToolNameInput = {
  readonly identity: string;
  readonly baseName: string;
  readonly requiresSuffix: boolean;
};

/** A stable readable name suitable for providers that reject punctuation. */
export function petAssistantToolName(pluginId: string, capabilityId: string): string {
  const baseName = normalizeIdentity(pluginId, capabilityId);
  const suffixLength = byteLength(baseName) > PET_ASSISTANT_PROVIDER_TOOL_NAME_MAX_BYTES
    ? shortIdentitySuffixLength
    : 0;
  return createProviderToolName(baseName, `${pluginId}\u0000${capabilityId}`, suffixLength);
}

export function buildPetAssistantTools(snapshot: PetAssistantCapabilitySnapshot): PetAssistantToolSet {
  const capabilities = [...snapshot.capabilities]
    .map((entry) => cloneCapability(entry))
    .sort((left, right) => {
      const pluginOrder = compare(left.pluginId, right.pluginId);
      return pluginOrder || compare(left.capability.id, right.capability.id);
    });
  const tools: PetAssistantTool[] = [];
  const targetsByName = new Map<string, PetAssistantToolTarget>();
  const identities = new Set<string>();
  const normalized = capabilities.map((entry) => {
    const identity = `${entry.pluginId}\u0000${entry.capability.id}`;
    return {
      entry,
      identity,
      baseName: normalizeIdentity(entry.pluginId, entry.capability.id),
    };
  });
  for (const value of normalized) {
    if (identities.has(value.identity)) throw new Error(`Duplicate assistant capability: ${value.entry.pluginId}/${value.entry.capability.id}.`);
    identities.add(value.identity);
  }
  const baseCounts = new Map<string, number>();
  for (const value of normalized) baseCounts.set(value.baseName, (baseCounts.get(value.baseName) ?? 0) + 1);
  const names = assignProviderToolNames(normalized.map((value) => ({
    identity: value.identity,
    baseName: value.baseName,
    requiresSuffix: (baseCounts.get(value.baseName) ?? 0) > 1,
  })));

  for (const value of normalized) {
    const entry = value.entry;
    const target = { pluginId: entry.pluginId, capabilityId: entry.capability.id, handle: entry.handle };
    const identity = `${target.pluginId}\u0000${target.capabilityId}`;
    const name = names.get(identity);
    if (!name) throw new Error("Assistant tool name was not assigned.");
    if (!providerSafeName.test(name)) throw new Error("Assistant tool name is not provider-safe.");
    const existing = targetsByName.get(name);
    if (existing && (existing.pluginId !== target.pluginId || existing.capabilityId !== target.capabilityId)) {
      throw new Error(`Assistant tool name collision for ${name}.`);
    }
    targetsByName.set(name, { ...target, description: entry.capability.description });
    tools.push(Object.freeze({
      name,
      description: entry.capability.description,
      inputSchema: entry.capability.inputSchema,
    }));
  }

  return Object.freeze({
    tools: Object.freeze(tools),
    targetsByName,
    snapshot: Object.freeze({
      capabilities: Object.freeze(capabilities),
    }),
  });
}

function cloneCapability(value: PetAssistantCapability): PetAssistantCapability {
  if (!value || typeof value.pluginId !== "string" || value.pluginId.length === 0) throw new Error("Invalid assistant capability plugin id.");
  if (!value.capability || typeof value.capability.id !== "string" || value.capability.id.length === 0) throw new Error("Invalid assistant capability id.");
  if (!value.handle || typeof value.handle !== "object") throw new Error("Invalid assistant capability handle.");
  if (typeof value.capability.description !== "string" || value.capability.description.trim() === "") throw new Error("Invalid assistant capability description.");
  if (!isPlainObject(value.capability.inputSchema)) throw new Error("Invalid assistant capability input schema.");
  return Object.freeze({
    pluginId: value.pluginId,
    handle: value.handle,
    capability: Object.freeze({
      id: value.capability.id,
      description: value.capability.description,
      inputSchema: cloneAndFreezeJsonObject(value.capability.inputSchema),
    }),
  });
}

function assignProviderToolNames(values: readonly ProviderToolNameInput[]): ReadonlyMap<string, string> {
  let suffixLength = shortIdentitySuffixLength;
  const forcedSuffixes = new Set(values.filter((value) => value.requiresSuffix).map((value) => value.identity));
  for (;;) {
    const assigned = new Map<string, string>();
    const identitiesByName = new Map<string, string>();
    const collisions = new Map<string, string[]>();
    for (const value of values) {
      const needsSuffix = forcedSuffixes.has(value.identity)
        || byteLength(value.baseName) > PET_ASSISTANT_PROVIDER_TOOL_NAME_MAX_BYTES;
      const name = createProviderToolName(value.baseName, value.identity, needsSuffix ? suffixLength : 0);
      const existingIdentity = identitiesByName.get(name);
      if (existingIdentity && existingIdentity !== value.identity) {
        const identitiesForName = collisions.get(name) ?? [existingIdentity];
        identitiesForName.push(value.identity);
        collisions.set(name, identitiesForName);
      }
      identitiesByName.set(name, value.identity);
      assigned.set(value.identity, name);
    }
    if (collisions.size === 0 && assigned.size === values.length) return assigned;
    for (const identitiesForName of collisions.values()) {
      for (const identity of identitiesForName) forcedSuffixes.add(identity);
    }
    if (suffixLength === fullIdentitySuffixLength) throw new Error("Assistant tool name collision could not be resolved.");
    suffixLength = fullIdentitySuffixLength;
  }
}

function normalizeIdentity(pluginId: string, capabilityId: string): string {
  const plugin = normalizeNamePart(pluginId);
  const capability = normalizeNamePart(capabilityId);
  return [plugin, capability].filter(Boolean).join("_") || "capability";
}

function normalizeNamePart(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function createProviderToolName(baseName: string, identity: string, suffixLength: number): string {
  if (suffixLength === 0 && byteLength(baseName) <= PET_ASSISTANT_PROVIDER_TOOL_NAME_MAX_BYTES) return baseName;
  const suffix = identitySuffix(identity).slice(0, suffixLength);
  const prefixLength = PET_ASSISTANT_PROVIDER_TOOL_NAME_MAX_BYTES - suffix.length - 1;
  if (prefixLength < 1) throw new Error("Assistant tool name suffix is too large.");
  return `${baseName.slice(0, prefixLength)}_${suffix}`;
}

function identitySuffix(identity: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < identity.length; index += 1) {
    const code = identity.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ (code + index), 0x01000193);
  }
  return `${toHex(first)}${toHex(second)}`;
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function cloneAndFreezeJsonObject(value: AssistantJsonObject): AssistantJsonObject {
  const clone = (input: unknown): unknown => {
    if (Array.isArray(input)) return Object.freeze(input.map(clone));
    if (input && typeof input === "object") {
      const object: AssistantJsonObject = {};
      for (const [key, child] of Object.entries(input)) object[key] = clone(child);
      return Object.freeze(object);
    }
    return input;
  };
  return clone(value) as AssistantJsonObject;
}

function isPlainObject(value: unknown): value is AssistantJsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function toHex(value: number): string {
  return (value >>> 0).toString(16).padStart(8, "0");
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
