---
title: Official plugins
description: Reviewed OpenPets companion plugins, catalog lineup, bundling defaults, and companion-first behavior rules.
sidebar:
  label: Official plugins
---

OpenPets plugins are reviewed companion features that run through the desktop
plugin host. Users install and enable them from the Control Center. Maintainers
ship them through the plugin catalog, and plugin authors can study them as SDK v3
examples.

This page is intentionally practical. It answers:

- which plugins are in the current catalog
- which official plugins are bundled with the app
- which bundled plugins are enabled by default
- how OpenPets plugins should behave
- where to update code when the lineup changes

For the plugin architecture, permissions, runtime, sandbox, and packaging flow,
see [Plugin platform](/plugins). For the author-facing API, see
[Plugin SDK v3](/sdk).

## Current catalog lineup

The public plugin catalog is `web/public/plugins/catalog.v2.json`. The current
catalog contains thirteen official plugins and five community plugins.

| Plugin | Type | What it does |
| --- | --- | --- |
| Anxiety Aid Tools | Official | Guided breathing, muscle relaxation, grounding, guided meditation, peaceful visualization, and relaxing sounds, rendered around the pet. Content from Anxiety Aid Tools. |
| Calendar Airmail | Official | Delivers Google Calendar event reminders through a selected bundled courier sprite. |
| Morning & Evening Routine | Official | Runs morning and evening check-ins. |
| Focus Buddy | Official | Starts focus sessions and refreshes timer progress through the pet each minute. |
| Daily Fortune Cookie | Official | Shows scheduled or command-triggered fortune messages. |
| Launch Buddy | Official | Helps with launch/checklist moments. |
| Magic 8-Ball | Official | Answers command-driven yes/no style questions. |
| Mood Check-in | Official | Prompts lightweight mood logging and check-ins. |
| Simple Timer | Official | Runs a one-shot countdown timer with a pet HUD, pause controls, and an expiry alert. |
| Quick Reminders | Official | Creates reminders with due/missed alerts, snooze, done, status, optional notifications, and sound. |
| Virtual Pet | Official | Adds Tamagotchi-style state, actions, and a pinned HUD. |
| Water Reminder | Official | Runs hydration reminders on a configurable cadence. |
| System Resources | Official | Reports host CPU, RAM, optional GPU and system-volume Disk metrics in an integrated pinned HUD, with optional battery/network reporting and configurable alerts. |
| Vocabulary Drag & Drop | Community | Drag words to see definitions and translations in a natively scrollable HUD card. |
| Higgsfield Watch | Community | Catalog-listed community plugin. |
| Spotify Buddy | Community | Catalog-listed community plugin. |
| Walkabout | Community | Lets the pet roam, follow the cursor, or patrol. |
| Usage Buddy | Community | Reflects live Claude and Codex usage from a local usage monitor endpoint. |

Official plugin source lives under `plugins/official/`. Community catalog
plugins are labeled `publisherType: "community"` and are never bundled or
enabled by default.

## Bundled defaults

The desktop app can ship selected official plugins inside the application bundle.
Those defaults are defined in `apps/desktop/src/bundled-plugins.ts` and consumed by `apps/desktop/src/plugin-service.ts`.

| Default | Plugins |
| --- | --- |
| Bundled with the app | Quick Reminders, Simple Timer, Anxiety Aid Tools, Focus Buddy, Launch Buddy, Virtual Pet, System Resources |
| Enabled by default | Quick Reminders, Simple Timer, Anxiety Aid Tools, Focus Buddy, Launch Buddy |
| Bundled but disabled by default | Virtual Pet, System Resources |

A bundled plugin's saved enabled state wins over the default. A plugin newly
added to the bundled lineup has no saved state yet, so users who upgrade get it
with its default (enabled for the list above), not only fresh installs.

Bundled plugins are approved with their manifest permissions. Anxiety Aid Tools
is the one bundled plugin with `network` access, limited to its media host
(`r2.anxietyaidtools.com`); it downloads narration and soundscape audio only
when the user opens one of those practices, then serves it from the local cache.

Everything else is installable from the catalog, not preloaded into a fresh app
install.

The bundled plugins below expose their useful operations as typed Pet
Assistant capabilities when enabled. Their assistant operations use the same
durable domain state as their pet-menu controls, while the host conversation
owns the spoken or chat response. Simple Timer and Anxiety Aid Tools do not
register assistant capabilities yet; they are driven from the pet menu.

| Plugin | Assistant capabilities |
| --- | --- |
| Quick Reminders | Create, list, complete, snooze, and remove reminders. |
| Focus Buddy | Start, inspect, pause, resume, end, or skip to a break in a focus session. |
| Launch Buddy | Deliver the configured greeting on demand. |
| Virtual Pet | Inspect its status, then feed, play with, pet, or put it down for a nap. |
| System Resources | Read metrics and show or hide its pinned HUD. |

The same file also defines `staleBundledPluginIds`, a cleanup list for old
bundled plugins that should be removed during upgrade. Keep that list when old
plugin ids need a clean migration, but do not optimize new runtime behavior for
deprecated plugin names.

## Companion behavior rules

OpenPets plugins should feel like companion behaviors, not mini control panels.

- **Host-rendered UI.** Plugins describe bubbles, alerts, HUDs, commands,
  deliveries, sounds, schedules, and stored state. The desktop host validates
  and renders those effects.
- **No JSON editing for users.** Settings come from typed `configSchema` fields
  rendered by the Control Center.
- **Localized by default.** Manifests use `$t:` keys and code uses `ctx.t()`.
  Ship at least `locales/en.json`; add other locales when a plugin is part of
  the official lineup.
- **Small appliances beat giant knobs.** A plugin should do one clear thing and
  explain itself by name.
- **Commands belong on the pet.** Enabled plugins expose clear, verb-first
  commands through the default pet right-click menu. Bubble buttons and pinned
  HUDs handle in-the-moment actions such as snooze, done, feed, or dismiss.
- **State survives sleep and restart.** Reminders, routines, focus sessions, and
  virtual-pet stats persist through `ctx.storage` and reconcile after resume.
- **One icon style.** Official plugins declare a colour SVG under
  `assets.icons`, shown in the Control Center and the catalog. Use Google Noto
  Emoji (Apache 2.0), fetched from `https://api.iconify.design/noto/<name>.svg`,
  so the lineup reads as one set. A partner plugin may use its own brand mark
  instead (Anxiety Aid Tools uses the lotus from its logo). Icons render as
  images, so they cannot follow the app theme: avoid `currentColor` and dark
  strokes that disappear on the dark theme.

## Maintainer checklist

When plugin lineup, bundling, or catalog behavior changes:

1. Update `plugins/official/*/openpets.plugin.json` or the community plugin
   source.
2. Update `apps/desktop/src/plugin-service.ts` if bundled or default-enabled
   plugins changed.
3. Regenerate and commit the plugin catalog output under `web/public/plugins/`.
4. Update this page and [Plugin platform](/plugins) when behavior, permissions,
   commands, or packaging rules changed.
5. Run the plugin release validators listed in
   [Testing and validation](/testing-and-validation).

Do not leave an older plugin lineup in docs after changing catalog output. The
source of truth is the plugin source plus the generated catalog that the desktop
actually consumes.
