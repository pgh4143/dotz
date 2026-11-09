import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { issueBlock } from "./choices.ts";
import { DONE_REPLY } from "./decision-any-marker.fixture.ts";
import { inboxText } from "./intake.ts";
import { reflectPrompt } from "./reflect.ts";

// The 알림 / 작업 기록 conversations: the page's real routing (09-needs-you.js eventTarget), intake (13-data.js ingestMsg), message rule
// (31-conversations.js convReal) and choice parser (10-decision-card.js), run on the real source text.
const web = (f: string) => readFileSync(join(import.meta.dir, "..", "web", "js", f), "utf8");
const cut = (src: string, from: string, to: string) => src.slice(src.indexOf(from), src.indexOf(to));

function page() {
	const MAIN = "main";
	const TS: Record<string, any> = {};
	const env: Record<string, unknown> = {
		MAIN, TS,
		isProjT: (t: string) => /^ch:\d+$/.test(t), isTaskT: (t: string) => /^task:[a-z0-9]+$/.test(t), isLaneT: (t: string) => t.startsWith("lane:"),
		ts: (t: string) => TS[t] || (TS[t] = { msgs: [], mk: new Set(), acts: [], ak: new Set(), cap: 600, hLoaded: false, aLoaded: false }),
		msgKey: (e: any) => `${e.ts}|${e.kind}|${e.update_key ?? ""}|${e.text}`, actKey: (a: any) => `${a.ts}|${a.type}`,
		targetOfSource: () => MAIN, isRestart: () => false, paintRestartBanner: () => {}, convNote: () => {},
		CV: { full: false }, target: MAIN, chatPush: () => {}, termPush: () => {}, ownerish: () => false, ownerAct: () => ({}), paintDecision: () => {},
		isLaneReport: () => false, LP: {}, laneRefresh: () => {}, noteDone: () => {}, targetInfo: () => ({}),
	};
	const src = [
		cut(web("02-basic-markdown.js"), "const TONE_TAGS", "/* ---------- api"),
		cut(web("08-home.js"), "const isFixedT", "const FIXED_NAME"),
		cut(web("09-needs-you.js"), "function eventTarget", "/* ---------- conversation view"),
		cut(web("13-data.js"), "// 알림 / 작업 기록: a post edited", "async function loadTarget"),
		cut(web("31-conversations.js"), "const CONV_KINDS", "const convIncoming"),
		cut(web("10-decision-card.js"), "const CH_OPT", "const DC = "),
	].join("\n");
	return new Function(...Object.keys(env), `${src}\nreturn { eventTarget, ingestMsg, convReal, parseChoices, isChoiceMsg, choiceAsks, parseTone, isFixedT, TS };`)(...Object.values(env)) as {
		eventTarget: (e: any) => string | null; ingestMsg: (e: any) => void; convReal: (e: any) => boolean;
		parseChoices: (t: string) => { question: string; blocks: { title: string; options: { n: number; label: string; desc: string }[] }[] };
		isChoiceMsg: (pc: any) => boolean; isFixedT: (t: string) => boolean;
		choiceAsks: (e: any, tone: string, pc: any) => boolean; parseTone: (t: string) => { tone: string; text: string };
	} & { TS: Record<string, any> };
}
const T0 = Date.now();
const at = (s: number) => new Date(T0 + s * 1000).toISOString();
const out = (s: number, target: string, extra: Record<string, unknown> = {}) => ({ ts: at(s), kind: "out", source: "gateway", target, text: `글 ${s}`, ...extra });

