// Gateway-to-gateway trust for the merged 모니터링 view (docs/peer-monitoring.md). Two gates, both required:
//   1. tailnet source: the request came in through `tailscale serve`, which adds Tailscale-User-Login (the hub listens on 127.0.0.1 only,
//      so a request without it is a local process, never a peer);
//   2. peer token, sent as `x-dotz-peer`: the shared <data dir>/secrets/peer-token (the same value on every gateway, copied by hand), or a token this
//      gateway issued to one paired peer (hub/peer-pair.ts: made automatically between nodes of the same tailscale login).
// The token is read at call time and never logged. A request that carries `x-dotz-peer` at all is a peer request and may reach only
// the read-only paths and the two peer POSTs below, whatever else it carries, so a peer can never do more than this list.
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { timingSafeEqual } from "node:crypto";
import { DATA_DIR } from "./config.ts";
import { acceptedTokens, outToken } from "./peer-pair.ts";

export const PEER_HEADER = "x-dotz-peer";
export const peerTokenPath = (dataDir: string = DATA_DIR) => join(dataDir, "secrets", "peer-token");

let memo: { path: string; mtime: number; token: string | undefined } | undefined;
// The shared token, or undefined when this install has none (then peering is off both ways).
export function peerToken(path: string = peerTokenPath()): string | undefined {
	let mtime: number;
	try {
		mtime = statSync(path).mtimeMs;
	} catch {
		return undefined;
	}
	if (memo && memo.path === path && memo.mtime === mtime) return memo.token;
	let token: string | undefined;
	try {
		const raw = readFileSync(path, "utf8").trim();
		// The dotz_auth secret flow stores {"password": "..."}; a plain file holds the value itself.
		const o = raw.startsWith("{") ? (JSON.parse(raw) as { password?: unknown; token?: unknown }) : undefined;
		token = o ? String(o.token ?? o.password ?? "") : raw;
	} catch {
		token = undefined;
	}
	if (token !== undefined && token.length < 16) token = undefined; // too short to be a shared secret
	memo = { path, mtime, token };
	return token;
}

// Every token this gateway accepts from a peer: the shared one plus the ones it issued.
export function peerTokens(): string[] {
	const shared = peerToken();
	return [...(shared ? [shared] : []), ...acceptedTokens()];
}
// The token to send to the peer at `url`: the one it issued to this gateway, else the shared one.
export const peerTokenFor = (url: string): string | undefined => outToken(url) ?? peerToken();

const same = (a: string, b: string) => {
	const x = Buffer.from(a);
	const y = Buffer.from(b);
	return x.length === y.length && timingSafeEqual(x, y);
};

// Read-only paths a peer may GET, and the peer POSTs (forwarded actions, send lease).
export const PEER_GET = [/^\/api\/peer\/monitoring$/, /^\/api\/peer\/desk$/, /^\/api\/monitors$/, /^\/api\/notices$/, /^\/api\/integrations$/, /^\/api\/watches\/[a-z0-9-]+\/settings$/, /^\/api\/integrations\/[a-z0-9-]+\/(?:settings|features)$/, /^\/api\/conversations$/, /^\/api\/history$/, /^\/api\/mail\/[a-z0-9._-]+\/body$/, /^\/api\/mail\/[a-z0-9._-]+\/files\/\d+$/, /^\/api\/drafts\/[A-Za-z0-9._-]+\/files\/\d+$/, /^\/api\/drafts\/[A-Za-z0-9._-]+\/(?:files|library|original)$/, /^\/api\/kakao\/[^?]*$/, /^\/api\/comments\/(?:sources|threads|drafts)$/, /^\/api\/comments\/sources\/[^/?]+\/posts$/, /^\/api\/comments\/thread\/[^/?]+\/[^/?]+$/, /^\/api\/replies$/, /^\/api\/peer-info$/, /^\/api\/peer\/projects$/, /^\/api\/peer\/file$/];
export const PEER_POST = [/^\/api\/peer\/act$/, /^\/api\/peer\/lease$/, /^\/api\/peer\/desk-open$/];

export type PeerCheck = "none" | "ok" | "denied";
// "none": not a peer request (the normal owner checks apply). "ok": a peer may have this path. "denied": refuse with 403.
export function checkPeer(req: Request, tokens?: string | readonly string[]): PeerCheck {
	const sent = req.headers.get(PEER_HEADER);
	if (sent === null) return "none";
	const accepted = tokens === undefined ? peerTokens() : typeof tokens === "string" ? [tokens] : tokens;
	if (!sent || !accepted.filter(t => same(sent, t)).length) return "denied";
	if (!req.headers.get("tailscale-user-login")) return "denied";
	const path = new URL(req.url).pathname;
	const list = req.method === "GET" || req.method === "HEAD" ? PEER_GET : req.method === "POST" ? PEER_POST : [];
	return list.some(r => r.test(path)) ? "ok" : "denied";
}

// Headers for a request this gateway makes to a peer; undefined when there is no token (peering off).
export function peerHeaders(token: string | undefined = peerToken()): Record<string, string> | undefined {
	return token ? { [PEER_HEADER]: token } : undefined;
}
