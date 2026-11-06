"use client";

import type { WorkItem } from "@/lib/types";
import {
  buildMailCardAssigneeOptions,
  buildMailCardTriageView,
  type MailCardAssigneeOption,
} from "@/lib/mail-card-triage";
import styles from "./MailCardTriageLine.module.css";

type MailCardTriageLineProps = {
  item: WorkItem;
  teammates?: readonly MailCardAssigneeOption[];
  changing?: boolean;
  /** 담당을 바꾸지 못했을 때의 한 줄 안내(없으면 그리지 않음). */
  notice?: string;
  onChangeAssignee?: (workItem: WorkItem, teammateId: string) => void | Promise<void>;
};

/**
 * 승인함 메일 카드의 한두 줄: '급함' 표시와 이유, 맡은 AI 직원(바꾸기 가능).
 * 우선순위·담당 값이 없는 카드(메일이 아닌 카드)에는 아무것도 그리지 않는다.
 */
export function MailCardTriageLine({ item, teammates = [], changing = false, notice = "", onChangeAssignee }: MailCardTriageLineProps) {
  const hasTriage = Boolean(item.priority || item.assigneeTeammateId);
  if (!hasTriage) return null;
  const view = buildMailCardTriageView(item);
  const options = buildMailCardAssigneeOptions(teammates, item);
  const canChange = Boolean(onChangeAssignee) && Boolean(item.assigneeTeammateId) && options.length > 1;
  const showFirstLine = view.isUrgent || Boolean(view.reasonLine);

  return (
    <div
      className={styles.triage}
      data-mail-card-triage="priority_reason_assignee"
      data-mail-card-priority={view.priority}
      data-mail-card-priority-source={item.prioritySource ?? ""}
      data-mail-card-assignee-id={item.assigneeTeammateId ?? ""}
      data-mail-card-assignee-source={item.assigneeSource ?? ""}
      data-mail-card-external-mutation="false"
    >
      {showFirstLine ? (
        <p className={styles.priorityLine}>
          {view.isUrgent ? (
            <span className={styles.urgentBadge} data-mail-card-urgent-badge="true">
              {view.badgeLabel}
            </span>
          ) : null}
          {view.reasonLine ? (
            <span className={styles.reason} title={view.reasonLine} data-mail-card-priority-reason="true">
              {view.reasonLine}
            </span>
          ) : null}
        </p>
      ) : null}
      {view.assigneeLabel ? (
        <p className={styles.assigneeLine}>
          {canChange ? (
            <label className={styles.assigneePicker} title={view.assigneeReason || undefined}>
              <span className={styles.assigneePrefix}>담당</span>
              <select
                className={styles.assigneeSelect}
                value={item.assigneeTeammateId}
                disabled={changing}
                aria-label={`${item.title} 담당 AI 직원 바꾸기`}
                data-mail-card-assignee-select="true"
                onChange={(event) => {
                  void onChangeAssignee?.(item, event.target.value);
                }}
              >
                {options.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.roleTitle && option.roleTitle !== option.name ? `${option.name} · ${option.roleTitle}` : option.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <span className={styles.assigneeStatic} title={view.assigneeReason || undefined}>
              {view.assigneeLabel}
            </span>
          )}
          {view.assigneeReason ? (
            <span className={styles.assigneeReason} data-mail-card-assignee-reason="true">
              {view.assigneeReason}
            </span>
          ) : null}
        </p>
      ) : null}
      {notice ? (
        <p className={styles.notice} role="status" data-mail-card-assignee-notice="true">
          {notice}
        </p>
      ) : null}
    </div>
  );
}
