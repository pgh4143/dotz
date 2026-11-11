import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { ev, fakeHub, json, run, waitFor, type View } from "./test-web.ts";

// The mail app of web/js/30-mailboxes.js in a headless browser against a fake hub: one app row for every account, the pane and its counts, the box filter,
// boxes of one name merged in 모든 계정, moving with undo, and a live update that keeps the row nodes.
const CAN = ["read", "unread", "archive", "unarchive", "trash", "star", "unstar"];
const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
type Mail = { key: string; subject: string; from: string; box: string; read: boolean; at: string };
const box = (id: string, name: string, base = false) => ({ id, name, icon: "mail", notify: true, ...(base ? { base: true } : { mode: "ask" }) });
const BOXES: Record<string, ReturnType<typeof box>[]> = {
	mail: [box("base", "일반", true), box("b-score", "문서 요청"), box("b-pay", "결제")],
	"mail-2": [box("base", "일반", true), box("b-score2", "문서 요청"), box("b-work", "업무")],
};
const fresh = (): Mail[] => [
	{ key: "p-1", subject: "동아리 문서 부탁드려요", from: "Kim <kim@example.com>", box: "b-score", read: false, at: ago(1) },
	{ key: "p-2", subject: "수요일 회의 일정 변경", from: "Lee <lee@example.com>", box: "base", read: true, at: ago(2) },
	{ key: "p-3", subject: "결제가 완료됐어요", from: "Shop <shop@example.com>", box: "b-pay", read: false, at: ago(3) },
	{ key: "p-4", subject: "요약 문서 구해요", from: "Park <park@example.com>", box: "b-score", read: true, at: ago(4) },
	{ key: "w-1", subject: "연말 공연 문서", from: "Choi <choi@work.example.com>", box: "b-score2", read: false, at: ago(5) },
	{ key: "w-2", subject: "정산 서류 안내", from: "Han <han@work.example.com>", box: "base", read: true, at: ago(6) },
	{ key: "w-3", subject: "업무 보고 요청", from: "Oh <oh@work.example.com>", box: "b-work", read: false, at: ago(7) },
];
let mails: Mail[] = fresh();
let accounts = 2;
let down = false;
let moveFails = false;
let posts: { path: string; body: any }[] = [];

const card = (m: Mail) => ({ subject: m.subject, from: m.from, source: "acme", at: m.at, summary: "요약이에요", read: m.read, archived: false, starred: false, can: CAN, box: m.box });
const mine = (inst: string) => mails.filter(m => (inst === "mail" ? !m.key.startsWith("w-") : m.key.startsWith("w-")));
const item = (inst: string) => ({ key: inst, app: "mail", label: inst === "mail" ? "개인 메일" : "회사 메일", icon: "mail", kind: "app", conv: inst === "mail" ? ["mail:"] : ["mail:w-"], ...(inst === "mail" ? { convNot: ["mail:w-"] } : {}),
	state: inst === "mail-2" && down ? "disconnected" : "connected", notices: [], unread: mine(inst).filter(m => !m.read).length, needs: { drafts: 0, unread: mine(inst).filter(m => !m.read).length, sentToday: 0, unreplied: 0 },
	boxes: BOXES[inst], account: inst === "mail" ? "me@example.com" : "me@work.example.com" });

const hub = fakeHub({
	api: async (req, url) => {
		const p = url.pathname;
		if (p === "/api/notices") return json({ items: [], unread: 0 });
		if (p === "/api/integrations") return json({ items: accounts === 1 ? [item("mail")] : [item("mail"), item("mail-2")], available: [] });
		if (p === "/api/conversations") return json({ items: (accounts === 1 ? mine("mail") : mails).map(m => ({ target: `mail:${m.key}`, unread: m.read ? 0 : 1, read: null, mail: card(m), last: { ts: m.at, text: m.subject, from: "bot" } })) });
		if ((p === "/api/mailbox/move" || p === "/api/mailbox/learn") && req.method === "POST") {
			const body = (await req.json()) as any; posts.push({ path: p, body });
			if (p === "/api/mailbox/learn") return json({ ok: true, added: true });
			if (moveFails) return json({ error: "옮기지 못했어요" }, 500);
			const was: Record<string, string> = {};
			for (const m of mails) if (body.keys.includes(m.key)) { was[m.key] = m.box; m.box = body.box; }
			return json({ ok: true, moved: Object.keys(was), was });
		}
		return undefined;
	},
});
afterAll(() => hub.stop());
beforeEach(() => { mails = fresh(); accounts = 2; down = false; moveFails = false; posts = []; });

