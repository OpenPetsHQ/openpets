import defaultThumbUrl from "../../../../assets/default-pet-thumbnail.png";
import { buildPetSpritePreviewModel, type PetSpriteLayout } from "../pet-preview-state.js";

// Pet images and animated sprite frames shared by Control Center views. Only
// allow-listed image sources render; anything else falls back to the default thumbnail.

function isAllowedCatalogPreview(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.hostname === "openpets.dev" &&
      url.port === "" &&
      url.username === "" &&
      url.password === "" &&
      url.pathname.startsWith("/pets/") &&
      url.pathname.endsWith(".webp");
  } catch {
    return false;
  }
}

function isAllowedCodexPreview(value: string | undefined): value is string {
  return typeof value === "string" && /^openpets-codex:\/\/spritesheet\/[a-zA-Z0-9%][a-zA-Z0-9%_-]{0,128}$/u.test(value);
}

function isAllowedInstalledPetPreview(value: string | undefined): value is string {
  return typeof value === "string" && /^openpets-installed:\/\/spritesheet\/[a-zA-Z0-9%][a-zA-Z0-9%_-]{0,128}$/u.test(value);
}

function isAllowedDefaultPetPreview(value: string | undefined): value is string {
  return typeof value === "string" && /^openpets-pet-preview:\/\/spritesheet\/default\?v=[a-z0-9_-]+-\d+-\d+$/u.test(value);
}

function isAllowedDataUrl(value: string | undefined): value is string {
  return typeof value === "string" && /^data:image\/(?:png|webp|jpeg|jpg);base64,[a-z0-9+/=]+$/iu.test(value);
}

export function safePetImage(value: string | undefined): string | undefined {
  return isAllowedCatalogPreview(value) || isAllowedCodexPreview(value) || isAllowedInstalledPetPreview(value) || isAllowedDefaultPetPreview(value) || isAllowedDataUrl(value) ? value : undefined;
}

export function installedPetSpritesheetUrl(petId: string): string {
  return `openpets-installed://spritesheet/${encodeURIComponent(petId)}`;
}

export function imageDebug(value: string | undefined): string {
  if (!value) return "missing";
  if (value.startsWith("data:image/")) return `data:${value.slice(5, 16)}`;
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.hostname}${url.pathname}`;
  } catch {
    return "invalid-url";
  }
}

export function logPetsEvent(event: string, fields: Record<string, unknown>): void {
  console.info(`[ControlCenterPets] ${JSON.stringify({ event, ...fields })}`);
}

function logPetsError(event: string, fields: Record<string, unknown>): void {
  console.error(`[ControlCenterPets] ${JSON.stringify({ event, ...fields })}`);
}

const spriteFrameSizes = {
  thumb: { width: 54, height: 58 },
  detail: { width: 144, height: 156 },
  mini: { width: 56, height: 61 },
} as const;

const spriteStates = {
  idle: { row: 0, frames: 6, duration: "1.65s" },
  thinking: { row: 8, frames: 6, duration: "1.55s" },
  wave: { row: 3, frames: 4, duration: "1.25s" },
  happy: { row: 4, frames: 5, duration: "1.35s" },
} as const;

export function SpriteFrame({ src, label, spriteLayout, state = "idle", size = "detail" }: { src?: string; label: string; spriteLayout?: PetSpriteLayout; state?: "idle" | "thinking" | "happy" | "wave"; size?: "thumb" | "detail" | "mini" }) {
  const safeSrc = safePetImage(src);
  if (!safeSrc) return <img src={defaultThumbUrl} alt="" />;
  const frame = spriteFrameSizes[size];
  const sprite = spriteStates[state];
  const preview = buildPetSpritePreviewModel(spriteLayout, sprite, state === "idle");
  const xValues = preview.frameColumns.map((column) => String(-column * frame.width)).join(";");
  const x = -(preview.frameColumns[0] ?? 0) * frame.width;
  const y = -preview.row * frame.height;
  return <svg className={`sprite-frame sprite-${state} sprite-${size}`} width={frame.width} height={frame.height} viewBox={`0 0 ${frame.width} ${frame.height}`} role="img" aria-label={label}>
    <image href={safeSrc} x={x} y={y} width={frame.width * preview.atlasColumns} height={frame.height * preview.atlasRows} preserveAspectRatio="none" onError={() => logPetsError("sprite-failed", { label, state, size, src: imageDebug(safeSrc) })}>
      {preview.animated && <animate attributeName="x" values={xValues} dur={sprite.duration} repeatCount="indefinite" calcMode="discrete" />}
    </image>
  </svg>;
}

export function PetImage({ src, alt = "", debugLabel }: { src?: string; alt?: string; debugLabel: string }) {
  const safeSrc = safePetImage(src) || defaultThumbUrl;
  return <img src={safeSrc} alt={alt} draggable="false" onError={() => logPetsError("image-failed", { label: debugLabel, src: imageDebug(safeSrc) })} />;
}
