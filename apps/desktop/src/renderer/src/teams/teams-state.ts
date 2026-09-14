import type { PermissionTone, TeamPluginEntry, TeamsSnapshot } from "./teams-types.js";

export function emptyTeamsSnapshot(): TeamsSnapshot {
  return {
    enrolled: false,
    organizationId: null,
    organizationName: null,
    pendingEnrollment: false,
    installationId: null,
    pendingRevision: 0,
    appliedRevision: 0,
    teamPets: [],
    teamPlugins: [],
  };
}
export function isTeamsSnapshot(value: unknown): value is TeamsSnapshot {
  if (!value || typeof value !== "object") return false;
  const raw = value as Partial<TeamsSnapshot>;
  return (
    typeof raw.enrolled === "boolean" &&
    typeof raw.pendingEnrollment === "boolean" &&
    typeof raw.pendingRevision === "number" &&
    typeof raw.appliedRevision === "number" &&
    Array.isArray(raw.teamPets) &&
    Array.isArray(raw.teamPlugins)
  );
}

export type DisplayNameValidationResult =
  | { readonly ok: true; readonly name: string }
  | { readonly ok: false; readonly error: string };

export function validateDisplayName(name: string): DisplayNameValidationResult {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: "Please enter a display name for this computer." };
  }
  if (trimmed.length > 120) {
    return { ok: false, error: "Display name must be 120 characters or fewer." };
  }
  return { ok: true, name: trimmed };
}

export function formatDate(isoString?: string): string {
  if (!isoString) return "Never";
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return "Never";
    return date.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "Never";
  }
}

export type FormattedTeamsError = {
  readonly title: string;
  readonly description: string;
  readonly isPermissionBlock: boolean;
  readonly canRetry: boolean;
};

export function formatTeamsError(errorCodeOrMessage?: string): FormattedTeamsError | null {
  if (!errorCodeOrMessage) return null;

  const normalized = errorCodeOrMessage.trim();

  if (
    normalized === "permission_blocked" ||
    normalized.toLowerCase().includes("permission approval is required") ||
    normalized.toLowerCase().includes("permission")
  ) {
    return {
      title: "Permission Approval Required",
      description:
        "One or more team plugins require local permission approval. Review and approve requested permissions below to enable them on this machine.",
      isPermissionBlock: true,
      canRetry: true,
    };
  }

  if (normalized === "secure_storage_unavailable") {
    return {
      title: "Secure Storage Unavailable",
      description:
        "Teams device authentication requires secure system credential storage (such as OS Keychain or Secret Service), which is currently unavailable.",
      isPermissionBlock: false,
      canRetry: true,
    };
  }

  if (normalized === "stage_failed") {
    return {
      title: "Download & Verification Failed",
      description:
        "Unable to download or verify the latest Team Pack artifacts from the server. Check your network connection and try again.",
      isPermissionBlock: false,
      canRetry: true,
    };
  }

  if (normalized === "apply_failed") {
    return {
      title: "Activation Failed",
      description:
        "Unable to activate team pets or plugins on this machine. An existing file or conflicting ID may be preventing installation.",
      isPermissionBlock: false,
      canRetry: true,
    };
  }

  if (normalized === "remove_failed") {
    return {
      title: "Removal Failed",
      description:
        "Failed to cleanly remove retired team pets or plugins during synchronization.",
      isPermissionBlock: false,
      canRetry: true,
    };
  }

  if (normalized === "sync_failed") {
    return {
      title: "Sync Failed",
      description:
        "Could not reach the Teams API server to fetch the latest organization configuration.",
      isPermissionBlock: false,
      canRetry: true,
    };
  }

  if (normalized === "leave_failed") {
    return {
      title: "Disconnection Warning",
      description:
        "Could not notify the remote Teams server when leaving. Local team pets and plugins have been removed.",
      isPermissionBlock: false,
      canRetry: false,
    };
  }

  return {
    title: "Sync Issue",
    description: normalized,
    isPermissionBlock: false,
    canRetry: true,
  };
}

