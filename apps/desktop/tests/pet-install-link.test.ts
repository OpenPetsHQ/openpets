import assert from "node:assert/strict";

import { createPetInstallLinkHandler, type PetInstallLinkHandlerDependencies } from "../src/pet-install-link-handler.js";
import { findPetInstallLink, parsePetInstallLink, petInstallLinkMaxNameLength } from "../src/pet-install-link-protocol.js";

const studioZip = "https://studio.example.com/api/projects/p1/download?exp=1&sig=abc";

function installLink(zipUrl: string, name?: string): string {
  const params = new URLSearchParams({ url: zipUrl });
  if (name !== undefined) params.set("name", name);
  return `openpets://install?${params.toString()}`;
}

function acceptedLink(value: string) {
  const parsed = parsePetInstallLink(value);
  assert.ok(parsed?.ok, `expected ${value} to be accepted`);
  return parsed.link;
}

function rejected(value: string): boolean {
  const parsed = parsePetInstallLink(value);
  return parsed !== null && !parsed.ok;
}

// The Studio button's signed https URL is accepted with its query intact and only the host exposed for display/logs.
{
  const link = acceptedLink(installLink(studioZip, "Mochi"));
  assert.equal(link.zipUrl, studioZip);
  assert.equal(link.zipHost, "studio.example.com");
  assert.equal(link.name, "Mochi");
}

// Local Studio development over loopback http is allowed.
for (const zipUrl of [
  "http://localhost:8787/api/projects/p1/download",
  "http://127.0.0.1:8787/download",
  "http://[::1]:8787/download",
]) {
  acceptedLink(installLink(zipUrl));
}

// Anything that could fetch over plain http from the network, carry credentials, or use another scheme is refused.
for (const zipUrl of [
  "http://studio.example.com/download",
  "http://localhost.example.com/download",
  "https://user:secret@studio.example.com/download",
  "file:///etc/passwd",
  "ftp://studio.example.com/pet.zip",
  "javascript:alert(1)",
  "not a url",
]) {
  assert.ok(rejected(installLink(zipUrl)), `expected ${zipUrl} to be rejected`);
}
assert.ok(rejected("openpets://install"), "missing url is rejected");
assert.ok(rejected("openpets://install?name=Mochi"), "name alone is rejected");

// Other openpets links are not install links, so Teams enrollment keeps routing.
assert.equal(parsePetInstallLink("openpets://teams/enroll?intent=abc"), null);
assert.equal(parsePetInstallLink(`https://install/?url=${encodeURIComponent(studioZip)}`), null);
assert.equal(parsePetInstallLink(42), null);

// The display name is optional, trimmed, single-line, and capped.
assert.equal(acceptedLink(installLink(studioZip)).name, null);
assert.equal(acceptedLink(installLink(studioZip, "   ")).name, null);
assert.equal(acceptedLink(installLink(studioZip, "  Mochi\n the\tcat  ")).name, "Mochi the cat");
assert.equal(
  acceptedLink(installLink(studioZip, "x".repeat(200))).name?.length,
  petInstallLinkMaxNameLength,
);

// Cold start and second-instance argv carry the link among other arguments.
{
  const parsed = findPetInstallLink(["/Applications/OpenPets.app", "--flag", installLink(studioZip, "Mochi")]);
  assert.ok(parsed?.ok);
  assert.equal(findPetInstallLink(["/Applications/OpenPets.app"]), null);
}

type Harness = {
  readonly deps: PetInstallLinkHandlerDependencies;
  readonly installs: string[];
  readonly installed: string[];
  readonly errors: string[];
  readonly prompts: string[];
};

function createHarness(options: { readonly confirm: boolean; readonly installError?: Error }): Harness {
  const installs: string[] = [];
  const installed: string[] = [];
  const errors: string[] = [];
  const prompts: string[] = [];
  const deps: PetInstallLinkHandlerDependencies = {
    confirmInstall: async ({ message, detail }) => {
      prompts.push(`${message} ${detail}`);
      return options.confirm;
    },
    installFromZipUrl: async (zipUrl) => {
      installs.push(zipUrl);
      if (options.installError) throw options.installError;
      return { petId: "mochi", displayName: "Mochi" };
    },
    onInstalled: (result) => {
      installed.push(result.petId);
    },
    showError: async ({ detail }) => {
      errors.push(detail);
    },
    log: () => undefined,
  };
  return { deps, installs, installed, errors, prompts };
}

// A confirmed link installs through the shared ZIP path and reveals the result; the prompt names the pet and host.
{
  const harness = createHarness({ confirm: true });
  const handler = createPetInstallLinkHandler(harness.deps);
  await handler.handle(parsePetInstallLink(installLink(studioZip, "Mochi"))!);
  assert.deepEqual(harness.installs, [studioZip]);
  assert.deepEqual(harness.installed, ["mochi"]);
  assert.match(harness.prompts[0], /Mochi/);
  assert.match(harness.prompts[0], /studio\.example\.com/);
  assert.equal(harness.errors.length, 0);
}

// A cancelled link never downloads or installs.
{
  const harness = createHarness({ confirm: false });
  const handler = createPetInstallLinkHandler(harness.deps);
  await handler.handle(parsePetInstallLink(installLink(studioZip, "Mochi"))!);
  assert.deepEqual(harness.installs, []);
  assert.deepEqual(harness.installed, []);
}

// An invalid link reports an error without prompting to install.
{
  const harness = createHarness({ confirm: true });
  const handler = createPetInstallLinkHandler(harness.deps);
  await handler.handle(parsePetInstallLink(installLink("http://studio.example.com/download"))!);
  assert.deepEqual(harness.prompts, []);
  assert.deepEqual(harness.installs, []);
  assert.equal(harness.errors.length, 1);
}

// A failed install is shown to the user and not reported as installed.
{
  const harness = createHarness({ confirm: true, installError: new Error("Zip download failed with HTTP 403.") });
  const handler = createPetInstallLinkHandler(harness.deps);
  await handler.handle(parsePetInstallLink(installLink(studioZip))!);
  assert.deepEqual(harness.installed, []);
  assert.deepEqual(harness.errors, ["Zip download failed with HTTP 403."]);
}

console.log("pet install link tests passed.");
