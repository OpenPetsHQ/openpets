import assert from "node:assert/strict";

import { resolveAppImageSquashfsOffset } from "../src/appimage-payload.js";

const validArtifact = createElfArtifact({ sectionOffset: 256, sectionSize: 64 });
assert.equal(resolveAppImageSquashfsOffset(validArtifact), 192, "uses the end of the ELF section header table as the Type-2 payload offset");

const invalidHeader = Buffer.from(validArtifact);
invalidHeader[0] = 0;
assert.throws(() => resolveAppImageSquashfsOffset(invalidHeader), /ELF header/, "rejects non-ELF artifacts");

const overflowingSectionTable = Buffer.alloc(256);
writeElfHeader(overflowingSectionTable, 224, 1);
assert.throws(() => resolveAppImageSquashfsOffset(overflowingSectionTable), /section header table exceeds/, "rejects an out-of-file section header table");

const missingSquashfs = createElfArtifact({ sectionOffset: 256, sectionSize: 64 });
missingSquashfs.write("nope", 192, "ascii");
assert.throws(() => resolveAppImageSquashfsOffset(missingSquashfs), /SquashFS payload is missing/, "requires SquashFS at the calculated payload offset");

console.error("AppImage payload offset validation passed.");

function createElfArtifact({ sectionOffset, sectionSize }: { readonly sectionOffset: number; readonly sectionSize: number }): Buffer {
  const artifact = Buffer.alloc(512);
  writeElfHeader(artifact, 128, 1);
  artifact.writeBigUInt64LE(BigInt(sectionOffset), 128 + 24);
  artifact.writeBigUInt64LE(BigInt(sectionSize), 128 + 32);
  artifact.write("hsqs", 192, "ascii");
  return artifact;
}

function writeElfHeader(artifact: Buffer, sectionHeaderOffset: number, sectionHeaderCount: number): void {
  artifact.write("\x7fELF", 0, "binary");
  artifact[4] = 2;
  artifact[5] = 1;
  artifact.writeBigUInt64LE(BigInt(sectionHeaderOffset), 40);
  artifact.writeUInt16LE(64, 58);
  artifact.writeUInt16LE(sectionHeaderCount, 60);
}
