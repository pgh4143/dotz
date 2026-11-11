import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const web = (f: string) => readFileSync(join(import.meta.dir, "..", "web", f), "utf8");
const notices = web("js/30-notices.js");
const between = (src: string, from: string, to: string) => {
	const a = src.indexOf(from), b = src.indexOf(to, a);
	if (a < 0 || b < 0) throw new Error(`block not found: ${from}`);
	return src.slice(a, b);
};

type N = Record<string, unknown>;
const dec = { options: [], to: "main", reply_to: "t", group: 1, state: "open" };

// The kind -> action mapping (30-notices.js noticeKindAction), run as shipped, over a given notice store.
const ntIsDec = (n: N) => n.kind === "decision" && !!n.decision;
const linkedBlock = between(notices, "const ntOpenDec", "const ntById");
const ntDecisions = (items: N[]) => () => items.filter(n => ntIsDec(n) && (n.decision as N).state === "open");
const linkedOf = (items: N[]) => new Function("NT", "ntIsDec", "ntDecisions", `${linkedBlock}; return ntLinkedDec;`)({ items }, ntIsDec, ntDecisions(items)) as (n: N) => N | null;
const actionIn = (items: N[]) => new Function("NM", "ntIsDec", "ntLinkedDec", `${between(notices, "function noticeKindAction", "async function noticeOpen(")}; return noticeKindAction;`)(
	{ items: [] }, ntIsDec, linkedOf(items),
) as (n: N, mons?: { name: string }[]) => string;
const actionOf = actionIn([]);

describe("notice kind -> action", () => {
	const mons = [{ name: "디스크 감시" }];
	test.each([
		["open decision", { kind: "decision", decision: dec, tone: "ask" }, "sheet"],
		["answered decision", { kind: "decision", decision: { ...dec, state: "answered" } }, "sheet"],
		["[ask] message", { kind: "alert", tone: "ask", src: "alert" }, "ask"],
		["session [ask]", { kind: "result", tone: "ask", src: "lane:a" }, "ask"],
		["failure alert", { kind: "alert", tone: "fail", src: "alert" }, "detail"],
		["session report", { kind: "result", tone: "done", src: "lane:a", open: "lane:a" }, "session"],
		["failed session report", { kind: "result", tone: "fail", src: "lane:a" }, "session"],
		["worklog item", { kind: "worklog", tone: "", src: "worklog" }, "worklog"],
		["monitor notice", { kind: "watch", tone: "", title: "디스크 감시", src: "alert" }, "monitor"],
		["monitor that is gone", { kind: "watch", tone: "", title: "없는 감시", src: "alert" }, "monitor"],
		["plain alert", { kind: "alert", tone: "", src: "alert" }, "message"],
		["plain message", { kind: "message", tone: "", src: "main" }, "message"],
		["new mail", { kind: "watch", tone: "", src: "mail:abc" }, "message"],
	])("%s", (_name, n, want) => {
		expect(actionOf(n as N, mons)).toBe(want as string);
	});
});

// Shapes from the live GET /api/notices of 2026-10-22 (bodies and option texts stripped): one [ask] question is stored as three items,
// the decision, an [ask] alert with the same time, and the conversation's latest-message item (key msg:alert) that the 알림 row shows.
const live = (state: "open" | "answered"): N[] => [
	{ id: "c223ecf2", ts: "2026-10-22T06:34:12.758Z", updated: "2026-10-22T06:34:12.758Z", kind: "decision", tone: "ask", title: "알림 열기 확인", open: "alert", src: "alert", at: "2026-10-22T06:34:12.758Z", key: "dec:alert:5q00w4", read: false,
		decision: { options: [{ n: "1", label: "확인됨" }, { n: "2", label: "안 됨" }], to: "alert", reply_to: "2026-10-22T06:34:12.758Z", group: 1, state } },
	{ id: "eb0e4c1e", ts: "2026-10-22T00:32:40.030Z", updated: "2026-10-22T06:34:23.811Z", kind: "message", tone: "", title: "알림", open: "alert", src: "alert", at: "2026-10-22T06:34:23.811Z", key: "msg:alert", read: false },
	{ id: "1f3d708d", ts: "2026-10-22T06:34:12.758Z", updated: "2026-10-22T06:34:12.758Z", kind: "alert", tone: "ask", title: "알림", open: "alert", src: "alert", at: "2026-10-22T06:34:12.758Z", read: false },
	{ id: "2989a018", ts: "2026-10-21T13:36:56.683Z", updated: "2026-10-22T06:32:58.531Z", kind: "message", tone: "", title: "땃쥐", open: "main", src: "main", at: "2026-10-22T06:32:58.531Z", key: "msg:main", read: true },
	{ id: "9973c0d6", ts: "2026-10-22T06:01:21.759Z", updated: "2026-10-22T06:01:21.759Z", kind: "worklog", tone: "", title: "작업 기록", open: "worklog", src: "worklog", at: "2026-10-22T06:01:21.759Z", read: true },
];

