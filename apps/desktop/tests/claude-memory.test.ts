import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { doctorClaudeOpenPetsMemory, installClaudeOpenPetsMemory, openPetsClaudeImportLine, uninstallClaudeOpenPetsMemory } from "../src/claude-memory.js";

const dir = mkdtempSync(join(tmpdir(), "openpets-claude-memory-"));
try {
  const claudeDir = join(dir, ".claude");
  const claudeMd = join(claudeDir, "CLAUDE.md");
  const openpetsMd = join(claudeDir, "openpets.md");
  mkdirSync(claudeDir);
  writeFileSync(claudeMd, "# Existing Claude instructions\n\nKeep this.\n", "utf8");
  const originalClaudeMd = readFileSync(claudeMd, "utf8");

  const installed = installClaudeOpenPetsMemory(dir);
  assert.equal(installed.changed, true);
  assert.equal(doctorClaudeOpenPetsMemory(dir).status, "installed");
  assert.equal(existsSync(claudeMd), true);
  assert.equal(existsSync(openpetsMd), true);

  const reinstalled = installClaudeOpenPetsMemory(dir);
  assert.equal(reinstalled.changed, false);

  writeFileSync(openpetsMd, `${readFileSync(openpetsMd, "utf8")}\nUser custom note.\n`, "utf8");
  const uninstalled = uninstallClaudeOpenPetsMemory(dir);
  assert.equal(uninstalled.changed, true);
  assert.equal(doctorClaudeOpenPetsMemory(dir).status, "not_installed");
  assert.equal(readFileSync(claudeMd, "utf8"), originalClaudeMd, "uninstall should preserve the user's Claude instructions.");
  assert.equal(existsSync(openpetsMd), true, "customized openpets.md should be preserved after managed block removal.");
  assert.equal(readFileSync(openpetsMd, "utf8"), "User custom note.\n", "uninstall should preserve user content in openpets.md.");

  const userImportHome = join(dir, "user-import-home");
  const userClaudeDir = join(userImportHome, ".claude");
  mkdirSync(userClaudeDir, { recursive: true });
  const userClaudeMdPath = join(userClaudeDir, "CLAUDE.md");
  const userOpenPetsMdPath = join(userClaudeDir, "openpets.md");
  const userClaudeMd = `# User-owned import\n${openPetsClaudeImportLine}\n`;
  const userOpenPetsMd = "User-owned content.\n";
  writeFileSync(userClaudeMdPath, userClaudeMd, "utf8");
  writeFileSync(userOpenPetsMdPath, userOpenPetsMd, "utf8");
  installClaudeOpenPetsMemory(userImportHome);
  assert.equal(doctorClaudeOpenPetsMemory(userImportHome).status, "installed");
  uninstallClaudeOpenPetsMemory(userImportHome);
  assert.equal(readFileSync(userClaudeMdPath, "utf8"), userClaudeMd, "uninstall should preserve a user-owned import.");
  assert.equal(readFileSync(userOpenPetsMdPath, "utf8"), userOpenPetsMd, "uninstall should preserve user-owned openpets.md content.");

  const symlinkHome = join(dir, "symlink-home");
  const symlinkTarget = join(dir, "outside");
  mkdirSync(symlinkHome);
  mkdirSync(symlinkTarget);
  symlinkSync(symlinkTarget, join(symlinkHome, ".claude"));
  assert.throws(() => installClaudeOpenPetsMemory(symlinkHome));

  const symlinkFileHome = join(dir, "symlink-file-home");
  mkdirSync(join(symlinkFileHome, ".claude"), { recursive: true });
  writeFileSync(join(dir, "outside-file"), "x", "utf8");
  symlinkSync(join(dir, "outside-file"), join(symlinkFileHome, ".claude", "CLAUDE.md"));
  assert.throws(() => installClaudeOpenPetsMemory(symlinkFileHome));

  const oversizedHome = join(dir, "oversized-home");
  mkdirSync(join(oversizedHome, ".claude"), { recursive: true });
  writeFileSync(join(oversizedHome, ".claude", "CLAUDE.md"), "x".repeat(1024 * 1024 + 1), "utf8");
  assert.throws(() => installClaudeOpenPetsMemory(oversizedHome));
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log("Claude memory validation passed.");
