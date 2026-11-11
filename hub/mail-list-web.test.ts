import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { fakeHub, json } from "./test-web.ts";

// The mail rows of the 모니터링 tab (web/js/30-monitoring.js monConvNode) in a headless browser: compact, the summary visible, no right-side buttons but the ⋯ at the top right,
// the whole card opens the mail, the reply chip only with data; and the attachments of the original view. Set MAIL_SHOTS=<dir> to keep screenshots.
const SHOTS = process.env.MAIL_SHOTS ?? "";
const hub = fakeHub({
	api: (_req, url) => {
		if (url.pathname === "/api/notices") return json({ items: [], unread: 0 });
	},
});
afterAll(() => hub.stop());

async function open(width: number) {
	const v = await hub.view({ width, height: 900 });
	await v.navigate(`${hub.origin}/`);
	await v.evaluate(`(localStorage.setItem("dotz-theme", "light"), true)`);
	await v.navigate(`${hub.origin}/?light#monitoring/notice`);
	await v.evaluate(`new Promise((res, rej) => { const t = setTimeout(() => rej(new Error("page not ready")), 10000); const done = () => { if (typeof go === "function" && current !== "monitoring") go("monitoring", "notice"); if (document.querySelector("#mon-tl") && NT.loaded && NM.loaded) { clearTimeout(t); o.disconnect(); res(true); } }; const o = new MutationObserver(done); o.observe(document.documentElement, { subtree: true, childList: true }); done(); })`);
	return v;
}

const now = new Date().toISOString();
const MAILS = [
	{ t: "mail:fx-1", m: { subject: "월간 점검 보고서 확인 요청", from: "Alex Sender <sender@example.com>", source: "fx", at: now, summary: "요약\n이번 달 점검이 끝났어요. 스팸 차단은 정상이고 금요일까지 결과 확인이 필요해요.", attachments: [{ name: "점검보고서-2026-10.pdf", type: "application/pdf", size: 482113 }, { name: "차트.png", type: "image/png", size: 20480 }], suggest: { kind: "reply-draft", label: "답장 초안", ref: "d1" } }, unread: 1 },
	{ t: "mail:fx-2", m: { subject: "회의 일정 변경", from: "Kim <kim@example.com>", source: "fx", at: now, preview: "안녕하세요.\n목요일 회의를 금요일 오후로 옮기려고 합니다.\n가능하신지 알려 주세요.", suggest: { kind: "reply-draft", label: "답장 초안", ref: "d2", state: "sent" } }, unread: 0 },
	{ t: "mail:fx-3", m: { subject: "긴 요약 메일", from: "Lee <lee@example.com>", source: "fx", at: now, summary: "첫째 줄 내용입니다. 둘째 문장입니다. 셋째 문장입니다. 넷째 문장입니다. 다섯째 문장입니다. 여섯째 문장입니다. 일곱째 문장입니다. 여덟째 문장입니다. 아홉째 문장입니다. 열째 문장입니다. 열한째 문장입니다. 열두째 문장입니다.", suggest: { kind: "reply-draft", label: "답장 초안", ref: "d3", state: "waiting" } }, unread: 0 },
	// no summary, no body: only the header and the subject; the conversation's last line is the "sender · subject" header and must not come back as a summary
	{ t: "mail:fx-4", m: { subject: "본문이 없는 메일", from: "Park <park@example.com>", source: "fx", at: now }, unread: 0, last: "Park <park@example.com> · 본문이 없는 메일" },
];
const draw = `(() => {
	// the page's own late renders (state, notices) must not replace the fixture rows
	cancelAnimationFrame(monRaf); window.renderMonitoring = () => {};
	window.__opened = [];
	window.go = (...a) => { window.__opened.push(a.join(":")); };
	const rows = ${JSON.stringify(MAILS)}.map(({ t, m, unread, last }) => { MAILS.set(t, m); CONV.set(t, { ts: m.at, text: last || m.subject, from: "bot" }); ts(t).unread = unread; return monConvNode(t, "메일"); });
	document.querySelector("#mon-tl").replaceChildren(...rows);
	return true;
})()`;

