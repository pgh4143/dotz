import { afterEach, beforeEach, expect, test } from "bun:test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { aliasesFile, readAliases, setAlias } from "./account-alias.ts";
import { decisionsFile, readRules, rulesFile, setOnLimit, setUsage, writeRules } from "./account-rules.ts";
import { type AccountSwitch, FALLBACK_ENV, PIN_ENV, resetStickyForTest, stickyAccount, stickyEnv, switchesFile } from "./account-sticky.ts";
import { accountAnswer, accountAsk, accountsBody, KIND_TEXT, accountsRoute, accountText, labeledAccountView, pinnedLimitAlert, pinnedLimitNotice, switchNotice, switchText } from "./accounts-api.ts";
import { authFile } from "./apikey-policy.ts";
import { DATA_DIR } from "./config.ts";
import { parseChoices } from "./choices.ts";
import { msg } from "./i18n.ts";
import { limitsCard, runCommand } from "./control.ts";
import { buildQuota } from "./providers.ts";
import { limitsOf, type AccountReport } from "./usage-account.ts";

const WED_10 = Date.parse("2026-10-21T10:00:00+09:00");
const ALIASES = { default: "개인 계정", work: "회사 계정" };
const poolFile = () => join(process.env.OMO_CODING_AGENT_DIR!, "credential-pool-state.json");
const files = () => [authFile(), poolFile(), join(DATA_DIR, "account.json"), switchesFile(), rulesFile(), decisionsFile(), aliasesFile()];

