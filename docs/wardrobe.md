---
description: How OpenPets wardrobes work — outfits, schedules, user choices, packaging, catalog distribution, compatibility with older apps, and where to extend it.
---

# Wardrobe and outfits

A pet can change how it looks over time: night pajamas, a weekend look,
seasonal and holiday outfits. This page is the single reference for that
feature — the vocabulary, the `pet.json` contract, how the app decides what a
pet wears, how wardrobe pets are packaged and published, and what stays
compatible with older apps. For the general pet model see [Pets](/pets); for
catalog contracts see [Catalogs](/catalog).

## Vocabulary

These terms are deliberate; use them in code, UI, and docs.

| Term | Meaning |
|------|---------|
| **Pet** | The installable unit. Unchanged — there is no separate "bundle" or "pack" format (Team Packs already use "pack"). |
| **Wardrobe** | A pet's optional set of outfits plus its schedule. A pet *has* a wardrobe. |
| **Outfit** | A complete alternate atlas for the same pet. Same layout, so every animation still works. |
| **Default outfit** | The pet's base `spritesheetPath`. Id `default`, always present, never declared. |
| **Schedule** | Ordered rules saying when to wear which outfit. The first matching rule wins. |
| **Creator schedule** | The schedule shipped in `pet.json`. |
| **User schedule** | The user's edited copy; replaces the creator schedule for that pet. |
| **Always wear** | The user's fixed outfit choice; pauses the schedule. "Automatic" means no fixed choice. |
| **Base ZIP / wardrobe ZIP** | Catalog packaging: the outfit-free package every app can install, and the full package with `outfits/`. |

## What users see

- **Pet context menu → Outfit**: *Automatic · {current scheduled outfit}*,
  *Default*, each outfit (checkmark on the active choice), and *Edit
  Wardrobe…*, which opens the pet's Control Center detail.
