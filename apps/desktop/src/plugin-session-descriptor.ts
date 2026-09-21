/**
 * Practice session overlay descriptor — pure validation and types.
 *
 * The session overlay (SDK `ctx.ui.session`, permission `ui:session`) is a
 * host-rendered surface drawn around the default pet inside the pet window.
 * Plugins supply a declarative descriptor (patterns, phases, Info content);
 * the host owns rendering and the phase clock. This module narrows the
 * untrusted plugin value into the exact host shape.
 *
 * No imports — intentionally dependency-free so it stays unit-testable and
 * usable from validation contexts without pulling in Electron.
 */

export type SessionBreathPhaseKind = "in" | "hold" | "out";

export interface SessionBreathPhase {
  readonly kind: SessionBreathPhaseKind;
  /** Seconds, 1–30, rounded to a quarter second. */
  readonly seconds: number;
  readonly label?: string;
}

export interface SessionBreathPattern {
  readonly id: string;
  readonly name: string;
  readonly hint?: string;
  readonly phases: readonly SessionBreathPhase[];
  /** Cycles per run (1–99) or null for until-stopped. */
  readonly cycles: number | null;
}

export interface SessionInfoCard {
  readonly title: string;
  readonly body: string;
  readonly url?: string;
}

export interface SessionInfoSection {
  readonly heading: string;
  readonly body?: string;
  readonly items?: readonly string[];
  readonly cards?: readonly SessionInfoCard[];
}

export interface SessionCitation {
  readonly label: string;
  readonly url?: string;
}

/** Manifest asset reference passed through for host-side resolution. */
export interface SessionAssetRef {
  readonly kind: string;
  readonly name: string;
}

export interface SessionInfo {
  readonly intro?: string;
  readonly sections: readonly SessionInfoSection[];
  readonly citations: readonly SessionCitation[];
  readonly disclaimer?: string;
  readonly site?: { readonly label: string; readonly url: string };
  /** Raw manifest asset ref; the SDK bridge resolves it into `logoSvgPath`. */
  readonly logo?: SessionAssetRef;
  /** Absolute path of the resolved, manifest-declared logo SVG. */
  readonly logoSvgPath?: string;
}

export interface PluginSessionDescriptor {
  readonly kind: "breathing";
  readonly title: string;
  readonly subtitle?: string;
  readonly patterns: readonly SessionBreathPattern[];
  readonly patternId: string;
  readonly autoStart: boolean;
  readonly info?: SessionInfo;
}

/** Patch accepted by `ui.sessionUpdate`. */
export interface PluginSessionUpdate {
  readonly patternId?: string;
  readonly patterns?: readonly SessionBreathPattern[];
  readonly info?: SessionInfo;
}

export type SessionStopReason = "user" | "closed" | "replaced" | "plugin-stopped";

/** Events the overlay reports back to the owning plugin. */
export type PluginSessionEvent =
  | { readonly type: "started"; readonly patternId: string }
  | { readonly type: "paused"; readonly patternId: string; readonly cycle: number }
  | { readonly type: "resumed"; readonly patternId: string; readonly cycle: number }
  | { readonly type: "patternChanged"; readonly patternId: string }
  | { readonly type: "completed"; readonly patternId: string; readonly cycles: number }
  | { readonly type: "stopped"; readonly reason: SessionStopReason; readonly patternId: string; readonly cycle: number }
  | { readonly type: "infoOpened" };

const idPattern = /^[A-Za-z0-9._:-]{1,48}$/;
const controlCharacters = /[\u0000-\u001f\u007f]/;

const maxPatterns = 12;
const maxPhases = 8;
const maxSections = 8;
const maxCitations = 8;

export function validateSessionDescriptor(value: unknown): PluginSessionDescriptor {
  check(isRecord(value), "Invalid session descriptor.");
  check(value.kind === "breathing", "Session kind must be \"breathing\".");
  checkKnownKeys(value, ["kind", "title", "subtitle", "patterns", "patternId", "autoStart", "info"], "session descriptor");

  const title = validateLine(value.title, 1, 60, "session title");
  const subtitle = value.subtitle === undefined ? undefined : validateLine(value.subtitle, 1, 80, "session subtitle");
  const patterns = validatePatterns(value.patterns);
  const patternId = value.patternId === undefined
    ? patterns[0].id
    : validateSelectedPatternId(value.patternId, patterns);
  const autoStart = value.autoStart === undefined ? true : value.autoStart === true;
  const info = value.info === undefined ? undefined : validateSessionInfo(value.info);

  return {
    kind: "breathing",
    title,
    ...(subtitle === undefined ? {} : { subtitle }),
    patterns,
    patternId,
    autoStart,
    ...(info === undefined ? {} : { info }),
  };
}

