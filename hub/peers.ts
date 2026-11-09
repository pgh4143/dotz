// Other dotz gateways of the same owner on the tailnet (the web app's computer switcher and the bell's other-computer lines).
// Discovery: `tailscale status --json`, online nodes of this node's own login, each probed at https://<DNSName>:<port>/ and kept
// only when it answers as dotz (its manifest says so). The requests go through the other node's `tailscale serve`, which
// takes this node's tailnet identity as the login, so the allow-list check passes. Config: web.peers (extra URLs),
// web.peer_discovery (default true), web.peer_ports (extra ports to try on every node; default 8443, 8445 and 8444).
// A peer that paired with this gateway (hub/peer-pair.ts) is bound to its dotz URL: that URL is asked first and the ports are scanned only
// when it no longer answers as dotz (the new port is then bound). A bound peer tailscale reports offline stays listed, shown as not connected.
// Each gateway names itself (web.machine_name, hub/machine-name.ts) and tells its peers through the public GET /api/peer-info; an older
// peer without it keeps the hostname-derived name. Without Tailscale this gateway's own row comes from its public address (webBase), so the switcher still opens.
// A web.peers entry that is not a tailnet name is a public computer (`public: true`): its row is online or not by its public manifest only, with no counts, and
// nothing that carries a peer token ever goes to it (knownComputers leaves it out). Pure parts (names, filtering, counting, cache) are exported for tests; only listPeers() touches the network.
import { peerFetch } from "./tailnet-fetch.ts";
import { cfg, log } from "./config.ts";
import { friendlyName, label, peerInfoName, resolveName } from "./machine-name.ts";
import { PEER_HEADER, peerTokenFor } from "./peer-auth.ts";
import { bindPeer, boundPeer, boundPeers, unbindPeer, type Bound } from "./peer-pair.ts";
import { webBase } from "./weblink.ts";

export { friendlyName };

// `via: "jandi"`: a computer reached only through the owner's JANDI self chat (hub/jandi-peers.ts); its url is a path on this gateway.
export type Peer = { name: string; url: string; self: boolean; online: boolean; unread?: number; need?: number; via?: "jandi"; public?: true };
export type TsNode = { DNSName?: string; HostName?: string; UserID?: number; Online?: boolean; Tags?: string[] };
export type TsStatus = { Self?: TsNode; Peer?: Record<string, TsNode>; User?: Record<string, { LoginName?: string }> };

const PROBE_MS = 3000;
const PROBE_PARALLEL = 4;
const MAX_PEERS = 16;
const DISCOVERY_TTL_MS = 60_000;
const COUNTS_TTL_MS = 15_000;
const STALE_OK_MS = 5 * 60_000; // a discovered list this much older than its limit is still answered while the new one loads
const DEFAULT_PORTS = [8443, 8445, 8444]; // 8443 is setup's default, so a node on another port still finds one on 8443

// Two computers that map to the same friendly name keep their hostnames instead, so the list never shows two identical rows.
export function uniqueNames<T extends { name: string; host: string }>(items: T[]): T[] {
	const seen = new Map<string, number>();
	for (const i of items) seen.set(i.name, (seen.get(i.name) ?? 0) + 1);
	return items.map(i => ((seen.get(i.name) ?? 0) > 1 ? { ...i, name: label(i.host) || i.host } : i));
}

// Online nodes of the same user as `self`, other than self, with a DNS name. Other users' machines, tagged nodes, the phone off the network and self never pass.
// With `withOffline`, nodes tailscale reports offline pass too (discovery keeps the bound ones among them).
export function sameUserNodes(st: TsStatus, withOffline = false): TsNode[] {
	const me = st.Self;
	if (!me || me.UserID == null) return [];
	return Object.values(st.Peer ?? {}).filter(p => (withOffline || p.Online === true) && p.UserID === me.UserID && !p.Tags?.length && !!p.DNSName && p.DNSName !== me.DNSName);
}

export function baseUrl(dns: string, port: number): string {
	return `https://${dns.replace(/\.$/, "")}${port === 443 ? "" : `:${port}`}`;
}

// Ports to try on a node: the gateway's own tailnet port first, then the configured extras; no duplicates.
export function candidatePorts(own: number, extra?: number[]): number[] {
	const list = [own, ...(extra ?? DEFAULT_PORTS)].filter(p => Number.isInteger(p) && p > 0 && p < 65536);
	return [...new Set(list)];
}

