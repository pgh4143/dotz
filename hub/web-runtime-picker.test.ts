import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(import.meta.dir, "..", "web", "js", "26-settings-runtime.js"), "utf8");

type Node = { append(...k: Node[]): void; tag: string; attrs: Record<string, any>; kids: Node[]; listeners: Record<string, (() => void)[]>; addEventListener(t: string, f: () => void): void; text(): string };
const mkNode = (tag: string, attrs: Record<string, any> | null, kids: any[]): Node => {
	const n: Node = {
		tag, attrs: attrs || {}, kids: kids.flat().filter(k => k != null), listeners: {},
		addEventListener(t, f) { (n.listeners[t] ||= []).push(f); },
		append(...k) { n.kids.push(...k); },
		text: () => (n.attrs.text ?? "") + n.kids.map(k => (typeof k === "string" ? k : k.text())).join(""),
	};
	return n;
};
const walk = (n: Node, out: Node[] = []): Node[] => { out.push(n); for (const k of n.kids) if (typeof k !== "string") walk(k, out); return out; };

const RUNTIMES = [
	{ id: "omo", label: "OmO", installed: true, hasAdapter: true, version: "3.1", roles: ["orchestrator", "lanes"] },
	{ id: "omp", label: "omp", installed: true, hasAdapter: true, version: "0.9", roles: [] },
	{ id: "claude", label: "Claude", installed: true, hasAdapter: true, version: "2.0", roles: [] },
	{ id: "codex", label: "Codex", installed: false, hasAdapter: false, roles: [], reason: "설치 안 됨" },
];

function harness(runtimes = RUNTIMES) {
	const calls: [string, string, any][] = [];
	const menus: { anchor: Node; items: any[]; opts: any }[] = [];
	const dialogs: { title: string; actions: any[] }[] = [];
	const api = async (path: string, method = "GET", body?: unknown) => {
		calls.push([method, path, body]);
		if (path === "/api/runtimes") return { runtimes };
		if (/\/use$/.test(path)) return { applies: "다음 시작부터 적용돼요" };
		return { report: null, state: null };
	};
	const el = (tag: string, attrs: any, ...kids: any[]) => mkNode(tag, attrs, kids);
	const icon = (name: string) => mkNode("icon", { name }, []);
	const dialog = (o: { title: string }) => { const d = { title: o.title, actions: [] as any[] }; dialogs.push(d); return { setActions: (a: any[]) => { d.actions = a; } }; };
	const g = new Function(
		"api", "el", "icon", "dialog", "showMenu", "toast", "clear", "busy", "renderSettings", "current",
		`${src}\nreturn { loadRuntimes, rtSection };`,
	)(api, el, icon, dialog, (anchor: Node, items: any[], opts: any) => menus.push({ anchor, items, opts }), () => {}, (n: Node) => n,
		(_b: unknown, fn: () => Promise<void>) => fn(), () => {}, "home") as { loadRuntimes: () => Promise<void>; rtSection: () => Node[] };
	return { g, calls, menus, dialogs };
}

describe("settings: 작업 프로그램 picker", () => {
	test("renders only the running harness, not the whole list", async () => {
		const { g } = harness();
		await g.loadRuntimes();
		const rows = walk(g.rtSection()[1]).filter(n => n.attrs["data-runtime"]);
		expect(rows.map(r => r.attrs["data-runtime"])).toEqual(["omo"]);
		expect(rows[0].text()).toContain("OmO");
		expect(rows[0].text()).toContain("사용 중");
	});

	test("shows one row per harness when the assistant and sessions run on different ones", async () => {
		const split = RUNTIMES.map(r => (r.id === "omo" ? { ...r, roles: ["orchestrator"] } : r.id === "claude" ? { ...r, roles: ["lanes"] } : r));
		const { g } = harness(split);
		await g.loadRuntimes();
		const rows = walk(g.rtSection()[1]).filter(n => n.attrs["data-runtime"]);
		expect(rows.map(r => r.attrs["data-runtime"])).toEqual(["omo", "claude"]);
		expect(rows[1].text()).toContain("세션");
	});

	test("tapping the row opens the other installed harnesses; picking one starts the existing switch flow and POSTs /use", async () => {
		const { g, calls, menus, dialogs } = harness();
		await g.loadRuntimes();
		const row = walk(g.rtSection()[1]).find(n => n.attrs["data-runtime"] === "omo")!;
		expect(menus.length).toBe(0);
		row.listeners.click[0]();
		expect(menus.length).toBe(1);
		expect(menus[0].items.map(i => i.value)).toEqual(["omp", "claude"]);

		menus[0].opts.onPick("omp");
		for (let i = 0; i < 20 && !dialogs[0]?.actions.length; i++) await Promise.resolve();
		expect(dialogs[0].title).toBe("omp로 바꾸기");
		const use = dialogs[0].actions.find(a => a.label === "바꾸기");
		expect(use.disabled).toBe(false);
		await use.onclick(() => {}, {});
		expect(calls.filter(c => c[1].endsWith("/use"))).toEqual([["POST", "/api/runtimes/omp/use", { roles: ["orchestrator", "lanes"] }]]);
	});
});
