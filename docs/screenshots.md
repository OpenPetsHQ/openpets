---
description: Take transparent, trimmed screenshots of the default pet in any plugin state with a long-running dev capture session.
---

# Screenshots

`pnpm capture` runs a dev-only **capture session**: a separate OpenPets
instance you start once, drive from the terminal (or by clicking the pet), and
screenshot as often as you like. Every shot is a PNG of the default pet window
with its real alpha channel, trimmed to the visible pet and bubble, padded
evenly, and saved at the display's pixel density (@2x on Retina).

There is no chroma-key step. The pet window is already transparent, so edges,
the pet's drop shadow, and bubble shadows stay clean on any background.

## Quick start

```sh
pnpm capture start --plugins openpets.simple-timer   # build, launch, wait until ready
pnpm capture cmd openpets.simple-timer timer-25      # put the plugin in a state
pnpm capture shot simple-timer-running               # → web/lfs/captures/desktop/simple-timer-running.png
pnpm capture stop
```

`start` prints every loaded plugin with its command ids, so you can see what
`cmd` can run. `pnpm capture status` prints the same list later (command ids
change with plugin state; the timer only offers `pause-resume-timer` while one
runs).

## Commands

| Command | What it does |
|---------|--------------|
| `start [--plugins a,b] [--keep] [--no-build] [--teams-api url]` | Build the desktop app, launch the capture instance, wait for plugins and the pet. Starts from an empty profile unless `--keep`. Without `--plugins`, every official plugin loads. `--teams-api` points the instance at a Teams API. |
| `restart [same flags]` | `stop` then `start`: the reset between unrelated shots. |
| `stop` | Quit the capture instance. |
| `status` | Plugins, enabled/broken state, current command ids, pet visibility. |
| `cmd <pluginId> <commandId> [argsJson]` | Run a plugin command. Form commands take their field values as JSON, e.g. `'{"preset":"25","label":"Deep work"}'`. |
| `say <message> [reaction]` / `react <reaction>` | Speech bubble or reaction on the pet. |
| `chat <collapsed\|compact\|expanded>` | Close the chat, open the compact chat bar, or open the full chat panel. |
| `chat send <message> [--no-wait]` | Send a chat turn exactly like the composer does. Waits until the reply and any tool calls finish, unless `--no-wait` (for mid-reply shots). |
| `chat clear` | Forget earlier conversation history so it doesn't shape new replies. |
| `buttons <chat\|talk\|chat,talk\|none>` | Show the pet's Chat/Talk buttons (off by default). |
| `providers [auto]` | List the capture profile's provider profiles and selections; `auto` selects the first matching profile for each empty role (text, stt, tts). |
| `pet select <petId>` | Make an installed pet (for example a Team pet) the default pet. |
| `ui click <selector>` / `ui type <selector> <text>` / `ui scroll <selector>` | Drive renderer UI in the pet window (or `--window control-center`) for staged states, such as a filled-in check-in card. The renderer's own event listeners handle it. |
| `control-center <route> [--width px --height px]` | Open the Control Center on a route (e.g. `teams`) at a fixed content size (default 1180×800). |
| `teams enroll` / `teams approve` / `teams sync` | Enroll into the Teams showcase organization, approve requested Team plugin permissions, sync Team Pack and check-ins (see below). |
| `check-in` | Open the pet's check-in card. |
| `delivery <courier> [--title t --detail d]` / `delivery clear` | Fly a Calendar Airmail courier (e.g. `courier-owl`) through the same host delivery capability the plugin uses, so no Google Calendar connection is needed; `shot --window delivery` captures it. |
| `shot <name> [--window pet\|control-center] [--padding pt] [--settle ms] [--out dir]` | Capture. `--window control-center` shoots the opaque Control Center as-is (no padding); pet shots are trimmed with `--padding` points (default 24). `--settle` waits for renders and CSS transitions first (default 250 ms), `--out` overrides `web/lfs/captures/desktop/`. |
| `run <scenario.json \| folder>` | Run a scripted scenario, or every scenario in a folder (below). |

You can mix manual and scripted work: click through the pet's menu yourself to
reach a state that has no command, then `pnpm capture shot <name>`. Plugins load
from `plugins/official/` source with the dev watcher, so edit a plugin, run the
command again, and re-shoot without restarting.

