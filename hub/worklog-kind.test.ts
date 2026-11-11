import { expect, test } from "bun:test";
import { NIGHT_LEAD as NIGHT_EN, SCHEDULE_CHECK_LEAD as CHECK_EN, en } from "./i18n-en.ts";
import { NIGHT_LEAD as NIGHT_KO, SCHEDULE_CHECK_LEAD as CHECK_KO, ko } from "./i18n-ko.ts";
import { ACCOUNT_CHANGED, ACCOUNT_LEAD, ACCOUNT_PICKED, HARNESS_ASK_TAIL, HARNESS_BLOCKED_TAIL, HARNESS_FAILED_MID, HARNESS_RESTART_TAIL, SELF_UPDATE_LEAD, WORKLOG_KINDS, withWorklogKind, worklogKind } from "./worklog-kind.ts";

const gateway = (text: string, extra: Record<string, unknown> = {}) => ({ source: "gateway", text, ...extra });

test("a session line is a session and its state is the leading mark", () => {
	const marks = { "[done]": "done", "[run]": "run", "[wait]": "wait", "[ask]": "ask", "[fail]": "fail" } as const;
	for (const [mark, wst] of Object.entries(marks)) expect(worklogKind({ source: "orchestrator", update_key: "lane:a", text: `${mark} 끝냈어요` })).toEqual({ wk: "session", wst });
	expect(worklogKind({ update_key: "lane:a", text: "진행 소식" })).toEqual({ wk: "session" });
});

test("an explicit kind and state win over what the text says", () => {
	expect(worklogKind({ wk: "update", wst: "fail", text: "[done] 끝", source: "gateway" })).toEqual({ wk: "update", wst: "fail" });
	expect(worklogKind({ wk: "bogus", wst: "bogus", text: "그냥 기록" })).toEqual({ wk: "note" });
});

test("each writer's opener round-trips through the classifier", () => {
	expect(worklogKind(gateway(ko.scheduleCheckLine("할 일 없어요")))).toEqual({ wk: "check" });
	expect(worklogKind(gateway(en.scheduleCheckLine("nothing to do")))).toEqual({ wk: "check" });
	expect(ko.scheduleCheckLine("x").startsWith(CHECK_KO)).toBe(true);
	expect(en.scheduleCheckLine("x").startsWith(CHECK_EN)).toBe(true);
	expect(worklogKind(gateway(`${SELF_UPDATE_LEAD} (v1, 커밋 2개, 테스트 통과).`))).toEqual({ wk: "update" });
	expect(worklogKind(gateway(`omp 새 버전이 있어요 (1 → 2).${HARNESS_ASK_TAIL}`))).toEqual({ wk: "update" });
	expect(worklogKind(gateway(`omp 새 버전이 있어요 (1 → 2) npm이 관리해요${HARNESS_BLOCKED_TAIL}`))).toEqual({ wk: "update" });
	expect(worklogKind(gateway(`omp 1 → 2${HARNESS_RESTART_TAIL}`))).toEqual({ wk: "update" });
	expect(worklogKind(gateway(`omp 1 → 2${HARNESS_FAILED_MID}지금 1): exit 1`))).toEqual({ wk: "update", wst: "fail" });
	expect(worklogKind(gateway(`${ACCOUNT_LEAD}개인에서 회사로 ${ACCOUNT_CHANGED} 한도 때문이에요.`))).toEqual({ wk: "account" });
	expect(worklogKind(gateway(`${ACCOUNT_LEAD}회사로 ${ACCOUNT_PICKED} 처음 골랐기 때문이에요.`))).toEqual({ wk: "account" });
});

test("the nightly line is told by the prefix the prompt gives, in both languages", () => {
	expect(ko.reflect("", "")).toContain(`"${NIGHT_KO} ..."`);
	expect(en.reflect("", "")).toContain(`"${NIGHT_EN} ..."`);
	expect(worklogKind({ source: "orchestrator", text: `${NIGHT_KO} 문제 없었어요` })).toEqual({ wk: "night" });
	expect(worklogKind({ source: "orchestrator", text: `${NIGHT_EN} nothing wrong` })).toEqual({ wk: "night" });
});

test("anything else is system from the gateway and note from the assistant", () => {
	expect(worklogKind(gateway("다시 시작했어요"))).toEqual({ wk: "system" });
	expect(worklogKind(gateway("[fail] 복구하지 못했어요"))).toEqual({ wk: "system", wst: "fail" });
	expect(worklogKind({ source: "orchestrator", text: "[done] 정리했어요" })).toEqual({ wk: "note" });
	expect(worklogKind({})).toEqual({ wk: "note" });
});

test("a stored event without wk is classified when served; other posts are left alone", () => {
	const old = { kind: "out", target: "worklog", source: "gateway", text: ko.scheduleCheckLine("조용해요") };
	expect(withWorklogKind(old)).toMatchObject({ wk: "check" });
	expect(withWorklogKind({ ...old, wk: "check" })).toEqual({ ...old, wk: "check" });
	expect(withWorklogKind({ ...old, target: "web:worklog" })).not.toHaveProperty("wk");
	expect(withWorklogKind({ kind: "message", target: "worklog", text: "안녕" })).not.toHaveProperty("wk");
	expect(WORKLOG_KINDS).toHaveLength(7);
});
