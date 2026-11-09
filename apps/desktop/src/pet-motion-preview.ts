import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
import { readBoundedRegularFile } from "@open-pets/pet-format/node/files";
import { info } from "./logger.js";
import {
  motionPreviewClips,
  motionPreviewMaxDecodedPixels,
  motionPreviewMaxFileBytes,
  motionPreviewMaxTotalBytes,
  validateMotionPreviewPack,
  type MotionPreviewPack,
} from "./pet-motion-preview-format.js";

export interface LoadedMotionPreview {
  readonly pack: MotionPreviewPack;
  readonly urls: Readonly<Record<string, string>>;
}

let active: LoadedMotionPreview | null = null;
let snapshotDirectory: string | null = null;

/** Main process owns the validated, private asset snapshot and its cleanup. */
export async function initializeMotionPreview(options: {
  readonly directory: string | undefined;
  readonly userData: string;
  readonly isPackaged: boolean;
}): Promise<void> {
  if (!options.directory || options.isPackaged) {
    return;
  }
  if (!isAbsolute(options.directory)) {
    throw new Error("OPENPETS_MOTION_PREVIEW_DIR must be an absolute path.");
  }
  const bytes = await readBoundedRegularFile(
    join(options.directory, "motion.json"),
    32 * 1024,
    "Motion preview manifest",
  );
  const pack = validateMotionPreviewPack(
    JSON.parse(bytes.toString("utf8")) as unknown,
  );
  const directory = await mkdtemp(join(options.userData, "motion-preview-"));
  try {
    let totalBytes = 0;
    const urls: Record<string, string> = {};
    for (const clip of motionPreviewClips(pack)) {
      if (urls[clip.file]) {
        continue;
      }
      const data = await readBoundedRegularFile(
        join(options.directory, clip.file),
        motionPreviewMaxFileBytes,
        clip.file,
      );
      totalBytes += data.byteLength;
      if (totalBytes > motionPreviewMaxTotalBytes) {
        throw new Error("Motion preview exceeds the total file budget.");
      }
      const image = sharp(data, {
        animated: true,
        failOn: "warning",
        limitInputPixels: motionPreviewMaxDecodedPixels,
      });
      const metadata = await image.metadata();
      const frames = metadata.pages ?? 1;
      const frameHeight = metadata.pageHeight ?? metadata.height;
      if (
        metadata.format !== "webp" ||
        !metadata.hasAlpha ||
        metadata.width !== pack.width ||
        frameHeight !== pack.height ||
        frames !== clip.frames
      ) {
        throw new Error(
          `Motion preview ${clip.file} has incorrect image geometry or frame count.`,
        );
      }
      if (
        frames > 1 &&
        (!metadata.delay ||
          metadata.delay.length !== frames ||
          metadata.delay.some((delay) => delay < 16 || delay > 1000) ||
          metadata.delay.reduce((sum, delay) => sum + delay, 0) > 12_000)
      ) {
        throw new Error(
          `Motion preview ${clip.file} has invalid frame timing.`,
        );
      }
      // Sequential full decoding catches truncated later frames before any renderer sees the pack.
      await image.stats();
      const target = join(directory, clip.file);
      await writeFile(target, data, { mode: 0o600, flag: "wx" });
      urls[clip.file] = pathToFileURL(target).toString();
    }
    snapshotDirectory = directory;
    active = { pack, urls };
    info("pet.window", "motion preview loaded", {
      clips: Object.keys(urls).length,
      totalBytes,
      width: pack.width,
      height: pack.height,
    });
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

export function getMotionPreview(): LoadedMotionPreview | null {
  return active;
}

export async function disposeMotionPreview(): Promise<void> {
  active = null;
  const directory = snapshotDirectory;
  snapshotDirectory = null;
  if (directory) await rm(directory, { recursive: true, force: true });
}
