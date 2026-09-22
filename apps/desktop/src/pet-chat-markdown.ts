/** Escape text before applying the deliberately small chat markdown subset. */
export function escapeHtml(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Render the markdown understood by the in-pet chat transcript.
 *
 * This is intentionally not a general markdown parser. Keeping the supported
 * subset explicit prevents the preload from turning assistant text into an
 * unexpected HTML surface.
 */
export function renderMarkdown(text: unknown): string {
  if (typeof text !== "string" || text.length === 0) return "";

  let safe = escapeHtml(text);
  safe = safe.replace(/```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```/g, (_match, _language, code: string) => {
    return `<pre class="chat-code-block"><code>${code.trim()}</code></pre>`;
  });
  safe = safe.replace(/`([^`]+)`/g, '<code class="chat-code-inline">$1</code>');
  safe = safe.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  safe = safe.replace(/\*([^*]+)\*/g, "<em>$1</em>");

  const lines = safe.split("\n");
  let inList = false;
  const processedLines: string[] = [];

  for (const line of lines) {
    const listMatch = line.match(/^(\s*)[-*]\s+(.*)$/);
    if (listMatch) {
      if (!inList) {
        processedLines.push("<ul>");
        inList = true;
      }
      processedLines.push(`<li>${listMatch[2]}</li>`);
      continue;
    }

    if (inList) {
      processedLines.push("</ul>");
      inList = false;
    }
    processedLines.push(line);
  }

  if (inList) processedLines.push("</ul>");

  const rendered = processedLines
    .join("\n")
    .replace(/\n\s*(?=<ul>)/g, "")
    .replace(/<\/ul>\n\s*/g, "</ul>");

  return rendered.replace(/(?<!<\/pre>|<\/ul>|<\/li>)\n/g, "<br>");
}
