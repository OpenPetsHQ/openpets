#!/usr/bin/env node
/**
 * Screenshot session runner. See docs/screenshots.md.
 *
 *   pnpm capture start [--plugins a,b] [--keep] [--no-build]
 *   pnpm capture cmd <pluginId> <commandId> [argsJson]
 *   pnpm capture shot <name> [--padding 24] [--settle 250] [--out dir]
 *   pnpm capture run <scenario.json | folder>
 *   pnpm capture stop
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const desktopDir = join(repoRoot, "apps", "desktop");
const officialPluginsDir = join(repoRoot, "plugins", "official");
const captureRoot = join(repoRoot, ".capture");
const sessionDir = join(captureRoot, "session");
const socketPath = join(sessionDir, "control.sock");
const pidPath = join(sessionDir, "app.pid");
const appLogPath = join(sessionDir, "app.log");
const defaultShotsDir = join(captureRoot, "shots");
const teamsDir = join(repoRoot, "teams");
const teamsShowcaseStatePath = join(teamsDir, "local", "showcase", "showcase.json");

const startTimeoutMs = 90_000;
const stopTimeoutMs = 10_000;
const requestTimeoutMs = 30_000;
const chatTimeoutMs = 180_000;

const usage = `Usage: pnpm capture <command>

Session
  start [--plugins id,id] [--keep] [--no-build] [--teams-api url]
                                                  launch the capture app (fresh profile unless --keep)
  restart [same flags]                            stop, then start fresh
  stop                                            quit the capture app
  status                                          plugins, their command ids, pet visibility

Drive
  cmd <pluginId> <commandId> [argsJson]           run a plugin command
  say <message> [reaction]                        show a speech bubble
  react <reaction>                                play a reaction
  chat <collapsed|compact|expanded>               open or close the pet chat panel
  chat send <message> [--no-wait]                 send a chat turn; waits for the full reply unless --no-wait
  chat clear                                      forget earlier conversation history
  buttons <chat|talk|chat,talk|none>              show the pet's Chat/Talk buttons
  providers [auto]                                list provider profiles; auto selects one per empty role

Teams (needs the Teams showcase: cd teams && bun run dev:showcase; start with --teams-api)
  teams enroll                                    enroll this desktop into the showcase org (+ seeded history)
  teams approve                                   approve requested Team plugin permissions
  teams sync                                      sync the Team Pack and check-ins now
  check-in                                        open the pet's check-in card
  control-center <route> [--width px --height px] open the Control Center (e.g. teams)
  pet select <petId>                              make an installed pet the default pet
  ui click <selector> [--window pet|control-center]
  ui type <selector> <text> [--window ...]        drive renderer UI for staged shots
  ui scroll <selector> [--window ...]             scroll an element into view
  wait <ms>                                       sleep (useful in shell chains)

Capture
  shot <name> [--window pet|control-center] [--padding pt] [--settle ms] [--out dir]
  run <scenario.json | folder>                    run a scripted scenario (or every one in a folder)

Shots land in .capture/shots/ unless --out (or a scenario "out") says otherwise.`;

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const { positional, flags } = parseArgs(rest);

  switch (command) {
    case "start":
      await startSession(sessionOptionsFromFlags(flags));
      return;
    case "restart":
      await stopSession();
      await startSession(sessionOptionsFromFlags(flags));
      return;
    case "stop":
      await stopSession();
      return;
    case "status":
      printJson(await request("status"));
      return;
    case "cmd":
      await runPluginCommand(positional[0], positional[1], positional[2] === undefined ? undefined : parseJsonArg(positional[2]));
      return;
    case "say":
      printJson(await request("pet.say", { message: required(positional[0], "message"), ...(positional[1] ? { reaction: positional[1] } : {}) }));
      return;
    case "react":
      printJson(await request("pet.react", { reaction: required(positional[0], "reaction") }));
      return;
    case "chat":
      await runChatCommand(positional, flags);
      return;
    case "buttons":
      await setPetButtons(required(positional[0], "buttons (chat, talk, chat,talk, or none)").split(","));
      return;
    case "teams":
      await runTeamsCommand(required(positional[0], "teams action (enroll, approve, sync)"));
      return;
    case "pet":
      if (positional[0] !== "select") throw new Error("Use: pet select <petId>");
      printJson(await request("pet.select", { petId: required(positional[1], "petId") }));
      return;
    case "ui":
      await runUiCommand(positional, flags);
      return;
    case "check-in":
      printJson(await request("check-in.open"));
      return;
    case "control-center":
      await openControlCenter(required(positional[0], "route"), {
        width: optionalNumberFlag(flags, "width"),
        height: optionalNumberFlag(flags, "height"),
      });
      return;
    case "providers":
      printJson(await request(positional[0] === "auto" ? "providers.auto" : "providers"));
      return;
    case "wait":
      await delay(Number(required(positional[0], "ms")));
      return;
    case "shot":
      await takeShot(required(positional[0], "name"), {
        padding: optionalNumberFlag(flags, "padding"),
        settleMs: optionalNumberFlag(flags, "settle"),
        window: typeof flags.window === "string" ? flags.window : undefined,
        outDir: typeof flags.out === "string" ? resolve(flags.out) : defaultShotsDir,
      });
      return;
    case "run":
      await runScenarios(resolve(required(positional[0], "scenario path")));
      return;
    default:
      console.log(usage);
      process.exitCode = command === undefined || command === "help" ? 0 : 1;
  }
}

// --- session lifecycle ----------------------------------------------------

function sessionOptionsFromFlags(flags) {
  return {
    plugins: typeof flags.plugins === "string" ? flags.plugins.split(",").map((id) => id.trim()).filter(Boolean) : null,
    keepProfile: flags.keep === true,
    build: flags["no-build"] !== true,
    teamsApi: typeof flags["teams-api"] === "string" ? flags["teams-api"] : null,
  };
}

async function startSession({ plugins, keepProfile, build, teamsApi }) {
  if (await isSessionRunning()) {
    throw new Error("A capture session is already running. Use `pnpm capture restart` or `pnpm capture stop`.");
  }
  if (build) {
    console.log("Building desktop app…");
    const result = spawnSync("pnpm", ["--filter", "@open-pets/desktop", "build"], { cwd: repoRoot, stdio: "inherit" });
    if (result.status !== 0) throw new Error("Desktop build failed.");
  }

  if (!keepProfile) rmSync(sessionDir, { recursive: true, force: true });
  mkdirSync(sessionDir, { recursive: true, mode: 0o700 });

  const logFd = openSync(appLogPath, "a");
  const child = spawn(resolveElectronBinary(), ["."], {
    cwd: desktopDir,
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: createSessionEnv(plugins, teamsApi),
  });
  child.unref();
  writeFileSync(pidPath, `${child.pid}\n`);
  console.log(`Capture app starting (pid ${child.pid}); log: ${relativeToRepo(appLogPath)}`);

  const status = await waitForReadySession();
  printPluginSummary(status);
}

function createSessionEnv(plugins, teamsApi) {
  const env = {
    ...process.env,
    OPENPETS_CAPTURE_SESSION_DIR: sessionDir,
    // Keep agent integrations talking to the user's real app, not this one.
    OPENPETS_DISCOVERY_FILE: join(sessionDir, "ipc.json"),
    OPENPETS_DISABLE_PLUGIN_CATALOG: "1",
  };
  delete env.ELECTRON_RUN_AS_NODE;
  if (teamsApi) env.OPENPETS_TEAMS_API_URL = teamsApi;
  else delete env.OPENPETS_TEAMS_API_URL;
  delete env.OPENPETS_DEV_PLUGIN_ROOTS;
  delete env.OPENPETS_DEV_PLUGIN_PATHS;

  if (plugins) {
    const paths = plugins.map((id) => {
      const path = join(officialPluginsDir, id);
      if (!existsSync(join(path, "openpets.plugin.json"))) {
        throw new Error(`No official plugin "${id}". Known: ${listOfficialPluginIds().join(", ")}`);
      }
      return path;
    });
    env.OPENPETS_DEV_PLUGIN_PATHS = paths.join(delimiter);
  } else {
    env.OPENPETS_DEV_PLUGIN_ROOTS = officialPluginsDir;
  }
  return env;
}

async function waitForReadySession() {
  const deadline = Date.now() + startTimeoutMs;
  let lastError = "socket not ready";
  while (Date.now() < deadline) {
    if (!isRecordedProcessAlive()) {
      throw new Error(`Capture app exited during startup. See ${relativeToRepo(appLogPath)}.`);
    }
    try {
      const status = await request("status", {}, { quiet: true });
      if (status.pluginStartupError) throw new Error(`Plugin startup failed: ${status.pluginStartupError}`);
      if (status.pluginsReady && status.petVisible) return status;
      lastError = `pluginsReady=${status.pluginsReady} petVisible=${status.petVisible}`;
    } catch (error) {
      if (error.message.startsWith("Plugin startup failed")) throw error;
      lastError = error.message;
    }
    await delay(500);
  }
  throw new Error(`Capture app was not ready after ${startTimeoutMs / 1000}s (${lastError}). See ${relativeToRepo(appLogPath)}.`);
}

async function stopSession() {
  if (!(await isSessionRunning())) {
    killRecordedProcess();
    console.log("No capture session running.");
    return;
  }
  await request("quit", {}, { quiet: true }).catch(() => undefined);
  const deadline = Date.now() + stopTimeoutMs;
  while (Date.now() < deadline && isRecordedProcessAlive()) await delay(200);
  killRecordedProcess();
  console.log("Capture session stopped.");
}

async function isSessionRunning() {
  if (!existsSync(socketPath)) return false;
  try {
    await request("status", {}, { quiet: true });
    return true;
  } catch {
    return false;
  }
}

function readRecordedPid() {
  try {
    const pid = Number(readFileSync(pidPath, "utf8").trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function isRecordedProcessAlive() {
  const pid = readRecordedPid();
  if (pid === null) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killRecordedProcess() {
  const pid = readRecordedPid();
  if (pid !== null && isRecordedProcessAlive()) {
    process.kill(pid, "SIGTERM");
  }
  rmSync(pidPath, { force: true });
}

function resolveElectronBinary() {
  const requireFromDesktop = createRequire(join(desktopDir, "package.json"));
  const binary = requireFromDesktop("electron");
  if (typeof binary !== "string" || !existsSync(binary)) {
    throw new Error("Electron binary is missing. Reinstall dependencies (pnpm install).");
  }
  return binary;
}

// --- actions --------------------------------------------------------------

async function runChatCommand(positional, flags) {
  const subcommand = required(positional[0], "chat state or `send`");
  if (subcommand === "clear") {
    await request("chat.clear");
    console.log("chat history cleared");
    return;
  }
  if (subcommand === "send") {
    await sendChat(required(positional[1], "message"), { wait: flags["no-wait"] !== true });
    return;
  }
  await request("chat.panel", { state: subcommand });
  console.log(`chat ${subcommand}`);
}

async function sendChat(message, { wait }) {
  console.log(wait ? "chat send (waiting for the reply)…" : "chat send (not waiting)");
  const result = await request("chat.send", { message, wait }, { timeoutMs: chatTimeoutMs });
  console.log(`chat turn ${result.status}`);
}

async function runTeamsCommand(action) {
  if (action === "enroll") {
    await enrollInShowcaseTeam();
  } else if (action === "approve") {
    printJson(await request("teams.approve"));
  } else if (action === "sync") {
    printJson(await request("teams.sync"));
  } else {
    throw new Error(`Unknown teams action "${action}". Use enroll, approve, or sync.`);
  }
}

/**
 * Plays the employee's side of a join link against the Teams showcase: the
 * browser starts the enrollment intent, the desktop completes it, then the
 * showcase attaches seeded check-in history to this desktop's employee.
 */
