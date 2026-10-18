/**
 * whats-new.ts — the release changelog shown once in Control Center after an
 * update, plus the pure selection rules for which entries are still unseen.
 *
 * Pure and dependency-light (no Electron, filesystem, or settings): app-state
 * owns persisting the last seen version, and the Control Center IPC adapter
 * owns opening links. Copy is referenced by i18n key so every locale renders it.
 */

import { isVersionNewer, normalizeVersion } from "./update-version.js";
import type { MessageKey } from "./i18n/catalog.js";

export interface WhatsNewItem {
  readonly titleKey: MessageKey;
  readonly bodyKey: MessageKey;
  /**
   * Optional art bundled with the renderer, as a file name under
   * `src/renderer/public/whats-new/` (for example `4.2.0-dock.webp`).
   */
  readonly image?: string;
}

export interface WhatsNewLink {
  readonly id: string;
  readonly labelKey: MessageKey;
  readonly url: string;
  readonly emphasis: "primary" | "secondary";
}

export interface WhatsNewEntry {
  readonly version: string;
  readonly headlineKey: MessageKey;
  readonly summaryKey: MessageKey;
  readonly items: readonly WhatsNewItem[];
  /** Short labels rendered as chips under the summary. */
  readonly chipKeys?: readonly MessageKey[];
  /** Animated preview of the bundled Hoodie Cat beside the headline. */
  readonly showcase?: "built-in-pet";
  /**
   * Optional full-width art under the headline, a file name under
   * `src/renderer/public/whats-new/` (same rules as {@link WhatsNewItem.image}).
   */
  readonly art?: string;
  /** i18n key describing `art` for screen readers. */
  readonly artAltKey?: MessageKey;
  readonly links: readonly WhatsNewLink[];
}

export interface PendingWhatsNew {
  readonly currentVersion: string;
  /** Newest first. */
  readonly entries: readonly WhatsNewEntry[];
}

export const whatsNewPreviewEnvVar = "OPENPETS_WHATS_NEW_PREVIEW";

export const whatsNewEntries: readonly WhatsNewEntry[] = [
  {
    version: "4.1.0",
    headlineKey: "whatsNew.v4_1_0.headline",
    summaryKey: "whatsNew.v4_1_0.summary",
    items: [
      {
        titleKey: "whatsNew.v4_1_0.contextMenu.title",
        bodyKey: "whatsNew.v4_1_0.contextMenu.body",
      },
      {
        titleKey: "whatsNew.v4_1_0.wardrobe.title",
        bodyKey: "whatsNew.v4_1_0.wardrobe.body",
      },
    ],
    chipKeys: [
      "whatsNew.v4_1_0.chip.pajamas",
      "whatsNew.v4_1_0.chip.weekend",
      "whatsNew.v4_1_0.chip.halloween",
      "whatsNew.v4_1_0.chip.winterHolidays",
      "whatsNew.v4_1_0.chip.summer",
    ],
    showcase: "built-in-pet",
    art: "4.1.0-wardrobe.webp",
    artAltKey: "whatsNew.v4_1_0.artAlt",
    links: [
      {
        id: "hoodie-cat-wardrobe",
        labelKey: "whatsNew.v4_1_0.cta.hoodieCat",
        url: "https://openpets.dev/pets/hoodie-cat-openpets",
        emphasis: "primary",
      },
      {
        id: "release-notes",
        labelKey: "whatsNew.releaseNotes",
        url: "https://github.com/OpenPetsHQ/openpets/releases/tag/v4.1.0",
        emphasis: "secondary",
      },
    ],
  },
];

export interface WhatsNewSelectionInput {
  readonly entries: readonly WhatsNewEntry[];
  readonly currentVersion: string;
  /** Undefined means an upgrade from a version that predates the dialog. */
  readonly lastSeenVersion: string | undefined;
  /** Dev preview: show every entry regardless of versions. */
  readonly preview: boolean;
}

/**
 * Entries newer than the last seen version and not newer than the running app,
 * newest first. A dev build of an older version therefore never shows the next
 * release's entry unless preview is on.
 */
export function selectPendingWhatsNew(input: WhatsNewSelectionInput): PendingWhatsNew | null {
  const pending = input.entries.filter((entry) => {
    if (input.preview) return true;

    const releasedInThisVersion = !isVersionNewer(entry.version, input.currentVersion);
    const unseen = input.lastSeenVersion === undefined || isVersionNewer(entry.version, input.lastSeenVersion);
    return releasedInThisVersion && unseen;
  });

  if (pending.length === 0) return null;

  const newestFirst = [...pending].sort((left, right) => {
    if (isVersionNewer(left.version, right.version)) return -1;
    if (isVersionNewer(right.version, left.version)) return 1;
    return 0;
  });

  return {
    currentVersion: input.currentVersion,
    entries: newestFirst,
  };
}

/** Persisted value: a normalized `major.minor.patch`, or undefined when absent/invalid. */
export function normalizeLastSeenWhatsNewVersion(value: unknown): string | undefined {
  return normalizeVersion(value) ?? undefined;
}

export interface StartupSeenVersionInput {
  readonly storedVersion: string | undefined;
  /** True when no state file existed before this launch. */
  readonly isFreshInstall: boolean;
  readonly currentVersion: string;
}

/**
 * Fresh installs record the running version as already seen so new users never
 * get a changelog. Upgrades from versions without the field keep it unset, so
 * every entry up to the running version is still pending.
 */
export function resolveStartupLastSeenWhatsNewVersion(input: StartupSeenVersionInput): string | undefined {
  if (input.storedVersion !== undefined) return input.storedVersion;
  if (!input.isFreshInstall) return undefined;
  return normalizeLastSeenWhatsNewVersion(input.currentVersion);
}

/** Marking seen never moves the recorded version backwards (e.g. after a downgrade). */
export function resolveMarkedSeenWhatsNewVersion(storedVersion: string | undefined, currentVersion: string): string | undefined {
  const current = normalizeLastSeenWhatsNewVersion(currentVersion);
  if (!current) return storedVersion;
  if (storedVersion && !isVersionNewer(current, storedVersion)) return storedVersion;
  return current;
}

export function findWhatsNewLink(entries: readonly WhatsNewEntry[], version: string, linkId: string): WhatsNewLink | undefined {
  const entry = entries.find((candidate) => candidate.version === version);
  return entry?.links.find((link) => link.id === linkId);
}

export function isWhatsNewPreviewEnabled(environment: NodeJS.ProcessEnv): boolean {
  return environment[whatsNewPreviewEnvVar] === "1";
}
