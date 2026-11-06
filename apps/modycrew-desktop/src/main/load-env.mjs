import { existsSync, readFileSync } from "node:fs";

/**
 * 가벼운 .env 로더.
 *
 * Electron main process 는 Node `--env-file` 옵션을 표준으로 받지 않으므로
 * dotenv 의존성 없이 직접 파싱합니다. 이미 process.env 에 값이 있으면 덮지
 * 않습니다 (CI/PowerShell 에서 set 한 값을 보존).
 */
export function loadDotEnvFile(envPath) {
  if (!envPath || !existsSync(envPath)) return { loaded: false, count: 0 };

  const content = readFileSync(envPath, "utf8");
  let count = 0;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const eq = line.indexOf("=");
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    if (!key) continue;

    if (key in process.env) continue;

    const value = line
      .slice(eq + 1)
      .trim()
      .replace(/^["'](.*)["']$/, "$1");

    process.env[key] = value;
    count += 1;
  }

  return { loaded: true, count };
}
