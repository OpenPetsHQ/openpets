import assert from "node:assert/strict";

import {
  installControlCenterPetManagementIpcHandlers,
  type ControlCenterPetManagementIpcDependencies,
  type ControlCenterPetManagementIpcEvent,
  type ControlCenterPetManagementIpcHandler,
} from "../src/control-center-pet-management-ipc.js";

const channels = [
  "openpets:get-pets-state",
  "openpets:get-catalog",
  "openpets:get-catalog-page",
  "openpets:get-catalog-search",
  "openpets:get-codex-pets",
  "openpets:set-default-pet",
  "openpets:set-pet-pool-order",
  "openpets:install-pet",
  "openpets:install-local-pet",
  "openpets:open-gallery",
  "openpets:import-codex-pet",
  "openpets:remove-pet",
  "openpets:reset-default-pet-position",
] as const;

const event: ControlCenterPetManagementIpcEvent = { sender: { id: 7 } };

type Call = { readonly method: string; readonly args: readonly unknown[] };

function createHarness() {
  const handlers = new Map<string, ControlCenterPetManagementIpcHandler>();
  const calls: Call[] = [];
  const logs: Array<{ readonly level: string; readonly message: string; readonly fields?: Record<string, unknown> }> = [];
  const state = {
    preferences: { defaultPetId: "default" },
    pets: {
      installed: [
        { id: "builtin", builtIn: true, displayName: "Built-in" },
        { id: "personal", builtIn: false, displayName: "Personal" },
        { id: "team", builtIn: false, displayName: "Team", source: { kind: "team" } },
        { id: "broken-layout", builtIn: false, displayName: "Broken layout" },
      ],
    },
  };
  const settings = { settings: true };
  let currentControlCenter = true;
  let messageResponse = 2;
  let openDialogResult = { canceled: true, filePaths: [] as string[] };
  let selectedIsDirectory = false;
  let mutationError: Error | null = null;
  const delayedCallbacks: Array<() => void> = [];
  const owners: unknown[] = [];
  const layoutPaths: string[] = [];
  let activeLayouts = 0;
  let maxActiveLayouts = 0;
  const dialogOptions: unknown[] = [];
  const owner = { kind: "owner" };

  const record = (method: string, ...args: unknown[]) => calls.push({ method, args });
  const mutate = async (method: string, value: unknown) => {
    record(method, value);
    if (mutationError) throw mutationError;
    return { from: method };
  };

  const dependencies: ControlCenterPetManagementIpcDependencies = {
    registerHandle: (channel, handler) => handlers.set(channel, handler),
    authorizeSender: () => record("authorize"),
    isCurrentControlCenterSender: () => currentControlCenter,
    getOwnerForSender: () => { record("getOwnerForSender"); owners.push(owner); return owner; },
    showMessageBox: async (dialogOwner, options) => {
      record("showMessageBox", dialogOwner, options);
      dialogOptions.push(options);
      return { response: messageResponse };
    },
    showOpenDialog: async (dialogOwner, options) => {
      record("showOpenDialog", dialogOwner, options);
      dialogOptions.push(options);
      return openDialogResult;
    },
    stat: async (path) => {
      record("stat", path);
      return { isDirectory: () => selectedIsDirectory };
    },
    openExternal: async (url) => { record("openExternal", url); },
    setTimeout: (callback, delayMs) => {
      record("setTimeout", delayMs);
      delayedCallbacks.push(callback);
      return { unref: () => record("unref") };
    },
    getAppStateSnapshot: () => { record("getAppStateSnapshot"); return state as never; },
    getSettingsStateSnapshot: () => { record("getSettingsStateSnapshot"); return settings; },
    readInstalledPetSpriteLayout: async (petId, source) => {
      record("readInstalledPetSpriteLayout", petId, source);
      layoutPaths.push(`${petId}:${source}`);
      activeLayouts += 1;
      maxActiveLayouts = Math.max(maxActiveLayouts, activeLayouts);
      await Promise.resolve();
      activeLayouts -= 1;
      if (petId === "broken-layout") throw new Error("missing layout");
      return { petId, source } as never;
    },
    getCatalogUiState: async () => { record("getCatalogUiState"); return { catalog: true }; },
    getCatalogPageUiState: async (page) => { record("getCatalogPageUiState", page); return { page }; },
    getCatalogSearchUiState: async () => { record("getCatalogSearchUiState"); return { search: true }; },
    getCodexPetsUiState: async () => { record("getCodexPetsUiState"); return { codex: true }; },
    setDefaultInstalledPet: (petId) => mutate("setDefaultInstalledPet", petId),
    refreshDefaultPetContent: () => record("refreshDefaultPetContent"),
    recoverDefaultPetMouseInterop: (reason) => record("recoverDefaultPetMouseInterop", reason),
    broadcastDashboardRefresh: () => record("broadcastDashboardRefresh"),
    normalizePetPoolOrder: (ids) => { record("normalizePetPoolOrder", ids); return undefined; },
    setPetPoolOrder: (ids) => record("setPetPoolOrder", ids),
    installPet: (petId) => mutate("installPet", petId),
    installPetFromFolder: (path) => mutate("installPetFromFolder", path),
    installPetFromZipFile: (path) => mutate("installPetFromZipFile", path),
    importCodexPet: (petId) => mutate("importCodexPet", petId),
    removePet: (petId) => mutate("removePet", petId),
    resetDefaultPetToInitialPosition: () => record("resetDefaultPetToInitialPosition"),
    logger: {
      debug: (message, fields) => logs.push({ level: "debug", message, fields }),
      error: (message, fields) => logs.push({ level: "error", message, fields }),
    },
  };

  installControlCenterPetManagementIpcHandlers(dependencies);
  return {
    handlers,
    calls,
    logs,
    state,
    settings,
    owners,
    layoutPaths,
    getMaxActiveLayouts: () => maxActiveLayouts,
    dialogOptions,
    delayedCallbacks,
    owner,
    setCurrent: (value: boolean) => { currentControlCenter = value; },
    setMessageResponse: (value: number) => { messageResponse = value; },
    setOpenDialogResult: (value: typeof openDialogResult) => { openDialogResult = value; },
    setSelectedIsDirectory: (value: boolean) => { selectedIsDirectory = value; },
    setMutationError: (value: Error | null) => { mutationError = value; },
  };
}

