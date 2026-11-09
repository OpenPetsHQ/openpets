import { validateCodexPetMetadata } from "./metadata.js";
import type { MotionAnimation, MotionContextReaction, MotionEventReaction, MotionPetMetadata, MotionVariant } from "./motion.js";
import type { PetPackage } from "./package-types.js";

export type { PetPackage, ValidatedPetPackage } from "./package-types.js";

const namePattern = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const clipPathPattern = /^clips\/[a-z0-9][a-z0-9_-]{0,79}\.webp$/;
const contexts = ["thinking", "working", "editing", "running", "testing", "waiting"] as const;
const events = ["waving", "success", "error", "celebrating"] as const;

export const motionMaxDecodedPixels = 40_000_000;

export function validatePetPackageMetadata(value: unknown, expectedId: string): PetPackage {
  if (isRecord(value) && value.format === "motion") {
    return { format: "motion", metadata: validateMotionMetadata(value, expectedId) };
  }
  return { format: "classic", metadata: validateCodexPetMetadata(value, expectedId) };
}

function validateMotionMetadata(value: Record<string, unknown>, expectedId: string): MotionPetMetadata {
  keys(value, ["format", "version", "id", "displayName", "description", "geometry", "clips", "animations", "bindings"], "Motion metadata");
  if (value.version !== 1) throw new Error("Unsupported Motion package version.");
  if (typeof value.id !== "string" || value.id !== expectedId || !namePattern.test(value.id) || value.id === "builtin") {
    throw new Error("Motion pet id must be valid and match its folder name.");
  }
  const displayName = text(value.displayName, 80, "displayName");
  const description = text(value.description, 500, "description");
  const geometryValue = object(value.geometry, "geometry");
  keys(geometryValue, ["width", "height", "pixelsPerUnit", "footAnchor"], "geometry");
  const width = integer(geometryValue.width, 1, 1280, "width");
  const height = integer(geometryValue.height, 1, 1280, "height");
  const pixelsPerUnit = number(geometryValue.pixelsPerUnit, 0.01, 8, "pixelsPerUnit");
  const anchor = object(geometryValue.footAnchor, "footAnchor");
  keys(anchor, ["x", "y"], "footAnchor");
  const footAnchor = { x: number(anchor.x, 0, width, "footAnchor.x"), y: number(anchor.y, 0, height, "footAnchor.y") };

  const clipsValue = object(value.clips, "clips");
  const clipEntries = entries(clipsValue, "clips", 64);
  const clips: MotionPetMetadata["clips"] = Object.create(null);
  const files = new Set<string>();
  for (const [name, raw] of clipEntries) {
    const clip = object(raw, `clip ${name}`);
    keys(clip, ["file", "frames", "playbackRate"], `clip ${name}`);
    if (typeof clip.file !== "string" || !clipPathPattern.test(clip.file) || files.has(clip.file)) throw new Error(`Invalid or duplicate Motion clip file: ${name}.`);
    files.add(clip.file);
    const frames = integer(clip.frames, 2, 240, `clip ${name} frames`);
    if (width * height * frames > motionMaxDecodedPixels) throw new Error(`Motion clip ${name} exceeds decoded pixel limit.`);
    const playbackRate = clip.playbackRate === undefined ? undefined : number(clip.playbackRate, 0.1, 4, `clip ${name} playbackRate`);
    clips[name] = { file: clip.file, frames, ...(playbackRate === undefined ? {} : { playbackRate }) };
  }

  const animationsValue = object(value.animations, "animations");
  const animations: Record<string, MotionAnimation> = Object.create(null);
  for (const [name, raw] of entries(animationsValue, "animations", 128)) {
    const animation = object(raw, `animation ${name}`);
    if (animation.play !== "loop" && animation.play !== "once") throw new Error(`Invalid playback for animation ${name}.`);
    keys(animation, animation.play === "loop" ? ["play", "intro", "loop", "outro"] : ["play", "intro", "clip", "outro"], `animation ${name}`);
    const intro = optionalReference(animation.intro, clips, `animation ${name} intro`);
    const outro = optionalReference(animation.outro, clips, `animation ${name} outro`);
    const common = { ...(intro ? { intro } : {}), ...(outro ? { outro } : {}) };
    animations[name] = animation.play === "loop"
      ? { play: "loop", loop: reference(animation.loop, clips, `animation ${name} loop`), ...common }
      : { play: "once", clip: reference(animation.clip, clips, `animation ${name} clip`), ...common };
  }

  const binding = object(value.bindings, "bindings");
  keys(binding, ["idle", "movement", "contexts", "events"], "bindings");
  const movement = object(binding.movement, "movement");
  keys(movement, ["left", "right"], "movement");
  const left = animationReference(movement.left, animations, "loop", "movement.left");
  const right = animationReference(movement.right, animations, "loop", "movement.right");
  const idle = variants(binding.idle, animations, "loop", "idle");
  const contextBindings = roleBindings(binding.contexts, contexts, animations, "loop", "contexts");
  const eventBindings = roleBindings(binding.events, events, animations, "once", "events");
  return {
    format: "motion", version: 1, id: value.id, displayName, description,
    geometry: { width, height, pixelsPerUnit, footAnchor }, clips, animations,
    bindings: { idle, movement: { left, right }, ...(contextBindings ? { contexts: contextBindings } : {}), ...(eventBindings ? { events: eventBindings } : {}) },
  };
}