- **Control Center → Pets → pet detail → Wardrobe**:
  - outfit cards with animated previews; *Now* marks what the pet wears,
    *Always* marks a fixed choice; clicking a card toggles "always wear";
  - a status line (following the schedule vs. always wearing X) with
    *Follow schedule*;
  - the schedule: enable/disable, reorder, edit, delete, add rule, *Reset to
    pet's schedule*; *Active now* marks the matching rule;
  - *Get outfits* / *Update outfits* when the catalog has a newer wardrobe
    package than the installed copy (see [Upgrading installed pets](#upgrading-installed-pets)).
- Pets without a wardrobe show none of this and behave exactly as before.

## The `pet.json` contract

`wardrobe` is an optional top-level field:

```json
{
  "id": "mochi",
  "displayName": "Mochi",
  "description": "A sleepy cat",
  "spritesheetPath": "spritesheet.webp",
  "spriteVersionNumber": 2,
  "wardrobe": {
    "outfits": [
      { "id": "pajamas", "displayName": "Pajamas", "spritesheetPath": "outfits/pajamas.webp" },
      { "id": "weekend", "displayName": "Weekend", "spritesheetPath": "outfits/weekend.webp" },
      { "id": "santa",   "displayName": "Santa",   "spritesheetPath": "outfits/santa.svg" }
    ],
    "schedule": [
      { "outfit": "santa",   "when": { "dates": { "from": "12-20", "to": "12-26" } } },
      { "outfit": "pajamas", "when": { "time":  { "from": "22:00", "to": "07:00" } } },
      { "outfit": "weekend", "when": { "days":  ["sat", "sun"] } }
    ]
  }
}
```

Package layout:

```txt
mochi/
  pet.json
  spritesheet.webp
  outfits/
    pajamas.webp
    weekend.webp
    santa.svg
```

### Outfits

- 1–16 outfits. `id` matches `^[a-z0-9][a-z0-9_-]{0,31}$`, unique, never
  `default`. `displayName` is 1–40 characters.
- `spritesheetPath` must be exactly `outfits/{id}.webp` or `outfits/{id}.svg`.
- Each outfit atlas must match the pet's own layout (V1 8×9 or V2 8×11, same
  pixel size) and passes the same validation as the base atlas (V2 WebP
  checks, the static SVG profile). Formats may mix: a WebP pet can have an SVG
  outfit. The pet's `gazeAnchor` applies to every outfit.
- The `outfits/` folder must contain **exactly** the declared atlases; a
  missing or extra file rejects the package.

### Schedule rules

- 0–32 rules, evaluated **in order; the first matching enabled rule wins**.
  No match means the default outfit.
- `outfit` names a declared outfit or `default` (so a rule can switch back).
- `when` needs at least one condition; every present condition must match:
  - `time: { from, to }` — local `HH:MM`, `to` exclusive, `from ≠ to`; wraps
    midnight when `to < from` (`22:00`–`07:00`).
  - `days: [...]` — any of `sun mon tue wed thu fri sat`, non-empty.
  - `dates: { from, to }` — `MM-DD`, inclusive, repeats every year; wraps the
    new year when `to < from` (`12-20`–`01-02`). `02-29` is valid.
- Conditions are evaluated independently on the current local moment:
  `{ days: ["fri"], time: 22:00–07:00 }` matches Friday 23:00 but not Saturday
  02:00.
- `enabled: false` keeps a rule but never matches it (mainly for user
  schedules).

Order is the priority model on purpose: creators put holidays first, then
time-of-day, then broad rules, and users reorder by dragging rows. "Most
specific wins" was rejected as harder to explain.

## Which outfit a pet wears

Highest precedence first:

1. *(reserved)* a plugin override — see [Future work](#future-work);
2. the user's **always wear** outfit;
3. the **user schedule**, when the user edited one;
4. the **creator schedule**;
5. the **default outfit**.

Unknown outfit ids in preferences or rules are ignored at every level, so a
pet update that drops an outfit falls back instead of breaking. An empty user
schedule is meaningful: "never change automatically".

User choices persist in `openpets-state.json` under
`preferences.petWardrobePreferences[petId] = { outfit?, schedule? }`. Absent
means the pet's own behavior; *Reset* removes `schedule`; *Follow schedule*
removes `outfit`. Every write goes through `normalizeState()`, which drops
malformed rules and ids, so there is no state version bump and no migration.
Preferences are keyed by pet id and are kept when a pet is reinstalled or
upgraded.

## How it works in the app

| Concern | Owner |
|---------|-------|
| Contract, validation, resolution (pure) | `apps/desktop/src/pet-wardrobe-core.ts` |
| Render-time resolution, schedule timer, snapshot, preference updates | `apps/desktop/src/pet-wardrobe.ts` |
| `wardrobe` in validated metadata | `codex-pets-core.ts` (`validateCodexPetMetadata`) |
| Atlas file checks, validated read/write for installs | `pet-file-safety.ts` |
| ZIP entry paths (`outfits/…`) | `zip-safety.ts` |
| Folder / ZIP / catalog installs, wardrobe upgrade | `pet-installation.ts` |
| Codex dev imports | `codex-pets.ts` |
| Choosing the atlas a window renders | `pet-window-render.ts` (`resolveRenderableAtlas`) |
| Re-rendering every window showing a pet | `pet-window-refresh.ts` |
| Persisted preferences | `app-state.ts` (`petWardrobePreferences`) |
| Control Center IPC | `control-center-pet-management-ipc.ts` (`get-pet-wardrobe`, `update-pet-wardrobe`, `install-pet-wardrobe`) |
| Outfit previews | `openpets-installed://spritesheet/{petId}/{outfitId}` in `windows.ts` |
| Context menu | `pet-window-context-menu.ts` (`buildOutfitMenuItem`) |
| Control Center UI | `renderer/src/pets/WardrobePanel.tsx`, `renderer/src/pets/wardrobe-state.ts` |
| Deep link to a pet | `control-center-route.ts` (`{ route: "pets", petId }`) |

### Render flow

1. Any pet window (default, agent, pinned, plugin-spawned, LAN visitor)
   renders through `createInstalledPetRender`.
2. `resolveRenderableAtlas` asks `resolveRenderedPetOutfit(petId, wardrobe)`
   for the outfit, which also records the pet for schedule watching.
3. The outfit atlas is checked (size; SVG profile) and used. If it is missing
   or invalid it logs `pet.wardrobe` and **falls back to the base atlas** —
   only a broken base atlas marks a pet broken. Teams packages that carry a
   wardrobe manifest without outfit files therefore keep working.
4. The atlas path is part of the render cache key, so switching outfits
   re-renders.

### Schedule timer

`pet-wardrobe.ts` arms one unref'd timer just after each minute boundary while
any rendered pet has a wardrobe. Each tick re-resolves the recorded pets and
calls `refreshPetWindowsForPetId` for those whose outfit changed. A pet that is
no longer on screen drops out on its next re-render; there is no per-pet
timer. Sleep/resume needs no special handling: the next tick catches up.

### Preference changes

Control Center and the context menu both call `updatePetWardrobe(petId,
patch)`: `outfit: "auto" | id` and/or `schedule: rules | null`. It validates
against the installed wardrobe (unknown outfit or malformed rule → error),
persists, re-renders the pet's windows, and returns the fresh snapshot.

## Packaging and installation

Every install path validates the package with the same rules
(`readValidatedPetAtlases`), copies `outfits/` along with the base atlas, and
promotes through the backup-and-rollback install transaction:

- **Local folder** and **local ZIP** (Control Center → Import pet).
- **Codex dev folder** `~/.codex/pets/{id}/` — the authoring loop: edit the
  folder, remove and re-import (or import the folder as a local pet, which
  replaces in place), check the Wardrobe panel.
- **Catalog** — see below.
- **ZIP layout**: files at the root or under exactly one top-level folder;
  `outfits/` sits next to `pet.json`; no deeper nesting, no mixed layouts.

Not yet wardrobe-aware: the standalone `install-pet` CLI's direct-download
fallback (it keeps installing the base ZIP, which is safe) and Teams packages
(base atlas only; a wardrobe manifest there falls back as described above).

## Catalog distribution and compatibility

### The constraint

Apps released before wardrobes **ignore unknown `pet.json` and catalog
fields** but **reject any ZIP containing `outfits/`** ("Unexpected zip file"),
and pets had no minimum-version gate. Those apps cannot be changed, so the
catalog must keep serving them something they can install.

### The solution: two ZIPs per wardrobe pet

| Catalog field | Contents | Who installs it |
|---------------|----------|-----------------|
| `zip` (unchanged) | `pet.json` **without** `wardrobe` + base atlas | Old apps; also `install-pet` CLI fallback |
| `wardrobeZip` (new, optional) | `pet.json` with `wardrobe` + base atlas + `outfits/` | Apps with wardrobe support |

- Host rules are the same as `zip`: `https://zip.openpets.dev/pets/…`.
  Convention: `pets/{slug}/{installId}.wardrobe.zip`.
- The base ZIP's `pet.json` must **strip `wardrobe`**. A manifest that declares
  outfits without the files would make the app offer outfits it cannot show,
  and would hide the *Get outfits* upgrade.
- Fresh installs on a wardrobe-capable app download `wardrobeZip` when present
  and record that URL as the installed `source.zip`.

| | catalog entry without `wardrobeZip` | entry with `wardrobeZip` |
|---|---|---|
| **Old app** | installs `zip` | installs `zip` (no outfits, no error) |
| **New app** | installs `zip` | installs `wardrobeZip` (outfits) |

### Minimum app version

Pet entries may carry `minOpenPetsVersion` (`MAJOR.MINOR.PATCH`, the same name
plugins use). A wardrobe-capable app that is older than it shows *Needs
OpenPets X* on the card, disables Install, and `getCatalogPet` refuses the
install. **Wardrobe pets do not need it** — the base ZIP already covers old
apps. It exists so the next breaking package change can gate cleanly; it only
protects app versions that know the field.

### Upgrading installed pets

An app that installed a pet's base ZIP (because the app was old, or the
outfits were published later) can upgrade in place:

- The Wardrobe section shows *Get outfits* (pet has no wardrobe yet) or
  *Update outfits* (pet has one) whenever the catalog entry's `wardrobeZip`
  differs from the installed `source.zip`.
- `installPetWardrobe(petId)` downloads `wardrobeZip`, requires the same id and
  a wardrobe, and swaps the pet through the install transaction. A failed
  download or invalid package leaves the current pet untouched; user
  preferences survive.
- Publishing a new outfit set should use a **new `wardrobeZip` URL** (for
  example a new installId or a version suffix); that is what makes *Update
  outfits* appear for existing users.
- Only catalog pets upgrade this way. Local folder/ZIP pets update by
  importing again (the import replaces the installed copy); a Codex pet must be
  removed and re-imported, because Codex import refuses an installed id.

### Publishing checklist (web repository)

The website/catalog pipeline lives in the separate `web/` checkout. For a pet
whose source folder contains a `wardrobe` and `outfits/`:

1. Validate the source like the desktop does: wardrobe contract, exact
   `outfits/` contents, per-outfit atlas layout and format.
2. Build the **base ZIP** from `pet.json` minus `wardrobe` plus the base atlas.
3. Build the **wardrobe ZIP** from the full `pet.json`, base atlas, and
   `outfits/`.
4. Upload both to R2; set `zip` and `wardrobeZip` on the v3 entry (and the v2
   compat entry).
5. `verify:catalog` must check both archives against their contracts: the base
   ZIP keeps the two-file rule; the wardrobe ZIP allows exactly the declared
   `outfits/*` entries.
6. ZIP repair tooling must never rewrite a wardrobe ZIP into base form or drop
   `wardrobe` from it.

Never publish `outfits/` inside `zip`: that breaks every old app.

## Testing

- `apps/desktop/tests/pet-wardrobe-core.test.ts` — resolution order, midnight
  and new-year wrap, exclusive end time, user overrides, unknown-outfit
  fallback, preference normalization, manifest rejection.
- `apps/desktop/tests/pet-wardrobe-installation.test.ts` — outfits survive
  folder, Codex, root/nested ZIP, and catalog installs; mismatched packages are
  rejected; plain pets unchanged; base ZIP then *Get outfits* upgrade with
  preferences kept; fresh installs prefer `wardrobeZip`.
- `apps/desktop/tests/zip-safety.test.ts` — accepted and rejected `outfits/`
  paths, mixed layouts.
- `apps/desktop/tests/catalog-validation.test.ts` — `wardrobeZip` and
  `minOpenPetsVersion` validation and v2 compat.
- Manual: `pnpm capture` (isolated profile, see [Screenshots](/screenshots))
  with a wardrobe pet copied into `.capture/session/profile/pets/` lets you
  check the pet window, the Wardrobe panel, and the rule editor without
  touching your real profile.

## Future work

- **Plugin SDK override** — e.g. `pet.setOutfit(id | null)`: an in-memory
  override owned by `pet-wardrobe.ts`, above the user's choice, cleared when
  the plugin unloads. Needs a permission and SDK docs.
- **Agent integration** — MCP/`openpets_status` could report the worn outfit;
  deliberately out of scope for now.
- **More conditions** — e.g. agent or project, work state, growth/unlocks
  (an outfit unlocked by activity counts). Add them to `OutfitScheduleWhen`
  with validation in `parseOutfitScheduleRule`; keep first-match semantics.
- **Outfit add-ons** — shipping new seasonal outfits without republishing the
  base pet. Today that means a new `wardrobeZip`.
- **`install-pet` CLI** — prefer `wardrobeZip` and extract `outfits/`.
- **Translations** — wardrobe strings exist in English only; other locales fall
  back per key.
