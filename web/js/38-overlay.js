/* ---------- full-screen overlay: the one frame for every pop-up over the app (14-overlay.css) ---------- */
// fsOpen builds the backdrop and the card, joins the back-button stack (ovOpen), takes Esc and Tab while it is the top overlay, and follows the visual
// viewport so the footer stays above the keyboard. The caller paints fsHead / .fs-body / .fs-ft into h.box. Built on it: decision, notice and computer sheets
// (30-notices.js, 33-peers.js) and login requests (16-target-switcher-conversation.js); dialog() (02-basic-markdown.js) wears the same classes on a native <dialog>.
const FS = [];   // open overlays, top last
function fsOpen({ label, labelledby, cls = "", onClose }) {
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null, vv = window.visualViewport;
  const box = el("section", { class: `fs-card ${cls}`.trim(), role: "dialog", "aria-modal": "true", "aria-label": label || null, "aria-labelledby": labelledby || null, tabindex: "-1" });
  const node = el("div", { class: "fs-bd", onpointerdown: ev => { if (ev.target === node) h.close(); } }, box);
  let ov = null, closed = false;
  const fit = () => {
    const kb = !!vv && innerHeight - vv.height > 120;
    node.style.top = kb ? `${vv.offsetTop}px` : ""; node.style.height = kb ? `${vv.height}px` : ""; node.style.bottom = kb ? "auto" : "";
    node.classList.toggle("kb", kb);
  };
  const key = ev => {
    if (FS[FS.length - 1] !== h || document.querySelector("dialog[open]:not([data-leaving])")) return;
    if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); h.close(); return; }
    if (ev.key !== "Tab") return;
    const f = [...box.querySelectorAll("button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href]")].filter(e => e.offsetParent && !e.closest("[inert]"));
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1], at = document.activeElement;
    if (!box.contains(at)) { ev.preventDefault(); first.focus(); }
    else if (ev.shiftKey && at === first) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && at === last) { ev.preventDefault(); first.focus(); }
  };
  const h = {
    node, box, ends: [],   // ends: run once when the overlay closes (a confirm shown inside it, 02-basic-markdown.js)
    close(restore = true) {
      if (closed) return;
      closed = true;
      h.ends.splice(0).forEach(f => f());
      // State is released at once. Only the owner's own close (X, Esc, backdrop; restore) leaves the sheet and fades it out; the next card opens
      // later in the DOM, so it sits over the leaving one. A programmatic close (restore false) goes at once.
      ovDone(ov); FS.splice(FS.indexOf(h), 1);
      if (restore && !reducedMotion()) { node.style.pointerEvents = "none"; node.removeAttribute("aria-modal"); motionSheetOut(node).then(() => node.remove()); }
      else node.remove();
      document.removeEventListener("keydown", key, true);
      if (vv) { vv.removeEventListener("resize", fit); vv.removeEventListener("scroll", fit); }
      if (restore && opener && opener.isConnected) opener.focus({ preventScroll: true });
      if (onClose) onClose();
    },
  };
  document.body.append(node);
  motionSheet(box, node);
  ov = ovOpen(() => h.close(false));
  FS.push(h);
  document.addEventListener("keydown", key, true);
  if (vv) { vv.addEventListener("resize", fit); vv.addEventListener("scroll", fit); fit(); }
  box.focus({ preventScroll: true });
  return h;
}
// The header: `tt` = the title block's nodes (eyebrow, title, ...), ignore = the 무시 handler (omit when it does not apply), close = the close handler.
function fsHead(tt, { ignore, ignoreOff, close } = {}) {
  return el("div", { class: "fs-hd" }, el("div", { class: "fs-tt" }, ...tt),
    el("div", { class: "fs-hb" },
      ignore ? el("button", { class: "fs-ign", type: "button", "data-k": "ignore", disabled: !!ignoreOff, onclick: ignore }, el("span", { text: "무시" })) : null,
      close ? el("button", { class: "ib fs-x", type: "button", "aria-label": "닫기", onclick: close }, icon("close")) : null));
}
