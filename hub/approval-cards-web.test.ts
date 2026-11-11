import { afterAll, describe, expect, test } from "bun:test";
import { draftApprovalBlock } from "./draft-approval.ts";
import { emit } from "./events.ts";
import { listNotices, resetNoticesForTest, unreadCount } from "./notices.ts";
import { fakeHub, json, on } from "./test-web.ts";

// Several send-approval cards of one conversation are answered one after another: the sheet shows where the card stands ("남은 N건 (k/T)")
// and a recipient that looks like a typo, answering opens the next card at once, and a card pushed up by later posts stays one tap away.
// Headless browser against a fixture history and the real notice store; nothing leaves the process.
let history: unknown[] = [];
const hub = fakeHub({
	api: (req, url) => {
		if (url.pathname === "/api/state") return json({ name: "땅콩", orchestrator: { status: "idle" }, lanes: [], terminals: {}, channels: { work: [] }, discord: {}, notices_unread: unreadCount() });
		if (url.pathname === "/api/history") return json({ target: url.searchParams.get("target"), events: url.searchParams.get("target") === "main" ? history : [] });
		if (url.pathname === "/api/activity") return json({ items: [], more: false, history: false });
		if (url.pathname === "/api/notices" && req.method === "GET") return json(listNotices(300));
	},
});
const view = await hub.view({ width: 390, height: 844 });
// The cards stay open on the hub (answers here are the page's own); later test files must not see them.
afterAll(() => {
	hub.stop();
	resetNoticesForTest();
});
const { waitFor } = on(view);
const load = async (ready: string) => {
	await view.navigate(`${hub.origin}/`);
	await waitFor(`typeof openTarget === "function" && S && NT.loaded`);
	await view.evaluate(ready);
};
const card = (ref: string, progress: string, extra = "") => `[ask] 메일 답장 초안이에요\n-# ${progress}${extra}\n${draftApprovalBlock({ to: "reader2@hannail.net", toLabel: "받는이", subject: "문서", body: `보내 드립니다 ${ref}`, ref, question: "이 답장 보낼까요?" })}`;
const noticeOf = (ref: string) => listNotices(300).items.find(i => i.kind === "decision" && i.decision?.draft?.ref === ref)!;

describe("approval cards one after another", () => {
	test("the sheet shows the card's place and a likely recipient typo; answering it opens the next card at once", async () => {
		const a = `RA${Date.now()}`, b = `RB${Date.now()}`;
		emit("outbox", { ts: new Date(Date.now() - 2000).toISOString(), kind: "out", source: "orchestrator", target: "alert", text: card(a, "남은 1건 (1/2)", "\n> 원문: reader2@hannail.net 으로 보내 주세요") });
		emit("outbox", { ts: new Date(Date.now() - 1000).toISOString(), kind: "out", source: "orchestrator", target: "alert", text: card(b, "마지막 카드예요 (2/2)") });
		const na = noticeOf(a), nb = noticeOf(b);
		expect(na.decision!.draft!.recipientWarning).toContain("reader2@hanmail.net");
		await load(`(noticeSheetOpen(${JSON.stringify(na.id)}), 0)`);
		await waitFor(`document.querySelectorAll(".fs-ft .rq-acts .btn[data-n]").length === 3`);
		expect(await view.evaluate(`document.querySelector(".fs-hd .fs-t .fs-left").textContent`)).toBe(" · 남은 1건 (1/2)");
		expect(await view.evaluate(`document.querySelector(".dc-rw").textContent`)).toContain("hannail.net → reader2@hanmail.net");
		// The hub answers the first card: the sheet moves on to the next card of the same conversation without another tap.
		await view.evaluate(`(() => { const n = ntById(DK.nid); n.decision.state = "answered"; n.decision.answer = "1) 보내기"; dkPaint(); return 0; })()`);
		await waitFor(`DK.nid === ${JSON.stringify(nb.id)} && document.querySelector(".fs-hd .fs-t .fs-left")`);
		expect(await view.evaluate(`document.querySelector(".fs-hd .fs-t .fs-left").textContent`)).toBe(" · 마지막 카드예요 (2/2)");
		expect(await view.evaluate(`!!document.querySelector(".dc-rw")`)).toBe(true);
	});

	test("a card pushed up by later posts stays in the dock as one row that opens it", async () => {
		const c = `RC${Date.now()}`;
		emit("outbox", { ts: new Date(Date.now() - 1000).toISOString(), kind: "out", source: "orchestrator", target: "web", text: card(c, "남은 3건 (19/22)") });
		const n = noticeOf(c);
		history = [
			{ ts: "2026-10-31T08:10:00.000Z", kind: "message", source: "web", channel: "web", text: "다음 카드" },
			{ ts: "2026-10-31T08:11:00.000Z", kind: "out", source: "orchestrator", target: "web", text: "19번 카드는 위에 있어요" },
		];
		await load(`(openTarget(${JSON.stringify(n.decision!.to)}, "chat"), 0)`);
		await waitFor(`document.querySelector("#dcard .dc-wait") && !document.querySelector("#dcard").hidden`);
		expect(await view.evaluate(`document.querySelector("#dcard .dc-wait-n").textContent`)).toBe("남은 3건 (19/22)");
		await view.evaluate(`(document.querySelector("#dcard .dc-wait").click(), 0)`);
		await waitFor(`DK.nid === ${JSON.stringify(n.id)}`);
	});

	test("a draft card that docks brings the end of its draft message into view, whether it sat below or above the fold", async () => {
		history = [];
		await load(`(openTarget("main", "chat"), 0)`);
		await waitFor(`document.getElementById("timeline").clientHeight > 0`);
		const place = (top: number) => view.evaluate(`(async () => { const tl = document.getElementById("timeline"); const fill = () => { const d = document.createElement("div"); d.style.height = "900px"; return d; }; const m = document.createElement("div"); m.className = "bm"; m.dataset.ts = "TD1"; m.style.height = "300px"; tl.replaceChildren(fill(), m, fill()); tl.scrollTop = ${top}; dcShowDraft({ at: "TD1", t: target }); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); const a = m.getBoundingClientRect(), b = tl.getBoundingClientRect(); return a.bottom <= b.bottom + 1 && a.bottom > b.top; })()`);
		expect(await place(0)).toBe(true);   // the draft ends below the fold
		expect(await place(1800)).toBe(true);   // the draft ends above the view
	});
});
