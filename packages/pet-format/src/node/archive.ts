import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import yauzl from "yauzl";
import type { Entry, ZipFile } from "yauzl";

import { maxCodexPetJsonBytes } from "../metadata.js";
import { assertOutputPathInside, ZipEntryPathTracker } from "./paths.js";

export interface PetZipLimits {
  readonly maxZipDownloadBytes: number;
  readonly maxExtractedTotalBytes: number;
  readonly maxFiles: number;
  readonly maxIndividualFileBytes: number;
  readonly maxCodexPetJsonBytes: number;
}

export const defaultPetZipLimits: Readonly<PetZipLimits> = Object.freeze({
  maxZipDownloadBytes: 50 * 1024 * 1024,
  maxExtractedTotalBytes: 200 * 1024 * 1024,
  maxFiles: 500,
  maxIndividualFileBytes: 100 * 1024 * 1024,
  maxCodexPetJsonBytes,
});

export interface PetZipExtractionOptions {
  readonly limits?: PetZipLimits;
  readonly signal?: AbortSignal;
}

/** The caller owns staging cleanup; rejection waits until active writes have closed. */
export async function extractPetZip(zip: Buffer, tempDir: string, options: PetZipExtractionOptions = {}): Promise<string[]> {
  const { limits = defaultPetZipLimits, signal } = options;
  signal?.throwIfAborted();
  const { maxZipDownloadBytes, maxExtractedTotalBytes, maxFiles, maxIndividualFileBytes, maxCodexPetJsonBytes } = limits;
  const zipFile = await openZipFromBuffer(zip);
  const pathTracker = new ZipEntryPathTracker();
  const seenRequired = new Set<string>();
  let fileCount = 0;
  let extractedTotal = 0;

  try {
    await new Promise<void>((resolvePromise, rejectPromise) => {
      const stop = new AbortController();
      let settled = false;
      let active = false;
      let failure: unknown;

      const finishFailure = (): void => {
        if (settled || active || failure === undefined) return;
        settled = true;
        cleanup();
        rejectPromise(failure);
      };

      const reject = (error: unknown): void => {
        if (settled) return;
        if (failure === undefined) {
          failure = error instanceof Error ? error : new Error("Zip extraction failed.");
          stop.abort();
        }
        finishFailure();
      };

      const onAbort = (): void => {
        reject(signal?.reason ?? new DOMException("The operation was aborted.", "AbortError"));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      const cleanup = (): void => {
        signal?.removeEventListener("abort", onAbort);
        zipFile.removeListener("error", reject);
      };

      zipFile.on("error", reject);
      zipFile.on("end", () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolvePromise();
      });

      zipFile.on("entry", (entry) => {
        if (settled || failure !== undefined) return;
        active = true;
        void processEntry(entry).catch(reject).finally(() => {
          active = false;
          if (failure !== undefined) {
            finishFailure();
          } else if (!settled) {
            zipFile.readEntry();
          }
        });
      });

      const processEntry = async (entry: Entry): Promise<void> => {
        stop.signal.throwIfAborted();
        validateEntryMetadata(entry, maxZipDownloadBytes, maxIndividualFileBytes);
        const safePath = pathTracker.accept(entry.fileName);

        if (safePath.isDirectory) {
          return;
        }

        if (!safePath.relativeOutputPath) {
          throw new Error("Zip file entry is missing an output path.");
        }

        fileCount += 1;
        if (fileCount > maxFiles) throw new Error("Zip contains too many files.");
        if (safePath.relativeOutputPath === "pet.json" && entry.uncompressedSize > maxCodexPetJsonBytes) throw new Error("pet.json is too large.");
        if (entry.uncompressedSize > maxIndividualFileBytes) throw new Error("Zip entry is too large.");
        extractedTotal += entry.uncompressedSize;
        if (extractedTotal > maxExtractedTotalBytes) throw new Error("Zip extracted total is too large.");

        const outputPath = resolve(tempDir, safePath.relativeOutputPath);
        assertOutputPathInside(tempDir, outputPath);
        seenRequired.add(safePath.relativeOutputPath);
        if (safePath.relativeOutputPath.includes("/")) {
          await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 });
        }
        stop.signal.throwIfAborted();
        await writeEntry(entry, zipFile, outputPath, entry.uncompressedSize, safePath.relativeOutputPath === "pet.json" ? maxCodexPetJsonBytes : maxIndividualFileBytes, stop.signal);
      };

      if (signal?.aborted) onAbort();
      if (!settled) zipFile.readEntry();
    });
  } finally {
    zipFile.close();
  }

  return [...seenRequired].filter((path) => !path.includes("/"));
}

