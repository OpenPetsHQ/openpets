import {
  findWhatsNewLink,
  selectPendingWhatsNew,
  type PendingWhatsNew,
  type WhatsNewEntry,
} from "./whats-new.js";

export type ControlCenterWhatsNewIpcChannel =
  | "openpets:whats-new-get"
  | "openpets:whats-new-mark-seen"
  | "openpets:whats-new-open-link";

export type ControlCenterWhatsNewIpcEvent = {
  readonly sender: { readonly id: number };
};

export type ControlCenterWhatsNewIpcHandler = (
  event: ControlCenterWhatsNewIpcEvent,
  ...args: unknown[]
) => unknown | Promise<unknown>;

export type ControlCenterWhatsNewIpcDependencies = {
  readonly registerHandle: (channel: ControlCenterWhatsNewIpcChannel, handler: ControlCenterWhatsNewIpcHandler) => void;
  readonly authorizeSender: (event: ControlCenterWhatsNewIpcEvent) => void;
  readonly entries: readonly WhatsNewEntry[];
  readonly getCurrentVersion: () => string;
  readonly getLastSeenVersion: () => string | undefined;
  readonly markSeen: (currentVersion: string) => void;
  readonly isPreviewEnabled: () => boolean;
  readonly openExternal: (url: string) => Promise<void>;
  readonly logger: {
    readonly debug: (message: string, fields?: Record<string, unknown>) => void;
  };
};

export function installControlCenterWhatsNewIpcHandlers({
  registerHandle,
  authorizeSender,
  entries,
  getCurrentVersion,
  getLastSeenVersion,
  markSeen,
  isPreviewEnabled,
  openExternal,
  logger,
}: ControlCenterWhatsNewIpcDependencies): void {
  registerHandle("openpets:whats-new-get", (event): PendingWhatsNew | null => {
    authorizeSender(event);
    const currentVersion = getCurrentVersion();
    const lastSeenVersion = getLastSeenVersion();
    const preview = isPreviewEnabled();
    const pending = selectPendingWhatsNew({
      entries,
      currentVersion,
      lastSeenVersion,
      preview,
    });
    logger.debug("what's new resolved", {
      currentVersion,
      lastSeenVersion: lastSeenVersion ?? null,
      preview,
      pendingVersions: pending?.entries.map((entry) => entry.version) ?? [],
    });
    return pending;
  });

  registerHandle("openpets:whats-new-mark-seen", (event) => {
    authorizeSender(event);
    const currentVersion = getCurrentVersion();
    markSeen(currentVersion);
    logger.debug("what's new marked seen", { currentVersion });
  });

  registerHandle("openpets:whats-new-open-link", async (event, version: unknown, linkId: unknown) => {
    authorizeSender(event);
    if (typeof version !== "string" || typeof linkId !== "string") {
      throw new Error("Invalid what's new link request.");
    }
    // Only URLs declared in the changelog can be opened; the renderer names a link, never a URL.
    const link = findWhatsNewLink(entries, version, linkId);
    if (!link) {
      throw new Error("Unknown what's new link.");
    }
    logger.debug("what's new link opened", { version, linkId });
    await openExternal(link.url);
  });
}