const waitForPosts = async (n: number) => { const t0 = Date.now(); while (posts.length < n) { if (Date.now() - t0 > 8000) throw new Error(`timeout: ${posts.length}/${n} posts`); await new Promise(r => setImmediate(r)); } };
const rowJs = (key: string) => `document.querySelector('#mon-tl > .mr[data-t="mail:${key}"]')`;
const rowKeys = (v: View) => ev<string[]>(v, `[...document.querySelectorAll("#mon-tl > .mr")].map(r => r.dataset.t.slice(5)).sort()`);
const pane = (v: View) => ev<[string, string][]>(v, `[...document.querySelectorAll("#mx-pane .mx-pr")].map(r => [r.querySelector(".hd").firstChild.textContent, r.querySelector(".mx-pn span:last-child").textContent])`);
const goBox = async (v: View, name: string, key: string) => {
	await run(v, `[...document.querySelectorAll("#mx-pane .mx-pr")].find(r => r.querySelector(".hd").firstChild.textContent === ${JSON.stringify(name)}).click()`);
	await waitFor(v, `MX.box === ${JSON.stringify(key)}`);
};
async function open(width = 1280, path = "/"): Promise<View> {
	const v = await hub.view({ width, height: 900 });
	await v.navigate(`${hub.origin}${path}`);
	await waitFor(v, `NT.loaded && INTG.items.length === ${accounts} && CONV.has("mail:p-1")`);
	if (path === "/") {
		await run(v, `MON.mailFilter = "all"; MON.land = "i:mail"; go("monitoring")`);
		await waitFor(v, `document.querySelector('#mon-side .cv-row[data-k="i:mail"]')`);
		await run(v, `document.querySelector('#mon-side .cv-row[data-k="i:mail"]').click()`);
	}
	await waitFor(v, `document.querySelector("#mon-tl > .mr") && document.querySelector("#mx-pane .mx-pr")`);
	return v;
}

describe("one account", () => {
	test("no account chip, no marks, and the list is the plain one with the pane of its boxes", async () => {
		accounts = 1;
		const v = await open();
		expect(await ev<number>(v, `document.querySelectorAll("#appbar .mx-acc").length`)).toBe(0);
		expect(await ev<number>(v, `document.querySelectorAll(".mx-am").length`)).toBe(0);
		expect(await ev<number>(v, `INTG.items.length`)).toBe(1);
		expect(await rowKeys(v)).toEqual(["p-1", "p-2", "p-3", "p-4"]);
		expect(await pane(v)).toEqual([["전체", "4"], ["문서 요청", "2"], ["결제", "1"], ["일반", "1"]]);
		expect(await ev<boolean>(v, `MX.accts.size === 1 && !MX.mark`)).toBe(true);
	}, 30_000);
});

