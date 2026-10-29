export { builtInPetWardrobe, builtInPetOutfitsDirectory, builtInPetOutfitFileName } from "@open-pets/pet-format/builtin-hoodie-cat";

export const builtInPet = {
  id: "builtin",
  displayName: "Hoodie Cat",
  builtIn: true,
  protected: true,
  installed: true,
} as const;

/**
 * Catalog entries that publish the built-in pet itself. Control Center hides
 * them so Hoodie Cat is not listed twice; the website gallery still shows them.
 */
export const builtInPetCatalogIds: ReadonlySet<string> = new Set(["hoodie-cat"]);
