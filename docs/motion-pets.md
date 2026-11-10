---
description: Motion pet format implementation direction, ownership boundaries, and acceptance evidence.
---

# Motion pets

## Implementation status

This document records the agreed direction and current implementation boundary.
The desktop slice has passed focused and integrated checks, including genuine
Blue Hoodie / Amber Raincoat ZIP import, playback, switching, finite activity
completion and cancellation, reduced motion and restart persistence on macOS.
Earlier checks also covered replacement and removal. This is not release approval
or a claim of established performance budgets, hitch-free visual gait acceptance,
or Windows/Linux verification. The former WebP
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
Byte ceilings are 1 GiB per clip and 1 GiB of clip assets per package. Shared ZIP,
extracted-total and individual-file ceilings are also 1 GiB. The 64-clip and
40-million decoded-pixel-per-clip guards remain: byte capacity is not a promise
that a 1 GiB pet will run smoothly, nor permission to allocate unbounded decoded
frames. These are safety ceilings, not measured performance budgets; authors
need not reduce artwork quality to meet the former small byte limits.

`node/archive.ts` inspects a bounded root or single-wrapper manifest to choose
the format, then applies format-specific extraction paths. Existing Classic
callers keep their format-specific extraction behavior.

The accepted wardrobe slice adds optional complete per-outfit bindings. Shared
validation, integrated desktop checks and live macOS synthetic-fixture checks
cover switching, failure retention, explicit retry, independent windows sharing
assets, scheduled-to-manual promotion, cleanup and preference persistence.
That earlier synthetic evidence establishes contract behavior, not artwork
quality. The genuine two-outfit reference is described under delivery below.
Finite idle activities have passed integrated checks and live macOS
synthetic-contract verification, including interruption, exact-outfit availability,
automatic opportunities, first-frame history and restart/cleanup. This does not
establish genuine activity artwork quality or production readiness. Gaze remains
unsupported. Control Center's pet previews are deliberately static neutral
frames. See [Wardrobe](/wardrobe#motion-wardrobes) for appearance commitment,
failure/retry and the shared preference/schedule contract.

Motion activity representations reference finite named animations for an exact
outfit, with duration validated from all verified phases and authored clip rates.
The existing host service remains the only timed quiet-opportunity owner; the
renderer coordinator admits playback and reports first-frame start and terminal
results separately from body/appearance results. See [Idle Activities](/pets#idle-activities)
for the shared behavior and current verification boundary.

## Reduced-motion integration

Reduced-motion support has passed integrated checks and live macOS media-emulation
verification, separately from manual pause and visibility suspension. The pet
renderer observes the OS media preference and
applies it locally, without saving or echoing it through body intent. A focused
epoch-validated report informs the host's window-local activity admission;
unknown or reduced preference blocks optional native activities in both formats.

Motion uses an explicit still-frame mode rather than treating reduction as
pause. It presents the selected body clip's first frame for current context,
direction and outfit feedback, without decorative introduction/ending phases or
a continuing decode timer. Finite events are suppressed and settled, not queued
for replay. Manual pause remains independently effective, and suspended windows
still do no unnecessary decoding.

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

## Measured reference profile and remaining performance gate

The November 2026 macOS observations used an Apple M4 Mac mini (10 cores,
16 GiB RAM), macOS 26.6.2 and Electron 42.0.0 with eleven enabled plugins.
The measured runtime was commit `731066f`; Control Center remained open.
It used the earlier single-outfit 534×615 reference, not the final two-outfit
600×641 package described below; these measurements do not establish the new
package's resource profile.
Each resource scenario had a three-second warmup and eight samples two seconds
apart. No repeated full-canvas pixel probes or paused debugger measurements ran
during these resource windows. These are short observations, not sustained
performance certification.

| Scenario | Median reported renderer CPU | Median renderer RSS |
| --- | --- | --- |
| One previously exercised Motion renderer | 1.12% | 611 MiB |
| Three fresh visible reference-art renderers | 0.99–1.08% each | 251–275 MiB each |
| The same reference clone after hiding | 0.06%, versus 1.06% visible | Not used as a memory budget |

CPU percentages are Electron's reported process values, not a normalized
whole-machine capacity claim. With three visible reference windows, median
whole-app reported CPU was 6.72%; summed process RSS was about 1.94 GiB,
including plugins, Control Center, GPU and a hidden primary renderer. Summed
RSS is not unique physical RAM. A warmed Classic comparison reported 0.14%
renderer CPU, but that renderer had previously played Motion, so its retained
memory is **not** a cold Classic baseline. The third reference-art window used
a clearly labelled byte-identical performance clone, not a new outfit.

Non-pausing main-process observers also measured normal public lease request
start to the matching renderer first-frame `started` acknowledgement:

| Asset state | Three samples | Median |
| --- | --- | --- |
| No retained Motion snapshot | 3365, 3253, 3205 ms | 3253 ms |
| Existing snapshot retained by a pinned reference window | 100, 85, 98 ms | 98 ms |

Both cases created fresh renderer processes with warmed OS file caches. The
first case includes the path that prepares a new immutable snapshot; the
measurement does not attribute all elapsed time to validation. This is a
renderer acknowledgement proxy, **not native first-visible-frame latency**,
cold-disk timing or input-to-visible drag latency.

These results establish a reproducible comparison profile, not accepted product
budgets. Memory high-water behavior, sustained CPU/battery cost, native visible
and input latency, and non-macOS measurements remain open before production
readiness can be claimed. Any regression threshold should be agreed against this
same workload rather than treating the package safety ceilings as performance
budgets. The later two-outfit artwork is genuine, but it has not been through
this resource-measurement workload.

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

The original local Hoodie Cat prototype has one genuine outfit. Its
`pack/motion.json` selects a 21-frame right-facing run; older processing reports
describe an earlier eight-frame version. That prototype directory occupies about
96 MiB; it is not the current package manifest or a shipping-size budget.

The two-outfit reference artwork now includes the original Blue Hoodie and a
genuine Amber Raincoat, with two additional quiet idle choices, three event
alternates and three finite activities per appearance. All 25 planned new videos
were generated without retries for $2.760. Native frames and timing are retained;
the selected raincoat directional gaits each use 19 frames at native pace.
The final assembly uses a shared 600×641 canvas and foot anchor `[320,617]`.
Original clips receive transparent padding, not resizing; their authored 1.5×
pace remains, while new clips use 1×. Container-level remuxing retains the
original compressed artwork without lossless re-encoding inflation; every base
frame's translated alpha and visible RGB are checked after composited decoding.
Each six-second activity is partitioned
into contiguous finite phases to respect the per-clip decoded-pixel ceiling,
without dropping or duplicating frames.

The 50-clip package passed exact inventory and full asset decoding validation.
Its ZIP is 102,347,197 bytes (97.61 MiB), above the former 50 MiB target; the shared
desktop ZIP and extracted-total limits are now 1 GiB, including individual files,
Motion clips and aggregate clip bytes. Decoded-pixel and clip-count guards remain.
Independent extraction of the actual ZIP under the earlier 128 MiB shared limit,
exact package validation and full decoding passed for all 50 clips; all six
activity representations retain 144 frames and 6,000 ms.

The same ZIP was imported once into the isolated macOS capture profile. Both
genuine outfits rendered advancing frames; all six activity representations
completed and cancelled with context restoration. CDP pointer input established
drag/reversal/release behavior, including actual window movement, but is not
native OS input or latency certification. Amber media-emulated reduced motion
cancelled activity, kept a still frame, blocked optional activity admission and
resumed animation afterward. A controlled restart retained the Amber choice and
preferences, with no active activity and advancing frames after readiness.

Two one-off verification races were retained as evidence: initial Control Center
loading and post-restart pet-target loading. An animated-edge pointer sample was
replaced with a measured stable opaque interior point before confirming drag.
These are not claims that a failed gesture proved a product defect. The new quiet
idle clips passed offline decoding, but every quiet variant has not been observed
through the natural runtime cadence. Static contact-sheet review does not establish
hitch-free playback, pixel-identical return poses or production resource budgets.
Duplicate files must not be presented as new content.

Acceptance needs focused behavior tests plus real Electron import, selection,
playback, interruption, replacement, restart and cleanup evidence. Measure
resource use and interaction timing separately from visual quality. macOS
evidence does not establish Windows or Linux behavior.

Motion packages must not enter existing public catalogs until a versioned
distribution boundary protects older released clients. No publication or release
is part of this work.
