import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bindPeer, boundPeer } from "./peer-pair.ts";
import { cfg } from "./config.ts";
import { baseUrl, cached, forgetPeer, forgetRoute, candidatePorts, countsFrom, discover, extraUrls, friendlyName, isDotz, isPublicHost, knownComputers, listPeers, peerName, pool, publicPeer, refreshCounts, resolveNode, sameUserNodes, selfFound, uniqueNames } from "./peers.ts";
import { setWebBase } from "./weblink.ts";

const roots: string[] = [];
afterAll(() => roots.forEach(d => rmSync(d, { recursive: true, force: true })));

// resolveNode with a temp binding dir and a fake network: `dotz` lists the URLs that answer as dotz; `probed` records every isDotz call.
function rigResolve(dotz: string[], names: Record<string, string> = {}) {
	const dir = mkdtempSync(join(tmpdir(), "peers-bind-"));
	roots.push(dir);
	const probed: string[] = [];
	const o = {
		isDotz: async (u: string) => { probed.push(u); return dotz.includes(u); },
		peerName: async (u: string) => names[u],
		bound: (h: string) => boundPeer(h, dir),
		bind: (h: string, u: string, n?: string) => bindPeer(h, u, n, dir),
	};
	return { dir, probed, o };
}
const MINI = "mini.ts.net.";
const PORTS = [8443, 8445, 8444];

test("friendlyName maps known Mac hostnames and keeps others", () => {
	expect(friendlyName("owner-macbookpro")).toBe("맥북");
	expect(friendlyName("owner-macbookpro.tail1234.ts.net.")).toBe("맥북");
	expect(friendlyName("owner-mac-mini.tail1234.ts.net")).toBe("맥미니");
	expect(friendlyName("Macmini")).toBe("맥미니");
	expect(friendlyName("studio-imac")).toBe("아이맥");
	expect(friendlyName("nas.tail1234.ts.net")).toBe("nas");
});

test("uniqueNames falls back to hostnames for duplicates only", () => {
	const r = uniqueNames([{ name: "맥북", host: "work-macbook" }, { name: "맥북", host: "home-macbookpro" }, { name: "맥미니", host: "mini" }]);
	expect(r.map(i => i.name)).toEqual(["work-macbook", "home-macbookpro", "맥미니"]);
});

test("sameUserNodes keeps online nodes of this user, not self, not other users", () => {
	const st = {
		Self: { DNSName: "me.ts.net.", UserID: 1, Online: true },
		Peer: {
			a: { DNSName: "mini.ts.net.", UserID: 1, Online: true },
			b: { DNSName: "phone.ts.net.", UserID: 1, Online: false },
			c: { DNSName: "theirs.other.ts.net.", UserID: 2, Online: true },
			d: { DNSName: "me.ts.net.", UserID: 1, Online: true },
			e: { UserID: 1, Online: true },
		},
	};
	expect(sameUserNodes(st).map(n => n.DNSName)).toEqual(["mini.ts.net."]);
	expect(sameUserNodes({ Peer: st.Peer })).toEqual([]);
});

test("sameUserNodes can also keep offline nodes of this user", () => {
	const st = { Self: { DNSName: "me.ts.net.", UserID: 1 }, Peer: { a: { DNSName: "mini.ts.net.", UserID: 1, Online: false }, b: { DNSName: "x.ts.net.", UserID: 2, Online: false }, c: { DNSName: "t.ts.net.", UserID: 1, Tags: ["tag:s"] } } };
	expect(sameUserNodes(st)).toEqual([]);
	expect(sameUserNodes(st, true).map(n => n.DNSName)).toEqual(["mini.ts.net."]);
});

test("resolveNode uses the bound URL and scans no ports while it answers as dotz", async () => {
	const r = rigResolve(["https://mini.ts.net:8445"], { "https://mini.ts.net:8445": "맥미니" });
	bindPeer(MINI, "https://mini.ts.net:8445", undefined, r.dir);
	const got = await resolveNode({ DNSName: MINI, Online: true }, PORTS, r.o);
	expect(got).toEqual({ host: MINI, url: "https://mini.ts.net:8445", name: "맥미니" });
	expect(r.probed).toEqual(["https://mini.ts.net:8445"]);
	expect(boundPeer(MINI, r.dir)?.name).toBe("맥미니");
});

