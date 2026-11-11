// The orchestrator's prompt queue. Every delivered prompt remembers where its answer goes; prompts are matched back by
// their text as omp starts them (FIFO, so identical texts still pair in order). Unanswered prompts are kept on disk
// (the earlier secretary's `last_handled`: a message counts as handled when it is answered, not when it arrives), so a restart mid-turn
// replays them on boot.
//
// An owner message that arrives while the orchestrator is mid-turn is steered into that turn instead of waiting
// behind it (owner 2026-10-17: "순차적으로 처리하던데 ... 바로 답변이 안오는데"): the orchestrator answers it with dotz_send
// and carries on. If the turn ends before it was answered, it is delivered again as a normal prompt. A message that
// was answered with a reply_to (dotz_send or the turn's auto answer) is never delivered again, not at turn end and not
// by the restart replay.
//
// The answer goes out only when it is ready (owner 2026-10-20: "답변은 준비되고 해야해. 먼저하면 안됨"): a dotz_send to the
// channel the running turn answers, sent before that turn's final answer, is held (holdEarly) and posted together with
// the final answer, ahead of it. Only a full answer to a message steered in mid-turn goes out at once; progress is the one
// edited progress message (update_key), never a new text.
//
// An answer is never dropped for want of a pairing (owner 2026-10-20: three finished answers to web messages never arrived).
// OmO consumes a queued message inside the running agent run and starts runs of its own (a finished task worker wakes the
// session, also right after a gateway restart), so a user frame that matches no delivered prompt, or a run that started
// without one, is normal there: an unmatched user frame leaves the unanswered prompt in place, a prompt that finished is
// released when the orchestrator goes idle (a later run is a new one), and an answer with no prompt goes only by a label: the request
// a provider error stopped, the link of the worker that woke the run, or the target that same woken run already delivered to. Everything
// else goes to deps.home (the session's own primary target, "web" for main) with no reply id; the recency of another conversation's
// messages never picks a conversation, and a real answer is never dropped.
//
// Work another session handed over (`from`) is never posted: its final answer, and a woken worker's answer to it, go to deps.handBack.
//
// A turn that hands code work to a background task worker ends with exactly `[later]` (MODE Routing; owner 2026-10-21: a long inline turn kept every next message waiting a median 238 s): its prompt stays open (deferred) with nothing sent,
// and the answer of the run the worker's result wakes (no prompt of ours) goes to that worker's request. The word is read by meaning (tone.ts laterParts): words around it reach the owner as a note that settles nothing, and the prompt stays open.
//
// A worker is linked to its request when it is spawned (WorkLink, kept on disk next to pending.json): every worker a turn spawned
// gets its own receipt line, and the answer of the run its result woke goes to exactly that request, whatever order workers finish
// in. A follow-up that a turn passed to a worker (task_send) and deferred joins that worker's link (`also`): the answer replies to the
// oldest request of the worker and closes the others. A worker spawned by a run with no request stays linked to no message. A wake counts only for the run it woke: a result read inside a prompted turn,
// or left over when a run ended, stays out of the next run's pairing (2026-11-04 13:22 UTC: one such wake moved every later answer
// one request back), and its request is asked again once. a run no
// worker woke closes no request, and an answer no label explains is posted at home with no reply link.

import { createBurst, sameConv } from "./promptburst.ts";
import { isSilent, laterParts, stripLater } from "./tone.ts";
import { NEAR_CHARS, NEAR_MIN, head, MAX_PROMPTS, MAX_ANSWERED, REPLAY_MAX_AGE_MS, ORPHAN_MAX_AGE_MS, MAX_RECENT, DEFER_MAX_AGE_MS, DEFER_BLOCKS_RESTART_MS, MAX_TURNS, TURN_SLACK_MS, CANCEL_NOTE_MS, LINK_MAX_AGE_MS, MAX_LINKS, REPORT_NOTE_CHARS, type Prompt, type OwnerMessage, type Pending, type WorkLink, type OpenRequest, type WorkRow, type Reply, type PromptDeps } from "./prompts-model.ts";
export type { Prompt, OwnerMessage, Pending, WorkLink, OpenRequest, WorkRow, Reply, PromptDeps } from "./prompts-model.ts";

/** The hand-over labels a prompt carries through pending.json. */
const labels = (p: { from?: string; handback?: true; quiet?: true }) => ({ ...(p.from ? { from: p.from } : {}), ...(p.handback ? { handback: true as const } : {}), ...(p.quiet ? { quiet: true as const } : {}) });
/** An answer the owner must see even from a quiet check. */
const LOUD = /^\s*\[(?:ask|fail)\]/i;

