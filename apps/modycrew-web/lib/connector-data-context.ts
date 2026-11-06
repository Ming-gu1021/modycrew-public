   
                                               
  
                          
                                                  
                                                           
                                    
                                                  
                                                   
  
                                                 
                                               
  
                        
   

/** 데스크톱이 돌려주는 모양 (connector-handler.mjs 의 loadConnectorChatContext). */
export type ConnectorChatContext = {
  status: string;
  mails: Array<{
    providerId?: string;
    /** 어느 메일함에서 왔는지 — 계정이 여럿이면 이것이 없으면 답이 뒤섞인다. */
    connectorId?: string;
    accountLabel?: string;
    subject?: string;
    from?: string;
    receivedAt?: string;
    snippet?: string;
  }>;
  busyWindows: Array<{
    providerId?: string;
    title?: string;
    startsAt?: string;
    endsAt?: string;
    /** Google 은 freeBusy 만 읽어 제목이 항상 "바쁨" 이다 — 진짜 일정 이름이 아니다. */
    titleIsPlaceholder?: boolean;
  }>;
  connectedCount?: number;
  userMessage?: string;
};

/** 사람이 읽는 짧은 시각. 모델이 상대 시각을 해석할 수 있게 요일까지 준다. */
function shortDateTime(iso: string | undefined): string {
  const value = String(iso ?? "").trim();
  if (!value) return "";
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return "";
  const date = new Date(time);
  const weekday = ["일", "월", "화", "수", "목", "금", "토"][date.getDay()];
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${date.getMonth() + 1}/${date.getDate()}(${weekday}) ${hh}:${mm}`;
}

/**
 * 프롬프트에 넣을 블록을 만든다. 넣을 것이 없으면 빈 문자열 — 빈 제목만 남기면
 * 모델이 "연결된 것이 있다"고 착각한다.
 *
 * 항목 수를 여기서 다시 자르지 않는다. 데스크톱이 이미 메일 12건·일정 20건으로
 * 잘라서 보낸다. 두 곳에서 자르면 어디서 잘렸는지 아무도 모르게 된다.
 */
export function buildConnectorDataPromptContext(context: ConnectorChatContext | null): string {
  if (!context) return "";
  const mails = Array.isArray(context.mails) ? context.mails : [];
  const windows = Array.isArray(context.busyWindows) ? context.busyWindows : [];
  if (!mails.length && !windows.length) return "";

  const lines: string[] = [
    "[연결된 곳에서 읽어 온 실제 데이터 — 아래 내용만 근거로 답하고, 없는 것은 지어내지 말 것]",
  ];

  if (mails.length) {
    // 계정이 둘 이상이면 몇 개에서 왔는지 먼저 말한다. 그래야 모델이
    // "회사 메일에는 ~, 개인 메일에는 ~" 처럼 나눠서 답할 수 있다.
    const accounts = [...new Set(mails.map((mail) => (mail.accountLabel ?? "").trim()).filter(Boolean))];
    lines.push(
      accounts.length > 1
        ? `받은 메일 ${mails.length}건 — 계정 ${accounts.length}개(${accounts.join(", ")})에서 함께 읽었습니다:`
        : `받은 메일 ${mails.length}건 (최근 순):`,
    );
    for (const mail of mails) {
      const when = shortDateTime(mail.receivedAt);
      const from = (mail.from ?? "").trim() || "보낸사람 미상";
      const subject = (mail.subject ?? "").trim() || "(제목 없음)";
      const snippet = (mail.snippet ?? "").trim();
      // 미리보기가 제목을 그대로 반복하는 경우가 있어(스니펫 = 제목 + 본문) 중복을 줄인다.
      const tail = snippet && !snippet.startsWith(subject) ? ` — ${snippet}` : "";
      // 계정이 하나뿐이면 매 줄에 같은 이름을 붙여봐야 프롬프트만 길어진다.
      const account = accounts.length > 1 && mail.accountLabel ? `[${mail.accountLabel}] ` : "";
      lines.push(`- ${account}${when ? `${when} ` : ""}${from}: ${subject}${tail}`);
    }
  }

  if (windows.length) {
    const anyPlaceholder = windows.some((window) => window.titleIsPlaceholder);
    lines.push(`일정에서 이미 찬 시간 ${windows.length}건:`);
    for (const window of windows) {
      const start = shortDateTime(window.startsAt);
      const end = shortDateTime(window.endsAt);
      const title = (window.title ?? "").trim() || "바쁨";
      lines.push(`- ${start}${end ? ` ~ ${end}` : ""} · ${title}`);
    }
    if (anyPlaceholder) {
      // 이 한 줄이 없으면 모델이 "바쁨" 을 실제 일정 제목으로 읽고
      // "'바쁨' 이라는 일정이 있으시네요" 같은 헛소리를 한다.
      lines.push(
        "주의: Google 캘린더는 지금 '언제 찼는지'만 읽어옵니다. '바쁨'은 실제 일정 이름이 아니라 시간이 차 있다는 뜻이니, 일정의 내용을 아는 것처럼 말하지 마세요. 비어 있는 시간을 찾아 주는 데는 그대로 쓸 수 있습니다.",
      );
    }
  }

  return lines.join("\n");
}
