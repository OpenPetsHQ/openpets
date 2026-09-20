import type { BrowserWindow } from "electron";

import type { PetScaleValue } from "./app-state.js";
import type { Point } from "./display.js";
import type { OpenPetsReaction } from "./local-ipc-protocol.js";
import type { ActiveBubble } from "./plugin-bubble-arbiter.js";
import type { UniversalSpriteState } from "./reaction-animation-mapping.js";

export interface PetWindowInteractionHooks {
  readonly onBubbleDismissed?: (dismissToken: string) => void;
  readonly onBubbleAction?: (dismissToken: string, actionId: string) => void;
  readonly onBubbleSubmit?: (dismissToken: string, values: Record<string, string | number>) => void;
  readonly onPetEvent?: (name: string, payload: Record<string, unknown>) => void;
}

export interface DefaultPetWindowOptions extends PetWindowInteractionHooks {
  readonly position: Point;
  readonly paused: boolean;
  readonly display: PetTransientDisplay | null;
  readonly badge: PetStatusBadgeReaction | null;
  readonly pluginBubbles?: PetPluginBubbles | null;
  readonly onPositionChanged: (position: Point) => void;
  readonly onHideRequested: () => void;
  /** Called when an asynchronous layer-shell failure rebuilds this pet as a normal window. */
  readonly onWindowReplaced?: (window: BrowserWindow) => void;
}

export interface AgentPetWindowOptions extends PetWindowInteractionHooks {
  readonly petId: string;
  readonly displayName: string;
  readonly scale: PetScaleValue;
  readonly position: Point;
  readonly display: PetTransientDisplay | null;
  readonly badge: PetStatusBadgeReaction | null;
  readonly onCloseRequested: () => void;
  /** Skip the right-click plugin command section (plugin-spawned pets). */
  readonly plainContextMenu?: boolean;
  /** Optional callback to bring the associated terminal session window to focus. */
  readonly onFocusSessionWindow?: () => void;
  /** Called when an asynchronous layer-shell failure rebuilds this pet as a normal window. */
  readonly onWindowReplaced?: (window: BrowserWindow) => void;
}

/** Plugin-arbiter bubble content for one pet surface (both slots). */
export interface PetPluginBubbles {
  readonly transient: ActiveBubble | null;
  readonly pinned: ActiveBubble | null;
}

export interface PetTransientDisplay {
  readonly reaction?: OpenPetsReaction;
  readonly message?: string;
  readonly reactionMessage?: string;
  readonly suppressReactionMessage?: boolean;
  readonly canSubmitRecording?: boolean;
  readonly dismissToken?: string;
  /** Absolute path to a validated local image shown inside the bubble (pet.showMedia). */
  readonly mediaPath?: string;
  /** Explicit display duration override for media bubbles, already clamped by the IPC layer. */
  readonly displayDurationMs?: number;
  /** Validated URL opened via shell when the media bubble is clicked (pet.showMedia). */
  readonly clickUrl?: string;
}

/** Validated pet.showMedia request payload shared by the default/agent controllers. */
export interface PetShowMediaOptions {
  readonly mediaPath: string;
  readonly message?: string;
  readonly reaction?: OpenPetsReaction;
  readonly durationMs?: number;
  readonly clickUrl?: string;
}

export type PetStatusBadgeReaction = Exclude<OpenPetsReaction, "idle">;

export interface PetContentRender {
  readonly html: string;
  readonly bodyHtml: string;
  readonly displayName: string;
  readonly assetName: string;
  readonly reactionState: UniversalSpriteState;
  readonly codexSpriteVersion: 1 | 2;
  readonly paused: boolean;
  readonly flipped: boolean;
  readonly cacheKey: string;
}

export type PetWindowSpeechCompletion = {
  readonly window: BrowserWindow;
  readonly requestId: string;
  readonly kind: "system";
  readonly outcome: "ended" | "error" | "stopped";
};

export type PetWindowAudioPayload =
  | { readonly kind: "named"; readonly name: string; readonly volume: number }
  | { readonly kind: "data"; readonly dataUrl: string; readonly volume: number };
