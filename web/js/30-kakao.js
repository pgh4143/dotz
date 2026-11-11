/* ---------- 모니터링 > 앱 > 카카오톡: choose the rooms to watch, and a KakaoTalk-style chat per chosen room ---------- */
// API: docs/kakao-rooms-api.md. The item (30-monitoring.js, key "i:kakao") shows this pane instead of the notice timeline: renderMonitoring calls
// kkMode(). Wide screens put the room column beside the chat; below 1100px they are two screens (KK.open picks which; the app bar's back
// arrow, kkBack(), leaves the chat). Live updates arrive on the event stream as kakao / kakao_send / kakao_draft / kakao_rooms / kakao_read (99-boot.js -> kkLive).
// Each message carries `unread` (KakaoTalk's yellow number: members who have not read it yet); kakao_read -> /reads refreshes the numbers without bodies.
// Nothing is ever sent without a click: a typed message, a draft's 보내기 or an edited draft's 보내기 is the owner's own action.
// Message text only ever goes through el({text}) / textContent, never innerHTML.
const KK_KEY = "i:kakao";
const kkItem = it => !!it && (it.key === KK_KEY || !!it.kk);   // a peer's Kakao item (34-peer-monitoring.js) shows this same pane, its rooms read through the proxy (KK.pc)
// The kakao item the pane shows: this computer's, or the peer's while KK.pc names it.
const kkItemNow = () => monItems().find(i => kkItem(i) && (KK.pc ? !!i.pc && i.pc.url === KK.pc.url : !i.pc)) || null;
const KK_PAGE = 50;
const KK = {
  vis: false, on: true, error: "", rooms: [], loaded: false, failed: false, dsig: [], droom: "", adding: null,   // adding: the 지켜볼 대화방 dialog while it is open
  open: "", seq: 0, loading: false, roomErr: "", room: null, msgs: [], gaps: new Set(), more: false, read: null, div: "", drafts: [], sends: [], ask: null, hidden: new Set(),
  stick: true, pill: false, pin: "", placed: false, readSent: "", edit: null, sending: false, drafting: "", revise: null, reviseCode: "", draftT: 0, tailing: false, again: false,
  view: "all", typed: new Map(), headSig: "", rseq: 0, timer: 0, intgT: 0, pc: null, reading: false, readAgain: false, q: "",
  peerT: 0, peerBusy: false, peerHead: "", lp: new Map(), olderBusy: false, olderAgain: false,
};

/* ---- small helpers ---- */
const kkBig = s => { try { return BigInt(s); } catch { return 0n; } };
const kkGt = (a, b) => kkBig(a) > kkBig(b);
const kkDay = t => { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
const kkTime = t => new Date(t).toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit" });
const kkDate = t => { const now = new Date(), y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1); return kkDay(t) === kkDay(now) ? "오늘" : kkDay(t) === kkDay(y) ? "어제" : new Date(t).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "long" }); };
function kkListTime(t) {
  if (!t) return "";
  const d = new Date(t), now = new Date(), y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (kkDay(t) === kkDay(now)) return kkTime(t);
  if (kkDay(t) === kkDay(y)) return "어제";
  return d.getFullYear() === now.getFullYear() ? `${d.getMonth() + 1}월 ${d.getDate()}일` : `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
}
const kkHue = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.codePointAt(0)) % 360; return h; };
const kkInitial = s => [...String(s ?? "").trim()][0] || "?";
function kkAvatar(name, cls = "") {
  const n = el("span", { class: `kk-av ${cls}`.trim(), "aria-hidden": "true", text: kkInitial(name) });
  n.style.setProperty("--h", String(kkHue(name)));
  return n;
}
// What a message that is not plain text says (KakaoTalk's type codes). A reply (26) carries its own text.
const KK_TYPE = { 2: "(사진)", 27: "(사진)", 3: "(동영상)", 4: "(음성 메시지)", 5: "(음성 메시지)", 12: "(이모티콘)", 20: "(이모티콘)", 25: "(이모티콘)", 18: "(파일)", 16: "(위치)" };
const KK_OTHER = "(지원하지 않는 메시지)";
// A JSON record in the message column (an attachment of a type this build does not draw) is not words: never show it.
const kkRecord = s => {
  if (!/^\s*[\[{]/.test(String(s))) return false;
  try { const v = JSON.parse(String(s)); return !!v && typeof v === "object"; } catch { return false; }
};
// The text of a message (the server sends it for text, replies, feed lines and unknown types); else the placeholder of its type.
function kkBody(m) {
  const type = Number(m.type), text = String(m.text ?? "");
  const words = type === 0 ? kkSysText(text) : type === 1 || type === 26 || !kkRecord(text) ? text : "";
  if (words) return { text: words, ph: false };
  return { text: KK_TYPE[type] || KK_OTHER, ph: true };
}
// The one line a room row shows under its name (the same rule as the hub's room list).
const kkHint = m => { const chars = [...kkBody(m).text.replace(/\s+/g, " ").trim()]; return chars.length > 32 ? `${chars.slice(0, 31).join("").trimEnd()}…` : chars.join(""); };
const kkSys = m => Number(m.type) === 0;
// A system line (type 0) whose text is KakaoTalk's own feed record ({"feedType":..}) reads as words, never as JSON: a hidden message, people who came
// in or left; a record of any other kind is not drawn (better nothing than a guess).
function kkSysText(text) {
  const s = String(text ?? "").trim();
  if (!kkRecord(s)) return s;
  let v;
  try { v = JSON.parse(s); } catch { return ""; }
  if (!v || typeof v !== "object" || v.feedType === undefined) return "";
  if (v.hidden) return "가려진 메시지예요";
  const names = (Array.isArray(v.members) ? v.members : []).map(x => x && (x.nickName || x.nickname)).filter(Boolean).join(", ");
  if (!names) return "";
  const ft = Number(v.feedType);
  return ft === 1 || ft === 4 ? `${names}님이 들어왔어요` : ft === 2 ? `${names}님이 나갔어요` : ft === 6 ? `${names}님을 내보냈어요` : "";
}

/* ---- links in a message: the address itself is a link, and a lazy preview card under the bubble (GET /api/link-preview) ---- */
const KK_URL = /\bhttps?:\/\/[^\s<>"'`]+/gu;
const kkTrimUrl = u => u.replace(/[.,!?;:)\]]+$/u, "");
// Up to three addresses of a message text, without duplicates and trailing punctuation.
const kkUrls = text => [...new Set((String(text).match(KK_URL) || []).map(kkTrimUrl).filter(Boolean))].slice(0, 3);
// The text with each address as an anchor; everything else stays text (never innerHTML).
function kkLinkText(text) {
  const out = document.createDocumentFragment();
  let at = 0;
  for (const m of String(text).matchAll(KK_URL)) {
    const raw = m[0], url = kkTrimUrl(raw);
    if (m.index > at) out.append(document.createTextNode(text.slice(at, m.index)));
    out.append(el("a", { class: "kk-link", href: url, target: "_blank", rel: "noopener noreferrer", text: url }));
    if (raw.length > url.length) out.append(document.createTextNode(raw.slice(url.length)));
    at = m.index + raw.length;
  }
  if (at < String(text).length) out.append(document.createTextNode(String(text).slice(at)));
  return out;
}
const kkLpCard = url => el("a", { class: "kk-lp", href: url, target: "_blank", rel: "noopener noreferrer", "data-url": url }, el("span", { class: "kk-lp-ph", text: "링크 미리보기" }));
// One request per address for the whole pane (the hub caches 24 h as well); a failed preview disappears, the plain link stays.
// The map holds the pending request too, so cards of the same address share one answer.
async function kkLpLoad(card) {
  const url = card.dataset.url;
  let p = KK.lp.get(url);
  if (p === undefined) {
    p = api(`/api/link-preview?url=${enc(url)}`).catch(() => ({ ok: false }));
    KK.lp.set(url, p);
  }
  p = await p;
  KK.lp.set(url, p);
  if (!card.isConnected) return;
  if (!p || !p.ok) { card.remove(); return; }
  clear(card);
  if (p.image) card.append(el("img", { src: p.image, alt: "", loading: "lazy", decoding: "async", draggable: "false" }));
  card.append(el("span", { class: "kk-lp-b" },
    p.site ? el("span", { class: "kk-lp-s", text: p.site }) : null,
    p.title ? el("span", { class: "kk-lp-t", text: p.title }) : null,
    p.description ? el("span", { class: "kk-lp-d", text: p.description }) : null));
}
let kkLpIO = null;
let kkTopIO = null;
// The top of the room loads the older page by itself (one at a time), the button stays as the fallback.
function kkTopWatch() {
  kkTopIO?.disconnect();
  const top = $("#kk-top", kkIn);
  if (top && kkTopIO) kkTopIO.observe(top);
}
function kkLpWatch() {
  for (const c of kkIn.querySelectorAll(".kk-lp[data-url]")) if (kkLpIO) kkLpIO.observe(c); else kkLpLoad(c);
}