## Scenarios

A scenario is a saved sequence of the same actions, for re-shooting a set after
a UI change. `scripts/capture-scenarios/` has one scenario per bundled
plugin, each in its own fresh session so pinned HUDs never overlap:

| Scenario | Shots |
|----------|-------|
| `calendar-airmail.json` | an owl courier delivering a calendar reminder |
| `day-routine.json` | Morning & Evening Routine's morning greeting |
| `magic-8-ball.json` | a Magic 8-Ball answer to a question |
| `mood-check-in.json` | the mood check-in prompt |
| `water-reminder.json` | the water break reminder |
| `anxiety-aid-tools.json` | every practice: breathing, guided breathing, muscle relaxation, grounding, meditation, visualization, sounds |
| `focus-buddy.json` | focus block running |
| `fortune-cookie.json` | today's fortune card |
| `launch-buddy.json` | greeting |
| `reminders.json` | reminder confirmation, due alert |
| `simple-timer.json` | running, paused, finished timer |
| `system-resources.json` | live HUD, snapshot |
| `virtual-pet.json` | stats HUD, after feeding |

```sh
pnpm capture run scripts/capture-scenarios/simple-timer.json   # one scenario
pnpm capture run scripts/capture-scenarios                      # all of them (~4 min)
```

Fields: `plugins` (optional; restarts fresh with only these loaded), `out`
(optional output folder, relative to the repo root), `padding` (default for
every shot), and `steps`. Each step is one of `{ "cmd": [pluginId, commandId,
args?], "optional"? }` (`optional` ignores a failing command, for tidying up
state a kept profile may or may not have), `{ "say": "…", "reaction": "…" }`, `{ "react": "…" }`,
`{ "wait": ms }`, `{ "shot": name, "settleMs"?, "padding"? }`,
`{ "chat": "collapsed" | "compact" | "expanded" | "clear" }`,
`{ "chatSend": "…", "noWait"? }`, `{ "buttons": ["chat", "talk"] }`,
`{ "providers": "auto" }`, `{ "pet": petId }`, `{ "click": selector }`,
`{ "type": selector, "text": "…" }`, `{ "scroll": selector }`, `{ "teams": "enroll" | "approve" | "sync" }`,
`{ "checkIn": true }`, `{ "controlCenter": route, "width"?, "height"? }`,
`{ "delivery": { "courier", "title"?, "detail"? } }`, `{ "landDeliveries": true }`, or
`{ "restart": true }`. Set `"keepProfile": true` to keep the profile across the
scenario's restarts. The runner script's header documents the same shape.

States that depend on time need real waits: the timer and reminders both have a
one-minute minimum, so their "finished" and "due" shots take about a minute.

## Pet Assistant chat

Chat replies need a real text provider, and the capture instance has its own
profile, so configure the provider there once and keep that profile:

1. `pnpm capture start --keep --plugins openpets.reminders,openpets.simple-timer`
2. Open the capture instance's Control Center from its tray icon (the second
   OpenPets icon) and add the provider profile, e.g. OpenAI or OpenRouter.
3. Shoot with `pnpm capture run scripts/capture-scenarios/chat/pet-assistant.json`.
   That scenario sets `keepProfile`, so its restart keeps the provider, and
   runs `providers auto`, so a profile you added but never selected is used.

Any plain `start`/`restart` without `--keep` wipes the profile and the
provider with it. The key is stored in `.capture/session/profile/`
(git-ignored). On macOS OpenPets encrypts secrets with Chromium's basic
password store rather than the Keychain, so treat that folder as a secret.

The chat scenario lives in `scripts/capture-scenarios/chat/` so running the
whole scenario folder doesn't fail on machines without a provider. It shoots
the Chat/Talk buttons, the compact chat bar, the empty panel, a reply, and two
tool-use turns (a reminder and a focus session, handled by the loaded
Reminders and Focus Buddy plugins; Simple Timer has no assistant tools).
Replies come from a real model, so the wording differs every run; re-run until
you like an answer.

## OpenPets Teams

