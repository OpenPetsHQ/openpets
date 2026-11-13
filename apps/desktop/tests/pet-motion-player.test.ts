import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import { test } from "node:test";
const require = createRequire(import.meta.url);
const root = process.env.OPENPETS_DESKTOP_ROOT ?? process.cwd();
const { createPetBodyCoordinator: createCoordinator } = require(join(root, "src/pet-body-coordinator.cjs"));
const { createPetMotionPlayer } = require(join(root, "src/pet-motion-player.cjs"));
const { getMotionOutfitBindings } = require(join(root, "../../packages/pet-format/dist/motion.js"));
const createPetBodyCoordinator = (options: Record<string, unknown>) => createCoordinator({ ...options, getBindings: getMotionOutfitBindings });
const { motionMaxClipBytes } = require(join(root, "../../packages/pet-format/dist/motion.js"));
function descriptor(id = "one") {
  const clips = Object.fromEntries(["idle", "run", "intro", "wave", "outro", "work"].map((name) => [name, { file: name, frames: 1, playbackRate: name === "work" ? 2 : 1 }]));
  return { snapshotId: id, metadata: { geometry: { width: 10, height: 10, pixelsPerUnit: 1, footAnchor: { x: 5, y: 9 } }, clips, animations: { idle: { play: "loop", loop: "idle" }, run: { play: "loop", loop: "run" }, work: { play: "loop", loop: "work" }, wave: { play: "once", intro: "intro", clip: "wave", outro: "outro" } }, bindings: { idle: [{ animation: "idle" }], movement: { left: "run", right: "run" }, contexts: { working: [{ animation: "work" }] }, events: { waving: [{ animation: "wave" }] } } }, urls: Object.fromEntries(Object.keys(clips).map((name) => [name, `${id}-${name}`])), verifiedClips: Object.fromEntries(Object.keys(clips).map((name) => [name, { frameDurationsMs: [100], durationMs: 100 }])) };
}
function appearance(assets = descriptor(), outfitId = "default", presentationId = assets.snapshotId, reason = "initial") { return { assets, outfitId, presentationId, reason }; }
function state(revision: number, extra: Record<string, unknown> = {}) { return { input: { epoch: "epoch", revision, context: "idle", paused: false, suspended: false, ...extra }, motion: appearance() }; }

