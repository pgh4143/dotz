// Where an answer and a lane go on Discord, as pure decisions (tested in threads.test.ts). The rule table in MODE.md
// ("Threads") describes the same behaviour for the model; the gateway applies it here so it holds whatever the model writes.
//
//   owner writes ...                         -> the answer / the work goes ...
//   top-level in chat, dm or a work channel  -> a reply to that message in the same channel
//   inside a thread or a lane channel        -> the same thread or channel, no reply reference (unless newer messages came in between)
//   a Discord reply to a thread's starter    -> into that thread
//   long work (a lane) from a work channel   -> a thread on the owner's own message in that channel
//   long work (a lane) from a thread         -> that thread becomes the lane's thread
//   long work (a lane) from chat             -> a new work channel (chat gets one pointer line)
//   long work (a lane) from the web/terminal -> no Discord place: it lives in the web (discord-post.json web_lanes turns this off)

import { splitTone } from "./tone.ts";

type LanePlace = { kind: "web" } | { kind: "channel" } | { kind: "thread"; parent: string; fromMessage?: string } | { kind: "adopt"; thread: string; parent: string };

/**
 * Where a new lane works. `home` is the orchestrator's explicit ch:<id>; `asking` / `askingMessage` are the channel and
 * message of the owner request the launching turn answers; `threadParent` maps a known sub-topic thread to its parent.
 * A request that did not come from Discord (the web, the terminal, no asking turn, or a web message in a work channel's
 * web view) gets no Discord place unless `discordForWeb` (the owner's switch) or an explicit home says so.
 */
export function lanePlace(a: { home?: string; asking?: string; askingMessage?: string; isWork: (id: string) => boolean; threadParent: (id: string) => string | undefined; discordForWeb?: boolean }): LanePlace {
	const fromDiscord = Boolean(a.asking && !LOCAL.test(a.asking) && (!a.askingMessage || isSnowflake(a.askingMessage)));
	if (!a.home && !fromDiscord && !a.discordForWeb) return { kind: "web" };
	// A thread hangs only from a Discord message: a web message id is not one (2026-11-05: the 400 lost the lane its thread and its project).
	const from = a.askingMessage && isSnowflake(a.askingMessage) ? { fromMessage: a.askingMessage } : {};
	if (a.home?.startsWith("ch:")) {
		const parent = a.home.slice(3);
		return { kind: "thread", parent, ...(a.asking === a.home ? from : {}) };
	}
	if (a.asking?.startsWith("ch:") && a.isWork(a.asking.slice(3))) return { kind: "thread", parent: a.asking.slice(3), ...from };
	if (a.asking?.startsWith("th:")) {
		const thread = a.asking.slice(3);
		const parent = a.threadParent(thread);
		if (parent) return { kind: "adopt", thread, parent };
	}
	return { kind: "channel" };
}

/**
 * The project channel a new lane was started in: the explicit home, else the work channel or thread the request came from,
 * wherever it was typed (Discord or the channel's web view) and whether or not Discord then makes it a thread.
 */
export function startedIn(a: { home?: string; asking?: string; isWork: (id: string) => boolean; threadParent: (id: string) => string | undefined }): string | undefined {
	if (a.home?.startsWith("ch:")) return a.home.slice(3);
	if (a.asking?.startsWith("ch:") && a.isWork(a.asking.slice(3))) return a.asking.slice(3);
	return a.asking?.startsWith("th:") ? a.threadParent(a.asking.slice(3)) : undefined;
}

/**
 * Whether the launching turn's answer moves into the new lane's thread: only when the owner asked in that Discord work
 * channel or thread. An ask from chat, dm, the web or the terminal is answered where it was asked; with a `home` channel
 * the lane still gets its thread, but the answer stays (2026-10-21: two web answers went only to Discord lane threads).
 */
export function answerMovesToLane(place: LanePlace, asking: string | undefined): boolean {
	return place.kind !== "channel" && place.kind !== "web" && Boolean(asking && (asking.startsWith("ch:") || asking.startsWith("th:")));
}

// Conversations that exist only in the web app (outbound.ts isLocal).
const LOCAL = /^(web|terminal|web:.*|mail:.*|settings:.*|task:.*)$/;

/** A Discord message id. A web message id (8 hex chars) is not one: Discord rejects it as a message_reference. */
export const isSnowflake = (id: string): boolean => /^\d{15,22}$/.test(id);

const TOP_LEVEL = new Set(["chat", "dm", "worklog", "alert"]);
/**
 * The Discord reply reference for an answer to owner message `replyTo` in `target`. A top-level channel always gets it (the
 * answer shows under the question). In a thread or lane channel the conversation is already one topic, so the reference is
 * noise on a phone; it is kept only when the owner wrote something newer there meanwhile (`lastOwner`), so the pairing is clear.
 */
