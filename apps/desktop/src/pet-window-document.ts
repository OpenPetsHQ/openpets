/** Shared envelope for the trusted pet document; callers own the style and body markup. */
export function createPetWindowDocument(options: {
  readonly language: string;
  readonly role: "default" | "agent";
  readonly displayName: string;
  readonly assetName: string;
  readonly reactionState: string;
  readonly dragRegion: "drag" | "no-drag";
  readonly flipped: boolean;
  readonly spriteVersion: 1 | 2;
  readonly paused: boolean;
  readonly title: string;
  readonly styles: string;
  readonly bodyHtml: string;
}): string {
  const escape = (value: string): string => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
  return `<!doctype html>
<html lang="${escape(options.language)}" data-pet-role="${options.role}" data-pet-display-name="${escape(options.displayName)}" data-pet-asset-name="${escape(options.assetName)}" data-reaction-state="${escape(options.reactionState)}" data-motion-state="idle" data-native-pet-drag="${options.dragRegion === "drag" ? "wayland" : "manual"}" data-flip-x="${options.flipped}" data-codex-sprite-version="${options.spriteVersion}" data-paused="${options.paused}" data-codex-gaze-index="neutral">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src file: data: blob:; media-src data: openpets-session-media:; connect-src openpets-session-media:; font-src file:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-src 'none'" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escape(options.title)}</title>
    <style>${options.styles}</style>
  </head>
  <body>${options.bodyHtml}</body>
</html>`;
}
