// Outbound path of the hub: the owner's messages out (out, progress, alert), the send ledger, the prompt queue and the shared delivery state.
// Split out of main.ts; it owns the one instance of that state and the other hub modules import it.
import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { DATA_DIR, log, NAME, now, paths, TZ, writeAtomic } from "./config.ts";
import * as discord from "./discord.ts";
import * as livestatus from "./livestatus.ts";
import { updateNow } from "./update-now.ts";
import { isNote, isOpenNudge, msg } from "./i18n.ts";
import { stripSteerMark } from "./steer-mark.ts";
import { normalizeAsk, plainBareAsk } from "./ask-normalize.ts";
import { stripRecommendMark } from "./choices.ts";
import { asksLimitStopInChat } from "./limit-ask.ts";
import { asksPersonalInChat } from "./personal-ask.ts";
import { answeredIds, answeredSince, broadcast, emit, emitDelivery, eventTarget, type HubEvent, ownerMessage, recentOwnerMessages, tailEvents, workAnswer } from "./events.ts";
import { settleWaiting, type Waiting } from "./awaiting.ts";
import { outEvent } from "./projectchat.ts";
import { recordProjectInfo } from "./projectinfo.ts";
import { mailByThread, mailTarget } from "./mail.ts";
import { allowedRoots } from "./files.ts";
import { claimPrefix, LaneRuntimeMismatch, lanes, type LaneDelivery, turnHeader } from "./lanes.ts";
import { main, type Orchestrator, steer as steerOrchestrator } from "./orchestrator.ts";
import { type Conv, convs, setWiring } from "./convsessions.ts";
import { MAIN, primaryTarget } from "./session-key.ts";
import { guardLine, guardTarget } from "./conv-guard.ts";
import { errorAsk } from "./orch-error.ts";
import { createBgWork, omoWorkById, sessionProjects } from "./bgwork.ts";
import { createWorkRows } from "./workrows.ts";
import { digest } from "./convdigest.ts";
import { createPrompts, type Pending, type Reply, type WorkLink } from "./prompts.ts";
import { createSendLedger } from "./sendlog.ts";
import { createInflight } from "./inflight.ts";
import { inOrder, localize } from "./outlang.ts";
import { dropClaim, resolvesOf, splitTone, stripHandoff, stripLater, stripProjectInfo, stripResolves } from "./tone.ts";
import { isLate, isSnowflake, lateQuote, lateRequestId, replyRef, snowflakeTime, withQuote } from "./threads.ts";
import { keepBrief } from "./draft-approval.ts";
import { allNotices, markDraftPosted, onDecisionClosed, onDraftCardRefreshed, openDraftCards, openDraftRefs, openDraftText, orchestratorAnswered, resolveNotices, rewriteOpenDraft } from "./notices.ts";
import { cardPointer, cardRef, cardTitle, CARDS_LEAD, closedCardText, createApprovalQueue, loadHeld, pendingCardsNote, splitDraftCards } from "./approval-queue.ts";
import { mailItemKey, mailKeyOfRef } from "./draft-handled.ts";
import { draftHeads, listDrafts as listMailDrafts } from "../features/reply-drafts/lib/store.ts";
import { askText } from "../features/reply-drafts/lib/flow.ts";
import { recheckAnswered } from "./watch-recheck.ts";
import { route } from "./notify-route.ts";
import { isWebLane } from "./discord-post.ts";
import { repeatAlert } from "./alert-gate.ts";
import { pendingWaits } from "./auth.ts";
import { leadWith } from "./stuck.ts";

// Prompt queue: see prompts.ts. Unanswered prompts are kept on disk, so a restart mid-turn replays them on boot.
const PENDING = join(DATA_DIR, "pending.json");
// Read before anything in this process delivers (and rewrites the file); replayed once the orchestrator starts.
let unanswered: Pending[] = [];
try {
	if (existsSync(PENDING)) unanswered = JSON.parse(readFileSync(PENDING, "utf8"));
} catch {}
// Messages the owner must get go through the send ledger: kept on disk until Discord accepts them, retried through
// network outages, sent again after a restart; an answer marks its message answered only once it was delivered.
const UNSENT = join(DATA_DIR, "unsent.json");
// A card that went to Discord as one message is edited there too, its buttons with its options (a [file] line would show raw in an edit, so such a card keeps its first text).
function editCard(target: string, ids: string[] | undefined, ref: string, text: string): void {
	const id = ids?.length === 1 ? ids[0] : undefined;
	if (id && !isLocal(target) && route({ target }).messengers.discord && !/^\s*\[file\]\s/m.test(text)) void discord.edit(target, id, text, { buttons: true }).catch(e => log(`approval card ${ref} not edited on Discord: ${e}`));
}
export const sends = createSendLedger({
	file: UNSENT,
	send: (target, text, ref, opts) => discord.send(target, text, ref, opts),
	retryable: discord.isRetryable,
	onDelivered: item => convs.markAnsweredAll(item.answers),
	onGiveUp: (item, reason) => log(`send to ${item.target} dropped unsent: ${reason} (${item.text.slice(0, 80)})`),
	persist: items => writeAtomic(UNSENT, `${JSON.stringify(items, null, 2)}\n`),
	log,
});
// A web lane's lane:<name> is its web conversation, which the caller's outbox/inbox event already fed (hub/lanewire.ts): there
// is no Discord place to send to, so the post is done there instead of failing in the ledger as an unknown Discord target.
// A web-only install (no bot token, discord.status.enabled false) has no Discord at all: every post is done in the web the same way.
export const send = (target: string, text: string, ref?: string): Promise<{ delivered: boolean; reason?: string; ids?: string[] }> =>
	!discord.status.enabled || (target.startsWith("lane:") && isWebLane(target.slice(5))) ? Promise.resolve({ delivered: true }) : sends.submit(target, stripSteerMark(text), ref);
