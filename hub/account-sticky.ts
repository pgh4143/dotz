// One Claude subscription account for the orchestrator and its lanes (audit 2026-10-20: the orchestrator re-wrote its
// whole prompt cache 4 times in a day because the account under it changed; OmO keys its cache and session continuity to
// the account). dotz keeps the account it runs on and switches only when the owner's rules say so (hub/account-rules.ts:
// a manual pick, the owner's script, time and usage rules) or, when none of them decides, when that account is blocked
// (a usage limit or 429, as OmO records it in credential-pool-state.json), when it left the pool, or when the owner pins
// another one (auth.json "anthropic-subscription".pinned). Unpinning keeps the current account. Every switch is logged
// with its reason (hub.log and <DATA_DIR>/account-switches.jsonl) and shown on the usage screen.
//
// The account reaches OmO as SENPI_CLAUDE_SDK_OAUTH_PINNED_ACCOUNT. In the automatic mode it is a soft pin: OmO still moves a
// request to another account when this one is blocked (account fallback stays on), so a limit never strands a turn. In the
// owner's 고정 mode (a manual pick, Decision.hard) dotz also sets SENPI_CLAUDE_SDK_OAUTH_ACCOUNT_FALLBACK=0 (OmO docs/providers.md:
// "to stop instead of spending another account's allowance"; affinity.js selectAccount and failover.js runFailover then try only
// the pinned account), so a limit pauses the work until it resets instead of moving it. A process dotz spawns starts with
// it (stickyEnv), and a running one follows a switch without a restart: the dotz extension asks the hub
// (POST /api/accounts/check) at the start of every turn and sets the variable in its own process, which OmO's
// anthropic-subscription stream re-reads on each request. The decision is also kept in <DATA_DIR>/account.json, which the
// extension reads when the hub does not answer. Nothing here writes auth.json or touches a token.
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { blockedKind, evaluate, getScriptOpinion, getUsage, readRules, record, resetRulesForTest, stateStamp } from "./account-rules.ts";
import { readAliases } from "./account-alias.ts";
import { balancedPick } from "./account-strategy.ts";
import { authFile } from "./apikey-policy.ts";
import { ownPin } from "./omo-pin.ts";
import { accountHistoryDays, DATA_DIR, log, writeAtomic } from "./config.ts";
import { blockOf, usedAccount } from "./usage-account.ts";

export const PIN_ENV = "SENPI_CLAUDE_SDK_OAUTH_PINNED_ACCOUNT";
export const FALLBACK_ENV = "SENPI_CLAUDE_SDK_OAUTH_ACCOUNT_FALLBACK";
export type SwitchKind = "start" | "limit" | "owner" | "gone" | "rule" | "script" | "manual";
export type AccountSwitch = { at: string; from?: string; to: string; kind: SwitchKind; reason: string; rule?: string };
// order: the owner's account order (rules.json "order"), the fallback order of 자동 전환; readPool never sets it.
export type Pool = { names: string[]; order?: string[]; pinned?: string; blocked: Record<string, { until?: number; reason: string }>; lastSuccess: Record<string, number> };
type Saved = { account?: string; since?: string; reason?: string; used?: string; hard?: boolean };
// The account requests really go to changed (usedAccount): `cause` says why, in machine terms (hub/accounts-api.ts words it).
export type UsedChange = { at: string; from: string; to: string; cause: "limit" | "auth_error" | "gone" | "switch" | "restored"; switchKind?: SwitchKind; rule?: string; until?: number };

// Both account logs (this file and <DATA_DIR>/accounts/decisions.jsonl) keep their last MAX_LOG_LINES lines, trimmed on write.
export const MAX_LOG_LINES = 20;
const stateFile = () => join(DATA_DIR, "account.json");
export const switchesFile = () => join(DATA_DIR, "account-switches.jsonl");

