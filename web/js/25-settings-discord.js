// 설정 → Discord: the bot connection (token, server id, owner id; GET/PUT/DELETE /api/discord/connection, POST .../check, hub/discord-connection.ts)
// and what also goes to Discord by conversation (GET/PUT /api/discord/post, hub/discord-post.ts; the per-class switches are in 설정 → 앱과 알림). The web app always gets everything; a switch that is off
// keeps that kind on the web only. The switches show once Discord is enabled; the gateway reads the connection only at start, so a change
// waits for a restart (restart_needed).
const DP_KINDS = [["chat", "대화 답장", "내가 Discord에서 묻지 않은 대화의 답"], ["lanes", "세션 보고", "세션이 올리는 진행·완료 보고"], ["worklog", "작업내역", "작업 기록 메시지"], ["web_lanes", "웹에서 시작한 세션", "웹이나 터미널에서 시작한 세션도 Discord에 채널을 만들어요"]];
const DP = { v: null };
const DCS = { v: null, fail: "", err: "", chk: null, asked: false, advOpen: false,
  guild: input({ inputmode: "numeric", placeholder: "예: 123456789012345678", name: "discord-guild" }),
  owner: input({ inputmode: "numeric", placeholder: "예: 123456789012345678", name: "discord-owner" }),
  tok: input({ type: "password", autocomplete: "new-password", name: "discord-token", placeholder: "봇 토큰" }) };
