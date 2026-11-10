import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decisionsFile, rulesFile } from "./account-rules.ts";
import { balancedStart, FALLBACK_ENV, PIN_ENV, resetStickyForTest, stickyEnv, switchesFile } from "./account-sticky.ts";
import { balancedAccount, omoSettingsFile, readStrategy, strategyFile, writeStrategy } from "./account-strategy.ts";
import { accountsRoute } from "./accounts-api.ts";
import { authFile } from "./apikey-policy.ts";
import { DATA_DIR } from "./config.ts";

const NOW = Date.parse("2026-10-21T10:00:00+09:00");
const poolFile = () => join(process.env.OMO_CODING_AGENT_DIR!, "credential-pool-state.json");
const usageFile = () => join(process.env.OMO_CODING_AGENT_DIR!, "subscription-usage.json");
const files = () => [authFile(), poolFile(), usageFile(), omoSettingsFile(), strategyFile(), join(DATA_DIR, "account.json"), switchesFile(), rulesFile(), decisionsFile()];
const call = (method: string, path: string, body?: unknown) => accountsRoute(new Request(`http://x${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), new URL(`http://x${path}`));

const win = (id: string, usedPercent: number, resetsAt: string | number = new Date(NOW + 3_600_000).toISOString()) => ({ id, usedPercent, resetsAt });
const usage = (accounts: Record<string, unknown[]>) => ({ accounts: Object.fromEntries(Object.entries(accounts).map(([name, windows]) => [`anthropic-subscription/${name}`, { windows }])) });
function setUp(names: string[], accounts: Record<string, unknown[]>, slots: Record<string, unknown> = {}): void {
	writeFileSync(authFile(), JSON.stringify({ "anthropic-subscription": { accounts: names.map(name => ({ name, access: "fake" })) } }));
	writeFileSync(poolFile(), JSON.stringify({ providers: { "anthropic-subscription": { lanes: { stored: { slots } } } } }));
	writeFileSync(usageFile(), JSON.stringify(usage(accounts)));
}
const clean = () => {
	for (const f of files()) rmSync(f, { force: true });
	resetStickyForTest();
};
beforeEach(clean);
afterEach(clean);

test("the account with the lowest 5-hour use wins, a tie goes to the lower 7-day use, then to the owner's order", () => {
	const names = ["a", "b", "c"];
	expect(balancedAccount(names, usage({ a: [win("claude:5h", 60), win("claude:7d", 5)], b: [win("claude:5h", 20), win("claude:7d", 90)], c: [win("claude:5h", 40)] }), NOW)).toBe("b");
	expect(balancedAccount(names, usage({ a: [win("claude:5h", 30), win("claude:7d", 50)], b: [win("claude:5h", 30), win("claude:7d", 10)], c: [win("claude:5h", 30), win("claude:7d", 50)] }), NOW)).toBe("b");
	expect(balancedAccount(names, usage({ a: [win("claude:5h", 30), win("claude:7d", 10)], b: [win("claude:5h", 30), win("claude:7d", 10)] }), NOW)).toBe("a");
});

test("an account without a reading ranks last, unless none has one; a window past its reset counts as unused", () => {
	expect(balancedAccount(["a", "b"], usage({ a: [], b: [win("claude:5h", 99)] }), NOW)).toBe("b");
	expect(balancedAccount(["a", "b"], usage({ a: [], b: [] }), NOW)).toBe("a");
	expect(balancedAccount(["a", "b"], undefined, NOW)).toBe("a");
	expect(balancedAccount([], usage({}), NOW)).toBeUndefined();
	expect(balancedAccount(["a", "b"], usage({ a: [win("claude:5h", 10)], b: [win("claude:5h", 100, new Date(NOW - 1000).toISOString())] }), NOW)).toBe("b");
	expect(balancedAccount(["a", "b"], usage({ a: [win("claude:5h", 10)], b: [win("claude:5h", 100, NOW + 1000)] }), NOW)).toBe("a");
});

test("OmO's three values are written to its settings.json beside its other keys; usage-balanced stays in dotz's own file", () => {
	expect(readStrategy()).toBe("cache-affine");
	writeFileSync(omoSettingsFile(), JSON.stringify({ theme: "dark", anthropicSubscriptionProvider: { other: 1 } }));
	writeStrategy("round-robin");
	expect(JSON.parse(readFileSync(omoSettingsFile(), "utf8"))).toEqual({ theme: "dark", anthropicSubscriptionProvider: { other: 1, accountStrategy: "round-robin" } });
	expect(readStrategy()).toBe("round-robin");

	const before = readFileSync(omoSettingsFile(), "utf8");
	writeStrategy("usage-balanced");
	expect(readFileSync(omoSettingsFile(), "utf8")).toBe(before);
	expect(readStrategy()).toBe("usage-balanced");

	writeStrategy("cache-affine");
	expect(existsSync(strategyFile())).toBe(false);
	expect(JSON.parse(readFileSync(omoSettingsFile(), "utf8"))).toEqual({ theme: "dark", anthropicSubscriptionProvider: { other: 1 } });
	expect(readStrategy()).toBe("cache-affine");
});

test("the default writes nothing where there is no settings.json, and a settings.json that is not JSON is left as it is", () => {
	writeStrategy("cache-affine");
	expect(existsSync(omoSettingsFile())).toBe(false);
	writeFileSync(omoSettingsFile(), "{ not json");
	expect(() => writeStrategy("fill-first")).toThrow();
	expect(readFileSync(omoSettingsFile(), "utf8")).toBe("{ not json");
});

test("a session that starts under usage-balanced is pinned to the usable account with the most room; off by default", () => {
	setUp(["default", "work", "spare"], { default: [win("claude:5h", 80)], work: [win("claude:5h", 30)], spare: [win("claude:5h", 5)] }, { spare: { blockReason: "rate_limit", blockedUntil: NOW + 3_600_000 } });
	expect(balancedStart(NOW)).toBeUndefined();
	expect(stickyEnv(NOW)).toEqual({ [PIN_ENV]: "default" });

	writeStrategy("usage-balanced");
	expect(balancedStart(NOW)).toBe("work");
	expect(stickyEnv(NOW)).toEqual({ [PIN_ENV]: "work" });
});

test("고정 mode holds its account under usage-balanced", async () => {
	setUp(["default", "work"], { default: [win("claude:5h", 80)], work: [win("claude:5h", 30)] });
	writeStrategy("usage-balanced");
	await call("PUT", "/api/accounts/mode", { mode: "pinned", account: "default" });
	expect(balancedStart()).toBeUndefined();
	expect(stickyEnv()).toEqual({ [PIN_ENV]: "default", [FALLBACK_ENV]: "0" });
});

test("PUT /api/accounts/strategy saves the value and the accounts body reports it; an unknown value is refused", async () => {
	setUp(["default", "work"], {});
	const saved = await call("PUT", "/api/accounts/strategy", { strategy: "usage-balanced" });
	expect(((await saved!.json()) as { strategy: string }).strategy).toBe("usage-balanced");
	const rr = await call("PUT", "/api/accounts/strategy", { strategy: "round-robin" });
	expect(((await rr!.json()) as { strategy: string }).strategy).toBe("round-robin");
	expect(JSON.parse(readFileSync(omoSettingsFile(), "utf8")).anthropicSubscriptionProvider.accountStrategy).toBe("round-robin");
	expect((await call("PUT", "/api/accounts/strategy", { strategy: "random" }))!.status).toBe(400);
	expect(readStrategy()).toBe("round-robin");
});
