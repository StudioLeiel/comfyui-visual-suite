/* Copyright 2026 Studio Leiel
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/* Visual Save Image - the bar under the picture.
 *
 * Six settings drawn the default way is six stacked rows above a picture
 * that wanted the height. They are all short - a switch, a number, a couple
 * of toggles - so they are hidden and drawn again as one line, and the room
 * that frees goes to the image.
 *
 * The picture itself is ComfyUI's and already grows with the node. What was
 * missing is everything around it: which file that was, and where it went. A
 * name built from a series, a date, a number and every setting is too long to
 * read in a tooltip and too long to retype, so it is shown in full and copied
 * on click.
 */

import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

const NODE_ID = "LeielSaveImage";

/* the row, the name line and a picture small enough to still be a picture */
const BAR_FLOOR = 220;
/* what a fresh node opens at */
const BAR_DEFAULT = 380;
/* roughly the title, the two slots and the prefix field above the bar - only
   ever used to translate a node height into a bar height, never the reverse */
const HEAD_ROOM = 96;

/* name -> the widget it drives. Kept in one place so the row and the node
   cannot drift apart. */
const W = {
  counter: "trailing_counter",
  png: "compress_level",
  jpg: "extra_jpg",
  webp: "extra_webp",
  quality: "extra_quality",
  lastSeen: "last_seen",
};

const CSS = `
.leiel-save {
  font: 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: #ddd; display: flex; flex-direction: column; gap: 5px;
  padding: 6px; box-sizing: border-box;
  /* the height is set on the element by the node; the picture takes what the
     row, the name line and the footer leave */
  height: 100%; min-height: 0;
}
.leiel-save .bar {
  display: flex; flex-wrap: wrap; gap: 4px; align-items: center;
}
.leiel-save .seg {
  display: flex; align-items: center; gap: 4px;
  background: #242424; border: 1px solid #3a3a3a; border-radius: 5px;
  padding: 3px 6px;
}
.leiel-save .seg > label { opacity: .55; letter-spacing: .02em; }
.leiel-save input[type=number] {
  width: 44px; background: #131313; color: #eee; border: 1px solid #3a3a3a;
  border-radius: 3px; padding: 2px 4px; font: inherit; text-align: right;
}
.leiel-save input[type=number]:focus { outline: none; border-color: #777; }
.leiel-save .tog {
  background: #242424; color: #999; border: 1px solid #3a3a3a;
  border-radius: 5px; padding: 4px 9px; font: inherit; cursor: pointer;
}
.leiel-save .tog:hover { border-color: #666; color: #ccc; }
.leiel-save .tog.on { background: #2f4030; border-color: #5c8a5e; color: #cfe9cf; }
.leiel-save .tog.wide { letter-spacing: .02em; }
.leiel-save .seg.off { opacity: .35; }
.leiel-save .cap { opacity: .45; letter-spacing: .03em; }
.leiel-save .cap.off { opacity: .25; }
.leiel-save .sep {
  width: 1px; align-self: stretch; background: #3a3a3a; margin: 0 3px;
}
.leiel-save .go {
  background: #2b2b2b; color: #ddd; border: 1px solid #444;
  border-radius: 5px; padding: 4px 10px; font: inherit; cursor: pointer;
  margin-left: auto;
}
.leiel-save .go:hover:not(:disabled) { background: #363636; }
.leiel-save .go:disabled { opacity: .35; cursor: default; }
.leiel-save .nm {
  background: #1a1a1a; border: 1px solid #333; border-radius: 5px;
  padding: 5px 7px; cursor: pointer; line-height: 1.45;
  word-break: break-all; user-select: text;
}
.leiel-save .nm:hover { border-color: #666; }
.leiel-save .nm.copied { border-color: #7ec27e; color: #b9e6b9; }
.leiel-save .nm.empty { color: #5f5f5f; cursor: default; }
.leiel-save .nm.empty:hover { border-color: #333; }
.leiel-save .note { color: #8a9a8a; min-height: 12px; }
.leiel-save .note.bad { color: #d08a8a; }
.leiel-save .pic {
  flex: 1 1 auto; min-height: 0; display: flex;
  align-items: center; justify-content: center;
  background: #141414; border: 1px solid #2c2c2c; border-radius: 5px;
  overflow: hidden;
}
.leiel-save .pic img {
  max-width: 100%; max-height: 100%; object-fit: contain; display: block;
  cursor: zoom-in;
}
.leiel-save .pic .ph { color: #4d4d4d; }
.leiel-save .qmark {
  margin-left: auto; width: 22px; height: 22px; padding: 0; line-height: 1;
  border-radius: 11px; font-weight: 700; font-size: 13px;
  background: #2b2b2b; color: #bbb; border: 1px solid #444; cursor: pointer;
}
.leiel-save .qmark:hover { background: #363636; color: #eee; }
.leiel-help-box {
  position: absolute; z-index: 40; background: #161616;
  border: 1px solid #5b7fa6; border-radius: 6px; padding: 12px 14px;
  width: 460px; max-height: 70vh; overflow-y: auto; box-shadow: 0 6px 24px #000c;
  font-family: ui-monospace, Consolas, monospace; font-size: 11px;
  line-height: 1.65; color: #ddd;
}
.leiel-help-box h3 { margin: 0 0 8px; font-size: 14px; color: #fff; letter-spacing: .5px; }
.leiel-help-box h5 {
  margin: 12px 0 3px; font-size: 11px; color: #ffd479;
  letter-spacing: .5px; text-transform: uppercase;
}
.leiel-help-box p { margin: 0 0 4px; opacity: .85; }
.leiel-help-box code {
  background: #0d0d0d; border: 1px solid #333; border-radius: 3px;
  padding: 0 4px; color: #9fd3f0;
}
.leiel-help-box .hc { margin-top: 12px; text-align: right; }
.leiel-help-box .hc button {
  background: #2b2b2b; color: #ddd; border: 1px solid #444;
  border-radius: 4px; padding: 4px 10px; font: inherit; cursor: pointer;
}
.leiel-save .nav { display: flex; align-items: center; gap: 4px; }
.leiel-save .nav button {
  background: #2b2b2b; color: #ddd; border: 1px solid #444;
  border-radius: 4px; padding: 2px 9px; font: inherit; cursor: pointer;
  line-height: 1.4;
}
.leiel-save .nav button:hover:not(:disabled) { background: #363636; }
.leiel-save .nav button:disabled { opacity: .3; cursor: default; }
.leiel-save .nav .count { opacity: .55; min-width: 62px; text-align: center; }
/* Says which of the two things is on screen: the render that just finished,
   or an earlier one stepped back to. Deliberately without a box - a framed
   word sitting beside two buttons gets read as a third button. */
.leiel-save .nav .badge {
  padding: 2px 4px; letter-spacing: .08em; font-size: 10px;
}
.leiel-save .nav .badge.now { color: #8fbf8f; }
.leiel-save .nav .badge.back { color: #7d7d7d; }
.leiel-save .nav .del { margin-left: 6px; }
.leiel-save .nav .del:hover:not(:disabled) {
  background: #402c2c; border-color: #8a5c5c; color: #e9bfbf;
}
.leiel-save .nav .undo { color: #c9b98a; border-color: #6a5c3a; }
`;

