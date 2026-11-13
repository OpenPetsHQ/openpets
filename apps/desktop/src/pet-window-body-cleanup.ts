import type { EventEmitter } from "node:events";
import type { IpcMainEvent } from "electron";
import { petBodyChannels } from "./pet-body-contract.js";

export const petContentCommittedChannel = "openpets:pet-content-committed";

/** Owns removal of the per-window body bridge after the native window closes. */
export function registerPetBodyWindowCleanup(options: {
  readonly window: EventEmitter;
  readonly contents: EventEmitter;
  readonly ipc: EventEmitter;
  readonly ready: (event: IpcMainEvent) => void;
  readonly result: (event: IpcMainEvent, payload: unknown) => void;
  readonly preference: (event: IpcMainEvent, payload: unknown) => void;
  readonly contentCommitted: (event: IpcMainEvent, payload: unknown) => void;
  readonly navigation: () => void;
  readonly show: () => void;
  readonly hide: () => void;
  readonly forgetState: () => void;
  readonly releaseSnapshots: () => void;
}): void {
  const { window, contents, ipc } = options;
  window.once("closed", () => {
    try {
      ipc.off(petBodyChannels.ready, options.ready);
      ipc.off(petBodyChannels.result, options.result);
      ipc.off(petBodyChannels.preference, options.preference);
      ipc.off(petContentCommittedChannel, options.contentCommitted);
      contents.off("did-start-loading", options.navigation);
      contents.off("render-process-gone", options.navigation);
      window.off("show", options.show);
      window.off("hide", options.hide);
    } finally {
      try {
        options.forgetState();
      } finally {
        options.releaseSnapshots();
      }
    }
  });
}
