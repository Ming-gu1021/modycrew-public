// Used only from a user-requested connection flow. Never pass arbitrary renderer URLs.
export async function openConnectionSetupUrl(shellApi, rawUrl, purpose) {
  const url = new URL(rawUrl);
  const transportSafe = url.protocol === "https:" && !url.username && !url.password && (!url.port || url.port === "443");
  const google = purpose === "google-drive" && url.hostname === "accounts.google.com" && url.pathname === "/o/oauth2/v2/auth";
  const telegram = purpose === "telegram-bot" && url.hostname === "t.me" && (
    /^\/newbot\/[A-Za-z0-9_]{1,64}\/[A-Za-z0-9_]{1,64}$/u.test(url.pathname) ||
    (/^\/[A-Za-z0-9_]{1,64}$/u.test(url.pathname) && url.searchParams.get("startgroup") === "modycrew")
  );
  if (!transportSafe || !(google || telegram)) throw new Error("허용되지 않은 서비스 연결 주소입니다.");
  const open = shellApi?.["openExternal"];
  if (typeof open !== "function") throw new Error("연결 화면을 열 수 없습니다. 앱에서 다시 시도해 주세요.");
  await open.call(shellApi, url.toString());
}
