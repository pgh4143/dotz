import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { PAIR_HTML, PAIR_JS } from "./pair-page.ts";
import { qrPath } from "./qr.ts";
import { ev, fakeHub, fixPageNow, json, run, waitFor, type View } from "./test-web.ts";

// 설정 → 연결된 기기 (패스키) against a stub gateway (headless Bun.WebView): the list with the 이 기기 badge, rename, unpair with its
// confirmation, and a code made on screen. The stub keeps what PATCH and DELETE change, like hub/devices.ts. Screenshots go to SHOTS.
const SHOTS = process.env.PASSKEY_SHOTS ?? "/tmp/passkey-shots";
mkdirSync(SHOTS, { recursive: true });

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-02T12:00:00Z");
const at = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString();
// What 설정 itself asks for: an update status, and no account rotation here.
const update = (url: URL) => {
	if (url.pathname === "/api/accounts") return json({ error: "없음" }, 404);
	if (url.pathname !== "/api/update") return undefined;
	const c = { sha: "a".repeat(40), short: "a".repeat(7), date: new Date(0).toISOString() };
	return json({ running: { kind: "git", branch: "main", commit: c }, disk: { kind: "git", branch: "main", commit: c }, settings: { auto_check: false, auto_apply: false, at: "09:00" }, busy: [] });
};
const initial = () => [
	{ id: "cred-mac", name: "MacBook Safari", created: at(40), last_used: at(0.01), current: true },
	{ id: "cred-phone", name: "iPhone", created: at(12), last_used: at(2), current: false },
	{ id: "cred/old", name: "회사 PC", created: at(90), last_used: null, current: false },
];
let devices = initial();
const calls: string[] = [];

const QR = qrPath("https://dotz.example.com/pair#code=482913")!;
const hub = fakeHub({
	api: async (req, url) => {
		const p = url.pathname;
		if (p === "/api/update" || p === "/api/accounts") return update(url);
		if (p === "/api/devices" && req.method === "GET") return json(devices);
		if (p === "/api/devices/code" && req.method === "POST") {
			calls.push("POST code");
			return json({ code: "482913", minutes: 10, url: "https://dotz.example.com/pair", qr: QR });
		}
		const m = /^\/api\/devices\/([^/]+)$/.exec(p);
		if (m) {
			const id = decodeURIComponent(m[1]!);
			if (req.method === "DELETE") {
				calls.push(`DELETE ${id}`);
				devices = devices.filter(d => d.id !== id);
				return json({ ok: true });
			}
			if (req.method === "PATCH") {
				const b = (await req.json()) as { name: string };
				calls.push(`PATCH ${id} ${b.name}`);
				devices = devices.map(d => (d.id === id ? { ...d, name: b.name } : d));
				return json(devices.find(d => d.id === id));
			}
		}
	},
});
const plain = fakeHub({ api: (_req, url) => update(url) });
afterAll(() => (hub.stop(), plain.stop()));

const open = async (width: number, height: number, theme: "light" | "dark" = "light"): Promise<View> => {
	const v = await hub.view({ width, height }, "/");
	await waitFor(v, `typeof go === "function" && typeof S !== "undefined" && S`);
	await fixPageNow(v, NOW);
	await run(v, `document.documentElement.dataset.theme = ${JSON.stringify(theme)}; go("devices")`);
	await waitFor(v, `document.querySelectorAll("#devices [data-dev]").length === ${devices.length}`);
	return v;
};
const click = (v: View, sel: string) => run(v, `document.querySelector(${JSON.stringify(sel)}).click()`);
const top = `[...document.querySelectorAll("dialog[open]")].at(-1)`;
const press = (v: View, label: string) => run(v, `[...${top}.querySelectorAll(".btn")].filter(b => b.offsetParent).find(b => b.textContent === ${JSON.stringify(label)}).click()`);

