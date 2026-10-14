# packages/install-pet/src/

## Files

- **index.ts**: Main implementation (571 lines). `installPet()`, `tryInstallThroughRunningApp()`, `installPetDirectly()`, catalog fetching, ZIP download/extraction, state management, locking, validation functions.
- **check-install-pet.ts**: Contract validation (excluded from detailed documentation).
- **spritesheet.ts**: Pure shared canonical WebP/SVG filenames, metadata-to-asset/dimensions selection (`getPetSpritesheetSpec`), single-asset package checks, MIME selection, and bounded self-contained static SVG profile validation; exported as `install-pet/spritesheet` for desktop reuse and directly importable as TypeScript by web tooling.
- **check-spritesheet.ts**: Behavioral static SVG and package file-set validation checks.