describe("two accounts", () => {
	test("both are one app row, `i:mail`, whose mails and counts are added; every instance maps to it", async () => {
		const v = await open();
		expect(await ev<any>(v, `(() => { const apps = monItems().filter(i => i.app), it = apps[0]; return { n: apps.length, key: it.key, accts: it.accounts.map(a => a.key), mails: it.mails.length, unread: it.unread, inst: it.inst, rows: document.querySelectorAll('#mon-side .cv-row[data-k^="i:mail"]').length }; })()`))
			.toEqual({ n: 1, key: "i:mail", accts: ["mail", "mail-2"], mails: 7, unread: 4, inst: "mail", rows: 1 });
		expect(await ev<string[]>(v, `[monItemOf("mail:p-1"), monItemOf("mail:w-1")]`)).toEqual(["i:mail", "i:mail"]);
		expect(await ev<number>(v, `document.querySelectorAll("#appbar .mx-acc").length`)).toBe(1);
		expect(await rowKeys(v)).toEqual(["p-1", "p-2", "p-3", "p-4", "w-1", "w-2", "w-3"]);
		expect(await ev<boolean>(v, `[...document.querySelectorAll("#mon-tl > .mr")].every(r => r.querySelector(".mx-am") && r.querySelector(".mx-bt"))`)).toBe(true);
	}, 30_000);

	test("picking a box filters the rows and the count; the address follows and a reload opens the same box", async () => {
		const v = await open();
		await goBox(v, "결제", "b-pay");
		await waitFor(v, `document.querySelectorAll("#mon-tl > .mr").length === 1`);
		expect(await rowKeys(v)).toEqual(["p-3"]);
		expect(await ev<string>(v, `decodeURIComponent(location.hash)`)).toBe("#monitoring/i:mail/all/b-pay");
		expect(await ev<string>(v, `document.querySelector("#mon-tl .mbox-n").textContent`)).toContain("1");
		const again = await open(1280, "/#monitoring/i%3Amail/mail-2/b-work");
		await waitFor(again, `document.querySelectorAll("#mon-tl > .mr").length === 1`);
		expect(await rowKeys(again)).toEqual(["w-3"]);
		expect(await ev<string>(again, `MX.acct + "|" + MX.box`)).toBe("mail-2|b-work");
		expect(await ev<number>(again, `document.querySelectorAll("#mon-tl > .mr .mx-bt").length`)).toBe(0);
	}, 40_000);

	test("boxes of the same name in two accounts are one entry with the counts added", async () => {
		const v = await open();
		expect(await pane(v)).toEqual([["전체", "7"], ["결제", "1"], ["업무", "1"], ["문서 요청", "3"], ["일반", "2"]]);
		await goBox(v, "문서 요청", "n:문서 요청");
		await waitFor(v, `document.querySelectorAll("#mon-tl > .mr").length === 3`);
		expect(await rowKeys(v)).toEqual(["p-1", "p-4", "w-1"]);
		expect(await ev<number>(v, `document.querySelectorAll("#mon-tl > .mr .mx-am").length`)).toBe(3);
		expect(await ev<number>(v, `document.querySelectorAll("#mon-tl > .mr .mx-bt").length`)).toBe(0);
	}, 30_000);

	test("an account whose login is gone shows a way to connect again above the list", async () => {
		down = true;
		const v = await open();
		expect(await ev<string[]>(v, `[...document.querySelectorAll("#mon-tl > .mx-exp")].map(e => e.dataset.acct)`)).toEqual(["mail-2"]);
		await run(v, `MX.acct = "mail"; MX.box = "all"; mxSync()`);
		await waitFor(v, `!document.querySelector("#mon-tl > .mx-exp")`);
	}, 30_000);

	test("the account chip lists every account and picking one narrows the list to it", async () => {
		const v = await open();
		await run(v, `document.querySelector("#appbar .mx-acc").click()`);
		await waitFor(v, `document.querySelectorAll(".menu .mi").length === 4`);
		await run(v, `document.querySelectorAll(".menu .mi")[2].click()`);
		await waitFor(v, `MX.acct === "mail-2"`);
		await waitFor(v, `document.querySelectorAll("#mon-tl > .mr").length === 3`);
		expect(await rowKeys(v)).toEqual(["w-1", "w-2", "w-3"]);
		expect(await pane(v)).toEqual([["전체", "3"], ["문서 요청", "1"], ["업무", "1"], ["일반", "1"]]);
	}, 30_000);
});

describe("moving", () => {
	const pickBox = (v: View, name: string) => run(v, `[...document.querySelectorAll(".menu .mi")].find(b => b.querySelector(".ml").firstChild.textContent === ${JSON.stringify(name)}).click()`);
	// 옮기기 is an item of the bar's ⋯ menu; picking it opens the boxes menu
	const moveSel = async (v: View) => {
		await waitFor(v, `document.querySelector('#mbox-bar [data-k="mail-more"]')`);
		await run(v, `document.querySelector('#mbox-bar [data-k="mail-more"]').click()`);
		await waitFor(v, `document.querySelector(".menu .mi")`);
		await pickBox(v, "메일함 옮기기");
		await waitFor(v, `document.querySelector(".menu")`);
	};
	const openMove = async (v: View, key: string) => { await run(v, `${rowJs(key)}.querySelector('[data-k="mail-move"]').click()`); await waitFor(v, `document.querySelector(".menu")`); };

	test("the row button offers this account's other boxes, posts the move, shows the small box, and 되돌리기 restores it", async () => {
		const v = await open();
		await openMove(v, "p-2");
		expect(await ev<string[]>(v, `[...document.querySelectorAll(".menu .mi .ml")].map(b => b.firstChild.textContent)`)).toEqual(["문서 요청", "결제"]);
		await pickBox(v, "문서 요청");
		await waitForPosts(1);
		expect(posts[0]).toEqual({ path: "/api/mailbox/move", body: { keys: ["p-2"], box: "b-score" } });
		await waitFor(v, `MAILS.get("mail:p-2").box === "b-score" && document.querySelector(".mx-teach")`);
		await run(v, `document.querySelector('.mx-teach [data-k="undo"]').click()`);
		await waitForPosts(2);
		expect(posts[1]).toEqual({ path: "/api/mailbox/move", body: { keys: ["p-2"], box: "base" } });
		await waitFor(v, `MAILS.get("mail:p-2").box === "base" && !document.querySelector(".mx-teach")`);
		expect(posts.filter(p => p.path === "/api/mailbox/learn")).toEqual([]);
	}, 30_000);

	test("a refused move puts the mail back and teaches nothing", async () => {
		moveFails = true;
		const v = await open();
		await openMove(v, "p-2");
		await pickBox(v, "결제");
		await waitForPosts(1);
		await waitFor(v, `MAILS.get("mail:p-2").box === "base" && document.querySelector(".snack.bad")`);
		expect(await ev<boolean>(v, `!document.querySelector(".mx-teach")`)).toBe(true);
		expect(posts.filter(p => p.path === "/api/mailbox/learn")).toEqual([]);
	}, 30_000);

	test("picking one of the small box's choices posts it to learn, with the sender and the keyword", async () => {
		const v = await open();
		await openMove(v, "p-2");
		await pickBox(v, "결제");
		await waitFor(v, `document.querySelector(".mx-teach")`);
		expect(await ev<string[]>(v, `[...document.querySelectorAll(".mx-to button")].map(b => b.dataset.k)`)).toEqual(["only", "from", "subj"]);
		expect(await ev<string>(v, `MX.teach.kw`)).toBe("수요일");
		await run(v, `document.querySelector('.mx-to [data-k="from"]').click()`);
		await waitForPosts(2);
		expect(posts[1]).toEqual({ path: "/api/mailbox/learn", body: { box: "b-pay", kind: "from", value: "lee@example.com" } });
	}, 30_000);

	test("a selection of mails from two accounts has no box to move to", async () => {
		const v = await open();
		await run(v, `${rowJs("p-2")}.querySelector(".mr-chk").click(); ${rowJs("w-2")}.querySelector(".mr-chk").click()`);
		await moveSel(v);
		await waitFor(v, `document.querySelector(".menu")`);
		expect(await ev<number>(v, `document.querySelectorAll(".menu .mi").length`)).toBe(0);
		expect(posts).toEqual([]);
	}, 30_000);

	test("the selection bar moves a selection of one account in one post", async () => {
		const v = await open();
		await run(v, `${rowJs("p-1")}.querySelector(".mr-chk").click(); ${rowJs("p-2")}.querySelector(".mr-chk").click()`);
		await moveSel(v);
		await waitFor(v, `document.querySelector(".menu .mi")`);
		await pickBox(v, "결제");
		await waitForPosts(1);
		expect(posts[0].body.box).toBe("b-pay");
		expect([...posts[0].body.keys].sort()).toEqual(["p-1", "p-2"]);
	}, 30_000);
});

