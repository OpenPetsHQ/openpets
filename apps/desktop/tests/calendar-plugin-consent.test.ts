import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { CalendarPluginConsentStore } from "../src/calendar-plugin-consent.js";

test("calendar grants persist per local profile, plugin and provider and converge on repeated updates", async () => {
  const root = await mkdtemp(join(tmpdir(), "openpets-calendar-consent-"));
  const firstProfile = new CalendarPluginConsentStore(join(root, "profile-a"));
  const secondProfile = new CalendarPluginConsentStore(join(root, "profile-b"));
  try {
    assert.equal(await firstProfile.hasAccess("openpets.deadline-buddy", "google"), false);
    await firstProfile.setAccess("openpets.deadline-buddy", "google", true);
    await firstProfile.setAccess("openpets.deadline-buddy", "google", true);
    assert.equal(await new CalendarPluginConsentStore(join(root, "profile-a")).hasAccess("openpets.deadline-buddy", "google"), true);
    assert.equal(await secondProfile.hasAccess("openpets.deadline-buddy", "google"), false, "another local profile does not inherit consent");

    await firstProfile.setAccess("openpets.other-calendar", "google", true);
    await firstProfile.setAccess("openpets.deadline-buddy", "outlook", true);
    await firstProfile.setAccess("openpets.deadline-buddy", "google", false);
    await firstProfile.setAccess("openpets.deadline-buddy", "google", false);

    assert.equal(await firstProfile.hasAccess("openpets.deadline-buddy", "google"), false);
    assert.equal(await firstProfile.hasAccess("openpets.other-calendar", "google"), true, "revoking one plugin preserves another plugin's consent");
    assert.equal(await firstProfile.hasAccess("openpets.deadline-buddy", "outlook"), true, "providers have independent consent");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("calendar grants reject malformed plugin ids", async () => {
  const root = await mkdtemp(join(tmpdir(), "openpets-calendar-consent-"));
  const store = new CalendarPluginConsentStore(root);
  try {
    await assert.rejects(() => store.setAccess("../other-plugin", "google", true), /Invalid calendar consent scope/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("uninstall cleanup removes only that plugin's provider grants", async () => {
  const root = await mkdtemp(join(tmpdir(), "openpets-calendar-consent-"));
  const store = new CalendarPluginConsentStore(root);
  try {
    await store.setAccess("openpets.deadline-buddy", "google", true);
    await store.setAccess("openpets.deadline-buddy", "outlook", true);
    await store.setAccess("openpets.other-calendar", "google", true);
    await store.clearPlugin("openpets.deadline-buddy");
    await store.clearPlugin("openpets.deadline-buddy");

    assert.equal(await store.hasAccess("openpets.deadline-buddy", "google"), false);
    assert.equal(await store.hasAccess("openpets.deadline-buddy", "outlook"), false);
    assert.equal(await store.hasAccess("openpets.other-calendar", "google"), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