const PERMISSION_LABELS: Record<string, string> = {
  "pet:speak": "Speech",
  "pet:reaction": "Reactions",
  "pet:move": "Movement",
  timer: "Timers",
  schedule: "Schedule",
  storage: "Storage",
  status: "Status",
  commands: "Commands",
  network: "Network",
  "pet:interact": "Bubble Buttons",
  "pet:pin": "Pinned Bubble",
  "pet:animate": "Custom Animation",
  "pet:speak:dynamic": "AI Speech",
  "pet:drop": "Drag & Drop",
  "pets:read": "Read Pets",
  "pets:manage": "Manage Pets",
  audio: "Sound",
  events: "Events",
  "ui:toast": "Toasts",
  "ui:panel": "Panels",
  "ui:delivery": "Deliveries",
  notify: "Notifications",
  bus: "Plugin Bus",
  ai: "AI Gateway",
  secrets: "Secrets",
  "voice:speak": "Voice Output",
  "voice:listen": "Microphone",
  auth: "Authentication",
  files: "File System",
  "system:openExternal": "Open Links",
  "system:metrics": "System Metrics",
  clipboard: "Clipboard",
  "network:write": "Network Write",
  "network:local": "Local Network",
};

const PERMISSION_DESCRIPTIONS: Record<string, string> = {
  "pet:speak": "Displays speech bubbles and dialogues from your pet",
  "pet:reaction": "Triggers pet reactions and emotion animations",
  "pet:move": "Moves companion window position across displays",
  timer: "Sets countdown timers and reminder alarms",
  schedule: "Runs scheduled automation and recurring tasks",
  storage: "Stores plugin settings and configuration locally",
  status: "Displays state icons and status badges on companion",
  commands: "Registers interactive custom quick actions",
  network: "Makes outbound network and API requests",
  "network:write": "Sends HTTP POST/PUT/DELETE requests to remote endpoints",
  "network:local": "Connects to local LAN devices or localhost services",
  "pet:interact": "Adds interactive action buttons inside speech bubbles",
  "pet:pin": "Pins speech bubbles to keep them visible",
  "pet:animate": "Plays custom companion animation sequences",
  "pet:speak:dynamic": "Generates dynamic AI speech dialogue",
  "pet:drop": "Receives dragged files and dropped text",
  "pets:read": "Views active pets and companion statuses",
  "pets:manage": "Spawns or dismisses companion pets",
  audio: "Plays sound effects and audio clips",
  events: "Listens to application and system events",
  "ui:toast": "Shows desktop toast notifications",
  "ui:panel": "Opens companion UI panels and views",
  "ui:delivery": "Delivers interactive courier items and cards",
  notify: "Sends system desktop notifications",
  bus: "Communicates with other installed plugins",
  ai: "Queries local or connected AI inference models",
  secrets: "Accesses encrypted credentials and secrets storage",
  "voice:speak": "Generates synthesized voice speech output",
  "voice:listen": "Listens to microphone audio for voice commands",
  auth: "Handles plugin sign-in and authentication tokens",
  files: "Reads or writes files on your file system",
  "system:openExternal": "Opens links in your default web browser",
  "system:metrics": "Reads local CPU and system performance metrics",
  clipboard: "Reads and writes text to your system clipboard",
};

const SENSITIVE_PERMISSIONS = new Set<string>([
  "voice:listen",
  "clipboard",
  "pet:speak:dynamic",
  "network:local",
  "files",
  "secrets",
]);

export function getPermissionLabel(permission: string, t?: (key: string) => string): string {
  if (t) {
    const key = `plugins.permission.${permission}`;
    const translated = t(key);
    if (translated && translated !== key) {
      return translated;
    }
  }
  return PERMISSION_LABELS[permission] || permission;
}

export function getPermissionDescription(permission: string): string {
  return PERMISSION_DESCRIPTIONS[permission] || `Requests access to ${permission}`;
}

export function isSensitivePermission(permission: string): boolean {
  return SENSITIVE_PERMISSIONS.has(permission);
}

export type { PermissionTone } from "./teams-types.js";

export function getPermissionTone(permission: string): PermissionTone {
  if (isSensitivePermission(permission)) {
    return "red";
  }
  if (
    permission === "network" ||
    permission === "network:write" ||
    permission === "network:local" ||
    permission === "files"
  ) {
    return "orange";
  }
  return "blue";
}

export const statusPillToneClass: Record<PermissionTone, string> = {
  blue: "pill-blue",
  orange: "pill-orange",
  red: "pill-red",
  slate: "pill-slate",
};

export function countPendingPluginApprovals(plugins: readonly TeamPluginEntry[]): number {
  return plugins.filter((plugin) => Boolean(plugin.permissionBlocked)).length;
}
