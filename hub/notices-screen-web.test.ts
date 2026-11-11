import { afterAll, describe, expect, test } from "bun:test";
import { fakeHub, idleState, json, on, type View } from "./test-web.ts";

// The 알림 screen #notices (web/js/31-notices-screen.js) in a headless browser against a fake hub: three groups of one row shape and no
// conversation look (no date divider, no .bm), the filters, the three meanings of the x, 모두 읽음 that never calls /api/read, no read by scrolling
// past, #chat/alert opening the screen (only a row's way to its source message opens the record conversation), and the way back keeping the filter
// and the place. The hub routes /handled and /undismiss are new (hub/notices.ts is another worker's): this file answers them itself.
type N = { id: string; cls: string; kind: string; tone: string; title: string; text: string; open: string; src: string; at: string; ts: string; updated: string; read: boolean;
	waits?: string; dismissed?: boolean; handled?: string | null; repeats?: { at: string; text: string }[]; app?: string; decision?: unknown };
const iso = (m: number) => new Date(Date.UTC(2026, 10, 3, 0, 0) + m * 60_000).toISOString();
const mk = (id: string, m: number, cls: string, kind: string, tone: string, title: string, o: Partial<N> = {}): N =>
	({ id, cls, kind, tone, title, text: title, open: "alert", src: "alert", at: iso(m), ts: iso(m), updated: iso(m), read: false, ...o });
let notices: N[] = [];
const reset = () => {
	notices = [
		mk("dec", 500, "ask", "decision", "ask", "배포 공지 형태를 정해 주세요", { open: "main", src: "main",
			decision: { options: [{ n: 1, label: "짧게", desc: "", rec: true }, { n: 2, label: "길게", desc: "", rec: false }], to: "main", reply_to: iso(500), group: 1, state: "open" } }),
		mk("fail", 490, "alert", "alert", "fail", "가격 페이지를 확인하지 못했어요", { waits: "fail", handled: null, repeats: [{ at: "2026-07-05T00:00:00.000Z", text: "가격 페이지를 확인하지 못했어요" }] }),
		mk("login", 480, "alert", "alert", "warn", "인스타그램 로그인이 풀렸어요", { waits: "login", handled: null, app: "instagram" }),
		mk("price", 470, "news", "watch", "", "캠핑 의자 가격이 바뀌었어요", { text: "- 캠핑 의자 89,000원 → 72,000원", app: "", repeats: [{ at: iso(300), text: "- 캠핑 의자 92,000원 → 89,000원" }, { at: iso(200), text: "- 캠핑 의자 95,000원 → 92,000원" }] }),
		mk("cmt", 460, "news", "watch", "", "댓글 4개에 답글을 달 수 있어요", { app: "youtube" }),
		mk("res", 450, "result", "result", "done", "주간 보고서 정리를 마쳤어요", { src: "main", open: "main" }),
		mk("log", 445, "log", "watch", "", "가격 페이지: 확인했어요. 바뀐 곳은 없어요."),
		mk("conv", 444, "conv", "message", "", "프로젝트 대화에 새 답이 있어요", { src: "proj:p1", open: "proj:p1" }),
		mk("old", 400, "news", "watch", "", "아침 브리핑이 왔어요", { read: true }),
		...Array.from({ length: 14 }, (_, i) => mk(`a${i}`, 100 + i, "alert", "alert", "", `지난 경고 ${i + 1}번`, { read: true })),
	];
};
reset();
const unread = () => notices.filter(n => !n.dismissed && !n.read && n.cls !== "log" && n.cls !== "conv").length;
let calls: string[] = [];
let bodies: Record<string, unknown> = {};
const waiters = new Set<{ ok: () => boolean; done: () => void }>();
const hubState = (ok: () => boolean) => new Promise<void>(done => { if (ok()) done(); else waiters.add({ ok, done }); });
const settle = () => { for (const w of waiters) if (w.ok()) { waiters.delete(w); w.done(); } };
const has = (c: string) => calls.includes(c);
const live = () => notices.filter(n => !n.dismissed);

