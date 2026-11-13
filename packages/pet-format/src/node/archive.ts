import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import yauzl from "yauzl";
import type { Entry, ZipFile } from "yauzl";

import { maxCodexPetJsonBytes } from "../metadata.js";
import { assertOutputPathInside, validateZipEntryName, ZipEntryPathTracker } from "./paths.js";

export interface PetZipLimits {
  readonly maxZipDownloadBytes: number;
  readonly maxExtractedTotalBytes: number;
  readonly maxFiles: number;
  readonly maxIndividualFileBytes: number;
  readonly maxCodexPetJsonBytes: number;
}

const maxPetArchiveBytes = 1024 * 1024 * 1024;

export const defaultPetZipLimits: Readonly<PetZipLimits> = Object.freeze({
  maxZipDownloadBytes: maxPetArchiveBytes,
  maxExtractedTotalBytes: maxPetArchiveBytes,
  maxFiles: 500,
  maxIndividualFileBytes: maxPetArchiveBytes,
  maxCodexPetJsonBytes,
});

export interface PetZipExtractionOptions {
  readonly limits?: PetZipLimits;
  readonly signal?: AbortSignal;
  readonly format?: "classic" | "motion";
}

/** The caller owns staging cleanup; rejection waits until active writes have closed. */
export async function extractPetZip(zip: Buffer, tempDir: string, options: PetZipExtractionOptions = {}): Promise<string[]> {
  const { limits = defaultPetZipLimits, signal } = options;
  signal?.throwIfAborted();
  const { maxZipDownloadBytes, maxExtractedTotalBytes, maxFiles, maxIndividualFileBytes, maxCodexPetJsonBytes } = limits;
  const zipFile = await openZipFromBuffer(zip);
  const pathTracker = new ZipEntryPathTracker(options.format);
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

/** Inspect only bounded pet.json bytes; extraction must still validate every entry. */
export async function detectPetZipFormat(
  zip: Buffer,
  limits: PetZipLimits = defaultPetZipLimits,
): Promise<"classic" | "motion"> {
  if (zip.byteLength > limits.maxZipDownloadBytes) throw new Error("Zip is too large.");
  const zipFile = await openZipFromBuffer(zip);
  let manifest: Buffer | undefined;
  let files = 0;
  try {
    await new Promise<void>((resolvePromise, rejectPromise) => {
      let settled = false;
      const fail = (error: unknown): void => {
        if (settled) return;
        settled = true;
        rejectPromise(error);
      };
      zipFile.on("error", fail);
      zipFile.on("end", () => {
        if (!settled) {
          settled = true;
          resolvePromise();
        }
      });
      zipFile.on("entry", (entry) => {
        try {
          files += 1;
          if (files > limits.maxFiles) throw new Error("Zip contains too many entries.");
          validateEntryMetadata(entry, limits.maxZipDownloadBytes, limits.maxIndividualFileBytes);
          const parts = entry.fileName.split("/");
          if (parts.at(-1) !== "pet.json") {
            zipFile.readEntry();
            return;
          }
          const path = validateZipEntryName(entry.fileName);
          if (path.relativeOutputPath !== "pet.json" || manifest) throw new Error("Zip contains duplicate or invalid pet.json entries.");
          if (entry.uncompressedSize > limits.maxCodexPetJsonBytes) throw new Error("pet.json is too large.");
          zipFile.openReadStream(entry, (error, stream) => {
            if (error || !stream) {
              fail(error ?? new Error("Cannot read pet.json from zip."));
              return;
            }
            const chunks: Buffer[] = [];
            let size = 0;
            stream.on("error", fail);
            stream.on("data", (chunk: Buffer) => {
              size += chunk.length;
              if (size > limits.maxCodexPetJsonBytes) {
                stream.destroy(new Error("pet.json is too large."));
                return;
              }
              chunks.push(chunk);
            });
            stream.on("end", () => {
              if (settled) return;
              if (size !== entry.uncompressedSize) {
                fail(new Error("pet.json extracted size did not match metadata."));
                return;
              }
              manifest = Buffer.concat(chunks, size);
              zipFile.readEntry();
            });
          });
        } catch (error) {
          fail(error);
        }
      });
      zipFile.readEntry();
    });
  } finally {
    zipFile.close();
  }
  if (!manifest) throw new Error("Zip is missing pet.json.");
  const value: unknown = JSON.parse(manifest.toString("utf8"));
  return typeof value === "object" && value !== null && "format" in value && value.format === "motion" ? "motion" : "classic";
}
