// Nightly self-review. The gateway pre-digests the last 24h (owner corrections, failures, alerts, token use) so the
// model reviews a few hundred tokens of facts instead of reading logs, and skips the turn entirely on a quiet day.
import { existsSync, readdirSync, readFileSync, watch, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pushBackup, unstageSecrets } from "./backup.ts";
import { issueBlock } from "./choices.ts";
import { cfg, DATA_DIR, DEFAULTS, log, paths, writeAtomic } from "./config.ts";
import { CORRECTION, type Correction, SCAN_CHARS, TOPIC_NAMES, type Topic, topicOf } from "./corrections.ts";
import { isPeerMessage } from "./events.ts";
import { msg, withReplyLine } from "./i18n.ts";
import { LESSONS_MAX_BYTES } from "./prompt-budget.ts";
import { trackTimer } from "./shutdown.ts";
import { listSchedules, type Schedule } from "./schedule.ts";
import { auditSummaryLine } from "./token-audit.ts";

const DAY = 24 * 3600_000;
const WEEK = 7 * DAY;

function jsonl(file: string, since: number): Record<string, any>[] {
	if (!existsSync(file)) return [];
	return readFileSync(file, "utf8").split("\n").flatMap(l => {
		try {
			const e = JSON.parse(l);
			return Date.parse(e.ts) >= since ? [e] : [];
		} catch {
			return [];
		}
	});
}

function usage(sessionFile: string, since: number): string {
	if (!sessionFile || !existsSync(sessionFile)) return "n/a";
	let requests = 0;
	let read = 0;
	let write = 0;
	let busts = 0;
	for (const line of readFileSync(sessionFile, "utf8").split("\n")) {
		if (!line.includes('"usage"')) continue;
		try {
			const j = JSON.parse(line);
			const u = j.message?.usage;
			if (!u || Date.parse(j.timestamp) < since) continue;
			requests++;
			read += u.cacheRead ?? 0;
			write += u.cacheWrite ?? 0;
			if ((u.cacheWrite ?? 0) > 30_000 && (u.cacheRead ?? 0) < (u.cacheWrite ?? 0)) busts++;
		} catch {
			continue;
		}
	}
	return `${requests} requests, cache read ${Math.round(read / 1000)}K, cache write ${Math.round(write / 1000)}K, full rewrites >30K: ${busts}`;
}

const ledger = (since: number): Correction[] => jsonl(paths.corrections, since) as Correction[];
// The owner's messages of the last 24h that read like a correction or a repeat (the digest lists them; repeatedLessons matches lessons against them).
export const ownerCorrections = (now = Date.now()): string[] => ledger(now - DAY).map(e => e.text);

// The ledger's day by topic, biggest first: every topic keeps its count, and examples go to the topics in turns until the block is full, so a
// heavy day costs the same as a quiet one. The old list of 10 at 160 chars was about 1950 chars; this adds 650 (about 0.3K tokens).
export const CORRECTIONS_MAX_CHARS = 2600;
const EXAMPLES = 3;
const EXAMPLE_CHARS = 110;
export function correctionBlock(entries: readonly Correction[]): string[] {
	const groups = new Map<Topic, Correction[]>();
	for (const e of entries) groups.set(e.topic, [...(groups.get(e.topic) ?? []), e]);
	const topics = [...groups].sort((a, b) => b[1].length - a[1].length).map(([topic, list]) => ({ topic, list: list.toReversed(), shown: [] as string[] }));
	let room = CORRECTIONS_MAX_CHARS - topics.length * 40;
	for (let turn = 0; turn < EXAMPLES; turn++) {
		for (const t of topics) {
			const e = t.list[turn];
			if (!e) continue;
			const line = `  - ${e.text.replace(/\s+/g, " ").slice(0, EXAMPLE_CHARS)}${e.message_id ? ` (src: discord ${e.message_id})` : ` (src: ${e.conv} ${String(e.ts).slice(0, 16)})`}${e.attachments.length ? ` [${e.attachments.length} file]` : ""}`;
			if (line.length + 1 > room) continue;
			room -= line.length + 1;
			t.shown.push(line);
		}
	}
	return [`possible corrections or repeats (${entries.length}), by topic; whole text, attachments and the answer before each: ${paths.corrections}`, ...topics.flatMap(t => [`- ${t.topic}: ${t.list.length}`, ...t.shown])];
}