const hub = fakeHub({
	slowTimers: true,
	// Marks the end of the boot's own ?n= timer (web/js/30-notices.js), which has no other trace when the id is stale.
	headScript: `(() => { const st = setTimeout; setTimeout = (f, ms, ...a) => st(String(f).includes("noticeOpenId") ? async () => { await f(...a); window.__staleLinkDone = true; } : f, ms, ...a); })();`,
	state: () => idleState({ notices_unread: unread() }),
	api: async (req, url) => {
		const p = url.pathname, key = `${req.method} ${p}`;
		queueMicrotask(settle);
		if (p === "/api/history") return json({ target: url.searchParams.get("target"), events: [] });
		if (p === "/api/activity") return json({ items: [], more: false, history: false });
		if (p === "/api/conversations") return json({ items: [] });
		if (p === "/api/update") return json({ settings: { auto_apply: false } });
		if (p === "/api/notices" && req.method === "GET") return json({ items: live(), unread: unread(), gone: [] });
		if (req.method !== "POST") return undefined;
		const body = (await req.json().catch(() => ({}))) as { ids?: string[] };
		calls.push(key);
		bodies[key] = body;
		queueMicrotask(settle);
		if (p === "/api/read") return json({ ok: true });
		if (p === "/api/notices/read") { for (const n of notices) if (body.ids?.includes(n.id)) n.read = true; return json({ unread: unread() }); }
		const m = /^\/api\/notices\/([^/]+)\/(handled|dismiss|undismiss)$/.exec(p);
		if (!m) return undefined;
		const n = notices.find(x => x.id === m[1]);
		if (!n) return json({ ok: false }, 404);
		if (m[2] === "handled") { n.read = true; n.waits = undefined; n.handled = new Date().toISOString(); }
		else if (m[2] === "dismiss") { n.dismissed = true; n.read = true; }
		else n.dismissed = false;
		return json({ ok: true, item: n, unread: unread() });
	},
});
afterAll(() => hub.stop());

async function open(width: number, hash = "#notices"): Promise<View> {
	reset(); calls = []; bodies = {};
	const v = await hub.view({ width, height: 844 });
	await v.navigate(`${hub.origin}/${hash}`);
	await on(v).waitFor(`typeof NT !== "undefined" && NT.loaded && NT.items.length === ${live().length}`);
	return v;
}
const shown = async (v: View) => { await on(v).waitFor(`current === "notices" && document.querySelector("#v-notices .nsc-r")`); return v; };
const settled = (v: View) => v.evaluate(`Promise.all(document.getAnimations().map(a => a.finished.catch(() => 0))).then(() => true)`);
const ids = (v: View, sel = "#v-notices .nsc-r") => on(v).ev<string[]>(`[...document.querySelectorAll(${JSON.stringify(sel)})].map(r => r.dataset.nid)`);
const click = (v: View, sel: string) => on(v).run(`document.querySelector(${JSON.stringify(sel)}).click()`);