function styleOnce() {
  if (document.getElementById("leiel-save-css")) return;
  const el = document.createElement("style");
  el.id = "leiel-save-css";
  el.textContent = CSS;
  document.head.appendChild(el);
}

function widget(node, name) {
  return node.widgets?.find((w) => w.name === name);
}

/* Hidden rather than removed: the value still has to be sent with the prompt
   and saved with the workflow.

   Everything but the prefix goes, by exclusion rather than by name: a widget
   added later would otherwise appear on its own line and break the row, and
   the row is the whole point. */
const KEEP = new Set(["filename_prefix", "leiel_saved"]);

function hideSettings(node) {
  let changed = false;
  for (const w of node.widgets || []) {
    if (KEEP.has(w.name) || w.type === "leiel-hidden") continue;
    w.type = "leiel-hidden";
    w.computeSize = () => [0, -4];
    /* The older frontends go by the type they do not recognise; the newer
       ones keep their own list and read this flag instead. Both are set,
       because one of them is always the wrong guess. */
    w.hidden = true;
    if (w.options) w.options.hidden = true;
    if (w.element) w.element.style.display = "none";
    changed = true;
  }
  if (changed) node.setDirtyCanvas(true, true);
  return changed;
}

function setWidget(node, name, value) {
  const w = widget(node, name);
  if (!w) return;
  w.value = value;
  w.callback?.(value);
  node.setDirtyCanvas(true, true);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    /* the clipboard is refused without https or focus - fall back */
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch (e2) {
      return false;
    }
  }
}

