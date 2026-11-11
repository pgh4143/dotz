// The notice list: load, save, upsert, the event feed, settling, replay. A part of the notice store split out of hub/notices.ts, code unchanged.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { log, now, paths, writeAtomic } from "./config.ts";
import type { DraftApproval } from "./draft-approval.ts";
import { askDefaults } from "./ask-options.ts";
import { alertMatter, quietAlert } from "./alert-gate.ts";
import { eventTarget, isPeerMessage, type HubEvent } from "./events.ts";
import { classOfNotice } from "./notice-class.ts";
import { dropClaim, isSilent, parkedTone } from "./tone.ts";
import { describeOutput, humanLabel, isIssue, itemRefOf, LOGIN_BLOCKED_KO, matchItems, matchTitle, PROVIDER_BACK_KO, scheduleLine, sentinelMatch, watchLine, watchReasonKo } from "./watchtext.ts";
import { resolveItem, type WatchItem } from "./watchitem.ts";
import type { Decision, DecisionOpt, Notice, NoticeKind, NoticeTone } from "./notices-types.ts";
import { appBlocked, appOf, closedHooks, decisionHooks, orchestratorUp, stampApp, summarizeWatch, unreadHooks, watchLabelOf } from "./notices-wiring.ts";
import { BACKFILL_DAYS, DAY_MS, FOLD_MS, LOUD, MESSAGE_PREVIEW, NOTICE_CAP, REASK_MS, REPEATS_MAX, REPEAT_TEXT, RESTART_PREFIX, answersOption, authorOf, clean, closedInfo, coveredByRead, hasChoice, hasExpired, isAsking, isOpenDecision, keepWatchNewest, laneTone, needsAnswer, originOf, refOf, systemTitle, twinOf, waitKind, waitsOf } from "./notices-rules.ts";
import { GENERIC_TITLES, channelLanes, channelTitle, laneExists, laneOfNotice, laneTitle, launchTitles, noteLaunch, readChannelMap, recordedCwd, stoppedSince } from "./notices-lanes.ts";
import { snapshotResults } from "./files.ts";
import { type ResultFile, type ResultLink, resultFiles, resultLinks } from "./result-refs.ts";
import { broadcast, summary } from "./notices-read.ts";
import { QUIET_MS, awaitingReply, isViewing, quietReplies, viewers } from "./notices-viewing.ts";
import { decisionsOf, expiresAtOf, sending } from "./notices-decisions.ts";
import { worklogKind } from "./worklog-kind.ts";

// A report stored before a schedule was said by its short name and a match that lists items by its count (2026-11-10) reads as a new one does.
const MATCHED = `: ${watchReasonKo("matched /./")}`;
function restored(n: Notice): string {
	if (n.kind !== "watch") return n.text;
	if (n.title === "예약") return clean(scheduleLine(n.text, { raw: false })).text;
	const [head = "", ...rest] = n.text.split("\n");
	const title = head.endsWith(MATCHED) ? matchTitle(rest.join("\n")) : undefined;
	return title ? [`${head.slice(0, -MATCHED.length)}: ${title}`, matchItems(rest.join("\n"), title)].join("\n") : n.text;
}
const load = (): Notice[] => {
	if (!existsSync(paths.notices)) return [];
	try {
		const parsed = JSON.parse(readFileSync(paths.notices, "utf8"));
		// An entry stored before the claim word was dropped reads the same as a new one (clean), and so does an older report (restored).
		return Array.isArray(parsed) ? parsed.filter((n): n is Notice => typeof n?.id === "string" && typeof n.text === "string").map(n => ({ ...n, text: restored({ ...n, text: dropClaim(n.text) }) })) : [];
	} catch (e) {
		log(`notices.json unreadable, starting empty: ${e}`);
		return [];
	}
};
export let items: Notice[] = load();
// True while backfillNotices replays old events: upsert then neither writes the file nor broadcasts per item.
let replaying = false;

// The file paths on the chips of the stored notices (hub/listed-files.ts).
export const noticeFilePaths = (): string[] => items.flatMap(n => n.files?.map(f => f.path) ?? []);
export const save = () => writeAtomic(paths.notices, `${JSON.stringify(items, null, 1)}\n`);

// The 알림 screen does not list these (web/js/31-notices-screen.js nscListed), so the count must not hold what the owner cannot read there.
const unlisted = (i: Notice) => {
	const { cls } = classOfNotice(i);
	return cls === "conv" || cls === "log";
};
export const unreadCount = () => {
	const at = now();
	return items.reduce((n, i) => n + (i.read || i.dismissed || appBlocked(i) || unlisted(i) || (i.decision?.state === "open" && hasExpired(i.decision, at)) ? 0 : 1), 0);
};

// The clock of a backfill (its `nowMs`): what is old is judged at the time the replay is for, not by the wall clock.
let replayClock: number | undefined;
export function pruneWatch(): boolean {
	const kept = keepWatchNewest(items, replayClock ?? Date.parse(now()));
	if (kept === items) return false;
	items = kept;
	return true;
}
// Oldest read item goes first; when everything is unread, the oldest one. An open decision is never dropped, nor is a closed card whose send
// failed until it is handled or dismissed (the owner has not seen the failure yet). One sort and one filter, however far over the cap the store is.
const keptByTrim = (i: Notice): boolean => isOpenDecision(i) || (i.decision?.send?.state === "failed" && !i.handled && !i.dismissed);
function trim(): void {
	const over = items.length - NOTICE_CAP;
	if (over <= 0) return;
	const drop = new Set(items.filter(i => !keptByTrim(i)).sort((a, b) => Number(b.read) - Number(a.read) || (a.updated < b.updated ? -1 : a.updated > b.updated ? 1 : 0)).slice(0, over));
	if (drop.size) items = items.filter(i => !drop.has(i));
}