describe("연결된 기기 설정 화면", () => {
	test("on a phone each device's line under the name stays on one line", async () => {
		devices = initial();
		const v = await open(390, 844);
		expect(await ev<number[]>(v, `[...document.querySelectorAll("#devices [data-dev] .sup")].map(s => { const r = document.createRange(); r.selectNodeContents(s); return new Set([...r.getClientRects()].map(x => Math.round(x.top))).size; })`)).toEqual([1, 1, 1]);
	});

	test("the list shows each device with its dates, and 이 기기 on the current one", async () => {
		devices = initial();
		const v = await open(1280, 800);
		const rows = await ev<{ id: string; name: string; current: boolean; sup: string }[]>(v, `[...document.querySelectorAll("#devices [data-dev]")].map(r => ({ id: r.dataset.dev, name: r.querySelector(".hd").textContent, current: !!r.querySelector("[data-current]"), sup: r.querySelector(".sup").textContent }))`);
		expect(rows.map(r => [r.id, r.name, r.current])).toEqual([["cred-mac", "MacBook Safari", true], ["cred-phone", "iPhone", false], ["cred/old", "회사 PC", false]]);
		expect(rows[1]!.sup).toContain("마지막 사용 2일 전");
		expect(rows[2]!.sup).toContain("아직 쓰지 않음");
		expect(await ev(v, `[!!document.querySelector("#devices [data-dev-new]"), !!document.querySelector("#devices [data-dev-self]")]`)).toEqual([true, false]);
	});

	test("설정 links to it only where the gateway keeps paired devices", async () => {
		const row = `[...document.querySelectorAll("#settings .li")].find(x => x.querySelector(".hd")?.textContent === "연결된 기기")`;
		const v = await hub.view({ width: 1280, height: 800 }, "/");
		await waitFor(v, `typeof go === "function" && S`);
		await run(v, `go("settings")`);
		await waitFor(v, `(() => { const r = ${row}; if (r) r.click(); return !!r; })()`);
		await waitFor(v, `current === "devices"`);
		const w = await plain.view({ width: 1280, height: 800 }, "/");
		await waitFor(w, `typeof go === "function" && S`);
		await run(w, `go("settings")`);
		await waitFor(w, `DEV.asked && !DEV.items && document.querySelectorAll("#settings .li .hd").length > 3`);
		expect(await ev(w, `!!${row}`)).toBe(false);
	});

	test("rename sends the new name and the list shows it", async () => {
		devices = initial();
		calls.length = 0;
		const v = await open(1280, 800);
		await click(v, '#devices [data-dev="cred-phone"]');
		await waitFor(v, `document.querySelector('dialog[open] input[name="dev-name"]')`);
		await run(v, `const i = document.querySelector('dialog[open] input[name="dev-name"]'); i.value = "  아이폰 15 "; i.dispatchEvent(new Event("input", { bubbles: true }))`);
		await press(v, "저장");
		await waitFor(v, `document.querySelector('#devices [data-dev="cred-phone"] .hd').textContent === "아이폰 15"`);
		expect(calls).toEqual(["PATCH cred-phone 아이폰 15"]);
	});

	test("the name window is a bottom sheet on a phone and the same centered card as before on a PC", async () => {
		devices = initial();
		const rect = async (w: number, h: number) => {
			const v = await open(w, h);
			await click(v, '#devices [data-dev="cred-phone"]');
			await waitFor(v, `${top} && ${top}.getAnimations().length === 0`);
			return ev<{ x: number; y: number; w: number; h: number; btn: number; field: string; sheet: string }>(v, `(() => { const r = ${top}.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, btn: Math.min(...[...${top}.querySelectorAll(".dact .btn")].map(b => b.getBoundingClientRect().height)), field: getComputedStyle(${top}.querySelector("input")).backgroundColor, sheet: getComputedStyle(${top}).backgroundColor }; })()`);
		};
		const pc = await rect(1280, 800), ph = await rect(390, 844);
		// the PC numbers are the ones this window had before it became a sheet
		expect({ x: pc.x, y: pc.y, w: pc.w, h: pc.h, btn: pc.btn }).toEqual({ x: 430, y: 276, w: 420, h: 248, btn: 36 });
		expect(ph.y).toBeGreaterThan(300);   // the sheet is as tall as its content, not the whole screen
		expect(ph.y + ph.h).toBe(844);
		expect(ph.btn).toBeGreaterThanOrEqual(44);
		// the name field shows as a field: its fill is not the sheet's own colour
		expect(ph.field).not.toBe(ph.sheet);
		expect(pc.field).not.toBe(pc.sheet);
	});

	test("unpair asks first; for this device it warns about the logout, for another it removes the row", async () => {
		devices = initial();
		calls.length = 0;
		const v = await open(390, 844);
		await click(v, '#devices [data-dev="cred-mac"]');
		await waitFor(v, `document.querySelector('dialog[open] input[name="dev-name"]')`);
		await press(v, "해제");
		await waitFor(v, `document.querySelectorAll("dialog[open]").length === 1 && ${top}.textContent.includes("기기 해제")`);
		expect(await ev<string>(v, `${top}.textContent`)).toContain("로그아웃");
		await press(v, "취소");
		await waitFor(v, `document.querySelectorAll("dialog[open]").length === 1 && !${top}.textContent.includes("기기 해제")`);
		// the window closes by its ✕ alone: no second 닫기 button
		expect(await ev<number>(v, `[...${top}.querySelectorAll(".btn")].filter(b => b.textContent === "닫기").length`)).toBe(0);
		await run(v, `${top}.querySelector('[aria-label="닫기"]').click()`);
		await waitFor(v, `document.querySelectorAll("dialog[open]").length === 0`);
		expect(calls).toEqual([]);
		await click(v, '#devices [data-dev="cred/old"]');
		await waitFor(v, `document.querySelector('dialog[open] input[name="dev-name"]')`);
		await press(v, "해제");
		await waitFor(v, `document.querySelectorAll("dialog[open]").length === 1 && ${top}.textContent.includes("기기 해제")`);
		expect(await ev<string>(v, `${top}.textContent`)).not.toContain("로그아웃");
		await press(v, "해제");
		await waitFor(v, `document.querySelectorAll("#devices [data-dev]").length === 2`);
		expect(calls).toEqual(["DELETE cred/old"]);
	});

	test("새 기기 연결 explains the flow and shows a code made on screen", async () => {
		devices = initial();
		calls.length = 0;
		const v = await open(1280, 800);
		await click(v, "#devices [data-dev-new]");
		await waitFor(v, `document.querySelector("dialog[open] [data-dev-make]")`);
		expect(await ev<boolean>(v, `!${top}.querySelector(".steps") && !${top}.querySelector("[data-dev-qr]")`)).toBe(true);
		await click(v, "dialog[open] [data-dev-make]");
		await waitFor(v, `document.querySelector("dialog[open] [data-dev-code]")`);
		expect(await ev<number>(v, `${top}.querySelectorAll(".steps li").length`)).toBe(3);
		expect(await ev(v, `[${top}.querySelector("[data-dev-code]").textContent, ${top}.querySelector('input[name="dev-url"]').value]`)).toEqual(["482913", "https://dotz.example.com/pair"]);
		expect(calls).toEqual(["POST code"]);
		expect(await ev(v, `[${top}.querySelector("[data-dev-qr] path").getAttribute("d"), ${top}.querySelector("[data-dev-qr]").getAttribute("viewBox")]`)).toEqual([QR.path, `-4 -4 ${QR.size + 8} ${QR.size + 8}`]);
		const box = await ev<{ w: number; bg: string; ink: string }>(v, `(() => { const q = ${top}.querySelector("[data-dev-qr]"); return { w: q.getBoundingClientRect().width, bg: getComputedStyle(q.querySelector("rect")).fill, ink: getComputedStyle(q.querySelector("path")).fill }; })()`);
		expect(box).toEqual({ w: 220, bg: "rgb(255, 255, 255)", ink: "rgb(0, 0, 0)" });
	});

	test("a browser adding its own passkey gets no QR: it has nothing to scan with", async () => {
		devices = initial().map(d => ({ ...d, current: false }));
		const v = await open(1280, 800);
		await click(v, "#devices [data-dev-self]");
		await waitFor(v, `document.querySelector("dialog[open] [data-dev-make]")`);
		await click(v, "dialog[open] [data-dev-make]");
		await waitFor(v, `document.querySelector("dialog[open] [data-dev-code]")`);
		expect(await ev(v, `!!${top}.querySelector("[data-dev-qr]")`)).toBe(false);
	});

	test("the QR's address fills the code in on /pair and takes it out of the address bar; a bad fragment fills nothing", async () => {
		const page = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: req => new URL(req.url).pathname === "/pair.js" ? new Response(PAIR_JS, { headers: { "Content-Type": "text/javascript" } }) : new Response(PAIR_HTML.replace("__DEVICES__", "1"), { headers: { "Content-Type": "text/html" } }) });
		try {
			const v = await plain.view({ width: 390, height: 844 });
			await v.navigate(`http://127.0.0.1:${page.port}/pair#code=482913`);
			await waitFor(v, `document.getElementById("code") && document.getElementById("code").value === "482913"`);
			expect(await ev(v, `[location.hash, location.pathname, document.getElementById("enter").hidden, document.getElementById("get").hidden]`)).toEqual(["", "/pair", false, true]);
			await v.navigate(`http://127.0.0.1:${page.port}/pair?second#code=48291x`); // a hash-only change would not load the page again
			await waitFor(v, `document.getElementById("lead").textContent.length > 0`);
			expect(await ev(v, `[location.hash, document.getElementById("code").value, document.getElementById("enter").hidden]`)).toEqual(["", "", true]);
		} finally {
			page.stop(true);
		}
	});

	test("a browser without its own passkey is offered one", async () => {
		devices = initial().map(d => ({ ...d, current: false }));
		const v = await open(1280, 800);
		expect(await ev(v, `document.querySelectorAll("#devices [data-current]").length`)).toBe(0);
		await click(v, "#devices [data-dev-self]");
		await waitFor(v, `${top}.querySelector(".dh, h2, .hd")`);
		expect(await ev<string>(v, `${top}.textContent`)).toContain("이 기기에 패스키 추가");
	});

	test("screenshots: list and new-device code, desktop and phone, light and dark", async () => {
		devices = initial();
		for (const [name, w, h] of [["desktop", 1280, 800], ["phone", 390, 844]] as const) {
			for (const theme of ["light", "dark"] as const) {
				const v = await open(w, h, theme);
				await Bun.write(`${SHOTS}/list-${name}-${theme}.png`, await v.screenshot());
				await click(v, "#devices [data-dev-new]");
				await waitFor(v, `document.querySelector("dialog[open] [data-dev-make]")`);
				await click(v, "dialog[open] [data-dev-make]");
				await waitFor(v, `document.querySelector("dialog[open] [data-dev-code]")`);
				await waitFor(v, `document.getAnimations().every(a => a.playState !== "running")`);
				await Bun.write(`${SHOTS}/new-device-${name}-${theme}.png`, await v.screenshot());
			}
		}
		for (const n of ["list", "new-device"]) for (const d of ["desktop", "phone"]) for (const t of ["light", "dark"]) expect(await Bun.file(`${SHOTS}/${n}-${d}-${t}.png`).exists()).toBe(true);
	}, 60_000);
});
