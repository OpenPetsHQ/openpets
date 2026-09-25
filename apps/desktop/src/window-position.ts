import type { BrowserWindow } from "electron";

/**
 * Electron's BrowserWindow.setPosition rejects -0 and non-finite numbers with
 * "Error processing argument at index N, conversion failure from", which
 * surfaces as an uncaught main-process exception. Math.round() returns -0 for
 * values in [-0.5, 0), so any animation that crosses x=0 or y=0 can hit it.
 */
export function toWindowCoordinate(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  return Math.round(value) + 0; // + 0 turns -0 into 0
}

/** setPosition that never throws on -0/NaN. Returns false if the move was skipped. */
export function setWindowPosition(
  window: Pick<BrowserWindow, "setPosition">,
  x: number,
  y: number,
  animate?: boolean,
): boolean {
  const safeX = toWindowCoordinate(x);
  const safeY = toWindowCoordinate(y);
  if (safeX === null || safeY === null) return false;
  if (animate === undefined) window.setPosition(safeX, safeY);
  else window.setPosition(safeX, safeY, animate);
  return true;
}