// `repeat`: overwrites the alert it repeats (alert-gate), `fold`: a monitor report that joins the watch's newest row; both keep the old text in `repeats`.
type Input = { kind: NoticeKind; tone: NoticeTone; title: string; text: string; open: string; files?: ResultFile[]; links?: ResultLink[]; key?: string; watch?: string; by?: string; ref?: string; item?: WatchItem; read?: boolean; unread?: boolean; src?: string; at?: string; msg?: string; repeat?: boolean; fold?: boolean; wk?: string; wst?: string };
// The row a monitor report joins: the watch's newest row when it is under a day old, has the same tone and no card on either side, and neither is a
// report with nothing new (log). One pass over the list.
function foldTarget(i: Input, at: string): Notice | undefined {
	if (i.item || i.kind !== "watch") return undefined;
	const name = i.watch ?? i.title;
	let head: Notice | undefined;
	for (const n of items) if (n.kind === "watch" && !n.dismissed && (n.watch ?? n.title) === name && (!head || n.updated > head.updated)) head = n;
	if (!head || head.item || head.key || head.tone !== i.tone || Math.abs(Date.parse(at) - Date.parse(head.updated)) >= FOLD_MS) return undefined;
	const mine = classOfNotice({ kind: i.kind, tone: i.tone, text: i.text }).cls, theirs = classOfNotice(head).cls;
	return mine === "log" || theirs === "log" || mine !== theirs || waitKind(head) !== waitKind({ ...head, text: i.text }) ? undefined : head;
}
// A failure or lost login closes by this time (hub signals: a rerun that passed, a watch or the provider back).
function closeWaiting(pick: (n: Notice) => boolean, at: string): Notice[] {
	const hit = items.filter(n => waitsOf(n) && pick(n));
	for (const n of hit) n.handled = at;
	if (hit.length && !replaying) {
		save();
		for (const n of hit) broadcast({ ts: at, kind: "notice", source: "gateway", item: n, unread: unreadCount() });
	}
	return hit;
}

export function upsert(i: Input): Notice {
	const at = i.at ?? now();
	const old = i.key ? items.find(n => n.key === i.key) : i.fold ? foldTarget(i, at) : undefined;
	const folded = !i.key && i.fold === true && old !== undefined;
	const wasUnread = old ? !old.read && !old.dismissed : false;
	const quiet = appBlocked({ kind: i.kind, app: i.kind === "watch" ? appOf(i as unknown as Notice) : undefined, ...(i.watch ? { watch: i.watch } : {}), src: i.src ?? i.open, open: i.open });
	if (quiet && old) return old;
	let item: Notice;
	if (old) {
		const reopened = (LOUD.has(i.tone) && i.tone !== old.tone) || (i.kind === "result" && i.text !== old.text) || i.unread === true;
		const waited = waitKind(old), closed = waited && !waitsOf(old);
		if (i.repeat || folded) old.repeats = [{ at: old.at ?? old.ts, text: old.text.slice(0, REPEAT_TEXT) }, ...(old.repeats ?? [])].slice(0, REPEATS_MAX);
		old.kind = i.kind;
		old.tone = i.tone;
		old.title = i.title;
		old.text = i.text;
		old.open = i.open;
		old.src = i.src ?? i.open;
		old.at = at;
		old.updated = at;
		if (i.msg) old.msg = i.msg;
		else delete old.msg;
		if (!replaying) for (const k of ["files", "links"] as const) {
			if (i[k]) old[k] = i[k] as never;
			else delete old[k];
		}
		if (i.by) old.by = i.by;
		if (i.ref) old.ref = i.ref;
		if (i.watch) old.watch = i.watch;
		if (i.item) old.item = i.item;
		if (i.read) old.read = true;
		else if (reopened || (folded && !closed)) {
			old.read = false;
			delete old.dismissed;
			delete old.ignored;
		}
		// A new failure (or one that changed from another tone) waits again; a repeat of a closed one does not reopen it.
		const waits = waitKind(old);
		if (waits && (!waited || reopened)) old.handled = null;
		else if (!waits && old.handled === null) old.handled = at;
		item = old;
	} else {
		item = { id: randomBytes(4).toString("hex"), ts: at, updated: at, kind: i.kind, tone: i.tone, title: i.title, text: i.text, open: i.open, src: i.src ?? i.open, at, ...(i.msg ? { msg: i.msg } : {}), ...(i.files ? { files: i.files } : {}), ...(i.links ? { links: i.links } : {}), ...(i.key ? { key: i.key } : {}), ...(i.watch ? { watch: i.watch } : {}), ...(i.by ? { by: i.by } : {}), ...(i.ref ? { ref: i.ref } : {}), ...(i.item ? { item: i.item } : {}), read: i.read === true };
		if (waitKind(item)) item.handled = null;
		if (!quiet) {
			items.push(item);
			trim();
		}
	}
	if (quiet) return item;
	if (i.wk) {
		item.wk = i.wk;
		if (i.wst) item.wst = i.wst;
		else delete item.wst;
	}
	// The owner's read position may already cover the message this notice points at (read on another device first): it is born read.
	if (!item.read && coveredByRead(item)) item.read = true;
	if (item.kind === "watch") stampApp(item);
	if (i.kind === "watch") pruneWatch();
	if (!replaying) {
		save();
		broadcast({ ts: at, kind: "notice", source: "gateway", item, unread: unreadCount() });
		// A folded report is a new matter for the phone even when its row was already unread (hub/push.ts tags it by report time).
		if ((!wasUnread || folded) && !item.read && !item.dismissed) for (const fn of unreadHooks) fn(item);
	}
	return item;
}

