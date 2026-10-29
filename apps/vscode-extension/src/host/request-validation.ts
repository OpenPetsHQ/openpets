import type { Request } from "../protocol.js";

export function parseRequest(value: unknown): Request | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const envelope = value as Record<string, unknown>;
  if (
    envelope.type !== "request" ||
    typeof envelope.id !== "string" ||
    !envelope.id ||
    envelope.id.length > 128 ||
    typeof envelope.method !== "string"
  )
    return;
  const params = envelope.params;
  const object =
    params && typeof params === "object" && !Array.isArray(params)
      ? (params as Record<string, unknown>)
      : undefined;
  const nonempty = (input: unknown): input is string =>
    typeof input === "string" && input.length > 0 && input.length <= 256;
  switch (envelope.method) {
    case "ready":
    case "openEditor":
    case "showSidebar":
      if (params !== undefined) return;
      return {
        type: "request",
        id: envelope.id,
        method: envelope.method,
        params: undefined,
      };
    case "listCatalog":
      if (
        !object ||
        typeof object.query !== "string" ||
        object.query.length > 256 ||
        !Number.isSafeInteger(object.page) ||
        (object.page as number) < 0
      )
        return;
      return {
        type: "request",
        id: envelope.id,
        method: "listCatalog",
        params: { query: object.query, page: object.page as number },
      };
    case "installPet":
    case "installWardrobe":
    case "selectPet":
      if (!object || !nonempty(object.petId)) return;
      return {
        type: "request",
        id: envelope.id,
        method: envelope.method,
        params: { petId: object.petId },
      };
    case "selectOutfit":
      if (!object || !nonempty(object.petId) || !nonempty(object.outfitId))
        return;
      return {
        type: "request",
        id: envelope.id,
        method: "selectOutfit",
        params: { petId: object.petId, outfitId: object.outfitId },
      };
    case "setSize":
      if (
        !object ||
        (object.size !== "small" &&
          object.size !== "medium" &&
          object.size !== "large")
      )
        return;
      return {
        type: "request",
        id: envelope.id,
        method: "setSize",
        params: { size: object.size },
      };
  }
}
