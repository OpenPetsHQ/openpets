import { app, ipcMain, type WebContents } from "electron";
import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { extname, join, sep } from "node:path";
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

const canonicalRootCache = new Map<string, string>();

async function canonicalRoot(root: string): Promise<string | null> {
  const cached = canonicalRootCache.get(root);
  if (cached) return cached;
  try {
    const canonical = await realpath(root);
    canonicalRootCache.set(root, canonical);
    return canonical;
  } catch {
    return null;
  }
}

/**
 * Containment must be decided on canonical paths: `resolve()` is purely
 * lexical, so a symlink inside userData could otherwise point a "confined"
 * sprite request at an arbitrary file. Roots are canonicalized too (macOS
 * resolves paths such as /var through /private/var).
 */
async function resolveAllowedSpritePath(filePath: string): Promise<string | null> {
  let canonical: string;
  try {
    canonical = await realpath(filePath);
  } catch {
    return null;
  }
  const roots = await Promise.all([
    canonicalRoot(join(app.getAppPath(), "assets")),
    canonicalRoot(app.getPath("userData")),
  ]);
  const allowed = roots.some((root) => root !== null && (canonical === root || canonical.startsWith(`${root}${sep}`)));
  return allowed ? canonical : null;
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
    const canonical = await resolveAllowedSpritePath(filePath);
    if (!canonical) {
      warn("pet.window", "sprite bytes request outside allowed roots", { filePath });
      return null;
    }
    if (!allowedSpriteExtensions.has(extname(canonical).toLowerCase())) return null;

    // O_NOFOLLOW keeps the canonical containment decision honest: the final
    // component cannot be swapped for a symlink between the check and the read.
    try {
      const handle = await open(canonical, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const info = await handle.stat();
        if (!info.isFile() || info.size <= 0 || info.size > MAX_SPRITE_BYTES) return null;
        return await handle.readFile();
      } finally {
        await handle.close();
      }
    } catch {
      return null;
    }
  });
}