// Pure: oldest first. A switch that lands on the account dotz already ran on (a "start" or a rule pick that equals the
// previous record's account) changed nothing and is dropped; older logs may hold some.
export function dropNoops(list: AccountSwitch[]): AccountSwitch[] {
	const out: AccountSwitch[] = [];
	let prev: string | undefined;
	for (const s of list) {
		if (s.to === (s.from ?? prev)) continue;
		out.push(s);
		prev = s.to;
	}
	return out;
}

const writeSwitches = (list: AccountSwitch[]): void => writeAtomic(switchesFile(), list.length ? `${list.map(x => JSON.stringify(x)).join("\n")}\n` : "");

// Entries older than accountHistoryDays() (default 3) are pruned: dropped from what is read, and the file is rewritten only when
// something was dropped, so reading (and the hub's start) keeps it small at no cost.
function readSwitches(now = Date.now()): AccountSwitch[] {
	let text: string;
	try {
		text = readFileSync(switchesFile(), "utf8");
	} catch {
		return [];
	}
	const all = text.split("\n").flatMap(l => {
		try {
			return l.trim() ? [JSON.parse(l) as AccountSwitch] : [];
		} catch {
			return [];
		}
	});
	const cutoff = now - accountHistoryDays() * 86_400_000;
	const kept = all.filter(s => Date.parse(s.at) >= cutoff);
	if (kept.length < all.length) {
		try {
			writeSwitches(kept);
		} catch (e) {
			log(`account switch log prune failed: ${(e as Error).message}`);
		}
	}
	return dropNoops(kept);
}

// The owner deletes one entry (by its time) or all of them from the usage screen. Returns how many were removed.
export function deleteSwitch(at: string, now = Date.now()): number {
	const list = readSwitches(now);
	const kept = list.filter(s => s.at !== at);
	if (kept.length < list.length) writeSwitches(kept);
	return list.length - kept.length;
}
export function clearSwitches(now = Date.now()): number {
	const n = readSwitches(now).length;
	if (n) writeSwitches([]);
	return n;
}

const readJson = (file: string): any => {
	try {
		return JSON.parse(readFileSync(file, "utf8"));
	} catch {
		return undefined;
	}
};

// OmO's pool for Anthropic models, names and states only (tokens are never read into it).
export function readPool(file = authFile(), now = Date.now()): Pool | undefined {
	const sub = readJson(file)?.["anthropic-subscription"];
	const entries: any[] = Array.isArray(sub?.accounts) ? sub.accounts.filter((a: any) => typeof a?.name === "string" && (a.access || a.store === "claude-cli")) : [];
	const names: string[] = entries.map(a => a.name);
	if (!names.length) return undefined;
	const slots = readJson(join(dirname(file), "credential-pool-state.json"))?.providers?.["anthropic-subscription"]?.lanes?.stored?.slots ?? {};
	const blocked: Pool["blocked"] = {};
	const lastSuccess: Pool["lastSuccess"] = {};
	for (const n of names) {
		const s = slots[n];
		if (typeof s?.lastSuccessAt === "number") lastSuccess[n] = s.lastSuccessAt;
		// auth.json's account entry and the pool state both record blocks (blockOf); an elapsed block is over.
		const b = blockOf(entries.find(a => a.name === n), s, now);
		if (b) blocked[n] = b;
	}
	return { names, ...(typeof sub.pinned === "string" && names.includes(sub.pinned) ? { pinned: sub.pinned } : {}), blocked, lastSuccess };
}

// An account's place in the owner's order (1-based index into `order`); one the owner did not list comes after the listed ones.
const rank = (order: string[] | undefined, n: string) => {
	const i = order?.indexOf(n) ?? -1;
	return i < 0 ? (order?.length ?? 0) : i;
};
// The names in the owner's order; unlisted ones keep their place after the listed ones.
export const inOrder = (names: string[], order?: string[]): string[] => [...names].sort((a, b) => rank(order, a) - rank(order, b));
// Usable accounts first, then the owner's order, then the one that last worked.
const usableFirst = (p: Pool) => [...p.names].sort((a, b) => Number(Boolean(p.blocked[a])) - Number(Boolean(p.blocked[b])) || rank(p.order, a) - rank(p.order, b) || (p.lastSuccess[b] ?? 0) - (p.lastSuccess[a] ?? 0));
const blockText = (p: Pool, n: string) => {
	const b = p.blocked[n];
	return `${n} blocked (${b.reason}${b.until ? `, until ${new Date(b.until).toISOString()}` : ""})`;
};

