import { afterAll, expect, test } from "bun:test";
import { parseQuotedDraft } from "./draft-approval.ts";
import { decisionsOf } from "./notices.ts";
import { fakeHub, json } from "./test-web.ts";

// The send-approval card (web/js/30-monitoring.js draftCardNode) and what feeds it (hub/notices.ts decisionsOf): a mail question that quotes its
// draft always carries the draft and the draft-approval options, the card shows the question once, and the thread row is one tap target.
const QUOTE = "> 받는이: Alex Sender <sender@example.com>\n> 제목: Re: 월간 점검 보고서\n>\n> 안녕하세요, Alex님.\n>\n>\n>\n> 보내 주신 보고서는 잘 받았습니다.\n>\n>\n> 감사합니다.";
const ASK = "[ask] 감사 답장 초안이에요. 보내도 될까요?";
const LABELS = ["보내기", "고치기", "보내지 않기"];

test("a send question quoting its draft gets the draft and the three draft options, not 네 / 아니요", () => {
	for (const text of [`${ASK}\n\n${QUOTE}`, `${ASK}\n${QUOTE}\n(draft-1)`, `${ASK} (draft-1)\n\n${QUOTE}`]) {
		const [d] = decisionsOf({ ts: new Date().toISOString(), kind: "out", source: "orchestrator", target: "mail:fx-9", text } as never);
		expect(d?.options.map(o => o.label)).toEqual(LABELS);
		expect(d?.draft?.to).toBe("Alex Sender <sender@example.com>");
		expect(d?.draft?.subject).toBe("Re: 월간 점검 보고서");
	}
});

test("a question that quotes nothing keeps the plain yes / no, and the quoted draft collapses repeated blank lines", () => {
	const [d] = decisionsOf({ ts: new Date().toISOString(), kind: "out", source: "orchestrator", target: "work", text: "[ask] 이 방식으로 갈까요?" } as never);
	expect(d?.draft).toBeUndefined();
	expect(d?.options.map(o => o.label)).not.toContain("보내기");
	const body = parseQuotedDraft(QUOTE)?.body ?? "";
	expect(body).not.toMatch(/\n{3,}/);
	expect(body.split("\n\n")).toEqual(["안녕하세요, Alex님.", "보내 주신 보고서는 잘 받았습니다.", "감사합니다."]);
});

const hub = fakeHub({
	api: (_req, url) => {
		if (url.pathname === "/api/notices") return json({ items: [], unread: 0 });
	},
});
afterAll(() => hub.stop());

async function open(width: number) {
	const v = await hub.view({ width, height: 1200 });
	await v.navigate(`${hub.origin}/`);
	await v.evaluate(`(localStorage.setItem("dotz-theme", "light"), true)`);
	await v.navigate(`${hub.origin}/?light#monitoring/notice`);
	await v.evaluate(`new Promise((res, rej) => { const t = setTimeout(() => rej(new Error("page not ready")), 10000); const done = () => { if (typeof go === "function" && current !== "monitoring") go("monitoring", "notice"); if (document.querySelector("#mon-tl") && typeof draftCardNode === "function") { clearTimeout(t); res(true); } else setTimeout(done, 50); }; done(); })`);
	return v;
}

const now = new Date().toISOString();
const Q = "감사 답장 초안이에요. 보내도 될까요?";
const OPTS = [{ n: 1, label: "보내기", desc: "", rec: true }, { n: 2, label: "고치기", desc: "", rec: false, detail: true }, { n: 3, label: "보내지 않기", desc: "", rec: false }];
const DRAFT = { toLabel: "받는이", to: "Alex Sender <sender@example.com>", subject: "Re: 월간 점검 보고서", body: "안녕하세요, Alex님.\n\n\n\n보내 주신 보고서는 잘 받았습니다.\n\n\n감사합니다." };
const note = (id: string, state: string, extra: object = {}) => ({ id, ts: now, updated: now, kind: "decision", tone: "ask", title: `${Q} (draft-1)`, text: `${QUOTE}\n${Q}`, open: "mail:fx-9", src: "mail:fx-9", at: now, read: false,
	decision: { options: OPTS, to: "mail:fx-9", reply_to: now, group: 1, state, draft: DRAFT, ...extra } });
