"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { callSecretary, readAssistantName, subscribeSecretary, SECRETARY_NAME_EVENT } from "@/lib/assistant-secretary";
import styles from "./AssistantRailButton.module.css";

type Counts = { status?: string; unread?: number; attention?: number };

/** 왼쪽 맨 위 MODY 탭. 누르면 비서와 대화하는 화면으로 간다. 새 소식·확인할 일 개수를 보여 준다. */
export default function AssistantRailButton({ collapsed }: { collapsed: boolean }) {
  const pathname = usePathname() ?? "/";
  const active = /^\/assistant\/?$/u.test(pathname);
  const [name, setName] = useState("MODY");
  const [unread, setUnread] = useState(0);
  const [attention, setAttention] = useState(0);

  useEffect(() => {
    setName(readAssistantName());
    const onName = () => setName(readAssistantName());
    window.addEventListener(SECRETARY_NAME_EVENT, onName);
    window.addEventListener("storage", onName);
    return () => { window.removeEventListener(SECRETARY_NAME_EVENT, onName); window.removeEventListener("storage", onName); };
  }, []);

  useEffect(() => {
    let alive = true;
    const load = () => callSecretary<Counts>({ kind: "counts" })
      .then((counts) => {
        if (!alive || counts?.status !== "assistant_secretary_counts") return;
        setUnread(Math.max(0, Number(counts.unread) || 0));
        setAttention(Math.max(0, Number(counts.attention) || 0));
      })
      .catch(() => undefined);
    void load();
    const unsubscribe = subscribeSecretary(() => { void load(); });
    const timer = window.setInterval(() => { void load(); }, 120_000);
    return () => { alive = false; unsubscribe(); window.clearInterval(timer); };
  }, []);

  const subtitle = attention ? "확인할 일 " + attention + "개" : unread ? "새 소식 " + unread + "개" : "업무 비서와 대화";
  const label = name + " 비서와 대화" + (attention ? " · 확인할 일 " + attention + "개" : unread ? " · 새 소식 " + unread + "개" : "");
  return <Link
    href={"/assistant/" as Route}
    className={styles.trigger}
    aria-current={active ? "page" : undefined}
    aria-label={label}
    title={label}
    data-attention={attention > 0 ? "true" : "false"}
    data-unread-count={unread}
  >
    <span className={styles.mark} aria-hidden="true">✦</span>
    {!collapsed && <span>{name}<small>{subtitle}</small></span>}
    {unread > 0 && <span className={styles.badge} aria-hidden="true">{unread > 99 ? "99+" : unread}</span>}
  </Link>;
}

