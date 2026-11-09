import assert from "node:assert/strict";
import { formatMarketplaceReleaseDate } from "../src/plugin-marketplace-format.js";

const releaseTimestamp = Date.UTC(2026, 10, 9, 12) / 1000;
assert.match(formatMarketplaceReleaseDate(releaseTimestamp, "en-US"), /2026/);
assert.equal(formatMarketplaceReleaseDate(null), "");
assert.notEqual(formatMarketplaceReleaseDate(0, "en-US"), "");
assert.equal(formatMarketplaceReleaseDate(Number.NaN), "");
