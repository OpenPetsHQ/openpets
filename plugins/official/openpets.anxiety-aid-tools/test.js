// Golden test for openpets.anxiety-aid-tools.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildCalmPattern,
  buildDescriptor,
  buildPmrDescriptor,
  buildPmrInfo,
  buildPmrSteps,
  buildPractices,
  buildSessionInfo,
  PMR_CITATIONS,
  PMR_GROUP_IDS,
  register,
  SITE_URL,
  STORAGE_KEY_LAST_PRACTICE,
} from "./index.js";

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

// Progressive muscle relaxation (PMR) follows the documented 19-group order,
// 10s tense + 10s release per group, with concrete physical cues.
const EXPECTED_PMR_GROUPS = [
  "right-hand",
  "left-hand",
  "right-arm",
  "left-arm",
  "forehead",
  "face",
  "jaw",
  "neck",
  "shoulders",
  "upper-back",
  "abdomen",
  "lower-back",
  "hips",
  "right-thigh",
  "left-thigh",
  "right-calf",
  "left-calf",
  "right-foot",
  "left-foot",
];
assert.deepEqual(PMR_GROUP_IDS, EXPECTED_PMR_GROUPS);

const pmrSteps = buildPmrSteps(t);
assert.equal(pmrSteps.length, 19);
for (let i = 0; i < pmrSteps.length; i++) {
  const step = pmrSteps[i];
  assert.equal(step.id, EXPECTED_PMR_GROUPS[i]);
  assert.equal(step.tenseSeconds, 10);
  assert.equal(step.releaseSeconds, 10);
  assert.equal(typeof step.name, "string");
  assert.ok(step.name.length > 0);
  assert.equal(typeof step.tenseLabel, "string");
  assert.ok(step.tenseLabel.length > 0);
  assert.equal(typeof step.releaseLabel, "string");
  assert.ok(step.releaseLabel.length > 0);
  assert.equal(step.tenseCue, step.tenseCues[0]);
  assert.equal(step.releaseCue, step.releaseCues[0]);
  assert.ok(step.tenseCues.length >= 3 && step.tenseCues.length <= 4);
  assert.equal(step.releaseCues.length, 3);
  assert.deepEqual(step.tenseIllustration, { kind: "svg", name: `pmr-${step.id}-tense` });
  assert.deepEqual(step.releaseIllustration, { kind: "svg", name: `pmr-${step.id}-release` });
}

const rightHand = pmrSteps.find((step) => step.id === "right-hand");
const rightArm = pmrSteps.find((step) => step.id === "right-arm");
const neck = pmrSteps.find((step) => step.id === "neck");
const lowerBack = pmrSteps.find((step) => step.id === "lower-back");
assert.equal(rightHand.tenseCues.length, 3);
assert.equal(rightHand.releaseCues.length, 3);
assert.equal(rightArm.tenseCues.length, 4);
assert.equal(neck.tenseCues.includes("Draw the chin in slightly."), true);
assert.equal(neck.tenseCues.some((line) => /chest/i.test(line) && /push/i.test(line)), false);
assert.equal(lowerBack.tenseCues.includes("Stop if it hurts."), true);