/* ---- photos, videos, voice, files, replies, locations: built from m.media (the server sends no URL; bytes come from /api/kakao/media/...) ---- */
const KK_GONE = "기간이 지나 볼 수 없어요";
// A peer's room (KK.pc) is read through /api/peer/proxy like every other Kakao GET (34-peer-monitoring.js pqLink).
const kkMediaUrl = (m, i, v) => pqLink(`/api/kakao/media/${enc(KK.open)}/${enc(m.logId)}?i=${i | 0}&v=${v}`);
const kkFileUrl = m => pqLink(`/api/kakao/media/${enc(KK.open)}/${enc(m.logId)}/file`);
const kkNum = v => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);
function kkSize(n) {
  n = kkNum(n);
  if (!n) return "";
  return n < 1024 ? `${n}B` : n < 1048576 ? `${Math.round(n / 1024)}KB` : `${(n / 1048576).toFixed(1)}MB`;
}
function kkDur(sec) {
  sec = Math.round(kkNum(sec) / (kkNum(sec) > 3600 * 10 ? 1000 : 1));
  return sec ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}` : "";
}
const kkGoneCard = () => el("div", { class: "kk-bub card gone", role: "status", text: KK_GONE });
// A lazy image from the media route; when it cannot be fetched (expired, gone) its box says so.
function kkImg(m, i, v, alt, box) {
  return el("img", { src: kkMediaUrl(m, i, v), alt, loading: "lazy", decoding: "async", draggable: "false", onerror: ev => {
    ev.currentTarget.remove();
    box.classList.add("gone");
    if (v === "thumb" && box.dataset.k === "video") return;
    box.append(el("span", { class: "kk-gonet", text: KK_GONE }));
  } });
}
function kkRatio(box, w, h, max) {
  w = kkNum(w) || 4; h = kkNum(h) || 3;
  box.style.setProperty("--ar", `${w} / ${h}`);
  box.style.setProperty("--pw", `${Math.min(kkNum(w) > 20 ? w : max, max)}px`);
}
function kkPhotoBtn(m, md, i, alt) {
  const b = el("button", { class: "kk-photo", type: "button", "data-k": "photo", "aria-label": `${alt} 크게 보기`, onclick: () => kkViewer(m, md, i) });
  b.append(kkImg(m, i, "thumb", alt, b));
  return b;
}
function kkPhotoNode(m, md) {
  if (md.expired) return kkGoneCard();
  const count = Math.max(1, md.count | 0);
  if (count === 1) {
    const b = kkPhotoBtn(m, md, 0, "사진");
    kkRatio(b, md.w, md.h, 240);
    return el("div", { class: "kk-media" }, b);
  }
  const cols = count >= 5 ? 3 : 2, shown = Math.min(count, 6), grid = el("div", { class: `kk-media kk-album c${cols}`, "data-count": String(count) });
  for (let i = 0; i < shown; i++) {
    const b = kkPhotoBtn(m, md, i, `사진 ${i + 1}`);
    if (i === shown - 1 && count > shown) b.append(el("span", { class: "kk-more-n", text: `+${count - shown + 1}` }));
    grid.append(b);
  }
  return grid;
}
function kkVideoNode(m, md) {
  if (md.expired) return kkGoneCard();
  const b = el("button", { class: "kk-photo kk-video", type: "button", "data-k": "video", "aria-label": "동영상 재생", onclick: () => kkViewer(m, md, 0) });
  kkRatio(b, md.w, md.h, 240);
  b.append(kkImg(m, 0, "thumb", "동영상", b), el("span", { class: "kk-play", "aria-hidden": "true" }));
  if (kkDur(md.d)) b.append(el("span", { class: "kk-dur", text: kkDur(md.d) }));
  return el("div", { class: "kk-media" }, b);
}
function kkVoiceNode(m, md) {
  if (md.expired) return kkGoneCard();
  return el("div", { class: "kk-bub card voice" },
    el("audio", { controls: true, preload: "none", src: kkMediaUrl(m, 0, "full") }),
    kkDur(md.d) ? el("span", { class: "kk-sub", text: kkDur(md.d) }) : null);
}
function kkFileNode(m, md) {
  const sub = [kkSize(md.size), md.local ? "" : md.expired ? KK_GONE : ""].filter(Boolean).join(" · ");
  return el("div", { class: `kk-bub card file${md.local ? "" : " off"}` },
    icon("file", "kk-fi"),
    el("span", { class: "kk-fb" }, el("span", { class: "kk-fn", title: md.name, text: md.name }), sub ? el("span", { class: "kk-sub", text: sub }) : null),
    md.local ? el("a", { class: "btn tonal inrow kk-open", href: kkFileUrl(m), target: "_blank", rel: "noopener", download: md.name, text: "열기" }) : el("span", { class: "kk-sub kk-nopc", text: "PC에 없음" }));
}
// Like KakaoTalk: "<author of the original>에게 답장" over the quoted original, then the reply's own text. The quote is a button that jumps to
// the original (kkJump), when the attachment names its logId.
function kkReplyNode(m, md) {
  const { text } = kkBody(m);
  return el("div", { class: "kk-bub reply" },
    el("button", { class: `kk-quote${md.srcLogId ? " kk-qjump" : ""}`, type: "button", disabled: !md.srcLogId, "data-src": md.srcLogId || null, "aria-label": md.srcLogId ? "원래 메시지로 이동" : null, onclick: ev => { ev.stopPropagation(); kkJump(md.srcLogId, ev.currentTarget); } },
      el("span", { class: "kk-qn" }, el("span", { text: md.quoteSender ? `${md.quoteSender}에게 답장` : "답장" }), md.srcLogId ? el("span", { class: "kk-qgo", text: "원문 보기" }) : null), el("span", { class: "kk-qt", text: md.quote })),
    el("div", { class: "kk-rt", text }));
}
// The original message of a quote: scroll it into view and flash it briefly. When the page does not hold it, the server sends the page
// around that logId (?around=); a logId the room does not have says so with a toast.
// The original stays marked a few seconds with an "원래 메시지" label over it, and a pill takes the owner back to the reply he came from.
const kkFlash = (node, label = "원래 메시지") => {
  node.classList.remove("kk-hl");
  void node.offsetWidth;
  node.classList.add("kk-hl");
  node.dataset.hl = label;
  clearTimeout(node._hlT);
  node._hlT = setTimeout(() => node.classList.remove("kk-hl"), 3200);
};
let kkBackPill = null;
function kkReturnPill(from) {
  if (kkBackPill) kkBackPill.remove();
  const log = from && from.closest("[data-log]") ? from.closest("[data-log]").dataset.log : "";
  if (!log) return;
  const pill = kkBackPill = el("button", { class: "kk-backpill", type: "button", "data-k": "kk-back-reply", onclick: () => {
    pill.remove(); kkBackPill = null;
    const n = [...kkTl.querySelectorAll("[data-log]")].find(x => x.dataset.log === log);
    if (n) { n.scrollIntoView({ block: "center" }); kkFlash(n, "답장"); }
  } }, icon("back"), "답장으로 돌아가기");
  kkTl.parentElement.append(pill);
  setTimeout(() => { if (kkBackPill === pill) { pill.remove(); kkBackPill = null; } }, 12000);
}
function kkJump(src, from) {
  src = String(src || "").trim();
  if (!src || !KK.open) return;
  const find = () => [...kkTl.querySelectorAll("[data-log]")].find(n => n.dataset.log === src);
  let node = find();
  if (!node) {
    const id = KK.open;
    // The original is on an older page: the quote says it is looking until the page around it arrives.
    if (from) { from.classList.add("busy"); from.dataset.wait = "찾는 중…"; }
    api(`/api/kakao/chat/${enc(id)}?limit=${KK_PAGE}&around=${enc(src)}`).then(d => {
      if (KK.open !== id) return;
      // The page around the original is merged into what the room already shows (a jump never drops the current view). Messages between
      // that page and the rest are not loaded: the place is marked as a gap (kkGapNode) instead of drawing the two pages as adjacent.
      const got = Array.isArray(d.messages) ? d.messages : [];
      kkMergeGap(got);
      if (d.room) KK.room = d.room;
      if (Array.isArray(d.drafts)) { KK.drafts = d.drafts; KK.ask = kkAskOf(d); }
      if (Array.isArray(d.sends)) KK.sends = d.sends;
      if (d.read !== undefined) KK.read = d.read;
      kkPaintTl(false);
      const hit = find();
      if (from) from.classList.remove("busy");
      if (!hit) { toast("원래 메시지를 찾지 못했어요 · 대화에서 지워졌거나 아주 오래된 메시지예요", true); return; }
      hit.scrollIntoView({ block: "center" });
      kkFlash(hit);
      kkReturnPill(from);
      kkSyncStick();
    }, e => { if (from) from.classList.remove("busy"); toast(e.message, true); });
    return;
  }
  node.scrollIntoView({ block: "center" });
  kkFlash(node);
  kkReturnPill(from);
  kkSyncStick();
}
const kkByLog = (a, b) => (kkGt(a.logId, b.logId) ? 1 : kkGt(b.logId, a.logId) ? -1 : 0);
// Merges a page that may not touch what is shown (a quote jump, a gap fill). A page sharing no message with the view leaves a gap on each
// side that has shown messages; a gap the page reaches into is closed. KK.gaps holds the logId each gap follows. `closes`: the gap this
// page fills from below (its lower side is contiguous by construction).
function kkMergeGap(got, closes) {
  if (!got.length) return;
  const have = new Set(KK.msgs.map(x => x.logId)), fresh = got.filter(x => !have.has(x.logId)), page = [...got].sort(kkByLog);
  const lo = page[0].logId, hi = page[page.length - 1].logId, touches = fresh.length < got.length;
  if (closes) KK.gaps.delete(closes);
  if (!touches) {
    const above = KK.msgs.find(x => kkGt(x.logId, hi)), below = KK.msgs.filter(x => kkGt(lo, x.logId)).pop();
    if (above) KK.gaps.add(hi);
    if (below && !closes) KK.gaps.add(below.logId);
  }
  KK.msgs = [...KK.msgs, ...fresh].sort(kkByLog);
}
// The messages after a gap, one page at a time; the gap closes once the page reaches what is shown after it.
async function kkFillGap(after) {
  const id = KK.open;
  if (!id || KK.gapBusy) return;
  KK.gapBusy = true;
  try {
    const d = await api(`/api/kakao/chat/${enc(id)}?limit=${KK_PAGE}&after=${enc(after)}`);
    if (KK.open !== id) return;
    kkMergeGap(Array.isArray(d.messages) ? d.messages : [], after);
    kkPaintTl(false);
  } catch (e) { toast(e.message, true); }
  finally { KK.gapBusy = false; }
}
const kkGapNode = after => el("div", { class: "kk-gap", role: "separator", "aria-label": "불러오지 않은 메시지가 있어요" },
  el("button", { class: "btn text", type: "button", "data-k": "gap", text: "사이 메시지 불러오기", onclick: () => kkFillGap(after) }));
// A sticker: its image from the media route when the server has one (md.image), else (or when it cannot be fetched) one chip with its name.
// The text written with it sits in a bubble under it.
const kkEmoChip = md => el("div", { class: "kk-bub ph kk-emo-chip", text: md.alt || "이모티콘" });
function kkEmoticonNode(m, md) {
  const sticker = md.image
    ? el("div", { class: "kk-sticker" }, el("img", { src: kkMediaUrl(m, 0, "full"), alt: md.alt || "이모티콘", loading: "lazy", decoding: "async", draggable: "false", onerror: ev => ev.currentTarget.parentNode.replaceWith(kkEmoChip(md)) }))
    : kkEmoChip(md);
  const words = String(md.text ?? "").trim();
  return words ? el("div", { class: "kk-emo" }, sticker, el("div", { class: "kk-bub kk-emo-t", text: words })) : sticker;
}
function kkLocationNode(md) {
  const href = `https://map.kakao.com/link/map/${enc(md.label)},${Number(md.lat)},${Number(md.lng)}`;
  return el("a", { class: "kk-bub card loc", href, target: "_blank", rel: "noopener" }, el("span", { class: "kk-fn", text: `위치: ${md.label}` }), el("span", { class: "kk-sub", text: "지도에서 보기" }));
}
function kkMediaNode(m, md) {
  switch (md.kind) {
    case "photo": return kkPhotoNode(m, md);
    case "video": return kkVideoNode(m, md);
    case "voice": return kkVoiceNode(m, md);
    case "file": return kkFileNode(m, md);
    case "emoticon": return kkEmoticonNode(m, md);
    case "reply": return kkReplyNode(m, md);
    case "location": return kkLocationNode(md);
    default: return null;
  }
}
// The full-screen viewer (the lightbox dialog of 15-attachments.js): a photo (an album pages with the arrows) or a video with controls.
function kkViewer(m, md, start) {
  const count = md.kind === "photo" ? Math.max(1, md.count | 0) : 1;
  let i = Math.min(Math.max(start | 0, 0), count - 1);
  const title = el("span", { class: "lb-n" }), body = el("div", { class: "lb-img kk-vw", tabindex: "-1", autofocus: true, onclick: ev => { if (ev.target === ev.currentTarget) d.close(); } });
  const prev = el("button", { class: "x", type: "button", "data-k": "prev", "aria-label": "이전 사진", onclick: () => go(i - 1) }, icon("back"));
  const next = el("button", { class: "x", type: "button", "data-k": "next", "aria-label": "다음 사진", onclick: () => go(i + 1) }, icon("chev"));
  const d = el("dialog", { class: "lbox kk-vwd", "aria-label": md.kind === "video" ? "동영상 보기" : "사진 보기" },
    el("div", { class: "lb-in" }, el("div", { class: "lb-bar" }, title, prev, next, el("button", { class: "x", type: "button", "data-k": "close", "aria-label": "닫기", onclick: () => d.close() }, icon("close"))), body));
  const gone = ev => ev.currentTarget.replaceWith(el("p", { class: "tv-st", role: "status", text: KK_GONE }));
  const paint = () => {
    title.textContent = md.kind === "video" ? "동영상" : count > 1 ? `사진 ${i + 1} / ${count}` : "사진";
    prev.hidden = i <= 0; next.hidden = i >= count - 1;
    const src = kkMediaUrl(m, i, "full");
    clear(body).append(md.kind === "video" ? el("video", { src, controls: true, autoplay: true, playsinline: true, onerror: gone }) : el("img", { src, alt: title.textContent, onerror: gone }));
  };
  const go = n => { if (n >= 0 && n < count) { i = n; paint(); } };
  d.addEventListener("keydown", ev => { if (ev.key === "ArrowLeft") go(i - 1); else if (ev.key === "ArrowRight") go(i + 1); });
  d.addEventListener("close", () => d.remove());
  paint();
  document.body.append(d); d.showModal(); dialogHist(d);
  return d;
}
const kkWho = m => (m.fromMe ? "me" : String(m.authorId ?? m.sender ?? ""));

