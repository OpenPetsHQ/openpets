import { promises as fs } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";

const PROFILE_FILE = "calendar-profile.enc";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
type ProfileEncryption = Pick<typeof import("electron").safeStorage, "isAsyncEncryptionAvailable" | "encryptStringAsync" | "decryptStringAsync" | "getSelectedStorageBackend">;

/** Host-only local-profile identity. The plaintext bearer is never returned to a plugin. */
export class CalendarProfileCredentialStore {
  readonly #path: string;
  readonly #encryption: ProfileEncryption;
  readonly #platform: NodeJS.Platform;
  #pending: Promise<string> | null = null;

  constructor(userDataPath: string, encryption: ProfileEncryption, platform: NodeJS.Platform = process.platform) {
    this.#path = join(userDataPath, PROFILE_FILE);
    this.#encryption = encryption;
    this.#platform = platform;
  }

  getOrCreate(): Promise<string> {
    if (!this.#pending) {
      this.#pending = this.#loadOrCreate().finally(() => { this.#pending = null; });
    }
    return this.#pending;
  }

  async #loadOrCreate(): Promise<string> {
    if (!await this.#encryption.isAsyncEncryptionAvailable()) {
      throw new Error("Calendar connection storage is unavailable because OS encryption is disabled.");
    }
    const backend = this.#platform === "linux" ? this.#encryption.getSelectedStorageBackend() : "unknown";
    if (this.#platform === "linux" && (backend === "basic_text" || backend === "unknown")) {
      throw new Error("Calendar connection storage is unavailable because the Linux keyring is not secure.");
    }
    try {
      const encrypted = await fs.readFile(this.#path);
      return await this.#decode(encrypted);
    } catch (error) {
      if (!isNotFound(error)) throw new Error("Stored calendar profile identity cannot be read; calendar access is disabled.");
    }

    const token = randomBytes(32).toString("base64url");
    const encrypted = await this.#encryption.encryptStringAsync(token);
    await fs.mkdir(dirname(this.#path), { recursive: true });
    const tempPath = `${this.#path}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
    await fs.writeFile(tempPath, encrypted, { mode: 0o600, flag: "wx" });
    try {
      await fs.link(tempPath, this.#path);
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      const existing = await fs.readFile(this.#path);
      return await this.#decode(existing);
    } finally {
      await fs.rm(tempPath, { force: true });
    }
    return token;
  }

  async #decode(encrypted: Buffer): Promise<string> {
    let result = await this.#encryption.decryptStringAsync(encrypted);
    const shouldReEncrypt = result.shouldReEncrypt;
    if (shouldReEncrypt) result = await this.#encryption.decryptStringAsync(encrypted);
    if (!TOKEN_PATTERN.test(result.result)) throw new Error("Stored calendar profile identity is invalid.");
    if (shouldReEncrypt) {
      const replacement = await this.#encryption.encryptStringAsync(result.result);
      const tempPath = `${this.#path}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
      await fs.writeFile(tempPath, replacement, { mode: 0o600, flag: "wx" });
      try {
        await fs.rename(tempPath, this.#path);
      } finally {
        await fs.rm(tempPath, { force: true });
      }
    }
    return result.result;
  }
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function isAlreadyExists(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}
