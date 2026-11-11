import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sseResponse } from "./events.ts";
import { appAsset, indexPage } from "./webapp.ts";

// One status per monitor everywhere (web/js/30-monitoring.js monStatus), the app row's need line (monNeedLine), the 모니터링 nav badge
// (09-needs-you.js paintMonAttn), the monitors failing again and again in 홈 답변 필요 (nyList, this computer's only), a peer item's bot name, and the
// hidden 앱 tab (04-state.js navTabs). Pure rules run on the source text; the screens run headless (Bun.WebView) against a small fake hub.
const web = (f: string) => readFileSync(join(import.meta.dir, "..", "web", "js", f), "utf8");
const monitoring = web("30-monitoring.js");
const between = (src: string, from: string, to: string) => {
	const a = src.indexOf(from), b = src.indexOf(to, a);
	if (a < 0 || b < 0) throw new Error(`markers not found: ${from} .. ${to}`);
	return src.slice(a, b);
};
type Status = { key: string; text: string; tone: string };
const monStatus = new Function(`${between(monitoring, "const MON_PTAG =", "// Wording (one pair)")}; return monStatus;`)() as (m: object, now?: number) => Status;
const monNeedLine = new Function(`${between(monitoring, "function monNeedLine", "// A watch an app owns")}; return monNeedLine;`)() as (n: object, down?: boolean, when?: string) => string;

const NOW = Date.parse("2026-10-27T12:00:00Z"), past = new Date(NOW - 3600_000).toISOString(), soon = new Date(NOW + 600_000).toISOString();
describe("monStatus: connection > paused > fail > late > changed > ok > not run", () => {
	const key = (m: object) => monStatus(m, NOW).key;
	test("a paused monitor is 꺼짐 whatever its last result and its overdue next run", () => {
		expect(monStatus({ paused: true, last_run: past, last_result: "ok", next_run: past }, NOW)).toEqual({ key: "off", text: "꺼짐", tone: "off" });
		expect(key({ paused: true, last_run: past, last_result: "fail" })).toBe("off");
	});
	test("a lost connection wins over paused and fail", () => {
		expect(monStatus({ connection: "disconnected", paused: true, last_result: "fail" }, NOW)).toEqual({ key: "disconnected", text: "연결 끊김", tone: "err" });
	});
	test("fail wins over late; late wins over changed; changed over ok; never run is 확인 필요", () => {
		expect(key({ last_run: past, last_result: "fail", next_run: past })).toBe("fail");
		expect(key({ last_run: past, last_result: "changed", next_run: past })).toBe("late");
		expect(key({ last_run: past, last_result: "changed", next_run: soon })).toBe("changed");
		expect(key({ last_run: past, last_result: "ok", next_run: soon })).toBe("ok");
		expect(monStatus({ next_run: soon }, NOW)).toEqual({ key: "need", text: "확인 필요", tone: "warn" });
	});
});

describe("monNeedLine: sent today only; drafts, 미답장 and 안 읽음 are the row's own counts", () => {
	test("drafts, 미답장 and 안 읽음 are not said again on the line", () => {
		expect(monNeedLine({ drafts: 1, unreplied: 2, unread: 3, sentToday: 4 })).toBe("오늘 자동 답장 4건 보냄");
		expect(monNeedLine({ drafts: 0, unreplied: 2, unread: 3, sentToday: 4 })).toBe("오늘 자동 답장 4건 보냄");
	});
	test("a row with a count at its right says when the last item came, else nothing", () => {
		expect(monNeedLine({ drafts: 0, unreplied: 0, unread: 3, sentToday: 0 }, false, "14:05")).toBe("마지막 소식 14:05");
		expect(monNeedLine({ drafts: 2, unreplied: 0, unread: 0, sentToday: 0 }, false, "14:05")).toBe("마지막 소식 14:05");
		expect(monNeedLine({ drafts: 0, unreplied: 2, unread: 0, sentToday: 0 })).toBe("");
		expect(monNeedLine({ drafts: 0, unreplied: 0, unread: 3, sentToday: 0 })).toBe("");
	});
	test("확인할 것 없어요 only when connected and every count is 0", () => {
		expect(monNeedLine({ drafts: 0, unreplied: 0, unread: 0, sentToday: 0 })).toBe("확인할 것 없어요");
		expect(monNeedLine({ drafts: 0, unreplied: 0, unread: 0, sentToday: 0 }, true)).toBe("연결 끊김");
		expect(monNeedLine({ drafts: 0, unreplied: 0, unread: 0, sentToday: 1 })).toBe("오늘 자동 답장 1건 보냄");
	});
});

