// Which agent session answers a conversation (config `conversations.sessions`, hub/convsessions.ts). Pure: the registry passes
// the flag, the enabled kinds and the thread-to-mail lookup. Everything that is not a conversation of its own is `main`, the
// session that also takes every prompt the gateway starts itself (schedules, watches, mail wakes, lane reports).
export const CONV_KINDS = ["mail", "ch", "th", "settings", "alert", "worklog", "task"] as const;
export type ConvKind = (typeof CONV_KINDS)[number];
export type KeyRules = { on: boolean; kinds?: readonly string[]; mailOf?: (thread: string) => string | undefined };

export const MAIN = "main";

function keyOf(target: string, mailOf?: (thread: string) => string | undefined): { kind: ConvKind; key: string } | undefined {
	if (target === "web:alert" || target === "alert") return { kind: "alert", key: "alert" };
	if (target === "web:worklog" || target === "worklog") return { kind: "worklog", key: "worklog" };
	const i = target.indexOf(":");
	if (i < 1 || i === target.length - 1) return undefined;
	const kind = target.slice(0, i);
	const id = target.slice(i + 1);
	if (kind === "mail") return { kind: "mail", key: target };
	if (kind === "th") {
		// A mail's Discord thread and its web conversation are one conversation (hub/runstate.ts mailConversation).
		const mail = mailOf?.(id);
		return mail ? { kind: "mail", key: `mail:${mail}` } : { kind: "th", key: target };
	}
	if (kind === "ch" || kind === "settings" || kind === "task") return { kind, key: target };
	return undefined;
}

/** The session key of `target`: `main`, or the conversation's own key when the feature is on and its kind is enabled. */
export function sessionKeyOf(target: string | undefined, rules: KeyRules): string {
	if (!rules.on || !target) return MAIN;
	const k = keyOf(target, rules.mailOf);
	if (!k) return MAIN;
	return (rules.kinds ?? CONV_KINDS).includes(k.kind) ? k.key : MAIN;
}

export const safeDir = (key: string): string => key.replace(/[^a-z0-9._-]/gi, "_");

/** The target a session's answers and history belong to (the web conversation of that key). */
export function primaryTarget(key: string): string {
	if (key === MAIN) return "web";
	if (key === "alert") return "web:alert";
	if (key === "worklog") return "web:worklog";
	return key;
}
