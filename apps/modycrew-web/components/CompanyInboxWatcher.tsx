"use client";

import { useEffect } from "react";
import { onAuthSession } from "@/lib/firebase-client";
import { subscribeCompanyMemberships, subscribeCompanyTeams, subscribeLatestCompanyMessage } from "@/lib/company-client";
import {
  COMPANY_SEEN_EVENT, companyNotificationContent, companyTeamKey, countUnreadCompanyTeams, markCompanyTeamSeen,
  publishCompanyUnreadCount, readLastSeen, shouldNotifyCompanyMessage,
} from "@/lib/company-unread.mjs";
import { navigateInternalPath } from "@/lib/safe-navigation";
import type { CompanyMessage, CompanyTeam } from "@/lib/company-types";

function safeStorage(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}

/**
 * App-wide team-chat watcher: keeps the unread dot on '우리 회사' and raises an OS notification
 * when a coworker writes while this window is hidden or showing another screen.
 * It listens to the newest message of each team only (one document per team).
 */
export function CompanyInboxWatcher() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    // Secondary windows (detached office, worker companion) leave this to the main window.
    if ((window.location.pathname.startsWith("/office") && params.get("from") === "chat-window") || params.get("workerCompanion") === "1") return;
    let mounted = true;
    let generation = 0;
    let authStop: (() => void) | undefined;
    let membershipsStop: (() => void) | undefined;
    const companies = new Map<string, () => void>();
    const latest: Record<string, CompanyMessage | null> = {};
    const labels = new Map<string, { companyName: string; teamName: string }>();
    let uid = "";
    const startedAt = Date.now();
    const refresh = () => {
      if (!uid) { publishCompanyUnreadCount(0); return; }
      publishCompanyUnreadCount(countUnreadCompanyTeams(latest, readLastSeen(safeStorage(), uid), uid));
    };
    const onSeen = () => refresh();
    const onStorage = (event: StorageEvent) => { if (!event.key || event.key.includes("modycrew.company.lastSeen")) refresh(); };
    window.addEventListener(COMPANY_SEEN_EVENT, onSeen);
    window.addEventListener("storage", onStorage);
    const clear = () => {
      membershipsStop?.(); membershipsStop = undefined;
      companies.forEach((stop) => stop()); companies.clear();
      for (const key of Object.keys(latest)) delete latest[key];
      labels.clear();
    };
    const notify = (key: string, message: CompanyMessage, target: { companyId: string; teamId: string }) => {
      if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
      const label = labels.get(key);
      const content = companyNotificationContent({ companyName: label?.companyName, teamName: label?.teamName, message });
      try {
        const notification = new Notification(content.title, { body: content.body, tag: `modycrew-company-${key}` });
        notification.onclick = () => {
          window.focus();
          notification.close();
          navigateInternalPath(`/company?company=${encodeURIComponent(target.companyId)}&team=${encodeURIComponent(target.teamId)}`);
        };
      } catch { /* Notifications are a convenience; the unread dot still shows. */ }
    };
    void onAuthSession((session) => {
      generation += 1;
      clear();
      uid = session?.uid || "";
      refresh();
      if (!session || !mounted) return;
      const current = generation;
      const live = () => mounted && current === generation;
      // Permission is asked from the company screen by a click (browsers ignore prompts without one).
      void subscribeCompanyMemberships(session, (memberships) => {
        if (!live()) return;
        const ids = new Set(memberships.map((item) => item.companyId));
        companies.forEach((stop, cid) => { if (!ids.has(cid)) { stop(); companies.delete(cid); } });
        for (const membership of memberships) {
          const cid = membership.companyId;
          if (companies.has(cid)) continue;
          const teamStops = new Map<string, () => void>();
          let disposed = false;
          let teamsStop: (() => void) | undefined;
          const stopTeam = (tid: string) => {
            teamStops.get(tid)?.(); teamStops.delete(tid);
            delete latest[companyTeamKey(cid, tid)]; labels.delete(companyTeamKey(cid, tid));
          };
          const stop = () => { disposed = true; teamsStop?.(); [...teamStops.keys()].forEach(stopTeam); refresh(); };
          companies.set(cid, stop);
          const watchTeams = (teams: CompanyTeam[]) => {
            if (disposed || !live()) return;
            // Admins receive every team document, but only a team's members may read its chat.
            const readable = teams.filter((team) => team.visibility === "company" || team.memberIds.includes(session.uid));
            const readableIds = new Set(readable.map((team) => team.id));
            [...teamStops.keys()].forEach((tid) => { if (!readableIds.has(tid)) stopTeam(tid); });
            for (const team of readable) {
              const key = companyTeamKey(cid, team.id);
              labels.set(key, { companyName: membership.companyName, teamName: team.name });
              if (teamStops.has(team.id)) continue;
              let previousId: string | undefined;
              let first = true;
              let teamStop: (() => void) | undefined;
              let teamDisposed = false;
              teamStops.set(team.id, () => { teamDisposed = true; teamStop?.(); });
              void subscribeLatestCompanyMessage(session, cid, team.id, (message) => {
                if (teamDisposed || disposed || !live()) return;
                const storage = safeStorage();
                const seen = readLastSeen(storage, session.uid)[key];
                // The first time a team is seen on this PC, its history counts as read.
                if (seen === undefined && message) markCompanyTeamSeen(storage, session.uid, cid, team.id, message.createdAtEpochMs);
                if (!first && message && shouldNotifyCompanyMessage({ message, previousId, lastSeenMs: seen, myUid: session.uid, startedAt, documentHidden: document.hidden, pathname: window.location.pathname })) {
                  notify(key, message, { companyId: cid, teamId: team.id });
                }
                first = false;
                previousId = message?.id;
                latest[key] = message;
                refresh();
              }, () => { stopTeam(team.id); refresh(); })
                .then((unsubscribe) => { if (teamDisposed || disposed || !live()) unsubscribe(); else teamStop = unsubscribe; })
                .catch(() => { stopTeam(team.id); });
            }
            refresh();
          };
          void subscribeCompanyTeams(session, cid, watchTeams, () => stop())
            .then((unsubscribe) => { if (disposed || !live()) unsubscribe(); else teamsStop = unsubscribe; })
            .catch(() => { if (companies.get(cid) === stop) { stop(); companies.delete(cid); } });
        }
        refresh();
      }, () => { clear(); refresh(); })
        .then((unsubscribe) => { if (live()) membershipsStop = unsubscribe; else unsubscribe(); })
        .catch(() => undefined);
    }).then((stop) => { if (mounted) authStop = stop; else stop(); }).catch(() => undefined);
    return () => {
      mounted = false; generation += 1; authStop?.(); clear();
      window.removeEventListener(COMPANY_SEEN_EVENT, onSeen);
      window.removeEventListener("storage", onStorage);
      publishCompanyUnreadCount(0);
    };
  }, []);
  return null;
}
