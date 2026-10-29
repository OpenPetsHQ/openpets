import type { PetSpriteLayout } from "@open-pets/pet-format/sprite-layout";

export type CompanionSize = "small" | "medium" | "large";
export type SurfaceKind = "view" | "editor";
export type SceneMotion = "still" | "calm" | "playful";
export type SceneBackdrop = "plain" | "dots";
export interface SceneSettings {
  size: CompanionSize;
  motion: SceneMotion;
  paused: boolean;
  backdrop: SceneBackdrop;
}

export interface SpriteAsset<Location = string> {
  uri: Location;
  layout: PetSpriteLayout;
}

export interface OutfitView<Location = string> {
  id: string;
  displayName: string;
  sprite: SpriteAsset<Location>;
}

export interface InstalledPetView<Location = string> {
  id: string;
  displayName: string;
  description: string;
  source: "builtin" | "catalog";
  outfits: readonly OutfitView<Location>[];
  wardrobeStatus: "unknown" | "none" | "install" | "update" | "current";
  problem?: string;
}

export interface SceneInstanceView<Location = string> {
  id: string;
  petId: string;
  name: string;
  outfitId: string;
  appearance: {
    sprite: SpriteAsset<Location>;
    outfitName: string;
    fallback: boolean;
  };
  problem?: string;
}
export interface CompanionSnapshot<Location = string> {
  revision: number;
  settings: SceneSettings;
  selectedInstanceId: string | null;
  instances: readonly SceneInstanceView<Location>[];
  installedPets: readonly InstalledPetView<Location>[];
  notice?: string;
}

export interface CatalogPetView<Location = string> {
  id: string;
  displayName: string;
  description: string;
  thumbnailUri: Location;
  sprite: SpriteAsset<Location>;
  category: "western" | "asian";
  original: boolean;
  featured: boolean;
  installed: boolean;
  hasWardrobe: boolean;
  canInstall: boolean;
  unavailableReason?: string;
}

export interface CatalogListing<Location = string> {
  query: string;
  page: number;
  pageSize: 24;
  total: number;
  pageCount: number;
  pets: readonly CatalogPetView<Location>[];
}

export interface SurfaceState {
  surfaceId: string;
  kind: SurfaceKind;
  visible: boolean;
  playbackEnabled: boolean;
  sequence: number;
}

export interface ReadyState {
  snapshot: CompanionSnapshot;
  surface: SurfaceState;
}

export interface Requests {
  ready: undefined;
  listCatalog: { query: string; page: number };
  installPet: { petId: string };
  installWardrobe: { petId: string };
  addInstance: { petId: string; name: string };
  renameInstance: { instanceId: string; name: string };
  removeInstance: { instanceId: string };
  selectInstance: { instanceId: string };
  setInstanceOutfit: { instanceId: string; outfitId: string };
  setSceneSettings: { changes: Partial<SceneSettings> };
  refreshWardrobe: { petId: string };
  openEditor: undefined;
  showSidebar: undefined;
}

export interface Results {
  ready: ReadyState;
  listCatalog: CatalogListing;
  installPet: CompanionSnapshot;
  installWardrobe: CompanionSnapshot;
  addInstance: CompanionSnapshot;
  renameInstance: CompanionSnapshot;
  removeInstance: CompanionSnapshot;
  selectInstance: CompanionSnapshot;
  setInstanceOutfit: CompanionSnapshot;
  setSceneSettings: CompanionSnapshot;
  refreshWardrobe: CompanionSnapshot;
  openEditor: null;
  showSidebar: null;
}

export type Request = {
  [Method in keyof Requests]: {
    type: "request";
    id: string;
    method: Method;
    params: Requests[Method];
  };
}[keyof Requests];

export type Response =
  | {
      type: "response";
      id: string;
      ok: true;
      result: Results[keyof Results];
    }
  | {
      type: "response";
      id: string;
      ok: false;
      error: { message: string; outcome?: "unknown" };
    };

export type HostEvent =
  | { type: "snapshot"; snapshot: CompanionSnapshot }
  | { type: "surface"; surface: SurfaceState };

export interface CompanionBackend {
  ready(): Promise<ReadyState>;
  listCatalog(query: string, page: number): Promise<CatalogListing>;
  installPet(petId: string): Promise<CompanionSnapshot>;
  installWardrobe(petId: string): Promise<CompanionSnapshot>;
  addInstance(petId: string, name: string): Promise<CompanionSnapshot>;
  renameInstance(instanceId: string, name: string): Promise<CompanionSnapshot>;
  removeInstance(instanceId: string): Promise<CompanionSnapshot>;
  selectInstance(instanceId: string): Promise<CompanionSnapshot>;
  setInstanceOutfit(
    instanceId: string,
    outfitId: string,
  ): Promise<CompanionSnapshot>;
  setSceneSettings(changes: Partial<SceneSettings>): Promise<CompanionSnapshot>;
  refreshWardrobe(petId: string): Promise<CompanionSnapshot>;
  openEditor(): Promise<void>;
  showSidebar(): Promise<void>;
  onSnapshot(listener: (value: CompanionSnapshot) => void): () => void;
  onSurface(listener: (value: SurfaceState) => void): () => void;
  dispose(): void;
}