/* One picture into the frame, whichever picture it is - the one just
   rendered or one stepped back to. */
function showImage(node, filename) {
  const ui = node._leielUI;
  const info = node._leielSaved;
  if (!ui || !info) return;

  const params = new URLSearchParams({
    filename,
    subfolder: info.subfolder || "",
    type: "output",
    /* only the live one can have changed under a name already seen */
    rand: filename === info.filename ? String(Math.random()) : "",
  });

  const img = new Image();
  img.onload = () => {
    ui.pic.textContent = "";
    ui.pic.appendChild(img);
  };
  img.onerror = () => {
    ui.pic.textContent = "";
    const ph = document.createElement("span");
    ph.className = "ph";
    ph.textContent = "this file could not be loaded";
    ui.pic.appendChild(ph);
  };
  img.title = "Click to open full size";
  img.addEventListener("click", () => window.open(img.src, "_blank"));
  img.src = api.apiURL("/view?" + params.toString());

  ui.nm.classList.remove("empty");
  ui.nm.textContent = (info.subfolder ? info.subfolder + "/" : "") + filename;
  ui.nm.title = "Click to copy";
  node._leielShown = filename;
}

function paintNav(node) {
  const ui = node._leielUI;
  if (!ui) return;
  const files = node._leielFiles || [];
  const at = files.indexOf(node._leielShown);
  ui.prev.disabled = !(at > 0);
  ui.next.disabled = !(at >= 0 && at < files.length - 1);
  ui.count.textContent = at < 0 ? "" : `${at + 1} / ${files.length}`;
  const live = at >= 0 && node._leielShown === node._leielSaved?.filename;
  ui.badge.textContent = at < 0 ? "" : (live ? "NOW" : "BEFORE");
  ui.badge.classList.toggle("now", at >= 0 && live);
  ui.badge.classList.toggle("back", at >= 0 && !live);
  ui.del.disabled = at < 0;
  ui.again.disabled = !node._leielSaved?.folder;
}

/* The folder is read on demand rather than watched: it only changes when a
   render finishes, and that is exactly when this runs. */
async function loadFolder(node) {
  const info = node._leielSaved;
  if (!info?.folder) return;
  try {
    const res = await api.fetchApi("/leiel/list_folder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: info.folder }),
    });
    const body = await res.json().catch(() => ({}));
    node._leielFiles = Array.isArray(body.files) ? body.files : [];
  } catch (e) {
    node._leielFiles = [];
  }
  paintNav(node);
}

/* What the workflow carries between sittings: the folder last rendered into.
   Not the height - LiteGraph already saves the node's size, and storing a
   second copy of it only gave the two something to disagree about. */
function rememberState(node) {
  const info = node._leielSaved;
  if (!info?.folder) return;
  setWidget(node, W.lastSeen, JSON.stringify({
    folder: info.folder,
    subfolder: info.subfolder || "",
  }));
}

/* Opening the workflow tomorrow should not start blank: the folder last
   rendered into is written into a hidden field, which the workflow carries,
   so the arrows work before anything has been rendered in this session. The
   last picture in it is shown, marked BACK - it belongs to an earlier
   sitting, not this one. */
async function restoreFolder(node) {
  const raw = widget(node, W.lastSeen)?.value;
  if (!raw || node._leielSaved) return;
  let saved = null;
  try {
    saved = JSON.parse(raw);
  } catch (e) {
    return;
  }
  if (!saved?.folder) return;

  node._leielSaved = {
    folder: saved.folder,
    subfolder: saved.subfolder || "",
    filename: null,                      /* nothing rendered this session */
    extra: [],
  };
  node._leielUI.go.disabled = false;
  await loadFolder(node);
  const files = node._leielFiles || [];
  if (files.length) {
    showImage(node, files[files.length - 1]);
    paintNav(node);
  }
}

/* Straight to the trash folder, no question asked: this is meant to be used
   while stepping through a folder at speed, and a dialog every time would
   defeat it. Nothing is deleted - the file is moved, and the button beside it
   brings the last one back. */
