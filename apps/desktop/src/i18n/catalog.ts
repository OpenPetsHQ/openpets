// Pure i18n catalog: types, locale tables, and resolution helpers with NO
// Electron dependency, so it is safe to import from anywhere (main process,
// tests, and — if ever bundled — the renderer). The stateful main-process
// wrapper lives in ./index.ts.
import { en } from "./locales/en.js";
import { ja } from "./locales/ja.js";
import { ko } from "./locales/ko.js";
import { zhHans } from "./locales/zh-Hans.js";
import { zhHant } from "./locales/zh-Hant.js";
import { ptBR } from "./locales/pt-BR.js";
import { es419 } from "./locales/es-419.js";
import { fr } from "./locales/fr.js";

export type MessageKey = keyof typeof en;
export type Messages = Record<MessageKey, string>;

export const SUPPORTED_LOCALES = ["en", "ja", "ko", "zh-Hans", "zh-Hant", "pt-BR", "es-419", "fr"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

/** `"system"` follows the OS locale; an explicit locale pins it. */
export type LocalePreference = "system" | Locale;

// Endonyms: each language labels itself in its own script, so the picker reads
// naturally regardless of the active UI locale.
export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  ja: "日本語",
  ko: "한국어",
  "zh-Hans": "简体中文",
  "zh-Hant": "繁體中文",
  "pt-BR": "Português (Brasil)",
  "es-419": "Español (Latinoamérica)",
  fr: "Français",
};

const catalogs: Record<Locale, Partial<Messages>> = {
  en,
  ja,
  ko,
  "zh-Hans": zhHans,
  "zh-Hant": zhHant,
  "pt-BR": ptBR,
  "es-419": es419,
  fr,
};

export function isSupportedLocale(value: unknown): value is Locale {
  return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/** Replace `{name}` placeholders; unknown placeholders are left untouched. */
export function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match,
  );
}

export function translate(locale: Locale, key: MessageKey, vars?: Record<string, string | number>): string {
  const template = catalogs[locale]?.[key] ?? en[key];
  return interpolate(template, vars);
}

/** Fully-resolved message map for a locale (English-backed), for the renderer. */
export function getMessages(locale: Locale): Messages {
  return { ...en, ...catalogs[locale] };
}

/** Map a raw BCP-47 tag (e.g. `app.getLocale()`) to a supported locale. */
export function resolveLocale(raw: string | null | undefined): Locale {
  if (isSupportedLocale(raw)) return raw;
  if (!raw) return "en";
  const tag = raw.toLowerCase();
  if (tag.startsWith("ja")) return "ja";
  if (tag.startsWith("ko")) return "ko";
  if (tag.startsWith("pt")) return "pt-BR";
  if (tag.startsWith("es")) return "es-419";
  if (tag.startsWith("fr")) return "fr";
  if (tag.startsWith("zh")) {
    // Traditional script for Taiwan / Hong Kong / Macau or an explicit Hant tag.
    return /hant|tw|hk|mo/.test(tag) ? "zh-Hant" : "zh-Hans";
  }
  return "en";
}

/** Resolve a stored preference to a concrete locale, given the OS locale. */
export function resolvePreference(preference: LocalePreference, systemLocale: string | null | undefined): Locale {
  return preference === "system" ? resolveLocale(systemLocale) : preference;
}
