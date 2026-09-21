// Golden test for openpets.anxiety-aid-tools.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildCalmPattern, buildDescriptor, buildSessionInfo, register, SITE_URL } from "./index.js";

let createTestHarness;
try {
  ({ createTestHarness } = await import("@open-pets/plugin-sdk/testing"));
} catch {
  ({ createTestHarness } = await import(new URL("../../../packages/sdk/dist/testing.js", import.meta.url)));
}

const en = JSON.parse(await readFile(new URL("./locales/en.json", import.meta.url), "utf8"));
const t = (key) => {
  assert.ok(typeof en[key] === "string" && en[key], `missing locale key ${key}`);
  return en[key];
};

// The shipped rhythm is the documented Calm 4-6: four seconds in, six out,
// with a finite cycle count so the session has a real completion.
const pattern = buildCalmPattern(t);
assert.equal(pattern.id, "calm");
assert.deepEqual(pattern.phases.map((phase) => [phase.kind, phase.seconds]), [["in", 4], ["out", 6]]);
assert.ok(Number.isInteger(pattern.cycles) && pattern.cycles >= 1);

// The knowledge layer carries the full AAT structure: mechanism, science with
// linked studies, when/notice lists, tips, real citations, disclaimer, and
// the site attribution the license requires.
const info = buildSessionInfo(t, { kind: "svg", name: "logo" });
assert.ok(info.sections.length >= 5);
const scienceSection = info.sections.find((section) => section.cards?.some((card) => card.url));
assert.ok(scienceSection, "the science section must link its studies");
for (const card of scienceSection.cards) {
  assert.match(card.url ?? "", /^https:\/\/pmc\.ncbi\.nlm\.nih\.gov\//);
}
assert.ok(info.sections.some((section) => Array.isArray(section.items) && section.items.length >= 3));
assert.ok(info.citations.length >= 4);
for (const citation of info.citations) {
  assert.match(citation.url, /^https:\/\//);
}
assert.ok(info.disclaimer.length > 0);
assert.equal(info.site.url, SITE_URL);
assert.deepEqual(info.logo, { kind: "svg", name: "logo" });

// Starting from the pet menu opens an auto-starting single-pattern session,
// and once the run starts the pet menu gains the pause/stop controls.
const harness = createTestHarness(register, { permissions: ["ui:session", "commands"], locales: { en } });
await harness.start();

const descriptor = buildDescriptor(harness.ctx, true);
assert.equal(descriptor.kind, "breathing");
assert.equal(descriptor.patterns.length, 1);
assert.equal(descriptor.patternId, "calm");
assert.equal(descriptor.autoStart, true);

await harness.runCommand("start-breathing");
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(harness.calls.menuItems.length, 2, "running session must expose pause + stop menu items");

await harness.stop();
console.log("openpets.anxiety-aid-tools golden test passed");
