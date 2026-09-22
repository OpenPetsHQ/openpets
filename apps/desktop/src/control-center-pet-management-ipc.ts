import type { getAppStateSnapshot } from "./app-state.js";
import { codexV2SpriteLayout, type CodexPetSpriteLayout } from "./codex-pets-core.js";

export type ControlCenterPetManagementIpcChannel =
  | "openpets:get-pets-state"
  | "openpets:get-catalog"
  | "openpets:get-catalog-page"
  | "openpets:get-catalog-search"
  | "openpets:get-codex-pets"
  | "openpets:set-default-pet"
  | "openpets:set-pet-pool-order"
  | "openpets:install-pet"
  | "openpets:install-local-pet"
  | "openpets:open-gallery"
  | "openpets:import-codex-pet"
  | "openpets:remove-pet"
  | "openpets:reset-default-pet-position";

export type ControlCenterPetManagementIpcEvent = {
  readonly sender: { readonly id: number };
};

export type ControlCenterPetManagementIpcHandler = (
  event: ControlCenterPetManagementIpcEvent,
  ...args: unknown[]
) => unknown | Promise<unknown>;

export type ControlCenterPetManagementIpcHandleRegistrar = (
  channel: ControlCenterPetManagementIpcChannel,
  handler: ControlCenterPetManagementIpcHandler,
) => void;

type AppStateSnapshot = ReturnType<typeof getAppStateSnapshot>;
type InstalledPet = AppStateSnapshot["pets"]["installed"][number];

type MessageBoxOptions = {
  type: "question";
  title: string;
  message: string;
  detail: string;
  buttons: string[];
  defaultId: number;
  cancelId: number;
  noLink: true;
};

type OpenDialogOptions = {
  title: string;
  buttonLabel: string;
  properties: ("openFile" | "openDirectory")[];
  filters?: { name: string; extensions: string[] }[];
};

type OpenDialogResult = {
  readonly canceled: boolean;
  readonly filePaths: readonly string[];
};

type ControlCenterPetManagementIpcLogger = {
  readonly debug: (message: string, fields?: Record<string, unknown>) => void;
  readonly error: (message: string, fields?: Record<string, unknown>) => void;
};

export type ControlCenterPetManagementIpcDependencies = {
  readonly registerHandle: ControlCenterPetManagementIpcHandleRegistrar;
  readonly authorizeSender: (event: ControlCenterPetManagementIpcEvent) => void;
  readonly isCurrentControlCenterSender: (event: ControlCenterPetManagementIpcEvent) => boolean;
  readonly getOwnerForSender: (event: ControlCenterPetManagementIpcEvent) => unknown;
  readonly showMessageBox: (owner: unknown, options: MessageBoxOptions) => Promise<{ readonly response: number }>;
  readonly showOpenDialog: (owner: unknown, options: OpenDialogOptions) => Promise<OpenDialogResult>;
  readonly stat: (path: string) => Promise<{ readonly isDirectory: () => boolean }>;
  readonly openExternal: (url: string) => Promise<void>;
  readonly setTimeout: (callback: () => void, delayMs: number) => { readonly unref?: () => void };
  readonly getAppStateSnapshot: () => AppStateSnapshot;
  readonly getSettingsStateSnapshot: () => unknown;
  readonly readInstalledPetSpriteLayout: (petId: string, source: "personal" | "team") => Promise<CodexPetSpriteLayout>;
  readonly getCatalogUiState: () => unknown | Promise<unknown>;
  readonly getCatalogPageUiState: (page: number) => unknown | Promise<unknown>;
  readonly getCatalogSearchUiState: () => unknown | Promise<unknown>;
  readonly getCodexPetsUiState: () => unknown | Promise<unknown>;
  readonly setDefaultInstalledPet: (petId: string) => unknown | Promise<unknown>;
  readonly refreshDefaultPetContent: () => void;
  readonly recoverDefaultPetMouseInterop: (reason: string) => void;
  readonly broadcastDashboardRefresh: () => void;
  readonly normalizePetPoolOrder: (ids: unknown) => readonly string[] | undefined;
  readonly setPetPoolOrder: (ids: readonly string[]) => unknown;
  readonly installPet: (petId: string) => unknown | Promise<unknown>;
  readonly installPetFromFolder: (path: string) => unknown | Promise<unknown>;
  readonly installPetFromZipFile: (path: string) => unknown | Promise<unknown>;
  readonly importCodexPet: (petId: string) => unknown | Promise<unknown>;
  readonly removePet: (petId: string) => unknown | Promise<unknown>;
  readonly resetDefaultPetToInitialPosition: () => void;
  readonly logger: ControlCenterPetManagementIpcLogger;
};

