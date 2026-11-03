import type { Announcement } from "./announcements-contract.js";
import { isVersionNewer, normalizeVersion } from "./update-version.js";

const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

export function isAnnouncementId(value: unknown): value is string {
  return typeof value === "string" && idPattern.test(value);
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

function timestamp(value: unknown): value is string {
  if (typeof value !== "string" || !timestampPattern.test(value) || !Number.isFinite(Date.parse(value))) {
    return false;
  }
  if (Number(value.slice(11, 13)) > 23) {
    return false;
  }
  const date = value.slice(0, 10);
  const [year, month, day] = date.split("-").map(Number);
  const calendar = new Date(Date.UTC(year, month - 1, day));
  return calendar.getUTCFullYear() === year && calendar.getUTCMonth() === month - 1 && calendar.getUTCDate() === day;
}

function validVersion(value: unknown): value is string {
  return typeof value === "string" && value.length <= 64 && normalizeVersion(value) === value;
}

function safeUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port &&
      (url.hostname === "openpets.dev" || url.hostname.endsWith(".openpets.dev"));
  } catch {
    return false;
  }
}

function parseAnnouncement(value: unknown): Announcement | null {
  if (!record(value) || !isAnnouncementId(value.id) || !timestamp(value.startsAt)) {
    return null;
  }
  if (value.expiresAt !== undefined &&
      (!timestamp(value.expiresAt) || Date.parse(value.expiresAt) <= Date.parse(value.startsAt))) {
    return null;
  }
  if ((value.minVersion !== undefined && !validVersion(value.minVersion)) ||
      (value.maxVersion !== undefined && !validVersion(value.maxVersion))) {
    return null;
  }
  if (typeof value.minVersion === "string" && typeof value.maxVersion === "string" &&
      isVersionNewer(value.minVersion, value.maxVersion)) {
    return null;
  }
  if (value.priority !== undefined &&
      (typeof value.priority !== "number" || !Number.isInteger(value.priority) || Math.abs(value.priority) > 100)) {
    return null;
  }
  if (value.theme !== "halloween" && value.theme !== "celebration" && value.theme !== "update") {
    return null;
  }
  if (!text(value.eyebrow, 80) || !text(value.title, 160) || !text(value.body, 2000) ||
      !record(value.cta) || !text(value.cta.label, 80) || !safeUrl(value.cta.url)) {
    return null;
  }
  if (value.image !== undefined &&
      (!record(value.image) || !safeUrl(value.image.url) || !text(value.image.alt, 240))) {
    return null;
  }
  return {
    id: value.id,
    startsAt: value.startsAt,
    theme: value.theme,
    eyebrow: value.eyebrow,
    title: value.title,
    body: value.body,
    cta: {
      label: value.cta.label,
      url: value.cta.url,
    },
    ...(typeof value.expiresAt === "string" ? { expiresAt: value.expiresAt } : {}),
    ...(typeof value.minVersion === "string" ? { minVersion: value.minVersion } : {}),
    ...(typeof value.maxVersion === "string" ? { maxVersion: value.maxVersion } : {}),
    ...(typeof value.priority === "number" ? { priority: value.priority } : {}),
    ...(record(value.image) && typeof value.image.url === "string" && typeof value.image.alt === "string"
      ? { image: { url: value.image.url, alt: value.image.alt } }
      : {}),
  };
}

export function parseAnnouncementsFeed(value: unknown): Announcement[] {
  if (!record(value) || value.schemaVersion !== 1 || !Array.isArray(value.announcements) || value.announcements.length > 50) {
    throw new Error("Invalid announcements feed.");
  }
  const result: Announcement[] = [];
  const ids = new Set<string>();
  for (const item of value.announcements) {
    const announcement = parseAnnouncement(item);
    if (!announcement || ids.has(announcement.id)) {
      throw new Error("Invalid announcement or duplicate ID.");
    }
    ids.add(announcement.id);
    result.push(announcement);
  }
  return result;
}

export function selectAnnouncement(
  announcements: readonly Announcement[],
  version: string,
  now: number,
): Announcement | null {
  if (!normalizeVersion(version)) {
    return null;
  }
  const eligible = announcements.filter((item) =>
    Date.parse(item.startsAt) <= now &&
    (!item.expiresAt || Date.parse(item.expiresAt) > now) &&
    (!item.minVersion || !isVersionNewer(item.minVersion, version)) &&
    (!item.maxVersion || !isVersionNewer(version, item.maxVersion)),
  );
  eligible.sort((a, b) =>
    (b.priority ?? 0) - (a.priority ?? 0) ||
    Date.parse(b.startsAt) - Date.parse(a.startsAt) ||
    a.id.localeCompare(b.id, "en"),
  );
  return eligible[0] ?? null;
}
