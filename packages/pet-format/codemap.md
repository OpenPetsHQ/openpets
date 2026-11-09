# packages/pet-format/

Shared pet-format contracts and validation boundaries for independent hosts.

## Responsibility

Defines reaction names, sprite layouts, animations, metadata, wardrobe and activities, the bundled Hoodie Cat wardrobe, catalog v3, and Node package validation boundaries.

## Design

The root aggregates the browser-safe `reactions`, `sprite-layout`, and `animation` exports. Metadata, Motion contracts and package dispatch, wardrobe, activities, and catalog have separate host-neutral subpaths; Node filesystem, archive, and package/atlas-validation policy have separate Node subpaths. Image policy receives a decoder from the host: the desktop Sharp adapter is `apps/desktop/src/pet-atlas-validation.ts`.

## Flow

Desktop and other hosts share pet contracts and catalog V3 validation/transport. Activity metadata validates outfit references and the Node validator checks and copies every declared representation under one aggregate budget. Host-specific lifecycle, installation, persistence and rendering remain outside this package.

Motion v1 metadata is strictly validated before its declared animated WebP clips are inventoried, fully decoded and optionally copied. Hard safety ceilings are 32 MiB per clip, 160 MiB total and 40 million decoded pixels per clip; they are not shipping performance budgets. ZIP inspection reads bounded `pet.json` before selecting the explicit Motion extraction mode; the default Classic allowlist and ZIP limits remain unchanged.

Optional Motion wardrobes share the Classic outfit identity, schedule and preference-resolution rules. Each named outfit supplies its own complete idle and movement bindings, plus optional context and event bindings, referencing the package-wide clips and animations. The default outfit uses root bindings; named outfits do not inherit them.

Motion activities share Classic logical identity and outfit matching, but reference finite package animations instead of strip atlases. Every representation must match an actual outfit; after all clips are decoded, its full intro/main/outro playback duration, adjusted by each clip's authored rate, must be 1–12 seconds. They use the same package-wide clip inventory and budgets.

## Integration Points

**Consumers**: Desktop and standalone browser surfaces.
