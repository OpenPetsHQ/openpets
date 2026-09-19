import assert from "node:assert/strict";

import {
  buildPetAssistantTools,
  petAssistantToolName,
  PET_ASSISTANT_PROVIDER_TOOL_NAME_MAX_BYTES,
} from "../src/pet-assistant-tools.js";
import type { PetAssistantCapability, PetAssistantGenerationHandle } from "../src/pet-assistant-types.js";

const handle = { generation: 1 } as PetAssistantGenerationHandle;

function capability(pluginId: string, id: string, capabilityHandle = handle): PetAssistantCapability {
  return {
    pluginId,
    capability: { id, description: `${pluginId} ${id} description`, inputSchema: { type: "object" } },
    handle: capabilityHandle,
  };
}

// Normal identities stay readable and do not receive a digest suffix.
assert.equal(petAssistantToolName("system", "resources.summary"), "system_resources_summary");
assert.equal(petAssistantToolName("Focus Buddy", "start-now"), "focus_buddy_start_now");

// Normalization collisions receive deterministic, distinct names while retaining both exact targets.
{
  const first = capability("focus.buddy", "start");
  const secondHandle = { generation: 2 } as PetAssistantGenerationHandle;
  const second = capability("focus-buddy", "start", secondHandle);
  const set = buildPetAssistantTools({ capabilities: [first, second] });
  assert.equal(set.tools.length, 2);
  assert.notEqual(set.tools[0]?.name, set.tools[1]?.name);
  assert.ok(set.tools.every((tool) => tool.name.startsWith("focus_buddy_start_")));
  assert.equal([...set.targetsByName.values()].some((target) => target.handle === first.handle), true);
  assert.equal([...set.targetsByName.values()].some((target) => target.handle === secondHandle), true);
}

// Long identities are readable up to the provider limit and use a suffix only for truncation.
{
  const longPluginId = `calendar-${"very-long-plugin-name-".repeat(5)}`;
  const name = petAssistantToolName(longPluginId, "events.create");
  assert.ok(name.startsWith("calendar_very_long_plugin_name_"));
  assert.ok(name.length <= PET_ASSISTANT_PROVIDER_TOOL_NAME_MAX_BYTES);
  const suffix = name.slice(-8);
  assert.equal(suffix.length, 8);
  assert.equal([...suffix].every((character) => "0123456789abcdef".includes(character)), true);
}

// Exact duplicate capability identities are rejected rather than silently remapped.
assert.throws(
  () => buildPetAssistantTools({ capabilities: [capability("focus.buddy", "start"), capability("focus.buddy", "start")] }),
  /Duplicate assistant capability/,
);

console.log("pet-assistant-tools tests passed.");