describe("a notice that links to an open decision", () => {
	test.each([["decision", "c223ecf2"], ["[ask] alert twin", "1f3d708d"], ["latest-message item of the conversation", "eb0e4c1e"]])("%s opens the decision sheet, not the conversation", (_n, id) => {
		const items = live("open"), n = items.find(x => x.id === id)!;
		expect(actionIn(items)(n)).toBe("sheet");
		expect(linkedOf(items)(n)!.id).toBe("c223ecf2");
	});
	test("once it is answered the twins fall back to their own kind", () => {
		const items = live("answered");
		expect(actionIn(items)(items.find(x => x.id === "1f3d708d")!)).toBe("ask");
		expect(actionIn(items)(items.find(x => x.id === "eb0e4c1e")!)).toBe("message");
	});
	test("items of other conversations never link to it", () => {
		const items = live("open");
		expect(actionIn(items)(items.find(x => x.id === "2989a018")!)).toBe("message");
		expect(actionIn(items)(items.find(x => x.id === "9973c0d6")!)).toBe("worklog");
	});
	test("noticeOpen hands the sheet the decision's id, whichever twin was tapped", async () => {
		const items = live("open"), opened: unknown[] = [];
		const fn = new Function("noticeKindAction", "ntLinkedDec", "ntRead", "noticeSheetOpen", "ntAskSheet", "ntJump", "ntDetailOpen", "ntUnder", "monOpen",
			`${between(notices, "async function noticeOpen(", "async function noticeOpenId(")}; return noticeOpen;`)(
			actionIn(items), linkedOf(items), () => {}, (id: string) => opened.push(id), () => { throw new Error("ask"); }, () => { throw new Error("jump"); }, () => {}, () => {}, () => {});
		for (const n of items.slice(0, 3)) await fn(n);
		expect(opened).toEqual(["c223ecf2", "c223ecf2", "c223ecf2"]);
	});
});

describe("web build id", () => {
	test("the script carries the id that /api/state reports, so an open page can tell it is stale", async () => {
		const { bundle, webBuild } = await import("./webapp.ts");
		expect(bundle("js").text.startsWith(`"use strict";\nconst WEB_BUILD = "${webBuild()}";`)).toBe(true);   // the directive stays the first statement
		expect(webBuild()).toMatch(/^[0-9a-f]{12}$/);
		expect(readFileSync(join(import.meta.dir, "routes.ts"), "utf8")).toContain("web_build: webBuild()");
		expect(web("js/17-state-refresh.js")).toContain("webBuildCheck(S.web_build)");
	});
});

