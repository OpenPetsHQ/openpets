import x11, { type X11Client, type X11Display, type X11Event } from "x11";
import { createConnection, type Socket } from "node:net";

import { error as logError, info } from "./logger.js";
import { allPetWindowStateAtoms, canCompletePetWindowStateApplication, isAtomProperty, mergePetWindowStateAtoms, optionalPetWindowStateAtoms, petWindowStateAtoms, requiredPetWindowStateAtoms } from "./x11-pet-window-state-core.js";
import { createPetWindowX11MapTransition } from "./pet-window-x11-map-core.js";

const x11ReadyTimeoutMs = 1_200;
const propertyReadLength = 1_024;
const clientMessageEventMask = (1 << 19) | (1 << 20);
const petWindowEventMask = x11.eventMask.StructureNotify | x11.eventMask.PropertyChange;

export type PetWindowX11MapLifecycle = {
  readonly ready: Promise<void>;
  readonly finished: Promise<void>;
  cancel(): void;
};

/** Selects MapNotify before showing and keeps the X connection through EWMH application. */
export function beginPetWindowX11MapLifecycle(nativeHandle: Buffer, displayName: string | undefined): PetWindowX11MapLifecycle {
  const windowId = readX11WindowId(nativeHandle);
  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  let resolveFinished!: () => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const finished = new Promise<void>((resolve) => {
    resolveFinished = resolve;
  });

  let socket: Socket | undefined;
  let client: X11Client | undefined;
  let stateAtom = 0;
  let atomType = 0;
  let supportedAtom = 0;
  let rootWindow = 0;
  let skipAtoms: number[] = [];
  let requiredSkipAtoms: number[] = [];
  let stateCheckStarted = false;
  let stateCheckInProgress = false;
  let stateChangedDuringCheck = false;
  let stateApplicationBarrierPassed = false;
  let readySettled = false;
  let settled = false;
  let pendingMapNotify = false;
  const mapTransition = createPetWindowX11MapTransition(windowId);

  const settleReady = (error?: Error): void => {
    if (readySettled) return;
    readySettled = true;
    if (error) rejectReady(error);
    else resolveReady();
  };

  const complete = (error?: Error, cancelled = false): void => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    if (cancelled) mapTransition.cancel();
    if (error) {
      const wasReady = readySettled;
      settleReady(error);
      if (wasReady && !cancelled) {
        // Setup errors are reported by the show gate; post-map errors happen
        // after readiness and need their own diagnostic.
        logError("pet.window", "X11 map lifecycle failed after readiness", { windowId, error: error.message });
      }
    } else {
      settleReady();
    }
    if (!error && client) {
      try {
        client.terminate();
      } catch (terminateError) {
        logError("pet.window", "X11 client cleanup failed", terminateError instanceof Error ? terminateError.message : String(terminateError));
      }
    }
    destroyX11Socket(socket);
    resolveFinished();
  };

  const timeout = setTimeout(() => complete(new Error(`X11 map lifecycle timed out after ${x11ReadyTimeoutMs}ms`)), x11ReadyTimeoutMs);

  const handleClientError = (error: Error): void => complete(error);
  const handleSocketError = (error: Error): void => complete(error);
  const cleanupClientListeners = (): void => {
    if (!client) return;
    client.removeListener("error", handleClientError);
    client.removeListener("event", handleX11Event);
  };

  const verifyCurrentState = async (): Promise<void> => {
    if (!client || settled || !stateCheckStarted) return;
    if (stateCheckInProgress) {
      stateChangedDuringCheck = true;
      return;
    }
    stateCheckInProgress = true;
    try {
      do {
        stateChangedDuringCheck = false;
        const property = await getProperty(client, windowId, stateAtom);
        if (!isAtomProperty(property.type, property.format, atomType) || property.bytesAfter !== 0 || property.data.length % 4 !== 0) {
          throw new Error("Post-map _NET_WM_STATE has an unexpected type or format");
        }
        const currentAtoms: number[] = [];
        for (let offset = 0; offset < property.data.length; offset += 4) {
          currentAtoms.push(property.data.readUInt32LE(offset));
        }
        if (canCompletePetWindowStateApplication(currentAtoms, requiredSkipAtoms, stateApplicationBarrierPassed)) {
          const optionalHintsPresent = currentAtoms.filter((atom) => skipAtoms.slice(petWindowStateAtoms.length).includes(atom)).length;
          info("pet.window", "Linux X11 post-map state atoms verified", {
            windowId,
            verifiedRequiredAtoms: requiredSkipAtoms,
            optionalKdeHintsPresent: optionalHintsPresent,
            note: "Property presence does not confirm compositor UI behavior.",
          });
          complete();
          return;
        }
      } while (stateChangedDuringCheck && !settled);
    } catch (error) {
      complete(error instanceof Error ? error : new Error(String(error)));
    } finally {
      stateCheckInProgress = false;
    }
  };

  const startMapStateApplication = async (): Promise<void> => {
    if (!client || settled) return;
    stateCheckStarted = true;
    await addWindowManagerStates(client, rootWindow, windowId, stateAtom, skipAtoms);
    await syncClient(client);
    stateApplicationBarrierPassed = true;
    await verifyCurrentState();
  };

  function handleX11Event(event: X11Event): void {
    if (settled) return;
    if (mapTransition.acceptMapNotify(event)) {
      if (readySettled) void startMapStateApplication().catch((error: unknown) => {
        complete(error instanceof Error ? error : new Error(String(error)));
      });
      else pendingMapNotify = true;
      return;
    }
    if (event.name === "PropertyNotify" && event.wid === windowId && event.atom === stateAtom && stateCheckStarted) {
      void verifyCurrentState();
    }
  }

  const initialize = async (activeClient: X11Client): Promise<void> => {
    const [state, atom, supported, atoms] = await Promise.all([
      internAtom(activeClient, "_NET_WM_STATE"),
      internAtom(activeClient, "ATOM"),
      internAtom(activeClient, "_NET_SUPPORTED"),
      Promise.all(allPetWindowStateAtoms.map((name) => internAtom(activeClient, name))),
    ]);
    stateAtom = state;
    atomType = atom;
    supportedAtom = supported;
    skipAtoms = atoms;
    activeClient.on("event", handleX11Event);
    activeClient.ChangeWindowAttributes(windowId, { eventMask: petWindowEventMask });
    const attributes = await getWindowAttributes(activeClient, windowId);
    const geometry = await getGeometry(activeClient, windowId);
    rootWindow = geometry.windowid;
    const supportedProperty = await getProperty(activeClient, rootWindow, supportedAtom);
    const supportedAtoms = readAtomList(supportedProperty, atomType);
    requiredSkipAtoms = requiredPetWindowStateAtoms(
      supportedAtoms,
      skipAtoms.slice(0, petWindowStateAtoms.length),
      skipAtoms.slice(petWindowStateAtoms.length),
    );

    if (attributes.mapState !== 0) {
      await startMapStateApplication();
      return;
    }

    const property = await getProperty(activeClient, windowId, stateAtom);
    const existingAtoms = readAtomList(property, atomType);
    activeClient.ChangeProperty(0, windowId, stateAtom, atomType, 32, mergePetWindowStateAtoms(existingAtoms, skipAtoms));
    await syncClient(activeClient);
    if (settled) return;
    settleReady();
    info("pet.window", "Linux X11 MapNotify watcher ready", { windowId, atoms: allPetWindowStateAtoms });
    if (pendingMapNotify) void startMapStateApplication().catch((error: unknown) => {
      complete(error instanceof Error ? error : new Error(String(error)));
    });
  };

  const cleanupAfterSocketClose = (): void => cleanupClientListeners();

  try {
    const displayValue = displayName ?? process.env.DISPLAY ?? ":0";
    socket = createLocalX11Socket(displayValue);
    socket.once("close", cleanupAfterSocketClose);
    socket.on("error", handleSocketError);
    client = x11.createClient({ display: displayValue, stream: socket, auth: undefined, shm: false }, (connectionError, _display: X11Display) => {
      if (settled) {
        destroyX11Socket(socket);
        return;
      }
      if (connectionError) {
        complete(connectionError);
        return;
      }
      if (!client) {
        complete(new Error("X11 client was not initialized"));
        return;
      }
      void initialize(client).catch((error: unknown) => complete(error instanceof Error ? error : new Error(String(error))));
    });
    client.on("error", handleClientError);
  } catch (error) {
    complete(error instanceof Error ? error : new Error(String(error)));
  }

  return {
    ready,
    finished,
    cancel() {
      complete(undefined, true);
    },
  };
}

