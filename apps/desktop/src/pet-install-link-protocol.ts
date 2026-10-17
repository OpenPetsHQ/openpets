/**
 * Pure parser for `openpets://install?url=<zip>&name=<display name>` links,
 * emitted by the website's Pet Studio "Add to OpenPets" button.
 *
 * No Electron, filesystem, or network imports: the adapter in
 * `pet-install-link-handler.ts` owns confirmation, download, and install.
 */

export const petInstallLinkScheme = "openpets";
export const petInstallLinkHost = "install";
export const petInstallLinkMaxNameLength = 60;
/** Signed Studio download URLs are long, but a link is never a payload. */
const maxLinkLength = 4096;
const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

export type PetInstallLink = {
  /** Normalized ZIP URL (`URL.href`); fetched only after user confirmation. */
  readonly zipUrl: string;
  /** Host shown to the user and logged; never the full signed URL. */
  readonly zipHost: string;
  /** Optional display-only name; the installed pet's identity comes from pet.json. */
  readonly name: string | null;
};

export type PetInstallLinkParseResult =
  | { readonly ok: true; readonly link: PetInstallLink }
  | { readonly ok: false; readonly reason: string };

/**
 * Returns `null` when the value is not an `openpets://install` link at all, so
 * callers can keep routing other links (for example Teams enrollment). An
 * install link with a bad ZIP URL is reported as `ok: false` with a
 * user-presentable reason.
 */
export function parsePetInstallLink(value: unknown): PetInstallLinkParseResult | null {
  if (typeof value !== "string") return null;

  let link: URL;
  try {
    link = new URL(value);
  } catch {
    return null;
  }
  if (link.protocol !== `${petInstallLinkScheme}:` || link.hostname !== petInstallLinkHost) {
    return null;
  }

  if (value.length > maxLinkLength) {
    return invalid("The install link is too long.");
  }
  const hasExtraPath = link.pathname !== "" && link.pathname !== "/";
  if (hasExtraPath || link.username || link.password || link.port) {
    return invalid("The install link is not in a supported format.");
  }

  const rawZipUrl = link.searchParams.get("url");
  if (!rawZipUrl) {
    return invalid("The install link does not include a pet download URL.");
  }
  const zipUrlResult = validatePetInstallZipUrl(rawZipUrl);
  if (!zipUrlResult.ok) return zipUrlResult;

  return {
    ok: true,
    link: {
      zipUrl: zipUrlResult.url.href,
      zipHost: zipUrlResult.url.host,
      name: normalizeDisplayName(link.searchParams.get("name")),
    },
  };
}

export function findPetInstallLink(argv: readonly unknown[]): PetInstallLinkParseResult | null {
  for (const value of argv) {
    const parsed = parsePetInstallLink(value);
    if (parsed) return parsed;
  }
  return null;
}

/**
 * Throws when a ZIP URL is not acceptable for a link install. Used before the
 * download and again on the final response URL.
 */
export function assertPetInstallZipUrl(value: string): void {
  const result = validatePetInstallZipUrl(value);
  if (!result.ok) throw new Error(result.reason);
}

function validatePetInstallZipUrl(
  value: string,
): { readonly ok: true; readonly url: URL } | { readonly ok: false; readonly reason: string } {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return invalid("The pet download URL is not valid.");
  }

  if (url.username || url.password) {
    return invalid("The pet download URL cannot include credentials.");
  }

  const isHttps = url.protocol === "https:";
  const isLoopbackHttp = url.protocol === "http:" && loopbackHosts.has(url.hostname);
  if (!isHttps && !isLoopbackHttp) {
    return invalid("The pet download URL must use https.");
  }

  return { ok: true, url };
}

function normalizeDisplayName(value: string | null): string | null {
  if (value === null) return null;
  // Collapse whitespace and control characters so the dialog stays one line.
  const collapsed = value.replace(/[\s\p{Cc}]+/gu, " ").trim();
  if (collapsed.length === 0) return null;
  const characters = Array.from(collapsed);
  if (characters.length <= petInstallLinkMaxNameLength) return collapsed;
  return characters.slice(0, petInstallLinkMaxNameLength).join("").trimEnd();
}

function invalid(reason: string): { readonly ok: false; readonly reason: string } {
  return { ok: false, reason };
}