describe("on a phone", () => {
	test("the account chip's menu opens below the app bar, inside the screen, and the title keeps its room", async () => {
		const v = await hub.view({ width: 390, height: 844 });
		await v.navigate(`${hub.origin}/`);
		await waitFor(v, `NT.loaded && INTG.items.length === 2 && CONV.has("mail:p-1")`);
		await run(v, `MON.mailFilter = "all"; MON.land = "i:mail"; go("monitoring", "i:mail")`);
		await waitFor(v, `document.querySelector("#appbar .mx-acc") && document.querySelector("#mon-tl > .mr")`);
		const bar = await ev<{ title: number; chip: number; bar: number }>(v, `({ title: $("#title").getBoundingClientRect().width, chip: document.querySelector("#appbar .mx-acc").getBoundingClientRect().width, bar: $("#appbar").getBoundingClientRect().width })`);
		expect(bar.title).toBeGreaterThanOrEqual(88);
		await run(v, `document.querySelector("#appbar .mx-acc").click()`);
		await waitFor(v, `document.querySelector(".menu.msheet .mi")`);
		const r = await ev<{ top: number; bottom: number; chipBottom: number; h: number }>(v, `(() => { const m = document.querySelector(".menu.msheet").getBoundingClientRect(); return { top: m.top, bottom: m.bottom, chipBottom: document.querySelector("#appbar .mx-acc").getBoundingClientRect().bottom, h: innerHeight }; })()`);
		expect(r.top).toBeGreaterThanOrEqual(r.chipBottom);
		expect(r.bottom).toBeLessThanOrEqual(r.h);
	}, 30_000);
});

describe("a live update", () => {
	test("keeps the row nodes and adds only the new row", async () => {
		const v = await open();
		await run(v, `window.__keep = [...document.querySelectorAll("#mon-tl > .mr")]; window.__added = 0; new MutationObserver(rs => { for (const r of rs) for (const n of r.addedNodes) if (n.matches && n.matches(".mr")) window.__added++; }).observe($("#mon-tl"), { childList: true })`);
		mails.push({ key: "p-9", subject: "새로 온 메일", from: "New <new@example.com>", box: "base", read: false, at: ago(0) });
		await run(v, `convLoad()`);
		await waitFor(v, `CONV.has("mail:p-9") && document.querySelector('#mon-tl > .mr[data-t="mail:p-9"]')`);
		expect(await ev<boolean>(v, `__keep.every(n => n.isConnected)`)).toBe(true);
		expect(await ev<number>(v, `__added`)).toBe(1);
		expect(await rowKeys(v)).toContain("p-9");
	}, 30_000);
});
