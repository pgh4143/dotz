import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, deleteApp, removalPlan } from "./app-off.ts";
import { readSettings, writeSettings } from "./app-settings.ts";
import { appEntries, integrationAvailable, integrationContext, integrationItems } from "./integrations.ts";
import { fakeHub, json, waitFor, run, type View } from "./test-web.ts";

// App instances in the shipped web (web/js/30-monitoring.js, 30-mailboxes.js, 32-app-settings.js, 34-peer-monitoring.js): one mail row with an account per instance, the name
// field in the settings panel, 삭제 with its confirm in 앱 관리, and the same on a peer's apps. Headless Bun.WebView at 390px against a stub gateway whose
// integration, settings and app routes call the real hub code on a temp data dir. Screenshots go to the folder APP_INSTANCE_SHOTS names, if set.
const SHOTS = process.env.APP_INSTANCE_SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const data = mkdtempSync(join(tmpdir(), "app-inst-web-"));
const put = (rel: string, text: string) => { mkdirSync(join(data, rel, ".."), { recursive: true }); writeFileSync(join(data, rel), text); };
const appsFile = () => JSON.parse(readFileSync(join(data, "custom/apps.json"), "utf8"));
put("custom/apps.json", JSON.stringify({
	"mail-2": { app: "mail", label: "개인 메일", filter: { source: "naver" } },
	"mail-3": { app: "mail", label: "보조 메일", off: true, filter: { source: "daum", watches: ["webmail-daum"] } },
}));

const MINI = "http://mini.test";
const at = (min: number) => new Date(Date.UTC(2026, 9, 23, 3, min)).toISOString();
const note = (id: string, src: string, title: string, min: number, read = false) => ({ id, kind: "message", tone: "", title, text: title, open: src, src, ts: at(min), read });
const notices = [note("g1", "mail:gmail-1", "회의 일정 확인", 10), note("n1", "mail:naver-1", "택배 도착 안내", 20), note("n2", "mail:naver-2", "청구서 발송", 21)];
const MAIL_APP = { key: "mail", label: "회사 메일", icon: "mail", kind: "app", conv: ["mail:"], unread: 0, notices: [], needs: { drafts: 0, unread: 0, sentToday: 0 } };
const peers = [{
	name: "맥미니", url: MINI, online: true, stale: false,
	items: { name: "맥미니", rev: "r1", monitors: [], notices: [], integrations: [MAIL_APP], conversations: [],
		available: [{ key: "mail-5", app: "mail", label: "맥미니 둘째 메일", icon: "mail", off: true, conv: ["mail:x-"] }] },
}];

