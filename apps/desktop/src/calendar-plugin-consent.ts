import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";

export type CalendarConsentProvider = "google" | "outlook";

const FILE_NAME = "calendar-plugin-consent.json";
const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,62}[a-z0-9]$/;

type PersistedConsent = {
  readonly version: 1;
  readonly grants: readonly { readonly pluginId: string; readonly provider: CalendarConsentProvider }[];
};

/** User-owned grants for one local profile. This file contains no credentials. */
export class CalendarPluginConsentStore {
  readonly #path: string;
  #loaded: Promise<Set<string>> | null = null;
  #writes: Promise<void> = Promise.resolve();

  constructor(userDataPath: string) {
    this.#path = join(userDataPath, FILE_NAME);
  }

  async hasAccess(pluginId: string, provider: CalendarConsentProvider): Promise<boolean> {
    const key = consentKey(pluginId, provider);
    await this.#writes;
    return (await this.#load()).has(key);
  }

  async setAccess(pluginId: string, provider: CalendarConsentProvider, enabled: boolean): Promise<void> {
    const key = consentKey(pluginId, provider);
    if (typeof enabled !== "boolean") throw new Error("Invalid calendar consent value.");

    const write = this.#writes.then(async () => {
      const grants = new Set(await this.#load());
      const hadGrant = grants.has(key);
      if (hadGrant === enabled) return;
      if (enabled) grants.add(key);
      else grants.delete(key);
      await this.#persist(grants);
      this.#loaded = Promise.resolve(grants);
    });
    this.#writes = write.catch(() => undefined);
    await write;
  }

  async clearPlugin(pluginId: string): Promise<void> {
    consentKey(pluginId, "google");
    const write = this.#writes.then(async () => {
      const grants = new Set(await this.#load());
      const prefix = `${pluginId}\u0000`;
      let changed = false;
      for (const grant of grants) {
        if (grant.startsWith(prefix)) {
          grants.delete(grant);
          changed = true;
        }
      }
      if (!changed) return;
      await this.#persist(grants);
      this.#loaded = Promise.resolve(grants);
    });
    this.#writes = write.catch(() => undefined);
    await write;
  }

  #load(): Promise<Set<string>> {
    if (!this.#loaded) this.#loaded = this.#read();
    return this.#loaded;
  }

  async #read(): Promise<Set<string>> {
    let text: string;
    try {
      text = await fs.readFile(this.#path, "utf8");
    } catch (error) {
      if (isNotFound(error)) return new Set();
      throw new Error("Calendar permission storage is unavailable.");
    }

    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw new Error("Calendar permission storage is invalid; access is disabled.");
    }
    if (!isPersistedConsent(value)) throw new Error("Calendar permission storage is invalid; access is disabled.");

    const grants = new Set<string>();
    for (const grant of value.grants) grants.add(consentKey(grant.pluginId, grant.provider));
    return grants;
  }

  async #persist(grants: ReadonlySet<string>): Promise<void> {
    const directory = dirname(this.#path);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const body: PersistedConsent = {
      version: 1,
      grants: [...grants]
        .map(parseConsentKey)
        .sort((left, right) => `${left.pluginId}:${left.provider}`.localeCompare(`${right.pluginId}:${right.provider}`)),
    };
    const temporaryPath = `${this.#path}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
    try {
      await fs.writeFile(temporaryPath, JSON.stringify(body), { encoding: "utf8", mode: 0o600, flag: "wx" });
      await fs.rename(temporaryPath, this.#path);
    } catch {
      await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
      throw new Error("Calendar permission storage could not be saved.");
    }
  }
}

function consentKey(pluginId: string, provider: CalendarConsentProvider): string {
  if (!PLUGIN_ID_PATTERN.test(pluginId) || !isProvider(provider)) throw new Error("Invalid calendar consent scope.");
  return `${pluginId}\u0000${provider}`;
}

function parseConsentKey(key: string): { pluginId: string; provider: CalendarConsentProvider } {
  const [pluginId, provider, extra] = key.split("\u0000");
  if (extra !== undefined || !pluginId || !isProvider(provider)) throw new Error("Invalid calendar consent scope.");
  return { pluginId, provider };
}

function isPersistedConsent(value: unknown): value is PersistedConsent {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.grants)) return false;
  return value.grants.every((grant) =>
    isRecord(grant)
    && typeof grant.pluginId === "string"
    && PLUGIN_ID_PATTERN.test(grant.pluginId)
    && isProvider(grant.provider),
  );
}

function isProvider(value: unknown): value is CalendarConsentProvider {
  return value === "google" || value === "outlook";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