describe("noticeOpen dispatch", () => {
	const run = (n: N | null, ask = true, here = false) => {
		const calls: unknown[][] = [];
		const rec = (name: string) => (...a: unknown[]) => { calls.push([name, ...a]); return undefined; };
		const fn = new Function("noticeKindAction", "ntLinkedDec", "ntRead", "noticeSheetOpen", "ntAskSheet", "ntJump", "ntDetailOpen", "ntUnder", "monOpen",
			`${between(notices, "async function noticeOpen(", "async function noticeOpenId(")}; return noticeOpen;`)(
			(x: N) => x.act, () => null, rec("read"), rec("sheet"), (x: N) => { calls.push(["ask", x.id]); return Promise.resolve(ask); }, rec("jump"), rec("detail"), rec("under"), rec("monitor"));
		return fn(n, here).then(() => calls);
	};
	test("each action reaches its own opener", async () => {
		expect(await run({ act: "sheet", id: "7" })).toEqual([["under", { act: "sheet", id: "7" }], ["sheet", "7"]]);
		expect(await run({ act: "sheet", id: "7" }, true, true)).toEqual([["sheet", "7"]]);   // tapped on the message: the list stays put
		expect(await run({ act: "detail", id: "8" })).toEqual([["read", { act: "detail", id: "8" }], ["under", { act: "detail", id: "8" }], ["detail", { act: "detail", id: "8" }]]);
		expect((await run({ act: "session", id: "9" }))[1]![0]).toBe("jump");
		expect(await run({ act: "monitor", title: "디스크 감시" })).toEqual([["read", { act: "monitor", title: "디스크 감시" }], ["monitor", { act: "monitor", title: "디스크 감시" }]]);
		expect(await run({ act: "worklog", id: "1" })).toEqual([["jump", { act: "worklog", id: "1" }]]);
		expect(await run({ act: "message", id: "2" })).toEqual([["jump", { act: "message", id: "2" }]]);
		expect(await run(null)).toEqual([]);
	});
	test("an [ask] whose question is gone falls back to the conversation", async () => {
		expect(await run({ act: "ask", id: "3" }, true)).toEqual([["under", { act: "ask", id: "3" }], ["ask", "3"]]);
		expect(await run({ act: "ask", id: "3" }, false)).toEqual([["under", { act: "ask", id: "3" }], ["ask", "3"]]);
		expect(await run({ act: "ask", id: "3" }, false, true)).toEqual([["ask", "3"], ["jump", { act: "ask", id: "3" }]]);
	});
});

describe("what waits on the owner (ntNeeds)", () => {
	const needs = new Function("NT", "ntIsDec", `${between(notices, "const ntOpenDec", "const ntById")}; return ntNeeds;`)({ items: [] }, ntIsDec) as (n: N) => boolean;
	test.each([
		["open decision", { kind: "decision", tone: "ask", read: false, decision: dec }, true],
		["unread [ask] twin", { kind: "alert", tone: "ask", read: false }, true],
		["read [ask] twin", { kind: "alert", tone: "ask", read: true }, false],
		["ignored decision", { kind: "decision", tone: "ask", read: true, ignored: "t", decision: { ...dec, state: "ignored" } }, false],
		["answered decision", { kind: "decision", tone: "ask", read: true, decision: { ...dec, state: "answered" } }, false],
		["plain unread alert", { kind: "alert", tone: "", read: false }, false],
		["unread failure", { kind: "alert", tone: "fail", read: false }, false],
	] as [string, N, boolean][])("%s", (_name, n, want) => expect(needs(n)).toBe(want));
});