async function enrollInShowcaseTeam() {
  let showcase;
  try {
    showcase = JSON.parse(readFileSync(teamsShowcaseStatePath, "utf8"));
  } catch {
    throw new Error("No Teams showcase found. Run `bun run dev:showcase` in teams/ first.");
  }
  const joinLink = showcase.joinLinks[0];
  const started = await fetch(`${showcase.apiBaseUrl}/v1/join/${encodeURIComponent(joinLink.token)}/start`);
  if (!started.ok) throw new Error(`Starting the join link failed with HTTP ${started.status}.`);
  const { intentId } = await started.json();
  const enrolled = await request("teams.enroll", { intentId, displayName: showcase.desktopPersonaName }, { timeoutMs: 60_000 });
  console.log(`enrolled as ${showcase.desktopPersonaName} in ${enrolled.organizationName}`);

  const history = spawnSync("bun", ["run", "showcase:desktop-history"], { cwd: teamsDir, stdio: "inherit" });
  if (history.status !== 0) throw new Error("Attaching showcase check-in history failed.");
  printJson(await request("teams.sync", {}, { timeoutMs: 60_000 }));
}

async function runUiCommand(positional, flags) {
  const [action, selector, text] = positional;
  const window = typeof flags.window === "string" ? { window: flags.window } : {};
  if (action === "click") {
    await request("ui.click", { selector: required(selector, "selector"), ...window });
  } else if (action === "scroll") {
    await request("ui.scroll", { selector: required(selector, "selector"), ...window });
  } else if (action === "type") {
    await request("ui.type", { selector: required(selector, "selector"), text: required(text, "text"), ...window });
  } else {
    throw new Error("Use: ui click <selector> | ui scroll <selector> | ui type <selector> <text>");
  }
  console.log(`ui ${action} ${selector}`);
}

