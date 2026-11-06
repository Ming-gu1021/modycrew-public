// Map only an actual claimed run to running. Unknown future states fail closed.
export function taskExecutionEventStatus(status) {
  if (status === "task_execution_running") return "running";
  if (status === "task_execution_completed") return "done";
  if (status === "task_execution_failed") return "error";
  if (status === "task_execution_waiting_approval") return "needs_desktop";
  return "unknown";
}
