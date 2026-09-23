// Golden test for openpets.anxiety-aid-tools.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildCalmPattern,
  buildDescriptor,
  buildGroundingDescriptor,
  buildGroundingInfo,
  buildGroundingSteps,
  buildGuidedDescriptor,
  buildMeditationDescriptor,
  buildMeditationInfo,
  buildMeditationTracks,
  buildSoundScenes,
  buildVisualizationDescriptor,
  buildVisualizationTracks,
  MEDIA_ORIGIN,
  narrationLanguage,
  buildGuidedInfo,
  buildGuidedPatterns,
  buildPmrDescriptor,
  buildPmrInfo,
  buildPmrSteps,
  buildPractices,
  buildSessionInfo,
  GROUNDING_CITATIONS,
  PMR_CITATIONS,
  PMR_GROUP_IDS,
  register,
  SITE_URL,
  STORAGE_KEY_LAST_GUIDED_PATTERN,
  STORAGE_KEY_LAST_MEDITATION,
  STORAGE_KEY_LAST_SOUNDSCAPE,
  STORAGE_KEY_LAST_VISUALIZATION,
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

// Guided breathing ships the AAT guided patterns with their documented
// timings; every hold says whether the lungs are full or empty.
const guidedPatterns = buildGuidedPatterns(t);
assert.deepEqual(
  guidedPatterns.map((entry) => [entry.id, entry.phases.map((phase) => `${phase.kind}${phase.seconds}`).join(" ")]),
  [
    ["box", "in4 hold4 out4 hold4"],
    ["calming", "in4 hold7 out8"],
    ["energizing", "in4 hold4 out6"],
    ["quick", "in3 hold3 out3"],
  ],
);
for (const entry of guidedPatterns) {
  assert.ok(Number.isInteger(entry.cycles) && entry.cycles >= 1);
  assert.ok(entry.phases.every((phase) => phase.label.length > 0));
}
assert.notEqual(guidedPatterns[0].phases[1].label, guidedPatterns[0].phases[3].label, "box holds must name full vs empty lungs");

// Each guided pattern plays AAT's cue pair recorded for that timing, and the
// manifest declares every one of those sounds.
const manifest = JSON.parse(await readFile(new URL("./openpets.plugin.json", import.meta.url), "utf8"));
for (const entry of guidedPatterns) {
  assert.deepEqual(entry.cues, {
    inhale: { kind: "sound", name: `guided-${entry.id}-in` },
    exhale: { kind: "sound", name: `guided-${entry.id}-out` },
  });
  assert.ok(manifest.assets.sounds[entry.cues.inhale.name] && manifest.assets.sounds[entry.cues.exhale.name]);
}

// Guided Info covers every pattern, as AAT's guided breathing page does, and
// marks the selected one; it keeps the linked science and site credit.
const guidedInfo = buildGuidedInfo(t, { kind: "svg", name: "logo" }, "calming");
const patternSection = guidedInfo.sections[0];
assert.equal(patternSection.cards.length, guidedPatterns.length);
assert.equal(new Set(patternSection.cards.map((card) => card.body)).size, guidedPatterns.length);
assert.ok(patternSection.cards.every((card) => card.detail.length > 0));
assert.deepEqual(
  patternSection.cards.map((card) => card.highlighted === true),
  guidedPatterns.map((entry) => entry.id === "calming"),
);
assert.ok(guidedInfo.sections.some((section) => section.cards?.some((card) => card.url?.startsWith("https://pmc.ncbi.nlm.nih.gov/"))));
assert.equal(guidedInfo.site.url, SITE_URL);

// Grounding counts down the senses 5-4-3-2-1, every item has a hint, and
// each sense carries its icon for the card.
const groundingSteps = buildGroundingSteps(t);
assert.deepEqual(
  groundingSteps.map((step) => [step.id, step.items.length, step.icon]),
  [["see", 5, "eye"], ["touch", 4, "hand"], ["hear", 3, "ear"], ["smell", 2, "flower"], ["taste", 1, "coffee"]],
);
assert.ok(groundingSteps.every((step) => step.items.every((item) => item.text && item.guidance)));

// Grounding Info cites the real studies it describes and links each one.
const groundingInfo = buildGroundingInfo(t, { kind: "svg", name: "logo" });
const groundingScience = groundingInfo.sections.find((section) => section.cards?.some((card) => card.url));
assert.deepEqual(groundingScience.cards.map((card) => card.url), GROUNDING_CITATIONS.map((citation) => citation.url));
assert.ok(GROUNDING_CITATIONS.every((citation) => citation.url.startsWith("https://pmc.ncbi.nlm.nih.gov/")));
assert.equal(groundingInfo.site.url, SITE_URL);