// Pure: the account to run on now, given the one dotz ran on, and the switch when it changes.
export function decide(current: string | undefined, p: Pool | undefined, now = Date.now()): { account?: string; change?: Omit<AccountSwitch, "at"> } {
	if (!p) return { account: current };
	if (p.pinned) {
		if (p.pinned === current) return { account: current };
		return { account: p.pinned, change: { ...(current ? { from: current } : {}), to: p.pinned, kind: current ? "owner" : "start", reason: `the owner pinned ${p.pinned} in OmO` } };
	}
	if (current && p.names.includes(current) && !p.blocked[current]) return { account: current };
	const pick = usableFirst(p).find(n => n !== current && !p.blocked[n]);
	if (current && p.names.includes(current)) {
		// Blocked, and nothing else usable: stay; OmO reports the limit and dotz pauses as before.
		if (!pick) return { account: current };
		return { account: pick, change: { from: current, to: pick, kind: "limit", reason: `${blockText(p, current)}; ${pick} is usable` } };
	}
	const to = pick ?? usableFirst(p)[0];
	if (current) return { account: to, change: { from: current, to, kind: "gone", reason: `${current} is no longer in OmO's account pool` } };
	return { account: to, change: { to, kind: "start", reason: "first account dotz runs on (OmO's last successful, unblocked)" } };
}

let saved: Saved | undefined;
let checkedStamp = "";
const listeners: ((s: AccountSwitch) => void)[] = [];
// Called after a switch other than the first automatic pick (main.ts keeps the orchestrator's idle keepalive from paying the
// new account's cache for nothing; running processes pick the account up by themselves).
export function onSwitch(fn: (s: AccountSwitch) => void): void {
	listeners.push(fn);
}

const usedListeners: ((c: UsedChange) => void)[] = [];
// Called once per change of the account requests really use, unless the owner made it in the web (quietly).
export function onUsedChange(fn: (c: UsedChange) => void): void {
	usedListeners.push(fn);
}
let quiet = 0;
// The owner's own pick in the web: the change it causes is not announced.
export async function quietly<T>(fn: () => Promise<T>): Promise<T> {
	quiet++;
	try {
		return await fn();
	} finally {
		stickyAccount();
		quiet--;
	}
}

const stamp = (...files: string[]) =>
	files
		.map(f => {
			try {
				const s = statSync(f);
				return `${s.mtimeMs}:${s.size}`;
			} catch {
				return "-";
			}
		})
		.join("|");

export function currentAccount(): string | undefined {
	saved ??= readJson(stateFile()) ?? {};
	return saved?.account;
}
// True while the owner's 고정 mode holds the account (OmO may not fall back).
export function hardPinned(now = Date.now()): boolean {
	stickyAccount(now);
	return Boolean(saved?.hard);
}