function getHandler(harness: ReturnType<typeof createHarness>, channel: (typeof channels)[number]): ControlCenterPetManagementIpcHandler {
  const handler = harness.handlers.get(channel);
  assert.ok(handler, `missing handler ${channel}`);
  return handler;
}

assert.deepEqual([...createHarness().handlers.keys()], channels);

{
  const harness = createHarness();
  harness.calls.length = 0;
  harness.handlers.clear();
  installControlCenterPetManagementIpcHandlers({
    ...({} as ControlCenterPetManagementIpcDependencies),
    registerHandle: (channel, handler) => harness.handlers.set(channel, handler),
    authorizeSender: () => { throw new Error("unauthorized"); },
  });
  for (const channel of channels) {
    const args = channel.includes("pet") && !channel.includes("pets-state") && !channel.includes("pool") ? ["pet"] : channel === "openpets:set-pet-pool-order" ? [[]] : [];
    await assert.rejects(async () => getHandler(harness, channel)(event, ...args), /unauthorized/);
  }
  assert.deepEqual(harness.calls, [], "authorization is first for every channel");
}

{
  const harness = createHarness();
  assert.deepEqual(await getHandler(harness, "openpets:get-catalog")(event), { catalog: true });
  assert.deepEqual(await getHandler(harness, "openpets:get-catalog-page")(event, 3), { page: 3 });
  await assert.rejects(async () => getHandler(harness, "openpets:get-catalog-page")(event, -1), /Invalid catalog page\./);
  await assert.rejects(async () => getHandler(harness, "openpets:get-catalog-page")(event, 1.5), /Invalid catalog page\./);
  assert.deepEqual(await getHandler(harness, "openpets:get-catalog-search")(event), { search: true });
  assert.deepEqual(await getHandler(harness, "openpets:get-codex-pets")(event), { codex: true });
  const snapshot = await getHandler(harness, "openpets:get-pets-state")(event) as { readonly pets: { readonly installed: readonly { readonly id: string; readonly spriteLayout?: unknown }[] } };
  assert.equal(harness.calls.filter(({ method }) => method === "getAppStateSnapshot").length, 1);
  assert.equal(harness.getMaxActiveLayouts() > 1, true, "installed pet layout enrichment runs in parallel");
  assert.deepEqual(harness.layoutPaths, ["personal:personal", "team:team", "broken-layout:personal"]);
  assert.equal(snapshot.pets.installed.find((pet) => pet.id === "broken-layout")?.spriteLayout, undefined);
  assert.ok(snapshot.pets.installed.find((pet) => pet.id === "builtin")?.spriteLayout);
}

{
  const harness = createHarness();
  await getHandler(harness, "openpets:set-default-pet")(event, "personal");
  assert.deepEqual(harness.calls.slice(0, 8).map(({ method }) => method), [
    "authorize", "setDefaultInstalledPet", "refreshDefaultPetContent", "recoverDefaultPetMouseInterop", "setTimeout", "unref", "broadcastDashboardRefresh", "getAppStateSnapshot",
  ]);
  assert.deepEqual(harness.calls.find(({ method }) => method === "setDefaultInstalledPet")?.args, ["personal"]);
  assert.deepEqual(harness.calls.find(({ method }) => method === "setTimeout")?.args, [500]);
  harness.delayedCallbacks[0]?.();
  assert.equal(harness.calls.at(-1)?.method, "recoverDefaultPetMouseInterop");
  harness.setMutationError(new Error("cannot change"));
  await assert.rejects(async () => getHandler(harness, "openpets:set-default-pet")(event, "personal"), /cannot change/);
  assert.equal(harness.calls.filter(({ method }) => method === "refreshDefaultPetContent").length, 1);
}

