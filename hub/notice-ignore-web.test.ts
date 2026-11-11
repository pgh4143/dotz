import { afterAll, describe, expect, test } from "bun:test";
import { emit } from "./events.ts";
import { ignoreNotice, listNotices, markNoticesRead, type Notice, resolveNotices, unignoreNotice, unreadCount } from "./notices.ts";
import { fakeHub, json, waitFor, type View } from "./test-web.ts";

// The x (무시) on its two surfaces, in a headless browser against the real notice store: the 답변 필요 row on 홈 and the decision sheet's
// header. The 알림 card lists only news, so a question that waits is on 홈 once, in 답변 필요. A second page on the same hub hears the change live (the event stream).
const SNAP = "/tmp/dotz-notice-ignore-test";
const hub = fakeHub({
	api: async (req, url) => {
		if (url.pathname === "/api/state") return json({ name: "dotz", orchestrator: { status: "idle" }, lanes: [], terminals: {}, channels: { work: [] }, discord: {}, notices_unread: unreadCount() });
		if (url.pathname === "/api/notices" && req.method === "GET") return json(listNotices(100));
		if (url.pathname === "/api/notices/read") return json(markNoticesRead(await req.json()));
		const m = /^\/api\/notices\/([^/]+)\/(ignore|unignore)$/.exec(url.pathname);
		if (m && req.method === "POST") {
			const r = (m[2] === "ignore" ? ignoreNotice : unignoreNotice)(m[1]);
			return json(r.body, r.status);
		}
	},
});
const base = `${hub.origin}/`;
const open = async (width: number, height: number): Promise<View> => {
	const v = await hub.view({ width, height });
	await v.navigate(base);
	return v;
};
const stored = () => listNotices(300).items;
const ask = (title: string) => emit("outbox", { ts: new Date().toISOString(), kind: "out", source: "orchestrator", target: "alert", text: `[ask] ${title}\n**1) 예**\n**2) 아니요**` });
const settled = (v: View) => v.evaluate(`Promise.all(document.getAnimations().map(a => a.finished.catch(() => 0))).then(() => true)`);
const rect = (v: View, sel: string) => v.evaluate(`JSON.stringify((() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), left: Math.round(r.left), right: Math.round(r.right) }; })())`).then(s => JSON.parse(s as string) as { w: number; h: number; left: number; right: number } | null);

afterAll(() => hub.stop());

describe("the x (무시) in a headless browser", () => {
	test("at 390px the x sits on the 답변 필요 row and the sheet header, thumb-sized and inside the screen, the 알림 card does not repeat the question; ignoring syncs live and undo brings the question back", async () => {
		// leftovers of other test files: decisions with options are closed only by naming them
		resolveNotices({ ids: stored().filter(n => n.decision?.state === "open").map(n => n.id) });
		markNoticesRead({ all: true });
		ask("엑스 확인용 질문이에요");
		const item = () => stored().find(n => n.kind === "decision" && n.title === "엑스 확인용 질문이에요")! as Notice;
		expect(item().decision!.state).toBe("open");
		const before = unreadCount();

		const phone = await open(390, 844);
		const desk = await open(1280, 800);
		await waitFor(phone, `document.querySelector(".hn .hrx")`);
		await waitFor(desk, `document.querySelector(".hn .hrx")`);

		// surface 1: the 답변 필요 row
		const row = await rect(phone, ".hn .hrx");
		const x1 = await rect(phone, ".hn .hrx .nt-x");
		expect(row && x1).toBeTruthy();
		expect(x1!.w).toBeGreaterThanOrEqual(44);
		expect(x1!.h).toBeGreaterThanOrEqual(44);
		expect(x1!.right).toBeLessThanOrEqual(390);
		expect(await phone.evaluate(`document.documentElement.scrollWidth`)).toBeLessThanOrEqual(390);
		expect(await phone.evaluate(`(() => { const r = document.querySelector(".hn .hrx"); return r.scrollWidth <= r.clientWidth; })()`)).toBe(true);
		await phone.evaluate(`document.querySelector("#home-now").scrollIntoView({ block: "start" })`);
		await settled(phone);

		// the 알림 card is drawn but does not list the waiting question a second time
		await waitFor(phone, `document.querySelector(".hc .hc-none, .hc .hc-list")`);
		expect(await phone.evaluate(`[...document.querySelectorAll(".hc-row")].some(r => r.textContent.includes("엑스 확인용 질문이에요"))`)).toBe(false);
		expect(await phone.evaluate(`document.querySelectorAll(".hc-row .nt-x").length`)).toBe(0);

		// surface 3: the decision sheet header
		await phone.evaluate(`document.querySelector(".hn .hrx .hrx-m").click()`);
		await waitFor(phone, `document.querySelector(".fs-card .fs-ign")`);
		expect(await phone.evaluate(`document.querySelectorAll(".fs-card .fs-ign .ic, .fs-card .fs-ign svg").length`)).toBe(0);   // 무시 is a word; the one ✕ in the head is 닫기
		const x3 = await rect(phone, ".fs-card .fs-ign");
		const sheet = await rect(phone, ".fs-card");
		expect(x3!.h).toBeGreaterThanOrEqual(44);
		expect(x3!.right).toBeLessThanOrEqual(sheet!.right);
		expect(await phone.evaluate(`[...document.querySelectorAll(".fs-hd > *")].every(e => e.getBoundingClientRect().right <= 390)`)).toBe(true);
		expect(await phone.evaluate(`document.documentElement.scrollWidth`)).toBeLessThanOrEqual(390);
		await settled(phone);

		// viewing never cleared it
		expect(item().read).toBe(false);

		// ignore from the sheet: leaves 답변 필요 here and on the other page, the toast offers the undo, the hub keeps it as ignored
		await phone.evaluate(`document.querySelector(".fs-card .fs-ign").click()`);
		await waitFor(phone, `document.querySelector(".snack") && /무시했어요/.test(document.querySelector(".snack").textContent) && !document.querySelector(".fs-card")`);
		await phone.evaluate(`go("home")`);   // the row's tap moved this page to the question's message
		await waitFor(phone, `!document.querySelector(".hn .hrx")`);
		await waitFor(desk, `!document.querySelector(".hn .hrx")`);
		expect(item().decision!.state).toBe("ignored");
		expect(item().ignored).toBeString();
		expect(unreadCount()).toBe(before - 1);
		await settled(phone);

		// undo from the toast
		await phone.evaluate(`document.querySelector(".snack .sa").click()`);
		await waitFor(phone, `document.querySelector(".hn .hrx")`);
		await waitFor(desk, `document.querySelector(".hn .hrx")`);
		expect(item().decision!.state).toBe("open");
		expect(item().read).toBe(false);
		expect(unreadCount()).toBe(before);

		// the x on the home row ignores without opening the sheet
		await phone.evaluate(`document.querySelector(".hn .hrx .nt-x").click()`);
		await waitFor(phone, `!document.querySelector(".hn .hrx") && document.querySelector(".snack")`);
		expect(await phone.evaluate(`!!document.querySelector(".fs-card")`)).toBe(false);
		expect(item().decision!.state).toBe("ignored");
		// its history entry says it was ignored
		await phone.evaluate(`noticeSheetOpen(${JSON.stringify(item().id)})`);
		await waitFor(phone, `document.querySelector(".fs-ey.ign")`);
		expect(await phone.evaluate(`document.querySelector(".fs-ey").textContent`)).toBe("알림 · 무시함");
		await settled(phone);
		await desk.evaluate(`document.querySelectorAll(".snack").forEach(n => n.remove())`);
		await settled(desk);
	}, 60_000);
});
