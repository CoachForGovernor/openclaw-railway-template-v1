import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BACKUP_EXTENSIONS = [".tar.gz", ".tgz", ".zip"];
const CRITICAL_STATE_ENTRIES = [
  "agents",
  "credentials",
  "devices",
  "extensions",
  "identity",
  "media",
  "memory",
  "plugins",
  "secrets",
  "skill-workshop",
  "state",
  "tasks",
  "tui",
  "workspace-attestations",
];

function runProcess(command, args) {
  return new Promise((resolve) => {
    const proc = childProcess.spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const append = (chunk) => {
      if (output.length < 64_000) output += chunk.toString("utf8");
    };
    proc.stdout.on("data", append);
    proc.stderr.on("data", append);
    proc.on("error", (error) => {
      resolve({ code: 127, output: `${output}\n${error.message}` });
    });
    proc.on("close", (code) => {
      resolve({ code: code ?? 0, output });
    });
  });
}

export function isPathInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

export function isBackupName(name) {
  if (
    typeof name !== "string" ||
    name.length < 1 ||
    name.length > 240 ||
    path.basename(name) !== name ||
    !/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(name)
  ) {
    return false;
  }
  return BACKUP_EXTENSIONS.some((extension) => name.endsWith(extension));
}

export function classifyBackupName(name) {
  if (name.startsWith("openclaw-critical-")) return "critical";
  if (name.includes("openclaw-backup")) return "rollback";
  if (name.startsWith("openclaw-export-")) return "export";
  return "other";
}

export function resolveBackupPath(backupDir, name) {
  if (!isBackupName(name)) {
    throw new Error("Invalid backup name.");
  }
  const resolved = path.resolve(backupDir, name);
  if (!isPathInside(backupDir, resolved)) {
    throw new Error("Backup path is outside the backup directory.");
  }
  return resolved;
}

export function listBackups(backupDir) {
  if (!fs.existsSync(backupDir)) return [];
  return fs
    .readdirSync(backupDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && isBackupName(entry.name))
    .map((entry) => {
      const filePath = resolveBackupPath(backupDir, entry.name);
      const stat = fs.statSync(filePath);
      return {
        name: entry.name,
        type: classifyBackupName(entry.name),
        sizeBytes: stat.size,
        createdAt: stat.birthtimeMs > 0
          ? stat.birthtime.toISOString()
          : stat.mtime.toISOString(),
        modifiedAt: stat.mtime.toISOString(),
      };
    })
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

export function getVolumeUsage(volumeRoot) {
  const stat = fs.statfsSync(volumeRoot, { bigint: true });
  const totalBytes = stat.bsize * stat.blocks;
  const availableBytes = stat.bsize * stat.bavail;
  const usedBytes = totalBytes - availableBytes;
  const percentUsed =
    totalBytes > 0n ? Number((usedBytes * 10_000n) / totalBytes) / 100 : 0;
  return {
    totalBytes: Number(totalBytes),
    usedBytes: Number(usedBytes),
    availableBytes: Number(availableBytes),
    percentUsed,
  };
}

export function criticalBackupSources({
  configPath,
  stateDir,
  volumeRoot,
  workspaceDir,
}) {
  const candidates = CRITICAL_STATE_ENTRIES.map((name) =>
    path.join(stateDir, name)
  );
  candidates.push(configPath, workspaceDir);

  const seen = new Set();
  const sources = [];
  for (const candidate of candidates) {
    const absolute = path.resolve(candidate);
    if (
      seen.has(absolute) ||
      (absolute === path.resolve(stateDir) &&
        absolute === path.resolve(workspaceDir)) ||
      !isPathInside(volumeRoot, absolute) ||
      !fs.existsSync(absolute)
    ) {
      continue;
    }
    const stat = fs.lstatSync(absolute);
    if (!stat.isDirectory() && !stat.isFile()) continue;
    seen.add(absolute);
    sources.push({
      absolute,
      archivePath: path.relative(path.resolve(volumeRoot), absolute),
    });
  }
  return sources;
}

function criticalBackupName(now) {
  return `openclaw-critical-${now
    .toISOString()
    .replace(/[:.]/g, "-")}.tar.gz`;
}

export async function createCriticalBackup({
  backupDir,
  configPath,
  openclawVersion,
  retention = 1,
  stateDir,
  volumeRoot,
  workspaceDir,
  now = new Date(),
}) {
  if (!isPathInside(volumeRoot, backupDir)) {
    throw new Error("Backup directory must be inside the volume.");
  }

  const sources = criticalBackupSources({
    configPath,
    stateDir,
    volumeRoot,
    workspaceDir,
  });
  if (sources.length === 0) {
    throw new Error("No critical state files were found.");
  }

  fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  const name = criticalBackupName(now);
  const finalPath = resolveBackupPath(backupDir, name);
  const partialPath = `${finalPath}.partial-${process.pid}`;
  const manifestDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "openclaw-critical-"),
  );
  const manifest = {
    schemaVersion: 1,
    profile: "critical",
    createdAt: now.toISOString(),
    openclawVersion: openclawVersion || null,
    volumeRoot: path.resolve(volumeRoot),
    includedPaths: sources.map((source) => source.archivePath),
    excludedClasses: [
      "npm packages",
      "downloaded tools",
      "Linuxbrew",
      "logs",
      "caches",
      "prior backups",
    ],
  };

  try {
    fs.writeFileSync(
      path.join(manifestDir, "manifest.json"),
      JSON.stringify(manifest, null, 2),
      { encoding: "utf8", mode: 0o600 },
    );

    const args = [
      "-czf",
      partialPath,
      "-C",
      manifestDir,
      "manifest.json",
      "-C",
      path.resolve(volumeRoot),
      ...sources.map((source) => source.archivePath),
    ];
    const createResult = await runProcess("tar", args);
    if (createResult.code !== 0 || !fs.existsSync(partialPath)) {
      throw new Error(
        `Critical backup creation failed: ${createResult.output.trim()}`,
      );
    }

    const verifyResult = await runProcess("tar", ["-tzf", partialPath]);
    if (verifyResult.code !== 0) {
      throw new Error(
        `Critical backup verification failed: ${verifyResult.output.trim()}`,
      );
    }

    fs.chmodSync(partialPath, 0o600);
    fs.renameSync(partialPath, finalPath);

    const keep = Math.max(1, Math.min(10, Number.parseInt(retention, 10) || 1));
    const criticalBackups = listBackups(backupDir).filter(
      (backup) => backup.type === "critical",
    );
    for (const stale of criticalBackups.slice(keep)) {
      fs.rmSync(resolveBackupPath(backupDir, stale.name), { force: true });
    }

    return listBackups(backupDir).find((backup) => backup.name === name);
  } finally {
    try {
      fs.rmSync(partialPath, { force: true });
    } catch {}
    try {
      fs.rmSync(manifestDir, { recursive: true, force: true });
    } catch {}
  }
}

export function deleteBackup(backupDir, name) {
  const filePath = resolveBackupPath(backupDir, name);
  if (!fs.existsSync(filePath)) {
    const error = new Error("Backup not found.");
    error.code = "ENOENT";
    throw error;
  }
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("Backup is not a regular file.");
  }
  const sizeBytes = stat.size;
  fs.rmSync(filePath);
  return { name, sizeBytes };
}
