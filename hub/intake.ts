// Inbound path of the hub: inbox text, burst coalescing (intake/flush), web sends and the queued-message sweep. Split out of main.ts.
import { BURST_GAP_MS, BURST_WAIT_MS, cfg, COALESCE_MAX_MS, DATA_DIR, DEFAULTS, log, now } from "./config.ts";
import { limitsCard, parseCommand, runCommand } from "./control.ts";
import * as discord from "./discord.ts";
import * as livestatus from "./livestatus.ts";
import { msg } from "./i18n.ts";
import { recordCorrection } from "./corrections.ts";
import { recipeAnswer } from "./recipes.ts";
import { askedText, emit, emitDelivery, eventTarget, isPeerMessage, onEmit, type HubEvent } from "./events.ts";
import { openChoiceTitles } from "./notices.ts";
import { attachmentLine, attachmentLines, type Upload } from "./files.ts";
import { pickedLines, type Picked } from "./picked.ts";
import { abortLane, approvesBudget, lanes, ownerNotes, sendToLane } from "./lanes.ts";
import { accountView, readPool } from "./account-sticky.ts";
import { readAliases } from "./account-alias.ts";
import { accountAnswer, accountAsk } from "./accounts-api.ts";
import { orch, type Orchestrator } from "./orchestrator.ts";
import { convs } from "./convsessions.ts";
import { digest } from "./convdigest.ts";
import { legacyAnswer } from "./migrations.ts";
import { errorAnswer } from "./orch-error.ts";
import { drain, restore } from "./queue.ts";
import { anthropicUsage } from "./providers.ts";
import { withTurnLanguage } from "./outlang.ts";
import { MAIL_TURN_MARK } from "./systemdeny.ts";
import { channelContext, listSetups } from "./workchannels.ts";
import { updateNow } from "./update-now.ts";
import { deliver, awaiting, lastOwner, refOf, newMid, laneFailed, out, expectReply, rateLimitNotice, turnSource } from "./outbound.ts";
import { mailTarget, type MailRecord } from "./mail.ts";
import { memoryNote, settingsTarget } from "./app-settings.ts";
import { appEntries } from "./integrations.ts";
import { instanceOf } from "./reply-model.ts";
import { settingsNote } from "./settings-turn.ts";
import { watchAsked } from "./watch-recheck.ts";
import { pluginThread } from "./plugins.ts";
import { cancelAuth, pendingWaits } from "./auth.ts";
import { authHolds, bareText, cancelReply, waitNotice, type WaitDeps } from "./auth-wait.ts";

// Chat is the hub over every work channel: each chat turn carries a short directory so the orchestrator can route the
// work into the channel it belongs to (or split a growing thread of work into a new one).
function workDirectory(): string {
	const setups = new Map(listSetups().map(s => [s.channel, s.purpose]));
	const list = Object.entries(discord.channels.work).slice(0, 20).map(([id, name]) => `#${name} ch:${id}${setups.has(id) ? ` (${setups.get(id)!.slice(0, 60)})` : ""}`);
	return msg().workChannels(list);
}

export function inboxText(e: Record<string, any>): string {
	return withTurnLanguage(inboxBody(e));
}

// A decision answer says which question it answers: the chosen option per block and the start of the asking message (its
// `reply_to` is that message's ts), so the answer holds up when it is sent from another conversation than the one that asked.
export type Pick = { q: string; n: number; label: string; note?: string };
const QUOTE_MAX = 200;

// A web message sent as a reply (swipe or the reply button on a message): `id` is the quoted message's stable id (an owner message's
// mid, or an assistant message's ts), `author` and `content` have the shape of a Discord reply (event.reply), so inboxBody prints
// the same replyingTo line and the model reads the quoted message as the context of the new one. An empty author is the owner.
export type Reply = { id: string; author: string; content: string };
const REPLY_MAX = 300; // same cut as a Discord reply (discord.ts referenced_message)
export function parseReply(raw: unknown, login: string): Reply | undefined {
	const r = raw as Record<string, unknown> | null;
	const content = typeof r?.content === "string" ? r.content.trim().slice(0, REPLY_MAX) : "";
	if (!content) return undefined;
	const author = typeof r?.author === "string" ? r.author.trim().slice(0, 60) : "";
	return { id: typeof r?.id === "string" ? r.id.slice(0, 40) : "", author: author || login, content };
}
export const replyLine = (r: Reply): string => msg().replyingTo(r.author, r.content);
function decisionLines(p: Record<string, any>): string[] {
	const m = msg();
	const out: string[] = [];
	if (Array.isArray(p.picks) && p.picks.length) out.push(m.decisionAnswer(p.picks));
	const asked = typeof p.reply_to === "string" && (p.picks?.length || p.decision) ? askedText(p.reply_to) : undefined;
	if (asked) {
		const flat = asked.replace(/^\s*\[[^\]\n]{1,10}\][ \t]*/, "").replace(/\s+/g, " ").trim();
		out.push(m.decisionAsked(flat.length > QUOTE_MAX ? `${flat.slice(0, QUOTE_MAX - 1)}…` : flat));
	}
	return out;
}