// Guided meditation: AAT's eight sessions with the segment counts recorded on
// R2, one narrated URL per segment in the narration language, a caption each.
assert.deepEqual(
  [["en", "en"], ["es-419", "es"], ["pt-BR", "pt"], ["zh-Hans", "zh"], ["zh-Hant", "zh"], ["ja", "en"], ["ko", "en"]].map(([locale]) => narrationLanguage(locale)),
  ["en", "es", "pt", "zh", "zh", "en", "en"],
);
const meditationTracks = buildMeditationTracks(t, "es-419");
assert.deepEqual(meditationTracks.map((track) => track.segments.length), [7, 13, 14, 10, 13, 12, 11, 12]);
for (const track of meditationTracks) {
  assert.deepEqual(track.cover, { kind: "image", name: `meditation-${track.id}` });
  track.segments.forEach((segment, index) => {
    assert.equal(segment.audioUrl, `${MEDIA_ORIGIN}/guided-meditation/es/${track.id}/${String(index + 1).padStart(2, "0")}.mp3`);
    assert.ok(segment.caption.length > 0);
  });
}
const meditationInfo = buildMeditationInfo(t, undefined, "metta-loving-kindness-protocol");
const highlightedMeditation = meditationInfo.sections.flatMap((section) => section.cards ?? []).filter((card) => card.highlighted);
assert.deepEqual(highlightedMeditation.map((card) => card.title), [t("meditation.metta-loving-kindness-protocol.title")]);
assert.ok(meditationInfo.citations.every((citation) => citation.url.startsWith("https://pmc.ncbi.nlm.nih.gov/")));

// Peaceful visualization: AAT's nine scenes, seven narrated steps each, and a
// declared cover.
const visualizationManifest = JSON.parse(await readFile(new URL("./openpets.plugin.json", import.meta.url), "utf8"));
const visualizationTracks = buildVisualizationTracks(t, "pt-BR");
assert.equal(visualizationTracks.length, 9);
for (const track of visualizationTracks) {
  assert.ok(visualizationManifest.assets.svgs[track.cover.name], `${track.id} cover must be declared`);
  assert.equal(track.segments.length, 7);
  track.segments.forEach((segment, index) => {
    assert.equal(segment.audioUrl, `${MEDIA_ORIGIN}/peaceful-visualization/pt/${track.id}/0${index + 1}.mp3`);
    assert.ok(segment.caption.length > 0);
  });
}

// Relaxing sounds: AAT's eight soundscapes, each with at least one looping bed,
// every layer file on the approved media origin, and a declared cover.
const soundScenes = buildSoundScenes(t);
assert.equal(soundScenes.length, 8);
const soundManifest = JSON.parse(await readFile(new URL("./openpets.plugin.json", import.meta.url), "utf8"));
for (const scene of soundScenes) {
  assert.ok(scene.layers.some((layer) => layer.loop), `${scene.id} needs a looping bed`);
  assert.ok(scene.layers.every((layer) => layer.loop || layer.interval), `${scene.id} layers must loop or repeat`);
  assert.ok(scene.layers.every((layer) => layer.files.every((file) => file.startsWith(`${MEDIA_ORIGIN}/`))));
  assert.ok(soundManifest.assets.images[scene.cover.name], `${scene.id} cover must be declared`);
}

// The practice picker lists every practice, each with an icon.
const practices = buildPractices(t);
assert.deepEqual(
  practices.map((choice) => [choice.id, choice.name]),
  [
    ["breathing", t("practice.breathing")],
    ["guided-breathing", t("practice.guided")],
    ["pmr", t("practice.pmr")],
    ["grounding", t("practice.grounding")],
    ["meditation", t("practice.meditation")],
    ["visualization", t("practice.visualization")],
    ["sounds", t("practice.sounds")],
  ],
);
assert.ok(practices.every((choice) => typeof choice.icon === "string"));

// Starting from the pet menu opens an auto-starting session.
const harness = createTestHarness(register, { permissions: ["ui:session", "commands", "storage"], locales: { en } });
await harness.start();

// The pet menu lists the practices themselves, in order, and nothing else.
assert.deepEqual(
  [...harness.calls.commands.values()].map(({ meta }) => [meta.id, meta.title]),
  [
    ["start-breathing", "$t:practice.breathing"],
    ["start-guided-breathing", "$t:practice.guided"],
    ["start-pmr", "$t:practice.pmr"],
    ["start-grounding", "$t:practice.grounding"],
    ["start-meditation", "$t:practice.meditation"],
    ["start-visualization", "$t:practice.visualization"],
    ["start-sounds", "$t:practice.sounds"],
  ],
);

