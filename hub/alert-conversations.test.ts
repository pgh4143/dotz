import { expect, test } from "bun:test";
import { issueBlock } from "./choices.ts";
import { unreadOf } from "./conversations.ts";
import { emit, eventTarget, historyEvents } from "./events.ts";
import { decisionsOf } from "./notices.ts";
import { isWatchIssue, watchChoice } from "./watch.ts";

const post = (ts: string, target: string, extra: Record<string, unknown> = {}) => emit("outbox", { ts, kind: "out", source: "gateway", target, text: `글 ${ts}`, ...extra });

test("alert and worklog are fixed conversations next to main", () => {
	expect(eventTarget({ ts: "x", kind: "out", target: "alert" })).toBe("alert");
	expect(eventTarget({ ts: "x", kind: "out", target: "worklog", update_key: "lane:a" })).toBe("worklog");
	expect(eventTarget({ ts: "x", kind: "out", target: "web:alert" })).toBe("alert");
	expect(eventTarget({ ts: "x", kind: "delivery", target: "web:worklog" })).toBe("worklog");
	expect(eventTarget({ ts: "x", kind: "message", channel: "web:alert" })).toBe("alert");
	expect(eventTarget({ ts: "x", kind: "watch", watch: "w", channels: ["1"] })).toBeUndefined();
	expect(eventTarget({ ts: "x", kind: "out", target: "web" })).toBe("main");
	expect(eventTarget({ ts: "x", kind: "out", target: "ch:5" })).toBe("ch:5");
});

test("history of worklog shows each update_key once, as its newest version, and never leaks into main", () => {
	post("2050-03-01T00:00:01.000Z", "worklog", { update_key: "lane:h1", text: "[run] 시작" });
	post("2050-03-01T00:00:02.000Z", "worklog", { update_key: "lane:h2", text: "[run] 다른 세션" });
	post("2050-03-01T00:00:03.000Z", "worklog", { update_key: "lane:h1", text: "[done] 끝" });
	post("2050-03-01T00:00:04.000Z", "alert", { text: "경고예요" });
	const mine = (e: { update_key?: unknown }) => e.update_key === "lane:h1" || e.update_key === "lane:h2";   // the store is shared across test files
	const w = historyEvents("worklog", 50).filter(mine);
	expect(w.map(e => e.text)).toEqual(["[run] 다른 세션", "[done] 끝"]);
	expect(w.map(e => [e.wk, e.wst])).toEqual([["session", "run"], ["session", "done"]]);
	expect(historyEvents("alert", 50).some(e => e.text === "경고예요")).toBe(true);
	expect(historyEvents("main", 500).some(e => e.target === "alert" || e.target === "worklog")).toBe(false);
	expect(historyEvents("worklog", 500, "2050-03-01T00:00:03.000Z").filter(mine).map(e => e.text)).toEqual(["[run] 시작", "[run] 다른 세션"]);
});

test("unread counts an alert once and a re-edited worklog entry once", () => {
	const a0 = unreadOf("alert"), w0 = unreadOf("worklog");
	post("2050-04-01T00:00:01.000Z", "alert", { text: "하나" });
	post("2050-04-01T00:00:02.000Z", "alert", { text: "둘" });
	post("2050-04-01T00:00:03.000Z", "worklog", { update_key: "lane:u1", text: "[run] a" });
	post("2050-04-01T00:00:04.000Z", "worklog", { update_key: "lane:u1", text: "[run] b" });
	post("2050-04-01T00:00:05.000Z", "worklog", { update_key: "lane:u1", text: "[done] c" });
	expect(unreadOf("alert") - a0).toBe(2);
	expect(unreadOf("worklog") - w0).toBe(1);
});

test("a gateway alert with a choice block makes a decision, a plain one or a worklog entry does not", () => {
	const block = issueBlock("어떻게 할까요?", [{ name: "원인 확인", result: "살펴봐요." }, { name: "넘어가요", result: "다음에 봐요." }]);
	const ask = { ts: "2050-05-01T00:00:00.000Z", kind: "out", source: "gateway", target: "alert", text: `토큰 점검: 경고 1건\n${block}` };
	const [d] = decisionsOf(ask);
	expect(d).toMatchObject({ to: "alert", group: 1 });
	expect(d!.options.map(o => o.n)).toEqual([1, 2]);
	expect(decisionsOf({ ...ask, text: "토큰 점검: 경고 1건" })).toEqual([]);
	expect(decisionsOf({ ...ask, target: "worklog" })).toEqual([]);
});

test("only failing, stopped or unapproved checks are issues; their report carries a choice block", () => {
	expect(isWatchIssue("failed 3 times in a row (exit 1)")).toBe(true);
	expect(isWatchIssue("stopped after a timeout failure; it runs again once the owner approves")).toBe(true);
	expect(isWatchIssue("needs the owner's approval first")).toBe(true);
	expect(isWatchIssue("recovered")).toBe(false);
	expect(isWatchIssue("output changed")).toBe(false);
	const [d] = decisionsOf({ ts: "2050-05-02T00:00:00.000Z", kind: "out", source: "gateway", target: "alert", text: `[w] failed 2 times\n${watchChoice("w")}` });
	expect(d!.options).toHaveLength(2);
	expect(watchChoice("가격 확인", "failed 2 times in a row (exit 1)")).toContain("결정: 가격 확인: 2번 연속 실패했어요. 어떻게 할까요?");
	expect(watchChoice("샘플 로그인 유지", "stopped after a password failure; it runs again once the owner approves")).toContain("결정: 샘플 로그인 유지: 저장된 비밀번호가 없어 다시 로그인하지 못했어요. 어떻게 할까요?");
	expect(watchChoice("가격 확인")).toContain("결정: 모니터링 가격 확인을 어떻게 할까요?");
	expect(watchChoice("uptime")).toContain("결정: 모니터링 uptime을(를) 어떻게 할까요?");
});
