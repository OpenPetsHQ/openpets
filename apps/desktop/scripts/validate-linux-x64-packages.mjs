import { createHash } from "node:crypto";
import { lstatSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopDir = dirname(scriptDir);
const repoRoot = resolve(desktopDir, "../..");
const packageJson = JSON.parse(readFileSync(join(desktopDir, "package.json"), "utf8"));
const version = packageJson.version;
const artifactDirArgument = process.argv[2];

if (!artifactDirArgument || process.argv.length !== 3) {
  throw new Error("Usage: node apps/desktop/scripts/validate-linux-x64-packages.mjs <artifact-directory>");
}

const artifactDir = resolve(repoRoot, artifactDirArgument);
const artifactNames = [
  `OpenPets-${version}-linux-x86_64.AppImage`,
  `OpenPets-${version}-linux-amd64.deb`,
  `OpenPets-${version}-linux-x86_64.rpm`,
  `OpenPets-${version}-linux-x64.tar.gz`,
];
const extractModuleUrl = pathToFileURL(join(desktopDir, "dist", "artifact-payload.js"));
const { extractArtifactPayload } = await import(extractModuleUrl.href);
const packagingContract = join(desktopDir, "dist", "check-packaging-contract.js");

for (const artifactName of artifactNames) {
  const artifactPath = join(artifactDir, artifactName);
  let stat;
  try {
    stat = lstatSync(artifactPath);
  } catch {
    throw new Error(`Missing Linux x64 release artifact: ${artifactPath}`);
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`Linux x64 release artifact must be a regular file: ${artifactPath}`);
  }
}

const tempDirs = [];
try {
  for (const artifactName of artifactNames) {
    const artifactPath = join(artifactDir, artifactName);
    const extractionDir = mkdtempSync(join(tmpdir(), `openpets-linux-x64-${version}-`));
    tempDirs.push(extractionDir);
    let extracted;
    try {
      extracted = extractArtifactPayload(artifactPath, extractionDir);
      const result = spawnSync(process.execPath, [
        packagingContract,
        "--output",
        "--output-dir",
        extracted.payloadDir,
        "--platform",
        "linux",
        "--arch",
        "x64",
      ], { cwd: desktopDir, encoding: "utf8" });
      if (result.error) throw result.error;
      if (result.status !== 0) {
        throw new Error(`Linux x64 packaging contract failed for ${artifactName}:\n${result.stderr || result.stdout}`);
      }
      process.stdout.write(`Validated ${artifactName}\n`);
    } finally {
      extracted?.cleanup();
    }
  }

  const checksumLines = artifactNames.map((artifactName) => {
    const digest = createHash("sha256").update(readFileSync(join(artifactDir, artifactName))).digest("hex");
    return `${digest}  ${artifactName}`;
  });
  writeFileSync(join(artifactDir, "SHA256SUMS"), `${checksumLines.join("\n")}\n`, "utf8");
  process.stdout.write(`Wrote ${join(artifactDir, "SHA256SUMS")}\n`);
} finally {
  for (const tempDir of tempDirs) rmSync(tempDir, { recursive: true, force: true });
}
