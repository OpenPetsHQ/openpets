---
description: Motion pet format implementation direction, ownership boundaries, and acceptance evidence.
---

# Motion pets

## Implementation status

This document records the agreed direction and current implementation boundary.
The default-appearance desktop slice has passed focused and integrated checks
and live macOS import, playback, interaction, replacement, restart and removal
verification. This is not release approval or a claim of established performance
budgets, visual gait acceptance, or Windows/Linux verification. The former WebP
preview is replaced by normal package import, described in [Pets](/pets).

## Current contract owners

`packages/pet-format/src/motion.ts` defines named clips, loop/finite animations,
optional introduction/ending clips, weighted semantic variants and logical
geometry. `package.ts` validates `format: "motion"`, `version: 1` before the
Classic atlas parser. Missing contexts resolve to neutral; missing events leave
the current body unchanged without suppressing speech.

`node/package-validation.ts` checks exact declared clip inventory, safe regular
files, animated WebP geometry, alpha, native frame durations and full decoding.
Verified timing comes from the image rather than duplicated author metadata.
Hard ceilings are 32 MiB per clip, 160 MiB of clip assets per package and
40 million decoded pixels per clip. These are safety ceilings, not measured
shipping or runtime performance budgets. Existing ZIP limits remain unchanged.

`node/archive.ts` inspects a bounded root or single-wrapper manifest to choose
the format, then applies format-specific extraction paths. Existing Classic
callers keep their default behavior.

The first desktop slice accepts only the default appearance and rejects outfit,
activity and gaze declarations. Shared-format support for those capabilities is
subsequent implementation work, not an ignored future field in the manifest.
Control Center's Motion previews are deliberately static neutral frames.

Desktop body suspension follows logical host visibility and system power state,
not renderer document visibility. Host show/hide operations publish successful
transitions explicitly; native events are reconciled against actual window
state because macOS occlusion notifications are not equivalent to hiding.
The active Wayland layer surface remains animated even though its offscreen
renderer document is hidden. Interrupted events are discarded on suspension;
resume resolves the latest context.

Snapshot ownership ends on destruction of the captured WebContents, independent
of BrowserWindow `closed` listener ordering. Body-bridge teardown also uses that
captured reference rather than accessing a destroyed window's native getters.
Closing one renderer releases both its committed and pending snapshots while
preserving any snapshot still owned by another live renderer.

## Product and format decisions

Motion and Classic describe artwork formats, not separate pet systems. Both
must use existing desktop installation, preferences, wardrobe, activities,
semantic plugin operations and window lifecycles. Classic support remains
necessary for published pet packages.

The Motion format should support a living companion without forcing every
author to supply the same nine animations:

- Named clips and semantic bindings allow several authored representations of
  the same reaction. Missing optional artwork uses an explicit fallback, not
  invented capability claims.
- Neutral behavior can have several variants. Repeating a quiet base animation
  and occasionally selecting another eligible animation is different from
  running a continuous sequence of attention-seeking tricks.
- An action can have an introduction, a repeating middle and an ending, so
  entering sleep does not repeat every time the sleeping loop repeats.
- Source frame durations and an authored pace belong to each clip. The preview's
  global 1.5× multiplier is not the production timing contract.
- Logical geometry and stable anchors keep animations and outfits grounded in
  the same place. The format cannot repair mismatched artwork or create smooth
  transitions between incompatible poses.
- Outfits are coherent, initially baked-in artwork sets. Activities retain
  logical identity across outfits, but play only when matching artwork exists
  for the actually rendered outfit.
- Finite playback reports completion and cancellation explicitly. An event
  returns to the current context, not a captured idle state.
- Capability presentation reflects validated available artwork. Motion alone
  does not imply gaze, expressions, activities or multiple outfits.

The host owns selection, priority, cooldowns and interruption policy. Packages
contain data and local artwork, not executable scripts or generation-service
dependencies. Direct manipulation must not wait for decorative transitions.
Existing plugin sprite overrides retain explicit ownership and cleanup.

New SDK operations, personality simulations, needs meters, pet-to-pet behavior,
Studio generation and public distribution are outside this implementation.

## Delivery and acceptance

The first usable pass is a normally installable and selectable Motion pet, not
an environment-variable replacement for the built-in Classic pet. It must use
the existing staged installation transaction and preserve the previous usable
installation and preferences after a failed replacement.

Semantic intent must remain independent of bubble lifetime and Classic atlas
timing. Asset access must also remain coherent across replacement: a renderer
must not combine clips from different package revisions.

The local Hoodie Cat reference currently has one genuine outfit. Its current
`pack/motion.json` selects a 21-frame right-facing run; older processing reports
describe an earlier eight-frame version. The directory occupies about 96 MiB.
Neither that size nor a seam metric establishes shipping suitability or visual
acceptance. A second outfit or additional variants require real authored assets;
duplicate files must not be presented as new content.

Acceptance needs focused behavior tests plus real Electron import, selection,
playback, interruption, replacement, restart and cleanup evidence. Measure
resource use and interaction timing separately from visual quality. macOS
evidence does not establish Windows or Linux behavior.

Motion packages must not enter existing public catalogs until a versioned
distribution boundary protects older released clients. No publication or release
is part of this work.