async function openControlCenter(route, { width, height }) {
  await request("control-center.open", {
    route,
    ...(width === undefined ? {} : { width }),
    ...(height === undefined ? {} : { height }),
  });
  console.log(`control center ${route}`);
}

async function setPetButtons(names) {
  const wanted = new Set(names.map((name) => name.trim()));
  const unknown = [...wanted].filter((name) => !["chat", "talk", "none"].includes(name));
  if (unknown.length > 0) throw new Error(`Unknown button: ${unknown.join(", ")}. Use chat, talk, or none.`);
  await request("pet.buttons", { chat: wanted.has("chat"), talk: wanted.has("talk") });
  console.log(`buttons chat=${wanted.has("chat")} talk=${wanted.has("talk")}`);
}

async function runPluginCommand(pluginId, commandId, args) {
  await request("plugin.command", {
    pluginId: required(pluginId, "pluginId"),
    commandId: required(commandId, "commandId"),
    ...(args === undefined ? {} : { args }),
  });
  console.log(`ran ${pluginId} ${commandId}`);
}

async function takeShot(name, { padding, settleMs, window, outDir }) {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(name)) {
    throw new Error(`Shot name "${name}" may only use letters, digits, ".", "_" and "-".`);
  }
  const result = await request("shot", {
    path: join(outDir, `${name}.png`),
    ...(padding === undefined ? {} : { padding }),
    ...(settleMs === undefined ? {} : { settleMs }),
    ...(window === undefined ? {} : { window }),
  });
  console.log(`shot ${relativeToRepo(result.path)} (${result.width}x${result.height} px, @${result.scaleFactor}x)`);
  return result;
}

