import { getPetSpriteLayout } from "@open-pets/pet-format/sprite-layout";
import { join } from "node:path";
import type {
  CatalogListing,
  CompanionSize,
  CompanionSnapshot,
  InstalledPetView,
  OutfitView,
} from "../protocol.js";
import { CatalogService, compatibilityProblem } from "./catalog-service.js";
import { Preferences } from "./preferences.js";
import { PetStore, type InstalledPet } from "./pet-store.js";

export type AssetLocation =
  { kind: "local"; path: string } | { kind: "remote"; url: string };
export type HostSnapshot = CompanionSnapshot<AssetLocation>;
export type HostListing = CatalogListing<AssetLocation>;

export class CompanionService {
  private revision = 0;
  private queue: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<(snapshot: HostSnapshot) => void>();
  private readonly shutdown = new AbortController();
  private readonly inFlight = new Set<Promise<unknown>>();
  private readonly installed = new Map<string, InstalledPet>();
  private readonly problems = new Map<string, string>();
  private readonly catalog: CatalogService;
  private readonly store?: PetStore;
  private disposing?: Promise<void>;
  private closed = false;
  private pendingInstalls = 0;

  constructor(
    private readonly preferences: Preferences,
    private readonly atlasPath: string,
    storagePath?: string,
    private readonly log: (message: string) => void = () => {},
    catalog?: CatalogService,
    store?: PetStore,
  ) {
    this.catalog = catalog ?? new CatalogService(this.shutdown.signal);
    this.store =
      store ??
      (storagePath
        ? new PetStore(storagePath, preferences, undefined, log)
        : undefined);
  }

  async initialize(): Promise<void> {
    await this.preferences.initialize();
    if (!this.store) return;
    await this.store.initialize();
    for (const id of this.preferences.installedIds()) {
      try {
        const pet = await this.store.load(id, this.shutdown.signal);
        this.installed.set(id, pet);
        if (pet.package.outfitProblems?.length)
          this.problems.set(
            id,
            `Some outfits are unavailable: ${pet.package.outfitProblems.join(", ")}`,
          );
      } catch (error) {
        this.shutdown.signal.throwIfAborted();
        const message =
          error instanceof Error ? error.message : "invalid installation";
        this.problems.set(id, message);
        this.log(`[storage] ${id}: ${message}`);
      }
    }
  }

  async getSnapshot(): Promise<HostSnapshot> {
    const selectedPetId = this.preferences.selectedPetId;
    const builtinSprite = {
      uri: { kind: "local" as const, path: this.atlasPath },
      layout: getPetSpriteLayout({ spriteVersionNumber: 2 }),
    };
    const builtinPackage = this.installed.get("hoodie-cat");
    const builtinOutfits: OutfitView<AssetLocation>[] = [
      { id: "default", displayName: "Default", sprite: builtinSprite },
    ];
    if (builtinPackage)
      builtinOutfits.push(...this.outfits(builtinPackage).slice(1));
    const builtin: InstalledPetView<AssetLocation> = {
      id: "builtin",
      displayName: "Hoodie Cat",
      description: "The bundled OpenPets companion.",
      source: "builtin",
      outfits: builtinOutfits,
      wardrobeAction: this.wardrobeAction("hoodie-cat", builtinPackage),
    };
    const installedPets = [
      builtin,
      ...[...this.installed.values()].map((pet) => ({
        id: pet.id,
        displayName: pet.package.metadata.displayName,
        description: pet.package.metadata.description,
        source: "catalog" as const,
        outfits: this.outfits(pet),
        wardrobeAction: this.wardrobeAction(pet.id, pet),
        ...(this.problems.has(pet.id)
          ? { problem: this.problems.get(pet.id) }
          : {}),
      })),
    ];
    const selected = installedPets.find((pet) => pet.id === selectedPetId);
    const activePet = selected ?? builtin;
    const savedOutfit = this.preferences.outfit(activePet.id);
    const outfit =
      activePet.outfits.find((item) => item.id === savedOutfit) ??
      activePet.outfits[0];
    let notice: string | undefined;
    if (!selected)
      notice =
        `Saved pet ${selectedPetId} is unavailable; using Hoodie Cat. ${this.problems.get(selectedPetId) ?? ""}`.trim();
    else if (savedOutfit !== outfit.id)
      notice = `Saved outfit ${savedOutfit} is unavailable; using the base atlas.`;
    else if (activePet.id === "builtin" && this.problems.has("hoodie-cat"))
      notice = `Hoodie Cat wardrobe: ${this.problems.get("hoodie-cat")}`;
    return {
      revision: this.revision,
      size: this.preferences.size,
      selectedPetId,
      installedPets,
      active: {
        petId: activePet.id,
        outfitId: outfit.id,
        sprite: outfit.sprite,
      },
      ...(notice ? { notice } : {}),
    };
  }