async function discard(node) {
  const info = node._leielSaved;
  const name = node._leielShown;
  const ui = node._leielUI;
  if (!info?.folder || !name || !ui || ui.del.disabled) return;

  ui.del.disabled = true;
  let body = {};
  try {
    const res = await api.fetchApi("/leiel/discard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder: info.folder, name }),
    });
    body = await res.json().catch(() => ({}));
  } catch (e) {
    body = { ok: false, error: "no answer from the server" };
  }
  if (!body.ok) {
    ui.note.classList.add("bad");
    ui.note.textContent = "could not move it to _trash: " + (body.error || "");
    ui.del.disabled = false;
    return;
  }

  /* A stack, not a slot: t gets pressed several times in a row while going
     through a folder, and putting only the last one back would strand the
     rest. Undone newest first, the way an editor does it. This session only -
     a reload clears it, and anything older is moved back by hand from the
     _trash folder, which is why it keeps the path it came from. */
  (node._leielUndo ||= []).push(body.moved || []);
  paintUndo(node);
  ui.note.classList.remove("bad");
  ui.note.textContent = "moved to _trash";

  /* carry on where the discarded one was, the way a viewer does */
  const files = node._leielFiles || [];
  const at = files.indexOf(name);
  const rest = files.filter((f) => f !== name);
  node._leielFiles = rest;
  if (rest.length) {
    showImage(node, rest[Math.min(at, rest.length - 1)]);
  } else {
    node._leielShown = null;
    ui.pic.textContent = "";
    const ph = document.createElement("span");
    ph.className = "ph";
    ph.textContent = "nothing left in this folder";
    ui.pic.appendChild(ph);
  }
  paintNav(node);
}

/* The room LiteGraph puts above the bar - title, slots, the prefix field.
   Asked for rather than assumed, so it stays right whatever the frontend
   version or the zoom does. */
function chromeOf(node) {
  try {
    return node.computeSize()[1] - BAR_FLOOR;
  } catch (e) {
    return HEAD_ROOM;
  }
}

/* The element made to fit the node it is in. Nothing is resized here: the
   node's own height is restored by LiteGraph from the workflow, and touching
   it on load is what made the node creep - first larger, then smaller. The
   saved height is the truth; the bar simply fills it. */
function fitBar(node) {
  const ui = node._leielUI;
  if (!ui) return;
  const h = Math.max(BAR_FLOOR, (node.size?.[1] || 0) - chromeOf(node));
  node._leielBarH = h;
  ui.root.style.height = h + "px";
  node.setDirtyCanvas(true, true);
}

/* Only for a node just dropped on the canvas, which has no saved height to
   honour and opens too short to show a picture. */
function openAtDefault(node) {
  const ui = node._leielUI;
  if (!ui) return;
  node.setSize([Math.max(node.size?.[0] || 0, 460),
                chromeOf(node) + BAR_DEFAULT]);
  fitBar(node);
}

function paintUndo(node) {
  const ui = node._leielUI;
  if (!ui) return;
  const n = (node._leielUndo || []).length;
  ui.undo.style.display = n ? "" : "none";
  ui.undo.textContent = n > 1 ? `put back (${n})` : "put back";
  ui.undo.title = n > 1
    ? "Puts the last one back. Press again for the one before it"
    : "Puts the render just moved to _trash back where it was";
}

async function putBack(node) {
  const ui = node._leielUI;
  const stack = node._leielUndo || [];
  const moved = stack[stack.length - 1];
  if (!ui || !moved?.length) return;
  ui.undo.disabled = true;
  let body = {};
  try {
    const res = await api.fetchApi("/leiel/restore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ moved }),
    });
    body = await res.json().catch(() => ({}));
  } catch (e) {
    body = {};
  }
  ui.undo.disabled = false;
  if (!body.ok) {
    ui.note.classList.add("bad");
    ui.note.textContent = "could not put it back";
    return;
  }
  stack.pop();
  paintUndo(node);
  ui.note.classList.remove("bad");
  ui.note.textContent = stack.length
    ? `put back, ${stack.length} still in _trash` : "put back";
  const back = moved[0]?.from?.split(/[\\/]/).pop();
  await loadFolder(node);
  if (back && (node._leielFiles || []).includes(back)) showImage(node, back);
  paintNav(node);
}

/* Reads the folder again and stays where it can. The picture on screen is
   kept if it is still there; if it has gone, the newest takes its place. */