/* ---- 사용자별 분석: a sender's avatar or name opens the panel (GET/POST /api/kakao/person/...) ---- */
const kkMin = ms => (ms === undefined || ms === null ? "" : ms < 60000 ? `${Math.max(1, Math.round(ms / 1000))}초` : ms < 3600000 ? `${Math.round(ms / 60000)}분` : `${(ms / 3600000).toFixed(1)}시간`);
function kkBars(values, labels) {
  const max = Math.max(1, ...values);
  return el("div", { class: "kk-hist" }, ...values.map((v, i) => el("span", { class: "kk-hb", title: `${labels ? labels[i] : i}시 ${v}개`, style: `height:${Math.max(2, Math.round((v / max) * 100))}%` })));
}
function kkPerson(uid) {
  uid = String(uid || "");
  const id = KK.open;
  if (!uid || !id) return;
  const who = KK.msgs.find(m => !m.fromMe && String(m.authorId) === uid);
  const name = who ? who.sender || "상대" : "상대";
  const body = el("div", { class: "kk-pd-b" }, el("div", { class: "kk-note", role: "status", text: "불러오는 중…" }));
  const d = el("dialog", { class: "kk-pd", "data-uid": uid, "aria-label": `${name} 사용자별 분석` },
    el("div", { class: "kk-pd-in" },
      el("div", { class: "kk-pd-h" }, kkAvatar(name), el("span", { class: "cv-b" }, el("span", { class: "cv-n", text: name }), el("span", { class: "cv-p", text: "사용자별 분석" })), el("button", { class: "ib fs-x", type: "button", "data-k": "close", "aria-label": "닫기", onclick: () => d.close() }, icon("close"))),
      body));
  d.addEventListener("click", ev => { if (ev.target === d) d.close(); });
  document.body.append(d); d.showModal(); dialogHist(d);
  d.addEventListener("close", () => d.remove());
  api(`/api/kakao/person/${enc(uid)}?room=${enc(id)}`).then(r => { if (d.isConnected) kkPersonPaint(d, body, r); }, e => { if (d.isConnected) clear(body).append(el("div", { class: "kk-note", role: "status", text: e.message })); });
}
function kkPersonPaint(d, body, r) {
  const s = (r && r.stats) || {}, row = (k, v) => el("div", { class: "kk-prow" }, el("span", { class: "kk-pk", text: k }), el("span", { class: "kk-pv", text: v }));
  const span = [s.firstAt ? kstStamp(s.firstAt) : "", s.lastAt ? kstStamp(s.lastAt) : ""].filter(Boolean).join(" ~ ");
  const reply = [s.replyToOwnerMs !== undefined ? `상대 → 나 ${kkMin(s.replyToOwnerMs)}` : "", s.ownerReplyMs !== undefined ? `나 → 상대 ${kkMin(s.ownerReplyMs)}` : ""].filter(Boolean).join(" · ") || "아직 잴 수 없어요";
  const unanswered = Array.isArray(s.recentUnanswered) ? s.recentUnanswered : [];
  const sum = el("div", { class: "kk-sum" });
  const paintSum = a => clear(sum).append(...[
    a && a.text ? el("div", { class: "kk-dh", text: "요약" }) : null,
    a && a.text ? el("div", { class: "kk-dt", text: a.text }) : null,
    a && a.at ? el("div", { class: "kk-sub", text: `${kstStamp(a.at)}에 만든 요약` }) : null,
    el("button", { class: "btn tonal", type: "button", "data-k": "analyze", text: a ? "다시 분석" : "요약 분석", onclick: ev => kkAnalyze(d, ev.currentTarget, paintSum) }),
  ].filter(Boolean));
  paintSum(r && r.analysis);
  // A section whose numbers are all 0 is not drawn: no empty charts, no "0개 · 0개 (0곳)".
  const some = a => Array.isArray(a) && a.some(v => v > 0);
  const rows = [
    (s.roomMessages | 0) || (s.watchedMessages | 0) ? row("메시지", `이 방 ${s.roomMessages | 0}개 · 지켜보는 방 ${s.watchedMessages | 0}개 (${s.watchedRooms | 0}곳)`) : null,
    span ? row("기간", span) : null,
    s.replyToOwnerMs !== undefined || s.ownerReplyMs !== undefined ? row(`답장 (${s.windowDays || 30}일)`, reply) : null,
    s.mentions | 0 ? row("나를 부른 메시지", `${Math.round((s.mentionShare || 0) * 100)}% (${s.mentions | 0}개)`) : null,
  ].filter(Boolean);
  clear(body).append(...[
    rows.length ? el("div", { class: "kk-psec" }, ...rows) : null,
    some(s.hours) ? el("div", { class: "kk-psec" }, el("div", { class: "kk-dh", text: "활동 시간" }), kkBars(s.hours, Array.from({ length: 24 }, (_, i) => String(i))),
      el("div", { class: "kk-hax" }, el("span", { text: "0시" }), el("span", { text: "6시" }), el("span", { text: "12시" }), el("span", { text: "18시" }), el("span", { text: "24시" }))) : null,
    some(s.weekdays) ? el("div", { class: "kk-psec" }, el("div", { class: "kk-dh", text: "요일" }), kkBars(s.weekdays, ["일", "월", "화", "수", "목", "금", "토"]),
      el("div", { class: "kk-hax kk-hax7" }, ...["일", "월", "화", "수", "목", "금", "토"].map(t => el("span", { text: t })))) : null,
    el("div", { class: "kk-psec" }, el("div", { class: "kk-dh", text: "답장을 기다리는 메시지" }),
      ...(unanswered.length ? unanswered.map(m => el("div", { class: "kk-pun" }, el("span", { class: "kk-sub", text: kstStamp(m.at) }), el("span", { class: "kk-put", text: m.text }))) : [el("div", { class: "kk-sub", text: "없어요" })])),
    sum].filter(Boolean));
}
async function kkAnalyze(d, btn, paint) {
  const id = KK.open, uid = d.getAttribute("data-uid");
  if (!id || !uid) return;
  btn.disabled = true; btn.textContent = "분석 중…";
  try {
    const r = await api(`/api/kakao/person/${enc(uid)}/analyze`, "POST", { room: id });
    if (!d.isConnected) return;
    if (r && r.error) throw new Error(r.error);
    paint(r.analysis);
  } catch (e) {
    if (d.isConnected) { btn.disabled = false; btn.textContent = "요약 분석"; }
    toast(e.message, true);
  }
}

const kkSame = (a, b) => !kkSys(a) && !kkSys(b) && kkWho(a) === kkWho(b) && Math.floor(a.sentAt / 60000) === Math.floor(b.sentAt / 60000);
const kkKindLine = r => (r.kind === "group" || r.kind === "multi" ? "단체 대화방" : r.kind === "direct" || r.kind === "dm" ? "1:1 대화" : r.kind === "open" ? "오픈채팅" : "");
// Under a room's name: the hub's hint (the newest message, else the member count); a room without one says its kind.
// The group mark sits after the name (the prototype's "단체"); a room without a last line says what kind it is.
const kkTag = r => (r.kind === "group" || r.kind === "multi" ? "단체" : r.kind === "open" ? "오픈채팅" : "");
const kkSubLine = r => r.hint || (kkTag(r) ? "" : kkKindLine(r));
const kkRoom = id => KK.rooms.find(r => r.chatId === id) || null;
// Room search: a case-insensitive substring of the name; a query made only of consonants (ㄱㄴㄷ…) also matches the name's initial consonants.
const KK_CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
const kkCho = s => [...s].map(c => { const n = c.codePointAt(0) - 0xac00; return n >= 0 && n < 11172 ? KK_CHO[Math.floor(n / 588)] : c; }).join("");
function kkMatch(name, q) {
  q = q.trim().toLowerCase();
  if (!q) return true;
  const n = String(name ?? "").toLowerCase();
  return n.includes(q) || (/^[ㄱ-ㅎ]+$/.test(q) && kkCho(n).includes(q));
}
const kkSeen = () => document.visibilityState === "visible" && kkTl.offsetParent !== null && kkTl.clientHeight > 0;
const kkWide = () => !narrowChat();
const kkCoarse = () => matchMedia("(pointer: coarse), (max-width: 639px)").matches;