export function validateSessionUpdate(value: unknown): PluginSessionUpdate {
  check(isRecord(value), "Invalid session update.");
  checkKnownKeys(value, ["patternId", "patterns", "info"], "session update");
  check(value.patternId !== undefined || value.patterns !== undefined || value.info !== undefined, "Session update is empty.");

  const patterns = value.patterns === undefined ? undefined : validatePatterns(value.patterns);
  let patternId: string | undefined;
  if (value.patternId !== undefined) {
    check(typeof value.patternId === "string" && idPattern.test(value.patternId), "Invalid session pattern id.");
    // Membership in the live pattern list is checked by the session
    // coordinator, which owns the current descriptor.
    if (patterns !== undefined) {
      patternId = validateSelectedPatternId(value.patternId, patterns);
    } else {
      patternId = value.patternId;
    }
  }
  const info = value.info === undefined ? undefined : validateSessionInfo(value.info);

  return {
    ...(patternId === undefined ? {} : { patternId }),
    ...(patterns === undefined ? {} : { patterns }),
    ...(info === undefined ? {} : { info }),
  };
}

function validatePatterns(value: unknown): readonly SessionBreathPattern[] {
  check(Array.isArray(value), "Session patterns must be an array.");
  check(value.length >= 1 && value.length <= maxPatterns, `Session patterns must contain 1–${maxPatterns} entries.`);
  const seen = new Set<string>();
  const patterns = value.map((entry) => validatePattern(entry));
  for (const pattern of patterns) {
    check(!seen.has(pattern.id), `Duplicate session pattern id "${pattern.id}".`);
    seen.add(pattern.id);
  }
  return patterns;
}

function validatePattern(value: unknown): SessionBreathPattern {
  check(isRecord(value), "Invalid session pattern.");
  checkKnownKeys(value, ["id", "name", "hint", "phases", "cycles"], "session pattern");
  check(typeof value.id === "string" && idPattern.test(value.id), "Invalid session pattern id.");
  const name = validateLine(value.name, 1, 40, "session pattern name");
  const hint = value.hint === undefined ? undefined : validateLine(value.hint, 1, 60, "session pattern hint");

  check(Array.isArray(value.phases), "Session pattern phases must be an array.");
  check(value.phases.length >= 1 && value.phases.length <= maxPhases, `Session pattern phases must contain 1–${maxPhases} entries.`);
  const phases = value.phases.map((phase) => validatePhase(phase));
  check(phases.some((phase) => phase.kind !== "hold"), "Session pattern needs at least one in/out phase.");

  let cycles: number | null = null;
  if (value.cycles !== undefined && value.cycles !== null) {
    const count = Number(value.cycles);
    check(Number.isInteger(count) && count >= 1 && count <= 99, "Session pattern cycles must be 1–99.");
    cycles = count;
  }

  return {
    id: value.id,
    name,
    ...(hint === undefined ? {} : { hint }),
    phases,
    cycles,
  };
}

function validatePhase(value: unknown): SessionBreathPhase {
  check(isRecord(value), "Invalid session phase.");
  checkKnownKeys(value, ["kind", "seconds", "label"], "session phase");
  check(value.kind === "in" || value.kind === "hold" || value.kind === "out", "Invalid session phase kind.");
  const seconds = Number(value.seconds);
  check(Number.isFinite(seconds) && seconds >= 1 && seconds <= 30, "Session phase seconds must be 1–30.");
  const label = value.label === undefined ? undefined : validateLine(value.label, 1, 60, "session phase label");
  return {
    kind: value.kind,
    seconds: Math.round(seconds * 4) / 4,
    ...(label === undefined ? {} : { label }),
  };
}