export function readX11WindowId(nativeHandle: Buffer): number {
  if (nativeHandle.length < 4) throw new Error("Electron returned an invalid X11 native window handle");
  return nativeHandle.readUInt32LE(0);
}

function createLocalX11Socket(displayName: string): Socket {
  const parsed = x11.parseDisplay(displayName);
  const displayNumber = Number(parsed.displayNum);
  if (!Number.isInteger(displayNumber) || displayNumber < 0 || displayNumber > 59535) {
    throw new Error("X11 DISPLAY number is outside the supported port range");
  }
  if (parsed.protocol === "unix" || parsed.protocol === "local" || parsed.host.startsWith("/") || (!parsed.protocol && !parsed.host)) {
    if (parsed.host && !parsed.host.startsWith("/")) throw new Error("X11 shell exclusion only supports local display sockets");
    const socketPath = parsed.host.startsWith("/") ? parsed.host : `/tmp/.X11-unix/X${displayNumber}`;
    return createConnection(socketPath);
  }
  if (!["", "tcp", "inet", "inet6"].includes(parsed.protocol)) {
    throw new Error(`Unsupported X11 display protocol: ${parsed.protocol}`);
  }
  if (!["localhost", "127.0.0.1", "::1"].includes(parsed.host)) {
    throw new Error("X11 shell exclusion refuses non-loopback TCP displays");
  }
  return createConnection({ port: 6000 + displayNumber, host: parsed.host === "localhost" ? "127.0.0.1" : parsed.host });
}

