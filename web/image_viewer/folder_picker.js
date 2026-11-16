// Copyright 2026 Studio Leiel
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/* Folder browser.

   A window over the graph for choosing the folder the Image Viewer shows,
   instead of pasting its path. The browser's own folder dialog cannot do
   this - it never says where a folder is - so the looking is done by the
   ComfyUI server, which runs on the machine the folders are on (the browse
   and peek routes in visual_image_viewer.py). Only the places the viewer
   may open are shown: ComfyUI's output and input folders, and any folder
   listed in allowed_folders.txt.

   Click a folder to see how many pictures it holds and the first few of
   them; double-click to go in. "Use this folder" takes the one selected, or
   the one you are in when nothing is selected. Ctrl-click or Shift-click
   several and the button opens all of them at once, each with its
   subfolders - their paths joined by "|".

   The arrow in front of a folder - shown only when it has folders inside -
   unfolds them in place, as in Explorer.

   Keys: up/down select, right unfolds (then steps in), left folds (then
   goes to the parent), Enter goes into the folder, Backspace goes up,
   typing a name jumps to it, Ctrl+Enter uses the folder, Esc closes. */

import { api } from "../../../scripts/api.js";

const BROWSE_URL = "/leiel_viewer/browse";
const MERGE_URL = "/leiel_viewer/merge";
const PEEK_URL = "/leiel_viewer/peek";
const THUMB_URL = "/leiel_viewer/thumb";
const RECENT_KEY = "leiel.viewer.recentFolders";
const RECENT_MAX = 8;
const SORT_KEY = "leiel.viewer.folderSort";

