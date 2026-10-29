import type { InstalledPetView } from "../protocol.js";

export function studioUrl(
  intent: "pet" | "outfit",
  pet?: Pick<InstalledPetView, "id" | "source" | "wardrobeSource" | "hasLocalWardrobeOverride">,
): string {
  if (intent === "pet") {
    if (pet !== undefined)
      throw new Error("A pet is not allowed for this Studio action.");
    return "https://openpets.dev/studio/new";
  }
  if (
    intent !== "outfit" ||
    !pet ||
    !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(pet.id)
  ) {
    throw new Error("A valid pet is required for this Studio action.");
  }
  if (pet.source === "builtin") {
    if (pet.id !== "builtin") throw new Error("Invalid built-in pet identity.");
    if (pet.wardrobeSource === "local" || pet.hasLocalWardrobeOverride)
      return "https://openpets.dev/studio/import?view=wardrobe";
    return "https://openpets.dev/studio/import?pet=hoodie-cat&view=wardrobe";
  }
  if (pet.id === "builtin") throw new Error("Invalid pet identity.");
  if (pet.source === "local")
    return "https://openpets.dev/studio/import?view=wardrobe";
  if (pet.source !== "catalog") throw new Error("Invalid pet source.");
  return `https://openpets.dev/studio/import?pet=${encodeURIComponent(pet.id)}&view=wardrobe`;
}
