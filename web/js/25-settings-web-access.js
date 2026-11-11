// 설정 → 웹 접속: how the web app is reached (GET/PUT /api/web-access, hub/web-access.ts; POST /api/web-access/onboard,
// hub/routes.ts). Tailscale is the default and keeps the plain PUT; Cloudflare and 이 컴퓨터만 start the onboarding flow.
// The manual hostname/team/aud/token and the tunnel status live in the closed "직접 입력" disclosure.
const WA_MODES = [["tailscale", "Tailscale"], ["cloudflare", "Cloudflare"], ["local", "이 컴퓨터만"]];
const WA_HELP = {
  tailscale: "Tailscale로 연결한 내 기기에서 열어요. 기본값이에요.",
  cloudflare: "Cloudflare 터널로 고정 주소를 열어요. 연결은 자동으로 진행하고, 필요한 한 가지 동작만 알려드려요.",
  local: "이 컴퓨터에서만 열어요."
};
const WA = { data: null, draft: null, fail: "", asked: false, advOpen: false };
const waLabel = m => (WA_MODES.find(x => x[0] === m) || [m, m])[1];

async function loadWebAccess() {
  WA.asked = true;
  try { WA.data = await api("/api/web-access"); WA.fail = ""; } catch (e) { WA.data = null; WA.fail = e.message; }
  if (WA.data && !WA.draft) waReset();
  if (current === "webaccess") renderWebAccess();
  if (inSettings()) renderSettings();
}
function waReset() {
  const d = WA.data;
  WA.draft = { mode: d.mode, hostname: d.hostname, team: d.team, aud: d.aud, token: "" };
}
function waDirty() {
  const d = WA.data, f = WA.draft;
  return !!d && !!f && (f.hostname.trim() !== d.hostname || f.team.trim() !== d.team || f.aud.trim() !== d.aud || f.token.trim() !== "");
}
function webAccessRow(row) {
  return row("open", "웹 접속", WA.data ? waLabel(WA.data.mode) : "", () => go("webaccess"));
}

function waTunnel(d) {
  const t = d.tunnel || { state: "off" };
  const [text, tone] = t.state === "running" ? ["연결됨", "ok"] : t.state === "starting" ? ["연결 중", "warn"] : t.state === "error" ? ["연결 안 됨", "err"] : ["꺼짐", ""];
  const hint = !d.cloudflared_found ? "터널 프로그램이 없어요. 채팅에서 ‘웹 접속 설치해 줘’라고 말해 주세요."
    : t.error || (t.state === "running" ? "터널이 열려 있어요" : "");
  return el("div", { class: "li", "data-wa-tunnel": t.state },
    el("span", { class: "lead" }, el("span", { class: `dot ${tone}`, "aria-hidden": "true" })),
    el("span", { class: "tx" }, el("div", { class: "hd", text: "터널" }), hint ? el("div", { class: tone === "err" || !d.cloudflared_found ? "sup dcs-err" : "sup", text: hint }) : null),
    liEnd(el("span", { class: `tag ${tone}`, text })));
}

// Choosing Cloudflare or 이 컴퓨터만 starts the auto path at once; the flow itself asks for the one owner action.
async function waOnboard(mode) {
  if (!WA.draft) return;
  const hostname = WA.draft.hostname.trim();
  WA.draft = { ...WA.draft, mode };
  renderWebAccess();
  try { obApply("web-access", await api("/api/web-access/onboard", "POST", mode === "cloudflare" && hostname ? { mode, hostname } : { mode })); }
  catch (e) { toast(e.message, true); }
}
async function waPickTailscale(btn) {
  if (!WA.draft) return;
  await busy(btn, async () => {
    WA.data = await api("/api/web-access", "PUT", { mode: "tailscale" });
    waReset();
    if (current === "webaccess") renderWebAccess();
    if (inSettings()) renderSettings();
    loadDevices();
  });
}
function waAdvanced(d, f) {
  const field = (label, key, opts, hint) => el("div", {}, textField(label, input({ value: f[key], name: `wa-${key}`, ...opts, oninput: ev => { f[key] = ev.target.value; waSync(); } })), hint ? el("div", { class: "sup", text: hint }) : null);
  const out = el("div", {}, el("div", { class: "list" }, el("div", { class: "li dcs-form" },
    field("주소", "hostname", { placeholder: "dotz.example.com", inputmode: "url" }, "터널에 연결해 둔 주소예요. 주소를 바꾸면 기기를 다시 연결해야 해요."),
    field("팀 이름 (선택)", "team", { placeholder: "myteam" }, "Cloudflare Access로 한 번 더 확인할 때만 적어요. 확인 번호와 함께 적어요."),
    field("확인 번호 (선택)", "aud", {}, "Access 앱 화면의 Audience Tag 값이에요."),
    el("div", {}, textField("터널 토큰", input({ type: "password", autocomplete: "new-password", name: "wa-token", placeholder: d.token_set ? "바꾸려면 새로 붙여 넣기" : "eyJ…", oninput: ev => { f.token = ev.target.value; waSync(); } })),
      d.token_set ? el("div", { class: "tag ok dcs-saved", "data-wa-token-set": "1", text: "저장됨" }) : null,
      el("div", { class: "sup", text: "저장하면 이 컴퓨터에만 보관하고, 화면에는 다시 보여 주지 않아요." })),
    el("div", { class: "dcs-acts" },
      el("button", { type: "button", class: "btn", "data-wa-save": "1", disabled: !waDirty(), onclick: ev => waSave(ev.currentTarget), text: "저장" }),
      waDirty() ? el("button", { type: "button", class: "btn tonal", "data-wa-cancel": "1", onclick: () => { waReset(); renderWebAccess(); }, text: "되돌리기" }) : null))));
  return out;
}
function waSync() { const b = document.querySelector("#webaccess [data-wa-save]"); if (b) b.disabled = !waDirty(); }

