import { lstat, opendir, readdir, rmdir, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * 비정상 종료로 남은 오래된 임시 파일(*.tmp)을 앱 시작 뒤 조용히 정리한다.
 *
 * 저장할 때는 임시 파일에 쓴 뒤 이름을 바꾸는데, 그 사이에 앱이 꺼지면 임시 파일이
 * 영원히 남았다(기억 폴더에서 650KB짜리 등 실측). 지우는 것은 다음을 모두 만족하는 것뿐이다.
 *  - 이름이 .tmp 로 끝나는 일반 파일(폴더·바로가기·링크는 건드리지 않음)
 *  - 마지막 수정이 1시간 넘게 지난 것(지금 쓰는 중인 파일은 절대 아님)
 *  - 정해 준 폴더 안(기억 폴더의 memory/**, company-automation/, 앱 데이터 폴더 바로 아래)
 * 폴더를 너무 많이 훑지 않게 항목 수·삭제 수·깊이에 상한을 둔다.
 */

export const staleTempMaxAgeMs = 60 * 60 * 1000;
const defaultMaxEntries = 20_000;
const defaultMaxDeletes = 500;
const tempFilePattern = /\.tmp$/iu;

export function resolveStaleTempCleanupTargets({ userDataPath, memoryRoot } = {}) {
  const targets = [];
  if (memoryRoot) targets.push({ dir: path.join(memoryRoot, "memory"), recursive: true, maxDepth: 6 });
  if (userDataPath) {
    targets.push({ dir: path.join(userDataPath, "company-automation"), recursive: true, maxDepth: 3 });
    // 앱 데이터 폴더는 바로 아래 파일만 본다. 하위 폴더에는 Chromium 캐시 등이 있다.
    targets.push({ dir: userDataPath, recursive: false });
  }
  return targets;
}

export async function cleanupStaleTempFiles(
  targets = [],
  { now = Date.now(), maxAgeMs = staleTempMaxAgeMs, maxEntries = defaultMaxEntries, maxDeletes = defaultMaxDeletes } = {},
) {
  const summary = { scannedEntries: 0, deletedCount: 0, deletedBytes: 0, errorCount: 0, truncated: false };
  const visited = new Set();

  const walk = async (dir, depthLeft) => {
    const key = process.platform === "win32" ? dir.toLowerCase() : dir;
    if (visited.has(key)) return;
    visited.add(key);
    let handle;
    try {
      handle = await opendir(dir);
    } catch {
      return;
    }
    const subdirectories = [];
    // for await 는 끝나거나 중간에 멈추면 폴더 핸들을 스스로 닫는다.
    for await (const entry of handle) {
      summary.scannedEntries += 1;
      if (summary.scannedEntries > maxEntries || summary.deletedCount >= maxDeletes) {
        summary.truncated = true;
        break;
      }
      if (entry.isSymbolicLink()) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depthLeft > 0) subdirectories.push(fullPath);
        continue;
      }
      if (!entry.isFile() || !tempFilePattern.test(entry.name)) continue;
      try {
        const info = await lstat(fullPath);
        if (!info.isFile() || now - info.mtimeMs < maxAgeMs) continue;
        await unlink(fullPath);
        summary.deletedCount += 1;
        summary.deletedBytes += info.size;
      } catch {
        summary.errorCount += 1;
      }
    }
    for (const subdirectory of subdirectories) {
      if (summary.truncated) return;
      await walk(subdirectory, depthLeft - 1);
    }
  };

  for (const target of targets) {
    if (!target?.dir || summary.truncated) continue;
    await walk(path.resolve(String(target.dir)), target.recursive ? Math.max(0, Number(target.maxDepth ?? 4)) : 0);
  }
  return summary;
}