// The files, commits and links a report names (hub/result-refs.ts), kept on its 작업내역 or session-result notice so its row shows them as
// chips. Not while replaying: a rebuild would ask git about every old report at boot.
const CODE_ROOT = join(import.meta.dir, "..");
function resultsOf(raw: unknown, lane?: string): { files?: ResultFile[]; links?: ResultLink[] } {
	const text = String(raw ?? "");
	if (replaying || !/\[file\]|`[~/]|근거\s*:|https?:\/\//.test(text)) return {};
	const files = resultFiles(text), links = resultLinks(text, [lane ? (recordedCwd(lane) ?? "") : "", CODE_ROOT]);
	snapshotResults(files.map(f => f.path));
	return { ...(files.length ? { files } : {}), ...(links.length ? { links } : {}) };
}

// `asks`: the post makes decision items (decisionsOf); an alert post then makes no item of its own, so one message is one notice.
function fromOutbox(e: HubEvent, asks = false): void {
	const target = String(e.target ?? "");
	const key = typeof e.update_key === "string" && e.update_key ? e.update_key : undefined;
	if (key === "progress") return;
	const cleaned = clean(e.text);
	const { text } = cleaned;
	const tone = laneTone(e, cleaned.tone, text);
	if (!text) return;
	const restart = RESTART_PREFIX.test(text);
	const by = authorOf(e);
	const back = e.source === "gateway" ? /^(?:\[([^\]\n]+)\]\s*|([^:\n]{1,60}):\s+)(?:recovered\b|다시 정상이에요)/.exec(text) : null;
	const recovered = back?.[1] ?? back?.[2];
	if (recovered) watchRecovered(recovered, e.ts);
	if (target === "worklog" || (restart && target === "web" && e.source === "gateway")) {
		if (key?.startsWith("lane:")) {
			const name = key.slice(5);
			return void upsert({ kind: "result", tone, title: laneTitle(name), text, open: key, key, ...(by ? { by } : {}), ...(target === "worklog" ? { msg: target } : {}), ...resultsOf(e.text, name), at: e.ts });
		}
		// The gateway's own status lines there (a restart, a model fallback, an account switch, a harness upgrade) are a record, not news: born read.
		// A gateway [ask] / [fail] there still waits, and so does a daily digest with its own title (야간 정리, 토큰 점검).
		const title = systemTitle(text, "작업 기록");
		const status = e.source === "gateway" && tone !== "ask" && tone !== "fail" && title === "작업 기록";
		return void upsert({ kind: "worklog", tone, title, text, open: target === "worklog" ? "worklog" : "main", key, read: restart || status, ...resultsOf(e.text), ...worklogKind(e), at: e.ts });
	}
	if (target === "alert") {
		if (asks) return;
		// An all-clear of the gateway is born read; a repeat (hub/alert-gate.ts) rewrites the alert it repeats, in place and in its read state.
		const quiet = e.source === "gateway" && quietAlert(text);
		// The provider is back: the logins it stopped on are over (limit-alert noteRecovered said so once for every agent).
		if (quiet && text.replace(/^[^:\n]{1,60}:\s+/, "").startsWith(PROVIDER_BACK_KO)) providerBack(e.ts);
		const prior = e.repeat === true ? items.findLast(n => n.kind === "alert" && !n.dismissed && n.by === by && alertMatter(n.text) === alertMatter(text)) : undefined;
		if (prior && !prior.key) prior.key = `alert:${prior.id}`;
		return void upsert({ kind: "alert", tone, title: systemTitle(text, "알림"), text, open: "alert", key: prior?.key ?? key, ...(by ? { by } : {}), ...(refOf(e) ? { ref: refOf(e) } : {}), read: Boolean(recovered) || quiet, ...(prior ? { repeat: true } : {}), at: e.ts });
	}
	const watch = /^ch:\d+$/.test(target) && e.source === "gateway" ? /^\[([^\]\n]+)\]\s*/.exec(text) : null;
	if (watch) {
		const ref = recovered ? undefined : itemRefOf(text);
		upsert({ kind: "watch", tone, title: watchLabelOf(watch[1]!), text: text.slice(watch[0].length) || text, open: target, key, read: Boolean(recovered), at: e.ts, ...(recovered || key ? {} : { fold: true }), ...(ref ? { item: resolveItem(ref) } : {}) });
	}
}

function fromInbox(e: HubEvent): void {
	if (e.kind === "lane_report") {
		const name = String(e.lane ?? "");
		const cleaned = clean(e.text);
		const { text } = cleaned;
		const tone = laneTone(e, cleaned.tone, text);
		if (!name || !text || !LOUD.has(tone)) return;
		return void upsert({ kind: "result", tone, title: laneTitle(name), text, open: `lane:${name}`, key: `lane:${name}`, by: `lane:${name}`, ...resultsOf(e.text, name), at: e.ts });
	}
	if (e.kind === "watch") {
		const recovered = /^recovered\b/.test(String(e.reason ?? ""));
		const name = String(e.watch ?? "");
		const label = humanLabel(typeof e.label === "string" && e.label.trim() ? e.label : name, "");
		if (recovered) watchRecovered(name, e.ts, label);
		// The wake event itself is a message of the 알림 conversation (hub/events.ts eventTarget); the bell gets nothing extra when the
		// orchestrator, which reports in the channel, is up.
		if (e.to === "orchestrator" && Array.isArray(e.channels) && e.channels.length && orchestratorUp()) return;
		const [head, reason, output] = [label || "모니터링", String(e.reason ?? ""), String(e.text ?? "")];
		const prev = typeof e.prev === "string" ? e.prev : undefined;
		const ref = recovered || isIssue(reason) ? undefined : itemRefOf(output);
		const item = upsert({ kind: "watch", tone: "", title: head, text: clean(watchLine(head, reason, output, { prev })).text || "알림이 왔어요", open: "alert", ...(name ? { watch: name } : {}), read: recovered, at: e.ts, ...(recovered ? {} : { fold: true }), ...(ref ? { item: resolveItem(ref) } : {}) });
		if (summarizeWatch && !isIssue(reason) && !recovered && !sentinelMatch(reason, output) && !describeOutput(output, { prev }).readable)
			void summarizeWatch(output).then(summary => summary && retextWatch(item.id, clean(watchLine(head, reason, output, { prev, summary })).text));
		return;
	}
	// A mail that came in (hub/mail.ts post) is the mail app's 새 소식, whether or not it also got a Discord thread: one item per mail thread,
	// opening its conversation (opening it reads the item, routes.ts), and unread again when the thread gets a newer message. The app
	// instance's 새 소식 알림 switch (appBlocked) keeps it out of the bell, its 휴대폰 알림 switch out of the phone (hub/push.ts).
	if (e.kind === "mail" && e.incoming === true && typeof e.mail === "string") {
		const from = String(e.from ?? "");
		const name = from.replace(/\s*<[^>]*>\s*$/, "").replace(/^"(.*)"$/, "$1").trim() || from;
		const open = typeof e.conv === "string" ? e.conv : `mail:${e.mail}`;
		return void upsert({ kind: "watch", tone: "", title: name || "새 메일", text: String(e.subject ?? "") || "(제목 없음)", open, key: open, unread: true, at: e.ts });
	}
	// the gateway's own wakes (update carry-over, text overrides: main.ts wakeOnce) are instructions to the assistant, not the owner's schedules
	if (e.kind === "schedule" && e.source !== "gateway") {
		const ch = typeof e.channel === "string" && /^ch:\d+$/.test(e.channel) ? e.channel : "main";
		upsert({ kind: "watch", tone: "", title: "예약", text: clean(scheduleLine(String(e.text ?? ""), { raw: false })).text, open: ch, at: e.ts });
	}
}

export function feed(e: HubEvent): void {
	try {
		resolveByReport(e);
		if (e.kind === "lane_start") noteLaunch(e);
		else if (e.kind === "out") {
			const ds = decisionsOf(e);
			fromOutbox(e, ds.length > 0);
			for (const d of ds) putDecision(d, e.ts);
			// A decision message makes only its decision item; any other answer may become the conversation's unread message item
			// (not the reply to a button answer: answerReply).
			if (!answerReply(e) && !ds.length) fromAnswer(e);
		} else if (e.kind === "message" || e.kind === "lane_message") {
			answerReply(e);
			ownerReplied(e);
			// The owner answering from a messenger (Discord and the others report no read position) has seen what came before it in that room; a post
			// from the web app reads nothing (the app has its own tap, ✕ and read-all).
			if (!replaying && typeof e.source === "string" && e.source !== "web" && e.source !== "terminal") readConversationNotices(eventTarget(e) ?? "main", e.ts);
		}
		else {
			const ds = decisionsOf(e);
			// One question is one item: an [ask] that made its card makes no report row beside it.
			if (!ds.length || clean(e.text).tone !== "ask") fromInbox(e);
			for (const d of ds) putDecision(d, e.ts);
			// A session's turn-end report goes to its Discord channel as a real message whatever its tone (hub/lanewire.ts): an untagged one
			// (often the answer to the owner) is the session conversation's message item, as its mid-turn answers are.
			if (e.kind === "lane_report" && !ds.length && !answerReply(e)) fromAnswer(e);
		}
	} catch (err) {
		log(`notice feed failed: ${err}`);
	}
}

export function answerReply(e: HubEvent): boolean {
	if (e.kind === "message" || e.kind === "lane_message") {
		const button = (Array.isArray(e.picks) && e.picks.length > 0) || typeof e.decision === "string";
		const conv = eventTarget(e) ?? "main";
		if (button && !replaying) awaitingReply.set(conv, Date.parse(e.ts) || Date.now());
		else awaitingReply.delete(conv);
		return false;
	}
	if (e.kind !== "out" && e.kind !== "lane_report") return false;
	if (quietReplies.has(e.ts)) return true;
	const src = String(e.source ?? "");
	const lane = src.startsWith("lane:") || e.kind === "lane_report";
	if (e.update_key || e.target === "alert" || e.target === "worklog" || (src !== "orchestrator" && !lane)) return false;
	const conv = eventTarget(e) ?? "main", since = awaitingReply.get(conv);
	if (since === undefined) return false;
	awaitingReply.delete(conv);
	const { tone } = clean(e.text);
	if (Date.parse(e.ts) - since > QUIET_MS || tone === "ask" || tone === "fail" || (lane && tone === "done")) return false;
	quietReplies.add(e.ts);
	if (quietReplies.size > 200) quietReplies.delete(quietReplies.values().next().value!);
	return true;
}

// An answer of the assistant or a session (not progress, not a keepalive "ok" / "-") in a conversation nobody is viewing: that
// conversation's one "message" item, rewritten by each later answer. A session's [done] / [fail] already has its result item.
function fromAnswer(e: HubEvent): void {
	if (replaying) return;
	const src = String(e.source ?? "");
	const lane = src.startsWith("lane:");
	if (e.update_key || e.target === "worklog" || e.target === "alert" || (src !== "orchestrator" && !lane)) return;
	const { tone, text } = clean(e.text);
	if (!text || /^(?:ok|-)$/i.test(text) || isSilent(String(e.text ?? "")) || (lane && LOUD.has(tone))) return;
	// A [run] report only edits the session's progress line on Discord, unless it answers the owner (hub/lanewire.ts `running`).
	if (e.kind === "lane_report" && parkedTone(tone) && e.answering !== true) return;
	const conv = eventTarget(e) ?? "main";
	if (isViewing(conv)) return;
	const preview = text.replace(/\s+/g, " ");
	// A closing report (its session already exited) may update the text of a notice the owner has read, but not re-open it.
	const owner = conv.startsWith("lane:") ? conv.slice(5) : conv.startsWith("ch:") ? channelLanes().get(conv) : undefined;
	const closing = [owner, lane ? src.slice(5) : undefined].some(name => name !== undefined && stoppedSince(name) !== undefined);
	const title = conv.startsWith("lane:") ? laneTitle(conv.slice(5)) : conv === "alert" ? "알림" : conv === "worklog" ? "작업 기록" : channelTitle(conv);
	upsert({ kind: "message", tone: "", title, text: preview.length > MESSAGE_PREVIEW ? `${preview.slice(0, MESSAGE_PREVIEW - 1)}…` : preview, open: conv, key: `msg:${conv}`, unread: true, src: conv, at: e.ts, read: closing && items.find(n => n.key === `msg:${conv}`)?.read === true });
}

// A repeat of an ask that is already answered or ignored makes its twin item before putDecision sees it: that twin ends the same way.
function closeRepeat(old: Notice, at: string): void {
	const hit = items.filter(n => n.at === at && twinOf(old, n) && !n.read);
	for (const n of hit) {
		n.read = true;
		if (old.ignored) n.ignored = old.ignored;
	}
	if (hit.length && !replaying) {
		save();
		for (const n of hit) broadcast({ ts: at, kind: "notice", source: "gateway", item: n, unread: unreadCount() });
	}
}

export function putDecision(d: { key: string; title: string; detail: string; to: string; open?: string; options: DecisionOpt[]; group: number; replyTo?: string; draft?: DraftApproval; by?: string; ref?: string; assumed?: true }, at: string): void {
	const old = items.find(n => n.key === d.key);
	if (old?.decision) {
		// The same ask can arrive twice (a session's mid-turn line and its turn-end report): one notice, and an answered one stays answered.
		if (isOpenDecision(old)) return;
		if (Date.parse(at) - Date.parse(old.ignored ?? old.decision.answered_at ?? "") < REASK_MS) return void closeRepeat(old, at);
	}
	const open = d.open ?? d.to;
	const expires_at = expiresAtOf(d, at);
	const decision: Decision = { options: d.options, to: d.to, ...(d.replyTo ? { reply_to: d.replyTo } : {}), group: d.group, state: "open", ...(expires_at ? { expires_at } : {}), ...(d.draft ? { draft: d.draft } : {}), ...(d.assumed ? { assumed: true as const } : {}) };
	let item: Notice;
	if (old) {
		Object.assign(old, { kind: "decision", tone: "ask", title: d.title, text: d.detail, open, src: open, at, updated: at, read: false, decision, ...(d.by ? { by: d.by } : {}), ...(d.ref ? { ref: d.ref } : {}) });
		delete old.dismissed;
		delete old.ignored;
		item = old;
	} else {
		item = { id: randomBytes(4).toString("hex"), ts: at, updated: at, kind: "decision", tone: "ask", title: d.title, text: d.detail, open, src: open, at, key: d.key, ...(d.by ? { by: d.by } : {}), ...(d.ref ? { ref: d.ref } : {}), read: false, decision };
		items.push(item);
		trim();
	}
	if (replaying) return;
	save();
	broadcast({ ts: at, kind: "notice", source: "gateway", item, unread: unreadCount() });
	for (const fn of decisionHooks) fn(item);
}

export function settleDecision(item: Notice, answer: string, at = now(), resolved = false): void {
	const d = item.decision;
	if (!d || d.state !== "open") return;
	d.state = "answered";
	// A resolved matter was not answered: it is marked resolved and carries no answer text.
	if (resolved) d.resolved = true;
	else d.answer = (sending.get(item.id) ?? answer).slice(0, 200);
	d.answered_at = at;
	item.read = true;
	item.updated = at;
	// The notices made by the same asking event (the alert and message twins) are settled with it.
	if (d.reply_to !== undefined && !items.some(n => n !== item && isOpenDecision(n) && n.decision!.reply_to === d.reply_to))
		readIds(items.filter(n => twinOf(item, n) && !n.read && !n.dismissed).map(n => n.id));
	if (replaying) return;
	save();
	broadcast({ ts: at, kind: "notice", source: "gateway", item, unread: unreadCount() });
	for (const fn of closedHooks) fn(d.to, d.draft?.ref, closedInfo(item, resolved ? "resolved" : "answered"));
}

// The owner wrote in a chat or session: every open decision there is answered by it, unless the message names its decision
// (a button answer carries `decision`), which then settles only that one. A decision with real options takes only a message that answers
// one of them (answersOption): another subject (2026-11-10: "그건 그렇고 날씨 어때?") leaves it open. A message that quotes the asking message of
// a one-question decision (reply.id is that message's ts, the decision's reply_to) is its answer in any words (2026-11-10 19:05: "사이트 배포는 기존에 하던 방식으로 해").
function ownerReplied(e: HubEvent): void {
	// A peer gateway's line arrives as a web message under the owner's login, but he said nothing (2026-11-05: it answered an [ask] nobody had seen).
	if (isPeerMessage(e)) return;
	const to = eventTarget(e) ?? "main";
	const id = typeof e.decision === "string" ? e.decision : "";
	const text = String(e.text ?? "").trim();
	const quoted = (e.reply as { id?: unknown } | undefined)?.id;
	const quotesAsk = (i: Notice) => typeof quoted === "string" && quoted !== "" && i.decision!.reply_to === quoted && i.decision!.group === 1;
	// A typed message is not the answer to a waiting send-approval card (2026-10-31: "19번 카드는 위에 있어", "마지막 카드 어디?" closed it):
	// the card stays open until its buttons answer it or the draft is handled elsewhere (settleHandledDrafts).
	for (const i of items) if (isOpenDecision(i) && !i.decision!.to.startsWith("auth:") && (id ? i.id === id : i.decision!.to === to && !i.decision!.draft && (!hasChoice(i) || answersOption(i.decision!.options, text) || quotesAsk(i)))) settleDecision(i, text, e.ts);
}

// The titles of the choice questions still open in conversation `target` (the newest `max` first): what the bot is told with the owner's next message there.
export function openChoiceTitles(target: string, max = 3): string[] {
	return items
		.filter(i => isOpenDecision(i) && hasChoice(i) && !i.decision!.draft && i.decision!.to === target)
		.sort((a, b) => b.updated.localeCompare(a.updated))
		.slice(0, max)
		.map(i => i.title);
}

function readIds(ids: string[]): void {
	if (!ids.length) return;
	if (!replaying) return void markNoticesRead({ ids }, true);
	for (const i of items) if (ids.includes(i.id) && !isOpenDecision(i)) i.read = true;
}

// Resolves every asking notice that `pick` accepts and that was raised before `at`. Returns how many it closed. Decisions with options (and
// their alert twins) are skipped unless `named`: the bot named that notice itself.
export function resolveAsks(pick: (i: Notice) => boolean, at: string, named = false): number {
	const owned = new Set(items.filter(hasChoice).map(d => d.decision!.reply_to));
	const hit = items.filter(i => isAsking(i) && (i.at ?? i.ts) < at && pick(i) && (named || !(hasChoice(i) || (!i.decision && owned.has(i.at)))));
	for (const i of hit) if (isOpenDecision(i)) settleDecision(i, "", at, true);
	readIds(hit.filter(i => !i.read).map(i => i.id));
	return hit.length;
}

// Signal 1: a session's [done] / [fail] closes what that session asked.
function resolveByReport(e: HubEvent): void {
	if ((e.kind !== "out" && e.kind !== "lane_report") || typeof e.ts !== "string") return;
	const { tone } = clean(e.text);
	if (tone !== "done" && tone !== "fail") return;
	const key = typeof e.update_key === "string" && e.update_key.startsWith("lane:") ? e.update_key : "";
	const who = key || (authorOf(e)?.startsWith("lane:") ? authorOf(e)! : "");
	if (who) resolveAsks(i => originOf(i) === who, e.ts);
}

// Signal 2: an orchestrator turn ends with [done] / [fail] for the request `ref` (the owner message it answers). That closes an ask of the
// orchestrator about the same request, but only one raised in an earlier turn: anything asked in this very turn (even mid-turn, with the same
// reply_to) is still waiting on the owner, and an answer for a different or unknown request closes nothing.
export let orchTurnFrom: string | undefined;
export const orchestratorTurnStarted = (at = now()): void => void (orchTurnFrom = at);
// Signal 3: a watch that failed passes again. Its failure alert (and the choice it carried) is over; the recovery note itself is born read.
function watchRecovered(name: string, at: string, label = name): void {
	if (!name) return;
	const isTitle = (t: string) => t === name || t === label;
	// The gateway's failure alert starts with the watch's label ("<label>: ..."), or "[<name>]" in older text.
	const failed = (i: Notice) => i.kind === "alert" && i.tone !== "ask" && [`[${name}]`, `${name}:`, `${label}:`].some(p => i.text.startsWith(p));
	// Only the gateway's own failure alert for that watch (it may carry a cause-check choice that a pass makes moot), never another author's question.
	resolveAsks(i => (i.by === "gateway" && i.text.startsWith(`[${name}]`)) || (i.kind === "watch" && isTitle(i.title)), at, true);
	// Its failures and lost logins are over (handled), read or not.
	closeWaiting(i => i.ts < at && (failed(i) || (i.kind === "watch" && isTitle(i.title))), at);
	readIds(items.filter(i => !i.read && !i.dismissed && i.ts < at && ((i.kind === "watch" && isTitle(i.title)) || failed(i))).map(i => i.id));
}

// Signal 3b: the model provider answers again (limit-alert recoveryText). The login stops it raised are over, read or not.
function providerBack(at: string): void {
	const ended = closeWaiting(i => i.kind === "alert" && i.text.includes(LOGIN_BLOCKED_KO), at);
	readIds(ended.filter(i => !i.read).map(i => i.id));
}

// A session that no longer exists answers nobody: its questions are closed as resolved, and its notices are read and leave the list and the badge
// (kept in notices.json as dismissed). Every open page hears a notice_dismiss per item.
export function retire(list: Notice[], at = now()): void {
	if (!list.length) return;
	for (const i of list) {
		if (i.decision?.state === "open") settleDecision(i, "", at, true);
		i.read = true;
		i.dismissed = true;
	}
	if (replaying) return;
	save();
	const unread = unreadCount();
	for (const i of list) broadcast({ ts: at, kind: "notice_dismiss", source: "gateway", id: i.id, unread });
}

function rerenderPending(): number {
	const pending = items.filter(i => !i.dismissed && i.at && i.kind !== "watch" && i.kind !== "message" && !i.decision?.to.startsWith("auth:") && (isOpenDecision(i) || (!i.read && !i.decision)));
	if (!pending.length) return 0;
	const wanted = new Set(pending.map(i => i.decision?.reply_to ?? i.at!));
	const events: HubEvent[] = [];
	for (const file of [paths.outbox, paths.inbox]) {
		if (!existsSync(file)) continue;
		for (const line of readFileSync(file, "utf8").split("\n")) {
			const ts = /"ts":"([^"]+)"/.exec(line)?.[1];
			if (!ts || !wanted.has(ts)) continue;
			try {
				const e = JSON.parse(line) as HubEvent;
				if (e.ts === ts && (e.kind === "out" || e.kind === "lane_report")) events.push(e);
			} catch {
				continue;
			}
		}
	}
	const kept = items;
	let changed = 0;
	for (const e of events) {
		// The current rules draw the event into an empty list (replaying: nothing is saved or broadcast); the stored items take its fields.
		items = [];
		try {
			const ds = decisionsOf(e);
			if (e.kind === "out") fromOutbox(e, ds.length > 0);
			else fromInbox(e);
			for (const d of ds) putDecision(d, e.ts);
		} catch (err) {
			log(`notice redraw of ${e.ts} failed: ${err}`);
		}
		const fresh = items;
		items = kept;
		const was = (i: Notice) => JSON.stringify(i);
		const asked = pending.filter(i => isOpenDecision(i) && i.decision!.reply_to === e.ts);
		const drawn = fresh.filter(n => n.decision);
		asked.forEach((i, idx) => {
			const n = drawn.find(d => d.key === i.key) ?? (asked.length === drawn.length ? drawn[idx] : undefined);
			if (!n?.decision) return;
			const before = was(i);
			i.title = n.title;
			i.text = n.text;
			if (n.key) i.key = n.key;
			const d = i.decision!;
			d.options = n.decision.options;
			d.group = n.decision.group;
			if (n.decision.draft) d.draft = n.decision.draft;
			else delete d.draft;
			if (n.decision.assumed) d.assumed = true;
			else delete d.assumed;
			if (was(i) !== before) changed++;
		});
		for (const i of pending.filter(p => !p.decision && p.at === e.ts)) {
			const n = fresh.find(f => !f.decision && f.kind === i.kind && f.key === i.key);
			if (!n) continue;
			const before = was(i);
			if (!GENERIC_TITLES.has(n.title)) i.title = n.title;
			i.text = n.text;
			i.tone = n.tone;
			if (was(i) !== before) changed++;
		}
	}
	return changed;
}

// A message of the last day stored as a plain message whose text the current rules read as a decision (a choice-block format the parser learned
// later, e.g. "결정 1:") and that nobody answered in its conversation since: it becomes the decision card it would be today, and the plain
// message item folds (one message, one notice). An answered one stays as it is. Returns how many messages turned into decisions.
function upgradeMessages(nowMs = Date.now()): number {
	const DAY = 86_400_000;   // reconcileStored runs at load, before DAY below exists
	const cands = items.filter(i => i.kind === "message" && !i.dismissed && !i.decision && i.at && Date.parse(i.at) > nowMs - DAY);
	if (!cands.length) return 0;
	const wanted = new Set(cands.map(i => i.at!));
	const outs: HubEvent[] = [], ins: HubEvent[] = [];
	for (const file of [paths.outbox, paths.inbox]) {
		if (!existsSync(file)) continue;
		for (const line of readFileSync(file, "utf8").split("\n")) {
			const ts = /"ts":"([^"]+)"/.exec(line)?.[1];
			if (!ts || Date.parse(ts) <= nowMs - DAY) continue;
			try {
				const e = JSON.parse(line) as HubEvent;
				if (file === paths.inbox) ins.push(e);
				else if (wanted.has(e.ts) && e.kind === "out") outs.push(e);
			} catch {
				continue;
			}
		}
	}
	let n = 0;
	for (const e of outs) {
		const ds = decisionsOf(e);
		if (!ds.length) continue;
		const conv = eventTarget(e);
		if (ins.some(x => x.ts > e.ts && eventTarget(x) === conv)) continue;
		for (const d of ds) putDecision(d, e.ts);
		for (const i of cands) if (i.at === e.ts) { i.read = true; i.dismissed = true; }
		n++;
	}
	return n;
}

export function reconcileStored(): void {
	replaying = true;
	try {
		const redrawn = rerenderPending() + upgradeMessages();
		// An open question stored without options (made before ask-options.ts) gets them by the same rule, in memory only: the file keeps what
		// was stored until the item changes for another reason.
		for (const i of items)
			if (i.decision?.state === "open" && !i.decision.options.length && !i.decision.to.startsWith("auth:")) {
				i.decision.options = askDefaults(i.text, i.decision.to.startsWith("mail:"));
				if (i.decision.options.length) i.decision.assumed = true;
			}
		// An open question stored before questions carried their expiry gets one from its own time, so the first sweep after an update
		// closes the ones whose time has passed (a send-approval card and a login request stay without one).
		let expiring = 0;
		for (const i of items) {
			const d = i.decision;
			if (d?.state !== "open" || d.expires_at !== undefined) continue;
			const exp = expiresAtOf(d, i.at ?? i.ts);
			if (!exp) continue;
			d.expires_at = exp;
			expiring++;
		}
		const gone = new Map<string, boolean>();
		const isGone = (name: string) => gone.get(name) ?? (gone.set(name, !laneExists(name)), gone.get(name)!);
		const map = readChannelMap();
		// A channel the gateway no longer has (deleted, or its session closed) answers nobody either.
		const lostChannel = (i: Notice) => {
			const ch = [i.src, i.open].find(c => c && /^ch:\d+$/.test(c));
			return !!map && !!ch && !map.known.has(ch.slice(3));
		};
		const stoppedBefore = (i: Notice, lane: string | undefined) => {
			if (lane === undefined || isOpenDecision(i) || (i.kind !== "message" && i.kind !== "result")) return false;
			const since = stoppedSince(lane);
			return since !== undefined && since <= Date.parse(i.updated);
		};
		const stale = items.filter(i => {
			const lane = laneOfNotice(i, map?.lanes);
			return !i.dismissed && (!i.read || isOpenDecision(i)) && ((lane !== undefined && isGone(lane)) || lostChannel(i) || stoppedBefore(i, lane));
		});
		retire(stale);
		// One message is one notice: an alert item stored next to a decision of the same message (same conversation, same event ts), made before the
		// alert post stopped making its own, is dismissed: kept in the file, never listed or counted.
		const asked = new Set(items.filter(d => d.decision?.reply_to).map(d => `${d.src ?? d.open}|${d.decision!.reply_to}`));
		const twins = items.filter(n => !n.decision && n.kind === "alert" && !n.dismissed && n.at !== undefined && asked.has(`${n.src ?? n.open}|${n.at}`));
		for (const n of twins) {
			n.read = true;
			n.dismissed = true;
		}
		// A title that is a raw channel id (made before the name was known) gets its name.
		let retitled = 0;
		for (const i of items)
			if (/^ch:\d+$/.test(i.title)) {
				i.title = channelTitle(i.title);
				retitled++;
			}
		let read = 0;
		for (const i of items)
			if (!i.read && coveredByRead(i)) {
				i.read = true;
				read++;
			}
		// An expiry given on load is kept in memory like the option defaults: the file is written by the next real change (the sweep's settle).
		if (stale.length || read || retitled || twins.length || redrawn) {
			save();
			log(`notices reconciled on load: ${redrawn} waiting items redrawn by the current rules, ${stale.length} of gone sessions retired, ${read} read by position, ${twins.length} duplicate alert items folded`);
		}
		if (expiring) log(`notices on load: ${expiring} open questions given an expiry from their own time`);
	} finally {
		replaying = false;
	}
}
// One-time fill of an empty store from what the hub already persisted (outbox.jsonl / inbox.jsonl of the last BACKFILL_DAYS days),
// through the same mapping as the live feed: worklog / alert / watch / schedule posts and lane results (one item per lane key, the
// latest). Items older than 24 h come in read, newer ones unread. Idempotent: once notices.json holds anything it does nothing.
// Call it once at startup, after setLaneTitleResolver and before anything posts. Returns the number of items created.
export function backfillNotices(nowMs = Date.now()): number {
	if (items.length) return 0;
	const since = nowMs - BACKFILL_DAYS * DAY_MS;
	const events: HubEvent[] = [];
	for (const file of [paths.outbox, paths.inbox]) {
		if (!existsSync(file)) continue;
		for (const line of readFileSync(file, "utf8").split("\n")) {
			try {
				const e = JSON.parse(line) as HubEvent;
				if (Date.parse(e.ts) >= since) events.push(e);
			} catch {
				continue;
			}
		}
	}
	events.sort((a, b) => a.ts.localeCompare(b.ts));
	replaying = true;
	replayClock = nowMs;
	try {
		for (const e of events) feed(e);
	} finally {
		replaying = false;
		replayClock = undefined;
	}
	// A question older than a day that nobody answered in the replayed history is no longer waiting.
	for (const i of items) if (isOpenDecision(i) && Date.parse(i.updated) < nowMs - DAY_MS) settleDecision(i, "", i.updated, true);
	for (const i of items) {
		if (isOpenDecision(i) || Date.parse(i.updated) >= nowMs - DAY_MS) continue;
		i.read = true;
		if (i.handled === null) i.handled = i.updated;
	}
	if (items.length) save();
	log(`notices backfilled: ${items.length} items from ${events.length} persisted events`);
	return items.length;
}

// The model's sentence arrived for a watch notice: its text is replaced, the notice keeps its place and read state.
function retextWatch(id: string, text: string): void {
	const n = items.find(i => i.id === id);
	if (!n || !text || n.text === text) return;
	n.text = text;
	save();
	broadcast({ ts: now(), kind: "notice", source: "gateway", item: n, unread: unreadCount() });
}

// The owner read a conversation up to `upTo`: every bell item whose source message lives there (and the 알림 / 작업 기록 items of
// those two conversations) up to that point is read too (an open decision stays open until answered).
// `viewed`: the owner only looked at the conversation (/api/read, setViewing): its unread answer, and a mail's new-mail notice (opening the mail is tapping
// that row); nothing else is read by looking.
export function readConversationNotices(conv: string, upTo: string, scope: "all" | "viewed" = "all"): void {
	const seen = (i: Notice) => scope === "all" || i.kind === "message" || conv.startsWith("mail:");
	const ids = items.filter(i => !i.read && !i.dismissed && (i.kind === conv || (i.src ?? i.open) === conv) && (i.at ?? i.ts) <= upTo && seen(i)).map(i => i.id);
	if (ids.length) markNoticesRead({ ids });
}

// `force` is for the hub's own closing paths (an answer settled the ask, a resolving signal): the request body can never set it, so a client's
// view / "read all" leaves every item that needsAnswer unread. The frame always names the ids that were read (never "all"), so clients agree.
export function markNoticesRead(sel: { ids?: unknown; all?: unknown }, force = false): { unread: number } {
	const ids = Array.isArray(sel.ids) ? new Set(sel.ids.map(String)) : new Set<string>();
	const all = sel.all === true;
	const hit = items.filter(i => !i.read && !i.dismissed && !(force ? isOpenDecision(i) : needsAnswer(i)) && (all || ids.has(i.id)));
	if (hit.length) {
		for (const i of hit) {
			// An unread failure from before `handled` stays on the owner's list once read, like the ones made now.
			if (i.handled === undefined && waitKind(i)) i.handled = null;
			i.read = true;
		}
		save();
		broadcast({ ts: now(), kind: "notice_read", source: "gateway", ids: hit.map(i => i.id), unread: unreadCount() });
	}
	return { unread: unreadCount() };
}

// Test hook: an empty store and no per-conversation memory, so a test does not depend on what an earlier test left behind.
export function resetNoticesForTest(): void {
	items = [];
	launchTitles.clear();
	viewers.clear();
	awaitingReply.clear();
	quietReplies.clear();
	sending.clear();
	orchTurnFrom = undefined;
	save();
}