test("large valid clips reach the decoder without exceeding the encoded cache budget", async () => {
  const large = new Uint8Array(33 * 1024 * 1024);
  const overBudget = new Uint8Array(49 * 1024 * 1024);
  const oversized = new Uint8Array(1);
  Object.defineProperty(oversized, "byteLength", { value: motionMaxClipBytes + 1 });
  const loads: string[] = [];
  const decoded: number[] = [];
  let failures = 0;
  const base = { style: {}, appendChild(element: { parentNode: unknown }) { element.parentNode = this; } };
  const player = createPetMotionPlayer({
    document: { documentElement: { dataset: {} }, querySelector: () => base, createElement: () => ({ style: {}, parentNode: null, width: 0, height: 0, remove() {}, getContext: () => ({ clearRect() {}, drawImage() {} }) }) },
    loadBytes: async (url: string) => { loads.push(url); return url.startsWith("large") ? large : url.startsWith("over-idle") ? overBudget : oversized; },
    createDecoder: ({ data }: { data: Uint8Array }) => { decoded.push(data.byteLength); return { tracks: { ready: Promise.resolve(), selectedTrack: { frameCount: 1 } }, decode: async () => ({ image: { displayWidth: 10, displayHeight: 10, close() {} } }), close() {} }; },
    now: () => 0, setTimeout, clearTimeout,
  });
  const callbacks = { still: true, onStarted() {}, onEnd() {}, onFailed() { failures++; } };
  await player.play(appearance(descriptor("large")), "idle", callbacks);
  await player.play(appearance(descriptor("over")), "idle", callbacks);
  await player.play(appearance(descriptor("large")), "idle", callbacks);
  await player.play(appearance(descriptor("over")), "idle", callbacks);
  await player.play(appearance(descriptor("oversized")), "idle", callbacks);
  assert.deepEqual(decoded, [large.byteLength, overBudget.byteLength, large.byteLength, overBudget.byteLength]);
  assert.deepEqual(loads, ["large-idle", "over-idle", "over-idle", "oversized-idle"]);
  assert.equal(failures, 1);
  player.dispose();
});
test("event phases return to current context without HUD resetting playback", () => {
  const calls: string[] = [];
  const results: Array<{ outcome: string; intentId?: string }> = [];
  let callback: { onStarted(): void; onEnd(): void } | undefined;
  const player = { play(_d: unknown, clip: string, next: NonNullable<typeof callback>) { calls.push(clip); callback = next; next.onStarted(); }, stop() {}, clear() {}, setPaused() {}, remaining: () => 200, mount() {}, hitTest: () => null, dispose() {} };
  const coordinator = createPetBodyCoordinator({ player, now: () => 0, random: () => 0, onResult: (result: typeof results[number]) => results.push(result) });
  coordinator.update(state(1));
  coordinator.update(state(2, { event: { id: "e", reaction: "waving" } }));
  coordinator.update(state(3, { context: "working" }));
  coordinator.refresh();
  assert.deepEqual(calls, ["idle", "intro"]);
  callback!.onEnd(); callback!.onEnd(); callback!.onEnd();
  assert.deepEqual(calls, ["idle", "intro", "wave", "outro", "work"]);
  assert.ok(results.some((result) => result.intentId === "e" && result.outcome === "completed"));
  coordinator.dispose();
});
test("drag preempts a live plugin and blocked events do not replay", () => {
  const calls: string[] = [];
  const player = { play(_d: unknown, clip: string, callbacks: { onStarted(): void }) { calls.push(clip); callbacks.onStarted(); }, stop() {}, clear() {}, setPaused() {}, remaining: () => 200, mount() {}, hitTest: () => true, dispose() {} };
  const coordinator = createPetBodyCoordinator({ player, now: () => 0, random: () => 0, onResult() {} });
  coordinator.update(state(1)); coordinator.setPlugin(true);
  coordinator.update(state(2, { event: { id: "blocked", reaction: "waving" } }));
  coordinator.setDragDirection("run-left"); assert.equal(calls.at(-1), "run");
  coordinator.setDragDirection(null); assert.equal(coordinator.hitTest(0, 0), null);
  coordinator.setPlugin(false); assert.equal(calls.at(-1), "idle");
  assert.ok(!calls.includes("wave")); coordinator.dispose();
});
test("replacement retains old canvas until the new frame is presented", async () => {
  const shown: string[] = [];
  const frames: Array<{ closed: boolean }> = [];
  const timers = new Map<number, () => void>();
  let sequence = 0;
  let resolveLoad: (bytes: Uint8Array) => void = () => {};
  const load = new Promise<Uint8Array>((resolve) => { resolveLoad = resolve; });
  const base = { style: {}, appendChild(canvas: { parentNode: unknown; isConnected: boolean }) { canvas.parentNode = base; canvas.isConnected = true; } };
  const player = createPetMotionPlayer({ document: { documentElement: { dataset: {} }, querySelector: () => base, createElement: () => ({ style: {}, parentNode: null, isConnected: true, width: 0, height: 0, remove() { this.isConnected = false; }, getContext: () => ({ clearRect() {}, drawImage(frame: { name: string }) { shown.push(frame.name); } }) }) }, loadBytes: (url: string) => url.startsWith("two") ? load : Promise.resolve(new TextEncoder().encode(url)), createDecoder: ({ data }: { data: Uint8Array }) => ({ tracks: { ready: Promise.resolve(), selectedTrack: { frameCount: 1 } }, decode: async () => { const frame = { name: new TextDecoder().decode(data), displayWidth: 10, displayHeight: 10, closed: false, close() { this.closed = true; } }; frames.push(frame); return { image: frame }; }, close() {} }), now: () => 0, setTimeout: (fn: () => void) => { timers.set(++sequence, fn); return sequence; }, clearTimeout: (id: number) => timers.delete(id), onError: () => assert.fail("unexpected failure") });
  const started: string[] = [];
  const play = (d: ReturnType<typeof descriptor>) => player.play(appearance(d), "idle", { onStarted: () => started.push(d.snapshotId), onEnd() {}, onFailed: () => assert.fail("unexpected failure") });
  await play(descriptor()); [...timers.values()][0]!(); timers.clear();
  const pending = play(descriptor("two")); assert.deepEqual(started, ["one"]); assert.deepEqual(shown, ["one-idle"]);
  resolveLoad(new TextEncoder().encode("two-idle")); await pending; [...timers.values()][0]!(); timers.clear();
  assert.deepEqual(started, ["one", "two"]); assert.deepEqual(shown, ["one-idle", "two-idle"]);
  player.dispose(); assert.ok(frames.every((frame) => frame.closed));
});
test("a context transition waits at most the remaining budget and direct input cuts immediately", () => {
  const calls: string[] = [];
  let end: (() => void) | undefined;
  let remaining = 100;
  const player = { play(_d: unknown, clip: string, callbacks: { onStarted(): void; onEnd(): void }) { calls.push(clip); end = callbacks.onEnd; callbacks.onStarted(); }, stop() {}, clear() {}, setPaused() {}, remaining: () => remaining, mount() {}, hitTest: () => null, dispose() {} };
  const coordinator = createPetBodyCoordinator({ player, now: () => 0, random: () => 0, onResult() {} });
  coordinator.update(state(1)); coordinator.update(state(2, { context: "working" }));
  assert.deepEqual(calls, ["idle"]); end!(); assert.deepEqual(calls, ["idle", "work"]);
  remaining = 100; coordinator.setDragDirection("run-right"); assert.equal(calls.at(-1), "run");
  coordinator.dispose();
});
test("same active event is coalesced and interruption never replays it", () => {
  const calls: string[] = [];
  const results: Array<{ outcome: string; intentId?: string }> = [];
  const player = { play(_d: unknown, clip: string, callbacks: { onStarted(): void }) { calls.push(clip); callbacks.onStarted(); }, stop() {}, clear() {}, setPaused() {}, remaining: () => 500, mount() {}, hitTest: () => null, dispose() {} };
  const coordinator = createPetBodyCoordinator({ player, now: () => 0, random: () => 0, onResult: (result: typeof results[number]) => results.push(result) });
  coordinator.update(state(1, { event: { id: "first", reaction: "waving" } }));
  coordinator.update(state(2, { event: { id: "second", reaction: "waving" } }));
  assert.equal(calls.filter((clip) => clip === "intro").length, 1);
  coordinator.setDragDirection("run-right"); coordinator.setDragDirection(null);
  assert.equal(calls.at(-1), "idle");
  assert.ok(results.some((result) => result.intentId === "first" && result.outcome === "cancelled"));
  coordinator.dispose();
});
test("a retired asynchronous clip cannot report failure or displace the newer playback", async () => {
  let rejectOld: (error: Error) => void = () => {};
  const old = new Promise<Uint8Array>((_resolve, reject) => { rejectOld = reject; });
  const shown: string[] = [];
  const timers = new Map<number, () => void>(); let sequence = 0; let failures = 0;
  const base = { style: {}, appendChild(canvas: { parentNode: unknown }) { canvas.parentNode = base; } };
  const player = createPetMotionPlayer({ document: { documentElement: { dataset: {} }, querySelector: () => base, createElement: () => ({ style: {}, parentNode: null, width: 0, height: 0, remove() {}, getContext: () => ({ clearRect() {}, drawImage(frame: { name: string }) { shown.push(frame.name); } }) }) }, loadBytes: (url: string) => url.startsWith("one") ? old : Promise.resolve(new TextEncoder().encode(url)), createDecoder: ({ data }: { data: Uint8Array }) => ({ tracks: { ready: Promise.resolve(), selectedTrack: { frameCount: 1 } }, decode: async () => ({ image: { name: new TextDecoder().decode(data), displayWidth: 10, displayHeight: 10, close() {} } }), close() {} }), now: () => 0, setTimeout: (fn: () => void) => { timers.set(++sequence, fn); return sequence; }, clearTimeout: (id: number) => timers.delete(id), onError: () => { failures++; } });
  const callbacks = { onStarted() {}, onEnd() {}, onFailed() { failures++; } };
  const first = player.play(appearance(descriptor()), "idle", callbacks);
  await player.play(appearance(descriptor("two")), "idle", callbacks);
  [...timers.values()][0]!(); timers.clear();
  rejectOld(new Error("old failed")); await first;
  assert.deepEqual(shown, ["two-idle"]); assert.equal(failures, 0); player.dispose();
});
test("blocked and coalesced event IDs settle exactly once even when resent", () => {
  const results: Array<{ outcome: string; intentId?: string; playbackId: number }> = [];
  const calls: string[] = [];
  const player = { play(_d: unknown, clip: string, callbacks: { onStarted(): void }) { calls.push(clip); callbacks.onStarted(); }, stop() {}, clear() {}, setPaused() {}, remaining: () => 200, mount() {}, hitTest: () => null, dispose() {} };
  const coordinator = createPetBodyCoordinator({ player, now: () => 0, random: () => 0, onResult: (result: typeof results[number]) => results.push(result) });
  coordinator.update(state(1)); coordinator.setPlugin(true);
  coordinator.update(state(2, { event: { id: "blocked", reaction: "waving" } }));
  coordinator.setPlugin(false);
  coordinator.update(state(3, { event: { id: "blocked", reaction: "waving" } }));
  assert.equal(results.filter((result) => result.intentId === "blocked" && result.outcome === "cancelled").length, 1);
  assert.ok(!calls.includes("intro"));
  coordinator.update(state(4, { event: { id: "active", reaction: "waving" } }));
  coordinator.update(state(5, { event: { id: "coalesced", reaction: "waving" } }));
  coordinator.update(state(6, { event: { id: "coalesced", reaction: "waving" } }));
  assert.equal(results.filter((result) => result.intentId === "coalesced" && result.outcome === "cancelled").length, 1);
  assert.equal(results.filter((result) => result.intentId === "active" && result.outcome === "cancelled").length, 0);
  coordinator.dispose();
});
test("pause retains the frame and resumes using authored clip speed", async () => {
  let clock = 0; let sequence = 0;
  const timers = new Map<number, { at: number; run(): void }>();
  const shown: number[] = [];
  const base = { style: {}, appendChild(canvas: { parentNode: unknown }) { canvas.parentNode = base; } };
  const d = descriptor();
  const player = createPetMotionPlayer({ document: { documentElement: { dataset: {} }, querySelector: () => base, createElement: () => ({ style: {}, parentNode: null, width: 0, height: 0, remove() {}, getContext: () => ({ clearRect() {}, drawImage() { shown.push(clock); } }) }) }, loadBytes: async () => new Uint8Array([1]), createDecoder: () => ({ tracks: { ready: Promise.resolve(), selectedTrack: { frameCount: 1 } }, decode: async () => ({ image: { displayWidth: 10, displayHeight: 10, close() {} } }), close() {} }), now: () => clock, setTimeout: (run: () => void, delay: number) => { timers.set(++sequence, { at: clock + delay, run }); return sequence; }, clearTimeout: (id: number) => timers.delete(id), onError: () => assert.fail() });
  let ended = false;
  await player.play(appearance(d), "work", { onStarted() {}, onEnd() { ended = true; }, onFailed() { assert.fail(); } });
  const initial = [...timers.entries()][0]!; timers.delete(initial[0]); initial[1].run();
  assert.deepEqual(shown, [0]); assert.equal([...timers.values()][0]!.at, 50);
  clock = 20; player.setPaused(true); assert.equal(timers.size, 0);
  clock = 1020; player.setPaused(false); assert.equal([...timers.values()][0]!.at, 1050);
  clock = 1050; const resumed = [...timers.entries()][0]!; timers.delete(resumed[0]); resumed[1].run(); assert.equal(ended, true);
  player.dispose(); assert.equal(timers.size, 0);
});
test("a HUD stage replacement reattaches the presented canvas without restarting playback", async () => {
  let base = { style: {}, appendChild(element: { parentNode: unknown }) { element.parentNode = this; } };
  const originalBase = base;
  const canvas = { style: {}, parentNode: null as unknown, width: 0, height: 0, remove() {}, getContext: () => ({ clearRect() {}, drawImage() {} }) };
  let pending: (() => void) | undefined;
  let started = 0;
  const player = createPetMotionPlayer({ document: { documentElement: { dataset: {} }, querySelector: () => base, createElement: () => canvas }, loadBytes: async () => new Uint8Array([1]), createDecoder: () => ({ tracks: { ready: Promise.resolve(), selectedTrack: { frameCount: 1 } }, decode: async () => ({ image: { displayWidth: 10, displayHeight: 10, close() {} } }), close() {} }), now: () => 0, setTimeout: (callback: () => void) => { pending = callback; return 1; }, clearTimeout() {}, onError: () => assert.fail() });
  await player.play(appearance(), "idle", { onStarted() { started += 1; }, onEnd() {}, onFailed() { assert.fail(); } });
  pending!(); assert.equal(canvas.parentNode, originalBase);
  base = { style: {}, appendChild(element: { parentNode: unknown }) { element.parentNode = this; } };
  player.mount(); assert.equal(canvas.parentNode, base); assert.equal(started, 1); player.dispose();
});
test("physical movement differs from running context, respects plugin priority and compensates flip for drag and roaming", () => {
  const calls: string[] = [];
  const player = { play(_d: unknown, clip: string, callbacks: { onStarted(): void }) { calls.push(clip); callbacks.onStarted(); }, stop() {}, clear() {}, setPaused() {}, remaining: () => 200, mount() {}, hitTest: () => null, dispose() {} };
  const coordinator = createPetBodyCoordinator({ player, now: () => 0, random: () => 0, onResult() {} });
  const d = descriptor();
  Object.assign(d.metadata.animations, { left: { play: "loop", loop: "left" }, right: { play: "loop", loop: "right" } });
  Object.assign(d.metadata.bindings.movement, { left: "left", right: "right" });
  Object.assign(d.metadata.bindings.contexts, { running: [{ animation: "work" }] });
  coordinator.update({ ...state(1, { context: "running" }), motion: appearance(d) });
  assert.equal(calls.at(-1), "work");
  coordinator.setMotionState("run-left"); assert.equal(calls.at(-1), "left");
  const count = calls.length;
  coordinator.setMotionState("run-left"); assert.equal(calls.length, count);
  coordinator.setFlipped(true); assert.equal(calls.at(-1), "right");
  coordinator.setPlugin(true); const blockedCount = calls.length;
  coordinator.setMotionState("run-right"); assert.equal(calls.length, blockedCount);
  coordinator.setDragDirection("run-left"); assert.equal(calls.at(-1), "right");
  coordinator.setFlipped(false); assert.equal(calls.at(-1), "left");
  coordinator.setDragDirection(null); assert.equal(calls.length, blockedCount + 2);
  coordinator.setPlugin(false); assert.equal(calls.at(-1), "right");
  coordinator.setMotionState("idle"); assert.equal(calls.at(-1), "work");
  coordinator.dispose();
});

