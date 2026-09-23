import { app } from "electron";
import { readFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { getAppStateSnapshot, isPetFlippedHorizontally, markPetBroken, resolveCompanionDisplayName, type HudScaleValue, type PetScaleValue } from "./app-state.js";
import { builtInPet } from "./built-in-pet.js";
import { readInstalledPetSpriteLayout } from "./installed-pet-layout.js";
import { getPetDir } from "./pet-paths.js";
import { getActiveLocale, getActiveLocaleLang, t } from "./i18n/index.js";
import { defaultMediaDurationMs, type OpenPetsReaction } from "./local-ipc-protocol.js";
import { pickReactionMessage } from "./reaction-messages.js";
import type { ActiveBubble } from "./plugin-bubble-arbiter.js";
import type { PluginBubbleIndicator, PluginCommandForm, PluginBubbleHud, PluginBubbleHudItem } from "./plugin-sdk-bridge.js";
import { defaultPetSprite, getConfiguredSpriteCacheKey, getConfiguredSpriteStates, resolveEffectiveSpriteState, resolveReactionSpriteState, type UniversalSpriteState } from "./reaction-animation-mapping.js";
import { createPetWindowCss, createCodexV2GazeCss, createInstalledSpriteStateCss, createSpriteStateCss, escapeCssUrl } from "./pet-window-styles.js";
import type { PetContentRender, PetPluginBubbles, PetStatusBadgeReaction, PetTransientDisplay } from "./pet-window-types.js";

export { escapeCssUrl } from "./pet-window-styles.js";

export async function createDefaultPetRenderContent(paused: boolean, display: PetTransientDisplay | null, badge: PetStatusBadgeReaction | null, dismissToken?: string, pluginBubbles: PetPluginBubbles | null = null, petDragRegion: "drag" | "no-drag" = "no-drag"): Promise<PetContentRender> {
  const installedPetRender = await tryCreateInstalledPetRender(paused, display, badge, dismissToken, pluginBubbles, petDragRegion);
  if (installedPetRender) {
    return installedPetRender;
  }

  const state = getAppStateSnapshot();
  const scale = state.preferences.petScale as PetScaleValue;
  return createBuiltInPetRender(paused, display, badge, scale, "default:builtin", state.preferences.defaultPetId, dismissToken, pluginBubbles, "default", petDragRegion);
}

function petFlipCacheToken(petId: string): string {
  return isPetFlippedHorizontally(petId) ? "flipx" : "noflip";
}

export function createBuiltInPetRender(paused: boolean, display: PetTransientDisplay | null, badge: PetStatusBadgeReaction | null, scale: PetScaleValue, cachePrefix: string, petId: string, dismissToken: string | undefined, pluginBubbles: PetPluginBubbles | null, petRole: "default" | "agent", petDragRegion: "drag" | "no-drag"): PetContentRender {
  const spriteUrl = pathToFileURL(join(app.getAppPath(), "assets", defaultPetSprite.fileName)).toString();
  const assetDisplayName = builtInPet.displayName;
  const state = getAppStateSnapshot();
  const displayName = petRole === "default"
    ? resolveCompanionDisplayName(state.preferences.personality?.petName, assetDisplayName)
    : assetDisplayName;
  const hasPinned = Boolean(pluginBubbles?.pinned);
  const isVoiceActive = petRole === "default" && display?.suppressReactionMessage === true;
  const canSubmitRecording = isVoiceActive && display?.canSubmitRecording === true;
  const bodyHtml = createPetBodyMarkup("OpenPets default pet", createBubbleMarkup(display, paused, badge, dismissToken, pluginBubbles), `<div class="sprite" role="img" aria-label="Claude animated default pet"></div>`, createPinnedBubbleMarkup(pluginBubbles), hasPinned, petRole, isVoiceActive, canSubmitRecording);
  const reactionState = getEffectiveReactionSpriteState(display?.reaction, badge);
  const waitingAnimationDurationMs = getAppStateSnapshot().preferences.waitingAnimationDurationMs;
  const hudScale = getAppStateSnapshot().preferences.hudScale as HudScaleValue;
  const stateRows = getConfiguredSpriteStates(waitingAnimationDurationMs);

  return {
    cacheKey: `${cachePrefix}:${paused}:${scale}:hud${hudScale}:${petButtonsCacheToken()}:${getConfiguredSpriteCacheKey(waitingAnimationDurationMs)}:${getActiveLocale()}:${petFlipCacheToken(petId)}`,
    bodyHtml,
    displayName,
    assetName: assetDisplayName,
    reactionState,
    codexSpriteVersion: defaultPetSprite.version,
    paused,
    flipped: isPetFlippedHorizontally(petId),
    html: `<!doctype html>
    <html lang="${getActiveLocaleLang()}" data-pet-role="${petRole}" data-pet-display-name="${escapeHtml(displayName)}" data-pet-asset-name="${escapeHtml(assetDisplayName)}" data-reaction-state="${reactionState}" data-motion-state="idle" data-native-pet-drag="${petDragRegion === "drag" ? "wayland" : "manual"}" data-flip-x="${isPetFlippedHorizontally(petId) ? "true" : "false"}" data-codex-sprite-version="${defaultPetSprite.version}" data-paused="${paused ? "true" : "false"}" data-codex-gaze-index="neutral">
      <head>
        <meta charset="utf-8" />
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src file: data:; media-src data: openpets-session-media:; connect-src openpets-session-media:; font-src file:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-src 'none'" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>OpenPets Default Pet</title>
        <style>
          ${createPetWindowCss(paused, scale, hudScale, petDragRegion)}
          .sprite {
            width: ${defaultPetSprite.frameWidth}px;
            height: ${defaultPetSprite.frameHeight}px;
            background-image: url("${escapeCssUrl(spriteUrl)}");
            background-size: ${defaultPetSprite.frameWidth * defaultPetSprite.columns}px ${defaultPetSprite.frameHeight * defaultPetSprite.rows}px;
            background-repeat: no-repeat;
            --sprite-row-y: 0px;
            --sprite-frames: ${stateRows.idle.frames};
            --sprite-duration: ${stateRows.idle.durationMs}ms;
            --sprite-iterations: ${stateRows.idle.iterations};
            background-position: 0 var(--sprite-row-y);
            animation: pet-frames var(--sprite-duration) steps(var(--sprite-frames)) var(--sprite-iterations);
            animation-play-state: var(--play-state);
            transform: scale(${scale});
            transform-origin: top left;
          }
          ${createSpriteStateCss(".sprite", stateRows, defaultPetSprite)}
          ${createCodexV2GazeCss(".sprite", defaultPetSprite)}
          @keyframes pet-frames {
            from { background-position: 0 var(--sprite-row-y); }
            to { background-position: calc(-${defaultPetSprite.frameWidth}px * var(--sprite-frames)) var(--sprite-row-y); }
          }
        </style>
      </head>
      <body>
        ${bodyHtml}
      </body>
    </html>`,
  };
}

async function tryCreateInstalledPetRender(paused: boolean, display: PetTransientDisplay | null, badge: PetStatusBadgeReaction | null, dismissToken: string | undefined, pluginBubbles: PetPluginBubbles | null, petDragRegion: "drag" | "no-drag"): Promise<PetContentRender | null> {
  const state = getAppStateSnapshot();
  const selected = state.pets.installed.find((pet) => pet.id === state.preferences.defaultPetId);

  if (!selected || selected.id === builtInPet.id || selected.broken) {
    return null;
  }

  try {
    return await createInstalledPetRender(
      selected.id,
      selected.displayName,
      paused,
      display,
      state.preferences.petScale as PetScaleValue,
      badge,
      `default:${selected.id}`,
      dismissToken,
      pluginBubbles,
      selected.source?.kind === "team" ? "team" : "personal",
      "default",
      state.preferences.personality?.petName,
       petDragRegion,
    );
  } catch (error) {
    console.error(`Failed to render installed default pet ${selected.id}; falling back to built-in pet.`, error);
    try {
      markPetBroken(selected.id, error instanceof Error ? error.message : "Installed pet rendering failed.");
    } catch (markError) {
      console.error(`Failed to mark installed pet ${selected.id} broken.`, markError);
    }
    return null;
  }
}

export async function createInstalledPetRender(
  petId: string,
  assetDisplayName: string,
  paused: boolean,
  display: PetTransientDisplay | null,
  scale: PetScaleValue,
  badge: PetStatusBadgeReaction | null,
  cachePrefix: string,
  dismissToken?: string,
  pluginBubbles: PetPluginBubbles | null = null,
  source: "personal" | "team" = "personal",
  petRole: "default" | "agent" = "default",
  personalityPetName?: string,
  petDragRegion: "drag" | "no-drag" = "no-drag",
): Promise<PetContentRender> {
  const displayName = petRole === "default"
    ? resolveCompanionDisplayName(personalityPetName ?? getAppStateSnapshot().preferences.personality?.petName, assetDisplayName)
    : assetDisplayName;
  const spritesheetPath = join(getPetDir(petId, source), "spritesheet.webp");
  const spritesheet = await stat(spritesheetPath);
  if (!spritesheet.isFile() || spritesheet.size <= 0 || spritesheet.size > 100 * 1024 * 1024) {
    throw new Error("Installed pet spritesheet is missing or too large.");
  }
  const spriteLayout = await readInstalledPetSpriteLayout(petId, source);

  const imageUrl = pathToFileURL(spritesheetPath).toString();
  const hasPinned = Boolean(pluginBubbles?.pinned);
  const isVoiceActive = petRole === "default" && display?.suppressReactionMessage === true;
  const canSubmitRecording = isVoiceActive && display?.canSubmitRecording === true;
  const bodyHtml = createPetBodyMarkup(escapeHtml(displayName), createBubbleMarkup(display, paused, badge, dismissToken, pluginBubbles), `<div class="installed-card" role="img" aria-label="${escapeHtml(displayName)}"><div class="installed-sprite"></div></div>`, createPinnedBubbleMarkup(pluginBubbles), hasPinned, petRole, isVoiceActive, canSubmitRecording);
  const reactionState = getEffectiveReactionSpriteState(display?.reaction, badge);
  const waitingAnimationDurationMs = getAppStateSnapshot().preferences.waitingAnimationDurationMs;
  const hudScale = getAppStateSnapshot().preferences.hudScale as HudScaleValue;
  const stateRows = getConfiguredSpriteStates(waitingAnimationDurationMs);

  return {
    cacheKey: `${cachePrefix}:${paused}:${scale}:hud${hudScale}:${petButtonsCacheToken()}:v${spriteLayout.version}:${spritesheet.mtimeMs}:${spritesheet.size}:${getConfiguredSpriteCacheKey(waitingAnimationDurationMs)}:${getActiveLocale()}:${petFlipCacheToken(petId)}`,
    bodyHtml,
    displayName,
    assetName: assetDisplayName,
    reactionState,
    codexSpriteVersion: spriteLayout.version,
    paused,
    flipped: isPetFlippedHorizontally(petId),
    html: `<!doctype html>
      <html lang="${getActiveLocaleLang()}" data-pet-role="${petRole}" data-pet-display-name="${escapeHtml(displayName)}" data-pet-asset-name="${escapeHtml(assetDisplayName)}" data-reaction-state="${reactionState}" data-motion-state="idle" data-native-pet-drag="${petDragRegion === "drag" ? "wayland" : "manual"}" data-flip-x="${isPetFlippedHorizontally(petId) ? "true" : "false"}" data-codex-sprite-version="${spriteLayout.version}" data-paused="${paused ? "true" : "false"}" data-codex-gaze-index="neutral">
        <head>
          <meta charset="utf-8" />
          <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src file: data:; media-src data: openpets-session-media:; connect-src openpets-session-media:; font-src file:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-src 'none'" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>OpenPets Default Pet</title>
          <style>
            ${createPetWindowCss(paused, scale, hudScale, petDragRegion)}
            .installed-card { width: ${Math.ceil(spriteLayout.frameWidth * scale)}px; height: ${Math.ceil(spriteLayout.frameHeight * scale)}px; overflow: visible; position: relative; }
            .installed-sprite {
              position: absolute;
              left: 0;
              top: 0;
              width: ${spriteLayout.frameWidth}px;
              height: ${spriteLayout.frameHeight}px;
              background-image: url("${escapeCssUrl(imageUrl)}");
              background-size: ${spriteLayout.frameWidth * spriteLayout.columns}px ${spriteLayout.frameHeight * spriteLayout.rows}px;
              background-repeat: no-repeat;
              --sprite-row-y: 0px;
              --sprite-offset-x: 0px;
              --sprite-end-offset-x: 0px;
              --sprite-frames: ${stateRows.idle.frames};
              --sprite-duration: ${stateRows.idle.durationMs}ms;
              --sprite-iterations: ${stateRows.idle.iterations};
              background-position: var(--sprite-offset-x) var(--sprite-row-y);
              animation: var(--sprite-animation, pet-frames var(--sprite-duration) steps(var(--sprite-frames)) var(--sprite-iterations));
              animation-play-state: var(--play-state);
              transform: scale(${scale});
              transform-origin: top left;
            }
            ${createInstalledSpriteStateCss(stateRows, spriteLayout)}
            @keyframes pet-frames {
              from { background-position: var(--sprite-offset-x) var(--sprite-row-y); }
              to { background-position: var(--sprite-end-offset-x) var(--sprite-row-y); }
            }
          </style>
        </head>
        <body>
          ${bodyHtml}
        </body>
      </html>`,
  };
}

/** Cache token for the assistant-button preferences baked into pet HTML. */
function petButtonsCacheToken(): string {
  const preferences = getAppStateSnapshot().preferences;
  return `btn${preferences.showChatButton ? 1 : 0}${preferences.showTalkButton ? 1 : 0}:${preferences.petButtonsPosition}:${preferences.petButtonsSize}`;
}

export function createPetBodyMarkup(
  stageLabel: string,
  bubble: string,
  spriteMarkup: string,
  pinnedBubble = "",
  hasPinned = false,
  petRole: "default" | "agent" = "default",
  isVoiceActive = false,
  canSubmitRecording = false,
): string {
  const launcherSvg = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  const talkSvg = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v1a7 7 0 0 1-14 0v-1"/><line x1="12" y1="19" x2="12" y2="22"/></svg>';
  // Only a transient bubble (which expires) suppresses the assistant buttons.
  // A pinned plugin HUD is persistent — suppressing on it would remove the
  // buttons for as long as the HUD plugin is enabled.
  const hasMessageOrBubble = Boolean(bubble.trim());
  const preferences = getAppStateSnapshot().preferences;
  const chatButton = preferences.showChatButton
    ? `<button type="button" class="openpets-companion-launcher" data-openpets-companion-launcher aria-label="Open companion chat" title="Open companion chat">${launcherSvg}</button>`
    : "";
  let talkAriaLabel = "Talk to companion";
  let talkTitle = "Talk to companion";
  let talkClass = "openpets-companion-launcher openpets-talk-button";
  let talkDisabled = "";
  if (isVoiceActive) {
    if (canSubmitRecording) {
      talkAriaLabel = "Stop recording and send";
      talkTitle = "Stop recording and send";
      talkClass = "openpets-companion-launcher openpets-talk-button is-active";
    } else {
      talkAriaLabel = "Processing...";
      talkTitle = "Processing...";
      talkClass = "openpets-companion-launcher openpets-talk-button is-processing";
      talkDisabled = ' disabled aria-disabled="true"';
    }
  }
  const showTalk = Boolean(preferences.showTalkButton || isVoiceActive);
  const talkButton = showTalk
    ? `<button type="button" class="${talkClass}" data-openpets-talk-button aria-label="${talkAriaLabel}" title="${talkTitle}"${talkDisabled}>${talkSvg}</button>`
    : "";
  const assistantButtons = (petRole === "default" && !hasMessageOrBubble && (chatButton || talkButton))
    ? `<div class="openpets-pet-buttons">${chatButton}${talkButton}</div>`
    : "";
  return `<div class="stage${hasPinned ? " has-pinned" : ""}${hasMessageOrBubble ? " has-bubble" : ""}" aria-label="${stageLabel}" data-pet-role="${petRole}">
    ${pinnedBubble}
    ${bubble}
    <div class="pet-hitbox" aria-hidden="true">
      ${assistantButtons}
      <div class="pet-shell">
        ${spriteMarkup}
      </div>
    </div>
  </div>`;
}

export function getReactionSpriteState(reaction: OpenPetsReaction | undefined): UniversalSpriteState {
  return resolveReactionSpriteState(reaction, getAppStateSnapshot().preferences.reactionAnimationOverrides);
}

function getEffectiveReactionSpriteState(displayReaction: OpenPetsReaction | undefined, badge: PetStatusBadgeReaction | null): UniversalSpriteState {
  return resolveEffectiveSpriteState(displayReaction, badge ?? undefined, getAppStateSnapshot().preferences.reactionAnimationOverrides);
}

const namedHostIconGlyphs: Record<string, string> = {
  info: "ℹ", check: "✓", alert: "⚠", heart: "💛", star: "★", bell: "🔔", coffee: "☕", timer: "⏱",
  droplet: "💧", sparkles: "✨", zap: "⚡", moon: "☾", sun: "☀", food: "🍖", play: "🎾", pause: "⏸",
};

function createHudIconMarkup(item: PluginBubbleHudItem): string {
  if (item.svgPath) {
    const svg = readSafePluginSvg(item.svgPath);
    if (svg) return svg;
  }
  if (item.iconName) {
    return escapeHtml(namedHostIconGlyphs[item.iconName] ?? "•");
  }
  return "•";
}

function createPluginHudMarkup(hud: PluginBubbleHud): string {
  const itemsHtml = hud.items.map((item) => {
    const value = Math.round(Math.max(0, Math.min(100, item.value)));
    const iconMarkup = createHudIconMarkup(item);
    const labelHtml = item.label ? `<span class="bubble-hud-item-label">${escapeHtml(item.label)}</span>` : "";
    const tone = item.tone ?? "slate";
    const ariaLabel = item.label ? ` aria-label="${escapeHtml(`${item.label} ${value}%`)}"` : "";
    return `<div class="bubble-hud-item"${ariaLabel}><div class="bubble-hud-item-icon" aria-hidden="true">${iconMarkup}</div><div class="bubble-hud-item-content"><div class="bubble-hud-item-meta">${labelHtml}</div><div class="bubble-hud-item-bar"><div class="bubble-hud-item-fill tone-${tone}" style="width:${value}%"></div></div></div></div>`;
  }).join("");
  return `<div class="bubble-hud items-${hud.items.length}">${itemsHtml}</div>`;
}

/** Render a plugin-arbiter bubble descriptor into host markup (descriptor-only — no plugin markup). */
function createPluginBubbleMarkup(active: ActiveBubble, pinned: boolean): string {
  const bubble = active.bubble;
  const token = escapeHtml(active.token);
  const toneClass = bubble.tone ? ` is-${bubble.tone}` : "";
  const accentClass = bubble.accent ? ` accent-${escapeHtml(bubble.accent)}` : "";
  const interactive = Boolean(bubble.actions?.length || bubble.input);
  const clickDismiss = bubble.dismissOn ? bubble.dismissOn.includes("click") : !interactive;
  const dismissAttr = clickDismiss ? ` data-dismiss-token="${token}"` : "";
  const parts: string[] = [];
  if (bubble.indicator) parts.push(createPluginIndicatorMarkup(bubble.indicator));
  if (bubble.iconName || bubble.svgPath || bubble.imagePath) {
    const media = bubble.svgPath || bubble.imagePath;
    if (media) parts.push(`<img class="bubble-media" src="${escapeHtml(pathToFileURL(media).toString())}" alt="" draggable="false">`);
    else if (bubble.iconName) parts.push(`<span class="bubble-plugin-icon" aria-hidden="true">${escapeHtml(namedHostIconGlyphs[bubble.iconName] ?? "•")}</span>`);
  }
  const body = bubble.markdownHtml !== undefined
    ? `<div class="bubble-body"><span class="bubble-text bubble-markdown">${bubble.markdownHtml}</span></div>`
    : bubble.text !== undefined
      ? `<div class="bubble-body"><span class="bubble-text">${escapeHtml(bubble.text)}</span></div>`
      : "";
  if (bubble.indicator && body) parts.push(`<div class="bubble-divider" aria-hidden="true"></div>`);
  if (body) parts.push(body);
  if (bubble.hud) {
    parts.push(createPluginHudMarkup(bubble.hud));
  }
  if (bubble.input) {
    const input = bubble.input;
    const inputId = escapeHtml(input.id);
    const placeholder = input.placeholder ? ` placeholder="${escapeHtml(input.placeholder)}"` : "";
    const defaultValue = input.default !== undefined ? ` value="${escapeHtml(String(input.default))}"` : "";
    const control = input.type === "select"
      ? `<select class="bubble-input-control" data-input-id="${inputId}">${(input.options ?? []).map((option) => `<option value="${escapeHtml(option.value)}"${String(input.default ?? "") === option.value ? " selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}</select>`
      : `<input class="bubble-input-control" data-input-id="${inputId}" type="${input.type === "number" ? "number" : "text"}"${placeholder}${defaultValue}>`;
    parts.push(`<div class="bubble-input" data-bubble-token="${token}">${control}<button type="button" class="bubble-action is-primary" data-bubble-submit="${token}">${escapeHtml(input.submitLabel ?? "OK")}</button></div>`);
  }
  if (bubble.actions?.length) {
    const buttons = bubble.actions.map((action) => `<button type="button" class="bubble-action is-${action.style}" data-bubble-token="${token}" data-bubble-action="${escapeHtml(action.id)}">${action.iconName ? `<span aria-hidden="true">${escapeHtml(namedHostIconGlyphs[action.iconName] ?? "")}</span> ` : ""}${escapeHtml(action.label)}</button>`).join("");
    parts.push(`<div class="bubble-actions">${buttons}</div>`);
  }
  const actionsClass = bubble.actions?.length ? " has-actions" : "";
  const hudClass = bubble.hud ? " has-hud" : "";
  return `<div class="bubble is-plugin${pinned ? " is-pinned" : ""}${actionsClass}${hudClass}${toneClass}${accentClass}" role="status" aria-live="polite"${dismissAttr} data-bubble-token="${token}">${parts.join("")}</div>`;
}

function createPluginIndicatorMarkup(indicator: PluginBubbleIndicator): string {
  const toneClass = indicator.tone ? ` is-${indicator.tone}` : " is-info";
  const style = createIndicatorStyle(indicator);
  const styleAttr = style ? ` style="${escapeHtml(style)}"` : "";
  const label = indicator.label ?? "";
  const icon = createIndicatorIconMarkup(indicator);
  return `<div class="bubble-header"><span class="bubble-status-icon${icon.hasSvg ? " has-svg" : ""}${toneClass}" data-icon="${escapeHtml(icon.glyph)}" aria-hidden="true"${styleAttr}>${icon.markup}</span>${label ? `<span class="bubble-status-label">${escapeHtml(label)}</span>` : ""}</div>`;
}

function createIndicatorIconMarkup(indicator: PluginBubbleIndicator): { glyph: string; markup: string; hasSvg: boolean } {
  if (indicator.iconSvgPath) {
    const svg = readSafePluginSvg(indicator.iconSvgPath);
    if (svg) return { glyph: "", markup: svg, hasSvg: true };
  }
  if (indicator.imagePath) return { glyph: "", markup: `<img src="${escapeHtml(pathToFileURL(indicator.imagePath).toString())}" alt="" draggable="false">`, hasSvg: true };
  if (indicator.iconName) return { glyph: namedHostIconGlyphs[indicator.iconName] ?? "•", markup: "", hasSvg: false };
  return { glyph: "", markup: "", hasSvg: false };
}

function readSafePluginSvg(path: string): string {
  try { return readFileSync(path, "utf8"); }
  catch { return ""; }
}

function createIndicatorStyle(indicator: PluginBubbleIndicator): string {
  const declarations: string[] = [];
  if (indicator.color) declarations.push(`color:${indicator.color}`);
  if (indicator.background) declarations.push(`background:${indicator.background}`);
  if (indicator.borderColor) declarations.push(`border:1px solid ${indicator.borderColor}`);
  return declarations.join(";");
}

function createPinnedBubbleMarkup(pluginBubbles: PetPluginBubbles | null): string {
  if (!pluginBubbles?.pinned) return "";
  return createPluginBubbleMarkup(pluginBubbles.pinned, true);
}

export function pluginBubblesCacheKey(pluginBubbles: PetPluginBubbles | null): string {
  if (!pluginBubbles) return "none";
  return `${pluginBubbles.transient?.token ?? "-"}:${pluginBubbles.pinned?.token ?? "-"}`;
}

export function createBubbleMarkup(display: PetTransientDisplay | null, paused: boolean, badgeReaction: PetStatusBadgeReaction | null, dismissToken?: string, pluginBubbles: PetPluginBubbles | null = null): string {
  if (pluginBubbles?.transient) return createPluginBubbleMarkup(pluginBubbles.transient, false);
  const suppressReactionMessage = display?.suppressReactionMessage === true;
  const text = display?.message ?? display?.reactionMessage ?? (!suppressReactionMessage && display?.reaction ? pickReactionMessage(display.reaction, Math.random, getActiveLocale()) : undefined) ?? (paused ? t("pet.paused") : "");
  const status = !paused && !suppressReactionMessage && badgeReaction ? getStatusBadge(badgeReaction) : null;
  const media = !paused && display?.mediaPath ? `<img class="bubble-media-preview" src="${escapeHtml(pathToFileURL(display.mediaPath).toString())}" alt="" draggable="false">` : "";
  if (!text && !status && !media) return "";
  const isExplicitMessage = Boolean(display?.message && !display?.reactionMessage);
  const className = getBubbleClassName(text, isExplicitMessage, status?.className) + (media ? " has-media" : "") + (media && display?.clickUrl ? " is-link" : "");
  const header = status ? `<div class="bubble-header"><span class="bubble-status-icon${status.iconSvg ? " has-svg" : ""}" data-icon="${escapeHtml(status.icon ?? "")}" aria-hidden="true">${status.iconSvg ?? ""}</span><span class="bubble-status-label">${escapeHtml(status.label)}</span></div>` : "";
  const divider = status && (text || media) ? `<div class="bubble-divider" aria-hidden="true"></div>` : "";
  const body = text ? `<div class="bubble-body"><span class="bubble-text">${escapeHtml(text)}</span></div>` : "";
  // Use provided dismissToken, fallback to display's dismissToken for transient messages
  const token = dismissToken ?? display?.dismissToken;
  const dismissAttr = token ? ` data-dismiss-token="${escapeHtml(token)}"` : "";
  return `<div class="${className}" role="status" aria-live="polite"${dismissAttr}>${header}${divider}${media}${body}</div>`;
}

const statusBadgeIcons = {
  check: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 6L9 17l-5-5"/></svg>',
  alert: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m21.73 18l-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3M12 9v4m0 4h.01"/></svg>',
  wavingHand: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14"><path fill="currentColor" fill-rule="evenodd" d="M4.771 1.197A.625.625 0 1 0 4.266.053a3.5 3.5 0 0 0-1.494 1.258a.625.625 0 0 0 1.04.694c.247-.37.582-.642.96-.808m8.563.739a.625.625 0 0 0-1.01.738c.244.332.399.736.427 1.18A.625.625 0 0 0 14 3.771a3.5 3.5 0 0 0-.665-1.836M2.685 7.304a.488.488 0 0 0-.904.367l.687 1.835c.229.61.566 1.173.996 1.663l.346.393a.625.625 0 1 1-.939.825l-.345-.393a6.6 6.6 0 0 1-1.228-2.05L.61 8.11a1.738 1.738 0 0 1 3.075-1.574l1.006-3.755a1.75 1.75 0 0 1 2.635-1.022a1.751 1.751 0 0 1 3.272 1.206l-.149.554a1.75 1.75 0 0 1 1.741 2.204L10.482 12.1a2.63 2.63 0 0 1-1.223 1.594l-.385.222a.625.625 0 1 1-.625-1.082l.385-.223c.316-.182.547-.483.64-.835l1.71-6.377a.5.5 0 0 0-.968-.26l-.758 2.828a.625.625 0 0 1-1.207-.323l.758-2.828l.582-2.175a.5.5 0 0 0-.967-.259l-.35 1.305L7.2 6.949a.625.625 0 0 1-1.207-.323l.874-3.263a.5.5 0 0 0-.968-.259L4.59 7.997c.567.267 1.289.753 1.732 1.522a.625.625 0 1 1-1.082.624c-.383-.66-1.163-1.043-1.53-1.15l-.033-.008a.62.62 0 0 1-.419-.372z" clip-rule="evenodd"/></svg>',
} as const;

function getStatusBadge(reaction: PetStatusBadgeReaction): { readonly className: string; readonly icon?: string; readonly iconSvg?: string; readonly label: string } | null {
  if (reaction === "thinking") return { className: "is-busy", icon: "", label: t("pet.status.thinking") };
  if (reaction === "working" || reaction === "running") return { className: "is-busy", icon: "", label: t("pet.status.working") };
  if (reaction === "editing") return { className: "is-busy", icon: "", label: t("pet.status.editing") };
  if (reaction === "testing") return { className: "is-busy", icon: "", label: t("pet.status.testing") };
  if (reaction === "waiting") return { className: "is-waiting", icon: "", label: t("pet.status.waiting") };
  if (reaction === "success" || reaction === "celebrating") return { className: "is-success", iconSvg: statusBadgeIcons.check, label: t("pet.status.done") };
  if (reaction === "error") return { className: "is-error", iconSvg: statusBadgeIcons.alert, label: t("pet.status.oops") };
  if (reaction === "waving") return { className: "is-info", iconSvg: statusBadgeIcons.wavingHand, label: t("pet.status.hi") };
  return null;
}

function getBubbleClassName(text: string, isExplicitMessage: boolean, statusClassName: string | undefined): string {
  const statusClass = statusClassName ? ` ${statusClassName}` : "";
  if (!text) return `bubble is-status-only${statusClass}`;
  if (!statusClassName) return `bubble is-message-only${isExplicitMessage ? getBubbleLengthClass(text) : ""}`;
  const lengthClass = text.length > 95 ? " is-very-long-message" : text.length > 56 ? " is-long-message" : "";
  return `bubble is-message${statusClass}${lengthClass}`;
}

function getBubbleLengthClass(text: string): string {
  return text.length > 95 ? " is-very-long-message" : text.length > 56 ? " is-long-message" : "";
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