  async listCatalog(query: string, page: number): Promise<HostListing> {
    this.assertOpen();
    const work = this.catalog.list(query, page, new Set(this.installed.keys()));
    this.inFlight.add(work);
    try {
      const result = await work;
      this.assertOpen();
      await this.publish();
      return result;
    } finally {
      this.inFlight.delete(work);
    }
  }
  async installPet(petId: string): Promise<HostSnapshot> {
    return this.install(petId, false);
  }
  async installWardrobe(petId: string): Promise<HostSnapshot> {
    return this.install(petId, true);
  }
  async selectPet(petId: string): Promise<HostSnapshot> {
    this.assertControlsAvailable();
    return this.commit(async () => {
      if (petId !== "builtin" && !this.installed.has(petId))
        throw new Error("This pet is not installed or is unavailable.");
      await this.preferences.setPet(petId);
    });
  }
  async selectOutfit(petId: string, outfitId: string): Promise<HostSnapshot> {
    this.assertControlsAvailable();
    return this.commit(async () => {
      const snapshot = await this.getSnapshot();
      const pet = snapshot.installedPets.find((item) => item.id === petId);
      if (!pet?.outfits.some((item) => item.id === outfitId))
        throw new Error("This outfit is not installed or is unavailable.");
      await this.preferences.setOutfit(petId, outfitId);
    });
  }
  async setSize(size: CompanionSize): Promise<HostSnapshot> {
    this.assertControlsAvailable();
    if (size !== "small" && size !== "medium" && size !== "large")
      throw new Error("Invalid companion size.");
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
    this.shutdown.abort(new Error("OpenPets is shutting down."));
    this.disposing = Promise.allSettled([this.queue, ...this.inFlight]).then(
      async () => {
        this.listeners.clear();
        await this.store?.dispose();
      },
    );
    return this.disposing;
  }
  private async install(id: string, wardrobe: boolean): Promise<HostSnapshot> {
    this.assertOpen();
    this.pendingInstalls++;
    const controller = new AbortController();
    const abort = () => controller.abort(this.shutdown.signal.reason);
    this.shutdown.signal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(
      () => controller.abort(new Error("Pet installation timed out.")),
      150_000,
    );
    try {
      return await this.commit(async () => {
        controller.signal.throwIfAborted();
        const catalogId = id === "builtin" ? "hoodie-cat" : id;
        if (id === "builtin" && !wardrobe)
          throw new Error("The bundled companion is already installed.");
        if (wardrobe && id !== "builtin" && !this.installed.has(id))
          throw new Error("Install this pet before its wardrobe.");
        if (!this.store) throw new Error("Pet storage is unavailable.");
        const pet = await this.catalog.find(catalogId, controller.signal);
        controller.signal.throwIfAborted();
        const problem = compatibilityProblem(pet);
        if (problem) throw new Error(problem);
        const installed = await this.store.install(
          pet,
          wardrobe,
          controller.signal,
        );
        this.installed.set(catalogId, installed);
        this.problems.delete(catalogId);
        this.log(`[install] ${catalogId} installed`);
      });
    } finally {
      this.pendingInstalls--;
      clearTimeout(timer);
      this.shutdown.signal.removeEventListener("abort", abort);
    }
  }
  private outfits(pet: InstalledPet): OutfitView<AssetLocation>[] {
    const { metadata, layout, availableOutfitIds } = pet.package;
    const asset = (path: string) => ({
      uri: { kind: "local" as const, path },
      layout,
    });
    return [
      {
        id: "default",
        displayName: "Default",
        sprite: asset(join(pet.root, metadata.spritesheetPath)),
      },
      ...(metadata.wardrobe?.outfits ?? [])
        .filter((outfit) => availableOutfitIds.includes(outfit.id))
        .map((outfit) => ({
          id: outfit.id,
          displayName: outfit.displayName,
          sprite: asset(join(pet.root, outfit.spritesheetPath)),
        })),
    ];
  }
  private wardrobeAction(
    id: string,
    installed?: InstalledPet,
  ): "none" | "install" | "update" {
    const known = this.catalog.knownPet(id);
    if (!known?.wardrobeZip || compatibilityProblem(known)) return "none";
    if (!installed?.package.metadata.wardrobe) return "install";
    return installed.receipt.url === known.wardrobeZip ? "none" : "update";
  }
  private async publish(): Promise<HostSnapshot> {
    this.revision++;
    const snapshot = await this.getSnapshot();
    for (const listener of this.listeners) listener(snapshot);
    return snapshot;
  }
  private async commit(write: () => Promise<void>): Promise<HostSnapshot> {
    this.assertOpen();
    const result = this.queue.then(async () => {
      await write();
      return this.publish();
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
  private assertControlsAvailable(): void {
    this.assertOpen();
    if (this.pendingInstalls)
      throw new Error(
        "A pet installation is in progress. Try again when it finishes.",
      );
  }
}