// The owner's message holds no answer by itself when it lands in a conversation with open choice questions: the bot is told which, judges whether the message answers one, and closes it at once with `resolves` or a closing `<resolves>` line.
const TITLE_MAX = 60;
const openQuestionLines = (target: string): string[] => {
	const titles = openChoiceTitles(target).map(t => t.slice(0, TITLE_MAX));
	return titles.length ? [msg().openQuestions(titles)] : [];
};

function inboxBody(e: Record<string, any>): string {
	const m = msg();
	if (e.kind === "lane_report") return `${m.inboxLaneReport(e.lane)}\n${e.text}`;
	if (e.kind === "watch") {
		const ch = e.channels?.[0];
		if (e.wakeOnly) return [m.inboxWatchOnce(e.watch, e.reason, ch), e.text, ch ? channelContext(ch) : ""].filter(Boolean).join("\n");
		if (!ch) return `${m.inboxWatchNoChannel(e.watch, e.reason)}\n${e.text}`;
		return `${m.inboxWatch(e.watch, e.reason, ch)}\n${e.text}\n${channelContext(ch)}`;
	}
	if (e.kind === "mail") {
		const home = typeof e.parent === "string" && e.parent.startsWith("ch:") ? channelContext(e.parent.slice(3)) : "";
		return [MAIL_TURN_MARK, m.inboxMail(e.thread ? `th:${e.thread}` : e.channel), e.text, home].filter(Boolean).join("\n");
	}
	if (e.kind === "schedule" && e.quiet) return `${m.inboxCheck(e.ids, e.channel)}\n${e.text}`;
	if (e.kind === "schedule") return `${m.inboxSchedule(e.id, e.every, e.channel)}\n${e.text}`;
	const where = e.thread_name ? m.inboxThread(e.thread_name, e.parent_name) : e.channel_name ? ` #${e.channel_name}` : "";
	const lines = [`[dotz inbox] ${e.channel}${where}${e.message_id ?? e.mid ? ` msg=${e.message_id ?? e.mid}` : ""} from ${e.author ?? "owner"}`];
	if (e.first) lines.push(m.inboxFirst(e.channel_name));
	const parts: Record<string, any>[] = e.parts ?? [e];
	if (parts.length > 1) lines.push(m.inboxBurst(parts.length));
	for (const p of parts) {
		if (p.reply) lines.push(m.replyingTo(p.reply.author, p.reply.content));
		for (const a of p.attachments ?? []) lines.push(attachmentLine(a, a.url));
		lines.push(p.text);
		if (p.elements?.length) lines.push(pickedLines(p.elements));
		if (p.refs?.length) lines.push(...p.refs);
		lines.push(...decisionLines(p));
	}
	if (e.kind === "message" && !isPeerMessage(e as HubEvent)) lines.push(...openQuestionLines(eventTarget(e as HubEvent) ?? "main"));
	if (e.plugin_note) lines.push(e.plugin_note);
	const home = e.parent?.startsWith("ch:") ? e.parent : e.channel;
	const ctx = home?.startsWith("ch:") ? channelContext(home.slice(3)) : "";
	if (ctx) lines.push(ctx);
	if (["chat", "dm", "web", "web:alert", "web:worklog", "worklog", "alert", "brief"].includes(e.channel)) lines.push(workDirectory());
	return lines.join("\n");
}

// Owners often send one thought as several short messages. Messages from the same channel that arrive within
// COALESCE_MS of each other (at most COALESCE_MAX_MS after the first) become one turn, the way the earlier secretary's inbox monitor
// batched lines that arrived together. Mid-burst the wait is BURST_WAIT_MS (config.ts): a lone message keeps the short one.
const COALESCE_MS = Number((cfg as any).gateway?.coalesce_ms ?? DEFAULTS.coalesce_ms);
// Every owner message of every surface is emitted to the inbox first, so the ledger sees them all, lanes and commands included.
onEmit(e => recordCorrection(e));
export const bursts = new Map<string, { events: Record<string, any>[]; replyTo?: string; first: number; timer?: ReturnType<typeof setTimeout> }>();

