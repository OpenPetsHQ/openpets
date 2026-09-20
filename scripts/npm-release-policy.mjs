export const DEFAULT_NPM_TAG = "latest";

const NPM_REGISTRY_PROPAGATION_ATTEMPTS = 30;
const NPM_REGISTRY_PROPAGATION_DELAY_MS = 10_000;

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
  registryVerificationAttempts = NPM_REGISTRY_PROPAGATION_ATTEMPTS,
  registryVerificationDelayMs = NPM_REGISTRY_PROPAGATION_DELAY_MS,
  wait = waitForRegistry,
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

  await verifyCompleteStage({
    packages,
    stageTag,
    inspectExact,
    inspectDistTags,
    maxAttempts: registryVerificationAttempts,
    delayMs: registryVerificationDelayMs,
    wait,
    log,
  });
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
  await verifyFinalTags({
    packages,
    requestedTag,
    inspectExact,
    inspectDistTags,
    maxAttempts: registryVerificationAttempts,
    delayMs: registryVerificationDelayMs,
    wait,
    log,
  });
}

export async function verifyCompleteStage({
  packages,
  stageTag,
  inspectExact,
  inspectDistTags,
  maxAttempts = 1,
  delayMs = NPM_REGISTRY_PROPAGATION_DELAY_MS,
  wait = waitForRegistry,
  log = () => {},
}) {
  await waitForRegistryState({
    packages,
    tag: stageTag,
    inspectExact,
    inspectDistTags,
    maxAttempts,
    delayMs,
    wait,
    log,
    label: "staging tags",
    failureMessage: "Staged npm release is incomplete; requested tags were not promoted",
  });
}

export async function verifyFinalTags({
  packages,
  requestedTag,
  inspectExact,
  inspectDistTags,
  maxAttempts = 1,
  delayMs = NPM_REGISTRY_PROPAGATION_DELAY_MS,
  wait = waitForRegistry,
  log = () => {},
}) {
  await waitForRegistryState({
    packages,
    tag: requestedTag,
    inspectExact,
    inspectDistTags,
    maxAttempts,
    delayMs,
    wait,
    log,
    label: `${requestedTag} tags`,
    failureMessage: `Final npm tag verification failed for ${requestedTag}`,
  });
}

async function waitForRegistryState({ packages, tag, inspectExact, inspectDistTags, maxAttempts, delayMs, wait, log, label, failureMessage }) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const missing = await findMissingPackageVersions({ packages, tag, inspectExact, inspectDistTags });
    if (missing.length === 0) return;
    if (attempt === maxAttempts) throw new Error(`${failureMessage}. Missing: ${missing.join(", ")}`);

    const delaySeconds = delayMs / 1_000;
    log(`Waiting for npm registry propagation of ${label}; retrying in ${delaySeconds}s (${attempt}/${maxAttempts - 1}). Still missing: ${missing.join(", ")}`);
    await wait(delayMs);
  }
}

async function findMissingPackageVersions({ packages, tag, inspectExact, inspectDistTags }) {
  const missing = [];
  for (const pkg of packages) {
    const exact = await inspectExact(pkg);
    const tags = await inspectDistTags(pkg);
    if (!exact || tags?.[tag] !== pkg.version) missing.push(`${pkg.name}@${pkg.version}`);
  }
  return missing;
}

function waitForRegistry(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}
