// What a 작업내역 post is, for the web's row label and state (docs/web-app-design.md): `wk` the kind, `wst` the state. A writer that knows its kind says it
// (an option of out()); anything stored before that, and anything a writer does not tag, is classified here when it is served (history, live frames,
// notices). The gateway's own lines are told by the openers its writers build them from, exported below and used by the writer and by this file alike,
// so a reworded line changes both. Pure: no I/O, and the writers import this file, never the other way round.
import { NIGHT_LEAD as NIGHT_EN, SCHEDULE_CHECK_LEAD as CHECK_EN } from "./i18n-en.ts";
import { NIGHT_LEAD as NIGHT_KO, SCHEDULE_CHECK_LEAD as CHECK_KO } from "./i18n-ko.ts";
import { splitTone, type Tone } from "./tone.ts";

export const WORKLOG_KINDS = ["session", "check", "night", "update", "account", "system", "note"] as const;
export type WorklogKind = (typeof WORKLOG_KINDS)[number];
const STATES: readonly Tone[] = ["done", "run", "wait", "ask", "fail"];

// hub/selfupdate.ts: the auto-update line. hub/update.ts: the pieces a harness update line is built from. hub/accounts-api.ts switchNotice: the account line.
export const SELF_UPDATE_LEAD = "dotz를 새 버전으로 자동 업데이트했어요";
export const HARNESS_ASK_TAIL = " 설치는 확인한 뒤에 해요.";
export const HARNESS_BLOCKED_TAIL = ". 그 설치 방식대로 올려 주세요.";
export const HARNESS_RESTART_TAIL = " 올리고 재시작해요 (하던 일이 끝나면).";
export const HARNESS_FAILED_MID = " 설치하지 못했어요(";
export const ACCOUNT_LEAD = "계정을 ";
export const ACCOUNT_CHANGED = "바꿨어요.";
export const ACCOUNT_PICKED = "정했어요.";

const HARNESS_TAILS = [HARNESS_ASK_TAIL, HARNESS_BLOCKED_TAIL, HARNESS_RESTART_TAIL, HARNESS_FAILED_MID];
const isHarnessLine = (t: string): boolean => HARNESS_TAILS.some(tail => t.includes(tail));
const isAccountLine = (t: string): boolean => t.startsWith(ACCOUNT_LEAD) && (t.includes(ACCOUNT_CHANGED) || t.includes(ACCOUNT_PICKED));

type Posted = { wk?: unknown; wst?: unknown; text?: unknown; source?: unknown; update_key?: unknown };
const kindOf = (v: unknown): WorklogKind | undefined => WORKLOG_KINDS.find(k => k === v);
const stateOf = (v: unknown): Tone | undefined => STATES.find(s => s === v);

export function worklogKind(e: Posted): { wk: WorklogKind; wst?: Tone } {
	const text = typeof e.text === "string" ? e.text : "";
	const gateway = e.source === "gateway";
	const { tone, rest } = splitTone(text);
	const body = rest.trimStart();
	const wk: WorklogKind =
		kindOf(e.wk) ??
		(typeof e.update_key === "string" && e.update_key.startsWith("lane:") ? "session"
			: [NIGHT_KO, NIGHT_EN].some(lead => body.startsWith(lead)) ? "night"
			: !gateway ? "note"
			: [CHECK_KO, CHECK_EN].some(lead => text.startsWith(lead)) ? "check"
			: text.startsWith(SELF_UPDATE_LEAD) || isHarnessLine(text) ? "update"
			: isAccountLine(text) ? "account"
			: "system");
	const wst = stateOf(e.wst) ?? (wk === "update" && text.includes(HARNESS_FAILED_MID) ? "fail" : wk === "session" || gateway ? tone : undefined);
	return wst ? { wk, wst } : { wk };
}

// A worklog post as it is served: the stored event with `wk` / `wst` filled in when it carries none. Other targets and the owner's own messages are returned as they are.
export function withWorklogKind<E extends { kind: string; target?: unknown }>(e: E): E {
	if (e.target !== "worklog" || (e.kind !== "out" && e.kind !== "lane_report")) return e;
	const k = worklogKind(e);
	const have = e as { wk?: unknown; wst?: unknown };
	return have.wk === k.wk && have.wst === k.wst ? e : { ...e, ...k };
}
