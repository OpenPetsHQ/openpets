import type { SceneSettings } from "../protocol.js";

export interface StoredScene {
  version: 1;
  instances: Array<{
    id: string;
    petId: string;
    name: string;
    outfitId: string;
  }>;
  selectedInstanceId: string | null;
  settings: SceneSettings;
}

export type SceneStoreCommand =
  | { type: "addInstance"; id: string; petId: string; name: string }
  | { type: "renameInstance"; instanceId: string; name: string }
  | { type: "removeInstance"; instanceId: string }
  | { type: "selectInstance"; instanceId: string }
  | { type: "setInstanceOutfit"; instanceId: string; outfitId: string }
  | { type: "setSceneSettings"; changes: Partial<SceneSettings> };

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid scene object.");
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, keys: readonly string[]): void {
  if (
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    throw new Error("Invalid scene fields.");
}
function identifier(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value)
  )
    throw new Error("Invalid scene identifier.");
  return value;
}
function petIdentifier(value: unknown): string {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value))
    throw new Error("Invalid pet identifier.");
  return value;
}
function outfitIdentifier(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[a-z0-9][a-z0-9_-]{0,31}$/.test(value) ||
    value === "auto"
  )
    throw new Error("Invalid outfit identifier.");
  return value;
}
function instanceName(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid companion name.");
  const trimmed = value.trim();
  if (!trimmed || Array.from(trimmed).length > 40)
    throw new Error("Invalid companion name.");
  return trimmed;
}
function changes(value: unknown, requireAll: boolean): Partial<SceneSettings> {
  const input = object(value);
  const allowed = ["size", "motion", "paused", "backdrop"];
  const fields = Object.keys(input);
  if (
    !fields.length ||
    fields.some((key) => !allowed.includes(key)) ||
    (requireAll && fields.length !== allowed.length)
  )
    throw new Error("Invalid scene settings.");
  const result: Partial<SceneSettings> = {};
  if ("size" in input) {
    if (
      input.size !== "small" &&
      input.size !== "medium" &&
      input.size !== "large"
    )
      throw new Error("Invalid scene size.");
    result.size = input.size;
  }
  if ("motion" in input) {
    if (
      input.motion !== "still" &&
      input.motion !== "calm" &&
      input.motion !== "playful"
    )
      throw new Error("Invalid scene motion.");
    result.motion = input.motion;
  }
  if ("paused" in input) {
    if (typeof input.paused !== "boolean")
      throw new Error("Invalid pause setting.");
    result.paused = input.paused;
  }
  if ("backdrop" in input) {
    if (input.backdrop !== "plain" && input.backdrop !== "dots")
      throw new Error("Invalid scene backdrop.");
    result.backdrop = input.backdrop;
  }
  return result;
}

export function createDefaultScene(id: string): StoredScene {
  return {
    version: 1,
    instances: [
      {
        id: identifier(id),
        petId: "builtin",
        name: "Hoodie Cat",
        outfitId: "default",
      },
    ],
    selectedInstanceId: id,
    settings: {
      size: "medium",
      motion: "calm",
      paused: false,
      backdrop: "dots",
    },
  };
}

export function parseStoredScene(value: unknown): StoredScene {
  const input = object(value);
  exact(input, ["version", "instances", "selectedInstanceId", "settings"]);
  if (
    input.version !== 1 ||
    !Array.isArray(input.instances) ||
    input.instances.length > 6
  )
    throw new Error("Invalid stored scene.");
  const ids = new Set<string>();
  const instances = input.instances.map((entry: unknown) => {
    const item = object(entry);
    exact(item, ["id", "petId", "name", "outfitId"]);
    const id = identifier(item.id);
    if (ids.has(id)) throw new Error("Duplicate scene instance.");
    ids.add(id);
    const name = instanceName(item.name);
    if (name !== item.name)
      throw new Error("Stored companion name is not normalized.");
    return {
      id,
      petId: petIdentifier(item.petId),
      name,
      outfitId: outfitIdentifier(item.outfitId),
    };
  });
  const selectedInstanceId =
    input.selectedInstanceId === null
      ? null
      : identifier(input.selectedInstanceId);
  if (
    (instances.length === 0 && selectedInstanceId !== null) ||
    (instances.length > 0 &&
      (selectedInstanceId === null || !ids.has(selectedInstanceId)))
  )
    throw new Error("Invalid scene selection.");
  const settings = changes(input.settings, true);
  if (
    !settings.size ||
    !settings.motion ||
    settings.paused === undefined ||
    !settings.backdrop
  )
    throw new Error("Invalid scene settings.");
  return {
    version: 1,
    instances,
    selectedInstanceId,
    settings: {
      size: settings.size,
      motion: settings.motion,
      paused: settings.paused,
      backdrop: settings.backdrop,
    },
  };
}

export function applySceneCommand(
  scene: StoredScene,
  command: unknown,
): StoredScene {
  const next = parseStoredScene(scene);
  const input = object(command);
  switch (input.type) {
    case "addInstance": {
      exact(input, ["type", "id", "petId", "name"]);
      const id = identifier(input.id);
      if (next.instances.length >= 6) throw new Error("Scene is full.");
      if (next.instances.some((item) => item.id === id))
        throw new Error("Instance already exists.");
      next.instances.push({
        id,
        petId: petIdentifier(input.petId),
        name: instanceName(input.name),
        outfitId: "default",
      });
      next.selectedInstanceId = id;
      break;
    }
    case "renameInstance":
    case "removeInstance":
    case "selectInstance":
    case "setInstanceOutfit": {
      const type = input.type;
      exact(
        input,
        type === "renameInstance"
          ? ["type", "instanceId", "name"]
          : type === "setInstanceOutfit"
            ? ["type", "instanceId", "outfitId"]
            : ["type", "instanceId"],
      );
      const id = identifier(input.instanceId);
      const index = next.instances.findIndex((item) => item.id === id);
      if (index < 0) throw new Error("Scene instance does not exist.");
      if (type === "renameInstance")
        next.instances[index].name = instanceName(input.name);
      else if (type === "selectInstance") next.selectedInstanceId = id;
      else if (type === "setInstanceOutfit")
        next.instances[index].outfitId = outfitIdentifier(input.outfitId);
      else {
        next.instances.splice(index, 1);
        if (next.selectedInstanceId === id)
          next.selectedInstanceId = next.instances.length
            ? next.instances[index % next.instances.length].id
            : null;
      }
      break;
    }
    case "setSceneSettings":
      exact(input, ["type", "changes"]);
      next.settings = { ...next.settings, ...changes(input.changes, false) };
      break;
    default:
      throw new Error("Unknown scene command.");
  }
  return next;
}