async function reread(node) {
  const ui = node._leielUI;
  if (!ui || !node._leielSaved?.folder) return;
  ui.again.disabled = true;
  const was = node._leielShown;
  await loadFolder(node);
  const files = node._leielFiles || [];
  if (was && files.includes(was)) {
    showImage(node, was);
  } else if (files.length) {
    showImage(node, files[files.length - 1]);
  } else {
    node._leielShown = null;
    ui.pic.textContent = "";
    const ph = document.createElement("span");
    ph.className = "ph";
    ph.textContent = "nothing in this folder";
    ui.pic.appendChild(ph);
  }
  ui.note.classList.remove("bad");
  ui.note.textContent = `${files.length} in this folder`;
  paintNav(node);
  ui.again.disabled = false;
}

function step(node, by) {
  const files = node._leielFiles || [];
  const at = files.indexOf(node._leielShown);
  if (at < 0) return;
  const to = at + by;
  if (to < 0 || to >= files.length) return;
  showImage(node, files[to]);
  paintNav(node);
}

function buildBar(node) {
  const root = document.createElement("div");
  root.className = "leiel-save";

  const bar = document.createElement("div");
  bar.className = "bar";
  root.appendChild(bar);

  /* A label in front of each group. The controls are small enough to read
     wrong without one, and this is a node someone meets for the first time
     with no manual open. */
  const label = (text) => {
    const el = document.createElement("span");
    el.className = "cap";
    el.textContent = text;
    bar.appendChild(el);
    return el;
  };
  const divider = () => {
    const el = document.createElement("span");
    el.className = "sep";
    bar.appendChild(el);
    return el;
  };

  /* name / name_00001_ */
  label("file name");
  const counter = document.createElement("button");
  counter.className = "tog wide";
  counter.title = "Append the five digit counter SaveImage adds";
  bar.appendChild(counter);

  divider();

  /* png level */
  label("png level");
  const png = document.createElement("input");
  png.type = "number";
  png.min = 0;
  png.max = 9;
  png.title = "PNG compression, 0-9. Lossless either way - only size and time";
  bar.appendChild(png);

  divider();

  /* the two copies */
  const fmtCap = label("extra save format");
  const jpg = document.createElement("button");
  jpg.className = "tog";
  jpg.textContent = "jpg";
  jpg.title = "Also write a JPEG beside the PNG";
  const webp = document.createElement("button");
  webp.className = "tog";
  webp.textContent = "webp";
  webp.title = "Also write a WebP beside the PNG";
  bar.appendChild(jpg);
  bar.appendChild(webp);

  const qSeg = document.createElement("div");
  qSeg.className = "seg";
  const qLab = document.createElement("label");
  qLab.textContent = "quality";
  const quality = document.createElement("input");
  quality.type = "number";
  quality.min = 1;
  quality.max = 100;
  quality.title = "Quality of the copies, 1-100";
  qSeg.appendChild(qLab);
  qSeg.appendChild(quality);
  bar.appendChild(qSeg);

  const go = document.createElement("button");
  go.className = "go";
  go.textContent = "Open folder";
  go.title = "Opens on the machine running ComfyUI";
  go.disabled = true;
  bar.appendChild(go);

  /* The picture, drawn here rather than left to the canvas: a node carrying
     DOM widgets does not reliably get the built-in preview, and this way the
     image grows with the node instead of sitting at a fixed size. */
  const pic = document.createElement("div");
  pic.className = "pic";
  const ph = document.createElement("span");
  ph.className = "ph";
  ph.textContent = "no render yet";
  pic.appendChild(ph);
  root.appendChild(pic);

  const nm = document.createElement("div");
  nm.className = "nm empty";
  nm.textContent = "nothing saved yet";
  root.appendChild(nm);

  const foot = document.createElement("div");
  foot.className = "nav";
  const prev = document.createElement("button");
  prev.textContent = "\u25c0";
  prev.title = "The render before this one, in this folder"
    + "  (left arrow, with the node selected)";
  prev.disabled = true;
  const count = document.createElement("span");
  count.className = "count";
  const next = document.createElement("button");
  next.textContent = "\u25b6";
  next.title = "The next render in this folder"
    + "  (right arrow, with the node selected)";
  next.disabled = true;
  const badge = document.createElement("span");
  badge.className = "badge";
  const del = document.createElement("button");
  del.className = "del";
  /* "trash" rather than "delete": the file is moved, not destroyed, and the
     word matches the folder it lands in, so the button says where it goes. */
  del.textContent = "trash";
  del.title = "Move this render to the _trash folder in output"
    + "  (t, with the node selected)";
  del.disabled = true;
  const undo = document.createElement("button");
  undo.className = "undo";
  undo.textContent = "put back";
  undo.style.display = "none";
  /* The folder is read when a render finishes, so anything moved in or out
     from the file manager in between goes unnoticed until this is pressed. */
  const again = document.createElement("button");
  again.textContent = "\u21bb";
  again.title = "Read the folder again";
  again.disabled = true;
  const note = document.createElement("div");
  note.className = "note";
  const qmark = document.createElement("button");
  qmark.className = "qmark";
  qmark.textContent = "?";
  qmark.title = "How this node works";
  foot.appendChild(prev);
  foot.appendChild(count);
  foot.appendChild(next);
  foot.appendChild(badge);
  foot.appendChild(del);
  foot.appendChild(undo);
  foot.appendChild(again);
  foot.appendChild(note);
  foot.appendChild(qmark);
  root.appendChild(foot);

  const ui = { root, counter, png, jpg, webp, quality, qSeg, fmtCap, go, nm,
               note, pic, prev, next, count, badge, del, undo, again };

  /* read the widgets back, so the row shows what will actually be sent -
     on a fresh node, on a reloaded workflow, and after an undo */
  ui.sync = () => {
    const on = !!widget(node, W.counter)?.value;
    counter.classList.toggle("on", on);
    counter.textContent = on ? "name_00001_" : "name";
    png.value = widget(node, W.png)?.value ?? 4;
    const j = !!widget(node, W.jpg)?.value;
    const w = !!widget(node, W.webp)?.value;
    jpg.classList.toggle("on", j);
    webp.classList.toggle("on", w);
    quality.value = widget(node, W.quality)?.value ?? 92;
    qSeg.classList.toggle("off", !j && !w);
    fmtCap.classList.toggle("off", !j && !w);
  };

  counter.addEventListener("click", () => {
    setWidget(node, W.counter, !widget(node, W.counter)?.value);
    ui.sync();
  });
  jpg.addEventListener("click", () => {
    setWidget(node, W.jpg, !widget(node, W.jpg)?.value);
    ui.sync();
  });
  webp.addEventListener("click", () => {
    setWidget(node, W.webp, !widget(node, W.webp)?.value);
    ui.sync();
  });

  const number = (el, name, lo, hi) => {
    const push = () => {
      let v = parseInt(el.value, 10);
      if (!Number.isFinite(v)) v = lo;
      v = Math.min(hi, Math.max(lo, v));
      el.value = v;
      setWidget(node, name, v);
    };
    el.addEventListener("change", push);
    el.addEventListener("blur", push);
  };
  number(png, W.png, 0, 9);
  number(quality, W.quality, 1, 100);

  nm.addEventListener("click", async () => {
    const info = node._leielSaved;
    if (!info) return;
    const shown = node._leielShown || info.filename;
    const full = (info.subfolder ? info.subfolder + "/" : "") + shown;
    const ok = await copyText(full);
    const was = nm.textContent;
    nm.classList.toggle("copied", ok);
    nm.textContent = ok ? "copied" : "could not copy - select it by hand";
    setTimeout(() => {
      nm.textContent = was;
      nm.classList.remove("copied");
    }, 900);
  });

  prev.addEventListener("click", () => step(node, -1));
  next.addEventListener("click", () => step(node, 1));
  del.addEventListener("click", () => discard(node));
  again.addEventListener("click", () => reread(node));
  qmark.addEventListener("click", (e) => {
    e.stopPropagation();
    openHelp(e.currentTarget);
  });
  undo.addEventListener("click", () => putBack(node));

  go.addEventListener("click", async () => {
    const info = node._leielSaved;
    if (!info?.folder) return;
    go.disabled = true;
    note.classList.remove("bad");
    try {
      const res = await api.fetchApi("/leiel/open_folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: info.folder }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        note.classList.add("bad");
        note.textContent = "could not open: " + (body.error || res.status);
      }
    } catch (e) {
      note.classList.add("bad");
      note.textContent = "could not open";
    }
    go.disabled = false;
  });

  return ui;
}

