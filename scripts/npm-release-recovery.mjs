export function validateTrustedTagRefs({ ref, remoteRefs }) {
  if (!/^v\d+\.\d+\.\d+$/.test(ref)) {
    throw new Error(`--ref must be a stable version tag such as v3.5.0. Received: ${ref}`);
  }
  const direct = remoteRefs.find(([, remoteRef]) => remoteRef === `refs/tags/${ref}`)?.[0];
  const peeled = remoteRefs.find(([, remoteRef]) => remoteRef === `refs/tags/${ref}^{}`)?.[0];
  if (!direct || !peeled || direct === peeled) {
    throw new Error(`Remote ${ref} must be an annotated trusted tag with a peeled commit.`);
  }
  return peeled;
}

export function recoveryInstallCommand() {
  return ["pnpm", ["install", "--frozen-lockfile"]];
}

export function validateCurrentCheckoutState({ status, upstream, head, remoteHead }) {
  if (status) throw new Error(`Git working tree must be clean before npm release.\n${status}`);
  if (!upstream) throw new Error("Release branch must have an upstream remote branch.");
  if (head !== remoteHead) throw new Error(`HEAD must be pushed to ${upstream} before npm release.`);
  return head;
}

export function validateRecoverySource({ ref, headCommit, tagCommit, expectedCommit = null, packageVersions }) {
  if (expectedCommit && tagCommit !== expectedCommit) {
    throw new Error(`Trusted remote ref ${ref} changed before the recovery worktree was created.`);
  }
  if (tagCommit !== headCommit) {
    throw new Error(`Recovery source must be the trusted annotated tag ${ref}.`);
  }
  const versions = new Set(packageVersions);
  const expectedVersion = ref.slice(1);
  if (versions.size !== 1 || !versions.has(expectedVersion)) {
    throw new Error(`Trusted ref ${ref} must contain public packages at shared version ${expectedVersion}.`);
  }
}