describe("monSettingsApp: a schedule row opens its own settings screen like a watch row", () => {
	const monSettingsApp = new Function("pqApp", `${between(monitoring, "const monSettingsApp", "// A connection that is down")}; return monSettingsApp;`)(() => "peer") as (it: object) => string;
	test("a local schedule is s:<id>, a watch w:<name>", () => {
		expect(monSettingsApp({ key: "m:보고", mon: { kind: "schedule", schedule: "s1", name: "보고" } })).toBe("s:s1");
		expect(monSettingsApp({ key: "m:w", mon: { kind: "watch", watch: "w" } })).toBe("w:w");
	});
	test("a schedule without an id (an older hub) and a peer's schedule get none", () => {
		expect(monSettingsApp({ key: "m:x", mon: { kind: "schedule" } })).toBe("");
		expect(monSettingsApp({ key: "m:x", mon: { kind: "schedule", schedule: "s1" }, pc: { name: "pc", url: "https://pc" } })).toBe("");
	});
});

const json = (v: unknown, status = 200) => Response.json(v, { status });
// The test runner's clock and the page's may differ: past times sit in 2020, future ones in 2099.
const at = (ms: number) => new Date(Date.parse(ms < 0 ? "2020-06-01T00:00:00Z" : "2099-06-01T00:00:00Z") + ms).toISOString();
const MONITORS = [
	{ name: "paused-ok", watch: "paused-ok", kind: "watch", last_run: at(-7200_000), last_result: "ok", paused: true, connection: "connected", fails: 0 },
	{ name: "flaky", watch: "flaky", kind: "watch", last_run: at(-60_000), last_result: "fail", next_run: at(1200_000), connection: "connected", fails: 4, last_summary: "응답 없음" },
	{ name: "late-changed", watch: "late-changed", kind: "watch", last_run: at(-7200_000), last_result: "changed", next_run: at(-600_000), connection: "connected", fails: 0 },
	{ name: "paused-fail", watch: "paused-fail", kind: "watch", last_run: at(-60_000), last_result: "fail", paused: true, connection: "connected", fails: 6 },
];
const zero = { drafts: 0, unread: 0, sentToday: 0, unreplied: 0 };
const ITEMS = [
	{ key: "mail", label: "메일", icon: "mail", conv: ["mail:"], unread: 0, unreplied: 2, notices: [], needs: { ...zero, drafts: 1, unreplied: 2 } },
	{ key: "kakao", label: "카카오톡", icon: "kakao", conv: [], unread: 0, unreplied: 0, notices: [], state: "disconnected", needs: zero },
	{ key: "youtube", label: "유튜브", icon: "youtube", conv: [], unread: 0, unreplied: 0, notices: [], needs: zero },
];
const PEERS = [{
	name: "peer-b", url: "http://peer-b.invalid", online: true, stale: false,
	items: {
		bot: "맥북봇",
		monitors: [{ name: "peer-watch", watch: "peer-watch", kind: "watch", last_run: at(-60_000), last_result: "fail", next_run: at(1200_000), connection: "connected", fails: 3 }],
		notices: [{ id: "p1", kind: "decision", title: "배포할까요?", text: "", ts: at(-30_000), read: false, decision: { state: "open", to: "main", group: 1, options: [{ n: 1, label: "예" }, { n: 2, label: "아니요" }] } },
			{ id: "p2", kind: "alert", tone: "ask", title: "네이버 앱 비밀번호", text: "알려 주세요", ts: at(-20_000), read: false, src: "main", open: "main" }],
		integrations: [{ key: "mail", label: "메일", icon: "mail", conv: ["mail:"], unread: 0, notices: [], needs: { ...zero, drafts: 2 } }],
		conversations: [],
	},
}];
// A draft this computer's store keeps for the owner (GET /api/replies): the one waiting reply the badge counts.
const KAKAO_DRAFT = { kind: "kakao", app: "kakao", code: "K1", chatId: "100", room: "가나다 모임", text: "안녕하세요", parts: ["안녕하세요"], at: Date.parse("2026-10-27T11:00:00Z"), attachmentsNone: true, cannotAttach: [], original: { who: "가나", text: "내일 어때요?" } };
let localReplies: object[] = [KAKAO_DRAFT];
const server = Bun.serve({
	port: 0,
	hostname: "127.0.0.1",
	idleTimeout: 0,
	async fetch(req) {
		const url = new URL(req.url);
		if (url.pathname === "/") return indexPage(req);
		const asset = appAsset(req, url.pathname);
		if (asset) return asset;
		if (url.pathname === "/api/events") return sseResponse(req.headers.get("last-event-id") ?? url.searchParams.get("last"));
		if (url.pathname === "/api/state") return json({ name: "dotz", orchestrator: { status: "idle" }, lanes: [], terminals: {}, channels: { work: [] }, discord: {}, notices_unread: 0 });
		if (url.pathname === "/api/notices") return json({ items: [], unread: 0 });
		if (url.pathname === "/api/monitors") return json({ items: MONITORS });
		if (url.pathname === "/api/replies") return json({ items: localReplies });
		if (url.pathname === "/api/integrations") return json({ items: ITEMS });
		if (url.pathname === "/api/monitoring/peers") return json(PEERS);
		if (url.pathname === "/api/conversations") return json({ items: [] });
		return url.pathname.startsWith("/api/") ? json({}) : new Response("not found", { status: 404 });
	},
});
const views: InstanceType<typeof Bun.WebView>[] = [];
afterAll(() => {
	for (const v of views) v.close();
	server.stop(true);
});
const until = (cond: string, what: string) => `new Promise((res, rej) => { const t0 = Date.now(); const tick = () => { let ok = false; try { ok = (${cond}); } catch {} if (ok) res(true); else if (Date.now() - t0 > 10000) rej(new Error(${JSON.stringify(what)})); else requestAnimationFrame(tick); }; tick(); })`;
const q = async <T>(v: InstanceType<typeof Bun.WebView>, body: string) => JSON.parse((await v.evaluate(`JSON.stringify((() => { ${body} })())`)) as string) as T;
async function open() {
	const v = new Bun.WebView({ width: 1440, height: 1000 });
	views.push(v);
	await v.navigate(`http://127.0.0.1:${server.port}/?light#home`);
	await v.evaluate(until(`NM.loaded && INTG.items.length === 3 && document.querySelectorAll("#home-now [data-mon]").length === 1 && document.querySelectorAll("#home-cards .hc-mon").length`, "home not drawn"));
	return v;
}

