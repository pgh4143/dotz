// 설정 → 연결된 기기 (패스키): the browsers paired for web.access = "cloudflare" (hub/devices.ts: GET /api/devices, PATCH/DELETE /api/devices/<id>,
// POST /api/devices/code). The settings entry shows only when that list answers, which it does only in cloudflare mode; other installs never see it.
// A row opens a dialog to rename or unpair the device; "새 기기 연결" explains the /pair flow and can make a code right here.
const DEV = { items: null, fail: "", asked: false };
// This year's date drops the year ("9월 30일") so the line under the name stays on one line on a phone; an older one keeps it.
const dvDate = iso => {
  const t = Date.parse(iso || "");
  if (isNaN(t)) return "";
  const yr = x => new Date(x).toLocaleDateString("ko-KR", { ...KST, year: "numeric" });
  return new Date(t).toLocaleDateString("ko-KR", { ...KST, ...(yr(t) === yr(Date.now()) ? {} : { year: "numeric" }), month: "long", day: "numeric" });
};
const dvUsed = d => d.last_used ? `마지막 사용 ${msAgo(Date.parse(d.last_used))}` : "아직 쓰지 않음";

async function loadDevices() {
  DEV.asked = true;
  try { const v = await api("/api/devices"); DEV.items = Array.isArray(v) ? v : null; DEV.fail = ""; } catch (e) { DEV.items = null; DEV.fail = e.message; }
  if (current === "devices") renderDevices();
  if (inSettings()) renderSettings();
}
/* the 설정 row: only where the gateway keeps paired devices */
function devicesRow(row) {
  if (!DEV.items) return null;
  return row("desktop", "연결된 기기", `${DEV.items.length}대`, () => go("devices"));
}

function renderDevices() {
  const box = $("#devices");
  if (!DEV.items) { clear(box).append(DEV.asked && DEV.fail ? emptyNode("연결된 기기를 불러오지 못했어요") : emptyNode("불러오는 중")); return; }
  const row = d => el("button", { type: "button", class: "li tap", "data-dev": d.id, onclick: () => dvOpen(d) },
    el("span", { class: "lead" }, icon("desktop")),
    el("span", { class: "tx" }, el("div", { class: "hd", text: d.name }), el("div", { class: "sup", text: `${dvDate(d.created)} 연결 · ${dvUsed(d)}` })),
    el("span", { class: "li-end" }, d.current ? el("span", { class: "tag ok", "data-current": "1", text: "이 기기" }) : null, icon("chev", "chev")));
  const self = DEV.items.some(d => d.current);
  // the add action lives in the section header (docs/ui-spec.md 설정 행); a browser without a passkey gets one more row in the list
  const addSelf = el("button", { type: "button", class: "li tap", "data-dev-self": "1", onclick: () => dvNew(true) },
    el("span", { class: "lead" }, icon("add")), el("span", { class: "tx" }, el("div", { class: "hd", text: "이 기기에 패스키 추가" }), el("div", { class: "sup", text: "이 브라우저는 패스키 없이 들어왔어요" })));
  clear(box).append(
    el("div", { class: "sec", text: "이 웹앱을 쓸 수 있는 기기" }),
    el("div", { class: "list" }, ...(DEV.items.length ? DEV.items.map(row) : [el("div", { class: "li" }, el("span", { class: "tx" }, el("div", { class: "sup", text: "연결된 기기가 없어요" })))]), self ? null : addSelf,
      el("button", { type: "button", class: "li tap", "data-dev-new": "1", onclick: () => dvNew(false) },
        el("span", { class: "lead" }, icon("add")), el("span", { class: "tx" }, el("div", { class: "hd", text: "새 기기 연결" })))));
}

