import type { TeamsSnapshot } from "./teams-types.js";

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

export function validateDisplayName(name: string): { readonly ok: true; readonly name: string } | { readonly ok: false; readonly error: string } {
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

  if (normalized === "permission_blocked" || normalized.toLowerCase().includes("permission approval is required") || normalized.toLowerCase().includes("permission")) {
    return {
      title: "Permission Approval Required",
      description: "A team plugin requires permissions that have not yet been approved. Open the Plugins tab to review and approve permissions, then sync again.",
      isPermissionBlock: true,
      canRetry: true,
    };
  }

  if (normalized === "secure_storage_unavailable") {
    return {
      title: "Secure Storage Unavailable",
      description: "Teams device authentication requires secure system credential storage (such as OS Keychain or Secret Service), which is currently unavailable.",
      isPermissionBlock: false,
      canRetry: true,
    };
  }

  if (normalized === "stage_failed") {
    return {
      title: "Download & Verification Failed",
      description: "Unable to download or verify the latest Team Pack artifacts from the server. Check your network connection and try again.",
      isPermissionBlock: false,
      canRetry: true,
    };
  }

  if (normalized === "apply_failed") {
    return {
      title: "Activation Failed",
      description: "Unable to activate team pets or plugins on this machine. An existing file or conflicting ID may be preventing installation.",
      isPermissionBlock: false,
      canRetry: true,
    };
  }

  if (normalized === "remove_failed") {
    return {
      title: "Removal Failed",
      description: "Failed to cleanly remove retired team pets or plugins during synchronization.",
      isPermissionBlock: false,
      canRetry: true,
    };
  }

  if (normalized === "sync_failed") {
    return {
      title: "Sync Failed",
      description: "Could not reach the Teams API server to fetch the latest organization configuration.",
      isPermissionBlock: false,
      canRetry: true,
    };
  }

  if (normalized === "leave_failed") {
    return {
      title: "Disconnection Warning",
      description: "Could not notify the remote Teams server when leaving. Local team pets and plugins have been removed.",
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
