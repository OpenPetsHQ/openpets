import { getPetSpriteLayout } from "@open-pets/pet-format/sprite-layout";
import { dirname, join } from "node:path";
import {
  builtInPetWardrobe,
  builtInPetOutfitFileName,
} from "@open-pets/pet-format/builtin-hoodie-cat";
import { readLegacyInstalledReferences } from "./asset-reference-migration.js";
import { PackageInstallation } from "./package-installation.js";
import type { PackageInteractions } from "./package-interactions.js";
import type { Receipt } from "./asset-reference.js";
import { randomUUID } from "node:crypto";
import { watch, type FSWatcher } from "node:fs";
import type { CompanionStore } from "./companion-store.js";
import type { StoredScene, SceneStoreCommand } from "./scene-state.js";
import type {
  CatalogListing,
  SceneSettings,
  CompanionSnapshot,
  InstalledPetView,
  OutfitView,
} from "../protocol.js";
import { CatalogService, compatibilityProblem } from "./catalog-service.js";
import { PetStore, type InstalledPet } from "./pet-store.js";

export type AssetLocation =
  { kind: "local"; path: string } | { kind: "remote"; url: string };
export type HostSnapshot = CompanionSnapshot<AssetLocation>;
export type HostListing = CatalogListing<AssetLocation>;
export type HostImportResult =
  | { status: "cancelled" }
  | { status: "installed"; petId: string; snapshot: HostSnapshot };
class AssetChangedDuringRefresh extends Error {}
export class PackageOutcomeUnknownError extends Error {
  readonly outcome = "unknown" as const;
  constructor(cause: unknown) {
    super("The package may have been installed. Refresh before retrying.", {
      cause,
    });
  }
}

export class CompanionService {
  private revision = 0;
  private queue: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<(snapshot: HostSnapshot) => void>();
  private readonly shutdown = new AbortController();
  private readonly inFlight = new Set<Promise<unknown>>();
  private readonly detachedPackageOperations = new Set<Promise<void>>();
  private readonly installed = new Map<string, InstalledPet>();
  private readonly problems = new Map<string, string>();
  private readonly catalog: CatalogService;
  private readonly store: PetStore;
  private readonly installation: PackageInstallation;
  private readonly references = new Map<string, Receipt>();
  private readonly atlasPath: string;
  private readonly storagePath: string;
  private readonly log: (message: string) => void;
  private readonly interactions: PackageInteractions;
  private readonly sceneStore: Pick<
    CompanionStore,
    | "initialize"
    | "read"
    | "mutate"
    | "dispose"
    | "initializeAssetReferences"
    | "assetReferencesInitialized"
    | "listAssetReferences"
    | "readAssetReference"
    | "compareAndSwapAssetReference"
  >;
  private disposing?: Promise<void>;
  private closed = false;
  private scene?: StoredScene;
  private watcher?: FSWatcher;
  private refreshTimer?: ReturnType<typeof setTimeout>;

  constructor(options: {
    atlasPath: string;
    storagePath: string;
    stateStore: Pick<
      CompanionStore,
      | "initialize"
      | "read"
      | "mutate"
      | "dispose"
      | "initializeAssetReferences"
      | "assetReferencesInitialized"
      | "listAssetReferences"
      | "readAssetReference"
      | "compareAndSwapAssetReference"
    >;
    petStore?: PetStore;
    catalog?: CatalogService;
    interactions: PackageInteractions;
    log?: (message: string) => void;
  }) {
    this.atlasPath = options.atlasPath;
    this.storagePath = options.storagePath;
    this.log = options.log ?? (() => {});
    this.interactions = options.interactions;
    this.sceneStore = options.stateStore;
    this.catalog = options.catalog ?? new CatalogService(this.shutdown.signal);
    this.store =
      options.petStore ??
      new PetStore(this.storagePath, this.sceneStore, undefined, this.log);
    this.installation = new PackageInstallation({
      petStore: this.store,
      stateStore: this.sceneStore,
      catalog: this.catalog,
      interactions: this.interactions,
      signal: this.shutdown.signal,
      log: this.log,
    });
  }