test("resolveNode rescans when the bound URL is no longer dotz and the record follows the new port", async () => {
	const r = rigResolve(["https://mini.ts.net:8444"]);
	bindPeer(MINI, "https://mini.ts.net:8445", "맥미니", r.dir);
	const got = await resolveNode({ DNSName: MINI, Online: true }, PORTS, r.o);
	expect(got?.url).toBe("https://mini.ts.net:8444");
	expect(r.probed).toContain("https://mini.ts.net:8443");
	expect(boundPeer("MINI.ts.net", r.dir)?.url).toBe("https://mini.ts.net:8444");
	expect(boundPeer(MINI, r.dir)?.name).toBe("맥미니");
});

test("resolveNode scan skips a non-dotz service on 8443 and binds dotz on 8445", async () => {
	const r = rigResolve(["https://mini.ts.net:8445"]);
	const got = await resolveNode({ DNSName: MINI, Online: true }, PORTS, r.o);
	expect(got?.url).toBe("https://mini.ts.net:8445");
	expect(boundPeer(MINI, r.dir)?.url).toBe("https://mini.ts.net:8445");
	expect(await resolveNode({ DNSName: "other.ts.net.", Online: true }, PORTS, r.o)).toBeUndefined();
	expect(boundPeer("other.ts.net", r.dir)).toBeUndefined();
});

test("resolveNode lists an offline bound node with its record and probes nothing; an unbound one is dropped", async () => {
	const r = rigResolve([]);
	bindPeer(MINI, "https://mini.ts.net:8445", "맥미니", r.dir);
	expect(await resolveNode({ DNSName: MINI, Online: false }, PORTS, r.o)).toEqual({ host: MINI, url: "https://mini.ts.net:8445", name: "맥미니" });
	expect(await resolveNode({ DNSName: "nas.ts.net.", Online: false }, PORTS, r.o)).toBeUndefined();
	expect(r.probed).toEqual([]);
});

test("bindPeer keeps at most 32 peers, dropping the oldest", () => {
	const r = rigResolve([]);
	for (let i = 0; i < 34; i++) bindPeer(`h${i}.ts.net`, `https://h${i}.ts.net`, undefined, r.dir, i);
	expect(boundPeer("h0.ts.net", r.dir)).toBeUndefined();
	expect(boundPeer("h1.ts.net", r.dir)).toBeUndefined();
	expect(boundPeer("h33.ts.net", r.dir)?.url).toBe("https://h33.ts.net");
});

test("baseUrl and candidatePorts build probe targets", () => {
	expect(baseUrl("a.ts.net.", 8443)).toBe("https://a.ts.net:8443");
	expect(baseUrl("a.ts.net", 443)).toBe("https://a.ts.net");
	expect(candidatePorts(8443)).toEqual([8443, 8445, 8444]);
	expect(candidatePorts(8445, [8445, 70000, 9000])).toEqual([8445, 9000]);
});

test("extraUrls accepts http(s) origins only, deduplicated and capped", () => {
	expect(extraUrls(["https://a.example:8443/x", "https://a.example:8443", "ftp://b", "nope", 5])).toEqual(["https://a.example:8443"]);
	expect(extraUrls(Array.from({ length: 20 }, (_, i) => `https://h${i}.example`))).toHaveLength(8);
	expect(extraUrls(undefined)).toEqual([]);
});

test("countsFrom counts unread and open decisions", () => {
	const body = { unread: 3, items: [{ kind: "decision", decision: { state: "open" } }, { kind: "decision", decision: { state: "answered" } }, { kind: "alert" }] };
	expect(countsFrom(body)).toEqual({ unread: 3, need: 1 });
	expect(countsFrom({ unread: 0 })).toEqual({ unread: 0, need: 0 });
	expect(countsFrom({ error: "x" })).toBeUndefined();
	expect(countsFrom(null)).toBeUndefined();
});

test("the counts read carries the computer's peer token when there is one and no peer header without one", async () => {
	const url = "https://mini.ts.net:8445";
	const calls: Array<[string, Record<string, string> | undefined]> = [];
	const get = async (u: string, h?: Record<string, string>): Promise<unknown> => (calls.push([u, h]), { unread: 2, items: [] });
	const asked: string[] = [];
	expect(await refreshCounts(url, get, u => (asked.push(u), "token-for-mini"))).toEqual({ unread: 2, need: 0 });
	expect(asked).toEqual([url]);
	expect(await refreshCounts(url, get, () => undefined)).toEqual({ unread: 2, need: 0 });
	expect(calls).toEqual([[`${url}/api/notices?limit=100`, { "x-dotz-peer": "token-for-mini" }], [`${url}/api/notices?limit=100`, undefined]]);
});

