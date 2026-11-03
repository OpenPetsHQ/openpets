export interface Announcement {
  id: string;
  startsAt: string;
  expiresAt?: string;
  minVersion?: string;
  maxVersion?: string;
  priority?: number;
  theme: "halloween" | "celebration" | "update";
  eyebrow: string;
  title: string;
  body: string;
  image?: { url: string; alt: string };
  cta: { label: string; url: string };
}

export interface AnnouncementSnapshot {
  announcement: Announcement | null;
  unseen: boolean;
}