/* ---- the pane ---- */
const kkRooms = el("div", { class: "kk-rooms", id: "kk-rooms", "aria-label": "카카오톡 대화방" });
const kkHead = el("div", { class: "kk-head", id: "kk-head" });
const kkIn = el("div", { class: "kk-in", id: "kk-in" });
const kkTl = el("div", { class: "kk-tl", id: "kk-tl" }, kkIn);
const kkPill = el("button", { class: "btn kk-pill", id: "kk-pill", type: "button", hidden: true, onclick: () => kkToBottom() }, icon("down"), el("span", { text: "새 메시지" }));
const kkDrafts = el("div", { class: "kk-drafts", id: "kk-drafts" });
const kkEditBar = el("div", { class: "kk-edit", id: "kk-edit", hidden: true }, el("span", { text: "답장 초안을 고치는 중이에요" }), el("button", { class: "btn text", type: "button", "data-k": "cancel", text: "취소", onclick: () => kkEditCancel() }));
// The bar under the chat window is a request to the assistant (kkAskBot): it revises the open draft or writes a new one, and the reply card below asks for 보내기.
const KK_ASK = "요청을 입력하세요 · 예: 좀 더 짧게", KK_REVISE = "초안을 어떻게 고칠까요? · 예: 좀 더 짧게";
const kkTa = el("textarea", { id: "kk-text", rows: "1", autocomplete: "off", maxlength: "500", placeholder: KK_ASK, "aria-label": "답장 요청" });
const kkSendBtn = el("button", { class: "ib pri", id: "kk-send-btn", type: "submit", "aria-label": "요청 보내기", title: "요청 보내기" }, icon("send"));
const kkDraftBtn = el("button", { class: "cchip kk-dbtn", id: "kk-draft-btn", type: "button", onclick: () => kkMakeDraft() }, icon("spark"), el("span", { text: "답장 초안" }));
// 직접 보내기 (owner 2026-11-04): what is typed goes to the room as it is, past the assistant. It shows only with text, and never on another computer's room or while a draft is edited.
const kkDirectBtn = el("button", { class: "cchip kk-dbtn", id: "kk-direct-btn", type: "button", hidden: true, onclick: () => kkSendDirect() }, icon("send"), el("span", { text: "직접 보내기" }));
const kkDirectSync = () => { kkDirectBtn.hidden = !kkTa.value.trim() || !!KK.edit || !!KK.pc; };
kkTa.addEventListener("input", kkDirectSync);
const kkForm = el("form", { class: "sendrow kk-send", id: "kk-form", onsubmit: ev => { ev.preventDefault(); kkSend(); } }, kkTa, el("div", { class: "cbar" }, kkDraftBtn, kkDirectBtn), kkSendBtn);
// The room's reply card sits right under the chat it answers, above the request bar.
const kkFoot = el("div", { class: "composer kk-composer", id: "kk-foot" }, kkDrafts, kkEditBar, kkForm);
// 자동 초안 of the open room: the one two-value switch of this screen (the watch toggles are eyes). Built once; kkPaintAuto only flips it.
const kkAutoSw = el("button", { class: "kk-sw", type: "button", role: "switch", "aria-checked": "false", "aria-label": "자동 초안", "data-k": "auto", onclick: () => { const r = kkRoom(KK.open); if (r) kkSetRoom(r, { autoDraft: !r.autoDraft }); } }, el("span", { class: "kk-knob" }));
const kkAuto = el("span", { class: "kk-auto", id: "kk-auto", hidden: true }, el("span", { class: "cv-b" }, el("span", { class: "cv-n", text: "자동 초안" })), kkAutoSw);
// The one line under the room head: 미답장 (with 답장 안 함 while no draft card carries it) on the left, 자동 초안 on the right. Its left part is rebuilt only when what it shows changes.
const kkOwedL = el("span", { class: "kk-owed-l" });
const kkOwed = el("div", { class: "kk-owed", id: "kk-owed", hidden: true }, kkOwedL, kkAuto);
let kkOwedSig = "";
function kkPaintAuto() {
  const r = KK.open ? kkRoom(KK.open) : null, show = !!r && !!r.watched, owed = !!r && kkWatching() && !!r.unreplied, bare = owed && !KK.drafts.length, sig = `${KK.open}|${owed}|${bare}`;
  kkAuto.hidden = !show;
  if (show) { kkAutoSw.classList.toggle("on", !!r.autoDraft); kkAutoSw.setAttribute("aria-checked", r.autoDraft ? "true" : "false"); }
  if (sig !== kkOwedSig) { kkOwedSig = sig; clear(kkOwedL).append(...(owed ? [unrepPill(), ...(bare ? [kkNoReply(r)] : [])] : [])); }
  kkOwed.hidden = !show && !owed;
}
// A room that is not watched opens read-only: this bar (at every width) says so in place of the composer and starts watching it.
const kkRo = el("div", { class: "kk-ro", id: "kk-ro", role: "status", hidden: true });
const kkChat = el("div", { class: "kk-chat", id: "kk-chat" }, kkHead, kkOwed, el("div", { class: "kk-box" }, kkTl, kkPill), kkRo, kkFoot);
const kkPane = el("div", { class: "kk", id: "kk", hidden: true }, kkRooms, kkChat);
$("#v-monitoring").append(kkPane);
// Tapping a sender's avatar or name in a room opens his 사용자별 분석 panel.
kkTl.addEventListener("click", ev => {
  const t = ev.target.closest && ev.target.closest(".kk-name, .kk-av:not(.sp)");
  const m = t && t.closest("[data-log][data-author]");
  if (m && m.dataset.author) kkPerson(m.dataset.author);
});
// Preview cards load when they come near the visible timeline (one request per address, kkLpLoad).
if (typeof IntersectionObserver === "function") {
  kkLpIO = new IntersectionObserver(list => { for (const e of list) if (e.isIntersecting) { kkLpIO.unobserve(e.target); kkLpLoad(e.target); } }, { root: kkTl, rootMargin: "300px 0px" });
  kkTopIO = new IntersectionObserver(list => { if (list.some(e => e.isIntersecting)) kkOlder(); }, { root: kkTl, rootMargin: "200px 0px 0px 0px" });
}

const kkAutosize = () => { kkTa.style.height = "auto"; kkTa.style.height = `${Math.min(kkTa.scrollHeight, 140)}px`; };
kkTa.addEventListener("input", () => { kkAutosize(); if (KK.open) KK.typed.set(KK.open, kkTa.value); });
// Enter sends on a desktop; Shift+Enter, and Enter on a phone or a narrow screen, is a new line. The IME's own Enter (isComposing) never sends.
kkTa.addEventListener("keydown", ev => {
  if (ev.key !== "Enter" || ev.shiftKey || ev.isComposing || ev.keyCode === 229 || kkCoarse()) return;
  ev.preventDefault();
  kkSend();
});
// A tap on send must not take focus from the textarea: the phone keyboard would close and the click would not land (same as the chat composer).
kkSendBtn.addEventListener("pointerdown", ev => ev.preventDefault());
kkTl.addEventListener("scroll", () => kkSyncStick(), { passive: true });
for (const ev of ["wheel", "touchstart", "pointerdown", "keydown"]) kkTl.addEventListener(ev, () => { KK.pin = ""; }, { passive: true });
// The pane resizes when the keyboard opens or the composer grows: a view at the bottom stays there.
let kkH = 0;
new ResizeObserver(() => {
  const h = kkTl.clientHeight, grew = kkH && h !== kkH;
  kkH = h;
  if (!h || !KK.open || KK.loading) return;
  if (grew && KK.stick && kkTl.scrollHeight - kkTl.scrollTop - h > 1) kkTl.scrollTop = kkTl.scrollHeight;
  else if (!KK.placed) kkPlace();
}).observe(kkTl);
// The content grows after it is painted (an image box, a font, a bubble that wraps): a view at the bottom keeps the newest message in sight.
new ResizeObserver(() => {
  if (KK.open && !KK.loading && KK.placed && KK.stick && kkTl.scrollHeight - kkTl.scrollTop - kkTl.clientHeight > 1) kkTl.scrollTop = kkTl.scrollHeight;
}).observe(kkIn);

/* ---- rooms: choose which to watch, and the watched ones as conversation rows ---- */
async function kkLoadRooms() {
  const seq = ++KK.rseq;
  try {
    const r = await api("/api/kakao/rooms");
    if (seq !== KK.rseq) return;
    KK.on = r.on !== false; KK.error = typeof r.error === "string" ? r.error : ""; KK.rooms = Array.isArray(r.rooms) ? r.rooms : [];
    KK.loaded = true; KK.failed = false;
  } catch (e) {
    if (seq !== KK.rseq) return;
    KK.failed = true; KK.loaded = true; KK.rooms = []; KK.error = "대화방 목록을 불러오지 못했어요";
  }
  // A room that is not watched stays open (read-only); only a room gone from the list closes.
  if (KK.open && !kkRoom(KK.open) && !KK.failed) kkClose();
  kkPaintRooms();
  if (KK.open) kkPaintChat();
  convSig = ""; convSchedule();   // the 채팅 list's 메일 · 카카오톡 card
}
function kkSwitch(on, label, key, change, small) {
  return el("button", { class: `kk-sw${on ? " on" : ""}${small ? " sm" : ""}`, type: "button", role: "switch", "aria-checked": on ? "true" : "false", "aria-label": label, "data-k": key, onclick: ev => { ev.stopPropagation(); change(!on); } }, el("span", { class: "kk-knob" }));
}
async function kkSetRoom(r, patch) {
  const was = { watched: r.watched, autoDraft: r.autoDraft };
  Object.assign(r, patch);
  if (patch.watched === false) r.autoDraft = false;
  kkPaintRooms();
  try {
    await api(`/api/kakao/rooms/${enc(r.chatId)}`, "PUT", patch);
    if (patch.watched !== undefined && KK.open === r.chatId) {
      if (KK.room) KK.room.watched = patch.watched;
      if (!patch.watched) r.unreplied = false;
      kkPaintChat();
      kkTail();
    }
    kkIntgSoon();
  } catch (e) {
    Object.assign(r, was);
    kkPaintRooms();
    toast(e.message, true);
  }
}
const kkSearch = el("input", { id: "kk-q", type: "search", placeholder: "대화방 검색", "aria-label": "대화방 검색", autocomplete: "off", enterkeyhint: "search" });
// Typing refilters only the list: the input itself stays in place (it keeps focus and the IME composition).
kkSearch.addEventListener("input", () => { KK.q = kkSearch.value; const pl = $("#kk-pl"); if (pl) clear(pl).append(...kkPickRows()); });
const kkLine1 = (r, name) => el("span", { class: "kk-l1" }, name, kkTag(r) ? el("span", { class: "kk-grp", text: kkTag(r) }) : null);
// The 지켜볼 대화방 list: every room, and a tap on the row adds it to the watched ones or takes it off again. A watched row is the list's selected row with a check; never a switch (the one switch is the room's 자동 초안 card).
const kkPickRow = r => el("button", { class: `pl-row kk-pr${r.watched ? " on" : ""}`, type: "button", role: "checkbox", "aria-checked": r.watched ? "true" : "false", "data-chat": r.chatId, onclick: () => kkSetRoom(r, { watched: !r.watched }) },
  kkAvatar(r.name),
  el("span", { class: "cv-b" }, kkLine1(r, el("span", { class: "cv-n", title: r.name, text: r.name })), kkSubLine(r) ? el("span", { class: "cv-p", text: kkSubLine(r) }) : null),
  r.watched ? icon("check", "kk-ck") : null);
