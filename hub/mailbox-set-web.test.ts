import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { ev, fakeHub, json, run, waitFor, type View } from "./test-web.ts";

// The two screens of web/js/30-mailboxes-set.js in a headless browser against a fake hub: 메일함 설정 and 메일함 추가 drawn in the mail app's view,
// reached by their address, saving through PUT /api/mailbox/box, deleting, and creating a box from a suggestion.
const CAN = ["read", "unread", "archive", "unarchive", "trash", "star", "unstar"];
const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const full = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, name, icon: "mail", notify: true, conds: { from: [], subj: [], body: [], src: [] }, not: { from: [] }, judge: { on: false, text: "" }, how: "", greets: [], folders: [], bans: [], rules: [], ...extra });
const brief = () => full("b-score", "문서 요청", { mode: "ask", conds: { from: ["@team.example.org"], subj: ["문서"], body: [], src: ["mail-orders"] }, not: { from: ["spam@team.example.org"] }, how: "짧게 답해요", greets: [{ who: "김", addr: "kim@example.com", hello: "안녕하세요" }], folders: ["~/문서"], bans: ["죄송"], judge: { on: true, text: "문서를 달라는 메일" }, alone: true, rules: [{ when: "문서", how: "파일을 붙여요" }] });
const fresh = () => ({
	mail: [{ ...full("base", "일반"), base: true }, brief(), full("b-pay", "결제", { mode: "quiet", notify: false })],
	"mail-2": [{ ...full("base", "일반"), base: true }, full("b-score2", "문서 요청", { mode: "ask" })],
});
type Posts = { method: string; path: string; body: any };
const mails = [
	{ key: "p-1", subject: "동아리 문서 부탁드려요", from: "Kim <kim@team.example.org>", box: "b-score", at: ago(1) },
	{ key: "p-2", subject: "수요일 회의 일정 변경", from: "Lee <lee@example.com>", box: "base", at: ago(2) },
	{ key: "p-3", subject: "결제가 완료됐어요", from: "Shop <shop@example.com>", box: "b-pay", at: ago(3) },
	{ key: "w-1", subject: "연말 공연 문서", from: "Choi <choi@work.example.com>", box: "b-score2", at: ago(5) },
];
let boxes = fresh();
let posts: Posts[] = [];
let waiters: { n: number; ok: () => void }[] = [];
let putFails = false;
const groups = [{ domain: "@team.example.org", label: "team", count: 12, senders: ["Kim"], keys: ["p-1", "p-4"] }];

const record = (p: Posts) => { posts.push(p); for (const w of waiters.filter(x => posts.length >= x.n)) { waiters.splice(waiters.indexOf(w), 1); w.ok(); } };
const waitForPosts = (n: number) => (posts.length >= n ? Promise.resolve() : new Promise<void>((ok, bad) => {
	waiters.push({ n, ok });
	AbortSignal.timeout(8000).addEventListener("abort", () => bad(new Error(`timeout: ${posts.length}/${n} posts`)));
}));
const item = (inst: string) => ({ key: inst, app: "mail", label: inst === "mail" ? "개인 메일" : "회사 메일", icon: "mail", kind: "app", conv: inst === "mail" ? ["mail:"] : ["mail:w-"], ...(inst === "mail" ? { convNot: ["mail:w-"] } : {}),
	state: "connected", notices: [], unread: 0, needs: { drafts: 0, unread: 0, sentToday: 0, unreplied: 0 }, boxes: boxes[inst as "mail"], account: inst === "mail" ? "me@example.com" : "me@work.example.com" });
const card = (m: (typeof mails)[number]) => ({ subject: m.subject, from: m.from, source: "acme", at: m.at, summary: "요약이에요", read: true, archived: false, starred: false, can: CAN, box: m.box });

