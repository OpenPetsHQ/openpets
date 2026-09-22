import { spawnSync } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";

import sevenZip from "7zip-bin";

import { resolveAppImageSquashfsOffset } from "./appimage-payload.js";

export type ExtractedArtifactPayload = { readonly payloadDir: string; readonly cleanup: () => void };

export function extractArtifactPayload(artifactPath: string, destination: string): ExtractedArtifactPayload {
  mkdirSync(destination, { recursive: true });
  if (artifactPath.endsWith(".tar.gz")) {
    run("tar", ["-xzf", artifactPath, "-C", destination]);
    return { payloadDir: destination, cleanup: () => {} };
  }
  if (extname(artifactPath) === ".zip") {
    run("unzip", ["-q", "-o", artifactPath, "-d", destination]);
    return { payloadDir: destination, cleanup: () => {} };
  }
  if (extname(artifactPath) === ".dmg") return mountDmg(artifactPath, destination);
  if (extname(artifactPath) === ".deb") {
    extractDeb(artifactPath, destination);
    return { payloadDir: destination, cleanup: () => {} };
  }
  if (extname(artifactPath) === ".rpm") {
    extractRpm(artifactPath, destination);
    return { payloadDir: destination, cleanup: () => {} };
  }
  if (extname(artifactPath) === ".AppImage") {
    return { payloadDir: extractAppImage(artifactPath, destination), cleanup: () => {} };
  }
  if (extname(artifactPath) === ".exe") {
    run(sevenZip.path7za, ["x", "-y", artifactPath, `-o${destination}`]);
    return { payloadDir: destination, cleanup: () => {} };
  }
  throw new Error(`Unsupported desktop artifact for payload validation: ${basename(artifactPath)}`);
}

function extractDeb(artifactPath: string, destination: string): void {
  const data = readDebMember(artifactPath, /^data\.tar\./u);
  if (!data) throw new Error(`DEB artifact has no data archive: ${artifactPath}`);
  const dataArchive = "data.tar.gz";
  const archivePath = join(destination, dataArchive);
  writeFileSync(archivePath, data);
  run("tar", ["-xf", archivePath, "-C", destination]);
}

function readDebMember(artifactPath: string, namePattern: RegExp): Buffer | null {
  const archive = readFileSync(artifactPath);
  if (!archive.subarray(0, 8).equals(Buffer.from("!<arch>\n"))) throw new Error(`Invalid DEB ar archive: ${artifactPath}`);
  let offset = 8;
  while (offset + 60 <= archive.length) {
    const name = archive.toString("utf8", offset, offset + 16).trim().replace(/\/$/u, "");
    const size = Number.parseInt(archive.toString("utf8", offset + 48, offset + 58).trim(), 10);
    if (!Number.isFinite(size) || archive.toString("utf8", offset + 58, offset + 60) !== "`\n") throw new Error(`Invalid DEB ar member header: ${artifactPath}`);
    const start = offset + 60;
    if (namePattern.test(name)) return archive.subarray(start, start + size);
    offset = start + size + (size % 2);
  }
  return null;
}

function extractRpm(artifactPath: string, destination: string): void {
  const cpioPath = join(destination, "payload.cpio");
  try {
    writeCommandOutput("rpm2cpio", [artifactPath], cpioPath);
    const listing = readCommandOutput("cpio", ["-it"], cpioPath);
    if (listing.status !== 0) throw new Error(`cpio failed to list ${artifactPath}: ${listing.stderr || "unknown error"}`);
    for (const path of listing.stdout.split(/\r?\n/u).filter(Boolean)) {
      if (path.startsWith("/") || path.split("/").includes("..")) throw new Error(`RPM payload contains an unsafe path: ${path}`);
    }
    const result = runWithFileInput("cpio", ["-idm"], cpioPath, destination);
    if (result.status !== 0) throw new Error(`cpio failed to extract ${artifactPath}: ${result.stderr || "unknown error"}`);
  } finally {
    unlinkSync(cpioPath);
  }
}

function extractAppImage(artifactPath: string, destination: string): string {
  const payloadOffset = resolveAppImageSquashfsOffset(readFileSync(artifactPath));
  const payloadDir = join(destination, "squashfs-root");
  run("unsquashfs", ["-f", "-no-progress", "-no-xattrs", "-offset", String(payloadOffset), "-d", payloadDir, artifactPath]);
  return payloadDir;
}

function mountDmg(artifactPath: string, destination: string): ExtractedArtifactPayload {
  const mountpoint = join(destination, "mounted");
  mkdirSync(mountpoint, { recursive: true });
  run("hdiutil", ["attach", artifactPath, "-readonly", "-nobrowse", "-mountpoint", mountpoint]);
  return {
    payloadDir: mountpoint,
    cleanup: () => {
      const result = spawnSync("hdiutil", ["detach", mountpoint, "-force"], { stdio: "pipe", encoding: "utf8" });
      if (result.status !== 0) throw new Error(`Could not detach validated DMG: ${result.stderr || result.stdout}`);
    },
  };
}

function commandOutput(command: string, args: string[]): string {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}

function writeCommandOutput(command: string, args: string[], outputPath: string): void {
  const output = openSync(outputPath, "w");
  try {
    const result = spawnSync(command, args, { stdio: ["ignore", output, "pipe"], encoding: "utf8" });
    if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr || "unknown error"}`);
  } finally {
    closeSync(output);
  }
}

function readCommandOutput(command: string, args: string[], inputPath: string) {
  const input = openSync(inputPath, "r");
  try {
    return spawnSync(command, args, { stdio: [input, "pipe", "pipe"], encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  } finally {
    closeSync(input);
  }
}

function runWithFileInput(command: string, args: string[], inputPath: string, cwd: string) {
  const input = openSync(inputPath, "r");
  try {
    return spawnSync(command, args, { cwd, stdio: [input, "ignore", "pipe"], encoding: "utf8" });
  } finally {
    closeSync(input);
  }
}

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}.`);
}