// One prompt queue per session (hub/convsessions.ts): main's, and with conversation sessions on, one per conversation. Each delivers into
// its own orchestrator instance; `recent` keeps only that session's conversations, so an answer that arrives without a prompt can
// only go to a message of its own conversation (prompts.ts orphanTarget).
// The name the owner reads for a conversation: its own name when set, else the target it was opened for.
const convLabel = (target: string) => convs.forTarget(target)?.meta.name || convs.forTarget(target)?.primary || target;
function makeQueue(key: string, o: Orchestrator, pendingFile: string, bg: () => ReturnType<typeof createBgWork> | undefined) {
	// Which request each worker serves, beside pending.json: read here once, written only when a link changes.
	const linksFile = pendingFile.replace(/\.json$/, "-links.json");
	let links: WorkLink[] = [];
	try {
		if (existsSync(linksFile)) links = JSON.parse(readFileSync(linksFile, "utf8"));
	} catch (e) {
		log(`worker links in ${linksFile} not read: ${e}`);
	}
	return createPrompts({
		links,
		persistLinks: all => writeAtomic(linksFile, `${JSON.stringify(all)}\n`),
		report: id => bg()?.reportOf(id),
		deliver: o.deliver,
		steer: o.steer,
		working: () => o.orch.status === "working",
		note: (target, replyTo, text) => msg().newMessage(target, replyTo, text),
		isNote: text => isNote(text, "newMessageLead") || isNote(text, "waitedLead") || isNote(text, "laneReportLead"),
		regenerated: isOpenNudge,
		post: (target, text, replyTo) => out(target, text, replyTo, { auto: true, session: key }),
		// A quiet check's plain answer: one gateway line in the worklog. Its text opens the line, so no tone marker in the answer can make it a result that pushes.
		quietNote: (_target, text) => void out("worklog", msg().scheduleCheckLine(text.replace(/\s+/g, " ").slice(0, 300)), undefined, { source: "gateway", wk: "check" }).catch(e => log(`quiet check line failed: ${e}`)),
		// An answer no label explains lands in the session's own conversation; work another session handed over goes back to it, as that session's next prompt.
		home: primaryTarget(key),
		handBack: (from, text, replyTo) => void convs.deliverTo(from, `${msg().handbackLead} ${text}`, { target: convs.get(from)?.primary ?? primaryTarget(from), replyTo, handback: true }),
		// The deferral acknowledgement is the gateway speaking, not the answer: it must leave the deferred prompt open.
		announce: (target, text, worker) => void systemNote(target, text, "deferred", worker).catch(e => log(`deferral note to ${target} failed: ${e}`)),
		interim: (target, text) => void out(target, text, undefined, { auto: true, session: key, keepsOpen: true }).catch(e => log(`note to ${target} failed: ${e}`)),
		// The worker the [later] turn just spawned, as OmO's task store lists it (bgWork is created below and read at call time).
		workFor: target => {
			const w = bg()?.list().find(w => w.status === "running" && w.target === target);
			return w && { id: w.id, description: w.description };
		},
		joinNote: w => msg().joinWorker(w.id, w.description),
		noAnswerNote: () => msg().turnNoAnswer,
		hasJoinNote: text => text.split("\n").some(line => isNote(line, "joinLead")),
		// The session's workers as bgwork lists them (read only at delivery and turn end): another conversation's running worker must
		// not answer through this conversation's turn, and one that finished elsewhere gets its own request asked again.
		work: () => (bg()?.list() ?? []).map(w => ({ id: w.id, description: w.description, status: w.status, ...(w.target ? { target: w.target } : {}), ...(w.reply_to ? { replyTo: w.reply_to } : {}), startedAt: w.started_at, ...(w.ended_at !== undefined ? { endedAt: w.ended_at } : {}) })),
		foreignNote: (w, target) => msg().otherWorker(w.id, convLabel(target), w.replyTo),
		hasForeignNote: text => text.split("\n").some(line => isNote(line, "otherConvLead")),
		readElsewhereNote: (w, readIn) => msg().workReadElsewhere(w.id, convLabel(w.target ?? readIn), convLabel(readIn)),
		readHereNote: id => msg().workReadHere(id),
		cardsNote: target => cardsNoteFor(target),
		hasCardsNote: text => text.startsWith(CARDS_LEAD) || text.includes(`\n${CARDS_LEAD}`),
		clearProgress: target => void discord.clearProgress(target),
		persist: open => writeAtomic(pendingFile, `${JSON.stringify(open, null, 2)}\n`),
		log,
		answered: answeredIds(),
		pending: sends.pending,
		recent: () => recentOwnerMessages().filter(m => convs.keyOf(m.target) === key),
		answeredSince,
		settled: settleRefs,
	});
}
// A failed worker no turn took up is handed back to its own session, answering in the conversation it served (bgwork.ts handover).
// A stalled worker (still "running" in OmO's store, no longer working) wakes its session once the same way, and is named in
// the session's usage-limit resume note when the limit held that wake back.
const sessionBg = (o: Orchestrator, q: ReturnType<typeof createPrompts>) => {
	const to = (w: { target?: string; reply_to?: string }) => (w.target ? { target: w.target, ...(w.reply_to ? { replyTo: w.reply_to } : {}) } : undefined);
	const bg = createBgWork({
		sessionFile: () => o.orch.sessionFile, deferred: q.deferredOpen, turn: q.turnAt, answer: workAnswer, log,
		linkOf: q.linkOf,
		link: (id, to, description) => void q.link(id, to, description),
		turnEndedAt: () => o.lastTurnEndAt(),
		busy: () => o.orch.status === "working" || o.orch.status === "starting",
		paused: () => o.orch.status === "rate-limited",
		handover: w => void q.deliver(msg().workFailed(w.description, w.id, w.reason || w.error || "이유가 기록되지 않았어요"), to(w)),
		stalled: w => void q.deliver(msg().workStalled([w]), to(w)),
	});
	o.setResumeExtra(() => {
		const stalled = bg.takeStalled();
		return stalled.length ? msg().workStalled(stalled) : "";
	});
	return bg;
};
export const queue = makeQueue(MAIN, main, PENDING, () => bgWork);
// The orchestrator's background task workers (what a `[later]` turn waits for), read from OmO's task store: /api/workers, /api/state `work`.
export const bgWork = sessionBg(main, queue);
const mainConv = convs.setMain({ key: MAIN, o: main, queue, bg: bgWork });
// The rows that name a job in every conversation (hub/workrows.ts): any session's job, read from the agent's task store.
const taskProjects = () => [...new Set([join(process.env.OMO_CODING_AGENT_DIR ?? process.env.PI_AGENT_DIR ?? join(homedir(), ".omo", "agent"), "projects"), ...(main.orch.sessionFile ? [sessionProjects(main.orch.sessionFile)] : [])])].filter(p => existsSync(p));
export const workRows = createWorkRows({
	find: id => {
		const projects = taskProjects();
		return projects.length ? omoWorkById(id, projects) : null;
	},
	answer: workAnswer,
	replyOf: id => [queue, ...convs.conversations().map(c => c.queue)].map(q => q?.linkOf(id)?.replyTo).find(Boolean),
	push: (items, at) => broadcast({ kind: "work", items, at }),
});
// `owner` marks the owner's own message (it leads with the what-runs-now line); schedules, watches and mail carry a target but are not.
// True when the message was steered into the running turn (only one of the same conversation is, prompts.ts deliver).
// A prompt with a target (an owner message, a schedule, a watch or a mail wake of a conversation) goes to that conversation's session
// (main with conversation sessions off); one with no target goes to main.
// From a tap on the update bar until the restart, a new turn is held and goes in after it (hub/update-now.ts).
export function deliver(text: string, reply?: Reply): boolean {
	if (updateNow()?.hold(text, reply)) return false;
	return deliverNow(text, reply);
}
export function deliverNow(text: string, reply?: Reply): boolean {
	if (reply) discord.typing(reply.target);
	return convs.deliverTo(reply?.target ? convs.keyOf(reply.target) : MAIN, text, reply);
}

