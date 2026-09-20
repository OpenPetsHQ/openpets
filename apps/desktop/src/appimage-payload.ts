const elfHeaderSize = 64;
const elfSectionHeaderSize = 64;
const squashfsMagic = Buffer.from("hsqs");

export function resolveAppImageSquashfsOffset(artifact: Buffer): number {
  if (artifact.length < elfHeaderSize) throw new Error("AppImage is too small to contain an ELF64 header.");
  if (!artifact.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) throw new Error("AppImage does not begin with an ELF header.");
  if (artifact[4] !== 2 || artifact[5] !== 1) throw new Error("AppImage must be a little-endian ELF64 binary.");

  const sectionHeaderOffset = readSafeOffset(artifact.readBigUInt64LE(40), artifact.length, "section header table offset");
  const sectionHeaderEntrySize = artifact.readUInt16LE(58);
  const sectionHeaderCount = artifact.readUInt16LE(60);
  if (sectionHeaderEntrySize < elfSectionHeaderSize || sectionHeaderCount === 0) {
    throw new Error("AppImage has an invalid ELF section header table.");
  }

  const sectionTableEnd = sectionHeaderOffset + sectionHeaderEntrySize * sectionHeaderCount;
  if (sectionTableEnd > artifact.length || !Number.isSafeInteger(sectionTableEnd)) {
    throw new Error("AppImage section header table exceeds the artifact size.");
  }

  let payloadOffset = sectionTableEnd;
  for (let index = 0; index < sectionHeaderCount; index += 1) {
    const sectionOffset = sectionHeaderOffset + sectionHeaderEntrySize * index;
    const sectionEnd = readSafeOffset(
      artifact.readBigUInt64LE(sectionOffset + 24) + artifact.readBigUInt64LE(sectionOffset + 32),
      artifact.length,
      `section ${index} end offset`,
    );
    payloadOffset = Math.max(payloadOffset, sectionEnd);
  }

  if (!artifact.subarray(payloadOffset, payloadOffset + squashfsMagic.length).equals(squashfsMagic)) {
    throw new Error(`AppImage SquashFS payload is missing at ELF payload offset ${payloadOffset}.`);
  }
  return payloadOffset;
}

function readSafeOffset(value: bigint, artifactLength: number, label: string): number {
  if (value > BigInt(artifactLength)) throw new Error(`AppImage ${label} exceeds the artifact size.`);
  return Number(value);
}