describe("entry points use the shared handler", () => {
	test("the home notice card: each row opens its notice through noticeOpen, without opening the card", () => {
		const opened: N[] = [];
		const stop: string[] = [], tones: string[] = [];
		const el = (_t: string, p: Record<string, unknown>, ...kids: unknown[]) => ({ p, kids });
		const block = between(web("js/08-home.js"), "const hcNotices", "// Gateway restarts");
		// The x (무시) rides only on a row that waits on the owner (ntNeeds); here the decision row.
		const hcNotices = new Function("el", "hcDot", "hcLine", "ntLaneNote", "ntWhen", "noticeOpen", "ntNeeds", "ntIgnoreBtn", "resultChips", "resultMarker", `${block}; return hcNotices;`)(
			el, (tone: string) => { tones.push(tone); return null; }, (n: N) => n.title, () => "", () => "", (n: N) => opened.push(n), (n: N) => n.kind === "decision", (n: N) => ({ x: n.id }), () => null, () => []) as (l: N[]) => { kids: ({ x?: string } & { p: { onclick: (ev: unknown) => void; onkeydown: (ev: unknown) => void } })[] };
		const list = [{ id: "a", kind: "decision", title: "결정" }, { id: "b", kind: "alert", title: "경고" }];
		const rows = hcNotices(list).kids;
		const login = hcNotices([{ id: "c", kind: "alert", title: "로그인", tone: "fail", waits: "login" }, { id: "d", kind: "alert", title: "실패", tone: "fail" }]).kids;
		expect(login).toHaveLength(2);
		expect(tones.slice(-2)).toEqual(["ask", "fail"]);   // a login that waits is orange as on the 알림 screen, a failure stays red
		const ev = { stopPropagation: () => stop.push("s"), preventDefault: () => {}, key: "Enter" };
		rows[0]!.p.onclick(ev);
		rows[1]!.p.onkeydown(ev);
		expect(opened).toEqual(list);
		expect(stop).toHaveLength(2);
		expect(rows[0]!.kids.some((k: unknown) => (k as { x?: string } | null)?.x === "a")).toBe(true);
		expect(rows[1]!.kids.some((k: unknown) => (k as { x?: string } | null)?.x)).toBe(false);
	});

	test("the 알림 / 작업내역 screens: a tapped message opens its notice through noticeOpen, an inline choice row too", () => {
		class Element { constructor(public closest: (sel: string) => unknown) {} }
		const opened: unknown[] = [], msgs = [{ ts: "T1", kind: "out", target: "alert" }];
		let handler: ((ev: unknown) => void) | undefined;
		const timeline = { addEventListener: (_t: string, h: (ev: unknown) => void, cap: boolean) => { if (cap) handler = h; } };
		const bm = { dataset: { ts: "T1" } };
		const make = (state: { current: string; target: string }) => new Function("timeline", "current", "target", "isFixedT", "Element", "tl", "ts", "getSelection", "ntOfEvent", "noticeOpen",
			`${between(notices, "timeline.addEventListener(\"click\"", "}, true);")}}, true);`)(
			timeline, state.current, state.target, (t: string) => t === "alert" || t === "worklog", Element, { contains: () => true }, () => ({ msgs }), () => "", (e: unknown) => ({ e }), (n: unknown) => opened.push(n));
		const tap = (inside: Record<string, boolean>) => {
			const flags: string[] = [];
			handler!({ target: new Element(sel => (sel === ".bm[data-ts]" ? bm : inside[sel] ? {} : null)), stopPropagation: () => flags.push("stop"), preventDefault: () => flags.push("prevent") });
			return flags;
		};
		make({ current: "chat", target: "alert" });
		expect(tap({})).toEqual(["stop", "prevent"]);
		expect(opened).toEqual([{ e: msgs[0] }]);
		const link = "a, summary, details[open] pre, input, textarea, button:not(.dcm-row), .fatt";
		expect(tap({ [link]: true })).toEqual([]);   // a link / fold / other button / file row inside keeps its own job
		expect(opened).toHaveLength(1);
		make({ current: "chat", target: "main" });   // the main chat is untouched: its choice rows answer in place
		expect(tap({})).toEqual([]);
		expect(opened).toHaveLength(1);
	});

	test("toast, push, 답변 필요, the service worker message and a cold start all go through the same handler", () => {
		const md = web("js/02-basic-markdown.js"), home = web("js/08-home.js"), sw = web("js/23-installable-app-web.js");
		expect(between(md, "n.addEventListener(\"click\"", "n.addEventListener(\"pointerenter\"")).toContain("noticeOpen(ntOfEvent(e))");
		expect(between(notices, "function pushOpen", "/* ---- one handler")).toContain("noticeOpen(");
		expect(between(notices, "function ntHomeRow", "/* ---- detail sheet")).toContain("noticeOpen(n)");
		expect(notices).toContain("noticeOpenId(d.notice, false,");
		expect(notices).toContain("setTimeout(() => pushTapCold(noticeOpenId(want, true,");   // the cold start reports where the same handler landed
		expect(between(notices, "function noticeLive", "async function ntMarkRead")).toContain("noticeOpenId(e.item.id)");
		expect(sw).toContain("pushOpen(h, d.ts, d.nid)");
		expect(home).toContain("noticeOpen(n)");
	});
});

