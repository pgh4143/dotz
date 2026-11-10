import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSessionMark, findRoom, memberships } from "./jandi-session.ts";

type Answers = Record<string, unknown>;
const getOf = (answers: Answers) => async (path: string): Promise<unknown> => {
	if (!(path in answers)) throw new Error(`HTTP 404 ${path}`);
	return answers[path];
};

describe("reading the owner's session", () => {
	test("memberships keep only entries with a team and a member id", async () => {
		const got = await memberships(getOf({ "start-api/v4/account": { memberships: [{ teamId: 1, memberId: 2, teamName: "A" }, { teamId: 0, memberId: 3 }, null, { teamId: 4, memberId: 5 }] } }));
		expect(got).toEqual([{ teamId: 1, memberId: 2, teamName: "A" }, { teamId: 4, memberId: 5, teamName: "4" }]);
	});

	test("memberships come from account-api/v1/me, where name is the team's name", async () => {
		const got = await memberships(getOf({ "account-api/v1/me": { memberships: [{ teamId: 1, memberId: 2, name: "Team", domain: "team" }] }, "start-api/v4/account": { memberships: [{ teamId: 9, memberId: 9 }] } }));
		expect(got).toEqual([{ teamId: 1, memberId: 2, teamName: "Team" }]);
	});

	test("the v4 account record answers when account-api/v1/me fails or has no memberships", async () => {
		const v4 = { "start-api/v4/account": { memberships: [{ teamId: 4, memberId: 5, teamName: "B" }] } };
		expect(await memberships(getOf(v4))).toEqual([{ teamId: 4, memberId: 5, teamName: "B" }]);
		expect(await memberships(getOf({ ...v4, "account-api/v1/me": { invitations: [] } }))).toEqual([{ teamId: 4, memberId: 5, teamName: "B" }]);
	});

	test("the team's bot member without an entityId is found by its chat in the { chats } room list", async () => {
		const get = getOf({
			"start-api/v4/teams/9": { members: [{ id: 2, type: "human" }, { id: 7, type: "bot" }] },
			"start-api/v4/teams/9/bots": [{ id: 6, botType: "connect_bot" }],
			"start-api/v4/teams/9/rooms": { topics: [], chats: [{ id: 80, type: "chat", companionId: 6, members: [2, 6] }, { id: 70, type: "chat", companionId: 7, members: [2, 7] }] },
		});
		expect(await findRoom(get, 9, 2)).toEqual({ member_id: 2, bot_id: 7, room_id: 70 });
	});

	test("the team's bot member gives the bot id and the room id", async () => {
		const get = getOf({ "start-api/v4/teams/9": { members: [{ id: 2, type: "user" }, { id: 7, type: "bot", entityId: 70 }] } });
		expect(await findRoom(get, 9, 2)).toEqual({ member_id: 2, bot_id: 7, room_id: 70 });
	});

	test("the room and bot lists answer when the team record has no bot, and a connector is never taken for the JANDI bot", async () => {
		const get = getOf({
			"start-api/v4/teams/9": { members: [] },
			"start-api/v4/teams/9/rooms": [{ id: 80, type: "chat", companionId: 6, members: [2, 6] }, { id: 77, type: "chat", companionId: 5, members: [2, 5] }],
			"start-api/v4/teams/9/bots": [{ id: 6, botType: "connect_bot" }, { id: 5, botType: "jandi_bot" }],
		});
		expect(await findRoom(get, 9, 2)).toEqual({ member_id: 2, bot_id: 5, room_id: 77 });
	});

	test("odd or empty answers are a plain error", async () => {
		await expect(findRoom(getOf({ "start-api/v4/teams/9": "oops", "start-api/v4/teams/9/rooms": {}, "start-api/v4/teams/9/bots": [] }), 9, 2)).rejects.toThrow();
		await expect(memberships(getOf({ "start-api/v4/account": [] }))).resolves.toEqual([]);
	});
});

describe("the expiry mark", () => {
	let dir: string;
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "jandi-mark-"));
		mkdirSync(join(dir, "messengers"));
	});
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	test("one alert per loss, kept over a restart, cleared by the next good tick", () => {
		const alerts: string[] = [];
		const mark = createSessionMark(dir, t => alerts.push(t));
		expect(mark.state()).toBe("ok");
		mark.lost();
		mark.lost();
		expect(alerts).toHaveLength(1);
		expect(mark.state()).toBe("lost");
		const restarted = createSessionMark(dir, t => alerts.push(t));
		restarted.lost();
		expect(alerts).toHaveLength(1);
		restarted.ok();
		expect(restarted.state()).toBe("ok");
		expect(existsSync(join(dir, "messengers", "jandi-session.json"))).toBe(false);
		restarted.lost();
		expect(alerts).toHaveLength(2);
	});
});
