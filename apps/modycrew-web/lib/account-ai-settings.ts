"use client";

import type { Unsubscribe } from "firebase/firestore";
import {
  getFirebaseClientApp,
  type ModyAuthSession,
} from "./firebase-client";

export type ModyAiProvider = "gemini" | "openai";

export type ModyAccountAiSettings = {
  provider: ModyAiProvider;
  model: string;
  syncMode: "metadata_only";
  legacyCloudSecretPresent: boolean;
  updatedAtEpochMs: number;
};

type SaveAccountAISettingsInput = {
  provider: ModyAiProvider;
  model: string;
};

export async function saveAccountAISettingsMetadata(
  session: ModyAuthSession,
  input: SaveAccountAISettingsInput,
): Promise<ModyAccountAiSettings> {
  const now = Date.now();
  const [{ deleteField, setDoc, serverTimestamp }, ref] = await Promise.all([
    import("firebase/firestore"),
    getAccountAISettingsRef(session.uid),
  ]);

  const settings: ModyAccountAiSettings = {
    provider: input.provider,
    model: normalizeModel(input.model, input.provider),
    syncMode: "metadata_only",
    legacyCloudSecretPresent: false,
    updatedAtEpochMs: now,
  };

  await setDoc(
    ref,
    {
      ...settings,
      legacyCloudSecretPresent: deleteField(),
      keyFingerprint: deleteField(),
      hasCloudKey: deleteField(),
      secretBox: deleteField(),
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    },
    { merge: true },
  );

  return settings;
}

export async function subscribeAccountAISettings(
  session: ModyAuthSession,
  onChange: (settings: ModyAccountAiSettings | null) => void,
  onError?: (error: Error) => void,
): Promise<Unsubscribe> {
  // 이 기기의 Firebase 로그인과 같은 사람일 때만 실시간 구독을 연다. 로그인이 없으면 보안 규칙이
  // 어차피 거절하는데, 예전에는 그래도 구독을 열어 Firestore 채널이 계속 붙어 있었다(계정 화면
  // 네트워크가 끝나지 않음). 회사 기능(company-client runtime)과 같은 기준이다.
  const app = await getFirebaseClientApp();
  if (app) {
    const { getAuth } = await import("firebase/auth");
    const auth = getAuth(app);
    await auth.authStateReady();
    if (auth.currentUser?.uid !== session.uid) {
      onChange(null);
      return () => undefined;
    }
  }
  const [{ onSnapshot }, ref] = await Promise.all([
    import("firebase/firestore"),
    getAccountAISettingsRef(session.uid),
  ]);

  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        onChange(null);
        return;
      }
      const settings = coerceStoredSettings(snap.data());
      onChange(settings);
      if (settings.legacyCloudSecretPresent) {
        void removeLegacyCloudSecretCopy(ref, settings).catch((error) =>
          onError?.(error instanceof Error ? error : new Error(String(error))),
        );
      }
    },
    (error) => onError?.(error instanceof Error ? error : new Error(String(error))),
  );
}

async function removeLegacyCloudSecretCopy(
  ref: Awaited<ReturnType<typeof getAccountAISettingsRef>>,
  settings: ModyAccountAiSettings,
) {
  const now = Date.now();
  const { deleteField, setDoc, serverTimestamp } = await import("firebase/firestore");

  await setDoc(
    ref,
    {
      provider: settings.provider,
      model: settings.model,
      syncMode: "metadata_only",
      updatedAtEpochMs: now,
      legacyCloudSecretPresent: deleteField(),
      keyFingerprint: deleteField(),
      hasCloudKey: deleteField(),
      secretBox: deleteField(),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

async function getAccountAISettingsRef(uid: string) {
  const app = await getFirebaseClientApp();
  if (!app) throw new Error("Firebase 미설정 - 계정 동기화를 사용할 수 없습니다.");

  const { getFirestore, doc } = await import("firebase/firestore");
  return doc(getFirestore(app), "users", uid, "private", "aiCredential");
}

function normalizeModel(model: string, provider: ModyAiProvider): string {
  const trimmed = model.trim();
  if (trimmed.length > 0) return trimmed.slice(0, 80);
  if (provider === "openai") return "gpt-4o-mini";
  return "gemini-1.5-flash";
}

function coerceStoredSettings(raw: unknown): ModyAccountAiSettings {
  const data = raw as Partial<ModyAccountAiSettings> & { secretBox?: unknown };
  const provider = isProvider(data.provider) ? data.provider : "gemini";
  return {
    provider,
    model: normalizeModel(String(data.model ?? ""), provider),
    syncMode: "metadata_only",
    legacyCloudSecretPresent: Boolean(data.secretBox),
    updatedAtEpochMs:
      typeof data.updatedAtEpochMs === "number" ? data.updatedAtEpochMs : 0,
  };
}

function isProvider(value: unknown): value is ModyAiProvider {
  return value === "gemini" || value === "openai";
}