/* ---------- one device: rename, unpair ---------- */
function dvOpen(d) {
  const name = input({ value: d.name, maxlength: "60", name: "dev-name" });
  const body = el("div", { class: "col" }, textField("기기 이름", name),
    el("div", { class: "sup", text: `${dvDate(d.created)} 연결 · ${dvUsed(d)}` }),
    d.current ? el("div", { class: "tag ok dcs-saved", text: "지금 쓰고 있는 기기" }) : null);
  dialog({ title: d.name, body, mid: true, actions: [
    { label: "해제", kind: "danger fill", onclick: async (c, b) => {
      const text = d.current
        ? "이 기기는 바로 로그아웃돼요. 다시 쓰려면 메신저로 받은 코드로 새로 연결해야 해요."
        : `${d.name}의 로그인이 바로 끊겨요. 다시 쓰려면 코드로 새로 연결해야 해요.`;
      if (!(await ask("기기 해제", text, "해제", true))) return;
      await busy(b, async () => {
        await api(`/api/devices/${enc(d.id)}`, "DELETE");
        c();
        if (d.current) { snapForget(); return location.replace("/pair"); }
        toast("기기를 해제했어요");
        await motionOut(document.querySelector(`[data-dev="${CSS.escape(String(d.id))}"]`));   // the unpaired device's row leaves (150ms), then the list is read again
        await loadDevices();
      });
    } },
    { label: "저장", kind: "pri", onclick: async (c, b) => {
      const v = name.value.trim();
      if (!v) return toast("이름을 적어 주세요", true);
      if (v === d.name) return c();
      await busy(b, async () => { await api(`/api/devices/${enc(d.id)}`, "PATCH", { name: v }); c(); toast("저장했어요"); await loadDevices(); });
    } }] });
}

/* ---------- a new device (or this one) ---------- */
function dvQr(q) {
  const NS = "http://www.w3.org/2000/svg", part = (name, attrs) => { const n = document.createElementNS(NS, name); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };
  const box = q.size + 8, svg = part("svg", { viewBox: `-4 -4 ${box} ${box}`, class: "dv-qr", role: "img", "aria-label": "새 기기 연결 QR 코드", "data-dev-qr": "1", "shape-rendering": "crispEdges" });
  svg.append(part("rect", { x: -4, y: -4, width: box, height: box, class: "dv-qr-bg" }), part("path", { d: q.path, class: "dv-qr-ink" }));
  return svg;
}
function dvNew(self) {
  const res = el("div", { class: "dcs-res" });
  const steps = self
    ? ["'연결 화면 열기'를 눌러 코드와 이 기기 이름을 넣어요.", "패스키(Face ID, 지문, Windows Hello 등)로 확인하면 끝나요."]
    : ["새 기기의 브라우저에서 이 웹앱 주소를 열어요. '기기 연결' 화면이 나와요.", "QR을 찍거나 위의 코드를 넣어요.", "기기 이름을 넣고 패스키(Face ID, 지문, Windows Hello 등)로 확인하면 끝나요."];
  const make = btn => busy(btn, async () => {
    const o = await api("/api/devices/code", "POST", {});
    const addr = input({ value: o.url, readonly: true, name: "dev-url", onfocus: ev => ev.target.select() });
    clear(res).append(
      !self && o.qr ? dvQr(o.qr) : null,
      el("div", { class: "dv-code", "data-dev-code": o.code, text: o.code }),
      el("ol", { class: "steps" }, ...steps.map(s => el("li", { text: s }))),
      el("div", { class: "tf" }, el("label", { text: "연결 화면 주소", for: addr.id }), el("div", { class: "ms-copy" }, addr,
        self ? el("a", { class: "btn tonal", href: o.url, target: "_blank", rel: "noopener", text: "연결 화면 열기" })
          : el("button", { type: "button", class: "btn tonal", onclick: () => { try { navigator.clipboard.writeText(o.url); } catch {} toast("복사했어요"); }, text: "복사" }))));
  });
  const body = el("div", { class: "col" },
    el("div", { class: "sup", text: "코드는 10분 동안 한 번만 쓸 수 있고, 메신저와 이 화면을 합쳐 한 시간에 3번까지 만들 수 있어요." }),
    el("div", { class: "dcs-acts" }, el("button", { type: "button", class: "btn", "data-dev-make": "1", onclick: ev => make(ev.currentTarget), text: "여기서 코드 만들기" })),
    res);
  dialog({ title: self ? "이 기기에 패스키 추가" : "새 기기 연결", body, onclose: () => loadDevices(), mid: true });
}
