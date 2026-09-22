import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { bundledOfficialPluginIds } from "../src/bundled-plugins.js";
import { assertBundledOfficialPlugins, assertTargetSharpNative, assertUnpackedIntegrationRuntimes, getRequiredUnpackedRuntimePackageNames } from "../src/packaging-contract.js";
import { extractArtifactPayload } from "../src/artifact-payload.js";

const desktopDir = process.env.OPENPETS_DESKTOP_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), "../..");
const repoRoot = join(desktopDir, "../..");
const sourcePluginsDir = join(repoRoot, "plugins", "official");
const desktopPackageJson = JSON.parse(readFileSync(join(desktopDir, "package.json"), "utf8")) as { dependencies?: Record<string, string> };
const runtimePackageNames = getRequiredUnpackedRuntimePackageNames(desktopPackageJson);

const fixtureRoot = join(desktopDir, ".test-packaging-fixture");
rmSync(fixtureRoot, { recursive: true, force: true });
mkdirSync(fixtureRoot, { recursive: true });

const fixtureResources = join(fixtureRoot, "resources");
const fixtureAppContents = join(fixtureRoot, "app.asar.unpacked");
mkdirSync(join(fixtureResources, "plugins", "official"), { recursive: true });
mkdirSync(join(fixtureAppContents, "node_modules"), { recursive: true });
mkdirSync(join(fixtureAppContents, "node_modules", "@img", "sharp-linux-x64", "lib"), { recursive: true });
writeFileSync(join(fixtureAppContents, "node_modules", "@img", "sharp-linux-x64", "lib", "sharp-linux-x64.node"), "native fixture\n");

for (const id of bundledOfficialPluginIds) {
  cpSync(join(sourcePluginsDir, id), join(fixtureResources, "plugins", "official", id), { recursive: true });
}

for (const packageName of runtimePackageNames) {
  const packageSource = join(repoRoot, "packages", packageName.slice("@open-pets/".length));
  const packageDestination = join(fixtureAppContents, "node_modules", ...packageName.split("/"));
  mkdirSync(packageDestination, { recursive: true });
  cpSync(join(packageSource, "package.json"), join(packageDestination, "package.json"));
  cpSync(join(packageSource, "dist"), join(packageDestination, "dist"), { recursive: true });
  if (existsSync(join(packageSource, "openclaw.plugin.json"))) {
    cpSync(join(packageSource, "openclaw.plugin.json"), join(packageDestination, "openclaw.plugin.json"));
  }
}

assertBundledOfficialPlugins(fixtureResources, sourcePluginsDir);
assertUnpackedIntegrationRuntimes(fixtureAppContents, runtimePackageNames, join(repoRoot, "packages"));
assertTargetSharpNative(fixtureAppContents, { platform: "linux", arch: "x64" });

const missingPluginFixture = join(desktopDir, ".test-packaging-missing-plugin");
rmSync(missingPluginFixture, { recursive: true, force: true });
cpSync(fixtureRoot, missingPluginFixture, { recursive: true });
rmSync(join(missingPluginFixture, "resources", "plugins", "official", "openpets.system-resources"), { recursive: true, force: true });
assert.throws(
  () => assertBundledOfficialPlugins(join(missingPluginFixture, "resources"), sourcePluginsDir),
  /openpets\.system-resources/,
  "a package missing the canonical system-resources plugin must fail before publication",
);

const stagedFixtureRoot = join(fixtureRoot, "staged");
mkdirSync(stagedFixtureRoot, { recursive: true });
writeFileSync(join(stagedFixtureRoot, "payload-marker.bin"), randomBytes(1_100_000));
for (const format of ["deb", "rpm"] as const) {
  for (const defect of ["plugin", "sharp"] as const) {
    const defectRoot = join(stagedFixtureRoot, `${format}-${defect}`);
    cpSync(join(fixtureRoot, "resources"), join(defectRoot, "resources"), { recursive: true });
    cpSync(join(fixtureRoot, "app.asar.unpacked"), join(defectRoot, "resources", "app.asar.unpacked"), { recursive: true });
    cpSync(join(stagedFixtureRoot, "payload-marker.bin"), join(defectRoot, "resources", "payload-marker.bin"));
    if (defect === "plugin") rmSync(join(defectRoot, "resources", "plugins", "official", "openpets.system-resources"), { recursive: true, force: true });
    if (defect === "sharp") rmSync(join(defectRoot, "resources", "app.asar.unpacked", "node_modules", "@img", "sharp-linux-x64", "lib", "sharp-linux-x64.node"), { force: true });
    const artifact = join(stagedFixtureRoot, `OpenPets-3.5.0-linux-amd64.${format}`);
    if (format === "deb") buildDebFixture(defectRoot, artifact);
    else buildRpmFixture(defectRoot, artifact);
    assert.ok(statSync(artifact).size > 1_000_000, `${artifact} must exercise the staged artifact size gate`);
    assert.throws(() => validateExtractedArtifact(artifact), defect === "plugin" ? /openpets\.system-resources/ : /Sharp native runtime/);
  }
}