const lastAsked = new Map<string, number>();
const quietMs = (target: string, gathering: number, last: number | undefined): number =>
	COALESCE_MS && (gathering > 1 || (last !== undefined && Date.now() - last <= BURST_GAP_MS && Boolean(awaiting.get(target)?.length))) ? Math.max(COALESCE_MS, BURST_WAIT_MS) : COALESCE_MS;

export function intake(event: Record<string, any>, target: string, replyTo?: string): void {
	let b = bursts.get(target);
	if (!b) {
		discord.typing(target);
		b = { events: [], first: Date.now() };
		bursts.set(target, b);
	}
	clearTimeout(b.timer);
	b.events.push(event);
	b.replyTo = replyTo ?? b.replyTo;
	if (replyTo) lastOwner.set(target, replyTo);
	const quiet = quietMs(target, b.events.length, lastAsked.get(target));
	lastAsked.set(target, Date.now());
	b.timer = setTimeout(() => flush(target), Math.max(0, Math.min(quiet, b.first + COALESCE_MAX_MS - Date.now())));
}

export const UPDATE_RECEIPT = "📨 받았어요. 업데이트를 적용하고 다시 켜지면 바로 전달할게요.";
function heldForUpdate(target: string, refs: string[], replyTo?: string): void {
	for (const ref of refs) emitDelivery(target, ref, "update");
	const local = /^(web|terminal|mail:|settings:)/.test(target);
	if (!local && discord.status.enabled) void discord.progress(target, "progress", UPDATE_RECEIPT, replyTo).catch(e => log(`update hold receipt failed: ${e}`));
}

/** The owner's 중단 of `target`: what was sent there and not yet delivered (a burst still gathering, the web queue) is dropped. */
export function dropPending(target: string): number {
	const b = bursts.get(target);
	if (b) {
		clearTimeout(b.timer);
		bursts.delete(target);
	}
	const n = (b?.events.length ?? 0) + drain(target).length;
	if (n) log(`${n} message(s) for ${target} not delivered: the owner cancelled`);
	return n;
}
convs.everyInstance(c => c.o.onOwnerCancel(target => void dropPending(target)));

// A session waiting on dotz_auth gets owner messages only after the wait: the gateway answers them meanwhile (hub/auth-wait.ts).
const authWait: WaitDeps = {
	pending: pendingWaits,
	sessionOf: target => convs.keyOf(target),
	busy: target => convs.forTarget(target)?.o.orch.status === "working",
	cancel: cancelAuth,
	post: (to, text, replyTo) => void out(to, text, replyTo, { source: "gateway" }).catch(e => log(`auth wait reply to ${to} failed: ${e}`)),
};
// Every surface hands intake the owner's messages only (discord.ts OWNER, each messenger's allow list), as deliver's owner: true below says.
const inboundOf = (target: string, events: Record<string, any>[], replyTo?: string) => ({ target, text: bareText(events), owner: true, replyTo });
/** The web's queue keeps a message from intake until the turn ends, which this wait holds off: it goes through intake instead. */
export const authHeld = (target: string): boolean => authHolds(target, authWait);