describe("screens", () => {
	test("a paused monitor reads 꺼짐 on the home card, the 모니터링 row, its state line and the settings status, never 정상", async () => {
		const v = await open();
		const got = await q<Record<string, unknown>>(v, `const m = NM.items.find(x => x.name === "paused-ok"), it = monItems().find(i => i.key === "m:paused-ok");
			const card = [...document.querySelectorAll("#home-cards .hc-mon")].find(r => r.textContent.includes("paused ok"));
			return { card: card && card.dataset.status, cardText: card && card.textContent, badge: it.badge, state: monState(it), stat: monStatNode(m).textContent, row: asStatRow("w:paused-ok", m).textContent,
				lateBadge: monItems().find(i => i.key === "m:late-changed").badge, lateState: monState(monItems().find(i => i.key === "m:late-changed")) };`);
		expect(got.card).toBe("off");
		expect(got.cardText).toContain("꺼짐");
		expect(got.cardText).not.toContain("정상");
		expect(got.badge).toEqual(["꺼짐", "off"]);
		expect(got.state).toBe("꺼짐");
		expect(got.stat).toContain("꺼짐");
		expect(got.row).toContain("꺼짐");
		expect(got.lateBadge).toEqual(["늦어짐", "warn"]);
		expect(got.lateState).toBe("늦어짐");
	});

	test("app rows leave every count to the row's number (a line without a time is empty) and say 연결 끊김 for a disconnected app; 확인할 것 없어요 only for a connected one with nothing", async () => {
		const v = await open();
		await v.evaluate(`(go("monitoring"), 0)`);
		await v.evaluate(until(`PQ.loaded && monItems().some(i => i.pc)`, "peer rows not merged"));
		const rows = await q<[string, string][]>(v, `return monRows(monItems(), null).filter(r => r.k && /^(i:|p:.*[|]i:)/.test(r.k)).map(r => [r.k, r.hint]);`);
		expect(rows).toEqual([["i:mail", ""], ["i:kakao", "연결 끊김"], ["i:youtube", "확인할 것 없어요"], ["p:http://peer-b.invalid|i:mail", "peer-b에서 돌아요"]]);
	});

	test("the 모니터링 nav badge is the one 답장 대기 number (rqWaiting); failing and disconnected rows are not in it but show as the small dot while it is 0", async () => {
		const v = await open();
		// 1 waiting draft = 1; kakao disconnected + flaky failing are faults (paused and late are not), peer-b's failing watch is not counted
		await v.evaluate(`pqLoad()`);
		await v.evaluate(until(`PQ.loaded && RQ.loaded && document.querySelector("#nav-mon").textContent === "1" && !document.querySelector("#nav-mon").hidden`, "badge not 1"));
		expect(await q<number[]>(v, `return [rqWaiting(), monAttnCount([{ apps: INTG.items, mons: NM.items }])]`)).toEqual([1, 2]);
		expect((await v.evaluate(`document.querySelector('#nav [data-view="monitoring"]').getAttribute("aria-label")`)) as string).toBe("모니터링, 확인할 것 1개");
		// the draft leaves: the number is 0 and the two faults show as the dot titled 확인할 것 2개
		localReplies = [];
		await v.evaluate(`(rqLoad(), 0)`);
		await v.evaluate(until(`(b => b && !b.hidden && b.classList.contains("nub") && b.title === "확인할 것 2개" && b.textContent === "")(document.querySelector("#nav-mon"))`, "dot not 2"));
		await v.evaluate(`(NM.items.find(x => x.name === "flaky").last_result = "ok", monSchedule(), 0)`);
		await v.evaluate(until(`document.querySelector("#nav-mon").title === "확인할 것 1개"`, "dot did not drop to 1"));
		expect((await v.evaluate(`document.querySelector('#nav [data-view="monitoring"]').getAttribute("aria-label")`)) as string).toBe("모니터링, 확인할 것 1개");
	});

	test("with nothing to count, an unread watch report puts the small dot on 모니터링 at the label's bottom-right corner, and reading it clears the dot", async () => {
		const v = await open();
		await v.evaluate(`(RQ.local = [], NM.items.forEach(m => { m.last_result = "ok"; m.connection = "connected"; }), INTG.items.forEach(i => { i.state = "connected"; i.needs = { drafts: 0, unread: 0, unreplied: 0, sentToday: 0 }; }), NT.items.push({ id: "w-news", kind: "watch", read: false, at: new Date().toISOString(), title: "새 소식" }), monSchedule(), 0)`);
		await v.evaluate(until(`(b => b && !b.hidden && b.classList.contains("nub"))(document.querySelector("#nav-mon"))`, "dot not shown"));
		const dotBg = (theme: string) => q<string>(v, `document.documentElement.dataset.theme = "${theme}"; return getComputedStyle(document.querySelector("#nav-mon")).backgroundColor`);
		expect(await dotBg("dark")).toBe("rgb(245, 165, 36)");
		expect(await dotBg("light")).toBe("rgb(49, 130, 246)");
		const g = await q<{ text: string; dotRight: number; dotBottom: number; labelRight: number; labelBottom: number }>(v, `const b = document.querySelector("#nav-mon"), l = b.parentElement.querySelector(".nl").getBoundingClientRect(), d = b.getBoundingClientRect();
			return { text: b.textContent, dotRight: d.right, dotBottom: d.bottom, labelRight: l.right, labelBottom: l.bottom };`);
		expect(g.text).toBe("");
		expect(g.dotRight).toBeGreaterThan(g.labelRight);
		expect(Math.abs(g.dotBottom - g.labelBottom)).toBeLessThanOrEqual(4);
		await v.evaluate(`(NT.items.find(n => n.id === "w-news").read = true, monSchedule(), 0)`);
		await v.evaluate(until(`document.querySelector("#nav-mon").hidden`, "dot did not clear"));
	});

	test("홈 is this computer's only: 답변 필요 lists its monitors failing 3+ times (not a paused one), never another computer's ask, decision or monitor", async () => {
		const v = await open();
		// even with the other computer's snapshot in hand (모니터링 read it), 홈 draws nothing of it
		await v.evaluate(`pqLoad()`);
		await v.evaluate(until(`PQ.loaded && PQ.list.length === 1`, "peer snapshot not read"));
		await v.evaluate(`(renderHome(), 0)`);
		const got = await q<{ mons: [string, string][]; text: string; needs: number }>(v, `const box = document.querySelector("#home-now");
			return { mons: [...box.querySelectorAll("[data-mon]")].map(r => [r.dataset.mon, r.textContent]), text: box.textContent, needs: nyList().length };`);
		const byKey = Object.fromEntries(got.mons);
		expect(Object.keys(byKey)).toEqual(["m:flaky"]);
		expect(byKey["m:flaky"]).toContain("4번 연속 실패했어요");
		expect(byKey["m:flaky"]).toContain("확인 필요");
		expect(got.needs).toBe(1);
		for (const s of ["네이버 앱 비밀번호", "배포할까요?", "peer-b", "peer-watch", "맥북봇"]) expect(got.text).not.toContain(s);
		await v.evaluate(`(document.querySelector('#home-now [data-mon="m:flaky"]').click(), 0)`);
		await v.evaluate(until(`current === "monitoring" && MON.sel === "m:flaky"`, "the row did not open the monitor"));
	});

	test("in 모니터링 a peer item carries that gateway's own bot name: its question reads 맥북봇, never this gateway's bot (dotz)", async () => {
		const v = await open();
		await v.evaluate(`(go("monitoring"), 0)`);
		await v.evaluate(until(`PQ.loaded && monItems().some(i => i.pc)`, "peer rows not merged"));
		const pc = await q<{ name: string; bot: string }>(v, `return monItems().find(i => i.pc).pc;`);
		expect(pc).toMatchObject({ name: "peer-b", bot: "맥북봇" });
		await v.evaluate(`(noticeSheetOpen({ ...PQ.list[0].items.notices[0], pc: monItems().find(i => i.pc).pc }), 0)`);
		await v.evaluate(until(`document.querySelector(".fs-ey")`, "sheet not drawn"));
		const got = await q<{ ey: string; row: string; ask: string }>(v, `const pc = monItems().find(i => i.pc).pc, [dec, ask] = PQ.list[0].items.notices;
			return { ey: document.querySelector(".fs-ey").textContent, row: ntHomeRow({ ...dec, pc }).querySelector(".ha").textContent, ask: ntHomeRow({ ...ask, pc }).querySelector(".ha").textContent };`);
		for (const s of [got.ey, got.row, got.ask]) { expect(s).toContain("맥북봇"); expect(s).not.toContain("dotz"); }
		// an older gateway without `bot` in its snapshot: its machine name, still never this gateway's bot
		expect(await v.evaluate(`pcTargetName("main", pqPcOf({ name: "peer-old", url: "http://old.invalid", items: {} }))`)).toBe("peer-old");
		expect(await v.evaluate(`pcTargetName("main", null)`)).toBe("dotz");
	});

	test("the 감시 소식 row shows the newest unread report, else only the day of the last one, and skips a report of a watch that is gone", async () => {
		const v = await open();
		const got = await q<string[]>(v, `const n = (id, o) => ({ id, kind: "watch", tone: "", open: "alert", src: "alert", ...o, updated: o.ts, at: o.ts });
			const gone = n("w1", { title: "사라진 로그인 유지", text: "98번 연속 실패했어요", watch: "gone-keeper", read: false, ts: new Date().toISOString() });
			const old = n("w2", { title: "예약", text: "보고서를 보냈어요", read: true, ts: "2026-10-26T03:00:00Z" });
			const head = () => monItems().find(i => i.key === "notice").hint, out = [];
			NT.items = [gone, old]; out.push(head());
			NT.items = [gone, old, n("w3", { title: "예약", text: "새 보고서가 있어요", read: false, ts: "2026-10-26T04:00:00Z" })]; out.push(head());
			NT.items = [gone]; out.push(head());
			return out;`);
		expect(got[0]).toBe("마지막 소식 10월 26일");
		expect(got[1]).toBe("새 보고서가 있어요");
		expect(got[2]).toBe("새 감시 소식이 없어요");
		for (const h of got) expect(h).not.toContain("98번");
	});

	test("the 앱 tab is not in the nav until APPS_ON is switched on", async () => {
		const v = await open();
		const got = await q<{ apps: boolean; tabs: string[]; on: string[] }>(v, `const tabs = [...document.querySelectorAll("#nav .ni")].map(b => b.dataset.view), apps = !!document.querySelector('#nav [data-view="apps"]');
			APPS_ON = true; const on = navTabs().map(n => n[0]); APPS_ON = false; return { apps, tabs, on };`);
		expect(got.apps).toBe(false);
		expect(got.tabs).toEqual(["home", "chat", "projects", "monitoring", "settings"]);
		expect(got.on).toContain("apps");
	});
});