function openZipFromBuffer(buffer: Buffer): Promise<ZipFile> {
  return new Promise((resolvePromise, rejectPromise) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (error, zipFile) => {
      if (error) {
        rejectPromise(error);
        return;
      }

      if (!zipFile) {
        rejectPromise(new Error("Zip file could not be opened."));
        return;
      }

      resolvePromise(zipFile);
    });
  });
}

function validateEntryMetadata(entry: Entry, maxZipDownloadBytes: number, maxIndividualFileBytes: number): void {
  if (entry.isEncrypted()) throw new Error("Encrypted zip entries are not supported.");
  if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) {
    throw new Error("Unsupported zip entry compression method.");
  }
  if (entry.compressedSize > maxZipDownloadBytes) throw new Error("Zip entry compressed size is too large.");
  if (entry.uncompressedSize > maxIndividualFileBytes) throw new Error("Zip entry uncompressed size is too large.");

  const unixMode = getUnixMode(entry);
  if (unixMode === null) return;

  const type = unixMode & 0o170000;
  const isKnownFileType = type !== 0;
  const isRegularFile = type === 0o100000;
  const isDirectory = type === 0o040000;
  if (isKnownFileType && !isRegularFile && !isDirectory) {
    throw new Error("Zip entry special files are not supported.");
  }
}

function getUnixMode(entry: Entry): number | null {
  if ((entry.versionMadeBy >> 8) !== 3) {
    return null;
  }

  return (entry.externalFileAttributes >> 16) & 0o177777;
}

function writeEntry(entry: Entry, zipFile: ZipFile, outputPath: string, expectedBytes: number, maxBytes: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    zipFile.openReadStream(entry, (error, readStream) => {
      if (error) {
        rejectPromise(error);
        return;
      }

      if (!readStream) {
        rejectPromise(new Error("Zip entry stream could not be opened."));
        return;
      }

      if (signal.aborted) {
        readStream.destroy();
        rejectPromise(signal.reason);
        return;
      }

      let actualBytes = 0;
      const counter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          actualBytes += chunk.byteLength;
          if (actualBytes > maxBytes) {
            callback(new Error("Zip entry exceeded individual size limit."));
            return;
          }
          callback(null, chunk);
        },
      });

      const onReadError = (readError: Error): void => {
        counter.destroy(readError);
      };
      const stopReading = (): void => {
        readStream.unpipe(counter);
        readStream.destroy();
      };
      readStream.on("error", onReadError);
      signal.addEventListener("abort", stopReading, { once: true });
      readStream.pipe(counter);
      const cleanup = (): void => {
        signal.removeEventListener("abort", stopReading);
        readStream.removeListener("error", onReadError);
      };
      // yauzl's buffer-backed reader can omit a terminal close on destroy.
      // Stop it explicitly; pipeline completion waits for the file writer to close.
      pipeline(counter, createWriteStream(outputPath, { mode: 0o600 }), { signal })
        .then(() => {
          cleanup();
          if (actualBytes !== expectedBytes) {
            rejectPromise(new Error("Zip entry extracted size did not match metadata."));
            return;
          }

          resolvePromise();
        })
        .catch((writeError: unknown) => {
          stopReading();
          cleanup();
          rejectPromise(writeError);
        });
    });
  });
}