/** The live schedules for the nightly tidy (merge overlapping ones, drop finished ones); nothing when fewer than two exist. */
export function scheduleBlock(items: Schedule[], now: number): string[] {
	if (items.length < 2) return [];
	const line = (s: Schedule) => `- ${s.id} ${s.kind ?? "owner"} next ${s.at.slice(0, 16).replace("T", " ")}Z ${s.every_minutes ? `every ${s.every_minutes}m` : "once"} age ${Math.max(0, Math.floor((now - Date.parse(s.created)) / DAY))}d: ${s.text.replace(/\s+/g, " ").slice(0, 80)}`;
	return [`schedules (${items.length}):`, ...items.map(line)];
}

export function digest(sessionFile: string, now = Date.now()): string | undefined {
	const since = now - DAY;
	const inbox = jsonl(paths.inbox, since);
	const outbox = jsonl(paths.outbox, since);
	const owner = inbox.filter(e => (e.kind === "message" || e.kind === "lane_message") && !isPeerMessage(e));
	const laneTrouble = inbox.filter(e => e.kind === "lane_report" && /^\[lane (error|exited|paused)\]/.test(String(e.text)));
	if (!owner.length && !laneTrouble.length) return undefined;
	const logLines = existsSync(paths.log) ? readFileSync(paths.log, "utf8").split("\n").filter(l => Date.parse(l.slice(0, 24)) >= since) : [];
	const count = (re: RegExp) => logLines.filter(l => re.test(l)).length;
	const short = (t: unknown, n = 160) => String(t ?? "").replace(/\s+/g, " ").slice(0, n);
	const audit = auditSummaryLine(now);
	return [
		`owner messages: ${owner.length} (${[...new Set(owner.map(e => e.channel ?? e.source))].join(", ")})`,
		// The message id is the source the reflection cites in memory/observations.md.
		...correctionBlock(ledger(since)),
		`lane trouble (${laneTrouble.length}):`,
		...laneTrouble.slice(-8).map(e => `- ${e.lane}: ${short(e.text)}`),
		`alerts sent (${outbox.filter(e => e.target === "alert").length}):`,
		...outbox.filter(e => e.target === "alert").slice(-6).map(e => `- ${short(e.text)}`),
		`gateway: watchdog restarts ${count(/did not start a turn/)}, memory restarts ${count(/memory guard: .*restarting it/)}, orchestrator exits ${count(/orchestrator exited/)}, rotations ${count(/rotating to a fresh/)}, keepalives ${count(/keepalive \d/)}, send failures ${count(/send failed/)}, watch failures ${count(/^\S+ watch \S+ failed/)}`,
		// With the nightly token audit on, one summary line replaces the raw usage counters so each fact is counted once.
		...(audit ? [audit] : [`orchestrator tokens: ${usage(sessionFile, since)}`, ...laneUsage(since)]),
		...scheduleBlock(listSchedules(), now),
	].join("\n");
}

// Lanes are the expensive sessions (the earlier secretary's token-audit scans every tab, not just the secretary).
function laneUsage(since: number): string[] {
	if (!existsSync(paths.lanes)) return [];
	return readdirSync(paths.lanes).flatMap(name => {
		const file = join(paths.lanes, name, "lane.json");
		if (!existsSync(file)) return [];
		const u = usage(JSON.parse(readFileSync(file, "utf8")).sessionFile ?? "", since);
		return u === "n/a" || u.startsWith("0 requests") ? [] : [`lane ${name} tokens: ${u}`];
	});
}

