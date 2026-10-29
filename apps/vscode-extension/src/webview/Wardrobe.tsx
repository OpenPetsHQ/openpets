import type { CompanionSnapshot } from "../protocol.js";
import { SpritePreview } from "./SpritePreview.js";

interface WardrobeProps {
  snapshot: CompanionSnapshot;
  pending: boolean;
  wardrobeInstallingId: string | null;
  onSelectInstance(id: string): void;
  onRefreshWardrobe(id: string): void;
  onInstallWardrobe(id: string): void;
  onSelectOutfit(instanceId: string, outfitId: string): void;
}

export function Wardrobe({
  snapshot,
  pending,
  wardrobeInstallingId,
  onSelectInstance,
  onRefreshWardrobe,
  onInstallWardrobe,
  onSelectOutfit,
}: WardrobeProps) {
  const selected = snapshot.instances.find(
    (instance) => instance.id === snapshot.selectedInstanceId,
  );
  const pet = snapshot.installedPets.find(
    (item) => item.id === selected?.petId,
  );
  return (
    <section className="collection-page" aria-label="Companion outfits">
      <div className="page-heading">
        <h2>Outfits</h2>
        <p className="muted">Choose a look for each companion.</p>
      </div>
      {snapshot.instances.length === 0 ? (
        <p className="muted">Add a companion to choose its outfit.</p>
      ) : (
        <>
          <div className="instance-list" aria-label="Select a companion">
            {snapshot.instances.map((instance) => (
              <button
                key={instance.id}
                className="instance-chip"
                aria-pressed={instance.id === snapshot.selectedInstanceId}
                disabled={pending}
                onClick={() => onSelectInstance(instance.id)}
              >
                {instance.name}
              </button>
            ))}
          </div>
          {selected && (
            <article className="wardrobe-pet">
              <div className="wardrobe-heading">
                <div>
                  <h3>{selected.name}</h3>
                  <p className="muted small-text">
                    {pet?.displayName ?? "Pet unavailable"}
                  </p>
                </div>
              </div>
              {selected.problem && (
                <p className="error-text">{selected.problem}</p>
              )}
              {pet?.problem && <p className="error-text">{pet.problem}</p>}
              {pet && (
                <>
                  <div className="outfit-grid">
                    {pet.outfits.map((outfit, index) => {
                      const chosen = selected.outfitId === outfit.id;
                      return (
                        <button
                          key={outfit.id}
                          className="outfit-card"
                          aria-pressed={chosen}
                          disabled={pending}
                          onClick={() => onSelectOutfit(selected.id, outfit.id)}
                        >
                          <SpritePreview
                            sprite={outfit.sprite}
                            label={`${pet.displayName}, ${outfit.displayName}`}
                          />
                          <span className="outfit-label">
                            <strong>{outfit.displayName}</strong>
                            <span>
                              {chosen
                                ? "Selected"
                                : index === 0
                                  ? "Base appearance"
                                  : "Choose outfit"}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="wardrobe-download">
                    {pet.wardrobeStatus === "unknown" && (
                      <>
                        <p className="muted small-text">
                          Check for available outfits.
                        </p>
                        <button
                          className="button secondary"
                          disabled={pending}
                          onClick={() => onRefreshWardrobe(pet.id)}
                        >
                          Check for outfits
                        </button>
                      </>
                    )}
                    {pet.wardrobeStatus === "none" && (
                      <p className="muted small-text">
                        No additional outfits available.
                      </p>
                    )}
                    {pet.wardrobeStatus === "current" && (
                      <p className="muted small-text">
                        All available outfits are installed.
                      </p>
                    )}
                    {(pet.wardrobeStatus === "install" ||
                      pet.wardrobeStatus === "update") && (
                      <>
                        <p className="muted small-text">
                          {pet.wardrobeStatus === "update"
                            ? "New outfits are available."
                            : "More outfits are available."}
                        </p>
                        <button
                          className="button"
                          disabled={pending}
                          onClick={() => onInstallWardrobe(pet.id)}
                        >
                          {wardrobeInstallingId === pet.id
                            ? "Downloading outfits…"
                            : pet.wardrobeStatus === "update"
                              ? "Update outfits"
                              : "Download outfits"}
                        </button>
                      </>
                    )}
                  </div>
                </>
              )}
            </article>
          )}
        </>
      )}
    </section>
  );
}