test("suspension during decode closes the stale frame without presenting it", async () => {
  type Frame = { displayWidth: number; displayHeight: number; closed: boolean; close(): void };
  let resolveFrame: (result: { image: Frame }) => void = () => {};
  const decoding = new Promise<{ image: Frame }>((resolve) => { resolveFrame = resolve; });
  let decoderClosed = false;
  let draws = 0;
  const player = createPetMotionPlayer({ document: { documentElement: { dataset: {} }, querySelector: () => ({}), createElement: () => ({ style: {}, getContext: () => ({ drawImage() { draws += 1; } }) }) }, loadBytes: async () => new Uint8Array([1]), createDecoder: () => ({ tracks: { ready: Promise.resolve(), selectedTrack: { frameCount: 1 } }, decode: () => decoding, close() { decoderClosed = true; } }), now: () => 0, setTimeout, clearTimeout, onError: () => assert.fail() });
  const coordinator = createPetBodyCoordinator({ player, now: () => 0, random: () => 0, onResult() {} });
  coordinator.update(state(1));
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  coordinator.update(state(2, { suspended: true }));
  const frame = { displayWidth: 10, displayHeight: 10, closed: false, close() { this.closed = true; } };
  resolveFrame({ image: frame });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(decoderClosed, true); assert.equal(frame.closed, true); assert.equal(draws, 0);
  coordinator.dispose();
});
test("host movement waits for a finite event and resumes afterward", () => {
  const calls: string[] = [];
  let end: (() => void) | undefined;
  const player = { play(_d: unknown, clip: string, callbacks: { onStarted(): void; onEnd(): void }) { calls.push(clip); end = callbacks.onEnd; callbacks.onStarted(); }, stop() {}, clear() {}, setPaused() {}, remaining: () => 200, mount() {}, hitTest: () => null, dispose() {} };
  const coordinator = createPetBodyCoordinator({ player, now: () => 0, random: () => 0, onResult() {} });
  coordinator.update(state(1, { event: { id: "wave", reaction: "waving" } }));
  coordinator.setMotionState("run-left"); assert.deepEqual(calls, ["intro"]);
  end!(); end!(); end!();
  assert.deepEqual(calls, ["intro", "wave", "outro", "run"]);
  coordinator.dispose();
});
test("context variant remains selected through refreshes and preemption, then changes only with context", () => {
  const calls: string[] = [];
  let selections = 0;
  const player = { play(_d: unknown, clip: string, callbacks: { onStarted(): void }) { calls.push(clip); callbacks.onStarted(); }, stop() {}, clear() {}, setPaused() {}, remaining: () => 200, mount() {}, hitTest: () => null, dispose() {} };
  const coordinator = createPetBodyCoordinator({ player, now: () => 0, random: () => (selections++ % 2 === 0 ? 0 : 0.99), onResult() {} });
  const d = descriptor();
  Object.assign(d.metadata.animations, { a: { play: "loop", loop: "clip-a" }, b: { play: "loop", loop: "clip-b" } });
  Object.assign(d.metadata.bindings.contexts, { working: [{ animation: "a" }, { animation: "b" }] });
  coordinator.update({ ...state(1, { context: "working" }), motion: appearance(d) });
  assert.deepEqual(calls, ["clip-a"]); assert.equal(selections, 1);
  coordinator.refresh(); coordinator.update({ ...state(2, { context: "working" }), motion: appearance(d) }); coordinator.refresh();
  assert.deepEqual(calls, ["clip-a"]); assert.equal(selections, 1);
  coordinator.setMotionState("run-left"); coordinator.setMotionState("idle");
  assert.deepEqual(calls, ["clip-a", "run", "clip-a"]); assert.equal(selections, 1);
  coordinator.update({ ...state(3, { context: "idle" }), motion: appearance(d) });
  coordinator.update({ ...state(4, { context: "working" }), motion: appearance(d) });
  assert.equal(calls.at(-1), "clip-b"); assert.equal(selections, 2);
  coordinator.dispose();
});