// "web:alert" / "web:worklog": the answer to a question the owner asked in that web conversation (hub/intake.ts sendWeb).
// "mail:<key>": a mail with no Discord thread (hub/mail.ts) lives in the web only.
const isLocal = (target: string) => target === "web" || target === "terminal" || target === "web:alert" || target === "web:worklog" || target.startsWith("mail:") || target.startsWith("settings:") || (target.startsWith("ch:") && discord.isLocalChannel(target.slice(3)));
// The work channel a Discord thread hangs from: its sends show in that project's web chat (projectchat.ts outEvent).
const threadHome = (thread: string): string | undefined => {
	const parent = discord.channels.threads[thread]?.parent;
	return parent && discord.channels.work[parent] ? parent : undefined;
};
// A project turn's <project-info> block goes into the project's info (hub/projectinfo.ts); an open project page reloads on the event.
function noteProjectInfo(target: string, text: string): void {
	const parent = target.startsWith("th:") ? threadHome(target.slice(3)) : undefined;
	const key = parent ? `ch:${parent}` : /^ch:\d+$/.test(target) ? target : undefined;
	if (key && recordProjectInfo(key, text)) broadcast({ kind: "project_info", key });
}
// An answer's closing `<resolves>…</resolves>` line closes the open questions it names, exactly as dotz_send's `resolves` does (routes.ts): only those of
// `session`'s conversations, "*" for every one. A line that names nothing closes nothing and leaves one line in hub.log. The line itself is stripped for the owner (tone.ts).
function settleResolves(text: string, session: string): void {
	for (const words of resolvesOf(text)) {
		const r = resolveNotices(words === "*" ? { all: true } : { match: words }, conv => convs.keyOf(conv ?? "") === session);
		if (!r.resolved) log(`resolves line of ${session} matched no open question: ${words.slice(0, 80)}`);
	}
}
const threadMail = (thread: string): string | undefined => {
	const m = mailByThread(thread);
	return m && mailTarget(m.key);
};
// The newest owner message per target (threads.ts replyRef: a thread answer carries a reply reference only when it is not to that one).
export const lastOwner = new Map<string, string>();
// Delivery state of owner messages (hub/events.ts emitDelivery): the owner events' ids per orchestrator target, until its answer.
export const awaiting = new Map<string, Waiting[]>();
export const refOf = (e: Record<string, any>): string | undefined => e.mid ?? e.message_id ?? undefined;
export const newMid = () => randomUUID().slice(0, 8);
// Web has no message to edit: the receipt and progress line are one "out" note per conversation (the page keeps the newest).
// `live` marks the gateway's own status (livestatus.ts): the page draws its lines as a status instead of a message.
const webNote = (target: string, text: string, live = false) => emit("outbox", { ts: now(), kind: "out", source: "gateway", target, text, update_key: "progress", ...(live ? { live } : {}) });
export const receiptNote = (how: LaneDelivery): string | undefined =>
	how === "steered" ? "📨 받았어요. 하던 작업에 바로 넣었고, 답이 준비되면 여기로 올게요." : how === "held" ? "📨 받았어요. 사용량 한도가 풀리면 바로 전달할게요." : how === "resumed" ? "📨 받았어요. 멈춰 있던 세션을 다시 시작해서 전달했어요." : undefined;
