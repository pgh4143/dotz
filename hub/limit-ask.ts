// Owner-facing sibling of personal-ask.ts: true when an outgoing model-written message stops to ask the owner whether to go on
// because the remaining usage limit is low. What happens at a limit is the owner's setting, applied by the gateway, so the
// model neither stops early nor asks. A usage report without a question is left alone, and so is a budget gate refusal relayed
// to the owner; the gateway's own limit questions never reach this check (the caller passes model-written posts only).
// The question itself has to be about going on or stopping, and either name the limit (its percentage stated anywhere in the
// post) or follow a limit percentage within two sentences: a design question that shares a post with a usage line is not one.
const QUESTION = /[?？]|까요|나요|주세요|결정\s*(?:이\s*)?필요|decision needed/i;
const LIMIT = /한도|사용량|할당량|quota|usage|limit/i;
const OTHER = /(?:컨텍스트|토큰|메모리|디스크|속도)\s*(?:한도|창)?|\b(?:context|tokens?|memory|disk|rate)\b(?:\s+(?:limit|window))?/gi;
const PERCENT = /\d+(?:\.\d+)?\s*(?:%|퍼센트|percent)/i;
const GO_OR_STOP = /계속\s*(?:할|해|진행|갈|가)|멈추|멈출|멈춰|중단|중지|이어\s*(?:갈|가|서\s*할)|쉴까|\b(?:continue|keep going|go on|stop|pause|halt|carry on)\b/i;
const BUDGET_GATE = /예산|\bbudget\b|지금\s*(?:돌|실행)|run now|shrink|줄일까요/i;
const SEGMENTS = /\n|(?<=[.!?。])\s+/;

export const asksLimitStopInChat = (text: string): boolean => {
	if (BUDGET_GATE.test(text)) return false;
	const lines = text.replace(OTHER, " ").split(SEGMENTS).filter(line => line.trim());
	const stated = (line: string) => LIMIT.test(line) && PERCENT.test(line);
	if (!lines.some(stated)) return false;
	return lines.some((line, i) => QUESTION.test(line) && GO_OR_STOP.test(line) && (LIMIT.test(line) || lines.slice(Math.max(0, i - 2), i).some(stated)));
};