test("intentional idle variation remains selected on HUD refresh and after movement", () => {
  const calls: string[] = [];
  let clock = 0;
  let end: (() => void) | undefined;
  const player = { play(_d: unknown, clip: string, callbacks: { onStarted(): void; onEnd(): void }) { calls.push(clip); end = callbacks.onEnd; callbacks.onStarted(); }, stop() {}, clear() {}, setPaused() {}, remaining: () => 200, mount() {}, hitTest: () => null, dispose() {} };
  const coordinator = createPetBodyCoordinator({ player, now: () => clock, random: () => 0, onResult() {} });
  const d = descriptor();
  Object.assign(d.metadata.animations, { alternative: { play: "loop", loop: "alternative" } });
  d.metadata.bindings.idle.push({ animation: "alternative" });
  coordinator.update({ ...state(1), motion: appearance(d) });
  clock = 30000; end!(); assert.deepEqual(calls, ["idle", "idle"]);
  assert.equal(coordinator.offerVariation(), true); end!(); assert.deepEqual(calls, ["idle", "idle", "alternative"]);
  coordinator.refresh(); coordinator.update({ ...state(2), motion: appearance(d) });
  assert.deepEqual(calls, ["idle", "idle", "alternative"]);
  coordinator.setMotionState("run-left"); coordinator.setMotionState("idle");
  assert.deepEqual(calls, ["idle", "idle", "alternative", "run", "alternative"]);
  coordinator.dispose();
});

