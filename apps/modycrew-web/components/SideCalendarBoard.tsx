"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./SideCalendarBoard.module.css";

/** 캘린더에 표시되는 일정 한 건. 메일·업무·약속 등 출처를 구분한다. */
export type SideCalendarEvent = {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  title: string;
  /** "14:00" 같은 표시용 시각. 없으면 종일 항목. */
  time?: string;
  kind: "mail" | "work" | "meeting" | "note";
  detail?: string;
};

/** 포스트잇 메모 한 장. */
export type SideCalendarNote = {
  id: string;
  text: string;
  color: "yellow" | "pink" | "blue" | "green";
  /** YYYY-MM-DD — 특정 날짜에 붙인 메모면 값이 있다. */
  date?: string;
  createdAt: number;
};

const NOTE_STORAGE_KEY = "modycrew-side-calendar-notes-v1";
/** 사용자가 이 캘린더에서 직접 등록한 일정. 외부 캘린더와는 내용만 공유한다. */
const EVENT_STORAGE_KEY = "modycrew-side-calendar-events-v1";
/** 이미 알림을 띄운 일정 id — 같은 일정으로 두 번 울리지 않게 한다. */
const ALARM_FIRED_KEY = "modycrew-side-calendar-alarmed-v1";
const NOTE_COLORS: SideCalendarNote["color"][] = ["yellow", "pink", "blue", "green"];
/** 일정 시작 몇 분 전에 알릴지. */
const ALARM_LEAD_MINUTES = 10;

const KIND_LABEL: Record<SideCalendarEvent["kind"], string> = {
  mail: "메일",
  work: "업무",
  meeting: "약속",
  note: "메모",
};

function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfMonth(year: number, month: number) {
  return new Date(year, month, 1);
}

/** 달력 격자에 채울 날짜 42칸(6주). 앞뒤 달 날짜도 흐리게 채운다. */
function buildMonthGrid(year: number, month: number) {
  const first = startOfMonth(year, month);
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - first.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const cell = new Date(gridStart);
    cell.setDate(gridStart.getDate() + index);
    return cell;
  });
}

function readStoredNotes(): SideCalendarNote[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(NOTE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is SideCalendarNote =>
      Boolean(item && typeof item === "object" && typeof (item as SideCalendarNote).id === "string"),
    );
  } catch {
    return [];
  }
}

function readStoredEvents(): SideCalendarEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(EVENT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is SideCalendarEvent =>
      Boolean(item && typeof item === "object" && typeof (item as SideCalendarEvent).id === "string"),
    );
  } catch {
    return [];
  }
}

