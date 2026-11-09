import { randomUUID } from "node:crypto";
import type { MotionContextReaction, MotionEventReaction } from "@open-pets/pet-format/motion";
import type { MotionActivityBodyState, MotionAppearance, MotionBodyDescriptor, PetBodyInput, PetBodyResult, PetBodySnapshot } from "./pet-body-contract.js";

export function createMotionAppearance(current: MotionAppearance | null, assets: MotionBodyDescriptor, outfitId: string, reason: MotionAppearance["reason"], retry: boolean, allocateId: () => string): MotionAppearance {
  if (!retry && current?.assets.snapshotId === assets.snapshotId && current.outfitId === outfitId) return current;
  return { assets, outfitId, reason, presentationId: allocateId() };
}

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

export function isCurrentPetContentCommit(pending: { readonly token: string; readonly sequence: number; readonly presentationId: string | null; readonly outfitId: string | null }, currentSequence: number | undefined, payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  if (!("token" in payload) || !("presentationId" in payload) || !("outfitId" in payload)) return false;
  return pending.sequence === currentSequence && pending.token === payload.token
    && pending.presentationId === payload.presentationId && pending.outfitId === payload.outfitId;
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
export function createPetBodyState(
  publish: (snapshot: PetBodySnapshot) => void,
  appearanceResult: (appearance: MotionAppearance, outcome: "started" | "deferred" | "failed") => void,
  publishActivityBody?: (state: MotionActivityBodyState | null) => void,
) {
  let input: PetBodyInput = { epoch: randomUUID(), revision: 0, context: "idle", paused: false, suspended: false };
  let motion: MotionAppearance | null = null;
  let presented: MotionAppearance | null = null;
  let appearancePending = false;
  let prepared: MotionAppearance | null = null;
  let eventAttempt: { intentId: string; presentationId: string; playbackId: number } | null = null;
  let playbackId = 0;
  const send = () => publish({ input, motion });
  const notifyActivityBody = () => {
    if (!motion && !presented) {
      publishActivityBody?.(null);
      return;
    }
    publishActivityBody?.({ input, committed: presented, appearancePending });
  };
  const update = (patch: Partial<PetBodyInput>) => {
    input = { ...input, ...patch, revision: input.revision + 1 };
    send();
    notifyActivityBody();
  };
  return {
    ready() {
      send();
      notifyActivityBody();
    },
    documentLost() {
      input = { ...input, epoch: randomUUID(), revision: 0, event: undefined };
      presented = null;
      appearancePending = motion !== null;
      eventAttempt = null;
      playbackId = 0;
      notifyActivityBody();
    },
    prepareMotionAppearance(assets: MotionBodyDescriptor, outfitId: string, reason: MotionAppearance["reason"], retry: boolean, manualCommand = false) {
      const promoteScheduled = manualCommand && reason === "manual" && motion?.reason === "scheduled";
      prepared = createMotionAppearance(motion, assets, outfitId, reason, retry || promoteScheduled, randomUUID);
      return prepared;
    },
    publishMotionAppearance(candidate: MotionAppearance) {
      if (candidate !== prepared) return false;
      prepared = null;
      if (motion === candidate) return true;
      motion = candidate;
      appearancePending = candidate !== presented;
      playbackId = 0;
      update({});
      return true;
    },
    clearMotion() {
      prepared = null;
      presented = null;
      appearancePending = false;
      if (!motion) return;
      motion = null;
      playbackId = 0;
      update({});
    },
    setPaused(paused: boolean) {
      if (input.paused !== paused) update({ paused });
    },
    setSuspended(suspended: boolean) {
      if (input.suspended === suspended) return;
      if (suspended) {
        playbackId = 0;
        input = { ...input, epoch: randomUUID(), revision: 0, event: undefined, suspended: true };
        eventAttempt = null;
        send();
        notifyActivityBody();
      } else {
        update({ suspended: false });
      }
    },
    react(reaction: MotionContextReaction | MotionEventReaction | "idle") {
      if (reaction === "idle" || reaction === "thinking" || reaction === "working" || reaction === "editing" || reaction === "running" || reaction === "testing" || reaction === "waiting") {
        update({ context: reaction });
      } else if (!input.suspended) {
        eventAttempt = null;
        update({ event: { id: randomUUID(), reaction } });
      }
    },
    result(value: unknown) {
      if (!value || typeof value !== "object") return;
      const result = value as Partial<PetBodyResult>;
      if (result.epoch !== input.epoch || !Number.isSafeInteger(result.playbackId) || (result.playbackId ?? 0) <= 0) return;
      const matches = (appearance: MotionAppearance | null) => appearance !== null && result.snapshotId === appearance.assets.snapshotId && result.presentationId === appearance.presentationId && result.outfitId === appearance.outfitId;
      const requested = matches(motion);
      const wasPresented = matches(presented);
      if (!requested && !wasPresented) return;
      const id = result.playbackId as number;
      if (result.outcome === "started") {
        if (!requested || !motion) {
          if (wasPresented && presented && result.intentId && result.intentId === input.event?.id) {
            eventAttempt = { intentId: result.intentId, presentationId: presented.presentationId, playbackId: id };
          }
          return;
        }
        if (id < playbackId) return;
        playbackId = id;
        const bodyChanged = presented !== motion || appearancePending;
        presented = motion;
        appearancePending = false;
        if (result.intentId && result.intentId === input.event?.id) {
          eventAttempt = { intentId: result.intentId, presentationId: motion.presentationId, playbackId: id };
        }
        appearanceResult(motion, "started");
        if (bodyChanged) notifyActivityBody();
        return;
      }
      if (result.outcome === "deferred") {
        if (requested && motion) appearanceResult(motion, result.outcome);
        return;
      }
      if (result.outcome !== "completed" && result.outcome !== "cancelled" && result.outcome !== "failed") return;
      if (result.outcome === "failed" && requested && motion && presented !== motion) {
        appearancePending = false;
        appearanceResult(motion, "failed");
        notifyActivityBody();
      }
      if (result.intentId && result.intentId === input.event?.id) {
        if (eventAttempt?.intentId === result.intentId && (eventAttempt.presentationId !== result.presentationId || eventAttempt.playbackId !== id)) return;
        eventAttempt = null;
        update({ event: undefined });
      }
    },
  };
}