const voices: Record<string, object> = {};
const hub = fakeHub({
	api: async (req, url) => {
		const p = url.pathname;
		if (p === "/api/notices") return json({ items: [], unread: 0 });
		if (p === "/api/integrations") return json({ items: [item("mail"), item("mail-2")], available: [] });
		if (p === "/api/conversations") return json({ items: mails.map(m => ({ target: `mail:${m.key}`, unread: 0, read: null, mail: card(m), last: { ts: m.at, text: m.subject, from: "bot" } })) });
		if (p === "/api/mailbox/tone") return json({ ok: true, own: true, summary: "정중하고 짧게 써요", corrections: ["더 짧게", "호칭을 빼요", "끝인사를 줄여요"], voice: voices[url.searchParams.get("box") ?? ""] ?? { state: "single", count: 0, need: 20 } });
		if (p === "/api/mailbox/examples") return json({ ok: true, examples: [{ received: "자료 부탁해요", reply: "삼가 회신드립니다" }] });
		if (p === "/api/mailbox/relearn") {
			record({ method: req.method, path: p, body: await req.json() });
			voices["b-score"] = { state: "own", count: 64, need: 20, texts: 64 };
			return json({ ok: true, result: "learned" });
		}
		if (p === "/api/mailbox/suggest") return json({ ok: true, groups });
		if (p === "/api/mailbox/box" || p === "/api/mailbox/move") {
			const body = (await req.json()) as any;
			record({ method: req.method, path: p, body });
			if (p === "/api/mailbox/move") return json({ ok: true, moved: body.keys, was: {} });
			if (req.method === "PUT") {
				if (putFails) return json({ error: "저장하지 못했어요" }, 500);
				const box = { ...full(body.box.id || "b-new1", body.box.name), ...body.box, id: body.box.id || "b-new1" }, list = boxes[body.app as "mail"], at = list.findIndex(b => b.id === box.id);
				if (at >= 0) list[at] = box; else list.push(box);
				return json({ ok: true, box });
			}
			boxes[body.app as "mail"] = boxes[body.app as "mail"].filter(b => b.id !== body.id);
			return json({ ok: true });
		}
		return undefined;
	},
});
afterAll(() => hub.stop());
beforeEach(() => { boxes = fresh(); posts = []; waiters = []; putFails = false; });

async function open(path: string, width = 1280): Promise<View> {
	const v = await hub.view({ width, height: 900 });
	await v.navigate(`${hub.origin}${path}`);
	await waitFor(v, `NT.loaded && INTG.items.length === 2 && CONV.has("mail:p-1") && document.querySelector("#mon-tl > .mxs")`);
	return v;
}
const SET = "/#monitoring/i%3Amail/mail/b-score/set";
const live = (id: string) => `MX.accts.get("mail").byId.get(${JSON.stringify(id)})`;
const click = (v: View, selector: string) => run(v, `document.querySelector(${JSON.stringify(selector)}).click()`);
const openItem = async (v: View, k: string) => { await click(v, `.mxs-ah[data-k="${k}"]`); await waitFor(v, `document.querySelector('.mxs-ac.open .mxs-ah[data-k="${k}"]')`); };