// The lesson lines count by topic: a line can name its own with "(topic: ui)", else its words decide.
const TOPIC_TAG = /\(topic:\s*([a-z-]+)\)/i;
const BULLET = /^\s*[-*]\s/;
function lessonTopic(line: string): Topic {
	const tag = TOPIC_TAG.exec(line)?.[1].toLowerCase() as Topic | undefined;
	return tag && TOPIC_NAMES.includes(tag) ? tag : topicOf(line.replace(BROKEN, "").replace(ENFORCED, ""));
}
const lessonLines = (text: string): string[] => text.split("\n").filter(l => BULLET.test(l));
function proseByTopic(text: string): { prose: Map<Topic, number>; enforced: Set<Topic> } {
	const prose = new Map<Topic, number>(), enforced = new Set<Topic>();
	for (const line of lessonLines(text)) {
		const topic = lessonTopic(line);
		if (ENFORCED.test(line)) enforced.add(topic);
		else prose.set(topic, (prose.get(topic) ?? 0) + 1);
	}
	return { prose, enforced };
}
/** Topics where another prose lesson is refused: they hold prose and no line that names an enforcer. */
export function proseClosedTopics(text: string): Topic[] {
	const { prose, enforced } = proseByTopic(text);
	return [...prose.keys()].filter(t => t !== "other" && !enforced.has(t));
}

export type RejectedLesson = { line: string; topic: Topic; why: "prose" | "cap" };
// What a change to LESSONS.md may keep. A topic with prose and no enforcer cannot grow in prose lines (rewording and merging do not grow it, so
// they pass), and new lines cannot push the file past the one cap. Untouched lines are never removed: a file already over the cap only stops growing.
export function admitLessons(before: string, after: string): { text: string; rejected: RejectedLesson[] } {
	const known = new Set(lessonLines(before));
	const was = proseByTopic(before).prose, now = proseByTopic(after);
	const rejected: RejectedLesson[] = [];
	const added = lessonLines(after).filter(l => !known.has(l) && !ENFORCED.test(l));
	const over = new Map<Topic, number>();
	for (const line of added.toReversed()) {
		const topic = lessonTopic(line);
		if (topic === "other" || now.enforced.has(topic)) continue;
		const excess = (now.prose.get(topic) ?? 0) - Math.max(was.get(topic) ?? 0, 1) - (over.get(topic) ?? 0);   // the first line of a new topic is free
		if (excess <= 0) continue;
		over.set(topic, (over.get(topic) ?? 0) + 1);
		rejected.push({ line, topic, why: "prose" });
	}
	const without = (text: string, line: string) => text.replace(`${line}\n`, "").replace(line, "");
	let text = rejected.reduce((t, r) => without(t, r.line), after);
	for (const line of lessonLines(text).filter(l => !known.has(l)).toReversed()) {
		if (Buffer.byteLength(text) <= LESSONS_MAX_BYTES) break;
		text = without(text, line);
		rejected.push({ line, topic: lessonTopic(line), why: "cap" });
	}
	return { text, rejected };
}

// The file is written by the model's edit tool, so the gate reads what landed: the accepted text is the baseline, a refused line is taken back out
// and the session that wrote it is told why, once.
let acceptedLessons: string | undefined;
export function gateLessons(tell: (text: string) => void, reset = false): RejectedLesson[] {
	if (reset) acceptedLessons = undefined;
	const text = existsSync(paths.lessons) ? readFileSync(paths.lessons, "utf8") : "";
	if (acceptedLessons === undefined || text === acceptedLessons) {
		acceptedLessons = text;
		return [];
	}
	const r = admitLessons(acceptedLessons, text);
	acceptedLessons = r.text;
	if (r.rejected.length) {
		writeAtomic(paths.lessons, r.text);
		log(`lessons gate: refused ${r.rejected.length} line(s): ${r.rejected.map(x => `${x.why}: ${x.line.slice(0, 120)}`).join(" | ")}`);
		tell(msg().lessonsRefused(r.rejected, LESSONS_MAX_BYTES));
	}
	return r.rejected;
}

