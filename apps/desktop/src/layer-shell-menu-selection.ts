export interface LayerShellMenuSelection {
  readonly menuId: number;
  readonly index: number;
}

export function isCurrentLayerShellMenuSelection(value: unknown, currentMenuId: number): value is LayerShellMenuSelection {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return "menuId" in value
    && typeof value.menuId === "number"
    && Number.isSafeInteger(value.menuId)
    && value.menuId === currentMenuId
    && "index" in value
    && typeof value.index === "number"
    && Number.isSafeInteger(value.index)
    && value.index >= 0;
}
