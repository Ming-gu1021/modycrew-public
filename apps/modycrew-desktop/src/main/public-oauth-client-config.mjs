import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * 설치 앱 resources에 함께 둘 수 있는 값은 OAuth public client ID뿐입니다.
 * client secret, API key, access/refresh token은 이 파일 형식과 로더에서
 * 의도적으로 다루지 않습니다.
 */
export const publicOAuthClientConfigFileName = "modycrew-public-oauth-client-ids.json";
export const publicOAuthClientConfigSchema = "modycrew.public_oauth_client_ids.v1";
export const publicOAuthClientIdEnvNames = Object.freeze([
  "MODYCREW_GOOGLE_OAUTH_CLIENT_ID",
  "MODYCREW_GOOGLE_SIGNIN_CLIENT_ID",
  "MODYCREW_MICROSOFT_OAUTH_CLIENT_ID",
]);

const publicClientIdPattern = /^[A-Za-z0-9._-]{1,512}$/u;

export function buildPublicOAuthClientConfig(env = {}) {
  const clientIds = {};
  for (const name of publicOAuthClientIdEnvNames) {
    const value = normalizePublicOAuthClientId(env?.[name]);
    if (value) clientIds[name] = value;
  }
  return {
    schema: publicOAuthClientConfigSchema,
    clientIds,
  };
}

/**
 * 패키지 단계에서만 사용할, .env의 허용된 public ID만 읽는 도우미입니다.
 * process.env는 우선권을 가지며 빈 문자열도 명시적인 override로 취급합니다.
 */
export function readPublicOAuthClientIdsFromEnvFile(envPath, env = process.env) {
  const values = {};
  const presentEnv = env && typeof env === "object" ? env : {};

  for (const name of publicOAuthClientIdEnvNames) {
    if (Object.prototype.hasOwnProperty.call(presentEnv, name)) {
      const value = normalizePublicOAuthClientId(presentEnv[name]);
      if (value) values[name] = value;
    }
  }

  if (!envPath || !existsSync(envPath)) return values;

  const content = readFileSync(envPath, "utf8");
  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const name = line.slice(0, separator).trim();
    if (!publicOAuthClientIdEnvNames.includes(name)) continue;
    if (Object.prototype.hasOwnProperty.call(presentEnv, name)) continue;
    const value = normalizePublicOAuthClientId(unquoteEnvValue(line.slice(separator + 1).trim()));
    if (value) values[name] = value;
  }

  return values;
}

/**
 * 설치본에서만 호출합니다. 이미 주입된 환경변수는 절대 덮어쓰지 않습니다.
 */
export function loadPackagedPublicOAuthClientConfig({
  resourcesPath,
  env = process.env,
  fileName = publicOAuthClientConfigFileName,
} = {}) {
  const targetEnv = env && typeof env === "object" ? env : null;
  if (!resourcesPath || !targetEnv) {
    return { status: "public_oauth_config_unavailable", appliedNames: [] };
  }

  const configPath = path.join(resourcesPath, fileName);
  if (!existsSync(configPath)) {
    return { status: "public_oauth_config_missing", appliedNames: [] };
  }

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(configPath, "utf8"));
  } catch {
    return { status: "public_oauth_config_invalid", appliedNames: [] };
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    parsed.schema !== publicOAuthClientConfigSchema ||
    !parsed.clientIds ||
    typeof parsed.clientIds !== "object" ||
    Array.isArray(parsed.clientIds)
  ) {
    return { status: "public_oauth_config_invalid", appliedNames: [] };
  }

  const appliedNames = [];
  for (const name of publicOAuthClientIdEnvNames) {
    // 이미 값이 비어 있어도 명시적으로 주입된 환경변수는 보호합니다.
    if (Object.prototype.hasOwnProperty.call(targetEnv, name)) continue;
    const value = normalizePublicOAuthClientId(parsed.clientIds[name]);
    if (!value) continue;
    targetEnv[name] = value;
    appliedNames.push(name);
  }

  return {
    status: appliedNames.length > 0 ? "public_oauth_config_loaded" : "public_oauth_config_no_changes",
    appliedNames,
  };
}

export function normalizePublicOAuthClientId(value) {
  const text = String(value ?? "").trim();
  return publicClientIdPattern.test(text) ? text : "";
}

function unquoteEnvValue(value) {
  return value.replace(/^(["'])(.*)\1$/u, "$2");
}