Teams screenshots use the Teams showcase organization (Harbor Studio), which
lives in the `teams/` repository. Web dashboard shots come from there; this
session covers the desktop side:

```sh
cd teams && bun run dev:showcase          # keep running
pnpm capture run scripts/capture-scenarios/teams/desktop.json
```

The scenario sets `teamsApi`, so the capture instance talks to the showcase
API. `teams enroll` plays both sides of a join link: it starts the enrollment
intent over HTTP the way the browser does, then completes it in the app
through the real desktop flow as the showcase's desktop persona (Alex Rivera),
runs `bun run showcase:desktop-history` so that desktop has a personal check-in
history, and syncs. The scenario then approves the Team plugins, switches to
the Team pet (Luna TechBot), and shoots the check-in offer, the empty and
filled-in check-in card, and the Control Center Teams page (top, and scrolled
to Team Pets and Team Plugins). Scenarios in
`scripts/capture-scenarios/teams/` are skipped by a plain `run` of the scenario
folder because they need the showcase running. See `teams/docs/manual-testing.md`
for the dashboard shots.

## How it works

- **Runner:** `scripts/capture.mjs` owns the session lifecycle. It builds the
  desktop app, launches Electron detached with `OPENPETS_CAPTURE_SESSION_DIR`,
  records the pid, and sends each command as one JSON line to the session's
  control socket.
- **In the app:** `apps/desktop/src/capture-session.ts` owns the control socket
  and the handlers. It runs plugin commands through the plugin service,
  captures the default pet window with `webContents.capturePage()`, and writes
  the PNG. The crop and padding math is pure and lives in
  `capture-image-core.ts`.
- **Dev only:** the env var is ignored in packaged builds. The control socket
  is deliberately not part of the [local IPC protocol](/ipc), because running
  arbitrary plugin commands and reading window pixels must not exist in a
  shipped app.

### Isolation from your normal OpenPets

Everything lives under `.capture/` (git-ignored):

- `.capture/session/profile/` is the instance's userData. Pets, preferences,
  plugin state, and logs (`profile/logs/openpets.log`) never touch your real
  profile. Because Electron's single-instance lock is scoped to userData, the
  capture instance runs next to your normal app.
- `.capture/session/ipc.json` is its IPC discovery file, so agent integrations
  keep talking to your real app.
- `.capture/session/control.sock` is the control socket (mode 0600).
  `.capture/session/app.log` is the app's stdout.
Shots default to `web/lfs/captures/desktop/` in the OpenPets web repository
(`web/`, a separate checkout), where `lfs/**` is tracked with Git LFS; commit
them there when they should be published. Teams dashboard shots land beside
them in `web/lfs/captures/teams/`.

The capture pet still appears on screen (capture reads the real window), and
the instance adds a second tray icon while it runs.

### Deterministic output

- The instance forces the sRGB color profile. Without it macOS renders in the
  display's P3 space, and PNGs, which carry no profile, look washed out.
- Idle cursor gaze is switched off so the pet faces forward instead of toward
  your mouse.
- Pixels at or below alpha 8 count as background when trimming, so invisible
  hit areas don't widen the crop. Everything else, including soft shadows, is
  kept exactly as rendered.

## Known limits

- **Sprite frame:** the idle animation keeps playing, so a shot can catch any
  frame. Re-shoot if you get a blink. Some alerts play a reaction of their own
  (the timer's "finished" alert shows the pet with closed eyes).
- **Live data:** System Resources reads the real machine. When RAM or CPU is
  high it shows its own usage warning, which replaces the snapshot bubble.
- **Overlay glow:** the session overlay's orb glow is cut flat at the bottom
  edge of its window. The app clips it the same way on screen.
- **Built-in pet haze:** the built-in spritesheet has faint near-transparent
  residue around the cat, which the drop shadow makes visible as a light haze on
  dark backgrounds. That is an asset issue; cleaning
  `apps/desktop/assets/default-pet-spritesheet.webp` fixes it at the source.
- **Platforms:** the control socket is a Unix socket, so sessions run on macOS
  and Linux, not Windows.
- **Scope:** the session captures the default pet window. Pet choice, pet
  scale, and locale use the fresh profile's defaults (built-in pet, default
  scale, system locale).