/* The arrows, on the keyboard.
 *
 * Bound once for the whole page rather than per node, and only acted on when
 * exactly one of these nodes is selected - the canvas has its own use for the
 * arrow keys, and a node nobody has clicked has no business taking them. A
 * field being typed into always wins.
 *
 * Left and right step through the folder; t sends the picture to the trash,
 * after the word on the button. Not Delete: that key removes the node itself
 * on this canvas, and it sits right beside the arrows a hand is already
 * resting on.
 */
let keysBound = false;

function bindKeys() {
  if (keysBound) return;
  keysBound = true;

  window.addEventListener("keydown", (e) => {
    const key = e.key.toLowerCase();
    if (key !== "arrowleft" && key !== "arrowright" && key !== "t") return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    const el = document.activeElement;
    const tag = el?.tagName?.toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return;
    if (el?.isContentEditable) return;

    const picked = Object.values(app.canvas?.selected_nodes || {});
    if (picked.length !== 1) return;
    const node = picked[0];
    if (node?.comfyClass !== NODE_ID && node?.type !== NODE_ID) return;
    if (!node._leielUI || !(node._leielFiles || []).length) return;

    if (key === "t") discard(node);
    else step(node, key === "arrowleft" ? -1 : 1);
    /* the canvas would otherwise nudge the node along with the picture */
    e.preventDefault();
    e.stopPropagation();
  }, true);
}