export function createPrompts(deps: PromptDeps) {
	const prompts: Prompt[] = [];
	let current: Prompt | undefined;
	// Insertion order doubles as age: the oldest id goes first when the set is full.
	const answered = new Set<string>(deps.answered ?? []);
	// Owner messages and dotz_send texts of the last half hour: who an answer without a prompt goes to, and what it may not repeat.
	const owners: OwnerMessage[] = (deps.recent?.() ?? []).slice(-MAX_RECENT);
	const recentSent: { target: string; text: string; at: number }[] = [];
	// Prompts whose turn ended with [later], oldest first, until a later run answers them.
	const deferred: Prompt[] = [];
	// Deferral receipts already announced, one per (conversation, worker id); the key with an empty id is the plain note sent while no
	// worker was listed. The plain one is dropped when a non-deferred answer goes out there, a worker receipt stays while its worker runs.
	const receipted = new Set<string>();
	const receiptKey = (target: string, id = "") => `${target}\u0000${id}`;
	// Workers whose result was read in another conversation's turn and whose request was asked again (once per worker).
	const askedBack = new Set<string>();
	// Worker id -> the request it was spawned for (bgwork.ts reads it too), and the workers whose results the session was just woken with, oldest first.
	const links = new Map((deps.links ?? []).map(l => [l.id, l]));
	// `in`: the prompted turn it landed in; `waited`: the run it woke said [later].
	const woke: { id: string; at: number; in?: Prompt; waited?: boolean }[] = [];
	const saveLinks = () => {
		for (const [id, l] of links) if (Date.now() - l.at > LINK_MAX_AGE_MS || links.size > MAX_LINKS) links.delete(id);
		deps.persistLinks?.([...links.values()]);
	};
	function link(id: string, to: { target: string; replyTo?: string }, description?: string): WorkLink {
		const known = links.get(id);
		if (known) return known;
		const l: WorkLink = { id, target: to.target, ...(to.replyTo ? { replyTo: to.replyTo } : {}), at: Date.now(), ...(description ? { description } : {}) };
		links.set(id, l);
		saveLinks();
		return l;
	}
	const linksOf = (p: { target?: string; replyTo?: string }) => [...links.values()].filter(l => (l.target === p.target && l.replyTo === p.replyTo) || (p.replyTo !== undefined && l.also?.includes(p.replyTo)));
	// Every turn that ran (omp started it from a delivered prompt), oldest first: a worker belongs to the turn it was spawned in.
	const turns: { prompt: Prompt; start: number; end?: number }[] = [];
	const closeTurn = () => { const t = turns.at(-1); if (t && t.end === undefined) t.end = Date.now(); };
	const openDeferred = () => deferred.filter(p => !p.done && !isAnswered(p.replyTo) && Date.now() - p.at <= DEFER_MAX_AGE_MS);

	/** A worker still running in another conversation whose request is still waiting: its answer may arrive while this turn runs. */
	function otherConversation(target: string): WorkRow | undefined {
		const waiting = new Set(openDeferred().map(p => p.target));
		return (deps.work?.() ?? []).find(w => (w.status === "running" || w.status === "stalled") && w.target !== undefined && waiting.has(w.target) && !sameConv(w.target, target));
	}

	const pending = (p: Prompt): Pending => ({ text: p.text, at: p.at, target: p.target, replyTo: p.replyTo, ...(p.refs?.length ? { refs: p.refs } : {}), ...(p.deferred ? { deferred: p.deferred } : {}), ...labels(p) });
	const save = () => {
		const open = [...openDeferred().filter(p => p !== current), ...(current && !current.done ? [current] : []), ...prompts.filter(p => !p.cancelled)].filter(p => !isAnswered(p.replyTo)).map(pending);
		deps.persist(open);
	};
	const isAnswered = (replyTo?: string) => replyTo !== undefined && (answered.has(replyTo) || deps.pending?.(replyTo) === true);
	/** The requests still waiting on this worker, oldest first. */
	const tiedOpen = (l: WorkLink) => openDeferred().filter(d => linksOf(d).includes(l)).sort((a, b) => a.at - b.at);
	/** Did the running work wake this run (the wake is not for a prompted turn)? */
	const wokenRun = () => woke.some(w => !w.in);
	// The run started from a user frame nothing delivered explains (a schedule's raw text, a runtime's own message): its answer is its own, no request's.
	let unpairedRun = false;
	let resultTo: { target: string; from?: string } | undefined;   // where this woken run already delivered a worker's result; its later answers (no new wake) restate it there only

	/** Records that the owner message `replyTo` got an answer. */
	function markAnswered(replyTo: string | undefined | null): void {
		if (!replyTo) return;
		answered.delete(replyTo);
		answered.add(replyTo);
		if (answered.size > MAX_ANSWERED) answered.delete(answered.values().next().value!);
		// pending.json drops it now, not at the next unrelated change: a restart right after the answer must not replay it.
		save();
	}

	const burst = createBurst(prompts, { ...deps, isAnswered, markAnswered, save });

	/**
	 * Delivers one prompt; true when it was steered into the running turn. Only a message of the conversation that turn answers is
	 * steered in: another conversation's message waits as its own prompt, so one turn never mixes two conversations and its answer
	 * cannot land in the wrong one (2026-10-28 21:44 KST: a mail thread's question was steered into a KTX run and the KTX answer
	 * was posted in the mail thread). The owner's next message while that run goes on after its first stop joins it too; behind a
	 * prompt that has not started yet it gathers (hub/promptburst.ts).
	 */
	function deliver(text: string, reply?: Reply): boolean {
		const running = Boolean(!reply?.from && !reply?.handback && !reply?.quiet && current?.target && reply && sameConv(current.target, reply.target) && (!current.done || (reply.owner && !current.cancelled)));
		const steered = deps.working() && running;
		const gather = !steered && reply?.owner === true && burst.gathers(reply.target);
		// A new owner turn for a conversation whose background worker is still running starts with a note naming that worker, so the
		// orchestrator passes a follow-up to it (task_send) instead of spawning a second worker for the same job (owner 2026-10-30:
		// four follow-ups to one posting job). The Prompt keeps the text as delivered: onPrompt pairs by it and a replay re-sends it.
		const worker = !steered && !gather && reply?.owner ? deps.workFor?.(reply.target) : undefined;
		if (worker && deps.joinNote && !deps.hasJoinNote?.(text)) text = `${deps.joinNote(worker)}\n\n${text}`;
		// A worker of another conversation may report during this turn (OmO injects its completion into the running run): its answer
		// belongs to its own conversation, not to this prompt's (2026-10-31 06:36 UTC, A's answer was posted into B).
		const elsewhere = reply?.owner && !gather && deps.foreignNote && !deps.hasForeignNote?.(text) ? otherConversation(reply.target) : undefined;
		if (elsewhere?.target) text = `${text}\n\n${deps.foreignNote!(elsewhere, elsewhere.target)}`;
		const cards = reply?.owner && !gather && !deps.hasCardsNote?.(text) ? deps.cardsNote?.(reply.target) : undefined;
		if (cards) text = `${cards}\n\n${text}`;
		const prompt: Prompt = { key: text.slice(0, 300), text, at: Date.now(), target: reply?.target, replyTo: reply?.replyTo, ...(reply?.refs?.length ? { refs: reply.refs } : {}), sent: [], steered, ...(reply?.owner ? { owner: true } : {}), ...(gather ? { gathered: true } : {}), ...labels(reply ?? {}) };
		prompts.push(prompt);
		if (prompts.length > MAX_PROMPTS) prompts.splice(0, prompts.length - MAX_PROMPTS);
		if (reply?.owner) {
			owners.push({ target: reply.target, replyTo: reply.replyTo, at: prompt.at, prompt });
			if (owners.length > MAX_RECENT) owners.splice(0, owners.length - MAX_RECENT);
		}
		save();
		if (gather) return void burst.gathered(), false;
		if (!steered) {
			// A turn still owes an answer, yet the orchestrator does not look busy: logged to find why (10-20 17:19).
			if (reply && deps.working()) deps.log(`message for ${reply.target} waits as its own prompt: the running turn answers ${current && !current.done ? (current.target ?? "-") : "no request of ours"}`);
			deps.deliver(text, Boolean(reply?.owner));
			return false;
		}
		const note = deps.note(reply!.target, reply!.replyTo, text);
		prompt.noted = note.trim();
		if (deps.steer(note) !== false) {
			// The owner's message is answered in this turn's final answer, so that answer must be posted, not kept as a quiet line.
			if (current?.quiet) {
				delete current.quiet;
				save();
			}
			return true;
		}
		prompt.noted = undefined;
		// The turn ended between the check and the steer: the message goes in as a normal prompt instead of waiting.
		prompts.at(-1)!.steered = false;
		deps.deliver(text, Boolean(reply?.owner));
		return false;
	}

	/** Records a dotz_send: the turn's current prompt has now sent this part, and a steered prompt it answers is settled. Returns the request it answers, which the post must carry: the wake is spent here. */
	function sent(target: string, text: string, replyTo?: string): string | undefined {
		current?.sent.push({ target, text: text.trim() });
		recentSent.push({ target, text: text.trim(), at: Date.now() });
		if (recentSent.length > MAX_RECENT) recentSent.shift();
		if (laterParts(text).later) return undefined;
		// A run with no prompt of ours (a worker's result woke it) answering with dotz_send settles the deferred prompt it answers: the one with this reply_to or the waking worker's. A send that names neither closes nothing.
		const ref = replyTo ?? (current ? undefined : resultFor(target));
		if (!current || replyTo) {
			const d = ref ? openDeferred().find(p => p.target === target && p.replyTo === ref) : undefined;
			if (d) {
				d.done = true;
				burst.close(target, d.refs ?? []);
				save();
			}
			closeResults(ref);
		}
		markAnswered(ref);
		burst.settle(target, replyTo);
		return ref;
	}

	/**
	 * A dotz_send without update_key to the channel the current turn answers: true when it is held for the final answer.
	 * A reply to a message steered into this turn (by reply_to, or the channel's steered message when none is named) is
	 * that message's own answer and is not held.
	 */
	function holdEarly(target: string, text: string, replyTo?: string): boolean {
		const p = current;
		if (!p || p.done || p.target !== target || !text.trim()) return false;
		if (burst.find(target, replyTo)) return false;
		if (replyTo && openDeferred().some(d => d.target === target && d.replyTo === replyTo)) return false;   // that request's own answer: held, it would stay open (nagged, replayed after a restart)
		(p.held ??= []).push(stripLater(text).trim());
		deps.log(`held an early send to ${target} until the turn's answer (${text.trim().length} chars)`);
		return true;
	}
	/** A turn ended without a final answer to carry its held early sends: they go out now, once, as one note that settles nothing (with `extra`, what the turn wrote around [later]). */
	const flushHeld = (p: Prompt, extra = "") => { const text = [...(p.held ?? []), extra].filter(Boolean).join("\n\n"); p.held = undefined; if (p.target && text && !p.from) deps.interim?.(p.target, text); };

	// What was steered into a cancelled request may still wait in the runtime's queue, and the runtime starts a turn with it after the
	// abort (2026-10-28 live check: the turn came back 1 s after 중단 and answered). onPrompt tells the caller to abort that turn too.
	let cancelledNotes: { text: string; at: number }[] = [];

	/**
	 * The owner's 중단 (the web stop button, /abort): the running turn's request ends here, unanswered on purpose. Its prompt, the
	 * messages steered into it and the requests of that conversation still waiting on background workers are closed, so the idle hook
	 * does not deliver them again, a restart does not replay them, and a late answer for them is dropped. Returns the conversation.
	 */
	function cancel(): string | undefined {
		const p = current;
		const target = p?.target;
		if (!p || (p.done && !prompts.some(q => (q.steered || q.gathered) && q.target !== undefined && target !== undefined && sameConv(q.target, target)))) return undefined;
		const here = (q: Prompt) => q.target === target || (q.target !== undefined && target !== undefined && sameConv(q.target, target));
		Object.assign(p, { done: true, cancelled: true, last: undefined, held: undefined });
		for (const q of prompts.filter(q => (q.steered || q.gathered) && here(q))) {
			q.cancelled = true;
			prompts.splice(prompts.indexOf(q), 1);
			cancelledNotes.push({ text: q.text, at: Date.now() });
		}
		// Messages of that conversation sent while it worked wait in the runtime's queue as next prompts: each is stopped when it starts.
		for (const q of prompts.filter(q => !q.steered && here(q))) Object.assign(q, { cancelled: true, done: true });
		for (const d of openDeferred().filter(d => d.target === target)) Object.assign(d, { done: true, cancelled: true });
		for (const l of links.values()) if (l.target === target) l.cancelled = true;
		saveLinks();
		for (const o of owners.filter(o => o.target === target && o.prompt && !o.prompt.done)) Object.assign(o.prompt!, { done: true, cancelled: true });
		deps.log(`turn for ${target ?? "-"} cancelled by the owner`);
		save();
		return target;
	}

	/** The current turn's answer goes to `to` instead of `from` (work that moved into a lane's thread is answered there). */
	function retarget(from: string, to: string): void {
		if (current && !current.done && current.target === from) current.target = to;
	}

	/** omp started a prompt: pair it with the delivered one it came from. Returns true when the turn that just started carries only messages of a request the owner cancelled: the caller aborts it. */
	function onPrompt(text: string): boolean {
		cancelledNotes = cancelledNotes.filter(n => Date.now() - n.at <= CANCEL_NOTE_MS);
		if (deps.isNote(text) && cancelledNotes.some(n => text.includes(n.text)) && (!current || current.done)) {
			cancelledNotes = cancelledNotes.filter(n => !text.includes(n.text));
			deps.log("a turn started with a message of a cancelled request; it is stopped");
			return true;
		}
		// Notes steered into a running turn are not new requests: the turn keeps answering the prompt it started with.
		if (deps.isNote(text)) return void burst.see(text), false;
		// The harness's own mid-turn injections (OmO: `<system-reminder>` when a detached cell finishes, `<omo-senpi-task>`)
		// are not prompts either; clearing `current` on them dropped the turn's final answer (owner 2026-10-20: "작업 끝나도
		// 보고 안하는거", the 17:18 web turn).
		if (text.trimStart().startsWith("<")) return false;
		for (const q of prompts.filter(q => q.cancelled && Date.now() - q.at > CANCEL_NOTE_MS)) prompts.splice(prompts.indexOf(q), 1);
		const i = prompts.findIndex(p => !p.steered && !p.gathered && text.includes(p.key));
		const started = prompts[i];
		if (i >= 0 && started!.cancelled) {
			prompts.splice(i, 1);
			deps.log("a turn started with a message the owner cancelled; it is stopped");
			return true;
		}
		// omp runs prompts in the order they were delivered, so a prompt older than the one that just started was taken into a
		// turn already. A lane report (no target, no message id) has no answer that could settle it: it was consumed by that turn,
		// and kept it would be replayed after the next restart (2026-10-23, a morning [done] came back at 08:48).
		if (i > 0) {
			const used = prompts.slice(0, i).filter(p => !p.steered && !p.target && !p.replyTo);
			for (const p of used) prompts.splice(prompts.indexOf(p), 1);
			if (used.length) deps.log(`${used.length} earlier prompt(s) without a message were consumed by a turn and are not kept for a replay`);
		}
		if (i < 0 && current && !current.done) {
			// A user frame the gateway did not deliver (raw text admitted into the run, a runtime's own message): the turn is
			// still answering the prompt it started with, so its answer must not lose its prompt (2026-10-20 10:43Z, 10:52Z).
			if (!current.unmatched) deps.log(`a user prompt matched nothing delivered; the running turn keeps its prompt for ${current.target ?? "-"}: ${text.trim().slice(0, 80)}`);
			current.unmatched = true;
			return false;
		}
		closeTurn();
		resultTo = undefined;
		current = started && prompts.splice(prompts.indexOf(started), 1)[0];   // not by `i`: the prompts dropped above moved it (2026-11-04 15:52: the turn lost its prompt)
		unpairedRun = !current;
		if (current) {
			turns.push({ prompt: current, start: Date.now() });
			if (turns.length > MAX_TURNS) turns.shift();
		}
		// A prompt redelivered at idle waits in the runtime's queue and cannot be taken back; if a dotz_send answered its message
		// meanwhile (2026-10-22 00:32, web 3e7dd934), it still starts as a turn, but that turn's own answer would only repeat the first.
		if (current && isAnswered(current.replyTo)) {
			current.done = true;
			deps.log(`the prompt for ${current.target ?? "-"} was already answered by a dotz_send; this turn's answer is dropped`);
		}
		if (current?.target) burst.release(current.target);
		save();
		return false;
	}

	/** Any assistant text of the running turn: the safety net's answer when the turn ends without a stop. */
	function onText(text: string): void {
		if (current && !current.done && text.trim()) current.last = text;
	}

	/**
	 * The orchestrator went idle: a prompt the turn never answered (no stop with text: aborted, cut off, a lost pairing)
	 * gets the turn's last text, so an answer is never dropped without a trace (owner 2026-10-20: "작업 끝나도 보고 안하는거").
	 */
	function settleTurn(failed = false): void {
		const p = current;
		resultTo = undefined;
		if (!p) {
			unpairedRun = false;
			return askLeftover();
		}
		// A turn stopped by a provider error before it wrote anything is not answered: its request stays open like a deferred one, so the
		// run that resumes after the pause answers it in its own conversation and a restart replays it (2026-10-28 13:25Z on the Mac mini:
		// the owner's message was closed as a turn that wrote no text while the account was rate-limited, and never answered).
		// The silent-wait nudge is no request: the requests it names stay open on their own (2026-11-11: each nudge a usage limit stopped
		// became one more id-less request, with a new time, so the bounded nudge started over for it).
		if (failed && !p.done && p.target && !p.deferred && !p.last && !p.cancelled && !deps.regenerated?.(p.text)) {
			p.deferred = true;
			p.retry = true;
			deferred.push(p);
			deps.log(`turn for ${p.target} stopped on an error before answering; its request stays open for the retry`);
			flushHeld(p);
			closeTurn();
			current = undefined;
			woke.length = 0;
			save();
			return;
		}
		// The run is over: a run that starts next without a prompt of ours (OmO wakes the session when a task worker finishes,
		// also right after a restart) is a new one and must not be taken for a continuation of this prompt (2026-10-20 12:51Z).
		if (!p.done && p.target && !p.deferred) {
			deps.log(`turn ended without an answer to ${p.target}; ${p.last ? "sending its last text" : "it wrote no text"}`);
			// No text and nothing sent for a message of ours (a nudge for a request already waiting is not one): the owner is told, not left with a closed request and no answer.
			const unanswered = p.replyTo !== undefined && !isAnswered(p.replyTo) && !p.sent.some(s => sameConv(s.target, p.target!)) && !openDeferred().some(d => d.replyTo === p.replyTo);
			if (p.last || p.held?.length) onAnswer(p.last ?? "");
			else if (unanswered && deps.noAnswerNote) onAnswer(deps.noAnswerNote());
			else p.done = true;
		}
		flushHeld(p);
		closeTurn();
		current = undefined;
		askBack(p.target);
		askLeftover(p.target);
		save();
	}

	/**
	 * The run ended: a wake still listed was read there and not answered, so it may not pair with the next run. Its request is asked
	 * again once when it waits on nothing else (a run that said [later] chose to wait; a conversation switch is askBack's).
	 */
	function askLeftover(target?: string): void {
		const work = deps.work?.() ?? [];
		const live = new Set(work.filter(w => w.status === "running" || w.status === "stalled").map(w => w.id));
		for (const w of woke.splice(0).filter(w => !w.waited)) {
			const l = links.get(w.id);
			if (!l || l.delivered || l.cancelled) continue;
			l.read = true;
			saveLinks();
			const d = tiedOpen(l)[0];
			if (!d?.target || askedBack.has(l.id) || !deps.readHereNote || (target && !sameConv(target, d.target)) || linksOf(d).some(o => live.has(o.id))) continue;
			askedBack.add(l.id);
			deps.log(`the result of ${l.id} was read in a run that did not answer ${d.replyTo ?? "(no id)"}; it is asked again`);
			deliver(`${deps.readHereNote(l.id)}\n\n${d.text}`, { target: d.target, replyTo: d.replyTo });
		}
	}

	/**
	 * A turn for one conversation ended while a worker of another finished during it: OmO read that result here, but the request it
	 * answers still waits in its own conversation. Ask that one again with its own text, once per worker, and leave it open.
	 */
	function askBack(target: string | undefined): void {
		const work = deps.work?.();
		const note = deps.readElsewhereNote;
		if (!target || !note || !work?.length) return;
		const turn = turns.at(-1);
		const from = turn?.start ?? 0;
		const to = Date.now();
		for (const w of work) {
			if (w.status === "running" || w.status === "stalled" || w.endedAt === undefined || w.endedAt < from || w.endedAt > to) continue;
			if (!w.target || sameConv(w.target, target) || askedBack.has(w.id)) continue;
			const open = openDeferred().filter(p => p.target === w.target);
			const d = open.find(p => w.replyTo !== undefined && p.replyTo === w.replyTo) ?? open.at(-1);
			if (!d) continue;
			askedBack.add(w.id);
			if (askedBack.size > MAX_ANSWERED) askedBack.delete(askedBack.values().next().value!);
			deps.log(`the result of ${w.id} for ${w.target} was read in a turn for ${target}; ${w.target} is asked again`);
			deliver(`${note(w, target)}\n\n${d.text}`, { target: w.target, replyTo: d.replyTo });
		}
	}

	/**
	 * The owner message the turn running at `at` (ms) was answering: a new turn replaces it, a message steered into the turn
	 * or answered with a dotz_send reply_to does not move it. Undefined when no turn of ours was running then (a run a
	 * worker's result woke, or one before this process started).
	 */
	function turnAt(at: number): { target: string; replyTo?: string } | undefined {
		const t = turns.findLast(x => x.start <= at);
		if (!t || (t.end !== undefined && at > t.end + TURN_SLACK_MS) || !t.prompt.target) return undefined;
		return { target: t.prompt.target, ...(t.prompt.replyTo ? { replyTo: t.prompt.replyTo } : {}) };
	}

	/** The request a provider error stopped: the one label, besides a worker's link, that names where an answer with no prompt goes. */
	function orphanTarget(fromWorker: boolean): OwnerMessage | undefined {
		const stopped = fromWorker ? undefined : openDeferred().find(p => p.retry);
		return stopped?.target ? { target: stopped.target, replyTo: stopped.replyTo, at: stopped.at, prompt: stopped } : undefined;
	}
	/** Where a real answer with no label goes: home, naming no message (hub.log 2026-11-04T04:20:25Z, 823 chars lost to a pairing guess). */
	const home = (): OwnerMessage => ({ target: deps.home ?? "web", at: Date.now() });

	/** OmO said these workers finished, so a run is reading their results. A delivered result that is only a housekeeping line is followed by the real report. */
	function workersDone(ids: string[]): void {
		for (const id of ids) {
			woke.push({ id, at: Date.now(), ...(current && !current.done ? { in: current } : {}) });
			const report = deps.report?.(id);
			// A leading `<` keeps this out of the prompt pairing (onPrompt), as OmO's own injected notes.
			if (report) deps.steer(`<dotz-worker-report task="${id}">\n${report.slice(0, REPORT_NOTE_CHARS)}\n</dotz-worker-report>`);
		}
	}

	/** The running turn passed a message to these workers (task_send): if it ends in [later], its request waits on them. */
	function workersSteered(ids: string[]): void {
		if (current && !current.done) (current.told ??= []).push(...ids);
	}

	/** A follow-up deferred to a worker: it waits on that worker's result, and a worker revived for it reports again. */
	function tie(l: WorkLink, p: Prompt): void {
		if (p.replyTo && p.replyTo !== l.replyTo && !l.also?.includes(p.replyTo)) l.also = [...(l.also ?? []), p.replyTo];
		l.delivered = false;
		l.read = false;
		saveLinks();
	}

	/** The owner message a turn's worker serves: the turn's own, else (a note started the turn: a new session's history) the newest one steered in; without it the open-request check asked for a second answer (st_01a1aa4c). */
	const requestOf = (p: Prompt) => p.replyTo ?? prompts.findLast(q => q.steered && q.replyTo && q.target === p.target)?.replyTo;
	/** Workers the runtime just spawned: the running turn's request is theirs; a run no prompt started serves the request of the worker that woke it. */
	function workersSpawned(workers: { id: string; description?: string }[]): void {
		if (current?.target) {
			for (const w of workers) link(w.id, { target: current.target, replyTo: requestOf(current) }, w.description);
			return;
		}
		const woken = woke.map(w => links.get(w.id)).find(l => l !== undefined);
		// A run nothing woke (a lane report's turn) serves no request: its worker gets its line in the conversation that waits, and no message (st_01a1a761 was tied to an unrelated newest request).
		const waiting = openDeferred().at(-1)?.target;
		const to = woken ?? (waiting ? { target: waiting } : undefined);
		if (!to) return;
		for (const w of workers) receipt(link(w.id, { target: to.target, replyTo: to.replyTo }, w.description));
	}

	const receiptedWorker = (l: WorkLink) => l.receipted === true || receipted.has(receiptKey(l.target, l.id));
	/** The one visible line of a worker (a gateway note: it settles no prompt). */
	function receipt(l: WorkLink): void {
		if (receiptedWorker(l)) return;
		const took = (l.description ?? deps.work?.().find(w => w.id === l.id)?.description)?.trim();
		receipted.add(receiptKey(l.target, l.id));
		if (receipted.size > MAX_ANSWERED) receipted.delete(receipted.values().next().value!);
		l.receipted = true;
		saveLinks();
		deps.log(`the answer to ${l.target} is deferred to worker ${l.id}`);
		deps.announce?.(l.target, took ? `백그라운드 작업으로 맡겼어요: ${took}` : "백그라운드 작업으로 맡겼어요", l.id);
	}

	/** The workers this turn spawned, by the runtime's own spawn event or by the task store's start time, without a line yet. */
	function newWorkers(p: Prompt): WorkLink[] {
		const turn = turns.at(-1);
		const from = (turn?.prompt === p ? turn.start : p.at) - TURN_SLACK_MS;
		for (const w of deps.work?.() ?? [])
			if ((w.status === "running" || w.status === "stalled") && w.startedAt >= from && (!w.target || sameConv(w.target, p.target!))) link(w.id, { target: p.target!, replyTo: requestOf(p) }, w.description);
		return linksOf({ target: p.target, replyTo: requestOf(p) }).filter(l => l.at >= from && !receiptedWorker(l));
	}

	const requestOpen = (l: WorkLink) => tiedOpen(l).length > 0;
	/** Whose result the next answer without a prompt carries: the worker that woke the run, else the oldest finished worker whose request still waits (a link either way). */
	function nextResult(): WorkLink | undefined {
		const work = deps.work?.() ?? [];
		for (let i = woke.findIndex(w => !w.in); i >= 0; i = woke.findIndex(w => !w.in)) {
			const w = woke.splice(i, 1)[0]!;
			const l = links.get(w.id);
			if (l && !l.delivered && Date.now() - w.at <= ORPHAN_MAX_AGE_MS) return l;
		}
		return work
			.filter(w => (w.status === "done" || w.status === "failed") && w.endedAt !== undefined)
			.sort((a, b) => a.endedAt! - b.endedAt!)
			.map(w => links.get(w.id))
			.find(l => l && !l.delivered && !l.read && requestOpen(l));
	}
	/** The request a dotz_send to `target` from a run without a prompt answers: the one of the worker that woke the run. */
	function resultFor(target: string): string | undefined {
		for (const w of woke) {
			const l = links.get(w.id);
			if (l && !l.delivered && sameConv(l.target, target)) return tiedOpen(l)[0]?.replyTo ?? l.replyTo;
		}
		return undefined;
	}
	/** The request was answered: the results that woke the session for it are spent. */
	function closeResults(replyTo: string | undefined): void {
		if (!replyTo) return;
		const isFor = (l?: WorkLink) => l !== undefined && (l.replyTo === replyTo || l.also?.includes(replyTo) === true);
		for (const id of new Set([...woke.map(w => w.id), ...askedBack])) {
			const l = links.get(id);
			if (!l || !isFor(l)) continue;
			for (const w of woke.filter(w => w.id === id)) woke.splice(woke.indexOf(w), 1);
			if (l.delivered) continue;
			l.delivered = true;
			for (const d of tiedOpen(l)) d.done = true;
			saveLinks();
			save();
		}
	}

	/** An answer that came without a prompt: to the request of the worker whose result it carries (handed back when that request was handed over), else the label rules above, else home; never a repeat of what was already sent there. */
	function onOrphanAnswer(text: string): void {
		const { later, text: t } = laterParts(text);
		// Woken before the worker's result was in: the deferred prompt keeps waiting.
		if (later) {
			for (const w of woke) w.waited = true;
			if (t) deps.interim?.((orphanTarget(wokenRun()) ?? home()).target, t);
			return void deps.log(`a run without a prompt said [later]; ${openDeferred().length} deferred prompt(s) keep waiting`);
		}
		// Keepalive "ok" and "-" have no prompt by design.
		if (t.length <= 3) return;
		if (isSilent(t)) return void deps.log(`a no-op answer without a prompt was not posted: ${t.slice(0, 160)}`);
		const fromWorker = wokenRun();
		const result = fromWorker || !unpairedRun ? nextResult() : undefined;
		// The oldest request waiting on this worker takes the reply; the others of that worker close with it.
		const tied = result ? tiedOpen(result) : [];
		const ask = tied[0];
		if (result) {
			result.delivered = true;
			if (fromWorker) resultTo = { target: result.target, from: ask?.from };
			saveLinks();
			deps.log(`the result of ${result.id} goes to its request ${result.replyTo ?? "(no id)"} in ${result.target}`);
		}
		if (!result && !fromWorker && resultTo?.from) return void deps.log(`a restatement of a result handed back to ${resultTo.from} was not posted (${t.length} chars)`);
		const to: OwnerMessage = result ? { target: ask?.target ?? result.target, replyTo: ask ? ask.replyTo : result.replyTo, at: result.at, prompt: ask ?? deferred.find(d => d.target === result.target && d.replyTo === result.replyTo) } : !fromWorker && resultTo ? { target: resultTo.target, at: Date.now() } : (orphanTarget(fromWorker) ?? home());
		if (to.prompt?.cancelled || result?.cancelled) return void deps.log(`an answer for a request the owner cancelled was dropped (${t.length} chars)`);
		if (recentSent.some(s => s.target === to.target && Date.now() - s.at <= ORPHAN_MAX_AGE_MS && s.text.includes(t))) return;
		deps.log(`an answer had no prompt; sent to ${to.replyTo ?? "no message"} in ${to.target} (${t.length} chars): ${t.slice(0, 80)}`);
		recentSent.push({ target: to.target, text: t, at: Date.now() });
		// The message this answers is settled wherever it is still listed (the owner's list, a deferred wait, a steered note), so its
		// working / waiting state ends with the answer and a restart does not replay it.
		if (to.prompt) to.prompt.done = true;
		for (const d of tied) d.done = true;
		for (const d of deferred) if (d.target === to.target && d.replyTo !== undefined && d.replyTo === to.replyTo) d.done = true;
		if (to.replyTo) burst.settle(to.target, to.replyTo);
		save();
		const settle = () => {
			markAnswered(to.replyTo);
			burst.close(to.target, to.prompt?.refs ?? []);
			for (const d of tied) {
				markAnswered(d.replyTo);
				burst.close(to.target, d.refs ?? []);
			}
		};
		const via = deps.handBack ? to.prompt?.from : undefined;
		if (via) return (deps.handBack!(via, t, to.replyTo), settle());
		void deps
			.post(to.target, t, to.replyTo)
			.then(r => {
				if (!r.delivered) return;
				settle();
				deps.clearProgress(to.target);
			})
			.catch(e => deps.log(`reply to ${to.target} failed: ${e}`));
	}

	/** A later stop of a run whose prompt was answered: it answers what landed in the run since, and is posted with them. */
	function onContinued(p: Prompt, text: string): void {
		const { later, text: t } = laterParts(text);
		const target = p.target;
		const replyTo = target ? burst.seen(target).findLast(q => q.replyTo)?.replyTo : undefined;
		if (!target || p.cancelled || later || isSilent(t) || !burst.seen(target).length) return;
		const ids = burst.cover(target);
		save();
		if (p.sent.some(s => sameConv(s.target, target) && s.text.includes(t))) return burst.close(target, ids);
		p.sent.push({ target, text: t });
		void deps
			.post(target, t, replyTo)
			.then(r => {
				if (!r.delivered) return;
				burst.close(target, ids);
				deps.clearProgress(target);
			})
			.catch(e => deps.log(`reply to ${target} failed: ${e}`));
	}

	/** An assistant stop: the turn's final answer goes to the channel that asked, once. */
	function onAnswer(text: string): void {
		const p = current;
		// A turn omp continues (steered notes) stops again; the prompt it started with was answered at the first stop.
		if (!p) return onOrphanAnswer(text);
		if (p.done) return onContinued(p, text);
		const { later, text: t } = laterParts(text);
		if (later && p.target && !p.deferred) {
			flushHeld(p, t);
			// The answer itself waits for the worker, but the conversation must not look silent (owner 2026-10-27: "메일 내 대화에서
			// 다른 일 시키니까 일 안하네"): one short note names who took it. It is a gateway note, so it settles no prompt.
			// A turn the gateway woke for a request already waiting: that one entry keeps waiting.
			const twin = p.replyTo ? openDeferred().some(d => d.replyTo === p.replyTo) : false;
			if (twin) p.done = true;
			else {
				p.deferred = true;
				deferred.push(p);
			}
			// Every worker this turn spawned gets its own line, whoever else runs in the conversation (2026-11-04: st_01a1a45d and
			// st_01a1a465 were taken for the older st_01a1a45c, the first one the conversation listed, and got none).
			const fresh = newWorkers(p);
			for (const l of fresh) receipt(l);
			const told = (p.told ?? []).flatMap(id => links.get(id) ?? []);
			for (const l of told) tie(l, p);
			if (fresh.length || twin) return void save();
			// The worker this turn really passed the follow-up to; the conversation's oldest running one is only a guess, which takes this request when no request owns it (2026-11-05 st_01a1aa4c: the answer left the request open).
			const heard = told.at(-1);
			const w = heard ? { id: heard.id, description: heard.description ?? "" } : deps.workFor?.(p.target);
			const unowned = !heard && w ? links.get(w.id) : undefined;
			if (unowned && !unowned.replyTo && !unowned.also?.length) tie(unowned, p);
			const took = w?.description.trim();
			const note = took ? `백그라운드 작업으로 맡겼어요: ${took}` : "백그라운드 작업으로 맡겼어요";
			// One receipt per worker (owner 2026-10-30: the same "유튜브 답글 게시" note came 4x in 2 minutes): a later deferral in the
			// conversation while that worker still runs is silent.
			const rk = receiptKey(p.target, w?.id);
			if (receipted.has(rk) || (heard && receiptedWorker(heard))) deps.log(`the answer to ${p.target} is deferred again to ${w ? `worker ${w.id}` : "a background worker"}; receipt already sent`);
			else {
				receipted.add(rk);
				if (receipted.size > MAX_ANSWERED) receipted.delete(receipted.values().next().value!);
				deps.log(`the answer to ${p.target} is deferred to a background worker`);
				if (!t) deps.announce?.(p.target, note, w?.id);
			}
			save();
			return;
		}
		if (later) return flushHeld(p, t);
		p.done = true;
		const silent = isSilent(t);
		// A quiet check that found nothing to decide or report: one worklog line, no post, no push. Text it sent early with dotz_send stays a normal answer.
		const quiet = Boolean(p.quiet && !silent && t && !LOUD.test(t) && !p.held?.length && deps.quietNote);
		if (quiet && p.target) {
			deps.log(`a quiet check answer for ${p.target} was kept in the worklog`);
			deps.quietNote!(p.target, t);
		}
		// From here a quiet answer is handled like "-": it posts nothing, and what gathered behind the prompt is released as below.
		const hush = silent || quiet;
		if (silent && t !== "-") deps.log(`a no-op answer for ${p.target ?? "-"} was not posted: ${t.slice(0, 160)}`);
		if (p.target && !hush) receipted.delete(receiptKey(p.target));
		if (!hush) closeResults(p.replyTo);
		// The answer to the silent-wait reminder (it names no message here) settles the requests a provider error stopped before their own
		// answer came, in its conversation and older than the reminder: the reminder listed them and told the run to finish or explain each
		// (2026-11-11: scheduled items stopped by a usage limit stayed open after the answers to the reminders). Any other answer with no
		// message id (another scheduled item, a quiet check) did not do their work, so it leaves them open for the run that resumes them.
		if (!hush && p.target && !p.replyTo && deps.regenerated?.(p.text)) for (const d of openDeferred()) if (d.retry && d.target === p.target && !d.replyTo && d.at <= p.at && !linksOf(d).some(l => !l.delivered && !l.cancelled)) d.done = true;
		const ids = p.target && !hush ? [...(p.refs ?? []), ...burst.cover(p.target)] : [];
		save();
		if (!p.target) return;
		const target = p.target;
		// Parts sent early with dotz_send do not replace the answer; skip it only when it repeats something already sent.
		const sentHere = p.sent.some(s => s.target === target);
		const held = p.held ?? []; p.held = undefined;
		// Also a repeat: the same first NEAR_CHARS normalized characters as something this turn already posted to that conversation
		// (a schedule text said "tell web" while its final answer goes to "chat", both the main web conversation).
		const key = head(t);
		const prior = [...p.sent.filter(s => sameConv(s.target, target)).map(s => s.text), ...held];
		const repeat = hush || !t || prior.some(h => h.includes(t) || (key.length >= NEAR_MIN && head(h) === key));
		if (repeat && !held.length) {
			if (sentHere) deps.clearProgress(target);
			return burst.close(target, ids);
		}
		const body = [...held, ...(repeat ? [] : [t])].join("\n\n");
		p.sent.push({ target, text: body });
		// Work another session handed over is answered to that session, never posted in the conversation it names.
		if (p.from && deps.handBack) {
			deps.handBack(p.from, body, p.replyTo);
			markAnswered(p.replyTo);
			return burst.close(target, ids);
		}
		void deps
			.post(target, body, p.replyTo)
			.then(r => {
				if (!r.delivered) return;
				markAnswered(p.replyTo);
				burst.close(target, ids);
				deps.clearProgress(target);
			})
			.catch(e => deps.log(`reply to ${target} failed: ${e}`));
	}

	/** Delivers prompts that were never answered (the gateway stopped mid-turn) again; returns how many were replayed. */
	function replay(unanswered: Pending[], wrap: (text: string) => string): number {
		// A stored prompt without a message id (web messages had none) counts as answered when an answer to its target came after it.
		const fresh = unanswered.filter(p => {
			if (!p.text || Date.now() - (p.at ?? 0) >= REPLAY_MAX_AGE_MS) return false;
			if (deps.regenerated?.(p.text)) { deps.log(`not replaying a gateway nudge for ${p.target ?? "-"}: the silent-wait check sends it again if still due`); return false; }
			const done = isAnswered(p.replyTo) || Boolean(!p.replyTo && p.target && p.at && deps.answeredSince?.(p.target, p.at));
			if (done) deps.log(`not replaying ${p.target ?? "-"} ${p.replyTo ?? "(no id)"} after the restart: already answered`);
			return !done;
		});
		// A request waiting on a worker keeps waiting: its link says whose result answers it, and running the request again would repeat
		// that work. If that result never comes, the silent-wait check names the request (hub/waitcheck.ts).
		const failed = new Set((deps.work?.() ?? []).filter(w => w.status === "failed").map(w => w.id));
		const waits = (p: Pending) => p.deferred === true && linksOf(p).some(l => !l.delivered && !l.cancelled && !failed.has(l.id));
		const kept = fresh.filter(waits);
		const again = fresh.filter(p => !waits(p));
		for (const p of kept) deferred.push({ key: p.text.slice(0, 300), text: p.text, at: p.at ?? Date.now(), target: p.target, replyTo: p.replyTo, ...(p.refs?.length ? { refs: p.refs } : {}), sent: [], deferred: true, ...labels(p) });
		if (kept.length) { deps.log(`${kept.length} request(s) keep waiting on their workers after the restart`); save(); }
		if (again.length) deps.log(`replaying ${again.length} unanswered prompt(s) from before the restart`);
		for (const p of again) deliver(wrap(p.text), p.target ? { target: p.target, replyTo: p.replyTo, refs: p.refs, ...labels(p) } : undefined);
		return again.length;
	}

	/** After an orchestrator restart: every prompt still open (queued, in the lost turn, deferred) is delivered again once, oldest first. */
	function reopen(wrap: (text: string) => string): { replayed: number; texts: string[] } {
		const open = [...openDeferred(), ...(current && !current.done ? [current] : []), ...prompts]
			.filter((p, i, all) => all.indexOf(p) === i)
			.filter(p => !p.cancelled)
			.filter(p => {
				const done = isAnswered(p.replyTo);
				if (done) deps.log(`not replaying ${p.target ?? "-"} ${p.replyTo} after the restart: already answered`);
				return !done;
			})
			.sort((a, b) => a.at - b.at)
			.map(pending);
		prompts.length = 0;
		deferred.length = 0;
		closeTurn();
		current = undefined;
		return { replayed: replay(open, wrap), texts: open.map(p => p.text) };
	}

	/** Deferred prompts young enough that a restart should wait for their worker. */
	const waitingOnWorkers = () => openDeferred().filter(p => Date.now() - p.at <= DEFER_BLOCKS_RESTART_MS).length;

	/** The deferred prompts still waiting for their worker's answer (bgwork.ts ties a worker to one of them). */
	const deferredOpen = () => openDeferred().flatMap(p => (p.target ? [{ target: p.target, replyTo: p.replyTo, at: p.at }] : []));

	/** The silent-wait check gave up on these after its last reminder (hub/waitcheck.ts): they stop being listed and are not replayed. */
	function dropOpen(list: { target: string; replyTo?: string; at: number }[]): void {
		for (const r of list) for (const d of openDeferred()) if (d.target === r.target && d.replyTo === r.replyTo && d.at === r.at) d.done = true;
		save();
	}

	/** Requests waiting on background work, with the workers linked to them. */
	const openRequests = (): OpenRequest[] => openDeferred().flatMap(p => (p.target ? [{ target: p.target, ...(p.replyTo ? { replyTo: p.replyTo } : {}), at: p.at, workers: linksOf(p).map(({ id, description }) => ({ id, ...(description ? { description } : {}) })) }] : []));

	/** Messages of this conversation with a turn of their own still to come: an answer to another message there does not settle them. */
	const waitingIds = (target: string): string[] => [...openDeferred(), ...prompts.filter(p => !p.seen)].flatMap(p => (p.target && sameConv(p.target, target) ? [...new Set([...(p.refs ?? []), ...(p.replyTo ? [p.replyTo] : [])])] : []));

	return { deliver, settleSteered: burst.settle, sent, holdEarly, cancel, retarget, markAnswered, isAnswered, redeliverSteered: burst.redeliver, onPrompt, onText, settleTurn, onAnswer, replay, reopen, waitingOnWorkers, deferredOpen, turnAt, queued: () => prompts.slice(), current: () => current, linkOf: (id: string) => links.get(id), link, workersSpawned, workersDone, workersSteered, resultFor, openRequests, dropOpen, waitingIds };
}
