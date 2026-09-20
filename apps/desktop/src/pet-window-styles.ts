import { app } from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { getAppStateSnapshot, type HudScaleValue, type PetScaleValue } from "./app-state.js";
import { getCodexV2GazeSpritePosition, getCodexPetSpritePosition, type CodexPetSpriteLayout } from "./codex-pets-core.js";
import { compactComposerGeometry } from "./pet-window-shape.js";
import { calculateChatPanelBottom, defaultPetChatPanelLayout } from "./default-pet-chat-geometry.js";
import { defaultPetSprite } from "./reaction-animation-mapping.js";
import { mirrorDirectionalSpriteState, motionToSpriteState, type PetMotionState, type SpriteStateDefinition, type UniversalSpriteState } from "./reaction-animation-mapping.js";

export function createPetWindowCss(paused: boolean, scale: PetScaleValue, hudScale: HudScaleValue, petDragRegion: "drag" | "no-drag"): string {
  const opacity = paused ? "0.62" : "1";
  const playState = paused ? "paused" : "running";
  const scaledWidth = Math.ceil(defaultPetSprite.frameWidth * scale);
  const scaledHeight = Math.ceil(defaultPetSprite.frameHeight * scale);
  const petBottom = 22;
  const hitPadding = 28;
  const bubbleBottom = Math.ceil(petBottom + scaledHeight + 8);
  const compactComposerBottom = Math.ceil(petBottom + scaledHeight + compactComposerGeometry.bottomGap);
  const chatPanelBottom = calculateChatPanelBottom(scaledHeight, petBottom, defaultPetChatPanelLayout.gap);
  // The pet and transient bubbles are lifted above the pinned plugin bubble
  // (HUD); the lift grows with the HUD's own scale so they never overlap.
  const pinnedLift = Math.round(28 * hudScale);
  const buttonPreferences = getAppStateSnapshot().preferences;
  const petButtonsSide = buttonPreferences.petButtonsPosition === "left" ? "left" : "right";
  const petButtonSizePx = buttonPreferences.petButtonsSize === "small" ? 18 : buttonPreferences.petButtonsSize === "large" ? 28 : 22;
  const petButtonIconPx = Math.round(petButtonSizePx * 0.55);
  const emojiFontUrl = pathToFileURL(join(app.getAppPath(), "assets", "NotoColorEmoji.ttf")).toString();
  const petShellFilter = process.platform === "win32" ? "none" : "drop-shadow(0 10px 12px rgba(15, 23, 42, 0.24)) drop-shadow(0 2px 3px rgba(15, 23, 42, 0.18))";
  const bubbleBackdropFilter = process.platform === "win32" ? "none" : "blur(10px)";
  return `
    @font-face { font-family: "OpenPets Emoji"; src: url("${escapeCssUrl(emojiFontUrl)}") format("truetype"); font-display: block; }
    :root { color-scheme: dark; --pet-opacity: ${opacity}; --play-state: ${playState}; }
    html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: transparent; user-select: none; -webkit-font-smoothing: antialiased; }
    html { color: #172033; }
    body { -webkit-app-region: no-drag; pointer-events: none; }
    .stage { width: 100%; height: 100%; position: relative; box-sizing: border-box; overflow: visible; }
    .openpets-pet-buttons { position: absolute; ${petButtonsSide}: 12px; top: 4px; z-index: 5; display: flex; flex-direction: column; gap: 4px; pointer-events: auto; -webkit-app-region: no-drag; }
    .openpets-companion-launcher { width: ${petButtonSizePx}px; height: ${petButtonSizePx}px; padding: 0; border: 1px solid rgba(255, 255, 255, 0.92); border-radius: 50%; background: linear-gradient(135deg, rgba(255, 255, 255, 0.98) 0%, rgba(239, 246, 255, 0.94) 100%); color: #2563eb; box-shadow: 0 2px 8px rgba(15, 23, 42, 0.14), 0 1px 2px rgba(15, 23, 42, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.95); display: flex; align-items: center; justify-content: center; cursor: pointer; pointer-events: auto; -webkit-app-region: no-drag; transition: transform 140ms cubic-bezier(0.16, 1, 0.3, 1), box-shadow 140ms ease, color 140ms ease, background 140ms ease; }
    .openpets-companion-launcher svg { width: ${petButtonIconPx}px; height: ${petButtonIconPx}px; }
    .openpets-companion-launcher:hover { transform: scale(1.1); background: #ffffff; color: #1d4ed8; box-shadow: 0 4px 12px rgba(37, 99, 235, 0.28), 0 1px 3px rgba(15, 23, 42, 0.12), inset 0 1px 0 #ffffff; }
    .openpets-companion-launcher:active { transform: scale(0.95); }
    .openpets-talk-button { color: #059669; }
    .openpets-talk-button:hover:not(:disabled):not(.is-processing) { color: #047857; box-shadow: 0 4px 12px rgba(5, 150, 105, 0.28), 0 1px 3px rgba(15, 23, 42, 0.12), inset 0 1px 0 #ffffff; }
    .openpets-talk-button.is-active {
      background: #ef4444;
      border-color: rgba(220, 38, 38, 0.85);
      color: #ffffff;
      box-shadow: 0 2px 8px rgba(239, 68, 68, 0.38), 0 1px 2px rgba(15, 23, 42, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.25);
      animation: talk-pulse 1.8s ease-in-out infinite;
    }
    .openpets-talk-button.is-active:hover {
      background: #dc2626;
      border-color: #b91c1c;
      color: #ffffff;
      box-shadow: 0 4px 14px rgba(220, 38, 38, 0.48), 0 1px 3px rgba(15, 23, 42, 0.16), inset 0 1px 0 rgba(255, 255, 255, 0.25);
    }
    .openpets-talk-button.is-processing,
    .openpets-talk-button:disabled {
      background: linear-gradient(135deg, rgba(248, 250, 252, 0.94) 0%, rgba(241, 245, 249, 0.92) 100%);
      border-color: rgba(203, 213, 225, 0.85);
      color: #94a3b8;
      box-shadow: 0 1px 3px rgba(15, 23, 42, 0.06), inset 0 1px 0 rgba(255, 255, 255, 0.8);
      cursor: not-allowed;
      animation: processing-breathe 2s ease-in-out infinite;
    }
    .openpets-talk-button.is-processing:hover,
    .openpets-talk-button:disabled:hover {
      transform: none;
      background: linear-gradient(135deg, rgba(248, 250, 252, 0.94) 0%, rgba(241, 245, 249, 0.92) 100%);
      border-color: rgba(203, 213, 225, 0.85);
      color: #94a3b8;
      box-shadow: 0 1px 3px rgba(15, 23, 42, 0.06), inset 0 1px 0 rgba(255, 255, 255, 0.8);
    }
    /* Hide the assistant buttons while a transient bubble or the chat UI is
       showing. A pinned plugin HUD is NOT in this list: it never expires, so
       hiding on has-pinned would remove the buttons permanently. */
    .stage:has(.bubble:not(.is-pinned)) .openpets-pet-buttons,
    .stage.has-bubble .openpets-pet-buttons,
    .bubble:not(.is-pinned) ~ .pet-hitbox .openpets-pet-buttons,
    html[data-compact-composer-open="true"] .openpets-pet-buttons,
    html[data-chat-expanded="true"] .openpets-pet-buttons {
      display: none !important;
    }
    .pet-hitbox { position: absolute; left: 50%; bottom: ${Math.max(0, petBottom - hitPadding)}px; z-index: 1; width: ${scaledWidth + hitPadding * 2}px; height: ${scaledHeight + hitPadding * 2}px; display: grid; place-items: center; transform: translateX(-50%); pointer-events: auto; -webkit-app-region: ${petDragRegion}; cursor: grab; }
    .pet-shell { position: relative; width: ${scaledWidth}px; height: ${scaledHeight}px; display: block; opacity: var(--pet-opacity); filter: ${petShellFilter}; transition-property: opacity, filter; transition-duration: 180ms; transition-timing-function: cubic-bezier(0.2, 0, 0, 1); pointer-events: auto; -webkit-app-region: ${petDragRegion}; cursor: grab; }
    html[data-flip-x="true"] .pet-shell { transform: scaleX(-1); }
    .bubble { position: absolute; left: 50%; bottom: ${bubbleBottom}px; z-index: 4; box-sizing: border-box; display: inline-flex; flex-direction: column; width: fit-content; min-width: 92px; max-width: min(220px, calc(100vw - 18px)); max-height: 128px; padding: 10px 12px; background: linear-gradient(135deg, rgba(239, 246, 255, 0.97), rgba(237, 233, 254, 0.96)); color: #172033; font: 760 11px/14px Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; text-align: left; border: 1px solid rgba(255, 255, 255, 0.78); border-radius: 14px; box-shadow: 0 12px 24px rgba(15, 23, 42, 0.16), 0 2px 5px rgba(15, 23, 42, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.82); white-space: normal; overflow-wrap: break-word; word-break: normal; overflow: visible; pointer-events: auto; -webkit-app-region: no-drag; opacity: 1; backdrop-filter: ${bubbleBackdropFilter}; transform: translateX(-50%); transform-origin: 64% 100%; animation: bubble-in 180ms cubic-bezier(0.2, 0, 0, 1); }
    .bubble[data-dismiss-token] { cursor: pointer; }
    .bubble::after { content: ""; position: absolute; left: 64%; bottom: -7px; width: 12px; height: 12px; background: inherit; border-right: 1px solid rgba(255, 255, 255, 0.56); border-bottom: 1px solid rgba(255, 255, 255, 0.56); border-bottom-right-radius: 3px; transform: translateX(-50%) rotate(45deg); box-shadow: 3px 3px 7px rgba(15, 23, 42, 0.08); }
    .bubble-header { display: inline-flex; align-items: center; min-width: 0; gap: 7px; color: currentColor; font: 780 11px/14px Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; letter-spacing: 0.01em; }
    .bubble-status-icon { position: relative; display: inline-flex; align-items: center; justify-content: center; flex: 0 0 18px; width: 18px; min-width: 18px; height: 18px; border-radius: 999px; background: #3b82f6; color: #fff; font: 900 12px/18px Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; text-align: center; box-shadow: inset 0 1px 2px rgba(255, 255, 255, 0.28), 0 2px 7px rgba(59, 130, 246, 0.3); }
    .bubble-status-icon::before { content: attr(data-icon); display: block; width: 18px; height: 18px; line-height: 18px; text-align: center; transform: none; }
    .bubble-status-icon.has-svg::before { content: none; }
    .bubble-status-icon svg { display: block; width: 14px; height: 14px; color: currentColor; }
    .bubble-status-icon img { display: block; width: 14px; height: 14px; object-fit: contain; }
    .bubble-status-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .bubble-divider { height: 1px; width: 100%; margin: 8px 0; background: rgba(30, 58, 138, 0.12); }
    .bubble-body { min-width: 0; width: 100%; color: #172033; font: 720 10.5px/13.5px Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", "Meiryo", "Malgun Gothic", "Apple SD Gothic Neo", "PingFang SC", "PingFang TC", "Microsoft YaHei", "Microsoft JhengHei", "Noto Sans CJK JP", "Noto Sans CJK KR", "Noto Sans CJK SC", "Noto Sans CJK TC", sans-serif; }
    .bubble-text { display: -webkit-box; min-width: 0; overflow: hidden; -webkit-line-clamp: 4; -webkit-box-orient: vertical; text-wrap: normal; overflow-wrap: break-word; }
    .bubble.is-status-only { max-width: min(156px, calc(100vw - 18px)); padding: 8px 11px; border-radius: 999px; }
    .bubble.is-status-only .bubble-header { display: grid; grid-template-columns: 18px minmax(0, auto); align-items: center; justify-content: center; }
    .bubble.is-message-only { border-radius: 14px 14px 3px 14px; }
    .bubble.has-actions { min-width: min(176px, calc(100vw - 18px)); }
    .bubble.is-long-message { max-width: min(220px, calc(100vw - 18px)); max-height: 138px; }
    .bubble.is-long-message .bubble-text { -webkit-line-clamp: 6; font-size: 10px; line-height: 13px; }
    .bubble.is-very-long-message { max-width: min(220px, calc(100vw - 18px)); max-height: 156px; }
    .bubble.is-very-long-message .bubble-text { -webkit-line-clamp: 8; font-size: 9.5px; line-height: 12.5px; }
    .bubble.is-busy .bubble-status-icon { background: #3b82f6; box-shadow: inset 0 1px 2px rgba(255, 255, 255, 0.28), 0 2px 7px rgba(59, 130, 246, 0.34); }
    .bubble.is-waiting .bubble-status-icon { background: #f59e0b; box-shadow: inset 0 1px 2px rgba(255, 255, 255, 0.28), 0 2px 7px rgba(245, 158, 11, 0.34); }
    .bubble.is-success .bubble-status-icon { background: #10b981; box-shadow: inset 0 1px 2px rgba(255, 255, 255, 0.28), 0 2px 7px rgba(16, 185, 129, 0.34); }
    .bubble.is-error .bubble-status-icon { background: #ef4444; box-shadow: inset 0 1px 2px rgba(255, 255, 255, 0.28), 0 2px 7px rgba(239, 68, 68, 0.34); }
    .bubble.is-info .bubble-status-icon { background: #38bdf8; box-shadow: inset 0 1px 2px rgba(255, 255, 255, 0.28), 0 2px 7px rgba(56, 189, 248, 0.34); }
    .bubble-status-icon.is-success { background: #10b981; box-shadow: inset 0 1px 2px rgba(255, 255, 255, 0.28), 0 2px 7px rgba(16, 185, 129, 0.34); }
    .bubble-status-icon.is-error { background: #ef4444; box-shadow: inset 0 1px 2px rgba(255, 255, 255, 0.28), 0 2px 7px rgba(239, 68, 68, 0.34); }
    .bubble-status-icon.is-warning { background: #f59e0b; box-shadow: inset 0 1px 2px rgba(255, 255, 255, 0.28), 0 2px 7px rgba(245, 158, 11, 0.34); }
    .bubble-status-icon.is-info { background: #38bdf8; box-shadow: inset 0 1px 2px rgba(255, 255, 255, 0.28), 0 2px 7px rgba(56, 189, 248, 0.34); }
    .bubble.is-busy .bubble-status-icon::before { content: ""; position: absolute; inset: 0; width: 18px; height: 18px; background: radial-gradient(circle at 50% 50%, #fff 0 4px, transparent 4.5px); animation: status-pulse 820ms ease-in-out infinite; }
    .bubble.is-waiting .bubble-status-icon::before { content: ""; position: absolute; left: 3px; top: 3px; box-sizing: border-box; width: 12px; height: 12px; border: 2px solid rgba(255, 255, 255, 0.96); border-top-color: rgba(255, 255, 255, 0.28); border-radius: 999px; }
    .bubble.is-plugin { gap: 6px; }
    .bubble.is-plugin .bubble-markdown strong { font-weight: 860; }
    .bubble.is-plugin .bubble-markdown em { font-style: italic; }
    .bubble.is-plugin .bubble-markdown code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 9.5px; background: rgba(30, 58, 138, 0.08); border-radius: 4px; padding: 0 3px; }
    .bubble-media { display: block; max-width: 96px; max-height: 64px; margin: 0 auto 2px; pointer-events: none; }
    .bubble.has-media { max-width: min(232px, calc(100vw - 18px)); max-height: 224px; }
    .bubble.is-link { cursor: pointer; }
    .bubble-media-preview { display: block; max-width: 100%; max-height: 150px; margin: 0 auto 2px; border-radius: 8px; pointer-events: none; object-fit: contain; }
    .bubble-plugin-icon { display: inline-block; font-size: 13px; line-height: 14px; margin-bottom: 2px; }
    .bubble-hud-item-icon, .bubble-plugin-icon, .bubble-status-icon::before, .bubble-action [aria-hidden="true"] { font-family: "OpenPets Emoji", "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", system-ui, sans-serif; }
    .bubble-actions { display: flex; flex-wrap: nowrap; gap: 5px; width: 100%; margin-top: 6px; min-width: 0; }
    .bubble-action { flex: 1 1 0; min-width: 0; border: 0; border-radius: 8px; padding: 4px 7px; font: 760 10px/12px Inter, ui-sans-serif, system-ui, sans-serif; background: rgba(30, 58, 138, 0.10); color: #172033; cursor: pointer; pointer-events: auto; -webkit-app-region: no-drag; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .bubble-action:hover { background: rgba(30, 58, 138, 0.18); }
    .bubble-action.is-primary { background: #2563eb; color: #fff; }
    .bubble-action.is-primary:hover { background: #1d4ed8; }
    .bubble-action.is-danger { background: #ef4444; color: #fff; }
    .bubble-action.is-danger:hover { background: #dc2626; }
    .bubble-input { display: flex; gap: 5px; margin-top: 6px; align-items: center; }
    .bubble-input-control { box-sizing: border-box; flex: 1 1 auto; min-width: 0; border: 1px solid rgba(30, 58, 138, 0.25); border-radius: 8px; padding: 4px 7px; font: 700 10px/12px Inter, ui-sans-serif, system-ui, sans-serif; background: rgba(255, 255, 255, 0.9); color: #172033; pointer-events: auto; -webkit-app-region: no-drag; }
    .bubble.is-pinned {
      position: absolute;
      left: 50%;
      bottom: 6px;
      z-index: 4;
      width: 188px;
      max-width: calc((100% - 16px) / ${hudScale});
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 6px 8px;
      background: linear-gradient(135deg, rgba(241, 245, 249, 0.94), rgba(226, 232, 240, 0.92));
      color: #334155;
      border: 1px solid rgba(255, 255, 255, 0.7);
      border-radius: 12px;
      box-shadow: 0 4px 10px rgba(15, 23, 42, 0.08), 0 1px 3px rgba(15, 23, 42, 0.04), inset 0 1px 0 rgba(255, 255, 255, 0.5);
      backdrop-filter: blur(8px);
      text-align: center;
      max-height: none;
      animation: pinned-bubble-in 200ms cubic-bezier(0.2, 0, 0, 1);
      transform: translateX(-50%) scale(${hudScale});
      transform-origin: bottom center;
    }
    @keyframes pinned-bubble-in { from { opacity: 0; transform: translateX(-50%) translateY(4px) scale(${hudScale * 0.96}); } to { opacity: 1; transform: translateX(-50%) translateY(0) scale(${hudScale}); } }
    .bubble.is-pinned::after { content: none !important; }
    .bubble.is-pinned .bubble-body { width: 100%; text-align: center; }
    .bubble.is-pinned .bubble-text { display: inline-block; -webkit-line-clamp: unset; -webkit-box-orient: initial; white-space: pre; overflow-wrap: normal; word-break: keep-all; font: 800 10px/13px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace; letter-spacing: -0.03em; color: #334155; text-align: left; }
    .bubble.is-pinned .bubble-actions { display: flex; flex-direction: row; flex-wrap: nowrap; gap: 4px; width: 100%; margin-top: 5px; justify-content: center; }
    .bubble.is-pinned .bubble-action { flex: 1 1 auto; min-width: 0; padding: 3px 6px; font-size: 9px; font-weight: 700; line-height: 11px; border-radius: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: center; background: rgba(30, 58, 138, 0.08); color: #1e293b; transition: background 150ms ease; }
    .bubble.is-pinned .bubble-action:hover { background: rgba(30, 58, 138, 0.14); }
    .bubble.is-pinned .bubble-action.is-primary { background: #2563eb; color: #ffffff; }
    .bubble.is-pinned .bubble-action.is-primary:hover { background: #1d4ed8; }
    .bubble.is-pinned .bubble-action.is-danger { background: #ef4444; color: #ffffff; }
    .bubble.is-pinned .bubble-action.is-danger:hover { background: #dc2626; }
    .bubble.is-pinned.accent-blue { background: linear-gradient(135deg, rgba(219, 234, 254, 0.94), rgba(191, 219, 254, 0.92)); }
    .bubble.is-pinned.accent-purple { background: linear-gradient(135deg, rgba(237, 233, 254, 0.94), rgba(221, 214, 254, 0.92)); }
    .bubble.is-pinned.accent-green { background: linear-gradient(135deg, rgba(220, 252, 231, 0.94), rgba(187, 247, 208, 0.92)); }
    .bubble.is-pinned.accent-amber { background: linear-gradient(135deg, rgba(254, 243, 199, 0.94), rgba(253, 230, 138, 0.92)); }
    .bubble.is-pinned.accent-red { background: linear-gradient(135deg, rgba(254, 226, 226, 0.94), rgba(254, 202, 202, 0.92)); }
    .bubble.is-pinned.accent-pink { background: linear-gradient(135deg, rgba(252, 231, 243, 0.94), rgba(251, 207, 232, 0.92)); }
    .bubble.is-pinned.accent-slate { background: linear-gradient(135deg, rgba(241, 245, 249, 0.94), rgba(226, 232, 240, 0.92)); }
    .stage.has-pinned .pet-hitbox { bottom: ${Math.max(0, petBottom - hitPadding) + pinnedLift}px; }
    .stage.has-pinned .bubble:not(.is-pinned) { bottom: ${bubbleBottom + pinnedLift}px; }
    .stage.has-pinned ~ .openpets-compact-composer { bottom: ${compactComposerBottom + pinnedLift}px; }
    .stage.has-pinned ~ .openpets-chat-panel { bottom: ${chatPanelBottom + pinnedLift}px; }
    .bubble.is-plugin.accent-blue { background: linear-gradient(135deg, rgba(219, 234, 254, 0.97), rgba(191, 219, 254, 0.94)); }
    .bubble.is-plugin.accent-purple { background: linear-gradient(135deg, rgba(237, 233, 254, 0.97), rgba(221, 214, 254, 0.94)); }
    .bubble.is-plugin.accent-green { background: linear-gradient(135deg, rgba(220, 252, 231, 0.97), rgba(187, 247, 208, 0.94)); }
    .bubble.is-plugin.accent-amber { background: linear-gradient(135deg, rgba(254, 243, 199, 0.97), rgba(253, 230, 138, 0.94)); }
    .bubble.is-plugin.accent-red { background: linear-gradient(135deg, rgba(254, 226, 226, 0.97), rgba(254, 202, 202, 0.94)); }
    .bubble.is-plugin.accent-pink { background: linear-gradient(135deg, rgba(252, 231, 243, 0.97), rgba(251, 207, 232, 0.94)); }
    .bubble.is-plugin.accent-slate { background: linear-gradient(135deg, rgba(241, 245, 249, 0.97), rgba(226, 232, 240, 0.94)); }
    .bubble-hud {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 6px 8px;
      width: 100%;
      margin: 2px 0;
      box-sizing: border-box;
    }
    .bubble-hud.items-1 {
      grid-template-columns: 1fr;
    }
    .bubble-hud.items-3 .bubble-hud-item:last-child {
      grid-column: span 2;
    }
    .bubble-hud-item {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
      width: 100%;
    }
    .bubble-hud-item-icon {
      flex: 0 0 12px;
      width: 12px;
      height: 12px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      line-height: 1;
      font-family: "OpenPets Emoji", "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", system-ui, sans-serif;
    }
    .bubble-hud-item-icon img, .bubble-hud-item-icon svg {
      width: 12px;
      height: 12px;
      object-fit: contain;
      display: block;
    }
    .bubble-hud-item-content {
      flex: 1 1 auto;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .bubble-hud-item-meta {
      display: flex;
      justify-content: flex-start;
      align-items: baseline;
      gap: 2px;
      font-size: 8px;
      font-weight: 700;
      line-height: 1;
      color: #475569;
    }
    .bubble-hud-item-label {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .bubble-hud-item-bar {
      height: 4px;
      background: rgba(71, 85, 105, 0.15);
      border-radius: 99px;
      overflow: hidden;
      position: relative;
      width: 100%;
    }
    .bubble-hud-item-fill {
      height: 100%;
      border-radius: 99px;
      width: 0%;
      transition: width 200ms ease;
    }
    .bubble-hud-item-fill.tone-amber { background: #d97706; }
    .bubble-hud-item-fill.tone-blue { background: #2563eb; }
    .bubble-hud-item-fill.tone-green { background: #16a34a; }
    .bubble-hud-item-fill.tone-pink { background: #db2777; }
    .bubble-hud-item-fill.tone-slate { background: #475569; }
    .bubble-hud-item-fill.tone-red { background: #dc2626; }
    /* --- In-Pet Compact Composer --- */
    .openpets-compact-composer {
      position: absolute;
      left: 50%;
      bottom: ${compactComposerBottom}px;
      transform: translateX(-50%);
       width: calc(100% - ${compactComposerGeometry.horizontalInset * 2}px);
       max-width: ${compactComposerGeometry.maxWidth}px;
       max-height: ${compactComposerGeometry.maxHeight}px;
      box-sizing: border-box;
      display: none;
      flex-direction: column;
       gap: ${compactComposerGeometry.gap}px;
       padding: ${compactComposerGeometry.paddingY}px ${compactComposerGeometry.paddingX}px;
      background: linear-gradient(135deg, rgba(255, 255, 255, 0.98) 0%, rgba(240, 245, 255, 0.96) 55%, rgba(237, 233, 254, 0.95) 100%);
      color: #172033;
      border: 1px solid rgba(255, 255, 255, 0.85);
      border-radius: 14px;
      box-shadow: 0 12px 24px rgba(15, 23, 42, 0.14), 0 2px 6px rgba(15, 23, 42, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.95);
      backdrop-filter: ${bubbleBackdropFilter};
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      pointer-events: auto;
      -webkit-app-region: no-drag;
      z-index: 10;
      opacity: 0;
      color-scheme: light;
    }
    .openpets-compact-composer::after {
      content: "";
      position: absolute;
      left: 50%;
      bottom: -6px;
      width: 11px;
      height: 11px;
      background: #eef3ff;
      border-right: 1px solid rgba(203, 213, 225, 0.75);
      border-bottom: 1px solid rgba(203, 213, 225, 0.75);
      border-bottom-right-radius: 3px;
      transform: translateX(-50%) rotate(45deg);
      box-shadow: 2px 2px 4px rgba(15, 23, 42, 0.06);
    }
    html[data-compact-composer-open="true"]:not([data-chat-expanded="true"]) .openpets-compact-composer {
      display: flex;
      opacity: 1;
      animation: bubble-in 180ms cubic-bezier(0.2, 0, 0, 1) forwards;
    }
    html[data-compact-composer-open="true"] .bubble:not(.is-pinned),
    html[data-chat-expanded="true"] .bubble:not(.is-pinned) {
      display: none !important;
    }
    .compact-composer-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      user-select: none;
    }
    .compact-composer-title {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 11px;
      font-weight: 780;
      color: #1e293b;
      letter-spacing: -0.01em;
      min-width: 0;
    }
    .compact-composer-status-dot {
      width: 5px;
      height: 5px;
      border-radius: 50%;
      background: #f59e0b;
      animation: status-pulse 800ms infinite ease-in-out;
    }
    .compact-composer-actions {
      display: flex;
      align-items: center;
      gap: 3px;
    }
    .compact-composer-btn {
      width: 18px;
      height: 18px;
      padding: 0;
      border: 1px solid rgba(148, 163, 184, 0.25);
      border-radius: 5px;
      background: rgba(255, 255, 255, 0.7);
      color: #64748b;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      pointer-events: auto;
      -webkit-app-region: no-drag;
      transition: all 120ms ease;
    }
    .compact-composer-btn:hover {
      background: #ffffff;
      color: #0f172a;
      border-color: rgba(148, 163, 184, 0.4);
      box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08);
    }
    .compact-composer-btn.is-open-chat:hover {
      color: #2563eb;
      background: #eff6ff;
      border-color: rgba(59, 130, 246, 0.4);
    }
    .compact-composer-btn.is-close:hover {
      color: #ef4444;
      background: #fef2f2;
      border-color: rgba(239, 68, 68, 0.4);
    }
    .compact-composer-form {
      display: flex;
      align-items: flex-end;
      gap: 5px;
      position: relative;
    }
    .compact-composer-textarea {
      box-sizing: border-box;
      flex: 1 1 auto;
      min-width: 0;
      min-height: 28px;
       max-height: ${compactComposerGeometry.textareaMaxHeight}px;
      padding: 5px 8px;
      border: 1px solid rgba(203, 213, 225, 0.85);
      border-radius: 9px;
      background: rgba(255, 255, 255, 0.96);
      color: #0f172a;
      font-family: inherit;
      font-size: 11px;
      line-height: 14.5px;
      resize: none;
      outline: none;
      pointer-events: auto;
      -webkit-app-region: no-drag;
      box-shadow: inset 0 1px 2px rgba(15, 23, 42, 0.04);
      transition: border-color 140ms ease, box-shadow 140ms ease;
    }
    .compact-composer-textarea:focus {
      border-color: #3b82f6;
      box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2), inset 0 1px 2px rgba(15, 23, 42, 0.04);
    }
    .compact-composer-textarea::placeholder {
      color: #94a3b8;
    }
    .compact-composer-send-btn, .compact-composer-cancel-btn {
      width: 28px;
      height: 28px;
      padding: 0;
      border-radius: 9px;
      border: none;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      cursor: pointer;
      pointer-events: auto;
      -webkit-app-region: no-drag;
      transition: all 120ms ease;
    }
    .compact-composer-send-btn {
      background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
      color: #ffffff;
      box-shadow: 0 2px 5px rgba(37, 99, 235, 0.28);
    }
    .compact-composer-send-btn:hover:not(:disabled) {
      background: linear-gradient(135deg, #1d4ed8 0%, #1e40af 100%);
      box-shadow: 0 3px 7px rgba(37, 99, 235, 0.38);
      transform: scale(1.03);
    }
    .compact-composer-send-btn:disabled {
      background: rgba(203, 213, 225, 0.45);
      color: #94a3b8;
      box-shadow: none;
      cursor: not-allowed;
      transform: none;
    }
    .compact-composer-cancel-btn {
      background: #fee2e2;
      border: 1px solid rgba(239, 68, 68, 0.35);
      color: #dc2626;
    }
    .compact-composer-cancel-btn:hover {
      background: #fecaca;
      color: #b91c1c;
    }
    .compact-composer-error {
       box-sizing: border-box;
       max-height: ${compactComposerGeometry.errorMaxHeight}px;
       overflow: hidden;
      font-size: 10px;
      font-weight: 600;
      color: #b91c1c;
      background: #fef2f2;
      border: 1px solid rgba(239, 68, 68, 0.3);
      border-radius: 6px;
      padding: 3px 6px;
      line-height: 1.3;
    }
    /* --- In-Pet Attached Chat Panel --- */
    .openpets-chat-panel {
      position: absolute;
      bottom: ${chatPanelBottom}px;
      left: 50%;
      transform: translateX(-50%);
      transform-origin: 50% 100%;
      width: ${defaultPetChatPanelLayout.width}px;
      min-height: ${defaultPetChatPanelLayout.minHeight}px;
      max-height: ${defaultPetChatPanelLayout.maxHeight}px;
      height: fit-content;
      z-index: 100;
      box-sizing: border-box;
      display: none;
      flex-direction: column;
      background: linear-gradient(135deg, rgba(255, 255, 255, 0.98) 0%, rgba(240, 245, 255, 0.96) 55%, rgba(237, 233, 254, 0.95) 100%);
      color: #0f172a;
      border: 1px solid rgba(226, 232, 240, 0.95);
      border-radius: 20px;
      box-shadow: 0 24px 48px -12px rgba(15, 23, 42, 0.18), 0 4px 12px rgba(15, 23, 42, 0.08), inset 0 1px 0 rgba(255, 255, 255, 1);
      backdrop-filter: blur(20px);
      overflow: visible;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      pointer-events: auto;
      -webkit-app-region: no-drag;
      opacity: 0;
      color-scheme: light;
    }
    html[data-chat-expanded="true"] .openpets-chat-panel {
      display: flex;
      opacity: 1;
      animation: chat-panel-enter 220ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
    }
    .openpets-chat-panel::after {
      content: "";
      position: absolute;
      left: 50%;
      bottom: -6px;
      width: 12px;
      height: 12px;
      background: #ede9fe;
      border-right: 1px solid rgba(226, 232, 240, 0.95);
      border-bottom: 1px solid rgba(226, 232, 240, 0.95);
      border-bottom-right-radius: 3px;
      transform: translateX(-50%) rotate(45deg);
      box-shadow: 3px 3px 6px rgba(15, 23, 42, 0.08);
      z-index: 1;
    }
    .chat-header {
      height: 46px;
      padding: 0 14px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid rgba(226, 232, 240, 0.9);
      border-top-left-radius: 19px;
      border-top-right-radius: 19px;
      background: rgba(248, 250, 252, 0.8);
      flex-shrink: 0;
      user-select: none;
    }
    .chat-header-left {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
    }
    .chat-avatar {
      width: 18px;
      height: 18px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 13px;
      color: #fff;
      flex-shrink: 0;
    }
    .chat-title {
      font-size: 13px;
      font-weight: 780;
      color: #0f172a;
      letter-spacing: -0.01em;
      white-space: nowrap;
    }
    .chat-status-pill {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 2px 7px;
      border-radius: 999px;
      background: #ffffff;
      font-size: 10px;
      font-weight: 600;
      color: #475569;
      border: 1px solid rgba(203, 213, 225, 0.7);
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.03);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 130px;
    }
    .chat-status-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #10b981;
      flex-shrink: 0;
    }
    .chat-status-pill.is-thinking .chat-status-dot { background: #f59e0b; animation: status-pulse 800ms infinite ease-in-out; }
    .chat-status-pill.is-acting .chat-status-dot { background: #3b82f6; animation: status-pulse 800ms infinite ease-in-out; }
    .chat-status-pill.is-responding .chat-status-dot { background: #8b5cf6; animation: status-pulse 800ms infinite ease-in-out; }
    .chat-status-pill.is-voice .chat-status-dot { background: #ec4899; animation: status-pulse 600ms infinite ease-in-out; }
    .chat-header-right {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-shrink: 0;
    }
    .chat-voice-btn {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 4px 9px;
      border-radius: 999px;
      border: 1px solid rgba(203, 213, 225, 0.8);
      background: #ffffff;
      color: #334155;
      font-size: 11px;
      font-weight: 600;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
      cursor: pointer;
      pointer-events: auto;
      -webkit-app-region: no-drag;
      transition: all 140ms ease;
    }
    .chat-voice-btn:hover {
      background: #f1f5f9;
      border-color: #cbd5e1;
      color: #0f172a;
    }
    .chat-voice-btn.is-active {
      background: linear-gradient(135deg, rgba(252, 231, 243, 0.95) 0%, rgba(243, 232, 255, 0.95) 100%);
      border-color: rgba(236, 72, 153, 0.4);
      color: #db2777;
    }
    .chat-voice-btn.is-muted {
      background: #fee2e2;
      border-color: rgba(239, 68, 68, 0.35);
      color: #dc2626;
    }
    .chat-close-btn {
      width: 26px;
      height: 26px;
      border-radius: 50%;
      border: none;
      background: transparent;
      color: #64748b;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      pointer-events: auto;
      -webkit-app-region: no-drag;
      transition: all 140ms ease;
    }
    .chat-close-btn:hover {
      background: rgba(148, 163, 184, 0.16);
      color: #0f172a;
    }
    .chat-voice-banner {
      padding: 7px 14px;
      background: linear-gradient(90deg, rgba(239, 246, 255, 0.95) 0%, rgba(243, 232, 255, 0.95) 100%);
      border-bottom: 1px solid rgba(191, 219, 254, 0.8);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      font-size: 11px;
      font-weight: 550;
      color: #1d4ed8;
      flex-shrink: 0;
    }
    .chat-voice-banner-info {
      display: flex;
      align-items: center;
      gap: 7px;
      min-width: 0;
    }
    .chat-voice-wave {
      display: flex;
      align-items: center;
      gap: 2px;
      height: 12px;
    }
    .chat-voice-bar {
      width: 2.5px;
      height: 100%;
      background: #3b82f6;
      border-radius: 99px;
      animation: voice-wave 1s ease-in-out infinite;
    }
    .chat-voice-bar:nth-child(2) { animation-delay: 0.15s; }
    .chat-voice-bar:nth-child(3) { animation-delay: 0.3s; }
    .chat-voice-bar:nth-child(4) { animation-delay: 0.45s; }
    .chat-voice-actions {
      display: flex;
      align-items: center;
      gap: 5px;
    }
    .chat-voice-action-btn {
      padding: 2px 7px;
      border-radius: 6px;
      border: 1px solid rgba(191, 219, 254, 0.8);
      background: #ffffff;
      color: #1e40af;
      font-size: 10px;
      font-weight: 600;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
      cursor: pointer;
      pointer-events: auto;
      -webkit-app-region: no-drag;
      transition: background 120ms ease;
    }
    .chat-voice-action-btn:hover {
      background: #eff6ff;
    }
    .chat-voice-action-btn.is-end {
      background: #fee2e2;
      border-color: rgba(239, 68, 68, 0.35);
      color: #b91c1c;
    }
    .chat-voice-action-btn.is-end:hover {
      background: #fecaca;
    }
    .chat-transcript {
      flex: 1 1 auto;
      overflow-y: auto;
      padding: 12px 14px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      min-height: 0;
      scrollbar-width: thin;
      scrollbar-color: rgba(148, 163, 184, 0.35) transparent;
    }
    .chat-transcript::-webkit-scrollbar {
      width: 5px;
    }
    .chat-transcript::-webkit-scrollbar-thumb {
      background: rgba(148, 163, 184, 0.3);
      border-radius: 99px;
    }
    .chat-transcript::-webkit-scrollbar-thumb:hover {
      background: rgba(148, 163, 184, 0.5);
    }
    .chat-empty {
      margin: auto 0;
      text-align: center;
      padding: 20px 10px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
    }
    .chat-empty-icon {
      font-size: 28px;
      line-height: 1;
      margin-bottom: 2px;
    }
    .chat-empty-title {
      font-size: 13px;
      font-weight: 780;
      color: #0f172a;
    }
    .chat-empty-subtitle {
      font-size: 11px;
      color: #64748b;
      max-width: 240px;
      line-height: 1.4;
    }
    .chat-msg {
      display: flex;
      flex-direction: column;
      max-width: 88%;
      animation: msg-appear 160ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
    }
    .chat-msg.is-user {
      align-self: flex-end;
    }
    .chat-msg.is-assistant {
      align-self: flex-start;
      max-width: 92%;
    }
    .chat-msg-bubble {
      padding: 8px 12px;
      font-size: 12px;
      line-height: 16.5px;
      word-break: break-word;
      white-space: pre-wrap;
    }
    .chat-msg.is-user .chat-msg-bubble {
      background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
      color: #ffffff;
      border-radius: 14px 14px 2px 14px;
      box-shadow: 0 2px 6px rgba(37, 99, 235, 0.22);
    }
    .chat-msg.is-assistant .chat-msg-bubble {
      background: #ffffff;
      border: 1px solid rgba(226, 232, 240, 0.95);
      color: #1e293b;
      border-radius: 14px 14px 14px 2px;
      box-shadow: 0 1px 3px rgba(15, 23, 42, 0.04);
      white-space: normal;
    }
    .chat-msg.is-assistant .chat-msg-bubble p {
      margin: 0 0 6px;
    }
    .chat-msg.is-assistant .chat-msg-bubble p:last-child {
      margin-bottom: 0;
    }
    .chat-msg.is-assistant .chat-msg-bubble strong {
      font-weight: 780;
      color: #0f172a;
    }
    .chat-msg.is-assistant .chat-msg-bubble em {
      font-style: italic;
    }
    .chat-msg.is-assistant .chat-msg-bubble ul, .chat-msg.is-assistant .chat-msg-bubble ol {
      margin: 4px 0 6px 16px;
      padding: 0;
    }
    .chat-msg.is-assistant .chat-msg-bubble li {
      margin-bottom: 2px;
    }
    .chat-code-inline {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 11px;
      font-weight: 600;
      background: rgba(241, 245, 249, 0.95);
      border: 1px solid rgba(203, 213, 225, 0.7);
      border-radius: 4px;
      padding: 1px 4px;
      color: #2563eb;
    }
    .chat-code-block {
      margin: 6px 0;
      padding: 8px 10px;
      background: #f8fafc;
      border: 1px solid rgba(226, 232, 240, 0.95);
      border-radius: 8px;
      overflow-x: auto;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 11px;
      line-height: 15px;
      color: #0f172a;
      white-space: pre;
    }
    .chat-typing-cursor {
      display: inline-block;
      width: 5px;
      height: 12px;
      background: #2563eb;
      border-radius: 1px;
      vertical-align: -1px;
      margin-left: 2px;
      animation: cursor-blink 750ms infinite;
    }
    .chat-action-card {
      align-self: stretch;
      padding: 6px 10px;
      background: #ffffff;
      border: 1px solid rgba(226, 232, 240, 0.95);
      border-radius: 10px;
      box-shadow: 0 1px 3px rgba(15, 23, 42, 0.04);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      font-size: 11px;
      color: #475569;
    }
    .chat-action-left {
      display: flex;
      align-items: center;
      gap: 7px;
      min-width: 0;
    }
    .chat-action-icon {
      width: 14px;
      height: 14px;
      flex-shrink: 0;
      color: #64748b;
    }
    .chat-action-name {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-weight: 650;
      color: #0f172a;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .chat-action-badge {
      font-size: 9.5px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      padding: 1px 5px;
      border-radius: 4px;
      flex-shrink: 0;
    }
    .chat-action-badge.is-running { background: #eff6ff; color: #2563eb; border: 1px solid rgba(59, 130, 246, 0.25); }
    .chat-action-badge.is-completed { background: #ecfdf5; color: #059669; border: 1px solid rgba(16, 185, 129, 0.25); }
    .chat-action-badge.is-failed, .chat-action-badge.is-rejected { background: #fef2f2; color: #dc2626; border: 1px solid rgba(239, 68, 68, 0.25); }
    .chat-error-banner {
      margin: 4px 14px;
      padding: 7px 10px;
      background: #fef2f2;
      border: 1px solid rgba(239, 68, 68, 0.3);
      border-radius: 8px;
      font-size: 11px;
      font-weight: 600;
      color: #b91c1c;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .chat-suggestions {
      padding: 2px 14px 8px;
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
      flex-shrink: 0;
    }
    .chat-chip {
      padding: 4px 9px;
      background: #ffffff;
      border: 1px solid rgba(203, 213, 225, 0.8);
      border-radius: 999px;
      font-size: 11px;
      font-weight: 550;
      color: #334155;
      cursor: pointer;
      pointer-events: auto;
      -webkit-app-region: no-drag;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
      transition: all 120ms ease;
      user-select: none;
    }
    .chat-chip:hover {
      background: #eff6ff;
      border-color: rgba(59, 130, 246, 0.4);
      color: #1d4ed8;
      transform: translateY(-1px);
      box-shadow: 0 2px 4px rgba(37, 99, 235, 0.12);
    }
    .chat-composer {
      padding: 10px 14px 14px;
      border-top: 1px solid rgba(226, 232, 240, 0.9);
      border-bottom-left-radius: 19px;
      border-bottom-right-radius: 19px;
      background: rgba(248, 250, 252, 0.85);
      display: flex;
      align-items: flex-end;
      gap: 8px;
      flex-shrink: 0;
    }
    .chat-input-wrapper {
      flex: 1 1 auto;
      position: relative;
      min-width: 0;
    }
    .chat-textarea {
      width: 100%;
      min-height: 36px;
      max-height: 96px;
      padding: 8px 11px;
      box-sizing: border-box;
      border: 1px solid rgba(203, 213, 225, 0.9);
      border-radius: 12px;
      background: #ffffff;
      color: #0f172a;
      font-family: inherit;
      font-size: 12px;
      line-height: 16px;
      resize: none;
      outline: none;
      pointer-events: auto;
      -webkit-app-region: no-drag;
      box-shadow: inset 0 1px 2px rgba(15, 23, 42, 0.03);
      transition: border-color 140ms ease, box-shadow 140ms ease;
    }
    .chat-textarea:focus {
      border-color: #3b82f6;
      box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2), inset 0 1px 2px rgba(15, 23, 42, 0.03);
    }
    .chat-textarea::placeholder {
      color: #94a3b8;
    }
    .chat-send-btn, .chat-cancel-turn-btn {
      width: 36px;
      height: 36px;
      border-radius: 10px;
      border: none;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      cursor: pointer;
      pointer-events: auto;
      -webkit-app-region: no-drag;
      transition: all 140ms ease;
    }
    .chat-send-btn {
      background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
      color: #ffffff;
      box-shadow: 0 2px 5px rgba(37, 99, 235, 0.28);
    }
    .chat-send-btn:hover:not(:disabled) {
      background: linear-gradient(135deg, #1d4ed8 0%, #1e40af 100%);
      box-shadow: 0 3px 8px rgba(37, 99, 235, 0.35);
      transform: scale(1.02);
    }
    .chat-send-btn:disabled {
      background: rgba(203, 213, 225, 0.45);
      color: #94a3b8;
      box-shadow: none;
      cursor: not-allowed;
      transform: none;
    }
    .chat-cancel-turn-btn {
      background: #fee2e2;
      border: 1px solid rgba(239, 68, 68, 0.35);
      color: #dc2626;
    }
    .chat-cancel-turn-btn:hover {
      background: #fecaca;
      color: #b91c1c;
    }
    @keyframes chat-panel-enter {
      from { opacity: 0; transform: translateX(-50%) translateY(8px) scale(0.97); }
      to { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
    }
    @keyframes msg-appear {
      from { opacity: 0; transform: translateY(4px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes voice-wave {
      0%, 100% { height: 4px; }
      50% { height: 12px; }
    }
    @keyframes cursor-blink {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.15; }
    }
    @keyframes bubble-in { from { opacity: 0; transform: translateX(-50%) translateY(4px) scale(0.96); } to { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); } }
    @keyframes status-pulse { 0%, 100% { opacity: 0.52; } 50% { opacity: 1; } }
    @keyframes talk-pulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.44), 0 2px 8px rgba(239, 68, 68, 0.36), inset 0 1px 0 rgba(255, 255, 255, 0.25); }
      50% { box-shadow: 0 0 0 4px rgba(239, 68, 68, 0.12), 0 2px 10px rgba(239, 68, 68, 0.44), inset 0 1px 0 rgba(255, 255, 255, 0.25); }
    }
    @keyframes processing-breathe {
      0%, 100% { opacity: 0.65; }
      50% { opacity: 0.95; }
    }
    @media (prefers-reduced-motion: reduce) { .sprite, .installed-sprite, .bubble, .bubble-status-icon::before, .openpets-talk-button.is-active, .openpets-talk-button.is-processing { animation: none !important; } }
  `;
}
export function createSpriteStateCss(selector: ".sprite" | ".installed-sprite", stateRows: Readonly<Record<UniversalSpriteState, SpriteStateDefinition>>, layout: CodexPetSpriteLayout = {
  version: 1,
  frameWidth: defaultPetSprite.frameWidth,
  frameHeight: defaultPetSprite.frameHeight,
  columns: defaultPetSprite.columns,
  rows: defaultPetSprite.rows,
}): string {
  // A flipped pet is mirrored with scaleX(-1), which visually reverses the
  // directional run rows; emit a flip-specific variant that plays the
  // opposite row so the on-screen direction stays correct.
  const rulesFor = (attributeClause: string, state: UniversalSpriteState, neutralPose?: { readonly row: number; readonly column: number }): string => {
    const mirrored = mirrorDirectionalSpriteState(state);
    if (mirrored === state) {
      return createSpriteRule(`html${attributeClause} ${selector}`, state, stateRows, layout, neutralPose);
    }
    return [
      createSpriteRule(`html:not([data-flip-x="true"])${attributeClause} ${selector}`, state, stateRows, layout, neutralPose),
      createSpriteRule(`html[data-flip-x="true"]${attributeClause} ${selector}`, mirrored, stateRows, layout, neutralPose),
    ].join("\n");
  };

  const reactionRules = Object.keys(stateRows).map((state) =>
    rulesFor(`[data-reaction-state="${state}"]`, state as UniversalSpriteState, state === "idle" ? layout.neutralPose : undefined));
  const motionRules = (Object.entries(motionToSpriteState) as Array<[PetMotionState, UniversalSpriteState]>)
    .filter(([motion]) => motion !== "idle")
    .map(([motion, state]) => rulesFor(`[data-motion-state="${motion}"]`, state));
  return [...reactionRules, ...motionRules].join("\n");
}

