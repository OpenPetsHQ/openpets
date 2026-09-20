import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  PetDisplayCoordinator,
  type DisplayChangeReason,
  type PetDisplayEventSource,
  type PetDisplayCoordinatorTimers,
  type PetPowerEventSource,
} from "../src/pet-display-coordinator.js";

type FakeDisplay = { readonly id: string };
type DisplayListener = (event: unknown, display: FakeDisplay) => void;

class FakeDisplaySource implements PetDisplayEventSource<FakeDisplay> {
  private readonly listeners = new Map<DisplayChangeReason, Set<DisplayListener>>();
  readonly removed: DisplayChangeReason[] = [];

  on(event: DisplayChangeReason, listener: DisplayListener): void {
    let listeners = this.listeners.get(event);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(event, listeners);
    }
    listeners.add(listener);
  }

  removeListener(event: DisplayChangeReason, listener: DisplayListener): void {
    this.listeners.get(event)?.delete(listener);
    this.removed.push(event);
  }

  emit(event: DisplayChangeReason, display: FakeDisplay): void {
    for (const listener of this.listeners.get(event) ?? []) listener({}, display);
  }

  listenerCount(event: DisplayChangeReason): number {
    return this.listeners.get(event)?.size ?? 0;
  }
}

class FakePowerSource implements PetPowerEventSource {
  private readonly listeners = new Set<() => void>();
  removeCount = 0;

  on(_event: "resume", listener: () => void): void {
    this.listeners.add(listener);
  }

  removeListener(_event: "resume", listener: () => void): void {
    this.listeners.delete(listener);
    this.removeCount += 1;
  }

  emitResume(): void {
    for (const listener of this.listeners) listener();
  }

  listenerCount(): number {
    return this.listeners.size;
  }
}

type TimerEntry = {
  readonly callback: () => void;
  readonly dueAt: number;
  cancelled: boolean;
  fired: boolean;
};

class ManualTimers implements PetDisplayCoordinatorTimers {
  private nextId = 1;
  private now = 0;
  private readonly entries = new Map<number, TimerEntry>();

  setTimeout(callback: () => void, delayMs: number): number {
    const id = this.nextId++;
    this.entries.set(id, { callback, dueAt: this.now + delayMs, cancelled: false, fired: false });
    return id;
  }

  clearTimeout(timer: number | ReturnType<typeof setTimeout>): void {
    if (typeof timer !== "number") return;
    const entry = this.entries.get(timer);
    if (entry) entry.cancelled = true;
  }

  advanceBy(delayMs: number): void {
    const target = this.now + delayMs;
    while (true) {
      const next = [...this.entries.entries()]
        .filter(([, entry]) => !entry.cancelled && !entry.fired && entry.dueAt <= target)
        .sort((left, right) => left[1].dueAt - right[1].dueAt || left[0] - right[0])[0];
      if (!next) break;
      this.now = next[1].dueAt;
      next[1].fired = true;
      next[1].callback();
    }
    this.now = target;
  }

  activeCount(): number {
    return [...this.entries.values()].filter((entry) => !entry.cancelled && !entry.fired).length;
  }
}

function createCoordinator() {
  const displaySource = new FakeDisplaySource();
  const powerSource = new FakePowerSource();
  const timers = new ManualTimers();
  const invalidated: string[] = [];
  const calls: string[] = [];
  const coordinator = new PetDisplayCoordinator({
    displaySource,
    powerSource,
    timers,
    invalidateDisplayCache: () => invalidated.push("invalidate"),
    reclampDefaultPetWindow: (reason, display) => calls.push(`default:${reason}:${display?.id ?? "none"}`),
    reclampAgentPetWindows: (reason) => calls.push(`agent:${reason}`),
    reclampLanVisitingPetWindows: () => calls.push("lan"),
    reclampPluginPetWindows: (reason) => calls.push(`plugin:${reason}`),
    recoverDefaultPetMouseInterop: (reason) => calls.push(`resume:${reason}`),
  });
  return { coordinator, displaySource, powerSource, timers, invalidated, calls };
}

describe("pet display coordinator", () => {
  it("coalesces each display reason independently and forwards the latest display", () => {
    const { coordinator, displaySource, timers, invalidated, calls } = createCoordinator();
    coordinator.start();

    displaySource.emit("display-added", { id: "added-1" });
    displaySource.emit("display-added", { id: "added-2" });
    displaySource.emit("display-removed", { id: "removed-1" });

    assert.deepEqual(invalidated, ["invalidate", "invalidate", "invalidate"], "every raw event invalidates immediately");
    assert.deepEqual(calls, [], "display work is deferred by the debounce lanes");

    timers.advanceBy(200);

    assert.deepEqual(calls, [
      "default:display-added:added-2",
      "agent:display-added",
      "lan",
      "plugin:display-added",
      "default:display-removed:removed-1",
      "agent:display-removed",
      "lan",
      "plugin:display-removed",
    ], "each lane fans out synchronously in controller order");
  });

  it("registers and removes exact listeners idempotently", () => {
    const { coordinator, displaySource, powerSource, timers } = createCoordinator();
    coordinator.start();
    coordinator.start();
    assert.equal(displaySource.listenerCount("display-added"), 1);
    assert.equal(displaySource.listenerCount("display-removed"), 1);
    assert.equal(displaySource.listenerCount("display-metrics-changed"), 1);
    assert.equal(powerSource.listenerCount(), 1);

    displaySource.emit("display-added", { id: "pending" });
    powerSource.emitResume();
    assert.equal(timers.activeCount(), 2, "one display timer and one delayed resume timer are pending");

    coordinator.stop();
    coordinator.stop();
    assert.equal(displaySource.listenerCount("display-added"), 0);
    assert.equal(displaySource.listenerCount("display-removed"), 0);
    assert.equal(displaySource.listenerCount("display-metrics-changed"), 0);
    assert.equal(powerSource.listenerCount(), 0);
    assert.equal(displaySource.removed.length, 3, "stop removes each display listener once");
    assert.equal(powerSource.removeCount, 1, "stop removes the power listener once");
    assert.equal(timers.activeCount(), 0, "stop cancels all pending timers");
  });

  it("recovers mouse interop for every resume and cancels delayed work on stop", () => {
    const { coordinator, powerSource, timers, calls } = createCoordinator();
    coordinator.start();

    powerSource.emitResume();
    powerSource.emitResume();
    assert.deepEqual(calls, ["resume:power-resume", "resume:power-resume"]);
    assert.equal(timers.activeCount(), 2, "each resume keeps its own delayed recovery");
    timers.advanceBy(499);
    assert.deepEqual(calls, ["resume:power-resume", "resume:power-resume"]);
    timers.advanceBy(1);
    assert.deepEqual(calls, [
      "resume:power-resume",
      "resume:power-resume",
      "resume:power-resume+500ms",
      "resume:power-resume+500ms",
    ]);

    powerSource.emitResume();
    coordinator.stop();
    timers.advanceBy(500);
    assert.deepEqual(calls, [
      "resume:power-resume",
      "resume:power-resume",
      "resume:power-resume+500ms",
      "resume:power-resume+500ms",
      "resume:power-resume",
    ], "stop cancels the delayed recovery without suppressing the immediate recovery");
  });
});
