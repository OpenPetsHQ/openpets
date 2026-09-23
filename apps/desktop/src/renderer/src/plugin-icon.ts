/** Plugin icons reach the renderer only as base64 SVG data URLs. */
export function isPluginIconDataUrl(value: string | undefined): value is string {
  return typeof value === "string" && /^data:image\/svg\+xml;base64,[a-z0-9+/=]+$/iu.test(value);
}