function roleBindings<K extends MotionContextReaction | MotionEventReaction>(value: unknown, allowed: readonly K[], animations: Record<string, MotionAnimation>, play: "loop" | "once", label: string): Partial<Record<K, MotionVariant[]>> | undefined {
  if (value === undefined) return undefined;
  const roles = object(value, label);
  keys(roles, allowed, label);
  const result: Partial<Record<K, MotionVariant[]>> = {};
  for (const key of allowed) {
    if (roles[key] !== undefined) result[key] = variants(roles[key], animations, play, `${label}.${key}`);
  }
  return result;
}

function variants(value: unknown, animations: Record<string, MotionAnimation>, play: "loop" | "once", label: string): MotionVariant[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 32) throw new Error(`${label} must contain 1 to 32 variants.`);
  const seenAnimations = new Set<string>();
  return value.map((raw: unknown) => {
    const variant = object(raw, label);
    keys(variant, ["animation", "weight"], label);
    const animation = animationReference(variant.animation, animations, play, label);
    if (seenAnimations.has(animation)) throw new Error(`${label} contains a duplicate animation.`);
    seenAnimations.add(animation);
    const weight = variant.weight === undefined ? undefined : number(variant.weight, 0.001, 1000, `${label} weight`);
    return { animation, ...(weight === undefined ? {} : { weight }) };
  });
}

function animationReference(value: unknown, animations: Record<string, MotionAnimation>, play: "loop" | "once", label: string): string {
  const name = reference(value, animations, label);
  if (animations[name]?.play !== play) throw new Error(`${label} requires a ${play} animation.`);
  return name;
}

function reference(value: unknown, items: Record<string, unknown>, label: string): string {
  if (typeof value !== "string" || !Object.hasOwn(items, value)) throw new Error(`${label} references an unknown item.`);
  return value;
}
function optionalReference(value: unknown, items: Record<string, unknown>, label: string): string | undefined {
  return value === undefined ? undefined : reference(value, items, label);
}
function entries(value: Record<string, unknown>, label: string, max: number): [string, unknown][] {
  const result = Object.entries(value);
  if (result.length < 1 || result.length > max || result.some(([name]) => !namePattern.test(name))) throw new Error(`Invalid ${label} names or count.`);
  return result;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function object(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`);
  return value;
}
function keys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new Error(`${label} contains an unsupported field.`);
}
function number(value: unknown, min: number, max: number, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new Error(`${label} is invalid.`);
  return value;
}
function integer(value: unknown, min: number, max: number, label: string): number {
  const result = number(value, min, max, label);
  if (!Number.isSafeInteger(result)) throw new Error(`${label} must be an integer.`);
  return result;
}
function text(value: unknown, max: number, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`${label} is invalid.`);
  return value.trim();
}
