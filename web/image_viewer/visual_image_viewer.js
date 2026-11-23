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

/* Visual Image Viewer.

   A folder of pictures laid out as thumbnails. A click opens one large;
   left and right arrows, the wheel or the side buttons step through; Esc,
   Enter, the up arrow or a click on the picture goes back to the grid.

   Up and down move between levels: down from the large view is full screen,
   up from full screen is the large view again, up from there the grid. A
   zoomed picture taller than the panel takes them for scrolling instead,
   until it fits again. In the grid they move a row.

   Arrows stop at either end. Space or ] goes on to the next picture and,
   past the last, round to the first, so a folder can be watched as one
   unbroken loop; [ or Shift+Space goes back the same way. Page Down and
   Page Up go to the next and previous folder.

   * shows the picture at 100% - one pixel of the file to one pixel of the
   screen, whatever the graph's zoom - and / goes back to fitting it; + and -
   step the zoom, and at 100% the picture is dragged to look around it.
   F is full screen.

   FOLLOW: with it on, each picture a save node writes - Visual Save Image or
   ComfyUI's own - is shown as soon as it lands, in whatever folder it went
   to. The viewer then works as the render's monitor.

   P marks the picture on screen as a pick, and Picks shows only those -
   the good ones of a day of renders, in one place. Delete moves the picture
   into a _deleted folder beside it, out of sight; Ctrl+Z brings it back.
   The Deleted button opens the bin of the folder on show - its own _deleted
   folder and those of the folders inside it - to look through, restore from
   or empty, to the Recycle Bin where there is one.

   Copy picks puts the picks into one folder - a series folder in input,
   say, ready for the upscale. R turns the large view a quarter round, for
   looking only: the file is not touched.

   I opens the prompt the picture was rendered with, read back from the
   graph ComfyUI saves in every PNG - for a Series Lab render rebuilt anchor
   by anchor, as the Lab built it - to read and to copy.

   Ctrl+C copies the picture on screen - and the file itself as well, when
   a pack on the same computer offers to put it on the clipboard. Open workflow in the
   prompt panel opens the graph the picture was made with, as dropping the
   file on ComfyUI would.

   The node takes nothing and returns nothing. Its folder, sort, thumbnail
   size and FOLLOW are kept in the node's properties, so they travel with the
   workflow. */

import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

/* The colour of the series on the Series Book, so every node of the suite
   wears the same one: the series named, when the Book shows it, else the
   series open in the Book. Empty when no Book is on the canvas. */
function suiteTone(name) {
  const want = String(name || "").trim().toLowerCase();
  let cur = "", only = "", count = 0;
  const nodes = (app.graph && (app.graph._nodes || app.graph.nodes)) || [];
  for (const n of nodes) {
    if ((n.comfyClass || n.type) !== "LeielSeriesBook") continue;
    for (const w of n.widgets || []) {
      if (!w.element) continue;
      for (const box of w.element.querySelectorAll(".lsb-pbox")) {
        const nm = box.querySelector(".lsb-gname");
        const gt = box.querySelector(".lsb-gtone");
        const tone = box.style.getPropertyValue("--sg").trim() || (gt && gt.style.getPropertyValue("--gt").trim()) || "";
        if (!nm || !tone) continue;
        if (want && nm.textContent.trim().toLowerCase() === want) return tone;
        if (!cur && box.classList.contains("cur")) cur = tone;
        count++; only = tone;
      }
    }
  }
  return cur || (count === 1 ? only : "");
}
/* Puts the colour on the node's frame, and follows it as the Book changes. */
function wearTone(root, nameOf) {
  const put = () => {
    if (!root.isConnected) return;
    let name = "";
    try { name = nameOf ? nameOf() || "" : ""; } catch (e) { /* not ready yet */ }
    const tone = suiteTone(name);
    if (root.style.getPropertyValue("--sg").trim() === tone && root.classList.contains("tinted") === !!tone) return;
    if (tone) { root.style.setProperty("--sg", tone); root.classList.add("tinted"); }
    else { root.style.removeProperty("--sg"); root.classList.remove("tinted"); }
  };
  put();
  return setInterval(put, 400);
}
import { openFolderPicker, pushRecent } from "./folder_picker.js";

const VIEWER = "LeielImageViewer";

const LIST_URL = "/leiel_viewer/list";
const THUMB_URL = "/leiel_viewer/thumb";
const VIEW_URL = "/leiel_viewer/view";
const RAW_URL = "/leiel_viewer/raw";
const PICK_URL = "/leiel_viewer/pick";
const DELETE_URL = "/leiel_viewer/delete";
const RESTORE_URL = "/leiel_viewer/restore";
const EMPTY_URL = "/leiel_viewer/empty";
const UNTRASH_URL = "/leiel_viewer/untrash";
const PURGE_URL = "/leiel_viewer/purge";
const FILTER_URL = "/leiel_viewer/filter";
const COPY_URL = "/leiel_viewer/copy";
const META_URL = "/leiel_viewer/meta";
const CLIP_URL = "/leiel_viewer/clip";
const META_W = 400;             // the prompt panel, at most
const ROOTS_URL = "/leiel_viewer/roots";
const DEST_KEY = "leiel.viewer.copyDest";      // where picks were last copied
const LAST_KEY = "leiel.viewer.lastFolder";    // the folder last on show, in any viewer
/* The folder last looked at, so a viewer opens where the work was left -
   null when there is none, or the browser keeps nothing. */
function lastFolder() {
  try { const v = localStorage.getItem(LAST_KEY); return v === null ? null : v; } catch (e) { return null; }
}
function rememberFolder(f) {
  try { localStorage.setItem(LAST_KEY, String(f || "")); } catch (e) { /* fine */ }
}
const DEST_MAX = 6;
const UNDO_LIMIT = 50;

const POLL_MS = 4000;           // a quiet rescan, for files arriving from elsewhere
const THUMB_MIN = 96;
const THUMB_MAX = 360;
const THUMB_STEP = 32;
const THUMB_DEFAULT = 160;

// --------------------------------------------------------------- helpers
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function url(path, params) {
  const q = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  const base = api.apiURL ? api.apiURL(path) : "/api" + path;
  return `${base}?${q}`;
}

