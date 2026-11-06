/**
 * Firebase Web SDK 클라이언트 config.
 *
 * 이 6개 값은 **비밀이 아닙니다**. Firebase 공식 입장으로 클라이언트 코드/빌드물에
 * 노출돼도 보안 문제 없습니다. 진짜 방어선은 Firebase Console 의 다음 설정입니다.
 *
 * - Authentication → Settings → Authorized domains (등록된 도메인만 로그인 허용)
 * - Google Cloud Console → Credentials → API key restrictions (HTTP referrer 등)
 * - Firebase App Check (정식 출시 직전 추가 권장)
 * - Security Rules (Firestore/Storage 사용 시)
 *
 * 그래도 `.env.local` 에 두는 이유는 환경별(dev/staging/prod) 분리 + 협업자별
 * 다른 프로젝트 사용을 위함이고, 비밀이라서가 아닙니다.
 */

export type ModyFirebaseClientConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
};

export type ModyFirebaseConfigStatus =
  | { ready: true; config: ModyFirebaseClientConfig; missing: never[] }
  | { ready: false; config: null; missing: string[] };

const envKeys: Array<{ key: keyof ModyFirebaseClientConfig; envName: string }> = [
  { key: "apiKey", envName: "NEXT_PUBLIC_MODYCREW_FIREBASE_API_KEY" },
  { key: "authDomain", envName: "NEXT_PUBLIC_MODYCREW_FIREBASE_AUTH_DOMAIN" },
  { key: "projectId", envName: "NEXT_PUBLIC_MODYCREW_FIREBASE_PROJECT_ID" },
  { key: "storageBucket", envName: "NEXT_PUBLIC_MODYCREW_FIREBASE_STORAGE_BUCKET" },
  { key: "messagingSenderId", envName: "NEXT_PUBLIC_MODYCREW_FIREBASE_MESSAGING_SENDER_ID" },
  { key: "appId", envName: "NEXT_PUBLIC_MODYCREW_FIREBASE_APP_ID" },
];

/**
 * `.env.local` 값을 읽어 client config 를 만듭니다.
 *
 * Next.js 는 `NEXT_PUBLIC_` 접두사 변수만 클라이언트 번들에 inject 합니다.
 * 빌드 시점에 값이 inline 되며, 런타임에 env 가 사라지지 않습니다.
 */
export function readFirebaseClientConfig(): ModyFirebaseConfigStatus {
  const raw: Record<keyof ModyFirebaseClientConfig, string> = {
    apiKey: process.env.NEXT_PUBLIC_MODYCREW_FIREBASE_API_KEY ?? "",
    authDomain: process.env.NEXT_PUBLIC_MODYCREW_FIREBASE_AUTH_DOMAIN ?? "",
    projectId: process.env.NEXT_PUBLIC_MODYCREW_FIREBASE_PROJECT_ID ?? "",
    storageBucket: process.env.NEXT_PUBLIC_MODYCREW_FIREBASE_STORAGE_BUCKET ?? "",
    messagingSenderId:
      process.env.NEXT_PUBLIC_MODYCREW_FIREBASE_MESSAGING_SENDER_ID ?? "",
    appId: process.env.NEXT_PUBLIC_MODYCREW_FIREBASE_APP_ID ?? "",
  };

  const missing = envKeys
    .filter(({ key }) => !raw[key].trim())
    .map(({ envName }) => envName);

  if (missing.length > 0) {
    return { ready: false, config: null, missing };
  }

  return {
    ready: true,
    config: raw,
    missing: [] as never[],
  };
}