describe("메일함 설정", () => {
	test("opening it from the address shows the box's own values, and the list is not drawn", async () => {
		const v = await open(SET);
		expect(await ev<any>(v, `({ scr: MX.scr, acct: MX.acct, box: MX.box, rows: document.querySelectorAll("#mon-tl > .mr").length, mode: document.querySelector(".mxs-mode.on").dataset.m, items: [...document.querySelectorAll(".mxs-ah")].map(b => b.dataset.k) })`))
			.toEqual({ scr: "set", acct: "mail", box: "b-score", rows: 0, mode: "ask", items: ["name", "match", "judge", "tone", "how", "greet", "files", "bans"] });
		// the chosen 처리 방식 is the one with the check at its right; the others have none
		expect(await ev<any>(v, `({ on: document.querySelectorAll(".mxs-mode.on .mxs-mt .ic").length, off: document.querySelectorAll(".mxs-mode:not(.on) .ic").length })`)).toEqual({ on: 1, off: 0 });
		await openItem(v, "how");
		expect(await ev<string>(v, `document.querySelector(".mxs-ab textarea").value`)).toBe("짧게 답해요");
		await openItem(v, "match");
		expect(await ev<any>(v, `({ chips: [...document.querySelectorAll(".mxs-ab .mxs-c .tx")].map(x => x.textContent), open: document.querySelectorAll(".mxs-ac.open").length })`))
			.toEqual({ chips: ["@team.example.org", "문서", "spam@team.example.org"], open: 1 });
		await openItem(v, "judge");
		expect(await ev<string>(v, `document.querySelector(".mxs-ab input").value`)).toBe("문서를 달라는 메일");
		await openItem(v, "greet");
		expect(await ev<string[]>(v, `[...document.querySelectorAll(".mxs-g input")].map(i => i.value)`)).toEqual(["김", "kim@example.com", "안녕하세요"]);
		await openItem(v, "files");
		expect(await ev<string[]>(v, `[...document.querySelectorAll(".mxs-ab .mxs-c .tx")].map(x => x.textContent)`)).toEqual(["~/문서"]);
		await openItem(v, "bans");
		expect(await ev<string[]>(v, `[...document.querySelectorAll(".mxs-ab .mxs-c .tx")].map(x => x.textContent)`)).toEqual(["죄송"]);
	}, 40_000);

	test("the tone item reads the tone route only when it opens, and shows the first corrections", async () => {
		const v = await open(SET);
		await openItem(v, "tone");
		await waitFor(v, `document.querySelector(".mxs-sum")`);
		expect(await ev<any>(v, `({ summary: document.querySelector(".mxs-sum").textContent, fixes: [...document.querySelectorAll(".mxs-fx li")].map(l => l.textContent) })`))
			.toEqual({ summary: "정중하고 짧게 써요", fixes: ["더 짧게", "호칭을 빼요"] });
		expect(await ev<number>(v, `document.querySelectorAll(".mxs-vl").length`)).toBe(0);
	}, 30_000);

	test("a mailbox on the account's voice says so, 다시 배우기 updates it, and 예시 보기 shows his own reply", async () => {
		voices["b-score"] = { state: "few", count: 7, need: 20 };
		const v = await open(SET);
		await openItem(v, "tone");
		await waitFor(v, `document.querySelector(".mxs-rowb")`);
		expect(await ev<string>(v, `document.querySelector(".mxs-rowb .mxs-h").textContent`)).toContain("계정 말투");
		await click(v, ".mxs-vl");
		await waitFor(v, `document.querySelector(".mxs-rowb .mxs-h").textContent.includes("64개")`);
		await click(v, ".mxs-vx");
		await waitFor(v, `document.querySelector(".mxs-ex")`);
		expect(await ev<string>(v, `document.querySelector(".mxs-ex .mxs-sum").textContent`)).toBe("삼가 회신드립니다");
		delete voices["b-score"];
	}, 30_000);

	test("a change saves the whole box (the `alone` flag and the source conditions stay), and 뒤로 returns to the box list", async () => {
		const v = await open(SET);
		await click(v, '.mxs-mode[data-m="auto"]');
		await waitForPosts(1);
		expect(posts[0]).toMatchObject({ method: "PUT", path: "/api/mailbox/box", body: { app: "mail", box: { id: "b-score", mode: "auto", alone: true, conds: { src: ["mail-orders"], from: ["@team.example.org"] }, rules: [{ when: "문서" }], how: "짧게 답해요" } } });
		expect(await ev<string>(v, `${live("b-score")}.mode`)).toBe("auto");
		await openItem(v, "bans");
		await click(v, '.mxs-ab .mxs-c2');
		await run(v, `(() => { const i = document.querySelector("[data-mxs-add]"); i.value = "곤란합니다"; i.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); })()`);
		await waitForPosts(2);
		expect(posts[1]!.body.box.bans).toEqual(["죄송", "곤란합니다"]);
		await click(v, "#back");
		await waitFor(v, `MX.scr === "" && document.querySelector("#mon-tl > .mr")`);
		expect(await ev<string>(v, `decodeURIComponent(location.hash)`)).toBe("#monitoring/i:mail/mail/b-score");
	}, 40_000);

	test("a refused save puts the box back and says so", async () => {
		putFails = true;
		const v = await open(SET);
		await click(v, '.mxs-mode[data-m="notify"]');
		await waitFor(v, `document.querySelector(".snack.bad")`);
		expect(await ev<any>(v, `({ mode: ${live("b-score")}.mode, on: document.querySelector(".mxs-mode.on").dataset.m, alone: ${live("b-score")}.alone })`)).toEqual({ mode: "ask", on: "ask", alone: true });
	}, 30_000);

	test("the base box has no delete and no judge item; the others delete through the route and return to the list", async () => {
		const base = await open("/#monitoring/i%3Amail/mail/base/set");
		expect(await ev<any>(base, `({ del: document.querySelectorAll(".mxs-del").length, judge: document.querySelectorAll('.mxs-ah[data-k="judge"]').length })`)).toEqual({ del: 0, judge: 0 });
		const v = await open("/#monitoring/i%3Amail/mail/b-pay/set");
		await click(v, ".mxs-del .btn");
		await waitFor(v, `document.querySelector("dialog[open]")`);
		await run(v, `[...document.querySelectorAll("dialog[open] button")].find(b => b.textContent === "삭제").click()`);
		await waitForPosts(1);
		expect(posts[0]).toEqual({ method: "DELETE", path: "/api/mailbox/box", body: { app: "mail", id: "b-pay" } });
		await waitFor(v, `MX.scr === "" && MX.box === "base" && document.querySelector("#mon-tl > .mr")`);
	}, 40_000);

	test("the merged entry opens the first account's box and says so", async () => {
		const v = await open(SET);
		await run(v, `MX.acct = "all"; MX.box = "all"; MX.scr = ""; mxSync()`);
		await waitFor(v, `document.querySelector("#mon-tl > .mr")`);
		await run(v, `mxOpenSet("n:문서 요청")`);
		await waitFor(v, `document.querySelector("#mon-tl > .mxs .mxs-note")`);
		expect(await ev<any>(v, `({ acct: MX.acct, box: MX.box, scr: MX.scr })`)).toEqual({ acct: "mail", box: "b-score", scr: "set" });
	}, 30_000);
});

