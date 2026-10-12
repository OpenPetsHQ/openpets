import { app, ipcMain, type WebContents } from "electron";
import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { warn } from "./logger.js";

/**
 * Serves sprite sheet bytes to pet-window renderers for pixel-accurate hit
 * testing (`pet-alpha-hit-test.ts`). Renderers cannot read `file://` images
 * into a canvas without tainting it, so the main process reads the file and
 * the renderer decodes the bytes into an origin-clean blob.
 */

/** Mirrors the sprite sheet size cap enforced when rendering installed pets. */
const MAX_SPRITE_BYTES = 100 * 1024 * 1024;
const allowedSpriteExtensions = new Set([".png", ".webp", ".jpg", ".jpeg", ".gif"]);

const trackedWebContents = new Set<WebContents>();
let handlerRegistered = false;

/** Allows a pet window's renderer to request sprite bytes until it is destroyed. */
export function trackPetSpriteBytesWebContents(contents: WebContents): void {
  trackedWebContents.add(contents);
  contents.once("destroyed", () => {
    trackedWebContents.delete(contents);
  });
  ensureHandler();
}

function isAllowedSpritePath(filePath: string): boolean {
  const resolved = resolve(filePath);
  const roots = [resolve(join(app.getAppPath(), "assets")), resolve(app.getPath("userData"))];
  return roots.some((root) => resolved === root || resolved.startsWith(`${root}${sep}`));
}

function ensureHandler(): void {
  if (handlerRegistered) return;
  handlerRegistered = true;

  ipcMain.handle("openpets:pet-sprite-bytes", async (event, url: unknown) => {
    if (!trackedWebContents.has(event.sender)) return null;
    if (typeof url !== "string" || !url.startsWith("file://")) return null;

    let filePath: string;
    try {
      filePath = fileURLToPath(url);
    } catch {
      return null;
    }
    if (!allowedSpriteExtensions.has(extname(filePath).toLowerCase())) return null;
    if (!isAllowedSpritePath(filePath)) {
      warn("pet.window", "sprite bytes request outside allowed roots", { filePath });
      return null;
    }

    try {
      const info = await stat(filePath);
      if (!info.isFile() || info.size <= 0 || info.size > MAX_SPRITE_BYTES) return null;
      return await readFile(filePath);
    } catch {
      return null;
    }
  });
}