let latestSession = null;
let latestSpec = null;
let latestEventHandler = null;
const sessionUpdates = [];
const origSession = harness.ctx.ui.session;
harness.ctx.ui.session = async (spec) => {
  latestSpec = spec;
  const handle = await origSession(spec);
  const origUpdate = handle.update;
  handle.update = async (patch) => {
    sessionUpdates.push(patch);
    return origUpdate(patch);
  };
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

// 2. Run start-pmr command
await harness.runCommand("start-pmr");
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(latestSpec.kind, "pmr");
assert.equal(latestSpec.steps.length, 19);

// 3. Switch practice via practiceSelected event
latestEventHandler({ type: "practiceSelected", practiceId: "breathing" });
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(latestSpec.kind, "breathing");
assert.equal(latestSpec.practiceId, "breathing");
assert.equal(latestSpec.autoStart, false);

// Switch back to PMR via practiceSelected event
latestEventHandler({ type: "practiceSelected", practiceId: "pmr" });
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(latestSpec.kind, "pmr");
assert.equal(latestSpec.practiceId, "pmr");
assert.equal(latestSpec.autoStart, false);

// 4. Guided breathing: the command opens the pattern picker session; picking
// a pattern swaps Info to that pattern and is remembered for next time.
await harness.runCommand("start-guided-breathing");
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(latestSpec.kind, "breathing");
assert.equal(latestSpec.practiceId, "guided-breathing");
assert.equal(latestSpec.patterns.length, 4);
assert.equal(latestSpec.patternId, "box");

latestEventHandler({ type: "patternChanged", patternId: "calming" });
await new Promise((resolve) => setTimeout(resolve, 0));
const guidedUpdate = sessionUpdates.at(-1);
assert.equal(guidedUpdate.patternId, "calming");
assert.equal(guidedUpdate.info.sections[0].cards.find((card) => card.highlighted).title, t("guided.pattern.calming.heading"));
assert.equal(await harness.ctx.storage.get(STORAGE_KEY_LAST_GUIDED_PATTERN), "calming");

await harness.runCommand("start-guided-breathing");
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(latestSpec.patternId, "calming");
assert.equal(latestSpec.info.sections[0].cards.find((card) => card.highlighted).title, t("guided.pattern.calming.heading"));
assert.equal(buildGuidedDescriptor(harness.ctx, false, true, "not-a-pattern").patternId, "box");

// 5. Grounding is self-paced: no lead-in countdown.
await harness.runCommand("start-grounding");
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(latestSpec.kind, "grounding");
assert.equal(latestSpec.practiceId, "grounding");
assert.equal(latestSpec.countdownSeconds, 0);
assert.equal(buildGroundingDescriptor(harness.ctx, false).steps.length, 5);

// 6. Guided meditation plays through the host player; Japanese hears English
// narration with a note, English does not show one.
await harness.runCommand("start-meditation");
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(latestSpec.kind, "player");
assert.equal(latestSpec.practiceId, "meditation");
assert.equal(latestSpec.tracks.length, 8);
assert.equal(latestSpec.narrationNote, undefined);
latestEventHandler({ type: "patternChanged", patternId: "vagus-nerve-delta-descent" });
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(await harness.ctx.storage.get(STORAGE_KEY_LAST_MEDITATION), "vagus-nerve-delta-descent");
const meditationUpdate = sessionUpdates.at(-1);
assert.equal(meditationUpdate.info.sections.flatMap((section) => section.cards ?? []).find((card) => card.highlighted).title, t("meditation.vagus-nerve-delta-descent.title"));
await harness.runCommand("start-meditation");
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(latestSpec.trackId, "vagus-nerve-delta-descent");
const jaCtx = { ...harness.ctx, locale: "ja", t: (key) => harness.ctx.t(key), assets: harness.ctx.assets };
const jaMeditation = buildMeditationDescriptor(jaCtx, false);
assert.equal(jaMeditation.narrationNote, t("meditation.narrationNote"));
assert.ok(jaMeditation.tracks[0].segments[0].audioUrl.includes("/guided-meditation/en/"));

// 6b. Visualization uses the same player and remembers the last scene.
await harness.runCommand("start-visualization");
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(latestSpec.kind, "player");
assert.equal(latestSpec.practiceId, "visualization");
latestEventHandler({ type: "patternChanged", patternId: "cozyRainyCabin" });
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(await harness.ctx.storage.get(STORAGE_KEY_LAST_VISUALIZATION), "cozyRainyCabin");
assert.equal(buildVisualizationDescriptor(harness.ctx, false, "cozyRainyCabin").trackId, "cozyRainyCabin");

// 6c. Relaxing sounds open the soundscape mixer and remember the scene.
await harness.runCommand("start-sounds");
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(latestSpec.kind, "soundscape");
assert.equal(latestSpec.practiceId, "sounds");
latestEventHandler({ type: "patternChanged", patternId: "fireplace" });
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(await harness.ctx.storage.get(STORAGE_KEY_LAST_SOUNDSCAPE), "fireplace");
await harness.runCommand("start-sounds");
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(latestSpec.sceneId, "fireplace");

// 7. Session controls live on the session card; the pet menu never gains
// pause/resume/stop items.
await latestSession.stop();
await new Promise((resolve) => setTimeout(resolve, 0));
assert.deepEqual(harness.calls.menuItems, []);

await harness.stop();
console.log("openpets.anxiety-aid-tools golden test passed");
