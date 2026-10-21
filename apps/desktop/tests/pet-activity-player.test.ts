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

interface Completion { readonly generation: number; readonly failed: boolean }
interface Player {
  play(payload: unknown): void;
  cancel(generation?: number): void;
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
    onComplete(completion: Completion) { completed.push(completion); },
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

const payload = (generation: number) => ({ generation, frameCount: 8, fps: 4, scale: 1.5, imageUrl: "data:image/webp;base64,YQ==" });

// A strip uses rectangular frames and finishes once, restoring the normal pet and releasing every timer.
{
  const f = fixture();
  f.player.play(payload(1));
  f.probes[0]!.onload!();
  assert.equal(f.base.style.visibility, "hidden");
  assert.equal(f.elements[0]!.style.backgroundPosition, "0px 0px");
  f.advance(250);
  assert.equal(f.elements[0]!.style.backgroundPosition, "-192px 0px");
  f.advance(1_750);
  assert.deepEqual(f.completed, [{ generation: 1, failed: false }]);
  assert.equal(f.base.style.visibility, "");
  assert.equal(f.timers.size, 0);
  assert.equal(f.elements[0]!.removed, true);
}

// Canceled image loads and stale completion/cancel messages cannot attach or stop a later strip.
{
  const f = fixture();
  f.player.play(payload(1));
  const lateLoad = f.probes[0]!.onload!;
  f.player.cancel();
  f.player.play(payload(2));
  lateLoad();
  assert.equal(f.elements.length, 0);
  f.probes[1]!.onload!();
  f.player.play({ generation: 1, cancel: true });
  assert.equal(f.base.style.visibility, "hidden");
  f.setPlugin();
  f.player.cancel();
  assert.equal(f.base.style.visibility, "hidden", "native cleanup must not reveal the base underneath a plugin");
  assert.equal(f.timers.size, 0);
  assert.deepEqual(f.completed, []);
}

// Invalid artwork and image timeouts fail closed for this activity, without leaving the base hidden.
{
  const f = fixture();
  f.player.play(payload(1));
  f.probes[0]!.naturalHeight = 192;
  f.probes[0]!.onload!();
  assert.deepEqual(f.completed, [{ generation: 1, failed: true }]);
  f.player.play(payload(2));
  f.advance(3_000);
  assert.deepEqual(f.completed[1], { generation: 2, failed: true });
  assert.equal(f.base.style.visibility, "");
  assert.equal(f.timers.size, 0);
}

// Body-only HUD stage replacement keeps the same frame, element, completion generation and finish time.
{
  const f = fixture();
  f.player.play(payload(1));
  f.probes[0]!.onload!();
  f.advance(750);
  const element = f.elements[0]!;
  const frame = element.style.backgroundPosition;
  f.replaceStage();
  f.player.refreshStage();
  assert.equal(f.shell.attached[0], element);
  assert.equal(f.elements.length, 1);
  assert.equal(element.style.backgroundPosition, frame);
  assert.equal(f.base.style.visibility, "hidden");
  f.advance(1_250);
  assert.deepEqual(f.completed, [{ generation: 1, failed: false }]);
  assert.equal(f.base.style.visibility, "");
  assert.equal(f.timers.size, 0);
}

// A HUD update while the strip image is loading attaches playback to the current, not detached, shell.
{
  const f = fixture();
  f.player.play(payload(1));
  f.replaceStage();
  f.player.refreshStage();
  f.probes[0]!.onload!();
  assert.equal(f.shell.attached[0], f.elements[0]);
  assert.equal(f.base.style.visibility, "hidden");
  f.advance(2_000);
  assert.deepEqual(f.completed, [{ generation: 1, failed: false }]);
}
console.log("Native activity player finite playback, stale-load guards and cleanup passed.");
