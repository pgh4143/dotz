import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { featuresOf, ownedWatches, retryInternal, setFeature } from "./app-features.ts";
import { readSettings, writeSettings } from "./app-settings.ts";
import type { Watch } from "./watch.ts";
import { fakeHub, json, waitFor, run, type View } from "./test-web.ts";

// The instagram app's ⋯ settings screen in a headless Bun.WebView against a stub gateway whose feature routes call the real hub code: 기능 with switches
// above 설정, 내부 기능 with a status dot and 다시 시도, and none of the app's watches as a row of 일반 모니터링. Screenshots are written only when
// SETTINGS_SHOTS names a folder. Names are placeholders.
const SHOTS = process.env.SETTINGS_SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const data = mkdtempSync(join(tmpdir(), "af-web-"));
mkdirSync(join(data, "custom/sns"), { recursive: true });
writeFileSync(join(data, "custom/sns/config.json"), JSON.stringify({ instagram: {} }));

const RUN = "2026-10-23T03:00:00.000Z";
const watch = (name: string, extra: Partial<Watch> = {}, state: Partial<Watch["state"]> = {}): Watch => ({ name, command: "true", every_minutes: 60, state: { fails: 0, lastRun: RUN, ...state }, ...extra }) as unknown as Watch;
const WATCHES = [
	watch("sns-ig-comments"),
	watch("ig-site-login", { session: { url: "https://www.instagram.com/", refresh_hours: 6 } }, { fails: 2, last: "session expired", kind: "auth" }),
	watch("plain-disk-check"),
];
const LABEL: Record<string, string> = { "sns-ig-comments": "댓글 확인", "ig-site-login": "사이트 로그인", "plain-disk-check": "디스크 점검" };
const monitors = WATCHES.map(w => ({ name: LABEL[w.name], watch: w.name, kind: "watch", every: "60분마다", last_run: RUN, last_result: w.state.fails ? "fail" : "ok", fails: w.state.fails, ...(w.session ? { keeper: true } : {}) }));
const NOTICES = [{ id: "n-ig", title: "릴스 올리기 승인 (j-1)", text: "인스타 릴스 영상이에요", ts: RUN, decision: { state: "open", to: "main", draft: { to: "x", body: "주말 여행 릴스예요 #여행" }, options: [{ n: 1, label: "올리기" }, { n: 2, label: "고치기" }, { n: 3, label: "그만두기" }] } }];
const answers: { id: string; body: unknown }[] = [];

// A raw key, an id like j-1 or a snake_case word in what the owner reads.
const RAW = /[a-z]+-[0-9]|_|\b(?:sns|ig|yt|each|batch|comments)\b/;
const featPatches: Record<string, unknown>[] = [];
const watchPatches: { watch: string; values: unknown }[] = [];
const retries: string[] = [];
let onRetry: (() => void) | undefined;
const hub = fakeHub({
	stream: "fake",
	api: async (req, url) => {
		const p = url.pathname;
		if (p === "/api/history") return json({ target: url.searchParams.get("target"), events: [] });
		if (p === "/api/activity") return json({ items: [], more: false, history: false });
		if (p === "/api/conversations") return json({ items: [] });
		if (p === "/api/notices") return json({ unread: 0, items: [] });
		if (p === "/api/monitors") return json({ items: monitors });
		if (p === "/api/integrations") {
			const own = ownedWatches(data, WATCHES);
			return json({ items: [{ key: "instagram", label: "인스타그램", icon: "instagram", kind: "app", conv: [], notices: [], needs: { drafts: 1, unread: 0, sentToday: 0 }, watches: ["sns-ig-"], own: own.get("instagram") ?? [] }, { key: "mail", label: "메일", icon: "mail", kind: "app", conv: [], notices: [], needs: { drafts: 0, unread: 0, sentToday: 0 }, watches: [], own: [] }], available: [] });
		}
		const an = /^\/api\/notices\/([^/]+)\/answer$/.exec(p);
		if (an && req.method === "POST") {
			answers.push({ id: an[1]!, body: await req.json() });
			return json({ ok: true });
		}
		const ws = /^\/api\/watches\/([a-z0-9-]+)\/settings$/.exec(p);
		if (ws && req.method === "PATCH") { watchPatches.push({ watch: ws[1]!, values: ((await req.json()) as { values: unknown }).values }); return json({ key: `w:${ws[1]}`, fields: [] }); }
		if (ws) return json({ key: `w:${ws[1]}`, fields: [] });
		const f = /^\/api\/integrations\/([a-z0-9-]+)\/(features|retry)$/.exec(p);
		if (f) {
			try {
				if (f[2] === "features" && req.method === "PATCH") {
					const b = (await req.json()) as { id: string; on: boolean };
					featPatches.push(b);
					setFeature(data, f[1]!, b.id, b.on);
				}
				if (f[2] === "retry") {
					const b = (await req.json()) as { watch: string };
					await retryInternal(data, f[1]!, b.watch, WATCHES, async n => { retries.push(n); onRetry?.(); });
				}
				return json(featuresOf(data, f[1]!, WATCHES, NOTICES));
			} catch (e) {
				return json({ error: (e as Error).message }, 400);
			}
		}
		const m = /^\/api\/integrations\/([a-z0-9-]+)\/settings$/.exec(p);
		if (m) {
			if (req.method === "PATCH") return json({ key: m[1], fields: writeSettings(data, m[1]!, ((await req.json()) as { values: unknown }).values) });
			return json({ key: m[1], fields: readSettings(data, m[1]!) });
		}
	},
});