const CSS = `
.vfp-back{position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.55);display:flex;
  align-items:center;justify-content:center;font:13px/1.35 system-ui,-apple-system,"Segoe UI",sans-serif}
.vfp{width:min(1040px,94vw);height:min(680px,88vh);display:flex;flex-direction:column;
  background:#171717;color:#d4d4d4;border:1px solid #333;border-radius:10px;overflow:hidden;
  box-shadow:0 20px 60px rgba(0,0,0,.6)}
.vfp *{box-sizing:border-box}
.vfp-head{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid #2a2a2a;background:#1d1d1d}
.vfp-title{font-weight:600;color:#eee;margin-right:6px;white-space:nowrap}
.vfp-btn{background:#262626;color:#ddd;border:1px solid #3a3a3a;border-radius:6px;height:28px;
  padding:0 10px;cursor:pointer;font:inherit;white-space:nowrap}
.vfp-btn:hover:not(:disabled){background:#323232;color:#fff}
.vfp-btn:disabled{opacity:.35;cursor:default}
.vfp-path{flex:1;min-width:0;height:28px;background:#101010;color:#e6e6e6;border:1px solid #3a3a3a;
  border-radius:6px;padding:0 9px;font:12px ui-monospace,Consolas,monospace}
.vfp-path:focus{outline:none;border-color:#9a7b3a}
.vfp-x{background:none;border:none;color:#999;font-size:20px;cursor:pointer;width:28px;height:28px}
.vfp-x:hover{color:#fff}
.vfp-body{flex:1;min-height:0;display:flex}
.vfp-side{width:190px;flex:0 0 auto;overflow-y:auto;border-right:1px solid #2a2a2a;background:#141414;padding:8px 0}
.vfp-side h4{margin:10px 12px 4px;font:600 10px system-ui,sans-serif;letter-spacing:.08em;
  text-transform:uppercase;color:#6f7780}
.vfp-side a{display:block;padding:5px 12px;color:#c8c8c8;cursor:pointer;white-space:nowrap;
  overflow:hidden;text-overflow:ellipsis;text-decoration:none;font-size:12px}
.vfp-side a:hover{background:#232323;color:#fff}
.vfp-side a.on{background:#2c2618;color:#f0cf86}
.vfp-list{flex:1;min-width:0;overflow-y:auto;padding:4px 0;outline:none}
.vfp-row{display:flex;align-items:center;gap:10px;padding:6px 14px;cursor:pointer;user-select:none}
.vfp-row:hover{background:#202020}
.vfp-row.sel{background:#2c2618}
.vfp-row{gap:8px}
.vfp-row .tw{width:20px;height:20px;flex:0 0 auto;display:flex;align-items:center;justify-content:center;
  color:#c9a55a;border-radius:4px;font-size:10px;transition:transform .12s}
.vfp-row .tw.can{cursor:pointer}
.vfp-row .tw.can:hover{background:#3a3220;color:#ffd98a}
.vfp-row .tw.open{transform:rotate(90deg)}
.vfp-row .fi{flex:0 0 auto;color:#8a7650;font-size:13px}
.vfp-row.kid .nm{color:#c2c2c2}
.vfp-row .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vfp-row .ct{color:#8b95a0;font:12px ui-monospace,Consolas,monospace;flex:0 0 auto}
.vfp-row .ct.has{color:#9fd3a8}
.vfp-row .sub{font:11px ui-monospace,Consolas,monospace;flex:0 0 auto;padding:1px 6px;border-radius:9px}
.vfp-row .sub.r{background:#1d3326;color:#9fe0b4}
.vfp-row .sub.s{background:#3a2326;color:#f0b4ba}
.vfp-row .dt{color:#6f7780;font:11px ui-monospace,Consolas,monospace;flex:0 0 auto;width:92px;text-align:right}
.vfp-row .go{flex:0 0 auto;border:1px solid #5a4a28;background:#2c2618;color:#f0cf86;border-radius:5px;
  height:22px;padding:0 8px;font:600 11px system-ui,sans-serif;cursor:pointer;visibility:hidden}
.vfp-row.sel .go,.vfp-row:hover .go{visibility:visible}
.vfp-row .go:hover{background:#3c3220}
.vfp-sort{display:flex;gap:2px;margin-left:4px}
.vfp-sort .vfp-btn{height:28px;padding:0 9px;font-size:12px}
.vfp-sort .vfp-btn.on{background:#3c3524;border-color:#9a7b3a;color:#f0cf86}
.vfp-row.sel .nm{color:#ffe2a6}
.vfp-none{padding:24px;color:#6b7280;text-align:center}
.vfp-prev{width:300px;flex:0 0 auto;border-left:1px solid #2a2a2a;background:#141414;display:flex;
  flex-direction:column;min-height:0}
.vfp-prev-h{padding:10px 12px 6px}
.vfp-prev-n{color:#eee;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vfp-prev-c{color:#8b95a0;font-size:12px;margin-top:2px}
.vfp-thumbs{flex:1;min-height:0;overflow-y:auto;display:grid;grid-template-columns:repeat(3,1fr);
  gap:4px;padding:6px 12px 12px;align-content:start}
.vfp-thumbs img{width:100%;aspect-ratio:1/1;object-fit:cover;border-radius:3px;background:#1f1f1f;display:block}
.vfp-more{grid-column:1/-1;color:#6f7780;font-size:11px;text-align:center;padding:6px 0}
.vfp-foot{display:flex;align-items:center;gap:8px;padding:10px 12px;border-top:1px solid #2a2a2a;background:#1d1d1d}
.vfp-target{flex:1;min-width:0;color:#f0cf86;font:600 12px ui-monospace,Consolas,monospace;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl;text-align:left}
.vfp-target.none{color:#8b95a0;font-weight:400;direction:ltr}
.vfp-use{background:#3c3524;border-color:#9a7b3a;color:#f0cf86;font-weight:600}
.vfp-use:hover:not(:disabled){background:#4a4029}
.vfp-err{color:#e88}
/* several folders picked at once, to merge */
.vfp-row.msel{background:#232c35}
.vfp-row.msel .nm{color:#bfe0ff}
.vfp-row.msel.sel{background:#2b3540}
.vfp-merge{background:#1f2a34;border-color:#3f6688;color:#bfe0ff;font-weight:600}
.vfp-merge:hover:not(:disabled){background:#27384a}
.vfp-mp{position:absolute;inset:0;background:rgba(10,10,10,.72);display:flex;align-items:center;
  justify-content:center;z-index:5;border-radius:inherit}
.vfp-mp-box{width:min(640px,92%);max-height:86%;overflow:auto;background:#1b1b1b;border:1px solid #3a3a3a;
  border-radius:10px;padding:16px 18px;color:#ddd;font-size:13px;box-shadow:0 12px 40px rgba(0,0,0,.5)}
.vfp-mp-box h3{margin:0 0 4px;font-size:15px;color:#eee}
.vfp-mp-box .why{color:#8b95a0;font-size:12px;margin:0 0 12px;line-height:1.5}
.vfp-mp-box label{display:flex;align-items:center;gap:9px;padding:7px 9px;border-radius:6px;cursor:pointer}
.vfp-mp-box label:hover{background:#242424}
.vfp-mp-box label.on{background:#2c2618}
.vfp-mp-box label .p{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  direction:rtl;text-align:left;font:12px ui-monospace,Consolas,monospace}
.vfp-mp-box label .d{color:#6f7780;font:11px ui-monospace,Consolas,monospace}
.vfp-mp-box label .k{color:#f0cf86;font-size:11px;font-weight:600;width:44px;text-align:right}
.vfp-mp-box .row{display:flex;gap:8px;justify-content:flex-end;margin-top:14px}
.vfp-mp-box .res{margin-top:10px;line-height:1.6}
.vfp-mp-box .res .bad{color:#e88}
`;