describe("알림 and 작업 기록 are conversations of their own", () => {
	test("an alert or worklog post lands in its conversation, never in the main chat; the main chat keeps its own", () => {
		const p = page();
		expect(p.isFixedT("alert") && p.isFixedT("worklog") && !p.isFixedT("main")).toBe(true);
		expect(p.eventTarget(out(1, "alert"))).toBe("alert");
		expect(p.eventTarget(out(2, "worklog", { update_key: "lane:a" }))).toBe("worklog");
		expect(p.eventTarget({ ts: at(3), kind: "out", source: "orchestrator", target: "web:alert", text: "답" })).toBe("alert");
		expect(p.eventTarget({ ts: at(4), kind: "message", source: "web", channel: "web:worklog", text: "물음" })).toBe("worklog");
		expect(p.eventTarget({ ts: at(5), kind: "watch", source: "watch:w", watch: "w", channels: ["1"], text: "x" })).toBeNull();
		expect(p.eventTarget({ ts: at(6), kind: "out", source: "orchestrator", target: "web", text: "답" })).toBe("main");
		expect(p.eventTarget({ ts: at(7), kind: "out", source: "orchestrator", target: "ch:7", text: "답" })).toBe("ch:7");
		expect(p.eventTarget({ ts: at(8), kind: "out", source: "lane:a", target: "lane:a", text: "답" })).toBe("lane:a");
	});

	test("ingest: an alert out is stored under alert only; entries sharing an update_key collapse into the newest one", () => {
		const p = page();
		const TS = p.TS;
		p.ingestMsg(out(1, "alert"));
		p.ingestMsg(out(2, "worklog", { update_key: "lane:a", text: "[run] 시작" }));
		p.ingestMsg(out(3, "worklog", { update_key: "lane:b", text: "[run] 다른 세션" }));
		p.ingestMsg(out(4, "worklog", { update_key: "lane:a", text: "[done] 끝" }));
		p.ingestMsg({ ts: at(5), kind: "out", source: "orchestrator", target: "web", text: "메인 답" });
		const list = (t: string) => (TS[t]?.msgs ?? []).map((e: any) => e.text);
		expect(list("alert")).toEqual(["글 1"]);
		expect(list("worklog")).toEqual(["[run] 다른 세션", "[done] 끝"]);
		expect(list("main")).toEqual(["메인 답"]);
	});

	test("only the two fixed conversations count an update_key post as a message (elsewhere it is a progress note)", () => {
		const p = page();
		expect(p.convReal(out(1, "worklog", { update_key: "lane:a" }))).toBe(true);
		expect(p.convReal(out(2, "alert", { update_key: "rate" }))).toBe(true);
		expect(p.convReal(out(3, "alert", { update_key: "progress" }))).toBe(false);
		expect(p.convReal({ ts: at(4), kind: "out", source: "orchestrator", target: "web", update_key: "progress", text: "x" })).toBe(false);
		expect(p.convReal({ ts: at(5), kind: "out", source: "lane:a", target: "lane:a", update_key: "k", text: "x" })).toBe(false);
		expect(p.convReal(out(6, "alert"))).toBe(true);
	});
});

