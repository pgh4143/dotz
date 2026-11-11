/* ---------- menu: the single dropdown component ---------- */
let openMenu = null;
function closeMenu(restore = true) {
  if (!openMenu) return;
  const m = openMenu; openMenu = null;
  ovDone(m.ov);
  m.node.remove();
  for (const [t, f, o] of m.listeners) t.removeEventListener(f.type, f.fn, o);
  m.anchor.setAttribute("aria-expanded", "false");
  if (restore && m.anchor.isConnected) m.anchor.focus();
}
// items: [{value, label, sub?}] or [{header}]. onPick(value) runs after the menu closes.
// sheet: a bottom sheet across the screen above the anchor (the phone tab bar), instead of a dropdown at the anchor.
function showMenu(anchor, items, { value, onPick, sheet, end }) {
  if (openMenu && openMenu.anchor === anchor) { closeMenu(); return; }
  closeMenu(false);
  const node = el("div", { class: sheet ? "menu msheet" : "menu", role: "listbox", tabindex: "-1" });
  const opts = [];
  // An item with `fold` (a list of items) is a "더 보기" row that expands in place.
  const mk = it => {
    if (it.header != null) return [el("div", { class: "mh", role: "presentation", text: it.header }), null];
    if (it.sep) return [el("div", { class: "msep", role: "separator" }), null];
    if (it.fold) {
      const b = el("button", { type: "button", class: "mi more", tabindex: "-1", onclick: ev => {
        ev.stopPropagation();
        let at = opts.indexOf(b); const first = at; opts.splice(at, 1);
        for (const x of it.fold) { const [n, o] = mk(x); node.insertBefore(n, b); if (o) opts.splice(at++, 0, o); }
        b.remove(); place(); focusAt(first);
      } }, el("span", { class: "ck" }), el("span", { class: "ml", text: it.label }), icon("drop"));
      b._label = String(it.label).toLowerCase();
      return [b, b];
    }
    const on = it.value === value;
    const b = el("button", { type: "button", role: "option", class: `mi${on ? " sel-on" : ""}${it.indent ? " ind" : ""}${it.danger ? " danger" : ""}`, "aria-selected": on ? "true" : "false", tabindex: "-1", onclick: () => { closeMenu(); onPick(it.value); } },
      on ? icon("check", "ck") : el("span", { class: "ck" }),
      it.tone != null ? el("span", { class: `dot ${it.tone}` }) : null,
      el("span", { class: "ml" }, it.label, it.sub ? el("small", { text: it.sub }) : null),
      it.flag ? el("span", { class: "sb warn", text: it.flag }) : null,
      it.badge ? el("span", { class: "nb", text: String(it.badge) }) : null);
    b._label = String(it.label).toLowerCase();
    return [b, b];
  };
  for (const it of items) { const [n, o] = mk(it); node.append(n); if (o) opts.push(o); }
  const host = anchor.closest("dialog") || document.body;
  host.append(node);
  const place = () => {
    const r = anchor.getBoundingClientRect(), vw = innerWidth, vh = innerHeight;
    if (sheet) {
      node.style.left = "8px"; node.style.width = `${vw - 16}px`;
      // an anchor with no box (the tab bar hides while typing) puts the sheet at the screen's bottom edge
      const top = r.height ? r.top : vh, above = top - 16, below = vh - r.bottom - 16;
      // an anchor high on the screen (the app bar) leaves no room above for its menu: the sheet opens below it instead
      const under = !!r.height && above < Math.min(node.scrollHeight, vh * 0.6) && below > above;
      node.style.top = under ? `${r.bottom + 8}px` : "auto";
      node.style.bottom = under ? "auto" : `${vh - top + 8}px`;
      node.style.maxHeight = `${Math.max(160, Math.min(vh * 0.6, under ? below : above))}px`;
      return;
    }
    node.style.minWidth = `${Math.max(112, r.width)}px`;
    node.style.maxWidth = `${vw - 16}px`;
    const below = vh - r.bottom - 12, above = r.top - 12;
    const up = below < 220 && above > below;
    node.style.maxHeight = `${Math.min(400, up ? above : below)}px`;
    const w = node.offsetWidth, h = node.offsetHeight;
    let left = Math.max(8, end && r.left + r.width / 2 > vw / 2 ? r.right - w : r.left);   // end: a ⋯ in the right half of the screen ends its menu where it ends; one in the left half opens rightwards as before
    if (left + w > vw - 8) left = Math.max(8, r.right - w);
    node.style.left = `${left}px`;
    node.style.top = `${Math.max(8, up ? r.top - h - 4 : r.bottom + 4)}px`;
  };
  place();
  anchor.setAttribute("aria-expanded", "true");
  const focusAt = i => { const o = opts[Math.max(0, Math.min(opts.length - 1, i))]; if (o) { o.focus(); o.scrollIntoView({ block: "nearest" }); } };
  const start = opts.findIndex(o => o.getAttribute("aria-selected") === "true");
  focusAt(start < 0 ? 0 : start);
  const sel = opts[start]; if (sel) node.scrollTop = Math.max(0, sel.offsetTop - node.clientHeight / 2);
  let typed = "", typedTimer;
  const keydown = ev => {
    const cur = opts.indexOf(document.activeElement);
    if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); closeMenu(); }
    else if (ev.key === "ArrowDown") { ev.preventDefault(); focusAt(cur + 1); }
    else if (ev.key === "ArrowUp") { ev.preventDefault(); focusAt(cur < 0 ? 0 : cur - 1); }
    else if (ev.key === "Home") { ev.preventDefault(); focusAt(0); }
    else if (ev.key === "End") { ev.preventDefault(); focusAt(opts.length - 1); }
    else if (ev.key === "Tab") closeMenu(false);
    else if (ev.key.length === 1 && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
      clearTimeout(typedTimer); typed += ev.key.toLowerCase(); typedTimer = setTimeout(() => { typed = ""; }, 700);
      const i = opts.findIndex(o => o._label.startsWith(typed));
      if (i >= 0) focusAt(i);
    }
  };
  const outside = ev => { if (!node.contains(ev.target) && !anchor.contains(ev.target)) closeMenu(false); };
  // only a scroll that moves the anchor closes it: a late scroll event from before the menu opened, or a list scrolling elsewhere, leaves it open
  const at0 = anchor.getBoundingClientRect();
  const onScroll = ev => { if (node.contains(ev.target)) return; const r = anchor.getBoundingClientRect(); if (Math.abs(r.top - at0.top) > 2 || Math.abs(r.left - at0.left) > 2) closeMenu(false); };
  const onResize = () => closeMenu(false);
  const L = [[document, { type: "keydown", fn: keydown }, true], [document, { type: "pointerdown", fn: outside }, true], [window, { type: "scroll", fn: onScroll }, true], [window, { type: "resize", fn: onResize }, false]];
  for (const [t, f, o] of L) t.addEventListener(f.type, f.fn, o);
  openMenu = { node, anchor, listeners: L };
  openMenu.ov = ovOpen(() => closeMenu(false));
}
// The one select control: a .sel button on the shared menu. b.value holds the choice, as on a native <select>, and the button shows the chosen item's label.
// text (a string, or a function of the value) replaces that label when items is a function or the value is not in the list; frame dresses the shown text.
function selectButton({ label, items, value, onPick, text, frame = t => t }) {
  const val = el("span", { class: "val" });
  const b = el("button", { type: "button", class: "sel", "aria-haspopup": "listbox", "aria-expanded": "false" }, val, icon("drop"));
  const list = () => typeof items === "function" ? items() : items;
  const paint = v => {
    value = v; b.value = v ?? "";
    const t = typeof text === "function" ? text(v) : text ?? (list().find(o => o.value === v) || {}).label ?? String(v ?? "");
    val.textContent = frame(t); b.setAttribute("aria-label", `${label}: ${t}`);
  };
  b.addEventListener("click", () => showMenu(b, list(), { value, onPick: v => { paint(v); if (onPick) onPick(v); } }));
  paint(value);
  return b;
}
function selectField(label, text, items, value, onPick) {
  return el("div", { class: "tf" }, el("span", { class: "lb", text: label }), selectButton({ label, text, items, value, onPick }));
}
function textField(label, input) {
  return el("div", { class: "tf" }, el("label", { text: label, for: input.id }), input);
}
let fieldSeq = 0;
const input = (opts = {}) => el("input", { id: `f${++fieldSeq}`, class: "fi", autocomplete: "off", autocapitalize: "off", spellcheck: "false", ...opts });
