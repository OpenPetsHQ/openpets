import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createPetTransientPresentation, type PetTransientGenerationCell, type PetTransientPresentationTimers } from "../src/pet-transient-presentation.js";
import type { PetTransientDisplay } from "../src/pet-window.js";

interface ManualTimerEntry {
  readonly callback: () => void;
  readonly delayMs: number;
  cancelled: boolean;
  fired: boolean;
  clearCount: number;
}

class ManualTimers implements PetTransientPresentationTimers {
  private nextId = 1;
  private readonly entries = new Map<number, ManualTimerEntry>();
  private now = 0;

  setTimeout(callback: () => void, delayMs: number): number {
    const id = this.nextId++;
    this.entries.set(id, { callback, delayMs: this.now + delayMs, cancelled: false, fired: false, clearCount: 0 });
    return id;
  }

  clearTimeout(timer: number | ReturnType<typeof setTimeout>): void {
    if (typeof timer !== "number") return;
    const entry = this.entries.get(timer);
    if (entry) {
      entry.cancelled = true;
      entry.clearCount += 1;
    }
  }

  advanceBy(delayMs: number): void {
    const target = this.now + delayMs;
    while (true) {
      const next = [...this.entries.entries()]
        .filter(([, entry]) => !entry.cancelled && !entry.fired && entry.delayMs <= target)
        .sort((left, right) => left[1].delayMs - right[1].delayMs || left[0] - right[0])[0];
      if (!next) break;
      this.now = next[1].delayMs;
      next[1].fired = true;
      next[1].callback();
    }
    this.now = target;
  }

  fire(timer: number): void {
    const entry = this.entries.get(timer);
    if (!entry) throw new Error(`Unknown timer: ${timer}`);
    if (entry.fired) throw new Error(`Timer ${timer} has already fired`);
    entry.fired = true;
    entry.callback();
  }

  timerWithDelay(delayMs: number): number {
    const timer = [...this.entries.entries()].find(([, entry]) => !entry.fired && entry.delayMs === this.now + delayMs)?.[0];
    if (timer === undefined) throw new Error(`Timer with delay ${delayMs} not found`);
    return timer;
  }

  activeCount(): number {
    return [...this.entries.values()].filter((entry) => !entry.cancelled && !entry.fired).length;
  }

  clearCount(timer: number): number {
    return this.entries.get(timer)?.clearCount ?? 0;
  }
}

function createPresentation(timers: ManualTimers, callbacks: { renders: number; idles: number }, generationCell?: PetTransientGenerationCell) {
  return createPetTransientPresentation({
    timers,
    generationCell,
    mergeDisplay: (_current, next) => next,
    getDisplayDurationMs: (nextDisplay) => nextDisplay.displayDurationMs ?? 4_000,
    getReactionAnimationMs: (nextDisplay) => nextDisplay.reaction ? 250 : null,
    clearReaction: (nextDisplay) => ({ ...nextDisplay, reaction: undefined }),
    badgeExpiryMs: { busy: 120_000, normal: 4_000 },
    callbacks: {
      onRenderNeeded: () => { callbacks.renders += 1; },
      onReactionIdle: () => { callbacks.idles += 1; },
    },
  });
}

function display(overrides: PetTransientDisplay = {}): PetTransientDisplay {
  return { message: "hello", ...overrides };
}

