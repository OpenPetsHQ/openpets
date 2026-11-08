import assert from "node:assert/strict";

import { beginDefaultPetMove, cancelDefaultPetMove, finishDefaultPetMove, isDefaultPetMoveCurrent } from "../src/default-pet-move-cancellation.js";

const state = { generation: 0, activeGeneration: null as number | null };
const canceledMove = beginDefaultPetMove(state);

assert.equal(isDefaultPetMoveCurrent(state, canceledMove), true, "the current default-pet move owns the interpolation");
cancelDefaultPetMove(state);
assert.equal(isDefaultPetMoveCurrent(state, canceledMove), false, "cancel invalidates a move already in progress");
assert.equal(state.activeGeneration, null, "cancel releases the default-pet movement slot immediately");

const replacementMove = beginDefaultPetMove(state);
finishDefaultPetMove(state, canceledMove);
assert.equal(isDefaultPetMoveCurrent(state, replacementMove), true, "a canceled move cannot clear its replacement");
finishDefaultPetMove(state, replacementMove);
assert.equal(state.activeGeneration, null, "the active move clears its own slot when it finishes");

console.log("Default pet move cancellation tests passed.");