const NOTES = [note("a", "open"), note("b", "answered", { answer: "1) 보내기", answered_at: now }), note("c", "answered", { answer: "2) 고치기 - 짧게", answered_at: now }), note("d", "answered", { answer: "3) 보내지 않기", answered_at: now }), note("e", "answered", { resolved: true, answered_at: now })];
const BRIEF = { from: "Alex Sender <sender@example.com>", summary: "이번 달 점검이 끝났어요.", todo: ["보고서 확인"], questions: ["다음 점검 날짜는요?"] };
const draw = `(() => {
	cancelAnimationFrame(monRaf); window.renderMonitoring = () => {}; window.monSchedule = () => {};
	window.__opened = []; window.__posts = [];
	window.go = (...a) => { window.__opened.push(a.join(":")); };
	window.api = async (p, m, b) => { window.__posts.push([p, b]); return { item: ${JSON.stringify(note("a", "answered", { answer: "1) 보내기", answered_at: now }))}, unread: 0 }; };
	MAILS.set("mail:fx-9", { subject: "월간 점검 보고서 확인 요청", from: "Alex Sender <sender@example.com>", source: "fx", at: ${JSON.stringify(now)}, summary: "이번 달 점검이 끝났어요." });
	// A mail row stands for a recorded mail (a conversation without one is not drawn as a mail row, 30-monitoring.js monConvNode).
	MAILS.set("mail:fx-8", { subject: "지난달 점검 보고서", from: "Alex Sender <sender@example.com>", source: "fx", at: ${JSON.stringify(now)}, summary: "지난달 점검 결과예요." });
	CONV.set("mail:fx-8", { ts: ${JSON.stringify(now)}, text: "[ask] ${Q}", from: "bot" }); ts("mail:fx-8").unread = 0;
	const items = ${JSON.stringify(NOTES)};
	NT.items = items; NT.loaded = true; DR.edit.clear(); DR.manual.clear();
	const nodes = [...items.map(n => monNoticeNode(n, [])), monConvNode("mail:fx-8", "메일")];
	document.querySelector("#mon-tl").replaceChildren(...nodes);
	return true;
})()`;