describe("메일함 추가", () => {
	const NEW = "/#monitoring/i%3Amail/mail/all/new";
	const pickGroup = async (v: View) => {
		await waitFor(v, `[...document.querySelectorAll(".mxs .li .sup")].some(s => s.textContent.includes("@team.example.org"))`);
		await run(v, `[...document.querySelectorAll(".mxs .li")].find(l => l.textContent.includes("@team.example.org")).click()`);
		await waitFor(v, `document.querySelector("[data-mxs-go]")`);
	};

	test("a suggestion fills the name and the sender-domain condition, and creating it moves no mail", async () => {
		const v = await open(NEW);
		await waitFor(v, `document.querySelector(".mxs-sg")`);
		expect(await ev<any>(v, `({ rows: document.querySelectorAll(".mxs-sg").length, counts: document.querySelectorAll(".mxs-sg > .mxs-cnt").length })`)).toEqual({ rows: 1, counts: 1 });
		await pickGroup(v);
		expect(await ev<any>(v, `({ name: document.querySelector('input[aria-label="메일함 이름"]').value, from: MXS.d.conds.from, bring: MXS.d.bring })`)).toEqual({ name: "team", from: ["@team.example.org"], bring: false });
		await click(v, "[data-mxs-go]");
		await waitForPosts(1);
		expect(posts[0]).toMatchObject({ method: "PUT", body: { app: "mail", box: { name: "team", mode: "ask", conds: { from: ["@team.example.org"], subj: [], body: [] } } } });
		await waitFor(v, `MX.scr === "" && MX.box === "b-new1" && document.querySelector("#mon-tl > .mx-bh") && !document.querySelector("#mon-tl > .mxs")`);
		expect(posts).toHaveLength(1);
	}, 40_000);

	test("moving the mail that is already there is an option of the screen, and goes through the move route", async () => {
		const v = await open(NEW);
		await pickGroup(v);
		await click(v, '.hs-sw[aria-label="지금 있는 메일도 옮기기"]');
		await click(v, "[data-mxs-go]");
		await waitForPosts(2);
		expect(posts[1]).toEqual({ method: "POST", path: "/api/mailbox/move", body: { keys: ["p-1", "p-4"], box: "b-new1" } });
	}, 40_000);

	test("with two accounts and none chosen, the account comes first", async () => {
		const v = await open("/#monitoring/i%3Amail/all/all/new");
		expect(await ev<number>(v, `document.querySelectorAll(".mxs .list > .li").length`)).toBe(2);
		await run(v, `document.querySelectorAll(".mxs .list > .li")[1].click()`);
		await waitFor(v, `MXS.d.acct === "mail-2"`);
	}, 30_000);

	test("an account with no stored mail yet can still add its first box", async () => {
		const kept = mails.splice(0);
		try {
			const v = await hub.view({ width: 1280, height: 900 });
			await v.navigate(`${hub.origin}${NEW}`);
			await waitFor(v, `NT.loaded && INTG.items.length === 2 && document.querySelector("#mon-tl > .mxs")`);
			expect(await ev<boolean>(v, `MON.sel === "i:mail" && MX.scr === "new"`)).toBe(true);
		} finally {
			mails.push(...kept);
		}
	}, 30_000);
});
