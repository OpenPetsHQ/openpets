# @open-pets/plugin-sdk

Type definitions for building [OpenPets](https://openpets.dev) desktop pet plugins.

This package is **types only**. There is no runtime to import — the OpenPets
desktop app injects the `OpenPetsPlugin` global into your plugin's sandbox and
passes your `start(ctx)` handler the SDK. Installing this package gives your
editor autocomplete and type-checking; it never ships in your plugin.

## Install

```bash
npm i -D @open-pets/plugin-sdk
```

## Use

A plugin is a single browser-style JavaScript file. Reference the types for
IntelliSense:

```js
/// <reference types="@open-pets/plugin-sdk" />

OpenPetsPlugin.register({
  async start(ctx) {
    await ctx.pet.speak("Hello!")
    await ctx.pet.react("waving")
  },
})
```

Or, in TypeScript, import the contract directly:

```ts
import type { OpenPetsContext, OpenPetsPluginDefinition } from "@open-pets/plugin-sdk"
```

## Docs

- SDK guide: https://openpets.dev/sdk
- Full reference: https://openpets.dev/docs/plugin-sdk
- Example plugins: https://github.com/OpenPetsHQ/openpets/tree/main/plugins/official
