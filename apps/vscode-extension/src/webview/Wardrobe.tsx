import type { CompanionSnapshot } from "../protocol.js";
import { SpritePreview } from "./SpritePreview.js";

interface WardrobeProps {
  snapshot: CompanionSnapshot;
  pending: boolean;
  importing: boolean;
  onGallery(): void;
  onCreateOutfit(petId: string): void;
  onImportPet(petId: string): void;
  wardrobeInstallingId: string | null;
  onSelectInstance(id: string): void;
  onRefreshWardrobe(id: string): void;
  onInstallWardrobe(id: string): void;
  onSelectOutfit(instanceId: string, outfitId: string): void;
}

export function Wardrobe({
  snapshot,
  pending,
  importing,
  onGallery,
  onCreateOutfit,
  onImportPet,
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
  const canCheckCatalog = pet?.source !== "local" && pet?.wardrobeSource !== "local" && pet?.wardrobeStatus !== "local";
  const needsManualStudioImport = pet?.source === "local" || pet?.wardrobeSource === "local" || pet?.hasLocalWardrobeOverride === true;
  return (
    <section className="collection-page" aria-label="Companion outfits">
      <div className="page-heading">
        <h2>Outfits</h2>
        <p className="muted">Choose a look for each companion.</p>
      </div>
      {snapshot.instances.length === 0 ? (
        <div className="wardrobe-help">
          <h3>Outfits start with a companion</h3>
          <p className="muted">Add an installed pet to your scene, or find a new one in the gallery.</p>
          <button className="button secondary" onClick={onGallery}>Browse gallery</button>
        </div>
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
                    {pet?.displayName ?? "Pet unavailable"}{pet?.source === "local" ? " · Imported pet" : ""}
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
                    {pet.wardrobeSource === "bundled" && <p className="muted small-text">Bundled outfits</p>}
                    {pet.wardrobeSource === "local" && <p className="muted small-text">Imported outfits</p>}
                    {pet.source === "local" && <p className="muted small-text">Imported pet</p>}
                    {canCheckCatalog && pet.wardrobeStatus === "unknown" && (
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
                    {canCheckCatalog && pet.wardrobeStatus === "none" && (
                      <p className="muted small-text">
                        No additional outfits available.
                      </p>
                    )}
                    {canCheckCatalog && pet.wardrobeStatus === "current" && (
                      <p className="muted small-text">
                        All available outfits are installed.
                      </p>
                    )}
                    {canCheckCatalog && (pet.wardrobeStatus === "install" ||
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
                  {pet.outfits.length <= 1 && (
                    <p className="muted small-text wardrobe-empty">No outfits installed yet. Create one in Studio or import a pet ZIP with outfits.</p>
                  )}
                  <div className="creation-actions wardrobe-create">
                    <h3>Make a look</h3>
                    <p className="muted small-text">Studio exports the whole pet ZIP, including outfits. Importing it updates this pet for all companions using it; it won’t add or remove companions.</p>
                    {needsManualStudioImport && <p className="muted small-text">In Studio, use your original ZIP or open an existing project.</p>}
                    <div className="creation-buttons">
                      <button className="button secondary" onClick={() => onCreateOutfit(selected.petId)}>Create outfit in Studio</button>
                      <button className="button secondary" disabled={pending} onClick={() => onImportPet(selected.petId)}>{importing ? "Choose a ZIP…" : "Import pet ZIP"}</button>
                    </div>
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
