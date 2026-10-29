import { getPetSpriteLayout } from "@open-pets/pet-format/sprite-layout";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { watch, type FSWatcher } from "node:fs";
import type { SceneStore } from "./scene-store.js";
import type { StoredScene, SceneStoreCommand } from "./scene-state.js";
import type {
  CatalogListing,
  SceneSettings,
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
  private scene?: StoredScene;
  private watcher?: FSWatcher;
  private refreshTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly preferences: Preferences,
    private readonly atlasPath: string,
    private readonly storagePath?: string,
    private readonly log: (message: string) => void = () => {},
    catalog?: CatalogService,
    store?: PetStore,
    private readonly sceneStore?: Pick<
      SceneStore,
      "initialize" | "read" | "mutate" | "dispose"
    >,
  ) {
    this.catalog = catalog ?? new CatalogService(this.shutdown.signal);
    this.store =
      store ??
      (this.storagePath
        ? new PetStore(this.storagePath, preferences, undefined, log)
        : undefined);
  }

  async initialize(): Promise<void> {
    if (!this.sceneStore) throw new Error("Scene storage is unavailable.");
    await this.preferences.initialize();
    const store = this.store;
    if (store) await store.initialize();
    for (const id of store ? this.preferences.installedIds() : []) {
      try {
        if (!store) throw new Error("Pet storage is unavailable.");
        const pet = await store.load(id, this.shutdown.signal);
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
    this.scene = await this.sceneStore.initialize();
    this.startSceneWatcher();
  }

  async getSnapshot(): Promise<HostSnapshot> {
    this.assertOpen();
    const result = this.queue.then(() => this.refreshScene());
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async refreshScene(): Promise<HostSnapshot> {
    const scene = await this.requireSceneStore().read();
    if (JSON.stringify(scene) !== JSON.stringify(this.scene)) {
      this.scene = scene;
      if (!this.closed) return this.publish();
    }
    return this.buildSnapshot();
  }

  private startSceneWatcher(): void {
    if (!this.storagePath || this.closed) return;
    try {
      const watcher = watch(this.storagePath, (_event, filename) => {
        if (this.closed || (filename !== null && filename.toString() !== "scene.sqlite" && filename.toString() !== "scene.sqlite-journal")) return;
        if (this.refreshTimer) clearTimeout(this.refreshTimer);
        this.refreshTimer = setTimeout(() => {
          this.refreshTimer = undefined;
          if (this.closed) return;
          const refresh = this.queue.then(() => this.refreshScene());
          this.queue = refresh.then(() => undefined, (error: unknown) => {
            if (!this.closed) this.log(`[scene] Watch refresh failed: ${error instanceof Error ? error.message : String(error)}`);
          });
        }, 50);
      });
      this.watcher = watcher;
      watcher.on("error", (error) => {
        this.log(`[scene] Watcher unavailable: ${error.message}`);
        watcher.close();
        if (this.watcher === watcher) this.watcher = undefined;
        if (this.refreshTimer) clearTimeout(this.refreshTimer);
        this.refreshTimer = undefined;
      });
    } catch (error) {
      this.log(`[scene] Watcher unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private buildSnapshot(): HostSnapshot {
    if (!this.scene) throw new Error("Scene is not initialized.");
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
      wardrobeStatus: this.wardrobeStatus("hoodie-cat", builtinPackage),
    };
    const installedPets: InstalledPetView<AssetLocation>[] = [
      builtin,
      ...[...this.installed.values()].map((pet) => ({
        id: pet.id,
        displayName: pet.package.metadata.displayName,
        description: pet.package.metadata.description,
        source: "catalog" as const,
        outfits: this.outfits(pet),
        wardrobeStatus: this.wardrobeStatus(pet.id, pet),
        ...(this.problems.has(pet.id)
          ? { problem: this.problems.get(pet.id) }
          : {}),
      })),
    ];
    const instances = this.scene.instances.map((instance) => {
      const pet = installedPets.find((item) => item.id === instance.petId);
      const visiblePet = pet ?? builtin;
      const outfit = pet
        ? (visiblePet.outfits.find((item) => item.id === instance.outfitId) ??
          visiblePet.outfits[0])
        : visiblePet.outfits[0];
      const fallback = !pet || outfit.id !== instance.outfitId;
      const problem = !pet
        ? `Pet ${instance.petId} is unavailable; using Hoodie Cat.`
        : outfit.id !== instance.outfitId
          ? `Outfit ${instance.outfitId} is unavailable; using the base atlas.`
          : undefined;
      return {
        ...instance,
        appearance: {
          sprite: outfit.sprite,
          outfitName: outfit.displayName,
          fallback,
        },
        ...(problem ? { problem } : {}),
      };
    });
    return {
      revision: this.revision,
      settings: this.scene.settings,
      selectedInstanceId: this.scene.selectedInstanceId,
      instances,
      installedPets,
    };
  }

  async listCatalog(query: string, page: number): Promise<HostListing> {
    this.assertOpen();
    const work = this.catalog.list(query, page, new Set(this.installed.keys()));
    this.inFlight.add(work);
    try {
      const result = await work;
      this.assertOpen();
      await this.commit(async () => {});
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
  async addInstance(petId: string, name: string): Promise<HostSnapshot> {
    return this.sceneMutation(
      { type: "addInstance", id: randomUUID(), petId, name },
      async () => {
        if (petId !== "builtin" && !this.installed.has(petId))
          throw new Error("This pet is not installed or is unavailable.");
      },
    );
  }
  async renameInstance(
    instanceId: string,
    name: string,
  ): Promise<HostSnapshot> {
    return this.sceneMutation({ type: "renameInstance", instanceId, name });
  }
  async removeInstance(instanceId: string): Promise<HostSnapshot> {
    return this.sceneMutation({ type: "removeInstance", instanceId });
  }
  async selectInstance(instanceId: string): Promise<HostSnapshot> {
    return this.sceneMutation({ type: "selectInstance", instanceId });
  }
  async setInstanceOutfit(
    instanceId: string,
    outfitId: string,
  ): Promise<HostSnapshot> {
    return this.sceneMutation(
      { type: "setInstanceOutfit", instanceId, outfitId },
      async () => {
        await this.refreshScene();
        const instance = this.scene?.instances.find(
          (item) => item.id === instanceId,
        );
        if (!instance) return;
        const pet = this.buildSnapshot().installedPets.find(
          (item) => item.id === instance.petId,
        );
        if (!pet?.outfits.some((item) => item.id === outfitId))
          throw new Error("This outfit is not installed or is unavailable.");
      },
    );
  }
  async setSceneSettings(
    changes: Partial<SceneSettings>,
  ): Promise<HostSnapshot> {
    return this.sceneMutation({ type: "setSceneSettings", changes });
  }
  async refreshWardrobe(petId: string): Promise<HostSnapshot> {
    this.assertControlsAvailable();
    if (petId !== "builtin" && !this.installed.has(petId))
      throw new Error("This pet is not installed or is unavailable.");
    const work = this.catalog.find(
      petId === "builtin" ? "hoodie-cat" : petId,
      this.shutdown.signal,
    );
    this.inFlight.add(work);
    try {
      await work;
      this.assertOpen();
      return await this.commit(async () => {});
    } finally {
      this.inFlight.delete(work);
    }
  }
  private sceneMutation(
    command: SceneStoreCommand,
    check?: () => Promise<void>,
  ): Promise<HostSnapshot> {
    this.assertControlsAvailable();
    return this.commit(async () => {
      if (check) await check();
      this.scene = await this.requireSceneStore().mutate(command);
    });
  }
  private requireSceneStore(): Pick<
    SceneStore,
    "initialize" | "read" | "mutate" | "dispose"
  > {
    if (!this.sceneStore) throw new Error("Scene storage is unavailable.");
    return this.sceneStore;
  }
  onSnapshot(listener: (snapshot: HostSnapshot) => void): () => void {
    this.assertOpen();
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  dispose(): Promise<void> {
    if (this.disposing) return this.disposing;
    this.closed = true;
    this.watcher?.close();
    this.watcher = undefined;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = undefined;
    this.shutdown.abort(new Error("OpenPets is shutting down."));
    this.disposing = Promise.allSettled([this.queue, ...this.inFlight]).then(
      async () => {
        this.listeners.clear();
        try {
          await this.store?.dispose();
        } finally {
          await this.sceneStore?.dispose();
        }
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
  private wardrobeStatus(
    id: string,
    installed?: InstalledPet,
  ): "unknown" | "none" | "install" | "update" | "current" {
    const known = this.catalog.knownPet(id);
    if (!known) return "unknown";
    if (!known.wardrobeZip || compatibilityProblem(known)) return "none";
    if (!installed?.package.metadata.wardrobe) return "install";
    return installed.receipt.url === known.wardrobeZip ? "current" : "update";
  }
  private async publish(): Promise<HostSnapshot> {
    if (this.closed) return this.buildSnapshot();
    this.revision++;
    const snapshot = this.buildSnapshot();
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