export function flush(target: string): void {
	const b = bursts.get(target);
	if (!b) return;
	bursts.delete(target);
	const head = b.events[0];
	const inbound = inboundOf(target, b.events, b.replyTo);
	if (cancelReply(inbound, authWait)) return;
	// The session that answers this conversation (main with conversation sessions off); one not started yet has no error.
	const session = convs.forTarget(target)?.o;
	const errAnswer = session?.orch.error && b.events.length === 1 ? errorAnswer(String(head.text ?? "")) : undefined;
	if (errAnswer) return void answerOrchError(target, errAnswer, session!, b.replyTo);
	const legacy = b.events.length === 1 ? legacyAnswer(DATA_DIR, String(head.text ?? "")) : undefined;
	if (legacy) return void out(target, legacy, b.replyTo, { source: "gateway" }).catch(e => log(`legacy import reply failed: ${e}`));
	if (b.events.length === 1 && LIMITS_ASK.test(String(head.text)) && !head.attachments?.length) return void limitsAnswer(target, b.replyTo);
	const ask = b.events.length === 1 && !head.attachments?.length ? accountAsk(String(head.text ?? ""), readPool()?.names ?? [], readAliases()) : undefined;
	if (ask) return void accountChatAnswer(target, ask, b.replyTo);
	const recipe = b.events.length === 1 && !head.attachments?.length ? recipeAnswer(String(head.text ?? "")) : undefined;
	if (recipe) return void out(target, recipe, b.replyTo, { source: "gateway" }).catch(e => log(`recipe reply failed: ${e}`));
	rateLimitNotice(target, b.replyTo);
	const merged = b.events.length > 1 ? { ...head, message_id: refOf(b.events.at(-1)!), parts: b.events } : head;
	const was = convs.stateOf(target);
	digest.note(convs.keyOf(target), "owner", String(merged.text ?? ""));
	// After a tap on the update bar: kept for the restart, acknowledged on the message (and in a Discord channel's progress line).
	const heldRefs = b.events.flatMap(e => refOf(e) ?? []);
	if (updateNow()?.hold(inboxText(merged), { target, replyTo: b.replyTo, owner: true }, heldRefs)) return heldForUpdate(target, heldRefs, b.replyTo);
	waitNotice(inbound, authWait);
	const steered = deliver(inboxText(merged), { target, replyTo: b.replyTo, refs: heldRefs, owner: true });
	// Another conversation's message waits for the running turn to end and goes in as its own turn (prompts.ts deliver); a parked
	// conversation session was started again for it.
	const status = convs.forTarget(target)?.o.orch.status;
	const how = steered ? "steered" : status === "rate-limited" ? "held" : status === "working" ? "queued" : was === "parked" ? "resumed" : "received";
	expectReply(target);
	const refs = b.events.flatMap(e => refOf(e) ?? []);
	for (const ref of refs) emitDelivery(target, ref, how);
	if (refs.length) awaiting.set(target, [...(awaiting.get(target) ?? []), ...refs.map(ref => ({ ref, by: b.replyTo }))]);
	// A project's web chat gets the same receipt and progress line as its Discord channel.
	if (b.events.some(e => e.source === "web") && target.startsWith("ch:")) {
		livestatus.begin(target, turnSource(target), true);
	}
}

// Slash/bang commands (/model, /restart, ...) are answered by the gateway itself, never by the orchestrator.
export async function answerCommand(target: string, text: string, replyTo?: string): Promise<void> {
	const card = await runCommand(text, target);
	await out(target, card.text, replyTo, { source: "gateway", card }).catch(e => log(`command reply to ${target} failed: ${e}`));
}

// The owner's answer to the orchestrator-error ask (orch-error.ts): handled here because the orchestrator cannot read it.
// Restart is the same call as `/restart orchestrator`; waiting leaves the one automatic resume to the health probe.
async function answerOrchError(target: string, answer: "restart" | "wait", session: Orchestrator, replyTo?: string): Promise<void> {
	if (answer === "restart") session.resumeNow("owner's 다시 시작 on the error card");
	else if (session.orch.error) session.orch.error.waiting = true;
	const text = answer === "restart" ? "오케스트레이터만 다시 시작하고 답하지 못한 요청을 다시 처리해요." : "연결이 돌아오면 한 번 자동으로 다시 시도해요.";
	await out(target, text, replyTo, { source: "gateway" }).catch(e => log(`orchestrator error reply failed: ${e}`));
}

// "한도" is answered by the gateway without waking the orchestrator, from the account the orchestrator really runs on
// (hub/usage-account.ts: OmO's pinned/pool account under OmO, omp's login otherwise), named in the answer.
const LIMITS_ASK = /^\s*(한도|사용량|limits?)\s*[?？]?\s*$/i;
async function limitsAnswer(target: string, replyTo?: string): Promise<void> {
	const r = await anthropicUsage("orchestrator").catch(() => undefined);
	const last = accountView(1).switches[0];
	const card = limitsCard(r, last);
	await out(target, card.text, replyTo, { source: "gateway", card }).catch(e => log(`limits reply failed: ${e}`));
}

// "계정 바꿔줘", "회사 계정으로", "지금 무슨 계정이야?": answered here too (hub/accounts-api.ts accountAsk), never by the orchestrator.
async function accountChatAnswer(target: string, ask: Parameters<typeof accountAnswer>[0], replyTo?: string): Promise<void> {
	const text = await accountAnswer(ask).catch(e => (e as Error).message);
	await out(target, text, replyTo, { source: "gateway" }).catch(e => log(`account reply failed: ${e}`));
}