/** Runs one scenario file, or every *.json scenario in a folder in name order. */
async function runScenarios(path) {
  if (!statSync(path).isDirectory()) {
    await runScenario(path);
    return;
  }
  const files = readdirSync(path).filter((name) => name.endsWith(".json")).sort();
  for (const file of files) {
    console.log(`\n== ${file}`);
    await runScenario(join(path, file));
  }
}

/**
 * Scenario file:
 * {
 *   "plugins": ["openpets.simple-timer"],   // optional: restart fresh with only these
 *   "out": "docs/screenshots/plugins",       // optional, relative to the repo root
 *   "teamsApi": "http://localhost:8788",     // optional: point the desktop at a Teams API
 *   "keepProfile": true,                      // optional: keep the profile (and a configured provider) on restarts
 *   "padding": 24,                            // optional default for every shot
 *   "steps": [
 *     { "cmd": ["openpets.simple-timer", "timer-25"] },
 *     { "cmd": ["openpets.focus-buddy", "end-session"], "optional": true },  // ignore failure
 *     { "cmd": ["openpets.simple-timer", "start-timer", { "preset": "25" }] },
 *     { "say": "Hello!", "reaction": "happy" },
 *     { "buttons": ["chat", "talk"] },
 *     { "teams": "enroll" },                   // enroll | approve | sync (scenario needs "teamsApi")
 *     { "checkIn": true },
 *     { "pet": "luna-techbot" },               // make an installed pet the default
 *     { "click": ".check-in-feeling-btn[data-code=good]" },
 *     { "type": ".check-in-textarea", "text": "Great sprint!" },  // "window" picks pet | control-center
 *     { "scroll": "[data-team-pets]", "window": "control-center" },
 *     { "controlCenter": "teams", "width": 1180, "height": 800 },
 *     { "shot": "teams-page", "window": "control-center" },
 *     { "chat": "expanded" },                  // collapsed | compact | expanded | clear
 *     { "chatSend": "What can you do?" },      // add "noWait": true to shoot mid-reply
 *     { "wait": 1000 },
 *     { "shot": "simple-timer-running", "settleMs": 500 },
 *     { "restart": true }
 *   ]
 * }
 */
