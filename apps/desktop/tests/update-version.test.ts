import assert from "node:assert/strict";

import { createParsedUpdateStatus, isVersionNewer, normalizeVersion } from "../src/update-version.js";

assert.equal(normalizeVersion("v1.2.3"), "1.2.3");
assert.equal(normalizeVersion("1.2.3"), "1.2.3");
assert.equal(normalizeVersion("v1.2.3-beta.1"), "1.2.3");
assert.equal(normalizeVersion("release"), null);

assert.equal(isVersionNewer("1.0.1", "1.0.0"), true);
assert.equal(isVersionNewer("1.2.0", "1.1.9"), true);
assert.equal(isVersionNewer("2.0.0", "1.99.99"), true);
assert.equal(isVersionNewer("1.0.0", "1.0.0"), false);
assert.equal(isVersionNewer("1.0.0", "1.0.1"), false);
assert.equal(isVersionNewer("bad", "1.0.1"), false);

const repo = "OpenPetsHQ/openpets";
const releasesUrl = `https://github.com/${repo}/releases`;
const available = createParsedUpdateStatus("1.0.0", { tag_name: "v1.0.1", html_url: "https://github.com/OpenPetsHQ/openpets/releases/tag/v1.0.1" }, 123, repo, releasesUrl);
assert.equal(available.state, "available");
assert.equal(available.latestVersion, "1.0.1");

const current = createParsedUpdateStatus("1.0.1", { tag_name: "v1.0.1", html_url: "https://github.com/OpenPetsHQ/openpets/releases/tag/v1.0.1" }, 124, repo, releasesUrl);
assert.equal(current.state, "current");

assert.throws(() => createParsedUpdateStatus("1.0.0", { tag_name: "release" }, 125, repo, releasesUrl));

console.error("Update checker validation passed.");
