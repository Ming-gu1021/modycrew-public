"use client";

export type AuthPreferences = {
  rememberEmail: boolean;
  autoLogin: boolean;
  rememberedEmail: string;
};

const AUTH_PREFERENCES_KEY = "modycrew.authPreferences.v1";

const defaultPreferences: AuthPreferences = {
  rememberEmail: false,
  autoLogin: true,
  rememberedEmail: "",
};

function canUseStorage() {
  return typeof window !== "undefined" && Boolean(window.localStorage);
}

export function readAuthPreferences(): AuthPreferences {
  if (!canUseStorage()) return defaultPreferences;

  try {
    const raw = window.localStorage.getItem(AUTH_PREFERENCES_KEY);
    if (!raw) return defaultPreferences;
    const parsed = JSON.parse(raw) as Partial<AuthPreferences>;
    return {
      rememberEmail: parsed.rememberEmail === true,
      autoLogin: parsed.autoLogin !== false,
      rememberedEmail:
        parsed.rememberEmail === true && typeof parsed.rememberedEmail === "string"
          ? parsed.rememberedEmail
          : "",
    };
  } catch {
    return defaultPreferences;
  }
}

export function saveAuthPreferences(input: {
  email: string;
  rememberEmail: boolean;
  autoLogin: boolean;
}) {
  if (!canUseStorage()) return;

  const preferences: AuthPreferences = {
    rememberEmail: input.rememberEmail,
    autoLogin: input.autoLogin,
    rememberedEmail: input.rememberEmail ? input.email.trim() : "",
  };

  window.localStorage.setItem(AUTH_PREFERENCES_KEY, JSON.stringify(preferences));
}
