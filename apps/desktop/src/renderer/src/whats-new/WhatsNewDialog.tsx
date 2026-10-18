import React, { useEffect, useState } from "react";

import { useI18n } from "../i18n.js";
import { AccessibleDialog } from "../components/ui/AccessibleDialog.js";
import { Button } from "../components/ui/Button.js";
import { SpriteFrame, builtInPetSpritesheetUrl } from "../components/PetSprite.js";
import { catalogV2SpriteLayout } from "../pet-preview-state.js";

// One-time "What's new" dialog shown when Control Center opens after an update.
// The main process owns the changelog, version selection, and the seen marker
// (see src/whats-new.ts); this view only renders what it is given and reports
// dismissal. Links are opened by id so the renderer never chooses a URL.

export type WhatsNewItem = {
  readonly titleKey: string;
  readonly bodyKey: string;
  readonly image?: string;
};

export type WhatsNewLink = {
  readonly id: string;
  readonly labelKey: string;
  readonly emphasis: "primary" | "secondary";
};

export type WhatsNewEntry = {
  readonly version: string;
  readonly headlineKey: string;
  readonly summaryKey: string;
  readonly items: readonly WhatsNewItem[];
  readonly chipKeys?: readonly string[];
  readonly showcase?: "built-in-pet";
  readonly links: readonly WhatsNewLink[];
};

export type PendingWhatsNew = {
  readonly currentVersion: string;
  readonly entries: readonly WhatsNewEntry[];
};

export type WhatsNewApi = {
  getWhatsNew(): Promise<PendingWhatsNew | null>;
  markWhatsNewSeen(): Promise<void>;
  openWhatsNewLink(version: string, linkId: string): Promise<void>;
};

// Let Control Center paint its first view before the dialog pops in.
const showDelayMs = 350;

// Static class list so Tailwind keeps every tone (see DESIGN.md, static purge).
const chipToneClasses = [
  "whats-new-chip-purple",
  "whats-new-chip-blue",
  "whats-new-chip-orange",
  "whats-new-chip-red",
  "whats-new-chip-yellow",
] as const;

const bundledImagePattern = /^[a-z0-9][a-z0-9._-]{0,80}\.(?:png|webp|jpg|jpeg|svg)$/u;

function logWhatsNew(event: string, fields: Record<string, unknown>): void {
  console.info(`[ControlCenterWhatsNew] ${JSON.stringify({ event, ...fields })}`);
}

export function WhatsNewHost({ api }: { api: WhatsNewApi }) {
  const [pending, setPending] = useState<PendingWhatsNew | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    api.getWhatsNew()
      .then((result) => {
        if (cancelled || !result || result.entries.length === 0) return;
        timer = setTimeout(() => {
          logWhatsNew("shown", { versions: result.entries.map((entry) => entry.version) });
          setPending(result);
          setIsOpen(true);
        }, showDelayMs);
      })
      .catch((error: unknown) => {
        console.error(`[ControlCenterWhatsNew] load failed: ${String(error)}`);
      });

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [api]);

  function dismiss(reason: string): void {
    setIsOpen(false);
    logWhatsNew("dismissed", { reason });
    api.markWhatsNewSeen().catch((error: unknown) => {
      console.error(`[ControlCenterWhatsNew] mark seen failed: ${String(error)}`);
    });
  }

  function openLink(version: string, linkId: string): void {
    api.openWhatsNewLink(version, linkId).catch((error: unknown) => {
      console.error(`[ControlCenterWhatsNew] open link failed: ${String(error)}`);
    });
    dismiss(`link:${linkId}`);
  }

  if (!pending) return null;

  return (
    <WhatsNewDialog
      isOpen={isOpen}
      pending={pending}
      onClose={() => dismiss("close")}
      onOpenLink={openLink}
    />
  );
}