function kkPickRows() {
  const list = KK.rooms.filter(r => kkMatch(r.name, KK.q));
  return list.length ? list.map(kkPickRow) : [el("div", { class: "kk-note", id: "kk-nomatch", role: "status", text: "찾는 대화방이 없어요" })];
}
function kkAddOpen() {
  if (KK.adding) return;
  KK.q = ""; kkSearch.value = "";
  const d = el("dialog", { class: "kk-pd kk-add", id: "kk-add", "aria-label": "지켜볼 대화방" },
    el("div", { class: "kk-pd-in", tabindex: "-1", autofocus: true },
      fsHead([el("h2", { class: "fs-t", text: "지켜볼 대화방" })], { close: () => d.close() }),
      el("div", { class: "kk-pd-b" }, el("label", { class: "pl-search kk-search" }, icon("search"), kkSearch), el("div", { class: "pl-list kk-pl", id: "kk-pl" }, ...kkPickRows()))));
  KK.adding = d;
  d.addEventListener("click", ev => { if (ev.target === d) d.close(); });
  document.body.append(d); d.showModal(); dialogHist(d);
  d.addEventListener("close", () => { if (KK.adding === d) KK.adding = null; d.remove(); });
}
function kkRow(r) {
  const on = KK.open === r.chatId, sub = kkSubLine(r), time = r.lastAt ? el("span", { class: "kk-t", text: kkListTime(r.lastAt) }) : null;
  return el("button", { class: `cv-row pv kk-row${r.unread ? " unread" : ""}${on ? " on" : ""}`, type: "button", "data-chat": r.chatId, "aria-current": on ? "true" : null, onclick: () => kkOpen(r.chatId) },
      kkAvatar(r.name),
      el("span", { class: "cv-b" }, kkLine1(r, el("span", { class: "cv-n", title: r.name, text: r.name })), sub ? el("span", { class: "cv-p", text: sub }) : null),
      // The row end like every list: the time on top, 미답장 and the unread count under it.
      time || r.unread || r.unreplied ? el("span", { class: "cv-m" }, time, r.unread || r.unreplied ? el("span", { class: "kk-rmeta" },
        r.unreplied ? unrepPill() : null,
        r.unread ? el("span", { class: "nb", "aria-label": `읽지 않은 메시지 ${r.unread}개`, text: r.unread > 99 ? "99+" : String(r.unread) }) : null) : null) : null);
}
function kkPaintRooms() {
  const top = kkRooms.scrollTop, watched = KK.rooms.filter(r => r.watched).sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0));
  const note = !KK.loaded ? "불러오는 중…" : !KK.on ? "카카오톡 연동이 꺼져 있어요" : KK.error, ready = KK.loaded && !note;
  const shown = watched.filter(kkViewOf()[2]);
  const head = el("div", { class: "kk-lh" }, ...(ready && watched.length ? [kkViewBar(watched)] : [el("span", { class: "kk-pt", text: "지켜보는 대화방" }), el("span", { class: "kk-cnt", text: ready ? "0개" : "" })]),
    ready && KK.rooms.length ? el("button", { class: "btn tonal sm kk-add-btn", id: "kk-add-btn", type: "button", onclick: () => kkAddOpen() }, icon("add"), el("span", { text: "추가" })) : null);
  const list = el("section", { class: "pl-list kk-watch", "aria-label": "지켜보는 대화방" });
  if (note) list.append(el("div", { class: "kk-note", role: "status", text: note }));
  else if (shown.length) list.append(...shown.map(kkRow));
  else list.append(el("div", { class: "kk-note", id: "kk-empty", text: watched.length ? kkViewOf()[3] : KK.rooms.length ? "지켜볼 대화방을 추가해 주세요" : "고를 수 있는 대화방이 없어요" }));
  // The status of the watches the app owns (its new-message check, a login keeper) is at the top of the pane, on this computer and on the other alike.
  const own = (kkItemNow() || {}).owned || [];
  clear(kkRooms).append(...[own.length ? el("section", { class: "kk-own", "aria-label": "감시 상태" }, ...own.map(monStatNode)) : null, head, list].filter(Boolean));
  kkRooms.scrollTop = top;
  // The choice list repaints in place: a row with the keyboard focus keeps it.
  const pl = KK.adding && $("#kk-pl");
  if (pl) {
    const had = pl.contains(document.activeElement) && document.activeElement.dataset.chat;
    clear(pl).append(...kkPickRows());
    if (had) { const n = [...pl.children].find(x => x.dataset.chat === had); if (n) n.focus({ preventScroll: true }); }
  }
  kkPaintAuto();
}

/* ---- the chat ---- */
function kkPaintAll() {
  kkPane.classList.toggle("chat-open", !!KK.open);
  kkPaintRooms(); kkPaintChat();
}
function kkPaintChat() {
  const open = !!KK.open, room = kkRoom(KK.open), info = KK.room || room || {};
  kkFoot.hidden = !open || KK.loading || !!KK.roomErr;
  kkPill.hidden = !(open && KK.pill);
  const app = monSettingsApp(kkItemNow()), watching = kkWatching(), owed = watching && !!(room && room.unreplied), sig = `${KK.open}|${info.name}|${info.group}|${app}|${!!AS.by[app]}|${owed}|${watching}`;
  const readOnly = open && !KK.loading && !KK.roomErr && !watching;
  kkFoot.hidden = kkFoot.hidden || !watching;
  kkRo.hidden = !readOnly;
  kkPaintAuto();
  if (readOnly) clear(kkRo).append(el("span", { class: "kk-ro-t", text: "감시하지 않는 방이에요. 읽기만 할 수 있어요" }), room ? el("button", { class: "btn tonal sm", type: "button", "data-k": "watch", text: "감시 시작", onclick: () => kkSetRoom(room, { watched: true }) }) : null);
  if (sig !== KK.headSig) {
    KK.headSig = sig;
    clear(kkHead);
    if (open) kkHead.append(kkAvatar(info.name), el("span", { class: "cv-b" }, el("span", { class: "cv-n", text: info.name || "" }), el("span", { class: "cv-p", text: kkKindLine(info) || (info.group ? "단체 대화방" : "1:1 대화") })), ...asEntry(app));
    monSchedule();   // the item's head gives the gear to the room head while a room is open
  }
  if (!open) { clear(kkIn).append(el("div", { class: "kk-note", text: "대화방을 골라 주세요" })); return; }
  if (KK.loading) { clear(kkIn).append(el("div", { class: "kk-note", text: "불러오는 중…" })); return; }
  if (KK.roomErr) { clear(kkIn).append(el("div", { class: "kk-note", role: "status", text: KK.roomErr })); return; }
  kkPaintTl(KK.stick);
  kkPaintFoot();
}
// Whether the open room is watched (drafts, sending, 미답장): the room list's flag, else what the chat answer said.
function kkWatching() {
  const r = kkRoom(KK.open);
  return r ? !!r.watched : !!(KK.room && KK.room.watched !== false);
}
// 답장 안 함 of the open room: the pill leaves the header and the room row at the tap; a failed request puts it back.
function kkNoReply(r) {
  return el("button", { class: "cchip unrep-no", type: "button", "data-k": "no-reply", text: "답장 안 함", onclick: ev => {
    ev.stopPropagation();
    r.unreplied = false;
    kkPaintRooms(); kkPaintChat();
    api(`/api/kakao/chat/${enc(r.chatId)}/no-reply`, "POST", {}).then(() => { toast("답장 안 함으로 표시했어요"); loadIntegrations(); }, e => {
      r.unreplied = true;
      kkPaintRooms(); kkPaintChat();
      toast(e.message, true);
    });
  } });
}
const kkDateNode = t => el("div", { class: "kk-date", text: kkDate(t) });
const kkMarkNode = () => el("div", { class: "kk-new", role: "separator", "aria-label": "여기부터 읽지 않은 메시지" }, el("span", { text: "여기까지 읽었어요" }));
function kkMsgNode(m, first, last) {
  if (kkSys(m)) { const line = kkSysText(m.text); return line ? el("div", { class: "kk-sys", role: "note", "data-log": m.logId, text: line }) : null; }
  const group = !!(KK.room && KK.room.group), { text, ph } = kkBody(m);
  // Plain words with an address: the address is a link and each one gets a preview card under the bubble.
  const urls = !m.media && !ph ? kkUrls(text) : [];
  const bub = (m.media && kkMediaNode(m, m.media)) || el("div", { class: `kk-bub${ph ? " ph" : ""}${urls.length ? " kk-lb" : ""}` }, urls.length ? kkLinkText(text) : text);
  const previews = urls.length ? el("div", { class: "kk-lps" }, ...urls.map(kkLpCard)) : null;
  // On the time side of the bubble: KakaoTalk's yellow number (members who have not read it yet) above the time; nothing when 0.
  const n = m.unread | 0, meta = n > 0 || last ? el("span", { class: "kk-meta" }, n > 0 ? el("span", { class: "kk-rd", "aria-label": `아직 안 읽은 사람 ${n}명`, text: String(n) }) : null, last ? el("span", { class: "kk-time", text: kkTime(m.sentAt) }) : null) : null;
  if (m.fromMe) return el("div", { class: `kk-m me${first ? " first" : ""}`, "data-log": m.logId }, el("div", { class: "kk-line" }, meta, bub), previews);
  return el("div", { class: `kk-m in${first ? " first" : ""}`, "data-log": m.logId, "data-author": m.authorId || null },
    group ? (first ? kkAvatar(m.sender) : el("span", { class: "kk-av sp", "aria-hidden": "true" })) : null,
    el("div", { class: "kk-mb" }, first ? el("div", { class: "kk-name", text: m.sender || "알 수 없음" }) : null, el("div", { class: "kk-line" }, bub, meta), previews));
}
// Sends of this room that are not (yet) a message of the room: sending, failed, or just sent and not read back from the database yet.
function kkPending() {
  return KK.sends.filter(s => {
    if (KK.hidden.has(s.id)) return false;
    if (s.state === "failed") return true;
    // A draft of several messages is in the room once its last message is.
    const last = String(s.text).split(/\n[ \t]*\n/).map(p => p.trim()).filter(Boolean).pop();
    if (KK.msgs.some(m => m.fromMe && (m.text === s.text || m.text === last) && m.sentAt >= s.at - 60000)) return false;
    return s.state !== "sent" || Date.now() - s.at < 120000;
  });
}
function kkSendNode(s) {
  const failed = s.state === "failed", st = failed ? `실패${s.reason ? ` · ${s.reason}` : ""}` : s.state === "sent" ? "보냄" : "보내는 중";
  return el("div", { class: `kk-m me pend ${s.state} first`, "data-send": s.id },
    el("div", { class: "kk-line" }, el("div", { class: "kk-bub", text: s.text })),
    el("div", { class: "kk-st", role: failed ? "alert" : "status" }, s.state === "sent" ? rqSentNode() : el("span", { class: "kk-state", text: st }),
      failed ? el("button", { class: "btn text", type: "button", "data-k": "retry", text: "다시 보내기", onclick: () => kkRetry(s) }) : null,
      failed ? el("button", { class: "btn text", type: "button", "data-k": "dismiss", text: "지우기", onclick: () => kkDeleteSend(s) }) : null));
}
function kkTimeline() {
  const out = [], msgs = KK.msgs;
  if (KK.more) out.push(el("div", { class: "kk-top", id: "kk-top" }, el("button", { class: "btn text kk-more", type: "button", text: "이전 메시지 더 보기", onclick: () => kkOlder() })));
  let prev = null;
  msgs.forEach((m, i) => {
    const newDay = !prev || kkDay(prev.sentAt) !== kkDay(m.sentAt), mark = !!KK.div && m.logId === KK.div, next = msgs[i + 1], gapBefore = !!prev && KK.gaps.has(prev.logId);
    if (newDay) out.push(kkDateNode(m.sentAt));
    if (mark) out.push(kkMarkNode());
    // Name and avatar once per run of one sender (like KakaoTalk); the time once per same-minute run.
    const cont = !!prev && !newDay && !mark && !gapBefore && !kkSys(prev) && kkWho(prev) === kkWho(m);
    const nextCont = !!next && !KK.gaps.has(m.logId) && kkDay(next.sentAt) === kkDay(m.sentAt) && !(KK.div && next.logId === KK.div) && kkSame(m, next);
    const node = kkMsgNode(m, !cont, !nextCont);
    // A row with nothing visible in it (an empty body, a record this build does not draw) leaves no blank space.
    if (node && (node.textContent.trim() || node.querySelector("img, audio, video, button, a"))) out.push(node);
    if (next && KK.gaps.has(m.logId)) out.push(kkGapNode(m.logId));
    prev = m;
  });
  out.push(...kkPending().map(kkSendNode));
  if (!out.length) out.push(el("div", { class: "kk-note", text: "아직 받은 메시지가 없어요" }));
  return out;
}
function kkPaintTl(stick) {
  const keep = kkTl.scrollTop;
  kkLpIO?.disconnect();
  kkTopIO?.disconnect();
  clear(kkIn).append(...kkTimeline());
  kkTl.scrollTop = stick ? kkTl.scrollHeight : keep;
  kkTopWatch();
  kkLpWatch();
  kkSyncStick();
}
// Where the unread line goes (it is drawn, the view still opens at the newest message): before the first message after the web's read position; never opened: KakaoTalk's own unread count says how many of the newest are unread.
function kkMarker(msgs, read, unread) {
  if (read != null) { const m = msgs.find(x => !x.fromMe && kkGt(x.logId, read)); return m ? m.logId : ""; }
  if (unread > 0) { const tail = msgs.filter(x => !x.fromMe).slice(-unread); return tail.length ? tail[0].logId : ""; }
  return "";
}
// A room opens at its newest message, like KakaoTalk.
function kkPlace() {
  if (!kkTl.clientHeight) return;
  kkTl.scrollTop = kkTl.scrollHeight;
  KK.placed = true;
  kkSyncStick();
}
function kkSyncStick() {
  KK.stick = kkTl.scrollTop + kkTl.clientHeight >= kkTl.scrollHeight - 40;
  if (KK.stick && KK.pill) { KK.pill = false; kkPill.hidden = true; }
  kkMaybeRead();
}
function kkToBottom() { KK.pill = false; kkPill.hidden = true; kkTl.scrollTop = kkTl.scrollHeight; kkSyncStick(); }

