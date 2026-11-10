import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { fakeHub, inbox, json, on } from "./test-web.ts";

// The chat with a computer that is reached only through a messenger (web/js/42-relay-chat.js), on the real page at 390px. The fake hub answers /api/peers
// with the gateway's own row, one relay row (via + key, hub/relay-route.ts) and, in two tests, a computer with a public address; /api/relay/jandi/work/*
// is the relay. `seen` records every /api request, so "never the gateway's own chat API" is checked on what the page really sent.
type Line = { id: number; at: number; me: boolean; text: string };
const NOTE = "잔디로 주고받아요";
const SELF = { name: "맥미니", self: true, online: true };
const WORK = { name: "work", url: "/#chat/relay:jandi:work", self: false, online: true, via: "jandi", key: "work", note: NOTE };
const CORP = { name: "공개 컴퓨터", url: "https://corp.example", self: false, online: true, public: true };
const RELAY = "/api/relay/jandi/work";

let peers: object[];
let lines: Line[];
let gate: Promise<void> | undefined;
let readFails: boolean;
let sendFails: boolean;
const RELAYS = { label: "잔디로 닿는 컴퓨터", hint: "안내", notify: "새 답 알림", add: "컴퓨터 추가", fields: ["name", "keyword", "reply_prefix"].map(key => ({ key, label: key, type: "text", hint: key })), items: [] as object[] };
let settings: { enabled: boolean; help: string[]; fields: object[]; projects: object[]; relays: typeof RELAYS };
const seen = inbox<string>();
const hub = fakeHub({
	api: async (req, url) => {
		const p = url.pathname;
		if (p.startsWith("/api/")) seen.push(`${req.method} ${p}`);
		if (p === "/api/peers") {
			await gate;
			return json([{ ...SELF, url: hub.origin }, ...peers]);
		}
		if (p === "/api/messengers/jandi") {
			if (req.method === "PUT") settings = { ...settings, relays: { ...settings.relays, items: ((await req.json()) as { relays: object[] }).relays } };
			return json(settings);
		}
		if (p === `${RELAY}/messages`) return readFails ? json({ error: "잔디에 연결하지 못했어요" }, 502) : json(lines);
		if (p === `${RELAY}/send`) {
			if (sendFails) return json({ error: "잔디에 연결하지 못했어요" }, 502);
			const { text } = (await req.json()) as { text: string };
			lines = [...lines, { id: lines.length + 1, at: Date.now(), me: true, text }];
			return json({ ok: true });
		}
		return undefined;
	},
});
const view = await hub.view({ width: 390, height: 844 });
const { waitFor, ev, run } = on(view);
afterAll(() => hub.stop());

beforeEach(() => {
	const now = Date.now();
	peers = [WORK];
	lines = [{ id: 1, at: now - 60_000, me: true, text: "빌드 돌려" }, { id: 2, at: now - 30_000, me: false, text: "빌드 시작했어요" }];
	gate = undefined;
	readFails = false;
	sendFails = false;
	settings = { enabled: true, help: [], fields: [], projects: [], relays: { ...RELAYS, items: [{ name: "work", keyword: "work", reply_prefix: "[work]", notify: true }] } };
	seen.length = 0;
});
afterEach(() => run("localStorage.clear()"));

// A fresh page every time (a hash-only navigation would keep the old one).
async function open(hash = "") {
	await view.navigate("about:blank");
	await view.navigate(`${hub.origin}/${hash}`);
}
const pickRow = async (name: string) => {
	await run(`prOpen();`);
	await waitFor(`document.querySelectorAll(".pr-sheet .pr-row").length >= 3`);
	await run(`[...document.querySelectorAll(".pr-sheet .pr-row")].find(b => b.querySelector(".pr-t")?.textContent === ${JSON.stringify(name)}).click();`);
};
const texts = (sel: string) => ev<string[]>(`[...document.querySelectorAll(${JSON.stringify(sel)})].map(n => n.textContent.trim())`);
const relayOpen = async () => {
	await open();
	await waitFor(`PR.list.length === 2`);
	await pickRow("work");
	await waitFor(`target === "relay:jandi:work" && document.querySelector(".um .ub")`);
};