export function SideCalendarBoard({
  events = [],
  todayOverride,
  onSelectDate,
}: {
  events?: SideCalendarEvent[];
  /** 테스트용 고정 오늘 날짜(YYYY-MM-DD). */
  todayOverride?: string;
  onSelectDate?: (dateKey: string) => void;
}) {
  const today = useMemo(() => (todayOverride ? new Date(`${todayOverride}T00:00:00`) : new Date()), [todayOverride]);
  const todayKey = useMemo(() => toDateKey(today), [today]);

  const [viewYear, setViewYear] = useState(() => today.getFullYear());
  const [viewMonth, setViewMonth] = useState(() => today.getMonth());
  const [selectedKey, setSelectedKey] = useState(todayKey);
  const [notes, setNotes] = useState<SideCalendarNote[]>([]);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteColor, setNoteColor] = useState<SideCalendarNote["color"]>("yellow");
  const [localEvents, setLocalEvents] = useState<SideCalendarEvent[]>([]);
  const [eventTitle, setEventTitle] = useState("");
  const [eventTime, setEventTime] = useState("");
  const [alarmOn, setAlarmOn] = useState(true);
  const [alarmPermission, setAlarmPermission] = useState<"default" | "granted" | "denied">("default");

  useEffect(() => {
    setNotes(readStoredNotes());
    setLocalEvents(readStoredEvents());
    if (typeof window !== "undefined" && "Notification" in window) {
      setAlarmPermission(Notification.permission as "default" | "granted" | "denied");
    }
  }, []);

  const persistNotes = useCallback((next: SideCalendarNote[]) => {
    setNotes(next);
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(NOTE_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // 저장 실패는 화면 동작을 막지 않는다.
    }
  }, []);

  const persistEvents = useCallback((next: SideCalendarEvent[]) => {
    setLocalEvents(next);
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(EVENT_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // 저장 실패는 화면 동작을 막지 않는다.
    }
  }, []);

  /** 등록한 일정의 알림 — 시작 10분 전에 한 번만 울린다. */
  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    const timer = window.setInterval(() => {
      if (Notification.permission !== "granted") return;
      let fired: string[] = [];
      try {
        fired = JSON.parse(window.localStorage.getItem(ALARM_FIRED_KEY) || "[]");
      } catch {
        fired = [];
      }
      const now = Date.now();
      const pending = localEvents.filter((event) => {
        if (!event.time || fired.includes(event.id)) return false;
        const at = new Date(`${event.date}T${event.time}:00`).getTime();
        if (Number.isNaN(at)) return false;
        const lead = at - ALARM_LEAD_MINUTES * 60_000;
        return now >= lead && now <= at + 60_000;
      });
      if (!pending.length) return;
      for (const event of pending) {
        new Notification("ModyCrew 일정 알림", {
          body: `${event.time} ${event.title}`,
          tag: event.id,
        });
        fired.push(event.id);
      }
      try {
        window.localStorage.setItem(ALARM_FIRED_KEY, JSON.stringify(fired.slice(-200)));
      } catch {
        // 무시
      }
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [localEvents]);

  const eventsByDate = useMemo(() => {
    const map = new Map<string, SideCalendarEvent[]>();
    for (const event of [...events, ...localEvents]) {
      const list = map.get(event.date);
      if (list) list.push(event);
      else map.set(event.date, [event]);
    }
    return map;
  }, [events, localEvents]);

  const grid = useMemo(() => buildMonthGrid(viewYear, viewMonth), [viewYear, viewMonth]);
  const selectedEvents = eventsByDate.get(selectedKey) ?? [];
  const selectedNotes = notes.filter((note) => note.date === selectedKey);
  const pinnedNotes = notes.filter((note) => !note.date);

  function moveMonth(delta: number) {
    const next = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(next.getFullYear());
    setViewMonth(next.getMonth());
  }

  function selectDate(key: string) {
    setSelectedKey(key);
    onSelectDate?.(key);
  }

  function addNote(attachToDate: boolean) {
    const text = noteDraft.trim();
    if (!text) return;
    const note: SideCalendarNote = {
      id: `note-${Date.now()}-${Math.round(performance.now())}`,
      text,
      color: noteColor,
      date: attachToDate ? selectedKey : undefined,
      createdAt: Date.now(),
    };
    persistNotes([note, ...notes]);
    setNoteDraft("");
  }

  function removeNote(id: string) {
    persistNotes(notes.filter((note) => note.id !== id));
  }

  async function addEvent() {
    const title = eventTitle.trim();
    if (!title) return;
    if (alarmOn && typeof window !== "undefined" && "Notification" in window && Notification.permission === "default") {
      const granted = await Notification.requestPermission();
      setAlarmPermission(granted as "default" | "granted" | "denied");
    }
    const event: SideCalendarEvent = {
      id: `local-event-${Date.now()}`,
      date: selectedKey,
      title,
      time: eventTime || undefined,
      kind: "meeting",
    };
    persistEvents([...localEvents, event]);
    setEventTitle("");
    setEventTime("");
  }

  function removeEvent(id: string) {
    persistEvents(localEvents.filter((event) => event.id !== id));
  }

  const monthLabel = `${viewYear}년 ${viewMonth + 1}월`;

  return (
    <section className={styles.board} aria-label="캘린더와 메모">
      <header className={styles.head}>
        <button type="button" onClick={() => moveMonth(-1)} aria-label="이전 달">
          ‹
        </button>
        <strong>{monthLabel}</strong>
        <button type="button" onClick={() => moveMonth(1)} aria-label="다음 달">
          ›
        </button>
      </header>

      <div className={styles.weekRow} aria-hidden="true">
        {["일", "월", "화", "수", "목", "금", "토"].map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>

      <div className={styles.grid} role="grid" aria-label={`${monthLabel} 달력`}>
        {grid.map((cell) => {
          const key = toDateKey(cell);
          const inMonth = cell.getMonth() === viewMonth;
          const dayEvents = eventsByDate.get(key) ?? [];
          const dayNotes = notes.filter((note) => note.date === key);
          return (
            <button
              key={key}
              type="button"
              className={styles.day}
              data-in-month={inMonth ? "true" : "false"}
              data-today={key === todayKey ? "true" : "false"}
              data-selected={key === selectedKey ? "true" : "false"}
              onClick={() => selectDate(key)}
              aria-label={`${cell.getMonth() + 1}월 ${cell.getDate()}일${dayEvents.length ? ` 일정 ${dayEvents.length}건` : ""}`}
              aria-pressed={key === selectedKey}
            >
              <span>{cell.getDate()}</span>
              {dayEvents.length || dayNotes.length ? (
                <em className={styles.dots} aria-hidden="true">
                  {dayEvents.slice(0, 3).map((event) => (
                    <i key={event.id} data-kind={event.kind} />
                  ))}
                  {dayNotes.length ? <i data-kind="note" /> : null}
                </em>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className={styles.detail}>
        <h3>{selectedKey === todayKey ? "오늘" : selectedKey.replace(/^\d{4}-/u, "").replace("-", "월 ") + "일"}</h3>

        {selectedEvents.length ? (
          <ul className={styles.eventList} aria-label="선택한 날짜 일정">
            {selectedEvents.map((event) => (
              <li key={event.id} data-kind={event.kind}>
                <span className={styles.eventKind}>{KIND_LABEL[event.kind]}</span>
                <span className={styles.eventTitle}>{event.title}</span>
                {event.time ? <span className={styles.eventTime}>{event.time}</span> : null}
                {event.id.startsWith("local-event-") ? (
                  <button type="button" onClick={() => removeEvent(event.id)} aria-label="일정 삭제">
                    ×
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.empty}>등록된 일정이 없습니다.</p>
        )}

        {selectedNotes.length ? (
          <div className={styles.noteWall} aria-label="이 날짜 메모">
            {selectedNotes.map((note) => (
              <article key={note.id} className={styles.note} data-color={note.color}>
                <p>{note.text}</p>
                <button type="button" onClick={() => removeNote(note.id)} aria-label="메모 삭제">
                  ×
                </button>
              </article>
            ))}
          </div>
        ) : null}
      </div>

      <div className={styles.eventComposer}>
        <div className={styles.eventComposerRow}>
          <input
            type="text"
            value={eventTitle}
            onChange={(event) => setEventTitle(event.target.value)}
            placeholder="일정 제목"
            aria-label="일정 제목"
          />
          <input
            type="time"
            value={eventTime}
            onChange={(event) => setEventTime(event.target.value)}
            aria-label="일정 시각"
          />
        </div>
        <div className={styles.eventComposerActions}>
          <label className={styles.alarmToggle}>
            <input
              type="checkbox"
              checked={alarmOn}
              onChange={(event) => setAlarmOn(event.target.checked)}
            />
            시작 10분 전 알림
          </label>
          <button type="button" onClick={() => void addEvent()} disabled={!eventTitle.trim()}>
            일정 등록
          </button>
        </div>
        {alarmOn && alarmPermission === "denied" ? (
          <p className={styles.alarmNotice}>브라우저 알림이 차단돼 있어 알림을 보낼 수 없습니다.</p>
        ) : null}
      </div>

      <div className={styles.composer}>
        <textarea
          value={noteDraft}
          onChange={(event) => setNoteDraft(event.target.value)}
          placeholder="메모를 적어 두세요"
          rows={2}
          aria-label="메모 입력"
        />
        <div className={styles.composerRow}>
          <div className={styles.colors} role="group" aria-label="메모 색">
            {NOTE_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                data-color={color}
                data-active={noteColor === color ? "true" : "false"}
                onClick={() => setNoteColor(color)}
                aria-label={`${color} 색`}
                aria-pressed={noteColor === color}
              />
            ))}
          </div>
          <button type="button" onClick={() => addNote(true)} disabled={!noteDraft.trim()}>
            이 날짜에
          </button>
          <button type="button" onClick={() => addNote(false)} disabled={!noteDraft.trim()}>
            그냥 붙이기
          </button>
        </div>
      </div>

      {pinnedNotes.length ? (
        <div className={styles.noteWall} aria-label="붙여둔 메모">
          {pinnedNotes.map((note) => (
            <article key={note.id} className={styles.note} data-color={note.color}>
              <p>{note.text}</p>
              <button type="button" onClick={() => removeNote(note.id)} aria-label="메모 삭제">
                ×
              </button>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