export function replyRef(target: string, replyTo: string | undefined, lastOwner: string | undefined, late = false): string | undefined {
	if (!replyTo || !isSnowflake(replyTo)) return undefined;
	if (TOP_LEVEL.has(target) || target.startsWith("ch:")) return replyTo;
	return late || (lastOwner && lastOwner !== replyTo) ? replyTo : undefined;
}

/** An answer older than this after its request is late: the owner has moved on and needs the request quoted. */
export const LATE_MS = 2 * 60_000;
/** When a Discord message was created, from its id (the high bits of a snowflake are milliseconds since 2015-01-01). */
export const snowflakeTime = (id: string): number => Number((BigInt(id) >> 22n) + 1420070400000n);
/**
 * Is an answer to owner message `replyTo` late? It is when the owner wrote something newer in that conversation (`newest`),
 * or when the request is more than LATE_MS old (`askedAt`, ms). A late answer is sent as a visible reply that pings the owner.
 */
export function isLate(replyTo: string | undefined, newest: string | undefined, askedAt: number | undefined, now = Date.now()): boolean {
	if (!replyTo) return false;
	return (newest !== undefined && newest !== replyTo) || (askedAt !== undefined && now - askedAt > LATE_MS);
}

/**
 * The request an orchestrator post to `target` that names none answers, when that request is late: the running turn's prompt
 * there, nothing else. A post of any other run (a lane report's turn, a worker's run past its own answer) has no message of its own:
 * taking the oldest deferred request there hung it on an unrelated message and closed that message unanswered (2026-11-05 01:08, 01:25, 01:33 KST).
 */
export function lateRequestId(
	target: string,
	current: { target?: string; replyTo?: string; done?: boolean } | undefined,
	newest: string | undefined,
	askedAt: (id: string) => number | undefined,
	now = Date.now(),
): string | undefined {
	const id = current && !current.done && current.target === target ? current.replyTo : undefined;
	return id && isLate(id, newest, askedAt(id), now) ? id : undefined;
}

const QUOTE_MAX = 140;
/** The line that puts a late answer next to its request when Discord has no message to reference (a web message). */
export function lateQuote(original: { text: string; ts: string }, tz: string): string {
	const flat = original.text.replace(/\s+/g, " ").trim();
	if (!flat) return "";
	const at = new Date(original.ts).toLocaleString("ko-KR", { timeZone: tz, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
	return `원본 메시지(${at}): "${flat.length > QUOTE_MAX ? `${flat.slice(0, QUOTE_MAX - 1)}…` : flat}"`;
}

/** `quote` on its own line right after the status marker, so the marker still becomes the leading emoji. */
export function withQuote(text: string, quote: string): string {
	if (!quote) return text;
	const { head, rest } = splitTone(text);
	return `${head.trimEnd()}${head ? " " : ""}${quote}\n${rest.replace(/^\s+/, "")}`;
}

/**
 * A Discord reply (in the parent channel) to the message a thread hangs from belongs in that thread. A thread started from a
 * message has that message's id, so `ref` is the thread id; `threads` maps thread id -> parent channel id.
 */
export function threadForReply(ref: string | undefined, channelId: string, threads: Record<string, string>): string | undefined {
	return ref && threads[ref] === channelId ? ref : undefined;
}

const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}]/gu;
const SLUG = /^[a-z0-9]+(?:[-_][a-z0-9]+)+$/;
export const THREAD_NAME_MAX = 60;
/**
 * A thread name the owner can read on a phone: plain words of what the work is. No "[kind]" prefix, status, emoji or pipes;
 * a code name ("dinobot-rea") gives way to the first words of `fallback` (the goal or starter text); cut at a word.
 */
export function threadTitle(title: string | undefined, fallback?: string): string {
	const clean = (s: string) => s.replace(EMOJI, "").replace(/^\s*(?:\[[^\]]{0,30}\]\s*)+/, "").replace(/[┃|]/g, " ").replace(/\s+/g, " ").trim();
	let name = clean(title ?? "");
	const alt = clean(fallback ?? "").replace(/[.。!?].*$/, "");
	if ((!name || SLUG.test(name)) && alt) name = alt;
	if (name.length > THREAD_NAME_MAX) {
		const cut = name.slice(0, THREAD_NAME_MAX);
		const sp = cut.lastIndexOf(" ");
		name = (sp > 20 ? cut.slice(0, sp) : cut).trim();
	}
	return name || "work";
}
