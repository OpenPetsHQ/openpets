# packages/pet-format/src/

## Files

- **index.ts**: Browser-safe aggregate of reactions, sprite layout and animation.
- **reactions.ts**: Canonical reaction names and type.
- **sprite-layout.ts**: V1/V2 atlas geometry, layout selection, and frame position calculation.
- **animation.ts**: Reaction mappings, animation state definitions, waiting durations, and playback selection.
- **builtin-hoodie-cat.ts**: Canonical bundled Hoodie Cat wardrobe, schedule and asset-relative outfit paths shared by desktop and VS Code.
- **catalog-validation.ts**: Catalog schema validation, sprite marker normalization, and V3-to-V2 adaptation.
- **catalog-v3.ts**: Bounded HTTP, retryable/coalesced V3 client, and curated page hydration.
- **metadata.ts**, **wardrobe.ts**, **activities.ts**: Shared package metadata and pure outfit, schedule and logical activity contracts; enumerate and resolve exact-outfit activity representations.
- **node/atlas-validation.ts**: Sequential package atlas checks and decoder-independent image policy; desktop supplies its Sharp adapter in `apps/desktop/src/pet-atlas-validation.ts`.
- **node/archive.ts**, **node/paths.ts**, **node/files.ts**: Bounded ZIP extraction, path validation and safe regular-file reads.