function injectCSS() {
  if (document.getElementById("leiel-viewer-folder-picker-css")) return;
  const s = document.createElement("style");
  s.id = "leiel-viewer-folder-picker-css";
  s.textContent = CSS;
  document.head.appendChild(s);
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

async function post(path, body) {
  const res = await api.fetchApi(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

function thumbURL(folder, name) {
  const base = api.apiURL ? api.apiURL(THUMB_URL) : "/api" + THUMB_URL;
  return `${base}?folder=${encodeURIComponent(folder)}&name=${encodeURIComponent(name)}&size=192`;
}

/* Recently used folders. Kept by the server in the user folder, so they
   outlast a cleared browser, another browser, or ComfyUI on another address
   or port - all of which give the page a fresh browser storage. The
   browser's own copy is only there to show something at once. */
const RECENT_URL = "/leiel_viewer/recent";
let recentCache = (() => {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch (e) { return []; }
})();
function keepLocal(list) {
  recentCache = list.slice(0, RECENT_MAX);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(recentCache)); } catch (e) { /* fine */ }
}
function readRecent() { return recentCache; }
async function refreshRecent() {
  try {
    const res = await api.fetchApi(RECENT_URL);
    const j = await res.json();
    if (j && j.ok && Array.isArray(j.list)) {
      /* folders remembered only by this browser, from before, are kept too */
      const merged = [...j.list, ...recentCache.filter((p) => !j.list.includes(p))];
      keepLocal(merged);
    }
  } catch (e) { /* the server copy is a convenience */ }
  return recentCache;
}
export async function pushRecent(path) {
  if (!path) return;
  keepLocal([path, ...recentCache.filter((p) => p !== path)]);
  try {
    const j = await post(RECENT_URL, { path });
    if (j && j.ok && Array.isArray(j.list)) keepLocal(j.list);
  } catch (e) { /* kept in this browser at least */ }
}

function lastName(p) {
  const t = String(p || "").replace(/[\\/]+$/, "");
  const parts = t.split(/[\\/]/);
  return parts[parts.length - 1] || t;
}

let openNow = null;     // only one picker at a time

export function openFolderPicker({ start = "", title = "Choose a folder", onPick, merge = false } = {}) {
  /* opened from a view of several folders: start beside the first of them */
  if (String(start).includes("|")) {
    const first = String(start).split("|")[0].replace(/[\\/]+$/, "");
    const k = Math.max(first.lastIndexOf("/"), first.lastIndexOf("\\"));
    start = k > 0 ? first.slice(0, k) : first;
  }
  if (openNow) openNow.close();
  injectCSS();

  // ---- dom
  const back = el("div", "vfp-back");
  const box = el("div", "vfp");
  const head = el("div", "vfp-head");
  const ttl = el("div", "vfp-title", title);
  const upBtn = el("button", "vfp-btn", "↑");
  upBtn.title = "Up one folder  (Backspace)";
  const pathIn = el("input", "vfp-path");
  pathIn.spellcheck = false;
  pathIn.placeholder = "type or paste a path and press Enter";
  const xBtn = el("button", "vfp-x", "×");
  const sortBox = el("div", "vfp-sort");
  const sortName = el("button", "vfp-btn", "Name");
  const sortDate = el("button", "vfp-btn", "Date");
  sortName.title = "Sort by name (click again to reverse)";
  sortDate.title = "Sort by date modified (click again to reverse)";
  sortBox.append(sortName, sortDate);
  head.append(ttl, upBtn, pathIn, sortBox, xBtn);

  const bodyEl = el("div", "vfp-body");
  const side = el("div", "vfp-side");
  const list = el("div", "vfp-list");
  list.tabIndex = 0;
  const prevBox = el("div", "vfp-prev");
  const prevHead = el("div", "vfp-prev-h");
  const prevName = el("div", "vfp-prev-n", "");
  const prevCount = el("div", "vfp-prev-c", "");
  prevHead.append(prevName, prevCount);
  const thumbs = el("div", "vfp-thumbs");
  prevBox.append(prevHead, thumbs);
  bodyEl.append(side, list, prevBox);

  const foot = el("div", "vfp-foot");
  const target = el("div", "vfp-target", "");
  const cancelBtn = el("button", "vfp-btn", "Cancel");
  const useBtn = el("button", "vfp-btn vfp-use", "Use this folder");
  useBtn.title = "Ctrl+Enter";
  /* Ctrl-click or Shift-click several folders, then merge them into one */
  const mergeBtn = el("button", "vfp-btn vfp-merge", "Merge");
  mergeBtn.style.display = "none";
  foot.append(target, cancelBtn, mergeBtn, useBtn);

  box.append(head, bodyEl, foot);
  box.style.position = box.style.position || "relative";
  back.append(box);
  document.body.append(back);

  // ---- state
  let sort = { by: "name", desc: false };
  try {
    const v = JSON.parse(localStorage.getItem(SORT_KEY) || "null");
    if (v && (v.by === "name" || v.by === "date")) sort = { by: v.by, desc: !!v.desc };
  } catch (e) { /* default */ }

  const S = { path: "", parent: null, dirs: [], sel: -1, rows: [], peekToken: 0, multi: new Set(),
              lastClick: { i: -1, t: 0 }, top: [],
              loadToken: 0, typed: "", typedAt: 0, info: null };

  function targetPath() {
    const d = S.dirs[S.sel];
    return d ? d.path : S.path;
  }
  /* The folders picked with Ctrl or Shift, in list order - a folder whose
     parent is picked too is left out, since the parent shows it already. */
  function picked() {
    const on = S.dirs.filter((d) => S.multi.has(d));
    return on.filter((d) => { for (let p = d.parent; p; p = p.parent) if (S.multi.has(p)) return false; return true; });
  }

  function updateFoot() {
    const t = targetPath();
    /* Cut from the left when it does not fit: the end of a path is the
       part that says which folder it is. */
    target.textContent = "";
    target.classList.toggle("none", !t);
    if (t) {
      target.append(el("bdi", "", t));
      target.title = t;
    } else {
      target.textContent = "Pick a drive or folder";
    }
    useBtn.disabled = !t;
    const many = merge ? picked().length : 0;
    useBtn.textContent = many >= 2 ? `Open ${many} folders` : "Use this folder";
    useBtn.title = many >= 2 ? "Open these folders together, each with its subfolders  (Ctrl+Enter)" : "Ctrl+Enter";
    upBtn.disabled = S.parent === null || S.parent === undefined;
    const m = merge ? [...S.multi].filter((d) => S.dirs.includes(d)).length : 0;
    mergeBtn.style.display = m >= 2 ? "" : "none";
    mergeBtn.textContent = `Merge ${m}`;
    mergeBtn.title = "Move everything in these folders into one of them - you choose which next";
  }
  function paintMulti() {
    S.rows.forEach((r, k) => r.classList.toggle("msel", S.multi.has(S.dirs[k])));
    updateFoot();
  }

  // ---- sidebar
  function buildSide(info) {
    side.textContent = "";
    const group = (label, items) => {
      if (!items.length) return;
      side.append(el("h4", "", label));
      for (const it of items) {
        const a = el("a", "", it.name);
        a.title = it.path;
        if (it.path === S.path) a.classList.add("on");
        a.addEventListener("click", () => load(it.path));
        side.append(a);
      }
    };
    group("Places", (info.roots || []).map((r) => (typeof r === "string" ? { name: r, path: r } : r)));
    group("Shortcuts", info.shortcuts || []);
    group("Recent", readRecent().map((p) => ({ name: lastName(p), path: p })));
  }

  // ---- preview
  async function preview(path, name, known) {
    const token = ++S.peekToken;
    prevName.textContent = name || path || "";
    thumbs.textContent = "";
    if (!path) { prevCount.textContent = ""; return; }
    prevCount.textContent = "…";
    let j = known;
    if (!j) {
      try { j = await post(PEEK_URL, { path }); } catch (e) { j = null; }
    }
    if (token !== S.peekToken) return;
    if (!j || j.ok === false) { prevCount.textContent = "cannot read this folder"; return; }
    /* A folder that holds only folders - a day of renders sorted by scene -
       is previewed with the pictures in its subfolders, which is what the
       viewer will show when it is opened. */
    const deep = !j.images && j.deep;
    prevCount.textContent = j.images
      ? `${j.images} image${j.images === 1 ? "" : "s"}`
      : deep ? `${j.deep >= 1000 ? "1000+" : j.deep} in subfolders` : "no images";
    /* Every picture in the folder, not a sample: the thumbnails load only
       as they are scrolled into view, so a folder of hundreds costs only
       the ones looked at. */
    for (const n of j.sample || []) {
      const img = el("img");
      img.loading = "lazy";
      img.decoding = "async";
      img.title = n;
      img.src = thumbURL(path, n);
      thumbs.append(img);
    }
    const shown = (j.sample || []).length;
    if (!deep && j.images > shown) thumbs.append(el("div", "vfp-more", `first ${shown} of ${j.images}`));
  }

  // ---- list
  function select(i, scroll) {
    if (i >= S.dirs.length) i = S.dirs.length - 1;
    S.sel = i;
    S.rows.forEach((r, k) => r.classList.toggle("sel", k === i));
    if (scroll && S.rows[i]) S.rows[i].scrollIntoView({ block: "nearest" });
    updateFoot();
    updateSortButtons();
    const d = S.dirs[i];
    if (d) preview(d.path, d.name, null);
    else preview(S.path, lastName(S.path), S.path ? S.info : null);
  }

  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

  /* The list is a tree: S.top holds the folders of the folder being shown,
     each may hold its own kids once opened, and S.dirs is what is on screen
     - the tree walked in order through every open node. */
  /* A folder sorted on its own - Name or Date pressed with it selected -
     keeps that order for what is inside it, and only there; everything else
     follows the order of the whole list. */
  function sortLevel(arr, by) {
    const o = by || sort;
    const k = o.desc ? -1 : 1;
    arr.sort((x, y) => {
      if (o.by === "date") {
        const d = (x.mtime || 0) - (y.mtime || 0);
        if (d) return d * k;
      }
      return collator.compare(x.name, y.name) * (o.by === "name" ? k : 1);
    });
    for (const n of arr) if (n.kids) sortLevel(n.kids, n.sort || o);
  }
  /* the order a folder's contents are in - its own, or the one it inherits */
  function orderOf(node) {
    for (let n = node; n; n = n.parent) if (n.sort) return n.sort;
    return sort;
  }
  function sortDirs() { if (S.path) sortLevel(S.top); }

  function flatten() {
    const out = [];
    const walk = (arr) => {
      for (const n of arr) {
        out.push(n);
        if (n.open && n.kids) walk(n.kids);
      }
    };
    walk(S.top);
    S.dirs = out;
  }

  function adopt(list, depth, parent) {
    return (list || []).map((d) => Object.assign(d, { depth, parent, open: false, kids: null }));
  }

  async function toggle(node, wantOpen) {
    const to = wantOpen === undefined ? !node.open : wantOpen;
    if (to === node.open) return;
    const keep = S.dirs[S.sel];
    if (to && !node.kids) {
      let j;
      try { j = await post(BROWSE_URL, { path: node.path }); } catch (e) { j = null; }
      if (!j || !j.ok) return;
      node.kids = adopt(j.dirs, node.depth + 1, node);
      sortLevel(node.kids, orderOf(node));
      node.subs = node.kids.length;
    }
    node.open = to;
    // closing a branch with the selection inside it moves the selection up
    let sel = keep;
    for (let p = keep && keep.parent; p; p = p.parent) if (p === node && !to) sel = node;
    rerender(sel);
  }

  function rerender(keepNode) {
    flatten();
    buildList();
    const i = keepNode ? S.dirs.indexOf(keepNode) : -1;
    S.sel = i;
    S.rows.forEach((r, k) => r.classList.toggle("sel", k === i));
    if (S.rows[i]) S.rows[i].scrollIntoView({ block: "nearest" });
    updateFoot();
    updateSortButtons();
  }

  function updateSortButtons() {
    /* the buttons show the order of the selected folder's contents */
    const o = orderOf(S.dirs[S.sel]);
    const arrow = o.desc ? " ↓" : " ↑";
    sortName.textContent = "Name" + (o.by === "name" ? arrow : "");
    sortDate.textContent = "Date" + (o.by === "date" ? arrow : "");
    sortName.classList.toggle("on", o.by === "name");
    sortDate.classList.toggle("on", o.by === "date");
  }

  /* With a folder selected, Name and Date sort what is inside it, and
     only that - opening it first if it is still closed. With nothing
     selected they sort the whole list, and that order is remembered. */
  async function setSort(by) {
    const node = S.dirs[S.sel];
    const cur = orderOf(node);
    const next = cur.by === by ? { by, desc: !cur.desc } : { by, desc: by === "date" };  // newest first, A first
    if (node) {
      node.sort = next;
      if (!node.open) await toggle(node, true);
      if (node.kids) sortLevel(node.kids, next);
    } else {
      sort = next;
      try { localStorage.setItem(SORT_KEY, JSON.stringify(sort)); } catch (e) { /* fine */ }
      sortDirs();
    }
    rerender(node);
    updateSortButtons();
  }
  sortName.addEventListener("click", () => setSort("name"));
  sortDate.addEventListener("click", () => setSort("date"));

  function fmtDate(t) {
    if (!t) return "";
    const d = new Date(t * 1000);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  /* Going into a folder is done by a double click counted here rather than
     by the browser's dblclick event, which some ComfyUI frontends swallow
     on the way past; and by the Open button on the row, and by Enter. */
  function onRowClick(i, e) {
    e.stopPropagation();
    const now = performance.now();
    const twice = S.lastClick.i === i && now - S.lastClick.t < 450;
    S.lastClick = { i, t: twice ? 0 : now };
    if (merge && (e.ctrlKey || e.metaKey || e.shiftKey)) {
      /* several at once, the Windows way: Ctrl adds or drops one, Shift
         takes the whole run from the last one picked */
      S.lastClick = { i: -1, t: 0 };
      const d = S.dirs[i];
      if (e.shiftKey && S.sel >= 0) {
        const a = Math.min(S.sel, i), b = Math.max(S.sel, i);
        for (let k = a; k <= b; k++) S.multi.add(S.dirs[k]);
      } else {
        if (!S.multi.size && S.dirs[S.sel] && S.sel !== i) S.multi.add(S.dirs[S.sel]);
        if (S.multi.has(d)) S.multi.delete(d); else S.multi.add(d);
      }
      select(i, false);
      paintMulti();
      list.focus({ preventScroll: true });
      return;
    }
    if (S.multi.size) { S.multi.clear(); }
    if (twice) { open(i); return; }
    select(i, false);
    paintMulti();
    list.focus({ preventScroll: true });
  }

  /* ---- merging: the folders picked, one chosen to keep, the rest
     emptied into it and removed */
  function openMerge() {
    const picked = [...S.multi].filter((d) => S.dirs.includes(d));
    if (picked.length < 2) return;
    /* the newest is kept unless another is chosen */
    let keep = picked.reduce((a, b) => ((b.mtime || 0) > (a.mtime || 0) ? b : a), picked[0]);
    const mp = el("div", "vfp-mp");
    const bx = el("div", "vfp-mp-box");
    bx.append(el("h3", "", `Merge ${picked.length} folders into one`));
    bx.append(el("p", "why",
      "Choose the folder to keep. Everything inside the others moves into it, " +
      "each at the same place below it. A name already taken there gets (1), (2) " +
      "on the end - nothing is written over. Every folder left empty afterwards is removed."));
    const labels = [];
    for (const d of picked) {
      const lb = el("label", "");
      const rb = document.createElement("input");
      rb.type = "radio";
      rb.name = "vfp-keep";
      rb.checked = d === keep;
      const k = el("span", "k", d === keep ? "keep" : "");
      rb.addEventListener("change", () => {
        keep = d;
        labels.forEach(([l, kk, dd]) => { l.classList.toggle("on", dd === keep); kk.textContent = dd === keep ? "keep" : ""; });
      });
      const pth = el("span", "p");
      pth.append(el("bdi", "", d.path));
      pth.title = d.path;
      lb.append(rb, pth, el("span", "d", fmtDate(d.mtime)), k);
      lb.classList.toggle("on", d === keep);
      labels.push([lb, k, d]);
      bx.append(lb);
    }
    const res = el("div", "res");
    const row = el("div", "row");
    const no = el("button", "vfp-btn", "Cancel");
    const go = el("button", "vfp-btn vfp-use", "Merge");
    row.append(no, go);
    bx.append(res, row);
    mp.append(bx);
    box.append(mp);
    const shut = () => mp.remove();
    no.addEventListener("click", shut);
    mp.addEventListener("click", (e) => { if (e.target === mp) shut(); });
    go.addEventListener("click", async () => {
      go.disabled = true; no.disabled = true;
      res.textContent = "merging...";
      let j;
      try {
        j = await post(MERGE_URL, { sources: picked.map((d) => d.path), target: keep.path });
      } catch (e) { j = { ok: false, error: "could not reach the server" }; }
      res.textContent = "";
      if (!j || !j.ok) {
        res.append(el("div", "bad", (j && j.error) || "the merge did not go through"));
        no.disabled = false; no.textContent = "Close";
        return;
      }
      res.append(el("div", "", `${j.moved} file${j.moved === 1 ? "" : "s"} moved` +
        (j.renamed ? ` - ${j.renamed} given a (1), (2) name` : "") +
        ` - ${j.removed} empty folder${j.removed === 1 ? "" : "s"} removed`));
      for (const f of j.failed || []) res.append(el("div", "bad", f));
      S.multi.clear();
      go.style.display = "none";
      no.disabled = false; no.textContent = "Done";
      no.onclick = null;
      no.addEventListener("click", () => load(S.path));
    });
  }
  mergeBtn.addEventListener("click", openMerge);

  function open(i) {
    const d = S.dirs[i];
    if (d) load(d.path);
  }

  function buildList() {
    list.textContent = "";
    S.rows = S.dirs.map((d, i) => {
      const r = el("div", "vfp-row" + (d.depth ? " kid" : "") + (S.multi.has(d) ? " msel" : ""));
      r.style.paddingLeft = `${10 + (d.depth || 0) * 20}px`;
      const isDrive = d.images === null || d.images === undefined;
      // the arrow only where there is something under it
      const can = isDrive || d.subs === undefined || d.subs > 0;
      const tw = el("span", "tw" + (can ? " can" : "") + (d.open ? " open" : ""), can ? "▶" : "");
      if (can) {
        tw.title = d.open ? "Hide subfolders  (←)" : "Show subfolders  (→)";
        tw.addEventListener("click", (e) => { e.stopPropagation(); toggle(d); });
      }
      r.append(tw, el("span", "fi", isDrive ? "⛁" : "▤"), el("span", "nm", d.name));
      if (!isDrive) {
        if (d.render !== undefined) {
          const b = el("span", "sub r", `R ${d.render}`);
          b.title = `${d.render} in render`;
          r.append(b);
        }
        if (d.skip !== undefined) {
          const b = el("span", "sub s", `S ${d.skip}`);
          b.title = `${d.skip} in skip`;
          r.append(b);
        }
        const c = el("span", "ct" + (d.images ? " has" : ""), d.images ? String(d.images) : "–");
        c.title = `${d.images} images in the folder itself`;
        r.append(c, el("span", "dt", fmtDate(d.mtime)));
      }
      const go = el("button", "go", "Open ›");
      go.title = "Go into this folder  (double-click, Enter)";
      go.addEventListener("click", (e) => { e.stopPropagation(); open(i); });
      r.append(go);
      r.addEventListener("click", (e) => onRowClick(i, e));
      list.append(r);
      return r;
    });
    if (!S.dirs.length) list.append(el("div", "vfp-none", "no folders inside"));
  }

  async function load(path) {
    const token = ++S.loadToken;
    let j;
    try { j = await post(BROWSE_URL, { path }); } catch (e) { j = { ok: false, error: "could not reach the server" }; }
    if (token !== S.loadToken) return;
    if (!j || !j.ok) {
      prevCount.textContent = "";
      prevName.textContent = "";
      thumbs.textContent = "";
      list.textContent = "";
      list.append(el("div", "vfp-none vfp-err", (j && j.error) || "cannot open this folder"));
      return;
    }
    const from = S.path;
    S.multi.clear();
    S.path = j.path || "";
    S.parent = j.parent;
    S.top = adopt(j.dirs, 0, null);
    if (j.path) sortDirs();               // drives stay in drive order
    flatten();
    S.lastClick = { i: -1, t: 0 };
    S.info = { ok: true, images: j.images, sample: j.sample, deep: j.deep };
    pathIn.value = S.path;
    pathIn.scrollLeft = pathIn.scrollWidth;
    S.sideInfo = j;
    buildSide(j);
    buildList();
    /* Coming up out of a folder, the folder just left is selected, so a
       wrong turn is one key to undo. */
    const cameFrom = S.dirs.findIndex((d) => d.path === from);
    select(cameFrom, true);
    list.focus({ preventScroll: true });
  }

  // ---- actions
  function close() {
    window.removeEventListener("keydown", onKey, true);
    back.remove();
    if (openNow === api_) openNow = null;
  }
  function use() {
    const many = merge ? picked() : [];
    if (many.length >= 2) {
      close();
      if (typeof onPick === "function") onPick(many.map((d) => d.path).join("|"), null);
      return;
    }
    const t = targetPath();
    if (!t) return;
    pushRecent(t);
    close();
    /* the order the folders were looked through goes along with the pick,
       so the viewer can show them the same way */
    const o = orderOf(S.dirs[S.sel]);
    if (typeof onPick === "function") onPick(t, { by: o.by, desc: o.desc });
  }
  function up() {
    if (S.parent === null || S.parent === undefined) return;
    load(S.parent);
  }

  upBtn.addEventListener("click", up);
  xBtn.addEventListener("click", close);
  cancelBtn.addEventListener("click", close);
  useBtn.addEventListener("click", use);
  back.addEventListener("pointerdown", (e) => { if (e.target === back) close(); });
  list.addEventListener("click", (e) => { if (e.target === list) select(-1, false); });
  pathIn.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); load(pathIn.value.trim()); }
  });
  // keep the graph underneath from reacting to anything done in here
  for (const ev of ["pointerdown", "mousedown", "wheel", "contextmenu"]) {
    back.addEventListener(ev, (e) => e.stopPropagation());
  }

  function onKey(e) {
    /* the merge panel open: Escape shuts it, and the list stays still */
    const mp = box.querySelector(".vfp-mp");
    if (mp) {
      if (e.key === "Escape") mp.remove();
      e.stopPropagation();
      return;
    }
    const inPath = e.target === pathIn;
    if (e.key === "Escape") { close(); }
    else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { use(); }
    else if (inPath) { e.stopPropagation(); return; }      // typing a path
    else if (e.key === "ArrowDown") { select(Math.min(S.dirs.length - 1, S.sel + 1), true); }
    else if (e.key === "ArrowUp") { select(Math.max(-1, S.sel - 1), true); }
    else if (e.key === "Home") { select(0, true); }
    else if (e.key === "End") { select(S.dirs.length - 1, true); }
    else if (e.key === "Enter") { open(S.sel); }
    else if (e.key === "ArrowRight") {
      // as in Explorer: open the branch, then step into it
      const d = S.dirs[S.sel];
      if (d && !d.open) toggle(d, true);
      else if (d && d.kids && d.kids.length) select(S.sel + 1, true);
    }
    else if (e.key === "ArrowLeft") {
      const d = S.dirs[S.sel];
      if (d && d.open) toggle(d, false);
      else if (d && d.parent) select(S.dirs.indexOf(d.parent), true);
      else up();
    }
    else if (e.key === "Backspace") { up(); }
    else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // type-ahead: jump to the first folder whose name starts with it
      const now = performance.now();
      S.typed = (now - S.typedAt < 800 ? S.typed : "") + e.key.toLowerCase();
      S.typedAt = now;
      const i = S.dirs.findIndex((d) => d.name.toLowerCase().startsWith(S.typed));
      if (i >= 0) select(i, true);
    }
    else { e.stopPropagation(); return; }
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }
  window.addEventListener("keydown", onKey, true);

  const api_ = { close };
  openNow = api_;
  updateFoot();
  updateSortButtons();
  load(start || "");
  /* the server's list arrives after the first draw: the side is drawn again */
  refreshRecent().then(() => { if (S.sideInfo && back.isConnected) buildSide(S.sideInfo); });
  return api_;
}