for (const width of [1440, 390]) {
	test(`mail rows at ${width}px: sender/time, subject, summary, no right buttons, the card is the link`, async () => {
		const v = await open(width);
		// every check redraws the rows in the same call: nothing of the page can replace them in between
		const got = JSON.parse((await v.evaluate(`(${draw}, JSON.stringify((() => {
			const rows = [...document.querySelectorAll("#mon-tl > .bm.rc.mr")];
			const box = e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
			return { n: rows.length, h: rows.map(r => r.getBoundingClientRect().height), src: rows.map(r => r.querySelector(".rc-src").textContent), title: rows.map(r => r.querySelector(".rc-title").textContent),
				time: rows.map(r => !!r.querySelector(".rc-hd .rc-time")?.textContent),
				sum: rows.map(r => r.querySelector(".mr-sum")?.textContent ?? null), sumH: rows.map(r => r.querySelector(".mr-sum")?.getBoundingClientRect().height ?? 0),
				buttons: document.querySelectorAll("#mon-tl button:not(.mr-more):not(.mr-draft):not(.mr-star), #mon-tl .mr-btn").length, drafts: rows.map(r => r.querySelectorAll(".rc-hd > .mr-draft[aria-label='초안 작성']").length), slots: rows.map(r => r.querySelectorAll(".mr-slot").length), more: rows.map(r => r.querySelectorAll(".rc-hd > .mr-more:last-child").length), role: rows.map(r => [r.getAttribute("role"), r.tabIndex]),
				clip: rows.map(r => r.querySelector(".mr-clip")?.textContent ?? null), clipTag: rows.map(r => r.querySelector(".mr-clip")?.tagName ?? null),
				chip: rows.map(r => r.querySelector("[data-slot=suggest]")?.textContent ?? null), chipBeside: rows.map(r => { const c = r.querySelector("[data-slot=suggest]"), ti = r.querySelector(".rc-title"); return c ? box(c).y < box(ti).y + box(ti).h && box(c).y + box(c).h > box(ti).y && box(c).x >= box(ti).x + box(ti).w : null; }),
				rowBox: rows.map(box), over: document.documentElement.scrollWidth > innerWidth };
		})()))`)) as string) as any;
		expect(got.n).toBe(4);
		expect(got.src).toEqual(["Alex Sender", "Kim", "Lee", "Park"]);
		expect(got.title[0]).toBe("월간 점검 보고서 확인 요청");
		expect(got.time).toEqual([true, true, true, true]);
		expect(got.sum[0]).toBe("이번 달 점검이 끝났어요. 스팸 차단은 정상이고 금요일까지 결과 확인이 필요해요.");
		expect(got.sum[1]).toBe("안녕하세요. 목요일 회의를 금요일 오후로 옮기려고 합니다. 가능하신지 알려 주세요.");
		// nothing to summarize: no third line, never "sender · subject" or the subject again
		expect(got.sum[3]).toBeNull();
		for (const [i, s] of got.sum.entries()) if (s !== null) expect(s).not.toContain(got.title[i]);
		for (const h of got.sumH) expect(h).toBeLessThanOrEqual(60);
		// Gmail-like rows (owner 2026-11-03): three lines on a phone, one line on a wide screen
		for (const r of got.h) expect(r).toBeLessThanOrEqual(width === 390 ? 84 : 48);
		// no right-side buttons but the one ⋯ ending each header (owner 2026-10-27); the ☐ and ☆ at the head are the row's own controls, and the card
		// is a keyboard-reachable button; the attachment count is information only
		expect(got.buttons).toBe(0);
		// 초안 작성 as a pencil beside the ⋯ of every incoming row, without opening the ⋯ (owner 2026-10-29); no button line under the row
		expect(got.drafts).toEqual(got.drafts.map(() => 1));
		expect(got.slots).toEqual(got.slots.map(() => 0));
		expect(got.more.every(n => n === 1)).toBe(true);
		expect(got.role).toEqual([["button", 0], ["button", 0], ["button", 0], ["button", 0]]);
		expect(got.clip).toEqual(["2", null, null, null]);
		expect(got.clipTag[0]).toBe("SPAN");
		expect(got.chip).toEqual(["답장 초안 있음", "자동 답장 보냄", "답장 대기", null]);
		expect(got.chipBeside.slice(0, 3)).toEqual([true, true, true]);
		for (const b of got.rowBox) expect(b.w).toBeGreaterThan(width === 390 ? 300 : 400);
		expect(got.over).toBe(false);
		if (SHOTS) {
			mkdirSync(SHOTS, { recursive: true });
			await v.evaluate(draw);
			await Bun.write(`${SHOTS}/mail-list-${width}.png`, await v.screenshot());
		}

		// the whole card opens the mail: a tap on the summary text, a tap on the paperclip, Enter and Space on the focused card
		const opened = JSON.parse((await v.evaluate(`(${draw}, JSON.stringify((() => {
			const rows = [...document.querySelectorAll("#mon-tl > .bm.rc.mr")];
			rows[0].querySelector(".mr-sum").click();
			rows[0].querySelector(".mr-clip").click();
			rows[1].dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
			rows[2].dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
			rows[2].dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
			return window.__opened;
		})()))`)) as string) as string[];
		expect(opened).toEqual(["monitoring:c:mail:fx-1", "monitoring:c:mail:fx-1", "monitoring:c:mail:fx-2", "monitoring:c:mail:fx-3"]);
	}, 30_000);

	// a plugin posts only sender and subject: the row takes its summary from the conversation's first message the page holds (요약 section, else the original)
	test(`mail rows at ${width}px without a summary of their own take it from the conversation`, async () => {
		const v = await open(width);
		const sender = "Alex Sender <sender@example.com>";
		const fx = [
			{ t: "mail:fx-5", subject: "월간 점검 보고서", msgs: [`${sender} · 월간 점검 보고서`, `${sender} · 월간 점검 보고서\n\n요약\n- 점검이 끝났어요.\n- 스팸 차단은 정상이에요.\n- 금요일까지 확인이 필요해요.\n\n할 일\n- 회신\n\n원문\n안녕하세요.`] },
			{ t: "mail:fx-6", subject: "회의 일정 변경", msgs: [`${sender} · 회의 일정 변경\n\n원문\n회의 일정 변경\nAlex Sender\n목요일 회의를 금요일로 옮깁니다.\n가능한지 알려 주세요.`] },
			{ t: "mail:fx-7", subject: "본문이 없는 메일", msgs: [`${sender} · 본문이 없는 메일`] },
		];
		const draw2 = `(() => {
			cancelAnimationFrame(monRaf); window.renderMonitoring = () => {};
			window.go = () => {};
			const rows = ${JSON.stringify(fx)}.map(({ t, subject, msgs }) => {
				MAILS.set(t, { subject, from: ${JSON.stringify(sender)}, source: "fx", at: ${JSON.stringify(now)} });
				CONV.set(t, { ts: ${JSON.stringify(now)}, text: subject, from: "bot" });
				ts(t).msgs = msgs.map((text, i) => ({ kind: i === 0 ? "mail" : "out", ts: ${JSON.stringify(now)}, source: "fx", target: t, text }));
				return monConvNode(t, "메일");
			});
			document.querySelector("#mon-tl").replaceChildren(...rows);
			return true;
		})()`;
		const got = JSON.parse((await v.evaluate(`(${draw2}, JSON.stringify([...document.querySelectorAll("#mon-tl > .bm.rc.mr")].map(r => [r.querySelector(".mr-sum")?.textContent ?? null, r.querySelector(".mr-sum")?.getBoundingClientRect().height ?? 0])))`)) as string) as [string | null, number][];
		expect(got.map(g => g[0])).toEqual(["점검이 끝났어요. 스팸 차단은 정상이에요. 금요일까지 확인이 필요해요.", "목요일 회의를 금요일로 옮깁니다. 가능한지 알려 주세요.", null]);
		for (const g of got.slice(0, 2)) expect(g[1]).toBeLessThanOrEqual(60);
		if (SHOTS) {
			mkdirSync(SHOTS, { recursive: true });
			await v.evaluate(draw2);
			await Bun.write(`${SHOTS}/mail-list-derived-${width}.png`, await v.screenshot());
		}
	}, 30_000);

	// 초안 작성: the dialog shows the mail above the box, and the box's sample comes from the mail's summary (the fixed hint without one)
	test(`초안 작성 at ${width}px shows the mail and a sample made from its summary`, async () => {
		const v = await open(width);
		const got = JSON.parse((await v.evaluate(`(${draw}, JSON.stringify(["mail:fx-1", "mail:fx-4"].map(t => {
			mailDraftDialog(t, null);
			const d = document.querySelector("dialog[open]:not([data-leaving])"), r = [d.querySelector(".md-subj")?.textContent ?? null, d.querySelector('[data-k="draft-instruction"]').placeholder];
			const ta = d.querySelector('[data-k="draft-instruction"]'), cs = getComputedStyle(ta), px = d.querySelector(".dact .btn").getBoundingClientRect(), pd = d.querySelector(".dact").getBoundingClientRect();
			const cx = document.createElement("canvas").getContext("2d"); cx.font = cs.font;
			r.push(cx.measureText(ta.placeholder).width <= ta.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), px.width < pd.width / 2, Math.abs(px.right - pd.right) <= 24);
			d.close();
			return r;
		})))`)) as string) as [string | null, string][];
		expect(got[0][0]).toBe("월간 점검 보고서 확인 요청");
		expect(got[0][1]).toMatch(/^예: /);
		expect(got[0][1]).not.toMatch(/[‘’…]/);   // no clipped quote of the mail inside the sample
		expect(got[0][1]).not.toContain("비워 두면");
		expect(got[0].slice(2)).toEqual([true, true, true]);   // the sample fits one line; the one button keeps its own width at the footer's right end
		expect(got[1].slice(0, 2)).toEqual(["본문이 없는 메일", "예: 금요일까지 보내 드린다고 써 줘"]);
	}, 30_000);

	test(`the original view at ${width}px lists the attachments with name and size as download links`, async () => {
		const v = await open(width);
		const text = ["Alex Sender <sender@example.com> · 월간 점검 보고서", "", "요약", "점검이 끝났어요.", "", "원문", "안녕하세요. 점검 결과를 보냅니다.", "감사합니다."].join("\n");
		const drawOriginal = `(() => {
			cancelAnimationFrame(monRaf); window.renderMonitoring = () => {};
			const card = msgNode({ kind: "mail", ts: ${JSON.stringify(now)}, source: "fx", mail: "fx-1", conv: "mail:fx-1", subject: "월간 점검 보고서", from: "Alex Sender <sender@example.com>",
				attachments: [{ name: "점검보고서-2026-10.pdf", type: "application/pdf", size: 482113 }, { name: "차트.png", type: "image/png", size: 20480 }, { name: "아주-긴-파일-이름-아주-긴-파일-이름-아주-긴-파일-이름-아주-긴-파일-이름-2026.xlsx", type: "application/octet-stream", size: 3 }], text: ${JSON.stringify(text)} });
			document.querySelector("#mon-tl").replaceChildren(card);
			return true;
		})()`;
		const got = JSON.parse((await v.evaluate(`(${drawOriginal}, JSON.stringify((() => {
			const card = document.querySelector("#mon-tl > .bm.rc"), rows = [...card.querySelectorAll(".mr-file")];
			const noKey = msgNode({ kind: "mail", ts: ${JSON.stringify(now)}, source: "fx", subject: "첨부 없음", from: "A <a@example.com>", text: "A <a@example.com> · 첨부 없음" });
			return { head: card.querySelector(".mr-fh")?.textContent, links: rows.map(a => [a.getAttribute("href"), a.download, a.querySelector(".mr-fname").textContent, a.querySelector(".mr-fsize")?.textContent ?? null]),
				tap: rows.map(a => Math.round(a.getBoundingClientRect().height)), clipped: rows.map(a => a.scrollWidth <= a.clientWidth + 1), none: !noKey.querySelector(".mr-files"), over: document.documentElement.scrollWidth > innerWidth };
		})()))`)) as string) as any;
		expect(got.head).toBe("첨부 3개");
		expect(got.links).toEqual([["/api/mail/fx-1/files/0?dl=1", "점검보고서-2026-10.pdf", "점검보고서-2026-10.pdf", "471KB"], ["/api/mail/fx-1/files/1?dl=1", "차트.png", "차트.png", "20KB"], ["/api/mail/fx-1/files/2?dl=1", "아주-긴-파일-이름-아주-긴-파일-이름-아주-긴-파일-이름-아주-긴-파일-이름-2026.xlsx", "아주-긴-파일-이름-아주-긴-파일-이름-아주-긴-파일-이름-아주-긴-파일-이름-2026.xlsx", "3B"]]);
		for (const h of got.tap) expect(h).toBeGreaterThanOrEqual(36); // a 36px chip; its ::after widens the hit area to 44px
		expect(got.clipped).toEqual([true, true, true]);
		expect(got.none).toBe(true);
		expect(got.over).toBe(false);
		if (SHOTS) {
			await v.evaluate(drawOriginal);
			await Bun.write(`${SHOTS}/mail-original-${width}.png`, await v.screenshot());
		}
	}, 30_000);
}