// An owner message that could not reach its session: the failed state on the message and, in that chat, a gateway message with the way forward.
export function laneFailed(target: string, lane: string, ref: string | undefined, error: unknown, replyTo?: string): void {
	const reason = (error as Error).message;
	emitDelivery(target, ref, "failed", reason.slice(0, 200));
	log(`lane ${lane}: owner message not delivered: ${reason}`);
	// A session of another runtime: the refusal itself offers the handover (answer "인계" here).
	const text = error instanceof LaneRuntimeMismatch ? error.message : `세션 ${lane}을(를) 이어갈 수 없어요 (${reason}). 대화 채널에서 다시 맡겨 주세요. 이전 보고는 ${join(paths.lanes, lane, "report.md")}에 있어요.`;
	void out(target, text, replyTo, { source: "gateway" }).catch(e => log(`lane failure notice failed: ${e}`));
}
type OutJob = { target: string; text: string; replyTo?: string; extra: Record<string, unknown> };
const jobAnswers = (j: OutJob) => (j.extra.source === undefined || j.extra.source === "orchestrator" ? j.replyTo : undefined);
// The web draws a bot message that replies to an owner message with that message quoted, as it does for the owner's own replies.
const replyQuote = (id?: string) => {
	const m = id ? ownerMessage(id) : undefined;
	return id && m?.text.trim() ? { reply: { id, author: m.author ?? "", content: m.text.trim().slice(0, 300) } } : {};
};
const emitOut = (j: OutJob, t: string) => {
	// What another session posted into its conversation is what main's digest carries; progress notes and notices are not exchanges.
	if (!j.extra.update_key && (j.extra.source === undefined || j.extra.source === "orchestrator")) digest.note(convs.keyOf(j.target), "bot", t, Date.now(), typeof j.extra.session === "string" ? j.extra.session : undefined);
	emit("outbox", outEvent({ ts: now(), kind: "out", source: "orchestrator", target: j.target, text: t, reply_to: j.replyTo ?? null, ...replyQuote(j.replyTo), ...j.extra }, threadHome, threadMail));
};
const askedAtMs = (id: string): number | undefined => {
	if (isSnowflake(id)) return snowflakeTime(id);
	const at = Date.parse(ownerMessage(id)?.ts ?? "");
	return Number.isNaN(at) ? undefined : at;
};
const lateFor = (target: string, replyTo: string | undefined) => isLate(replyTo, lastOwner.get(target), replyTo ? askedAtMs(replyTo) : undefined);
const lateRequest = (target: string) => {
	const q = convs.forTarget(target)?.queue ?? queue;
	return lateRequestId(target, q.current(), lastOwner.get(target), askedAtMs);
};
function markShown(target: string, done: Waiting[]): void {
	for (const w of done) {
		emitDelivery(target, w.ref, "answered");
		convs.markAnsweredAll(w.ref);
		convs.markAnsweredAll(w.by);
	}
	recheckAnswered(target);
}
// An answer that named another message of the burst also answered these: each shows as answered.
export function settleRefs(target: string, ids: string[]): void {
	const done = ids.flatMap(id => {
		const r = settleWaiting(awaiting.get(target) ?? [], id, false);
		awaiting.set(target, r.keep);
		return r.done;
	});
	if (done.length) markShown(target, done);
}
// An answer (not a progress note, not a gateway notice, not a held approval card shown later) settles the owner messages waiting in this conversation.
function settleAnswer(j: OutJob): void {
	if ((j.extra.source === undefined || j.extra.source === "orchestrator") && !j.extra.update_key && !j.extra.queued && !j.extra.keepsOpen) {
		// The answer ends the turn's progress reports here, the web chat's included: none may post after it.
		void livestatus.stop(j.target);
		const { done, keep } = settleWaiting(awaiting.get(j.target) ?? [], j.replyTo, isLocal(j.target), (convs.forTarget(j.target)?.queue ?? queue).waitingIds(j.target));
		awaiting.set(j.target, keep);
		// One truth: a message shown as answered is answered for the prompt queue too (deferred wait, pending.json, restart replay).
		// An answer that names the last message of a burst (`by`) leaves the burst's other prompts open otherwise.
		markShown(j.target, done);
	}
}
// Everything after the text is final: the delivery states, then the web is done or the send ledger (kept on disk) takes over.
function handOver(j: OutJob, sent: string): Promise<{ delivered: boolean; reason?: string; ids?: string[] }> {
	settleAnswer(j);
	// Web only: a web conversation, a kind the owner switched off for Discord (hub/discord-post.ts), or a gateway alert that repeats one Discord already has.
	// `discord_route`: the post's own app or monitor decided it (a monitor's 디스코드에도 보내기 switch, hub/watch-settings.ts), over the class switch.
	const toDiscord = typeof j.extra.discord_route === "boolean" ? j.extra.discord_route : route({ target: j.target, text: j.text, extra: { ...j.extra, ...(threadMail(j.target) ? { mail: true } : {}) }, replyTo: j.replyTo }).messengers.discord;
	if (isLocal(j.target) || j.extra.repeat === true || !toDiscord || !discord.status.enabled) {
		convs.markAnsweredAll(jobAnswers(j));
		return Promise.resolve({ delivered: true });
	}
	// Late: the owner wrote something newer meanwhile or the request is old. Discord shows it as a reply that pings him; a web
	// message has no Discord message to reference, so the request is quoted in the text instead.
	const answers = jobAnswers(j);
	const late = answers !== undefined && lateFor(j.target, answers);
	const original = late && answers && !isSnowflake(answers) ? ownerMessage(answers) : undefined;
	const text = original ? withQuote(sent, lateQuote(original, TZ)) : j.extra.system ? `-# ${sent}` : sent;
	return sends.submit(j.target, text, replyRef(j.target, j.replyTo, lastOwner.get(j.target), late), answers, late);
}
// Posts still in the output-language rewrite: the restart gate waits for them, shutdown lands what is left with the original text.
export const replies = createInflight<OutJob>(j => {
	emitOut(j, j.text);
	void handOver(j, j.text).catch(e => log(`reply to ${j.target} failed at shutdown: ${e}`));
	log(`reply to ${j.target} landed untranslated at shutdown (${j.text.length} chars)`);
});
// One send-approval card at a time per conversation, and no second post of an open card (hub/approval-queue.ts).
const HELD = join(DATA_DIR, "approval-queue.json");
export const convOfTarget = (target: string) => eventTarget(outEvent({ ts: "", kind: "out", source: "orchestrator", target, text: "" } as HubEvent, threadHome, threadMail)) ?? "main";
// Whether the item behind a card was handled elsewhere (hub/main.ts wires the apps' facts, as it does for notices.ts settleHandledDrafts).
let refHandled: (ref: string, conv: string) => boolean | Promise<boolean> = () => false;
export const setRefHandled = (fn: typeof refHandled): void => void (refHandled = fn);
export const approvals = createApprovalQueue({
	convOf: convOfTarget,
	openRefs: openDraftRefs,
	// The bot's `mail:<id>` card and the app's reply draft of that mail are one item.
	itemOf: (conv, ref) => mailItemKey(ref, conv, draftHeads),
	handled: (ref, conv) => refHandled(ref, conv),
	post: (target, text, extra) => void out(target, text, undefined, { ...extra, queued: true, ...(extra.session ? { cross: "approval" } : {}) }).catch(e => log(`held approval card to ${target} failed: ${e}`)),
	rewrite: (conv, card, next) => {
		// A card that replaces the open one keeps what only that one showed (hub/draft-approval.ts keepBrief).
		const text = keepBrief(openDraftText(conv, card.ref) ?? "", next);
		rewriteOpenDraft(conv, card.ref, text);
		editCard(card.target, card.ids, card.ref, text);
	},
	// The web's 빠른 처리 banner counts held cards too (web/js/30-triage.js): it refetches on this.
	persist: held => {
		writeAtomic(HELD, `${JSON.stringify(held, null, 2)}\n`);
		broadcast({ ts: now(), kind: "approvals", source: "gateway", held: held.length });
	},
	log,
	load: () => loadHeld(HELD, log),
});
/**
 * Start-up reconcile for installs where the bot's own mail card (`mail:<mailId>`) took the item and the app's reply draft of that mail lost its card
 * (2026-11-02: a held draft card was dropped as redundant, so the bot card stayed open with no staged files and the draft waited with no card).
 * The app draft's card goes back through out(), so route() finds the open bot card as the same item and rewrites it in place to the draft's ref and
 * its staged files. Idempotent: the rewritten card's ref is the draft code (not `mail:`), so a second pass has nothing to replace.
 */
