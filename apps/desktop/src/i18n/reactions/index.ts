// Localized pet speech-bubble pools. English lives in ../../reaction-messages.ts
// (`reactionMessagePools`); this registry holds the translated pools and is the
// fallback source for `pickReactionMessage`. A locale absent here, or a reaction
// absent from a locale, falls back to English.
import type { Locale } from "../catalog.js";
import type { OpenPetsReaction } from "../../local-ipc-protocol.js";

import { ja } from "./ja.js";
import { ko } from "./ko.js";
import { zhHans } from "./zh-Hans.js";
import { zhHant } from "./zh-Hant.js";
import { ptBR } from "./pt-BR.js";
import { es419 } from "./es-419.js";
import { fr } from "./fr.js";

export type ReactionMessagePool = Record<OpenPetsReaction, readonly string[]>;

export const localizedReactionMessagePools: Partial<Record<Locale, ReactionMessagePool>> = {
  ja,
  ko,
  "zh-Hans": zhHans,
  "zh-Hant": zhHant,
  "pt-BR": ptBR,
  "es-419": es419,
  fr,
};