  async initialize(): Promise<void> {
    this.scene = await this.sceneStore.initialize();
    if (!(await this.sceneStore.assetReferencesInitialized())) {
      const legacy = await readLegacyInstalledReferences(
        this.storagePath,
        this.log,
      );
      await this.sceneStore.initializeAssetReferences(
        legacy.references,
        legacy.problems,
      );
    }
    await this.store.initialize();
    await this.refreshReferences();
    this.startSceneWatcher();
  }

  private async refreshReferences(): Promise<boolean> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const listing = await this.sceneStore.listAssetReferences();
      const references = new Map(
        listing.references.map((item) => [item.id, item]),
      );
      const installed = new Map<string, InstalledPet>();
      const problems = new Map(
        listing.problems.map((item) => [item.id, item.message]),
      );
      let raced = false;
      for (const receipt of listing.references) {
        const previous = this.installed.get(receipt.id);
        if (
          previous &&
          !this.problems.has(receipt.id) &&
          JSON.stringify(previous.receipt) === JSON.stringify(receipt)
        ) {
          installed.set(receipt.id, previous);
          continue;
        }
        try {
          const pet = await this.store.load(receipt.id, this.shutdown.signal);
          if (JSON.stringify(pet.receipt) !== JSON.stringify(receipt)) {
            raced = true;
            break;
          }
          installed.set(receipt.id, pet);
          if (pet.package.outfitProblems?.length)
            problems.set(
              receipt.id,
              `Some outfits are unavailable: ${pet.package.outfitProblems.join(", ")}`,
            );
          if (
            receipt.id === "builtin" &&
            (!pet.package.metadata.wardrobe ||
              !pet.package.availableOutfitIds.length ||
              pet.package.metadata.wardrobe.outfits.some(
                (outfit) => !pet.package.availableOutfitIds.includes(outfit.id),
              ))
          ) {
            problems.set(
              receipt.id,
              "Custom wardrobe is incomplete; bundled outfits are in use.",
            );
          }
        } catch (error) {
          this.shutdown.signal.throwIfAborted();
          const latest = await this.sceneStore.readAssetReference(receipt.id);
          if (JSON.stringify(latest) !== JSON.stringify(receipt)) {
            raced = true;
            break;
          }
          const message =
            error instanceof Error ? error.message : "invalid installation";
          problems.set(receipt.id, message);
          this.log(`[storage] ${receipt.id}: ${message}`);
        }
      }
      const latest = await this.sceneStore.listAssetReferences();
      if (raced || JSON.stringify(latest) !== JSON.stringify(listing)) continue;
      const changed =
        JSON.stringify([...this.references]) !==
          JSON.stringify([...references]) ||
        JSON.stringify([...this.problems]) !== JSON.stringify([...problems]) ||
        JSON.stringify([...this.installed]) !== JSON.stringify([...installed]);
      this.references.clear();
      this.installed.clear();
      this.problems.clear();
      for (const [id, value] of references) this.references.set(id, value);
      for (const [id, value] of installed) this.installed.set(id, value);
      for (const [id, value] of problems) this.problems.set(id, value);
      return changed;
    }
    throw new AssetChangedDuringRefresh(
      "Asset references changed during refresh; retry.",
    );
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
    const scene = await this.requireCompanionStore().read();
    const assetsChanged = await this.refreshReferences();
    if (assetsChanged || JSON.stringify(scene) !== JSON.stringify(this.scene)) {
      this.scene = scene;
      if (!this.closed) return this.publish();
    }
    return this.buildSnapshot();
  }

  private startSceneWatcher(): void {
    if (!this.storagePath || this.closed) return;
    try {
      const watcher = watch(this.storagePath, (_event, filename) => {
        if (
          this.closed ||
          (filename !== null &&
            filename.toString() !== "scene.sqlite" &&
            filename.toString() !== "scene.sqlite-journal")
        )
          return;
        if (this.refreshTimer) clearTimeout(this.refreshTimer);
        this.refreshTimer = setTimeout(() => {
          this.refreshTimer = undefined;
          if (this.closed) return;
          const refresh = this.queue.then(() => this.refreshScene());
          this.queue = refresh.then(
            () => undefined,
            (error: unknown) => {
              if (!this.closed)
                this.log(
                  `[scene] Watch refresh failed: ${error instanceof Error ? error.message : String(error)}`,
                );
            },
          );
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
      this.log(
        `[scene] Watcher unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private buildSnapshot(): HostSnapshot {
    if (!this.scene) throw new Error("Scene is not initialized.");
    const builtinSprite = {
      uri: { kind: "local" as const, path: this.atlasPath },
      layout: getPetSpriteLayout({ spriteVersionNumber: 2 }),
    };
    const builtinPackage = this.problems.has("builtin")
      ? undefined
      : this.installed.get("builtin");
    const bundledOutfits: OutfitView<AssetLocation>[] =
      builtInPetWardrobe.outfits.map((outfit) => {
        const filename = builtInPetOutfitFileName(outfit.id);
        if (!filename) throw new Error("Bundled outfit metadata is invalid.");
        return {
          id: outfit.id,
          displayName: outfit.displayName,
          sprite: {
            uri: {
              kind: "local" as const,
              path: join(dirname(this.atlasPath), filename),
            },
            layout: builtinSprite.layout,
          },
        };
      });
    const builtinOutfits: OutfitView<AssetLocation>[] = [
      { id: "default", displayName: "Default", sprite: builtinSprite },
      ...(builtinPackage
        ? this.outfits(builtinPackage).slice(1)
        : bundledOutfits),
    ];
    const builtin: InstalledPetView<AssetLocation> = {
      id: "builtin",
      displayName: "Hoodie Cat",
      description: "The bundled OpenPets companion.",
      source: "builtin",
      wardrobeSource: builtinPackage ? "local" : "bundled",
      ...(this.references.has("builtin") || this.problems.has("builtin")
        ? { hasLocalWardrobeOverride: true }
        : {}),
      outfits: builtinOutfits,
      wardrobeStatus: builtinPackage ? "local" : "current",
      ...(this.problems.has("builtin")
        ? { problem: this.problems.get("builtin") }
        : {}),
    };
    const installedPets: InstalledPetView<AssetLocation>[] = [
      builtin,
      ...[...this.installed.values()]
        .filter((pet) => pet.id !== "builtin")
        .map((pet) => ({
          id: pet.id,
          displayName: pet.package.metadata.displayName,
          description: pet.package.metadata.description,
          source: pet.receipt.source.kind,
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
    const unavailable = [...this.problems].filter(
      ([id]) => id !== "builtin" && !this.installed.has(id),
    );
    const notice = unavailable.length
      ? unavailable.map(([id, message]) => `${id}: ${message}`).join("; ")
      : undefined;
    return {
      revision: this.revision,
      settings: this.scene.settings,
      selectedInstanceId: this.scene.selectedInstanceId,
      instances,
      installedPets,
      ...(notice ? { notice } : {}),
    };
  }

  async listCatalog(query: string, page: number): Promise<HostListing> {
    this.assertOpen();
    const work = this.catalog.list(
      query,
      page,
      new Set(
        [...this.installed.values()]
          .filter((pet) => pet.receipt.source.kind === "catalog")
          .map((pet) => pet.id),
      ),
    );
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
  async installPet(petId: string, signal?: AbortSignal): Promise<HostSnapshot> {
    return this.install(petId, false, signal);
  }
  async installWardrobe(
    petId: string,
    signal?: AbortSignal,
  ): Promise<HostSnapshot> {
    return this.install(petId, true, signal);
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
    if (
      petId !== "builtin" &&
      this.installed.get(petId)?.receipt.source.kind === "local"
    )
      return this.commit(async () => {});
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
      this.scene = await this.requireCompanionStore().mutate(command);
    });
  }
  private requireCompanionStore(): Pick<
    CompanionStore,
    "initialize" | "read" | "mutate" | "dispose"
  > {
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
          await this.installation.dispose();
          await this.waitForPackageOperations();
          await this.store.dispose();
        } finally {
          await this.sceneStore?.dispose();
        }
      },
    );
    return this.disposing;
  }
  async importPetPackage(
    targetPetId?: string,
    signal?: AbortSignal,
  ): Promise<HostImportResult> {
    this.assertOpen();
    if (
      targetPetId &&
      targetPetId !== "builtin" &&
      !this.installed.has(targetPetId)
    )
      throw new Error("This pet is not installed or is unavailable.");
    const installed = await this.installation.importPackage(
      targetPetId,
      signal,
    );
    if (!installed) return { status: "cancelled" };
    const snapshot = await this.publishPackageCommit();
    return { status: "installed", petId: installed.id, snapshot };
  }
  async openStudio(intent: "pet" | "outfit", petId?: string): Promise<void> {
    this.assertOpen();
    if (intent === "pet") {
      if (petId !== undefined)
        throw new Error("Pet creation does not accept a pet ID.");
      await this.interactions.openStudio("pet");
      return;
    }
    const pet = this.buildSnapshot().installedPets.find(
      (item) => item.id === petId,
    );
    if (!pet) throw new Error("This pet is not installed or is unavailable.");
    await this.interactions.openStudio("outfit", pet);
  }
  trackDetachedPackageOperations(drain: Promise<void>): void {
    const observed = drain.catch((error: unknown) => {
      this.log(`[install] detached operation drain failed: ${String(error)}`);
    }).finally(() => {
      this.detachedPackageOperations.delete(observed);
    });
    this.detachedPackageOperations.add(observed);
  }
  async waitForPackageOperations(): Promise<void> {
    while (this.detachedPackageOperations.size > 0) {
      await Promise.all([...this.detachedPackageOperations]);
    }
  }
  private async install(
    id: string,
    wardrobe: boolean,
    signal?: AbortSignal,
  ): Promise<HostSnapshot> {
    this.assertOpen();
    if (id === "builtin")
      throw new Error(
        "Bundled outfits are already available; import a custom wardrobe instead.",
      );
    if (wardrobe && !this.installed.has(id))
      throw new Error("Install this pet before its wardrobe.");
    if (wardrobe && this.installed.get(id)?.receipt.source.kind === "local")
      throw new Error(
        "Local outfits cannot be replaced by a catalog wardrobe.",
      );
    const installed = await this.installation.installCatalog(
      id,
      wardrobe,
      signal,
    );
    if (!installed) return this.getSnapshot();
    return this.publishPackageCommit();
  }
  private async publishPackageCommit(): Promise<HostSnapshot> {
    try {
      return await this.commit(async () => {
        await this.refreshReferences();
        this.assertOpen();
      });
    } catch (error) {
      this.log(
        `[install] committed package could not be refreshed: ${String(error)}`,
      );
      throw new PackageOutcomeUnknownError(error);
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
  ): "unknown" | "none" | "install" | "update" | "current" | "local" {
    if (installed?.receipt.source.kind === "local") return "local";
    const known = this.catalog.knownPet(id);
    if (!known) return "unknown";
    if (!known.wardrobeZip || compatibilityProblem(known)) return "none";
    if (!installed?.package.metadata.wardrobe) return "install";
    return installed.receipt.source.kind === "catalog" &&
      installed.receipt.source.url === known.wardrobeZip
      ? "current"
      : "update";
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
    if (this.installation.busy)
      throw new Error(
        "A pet installation is in progress. Try again when it finishes.",
      );
  }
}
