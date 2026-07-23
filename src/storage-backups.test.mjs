import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  classifyBackupName,
  createCriticalBackup,
  deleteBackup,
  isBackupName,
  listBackups,
  resolveBackupPath,
} from "./storage-backups.js";

function createFixture() {
  const volumeRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "openclaw-storage-test-"),
  );
  const stateDir = path.join(volumeRoot, ".openclaw");
  const workspaceDir = path.join(volumeRoot, "workspace");
  const backupDir = path.join(volumeRoot, "backups");
  fs.mkdirSync(path.join(stateDir, "agents"), { recursive: true });
  fs.mkdirSync(path.join(stateDir, "credentials"), { recursive: true });
  fs.mkdirSync(path.join(stateDir, "npm"), { recursive: true });
  fs.mkdirSync(path.join(stateDir, "tools"), { recursive: true });
  fs.mkdirSync(workspaceDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, "openclaw.json"), "{}\n");
  fs.writeFileSync(path.join(stateDir, "agents", "session.jsonl"), "session\n");
  fs.writeFileSync(path.join(stateDir, "credentials", "token.json"), "secret\n");
  fs.writeFileSync(path.join(stateDir, "npm", "package.tgz"), "reproducible\n");
  fs.writeFileSync(path.join(stateDir, "tools", "tool.bin"), "reproducible\n");
  fs.writeFileSync(path.join(workspaceDir, "rules.md"), "rules\n");
  return {
    backupDir,
    configPath: path.join(stateDir, "openclaw.json"),
    stateDir,
    volumeRoot,
    workspaceDir,
  };
}

test("validates and classifies backup names", () => {
  assert.equal(isBackupName("openclaw-critical-2026.tar.gz"), true);
  assert.equal(isBackupName("../escape.tar.gz"), false);
  assert.equal(isBackupName("backup.partial"), false);
  assert.equal(classifyBackupName("openclaw-critical-2026.tar.gz"), "critical");
  assert.equal(
    classifyBackupName("2026-openclaw-backup.tar.gz"),
    "rollback",
  );
});

test("creates a critical archive without reproducible dependencies", async (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.volumeRoot, { recursive: true, force: true }));

  const backup = await createCriticalBackup({
    ...fixture,
    openclawVersion: "test-version",
    now: new Date("2026-07-23T12:00:00.000Z"),
  });

  assert.equal(backup.type, "critical");
  const archivePath = resolveBackupPath(fixture.backupDir, backup.name);
  const listing = await new Promise((resolve, reject) => {
    import("node:child_process").then(({ execFile }) => {
      execFile("tar", ["-tzf", archivePath], (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout);
      });
    });
  });
  assert.match(listing, /manifest\.json/);
  assert.match(listing, /\.openclaw\/agents\/session\.jsonl/);
  assert.match(listing, /\.openclaw\/credentials\/token\.json/);
  assert.match(listing, /workspace\/rules\.md/);
  assert.doesNotMatch(listing, /\.openclaw\/npm/);
  assert.doesNotMatch(listing, /\.openclaw\/tools/);
});

test("retains one critical backup and allows explicit deletion", async (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.volumeRoot, { recursive: true, force: true }));

  await createCriticalBackup({
    ...fixture,
    now: new Date("2026-07-23T12:00:00.000Z"),
  });
  const latest = await createCriticalBackup({
    ...fixture,
    now: new Date("2026-07-23T13:00:00.000Z"),
  });

  assert.deepEqual(
    listBackups(fixture.backupDir).map((backup) => backup.name),
    [latest.name],
  );
  assert.throws(
    () => resolveBackupPath(fixture.backupDir, "../escape.tar.gz"),
    /Invalid backup name/,
  );
  assert.equal(deleteBackup(fixture.backupDir, latest.name).name, latest.name);
  assert.deepEqual(listBackups(fixture.backupDir), []);
});
