import type { CompanionSnapshot } from "../protocol.js";
import { SpritePreview } from "./SpritePreview.js";

interface WardrobeProps {
  snapshot: CompanionSnapshot;
  pending: boolean;
  wardrobeInstallingId: string | null;
  onSelectPet(id: string): void;
  onInstallWardrobe(id: string): void;
  onSelectOutfit(petId: string, outfitId: string): void;
}

export function Wardrobe({
  snapshot,
  pending,
  wardrobeInstallingId,
  onSelectPet,
  onInstallWardrobe,
  onSelectOutfit,
}: WardrobeProps) {
  return (
    <section
      className="collection-page"
      aria-label="Installed pets and outfits"
    >
      <div className="page-heading">
        <div>
          <h2>Your pets & outfits</h2>
          <p className="muted">Choose a companion and make it yours.</p>
        </div>
      </div>
      <div className="wardrobe-list">
        {snapshot.installedPets.map((pet) => {
          const selected = snapshot.active.petId === pet.id;
          return (
            <article className="wardrobe-pet" key={pet.id}>
              <div className="wardrobe-heading">
                <div>
                  <h3>{pet.displayName}</h3>
                  <p className="muted small-text">
                    {pet.source === "builtin"
                      ? "Included companion"
                      : "Installed companion"}
                  </p>
                </div>
                <button
                  className="button secondary"
                  disabled={pending || selected}
                  onClick={() => onSelectPet(pet.id)}
                >
                  {selected ? "In use" : "Use pet"}
                </button>
              </div>
              {pet.problem && <p className="error-text">{pet.problem}</p>}
              <div className="outfit-grid">
                {pet.outfits.map((outfit, index) => {
                  const chosen =
                    selected && snapshot.active.outfitId === outfit.id;
                  return (
                    <button
                      key={outfit.id}
                      className="outfit-card"
                      aria-pressed={chosen}
                      disabled={pending}
                      onClick={() => onSelectOutfit(pet.id, outfit.id)}
                    >
                      <SpritePreview
                        sprite={outfit.sprite}
                        label={`${pet.displayName}, ${outfit.displayName}`}
                      />
                      <span className="outfit-label">
                        <strong>{outfit.displayName}</strong>
                        <span>
                          {index === 0
                            ? chosen
                              ? "Base selected"
                              : "Base appearance"
                            : chosen
                              ? "Selected"
                              : "Choose outfit"}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
              {pet.wardrobeAction !== "none" && (
                <div className="wardrobe-download">
                  <p className="muted small-text">
                    {pet.wardrobeAction === "update"
                      ? "New outfits are available."
                      : "More looks for this companion."}
                  </p>
                  <button
                    className="button"
                    disabled={pending}
                    onClick={() => onInstallWardrobe(pet.id)}
                  >
                    {wardrobeInstallingId === pet.id
                      ? "Downloading outfits…"
                      : pet.wardrobeAction === "update"
                        ? "Update outfits"
                        : "Download outfits"}
                  </button>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
