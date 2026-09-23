/**
 * Official plugins copied into every desktop package by electron-builder.
 * Keep this list next to the runtime seeding contract so packaging checks and
 * startup cannot silently drift apart.
 */
export const bundledOfficialPluginIds = [
  "openpets.reminders",
  "openpets.simple-timer",
  "openpets.anxiety-aid-tools",
  "openpets.focus-buddy",
  "openpets.launch-buddy",
  "openpets.fortune-cookie",
  "openpets.virtual-pet",
  "openpets.system-resources",
] as const;