const acts: { action: string; args: Record<string, unknown> }[] = [];
let actWaiters: (() => void)[] = [];
const nextAct = () => new Promise<void>(r => actWaiters.push(r));
const calls: string[] = [];
const view = () => {
	const ctx = integrationContext(data, ["zele"]), items = integrationItems(ctx, notices, {});
	return { items, available: integrationAvailable(items, ctx) };
};
const names = () => ["webmail-daum"];
const hub = fakeHub({
	api: async (req, url) => {
		const p = url.pathname;
		if (p === "/api/peers") return json([{ name: "맥북", url: `${hub.origin}`, self: true, online: true }, { name: "맥미니", url: MINI, self: false, online: true }]);
		if (p === "/api/machine") return json({ name: "맥북", custom: "", default: "맥북" });
		if (p === "/api/monitoring/peers") return json(peers);
		if (p === "/api/notices") return json({ unread: 3, items: notices });
		if (p === "/api/monitors") return json({ items: [] });
		if (p === "/api/conversations") return json({ items: [] });
		if (p === "/api/integrations") return json(view());
		if (p === "/api/app-templates") return json({ items: [] });
		if (p === "/api/peer/proxy") {
			if (req.method === "POST") { acts.push((await req.json()) as (typeof acts)[number]); const w = actWaiters; actWaiters = []; for (const f of w) f(); return json({ ok: true }); }
			// A peer app's settings are read through the proxy (the `~hash` is stripped by the web app).
			if (url.searchParams.get("p") === "/api/integrations/mail/settings") return json({ key: "mail", fields: [{ key: "label", label: "앱 이름", type: "text", help: "", max: 30, switch: true, value: "회사 메일" }] });
			return json({});
		}
		if (p === "/api/apps" && req.method === "POST") return json({ ok: true, ...createApp(data, (await req.json()) as object) });
		const del = /^\/api\/apps\/([a-z0-9-]+)$/.exec(p);
		if (del && req.method === "DELETE") {
			calls.push(`DELETE ${p}${url.search}`);
			try { return json({ ok: true, removed: deleteApp(data, del[1]!, { deleteStored: url.searchParams.get("data") === "1" }, { watchNames: names, removeWatch: () => {} }) }); }
			catch (e) { return json({ error: (e as Error).message }, 409); }
		}
		const life = /^\/api\/integrations\/([a-z0-9-]+)\/remove$/.exec(p);
		if (life) return json(removalPlan(data, life[1]!, names()));
		const m = /^\/api\/integrations\/([a-z0-9-]+)\/settings$/.exec(p);
		if (m) {
			if (req.method === "PATCH") {
				const b = (await req.json()) as { values: unknown };
				calls.push(`PATCH ${m[1]} ${JSON.stringify(b.values)}`);
				return json({ key: m[1], fields: writeSettings(data, m[1]!, b.values) });
			}
			return json({ key: m[1], fields: readSettings(data, m[1]!) });
		}
		if (p === "/api/history") return json({ target: url.searchParams.get("target"), events: [] });
	},
});

afterAll(() => { hub.stop(); rmSync(data, { recursive: true, force: true }); });
const q = async <T = unknown>(v: View, code: string): Promise<T> => JSON.parse((await v.evaluate(`JSON.stringify((() => { ${code} })())`)) as string) as T;
const shot = async (v: View, name: string) => { if (SHOTS) { await waitFor(v, `document.getAnimations().every(a => a.playState !== "running")`); await Bun.write(join(SHOTS, name), await v.screenshot()); } };
const rowOf = (key: string) => `[...document.querySelectorAll("#mon-side .cv-row")].find(r => r.dataset.k === ${JSON.stringify(key)})`;
// The options live in the settings screen the conversation's ⋯ button pushes; `#app-sw` exists only while it is open.
const openScreen = async (v: View, app = "") => {
	const more = `[...document.querySelectorAll("[data-as-more]")].find(b => b.offsetParent && !b.hidden && (!${JSON.stringify(app)} || b.dataset.asMore === ${JSON.stringify(app)}))`;
	await waitFor(v, more);
	await run(v, `${more}.click()`);
	await waitFor(v, `document.querySelector("#app-sw .as-row")`);
};
const closeScreen = async (v: View) => {
	await run(v, `const b = document.querySelector('[data-k="as-back"]'); if (b) b.click()`);
	await waitFor(v, `!document.querySelector("#app-sw")`);
};
const boot = async (): Promise<View> => {
	const v = await hub.view({ width: 390, height: 844 });
	await v.navigate(`${hub.origin}/`);
	await waitFor(v, `S && NM.loaded && NT.loaded && PR.fresh && INTG.items.length`);
	await run(v, `if (dotzTheme.get() === "dark") dotzTheme.toggle()`);
	await run(v, `go("monitoring")`);
	await waitFor(v, `PQ.loaded && INTG.items.some(i => i.key === "mail-2") && ${rowOf("i:mail")}`);
	return v;
};