test("reduced motion presents static body targets without replaying events or HUD updates", () => {
  type Call = { clip: string; still: boolean; callbacks: { onStarted(): void; onEnd(): void } };
  const calls: Call[] = [];
  const results: Array<{ outcome: string; intentId?: string }> = [];
  const player = {
    play(_appearance: unknown, clip: string, callbacks: Call["callbacks"] & { still: boolean }) { calls.push({ clip, still: callbacks.still, callbacks }); callbacks.onStarted(); },
    stop() {}, clear() {}, setPaused() {}, remaining: () => 1000, mount() {}, hitTest: () => null, dispose() {},
  };
  const coordinator = createPetBodyCoordinator({ player, now: () => 0, random: () => 0, onResult: (result: typeof results[number]) => results.push(result) });
  coordinator.update(state(1));
  coordinator.update(state(2, { event: { id: "active-event", reaction: "waving" } }));
  assert.equal(calls.at(-1)!.clip, "intro");
  coordinator.setReducedMotion(true);
  assert.equal(results.filter((result) => result.intentId === "active-event" && result.outcome === "cancelled").length, 1);
  assert.equal(calls.at(-1)!.clip, "idle"); assert.equal(calls.at(-1)!.still, true);
  const count = calls.length;
  coordinator.update(state(3, { event: { id: "suppressed", reaction: "waving" } }));
  coordinator.update(state(4, { event: { id: "suppressed", reaction: "waving" } }));
  assert.equal(results.filter((result) => result.intentId === "suppressed" && result.outcome === "cancelled").length, 1);
  assert.equal(calls.length, count);
  coordinator.update(state(5, { context: "working" })); assert.equal(calls.at(-1)!.clip, "work");
  coordinator.setDragDirection("run-left"); assert.equal(calls.at(-1)!.clip, "run");
  coordinator.setDragDirection(null); assert.equal(calls.at(-1)!.clip, "work");
  coordinator.setReducedMotion(false); assert.equal(calls.at(-1)!.still, false);
  assert.equal(calls.filter((call) => call.clip === "intro").length, 1);
  coordinator.dispose();
});

