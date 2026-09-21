import { app, BrowserWindow, shell } from "electron";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { debug, error as logError, warn } from "./logger.js";
import type { PluginSessionDescriptor, SessionInfo } from "./plugin-session-descriptor.js";

/**
 * The practice session Info window: a host-rendered, script-free page built
 * from the validated session descriptor's knowledge layer (how it works, the
 * science with linked studies, when to practice, tips, citations, disclaimer,
 * attribution). Opened from the overlay's Info button; one window at a time.
 *
 * Security: the page ships no JavaScript and a default-deny CSP. Every link
 * click is intercepted in the main process and only URLs present in the
 * validated descriptor may open, externally via the OS browser.
 */

let infoWindow: BrowserWindow | null = null;
let allowedUrls = new Set<string>();

const infoWindowSize = { width: 640, height: 780 };
const maxLogoBytes = 256 * 1024;

export function showSessionInfoWindow(descriptor: PluginSessionDescriptor, chrome: Record<string, string>): void {
  const info = descriptor.info;
  if (!info) return;
  allowedUrls = collectAllowedUrls(info);

  if (infoWindow && !infoWindow.isDestroyed()) {
    void renderInfoWindow(infoWindow, descriptor, chrome);
    infoWindow.show();
    infoWindow.focus();
    return;
  }

  const window = new BrowserWindow({
    title: descriptor.title,
    width: infoWindowSize.width,
    height: infoWindowSize.height,
    minWidth: 480,
    minHeight: 520,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    show: false,
    backgroundColor: "#f6f8ff",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  infoWindow = window;
  window.setMenu(null);

  window.webContents.setWindowOpenHandler(({ url }) => {
    openAllowedUrl(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith("file://")) return;
    event.preventDefault();
    openAllowedUrl(url);
  });
  window.webContents.on("will-redirect", (event) => event.preventDefault());
  window.on("closed", () => {
    if (infoWindow === window) infoWindow = null;
  });

  void renderInfoWindow(window, descriptor, chrome).then(() => {
    if (!window.isDestroyed()) window.show();
  });
}

/** Re-render the open window after a descriptor update; no-op when closed. */
export function refreshSessionInfoWindowIfOpen(descriptor: PluginSessionDescriptor, chrome: Record<string, string>): void {
  if (!infoWindow || infoWindow.isDestroyed() || !descriptor.info) return;
  allowedUrls = collectAllowedUrls(descriptor.info);
  void renderInfoWindow(infoWindow, descriptor, chrome);
}

export function closeSessionInfoWindow(): void {
  if (infoWindow && !infoWindow.isDestroyed()) infoWindow.close();
  infoWindow = null;
}

function openAllowedUrl(url: string): void {
  if (!allowedUrls.has(url)) {
    warn("pet.session", "info window url rejected", {});
    return;
  }
  debug("pet.session", "info window url opened", {});
  void shell.openExternal(url);
}

function collectAllowedUrls(info: SessionInfo): Set<string> {
  const urls = new Set<string>();
  for (const citation of info.citations) {
    if (citation.url) urls.add(citation.url);
  }
  for (const section of info.sections) {
    for (const card of section.cards ?? []) {
      if (card.url) urls.add(card.url);
    }
  }
  if (info.site) urls.add(info.site.url);
  return urls;
}

async function renderInfoWindow(window: BrowserWindow, descriptor: PluginSessionDescriptor, chrome: Record<string, string>): Promise<void> {
  try {
    const html = buildInfoWindowHtml(descriptor, chrome);
    const dir = join(app.getPath("userData"), "rendered-pets");
    await mkdir(dir, { recursive: true });
    const filePath = join(dir, "session-info.html");
    await writeFile(filePath, html, "utf8");
    if (window.isDestroyed()) return;
    await window.loadFile(filePath);
  } catch (error) {
    logError("pet.session", "info window render failed", error instanceof Error ? error : { error });
  }
}

function buildInfoWindowHtml(descriptor: PluginSessionDescriptor, chrome: Record<string, string>): string {
  const info = descriptor.info;
  if (!info) return "<!doctype html><html><body></body></html>";
  const pattern = descriptor.patterns.find((candidate) => candidate.id === descriptor.patternId) ?? descriptor.patterns[0];

  const logoMarkup = readLogoSvg(info.logoSvgPath) ?? fallbackLogoMarkup();
  const introMarkup = info.intro ? `<p class="intro">${escapeHtml(info.intro)}</p>` : "";
  const sectionsMarkup = info.sections.map((section, index) => buildSectionMarkup(section, index, chrome)).join("");
  const citationsMarkup = buildCitationsMarkup(info, chrome);
  const disclaimerMarkup = info.disclaimer ? `<div class="disclaimer">${escapeHtml(info.disclaimer)}</div>` : "";
  const siteMarkup = info.site
    ? `<div class="site"><a class="site-link" href="${escapeHtml(info.site.url)}">${escapeHtml(info.site.label)}</a><span class="site-url">${escapeHtml(info.site.url.replace(/^https:\/\//, "").replace(/\/$/, ""))}</span></div>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src file: data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-src 'none'" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(descriptor.title)}</title>
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      background: linear-gradient(180deg, #f8faff 0%, #f2f5fe 55%, #eef1fc 100%);
      color: #1e293b;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      -webkit-font-smoothing: antialiased;
    }
    .page {
      max-width: 620px;
      margin: 0 auto;
      padding: 34px 30px 40px;
    }
    .hero {
      text-align: center;
      margin-bottom: 26px;
    }
    .hero-logo {
      display: inline-flex;
      width: 64px;
      height: 64px;
      color: #0f172a;
      margin-bottom: 10px;
    }
    .hero-logo svg {
      width: 100%;
      height: 100%;
    }
    .hero-title {
      font-size: 23px;
      font-weight: 800;
      letter-spacing: -0.02em;
      color: #0f172a;
      margin: 0;
    }
    .hero-subtitle {
      margin: 5px 0 0;
      font-size: 13px;
      font-weight: 600;
      color: #64748b;
    }
    .hero-rhythm {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      margin-top: 13px;
      padding: 6px 14px;
      border-radius: 999px;
      background: rgba(59, 130, 246, 0.09);
      border: 1px solid rgba(59, 130, 246, 0.22);
      font-size: 12px;
      font-weight: 700;
      color: #1d4ed8;
    }
    .intro {
      font-size: 14px;
      line-height: 1.75;
      font-weight: 500;
      color: #334155;
      text-align: center;
      margin: 0 0 30px;
    }
    .section {
      margin: 0 0 30px;
    }
    .section-heading {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.09em;
      color: #2563eb;
      margin: 0 0 12px;
    }
    .section-heading::after {
      content: "";
      flex: 1 1 auto;
      height: 1px;
      background: linear-gradient(90deg, rgba(37, 99, 235, 0.25), transparent);
    }
    .section-body {
      font-size: 13.5px;
      line-height: 1.75;
      font-weight: 500;
      color: #334155;
      margin: 0 0 12px;
      white-space: pre-line;
    }
    .items {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
      gap: 8px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .items li {
      display: flex;
      align-items: flex-start;
      gap: 9px;
      padding: 10px 12px;
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.85);
      border: 1px solid rgba(148, 163, 184, 0.3);
      font-size: 12.5px;
      line-height: 1.55;
      font-weight: 500;
      color: #334155;
    }
    .items .tick {
      flex-shrink: 0;
      width: 16px;
      height: 16px;
      margin-top: 1px;
      border-radius: 50%;
      display: grid;
      place-items: center;
      background: rgba(16, 185, 129, 0.14);
      color: #059669;
    }
    .items .tick svg {
      width: 10px;
      height: 10px;
    }
    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
      gap: 10px;
    }
    .card {
      padding: 14px 15px;
      border-radius: 15px;
      background: rgba(255, 255, 255, 0.9);
      border: 1px solid rgba(148, 163, 184, 0.32);
      box-shadow: 0 4px 14px rgba(15, 23, 42, 0.05);
    }
    .card-head {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0 0 7px;
    }
    .card-icon {
      flex-shrink: 0;
      width: 26px;
      height: 26px;
      display: grid;
      place-items: center;
      border-radius: 9px;
      background: linear-gradient(140deg, rgba(59, 130, 246, 0.14), rgba(99, 102, 241, 0.12));
      color: #2563eb;
    }
    .card-icon svg {
      width: 14px;
      height: 14px;
    }
    .card-title {
      font-size: 12.5px;
      font-weight: 800;
      color: #0f172a;
      margin: 0;
      letter-spacing: -0.01em;
    }
    .card-body {
      font-size: 12px;
      line-height: 1.65;
      font-weight: 500;
      color: #475569;
      margin: 0;
    }
    .card-link {
      display: inline-block;
      margin-top: 9px;
      font-size: 11.5px;
      font-weight: 700;
      color: #2563eb;
      text-decoration: none;
      border-bottom: 1px solid rgba(37, 99, 235, 0.35);
      padding-bottom: 1px;
    }
    .card-link:hover {
      color: #1d4ed8;
      border-bottom-color: #1d4ed8;
    }
    .citations {
      margin: 0 0 26px;
      padding: 16px 18px;
      border-radius: 16px;
      background: rgba(37, 99, 235, 0.05);
      border: 1px solid rgba(37, 99, 235, 0.14);
    }
    .citations-title {
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.09em;
      color: #2563eb;
      margin: 0 0 10px;
    }
    .citation {
      display: flex;
      gap: 9px;
      font-size: 11.5px;
      line-height: 1.6;
      color: #475569;
      margin: 0 0 8px;
    }
    .citation:last-child { margin-bottom: 0; }
    .citation-index {
      flex-shrink: 0;
      font-weight: 800;
      color: #94a3b8;
    }
    .citation a {
      color: #2563eb;
      font-weight: 700;
      text-decoration: none;
      border-bottom: 1px solid rgba(37, 99, 235, 0.35);
      white-space: nowrap;
    }
    .disclaimer {
      margin: 0 0 24px;
      padding: 13px 15px;
      border-radius: 13px;
      background: rgba(217, 119, 6, 0.07);
      border: 1px solid rgba(217, 119, 6, 0.24);
      font-size: 12px;
      line-height: 1.65;
      font-weight: 600;
      color: #92400e;
    }
    .site {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      padding-top: 6px;
    }
    .site-link {
      display: inline-block;
      padding: 9px 22px;
      border-radius: 999px;
      background: linear-gradient(135deg, #3b82f6, #6366f1);
      color: #ffffff;
      font-size: 13px;
      font-weight: 800;
      text-decoration: none;
      box-shadow: 0 8px 20px rgba(59, 130, 246, 0.35);
    }
    .site-url {
      font-size: 11px;
      font-weight: 600;
      color: #94a3b8;
    }
  </style>
</head>
<body>
  <div class="page">
    <header class="hero">
      <span class="hero-logo" aria-hidden="true">${logoMarkup}</span>
      <h1 class="hero-title">${escapeHtml(descriptor.title)}</h1>
      ${descriptor.subtitle ? `<p class="hero-subtitle">${escapeHtml(descriptor.subtitle)}</p>` : ""}
      ${pattern ? `<div class="hero-rhythm">${escapeHtml(pattern.name)}${pattern.hint ? ` · ${escapeHtml(pattern.hint)}` : ""}</div>` : ""}
    </header>
    ${introMarkup}
    ${sectionsMarkup}
    ${citationsMarkup}
    ${disclaimerMarkup}
    ${siteMarkup}
  </div>
</body>
</html>`;
}

const tickSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="3.2" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>';

/** Named card icons (Lucide via better-icons/Iconify, normalized to stroke-only). */
const cardIconSvgs: Record<string, string> = {
  "activity": '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>',
  "wind": '<path d="M12.8 19.6A2 2 0 1 0 14 16H2m15.5-8a2.5 2.5 0 1 1 2 4H2m7.8-7.6A2 2 0 1 1 11 8H2"/>',
  "trending-down": '<path d="M16 17h6v-6"/><path d="m22 17l-8.5-8.5l-5 5L2 7"/>',
  "heart-pulse": '<path d="M2 9.5a5.5 5.5 0 0 1 9.591-3.676a.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5"/><path d="M3.22 13H9.5l.5-1l2 4.5l2-7l1.5 3.5h5.27"/>',
  "shield-check": '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12l2 2l4-4"/>',
  "brain": '<path d="M12 18V5m3 8a4.17 4.17 0 0 1-3-4a4.17 4.17 0 0 1-3 4m8.598-6.5A3 3 0 1 0 12 5a3 3 0 1 0-5.598 1.5"/><path d="M17.997 5.125a4 4 0 0 1 2.526 5.77"/><path d="M18 18a4 4 0 0 0 2-7.464"/><path d="M19.967 17.483A4 4 0 1 1 12 18a4 4 0 1 1-7.967-.517"/><path d="M6 18a4 4 0 0 1-2-7.464"/><path d="M6.003 5.125a4 4 0 0 0-2.526 5.77"/>',
  "person-standing": '<circle cx="12" cy="5" r="1"/><path d="m9 20l3-6l3 6M6 8l6 2l6-2m-6 2v4"/>',
  "armchair": '<path d="M19 9V6a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v3"/><path d="M3 16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5a2 2 0 0 0-4 0v1.5a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5V11a2 2 0 0 0-4 0zm2 2v2m14-2v2"/>',
  "calendar-check": '<path d="M8 2v3m8-3v3"/><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18M9 15l2 2l4-4"/>',
  "leaf": '<path d="M11 20a10 10 0 0 0 10-10a25.9 25.9 0 0 0-1.04-7.281a1 1 0 0 0-1.755-.325C15.833 5.5 13 5.5 9.8 6.1A7 7 0 0 0 11 20"/><path d="M2 21a5 5 0 0 1 2.911-4.544C7.613 15.212 8.351 15.24 11 13"/>',
  "sparkles": '<path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594zM20 2v4m2-2h-4"/><circle cx="4" cy="20" r="2"/>',
  "timer": '<path d="M10 2h4m-2 12l3-3"/><circle cx="12" cy="14" r="8"/>',
};

function cardIconMarkup(icon: string | undefined): string {
  const paths = icon ? cardIconSvgs[icon] : undefined;
  if (!paths) return "";
  return `<span class="card-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2">${paths}</svg></span>`;
}

function buildSectionMarkup(section: { heading: string; body?: string; items?: readonly string[]; cards?: readonly { title: string; body: string; url?: string; icon?: string }[] }, index: number, chrome: Record<string, string>): string {
  void index;
  const parts: string[] = [`<h2 class="section-heading">${escapeHtml(section.heading)}</h2>`];
  if (section.body) parts.push(`<p class="section-body">${escapeHtml(section.body)}</p>`);
  if (section.items && section.items.length > 0) {
    const items = section.items
      .map((item) => `<li><span class="tick">${tickSvg}</span><span>${escapeHtml(item)}</span></li>`)
      .join("");
    parts.push(`<ul class="items">${items}</ul>`);
  }
  if (section.cards && section.cards.length > 0) {
    const cards = section.cards.map((card) => {
      const link = card.url
        ? `<a class="card-link" href="${escapeHtml(card.url)}">${escapeHtml(chrome.readStudy ?? "Read the study")} →</a>`
        : "";
      const head = `<div class="card-head">${cardIconMarkup(card.icon)}<h3 class="card-title">${escapeHtml(card.title)}</h3></div>`;
      return `<div class="card">${head}<p class="card-body">${escapeHtml(card.body)}</p>${link}</div>`;
    }).join("");
    parts.push(`<div class="cards">${cards}</div>`);
  }
  return `<section class="section">${parts.join("")}</section>`;
}

function buildCitationsMarkup(info: SessionInfo, chrome: Record<string, string>): string {
  if (info.citations.length === 0) return "";
  const rows = info.citations.map((citation, index) => {
    const link = citation.url
      ? ` <a href="${escapeHtml(citation.url)}">${escapeHtml(chrome.openStudy ?? "PMC")}</a>`
      : "";
    return `<p class="citation"><span class="citation-index">${index + 1}.</span><span>${escapeHtml(citation.label)}${link}</span></p>`;
  }).join("");
  return `<div class="citations"><h2 class="citations-title">${escapeHtml(chrome.references ?? "References")}</h2>${rows}</div>`;
}

function readLogoSvg(logoSvgPath: string | undefined): string | null {
  if (!logoSvgPath) return null;
  try {
    const source = readFileSync(logoSvgPath, "utf8");
    if (source.length > maxLogoBytes) return null;
    if (!source.trimStart().startsWith("<svg")) return null;
    return source;
  } catch {
    return null;
  }
}

function fallbackLogoMarkup(): string {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.6" aria-hidden="true"><path d="M11 20a10 10 0 0 0 10-10a25.9 25.9 0 0 0-1.04-7.281a1 1 0 0 0-1.755-.325C15.833 5.5 13 5.5 9.8 6.1A7 7 0 0 0 11 20"/><path d="M2 21a5 5 0 0 1 2.911-4.544C7.613 15.212 8.351 15.24 11 13"/></svg>';
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
