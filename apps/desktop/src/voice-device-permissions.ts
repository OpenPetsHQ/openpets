export function isVoiceMediaPermissionAllowed(
  permission: string,
  url: string,
  details: unknown,
  captureDocumentUrls: readonly string[],
  speakerDocumentUrls: readonly string[],
): boolean {
  if (permission === "speaker-selection") return speakerDocumentUrls.includes(url);
  return permission === "media" && captureDocumentUrls.includes(url) && isAudioOnlyMediaRequest(details);
}

function isAudioOnlyMediaRequest(value: unknown): boolean {
  if (!value || typeof value !== "object" || !Array.isArray((value as { readonly mediaTypes?: unknown }).mediaTypes)) return false;
  const mediaTypes = (value as { readonly mediaTypes: readonly unknown[] }).mediaTypes;
  return mediaTypes.length === 1 && mediaTypes[0] === "audio";
}