test("static outfit commits while manually paused and scheduled changes retain their deadline", () => {
  const f = arbitrationFixture();
  f.coordinator.setReducedMotion(true); assert.equal(f.calls.at(-1)!.clip, "idle");
  f.calls.at(-1)!.callbacks.onStarted();
  f.update(2, f.b, { paused: true }); assert.equal(f.calls.at(-1)!.clip, "coatIdle");
  f.calls.at(-1)!.callbacks.onStarted();
  assert.ok(f.results.some((result) => result.presentationId === "b" && result.outcome === "started"));
  const before = f.calls.length; f.coordinator.setReducedMotion(false); assert.equal(f.calls.length, before);
  f.update(3, f.b, { paused: false }); assert.ok(f.calls.length > before);
  f.calls.at(-1)!.callbacks.onStarted();
  f.coordinator.setReducedMotion(true); f.calls.at(-1)!.callbacks.onStarted();
  const scheduled = { ...f.a, presentationId: "scheduled-static", reason: "scheduled" };
  f.update(4, scheduled); f.advance(4999);
  assert.notEqual(f.calls.at(-1)!.appearance.presentationId, "scheduled-static");
  f.advance(1); assert.equal(f.calls.at(-1)!.appearance.presentationId, "scheduled-static");
  f.calls.at(-1)!.callbacks.onStarted(); f.coordinator.dispose();
});

test("reduced motion keeps scheduled appearance deferred during drag and suspension", () => {
  const f = arbitrationFixture();
  f.coordinator.setReducedMotion(true); f.calls.at(-1)!.callbacks.onStarted();
  f.coordinator.setDragDirection("run-left"); f.calls.at(-1)!.callbacks.onStarted();
  const scheduled = { ...f.b, reason: "scheduled" };
  f.update(2, scheduled); f.advance(6000);
  assert.notEqual(f.calls.at(-1)!.appearance.presentationId, "b");
  f.coordinator.setDragDirection(null); f.advance(2500);
  f.update(3, scheduled, { suspended: true });
  const count = f.calls.length; f.advance(6000); assert.equal(f.calls.length, count);
  f.update(4, scheduled); f.advance(2499); assert.notEqual(f.calls.at(-1)!.appearance.presentationId, "b");
  f.advance(1); assert.equal(f.calls.at(-1)!.appearance.presentationId, "b");
  f.coordinator.dispose();
});

test("still mode decodes only frame zero and releases its decoder without timers", async () => {
  const decoded: number[] = []; let closed = 0; let started = 0; let ended = 0;
  const timers = new Map<number, () => void>(); let sequence = 0;
  const base = { style: {}, appendChild(element: { parentNode: unknown }) { element.parentNode = this; } };
  const player = createPetMotionPlayer({
    document: { documentElement: { dataset: {} }, querySelector: () => base, createElement: () => ({ style: {}, parentNode: null, width: 0, height: 0, remove() {}, getContext: () => ({ clearRect() {}, drawImage() {} }) }) },
    loadBytes: async () => new Uint8Array([1]),
    createDecoder: () => ({ tracks: { ready: Promise.resolve(), selectedTrack: { frameCount: 1 } }, decode: async ({ frameIndex }: { frameIndex: number }) => { decoded.push(frameIndex); return { image: { displayWidth: 10, displayHeight: 10, close() {} } }; }, close() { closed++; } }),
    now: () => 0, setTimeout: (callback: () => void) => { timers.set(++sequence, callback); return sequence; }, clearTimeout: (id: number) => timers.delete(id), onError: () => assert.fail(),
  });
  await player.play(appearance(), "idle", { still: true, onStarted() { started++; }, onEnd() { ended++; }, onFailed() { assert.fail(); } });
  assert.deepEqual(decoded, [0]); assert.equal(started, 1); assert.equal(closed, 1);
  assert.equal(ended, 0); assert.equal(timers.size, 0); player.dispose();
});

test("enabling reduced motion retires an in-flight animated decode before its frame can attach", async () => {
  type Frame = { displayWidth: number; displayHeight: number; close(): void };
  let resolveOld: (value: { image: Frame }) => void = () => {};
  const oldDecode = new Promise<{ image: Frame }>((resolve) => { resolveOld = resolve; });
  let decoderCount = 0; let oldFrameClosed = false; let draws = 0;
  const base = { style: {}, appendChild(element: { parentNode: unknown }) { element.parentNode = this; } };
  const player = createPetMotionPlayer({
    document: { documentElement: { dataset: {} }, querySelector: () => base, createElement: () => ({ style: {}, parentNode: null, width: 0, height: 0, remove() {}, getContext: () => ({ clearRect() {}, drawImage() { draws++; } }) }) },
    loadBytes: async () => new Uint8Array([1]),
    createDecoder: () => {
      const index = ++decoderCount;
      return { tracks: { ready: Promise.resolve(), selectedTrack: { frameCount: 1 } }, decode: () => index === 1 ? oldDecode : Promise.resolve({ image: { displayWidth: 10, displayHeight: 10, close() {} } }), close() {} };
    },
    now: () => 0, setTimeout, clearTimeout, onError: () => assert.fail(),
  });
  const coordinator = createPetBodyCoordinator({ player, now: () => 0, random: () => 0, onResult() {} });
  coordinator.update(state(1));
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  coordinator.setReducedMotion(true);
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  resolveOld({ image: { displayWidth: 10, displayHeight: 10, close() { oldFrameClosed = true; } } });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(oldFrameClosed, true); assert.equal(draws, 1);
  coordinator.dispose();
});

