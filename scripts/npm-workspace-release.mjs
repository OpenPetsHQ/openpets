import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Return the workspace packages which are actually public npm packages.
 * The package manifests are the release manifest; this deliberately does not
 * maintain a second list of packages in release automation.
 */
export function discoverPublicWorkspacePackages(repoRoot) {
  const root = resolve(repoRoot);
  const workspaceDirs = readWorkspaceDirectories(root);
  const workspacePackages = [];

  for (const workspaceDir of workspaceDirs) {
    for (const entry of readdirSync(join(root, workspaceDir), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const relativePath = join(workspaceDir, entry.name);
      const packagePath = join(root, relativePath, "package.json");
      if (!existsSync(packagePath)) continue;

      const packageJson = readJson(packagePath);
      if (typeof packageJson.name !== "string" || !packageJson.name) {
        throw new Error(`${relativePath}/package.json must include a package name.`);
      }

      workspacePackages.push({
        relativePath,
        packageDir: join(root, relativePath),
        packageJson,
        name: packageJson.name,
        version: packageJson.version,
      });
    }
  }

  const publicNames = new Set(workspacePackages
    .filter((pkg) => pkg.packageJson.private !== true && pkg.packageJson.publishConfig?.access === "public")
    .map((pkg) => pkg.name));
  const packages = workspacePackages.filter((pkg) => publicNames.has(pkg.name));
  if (packages.length === 0) throw new Error("No public workspace packages were discovered.");
  return validateAndOrderPublicPackages(packages, { workspacePackages });
}

export function validateAndOrderPublicPackages(packages, options = {}) {
  const byName = new Map();
  for (const pkg of packages) {
    if (byName.has(pkg.name)) throw new Error(`Duplicate public workspace package name: ${pkg.name}`);
    if (typeof pkg.version !== "string" || !pkg.version) {
      throw new Error(`${pkg.relativePath}/package.json must include a version.`);
    }
    if (!isStableSemver(pkg.version) || pkg.version === "0.0.0") {
      throw new Error(`${pkg.name} version must be a stable non-zero semver version. Current: ${pkg.version}`);
    }
    if (pkg.packageJson.private === true || pkg.packageJson.publishConfig?.access !== "public") {
      throw new Error(`${pkg.name} is not a public publishable package.`);
    }
    byName.set(pkg.name, pkg);
  }

  const versions = new Set(packages.map((pkg) => pkg.version));
  if (versions.size !== 1) {
    throw new Error(`Public workspace packages must use one shared version. Found: ${[...versions].sort().join(", ")}`);
  }

  const dependencies = new Map(packages.map((pkg) => [pkg.name, new Set()]));
  const allWorkspaceNames = new Set((options.workspacePackages || packages).map((pkg) => pkg.name));
  for (const pkg of packages) {
    for (const [dependencyName, dependencySpec] of runtimeWorkspaceDependencyEntries(pkg.packageJson)) {
      if (allWorkspaceNames.has(dependencyName) && dependencySpec !== "workspace:*") {
        throw new Error(`${pkg.name} must use the exact workspace:* spec for internal runtime dependency ${dependencyName}; found ${dependencySpec}.`);
      }
      if (allWorkspaceNames.has(dependencyName) && !byName.has(dependencyName)) {
        throw new Error(`${pkg.name} has a workspace runtime dependency on non-public package ${dependencyName}.`);
      }
      if (byName.has(dependencyName)) dependencies.get(pkg.name).add(dependencyName);
    }
  }

  const remaining = new Map([...dependencies].map(([name, deps]) => [name, new Set(deps)]));
  const ordered = [];
  while (remaining.size > 0) {
    const ready = [...remaining]
      .filter(([, deps]) => deps.size === 0)
      .map(([name]) => name)
      .sort(compareNames);
    if (ready.length === 0) {
      throw new Error(`Cannot determine public package publish order; runtime dependency cycle involves: ${[...remaining.keys()].sort().join(", ")}`);
    }
    for (const name of ready) {
      ordered.push(byName.get(name));
      remaining.delete(name);
    }
    for (const deps of remaining.values()) {
      for (const name of ready) deps.delete(name);
    }
  }
  return ordered;
}

function compareNames(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

export function runtimeWorkspaceDependencies(packageJson) {
  return runtimeWorkspaceDependencyEntries(packageJson).map(([name]) => name);
}

export function runtimeWorkspaceDependencyEntries(packageJson) {
  return Object.entries({ ...packageJson.dependencies, ...packageJson.optionalDependencies });
}

export function isStableSemver(version) {
  return /^\d+\.\d+\.\d+$/.test(version);
}

function readWorkspaceDirectories(repoRoot) {
  const workspaceFile = join(repoRoot, "pnpm-workspace.yaml");
  if (existsSync(workspaceFile)) {
    const directories = readFileSync(workspaceFile, "utf8")
      .split(/\r?\n/)
      .map((line) => {
        const match = line.match(/^\s*-\s*(?:["']([^"']+)["']|([^\s#]+))\s*$/);
        return match?.[1] || match?.[2];
      })
      .filter(Boolean)
      .map((pattern) => pattern.endsWith("/*") ? pattern.slice(0, -2) : null)
      .filter(Boolean);
    if (directories.length > 0) return directories;
  }

  const rootManifest = readJson(join(repoRoot, "package.json"));
  return (rootManifest.workspaces || [])
    .map((pattern) => pattern.endsWith("/*") ? pattern.slice(0, -2) : null)
    .filter(Boolean);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
