import { randomUUID } from "node:crypto";
import type { MotionContextReaction, MotionEventReaction } from "@open-pets/pet-format/motion";
import type { MotionBodyDescriptor, PetBodyInput, PetBodyResult, PetBodySnapshot } from "./pet-body-contract.js";

export function petBodyContext(reaction: MotionContextReaction | MotionEventReaction | "idle" | null): MotionContextReaction | "idle" | null {
  switch (reaction) {
    case "idle": case "thinking": case "working": case "editing": case "running": case "testing": case "waiting":
      return reaction;
    default:
      return null;
  }
}

export function effectivePetBodyContext(underlying: MotionContextReaction | "idle", voice: MotionContextReaction | MotionEventReaction | "idle" | null): MotionContextReaction | "idle" {
  return petBodyContext(voice) ?? underlying;
}

/** A live pet document can accept new content regardless of its previous artwork. */
export function updateLoadedPetDocument(ready: boolean, currentSequence: number | undefined, sequence: number, url: string, update: () => void): boolean {
  if (!ready || currentSequence !== sequence || !(url.startsWith("data:text/html") || url.startsWith("file://"))) return false;
  update();
  return true;
}

export function isCurrentPetContentCommit(token: string, sequence: number, currentSequence: number | undefined, receivedToken: unknown): boolean {
  return sequence === currentSequence && token === receivedToken;
}

/** Visibility is host-owned: an offscreen layer-shell document can be visible. */
export function createPetBodyVisibility(systemSuspended: boolean, publish: (suspended: boolean, details: { logicalVisible: boolean; systemSuspended: boolean; source: string }) => void) {
  let visible = false;
  const reconcile = (source: string) => {
    const suspended = !visible || systemSuspended;
    publish(suspended, { logicalVisible: visible, systemSuspended, source });
  };
  reconcile("initial");
  const setVisible = (next: boolean, source: string) => {
    if (visible === next) return;
    visible = next;
    reconcile(source);
  };
  return {
    setVisible(next: boolean, source = "host") { setVisible(next, source); },
    show(show: () => void) { show(); setVisible(true, "host-show"); },
    hide(hide: () => void) { hide(); setVisible(false, "host-hide"); },
    syncNative(read: () => { visible: boolean; minimized: boolean }, source: string) {
      const native = read();
      setVisible(native.visible && !native.minimized, source);
    },
    setSystemSuspended(next: boolean) {
      if (systemSuspended === next) return;
      systemSuspended = next;
      reconcile(next ? "system-suspend" : "system-resume");
    },
  };
}

/** Release plugin artwork ownership before delivering the replacement intent. */
export function replacePluginSpriteWithReaction(clearSprite: () => void, react: () => void): void {
  clearSprite();
  react();
}

/** Window-local semantic intent, independent of transient presentation timers. */
export function createPetBodyState(publish: (snapshot: PetBodySnapshot) => void, committed: (snapshotId: string) => void) {
  let input: PetBodyInput = { epoch: randomUUID(), revision: 0, context: "idle", paused: false, suspended: false };
  let motion: MotionBodyDescriptor | null = null;
  let playbackId = 0;
  const send = () => publish({ input, motion });
  const update = (patch: Partial<PetBodyInput>) => {
    input = { ...input, ...patch, revision: input.revision + 1 };
    send();
  };
  return {
    ready: send,
    documentLost() {
      input = { ...input, epoch: randomUUID(), revision: 0, event: undefined };
      playbackId = 0;
    },
    setMotion(next: MotionBodyDescriptor | null) {
      if (motion?.snapshotId === next?.snapshotId) return;
      const event = motion ? undefined : input.event;
      motion = next;
      playbackId = 0;
      update({ event });
    },
    setPaused(paused: boolean) {
      if (input.paused !== paused) update({ paused });
    },
    setSuspended(suspended: boolean) {
      if (input.suspended === suspended) return;
      if (suspended) {
        playbackId = 0;
        input = { ...input, epoch: randomUUID(), revision: 0, event: undefined, suspended: true };
        send();
      } else {
        update({ suspended: false });
      }
    },
    react(reaction: MotionContextReaction | MotionEventReaction | "idle") {
      if (reaction === "idle" || reaction === "thinking" || reaction === "working" || reaction === "editing" || reaction === "running" || reaction === "testing" || reaction === "waiting") {
        update({ context: reaction });
      } else if (!input.suspended) {
        update({ event: { id: randomUUID(), reaction } });
      }
    },
    result(value: unknown) {
      if (!value || typeof value !== "object") return;
      const result = value as Partial<PetBodyResult>;
      if (!motion || result.epoch !== input.epoch || result.snapshotId !== motion.snapshotId || !Number.isSafeInteger(result.playbackId) || (result.playbackId ?? 0) <= 0) return;
      const id = result.playbackId as number;
      if (result.outcome === "started") {
        if (id < playbackId) return;
        playbackId = id;
        committed(motion.snapshotId);
        return;
      }
      if (result.outcome !== "completed" && result.outcome !== "cancelled" && result.outcome !== "failed") return;
      if (result.intentId && result.intentId === input.event?.id) {
        update({ event: undefined });
      }
    },
  };
}