export type RepeatAlert = { key: string; topic: Topic; count: number; broken: number; examples: string[] };
// Three corrections repeating one complaint in 7 days, or a lesson found broken on two nights: the words have failed, so the gateway says so itself,
// one card per topic per 7 days. A shared topic is no repeat (repeatCluster counts within it). "other" holds no one subject, so it never counts; a
// broken lesson of no topic stands alone under its own key.
export function dueAlerts(entries: readonly Correction[], lessons: string, sent: Record<string, number>, now: number): RepeatAlert[] {
	const due = new Map<string, RepeatAlert>();
	const week = entries.filter(e => Date.parse(e.ts) >= now - WEEK && e.topic !== "other");
	for (const topic of new Set(week.map(e => e.topic))) {
		const cluster = repeatCluster(week.filter(e => e.topic === topic));
		if (cluster.length < 3) continue;
		due.set(topic, { key: topic, topic, count: cluster.length, broken: 0, examples: cluster.slice(-EXAMPLES).toReversed().map(e => e.text.replace(/\s+/g, " ").slice(0, 120)) });
	}
	for (const c of lessonChecks(lessons, []).filter(c => c.broken >= 2)) {
		const topic = lessonTopic(c.line);
		const key = topic === "other" ? `lesson:${c.line.slice(0, 60)}` : topic;
		const a = due.get(key) ?? { key, topic, count: 0, broken: 0, examples: [] };
		a.broken = Math.max(a.broken, c.broken);
		a.examples = [c.line.slice(0, 120), ...a.examples].slice(0, EXAMPLES);
		due.set(key, a);
	}
	return [...due.values()].filter(a => now - (sent[a.key] ?? -Infinity) >= WEEK);
}

const readSent = (): Record<string, number> => {
	try {
		return JSON.parse(readFileSync(paths.repeatAlerts, "utf8"));
	} catch {
		return {};
	}
};
/** Posts the due cards. It only proposes: opening the fix is the owner's answer on the card. A card that failed to post stays due. */
export async function sendRepeatAlerts(post: (text: string) => Promise<unknown>, now = Date.now()): Promise<RepeatAlert[]> {
	const sent = readSent();
	const lessons = existsSync(paths.lessons) ? readFileSync(paths.lessons, "utf8") : "";
	const due = dueAlerts(ledger(now - WEEK), lessons, sent, now);
	for (const a of due) {
		const m = msg();
		await post(`${m.repeatAlert(a)}\n\n${issueBlock(m.repeatAlertQuestion, m.repeatAlertOptions)}`);
		sent[a.key] = now;
		writeAtomic(paths.repeatAlerts, `${JSON.stringify(sent)}\n`);
	}
	return due;
}

// Local history of the files the bot edits itself (rules, lessons, identity, schedules), so a bad edit can be undone.
const SNAPSHOT = ["RULES.md", "LESSONS.md", "memory", "identity", "features", "schedules.json", "watches.json", "channel-setups.json", "config.json", "channels.json"];
export async function snapshot(): Promise<string | undefined> {
	const git = (...a: string[]) => Bun.$`git -C ${DATA_DIR} ${a}`.nothrow().quiet();
	if (!existsSync(join(DATA_DIR, ".git"))) {
		writeFileSync(join(DATA_DIR, ".gitignore"), ["*", ...SNAPSHOT.flatMap(f => [`!${f}`, `!${f}/**`]), "!.gitignore", ""].join("\n"));
		await git("init", "-q");
	}
	await git("add", "-A");
	// Off-machine copy is opt-in (`backup.remote` in config.json). Files that look like secrets stay out of the commit then.
	const remote = String((cfg as { backup?: { remote?: string } }).backup?.remote ?? "").trim();
	const flagged = remote ? await unstageSecrets(DATA_DIR) : [];
	const r = await git("-c", "user.name=dotz", "-c", "user.email=dotz@localhost", "commit", "-q", "-m", `snapshot ${new Date().toISOString().slice(0, 10)}`);
	log(`snapshot: ${r.exitCode === 0 ? "committed" : "no changes"}`);
	return remote ? pushBackup(DATA_DIR, remote, flagged) : undefined;
}

// Code picks removal/merge candidates in LESSONS.md, the model decides (stale >90 days, near-duplicates by token overlap).
const STALE_DAYS = 90;
const DUPLICATE_SIMILARITY = 0.6;
// A lesson line is dated [YYYY-MM-DD] or, as the nightly turn writes it, [MM-DD]: a year-less date is this year's, or last year's when that
// would lie in the future.
const LESSON_LINE = /^- \[(?:(\d{4})-)?(\d{2})-(\d{2})\]\s*(.*)$/;
const lessonYear = (y: string | undefined, mo: number, d: number, now: number): number => {
	if (y) return Number(y);
	const year = new Date(now).getUTCFullYear();
	return Date.UTC(year, mo - 1, d) > now + DAY ? year - 1 : year;
};
// A lesson carried by structure names its enforcer: "(enforced: <guard, test, lint or check>)". pstack's correct / encode-lessons-in-structure:
// a rule that keeps recurring is fixed where it cannot happen again, and the line says where.
const ENFORCED = /\(enforced:\s*[^)]+\)/i;
// Same tokens as OMH's duplicate check (lowercase alphanumeric/hangul runs of 2+); the date prefix is dropped so shared dates never count as overlap.
const tokens = (text: string): Set<string> => new Set(text.toLowerCase().match(/[0-9a-z가-힣]{2,}/g) ?? []);

