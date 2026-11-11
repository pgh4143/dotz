// A model-written chat message that stops to ask the owner whether to go on because the remaining usage limit is low is caught
// (hub/limit-ask.ts) and the orchestrator is steered, on the same send path as the personal-data ask. Nothing leaves the test data folder.
import { afterEach, expect, spyOn, test } from "bun:test";
import { msg } from "./i18n.ts";
import { asksLimitStopInChat } from "./limit-ask.ts";
import * as orchestrator from "./orchestrator.ts";
import { out } from "./outbound.ts";

test("a question about continuing or stopping at a low usage limit matches; reports, gateway questions and other percentages do not", () => {
	for (const text of [
		"Fable 7일 한도가 12% 남았어요. 계속할까요, 여기서 멈출까요?",
		"The weekly limit is at 12%. Should I keep going or stop here?",
		"한도가 5%라 새 일을 멈추는 게 좋을까요?",
		"한도가 빠르게 줄어서 새 작업은 잠시 멈춰 뒀어요.\n- 7일 한도: 20% → 12% 남았어요.\n- 지금까지 한 것은 파일로 남아 있어요.\n- 초기화는 다음 주예요.\n\n결정: 남은 한도로 리뷰를 어떻게 이어갈까요?\n**1) 일부만**\n**2) 끝까지**",
		"7일 한도가 12% 남았어요. 남은 화면은 여섯 묶음이에요.\n\n결정: 여기서 멈출까요, 계속할까요?",
	]) expect([text, asksLimitStopInChat(text)]).toEqual([text, true]);
	for (const text of [
		"7일 한도 20% 남음",
		"The weekly limit is at 12%; I am continuing.",
		"한도에 걸려서 3시간 쉬어야 해요. 계속 기다릴까요?",
		"5h window 12% left; run now, wait for the reset, or shrink the job?",
		"테스트 커버리지 80%에서 계속할까요?",
		"컨텍스트 5% 남았어요. 계속할까요?",
		"홈 묶음을 끝냈어요. 시안 둘 중 어느 쪽으로 진행할까요?\n- 사용량: 7일 한도 10% 남았어요.",
		"사용량: 7일 한도 10% 남았어요.\n목록 머리는 시안 둘 중 어느 쪽으로 할까요? 계속 볼 화면은 여섯 개예요.",
		"끝냈어요. 파일을 확인해 주세요. 7일 한도는 12% 남았고 다음 묶음을 진행해요.",
	]) expect([text, asksLimitStopInChat(text)]).toEqual([text, false]);
});

const steered = spyOn(orchestrator, "steer").mockImplementation(() => true);
afterEach(() => steered.mockClear());

test("out(): a model-written low-limit question steers the orchestrator; a gateway post and a plain report do not", async () => {
	await out("web", "The weekly limit is at 12%. Should I keep going or stop here?");
	expect(steered.mock.calls.map(c => c[0])).toEqual([msg().limitStopAskNote]);
	steered.mockClear();
	await out("web", "What is your home address?");
	expect(steered.mock.calls.map(c => c[0])).toEqual([msg().personalAskNote]);
	steered.mockClear();
	await out("web", "The weekly limit is at 12%. Should I keep going or stop here?", undefined, { source: "gateway" });
	await out("web", "The weekly limit is at 12%, so the job runs as planned.");
	expect(steered).not.toHaveBeenCalled();
});