describe("buttons for an [ask] message or any message with a 결정: choice block", () => {
	const list = "설치 방법은 두 가지예요\n1) 브루로 설치\n2) 직접 빌드";
	const shown = (e: any) => {
		const p = page(), { tone, text } = p.parseTone(e.text);
		return p.choiceAsks(e, tone, p.parseChoices(text));
	};
	const reply = (text: string, extra: Record<string, unknown> = {}) => ({ ts: at(1), kind: "out", source: "orchestrator", target: "web", text, ...extra });

	test("a plain reply with a 1) list stays text", () => {
		expect(page().parseChoices(list).blocks).toHaveLength(0);   // the parser reads only blocks a 결정: line opened: a bare list is no decision
		expect(shown(reply(list))).toBe(false);   // a message without the marker gets no buttons
		expect(shown(reply(`**1) 가**\n설명\n**2) 나**\n설명`))).toBe(false);
		expect(shown(reply(`[done] ${list}`))).toBe(false);
	});

	test("the [ask] marker (its real outgoing shape) and the gateway's own alert keep their buttons", () => {
		expect(shown(reply(`[ask] 어떻게 할까요?\n결정: 설치\n**1) 브루**\n빠르고 간단해요\n**2) 직접 빌드**\n오래 걸려요`))).toBe(true);
		expect(shown(reply(`[ask] ${list}`))).toBe(true);
		const block = issueBlock("어떻게 할까요?", [{ name: "원인 확인", result: "살펴봐요." }, { name: "넘어가요", result: "다음에 봐요." }]);
		expect(shown(out(2, "alert", { text: `토큰 점검에서 경고 1건\n${block}` }))).toBe(true);
		expect(shown(reply(`토큰 점검에서 경고 1건\n${block}`, { target: "alert" }))).toBe(true);
	});

	test("a [done] answer, a no-marker answer and a lane report with a 결정: block get buttons; the exact mac mini text too", () => {
		expect(shown(reply(DONE_REPLY))).toBe(true);
		expect(shown(reply(DONE_REPLY.replace("[done] ", "")))).toBe(true);
		expect(shown(reply(DONE_REPLY, { kind: "lane_report", lane: "a" }))).toBe(true);
		const pc = page().parseChoices(page().parseTone(DONE_REPLY).text);
		expect(pc.blocks).toHaveLength(1);
		expect(pc.blocks[0]!.title).toBe("방문 예약");
		expect(pc.blocks[0]!.options.map(o => o.n)).toEqual([1, 2, 3]);
	});

	test("a bare numbered list or a single option after 결정: stays text under any marker", () => {
		expect(shown(reply("[done] 두 가지예요\n**1) 가**\n설명\n**2) 나**\n설명"))).toBe(false);
		expect(shown(reply("[fail] 결정: 하나뿐\n**1) 가**\n설명"))).toBe(false);
	});
});

describe("issue reports are choices the decision parser reads", () => {
	// The shape every prompt teaches: a "결정:" / "Decision:" line and 2-4 `**n) name**` options, each with a one-line consequence.
	const template = (text: string) => {
		const lines = text.split("\n"), i = lines.findIndex(l => /^(?:결정|Decision):/.test(l));
		expect(i).toBeGreaterThanOrEqual(0);
		return lines.slice(i, i + 5).join("\n");
	};
	const reads = (block: string) => {
		const p = page(), pc = p.parseChoices(block);
		expect(p.isChoiceMsg(pc)).toBe(true);
		expect(pc.blocks).toHaveLength(1);
		expect(pc.blocks[0]!.options.map(o => o.n)).toEqual([1, 2]);
		expect(pc.blocks[0]!.options.every(o => o.desc.length > 0)).toBe(true);
	};

	test("the nightly reflect prompt carries the choice shape, and a report in that shape parses into buttons", () => {
		const prompt = reflectPrompt("digest");
		expect(prompt).toContain("alert");
		reads(template(prompt));
	});

	test("the watch wake prompt (with and without a work channel) carries the same shape", () => {
		const ev = { kind: "watch", watch: "w", reason: "output changed", text: "out" };
		reads(template(inboxText({ ...ev, channels: ["1"] })));
		reads(template(inboxText(ev)));
	});

	test("an old message's recommendation mark never reaches the page's options", () => {
		expect(page().parseChoices("[ask] 배포\n결정: 시점\n**1) 지금** ← 추천\n바로 올려요\n**2) 내일**\n미뤄요").blocks[0]!.options.map(o => o.label)).toEqual(["지금", "내일"]);
	});

	test("a gateway report (issue line + issueBlock) is read by the page's parser", () => {
		const report = `토큰 점검에서 경고 2건\n${issueBlock("이 경고를 어떻게 할까요?", [{ name: "원인 확인", result: "원인을 살펴봐요." }, { name: "넘어가요", result: "다음에 다시 봐요." }])}`;
		reads(report.split("\n").slice(1).join("\n"));
		const pc = page().parseChoices(report);
		expect(pc.question).toBe("토큰 점검에서 경고 2건");
		expect(pc.blocks[0]!.title).toBe("이 경고를 어떻게 할까요?");
	});
});