{
  const harness = createHarness();
  harness.setMessageResponse(2);
  assert.deepEqual(await getHandler(harness, "openpets:install-local-pet")(event), await getHandler(harness, "openpets:get-pets-state")(event));
  assert.deepEqual(harness.owners, [harness.owner]);
  assert.equal(harness.calls.some(({ method }) => method === "showOpenDialog"), false);
  assert.equal(harness.calls.findIndex(({ method }) => method === "getOwnerForSender") < harness.calls.findIndex(({ method }) => method === "showMessageBox"), true);

  harness.setMessageResponse(0);
  harness.setOpenDialogResult({ canceled: true, filePaths: [] });
  const snapshotsBeforeDialogCancel = harness.calls.filter(({ method }) => method === "getAppStateSnapshot").length;
  await getHandler(harness, "openpets:install-local-pet")(event);
  assert.equal(harness.calls.filter(({ method }) => method === "showMessageBox").length, 2);
  assert.equal(harness.calls.some(({ method }) => method === "showOpenDialog"), true);
  assert.equal(harness.calls.findIndex(({ method }) => method === "showMessageBox") < harness.calls.findIndex(({ method }) => method === "showOpenDialog"), true);
  assert.equal(harness.calls.filter(({ method }) => method === "getAppStateSnapshot").length, snapshotsBeforeDialogCancel + 1);

  harness.setMessageResponse(1);
  harness.setOpenDialogResult({ canceled: false, filePaths: ["/tmp/pet-folder"] });
  harness.setSelectedIsDirectory(true);
  await getHandler(harness, "openpets:install-local-pet")(event);
  assert.equal(harness.calls.some(({ method, args }) => method === "installPetFromFolder" && args[0] === "/tmp/pet-folder"), true);
  assert.equal(harness.calls.some(({ method }) => method === "refreshDefaultPetContent"), true);

  harness.setMessageResponse(0);
  harness.setOpenDialogResult({ canceled: false, filePaths: ["/tmp/pet.zip"] });
  harness.setSelectedIsDirectory(false);
  await getHandler(harness, "openpets:install-local-pet")(event);
  assert.equal(harness.calls.some(({ method, args }) => method === "installPetFromZipFile" && args[0] === "/tmp/pet.zip"), true);

  harness.setMutationError(new Error("bad package"));
  const refreshesBeforeFailure = harness.calls.filter(({ method }) => method === "refreshDefaultPetContent").length;
  await assert.rejects(async () => getHandler(harness, "openpets:install-local-pet")(event), /bad package/);
  assert.equal(harness.logs.some(({ level, message }) => level === "error" && message === "local pet import failed"), true);
  assert.equal(harness.calls.filter(({ method }) => method === "refreshDefaultPetContent").length, refreshesBeforeFailure);
}

{
  const harness = createHarness();
  harness.setCurrent(false);
  const installed = await getHandler(harness, "openpets:install-pet")(event, "personal");
  assert.deepEqual(installed, { from: "installPet" });
  assert.equal(harness.calls.some(({ method }) => method === "getAppStateSnapshot"), false);
  assert.equal(harness.calls.some(({ method }) => method === "refreshDefaultPetContent"), false);
  const imported = await getHandler(harness, "openpets:import-codex-pet")(event, "personal");
  assert.deepEqual(imported, { from: "importCodexPet" });
  assert.equal(harness.calls.some(({ method }) => method === "refreshDefaultPetContent"), false);
  const removed = await getHandler(harness, "openpets:remove-pet")(event, "personal");
  assert.deepEqual(removed, { from: "removePet" });
  assert.equal(harness.calls.some(({ method }) => method === "refreshDefaultPetContent"), true);
  await assert.rejects(async () => getHandler(harness, "openpets:install-pet")(event, 1), /Invalid pet id\./);
  await assert.rejects(async () => getHandler(harness, "openpets:remove-pet")(event, null), /Invalid pet id\./);
}

{
  const harness = createHarness();
  assert.deepEqual(await getHandler(harness, "openpets:set-pet-pool-order")(event, ["one", "one"]), harness.settings);
  assert.deepEqual(harness.calls.find(({ method }) => method === "setPetPoolOrder")?.args, [[]]);
  await assert.rejects(async () => getHandler(harness, "openpets:set-pet-pool-order")(event, "not-array"), /Invalid pet pool order/);
  await getHandler(harness, "openpets:reset-default-pet-position")(event);
  assert.deepEqual(harness.calls.slice(-2).map(({ method }) => method), ["resetDefaultPetToInitialPosition", "getSettingsStateSnapshot"]);
  harness.setCurrent(false);
  assert.deepEqual(await getHandler(harness, "openpets:reset-default-pet-position")(event), harness.state);
  await getHandler(harness, "openpets:open-gallery")(event);
  assert.deepEqual(harness.calls.at(-1), { method: "openExternal", args: ["https://openpets.dev/gallery"] });
}

console.log("control-center pet management IPC handlers passed.");