export function lessonCandidates(text: string, now: number): { stale: string[]; duplicates: { a: string; b: string; score: number }[] } {
	const stale: string[] = [];
	const dated: { line: string; tokens: Set<string> }[] = [];
	for (const raw of text.split("\n")) {
		const line = raw.trim();
		const m = LESSON_LINE.exec(line);
		if (!m) continue;
		const [mo, d] = [Number(m[2]), Number(m[3])], y = lessonYear(m[1], mo, d, now);
		const at = Date.UTC(y, mo - 1, d);
		const back = new Date(at);
		if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) continue;
		if (now - at > STALE_DAYS * DAY) stale.push(line);
		dated.push({ line, tokens: tokens(m[4].replace(BROKEN, "").replace(ENFORCED, "")) });   // the trailers' dates and names are not the lesson
	}
	const duplicates: { a: string; b: string; score: number }[] = [];
	for (let i = 0; i < dated.length; i++) {
		for (let j = i + 1; j < dated.length; j++) {
			const [x, y] = [dated[i].tokens, dated[j].tokens];
			let shared = 0;
			for (const t of x) if (y.has(t)) shared++;
			const union = x.size + y.size - shared;
			const score = union ? shared / union : 0;
			if (score >= DUPLICATE_SIMILARITY) duplicates.push({ a: dated[i].line, b: dated[j].line, score: Math.round(score * 100) / 100 });
		}
	}
	return { stale, duplicates };
}

