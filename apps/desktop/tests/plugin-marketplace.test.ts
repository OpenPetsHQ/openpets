import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getMarketplacePlugin, getMarketplacePlugins } from "../src/plugin-marketplace.js";

const origin = "https://studio-api.openpets.dev";
const release = { id: "release-1", pluginId: "demo.plugin", version: "1.0.0", status: "approved", runtime: "declarative", permissions: ["timer"], downloadUrl: `${origin}/api/marketplace/plugins/demo.plugin/releases/1.0.0/download`, sha256: "a".repeat(64) };
const summary = { ...release, id: "demo.plugin", releaseId: "release-1", name: "Demo", description: "Demo plugin", category: "tools", tags: [], publisher: { id: "publisher", username: "author", displayName: "Author", publisherType: "community" }, iconUrl: null, heartCount: 0, ratingAverage: null, ratingCount: 0, downloadCount: 0, hearted: false, myRating: null };
const detail = { ...summary, readme: "Readme", screenshots: [], sourceUrl: null, homepageUrl: null, license: null, changelog: "", releases: [release] };
const fetcher: typeof fetch = async (input, init) => {
  assert.equal(init?.credentials, "omit");
  assert.equal(init?.redirect, "error");
  return Response.json(String(input).includes("?") ? { plugins: [summary], total: 1, offset: 0, limit: 24 } : detail);
};
assert.equal((await getMarketplacePlugins({}, fetcher)).plugins[0].id, "demo.plugin");
assert.equal((await getMarketplacePlugin("demo.plugin", fetcher)).releases[0].releaseId, "release-1");
await assert.rejects(() => getMarketplacePlugin("../bad", fetcher));
await assert.rejects(() => getMarketplacePlugin("demo.plugin", async () => Response.json({ ...detail, releases: [{ ...release, sha256: "wrong" }] })));
await assert.rejects(() => getMarketplacePlugin("demo.plugin", async () => Response.json({ ...detail, releases: [{ ...release, downloadUrl: "https://evil.example/file" }] })));
await assert.rejects(() => getMarketplacePlugin("demo.plugin", async () => Response.json({ ...detail, releases: [{ ...release, pluginId: "other.plugin" }] })));
await assert.rejects(() => getMarketplacePlugin("demo.plugin", async () => Response.json({ ...detail, releases: [{ ...release, status: "pending" }] })));
await assert.rejects(() => getMarketplacePlugins({ limit: 101 }, fetcher));
await assert.rejects(() => getMarketplacePlugins({}, async () => new Response("x".repeat(2 * 1024 * 1024 + 1))));

// Captured from the local Studio API after approval; timestamps are Unix seconds.
const fixtureRoot = join(process.env.OPENPETS_DESKTOP_ROOT ?? process.cwd(), "tests", "fixtures");
const liveDetail = JSON.parse(readFileSync(join(fixtureRoot, "marketplace-live-detail.json"), "utf8"));
const previousOrigin = process.env.OPENPETS_MARKETPLACE_API_URL;
process.env.OPENPETS_MARKETPLACE_API_URL = "http://127.0.0.1:8797";
try {
  const parsed = await getMarketplacePlugin("marketplaceqa.example", async () => Response.json(liveDetail));
  assert.equal(parsed.id, "marketplaceqa.example");
  assert.equal(parsed.releases[0].createdAt, liveDetail.releases[0].createdAt);
  assert.equal(parsed.releases[0].reviewedAt, liveDetail.releases[0].reviewedAt);
  assert.equal(parsed.releases[0].network, undefined);
  assert.equal(parsed.iconUrl, liveDetail.iconUrl);

  // This SVG data URL is from the released simple-timer package catalog.
  const icon = readFileSync(join(fixtureRoot, "marketplace-simple-timer-icon.txt"), "utf8").trim();
  const tombstone = { id: "deleted", username: "deleted", displayName: "Deleted publisher", publisherType: "community" };
  const svgDetail = { ...liveDetail, iconUrl: icon, publisher: tombstone };
  const svgPlugin = await getMarketplacePlugin("marketplaceqa.example", async () => Response.json(svgDetail));
  assert.equal(svgPlugin.iconUrl, icon);
  assert.equal(svgPlugin.publisher.displayName, "Deleted publisher");
  await assert.rejects(() => getMarketplacePlugin("marketplaceqa.example", async () => Response.json({ ...svgDetail, iconUrl: "data:text/html;base64,PHNjcmlwdD4=" })));
  await assert.rejects(() => getMarketplacePlugin("marketplaceqa.example", async () => Response.json({ ...svgDetail, releases: [{ ...liveDetail.releases[0], createdAt: "1794217366" }] })));
} finally {
  if (previousOrigin === undefined) delete process.env.OPENPETS_MARKETPLACE_API_URL;
  else process.env.OPENPETS_MARKETPLACE_API_URL = previousOrigin;
}
