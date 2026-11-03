import React, { useEffect, useRef, useState } from "react";
import type { AnnouncementSnapshot } from "../../../announcements-contract.js";
import { AnnouncementsModal } from "./AnnouncementsModal.js";

export type AnnouncementsApi = {
  getAnnouncements(): Promise<AnnouncementSnapshot>;
  dismissAnnouncement(id: string): Promise<void>;
  openAnnouncementLink(id: string): Promise<void>;
};

const pollIntervalMs = 60 * 1000;
const showDelayMs = 600;
const maxTimeoutMs = 2_147_483_647;

function logAnnouncement(event: string, fields: Record<string, unknown>): void {
  console.info(`[ControlCenterAnnouncements] ${JSON.stringify({ event, ...fields })}`);
}

export function AnnouncementsHost({
  api,
  whatsNewSettled,
}: {
  api: AnnouncementsApi;
  whatsNewSettled: boolean;
}) {
  const [snapshot, setSnapshot] = useState<AnnouncementSnapshot | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const handledIds = useRef(new Set<string>());
  const busy = useRef(false);
  const generation = useRef(0);
  const mounted = useRef(false);
  const announcement = snapshot?.announcement ?? null;
  const isOpen = announcement !== null && openId === announcement.id;

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    mounted.current = true;

    const check = async () => {
      const requestGeneration = generation.current;
      try {
        const next = await api.getAnnouncements();
        if (!cancelled && !busy.current && requestGeneration === generation.current) {
          const expiresAt = next.announcement?.expiresAt;
          if (expiresAt && Date.parse(expiresAt) <= Date.now()) {
            setSnapshot(null);
            setOpenId(null);
          } else {
            setSnapshot(next);
            setOpenId((current) => current === next.announcement?.id ? current : null);
          }
        }
      } catch (error) {
        if (!cancelled) {
          console.error(`[ControlCenterAnnouncements] fetch failed: ${String(error)}`);
        }
      } finally {
        if (!cancelled) timer = setTimeout(() => void check(), pollIntervalMs);
      }
    };

    void check();
    return () => {
      cancelled = true;
      mounted.current = false;
      if (timer) clearTimeout(timer);
    };
  }, [api]);

  useEffect(() => {
    if (!announcement || !snapshot?.unseen || !whatsNewSettled || isOpen || handledIds.current.has(announcement.id)) return;
    const id = announcement.id;
    const timer = setTimeout(() => {
      handledIds.current.add(id);
      logAnnouncement("auto-shown", { id });
      setOpenId(id);
    }, showDelayMs);
    return () => clearTimeout(timer);
  }, [announcement?.id, snapshot?.unseen, whatsNewSettled, isOpen]);

  useEffect(() => {
    if (!announcement?.expiresAt) return;
    const id = announcement.id;
    const expiresAt = Date.parse(announcement.expiresAt);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      const remaining = expiresAt - Date.now();
      if (remaining <= 0) {
        logAnnouncement("expired", { id });
        setSnapshot((current) => current?.announcement?.id === id && current.announcement.expiresAt === announcement.expiresAt ? null : current);
        setOpenId((current) => current === id ? null : current);
        return;
      }
      timer = setTimeout(schedule, Math.min(remaining, maxTimeoutMs));
    };
    schedule();
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [announcement?.id, announcement?.expiresAt]);

  const handleAction = async (reason: "close" | "cta") => {
    if (!announcement || busy.current) return;
    const id = announcement.id;
    busy.current = true;
    generation.current += 1;
    setIsBusy(true);
    try {
      if (reason === "cta") {
        try {
          await api.openAnnouncementLink(id);
          logAnnouncement("cta-clicked", { id });
        } catch (error) {
          console.error(`[ControlCenterAnnouncements] open link failed: ${String(error)}`);
          return;
        }
      }

      handledIds.current.add(id);
      try {
        await api.dismissAnnouncement(id);
        logAnnouncement("dismissed", { id, reason });
        if (mounted.current) {
          setSnapshot((current) => current?.announcement?.id === id ? { ...current, unseen: false } : current);
        }
      } catch (error) {
        console.error(`[ControlCenterAnnouncements] dismiss failed: ${String(error)}`);
      }
      if (mounted.current) setOpenId((current) => current === id ? null : current);
    } finally {
      generation.current += 1;
      busy.current = false;
      if (mounted.current) setIsBusy(false);
    }
  };

  if (!announcement) return null;

  return (
    <>
      <AnnouncementsModal
        isOpen={isOpen && whatsNewSettled}
        announcement={announcement}
        isBusy={isBusy}
        onClose={() => void handleAction("close")}
        onCta={() => void handleAction("cta")}
      />

      {whatsNewSettled && !isOpen && (
        <aside aria-label="Special Event Campaign" className="announcement-reopen-banner-wrap">
          <div className={`announcement-reopen-banner theme-${announcement.theme}`}>
            <div className="announcement-reopen-content">
              <span className="announcement-reopen-badge">✨ {announcement.eyebrow}</span>
              <span className="announcement-reopen-title">{announcement.title}</span>
            </div>
            <div className="announcement-reopen-actions">
              <button
                type="button"
                className="announcement-reopen-btn"
                onClick={() => {
                  handledIds.current.add(announcement.id);
                  setOpenId(announcement.id);
                }}
              >
                See what’s new
              </button>
            </div>
          </div>
        </aside>
      )}
    </>
  );
}
