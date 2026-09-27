import { app, shell } from "electron";
import https from "node:https";

import { createParsedUpdateStatus, normalizeVersion } from "./update-version.js";

export type UpdateStatusState = "idle" | "checking" | "available" | "current" | "error";

export interface UpdateStatus {
  readonly state: UpdateStatusState;
  readonly currentVersion: string;
  readonly latestVersion?: string;
  readonly releaseUrl?: string;
  readonly checkedAt?: number;
  readonly error?: string;
}

interface GitHubReleaseResponse {
  readonly tag_name?: unknown;
  readonly name?: unknown;
  readonly html_url?: unknown;
}

const githubRepository = process.env.OPENPETS_GITHUB_REPOSITORY || "OpenPetsHQ/openpets";
const latestReleaseApiUrl = `https://api.github.com/repos/${githubRepository}/releases/latest`;
const releasesPageUrl = `https://github.com/${githubRepository}/releases`;
const releaseCheckTimeoutMs = 6_000;

let updateStatus: UpdateStatus = { state: "idle", currentVersion: getCurrentAppVersion() };
let checkInFlight: Promise<UpdateStatus> | null = null;

export function getUpdateStatus(): UpdateStatus {
  return updateStatus;
}

export async function checkForGitHubReleaseUpdate(): Promise<UpdateStatus> {
  if (checkInFlight) return checkInFlight;
  updateStatus = { ...updateStatus, state: "checking", currentVersion: getCurrentAppVersion() };
  checkInFlight = fetchLatestRelease()
    .then((release) => {
      const currentVersion = getCurrentAppVersion();
      updateStatus = createUpdateStatusFromLatestRelease(currentVersion, release, Date.now());
      return updateStatus;
    })
    .catch((error: unknown) => {
      updateStatus = createUpdateErrorStatus(getCurrentAppVersion(), error, Date.now());
      return updateStatus;
    })
    .finally(() => {
      checkInFlight = null;
    });
  return checkInFlight;
}

export async function openUpdateReleasePage(): Promise<void> {
  const url = validateGitHubReleaseUrl(updateStatus.releaseUrl) || releasesPageUrl;
  await shell.openExternal(url);
}

export function createUpdateStatusFromLatestRelease(currentVersion: string, release: GitHubReleaseResponse, checkedAt: number): UpdateStatus {
  return createParsedUpdateStatus(currentVersion, release, checkedAt, githubRepository, releasesPageUrl);
}

export function createUpdateErrorStatus(currentVersion: string, error: unknown, checkedAt: number): UpdateStatus {
  return {
    state: "error",
    currentVersion,
    checkedAt,
    error: error instanceof Error ? error.message : "Update check failed.",
  };
}

function getCurrentAppVersion(): string {
  return normalizeVersion(app.getVersion()) || "0.0.0";
}

function validateGitHubReleaseUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "github.com") return null;
    if (!url.pathname.startsWith(`/${githubRepository}/releases/`)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function fetchLatestRelease(): Promise<GitHubReleaseResponse> {
  return new Promise((resolve, reject) => {
    const request = https.get(latestReleaseApiUrl, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": `OpenPets/${getCurrentAppVersion()}`,
      },
      timeout: releaseCheckTimeoutMs,
    }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => {
        body += chunk;
        if (Buffer.byteLength(body, "utf8") > 128 * 1024) {
          request.destroy(new Error("GitHub release response is too large."));
        }
      });
      response.on("end", () => {
        if (response.statusCode === 404) {
          reject(new Error("No public OpenPets releases found yet."));
          return;
        }
        if ((response.statusCode ?? 0) < 200 || (response.statusCode ?? 0) >= 300) {
          reject(new Error(`GitHub release check failed with HTTP ${response.statusCode ?? "unknown"}.`));
          return;
        }
        try {
          resolve(JSON.parse(body) as GitHubReleaseResponse);
        } catch {
          reject(new Error("GitHub release response was not valid JSON."));
        }
      });
    });
    request.on("timeout", () => request.destroy(new Error("GitHub release check timed out.")));
    request.on("error", reject);
  });
}