const open = (width: number, height: number): Promise<View> => hub.view({ width, height });
afterAll(() => { hub.stop(); rmSync(data, { recursive: true, force: true }); });

const q = async <T = unknown>(v: View, code: string): Promise<T> => JSON.parse((await v.evaluate(`JSON.stringify((() => { ${code} })())`)) as string) as T;
const shot = async (v: View, name: string) => { if (SHOTS) await waitFor(v, `document.getAnimations().every(a => a.playState !== "running")`); if (SHOTS) await Bun.write(join(SHOTS, name), await v.screenshot()); };
const boot = async (v: View, route: string) => {
	const opened = hub.nextStream();
	await v.navigate(`${hub.origin}/`);
	await opened;
	await waitFor(v, `typeof NT !== "undefined" && NT.loaded && S`);
	await run(v, `if (dotzTheme.get() === "dark") dotzTheme.toggle()`);
	await run(v, `go("monitoring", ${JSON.stringify(route)})`);
};
const openScreen = async (v: View) => {
	const more = `[...document.querySelectorAll('[data-as-more="instagram"]')].find(b => b.offsetParent && !b.hidden)`;
	await waitFor(v, more);
	await run(v, `${more}.click()`);
	await waitFor(v, `document.querySelector("#app-sw [data-feature]") && document.querySelector("#app-sw [data-internal]")`);
};