// PMR knowledge layer carries clinical citations for muscle relaxation.
const pmrInfo = buildPmrInfo(t, { kind: "svg", name: "logo" });
assert.ok(pmrInfo.sections.length >= 5);
const pmrScience = pmrInfo.sections.find((section) => section.cards?.some((card) => card.url));
assert.ok(pmrScience, "the PMR science section must link its studies");
for (const card of pmrScience.cards) {
  assert.match(card.url ?? "", /^https:\/\/pmc\.ncbi\.nlm\.nih\.gov\//);
}
assert.equal(pmrInfo.citations.length, 4);
const expectedPmcIds = ["PMC7102525", "PMC10844009", "PMC4280725", "PMC9047807"];
for (const pmcId of expectedPmcIds) {
  assert.ok(
    pmrInfo.citations.some((citation) => citation.url.includes(pmcId)),
    `missing citation for ${pmcId}`,
  );
}
assert.ok(pmrInfo.disclaimer.length > 0);
assert.equal(pmrInfo.site.url, SITE_URL);
assert.deepEqual(pmrInfo.logo, { kind: "svg", name: "logo" });

// Practices list exposes breathing and PMR
const practices = buildPractices(t);
assert.deepEqual(practices, [
  { id: "breathing", name: t("practice.breathing") },
  { id: "pmr", name: t("practice.pmr") },
]);

// Starting from the pet menu opens an auto-starting session,
// and once the run starts the pet menu gains the pause/stop controls.
const harness = createTestHarness(register, { permissions: ["ui:session", "commands", "storage"], locales: { en } });
await harness.start();

let latestSession = null;
let latestSpec = null;
let latestEventHandler = null;
const origSession = harness.ctx.ui.session;
harness.ctx.ui.session = async (spec) => {
  latestSpec = spec;
  const handle = await origSession(spec);
  const origOnEvent = handle.onEvent;
  handle.onEvent = (fn) => {
    latestEventHandler = fn;
    return origOnEvent(fn);
  };
  latestSession = handle;
  return handle;
};

// Breathing descriptor check
const descriptor = buildDescriptor(harness.ctx, true, true);
assert.equal(descriptor.kind, "breathing");
assert.equal(descriptor.practiceId, "breathing");
assert.deepEqual(descriptor.practices, practices);
assert.equal(descriptor.patterns.length, 1);
assert.equal(descriptor.patternId, "calm");
assert.equal(descriptor.autoStart, true);
assert.deepEqual(descriptor.audio.inhale, { kind: "sound", name: "breath-in" });
assert.deepEqual(descriptor.audio.exhale, { kind: "sound", name: "breath-out" });
assert.equal(descriptor.audio.enabled, true);

// PMR descriptor check
const pmrDesc = buildPmrDescriptor(harness.ctx, true);
assert.equal(pmrDesc.kind, "pmr");
assert.equal(pmrDesc.practiceId, "pmr");
assert.deepEqual(pmrDesc.practices, practices);
assert.equal(pmrDesc.steps.length, 19);
for (const step of pmrDesc.steps) {
  assert.deepEqual(step.tenseIllustration, { kind: "svg", name: `pmr-${step.id}-tense` });
  assert.deepEqual(step.releaseIllustration, { kind: "svg", name: `pmr-${step.id}-release` });
}
assert.equal(pmrDesc.autoStart, true);
assert.equal(pmrDesc.audio, undefined);
assert.equal(pmrDesc.patterns, undefined);

const pmrDescFromGeneric = buildDescriptor(harness.ctx, true, true, "pmr");
assert.equal(pmrDescFromGeneric.kind, "pmr");
assert.equal(pmrDescFromGeneric.steps.length, 19);

// 1. Run start-breathing command
await harness.runCommand("start-breathing");
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(latestSpec.kind, "breathing");
assert.equal(harness.calls.menuItems.length, 2, "running session must expose pause + stop menu items");
assert.equal(harness.calls.menuItems[0].id, "breathing-pause");
assert.equal(harness.calls.menuItems[1].id, "breathing-stop");
assert.equal(await harness.ctx.storage.get(STORAGE_KEY_LAST_PRACTICE), "breathing");

// Pause breathing
await latestSession.pause();
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(harness.calls.menuItems[0].id, "breathing-resume");
assert.equal(harness.calls.menuItems[1].id, "breathing-stop");

// Resume breathing
await latestSession.resume();
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(harness.calls.menuItems[0].id, "breathing-pause");

// 2. Run start-pmr command
await harness.runCommand("start-pmr");
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(latestSpec.kind, "pmr");
assert.equal(latestSpec.steps.length, 19);
assert.equal(harness.calls.menuItems.length, 2, "running PMR must expose PMR pause + stop menu items");
assert.equal(harness.calls.menuItems[0].id, "pmr-pause");
assert.equal(harness.calls.menuItems[1].id, "pmr-stop");
assert.equal(await harness.ctx.storage.get(STORAGE_KEY_LAST_PRACTICE), "pmr");

// Pause PMR
await latestSession.pause();
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(harness.calls.menuItems[0].id, "pmr-resume");
assert.equal(harness.calls.menuItems[1].id, "pmr-stop");

// Resume PMR
await latestSession.resume();
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(harness.calls.menuItems[0].id, "pmr-pause");

// 3. Switch practice via practiceSelected event
latestEventHandler({ type: "practiceSelected", practiceId: "breathing" });
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(latestSpec.kind, "breathing");
assert.equal(latestSpec.practiceId, "breathing");
assert.equal(latestSpec.autoStart, false);
assert.equal(await harness.ctx.storage.get(STORAGE_KEY_LAST_PRACTICE), "breathing");

// Switch back to PMR via practiceSelected event
latestEventHandler({ type: "practiceSelected", practiceId: "pmr" });
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(latestSpec.kind, "pmr");
assert.equal(latestSpec.practiceId, "pmr");
assert.equal(latestSpec.autoStart, false);
assert.equal(await harness.ctx.storage.get(STORAGE_KEY_LAST_PRACTICE), "pmr");

// 4. Stop session
await latestSession.stop();
await new Promise((resolve) => setTimeout(resolve, 0));
assert.deepEqual(harness.calls.menuItems, [], "stopping session must clear menu items");

// 5. Open idle respects stored lastPractice
await harness.ctx.storage.set(STORAGE_KEY_LAST_PRACTICE, "pmr");
await harness.runCommand("open-anxiety-aid-tools");
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(latestSpec.kind, "pmr");
assert.equal(latestSpec.autoStart, false);

await harness.ctx.storage.set(STORAGE_KEY_LAST_PRACTICE, "breathing");
await harness.runCommand("open-anxiety-aid-tools");
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(latestSpec.kind, "breathing");
assert.equal(latestSpec.autoStart, false);

await harness.stop();
console.log("openpets.anxiety-aid-tools golden test passed");
