import type { Request, SceneSettings } from "../protocol.js";

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function keys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}
function id(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 256 &&
    value.trim() === value
  );
}
function petId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value);
}
function name(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    Array.from(value.trim()).length <= 40
  );
}
function settings(value: unknown): Partial<SceneSettings> | undefined {
  const input = record(value);
  if (
    !input ||
    !Object.keys(input).length ||
    !keys(input, ["size", "motion", "paused", "backdrop"])
  )
    return;
  const result: Partial<SceneSettings> = {};
  if ("size" in input) {
    if (
      input.size !== "small" &&
      input.size !== "medium" &&
      input.size !== "large"
    )
      return;
    result.size = input.size;
  }
  if ("motion" in input) {
    if (
      input.motion !== "still" &&
      input.motion !== "calm" &&
      input.motion !== "playful"
    )
      return;
    result.motion = input.motion;
  }
  if ("paused" in input) {
    if (typeof input.paused !== "boolean") return;
    result.paused = input.paused;
  }
  if ("backdrop" in input) {
    if (input.backdrop !== "plain" && input.backdrop !== "dots") return;
    result.backdrop = input.backdrop;
  }
  return result;
}
export function parseRequest(value: unknown): Request | undefined {
  const envelope = record(value);
  if (
    !envelope ||
    !keys(envelope, ["type", "id", "method", "params"]) ||
    envelope.type !== "request" ||
    !id(envelope.id) ||
    envelope.id.length > 128 ||
    typeof envelope.method !== "string"
  )
    return;
  const requestId = envelope.id;
  const params = record(envelope.params);
  switch (envelope.method) {
    case "ready":
    case "openEditor":
    case "showSidebar":
      if (envelope.params !== undefined) return;
      return {
        type: "request",
        id: requestId,
        method: envelope.method,
        params: undefined,
      };
    case "listCatalog":
      if (
        !params ||
        !keys(params, ["query", "page"]) ||
        typeof params.query !== "string" ||
        params.query.length > 256 ||
        typeof params.page !== "number" ||
        !Number.isSafeInteger(params.page) ||
        params.page < 0
      )
        return;
      return {
        type: "request",
        id: requestId,
        method: "listCatalog",
        params: { query: params.query, page: params.page },
      };
    case "packageOperationStatus":
    case "recoverPackageOperation":
      if (
        !params ||
        !keys(params, ["operationId"]) ||
        typeof params.operationId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[1-9][0-9]*$/i.test(
          params.operationId,
        ) ||
        params.operationId.length > 128 ||
        !Number.isSafeInteger(Number(params.operationId.slice(37)))
      )
        return;
      return {
        type: "request",
        id: requestId,
        method: envelope.method,
        params: { operationId: params.operationId },
      };
    case "installPet":
    case "installWardrobe":
    case "refreshWardrobe":
      if (!params || !keys(params, ["petId"]) || !id(params.petId)) return;
      return {
        type: "request",
        id: requestId,
        method: envelope.method,
        params: { petId: params.petId },
      };
    case "importPetPackage":
      if (!params || !keys(params, ["targetPetId"])) return;
      if (!("targetPetId" in params))
        return {
          type: "request",
          id: requestId,
          method: "importPetPackage",
          params: {},
        };
      if (!petId(params.targetPetId)) return;
      return {
        type: "request",
        id: requestId,
        method: "importPetPackage",
        params: { targetPetId: params.targetPetId },
      };
    case "openStudio":
      if (!params || !keys(params, ["intent", "petId"])) return;
      if (params.intent === "pet" && !("petId" in params))
        return {
          type: "request",
          id: requestId,
          method: "openStudio",
          params: { intent: "pet" },
        };
      if (params.intent === "outfit" && petId(params.petId))
        return {
          type: "request",
          id: requestId,
          method: "openStudio",
          params: { intent: "outfit", petId: params.petId },
        };
      return;
    case "addInstance":
      if (
        !params ||
        !keys(params, ["petId", "name"]) ||
        !id(params.petId) ||
        !name(params.name)
      )
        return;
      return {
        type: "request",
        id: requestId,
        method: "addInstance",
        params: { petId: params.petId, name: params.name },
      };
    case "renameInstance":
      if (
        !params ||
        !keys(params, ["instanceId", "name"]) ||
        !id(params.instanceId) ||
        !name(params.name)
      )
        return;
      return {
        type: "request",
        id: requestId,
        method: "renameInstance",
        params: { instanceId: params.instanceId, name: params.name },
      };
    case "removeInstance":
    case "selectInstance":
      if (!params || !keys(params, ["instanceId"]) || !id(params.instanceId))
        return;
      return {
        type: "request",
        id: requestId,
        method: envelope.method,
        params: { instanceId: params.instanceId },
      };
    case "setInstanceOutfit":
      if (
        !params ||
        !keys(params, ["instanceId", "outfitId"]) ||
        !id(params.instanceId) ||
        !id(params.outfitId)
      )
        return;
      return {
        type: "request",
        id: requestId,
        method: "setInstanceOutfit",
        params: { instanceId: params.instanceId, outfitId: params.outfitId },
      };
    case "setSceneSettings": {
      if (!params || !keys(params, ["changes"])) return;
      const changes = settings(params.changes);
      if (!changes) return;
      return {
        type: "request",
        id: requestId,
        method: "setSceneSettings",
        params: { changes },
      };
    }
  }
}
