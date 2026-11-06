export type WorkApproach = "auto" | "propose";

export function normalizeWorkApproach(value: unknown): WorkApproach {
  return value === "propose" ? "propose" : "auto";
}

export function buildWorkRefinementContext(request: string, mode: WorkApproach = "auto"): string {
  const imageWork = /사진|이미지|포스터|썸네일|photo|image/iu.test(request);
  const codeWork = /개발|코드|코딩|게임|앱|웹사이트|프로그램|버그/iu.test(request);
  return [
    "[마스터크루 업무 구체화]",
    "사용자의 짧고 비전문적인 표현을 원하는 결과, 필요한 자료, 작업 순서, 결과물과 확인 기준으로 구체화하세요. 사용자가 전문 용어나 역할 분담을 대신 정하게 하지 마세요.",
    "인사나 단순 질문은 자연스럽게 답하세요. 모든 대화에 계획서나 추가 질문을 붙이지 마세요.",
    "확인된 사실과 제안을 구분하고, 되돌릴 수 있는 세부사항은 합리적인 권장값을 선택하세요. 결과를 크게 바꿀 불확실성만 짧게 확인하세요.",
    imageWork ? "사진 작업: 실제 이미지 입력이나 도구의 관찰 결과가 있을 때만 피사체·빛·그림자·구도·색감·배경을 분석하세요. 파일명이나 텍스트 미리보기만으로 사진을 보았다고 말하지 마세요. 원본 특징 보존, 노출·대비·색온도, 자르기와 출력 용도를 함께 검토하고 전문가의 추천 방향을 쉬운 말로 설명하세요." : "",
    codeWork ? "개발 작업: 기존 프로젝트와 요구를 확인하고 화면·데이터·실행 환경·예외 처리·테스트·결과 실행 순서를 정하세요. 코드 설명만으로 작업을 끝내거나 실제 저장·실행 증거 없이 개발 완료로 표시하지 마세요." : "",
    "문서·일정·회사 업무도 대상 독자, 양식, 담당자, 기한과 확인 기준을 필요한 만큼 보완하세요. 사용자가 요청하지 않은 사실·약속·예산을 만들지 마세요.",
    mode === "propose"
      ? "[먼저 제안받기] 이번 응답은 작업안만 작성합니다. 추천 방향과 이유, 실제 확인된 자료, 필요한 단계·결과물, 중요 질문 최대 3개를 간단히 제안하고 사용자 답변을 기다리세요. 실행 도구 요청, 완성 파일 본문, 실행·저장·편집 완료 주장은 하지 마세요. 연결 상태가 주어지지 않았다면 연결되었다고 가정하지 마세요."
      : "[알아서 진행] 추천 방향을 짧게 설명하고 현재 연결과 허용 범위에서 작업하세요. 사소한 선택마다 묻지 마세요. 사용자가 세부 조정을 원하면 반영하고, 실행할 도구가 없다면 필요한 연결을 정확히 알려주세요.",
    "진행 방식은 권한이 아닙니다. 기존 승인 범위와 회사 자료 접근 제한을 지키고 비용·외부 전송·발송·게시·삭제 권한을 새로 얻었다고 해석하지 마세요.",
    "완료 여부는 실제 도구 결과와 저장된 결과물로 확인하세요. 제안 작성, 분석, 실행, 저장, 실패와 승인 대기를 구별하세요.",
  ].filter(Boolean).join("\n");
}

export const isWorkProposalMessage = (id: string) => id.startsWith("assistant-work-proposal-");

export function proposalToRequest(request: string, proposal: string): string {
  return `${request.trim()}\n\n아래 제안으로 진행해줘. 현재 연결과 승인 범위에서 실행하고, 없는 자료나 도구는 알려줘.\n\n[선택한 작업안]\n${proposal.trim()}`;
}
