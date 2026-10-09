import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createPetContentStageController } = require("../../src/pet-content-stage.cjs") as {
  createPetContentStageController: (document: Record<string, unknown>) => {
    replaceStage(bodyHtml: string): void;
    setScaleOverride(scale: number): void;
  };
};

type Stage = {
  classList?: { contains(name: string): boolean };
  replaceWith(stage: Stage): void;
  outerHTML: string;
};

const replacementSprite = { style: { transform: "" } };
const replacementStage: Stage = {
  classList: { contains: (name) => name === "stage" },
  replaceWith() {},
  outerHTML: "",
};
let currentSprite: typeof replacementSprite | null = { style: { transform: "" } };
let replacementHappened = false;
let currentStage: Stage = {
  replaceWith(stage) {
    assert.equal(stage, replacementStage);
    currentStage = replacementStage;
    currentSprite = replacementSprite;
    replacementHappened = true;
  },
  outerHTML: "",
};

const document = {
  querySelector(selector: string) {
    if (selector === ".stage") return currentStage;
    if (selector === ".sprite, .installed-sprite") return currentSprite;
    throw new Error(`Unexpected selector: ${selector}`);
  },
  createElement() {
    return {
      set innerHTML(_html: string) {},
      content: { firstElementChild: replacementStage },
    };
  },
  body: { insertAdjacentHTML() {} },
};
const petContentStage = createPetContentStageController(document);

// The main process's scale event arrives before the in-place content update.
petContentStage.setScaleOverride(1.6);
assert.equal(currentSprite?.style.transform, "scale(1.6)", "the host scale replay applies to the current sprite");
petContentStage.replaceStage("<div class='stage'></div>");
assert.equal(replacementHappened, true, "the in-place update replaces the stage and sprite node");
assert.equal(replacementSprite.style.transform, "scale(1.6)", "content replacement automatically reapplies the received plugin scale");

console.log("Pet content replacement and scale replay behavior passed.");