// Sends one web message the way the composer's modes mean it. "default" (no mode): the main assistant takes it as the next
// message, a working lane gets it steered in; "steer": into the running turn, gathered with what follows it, or at once with
// `sendNow` (the queue's 지금 보내기); "interrupt": abort, then new prompt.
// `files` are uploads (files.ts): the chat shows them as chips, the agent gets one [attachment] line per file with its path.
// `project` (projectchat.ts) sends to a project's orchestrator: the message arrives as one in that work channel would.
// `mail` (hub/mail.ts): the message reaches the orchestrator as one in that mail's Discord thread does (main.ts onOwner), plugin
// thread hook included; a mail with no thread the hub knows answers in its web conversation `mail:<key>`.
type WebSend = { source?: string; settings?: string; lane?: string; project?: { target: string; name: string }; mail?: MailRecord; channel: "web" | "terminal"; conv?: "alert" | "worklog"; text: string; mode: "default" | "steer" | "interrupt"; sendNow?: boolean; login: string; files?: Upload[]; replyTo?: string; reply?: Reply; quoted?: boolean; decision?: string; picks?: Pick[]; elements?: Picked[]; refs?: string[]; via?: string };
export async function sendWeb(s: WebSend): Promise<void> {
	const mid = newMid();
	// replyTo: the asking message of a decision answer; decision: its notice, which that answer settles alone (notices.ts ownerReplied).
	const extra = { mid, ...(s.via ? { via: s.via } : {}), ...(s.mode === "default" ? {} : { mode: s.mode }), ...(s.files?.length ? { files: s.files } : {}), ...(s.replyTo ? { reply_to: s.replyTo } : {}), ...(s.reply ? { reply: s.reply } : {}), ...(s.quoted ? { quoted: true } : {}), ...(s.decision ? { decision: s.decision } : {}), ...(s.picks?.length ? { picks: s.picks } : {}), ...(s.elements?.length ? { elements: s.elements } : {}), ...(s.refs?.length ? { refs: s.refs } : {}) };
	if (s.lane) {
		const name = s.lane;
		const channel = `lane:${name}`;
		emit("inbox", { ts: now(), kind: "lane_message", source: s.source ?? "web", author: s.login, lane: name, text: s.text, ...extra });
		if (s.mode === "interrupt" && lanes.get(name)?.status === "working") {
			abortLane(name);
			// Let the aborted turn end first, or the message would be steered into it.
			for (let i = 0; i < 50 && lanes.get(name)?.status === "working"; i++) await Bun.sleep(200);
		}
		// The state of this message shows in its meta line at once (hub/events.ts emitDelivery); a refusal comes back as a
		// gateway message in the session's chat, not only as the request's error.
		try {
			if (approvesBudget(name, s.text)) sendToLane(name, "/budget-ok");
			const how = sendToLane(name, [`[owner via web] ${s.text}`, ...(s.picks?.length ? decisionLines({ picks: s.picks, reply_to: s.replyTo, decision: s.decision }) : []), ...openQuestionLines(channel), s.reply ? replyLine(s.reply) : "", s.files?.length ? attachmentLines(s.files) : "", s.elements?.length ? pickedLines(s.elements) : "", ...(s.refs ?? [])].filter(Boolean).join("\n"), mid);
			emitDelivery(channel, mid, how);
			// The web shows the receipt as the message's delivery state only (no canned receipt message, owner 2026-10-17).
			livestatus.begin(channel, channel, true);
		} catch (error) {
			laneFailed(channel, name, mid, error);
			throw error;
		}
		return;
	}
	// conv: asked in the web's 알림 / 작업 기록 conversation; the answer comes back as target "web:<conv>" into the same one.
	const thread = s.mail?.thread && (discord.channels.threads[s.mail.thread] || discord.status.enabled) ? s.mail.thread : undefined;
	const to = s.settings ? settingsTarget(s.settings) : s.mail ? (thread ? `th:${thread}` : mailTarget(s.mail.key)) : (s.project?.target ?? (s.conv ? `web:${s.conv}` : s.channel));
	const hook = thread ? pluginThread({ thread, text: s.text }) : undefined;
	const info = thread ? discord.threadInfo(thread) : undefined;
	// A web-only mail has no thread: its turn names the conversation (the mail note carries the subject), not a thread.
	const where = s.mail ? { conv: mailTarget(s.mail.key), ...(thread ? { thread_name: s.mail.subject, ...(info ? { parent: info.parentTarget } : {}), parent_name: hook?.parentName ?? info?.parentName ?? msg().channelNames.mail } : {}) } : s.project ? { channel_name: s.project.name } : {};
	const event = { ts: now(), kind: "message", source: s.source ?? s.channel, channel: to, ...where, author: s.login, text: s.text, ...extra, ...(s.files?.length ? { attachments: s.files.map(f => ({ name: f.name, type: f.type, url: f.path, ...(f.label ? { label: f.label } : {}) })) } : {}) };
	emit("inbox", event);
	if (s.settings) watchAsked(to, s.settings);
	const mem = s.mail && !hook?.note ? memoryNote(DATA_DIR, instanceOf(appEntries(DATA_DIR), "mail", `mail:${s.mail.key}`)) : "";
	const note = s.settings ? settingsNote(s.settings, to) : s.mail ? (hook?.note ?? `${msg().mailNote(s.mail.source, s.mail.id, s.mail.subject)}${mem ? `\n${mem}` : ""}`) : undefined;
	const turn = note ? { ...event, plugin_note: note } : event;
	// The session that answers `to` (main with conversation sessions off): steer and interrupt act on its turn only.
	const session = convs.forTarget(to)?.o;
	if (parseCommand(event.text)) void answerCommand(to, event.text);
	else if (s.mode === "steer" && s.sendNow && session?.orch.status === "working" && !updateNow()?.holding()) {
		// Through the prompt queue, which steers it in as a note now: raw inbox text admitted mid-turn read as a new prompt
		// and unpaired the running turn, so its answer went nowhere (2026-10-20 19:43 KST, the 19:36 and 19:38 web messages).
		// The dotz_auth wait is met here as well as in flush.
		const inbound = inboundOf(to, [turn], mid);
		if (cancelReply(inbound, authWait)) return;
		waitNotice(inbound, authWait);
		const steered = deliver(inboxText(turn), { target: to, replyTo: mid, owner: true });
		expectReply(to);
		emitDelivery(to, mid, steered ? "steered" : "queued");
		awaiting.set(to, [...(awaiting.get(to) ?? []), { ref: mid, by: mid }]);
		lastOwner.set(to, mid);
	} else {
		if (s.mode === "interrupt" && session?.orch.status === "working") session.abort();
		intake(turn, to, mid);
	}
}