async function runScenario(scenarioPath) {
  const scenario = JSON.parse(readFileSync(scenarioPath, "utf8"));
  if (!Array.isArray(scenario.steps)) throw new Error(`${scenarioPath}: "steps" must be an array.`);
  const outDir = typeof scenario.out === "string"
    ? (isAbsolute(scenario.out) ? scenario.out : join(repoRoot, scenario.out))
    : defaultShotsDir;
  const sessionOptions = {
    plugins: Array.isArray(scenario.plugins) ? scenario.plugins : null,
    keepProfile: scenario.keepProfile === true,
    build: true,
    teamsApi: typeof scenario.teamsApi === "string" ? scenario.teamsApi : null,
  };

  if (sessionOptions.plugins) {
    await stopSession();
    await startSession(sessionOptions);
  } else if (!(await isSessionRunning())) {
    await startSession(sessionOptions);
  }
  sessionOptions.build = false;

  for (const [index, step] of scenario.steps.entries()) {
    const label = `step ${index + 1}/${scenario.steps.length}`;
    if (step.cmd) {
      const [pluginId, commandId, args] = step.cmd;
      try {
        await runPluginCommand(pluginId, commandId, args);
      } catch (error) {
        // Optional steps tidy up state that may not exist, e.g. ending a
        // session left over in a kept profile.
        if (step.optional !== true) throw error;
        console.log(`skipped optional ${pluginId} ${commandId}`);
      }
    } else if (step.chat === "clear") {
      await request("chat.clear");
    } else if (step.chat) {
      await request("chat.panel", { state: step.chat });
    } else if (step.chatSend) {
      await sendChat(step.chatSend, { wait: step.noWait !== true });
    } else if (step.teams) {
      await runTeamsCommand(step.teams);
    } else if (step.pet) {
      await request("pet.select", { petId: step.pet });
    } else if (step.click) {
      await request("ui.click", { selector: step.click, ...(step.window ? { window: step.window } : {}) });
    } else if (step.scroll) {
      await request("ui.scroll", { selector: step.scroll, ...(step.window ? { window: step.window } : {}) });
    } else if (step.type) {
      await request("ui.type", { selector: step.type, text: step.text, ...(step.window ? { window: step.window } : {}) });
    } else if (step.checkIn) {
      await request("check-in.open");
    } else if (step.controlCenter) {
      await openControlCenter(step.controlCenter, { width: step.width, height: step.height });
    } else if (step.providers === "auto") {
      await request("providers.auto");
    } else if (step.buttons) {
      await setPetButtons(step.buttons);
    } else if (step.say) {
      await request("pet.say", { message: step.say, ...(step.reaction ? { reaction: step.reaction } : {}) });
    } else if (step.react) {
      await request("pet.react", { reaction: step.react });
    } else if (typeof step.wait === "number") {
      await delay(step.wait);
    } else if (step.shot) {
      await takeShot(step.shot, {
        padding: step.padding ?? scenario.padding,
        settleMs: step.settleMs,
        window: step.window,
        outDir,
      });
    } else if (step.restart) {
      await stopSession();
      await startSession(sessionOptions);
    } else {
      throw new Error(`${label}: unknown step ${JSON.stringify(step)}`);
    }
  }
}

