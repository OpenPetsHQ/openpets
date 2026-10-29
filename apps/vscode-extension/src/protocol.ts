import type { PetSpriteLayout } from "@open-pets/pet-format/sprite-layout";

export type CompanionSize = "small" | "medium" | "large";
export type SurfaceKind = "view" | "editor";

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
  wardrobeAction: "none" | "install" | "update";
  problem?: string;
}

export interface CompanionSnapshot<Location = string> {
  revision: number;
  size: CompanionSize;
  selectedPetId: string;
  installedPets: readonly InstalledPetView<Location>[];
  active: {
    petId: string;
    outfitId: string;
    sprite: SpriteAsset<Location>;
  };
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
  selectPet: { petId: string };
  selectOutfit: { petId: string; outfitId: string };
  setSize: { size: CompanionSize };
  openEditor: undefined;
  showSidebar: undefined;
}

export interface Results {
  ready: ReadyState;
  listCatalog: CatalogListing;
  installPet: CompanionSnapshot;
  installWardrobe: CompanionSnapshot;
  selectPet: CompanionSnapshot;
  selectOutfit: CompanionSnapshot;
  setSize: CompanionSnapshot;
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
      error: { message: string };
    };

export type HostEvent =
  | { type: "snapshot"; snapshot: CompanionSnapshot }
  | { type: "surface"; surface: SurfaceState };

export interface CompanionBackend {
  ready(): Promise<ReadyState>;
  listCatalog(query: string, page: number): Promise<CatalogListing>;
  installPet(petId: string): Promise<CompanionSnapshot>;
  installWardrobe(petId: string): Promise<CompanionSnapshot>;
  selectPet(petId: string): Promise<CompanionSnapshot>;
  selectOutfit(petId: string, outfitId: string): Promise<CompanionSnapshot>;
  setSize(size: CompanionSize): Promise<CompanionSnapshot>;
  openEditor(): Promise<void>;
  showSidebar(): Promise<void>;
  onSnapshot(listener: (value: CompanionSnapshot) => void): () => void;
  onSurface(listener: (value: SurfaceState) => void): () => void;
  dispose(): void;
}