// Extra URLs from config: http(s) only, origin only, de-duplicated, at most 8.
export function extraUrls(list: unknown): string[] {
	if (!Array.isArray(list)) return [];
	const out = new Set<string>();
	for (const s of list) {
		try {
			const u = new URL(String(s));
			if (u.protocol === "https:" || u.protocol === "http:") out.add(u.origin);
		} catch {}
	}
	return [...out].slice(0, 8);
}

// Unread bell items and open decisions out of a GET /api/notices answer (older hubs answer the same shape).
export function countsFrom(body: unknown): { unread: number; need: number } | undefined {
	const b = body as { items?: Array<{ kind?: string; decision?: { state?: string } }>; unread?: unknown } | null;
	if (!b || typeof b.unread !== "number") return undefined;
	const need = Array.isArray(b.items) ? b.items.filter(n => n?.kind === "decision" && n.decision?.state === "open").length : 0;
	return { unread: Math.max(0, Math.floor(b.unread)), need };
}

// One-slot cache with a time limit; concurrent callers share the load in flight. A failed load is not kept.
// With `staleMs`, an answer up to that old is handed out at once while a new one loads behind it, so the page's request never waits on the probes.
export function cached<T>(ttlMs: number, load: () => Promise<T>, clock: () => number = Date.now, staleMs = 0): (() => Promise<T>) & { reset: () => void } {
	let value: { at: number; v: T } | undefined;
	let inflight: Promise<T> | undefined;
	let gen = 0;
	const get = () => {
		const age = value ? clock() - value.at : Infinity;
		if (value && age < ttlMs) return Promise.resolve(value.v);
		const mine = gen;
		inflight ??= load().then(v => { if (mine === gen) value = { at: clock(), v }; return v; }).finally(() => { if (mine === gen) inflight = undefined; });
		if (value && age < ttlMs + staleMs) { inflight.catch(() => {}); return Promise.resolve(value.v); }
		return inflight;
	};
	// Drops the kept answer and any load in flight (it may predate a change), so the next call loads anew.
	return Object.assign(get, { reset: () => { gen++; value = undefined; inflight = undefined; } });
}

// Runs fn over items, at most `limit` at a time; a throwing item yields undefined.
export async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<Array<R | undefined>> {
	const out: Array<R | undefined> = new Array(items.length);
	let next = 0;
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (next < items.length) {
			const i = next++;
			out[i] = await fn(items[i]!).catch(() => undefined);
		}
	}));
	return out;
}

type Fetcher = (url: string, headers?: Record<string, string>) => Promise<unknown>;
const getJson: Fetcher = async (url, headers) => {
	const r = await peerFetch(url, { headers, signal: AbortSignal.timeout(PROBE_MS), redirect: "manual" });
	if (!r.ok) throw new Error(`HTTP ${r.status}`);
	return r.json();
};

// A URL is a dotz gateway when its manifest is dotz's. /manifest.webmanifest is public and exists on every hub version.
export async function isDotz(url: string, get: Fetcher = getJson): Promise<boolean> {
	try {
		// `gateway` since the manifest carries the owner's assistant name; `name` for a gateway from before that.
		const m = (await get(`${url}/manifest.webmanifest`)) as { name?: unknown; gateway?: unknown } | null;
		return m?.gateway === "dotz" || m?.name === "dotz";
	} catch {
		return false;
	}
}

// The name another gateway chose for itself (public GET /api/peer-info), if it answers with one.
export async function peerName(url: string, get: Fetcher = getJson): Promise<string | undefined> {
	try {
		return peerInfoName(await get(`${url}/api/peer-info`));
	} catch {
		return undefined;
	}
}

// /api/notices is not public: a gateway in cloudflare mode no longer trusts the tailnet identity alone, so the read carries the peer token when there is one.
// Only tailnet computers get here: listPeers answers a public row by its manifest, and hub/peer-stream.ts follows knownComputers.
async function counts(url: string, get: Fetcher = getJson, token: (url: string) => string | undefined = peerTokenFor): Promise<{ unread: number; need: number } | undefined> {
	try {
		const t = token(url);
		return countsFrom(await get(`${url}/api/notices?limit=100`, t ? { [PEER_HEADER]: t } : undefined));
	} catch {
		return undefined;
	}
}

export async function tailscaleStatus(): Promise<TsStatus | undefined> {
	for (const bin of ["tailscale", "/Applications/Tailscale.app/Contents/MacOS/Tailscale"]) {
		const st = await Bun.$`${bin} status --json`.quiet().json().catch(() => undefined) as TsStatus | undefined;
		if (st?.Self?.DNSName) return st;
	}
	return undefined;
}