// Owner 2026-10-22 (phone): a decision tapped from 알림 moved into the conversation and the decision UI showed with it. Entering 알림 / 작업 기록
// docked the waiting question above the composer (10-decision-card.js paintDecision); a decision opens only as the sheet.
describe("a decision never docks in the 알림 / 작업내역 conversations", () => {
	const run = (target: string) => {
		const box = { hidden: true, dataset: {} as Record<string, string>, style: {} as Record<string, string> }, calls: string[] = [], DC: { cur: unknown; picks: Record<string, unknown>; step: Record<string, unknown>; fold: Record<string, unknown>; st: Record<string, unknown>; edit: Record<string, unknown>; files: Record<string, unknown>; fbusy: Record<string, unknown> } = { cur: null, picks: {}, step: {}, fold: {}, st: {}, edit: {}, files: {}, fbusy: {} };
		const dc = { key: `${target}|x`, t: target, sig: "x", at: "T", question: "q", blocks: [{ title: "", options: [{ n: 1, label: "a" }] }] };
		const src = web("js/10-decision-card.js"), body = `${between(src, "function dcHold", "function renderDecision")}${src.slice(src.indexOf("function paintDecision"))}`;
		const page: Record<string, unknown> = {
			$: () => box, document: { querySelectorAll: () => [] }, decisionOf: () => dc, isFixedT: (x: string) => x === "alert" || x === "worklog", target, DC, clear: () => {}, renderDecision: () => calls.push("render"),
			syncInlineChoices: () => {}, dkPaint: () => {}, updateComposerMeta: () => {}, S: null, DC_SEEN: new Set(), freshKeys: () => new Set(), dcLast: null, dcOut: null, dcShownT: "",
			dcLeave: () => calls.push("leave"), dcBackNote: () => "", motionSwap: (_: unknown, f: () => void) => f(), motionIn: () => {},
		};
		new Function(...Object.keys(page), `${body}; paintDecision();`)(...Object.values(page));
		return { hidden: box.hidden, cur: DC.cur, calls };
	};
	test("the main chat still docks it", () => {
		const r = run("main");
		expect(r.hidden).toBe(false);
		expect(r.cur).not.toBeNull();
	});
	test.each(["alert", "worklog"])("%s: no card above the composer", t => {
		const r = run(t);
		expect(r.hidden).toBe(true);
		expect(r.cur).toBeNull();
		expect(r.calls).toEqual([]);
	});
});

// A tap on a push that had to start the app: ?m=<ts> (jump to the message) or ?n=<id> (decision sheet). A decision carries n; its sheet must survive, and it
// never also jumps to a conversation. (23-installable-app-web.js strips m from the address; it used to strip n with it.)
describe("cold start from a tapped push", () => {
	const start = (href: string) => {
		const u = new URL(href), replaced: string[] = [];
		const out = new Function("location", "history", `${between(web("js/23-installable-app-web.js"), "// A tap that had to start the app", "async function pwaInit")}; return { pushOpenTs };`)(
			{ search: u.search, pathname: u.pathname, hash: u.hash }, { state: null, replaceState: (_s: unknown, _t: string, url: string) => replaced.push(url) }) as { pushOpenTs: string };
		return { ts: out.pushOpenTs, url: replaced[replaced.length - 1] ?? "unchanged" };
	};
	test("?m alone: the message opens, m leaves the address", () => {
		expect(start("http://h/?m=T1#chat/main")).toEqual({ ts: "T1", url: "/#chat/main" });
	});
	test("?n alone is left for the decision sheet", () => {
		expect(start("http://h/?n=abc")).toEqual({ ts: "", url: "unchanged" });
	});
	test("?m and ?n together: n stays in the address, no jump to the conversation", () => {
		expect(start("http://h/?m=T1&n=abc#home")).toEqual({ ts: "", url: "/?n=abc#home" });
	});
});