export async function reconcileMailCards(): Promise<number> {
	const waiting = new Map<string, ReturnType<typeof listMailDrafts>[number]>();
	for (const d of listMailDrafts()) {
		if (d.status !== "pending") continue;
		// 고치기 keeps the older pending draft as handled; the newest pending one of a mail is the card to rescue.
		const seen = waiting.get(d.ref);
		if (!seen || seen.created < d.created) waiting.set(d.ref, d);
	}
	let replaced = 0;
	for (const c of openDraftCards()) {
		if (!c.ref.startsWith("mail:")) continue;
		const key = mailKeyOfRef(c.ref, c.to);
		const draft = key ? waiting.get(key) : undefined;
		if (!key || !draft) continue;
		try {
			await out(mailTarget(key), askText(draft, []));
			replaced++;
		} catch (e) {
			log(`approval card ${c.ref} in ${c.to} not replaced by its draft ${draft.id}: ${(e as Error).message}`);
		}
	}
	return replaced;
}
// The card of a closed decision shows it on Discord too: first line kept, buttons removed, how it ended (a [file] line would show raw in an edit, so such a text is left).
function closeDiscordCard(to: string, ref: string | undefined, c: { text: string; how: "answered" | "resolved" | "ignored"; label: string; target?: string; ids?: string[] }): void {
	const target = c.target ?? (ref ? approvals.targetOf(to, ref) : undefined);
	const ids = c.ids?.length ? c.ids : ref ? approvals.idsOf(to, ref) : undefined;
	if (!target || !ids?.length || isLocal(target) || !route({ target }).messengers.discord) return;
	const text = closedCardText(c.text, c.how, c.label);
	if (/^\s*\[file\]\s/m.test(text)) return;
	ids.forEach((id, i) => void discord.edit(target, id, i === 0 ? text : text.split("\n").slice(1).join("\n"), { clearComponents: true }).catch(e => log(`approval card ${ref} not closed on Discord: ${e}`)));
}
onDraftCardRefreshed(n => {
	const d = n.decision;
	if (d?.card && d.draft?.ref) editCard(d.card.target, d.card.ids, d.draft.ref, `[ask] ${n.text}`);
});
onDecisionClosed((to, ref, card) => {
	if (card) closeDiscordCard(to, ref, card);
	approvals.closed(to, ref);
});
// Where the open card of `conv` is: its Discord message, when it went there.
const cardLink = (c: { target: string; ids?: string[] }) => (c.ids?.[0] && !isLocal(c.target) && route({ target: c.target }).messengers.discord ? discord.messageLink(c.target, c.ids[0]) : undefined);
// A later post in a conversation whose card still waits pushes the card up out of sight (2026-10-31: "19번 카드는 위에 있어", then
// "어디에있음?", "마지막 카드 어디?"): such a post ends with one line naming the waiting card and linking to it.
function withCardPointer(target: string, text: string): string {
	const c = approvals.openCard(convOfTarget(target));
	return c && c.target === target ? `${text.replace(/\s+$/, "")}\n${cardPointer(c, cardLink(c))}` : text;
}
// The bot's turn for an owner message names the cards waiting in that conversation ("마지막 카드 어디?" is answerable from it).
const cardsNoteFor = (target: string): string | undefined => {
	const conv = convOfTarget(target), shown = approvals.openCard(conv);
	const cards = openDraftCards(conv).map(c => ({ ref: c.ref, title: cardTitle(c.text) || c.title, notice: c.id, ...(shown?.ref === c.ref ? { progress: shown.progress, link: cardLink(shown) } : {}) }));
	return pendingCardsNote(cards, approvals.heldIn(conv).length);
};
// A gateway status line (a deferral receipt): `system` on its event makes the web draw a compact system line (opening `worker` with its
// live state) and Discord a small `-# ` line; it is never unread and never pushed (push.ts classify only pushes orchestrator answers).
export const systemNote = (target: string, text: string, system: string, worker?: string) => out(target, text, undefined, { source: "gateway", system, ...(worker ? { worker } : {}) });
// A session's post stays in its own conversation unless it names a reason (hub/conv-guard.ts); a post with no session (the gateway's) is not checked.
function guarded(session: unknown, target: string, cross?: unknown): string {
	if (typeof session !== "string") return target;
	const g = guardTarget(session, target, t => convs.keyOf(t), typeof cross === "string" ? cross : undefined);
	const line = guardLine(session, target, g);
	if (line) log(line);
	return g.target;
}
export async function out(target: string, text: string, replyTo?: string, extra: Record<string, unknown> = {}): Promise<{ delivered: boolean; reason?: string }> {
	const inHome = guarded(extra.session, target, extra.cross);
	if (inHome !== target) [target, replyTo] = [inHome, undefined];
	// Gateway notices (rate-limit hold, command and limits replies) reply to a message without answering its request.
	const answersOwner = (extra.source === undefined || extra.source === "orchestrator") && !extra.keepsOpen;
	const said = stripSteerMark(text);
	text = stripLater(said);
	if (typeof extra.session === "string") settleResolves(text, extra.session);
	noteProjectInfo(target, text);
	if (said && !stripProjectInfo(text)) return { delivered: true };
	// A gateway post to the alert conversation (a failing watch) is gated like alert() below.
	if (target === "alert" && extra.source === "gateway" && !extra.update_key && repeatAlert(text)) extra = { ...extra, repeat: true };
	// The assistant's send-approval card waits its turn in its conversation (a held card is posted later by the queue, marked `queued`).
	const routed = answersOwner && !extra.update_key && !extra.queued;
	// Every answer and dotz_send of every conversation passes here: a list of options becomes a decision card whoever wrote it (hub/ask-normalize.ts).
	const fromLane = typeof extra.source === "string" && extra.source.startsWith("lane:");
	const body = routed ? normalizeAsk(stripHandoff(text)) : fromLane ? plainBareAsk(stripRecommendMark(stripHandoff(text))) : stripRecommendMark(stripHandoff(text));
	// Several drafts in one post: each is its own card, in the queue below.
	const drafts = routed ? splitDraftCards(body) : undefined;
	if (drafts) {
		let last: { delivered: boolean; reason?: string } = { delivered: true };
		for (const c of drafts) last = await out(target, c, replyTo, extra);
		return last;
	}
	const job: OutJob = { target, text: body, replyTo: replyTo ?? (routed ? lateRequest(target) : undefined), extra };
	const routing: { card?: ReturnType<typeof approvals.route> } = {};
	let landed = false;
	replies.begin(job);
	let sent: string;
	try {
		sent = await inOrder(target, async () => {
			let t = await localize(job.text, target, typeof extra.source === "string" ? extra.source : "orchestrator");
			if (asksPersonalInChat(t)) {
				log(`personal-data ask in chat to ${target}: the form (dotz_auth) is the only way to ask`);
				steerOrchestrator(msg().personalAskNote);
			}
			if ((extra.source === undefined || extra.source === "orchestrator") && asksLimitStopInChat(t)) {
				log(`limit-stop ask in chat to ${target}: the gateway applies the owner's setting at a real limit`);
				steerOrchestrator(msg().limitStopAskNote);
			}
			const card = routed ? approvals.route(target, t, extra) : undefined;
			routing.card = card;
			if (card?.action === "post") t = card.text ?? withCardPointer(target, t);
			// False: shutdown already landed this post with the original text.
			landed = replies.end(job);
			if (landed && (!card || card.action === "post")) emitOut(job, t);
			return t;
		});
	} finally {
		replies.end(job);
	}
	if (!landed) return { delivered: true };
	const card = routing.card;
	if (card && card.action !== "post") {
		settleAnswer(job);
		return { delivered: true };
	}
	const r = await handOver(job, sent);
	if (card || extra.queued) approvals.posted(target, sent, r.ids);
	const cardOf = r.ids?.length ? cardRef(sent) : undefined;
	if (cardOf && r.ids) markDraftPosted(convOfTarget(target), cardOf, target, r.ids);
	return r;
}