async function kkOpen(id) {
  const r = kkRoom(id);
  if (!r) return;
  if (KK.open) KK.typed.set(KK.open, kkTa.value);
  const seq = ++KK.seq;
  Object.assign(KK, { open: id, room: { chatId: id, name: r.name, kind: r.kind, group: r.kind === "group" || r.kind === "multi" || r.kind === "open", watched: !!r.watched }, msgs: [], gaps: new Set(), more: false, read: null, div: "", drafts: [], sends: [], ask: null, hidden: new Set(),
    loading: true, roomErr: "", pill: false, stick: true, pin: "", placed: false, readSent: "", edit: null, drafting: "", revise: null, reviseCode: "" });
  kkTa.value = KK.typed.get(id) || ""; kkAutosize();
  kkPaintAll(); convTitle();
  try {
    const d = await api(`/api/kakao/chat/${enc(id)}?limit=${KK_PAGE}`);
    if (seq !== KK.seq) return;
    KK.room = d.room || KK.room; KK.msgs = Array.isArray(d.messages) ? d.messages : []; KK.read = d.read ?? null;
    KK.ask = kkAskOf(d); KK.drafts = Array.isArray(d.drafts) ? d.drafts : []; KK.sends = Array.isArray(d.sends) ? d.sends : [];
    KK.more = KK.msgs.length >= KK_PAGE; KK.div = kkMarker(KK.msgs, KK.read, d.kakaoUnread | 0);
    KK.loading = false; KK.pin = "bottom";
    kkPaintAll(); convTitle();
    kkPlace();
  } catch (e) {
    if (seq !== KK.seq) return;
    KK.loading = false; KK.roomErr = e.message || "대화를 불러오지 못했어요";
    kkPaintAll();
  }
}
function kkClose() {
  if (KK.open) KK.typed.set(KK.open, kkTa.value);
  KK.open = ""; KK.seq++; KK.loading = false; KK.roomErr = ""; KK.edit = null;
  kkPaintAll(); convTitle();
}
// Phone, or a KakaoTalk room in a split pane (43-panes-view.js paneMonIn): the app bar's back arrow leaves the chat for the room list first (04-state.js #back).
function kkBack() {
  if (!(KK.vis && KK.open && (narrowChat() || paneMonIn()) && current === "monitoring" && !MON.list)) return false;
  kkClose();
  return true;
}
// The older page, one load in flight at a time (an auto-load at the top and the fallback button share it). The message that was at the top
// of the view keeps its offset: the content added above it never moves the reader.
async function kkOlder() {
  const id = KK.open, first = KK.msgs[0];
  if (!id || !first) return;
  if (KK.olderBusy) { KK.olderAgain = true; return; }
  KK.olderBusy = true;
  const edge = kkTl.getBoundingClientRect().top;
  const shown = [...kkTl.querySelectorAll("[data-log]")];
  const anchor = shown.find(n => n.getBoundingClientRect().bottom > edge + 1) || shown[0];
  const anchorId = anchor ? anchor.dataset.log : first.logId;
  const before = anchor ? anchor.getBoundingClientRect().top - edge : 0;
  try {
    const d = await api(`/api/kakao/chat/${enc(id)}?limit=${KK_PAGE}&before=${enc(first.logId)}`);
    if (KK.open !== id) return;
    const got = Array.isArray(d.messages) ? d.messages : [], have = new Set(KK.msgs.map(m => m.logId));
    KK.msgs = [...got.filter(m => !have.has(m.logId)), ...KK.msgs]; KK.more = got.length >= KK_PAGE; KK.pin = "";
    const h = kkTl.scrollHeight;
    kkLpIO?.disconnect();
    kkTopIO?.disconnect();
    clear(kkIn).append(...kkTimeline());
    const now = kkTl.querySelector(`[data-log="${anchorId}"]`);
    kkTl.scrollTop += now ? now.getBoundingClientRect().top - edge - before : kkTl.scrollHeight - h;
    kkTopWatch();
    kkLpWatch();
    kkSyncStick();
  } catch (e) { toast(e.message, true); }
  finally {
    KK.olderBusy = false;
    if (KK.olderAgain) {
      KK.olderAgain = false;
      const top = $("#kk-top", kkIn);
      if (top && KK.more && top.getBoundingClientRect().bottom > kkTl.getBoundingClientRect().top) kkOlder();
    }
  }
}
// New messages after the last one we hold; also refreshes the room's drafts and sends (the answer carries both).
async function kkTail() {
  const id = KK.open;
  if (!id || KK.loading || KK.roomErr) return;
  if (KK.tailing) { KK.again = true; return; }
  KK.tailing = true;
  try {
    do {
      KK.again = false;
      // Pages of rows after the newest one we hold: a full page means more wait behind it (a burst of more than KK_PAGE).
      for (let fresh = KK_PAGE; fresh >= KK_PAGE;) {
        const last = KK.msgs.length ? KK.msgs[KK.msgs.length - 1].logId : "";
        const d = await api(`/api/kakao/chat/${enc(id)}?limit=${KK_PAGE}${last ? `&after=${enc(last)}` : ""}`);
        if (KK.open !== id) return;
        fresh = kkApply(d);
      }
      // A row can land below the newest logId we hold (a late sync): the newest page is read again and merged in logId order.
      const d = await api(`/api/kakao/chat/${enc(id)}?limit=${KK_PAGE}`);
      if (KK.open !== id) return;
      kkApply(d);
    } while (KK.again);
  } catch { /* the next event or the minute timer asks again */ } finally { KK.tailing = false; }
}
function kkApply(d) {
  const have = new Set(KK.msgs.map(m => m.logId)), fresh = (Array.isArray(d.messages) ? d.messages : []).filter(m => !have.has(m.logId));
  if (Array.isArray(d.drafts)) {
    KK.drafts = d.drafts; KK.ask = kkAskOf(d);
    // A peer's room gets no draft event: its old draft going away is the new one landing.
    if (KK.pc && KK.drafting === KK.open && KK.reviseCode && !d.drafts.some(x => x.code === KK.reviseCode)) { KK.drafting = ""; clearTimeout(KK.draftT); }
  }
  if (Array.isArray(d.sends)) KK.sends = d.sends;
  if (d.room) KK.room = d.room;
  if (fresh.length) KK.msgs = [...KK.msgs, ...fresh].sort((a, b) => (kkGt(a.logId, b.logId) ? 1 : kkGt(b.logId, a.logId) ? -1 : 0));
  const stick = KK.stick || fresh.some(m => m.fromMe);
  if (fresh.some(m => !m.fromMe) && !stick) { KK.pill = true; kkPill.hidden = false; }
  if (stick) KK.pin = "bottom";
  // The open room's own row follows the same rows just appended (one source of truth per room).
  const row = kkRoom(KK.open), last = KK.msgs[KK.msgs.length - 1];
  if (fresh.length && row && last) {
    row.hint = kkHint(last); row.lastAt = last.sentAt;
    row.unread = stick ? 0 : (row.unread | 0) + fresh.filter(m => !m.fromMe).length;
    kkPaintRooms();
  }
  kkPaintTl(stick);
  kkPaintFoot();
  return fresh.length;
}
function kkMaybeRead() {
  if (!KK.open || !KK.placed || !KK.stick || KK.loading || !kkSeen()) return;
  const last = KK.msgs.length ? KK.msgs[KK.msgs.length - 1].logId : "";
  if (!last || (KK.readSent && !kkGt(last, KK.readSent))) return;
  const id = KK.open, prev = KK.readSent;
  KK.readSent = last;
  api(`/api/kakao/chat/${enc(id)}/read`, "POST", { logId: last }).then(() => {
    const r = kkRoom(id);
    if (r && r.unread) { r.unread = 0; kkPaintRooms(); }
    kkIntgSoon();
  }, () => { if (KK.readSent === last) KK.readSent = prev; });
}
// KakaoTalk's read counters changed: ask for the numbers of the shown messages (no bodies) and repaint when any changed.
async function kkReads() {
  const id = KK.open, first = KK.msgs[0];
  if (!id || !first || KK.loading || KK.roomErr) return;
  if (KK.reading) { KK.readAgain = true; return; }
  KK.reading = true;
  try {
    do {
      KK.readAgain = false;
      const d = await api(`/api/kakao/chat/${enc(id)}/reads?from=${enc(KK.msgs[0].logId)}`);
      if (KK.open !== id) return;
      const counts = d && d.counts || {};
      let changed = false;
      for (const m of KK.msgs) if (m.logId in counts && (m.unread | 0) !== counts[m.logId]) { m.unread = counts[m.logId]; changed = true; }
      if (changed) kkPaintTl(KK.stick);
    } while (KK.readAgain);
  } catch { /* the next event or the minute timer asks again */ } finally { KK.reading = false; }
}
const kkIntgSoon = () => { clearTimeout(KK.intgT); KK.intgT = setTimeout(loadIntegrations, 500); };

