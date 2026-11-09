// Which session answers a target (hub/session-key.ts): every mapping of the conversation-sessions plan, the flag and the kinds.
import { expect, test } from "bun:test";
import { CONV_KINDS, primaryTarget, safeDir, sessionKeyOf } from "./session-key.ts";

const mailOf = (thread: string) => (thread === "111" ? "acme-1" : undefined);
const on = { on: true, mailOf };

test("each target maps to its session key when the feature is on", () => {
	const table: [string, string][] = [
		["web", "main"],
		["chat", "main"],
		["terminal", "main"],
		["dm", "main"],
		["brief", "main"],
		["mail:acme-1", "mail:acme-1"],
		["th:111", "mail:acme-1"],
		["th:222", "th:222"],
		["ch:333", "ch:333"],
		["settings:mail-1", "settings:mail-1"],
		["web:alert", "alert"],
		["alert", "alert"],
		["web:worklog", "worklog"],
		["worklog", "worklog"],
		["lane:ktx", "main"],
		["", "main"],
	];
	for (const [target, key] of table) expect([target, sessionKeyOf(target, on)]).toEqual([target, key]);
	expect(sessionKeyOf(undefined, on)).toBe("main");
});

test("the flag off gives main for every target", () => {
	for (const t of ["mail:acme-1", "th:111", "th:222", "ch:333", "settings:x", "web:alert", "worklog"]) expect(sessionKeyOf(t, { on: false, mailOf })).toBe("main");
});

test("a kind left out of conversations.kinds falls back to main", () => {
	const rules = { on: true, mailOf, kinds: ["ch", "settings"] };
	expect(sessionKeyOf("ch:333", rules)).toBe("ch:333");
	expect(sessionKeyOf("settings:x", rules)).toBe("settings:x");
	expect(sessionKeyOf("mail:acme-1", rules)).toBe("main");
	// A mail's thread is the mail kind, not the thread kind.
	expect(sessionKeyOf("th:111", rules)).toBe("main");
	expect(sessionKeyOf("th:222", { ...rules, kinds: ["th"] })).toBe("th:222");
	expect(sessionKeyOf("th:111", { ...rules, kinds: ["th"] })).toBe("main");
	expect(sessionKeyOf("web:alert", rules)).toBe("main");
	expect(CONV_KINDS).toEqual(["mail", "ch", "th", "settings", "alert", "worklog", "task"]);
});

test("primaryTarget and safeDir", () => {
	expect(primaryTarget("main")).toBe("web");
	expect(primaryTarget("alert")).toBe("web:alert");
	expect(primaryTarget("worklog")).toBe("web:worklog");
	expect(primaryTarget("mail:acme-1")).toBe("mail:acme-1");
	expect(primaryTarget("ch:333")).toBe("ch:333");
	expect(safeDir("mail:acme-1")).toBe("mail_acme-1");
	expect(safeDir("settings:a/b c")).toBe("settings_a_b_c");
});