// Matching a lesson to today's corrections (pstack's correct: a rule broken again gets a structural fix). Words alone miss the same mistake said
// another way and catch a correction that only shares common words, so code does the cheap part and the nightly turn judges by meaning:
// - words are compared without Korean particles/endings and without common words, and a Hangul word also matches one sharing most of its
//   letter pairs ("체크아웃을" ~ "체크아웃했어"), so a lesson scores how much of it a correction repeats (likely = 0.4 or more, 2+ words);
// - every lesson with no enforcer is handed over when there were corrections, the likely ones first with their score, for the turn to decide;
// - a lesson the turn finds broken gets the date in "(broken: MM-DD, ...)", so a repeat across nights is counted, not re-guessed.
const STOP = new Set(["the", "a", "an", "to", "of", "and", "or", "is", "are", "be", "it", "its", "this", "that", "with", "for", "on", "in", "at", "as", "by", "from", "before", "after", "never", "not", "no", "do", "does", "did", "when", "once", "only", "each", "every", "his", "him", "he", "you", "your", "그", "이", "저", "것", "수", "좀", "또", "다시", "그냥", "이거", "그거", "저거", "왜", "뭐", "지금", "이번", "있는", "없는", "하는", "한", "할", "해", "하고", "했어", "했어요", "해요", "합니다", "하세요", "말고"]);
const PARTICLE = /(?:에서는|에게서|으로는|으로|에서|에게|까지|부터|처럼|보다|하고|이랑|랑|은|는|이|가|을|를|에|의|와|과|도|만|로|요|죠|네)$/;
const ENDING = /(?:했었어요|했었어|했어요|했어|했다|했음|하세요|하지마|하지|해서|해요|해야|하는|하고|하면|되면|됐어|된|하기|함|해|한|할)$/;
const HANGUL = /^[가-힣]+$/;
function stem(w: string): string {
	if (!HANGUL.test(w)) return w;
	for (let i = 0; i < 3; i++) {
		const next = w.replace(ENDING, "").replace(PARTICLE, "");
		if (next === w || next.length < 2) break;
		w = next;
	}
	return w;
}
/** The words of a text that carry meaning: lowercased, particles and endings stripped, common words dropped. */
export const meaningWords = (text: string): string[] => [...new Set((text.toLowerCase().match(/[0-9a-z가-힣]{2,}/g) ?? []).map(stem).filter(w => w.length >= 2 && !STOP.has(w)))];
const pairs = (w: string): Set<string> => new Set([...w].slice(1).map((c, i) => w[i] + c));
// Two words are the same word: equal, or both Hangul and one keeps at least two thirds of the other's letter pairs.
function sameWord(a: string, b: string): boolean {
	if (a === b) return true;
	if (!HANGUL.test(a) || !HANGUL.test(b) || a.length < 2 || b.length < 2) return false;
	const [x, y] = [pairs(a), pairs(b)], small = x.size <= y.size ? x : y, big = small === x ? y : x;
	let hit = 0;
	for (const p of small) if (big.has(p)) hit++;
	return small.size > 0 && hit / small.size >= 2 / 3;
}
const LIKELY = 0.4;
/** How much of a lesson one correction repeats: the share of its meaning words found there (0 when fewer than two match). */
export function lessonScore(lesson: string, correction: string): number {
	const own = meaningWords(lesson), said = meaningWords(correction);
	if (!own.length) return 0;
	const hit = own.filter(w => said.some(s => sameWord(w, s))).length;
	return hit >= 2 ? Math.round((hit / own.length) * 100) / 100 : 0;
}
// Words any complaint or request uses, whatever it is about: they can add to a match between two messages but never make one.
// The list holds stems: "이상해" reaches here as "이상", which CORRECTION alone would not catch.
const PLAIN = new Set(["이상", "그대", "그리고", "근데", "그래서", "전반적", "제대로", "수정", "구현", "개선", "확인", "처리", "기능", "부분", "문제", "해야", "되네", "하자", "해놔", "해줘", "해봐"]);
const plainWord = (w: string): boolean => PLAIN.has(w) || CORRECTION.test(w);
// Two messages make the same complaint when they share two or more meaning words, 0.4 or more of the shorter one's, and not only plain words.
export function sameComplaint(a: readonly string[], b: readonly string[]): boolean {
	const [small, big] = a.length <= b.length ? [a, b] : [b, a];
	const hit = small.filter(w => big.some(s => sameWord(w, s)));
	return hit.length >= 2 && hit.length / small.length >= LIKELY && !hit.every(plainWord);
}
/** The largest group of entries (oldest first) that all make the same complaint as each other: every pair must match, so a message that touches
 *  two others cannot chain them. Two different complaints in a topic stay two groups. */
export function repeatCluster<T extends { text: string }>(entries: readonly T[]): T[] {
	const words = entries.map(e => meaningWords(e.text.slice(0, SCAN_CHARS)));
	const near = words.map(() => new Set<number>());
	for (let i = 0; i < words.length; i++) {
		for (let j = i + 1; j < words.length; j++) {
			if (!sameComplaint(words[i], words[j])) continue;
			near[i].add(j);
			near[j].add(i);
		}
	}
	let best: number[] = [];
	for (const [i, linked] of near.entries()) {
		const group = [i];
		for (const j of linked) if (group.every(g => near[g].has(j))) group.push(j);
		if (group.length >= best.length) best = group;
	}
	return best.toSorted((x, y) => x - y).map(i => entries[i]);
}

const BROKEN = /\(broken:\s*([^)]*)\)/i;
export type LessonCheck = { line: string; score: number; broken: number };
/** Every lesson with no enforcer, with its best score against today's corrections and how many nights it was found broken; repeats first,
 *  then the likely ones by score. */
export function lessonChecks(text: string, corrections: readonly string[]): LessonCheck[] {
	const out: LessonCheck[] = [];
	for (const raw of text.split("\n")) {
		const line = raw.trim();
		const m = LESSON_LINE.exec(line);
		if (!m || ENFORCED.test(line)) continue;
		const words = m[4].replace(BROKEN, "");
		const score = Math.max(0, ...corrections.map(c => lessonScore(words, c)));
		const broken = (BROKEN.exec(line)?.[1] ?? "").split(",").map(s => s.trim()).filter(Boolean).length;
		out.push({ line, score, broken });
	}
	return out.sort((a, b) => b.broken - a.broken || b.score - a.score);
}
/** The lessons today's corrections most likely broke again (score 0.4 or more). */
export const repeatedLessons = (text: string, corrections: readonly string[]): string[] => lessonChecks(text, corrections).filter(c => c.score >= LIKELY).map(c => c.line);

