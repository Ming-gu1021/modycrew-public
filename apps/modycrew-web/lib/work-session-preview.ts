export type WorkSessionPreview = {
  label: "진행 상황" | "최근 답변" | "최근 요청";
  text: string;
};

type PreviewMessage = { id: string; role: string; text: string };

/** 표시용 발췌다. 원문과 업무 상태는 바꾸지 않고 HTML도 생성하지 않는다. */
function previewText(value: string): string {
  const text = value
    .replace(/^\s*(?:`{3,}|~{3,})[^\r\n]*$/gmu, " ")
    .replace(/!?\[([^\]\r\n]*)\]\([^\)\r\n]*\)/gu, "$1")
    .replace(/<\/?[A-Za-z][^>\r\n]*>/gu, " ")
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s*|[-+*]\s+|\d+[.)]\s+)/gmu, "")
    .replace(/(`+)([^`]+)\1/gu, "$2")
    .replace(/(\*\*|__|~~)(.+?)\1/gu, "$2")
    .replace(/\*([^*\r\n]+)\*/gu, "$1")
    .replace(/[\u0000-\u001f\u007f\s]+/gu, " ")
    .trim();
  if (text.length <= 240) return text;
  return `${text.slice(0, 239).replace(/[\uD800-\uDBFF]$/u, "").trimEnd()}…`;
}

/** 실제 실행 안내 또는 가장 최근 대화만 보여주며 승인·성공 여부를 추정하지 않는다. */
export function buildWorkSessionPreview(
  messages: readonly PreviewMessage[],
  run?: { detail: string },
): WorkSessionPreview | undefined {
  if (run) return { label: "진행 상황", text: previewText(run.detail) || "업무를 진행 중입니다." };
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.id === "assistant-welcome" || !["assistant", "user"].includes(message.role)) continue;
    const text = previewText(message.text);
    if (!text) continue;
    return { label: message.role === "assistant" ? "최근 답변" : "최근 요청", text };
  }
  return undefined;
}
