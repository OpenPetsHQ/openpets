export type ControlCenterRoute =
  | "dashboard"
  | "pets"
  | "settings"
  | "plugins"
  | "integrations"
  | "teams";

export type ControlCenterSettingsTab = "providers";

export type ControlCenterRouteTarget =
  | { readonly route: "settings"; readonly settingsTab?: ControlCenterSettingsTab }
  | { readonly route: Exclude<ControlCenterRoute, "settings">; readonly settingsTab?: never };

const controlCenterRoutes = new Set<ControlCenterRoute>([
  "dashboard",
  "pets",
  "settings",
  "plugins",
  "integrations",
  "teams",
]);

export function isControlCenterRoute(value: unknown): value is ControlCenterRoute {
  return typeof value === "string" && controlCenterRoutes.has(value as ControlCenterRoute);
}

export function normalizeControlCenterRoute(route: unknown): ControlCenterRoute {
  return isControlCenterRoute(route) ? route : "dashboard";
}

export function normalizeControlCenterRouteTarget(target: unknown): ControlCenterRouteTarget {
  if (typeof target === "string") return { route: normalizeControlCenterRoute(target) };
  if (!target || typeof target !== "object") return { route: "dashboard" };

  const candidate = target as { readonly route?: unknown; readonly settingsTab?: unknown };
  const route = normalizeControlCenterRoute(candidate.route);
  if (route === "settings" && candidate.settingsTab === "providers") {
    return { route, settingsTab: "providers" };
  }
  return { route };
}

export type DevControlCenterRouteResolution =
  | { readonly kind: "route"; readonly route: ControlCenterRoute }
  | { readonly kind: "target"; readonly target: ControlCenterRouteTarget }
  | { readonly kind: "invalid"; readonly rawValue: string }
  | null;

const maxInvalidRouteLogLength = 80;

export function resolveDevControlCenterRoute(
  rawValue: string | undefined,
  isPackaged: boolean,
): DevControlCenterRouteResolution {
  if (isPackaged || rawValue === undefined) return null;
  if (isControlCenterRoute(rawValue)) return { kind: "route", route: rawValue };
  if (rawValue === "providers") {
    return { kind: "target", target: { route: "settings", settingsTab: "providers" } };
  }

  return {
    kind: "invalid",
    rawValue: rawValue.slice(0, maxInvalidRouteLogLength).replace(/[\u0000-\u001f\u007f]/g, "�"),
  };
}
