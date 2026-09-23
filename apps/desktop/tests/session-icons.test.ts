import assert from "node:assert/strict";
import { sessionInfoIconNames, validateSessionDescriptor } from "../src/plugin-session-descriptor.js";
import { sessionIconPaths } from "../src/session-icons.js";

// Every icon name a plugin may pass validation with must actually draw;
// otherwise an accepted card, practice, or grounding step renders blank.
for (const name of sessionInfoIconNames) {
  assert.ok(sessionIconPaths(name), `session icon "${name}" is allowlisted but has no SVG`);
}

// A grounding descriptor with icons on its practice choice and steps is
// accepted, and an icon outside the allowlist is refused.
const grounding = {
  kind: "grounding",
  title: "Grounding",
  countdownSeconds: 0,
  practices: [{ id: "grounding", name: "Grounding", icon: "anchor" }],
  practiceId: "grounding",
  steps: [{ id: "see", label: "See", title: "Look around you", prompt: "Find 1 thing", icon: "eye", items: [{ text: "A color" }] }],
};
const validated = validateSessionDescriptor(grounding);
assert.equal(validated.kind, "grounding");
assert.throws(() => validateSessionDescriptor({ ...grounding, steps: [{ ...grounding.steps[0], icon: "rocket" }] }));
