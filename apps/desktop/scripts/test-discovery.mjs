import { readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";

function compareNames(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function relativePath(from, to) {
  return relative(from, to).split(sep).join("/");
}

async function discoverSourceFiles(rootDir, sourceDirectory, matches, recursive = true) {
  const sourceRoot = join(rootDir, sourceDirectory);
  let entries;
  try {
    entries = await readdir(sourceRoot, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`Required source directory is missing: ${sourceDirectory}`);
    }
    throw error;
  }

  const files = [];
  async function visit(directory, directoryEntries) {
    for (const entry of directoryEntries.sort((a, b) => compareNames(a.name, b.name))) {
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory() && recursive) {
        await visit(entryPath, await readdir(entryPath, { withFileTypes: true }));
      } else if (entry.isFile() && matches(entry.name)) {
        files.push(entryPath);
      }
    }
  }

  await visit(sourceRoot, entries);
  files.sort((a, b) => compareNames(relativePath(rootDir, a), relativePath(rootDir, b)));
  if (files.length === 0) {
    throw new Error(`No matching source files found in ${sourceDirectory}`);
  }
  return files;
}

function mapSourceToArtifact(rootDir, sourcePath, sourceDirectory, artifactDirectory) {
  const sourceRelativePath = relative(join(rootDir, sourceDirectory), sourcePath);
  return join(rootDir, artifactDirectory, sourceRelativePath.replace(/\.ts$/, ".js"));
}

export async function discoverArtifacts(rootDir) {
  const behaviorSources = await discoverSourceFiles(rootDir, "tests", (name) => name.endsWith(".test.ts"));
  const contractSources = await discoverSourceFiles(rootDir, "contracts", (name) => name.endsWith(".contract.ts"));
  const distCheckSources = await discoverSourceFiles(rootDir, "src", (name) => /^check-.*\.ts$/.test(name));

  return {
    behaviorTests: behaviorSources.map((sourcePath) => mapSourceToArtifact(rootDir, sourcePath, "tests", ".test-dist/tests")),
    contractTests: contractSources.map((sourcePath) => mapSourceToArtifact(rootDir, sourcePath, "contracts", ".test-dist/contracts")),
    distChecks: distCheckSources.map((sourcePath) => mapSourceToArtifact(rootDir, sourcePath, "src", "dist")),
  };
}
