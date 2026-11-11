import { expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { paths } from "./config.ts";
import type { Correction } from "./corrections.ts";
import type { Schedule } from "./schedule.ts";
import { admitLessons, correctionBlock, CORRECTIONS_MAX_CHARS, digest, dueAlerts, gateLessons, lessonCandidates, lessonChecks, lessonScore, proseClosedTopics, scheduleBlock, reflectPrompt, repeatedLessons, sendRepeatAlerts } from "./reflect.ts";

const DAY = 24 * 3600_000;
const now = Date.UTC(2026, 9, 19);
const correction = (text: string, topic: Correction["topic"], ts = new Date(now - 3600_000).toISOString(), message_id?: string): Correction => ({ ts, topic, conv: "web", text, attachments: [], previous: "", ...(message_id ? { message_id } : {}) });

test("stale: exactly 90 days old is kept, 91 days is flagged", () => {
	const exact = "- [2026-07-21] exactly ninety days";
	const over = "- [2026-07-20] ninety-one days";
	expect(now - Date.UTC(2026, 6, 21)).toBe(90 * DAY);
	expect(lessonCandidates(`${exact}\n${over}`, now).stale).toEqual([over]);
});

test("duplicates: jaccard 0.6 is flagged, below is not", () => {
	// shared aa bb cc; 3 of 5 = 0.6
	const a = "- [2026-10-01] aa bb cc dd";
	const b = "- [2026-10-02] aa bb cc ee";
	expect(lessonCandidates(`${a}\n${b}`, now).duplicates).toEqual([{ a, b, score: 0.6 }]);
	// 3 of 6 = 0.5
	expect(lessonCandidates(`${a}\n- [2026-10-02] aa bb cc ee ff`, now).duplicates).toEqual([]);
});

test("dates do not count as overlap and tokens are case-insensitive", () => {
	expect(lessonCandidates("- [2026-10-01] one\n- [2026-10-01] two", now).duplicates).toEqual([]);
	expect(lessonCandidates("- [2026-10-01] Restart Gateway\n- [2026-10-02] restart gateway", now).duplicates).toHaveLength(1);
});

test("the digest cites the Discord message id of an owner correction, the source of an observation line", () => {
	const had = existsSync(paths.inbox) ? readFileSync(paths.inbox, "utf8") : undefined;
	const at = new Date(now - 3600_000).toISOString();
	writeFileSync(paths.inbox, `${JSON.stringify({ ts: at, kind: "message", channel: "chat", message_id: "1500000000001767915", text: "아니 그거 하지 마" })}\n`);
	writeFileSync(paths.corrections, `${JSON.stringify(correction("아니 그거 하지 마", "misread", at, "1500000000001767915"))}\n`);
	try {
		expect(digest("", now)).toContain("  - 아니 그거 하지 마 (src: discord 1500000000001767915)");
	} finally {
		rmSync(paths.corrections, { force: true });
		if (had === undefined) rmSync(paths.inbox);
		else writeFileSync(paths.inbox, had);
	}
});

test("observations older than 90 days are handed to the reflection for deletion", () => {
	const had = readFileSync(paths.observations, "utf8");
	const old = "- [2026-07-01] cond: a | reaction: \"b\" (src) | next: c";
	const fresh = "- [2026-10-18] cond: d | reaction: \"e\" (src) | next: f";
	writeFileSync(paths.observations, `${had}${old}\n${fresh}\n`);
	try {
		const p = reflectPrompt("digest", now);
		expect(p).toContain(old);
		expect(p).not.toContain(fresh);
	} finally {
		writeFileSync(paths.observations, had);
	}
});

test("undated, malformed and impossible-date lines are ignored", () => {
	const text = ["# Lessons", "- no date here, aa bb cc dd", "- [2026-7-1] short month aa bb cc dd", "- [2026-13-45] aa bb cc dd", "- [2026-02-30] aa bb cc dd", "- [2020-01-01]", ""].join("\n");
	const r = lessonCandidates(text, now);
	expect(r.stale).toEqual(["- [2020-01-01]"]);
	expect(r.duplicates).toEqual([]);
});

test("the [MM-DD] lines the nightly turn writes are lessons too: a year-less date is this year's, or last year's when it would be ahead", () => {
	const at = Date.UTC(2026, 9, 28);
	expect(lessonCandidates("- [07-01] keep the gateway log short and plain\n- [07-02] keep the gateway log short and plain", at).duplicates).toHaveLength(1);
	expect(lessonCandidates("- [12-30] a lesson from last december", at).stale).toEqual(["- [12-30] a lesson from last december"]);
	expect(lessonCandidates("- [10-20] a lesson from last week", at).stale).toEqual([]);
});

test("a lesson broken again by a correction today is listed unless its line names an enforcer", () => {
	const lessons = ["- [10-21] Never git checkout a file that holds uncommitted work", "- [10-22] Read the notices before saying something waits (enforced: hub/notices.ts check)", "- [10-23] short one"].join("\n");
	const said = ["왜 또 git checkout 했어? 그 file uncommitted work 날아갔잖아", "notices read before saying waits, again"];
	expect(repeatedLessons(lessons, said)).toEqual(["- [10-21] Never git checkout a file that holds uncommitted work"]);
	expect(repeatedLessons(lessons, ["오늘은 다른 얘기"])).toEqual([]);
});

test("a correction said with other particles and endings still matches the lesson; one that shares only common words does not", () => {
	const lesson = "다른 사람 작업이 있는 파일은 체크아웃하지 마세요";
	expect(lessonScore(lesson, "또 체크아웃했어? 작업 파일 날아갔잖아")).toBeGreaterThanOrEqual(0.4);
	expect(lessonScore(lesson, "왜 또 이거 다시 했어요 지금 좀 해요")).toBe(0);
	expect(lessonScore("Read the notices before saying something waits", "the before and saying")).toBe(0);
});

test("every unenforced lesson is checked: broken nights first, then the likely ones by score; an enforced line is left out", () => {
	const text = [
		"- [10-20] 알림을 읽고 나서 기다린다고 말하세요",
		"- [10-21] 다른 사람 작업이 있는 파일은 체크아웃하지 마세요",
		"- [10-22] 재시작 전에 커밋 시각을 비교하세요 (broken: 10-23, 10-25)",
		"- [10-23] 워커 브리프에 전체 테스트를 넣으세요 (enforced: hub/laneprompt.ts check)",
	].join("\n");
	const c = lessonChecks(text, ["또 체크아웃했어? 작업 파일 날아갔잖아"]);
	expect(c.map(x => [x.line.slice(0, 8), x.broken, x.score >= 0.4])).toEqual([["- [10-22", 2, false], ["- [10-21", 0, true], ["- [10-20", 0, false]]);
	expect(repeatedLessons(text, ["또 체크아웃했어? 작업 파일 날아갔잖아"])).toEqual(["- [10-21] 다른 사람 작업이 있는 파일은 체크아웃하지 마세요"]);
});

test("the nightly prompt hands over every unenforced lesson on a day with corrections, and on a day without only those broken on 2+ nights", () => {
	const had = existsSync(paths.lessons) ? readFileSync(paths.lessons, "utf8") : undefined;
	const twice = "- [10-22] 재시작 전에 커밋 시각을 비교하세요 (broken: 10-23, 10-25)", once = "- [10-21] 다른 사람 작업이 있는 파일은 체크아웃하지 마세요";
	writeFileSync(paths.lessons, `# Lessons\n${once}\n${twice}\n`);
	try {
		const at = Date.UTC(2026, 9, 28);   // after the lessons' dates, so none of them reads as last year's (stale)
		const withCorr = reflectPrompt("digest", at, ["또 체크아웃했어? 작업 파일 날아갔잖아"]);
		expect(withCorr).toContain(`${twice} [broken 2]`);
		expect(withCorr).toMatch(/체크아웃하지 마세요 \[likely \d/);
		const quiet = reflectPrompt("digest", at, []);
		expect(quiet).toContain(`${twice} [broken 2]`);
		expect(quiet).not.toContain(once);
	} finally {
		if (had === undefined) rmSync(paths.lessons, { force: true }); else writeFileSync(paths.lessons, had);
	}
});

test("trailer dates are not lesson words: two lessons sharing only (broken: ...) dates are no duplicates", () => {
	expect(lessonCandidates("- [10-01] alpha beta (broken: 10-02, 10-03)\n- [10-04] gamma delta (broken: 10-02, 10-03)", now).duplicates).toEqual([]);
});

test("a heavy day groups every topic with its count and stays inside the block's size", () => {
	const topics = ["ui", "copy", "stalled", "not-applied", "misread", "duplicate", "no-card", "linebreak", "missing-output", "ignored-setting"] as const;
	const day = Array.from({ length: 100 }, (_, i) => correction(`${i}번 메시지 ${"가".repeat(300)}`, topics[i % 3 === 0 ? 0 : i % topics.length]));
	const block = correctionBlock(day).join("\n");
	expect(block.length).toBeLessThanOrEqual(CORRECTIONS_MAX_CHARS + 200);
	expect(block).toContain("(100), by topic");
	for (const t of topics) expect(block).toMatch(new RegExp(`^- ${t}: \\d+$`, "m"));
	expect(block.indexOf("- ui:")).toBeLessThan(block.indexOf("- copy:"));
});

test("three corrections on one topic raise exactly one alert, and the same topic stays quiet for 7 days", async () => {
	const ts = [3, 2, 1].map(d => new Date(now - d * DAY).toISOString());
	writeFileSync(paths.corrections, `${ts.map((t, i) => JSON.stringify(correction(`여백이 이상함 ${i}`, "ui", t))).join("\n")}\n`);
	const posted: string[] = [];
	const post = async (text: string) => void posted.push(text);
	try {
		expect((await sendRepeatAlerts(post, now)).map(a => a.key)).toEqual(["ui"]);
		expect(await sendRepeatAlerts(post, now + DAY)).toEqual([]);
		expect(posted).toHaveLength(1);
		expect(posted[0]).toContain("여백이 이상함 2");
		expect(posted[0]).toMatch(/^결정: /m);
		expect(posted[0]).toMatch(/^\*\*1\) /m);
	} finally {
		rmSync(paths.corrections, { force: true });
		rmSync(paths.repeatAlerts, { force: true });
	}
});

test("a repeat card is due at 3 in 7 days and not at 2, older ones do not count, and the 7 days reopen", () => {
	const at = (d: number) => new Date(now - d * DAY).toISOString();
	const rows = [correction("여백이 이상함", "ui", at(1)), correction("여백이 또 이상함", "ui", at(2))];
	expect(dueAlerts(rows, "", {}, now)).toEqual([]);
	expect(dueAlerts([...rows, correction("여백 왜 이상함", "ui", at(8))], "", {}, now)).toEqual([]);
	expect(dueAlerts([...rows, correction("여백이 이상함", "other", at(1)), correction("여백이 이상함", "other", at(1))], "", {}, now)).toEqual([]);
	const three = [...rows, correction("여백 왜 이상함", "ui", at(3))];
	expect(dueAlerts(three, "", { ui: now - 6 * DAY }, now)).toEqual([]);
	expect(dueAlerts(three, "", { ui: now - 7 * DAY }, now).map(a => a.count)).toEqual([3]);
});

test("four messages that only share a topic word raise no card, whatever the conversation", () => {
	const rows = [
		correction("전체적으로 검색 결과 ui를 개선하는 게 목적임. 지금은 너무 밋밋하게만 나오고 있어", "ui"),
		correction("사진첩을 폴더별로 나누고 따로 설정하게 하자. 시안 먼저 디자인 만들어봐", "ui"),
		{ ...correction("그리고 달력 띄우면 바로 닫히더라. 설정 아이콘도 누르면 메뉴가 뜨다가 사라지는데 수정해야함. 스크롤도 제대로 구현해야함", "ui"), conv: "lane:other-app" },
		{ ...correction("첫 화면에서는 제목 앞 초록색 아이콘만 없애면 될듯. 나머지는 유지하고", "ui"), conv: "lane:other-app" },
	];
	expect(dueAlerts(rows, "", {}, now)).toEqual([]);
});

test("the same complaint said three ways fires across conversations, and the card shows that complaint alone", () => {
	const rows = [
		correction("설정 화면 저장 버튼이 여전히 안 눌려", "ui"),
		correction("상단 메뉴 정렬 다시 맞춰봐", "ui"),
		{ ...correction("저장 버튼 또 안 눌림. 설정 화면에서", "ui"), conv: "lane:work" },
		correction("왜 저장 버튼이 안 눌리냐", "ui"),
	];
	const [a, ...more] = dueAlerts(rows, "", {}, now);
	expect(more).toEqual([]);
	expect([a.key, a.count]).toEqual(["ui", 3]);
	expect(a.examples).toEqual([rows[3].text, rows[2].text, rows[0].text]);
});

test("words any complaint uses make no repeat, and two complaints linked by a third stay apart", () => {
	const plain = ["메뉴가 너무 이상해 왜 안되냐", "색상이 너무 이상해 왜 안되냐", "간격이 너무 이상해 왜 안되냐"];
	expect(dueAlerts(plain.map(t => correction(t, "ui")), "", {}, now)).toEqual([]);
	const chain = ["저장 버튼 달력 위치", "달력 위치 사진 목록", "사진 목록 검색 결과"];
	expect(dueAlerts(chain.map(t => correction(t, "ui")), "", {}, now)).toEqual([]);
});

test("a lesson broken on two nights raises a card under its topic, merged with that topic's corrections; an enforced one does not", () => {
	const broken = "- [10-02] Keep the icon spacing even (broken: 10-03, 10-05)";
	const a = dueAlerts([], broken, {}, now);
	expect(a.map(x => [x.key, x.broken])).toEqual([["ui", 2]]);
	const rows = ["여백이 이상함", "여백이 또 이상함", "여백 왜 이상함"].map(t => correction(t, "ui"));
	expect(dueAlerts(rows, broken, {}, now).map(x => [x.key, x.count, x.broken])).toEqual([["ui", 3, 2]]);
	expect(dueAlerts([], `${broken} (enforced: hub/x.test.ts)`, {}, now)).toEqual([]);
	expect(dueAlerts([], "- [10-02] Sign the tag (broken: 10-03, 10-05)", {}, now).map(x => x.key)).toEqual(["lesson:- [10-02] Sign the tag (broken: 10-03, 10-05)"]);
});

test("a topic with prose and no enforcer refuses more prose; an enforced line, a rewording and another topic pass", () => {
	const before = "# Lessons\n- [10-01] Keep the icon spacing even\n";
	const more = "- [10-02] Compare the layout at both widths";
	expect(proseClosedTopics(before)).toEqual(["ui"]);
	const refused = admitLessons(before, `${before}${more}\n`);
	expect(refused.text).toBe(before);
	expect(refused.rejected).toEqual([{ line: more, topic: "ui", why: "prose" }]);
	const enforced = `${before}${more} (enforced: hub/layout.test.ts)\n`;
	expect(admitLessons(before, enforced)).toEqual({ text: enforced, rejected: [] });
	const opened = `${enforced}- [10-03] Check the icon size\n`;
	expect(admitLessons(enforced, opened).rejected).toEqual([]);
	const reworded = "# Lessons\n- [10-01] Keep every icon spacing even\n";
	expect(admitLessons(before, reworded).rejected).toEqual([]);
	const other = `${before}- [10-02] Sign the release tag\n`;
	expect(admitLessons(before, other).rejected).toEqual([]);
	const tagged = `${before}- [10-02] Sign the release tag (topic: ui)\n`;
	expect(admitLessons(before, tagged).rejected.map(r => r.topic)).toEqual(["ui"]);
});

test("the first prose line of a new topic is free and the second is not", () => {
	const after = "- [10-01] Keep the icon spacing even\n- [10-02] Compare the layout at both widths\n";
	expect(admitLessons("", after).rejected.map(r => r.line)).toEqual(["- [10-02] Compare the layout at both widths"]);
});

test("new lines cannot pass the one cap, while a file already over it keeps its lines", () => {
	const old = `- [10-01] ${"x ".repeat(1600)}\n`;
	const line = "- [10-02] Sign the release tag";
	const r = admitLessons(old, `${old}${line}\n`);
	expect(r.text).toBe(old);
	expect(r.rejected).toEqual([{ line, topic: "other", why: "cap" }]);
	expect(admitLessons(`${old}- [10-03] a\n`, old).rejected).toEqual([]);
});

test("the gate takes a refused line back out of the file and tells the session once; the prompt names the closed topics", () => {
	const before = "# Lessons\n- [10-01] Keep the icon spacing even\n";
	const more = "- [10-02] Compare the layout at both widths";
	writeFileSync(paths.lessons, before);
	const told: string[] = [];
	try {
		gateLessons(t => told.push(t), true);
		writeFileSync(paths.lessons, `${before}${more}\n`);
		expect(gateLessons(t => told.push(t)).map(r => r.line)).toEqual([more]);
		expect(readFileSync(paths.lessons, "utf8")).toBe(before);
		expect(gateLessons(t => told.push(t))).toEqual([]);
		expect(told).toHaveLength(1);
		expect(told[0]).toContain(more);
		expect(reflectPrompt("digest", now)).toContain("ui");
	} finally {
		rmSync(paths.lessons, { force: true });
	}
});

test("the digest counts the owner's messages, not a peer gateway's", () => {
	const had = existsSync(paths.inbox) ? readFileSync(paths.inbox, "utf8") : undefined;
	const at = new Date(now - 3600_000).toISOString();
	const message = (extra: Record<string, unknown>) => `${JSON.stringify({ ts: at, kind: "message", source: "web", channel: "web", author: "ddotz@github", ...extra })}\n`;
	const peer = message({ via: "맥북", text: "맥북: 2번 정리를 main에 올렸어요." });
	try {
		writeFileSync(paths.inbox, peer + message({ text: "이거 고쳐" }) + message({ via: "맥북", channel: "mail:inbox", text: "답장 초안 작성해." }));
		expect(digest("", now)).toContain("owner messages: 2 (");
		writeFileSync(paths.inbox, peer);
		expect(digest("", now)).toBeUndefined();
	} finally {
		if (had === undefined) rmSync(paths.inbox);
		else writeFileSync(paths.inbox, had);
	}
});

test("the nightly data lists schedules only when two or more are live, each in one short line", () => {
	const now = Date.parse("2026-11-11T00:00:00Z");
	const mk = (id: string, extra: Partial<Schedule> = {}): Schedule => ({ id, text: "점검".repeat(60), at: "2026-11-11T03:30:00.000Z", created: "2026-11-08T00:00:00.000Z", ...extra });
	expect(scheduleBlock([], now)).toEqual([]);
	expect(scheduleBlock([mk("a")], now)).toEqual([]);
	const block = scheduleBlock([mk("a", { kind: "check" }), mk("b", { every_minutes: 60 })], now);
	expect(block[0]).toBe("schedules (2):");
	expect(block[1]).toBe(`- a check next 2026-11-11 03:30Z once age 3d: ${"점검".repeat(40)}`);
	expect(block[2]).toContain("- b owner next");
	expect(block[2]).toContain("every 60m");
});