test("the token in the counts read reaches the computer over the real fetch, and a gateway that refuses it reads as not connected", async () => {
	const seen: Array<string | null> = [];
	const other = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: req => {
		const sent = req.headers.get("x-dotz-peer");
		seen.push(sent);
		return sent === "token-for-other" ? Response.json({ unread: 1, items: [] }) : new Response("forbidden", { status: 403, headers: { "X-Dotz-Pair": "1" } });
	} });
	const url = "http://127.0.0.1:" + other.port;
	try {
		expect(await refreshCounts(url, undefined, () => "token-for-other")).toEqual({ unread: 1, need: 0 });
		expect(await refreshCounts(url, undefined, () => undefined)).toBeUndefined();
		expect(seen).toEqual(["token-for-other", null]);
	} finally {
		other.stop(true);
	}
});

test("the public probes never carry a peer header", async () => {
	const headers: unknown[] = [];
	const get = async (_u: string, h?: Record<string, string>): Promise<unknown> => (headers.push(h), { name: "dotz" });
	expect(await isDotz("https://mini.ts.net:8445", get)).toBe(true);
	await peerName("https://mini.ts.net:8445", get);
	await publicPeer({ name: "p", host: "probe.example.com", url: "https://probe.example.com", self: false, public: true }, get);
	expect(headers).toEqual([undefined, undefined, undefined]);
});

test("cached reuses a value inside the ttl, reloads after it, and shares one load in flight", async () => {
	let t = 0, loads = 0;
	const get = cached(1000, async () => ++loads, () => t);
	const [a, b] = await Promise.all([get(), get()]);
	expect([a, b, loads]).toEqual([1, 1, 1]);
	t = 999;
	expect(await get()).toBe(1);
	t = 1000;
	expect(await get()).toBe(2);
});

test("cached does not keep a failed load", async () => {
	let n = 0;
	const get = cached(1000, async () => { if (++n === 1) throw new Error("boom"); return n; }, () => 0);
	await expect(get()).rejects.toThrow("boom");
	expect(await get()).toBe(2);
});

test("pool bounds parallelism and turns a throwing item into undefined", async () => {
	let running = 0, peak = 0;
	const r = await pool([1, 2, 3, 4, 5, 6], 2, async n => {
		running++; peak = Math.max(peak, running);
		await Promise.resolve();
		running--;
		if (n === 3) throw new Error("x");
		return n * 2;
	});
	expect(r).toEqual([2, 4, undefined, 8, 10, 12]);
	expect(peak).toBeLessThanOrEqual(2);
});

test("isDotz accepts only a dotz manifest", async () => {
	expect(await isDotz("https://a", async () => ({ name: "dotz" }))).toBe(true);
	expect(await isDotz("https://a", async () => ({ name: "herdr web ui" }))).toBe(false);
	expect(await isDotz("https://a", async () => { throw new Error("timeout"); })).toBe(false);
});

test("a gateway is recognised by the manifest's gateway marker (its name is the owner's assistant's) or, from an older gateway, by its name", async () => {
	expect(await isDotz("https://a", async () => ({ name: "땃쥐", gateway: "dotz" }))).toBe(true);
	expect(await isDotz("https://b", async () => ({ name: "dotz" }))).toBe(true);
	expect(await isDotz("https://c", async () => ({ name: "Other app" }))).toBe(false);
});

test("a host is public unless it is a tailnet name or a tailnet address", () => {
	for (const [host, want] of [["dotz.example.com", true], ["mac.tail1234.ts.net", false], ["mac.tail1234.ts.net.", false], ["100.64.0.1", false], ["100.127.255.254", false], ["100.128.0.1", true], ["100.63.0.1", true], ["192.168.0.2", true], ["127.0.0.1", true]] as const) expect([host, isPublicHost(host)]).toEqual([host, want]);
});

test("without Tailscale the self row is made from the web address, so the switch sheet can open", async () => {
	expect(selfFound(undefined, undefined)).toBeUndefined();
	expect(selfFound("https://dotz.example.com", "내 맥")).toEqual({ name: "내 맥", host: "dotz.example.com", url: "https://dotz.example.com", self: true });
	const before = cfg.web;
	Object.assign(cfg, { web: { peer_discovery: false } });
	setWebBase("https://dotz.example.com");
	try {
		const found = await discover();
		expect(found.map(f => [f.url, f.self, f.public])).toEqual([["https://dotz.example.com", true, undefined]]);
		setWebBase(undefined);
		expect(await discover()).toEqual([]);
	} finally {
		setWebBase(undefined);
		Object.assign(cfg, { web: before });
	}
});