for (const f of [DCS.guild, DCS.owner]) f.addEventListener("input", () => { f.dataset.dirty = "1"; });
function dcFill() {
  if (!DCS.v) return;
  if (!DCS.guild.dataset.dirty) DCS.guild.value = DCS.v.guild;
  if (!DCS.owner.dataset.dirty) DCS.owner.value = DCS.v.owner_id;
}
async function loadDiscord() {
  DCS.asked = true;
  try { DCS.v = await api("/api/discord/connection"); DCS.fail = ""; } catch (e) { DCS.v = null; DCS.fail = e.message; }
  if (DCS.v && DCS.v.enabled) { try { DP.v = await api("/api/discord/post"); } catch { DP.v = null; } }
  dcFill();
  if (current === "discord") renderDiscord();
}
async function dpSet(k, on) {
  const was = DP.v[k];
  DP.v = { ...DP.v, [k]: on }; renderDiscord();
  try { DP.v = await api("/api/discord/post", "PUT", { [k]: on }); } catch (e) { DP.v = { ...DP.v, [k]: was }; toast(e.message, true); }
  renderDiscord();
}
async function dcSave(btn) {
  const body = {}, tok = DCS.tok.value.trim(), guild = DCS.guild.value.trim(), owner = DCS.owner.value.trim();
  if (tok) body.token = tok;
  if (guild && guild !== DCS.v.guild) body.guild = guild;
  if (owner && owner !== DCS.v.owner_id) body.owner_id = owner;
  if (!Object.keys(body).length) { DCS.err = "바꾼 값이 없어요"; return renderDiscord(); }
  let saved = false;
  await busy(btn, async () => {
    try {
      DCS.v = await api("/api/discord/connection", "PUT", body);
      DCS.err = ""; DCS.chk = null; DCS.tok.value = "";
      delete DCS.guild.dataset.dirty; delete DCS.owner.dataset.dirty;
      dcFill();
      saved = true;
    } catch (e) { DCS.err = e.message; }
  });
  renderDiscord();
  if (saved) stFlash("#discord [data-ms-save]");
}
async function dcCheck(btn) {
  await busy(btn, async () => {
    DCS.chk = await api("/api/discord/connection/check", "POST", DCS.tok.value.trim() ? { token: DCS.tok.value.trim() } : {});
    if (DCS.chk.ok) DCS.v = await api("/api/discord/connection");
  });
  renderDiscord();
}
async function dcClear(btn) {
  if (!await ask("봇 토큰 삭제", "저장된 봇 토큰을 삭제해요. 게이트웨이를 다시 시작하면 Discord 연결이 끊겨요.", "삭제", true)) return;
  await busy(btn, async () => { DCS.v = await api("/api/discord/connection", "DELETE"); DCS.chk = null; DCS.err = ""; });
  renderDiscord();
}
const dcRestart = btn => busy(btn, async () => {
  await api("/api/update/restart", "POST", {});
  toast("작업이 끝나면 다시 켜져요. 이 화면은 자동으로 다시 연결돼요");
});
function dcStatus() {
  const v = DCS.v;
  if (!v.enabled) return ["설정 안 됨", "warn", v.has_token ? "토큰은 저장돼 있어요. 서버 ID와 내 사용자 ID까지 저장하고 게이트웨이를 다시 시작하면 연결돼요." : "아직 Discord 봇이 연결되지 않았어요."];
  if (v.connected) return ["연결됨", "ok", v.user || ""];   // the tag says 연결됨; the line is the bot's name only
  if (v.error) return ["연결 안 됨", "err", v.error];
  return ["연결 중", "warn", "연결하는 중이에요."];
}
function dcSwitch(label, on, key, onclick) {
  return el("button", { type: "button", class: "hs-sw", role: "switch", "aria-checked": String(on), "aria-label": `${label} Discord로도 보내기`, "data-dc": key, onclick });
}
function dcSwitches() {
  const li = (title, desc, k, on) => el("div", { class: "li" }, el("span", { class: "tx" }, el("div", { class: "hd", text: title }), el("div", { class: "sup", text: desc })), liEnd(dcSwitch(title, on, k, () => dpSet(k, !on))));
  const hint = () => el("div", { class: "li" }, el("span", { class: "tx" }, el("div", { class: "sup", text: "연결하면 고를 수 있어요" })));
  const on = DCS.v.enabled && DP.v;
  return [
    // Which notice classes Discord gets (discord-post.json ask/alert/result/news/conv; 진행 follows the conversation switches below).
    el("div", { class: "sec", text: "알림" }),
    el("div", { class: "list" }, ...(on ? [...notifyRows(k => DP.v[k] !== false, dpSet, ["ask", "alert", "result", "news", "conv"]),
      el("div", { class: "li" }, el("span", { class: "tx" }, el("div", { class: "sup", text: "Discord에서 직접 물은 것의 답은 Discord에도 가요." })))] : [hint()])),
    el("div", { class: "sec", text: "대화별로 Discord에도 보내기" }),
    el("div", { class: "list" }, ...(on ? [...DP_KINDS.map(([k, label, desc]) => li(label, desc, k, k === "web_lanes" ? DP.v[k] === true : DP.v[k] !== false))] : [hint()])),
  ];
}
function dcChecked() {
  const c = DCS.chk;
  if (!c) return null;
  if (!c.ok) return el("div", { class: "dcs-res err" }, el("div", { text: c.error || "확인하지 못했어요" }), c.intent_note ? el("div", { class: "sup", text: c.intent_note }) : null);
  return el("div", { class: "dcs-res" },
    el("div", { class: "dcs-ok", text: `봇 ${c.bot_name || "이름 없음"}` }),
    c.admin === true ? el("div", { class: "dcs-ok", text: "관리자 권한 확인됨" }) : c.invite_url ? el("div", {}, el("div", { text: "관리자 권한이 없어요." }), el("a", { class: "btn tonal", href: c.invite_url, target: "_blank", rel: "noopener noreferrer", text: "봇 권한 다시 승인" })) : null,
    c.intent_note ? el("div", { class: "sup", text: c.intent_note }) : null);
}
function dcConnect() {
  return obStart("discord");
}
function dcAdvanced(v) {
  const rows = [el("div", { class: "li dcs-form" }, textField("서버 ID", DCS.guild), textField("내 사용자 ID", DCS.owner),
    textField(v.has_token ? "봇 토큰 (저장됨 · 바꾸려면 새로 붙여 넣기)" : "봇 토큰", DCS.tok),
    v.has_token ? el("div", { class: "tag ok dcs-saved", text: "저장됨" }) : null,
    DCS.err ? el("div", { class: "dcs-err", role: "alert", text: DCS.err }) : null,
    el("div", { class: "dcs-acts" }, el("button", { type: "button", class: "btn", "data-ms-save": "1", onclick: ev => dcSave(ev.currentTarget), text: "저장" }), el("button", { type: "button", class: "btn tonal", onclick: ev => dcCheck(ev.currentTarget), text: "연결 확인" }),
      v.has_token ? el("button", { type: "button", class: "btn text", onclick: ev => dcClear(ev.currentTarget), text: "토큰 삭제" }) : null),
    dcChecked())];
  if (v.restart_needed) rows.push(el("div", { class: "li" }, el("span", { class: "tx" }, el("div", { class: "hd", text: "게이트웨이를 다시 시작하면 적용돼요" })), liEnd(el("button", { type: "button", class: "btn inrow", onclick: ev => dcRestart(ev.currentTarget), text: "다시 시작" }))));
  return el("div", { class: "list" }, ...rows);
}
function renderDiscord() {
  const box = $("#discord");
  if (!DCS.v) { clear(box).append(DCS.asked && DCS.fail ? emptyNode("Discord 설정을 불러오지 못했어요") : emptyNode("불러오는 중")); return; }
  const v = DCS.v, m = msItem("discord"), line = [dcStatus()[2], msConnectedNote("discord")].filter(Boolean).join(" · ");
  const [tag, tone] = m ? msTag(m) : v.enabled ? (v.connected ? ["연결됨", "ok"] : v.error ? ["연결 안 됨", "err"] : ["연결됨", "ok"]) : ["설정 안 됨", "warn"];
  const guide = v.enabled ? [] : [el("div", { class: "list" }, el("div", { class: "li", "data-dc-guide": "1" }, el("details", {}, el("summary", { class: "sup", text: "연결하는 방법" }), el("ol", { class: "steps" },
    el("li", { text: "Discord 개발자 포털(discord.com/developers)에서 새 앱을 만들고 Bot 탭에서 MESSAGE CONTENT를 켠 뒤 봇 토큰을 복사해요" }),
    el("li", { text: "초대 링크로 내 서버에 봇을 초대해요 (위에서 저장한 뒤 연결 확인을 누르면 초대 링크가 나와요)" }),
    el("li", { text: "봇 토큰, 서버 ID, 내 사용자 ID를 ‘직접 입력’에 붙여 넣고 저장해요" })))))];
  // The toggle event arrives after a redraw can already have replaced the element, so read the live state.
  const prev = box.querySelector("details[data-ms-advanced]");
  if (prev) DCS.advOpen = prev.open;
  const det = msAdvanced("data-ms-advanced", DCS.advOpen, () => dcAdvanced(v));
  det.addEventListener("toggle", () => { DCS.advOpen = det.open; });
  clear(box).append(el("div", { class: "sec", text: "연결" }), el("div", { class: "list" },
    el("div", { class: "li", "data-ms-status": "discord" }, el("span", { class: "lead" }, icon("discord")), el("span", { class: "tx" }, el("div", { class: "hd", text: "Discord 봇" }), line ? el("div", { class: "sup", text: line }) : null),
      liEnd(el("span", { class: `tag ${tone}`, text: tag }), el("button", { type: "button", class: "btn tonal inrow", "data-ms-connect": "discord", disabled: OB_WAIT.has("discord"), onclick: dcConnect }, OB_WAIT.has("discord") ? "연결하는 중" : msConnectLabel(m))))),
  ...obSection("discord", m ? m.state === "ok" : v.connected), ...dcSwitches(), ...guide, det);
}
