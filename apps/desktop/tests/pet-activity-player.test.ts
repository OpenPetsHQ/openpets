import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";

interface ImageProbe {
  src: string;
  naturalWidth: number;
  naturalHeight: number;
  onload: (() => void) | null;
  onerror: (() => void) | null;
}

type Outcome = "started" | "completed" | "cancelled" | "failed";
interface Completion { readonly generation: number; readonly outcome: Outcome }
interface Player {
  play(payload: unknown, onOutcome: (outcome: Outcome) => void): void;
  cancel(generation: number): void;
  dispose(): void;
  refreshStage(): void;
}
const require = createRequire(import.meta.url);
const { createNativePetActivityPlayer } = require(join(process.env.OPENPETS_DESKTOP_ROOT ?? process.cwd(), "src/pet-activity-player.cjs")) as {
  createNativePetActivityPlayer(options: Record<string, unknown>): Player;
};

function fixture() {
  let clock = 0;
  let plugin = false;
  const timers = new Map<number, { at: number; callback: () => void }>();
  let nextTimer = 0;
  const probes: ImageProbe[] = [];
  const completed: Completion[] = [];
  let base = { style: { visibility: "" } };
  const elements: Array<{ style: Record<string, string>; className: string; removed: boolean; remove(): void }> = [];
  const makeShell = () => ({
    attached: [] as typeof elements,
    querySelector: () => base,
    appendChild(element: typeof elements[number]) { this.attached.push(element); },
  });
  let shell = makeShell();
  const document = {
    querySelector(selector: string) {
      if (selector === ".pet-shell") return shell;
      if (selector === ".plugin-sprite-override") return plugin ? {} : null;
      return base;
    },
    createElement() {
      const element = { style: {}, className: "", removed: false, remove() { this.removed = true; } };
      elements.push(element);
      return element;
    },
  };
  const player = createNativePetActivityPlayer({
    document,
    createImage() {
      const probe: ImageProbe = { src: "", naturalWidth: 8 * 192, naturalHeight: 208, onload: null, onerror: null };
      probes.push(probe);
      return probe;
    },
    now: () => clock,
    setTimeout(callback: () => void, delay: number) {
      const id = ++nextTimer;
      timers.set(id, { at: clock + delay, callback });
      return id;
    },
    clearTimeout(id: number) { timers.delete(id); },
  });
  return {
    player, probes, elements, completed, timers,
    get base() { return base; },
    get shell() { return shell; },
    replaceStage() {
      base = { style: { visibility: "" } };
      shell = makeShell();
    },
    setPlugin() { plugin = true; },
    advance(duration: number) {
      const until = clock + duration;
      while (true) {
        const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > until) break;
        timers.delete(next[0]);
        clock = next[1].at;
        next[1].callback();
      }
      clock = until;
    },
  };
}

const payload = (generation: number) => ({ kind: "play", format: "classic", activityId: "nap", generation, frameCount: 8, fps: 4, scale: 1.5, imageUrl: "data:image/webp;base64,YQ==" });
const play = (f: ReturnType<typeof fixture>, generation: number) => {
  f.player.play(payload(generation), (outcome) => f.completed.push({ generation, outcome }));
};

// Started follows attachment of the first frame; the final frame must finish its duration.
{
  const f = fixture();
  play(f, 1);
  assert.deepEqual(f.completed, []);
  f.probes[0]!.onload!();
  assert.equal(f.shell.attached[0], f.elements[0]);
  assert.equal(f.elements[0]!.style.backgroundPosition, "0px 0px");
  assert.deepEqual(f.completed, [{ generation: 1, outcome: "started" }]);
  f.advance(1_750);
  assert.equal(f.elements[0]!.style.backgroundPosition, "-1344px 0px");
  assert.equal(f.completed.length, 1);
  f.advance(250);
  assert.deepEqual(f.completed[1], { generation: 1, outcome: "completed" });
  assert.equal(f.timers.size, 0);
  assert.equal(f.elements[0]!.removed, true);
}

// Late loads cannot attach after cancellation; stale cancellation cannot stop a new strip.
{
  const f = fixture();
  play(f, 1);
  const lateLoad = f.probes[0]!.onload!;
  f.player.cancel(1);
  play(f, 2);
  lateLoad();
  assert.equal(f.elements.length, 0);
  f.probes[1]!.onload!();
  f.player.cancel(1);
  assert.equal(f.elements[0]!.removed, false);
  f.advance(2_000);
  assert.deepEqual(f.completed, [
    { generation: 1, outcome: "cancelled" },
    { generation: 2, outcome: "started" },
    { generation: 2, outcome: "completed" },
  ]);
  assert.equal(f.timers.size, 0);
}

// Invalid artwork and timeouts fail without leaking timers.
{
  const f = fixture();
  play(f, 1);
  f.probes[0]!.naturalHeight = 192;
  f.probes[0]!.onload!();
  play(f, 2);
  f.advance(3_000);
  assert.deepEqual(f.completed, [
    { generation: 1, outcome: "failed" },
    { generation: 2, outcome: "failed" },
  ]);
  assert.equal(f.timers.size, 0);
}

// HUD stage replacement retains the same frame and completion time.
{
  const f = fixture();
  play(f, 1);
  f.probes[0]!.onload!();
  f.advance(750);
  const element = f.elements[0]!;
  const frame = element.style.backgroundPosition;
  f.replaceStage();
  f.player.refreshStage();
  assert.equal(f.shell.attached[0], element);
  assert.equal(element.style.backgroundPosition, frame);
  f.advance(1_250);
  assert.deepEqual(f.completed[1], { generation: 1, outcome: "completed" });
  assert.equal(f.timers.size, 0);
}

// Disposing during image load cannot subsequently report a decode failure.
{
  const f = fixture();
  play(f, 1);
  const lateError = f.probes[0]!.onerror!;
  f.player.dispose();
  lateError();
  assert.deepEqual(f.completed, [{ generation: 1, outcome: "cancelled" }]);
  assert.equal(f.timers.size, 0);
}
console.log("Native activity player playback, interruption and cleanup passed.");