export function createInstalledSpriteStateCss(stateRows: Readonly<Record<UniversalSpriteState, SpriteStateDefinition>>, layout: CodexPetSpriteLayout): string {
  if (layout.version === 1) return createSpriteStateCss(".installed-sprite", stateRows);
  return `${createSpriteStateCss(".installed-sprite", stateRows, layout)}\n${createCodexV2GazeCss(".installed-sprite", layout)}`;
}

export function createCodexV2GazeCss(selector: ".sprite" | ".installed-sprite", layout: CodexPetSpriteLayout): string {
  if (layout.version !== 2) return "";
  return Array.from({ length: 16 }, (_, index) => {
    const position = getCodexV2GazeSpritePosition(index);
    if (!position) return "";
    const x = -(position.column * layout.frameWidth);
    const y = -(position.row * layout.frameHeight);
    return `html[data-codex-sprite-version="2"][data-paused="false"][data-reaction-state="idle"][data-motion-state="idle"][data-codex-gaze-index="${index}"] ${selector} { --sprite-row-y: ${y}px; --sprite-offset-x: ${x}px; --sprite-end-offset-x: ${x}px; --sprite-animation: none; animation: none; background-position: ${x}px ${y}px; }`;
  }).join("\n");
}

export function createSpriteRule(selector: string, state: UniversalSpriteState, stateRows: Readonly<Record<UniversalSpriteState, SpriteStateDefinition>>, layout: CodexPetSpriteLayout, neutralPose?: { readonly row: number; readonly column: number }): string {
  const row = stateRows[state];
  const iterations = "iterations" in row ? row.iterations : "infinite";
  const position = getCodexPetSpritePosition(layout, row, neutralPose !== undefined);
  const startOffset = -(position.startColumn * layout.frameWidth);
  const endOffset = -(position.endColumn * layout.frameWidth);
  const animation = position.animated
    ? " --sprite-animation: pet-frames var(--sprite-duration) steps(var(--sprite-frames)) var(--sprite-iterations);"
    : " --sprite-animation: none;";
  return `${selector} { --sprite-row-y: -${row.row * layout.frameHeight}px; --sprite-offset-x: ${startOffset}px; --sprite-end-offset-x: ${endOffset}px; --sprite-frames: ${row.frames}; --sprite-duration: ${row.durationMs}ms; --sprite-iterations: ${iterations};${animation} }`;
}

export function escapeCssUrl(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "");
}