function outfitFixture() {
  const d = descriptor();
  Object.assign(d.metadata.animations, { coatIdle: { play: "loop", loop: "coatIdle" }, coatRun: { play: "loop", loop: "coatRun" } });
  Object.assign(d.metadata.clips, { coatIdle: { file: "coatIdle", frames: 1 }, coatRun: { file: "coatRun", frames: 1 } });
  Object.assign(d.verifiedClips, { coatIdle: { frameDurationsMs: [100], durationMs: 100 }, coatRun: { frameDurationsMs: [100], durationMs: 100 } });
  Object.assign(d.urls, { coatIdle: "coatIdle", coatRun: "coatRun" });
  Object.assign(d.metadata, { wardrobe: { outfits: [{ id: "coat", displayName: "Coat", bindings: { idle: [{ animation: "coatIdle" }], movement: { left: "coatRun", right: "coatRun" } } }], schedule: [] } });
  return d;
}
function arbitrationFixture() {
  type Callback = { onStarted(): void; onEnd(): void; onFailed(error: Error): void };
  const calls: Array<{ appearance: ReturnType<typeof appearance>; clip: string; callbacks: Callback }> = [];
  const results: Array<{ outcome: string; presentationId: string; outfitId: string; playbackId: number; intentId?: string }> = [];
  const timers = new Map<number, { at: number; callback(): void }>();
  let clock = 0;
  let seq = 0;
  let paused = false;
  const player = {
    play(a: ReturnType<typeof appearance>, clip: string, callbacks: Callback) { calls.push({ appearance: a, clip, callbacks }); },
    stop() {}, clear() {}, setPaused(value: boolean) { paused = value; }, remaining: () => 1000, mount() {}, hitTest: () => null, dispose() {},
  };
  const coordinator = createPetBodyCoordinator({ player, now: () => clock, random: () => 0, onResult: (result: typeof results[number]) => results.push(result), setTimeout: (callback: () => void, ms: number) => { timers.set(++seq, { at: clock + ms, callback }); return seq; }, clearTimeout: (id: number) => timers.delete(id) });
  const assets = outfitFixture();
  const a = appearance(assets, "default", "a");
  const b = appearance(assets, "coat", "b", "manual");
  function update(revision: number, current: ReturnType<typeof appearance>, extra: Record<string, unknown> = {}) { coordinator.update({ ...state(revision, extra), motion: current }); }
  function advance(ms: number) { clock += ms; for (const [id, timer] of [...timers]) if (timer.at <= clock) { timers.delete(id); timer.callback(); } }
  update(1, a); calls.at(-1)!.callbacks.onStarted();
  return { coordinator, calls, results, timers, assets, a, b, update, advance, isPaused: () => paused };
}

test("manual appearance waits for target first frame and failed presentation is not retried by HUD", () => {
  const f = arbitrationFixture();
  f.update(2, f.b); assert.equal(f.calls.at(-1)?.clip, "coatIdle");
  assert.equal(f.results.some((r) => r.presentationId === "b" && r.outcome === "started"), false);
  f.calls.at(-1)!.callbacks.onFailed(new Error("decode failed"));
  assert.equal(f.results.filter((r) => r.presentationId === "b" && r.outcome === "failed").length, 1);
  const count = f.calls.length; f.update(3, f.b); f.coordinator.refresh(); assert.equal(f.calls.length, count);
  const retry = appearance(f.assets, "coat", "retry", "manual");
  f.update(4, retry); assert.equal(f.calls.at(-1)?.appearance.presentationId, "retry");
  f.calls.at(-1)!.callbacks.onStarted();
  assert.ok(f.results.some((r) => r.presentationId === "retry" && r.outfitId === "coat" && r.outcome === "started"));
  f.coordinator.dispose();
});

test("drag and plugin defer candidate and retain committed outfit; new start has fresh playback ID", () => {
  const f = arbitrationFixture();
  f.coordinator.setDragDirection("run-left"); f.update(2, f.b);
  const deferred = f.results.find((r) => r.presentationId === "b" && r.outcome === "deferred")!;
  assert.ok(deferred.playbackId > 0); assert.equal(f.calls.at(-1)?.appearance.outfitId, "default");
  f.coordinator.setPlugin(true); f.coordinator.setDragDirection(null);
  assert.equal(f.results.filter((r) => r.presentationId === "b" && r.outcome === "deferred").length, 2);
  f.coordinator.setPlugin(false); assert.equal(f.calls.at(-1)?.clip, "coatIdle");
  f.calls.at(-1)!.callbacks.onStarted();
  assert.ok(f.results.find((r) => r.presentationId === "b" && r.outcome === "started")!.playbackId > deferred.playbackId);
  f.coordinator.dispose();
});

test("scheduled deadline counts only eligible time and does not restart on updates", () => {
  const f = arbitrationFixture();
  const b = { ...f.b, reason: "scheduled" };
  f.update(2, b); f.advance(2000); f.coordinator.setPlugin(true);
  f.advance(10000); assert.equal(f.calls.filter((c) => c.appearance.presentationId === "b").length, 0);
  f.coordinator.setPlugin(false); f.update(3, b); f.advance(2999);
  assert.equal(f.calls.filter((c) => c.appearance.presentationId === "b").length, 0);
  f.advance(1); assert.equal(f.calls.at(-1)?.appearance.presentationId, "b");
  f.coordinator.dispose(); assert.equal(f.timers.size, 0);
});