// While an owner message waits for its answer the owner sees 👀, typing and, for long work, one progress message edited in
// place (livestatus.ts). Nothing is sent before the answer is ready (owner 2026-10-20: "답변은 준비되고 해야해. 먼저하면
// 안됨"), so the gateway no longer steers the orchestrator into posting a note after 60 s.
export function expectReply(target: string): void {
	if (isLocal(target)) return;
	livestatus.begin(target, turnSource(target));
}
// The activity source of the session that answers `target` (a conversation session's own, main's with sessions off): its turn_end
// is the end of the wait (2026-11-01: a work channel's session answered at 1:40, main's turn never ended, "5분째 작업 중" at 5:00).
export const turnSource = (target: string): string => convs.forTarget(target)?.o.source ?? "orchestrator";
// At gateway start no turn reports progress yet: a web progress line still shown from before (posted after its answer, or the
// gateway stopped mid-turn) is finalized with an empty note, which the page drops.
export function clearLeftWebProgress(): void {
	const open = new Set<string>();
	for (const e of tailEvents(paths.outbox)) {
		if (e.kind !== "out" || typeof e.target !== "string") continue;
		if (e.update_key === "progress" && e.source === "gateway") String(e.text ?? "").trim() ? open.add(e.target) : open.delete(e.target);
		else if (!e.update_key) open.delete(e.target);
	}
	for (const target of open) webNote(target, "");
	if (open.size) log(`cleared ${open.size} progress line(s) left from turns no longer running: ${[...open].join(", ")}`);
}

