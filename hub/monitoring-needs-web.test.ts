import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { fakeHub, json } from "./test-web.ts";

// The 앱 rows of the 모니터링 list say what waits on the owner (web/js/30-monitoring.js monNeedLine), never the latest item's title.
// Headless (Bun.WebView) against a small fake hub whose /api/integrations carries the counts (hub/integrations.ts needs). Set NEEDS_SHOTS=<dir> to keep screenshots.
const SHOTS = process.env.NEEDS_SHOTS ?? "";
const now = new Date().toISOString();
const ITEMS = [
	{ key: "mail", label: "메일", icon: "mail", conv: ["mail:"], unread: 5, notices: [], needs: { drafts: 2, unread: 3, sentToday: 4 } },
	{ key: "kakao", label: "카카오톡", icon: "kakao", conv: [], unread: 0, notices: [], needs: { drafts: 0, unread: 0, sentToday: 0 } },
	{ key: "youtube", label: "유튜브", icon: "youtube", conv: [], unread: 2, notices: [], needs: { drafts: 0, unread: 2, sentToday: 0 } },
];
const hub = fakeHub({
	api: (_req, url) => {
		if (url.pathname === "/api/notices") return json({ items: [], unread: 0 });
		if (url.pathname === "/api/monitors") return json({ items: [] });
		if (url.pathname === "/api/integrations") return json({ items: ITEMS });
		if (url.pathname === "/api/conversations") return json({ items: [{ target: "mail:fx-1", unread: 3, last: { ts: now, text: "[광고] 일일 날씨 안내", from: "bot" }, mail: { subject: "[광고] 일일 날씨 안내", from: "Bank <b@example.com>", source: "fx", at: now } }] });
	},
});
afterAll(() => hub.stop());
const until = (cond: string, what: string) => `new Promise((res, rej) => { const t0 = Date.now(); const tick = () => { let ok = false; try { ok = (${cond}); } catch {} if (ok) res(true); else if (Date.now() - t0 > 10000) rej(new Error(${JSON.stringify(what)})); else requestAnimationFrame(tick); }; tick(); })`;

for (const width of [1440, 390]) {
	test(`app rows at ${width}px: the action line and the waiting badge, no item title`, async () => {
		const v = await hub.view({ width, height: 900 });
		await v.navigate(`${hub.origin}/`);
		await v.evaluate(`(localStorage.setItem("dotz-theme", "light"), true)`);
		await v.navigate(`${hub.origin}/?light#monitoring`);
		await v.evaluate(until(`current === "monitoring" && INTG.items.length === 3 && CV.loaded && document.querySelectorAll("#mon-side .cv-row, #mon-list .cv-row").length >= 3`, "rows not drawn"));
		const got = JSON.parse((await v.evaluate(`JSON.stringify(monRows(monItems(), null).filter(r => r.k && r.k.startsWith("i:")).map(r => [r.k, r.hint, r.unread]))`)) as string) as [string, string, number][];
		expect(got.map(([k, , unread]) => [k, unread])).toEqual([["i:mail", 2], ["i:kakao", 0], ["i:youtube", 2]]);
		// the line carries the counts of `needs` other than the row's own unread count (2 drafts, 4 sent for mail), never the latest item's title
		expect(got[0]![1]).toBe("오늘 자동 답장 4건 보냄");
		expect(got.every(([, hint]) => !hint.includes("안 읽음"))).toBe(true);
		expect(got.every(([, hint]) => !hint.includes("날씨"))).toBe(true);   // a line without a time to say is empty, not a repeated count
		expect(await v.evaluate(`document.body.innerText`)).not.toContain("일일 날씨");
		if (SHOTS) {
			mkdirSync(SHOTS, { recursive: true });
			await Bun.write(`${SHOTS}/needs-${width}.png`, await v.screenshot());
		}
	});
}
