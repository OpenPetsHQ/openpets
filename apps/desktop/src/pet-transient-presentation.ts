import type { OpenPetsReaction } from "./local-ipc-protocol.js";
import type { PetStatusBadgeReaction, PetTransientDisplay } from "./pet-window.js";

type TimerHandle = ReturnType<typeof setTimeout> | number;

export interface PetTransientPresentationTimers {
  readonly setTimeout: (callback: () => void, delayMs: number) => TimerHandle;
  readonly clearTimeout: (timer: TimerHandle) => void;
}

export interface PetTransientGenerationCell {
  value: bigint;
}

export interface PetTransientPresentationPolicy {
  readonly mergeDisplay: (current: PetTransientDisplay | null, next: PetTransientDisplay) => PetTransientDisplay;
  readonly getDisplayDurationMs: (display: PetTransientDisplay) => number;
  readonly getReactionAnimationMs: (display: PetTransientDisplay) => number | null;
  readonly clearReaction: (display: PetTransientDisplay) => PetTransientDisplay;
}

export interface PetTransientPresentationCallbacks {
  readonly onRenderNeeded: () => void;
  readonly onReactionIdle: () => void;
}

export interface PetTransientDismissResult {
  readonly matched: boolean;
  readonly display: PetTransientDisplay | null;
}

const defaultGenerationCell: PetTransientGenerationCell = { value: 0n };

const realTimers: PetTransientPresentationTimers = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (timer) => clearTimeout(timer),
};

export interface PetTransientPresentationOptions extends PetTransientPresentationPolicy {
  readonly callbacks: PetTransientPresentationCallbacks;
  readonly badgeExpiryMs: { readonly busy: number; readonly normal: number };
  readonly timers?: PetTransientPresentationTimers;
  readonly generationCell?: PetTransientGenerationCell;
}

/** Owns the short-lived display and badge state for one pet surface. */
export interface PetTransientPresentation {
  readonly getDisplay: () => PetTransientDisplay | null;
  readonly getBadge: () => PetStatusBadgeReaction | null;
  readonly getDismissToken: () => string | undefined;
  readonly setDisplay: (display: PetTransientDisplay) => void;
  readonly setStatusBadge: (reaction: OpenPetsReaction) => void;
  readonly clearStatusBadge: () => void;
  readonly dismiss: (dismissToken: string) => PetTransientDismissResult;
  readonly reset: () => void;
}

export function createPetTransientPresentation(options: PetTransientPresentationOptions): PetTransientPresentation {
  const timers = options.timers ?? realTimers;
  const generationCell = options.generationCell ?? defaultGenerationCell;
  const { callbacks } = options;
  let display: PetTransientDisplay | null = null;
  let badge: PetStatusBadgeReaction | null = null;
  let renderToken: string | undefined;
  let displayRevision = 0;
  let badgeRevision = 0;
  let displayTimer: TimerHandle | null = null;
  let animationTimer: TimerHandle | null = null;
  let badgeTimer: TimerHandle | null = null;

  function getDisplay(): PetTransientDisplay | null {
    return display;
  }

  function getBadge(): PetStatusBadgeReaction | null {
    return badge;
  }

  function getDismissToken(): string | undefined {
    return renderToken;
  }

  function setDisplay(nextDisplay: PetTransientDisplay): void {
    const currentDisplayRevision = ++displayRevision;
    const preparedDisplay = options.mergeDisplay(display, nextDisplay);
    display = preparedDisplay;
    if (nextDisplay.reaction === "idle") clearStatusBadgeWithoutRefresh();
    else if (nextDisplay.reaction) setStatusBadgeWithoutRefresh(nextDisplay.reaction);

    clearDisplayTimer();
    clearAnimationTimer();

    const animationMs = options.getReactionAnimationMs(preparedDisplay);
    const displayDurationMs = options.getDisplayDurationMs(preparedDisplay);
    if (animationMs !== null && animationMs < displayDurationMs) {
      animationTimer = timers.setTimeout(() => {
        if (displayRevision !== currentDisplayRevision || !display) return;
        display = options.clearReaction(display);
        animationTimer = null;
        callbacks.onReactionIdle();
      }, animationMs);
    }

    displayTimer = timers.setTimeout(() => {
      if (displayRevision !== currentDisplayRevision) return;
      display = null;
      displayTimer = null;
      clearAnimationTimer();
      commitRenderTransition();
    }, displayDurationMs);

    commitRenderTransition();
  }

  function setStatusBadge(reaction: OpenPetsReaction): void {
    if (reaction === "idle") {
      clearStatusBadge();
      return;
    }
    setStatusBadgeWithoutRefresh(reaction);
    commitRenderTransition();
  }

  function setStatusBadgeWithoutRefresh(reaction: PetStatusBadgeReaction): void {
    const currentBadgeRevision = ++badgeRevision;
    clearBadgeTimer();
    badge = reaction;
    const expiryMs = isBusyStatusBadgeReaction(reaction) ? options.badgeExpiryMs.busy : options.badgeExpiryMs.normal;
    badgeTimer = timers.setTimeout(() => {
      if (badgeRevision !== currentBadgeRevision) return;
      badge = null;
      badgeTimer = null;
      commitRenderTransition();
    }, expiryMs);
  }

  function clearStatusBadge(): void {
    if (badge === null) {
      clearBadgeTimer();
      ++badgeRevision;
      return;
    }
    clearStatusBadgeWithoutRefresh();
    commitRenderTransition();
  }

  function clearStatusBadgeWithoutRefresh(): void {
    ++badgeRevision;
    badge = null;
    clearBadgeTimer();
  }

  function dismiss(dismissToken: string): PetTransientDismissResult {
    if (dismissToken !== getDismissToken()) return { matched: false, display: null };
    const dismissedDisplay = display;
    reset();
    return { matched: true, display: dismissedDisplay };
  }

  function reset(): void {
    ++displayRevision;
    ++badgeRevision;
    allocateToken();
    clearDisplayTimer();
    clearAnimationTimer();
    clearBadgeTimer();
    display = null;
    badge = null;
    renderToken = undefined;
  }

  function allocateToken(): bigint {
    generationCell.value += 1n;
    return generationCell.value;
  }

  function commitRenderTransition(): void {
    renderToken = String(allocateToken());
    if (display) display = { ...display, dismissToken: renderToken };
    callbacks.onRenderNeeded();
  }

  function clearDisplayTimer(): void {
    if (displayTimer !== null) timers.clearTimeout(displayTimer);
    displayTimer = null;
  }

  function clearAnimationTimer(): void {
    if (animationTimer !== null) timers.clearTimeout(animationTimer);
    animationTimer = null;
  }

  function clearBadgeTimer(): void {
    if (badgeTimer !== null) timers.clearTimeout(badgeTimer);
    badgeTimer = null;
  }

  return { getDisplay, getBadge, getDismissToken, setDisplay, setStatusBadge, clearStatusBadge, dismiss, reset };
}

function isBusyStatusBadgeReaction(reaction: OpenPetsReaction): boolean {
  return reaction === "thinking" || reaction === "working" || reaction === "editing" || reaction === "running" || reaction === "testing" || reaction === "waiting";
}
