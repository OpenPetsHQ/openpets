# apps/desktop/src/i18n/locales/

## Responsibility

Contains BCP-47 locale dictionaries loaded by the main i18n catalog. English (`en.ts`) acts as the source-of-truth definition file for the message contract, while other language files (`es-419.ts`, `fr.ts`, `ja.ts`, `ko.ts`, `pt-BR.ts`, `zh-Hans.ts`, `zh-Hant.ts`) supply partial overrides.

## Design/Patterns

- **Source-of-Truth Base**: English keys define the TypeScript type `MessageKey`, forcing type-checking on all dictionary entries.
- **Partial Dictionary Typing**: Non-English locales are typed as partial collections, naturally falling back to English templates for missing keys to ensure the application never displays empty labels.
- **Parametric Interpolation**: Placeholder markers (e.g., `{version}`, `{name}`) are embedded in the message values to allow runtime text substitution.

## Data & Control Flow

- Dictionaries export key-value mapping sets containing static user-interface strings (tray items, setting titles, actions, badges).
- Dictionaries are statically imported into the parent catalog (`../catalog.ts`) and checked during string lookup.

## Integration Points

- **Catalog Integration**: Directly referenced in `../catalog.ts` to form the composite dictionary tables.
