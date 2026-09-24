import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { computeEffectiveWaylandBackend, shouldPetWindowBeFocusable } from "../src/wayland-backend.js";

// ─── real-function predicate tests ───────────────────────────────────────────
// These exercise the REAL production predicate — the pure, Electron-free core
// that pet-window.ts's isEffectiveWaylandBackend() delegates to — so the test
// and production logic cannot drift. The Electron-bound runtime wiring
// (app.commandLine.getSwitchValue / process.env) and the one-time cache live in
// pet-window.ts; the main.ts x11-forcing decision is guarded separately by
// check-packaging-contract.ts.

describe("computeEffectiveWaylandBackend (production predicate)", () => {
  it("returns false on non-Linux platforms", () => {
    assert.equal(computeEffectiveWaylandBackend("darwin", "", "wayland", "/run/wayland-0"), false);
    assert.equal(computeEffectiveWaylandBackend("win32", "", "wayland", "/run/wayland-0"), false);
  });

  it("returns true when the ozone switch is explicitly wayland", () => {
    assert.equal(computeEffectiveWaylandBackend("linux", "wayland", undefined, undefined), true);
    assert.equal(computeEffectiveWaylandBackend("linux", "wayland", "x11", undefined), true);
  });

  it("returns false when the ozone switch is explicitly x11 (the forced default on Linux)", () => {
    assert.equal(computeEffectiveWaylandBackend("linux", "x11", "wayland", "/run/wayland-0"), false);
  });

  it("falls back to XDG_SESSION_TYPE when ozone is auto/empty", () => {
    assert.equal(computeEffectiveWaylandBackend("linux", "", "wayland", undefined), true);
    assert.equal(computeEffectiveWaylandBackend("linux", "auto", "wayland", undefined), true);
    assert.equal(computeEffectiveWaylandBackend("linux", "", "x11", undefined), false);
  });

  it("falls back to WAYLAND_DISPLAY when ozone is auto/empty and XDG_SESSION_TYPE is absent", () => {
    assert.equal(computeEffectiveWaylandBackend("linux", "", undefined, "/run/user/1000/wayland-0"), true);
    assert.equal(computeEffectiveWaylandBackend("linux", "", undefined, undefined), false);
    assert.equal(computeEffectiveWaylandBackend("linux", "", undefined, ""), false);
  });
});

describe("shouldPetWindowBeFocusable", () => {
  it("keeps passive native-Wayland pet windows non-focusable", () => {
    assert.equal(shouldPetWindowBeFocusable("linux", true, false), false);
    assert.equal(shouldPetWindowBeFocusable("linux", true), false);
  });

  it("keeps passive X11/XWayland pet windows focusable (#227)", () => {
    // A window created with focusable: false latches WM_HINTS.input = False
    // at map time on X11; some window managers (KWin included) never honor a
    // later setFocusable(true), so passive X11 windows must start focusable.
    assert.equal(shouldPetWindowBeFocusable("linux", false, false), true);
    assert.equal(shouldPetWindowBeFocusable("linux", false), true);
  });

  it("allows Linux pet windows with interactive inputs to receive focus", () => {
    assert.equal(shouldPetWindowBeFocusable("linux", true, true), true);
    assert.equal(shouldPetWindowBeFocusable("linux", false, true), true);
  });

  it("preserves focusable pet windows on macOS and Windows", () => {
    assert.equal(shouldPetWindowBeFocusable("darwin", false, false), true);
    assert.equal(shouldPetWindowBeFocusable("darwin", false, true), true);
    assert.equal(shouldPetWindowBeFocusable("win32", false, false), true);
    assert.equal(shouldPetWindowBeFocusable("win32", false, true), true);
  });
});

describe("isLayerShellBackendRequested (production predicate)", () => {
  it("requires Linux and the exact native layer-shell opt-in value", async () => {
    const { isLayerShellBackendRequested } = await import("../src/wayland-backend.js");
    assert.equal(isLayerShellBackendRequested("linux", { OPENPETS_NATIVE_WAYLAND: "1" }), true);
    assert.equal(isLayerShellBackendRequested("linux", { OPENPETS_NATIVE_WAYLAND: "0" }), false);
    assert.equal(isLayerShellBackendRequested("linux", { OPENPETS_NATIVE_WAYLAND: "true" }), false);
    assert.equal(isLayerShellBackendRequested("linux", {}), false);
    assert.equal(isLayerShellBackendRequested("darwin", { OPENPETS_NATIVE_WAYLAND: "1" }), false);
    assert.equal(isLayerShellBackendRequested("win32", { OPENPETS_NATIVE_WAYLAND: "1" }), false);
  });
});
