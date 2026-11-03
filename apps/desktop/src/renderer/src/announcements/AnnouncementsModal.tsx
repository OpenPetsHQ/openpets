import React, { useState } from "react";
import type { Announcement } from "../../../announcements-contract.js";
import { useI18n } from "../i18n.js";
import { AccessibleDialog } from "../components/ui/AccessibleDialog.js";
import { Button } from "../components/ui/Button.js";
import { SpriteFrame, builtInPetSpritesheetUrl } from "../components/PetSprite.js";
import { catalogV2SpriteLayout } from "../pet-preview-state.js";

export function AnnouncementsModal({
  isOpen,
  announcement,
  isBusy,
  onClose,
  onCta,
}: {
  isOpen: boolean;
  announcement: Announcement;
  isBusy: boolean;
  onClose: () => void;
  onCta: () => void;
}) {
  const { t } = useI18n();
  const [imgError, setImgError] = useState(false);

  const imageUrl = announcement.image?.url;
  const [previousImage, setPreviousImage] = useState({ id: announcement.id, url: imageUrl });
  if (previousImage.id !== announcement.id || previousImage.url !== imageUrl) {
    setPreviousImage({ id: announcement.id, url: imageUrl });
    setImgError(false);
  }

  const themeClass = `announcement-dialog-theme-${announcement.theme || "halloween"}`;

  return (
    <AccessibleDialog
      isOpen={isOpen}
      onClose={onClose}
      titleId="announcement-dialog-title"
      className={`announcement-dialog ${themeClass}`}
    >
      <div className="announcement-head">
        <span className="announcement-eyebrow">
          <span className="announcement-eyebrow-dot" aria-hidden="true" />
          {announcement.eyebrow}
        </span>
        <button
          type="button"
          className="announcement-close"
          aria-label={t("common.close")}
          onClick={onClose}
          disabled={isBusy}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </div>

      <div className="announcement-body-content">
        <div className="announcement-stage" aria-hidden="true">
          <div className="announcement-orb announcement-orb-amber" />
          <div className="announcement-orb announcement-orb-purple" />
          <span className="announcement-sparkle announcement-sparkle-1" />
          <span className="announcement-sparkle announcement-sparkle-2" />

          {imageUrl && !imgError ? (
            <div className="announcement-stage-media-wrap">
              <img
                src={imageUrl}
                alt={announcement.image?.alt || announcement.title}
                className="announcement-art"
                onError={() => setImgError(true)}
                draggable="false"
              />
            </div>
          ) : (
            <div className="announcement-pet-stage">
              <SpriteFrame
                src={builtInPetSpritesheetUrl}
                label={announcement.title}
                spriteLayout={catalogV2SpriteLayout}
                state="wave"
              />
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 pt-2">
          <h2 id="announcement-dialog-title" className="announcement-title">
            {announcement.title}
          </h2>
          <p className="announcement-desc">
            {announcement.body}
          </p>
        </div>
      </div>

      <div className="announcement-footer">
        <Button
          variant="secondary"
          size="compact"
          onClick={onClose}
          disabled={isBusy}
        >
          {t("whatsNew.dismiss")}
        </Button>
        <Button
          variant="primary"
          size="compact"
          onClick={onCta}
          disabled={isBusy}
          icon={<ExternalIcon />}
          iconPosition="right"
        >
          {announcement.cta.label}
        </Button>
      </div>
    </AccessibleDialog>
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