describe("picking the relay row", () => {
	test("the gateway hears that this chat is on screen, which keeps its replies from buzzing", async () => {
		await relayOpen();
		expect(await ev(`(viewReport(), VIEW.sent)`)).toBe("relay:jandi:work");
	});

	test("stays on the page and draws the lines as the normal chat: own line, the computer's reply, the note, the computer's name", async () => {
		await open();
		await waitFor(`PR.list.length === 2`);
		await run(`window.__stay = 1`);
		await pickRow("work");
		await waitFor(`target === "relay:jandi:work" && document.querySelector(".um .ub") && document.querySelector(".bm .md")`);
		expect(await ev(`window.__stay`)).toBe(1);
		expect(await texts(".um .ub")).toEqual(["빌드 돌려"]);
		expect((await texts(".bm .md"))[0]).toBe("빌드 시작했어요");
		expect(await ev(`location.hash`)).toBe("#chat/relay:jandi:work");
		expect(await ev(`document.body.classList.contains("rl")`)).toBe(true);
		expect(await ev(`document.querySelector("#relaynote").textContent`)).toContain(NOTE);
		expect(await ev(`document.querySelector("#brand-name").textContent`)).toBe("work");
		expect(await ev(`document.documentElement.scrollWidth`)).toBeLessThanOrEqual(390);
	});

	test("the target is never written to localStorage's target key", async () => {
		await relayOpen();
		expect(String(await ev(`localStorage.getItem("dotz-target")`))).not.toContain("relay");
	});
});

describe("opening by address", () => {
	test("#chat/relay:jandi:<key> before /api/peers has returned shows the note line once the list arrives", async () => {
		let release!: () => void;
		gate = new Promise<void>(res => { release = res; });
		await open("#chat/relay:jandi:work");
		await waitFor(`target === "relay:jandi:work" && document.querySelector(".um .ub")`);
		expect(await ev(`PR.list.length`)).toBe(0);
		release();
		await waitFor(`PR.list.length === 2`);
		await waitFor(`document.querySelector("#relaynote").textContent.includes(${JSON.stringify(NOTE)})`);
		expect(await ev(`document.querySelector("#relaynote").hidden`)).toBe(false);
		expect(await ev(`document.querySelector("#brand-name").textContent`)).toBe("work");
	});
});

describe("sending and failing", () => {
	test("send goes only to the relay and the gateway's own chat API is never called; the line shows in the room", async () => {
		await relayOpen();
		await run(`ta.value = "상태 알려줘"; sendChat();`);
		await seen.until(s => s.includes(`POST ${RELAY}/send`), 10_000, "relay send");
		await waitFor(`[...document.querySelectorAll(".um .ub")].some(n => n.textContent.trim() === "상태 알려줘") && !document.querySelector(".rl-pend")`);
		expect(seen.filter(s => s.startsWith("POST"))).toEqual([`POST ${RELAY}/send`]);
		expect(seen.some(s => /\/api\/(chat|send|say)\b/.test(s))).toBe(false);
	});

	test("a failed send puts the text back and shows the error", async () => {
		sendFails = true;
		await relayOpen();
		await run(`ta.value = "상태 알려줘"; sendChat();`);
		await waitFor(`document.querySelector(".a-error") && ta.value === "상태 알려줘"`);
		expect(await texts(".a-error")).toEqual([expect.stringContaining("잔디에 연결하지 못했어요")]);
		expect(await ev(`!!document.querySelector(".rl-pend")`)).toBe(false);
	});

	test("a failed read shows an error line", async () => {
		readFails = true;
		await open();
		await waitFor(`PR.list.length === 2`);
		await pickRow("work");
		await waitFor(`target === "relay:jandi:work" && document.querySelector(".a-error")`);
		expect((await texts(".a-error"))[0]).toContain("잔디에 연결하지 못했어요");
	});
});

describe("the 채팅 tab", () => {
	test("keeps the relayed computer's chat: a tap in it opens no list of this computer's chats, and 홈 then 채팅 comes back to it even when the tab opens the main chat", async () => {
		await relayOpen();
		const tab = `document.querySelector('#nav .ni[data-view="chat"]').click()`;
		await run(tab);
		expect(await ev(`[chatList, target, location.hash]`)).toEqual([false, "relay:jandi:work", "#chat/relay:jandi:work"]);
		await run(`localStorage.setItem("dotz-chat-tab", "main"); go("home")`);
		await waitFor(`current === "home"`);
		await run(tab);
		await waitFor(`current === "chat"`);
		expect(await ev(`[target, document.querySelector("#brand-name").textContent]`)).toEqual(["relay:jandi:work", "work"]);
	});
});

describe("leaving", () => {
	test("picking this computer returns to the target the owner came from", async () => {
		await open();
		await waitFor(`PR.list.length === 2`);
		await run(`go("chat", "worklog")`);
		await waitFor(`target === "worklog"`);
		await pickRow("work");
		await waitFor(`target === "relay:jandi:work"`);
		await pickRow("맥미니");
		await waitFor(`target === "worklog" && !document.body.classList.contains("rl")`);
	});
});