const suite = (label: string, width: number, height: number, tag: string) => describe(`instagram ⋯ settings at ${label}`, async () => {
	const v = await open(width, height);

	test("the app's watches are not rows of 일반 모니터링; the unrelated one is", async () => {
		await boot(v, "i:instagram");
		await waitFor(v, `monItems().some(i => i.key === "i:instagram")`);
		expect(await q(v, `return monItems().filter(i => i.group === MON_GROUP.plain).map(i => i.name)`)).toEqual(["디스크 점검"]);
		expect(await q(v, `return monItems().find(i => i.key === "i:instagram").owned.map(m => m.watch).sort()`)).toEqual(["ig-site-login", "sns-ig-comments"]);
		expect(await q(v, `return monItems().find(i => i.key === "i:instagram").badge`)).toEqual(["실패", "err"]);
	});

	test("연결 상태 first, then one control per concept in sections: 자동 초안과 승인, 감시, 기타 기능, 고급; 숨긴 기능 are not drawn", async () => {
		await openScreen(v);
		expect(await q(v, `return { conn: document.querySelector("#app-sw").firstElementChild.dataset.conn, secs: [...document.querySelectorAll("#app-sw [data-sec]")].map(e => e.dataset.sec) }`)).toEqual({ conn: "connected", secs: ["notify", "draft", "watch", "more", "advanced"] });
		// comment_reply's switch IS the auto_draft setting: the screen draws the setting row once and no second feature row.
		expect(await q(v, `return [...document.querySelectorAll("#app-sw [data-feature]")].map(e => e.dataset.feature)`)).toEqual(["reels_approval", "dm_read"]);
		expect(await q(v, `return [...document.querySelectorAll('#app-sw [data-setting="auto_draft"]')].length`)).toBe(1);
		expect(await q(v, `return document.querySelector('#app-sw [data-feature="reels_approval"] .as-h').textContent`)).toContain("1");
		expect(await q(v, `return document.body.textContent.includes("DM 답장") || document.body.textContent.includes("게시물 정보 수정")`)).toBe(false);
		// The internal watches (감시) and the settings rows are each drawn once, under their own heading.
		expect(await q(v, `const sec = [...document.querySelectorAll("#app-sw [data-sec]")].pop(); return sec.dataset.sec === "advanced" && sec.nextElementSibling.querySelector('[data-k="use_here"]') !== null`)).toBe(true);
		// One row per watch: the status row and the internal row are the same element.
		expect(await q(v, `return [...document.querySelectorAll("#app-sw .as-stat")].map(e => [e.dataset.watch, e.dataset.internal ?? null])`)).toEqual([["sns-ig-comments", "sns-ig-comments"], ["ig-site-login", "ig-site-login"]]);
		await shot(v, `${tag}-settings-top.png`);
	});

	test("the login keeper and the sync are internal rows: dot, last run, the failure in Korean, 다시 시도", async () => {
		const rows = await q<{ id: string; kind: string; dot: string; text: string }[]>(v, `return [...document.querySelectorAll("#app-sw [data-internal]")].map(e => ({ id: e.dataset.internal, kind: e.dataset.kind, dot: e.querySelector(".as-dot").className.replace("as-dot ", ""), text: e.textContent }))`);
		expect(rows.map(r => [r.id, r.kind, r.dot])).toEqual([["sns-ig-comments", "sync", "ok"], ["ig-site-login", "login", "fail"]]);
		expect(rows[1]!.text).toContain("로그인 유지");
		expect(rows[1]!.text).toContain("마지막 확인");
		expect(rows[1]!.text).toContain("이유:");
		// The monitor's facts ride on the same row (마지막 확인 / 다음 확인), so the panel needs no second status row.
		expect(rows[0]!.text).toContain("마지막 확인");
		const before = retries.length, ran = new Promise<void>(r => (onRetry = r));
		await run(v, `document.querySelector('#app-sw [data-k="retry:ig-site-login"]').click()`);
		await ran;
		expect(retries.slice(before)).toEqual(["ig-site-login"]);
		await run(v, `document.querySelector("#app-sw [data-internal='ig-site-login']").scrollIntoView({ block: "center" })`);
		await shot(v, `${tag}-settings-internal.png`);
	});

	test("감시 주기 on an owned watch edits its settings route (the same write path as the monitor's own screen)", async () => {
		await waitFor(v, `document.querySelector('#app-sw [data-k="every:sns-ig-comments"]') && !AS.busy.instagram`);
		const before = watchPatches.length;
		await run(v, `const i = document.querySelector('#app-sw [data-k="every:sns-ig-comments"]'); i.value = "30"; i.dispatchEvent(new Event("change"))`);
		await waitFor(v, `!AS.busy.instagram`);
		expect(watchPatches.slice(before)).toEqual([{ watch: "sns-ig-comments", values: { every_minutes: 30 } }]);
	});

	test("a feature switch PATCHes the features route and persists in custom/apps.json", async () => {
		const before = featPatches.length;
		await waitFor(v, `!AS.busy.instagram`);
		await run(v, `document.querySelector('#app-sw [data-k="feat:reels_approval"]').click()`);
		await waitFor(v, `document.querySelector('#app-sw [data-k="feat:reels_approval"]').getAttribute("aria-checked") === "false"`);
		expect(featPatches.slice(before)).toEqual([{ id: "reels_approval", on: false }]);
		expect(JSON.parse(readFileSync(join(data, "custom/apps.json"), "utf8")).instagram.features).toEqual({ reels_approval: false });
		expect(await q(v, `return document.querySelector('#app-sw [data-feature="reels_approval"] .as-h')`)).toBeNull();   // the switch says off; no line repeats it
		await run(v, `document.querySelector('#app-sw [data-k="feat:reels_approval"]').click()`);
		await waitFor(v, `document.querySelector('#app-sw [data-k="feat:reels_approval"]').getAttribute("aria-checked") === "true"`);
	});

	test("the screen says no internal key or id; the approval is its caption; the approval mode and 답장 모델 are setting rows", async () => {
		const text = await q<string>(v, `return document.querySelector("#app-sw").textContent`);
		expect(text).not.toMatch(RAW);
		expect(text).toContain("댓글 가져오기");
		expect(text).toContain("인스타그램 로그인");
		expect(await q(v, `return document.querySelector("#app-sw [data-approval] .as-n").textContent`)).toBe("주말 여행 릴스예요 #여행");
		expect(await q(v, `return [...document.querySelectorAll("#app-sw [data-approval] [data-k^='appr:']")].map(b => b.textContent)`)).toEqual(["올리기", "그만두기", "자세히"].slice(0, 2).concat(["자세히"]));
		expect(await q(v, `return document.querySelector("#app-sw .as-chip, #app-sw .as-sum")`)).toBeNull();
		expect(await q(v, `return !!document.querySelector('#app-sw [data-setting="approval"] .as-n')`)).toBe(true);
		expect(await q(v, `return document.querySelectorAll('#app-sw [data-setting="approval"] .as-seg button').length`)).toBe(2);
		expect(await q(v, `return !!document.querySelector('#app-sw [data-setting="reply_model"] .as-n')`)).toBe(true);
		await run(v, `document.querySelector('#app-sw [data-setting="approval"]').scrollIntoView({ block: "center" })`);
		await shot(v, `${tag}-instagram-settings.png`);
	});

	test("an approval row answers from the row (not 고치기) through the notice's answer route", async () => {
		const before = answers.length;
		await run(v, `document.querySelector("#app-sw [data-approval] [data-k='appr:그만두기']").click()`);
		await waitFor(v, `!AS.busy.instagram`);
		expect(answers.slice(before)).toEqual([{ id: "n-ig", body: { n: 3, label: "그만두기" } }]);
	});

	test("a peer app's approval answer is forwarded as the peer's own decision (/api/peer/act answer)", async () => {
		const a = await q<{ action: string; args: unknown }>(v, `const app = pqApp("instagram", { name: "맥미니", url: "http://mini.test" }); const r = pqAct("/api/integrations/" + app + "/approve", { id: "n-9", n: 1 }); return { action: r.action, args: r.args, pc: r.pc.name }`);
		expect(a).toMatchObject({ action: "answer", args: { id: "n-9", n: 1 }, pc: "맥미니" });
	});

	test("mail settings: 새 메일 under 알림 and one 자동 초안 control (the setting, not a second feature switch)", async () => {
		await boot(v, "i:mail");
		const more = `[...document.querySelectorAll('[data-as-more="mail"]')].find(b => b.offsetParent && !b.hidden)`;
		await waitFor(v, more);
		await run(v, `${more}.click()`);
		await waitFor(v, `document.querySelector("#app-sw [data-setting='auto_draft']") && document.querySelector("#app-sw [data-feature]")`);
		expect(await q(v, `return [...document.querySelectorAll("#app-sw [data-feature]")].map(e => e.querySelector(".as-n").textContent)`)).toEqual(["새 메일"]);
		expect(await q(v, `return document.querySelector('#app-sw [data-sec="notify"]').nextElementSibling.dataset.setting`)).toBe("notify");   // 새 소식 알림 opens 알림, then 휴대폰 알림, then 새 메일
		expect(await q(v, `return document.querySelector('#app-sw [data-sec="notify"]').nextElementSibling.nextElementSibling.dataset.setting`)).toBe("push");
		expect(await q(v, `return document.querySelector('#app-sw [data-sec="notify"]').nextElementSibling.nextElementSibling.nextElementSibling.dataset.feature`)).toBe("new_mail");
		expect(await q<string>(v, `return document.querySelector("#app-sw").textContent`)).not.toMatch(RAW);
		await shot(v, `${tag}-mail-settings.png`);
	});
});

suite("390px", 390, 844, "phone");
suite("1280px", 1280, 800, "desktop");
