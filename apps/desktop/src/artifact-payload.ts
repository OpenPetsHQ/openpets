import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";

import sevenZip from "7zip-bin";

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
    extractAppImage(artifactPath, destination);
    return { payloadDir: destination, cleanup: () => {} };
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
  const cpio = binaryOutput("rpm2cpio", [artifactPath]);
  const listing = spawnSync("cpio", ["-it"], { input: cpio, encoding: "utf8", maxBuffer: 128 * 1024 * 1024 });
  if (listing.status !== 0) throw new Error(`cpio failed to list ${artifactPath}: ${listing.stderr || "unknown error"}`);
  for (const path of listing.stdout.split(/\r?\n/u).filter(Boolean)) {
    if (path.startsWith("/") || path.split("/").includes("..")) throw new Error(`RPM payload contains an unsafe path: ${path}`);
  }
  const result = spawnSync("cpio", ["-idm"], {
    cwd: destination,
    input: cpio,
    stdio: ["pipe", "inherit", "pipe"],
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(`cpio failed to extract ${artifactPath}: ${result.stderr || "unknown error"}`);
}

function extractAppImage(artifactPath: string, destination: string): void {
  const nativeResult = spawnSync(artifactPath, ["--appimage-extract"], { cwd: destination, stdio: "pipe" });
  if (nativeResult.status === 0) return;
  run(sevenZip.path7za, ["x", "-y", artifactPath, `-o${destination}`]);
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

function binaryOutput(command: string, args: string[]): Buffer {
  const result = spawnSync(command, args, { encoding: null, maxBuffer: 128 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr?.toString() || "unknown error"}`);
  return result.stdout;
}

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}.`);
}