function renderWebAccess() {
  const box = $("#webaccess");
  if (!WA.data || !WA.draft) { clear(box).append(WA.asked && WA.fail ? emptyNode("웹 접속 설정을 불러오지 못했어요") : emptyNode("불러오는 중")); return; }
  const d = WA.data, f = WA.draft, cf = f.mode === "cloudflare";
  const modes = el("div", { class: "list", role: "radiogroup", "aria-label": "접속 방식" },
    ...WA_MODES.map(([v, t]) => el("button", { type: "button", role: "radio", "aria-checked": String(v === f.mode), class: "li tap", "data-v": v, onclick: ev => v === "tailscale" ? waPickTailscale(ev.currentTarget) : waOnboard(v) },
      el("span", { class: "tx" }, el("div", { class: "hd", text: t }), el("div", { class: "sup", "data-wa-help": v, text: WA_HELP[v] })),
      el("span", { class: "li-end" }, v === f.mode ? icon("check") : null))));
  const nodes = [el("div", { class: "sec", text: "접속 방식" }), modes,
    el("div", { class: "sec", text: "자동 연결" }), onboardingPanel("web-access")];
  if (cf) nodes.push(el("div", { class: "sec", text: "상태" }), el("div", { class: "list" }, waTunnel(d),
    el("button", { type: "button", class: "li tap", "data-wa-devices": "1", onclick: () => go("devices") },
      el("span", { class: "lead" }, icon("key")), el("span", { class: "tx" }, el("div", { class: "hd", text: "연결된 기기 (패스키)" }), el("div", { class: "sup", text: "이 웹앱에 들어올 수 있는 브라우저" })),
      el("span", { class: "li-end" }, el("span", { class: "tag", text: `${d.devices}대` }), icon("chev", "chev")))));
  if (cf) nodes.push(el("div", { class: "list" }, el("div", { class: "li" }, el("span", { class: "tx" },
    el("div", { class: "sup", "data-wa-plain": "1", text: "Cloudflare를 거치는 내용은 Cloudflare가 평문으로 볼 수 있어요. 암호화(TLS)가 거기서 끝나기 때문이에요." })))));
  if (cf && !d.cloudflared_found) nodes.push(el("div", { class: "list" }, el("div", { class: "li" }, el("span", { class: "tx" },
    el("div", { class: "hd", text: "터널 프로그램이 없어요" }), el("div", { class: "sup dcs-err", "data-wa-cf-missing": "1", text: "채팅에서 ‘웹 접속 설치해 줘’라고 말해 주세요." })))));
  // The toggle event arrives after a redraw can already have replaced the element, so read the live state.
  const prev = box.querySelector("details[data-wa-advanced]");
  if (prev) WA.advOpen = prev.open;
  const det = msAdvanced("data-wa-advanced", WA.advOpen, () => waAdvanced(d, f));
  det.addEventListener("toggle", () => { WA.advOpen = det.open; });
  nodes.push(det);
  clear(box).append(...nodes);
}

async function waSave(btn) {
  const d = WA.data, f = WA.draft;
  if (!d || !f) return;
  if (d.mode === "cloudflare" && !f.hostname.trim() && f.hostname.trim() !== d.hostname) return toast("주소를 적어 주세요", true);
  const put = { mode: d.mode };
  if (f.hostname.trim() !== d.hostname) put.hostname = f.hostname.trim();
  if (f.team.trim() !== d.team) put.team = f.team.trim();
  if (f.aud.trim() !== d.aud) put.aud = f.aud.trim();
  if (f.token.trim()) put.token = f.token.trim();
  let saved = false;
  await busy(btn, async () => {
    WA.data = await api("/api/web-access", "PUT", put);
    waReset();
    saved = true;
    if (current === "webaccess") renderWebAccess();
    loadDevices();
  });
  if (saved) stFlash("#webaccess [data-wa-save]");
}