// The same alert again (hub/alert-gate.ts) is marked on its event (the bell rewrites the first one, no push) and not posted to Discord again.
export function alert(text: string): void {
	const repeat = repeatAlert(text);
	emit("outbox", { ts: now(), kind: "out", source: "gateway", target: "alert", text, ...(repeat ? { repeat: true } : {}) });
	if (route({ target: "alert", text }).messengers.discord && !repeat) void send("alert", text).catch(e => log(`alert send failed: ${e}`));
}

// Said once per conversation per pause (a pause is known by when it began being announced): the owner's 2nd and 3rd message
// in the same stoppage get no repeat of it (owner 2026-10-26: 멈춤 알림은 한 번만).
const pauseToldIn = new Set<string>();
let pauseToldFor = "";
export function rateLimitNotice(target: string, replyTo?: string): void {
	// The pause of the session that answers this conversation (one not started yet is not paused).
	const orch = convs.forTarget(target)?.o.orch;
	if (orch?.status !== "rate-limited") {
		pauseToldIn.clear();
		pauseToldFor = "";
		return;
	}
	const episode = orch.pauseKind ?? "";
	if (episode !== pauseToldFor) {
		pauseToldIn.clear();
		pauseToldFor = episode;
	}
	if (pauseToldIn.has(target)) return;
	pauseToldIn.add(target);
	const until = new Date(orch.rateLimitedUntil);
	const at = Number.isNaN(until.getTime()) ? "한도가 풀리면" : `${until.toLocaleString("ko-KR", { timeZone: TZ, month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" })}쯤`;
	const text = orch.pauseKind === "owner" ? "지금 모델 제공자 결제/인증 문제로 멈춰 있어요. 해결되면 받은 메시지부터 이어서 처리할게요." : `지금 사용량 한도로 멈춰 있어요. ${at} 이어서 처리할게요.`;
	void out(target, text, replyTo, { source: "gateway" }).catch(() => undefined);
}

export async function progress(target: string, key: string, text: string, replyTo?: string, session?: string, cross?: string): Promise<{ delivered: boolean; reason?: string; edited?: boolean }> {
	const inHome = guarded(session, target, cross);
	if (inHome !== target) [target, replyTo] = [inHome, undefined];
	const sent = await inOrder(target, async () => {
		let t = await localize(stripHandoff(text), target, "orchestrator");
		// The label goes in after the status marker ([done] becomes the leading emoji) and after localize (a rewrite must not touch it).
		if (target === "worklog" && key.startsWith("lane:")) {
			const prefix = claimPrefix(key.slice(5));
			const { head, rest } = splitTone(t);
			if (prefix) t = `${head}${prefix}${dropClaim(rest)}`;
		}
		emit("outbox", outEvent({ ts: now(), kind: "out", source: "orchestrator", target, text: t, update_key: key, ...(target === "worklog" && key.startsWith("lane:") ? { wk: "session" } : {}) }, threadHome, threadMail));
		return t;
	});
	if (isLocal(target) || !discord.status.enabled || !route({ target, text: sent, extra: { update_key: key }, replyTo }).messengers.discord) return { delivered: true };
	// One evolving status per asking channel: every progress key there edits the same message the gateway's live report
	// uses (worklog and alert keep their per-key entries, e.g. one per lane).
	return discord.progress(target, target === "worklog" || target === "alert" ? key : "progress", sent, replyTo);
}

export const fileRoots = () => allowedRoots([...lanes.values()].flatMap(l => [l.cwd, l.worktree?.path ?? ""]));

// Prompts that were delivered but never answered (the gateway stopped mid-turn) are delivered again on start.
// Returns how many prompts were replayed.
const replayWrap = (text: string) => (isNote(text, "replayLead") ? text : `${msg().replay}\n${text}`);
export function replayPending(): number {
	const open = unanswered;
	unanswered = [];
	// Stored conversation sessions come back parked; their open prompts go into their own session (feature on) or main (off).
	const stored = convs.restore();
	// The messages still wait after the restart: their answer must settle them (`awaiting` lives in memory).
	for (const p of [...open, ...stored.flatMap(r => r.pending)]) if (p.target && p.replyTo) awaiting.set(p.target, [...(awaiting.get(p.target) ?? []), ...[...new Set([...(p.refs ?? []), p.replyTo])].map(ref => ({ ref, by: p.replyTo }))]);
	const toMain = [...stored.filter(r => r.key === MAIN).flatMap(r => r.pending)];
	// With conversation sessions on, main's own file may still hold a conversation's prompt from before: it goes to that session.
	const mine = open.filter(p => convs.keyOf(p.target) === MAIN);
	let n = queue.replay([...mine, ...toMain], replayWrap);
	const byKey = new Map<string, typeof open>();
	for (const p of open.filter(p => !mine.includes(p))) byKey.set(convs.keyOf(p.target), [...(byKey.get(convs.keyOf(p.target)) ?? []), p]);
	for (const r of stored) if (r.conv && r.pending.length) byKey.set(r.key, [...(byKey.get(r.key) ?? []), ...r.pending]);
	for (const [key, list] of byKey) n += convs.queueOf(key).replay(list, replayWrap);
	return n;
}

