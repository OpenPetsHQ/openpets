import { getPetSpriteLayout } from "@open-pets/pet-format/sprite-layout";
import type {
  CatalogListing,
  CompanionSize,
  CompanionSnapshot,
} from "../protocol.js";
import { Preferences } from "./preferences.js";

export type AssetLocation =
  { kind: "local"; path: string } | { kind: "remote"; url: string };
export type HostSnapshot = CompanionSnapshot<AssetLocation>;
export type HostListing = CatalogListing<AssetLocation>;

export class CompanionService {
  private revision = 0;
  private queue: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<(snapshot: HostSnapshot) => void>();
  private disposing?: Promise<void>;
  private closed = false;

  constructor(
    private readonly preferences: Preferences,
    private readonly atlasPath: string,
  ) {}
  async initialize(): Promise<void> {}

  async getSnapshot(): Promise<HostSnapshot> {
    const selectedPetId = this.preferences.selectedPetId;
    const savedOutfit = this.preferences.outfit("builtin");
    const sprite = {
      uri: { kind: "local" as const, path: this.atlasPath },
      layout: getPetSpriteLayout({ spriteVersionNumber: 2 }),
    };
    const notice =
      selectedPetId !== "builtin"
        ? `Saved pet ${selectedPetId} is not available; using Hoodie Cat.`
        : savedOutfit !== "default"
          ? `Saved outfit ${savedOutfit} is not available; using the base atlas.`
          : undefined;
    return {
      revision: this.revision,
      size: this.preferences.size,
      selectedPetId,
      installedPets: [
        {
          id: "builtin",
          displayName: "Hoodie Cat",
          description: "The bundled OpenPets companion.",
          source: "builtin",
          wardrobeAction: "none",
          outfits: [{ id: "default", displayName: "Default", sprite }],
        },
      ],
      active: { petId: "builtin", outfitId: "default", sprite },
      ...(notice ? { notice } : {}),
    };
  }

  async listCatalog(_query: string, _page: number): Promise<HostListing> {
    throw new Error("Catalog is not available in this foundation preview.");
  }
  async installPet(_petId: string): Promise<HostSnapshot> {
    this.assertOpen();
    throw new Error(
      "Pet installation is not available in this foundation preview.",
    );
  }
  async installWardrobe(_petId: string): Promise<HostSnapshot> {
    this.assertOpen();
    throw new Error(
      "Wardrobe installation is not available in this foundation preview.",
    );
  }
  async selectPet(petId: string): Promise<HostSnapshot> {
    this.assertOpen();
    if (petId !== "builtin") throw new Error("This pet is not installed.");
    return this.commit(() => this.preferences.setPet(petId));
  }
  async selectOutfit(petId: string, outfitId: string): Promise<HostSnapshot> {
    this.assertOpen();
    if (petId !== "builtin" || outfitId !== "default")
      throw new Error("This outfit is not installed.");
    return this.commit(() => this.preferences.setOutfit(petId, outfitId));
  }
  async setSize(size: CompanionSize): Promise<HostSnapshot> {
    return this.commit(() => this.preferences.setSize(size));
  }
  onSnapshot(listener: (snapshot: HostSnapshot) => void): () => void {
    this.assertOpen();
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  dispose(): Promise<void> {
    if (this.disposing) return this.disposing;
    this.closed = true;
    this.disposing = this.queue.then(() => {
      this.listeners.clear();
    });
    return this.disposing;
  }

  private async commit(write: () => Promise<void>): Promise<HostSnapshot> {
    this.assertOpen();
    const result = this.queue.then(async () => {
      await write();
      this.revision++;
      const snapshot = await this.getSnapshot();
      for (const listener of this.listeners) listener(snapshot);
      return snapshot;
    });
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("Companion service is disposed.");
  }
}