// The tailscale login (e-mail) this node runs as; undefined for a tagged node or when tailscale cannot be read (then no peer is paired with it).
export function loginOf(st: TsStatus | undefined): string | undefined {
	const me = st?.Self;
	if (!me || me.UserID == null || me.Tags?.length) return undefined;
	return st?.User?.[String(me.UserID)]?.LoginName?.toLowerCase() || undefined;
}
export const ownLogin = cached(60_000, async () => loginOf(await tailscaleStatus()));

export type Found = { name: string; host: string; url: string; self: boolean; public?: true };

// A tailnet name (MagicDNS) or a tailnet address (100.64.0.0/10); any other host is reached over the public internet.
export function isPublicHost(host: string): boolean {
	const h = host.replace(/\.$/, "").toLowerCase();
	const v4 = /^100\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(h);
	return !(h.endsWith(".ts.net") || (v4 && Number(v4[1]) >= 64 && Number(v4[1]) <= 127));
}

// This gateway's own row when Tailscale gave none: its public address, named like a tailnet self (web.machine_name or the host).
export function selfFound(base: string | undefined, machineName: unknown): Found | undefined {
	if (!base) return undefined;
	const host = new URL(base).hostname;
	return { name: resolveName(machineName, host), host, url: base, self: true };
}

type Resolve = { isDotz: (url: string) => Promise<boolean>; peerName: (url: string) => Promise<string | undefined>; bound: (host: string) => Bound | undefined; bind: (host: string, url: string, name?: string) => void };

// One same-user node to its dotz URL. Offline: only a bound node, with its record and no probe. Online: the bound URL first (no scan while it
// answers as dotz), else the candidate ports in order; a hit is bound so the record follows a moved port. Every URL passes isDotz.
export async function resolveNode(n: TsNode, ports: number[], o: Resolve): Promise<{ host: string; url: string; name?: string } | undefined> {
	const host = n.DNSName!;
	const rec = o.bound(host);
	if (n.Online !== true) return rec ? { host, url: rec.url, name: rec.name } : undefined;
	let url = rec && (await o.isDotz(rec.url)) ? rec.url : undefined;
	if (!url) {
		const ok = await Promise.all(ports.map(p => o.isDotz(baseUrl(host, p))));
		const i = ok.indexOf(true);
		if (i < 0) return undefined;
		url = baseUrl(host, ports[i]!);
	}
	const name = (await o.peerName(url)) ?? (url === rec?.url ? rec.name : undefined);
	o.bind(host, url, name);
	return { host, url, name };
}

// Which gateways exist (slow part: tailscale status and the probes). Self comes first.
export async function discover(): Promise<Found[]> {
	const w = cfg.web as { machine_name?: string; tailscale_https_port?: number; peers?: string[]; peer_discovery?: boolean; peer_ports?: number[] } | undefined;
	const found: Found[] = [];
	const urls = new Set<string>();
	const add = (host: string, url: string, self: boolean, name?: string, isPublic = false) => {
		if (urls.has(url) || found.length >= MAX_PEERS) return;
		urls.add(url);
		found.push({ name: name ?? friendlyName(host), host, url, self, ...(isPublic ? { public: true as const } : {}) });
	};
	const own = w?.tailscale_https_port ?? 0;
	const st = w?.peer_discovery === false && !w?.peers?.length ? undefined : await tailscaleStatus();
	if (st?.Self?.DNSName && own) add(st.Self.DNSName, baseUrl(st.Self.DNSName, own), true, resolveName(w?.machine_name, st.Self.DNSName));
	const webSelf = found.length ? undefined : selfFound(webBase(), w?.machine_name);
	if (webSelf) add(webSelf.host, webSelf.url, true, webSelf.name);
	if (st && own && w?.peer_discovery !== false) {
		const ports = candidatePorts(own, w?.peer_ports);
		const nodes = sameUserNodes(st, true);
		const r: Resolve = { isDotz: u => isDotz(u), peerName: u => peerName(u), bound: h => boundPeer(h), bind: (h, u, nm) => bindPeer(h, u, nm) };
		const hits = await pool(nodes, PROBE_PARALLEL, n => resolveNode(n, ports, r));
		for (const h of hits) if (h) add(h.host, h.url, false, h.name);
	}
	const manual = extraUrls(w?.peers).filter(u => !urls.has(u));
	const okManual = await pool(manual, PROBE_PARALLEL, async u => ((await isDotz(u)) ? { u, name: await peerName(u) } : undefined));
	for (const m of okManual) if (m) add(new URL(m.u).hostname, m.u, false, m.name, isPublicHost(new URL(m.u).hostname));
	return uniqueNames(found);
}

