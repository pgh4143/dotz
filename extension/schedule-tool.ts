// dotz_schedule add: every new schedule says whose it is (hub/schedule.ts ScheduleKind). Imports nothing from hub/ (the extension->hub edge ceiling).

/** The refusal for an add without a valid kind, or undefined when the call may go on. */
export function scheduleKindRefusal(p: { action?: string; kind?: unknown }): string | undefined {
	if (p.action !== "add" || p.kind === "owner" || p.kind === "check") return undefined;
	return 'Not added: kind is required. kind="owner": the owner explicitly asked to be told, reminded or sent this report (delivered and notified as a normal message). kind="check": your own system check or follow-up (quiet: a plain answer stays one worklog line, and only an answer starting with [ask] or [fail] reaches the owner; checks fall on a :00/:30 grid and those due together are one turn). Add again with kind set.';
}
