import { eventTarget, onEmit, tailEvents, type HubEvent } from "./events.ts";
import { paths } from "./config.ts";
import { briefMail, mailByKey } from "./mail.ts";
import { laneLive, lanes } from "./lanestate.ts";
import { readOf, unreadFrom } from "./reads.ts";
import { dropIdNote, noticeKo, plainTable } from "./notice-ko.ts";
import { dropClaim, parseTone, previewSource } from "./tone.ts";

// The messenger overview: one row per conversation (the main chat, each project channel, each session) with its newest real
// message. Built once from the inbox/outbox tail, then kept current by onEmit; a request never rescans the files.
// The web mirrors the "real message" rule (web/js/31-conversations.js), so keep the two in step.
type ConversationLast = { ts: string; text: string; from: "owner" | "bot" | "session" };
// `read`: where the owner has read up to (hub/reads.ts), `unread`: real messages after it that are not the owner's own.
export type Conversation = { target: string; last: ConversationLast | null; read: string | null; unread: number };

const PREVIEW_MAX = 120;
// Kinds that show as a message in a conversation. Not here: delivery states, activity, progress notes (`out` with an
// update_key), lane_start, and the bell's notice / notice_read.
const OWNER_KINDS = new Set(["message", "lane_message"]);
const MESSAGE_KINDS = new Set([...OWNER_KINDS, "out", "lane_report", "result", "mail", "schedule", "watch"]);

export function isRealMessage(e: HubEvent): boolean {
	if (!MESSAGE_KINDS.has(e.kind)) return false;
	if (e.kind !== "out" || !e.update_key) return true;
	// A post edited in place is a message only in the two fixed conversations (a lane's worklog line, an alert's update_key); in the
	// main chat, a project or a session it is a progress note.
	const t = eventTarget(e);
	return e.update_key !== "progress" && (t === "alert" || t === "worklog");
}

// First meaningful line of a message as plain text: the handoff block, the [done]-style marker, code fences and markdown
// decoration are dropped.
export function previewOf(raw: string): string {
	const text = plainTable(noticeKo(dropClaim(parseTone(previewSource(raw)).text)));
	let fence = false;
	for (const line of text.split("\n")) {
		if (/^\s*```/.test(line)) {
			fence = !fence;
			continue;
		}
		if (fence) continue;
		const plain = dropIdNote(line
			.replace(/^\s*-#\s+/, "")
			.replace(/^\s*(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/, "")
			.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
			.replace(/[*~`]+|(?<![A-Za-z0-9])_+|_+(?![A-Za-z0-9])/g, ""))
			.replace(/\s+/g, " ")
			.trim();
		if (!plain) continue;
		return plain.length > PREVIEW_MAX ? `${plain.slice(0, PREVIEW_MAX - 1)}…` : plain;
	}
	return "";
}

function lastOf(e: HubEvent): ConversationLast | undefined {
	if (!isRealMessage(e)) return undefined;
	const card = e.card && typeof e.card === "object" ? (e.card as { title?: unknown }).title : undefined;
	const hasFiles = Array.isArray(e.files) && e.files.length > 0;
	const text = previewOf(String(e.text ?? "")) || previewOf(typeof card === "string" ? card : "") || (hasFiles ? "파일" : "");
	if (!text) return undefined;
	const from = OWNER_KINDS.has(e.kind) ? "owner" : e.kind === "lane_report" || (typeof e.source === "string" && e.source.startsWith("lane:")) ? "session" : "bot";
	return { ts: e.ts, text, from };
}

const known = new Map<string, ConversationLast | null>([["main", null], ["alert", null], ["worklog", null]]);
let loaded = false;
let sorted: { target: string; last: ConversationLast | null }[] | undefined;

// The newest messages that can be unread, per target: event key -> ts. The load from the log tail and the live event of the
// same message meet here, so the key keeps it counted once.
const UNREAD_KEEP = 500;
const incoming = new Map<string, Map<string, string>>();
const cleanRestart = (e: HubEvent) => e.kind === "out" && e.source === "gateway" && /^게이트웨이(?: 재시작했어요|를 다시 시작했어요)/.test(String(e.text ?? "")) && /끊긴 작업은 없어요/.test(String(e.text ?? ""));