// The account dotz runs on now: the owner's rules, then the automatic pick. Re-checked when auth.json, the pool state, the
// rules file, the usage numbers or the script's opinion changed, or once a minute (block expiry, time windows).
export function stickyAccount(now = Date.now()): string | undefined {
	if (!saved) readSwitches(now); // hub start: prune the old history once
	saved ??= readJson(stateFile()) ?? {};
	const file = authFile();
	const key = `${file}|${stamp(file, join(dirname(file), "credential-pool-state.json"))}|${stateStamp()}|${Math.floor(now / 60_000)}`;
	if (key === checkedStamp) return saved?.account;
	checkedStamp = key;
	const pool = readPool(file, now);
	const { change, ...decision } = evaluate({ now, pool: pool && pool.pinned && pool.pinned === ownPin() ? { ...pool, pinned: undefined } : pool, current: saved?.account, usage: getUsage(), rules: readRules(), script: getScriptOpinion(), aliases: readAliases() });
	const account = decision.account;
	if (pool) record(decision);
	const hard = Boolean(decision.hard);
	// 고정: requests stay on the pinned account even while it is blocked
	const used = pool ? (hard ? account : usedAccount(account, pool.names, n => Boolean(pool.blocked[n]), n => pool.lastSuccess[n] ?? 0)) : undefined;
	if (pool && used && (saved?.used !== used || Boolean(saved?.hard) !== hard)) {
		const from = saved?.used;
		saved = { ...saved, used, hard };
		if (!hard) delete saved.hard;
		writeAtomic(stateFile(), `${JSON.stringify(saved, null, 2)}\n`);
		if (from && from !== used && !quiet) {
			const b = pool.blocked[from];
			const c: UsedChange = { at: new Date(now).toISOString(), from, to: used, cause: !pool.names.includes(from) ? "gone" : b ? (blockedKind(b.reason) === "auth_error" ? "auth_error" : "limit") : change?.to === used ? "switch" : "restored", ...(b?.until ? { until: b.until } : {}), ...(change?.to === used ? { switchKind: change.kind, ...(change.rule ? { rule: change.rule } : {}) } : {}) };
			log(`account used: ${from} -> ${used} (${c.cause})`);
			for (const fn of usedListeners) fn(c);
		}
	}
	// Landing on the account it already runs on is no switch: nothing is recorded and `since` stays.
	if (!change || change.to === saved?.account) return account;
	const s: AccountSwitch = { at: new Date(now).toISOString(), ...change };
	saved = { account, since: s.at, reason: s.reason, ...(saved?.used ? { used: saved.used } : {}), ...(hard ? { hard } : {}) };
	writeAtomic(stateFile(), `${JSON.stringify(saved, null, 2)}\n`);
	writeAtomic(switchesFile(), `${dropNoops([...readSwitches(now), s]).slice(-MAX_LOG_LINES).map(x => JSON.stringify(x)).join("\n")}\n`);
	log(`account ${s.kind}: ${s.from ? `${s.from} -> ` : ""}${s.to} (${s.reason})`);
	if (s.kind !== "start") for (const fn of listeners) fn(s);
	return account;
}

// The "usage-balanced" strategy (hub/account-strategy.ts): the usable account with the most room left, for a session that
// starts now. Undefined under any other strategy and in 고정 mode, where the pinned account holds.
export function balancedStart(now = Date.now()): string | undefined {
	if (hardPinned(now)) return undefined;
	const pool = readPool(undefined, now);
	return pool ? balancedPick(inOrder(pool.names, readRules().order), pool.blocked, now) : undefined;
}

// What a spawned OmO process gets: its pin to the sticky account (soft, or hard with fallback off in 고정 mode); nothing when
// OmO has no subscription accounts.
export function stickyEnv(now = Date.now()): Record<string, string> {
	const a = stickyAccount(now);
	const start = a ? balancedStart(now) : undefined;
	if (start) return { [PIN_ENV]: start };
	return a ? { [PIN_ENV]: a, ...(saved?.hard ? { [FALLBACK_ENV]: "0" } : {}) } : {};
}

// The usage screen: the account, since when and why, and the latest switches (newest first).
export function accountView(limit = MAX_LOG_LINES, now = Date.now()): { account?: string; since?: string; reason?: string; switches: AccountSwitch[] } {
	const account = stickyAccount(now);
	const switches = readSwitches(now).slice(-limit).reverse();
	return { ...(account ? { account } : {}), ...(saved?.since ? { since: saved.since } : {}), ...(saved?.reason ? { reason: saved.reason } : {}), switches };
}

// Tests: forget the in-memory state so the next call re-reads the files.
export function resetStickyForTest(): void {
	saved = undefined;
	checkedStamp = "";
	listeners.length = 0;
	usedListeners.length = 0;
	quiet = 0;
	resetRulesForTest();
}