// After an orchestrator restart (orchestrator.ts): the prompts still open in this process go in again, once, oldest first.
export const replayOpen = () => queue.reopen(replayWrap);

// Registrations main.ts makes at the same point of its start (kept out of import time).
// The owner's 중단: the running request is closed with what it set going (owner 2026-10-28: "취소하면 바로 취소되어야하는데 일이 그대로
// 넘어가서 진행"): the messages steered into it are not delivered again, its background workers are cancelled, and one short line
// tells the conversation (it also takes the progress line away).
export function cancelOwnerTurn(c: Conv = mainConv): string | undefined {
	const target = c.queue.cancel();
	if (!target) return undefined;
	for (const w of c.bg.list().filter(w => w.status === "running" && w.target === target))
		void c.bg.cancel(w.id).then(r => (r.ok ? log(`worker ${w.id} cancelled with its request`) : log(`worker ${w.id} not cancelled: ${r.error}`)));
	void out(target, "중단했어요.", undefined, { source: "gateway" }).catch(() => undefined);
	return target;
}

// The handlers every instance gets; main's turn header is the what-runs-now line, a conversation session's alerts name the conversation.
function wireAnswers(c: Conv): void {
	c.o.setOwnerCancel(() => cancelOwnerTurn(c));
	c.o.setWorkerHandlers(c.queue.workersSpawned, c.queue.workersDone, c.queue.workersSteered);
	// A stuck turn (hub/stuck.ts) is told in the conversation whose request it holds, never elsewhere (313ab2cf, 7b95eed4).
	c.o.setStuckHandler(minutes => {
		const target = c.queue.current()?.target ?? (c.key === MAIN ? undefined : c.primary);
		if (!target) return log(`stuck turn of ${c.key} (${minutes} min): no conversation to tell`);
		void out(target, `작업이 ${minutes}분 동안 멈춰 있어서 끊고 다시 이어가요.`, undefined, { source: "gateway" }).catch(e => log(`stuck notice to ${target} failed: ${e}`));
	});
	// An open question to the owner (a decision notice, a dotz_auth wait) is a legitimate wait, not a stall.
	c.o.setStuckGuard(() => allNotices().some(n => n.kind === "decision" && n.decision?.state === "open" && (n.decision.to === c.primary || (c.key === MAIN && (n.decision.to === "main" || n.decision.to.startsWith("auth:"))))) || pendingWaits().some(w => w.session === c.key));
	// The final answer of a turn goes to every channel that asked and did not already get a dotz_send reply.
	c.o.setAnswerHandlers(
		c.queue.onPrompt,
		answer => {
			// Read here too: an answer already sent with dotz_send drops this final text, and `[later]` must arrive bare.
			noteProjectInfo(c.queue.current()?.target ?? c.primary, answer);
			settleResolves(answer, c.key);
			const text = stripProjectInfo(answer) || stripResolves(answer);
			// The request this answer is for: only a [done] / [fail] to the same request can close an earlier question about it (notices.ts).
			orchestratorAnswered(text, c.queue.current()?.replyTo);
			c.queue.onAnswer(text);
		},
		c.queue.onText,
	);
	if (c.key === MAIN) {
		// Its next owner prompt carries what happened in the conversations main does not answer itself (hub/convdigest.ts).
		c.o.setTurnHeader(() => [turnHeader(), digest.take(MAIN)].filter(Boolean).join("\n"));
		c.o.setAlertHandler(alert);
	} else {
		// What main posted in this conversation reaches the session's next owner prompt (the header is added to owner prompts only: a handed-over prompt carries none, and its answer goes back to the sender anyway).
		c.o.setTurnHeader(() => digest.takeInto(c.key));
		c.o.setAlertHandler(text => alert(`[${c.meta.name || c.primary}] ${text}`));
	}
}

// A conversation session is wired when the registry creates it: its own queue (pending.json in its folder) and background-work view,
// the restart replay and idle hooks main.ts gives main, and its error [ask] posted into its own conversation.
// Lane reports held for a conversation session go in when it goes idle (hub/lanewire.ts installs this).
let convIdle: (key: string) => void = () => {};
export const onConvIdle = (fn: (key: string) => void): void => void (convIdle = fn);

setWiring(c => {
	let bg: ReturnType<typeof createBgWork> | undefined;
	const q = makeQueue(c.key, c.o, join(c.dir!, "pending.json"), () => bg);
	bg = sessionBg(c.o, q);
	Object.assign(c, { queue: q, bg });
	wireAnswers(c);
	c.o.setRestartedHandler(lead => q.reopen(leadWith(replayWrap, lead)));
	c.o.setIdleHandler(() => {
		q.settleTurn(c.o.turnFailed());
		q.redeliverSteered();
		convIdle(c.key);
	});
	c.o.setErrorHandler(e => void out(c.primary, errorAsk(NAME, e), undefined, { source: "gateway" }).catch(err => log(`error ask to ${c.primary} failed: ${err}`)));
	return { queue: q, bg };
});

export function installDelivery(): void {
	livestatus.setWebProgress((target, text) => webNote(target, text, !!text));
	wireAnswers(mainConv);
}