function countIncoming(target: string, e: HubEvent, last: ConversationLast): void {
	// A gateway system line (`system`, e.g. a deferral receipt) is a status, not a message to read.
	if (last.from === "owner" || cleanRestart(e) || e.system) return;
	let bucket = incoming.get(target);
	if (!bucket) incoming.set(target, (bucket = new Map()));
	// An edited post counts once, at its newest version.
	const key = e.kind === "out" && typeof e.update_key === "string" && e.update_key ? `key|${e.update_key}` : `${e.ts}|${e.kind}|${String(e.text ?? "").slice(0, 60)}`;
	bucket.set(key, e.ts);
	if (bucket.size > UNREAD_KEEP) bucket.delete(bucket.keys().next().value as string);
}

export function unreadOf(target: string): number {
	if (target.startsWith("mail:") && mailByKey(target.slice(5))?.dir === "out") return 0;
	// An ended session has nothing unread (owner 2026-11-03: "끝난 세션에 있는 안읽음 표시는 무시"), and once it runs again only what came
	// after its end counts. Every surface (session rows, sidebar counts, the other computer's snapshot) reads this count.
	const lane = target.startsWith("lane:") ? lanes.get(target.slice(5)) : undefined;
	if (lane && !laneLive(lane)) return 0;
	const read = [unreadFrom(target), lane?.endedAt].reduce<string | null>((a, b) => (b && (!a || b > a) ? b : a), null);
	let n = 0;
	for (const ts of incoming.get(target)?.values() ?? []) if (!read || ts > read) n++;
	// An old mail whose message is no longer in the log tail has nothing to count; 안 읽음 on it (hub/reads.ts markUnread) put the owner's own position before it, and that counts it once.
	if (!n && target.startsWith("mail:") && !incoming.get(target)?.size) {
		const own = readOf(target), m = mailByKey(target.slice(5));
		if (own && m && m.dir !== "out" && m.at > own) n = 1;
	}
	return n;
}

function note(e: HubEvent): void {
	if (typeof e.ts !== "string") return;
	const target = eventTarget(e);
	const last = target ? lastOf(e) : undefined;
	if (!target || !last) return;
	// A mail posted without a summary gets the one its conversation says (once; the list then needs no conversation).
	if (target.startsWith("mail:") && !OWNER_KINDS.has(e.kind)) briefMail(target.slice(5), String(e.text ?? ""));
	countIncoming(target, e, last);
	const prev = known.get(target);
	if (prev && prev.ts > last.ts) return;
	known.set(target, last);
	sorted = undefined;
}

onEmit(note);

function load(): void {
	if (loaded) return;
	loaded = true;
	// Oldest first, so the tail never overwrites a newer live event already noted.
	for (const e of [...tailEvents(paths.inbox), ...tailEvents(paths.outbox)].sort((a, b) => String(a.ts).localeCompare(String(b.ts)))) note(e);
}

// Events moved between conversations (hub/task-conversation.ts): previews, order and unread are counted again from the log.
export function resetConversationIndex(): void {
	for (const t of known.keys()) known.set(t, null);
	for (const t of [...known.keys()]) if (t !== "main" && t !== "alert" && t !== "worklog") known.delete(t);
	incoming.clear();
	sorted = undefined;
	loaded = false;
}

// `live`: the targets that exist right now (live sessions, project channels); they are listed even before their first message.
export function conversationList(live: readonly string[] = []): Conversation[] {
	load();
	for (const t of live) if (!known.has(t)) known.set(t, null);
	if (!sorted || sorted.length !== known.size) {
		sorted = [...known].map(([target, last]) => ({ target, last })).sort((a, b) => (b.last?.ts ?? "").localeCompare(a.last?.ts ?? ""));
	}
	return sorted.map(c => ({ ...c, read: readOf(c.target), unread: unreadOf(c.target) }));
}