/* ---- sending ---- */
function kkAddSend(r, text) {
  if (r && r.id && !KK.sends.some(s => s.id === r.id)) KK.sends.push({ id: r.id, text, state: r.state || "sending", at: Date.now() });
}
// text = what the owner wrote; edit = the draft being edited (the send then goes through the draft's route with the edited text).
async function kkSendText(text, edit) {
  const id = KK.open;
  if (!id || !text || KK.sending) return;
  KK.sending = true;
  try {
    const r = await api(edit ? `/api/kakao/drafts/${enc(edit.code)}/send` : `/api/kakao/chat/${enc(id)}/send`, "POST", { text });
    if (KK.open === id) {
      kkAddSend(r, text);
      if (edit) KK.drafts = KK.drafts.filter(d => d.code !== edit.code);
      KK.stick = true; KK.pin = "bottom";
      kkPaintTl(true); kkPaintFoot();
    }
    return true;
  } catch (e) {
    toast(e.message, true);
    kkTail();
    return false;
  } finally { KK.sending = false; }
}
// The request bar under the chat window: what the owner types goes to the assistant, never straight to the room. With a draft waiting it is the change to make
// (POST .../draft { revise }, the newest draft), else it says what the new message is (POST .../draft { intent }); the reply card then asks for 보내기, and the
// draft is split into the natural messages the existing flow already makes (d.parts).
function kkAskBot(text) {
  const id = KK.open;
  if (KK.drafting === id) { toast("초안을 만드는 중이에요 · 끝나면 다시 요청해 주세요", true); return; }
  // The other computer's gateway takes a revise ({revise}) but not a new message's intent (34-peer-monitoring.js kakao draft): say so instead of making an unrelated draft there.
  if (KK.pc && !KK.drafts.length) { toast("다른 컴퓨터의 방에서는 초안을 만든 뒤에 고쳐 달라고 요청할 수 있어요", true); return; }
  const ts = x => (typeof x === "number" ? x : Date.parse(x) || 0), d = KK.drafts.slice().sort((a, b) => ts(b.created) - ts(a.created))[0];
  kkTa.value = ""; KK.typed.delete(id); kkAutosize(); kkDirectSync();
  KK.revise = null;
  if (d) kkMakeDraft(undefined, { code: d.code, change: text.slice(0, 500) }); else kkComposeMake(text);
  if (kkWide()) kkTa.focus();
}
async function kkSendDirect() {
  const text = kkTa.value.trim(), id = KK.open;
  if (!id || !text || KK.sending) return;
  kkTa.value = ""; KK.typed.delete(id); kkAutosize(); kkDirectSync();
  const ok = await kkSendText(text);
  if (!ok && KK.open === id && !kkTa.value) { kkTa.value = text; kkAutosize(); kkDirectSync(); }
}
async function kkSend() {
  const text = kkTa.value.trim(), edit = KK.edit;
  if (!KK.open || !text || KK.sending) return;
  if (!edit) { kkAskBot(text); return; }
  const id = KK.open;
  kkTa.value = ""; KK.typed.delete(id); KK.edit = null; kkAutosize(); kkPaintFoot();
  const ok = await kkSendText(text, edit);
  if (!ok && KK.open === id && !kkTa.value) { kkTa.value = text; kkAutosize(); }
  if (!kkTa.disabled && kkWide()) kkTa.focus();
}
// The failed send is deleted on the gateway (the stored record, so no other web or reload shows it again); a 404 means it is already gone.
async function kkDeleteSend(s) {
  const id = KK.open;
  try {
    await api(`/api/kakao/chat/${enc(id)}/send/${enc(s.id)}`, "DELETE");
  } catch (e) {
    toast(e.message, true);
    return false;
  }
  if (KK.open === id) { KK.sends = KK.sends.filter(x => x.id !== s.id); kkPaintTl(KK.stick); }
  return true;
}
// 다시 보내기 goes through the gateway, which knows what the failed send was: a draft's send resumes from its first unsent part, one
// message each (never the joined text as one message); a typed send goes again as typed.
async function kkRetry(s) {
  const id = KK.open;
  if (!id || KK.sending) return;
  KK.sending = true;
  try {
    const r = await api(`/api/kakao/chat/${enc(id)}/send/${enc(s.id)}/retry`, "POST", {});
    if (KK.open !== id) return;
    KK.sends = KK.sends.filter(x => x.id !== s.id);
    if (r && r.id && !KK.sends.some(x => x.id === r.id)) KK.sends.push({ id: r.id, text: s.text, state: r.state || "sending", at: Date.now(), ...(s.draft ? { draft: s.draft } : {}) });
    if (s.draft) KK.drafts = KK.drafts.filter(d => d.code !== s.draft);
    KK.stick = true; KK.pin = "bottom";
    kkPaintTl(true); kkPaintFoot();
  } catch (e) {
    toast(e.message, true);
    kkTail();
  } finally { KK.sending = false; }
}
async function kkSendEvent(e) {
  const s = KK.sends.find(x => x.id === e.id);
  if (e.state === "deleted") { if (s) { KK.sends = KK.sends.filter(x => x.id !== e.id); kkPaintTl(KK.stick); } return; }
  if (!s) { kkTail(); return; }
  s.state = e.state; s.reason = e.reason;
  kkPaintTl(KK.stick);
  if (e.state === "sent") kkTail();
}

