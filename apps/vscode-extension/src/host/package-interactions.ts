import { isAbsolute } from "node:path";
import * as vscode from "vscode";
import type { InstalledPetView } from "../protocol.js";
import { studioUrl } from "./studio-links.js";

export interface PackageInteractions {
  pickZip(): Promise<string | undefined>;
  confirmReplacement(details: {
    displayName: string;
    assetId: string;
    targeted: boolean;
    replacingLocal: boolean;
  }): Promise<boolean>;
  openStudio(
    intent: "pet" | "outfit",
    pet?: Pick<InstalledPetView, "id" | "source" | "wardrobeSource" | "hasLocalWardrobeOverride">,
  ): Promise<void>;
}

export function createPackageInteractions(): PackageInteractions {
  return {
    async pickZip() {
      const selection = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        filters: { "ZIP archives": ["zip"] },
      });
      if (!selection || selection.length === 0) return undefined;
      const uri = selection[0];
      if (
        selection.length !== 1 ||
        uri.scheme !== "file" ||
        uri.authority !== "" ||
        uri.query ||
        uri.fragment ||
        !isAbsolute(uri.fsPath)
      ) {
        throw new Error("Select a local ZIP file.");
      }
      return uri.fsPath;
    },
    async confirmReplacement(details) {
      const warning = details.replacingLocal
        ? " Local customizations in the current package will be replaced."
        : "";
      const result = await vscode.window.showWarningMessage(
        `Replace the package for ${details.displayName}?`,
        {
          modal: true,
          detail: `The complete ZIP replaces this package and updates available outfits for all instances of this pet.${warning}`,
        },
        "Replace package",
      );
      return result === "Replace package";
    },
    async openStudio(intent, pet) {
      const opened = await vscode.env.openExternal(
        vscode.Uri.parse(studioUrl(intent, pet)),
      );
      if (!opened)
        throw new Error("Could not open OpenPets Studio in your browser.");
    },
  };
}