for (const width of [1440, 390]) {
	test(`draft card at ${width}px: one head line, mail preview, three actions, state badges, the thread row is the link`, async () => {
		const v = await open(width);
		const got = JSON.parse((await v.evaluate(`(${draw}, JSON.stringify((() => {
			const cards = [...document.querySelectorAll("#mon-tl > .bm.dr")];
			const c = cards[0], txt = e => e.textContent.trim();
			const row = document.querySelector("#mon-tl > .bm.mr");
			return { n: cards.length, states: cards.map(x => x.querySelector(".dr-st, .rq-sent").dataset.state), badge: cards.map(x => txt(x.querySelector(".dr-st, .rq-sent"))),   // a sent draft says 보냈어요 in its foot
				questions: cards.map(x => x.querySelectorAll(".rq-hd").length), chip: txt(c.querySelector(".dr-chip")), subject: txt(c.querySelector(".dr-sub")),
				subjectWeight: Number(getComputedStyle(c.querySelector(".dr-sub")).fontWeight), paras: [...c.querySelectorAll(".dr-body p")].map(txt),
				orig: !!c.querySelector(".rq-orig"), buttons: cards.map(x => [...x.querySelectorAll("button:not(.dr-rm):not(.rq-more):not(.rq-recv)")].map(txt)), more: cards.map(x => x.querySelectorAll(".rq-more").length), rm: cards.map(x => x.querySelectorAll(".dr-rm").length), rowCount: document.querySelectorAll("#mon-tl > .bm.dr .dcm-row").length,
				over: document.documentElement.scrollWidth > innerWidth, w: c.getBoundingClientRect().width,
				rowRole: [row.getAttribute("role"), row.tabIndex], rowButtons: [...row.querySelectorAll("button")].map(b => b.dataset.k) };
		})()))`)) as string) as any;
		expect(got.n).toBe(5);
		expect(got.states).toEqual(["open", "send", "revising", "drop", "expired"]);
		for (const b of got.badge) expect(b).toMatch(/\d{1,2}:\d{2}/);
		expect(got.questions).toEqual([1, 1, 1, 1, 1]);
		expect(got.chip).toBe("Alex Sender <sender@example.com>");
		expect(got.subject).toBe("Re: 월간 점검 보고서");
		expect(got.subjectWeight).toBeGreaterThanOrEqual(600);
		expect(got.paras).toEqual(["안녕하세요, Alex님.", "보내 주신 보고서는 잘 받았습니다.", "감사합니다."]);
		expect(got.orig).toBe(true);
		expect(got.buttons[0]).toEqual(["보내기", "고치기", "보내지 않기"]);
		for (const b of got.buttons.slice(1)) expect(b).toEqual([]);
		// The body is clamped to about six lines (10-reply-card.js), so a narrow card offers 펼치기; the actions are still exactly three.
		expect(got.more).toEqual([1, 1, 1, 1, 1]);
		expect(got.rm).toEqual([0, 0, 0, 0, 0]);   // the waiting draft's button row has 보내지 않기: no second way to it (x) in the head
		expect(got.rowCount).toBe(0);
		expect(got.over).toBe(false);
		expect(got.rowRole).toEqual(["button", 0]);
		expect(got.rowButtons).toEqual(["mail-star", "mail-draft", "mail-menu"]);   // the row itself is the link; its buttons are the ☆ every row has, 초안 작성 of an incoming mail and the ⋯ menu last in the header

		const edit = JSON.parse((await v.evaluate(`(${draw}, document.querySelector("#mon-tl > .bm.dr .btn.tonal").click(), JSON.stringify((() => {
			const c = document.querySelector("#mon-tl > .bm.dr"), ta = c.querySelector("textarea.dr-edit");
			return { ta: ta ? ta.value : null, ph: ta ? ta.placeholder : null, body: !!c.querySelector(".dr-body"), ask: c.querySelector(".dr-q2") && c.querySelector(".dr-q2").textContent, buttons: [...c.querySelectorAll(".dr-act button")].map(b => b.textContent.trim()) };
		})()))`)) as string) as any;
		// 고치기 asks "어떻게 고칠까요?" with the old draft still shown; 직접 수정 is the small secondary action
		expect(edit).toEqual({ ta: "", ph: "더 짧게, 존댓말로, 견적서도 첨부한다고 써 줘", body: true, ask: "어떻게 고칠까요?", buttons: ["고쳐 달라고 하기", "취소", "직접 수정"] });
		const manual = JSON.parse((await v.evaluate(`(${draw}, document.querySelector("#mon-tl > .bm.dr .btn.tonal").click(), document.querySelector("#mon-tl > .bm.dr .dr-manual").click(), JSON.stringify((() => {
			const c = document.querySelector("#mon-tl > .bm.dr"), ta = c.querySelector("textarea.dr-edit");
			return { ta: ta ? ta.value : null, body: !!c.querySelector(".dr-body") };
		})()))`)) as string) as any;
		expect(manual).toEqual({ ta: "안녕하세요, Alex님.\n\n보내 주신 보고서는 잘 받았습니다.\n\n감사합니다.", body: false });

		// the instruction goes out as the note of the 고치기 answer; a manual text goes out with its lead
		const posts = JSON.parse((await v.evaluate(`(${draw}, document.querySelector("#mon-tl > .bm.dr .btn.tonal").click(), (() => { const t = document.querySelector("#mon-tl > .bm.dr textarea.dr-edit"); t.value = "더 짧게"; t.dispatchEvent(new Event("input", { bubbles: true })); document.querySelector("#mon-tl > .bm.dr .dr-act .btn").click(); })(), new Promise(r => setTimeout(r, 0)).then(() => 0), JSON.stringify(window.__posts.map(p => [p[0], p[1].n, p[1].note])))`)) as string) as any;
		expect(posts).toEqual([["/api/notices/a/answer", 2, "더 짧게"]]);

		const sent = JSON.parse((await v.evaluate(`(${draw}, document.querySelector("#mon-tl > .bm.dr .dr-send").click(), new Promise(r => setTimeout(r, 0)).then(() => 0), JSON.stringify(window.__posts.map(p => [p[0], p[1].n])))`)) as string) as any;
		expect(sent).toEqual([["/api/notices/a/answer", 1]]);

		await v.evaluate(draw);
		await v.evaluate(`document.querySelector("#mon-tl > .bm.mr").click()`);
		expect(await v.evaluate(`window.__opened.join("|")`)).toBe("monitoring:c:mail:fx-8");
	});
}

