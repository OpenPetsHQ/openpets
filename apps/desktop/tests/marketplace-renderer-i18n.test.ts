import assert from "node:assert/strict";

import { en } from "../src/i18n/locales/en.js";
import { es419 } from "../src/i18n/locales/es-419.js";
import { fr } from "../src/i18n/locales/fr.js";
import { ja } from "../src/i18n/locales/ja.js";
import { ko } from "../src/i18n/locales/ko.js";
import { ptBR } from "../src/i18n/locales/pt-BR.js";
import { ru } from "../src/i18n/locales/ru.js";
import { zhHans } from "../src/i18n/locales/zh-Hans.js";
import { zhHant } from "../src/i18n/locales/zh-Hant.js";

// These renderer labels must be supplied by each locale, not silently fall back.
for (const [locale, messages] of Object.entries({ en, es419, fr, ja, ko, ptBR, ru, zhHans, zhHant })) {
  for (const key of ["nav.plugins", "route.plugins.title", "plugins.tab.browse", "plugins.filter.installed", "settings.general.checkForUpdates"] as const) {
    assert.ok(messages[key]?.trim(), `${locale} is missing ${key}`);
  }
}