const HELP = `
  <h3>Visual Save Image</h3>
  <p>Writes the PNG under exactly the name it is given, and then lets that
  folder be looked through without leaving the canvas.</p>

  <h5>The name</h5>
  <p>Wire the Filename Manager's <b>filename_prefix</b> into this node and the
  file is written under that name and nothing else. The core Save Image node
  always appends a five digit counter, which says nothing when the name
  already carries the time and the settings, and costs seven characters on a
  name that is fighting the Windows path limit.</p>
  <p><code>name</code> writes the name as given. Press it for
  <code>name_00001_</code> and the counter comes back, for a plain prefix that
  has nothing else to tell one render from the next.</p>
  <p>Two renders can still land on the same name. The second gets a short
  suffix rather than overwriting the first.</p>

  <h5>Looking through the folder</h5>
  <p>The arrows step through the folder this render went into, in name order.
  Give the Filename Manager a <code>seq</code> chip at the front of the file
  name and that order is the order the pictures were made in - which is what
  makes this useful rather than merely possible.</p>
  <p><b>NOW</b> means the picture on screen is the render that just finished;
  <b>BEFORE</b> means it is an earlier one. Click the picture to open it full
  size, and the name underneath to copy it.</p>
  <p>With the node selected, the left and right arrow keys do the same as the
  buttons. <code>↻</code> reads the folder again, for when files have been
  moved or deleted outside ComfyUI.</p>
  <p>The folder is remembered with the workflow, so opening it tomorrow starts
  where it was left - no render needed first.</p>

  <h5>Throwing one out</h5>
  <p><code>trash</code>, or <code>t</code> with the node selected, moves the
  picture to a <code>_trash</code> folder inside output, keeping the path it
  came from, and steps on to the next one. Nothing is deleted, and the folder
  is never emptied for you.</p>
  <p><code>put back</code> undoes that, newest first, for as many as were
  thrown out this session. After a reload, move them back by hand from
  <code>_trash</code>.</p>

  <h5>Lighter copies</h5>
  <p><code>jpg</code> and <code>webp</code> write a second file beside the PNG
  under the same name, at full size. Either, both or neither.
  <code>quality</code> applies to both. The PNG is written first and is never
  affected; a copy that fails to write is reported and otherwise ignored.</p>
  <p><code>png level</code> is compression only. PNG is lossless at every
  setting - the number changes the file size and the time taken, never the
  picture.</p>

  <h5>Open folder</h5>
  <p>Opens the folder in the file manager of the machine running ComfyUI,
  which is not the machine looking at this page when the server is remote.</p>
`;

let helpBox = null;

function closeHelp() {
  if (helpBox) {
    helpBox.remove();
    helpBox = null;
  }
}

/* Placed against the button and flipped above it when there is no room below,
   the same way the other nodes in the pack do it. */
function openHelp(btn) {
  if (helpBox) {
    closeHelp();
    return;
  }
  const box = document.createElement("div");
  box.className = "leiel-help-box";
  box.innerHTML = HELP + '<div class="hc"><button class="hclose">Close</button></div>';
  const r = btn.getBoundingClientRect();
  box.style.left = Math.max(8, Math.min(r.left - 400,
    window.innerWidth - 480)) + "px";
  document.body.appendChild(box);
  const h = box.getBoundingClientRect().height;
  box.style.top = (r.bottom + 6 + h < window.innerHeight)
    ? (r.bottom + 6) + "px"
    : Math.max(8, r.top - h - 6) + "px";
  helpBox = box;
  box.querySelector(".hclose").addEventListener("click", (ev) => {
    ev.stopPropagation();
    closeHelp();
  });
  /* the canvas would otherwise read a scroll or a keypress meant for the box */
  for (const k of ["keydown", "keyup", "keypress", "pointerdown",
                   "mousedown", "wheel"]) {
    box.addEventListener(k, (ev) => ev.stopPropagation());
  }
}

