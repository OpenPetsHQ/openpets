import { validatePetWardrobe, type PetWardrobe } from "./pet-wardrobe-core.js";

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

/** Bundled outfit atlases live in `assets/{builtInPetOutfitsDirectory}/{outfitId}.webp`. */
export const builtInPetOutfitsDirectory = "default-pet-outfits";

/**
 * Hoodie Cat's wardrobe, the same outfits and creator schedule as the
 * catalog's `hoodie-cat` wardrobe package (openpets.dev/pets/hoodie-cat-openpets).
 * Outfit paths follow the pet.json contract; {@link builtInPetOutfitFileName}
 * maps them into assets.
 */
export const builtInPetWardrobe: PetWardrobe = validatePetWardrobe({
  outfits: [
    { id: "pajamas", displayName: "Pajamas", spritesheetPath: "outfits/pajamas.webp" },
    { id: "weekend", displayName: "Weekend", spritesheetPath: "outfits/weekend.webp" },
    { id: "halloween", displayName: "Halloween", spritesheetPath: "outfits/halloween.webp" },
    { id: "holidays", displayName: "Winter Holidays", spritesheetPath: "outfits/holidays.webp" },
    { id: "summer", displayName: "Summer", spritesheetPath: "outfits/summer.webp" },
  ],
  schedule: [
    { outfit: "holidays", when: { dates: { from: "12-15", to: "01-02" } } },
    { outfit: "halloween", when: { dates: { from: "10-24", to: "11-01" } } },
    { outfit: "pajamas", when: { time: { from: "22:00", to: "07:00" } } },
    { outfit: "weekend", when: { days: ["sun", "sat"] } },
    { outfit: "summer", when: { dates: { from: "06-21", to: "08-31" } } },
  ],
});

/** The bundled atlas for one built-in outfit, relative to `assets/`, or undefined for an unknown outfit. */
export function builtInPetOutfitFileName(outfitId: string): string | undefined {
  const outfit = builtInPetWardrobe.outfits.find((candidate) => candidate.id === outfitId);
  return outfit ? `${builtInPetOutfitsDirectory}/${outfit.id}.webp` : undefined;
}