test("a computer in web.peers that is not on the tailnet is public: online by its manifest alone, no counts, and nothing for it among the computers that get a token", async () => {
	const asked: string[] = [];
	const other = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: req => (asked.push(new URL(req.url).pathname + (req.headers.has("x-dotz-peer") ? " +peer-token" : "")), new URL(req.url).pathname === "/manifest.webmanifest" ? Response.json({ name: "dotz" }) : new Response("no", { status: 404 })) });
	const before = cfg.web;
	const url = "http://127.0.0.1:" + other.port;
	Object.assign(cfg, { web: { peer_discovery: false, peers: [url] } });
	setWebBase("https://dotz.example.com");
	try {
		const rows = await listPeers();
		expect(rows).toEqual([{ name: "dotz", url: "https://dotz.example.com", self: true, online: true }, { name: "127", url, self: false, online: true, public: true }]);
		expect((await knownComputers()).map(c => c.url)).toEqual(["https://dotz.example.com"]);
		expect(asked.every(p => p === "/manifest.webmanifest" || p === "/api/peer-info")).toBe(true);
	} finally {
		setWebBase(undefined);
		Object.assign(cfg, { web: before });
		other.stop(true);
	}
});

test("a public row is offline when its manifest is not dotz's, and is asked for nothing else", async () => {
	const asked: string[] = [];
	const get = async (u: string): Promise<unknown> => (asked.push(u), { name: "other" });
	const row = await publicPeer({ name: "x", host: "x.example.com", url: "https://x.example.com", self: false, public: true }, get);
	expect(row).toEqual({ name: "x", url: "https://x.example.com", self: false, online: false, public: true });
	expect(asked).toEqual(["https://x.example.com/manifest.webmanifest"]);
});

test("forgetPeer forgets an offline bound computer only: an online, public, relay or own row stays", () => {
	const dir = mkdtempSync(join(tmpdir(), "peers-forget-"));
	roots.push(dir);
	const url = "https://mini.ts.net:8445";
	bindPeer(MINI, url, "맥미니", dir);
	const row = { name: "맥미니", url, self: false, online: false };
	expect(forgetPeer(url, [{ ...row, online: true }], dir)).toBe("online");
	expect(forgetPeer(url, [{ ...row, public: true }, { ...row, self: true }, { ...row, via: "jandi" }], dir)).toBe("none");
	expect(forgetPeer("https://other.ts.net", [row], dir)).toBe("none");
	expect(boundPeer(MINI, dir)?.url).toBe(url);
	expect(forgetPeer(url, [row], dir)).toBe("ok");
	expect(boundPeer(MINI, dir)).toBeUndefined();
});

test("forgetRoute asks the computer itself first: one that still answers stays, and a URL off the list is never asked", async () => {
	const dir = mkdtempSync(join(tmpdir(), "peers-forget-route-"));
	roots.push(dir);
	const url = "https://mini.ts.net:8445";
	bindPeer(MINI, url, "맥미니", dir);
	const rows = async () => [{ name: "맥미니", url, self: false, online: false }];
	const asked: string[] = [];
	const answers = (v: boolean) => async (u: string) => { asked.push(u); return v; };
	const route = (target: string, v: boolean) => forgetRoute(new URL(`http://x/api/peers?url=${encodeURIComponent(target)}`), { rows, alive: answers(v), dir });
	expect((await route("https://evil.example", true)).status).toBe(404);
	expect(asked).toEqual([]);
	expect((await route(url, true)).status).toBe(409);
	expect(boundPeer(MINI, dir)?.url).toBe(url);
	expect((await route(url, false)).status).toBe(200);
	expect(boundPeer(MINI, dir)).toBeUndefined();
});

test("a reset cache loads anew and ignores a load that began before the reset", async () => {
	let n = 0;
	const gates: Array<(v: number) => void> = [];
	const get = cached(60_000, () => new Promise<number>(r => { n++; gates.push(r); }));
	const first = get();
	get.reset();
	const second = get();
	gates[1]!(2);
	gates[0]!(1);
	expect([await first, await second, n]).toEqual([1, 2, 2]);
	expect(await get()).toBe(2);
});
