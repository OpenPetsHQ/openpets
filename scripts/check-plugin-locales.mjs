#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const officialDir = join(repoRoot, "plugins", "official");
const communityDir = join(repoRoot, "plugins", "community");

const errors = [];

async function pathExists(path) {
  try {
    await readdir(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function readLocaleJson(path) {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      errors.push(`${relative(repoRoot, path)} must be a JSON object.`);
      return {};
    }
    return flattenLocale(parsed);
  } catch (error) {
    errors.push(`${relative(repoRoot, path)} is not valid JSON: ${error.message}`);
    return {};
  }
}

function flattenLocale(value, prefix = "") {
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      Object.assign(out, flattenLocale(entry, fullKey));
    } else if (typeof entry === "string") {
      out[fullKey] = entry;
    } else {
      errors.push(`Locale key ${fullKey} must be a string.`);
    }
  }
  return out;
}

function compareKeys(pluginName, localeName, englishKeys, localeKeys) {
  const localeKeySet = new Set(localeKeys);
  const englishKeySet = new Set(englishKeys);
  const missing = englishKeys.filter((key) => !localeKeySet.has(key));
  const extra = localeKeys.filter((key) => !englishKeySet.has(key));
  for (const key of missing) errors.push(`${pluginName}/${localeName} is missing key: ${key}`);
  for (const key of extra) errors.push(`${pluginName}/${localeName} has extra key not in en: ${key}`);
}

async function checkPlugin(sourceDir, plugin) {
  const localesDir = join(sourceDir, plugin.name, "locales");
  const entries = (await pathExists(localesDir))
    ? (await readdir(localesDir, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json") && !entry.name.startsWith("."))
      .sort((a, b) => a.name.localeCompare(b.name))
    : [];

  if (sourceDir === officialDir && !entries.some((entry) => entry.name === "fr.json")) {
    errors.push(`${plugin.name}/locales is missing required French locale fr.json.`);
  }

  if (entries.length === 0) return;
  if (!entries.some((entry) => entry.name === "en.json")) {
    errors.push(`${plugin.name}/locales has locale files but no en.json source locale.`);
    return;
  }

  const english = await readLocaleJson(join(localesDir, "en.json"));
  const englishKeys = Object.keys(english).sort();
  for (const entry of entries) {
    if (entry.name === "en.json") continue;
    const locale = await readLocaleJson(join(localesDir, entry.name));
    compareKeys(plugin.name, entry.name, englishKeys, Object.keys(locale).sort());
  }
}

async function checkPluginSource(sourceDir) {
  if (!(await pathExists(sourceDir))) return;
  const plugins = (await readdir(sourceDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const plugin of plugins) await checkPlugin(sourceDir, plugin);
}

await checkPluginSource(officialDir);
await checkPluginSource(communityDir);

if (errors.length > 0) {
  console.error(`Plugin locale key check failed with ${errors.length} issue${errors.length === 1 ? "" : "s"}:`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Plugin locale key check passed.");
