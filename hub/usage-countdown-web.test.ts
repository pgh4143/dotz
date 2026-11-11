import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The time left until a usage window or the API budget resets (web/js/01-core.js leftText and rel, on the 사용량 screen), run on
// the real source text: rounded down to the two largest units, so 6 days 23 hours 59 minutes reads 6일 23시간, never 7일.
const core = readFileSync(join(import.meta.dir, "..", "web", "js", "01-core.js"), "utf8");
const fn = (name: string) => new RegExp(`^function ${name}\\b[\\s\\S]*?\\n}\\n`, "m").exec(core)![0];
process.env.TZ = "Asia/Seoul"; // the clock time is the browser's local time; pin it so the test reads the same anywhere
const NOW = Date.parse("2026-11-09T03:00:00Z"); // 오후 12시 KST
const FakeDate = class extends Date { static now = () => NOW };
const { leftText, rel } = new Function("Date", `${fn("leftText")}${fn("rel")}return { leftText, rel };`)(FakeDate) as { leftText: (ms: number) => string; rel: (at: number) => string };
const M = 60_000, H = 60 * M, D = 24 * H;

test("the time left is rounded down to days and hours, hours and minutes, or minutes", () => {
	expect(leftText(6 * D + 23 * H + 59 * M)).toBe("6일 23시간");
	expect(leftText(6 * D + 23 * H + 59 * M + 59_999)).toBe("6일 23시간");
	expect(leftText(7 * D)).toBe("7일");
	expect(leftText(D)).toBe("1일");
	expect(leftText(D - 1)).toBe("23시간 59분");
	expect(leftText(3 * H + 12 * M + 59_000)).toBe("3시간 12분");
	expect(leftText(H)).toBe("1시간");
	expect(leftText(H - 1)).toBe("59분");
	expect(leftText(59 * M)).toBe("59분");
	expect(leftText(M)).toBe("1분");
});

test("a reset says how long until it and at what local time (the date too when not today), and a reset at or past now says it is resetting", () => {
	expect(rel(NOW + 6 * D + 23 * H + 59 * M)).toBe("6일 23시간 후 초기화 (11월 16일 오전 11시 59분)");
	expect(rel(NOW + 59 * M + 59_000)).toBe("59분 후 초기화 (오후 12시 59분)");
	expect(rel(NOW + 2 * H + 18 * M)).toBe("2시간 18분 후 초기화 (오후 2시 18분)");
	expect(rel(NOW + 12 * H)).toBe("12시간 후 초기화 (11월 10일 오전 12시)");
	expect(rel(NOW + 11 * H + 5 * M)).toBe("11시간 5분 후 초기화 (오후 11시 5분)");
	expect(rel(NOW + 30_000)).toBe("1분 안에 초기화");
	expect(rel(NOW)).toBe("초기화 중");
	expect(rel(NOW - 5 * M)).toBe("초기화 중");
});