// Web messages queued while their target works (see queue.ts) go out when that target is idle again: oldest first, as
// one message through the normal path (main: intake, which merges messages of one burst into one turn; lane: one prompt).
export const QUEUE_SWEEP_MS = 5000;
const queueFailed = new Set<string>();
export function flushQueue(target: string): void {
	const lane = target.startsWith("lane:") ? target.slice(5) : undefined;
	const status = lane ? lanes.get(lane)?.status : orch.status;
	if (lane && !lanes.has(lane)) {
		const gone = drain(target);
		void out("web", `세션 ${lane}이(가) 없어서 대기 중이던 메시지 ${gone.length}개를 전달하지 못했어요:\n${gone.map(i => i.text).join("\n---\n")}`, undefined, { source: "gateway" }).catch(() => undefined);
		return;
	}
	if (status !== "idle") return;
	const items = drain(target);
	if (!items.length) return;
	try {
		if (lane) {
			for (const i of items) if (approvesBudget(lane, i.text)) sendToLane(lane, "/budget-ok");
			const how = sendToLane(lane, `[owner via web] ${items.map(i => i.text).join("\n\n")}`, items[0].id);
			for (const i of items.slice(1)) ownerNotes.asked(lane, i.id);
			queueFailed.delete(target);
			// The messages waited for the session's turn to end and went in as one: "queued" unless the stopped session had to be resumed.
			for (const i of items) {
				emit("inbox", { ts: now(), kind: "lane_message", source: "web", author: i.author ?? "local", lane, text: i.text, mid: i.id });
				emitDelivery(target, i.id, how === "received" ? "queued" : how);
			}
			livestatus.begin(target, target, true);
		} else {
			for (const i of items) {
				const event = { ts: now(), kind: "message", source: "web", channel: "web", author: i.author ?? "local", text: i.text, mid: i.id };
				emit("inbox", event);
				intake(event, "web", i.id);
			}
		}
	} catch (error) {
		log(`queued web messages for ${target} not sent: ${(error as Error).message}`);
		// Said once in the session's chat; the messages stay queued and are tried again.
		if (lane && !queueFailed.has(target)) {
			queueFailed.add(target);
			laneFailed(target, lane, undefined, error);
		}
		restore(items);
	}
}