test("a draft sent back for 고치기 says 고치는 중… and gives way to the rewritten draft of the same mail", async () => {
	const v = await open(390);
	const later = new Date(Date.now() + 60_000).toISOString();
	const run = (items: unknown[]) => v.evaluate(`(() => {
		cancelAnimationFrame(monRaf); window.renderMonitoring = () => {}; window.monSchedule = () => {};
		const items = ${JSON.stringify(items)};
		NT.items = items; NT.loaded = true;
		document.querySelector("#mon-tl").replaceChildren(...items.map(n => monNoticeNode(n, [])).filter(Boolean));
		return JSON.stringify([...document.querySelectorAll("#mon-tl > .bm.dr")].map(x => [x.dataset.nid, x.querySelector(".dr-st").textContent.replace(/ · .*/, "")]));
	})()`);
	const sentBack = note("old", "answered", { answer: "2) 고치기 - 짧게", answered_at: now });
	expect(JSON.parse((await run([sentBack])) as string)).toEqual([["old", "고치는 중…"]]);
	expect(JSON.parse((await run([sentBack, { ...note("new", "open"), ts: later }])) as string)).toEqual([["new", "확인 대기"]]);
});

for (const width of [1280, 390]) {
	test(`draft card at ${width}px shows the mail above the draft: sender, summary, to-do and direct-answer lines`, async () => {
		const v = await open(width);
		const got = JSON.parse((await v.evaluate(`(() => {
			cancelAnimationFrame(monRaf);
			const draft = ${JSON.stringify({ ...DRAFT, brief: BRIEF })}, n = ${JSON.stringify(note("a", "open"))};
			n.decision.draft = draft;
			MAILS.set("mail:fx-9", { subject: "월간 점검 보고서 확인 요청", from: draft.brief.from, source: "fx", at: ${JSON.stringify(now)} });
			// each where the app draws it: the decision card's draft above the input (no timeline), the two cards in the monitoring timeline, whose column their narrow rules ask
			window.renderMonitoring = () => {}; window.monSchedule = () => {};
			const nodes = [draftNode(draft, { t: "mail:fx-9" }), draftCardNode(n), draftCardNode(n, { bare: true })], col = document.querySelector("#mon-tl");
			col.replaceChildren(...nodes.slice(1)); col.closest(".view").prepend(nodes[0]);
			const edge = col.closest(".timeline").getBoundingClientRect().right;
			return JSON.stringify({ texts: nodes.map(x => x.textContent), shown: nodes.every(x => x.getBoundingClientRect().width > 0),
				over: document.documentElement.scrollWidth > innerWidth || nodes.some(x => x.getBoundingClientRect().right > Math.min(edge, innerWidth) + 0.5 || [...x.querySelectorAll("*")].some(e => e.getBoundingClientRect().right > innerWidth + 0.5)) });
		})()`)) as string) as any;
		for (const text of got.texts) {
			for (const line of [BRIEF.summary, ...BRIEF.todo, ...BRIEF.questions, "보내 주신 보고서는 잘 받았습니다."]) expect(text).toContain(line);
			expect(text).toContain("Alex Sender");
		}
		expect(got.shown).toBe(true);
		expect(got.over).toBe(false);
	});
}