// --- control socket -------------------------------------------------------

function request(method, params = {}, { quiet = false, timeoutMs = requestTimeoutMs } = {}) {
  return new Promise((resolvePromise, reject) => {
    const socket = net.createConnection(socketPath);
    let response = "";
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`${method} timed out`));
    }, timeoutMs);
    socket.setEncoding("utf8");
    socket.on("connect", () => socket.write(`${JSON.stringify({ method, params })}\n`));
    socket.on("data", (chunk) => {
      response += chunk;
    });
    socket.on("error", (error) => {
      clearTimeout(timer);
      reject(new Error(error.code === "ENOENT" || error.code === "ECONNREFUSED" ? "No capture session running. Start one with `pnpm capture start`." : error.message));
    });
    socket.on("end", () => {
      clearTimeout(timer);
      let parsed;
      try {
        parsed = JSON.parse(response);
      } catch {
        reject(new Error(`${method}: malformed response`));
        return;
      }
      if (parsed.ok) {
        resolvePromise(parsed.result);
      } else {
        if (!quiet) console.error(`${method} failed: ${parsed.error}`);
        reject(new Error(parsed.error));
      }
    });
  });
}

// --- helpers --------------------------------------------------------------

function parseArgs(args) {
  const positional = [];
  const flags = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = args[index + 1];
    if (next !== undefined && !next.startsWith("--") && !["keep", "no-build", "no-wait"].includes(key)) {
      flags[key] = next;
      index += 1;
    } else {
      flags[key] = true;
    }
  }
  return { positional, flags };
}

function optionalNumberFlag(flags, key) {
  if (flags[key] === undefined) return undefined;
  const value = Number(flags[key]);
  if (!Number.isFinite(value)) throw new Error(`--${key} must be a number.`);
  return value;
}

function parseJsonArg(value) {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`Command args must be JSON, got: ${value}`);
  }
}

function required(value, name) {
  if (value === undefined || value === "") throw new Error(`Missing ${name}.\n\n${usage}`);
  return value;
}

function listOfficialPluginIds() {
  return readdirSync(officialPluginsDir).filter((id) => existsSync(join(officialPluginsDir, id, "openpets.plugin.json")));
}

function printPluginSummary(status) {
  console.log(`Capture session ready (pid ${status.pid}).`);
  for (const plugin of status.plugins) {
    const state = plugin.broken ? `broken: ${plugin.broken}` : plugin.enabled ? "enabled" : "disabled";
    console.log(`  ${plugin.id} [${state}] ${plugin.commands.join(", ")}`);
  }
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function relativeToRepo(path) {
  return path.startsWith(`${repoRoot}/`) ? path.slice(repoRoot.length + 1) : path;
}

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
