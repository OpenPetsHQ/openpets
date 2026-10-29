# packages/pet-format/

Shared pet-format contracts and validation boundaries for independent hosts.

## Responsibility

Defines reaction names, sprite layouts, animations, metadata, wardrobe and activities, catalog v3, and Node package validation boundaries.

## Design

The root aggregates the browser-safe `reactions`, `sprite-layout`, and `animation` exports. Metadata, wardrobe, activities, and catalog have separate host-neutral subpaths; Node filesystem, archive, and atlas-validation policy have separate Node subpaths. Atlas policy receives an image decoder from the host: the desktop Sharp adapter is `apps/desktop/src/pet-atlas-validation.ts`.

## Flow

Desktop and other hosts share pet contracts and catalog V3 validation/transport. Host-specific lifecycle, installation, persistence and rendering remain outside this package.

## Integration Points

**Consumers**: Desktop and standalone browser surfaces.
