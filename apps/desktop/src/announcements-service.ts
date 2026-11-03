import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Announcement, AnnouncementSnapshot } from "./announcements-contract.js";
import { isAnnouncementId, parseAnnouncementsFeed, selectAnnouncement } from "./announcements-core.js";

const feedUrl = "https://openpets.dev/announcements/v1.json";
const maxBytes = 256 * 1024;
const ttlMs = 15 * 60 * 1000;
const preview: Announcement = {
  id: "preview-halloween",
  startsAt: "2020-01-01T00:00:00Z",
  theme: "halloween",
  eyebrow: "Preview only",
  title: "Halloween is coming",
  body: "A preview of seasonal announcements for your companions.",
  cta: {
    label: "Explore OpenPets",
    url: "https://openpets.dev/",
  },
};

export class AnnouncementsService {
  private announcements: Announcement[] = [];
  private dismissed: string[] = [];
  private lastAttempt = -Infinity;
  private pending: Promise<void> | null = null;
  private readonly statePath: string;

  constructor(private readonly options: {
    userData: string;
    version: string;
    preview: boolean;
    openExternal: (url: string) => Promise<void>;
    log: (message: string, fields?: Record<string, unknown>) => void;
    fetch?: typeof fetch;
    now?: () => number;
    timeoutMs?: number;
  }) {
    this.statePath = join(options.userData, "announcements.json");
    try {
      if (existsSync(this.statePath) && statSync(this.statePath).size <= 32 * 1024) {
        const state: unknown = JSON.parse(readFileSync(this.statePath, "utf8"));
        if (typeof state === "object" && state !== null &&
            "dismissedIds" in state && Array.isArray(state.dismissedIds)) {
          this.dismissed = [...new Set(state.dismissedIds.filter(isAnnouncementId))].slice(-200);
        }
      }
    } catch (error) {
      options.log("announcements state read failed", { error: String(error) });
    }
  }

  async get(): Promise<AnnouncementSnapshot> {
    if (this.options.preview) {
      return {
        announcement: preview,
        unseen: !this.dismissed.includes(preview.id),
      };
    }
    const now = this.now();
    if (this.pending) {
      await this.pending;
    } else if (now - this.lastAttempt >= ttlMs) {
      this.lastAttempt = now;
      this.pending = this.refresh().finally(() => {
        this.pending = null;
      });
      await this.pending;
    }
    const announcement = selectAnnouncement(this.announcements, this.options.version, this.now());
    return {
      announcement,
      unseen: announcement !== null && !this.dismissed.includes(announcement.id),
    };
  }

  async dismiss(id: string): Promise<void> {
    const current = await this.get();
    if (current.announcement?.id !== id) {
      throw new Error("Unknown announcement.");
    }
    if (this.dismissed.includes(id)) {
      return;
    }
    const next = [...this.dismissed, id].slice(-200);
    mkdirSync(this.options.userData, { recursive: true });
    const temporary = `${this.statePath}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, JSON.stringify({ dismissedIds: next }), { flag: "wx" });
      renameSync(temporary, this.statePath);
    } finally {
      if (existsSync(temporary)) {
        unlinkSync(temporary);
      }
    }
    this.dismissed = next;
  }

  async openLink(id: string): Promise<void> {
    const current = await this.get();
    if (current.announcement?.id !== id) {
      throw new Error("Unknown announcement.");
    }
    await this.options.openExternal(current.announcement.cta.url);
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private async refresh(): Promise<void> {
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const deadline = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new Error("Announcements request timed out."));
        }, this.options.timeoutMs ?? 5000);
      });
      const fetchFeed = async (): Promise<Announcement[]> => {
        const response = await (this.options.fetch ?? fetch)(feedUrl, {
          signal: controller.signal,
          redirect: "error",
        });
        if (!response.body) {
          throw new Error("Announcements request failed.");
        }
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let length = 0;
        let completed = false;
        let cancelled = false;
        const cancelReader = () => {
          if (cancelled) return;
          cancelled = true;
          // Cancellation is best effort; the original transport failure remains authoritative.
          void reader.cancel().catch((error: unknown) => {
            this.options.log("announcements response cleanup failed", { error: String(error) });
          });
        };
        controller.signal.addEventListener("abort", cancelReader, { once: true });
        try {
          if (controller.signal.aborted) {
            cancelReader();
            throw new Error("Announcements request aborted.");
          }
          if (!response.ok) {
            throw new Error("Announcements request failed.");
          }
          const declared = Number(response.headers.get("content-length"));
          if (declared > maxBytes) {
            throw new Error("Announcements response too large.");
          }
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              completed = true;
              break;
            }
            length += value.byteLength;
            if (length > maxBytes) {
              throw new Error("Announcements response too large.");
            }
            chunks.push(value);
          }
        } finally {
          controller.signal.removeEventListener("abort", cancelReader);
          if (!completed) {
            cancelReader();
          }
          reader.releaseLock();
        }
        return parseAnnouncementsFeed(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      };
      this.announcements = await Promise.race([fetchFeed(), deadline]);
      this.options.log("announcements refreshed", { count: this.announcements.length });
    } catch (error) {
      this.options.log("announcements refresh failed", { error: String(error) });
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
      controller.abort();
    }
  }
}