const missingRuntimeFixture = join(desktopDir, ".test-packaging-missing-openclaw-runtime");
rmSync(missingRuntimeFixture, { recursive: true, force: true });
cpSync(fixtureRoot, missingRuntimeFixture, { recursive: true });
rmSync(join(missingRuntimeFixture, "app.asar.unpacked", "node_modules", "@open-pets", "openclaw", "dist", "runtime.js"), { force: true });
assert.throws(
  () =>
    assertUnpackedIntegrationRuntimes(
      join(missingRuntimeFixture, "app.asar.unpacked"),
      runtimePackageNames,
      join(repoRoot, "packages"),
    ),
  /@open-pets\/openclaw runtime is missing/,
  "a package missing the OpenClaw runtime must fail before publication",
);

rmSync(fixtureRoot, { recursive: true, force: true });
rmSync(missingPluginFixture, { recursive: true, force: true });
rmSync(missingRuntimeFixture, { recursive: true, force: true });
console.error("Packaging artifact fixture validation passed.");

function validateExtractedArtifact(artifact: string): void {
  const extractionRoot = join(stagedFixtureRoot, `extract-${basename(artifact)}-${Date.now()}`);
  mkdirSync(extractionRoot, { recursive: true });
  let extracted;
  try {
    extracted = extractArtifactPayload(artifact, extractionRoot);
    const resources = join(extracted.payloadDir, "resources");
    assertBundledOfficialPlugins(resources, sourcePluginsDir);
    assertUnpackedIntegrationRuntimes(join(resources, "app.asar.unpacked"), runtimePackageNames, join(repoRoot, "packages"));
    assertTargetSharpNative(join(resources, "app.asar.unpacked"), { platform: "linux", arch: "x64" });
  } finally {
    extracted?.cleanup();
    rmSync(extractionRoot, { recursive: true, force: true });
  }
}

function buildDebFixture(payloadRoot: string, artifact: string): void {
  const work = join(stagedFixtureRoot, `deb-work-${Date.now()}`);
  mkdirSync(work, { recursive: true });
  writeFileSync(join(work, "debian-binary"), "2.0\n");
  const controlRoot = join(work, "control");
  mkdirSync(controlRoot, { recursive: true });
  writeFileSync(join(controlRoot, "control"), "Package: openpets-fixture\nVersion: 1.0\nArchitecture: amd64\nDescription: OpenPets fixture\n");
  runCommand("tar", ["-czf", join(work, "control.tar.gz"), "-C", controlRoot, "."]);
  runCommand("tar", ["-czf", join(work, "data.tar.gz"), "-C", payloadRoot, "."]);
  writeFileSync(artifact, makeArArchive([
    ["debian-binary", readFileSync(join(work, "debian-binary"))],
    ["control.tar.gz", readFileSync(join(work, "control.tar.gz"))],
    ["data.tar.gz", readFileSync(join(work, "data.tar.gz"))],
  ]));
  rmSync(work, { recursive: true, force: true });
}

function buildRpmFixture(payloadRoot: string, artifact: string): void {
  const top = join(stagedFixtureRoot, `rpm-work-${Date.now()}`);
  mkdirSync(join(top, "BUILD"), { recursive: true });
  mkdirSync(join(top, "RPMS"), { recursive: true });
  mkdirSync(join(top, "SOURCES"), { recursive: true });
  mkdirSync(join(top, "SPECS"), { recursive: true });
  mkdirSync(join(top, "SRPMS"), { recursive: true });
  const spec = join(top, "SPECS", "openpets-fixture.spec");
  writeFileSync(spec, `Name: openpets-fixture\nVersion: 1\nRelease: 1\nSummary: OpenPets fixture\nLicense: MIT\nBuildArch: noarch\n%description\nOpenPets fixture\n%install\nmkdir -p %{buildroot}\ncp -a ${join(payloadRoot, "resources")} %{buildroot}/\n%files\n/resources\n`);
  runCommand("rpmbuild", ["-bb", "--define", `_topdir ${top}`, spec]);
  const built = join(top, "RPMS", "noarch", "openpets-fixture-1-1.noarch.rpm");
  cpSync(built, artifact);
  rmSync(top, { recursive: true, force: true });
}

function runCommand(command: string, args: string[], cwd?: string): void {
  const result = spawnSync(command, args, { cwd, stdio: "pipe", encoding: "utf8" });
  assert.equal(result.status, 0, `${command} ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
}

function makeArArchive(members: Array<[string, Buffer]>): Buffer {
  const header = Buffer.from("!<arch>\n");
  const chunks: Buffer[] = [header];
  for (const [name, data] of members) {
    const fields = [
      `${name}/`.padEnd(16, " "),
      "0".padEnd(12, " "),
      "0".padEnd(6, " "),
      "0".padEnd(6, " "),
      "100644".padEnd(8, " "),
      String(data.length).padEnd(10, " "),
      "`\n",
    ];
    chunks.push(Buffer.from(fields.join("")), data);
    if (data.length % 2 !== 0) chunks.push(Buffer.from("\n"));
  }
  return Buffer.concat(chunks);
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}
