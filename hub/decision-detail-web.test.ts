import { afterAll, describe, expect, test } from "bun:test";
import { draftApprovalBlock } from "./draft-approval.ts";
import { emit } from "./events.ts";
import { listNotices, unreadCount } from "./notices.ts";
import { fakeHub, json, on } from "./test-web.ts";

// An option that needs detail (안 됨 / 고치기 / a trailing " …") opens a text field and sends nothing until the owner writes it; a positive option sends at once.
// Headless browser against a fixture history and the real notice store; every POST is recorded, nothing leaves the process.
const ASK = "[ask] 확인\n결정: 확인\n**1) 확인됨**\n잘 열려요\n**2) 안 됨**\n어디가 안 되는지 적어 주세요\n";
const MARKED = "[ask] 배포\n결정: 배포\n**1) 배포하기**\n바로 올려요\n**2) 보류 …**\n이유만 남겨요\n";
let history: unknown[] = [];
const hub = fakeHub({
	api: (req, url) => {
		if (url.pathname === "/api/state") return json({ name: "땅콩", orchestrator: { status: "idle" }, lanes: [], terminals: {}, channels: { work: [] }, discord: {}, notices_unread: unreadCount() });
		if (url.pathname === "/api/history") return json({ target: url.searchParams.get("target"), events: url.searchParams.get("target") === "main" ? history : [] });
		if (url.pathname === "/api/activity") return json({ items: [], more: false, history: false });
		if (url.pathname === "/api/notices" && req.method === "GET") return json(listNotices(100));
	},
});
const view = await hub.view({ width: 390, height: 844 });
afterAll(() => hub.stop());
const { waitFor } = on(view);
const settled = () => view.evaluate(`Promise.all(document.getAnimations().map(a => a.finished.catch(() => 0))).then(() => true)`);
const ask = (text: string) => [
	{ ts: "2026-10-22T08:10:00.000Z", kind: "message", source: "web", channel: "web", text: "확인해 줘" },
	{ ts: "2026-10-22T08:19:17.721Z", kind: "out", source: "orchestrator", target: "web", reply_to: "ec330340", text },
];
const RECORD = `(() => { window.__posts = []; const f = window.fetch.bind(window); window.fetch = (u, o) => { if (o && o.method === "POST") window.__posts.push({ path: String(u).replace(location.origin, ""), body: JSON.parse(o.body || "null") }); return f(u, o); }; return 0; })()`;
const load = async (ready: string) => {
	await view.navigate(`${hub.origin}/`);
	await waitFor(`typeof openTarget === "function" && S`);
	await view.evaluate(RECORD);
	await view.evaluate(ready);
};
const posts = async (): Promise<{ path: string; body: any }[]> => JSON.parse(await view.evaluate("JSON.stringify(window.__posts.filter(p => p.path === '/api/message' || p.path.endsWith('/answer')))"));
const waitForPost = () => waitFor(`window.__posts.some(p => p.path === "/api/message" || p.path.endsWith("/answer"))`);
const openChat = async (text: string) => {
	history = ask(text);
	await load(`(openTarget("main", "chat"), 0)`);
	await waitFor(`document.querySelectorAll("#dcard .dc-row").length === 2`);
};
const rowOf = (n: number) => `document.querySelectorAll("#dcard .dc-row")[${n - 1}]`;
const type = (text: string) => view.evaluate(`(() => { const t = document.querySelector(".dc-note"); t.value = ${JSON.stringify(text)}; t.dispatchEvent(new Event("input", { bubbles: true })); return 0; })()`);