export function installControlCenterPetManagementIpcHandlers({
  registerHandle,
  authorizeSender,
  isCurrentControlCenterSender,
  getOwnerForSender,
  showMessageBox,
  showOpenDialog,
  stat,
  openExternal,
  setTimeout,
  getAppStateSnapshot,
  getSettingsStateSnapshot,
  readInstalledPetSpriteLayout,
  getCatalogUiState,
  getCatalogPageUiState,
  getCatalogSearchUiState,
  getCodexPetsUiState,
  setDefaultInstalledPet,
  refreshDefaultPetContent,
  recoverDefaultPetMouseInterop,
  broadcastDashboardRefresh,
  normalizePetPoolOrder,
  setPetPoolOrder,
  installPet,
  installPetFromFolder,
  installPetFromZipFile,
  importCodexPet,
  removePet,
  resetDefaultPetToInitialPosition,
  logger,
}: ControlCenterPetManagementIpcDependencies): void {
  registerHandle("openpets:get-pets-state", (event) => {
    authorizeSender(event);
    return getPetsStateSnapshot(getAppStateSnapshot, readInstalledPetSpriteLayout);
  });

  registerHandle("openpets:get-catalog", async (event) => {
    authorizeSender(event);
    return getCatalogUiState();
  });

  registerHandle("openpets:get-catalog-page", async (event, page: unknown) => {
    authorizeSender(event);
    if (typeof page !== "number" || !Number.isInteger(page) || page < 0) throw new Error("Invalid catalog page.");
    return getCatalogPageUiState(page);
  });

  registerHandle("openpets:get-catalog-search", async (event) => {
    authorizeSender(event);
    return getCatalogSearchUiState();
  });

  registerHandle("openpets:get-codex-pets", async (event) => {
    authorizeSender(event);
    return getCodexPetsUiState();
  });

  registerHandle("openpets:set-default-pet", async (event, petId: unknown) => {
    authorizeSender(event);
    if (typeof petId !== "string") throw new Error("Invalid pet id.");

    const state = await setDefaultInstalledPet(petId);
    refreshDefaultPetContent();
    recoverDefaultPetMouseInterop("default-pet-changed");
    setTimeout(() => recoverDefaultPetMouseInterop("default-pet-changed+500ms"), 500).unref?.();
    broadcastDashboardRefresh();
    return isCurrentControlCenterSender(event)
      ? getPetsStateSnapshot(getAppStateSnapshot, readInstalledPetSpriteLayout)
      : state;
  });

  registerHandle("openpets:set-pet-pool-order", (event, ids: unknown) => {
    authorizeSender(event);
    if (!Array.isArray(ids)) throw new Error("Invalid pet pool order: expected an array.");
    const normalized = normalizePetPoolOrder(ids);
    setPetPoolOrder(normalized ?? []);
    return getSettingsStateSnapshot();
  });

  registerHandle("openpets:install-pet", async (event, petId: unknown) => {
    authorizeSender(event);
    if (typeof petId !== "string") throw new Error("Invalid pet id.");

    const state = await installPet(petId);
    return isCurrentControlCenterSender(event)
      ? getPetsStateSnapshot(getAppStateSnapshot, readInstalledPetSpriteLayout)
      : state;
  });

  registerHandle("openpets:install-local-pet", async (event) => {
    authorizeSender(event);
    const owner = getOwnerForSender(event);
    const importKind = await chooseLocalPetImportKind(owner, showMessageBox);
    if (!importKind) return getPetsStateSnapshot(getAppStateSnapshot, readInstalledPetSpriteLayout);

    const options: OpenDialogOptions = importKind === "zip" ? {
      title: "Install pet from ZIP",
      buttonLabel: "Install Pet",
      properties: ["openFile"],
      filters: [{ name: "OpenPets ZIP", extensions: ["zip"] }],
    } : {
      title: "Install pet from folder",
      buttonLabel: "Install Pet",
      properties: ["openDirectory"],
    };
    const result = await showOpenDialog(owner, options);
    if (result.canceled || !result.filePaths[0]) return getPetsStateSnapshot(getAppStateSnapshot, readInstalledPetSpriteLayout);
    const selectedPath = result.filePaths[0];
    try {
      const selectedStats = await stat(selectedPath);
      const state = selectedStats.isDirectory()
        ? await installPetFromFolder(selectedPath)
        : await installPetFromZipFile(selectedPath);
      logger.debug("local pet import succeeded", { kind: selectedStats.isDirectory() ? "folder" : "zip" });
      refreshDefaultPetContent();
      return isCurrentControlCenterSender(event)
        ? getPetsStateSnapshot(getAppStateSnapshot, readInstalledPetSpriteLayout)
        : state;
    } catch (error) {
      logger.error("local pet import failed", { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  });

  registerHandle("openpets:open-gallery", async (event) => {
    authorizeSender(event);
    await openExternal("https://openpets.dev/gallery");
  });

  registerHandle("openpets:import-codex-pet", async (event, petId: unknown) => {
    authorizeSender(event);
    if (typeof petId !== "string") throw new Error("Invalid pet id.");

    const state = await importCodexPet(petId);
    return isCurrentControlCenterSender(event)
      ? getPetsStateSnapshot(getAppStateSnapshot, readInstalledPetSpriteLayout)
      : state;
  });

  registerHandle("openpets:remove-pet", async (event, petId: unknown) => {
    authorizeSender(event);
    if (typeof petId !== "string") throw new Error("Invalid pet id.");

    const state = await removePet(petId);
    refreshDefaultPetContent();
    return isCurrentControlCenterSender(event)
      ? getPetsStateSnapshot(getAppStateSnapshot, readInstalledPetSpriteLayout)
      : state;
  });

  registerHandle("openpets:reset-default-pet-position", (event) => {
    authorizeSender(event);
    resetDefaultPetToInitialPosition();
    return isCurrentControlCenterSender(event) ? getSettingsStateSnapshot() : getAppStateSnapshot();
  });
}

async function getPetsStateSnapshot(
  getAppStateSnapshot: () => AppStateSnapshot,
  readInstalledPetSpriteLayout: (petId: string, source: "personal" | "team") => Promise<CodexPetSpriteLayout>,
): Promise<{
  readonly preferences: { readonly defaultPetId: string };
  readonly pets: { readonly installed: ReadonlyArray<InstalledPet & { readonly spriteLayout?: CodexPetSpriteLayout }> };
}> {
  const state = getAppStateSnapshot();
  const installed = await Promise.all(state.pets.installed.map(async (pet) => {
    if (pet.builtIn) return { ...pet, spriteLayout: codexV2SpriteLayout };
    try {
      return {
        ...pet,
        spriteLayout: await readInstalledPetSpriteLayout(pet.id, pet.source?.kind === "team" ? "team" : "personal"),
      };
    } catch {
      return pet;
    }
  }));
  return { preferences: { defaultPetId: state.preferences.defaultPetId }, pets: { installed } };
}

async function chooseLocalPetImportKind(
  owner: unknown,
  showMessageBox: ControlCenterPetManagementIpcDependencies["showMessageBox"],
): Promise<"zip" | "folder" | null> {
  const options: MessageBoxOptions = {
    type: "question",
    title: "Install pet",
    message: "Install pet from ZIP or folder?",
    detail: "Choose the source type before selecting the pet package.",
    buttons: ["ZIP", "Folder", "Cancel"],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  };
  const result = await showMessageBox(owner, options);
  if (result.response === 0) return "zip";
  if (result.response === 1) return "folder";
  return null;
}