const discovered = cached(DISCOVERY_TTL_MS, () => discover().catch(error => { log(`peers: discovery failed: ${(error as Error).message}`); return [] as Found[]; }), Date.now, STALE_OK_MS);
// The discovered computers (self first), from the same cache as the switcher. hub/push.ts relays notices to them and accepts relays only from them.
// Public computers are left out: what the callers send to these (a notice relay, a peer-token request) must never reach a public address.
export const knownComputers = async (): Promise<Found[]> => (await discovered()).filter(f => !f.public);
const countsCache = new Map<string, { at: number; v: { unread: number; need: number } | undefined }>();
const STALE_COUNTS_MS = 45_000;
const recounting = new Set<string>();

// Reads one computer's counts now and keeps them for listPeers. hub/peer-stream.ts calls it when that computer's notices change.
export async function refreshCounts(url: string, get: Fetcher = getJson, token?: (url: string) => string | undefined): Promise<{ unread: number; need: number } | undefined> {
	const v = await counts(url, get, token);
	countsCache.set(url, { at: Date.now(), v });
	return v;
}

// "Forget this computer": drops the bound record of an OFFLINE computer in `rows` (the list GET /api/peers answers), so it leaves the list. An online, public, relay or own row is never forgotten.
export function forgetPeer(url: string, rows: Peer[], dir?: string): "ok" | "online" | "none" {
	const p = rows.find(r => r.url === url && !r.self && !r.via && !r.public);
	const host = p && Object.entries(boundPeers(dir)).find(([, b]) => b.url === url)?.[0];
	if (!p || !host) return "none";
	if (p.online) return "online";
	return unbindPeer(host, dir) ? "ok" : "none";
}

// DELETE /api/peers?url=: the web's "지우기" on an offline row; an online computer is refused (409), an unknown one is 404.
// The row's flag can be a minute old and only says its counts did not answer, so the computer itself is asked first; only a URL on the list is ever asked.
export async function forgetRoute(u: URL, o: { rows?: () => Promise<Peer[]>; alive?: (url: string) => Promise<boolean>; dir?: string } = {}): Promise<Response> {
	const url = u.searchParams.get("url") ?? "";
	const rows = await (o.rows ?? listPeers)();
	const row = rows.find(p => p.url === url);
	if (row && !row.self && !row.public && !row.via && !row.online && (await (o.alive ?? isDotz)(url))) row.online = true;
	const r = forgetPeer(url, rows, o.dir);
	if (r === "ok") { discovered.reset(); countsCache.delete(url); }
	return r === "ok" ? Response.json({ ok: true }) : Response.json({ error: r === "online" ? "computer is connected" : "not found" }, { status: r === "online" ? 409 : 404 });
}

const publicOnline = new Map<string, { at: number; v: boolean }>();
// A public computer's row: online by its public manifest alone (kept COUNTS_TTL_MS), no counts, and no other request to it.
export async function publicPeer(f: Found, get: Fetcher = getJson): Promise<Peer> {
	let c = publicOnline.get(f.url);
	if (!c || Date.now() - c.at >= COUNTS_TTL_MS) {
		c = { at: Date.now(), v: await isDotz(f.url, get) };
		publicOnline.set(f.url, c);
	}
	return { name: f.name, url: f.url, self: false, online: c.v, public: true };
}

// The list for GET /api/peers. One entry or none: the web app hides the switcher (it needs two gateways).
export async function listPeers(): Promise<Peer[]> {
	const list = await discovered();
	const t = Date.now();
	return pool(list, PROBE_PARALLEL, async f => {
		if (f.self) return { name: f.name, url: f.url, self: true, online: true } as Peer;
		if (f.public) return publicPeer(f);
		let c = countsCache.get(f.url);
		if (!c || t - c.at >= COUNTS_TTL_MS + STALE_COUNTS_MS) {
			c = { at: t, v: await counts(f.url) };
			countsCache.set(f.url, c);
		} else if (t - c.at >= COUNTS_TTL_MS && !recounting.has(f.url)) {
			// Stale by less than a minute: answer with it now and read the new one behind the request (a slow or offline peer costs the page nothing).
			recounting.add(f.url);
			void refreshCounts(f.url, undefined).finally(() => recounting.delete(f.url));
		}
		const p: Peer = { name: f.name, url: f.url, self: false, online: c.v !== undefined };
		if (c.v) { p.unread = c.v.unread; p.need = c.v.need; }
		return p;
	}).then(r => {
		for (const k of countsCache.keys()) if (!list.some(f => f.url === k)) countsCache.delete(k);
		return r.filter((p): p is Peer => !!p);
	});
}
