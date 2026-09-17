import {
  assertTagPromotionSafe,
  assertStagingTagSafe,
  publishStagedRelease,
  resolveReleaseTag,
  stagingTag,
} from "./npm-release-policy.mjs";
import {
  recoveryInstallCommand,
  validateCurrentCheckoutState,
  validateRecoverySource,
  validateTrustedTagRefs,
} from "./npm-release-recovery.mjs";

const packages = [
  { name: "@fixture/base", version: "3.5.0" },
  { name: "@fixture/cli", version: "3.5.0" },
];

async function main() {
  const published = new Set(["@fixture/base@3.5.0"]);
  const tags = new Map([
    ["@fixture/base", { latest: "3.4.0" }],
    ["@fixture/cli", {}],
  ]);
  const publishes = [];
  const tagChanges = [];
  let smokeCount = 0;

  await publishStagedRelease({
    packages,
    existing: [packages[0]],
    requestedTag: "latest",
    publishPackage: async (pkg, tag) => {
      publishes.push([pkg.name, tag]);
      published.add(`${pkg.name}@${pkg.version}`);
    },
    addDistTag: async (pkg, tag) => {
      tagChanges.push([pkg.name, tag]);
      tags.get(pkg.name)[tag] = pkg.version;
    },
    inspectExact: async (pkg) => published.has(`${pkg.name}@${pkg.version}`),
    inspectDistTags: async (pkg) => tags.get(pkg.name),
    smoke: async () => { smokeCount += 1; },
  });
  assertEqual(publishes, [["@fixture/cli", stagingTag("3.5.0")]], "retry skips immutable published version");
  assertEqual(tagChanges.filter(([, tag]) => tag === "latest").length, 2, "requested tag promotion count");
  assertEqual(smokeCount, 1, "CLI smoke sequencing");

  assertRejectsSync(
    () => assertStagingTagSafe({ packageName: "@fixture/base", stageTag: stagingTag("3.5.0"), currentVersion: "3.6.0", targetVersion: "3.5.0" }),
    /deterministic staging tag.*3.6.0 to 3.5.0/,
    "staging tag overwrite rejection",
  );
  const conflictingTags = new Map([["@fixture/base", { [stagingTag("3.5.0")]: "3.6.0" }], ["@fixture/cli", {}]]);
  let conflictingPublishes = 0;
  await assertRejects(() => publishStagedRelease({
    packages,
    existing: [],
    requestedTag: "latest",
    publishPackage: async () => { conflictingPublishes += 1; },
    addDistTag: async () => {},
    inspectExact: async () => true,
    inspectDistTags: async (pkg) => conflictingTags.get(pkg.name),
  }), /deterministic staging tag/, "staging tags are checked before publication");
  assertEqual(conflictingPublishes, 0, "staging conflict has no publication side effect");

  const incompleteTags = new Map(packages.map((pkg) => [pkg.name, {}]));
  let incompletePromotions = 0;
  await assertRejects(() => publishStagedRelease({
    packages,
    existing: [],
    requestedTag: "latest",
    publishPackage: async () => {},
    addDistTag: async (_pkg, tag) => { if (tag === "latest") incompletePromotions += 1; },
    inspectExact: async () => true,
    inspectDistTags: async () => incompleteTags.get("@fixture/base"),
  }), /Staged npm release is incomplete/, "no promotion before complete staging");
  assertEqual(incompletePromotions, 0, "incomplete release promotion count");

  const finalTags = new Map(packages.map((pkg) => [pkg.name, { [stagingTag("3.5.0")]: pkg.version }]));
  let finalPromotionAttempts = 0;
  await assertRejects(() => publishStagedRelease({
    packages,
    existing: packages,
    requestedTag: "latest",
    publishPackage: async () => {},
    addDistTag: async (_pkg, tag) => { if (tag === "latest") finalPromotionAttempts += 1; },
    inspectExact: async () => true,
    inspectDistTags: async (pkg) => finalTags.get(pkg.name),
  }), /Final npm tag verification failed/, "post-promotion final tag verification");
  assertEqual(finalPromotionAttempts, 2, "final tag verification observes promotion attempts");

  assertRejectsSync(
    () => assertTagPromotionSafe({ packageName: "@fixture/base", requestedTag: "latest", currentVersion: "4.0.0", targetVersion: "3.5.0" }),
    /backward from 4.0.0 to 3.5.0/,
    "tag rollback rejection",
  );
  assertEqual(resolveReleaseTag({ version: "3.5.0", recovery: true }), "recovery-3-5-0", "historical default tag");
  assertEqual(resolveReleaseTag({ version: "3.5.0", recovery: true, requestedTag: "latest", tagWasExplicit: true }), "latest", "explicit historical latest tag");
  assertEqual(recoveryInstallCommand(), ["pnpm", ["install", "--frozen-lockfile"]], "historical worktree dependency installation");
  assertEqual(validateCurrentCheckoutState({ status: "", upstream: "origin/main", head: "commit", remoteHead: "commit" }), "commit", "current checkout validation");
  assertRejectsSync(
    () => validateCurrentCheckoutState({ status: " M release-npm.mjs", upstream: "origin/main", head: "commit", remoteHead: "commit" }),
    /working tree must be clean/,
    "dirty current checkout rejection",
  );
  assertRejectsSync(
    () => validateCurrentCheckoutState({ status: "", upstream: "", head: "commit", remoteHead: "" }),
    /upstream remote branch/,
    "unpublished current branch rejection",
  );
  assertRejectsSync(
    () => validateCurrentCheckoutState({ status: "", upstream: "origin/main", head: "commit", remoteHead: "other" }),
    /HEAD must be pushed/,
    "unpushed current checkout rejection",
  );
  assertEqual(
    validateTrustedTagRefs({
      ref: "v3.5.0",
      remoteRefs: [["tag-object", "refs/tags/v3.5.0"], ["commit", "refs/tags/v3.5.0^{}"]],
    }),
    "commit",
    "annotated ref trust",
  );
  validateRecoverySource({ ref: "v3.5.0", headCommit: "commit", tagCommit: "commit", expectedCommit: "commit", packageVersions: ["3.5.0", "3.5.0"] });
  assertRejectsSync(
    () => validateTrustedTagRefs({ ref: "v3.5.0", remoteRefs: [["commit", "refs/tags/v3.5.0"]] }),
    /annotated trusted tag/,
    "unannotated ref rejection",
  );
  assertRejectsSync(
    () => validateRecoverySource({ ref: "v3.5.0", headCommit: "other", tagCommit: "commit", packageVersions: ["3.5.0"] }),
    /trusted annotated tag/,
    "selected source lifecycle",
  );
  assertRejectsSync(
    () => validateRecoverySource({ ref: "v3.5.0", headCommit: "commit", tagCommit: "changed", expectedCommit: "commit", packageVersions: ["3.5.0"] }),
    /changed before the recovery worktree/,
    "remote ref race rejection",
  );
  console.log("npm release policy invariants passed.");
}

await main();

function assertEqual(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label} mismatch: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
}

async function assertRejects(fn, pattern, label) {
  try {
    await fn();
  } catch (error) {
    if (!pattern.test(error.message)) throw new Error(`${label} had the wrong error: ${error.message}`);
    return;
  }
  throw new Error(`${label}: expected an error`);
}

function assertRejectsSync(fn, pattern, label) {
  try {
    fn();
  } catch (error) {
    if (!pattern.test(error.message)) throw new Error(`${label} had the wrong error: ${error.message}`);
    return;
  }
  throw new Error(`${label}: expected an error`);
}
