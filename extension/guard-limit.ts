// Limit-stop guard: what happens at a usage limit is the owner's setting (account rules, fallback chain), applied by the
// gateway when the limit is really hit. An orchestrator that writes "stop when the limit drops below N%" into a brief or a
// follow-up makes its session stop early on its own invention, so such a line is refused unless the owner's own words are
// quoted in a marked line (`Owner words: "..."`, Korean `오너 말: "..."`).

const LIMIT = /한도|사용량|할당량|quota|usage|limit/i;
// Limits and percentages of other things: a context window, tokens, memory, disk, a rate.
const OTHER = /(?:컨텍스트|토큰|메모리|디스크|속도)\s*(?:한도|창)?|\b(?:context|tokens?|memory|disk|rate)\b(?:\s+(?:limit|window))?/gi;
const PERCENT = /\d+(?:\.\d+)?\s*(?:%|퍼센트|percent)/i;
// A threshold: below, under, at or past it, what is left, or a plain condition ("when it is 5%").
const THRESHOLD = /아래|이하|미만|밑|떨어|내려|닿|넘|도달|되면|이면|남(?:은|아|으면|았)|\b(?:below|under|drops?|falls?|reach(?:es)?|hits?|exceeds?|less than|lower than|when|once|if)\b|[<≤]/i;
// Stopping, pausing or starting nothing new. "Not stopping" is removed first.
const NOT_STOP = /(?:멈추|중단하|중지하|쉬)지\s*(?:않|마)\S*|\b(?:do not|don't|never|no need to)\s+(?:stop|pause|halt)\b/gi;
const STOP = /멈추|멈춰|멈춥|멈출|멈춤|중단|중지|정지|종료|쉬(?:어|고|세요|는|며)|쉽니다|시작하지|시작\s*안|새\s*(?:일|작업|판단|시안)[^.\n]{0,12}(?:않|말)|\b(?:stop|pause|halt|rest|cease)\b|hold off|wrap up|\b(?:do not|don't)\s+(?:start|begin|take)\b|no new (?:work|task)/i;
const SEGMENTS = /\n|(?<=[.!?。])\s+|;/;
const QUOTE = /^[ \t>*-]*(?:owner words|오너 말)[ \t]*[:：][ \t]*["“「『][^"“”「」『』\n]*\S[^"“”「」『』\n]*["”」』]/im;

/** The first sentence of `text` that ties a stop, a pause or "no new work" to a usage limit reaching a percentage. */
export function limitStopLine(text: string): string | undefined {
	for (const raw of text.split(SEGMENTS)) {
		const line = raw.replace(OTHER, " ");
		if (!PERCENT.test(line) || !LIMIT.test(line) || !THRESHOLD.test(line)) continue;
		if (STOP.test(line.replace(NOT_STOP, " "))) return raw.trim().slice(0, 160);
	}
	return undefined;
}

// The texts a call hands to another agent: a session's brief and follow-ups, a conversation message, each worker prompt.
function outgoing(tool: string, input: any): string[] {
	const str = (value: unknown) => (typeof value === "string" ? value : "");
	if (tool === "dotz_lane") return [str(input?.brief), str(input?.text)];
	if (tool === "dotz_conv") return [str(input?.text)];
	if (tool !== "task") return [];
	const items: any[] = Array.isArray(input?.tasks) ? input.tasks : [input];
	return items.map(item => `${str(item?.prompt)}\n${str(item?.task)}\n${str(input?.context)}`);
}

/** The refusal for a call whose outgoing text carries a limit-stop line without the owner's quoted words; undefined = let it through. */
export function limitStopProblem(tool: string, input: any): string | undefined {
	for (const text of outgoing(tool, input)) {
		const line = limitStopLine(text);
		if (line && !QUOTE.test(text)) {
			return `orchestrator-guard: no stop, pause or "start nothing new" line tied to a usage limit ("${line}"). What happens at a limit is the owner's setting: at a real limit the gateway applies it and resumes the session, so leave the line out. A stop the owner really asked for goes through with their words quoted in a line of its own: Owner words: "<what the owner said, verbatim>".`;
		}
	}
	return undefined;
}