// A message about a mail the page does not hold (a deleted mail: its notice stays, its conversation leaves /api/conversations) is no card between the
// mail rows; every row of the list is a mail with ☐, ☆ and ⋯. A plain report that is not about a mail keeps its card.
test("a notice of a deleted mail is no control-less card in the mail list", async () => {
	const v = await open(390);
	const got = JSON.parse((await v.evaluate(`(() => {
		cancelAnimationFrame(monRaf); window.renderMonitoring = () => {};
		MON.filter = "all"; MON.mailFilter = "all";
		const at = ${JSON.stringify(now)};
		MAILS.set("mail:fx-1", { subject: "살아 있는 메일", from: "Kim <kim@example.com>", source: "fx", at });
		MAILS.delete("mail:gone-1");
		const notices = [
			{ id: "n-gone", kind: "watch", tone: "", title: "ACME운영팀", text: "[ACME운영팀] 일일 운영 소식", open: "mail:gone-1", src: "mail:gone-1", key: "mail:gone-1", ts: at, at, read: true, app: "mail" },
			{ id: "n-live", kind: "watch", tone: "", title: "Kim", text: "살아 있는 메일", open: "mail:fx-1", src: "mail:fx-1", ts: at, at, read: true, app: "mail" },
			{ id: "n-plain", kind: "watch", tone: "", title: "메일", text: "동기화가 끝났어요", ts: at, at, read: true, app: "mail" },
		];
		const nodes = monChronoNodes({ key: "mail", name: "메일", app: "mail", mails: ["mail:fx-1", "mail:gone-1"], notices }, []);
		document.querySelector("#mon-tl").replaceChildren(...nodes);
		const cards = [...document.querySelectorAll("#mon-tl > .bm")];
		return JSON.stringify({ nids: cards.map(c => c.dataset.nid || null).filter(Boolean), rows: cards.filter(c => c.classList.contains("mr")).map(c => [c.querySelector(".rc-title").textContent, !!c.querySelector(".mr-chk"), !!c.querySelector(".mr-star"), !!c.querySelector(".mr-more")]),
			gone: document.querySelector("#mon-tl").textContent.includes("ACME운영팀") });
	})()`)) as string) as any;
	expect(got.gone).toBe(false);
	expect(got.nids).toEqual(["n-plain"]);
	expect(got.rows).toEqual([["살아 있는 메일", true, true, true]]);
}, 30_000);