/**
 * 공개 설치 파일(ModyCrew.exe)이 임시 폴더에 남긴 설치기 복사본을 지운다.
 *
 * 공개 설치 파일은 앱 실행 파일과 이름이 같아, 옛 제거 프로그램이 설치 중인 자신을 끄지 않도록 임시 폴더에
 * ModyCrew-Setup.exe(설치 파일 전체, 약 400MB)로 복사해 실행한다(build/installer.nsh preInit). 실행 중인 파일은
 * 스스로 지울 수 없어 설치할 때마다 복사본이 남았다. 그래서 설치가 끝난 뒤 처음 켜진 앱이 지운다.
 * 지우는 것은 다음을 모두 만족하는 것뿐이다.
 *  - 임시 폴더 바로 아래, installer.nsh 가 만드는 이름(ModyCrew-Setup-<숫자>-<숫자>)의 폴더
 *    (다른 NSIS 설치기와 같이 쓰는 nsXXXX.tmp 이름은 보지 않는다)
 *  - 안에 ModyCrew-Setup.exe 파일 하나만 있음(다른 것이 있으면 손대지 않는다)
 *  - 폴더를 만든 지 15초가 지남(복사 직후 실행 전의 짧은 순간만 피한다)
 * 설치기가 아직 실행 중이면 파일이 잠겨 지우지 못한다. 폴더는 비었을 때만 지운다.
 *
 * 예전에는 "만든 지 1분"을 요구했는데 정리는 앱이 켜진 30초 뒤 한 번뿐이라, 설치가 30초 안쪽으로 빨리
 * 끝나면 그 한 번을 놓치고 400MB 가 다음 실행까지 남았다(늘 켜 두는 PC 에서는 며칠씩).
 * 그래서 기준을 줄이고, 아직 못 지운 것(방금 만든 폴더·잠긴 파일)은 pendingCount 로 알려 앱이 몇 분 뒤 한 번 더 본다.
 */
export const installerCopyFolderPattern = /^ModyCrew-Setup-\d+-\d+$/u;
export const installerCopyFileName = "ModyCrew-Setup.exe";
export const installerCopyMinAgeMs = 15_000;

export async function cleanupLeftoverInstallerCopies(
  { tempDir = os.tmpdir(), now = Date.now(), minAgeMs = installerCopyMinAgeMs, maxEntries = defaultMaxEntries, maxFolders = 50 } = {},
) {
  // pendingCount: 지금은 못 지웠지만 조금 뒤 다시 보면 지울 수 있는 것(방금 만든 폴더, 실행 중이라 잠긴 파일).
  const summary = { scannedEntries: 0, deletedCount: 0, deletedBytes: 0, skippedCount: 0, errorCount: 0, pendingCount: 0 };
  const folders = [];
  let handle;
  try {
    handle = await opendir(tempDir);
  } catch {
    return summary;
  }
  for await (const entry of handle) {
    summary.scannedEntries += 1;
    if (summary.scannedEntries > maxEntries || folders.length >= maxFolders) break;
    // 바로가기·링크는 isDirectory() 가 false 라 여기서 빠진다.
    if (entry.isDirectory() && installerCopyFolderPattern.test(entry.name)) folders.push(path.join(tempDir, entry.name));
  }
  for (const folder of folders) {
    try {
      const folderInfo = await lstat(folder);
      const names = folderInfo.isDirectory() ? await readdir(folder) : null;
      if (!names || names.some((name) => name !== installerCopyFileName)) {
        summary.skippedCount += 1;
        continue;
      }
      if (now - folderInfo.birthtimeMs < minAgeMs) {
        summary.skippedCount += 1;
        summary.pendingCount += 1;
        continue;
      }
      if (names.length === 1) {
        const filePath = path.join(folder, installerCopyFileName);
        const info = await lstat(filePath);
        if (!info.isFile()) {
          summary.skippedCount += 1;
          continue;
        }
        await unlink(filePath);
        summary.deletedCount += 1;
        summary.deletedBytes += info.size;
      }
      await rmdir(folder);
    } catch {
      // 설치기가 아직 끝나는 중이면 파일이 잠겨 있다. 조금 뒤 다시 보면 지울 수 있다.
      summary.errorCount += 1;
      summary.pendingCount += 1;
    }
  }
  return summary;
}