async function postJSON(path, body) {
  const res = await api.fetchApi(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

function pad(n, width) {
  return String(n).padStart(width || 2, "0");
}

// ------------------------------------------------------------------- css
const CSS = `
.viv-ctx{position:fixed;z-index:10001;min-width:220px;padding:5px;background:#121418;border:1px solid #e4c27a;
  border-radius:9px;box-shadow:0 8px 24px #000c;font:12px system-ui,sans-serif;color:#d8dbe0;}
.viv-ctx .h{padding:4px 8px 6px;font-size:10px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:#e4c27a;}
.viv-ctx button{display:block;width:100%;text-align:left;padding:7px 9px;border:0;border-radius:6px;background:none;
  color:#d8dbe0;font:inherit;cursor:pointer;}
.viv-ctx button:hover{background:#e4c27a22;color:#fff3d6;}
.viv-ctx button small{display:block;font-size:10px;color:#7d828b;margin-top:1px;}
.viv-ctx button[disabled]{cursor:default;opacity:.55;}
.viv-ctx button[disabled]:hover{background:none;color:#d8dbe0;}
.viv-ctx .sep{height:1px;background:#2a2d33;margin:4px 6px;}
/* the Idea Box's own part: silver, as My works is there */
.viv-ctx .h.ib{color:#c9cfd8}
.viv-ctx button.ib:hover{background:#c9cfd81f;color:#f3f5f8}
.viv-ctx .h.lq{color:#e9b48c}
.viv-ctx button.lq:hover{background:#d9783c24;color:#ffd9bd}
.viv{display:flex;flex-direction:column;width:100%;height:100%;box-sizing:border-box;
  background:#121315;border:1px solid #26282d;border-radius:8px;overflow:hidden;
  font:12px/1.3 system-ui,-apple-system,"Segoe UI",sans-serif;color:#cfd2d8;outline:none}
.viv *{box-sizing:border-box}
.viv-bar{display:flex;align-items:center;gap:6px;padding:7px 8px 6px;background:#17181b;flex:0 0 auto}
.viv-bar2{display:flex;align-items:center;gap:6px;padding:0 8px 7px;background:#17181b;
  border-bottom:1px solid #26282d;flex:0 0 auto;min-width:0}
.viv-path{flex:1 1 auto;min-width:60px;height:22px;border-radius:999px;border:1px solid #33363d;
  background:#0f1012;color:#d6d9de;padding:0 10px;font:11px ui-monospace,Consolas,monospace;outline:none}
.viv-path:focus{border-color:#d9b26a}
.viv-path.bad{border-color:#b5584d;color:#f0b3a8}
.viv-btn{height:22px;box-sizing:border-box;padding:0 10px;border-radius:999px;cursor:pointer;
  background:#14161a;border:1px solid #3a3e46;color:#aeb3bc;font-family:inherit;
  font-size:9.5px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;line-height:1;
  display:inline-flex;align-items:center;justify-content:center;gap:5px;flex:0 0 auto;
  transition:color .1s linear,border-color .1s linear,background-color .1s linear}
.viv-btn:hover{border-color:#d9b26a;color:#f0d9a8;background:#1c1912}
.viv-btn.sq{padding:0;width:24px;font-size:13px;letter-spacing:0}
.viv-btn.on{border-color:#d9b26a;color:#f3dcaa;background:#2a2416}
.viv-btn.follow.on{border-color:#5fc08a;color:#c9f2d9;background:#15281e}
.viv-btn.follow.on::before{content:"";width:6px;height:6px;border-radius:50%;background:#5fc08a;
  box-shadow:0 0 6px #5fc08a}
.viv-seg{display:inline-flex;border:1px solid #3a3e46;border-radius:999px;overflow:hidden;flex:0 0 auto}
.viv-seg .viv-btn{border:none;border-radius:0;height:20px}
.viv-seg .viv-btn+.viv-btn{border-left:1px solid #3a3e46}
.viv-info{margin-left:auto;color:#8b909a;white-space:nowrap;overflow:hidden;
  text-overflow:ellipsis;min-width:0;font-size:11px}
.viv-info.flash{color:#f0d9a8}
.viv-body{position:relative;flex:1 1 auto;min-height:0}
.viv-grid{position:absolute;inset:0;overflow-y:auto;overflow-x:hidden;display:grid;
  grid-template-columns:repeat(auto-fill,minmax(var(--viv-t,160px),1fr));
  grid-auto-rows:max-content;gap:7px;padding:8px;align-content:start}
.viv-cell{position:relative;cursor:pointer;background:#1a1b1e;border-radius:5px;
  outline:2px solid transparent;outline-offset:-2px}
.viv-cell img{width:100%;aspect-ratio:1/1;object-fit:contain;display:block;background:#16171a;
  border-radius:5px 5px 0 0}
.viv-cell span{display:block;text-align:center;font:600 11px ui-monospace,Consolas,monospace;
  font-size:max(11px,calc(var(--viv-t,160px) * .07));letter-spacing:.04em;
  color:#a9aeb7;padding:4px 0 5px;background:#0e0f11;border-radius:0 0 5px 5px}
.viv-cell:hover img{filter:brightness(1.12)}
.viv-group{grid-column:1/-1;display:flex;align-items:center;gap:10px;padding:7px 12px 7px 8px;
  margin:10px 0 2px;background:#1b1c20;border:1px solid #2b2d33;border-left:3px solid var(--sgv,#c9a55a);
  border-radius:6px;cursor:pointer;user-select:none;min-width:0}
.viv-group:first-child{margin-top:0}
/* in the colour of the series, as the Series Layout and Report */
.viv.tinted{background:color-mix(in srgb,var(--sg) 7%,#121315);border:2px solid color-mix(in srgb,var(--sg) 62%,#2a2c31);border-radius:10px}
.viv.tinted .viv-bar,.viv.tinted .viv-bar2{background:color-mix(in srgb,var(--sg) 11%,#17181b)}
.viv.tinted .viv-bar2{border-bottom-color:color-mix(in srgb,var(--sg) 22%,#26282d)}
.viv.tinted .viv-group{background:color-mix(in srgb,var(--sg) 6%,#1b1c20);border-color:color-mix(in srgb,var(--sg) 20%,#2b2d33);border-left-color:var(--sgv,#c9a55a)}
.viv.tinted .viv-cell{background:color-mix(in srgb,var(--sg) 5%,#1a1b1e)}
.viv.tinted .viv-cell img{background:color-mix(in srgb,var(--sg) 4%,#16171a)}
.viv-group:hover{background:#211f1a;border-color:#3a352a;border-left-color:var(--sgv,#e4c27a)}
.viv-group .tw{color:#c9a55a;font-size:9px;width:10px;flex:0 0 auto;transition:transform .12s}
.viv-group.shut .tw{transform:rotate(-90deg)}
.viv-group .n{margin-left:auto;font:700 11px ui-monospace,Consolas,monospace;color:#c9cdd4;
  background:#111215;border:1px solid #33363d;border-radius:999px;padding:2px 9px;flex:0 0 auto}
.viv-crumbs{display:flex;align-items:center;gap:6px;min-width:0;overflow:hidden;white-space:nowrap;
  font:700 13.5px system-ui,"Segoe UI",sans-serif;color:#d9dce2}
.viv-crumbs .seg{flex:0 1 auto;min-width:24px;overflow:hidden;text-overflow:ellipsis}
.viv-crumbs .seg.last{color:#f3d48f;flex:0 0 auto}
.viv-crumbs .seg.first{color:var(--top,#9fc9dc);flex:0 0 auto}
.viv-crumbs .sep{color:#5d616a;font-weight:400;flex:0 0 auto}
.viv-crumbs .here{color:#9aa0a9;font-weight:600;font-style:italic}
.viv-cell.hid{display:none}
/* LIST: a folder shown as rows - a small thumbnail, then the file's name,
   date, size and pixels, the way a file window lists them */
.viv-cell .fn,.viv-cell .fd,.viv-cell .fs,.viv-cell .fz{display:none}
.viv-cell.row{grid-column:1/-1;display:flex;align-items:center;gap:12px;padding:3px 44px 3px 6px;
  background:#16171a;border-radius:4px}
.viv-cell.row:nth-child(even){background:#191a1e}
.viv-cell.row img{width:max(30px,calc(var(--viv-t,160px) * .28));height:max(30px,calc(var(--viv-t,160px) * .28));
  aspect-ratio:auto;flex:0 0 auto;border-radius:3px;object-fit:cover}
.viv-cell.row span{flex:0 0 34px;background:none;padding:0;text-align:right;font-size:10.5px;color:#6c7079;border-radius:0}
.viv-cell.row .fn{display:block;flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  font:500 12.5px system-ui,"Segoe UI",sans-serif;color:#d9dce2}
.viv-cell.row .fd,.viv-cell.row .fs,.viv-cell.row .fz{display:block;flex:0 0 auto;white-space:nowrap;
  font:400 11.5px system-ui,"Segoe UI",sans-serif;color:#8b909a;text-align:right}
.viv-cell.row .fd{width:150px}
.viv-cell.row .fz{width:86px}
.viv-cell.row .fs{width:70px}
.viv-cell.row .pk{top:50%;right:8px;margin-top:-12px}
.viv-cell.row .ck{top:50%;margin-top:-11px}
.viv-cell.row.cur{outline-width:2px}
.viv-cell.row.cur .fn{color:#f3dcaa}
.viv-cell.row.picked .fn{color:#f3d48f}
.viv-lhead{grid-column:1/-1;display:flex;align-items:center;gap:12px;padding:2px 44px 4px 6px;
  border-bottom:1px solid #2b2d33;font:600 10px system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:#6c7079}
.viv-lhead .hn{flex:1 1 auto;padding-left:calc(max(30px,calc(var(--viv-t,160px) * .28)) + 58px)}
.viv-lhead .hd{width:150px;text-align:right}
.viv-lhead .hz{width:86px;text-align:right}
.viv-lhead .hs{width:70px;text-align:right}
.viv-lhead.hid{display:none}
.viv-lhead>div{cursor:pointer;user-select:none}
.viv-lhead>div:hover{color:#c9cdd4}
.viv-lhead>div.on{color:#e4c27a}
.viv-lhead>div i{font-style:normal;font-size:8px;margin-left:4px}
.viv-group .lv{flex:0 0 auto;margin-left:auto;font:700 9.5px system-ui,sans-serif;letter-spacing:.06em;
  text-transform:uppercase;color:#9aa0a9;background:#111215;border:1px solid #33363d;border-radius:999px;
  padding:2px 9px;cursor:pointer}
.viv-group .lv:hover{color:#e4c27a;border-color:#5a4c2c}
.viv-group .lv.on{color:#e4c27a;border-color:#7a6535;background:#1f1a10}
.viv-group .lv+.n{margin-left:0}
.viv-tile{cursor:pointer;background:#1b1c20;border:1px solid #2b2d33;border-left:3px solid #c9a55a;
  border-radius:5px;overflow:hidden;display:flex;flex-direction:column}
.viv-tile:hover{background:#211f1a;border-color:#3a352a;border-left-color:#e4c27a}
.viv-tile .in{aspect-ratio:1/1;display:flex;flex-direction:column;justify-content:center;gap:3px;
  padding:10px 12px;min-width:0;overflow:hidden}
.viv-tile .seg{font:600 12px system-ui,"Segoe UI",sans-serif;color:#c9cdd4;white-space:nowrap;
  overflow:hidden;text-overflow:ellipsis}
.viv-tile .seg+.seg::before{content:"\\203A  ";color:#5d616a;font-weight:400}
.viv-tile .seg.last{font-size:13.5px;font-weight:700;color:#f3d48f}
.viv-tile .seg.here{font-style:italic;color:#9aa0a9}
.viv-tile span{display:block;text-align:center;font:700 11px ui-monospace,Consolas,monospace;
  color:#c9a55a;padding:4px 0 5px;background:#0e0f11}
.viv-cell em{display:block;font:500 10px system-ui,sans-serif;font-style:normal;color:#7d828b;
  text-align:center;padding:4px 6px 0;background:#0e0f11;white-space:nowrap;overflow:hidden;
  text-overflow:ellipsis}
.viv-cell em+span{padding-top:2px}
.viv-cell.cur{outline:3px solid #d9b26a}
.viv-cell.cur span{color:#f3dcaa}
.viv-cell.fresh::after{content:"NEW";position:absolute;top:6px;left:6px;padding:2px 6px;
  border-radius:999px;background:#15281e;border:1px solid #5fc08a;color:#c9f2d9;
  font:700 8.5px system-ui,sans-serif;letter-spacing:.8px}
.viv-large{position:absolute;inset:0;display:none;background:#0c0d0e}
.viv.large .viv-large{display:block}
.viv.large .viv-grid{visibility:hidden}
.viv-cap{position:absolute;top:0;left:0;right:0;height:32px;display:flex;align-items:center;
  gap:12px;color:#f3dcaa;font:600 12px ui-monospace,Consolas,monospace;
  background:#141518;white-space:nowrap;overflow:hidden;padding:0 12px;border-bottom:1px solid #26282d}
.viv-cap .viv-crumbs{flex:0 1 auto}
.viv-cap .viv-name{color:#8b909a;font-weight:400;overflow:hidden;text-overflow:ellipsis;min-width:0;flex:1 1 auto}
.viv-dim{color:#6f747d;font-weight:400}
.viv-nav{position:absolute;top:calc(50% + 16px);transform:translateY(-50%);width:40px;
  height:76px;border:none;background:rgba(0,0,0,.35);color:#eee;font-size:24px;cursor:pointer;
  border-radius:6px;opacity:.5;z-index:2}
.viv-nav:hover{opacity:1;background:rgba(0,0,0,.65)}
.viv-nav:disabled{opacity:.12;cursor:default}
.viv-prev{left:6px}.viv-next{right:6px}
.viv-stage{position:absolute;left:0;right:0;top:32px;bottom:0;overflow:hidden;display:flex}
.viv-stage img{margin:auto;display:block;width:100%;height:100%;object-fit:contain;cursor:zoom-out;
  flex:0 0 auto}
.viv.actual .viv-stage{overflow:auto}
.viv.actual .viv-stage img{object-fit:fill;cursor:grab;max-width:none;max-height:none}
.viv.actual .viv-stage.drag img{cursor:grabbing}
.viv:fullscreen .viv-stage,.viv:fullscreen .viv-stage img{cursor:zoom-in}
.viv:fullscreen.ctl .viv-stage,.viv:fullscreen.ctl .viv-stage img{cursor:zoom-out}
.viv:fullscreen .viv-stage.drag,.viv:fullscreen .viv-stage.drag img{cursor:grabbing}
.viv-osd{display:none;position:absolute;top:10px;left:14px;right:14px;z-index:3;pointer-events:none;
  color:#e8e8e8;font:12px/1.5 system-ui,"Segoe UI",sans-serif;text-shadow:0 0 3px #000,0 0 8px #000}
.viv-osd .viv-crumbs{font-size:17px}
.viv-osd .viv-crumbs .sep{color:#b9bdc5}
.viv-osd .line2{white-space:pre;overflow:hidden;text-overflow:ellipsis;color:#d5d8dd;margin-top:2px}
.viv-flashdir{position:absolute;left:50%;top:44px;transform:translateX(-50%);z-index:4;pointer-events:none;
  background:rgba(20,21,24,.92);border:1px solid #3a352a;border-left:3px solid #c9a55a;border-radius:8px;
  padding:8px 14px;max-width:90%;opacity:0;transition:opacity .25s}
.viv-flashdir.show{opacity:1}
.viv:fullscreen .viv-flashdir{top:56px}
.viv:fullscreen{border:none;border-radius:0;background:#000}
.viv:fullscreen.large .viv-bar,.viv:fullscreen.large .viv-bar2,.viv:fullscreen.large .viv-cap{display:none}
.viv:fullscreen.large .viv-large{background:#000}
.viv:fullscreen.large .viv-stage{top:0}
.viv:fullscreen.large .viv-osd{display:block}
.viv:fullscreen.large .viv-nav{opacity:0;top:50%}
.viv:fullscreen.large .viv-nav:hover{opacity:.8}
.viv:fullscreen.idle,.viv:fullscreen.idle *{cursor:none!important}
.viv-empty{position:absolute;inset:0;display:none;align-items:center;justify-content:center;
  color:#6f747d;text-align:center;padding:24px;pointer-events:none;white-space:pre-line;line-height:1.6}
.viv.empty .viv-empty{display:flex}
.viv-a{display:none}
.viv.cmp .viv-a{display:flex;right:calc(50% + 1px)}
.viv.cmp .viv-stage.b{left:calc(50% + 1px)}
.viv.cmp.wipe .viv-stage.b{left:0}
.viv.cmp.wipe .viv-a{right:0;left:0;z-index:1;pointer-events:none;
  clip-path:inset(0 calc(100% - var(--wipe,50%)) 0 0)}
.viv-wipe{display:none;position:absolute;top:32px;bottom:0;left:var(--wipe,50%);width:0;z-index:3;
  border-left:2px solid #f3d48f;box-shadow:0 0 6px #000}
.viv.cmp.wipe .viv-wipe{display:block}
.viv:fullscreen .viv-wipe{top:0}
.viv-wipe i{position:absolute;top:50%;left:-15px;width:28px;height:28px;margin-top:-14px;border-radius:50%;
  background:#1b1c20;border:2px solid #f3d48f;cursor:ew-resize;pointer-events:auto;
  display:flex;align-items:center;justify-content:center;color:#f3d48f;font:700 11px system-ui;font-style:normal}
.viv-tag{display:none;position:absolute;bottom:12px;z-index:4;max-width:calc(50% - 30px);pointer-events:none;
  background:rgba(16,17,19,.9);border:1px solid #3a3e46;border-radius:999px;padding:3px 10px 3px 4px;
  font:500 11px system-ui,sans-serif;color:#cfd2d8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.viv-tag b{display:inline-block;min-width:18px;text-align:center;margin-right:6px;border-radius:999px;
  background:#c9a55a;color:#16171a;font:800 10px system-ui;padding:1px 5px}
.viv-tag.b b{background:#5fc08a}
.viv.cmp .viv-tag{display:block}
.viv-tag.a{left:10px}
.viv-tag.b{left:calc(50% + 11px)}
.viv.cmp.wipe .viv-tag.b{left:auto;right:10px}
.viv-cbar{display:none;position:absolute;top:42px;left:50%;transform:translateX(-50%);z-index:5;
  align-items:center;gap:4px;padding:4px;border-radius:999px;background:rgba(16,17,19,.92);
  border:1px solid #3a352a;box-shadow:0 4px 14px #0009;transition:opacity .4s;white-space:nowrap}
.viv.cmp .viv-cbar{display:flex}
.viv.cmp .viv-hint{display:none}
.viv-cbar.dim{opacity:.18}
.viv-cbar:hover{opacity:1}
.viv:fullscreen .viv-cbar{top:12px}
.viv-cbar button{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 10px 0 5px;
  border-radius:999px;border:1px solid transparent;background:none;color:#c9cdd4;cursor:pointer;
  font:600 11px system-ui,sans-serif}
.viv-cbar button:hover{background:#25262b;border-color:#3a3e46;color:#fff}
.viv-cbar button.on{color:#f3d48f}
.viv-cbar kbd{display:inline-block;min-width:18px;text-align:center;padding:1px 5px;border:1px solid #4a4d55;
  border-bottom-width:2px;border-radius:5px;background:#0f1012;font:700 10.5px ui-monospace,Consolas,monospace;color:#f3d48f}
.viv-q{width:22px;height:22px;padding:0;border-radius:999px;font:700 12px system-ui,sans-serif;
  background:#14161a;border:1px solid #3a3e46;color:#aeb3bc;cursor:pointer;flex:0 0 auto}
.viv-q:hover,.viv-q.on{border-color:#d9b26a;color:#f0d9a8;background:#1c1912}
.viv-help{position:absolute;inset:0;z-index:6;display:none;background:rgba(10,11,12,.86);
  backdrop-filter:blur(2px);overflow:auto;padding:18px}
.viv.help .viv-help{display:block}
.viv-help-box{max-width:720px;margin:0 auto;background:#16171a;border:1px solid #33363d;
  border-top:3px solid #c9a55a;border-radius:8px;padding:16px 20px 14px;box-shadow:0 10px 30px #000a;
  font:12px/1.55 system-ui,"Segoe UI",sans-serif;color:#cfd2d8}
.viv-help-box h3{margin:0 0 4px;font-size:14px;color:#fff;letter-spacing:.4px}
.viv-help-box .sub{color:#8b909a;margin:0 0 10px}
.viv-help-cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:4px 26px}
.viv-help-box h5{margin:12px 0 4px;font:700 10px system-ui,sans-serif;color:#e4c27a;
  letter-spacing:1px;text-transform:uppercase}
.viv-help-box table{border-collapse:collapse;width:100%}
.viv-help-box td{padding:3px 0;vertical-align:top}
.viv-help-box td:first-child{white-space:nowrap;padding-right:12px;width:1%}
.viv-help-box kbd{display:inline-block;min-width:18px;text-align:center;padding:1px 6px;margin:0 2px 0 0;
  border:1px solid #3d4048;border-bottom-width:2px;border-radius:5px;background:#0f1012;
  font:600 11px ui-monospace,Consolas,monospace;color:#e6e8ec}
.viv-help-box .foot{margin-top:12px;color:#7d828b;display:flex;justify-content:space-between;gap:12px}
.viv-hint{position:absolute;left:50%;bottom:10px;transform:translateX(-50%);z-index:3;
  display:none;align-items:center;gap:10px;white-space:nowrap;max-width:94%;overflow:hidden;
  background:rgba(22,23,26,.95);border:1px solid #3a352a;border-radius:999px;padding:5px 8px 5px 14px;
  font:11px system-ui,sans-serif;color:#b9bdc5;box-shadow:0 4px 14px #0008}
.viv-hint.show{display:flex}
.viv-hint kbd{border:1px solid #3d4048;border-radius:4px;padding:0 5px;background:#0f1012;
  font:600 10.5px ui-monospace,Consolas,monospace;color:#e6e8ec}
.viv-hint button{border:none;background:none;color:#7d828b;cursor:pointer;font-size:14px;padding:0 4px}
.viv-hint button:hover{color:#fff}
.viv-cell .pk{position:absolute;top:5px;right:5px;width:24px;height:24px;border-radius:50%;
  display:flex;align-items:center;justify-content:center;font:15px/1 system-ui,sans-serif;font-style:normal;
  color:#f3d48f;background:rgba(14,15,17,.8);border:1px solid #5a4c2c;opacity:0;cursor:pointer;
  transition:opacity .1s linear}
.viv-cell:hover .pk{opacity:.6}
.viv-cell .pk:hover{opacity:1;border-color:#f3d48f}
.viv-cell.picked .pk{opacity:1;background:#d9b26a;color:#1a1408;border-color:#f6e2b0;box-shadow:0 1px 6px #000a}
.viv-cell.picked span{color:#f3d48f}
/* selecting several: a box at the top left of each thumbnail */
.viv-grid{user-select:none}
.viv-cell .ck{position:absolute;top:5px;left:5px;width:22px;height:22px;border-radius:5px;
  display:flex;align-items:center;justify-content:center;font:700 13px/1 system-ui,sans-serif;font-style:normal;
  color:transparent;background:rgba(14,15,17,.75);border:1.5px solid #6d7380;opacity:0;cursor:pointer;
  transition:opacity .1s linear;z-index:1}
.viv-cell:hover .ck{opacity:.75}
.viv-cell .ck:hover{opacity:1;border-color:#9ec3ff}
.viv.selecting .viv-cell .ck{opacity:.85}
.viv-cell.sel{outline:3px solid #5b9bff}
.viv-cell.sel .ck{opacity:1;background:#3d7fe6;border-color:#a9cbff;color:#fff}
.viv-cell.sel img{filter:brightness(.82)}
.viv-cell.fresh.sel::after,.viv.selecting .viv-cell.fresh::after{left:32px}
.viv-filter{flex:0 1 210px;min-width:90px;height:24px;padding:0 9px;border-radius:999px;
  border:1px solid #33363d;background:#0f1012;color:#e6e8ec;font:12px/22px ui-monospace,Consolas,monospace;outline:none;box-sizing:border-box}
.viv-filter::placeholder{font:11px system-ui,sans-serif;color:#6d727b}
.viv-filter:focus{border-color:#7f9cc9}
.viv-flab{flex:0 0 auto;margin:0 -2px 0 4px;font:700 10px ui-monospace,Consolas,monospace;letter-spacing:.1em;
  text-transform:uppercase;color:#8b909a;cursor:text;user-select:none}
.viv-filter.on{border-color:#7f9cc9;background:#18202d;color:#d4e2fa}
.viv-filter.bad{border-color:#c86a5d}
.viv-diff{display:none;position:absolute;left:50%;bottom:44px;transform:translateX(-50%);z-index:5;
  max-width:92%;padding:7px 16px 9px;border-radius:12px;background:rgba(14,15,17,.95);border:1px solid #5a4d2e;
  box-shadow:0 6px 20px #000c;font:13px/1.65 system-ui,sans-serif;color:#e2e4e8;text-align:center;pointer-events:none}
.viv-diff .hd{font:700 10px/1.4 ui-monospace,Consolas,monospace;letter-spacing:.12em;text-transform:uppercase;
  color:#c9a55a;margin-bottom:3px}
.viv.cmp .viv-diff.has{display:block}
.viv.idle .viv-diff{opacity:0;transition:opacity .4s}
.viv-diff .k{color:#a9aeb7;margin-right:5px}
.viv-diff .a{color:#e4c27a}
.viv-diff .b{color:#7fd6a4}
.viv-diff .ar{color:#5d616a;margin:0 4px}
.viv-diff .it{display:inline-block;margin:0 10px;white-space:nowrap;font-weight:600}
.viv-diff .same{color:#a9aeb7}
.viv-hov{position:fixed;z-index:70;max-width:340px;min-width:220px;padding:9px 11px;border-radius:9px;
  background:#111215f2;border:1px solid #3a3d45;box-shadow:0 8px 24px #000c;pointer-events:none;
  font:11px/1.45 system-ui,"Segoe UI",sans-serif;color:#cfd2d8;display:none}
.viv-hov.show{display:block}
.viv-hov .nm{font:600 11px ui-monospace,Consolas,monospace;color:#f3dcaa;word-break:break-all;margin-bottom:6px}
.viv-hov h6{margin:7px 0 3px;font:700 9px system-ui,sans-serif;letter-spacing:1px;color:#c9a55a;text-transform:uppercase}
.viv-hov .tw{color:#b9bec7;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}
.viv-hov table{border-collapse:collapse;width:100%}
.viv-hov td{padding:1px 0;vertical-align:top}
/* a line above every heading, so the card reads in parts */
.viv-hov h6{border-top:1px solid #3a3e46;padding-top:7px}
.viv-hov tr.node td{border-top:1px solid #2e3138;padding-top:5px}
.viv-hov td+td{text-align:right;font:600 11px ui-monospace,Consolas,monospace;color:#e6e8ec;padding-left:12px}
.viv-hov .dim{color:#7d828b}
.viv-marq.sub{border-color:#e07a6a;background:rgba(224,122,106,.14)}
.viv-marq{position:absolute;border:1px solid #7fb0ff;background:rgba(91,155,255,.16);
  pointer-events:none;z-index:4;border-radius:2px}
/* The bar for a selection floats over the top of the grid instead of
   sitting above it: in the column it pushed every picture down when the
   first was selected and pulled them back up when the last was let go.
   The top, since sorted by newest the work is up there. */
.viv-selbar{display:none;align-items:center;gap:6px;padding:6px 8px 6px 14px;border-radius:999px;
  position:absolute;left:50%;top:6px;transform:translateX(-50%);z-index:6;max-width:94%;white-space:nowrap;
  background:#152238;border:1px solid #34507a;color:#b9d2f5;font:11px system-ui,sans-serif;box-shadow:0 6px 20px #000c}
.viv.selecting:not(.large) .viv-selbar{display:flex}
.viv-selbar .lab{overflow:hidden;text-overflow:ellipsis;min-width:0;margin-right:6px}
.viv-selbar .lab b{color:#e2edff;font-size:12px}
.viv-selbar .sp{flex:1}
.viv-selbar .viv-btn.del{border-color:#c86a5d;color:#ffd0c8;background:#3a1d18}
.viv-selbar .viv-btn.gold{border-color:#d9b26a;color:#f3dcaa}
.viv-btn.picks.on{border-color:#d9b26a;color:#1a1408;background:#d9b26a}
.viv-btn.seq{font-family:ui-monospace,Consolas,monospace;letter-spacing:.02em}
.viv-btn.seq.on{border-color:#7fb08d;color:#bfe6c8;background:#16241a}
.viv-btn.picks b{font-weight:700;opacity:.75}
.viv-btn.trash{border-color:#5a3a35;color:#e0a69c}
.viv-btn.trash:hover{border-color:#c86a5d;color:#ffd0c8;background:#2a1714}
.viv-btn.trash.on{border-color:#c86a5d;color:#ffe2dc;background:#4a1f1a}
.viv-binbar{display:none;align-items:center;gap:6px;padding:6px 10px;margin:0 8px 7px;border-radius:8px;
  background:#2a1714;border:1px solid #5a3a35;color:#e0a69c;font:11px system-ui,sans-serif}
.viv.bin .viv-binbar{display:flex}
.viv-binbar .lab b{color:#ffd0c8;letter-spacing:.8px;text-transform:uppercase;font-size:10px}
.viv-binbar .sp{flex:1}
.viv-binbar .viv-btn.go{border-color:#c86a5d;color:#ffd0c8;background:#3a1d18}
.viv.bin .viv-grid{background:#160f0e}
.viv.bin .viv-capk,.viv.bin .viv-btn.picks,.viv.bin .viv-btn.copyp,.viv.bin .viv-btn.idea{display:none!important}
.viv-capdel.purge{display:none}
.viv.bin .viv-capdel.purge{display:inline-block}
.viv.bin .viv-capdel:not(.purge){margin-left:6px}
.viv.bin .viv-capdel:not(.purge){border-color:#3e5a46;color:#9ad8b6;background:#101713}
.viv.bin .viv-capdel:not(.purge):hover{border-color:#48a882;color:#c8f5dc;background:#13261d}
.viv-capk{flex:0 0 auto;width:24px;height:24px;border-radius:50%;padding:0;cursor:pointer;
  border:1px solid #3a3e46;background:#101113;color:#6f747d;font:15px/1 system-ui,sans-serif}
.viv-capk:hover{border-color:#d9b26a;color:#f3d48f}
.viv-capk.on{background:#d9b26a;border-color:#f6e2b0;color:#1a1408}
.viv-capdel{flex:0 0 auto;margin-left:auto;height:20px;padding:0 9px;border-radius:999px;cursor:pointer;
  border:1px solid #4a3330;background:#151012;color:#c98c82;font:700 9.5px system-ui,sans-serif;
  letter-spacing:.7px;text-transform:uppercase}
.viv-capdel:hover{border-color:#c86a5d;color:#ffd0c8;background:#2a1714}
.viv-osd .pkd{color:#f3d48f}
.viv-toast{position:absolute;left:50%;bottom:16px;transform:translateX(-50%);z-index:5;display:none;
  align-items:center;gap:12px;max-width:92%;padding:6px 6px 6px 14px;border-radius:999px;
  background:rgba(22,23,26,.96);border:1px solid #3a3e46;box-shadow:0 6px 18px #000a;
  font:12px system-ui,sans-serif;color:#d9dce2;white-space:nowrap}
.viv-toast.show{display:flex}
.viv-hint.show~.viv-toast{bottom:54px}
.viv-fskeys{position:absolute;left:50%;bottom:22px;transform:translateX(-50%);z-index:4;display:none;
  align-items:center;justify-content:center;flex-wrap:wrap;gap:6px 14px;width:max-content;max-width:94%;
  pointer-events:none;background:rgba(14,15,17,.86);border:1px solid #3a352a;border-radius:16px;padding:7px 16px;
  font:12px system-ui,sans-serif;color:#c9cdd4;box-shadow:0 6px 18px #000a;opacity:0;transition:opacity .5s}
.viv:fullscreen .viv-fskeys{display:flex}
.viv:fullscreen .viv-hint{display:none}
.viv-fskeys.show{opacity:1}
.viv-fskeys span{white-space:nowrap}
.viv-fskeys kbd{border:1px solid #4a4d55;border-bottom-width:2px;border-radius:4px;padding:0 5px;margin-right:3px;
  background:#0f1012;font:600 10.5px ui-monospace,Consolas,monospace;color:#f3d48f}
.viv-toast span{overflow:hidden;text-overflow:ellipsis;min-width:0}
.viv-toast button{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 6px 0 10px;
  border-radius:999px;border:1px solid #d9b26a;background:#2a2416;color:#f3dcaa;cursor:pointer;
  font:700 11px system-ui,sans-serif}
.viv-toast button:hover{background:#3a3220}
.viv-toast kbd{border:1px solid #5a4c2c;border-radius:4px;padding:0 4px;font:600 10px ui-monospace,Consolas,monospace;
  color:#f3dcaa;background:#1a1610}
.viv-ask{position:absolute;inset:0;z-index:7;display:none;align-items:center;justify-content:center;
  background:rgba(10,11,12,.8);backdrop-filter:blur(2px);padding:18px}
.viv.ask .viv-ask{display:flex}
.viv-ask-box{max-width:440px;background:#16171a;border:1px solid #33363d;border-top:3px solid #c86a5d;
  border-radius:8px;padding:16px 18px 14px;box-shadow:0 10px 30px #000a;font:12px/1.55 system-ui,sans-serif;color:#cfd2d8}
.viv-ask-box h3{margin:0 0 6px;font-size:14px;color:#fff}
.viv-ask-box p{margin:0 0 12px;color:#9aa0a8}
.viv-ask-box .row{display:flex;justify-content:flex-end;gap:8px}
.viv-ask-box .viv-btn.go{border-color:#c86a5d;color:#ffd0c8;background:#3a1d18}
.viv-ask-box.copy{border-top-color:#d9b26a;max-width:520px;width:100%}
.viv-ask-box .viv-btn.go.gold{border-color:#d9b26a;color:#1a1408;background:#d9b26a}
.viv-cp-row{display:flex;align-items:center;gap:6px;margin:0 0 8px}
.viv-cp-row select,.viv-cp-row input{height:26px;border-radius:6px;border:1px solid #3a3e46;background:#0f1012;
  color:#e6e8ec;font:12px ui-monospace,Consolas,monospace;padding:0 8px;outline:none}
.viv-cp-row select{flex:0 0 auto;max-width:42%}
.viv-cp-row input{flex:1 1 auto;min-width:60px}
.viv-cp-row input:focus,.viv-cp-row select:focus{border-color:#d9b26a}
.viv-cp-to{font:11px ui-monospace,Consolas,monospace;color:#f3d48f;word-break:break-all;margin:0 0 10px;
  padding:6px 8px;background:#0f1012;border:1px solid #2b2d33;border-radius:6px}
.viv-cp-rec{display:flex;flex-wrap:wrap;gap:4px;margin:0 0 10px}
.viv-cp-rec button{height:20px;padding:0 9px;border-radius:999px;cursor:pointer;border:1px solid #3a3e46;
  background:#14161a;color:#aeb3bc;font:600 10.5px system-ui,sans-serif;max-width:220px;overflow:hidden;
  text-overflow:ellipsis;white-space:nowrap}
.viv-cp-rec button:hover{border-color:#d9b26a;color:#f0d9a8}
.viv-cp-lab{font:700 9.5px system-ui,sans-serif;color:#7d828b;letter-spacing:.7px;text-transform:uppercase;margin:0 0 4px}
.viv-cp-row .viv-seg .viv-btn.on{background:#2a2416}
.viv-btn.copyp{border-color:#6b5a33;color:#f0d9a8}
/* to the Idea Box's My works: silver, as My works is there */
.viv-btn.idea{border-color:#5d636c;color:#d9dee6}
.viv-btn.idea:hover{border-color:#c9cfd8;color:#f3f5f8;background:#1b1e22}
/* back to the Series Lab's queue: orange, as the Lab is */
.viv-btn.lab{border-color:#7a4a2c;color:#e9b48c}
.viv-btn.lab:hover{border-color:#d9783c;color:#ffd9bd;background:#2a1a10}
.viv.bin .viv-btn.lab{display:none!important}
.viv-meta{position:absolute;top:32px;right:0;bottom:0;width:min(400px,46%);z-index:3;display:none;
  flex-direction:column;background:rgba(18,19,22,.97);border-left:1px solid #2b2d33;
  font:12px/1.5 system-ui,"Segoe UI",sans-serif;color:#cfd2d8;user-select:text}
.viv.meta.large .viv-meta{display:flex}
.viv.meta:not(.cmp) .viv-stage.b{right:min(400px,46%)}
.viv.meta .viv-next{right:calc(min(400px,46%) + 6px)}
.viv:fullscreen .viv-meta{top:0}
.viv-meta-head{display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid #26282d;flex:0 0 auto}
.viv-meta-head b{font-size:12.5px;color:#f3d48f;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.viv-meta-head i{font-style:normal;color:#8b909a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.viv-meta-head .x{margin-left:auto;flex:0 0 auto;border:none;background:none;color:#7d828b;cursor:pointer;font-size:16px;padding:0 2px}
.viv-meta-head .x:hover{color:#fff}
.viv-meta-body{flex:1 1 auto;overflow:auto;padding:10px 12px 14px}
.viv-meta h6{margin:12px 0 5px;font:700 9.5px system-ui,sans-serif;letter-spacing:.9px;text-transform:uppercase;
  color:#e4c27a;display:flex;align-items:center;gap:8px}
.viv-meta h6:first-child{margin-top:0}
.viv-fdrag{position:fixed;z-index:10000;pointer-events:none;display:flex;flex-direction:column;gap:2px;
  padding:6px 11px;border-radius:7px;background:#1c1912;border:1px solid #d9b26a;color:#f3dcaa;
  font:700 11.5px system-ui,"Segoe UI",sans-serif;white-space:nowrap;box-shadow:0 6px 18px #000b}
.viv-fdrag.copy{border-color:#5fc08a;color:#c9f2d9;background:#15281e}
.viv-fdrag.none{border-color:#4a4d55;color:#cfd2d8;background:#1a1b1e}
.viv-fdrag em{font-style:normal;font-weight:500;font-size:10.5px;color:#8b909a}
.viv-fdrag em b{color:#5fc08a}
.viv.fdragging .viv-cell.fsrc{opacity:.45}
.viv-dropzone{position:absolute;left:4px;right:4px;pointer-events:none;z-index:3;border:2px dashed #d9b26a;
  border-radius:8px;background:rgba(217,178,106,.07)}
.viv.fdragging .viv-group,.viv.fdragging .viv-tile{outline:1px dashed #5d616a;outline-offset:-1px}
.viv .viv-group.drop,.viv .viv-tile.drop{background:#2a2416;border-color:#d9b26a;border-left-color:#f3d48f;
  outline:2px solid #d9b26a;outline-offset:-1px}
.viv-meta .two{display:grid;grid-template-columns:1fr 1fr;gap:0 16px}
.viv-meta .two.one{grid-template-columns:1fr}
.viv-meta .two .col{min-width:0}
.viv-meta .two:first-child .col h6{margin-top:0}
.viv-meta .two:not(.one) td:first-child{white-space:normal;word-break:break-word;width:auto}
.viv-meta .two:not(.one) td:last-child{text-align:right;word-break:break-word;padding-left:6px}
.viv-meta h6.rule{border-top:1px solid #2e3036;padding-top:12px;margin-top:14px}
.viv-meta h6 .cp{margin-left:auto}
.viv-meta h6 .cp+.cp{margin-left:6px}
.viv-meta h6 .cp.use{background:#3a3120;border-color:#c9a453;color:#f3dcaa}
.viv-meta h6 .cp.use+.cp{margin-left:6px}
.viv-meta .cp{height:20px;padding:0 9px;border-radius:999px;cursor:pointer;border:1px solid #6b5a33;
  background:#1c1912;color:#f0d9a8;font:700 9.5px system-ui,sans-serif;letter-spacing:.6px;text-transform:uppercase}
.viv-meta .cp:hover{background:#2a2416;border-color:#d9b26a}
.viv-meta .cp.done{border-color:#5fc08a;color:#c9f2d9;background:#15281e}
.viv-meta pre{margin:0;white-space:pre-wrap;word-break:break-word;font:12.5px/1.55 system-ui,"Segoe UI",sans-serif;
  color:#e2e4e8;background:#0f1012;border:1px solid #26282d;border-radius:6px;padding:9px 10px}
.viv-meta .sec{border:1px solid #26282d;border-left:3px solid #4a4d55;border-radius:6px;padding:6px 9px 7px;
  margin:0 0 6px;background:#141518}
.viv-meta .sec.sw{border-left-color:#d9b26a;background:#1c1a14}
.viv-meta .sec .k{display:flex;align-items:center;gap:7px;margin-bottom:2px}
.viv-meta .sec .k em{font:700 9.5px system-ui,sans-serif;font-style:normal;letter-spacing:.7px;
  text-transform:uppercase;color:#9aa0a9}
.viv-meta .sec .k .cno{flex:0 0 auto;font:700 10px system-ui,sans-serif;font-variant-numeric:tabular-nums;
  padding:1px 7px;border-radius:999px;color:#111;background:var(--k,#9aa0a9)}
.viv-meta .sec .k .cno{cursor:pointer;transition:box-shadow .12s,transform .12s}
.viv-meta .sec .k .cno:hover{box-shadow:0 0 0 2px #0f1012,0 0 0 3px var(--k,#9aa0a9)}
.viv-meta .sec .k .cno.sent{transform:scale(1.15)}
.viv-meta .sec .k span{font-weight:600;color:#d9dce2;font-size:11.5px;min-width:0;overflow:hidden;
  text-overflow:ellipsis;white-space:nowrap}
.viv-meta .sec .k s{text-decoration:none;font:700 8.5px system-ui;letter-spacing:.6px;color:#1a1408;
  background:#d9b26a;border-radius:999px;padding:1px 6px;text-transform:uppercase;flex:0 0 auto}
.viv-meta .sec .k .cp{margin-left:auto;height:18px;padding:0 7px;font-size:9px;flex:0 0 auto}
.viv-meta .sec .k .cp.keep+.cp{margin-left:4px}
.viv-meta .sec .k .cp.keep{border-color:#3f6a58;color:#a8dcc4;background:#122019}
.viv-meta .sec .k .cp.keep:hover{border-color:#5fc08a;background:#16291f}
.viv-meta .sec .k .cp.keep.kept{border-color:#6b5a33;color:#e0b85a;background:#1b1912}
.viv-meta .sec .k .cp.keep.kept:hover{border-color:#e0b85a;color:#f3dcaa;background:#2a2316}
.viv-meta .sec .k .cp.keep.done{border-color:#5fc08a;color:#c9f2d9;background:#15281e}
.viv-meta .sec p{margin:0;color:#c9cdd4}
.viv-meta table{border-collapse:collapse;width:100%}
.viv-meta td{padding:2px 0;vertical-align:top}
.viv-meta td:first-child{color:#8b909a;padding-right:12px;white-space:nowrap;width:1%}
.viv-meta td:last-child{color:#e2e4e8;font-family:ui-monospace,Consolas,monospace;font-size:11.5px;word-break:break-all}
.viv-meta tr.eh td{color:#d9dce2;font-weight:600}
.viv-meta tr.eh td:last-child{font-family:inherit;font-size:11px;color:#9fc79a}
.viv-meta .note{margin-top:12px;color:#6f747d;font-size:11px}
.viv-meta .wf{display:flex;align-items:center;gap:8px;margin:12px 0 0;padding:8px 10px;border-radius:6px;
  background:#141518;border:1px solid #26282d;color:#9aa0a8;font-size:11px}
.viv-meta .wf .cp{margin-left:auto;flex:0 0 auto}
.viv-meta .none{color:#8b909a;padding:20px 4px;text-align:center;line-height:1.6}
.viv-capmeta{flex:0 0 auto;height:20px;padding:0 9px;border-radius:999px;cursor:pointer;border:1px solid #3a3e46;
  background:#14161a;color:#aeb3bc;font:700 9.5px system-ui,sans-serif;letter-spacing:.7px;text-transform:uppercase}
.viv-capmeta:hover{border-color:#d9b26a;color:#f0d9a8}
.viv-capmeta.on{border-color:#d9b26a;color:#1a1408;background:#d9b26a}
.viv-hist{display:none;position:absolute;left:12px;bottom:12px;z-index:6;width:276px;box-sizing:border-box;padding:8px 10px 7px;border-radius:10px;
  background:rgba(14,15,17,.9);border:1px solid #3a3e46;box-shadow:0 4px 16px #000b;pointer-events:auto;cursor:default}
.viv-hist .ks{display:none;position:absolute;left:10px;right:10px;top:8px;padding:6px 8px;border-radius:7px;gap:10px;flex-wrap:wrap;
  background:rgba(14,15,17,.92);border:1px solid #2c2f35;font:10.5px system-ui,sans-serif;color:#a9aeb7;pointer-events:none}
.viv-hist:hover .ks{display:flex}
.viv-hist .ks kbd{display:inline-block;min-width:14px;padding:0 4px;margin-right:4px;border-radius:4px;border:1px solid #4a4e57;
  background:#1d1f23;color:#e6e8ec;font:700 10px ui-monospace,Consolas,monospace;text-align:center}
.viv.large.hist .viv-hist{display:block}
.viv-hist.a{display:none!important}
.viv.large.hist.cmp:not(.wipe) .viv-hist.a{display:block!important}
.viv.cmp:not(.wipe) .viv-hist.b{left:calc(50% + 13px)}
.viv.cmp .viv-hist{bottom:34px}
.viv-hist .who{position:absolute;right:10px;top:7px;font:700 10px ui-monospace,Consolas,monospace;color:#e4c27a;letter-spacing:.08em}
.viv.idle .viv-hist{opacity:.55;transition:opacity .4s}
.viv-hist canvas{display:block;width:100%;height:auto}
/* the navigator: the whole picture small, the part on screen boxed - drag
   the box, or click anywhere on it, to move the large view there */
.viv-navi{display:none;position:absolute;right:12px;bottom:12px;z-index:7;padding:7px;border-radius:10px;
  background:rgba(14,15,17,.9);border:1px solid #3a3e46;box-shadow:0 4px 16px #000b;cursor:default}
.viv-navi.show{display:block}
.viv.cmp .viv-navi{bottom:34px}
.viv.idle .viv-navi{opacity:.6;transition:opacity .4s}
.viv-navi .pic{position:relative;cursor:crosshair;line-height:0}
.viv-navi img{display:block;max-width:190px;max-height:140px;border-radius:3px;user-select:none;pointer-events:none}
.viv-navi .r{position:absolute;box-sizing:border-box;border:1.5px solid #e8c766;cursor:move;
  box-shadow:0 0 0 1px rgba(0,0,0,.55), 0 0 0 9999px rgba(0,0,0,.28)}
.viv-navi .pic{overflow:hidden;border-radius:3px}
.viv-navi .x{position:absolute;right:-6px;top:-8px;width:18px;height:18px;border-radius:50%;border:1px solid #4a4e57;
  background:#1d1f23;color:#cfd3da;font:12px/16px system-ui,sans-serif;text-align:center;cursor:pointer;padding:0}
.viv-navi .x:hover{color:#fff;border-color:#e8c766}
.viv-hist .rs{position:absolute;right:-6px;top:-6px;width:18px;height:18px;border-radius:50%;cursor:nesw-resize;
  pointer-events:auto;background:#1b1c1f;border:1px solid #5a4d2e;color:#c9a55a;font:10px/16px system-ui;text-align:center}
.viv-hist .rs:hover{background:#2b2416;color:#f0cf86}
.viv-hist .hl{display:flex;justify-content:space-between;margin-top:5px;font:600 10.5px ui-monospace,Consolas,monospace;color:#a9aeb7}
.viv-hist .hl b{font-weight:700}
.viv-hist .hl .hi b{color:#ff6b5e}
.viv-hist .hl .lo b{color:#6aa8ff}
.viv-hist .hl .ok b{color:#7fd6a4}
.viv-guides{display:none;position:absolute;z-index:4;pointer-events:none;overflow:hidden}
.viv.large.guides .viv-guides{display:block}
.viv-guides svg{position:absolute;overflow:visible}
.viv-caprot{flex:0 0 auto;width:24px;height:24px;border-radius:50%;padding:0;cursor:pointer;
  border:1px solid #3a3e46;background:#101113;color:#aeb3bc;font:14px/1 system-ui,sans-serif}
.viv-caprot:hover{border-color:#d9b26a;color:#f3d48f}
.viv-caprot.on{border-color:#d9b26a;color:#f3d48f}
`;

function injectCSS() {
  if (document.getElementById("leiel-image-viewer-css")) return;
  const s = document.createElement("style");
  s.id = "leiel-image-viewer-css";
  s.textContent = CSS;
  document.head.appendChild(s);
}

/* Where a finished save put its picture, read from what the node handed the
   browser. Visual Save Image says the folder outright; ComfyUI's own save
   gives a subfolder of the output folder, which the server reads relative to
   output - the same rule as a relative path typed into the viewer. Previews
   go to the temp folder and are not followed. */
function savedFrom(output) {
  if (!output) return null;
  const own = output.leielsave;
  if (Array.isArray(own) && own.length) {
    const last = own[own.length - 1];
    if (last && last.folder && last.filename) return { folder: last.folder, name: last.filename };
  }
  const imgs = output.images;
  if (Array.isArray(imgs) && imgs.length) {
    const last = imgs[imgs.length - 1];
    if (last && last.type === "output" && last.filename) {
      return { folder: last.subfolder || "", name: last.filename };
    }
  }
  return null;
}

function setDefaults(node) {
  node.properties = node.properties || {};
  const P = node.properties;
  if (P.viv_thumb === undefined) P.viv_thumb = THUMB_DEFAULT;
  if (P.viv_folder === undefined) P.viv_folder = lastFolder() || "";
  if (P.viv_sort === undefined) P.viv_sort = "name";
  if (P.viv_follow === undefined) P.viv_follow = false;
  if (P.viv_deep === undefined) P.viv_deep = false;
  if (!Array.isArray(P.viv_lists)) P.viv_lists = [];
  if (P.viv_picks === undefined) P.viv_picks = false;
  if (P.viv_meta === undefined) P.viv_meta = false;
  if (P.viv_hist === undefined) P.viv_hist = false;
  if (P.viv_clip === undefined) P.viv_clip = false;
  if (P.viv_guides === undefined) P.viv_guides = 0;
  if (P.viv_histW === undefined) P.viv_histW = 276;
}

/* A picture in a view of several folders at once - their paths joined by
   "|" - carries the name of the folder it came from after a "|":
   "S1E4 The Burning Rose Garden/01.png|2026-11-10". */
const plainName = (n) => { const s = String(n || ""); const k = s.lastIndexOf("|"); return k < 0 ? s : s.slice(0, k); };
const dayOf = (n) => { const s = String(n || ""); const k = s.lastIndexOf("|"); return k < 0 ? "" : s.slice(k + 1); };
const normFolder = (p) => String(p || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

// ---------------------------------------------------------------- viewer
function buildViewer(node) {
  injectCSS();
  /* Read through the node every time: loading a workflow may hand the node
     a new properties object after this has been built. */
  const P = new Proxy({}, {
    get: (_t, k) => (node.properties || {})[k],
    set: (_t, k, v) => { node.properties = node.properties || {}; node.properties[k] = v; return true; },
  });
  setDefaults(node);

  // ---- dom
  const root = el("div", "viv empty");
  // the series on show: the folder opened, when it is a series
  wearTone(root, () => openName());
  root.tabIndex = 0;

  const bar = el("div", "viv-bar");
  const pathBox = el("input", "viv-path");
  pathBox.type = "text";
  pathBox.spellcheck = false;
  pathBox.placeholder = "output folder - or type a folder, relative to output";
  pathBox.title = "The folder shown. Empty is ComfyUI's output folder; a relative path is read from there. Enter to open";
  const browseBtn = el("button", "viv-btn", "Browse");
  browseBtn.title = "Choose a folder";
  const deepBtn = el("button", "viv-btn", "All in one");
  deepBtn.title = "Off: each folder inside is its own group, and the large view steps through that folder only.\nOn: every picture in one grid, and the large view steps through them all";
  const followBtn = el("button", "viv-btn follow", "Follow");
  followBtn.title = "Show every picture a save node writes, as soon as it is saved";
  bar.append(pathBox, browseBtn, deepBtn, followBtn);

  const bar2 = el("div", "viv-bar2");
  const seg = el("span", "viv-seg");
  const byName = el("button", "viv-btn", "Name");
  byName.title = "In name order";
  const byNew = el("button", "viv-btn", "Newest");
  byNew.title = "Newest first - click again for oldest first";
  seg.append(byName, byNew);
  /* Only while images are wired in, so the viewer is saving: whether each
     name ends in a five digit counter. It stands for the node's
     sequence_number value, whose own row is hidden. */
  const seqBtn = el("button", "viv-btn seq", "# 00001");
  seqBtn.style.display = "none";
  const pickBtn = el("button", "viv-btn picks", "\u2605 Picks");
  pickBtn.title = "Show only the picks - the pictures marked with P  (Shift+P)";
  const copyBtn = el("button", "viv-btn copyp", "Copy picks");
  copyBtn.title = "Copy the picks of this folder into another one - a series folder in input, say";
  copyBtn.style.display = "none";
  const ideaBtn = el("button", "viv-btn idea", "→ Idea Box");
  ideaBtn.title = "Send to the Idea Box, into My works - the pictures selected, or the one shown large -\nwith the LoRAs and settings in its notes, to lay beside the references there";
  const labBtn = el("button", "viv-btn lab", "→ Lab");
  labBtn.title = "Send to the Series Lab's queue - the pictures selected, or the one shown large -\nas recipes made the way they were: the same prompt, LoRAs and settings. They wait on the bench";
  const trashBtn = el("button", "viv-btn trash", "");
  trashBtn.style.display = "none";
  const zoomOut = el("button", "viv-btn sq", "−");
  zoomOut.title = "Smaller thumbnails  (Ctrl + wheel)";
  const zoomIn = el("button", "viv-btn sq", "+");
  zoomIn.title = "Larger thumbnails  (Ctrl + wheel)";
  const listBtn = el("button", "viv-btn", "List");
  listBtn.title = "Show as a list - a small thumbnail and the file name, date and size.\nWith folders inside, each folder has its own List / Grid on its bar; this one switches them all";
  const modeBtn = el("button", "viv-btn sq", "⤢");
  modeBtn.title = "Grid / large  (Enter, Esc, \u2191)";
  const fsBtn = el("button", "viv-btn sq", "⛶");
  fsBtn.title = "Full screen  (F, \u2193 from the large view)";
  const info = el("div", "viv-info", "");
  const qBtn = el("button", "viv-q", "?");
  qBtn.title = "Keys and buttons  (?)";
  const filterBox = el("input", "viv-filter");
  filterBox.type = "text";
  filterBox.spellcheck = false;
  filterBox.placeholder = "LoRA, sampler, trigger, -skip";
  filterBox.title = "Show only the renders whose settings mention every word - a LoRA, a trigger word, a sampler, a word of the prompt or a folder. A word starting with - leaves those out. Enter to filter, Esc to clear";
  const filterLab = el("label", "viv-flab", "Filter");
  filterLab.addEventListener("click", () => filterBox.focus());
  bar2.append(seqBtn, seg, pickBtn, copyBtn, listBtn, zoomOut, zoomIn, modeBtn, fsBtn, ideaBtn, labBtn, trashBtn, filterLab, filterBox, info, qBtn);

  const body = el("div", "viv-body");
  const grid = el("div", "viv-grid");
  const large = el("div", "viv-large");
  const cap = el("div", "viv-cap");
  const capPos = el("span", "", "");
  const capName = el("span", "viv-name", "");
  const capDim = el("span", "viv-dim", "");
  const capZoom = el("span", "viv-dim", "");
  const capDir = el("span", "", "");
  capDir.style.cssText = "display:flex;min-width:0;flex:0 0 auto;max-width:68%;overflow:hidden";
  const capPick = el("button", "viv-capk", "\u2605");
  capPick.title = "Pick  (P)";
  const capDel = el("button", "viv-capdel", "Delete");
  capDel.title = "Delete - into the _deleted folder beside it, Ctrl+Z brings it back  (Delete)";
  const capPurge = el("button", "viv-capdel purge", "Delete forever");
  capPurge.title = "Out of the bin forever  (Shift+Delete)";
  const capRot = el("button", "viv-caprot", "\u21BB");
  capRot.title = "Turn the view a quarter round  (R, Shift+R the other way) - the file is not changed";
  const capMeta = el("button", "viv-capmeta", "Prompt");
  capMeta.title = "The prompt this picture was rendered with, read from the PNG  (I)";
  const capWf = el("button", "viv-capmeta", "Workflow");
  capWf.title = "Open the workflow this picture was made with, in a new tab  (O)";
  /* Looking at the picture as a picture: its histogram with the share of
     blown highlights and crushed shadows, those pixels painted over, and
     composition guides. Each only reads the picture - nothing is changed. */
  const capHist = el("button", "viv-capmeta", "Hist");
  capHist.title = "Histogram, with how much of the picture has blown highlights or crushed shadows  (H)";
  const capClip = el("button", "viv-capmeta", "Clip");
  capClip.title = "Paint blown highlights red and crushed shadows blue  (E)";
  const capGuide = el("button", "viv-capmeta", "Grid");
  capGuide.title = "Composition guides: thirds, centre, both  (G)";
  cap.append(capPick, capDir, capPos, capName, capDim, capZoom, capHist, capClip, capGuide, capMeta, capWf, capRot, capPurge, capDel);
  const histBox = el("div", "viv-hist b");
  const histCv = el("canvas");
  histCv.width = 512; histCv.height = 192;
  const histLine = el("div", "hl");
  /* dragged from its top right corner to make it larger or smaller - the
     size is kept with the workflow */
  const histRs = el("span", "rs", "\u2921");
  histRs.title = "Drag to make the histogram larger or smaller";
  const histKeys = el("div", "ks");
  histKeys.innerHTML = "<span><kbd>H</kbd>histogram</span><span><kbd>E</kbd>clipping</span>"
    + "<span><kbd>G</kbd>grid - thirds, centre, both, off</span>";
  histBox.append(histRs, histCv, histLine, histKeys);
  /* it sits over the picture: a click on it must not count as a click on
     the picture, which goes back to the grid */
  for (const ev of ["click", "dblclick", "pointerdown", "mousedown"]) {
    histBox.addEventListener(ev, (e) => { if (e.target !== histRs) e.stopPropagation(); });
  }
  const guideBox = el("div", "viv-guides");
  const guideBoxA = el("div", "viv-guides");
  /* the pinned picture's histogram while comparing side by side */
  const histBoxA = el("div", "viv-hist a");
  const histCvA = el("canvas");
  histCvA.width = 512; histCvA.height = 192;
  const histLineA = el("div", "hl");
  histBoxA.append(el("span", "who", "A"), histCvA, histLineA);
  for (const ev of ["click", "dblclick", "pointerdown", "mousedown"]) {
    histBoxA.addEventListener(ev, (e) => e.stopPropagation());
  }

  /* The bin: the pictures deleted in this folder - its own _deleted folder
     and those of the folders inside it, never anywhere else. */
  const binBar = el("div", "viv-binbar");
  const binLab = el("span", "lab", "");
  const binRestore = el("button", "viv-btn", "Restore all");
  binRestore.title = "Every picture in the bin back where it was deleted from";
  const binEmpty = el("button", "viv-btn go", "Empty bin");
  const binBack = el("button", "viv-btn", "Back  (Esc)");
  binBack.title = "Back to the folder";
  binBar.append(binLab, el("span", "sp", ""), binRestore, binEmpty, binBack);

  /* Several pictures at once: Ctrl+click, Shift+click or a drag across the
     grid selects them, and this bar acts on all of them together. */
  /* Hovering a thumbnail shows what made it - trigger words, LoRAs and
     settings, read from the PNG the way the Prompt panel reads them. */
  const hov = el("div", "viv-hov");
  document.body.append(hov);
  const selBar = el("div", "viv-selbar");
  const selLab = el("span", "lab", "");
  const selAll = el("button", "viv-btn", "All");
  selAll.title = "Select every picture on show  (Ctrl+A)";
  const selPick = el("button", "viv-btn gold", "\u2605 Pick");
  const selCopy = el("button", "viv-btn", "Copy / Move to\u2026");
  const selDel = el("button", "viv-btn del", "Delete");
  const selPurge = el("button", "viv-btn del", "Delete forever");
  const selClear = el("button", "viv-btn", "Clear  (Esc)");
  const selIdea = el("button", "viv-btn idea", "→ Idea Box");
  selIdea.title = "Send them to the Idea Box, into My works";
  const selLabQ = el("button", "viv-btn lab", "→ Lab");
  selLabQ.title = "Send them to the Series Lab's queue, as recipes made the way they were";
  selBar.append(selLab, el("span", "sp", ""), selAll, selPick, selCopy, selIdea, selLabQ, selDel, selPurge, selClear);
  const osd = el("div", "viv-osd", "");
  const dirToast = el("div", "viv-flashdir", "");
  const stage = el("div", "viv-stage b");
  const big = el("img");
  big.draggable = false;
  big.title = "Click: back to the grid   * : 100%   / : fit";
  stage.append(big);
  /* COMPARE: a second pane holding the picture pinned with C. Side by side
     or laid over with a wipe; either way it is zoomed and moved with the
     other, so the same hand or the same eye is under both. */
  const stageA = el("div", "viv-stage viv-a");
  const bigA = el("img");
  bigA.draggable = false;
  stageA.append(bigA);
  const wipe = el("div", "viv-wipe");
  const wipeKnob = el("i", "", "\u2194");
  wipe.append(wipeKnob);
  /* The compare keys, on screen while comparing: a feature nobody can see
     is a feature nobody uses. Fades after a moment, back on any movement. */
  const cbar = el("div", "viv-cbar");
  const cb = (k, label, title) => {
    const b = el("button");
    b.dataset.k = k;
    b.title = title;
    b.append(el("kbd", "", k), el("span", "", label));
    cbar.append(b);
    return b;
  };
  const cbW = cb("W", "overlay", "Side by side / laid over with a wipe line");
  const cbX = cb("X", "swap", "Swap A and B");
  const cbL = cb("L", "linked", "Zoom and move A and B together, or each on its own");
  cb("C", "close", "End the comparison  (Esc)");
  const tagA = el("div", "viv-tag a");
  const tagB = el("div", "viv-tag b");
  const prev = el("button", "viv-nav viv-prev", "‹");
  const next = el("button", "viv-nav viv-next", "›");
  /* In full screen the toolbar is gone, so on the way in the main keys show
     at the foot for a few seconds - every time, not only the first. */
  const fsKeys = el("div", "viv-fskeys");
  const metaBox = el("div", "viv-meta");
  const diffBox = el("div", "viv-diff");
  const navi = el("div", "viv-navi");
  const naviPic = el("div", "pic");
  const naviImg = el("img");
  naviImg.draggable = false;
  const naviR = el("div", "r");
  const naviX = el("button", "x", "\u00D7");
  naviX.title = "Hide the navigator - N brings it back";
  naviPic.append(naviImg, naviR);
  navi.append(naviPic, naviX);
  large.append(cap, stage, stageA, wipe, tagA, tagB, cbar, diffBox, osd, dirToast, fsKeys, metaBox, prev, next, guideBox, guideBoxA, histBoxA, histBox, navi);
  const empty = el("div", "viv-empty", "");
  /* The manual, on the node itself as on every node in the suite - inside
     the viewer rather than beside it, so it opens in full screen too. */
  const K = (...keys) => keys.map((k) => `<kbd>${k}</kbd>`).join("");
  const row = (keys, text) => `<tr><td>${keys}</td><td>${text}</td></tr>`;
  const help = el("div", "viv-help");
  help.innerHTML = `<div class="viv-help-box">
    <h3>Visual Image Viewer</h3>
    <p class="sub">The keys work while the pointer is over the viewer, or in full screen. With the viewer the one node selected, the arrows, PgUp / PgDn and P work from anywhere.</p>
    <div class="viv-help-cols"><div>
      <h5>Grid</h5><table>
        ${row(K("\u2190", "\u2192", "\u2191", "\u2193"), "move between thumbnails")}
        ${row(K("Enter") + " click", "open the picture large - Enter again for full screen")}
        ${row(K("PgDn") + K("PgUp"), "next / previous folder")}
        ${row(K("+") + K("\u2212") + " Ctrl+wheel", "thumbnail size")}
        ${row("click a folder band", "fold it away")}
      </table>
      <h5>Large view</h5><table>
        ${row(K("\u2190") + K("\u2192") + " wheel", "previous / next - stops at the ends")}
        ${row(K("Space") + K("]"), "next, round from the last to the first")}
        ${row(K("Shift+Space") + K("[") + K("Backspace"), "previous, round the other way - Backspace in the large view and full screen")}
        ${row(K("Home") + K("End"), "first / last")}
        ${row(K("Shift+\u2192") + K("Shift+\u2190"), "next / previous folder, as " + K("PgDn") + K("PgUp"))}
        ${row(K("\u2193"), "full screen")}
        ${row("click / Ctrl+click", "in full screen: zoom in where clicked / zoom out")}
        ${row(K("\u2191") + K("Esc"), "up a level: full screen \u2192 large \u2192 grid")}
      </table>
      <h5>Zoom</h5><table>
        ${row(K("*"), "100% - a pixel of the file to a pixel of the screen")}
        ${row(K("/"), "fit to the panel")}
        ${row(K("+") + K("\u2212") + " Ctrl+wheel", "zoom in / out")}
        ${row("drag", "look around a zoomed picture")}
        ${row(K("\u2191", "\u2193", "\u2190", "\u2192"), "scroll a zoomed picture that is larger than the panel")}
        ${row(K("F"), "full screen on / off")}
        ${row(K("R") + K("Shift+R"), "turn the view a quarter round - the file stays as it is")}
        ${row(K("I") + " Prompt", "the prompt it was rendered with, to read and copy")}
        ${row(K("N") + " Navigator", "zoomed past the view: the whole picture small, drag the box to move")}
        ${row(K("H") + " Histogram", "the picture's histogram, with how much is blown or crushed")}
        ${row(K("E") + " Clipping", "blown highlights painted red, crushed shadows blue")}
        ${row(K("G") + " Guides", "thirds, centre, both, off - round with each press")}
        ${row(K("Ctrl+C"), "copy the picture - to paste in Photoshop and the like")}
        ${row(K("Alt+C"), "copy the picture only - for a web page or a chat")}
        ${row(K("O"), "open the workflow it was made with")}
      </table>
    </div><div>
      <h5>Compare</h5><table>
        ${row(K("C"), "pin this picture as A; step to another to see them side by side - C again ends it")}
        ${row("", "comparing, the line at the bottom says what differs between A and B - LoRAs, settings, triggers")}
        ${row(K("\u2190") + K("\u2192") + K("Space") + K("Del"), "step, pick or delete the side under the pointer, A or B")}
        ${row(K("W"), "side by side / laid over with a wipe line to drag")}
        ${row(K("X"), "swap A and B")}
        ${row(K("L"), "linked: both zoom and move together; separate: the one under the pointer")}
      </table>
      <h5>Picks and deleting</h5><table>
        ${row(K("P") + " \u2605", "pick the picture you are on - again to unpick it")}
        ${row(K("Shift+P") + " Picks", "only the picks; again for everything")}
        ${row(K("Delete"), "delete it - it goes into a _deleted folder beside it")}
        ${row(K("Ctrl+Z"), "bring back what was deleted, undo a pick")}
        ${row("Copy picks", "copy the picks into one folder - a series folder in input")}
        ${row("→ Lab", "send the pictures selected - or the one shown large, or the one right-clicked - to the Series Lab's bench, each as a recipe made the way it was: prompt, LoRAs, settings")}
        ${row("→ Idea Box", "send the pictures selected - or the one shown large, or the one right-clicked - into the Idea Box's My works, with what made them in their notes")}
        ${row(K("Ctrl") + "+click  " + K("Shift") + "+click", "select several - Shift+click a box selects the run from the last one ticked; the blue bar acts on all of them")}
        ${row("drag on empty space", "select what the box touches - " + K("Shift") + " adds to it, " + K("Ctrl") + " (from anywhere) unselects")}
        ${row("drag a picture", "into another folder - " + K("Ctrl") + " at the drop copies")}
        ${row(K("Ctrl+A"), "select every picture on show")}
        ${row(K("Delete") + " " + K("P") + " " + K("Esc"), "with several selected: delete them, pick them, clear the selection")}
        ${row("Deleted", "the bin of this folder - the pictures deleted here")}
        ${row(K("Delete") + " in the bin", "restore it, back where it was deleted from")}
        ${row(K("Shift+Delete") + " in the bin", "delete it forever - to the Recycle Bin where there is one")}
        ${row("Restore all / Empty bin", "everything in the bin back, or all of it gone")}
        ${row(K("Esc") + " in the bin", "back to the folder")}
      </table>
      <h5>Folders</h5><table>
        ${row("Browse", "pick a folder - output, input, or one listed in allowed_folders.txt")}
        ${row("All in one", "one unbroken grid with a tile at each folder; the large view steps through them all")}
        ${row("List", "rows with a small thumbnail, the name, date, pixels and size - each folder's bar has its own List / Grid, remembered per folder")}
        ${row("Follow", "show each picture a save node writes, as it lands")}
        ${row("images in", "wire images and a filename_prefix in and the viewer saves each render itself - no save node needed; Follow comes on")}
        ${row("# 00001", "with images wired in: a five digit counter on the end of each name, or the name as given")}
        ${row("Name / Newest", "the order, within each folder")}
        ${row("Filter box", "only the renders whose settings mention every word - a LoRA, a trigger, a sampler; -word leaves out. Enter / Esc")}
      </table>
    </div></div>
    <div class="foot"><span>${K("?")} opens and closes this</span><span>${K("Esc")} or a click closes it</span></div>
  </div>`;
  fsKeys.innerHTML = [[K("\u2190") + K("\u2192"), "next"], [K("PgUp") + K("PgDn"), "folder"], [K("[") + K("]") + K("Space"), "loop"], [K("*") + K("/"), "100% / fit"],
    [K("P"), "pick"], [K("Del"), "delete"], [K("R"), "turn"], [K("C"), "compare"], [K("I"), "prompt"],
    [K("\u2191") + K("Esc"), "back"], [K("?"), "all keys"]]
    .map(([k, t]) => `<span>${k}${t}</span>`).join("");
  const hint = el("div", "viv-hint");
  hint.innerHTML = `<span>${K("?")} keys</span><span>${K("\u2191")}${K("\u2193")} levels</span>`
    + `<span>${K("PgUp")}${K("PgDn")} folders</span><span>${K("[")}${K("]")}${K("Space")} loops</span>`
    + `<span>${K("P")} pick</span><span>${K("Del")} delete</span>`;
  const hintX = el("button", "", "\u00D7");
  hintX.title = "Got it";
  hint.append(hintX);
  const toastBox = el("div", "viv-toast");
  body.append(grid, large, empty, hint, toastBox, selBar);
  const ask = el("div", "viv-ask");
  root.append(bar, bar2, binBar, body, help, ask);

  const domWidget = node.addDOMWidget("image_viewer", "LEIEL_IMAGE_VIEWER", root, {
    serialize: false,
    hideOnZoom: false,
    getMinHeight: () => 280,
  });

  // ---- state
  const S = {
    path: "",           // the folder as the server resolved it
    items: [],          // [{name, v, t, w, h}] in display order
    sig: "",
    cells: [],
    current: -1,
    fresh: "",          // name of the picture FOLLOW brought in last
    mode: "grid",
    actual: false,
    zoom: null,
    mouse: null,
    hovered: false,
    flashUntil: 0,
    scan: Promise.resolve(),
    largeToken: 0,
    lastWheel: 0,
    pin: null,          // name of the picture pinned for COMPARE
    cmpMode: "side",    // "side" or "wipe"
    wipeAt: 50,         // where the wipe stands, % across
    link: true,         // A zooms and moves with B
    zoomA: null,        // A's own zoom when not linked; null = fit
    gen: 0,             // which folder opening a look belongs to
    all: [],            // every picture of the folder, picks or not
    rot: new Map(),     // name -> quarter turns the view is given, 0-3
    busy: 0,            // looks on their way
    undo: [],           // what Ctrl+Z puts back: deletes and picks, newest last
    total: 0,           // pictures in the folder, before Picks narrows them
    pickN: 0,           // of which picked
    trash: 0,           // waiting in _deleted folders
    bin: "",            // where emptying sends them: "recycle" or "delete"
    binView: false,     // showing the bin of this folder instead of the folder
    sel: new Set(),     // names of the pictures selected together
    selAnchor: -1,      // where a Shift+click range starts
    filter: null,       // {q, names: Set, allSig} - the grid narrowed by render settings
  };

  // ---- urls
  /* The sizes the server makes thumbnails in - one serves every grid size
     near it, so the browser and the server both keep it. */
  const THUMB_SIDES = [256, 384, 512, 768];
  function thumbSize() {
    const dpr = window.devicePixelRatio || 1;
    const want = P.viv_thumb * dpr * 1.15;
    return THUMB_SIDES.find((s) => s >= want) || THUMB_SIDES[THUMB_SIDES.length - 1];
  }
  function thumbURL(item) {
    return url(THUMB_URL, { folder: S.path, name: item.name, v: item.v, size: thumbSize() });
  }
  function rawURL(item) {
    return url(RAW_URL, { folder: S.path, name: item.name, v: item.v });
  }
  function viewURL(item) {
    const r = body.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const side = Math.ceil(Math.max(r.width, r.height) * dpr) || 2048;
    return url(VIEW_URL, { folder: S.path, name: item.name, v: item.v, size: side });
  }

  // ---- grid
  function setEmpty(text) {
    empty.textContent = text || "";
    root.classList.toggle("empty", !!text);
  }

  function width() { return Math.max(2, String(S.items.length).length); }

  /* A folder path as a row of names, every one of them readable, the last
     one - the folder the pictures are actually in - picked out. */
  /* The first folder - a series, as a rule - gets a colour of its own,
     the same one every time for the same name, so series tell apart at a
     glance; the last stays gold. */
  const TOP_COLOURS = ["#9fc9dc", "#a9d18e", "#e6a7bd", "#bba9ea", "#9db4f0", "#8fd3c1", "#e4a1e0", "#f0a39a"];
  /* A series the Series Book shows keeps the Book's own colour - read
     straight off the Book's series rows, so a colour changed there shows
     here within a quarter of a second. A series the Book has not shown yet
     falls back to a colour of its own picked from its name. */
  const BOOK_TONES = new Map();
  function readBookTones() {
    let changed = false;
    for (const n of (app.graph && (app.graph._nodes || app.graph.nodes)) || []) {
      if ((n.comfyClass || n.type) !== "LeielSeriesBook") continue;
      for (const w of n.widgets || []) {
        if (!w.element) continue;
        for (const box of w.element.querySelectorAll(".lsb-pbox")) {
          const name = box.querySelector(".lsb-gname");
          const gt = box.querySelector(".lsb-gtone");
          const tone = box.style.getPropertyValue("--sg").trim()
            || (gt && gt.style.getPropertyValue("--gt").trim());
          if (!name || !tone) continue;
          const key = name.textContent.trim().toLowerCase();
          if (BOOK_TONES.get(key) !== tone) { BOOK_TONES.set(key, tone); changed = true; }
        }
      }
    }
    return changed;
  }
  function topColour(name) {
    const live = BOOK_TONES.get(String(name || "").trim().toLowerCase());
    if (live) return live;
    let h = 0;
    for (const ch of name) h = (h * 31 + ch.codePointAt(0)) >>> 0;
    return TOP_COLOURS[h % TOP_COLOURS.length];
  }
  /* The folder on show leads the path when it is itself a series - not
     output or input, and not a dated folder of a day's renders - so the
     series name stays in sight after opening the series folder alone. */
  function openName() {
    const p = String(S.path || "").replace(/\\/g, "/").replace(/\/+$/, "");
    if (!p || S.rel === "") return "";
    const n = p.slice(p.lastIndexOf("/") + 1);
    if (/^(output|input)$/i.test(n) || isDate(n)) return "";
    return n;
  }
  const isDate = (n) => /^\d{4}[-_.]?\d{2}[-_.]?\d{2}$/.test(n);
  /* the series in a path: the first folder that is not a day's date */
  const seriesAt = (parts) => parts.findIndex((p) => !isDate(p));
  const seriesOf = (dir) => {
    const parts = (openName() ? [openName()] : []).concat(dir ? dir.split("/") : []);
    const k = seriesAt(parts);
    return k >= 0 ? parts[k] : "";
  };
  function crumbs(dir) {
    const box = el("span", "viv-crumbs");
    const lead = openName();
    const parts = (lead ? [lead] : []).concat(dir ? dir.split("/") : []);
    if (!parts.length) { box.append(el("span", "seg here", "this folder")); return box; }
    const at = seriesAt(parts);
    parts.forEach((p, k) => {
      if (k) box.append(el("span", "sep", "\u203A"));
      const last = k === parts.length - 1;
      const top = k === at;
      const seg = el("span", "seg" + (top ? " first" : last ? " last" : ""), p);
      if (top) { seg.dataset.series = p; seg.style.setProperty("--top", topColour(p)); }
      box.append(seg);
    });
    box.title = parts.join(" / ");
    return box;
  }

  /* LIST, folder by folder: each folder on show remembers whether it is a
     list, under the folder's own path, in the node's properties - so it
     travels with the workflow and comes back the next time it is opened. */
  const listKey = (dir) => normFolder(S.path) + "|" + String(dir || "").toLowerCase();
  const isList = (dir) => (P.viv_lists || []).includes(listKey(dir));
  function setList(dirs, on) {
    const keys = new Set(P.viv_lists || []);
    for (const d of dirs) { if (on) keys.add(listKey(d)); else keys.delete(listKey(d)); }
    P.viv_lists = [...keys].slice(-500);
    buildGrid();
    paintListBtn();
  }
  function dirsOnShow() {
    return S.multi ? (S.groups || []).map((g) => g.dir) : [""];
  }
  function paintListBtn() {
    const dirs = dirsOnShow();
    const n = dirs.filter(isList).length;
    listBtn.classList.toggle("on", n > 0 && n === dirs.length);
    listBtn.textContent = n && n < dirs.length ? `List ${n}/${dirs.length}` : "List";
  }
  const fmtDate = (t) => {
    const d = new Date((Number(t) || 0) * 1000);
    return isNaN(d) ? "" : d.toLocaleString(undefined, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  };
  const fmtSize = (b) => (Number(b) > 0 ? Math.max(1, Math.ceil(Number(b) / 1024)).toLocaleString() + " KB" : "");
  /* The column names sort their own folder: a click sorts by that column,
     a second click the other way. The arrow shows which, and which way. */
  const COLS = [["hn", "Name", "name", "name_z"], ["hd", "Date", "newest", "oldest"],
                ["hz", "Pixels", "pixels", "pixels_small"], ["hs", "Size", "size", "size_small"]];
  function listHead(dir) {
    const h = el("div", "viv-lhead");
    h.dataset.dir = dir;
    const cur = sortOf(S.path, dir);
    for (const [cls, label, first, second] of COLS) {
      const on = cur === first ? "\u25BC" : cur === second ? "\u25B2" : "";
      const c = el("div", cls + (on ? " on" : ""), label);
      if (on) c.append(el("i", "", on));
      c.title = `Sort this folder by ${label.toLowerCase()} - click again for the other way`;
      c.addEventListener("click", (e) => {
        e.stopPropagation();
        const all = { ...(P.viv_fsort || {}) };
        all[sortKey(S.path, dir)] = sortOf(S.path, dir) === first ? second : first;
        const keys = Object.keys(all);
        for (const k of keys.slice(0, Math.max(0, keys.length - 500))) delete all[k];
        P.viv_fsort = all;
        rescan(true);
      });
      h.append(c);
    }
    return h;
  }

  function buildGrid() {
    const scroll = grid.scrollTop;
    grid.textContent = "";
    const w = width();
    const heads = new Map((S.multi ? S.groups : []).map((g) => [g.start, g]));
    S.folded = S.folded || new Set();
    S.cells = S.items.map((item, i) => {
      const g = heads.get(i);
      if (g && P.viv_deep) {
        /* ALL IN ONE: the pictures run on without a break, and where a
           folder starts a tile the size of a thumbnail says which - the
           grid stays full and the folders stay readable. A click on it
           opens the folder's first picture. */
        const t = el("div", "viv-tile");
        const inner = el("div", "in");
        const parts = g.dir ? g.dir.split("/") : [];
        if (!parts.length) inner.append(el("div", "seg last here", "this folder"));
        parts.forEach((p, k) => inner.append(el("div", "seg" + (k === parts.length - 1 ? " last" : ""), p)));
        t.append(inner, el("span", "", `${g.end - g.start + 1} \u203A`));
        t.title = (g.dir || "this folder") + "  -  click to open its first picture";
        t.dataset.dir = g.dir;
        t.addEventListener("click", () => {
          setIndex(g.start);
          setMode("large");
          root.focus({ preventScroll: true });
        });
        grid.append(t);
      } else if (g) {
        const h = el("div", "viv-group" + (S.folded.has(g.dir) ? " shut" : ""));
        const lv = el("span", "lv" + (isList(g.dir) ? " on" : ""), isList(g.dir) ? "Grid" : "List");
        lv.title = isList(g.dir) ? "Show this folder as thumbnails" : "Show this folder as a list - name, date, size";
        lv.addEventListener("click", (e) => { e.stopPropagation(); setList([g.dir], !isList(g.dir)); });
        h.append(el("span", "tw", "\u25BC"), crumbs(g.dir), lv, el("span", "n", String(g.end - g.start + 1)));
        h.title = (g.dir || "this folder") + "  -  click to fold";
        h.dataset.dir = g.dir;
        if (seriesOf(g.dir)) {
          h.dataset.series = seriesOf(g.dir);
          h.style.setProperty("--sgv", topColour(seriesOf(g.dir)));
        }
        h.addEventListener("click", () => {
          if (S.folded.has(g.dir)) S.folded.delete(g.dir); else S.folded.add(g.dir);
          h.classList.toggle("shut", S.folded.has(g.dir));
          for (let k = g.start; k <= g.end; k++) S.cells[k] && S.cells[k].classList.toggle("hid", S.folded.has(g.dir));
          for (const lh of grid.querySelectorAll(".viv-lhead")) {
            if (lh.dataset.dir === g.dir) lh.classList.toggle("hid", S.folded.has(g.dir));
          }
        });
        grid.append(h);
      }
      const dirHere = S.multi ? groupOf(i).dir : "";
      const asRow = isList(dirHere);
      if (asRow && (i === 0 || (S.multi && heads.has(i)))) {
        const lh = listHead(dirHere);
        if (S.multi && S.folded.has(dirHere)) lh.classList.add("hid");
        grid.append(lh);
      }
      const c = el("div", "viv-cell" + (asRow ? " row" : ""));
      c.dataset.i = String(i);
      const img = el("img");
      img.loading = "lazy";
      img.decoding = "async";
      img.draggable = false;
      img.src = thumbURL(item);
      img.alt = item.name;
      const cut = item.name.lastIndexOf("/");
      if (S.multi) {
        const gg = groupOf(i);
        c.append(img, el("span", "", pad(i - gg.start + 1, Math.max(2, String(gg.end - gg.start + 1).length))));
        if (S.folded.has(gg.dir)) c.classList.add("hid");
      } else c.append(img, el("span", "", pad(i + 1, w)));
      if (asRow) {
        const fn = el("div", "fn", shortName(item.name) + (dayOf(item.name) ? "  \u00B7  " + dayOf(item.name) : ""));
        fn.title = item.name;
        c.append(fn, el("div", "fd", fmtDate(item.t)),
                 el("div", "fz", item.w ? `${item.w}\u00D7${item.h}` : ""), el("div", "fs", fmtSize(item.b)));
      }
      const pk = el("i", "pk", "\u2605");
      pk.title = "Pick  (P)";
      const ck = el("i", "ck", "\u2713");
      ck.title = "Select - Shift+click a box to select the run from the last one ticked";
      c.append(pk, ck);
      grid.append(c);
      return c;
    });
    grid.scrollTop = scroll;
    applyMarks();
    paintListBtn();
  }

  function applyMarks() {
    S.cells.forEach((c, i) => {
      c.classList.toggle("cur", i === S.current);
      c.classList.toggle("fresh", !!S.fresh && S.items[i] && S.items[i].name === S.fresh);
      c.classList.toggle("picked", !!(S.items[i] && S.items[i].p));
      c.classList.toggle("sel", !!(S.items[i] && S.sel.has(S.items[i].name)));
    });
    paintSel();
  }

  function scrollIntoGrid(i) {
    const c = S.cells[i];
    if (!c) return;
    const top = c.offsetTop - 8;
    const bottom = c.offsetTop + c.offsetHeight + 8;
    if (top < grid.scrollTop) grid.scrollTop = top;
    else if (bottom > grid.scrollTop + grid.clientHeight) grid.scrollTop = bottom - grid.clientHeight;
  }

  /* Up and down in the grid go to the picture drawn above or below - found
     by where the cells sit, not by counting, since each folder starts a new
     row and its last row is rarely full. The nearest one across is taken,
     in the next row that has any; folded folders are skipped. */
  function gridVertical(dir) {
    const cur = S.cells[S.current];
    if (!cur) { setIndex(0, true); return; }
    const top = cur.offsetTop;
    const mid = cur.offsetLeft + cur.offsetWidth / 2;
    let rowTop = null, best = -1, bestDx = Infinity;
    S.cells.forEach((c, i) => {
      if (!c.offsetParent) return;                         // folded away
      const t = c.offsetTop;
      if (dir > 0 ? t <= top + 2 : t >= top - 2) return;
      if (rowTop === null || (dir > 0 ? t < rowTop - 2 : t > rowTop + 2)) {
        rowTop = t; best = -1; bestDx = Infinity;
      }
      if (Math.abs(t - rowTop) > 2) return;
      const dx = Math.abs(c.offsetLeft + c.offsetWidth / 2 - mid);
      if (dx < bestDx) { bestDx = dx; best = i; }
    });
    if (best >= 0) setIndex(best, true);
  }

  function columns() {
    const tpl = getComputedStyle(grid).gridTemplateColumns || "";
    return Math.max(1, tpl.split(" ").filter(Boolean).length);
  }

  function updateInfo() {
    if (performance.now() < S.flashUntil) return;
    infoCore();
    if (S.binView && info.textContent) info.textContent = "bin  \u00B7  " + info.textContent;
    if (S.filter && !S.binView) info.textContent += `  \u00B7  filtered ${S.items.length} of ${S.total}`;
  }
  function infoCore() {
    info.classList.remove("flash");
    const n = S.items.length;
    if (!n) { info.textContent = ""; return; }
    const cap = S.capped ? `  \u00B7  first ${n}` : "";
    if (S.multi) {
      const g = groupOf(S.current);
      const fi = S.groups.indexOf(g) + 1;
      info.textContent = (S.current >= 0
        ? `folder ${fi} / ${S.groups.length}  \u00B7  ${pad(S.current - g.start + 1, 2)} / ${g.end - g.start + 1}`
          + (S.grouped ? `  \u00B7  ${n} in all` : `  \u00B7  ${S.current + 1} / ${n} in all`)
        : `${n} images  \u00B7  ${S.groups.length} folders`) + (S.grouped ? "" : "  \u00B7  all in one") + cap;
      return;
    }
    const where = S.multi ? "  \u00B7  all in one" : "";
    info.textContent = (S.current >= 0
      ? `${pad(S.current + 1, width())} / ${n}` : `${n} ${P.viv_picks ? "picks" : "images"}`)
      + where + cap + (P.viv_picks ? `  \u00B7  of ${S.total}` : "");
  }

  function flash(text) {
    S.flashUntil = performance.now() + 2600;
    info.textContent = text;
    info.classList.add("flash");
    setTimeout(updateInfo, 2700);
  }

  function paintControls() {
    byName.classList.toggle("on", nameOn());
    byName.title = nameOn() && dateWay()
      ? "Name and date together: scenes in name order, the takes of one scene by date - click to sort by date alone"
      : nameOn() ? "By name - click Newest as well to sort the takes of each scene by date"
      : "Click to sort by name as well - scenes in name order, the takes of each by date";
    /* one button for both ways round by date: it says which it is */
    byNew.classList.toggle("on", !!dateWay());
    byNew.textContent = dateWay() === "oldest" ? "Oldest" : "Newest";
    byNew.title = dateWay() === "oldest" ? "Oldest first - click again to turn date off"
      : dateWay() === "newest" ? "Newest first - click again for oldest first"
      : "Sort by date as well - newest first";
    followBtn.classList.toggle("on", !!P.viv_follow);
    deepBtn.classList.toggle("on", !!P.viv_deep);
    pickBtn.classList.toggle("on", !!P.viv_picks);
    pickBtn.replaceChildren(document.createTextNode("\u2605 Picks "), el("b", "", String(S.pickN || 0)));
    copyBtn.style.display = S.pickN ? "" : "none";
    copyBtn.textContent = `Copy ${S.pickN} pick${S.pickN === 1 ? "" : "s"}`;
    trashBtn.style.display = S.trash || S.binView ? "" : "none";
    trashBtn.textContent = `Deleted ${S.trash}`;
    trashBtn.classList.toggle("on", S.binView);
    trashBtn.title = S.binView
      ? "Showing the bin - click to go back to the folder"
      : `${S.trash} deleted picture${S.trash === 1 ? "" : "s"} waiting in the _deleted folders here - click to look through them, restore or empty them`;
    root.classList.toggle("bin", S.binView);
    if (S.binView) {
      binLab.replaceChildren(el("b", "", "Bin"), document.createTextNode(
        `  ${S.trash} deleted picture${S.trash === 1 ? "" : "s"} in this folder${S.multi ? " and the folders inside it" : ""}`));
      binEmpty.title = S.bin === "recycle"
        ? "Empty the bin into the Recycle Bin" : "Empty the bin - gone forever, there is no Recycle Bin here";
    }
    capDel.textContent = S.binView ? "Restore" : "Delete";
    capDel.title = S.binView
      ? "Back where it was deleted from - Ctrl+Z puts it back in the bin  (Delete)"
      : "Delete - into the _deleted folder beside it, Ctrl+Z brings it back  (Delete)";
    if (document.activeElement !== pathBox) pathBox.value = P.viv_folder || "";
    root.style.setProperty("--viv-t", `${P.viv_thumb}px`);
  }

  // ---- turning the view
  /* R turns the picture on screen a quarter round. Only the view: the
     picture is drawn turned into the page, and its width and height swap
     for everything that sizes it - fitting, 100%, compare - so the rest
     never knows. */
  const rotOf = (item) => (item ? S.rot.get(item.name) || 0 : 0);
  const rotCache = new Map();
  function rotSrc(src, rot) {
    if (!rot) return Promise.resolve(src);
    const key = rot + "|" + src;
    if (rotCache.has(key)) return Promise.resolve(rotCache.get(key));
    return new Promise((done) => {
      const im = new Image();
      im.onload = () => {
        const c = document.createElement("canvas");
        const odd = rot % 2 === 1;
        c.width = odd ? im.naturalHeight : im.naturalWidth;
        c.height = odd ? im.naturalWidth : im.naturalHeight;
        const g = c.getContext("2d");
        g.translate(c.width / 2, c.height / 2);
        g.rotate((rot * Math.PI) / 2);
        g.drawImage(im, -im.naturalWidth / 2, -im.naturalHeight / 2);
        c.toBlob((b) => {
          if (!b) { done(src); return; }
          const u = URL.createObjectURL(b);
          rotCache.set(key, u);
          if (rotCache.size > 12) {
            const [k0, u0] = rotCache.entries().next().value;
            rotCache.delete(k0);
            URL.revokeObjectURL(u0);
          }
          done(u);
        }, "image/jpeg", 0.96);
      };
      im.onerror = () => done(src);
      im.src = src;
    });
  }
  /* Sets a picture, turned as it should be. Each step - thumbnail, large,
     full size - has a level, so a quick small one never lands over a
     larger one that was ready first. */
  function setPic(img, src, item, level, ok) {
    const rot = rotOf(item);
    /* With clipping on, the large picture is shown with its blown and
       crushed pixels painted in. The full-size original is not worked over
       - a file of tens of millions of pixels would stall the page - so a
       zoomed picture keeps the screen-sized painted one. */
    const clip = (img === big || img === bigA) && P.viv_clip;
    if (clip && level >= 2) return;
    const go = (u) => {
      if (ok && !ok()) return;
      if (img._name === item.name && img._rot === rot && (img._lvl || 0) > level
          && img._clip === clip) return;
      img._name = item.name; img._rot = rot; img._lvl = level; img._clip = clip;
      img.src = u;
    };
    const after = clip ? (u) => clipSrc(u).then(go) : go;
    if (!rot) { after(src); return; }
    rotSrc(src, rot).then(after);
  }

  // ---- looking at the picture as a picture
  /* Near enough to the ends to have lost their detail: any channel at 248
     or more, or every channel at 6 or less. */
  const CLIP_HI = 248, CLIP_LO = 6;
  const clipCache = new Map();
  function loadImg(u) {
    return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = u; });
  }
  async function pixelsOf(u, maxSide) {
    const im = await loadImg(u);
    const k = Math.min(1, maxSide / Math.max(im.naturalWidth, im.naturalHeight));
    const w = Math.max(1, Math.round(im.naturalWidth * k)), h = Math.max(1, Math.round(im.naturalHeight * k));
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    const cx = cv.getContext("2d", { willReadFrequently: true });
    cx.drawImage(im, 0, 0, w, h);
    return { cv, cx, w, h, data: cx.getImageData(0, 0, w, h) };
  }
  /* The picture dimmed and greyed, and over it every blown pixel in red and
     every crushed one in blue, each spread a little so a single pixel can
     be seen at fit. */
  async function clipSrc(u) {
    if (clipCache.has(u)) return clipCache.get(u);
    let out = u;
    try {
      const { cv, cx, data, w, h } = await pixelsOf(u, 3000);
      const d = data.data, n = w * h;
      const m = new Uint8Array(n);           // 1 blown, 2 crushed
      for (let p = 0, i = 0; p < n; p++, i += 4) {
        const r = d[i], g = d[i + 1], b = d[i + 2];
        if (r >= CLIP_HI || g >= CLIP_HI || b >= CLIP_HI) m[p] = 1;
        else if (r <= CLIP_LO && g <= CLIP_LO && b <= CLIP_LO) m[p] = 2;
      }
      /* spread: about two screen pixels at fit */
      const rad = Math.max(1, Math.round(Math.max(w, h) / 1400));
      const grow = (src) => {
        const t = new Uint8Array(n), o = new Uint8Array(n);
        for (let y = 0; y < h; y++) {
          const row = y * w;
          for (let x = 0; x < w; x++) {
            let v = 0;
            for (let k = Math.max(0, x - rad), e = Math.min(w - 1, x + rad); k <= e && v !== 1; k++) {
              const s0 = src[row + k]; if (s0 && (!v || s0 === 1)) v = s0;
            }
            t[row + x] = v;
          }
        }
        for (let x = 0; x < w; x++) {
          for (let y = 0; y < h; y++) {
            let v = 0;
            for (let k = Math.max(0, y - rad), e = Math.min(h - 1, y + rad); k <= e && v !== 1; k++) {
              const s0 = t[k * w + x]; if (s0 && (!v || s0 === 1)) v = s0;
            }
            o[y * w + x] = v;
          }
        }
        return o;
      };
      const mm = grow(m);
      for (let p = 0, i = 0; p < n; p++, i += 4) {
        if (mm[p] === 1) { d[i] = 255; d[i + 1] = 30; d[i + 2] = 20; }
        else if (mm[p] === 2) { d[i] = 20; d[i + 1] = 120; d[i + 2] = 255; }
        else {
          const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
          const v = l * 0.55;
          d[i] = (d[i] * 0.3 + v * 0.7) * 0.75; d[i + 1] = (d[i + 1] * 0.3 + v * 0.7) * 0.75; d[i + 2] = (d[i + 2] * 0.3 + v * 0.7) * 0.75;
        }
      }
      cx.putImageData(data, 0, 0);
      const blob = await new Promise((res) => cv.toBlob(res, "image/png"));
      if (blob) out = URL.createObjectURL(blob);
    } catch (e) { console.error(e); }
    clipCache.set(u, out);
    if (clipCache.size > 8) {
      const [k0, v0] = clipCache.entries().next().value;
      clipCache.delete(k0);
      if (v0 !== k0 && v0.startsWith("blob:")) URL.revokeObjectURL(v0);
    }
    return out;
  }
  function setClip(on) {
    P.viv_clip = !!on;
    capClip.classList.toggle("on", P.viv_clip);
    big._lvl = -1;
    bigA._lvl = -1; bigA.dataset.name = ""; bigA.dataset.raw = "";
    if (S.mode === "large" && S.current >= 0) showLarge(S.current);
    flash(on ? "clipping - blown highlights red, crushed shadows blue" : "clipping off");
  }

  const histCache = new Map();
  let histToken = 0;
  async function histOf(item) {
    const key = item.name + "\u0001" + item.v;
    let h = histCache.get(key);
    if (h) return h;
    const { data } = await pixelsOf(viewURL(item), 1024);
    const d = data.data, n = d.length / 4;
    const R = new Uint32Array(256), G = new Uint32Array(256), B = new Uint32Array(256), L = new Uint32Array(256);
    let hi = 0, lo = 0;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      R[r]++; G[g]++; B[b]++;
      L[Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b)]++;
      if (r >= CLIP_HI || g >= CLIP_HI || b >= CLIP_HI) hi++;
      else if (r <= CLIP_LO && g <= CLIP_LO && b <= CLIP_LO) lo++;
    }
    h = { R, G, B, L, hi: hi / n, lo: lo / n };
    histCache.set(key, h);
    if (histCache.size > 60) histCache.delete(histCache.keys().next().value);
    return h;
  }
  function drawHist(cv, line, h) {
    const cx = cv.getContext("2d");
    const W = cv.width, H = cv.height;
    cx.clearRect(0, 0, W, H);
    /* the tallest bar, ignoring the very ends so a clipped spike does not
       flatten everything else */
    let top = 1;
    for (const arr of [h.R, h.G, h.B, h.L]) for (let i = 2; i < 254; i++) top = Math.max(top, arr[i]);
    const ys = (v) => H - Math.min(H, (v / top) * H * 0.95);
    const shape = (arr, fill, stroke) => {
      cx.beginPath();
      cx.moveTo(0, H);
      for (let i = 0; i < 256; i++) cx.lineTo((i / 255) * W, ys(arr[i]));
      cx.lineTo(W, H);
      cx.closePath();
      if (fill) { cx.fillStyle = fill; cx.fill(); }
      if (stroke) { cx.strokeStyle = stroke; cx.lineWidth = 1.5; cx.stroke(); }
    };
    cx.globalCompositeOperation = "source-over";
    shape(h.L, "rgba(200,204,212,.22)", null);
    cx.globalCompositeOperation = "lighter";
    shape(h.R, "rgba(255,70,60,.35)", null);
    shape(h.G, "rgba(60,220,110,.30)", null);
    shape(h.B, "rgba(70,130,255,.38)", null);
    cx.globalCompositeOperation = "source-over";
    shape(h.L, null, "rgba(235,238,242,.7)");
    /* the clipping thresholds */
    cx.fillStyle = "rgba(255,107,94,.18)";
    cx.fillRect((CLIP_HI / 255) * W, 0, W, H);
    cx.fillStyle = "rgba(106,168,255,.18)";
    cx.fillRect(0, 0, (CLIP_LO / 255) * W, H);
    const pct = (x) => (x * 100 < 0.05 ? "0%" : (x * 100).toFixed(x * 100 < 10 ? 1 : 0) + "%");
    const cls = (x) => (x * 100 >= 0.5 ? "" : " ok");
    line.innerHTML = `<span class="lo${cls(h.lo)}">shadows <b>${pct(h.lo)}</b></span>`
      + `<span class="hi${cls(h.hi)}">highlights <b>${pct(h.hi)}</b></span>`;
  }
  async function paintHist() {
    root.classList.toggle("hist", !!P.viv_hist);
    capHist.classList.toggle("on", !!P.viv_hist);
    const item = S.items[S.current];
    if (!P.viv_hist || !item || S.mode !== "large") return;
    const a = comparing() && S.cmpMode !== "wipe" ? S.items[pinIndex()] : null;
    const tok = ++histToken;
    let h, ha = null;
    try {
      h = await histOf(item);
      if (a) ha = await histOf(a);
    } catch (e) { console.error(e); return; }
    if (tok !== histToken) return;
    sizeHist();
    drawHist(histCv, histLine, h);
    if (ha) drawHist(histCvA, histLineA, ha);
    liftDiff();
  }
  /* comparing, the line that says what changed sits bottom centre - right
     where the histograms are; it is lifted above them while they show */
  function liftDiff() {
    const on = P.viv_hist && comparing() && S.mode === "large";
    diffBox.style.bottom = on ? `${34 + histBox.offsetHeight + 10}px` : "";
  }
  function sizeHist() {
    const wd = Math.max(200, Math.min(1000, P.viv_histW | 0 || 276));
    histBox.style.width = `${wd}px`;
    /* side by side each pane is half as wide: neither box is let past it */
    const half = comparing() && S.cmpMode !== "wipe" ? Math.max(200, large.clientWidth / 2 - 26) : 1e9;
    const w2 = Math.min(wd, half);
    histBox.style.width = histBoxA.style.width = `${w2}px`;
    const cw = Math.round((w2 - 20) * 2), ch = Math.round(cw * 0.375);
    for (const cv of [histCv, histCvA]) if (cv.width !== cw || cv.height !== ch) { cv.width = cw; cv.height = ch; }
  }
  histRs.addEventListener("pointerdown", (e) => {
    e.preventDefault(); e.stopPropagation();
    const fz = (large.getBoundingClientRect().width / (large.offsetWidth || 1)) || 1;
    const x0 = e.clientX, w0 = P.viv_histW | 0 || 276;
    histRs.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const lim = large.clientWidth - 40;
      P.viv_histW = Math.max(200, Math.min(Math.min(1000, lim), Math.round(w0 + (ev.clientX - x0) / fz)));
      paintHist();
    };
    const up = () => { histRs.removeEventListener("pointermove", move); histRs.removeEventListener("pointerup", up); };
    histRs.addEventListener("pointermove", move);
    histRs.addEventListener("pointerup", up);
  });
  histRs.addEventListener("click", (e) => e.stopPropagation());
  function setHist(on) {
    P.viv_hist = !!on;
    paintHist();
    liftDiff();
    flash(on ? "histogram - with blown highlights and crushed shadows" : "histogram off");
  }

  /* Guides drawn over where the picture actually is on screen - fitted,
     zoomed or scrolled - followed every frame while they are on. */
  const GUIDE_NAMES = ["off", "thirds", "centre", "thirds and centre"];
  let guideRaf = 0;
  function guidesOn(box, st, img, zoomed, mode) {
    const lr = large.getBoundingClientRect();
    const sr = st.getBoundingClientRect();
    const br = img.getBoundingClientRect();
    const fz = lr.width / (large.offsetWidth || 1) || 1;
    let x = br.left, y = br.top, w = br.width, h = br.height;
    if (!zoomed && img.naturalWidth && img.naturalHeight) {
      const k = Math.min(w / img.naturalWidth, h / img.naturalHeight);
      const dw = img.naturalWidth * k, dh = img.naturalHeight * k;
      x += (w - dw) / 2; y += (h - dh) / 2; w = dw; h = dh;
    }
    box.style.display = "";
    box.style.left = `${(sr.left - lr.left) / fz}px`;
    box.style.top = `${(sr.top - lr.top) / fz}px`;
    box.style.width = `${sr.width / fz}px`;
    box.style.height = `${sr.height / fz}px`;
    const gx = (x - sr.left) / fz, gy = (y - sr.top) / fz, gw = w / fz, gh = h / fz;
    const sig = [mode, gx, gy, gw, gh].map((v) => Math.round(v)).join(",");
    if (box._sig === sig) return;
    box._sig = sig;
    const L = (x1, y1, x2, y2, c, wd) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c}" stroke-width="${wd}"/>`;
    let lines = "";
    const sh = "rgba(0,0,0,.45)";
    const add = (x1, y1, x2, y2, c) => { lines += L(x1, y1, x2, y2, sh, 3) + L(x1, y1, x2, y2, c, 1); };
    if (mode === 1 || mode === 3) {
      for (const f of [1 / 3, 2 / 3]) {
        add(gw * f, 0, gw * f, gh, "rgba(255,255,255,.75)");
        add(0, gh * f, gw, gh * f, "rgba(255,255,255,.75)");
      }
    }
    if (mode === 2 || mode === 3) {
      add(gw / 2, 0, gw / 2, gh, "rgba(240,207,134,.9)");
      add(0, gh / 2, gw, gh / 2, "rgba(240,207,134,.9)");
    }
    box.innerHTML = `<svg style="left:${gx}px;top:${gy}px" width="${gw}" height="${gh}">${lines}</svg>`;
  }
  function guideFrame() {
    guideRaf = 0;
    const mode = P.viv_guides | 0;
    root.classList.toggle("guides", mode > 0);
    capGuide.classList.toggle("on", mode > 0);
    if (!mode || S.mode !== "large") return;
    guidesOn(guideBox, stage, big, S.actual, mode);
    /* the pinned picture gets its own while side by side; laid over with
       the wipe the two share one place, so one set does */
    if (comparing() && S.cmpMode !== "wipe" && bigA.getAttribute("src")) guidesOn(guideBoxA, stageA, bigA, zoomedA(), mode);
    else guideBoxA.style.display = "none";
    guideRaf = requestAnimationFrame(guideFrame);
  }
  function startGuides() { if (!guideRaf) guideRaf = requestAnimationFrame(guideFrame); }
  function setGuides(mode) {
    P.viv_guides = ((mode | 0) + 4) % 4;
    guideBox._sig = ""; guideBoxA._sig = "";
    root.classList.toggle("guides", P.viv_guides > 0);
    capGuide.classList.toggle("on", P.viv_guides > 0);
    startGuides();
    flash(`guides - ${GUIDE_NAMES[P.viv_guides]}`);
  }
  function turn(dir) {
    const item = S.items[S.current];
    if (!item || S.mode !== "large") return;
    const was = rotOf(item);
    const now = (was + dir + 4) % 4;
    if (now) S.rot.set(item.name, now); else S.rot.delete(item.name);
    if ((was + now) % 2) { const w = item.w; item.w = item.h; item.h = w; }
    big._lvl = 0;
    if (S.pin === item.name) { bigA.dataset.name = ""; bigA.dataset.raw = ""; }
    showLarge(S.current);
    flash(now ? `turned ${now * 90}\u00B0 - the view only, the file is as it was` : "turned back");
  }

  // ---- the prompt
  /* What the picture was made with, read back from the graph ComfyUI wrote
     into the PNG. A Series Lab render is rebuilt anchor by anchor - the
     capsule a sweep put in marked - so two renders that look apart can be
     told apart by their words. */
  const metaCache = new Map();
  let metaToken = 0;
  let metaShown = "";       // what the panel holds now - not drawn again for it
  async function copyText(text, btn) {
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch (e) { ok = false; }
    if (!ok) {
      /* not a secure page - ComfyUI opened from another machine - so the
         old way, through a hidden box */
      const ta = el("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;left:-9999px;top:0";
      root.append(ta);
      ta.select();
      try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      ta.remove();
    }
    if (btn) {
      const was = btn.textContent;
      btn.textContent = ok ? "copied" : "failed";
      btn.classList.toggle("done", ok);
      setTimeout(() => { btn.textContent = was; btn.classList.remove("done"); }, 1300);
    }
  }
  const cpBtn = (label, text) => {
    const b = el("button", "cp", label);
    b.addEventListener("click", (e) => { e.stopPropagation(); copyText(text, b); });
    return b;
  };
  /* An anchor as the Series Book reads a reply: its label with the
     capsule's name, then its words. Pasted into the book it lands in the
     open prompt as a capsule of that kind, named. */
  const LABEL_WORD = { trigger: "LORA TRIGGER" };
  const labelled = (sec) => {
    const kind = String(sec.kind || "text").toLowerCase();
    const word = LABEL_WORD[kind] || kind.toUpperCase();
    return `${word}${sec.name ? " \u00B7 " + sec.name : ""}\n${sec.text}`;
  };
  /* click: the words only. shift+click: with the label, ready for the book */
  const secCopyBtn = (sec) => {
    const b = el("button", "cp", "Copy");
    b.title = "Copy the words\nshift+click: with the label and name - paste it into the Series Book";
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      copyText(e.shiftKey ? labelled(sec) : sec.text, b);
    });
    return b;
  };
  /* The capsule number the Series Book on the canvas gives these words -
     read live, so it is always the number on the shelf now. Nothing when
     no book holds them word for word (edited since, or never in a book). */
  function bookNode() {
    try {
      for (const n of (app.graph && app.graph._nodes) || []) {
        if (typeof n.leielUseWords === "function") return n;
      }
    } catch (e) { /* ignore */ }
    return null;
  }
  function capNoFor(kind, text) {
    try {
      for (const n of (app.graph && app.graph._nodes) || []) {
        if (typeof n.leielCapFor !== "function") continue;
        const r = n.leielCapFor(kind, text);
        if (r) return r;
      }
    } catch (e) { /* ignore */ }
    return null;
  }
  function paintMeta(item, m) {
    const head = el("div", "viv-meta-head");
    const x = el("button", "x", "\u00D7");
    x.title = "Close  (I)";
    x.addEventListener("click", (e) => { e.stopPropagation(); setMeta(false); });
    const body = el("div", "viv-meta-body");
    if (m && m.prompt_name) {
      head.append(el("b", "", m.prompt_name));
      if (m.series_name) head.append(el("i", "", m.series_name));
    } else head.append(el("b", "", "Prompt"));
    head.append(x);
    if (!m) {
      body.append(el("div", "none", "reading\u2026"));
    } else if (!m.ok || !m.found) {
      body.append(el("div", "none", m.ok
        ? "No prompt in this picture.\nIt was saved without ComfyUI's graph - by another program, or with the metadata turned off."
        : `Could not read it - ${m.error || "no answer"}`));
    } else {
      /* What is looked up most comes first - the LoRAs, the sampler and the
         enhancer - then the trigger words, and the prompt last, where its
         length is no longer in the way. */
      const rows = [];
      for (const l of m.loras || []) {
        const nm = String(l.name).replace(/\\/g, "/").split("/").pop().replace(/\.safetensors$/i, "");
        rows.push([nm, String(l.strength)]);
      }
      /* The LoRAs and the settings side by side - both are short lists,
         and stacked they pushed the prompt half a panel down. */
      const two = el("div", "two");
      if (rows.length) {
        const col = el("div", "col");
        col.append(el("h6", "", "loras"));
        const t = el("table");
        for (const [a, b] of rows) { const tr = el("tr"); tr.append(el("td", "", a), el("td", "", b)); t.append(tr); }
        col.append(t);
        two.append(col);
      }
      if ((m.settings || []).length) {
        const col = el("div", "col");
        col.append(el("h6", "", "settings"));
        const t = el("table");
        for (const st of m.settings) { const tr = el("tr"); tr.append(el("td", "", st.label), el("td", "", st.value)); t.append(tr); }
        col.append(t);
        two.append(col);
      }
      if (two.childElementCount) {
        if (two.childElementCount === 1) two.classList.add("one");
        body.append(two);
      }
      const er = enhancerRows(m);
      if (er.length) {
        body.append(el("h6", "rule", "enhancer"));
        const t = el("table");
        for (const [a, b, head] of er) { const tr = el("tr", head ? "eh" : ""); tr.append(el("td", "", a), el("td", "", b)); t.append(tr); }
        body.append(t);
      }
      if ((m.triggers || []).length) {
        body.append(el("h6", "", "trigger words"));
        body.append(el("pre", "", m.triggers.join(", ")));
      }
      const h = el("h6", "", "prompt");
      h.append(cpBtn("Copy", m.prompt));
      body.append(h, el("pre", "", m.prompt));
      if ((m.sections || []).length) {
        const ah = el("h6", "", "anchors");
        body.append(ah);
        {
          const all = (m.prompt_name ? `**${m.prompt_name}**\n\n` : "")
            + m.sections.filter(sec => String(sec.text || "").trim()).map(labelled).join("\n\n");
          const cb = cpBtn("Copy all", all);
          cb.title = "Every anchor with its label and name, under the scene's name - pasted into the Series Book it makes or updates that prompt";
          ah.append(cb);
        }
        /* Put the capsules this picture was made with back into the Series
           Book on this canvas - its own prompt there, or the open one - to
           render it again here rather than in a workflow of its own. */
        const book = bookNode();
        if (book && m.sections.some(sec => capNoFor(sec.kind, sec.text))) {
          const ub = el("button", "cp use", "Use in book");
          ub.title = "Put these capsules back into the Series Book on this canvas - into "
            + (m.prompt_name ? `"${m.prompt_name}" if the book has it, the open prompt otherwise` : "the open prompt")
            + ". A kind this picture had none of is taken out. Undo in the book takes it back";
          ub.addEventListener("click", (e) => {
            e.stopPropagation();
            let r = null;
            try { r = book.leielUseWords(m.sections.map(sec => ({ kind: sec.kind, text: sec.text })), m.prompt_name || ""); }
            catch (err) { r = null; }
            if (!r) { flash("the book could not take them"); return; }
            const miss = r.missing.length ? ` - ${r.missing.join(", ")} not in the book as written` : "";
            flash(r.placed || r.out.length ? `put back into ${r.prompt}${miss}` : `${r.prompt} already has them${miss}`);
          });
          ah.append(ub);
        }
        for (const sec of m.sections) {
          const d = el("div", "sec" + (sec.swapped ? " sw" : ""));
          const k = el("div", "k");
          k.append(el("em", "", sec.kind || "text"));
          const no = capNoFor(sec.kind, sec.text);
          if (no) {
            const b = el("b", "cno", no.label);
            b.style.setProperty("--k", no.hue);
            b.title = `capsule ${no.label} in the Series Book - ${no.name}\nclick: put this one into the prompt open in the book`;
            /* one anchor alone, into the open prompt - Use in book does all */
            b.addEventListener("click", (e) => {
              e.stopPropagation();
              const bk = bookNode();
              let r = null;
              try { r = bk && typeof bk.leielPutOne === "function" ? bk.leielPutOne(no.id) : null; } catch (err) { r = null; }
              if (!r) { flash("the book could not take it"); return; }
              flash(r.already ? `${r.prompt} already has ${no.label} ${r.name}` : `${no.label} ${r.name} put into ${r.prompt}`);
              b.classList.add("sent");
              setTimeout(() => b.classList.remove("sent"), 900);
            });
            k.append(b);
          }
          if (sec.name) k.append(el("span", "", sec.name));
          if (sec.swapped) { const t = el("s", "", "sweep"); t.title = "Put in by a capsule sweep"; k.append(t); }
          /* this anchor into the Series Book's drawer, with this very
             picture as its card - the moment it is worth keeping is the
             moment it is on screen */
          if (book && typeof book.leielKeepWords === "function" && sec.kind) {
            /* Words already a card in the drawer read Kept, so a picture is
               never kept twice by mistake; pointed at, the button offers to
               put this picture on that card instead */
            let kept = null;
            try { kept = typeof book.leielKeptWords === "function" ? book.leielKeptWords(sec.kind, sec.text) : null; } catch (err) { kept = null; }
            const kb = el("button", "cp keep" + (kept ? " kept" : ""), kept ? "Kept" : "Drawer");
            const setKept = (name) => {
              kept = { name };
              kb.classList.add("kept");
              kb.textContent = "Kept";
              kb.title = `In the Series Book's drawer as "${name}" - click to make this picture its card's picture`;
            };
            if (kept) setKept(kept.name);
            else kb.title = "Keep this anchor in the Series Book's drawer, with this picture as its card";
            kb.addEventListener("mouseenter", () => { if (kept) kb.textContent = "Replace image"; });
            kb.addEventListener("mouseleave", () => { if (kept) kb.textContent = "Kept"; });
            kb.addEventListener("click", async (e) => {
              e.stopPropagation();
              let r = null;
              try { r = await book.leielKeepWords(sec.kind, sec.name || "", sec.text, rawURL(item), !!kept); } catch (err) { r = null; }
              if (!r) { flash("the book could not keep it"); return; }
              flash(r.msg);
              if (r.ok) {
                setKept(r.name || sec.name || "");
                kb.classList.add("done");
                setTimeout(() => kb.classList.remove("done"), 900);
              }
            });
            k.append(kb);
          }
          k.append(secCopyBtn(sec));
          d.append(k, el("p", "", sec.text));
          body.append(d);
        }
      }
      if (m.workflow) {
        const wf = el("div", "wf", "The whole graph is saved in the picture.");
        const b = el("button", "cp", "Open workflow");
        b.title = "Open the workflow it was made with, as dropping the file on ComfyUI would  (O)";
        b.addEventListener("click", (e) => { e.stopPropagation(); openWorkflow(item); });
        wf.append(b);
        body.append(wf);
      }
      body.append(el("div", "note", m.how === "series lab"
        ? "Rebuilt from the Series Lab and Series Book saved in the picture - exactly as they made it."
        : m.how === "text encoder"
          ? "The text given to the text encoder in the graph saved with the picture."
          : "The longest text in the graph saved with the picture - the prompt, in all but unusual graphs."));
    }
    metaBox.replaceChildren(head, body);
  }
  async function loadMeta() {
    if (!P.viv_meta || S.mode !== "large") return;
    const item = S.items[S.current];
    if (!item) return;
    const key = S.path + "\u0001" + item.name + "\u0001" + item.v;
    /* The quiet rescan every few seconds shows the same picture again: the
       panel is left alone, scrolled where it was. */
    if (key === metaShown && metaBox.firstChild) return;
    const tok = ++metaToken;
    if (metaCache.has(key)) { metaShown = key; paintMeta(item, metaCache.get(key)); return; }
    metaShown = "";
    paintMeta(item, null);
    let m;
    try {
      const q = new URLSearchParams({ folder: S.path, name: item.name, v: String(item.v) });
      const res = await api.fetchApi(`${META_URL}?${q}`);
      m = await res.json();
    } catch (e) { m = { ok: false, error: "could not reach the ComfyUI server" }; }
    if (m && m.ok) metaCache.set(key, m);
    if (metaCache.size > 200) metaCache.delete(metaCache.keys().next().value);
    if (tok === metaToken) { paintMeta(item, m); if (m && m.ok) metaShown = key; }
  }
  function setMeta(on) {
    P.viv_meta = !!on;
    metaShown = "";
    root.classList.toggle("meta", P.viv_meta);
    capMeta.classList.toggle("on", P.viv_meta);
    if (P.viv_meta) loadMeta();
    /* the picture had more room a moment ago - fit or 100% again */
    const item = S.items[S.current];
    if (item && S.actual) requestAnimationFrame(() => sizeZoom(item, scrollFraction()));
  }
  metaBox.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });

  // ---- copying the picture, opening its workflow
  async function rawBlob(item) {
    const res = await fetch(rawURL(item));
    if (!res.ok) throw new Error(`could not read it (${res.status})`);
    return res.blob();
  }
  /* The browser can only put a picture on the clipboard, and only as PNG:
     a JPEG goes through a canvas first. */
  async function asPng(blob) {
    if (blob.type === "image/png") return blob;
    const bmp = await createImageBitmap(blob);
    const c = document.createElement("canvas");
    c.width = bmp.width; c.height = bmp.height;
    c.getContext("2d").drawImage(bmp, 0, 0);
    return new Promise((done) => c.toBlob(done, "image/png"));
  }
  /* The picture alone, through the browser - what a web page can take. A
     file put on the clipboard is something Explorer can paste but a web page
     cannot read: pasted into one, it arrives empty. */
  async function copyPictureOnly(item, note) {
    const png = await asPng(await rawBlob(item));
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
    toast(`copied as a picture  ${shortName(item.name)}` + (note ? `  \u00B7  ${note}` : ""), false);
  }
  async function copyPicture(item, pictureOnly) {
    if (!item) return;
    const short = shortName(item.name);
    if (pictureOnly) {
      try { await copyPictureOnly(item, "for a web page or a chat"); }
      catch (e) { flash(`could not copy it - ${e && e.message || e}`); }
      return;
    }
    const j = await postOK(CLIP_URL, { folder: S.path, name: item.name });
    if (j.ok) {
      toast(`copied  ${short}  \u00B7  a file for Explorer, a picture for Photoshop  \u00B7  Alt+C for a web page or a chat`, false);
      return;
    }
    if (!j.why) { flash(`could not copy it - ${j.error}`); return; }
    /* no desktop helper on the server, or ComfyUI on another computer: the
       picture alone, through the browser */
    try {
      const png = await asPng(await rawBlob(item));
      await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
      toast(`copied as a picture  ${short}` + (j.why === "remote"
        ? "  \u00B7  a file can be copied only on the computer ComfyUI runs on" : ""), false);
    } catch (e) {
      flash(`could not copy it - ${e && e.message || e}`);
    }
  }
  /* The graph the picture was made with, opened the way dropping the file
     on ComfyUI opens it. */
  async function openWorkflow(item) {
    if (!item) return;
    try {
      const blob = await rawBlob(item);
      const file = new File([blob], shortName(item.name), { type: blob.type || "image/png" });
      if (typeof app.handleFile !== "function") throw new Error("this ComfyUI cannot open it from here");
      await app.handleFile(file);
      flash(`opened the workflow of ${shortName(item.name)}`);
    } catch (e) {
      flash(`could not open its workflow - ${e && e.message || e}`);
    }
  }

  // ---- large
  // ---- compare
  const pinIndex = () => (S.pin ? S.items.findIndex((it) => it.name === S.pin) : -1);
  const comparing = () => S.mode === "large" && pinIndex() >= 0;
  function tagText(tag, letter, item) {
    const b = el("b", "", letter);
    tag.replaceChildren(b, document.createTextNode(item ? item.name : ""));
    tag.title = item ? item.name : "";
  }
  function paintCompare() {
    const on = comparing();
    root.classList.toggle("cmp", on);
    root.classList.toggle("wipe", on && S.cmpMode === "wipe");
    root.style.setProperty("--wipe", `${S.wipeAt}%`);
    if (P.viv_hist) setTimeout(paintHist, 0);
    else liftDiff();
    if (!on) { bigA.removeAttribute("src"); diffBox.classList.remove("has"); return; }
    const a = S.items[pinIndex()];
    paintTags();
    cbW.querySelector("span").textContent = S.cmpMode === "wipe" ? "side by side" : "overlay";
    cbL.querySelector("span").textContent = S.link ? "linked" : "separate";
    cbL.classList.toggle("on", !S.link);
    cbL.style.display = S.cmpMode === "wipe" ? "none" : "";
    if (bigA.dataset.name !== a.name) {
      bigA.dataset.name = a.name;
      bigA.dataset.raw = "";
      bigA._lvl = 0;
      setPic(bigA, thumbURL(a), a, 0, () => bigA.dataset.name === a.name);
      const full = new Image();
      /* zoomed, A waits for the full-size original - but with clipping on
         that is never painted, so the screen-sized one is taken instead */
      full.onload = () => setPic(bigA, full.src, a, 1, () => bigA.dataset.name === a.name && (!zoomedA() || P.viv_clip));
      full.src = viewURL(a);
    }
    sizeA();
    if (zoomedA()) loadRawA();
    syncScroll(stage, stageA);
  }
  function paintTags() {
    paintDiff();
    const a = S.items[pinIndex()];
    tagText(tagA, "A", a);
    tagText(tagB, "B", S.items[S.current]);
    if (apart()) {
      const pct = (z) => (z == null ? "fit" : `${Math.round(z * 100)}%`);
      tagA.append(document.createTextNode(`  \u00B7  ${pct(S.zoomA)}`));
      tagB.append(document.createTextNode(`  \u00B7  ${pct(S.actual ? S.zoom : null)}`));
    }
  }
  function loadRawA() {
    const a = S.items[pinIndex()];
    if (!a || bigA.dataset.raw === a.name) return;
    const raw = new Image();
    raw.onload = () => {
      if (bigA.dataset.name !== a.name || !zoomedA()) return;
      bigA.dataset.raw = a.name;
      setPic(bigA, raw.src, a, 2, () => bigA.dataset.name === a.name && zoomedA());
    };
    raw.src = rawURL(a);
  }
  /* Separate only side by side: laid over, the two have to line up. */
  const apart = () => comparing() && !S.link && S.cmpMode === "side";
  const zoomA = () => (apart() ? S.zoomA : (S.actual ? S.zoom : null));
  const zoomedA = () => zoomA() != null;
  /* A is sized by hand, inline, because the panel's own zoom class speaks
     for B: unlinked, A may be fitted while B is at 100%, or the reverse. */
  function sizeA() {
    const a = S.items[pinIndex()];
    if (!a) return;
    const z = zoomA();
    if (z == null) {
      Object.assign(bigA.style, { width: "100%", height: "100%", objectFit: "contain",
                                  maxWidth: "", maxHeight: "" });
      stageA.style.overflow = "hidden";
      return;
    }
    const k = screenScale();
    Object.assign(bigA.style, {
      width: `${((a.w || bigA.naturalWidth || 1) * z) / k}px`,
      height: `${((a.h || bigA.naturalHeight || 1) * z) / k}px`,
      objectFit: "fill", maxWidth: "none", maxHeight: "none" });
    stageA.style.overflow = "auto";
  }
  /* Which picture a zoom, a scroll key or the wheel means: A when the two
     are separate and the pointer is over A, otherwise B. */
  function target() {
    if (!apart() || !S.mouse) return "B";
    const r = stageA.getBoundingClientRect();
    const m = S.mouse;
    return m.x >= r.left && m.x <= r.right && m.y >= r.top && m.y <= r.bottom ? "A" : "B";
  }
  /* Which side the pointer is on while comparing, for stepping, picking
     and deleting: side by side, the half it is over; laid over, the side
     of the wipe line. B when the pointer is elsewhere. */
  function pointerSide() {
    if (!comparing() || !S.mouse) return "B";
    const m = S.mouse;
    if (S.cmpMode === "wipe") {
      const r = large.getBoundingClientRect();
      if (m.x < r.left || m.x > r.right || m.y < r.top || m.y > r.bottom) return "B";
      return m.x < r.left + (r.width * S.wipeAt) / 100 ? "A" : "B";
    }
    const r = stageA.getBoundingClientRect();
    return m.x >= r.left && m.x <= r.right && m.y >= r.top && m.y <= r.bottom ? "A" : "B";
  }
  /* A steps the way B does, within its own folder */
  function setPinIndex(i) {
    const a = pinIndex();
    if (a < 0) return;
    const [lo, hi] = scope(a);
    i = Math.max(lo, Math.min(hi, i));
    if (i === a || !S.items[i]) return;
    S.pin = S.items[i].name;
    S.osdSide = "A";
    paintCompare();
    updateOSD();
  }
  function fitZoomA() {
    const a = S.items[pinIndex()];
    if (!a || !a.w || !a.h) return 1;
    return Math.min(stageA.clientWidth / a.w, stageA.clientHeight / a.h) * screenScale();
  }
  function setZoomA(z) {
    const a = S.items[pinIndex()];
    if (!a) return;
    if (z == null) {
      S.zoomA = null;
      sizeA();
      stageA.scrollLeft = 0; stageA.scrollTop = 0;
      paintTags();
      return;
    }
    z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
    const anchor = a.w && a.h ? anchorOn(stageA, bigA, a, S.zoomA != null) : null;
    S.zoomA = z;
    sizeA();
    if (anchor) {
      const fz = frameZoom();
      const iw = parseFloat(bigA.style.width), ih = parseFloat(bigA.style.height);
      const offX = Math.max(0, (stageA.clientWidth - iw) / 2);
      const offY = Math.max(0, (stageA.clientHeight - ih) / 2);
      stageA.scrollLeft = offX + anchor.fx * iw - anchor.sx / fz;
      stageA.scrollTop = offY + anchor.fy * ih - anchor.sy / fz;
    }
    loadRawA();
    paintTags();
  }
  function stepZoomA(dir) {
    const now = S.zoomA != null ? S.zoomA : fitZoomA();
    let z = dir > 0 ? now * ZOOM_STEP : now / ZOOM_STEP;
    if ((now < 0.999 && z > 1.001) || (now > 1.001 && z < 0.999)) z = 1;
    setZoomA(z);
  }
  function toggleLink() {
    if (!comparing() || S.cmpMode !== "side") return;
    S.link = !S.link;
    S.zoomA = null;
    if (!S.link && S.actual) S.zoomA = S.zoom;   // start apart from where they were
    paintCompare();
    requestAnimationFrame(() => syncScroll(stage, stageA));
    flash(S.link ? "A and B zoom and move together" : "A and B zoom and move on their own - the one under the pointer");
  }
  function togglePin() {
    if (S.pin && pinIndex() >= 0) {
      S.pin = null;
      paintCompare();
      flash("compare off");
      return;
    }
    if (S.current < 0) return;
    const cur = S.current;
    S.pin = S.items[cur].name;
    S.osdSide = "B";
    bigA.dataset.name = ""; bigA.dataset.raw = "";
    if (S.mode !== "large") setMode("large");
    S.zoomA = null;
    /* the same picture on both sides compares nothing: B moves on to the
       next one in the folder, or the one before when A is the last */
    const [lo, hi] = scope(cur);
    const next = cur < hi ? cur + 1 : cur > lo ? cur - 1 : -1;
    if (next >= 0) setIndex(next, true);
    paintCompare();
    updateOSD();
    wakeBar();
    flash(next >= 0 ? "A pinned - B is the next picture, step B to compare others"
      : "A pinned - step to the picture to set beside it");
  }
  function swapPin() {
    const a = pinIndex();
    if (a < 0 || S.current < 0 || a === S.current) return;
    S.pin = S.items[S.current].name;
    bigA.dataset.name = ""; bigA.dataset.raw = "";
    const was = S.current;
    S.osdSide = "B";
    S.current = -1;
    S.current = a;
    applyMarks(); updateInfo();
    showLarge(a);
    void was;
  }
  /* The two panes scroll as one, by the same share of their room - the same
     place in both pictures even when their sizes differ. */
  let syncing = false;
  function syncScroll(from, to) {
    if (syncing || !comparing() || apart()) return;
    syncing = true;
    const fw = from.scrollWidth - from.clientWidth, fh = from.scrollHeight - from.clientHeight;
    const tw = to.scrollWidth - to.clientWidth, th = to.scrollHeight - to.clientHeight;
    to.scrollLeft = fw > 0 ? (from.scrollLeft / fw) * tw : tw / 2;
    to.scrollTop = fh > 0 ? (from.scrollTop / fh) * th : th / 2;
    requestAnimationFrame(() => { syncing = false; });
  }
  stage.addEventListener("scroll", () => syncScroll(stage, stageA));

  /* ---- the navigator
     Shown while the large picture is bigger than its pane. Everything is
     measured on screen - the picture's box against the pane's - so the
     canvas zoom and the viewer's own zoom cancel out. */
  var naviRAF = 0;   // var: updateOSD may run before this line is reached
  function paintNavi() {
    if (naviRAF) return;
    naviRAF = requestAnimationFrame(() => { naviRAF = 0; paintNaviNow(); });
  }
  function naviWanted() {
    if (P.viv_navi === false || S.mode !== "large" || !S.actual) return false;
    return stage.scrollWidth - stage.clientWidth > 2 || stage.scrollHeight - stage.clientHeight > 2;
  }
  function paintNaviNow() {
    const item = S.items[S.current];
    if (!item || !naviWanted()) { navi.classList.remove("show"); return; }
    const src = thumbURL(item);
    if (naviImg.dataset.src !== src) { naviImg.dataset.src = src; naviImg.src = src; }
    navi.classList.add("show");
    const ir = big.getBoundingClientRect(), sr = stage.getBoundingClientRect();
    if (!ir.width || !ir.height) return;
    const cl = (v) => Math.max(0, Math.min(1, v));
    const x0 = cl((sr.left - ir.left) / ir.width), x1 = cl((sr.right - ir.left) / ir.width);
    const y0 = cl((sr.top - ir.top) / ir.height), y1 = cl((sr.bottom - ir.top) / ir.height);
    Object.assign(naviR.style, { left: `${x0 * 100}%`, top: `${y0 * 100}%`,
      width: `${(x1 - x0) * 100}%`, height: `${(y1 - y0) * 100}%` });
  }
  /* put the point (fx, fy) of the picture at the middle of the pane */
  function naviGo(fx, fy) {
    const ir = big.getBoundingClientRect(), sr = stage.getBoundingClientRect();
    if (!ir.width || !stage.offsetWidth) return;
    const scale = sr.width / stage.offsetWidth;
    const cx = (sr.left + sr.width / 2 - ir.left) / ir.width;
    const cy = (sr.top + sr.height / 2 - ir.top) / ir.height;
    stage.scrollLeft += ((fx - cx) * ir.width) / scale;
    stage.scrollTop += ((fy - cy) * ir.height) / scale;
  }
  naviPic.addEventListener("pointerdown", (e) => {
    e.stopPropagation(); e.preventDefault();
    const pr = naviPic.getBoundingClientRect();
    const rr = naviR.getBoundingClientRect();
    const frac = (ev) => [(ev.clientX - pr.left) / pr.width, (ev.clientY - pr.top) / pr.height];
    /* on the box: it keeps where it was taken; elsewhere: the view jumps there */
    const onBox = e.clientX >= rr.left && e.clientX <= rr.right && e.clientY >= rr.top && e.clientY <= rr.bottom;
    const [px, py] = frac(e);
    const ox = onBox ? px - ((rr.left + rr.width / 2) - pr.left) / pr.width : 0;
    const oy = onBox ? py - ((rr.top + rr.height / 2) - pr.top) / pr.height : 0;
    if (!onBox) naviGo(px, py);
    const move = (ev) => { const [mx, my] = frac(ev); naviGo(mx - ox, my - oy); };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  });
  for (const ev of ["click", "dblclick", "wheel", "mousedown"]) {
    navi.addEventListener(ev, (e) => e.stopPropagation());
  }
  naviX.addEventListener("pointerdown", (e) => e.stopPropagation());
  naviX.addEventListener("click", (e) => {
    e.stopPropagation();
    P.viv_navi = false;
    paintNavi();
    flash("navigator hidden - N brings it back");
  });
  function toggleNavi() {
    P.viv_navi = P.viv_navi === false;
    paintNavi();
    flash(P.viv_navi ? "navigator on - shown while the picture is bigger than the view" : "navigator off");
  }
  stage.addEventListener("scroll", paintNavi);
  window.addEventListener("resize", paintNavi);
  stageA.addEventListener("scroll", () => syncScroll(stageA, stage));

  function showLarge(i) {
    const item = S.items[i];
    if (!item) return;
    const [lo, hi] = scope(i);
    const cnt = hi - lo + 1;
    const g = groupOf(i);
    capPos.textContent = S.multi && !S.grouped
      ? `${pad(i - g.start + 1, 2)} / ${g.end - g.start + 1}  \u00B7  ${i + 1} / ${S.items.length}`
      : `${pad(i - lo + 1, Math.max(2, String(cnt).length))} / ${cnt}`;
    capDir.replaceChildren(...(S.multi || openName() ? [crumbs(g.dir)] : []));
    capName.textContent = shortName(item.name) + (dayOf(item.name) ? "  \u00B7  " + dayOf(item.name) : "");
    capName.title = item.name;
    capDim.textContent = item.w ? `${item.w}×${item.h}` : "";
    paintPick();
    paintCompare();
    loadMeta();
    prev.disabled = i <= lo;
    next.disabled = i >= hi;
    /* The thumbnail first - it is cached already - then the large picture
       over it when it lands, so stepping fast never shows a blank frame. The
       token stops a slow picture from arriving after a faster one. */
    const token = ++S.largeToken;
    const keep = S.actual ? scrollFraction() : null;
    if (big._name !== item.name || big._rot !== rotOf(item)) big._lvl = 0;
    setPic(big, thumbURL(item), item, 0, () => token === S.largeToken);
    capRot.classList.toggle("on", !!rotOf(item));
    if (rotOf(item)) capDim.textContent += `  \u21BB${rotOf(item) * 90}\u00B0`;
    if (S.actual) sizeZoom(item, keep);
    updateZoomLabel();
    updateOSD();
    paintHist();
    if (P.viv_guides) startGuides();
    const full = new Image();
    full.onload = () => {
      if (token !== S.largeToken) return;
      setPic(big, full.src, item, 1, () => token === S.largeToken);
      if (S.actual) loadRaw(item, token);
    };
    full.src = viewURL(item);
    for (const j of [i + 1, i - 1]) {
      if (S.items[j] && j >= lo && j <= hi) { const p = new Image(); p.src = viewURL(S.items[j]); }
    }
  }

  // ---- zoom
  const ZOOM_MIN = 0.05;
  const ZOOM_MAX = 8;
  const ZOOM_STEP = 1.25;

  function screenScale() {
    const r = stage.getBoundingClientRect();
    const css = stage.offsetWidth || r.width || 1;
    return (r.width / css) * (window.devicePixelRatio || 1);
  }
  function frameZoom() {
    const r = stage.getBoundingClientRect();
    return (r.width / (stage.offsetWidth || 1)) || 1;
  }
  function fitZoom(item) {
    if (!item.w || !item.h) return 1;
    return Math.min(stage.clientWidth / item.w, stage.clientHeight / item.h) * screenScale();
  }
  function scrollFraction() {
    const sw = stage.scrollWidth - stage.clientWidth;
    const sh = stage.scrollHeight - stage.clientHeight;
    return { x: sw > 0 ? stage.scrollLeft / sw : 0.5, y: sh > 0 ? stage.scrollTop / sh : 0.5 };
  }
  function sizeZoom(item, frac) {
    const k = screenScale();
    big.style.width = `${((item.w || big.naturalWidth || 1) * S.zoom) / k}px`;
    big.style.height = `${((item.h || big.naturalHeight || 1) * S.zoom) / k}px`;
    if (comparing()) sizeA();
    if (frac) {
      stage.scrollLeft = frac.x * Math.max(0, stage.scrollWidth - stage.clientWidth);
      stage.scrollTop = frac.y * Math.max(0, stage.scrollHeight - stage.clientHeight);
    }
  }
  function loadRaw(item, token) {
    const raw = new Image();
    raw.onload = () => setPic(big, raw.src, item, 2, () => token === S.largeToken && S.actual);
    raw.src = rawURL(item);
  }
  function anchorOn(st, img, item, zoomed) {
    const r = st.getBoundingClientRect();
    const m = S.mouse;
    const inside = m && m.x >= r.left && m.x <= r.right && m.y >= r.top && m.y <= r.bottom;
    const ax = inside ? m.x : r.left + r.width / 2;
    const ay = inside ? m.y : r.top + r.height / 2;
    let fx, fy;
    if (zoomed) {
      const b = img.getBoundingClientRect();
      fx = (ax - b.left) / (b.width || 1);
      fy = (ay - b.top) / (b.height || 1);
    } else {
      const sc = Math.min(r.width / item.w, r.height / item.h);
      const dw = item.w * sc, dh = item.h * sc;
      fx = (ax - (r.left + (r.width - dw) / 2)) / dw;
      fy = (ay - (r.top + (r.height - dh) / 2)) / dh;
    }
    return { fx: Math.max(0, Math.min(1, fx)), fy: Math.max(0, Math.min(1, fy)),
             sx: ax - r.left, sy: ay - r.top };
  }
  function zoomAnchor(item) {
    const r = stage.getBoundingClientRect();
    let m = S.mouse;
    if (m && comparing() && S.cmpMode === "side" && !apart()) {
      const ra = stageA.getBoundingClientRect();
      if (m.x >= ra.left && m.x <= ra.right) m = { x: m.x + (r.left - ra.left), y: m.y };
    }
    const inside = m && m.x >= r.left && m.x <= r.right && m.y >= r.top && m.y <= r.bottom;
    const ax = inside ? m.x : r.left + r.width / 2;
    const ay = inside ? m.y : r.top + r.height / 2;
    let fx, fy;
    if (S.actual) {
      const b = big.getBoundingClientRect();
      fx = (ax - b.left) / (b.width || 1);
      fy = (ay - b.top) / (b.height || 1);
    } else {
      const sc = Math.min(r.width / item.w, r.height / item.h);
      const dw = item.w * sc, dh = item.h * sc;
      fx = (ax - (r.left + (r.width - dw) / 2)) / dw;
      fy = (ay - (r.top + (r.height - dh) / 2)) / dh;
    }
    return { fx: Math.max(0, Math.min(1, fx)), fy: Math.max(0, Math.min(1, fy)),
             sx: ax - r.left, sy: ay - r.top };
  }
  function setZoom(z) {
    const item = S.items[S.current];
    if (!item || S.mode !== "large") return;
    if (z == null) {
      if (!S.actual) return;
      S.zoom = null; S.actual = false;
      root.classList.remove("actual");
      big.style.width = ""; big.style.height = "";
      stage.scrollLeft = 0; stage.scrollTop = 0;
      paintCompare();
      updateZoomLabel(); updateOSD();
      return;
    }
    z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
    const anchor = item.w && item.h ? zoomAnchor(item) : null;
    const was = S.actual;
    S.zoom = z; S.actual = true;
    root.classList.add("actual");
    sizeZoom(item, null);
    if (anchor) {
      const fz = frameZoom();
      const iw = parseFloat(big.style.width), ih = parseFloat(big.style.height);
      const offX = Math.max(0, (stage.clientWidth - iw) / 2);
      const offY = Math.max(0, (stage.clientHeight - ih) / 2);
      stage.scrollLeft = offX + anchor.fx * iw - anchor.sx / fz;
      stage.scrollTop = offY + anchor.fy * ih - anchor.sy / fz;
    } else {
      sizeZoom(item, { x: 0.5, y: 0.5 });
    }
    updateZoomLabel(); updateOSD();
    if (!was) loadRaw(item, S.largeToken);
    if (comparing()) { if (apart()) paintTags(); else paintCompare(); }
  }
  function stepZoom(dir) {
    if (target() === "A") { stepZoomA(dir); return; }
    const item = S.items[S.current];
    if (!item) return;
    const now = S.actual ? S.zoom : fitZoom(item);
    let z = dir > 0 ? now * ZOOM_STEP : now / ZOOM_STEP;
    if ((now < 0.999 && z > 1.001) || (now > 1.001 && z < 0.999)) z = 1;
    setZoom(z);
  }
  function setActual(on) { setZoom(on ? 1 : null); }
  /* In full screen a click zooms in where it lands and Ctrl+click zooms
     out, a bigger step than + and -; zooming out stops at fit, and passing
     100% either way stops there first. */
  const CLICK_STEP = 1.5;
  function clickZoom(dir) {
    const a = target() === "A";
    const item = a ? S.items[pinIndex()] : S.items[S.current];
    if (!item) return;
    const fit = a ? fitZoomA() : fitZoom(item);
    const on = a ? S.zoomA != null : S.actual;
    const now = on ? (a ? S.zoomA : S.zoom) : fit;
    let z = dir > 0 ? now * CLICK_STEP : now / CLICK_STEP;
    if ((now < 0.999 && z > 1.001) || (now > 1.001 && z < 0.999)) z = 1;
    if (dir < 0 && z <= fit * 1.001) { if (a) setZoomA(null); else setActual(false); return; }
    if (a) setZoomA(z); else setZoom(z);
  }
  function zoomText() {
    const item = S.items[S.current];
    if (!item) return "";
    const z = S.actual ? S.zoom : fitZoom(item);
    return `${Math.round(z * 100)}%${S.actual ? "" : " fit"}`;
  }
  function updateZoomLabel() { capZoom.textContent = S.mode === "large" ? zoomText() : ""; }
  function updateOSD() {
    paintNavi();
    /* comparing, the name is the one last stepped - A or B */
    const idx = comparing() && S.osdSide === "A" ? pinIndex() : S.current;
    const item = S.items[idx];
    if (!item) { osd.textContent = ""; return; }
    const [lo, hi] = scope(idx);
    const g = groupOf(idx);
    const line2 = el("div", "line2",
      `${comparing() ? (idx === S.current ? "B  " : "A  ") : ""}`
      + `${shortName(item.name)}${dayOf(item.name) ? "  \u00B7  " + dayOf(item.name) : ""}   [${idx - lo + 1}/${hi - lo + 1}]   `
      + `${item.w}×${item.h}   ${zoomText()}`);
    if (item.p) line2.prepend(el("span", "pkd", "\u2605  "));
    osd.replaceChildren(...(S.multi || openName() ? [crumbs(g.dir)] : []), line2);
  }

  function setMode(mode) {
    if (mode !== "large" && S.actual) setActual(false);
    if (mode === "large" && !S.items.length) return;
    S.mode = mode;
    root.classList.toggle("large", mode === "large");
    modeBtn.textContent = mode === "large" ? "▦" : "⤢";
    if (mode === "large") showLarge(Math.max(0, S.current));
    else scrollIntoGrid(S.current);
    paintCompare();
    updateZoomLabel();
  }

  /* To the first picture of the folder before or after this one - from the
     large view as from the grid. In the large view of a grouped folder this
     is how another folder is reached without going back to the grid. */
  let toastT = null;
  function jumpFolder(dir) {
    if (!S.multi || !S.items.length) return;
    const gs = S.groups;
    /* comparing with the pointer over A: A goes to the next folder, B stays */
    if (comparing() && pointerSide() === "A") {
      const a = pinIndex();
      const ka = Math.max(0, gs.indexOf(groupOf(a)));
      const ma = gs.length;
      const toA = gs[((ka + dir) % ma + ma) % ma];
      if (!S.items[toA.start]) return;
      S.pin = S.items[toA.start].name;
      S.osdSide = "A";
      bigA.dataset.name = ""; bigA.dataset.raw = "";
      paintCompare();
      updateOSD();
      dirToast.replaceChildren(crumbs(toA.dir));
      dirToast.classList.add("show");
      clearTimeout(toastT);
      toastT = setTimeout(() => dirToast.classList.remove("show"), 1400);
      return;
    }
    S.osdSide = "B";
    const k = Math.max(0, gs.indexOf(groupOf(Math.max(0, S.current))));
    const m = gs.length;
    const to = gs[((k + dir) % m + m) % m];
    if (S.folded && S.folded.has(to.dir)) {
      S.folded.delete(to.dir);
      buildGrid();
    }
    S.current = -1;
    S.current = to.start;
    applyMarks();
    updateInfo();
    if (S.mode === "large") showLarge(to.start);
    else scrollIntoGrid(to.start);
    dirToast.replaceChildren(crumbs(to.dir));
    dirToast.classList.add("show");
    clearTimeout(toastT);
    toastT = setTimeout(() => dirToast.classList.remove("show"), 1400);
    if (S.mode !== "large") flash(`${to.dir || "this folder"}`);
  }

  function setIndex(i, scroll) {
    if (!S.items.length) return;
    const [lo, hi] = S.current >= 0 ? scope(S.current) : [0, S.items.length - 1];
    i = Math.max(lo, Math.min(hi, i));
    if (i === S.current) return;
    S.current = i;
    S.osdSide = "B";
    applyMarks();
    updateInfo();
    if (S.mode === "large") showLarge(i);
    else if (scroll) scrollIntoGrid(i);
  }

  // ---- server
  /* Grouped unless ALL IN ONE is on: each folder's pictures together, the
     folder's own pictures first, then its folders in name order - or, sorted
     by newest, the folder with the newest picture first. */
  /* the folder a picture is shown under - in a view of several folders,
     led by the picked folder it came from, so each stays apart */
  const dirOf = (name) => {
    const p = plainName(name), t = dayOf(name);
    const k = p.lastIndexOf("/");
    const d = k > 0 ? p.slice(0, k) : "";
    return t ? (d ? t + "/" + d : t) : d;
  };
  const byNameCmp = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
  /* In a view of several folders the same file name can turn up in more
     than one: by name, each folder's pictures stay together. */
  const byPicCmp = (a, b) => {
    const da = dayOf(a), db = dayOf(b);
    if (da !== db) return byNameCmp(da, db);
    return byNameCmp(plainName(a), plainName(b));
  };
  /* Name and Date can both be on: the bar's sort is then "name_newest" or
     "name_oldest". What each half says: */
  const dateWay = () => (/newest$/.test(P.viv_sort) ? "newest" : /oldest$/.test(P.viv_sort) ? "oldest" : null);
  const nameOn = () => !dateWay() || /^name_/.test(P.viv_sort);
  /* Inside a folder: the bar's order, unless the folder was sorted by a
     column name in the list view - Name, Date, Pixels or Size, each one way
     and back. That stays with the folder, as a grid too. The order of the
     folders themselves is the bar's alone. */
  const SORTS = {
    name: (a, b) => byPicCmp(a.name, b.name),
    name_z: (a, b) => byPicCmp(b.name, a.name),
    newest: (a, b) => (b.t - a.t) || byNameCmp(a.name, b.name),
    oldest: (a, b) => (a.t - b.t) || byNameCmp(a.name, b.name),
    pixels: (a, b) => ((b.w * b.h) - (a.w * a.h)) || byNameCmp(a.name, b.name),
    pixels_small: (a, b) => ((a.w * a.h) - (b.w * b.h)) || byNameCmp(a.name, b.name),
    size: (a, b) => ((b.b || 0) - (a.b || 0)) || byNameCmp(a.name, b.name),
    size_small: (a, b) => ((a.b || 0) - (b.b || 0)) || byNameCmp(a.name, b.name),
  };
  const sortKey = (path, dir) => normFolder(path) + "|" + String(dir || "").toLowerCase();
  function sortOf(path, dir) {
    const own = (P.viv_fsort || {})[sortKey(path, dir)];
    if (SORTS[own]) return own;
    return dateWay() || "name";
  }
  function order(items, path) {
    const both = nameOn() && !!dateWay();
    const newest = dateWay() === "newest" && !both;
    const oldest = dateWay() === "oldest" && !both;
    const within = SORTS[sortOf(path, "")];
    const dirs = new Set(items.map((it) => dirOf(it.name)));
    S.multi = dirs.size > 1;
    S.grouped = !P.viv_deep && S.multi;
    if (!S.multi) {
      S.groups = [{ dir: "", start: 0, end: items.length - 1 }];
      return items.slice().sort(within);
    }
    const by = new Map();
    for (const it of items) {
      const d = dirOf(it.name);
      if (!by.has(d)) by.set(d, []);
      by.get(d).push(it);
    }
    const keys = [...by.keys()];
    const top = (d) => Math.max(...by.get(d).map((it) => it.t));
    /* Both on: the first folder level - the scene, "17 C-16 ..." - in name
       order, the higher number first with Newest (lower with Oldest); the
       takes inside one scene - Enhancer on, off, another LoRA - by date. A
       scene rendered again later keeps its place in the run. */
    const head = (d) => d.split("/")[0];
    keys.sort((a, b) => {
      if (a === "" || b === "") return a === "" ? -1 : 1;
      if (both) {
        const up = dateWay() === "newest";
        const h = byNameCmp(head(a), head(b));
        if (h) return up ? -h : h;
        return (up ? top(b) - top(a) : top(a) - top(b)) || byNameCmp(a, b);
      }
      return newest ? (top(b) - top(a)) || byNameCmp(a, b)
        : oldest ? (top(a) - top(b)) || byNameCmp(a, b) : byNameCmp(a, b);
    });
    const out = [];
    S.groups = [];
    for (const d of keys) {
      const list = by.get(d).sort(SORTS[sortOf(path, d)]);
      S.groups.push({ dir: d, start: out.length, end: out.length + list.length - 1 });
      out.push(...list);
    }
    return out;
  }

  function groupOf(i) {
    return (S.groups || []).find((g) => i >= g.start && i <= g.end) || { dir: "", start: 0, end: S.items.length - 1 };
  }
  /* Where stepping may go: in the large view of a grouped folder, only the
     folder the picture is in; everywhere else, the whole list. */
  function scope(i) {
    if (S.grouped && S.mode === "large") { const g = groupOf(i); return [g.start, g.end]; }
    return [0, S.items.length - 1];
  }

  /* Looks at the same folder queue up behind each other. Opening another
     folder does not wait in that queue: it starts at once, and whatever an
     older look brings back afterwards is thrown away. A first look at a big
     output folder - thousands of pictures in dated folders - can take a
     while, and a folder chosen meanwhile should not wait for it. */
  function rescan(force, select) {
    const gen = S.gen;
    S.scan = S.scan.then(() => (gen === S.gen ? doRescan(force, select, gen) : null))
      .catch((e) => console.error(e));
    return S.scan;
  }

  async function doRescan(force, select, gen) {
    let j;
    S.busy += 1;
    try {
      j = await postJSON(LIST_URL, { folder: P.viv_folder || "", deep: true,
                                     thumb: thumbSize(), newest: dateWay() === "newest",
                                     trash: S.binView });
    } catch (e) {
      if (gen === S.gen) setEmpty("could not reach the ComfyUI server");
      return;
    } finally {
      S.busy -= 1;
    }
    if (gen !== S.gen) return;              // another folder was opened meanwhile
    if (!j || !j.ok) {
      S.items = []; S.sig = ""; S.cells = []; S.current = -1; S.path = ""; grid.textContent = "";
      pathBox.classList.add("bad");
      const err = (j && j.error) || "could not read the folder";
      setEmpty(err.startsWith("outside")
        ? `${j.path || ""}\n\nis outside the folders this viewer may open.\nComfyUI's output and input folders always open;\nanother folder has to be listed in\nuser/visual_image_viewer/allowed_folders.txt`
        : `${err}\n${(j && j.path) || ""}`);
      if (S.mode === "large") setMode("grid");
      updateInfo();
      return;
    }
    pathBox.classList.remove("bad");
    if (S.preferRel && typeof j.rel === "string") {
      /* moved here by FOLLOW: shown the short way, from output */
      P.viv_folder = j.rel;
      paintControls();
    }
    S.preferRel = false;
    rememberFolder(P.viv_folder);
    const all = j.items || [];
    /* a picture turned in the view keeps its turn: its sides swap */
    for (const it of all) {
      if ((S.rot.get(it.name) || 0) % 2) { const w = it.w; it.w = it.h; it.h = w; }
    }
    S.all = all;
    S.total = all.length;
    if (!S.binView) S.pickN = all.filter((it) => it.p).length;
    S.trash = j.trash || 0;
    S.bin = j.bin || "";
    if (S.binView && !all.length) {
      /* the bin was emptied or restored: back to the folder */
      S.binView = false;
      paintControls();
      S.gen += 1;
      return doRescan(true, select, S.gen);
    }
    paintControls();
    let shown = P.viv_picks && !S.binView ? all.filter((it) => it.p) : all;
    if (S.filter && !S.binView) {
      /* new renders since the filter was set are read too, then shown if
         they match. Filtered before ordering, so the folder groups are
         counted on what is shown */
      const allSig = all.map((it) => it.name + ":" + it.v).join("|");
      if (S.filter.allSig !== allSig) { S.filter.allSig = allSig; setTimeout(() => runFilter(S.filter.q, true), 0); }
      shown = shown.filter((it) => S.filter.names.has(it.name));
    }
    const items = order(shown, j.path);
    S.deep = !!j.deep;
    S.rel = j.rel;
    S.capped = !!j.capped;
    /* a selection survives a rescan, minus what is no longer there */
    if (S.sel.size) {
      const here = new Set(items.map((it) => it.name));
      for (const nm of [...S.sel]) if (!here.has(nm)) S.sel.delete(nm);
    }
    const sig = sigOf(j.path, items);
    const keepName = S.items[S.current] ? S.items[S.current].name : null;
    const was = S.current;
    const changed = force || sig !== S.sig || j.path !== S.path;
    if (changed) {
      S.sig = sig;
      S.path = j.path;
      S.items = items;
      setEmpty(items.length ? ""
        : S.filter && !S.binView && all.length
          ? `nothing here matches\n${S.filter.q}\n\nEsc in the filter box shows everything again`
        : P.viv_picks && all.length
          ? "no picks here yet\n\nP marks the picture on screen as a pick;\n\u2605 Picks shows everything again"
          : `no images in\n${j.path}`);
      buildGrid();
    }
    const want = select || keepName;
    const at = want ? S.items.findIndex((it) => it.name === want) : -1;
    /* nothing new and the same picture on screen: leave it be - no redraw,
       no reload, the prompt panel where it was */
    if (!changed && !select && at >= 0 && at === was) { updateInfo(); return; }
    S.current = -1;
    /* The grid is scrolled to a picture only when one was asked for - a
       render that just landed, the next one after a delete. The quiet
       rescan every few seconds keeps the selection where it is and leaves
       the scrolling to whoever is scrolling. */
    if (at >= 0) setIndex(at, !!select);
    else if (S.items.length && S.mode === "large") setIndex(0, true);
    applyMarks();
    updateInfo();
    if (!S.items.length && S.mode === "large") setMode("grid");
  }

  function sigOf(path, items) {
    return path + "\u0001" + P.viv_sort + "\u0001" + JSON.stringify(P.viv_fsort || {}) + "\u0001" + (P.viv_deep ? 1 : 0) + "\u0001"
      + (P.viv_picks ? 1 : 0) + "\u0001"
      + items.map((it) => it.name + ":" + it.v + (it.p ? "*" : "")).join("|");
  }

  // ---- picks and deleting
  function paintPick() {
    const item = S.items[S.current];
    capPick.classList.toggle("on", !!(item && item.p));
    capPick.title = item && item.p ? "Picked - click or P to unpick" : "Pick  (P)";
  }

  let noteT = null;
  function toast(text, undoable) {
    toastBox.replaceChildren(el("span", "", text));
    if (undoable) {
      const b = el("button", "", "Undo");
      b.append(el("kbd", "", "Ctrl+Z"));
      b.addEventListener("click", (e) => { e.stopPropagation(); undo(); });
      toastBox.append(b);
    }
    toastBox.classList.add("show");
    clearTimeout(noteT);
    noteT = setTimeout(() => toastBox.classList.remove("show"), undoable ? 6000 : 2600);
  }

  function remember(entry) {
    S.undo.push(entry);
    if (S.undo.length > UNDO_LIMIT) S.undo.shift();
  }

  const shortName = (name) => plainName(name).slice(plainName(name).lastIndexOf("/") + 1);
  /* the folder a picture sits in, inside the one on show - "" for that one */
  const dirOfName = (n) => { const k = n.lastIndexOf("/"); return k < 0 ? "" : n.slice(0, k); };
  const joinRel = (d, n) => (d ? `${d}/${n}` : n);
  const joinDir = (base, d) => {
    const b = String(base || "");
    const sep = b.includes("\\") ? "\\" : "/";
    return d ? b.replace(/[\\/]+$/, "") + sep + d.replace(/\//g, sep) : b;
  };

  /* The picture to land on once one goes: the next in its folder, or the
     one before when it was the last. */
  function neighbour(i) {
    const [lo, hi] = scope(i);
    const k = i < hi ? i + 1 : i > lo ? i - 1 : -1;
    return k >= 0 && S.items[k] ? S.items[k].name : null;
  }

  async function postOK(path, body) {
    try {
      const j = await postJSON(path, body);
      return j && j.ok ? j : { ...(j || {}), ok: false, error: (j && j.error) || "no answer" };
    } catch (e) {
      return { ok: false, error: "could not reach the ComfyUI server" };
    }
  }

  async function togglePick(i) {
    const item = S.items[i];
    if (!item) return;
    if (S.binView) { flash("restore it first - picks are for the folder"); return; }
    const on = !item.p;
    const folder = S.path;
    const j = await postOK(PICK_URL, { folder, names: [item.name], on });
    if (!j.ok) { flash(`could not mark it - ${j.error}`); return; }
    remember({ type: "pick", folder, name: item.name, was: !on });
    if (P.viv_picks && !on) {
      /* with only the picks on show, an unpicked one leaves the view */
      await rescan(true, neighbour(i));
      toast(`unpicked  ${shortName(item.name)}`, true);
      return;
    }
    if (on) item.p = 1; else delete item.p;
    S.pickN += on ? 1 : -1;
    S.sig = sigOf(S.path, S.items);
    applyMarks();
    paintControls();
    paintPick();
    updateOSD();
    flash(on ? `\u2605  picked - ${S.pickN} here` : "unpicked");
  }

  /* ---- filtering by what made the pictures */
  let filterTok = 0;
  async function runFilter(q, quiet) {
    q = String(q || "").trim();
    if (!q) { clearFilter(); return; }
    const tok = ++filterTok;
    if (!quiet) flash("reading the render settings\u2026");
    const j = await postOK(FILTER_URL, { folder: P.viv_folder || "", deep: true, query: q });
    if (tok !== filterTok) return;
    if (!j.ok) { filterBox.classList.add("bad"); flash(`could not filter - ${j.error}`); return; }
    const keep = S.filter && S.filter.q === q ? S.filter.allSig : "";
    S.filter = { q, names: new Set(j.names || []), allSig: keep };
    filterBox.classList.remove("bad");
    filterBox.classList.add("on");
    S.sel.clear();
    if (!quiet && S.mode === "large") setMode("grid");
    await rescan(true);
    if (!quiet) flash(`${(j.names || []).length} of ${j.total} match  ${q}`);
  }
  function clearFilter() {
    filterTok++;
    if (!S.filter) { filterBox.value = ""; filterBox.classList.remove("on", "bad"); return; }
    S.filter = null;
    filterBox.value = "";
    filterBox.classList.remove("on", "bad");
    rescan(true);
  }
  filterBox.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") { e.preventDefault(); runFilter(filterBox.value); }
    if (e.key === "Escape") { e.preventDefault(); clearFilter(); filterBox.blur(); }
  });
  filterBox.addEventListener("input", () => {
    if (!filterBox.value.trim() && S.filter) clearFilter();
  });

  /* ---- comparing: what differs between A and B */
  async function metaOf(item) {
    const key = S.path + "\u0001" + item.name + "\u0001" + item.v;
    if (metaCache.has(key)) return metaCache.get(key);
    try {
      const q = new URLSearchParams({ folder: S.path, name: item.name, v: String(item.v) });
      const res = await api.fetchApi(`${META_URL}?${q}`);
      const m = await res.json();
      if (m && m.ok) {
        metaCache.set(key, m);
        if (metaCache.size > 200) metaCache.delete(metaCache.keys().next().value);
      }
      return m;
    } catch (e) { return null; }
  }
  let diffTok = 0;
  async function paintDiff() {
    const tok = ++diffTok;
    const a = comparing() ? S.items[pinIndex()] : null;
    const b = comparing() ? S.items[S.current] : null;
    if (!a || !b) { diffBox.classList.remove("has"); return; }
    const [ma, mb] = await Promise.all([metaOf(a), metaOf(b)]);
    if (tok !== diffTok) return;
    if (!ma || !mb || !ma.found || !mb.found) { diffBox.classList.remove("has"); return; }
    const kids = [];
    const item = (k, va, vb) => {
      const it = el("span", "it");
      if (k) it.append(el("span", "k", k));
      it.append(el("span", "a", va), el("span", "ar", "\u2192"), el("span", "b", vb));
      kids.push(it);
    };
    const short = (n) => String(n).replace(/\\/g, "/").split("/").pop().replace(/\.safetensors$/i, "");
    /* the models: the upscale model above all, then checkpoint, UNet, VAE,
       text encoder - each kind compared as a set of names */
    const bare = (n) => short(n).replace(/\.(pth|pt|ckpt|bin|gguf|onnx|safetensors)$/i, "");
    const kinds = (m) => {
      const out = new Map();
      for (const x of m.models || []) {
        if (!out.has(x.kind)) out.set(x.kind, []);
        if (!out.get(x.kind).includes(bare(x.name))) out.get(x.kind).push(bare(x.name));
      }
      return out;
    };
    const mka = kinds(ma), mkb = kinds(mb);
    const KIND_ORDER = ["upscale model", "model", "vae", "text encoder"];
    const allK = [...new Set([...mka.keys(), ...mkb.keys()])]
      .sort((x, y) => (KIND_ORDER.indexOf(x) + 99) % 99 - (KIND_ORDER.indexOf(y) + 99) % 99);
    for (const k of allK) {
      const va = (mka.get(k) || []).slice().sort().join(", ");
      const vb = (mkb.get(k) || []).slice().sort().join(", ");
      if (va !== vb) item(k, va || "-", vb || "-");
    }
    const la = new Map((ma.loras || []).map((l) => [short(l.name), String(l.strength)]));
    const lb = new Map((mb.loras || []).map((l) => [short(l.name), String(l.strength)]));
    for (const nm of new Set([...la.keys(), ...lb.keys()])) {
      if (!lb.has(nm)) item(nm, la.get(nm), "off");
      else if (!la.has(nm)) item(nm, "off", lb.get(nm));
      else if (la.get(nm) !== lb.get(nm)) item(nm, la.get(nm), lb.get(nm));
    }
    const sa = new Map((ma.settings || []).map((x) => [x.label, x.value]));
    const sb = new Map((mb.settings || []).map((x) => [x.label, x.value]));
    for (const k of new Set([...sa.keys(), ...sb.keys()])) {
      if (k === "seed") continue;
      if (sa.get(k) !== sb.get(k)) item(k, sa.get(k) ?? "-", sb.get(k) ?? "-");
    }
    /* every other node: an enhancer switched off, bypassed, or set higher */
    const na = ma.nodes || {}, nb = mb.nodes || {};
    const fmt = (v) => typeof v === "number" ? String(+v.toFixed(4)) : String(v);
    for (const id of new Set([...Object.keys(na), ...Object.keys(nb)])) {
      const x = na[id], y = nb[id];
      if (!x || !y) {
        /* in one render only: bypassed or muted in the other */
        item(String((x || y).title).replace(/\s*\([^)]*\)\s*$/, ""), x ? "on" : "bypassed", y ? "on" : "bypassed");
        continue;
      }
      const vx = x.values || {}, vy = y.values || {};
      for (const k of new Set([...Object.keys(vx), ...Object.keys(vy)])) {
        if (fmt(vx[k]) !== fmt(vy[k])) item(`${String(x.title).replace(/\s*\([^)]*\)\s*$/, "")} \u00B7 ${k}`, k in vx ? fmt(vx[k]) : "-", k in vy ? fmt(vy[k]) : "-");
      }
    }
    const ta = new Set((ma.triggers || []).map((t) => String(t).trim().toLowerCase()));
    const tb = new Set((mb.triggers || []).map((t) => String(t).trim().toLowerCase()));
    const onlyA = [...ta].filter((t) => !tb.has(t)), onlyB = [...tb].filter((t) => !ta.has(t));
    const cut = (l) => l.slice(0, 5).join(", ") + (l.length > 5 ? ` +${l.length - 5}` : "");
    if (onlyA.length || onlyB.length) item("triggers", onlyA.length ? cut(onlyA) : "-", onlyB.length ? cut(onlyB) : "-");
    if ((ma.prompt_name || mb.prompt_name) && ma.prompt_name !== mb.prompt_name) {
      item("prompt", ma.prompt_name || "-", mb.prompt_name || "-");
    } else if (String(ma.prompt || "") !== String(mb.prompt || "")) {
      const it = el("span", "it"); it.append(el("span", "k", "prompt"), el("span", "", "differs"));
      kids.push(it);
    }
    if (!kids.length) {
      kids.push(el("span", "same", sa.get("seed") !== sb.get("seed")
        ? "same settings - only the seed differs" : "same settings"));
    }
    diffBox.replaceChildren(el("div", "hd", "A \u2192 B  \u00B7  what changed"), el("div", "bd"));
    diffBox.lastChild.append(...kids);
    diffBox.classList.add("has");
  }

  /* ---- to the Idea Box: one's own renders into My works, under the series
     they belong to, each with what made it in its notes and its LoRAs and
     sampler as keywords - to be laid beside the references there. */
  async function sendToIdeaBox(items) {
    items = items.filter(Boolean);
    if (!items.length) { flash("select pictures, or open one large, to send it to the Idea Box"); return; }
    const series = openName() || "Image Viewer";
    const short = (n) => String(n).replace(/\\/g, "/").split("/").pop().replace(/\.(safetensors|ckpt|pt|pth|bin|gguf)$/i, "");
    let n = 0, joined = 0;
    /* Renders of one band of the viewer - one folder: the scene, the LoRA,
       the sampler, the enhancer, as the Series Lab files them - are one idea
       there: a picture from a folder already sent goes in beside the others
       from it. The folder is read from the "File:" line of the notes; notes
       without one are matched whole. */
    const how = (memo) => {
      const lines = String(memo || "").split("\n");
      const file = lines.find((l) => /^File: /.test(l));
      const dir = file ? file.slice(6).replace(/\\/g, "/").replace(/\/[^/]*$/, "") : "";
      if (file && dir && dir !== file.slice(6)) return `dir:${dir}`;
      return lines.filter((l) => !/^File: /.test(l)).join("\n").trim();
    };
    const same = new Map();
    try {
      const lr = await api.fetchApi("/leiel_idea/list");
      const lj = await lr.json();
      for (const it of (lj && lj.items) || []) {
        if (it.work && it.kind === "image" && (it.wfolder || "") === series) same.set(how(it.memo), it.id);
      }
    } catch (e) { /* none to go beside */ }
    try {
      for (const item of items) {
        flash(`to the Idea Box - ${n + 1} of ${items.length}…`);
        const res = await fetch(rawURL(item));
        if (!res.ok) throw new Error(`could not read ${item.name}`);
        const blob = await res.blob();
        const m = await metaOf(item) || {};
        const lines = [(m.prompt_name || String(item.name).replace(/\.[^.]+$/, "")), series];
        const loras = (m.loras || []).map((l) => `${short(l.name)} ${l.strength}`);
        if (loras.length) lines.push(`LoRA: ${loras.join(" · ")}`);
        const set = (m.settings || []).filter((x) => x.label !== "seed").map((x) => `${x.label} ${x.value}`);
        if (set.length) lines.push(set.join(" · "));
        const enh = (m.enhancers || []).map((e) => `${String(e.title || "enhancer").replace(/\s*\([^)]*\)\s*$/, "")} ${e.on ? "on" : "off"}`);
        if (enh.length) lines.push(enh.join(" · "));
        lines.push(`File: ${item.name}`);
        const sig = how(lines.join("\n"));
        if (same.has(sig)) {
          const q2 = new URLSearchParams({ id: same.get(sig), name: item.name, memo: lines.join("\n") });
          const r2 = await api.fetchApi(`/leiel_idea/more_add?${q2}`, { method: "POST", body: blob });
          const j2 = await r2.json().catch(() => ({ ok: false }));
          if (j2.ok) { n += 1; joined += 1; continue; }
          same.delete(sig);                       // that one is gone: a new idea, then
        }
        const q = new URLSearchParams({ name: item.name, via: "viewer", memo: lines.join("\n"), work: "1", wfolder: series });
        const r = await api.fetchApi(`/leiel_idea/add?${q}`, { method: "POST", body: blob });
        const j = await r.json().catch(() => ({ ok: false }));
        if (!j.ok) throw new Error(j.error || "is the Visual Idea Box installed?");
        if (j.item) same.set(sig, j.item.id);
        /* the LoRAs and the sampler, as keywords to find it by */
        const tags = [...(m.loras || []).map((l) => short(l.name)),
          ...(m.settings || []).filter((x) => x.label === "sampler" || x.label === "scheduler").map((x) => x.value)];
        if (tags.length && j.item) {
          await api.fetchApi("/leiel_idea/update", { method: "POST", body: JSON.stringify({ id: j.item.id, changes: { tags } }) });
        }
        n += 1;
      }
      toast(`${n} ${n === 1 ? "picture" : "pictures"} in the Idea Box - My works › ${series}`
        + (joined ? ` - ${joined} beside one made the same way` : ""), false);
    } catch (e) {
      toast(`${n ? `${n} sent, then ` : ""}not sent: ${e && e.message || e}`, false);
    }
  }
  /* ---- back to the Series Lab: each picture's recipe - the prompt, the
     LoRAs and strengths, the capsules swapped in, the option chips - read
     from the PNG and put on the Lab's bench as a new recipe. The Lab does
     the rest; it listens for "leiel-to-lab". Pictures made the same way go
     as one recipe. */
  async function sendToLab(items) {
    items = items.filter(Boolean);
    if (!items.length) { flash("select pictures, or open one large, to send it to the Series Lab"); return; }
    const recipes = [], seen = new Set();
    let none = 0;
    for (const item of items) {
      const m = await metaOf(item);
      const r = m && m.lab;
      if (!r) { none += 1; continue; }
      const sig = JSON.stringify([r.prompt_slot, r.prompt_name, r.loras, r.chips, r.swap, (r.triggers || []).slice().sort()]);
      if (seen.has(sig)) continue;
      seen.add(sig);
      recipes.push(r);
    }
    if (!recipes.length) {
      toast(items.length === 1 ? "this picture was not rendered by a Series Lab - there is no recipe in it"
        : "none of these was rendered by a Series Lab - there is no recipe in them", false);
      return;
    }
    const detail = { recipes, taken: false, added: 0, notes: [] };
    window.dispatchEvent(new CustomEvent("leiel-to-lab", { detail }));
    if (!detail.taken) { toast("no Series Lab on the canvas to send it to", false); return; }
    const n = detail.added;
    const msg = [`${n} ${n === 1 ? "recipe" : "recipes"} on the Series Lab's bench`];
    if (recipes.length < items.length - none) msg.push("pictures made the same way went as one");
    if (none) msg.push(`${none} without a Lab recipe left out`);
    for (const t of detail.notes) msg.push(t);
    toast(msg.join(" - "), false);
  }

  const ideaTargets = () => (S.sel.size ? S.items.filter((it) => S.sel.has(it.name))
    : S.mode === "large" && S.current >= 0 ? [S.items[S.current]] : []);

  /* ---- selecting several */
  const selNames = () => S.items.filter((it) => S.sel.has(it.name)).map((it) => it.name);
  function paintSel() {
    const n = S.sel.size;
    root.classList.toggle("selecting", n > 0);
    if (!n) return;
    selLab.replaceChildren(el("b", "", `${n} selected`),
      document.createTextNode(n === 1 ? "" : "  - act on all of them together"));
    const inBin = S.binView;
    selPick.style.display = inBin ? "none" : "";
    selCopy.style.display = inBin ? "none" : "";
    selPurge.style.display = inBin ? "" : "none";
    selDel.textContent = inBin ? "Restore" : "Delete";
    selDel.classList.toggle("del", !inBin);
    selDel.title = inBin ? "Back where they were deleted from  (Delete)"
      : "Into the _deleted folders beside them - Ctrl+Z brings them back  (Delete)";
    const allPicked = selNames().every((nm) => (S.items.find((it) => it.name === nm) || {}).p);
    selPick.textContent = allPicked ? "\u2605 Unpick" : "\u2605 Pick";
  }
  function markSel() {
    S.cells.forEach((c, i) => c.classList.toggle("sel", !!(S.items[i] && S.sel.has(S.items[i].name))));
    paintSel();
  }
  function toggleSel(i) {
    const it = S.items[i];
    if (!it) return;
    if (S.sel.has(it.name)) S.sel.delete(it.name); else S.sel.add(it.name);
    S.selAnchor = i;
    markSel();
  }
  function selectRange(a, b) {
    const lo = Math.min(a, b), hi = Math.max(a, b);
    for (let k = lo; k <= hi; k++) {
      if (S.cells[k] && !S.cells[k].classList.contains("hid")) S.sel.add(S.items[k].name);
    }
    S.selAnchor = b;
    markSel();
  }
  function selectAll() {
    S.items.forEach((it, k) => { if (S.cells[k] && !S.cells[k].classList.contains("hid")) S.sel.add(it.name); });
    markSel();
  }
  function clearSel() {
    if (!S.sel.size) return false;
    S.sel.clear(); S.selAnchor = -1;
    markSel();
    return true;
  }

  async function deleteSelected() {
    const names = selNames();
    if (!names.length) return;
    const folder = S.path;
    if (S.binView) {
      const j = await postOK(UNTRASH_URL, { folder, names });
      if (!j.ok) { flash(`could not restore them - ${j.error}`); return; }
      const back = j.back || [];
      if (back.length) remember({ type: "untrash", folder, back });
      S.sel.clear();
      await rescan(true);
      toast(`${back.length} restored`, !!back.length);
      return;
    }
    const j = await postOK(DELETE_URL, { folder, names });
    if (!j.ok || !(j.moved || []).length) { flash(`could not delete them - ${j.error || "not found"}`); return; }
    remember({ type: "del", folder, items: j.moved });
    if (names.includes(S.pin)) S.pin = null;
    S.sel.clear();
    await rescan(true);
    toast(`${j.moved.length} deleted`, true);
  }
  async function purgeSelected(sure) {
    const names = selNames();
    if (!names.length || !S.binView) return;
    if (S.bin !== "recycle" && !sure) {
      askGo = () => { closeAsk(); purgeSelected(true); };
      const box = el("div", "viv-ask-box");
      box.append(el("h3", "", `Delete ${names.length} picture${names.length === 1 ? "" : "s"} forever?`));
      box.append(el("p", "", "There is no Recycle Bin to send them to here: they are gone forever."));
      const rowB = el("div", "row");
      const keep = el("button", "viv-btn", "Keep  (Esc)");
      const go = el("button", "viv-btn go", "Delete  (Enter)");
      keep.addEventListener("click", (e) => { e.stopPropagation(); closeAsk(); });
      go.addEventListener("click", (e) => { e.stopPropagation(); askGo(); });
      rowB.append(keep, go);
      box.append(rowB);
      ask.replaceChildren(box);
      root.classList.add("ask");
      return;
    }
    const j = await postOK(PURGE_URL, { folder: S.path, names });
    if (!j.ok) { flash(`could not delete them - ${j.error}`); return; }
    S.sel.clear();
    await rescan(true);
    toast(`${j.count} ${j.how === "recycle" ? "into the Recycle Bin" : "deleted forever"}`, false);
  }
  async function pickSelected() {
    const names = selNames();
    if (!names.length) return;
    const items = names.map((nm) => S.items.find((it) => it.name === nm)).filter(Boolean);
    const on = !items.every((it) => it.p);
    const folder = S.path;
    const j = await postOK(PICK_URL, { folder, names, on });
    if (!j.ok) { flash(`could not mark them - ${j.error}`); return; }
    remember({ type: "picks", folder, names: items.filter((it) => !!it.p !== on).map((it) => it.name), was: !on });
    await rescan(true);
    flash(on ? `\u2605  ${names.length} picked` : `${names.length} unpicked`);
  }

  /* The enhancer a render went through: its name and on or off, then its
     values. A switched-off one is read from the saved workflow. */
  function enhancerRows(m) {
    const out = [];
    for (const e of m.enhancers || []) {
      const name = String(e.title || "enhancer").replace(/\s*\([^)]*\)\s*$/, "");
      out.push([name, e.on ? "on" : "off", true]);
      if (!e.on) continue;
      for (const [k, v] of Object.entries(e.values || {})) {
        out.push([k, typeof v === "boolean" ? (v ? "true" : "false")
          : typeof v === "number" ? String(+v.toFixed(4)) : String(v)]);
      }
    }
    return out;
  }
  let hovT = null, hovFor = null;
  const hideHov = () => { clearTimeout(hovT); hovT = null; hovFor = null; hov.classList.remove("show"); };
  function placeHov(x, y) {
    const r = hov.getBoundingClientRect();
    let left = x + 16, top = y + 18;
    if (left + r.width > window.innerWidth - 8) left = x - r.width - 16;
    if (top + r.height > window.innerHeight - 8) top = Math.max(8, y - r.height - 12);
    hov.style.left = `${Math.max(8, left)}px`; hov.style.top = `${top}px`;
  }
  function paintHov(item, m) {
    const kids = [el("div", "nm", shortName(item.name))];
    if (!m) kids.push(el("div", "dim", "reading\u2026"));
    else if (!m.ok || !m.found) kids.push(el("div", "dim", m && m.ok ? "no render settings in this file" : "could not read it"));
    else {
      if ((m.triggers || []).length) {
        kids.push(el("h6", "", "trigger words"), el("div", "tw", m.triggers.join(", ")));
      }
      const rows = (m.loras || []).map((l) => [String(l.name).replace(/\\/g, "/").split("/").pop()
        .replace(/\.safetensors$/i, ""), String(l.strength)]);
      const st = (m.settings || []).map((x) => [x.label, x.value]);
      const er = enhancerRows(m);
      for (const [h, list] of [["loras", rows], ["settings", st], ["enhancer", er]]) {
        if (!list.length) continue;
        const t = el("table");
        list.forEach(([a, b, head], k) => {
          /* a line between one enhancer node and the next */
          const tr = el("tr", head && k ? "node" : "");
          tr.append(el("td", "", a), el("td", "", b));
          t.append(tr);
        });
        kids.push(el("h6", "", h), t);
      }
    }
    hov.replaceChildren(...kids);
  }
  async function showHov(item, x, y) {
    const key = S.path + "\u0001" + item.name + "\u0001" + item.v;
    hovFor = key;
    let m = metaCache.get(key) || null;
    paintHov(item, m);
    hov.classList.add("show");
    placeHov(x, y);
    if (m) return;
    try {
      const q = new URLSearchParams({ folder: S.path, name: item.name, v: String(item.v) });
      const res = await api.fetchApi(`${META_URL}?${q}`);
      m = await res.json();
    } catch (e) { m = { ok: false }; }
    if (m && m.ok) {
      metaCache.set(key, m);
      if (metaCache.size > 200) metaCache.delete(metaCache.keys().next().value);
    }
    if (hovFor !== key) return;
    paintHov(item, m);
    placeHov(S.mouse ? S.mouse.x : x, S.mouse ? S.mouse.y : y);
  }
  grid.addEventListener("pointermove", (e) => {
    if (marq && marq.box) { hideHov(); return; }
    const c = e.target.closest(".viv-cell");
    if (!c || e.target.closest(".pk, .ck") || S.mode === "large") { hideHov(); return; }
    const item = S.items[Number(c.dataset.i)];
    if (!item) { hideHov(); return; }
    const key = S.path + "\u0001" + item.name + "\u0001" + item.v;
    if (hov.classList.contains("show") && hovFor === key) { placeHov(e.clientX, e.clientY); return; }
    hideHov();
    const x = e.clientX, y = e.clientY;
    hovT = setTimeout(() => showHov(item, x, y), 450);
  });
  grid.addEventListener("pointerleave", hideHov);
  grid.addEventListener("pointerdown", hideHov);
  grid.addEventListener("scroll", hideHov, { passive: true });

  /* A picture dragged onto a folder - its band, or anywhere among its
     pictures - goes into that folder: moved, or copied with Ctrl held at
     the drop. A drag from a selected picture takes the whole selection,
     from any other picture that one alone. The selection box is drawn
     from the empty space of the grid. */
  let fdrag = null;
  /* light up the folder under the pointer: its band and its pictures */
  /* A point on screen in the grid's own coordinates. The node is drawn
     scaled with the canvas zoom, so screen pixels are not the grid's
     pixels - read without the scale, the selection box ran away from the
     pointer, further the further it was dragged. */
  function gridPt(e) {
    const r = grid.getBoundingClientRect();
    const k = grid.offsetWidth ? r.width / grid.offsetWidth : 1;
    return { x: (e.clientX - r.left) / k - grid.clientLeft + grid.scrollLeft,
             y: (e.clientY - r.top) / k - grid.clientTop + grid.scrollTop };
  }
  /* The folder a point belongs to: that of the last thing drawn before it
     in reading order - so the empty end of a row and the space under the
     last row count as that folder's, up to the next folder's band. */
  function dirAt(e) {
    const r = grid.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return null;
    const p = gridPt(e);
    let last = null;
    for (const el of grid.children) {
      if (!el.classList.contains("viv-group") && !el.classList.contains("viv-tile") && !el.classList.contains("viv-cell")) continue;
      if (el.classList.contains("hid")) continue;
      const t = el.offsetTop, b = t + el.offsetHeight;
      if (t > p.y) break;
      if (b <= p.y || el.offsetLeft <= p.x || el.classList.contains("viv-group")) last = el;
    }
    if (!last) return null;
    if (last.classList.contains("viv-cell")) {
      const g = groupOf(Number(last.dataset.i));
      return g ? g.dir : null;
    }
    return last.dataset.dir;
  }
  /* The folder under the pointer is lit as one block - band and pictures
     together - rather than every picture outlined, which read as all of
     them being selected. */
  let dropZone = null;
  function setDropDir(f, dir) {
    if (f.dir === dir) return;
    f.dir = dir;
    for (const x of grid.querySelectorAll(".drop")) x.classList.remove("drop");
    if (dropZone) { dropZone.remove(); dropZone = null; }
    if (dir == null) return;
    const heads = [...grid.querySelectorAll(".viv-group, .viv-tile")].filter((b) => b.dataset.dir === dir);
    if (!heads.length) return;
    if (heads[0].classList.contains("viv-tile")) { heads[0].classList.add("drop"); return; }
    const head = heads[0];
    let bottom = head.offsetTop + head.offsetHeight;
    const g = (S.groups || []).find((x) => x.dir === dir);
    if (g) {
      for (let k = g.start; k <= g.end; k++) {
        const c = S.cells[k];
        if (c && !c.classList.contains("hid")) bottom = Math.max(bottom, c.offsetTop + c.offsetHeight);
      }
    }
    dropZone = el("div", "viv-dropzone");
    Object.assign(dropZone.style, { top: `${head.offsetTop - 4}px`, height: `${bottom - head.offsetTop + 8}px` });
    grid.append(dropZone);
  }
  function paintFDrag(copy) {
    const f = fdrag;
    if (!f || !f.ghost) return;
    const n = f.names.length;
    const what = `${n} picture${n === 1 ? "" : "s"}`;
    const dir = f.dir;
    f.ghost.classList.toggle("copy", !!copy);
    f.ghost.classList.toggle("none", dir == null);
    if (dir == null) {
      f.ghost.innerHTML = `${what}<em>drop on a folder band - <b>Ctrl</b> copies</em>`;
      return;
    }
    const label = dir || "this folder";
    const stay = f.names.filter((nm) => dirOfName(nm) === dir).length;
    f.ghost.textContent = `${copy ? "copy" : "move"} ${what} → ${label}`;
    if (stay) f.ghost.append(el("em", "", stay === n ? "already in it" : `${stay} already in it`));
  }
  function endFDrag(e, cancel) {
    const f = fdrag;
    fdrag = null;
    if (!f) return;
    clearInterval(f.auto);
    if (!f.ghost) return;
    f.ghost.remove();
    root.classList.remove("fdragging");
    const dir = f.dir;
    setDropDir(f, null);
    for (const c of grid.querySelectorAll(".fsrc")) c.classList.remove("fsrc");
    marqDone = true; setTimeout(() => { marqDone = false; }, 0);
    if (cancel || dir == null) return;
    dropFiles(f.names, dir, !!(e && (e.ctrlKey || e.metaKey)));
  }
  async function dropFiles(names, dir, copy) {
    const list = names.filter((n) => dirOfName(n) !== dir);
    if (!list.length) { flash("already in that folder"); return; }
    const folder = S.path;
    const j = await postOK(COPY_URL, { folder, names: list, dest: joinDir(folder, dir), move: !copy });
    if (!j.ok) { flash(`could not ${copy ? "copy" : "move"} them - ${j.error}`); return; }
    const pairs = j.pairs || [];
    if (pairs.length) remember({ type: "drag", folder, dir, copy, pairs });
    if (!copy) S.sel.clear();
    await rescan(true);
    const parts = [`${j.count} ${copy ? "copied" : "moved"} to ${dir || "this folder"}`];
    if (j.there) parts.push(`${j.there} already there`);
    if ((j.failed || []).length) parts.push(`${j.failed.length} failed`);
    toast(parts.join("  \u00B7  "), pairs.length > 0);
  }
  grid.addEventListener("pointerdown", (e) => {
    fdrag = null;
    if (e.button !== 0 || S.mode === "large" || S.binView || !S.multi) return;
    if (e.target.closest(".pk, .ck")) return;
    const c = e.target.closest(".viv-cell");
    const item = c && S.items[Number(c.dataset.i)];
    if (!item || e.shiftKey || e.ctrlKey || e.metaKey) return;
    const names = S.sel.has(item.name)
      ? S.items.filter((it) => S.sel.has(it.name)).map((it) => it.name)
      : [item.name];
    fdrag = { names, x: e.clientX, y: e.clientY, id: e.pointerId, ghost: null, dir: null, cy: e.clientY, auto: 0 };
  });
  grid.addEventListener("pointermove", (e) => {
    const f = fdrag;
    if (!f) return;
    if (!f.ghost) {
      if (Math.hypot(e.clientX - f.x, e.clientY - f.y) < 8) return;
      f.ghost = el("div", "viv-fdrag");
      document.body.append(f.ghost);
      root.classList.add("fdragging");
      const going = new Set(f.names);
      S.cells.forEach((c, k) => c.classList.toggle("fsrc", !!(S.items[k] && going.has(S.items[k].name))));
      try { grid.setPointerCapture(f.id); } catch (err) { /* fine */ }
      hideHov();
      /* near the top or bottom edge the grid scrolls, to reach a folder
         that is out of sight */
      f.auto = setInterval(() => {
        const r = grid.getBoundingClientRect();
        const edge = Math.min(48, r.height / 5);
        if (f.cy < r.top + edge) grid.scrollTop -= 14;
        else if (f.cy > r.bottom - edge) grid.scrollTop += 14;
      }, 30);
    }
    f.cy = e.clientY;
    Object.assign(f.ghost.style, { left: `${e.clientX + 14}px`, top: `${e.clientY + 16}px` });
    const hit = document.elementFromPoint(e.clientX, e.clientY);
    const dir = hit && grid.contains(hit) ? dirAt(e) : null;
    setDropDir(f, dir == null ? null : dir);
    paintFDrag(e.ctrlKey || e.metaKey);
  });
  grid.addEventListener("pointerup", (e) => endFDrag(e, false));
  grid.addEventListener("pointercancel", (e) => endFDrag(e, true));
  for (const ev of ["keydown", "keyup"]) {
    window.addEventListener(ev, (e) => {
      if (!fdrag || !fdrag.ghost) return;
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); endFDrag(e, true); return; }
      if (e.key === "Control" || e.key === "Meta") paintFDrag(ev === "keydown");
    }, true);
  }

  /* A drag across the grid draws a box; whatever it touches is selected.
     With Shift held it is added to the selection; with Ctrl held - from
     anywhere, a picture too - what it touches is unselected. */
  let marq = null, marqDone = false;
  grid.addEventListener("pointerdown", (e) => {
    if (fdrag) return;
    if (e.button !== 0 || S.mode === "large") return;
    if (e.target.closest(".pk, .ck, .viv-group, .viv-tile")) return;
    const p0 = gridPt(e);
    if (!(e.ctrlKey || e.metaKey) && e.target.closest(".viv-cell")) return;
    marq = { x: p0.x, y: p0.y, add: e.shiftKey, sub: e.ctrlKey || e.metaKey,
             base: new Set(S.sel), box: null, id: e.pointerId };
  });
  grid.addEventListener("pointermove", (e) => {
    if (!marq) return;
    const { x, y } = gridPt(e);
    if (!marq.box) {
      if (Math.hypot(x - marq.x, y - marq.y) < 8) return;
      marq.box = el("div", "viv-marq");
      grid.append(marq.box);
      try { grid.setPointerCapture(marq.id); } catch (err) { /* fine */ }
    }
    const l = Math.min(x, marq.x), t = Math.min(y, marq.y);
    const w = Math.abs(x - marq.x), h = Math.abs(y - marq.y);
    Object.assign(marq.box.style, { left: `${l}px`, top: `${t}px`, width: `${w}px`, height: `${h}px` });
    S.sel = new Set(marq.add || marq.sub ? marq.base : []);
    marq.box.classList.toggle("sub", !!marq.sub);
    S.cells.forEach((c, k) => {
      if (c.classList.contains("hid")) return;
      const cl = c.offsetLeft, ct = c.offsetTop;
      if (cl < l + w && cl + c.offsetWidth > l && ct < t + h && ct + c.offsetHeight > t) {
        if (marq.sub) S.sel.delete(S.items[k].name); else S.sel.add(S.items[k].name);
      }
    });
    markSel();
  });
  const endMarq = () => {
    if (!marq) return;
    if (marq.box) { marq.box.remove(); marqDone = true; setTimeout(() => { marqDone = false; }, 0); }
    marq = null;
  };
  grid.addEventListener("pointerup", endMarq);
  grid.addEventListener("pointercancel", endMarq);

  /* ---- the bin */
  function setBin(on) {
    if (!!on === S.binView) return;
    S.binView = !!on;
    S.sel.clear(); S.selAnchor = -1;
    S.current = -1;
    S.pin = null;
    S.gen += 1;
    if (S.mode === "large") setMode("grid");
    paintControls();
    setEmpty(S.binView ? "opening the bin\u2026" : "reading the folder\u2026");
    const gen = S.gen;
    S.scan = doRescan(true, null, gen).catch((e) => console.error(e));
    return S.scan;
  }

  async function restoreAt(i) {
    const item = S.items[i];
    if (!item) return;
    const folder = S.path;
    const land = neighbour(i);
    const j = await postOK(UNTRASH_URL, { folder, names: [item.name] });
    if (!j.ok || !(j.back || []).length) { flash(`could not restore it - ${j.error || "not found"}`); return; }
    remember({ type: "untrash", folder, back: j.back });
    if (S.pin === item.name) S.pin = null;
    await rescan(true, land);
    toast(`restored  ${shortName(j.back[0])}`, true);
  }

  async function restoreAll() {
    if (!S.binView || !S.items.length) return;
    const folder = S.path;
    const j = await postOK(UNTRASH_URL, { folder, names: S.items.map((it) => it.name) });
    if (!j.ok) { flash(`could not restore them - ${j.error}`); return; }
    const back = j.back || [];
    if (back.length) remember({ type: "untrash", folder, back });
    await rescan(true);
    toast(`${back.length} restored`, !!back.length);
  }

  async function purgeAt(i, sure) {
    const item = S.items[i];
    if (!item) return;
    if (S.bin !== "recycle" && !sure) {
      askGo = () => { closeAsk(); purgeAt(i, true); };
      const box = el("div", "viv-ask-box");
      box.append(el("h3", "", `Delete ${shortName(item.name)} forever?`));
      box.append(el("p", "", "There is no Recycle Bin to send it to here: it is gone forever."));
      const rowB = el("div", "row");
      const keep = el("button", "viv-btn", "Keep  (Esc)");
      const go = el("button", "viv-btn go", "Delete  (Enter)");
      keep.addEventListener("click", (e) => { e.stopPropagation(); closeAsk(); });
      go.addEventListener("click", (e) => { e.stopPropagation(); askGo(); });
      rowB.append(keep, go);
      box.append(rowB);
      ask.replaceChildren(box);
      root.classList.add("ask");
      return;
    }
    const land = neighbour(i);
    const j = await postOK(PURGE_URL, { folder: S.path, names: [item.name] });
    if (!j.ok || !j.count) { flash(`could not delete it - ${j.error || "not found"}`); return; }
    if (S.pin === item.name) S.pin = null;
    await rescan(true, land);
    toast(`${shortName(item.name)} ${j.how === "recycle" ? "into the Recycle Bin" : "deleted forever"}`, false);
  }

  /* Into the _deleted folder beside it - out of sight, not gone. In the
     bin, Delete is the way back out. */
  async function deleteAt(i) {
    if (S.binView) return restoreAt(i);
    const item = S.items[i];
    if (!item) return;
    const folder = S.path;
    const land = neighbour(i);
    const j = await postOK(DELETE_URL, { folder, names: [item.name] });
    if (!j.ok || !(j.moved || []).length) { flash(`could not delete it - ${j.error || "not found"}`); return; }
    remember({ type: "del", folder, items: j.moved, asA: S.pin === item.name && i !== S.current });
    if (S.fresh === item.name) S.fresh = "";
    if (S.pin === item.name && i !== S.current) {
      /* A deleted: the next picture takes its place, B stays */
      S.pin = land;
      await rescan(true);
    } else {
      if (S.pin === item.name) S.pin = null;
      await rescan(true, land);
    }
    toast(`deleted  ${shortName(item.name)}`, true);
  }

  async function undo() {
    const u = S.undo.pop();
    if (!u) { flash("nothing to undo"); return; }
    const here = normFolder(u.folder) === normFolder(S.path);
    if (u.type === "picks") {
      if (!u.names.length) { flash("nothing to undo"); return; }
      const j = await postOK(PICK_URL, { folder: u.folder, names: u.names, on: u.was });
      if (!j.ok) { flash(`could not undo the picks - ${j.error}`); return; }
      if (here) await rescan(true);
      toast(u.was ? `${u.names.length} picked again` : `${u.names.length} unpicked`, false);
      return;
    }
    if (u.type === "drag") {
      /* a drag onto a folder: moved ones go home, copies go to the bin */
      let n = 0, err = "";
      if (u.copy) {
        const j = await postOK(DELETE_URL, { folder: u.folder, names: u.pairs.map((p) => joinRel(u.dir, p.to)) });
        if (j.ok) n = (j.moved || []).length; else err = j.error;
      } else {
        const by = new Map();
        for (const p of u.pairs) {
          const h = dirOfName(p.name);
          if (!by.has(h)) by.set(h, { names: [], rename: [] });
          by.get(h).names.push(joinRel(u.dir, p.to));
          by.get(h).rename.push(shortName(p.name));
        }
        for (const [h, list] of by) {
          const j = await postOK(COPY_URL, { folder: u.folder, names: list.names, rename: list.rename, dest: joinDir(u.folder, h), move: true });
          if (j.ok) n += j.count || 0; else err = j.error;
        }
      }
      if (here) await rescan(true);
      if (!n) { flash(`could not undo it - ${err || "not found"}`); return; }
      toast(u.copy ? `${n} cop${n === 1 ? "y" : "ies"} taken back` : `${n} moved back`, false);
      return;
    }
    if (u.type === "untrash") {
      const j = await postOK(DELETE_URL, { folder: u.folder, names: u.back });
      if (!j.ok || !(j.moved || []).length) { flash(`could not put it back in the bin - ${j.error || "not found"}`); return; }
      if (here) await rescan(true, S.binView ? j.moved[0].stash : null);
      toast(j.moved.length === 1 ? `back in the bin  ${shortName(j.moved[0].name)}` : `${j.moved.length} back in the bin`, false);
      return;
    }
    if (u.type === "del") {
      const j = await postOK(RESTORE_URL, { folder: u.folder, items: u.items });
      if (!j.ok || !(j.back || []).length) {
        flash(`could not bring it back - ${j.ok ? "its name is taken, or the deleted ones were emptied" : j.error}`);
        return;
      }
      if (here && u.asA && comparing()) { S.pin = j.back[0]; await rescan(true); }
      else if (here) await rescan(true, j.back[0]);
      toast(`brought back  ${shortName(j.back[0])}`, false);
      return;
    }
    const j = await postOK(PICK_URL, { folder: u.folder, names: [u.name], on: u.was });
    if (!j.ok) { flash(`could not undo the pick - ${j.error}`); return; }
    if (here) await rescan(true, u.name);
    toast(u.was ? `picked again  ${shortName(u.name)}` : `unpicked  ${shortName(u.name)}`, false);
  }

  function setPicksOnly(on) {
    P.viv_picks = !!on;
    S.current = -1;
    if (S.mode === "large" && !S.items.some((it) => it.p)) setMode("grid");
    paintControls();
    rescan(true).then(() => flash(on ? `\u2605  picks only - ${S.items.length} of ${S.total}` : "everything again"));
  }

  /* Emptying is the one step that cannot be taken back from here, so it is
     asked about - inside the viewer, not with a browser dialog that would
     stop the page. */
  const asking = () => root.classList.contains("ask");
  function closeAsk() { root.classList.remove("ask"); ask.textContent = ""; }
  function askEmpty() {
    if (!S.trash) return;
    askGo = doEmpty;
    const n = S.trash;
    const box = el("div", "viv-ask-box");
    box.append(el("h3", "", `Empty ${n} deleted picture${n === 1 ? "" : "s"}?`));
    box.append(el("p", "", `They are in the _deleted folders of ${S.multi ? "this folder and the folders inside it" : "this folder"}. `
      + (S.bin === "recycle"
        ? "They go to the Recycle Bin - Ctrl+Z will not bring them back after this."
        : "There is no Recycle Bin to send them to here: they are gone forever.")));
    const rowB = el("div", "row");
    const keep = el("button", "viv-btn", "Keep  (Esc)");
    const go = el("button", "viv-btn go", "Empty  (Enter)");
    keep.addEventListener("click", (e) => { e.stopPropagation(); closeAsk(); });
    go.addEventListener("click", (e) => { e.stopPropagation(); doEmpty(); });
    rowB.append(keep, go);
    box.append(rowB);
    ask.replaceChildren(box);
    root.classList.add("ask");
  }
  async function doEmpty() {
    closeAsk();
    const j = await postOK(EMPTY_URL, { folder: S.path });
    if (!j.ok) { flash(`could not empty them - ${j.error}`); return; }
    /* what was emptied cannot be brought back from here any more */
    S.undo = S.undo.filter((u) => u.type !== "del");
    if (S.binView) await setBin(false);
    else await rescan(true);
    toast(`${j.count} emptied ${j.how === "recycle" ? "into the Recycle Bin" : "forever"}`, false);
  }
  ask.addEventListener("click", (e) => { if (e.target === ask) closeAsk(); });

  /* ---- copying the picks
     Into one folder, side by side, whatever folders they came from - the
     way a few keepers of a day are gathered for the upscale. The place is
     a folder the viewer may open - input, output or one of the allowed
     ones - and a name under it, made if it is not there. */
  let rootsCache = null;
  async function roots() {
    if (rootsCache) return rootsCache;
    try {
      const res = await api.fetchApi(ROOTS_URL);
      const j = await res.json();
      rootsCache = (j && j.roots) || [];
    } catch (e) { rootsCache = []; }
    return rootsCache;
  }
  const readDests = () => {
    try { const v = JSON.parse(localStorage.getItem(DEST_KEY) || "[]"); return Array.isArray(v) ? v : []; }
    catch (e) { return []; }
  };
  const pushDest = (d) => {
    try {
      const list = [d, ...readDests().filter((x) => x.path !== d.path)].slice(0, DEST_MAX);
      localStorage.setItem(DEST_KEY, JSON.stringify(list));
    } catch (e) { /* fine */ }
  };
  const joinPath = (base, sub) => {
    const sep = base.includes("\\") ? "\\" : "/";
    const tail = String(sub || "").trim().replace(/[\\/]+/g, sep).replace(/^[\\/]+|[\\/]+$/g, "");
    return tail ? base.replace(/[\\/]+$/, "") + sep + tail : base;
  };
  let askGo = null;

  async function askCopy(chosen) {
    const fromSel = Array.isArray(chosen);
    const picks = fromSel ? chosen.map((nm) => S.items.find((it) => it.name === nm)).filter(Boolean)
      : S.all.filter((it) => it.p);
    const noun = fromSel ? "picture" : "pick";
    if (!picks.length) { flash(fromSel ? "nothing selected" : "no picks here - P marks the picture on screen"); return; }
    const rs = await roots();
    if (!rs.length) { flash("could not read the folders this viewer may open"); return; }
    const last = readDests()[0];
    const box = el("div", "viv-ask-box copy");
    box.append(el("h3", "", `Copy ${picks.length} ${noun}${picks.length === 1 ? "" : "s"}`));
    box.append(el("p", "", "Into one folder, side by side. A folder that is not there yet is made; "
      + "a picture already there under the same name is left alone."));
    box.append(el("div", "viv-cp-lab", "into"));
    const r1 = el("div", "viv-cp-row");
    const sel = el("select");
    rs.forEach((r, k) => {
      const o = el("option", "", r.name.length > 40 ? "\u2026" + r.name.slice(-38) : r.name);
      o.value = String(k);
      sel.append(o);
    });
    const sub = el("input");
    sub.type = "text";
    sub.spellcheck = false;
    sub.placeholder = "folder name - the series, say";
    const brw = el("button", "viv-btn", "Browse");
    r1.append(sel, sub, brw);
    box.append(r1);
    const to = el("div", "viv-cp-to", "");
    box.append(to);
    /* where it goes, from a full path: the root it sits in, and the rest */
    const setFull = (full) => {
      const n = (x) => String(x).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
      let best = -1, len = -1;
      rs.forEach((r, k) => {
        const b = n(r.path);
        if ((n(full) === b || n(full).startsWith(b + "/")) && b.length > len) { best = k; len = b.length; }
      });
      if (best < 0) return;
      sel.value = String(best);
      sub.value = String(full).slice(rs[best].path.replace(/[\\/]+$/, "").length).replace(/^[\\/]+/, "");
      paintTo();
    };
    const dest = () => joinPath(rs[Number(sel.value) || 0].path, sub.value);
    const paintTo = () => { to.textContent = "\u2192  " + dest(); };
    const inputAt = rs.findIndex((r) => r.name === "input");
    if (last && last.path) setFull(last.path);
    else sel.value = String(inputAt >= 0 ? inputAt : 0);
    paintTo();
    sel.addEventListener("change", paintTo);
    sub.addEventListener("input", paintTo);
    const recent = readDests();
    if (recent.length) {
      box.append(el("div", "viv-cp-lab", "recent"));
      const rec = el("div", "viv-cp-rec");
      for (const d of recent) {
        const b = el("button", "", d.label || d.path);
        b.title = d.path;
        b.addEventListener("click", (e) => { e.stopPropagation(); setFull(d.path); });
        rec.append(b);
      }
      box.append(rec);
    }
    const r2 = el("div", "viv-cp-row");
    const segM = el("span", "viv-seg");
    const bCopy = el("button", "viv-btn on", "Copy");
    const bMove = el("button", "viv-btn", "Move");
    bCopy.title = "The picks stay where they are; copies go into the folder";
    bMove.title = "The picks leave this folder for the other one, picked still";
    segM.append(bCopy, bMove);
    let move = false;
    const paintMode = () => {
      bCopy.classList.toggle("on", !move); bMove.classList.toggle("on", move);
      go.textContent = `${move ? "Move" : "Copy"} ${picks.length}  (Enter)`;
    };
    bCopy.addEventListener("click", (e) => { e.stopPropagation(); move = false; paintMode(); });
    bMove.addEventListener("click", (e) => { e.stopPropagation(); move = true; paintMode(); });
    r2.append(segM);
    box.append(r2);
    const rowB = el("div", "row");
    const keep = el("button", "viv-btn", "Cancel  (Esc)");
    const go = el("button", "viv-btn go gold", "");
    paintMode();
    rowB.append(keep, go);
    box.append(rowB);
    keep.addEventListener("click", (e) => { e.stopPropagation(); closeAsk(); });
    const run = async () => {
      const where = dest();
      closeAsk();
      const j = await postOK(COPY_URL, { folder: S.path, names: picks.map((it) => it.name), dest: where, move });
      if (!j.ok) { flash(`could not ${move ? "move" : "copy"} them - ${j.error}`); return; }
      const label = rs[Number(sel.value) || 0].name + (sub.value.trim() ? " \u203A " + sub.value.trim() : "");
      pushDest({ path: j.dest || where, label });
      if (fromSel) S.sel.clear();
      if (move || fromSel) await rescan(true);
      const parts = [`${j.count} ${move ? "moved" : "copied"} to ${label}`];
      if (j.there) parts.push(`${j.there} already there`);
      if ((j.failed || []).length) parts.push(`${j.failed.length} failed`);
      toast(parts.join("  \u00B7  "), false);
    };
    askGo = run;
    go.addEventListener("click", (e) => { e.stopPropagation(); run(); });
    /* typing in the box: Enter copies, Esc closes - and the keys stay here,
       not with the graph */
    for (const f of [sub, sel]) {
      f.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter") { e.preventDefault(); run(); }
        if (e.key === "Escape") { e.preventDefault(); closeAsk(); }
      });
    }
    brw.addEventListener("click", (e) => {
      e.stopPropagation();
      openFolderPicker({
        start: dest(),
        title: "Copy the picks into",
        onPick: (p) => setFull(p),
      });
    });
    ask.replaceChildren(box);
    root.classList.add("ask");
    setTimeout(() => { sub.focus(); sub.select(); }, 30);
  }

  function openFolder(raw, select) {
    S.binView = false;
    S.sel.clear(); S.selAnchor = -1;
    S.filter = null; filterBox.value = ""; filterBox.classList.remove("on", "bad");
    P.viv_folder = String(raw || "").trim();
    S.current = -1;
    S.fresh = "";
    S.gen += 1;
    if (S.mode === "large" && !select) setMode("grid");
    paintControls();
    if (!S.items.length || S.busy) setEmpty("reading the folder\u2026");
    node.setDirtyCanvas && node.setDirtyCanvas(true, true);
    const gen = S.gen;
    S.scan = doRescan(true, select, gen).catch((e) => console.error(e));
    return S.scan;
  }

  // ---- full screen
  function isFull() { return document.fullscreenElement === root; }
  function toggleFull() {
    if (isFull()) { document.exitFullscreen().catch(() => {}); return; }
    if (!S.items.length) return;
    if (S.mode !== "large") setMode("large");
    const go = root.requestFullscreen || root.webkitRequestFullscreen;
    if (go) Promise.resolve(go.call(root)).catch((e) => flash(`full screen refused: ${e && e.message || e}`));
  }
  let fsKeysT = null;
  function onFullChange() {
    root.classList.remove("idle");
    clearTimeout(fsKeysT);
    fsKeys.classList.toggle("show", isFull());
    if (isFull()) fsKeysT = setTimeout(() => fsKeys.classList.remove("show"), 3500);
    const item = S.items[S.current];
    if (item && S.actual) requestAnimationFrame(() => sizeZoom(item, scrollFraction()));
    requestAnimationFrame(() => { updateZoomLabel(); updateOSD(); });
  }
  document.addEventListener("fullscreenchange", onFullChange);
  let idleTimer = null;
  root.addEventListener("pointermove", () => {
    root.classList.remove("idle");
    clearTimeout(idleTimer);
    if (isFull()) idleTimer = setTimeout(() => { if (isFull()) root.classList.add("idle"); }, 1800);
  });

  // ---- input
  grid.addEventListener("click", (e) => {
    if (marqDone) { marqDone = false; return; }
    const c = e.target.closest(".viv-cell");
    if (!c) return;
    const i = Number(c.dataset.i);
    if (e.target.closest(".pk")) {
      e.stopPropagation();
      togglePick(i);
      return;
    }
    /* Shift first, so a Shift+click on a picture's box fills the run
       from the box ticked before it, as on the picture itself */
    if (e.shiftKey) {
      e.stopPropagation();
      selectRange(S.selAnchor >= 0 ? S.selAnchor : (S.current >= 0 ? S.current : i), i);
      return;
    }
    if (e.target.closest(".ck") || e.ctrlKey || e.metaKey) {
      e.stopPropagation();
      toggleSel(i);
      return;
    }
    setIndex(Number(c.dataset.i));
    setMode("large");
    root.focus({ preventScroll: true });
  });

  /* The click that brings the browser window back from another app - another
     monitor - only wakes it. The keys follow the pointer again from then on,
     and the picture stays as it was instead of dropping back to the grid or
     zooming. Browsers fire the window's focus before or after the press, so
     both orders count. */
  const WAKE_MS = 450;
  let wokeAt = -1e9, downAt = -1e9, wakeDown = false;
  const onWake = () => {
    wokeAt = performance.now();
    if (wokeAt - downAt < WAKE_MS) wakeDown = true;
  };
  window.addEventListener("focus", onWake);
  root.addEventListener("pointerdown", () => {
    downAt = performance.now();
    wakeDown = !document.hasFocus() || downAt - wokeAt < WAKE_MS;
  }, true);
  const wakeClick = () => { const w = wakeDown; wakeDown = false; return w; };

  let drag = null, dragMoved = false;
  for (const pane of [stage, stageA]) {
    pane.addEventListener("click", (e) => {
      if (!isFull() || S.mode !== "large") return;
      if (wakeClick()) { e.stopPropagation(); return; }
      if (dragMoved) { dragMoved = false; return; }
      e.stopPropagation();
      S.mouse = { x: e.clientX, y: e.clientY };
      clickZoom(e.ctrlKey || e.metaKey || e.altKey ? -1 : 1);
    });
    pane.addEventListener("pointerdown", (e) => {
      const zoomed = pane === stageA && apart() ? S.zoomA != null : S.actual;
      if (!zoomed || e.button !== 0) return;
      drag = { pane, x: e.clientX, y: e.clientY, l: pane.scrollLeft, t: pane.scrollTop, moved: false,
               z: (pane.getBoundingClientRect().width / (pane.clientWidth || 1)) || 1 };
      if (!isFull()) pane.classList.add("drag");
      try { pane.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      e.preventDefault();
    });
    pane.addEventListener("pointermove", (e) => {
      S.mouse = { x: e.clientX, y: e.clientY };
      if (!drag || drag.pane !== pane) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) { drag.moved = true; pane.classList.add("drag"); }
      pane.scrollLeft = drag.l - dx / drag.z;
      pane.scrollTop = drag.t - dy / drag.z;
    });
    const endDrag = (e) => {
      if (!drag || drag.pane !== pane) return;
      const moved = drag.moved;
      drag = null;
      pane.classList.remove("drag");
      try { pane.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      dragMoved = moved;
      if (!moved && !isFull()) { if (pane === stageA && apart()) setZoomA(null); else setActual(false); }
    };
    pane.addEventListener("pointerup", endDrag);
    pane.addEventListener("pointercancel", endDrag);
  }
  for (const b of cbar.querySelectorAll("button")) {
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      const k = b.dataset.k;
      if (k === "W") toggleWipe();
      else if (k === "X") swapPin();
      else if (k === "L") toggleLink();
      else if (k === "C") togglePin();
    });
  }
  let cbarT = null;
  function wakeBar() {
    cbar.classList.remove("dim");
    clearTimeout(cbarT);
    cbarT = setTimeout(() => cbar.classList.add("dim"), 3500);
  }
  root.addEventListener("pointermove", () => { if (comparing()) wakeBar(); });
  function toggleWipe() {
    if (!comparing()) return;
    S.cmpMode = S.cmpMode === "wipe" ? "side" : "wipe";
    paintCompare();
    if (S.actual) { const it = S.items[S.current]; if (it) sizeZoom(it, scrollFraction()); }
    wakeBar();
  }
  /* the wipe line is dragged across; where it stands is kept */
  let wiping = false;
  wipeKnob.addEventListener("pointerdown", (e) => {
    wiping = true;
    try { wipeKnob.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    e.preventDefault(); e.stopPropagation();
  });
  wipeKnob.addEventListener("pointermove", (e) => {
    if (!wiping) return;
    const r = large.getBoundingClientRect();
    S.wipeAt = Math.max(0, Math.min(100, ((e.clientX - r.left) / (r.width || 1)) * 100));
    root.style.setProperty("--wipe", `${S.wipeAt}%`);
  });
  const endWipe = () => { wiping = false; };
  wipeKnob.addEventListener("pointerup", endWipe);
  wipeKnob.addEventListener("pointercancel", endWipe);
  big.addEventListener("click", () => {
    if (wakeClick()) return;
    if (!S.actual && !isFull()) setMode("grid");
  });
  root.addEventListener("pointermove", (e) => { S.mouse = { x: e.clientX, y: e.clientY }; ctlCursor(e.ctrlKey || e.metaKey || e.altKey); });
  /* Full screen: the pointer is a zoom-in glass, a zoom-out glass while
     Ctrl is held, and a closed hand while a zoomed picture is dragged. */
  function ctlCursor(on) { root.classList.toggle("ctl", !!on); }
  for (const ev of ["keydown", "keyup"]) {
    window.addEventListener(ev, (e) => {
      if (e.key === "Control" || e.key === "Meta" || e.key === "Alt") ctlCursor(ev === "keydown");
    }, true);
  }
  window.addEventListener("blur", () => ctlCursor(false));

  prev.addEventListener("click", (e) => { e.stopPropagation(); setIndex(S.current - 1); });
  next.addEventListener("click", (e) => { e.stopPropagation(); setIndex(S.current + 1); });
  modeBtn.addEventListener("click", () => setMode(S.mode === "large" ? "grid" : "large"));
  capPick.addEventListener("click", (e) => { e.stopPropagation(); togglePick(S.current); });
  capDel.addEventListener("click", (e) => { e.stopPropagation(); deleteAt(S.current); });
  pickBtn.addEventListener("click", () => setPicksOnly(!P.viv_picks));
  trashBtn.addEventListener("click", () => setBin(!S.binView));
  selAll.addEventListener("click", (e) => { e.stopPropagation(); selectAll(); });
  selPick.addEventListener("click", (e) => { e.stopPropagation(); pickSelected(); });
  selIdea.addEventListener("click", (e) => { e.stopPropagation(); sendToIdeaBox(ideaTargets()); });
  ideaBtn.addEventListener("click", (e) => { e.stopPropagation(); sendToIdeaBox(ideaTargets()); });
  selLabQ.addEventListener("click", (e) => { e.stopPropagation(); sendToLab(ideaTargets()); });
  labBtn.addEventListener("click", (e) => { e.stopPropagation(); sendToLab(ideaTargets()); });
  selCopy.addEventListener("click", (e) => { e.stopPropagation(); askCopy(selNames()); });
  selDel.addEventListener("click", (e) => { e.stopPropagation(); deleteSelected(); });
  selPurge.addEventListener("click", (e) => { e.stopPropagation(); purgeSelected(); });
  selClear.addEventListener("click", (e) => { e.stopPropagation(); clearSel(); });
  binBack.addEventListener("click", (e) => { e.stopPropagation(); setBin(false); });
  binRestore.addEventListener("click", (e) => { e.stopPropagation(); restoreAll(); });
  binEmpty.addEventListener("click", (e) => { e.stopPropagation(); askEmpty(); });
  capPurge.addEventListener("click", (e) => { e.stopPropagation(); purgeAt(S.current); });
  copyBtn.addEventListener("click", () => askCopy());
  capHist.addEventListener("click", (e) => { e.stopPropagation(); setHist(!P.viv_hist); });
  capClip.addEventListener("click", (e) => { e.stopPropagation(); setClip(!P.viv_clip); });
  capGuide.addEventListener("click", (e) => { e.stopPropagation(); setGuides((P.viv_guides | 0) + 1); });
  capClip.classList.toggle("on", !!P.viv_clip);
  capHist.classList.toggle("on", !!P.viv_hist);
  root.classList.toggle("hist", !!P.viv_hist);
  if (P.viv_guides) setTimeout(startGuides, 0);
  capMeta.addEventListener("click", (e) => { e.stopPropagation(); setMeta(!P.viv_meta); });
  capWf.addEventListener("click", (e) => { e.stopPropagation(); openWorkflow(S.items[S.current]); });
  capRot.addEventListener("click", (e) => { e.stopPropagation(); turn(e.shiftKey ? -1 : 1); });
  fsBtn.addEventListener("click", () => toggleFull());

  pathBox.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") { pathBox.blur(); openFolder(pathBox.value); }
    if (e.key === "Escape") { pathBox.value = P.viv_folder || ""; pathBox.blur(); }
  });
  pathBox.addEventListener("change", () => {
    if (pathBox.value.trim() !== (P.viv_folder || "")) openFolder(pathBox.value);
  });
  browseBtn.addEventListener("click", () => {
    openFolderPicker({
      start: S.path || P.viv_folder || "",
      title: "Folder for " + (node.title || "Visual Image Viewer"),
      onPick: (path, sort) => {
        /* Date or Name in the picker carries over: the folders show here in
           the order they were chosen in - newest work first with Date \u2193 */
        if (sort && sort.by === "date") P.viv_sort = sort.desc ? "newest" : "oldest";
        else if (sort && sort.by === "name") P.viv_sort = "name";
        paintControls();
        S.preferRel = true;
        openFolder(path);
      },
      merge: true,
    });
  });
  followBtn.addEventListener("click", () => {
    P.viv_follow = !P.viv_follow;
    paintControls();
    flash(P.viv_follow ? "following saves - each new picture shows as it lands" : "follow off");
  });
  listBtn.addEventListener("click", () => {
    const dirs = dirsOnShow();
    setList(dirs, !dirs.every(isList));
  });
  deepBtn.addEventListener("click", () => {
    P.viv_deep = !P.viv_deep;
    paintControls();
    rescan(true);
  });
  /* Name and Newest are two switches; at least one stays on. */
  const setSort = (name, date) => {
    if (!name && !date) return;
    P.viv_sort = name && date ? "name_" + date : date || "name";
    paintControls();
    rescan(true);
  };
  byName.addEventListener("click", () => setSort(!nameOn(), dateWay()));
  byNew.addEventListener("click", () => {
    const d = dateWay();
    /* newest, then oldest, then off - off only while Name is on */
    const next = d === "newest" ? "oldest" : d === "oldest" ? (nameOn() ? null : "newest") : "newest";
    setSort(nameOn(), next);
  });

  function thumbZoom(dir) {
    P.viv_thumb = Math.max(THUMB_MIN, Math.min(THUMB_MAX, P.viv_thumb + dir * THUMB_STEP));
    paintControls();
    const src = (i) => thumbURL(S.items[i]);
    for (let i = 0; i < S.cells.length; i++) {
      const img = S.cells[i].querySelector("img");
      if (img && img.src !== new URL(src(i), location.href).href) img.src = src(i);
    }
  }
  zoomOut.addEventListener("click", () => thumbZoom(-1));
  zoomIn.addEventListener("click", () => thumbZoom(1));

  /* The wheel belongs to this panel while the pointer is on it. In the large
     view it steps through the folder, throttled so one flick of a
     free-spinning wheel moves one picture rather than twenty. */
  root.addEventListener("wheel", (e) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault(); e.stopPropagation();
      if (S.mode === "large") { S.mouse = { x: e.clientX, y: e.clientY }; stepZoom(e.deltaY > 0 ? -1 : 1); }
      else thumbZoom(e.deltaY > 0 ? -1 : 1);
      return;
    }
    if (S.mode === "large" && (target() === "A" ? S.zoomA != null : S.actual)) { e.stopPropagation(); return; }
    if (S.mode === "large") {
      e.preventDefault(); e.stopPropagation();
      const now = performance.now();
      if (now - S.lastWheel < 140) return;
      S.lastWheel = now;
      S.mouse = { x: e.clientX, y: e.clientY };
      const d = e.deltaY > 0 || e.deltaX > 0 ? 1 : -1;
      if (pointerSide() === "A") setPinIndex(pinIndex() + d);
      else setIndex(S.current + d);
      return;
    }
    e.stopPropagation();
  }, { passive: false });

  root.addEventListener("mouseenter", () => { S.hovered = true; });
  root.addEventListener("mouseleave", () => { S.hovered = false; });
  for (const ev of ["pointerdown", "mousedown"]) root.addEventListener(ev, (e) => e.stopPropagation());

  /* Right click on a picture, with a Series Book on the canvas: make it the
     picture of the Book's open prompt or open series. The Book does the
     rest - it listens for "leiel-set-picture". */
  let ctx = null;
  const ctxClose = () => {
    if (ctx) { ctx.remove(); ctx = null; }
    document.removeEventListener("pointerdown", ctxOut, true);
  };
  const ctxOut = (e) => { if (ctx && !ctx.contains(e.target)) ctxClose(); };
  root.addEventListener("contextmenu", (e) => {
    const t = e.target instanceof Element ? e.target : null;
    const holder = t ? t.closest(".viv-cell, .viv-stage") : null;
    const img = holder ? holder.querySelector("img") : null;
    if (!img || !img.src || /^data:,?$/.test(img.src)) return;
    /* which picture: a grid cell carries its index, the large view is the
       current one */
    const item = holder.classList.contains("viv-cell") ? S.items[Number(holder.dataset.i)]
      : (holder.classList.contains("b") ? S.items[S.current] : null);
    const book = !!document.querySelector(".lsb-pbox");   // a Series Book open
    if (!book && !item) return;
    e.preventDefault();
    e.stopPropagation();
    ctxClose();
    /* the Idea Box: this picture - or, when it is one of several selected,
       all of them - into My works */
    const many = item && S.sel.size > 1 && S.sel.has(item.name);
    const ideaItems = many ? S.items.filter((it) => S.sel.has(it.name)) : item ? [item] : [];
    const escH = (x) => String(x).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
    ctx = el("div", "viv-ctx");
    ctx.innerHTML = (book ? `<div class="h">Series Book · set as thumbnail</div>`
      + `<div class="own"><button disabled data-to="own">Thumbnail of its scene<small>reading the picture...</small></button></div>`
      + `<div class="sep"></div>`
      + `<button data-to="prompt">Thumbnail of the open scene<small>the scene open in the Book now - on its card</small></button>`
      + `<button data-to="series">Thumbnail of the open series<small>the series open in the Book now - beside its note and in Files</small></button>` : "")
      + (ideaItems.length ? (book ? `<div class="sep ib"></div>` : "") + `<div class="h ib">Idea Box</div>`
        + `<button class="ib" data-idea="1">→ Idea Box<small>${many ? `the ${ideaItems.length} selected` : "this picture"} → My works › ${escH(openName() || "Image Viewer")}</small></button>` : "");
    if (ideaItems.length) {
      ctx.insertAdjacentHTML("beforeend", `<div class="sep ib"></div><div class="h lq">Series Lab</div>`
        + `<button class="lq" data-lab="1">→ Lab<small>${many ? `the ${ideaItems.length} selected` : "this picture"} → a recipe on the bench, made the same way</small></button>`);
      ctx.querySelector("button[data-lab]").addEventListener("click", (ev) => { ev.stopPropagation(); ctxClose(); sendToLab(ideaItems); });
    }
    const ib = ctx.querySelector("button[data-idea]");
    if (ib) ib.addEventListener("click", (ev) => { ev.stopPropagation(); ctxClose(); sendToIdeaBox(ideaItems); });
    const src = img.src;
    let meta = null;
    const send = (to) => {
      window.dispatchEvent(new CustomEvent("leiel-set-picture", { detail: {
        src, to,
        prompt_name: meta ? meta.prompt_name : "", series_name: meta ? meta.series_name : "" } }));
      flash(to === "series" ? "thumbnail of the open series" : to === "own-series" ? `thumbnail of series "${meta.series_name}"`
        : to === "own" ? `thumbnail of scene "${meta.prompt_name}"` : "thumbnail of the open scene");
      ctxClose();
    };
    const wire = () => {
      for (const b of ctx.querySelectorAll("button:not([disabled]):not([data-idea]):not([data-lab])")) {
        if (b.__wired) continue;
        b.__wired = true;
        b.addEventListener("click", (ev) => { ev.stopPropagation(); send(b.dataset.to); });
      }
    };
    wire();
    const box = ctx;
    if (item && book) {
      metaOf(item).then((m) => {
        if (ctx !== box) return;
        meta = m && m.prompt_name ? m : null;
        const own = box.querySelector(".own");
        if (!meta) {
          own.innerHTML = `<button disabled>Thumbnail of its scene<small>this picture was not made from a Book scene</small></button>`;
          return;
        }
        const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
        own.innerHTML = `<button data-to="own">Thumbnail of its scene<small>${esc(meta.prompt_name)} - on its card</small></button>`
          + (meta.series_name ? `<button data-to="own-series">Thumbnail of its series<small>${esc(meta.series_name)} - beside its note and in Files</small></button>` : "");
        wire();
      }).catch(() => {});
    } else if (book) {
      box.querySelector(".own").remove();
      box.querySelector(".sep").remove();
    }
    ctx.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    ctx.addEventListener("contextmenu", (ev) => ev.preventDefault());
    document.body.appendChild(ctx);
    const r = ctx.getBoundingClientRect();
    ctx.style.left = Math.max(6, Math.min(e.clientX, innerWidth - r.width - 6)) + "px";
    ctx.style.top = Math.max(6, Math.min(e.clientY, innerHeight - r.height - 6)) + "px";
    setTimeout(() => document.addEventListener("pointerdown", ctxOut, true), 0);
  });

  /* Keys only while the pointer is over the panel, or in full screen.
     ComfyUI binds the arrows, Space, Escape and Enter to things of its own;
     taking them only under the pointer leaves those working everywhere else. */
  // ---- help
  const HINT_KEY = "leiel.viewer.hintDone";
  const hintDone = () => { try { return localStorage.getItem(HINT_KEY) === "1"; } catch (e) { return true; } };
  function dropHint() {
    hint.classList.remove("show");
    try { localStorage.setItem(HINT_KEY, "1"); } catch (e) { /* fine */ }
  }
  /* The one line of keys shows until the manual has been opened once, or
     the line is closed - after that the ? button is enough. */
  if (!hintDone()) hint.classList.add("show");
  hintX.addEventListener("click", (e) => { e.stopPropagation(); dropHint(); });
  function setHelp(on) {
    root.classList.toggle("help", on);
    qBtn.classList.toggle("on", on);
    if (on) dropHint();
  }
  const helpOpen = () => root.classList.contains("help");
  qBtn.addEventListener("click", () => setHelp(!helpOpen()));
  help.addEventListener("click", () => setHelp(false));
  help.addEventListener("wheel", (e) => e.stopPropagation());

  /* Delete is the viewer's key for pictures, so it never removes the viewer
     node itself: with the pointer on the viewer it deletes the picture or
     does nothing, and with the viewer selected anywhere else it is held back.
     Backspace deletes nodes, the viewer included - but only while the grid
     is on show: with a picture open it is the previous picture. */
  function viewerSelected() {
    const c = app.canvas;
    if (!c) return false;
    if (c.selected_nodes && c.selected_nodes[node.id]) return true;
    try { if (c.selectedItems && c.selectedItems.has && c.selectedItems.has(node)) return true; } catch (err) { /* fine */ }
    return false;
  }
  const SEL_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown",
                            "PageUp", "PageDown", "p", "P"]);
  function onlyViewerSelected() {
    if (!viewerSelected()) return false;
    const c = app.canvas;
    let count = 0;
    try {
      if (c.selectedItems && typeof c.selectedItems.size === "number") count = c.selectedItems.size;
      else if (c.selected_nodes) count = Object.keys(c.selected_nodes).length;
    } catch (err) { return false; }
    return count === 1;
  }
  /* Next or previous within the folder, round from one end to the other. */
  function loopStep(back, cur0, go) {
    const n = S.items.length;
    if (!n) return;
    const [lo, hi] = cur0 >= 0 ? scope(cur0) : [0, n - 1];
    const m = hi - lo + 1;
    const cur = cur0 < 0 ? (back ? lo : hi) : cur0;
    const to = lo + (((cur - lo + (back ? -1 : 1)) % m) + m) % m;
    go(to);
    if (m > 1 && (back ? to === hi : to === lo)) {
      flash(back ? "↺  round to the last" : "↻  round to the first");
    }
  }
  function onKey(e) {
    const t = e.target;
    const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
    /* With a picture open large and the viewer selected, Backspace is the
       previous picture even with the pointer elsewhere - it never removes
       the node from under the picture. In the grid it removes the node. */
    if (e.key === "Backspace" && !typing && !S.hovered && !isFull() && S.mode === "large"
        && S.items.length && !e.ctrlKey && !e.metaKey && !e.altKey && viewerSelected()) {
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      loopStep(true, S.current, (i) => setIndex(i, true));
      return;
    }
    if (e.key === "Delete" && !typing && !S.hovered && !isFull() && viewerSelected()) {
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      flash(S.mode === "large" ? "Delete is for pictures here - in the grid, Backspace removes the node"
        : "Delete is for pictures here - Backspace removes the node");
      return;
    }
    /* With the pointer elsewhere, a viewer that is the one node selected
       still takes the keys that only step through pictures - the moment it
       mattered most was reaching for the next picture and nothing moving.
       Everything the graph also uses (Space, Ctrl+C, Ctrl+Z, Delete) stays
       with the pointer on the viewer. */
    if (!S.hovered && !isFull()
        && !(SEL_KEYS.has(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey
             && !typing && onlyViewerSelected())) return;
    if (typing) return;
    if (e.key === "?" || helpOpen()) {
      // while the manual is open it has the keys: ? or Esc close it
      if (e.key === "?" || e.key === "Escape") setHelp(!helpOpen() && e.key === "?");
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      return;
    }
    if (asking()) {
      if (e.key === "Enter" && askGo) askGo();
      else if (e.key === "Escape") closeAsk();
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      return;
    }
    /* Ctrl+Z is the viewer's only while it has something to put back -
       otherwise it stays the graph's */
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === "z" || e.key === "Z")) {
      if (!S.undo.length) return;
      undo();
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      return;
    }
    /* Ctrl+C: the picture - unless text is selected, say in the prompt
       panel, which is copied as text the usual way */
    /* Alt+C: the picture alone, for a web page or a chat. Chrome keeps
       Ctrl+Shift+C for its own inspector and opens it before a page can
       stop it, so that key is still read but Alt+C is the one to use. */
    if (e.altKey && !e.ctrlKey && !e.metaKey && (e.code === "KeyC" || e.key === "c" || e.key === "C")) {
      if (S.current < 0 || !S.items[S.current]) return;
      copyPicture(S.items[S.current], true);
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === "c" || e.key === "C")) {
      const sel = window.getSelection && String(window.getSelection() || "");
      if (sel || S.current < 0 || !S.items[S.current]) return;
      copyPicture(S.items[S.current], e.shiftKey);
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      return;
    }
    /* with several selected in the grid, Delete, P and Esc act on them all,
       and Ctrl+A selects everything on show */
    if (S.mode !== "large" && !e.altKey) {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === "a" || e.key === "A") && S.items.length) {
        selectAll();
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        return;
      }
      if (S.sel.size && !e.ctrlKey && !e.metaKey) {
        let did = true;
        if (e.key === "Delete") { if (S.binView && e.shiftKey) purgeSelected(); else deleteSelected(); }
        else if (e.key === "Escape") clearSel();
        else if ((e.key === "p" || e.key === "P") && !e.shiftKey) { if (!S.binView) pickSelected(); }
        else did = false;
        if (did) { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); return; }
      }
    }
    if ((e.key === "p" || e.key === "P") && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      setPicksOnly(!P.viv_picks);
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      return;
    }
    if (!S.items.length) return;
    let handled = true;
    const n = S.items.length;
    /* comparing, the keys that step, pick or delete go to the picture under
       the pointer - A or B */
    const onA = S.mode === "large" && pointerSide() === "A";
    const cur0 = onA ? pinIndex() : S.current;
    const go = (i) => (onA ? setPinIndex(i) : setIndex(i, true));
    switch (e.key) {
      case "*":
        if (S.mode !== "large") setMode("large");
        if (target() === "A") setZoomA(1); else setActual(true);
        break;
      case "/":
        if (target() === "A") { setZoomA(null); break; }
        if (S.actual) setActual(false); else handled = S.mode === "large"; break;
      case "l": case "L":
        if (e.ctrlKey || e.metaKey || e.altKey || !comparing()) { handled = false; break; }
        toggleLink(); break;
      case "+": case "=":
        if (S.mode === "large") stepZoom(1); else thumbZoom(1);
        break;
      case "-": case "_":
        if (S.mode === "large") stepZoom(-1); else thumbZoom(-1);
        break;
      case "f": case "F":
        if (e.ctrlKey || e.metaKey || e.altKey) { handled = false; break; }
        toggleFull(); break;
      case "ArrowRight": case "ArrowLeft": {
        const right = e.key === "ArrowRight";
        if (e.shiftKey) { jumpFolder(right ? 1 : -1); break; }
        /* a zoomed picture wider than the panel: left and right move it,
           until it fits across again */
        const hp = target() === "A" ? stageA : stage;
        const hz = hp === stageA ? S.zoomA != null : S.actual;
        if (S.mode === "large" && hz && hp.scrollWidth - hp.clientWidth > 1) {
          hp.scrollLeft += (right ? 1 : -1) * Math.max(40, hp.clientWidth * 0.15);
          break;
        }
        go(cur0 + (right ? 1 : -1));
        break;
      }
      /* Up and down are levels, not pictures: full screen, the large view,
         the grid. Up climbs - full screen to the node, the node's large
         view to the grid - and down goes in from the large view to full
         screen. Except when a zoomed picture is taller than the panel:
         then they scroll it, and go back to being levels as soon as it
         fits again. In the grid they move a row, as before. */
      case "ArrowDown": case "ArrowUp": {
        const up = e.key === "ArrowUp";
        if (S.mode !== "large") { gridVertical(up ? -1 : 1); break; }
        const vp = target() === "A" ? stageA : stage;
        const vz = vp === stageA ? S.zoomA != null : S.actual;
        if (vz && vp.scrollHeight - vp.clientHeight > 1) {
          vp.scrollTop += (up ? -1 : 1) * Math.max(40, vp.clientHeight * 0.15);
          break;
        }
        if (up) {
          if (isFull()) toggleFull();
          else if (S.actual) setActual(false);
          else if (comparing()) togglePin();
          else setMode("grid");
        } else if (!isFull()) {
          toggleFull();
        }
        break;
      }
      /* Backspace steps back like [ - in the large view and full screen.
         In the grid it is left to the graph, where it removes the node. */
      case "Backspace":
        if (e.ctrlKey || e.metaKey || e.altKey || S.mode !== "large") { handled = false; break; }
        loopStep(true, cur0, go); break;
      case " ": case "Spacebar": case "]": case "[": {
        if (e.ctrlKey || e.metaKey || e.altKey) { handled = false; break; }
        loopStep(e.key === "[" || (e.shiftKey && e.key !== "]"), cur0, go);
        break;
      }
      case "c": case "C":
        if (e.ctrlKey || e.metaKey || e.altKey) { handled = false; break; }
        togglePin(); break;
      case "n": case "N":
        if (e.ctrlKey || e.metaKey || e.altKey || S.mode !== "large") { handled = false; break; }
        toggleNavi(); break;
      case "w": case "W":
        if (e.ctrlKey || e.metaKey || e.altKey || !comparing()) { handled = false; break; }
        toggleWipe(); break;
      case "x": case "X":
        if (e.ctrlKey || e.metaKey || e.altKey || !comparing()) { handled = false; break; }
        swapPin(); break;
      case "p": case "P":
        if (e.ctrlKey || e.metaKey || e.altKey || cur0 < 0) { handled = false; break; }
        togglePick(cur0); break;
      case "o": case "O":
        if (e.ctrlKey || e.metaKey || e.altKey || S.current < 0) { handled = false; break; }
        openWorkflow(S.items[S.current]); break;
      case "h": case "H":
        if (e.ctrlKey || e.metaKey || e.altKey || S.mode !== "large") { handled = false; break; }
        setHist(!P.viv_hist); break;
      case "e": case "E":
        if (e.ctrlKey || e.metaKey || e.altKey || S.mode !== "large") { handled = false; break; }
        setClip(!P.viv_clip); break;
      case "g": case "G":
        if (e.ctrlKey || e.metaKey || e.altKey || S.mode !== "large") { handled = false; break; }
        setGuides((P.viv_guides | 0) + 1); break;
      case "i": case "I":
        if (e.ctrlKey || e.metaKey || e.altKey || S.mode !== "large") { handled = false; break; }
        setMeta(!P.viv_meta); break;
      case "r": case "R":
        if (e.ctrlKey || e.metaKey || e.altKey || S.mode !== "large") { handled = false; break; }
        turn(e.shiftKey ? -1 : 1); break;
      case "Delete":
        /* never passed on to the graph: on the viewer, Delete is for pictures */
        if (e.ctrlKey || e.metaKey || e.altKey || cur0 < 0) { flash("no picture chosen - Backspace removes the node"); break; }
        if (S.binView && e.shiftKey) { purgeAt(cur0); break; }
        deleteAt(cur0); break;
      case "PageUp": jumpFolder(-1); break;
      case "PageDown": jumpFolder(1); break;
      case "Home": go(cur0 >= 0 ? scope(cur0)[0] : 0); break;
      case "End": go(cur0 >= 0 ? scope(cur0)[1] : n - 1); break;
      /* Enter goes one level in: grid to the large view, the large view to
         full screen, and full screen back out to the large view. Esc is
         the way back to the grid. */
      case "Enter":
        if (S.mode !== "large") setMode("large");
        else toggleFull();
        break;
      case "Escape":
        if (isFull()) toggleFull();
        else if (S.actual) setActual(false);
        else if (comparing()) togglePin();
        else if (S.mode === "large") setMode("grid");
        else if (S.binView) setBin(false);
        else handled = false;
        break;
      default: handled = false;
    }
    if (handled) { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); }
  }
  window.addEventListener("keydown", onKey, true);

  /* FOLLOW. A save node's output arrives with the "executed" event; the
     picture it names is opened - its folder if that is another one - and
     marked NEW until the next one. With FOLLOW off a finished render still
     rescans, in case it wrote into the folder on screen. */
  /* Does a folder a picture was saved into belong to the view of several
     folders on show? {tag, rest} - the picked folder, named as the server
     names it, and the path below it - or null. */
  function multiMatch(folder) {
    const f = normFolder(folder);
    const b = String(S.path || "");
    if (!b.includes("|")) return null;
    const used = {};
    for (const part of b.split("|")) {
      const p = normFolder(part);
      if (!p) continue;
      const raw = String(part).replace(/[\\/]+$/, "");
      const name = raw.slice(Math.max(raw.lastIndexOf("/"), raw.lastIndexOf("\\")) + 1) || raw;
      used[name] = (used[name] || 0) + 1;
      const tag = used[name] === 1 ? name : name + " (" + used[name] + ")";
      if (f === p) return { tag, rest: "" };
      if (f.startsWith(p + "/")) return { tag, rest: String(folder).replace(/\\/g, "/").replace(/\/+$/, "").slice(p.length + 1) };
    }
    return null;
  }

  /* The folder in a saved path named after a series of the Series Book on
     the canvas - spelled loosely, as the book's own folder search does - and
     the path below it. Null when no folder in the path is one of its series. */
  const loose = (t) => String(t || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  function seriesRootOf(folder) {
    readBookTones();
    if (!BOOK_TONES.size) return null;
    const known = new Set([...BOOK_TONES.keys()].map(loose));
    const raw = String(folder || "").replace(/[\\/]+$/, "");
    const parts = raw.split(/[\\/]/);
    for (let i = parts.length - 1; i >= 0; i--) {
      if (!known.has(loose(parts[i]))) continue;
      if (i === parts.length - 1) return null;      // saved in the series folder itself
      const sep = raw.includes("\\") ? "\\" : "/";
      return { root: parts.slice(0, i + 1).join(sep), rest: parts.slice(i + 1).join("/") };
    }
    return null;
  }

  const onExecuted = (e) => {
    const d = e && e.detail;
    const hit = savedFrom(d && d.output);
    if (!hit) return;
    if (!P.viv_follow) { setTimeout(() => rescan(false), 300); return; }
    if (S.binView) { S.binView = false; S.pin = null; paintControls(); }
    S.fresh = hit.name;
    const here = [normFolder(S.path), normFolder(P.viv_folder)];
    /* a view of several folders, and the picture landed in one of them: it
       is already in the grid - stay put */
    const md = multiMatch(hit.folder);
    if (md) {
      const rel = (md.rest ? md.rest + "/" : "") + hit.name + "|" + md.tag;
      S.fresh = rel;
      rescan(false, rel);
      return;
    }
    /* Shown with its subfolders and the picture landed in one of them: it
       is already in the grid, under its path from here - stay put. */
    const base = normFolder(S.path);
    const hf = String(hit.folder || "").replace(/\\/g, "/").replace(/\/+$/, "");
    if (S.deep && base && hf.toLowerCase().startsWith(base + "/")) {
      const rel = hf.slice(base.length + 1) + "/" + hit.name;
      S.fresh = rel;
      rescan(false, rel);
      return;
    }
    /* A render of a series the Series Book holds lands deep - day / series /
       scene / LoRA / sampler. The viewer opens the series folder instead,
       every scene under it as its own group, so the whole series stays in
       sight while it is being made. */
    const top = seriesRootOf(hit.folder);
    if (top && normFolder(top.root) !== normFolder(S.path)) {
      const rel = (top.rest ? top.rest + "/" : "") + hit.name;
      S.preferRel = true;
      openFolder(top.root, rel).then(() => { S.fresh = rel; applyMarks(); });
      return;
    }
    if (!here.includes(normFolder(hit.folder))) {
      S.preferRel = true;
      openFolder(hit.folder, hit.name).then(() => { S.fresh = hit.name; applyMarks(); });
    } else {
      rescan(false, hit.name);
    }
  };
  api.addEventListener("executed", onExecuted);

  /* A series opened in a Series Book - brought back from Files, or a book
     file opened - takes the viewer to its pictures: the folder named after
     it, the one worked in last when there are several. */
  const onSeriesOpened = async (e) => {
    const names = (e && e.detail && e.detail.names) || [];
    if (!names.length || !root.isConnected) return;
    let j = null;
    try {
      const r = await api.fetchApi("/leiel_viewer/find_series", { method: "POST",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ names }) });
      j = await r.json();
    } catch (err) { j = null; }
    if (!j || !j.ok || !j.folder) {
      flash(`no folder named "${names[0]}" found in output`);
      return;
    }
    const more = j.others ? ` - ${j.others} other folder${j.others === 1 ? "" : "s"} carry the name too` : "";
    if (normFolder(j.folder) !== normFolder(P.viv_folder)) await openFolder(j.folder);
    pushRecent(j.folder);
    flash(`series "${j.series}"${more}`);
  };
  window.addEventListener("leiel-series-opened", onSeriesOpened);

  /* A quiet look for files arriving from elsewhere. A big tree - a day of
     renders with its subfolders - is read less often: a finished render
     brings its own rescan anyway. */
  let polls = 0;
  const timer = setInterval(() => {
    if (!root.isConnected) return;
    polls += 1;
    const every = S.items.length > 1500 ? 8 : S.items.length > 300 ? 3 : 1;
    if (polls % every === 0 && !S.busy) rescan(false);
  }, POLL_MS);

  /* Series colours follow the Book live: a look every quarter second,
     and a repaint of the folder bars and series names only on a change. */
  const toneWatch = setInterval(() => {
    if (!root.isConnected || !readBookTones()) return;
    for (const h of root.querySelectorAll(".viv-group[data-series]")) h.style.setProperty("--sgv", topColour(h.dataset.series));
    for (const g of root.querySelectorAll(".viv-crumbs .seg.first[data-series]")) g.style.setProperty("--top", topColour(g.dataset.series));
  }, 250);
  readBookTones();

  paintControls();
  root.classList.toggle("meta", !!P.viv_meta);
  capMeta.classList.toggle("on", !!P.viv_meta);
  setTimeout(() => { if (!S.busy && !S.items.length) rescan(true); }, 60);

  node._viv = {
    destroy() {
      clearInterval(timer);
      clearInterval(toneWatch);
      clearTimeout(idleTimer);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("focus", onWake);
      hov.remove();
      document.removeEventListener("fullscreenchange", onFullChange);
      try { api.removeEventListener("executed", onExecuted); } catch (e) { /* older api */ }
      window.removeEventListener("leiel-series-opened", onSeriesOpened);
    },
    open: openFolder,
  };

  /* sequence_number: its row hidden, its value set from the chip */
  const seqW = (node.widgets || []).find((w) => w.name === "sequence_number");
  if (seqW) {
    seqW.hidden = true;
    seqW.options = Object.assign({}, seqW.options, { hidden: true });
    seqW.computeSize = () => [0, -4];
    seqW.draw = () => {};
  }
  function wired() {
    const inp = (node.inputs || []).find((i) => i.name === "images");
    return !!(inp && inp.link != null);
  }
  function paintSeq() {
    /* The switch is kept in the node's properties as well. A hidden widget's
       value does not reliably survive a reload or a trip to another
       workflow tab - it came back on every time - while properties do. */
    if (seqW && typeof P.viv_seq === "boolean") seqW.value = P.viv_seq;
    /* Anything but a true/false here is a value from another widget,
       shifted into this slot by a workflow saved before the switch
       existed. It used to show as on while the save read it as off. */
    if (seqW && typeof seqW.value !== "boolean") seqW.value = seqW.value !== "false" && seqW.value !== 0 ? true : false;
    const show = !!seqW && wired();
    seqBtn.style.display = show ? "" : "none";
    if (!show) return;
    const on = seqW.value !== false;
    seqBtn.classList.toggle("on", on);
    seqBtn.textContent = on ? "# 00001" : "# off";
    seqBtn.title = on
      ? "Saving with a counter on the end - name_00001_.png. Click to save under the name as given"
      : "Saving under the name as given - a name already taken gets _2. Click to add the counter";
  }
  seqBtn.addEventListener("click", () => {
    if (!seqW) return;
    seqW.value = seqW.value === false;
    node.properties = node.properties || {};
    node.properties.viv_seq = seqW.value;
    if (typeof seqW.callback === "function") {
      try { seqW.callback(seqW.value, app.canvas, node); } catch (e) { console.error(e); }
    }
    paintSeq();
    node.setDirtyCanvas(true, true);
    flash(seqW.value ? "saving with a counter - name_00001_" : "saving under the name as given");
  });
  /* Wiring images in is asking to see what gets saved, so FOLLOW comes on
     at that moment. It can still be turned off - to look back through
     older pictures while a run keeps saving - and a workflow opened with
     the wire already in place keeps the FOLLOW it was saved with. */
  let wasWired = null;
  const onConn = node.onConnectionsChange;
  node.onConnectionsChange = function () {
    const r = onConn ? onConn.apply(this, arguments) : undefined;
    const now = wired();
    if (wasWired === false && now && !P.viv_follow) {
      P.viv_follow = true;
      paintControls();
      flash("images wired in - following what the viewer saves");
    }
    wasWired = now;
    paintSeq();
    return r;
  };
  node._vivPaintSeq = () => { wasWired = wired(); paintSeq(); };
  setTimeout(node._vivPaintSeq, 0);

  if (node.size[0] < 560) node.size[0] = 560;
  if (node.size[1] < 600) node.size[1] = 600;
  return domWidget;
}

app.registerExtension({
  name: "StudioLeiel.VisualImageViewer",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== VIEWER) return;

    const onCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = onCreated ? onCreated.apply(this, arguments) : undefined;
      buildViewer(this);
      return r;
    };

    /* Properties arrive after the node is built when a workflow loads, so
       the folder is read again once they are in. */
    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const r = onConfigure ? onConfigure.apply(this, arguments) : undefined;
      const v = this._viv;
      setDefaults(this);
      /* the folder last looked at wins over the one the workflow was saved
         with - the work has usually moved on since the workflow was saved */
      const last = lastFolder();
      if (last !== null) this.properties.viv_folder = last;
      if (v) setTimeout(() => v.open(this.properties.viv_folder || ""), 0);
      if (this._vivPaintSeq) setTimeout(this._vivPaintSeq, 0);
      return r;
    };

    const onRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      if (this._viv) this._viv.destroy();
      return onRemoved ? onRemoved.apply(this, arguments) : undefined;
    };
  },
});