describe("decision options that need detail", () => {
	test("a needs-detail option opens a focused text field, sends nothing, and answers '2) 안 됨 - <text>' after it is written", async () => {
		await openChat(ASK);
		await view.evaluate(`(${rowOf(2)}.click(), 0)`);
		await waitFor(`document.querySelector("#dcard .dc-note")`);
		await settled();
		expect(await view.evaluate(`document.activeElement === document.querySelector("#dcard .dc-note")`)).toBe(true);
		expect(await view.evaluate(`document.querySelector("#dcard .dc-ctx").textContent`)).toBe("2안 됨");
		expect(await view.evaluate(`document.querySelector("#dcard .dc-go").disabled`)).toBe(true);
		expect(await view.evaluate(`document.querySelectorAll("#dcard .dc-row").length`)).toBe(0);
		expect(await posts()).toEqual([]);
		await type("  화면이 안 열려요  ");
		expect(await view.evaluate(`document.querySelector("#dcard .dc-go").disabled`)).toBe(false);
		expect(await posts()).toEqual([]);
		await view.evaluate(`(document.querySelector("#dcard .dc-go").click(), 0)`);
		await waitForPost();
		const posted = await posts();
		expect(posted).toHaveLength(1);
		expect(posted[0]!.path).toBe("/api/message");
		expect(posted[0]!.body.text).toBe("2) 안 됨 - 화면이 안 열려요");
		expect(posted[0]!.body.picks).toEqual([{ q: "확인", n: 2, label: "안 됨", note: "화면이 안 열려요" }]);
	});

	test("돌아가기 closes the field without sending and the options are back", async () => {
		await openChat(ASK);
		await view.evaluate(`(${rowOf(2)}.click(), 0)`);
		await waitFor(`document.querySelector("#dcard .dc-note")`);
		await type("쓰다 말았어요");
		await view.evaluate(`(document.querySelector("#dcard .dc-back").click(), 0)`);
		await waitFor(`!document.querySelector("#dcard .dc-note") && document.querySelectorAll("#dcard .dc-row").length === 2`);
		expect(await posts()).toEqual([]);
	});

	test("a positive option sends at once, with no text field", async () => {
		await openChat(ASK);
		await view.evaluate(`(${rowOf(1)}.click(), 0)`);
		await waitForPost();
		const posted = await posts();
		expect(posted).toHaveLength(1);
		expect(posted[0]!.body.text).toBe("1) 확인됨");
		expect(posted[0]!.body.picks).toEqual([{ q: "확인", n: 1, label: "확인됨" }]);
		expect(await view.evaluate(`!!document.querySelector("#dcard .dc-note")`)).toBe(false);
	});

	test("the bot's trailing ' …' marks an option that needs detail, and the mark is not part of the label", async () => {
		await openChat(MARKED);
		expect(await view.evaluate(`[...document.querySelectorAll("#dcard .dc-lb")].map(b => b.textContent).join("|")`)).toBe("배포하기|보류");
		await view.evaluate(`(${rowOf(2)}.click(), 0)`);
		await waitFor(`document.querySelector("#dcard .dc-note")`);
		expect(await posts()).toEqual([]);
		await type("내일 다시");
		await view.evaluate(`(document.querySelector("#dcard .dc-go").click(), 0)`);
		await waitForPost();
		const posted = await posts();
		expect(posted[0]!.body.text).toBe("2) 보류 - 내일 다시");
	});

	test("draft approval 고치기 still asks for the change first and posts it as the note of the notice answer", async () => {
		const ref = `d-detail-${Date.now()}`;
		emit("outbox", { ts: new Date().toISOString(), kind: "out", source: "orchestrator", target: "alert", text: `[ask] ${draftApprovalBlock({ to: "kim@example.com", subject: "일정", body: "다음 주 일정을 보내 드립니다.", ref })}` });
		const n = listNotices(300).items.find(i => i.kind === "decision" && i.decision?.draft?.ref === ref)!;
		expect(n).toBeDefined();
		await load(`(noticeSheetOpen(${JSON.stringify(n.id)}), 0)`);
		await waitFor(`document.querySelectorAll(".fs-ft .rq-acts .btn:not(.rq-manual)").length === 3`);
		await view.evaluate(`([...document.querySelectorAll(".fs-ft .rq-acts .btn")].find(b => b.textContent === "고치기").click(), 0)`);
		await waitFor(`document.querySelector(".fs-ft .dc-note")`);
		expect(await posts()).toEqual([]);
		// the input asks "어떻게 고칠까요?" with an example; the draft stays above it; 직접 수정 is not offered until the input is left
		expect(await view.evaluate(`document.querySelector(".fs-ft .dc-go").textContent`)).toBeTruthy();
		expect(await view.evaluate(`[document.querySelector(".fs-ft .dc-ctx .dc-lb").textContent, document.querySelector(".fs-ft .dc-note").placeholder, !!document.querySelector(".fs-body .dc-dr-b"), !!document.querySelector(".fs-ft .rq-manual")]`)).toEqual(["어떻게 고칠까요?", "더 짧게, 존댓말로, 견적서도 첨부한다고 써 줘", true, false]);
		await settled();
		await type("3시 말고 4시로");
		await view.evaluate(`(document.querySelector(".fs-ft .dc-go").click(), 0)`);
		await waitForPost();
		const posted = await posts();
		expect(posted).toHaveLength(1);
		expect(posted[0]!.path).toBe(`/api/notices/${n.id}/answer`);
		expect(posted[0]!.body).toEqual({ n: 2, label: "고치기", note: "3시 말고 4시로" });
		// the sheet stays open saying 고치는 중… with the old draft; the rewritten draft (a newer open one of the same conversation) replaces it
		// the buttons stay in place and the pressed one says so itself: no line under the row
		expect(await view.evaluate(`[document.querySelectorAll(".fs-ft .dc-st").length, [...document.querySelectorAll(".fs-ft .rq-acts .btn:not(.rq-manual)")].map(b => b.textContent)]`)).toEqual([0, ["보내기", "고치는 중…", "보내지 않기"]]);
		// until the new draft lands the old one cannot be sent, sent back again or dropped: every choice is locked
		expect(await view.evaluate(`[...document.querySelectorAll(".fs-ft .rq-acts .btn")].every(b => b.disabled)`)).toBe(true);
		await view.evaluate(`(() => {
			const old = ntById(DK.nid); old.decision.state = "answered"; old.decision.answer = "2) 고치기 - 3시 말고 4시로";
			const fresh = JSON.parse(JSON.stringify(old)); fresh.id = "redrafted"; fresh.ts = new Date(Date.now() + 1000).toISOString(); fresh.decision.state = "open"; delete fresh.decision.answer;
			fresh.decision.draft.body = "다음 주 일정을 4시로 보내 드립니다.";
			NT.items.push(fresh); dkPaint(); return 0;
		})()`);
		await waitFor(`document.querySelector(".fs-body .dc-dr-b").textContent === "다음 주 일정을 4시로 보내 드립니다." && document.querySelectorAll(".fs-ft .rq-acts .btn:not(.rq-manual)").length === 3`);
	});

	test("직접 수정 in the draft sheet sends the owner's own text with its lead as the 고치기 note", async () => {
		const ref = `d-manual-${Date.now()}`;
		emit("outbox", { ts: new Date().toISOString(), kind: "out", source: "orchestrator", target: "alert", text: `[ask] ${draftApprovalBlock({ to: "kim@example.com", subject: "일정", body: "다음 주 일정을 보내 드립니다.", ref })}` });
		const n = listNotices(300).items.find(i => i.kind === "decision" && i.decision?.draft?.ref === ref)!;
		await load(`(noticeSheetOpen(${JSON.stringify(n.id)}), 0)`);
		await waitFor(`document.querySelector(".fs-ft .rq-manual")`);
		expect(await view.evaluate(`document.querySelector(".fs-ft .rq-manual").textContent`)).toBeTruthy();
		await view.evaluate(`(document.querySelector(".fs-ft .rq-manual").click(), 0)`);
		await waitFor(`document.querySelector(".fs-ft .dc-note")`);
		expect(await view.evaluate(`document.querySelector(".fs-ft .dc-note").value`)).toBe("다음 주 일정을 보내 드립니다.");
		await type("다음 주 화요일 일정을 보내 드립니다.");
		await view.evaluate(`(document.querySelector(".fs-ft .dc-go").click(), 0)`);
		await waitForPost();
		expect((await posts())[0]!.body).toEqual({ n: 2, label: "고치기", note: "이 내용으로 고쳐 주세요: 다음 주 화요일 일정을 보내 드립니다." });
	});

	test("the notice sheet of a plain decision asks for the reason of '안 됨' too", async () => {
		const title = `점검-${Date.now()}`;
		emit("outbox", { ts: new Date().toISOString(), kind: "out", source: "orchestrator", target: "alert", text: `[ask] ${title}\n결정: ${title}\n**1) 확인됨**\n잘 열려요\n**2) 안 됨**\n어디가 안 되는지 적어 주세요\n` });
		const n = listNotices(300).items.find(i => i.kind === "decision" && i.decision?.state === "open" && i.title.includes(title))!;
		expect(n).toBeDefined();
		await load(`(noticeSheetOpen(${JSON.stringify(n.id)}), 0)`);
		await waitFor(`document.querySelector('.ds-opt[data-k="o2"]')`);
		await view.evaluate(`(document.querySelector('.ds-opt[data-k="o2"]').click(), 0)`);
		await waitFor(`document.querySelector(".fs-ft .dc-note")`);
		expect(await posts()).toEqual([]);
		expect(await view.evaluate(`document.activeElement === document.querySelector(".fs-ft .dc-note")`)).toBe(true);
		await type("로그인이 안 돼요");
		await view.evaluate(`(document.querySelector(".fs-ft .dc-go").click(), 0)`);
		await waitForPost();
		const posted = await posts();
		expect(posted[0]!.path).toBe(`/api/notices/${n.id}/answer`);
		expect(posted[0]!.body).toEqual({ n: 2, label: "안 됨", note: "로그인이 안 돼요" });
	});
});

