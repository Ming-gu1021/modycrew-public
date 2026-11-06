import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * App-only toolchain folders placed in front of PATH for ModyCrew child processes
 * (Codex runs, crew skills, AI provider helpers). A folder is added only when its marker
 * executable exists, so an incomplete install never points PATH at an empty folder.
 */
export const managedToolPathEntries = Object.freeze([
  Object.freeze({ id: 'git', segments: ['toolchain', 'git', 'cmd'], marker: 'git.exe' }),
  Object.freeze({ id: 'node', segments: ['toolchain', 'node'], marker: 'node.exe' }),
  // Older installs only carry the ripgrep copy inside the Codex package.
  Object.freeze({ id: 'ripgrep', segments: ['toolchain', 'ripgrep'], marker: 'rg.exe', fallbackSegments: ['toolchain', 'codex', 'codex-path'] }),
  Object.freeze({ id: 'python', segments: ['toolchain', 'python'], marker: 'python.exe' }),
]);

/** Existing app-only tool folders, in PATH priority order. */
export function managedToolDirectories(resourcesPath = process.resourcesPath, exists = existsSync) {
  if (!resourcesPath) return [];
  const directories = [];
  for (const entry of managedToolPathEntries) {
    const primary = path.join(resourcesPath, ...entry.segments);
    if (exists(path.join(primary, entry.marker))) {
      directories.push(primary);
      continue;
    }
    if (entry.fallbackSegments) {
      const fallback = path.join(resourcesPath, ...entry.fallbackSegments);
      if (exists(path.join(fallback, entry.marker))) directories.push(fallback);
    }
  }
  return directories;
}

/**
 * Child processes use the app's Git, Node.js, ripgrep and Python first without changing the
 * user's global installation. The user's PATH entries are kept after them (duplicates removed).
 *
 * 예외: 이 PC 에 Git 이 이미 있으면 그 Git 을 먼저 쓴다. 앱에 넣은 MinGit 에는 Git Credential
 * Manager·git-lfs 가 없어서, 앞에 두면 비공개 저장소 HTTPS 푸시·LFS 받기가 PC Git 과 달리 실패한다.
 * 이때 앱 Git 은 PATH 맨 뒤의 예비 경로로만 남긴다.
 */
export function managedToolEnv(env = process.env, resourcesPath = process.resourcesPath, exists = existsSync) {
  const next = { ...env };
  const directories = managedToolDirectories(resourcesPath, exists);
  if (!directories.length) return next;
  const pathKeys = Object.keys(next).filter(key => key.toLowerCase() === 'path');
  const key = pathKeys[0] || 'PATH';
  const seen = new Set(directories.map(normalizePathEntry));
  const entries = [];
  for (const pathKey of pathKeys) {
    for (const entry of String(next[pathKey] || '').split(path.delimiter)) {
      if (!entry) continue;
      const normalized = normalizePathEntry(entry);
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      entries.push(entry);
    }
  }
  const bundledGit = resourcesPath ? normalizePathEntry(path.join(resourcesPath, 'toolchain', 'git', 'cmd')) : '';
  const pcHasGit = entries.some(entry => {
    try { return exists(path.join(entry.trim().replace(/^"(.*)"$/u, '$1'), 'git.exe')); } catch { return false; }
  });
  const first = pcHasGit ? directories.filter(directory => normalizePathEntry(directory) !== bundledGit) : directories;
  const last = pcHasGit ? directories.filter(directory => normalizePathEntry(directory) === bundledGit) : [];
  // Windows treats Path/PATH as one variable; keep a single key so children see one value.
  for (const pathKey of pathKeys) if (pathKey !== key) delete next[pathKey];
  next[key] = [...first, ...entries, ...last].join(path.delimiter);
  return next;
}

function normalizePathEntry(entry) {
  const normalized = path.normalize(String(entry).trim().replace(/^"(.*)"$/u, '$1')).replace(/[\\/]+$/u, '');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}
