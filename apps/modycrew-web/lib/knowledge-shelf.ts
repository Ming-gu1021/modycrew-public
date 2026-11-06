"use client";

/**
 * 정리함 묶음 만들기 — 화면 없이 검증할 수 있는 순수 로직.
 *
 * 자료·배움·정리가 각각 다른 자리에 흩어져 있어서 앱이 무엇을 알고 있는지 사람이
 * 한눈에 볼 수 없었다. 여기서 하나로 모은다. 파일 확장자가 아니라 **무슨 자료인가**로
 * 묶는데, 그 갈래는 데스크톱이 학습할 때 이미 매겨 둔 값(materialType)을 그대로 쓴다.
 *
 * 새로 저장하는 것은 없다.
 */

import type {
  BackgroundDigestEntry,
  DocumentLearningSearchResult,
  LearningLesson,
} from "./desktop-bridge";

export type ShelfItem = {
  id: string;
  title: string;
  detail: string;
  sourceLabel: string;
  path?: string;
  at?: string;
};

export type ShelfGroup = {
  id: string;
  label: string;
  hint: string;
  items: ShelfItem[];
};

/** 데스크톱이 매긴 갈래를 사람이 읽는 이름으로. 모르는 값은 "그 밖의 자료"로 모은다. */
const materialTypeLabels: Record<string, string> = {
  business_file: "업무 파일",
  template_file: "서식·양식",
  mail_reference: "메일 자료",
  mail_system_export: "메일 자료",
  document_material: "문서 자료",
  cloud_sheet: "표·시트",
  general_reference: "참고 자료",
  video_material: "영상·이미지",
  editing_asset: "영상·이미지",
};

const lessonKindLabels: Record<string, string> = {
  preference: "이렇게 해 주세요",
  fact: "알아둘 것",
  procedure: "일하는 순서",
  role: "담당 방식",
};

export function shortDate(iso: string | undefined): string {
  if (!iso) return "";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "";
  return `${parsed.getMonth() + 1}월 ${parsed.getDate()}일`;
}

function oneLine(value: string, max = 140): string {
  return String(value ?? "")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, max);
}

function matches(item: ShelfItem, terms: string[]): boolean {
  if (terms.length === 0) return true;
  const haystack = `${item.title} ${item.detail} ${item.sourceLabel}`.toLocaleLowerCase("ko-KR");
  return terms.every((term) => haystack.includes(term));
}

/**
 * 정리함 묶음 만들기 — 순수 함수라 화면 없이 검증할 수 있다.
 * 파일 확장자가 아니라 데스크톱이 매긴 materialType 으로 묶는다.
 */
export function buildKnowledgeGroups(input: {
  documents: DocumentLearningSearchResult[];
  lessons: LearningLesson[];
  digests: BackgroundDigestEntry[];
  query: string;
}): ShelfGroup[] {
  const { documents, lessons, digests, query } = input;
  const terms = query
    .toLocaleLowerCase("ko-KR")
    .split(/\s+/u)
    .filter(Boolean);

  const byMaterial = new Map<string, ShelfItem[]>();
  for (const doc of documents) {
    const label = materialTypeLabels[String(doc.materialType ?? "")] ?? "그 밖의 자료";
    const item: ShelfItem = {
      id: `doc-${doc.id}`,
      title: doc.title || "이름 없는 자료",
      detail: oneLine(doc.summary),
      sourceLabel: doc.kind || "문서",
      ...(doc.path ? { path: doc.path } : {}),
    };
    // 본문 검색의 일치 정보는 요약에 나오지 않을 수 있다.
    if (!terms.every((term) => doc.matchedTerms?.includes(term)) &&
        !matches({ ...item, detail: doc.summary }, terms)) continue;
    byMaterial.set(label, [...(byMaterial.get(label) ?? []), item]);
  }

  const lessonItems = lessons
    .filter((lesson) => matches({ id: lesson.id, title: lesson.title, detail: lesson.content,
      sourceLabel: lessonKindLabels[lesson.kind] ?? "배운 것" }, terms))
    .map<ShelfItem>((lesson) => ({
      id: `lesson-${lesson.id}`,
      title: lesson.title,
      detail: oneLine(lesson.content),
      sourceLabel: lessonKindLabels[lesson.kind] ?? "배운 것",
      at: lesson.updatedAt,
    }));

  const digestItems = digests
    .filter((digest) => matches({ id: digest.id, title: `${shortDate(digest.createdAt) || "최근"} 정리`,
      detail: digest.text, sourceLabel: "없는 동안" }, terms))
    .map<ShelfItem>((digest) => ({
      id: `digest-${digest.id}`,
      title: `${shortDate(digest.createdAt) || "최근"} 정리`,
      detail: oneLine(digest.text, 200),
      sourceLabel: "없는 동안",
      at: digest.createdAt,
    }));

  const documentGroups: ShelfGroup[] = [...byMaterial.entries()]
    .sort((left, right) => right[1].length - left[1].length)
    .map(([label, items]) => ({
      id: `material-${label}`,
      label,
      hint: "학습해 둔 자료",
      items,
    }));

  return [
    ...(lessonItems.length > 0
      ? [{ id: "lessons", label: "배운 것", hint: "대화에서 알게 된 것", items: lessonItems }]
      : []),
    ...(digestItems.length > 0
      ? [{ id: "digests", label: "없는 동안 정리", hint: "자리를 비운 사이", items: digestItems }]
      : []),
    ...documentGroups,
  ];
}