describe("pet transient presentation", () => {
  it("commits one opaque token for a display with a reaction and badge", () => {
    const timers = new ManualTimers();
    const callbacks = { renders: 0, idles: 0 };
    const presentation = createPresentation(timers, callbacks, { value: 0n });

    presentation.setDisplay(display({ reaction: "success", displayDurationMs: 1000 }));

    assert.equal(presentation.getDismissToken(), "1");
    assert.equal(presentation.getDisplay()?.dismissToken, "1");
    assert.equal(presentation.getBadge(), "success");
    assert.equal(callbacks.renders, 1);
  });

  it("replays display to badge to badge-expiry ABA without dismissing the survivor", () => {
    const timers = new ManualTimers();
    const presentation = createPresentation(timers, { renders: 0, idles: 0 }, { value: 0n });

    presentation.setDisplay(display({ displayDurationMs: 10_000 }));
    const displayToken = presentation.getDismissToken();
    presentation.setStatusBadge("success");
    const badgeToken = presentation.getDismissToken();
    timers.advanceBy(4_000);
    const expiryToken = presentation.getDismissToken();

    assert.deepEqual([displayToken, badgeToken, expiryToken], ["1", "2", "3"]);
    assert.equal(presentation.getDisplay()?.dismissToken, expiryToken);
    assert.equal(presentation.getBadge(), null);
    assert.equal(presentation.dismiss(displayToken!).matched, false);
    assert.equal(presentation.getDisplay()?.message, "hello");
    assert.equal(presentation.dismiss(expiryToken!).matched, true);
  });

  it("replays badge to display to display-expiry ABA without dismissing the survivor", () => {
    const timers = new ManualTimers();
    const presentation = createPresentation(timers, { renders: 0, idles: 0 }, { value: 0n });

    presentation.setStatusBadge("success");
    const badgeToken = presentation.getDismissToken();
    presentation.setDisplay(display({ displayDurationMs: 1000 }));
    const displayToken = presentation.getDismissToken();
    timers.advanceBy(1_000);
    const expiryToken = presentation.getDismissToken();

    assert.deepEqual([badgeToken, displayToken, expiryToken], ["1", "2", "3"]);
    assert.equal(presentation.getDisplay(), null);
    assert.equal(presentation.getBadge(), "success");
    assert.equal(presentation.dismiss(badgeToken!).matched, false);
    assert.equal(presentation.getBadge(), "success");
    assert.equal(presentation.dismiss(expiryToken!).matched, true);
  });

  it("keeps display and badge expiry timers independent", () => {
    const timers = new ManualTimers();
    const presentation = createPresentation(timers, { renders: 0, idles: 0 }, { value: 0n });

    presentation.setDisplay(display({ displayDurationMs: 1000 }));
    timers.advanceBy(500);
    presentation.setStatusBadge("success");
    timers.advanceBy(500);

    assert.equal(presentation.getDisplay(), null);
    assert.equal(presentation.getBadge(), "success");
    timers.advanceBy(3_000);
    assert.equal(presentation.getBadge(), "success");
    timers.advanceBy(500);
    assert.equal(presentation.getBadge(), null);

    presentation.setStatusBadge("thinking");
    timers.advanceBy(500);
    presentation.setDisplay(display({ message: "new", displayDurationMs: 1000 }));
    timers.advanceBy(500);
    assert.equal(presentation.getDisplay()?.message, "new");
    assert.equal(presentation.getBadge(), "thinking");
    timers.advanceBy(119_000);
    assert.equal(presentation.getBadge(), null);
  });

  it("rejects manually fired stale display, animation, and badge callbacks after successors", () => {
    const timers = new ManualTimers();
    const callbacks = { renders: 0, idles: 0 };
    const presentation = createPresentation(timers, callbacks, { value: 0n });

    presentation.setDisplay(display({ reaction: "success", displayDurationMs: 1000 }));
    const staleAnimation = timers.timerWithDelay(250);
    const staleDisplay = timers.timerWithDelay(1000);
    presentation.setStatusBadge("success");
    const staleBadge = timers.timerWithDelay(4_000);
    presentation.setDisplay(display({ message: "successor", displayDurationMs: 10_000 }));
    const renders = callbacks.renders;
    timers.fire(staleAnimation);
    timers.fire(staleDisplay);
    timers.fire(staleBadge);

    assert.equal(presentation.getDisplay()?.message, "successor");
    assert.equal(presentation.getBadge(), "success");
    assert.equal(callbacks.renders, renders);
    assert.equal(callbacks.idles, 0);
  });

  it("rejects manually fired stale callbacks after reset", () => {
    const timers = new ManualTimers();
    const callbacks = { renders: 0, idles: 0 };
    const presentation = createPresentation(timers, callbacks, { value: 0n });

    presentation.setDisplay(display({ reaction: "success", displayDurationMs: 1000 }));
    const animationTimer = timers.timerWithDelay(250);
    const displayTimer = timers.timerWithDelay(1000);
    presentation.setStatusBadge("thinking");
    const badgeTimer = timers.timerWithDelay(120_000);
    presentation.reset();
    const renders = callbacks.renders;
    timers.fire(animationTimer);
    timers.fire(displayTimer);
    timers.fire(badgeTimer);

    assert.equal(presentation.getDisplay(), null);
    assert.equal(presentation.getBadge(), null);
    assert.equal(presentation.getDismissToken(), undefined);
    assert.equal(callbacks.renders, renders);
    assert.equal(callbacks.idles, 0);
  });

  it("keeps injected allocator tokens unique across recreated presentations", () => {
    const timers = new ManualTimers();
    const cell: PetTransientGenerationCell = { value: 0n };
    const first = createPresentation(timers, { renders: 0, idles: 0 }, cell);
    first.setDisplay(display({ displayDurationMs: 1000 }));
    const historicToken = first.getDismissToken();
    first.reset();

    const second = createPresentation(timers, { renders: 0, idles: 0 }, cell);
    second.setStatusBadge("success");

    assert.notEqual(second.getDismissToken(), historicToken);
    assert.equal(second.dismiss(historicToken!).matched, false);
  });

  it("keeps the default allocator unique across recreated presentations", () => {
    const timers = new ManualTimers();
    const first = createPresentation(timers, { renders: 0, idles: 0 });
    first.setStatusBadge("success");
    const historicToken = first.getDismissToken();
    first.reset();

    const second = createPresentation(timers, { renders: 0, idles: 0 });
    second.setDisplay(display({ displayDurationMs: 1000 }));

    assert.notEqual(second.getDismissToken(), historicToken);
    assert.equal(second.dismiss(historicToken!).matched, false);
  });

  it("preserves exact plain-decimal tokens above MAX_SAFE_INTEGER and rejects old dismissal tokens", () => {
    const timers = new ManualTimers();
    const generationCell: PetTransientGenerationCell = { value: BigInt(Number.MAX_SAFE_INTEGER) };
    const presentation = createPresentation(timers, { renders: 0, idles: 0 }, generationCell);

    presentation.setDisplay(display({ displayDurationMs: 10_000 }));
    const firstToken = presentation.getDismissToken();
    presentation.setStatusBadge("success");
    const secondToken = presentation.getDismissToken();

    assert.deepEqual([firstToken, secondToken], ["9007199254740992", "9007199254740993"]);
    assert.equal(presentation.dismiss(firstToken!).matched, false);
    assert.equal(presentation.getDisplay()?.message, "hello");
  });

  it("updates a surviving display to the latest render token", () => {
    const timers = new ManualTimers();
    const presentation = createPresentation(timers, { renders: 0, idles: 0 }, { value: 0n });

    presentation.setDisplay(display({ displayDurationMs: 10_000 }));
    presentation.setStatusBadge("success");
    const latestToken = presentation.getDismissToken();
    timers.advanceBy(4_000);

    assert.equal(presentation.getDisplay()?.dismissToken, presentation.getDismissToken());
    assert.notEqual(presentation.getDismissToken(), latestToken);
  });

  it("reset cancels every timer exactly once and leaves no active callbacks", () => {
    const timers = new ManualTimers();
    const callbacks = { renders: 0, idles: 0 };
    const presentation = createPresentation(timers, callbacks, { value: 0n });

    presentation.setDisplay(display({ reaction: "success", displayDurationMs: 1000 }));
    presentation.setStatusBadge("thinking");
    const animationTimer = timers.timerWithDelay(250);
    const displayTimer = timers.timerWithDelay(1000);
    const badgeTimer = timers.timerWithDelay(120_000);
    presentation.reset();
    presentation.reset();

    assert.equal(timers.clearCount(animationTimer), 1);
    assert.equal(timers.clearCount(displayTimer), 1);
    assert.equal(timers.clearCount(badgeTimer), 1);
    assert.equal(timers.activeCount(), 0);
    timers.advanceBy(120_000);
    assert.equal(callbacks.renders, 2);
    assert.equal(callbacks.idles, 0);
  });
});
