import assert from "node:assert/strict";

import { PetBubbleArbiter, type ActiveBubble, type ArbiterSlot } from "../src/plugin-bubble-arbiter.js";
import { sanitizeSvgText, injectPanelCsp } from "../src/plugin-assets.js";
import {
  nextCronRunMs,
  normalizeJson,
  parseCronExpression,
  renderLimitedMarkdown,
  validateCommandFormValues,
  validateDynamicText,
  validatePinnedBubbleText,
  type PluginBubbleDescriptor,
  type PluginCommandForm,
} from "../src/plugin-sdk-bridge.js";
import { isPrivateIp } from "../src/plugin-sdk-network.js";

/**
 * Property/fuzz tests for the bridge validators — the plugin security
 * boundary (§18.7). Every validator must either throw an Error or return a
 * well-formed value for arbitrary input; none may crash, hang, or let
 * dangerous content through.
 */

// Deterministic PRNG so failures reproduce.
let seed = 0x6f70656e; // "open"
function rand(): number {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 0xffffffff;
}
function randInt(max: number): number { return Math.floor(rand() * max); }
function randChar(): string {
  const pools = ["abcdefghijklmnopqrstuvwxyz", "0123456789", "*/,-:; <>\"'`\\\n\r\0{}[]()$&|", "中文🎉�‮"];
  const pool = pools[randInt(pools.length)]!;
  return pool[randInt(pool.length)] ?? "a";
}
function randString(maxLength: number): string {
  let out = "";
  for (let index = 0, length = randInt(maxLength); index < length; index += 1) out += randChar();
  return out;
}
function randValue(depth = 0): unknown {
  const pick = randInt(depth > 2 ? 5 : 8);
  if (pick === 0) return null;
  if (pick === 1) return rand() * Number.MAX_SAFE_INTEGER * (rand() > 0.5 ? 1 : -1);
  if (pick === 2) return rand() > 0.5;
  if (pick === 3) return randString(64);
  if (pick === 4) return undefined;
  if (pick === 5) return Array.from({ length: randInt(6) }, () => randValue(depth + 1));
  const out: Record<string, unknown> = {};
  for (let index = 0, length = randInt(6); index < length; index += 1) out[randString(8) || "k"] = randValue(depth + 1);
  return out;
}

const rounds = 2_000;

// --- cron ---------------------------------------------------------------

for (let index = 0; index < rounds; index += 1) {
  const expr = Array.from({ length: randInt(7) }, () => randString(6)).join(" ");
  try {
    parseCronExpression(expr);
    const next = nextCronRunMs(expr, Date.now());
    assert.ok(next === null || (Number.isFinite(next) && next > Date.now() - 60_000), `cron next-run sane for ${JSON.stringify(expr)}`);
  } catch (error) {
    assert.ok(error instanceof Error, "cron parser throws Error instances only");
  }
}

// Valid cron expressions always produce a future run.
for (const expr of ["* * * * *", "0 9 * * 1-5", "*/15 * * * *", "30 8 1 * *", "0 0 29 2 *", "5,35 */2 * * 0,6"]) {
  const next = nextCronRunMs(expr, Date.parse("2026-06-10T12:00:00Z"));
  assert.ok(next !== null && next > Date.parse("2026-06-10T12:00:00Z"), `cron ${expr} fires in the future`);
}

// --- markdown / dynamic text ---------------------------------------------

for (let index = 0; index < rounds; index += 1) {
  const html = renderLimitedMarkdown(randString(300));
  assert.doesNotMatch(html, /<(?!\/?(strong|em|code|br)\b)/, "markdown renderer only emits the allowed tags");
  assert.doesNotMatch(html, /<script|onerror|javascript:/i, "markdown renderer emits no script vectors");
}

for (let index = 0; index < rounds; index += 1) {
  const input = randString(120) + (rand() > 0.7 ? " sk-abcdefghijklmnopqrstuvwx " : "") + (rand() > 0.7 ? " AKIAABCDEFGHIJKLMNOP " : "");
  try {
    const cleaned = validateDynamicText(input);
    assert.ok(cleaned.length >= 1 && cleaned.length <= 2_000);
    assert.doesNotMatch(cleaned, /\bsk-[A-Za-z0-9_-]{16,}\b/, "dynamic screen strips API-key-shaped secrets");
    assert.doesNotMatch(cleaned, /\bAKIA[0-9A-Z]{16}\b/, "dynamic screen strips AWS-key-shaped secrets");
  } catch (error) {
    assert.ok(error instanceof Error);
  }
}