function destroyX11Socket(socket: Socket | undefined): void {
  if (!socket || socket.destroyed) return;
  try {
    socket.destroy();
  } catch (error) {
    logError("pet.window", "X11 socket destruction failed", error instanceof Error ? error.message : String(error));
  }
}

function readAtomList(property: X11PropertyLike, atomType: number): number[] {
  if (property.type === 0) return [];
  if (!isAtomProperty(property.type, property.format, atomType)) {
    throw new Error("_NET_WM_STATE has an unexpected property type or format");
  }
  if (property.bytesAfter !== 0 || property.data.length % 4 !== 0) {
    throw new Error("_NET_WM_STATE is too large or malformed; refusing to replace it");
  }
  const atoms: number[] = [];
  for (let offset = 0; offset < property.data.length; offset += 4) {
    atoms.push(property.data.readUInt32LE(offset));
  }
  return atoms;
}

type X11PropertyLike = { readonly type: number; readonly format: number; readonly bytesAfter: number; readonly data: Buffer };

function internAtom(client: X11Client, name: string): Promise<number> {
  return new Promise((resolve, reject) => {
    client.InternAtom(false, name, (error, atom) => {
      if (error) reject(error);
      else resolve(atom);
      return true;
    });
  });
}

function getWindowAttributes(client: X11Client, window: number): Promise<{ readonly mapState: number }> {
  return new Promise((resolve, reject) => {
    client.GetWindowAttributes(window, (error, attributes) => {
      if (error) reject(error);
      else if (attributes) resolve(attributes);
      else reject(new Error("X11 returned no window attributes"));
      return true;
    });
  });
}

function getGeometry(client: X11Client, window: number): Promise<{ readonly windowid: number }> {
  return new Promise((resolve, reject) => {
    client.GetGeometry(window, (error, geometry) => {
      if (error) reject(error);
      else if (geometry) resolve(geometry);
      else reject(new Error("X11 returned no window geometry"));
      return true;
    });
  });
}

function getProperty(client: X11Client, window: number, property: number): Promise<X11PropertyLike> {
  return new Promise((resolve, reject) => {
    client.GetProperty(false, window, property, 0, 0, propertyReadLength, (error, result) => {
      if (error) reject(error);
      else if (result) resolve(result);
      else reject(new Error("X11 returned no property data"));
      return true;
    });
  });
}

function addWindowManagerStates(client: X11Client, root: number, window: number, stateAtom: number, skipAtoms: readonly number[]): Promise<void> {
  const messages = [skipAtoms.slice(0, 2), skipAtoms.slice(2)];
  const sends = messages.map((atoms) => new Promise<void>((resolve, reject) => {
    client.SendClientMessage(root, window, stateAtom, 32, [1, atoms[0] ?? 0, atoms[1] ?? 0, 1], clientMessageEventMask, (error) => {
      if (error) reject(error);
      else resolve();
      return true;
    });
  }));
  return Promise.all(sends).then(() => undefined);
}

function syncClient(client: X11Client): Promise<void> {
  return new Promise((resolve, reject) => {
    client.GetInputFocus((error) => {
      if (error) reject(error);
      else resolve();
      return true;
    });
  });
}
