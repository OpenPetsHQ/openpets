const elfHeaderSize = 64;
const elfSectionHeaderSize = 64;
const squashfsMagic = Buffer.from("hsqs");

export function resolveAppImageSquashfsOffset(artifact: Buffer): number {
  if (artifact.length < elfHeaderSize) throw new Error("AppImage is too small to contain an ELF64 header.");
  if (!artifact.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) throw new Error("AppImage does not begin with an ELF header.");
  if (artifact[4] !== 2 || artifact[5] !== 1) throw new Error("AppImage must be a little-endian ELF64 binary.");

  const sectionHeaderOffsetValue = artifact.readBigUInt64LE(40);
  if (sectionHeaderOffsetValue > BigInt(artifact.length)) {
    throw new Error("AppImage section header table offset exceeds the artifact size.");
  }
  const sectionHeaderOffset = Number(sectionHeaderOffsetValue);
  const sectionHeaderEntrySize = artifact.readUInt16LE(58);
  const sectionHeaderCount = artifact.readUInt16LE(60);
  if (sectionHeaderEntrySize < elfSectionHeaderSize || sectionHeaderCount === 0) {
    throw new Error("AppImage has an invalid ELF section header table.");
  }

  const sectionTableEnd = sectionHeaderOffset + sectionHeaderEntrySize * sectionHeaderCount;
  if (sectionTableEnd > artifact.length || !Number.isSafeInteger(sectionTableEnd)) {
    throw new Error("AppImage section header table exceeds the artifact size.");
  }

  if (!artifact.subarray(sectionTableEnd, sectionTableEnd + squashfsMagic.length).equals(squashfsMagic)) {
    throw new Error(`AppImage SquashFS payload is missing after the ELF section header table at offset ${sectionTableEnd}.`);
  }
  return sectionTableEnd;
}
