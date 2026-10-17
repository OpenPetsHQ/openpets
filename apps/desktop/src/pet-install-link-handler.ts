import type { PetInstallLink, PetInstallLinkParseResult } from "./pet-install-link-protocol.js";

/**
 * Owns the `openpets://install` flow after parsing: confirm with the user,
 * download + install through the shared ZIP import path, then surface the
 * result. Electron dialogs and windows are injected by `main.ts` so this
 * module stays free of platform imports.
 */

export type PetInstallLinkDialog = {
  readonly title: string;
  readonly message: string;
  readonly detail: string;
};

export type PetInstallLinkInstallResult = {
  readonly petId: string;
  readonly displayName: string;
};

export type PetInstallLinkLogLevel = "info" | "warn" | "error";

export type PetInstallLinkHandlerDependencies = {
  /** Resolves true only when the user explicitly chose Install. */
  readonly confirmInstall: (dialog: PetInstallLinkDialog) => Promise<boolean>;
  readonly installFromZipUrl: (zipUrl: string) => Promise<PetInstallLinkInstallResult>;
  /** Refresh pet windows and reveal the new pet, like a Control Center import. */
  readonly onInstalled: (result: PetInstallLinkInstallResult) => void;
  readonly showError: (dialog: PetInstallLinkDialog) => Promise<void>;
  readonly log: (level: PetInstallLinkLogLevel, message: string, fields: Record<string, unknown>) => void;
};

export type PetInstallLinkHandler = {
  readonly handle: (parsed: PetInstallLinkParseResult) => Promise<void>;
};

export function createPetInstallLinkHandler(deps: PetInstallLinkHandlerDependencies): PetInstallLinkHandler {
  let busy = false;

  async function handle(parsed: PetInstallLinkParseResult): Promise<void> {
    if (!parsed.ok) {
      deps.log("warn", "pet install link rejected", { reason: parsed.reason });
      await deps.showError({
        title: "Can't add pet",
        message: "This OpenPets install link isn't valid.",
        detail: parsed.reason,
      });
      return;
    }

    // One link at a time: a double-clicked button must not stack dialogs or installs.
    if (busy) {
      deps.log("info", "pet install link ignored while another is in progress", {
        host: parsed.link.zipHost,
      });
      return;
    }

    busy = true;
    try {
      await confirmAndInstall(parsed.link);
    } finally {
      busy = false;
    }
  }

  async function confirmAndInstall(link: PetInstallLink): Promise<void> {
    const label = formatPetLabel(link.name);
    deps.log("info", "pet install link received", {
      host: link.zipHost,
      named: link.name !== null,
    });

    const confirmed = await deps.confirmInstall({
      title: "Add pet to OpenPets",
      message: `Add ${label} to OpenPets?`,
      detail: `It will be downloaded from ${link.zipHost}. Only install pets from sites you trust.`,
    });
    if (!confirmed) {
      deps.log("info", "pet install link cancelled", { host: link.zipHost });
      return;
    }

    let result: PetInstallLinkInstallResult;
    try {
      result = await deps.installFromZipUrl(link.zipUrl);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      deps.log("error", "pet install link failed", {
        host: link.zipHost,
        reason: reason.slice(0, 200),
      });
      await deps.showError({
        title: "Can't add pet",
        message: `${capitalize(label)} couldn't be added to OpenPets.`,
        detail: reason,
      });
      return;
    }

    deps.log("info", "pet install link succeeded", {
      host: link.zipHost,
      petId: result.petId,
    });
    deps.onInstalled(result);
  }

  return { handle };
}

function formatPetLabel(name: string | null): string {
  if (name === null) return "this pet";
  return `“${name}”`;
}

function capitalize(value: string): string {
  if (value.length === 0) return value;
  return value[0].toUpperCase() + value.slice(1);
}