function writeAuth(names: string[]): void {
	writeFileSync(authFile(), JSON.stringify({ "anthropic-subscription": { accounts: names.map(name => ({ name, access: "fake" })) } }));
}
function writeSlots(slots: Record<string, unknown>): void {
	writeFileSync(poolFile(), JSON.stringify({ providers: { "anthropic-subscription": { lanes: { stored: { slots } } } } }));
}
const report = (account: string): AccountReport => ({ provider: "anthropic", account, via: "omo-sticky", limits: limitsOf({ five_hour: { utilization: 38 }, seven_day: { utilization: 20 } }), fetchedAt: WED_10 });
const sw = (over: Partial<AccountSwitch> = {}): AccountSwitch => ({ at: "2026-10-21T01:00:00.000Z", from: "default", to: "work", kind: "rule", rule: "근무 시간", reason: '규칙 "근무 시간"', ...over });
const cmdNote = async (text: string) => (await runCommand(text)).note ?? "";
const call = (method: string, path: string, body?: unknown) => accountsRoute(new Request(`http://x${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), new URL(`http://x${path}`));

beforeEach(() => {
	for (const f of files()) rmSync(f, { force: true });
	resetStickyForTest();
});
afterEach(() => {
	for (const f of files()) rmSync(f, { force: true });
	resetStickyForTest();
});

test("the 한도 card names the account by its alias; the raw ids only sit on the note line", () => {
	const c = limitsCard(report("default"), sw(), ALIASES);
	expect(c.facts.find(f => f.label === msg().cmd.account)!.value).toBe("개인 계정");
	expect(c.facts.find(f => f.label === msg().cmd.lastSwitch)!.value).toContain("개인 계정");
	for (const f of c.facts) expect(`${f.label} ${f.value}`).not.toMatch(/default|work/);
	expect(c.note).toBe(`${msg().cmd.accountId}: default → work`);
	expect(c.text).toContain("개인 계정");
});

test("without an alias the 한도 card shows the id and adds no id line", () => {
	const c = limitsCard(report("default"), undefined, {});
	expect(c.facts.find(f => f.label === msg().cmd.account)!.value).toBe("default");
	expect(c.note).toBeUndefined();
	expect(limitsCard(undefined, undefined, {}).tone).toBe("warn");
});

test("a first pick is not announced as a switch in the 한도 card", () => {
	const c = limitsCard(report("default"), sw({ kind: "start", from: undefined, to: "default" }), ALIASES);
	expect(c.facts.some(f => f.label === msg().cmd.lastSwitch)).toBe(false);
	expect(c.note).toBe(`${msg().cmd.accountId}: default`);
});

test("switchText and switchNotice use labels, never raw ids", () => {
	expect(switchText(sw(), ALIASES)).toBe('개인 계정 → 회사 계정 (규칙 "근무 시간")');
	const limit = sw({ kind: "limit", rule: undefined, reason: "default blocked (rate_limit, until 2026-10-21T05:00:00.000Z); work is usable" });
	expect(switchText(limit, ALIASES)).toBe(`개인 계정 → 회사 계정 (${KIND_TEXT.limit})`);
	expect(switchText(sw({ kind: "start", from: undefined, to: "default", rule: undefined, reason: "first account" }), ALIASES)).toBe(`개인 계정 (${KIND_TEXT.start})`);
	expect(switchText(sw({ to: "other" }), {})).toBe('default → other (규칙 "근무 시간")');
	// The notice names both accounts by label, from before to, and never a raw id; a rule switch also names the rule.
	const manual = sw({ from: "work", to: "default", kind: "manual", rule: undefined, reason: "직접 고름" });
	for (const [s, from, to] of [[sw(), "개인 계정", "회사 계정"], [limit, "개인 계정", "회사 계정"], [manual, "회사 계정", "개인 계정"]] as const) {
		const n = switchNotice(s, ALIASES);
		expect(n).not.toMatch(/default|work/);
		expect(n.indexOf(from)).toBeGreaterThanOrEqual(0);
		expect(n.indexOf(to)).toBeGreaterThan(n.indexOf(from));
	}
	expect(switchNotice(sw(), ALIASES)).toContain("근무 시간");
	expect(new Set([sw(), limit, manual].map(s => switchNotice(s, ALIASES))).size).toBe(3);
});

test("accountsBody carries labels, states, decision, rules as text, manual pick, script and files", () => {
	writeAuth(["default", "work"]);
	writeSlots({ work: { blockReason: "rate_limit", blockedUntil: WED_10 + 3_600_000 } });
	for (const [k, v] of Object.entries(ALIASES)) setAlias(k, v);
	setUsage({ default: { five_hour_left: 62, seven_day_left: 80 } });
	writeRules({ manual: { account: "회사 계정", until: "2026-10-21T18:00:00+09:00" }, rules: [{ name: "근무 시간", when: { days: ["mon", "tue", "wed", "thu", "fri"], from: "09:00", to: "18:00" }, do: { pin: "work" } }], script: { path: "/tmp/pick.sh" } });
	const b = accountsBody(WED_10);
	expect(b.accounts).toEqual([
		{ name: "default", order: 1, alias: "개인 계정", label: "개인 계정", current: false, blocked: null, blocked_until: null, blocked_tag: null, five_hour_left: 62, seven_day_left: 80 },
		{ name: "work", order: 2, alias: "회사 계정", label: "회사 계정", current: true, blocked: "rate_limit", blocked_until: new Date(WED_10 + 3_600_000).toISOString(), blocked_tag: expect.stringContaining("11:00"), five_hour_left: null, seven_day_left: null },
	]);
	// the owner's pick (고정) holds although it is blocked
	expect(b.decision).toMatchObject({ account: "work", label: "회사 계정", source: "manual", hard: true });
	expect(b.mode).toBe("pinned");
	expect(b.rules.rules?.[0]?.name).toBe("근무 시간");
	expect(b.rules_text.map(r => r.index)).toEqual([0]);
	for (const part of ["09:00-18:00", "회사 계정"]) expect(b.rules_text[0]!.text).toContain(part);
	for (const part of ["회사 계정", "18:00"]) expect(b.manual_text).toContain(part);
	expect(b.script).toEqual({ path: "/tmp/pick.sh", timeout_ms: 5000, every_minutes: 5, last: null });
	expect(Object.keys(b.files).sort()).toEqual(["aliases", "decisions", "rules"]);
	for (const f of Object.values(b.files)) expect(f.startsWith("/")).toBe(true);
	expect(Array.isArray(b.switches)).toBe(true);
	expect(Object.keys(b).sort()).toEqual(["accounts", "chosen", "decision", "files", "login_providers", "manual_text", "mode", "providers", "rules", "rules_text", "script", "switches", "used"]);
	// the Claude group mirrors the same accounts, shaped like the other providers' groups
	expect(b.providers[0]).toMatchObject({ id: "anthropic", name: "Claude 구독", multi: true, can_pin: true, can_delete: true });
	expect(b.providers[0]!.accounts.map(a => [a.name, a.current, a.pinned, a.label, a.windows.map(w => w.label)])).toEqual([["default", false, false, "개인 계정", ["5시간", "7일"]], ["work", true, false, "회사 계정", []]]);
	expect(b.providers[0]!.accounts[1]!.blocked_tag).toContain("11:00");
	expect(b.chosen).toMatchObject({ name: "work", source: "manual", blocked: "rate_limit", used_instead: null });
	expect(b.chosen!.text).toContain("멈춰 있어요");
});

test("accountsBody switches carry from_label/to_label/kind_text and labeledAccountView mirrors them", () => {
	writeAuth(["default", "work"]);
	for (const [k, v] of Object.entries(ALIASES)) setAlias(k, v);
	expect(stickyAccount()).toBe("default");
	writeSlots({ default: { blockReason: "rate_limit", blockedUntil: Date.now() + 3_600_000 } });
	expect(stickyAccount(Date.now() + 61_000)).toBe("work");
	const s = accountsBody().switches[0];
	expect(s).toMatchObject({ from: "default", to: "work", from_label: "개인 계정", to_label: "회사 계정", kind: "limit", kind_text: KIND_TEXT.limit });
	const v = labeledAccountView();
	expect(v.account).toBe("work");
	expect(v.account_label).toBe("회사 계정");
	expect(v.switches[0]).toMatchObject({ from_label: "개인 계정", to_label: "회사 계정", kind_text: KIND_TEXT.limit });
});

test("DELETE /api/accounts/switches removes one entry by its time, or all of them without `at`", async () => {
	const now = Date.now();
	const list = [1, 2, 3].map(i => sw({ at: new Date(now - i * 60_000).toISOString(), from: i % 2 ? "default" : "work", to: i % 2 ? "work" : "default" }));
	writeFileSync(switchesFile(), `${list.map(s => JSON.stringify(s)).join("\n")}\n`);
	const one = await call("DELETE", `/api/accounts/switches?at=${encodeURIComponent(list[1].at)}`);
	expect(await one!.json()).toEqual({ removed: 1 });
	expect(accountsBody().switches.map(s => s.at)).toEqual([list[2].at, list[0].at]);
	expect(await (await call("DELETE", "/api/accounts/switches"))!.json()).toEqual({ removed: 2 });
	expect(accountsBody().switches).toEqual([]);
});

test("/account shows the account, why, each account, the rules and the script; ids only on a detail line", async () => {
	writeAuth(["default", "work"]);
	writeSlots({ work: { blockReason: "rate_limit", blockedUntil: Date.now() + 3_600_000 } });
	for (const [k, v] of Object.entries(ALIASES)) setAlias(k, v);
	setUsage({ default: { five_hour_left: 62, seven_day_left: 80 } });
	writeRules({ rules: [{ name: "근무 시간", when: { days: ["mon", "tue", "wed", "thu", "fri"], from: "09:00", to: "18:00" }, do: { pin: "work" } }], script: { path: "/tmp/pick.sh" } });
	const out = await cmdNote("/account");
	for (const part of ["개인 계정", "회사 계정", "62%", "80%", "09:00-18:00", "/tmp/pick.sh"]) expect(out).toContain(part);
	for (const l of out.split("\n").filter(l => l.includes("default") || l.includes("work"))) expect(l.startsWith("-# ")).toBe(true);
	expect(await cmdNote("!account")).toBe(out);
	expect(accountText()).toBe(out);
});

test("/account <alias> picks manually, /account auto clears it, /account alias sets and clears an alias", async () => {
	writeAuth(["default", "work"]);
	for (const [k, v] of Object.entries(ALIASES)) setAlias(k, v);
	expect(stickyAccount()).toBe("default");
	const picked = await cmdNote("/account 회사 계정");
	expect(picked.split("\n")).toHaveLength(1);
	expect(picked).toContain("회사 계정");
	expect(readRules().manual).toEqual({ account: "work" });
	expect(stickyAccount()).toBe("work");
	expect((await cmdNote("/account work")).split("\n")).toHaveLength(1);
	const auto = await cmdNote("/account auto");
	expect(auto.split("\n")).toHaveLength(1);
	expect(readRules().manual).toBeUndefined();
	const setNote = await cmdNote("/account alias work 출장 계정");
	for (const part of ["work", "출장 계정"]) expect(setNote).toContain(part);
	expect(readAliases().work).toBe("출장 계정");
	expect(await cmdNote("/account alias work")).toContain("work");
	expect(readAliases().work).toBeUndefined();
	for (const bad of ["/account nobody", "/account alias nobody 이름"]) {
		const c = await runCommand(bad);
		expect(c.tone).toBe("err");
		expect(c.note).toContain("nobody");
	}
});

test("a manual pick of a blocked account is applied (고정): the account does not move and the note says it waits", async () => {
	writeAuth(["default", "work"]);
	writeSlots({ work: { blockReason: "rate_limit", blockedUntil: Date.now() + 3_600_000 } });
	for (const [k, v] of Object.entries(ALIASES)) setAlias(k, v);
	const out = await cmdNote("/account work");
	expect(readRules().manual).toEqual({ account: "work" });
	expect(stickyAccount()).toBe("work");
	for (const part of ["회사 계정", "고정"]) expect(out).toContain(part);
});

test("quota providers carry the account's label next to its id", () => {
	setAlias("default", "개인 계정");
	const q = buildQuota([{ provider: "anthropic", account: "default", limits: [{ id: "anthropic:5h", label: "Claude 5 Hour", window: { id: "5h" }, amount: { used: 38, limit: 100, remaining: 62, unit: "percent" }, status: "ok" }] } as any], ["anthropic"]);
	expect(q.providers[0]).toMatchObject({ account: "default", account_label: "개인 계정" });
});

const NAMES = ["default", "work"];
const ask = (t: string) => accountAsk(t, NAMES, ALIASES);

test("chat matcher: short account requests match", () => {
	expect(ask("계정 바꿔줘")).toEqual({ kind: "other" });
	expect(ask("계정 전환해줘")).toEqual({ kind: "other" });
	expect(ask("다른 계정으로 바꿔줘")).toEqual({ kind: "other" });
	expect(ask("개인 계정으로 바꿔줘")).toEqual({ kind: "use", account: "default" });
	expect(ask("회사 계정으로")).toEqual({ kind: "use", account: "work" });
	expect(ask("회사 계정으로 전환해줘")).toEqual({ kind: "use", account: "work" });
	expect(ask("회사 계정 써줘")).toEqual({ kind: "use", account: "work" });
	expect(ask("work로 바꿔줘")).toEqual({ kind: "use", account: "work" });
	expect(ask("계정 자동으로")).toEqual({ kind: "auto" });
	expect(ask("계정 자동으로 해줘")).toEqual({ kind: "auto" });
	expect(ask("지금 무슨 계정이야?")).toEqual({ kind: "show" });
	expect(ask("현재 계정 알려줘")).toEqual({ kind: "show" });
});

test("chat matcher: ordinary sentences about accounts are left to the orchestrator", () => {
	for (const t of [
		"계정 관련 버그 고쳐줘",
		"깃허브 계정으로 로그인하는 법 알려줘",
		"회사 계정으로 로그인 기능 추가해줘",
		"회사 계정으로 보낸 메일 확인해줘",
		"계정 삭제해줘",
		"계정 바꾸는 기능 만들어줘",
		"계정 변경 이력 보여줘",
		"work 폴더 정리해줘",
		"개인 계정",
		"회사 계정 한도 올려줘",
		"계정 전환 로직을 리팩터링해줘",
		"",
		"계정 바꿔줘\n그리고 테스트도 돌려줘",
		"지금 무슨 계정이야 그리고 왜 한도에 자꾸 걸리는지 로그를 보고 원인을 분석해서 정리해줘",
	])
		expect(ask(t)).toBeUndefined();
	expect(accountAsk("깃허브 계정으로 바꿔줘", NAMES, ALIASES)).toBeUndefined();
});

test("chat answers: a named account picks, 자동 clears, one other usable account switches, several are listed", async () => {
	writeAuth(["default", "work"]);
	for (const [k, v] of Object.entries(ALIASES)) setAlias(k, v);
	expect(stickyAccount()).toBe("default");
	expect(await accountAnswer({ kind: "show" })).toContain("개인 계정");
	expect(stickyAccount()).toBe("default");
	expect(await accountAnswer({ kind: "other" })).toContain("회사 계정");
	expect(stickyAccount()).toBe("work");
	expect(await accountAnswer({ kind: "use", account: "default" })).toContain("개인 계정");
	expect(stickyAccount()).toBe("default");
	expect(readRules().manual).toEqual({ account: "default" });
	await accountAnswer({ kind: "auto" });
	expect(readRules().manual).toBeUndefined();

	writeAuth(["default", "work", "spare"]);
	setAlias("spare", "예비 계정");
	const listed = await accountAnswer({ kind: "other" });
	expect(listed).toContain("회사 계정");
	expect(listed).toContain("예비 계정");
	expect(listed).not.toContain("default");
	expect(stickyAccount()).toBe("default");
});

test("API: GET body, PUT alias (empty clears), POST use (unknown -> 400, auto clears)", async () => {
	writeAuth(["default", "work"]);
	const got = await call("GET", "/api/accounts");
	expect(got?.status).toBe(200);
	expect(((await got!.json()) as any).accounts).toHaveLength(2);

	const set = await call("PUT", "/api/accounts/alias", { key: "work", alias: "회사 계정" });
	expect(((await set!.json()) as any).accounts[1]).toMatchObject({ alias: "회사 계정", label: "회사 계정" });
	const cleared = await call("PUT", "/api/accounts/alias", { key: "work", alias: "" });
	expect(((await cleared!.json()) as any).accounts[1]).toMatchObject({ alias: null, label: "work" });
	expect((await call("PUT", "/api/accounts/alias", { alias: "x" }))?.status).toBe(400);

	setAlias("work", "회사 계정");
	const used = await call("POST", "/api/accounts/use", { account: "회사 계정" });
	expect(used?.status).toBe(200);
	const body = (await used!.json()) as any;
	expect(body.decision).toMatchObject({ account: "work", source: "manual" });
	expect(body.manual_text).toContain("회사 계정");
	const bad = await call("POST", "/api/accounts/use", { account: "nobody" });
	expect(bad?.status).toBe(400);
	expect(((await bad!.json()) as any).error).toContain("nobody");
	const auto = await call("POST", "/api/accounts/use", { account: "auto" });
	expect(((await auto!.json()) as any).manual_text).toBeNull();
	expect((await call("POST", "/api/accounts/use", { account: "work", until: "not a date" }))?.status).toBe(400);
	expect(await call("POST", "/api/accounts/check")).toBeUndefined();
});

test("API: PUT rules stores the whole file; a validation error is a 400 naming the field and changes nothing", async () => {
	writeAuth(["default", "work"]);
	const ok = await call("PUT", "/api/accounts/rules", { rules: { rules: [{ name: "밤", when: { from: "22:00", to: "06:00" }, do: { pin: "work" } }] } });
	expect(ok?.status).toBe(200);
	const text = ((await ok!.json()) as any).rules_text[0].text as string;
	for (const part of ["22:00-06:00", "work"]) expect(text).toContain(part);
	const bad = await call("PUT", "/api/accounts/rules", { rules: { rules: [{ when: { from: "25:00" }, do: { pin: "work" } }] } });
	expect(bad?.status).toBe(400);
	expect(((await bad!.json()) as any).error).toContain("규칙 1번.when.from");
	expect(readRules().rules?.[0]?.name).toBe("밤");
	const missing = await call("PUT", "/api/accounts/rules", {});
	expect(missing?.status).toBe(400);
	expect(typeof ((await missing!.json()) as any).error).toBe("string");
});

test("계정 선택 방식: PUT /mode writes the setting; 고정 never changes account on a block, 자동 전환 does", async () => {
	writeAuth(["default", "work"]);
	writeSlots({ default: { blockReason: "rate_limit", blockedUntil: Date.now() + 3_600_000 } });
	const pinned = await call("PUT", "/api/accounts/mode", { mode: "pinned", account: "default" });
	expect(pinned?.status).toBe(200);
	const body = (await pinned!.json()) as any;
	expect(body.mode).toBe("pinned");
	expect(body.chosen).toMatchObject({ name: "default", blocked: "rate_limit", used_instead: null });
	expect(readRules().manual).toMatchObject({ account: "default" });
	// default is blocked, work is free: 고정 stays, OmO is told not to fall back
	expect(stickyAccount()).toBe("default");
	expect(stickyEnv()).toEqual({ [PIN_ENV]: "default", [FALLBACK_ENV]: "0" });
	expect(accountsBody().accounts.find(a => a.current)?.name).toBe("default");

	const auto = await call("PUT", "/api/accounts/mode", { mode: "auto" });
	expect(((await auto!.json()) as any).mode).toBe("auto");
	expect(readRules().manual).toBeUndefined();
	// the same block now moves the account and fallback stays on
	expect(stickyAccount()).toBe("work");
	expect(stickyEnv()).toEqual({ [PIN_ENV]: "work" });

	// 고정 without an account pins the one requests use now
	const same = await call("PUT", "/api/accounts/mode", { mode: "pinned" });
	expect(((await same!.json()) as any).chosen).toMatchObject({ name: "work", source: "manual" });
	expect((await call("PUT", "/api/accounts/mode", { mode: "nope" }))?.status).toBe(400);
});

test("계정 순서: PUT /order is kept in rules.json beside the other settings, numbers the accounts, and 자동 전환 falls back by it", async () => {
	writeAuth(["a", "b", "c", "d", "e"]);
	writeSlots({ a: { lastSuccessAt: Date.now() } });
	writeRules({ rules: [{ do: { auto: true } }] });
	const order = ["c", "d", "a", "b", "e"];
	const res = await call("PUT", "/api/accounts/order", { order });
	expect(res?.status).toBe(200);
	const body = (await res!.json()) as any;
	expect(body.accounts.map((a: any) => [a.name, a.order])).toEqual(order.map((n, i) => [n, i + 1]));
	// persisted in the accounts settings file (not auth.json), other settings untouched, still there after a restart
	resetStickyForTest();
	expect(readRules()).toEqual({ rules: [{ do: { auto: true } }], order });
	expect(accountsBody().accounts.map(a => a.name)).toEqual(order);
	// the first pick and every fallback follow the order, not the account that answered last (a)
	expect(stickyAccount()).toBe("c");
	writeSlots({ a: { lastSuccessAt: Date.now() }, c: { blockReason: "rate_limit", blockedUntil: Date.now() + 3_600_000 } });
	expect(stickyAccount()).toBe("d");
	writeSlots({ a: { lastSuccessAt: Date.now() }, c: { blockReason: "rate_limit", blockedUntil: Date.now() + 3_600_000 }, d: { blockReason: "rate_limit", blockedUntil: Date.now() + 3_600_000 } });
	expect(stickyAccount()).toBe("a");
	// an account that is not in the pool is refused and nothing changes
	expect((await call("PUT", "/api/accounts/order", { order: ["a", "zzz"] }))?.status).toBe(400);
	expect((await call("PUT", "/api/accounts/order", { order: "a" }))?.status).toBe(400);
	expect(readRules().order).toEqual(order);
});

test("고정 account at its limit: the alert says which account and until when, and offers 자동 전환으로 바꾸기 (answered by the gateway)", async () => {
	writeAuth(["default", "work"]);
	for (const [k, v] of Object.entries(ALIASES)) setAlias(k, v);
	const until = Date.now() + 3_600_000;
	writeSlots({ default: { blockReason: "rate_limit", blockedUntil: until } });
	expect(pinnedLimitAlert(until)).toBeUndefined(); // 자동 전환: nothing to offer
	await call("PUT", "/api/accounts/mode", { mode: "pinned", account: "default" });
	const text = pinnedLimitAlert(until)!;
	expect(text).toContain("개인 계정");
	expect(text).toContain(msg().accountLimit.questionTitle);
	const labels = parseChoices(text).options.map(o => o.label);
	expect(labels[0]).toBe(msg().accountLimit.switchChoice);
	// the clicked option goes out as "1) <label>"; the gateway reads it as 자동
	expect(accountAsk("1) 자동 전환으로 바꾸기", ["default", "work"], ALIASES)).toEqual({ kind: "auto" });
	await accountAnswer({ kind: "auto" });
	expect(readRules().manual).toBeUndefined();
	expect(pinnedLimitAlert(until)).toBeUndefined();
});

test("on_limit unset: the pinned limit asks once with both choices; answering 기다리기 remembers it and keeps the pin", async () => {
	writeAuth(["default", "work"]);
	for (const [k, v] of Object.entries(ALIASES)) setAlias(k, v);
	const until = Date.now() + 3_600_000;
	writeSlots({ default: { blockReason: "rate_limit", blockedUntil: until } });
	await call("PUT", "/api/accounts/mode", { mode: "pinned", account: "default" });

	const asked = (await pinnedLimitNotice(until))!;
	expect(parseChoices(asked).options.map(o => o.label)).toEqual([msg().accountLimit.switchChoice, msg().accountLimit.waitChoice]);
	expect(readRules().on_limit).toBeUndefined();

	// the clicked option goes out as "2) <label>"; the gateway reads it and saves it, so the question is not asked again
	expect(accountAsk(`2) ${msg().accountLimit.waitChoice}`, ["default", "work"], ALIASES)).toEqual({ kind: "wait" });
	await accountAnswer({ kind: "wait" });
	expect(readRules().on_limit).toBe("wait");
	expect(readRules().manual).toEqual({ account: "default" });
	const again = (await pinnedLimitNotice(until))!;
	expect(parseChoices(again).options).toEqual([]);
	expect(again).not.toContain(msg().accountLimit.questionTitle);
	expect(again).toContain("개인 계정");
	expect(accountsBody().mode).toBe("pinned");
});

test("on_limit wait: no question and no mode change, just one plain notice with the time work resumes", async () => {
	writeAuth(["default", "work"]);
	for (const [k, v] of Object.entries(ALIASES)) setAlias(k, v);
	writeRules({ manual: { account: "default" }, on_limit: "wait" });
	const until = Date.now() + 3_600_000;
	writeSlots({ default: { blockReason: "rate_limit", blockedUntil: until } });

	const text = (await pinnedLimitNotice(until))!;
	expect(parseChoices(text).options).toEqual([]);
	expect(text).not.toContain(msg().accountLimit.questionTitle);
	expect(text).toContain("개인 계정");
	expect(readRules().manual).toEqual({ account: "default" });
	expect(accountsBody().mode).toBe("pinned");
});

test("on_limit switch: no question, it turns on 자동 전환 and says it moved to the next account", async () => {
	writeAuth(["default", "work"]);
	for (const [k, v] of Object.entries(ALIASES)) setAlias(k, v);
	writeRules({ manual: { account: "default" }, on_limit: "switch" });
	const until = Date.now() + 3_600_000;
	writeSlots({ default: { blockReason: "rate_limit", blockedUntil: until } });

	const text = (await pinnedLimitNotice(until))!;
	expect(parseChoices(text).options).toEqual([]);
	expect(text).not.toContain(msg().accountLimit.questionTitle);
	expect(text).toContain("회사 계정");
	expect(readRules().manual).toBeUndefined();
	expect(accountsBody().mode).toBe("auto");
});

test("PUT /api/accounts/on-limit saves the choice and leaves the mode route and its behaviour intact", async () => {
	const saved = await call("PUT", "/api/accounts/on-limit", { on_limit: "wait" });
	expect(saved?.status).toBe(200);
	expect(((await saved!.json()) as any).rules.on_limit).toBe("wait");
	expect(readRules().on_limit).toBe("wait");
	expect((await call("PUT", "/api/accounts/on-limit", { on_limit: "sometimes" }))?.status).toBe(400);
	expect((await call("PUT", "/api/accounts/mode", { mode: "auto" }))?.status).toBe(200);
	expect(readRules().on_limit).toBe("wait");
	setOnLimit(undefined);
	expect(readRules().on_limit).toBeUndefined();
});

test("a usage report with no numbers says why: an expired login asks for /login, a blocked read says it retries", () => {
	const expired = buildQuota([{ provider: "anthropic", account: "a", limits: [], problem: "expired" } as any], ["anthropic"]);
	expect(expired.providers).toEqual([]);
	expect(expired.unavailable[0]!.reason).toContain("/login anthropic");
	expect(buildQuota([{ provider: "anthropic", limits: [], problem: "rate_limited" } as any], ["anthropic"]).unavailable[0]!.reason).toContain("잠시 막혔어요");
	expect(buildQuota([], ["openai"]).unavailable[0]!.reason).toBe("사용량 정보를 제공하지 않아요");
});

// ---- every provider's account pool, not only the Claude subscription ------------------------------------------------
const CATALOG = [
	{ id: "anthropic", name: "Anthropic Subscription (Claude Pro/Max)" },
	{ id: "chatgpt-subscription", name: "ChatGPT Subscription (Plus/Pro)" },
	{ id: "google", name: "Google" },
];
const usageFile = () => join(process.env.OMO_CODING_AGENT_DIR!, "subscription-usage.json");
const readAuth = () => JSON.parse(readFileSync(authFile(), "utf8"));
function writeMixedAuth(): void {
	writeFileSync(authFile(), JSON.stringify({
		"anthropic-subscription": { type: "oauth", pinned: "work", accounts: [{ name: "default", access: "a" }, { name: "work", access: "b" }] },
		"chatgpt-subscription": { type: "oauth", pinned: "login-2", accounts: [{ name: "default", access: "c" }, { name: "login-2", access: "d" }] },
		google: { type: "api_key", key: "AIza-test-key-000" },
	}));
}
beforeEach(() => {
	rmSync(usageFile(), { force: true });
	writeSlots({});
});
afterEach(() => rmSync(usageFile(), { force: true }));

test("GET lists one group per provider with accounts, Korean product names, states and usage windows", () => {
	writeMixedAuth();
	writeSlots({});
	writeFileSync(join(process.env.OMO_CODING_AGENT_DIR!, "credential-pool-state.json"), JSON.stringify({ providers: { "chatgpt-subscription": { lanes: { stored: { slots: { default: { blockReason: "rate_limit", blockedUntil: WED_10 + 3_600_000 } } } } } } }));
	writeFileSync(usageFile(), JSON.stringify({ accounts: { "chatgpt-subscription/login-2": { windows: [{ id: "5h", windowMinutes: 300, usedPercent: 38, resetsAt: WED_10 + 7_200_000 }, { id: "7d", windowMinutes: 10080, usedPercent: 20 }] } } }));
	const b = accountsBody(WED_10, CATALOG);
	expect(b.providers.map(g => [g.id, g.name, g.auth, g.multi, g.can_add])).toEqual([
		["anthropic", "Claude 구독", "oauth", true, true],
		["chatgpt-subscription", "ChatGPT 구독", "oauth", true, true],
		["google", "Gemini", "api_key", false, false],
	]);
	const gpt = b.providers[1]!;
	expect(gpt.accounts.map(a => [a.name, a.label, a.current, a.pinned])).toEqual([["default", "default", false, false], ["login-2", "login-2", true, true]]);
	// a block OmO recorded for the account makes it logged as a limit, and its tag says until when
	expect(gpt.accounts[0]).toMatchObject({ blocked: "rate_limit" });
	expect(gpt.accounts[0]!.blocked_tag).toContain("11:00");
	expect(gpt.accounts[1]!.windows).toEqual([{ id: "5h", label: "5시간", left: 62, resets_at: WED_10 + 7_200_000 }, { id: "7d", label: "7일", left: 80, resets_at: null }]);
	// the API-key provider holds one key, named for what it is, and offers no account pool
	expect(b.providers[2]!.accounts).toMatchObject([{ name: "default", label: "API 키", current: true, windows: [] }]);
	expect(b.providers[2]!.can_delete).toBe(false);
	expect(b.login_providers).toEqual([
		{ id: "anthropic", name: "Claude 구독", configured: true },
		{ id: "chatgpt-subscription", name: "ChatGPT 구독", configured: true },
		{ id: "google", name: "Gemini", configured: true },
	]);
});

test("a provider the install cannot log into is listed but offers no add, and an empty pool says so with no accounts", () => {
	writeFileSync(authFile(), JSON.stringify({ "anthropic-subscription": { accounts: [{ name: "default", access: "a" }] }, "chatgpt-subscription": { type: "oauth", accounts: [] } }));
	const b = accountsBody(WED_10, []);
	expect(b.providers[0]).toMatchObject({ id: "anthropic", can_add: false });
	expect(b.providers[1]).toMatchObject({ id: "chatgpt-subscription", name: "ChatGPT 구독", can_add: false, accounts: [] });
	expect(b.login_providers).toEqual([]);
});

test("a per-provider alias is used for that pool's account and does not leak into another pool's same name", () => {
	writeMixedAuth();
	setAlias("chatgpt-subscription:login-2", "회사용 GPT");
	setAlias("default", "개인 계정");
	const b = accountsBody(WED_10, CATALOG);
	expect(b.providers[1]!.accounts.map(a => a.label)).toEqual(["default", "회사용 GPT"]);
	expect(b.providers[2]!.accounts[0]!.label).toBe("API 키");
});

test("PUT /api/accounts/pin sets OmO's pin for any provider's pool; delete drops one account and refuses the last", async () => {
	writeMixedAuth();
	const r = await call("PUT", "/api/accounts/pin", { provider: "chatgpt-subscription", account: "default" });
	expect(r.status).toBe(200);
	expect(readAuth()["chatgpt-subscription"].pinned).toBe("default");
	const body = await r.json();
	expect(body.providers[1].accounts.map((a: { name: string; pinned: boolean }) => [a.name, a.pinned])).toEqual([["default", true], ["login-2", false]]);
	await call("PUT", "/api/accounts/pin", { provider: "chatgpt-subscription", account: null });
	expect(readAuth()["chatgpt-subscription"].pinned).toBeUndefined();
	// the Claude pin still goes through dotz's own pick (rules and the 고정 mode follow it)
	const c = await call("PUT", "/api/accounts/pin", { provider: "anthropic", account: "work" });
	expect(c.status).toBe(200);
	expect((await c.json()).mode).toBe("pinned");
	expect(readAuth()["anthropic-subscription"].pinned).toBe("work");
	// one account out of the ChatGPT pool; its pin moves off it
	const d = await call("DELETE", "/api/accounts?provider=chatgpt-subscription&name=login-2");
	expect(d.status).toBe(200);
	expect(readAuth()["chatgpt-subscription"].accounts.map((a: { name: string }) => a.name)).toEqual(["default"]);
	const last = await call("DELETE", "/api/accounts?provider=chatgpt-subscription&name=default");
	expect(last.status).toBe(409);
	const missing = await call("DELETE", "/api/accounts?provider=google&name=nope");
	expect(missing.status).toBe(404);
});

test("without a subscription login, OmO's anthropic API key is its own group and no empty Claude subscription group appears", () => {
	writeFileSync(authFile(), JSON.stringify({ anthropic: { type: "api_key", key: "sk-ant-test-000000" } }));
	const b = accountsBody(WED_10, CATALOG);
	expect(b.accounts).toEqual([]);
	expect(b.providers.map(g => [g.id, g.name, g.auth])).toEqual([["anthropic", "Claude API 키", "api_key"]]);
	expect(b.providers[0]!.accounts.map(a => a.label)).toEqual(["API 키"]);
});

test("the Claude group shows every logged-in account's windows from OmO's usage file, with ISO reset times, not only the one in use", () => {
	writeMixedAuth();
	writeSlots({});
	const at = (h: number) => new Date(WED_10 + h * 3_600_000).toISOString();
	writeFileSync(usageFile(), JSON.stringify({ accounts: {
		"anthropic-subscription/default": { windows: [{ id: "claude:5h", label: "5h", windowMinutes: 300, usedPercent: 40, resetsAt: at(2) }, { id: "claude:7d", label: "7d", windowMinutes: 10080, usedPercent: 10, resetsAt: at(48) }, { id: "claude:7d_fable", label: "7d fable", windowMinutes: 10080, usedPercent: 5, resetsAt: at(48) }] },
		"anthropic-subscription/work": { windows: [{ id: "claude:5h", label: "5h", windowMinutes: 300, usedPercent: 1, resetsAt: at(4) }] },
	} }));
	const b = accountsBody(WED_10, CATALOG);
	const claude = b.providers[0]!;
	expect(claude.accounts.map(a => [a.name, a.windows.map(w => [w.label, w.left, w.resets_at])])).toEqual([
		["default", [["5시간", 60, WED_10 + 7_200_000], ["7일", 90, WED_10 + 172_800_000], ["7일 fable", 95, WED_10 + 172_800_000]]],
		["work", [["5시간", 99, WED_10 + 14_400_000]]],
	]);
	// without rules or a script the legacy numbers come from the same file too
	expect(b.accounts.map(a => [a.name, a.five_hour_left, a.seven_day_left])).toEqual([["default", 60, 90], ["work", 99, null]]);
});
