export const DEFAULT_NPM_TAG = "latest";

export function stagingTag(version) {
  return `openpets-release-staging-${version.replaceAll(".", "-")}`;
}

export function resolveReleaseTag({ version, requestedTag = DEFAULT_NPM_TAG, tagWasExplicit = false, recovery = false }) {
  if (!recovery) return requestedTag;
  return tagWasExplicit ? requestedTag : `recovery-${version.replaceAll(".", "-")}`;
}

export function compareStableVersions(left, right) {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] > rightParts[index] ? 1 : -1;
  }
  return 0;
}

export function assertTagPromotionSafe({ packageName, requestedTag, currentVersion, targetVersion }) {
  if (!currentVersion || currentVersion === targetVersion) return;
  if (!isStableVersion(currentVersion)) {
    throw new Error(`Refusing to move ${packageName}'s ${requestedTag} tag from invalid version ${currentVersion}.`);
  }
  if (compareStableVersions(currentVersion, targetVersion) > 0) {
    throw new Error(`Refusing to move ${packageName}'s ${requestedTag} tag backward from ${currentVersion} to ${targetVersion}.`);
  }
}

export function assertStagingTagSafe({ packageName, stageTag, currentVersion, targetVersion }) {
  if (!currentVersion || currentVersion === targetVersion) return;
  throw new Error(`Refusing to overwrite ${packageName}'s deterministic staging tag ${stageTag} from ${currentVersion} to ${targetVersion}.`);
}

function isStableVersion(version) {
  return /^\d+\.\d+\.\d+$/.test(version);
}

/**
 * Publish a complete version set behind an immutable staging tag, then promote
 * the requested tag only after every package and final tag has been verified.
 * All effects are injected so the sequencing contract can be tested offline.
 */
export async function publishStagedRelease({
  packages,
  existing,
  requestedTag,
  publishPackage,
  addDistTag,
  inspectExact,
  inspectDistTags,
  smoke,
  log = () => {},
}) {
  const stageTag = stagingTag(packages[0].version);
  const existingVersions = new Set(existing.map((pkg) => `${pkg.name}@${pkg.version}`));
  log(`Using immutable release staging dist-tag: ${stageTag}`);

  for (const pkg of packages) {
    const tags = await inspectDistTags(pkg);
    assertStagingTagSafe({
      packageName: pkg.name,
      stageTag,
      currentVersion: tags?.[stageTag],
      targetVersion: pkg.version,
    });
  }

  for (const pkg of packages) {
    if (!existingVersions.has(`${pkg.name}@${pkg.version}`)) {
      await publishPackage(pkg, stageTag);
    }
    await addDistTag(pkg, stageTag);
  }

  await verifyCompleteStage({ packages, stageTag, inspectExact, inspectDistTags });
  for (const pkg of packages) {
    const tags = await inspectDistTags(pkg);
    assertTagPromotionSafe({
      packageName: pkg.name,
      requestedTag,
      currentVersion: tags?.[requestedTag],
      targetVersion: pkg.version,
    });
  }
  if (smoke) await smoke();

  for (const pkg of packages) await addDistTag(pkg, requestedTag);
  await verifyFinalTags({ packages, requestedTag, inspectExact, inspectDistTags });
}

export async function verifyCompleteStage({ packages, stageTag, inspectExact, inspectDistTags }) {
  const missing = [];
  for (const pkg of packages) {
    const exact = await inspectExact(pkg);
    const tags = await inspectDistTags(pkg);
    if (!exact || tags?.[stageTag] !== pkg.version) missing.push(`${pkg.name}@${pkg.version}`);
  }
  if (missing.length > 0) {
    throw new Error(`Staged npm release is incomplete; requested tags were not promoted. Missing: ${missing.join(", ")}`);
  }
}

export async function verifyFinalTags({ packages, requestedTag, inspectExact, inspectDistTags }) {
  const missing = [];
  for (const pkg of packages) {
    const exact = await inspectExact(pkg);
    const tags = await inspectDistTags(pkg);
    if (!exact || tags?.[requestedTag] !== pkg.version) missing.push(`${pkg.name}@${pkg.version}`);
  }
  if (missing.length > 0) {
    throw new Error(`Final npm tag verification failed for ${requestedTag}; missing: ${missing.join(", ")}`);
  }
}