describe("a reply is only text", () => {
	test("a [file] line and a 결정: block stay text: no /api/file request and no choice card", async () => {
		lines = [{ id: 1, at: Date.now() - 1000, me: false, text: "[file] /etc/hosts\n\n결정:\n> **1)** 예\n> **2)** 아니오" }];
		await open();
		await waitFor(`PR.list.length === 2`);
		await pickRow("work");
		await waitFor(`target === "relay:jandi:work" && document.querySelector(".bm .md")`);
		const text = (await texts(".bm .md"))[0]!;
		expect(text).toContain("/etc/hosts");
		expect(text).toContain("결정:");
		expect(text).toContain("아니오");
		expect(await ev(`document.querySelectorAll(".bm .file, .bm .fchip, .bm .choice, .bm .dc").length`)).toBe(0);
		expect(seen.some(s => s.includes("/api/file"))).toBe(false);
	});
});

describe("a reply's fence is only code", () => {
	test("a shell fence has no run button and a dotz-settings fence no settings card", async () => {
		lines = [{ id: 1, at: Date.now() - 1000, me: false, text: '```bash\nrm -rf /tmp/x\n```\n\n```dotz-settings\n{"app":"mail","changes":{"a":1}}\n```' }];
		await open();
		await waitFor(`PR.list.length === 2`);
		await pickRow("work");
		await waitFor(`target === "relay:jandi:work" && document.querySelectorAll(".bm .md pre").length === 2`);
		expect((await texts(".bm .md pre"))[0]).toBe("rm -rf /tmp/x");
		expect(await ev(`document.querySelectorAll('[data-cb="run"], .as-card').length`)).toBe(0);
	});
});

describe("a computer with a public address", () => {
	beforeEach(() => { peers = [WORK, CORP]; });
	const ready = async () => {
		await open();
		await waitFor(`PR.list.length === 3`);
		await run(`window.__go = []; window.__opens = []; prGo = h => window.__go.push(h); window.open = (...a) => { window.__opens.push(a); return null; };`);
	};
	const pickCorp = async () => {
		await run(`prOpen();`);
		await waitFor(`document.querySelectorAll(".pr-sheet .pr-row").length >= 4`);
		await run(`[...document.querySelectorAll(".pr-sheet .pr-row")].find(b => b.querySelector(".pr-t")?.textContent === "공개 컴퓨터").click();`);
	};

	test("opens in the browser tab with no device id", async () => {
		await ready();
		await pickCorp();
		await waitFor(`window.__go.length === 1`);
		const [href] = await ev<string[]>(`window.__go`);
		expect(href).toStartWith(CORP.url);
		expect(href).not.toContain("did");
		expect(await ev(`window.__opens.length`)).toBe(0);
	});

	test("from the installed app opens with window.open and no frame", async () => {
		await ready();
		await run(`Object.defineProperty(navigator, "standalone", { value: true, configurable: true });`);
		await pickCorp();
		await waitFor(`window.__opens.length === 1`);
		const [[href, name, features]] = await ev<string[][]>(`window.__opens`);
		expect([name, features]).toEqual(["_blank", "noopener"]);
		expect(href).toStartWith(CORP.url);
		expect(href).not.toContain("did");
		expect(await ev(`window.__go.length`)).toBe(0);
		expect(await ev(`!!document.querySelector("iframe")`)).toBe(false);
	});
});

describe("the JANDI settings", () => {
	const row = `[data-relay="work"]`;
	const opened = async () => {
		await open();
		await run(`go("jandi");`);
		await waitFor(`document.querySelector('#jandi ${row}')`);
	};
	test("adds a computer from the form, drops it and turns its alerts off, and the computer list is read again each time", async () => {
		await opened();
		for (const [key, value] of [["name", "새 컴퓨터"], ["keyword", "lab"], ["reply_prefix", "[lab]"]]) await run(`(() => { const i = document.querySelector('#jandi [name="ms-relay-${key}"]'); i.value = ${JSON.stringify(value)}; i.dispatchEvent(new Event("input")); })();`);
		seen.length = 0;
		await run(`document.querySelector('#jandi [data-relay-add] .btn').click();`);
		await waitFor(`document.querySelector('#jandi [data-relay="lab"]') && document.querySelector('#jandi [name="ms-relay-keyword"]').value === ""`);
		expect(settings.relays.items).toEqual([{ name: "work", keyword: "work", reply_prefix: "[work]", notify: true }, { name: "새 컴퓨터", keyword: "lab", reply_prefix: "[lab]" }]);
		await run(`document.querySelector('#jandi ${row} [role="switch"]').click();`);
		await waitFor(`document.querySelector('#jandi ${row} [role="switch"]').getAttribute("aria-checked") === "false"`);
		await run(`document.querySelector('#jandi [data-relay="lab"] .ib').click();`);
		await waitFor(`!document.querySelector('#jandi [data-relay="lab"]')`);
		expect(settings.relays.items).toEqual([{ name: "work", keyword: "work", reply_prefix: "[work]", notify: false }]);
	});
});