app.registerExtension({
  name: "StudioLeiel.VisualSaveImage",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE_ID) return;
    styleOnce();
    bindKeys();

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = onNodeCreated?.apply(this, arguments);
      const node = this;
      node._leielSaved = null;

      const ui = buildBar(node);
      node._leielUI = ui;
      const w = node.addDOMWidget("leiel_saved", "div", ui.root,
                                  { serialize: false });
      /* A floor, never the current height: LiteGraph refuses to drag a node
         below what a widget reports, so reporting the real height would lock
         the node at its tallest. Everything above this goes to the image. */
      /* Always the floor, never the height it currently has - the same rule
         the other nodes in this pack follow. LiteGraph sizes a node from what
         its widgets report, so reporting the current height makes the two
         chase each other: the node gains the header's worth of pixels on
         every load and can never be dragged smaller. The real height lives on
         the element; this number only says how small the node may go. */
      node._leielBarH ||= BAR_DEFAULT;
      w.computeSize = function (width) {
        return [width, BAR_FLOOR];
      };

      /* the widgets exist only after the node is fully built */
      setTimeout(() => {
        hideSettings(node);
        ui.sync();
        /* onConfigure has run by now if this node came from a workflow, and
           it leaves a mark; without one this is a new node on the canvas. */
        if (node._leielFromWorkflow) fitBar(node);
        else openAtDefault(node);
      }, 0);

      return r;
    };

    /* a workflow being loaded sets the widget values after creation */
    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const r = onConfigure?.apply(this, arguments);
      const node = this;
      /* The size as it was saved. The bar reports its height as a share of
         the node, and LiteGraph then sizes the node from its widgets, so the
         two disagree by however much sits above the bar and the node gains
         that much on every load. Putting the saved size back afterwards ends
         the argument without having to guess the offset, which differs
         between frontend versions anyway. */
      node._leielFromWorkflow = true;
      setTimeout(() => {
        hideSettings(node);
        node._leielUI?.sync();
        restoreFolder(node);
        fitBar(node);
      }, 0);
      return r;
    };

    /* Dragging the bottom edge is how the picture is made bigger, so the
       drag writes the bar height. Handled here rather than read back in
       computeSize, so the number only ever travels one way. */
    /* Dragging the node's corner is how the picture is made bigger. The
       element has to be told, or the extra room just sits at the bottom as
       dead space. */
    const onResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size) {
      const r = onResize?.apply(this, arguments);
      if (!this._leielUI) return r;
      const want = Math.max(BAR_FLOOR, (size?.[1] || 0) - chromeOf(this));
      if (Math.abs(want - (this._leielBarH || 0)) <= 1) return r;
      this._leielBarH = want;
      this._leielUI.root.style.height = want + "px";
      return r;
    };

    /* Cheap insurance: some frontend versions rebuild the widget list after
       a workflow loads, which would put the settings back on screen. */
    const onDrawForeground = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
      hideSettings(this);
      return onDrawForeground?.apply(this, arguments);
    };

    const onRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      closeHelp();
      return onRemoved?.apply(this, arguments);
    };

    const onExecuted = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (message) {
      onExecuted?.apply(this, arguments);

      const list = message?.leielsave;
      const info = Array.isArray(list) ? list[list.length - 1] : null;
      const ui = this._leielUI;
      if (!info || !ui) return;

      this._leielSaved = info;
      ui.go.disabled = false;
      showImage(this, info.filename);
      loadFolder(this);
      rememberState(this);

      const copies = Array.isArray(info.extra) ? info.extra : [];
      const kinds = copies.map((f) => String(f).split(".").pop());
      /* more than one image only happens on a batch, and then the bar speaks
         for the last of them */
      const more = Array.isArray(list) && list.length > 1
        ? `  +${list.length - 1} more` : "";
      ui.note.classList.remove("bad");
      ui.note.textContent = (kinds.length ? kinds.join(" + ") + " saved too" : "") + more;
      this.setDirtyCanvas(true, true);
    };
  },
});