test("scheduled switch finishes event on committed outfit before candidate starts", () => {
  const f = arbitrationFixture();
  f.update(2, f.a, { event: { id: "wave", reaction: "waving" } });
  f.calls.at(-1)!.callbacks.onStarted();
  const b = { ...f.b, reason: "scheduled" };
  f.update(3, b, { context: "working" });
  f.calls.at(-1)!.callbacks.onEnd(); f.calls.at(-1)!.callbacks.onStarted();
  f.calls.at(-1)!.callbacks.onEnd(); f.calls.at(-1)!.callbacks.onStarted();
  f.calls.at(-1)!.callbacks.onEnd();
  const terminal = f.results.findIndex((r) => r.presentationId === "a" && r.intentId === "wave" && r.outcome === "completed");
  assert.ok(terminal >= 0); assert.equal(f.calls.at(-1)?.appearance.presentationId, "b");
  f.calls.at(-1)!.callbacks.onStarted();
  const started = f.results.findIndex((r) => r.presentationId === "b" && r.outcome === "started");
  assert.ok(started > terminal); f.coordinator.dispose();
});

test("paused manual appearance can present static first frame and stale candidate callback is ignored", () => {
  const f = arbitrationFixture();
  f.update(2, f.b, { paused: true }); assert.equal(f.isPaused(), true);
  const stale = f.calls.at(-1)!.callbacks;
  const newer = appearance(f.assets, "coat", "newer", "manual");
  f.update(3, newer, { paused: true }); stale.onStarted();
  assert.ok(!f.results.some((r) => r.presentationId === "b" && r.outcome === "started"));
  f.calls.at(-1)!.callbacks.onStarted();
  assert.ok(f.results.some((r) => r.presentationId === "newer" && r.outcome === "started"));
  f.coordinator.dispose();
});

test("same-snapshot outfit replacement keeps old canvas until a fresh presentation frame", async () => {
  const timers = new Map<number, () => void>(); let seq = 0;
  let resolveNext: (bytes: Uint8Array) => void = () => {};
  const next = new Promise<Uint8Array>((resolve) => { resolveNext = resolve; });
  const shown: string[] = [];
  const base = { style: {}, appendChild(canvas: { parentNode: unknown }) { canvas.parentNode = base; } };
  const player = createPetMotionPlayer({ document: { documentElement: { dataset: {} }, querySelector: () => base, createElement: () => ({ style: {}, parentNode: null, width: 0, height: 0, remove() {}, getContext: () => ({ clearRect() {}, drawImage(frame: { name: string }) { shown.push(frame.name); } }) }) }, loadBytes: (url: string) => url === "coatIdle" ? next : Promise.resolve(new TextEncoder().encode(url)), createDecoder: ({ data }: { data: Uint8Array }) => ({ tracks: { ready: Promise.resolve(), selectedTrack: { frameCount: 1 } }, decode: async () => ({ image: { name: new TextDecoder().decode(data), displayWidth: 10, displayHeight: 10, close() {} } }), close() {} }), now: () => 0, setTimeout: (fn: () => void) => { timers.set(++seq, fn); return seq; }, clearTimeout: (id: number) => timers.delete(id), onError: () => assert.fail() });
  const assets = outfitFixture(), a = appearance(assets, "default", "a"), b = appearance(assets, "coat", "b", "manual");
  const started: string[] = [];
  const cb = (id: string) => ({ onStarted: () => started.push(id), onEnd() {}, onFailed: () => assert.fail() });
  await player.play(a, "idle", cb("a")); [...timers.values()][0]!(); timers.clear();
  const pending = player.play(b, "coatIdle", cb("b"));
  assert.deepEqual(started, ["a"]); assert.equal(shown.length, 1);
  resolveNext(new TextEncoder().encode("coat")); await pending; [...timers.values()][0]!(); timers.clear();
  assert.deepEqual(started, ["a", "b"]); assert.deepEqual(shown, ["one-idle", "coat"]); player.dispose();
});

test("hidden appearance cancels in-flight candidate and cannot commit a stale frame", () => {
  const f = arbitrationFixture();
  f.update(2, f.b); const stale = f.calls.at(-1)!.callbacks;
  f.update(3, f.b, { suspended: true, epoch: "hidden" });
  stale.onStarted();
  assert.ok(!f.results.some((r) => r.presentationId === "b" && r.outcome === "started"));
  assert.ok(f.results.some((r) => r.presentationId === "b" && r.outcome === "deferred"));
  f.coordinator.dispose(); assert.equal(f.timers.size, 0);
});
test("context arriving during candidate decoding is applied after its first frame", () => {
  const f = arbitrationFixture();
  Object.assign(f.assets.metadata.animations, { coatWork: { play: "loop", loop: "coatWork" } });
  Object.assign(f.assets.metadata.clips, { coatWork: { file: "coatWork", frames: 1 } });
  Object.assign(f.assets.verifiedClips, { coatWork: { frameDurationsMs: [100], durationMs: 100 } });
  Object.assign(f.assets.urls, { coatWork: "coatWork" });
  const coatBindings = getMotionOutfitBindings(f.assets.metadata, "coat");
  coatBindings.contexts = { working: [{ animation: "coatWork" }] };
  f.update(2, f.b); const pending = f.calls.at(-1)!;
  f.update(3, f.b, { context: "working" }); pending.callbacks.onStarted();
  assert.equal(f.calls.at(-1)?.clip, "coatWork");
  f.coordinator.dispose();
});