describe("앱 인스턴스 at 390px", () => {
	test("one mail row for both instances; each account shows its own source's items only", async () => {
		const v = await boot();
		expect(appEntries(data).filter(e => e.app === "mail").map(e => e.key)).toEqual(["mail", "mail-2", "mail-3"]);
		const names = await q<string[]>(v, `return [...document.querySelectorAll("#mon-side .cv-row")].filter(r => /^i:mail/.test(r.dataset.k) && !r.dataset.k.includes("|")).map(r => r.dataset.k + "=" + r.querySelector(".cv-n").textContent)`);
		expect(names).toEqual(["i:mail=메일"]);
		// the unread count is the row's own number; the line under the name does not say it again
		expect(await q(v, `return ${rowOf("i:mail")}.querySelector(".nb:not(.unreplied)").textContent`)).toBe("3");
		expect(await q(v, `return ${rowOf("i:mail")}.querySelector(".cv-b").textContent`)).not.toContain("안 읽음");   // the name and its line (the line is absent when there is nothing but the count to say)
		await shot(v, "01-one-mail-row.png");
		await run(v, `go("monitoring", "i:mail/mail-2/all")`);
		await waitFor(v, `MON.sel === "i:mail" && MX.acct === "mail-2" && document.querySelector("#mon-tl .rc")`);
		const second = await q<string[]>(v, `return [...document.querySelectorAll("#mon-tl .rc .rc-title")].map(t => t.textContent)`);
		expect(second.sort()).toEqual(["청구서 발송", "택배 도착 안내"]);
		expect(await q(v, `return monName()`)).toBe("메일");
		await run(v, `go("monitoring", "i:mail/mail/all")`);
		await waitFor(v, `MX.acct === "mail" && document.querySelectorAll("#mon-tl .rc").length === 1`);
		expect(await q(v, `return [...document.querySelectorAll("#mon-tl .rc .rc-title")].map(t => t.textContent)`)).toEqual(["회의 일정 확인"]);
	}, 20_000);

	test("the settings panel has a name field; changing it PATCHes label and the row, the detail title and the sheet show the new name", async () => {
		const v = await boot();
		await run(v, `go("monitoring", "i:mail/mail-2/all")`);
		await waitFor(v, `document.querySelector("#as-bar:not([hidden]), #mon-head .as-hd")`);
		await run(v, `document.querySelector("#as-bar:not([hidden]), #mon-head .as-hd").click()`);
		await waitFor(v, `target === "settings:mail-2"`);
		expect(await q(v, `return document.querySelector("#app-sw")`)).toBe(null);
		await openScreen(v, "mail-2");
		await waitFor(v, `document.querySelector('#app-sw [data-k="label"]')`);
		expect(await q(v, `return document.querySelector('#app-sw [data-k="label"]').value`)).toBe("개인 메일");
		await shot(v, "02-rename-field.png");
		await run(v, `const i = document.querySelector('#app-sw [data-k="label"]'); i.value = "회사 보조"; i.dispatchEvent(new Event("change"))`);
		await waitFor(v, `INTG.items.some(i => i.key === "mail-2" && i.label === "회사 보조")`);
		expect(calls.filter(c => c.startsWith("PATCH mail-2"))).toEqual([`PATCH mail-2 {"label":"회사 보조"}`]);
		expect(appsFile()["mail-2"].label).toBe("회사 보조");
		await closeScreen(v);
		await run(v, `go("monitoring", "i:mail/mail-2/all")`);
		await waitFor(v, `MX.accts.get("mail-2").label === "회사 보조"`);
	}, 20_000);

	test("앱 관리 lists the off instance with 다시 켜기 and 삭제; 삭제 opens a confirm, 취소 closes it, 삭제 확인 deletes it for good", async () => {
		const v = await boot();
		await run(v, `asAddSheet()`);
		await waitFor(v, `document.querySelector('[data-k="del:mail-3"]')`);
		expect(await q(v, `return !!document.querySelector('[data-k="on:mail-3"]') && !document.querySelector('[data-k="del:mail-2"]')`)).toBe(true);
		// the request box has its own section label above it, the off apps another; 맡기기 waits for text; 삭제 is the red row action
		expect(await q(v, `return document.querySelectorAll(".as-sec").length`)).toBe(2);
		expect(await q(v, `return document.querySelector('.fs-body > .as-sec:first-child + textarea') !== null && document.querySelector('[data-k="new-app"]').disabled`)).toBe(true);
		expect(await q(v, `return document.querySelector('[data-k="del:mail-3"]').classList.contains("danger")`)).toBe(true);
		await run(v, `document.querySelector('[data-k="del:mail-3"]').click()`);
		await waitFor(v, `document.querySelector('[data-k="del-confirm"] [data-k="del-go"]')`);
		expect(await q(v, `const b = document.querySelector('[data-k="del-go"]'); return b.classList.contains("danger") && b.classList.contains("fill") && !document.querySelector('[data-k="del-confirm"]').textContent.includes("(\uB97C)")`)).toBe(true);
		await waitFor(v, `document.querySelector('[data-k="del-confirm"]').textContent.includes("webmail-daum")`);
		await shot(v, "03-delete-confirm.png");
		await run(v, `document.querySelector('[data-k="del-cancel"]').click()`);
		await waitFor(v, `!document.querySelector('[data-k="del-confirm"]')`);
		expect(appsFile()["mail-3"]).toBeDefined();
		await run(v, `document.querySelector('[data-k="del:mail-3"]').click()`);
		await waitFor(v, `document.querySelector('[data-k="del-go"]')`);
		await run(v, `document.querySelector('[data-k="del-go"]').click()`);
		await waitFor(v, `!document.querySelector('[data-k="del:mail-3"]')`);
		expect(calls).toContain("DELETE /api/apps/mail-3");
		expect(appsFile()["mail-3"]).toBeUndefined();
		expect(existsSync(join(data, "custom/apps.json"))).toBe(true);
	}, 20_000);

	test("a peer's off instance is deleted through /api/peer/act, labeled with the machine; its name changes the same way", async () => {
		const v = await boot();
		await run(v, `asAddSheet()`);
		await waitFor(v, `document.querySelector('[data-k="del:mail-5"]')`);
		expect(await q(v, `return document.querySelector('[data-app="mail-5"] .as-h').textContent`)).toContain("맥미니");
		await run(v, `document.querySelector('[data-k="del:mail-5"]').click()`);
		await waitFor(v, `document.querySelector('[data-k="del-go"]')`);
		await run(v, `document.querySelector('[data-k="delete-data"]').click()`);
		await run(v, `document.querySelector('[data-k="del-go"]').click()`);
		await waitFor(v, `!document.querySelector('[data-k="del-confirm"]')`);
		expect(acts).toEqual([{ action: "app", args: { op: "delete", app: "mail-5", deleteData: true } }]);
		acts.length = 0;
		await run(v, `go("monitoring", ${JSON.stringify(`p:${MINI}|i:mail`)})`);
		await waitFor(v, `document.querySelector("#as-bar:not([hidden]), #mon-head .as-hd[data-as-open]")`);
		expect(await q(v, `return document.querySelector("#mon-tl .as-name")`)).toBe(null);
		await run(v, `document.querySelector("#as-bar:not([hidden]), #mon-head .as-hd[data-as-open]").click()`);
		await waitFor(v, `/^settings:mail~[a-z0-9]+$/.test(target)`);
		await openScreen(v);
		await waitFor(v, `document.querySelector('#app-sw [data-k="label"]')`);
		const sent = nextAct();
		await run(v, `const i = document.querySelector('#app-sw [data-k="label"]'); i.value = "맥미니 회사"; i.dispatchEvent(new Event("change"))`);
		await sent;
		expect(acts).toEqual([{ action: "app", args: { op: "settings", app: "mail", values: { label: "맥미니 회사" } } }]);
	}, 20_000);
});

describe("removal plan of an added instance", () => {
	test("제거 of mail-2 never disables the shared feature, so mail keeps working", () => {
		expect(removalPlan(data, "mail-2", names())!.features).toEqual([]);
	});
});