describe("the 알림 screen", () => {
	test("전체 has no conversation look: no .bm, no date divider, three groups of one row shape with the unread count of the list", async () => {
		const v = await shown(await open(390));
		const { ev } = on(v);
		expect(await ev(`document.querySelectorAll("#v-notices .bm").length`)).toBe(0);
		expect(await ev<string[]>(`[...document.querySelectorAll("#v-notices .sec")].map(s => s.textContent)`)).toEqual(["처리할 것", "새 소식", "지난 알림"]);   // no 오늘 / 어제 divider
		expect(await ev<string[][]>(`[...document.querySelectorAll("#v-notices .list[data-g]")].map(l => [l.dataset.g, ...[...l.querySelectorAll(".nsc-r")].map(r => r.dataset.nid)])`)).toEqual([
			["need", "dec", "fail", "login"], ["news", "price", "cmt", "res"], ["past", "old", ...Array.from({ length: 14 }, (_, i) => `a${13 - i}`)]]);   // log and conv are not on the screen
		expect(await ev(`document.querySelectorAll("#v-notices .nsc-m .meta, #v-notices [data-nu]").length`)).toBe(0);   // the unread count is said once, by the tabs
		expect(await ev<string[]>(`[...document.querySelectorAll("#v-notices .nsc-fb")].map(b => b.textContent)`)).toEqual(["전체6", "답변 필요1", "결과1", "새 소식2", "경고2"]);
		// one row shape: the title with its time, the summary with its tag, one cell at the end
		expect(await ev(`[...document.querySelectorAll("#v-notices .nsc-r")].every(r => r.querySelectorAll(".ln").length === 2 && r.querySelector(".ln .hd") && r.querySelector(".ln .t") && r.querySelector(".ln .tag") && r.querySelectorAll(".nsc-x, .nsc-tr, .nsc-fold").length === (r.dataset.nid === "fail" ? 2 : 1))`)).toBe(true);
		expect(await ev<string[]>(`[...document.querySelectorAll("#v-notices .nsc-r")].slice(0, 6).map(r => r.querySelector(".tag").textContent)`)).toEqual(["결정", "실패", "로그인", "가격 변경", "댓글", "작업 완료"]);
		expect(await ev(`document.documentElement.scrollWidth <= innerWidth`)).toBe(true);
	}, 30_000);

	test("a filter only hides rows: 답변 필요, 경고, and back to 전체", async () => {
		const v = await shown(await open(390));
		const { waitFor, ev } = on(v);
		await click(v, '#v-notices .nsc-fb[data-f="ask"]');
		await waitFor(`document.querySelectorAll("#v-notices .nsc-r").length === 1`);
		expect(await ids(v)).toEqual(["dec"]);
		await click(v, '#v-notices .nsc-fb[data-f="alert"]');
		await waitFor(`document.querySelectorAll("#v-notices .nsc-r").length === 16`);
		expect((await ids(v)).slice(0, 2)).toEqual(["fail", "login"]);
		expect(await ev<string[]>(`[...document.querySelectorAll("#v-notices .nsc-fb.on")].map(b => b.dataset.f)`)).toEqual(["alert"]);
		await click(v, '#v-notices .nsc-fb[data-f="all"]');
		await waitFor(`document.querySelectorAll("#v-notices .nsc-r").length === 21`);
		expect(calls).toEqual([]);   // switching a filter reads and writes nothing
	}, 30_000);

	test("the x has three meanings: 처리했어요 on a failure, 읽음으로 표시 on news, 지우기 on a past notice with 되돌리기; a login and a question have › instead", async () => {
		const v = await shown(await open(390));
		const { waitFor, ev } = on(v);
		const cell = (id: string) => ev<string>(`(() => { const r = document.querySelector('#v-notices .nsc-r[data-nid="${id}"]'); const c = r.querySelector(".nsc-x") || r.querySelector(".nsc-tr, .nsc-fold"); return c.className.split(" ").find(k => k.startsWith("nsc-")) + "|" + (c.getAttribute("aria-label") || ""); })()`);
		expect(await cell("dec")).toBe("nsc-tr|");
		expect(await cell("login")).toBe("nsc-tr|");
		expect(await cell("price")).toBe("nsc-fold|반복 알림 펼치기");
		expect(await cell("fail")).toBe("nsc-x|처리했어요");
		expect(await cell("cmt")).toBe("nsc-x|읽음으로 표시");
		expect(await cell("old")).toBe("nsc-x|지우기");

		await click(v, '#v-notices .nsc-r[data-nid="fail"] .nsc-x');
		await hubState(() => has("POST /api/notices/fail/handled"));
		await waitFor(`document.querySelector('#v-notices .list[data-g="past"] .nsc-r[data-nid="fail"]')`);   // it leaves 처리할 것 and stays as a past notice
		await click(v, '#v-notices .nsc-r[data-nid="cmt"] .nsc-x');
		await hubState(() => has("POST /api/notices/read"));
		expect(bodies["POST /api/notices/read"]).toEqual({ ids: ["cmt"] });
		await waitFor(`document.querySelector('#v-notices .list[data-g="past"] .nsc-r[data-nid="cmt"]')`);

		await settled(v);
		await click(v, '#v-notices .nsc-r[data-nid="old"] .nsc-x');
		await hubState(() => has("POST /api/notices/old/dismiss"));
		await waitFor(`!document.querySelector('#v-notices .nsc-r[data-nid="old"]') && document.querySelector(".snack")`);
		expect(await ev(`document.querySelector(".snack").textContent`)).toContain("되돌리기");
		await click(v, ".snack button");
		await hubState(() => has("POST /api/notices/old/undismiss"));
		await waitFor(`document.querySelector('#v-notices .nsc-r[data-nid="old"]')`);
		expect(calls).not.toContain("POST /api/read");
	}, 30_000);

	test("a repeat unfolds with ▾ and does not read; 모두 읽음 reads the visible ones through /api/notices/read only and keeps the question", async () => {
		const v = await shown(await open(390));
		const { waitFor, ev } = on(v);
		await click(v, '#v-notices .nsc-r[data-nid="price"] .nsc-fold');
		await waitFor(`document.querySelectorAll('#v-notices .nsc-r[data-child]').length === 2`);
		expect(await ev(`document.querySelector('#v-notices [data-nid="price"] .nsc-fold').getAttribute("aria-expanded")`)).toBe("true");
		expect(calls).toEqual([]);

		await click(v, '#v-notices [data-k="read-all"]');
		await hubState(() => has("POST /api/notices/read"));
		expect((bodies["POST /api/notices/read"] as { ids: string[] }).ids.slice().sort()).toEqual(["cmt", "fail", "login", "price", "res"]);
		expect(notices.find(n => n.id === "dec")!.read).toBe(false);
		await waitFor(`document.querySelector(".snack") && document.querySelector('#v-notices [data-k="read-all"]').hidden`);
		expect(await ev(`document.querySelector(".snack").textContent`)).toContain("답이 필요한 알림은 그대로 뒀어요");
		expect(calls).toEqual(["POST /api/notices/read"]);   // never /api/read
	}, 30_000);

	test("scrolling rows past does not read them", async () => {
		const v = await shown(await open(390));
		const { run, ev } = on(v);
		expect(await ev(`$("#views").scrollHeight > $("#views").clientHeight * 1.5`)).toBe(true);
		await v.evaluate(`(async () => { const s = $("#views"); for (let y = 0; y <= s.scrollHeight; y += s.clientHeight / 2) { s.scrollTop = y; s.dispatchEvent(new Event("scroll")); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); } return true; })()`);
		await run(`__advance(60000)`);   // every page timer of 1 s or more
		await settled(v);
		expect(calls).toEqual([]);
		expect(await ev(`NT.unread`)).toBe(6);
	}, 30_000);

	test("#chat/alert opens the screen, by address and by go(); only ntGo (a row's way to its source message) opens the record conversation, without a composer", async () => {
		const v = await open(390, "#chat/alert");
		const { waitFor, ev, run } = on(v);
		await waitFor(`current === "notices" && document.querySelector("#v-notices .nsc-r")`);
		expect(await ev(`[location.hash, target]`)).toEqual(["#notices", "main"]);
		await run(`go("home")`);
		await waitFor(`current === "home"`);
		await run(`go("chat", "alert")`);
		await waitFor(`current === "notices"`);
		expect(await ev(`target`)).toBe("main");
		await run(`ntGo("alert")`);
		await waitFor(`current === "chat" && target === "alert"`);
		await waitFor(`document.querySelector("#v-chat").classList.contains("no-composer")`);
		await run(`go("chat", "alert")`);   // a second go() has no pass any more
		await waitFor(`current === "notices"`);
		expect(await ev(`[...document.querySelectorAll(".tchip")].some(c => c.dataset.t === "alert")`)).toBe(false);   // 알림 is not a conversation to pick
	}, 30_000);

	test("a new notice while reading keeps the row in view where it is", async () => {
		const v = await shown(await open(390));
		const { run, ev, waitFor } = on(v);
		const inView = `(() => { const s = $("#views"), top = s.getBoundingClientRect().top, r = [...document.querySelectorAll("#v-notices .nsc-r:not([data-child])")].find(e => e.getBoundingClientRect().bottom > top); return { id: r.dataset.nid, off: r.getBoundingClientRect().top - top }; })()`;
		// Down among the past notices: the new one lands above them.
		await run(`$("#views").scrollTop = $("#views").scrollHeight`);
		await waitFor(`$("#views").scrollTop > 300`);
		const before = await ev<{ id: string; off: number }>(inView);
		notices.unshift(mk("new1", 600, "news", "watch", "", "새 알림이 왔어요"));
		await run(`loadNotices()`);
		await waitFor(`!!document.querySelector('#v-notices .nsc-r[data-nid="new1"]')`);
		await settled(v);
		const after = await ev<{ id: string; off: number }>(inView);
		expect(after.id).toBe(before.id);
		expect(Math.abs(after.off - before.off)).toBeLessThan(2);
	});

	test("a row leads to its source message, and back returns to the same filter and the same place in the list", async () => {
		const v = await shown(await open(390));
		const { waitFor, ev, run } = on(v);
		await click(v, '#v-notices .nsc-fb[data-f="alert"]');
		await waitFor(`document.querySelectorAll("#v-notices .nsc-r").length === 16`);
		await run(`$("#views").scrollTop = 300`);
		await waitFor(`$("#views").scrollTop === 300`);
		await click(v, '#v-notices .nsc-r[data-nid="a3"] .nsc-tx');
		await waitFor(`current === "chat" && target === "alert"`);
		await waitFor(`document.querySelector("#v-chat").classList.contains("no-composer")`);
		await run(`history.back()`);
		await waitFor(`current === "notices" && NSC.f === "alert" && document.querySelectorAll("#v-notices .nsc-r").length === 16`);
		await waitFor(`Math.abs($("#views").scrollTop - 300) <= 2`);
		expect(await ev(`document.querySelector("#v-notices .nsc-fb.on").dataset.f`)).toBe("alert");
		expect(calls).toEqual([]);   // a read notice, a jump and a way back: nothing to write
	}, 30_000);

	test("no back arrow on the screen at any width, the title stays where it was, and a row opened from it keeps its way back", async () => {
		for (const width of [390, 800, 1280]) {
			const v = await open(width, "#settings");
			const spot = () => on(v).ev<{ arrow: boolean; title: [number, number]; fold: number[] }>(`(r => ({ arrow: !$("#back").hidden, title: [r.left, r.top], fold: (b => [b.left, b.top])($("#side-tog").getBoundingClientRect()) }))($("#title").getBoundingClientRect())`);
			await on(v).waitFor(`current === "settings"`);
			const plain = await spot();
			await on(v).run(`go("notices")`);
			await shown(v);
			expect(await spot()).toEqual({ ...plain, arrow: false });   // the spot of a page that has no arrow, the sidebar's chevron unmoved
		}
		const v = await shown(await open(390));
		await click(v, '#v-notices .nsc-r[data-nid="a3"] .nsc-tx');
		await on(v).waitFor(`current === "chat" && !$("#back").hidden`);
		expect(await on(v).ev(`backTarget()`)).toBe("notices");
	}, 30_000);

	test("a page load with a stale ?n= stays on its route, with no toast", async () => {
		const v = await shown(await open(1280, "?n=gone#notices"));
		await on(v).waitFor(`window.__staleLinkDone`);
		await settled(v);
		expect(await on(v).ev(`[current, location.search, document.querySelectorAll(".snack").length]`)).toEqual(["notices", "", 0]);
	}, 30_000);
	test("more than a page of old alerts: 더 보기 is the list's own last line, not a control under it", async () => {
		const v = await shown(await open(390));
		expect(await on(v).ev(`(() => { const old = NT.items.find(n => nscGroup(n) === "past"), out = nscList(Array.from({ length: 51 }, (_, i) => ({ ...old, id: "x" + i }))), last = out.find(n => n.dataset.g === "past").lastElementChild; return last.dataset.k + ":" + last.textContent; })()`)).toBe("more:1개 더 보기");
	});
});