// --- SVG / panel sanitizers -----------------------------------------------

for (let index = 0; index < rounds / 4; index += 1) {
  const svg = `<svg ${randString(20)} onload="alert(1)"><script>${randString(20)}</script><foreignObject>${randString(10)}</foreignObject><a href="https://evil.example/${randString(8)}">x</a><use xlink:href="http://evil/x#y"/>${randString(40)}</svg>`;
  const cleaned = sanitizeSvgText(svg);
  assert.doesNotMatch(cleaned, /<script\b/i, "svg sanitizer strips script elements");
  assert.doesNotMatch(cleaned, /<foreignObject\b/i, "svg sanitizer strips foreignObject");
  assert.doesNotMatch(cleaned, /\son[a-z]+\s*=/i, "svg sanitizer strips event handlers");
  assert.doesNotMatch(cleaned, /href\s*=\s*["']https?:/i, "svg sanitizer strips external hrefs");
}

assert.match(injectPanelCsp("<html><head></head><body></body></html>"), /Content-Security-Policy/);
assert.match(injectPanelCsp("no head at all"), /^<meta http-equiv="Content-Security-Policy"/);
assert.equal((injectPanelCsp('<head><meta http-equiv="Content-Security-Policy" content="default-src *"></head>').match(/Content-Security-Policy/g) ?? []).length, 1, "existing CSP metas are replaced, not stacked");

// --- pinned bubble text -------------------------------------------------------

assert.equal(validatePinnedBubbleText("🍖 ███░  ⚡ ███░\n🎾 ███░  💛 ██░░"), "🍖 ███░  ⚡ ███░\n🎾 ███░  💛 ██░░", "pinned HUD text may use a few safe lines");
assert.throws(() => validatePinnedBubbleText("ok\n\nblank"), /blank lines/);
assert.throws(() => validatePinnedBubbleText("line 1\nline 2\nline 3\nline 4\nline 5"), /too many lines/);
assert.throws(() => validatePinnedBubbleText("ok\nhttps://example.com"), /URL|path-like/);

// --- normalizeJson ----------------------------------------------------------

for (let index = 0; index < rounds; index += 1) {
  try {
    const normalized = normalizeJson(randValue(), 32 * 1024, "fuzz payload");
    JSON.stringify(normalized); // must round-trip
  } catch (error) {
    assert.ok(error instanceof Error);
  }
}
assert.throws(() => normalizeJson({ big: "x".repeat(64 * 1024) }, 32 * 1024, "fuzz payload"), /too large/);

// --- private-IP guard --------------------------------------------------------

for (const address of ["127.0.0.1", "10.1.2.3", "192.0.0.0", "192.0.0.8", "192.0.0.11", "192.0.0.170", "192.0.0.171", "192.0.0.255", "192.0.2.0", "192.0.2.255", "192.88.99.0", "192.88.99.255", "192.168.0.10", "169.254.1.1", "172.16.0.1", "172.31.255.255", "100.64.0.1", "0.0.0.0", "198.18.0.0", "198.19.255.255", "198.51.100.0", "203.0.113.255", "224.0.0.0", "255.255.255.255", "64:ff9b::a9fe:a9fe", "64:ff9b:1::1", "100:0:0:1::", "2001::", "2001:0:ffff:ffff:ffff:ffff:ffff:ffff", "2001:1::", "2001:2::", "2001:2:1::", "2001:2:ffff:ffff:ffff:ffff:ffff:ffff", "2001:4::", "2001:1ff:ffff:ffff:ffff:ffff:ffff:ffff", "2002::", "2002:a9fe:a9fe::", "5f00::", "5f00:ffff:ffff:ffff:ffff:ffff:ffff:ffff", "::1", "fd00::1", "fe80::abcd", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:192.0.2.1"]) {
  assert.equal(isPrivateIp(address), true, `${address} is private`);
}
for (const address of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "192.0.0.9", "192.0.0.10", "192.0.1.0", "192.31.196.0", "192.31.196.255", "192.52.193.0", "192.52.193.255", "192.88.98.255", "192.88.100.0", "192.175.48.0", "192.175.48.255", "198.20.0.0", "100.128.0.1", "100:0:0:2::", "2001:1::1", "2001:1::2", "2001:1::3", "2001:3::", "2001:3:ffff:ffff:ffff:ffff:ffff:ffff", "2001:4:112::", "2001:20::", "2001:30::", "2001:2fff:ffff:ffff:ffff:ffff:ffff:ffff", "2001:200::", "2001:4000::", "2003:a9fe:a9fe::", "2001:4860:4860::a9fe:a9fe", "64:ff9b::808:808", "64:ff9b:0:1::1", "64:ff9b:2::1", "2606:4700::1111"]) {
  assert.equal(isPrivateIp(address), false, `${address} is public`);
}
for (let index = 0; index < rounds; index += 1) {
  assert.equal(typeof isPrivateIp(randString(40)), "boolean", "isPrivateIp never throws");
}

// --- command form value validation -------------------------------------------

const fuzzForm: PluginCommandForm = {
  fields: [
    { id: "title", type: "text", label: "Title", maxLength: 40, required: true },
    { id: "minutes", type: "number", label: "Minutes", min: 1, max: 120 },
    { id: "enabled", type: "boolean", label: "Enabled", default: true },
    { id: "mode", type: "select", label: "Mode", options: [{ label: "A", value: "a" }, { label: "B", value: "b" }], default: "a" },
    { id: "tags", type: "multiSelect", label: "Tags", options: [{ label: "X", value: "x" }, { label: "Y", value: "y" }] },
    { id: "when", type: "time", label: "When", default: "09:00" },
    { id: "day", type: "date", label: "Day" },
    { id: "items", type: "list", label: "Items", maxLength: 50 },
  ],
};
for (let index = 0; index < rounds; index += 1) {
  try {
    const values = validateCommandFormValues(fuzzForm, randValue());
    assert.equal(typeof values, "object");
    if (typeof values.minutes === "number") assert.ok(values.minutes >= 1 && values.minutes <= 120, "numbers respect min/max");
    if (typeof values.mode === "string" && values.mode !== "") assert.ok(["a", "b"].includes(values.mode as string), "selects respect options");
  } catch (error) {
    assert.ok(error instanceof Error);
  }
}

// --- bubble arbiter invariants -------------------------------------------------

{
  const slots: Record<ArbiterSlot, ActiveBubble | null> = { transient: null, pinned: null };
  const arbiter = new PetBubbleArbiter({ present: (slot, content) => { slots[slot] = content; } });
  const live = new Set<string>();
  for (let index = 0; index < 500; index += 1) {
    const bubble: PluginBubbleDescriptor = {
      priority: (["low", "normal", "high", "urgent"] as const)[randInt(4)]!,
      text: randString(10) || "hello",
      sticky: rand() > 0.7,
      pin: rand() > 0.8,
      durationMs: rand() > 0.5 ? 500 + randInt(5_000) : undefined,
    };
    const idBox: { id: string | null } = { id: null };
    const handle = arbiter.show(`plugin-${randInt(4)}`, bubble, {
      onAction: () => undefined,
      onSubmit: () => undefined,
      onDismiss: () => { if (idBox.id) live.delete(idBox.id); idBox.id = "dismissed"; },
    });
    if (idBox.id === null) { idBox.id = handle.id; live.add(handle.id); }
    if (rand() > 0.6) void handle.dismiss();
    if (rand() > 0.8) arbiter.handleDismissed(slots.transient?.token ?? "");
    const snapshot = arbiter.snapshot();
    assert.ok(snapshot.queued <= 16, "arbiter queue stays bounded");
    if (slots.pinned) assert.ok(slots.pinned.bubble.pin === true || slots.pinned.bubble.sticky === true || slots.pinned.bubble.durationMs !== undefined, "pinned slot only holds pinned content");
  }
  for (const token of [...live]) arbiter.handleDismissed(token);
  assert.equal(arbiter.snapshot().current === null && arbiter.snapshot().queued === 0, true, "arbiter drains cleanly");
}

console.error("Plugin bridge fuzz validation passed.");