function validateSessionInfo(value: unknown): SessionInfo {
  check(isRecord(value), "Invalid session info.");
  checkKnownKeys(value, ["intro", "sections", "citations", "disclaimer", "site", "logo"], "session info");
  const intro = value.intro === undefined ? undefined : validateText(value.intro, 1, 600, "session info intro");
  check(Array.isArray(value.sections), "Session info sections must be an array.");
  check(value.sections.length >= 1 && value.sections.length <= maxSections, `Session info sections must contain 1–${maxSections} entries.`);
  const sections = value.sections.map((section) => validateInfoSection(section));

  let citations: readonly SessionCitation[] = [];
  if (value.citations !== undefined) {
    check(Array.isArray(value.citations), "Session info citations must be an array.");
    check(value.citations.length <= maxCitations, `Session info citations must contain at most ${maxCitations} entries.`);
    citations = value.citations.map((citation): SessionCitation => {
      check(isRecord(citation), "Invalid session citation.");
      checkKnownKeys(citation, ["label", "url"], "session citation");
      const url = citation.url === undefined ? undefined : validateHttpsUrl(citation.url, "session citation url");
      return {
        label: validateLine(citation.label, 1, 240, "session citation label"),
        ...(url === undefined ? {} : { url }),
      };
    });
  }

  const disclaimer = value.disclaimer === undefined ? undefined : validateText(value.disclaimer, 1, 400, "session info disclaimer");
  let site: SessionInfo["site"];
  if (value.site !== undefined) {
    check(isRecord(value.site), "Invalid session info site.");
    checkKnownKeys(value.site, ["label", "url"], "session info site");
    site = {
      label: validateLine(value.site.label, 1, 60, "session info site label"),
      url: validateHttpsUrl(value.site.url, "session info site url"),
    };
  }
  let logo: SessionAssetRef | undefined;
  if (value.logo !== undefined) {
    check(isRecord(value.logo), "Invalid session info logo.");
    checkKnownKeys(value.logo, ["kind", "name"], "session info logo");
    check(typeof value.logo.kind === "string" && value.logo.kind.length <= 16, "Invalid session info logo kind.");
    check(typeof value.logo.name === "string" && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(value.logo.name), "Invalid session info logo name.");
    logo = { kind: value.logo.kind, name: value.logo.name };
  }

  return {
    ...(intro === undefined ? {} : { intro }),
    sections,
    citations,
    ...(disclaimer === undefined ? {} : { disclaimer }),
    ...(site === undefined ? {} : { site }),
    ...(logo === undefined ? {} : { logo }),
  };
}

function validateInfoSection(value: unknown): SessionInfoSection {
  check(isRecord(value), "Invalid session info section.");
  checkKnownKeys(value, ["heading", "body", "items", "cards"], "session info section");
  const heading = validateLine(value.heading, 1, 60, "session info heading");
  const body = value.body === undefined ? undefined : validateText(value.body, 1, 2_400, "session info body");

  let items: readonly string[] | undefined;
  if (value.items !== undefined) {
    check(Array.isArray(value.items), "Session info items must be an array.");
    check(value.items.length >= 1 && value.items.length <= 8, "Session info items must contain 1–8 entries.");
    items = value.items.map((item) => validateText(item, 1, 200, "session info item"));
  }

  let cards: readonly SessionInfoCard[] | undefined;
  if (value.cards !== undefined) {
    check(Array.isArray(value.cards), "Session info cards must be an array.");
    check(value.cards.length >= 1 && value.cards.length <= 6, "Session info cards must contain 1–6 entries.");
    cards = value.cards.map((card): SessionInfoCard => {
      check(isRecord(card), "Invalid session info card.");
      checkKnownKeys(card, ["title", "body", "url"], "session info card");
      const url = card.url === undefined ? undefined : validateHttpsUrl(card.url, "session info card url");
      return {
        title: validateLine(card.title, 1, 80, "session info card title"),
        body: validateText(card.body, 1, 600, "session info card body"),
        ...(url === undefined ? {} : { url }),
      };
    });
  }

  check(body !== undefined || items !== undefined || cards !== undefined, "Session info section needs a body, items, or cards.");

  return {
    heading,
    ...(body === undefined ? {} : { body }),
    ...(items === undefined ? {} : { items }),
    ...(cards === undefined ? {} : { cards }),
  };
}

function validateSelectedPatternId(value: unknown, patterns: readonly SessionBreathPattern[]): string {
  check(typeof value === "string" && idPattern.test(value), "Invalid session pattern id.");
  check(patterns.some((pattern) => pattern.id === value), "Selected session pattern id is not in the pattern list.");
  return value;
}

function validateLine(value: unknown, min: number, max: number, label: string): string {
  check(typeof value === "string", `Invalid ${label}.`);
  const text = value.trim();
  check(text.length >= min && text.length <= max, `Invalid ${label} length.`);
  check(!controlCharacters.test(text), `Invalid ${label} characters.`);
  return text;
}

function validateText(value: unknown, min: number, max: number, label: string): string {
  check(typeof value === "string", `Invalid ${label}.`);
  const text = value.trim();
  check(text.length >= min && text.length <= max, `Invalid ${label} length.`);
  check(!/[\u0000-\u0009\u000b-\u001f\u007f]/.test(text), `Invalid ${label} characters.`);
  return text;
}

function validateHttpsUrl(value: unknown, label: string): string {
  check(typeof value === "string" && value.length <= 300, `Invalid ${label}.`);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Invalid ${label}.`);
  }
  check(parsed.protocol === "https:", `Invalid ${label} protocol.`);
  return parsed.toString();
}

function checkKnownKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  for (const key of Object.keys(value)) {
    check(allowed.includes(key), `Unknown ${label} field "${key}".`);
  }
}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