/* ---- drafts ---- */
// The room's open question (the draft model found that the last message needs the owner's decision): { question, choices } or null.
const kkAskOf = d => (d && d.ask && typeof d.ask.question === "string" && Array.isArray(d.ask.choices) && d.ask.choices.length ? d.ask : null);
// The question with one button per choice: a pick makes the draft for it (one model call, then the normal 보내기 / 고치기 / 버리기 card); 직접 쓸게 forgets the question and opens the composer.
function kkAskCard() {
  const a = KK.ask, id = KK.open;
  if (!a || KK.drafting === id) return null;
  const own = async ev => {
    ev.currentTarget.disabled = true;
    try { await api(`/api/kakao/chat/${enc(id)}/ask/drop`, "POST", {}); } catch (e) { toast(e.message, true); }
    if (KK.open !== id) return;
    KK.ask = null; kkPaintFoot(); kkTa.focus();
  };
  return el("div", { class: "kk-draft kk-ask" },
    el("div", { class: "kk-dh", text: "답장 전에 골라 주세요" }),
    el("div", { class: "kk-dt", text: a.question }),
    el("div", { class: "btns kk-choices" },
      ...a.choices.map((c, i) => el("button", { class: "btn tonal", type: "button", "data-k": "pick", "data-i": String(i), text: c, onclick: () => kkMakeDraft(c) })),
      el("button", { class: "btn text", type: "button", "data-k": "own", text: "직접 쓸게", onclick: own })));
}
// 고치기 asks what to change; the bot rewrites the draft (one model call, POST .../draft { revise }) and the old draft stays until the new one lands.
// 고치기 on a draft: what to change, typed once (the model rewrites it), or 직접 수정 in the composer. The one reply card's field (10-reply-card.js).
function kkReviseBox(d, rv) {
  return rqReviseNode({ value: rv.text, onInput: v => { rv.text = v; }, go: change => { KK.revise = null; kkMakeDraft(undefined, { code: d.code, change }); },
    cancel: () => { KK.revise = null; kkPaintFoot(); }, manual: () => { KK.revise = null; kkEdit(d); } });
}
// A draft of several KakaoTalk messages (d.parts) shows one bubble per message, in the order they go out; one 보내기 sends them all.
const kkDraftParts = d => (Array.isArray(d.parts) && d.parts.length ? d.parts : [d.text]);
const kkDraftLabel = d => `${d.intent ? "새 메시지 초안" : "답장 초안"}${kkDraftParts(d).length > 1 ? ` · 메시지 ${kkDraftParts(d).length}개` : ""}`;
// 되돌리기 on the 보내지 않았어요 toast: the dropped draft waits again (POST .../restore; a peer's room on its own computer, 34-peer-monitoring.js).
async function kkRestore(code) {
  try { await api(`/api/kakao/drafts/${enc(code)}/restore`, "POST", {}); toast("초안을 되돌렸어요"); kkTail(); kkIntgSoon(); } catch (e) { toast(e.message, true); }
}
// The room's draft as the one reply card (10-reply-card.js): the same head, body and 보내기 · 고치기 · 보내지 않기 as the 답장 확인 queue.
function kkDraftCard(d) {
  const run = async (btn, fn) => { btn.disabled = true; try { await fn(); } catch (e) { toast(e.message, true); kkTail(); } finally { btn.disabled = false; } };
  const making = !!KK.open && KK.drafting === KK.open && KK.reviseCode === d.code, rv = !making && KK.revise && KK.revise.code === d.code ? KK.revise : null;
  // The card sits right under the chat it answers: no head, quoted original or 첨부 line (10-reply-card.js bare); the draft's messages are yellow bubbles that scroll inside the card, the buttons stay.
  const card = { key: `kk:${d.code}`, cls: "kk-draft", attrs: { "data-code": d.code }, bare: true, label: kkDraftLabel(d), labelCls: "kk-dh",
    body: { text: d.text, parts: kkDraftParts(d), one: true, full: true, sentParts: d.sentParts, cls: "kk-dt kk-dps", partCls: "kk-dp" } };
  if (making) return rqCard({ ...card, status: "고치는 중…" });
  if (rv) return rqCard({ ...card, revise: kkReviseBox(d, rv) });
  return rqCard({ ...card, acts: {
    dropText: d.intent ? "" : "답장 안 함",   // a new message answers nothing: its draft keeps 보내지 않기
    send: ev => run(ev.currentTarget, async () => {
      const id = KK.open, r = await api(`/api/kakao/drafts/${enc(d.code)}/send`, "POST", {});
      if (KK.open !== id) return;
      kkAddSend(r, d.text); KK.drafts = KK.drafts.filter(x => x.code !== d.code); KK.stick = true; KK.pin = "bottom";
      kkPaintTl(true); kkPaintFoot();
    }),
    edit: () => { KK.revise = { code: d.code, text: "" }; kkPaintFoot(); const i = $(".kk-rv", kkDrafts); if (i) i.focus(); },
    drop: ev => run(ev.currentTarget, async () => {
      const id = KK.open, r = kkRoom(id), wave = !d.intent && !!r && !!r.unreplied, nr = `/api/kakao/chat/${enc(id)}/no-reply`;   // on a reply's draft 답장 안 함 also ends the room's 미답장 (되돌리기 brings both back)
      await api(`/api/kakao/drafts/${enc(d.code)}/drop`, "POST", {});
      if (wave) { await api(nr, "POST", {}); r.unreplied = false; kkPaintRooms(); loadIntegrations(); toast("답장 안 함으로 표시했어요", false, { label: "되돌리기", onclick: () => api(nr, "DELETE").then(() => { r.unreplied = true; kkPaintRooms(); kkPaintAuto(); return kkRestore(d.code); }, e => toast(e.message, true)) }, 6000); } else rqDroppedToast(() => kkRestore(d.code));
      if (KK.open !== id) return;
      KK.drafts = KK.drafts.filter(x => x.code !== d.code);
      if (KK.edit && KK.edit.code === d.code) kkEditCancel(); else kkPaintFoot();
    }),
  } });
}
function kkEdit(d) {
  KK.edit = { code: d.code };
  kkTa.value = d.text; KK.typed.set(KK.open, d.text); kkAutosize();
  kkPaintFoot();
  kkTa.focus();
}
function kkEditCancel() {
  KK.edit = null; kkTa.value = ""; KK.typed.delete(KK.open); kkAutosize();
  kkPaintFoot();
}
function kkPaintFoot() {
  const edit = KK.edit && KK.drafts.some(d => d.code === KK.edit.code) ? KK.edit : null;
  if (KK.edit && !edit) KK.edit = null;
  const ask = kkAskCard(), hadRv = document.activeElement && document.activeElement.classList.contains("kk-rv");
  if (KK.revise && !KK.drafts.some(d => d.code === KK.revise.code)) KK.revise = null;
  const making = !!KK.open && KK.drafting === KK.open;
  // A new draft on its way (no card to say "고치는 중…" yet): the place where its card will be says so.
  const wait = making && !KK.reviseCode ? [el("div", { class: "kk-mk", role: "status", text: "답장 초안을 만드는 중이에요…" })] : [];
  const drawn = paintKeep(kkDrafts, [...(ask ? [ask] : []), ...wait, ...KK.drafts.filter(d => !edit || d.code !== edit.code).map(kkDraftCard)], kkPaintFoot);
  kkDrafts.hidden = !kkDrafts.firstChild;
  // A draft that lands while the room is open (the owner's request came back) is brought into view: the card sits under the request bar, below the chat window.
  const codes = KK.drafts.map(d => d.code);
  if (drawn && KK.droom === KK.open && codes.some(c => !KK.dsig.includes(c))) requestAnimationFrame(() => kkDrafts.scrollIntoView({ block: "nearest" }));
  if (drawn) { KK.dsig = codes; KK.droom = KK.open; }
  if (hadRv) { const i = $(".kk-rv", kkDrafts); if (i) i.focus({ preventScroll: true }); }
  kkEditBar.hidden = !edit;
  kkDraftBtn.disabled = making;
  kkPaintAuto();
  kkDraftBtn.lastChild.textContent = making ? "초안 만드는 중…" : "답장 초안";
  // 직접 수정 puts a draft's text in the bar: then the bar sends it (the draft's own route); otherwise it is the request to the assistant.
  kkTa.placeholder = edit ? "고친 메시지" : KK.drafts.length ? KK_REVISE : KK_ASK;
  const label = edit ? "보내기" : "요청 보내기";
  kkSendBtn.setAttribute("aria-label", label); kkSendBtn.title = label;
}
// A new message the owner asked for in his own words (kkAskBot with no draft waiting); the same draft call (POST .../draft { intent }) writes it in his voice.
async function kkComposeMake(intent) {
  const id = KK.open, text = String(intent || "").replace(/\s+/g, " ").trim().slice(0, 500);
  if (!id || !text || KK.drafting === id) return;
  KK.drafting = id; KK.reviseCode = "";
  kkPaintFoot();
  clearTimeout(KK.draftT);
  KK.draftT = setTimeout(() => { if (KK.drafting === id) { KK.drafting = ""; kkPaintFoot(); toast("초안이 아직 오지 않았어요", true); } }, 120000);
  try {
    const r = await api(`/api/kakao/chat/${enc(id)}/draft`, "POST", { intent: text });
    if (r && typeof r.error === "string" && r.error) throw new Error(r.error);
  } catch (e) {
    clearTimeout(KK.draftT);
    if (KK.drafting === id) KK.drafting = "";
    kkPaintFoot();
    toast(e.message, true);
  }
}
// Drafts are made only on demand (or by a room's 자동 초안): the request starts it, and the kakao_draft event for this room says it is done.
// `revise` = { code, change }: rewrite that draft with the owner's change instead of making a new one.
async function kkMakeDraft(choice, revise) {
  const id = KK.open;
  if (!id || KK.drafting === id) return;
  KK.drafting = id; KK.reviseCode = revise ? revise.code : ""; kkPaintFoot();
  clearTimeout(KK.draftT);
  KK.draftT = setTimeout(() => { if (KK.drafting === id) { KK.drafting = ""; kkPaintFoot(); toast("초안이 아직 오지 않았어요", true); } }, 120000);
  try {
    const r = await api(`/api/kakao/chat/${enc(id)}/draft`, "POST", revise ? { revise } : choice ? { choice } : {});
    if (r && typeof r.error === "string" && r.error) throw new Error(r.error);
  } catch (e) {
    clearTimeout(KK.draftT);
    if (KK.drafting === id) KK.drafting = "";
    kkPaintFoot();
    toast(e.message, true);
  }
}

/* ---- live ---- */
// The newest line of one room, from the hub (logId, preview, time, unread): a room row follows the database without re-reading the whole list.
async function kkRoomLatest(chatId) {
  if (!kkRoom(chatId)) { kkLoadRooms(); return; }
  try {
    const d = await api(`/api/kakao/rooms/${enc(chatId)}/latest`);
    if (KK.vis) kkSetRow(chatId, d);
  } catch { kkLoadRooms(); }
}
function kkSetRow(chatId, d) {
  const r = kkRoom(chatId);
  if (!r || !d) return;
  if (typeof d.text === "string" && d.text) r.hint = d.text;
  if (d.at) r.lastAt = d.at;
  if (typeof d.unread === "number") r.unread = d.unread;
  kkPaintRooms();
}
// The event stream (99-boot.js): ids only, so the bodies are fetched here.
function kkLive(e) {
  if (e.kind === "kakao_draft" || e.kind === "kakao_send") rqSoon();   // the 답장 대기 screen (30-replies.js) reads this computer's drafts again
  if (KK.pc) return;   // the stream is this computer's; a peer's room is refreshed by the timer
  if (e.kind === "kakao_read") { if (KK.vis && e.chatId === KK.open) kkReads(); return; }
  if (e.kind === "kakao_rooms" || e.kind === "kakao_unreplied") { if (KK.vis || current === "chat") kkLoadRooms(); kkIntgSoon(); return; }
  kkIntgSoon();
  if (!KK.vis) return;
  const open = e.chatId === KK.open;
  if (e.kind === "kakao") { if (open) kkTail(); else kkRoomLatest(e.chatId); }
  else if (e.kind === "kakao_send") { if (open) kkSendEvent(e); }
  else if (e.kind === "kakao_draft" && open) {
    if (KK.drafting === e.chatId) {
      KK.drafting = ""; clearTimeout(KK.draftT); kkPaintFoot();
      if (typeof e.error === "string" && e.error) toast(e.error, true);
    }
    kkTail();
  }
}
// A peer's room gets no stream events here (the stream is this computer's): while it is open, ask its owner for the room's newest logId every ~2 s
// (GET .../head: one small read, none while the owner's database files do not change) and fetch rows only when that moved. An owner without /head: tail directly.
const KK_PEER_MS = 2000;
async function kkPeerPoll() {
  const id = KK.open;
  if (!KK.pc || !KK.vis || !id || KK.loading || KK.roomErr || KK.peerBusy || document.visibilityState !== "visible") return;
  KK.peerBusy = true;
  try {
    const d = await api(`/api/kakao/chat/${enc(id)}/head`);
    if (KK.open !== id) return;
    const head = d && d.logId ? String(d.logId) : "", last = KK.msgs.length ? KK.msgs[KK.msgs.length - 1].logId : "";
    if (head && `${id}:${head}` !== KK.peerHead && (!last || kkGt(head, last))) await kkTail();
    if (KK.open === id) KK.peerHead = `${id}:${head}`;
  } catch { await kkTail(); } finally { KK.peerBusy = false; }
}
// After a stream reconnect or coming back to the page: ask again.
function kkResync() { if (!KK.vis) return; kkLoadRooms(); kkTail(); kkReads(); kkMaybeRead(); }
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") kkResync(); });

/* ---- the 모니터링 item ---- */
// renderMonitoring (30-monitoring.js): `item` = the kakao item is the selected one; `shown` = its pane is on screen (not behind the phone's list).
function kkMode(item, shown, pc) {
  if (KK.vis && (KK.pc ? KK.pc.url : "") !== (pc ? pc.url : "")) {   // the other computer's rooms: start from an empty pane
    Object.assign(KK, { vis: false, open: "", rooms: [], loaded: false, failed: false, error: "", roomErr: "", room: null, msgs: [], drafts: [], ask: null, sends: [], rseq: KK.rseq + 1 });
    if (KK.adding) KK.adding.close();
    KK.seq++; clearInterval(KK.timer); clearInterval(KK.peerT);
  }
  KK.pc = item ? pc || null : null;
  $("#v-monitoring").classList.toggle("kk-on", item);
  kkPane.hidden = !item;
  if (shown && !KK.vis) {
    KK.vis = true; KK.open = ""; KK.seq++;
    kkPaintAll();
    kkLoadRooms();
    clearInterval(KK.timer);
    KK.timer = setInterval(() => { if (document.visibilityState === "visible") kkResync(); }, 60000);
    clearInterval(KK.peerT);
    if (KK.pc) KK.peerT = setInterval(kkPeerPoll, KK_PEER_MS);
  } else if (!shown && KK.vis) {
    KK.vis = false; KK.open = ""; KK.seq++; clearInterval(KK.timer); clearInterval(KK.peerT);
  }
}
