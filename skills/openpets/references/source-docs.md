# OpenPets Source References

Use this map when the user needs official documentation, the exact current
contract, source examples, or the source repository without cloning it.

## Public documentation

| Need | Official source |
| --- | --- |
| Documentation starting point | https://openpets.dev/docs |
| Plugin platform and reviewed catalog | https://openpets.dev/plugins |
| Plugin SDK v3 author guide | https://openpets.dev/sdk |
| Repository development guide | https://openpets.dev/development |
| Pet catalog data | https://openpets.dev/pets/catalog.v3.json |

Use the docs to understand a feature. When an exact method signature, manifest
field, permission, or runtime behavior matters, confirm it against the source
contract below rather than extrapolating from prose.

## Source of truth and examples

| Need | Canonical source |
| --- | --- |
| Repository and release links | https://github.com/OpenPetsHQ/openpets |
| Maintained documentation tree | https://github.com/OpenPetsHQ/openpets/tree/main/docs |
| SDK types and public API signatures | https://github.com/OpenPetsHQ/openpets/blob/main/packages/sdk/src/index.ts |
| Deterministic plugin test harness | https://github.com/OpenPetsHQ/openpets/blob/main/packages/sdk/src/testing.ts |
| CLI scaffolding templates | https://github.com/OpenPetsHQ/openpets/blob/main/packages/cli/src/plugin-templates.ts |
| CLI folder validator | https://github.com/OpenPetsHQ/openpets/blob/main/packages/cli/src/plugin-validate.ts |
| First-party plugin examples | https://github.com/OpenPetsHQ/openpets/tree/main/plugins/official |

Read the nearest first-party plugin's manifest, entry, and test when composing
several capabilities. Adapt its pattern; do not blindly copy its entire product
behavior or permission set.

## Support

Report reproducible product or tooling bugs at:

https://github.com/OpenPetsHQ/openpets/issues