const localMd = (now: number): string => { const d = new Date(now); return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
function candidateBlock(now: number, corrections: readonly string[] = []): string {
	const stale = existsSync(paths.observations) ? lessonCandidates(readFileSync(paths.observations, "utf8"), now).stale : [];
	// With corrections today, every unenforced lesson goes to the turn (LESSONS.md is capped, so this stays small); a lesson already broken on
	// two nights is listed even on a quiet day of matches, since it is a repeat by count, not by words.
	const checks = existsSync(paths.lessons) ? lessonChecks(readFileSync(paths.lessons, "utf8"), corrections) : [];
	const shown = corrections.length ? checks : checks.filter(c => c.broken >= 2);
	const closed = existsSync(paths.lessons) ? proseClosedTopics(readFileSync(paths.lessons, "utf8")) : [];
	return lessonBlock(now) + (closed.length ? msg().lessonGate(closed) : "") + (shown.length ? msg().lessonRepeats(shown.map(c => ({ ...c, likely: c.score >= LIKELY })), localMd(now)) : "") + (stale.length ? msg().staleObservations(stale) : "");
}

function lessonBlock(now: number): string {
	if (!existsSync(paths.lessons)) return "";
	const text = readFileSync(paths.lessons, "utf8");
	const { stale, duplicates } = lessonCandidates(text, now);
	const bytes = Buffer.byteLength(text);
	const over = bytes > LESSONS_MAX_BYTES ? `${bytes} bytes > cap ${LESSONS_MAX_BYTES} (hub/prompt-budget.ts)` : "";
	if (!stale.length && !duplicates.length && !over) return "";
	return msg().lessonCandidates(stale, duplicates.map(d => `${d.a}\n  ~ ${d.b} (${d.score})`), over);
}

export const reflectPrompt = (d: string, now = Date.now(), corrections: readonly string[] = [], recipe = ""): string => withReplyLine(msg().reflect(d, paths.lessons) + candidateBlock(now, corrections) + recipe);

if (import.meta.main && process.argv[2] === "--candidates" && process.argv[3]) {
	console.log(JSON.stringify(lessonCandidates(readFileSync(process.argv[3], "utf8"), Date.now()), null, 2));
}

// `note` tells a running turn what the lessons gate refused. It starts no turn: the 7 turns the refusal started in 7 days (2026-11-05, 1.7M tokens) all answered "-".
export function startReflection(deliver: (text: string) => void, sessionFile: () => string, post: (text: string) => Promise<unknown>, note: (text: string) => void, recipe: () => string): void {
	gateLessons(note, true);
	let gate: ReturnType<typeof setTimeout> | undefined;
	// The folder, not the file: an edit that replaces the file by rename ends a watch on the file itself.
	watch(DATA_DIR, (_, name) => {
		if (name !== "LESSONS.md") return;
		clearTimeout(gate);
		gate = setTimeout(() => gateLessons(note), 500);
		trackTimer("lessons-gate", gate);
	});
	const at = String((cfg as { reflect_at?: string }).reflect_at ?? DEFAULTS.reflect_at);
	if (at === "off") return;
	const [h, m] = at.split(":").map(Number);
	const next = () => {
		const d = new Date();
		d.setHours(h, m, 0, 0);
		if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
		return d.getTime() - Date.now();
	};
	const run = async () => {
		const alert = await snapshot().catch(e => (log(`snapshot failed: ${e}`), undefined));
		if (alert) deliver(`${alert}\n(위 내용을 오너에게 짧게 알려줘.)`);
		const d = digest(sessionFile());
		if (d) {
			log("reflection: delivering nightly self-review");
			deliver(reflectPrompt(d, Date.now(), ownerCorrections(), recipe()));
		} else log("reflection: quiet day, skipped");
		await sendRepeatAlerts(post).catch(e => log(`repeat alerts failed: ${e}`));
		trackTimer("reflection", setTimeout(run, next()));
	};
	trackTimer("reflection", setTimeout(run, next()));
}
