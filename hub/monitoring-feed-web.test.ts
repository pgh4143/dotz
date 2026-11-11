import { afterAll, expect, test } from "bun:test";
import { now } from "./config.ts";
import { fakeHub, json } from "./test-web.ts";

// The 감시 소식 feed in a headless browser: newest report on top, older going down, at desktop and phone width.
const at = (minutesAgo: number) => new Date(Date.parse(now()) - minutesAgo * 60_000).toISOString();
const report = (id: string, minutesAgo: number, title: string, text: string) => ({ id, ts: at(minutesAgo), updated: at(minutesAgo), at: at(minutesAgo), kind: "watch", tone: "", title, open: "alert", src: "alert", read: true, text });
// Stored out of order on purpose: the page, not the file, decides what is on top.
const NOTICES = [
	report("b", 30, "샘플 가 감시", "샘플 가 감시: 결과가 바뀌었어요\n새로 생겼어요: 둘째"),
	report("c", 90, "샘플 나 감시", "샘플 나 감시: 결과가 바뀌었어요\n새로 생겼어요: 셋째"),
	report("a", 5, "샘플 다 감시", "샘플 다 감시: 결과가 바뀌었어요\n새로 생겼어요: 첫째"),
	// An app's report (the hub stamps `app`) is newest of all but never in the feed.
	{ ...report("z", 1, "샘플 앱 감시", "샘플 앱 감시: 결과가 바뀌었어요"), app: "mail" },
];

const hub = fakeHub({
	stream: "fake",
	api: (_req, url) => {
		if (url.pathname === "/api/notices") return json({ items: NOTICES, unread: 0 });
		if (url.pathname === "/api/monitors") return json({ items: [] });
	},
});
afterAll(() => hub.stop());

for (const width of [390, 1440]) {
	test(`the watch feed lists the newest report on top at ${width}px`, async () => {
		const v = await hub.view({ width, height: 900 });
		await v.navigate(`${hub.origin}/`);
		await v.evaluate(`(localStorage.setItem("dotz-theme", "light"), true)`);
		await v.navigate(`${hub.origin}/?light#monitoring/notice`);
		const got = JSON.parse(
			(await v.evaluate(`new Promise((res, rej) => {
				const t = setTimeout(() => rej(new Error("feed not drawn")), 10000);
				const tick = () => {
					const cards = document.querySelectorAll("#mon-tl > .bm.rc");
					if (cards.length >= 3) { clearTimeout(t); res(JSON.stringify({ src: [...cards].map(c => c.querySelector(".rc-src")?.textContent), top: document.querySelector("#mon-timeline").scrollTop })); }
					else requestAnimationFrame(tick);
				};
				tick();
			})`)) as string,
		) as { src: string[]; top: number };
		expect(got.src).toEqual(["샘플 다 감시", "샘플 가 감시", "샘플 나 감시"]);
		expect(got.top).toBe(0);
	});
}

test("a report's first line that only repeats its title is not repeated under it (row line and opened card)", async () => {
	const v = await hub.view({ width: 390, height: 900 });
	await v.navigate(`${hub.origin}/?light#monitoring/notice`);
	const got = JSON.parse((await v.evaluate(`new Promise((res, rej) => {
		const t = setTimeout(() => rej(new Error("feed not drawn")), 10000);
		const tick = () => {
			if (typeof monLines !== "function") { requestAnimationFrame(tick); return; }
			clearTimeout(t);
			const names = ["샘플 라 감시"], plain = { title: "샘플 라 감시", text: "샘플 라 감시\\n가격이 내렸어요" }, bold = { title: "샘플 라 감시", text: "**샘플 라 감시**\\n가격이 내렸어요" }, only = { title: "샘플 라 감시", text: "샘플 라 감시" };
			const one = monRowNode({ id: "t-one", title: "샘플 라 감시: 확인했어요.", text: "샘플 라 감시: 확인했어요.", tone: "ok", read: true, ts: new Date().toISOString() }, []), two = monRowNode({ id: "t-two", title: "샘플 라 감시", text: "가격이 내렸어요", tone: "ok", read: true, ts: new Date().toISOString() }, []);
			res(JSON.stringify({ plain: monLines(plain, names), bold: monLines(bold, names), sum: monSummary(only, names), card: monStrip(bold.text, names), rows: [one, two].map(r => [r.querySelector(".rc-src").textContent, [...r.querySelectorAll(".fr-sum")].map(x => x.textContent)]),
				taps: [{ text: "가격이 내렸어요" }, { text: "가격이 내렸어요\\n89,000원에서 72,000원\\n배송비는 그대로예요" }, { text: "확인했어요\\n원문\\nHTTP 200" }].flatMap(x => { const n = { id: "t-tap", title: "샘플 라 감시", tone: "ok", read: true, ts: new Date().toISOString(), ...x }; return [monRowNode(n, []), monLogRow(n, [])].map(r => r.getAttribute("role")); }) }));
		};
		tick();
	})`)) as string) as { plain: string[]; bold: string[]; sum: string; card: string; rows: [string, string[]][]; taps: (string | null)[] };
	// a row is a button only when unfolding it shows more than the row says (more than two lines, or the folded original); feed row and log row alike
	expect(got.taps).toEqual([null, null, "button", "button", "button", "button"]);
	expect(got.plain).toEqual(["가격이 내렸어요"]);
	expect(got.bold).toEqual(["가격이 내렸어요"]);
	expect(got.sum).toBe("샘플 라 감시");
	expect(got.card).toBe("가격이 내렸어요");
	// a report that is one sentence is said once: the row has no second line that equals its first
	expect(got.rows).toEqual([["샘플 라 감시: 확인했어요.", []], ["샘플 라 감시", ["가격이 내렸어요"]]]);
});
