import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import { test } from "node:test";
const require = createRequire(import.meta.url);
const root = process.env.OPENPETS_DESKTOP_ROOT ?? process.cwd();
const { createPetContentStageController } = require(join(root, "src/pet-content-stage.cjs"));
type Stage = { motion?: boolean; name?: string; replaceWith(next: Stage): void };
function fixture(initialMotion = false) {
  const commits: string[] = [];
  const errors: unknown[] = [];
  const images: Array<{ onload: (() => void) | null; onerror: (() => void) | null; src: string; decode(): Promise<void> }> = [];
  const sprite = { matches: () => true };
  const hostStyle = { textContent: "old-style", setAttribute() {} };
  let applied = 0;
  let motion = initialMotion;
  let currentStage: Stage = { name: "old", replaceWith(next: Stage) { motion = next.motion ?? false; currentStage = next; } };
  const document = {
    documentElement: { dataset: { flipX: "false", paused: "false" } as Record<string, string>, lang: "en" },
    head: { querySelector: () => hostStyle },
    querySelector(selector: string) {
      if (selector === ".stage") return currentStage;
      if (selector === ".pet-shell .sprite[data-motion-body]") return motion ? {} : null;
      return null;
    },
    importNode(candidate: { motion: boolean; name: string }) {
      const next = { ...candidate, replaceWith: currentStage.replaceWith, querySelector(selector: string) {
        if (selector === ".pet-shell .sprite[data-motion-body]") return next.motion ? sprite : null;
        if (selector === ".pet-shell .installed-sprite, .pet-shell .sprite") return next.motion ? null : sprite;
        return null;
      } };
      return next;
    },
  };
  const controller = createPetContentStageController(document, {
    parseDocument(html: string) { return { documentElement: { lang: "en", dataset: { paused: "true", flipX: "true" } }, head: { querySelectorAll: () => [{ textContent: `css-${html}` }] }, querySelector: () => ({ motion: html.startsWith("motion"), name: html }) }; },
    createStyleSheet() { return { replaceSync() {}, cssRules: [{ selectorText: ".sprite", style: { backgroundImage: 'url("file:///pet.webp")' } }] }; },
    createImage() { const image = { onload: null, onerror: null, src: "", decode: () => Promise.resolve() }; images.push(image); return image; },
    onCommit: (token: string) => commits.push(token), onError: (error: unknown) => errors.push(error),
  });
  if (initialMotion) controller.motionPresented("old-snapshot");
  function replace(html: string, token: string, id: string | null = null) { controller.replaceStage({ documentHtml: html, contentCommitToken: token, motionSnapshotId: id }, () => { applied += 1; }); }
  return { controller, replace, commits, errors, images, getApplied: () => applied, getMotion: () => motion, getStage: () => currentStage.name, hostStyle, document };
}

test("visible Motion HUD commits immediately without waiting for another frame", () => {
  const f = fixture(true); f.replace("motion-hud", "hud", "old-snapshot");
  assert.equal(f.getApplied(), 1); assert.equal(f.getStage(), "motion-hud");
  assert.equal(f.hostStyle.textContent, "css-motion-hud"); assert.equal(f.document.documentElement.dataset.flipX, "true");
  assert.deepEqual(f.commits, ["hud"]);
});

test("replacement retains old stage, dimensions and attributes until matching frame", () => {
  const f = fixture(true); f.replace("motion-new-geometry", "new", "new-snapshot");
  assert.equal(f.getStage(), "old"); assert.equal(f.hostStyle.textContent, "old-style");
  assert.equal(f.document.documentElement.dataset.flipX, "false"); assert.deepEqual(f.commits, []);
  assert.equal(f.controller.prepareMotionPresentation("old-snapshot"), true);
  f.controller.motionPresented("old-snapshot"); assert.equal(f.getStage(), "old"); assert.deepEqual(f.commits, []);
  assert.equal(f.controller.prepareMotionPresentation("new-snapshot"), true);
  assert.equal(f.getStage(), "motion-new-geometry"); assert.deepEqual(f.commits, []);
  f.controller.motionPresented("new-snapshot"); assert.deepEqual(f.commits, ["new"]);
});

test("failed Classic artwork leaves existing Motion body and styles intact", () => {
  const f = fixture(true); f.replace("classic-broken", "token"); f.images[0]!.onerror!();
  assert.equal(f.getMotion(), true); assert.equal(f.hostStyle.textContent, "old-style"); assert.equal(f.getApplied(), 0); assert.deepEqual(f.commits, []); assert.equal(f.errors.length, 1);
});

test("superseded Classic decode cannot apply or commit", async () => {
  const f = fixture(true); f.replace("classic-old", "old"); const stale = f.images[0]!.onload!; f.replace("classic-new", "new"); stale(); await Promise.resolve();
  assert.equal(f.getMotion(), true); f.images[1]!.onload!(); await Promise.resolve();
  assert.equal(f.getMotion(), false); assert.equal(f.getApplied(), 1); assert.deepEqual(f.commits, ["new"]);
});

test("Classic remains visible until a new Motion frame and stale candidates never commit", () => {
  const f = fixture(false); f.replace("motion-old", "old", "one"); f.replace("motion-new", "new", "two");
  assert.equal(f.getStage(), "old"); assert.equal(f.controller.prepareMotionPresentation("one"), false); assert.deepEqual(f.commits, []);
  assert.equal(f.controller.prepareMotionPresentation("two"), true); assert.equal(f.getStage(), "motion-new");
  assert.deepEqual(f.commits, []); f.controller.motionPresented("two"); assert.deepEqual(f.commits, ["new"]);
  f.controller.dispose();
});