export function WhatsNewDialog({
  isOpen,
  pending,
  onClose,
  onOpenLink,
}: {
  isOpen: boolean;
  pending: PendingWhatsNew;
  onClose: () => void;
  onOpenLink: (version: string, linkId: string) => void;
}) {
  const { t } = useI18n();
  const newest = pending.entries[0];
  if (!newest) return null;

  return (
    <AccessibleDialog
      isOpen={isOpen}
      onClose={onClose}
      titleId="whats-new-title"
      className="whats-new-dialog"
    >
      <div className="whats-new-head">
        <p className="eyebrow m-0">{t("whatsNew.eyebrow")}</p>
        <button type="button" className="whats-new-close" aria-label={t("whatsNew.closeAria")} onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </div>

      {pending.entries.map((entry, index) => (
        <WhatsNewEntrySection
          key={entry.version}
          entry={entry}
          isNewest={index === 0}
          onOpenLink={onOpenLink}
        />
      ))}

      <div className="whats-new-footer">
        <Button variant="secondary" size="compact" onClick={onClose}>{t("whatsNew.dismiss")}</Button>
      </div>
    </AccessibleDialog>
  );
}

function WhatsNewEntrySection({
  entry,
  isNewest,
  onOpenLink,
}: {
  entry: WhatsNewEntry;
  isNewest: boolean;
  onOpenLink: (version: string, linkId: string) => void;
}) {
  const { t } = useI18n();
  const headline = t(entry.headlineKey);
  const headingId = isNewest ? "whats-new-title" : `whats-new-title-${entry.version}`;

  return (
    <section className={`whats-new-entry ${isNewest ? "" : "whats-new-entry-older"}`} aria-labelledby={headingId}>
      <div className="whats-new-hero">
        {entry.showcase === "built-in-pet" && (
          <div className="whats-new-stage" aria-hidden="true">
            <span className="whats-new-sparkle whats-new-sparkle-a" />
            <span className="whats-new-sparkle whats-new-sparkle-b" />
            <span className="whats-new-sparkle whats-new-sparkle-c" />
            <SpriteFrame
              src={builtInPetSpritesheetUrl}
              label={t("whatsNew.showcaseLabel")}
              spriteLayout={catalogV2SpriteLayout}
              state="wave"
            />
          </div>
        )}
        <div className="whats-new-hero-text">
          <span className="whats-new-version">{t("whatsNew.version", { version: entry.version })}</span>
          <h2 id={headingId}>{headline}</h2>
          <p className="whats-new-summary">{t(entry.summaryKey)}</p>
          {entry.chipKeys && entry.chipKeys.length > 0 && (
            <ul className="whats-new-chips" aria-label={t("whatsNew.chipsLabel")}>
              {entry.chipKeys.map((chipKey, chipIndex) => (
                <li key={chipKey} className={`whats-new-chip ${chipToneClasses[chipIndex % chipToneClasses.length]}`}>
                  {t(chipKey)}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {entry.items.length > 0 && (
        <ul className="whats-new-items">
          {entry.items.map((item) => (
            <WhatsNewItemRow key={item.titleKey} item={item} />
          ))}
        </ul>
      )}

      {entry.links.length > 0 && (
        <div className="whats-new-links">
          {entry.links
            .filter((link) => link.emphasis === "secondary")
            .map((link) => (
              <Button key={link.id} variant="secondary" size="compact" onClick={() => onOpenLink(entry.version, link.id)} icon={<ExternalIcon />} iconPosition="right">
                {t(link.labelKey)}
              </Button>
            ))}
          {entry.links
            .filter((link) => link.emphasis === "primary")
            .map((link) => (
              <Button key={link.id} variant="primary" size="compact" onClick={() => onOpenLink(entry.version, link.id)} icon={<ExternalIcon />} iconPosition="right">
                {t(link.labelKey)}
              </Button>
            ))}
        </div>
      )}
    </section>
  );
}

function WhatsNewItemRow({ item }: { item: WhatsNewItem }) {
  const { t } = useI18n();
  const image = item.image && bundledImagePattern.test(item.image) ? `whats-new/${item.image}` : undefined;

  return (
    <li className="whats-new-item">
      <span className="whats-new-item-mark" aria-hidden="true" />
      <div className="min-w-0">
        <strong>{t(item.titleKey)}</strong>
        <small>{t(item.bodyKey)}</small>
        {image && <img className="whats-new-item-image" src={image} alt="" draggable="false" />}
      </div>
    </li>
  );
}

function ExternalIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  );
}
