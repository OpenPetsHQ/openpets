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

/** Pattern-specific inhale/exhale cue pair: raw manifest refs in, bridge-resolved paths out. */
export interface SessionPatternCues {
  readonly inhale?: SessionAssetRef;
  readonly exhale?: SessionAssetRef;
  readonly inhaleSoundPath?: string;
  readonly exhaleSoundPath?: string;
}

export interface SessionBreathPattern {
  readonly id: string;
  readonly name: string;
  readonly hint?: string;
  readonly phases: readonly SessionBreathPhase[];
  /** Cycles per run (1–99) or null for until-stopped. */
  readonly cycles: number | null;
  /** Cues timed to this pattern; overrides the descriptor-level audio pair. */
  readonly cues?: SessionPatternCues;
}

/** Named host icons for Info cards, practice choices, and grounding steps. */
export const sessionInfoIconNames = new Set([
  "activity",
  "wind",
  "trending-down",
  "heart-pulse",
  "shield-check",
  "brain",
  "person-standing",
  "armchair",
  "calendar-check",
  "leaf",
  "sparkles",
  "timer",
  "square",
  "moon",
  "zap",
  "anchor",
  "eye",
  "hand",
  "ear",
  "flower",
  "coffee",
  "headphones",
]);

export interface SessionInfoCard {
  readonly title: string;
  readonly body: string;
  readonly url?: string;
  readonly icon?: string;
  /** Short accent line under the body (e.g. what a pattern is best for). */
  readonly detail?: string;
  /** Marks the card for the practice's current choice (e.g. the selected pattern). */
  readonly highlighted?: boolean;
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

/** Phase audio cues: raw manifest refs in, bridge-resolved paths out. */
export interface SessionAudio {
  readonly inhale?: SessionAssetRef;
  readonly exhale?: SessionAssetRef;
  readonly enabled: boolean;
  /** Absolute paths of the resolved, manifest-declared cue sounds. */
  readonly inhaleSoundPath?: string;
  readonly exhaleSoundPath?: string;
}

export interface SessionPracticeChoice {
  readonly id: string;
  readonly name: string;
  /** Named host icon shown in the practice picker. */
  readonly icon?: string;
  /** Renderer-only: inline SVG paths for `icon`, attached by the session coordinator. */
  readonly iconPaths?: string;
}

export interface SessionGroundingItem {
  readonly text: string;
  readonly guidance?: string;
}

/** One sense of a grounding run: the user notices each item at their own pace. */
export interface SessionGroundingStep {
  readonly id: string;
  /** Short track label (e.g. "See"). */
  readonly label: string;
  /** Header line (e.g. "Look around you"). */
  readonly title: string;
  /** Header guidance (e.g. "Find 5 things you can see"). */
  readonly prompt: string;
  readonly icon?: string;
  /** Renderer-only: inline SVG paths for `icon`, attached by the session coordinator. */
  readonly iconPaths?: string;
  readonly items: readonly SessionGroundingItem[];
}

export interface SessionPmrStep {
  readonly id: string;
  readonly name: string;
  readonly tenseSeconds: number;
  readonly releaseSeconds: number;
  readonly tenseLabel: string;
  readonly releaseLabel: string;
  readonly tenseCue: string;
  readonly releaseCue: string;
  readonly tenseCues?: readonly string[];
  readonly releaseCues?: readonly string[];
  /** Manifest-declared asset ref; the bridge resolves it into `tenseIllustrationPath`. */
  readonly tenseIllustration?: SessionAssetRef;
  /** Manifest-declared asset ref; the bridge resolves it into `releaseIllustrationPath`. */
  readonly releaseIllustration?: SessionAssetRef;
  /** Absolute path of the resolved, manifest-declared tense illustration SVG. */
  readonly tenseIllustrationPath?: string;
  /** Absolute path of the resolved, manifest-declared release illustration SVG. */
  readonly releaseIllustrationPath?: string;
  /** File URL for renderer display. */
  readonly tenseImageUrl?: string;
  /** File URL for renderer display. */
  readonly releaseImageUrl?: string;
}

export interface PluginBreathingSessionDescriptor {
  readonly kind: "breathing";
  readonly title: string;
  readonly subtitle?: string;
  readonly patterns: readonly SessionBreathPattern[];
  readonly patternId: string;
  readonly autoStart: boolean;
  /** Calm lead-in before the first inhale of every run (0–15 seconds). */
  readonly countdownSeconds: number;
  readonly info?: SessionInfo;
  readonly audio?: SessionAudio;
  readonly practices?: readonly SessionPracticeChoice[];
  readonly practiceId?: string;
}

export interface PluginPmrSessionDescriptor {
  readonly kind: "pmr";
  readonly title: string;
  readonly subtitle?: string;
  readonly steps: readonly SessionPmrStep[];
  readonly autoStart: boolean;
  /** Lead-in countdown before the first step (0–15 seconds). */
  readonly countdownSeconds: number;
  readonly info?: SessionInfo;
  readonly practices?: readonly SessionPracticeChoice[];
  readonly practiceId?: string;
}

/** Self-paced sensory grounding (e.g. 5-4-3-2-1): no phase clock, the user advances. */
export interface PluginGroundingSessionDescriptor {
  readonly kind: "grounding";
  readonly title: string;
  readonly subtitle?: string;
  readonly steps: readonly SessionGroundingStep[];
  readonly autoStart: boolean;
  readonly countdownSeconds: number;
  readonly info?: SessionInfo;
  readonly practices?: readonly SessionPracticeChoice[];
  readonly practiceId?: string;
}

/** One narrated piece of a player track, streamed from an approved https host. */
export interface SessionPlayerSegment {
  readonly audioUrl: string;
  /** Transcript line shown under the title while this segment plays. */
  readonly caption?: string;
}

export interface SessionPlayerTrack {
  readonly id: string;
  readonly title: string;
  readonly subtitle?: string;
  /** Manifest-declared cover image; the bridge resolves it into `coverPath`. */
  readonly cover?: SessionAssetRef;
  readonly coverPath?: string;
  /** Renderer-only: file URL for `coverPath`, attached by the session coordinator. */
  readonly coverUrl?: string;
  readonly segments: readonly SessionPlayerSegment[];
}

/**
 * Narrated media practice (guided meditation, peaceful visualization): the
 * host plays a track's segments in order with a short gap between them.
 * Audio URLs are https on the plugin's approved network hosts; the host
 * downloads and caches them and never exposes the remote origin to the pet
 * window.
 */
export interface PluginPlayerSessionDescriptor {
  readonly kind: "player";
  readonly title: string;
  readonly subtitle?: string;
  readonly tracks: readonly SessionPlayerTrack[];
  readonly trackId: string;
  readonly autoStart: boolean;
  readonly countdownSeconds: number;
  /** Silence between segments (0–10 seconds). */
  readonly segmentGapSeconds: number;
  /** Short note shown on the card, e.g. that narration is in another language. */
  readonly narrationNote?: string;
  readonly info?: SessionInfo;
  readonly practices?: readonly SessionPracticeChoice[];
  readonly practiceId?: string;
}

export type PluginSessionDescriptor =
  | PluginBreathingSessionDescriptor
  | PluginPmrSessionDescriptor
  | PluginGroundingSessionDescriptor
  | PluginPlayerSessionDescriptor;

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
  | { readonly type: "infoOpened" }
  | { readonly type: "audioToggled"; readonly enabled: boolean }
  | { readonly type: "practiceSelected"; readonly practiceId: string };

const idPattern = /^[A-Za-z0-9._:-]{1,48}$/;
const controlCharacters = /[\u0000-\u001f\u007f]/;

const maxPatterns = 12;
const maxPhases = 8;
const maxSections = 8;
const maxCitations = 8;
const maxSteps = 24;
const maxGroundingSteps = 8;
const maxGroundingItems = 6;
const maxPlayerTracks = 24;
const maxPlayerSegments = 40;

export function validateSessionDescriptor(value: unknown): PluginSessionDescriptor {
  check(isRecord(value), "Invalid session descriptor.");
  check(
    value.kind === "breathing" || value.kind === "pmr" || value.kind === "grounding" || value.kind === "player",
    "Session kind must be \"breathing\", \"pmr\", \"grounding\", or \"player\".",
  );

  const title = validateLine(value.title, 1, 60, "session title");
  const subtitle = value.subtitle === undefined ? undefined : validateLine(value.subtitle, 1, 80, "session subtitle");
  const autoStart = value.autoStart === undefined ? true : value.autoStart === true;
  let countdownSeconds = 5;
  if (value.countdownSeconds !== undefined) {
    const seconds = Number(value.countdownSeconds);
    check(Number.isFinite(seconds) && seconds >= 0 && seconds <= 15, "Session countdownSeconds must be 0–15.");
    countdownSeconds = Math.round(seconds);
  }
  const info = value.info === undefined ? undefined : validateSessionInfo(value.info);
  const practices = value.practices === undefined ? undefined : validatePractices(value.practices);
  const practiceId = value.practiceId === undefined ? undefined : validatePracticeId(value.practiceId, practices);

  if (value.kind === "breathing") {
    checkKnownKeys(value, ["kind", "title", "subtitle", "patterns", "patternId", "autoStart", "countdownSeconds", "info", "audio", "practices", "practiceId"], "breathing session descriptor");
    const patterns = validatePatterns(value.patterns);
    const patternId = value.patternId === undefined
      ? patterns[0].id
      : validateSelectedPatternId(value.patternId, patterns);
    const audio = value.audio === undefined ? undefined : validateSessionAudio(value.audio);

    return {
      kind: "breathing",
      title,
      ...(subtitle === undefined ? {} : { subtitle }),
      patterns,
      patternId,
      autoStart,
      countdownSeconds,
      ...(info === undefined ? {} : { info }),
      ...(audio === undefined ? {} : { audio }),
      ...(practices === undefined ? {} : { practices }),
      ...(practiceId === undefined ? {} : { practiceId }),
    };
  }

  if (value.kind === "player") {
    checkKnownKeys(value, ["kind", "title", "subtitle", "tracks", "trackId", "autoStart", "countdownSeconds", "segmentGapSeconds", "narrationNote", "info", "practices", "practiceId"], "player session descriptor");
    const tracks = validatePlayerTracks(value.tracks);
    let trackId = tracks[0].id;
    if (value.trackId !== undefined) {
      check(typeof value.trackId === "string" && tracks.some((track) => track.id === value.trackId), "Selected session track id is not in the track list.");
      trackId = value.trackId;
    }
    let segmentGapSeconds = 2;
    if (value.segmentGapSeconds !== undefined) {
      const gap = Number(value.segmentGapSeconds);
      check(Number.isFinite(gap) && gap >= 0 && gap <= 10, "Session segmentGapSeconds must be 0–10.");
      segmentGapSeconds = Math.round(gap * 4) / 4;
    }
    const narrationNote = value.narrationNote === undefined ? undefined : validateLine(value.narrationNote, 1, 60, "session narration note");
    return {
      kind: "player",
      title,
      ...(subtitle === undefined ? {} : { subtitle }),
      tracks,
      trackId,
      autoStart,
      countdownSeconds,
      segmentGapSeconds,
      ...(narrationNote === undefined ? {} : { narrationNote }),
      ...(info === undefined ? {} : { info }),
      ...(practices === undefined ? {} : { practices }),
      ...(practiceId === undefined ? {} : { practiceId }),
    };
  }

  if (value.kind === "grounding") {
    checkKnownKeys(value, ["kind", "title", "subtitle", "steps", "autoStart", "countdownSeconds", "info", "practices", "practiceId"], "grounding session descriptor");
    return {
      kind: "grounding",
      title,
      ...(subtitle === undefined ? {} : { subtitle }),
      steps: validateGroundingSteps(value.steps),
      autoStart,
      countdownSeconds,
      ...(info === undefined ? {} : { info }),
      ...(practices === undefined ? {} : { practices }),
      ...(practiceId === undefined ? {} : { practiceId }),
    };
  }

  // PMR
  checkKnownKeys(value, ["kind", "title", "subtitle", "steps", "autoStart", "countdownSeconds", "info", "practices", "practiceId"], "pmr session descriptor");
  const steps = validatePmrSteps(value.steps);

  return {
    kind: "pmr",
    title,
    ...(subtitle === undefined ? {} : { subtitle }),
    steps,
    autoStart,
    countdownSeconds,
    ...(info === undefined ? {} : { info }),
    ...(practices === undefined ? {} : { practices }),
    ...(practiceId === undefined ? {} : { practiceId }),
  };
}

function validatePractices(value: unknown): readonly SessionPracticeChoice[] {
  check(Array.isArray(value), "Session practices must be an array.");
  check(value.length >= 1 && value.length <= 6, "Session practices must contain 1–6 entries.");
  const seen = new Set<string>();
  const practices = value.map((entry) => {
    check(isRecord(entry), "Invalid session practice choice.");
    checkKnownKeys(entry, ["id", "name", "icon"], "session practice choice");
    check(typeof entry.id === "string" && idPattern.test(entry.id), "Invalid session practice choice id.");
    check(!seen.has(entry.id), `Duplicate session practice choice id "${entry.id}".`);
    seen.add(entry.id);
    const name = validateLine(entry.name, 1, 40, "session practice choice name");
    const icon = entry.icon === undefined ? undefined : validateIconName(entry.icon, "session practice choice icon");
    return { id: entry.id, name, ...(icon === undefined ? {} : { icon }) };
  });
  return practices;
}

function validatePracticeId(value: unknown, practices: readonly SessionPracticeChoice[] | undefined): string {
  check(typeof value === "string" && idPattern.test(value), "Invalid session practice id.");
  check(practices !== undefined && practices.some((p) => p.id === value), "Selected session practice id is not in the practices list.");
  return value;
}

function validateGroundingSteps(value: unknown): readonly SessionGroundingStep[] {
  check(Array.isArray(value), "Session steps must be an array.");
  check(value.length >= 1 && value.length <= maxGroundingSteps, `Grounding steps must contain 1–${maxGroundingSteps} entries.`);
  const seen = new Set<string>();
  return value.map((entry): SessionGroundingStep => {
    check(isRecord(entry), "Invalid grounding step.");
    checkKnownKeys(entry, ["id", "label", "title", "prompt", "icon", "items"], "grounding step");
    check(typeof entry.id === "string" && idPattern.test(entry.id), "Invalid grounding step id.");
    check(!seen.has(entry.id), `Duplicate grounding step id "${entry.id}".`);
    seen.add(entry.id);
    check(Array.isArray(entry.items), "Grounding step items must be an array.");
    check(entry.items.length >= 1 && entry.items.length <= maxGroundingItems, `Grounding step items must contain 1–${maxGroundingItems} entries.`);
    const items = entry.items.map((item): SessionGroundingItem => {
      check(isRecord(item), "Invalid grounding item.");
      checkKnownKeys(item, ["text", "guidance"], "grounding item");
      const guidance = item.guidance === undefined ? undefined : validateLine(item.guidance, 1, 120, "grounding item guidance");
      return {
        text: validateLine(item.text, 1, 80, "grounding item text"),
        ...(guidance === undefined ? {} : { guidance }),
      };
    });
    const icon = entry.icon === undefined ? undefined : validateIconName(entry.icon, "grounding step icon");
    return {
      id: entry.id,
      label: validateLine(entry.label, 1, 16, "grounding step label"),
      title: validateLine(entry.title, 1, 60, "grounding step title"),
      prompt: validateLine(entry.prompt, 1, 80, "grounding step prompt"),
      ...(icon === undefined ? {} : { icon }),
      items,
    };
  });
}

function validatePlayerTracks(value: unknown): readonly SessionPlayerTrack[] {
  check(Array.isArray(value), "Session tracks must be an array.");
  check(value.length >= 1 && value.length <= maxPlayerTracks, `Session tracks must contain 1–${maxPlayerTracks} entries.`);
  const seen = new Set<string>();
  return value.map((entry): SessionPlayerTrack => {
    check(isRecord(entry), "Invalid session track.");
    checkKnownKeys(entry, ["id", "title", "subtitle", "cover", "segments"], "session track");
    check(typeof entry.id === "string" && idPattern.test(entry.id), "Invalid session track id.");
    check(!seen.has(entry.id), `Duplicate session track id "${entry.id}".`);
    seen.add(entry.id);
    check(Array.isArray(entry.segments), "Session track segments must be an array.");
    check(entry.segments.length >= 1 && entry.segments.length <= maxPlayerSegments, `Session track segments must contain 1–${maxPlayerSegments} entries.`);
    const segments = entry.segments.map((segment): SessionPlayerSegment => {
      check(isRecord(segment), "Invalid session track segment.");
      checkKnownKeys(segment, ["audioUrl", "caption"], "session track segment");
      const caption = segment.caption === undefined ? undefined : validateText(segment.caption, 1, 400, "session segment caption");
      return {
        audioUrl: validateHttpsUrl(segment.audioUrl, "session segment audioUrl", 500),
        ...(caption === undefined ? {} : { caption }),
      };
    });
    const subtitle = entry.subtitle === undefined ? undefined : validateLine(entry.subtitle, 1, 80, "session track subtitle");
    const cover = entry.cover === undefined ? undefined : validateAssetRefShape(entry.cover, "session track cover");
    return {
      id: entry.id,
      title: validateLine(entry.title, 1, 60, "session track title"),
      ...(subtitle === undefined ? {} : { subtitle }),
      ...(cover === undefined ? {} : { cover }),
      segments,
    };
  });
}

function validateIconName(value: unknown, label: string): string {
  check(typeof value === "string" && sessionInfoIconNames.has(value), `Unknown ${label}.`);
  return value;
}

function validatePmrSteps(value: unknown): readonly SessionPmrStep[] {
  check(Array.isArray(value), "Session steps must be an array.");
  check(value.length >= 1 && value.length <= maxSteps, `Session steps must contain 1–${maxSteps} entries.`);
  const seen = new Set<string>();
  const steps = value.map((entry) => validatePmrStep(entry));
  for (const step of steps) {
    check(!seen.has(step.id), `Duplicate session step id "${step.id}".`);
    seen.add(step.id);
  }
  return steps;
}

function validatePmrStep(value: unknown): SessionPmrStep {
  check(isRecord(value), "Invalid session step.");
  checkKnownKeys(
    value,
    [
      "id",
      "name",
      "tenseSeconds",
      "releaseSeconds",
      "tenseLabel",
      "releaseLabel",
      "tenseCue",
      "releaseCue",
      "tenseCues",
      "releaseCues",
      "tenseIllustration",
      "releaseIllustration",
    ],
    "session step",
  );
  check(typeof value.id === "string" && idPattern.test(value.id), "Invalid session step id.");
  const name = validateLine(value.name, 1, 60, "session step name");

  const tenseSec = Number(value.tenseSeconds);
  check(Number.isFinite(tenseSec) && tenseSec >= 1 && tenseSec <= 30, "Session step tenseSeconds must be 1–30.");
  const tenseSeconds = Math.round(tenseSec * 4) / 4;

  const releaseSec = Number(value.releaseSeconds);
  check(Number.isFinite(releaseSec) && releaseSec >= 1 && releaseSec <= 30, "Session step releaseSeconds must be 1–30.");
  const releaseSeconds = Math.round(releaseSec * 4) / 4;

  const tenseLabel = validateLine(value.tenseLabel, 1, 24, "session step tenseLabel");
  const releaseLabel = validateLine(value.releaseLabel, 1, 24, "session step releaseLabel");
  const tenseCue = validateLine(value.tenseCue, 1, 120, "session step tenseCue");
  const releaseCue = validateLine(value.releaseCue, 1, 120, "session step releaseCue");

  const hasTenseCues = value.tenseCues !== undefined;
  const hasReleaseCues = value.releaseCues !== undefined;
  check(
    (hasTenseCues && hasReleaseCues) || (!hasTenseCues && !hasReleaseCues),
    "Session step cues must provide both tenseCues and releaseCues or neither.",
  );
  const tenseCues = hasTenseCues ? validateCues(value.tenseCues, "tenseCues") : undefined;
  const releaseCues = hasReleaseCues ? validateCues(value.releaseCues, "releaseCues") : undefined;

  const hasTense = value.tenseIllustration !== undefined;
  const hasRelease = value.releaseIllustration !== undefined;
  check(
    (hasTense && hasRelease) || (!hasTense && !hasRelease),
    "Session step illustrations must provide both tenseIllustration and releaseIllustration or neither.",
  );

  const tenseIllustration = hasTense
    ? validateAssetRefShape(value.tenseIllustration, "session step tenseIllustration")
    : undefined;
  const releaseIllustration = hasRelease
    ? validateAssetRefShape(value.releaseIllustration, "session step releaseIllustration")
    : undefined;

  return {
    id: value.id,
    name,
    tenseSeconds,
    releaseSeconds,
    tenseLabel,
    releaseLabel,
    tenseCue,
    releaseCue,
    ...(tenseCues === undefined ? {} : { tenseCues }),
    ...(releaseCues === undefined ? {} : { releaseCues }),
    ...(tenseIllustration === undefined ? {} : { tenseIllustration }),
    ...(releaseIllustration === undefined ? {} : { releaseIllustration }),
  };
}

function validateCues(value: unknown, label: string): readonly string[] {
  check(Array.isArray(value), `Session step ${label} must be an array.`);
  check(value.length >= 1 && value.length <= 4, `Session step ${label} must contain 1–4 entries.`);
  return value.map((entry, index) => validateLine(entry, 1, 80, `session step ${label}[${index}]`));
}

function validateSessionAudio(value: unknown): SessionAudio {
  check(isRecord(value), "Invalid session audio.");
  checkKnownKeys(value, ["inhale", "exhale", "enabled"], "session audio");
  return {
    inhale: validateAssetRefShape(value.inhale, "session audio inhale"),
    exhale: validateAssetRefShape(value.exhale, "session audio exhale"),
    enabled: value.enabled === undefined ? true : value.enabled === true,
  };
}

function validateAssetRefShape(value: unknown, label: string): SessionAssetRef {
  check(isRecord(value), `Invalid ${label}.`);
  checkKnownKeys(value, ["kind", "name"], label);
  check(typeof value.kind === "string" && value.kind.length <= 16, `Invalid ${label} kind.`);
  check(typeof value.name === "string" && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(value.name), `Invalid ${label} name.`);
  return { kind: value.kind, name: value.name };
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
  checkKnownKeys(value, ["id", "name", "hint", "phases", "cycles", "cues"], "session pattern");
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

  let cues: SessionPatternCues | undefined;
  if (value.cues !== undefined) {
    check(isRecord(value.cues), "Invalid session pattern cues.");
    checkKnownKeys(value.cues, ["inhale", "exhale"], "session pattern cues");
    cues = {
      inhale: validateAssetRefShape(value.cues.inhale, "session pattern cues inhale"),
      exhale: validateAssetRefShape(value.cues.exhale, "session pattern cues exhale"),
    };
  }

  return {
    id: value.id,
    name,
    ...(hint === undefined ? {} : { hint }),
    phases,
    cycles,
    ...(cues === undefined ? {} : { cues }),
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
  const logo = value.logo === undefined ? undefined : validateAssetRefShape(value.logo, "session info logo");

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
      checkKnownKeys(card, ["title", "body", "url", "icon", "detail", "highlighted"], "session info card");
      const url = card.url === undefined ? undefined : validateHttpsUrl(card.url, "session info card url");
      const icon = card.icon === undefined ? undefined : validateIconName(card.icon, "session info card icon");
      const detail = card.detail === undefined ? undefined : validateLine(card.detail, 1, 160, "session info card detail");
      if (card.highlighted !== undefined) {
        check(typeof card.highlighted === "boolean", "Invalid session info card highlighted flag.");
      }
      return {
        title: validateLine(card.title, 1, 80, "session info card title"),
        body: validateText(card.body, 1, 600, "session info card body"),
        ...(url === undefined ? {} : { url }),
        ...(icon === undefined ? {} : { icon }),
        ...(detail === undefined ? {} : { detail }),
        ...(card.highlighted === true ? { highlighted: true } : {}),
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

function validateHttpsUrl(value: unknown, label: string, maxLength = 300): string {
  check(typeof value === "string" && value.length <= maxLength, `Invalid ${label}.`);
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
