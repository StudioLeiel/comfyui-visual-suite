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

/* Visual Idea Box.

   Ideas come from everywhere but the graph: a picture on a web page, a
   frame of a film, a line someone said. The box is built around one rule -
   keeping one must take a second, or it is not kept at all.

   KEEP     drop a picture or a link from the browser onto the node, paste
            with Ctrl+V (a screenshot, a picture, a line of text), or save
            anything into the inbox folder - a screenshot tool can save there
            by itself. Nothing is asked at that moment.
   SORT     the new ones wait in a strip at the top. Sort goes through them
            one at a time, large: a line on what caught the eye, a folder by
            its number key, Enter for the next.
   FIND     search the lines, the folders and the addresses; open a folder;
            shuffle to meet the forgotten ones again.
   USE      "Start a series with this" opens a new series in the Series Book
            with the idea as its note and its picture.

   The ideas are kept by the server in user/visual_idea_box/, so every Idea
   Box node - in any workflow - shows the same box. */

import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

const BOX = "LeielIdeaBox";
const BOOK = "LeielSeriesBook";

const LIST_URL = "/leiel_idea/list";
const ADD_URL = "/leiel_idea/add";
const ADD_URL_URL = "/leiel_idea/add_url";
const ADD_TEXT_URL = "/leiel_idea/add_text";
const MORE_ADD_URL = "/leiel_idea/more_add";
const MORE_SET_URL = "/leiel_idea/more_set";
const UPDATE_URL = "/leiel_idea/update";
const DELETE_URL = "/leiel_idea/delete";
const FOLDERS_URL = "/leiel_idea/folders";
const PICTURE_URL = "/leiel_idea/picture";
const CAPTURE_URL = "/leiel_idea/capture";
const BRIEF_FILES_URL = "/leiel_idea/brief_files";

const POLL_MS = 8000;           // the inbox fills without telling the node
const STRIP_MAX = 14;
const ARM_MS = 4000;
/* Stars say how much an idea is wanted - not only that it is liked */
const STAR_WORDS = ["", "Like", "Love", "Next series"];
const DAY = 86400;
const PAN_STEP = 80;            // an arrow key's move of a zoomed picture; Shift for three
/* the keys that go through an idea's pictures */
const PIC_KEYS = { ArrowDown: 1, ArrowUp: -1, PageDown: "last", End: "last", PageUp: "first", Home: "first" };
const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
const FILM_DROP_MAX = 95 * 1024 * 1024;   // ComfyUI takes up to 100 MB in one request            // a Delete? not pressed again lets go after this           // new ones shown in the strip before "+n"

const GOLD = "#d9b26a";
/* one's own work: silver, as the references are gold */
const SILVER = "#c9cfd8";

/* the colours a node can wear, as the Series Book and Report offer them */
const HUES = [
  ["teal", "#2f6f73"], ["slate", "#46596f"], ["moss", "#52633a"],
  ["umber", "#6e4f2e"], ["wine", "#6c2f40"], ["indigo", "#43437e"],
  ["graphite", "#4e4e52"],
];
const HUE_DEFAULT = 6;
const LIGHT_DEFAULT = 0.22;

const CSS = `
.vib{--bk:#4e4e52;--bl:.22;
  --vib-bg:color-mix(in srgb, var(--bk) calc(var(--bl) * 40%), #0b0c0e);
  /* the wall a step darker than the folders beside it, so the pictures stand out */
  --vib-wallbg:color-mix(in srgb, var(--vib-bg) 55%, #050506);
  --vib-bar:color-mix(in srgb, var(--bk) calc(var(--bl) * 45% + 4%), #121315);
  --vib-card:color-mix(in srgb, var(--bk) calc(var(--bl) * 35% + 4%), #141518);
  --vib-line:color-mix(in srgb, var(--bk) calc(var(--bl) * 40% + 12%), #1c1e22);
  display:flex;flex-direction:column;width:100%;height:100%;box-sizing:border-box;position:relative;
  background:var(--vib-bg);border:1px solid var(--vib-line);border-radius:8px;overflow:hidden;outline:none;
  font:12px/1.35 system-ui,-apple-system,"Segoe UI",sans-serif;color:#d6d9de}
.vib *{box-sizing:border-box}
.vib button{font-family:inherit;cursor:pointer}
.vib-bar{display:flex;align-items:center;gap:6px;padding:8px;background:var(--vib-bar);border-bottom:1px solid var(--vib-line);flex:0 0 auto}
.vib-search{flex:1 1 auto;min-width:60px;display:flex;align-items:center;gap:6px;height:26px;padding:0 10px;
  border-radius:999px;border:1px solid #2e3036;background:#0c0d0f}
.vib-search:focus-within{border-color:${GOLD}}
.vib-search input{flex:1;min-width:0;background:none;border:0;outline:none;color:#d6d9de;font:12px system-ui,sans-serif}
.vib-search svg{flex:0 0 auto}
/* ---- the sites: bookmarks laid out on the wall, one click to open */
.vib-sitespage{padding:4px 2px 14px}
.vib-sitespage .hint{font-size:10.5px;color:#7a7f87;margin:2px 0 12px}
.vib-strack{display:flex;flex-wrap:wrap;gap:7px;align-items:center}
.vib-site{flex:0 0 auto;display:inline-flex;align-items:center;gap:8px;height:30px;padding:0 13px 0 8px;border-radius:999px;
  border:1px solid #2e3036;background:#14161a;color:#d6d9de;font-size:12px;text-decoration:none;white-space:nowrap;cursor:pointer;user-select:none}
.vib-site:hover{border-color:${GOLD};color:#f0d9a8;background:#1c1912}
.vib-site img,.vib-site i{flex:0 0 auto;width:16px;height:16px;border-radius:3px;display:block}
.vib-site i{font-style:normal;font-size:9px;font-weight:700;line-height:16px;text-align:center;background:#2a2d33;color:#c9ccd2}
.vib-site.drag{opacity:.35}
.vib-site.before{box-shadow:-4px 0 0 -2px ${GOLD}}
.vib-site.after{box-shadow:4px 0 0 -2px ${GOLD}}
.vib-sadd{flex:0 0 auto;height:30px;padding:0 14px;border-radius:999px;border:1px dashed #3a3d44;background:none;color:#7a7f87;font-size:11px}
.vib-sadd:hover{border-color:${GOLD};color:${GOLD}}
.vib-sitepop{position:absolute;z-index:40;width:280px;padding:12px;border-radius:8px;background:#16171a;border:1px solid #3a3d44;
  box-shadow:0 10px 28px #000a;display:flex;flex-direction:column;gap:7px}
.vib-sitepop label{font-size:9px;font-weight:700;letter-spacing:.8px;color:#7a7f87}
.vib-sitepop input{height:26px;padding:0 9px;border-radius:5px;border:1px solid #33363d;background:#0c0d0f;color:#e2e4e8;font:12px system-ui,sans-serif;outline:none}
.vib-sitepop input:focus{border-color:${GOLD}}
.vib-sitepop .row{display:flex;gap:6px;margin-top:4px}
.vib-sitepop .row .sp{flex:1}
.vib-sitepop .del.armed{border-color:#e06a6a;color:#ffb3b3;background:#3a1c1c}
.vib-btn{height:26px;padding:0 12px;border-radius:999px;background:#14161a;border:1px solid #33363d;color:#b9bdc5;
  font-size:10px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;line-height:1;white-space:nowrap;
  display:inline-flex;align-items:center;justify-content:center;gap:6px;flex:0 0 auto}
.vib-btn:hover{border-color:${GOLD};color:#f0d9a8;background:#1c1912}
.vib-btn.on{border-color:${GOLD};color:#f3dcaa;background:#2a2416}
.vib-btn.gold{background:${GOLD};border-color:${GOLD};color:#17140d}
.vib-btn.gold:hover{background:#e6c27d;color:#17140d}
.vib-btn.vib-help{width:26px;padding:0;font-size:12px;letter-spacing:0}
.vib-helpbox{position:absolute;inset:0;z-index:6;background:var(--vib-bg);display:flex;flex-direction:column}
.vib-helpbox .hb-bar{display:flex;align-items:center;justify-content:space-between;padding:8px 10px 8px 16px;background:var(--vib-bar);border-bottom:1px solid var(--vib-line)}
.vib-helpbox .hb-bar b{font-size:10.5px;letter-spacing:1.2px;color:${GOLD}}
.vib-helpbox .hb-body{flex:1;overflow-y:auto;padding:18px 22px 24px;display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:22px 28px;align-content:start}
.vib-helpbox h5{margin:0 0 8px;font-size:10.5px;letter-spacing:1.2px;color:${GOLD};font-weight:700}
.vib-helpbox p{margin:0 0 7px;font-size:12px;line-height:1.55;color:#c9ccd2}
.vib-helpbox p b{color:#ece8de;font-weight:600}
.vib-helpbox kbd{font:600 10.5px system-ui,sans-serif;padding:1px 5px;border-radius:3px;border:1px solid #3a3d44;background:#16171a;color:#e2e4e8}
.vib-btn.vib-paste{padding:0 30px;gap:7px}
.vib-btn.big{height:34px;font-size:11px;padding:0 16px}
.vib-btn.wide{width:100%}
.vib-btn.warn{border-color:#c8645a;color:#f0b8b0;background:#2a1715}

.vib-jot{display:flex;align-items:flex-end;gap:8px;padding:8px;background:var(--vib-bar);border-top:1px solid var(--vib-line);flex:0 0 auto}
.vib-jot textarea{flex:1;min-width:0;height:30px;resize:none;padding:7px 10px;background:#0c0d0f;border:1px solid #2e3036;
  border-radius:6px;color:#e2e4e8;font:12px/1.45 system-ui,sans-serif;outline:none;transition:height .12s}
.vib-jot textarea:not(:focus):not(.full){overflow:hidden}
.vib-jot textarea:focus,.vib-jot textarea.full{height:96px;border-color:${GOLD}}
.vib-jot .vib-btn{height:30px}
.vib-tone{display:inline-flex;align-items:center;gap:6px;flex:0 0 auto;margin-left:2px}
.vib-dot{width:12px;height:12px;border-radius:50%;background:var(--bk);cursor:pointer;flex:0 0 auto;border:0;padding:0;
  box-shadow:0 0 0 1px #000, 0 0 0 2px color-mix(in srgb, var(--bk) 60%, #888)}
.vib-dot:hover{filter:brightness(1.4)}
.vib-light{-webkit-appearance:none;appearance:none;width:72px;height:12px;background:transparent;cursor:pointer;margin:0 2px;flex:0 0 auto}
.vib-light::-webkit-slider-runnable-track{height:2px;border-radius:1px;
  background:linear-gradient(90deg, ${GOLD} var(--pct,22%), #3a3a3a var(--pct,22%))}
.vib-light::-webkit-slider-thumb{-webkit-appearance:none;width:10px;height:10px;border-radius:50%;background:${GOLD};margin-top:-4px;border:none}
.vib-light::-moz-range-track{height:2px;background:#3a3a3a}
.vib-light::-moz-range-progress{height:2px;background:${GOLD}}
.vib-light::-moz-range-thumb{width:10px;height:10px;border-radius:50%;background:${GOLD};border:none}
.vib-tip{position:fixed;z-index:100002;max-width:420px;min-width:200px;padding:10px 12px;box-sizing:border-box;
  background:#121418;border:1px solid #e4c27a;border-radius:10px;box-shadow:0 8px 24px #000c;
  font-family:system-ui,sans-serif;color:#d8dbe0;display:flex;flex-direction:column;gap:7px;pointer-events:none}
.vib-tip .ch b{font-size:12px;color:#e4c27a}
.vib-tip .en{font-size:11px;line-height:1.5;color:#b9bdc5;white-space:pre-wrap}
.vib-tip .hint{font-size:10.5px;line-height:1.5;color:#8b909a;display:flex;flex-direction:column;gap:3px}
.vib-tip .en+.hint{border-top:1px solid #23262c;padding-top:7px}
.vib-tip .hint .hr{display:grid;grid-template-columns:auto 1fr;gap:12px;align-items:baseline}
.vib-tip .hint .hr b{font-size:11px;font-weight:700;color:#e4c27a;white-space:nowrap}
.vib-tip .hint .hr span{color:#a9aeb7}
.vib-crumb{column-span:all;display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:0 0 10px;font-size:11px;letter-spacing:.6px;color:#8e939c;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vib-crumb button{background:none;border:0;padding:0;color:#8e939c;font:inherit;letter-spacing:inherit;cursor:pointer}
.vib-crumb button:hover{color:#f0d9a8}
.vib-crumb b{color:#e8e4da;font-weight:600}
.vib-crumb i{font-style:normal;color:#5b5f68}
.vib-crumb em{font-style:normal;color:${GOLD};margin-left:4px}
/* the size of the ideas on the wall: a small square, a slider, a large one */
.vib-size{margin-left:auto;display:inline-flex;align-items:center;gap:6px;color:#6f747c}
.vib-size i{display:block;border:1.4px solid currentColor;border-radius:2px}
.vib-size i.s{width:7px;height:7px}
.vib-size i.l{width:11px;height:11px}
.vib-size .vib-light{width:84px}
/* the chips' own slider: round marks, where the cards' slider has squares */
.vib-chipsize i{border-radius:999px !important}
.vib-chipsize i.s{width:9px;height:6px}
.vib-chipsize i.l{width:14px;height:9px}
.vib-chipsize + .vib-size{margin-left:14px}
.vib-strack,.vib-kwbody .vib-kws{zoom:var(--chipz,1)}
.vib-size + .vib-briefbtn{margin-left:12px !important}
.vib-crumb .vib-briefbtn{margin-left:auto;height:22px;padding:0 11px;border-radius:999px;border:1px solid ${GOLD};color:${GOLD};
  background:#1c1912;font:700 10px system-ui,sans-serif;letter-spacing:.8px}
.vib-crumb .vib-briefbtn:hover{background:#2a2416;color:#f3dcaa}
.vib-brief .br-body{flex:1;min-height:0;display:grid;grid-template-columns:minmax(220px,0.9fr) minmax(300px,1.4fr)}
.vib-brief .br-pick{display:flex;flex-direction:column;min-height:0;border-right:1px solid var(--vib-line)}
.vib-brief .br-ph{display:flex;align-items:center;gap:6px;padding:10px 12px;border-bottom:1px solid var(--vib-line);font-size:11px;color:#8e939c}
.vib-brief .br-ph span{flex:1}
.vib-brief .br-rows{flex:1;overflow-y:auto;padding:6px}
.vib-brief .br-row{display:flex;align-items:center;gap:9px;padding:5px 6px;border-radius:5px;cursor:pointer;opacity:.55}
.vib-brief .br-row.on{opacity:1}
.vib-brief .br-row:hover{background:color-mix(in srgb, var(--vib-card) 80%, #2a2c31)}
.vib-brief .br-row input{accent-color:${GOLD}}
.vib-brief .br-th{flex:0 0 46px;height:34px;border-radius:3px;overflow:hidden;background:#0c0d0f;display:flex;align-items:center;justify-content:center;
  font-size:10px;color:#8e939c}
.vib-brief .br-th img{width:100%;height:100%;object-fit:cover}
.vib-brief .br-tx{min-width:0;display:flex;flex-direction:column}
.vib-brief .br-tx b{font-size:12px;font-weight:500;color:#e2e4e8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vib-brief .br-tx i{font-style:normal;font-size:10.5px;color:#8e939c;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vib-brief .br-form{min-height:0;overflow-y:auto;padding:12px 16px 14px;display:flex;flex-direction:column;gap:11px}
.vib-brief .br-f{display:flex;flex-direction:column}
.vib-brief .br-f .vib-seg{align-self:flex-start}
.vib-brief .br-f input,.vib-brief .br-f textarea{background:#0c0d0f;border:1px solid #33363d;border-radius:6px;color:#e2e4e8;
  font:12.5px/1.5 system-ui,sans-serif;padding:7px 10px;outline:none;resize:vertical}
.vib-brief .br-f input:focus,.vib-brief .br-f textarea:focus{border-color:${GOLD}}
.vib-brief .br-f textarea{min-height:64px}
.vib-brief .br-out{min-height:160px;height:200px;font:11.5px/1.5 ui-monospace,Consolas,monospace !important;color:#c9ccd2 !important}
.vib-brief .br-acts{display:flex;align-items:center;gap:8px}
.vib-brief .br-say{flex:1;min-width:0;font-size:11px;color:#c9b27a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vib-new{display:flex;align-items:center;gap:12px;padding:10px 10px;background:var(--vib-bar);border-bottom:1px solid var(--vib-line);flex:0 0 auto}
.vib-new-lab{flex:0 0 112px;display:flex;flex-direction:column;gap:3px}
.vib-new-lab b{font-size:10.5px;letter-spacing:1.2px;color:${GOLD}}
.vib-new-lab span{font-size:11px;color:#8e939c}
.vib-strip{flex:1 1 auto;display:flex;gap:6px;overflow:hidden;min-width:0}
.vib-chip{flex:0 0 auto;height:56px;border-radius:4px;overflow:hidden;background:#1c1d21;border:1px solid #2a2c31;
  padding:0;display:block;cursor:pointer}
.vib-chip:hover{border-color:${GOLD}}
.vib-chip img{height:100%;width:auto;display:block}
.vib-chip.t{width:104px;padding:6px 7px;font-size:10.5px;line-height:1.3;color:#c3c7ce;text-align:left;
  overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical}
.vib-more{flex:0 0 auto;align-self:center;color:#8e939c;font-size:11px;padding:0 4px}

.vib-main{flex:1 1 auto;display:flex;min-height:0}
.vib-navcol{flex:0 0 var(--navw,200px);width:var(--navw,200px);border-right:1px solid var(--vib-line);display:flex;flex-direction:column;min-height:0;position:relative}
.vib-split{position:absolute;top:0;right:-4px;bottom:0;width:8px;cursor:col-resize;z-index:3}
.vib-split::after{content:"";position:absolute;top:0;bottom:0;left:3px;width:2px;background:transparent}
.vib-split:hover::after,.vib-split.on::after{background:${GOLD}}
.vib-f.drop-into{box-shadow:inset 0 0 0 1px ${GOLD};background:#2a2416}
.vib-navcol .vib-tone{display:flex;margin:0;padding:12px 14px 10px;border-bottom:1px solid var(--vib-line);gap:10px}
.vib-navcol .vib-light{flex:1 1 0;width:0;min-width:0}
.vib-nav{flex:1 1 auto;padding:10px 6px;display:flex;flex-direction:column;gap:3px;overflow-y:auto}
.vib-nav-h{font-size:10px;font-weight:700;letter-spacing:1.2px;color:#8e939c;padding:2px 8px 8px}
.vib-f{display:flex;flex:0 0 auto;align-items:center;gap:8px;width:100%;height:32px;padding:0 8px;border-radius:5px;border:0;
  background:none;color:#d6d9de;font-size:12px;text-align:left;cursor:pointer;position:relative;outline:none;user-select:none}
.vib-f.own{cursor:grab}
.vib-caret{flex:0 0 18px;width:18px;height:24px;margin:0 -4px 0 -6px;padding:0;border:0;background:none;color:#8e939c;font-size:14px;line-height:1}
.vib-caret:hover{color:${GOLD}}
.vib-caret.none{pointer-events:none}
.vib-f.own:hover .vib-fplus{display:inline-flex}
.vib-fplus{font-size:14px}
.vib-fplus:hover{color:#f0d9a8;border-color:#5a4e30}
.vib-f.lift{opacity:.45}
.vib-f.ins-above{box-shadow:inset 0 2px 0 ${GOLD}}
.vib-f.ins-below{box-shadow:inset 0 -2px 0 ${GOLD}}
.vib-fx{display:none;height:20px;min-width:20px;padding:0 5px;border-radius:4px;border:1px solid transparent;background:none;
  color:#8e939c;font-size:13px;line-height:1}
.vib-f.own:hover .vib-fx,.vib-fx.armed{display:inline-flex;align-items:center;justify-content:center}
.vib-f.own:hover em{display:none}
.vib-fx:hover{color:#f0b8b0;border-color:#5a3430}
.vib-fx.armed{font-size:10px;font-weight:700;letter-spacing:.4px;color:#f0b8b0;border-color:#c8645a;background:#2a1715}
.vib-f:has(.vib-fx.armed) em{display:none}
.vib-f:hover{background:color-mix(in srgb, var(--vib-card) 80%, #2a2c31)}
.vib-f.on{background:color-mix(in srgb, var(--vib-card) 55%, #34363c)}
.vib-f i{font-style:normal;flex:0 0 auto;min-width:14px;color:#8e939c;font-size:11px;font-variant-numeric:tabular-nums}
.vib-f.own i{min-width:30px;font-size:10px;letter-spacing:-.2px}
.vib-f.own .vib-caret{margin-left:calc(var(--depth, 0) * 10px - 6px)}
/* as the Series Layout's cuts: no colour to draw the eye from the pictures.
   All, Starred and each top folder with the folders inside it are blocks with
   a hairline between them; the block holding the folder open is a darker
   ground with a gold bar along its top in place of the hairline. In it the
   folder open is marked by its number in gold and its name brighter - on the
   same dark ground as the rest of its block. */
.vib-nav{gap:0}
/* ---- My works: silver, at the foot of the folders */
.vib-wgrip{flex:0 0 7px;cursor:row-resize;position:relative;border-top:1px solid var(--vib-line)}
.vib-wgrip::after{content:"";position:absolute;left:50%;top:2px;width:32px;height:3px;margin-left:-16px;border-radius:2px;background:#33373e}
.vib-wgrip:hover::after,.vib-wgrip.on::after{background:${SILVER}}
.vib-works{flex:0 0 auto;display:flex;flex-direction:column;background:color-mix(in srgb, var(--vib-bg) 62%, #1a2029);padding:0 6px}
.vib-wlist{display:flex;flex-direction:column;overflow-y:auto;min-height:0}
.vib-f.vib-wrow{height:32px;border-radius:0;border-top:1px solid #ffffff0d;color:#d5dae1}
.vib-f.vib-wrow span{color:#d5dae1}
.vib-f.vib-wrow.allw span{font-weight:600}
.vib-f.vib-wrow:hover{background:#ffffff08}
.vib-f.vib-wrow.on{background:#00000066;box-shadow:inset 0 2px 0 ${SILVER};border-top-color:transparent}
.vib-f.vib-wrow.on span,.vib-f.vib-wrow.on em{color:${SILVER}}
.vib-whead{display:flex;align-items:center;justify-content:space-between;height:34px;padding:0 10px;cursor:pointer}
.vib-whead b{display:inline-flex;align-items:center;gap:7px;font-size:10.5px;letter-spacing:1.4px;color:${SILVER};font-weight:700}
.vib-whead b svg{flex:0 0 auto;margin-top:-1px}
.vib-whead em{font-style:normal;font-size:11px;color:#8e96a1}
.vib-works.on .vib-whead b{color:#f1f4f8}
.vib-crumb b.silver{color:${SILVER}}
.vib-alike{margin-left:12px;height:22px;padding:0 10px;border-radius:11px;border:1px solid #4a505a;background:none;color:${SILVER};
  font-size:10px;letter-spacing:.6px;font-weight:600;cursor:pointer}
.vib-alike:hover{border-color:${SILVER};color:#f3f5f8}
.vib-alike + .vib-size{margin-left:auto}
/* one's own work on the wall, among the references */
.vib-ctags{position:absolute;right:6px;top:6px;z-index:1;display:flex;gap:4px;pointer-events:none}
.vib-pintag{height:18px;padding:0 7px;border-radius:9px;background:${GOLD};color:#14110a;font-size:9px;font-weight:700;letter-spacing:.8px;line-height:18px}
.vib-wtag{height:18px;padding:0 7px;border-radius:9px;background:#000000a6;color:${SILVER};
  font-size:9px;font-weight:700;letter-spacing:1px;line-height:18px;pointer-events:none}
/* ---- comparing: the pinned idea on the left, the one looked at on the right */
.vib-cmp{flex:1 1 auto;min-height:0;display:flex;gap:8px}
.vib-cmpL,.vib-cmpR{flex:1 1 0;min-width:0;display:flex;flex-direction:column;gap:6px}
.vib-cmpR>.vib-pic,.vib-cmpR>.vib-duo,.vib-cmpL>.vib-pic,.vib-cmpL>.vib-duo{flex:1 1 auto;min-height:0}
.vib-cmphead{display:flex;align-items:center;gap:8px;height:22px;font-size:11px;color:#c3c7cd;min-width:0}
.vib-cmphead b{font-size:9.5px;letter-spacing:1.2px;color:${GOLD};flex:0 0 auto}
.vib-cmpL.work .vib-cmphead b,.vib-cmpR.work .vib-cmphead b{color:${SILVER}}
.vib-cmphead span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1 1 auto}
.vib-cmpx{border:0;background:none;color:#7a7f87;font-size:14px;cursor:pointer;width:20px;height:20px;flex:0 0 auto}
.vib-cmpx:hover{color:${GOLD}}
.vib-cmppic{flex:1 1 auto;min-height:0}
.vib-ztools button.pin{width:auto;padding:0 9px;border-radius:999px;font-size:10.5px;font-weight:600;letter-spacing:.4px}
.vib-ztools button.pin.on{background:${GOLD};color:#14110a}
.vib-cmppic .q{padding:20px;font-size:13px;line-height:1.7;color:#e2e0da;white-space:pre-wrap;overflow:auto;max-height:100%}
.vib-pinbtn{margin-left:auto;height:22px;padding:0 10px;border-radius:11px;border:1px solid #3a3d44;background:none;color:#c3c7cd;
  font-size:10px;letter-spacing:.8px;font-weight:600;cursor:pointer}
.vib-pinbtn:hover{border-color:${GOLD};color:${GOLD}}
.vib-pinbtn.on{border-color:${GOLD};background:${GOLD};color:#14110a}
.vib-grp,.vib-f.vib-all,.vib-f.vib-starrow{border-top:1px solid var(--vib-line)}
.vib-f.vib-all{border-top-color:transparent}
.vib-grp{display:flex;flex-direction:column;gap:3px;padding:5px 0}
.vib-f.vib-all,.vib-f.vib-starrow,.vib-f.vib-usedrow{border-radius:0;height:38px}
.vib-f.vib-usedrow{border-top:1px solid transparent}
.vib-grp:hover,.vib-f.vib-all:hover,.vib-f.vib-starrow:hover,.vib-f.vib-usedrow:hover{background:#00000026}
.vib-grp .vib-f:hover{background:#ffffff08}
.vib-grp.on,.vib-f.vib-all.on,.vib-f.vib-starrow.on,.vib-f.vib-usedrow.on{background:#00000066;border-top-color:transparent;box-shadow:inset 0 2px 0 ${GOLD}}
.vib-grp .vib-f.on,.vib-grp .vib-f.on:hover{background:transparent}
.vib-f.own.top{font-weight:600}
.vib-f.own:not(.top){font-weight:400}
.vib-f.on i{color:${GOLD}}
.vib-f.on span{color:#f1ede5}
/* the group open: its top folder's name in gold */
.vib-grp.on .vib-f.own.top span{color:${GOLD}}
.vib-f span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vib-f em{font-style:normal;color:#8e939c;font-size:11px;font-variant-numeric:tabular-nums}
.vib-f input{flex:1;min-width:0;height:22px;background:#0c0d0f;border:1px solid ${GOLD};border-radius:4px;
  color:#d6d9de;font:12px system-ui,sans-serif;padding:0 6px;outline:none}
.vib-rule{height:1px;background:var(--vib-line);margin:0 0 6px}
.vib-addf{margin-top:4px;height:28px;border:1px dashed #33363d;border-radius:5px;background:none;color:#8e939c;
  font-size:12px;text-align:left;padding:0 8px}
.vib-addf:hover{border-color:${GOLD};color:#f0d9a8}

.vib-card.starred-words .q{padding-top:34px}
.vib-wall{flex:1 1 auto;overflow-y:auto;overflow-x:hidden;background:var(--vib-wallbg);padding:10px}
/* The cards are laid out in columns inside a box of their own, and the wall
   only scrolls it. Set on the wall itself, the columns had the wall's fixed
   height to fill: once they were full the rest of the cards went into more
   columns off to the right, where nothing could be scrolled to - 19 ideas,
   11 on show. */
.vib-cols{column-width:var(--cardw,170px);column-gap:10px}
.vib-card{break-inside:avoid;margin:0 0 10px;background:var(--vib-card);border:1px solid var(--vib-line);border-radius:6px;
  overflow:hidden;cursor:pointer;display:block;width:100%;padding:0;text-align:left;color:inherit}
/* the lift under the pointer: slow and soft, up and down alike */
.vib-card{position:relative;z-index:0;transform:translateZ(0) scale(1);will-change:transform;backface-visibility:hidden;
  transition:transform .42s cubic-bezier(.22,.61,.36,1), box-shadow .42s cubic-bezier(.22,.61,.36,1), border-color .3s ease, z-index 0s .42s}
.vib-card:hover{border-color:#4a4536;transform:translateZ(0) scale(1.025);box-shadow:0 12px 28px rgba(0,0,0,.55);z-index:2;
  transition:transform .42s cubic-bezier(.22,.61,.36,1), box-shadow .42s cubic-bezier(.22,.61,.36,1), border-color .3s ease, z-index 0s}
.vib-tipcard{max-width:360px;padding:12px 14px}
.vib-tipcard .ch b{font-size:12.5px;line-height:1.45}
.vib-tipcard .words{margin-top:6px;font-size:11.5px;line-height:1.6;color:#c9ccd2;white-space:pre-wrap;max-height:240px;overflow:hidden}
.vib-tipcard .kws{display:flex;flex-wrap:wrap;gap:4px 10px;margin-top:9px;font-size:11px;color:#e8e4da}
.vib-tipcard .kws i{font-style:normal;color:#8e939c;font-size:9.5px;letter-spacing:.4px;margin-right:4px}
.vib-tipcard .meta{margin-top:9px;font-size:10.5px;color:#8e939c}
.vib-tipcard .how{margin-top:9px;padding-top:7px;border-top:1px solid #23262c;font-size:10px;color:#7a7f87}
.vib-tipcard .how b{color:${GOLD};font-weight:600}
.vib-card img{display:block;width:100%;height:auto;background:#1c1d21}
.vib-card .q{padding:12px 11px 4px;font-size:13px;line-height:1.45;color:#e2e4e8;white-space:pre-wrap;
  display:-webkit-box;-webkit-line-clamp:8;-webkit-box-orient:vertical;overflow:hidden}
.vib-card .c{padding:8px 10px 9px;display:flex;flex-direction:column;gap:4px}
.vib-card .n{font-size:12px;line-height:1.4;color:#d6d9de}
.vib-card .w{font-size:11px;line-height:1.45;color:#a9adb5;white-space:pre-wrap;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.vib-card .m{font-size:10.5px;color:#8e939c;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vib-card .m b{font-weight:600;color:#b4a273}
.vib-empty{column-span:all;padding:40px 10px;text-align:center;color:#8e939c;font-size:12px;line-height:1.7}

.vib-foot{flex:0 0 auto;display:flex;justify-content:space-between;gap:10px;align-items:center;height:26px;padding:0 10px;
  border-top:1px solid var(--vib-line);font-size:10.5px;color:#8e939c;background:var(--vib-bar)}
.vib-foot button{background:none;border:0;color:#8e939c;font-size:10.5px;padding:0;max-width:65%;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vib-foot button:hover{color:#f0d9a8}
.vib-say.flash{color:#f0d9a8}
.vib-say.err{color:#f0b8b0}

.vib-main{position:relative}
.vib-drop{position:absolute;top:0;right:0;bottom:0;left:var(--navw,200px);display:none;padding:12px;pointer-events:none;
  background:color-mix(in srgb, var(--vib-bg) 92%, transparent);z-index:5}
.vib-f.drop-on{background:${GOLD};color:#17140d}
.vib-f.drop-on i,.vib-f.drop-on em{color:#5a4a22}
.vib.over .vib-drop{display:flex}
.vib-drop div{flex:1;border:2px dashed ${GOLD};border-radius:8px;background:#1b1914;display:flex;flex-direction:column;
  align-items:center;justify-content:center;gap:10px;pointer-events:none}
.vib-drop b{font-size:18px;font-weight:600;color:#e8e4da}
.vib-drop span{font-size:12px;color:#8e939c}

.vib-look{position:absolute;inset:0;display:flex;flex-direction:column;background:var(--vib-bg);z-index:4}
.vib-look-bar{display:flex;align-items:center;gap:10px;padding:8px 10px;background:var(--vib-bar);border-bottom:1px solid var(--vib-line)}
.vib-look-bar b{font-size:10.5px;letter-spacing:1.2px;color:${GOLD};white-space:nowrap}
.vib-ticks{display:flex;gap:4px;flex:1;min-width:0;overflow:hidden}
.vib-lsay{font-size:11px;color:#8e939c;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:60%;text-align:right}
.vib-ticks i{flex:0 1 24px;min-width:4px;height:3px;border-radius:2px;background:#33363d}
.vib-ticks i.done{background:#6b5d3c}
.vib-ticks i.at{background:${GOLD}}
.vib-look-body{flex:1 1 auto;display:flex;min-height:0}
.vib-stage{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:10px;padding:12px}
.vib-pic{flex:1 1 auto;min-height:0;display:flex;align-items:center;justify-content:center;background:#0b0c0d;border-radius:6px;overflow:hidden}
/* the notes beside the picture: a column of their own, read with it */
.vib-duo{position:relative;flex:1 1 auto;min-height:0;display:flex}
.vib-duo .vib-pic{flex:1 1 auto;min-width:0}
.vib-beside{position:absolute;left:0;bottom:0;max-height:100%;width:34%;max-width:440px;min-width:220px;z-index:4;
  background:rgba(11,12,13,.78);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);
  border-radius:0 6px 0 6px;border-right:1px solid #ffffff12;border-top:1px solid #ffffff12;overflow-y:auto;overscroll-behavior:contain;
  display:flex;flex-direction:column}
/* the words sit at the foot, as a caption does, and rise as there are more */
.vib-besidebody{margin-top:auto}
.vib-besidebody{padding:20px 24px 22px;font-size:13px;line-height:1.75;color:#d9d6cd;white-space:pre-wrap;word-break:break-word}
.vib-besidebody b{display:block;font-size:15px;font-weight:600;line-height:1.5;color:#f1ede5;margin-bottom:10px;padding-right:58px}
.vib-besidetab{position:absolute;left:0;top:50%;z-index:4;width:24px;height:96px;margin-top:-48px;border:0;border-radius:0 5px 5px 0;
  background:rgba(11,12,13,.72);color:#a9adb5;font-size:10px;font-weight:600;letter-spacing:1.4px;
  writing-mode:vertical-rl;transform:rotate(180deg);transform-origin:center;cursor:pointer;padding:0}
.vib-besidetab{border-radius:5px 0 0 5px}
.vib-besidetab:hover{color:${GOLD};background:rgba(20,21,24,.9)}
.vib-besidex{position:absolute;top:8px;right:8px;width:22px;height:22px;border:0;border-radius:4px;background:none;color:#6f747c;font-size:14px;cursor:pointer}
.vib-besidex:hover{color:${GOLD};background:#ffffff0a}
.vib-memohead{display:flex !important;align-items:center;justify-content:space-between}
.vib-besidebtn{border:0;background:none;color:#7a7f87;font-size:10px;letter-spacing:.4px;cursor:pointer;padding:0}
.vib-besidebtn:hover,.vib-besidebtn.on{color:${GOLD}}
/* TR: the notes in Korean, to read only */
.vib-trbtn{height:18px;padding:0 7px;border:1px solid #3a3d44;border-radius:999px;background:none;color:#8a8f98;
  font-size:9px;font-weight:700;letter-spacing:.8px;cursor:pointer;font-family:inherit}
.vib-trbtn:hover{border-color:${GOLD};color:${GOLD}}
.vib-trbtn.on{border-color:${GOLD};background:#d9b26a24;color:${GOLD}}
.vib-memohead .vib-hbtns{display:inline-flex;align-items:center;gap:10px}
.vib-beside .vib-trbtn{position:absolute;top:10px;right:36px;z-index:1;background:rgba(11,12,13,.6)}
.vib-trbtn.busy{opacity:.7}
/* the notes line by line, each translation under its own line */
.vib-besidebody .t{font-size:15px;font-weight:600;line-height:1.5;color:#f1ede5;padding-right:58px}
.vib-besidebody .t.tr{font-size:13.5px;font-weight:500;margin:2px 0 0}
.vib-besidebody .t + .l,.vib-besidebody .t + .gap,.vib-besidebody .t.tr + .l,.vib-besidebody .t.tr + .gap{margin-top:10px}
.vib-besidebody .gap{height:.9em}
.vib-besidebody .tr{color:#d6bf8c;font-family:"Pretendard","Noto Sans KR","Malgun Gothic",system-ui,sans-serif;
  word-break:keep-all;overflow-wrap:anywhere;padding-right:0}
.vib-besidebody .l.tr{margin:1px 0 6px;font-size:12.5px}
.vib-pic img{max-width:100%;max-height:100%;object-fit:contain;display:block}
/* words kept read as a page: the whole width, set at reading size, from the
   top - the first line, which names the idea, a little larger */
.vib-pic .q{align-self:stretch;width:100%;box-sizing:border-box;padding:26px 32px 32px;font-size:14px;line-height:1.75;color:#e2e0da;
  white-space:pre-wrap;overflow:auto;max-height:100%;text-align:left}
.vib-pic .q b{display:block;font-size:16.5px;font-weight:600;line-height:1.5;color:#f1ede5;margin-bottom:4px}
.vib-pic .q[contenteditable]{outline:none;cursor:text;caret-color:${GOLD}}
.vib-pic .q[contenteditable]:focus{box-shadow:inset 0 0 0 1px #5a4e30}
.vib-pic{position:relative;touch-action:none}
.vib-pic > img{transform-origin:center center;will-change:transform;cursor:zoom-in}
.vib-pic.zoomed > img{cursor:zoom-in}
body.vib-ctrl .vib-pic > img,body.vib-ctrl .vib-full-stage{cursor:zoom-out}
.vib-pic.panning > img,.vib-full-stage.panning{cursor:grabbing !important}
.vib-pic.zoomed .vib-hintpill{display:none}
.vib-ztools{position:absolute;right:10px;top:10px;display:flex;align-items:center;gap:2px;padding:3px;border-radius:999px;
  background:rgba(12,13,15,.82);opacity:0;transition:opacity .15s;z-index:2}
.vib-pic:hover .vib-ztools,.vib-pic.zoomed .vib-ztools,.vib-ztools.on{opacity:1}
.vib-full-doc{width:100%;height:100%;border:0;background:#fff;display:block}
.vib-covertool.vib-ztools.on{top:12px;bottom:auto}
.vib-ztools.on{top:auto;bottom:12px;right:auto;left:12px;background:${GOLD};padding:0;box-shadow:0 2px 10px rgba(0,0,0,.45)}
.vib-ztools.on button.full{width:auto;height:30px;padding:0 13px 0 11px;border-radius:999px;color:#17140d;
  font:700 10.5px system-ui,sans-serif;letter-spacing:.8px;display:flex;align-items:center;gap:6px}
.vib-ztools.on button.full:hover{background:#e6c27d;color:#17140d}
.vib-ztools button{width:26px;height:26px;border-radius:50%;border:0;background:none;color:#e8e4da;font-size:15px;line-height:1;cursor:pointer}
.vib-ztools button:hover{background:#2a2416;color:${GOLD}}
.vib-ztools button.full{font-size:13px}
.vib-ztools span{min-width:42px;text-align:center;font:600 10.5px system-ui,sans-serif;color:${GOLD};cursor:pointer;font-variant-numeric:tabular-nums}
.vib-full{position:fixed;inset:0;z-index:100000;background:#000;display:flex;flex-direction:column}
/* nothing but the picture: the bar and the arrows fade once the mouse rests,
   and come back as soon as it moves */
.vib-full .vib-full-bar,.vib-full .vib-full-go{transition:opacity .35s}
.vib-full.idle .vib-full-bar,.vib-full.idle .vib-full-go{opacity:0;pointer-events:none}
.vib-full.idle,.vib-full.idle .vib-full-stage{cursor:none}
.vib-full .vib-full-bar{position:absolute;left:0;right:0;bottom:0;z-index:3;background:rgba(0,0,0,.6)}
.vib-full-stage{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;overflow:hidden;cursor:zoom-in;touch-action:none}
.vib-full-stage.zoomed{cursor:zoom-in}
.vib-full-stage img{max-width:100%;max-height:100%;object-fit:contain;transform-origin:center center;will-change:transform}
.vib-full-bar{display:flex;align-items:center;gap:14px;padding:10px 16px;color:#c9ccd2;font:12px system-ui,sans-serif}
.vib-full-bar span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vib-full-stage{position:relative}
.vib-full-go{position:absolute;top:50%;z-index:2;width:52px;height:88px;margin-top:-44px;border:0;border-radius:6px;
  background:rgba(20,21,24,.55);color:#c9ccd2;font-size:40px;line-height:1;cursor:pointer;padding:0 0 6px}
.vib-full-go:hover{background:rgba(30,31,35,.85);color:${GOLD}}
.vib-full-go.prev{left:18px}
.vib-full-go.next{right:18px}
.vib-full-n{font-style:normal;color:#9a9fa8;font-variant-numeric:tabular-nums;white-space:nowrap}
.vib-full-bar b{color:${GOLD};font-weight:600;min-width:46px;text-align:right;font-variant-numeric:tabular-nums}
.vib-full .vib-btn{height:28px;padding:0 14px;border-radius:999px;background:#14161a;border:1px solid #33363d;color:#b9bdc5;
  font:700 10px system-ui,sans-serif;letter-spacing:.8px;text-transform:uppercase;cursor:pointer}
.vib-full .vib-btn:hover{border-color:${GOLD};color:#f0d9a8}
.vib-play{position:absolute;left:50%;top:50%;width:64px;height:64px;margin:-32px 0 0 -32px;border-radius:50%;border:0;
  background:${GOLD};display:flex;align-items:center;justify-content:center;padding-left:4px;box-shadow:0 2px 14px rgba(0,0,0,.5)}
.vib-play:hover{background:#e6c27d}
.vib-film{width:100%;height:100%;border:0;display:block;background:#000}
.vib-cardpic{position:relative}
.vib-card{position:relative}
.vib-stars{position:absolute;left:8px;top:8px;z-index:1;padding:2px 7px;border-radius:999px;background:rgba(12,13,15,.82);
  color:${GOLD};font-size:11px;letter-spacing:1px;line-height:1.5}
.vib-starrow .vib-starmark{color:${GOLD};font-weight:400;margin-right:6px}
.vib-siterow .vib-starmark{color:${GOLD};font-weight:400;margin-right:7px}
.vib-addf + .vib-rule{margin-top:10px}
.vib-f.vib-all>span{display:inline-flex;align-items:center}
.vib-allmark{display:inline-flex;color:${GOLD};margin-right:7px}
.vib-allmark svg{display:block}
.vib-siterow>span{display:inline-flex;align-items:center}
.vib-sitemark{display:inline-flex}
.vib-sitemark svg{display:block}
.vib-starbar{column-span:all;display:flex;flex-wrap:wrap;gap:8px;margin:0 0 10px}
.vib-seg{display:inline-flex;border:1px solid #33363d;border-radius:999px;overflow:hidden}
.vib-seg button{height:26px;padding:0 12px;border:0;background:#14161a;color:#b9bdc5;font-size:11px;letter-spacing:.4px}
.vib-seg button+button{border-left:1px solid #33363d}
.vib-seg button.on{background:#2a2416;color:${GOLD}}
.vib-seg button:hover{color:#f0d9a8}
.vib-starpick{display:flex;align-items:center;gap:4px}
.vib-starpick button{width:32px;height:32px;border-radius:50%;border:1px solid #33363d;background:#17181b;color:#5b5f68;font-size:16px;line-height:1;padding:0}
.vib-starpick button.on{color:${GOLD};border-color:#6b5d3c;background:#2a2416}
.vib-starpick button:hover{border-color:${GOLD};color:#f0d9a8}
.vib-starword{margin-left:8px;font-size:11.5px;color:#8e939c}
.vib-pdf-s{position:absolute;right:8px;bottom:8px;padding:3px 7px;border-radius:3px;background:rgba(12,13,15,.82);
  color:${GOLD};font:700 9.5px system-ui,sans-serif;letter-spacing:1px}
.vib-sound,.vib-doc{position:relative;height:110px;display:flex;align-items:center;justify-content:center;background:#121316;border-bottom:1px solid var(--vib-line)}
.vib-doc{height:140px;background:#e9e5dc}
.vib-doc svg path{stroke:#6b5d3c}
.vib-doc span{position:absolute;right:8px;bottom:7px;font:700 9.5px system-ui,sans-serif;letter-spacing:1px;color:#6b5d3c}
.vib-sound-play{position:absolute;left:8px;bottom:8px;width:26px;height:26px;border-radius:50%;background:${GOLD};color:#17140d;
  font-size:10px;display:flex;align-items:center;justify-content:center;cursor:pointer}
.vib-sound-play:hover{background:#e6c27d}
.vib-sound.big{height:auto;flex-direction:column;gap:16px;background:none;border:0;padding:30px;width:100%}
.vib-sound.big b{font-size:15px;font-weight:600;color:#e8e4da;text-align:center}
.vib-sound.big audio{width:min(480px,100%);color-scheme:dark}
.vib-film{color-scheme:dark}
.vib-pdf{background:#fff}
.vib-cardfilm{display:block;width:100%;height:auto;min-height:90px;background:#000}
.vib-chipfilm{height:100%;width:auto;display:block;background:#000}
.vib-hintpill{position:absolute;left:10px;bottom:10px;max-width:calc(100% - 20px);padding:6px 10px;border-radius:999px;
  background:rgba(12,13,15,.82);color:#e8e4da;font-size:11px;line-height:1.2;pointer-events:none;
  display:flex;align-items:center;gap:6px;opacity:0;transition:opacity .15s}
.vib-hintpill b{color:${GOLD};font-weight:600}
.vib-pic:hover .vib-hintpill{opacity:1}
/* while a picture is dragged out of the box, every place in a Series Book
   that can read it says so */
body.vib-dragging .lvr-well{outline:2px dashed ${GOLD};outline-offset:-4px;background:rgba(217,178,106,.10);position:relative}
body.vib-dragging .lvr-well::after{content:"Drop here to read it";position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);
  padding:6px 12px;border-radius:999px;background:${GOLD};color:#17140d;font:600 11px system-ui,sans-serif;white-space:nowrap;pointer-events:none}
body.vib-dragging .lvr-drop{outline:1px dashed ${GOLD};outline-offset:-4px;position:relative}
.lvr-drop.vib-arrived,.lvr-well.vib-arrived{outline:2px solid ${GOLD};outline-offset:-3px;transition:outline-color .3s}
.vib-play-s{position:absolute;left:8px;bottom:8px;width:24px;height:24px;border-radius:50%;background:${GOLD};color:#17140d;
  font-size:10px;display:flex;align-items:center;justify-content:center;padding-left:2px}
.vib-tools{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
.vib-btn.vib-cap{padding:0 11px;border-color:${GOLD};color:${GOLD};background:#1c1912}
.vib-btn.vib-cap:hover{background:#2a2416;color:#f3dcaa}
.vib-cap[disabled]{opacity:.6;cursor:progress}
.vib-nav2{display:flex;justify-content:space-between;align-items:center;gap:10px}
.vib-pic.scroll{display:block}
.vib-pscroll{position:absolute;inset:0;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain}
.vib-pcol{display:flex;flex-direction:column;align-items:center;gap:2px;padding:0 0 2px}
.vib-pcol img{display:block;width:100%;max-width:880px;height:auto;max-height:none;object-fit:contain;cursor:zoom-in;background:#111}
.vib-pcount{font-size:11px;font-weight:600;color:#e8e4da;padding:0 8px 0 10px;font-variant-numeric:tabular-nums}
.vib-ztools button.all{width:auto;padding:0 9px;border-radius:999px;font-size:11px;font-weight:600}
.vib-pstrip{flex:0 0 auto;display:flex;align-items:center;gap:6px;overflow-x:auto;overflow-y:hidden;padding:1px}
.vib-pth{position:relative;flex:0 0 auto;height:54px;border-radius:4px;overflow:hidden;border:1px solid #2a2c31;cursor:pointer;background:#0b0c0d}
.vib-pth.before{box-shadow:-5px 0 0 -2px ${GOLD}}
.vib-pth.after{box-shadow:5px 0 0 -2px ${GOLD}}
.vib-pth img{height:100%;width:auto;max-width:120px;object-fit:cover;display:block}
.vib-pth:hover{border-color:#5a4e30}
.vib-pth.on{border-color:${GOLD};box-shadow:0 0 0 1px ${GOLD}}
.vib-pth .no{position:absolute;left:3px;top:3px;font-size:9.5px;font-weight:700;color:#f1ede5;background:#000000a6;border-radius:3px;padding:0 4px;line-height:14px}
.vib-pth.on .no{color:${GOLD}}
.vib-pth .tl{position:absolute;right:3px;top:3px;display:none;gap:3px}
.vib-pth:hover .tl,.vib-pth .tl.armed{display:flex}
.vib-pth .tl button{height:16px;min-width:16px;padding:0 4px;border-radius:3px;border:0;background:#000000b3;color:#e8e4da;font-size:10px;line-height:16px;cursor:pointer}
.vib-pth .tl button:hover{color:${GOLD}}
.vib-pth .tl button.armed{background:#2a1715;color:#f0b8b0;font-weight:700}
.vib-padd{flex:0 0 auto;height:54px;min-width:54px;padding:0 14px;border-radius:4px;border:1px dashed #4a4d55;background:none;color:#a9adb5;font-size:11px;letter-spacing:.3px;cursor:pointer}
.vib-padd:hover{border-color:${GOLD};color:${GOLD}}
.vib-phint{font-size:10.5px;color:#7a7f87;white-space:nowrap}
.vib.over .vib-pstrip .vib-padd{border-color:${GOLD};color:${GOLD};background:#2a2416}
.vib-count{position:absolute;right:6px;bottom:6px;display:inline-flex;align-items:center;gap:4px;height:18px;padding:0 6px;border-radius:9px;background:#000000a6;color:#f1ede5;font-size:10.5px;font-weight:600;pointer-events:none}
.vib-pth .tm{position:absolute;right:3px;bottom:3px;font-size:9px;font-weight:600;color:#f1ede5;background:#000000a6;border-radius:3px;padding:0 4px;line-height:13px;pointer-events:none}
.vib-pth.film{display:flex;align-items:center;justify-content:center;gap:5px;width:74px;color:#cfc9bc;font:700 10px system-ui,sans-serif;letter-spacing:.8px}
.vib-pth.film svg{width:11px;height:11px;fill:currentColor}
.vib-pth.film.on{color:${GOLD}}
.vib-ztools.on i.sep{width:1px;height:16px;background:#17140d40}
.vib-btn.vib-done{height:42px;font-size:12px;letter-spacing:1.2px;margin-bottom:4px}
.vib-nav2 span{font-size:11px;color:#8e939c;text-align:center}
.vib-side{flex:0 0 340px;border-left:1px solid var(--vib-line);display:flex;flex-direction:column;min-height:0}
.vib-sidescroll{flex:1 1 auto;min-height:0;overflow-y:auto;padding:0 14px}
.vib-sidescroll .vib-sec:last-child{border-bottom:0}
.vib-sec{padding:14px 0;border-bottom:1px solid var(--vib-line);display:block}
.vib-kws{display:flex;flex-wrap:wrap;gap:5px;align-items:center}
.vib-kwon{display:inline-flex;align-items:center;height:22px;border-radius:11px;background:${GOLD};color:#1a1710;padding:0 2px 0 10px;letter-spacing:0;font-size:11px}
.vib-kwon b,.vib-crumb .vib-kwon b{font-weight:700;color:#14110a}
.vib-kwon button{border:0;background:none;color:#3a2f15;font-size:13px;width:20px;height:100%;cursor:pointer;padding:0}
.vib-kwon button:hover{color:#000}
.vib-kwclear{border:0;background:none;color:#8e939c;font-size:10.5px;letter-spacing:.6px;cursor:pointer;padding:0 4px}
.vib-kwclear:hover{color:${GOLD}}
.vib-kwindex{column-span:all;display:flex;flex-direction:column;gap:14px;padding:4px 2px 16px;margin-bottom:12px;border-bottom:1px solid var(--vib-line)}
.vib-kwgrp .vib-h{margin-bottom:8px;white-space:pre}
.vib-kwbody{display:flex;flex-direction:column;gap:14px}
.vib-kwindex.band{gap:8px;padding-bottom:10px}
.vib-kwindex.band .vib-kwbody{height:var(--kwh,190px);overflow-y:auto;padding-right:6px}
.vib-kwgrip{height:9px;margin:-4px 0 -6px;cursor:row-resize;position:relative}
.vib-kwgrip::after{content:"";position:absolute;left:50%;top:3px;width:36px;height:3px;margin-left:-18px;border-radius:2px;background:#3a3c42}
.vib-kwgrip:hover::after,.vib-kwgrip.on::after{background:${GOLD}}
.vib-kwindex.folded{padding-bottom:6px}
.vib-kwhead{display:flex;align-items:center;gap:10px}
.vib-kwhead .vib-h{margin:0;white-space:pre}
.vib-kwfold{border:0;background:none;color:#a9adb5;font-size:10.5px;letter-spacing:.6px;cursor:pointer;padding:0}
.vib-kwfold:hover{color:${GOLD}}
.vib-kwmore{border:1px dashed #44474e;background:none;color:#a9adb5;height:26px;padding:0 12px;border-radius:13px;font-size:11.5px;cursor:pointer}
.vib-kwmore:hover{border-color:${GOLD};color:${GOLD}}
.vib-kwjoin{font-style:normal;font-size:10px;color:#7a7f87;letter-spacing:.4px}
.vib-kwpick{display:inline-flex;align-items:center;gap:7px;height:26px;padding:0 10px 0 12px;border-radius:13px;background:#17181b;border:1px solid #33363d;
  color:#e8e4da;font-size:12px;cursor:pointer;white-space:nowrap}
.vib-kwpick em{font-style:normal;font-size:10.5px;color:#7a7f87;font-variant-numeric:tabular-nums}
.vib-kwpick:hover{border-color:#5a4e30}
.vib-kwpick.on,.vib .vib-kwpick.on{background:${GOLD};border-color:${GOLD};color:#14110a;font-weight:700}
.vib-kwpick.on em{color:#5a4a20}
.vib-kw{display:inline-flex;align-items:center;height:24px;border-radius:12px;background:#17181b;border:1px solid #33363d;overflow:hidden;max-width:100%}
.vib-kw i{font-style:normal;font-size:9.5px;letter-spacing:.4px;color:#8e939c;padding:0 0 0 9px;white-space:nowrap}
.vib-kw .t{border:0;background:none;color:#e8e4da;font-size:11.5px;padding:0 4px 0 6px;height:100%;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vib-kw:not(:has(i)) .t{padding-left:10px}
.vib-kw .t:hover{color:${GOLD}}
.vib-kw .x{border:0;background:none;color:#6f747c;font-size:12px;width:20px;height:100%;cursor:pointer;opacity:0}
.vib-kw:hover .x{opacity:1}
.vib-kw .x:hover{color:#f0b8b0}
.vib-kw.own{border-color:#5a4e30}
.vib-kwadd{height:24px;width:92px;box-sizing:border-box;border-radius:12px;border:1px dashed #44474e;background:none;color:#e8e4da;font-size:11.5px;padding:0 10px;outline:none}
.vib-kwadd:focus{border-style:solid;border-color:${GOLD};width:150px}
.vib-kwadd::placeholder{color:#7a7f87}
.vib-memo{width:100%;min-height:80px;height:128px;resize:vertical;padding:9px 10px;background:#0c0d0f;border:1px solid #33363d;
  border-radius:6px;color:#e2e4e8;font:12.5px/1.5 system-ui,sans-serif;outline:none;display:block}
.vib-memo:focus{border-color:${GOLD}}
.vib-h{font-size:10px;font-weight:700;letter-spacing:1.2px;color:#8e939c;margin-bottom:7px;display:block}
.vib-note{width:100%;height:36px;padding:0 10px;background:#0c0d0f;border:1px solid #33363d;border-radius:6px;
  color:#e2e4e8;font:13px system-ui,sans-serif;outline:none}
.vib-note:focus{border-color:${GOLD}}
.vib-hint{font-size:11px;color:#8e939c;margin-top:6px;display:block}
.vib-chips{display:flex;flex-wrap:wrap;gap:6px}
.vib-fpick{display:flex;flex-direction:column;gap:8px}
.vib-ftops{display:flex;flex-wrap:wrap;gap:6px}
.vib-fc.top{font-weight:600}
.vib-fpair{display:inline-flex}
.vib-fpair .vib-fc{border-top-right-radius:0;border-bottom-right-radius:0;padding-right:8px}
.vib-fopen{position:relative;height:30px;min-width:26px;padding:0 8px 0 6px;border-radius:0 999px 999px 0;background:#17181b;border:1px solid #33363d;
  border-left:0;color:#8e939c;font-size:13px;cursor:pointer}
.vib-fopen:hover{color:${GOLD}}
.vib-fpair.open .vib-fopen{color:${GOLD};background:#0d0d0f}
/* the idea is in a folder inside this one: chip and opener drawn in gold */
.vib-fpair.has .vib-fc:not(.on),.vib-fpair.has .vib-fopen{border-color:${GOLD};color:${GOLD}}
.vib-fpair.has .vib-fc:not(.on) i{color:${GOLD}}
.vib-fpair.has .vib-fc.on+.vib-fopen{border-color:${GOLD}}
.vib-fkids{flex:0 0 100%;display:flex;flex-wrap:wrap;gap:6px;padding:10px 10px 11px;margin:2px 0;background:#00000066;box-shadow:inset 0 2px 0 ${GOLD};border-radius:0 0 5px 5px}
.vib-fc{height:30px;padding:0 11px;border-radius:999px;background:#17181b;border:1px solid #33363d;color:#d6d9de;font-size:12px;
  display:inline-flex;align-items:center;gap:7px}
.vib-fc i{font-style:normal;color:#8e939c;font-size:11px}
.vib-fc small{font-size:10.5px;color:#8e939c;margin-right:-3px}
.vib-fc.on small{color:#5a4a22}
.vib-fc:hover{border-color:${GOLD}}
.vib-fc.on{background:${GOLD};border-color:${GOLD};color:#17140d;font-weight:600}
.vib-fc.on i{color:#5a4a22}
.vib-src{font-size:12px;color:${GOLD};text-decoration:none;word-break:break-all}
.vib-src:hover{color:#f0d9a8}
.vib-meta{font-size:11px;color:#8e939c;margin-top:4px;display:block}
.vib-infotab{display:flex;flex-direction:column;gap:3px}
.vib-infotab .r{display:grid;grid-template-columns:68px minmax(0,1fr);gap:8px;font-size:11.5px;line-height:1.45}
.vib-infotab .k{color:#8e939c}
.vib-infotab .v{color:#d6d9de;font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vib-acts{flex:0 0 auto;padding:12px 14px 14px;border-top:1px solid var(--vib-line);display:flex;flex-direction:column;gap:6px}
.vib-acts .row{display:flex;gap:6px}
.vib-acts .row .vib-btn{flex:1}
`;

function ensureCSS() {
  installTips();
  if (document.getElementById("vib-css")) return;
  const s = document.createElement("style");
  s.id = "vib-css";
  s.textContent = CSS;
  document.head.appendChild(s);
}

/* ---- tooltips ----
   Every title in the box is read on hover and shown as a card, as the Series
   Book and the Series Layout show theirs: what the thing is first, then each
   action - click, Ctrl+click, drag... - on a row of its own under a gold
   label. The card goes on a click, the wheel or a key. */
const TIP_ACT = "Ctrl\\+Shift\\+click|Shift\\+click|Ctrl\\+click|Ctrl\\+Enter|Alt\\+click|Shift\\+drag|Double-click|Double click|Right click|Click|Drag|Drop|Wheel|Enter|Esc";
const TIP_SPLIT = new RegExp(`(?:\\n|\\s-\\s|(?<=\\.)\\s+|;\\s*|,\\s+|\\s\\u00b7\\s)(?=(?:${TIP_ACT})\\b)`, "i");
const TIP_HEAD = new RegExp(`^(${TIP_ACT})\\b[:\\s-]*`, "i");
function tipEsc(t) {
  return String(t == null ? "" : t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
function tipParse(text) {
  const segs = String(text || "").split(TIP_SPLIT).map(x => x.trim()).filter(Boolean);
  const rows = [], desc = [];
  for (const seg of segs) {
    const m = TIP_HEAD.exec(seg);
    if (m) {
      let rest = seg.slice(m[0].length).replace(/^(?:to|for)\s+/i, "").replace(/[\s.]+$/, "");
      rest = rest ? rest[0].toUpperCase() + rest.slice(1) : "";
      const k = m[1].replace(/\b\w/g, c => c.toUpperCase()).replace(/Click\b/g, (x, i) => i ? "click" : x)
        .replace(/Drag\b/g, (x, i) => i ? "drag" : x);
      rows.push([k, rest]);
    } else desc.push(seg);
  }
  const lines = desc.join("\n").split("\n").map(x => x.trim()).filter(Boolean);
  let head = "";
  if (lines.length && (lines.length > 1 || rows.length) && lines[0].length <= 70) head = lines.shift();
  const cap = (x) => x ? x[0].toUpperCase() + x.slice(1) : x;
  return { head: cap(head), body: cap(lines.join("\n")), rows };
}
const TIP = { el: null, card: null, t: 0 };
function tipHide() {
  clearTimeout(TIP.t);
  TIP.el = null;
  if (TIP.card) { TIP.card.remove(); TIP.card = null; }
}
function tipShow(el) {
  if (el.dataset.tipcard) return tipCardShow(el);
  const t = tipParse(el.dataset.tip);
  if (!t.head && !t.body && !t.rows.length) return;
  const card = document.createElement("div");
  card.className = "vib-tip";
  card.innerHTML = (t.head ? `<div class="ch"><b>${tipEsc(t.head)}</b></div>` : "")
    + (t.body ? `<div class="en">${tipEsc(t.body)}</div>` : "")
    + (t.rows.length ? `<div class="hint">` + t.rows.map(([k, v]) =>
        `<div class="hr"><b>${tipEsc(k)}</b><span>${tipEsc(v)}</span></div>`).join("") + `</div>` : "");
  document.body.appendChild(card);
  TIP.card = card;
  const r = el.getBoundingClientRect(), b = card.getBoundingClientRect();
  const W = window.innerWidth, H = window.innerHeight;
  const left = Math.max(8, Math.min(r.left, W - b.width - 8));
  let top = r.bottom + 6;
  if (top + b.height > H - 8) top = Math.max(8, r.top - b.height - 6);
  card.style.left = `${left}px`;
  card.style.top = `${top}px`;
}
/* An idea's card on the wall: its tip is the idea itself - its title, its
   notes, who made it - with what the hand does in small at the foot. */
function tipCardShow(el) {
  let d;
  try { d = JSON.parse(el.dataset.tipcard); } catch (e) { return; }
  const card = document.createElement("div");
  card.className = "vib-tip vib-tipcard";
  card.innerHTML = (d.title ? `<div class="ch"><b>${tipEsc(d.title)}</b></div>` : "")
    + (d.words ? `<div class="words">${tipEsc(d.words)}</div>` : "")
    + (d.kws && d.kws.length ? `<div class="kws">` + d.kws.map(([k, t]) => `<span>${k ? `<i>${tipEsc(k)}</i>` : ""}${tipEsc(t)}</span>`).join("") + `</div>` : "")
    + (d.meta ? `<div class="meta">${tipEsc(d.meta)}</div>` : "")
    + `<div class="how"><b>Click</b> to open · <b>Drag</b> onto a folder, or the Series Book's Reader</div>`;
  document.body.appendChild(card);
  TIP.card = card;
  const r = el.getBoundingClientRect(), b = card.getBoundingClientRect();
  const W = window.innerWidth, H = window.innerHeight;
  /* beside the card, where there is room - so the card itself stays seen */
  let left = r.right + 10;
  if (left + b.width > W - 8) left = r.left - b.width - 10;
  if (left < 8) left = Math.max(8, Math.min(r.left, W - b.width - 8));
  const top = Math.max(8, Math.min(r.top, H - b.height - 8));
  card.style.left = `${left}px`;
  card.style.top = `${top}px`;
}
function installTips() {
  if (window.__vibTips) return;
  window.__vibTips = true;
  document.addEventListener("pointerover", (e) => {
    const t = e.target instanceof Element ? e.target : null;
    let el = t ? t.closest("[title], [data-tip], [data-tipcard]") : null;
    if (el && !el.closest(".vib, .vib-full")) el = null;
    if (el && el.hasAttribute("title")) {
      const v = el.getAttribute("title");
      el.removeAttribute("title");
      if (v) el.dataset.tip = v;
    }
    if (el === TIP.el) return;
    tipHide();
    if (!el || (!el.dataset.tip && !el.dataset.tipcard)) return;
    TIP.el = el;
    arm(el);
  });
  /* A card shows only where the pointer rests: each move starts the wait
     again, and a move away from where it showed puts it away - it never
     follows the pointer. Half a second of rest is enough. */
  const arm = (el) => {
    clearTimeout(TIP.t);
    TIP.t = setTimeout(() => {
      if (TIP.el === el && el.isConnected && !TIP.card) { tipShow(el); TIP.at = TIP.xy; }
    }, 500);
  };
  document.addEventListener("pointermove", (e) => {
    TIP.xy = [e.clientX, e.clientY];
    const el = TIP.el;
    if (!el) return;
    if (TIP.card) {
      const [x, y] = TIP.at || TIP.xy;
      if (Math.abs(e.clientX - x) + Math.abs(e.clientY - y) > 8) { TIP.card.remove(); TIP.card = null; arm(el); }
      return;
    }
    arm(el);
  }, { passive: true });
  const off = () => tipHide();
  document.addEventListener("pointerdown", off, true);
  document.addEventListener("wheel", off, { passive: true, capture: true });
  document.addEventListener("dragstart", off, true);
  document.addEventListener("keydown", off, true);
  window.addEventListener("blur", off);
}


function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

const SEARCH_SVG = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#8e939c" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>`;
const HELP_HTML = `
<section>
  <h5>KEEP - IN A SECOND</h5>
  <p><b>Paste</b> or <kbd>Ctrl</kbd>+<kbd>V</kbd> on the node: a screenshot, a picture, a line of text, a web address.</p>
  <p><b>Drag</b> a picture or a link from the browser onto the node - onto a <b>folder</b> to put it straight there.</p>
  <p>With a folder open, what is pasted or written goes into it.</p>
  <p>A web page comes with its picture, its title and its description. A YouTube or Vimeo link plays in the node, and so does a film file - mp4, mov, webm; a large one through the inbox. Sounds (mp3, wav, m4a, ogg, flac) play from the wall with ▶, and a PDF opens with its pages in the node.</p>
  <p>The box at the bottom keeps a thought of your own - <kbd>Ctrl</kbd>+<kbd>Enter</kbd>.</p>
  <p>Anything saved into the <b>inbox</b> folder comes in by itself - its path is at the bottom right; click to copy it. A sub-folder there, <b>inbox/VOGUE/</b>, goes straight into the folder of that name.</p>
</section>
<section>
  <h5>SORT - WHEN THERE IS A MINUTE</h5>
  <p>What came in waits under <b>New</b>. <b>Sort</b> goes through it one at a time.</p>
  <p><b>Notes</b> - the first line is the title. Leave them empty if the picture says it all.</p>
  <p>A <b>folder</b> by its number key - more than one if it fits. A folder chosen and it is sorted.</p>
  <p><kbd>Enter</kbd> the next one · <kbd>Esc</kbd> back to the wall.</p>
  <p><b>Stars</b> - ★ Like, ★★ Love, ★★★ Next series. <kbd>S</kbd> steps through them. <b>Starred</b> shows them, the most wanted first or the <b>longest unseen</b> first.</p>
  <p>A picture: the <b>wheel</b> zooms, a <b>click</b> zooms in, <kbd>Ctrl</kbd>+click out, a drag moves it. <b>⤢</b> or <kbd>F</kbd> - the whole window. <kbd>*</kbd> 100% · <kbd>/</kbd> fit. Zoomed in, the arrows move round it.</p>
</section>
<section>
  <h5>FIND - AGAIN</h5>
  <p><b>Search</b> the notes, folders and addresses.</p>
  <p>The <b>slider</b> over the wall makes the ideas smaller or larger.</p>
  <p><b>TR</b> on the notes over the picture puts each line's translation under it, in your browser's language - only to read, the notes stay as written. Chrome's own translator, nothing leaves the machine.</p>
  <p><b>Keywords</b> are found in the notes - photographer, stylist, magazine, names. Click one for every idea with it; add your own under the notes.</p>
  <p><b>Sites</b>, at the foot of the folders, lays your bookmarks on the wall: click one to open it in a new tab, right click to change or remove it, drag to move it, <b>+ Site</b> to add one.</p>
  <p><b>Shuffle</b> shows a folder in a random order, to meet the forgotten ones.</p>
  <p>Folders: <b>+ Folder</b> adds one, double click to rename, <b>×</b> to take it away.</p>
  <p>Drag a folder by the top or bottom edge of another to move it there; onto the <b>middle</b> of a folder to put it inside; onto <b>All ideas</b> to bring it back to the top.</p>
  <p>Drag the right edge of the folders to make them wider; double click it for the width they had.</p>
  <p><b>+</b> on a folder makes a folder inside it; <b>▾</b> folds it. A folder shows its own ideas and those of the folders inside it.</p>
</section>
<section>
  <h5>USE - IN THE SERIES BOOK</h5>
  <p><b>Drag a picture</b> from the box onto the Reader in the Series Book - the panel under its Editing line - tick the anchors and <b>Read</b> it there. While you drag, the Reader lights up.</p>
  <p><b>Read in Book</b> puts the picture into the Reader of the open prompt in one press.</p>
  <p><b>✎ Brief</b> over the wall puts the ideas shown as a request for the AI that writes the series - copied, with the pictures saved and numbered to attach.</p>
  <p><b>Start a series with this</b> opens a new series with the picture, and the notes in its production notes.</p>
  <p><b>Capture the page</b> keeps a picture of the page itself in place of its share picture.</p>
  <p><b>More pictures</b>: with a picture idea open, drop or paste more pictures from the same page - or press <b>+</b> under it. They stay in one idea; <b>◉</b> makes one the picture on the wall.</p>
  <p>Words kept as an idea are changed in place - click on the page and type.</p>
  <p><b>Cancel</b> puts back what was changed on an idea since it was opened, and goes back to the wall.</p>
  <p><b>My works</b>, at the foot of the folders, keeps your own renders - from the Series Layout and the Image Viewer. <b>◫ Pin</b> on the picture (<kbd>C</kbd>) keeps an idea on the left while you step through others beside it.</p>
</section>`;

const SOUND_SVG = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg>`;
const SOUND_BIG_SVG = `<svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="${GOLD}" stroke-width="1.4" aria-hidden="true"><path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg>`;
const DOC_SVG = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4"/></svg>`;
const DOC_BIG_SVG = `<svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="${GOLD}" stroke-width="1.4" aria-hidden="true"><path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4"/><path d="M9 12h6M9 15h6M9 18h4"/></svg>`;
const PASTE_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><rect x="8" y="3" width="8" height="4" rx="1"/><path d="M16 5h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2"/></svg>`;
/* My works: a folder, drawn in a line as the rest */
/* a painter's palette: every idea in the box, the references and the
   rest, before they are sorted anywhere */
const IDEAS_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"><path d="M12 3.2c-5 0-9 3.7-9 8.4 0 4.4 3.6 8.2 8.2 8.2 1.4 0 2.1-.8 2.1-1.8 0-.5-.2-.9-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1 .8-1.8 1.8-1.8h2.3c2.8 0 4.6-1.9 4.6-4.4C21 6.6 17 3.2 12 3.2z"/><circle cx="7.6" cy="11.3" r="1.1" fill="currentColor" stroke="none"/><circle cx="10.4" cy="7.6" r="1.1" fill="currentColor" stroke="none"/><circle cx="15" cy="7.4" r="1.1" fill="currentColor" stroke="none"/><circle cx="17.6" cy="10.8" r="1.1" fill="currentColor" stroke="none"/></svg>`;
/* the sites: a globe, and the two it starts with - any can be changed or
   taken out, and more added; this is only the first fill. */
const SITES_SVG = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.6 3.9 5.6 3.9 9s-1.3 6.4-3.9 9c-2.6-2.6-3.9-5.6-3.9-9S9.4 5.6 12 3z"/></svg>`;
const DEFAULT_SITES = [
  { name: "Vogue Runway", url: "https://www.vogue.com/fashion-shows" },
  { name: "Fashion Editorials", url: "https://fashioneditorials.com" },
];
const WORKS_SVG = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.6l2 2.2h8.4A1.5 1.5 0 0 1 21 8.7v9.8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"/></svg>`;
const STACK_SVG = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><rect x="7" y="7" width="13" height="13" rx="1.5"/><path d="M4 16V5a1 1 0 0 1 1-1h11"/></svg>`;
const PLAY_SVG = `<svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="#17140d"/></svg>`;
const DROP_SVG = `<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="${GOLD}" stroke-width="1.6" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 19h14"/></svg>`;

/* An idea's picture. Its file name is in the address, so a picture that was
   replaced - a page captured in place of its share picture - is not shown
   from the browser's cache. */
function picURL(it, side, file) {
  return api.apiURL(`${PICTURE_URL}?id=${encodeURIComponent(it.id)}&v=${encodeURIComponent(file || it.file || "")}${side ? `&s=${side}` : ""}`);
}
/* every picture of an idea, its own first - the rest are those from the same
   page, kept with it */
/* the words of one picture of an idea: its own picture's are the idea's
   notes; another's, those it came with - or, with none, the idea's */
const picNote = (it, f, memo) => {
  const own = [it.note, it.memo].map(x => String(x || "").trim()).filter(Boolean).join("\n");
  const base = memo != null ? memo : own;
  if (!f || f === it.file) return base;
  const m = (it.more || []).find(x => x.file === f);
  return (m && m.note) || base;
};
const picsOf = (it) => (it && it.file ? [it.file, ...((it.more || []).map(m => m.file))] : []);
const picEntry = (it, f) => (f === it.file ? { file: it.file, w: it.w, h: it.h, bytes: it.bytes }
  : (it.more || []).find(m => m.file === f) || { file: it.file, w: it.w, h: it.h, bytes: it.bytes });

/* A film that can be played in the node: the player address for a YouTube
   or Vimeo link, or null. */
function videoOf(url) {
  const u = String(url || "");
  let m = u.match(/(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})/i);
  if (m) {
    const t = u.match(/[?&#](?:t|start)=(\d+)/);
    return `https://www.youtube-nocookie.com/embed/${m[1]}?autoplay=1&rel=0${t ? `&start=${t[1]}` : ""}`;
  }
  m = u.match(/vimeo\.com\/(?:video\/)?(\d+)/i);
  if (m) return `https://player.vimeo.com/video/${m[1]}?autoplay=1`;
  return null;
}

/* ---- stills from a film: the frame a kept film shows now, at its own
   size, as a picture */
const toJpeg = (cv) => new Promise(r => cv.toBlob(b => r(b), "image/jpeg", 0.95));
async function stillOfVideo(v) {
  if (!v.videoWidth) throw new Error("the film has no frame to show yet");
  const cv = document.createElement("canvas");
  cv.width = v.videoWidth;
  cv.height = v.videoHeight;
  cv.getContext("2d").drawImage(v, 0, 0);
  return toJpeg(cv);
}

/* folders are paths: "VOGUE/Runway" is Runway, inside VOGUE */
const nameOf = (p) => String(p || "").split("/").pop();
const parentOf = (p) => { const i = String(p || "").lastIndexOf("/"); return i < 0 ? "" : p.slice(0, i); };
const depthOf = (p) => String(p || "").split("/").length - 1;
/* an idea is in a folder when it is in it or in a folder inside it */
const inFolder = (it, f) => (it.folders || []).some(x => x === f || x.startsWith(f + "/"));

/* A kept film, as its own picture: the browser draws the first frame from
   the film itself, so the server makes nothing. Under the pointer it plays,
   muted, and stops again when the pointer leaves. */
/* The moment a film is shown at on the wall: the one chosen for it, or -
   since a film often opens on black, fading in as the Series Layout's do -
   a fifth of the way in, between a second and a half and eight seconds. */
function coverTime(it, duration) {
  if (Number.isFinite(it.coverT)) return Math.min(it.coverT, Math.max(0, (duration || it.coverT) - 0.05));
  if (!Number.isFinite(duration) || duration <= 0) return 0.1;
  if (duration < 3) return duration / 2;
  return Math.min(8, Math.max(1.5, duration * 0.2));
}
function filmEl(it, cls) {
  const v = document.createElement("video");
  if (cls) v.className = cls;
  v.src = picURL(it, 0) + (Number.isFinite(it.coverT) ? `#t=${it.coverT}` : "");
  v.muted = true;
  v.playsInline = true;
  v.preload = "metadata";
  v.loop = true;
  let at = 0.1;
  v.addEventListener("loadedmetadata", () => {
    at = coverTime(it, v.duration);
    try { v.currentTime = at; } catch (e) { /* not seekable yet */ }
  }, { once: true });
  v.addEventListener("mouseenter", () => { v.play().catch(() => {}); });
  v.addEventListener("mouseleave", () => { v.pause(); try { v.currentTime = at; } catch (e) { /* not loaded yet */ } });
  return v;
}

/* A picture that can be looked into: the wheel zooms about the pointer,
   a drag moves it once it is larger than its frame, a click zooms in and
   Ctrl+click out. At fit size it stays draggable - onto a Series Book anchor.
   Zoomed past the small copy, the whole picture is fetched. The canvas may
   itself be zoomed, so pointer travel is divided by its scale. */
/* Ctrl held: every picture that zooms says it will zoom out - one watch for
   the whole page, not one for each picture opened */
let ctrlWatched = false;
function watchCtrl() {
  if (ctrlWatched) return;
  ctrlWatched = true;
  const mark = (e) => document.body.classList.toggle("vib-ctrl", !!(e.ctrlKey || e.metaKey));
  window.addEventListener("keydown", mark, true);
  window.addEventListener("keyup", mark, true);
  window.addEventListener("blur", () => document.body.classList.remove("vib-ctrl"));
}

function zoomable(box, img, fullSrc, onZoom, naturalW) {
  watchCtrl();
  let z = 1, x = 0, y = 0, whole = false;
  const scale = () => (box.offsetWidth ? box.getBoundingClientRect().width / box.offsetWidth : 1) || 1;
  const apply = () => {
    img.style.transform = `translate(${x}px, ${y}px) scale(${z})`;
    img.draggable = z === 1;
    box.classList.toggle("zoomed", z > 1);
    if (z > 1.4 && !whole && fullSrc) { whole = true; img.src = fullSrc; }
    /* the size said is the file's own: 100% is a pixel of it to a pixel of the screen */
    const nat = (naturalW && naturalW()) || img.naturalWidth;
    const real = nat ? (z * img.offsetWidth * scale()) / nat : z;
    if (onZoom) onZoom(z, real);
  };
  const at = (e) => {
    const r = box.getBoundingClientRect(), k = scale();
    return [(e.clientX - r.left - r.width / 2) / k, (e.clientY - r.top - r.height / 2) / k];
  };
  function zoomTo(z2, px = 0, py = 0) {
    z2 = Math.max(1, Math.min(12, z2));
    x = px - (px - x) * (z2 / z);
    y = py - (py - y) * (z2 / z);
    z = z2;
    if (z <= 1.001) { z = 1; x = 0; y = 0; }
    apply();
  }
  box.addEventListener("wheel", (e) => {
    e.preventDefault();
    const [px, py] = at(e);
    zoomTo(z * Math.pow(1.0018, -e.deltaY), px, py);
  }, { passive: false });
  /* a click zooms in on the spot, Ctrl+click out, as in the Image Viewer;
     a click that was a drag only moved the picture */
  let moved = false;
  box.addEventListener("click", (e) => {
    if (e.button !== 0 || (e.target.closest && e.target.closest("button, a, iframe, video"))) return;
    if (moved) { moved = false; return; }
    const [px, py] = at(e);
    zoomTo(e.ctrlKey || e.metaKey ? z / 2 : z * 2, px, py);
  });
  box.addEventListener("pointerdown", (e) => {
    moved = false;
    if (z === 1 || e.button !== 0 || (e.target.closest && e.target.closest("button"))) return;
    e.preventDefault(); e.stopPropagation();
    const host = box.closest && box.closest(".vib");
    if (host) host.focus({ preventScroll: true });     // the keys stay with the box
    const k = scale(), sx = e.clientX, sy = e.clientY, ox = x, oy = y;
    /* the hand shows only once the picture is being moved, as in the Image Viewer */
    const mv = (ev) => {
      if (!moved && Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) > 4) {
        moved = true;
        box.classList.add("panning");
      }
      x = ox + (ev.clientX - sx) / k; y = oy + (ev.clientY - sy) / k; apply();
    };
    const up = () => {
      box.classList.remove("panning");
      window.removeEventListener("pointermove", mv, true);
      window.removeEventListener("pointerup", up, true);
    };
    window.addEventListener("pointermove", mv, true);
    window.addEventListener("pointerup", up, true);
  });
  /* 100%: a pixel of the file to a pixel of the screen, as in the Image
     Viewer - the file's own width against the width it is shown at */
  function actual() {
    const nat = (naturalW && naturalW()) || img.naturalWidth;
    const shown = img.offsetWidth * scale();
    if (!nat || !shown) return;
    zoomTo(Math.max(1, nat / shown), 0, 0);
  }
  apply();
  /* the arrow keys move a zoomed picture, as in the Image Viewer */
  function pan(dx, dy) {
    if (z === 1) return false;
    x += dx; y += dy;
    apply();
    return true;
  }
  return { zoomBy: (k) => zoomTo(z * k), reset: () => zoomTo(1), actual, pan, get z() { return z; } };
}

/* The picture over the whole window, to be looked at as large as the
   screen allows - the same wheel, drag and clicks. Esc or F, the key
   that opened it, closes it. */
function fullView(src, title, kind, list, at) {
  const wrap = document.createElement("div");
  wrap.className = "vib-full";
  const stage = document.createElement("div");
  stage.className = "vib-full-stage";
  /* a PDF over the whole window is the browser's reader again, larger */
  const doc = kind === "pdf";
  const img = document.createElement(doc ? "iframe" : "img");
  img.src = src;
  if (doc) { img.className = "vib-full-doc"; img.title = title || "PDF"; }
  else { img.alt = title || ""; img.draggable = false; }
  stage.appendChild(img);
  const bar = document.createElement("div");
  bar.className = "vib-full-bar";
  const name = document.createElement("span");
  name.textContent = title || "";
  const pct = document.createElement("b");
  const close = document.createElement("button");
  close.className = "vib-btn";
  close.textContent = "Close";
  /* an idea of several pictures: the others are a step away - the arrows
     at the sides, ← → on the keyboard while the picture is not zoomed */
  const many = !doc && Array.isArray(list) && list.length > 1;
  let k = many ? Math.max(0, Math.min(list.length - 1, at || 0)) : 0;
  const count = document.createElement("em");
  count.className = "vib-full-n";
  let go = null;
  if (many) {
    const prev = document.createElement("button"), next = document.createElement("button");
    prev.className = "vib-full-go prev"; prev.textContent = "‹"; prev.title = "The picture before (←)";
    next.className = "vib-full-go next"; next.textContent = "›"; next.title = "The next picture (→)";
    for (const b of [prev, next]) b.addEventListener("pointerdown", (e) => e.stopPropagation());
    go = (d) => {
      k = (k + d + list.length) % list.length;
      img.src = list[k];
      if (zm) zm.reset();
      count.textContent = `${k + 1} / ${list.length}`;
    };
    prev.addEventListener("click", (e) => { e.stopPropagation(); go(-1); });
    next.addEventListener("click", (e) => { e.stopPropagation(); go(1); });
    stage.append(prev, next);
    count.textContent = `${k + 1} / ${list.length}`;
    img.src = list[k];
  }
  bar.append(name, count, pct, close);
  wrap.append(stage, bar);
  document.body.appendChild(wrap);
  const zm = doc ? null : zoomable(stage, img, null, (z, real) => { pct.textContent = z === 1 ? "Fit" : `${Math.round(real * 100)}%`; });
  /* the browser's own full screen too, so its tabs and bars go as well */
  let leaving = false;
  const done = () => {
    if (leaving) return;
    leaving = true;
    clearTimeout(idleT);
    document.removeEventListener("keydown", keys, true);
    document.removeEventListener("fullscreenchange", onFs);
    if (document.fullscreenElement === wrap) document.exitFullscreen().catch(() => {});
    wrap.remove();
  };
  /* Esc in full screen is the browser's: it leaves full screen, and the
     picture closes with it */
  const onFs = () => { if (!document.fullscreenElement) done(); };
  try {
    const p = wrap.requestFullscreen && wrap.requestFullscreen({ navigationUI: "hide" });
    if (p && p.then) p.then(() => document.addEventListener("fullscreenchange", onFs)).catch(() => {});
  } catch (e) { /* stays over the window */ }
  let idleT = 0;
  const wake = () => {
    wrap.classList.remove("idle");
    clearTimeout(idleT);
    idleT = setTimeout(() => wrap.classList.add("idle"), 1800);
  };
  wrap.addEventListener("pointermove", wake);
  wake();
  const keys = (e) => {
    e.stopPropagation();
    if (e.key === "Escape" || e.key === "f" || e.key === "F") { e.preventDefault(); done(); }
    else if (!zm) return;
    else if (go && (e.key === "ArrowLeft" || e.key === "ArrowRight") && zm.z === 1) {
      e.preventDefault(); go(e.key === "ArrowLeft" ? -1 : 1);
    }
    else if (e.key === "+" || e.key === "=") zm.zoomBy(1.25);
    else if (e.key === "-") zm.zoomBy(0.8);
    else if (e.key === "0" || e.key === "/") { e.preventDefault(); zm.reset(); }
    else if (e.key === "*") { e.preventDefault(); zm.actual(); }
    else if (ARROWS[e.key]) {
      const [dx, dy] = ARROWS[e.key], k = e.shiftKey ? 3 : 1;
      if (zm.pan(-dx * PAN_STEP * k, -dy * PAN_STEP * k)) e.preventDefault();
    }
  };
  close.addEventListener("click", done);
  document.addEventListener("keydown", keys, true);
  return done;
}

/* what a file is, said plainly: the kind and its format */
const KIND_WORD = { image: "picture", video: "film", audio: "sound", pdf: "document", text: "text" };
function formatOf(it) {
  const ext = String(it.file || "").split(".").pop().toUpperCase();
  return { JPG: "JPEG", JPEG: "JPEG", M4V: "MP4", MOV: "MOV" }[ext] || ext;
}
function bytesWord(n) {
  if (!n) return "";
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
function clockWord(sec) {
  if (!isFinite(sec) || sec <= 0) return "";
  const t = Math.round(sec), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s2 = t % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s2).padStart(2, "0")}` : `${m}:${String(s2).padStart(2, "0")}`;
}
function whenWord(t) {
  if (!t) return "";
  const d = new Date(t * 1000);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
    + " " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/* ---- notes in Korean
   The notes are mostly English - and Italian, French - copied from the page
   a picture came from. TR shows them in Korean, to read only: the notes
   themselves, the keywords and the search stay in the words as written.
   Chrome's own on-device translator does it, so nothing leaves the machine,
   there is no key and no cost. Each line is translated by itself, so the
   lines and the title stay where they were, and a line translated once is
   kept for as long as the page is open. */
const TRK = { on: (() => { try { return localStorage.getItem("leiel.vib.tr") === "1"; } catch (e) { return false; } })(),
              lines: new Map(), engines: new Map(), det: null };
function setTrOn(on) {
  TRK.on = !!on;
  try { localStorage.setItem("leiel.vib.tr", TRK.on ? "1" : "0"); } catch (e) { /* private window */ }
}
const HANGUL = /[\uac00-\ud7a3]/g;
/* into the language this browser is set to - Korean here, and whatever the
   reader's own is elsewhere */
const TR_TO = (() => {
  try {
    /* most notes are English already, so the first language the browser
       lists that is not English; English only when nothing else is listed,
       and then the French and Italian lines are put into English */
    const langs = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || "ko"])
      .map(x => String(x).split("-")[0].toLowerCase());
    return langs.find(x => x && x !== "en") || "en";
  } catch (e) { return "ko"; }
})();
async function trLangOf(line) {
  if (line.length < 18 || typeof LanguageDetector === "undefined") return "en";
  try {
    TRK.det = TRK.det || await LanguageDetector.create();
    const top = (await TRK.det.detect(line.slice(0, 300)))?.[0];
    return top && top.confidence > 0.5 ? String(top.detectedLanguage).split("-")[0] : "en";
  } catch (e) { return "en"; }
}
async function trEngine(from, onLoad) {
  if (TRK.engines.has(from)) return TRK.engines.get(from);
  const p = (async () => {
    const avail = await Translator.availability({ sourceLanguage: from, targetLanguage: TR_TO });
    if (avail === "unavailable") throw new Error(`no ${from} → ${TR_TO} model in this browser`);
    return Translator.create({ sourceLanguage: from, targetLanguage: TR_TO,
      monitor(m) { m.addEventListener("downloadprogress", (e) => onLoad && onLoad(e.loaded)); } });
  })();
  TRK.engines.set(from, p);
  try { return await p; } catch (e) { TRK.engines.delete(from); throw e; }
}
/* line by line: the translation of each line, or null where there is
   nothing to add - an empty line, numbers, or a line already in the
   reader's own language */
async function trLines(text, onLoad) {
  if (typeof Translator === "undefined") throw new Error("translation needs Chrome's built-in translator (Chrome 138 or newer)");
  const out = [];
  for (const line of String(text || "").split("\n")) {
    const t = line.trim();
    const own = TR_TO === "ko" && (t.match(HANGUL) || []).length > t.length * 0.3;
    if (!t || own || !/\p{L}{2}/u.test(t)) { out.push(null); continue; }
    if (TRK.lines.has(t)) { out.push(TRK.lines.get(t)); continue; }
    const from = await trLangOf(t);
    if (from === TR_TO) { out.push(null); continue; }
    const eng = await trEngine(from, onLoad);
    const tr = await eng.translate(t);
    TRK.lines.set(t, tr);
    out.push(tr && tr.trim() !== t ? tr : null);
  }
  return out;
}

/* ---- keywords
   Found in the words kept with an idea, without any AI: the credits a
   fashion page writes the same way every time - "photographed by", "styling
   by", "hair by", "for" a magazine - give a name and what the person did;
   names written with capitals give the rest; the address gives the site.
   Those given by hand stand beside them; a found one can be put aside. */
const KW_NAME = String.raw`(?<![\p{L}\p{M}])\p{Lu}(?:[\p{Script=Latin}\p{M}'’\-]*|\.)(?![\p{L}\p{M}])(?:[ \t]+(?:(?:de|da|di|du|del|della|van|von|der|den|le|la|y)[ \t]+)?\p{Lu}(?:[\p{Script=Latin}\p{M}'’\-]*|\.)(?![\p{L}\p{M}])){0,3}`;
const KW_ROLES = [
  ["Photo", String.raw`(?:photograph(?:ed|y)|shot|lensed|captured)\s+by|photographer\s*[:\-–]?|photography\s*[:\-–]?`],
  ["Styling", String.raw`styl(?:ing|ed)\s+by|stylist\s*[:\-–]?|fashion\s+editor\s*[:\-–]?`],
  /* "Hair & Makeup Agata Branchina" - one person for both, kept as hair */
  ["Hair", String.raw`hair(?:\s+styling)?\s+by|hair\s*(?:&|and)\s*make-?\s?up(?:\s+by)?\s*[:\-–]?|hair(?:\s+stylist)?\s*[:\-–]?`],
  ["Make-up", String.raw`make-?\s?up(?:\s+artist)?\s+by|make-?\s?up(?:\s+artist)?\s*[:\-–]?`],
  ["Casting", String.raw`casting\s+by|casting\s*[:\-–]`],
  ["Set", String.raw`set\s+design(?:\s+by|\s*[:\-–])`],
  ["Film", String.raw`directed\s+by|director\s*[:\-–]`],
  ["Model", String.raw`starring|featuring|model\s*[:\-–]?`],
  ["For", String.raw`(?<=\bby\s[^\n.;]{1,60}?\s)for|\bfor(?=\s+(?:Vogue|Harper|W\b|AnOther|Dazed|i-D|Elle|Numéro|Numero|System|M\b|L'Officiel|GQ|Interview|CR\b|Self|Document|Purple|Pop\b|Love\b|Another|Marie\s+Claire|Bazaar|Vanity\s+Fair|Glamour|Tatler|Grazia|Madame\s+Figaro|Porter|Wonderland|Hunger|Allure|Wallpaper|Numéro))`],
];
const KW_SKIP = new Set(("the a an this that these those whether see watch when with in on at from for and but or our its his her their how why what who we you i it as if to of by is are read shop new more all here there now just about after before into over under via per sulla di del della la le il lo les des der die das el los las un une").split(" "));

/* words that come capitalised beside a name without being one: taken off
   either end */
const KW_TRIM = new Set(("spring-summer fall-winter autumn-winter spring summer fall autumn winter resort cruise pre-fall " +
  "show shows collection collections women's men's womenswear menswear issue cover digital campaign looks " +
  "backstage exclusive i " +
  /* titles and credits written in capitals before a name - "Featuring
     House Ambassadors Alysa Liu" is Alysa Liu */
  "featuring starring alongside with and introducing presenting " +
  "house ambassador ambassadors brand global friend friends muse muses face faces " +
  "creative artistic director directors designer designers " +
  "model models actress actor actors singer musician artist artists athlete " +
  /* the next credit, run on without a comma: "Olga Rubio Dalmau Fashion
     Stylist Emilia Teresa" */
  "fashion stylist stylists styling editor photography photographer photographers hair make-up makeup").split(" "));
function trimName(n) {
  let parts = String(n).split(/[ \t]+/).filter(Boolean);
  /* a possessive ends the name: "Phil Oh's Best" is Phil Oh */
  const pos = parts.findIndex(w => /['’]s$/i.test(w));
  if (pos >= 0) { parts[pos] = parts[pos].replace(/['’]s$/i, ""); parts = parts.slice(0, pos + 1); }
  const off = (w) => KW_SKIP.has(w.toLowerCase()) || KW_TRIM.has(w.toLowerCase()) || /^\d/.test(w);
  while (parts.length && off(parts[0])) parts.shift();
  while (parts.length && off(parts[parts.length - 1])) parts.pop();
  return parts.join(" ");
}

function foundKeywords(text, source) {
  const out = [];
  const has = new Set();
  const put = (t, k) => {
    t = t.replace(/[\s'’\-]+$/, "").trim();
    if (!t || t.length < 2 || has.has(t.toLowerCase())) return;
    has.add(t.toLowerCase());
    out.push({ t, k });
  };
  const words = String(text || "");
  /* the credit is found in any case; the name after it must start with a
     capital - so the name is looked for where the credit ends */
  const nameAt = new RegExp(KW_NAME, "uy");
  for (const [k, re] of KW_ROLES) {
    let rx;
    try { rx = new RegExp(`(?:${re})\\s+`, "giu"); } catch (e) { continue; }
    for (const m of words.matchAll(rx)) {
      nameAt.lastIndex = m.index + m[0].length;
      const n = nameAt.exec(words);
      if (n) put(trimName(n[0]), k);
    }
  }
  /* "Barbara Palvin by David Roemer" at the head of a line: the one shown,
     by the one who shot it */
  for (const m of words.matchAll(new RegExp(`(?:^|\\n)(${KW_NAME})\\s+(?:photographed\\s+)?by\\s+(${KW_NAME})`, "gu"))) {
    /* "Styling by ..." is a credit, not a model shot by someone */
    if (/^(?:styl|hair|make|casting|set|photo|shot|lensed|directed|art|creative|production|words|text|interview)/i.test(m[1])) continue;
    put(trimName(m[1]), "Model");
    put(trimName(m[2]), "Photo");
  }
  /* "Olga Rubio Dalmau for Vogue Korea with Sophie Bozhenova" - the way an
     editorial is titled: who shot it, for whom, with whom */
  for (const m of words.matchAll(new RegExp(`(?:^|\\n)(${KW_NAME})\\s+for\\s+[^\\n]{2,60}?\\s+with\\s+(${KW_NAME})`, "gu"))) {
    put(trimName(m[1]), "Photo");
    put(trimName(m[2]), "Model");
  }
  /* other names - two words or more, written with capitals; not from a
     headline, where every word is capitalised and a name can't be told
     from the rest */
  const headline = (line) => {
    const ws = line.split(/\s+/).filter(w => /\p{L}/u.test(w));
    return ws.length >= 5 && ws.filter(w => /^\p{Lu}/u.test(w)).length / ws.length >= 0.7;
  };
  const plain = words.split("\n").map(l => (headline(l) ? "" : l)).join("\n");
  let names = 0;
  for (const m of plain.matchAll(new RegExp(KW_NAME, "gu"))) {
    const t = trimName(m[0]);
    if (t.split(" ").length < 2 || names >= 8) continue;
    const before = out.length;
    put(t, "");
    if (out.length > before) names += 1;
  }
  /* the site */
  const h = host(source || "");
  if (h) {
    const site = /(^|\.)youtu(\.be|be\.com)$/.test(h) ? "YouTube" : /(^|\.)vimeo\.com$/.test(h) ? "Vimeo"
      : (h.split(".").filter(x => !/^(www|images?|img|cdn|static|media|assets|images-prod|m)$/i.test(x)).slice(-2, -1)[0] || "");
    if (site) put(site, "Site");
  }
  return out;
}

function host(url) {
  try {
    const h = new URL(url).hostname;
    return h.replace(/^www\./, "");
  } catch (e) { return ""; }
}

function day(t) {
  const d = new Date((t || 0) * 1000);
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

const VIA = { drop: "dropped", paste: "pasted", inbox: "from the inbox", jot: "written here",
              layout: "from the Series Layout" };

async function post(url, body) {
  const r = await api.fetchApi(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  return r.json();
}

async function postBlob(blob, name, source, via, memo) {
  const q = new URLSearchParams({ name: name || "", source: source || "", via: via || "" });
  if (memo) q.set("memo", memo);
  const r = await api.fetchApi(`${ADD_URL}?${q}`, { method: "POST", body: blob });
  return r.json();
}

function looksLikeURL(t) {
  return /^https?:\/\/\S+$/i.test(String(t || "").trim());
}

/* Every Idea Box node on the page shares the same box: one keeping an idea
   asks the others to look again. */
const boxes = new Set();
function refreshAll(except) {
  for (const b of boxes) if (b !== except) b.refresh();
}

function buildBox(node) {
  ensureCSS();
  node.properties = node.properties || {};
  const P = node.properties;
  if (typeof P.vib_folder !== "string") P.vib_folder = "all";
  if (![1, 2, 3].includes(P.vib_starmin)) P.vib_starmin = 1;
  if (!["stars", "unseen"].includes(P.vib_starsort)) P.vib_starsort = "stars";
  if (!Number.isInteger(P.vib_hue) || P.vib_hue < 0 || P.vib_hue >= HUES.length) P.vib_hue = HUE_DEFAULT;
  if (!Number.isFinite(Number(P.vib_light))) P.vib_light = LIGHT_DEFAULT;
  P.vib_light = Math.max(0, Math.min(1, Number(P.vib_light)));

  const root = el("div", "vib");
  root.tabIndex = 0;

  // ---- bar
  const bar = el("div", "vib-bar");
  const search = el("label", "vib-search");
  search.innerHTML = SEARCH_SVG;
  const q = el("input");
  q.type = "text";
  q.placeholder = "Search notes, keywords, folders, addresses";
  q.setAttribute("aria-label", "Search ideas");
  search.appendChild(q);
  const shuffleBtn = el("button", "vib-btn", "Shuffle");
  shuffleBtn.title = "Show this folder in a random order - press again for the order they came in";
  /* the button the box is used through most: gold, and the largest on the bar */
  const pasteBtn = el("button", "vib-btn gold vib-paste");
  pasteBtn.innerHTML = PASTE_SVG + "<span>Paste</span>";
  pasteBtn.title = "Keep what is on the clipboard - a screenshot, a picture or a line of text (Ctrl+V on the node does the same)";
  const tone = el("span", "vib-tone");
  const hueDot = el("button", "vib-dot");
  hueDot.setAttribute("aria-label", "Colour of the box");
  const light = el("input", "vib-light");
  light.type = "range";
  light.min = "0"; light.max = "100"; light.step = "1";
  light.title = "Brightness of the box";
  light.setAttribute("aria-label", "Brightness of the box");
  tone.append(hueDot, light);
  const helpBtn = el("button", "vib-btn vib-help", "?");
  helpBtn.title = "How the box works";
  helpBtn.setAttribute("aria-label", "How the box works");
  bar.append(search, shuffleBtn, pasteBtn, helpBtn);

  // ---- the sites: bookmarks of the places ideas come from, one click to
  // open each in a new tab of the browser
  const sTrack = el("div", "vib-strack");
  let sitesList = [];
  const SITES_KEY = "leiel.vib.sites";
  const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return ""; } };
  const saveSites = async () => {
    try { localStorage.setItem(SITES_KEY, JSON.stringify(sitesList)); } catch (e) { /* private window */ }
    try { await post("/leiel_idea/sites", { sites: sitesList }); } catch (e) { /* kept in the browser until the server has it */ }
  };
  const loadSites = async () => {
    let got = null;
    try {
      const r = await api.fetchApi("/leiel_idea/sites", { cache: "no-store" });
      if (r.ok) { const d = await r.json(); if (d && d.ok) got = d.sites; }
    } catch (e) { /* the server part not loaded yet */ }
    const fromServer = Array.isArray(got);
    if (!fromServer) {
      try { got = JSON.parse(localStorage.getItem(SITES_KEY) || "null"); } catch (e) { got = null; }
    }
    if (!Array.isArray(got)) { sitesList = DEFAULT_SITES.map(x => ({ ...x })); saveSites(); }
    else {
      sitesList = got;
      /* kept only in this browser while the server could not keep it: given
         to the server now */
      if (!fromServer) saveSites();
    }
    paintSites();
    if (typeof paint === "function") paint();
  };
  let sitePop = null;
  const closeSitePop = () => { if (sitePop) { sitePop.remove(); sitePop = null; } };
  /* one small card for a new site and for changing one: name and address */
  const editSite = (anchor, i) => {
    closeSitePop();
    const it = i >= 0 ? sitesList[i] : { name: "", url: "" };
    const pop = el("div", "vib-sitepop");
    const nm = el("input"); nm.value = it.name; nm.placeholder = "Vogue Runway";
    const ad = el("input"); ad.value = it.url; ad.placeholder = "https://www.vogue.com/fashion-shows";
    const ok = el("button", "vib-btn gold", i >= 0 ? "Save" : "Add");
    const no = el("button", "vib-btn", "Cancel");
    const row = el("div", "row");
    if (i >= 0) {
      const del = el("button", "vib-btn del", "Remove");
      del.title = "Press twice to take the site out";
      del.addEventListener("click", () => {
        if (!del.classList.contains("armed")) { del.classList.add("armed"); del.textContent = "Remove?"; return; }
        sitesList.splice(i, 1); saveSites(); closeSitePop(); paint();
      });
      row.append(del);
    }
    row.append(el("span", "sp"), no, ok);
    pop.append(el("label", null, "NAME"), nm, el("label", null, "ADDRESS"), ad, row);
    const done = () => {
      let url = ad.value.trim();
      if (!url) { ad.focus(); return; }
      if (!/^https?:\/\//i.test(url)) url = "https://" + url.replace(/^\/+/, "");
      const name = nm.value.trim() || hostOf(url) || url;
      if (i >= 0) sitesList[i] = { name, url };
      else sitesList.push({ name, url });
      saveSites(); closeSitePop(); paint();
    };
    ok.addEventListener("click", done);
    no.addEventListener("click", closeSitePop);
    for (const inp of [nm, ad]) {
      inp.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter") { e.preventDefault(); done(); }
        if (e.key === "Escape") { e.preventDefault(); closeSitePop(); }
      });
      inp.addEventListener("paste", (e) => e.stopPropagation());
    }
    pop.addEventListener("pointerdown", (e) => e.stopPropagation());
    root.appendChild(pop);
    const rr = root.getBoundingClientRect(), ar = anchor.getBoundingClientRect();
    const k = (root.offsetWidth ? rr.width / root.offsetWidth : 1) || 1;
    const left = Math.min((ar.left - rr.left) / k, root.offsetWidth - 290);
    pop.style.left = `${Math.max(8, left)}px`;
    pop.style.top = `${(ar.bottom - rr.top) / k + 6}px`;
    sitePop = pop;
    (i >= 0 ? nm : ad).focus();
  };
  let dragAt = -1;
  const paintSites = () => {
    sTrack.textContent = "";
    sitesList.forEach((site, i) => {
      const a = el("a", "vib-site");
      a.href = site.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.title = `${site.url}\nclick to open in a new tab · right click to change · drag to move`;
      const host = hostOf(site.url);
      const ic = el("img");
      ic.alt = "";
      ic.referrerPolicy = "no-referrer";
      ic.src = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32`;
      ic.addEventListener("error", () => ic.replaceWith(el("i", null, (site.name || host || "?").slice(0, 1).toUpperCase())));
      a.append(ic, site.name || host);
      a.addEventListener("pointerdown", (e) => e.stopPropagation());
      a.addEventListener("click", (e) => {
        e.preventDefault(); e.stopPropagation();
        window.open(site.url, "_blank", "noopener,noreferrer");
      });
      a.addEventListener("contextmenu", (e) => { e.preventDefault(); e.stopPropagation(); editSite(a, i); });
      a.draggable = true;
      a.addEventListener("dragstart", (e) => {
        e.stopPropagation();
        dragAt = i;
        e.dataTransfer.setData("text/x-vib-site", String(i));
        e.dataTransfer.effectAllowed = "move";
        a.classList.add("drag");
      });
      a.addEventListener("dragend", () => { dragAt = -1; overDepth = 0; root.classList.remove("over"); paintSites(); });
      a.addEventListener("dragover", (e) => {
        if (dragAt < 0) return;
        e.preventDefault(); e.stopPropagation();
        const b = a.getBoundingClientRect();
        const after = e.clientX > b.left + b.width / 2;
        a.classList.toggle("after", after);
        a.classList.toggle("before", !after);
      });
      a.addEventListener("dragleave", () => a.classList.remove("before", "after"));
      a.addEventListener("drop", (e) => {
        if (dragAt < 0) return;
        e.preventDefault(); e.stopPropagation();
        const b = a.getBoundingClientRect();
        let to = i + (e.clientX > b.left + b.width / 2 ? 1 : 0);
        const [moved] = sitesList.splice(dragAt, 1);
        if (dragAt < to) to--;
        sitesList.splice(to, 0, moved);
        dragAt = -1;
        saveSites(); paintSites();
      });
      sTrack.appendChild(a);
    });
    const add = el("button", "vib-sadd", "+ Site");
    add.title = "Add a site to open from here";
    add.addEventListener("pointerdown", (e) => e.stopPropagation());
    add.addEventListener("click", (e) => { e.stopPropagation(); editSite(add, -1); });
    sTrack.appendChild(add);
  };
  /* the Sites page on the wall: every site, as many to a line as fit */
  const sitesPage = () => {
    const pg = el("div", "vib-sitespage");
    pg.appendChild(el("div", "hint", "Click to open in a new tab · right click to change or remove · drag to move"));
    paintSites();
    pg.appendChild(sTrack);
    return pg;
  };
  root.addEventListener("pointerdown", (e) => { if (sitePop && !sitePop.contains(e.target)) closeSitePop(); });
  loadSites();

  // ---- a thought written straight in
  const jot = el("div", "vib-jot");
  const jotText = el("textarea");
  jotText.placeholder = "Jot an idea - type it or paste it here. Ctrl+Enter keeps it.";
  jotText.setAttribute("aria-label", "Jot an idea");
  const jotBtn = el("button", "vib-btn", "Keep");
  jotBtn.title = "Keep this as an idea (Ctrl+Enter)";
  jot.append(jotText, jotBtn);

  // ---- the new ones
  const fresh = el("div", "vib-new");
  const freshLab = el("div", "vib-new-lab");
  const freshN = el("b");
  freshLab.append(freshN, el("span", null, "Kept, not sorted yet."));
  const strip = el("div", "vib-strip");
  const sortBtn = el("button", "vib-btn gold big");
  fresh.append(freshLab, strip, sortBtn);

  // ---- folders and wall
  const main = el("div", "vib-main");
  const nav = el("nav", "vib-nav");
  const wall = el("div", "vib-wall");
  /* colour and brightness sit over the folders, out of the way of the bar */
  const navCol = el("div", "vib-navcol");
  /* the folders' column, as wide as it is dragged */
  const split = el("div", "vib-split");
  split.title = "Drag to make the folders wider or narrower\nDouble click for the width it had";
  /* My works, at the foot of the folders: a bar to drag it taller, the list
     standing on its foot, the heading at the very bottom */
  const worksGrip = el("div", "vib-wgrip");
  worksGrip.title = "Drag to give My works more room, or the folders\nDouble click for the height it had";
  const worksBox = el("div", "vib-works");
  const worksList = el("div", "vib-wlist");
  const worksHead = el("div", "vib-whead");
  {
    const h = el("b");
    h.innerHTML = WORKS_SVG;
    h.append("MY WORKS");
    worksHead.append(h, el("em", null, "0"));
  }
  worksHead.title = "One's own renders - sent from the Series Layout or the Image Viewer";
  worksHead.addEventListener("click", () => { P.vib_folder = "works"; wall.scrollTop = 0; paint(); });
  worksBox.append(worksHead, worksList);
  navCol.append(tone, nav, worksGrip, worksBox, split);
  const WH = [60, 520], WH_KEY = "leiel.vib.worksh";
  const savedWH = () => { try { return Number(localStorage.getItem(WH_KEY)) || 0; } catch (e) { return 0; } };
  if (!Number(P.vib_worksh) && savedWH()) P.vib_worksh = savedWH();
  const paintWH = () => worksList.style.maxHeight = `${Math.max(WH[0], Math.min(WH[1], Number(P.vib_worksh) || 150))}px`;
  paintWH();
  worksGrip.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const k = (root.offsetWidth ? root.getBoundingClientRect().width / root.offsetWidth : 1) || 1;
    const y0 = e.clientY, h0 = worksList.offsetHeight;
    worksGrip.classList.add("on");
    const mv = (ev) => { P.vib_worksh = Math.round(Math.max(WH[0], Math.min(WH[1], h0 - (ev.clientY - y0) / k))); paintWH(); };
    const up = () => {
      worksGrip.classList.remove("on");
      try { localStorage.setItem(WH_KEY, String(P.vib_worksh)); } catch (er) { /* not kept */ }
      window.removeEventListener("pointermove", mv, true);
      window.removeEventListener("pointerup", up, true);
    };
    window.addEventListener("pointermove", mv, true);
    window.addEventListener("pointerup", up, true);
  });
  worksGrip.addEventListener("dblclick", (e) => {
    e.stopPropagation(); delete P.vib_worksh;
    try { localStorage.removeItem(WH_KEY); } catch (er) { /* not kept */ }
    paintWH();
  });
  /* The width is kept with the node and, beside it, in the browser - so it
     holds when the workflow is opened again unsaved, or the node made anew. */
  const NAVW = [140, 420], NAVW_DEFAULT = 200, NAVW_KEY = "leiel.vib.navw";
  const savedNavW = () => { try { return Number(localStorage.getItem(NAVW_KEY)) || 0; } catch (e) { return 0; } };
  const keepNavW = (w) => { try { if (w) localStorage.setItem(NAVW_KEY, String(w)); else localStorage.removeItem(NAVW_KEY); } catch (e) { /* not kept */ } };
  if (!Number(P.vib_navw) && savedNavW()) P.vib_navw = savedNavW();
  const paintNavW = () => {
    const w = Math.max(NAVW[0], Math.min(NAVW[1], Number(P.vib_navw) || NAVW_DEFAULT));
    root.style.setProperty("--navw", `${w}px`);
  };
  split.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const k = (root.offsetWidth ? root.getBoundingClientRect().width / root.offsetWidth : 1) || 1;
    const x0 = e.clientX, w0 = navCol.offsetWidth;
    split.classList.add("on");
    const mv = (ev) => { P.vib_navw = Math.round(Math.max(NAVW[0], Math.min(NAVW[1], w0 + (ev.clientX - x0) / k))); paintNavW(); };
    const upw = () => {
      split.classList.remove("on");
      keepNavW(P.vib_navw);
      window.removeEventListener("pointermove", mv, true);
      window.removeEventListener("pointerup", upw, true);
    };
    window.addEventListener("pointermove", mv, true);
    window.addEventListener("pointerup", upw, true);
  });
  split.addEventListener("dblclick", (e) => { e.stopPropagation(); delete P.vib_navw; keepNavW(0); paintNavW(); });
  paintNavW();
  main.append(navCol, wall);

  // ---- foot
  const foot = el("div", "vib-foot");
  const say = el("span", "vib-say");
  const inboxBtn = el("button");
  inboxBtn.title = "The inbox folder - anything saved here comes into the box. Click to copy its path.";
  foot.append(say, inboxBtn);

  // ---- drop
  const drop = el("div", "vib-drop");
  const dropIn = el("div");
  dropIn.innerHTML = `${DROP_SVG}<b>Drop to keep</b><span>The address comes along. It waits with the new ones.</span>`;
  drop.appendChild(dropIn);

  root.append(bar, fresh, main, jot, foot);
  main.appendChild(drop);

  // ---- colour and brightness, kept with the node
  function paintTone() {
    if (!Number.isInteger(P.vib_hue) || P.vib_hue < 0 || P.vib_hue >= HUES.length) P.vib_hue = HUE_DEFAULT;
    if (!Number.isFinite(Number(P.vib_light))) P.vib_light = LIGHT_DEFAULT;
    root.style.setProperty("--bk", HUES[P.vib_hue][1]);
    root.style.setProperty("--bl", String(P.vib_light));
    const pct = Math.round(P.vib_light * 100);
    light.value = String(pct);
    light.style.setProperty("--pct", `${pct}%`);
    hueDot.title = `Colour of the box: ${HUES[P.vib_hue][0]} - click for the next one, Shift+click for the one before`;
  }
  hueDot.addEventListener("click", (e) => {
    const d = e.shiftKey ? -1 : 1;
    P.vib_hue = (P.vib_hue + d + HUES.length) % HUES.length;
    paintTone();
  });
  light.addEventListener("input", () => {
    P.vib_light = Math.max(0, Math.min(1, Number(light.value) / 100));
    paintTone();
  });
  light.addEventListener("pointerdown", (e) => e.stopPropagation());
  paintTone();

  // ---- state
  const S = {
    folders: [],
    items: [],
    inbox: "",
    order: null,          // ids in shuffled order, or null for the order they came in
    look: null,           // { ids, at, sort, sorted }
    editing: false,       // a folder name being typed
    sig: "",
    dead: false,
  };
  /* The idea pinned to compare is kept with the node and in the browser, so
     it is still pinned after another workflow has been opened and this one
     come back to. */
  const PIN_KEY = "leiel.vib.pin";
  if (!P.vib_pin) { try { const v = localStorage.getItem(PIN_KEY); if (v) P.vib_pin = v; } catch (e) { /* none */ } }
  Object.defineProperty(S, "pin", {
    get: () => P.vib_pin || null,
    set: (v) => {
      if (v) P.vib_pin = v; else delete P.vib_pin;
      try { if (v) localStorage.setItem(PIN_KEY, v); else localStorage.removeItem(PIN_KEY); } catch (e) { /* not kept */ }
    },
  });
  let sayTimer = 0;
  /* The line at the foot says what just happened. An open idea covers the
     foot, so the same words are said in the bar above it as well. */
  let lookSay = null;
  function flash(text, kind) {
    say.textContent = text;
    say.className = "vib-say " + (kind === "err" ? "err" : "flash");
    if (lookSay) { lookSay.textContent = text; lookSay.className = "vib-say vib-lsay " + (kind === "err" ? "err" : "flash"); }
    clearTimeout(sayTimer);
    sayTimer = setTimeout(() => {
      say.className = "vib-say"; paintCount();
      if (lookSay) { lookSay.textContent = ""; lookSay.className = "vib-say vib-lsay"; }
    }, kind === "err" ? 6000 : 3600);
  }
  function paintCount() {
    if (say.classList.contains("flash") || say.classList.contains("err")) return;
    const n = S.items.length;
    say.textContent = `${n} idea${n === 1 ? "" : "s"}`;
  }

  const byId = (id) => S.items.find(x => x.id === id);
  const fresh_ = () => S.items.filter(x => x.new);
  const newestFirst = (list) => list.slice().sort((a, b) => (b.added || 0) - (a.added || 0));
  /* An idea's notes, with the one-line note older ideas were given folded in
     as their first line. The first line of the notes is the idea's title. */
  const memoOf = (it) => [it.note, it.memo].map(x => String(x || "").trim()).filter(Boolean).join("\n");
  const firstLine = (t) => (String(t || "").split(/\r?\n/).map(x => x.trim()).find(Boolean) || "");
  const titleOf = (it) => firstLine(memoOf(it)) || (it.kind === "text" ? firstLine(it.text) : "")
    || (it.kind === "audio" || it.kind === "pdf" ? String(it.name || "").replace(/\.[^.]+$/, "") : "");
  const restOf = (it) => {
    const lines = memoOf(it).split(/\r?\n/);
    const at = lines.findIndex(x => x.trim());
    return at < 0 ? "" : lines.slice(at + 1).join("\n").trim();
  };

  function matches(it, words) {
    if (!words.length) return true;
    const hay = [memoOf(it), it.text, it.name, it.source, host(it.source), ...(it.folders || []), ...(it.tags || [])]
      .join(" ").toLowerCase();
    return words.every(w => hay.includes(w));
  }

  function visible() {
    const words = q.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const f = P.vib_folder;
    const kw = kwChosen();
    /* the Keywords view shows the ideas only once a keyword is chosen */
    if (f === "keywords" && !kw.length) return [];
    if (f === "sites") return [];
    const kwOk = kwTest();
    let list = S.items.filter(it => {
      if (kwOk && !kwOk(it)) return false;
      if (!words.length && !kw.length && it.new) return false;
      if (f === "used") { if (!it.used) return false; }
      else if (f === "starred") { if ((it.stars || 0) < P.vib_starmin) return false; }
      else if (f === "keywords") { /* every idea, by its keywords */ }
      else if (f === "works") { if (!it.work) return false; }
      else if (String(f).startsWith("w:")) { if (!it.work || `w:${it.wfolder || "Unsorted"}` !== f) return false; }
      /* All is the references; one's own works are in My works - and in a
         folder they were put into, beside the references there */
      else if (f === "all") { if (it.work) return false; }
      else if (!inFolder(it, f)) return false;
      return matches(it, words);
    });
    list = newestFirst(list);
    /* the starred: the most wanted first - or the longest unseen first, so
       an idea once loved does not sink out of sight */
    if (f === "starred") {
      list.sort(P.vib_starsort === "unseen"
        ? (a, b) => (a.seen || a.added || 0) - (b.seen || b.added || 0)
        : (a, b) => (b.stars || 0) - (a.stars || 0) || (b.added || 0) - (a.added || 0));
    }
    if (S.order) {
      const pos = new Map(S.order.map((id, i) => [id, i]));
      list.sort((a, b) => (pos.has(a.id) ? pos.get(a.id) : -1) - (pos.has(b.id) ? pos.get(b.id) : -1));
    }
    return list;
  }

  // ---- painting
  function paintFresh() {
    const list = newestFirst(fresh_());
    fresh.style.display = list.length ? "" : "none";
    if (!list.length) return;
    freshN.textContent = `NEW · ${list.length}`;
    sortBtn.textContent = `Sort ${list.length}`;
    strip.textContent = "";
    for (const it of list.slice(0, STRIP_MAX)) {
      const flat = it.kind === "text" || it.kind === "audio" || (it.kind === "pdf" && !it.thumb);
      const c = el("button", "vib-chip" + (flat ? " t" : ""));
      c.title = it.kind === "text" ? it.text : (it.name || it.source || VIA[it.via] || "");
      if (it.kind === "text") c.textContent = it.text;
      else if (it.kind === "audio" || (it.kind === "pdf" && !it.thumb)) {
        c.innerHTML = it.kind === "audio" ? SOUND_SVG : DOC_SVG;
        c.append(" " + titleOf(it));
      }
      else if (it.kind === "video") c.appendChild(filmEl(it, "vib-chipfilm"));
      else {
        const im = el("img");
        im.loading = "lazy";
        im.alt = "";
        im.src = picURL(it, 160);
        c.appendChild(im);
      }
      c.addEventListener("click", () => openLook(list.map(x => x.id), list.indexOf(it), true));
      strip.appendChild(c);
    }
    if (list.length > STRIP_MAX) strip.appendChild(el("span", "vib-more", `+${list.length - STRIP_MAX}`));
  }

  /* The folder list as it is to be kept, in its order; renamed maps old
     paths to new ones so the ideas move with them. */
  async function saveFolders(folders, renamed, msg) {
    const r = await post(FOLDERS_URL, { folders, renamed: renamed || {} });
    if (!r.ok) { flash("the folders could not be saved", "err"); paintNav(); return false; }
    if (!viewOk(P.vib_folder)) {
      const to = (renamed || {})[P.vib_folder] || P.vib_folder;
      P.vib_folder = r.folders.includes(to) ? to : "all";
    }
    if (msg) flash(msg);
    await refresh(true);
    refreshAll(api_);
    return true;
  }

  /* Folders hold folders. A folder is kept as its path - "VOGUE/Runway" -
     and the list keeps every folder right after its parent, its own
     folders after it, so the list reads top to bottom as the tree does. */
  const kidsOf = (p) => S.folders.filter(f => parentOf(f) === p);
  const subtree = (p) => S.folders.filter(f => f === p || f.startsWith(p + "/"));
  /* the list again from a tree whose order of children changed */
  function flatten(kids) {
    const out = [];
    const walk = (p) => { for (const f of kids(p)) { out.push(f); walk(f); } };
    walk("");
    return out;
  }
  const closed = () => (P.vib_closed && typeof P.vib_closed === "object" ? P.vib_closed : (P.vib_closed = {}));
  /* Numbers as the Series Book numbers its capsules: 1, 2, 3 at the top,
     1-1, 1-2 inside the first, 1-1-1 inside that. The keys 1-9 pick the
     top folders; one inside is picked by its chip. */
  function folderNos() {
    const out = {};
    const walk = (p, pre) => kidsOf(p).forEach((f, i) => {
      const no = pre ? `${pre}-${i + 1}` : String(i + 1);
      out[f] = no;
      walk(f, no);
    });
    walk("", "");
    return out;
  }
  const topFolders = () => kidsOf("");

  let armedFolder = null;      // the folder whose x was pressed once
  let disarmTimer = 0;
  let dragged = false;         // a drag just ended: the click it makes is not a choice

  function paintNav() {
    /* while a folder name is typed the list stays still - unless the box it
       is typed in has gone, when it would stay still for good */
    if (S.editing && nav.querySelector("input")) return;
    S.editing = false;
    nav.textContent = "";
    nav.appendChild(el("span", "vib-nav-h", "FOLDERS"));
    const sorted = S.items.filter(x => !x.new && !x.work);
    const row = (key, label, count, num) => {
      const b = el("div", "vib-f" + (P.vib_folder === key ? " on" : ""));
      b.tabIndex = 0;
      b.setAttribute("role", "button");
      if (num != null) b.appendChild(el("i", null, String(num)));
      b.append(el("span", null, label), el("em", null, String(count)));
      const choose = () => {
        if (dragged) return;
        /* only the marks move, so a double click lands on the same row */
        if (P.vib_folder !== key) {
          P.vib_folder = key;
          S.order = null;
          shuffleBtn.classList.remove("on");
          for (const x of nav.querySelectorAll(".vib-f")) x.classList.toggle("on", x === b);
          for (const g of nav.querySelectorAll(".vib-grp")) g.classList.toggle("on", g.contains(b));
          wall.scrollTop = 0;
          paintWall();
        }
      };
      b.addEventListener("click", choose);
      b.addEventListener("keydown", (e) => { if (e.key === "Enter") choose(); });
      return b;
    };
    const allRow = row("all", "All ideas", sorted.length);
    allRow.classList.add("vib-all");
    { const mk = el("b", "vib-allmark"); mk.innerHTML = IDEAS_SVG; allRow.querySelector("span").prepend(mk); }
    nav.appendChild(allRow);
    const starred = row("starred", "Starred", S.items.filter(x => (x.stars || 0) > 0).length);
    starred.classList.add("vib-starrow");
    starred.querySelector("span").prepend(el("b", "vib-starmark", "★"));
    nav.appendChild(starred);
    const kwRow = row("keywords", "Keywords", kwIndex().length);
    kwRow.classList.add("vib-starrow", "vib-kwrow");
    kwRow.querySelector("span").prepend(el("b", "vib-starmark", "#"));
    nav.appendChild(kwRow);
    const shut = closed();
    const nos = folderNos();
    let grp = null;           // the block of the top folder being painted
    S.folders.forEach((f, i) => {
      /* a folder under a folded one is not shown */
      const anc = f.split("/").slice(0, -1).map((_, k, a) => a.slice(0, k + 1).join("/"));
      if (anc.some(a => shut[a])) return;
      const depth = depthOf(f);
      const n = sorted.filter(x => inFolder(x, f)).length;
      const b = row(f, nameOf(f), n, nos[f]);
      b.classList.add("own");
      b.dataset.f = f;
      b.dataset.parent = parentOf(f);
      /* the number stays in its column; the name is set in by its depth */
      b.style.setProperty("--depth", String(depth));
      if (!depth) {
        b.classList.add("top");
        grp = el("div", "vib-grp" + (P.vib_folder === f || String(P.vib_folder).startsWith(f + "/") ? " on" : ""));
        nav.appendChild(grp);
      }
      b.title = "A folder - its ideas and those of the folders inside it\nClick to open it\nDrag to an edge of a folder beside it to move it\nDrag onto the middle of a folder to put it inside\nDrag onto All ideas to bring it to the top\nDouble click to rename it";
      /* the caret folds a folder that holds folders */
      const kids = kidsOf(f).length;
      const caret = el("button", "vib-caret" + (kids ? "" : " none"), kids ? (shut[f] ? "▸" : "▾") : "");
      if (kids) {
        caret.setAttribute("aria-label", shut[f] ? `Open ${nameOf(f)}` : `Fold ${nameOf(f)}`);
        caret.addEventListener("pointerdown", (e) => e.stopPropagation());
        caret.addEventListener("dblclick", (e) => { e.preventDefault(); e.stopPropagation(); });
        caret.addEventListener("click", (e) => {
          e.stopPropagation();
          if (shut[f]) delete shut[f]; else shut[f] = true;
          paintNav();
        });
      }
      b.insertBefore(caret, b.querySelector("span"));
      b.addEventListener("dblclick", (e) => { e.preventDefault(); e.stopPropagation(); editFolder(b, f, null); });
      /* + a folder inside this one */
      const plus = el("button", "vib-fx vib-fplus", "+");
      plus.setAttribute("aria-label", `A folder inside ${nameOf(f)}`);
      plus.title = `A folder inside "${nameOf(f)}"`;
      plus.addEventListener("pointerdown", (e) => e.stopPropagation());
      plus.addEventListener("click", (e) => {
        e.stopPropagation();
        if (shut[f]) delete shut[f];
        const slot = el("div", "vib-f");
        slot.style.paddingLeft = `${48 + (depth + 1) * 10}px`;
        const last = subtree(f).pop();
        const after = [...nav.querySelectorAll(".vib-f.own")].find(r => r.dataset.f === last) || b;
        after.after(slot);
        editFolder(slot, null, f);
      });
      /* the x takes the folder away, and the folders in it - pressed twice,
         as nothing is undone; the ideas stay in the box */
      const x = el("button", "vib-fx" + (armedFolder === f ? " armed" : ""), armedFolder === f ? "Delete?" : "×");
      x.setAttribute("aria-label", `Delete the folder ${nameOf(f)}`);
      const inner = subtree(f).length - 1;
      x.title = `Take "${nameOf(f)}" away${inner ? ` with the ${inner} folder${inner === 1 ? "" : "s"} in it` : ""}`
        + (n ? ` - its ${n} idea${n === 1 ? "" : "s"} stay in the box` : "");
      x.addEventListener("pointerdown", (e) => e.stopPropagation());
      x.addEventListener("click", (e) => {
        e.stopPropagation();
        if (armedFolder !== f) {
          armedFolder = f;
          paintNav();
          /* not pressed again: it lets go, as in the other nodes */
          clearTimeout(disarmTimer);
          disarmTimer = setTimeout(() => { if (armedFolder === f) { armedFolder = null; paintNav(); } }, ARM_MS);
          return;
        }
        clearTimeout(disarmTimer);
        armedFolder = null;
        const gone = new Set(subtree(f));
        saveFolders(S.folders.filter(y => !gone.has(y)), {},
          `"${nameOf(f)}" taken away${inner ? ` with the folders in it` : ""} - its ideas stay in the box`);
      });
      b.append(plus, x);
      dragRow(b, f);
      (grp || nav).appendChild(b);
    });
    /* + Folder right under the folders it adds to; after a rule, the rows
       that are not folders of ideas - Used in a series, and the Sites, the
       places ideas come from - so nothing reads as inside a site */
    const add = el("button", "vib-addf", "+ Folder");
    add.addEventListener("click", () => editFolder(add, null, ""));
    nav.appendChild(add);
    nav.appendChild(el("div", "vib-rule"));
    const usedRow = row("used", "Used in a series", S.items.filter(x => x.used).length);
    usedRow.classList.add("vib-usedrow");
    nav.appendChild(usedRow);
    const siteRow = row("sites", "Sites", sitesList.length);
    siteRow.classList.add("vib-usedrow", "vib-siterow");
    { const mk = el("b", "vib-starmark vib-sitemark"); mk.innerHTML = SITES_SVG; siteRow.querySelector("span").prepend(mk); }
    nav.appendChild(siteRow);
  }

  /* A folder dragged by hand - the browser's drag and drop belongs to
     keeping pictures here. Over the top or bottom edge of a folder beside
     it, it moves to that place among them; over the middle of any folder, it
     goes inside that one; over All, back to the top. The folders inside it
     always go with it. */
  function dragRow(b, f) {
    b.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      const y0 = e.clientY;
      const parent = parentOf(f);
      const mine = new Set(subtree(f));
      let on = false;
      let aim = null;               // { kind: "before"|"after"|"into"|"top", f }
      const clear = () => {
        for (const r of nav.querySelectorAll(".vib-f")) r.classList.remove("ins-above", "ins-below", "drop-into");
      };
      const move = (ev) => {
        if (!on && Math.abs(ev.clientY - y0) < 5) return;
        if (!on) { on = true; b.classList.add("lift"); armedFolder = null; }
        clear();
        aim = null;
        const hit = document.elementFromPoint(ev.clientX, ev.clientY);
        const r = hit && hit.closest && hit.closest(".vib-f");
        if (!r || !nav.contains(r)) return;
        const tf = r.dataset.f;
        if (!tf) {
          /* All: out to the top */
          if (r.classList.contains("vib-all") && parent) { aim = { kind: "top" }; r.classList.add("drop-into"); }
          return;
        }
        if (mine.has(tf)) return;
        const box = r.getBoundingClientRect();
        const rel = (ev.clientY - box.top) / box.height;
        const sib = parentOf(tf) === parent;
        if (sib && rel < 0.28) { aim = { kind: "before", f: tf }; r.classList.add("ins-above"); }
        else if (sib && rel > 0.72) { aim = { kind: "after", f: tf }; r.classList.add("ins-below"); }
        else if (tf !== parent) { aim = { kind: "into", f: tf }; r.classList.add("drop-into"); }
      };
      const up = () => {
        window.removeEventListener("pointermove", move, true);
        window.removeEventListener("pointerup", up, true);
        clear();
        if (!on) return;
        dragged = true;
        setTimeout(() => { dragged = false; }, 0);
        if (!aim) { paintNav(); return; }
        if (aim.kind === "before" || aim.kind === "after") {
          const sibs = kidsOf(parent).filter(x => x !== f);
          let at = sibs.indexOf(aim.f) + (aim.kind === "after" ? 1 : 0);
          sibs.splice(at, 0, f);
          const next = flatten((p) => (p === parent ? sibs : kidsOf(p)));
          if (next.join("\u0000") === S.folders.join("\u0000")) { paintNav(); return; }
          S.folders = next;
          paintNav();
          saveFolders(next, {}, `"${nameOf(f)}" moved`);
          return;
        }
        /* into another folder, or out to the top: the path changes, and with
           it the paths of the folders inside it and of every idea in them */
        const base = aim.kind === "top" ? "" : aim.f;
        const to = base ? `${base}/${nameOf(f)}` : nameOf(f);
        if (S.folders.includes(to)) { flash(`there is a "${nameOf(f)}" there already`, "err"); paintNav(); return; }
        const renamed = {};
        for (const x of mine) renamed[x] = to + x.slice(f.length);
        let rest = S.folders.filter(x => !mine.has(x));
        const moved = [...mine].map(x => renamed[x]);
        if (base) {
          const end = rest.reduce((k, x, i) => (x === base || x.startsWith(base + "/") ? i : k), -1);
          rest.splice(end + 1, 0, ...moved);
        } else rest = rest.concat(moved);
        if (base) delete closed()[base];                 // open it, so the folder is seen arriving
        saveFolders(rest, renamed, base ? `"${nameOf(f)}" is inside ${nameOf(base)} now` : `"${nameOf(f)}" is at the top now`);
      };
      window.addEventListener("pointermove", move, true);
      window.addEventListener("pointerup", up, true);
    });
  }

  /* A name typed for a folder: a new one at the top (parent ""), a new one
     inside another (parent its path), or a folder renamed (old its path,
     parent null) - the folders in it renamed with it. */
  function editFolder(slot, old, parent) {
    /* a row already painted over - by a second click on a caret, say - can't
       be edited; and the folders must never stay frozen waiting for it */
    if (!slot.isConnected) return;
    S.editing = true;
    const box = el("div", "vib-f on");
    box.style.paddingLeft = slot.style.paddingLeft || "";
    const inp = el("input");
    inp.value = old ? nameOf(old) : "";
    inp.placeholder = old ? "" : (parent ? `New folder in ${nameOf(parent)}` : "New folder");
    inp.setAttribute("aria-label", old ? `Rename ${nameOf(old)}` : "New folder name");
    inp.addEventListener("pointerdown", (e) => e.stopPropagation());
    box.appendChild(inp);
    slot.replaceWith(box);
    inp.focus();
    inp.select();
    let done = false;
    const finish = async (keep) => {
      if (done) return;
      done = true;
      S.editing = false;
      /* a slash would make a folder of its own */
      const name = inp.value.replace(/[\/\\]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 40);
      if (!keep || name === (old ? nameOf(old) : "")) { paintNav(); return; }
      const base = old ? parentOf(old) : (parent || "");
      const path = name ? (base ? `${base}/${name}` : name) : "";
      if (path && S.folders.includes(path)) { flash(`there is a folder "${name}" there already`, "err"); paintNav(); return; }
      let folders = S.folders.slice();
      const renamed = {};
      let msg;
      if (old && path) {
        folders = folders.map(f => {
          if (f !== old && !f.startsWith(old + "/")) return f;
          const to = path + f.slice(old.length);
          renamed[f] = to;
          return to;
        });
        msg = `"${nameOf(old)}" is "${name}" now`;
      } else if (old) {
        const gone = new Set(subtree(old));
        folders = folders.filter(f => !gone.has(f));
        msg = `"${nameOf(old)}" taken away - its ideas stay in the box`;
      } else if (path) {
        /* a new folder goes at the end of its parent's folders */
        if (parent) {
          const at = folders.indexOf(subtree(parent).pop());
          folders.splice(at + 1, 0, path);
        } else folders.push(path);
        msg = parent ? `folder "${name}" added in ${nameOf(parent)}` : `folder "${name}" added`;
      } else { paintNav(); return; }
      await saveFolders(folders, renamed, msg);
    };
    inp.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") finish(true);
      if (e.key === "Escape") finish(false);
    });
    inp.addEventListener("blur", () => finish(true));
  }

  function paintWall() {
    paintCardW();
    paintWorks();
    const into = openFolder();
    jotText.placeholder = into
      ? `Jot an idea into ${nameOf(into)} - type it or paste it here. Ctrl+Enter keeps it.`
      : "Jot an idea - type it or paste it here. Ctrl+Enter keeps it.";
    const list = visible();
    wall.textContent = "";
    wall.appendChild(crumb(list.length));
    if (P.vib_folder === "starred") wall.appendChild(starBar());
    if (P.vib_folder === "keywords") wall.appendChild(kwPanel());
    if (P.vib_folder === "sites") { wall.appendChild(sitesPage()); return; }
    if (!list.length) {
      if (P.vib_folder === "keywords" && !kwChosen().length) return;
      const words = q.value.trim();
      const msg = el("div", "vib-empty");
      msg.textContent = kwChosen().length ? "No idea has all of these keywords - let one go."
        : words ? `Nothing kept matches "${words}".`
        : S.items.length ? "This folder is empty."
        : "Drop a picture from the browser here, paste a screenshot with Ctrl+V,\nor save one into the inbox folder below.";
      msg.style.whiteSpace = "pre-line";
      wall.appendChild(msg);
      return;
    }
    const cols = el("div", "vib-cols");
    wall.appendChild(cols);
    for (const it of list) {
      const c = el("button", "vib-card");
      c.dataset.iid = it.id;
      c.draggable = true;
      /* the card's tip: what it is, then what each hand does */
      const what = videoOf(it.source) ? `A ${/vimeo/i.test(it.source) ? "Vimeo" : "YouTube"} film`
        : it.kind === "image" ? "A picture" : it.kind === "video" ? "A film - it plays under the pointer"
        : it.kind === "audio" ? "A sound - ▶ plays it here" : it.kind === "pdf" ? "A PDF" : "A line of text";
      {
        /* its tip is the idea itself: title, notes, who made it, where it is */
        const words = (it.kind === "text" ? String(it.text || "").split("\n").slice(1).join("\n") : restOf(it)) || "";
        const short = words.replace(/\n{3,}/g, "\n\n").trim();
        const kws = kwOf(it).filter(k => k.k && k.k !== "Site").slice(0, 5).map(k => [k.k, k.t]);
        const meta = [what, (it.folders || []).map(f => f.split("/").join(" › ")).join(" · "),
          (it.more || []).length ? `${1 + it.more.length} pictures` : "", host(it.source)].filter(Boolean).join("  ·  ");
        c.dataset.tipcard = JSON.stringify({
          title: (titleOf(it) || "").slice(0, 140),
          words: short.length > 520 ? short.slice(0, 520).replace(/\s+\S*$/, "") + " …" : short,
          kws, meta,
        });
      }
      if (it.kind === "text") c.appendChild(el("div", "q", it.text));
      else if (it.kind === "audio") {
        /* a sound has no picture: its mark, its name, and a button that
           plays it without opening it */
        const box = el("div", "vib-sound");
        box.innerHTML = SOUND_BIG_SVG;
        const play = el("span", "vib-sound-play", playing === it.id ? "❚❚" : "▶");
        play.setAttribute("role", "button");
        play.setAttribute("aria-label", "Play the sound");
        play.addEventListener("click", (e) => { e.stopPropagation(); playSound(it, play); });
        box.appendChild(play);
        c.appendChild(box);
      } else if (it.kind === "pdf" && it.thumb) {
        /* a PDF shows its first page */
        const im = el("img");
        im.loading = "lazy";
        im.alt = titleOf(it);
        if (it.w && it.h) im.style.aspectRatio = `${it.w} / ${it.h}`;
        im.src = picURL(it, cardSide());
        const frame = el("div", "vib-cardpic");
        frame.appendChild(im);
        frame.appendChild(el("span", "vib-pdf-s", "PDF"));
        c.appendChild(frame);
      } else if (it.kind === "pdf") {
        const box = el("div", "vib-doc");
        box.innerHTML = DOC_BIG_SVG;
        box.appendChild(el("span", null, "PDF"));
        c.appendChild(box);
      }
      else if (it.kind === "video") {
        const frame = el("div", "vib-cardpic");
        frame.appendChild(filmEl(it, "vib-cardfilm"));
        frame.appendChild(el("span", "vib-play-s", "▶"));
        if ((it.more || []).length) {
          const n = el("span", "vib-count");
          n.innerHTML = STACK_SVG;
          n.append(String(it.more.length));
          n.title = `${it.more.length} ${it.more.length === 1 ? "still" : "stills"} taken from the film`;
          frame.appendChild(n);
        }
        c.appendChild(frame);
      } else {
        const im = el("img");
        im.loading = "lazy";
        im.alt = titleOf(it);
        if (it.w && it.h) im.style.aspectRatio = `${it.w} / ${it.h}`;
        im.src = picURL(it, cardSide());
        const frame = el("div", "vib-cardpic");
        frame.appendChild(im);
        if (videoOf(it.source)) frame.appendChild(el("span", "vib-play-s", "▶"));
        /* more than one picture in it: how many, quietly in the corner */
        if ((it.more || []).length) {
          const n = el("span", "vib-count");
          n.innerHTML = STACK_SVG;
          n.append(String(1 + it.more.length));
          n.title = `${1 + it.more.length} pictures from the same page`;
          frame.appendChild(n);
        }
        c.appendChild(frame);
      }
      /* marks in the corner, whatever the idea is: pinned to compare, one's own work */
      {
        const tags = el("span", "vib-ctags");
        if (S.pin === it.id) tags.appendChild(el("span", "vib-pintag", "◫ PINNED"));
        if (it.work && !isWorkView(P.vib_folder)) tags.appendChild(el("span", "vib-wtag", "MY WORK"));
        if (tags.childNodes.length) c.appendChild(tags);
      }
      const cap = el("div", "c");
      if (it.kind === "text") {
        if (memoOf(it)) cap.appendChild(el("div", "w", memoOf(it)));
      } else if ((it.kind === "audio" || it.kind === "pdf") && !memoOf(it)) {
        cap.appendChild(el("div", "n", titleOf(it)));
      } else {
        if (titleOf(it)) cap.appendChild(el("div", "n", titleOf(it)));
        if (restOf(it)) cap.appendChild(el("div", "w", restOf(it)));
      }
      if (it.stars) {
        const st = el("span", "vib-stars", "★".repeat(it.stars));
        st.title = STAR_WORDS[it.stars];
        c.appendChild(st);
        /* words have no picture for the stars to sit on: room above them */
        if (it.kind === "text") c.classList.add("starred-words");
      }
      const m = el("div", "m");
      const fs = (it.folders || []).map(nameOf).join(" · ");
      const from = host(it.source) || VIA[it.via] || "";
      if (it.new) { const b = el("b", null, "New"); m.appendChild(b); m.append(fs || from ? " · " : ""); }
      m.append([fs, from].filter(Boolean).join(" · "));
      if (it.used) { m.append(" · "); m.appendChild(el("b", null, "Used")); }
      /* how long a starred idea has gone unopened, once it is a while */
      if (it.stars && P.vib_folder === "starred") {
        const days = Math.floor((Date.now() / 1000 - (it.seen || it.added || 0)) / DAY);
        if (days >= 7) { m.append(" · "); m.appendChild(el("b", null, `${Math.floor(days / 7)} wk unseen`)); }
      }
      cap.appendChild(m);
      c.appendChild(cap);
      c.addEventListener("click", () => openLook(list.map(x => x.id), list.indexOf(it), false));
      cols.appendChild(c);
    }
  }

  /* Where the wall is, over the pictures: the folder's path, each folder
     above it a step back up, and how many are shown. */
  const CARD_W = [120, 440], CARD_W_DEFAULT = 170;
  const cardW = () => Math.max(CARD_W[0], Math.min(CARD_W[1], Number(P.vib_cardw) || CARD_W_DEFAULT));
  const paintCardW = () => {
    wall.style.setProperty("--cardw", `${cardW()}px`);
    wall.style.setProperty("--chipz", String(chipZ()));
  };
  /* the size of the chips on the Keywords and Sites pages - its own slider,
     kept with the node */
  const CHIP_Z = [0.8, 1.8], CHIP_Z_DEFAULT = 1;
  const chipZ = () => Math.max(CHIP_Z[0], Math.min(CHIP_Z[1], Number(P.vib_chipz) || CHIP_Z_DEFAULT));
  /* the side a card's picture is fetched at: sharp at the size it is drawn */
  const cardSide = () => (cardW() > 300 ? 960 : cardW() > 220 ? 720 : 480);

  function crumb(n) {
    const bar = el("div", "vib-crumb");
    const go = (key) => {
      P.vib_folder = key;
      S.order = null;
      shuffleBtn.classList.remove("on");
      wall.scrollTop = 0;
      paintNav();
      paintWall();
    };
    const step = (label, key) => {
      const b = el("button", null, label);
      b.title = `Back to ${label}`;
      b.addEventListener("click", (e) => { e.stopPropagation(); go(key); });
      return b;
    };
    const f = P.vib_folder;
    if (f === "all") bar.appendChild(el("b", null, "All ideas"));
    else if (f === "starred") bar.append(step("All ideas", "all"), el("i", null, "›"), el("b", null, "★ Starred"));
    else if (f === "used") bar.append(step("All ideas", "all"), el("i", null, "›"), el("b", null, "Used in a series"));
    else if (f === "keywords") bar.append(step("All ideas", "all"), el("i", null, "›"), el("b", null, "# Keywords"));
    else if (f === "sites") bar.append(step("All ideas", "all"), el("i", null, "›"), el("b", null, "Sites"));
    else if (f === "works") bar.appendChild(el("b", "silver", "My works"));
    else if (String(f).startsWith("w:")) bar.append(step("My works", "works"), el("i", null, "›"), el("b", "silver", f.slice(2)));
    else {
      bar.append(step("All ideas", "all"));
      const parts = f.split("/");
      parts.forEach((name, i) => {
        bar.appendChild(el("i", null, "›"));
        const path = parts.slice(0, i + 1).join("/");
        bar.appendChild(i === parts.length - 1 ? el("b", null, name) : step(name, path));
      });
    }
    const words = q.value.trim();
    if (words) { bar.appendChild(el("i", null, "·")); bar.appendChild(el("span", null, `“${words}”`)); }
    if (kwChosen().length) { bar.appendChild(el("i", null, "·")); kwChips(bar); }
    if (f === "sites") bar.appendChild(el("em", null, String(sitesList.length)));
    else if (n || f !== "keywords") bar.appendChild(el("em", null, String(n)));
    /* how large the ideas are on the wall - kept with the node */
    /* My works: renders made the same way put together, as one idea */
    if (n && isWorkView(f)) {
      const groups = alikeWorks(visible());
      if (groups.length) {
        const gb = el("button", "vib-alike", `⧉ Group alike · ${groups.reduce((a, g) => a + g.length - 1, 0)}`);
        gb.title = "Put together the renders from one folder - one scene, LoRA, sampler and enhancer, a band of the Image Viewer -\neach as one idea with several pictures";
        gb.addEventListener("click", (e) => { e.stopPropagation(); groupAlike(groups); });
        bar.appendChild(gb);
      }
    }
    if (f === "sites" || f === "keywords") {
      const sz = el("span", "vib-size vib-chipsize");
      const r = el("input", "vib-light");
      r.type = "range";
      r.min = String(CHIP_Z[0]); r.max = String(CHIP_Z[1]); r.step = "0.05";
      r.value = String(chipZ());
      r.title = `The size of the ${f === "sites" ? "sites" : "keywords"}\nDouble click for the size they had`;
      r.setAttribute("aria-label", "Size of the chips");
      const paintR = () => r.style.setProperty("--pct", `${((r.value - CHIP_Z[0]) / (CHIP_Z[1] - CHIP_Z[0])) * 100}%`);
      paintR();
      r.addEventListener("pointerdown", (e) => e.stopPropagation());
      r.addEventListener("input", () => { P.vib_chipz = Number(r.value); paintR(); paintCardW(); });
      r.addEventListener("dblclick", () => { delete P.vib_chipz; r.value = String(chipZ()); paintR(); paintCardW(); });
      sz.append(el("i", "s"), r, el("i", "l"));
      bar.appendChild(sz);
    }
    if (n) {
      const sz = el("span", "vib-size");
      const r = el("input", "vib-light");
      r.type = "range";
      r.min = String(CARD_W[0]); r.max = String(CARD_W[1]); r.step = "5";
      r.value = String(cardW());
      r.title = "The size of the ideas on the wall\nDouble click for the size they had";
      r.setAttribute("aria-label", "Size of the ideas");
      const paintR = () => r.style.setProperty("--pct", `${((r.value - CARD_W[0]) / (CARD_W[1] - CARD_W[0])) * 100}%`);
      paintR();
      r.addEventListener("pointerdown", (e) => e.stopPropagation());
      r.addEventListener("input", () => { P.vib_cardw = Number(r.value); paintR(); paintCardW(); });
      /* pictures drawn larger are fetched larger, once the slider is let go */
      r.addEventListener("change", () => paintWall());
      r.addEventListener("dblclick", () => { delete P.vib_cardw; paintCardW(); paintWall(); });
      sz.append(el("i", "s"), r, el("i", "l"));
      bar.appendChild(sz);
    }
    if (n) {
      const bb = el("button", "vib-briefbtn", "✎ BRIEF");
      bb.title = "A brief for the AI that writes the series\nClick to make one of the ideas shown here - the words to copy, the pictures numbered to attach";
      bb.addEventListener("click", (e) => { e.stopPropagation(); openBrief(); });
      bar.appendChild(bb);
    }
    return bar;
  }

  /* ---- the brief
     What the box holds, put as a request: the ideas chosen, numbered, each
     with its notes, folders, stars and address - and a few lines on the
     series wanted. Copied, it is pasted where the series is written; the
     pictures are written out with the same numbers, to be attached. */
  function briefOpts() {
    const o = P.vib_brief && typeof P.vib_brief === "object" ? P.vib_brief : (P.vib_brief = {});
    for (const k of ["title", "story", "model", "mood"]) if (typeof o[k] !== "string") o[k] = "";
    if (!["any", "short", "mid", "long"].includes(o.scenes)) o.scenes = "any";
    if (!["mixed", "portrait", "landscape"].includes(o.frames)) o.frames = "mixed";
    return o;
  }
  const SCENES = { any: "", short: "5-6 scenes", mid: "10-13 scenes", long: "15-18 scenes" };
  const FRAMES = { mixed: "portrait and landscape, mixed", portrait: "portrait", landscape: "landscape" };

  function briefText(list, o) {
    const L = [];
    L.push(`# Series brief${o.title ? " - " + o.title : ""}`);
    L.push("");
    if (o.story.trim()) { L.push("Story:"); L.push(o.story.trim()); L.push(""); }
    const facts = [
      SCENES[o.scenes] ? `Scenes: ${SCENES[o.scenes]}` : "",
      `Frames: ${FRAMES[o.frames]}`,
      o.model.trim() ? `Model: ${o.model.trim()}` : "",
      o.mood.trim() ? `Mood: ${o.mood.trim()}` : "",
    ].filter(Boolean);
    L.push(...facts);
    L.push("");
    L.push("Please write the whole series as a Series Book pack for Paste All - the series note, every scene with its frame, its notes and its anchors - and a short scene-by-scene summary of the story.");
    L.push("");
    const pics = list.filter(it => it.kind === "image" || (it.kind === "pdf" && it.thumb)).length;
    L.push(`## References (${list.length})${pics ? ` - the pictures are attached, numbered as here` : ""}`);
    list.forEach((it, i) => {
      const no = String(i + 1).padStart(2, "0");
      const film = videoOf(it.source);
      const kind = film ? `${/vimeo/i.test(it.source) ? "Vimeo" : "YouTube"} film`
        : it.kind === "image" ? (it.captured ? "web page, captured" : "picture") : it.kind === "video" ? "film"
        : it.kind === "audio" ? "sound" : it.kind === "pdf" ? `PDF${it.pages ? `, ${it.pages} page${it.pages === 1 ? "" : "s"}` : ""}` : "text";
      const where = (it.folders || []).map(f => f.split("/").join(" › ")).join(", ");
      L.push("");
      L.push(`${no} · ${titleOf(it) || "(untitled)"} - ${kind}${it.stars ? " " + "★".repeat(it.stars) + " " + STAR_WORDS[it.stars] : ""}`);
      /* a line of text named by its own first line goes on from its second */
      const rest = it.kind === "text"
        ? (memoOf(it) ? String(it.text || "").trim() : String(it.text || "").trim().split(/\r?\n/).slice(1).join("\n").trim())
        : restOf(it);
      if (rest) L.push(...rest.split(/\r?\n/).map(x => "   " + x));
      if (where) L.push(`   Folder: ${where}`);
      if ((it.more || []).length) L.push(`   ${1 + it.more.length} pictures - attached as ${no}, ${it.more.map((_, k) => `${no}-${k + 2}`).join(", ")}`);
      if (it.source) L.push(`   Source: ${it.source}`);
      else if (it.name) L.push(`   File: ${it.name}`);
    });
    return L.join("\n");
  }

  let briefEl = null;
  function closeBrief() { if (briefEl) { briefEl.remove(); briefEl = null; } }
  function openBrief() {
    closeBrief();
    const o = briefOpts();
    if (!o.title && S.folders.includes(P.vib_folder)) o.title = nameOf(P.vib_folder);
    const list = visible();
    const chosen = new Set(list.slice(0, 24).map(x => x.id));
    briefEl = el("div", "vib-helpbox vib-brief");
    const hb = el("div", "hb-bar");
    hb.appendChild(el("b", null, "BRIEF FOR THE AI"));
    const x = el("button", "vib-btn", "Close");
    x.addEventListener("click", closeBrief);
    hb.appendChild(x);
    const body = el("div", "br-body");
    // the ideas
    const pick = el("div", "br-pick");
    const pickHead = el("div", "br-ph");
    const count = el("span");
    const allB = el("button", "vib-btn", "All"), noneB = el("button", "vib-btn", "None");
    pickHead.append(count, allB, noneB);
    const rows = el("div", "br-rows");
    pick.append(pickHead, rows);
    // the form
    const form = el("div", "br-form");
    const field = (label, node) => { const w = el("label", "br-f"); w.append(el("span", "vib-h", label), node); return w; };
    const title = el("input"); title.value = o.title; title.placeholder = "A working title";
    const story = el("textarea"); story.value = o.story; story.placeholder = "What the series is about - a line, or a page. Any language.";
    const model = el("input"); model.value = o.model; model.placeholder = "Who the series is about";
    const mood = el("input"); mood.value = o.mood; mood.placeholder = "Light, colour, era, feeling…";
    const seg = (key, items) => {
      const g = el("span", "vib-seg");
      for (const [v, label] of items) {
        const b = el("button", o[key] === v ? "on" : "", label);
        b.addEventListener("click", (e) => { e.preventDefault(); o[key] = v; [...g.children].forEach(c => c.classList.toggle("on", c === b)); paintOut(); });
        g.appendChild(b);
      }
      return g;
    };
    const segRow = (label, g) => { const w = el("div", "br-f"); w.append(el("span", "vib-h", label), g); return w; };
    form.append(field("TITLE", title), field("STORY", story),
      segRow("SCENES", seg("scenes", [["any", "Up to you"], ["short", "5-6"], ["mid", "10-13"], ["long", "15-18"]])),
      segRow("FRAMES", seg("frames", [["mixed", "Mixed"], ["portrait", "Portrait"], ["landscape", "Landscape"]])),
      field("MODEL", model), field("MOOD", mood));
    const out = el("textarea", "br-out");
    out.readOnly = true;
    const acts = el("div", "br-acts");
    const say2 = el("span", "br-say");
    const saveB = el("button", "vib-btn big", "Save pictures");
    saveB.title = "The chosen pictures, numbered as in the brief, into output / Idea Box / Briefs - the folder opens, to drag them into the chat";
    const copyB = el("button", "vib-btn gold big", "Copy brief");
    copyB.title = "The brief to the clipboard - paste it where the series is written";
    acts.append(say2, saveB, copyB);
    form.append(field("THE BRIEF", out), acts);
    body.append(pick, form);
    briefEl.append(hb, body);
    root.appendChild(briefEl);

    const picked = () => list.filter(it => chosen.has(it.id));
    function paintOut() {
      o.title = title.value; o.story = story.value; o.model = model.value; o.mood = mood.value;
      out.value = briefText(picked(), o);
      count.textContent = `${chosen.size} of ${list.length} ideas`;
    }
    function paintRows() {
      rows.textContent = "";
      list.forEach((it) => {
        const r = el("label", "br-row" + (chosen.has(it.id) ? " on" : ""));
        const cb = el("input"); cb.type = "checkbox"; cb.checked = chosen.has(it.id);
        cb.addEventListener("change", () => { if (cb.checked) chosen.add(it.id); else chosen.delete(it.id); r.classList.toggle("on", cb.checked); paintOut(); });
        const th = el("span", "br-th");
        if (it.kind === "image" || (it.kind === "pdf" && it.thumb)) { const im = el("img"); im.loading = "lazy"; im.src = picURL(it, 160); im.alt = ""; th.appendChild(im); }
        else th.textContent = it.kind === "video" ? "▶" : it.kind === "audio" ? "♪" : it.kind === "pdf" ? "PDF" : "Aa";
        const tx = el("span", "br-tx");
        tx.append(el("b", null, titleOf(it) || "(untitled)"), el("i", null, [(it.stars ? "★".repeat(it.stars) : ""), (it.folders || []).map(nameOf).join(" · ")].filter(Boolean).join(" · ")));
        r.append(cb, th, tx);
        rows.appendChild(r);
      });
    }
    allB.addEventListener("click", () => { list.forEach(it => chosen.add(it.id)); paintRows(); paintOut(); });
    noneB.addEventListener("click", () => { chosen.clear(); paintRows(); paintOut(); });
    for (const inp of [title, story, model, mood]) {
      inp.addEventListener("input", paintOut);
      inp.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Escape") closeBrief(); });
      inp.addEventListener("pointerdown", (e) => e.stopPropagation());
    }
    copyB.addEventListener("click", async () => {
      paintOut();
      try { await navigator.clipboard.writeText(out.value); say2.textContent = "Copied - paste it where the series is written"; }
      catch (e) { out.select(); say2.textContent = "Selected - press Ctrl+C"; }
    });
    saveB.addEventListener("click", async () => {
      const ids = picked().map(it => it.id);
      if (!ids.length) { say2.textContent = "Choose an idea first"; return; }
      saveB.disabled = true;
      say2.textContent = "Writing the pictures…";
      try {
        const r = await post(BRIEF_FILES_URL, { ids, title: o.title });
        say2.textContent = r.ok ? `${r.written} picture${r.written === 1 ? "" : "s"} in ${r.folder}` : (r.error || "not written");
      } catch (e) { say2.textContent = "not written"; }
      saveB.disabled = false;
    });
    paintRows();
    paintOut();
  }

  /* over the starred: how many stars at least, and in which order */
  function starBar() {
    const bar = el("div", "vib-starbar");
    const seg = (items, cur, set) => {
      const g = el("span", "vib-seg");
      for (const [v, label, hint] of items) {
        const b = el("button", v === cur ? "on" : "", label);
        if (hint) b.title = hint;
        b.addEventListener("click", (e) => { e.stopPropagation(); set(v); paintWall(); });
        g.appendChild(b);
      }
      return g;
    };
    bar.append(
      seg([[1, "★", "Every starred idea"], [2, "★★", "Love and Next series"], [3, "★★★", "Only those for the next series"]],
        P.vib_starmin, (v) => { P.vib_starmin = v; }),
      seg([["stars", "Most stars", "The most wanted first"], ["unseen", "Longest unseen", "Those not opened for longest first - so a loved idea comes back"]],
        P.vib_starsort, (v) => { P.vib_starsort = v; }));
    return bar;
  }

  function paint() {
    paintFresh();
    paintNav();
    paintWall();
    paintCount();
    inboxBtn.textContent = S.inbox ? `Inbox  ${S.inbox}` : "";
  }

  // ---- looking at one, and sorting
  let lookEl = null;
  let noteTimer = 0;
  let kwTimer = 0;

  async function change(id, changes) {
    const it = byId(id);
    if (it) Object.assign(it, changes);
    const r = await post(UPDATE_URL, { id, changes });
    if (!r.ok) flash(r.error || "the change could not be saved", "err");
    else if (it) Object.assign(it, r.item);
    return r;
  }

  function openLook(ids, at, sort) {
    if (!ids.length) return;
    S.look = { ids, at: Math.max(0, at), sort, sorted: 0,
               wasNew: new Set(ids.filter(id => (byId(id) || {}).new)) };
    paintLook();
    markSeen();
    root.focus({ preventScroll: true });
  }

  /* the parts of an idea Cancel puts back */
  const SNAP_KEYS = ["memo", "note", "folders", "stars", "coverT", "new", "used", "text", "source", "tags", "untags"];
  const snapOf = (it) => {
    const o = {};
    for (const k of SNAP_KEYS) o[k] = Array.isArray(it[k]) ? it[k].slice() : (it[k] === undefined ? null : it[k]);
    return o;
  };
  /* Cancel: whatever was pressed on this idea since it was opened is put back
     as it was - folders, stars, notes, cover - and back to the wall */
  async function cancelLook() {
    const L = S.look;
    const it = L && byId(L.ids[L.at]);
    const snap = S.snap;
    clearTimeout(noteTimer);
    memoInput = null;                    // what was typed is not kept either
    lookWords = null;
    if (it && snap && snap.id === it.id) {
      /* the pictures first: those taken out come back from the trash */
      if ((it.kind === "image" || it.kind === "video") && snap.pics.length && JSON.stringify(picsOf(it)) !== JSON.stringify(snap.pics)) {
        const r = await post(MORE_SET_URL, { id: it.id, file: snap.pics[0], more: snap.pics.slice(1) });
        if (r.ok) takeItem(it, r.item);
      }
      const now = snapOf(it);
      const back = {};
      for (const k of SNAP_KEYS) {
        if (JSON.stringify(now[k]) === JSON.stringify(snap.was[k])) continue;
        back[k] = snap.was[k] === null ? (k === "folders" || k === "tags" || k === "untags" ? [] : k === "stars" ? 0 : k === "new" || k === "used" ? false : k === "coverT" ? null : "") : snap.was[k];
      }
      if (Object.keys(back).length) {
        if ("new" in back && back.new && L.sorted) L.sorted -= 1;
        await change(it.id, back);
        flash("put back as it was");
      }
    }
    S.snap = null;
    closeLook();
  }

  function closeLook() {
    if (lookWords) { lookWords(); lookWords = null; }
    S.snap = null;
    lookSay = null;
    flushNote();
    const L = S.look;
    S.look = null;
    if (lookEl) { lookEl.remove(); lookEl = null; }
    if (L && L.sort && L.sorted) flash(`${L.sorted} sorted`);
    paint();
    root.focus({ preventScroll: true });
  }

  let memoInput = null;
  function flushNote() {
    clearTimeout(noteTimer);
    const L = S.look;
    if (!L || !memoInput) return;
    const it = byId(L.ids[L.at]);
    if (!it) return;
    const m = memoInput.value.replace(/\s+$/, "");
    /* the old one-line note is part of the notes now and goes with them */
    if (m !== memoOf(it) || it.note) change(it.id, { memo: m, note: "" });
  }

  function step(d, sortedNow) {
    const L = S.look;
    if (!L) return;
    flushNote();
    const it = byId(L.ids[L.at]);
    if (L.sort && sortedNow && it && it.new) {
      change(it.id, { new: false });
      L.sorted += 1;
    }
    const next = L.at + d;
    if (next < 0) return;
    if (next >= L.ids.length) { closeLook(); return; }
    L.at = next;
    paintLook();
    markSeen();
  }

  /* an idea opened is an idea seen - for "longest unseen" */
  function markSeen() {
    const L = S.look;
    const it = L && byId(L.ids[L.at]);
    if (!it) return;
    const now = Date.now() / 1000;
    if (now - (it.seen || 0) < 60) return;
    it.seen = now;
    post(UPDATE_URL, { id: it.id, changes: { seen: now } }).catch(() => {});
  }

  function setStars(n) {
    const L = S.look;
    const it = L && byId(L.ids[L.at]);
    if (!it) return;
    n = Math.max(0, Math.min(3, n));
    change(it.id, { stars: n });
    flash(n ? `${"★".repeat(n)} ${STAR_WORDS[n]}` : "no stars");
    paintLook(true);
  }

  function toggleFolder(f) {
    const L = S.look;
    if (!L) return;
    const it = byId(L.ids[L.at]);
    if (!it) return;
    const has = (it.folders || []).includes(f);
    const folders = has ? it.folders.filter(x => x !== f) : [...(it.folders || []), f];
    /* in the order of the folders, whatever order they were chosen in */
    folders.sort((a, b) => S.folders.indexOf(a) - S.folders.indexOf(b));
    /* An idea given a folder is sorted: it leaves the New strip then and
       there, whether the next one is opened or Done is pressed. One that
       came in new and loses its last folder again goes back to the new ones. */
    const changes = { folders };
    if (folders.length && it.new) {
      changes.new = false;
      L.sorted += 1;
    } else if (!folders.length && L.wasNew && L.wasNew.has(it.id) && !it.new) {
      changes.new = true;
      L.sorted = Math.max(0, L.sorted - 1);
    }
    change(it.id, changes);
    paintLook(true);
  }

  /* one sound at a time, played from the wall without opening it */
  let sound = null;
  let playing = null;
  function stopSound() {
    if (sound) { sound.pause(); sound = null; }
    if (playing) {
      const was = wall.querySelector(`[data-iid="${playing}"] .vib-sound-play`);
      if (was) was.textContent = "▶";
      playing = null;
    }
  }
  function playSound(it, btn) {
    if (playing === it.id) { stopSound(); return; }
    stopSound();
    sound = new Audio(picURL(it, 0));
    playing = it.id;
    btn.textContent = "❚❚";
    sound.addEventListener("ended", stopSound);
    sound.play().catch(() => { stopSound(); flash("the sound could not be played", "err"); });
  }

  let lookZoom = null;     // the open picture, to be zoomed by the keys
  let lookZoomL = null, lookFullL = null;   // the pinned one, when the pointer is over it
  let lookScroll = null;   // pictures one under another: run to one of them
  let picAim = null;       // the picture the keys last sent it to, while it runs there
  let lookWords = null;    // words being changed in place: keep them now
  let lookKw = null;       // the keywords of the idea open, painted again as its notes change
  let besideNotes = null;  // the notes beside the picture, painted again as they change
  let lookFull = null;

  let capturing = null;
  async function capturePage(id) {
    if (capturing) return;
    capturing = id;
    paintLook(true);
    flash("capturing the page - a few seconds…");
    let r;
    try { r = await post(CAPTURE_URL, { id }); }
    catch (e) { r = { ok: false, error: "the page could not be captured" }; }
    capturing = null;
    if (r.ok) {
      const it = byId(id);
      if (it) { Object.keys(it).forEach(k => delete it[k]); Object.assign(it, r.item); }
      flash("the page is its picture now");
      refreshAll(api_);
    } else flash(r.error || "the page could not be captured", "err");
    if (S.look && S.look.ids[S.look.at] === id) paintLook(true);
    else paint();
  }

  let armedDelete = null;
  async function deleteNow() {
    const L = S.look;
    if (!L) return;
    const id = L.ids[L.at];
    if (armedDelete !== id) {
      armedDelete = id;
      paintLook(true);
      clearTimeout(disarmTimer);
      disarmTimer = setTimeout(() => {
        if (armedDelete === id) { armedDelete = null; if (S.look) paintLook(true); }
      }, ARM_MS);
      return;
    }
    clearTimeout(disarmTimer);
    armedDelete = null;
    const r = await post(DELETE_URL, { id });
    if (!r.ok) { flash(r.error || "it could not be deleted", "err"); return; }
    S.items = S.items.filter(x => x.id !== id);
    L.ids.splice(L.at, 1);
    flash("deleted - the picture is kept in the trash folder");
    if (!L.ids.length) { closeLook(); return; }
    if (L.at >= L.ids.length) L.at = L.ids.length - 1;
    paintLook();
    refreshAll(api_);
  }

  function bookNode() {
    const nodes = (app.graph && (app.graph._nodes || app.graph.nodes)) || [];
    return nodes.find(n => (n.comfyClass || n.type) === BOOK && typeof n.leielSeedSeries === "function") || null;
  }

  async function toReader(it, file) {
    const nodes = (app.graph && (app.graph._nodes || app.graph.nodes)) || [];
    const books = nodes.filter(n => (n.comfyClass || n.type) === BOOK);
    if (!books.length) { flash("put a Series Book on the canvas first - the picture is read there", "err"); return; }
    const book = books.find(n => typeof n.leielPutReaderImage === "function");
    /* a Series Book built before this update has no way in yet */
    if (!book) { flash("the Series Book is an older one - reload the page with Ctrl+F5 and press it again", "err"); return; }
    flash("putting the picture into the Series Book…");
    let r;
    try { r = await book.leielPutReaderImage(new URL(picURL(it, 0, file), location.href).href); }
    catch (e) { r = { ok: false, msg: String((e && e.message) || e) }; }
    if (!r || !r.ok) { flash((r && r.msg) || "the Series Book could not take it", "err"); return; }
    flash(r.where === "reader"
      ? "in the Series Book's Reader - choose the anchors and press Read"
      : `in "${r.title}" in the Series Book - choose what to read and press Read`);
    /* the Reader that took it lights up for a moment, so the eye finds it */
    setTimeout(() => {
      try {
        const host = (book.widgets || []).map(w => w.element).find(Boolean);
        const drop = host && (host.querySelector(".lvr-well") || host.querySelector(".lvr-drop"));
        if (!drop) return;
        drop.classList.add("vib-arrived");
        setTimeout(() => drop.classList.remove("vib-arrived"), 1800);
      } catch (e) { /* nothing to light */ }
    }, 120);
  }

  async function startSeries() {
    const L = S.look;
    if (!L) return;
    flushNote();
    const it = byId(L.ids[L.at]);
    if (!it) return;
    const book = bookNode();
    if (!book) { flash("put a Series Book on the canvas first - the series starts there", "err"); return; }
    const line = titleOf(it).replace(/\s+/g, " ").trim();
    const name = line ? line.slice(0, 48) : "From the Idea Box";
    /* the production notes, not the series note: the series note is printed
       by the Series Layout and is left for the series' own words */
    const note = [
      it.kind === "text" ? it.text : "",
      memoOf(it),
      (it.folders || []).length ? `Idea Box: ${(it.folders || []).join(", ")}` : "Idea Box",
      it.source ? `Source: ${it.source}` : "",
    ].filter(Boolean).join("\n\n");
    const pic = it.kind === "image" ? picURL(it, 720) : null;
    const r = await book.leielSeedSeries(name, note, pic);
    if (r && r.ok === false) { flash(r.msg || "the Series Book could not start it", "err"); return; }
    await change(it.id, { used: true, new: false });
    flash(`series "${name}" started in the Series Book`);
    paintLook(true);
  }

  /* FILE INFO: what the file is, in a small table - its kind and format,
     its size in pixels, its length, its pages, its weight on the disk, and
     when it came in and was last opened. A film or a sound gives its size
     and length once its player has read them. */
  function fileInfo(it, media) {
    const box = el("div", "vib-sec vib-info");
    box.appendChild(el("span", "vib-h", "FILE INFO"));
    const tb = el("div", "vib-infotab");
    const put = (k, v) => {
      if (!v) return null;
      const r = el("div", "r");
      r.append(el("span", "k", k), el("span", "v", v));
      tb.appendChild(r);
      return r.lastChild;
    };
    const fmt = it.kind === "text" ? "" : formatOf(it);
    /* a link is said as what it is - a film on YouTube, a web page - and the
       picture kept with it as its cover, not as the thing itself */
    const film = videoOf(it.source);
    const site = /vimeo/i.test(it.source || "") ? "Vimeo" : "YouTube";
    const page = !film && it.kind === "image" && looksLikeURL(it.source) && it.via !== "layout"
      && !/\.(jpe?g|png|webp|gif|avif|bmp)(\?|#|$)/i.test(it.source);
    const cover = film || (page && !it.captured);
    put("Type", film ? `${site} film · link`
      : page ? (it.captured ? `Web page · captured ${fmt}` : "Web page · link")
      : it.kind === "text" ? (it.source ? "Text · web page" : "Text")
      : `${fmt} ${KIND_WORD[it.kind] || ""}`.trim());
    if (it.kind === "image" && it.w && it.h) {
      const mp = (it.w * it.h) / 1e6;
      put(cover ? "Cover" : "Size", `${it.w} × ${it.h} px · ${mp >= 1 ? mp.toFixed(1) + " MP" : Math.round(mp * 1000) / 1000 + " MP"}`);
      const g = (a, b) => (b ? g(b, a % b) : a), d = g(it.w, it.h);
      const rw = it.w / d, rh = it.h / d;
      put("Ratio", rw <= 32 && rh <= 32 ? `${rw}:${rh}` : (it.w / it.h).toFixed(2));
    }
    if (it.kind === "pdf" && it.pages) put("Pages", String(it.pages));
    if ((it.more || []).length) put("Pictures", `${1 + it.more.length} from the same page`);
    const sizeCell = it.kind === "video" ? put("Size", "…") : null;
    const lenCell = it.kind === "video" || it.kind === "audio" ? put("Length", "…") : null;
    if (it.kind === "text") put("Length", `${(it.text || "").length.toLocaleString()} characters`);
    put(cover ? "Cover file" : "File", bytesWord(it.bytes) + (cover && fmt ? ` · ${fmt}` : ""));
    if (it.name) put("Name", it.name);
    put("Added", whenWord(it.added));
    if (it.seen) put("Opened", whenWord(it.seen));
    if (media) {
      media.addEventListener("loadedmetadata", () => {
        if (lenCell) lenCell.textContent = clockWord(media.duration) || "-";
        if (sizeCell) sizeCell.textContent = media.videoWidth ? `${media.videoWidth} × ${media.videoHeight} px` : "-";
      }, { once: true });
    }
    box.appendChild(tb);
    return box;
  }

  function paintLook(keepNote) {
    const L = S.look;
    if (!L) return;
    const it = byId(L.ids[L.at]);
    if (!it) { closeLook(); return; }
    /* how the idea was when it was opened - what Cancel goes back to */
    if (!S.snap || S.snap.id !== it.id) S.snap = { id: it.id, was: snapOf(it), pics: picsOf(it) };
    const typedMemo = keepNote && memoInput ? memoInput.value : null;
    const hadMemo = keepNote && memoInput && document.activeElement === memoInput;
    if (lookEl) lookEl.remove();
    if (lookWords) lookWords();
    lookZoom = null; lookFull = null; lookScroll = null; lookWords = null; lookKw = null;
    lookZoomL = null; lookFullL = null; S.overPin = false;
    lookEl = el("div", "vib-look");

    const lb = el("div", "vib-look-bar");
    lb.appendChild(el("b", null, L.sort ? `NEW · ${L.at + 1} OF ${L.ids.length}` : `${L.at + 1} OF ${L.ids.length}`));
    const ticks = el("div", "vib-ticks");
    if (L.ids.length <= 60) L.ids.forEach((id, i) => {
      const t = el("i", i === L.at ? "at" : (L.sort && byId(id) && !byId(id).new ? "done" : ""));
      ticks.appendChild(t);
    });
    lb.appendChild(ticks);
    lookSay = el("span", "vib-say vib-lsay");
    lb.appendChild(lookSay);


    const body = el("div", "vib-look-body");
    const stage = el("div", "vib-stage");
    const pic = el("div", "vib-pic");
    let media = null;          // a film or a sound, to read its length from
    if (it.kind === "text") {
      /* The words are the page itself, and can be changed in place - added
         to, cut, broken into lines; no styles. Kept a moment after the
         typing stops, and when the page is left. */
      const q = el("div", "q");
      const setWords = (t) => {
        q.textContent = "";
        const cut = t.indexOf("\n");
        if (cut > 0) q.append(el("b", null, t.slice(0, cut)), t.slice(cut + 1));
        else q.append(el("b", null, t));
      };
      setWords(String(it.text || "").replace(/^\s+/, ""));
      q.contentEditable = "plaintext-only";
      q.spellcheck = false;
      q.title = "Click anywhere to change the words";
      let textTimer = 0;
      /* the idea as it is now: the box looks again every few seconds, and
         the copy held when the page was opened may be an older one */
      const now = () => byId(it.id) || it;
      const keepWords = () => {
        clearTimeout(textTimer);
        const t = q.innerText.replace(/\u00a0/g, " ").replace(/\s+$/, "").replace(/^\s+/, "").slice(0, 8000);
        if (!t || t === String(now().text || "").trim()) return;
        now().text = t;
        change(it.id, { text: t });
      };
      q.addEventListener("input", () => { clearTimeout(textTimer); textTimer = setTimeout(keepWords, 900); });
      q.addEventListener("blur", () => {
        keepWords();
        /* painted again only when what is shown is not what is kept */
        const kept = String(now().text || "").replace(/^\s+/, "");
        if (q.innerText.replace(/\u00a0/g, " ").replace(/\s+$/, "") !== kept.replace(/\s+$/, "")) setWords(kept);
      });
      q.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Escape" || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) { e.preventDefault(); q.blur(); root.focus({ preventScroll: true }); }
      });
      q.addEventListener("pointerdown", (e) => e.stopPropagation());
      lookWords = keepWords;
      pic.appendChild(q);
    } else if (it.kind === "audio") {
      stopSound();
      const box = el("div", "vib-sound big");
      box.innerHTML = SOUND_BIG_SVG;
      box.appendChild(el("b", null, titleOf(it)));
      const a = document.createElement("audio");
      media = a;
      a.src = picURL(it, 0);
      a.controls = true;
      a.preload = "metadata";
      box.appendChild(a);
      pic.appendChild(box);
    }
    else if (it.kind === "pdf") {
      /* the browser's own reader, pages and all */
      const f = el("iframe", "vib-film vib-pdf");
      f.src = picURL(it, 0);
      f.title = titleOf(it) || "PDF";
      pic.appendChild(f);
      const tools = el("div", "vib-ztools on");
      const zFull = el("button", "full", "⤢ FULL SCREEN");
      zFull.setAttribute("aria-label", "The PDF over the whole window");
      zFull.title = "The PDF over the whole window (F)";
      zFull.addEventListener("click", () => fullView(picURL(it, 0), titleOf(it), "pdf"));
      tools.appendChild(zFull);
      pic.appendChild(tools);
      lookFull = () => fullView(picURL(it, 0), titleOf(it), "pdf");
    }
    else if (it.kind === "video" && !(S.picFor === it.id && S.picShown && S.picShown !== it.file && picsOf(it).includes(S.picShown))) {
      /* a kept film plays here with its own controls, sound on - unless one
         of the stills taken from it was chosen under it */
      S.picFor = it.id;
      S.picShown = it.file;
      const v = document.createElement("video");
      media = v;
      v.className = "vib-film";
      v.src = picURL(it, 0);
      v.controls = true;
      v.playsInline = true;
      v.preload = "metadata";
      v.addEventListener("loadedmetadata", () => {
        try { v.currentTime = coverTime(it, v.duration); } catch (e) { /* not seekable yet */ }
      }, { once: true });
      pic.appendChild(v);
      /* the frame shown now becomes the film's picture on the wall */
      const tools = el("div", "vib-ztools on vib-covertool");
      const cov = el("button", "full", Number.isFinite(it.coverT) ? `◉ COVER ${clockWord(Math.floor(it.coverT)) || "0:00"}` : "◉ SET AS COVER");
      cov.title = "The frame shown now becomes the film's picture on the wall\nClick to use this frame - pause where you want it first";
      cov.addEventListener("click", async () => {
        const t = Math.round(v.currentTime * 100) / 100;
        await change(it.id, { coverT: t });
        cov.textContent = `◉ COVER ${clockWord(Math.floor(t)) || "0:00"}`;
        flash(`the film shows ${clockWord(Math.floor(t)) || "0:00"} on the wall now`);
        paintWall();
      });
      tools.appendChild(cov);
      /* the frame shown now kept as a picture of its own, under the film */
      tools.appendChild(el("i", "sep"));
      const still = el("button", "full", "◧ STILL");
      still.title = "Keep the frame shown now as a picture under the film\nPause where you want it first - it can go to the Series Book's Reader";
      still.addEventListener("click", async () => {
        if (still.disabled) return;
        still.disabled = true;
        try { await addStill(it, await stillOfVideo(v), v.currentTime); }
        catch (e) { flash(String((e && e.message) || e), "err"); }
        finally { still.disabled = false; }
      });
      tools.appendChild(still);
      pic.appendChild(tools);
    }
    else if (it.kind === "image" && picsOf(it).length > 1 && S.picMode !== "one" && !videoOf(it.source)) {
      /* More than one picture: one under another, joined, the wheel running
         down through them as down a page. The strip marks the one in view;
         a click on a picture looks at it closer, alone. */
      if (S.picFor !== it.id) { S.picFor = it.id; S.picShown = it.file; S.picMode = "scroll"; }
      const col = el("div", "vib-pscroll");
      const inner = el("div", "vib-pcol");
      for (const f of picsOf(it)) {
        const ent = picEntry(it, f);
        const im = el("img");
        im.alt = "";
        im.loading = "lazy";
        if (ent.w && ent.h) im.style.aspectRatio = `${ent.w} / ${ent.h}`;
        im.src = picURL(it, 1600, f);
        im.dataset.iid = it.id;
        im.dataset.file = f;
        im.draggable = true;
        im.title = "Click to look closer · drag onto the Series Book's Reader to read it";
        im.addEventListener("click", () => { S.picShown = f; S.picMode = "one"; paintLook(true); });
        inner.appendChild(im);
      }
      col.appendChild(inner);
      pic.classList.add("scroll");
      pic.appendChild(col);
      const tools = el("div", "vib-ztools");
      const cnt = el("span", "vib-pcount", "");
      const zFull = el("button", "full", "⤢");
      zFull.setAttribute("aria-label", "The picture in view over the whole window");
      zFull.title = "The picture in view over the whole window (F)";
      tools.append(cnt, zFull);
      pic.appendChild(tools);
      zFull.addEventListener("click", () => fullOf(it, S.picShown));
      lookFull = () => fullOf(it, S.picShown);
      /* the one in view: the one crossing the middle of the window */
      const files = picsOf(it);
      const inView = () => {
        const mid = col.scrollTop + col.clientHeight / 2;
        let at = 0;
        [...inner.children].forEach((x, k) => { if (x.offsetTop <= mid) at = k; });
        if (col.scrollTop + col.clientHeight >= col.scrollHeight - 2) at = files.length - 1;
        cnt.textContent = `${at + 1} / ${files.length}`;
        if (S.picShown !== files[at]) {
          S.picShown = files[at];
          for (const t of stage.querySelectorAll(".vib-pth")) t.classList.toggle("on", t.dataset.file === S.picShown);
          /* the notes over it follow the picture in view */
          if (besideNotes) besideNotes(picNote(it, S.picShown, memoInput ? memoInput.value : null));
        }
      };
      col.addEventListener("scroll", inView, { passive: true });
      col.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });
      /* back where it was looking - after a closer look, at that picture */
      const start = files.indexOf(S.picShown);
      requestAnimationFrame(() => {
        if (start > 0 && inner.children[start]) col.scrollTop = inner.children[start].offsetTop;
        inView();
      });
      lookScroll = (f) => {
        const k = files.indexOf(f);
        if (k >= 0 && inner.children[k]) col.scrollTo({ top: inner.children[k].offsetTop, behavior: "smooth" });
      };
    }
    else {
      /* the picture shown, of those the idea holds - its own, unless another
         was chosen under it */
      if (S.picFor !== it.id || !picsOf(it).includes(S.picShown)) { S.picFor = it.id; S.picShown = it.file; S.picMode = "scroll"; }
      const shown = S.picShown;
      const ent = picEntry(it, shown);
      const im = el("img");
      im.alt = titleOf(it);
      im.src = picURL(it, 1600, shown);
      im.dataset.iid = it.id;
      im.dataset.file = shown;
      im.draggable = true;
      im.title = "Click to zoom in, Ctrl+click out · wheel to zoom · drag onto the Series Book's Reader to read it";
      pic.appendChild(im);
      const pill = el("span", "vib-hintpill");
      pill.innerHTML = "Drag onto the <b>Series Book</b> Reader to read it";
      pic.appendChild(pill);
      /* looking closer: the wheel, a drag, a click - or the whole window */
      const tools = el("div", "vib-ztools");
      const zOut = el("button", null, "−"), zPct = el("span", null, "Fit"), zIn = el("button", null, "+");
      const zFull = el("button", "full", "⤢");
      zOut.setAttribute("aria-label", "Zoom out"); zIn.setAttribute("aria-label", "Zoom in");
      zFull.setAttribute("aria-label", "The picture over the whole window"); zFull.title = "The picture over the whole window (F)";
      zPct.title = "Back to fit (/ or 0) · * for 100%";
      if (picsOf(it).length > 1 && !videoOf(it.source) && it.kind !== "video") {
        const all = el("button", "all", `↕ ${picsOf(it).length}`);
        all.title = "All its pictures again, one under another - the wheel runs through them";
        all.addEventListener("click", () => { S.picMode = "scroll"; paintLook(true); });
        tools.append(all);
      }
      tools.append(zOut, zPct, zIn, zFull);
      pic.appendChild(tools);
      lookZoom = zoomable(pic, im, picURL(it, 0, shown), (z, real) => { zPct.textContent = z === 1 ? "Fit" : `${Math.round(real * 100)}%`; },
                          () => ent.w || 0);
      zOut.addEventListener("click", () => lookZoom.zoomBy(0.8));
      zIn.addEventListener("click", () => lookZoom.zoomBy(1.25));
      zPct.addEventListener("click", () => lookZoom.reset());
      zFull.addEventListener("click", () => fullOf(it, shown));
      lookFull = () => fullOf(it, shown);
      /* a film plays here, in its own player, in place of its picture */
      const film = shown === it.file ? videoOf(it.source) : null;
      if (film) {
        const play = el("button", "vib-play");
        play.setAttribute("aria-label", "Play the film here");
        play.innerHTML = PLAY_SVG;
        play.addEventListener("click", () => {
          pic.textContent = "";
          const f = el("iframe", "vib-film");
          f.src = film;
          f.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
          f.allowFullscreen = true;
          f.referrerPolicy = "strict-origin-when-cross-origin";
          f.title = titleOf(it) || "Film";
          pic.appendChild(f);
        });
        pic.appendChild(play);
      }
    }
    const nav2 = el("div", "vib-nav2");
    const prev = el("button", "vib-btn big", "←  Previous");
    prev.disabled = L.at === 0;
    prev.style.opacity = L.at === 0 ? ".4" : "";
    prev.addEventListener("click", () => step(-1, false));
    const next = el("button", "vib-btn big", L.at === L.ids.length - 1 ? "Finish" : "Next  →");
    next.addEventListener("click", () => step(1, true));
    nav2.append(prev, el("span", null, L.sort
      ? "A folder by its number, then Enter for the next one"
      : picsOf(it).length > 1 && it.kind === "image"
        ? "A folder by its number · ← → to move · ↑ ↓ PgUp PgDn its pictures · Esc for the wall"
        : "A folder by its number · ← → to move · Esc for the wall"), next);
    /* the notes beside the picture, to be read with it - when there are any,
       and unless they were put away */
    const besideText = picNote(it, S.picFor === it.id ? S.picShown : it.file, typedMemo != null ? typedMemo : memoOf(it));
    besideNotes = null;
    /* put away at first - the picture is seen whole; the NOTES tab lays them
       over its left side, see-through, and they stay out while ideas are
       looked through, until put away again */
    if (it.kind !== "text" && S.beside && String(besideText || "").trim()) {
      const duo = el("div", "vib-duo");
      const bn = el("div", "vib-beside");
      const close = el("button", "vib-besidex", "×");
      close.title = "Put the notes away - the tab at the left brings them back";
      close.addEventListener("click", (e) => { e.stopPropagation(); S.beside = false; paintLook(true); });
      const body = el("div", "vib-besidebody");
      /* the notes as written; with TR on, each line followed by its
         translation, a step quieter */
      const put = (words, tr) => {
        body.textContent = "";
        const lines = words.split("\n");
        lines.forEach((line, i) => {
          const row = el("div", i === 0 ? "t" : (line.trim() ? "l" : "gap"));
          row.textContent = line;
          body.appendChild(row);
          if (tr && tr[i]) body.appendChild(el("div", i === 0 ? "t tr" : "l tr", tr[i]));
        });
      };
      let trSeq = 0;
      const fill = (t) => {
        const words = String(t || "").replace(/^\s+/, "").replace(/\s+$/, "");
        const mine = ++trSeq;
        put(words, null);
        if (!TRK.on) return;
        trb.classList.add("busy");
        trLines(words, (p) => { if (mine === trSeq) trb.textContent = `TR ${Math.round(p * 100)}%`; })
          .then((tr) => { if (mine === trSeq) put(words, tr); })
          .catch((err) => { if (mine === trSeq) flash(String(err.message || err), "err"); })
          .finally(() => { if (mine === trSeq) { trb.textContent = "TR"; trb.classList.remove("busy"); } });
      };
      const trb = el("button", "vib-trbtn" + (TRK.on ? " on" : ""), "TR");
      trb.title = TRK.on ? "Only the notes as written" : "Each line of the notes followed by its translation - only to read, the notes stay as written";
      trb.addEventListener("click", (e) => { e.stopPropagation(); setTrOn(!TRK.on); paintLook(true); });
      fill(besideText);
      bn.append(close, trb, body);
      bn.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });
      bn.addEventListener("pointerdown", (e) => e.stopPropagation());
      duo.append(pic, bn);
      stage.append(duo);
      besideNotes = fill;
    } else if (it.kind !== "text" && String(besideText || "").trim()) {
      /* put away: a narrow tab at the left brings the notes back */
      const duo = el("div", "vib-duo");
      const tab = el("button", "vib-besidetab", "NOTES");
      tab.title = "The notes beside the picture again";
      tab.addEventListener("click", (e) => { e.stopPropagation(); S.beside = true; paintLook(true); });
      tab.addEventListener("pointerdown", (e) => e.stopPropagation());
      duo.append(pic, tab);
      stage.append(duo);
    } else stage.append(pic);
    /* Pin, on the picture itself - with the zoom, where the eye already is.
       While another is pinned, its Unpin is on its own picture, not here. */
    if (!S.pin || S.pin === it.id) {
      const holder = pic;
      let tools = holder.querySelector(":scope > .vib-ztools");
      if (!tools) { tools = el("div", "vib-ztools"); holder.appendChild(tools); }
      const pb = el("button", "pin" + (S.pin === it.id ? " on" : ""), S.pin === it.id ? "◫ Pinned" : S.pin ? "◫ Unpin" : "◫ Pin");
      pb.title = S.pin === it.id ? "Pinned: step on, and each idea comes up beside this one - again to unpin  (C)"
        : S.pin ? "Let the pinned idea go  (C)" : "Pin to compare: keep this idea on the left while you step through others beside it  (C)";
      pb.addEventListener("click", (e) => { e.stopPropagation(); togglePin(); });
      pb.addEventListener("pointerdown", (e) => e.stopPropagation());
      tools.prepend(pb);
    }
    /* an idea pinned: it on the left, this one on the right */
    const pinned = S.pin && S.pin !== it.id ? byId(S.pin) : null;
    if (S.pin && !byId(S.pin)) S.pin = null;
    if (pinned) {
      const main = stage.lastChild;
      const cmp = el("div", "vib-cmp");
      const right = el("div", "vib-cmpR" + (it.work ? " work" : ""));
      const rh = el("div", "vib-cmphead");
      rh.append(el("b", null, it.work ? "MY WORK" : "REFERENCE"), el("span", null, titleOf(it) || ""));
      right.append(rh, main);
      cmp.append(pinPane(pinned), right);
      stage.appendChild(cmp);
    }
    /* the pictures it holds, under it - under its own side, when compared */
    if (it.kind === "image" || (it.kind === "video" && picsOf(it).length > 1)) (pinned ? stage.querySelector(".vib-cmpR") : stage).appendChild(picStrip(it));
    stage.appendChild(nav2);

    const side = el("aside", "vib-side");

    /* the notes: the words from the same page as the picture, or anything
       about it. The first line is the idea's title - it names a series
       started from it. Enter is a new line, Ctrl+Enter the next idea. */
    const memoBox = el("label", "vib-sec");
    const memoHead = el("span", "vib-h vib-memohead", "NOTES");
    const hBtns = el("span", "vib-hbtns");
    if (it.kind !== "text") {
      const bt = el("button", "vib-besidebtn" + (S.beside ? " on" : ""), "◧ Over the picture");
      bt.title = S.beside ? "Put the notes away from over the picture" : "Lay the notes over the picture, to read them with it";
      bt.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); S.beside = !S.beside; paintLook(true); });
      hBtns.appendChild(bt);
    }
    memoHead.appendChild(hBtns);
    memoBox.appendChild(memoHead);
    memoInput = el("textarea", "vib-memo");
    memoInput.value = typedMemo != null ? typedMemo : memoOf(it);
    memoInput.placeholder = "Write what caught your eye, or paste the words from the same page";
    memoInput.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); step(1, true); }
      if (e.key === "Escape") { e.preventDefault(); memoInput.blur(); root.focus({ preventScroll: true }); }
    });
    memoInput.addEventListener("input", () => {
      clearTimeout(noteTimer);
      noteTimer = setTimeout(flushNote, 900);
      clearTimeout(kwTimer);
      kwTimer = setTimeout(() => {
        if (!memoInput) return;
        if (lookKw) lookKw(memoInput.value);
        if (besideNotes) besideNotes(picNote(it, S.picShown, memoInput.value));
      }, 350);
    });
    memoInput.addEventListener("pointerdown", (e) => e.stopPropagation());
    memoBox.appendChild(memoInput);
    memoBox.appendChild(el("span", "vib-hint", "The first line is its title · Ctrl+Enter for the next one"));
    const kwBox = keywordBox(it);

    const starBox = el("div", "vib-sec");
    starBox.appendChild(el("span", "vib-h", "STARS"));
    const starRow = el("div", "vib-starpick");
    for (const n of [1, 2, 3]) {
      const b = el("button", (it.stars || 0) >= n ? "on" : "", "★");
      b.setAttribute("aria-label", `${n} star${n === 1 ? "" : "s"} - ${STAR_WORDS[n]}`);
      b.title = `${STAR_WORDS[n]} (S steps through)`;
      b.addEventListener("click", () => setStars((it.stars || 0) === n ? 0 : n));
      starRow.appendChild(b);
    }
    starRow.appendChild(el("span", "vib-starword", it.stars ? STAR_WORDS[it.stars] : "Like · Love · Next series"));
    starBox.appendChild(starRow);

    const fBox = el("div", "vib-sec");
    fBox.appendChild(el("span", "vib-h", "MOVE TO FOLDER"));
    /* The top folders side by side, as many to a line as fit; a top folder
       holding folders has a little opener of its own beside its chip, and the
       folders inside the one opened show on a dark ground under the row, as
       a cut is shown in the Series Layout. One open at a time - the one this
       idea already sits in, when it opens. A gold dot on an opener says the
       idea is in a folder inside it, closed or not. */
    const chips = el("div", "vib-fpick");
    const chipNos = folderNos();
    const mine = it.folders || [];
    const chip = (f, label, prefix) => {
      const c = el("button", "vib-fc" + (mine.includes(f) ? " on" : ""));
      c.appendChild(el("i", null, chipNos[f] || ""));
      if (prefix) c.appendChild(el("small", null, prefix + " ›"));
      c.append(label);
      c.title = f.split("/").join(" › ");
      c.addEventListener("click", () => toggleFolder(f));
      return c;
    };
    const tops = S.folders.filter(f => !parentOf(f));
    if (S.fOpenFor !== it.id) {
      S.fOpenFor = it.id;
      const inner = mine.find(f => parentOf(f));
      if (inner) S.fOpen = inner.split("/")[0];
    }
    if (S.fOpen && !tops.includes(S.fOpen)) S.fOpen = null;
    /* opening and closing repaints only this, so a film keeps playing */
    const paintPick = () => {
    chips.textContent = "";
    const row1 = el("div", "vib-ftops");
    for (const top of tops) {
      const inner = subtree(top).slice(1);
      const head = chip(top, nameOf(top), "");
      head.classList.add("top");
      if (!inner.length) { row1.appendChild(head); continue; }
      const has = inner.some(f => mine.includes(f));
      const pair = el("span", "vib-fpair" + (S.fOpen === top ? " open" : "") + (has ? " has" : ""));
      const op = el("button", "vib-fopen", S.fOpen === top ? "▾" : "▸");
      op.title = `${S.fOpen === top ? "Close" : "Open"} the folders inside ${nameOf(top)}` + (has ? "\nThis idea is in one of them" : "");
      op.addEventListener("click", () => {
        S.fOpen = S.fOpen === top ? null : top;
        paintPick();
      });
      pair.append(head, op);
      row1.appendChild(pair);
    }
    chips.appendChild(row1);
    if (S.fOpen) {
      const kids = el("div", "vib-fkids");
      /* deeper than one level, the folders between are named small */
      for (const f of subtree(S.fOpen).slice(1)) kids.appendChild(chip(f, nameOf(f), f.split("/").slice(1, -1).join(" › ")));
      row1.appendChild(kids);
      placeKids();
    }
    };
    /* the folders inside go right under the line their top folder is on:
       after the last chip of that line, once the lines are laid out */
    const placeKids = () => requestAnimationFrame(() => {
      const kids = chips.querySelector(".vib-fkids");
      const pair = chips.querySelector(".vib-fpair.open");
      if (!kids || !pair || !kids.isConnected) return;
      const row = kids.parentNode;
      row.appendChild(kids);
      const y = pair.offsetTop;
      let last = pair;
      for (const x of row.children) if (x !== kids && x.offsetTop === y) last = x;
      last.after(kids);
    });
    new ResizeObserver(() => placeKids()).observe(chips);
    paintPick();
    fBox.appendChild(chips);
    fBox.appendChild(el("span", "vib-hint", "One idea can sit in more than one folder."));

    const src = el("div", "vib-sec");
    src.appendChild(el("span", "vib-h", "SOURCE"));
    if (it.source && looksLikeURL(it.source)) {
      const a = el("a", "vib-src", `${host(it.source) || it.source}  ↗`);
      a.href = it.source;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.title = it.source;
      src.appendChild(a);
    } else if (it.source) src.appendChild(el("span", "vib-meta", it.source));
    src.appendChild(el("span", "vib-meta", `${VIA[it.via] ? VIA[it.via][0].toUpperCase() + VIA[it.via].slice(1) : "Kept"} · ${day(it.added)}`
      + (it.captured ? " · page captured" : "") + (it.used ? " · used in a series" : "")));
    const tools = el("div", "vib-tools");
    /* the page itself in place of the picture it offers for sharing */
    if (looksLikeURL(it.source) && !videoOf(it.source) && (it.kind === "image" || it.kind === "text")) {
      const cap = el("button", "vib-btn vib-cap", capturing === it.id ? "Capturing the page…" : "Capture the page");
      cap.title = "Open the page unseen in Edge or Chrome and keep a picture of it in place of this one - takes a few seconds";
      cap.disabled = capturing === it.id;
      cap.addEventListener("click", () => capturePage(it.id));
      tools.appendChild(cap);
    }
    /* the picture into the Series Book's Reader, to be read there */
    if (it.kind === "image" || (it.kind === "video" && S.picFor === it.id && S.picShown && S.picShown !== it.file)) {
      const rd = el("button", "vib-btn vib-cap", "Read in Book");
      rd.title = "Put this picture into the Reader of the prompt open in the Series Book - then choose the anchors and press Read";
      rd.addEventListener("click", () => toReader(it, S.picFor === it.id ? S.picShown : it.file));
      tools.appendChild(rd);
    }
    if (tools.childNodes.length) src.appendChild(tools);

    const acts = el("div", "vib-acts");
    const done = el("button", "vib-btn gold big wide vib-done", "Done");
    done.title = "Back to the wall (Esc) - what has a folder is sorted already";
    done.addEventListener("click", closeLook);
    const seed = el("button", "vib-btn big wide", "Start a series with this");
    seed.title = "A new series in the Series Book - this idea in its production notes, its picture as the series picture";
    seed.addEventListener("click", startSeries);
    const row = el("div", "row");
    if (L.sort) {
      const later = el("button", "vib-btn big", "Later");
      later.title = "Leave it with the new ones and go on";
      later.addEventListener("click", () => step(1, false));
      row.appendChild(later);
    }
    const cancel = el("button", "vib-btn big", "Cancel");
    cancel.title = "Put back whatever was changed on this idea since it was opened - folders, stars, notes, cover - and go back to the wall";
    cancel.addEventListener("click", cancelLook);
    row.appendChild(cancel);
    const del = el("button", "vib-btn big" + (armedDelete === it.id ? " warn" : ""),
      armedDelete === it.id ? "Delete - sure?" : "Delete");
    del.addEventListener("click", deleteNow);
    row.appendChild(del);
    acts.append(done, seed, row);

    const info = fileInfo(it, media);
    /* the sections scroll; Done and the rest stay in reach at the foot */
    const scroll = el("div", "vib-sidescroll");
    scroll.append(memoBox, kwBox, starBox, fBox, src, info);
    side.append(scroll, acts);
    body.append(stage, side);
    lookEl.append(lb, body);
    root.appendChild(lookEl);
    /* the old view took the focus with it: keys go to the box again */
    if (hadMemo) memoInput.focus();
    else root.focus({ preventScroll: true });
  }

  /* ---- more pictures in one idea
     The pictures beside it on the same page are kept with it, not as ideas
     of their own: a strip under the picture shows them all, its own first.
     A click shows one; ◉ makes it the idea's own picture, the one on the
     wall; × takes it out, pressed twice. + adds more - or drop or paste them
     while the idea is open. */
  let picArmed = null, picArmTimer = 0;
  let stripDrag = null;   // a picture being moved along the strip
  /* over the whole window, with the idea's other pictures a step away */
  function fullOf(idea, file) {
    const files = idea.kind === "video" ? picsOf(idea).slice(1) : picsOf(idea);
    const at = Math.max(0, files.indexOf(file || idea.file));
    return fullView(picURL(idea, 0, files[at]), titleOf(idea), null, files.map(f => picURL(idea, 0, f)), at);
  }

  function picStrip(it) {
    const box = el("div", "vib-pstrip");
    const files = picsOf(it);
    /* a kept film: the film first, its stills after it - the film keeps its
       place, and the stills are numbered from one */
    const film = it.kind === "video";
    const ent = (f) => (it.more || []).find(m => m.file === f);
    files.forEach((f, k) => {
      if (film && k === 0) {
        const t = el("div", "vib-pth film" + (f === S.picShown || !files.includes(S.picShown) ? " on" : ""));
        t.innerHTML = `<svg viewBox="0 0 10 10"><path d="M2 1l7 4-7 4z"/></svg>FILM`;
        t.title = "The film - back to its player";
        t.dataset.file = f;
        t.addEventListener("click", () => { if (S.picShown !== f) { S.picShown = f; paintLook(true); } });
        box.appendChild(t);
        return;
      }
      const t = el("div", "vib-pth" + (f === S.picShown ? " on" : ""));
      const im = el("img");
      im.alt = "";
      im.loading = "lazy";
      im.src = picURL(it, 160, f);
      im.draggable = true;
      im.dataset.iid = it.id;
      im.dataset.file = f;
      t.appendChild(im);
      t.appendChild(el("span", "no", String(film ? k : k + 1)));
      const e = ent(f);
      if (e && Number.isFinite(e.t)) t.appendChild(el("span", "tm", clockWord(Math.floor(e.t)) || "0:00"));
      t.title = (film ? `A still from the film${e && Number.isFinite(e.t) ? ` at ${clockWord(Math.floor(e.t)) || "0:00"}` : ""} - click to see it` : k === 0 ? "Its own picture - the one on the wall and wherever the idea goes" : "Click to see it")
        + (files.length > 1 ? "\nDrag along the strip to change its place" : "")
        + "\nDrag onto the Series Book's Reader to read it";
      t.dataset.file = f;
      /* dragged along the strip, a picture changes its place among the
         others - put first, it becomes the one on the wall */
      if (files.length > 1) {
        im.addEventListener("dragstart", () => { stripDrag = { id: it.id, file: f }; });
        im.addEventListener("dragend", () => { stripDrag = null; for (const x of box.querySelectorAll(".vib-pth")) x.classList.remove("before", "after"); });
        t.addEventListener("dragover", (e) => {
          if (!stripDrag || stripDrag.id !== it.id || stripDrag.file === f) return;
          e.preventDefault(); e.stopPropagation();
          if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
          const b = t.getBoundingClientRect();
          const after = e.clientX > b.left + b.width / 2;
          t.classList.toggle("after", after);
          t.classList.toggle("before", !after);
        });
        t.addEventListener("dragleave", () => t.classList.remove("before", "after"));
        t.addEventListener("drop", (e) => {
          if (!stripDrag || stripDrag.id !== it.id) return;
          e.preventDefault(); e.stopPropagation();
          const from = stripDrag.file;
          stripDrag = null; selfDrag = null;
          document.body.classList.remove("vib-dragging");
          t.classList.remove("before", "after");
          if (from === f) return;
          const b = t.getBoundingClientRect();
          const rest = files.filter(x => x !== from);
          let at = rest.indexOf(f) + (e.clientX > b.left + b.width / 2 ? 1 : 0);
          if (film) at = Math.max(1, at);          // the film stays first
          rest.splice(at, 0, from);
          setPics(it, rest, at === 0 ? "moved - on the wall now" : "moved");
        });
      }
      t.addEventListener("click", () => {
        if (lookScroll) { lookScroll(f); return; }
        if (S.picShown !== f) { S.picShown = f; paintLook(true); }
      });
      if (files.length > 1) {
        const tl = el("div", "tl" + (picArmed === f ? " armed" : ""));
        if (k > 0 && !film) {
          const first = el("button", null, "◉");
          first.title = "Make it the idea's own picture - the one on the wall";
          first.addEventListener("click", (e) => {
            e.stopPropagation();
            setPics(it, [f, ...files.filter(x => x !== f)], "on the wall now");
          });
          tl.appendChild(first);
        }
        const x = el("button", picArmed === f ? "armed" : "", picArmed === f ? "Delete?" : "×");
        x.title = "Take this picture out of the idea";
        x.addEventListener("click", (e) => {
          e.stopPropagation();
          clearTimeout(picArmTimer);
          if (picArmed !== f) {
            picArmed = f;
            picArmTimer = setTimeout(() => { picArmed = null; if (S.look) paintLook(true); }, 4000);
            paintLook(true);
            return;
          }
          picArmed = null;
          if (S.picShown === f) S.picShown = null;
          setPics(it, files.filter(y => y !== f), "taken out");
        });
        tl.appendChild(x);
        t.appendChild(tl);
      }
      box.appendChild(t);
    });
    if (film) return box;                 // a film's pictures are its stills
    const add = el("button", "vib-padd", files.length > 1 ? "+" : "+ More pictures");
    add.title = "More pictures from the same page, kept with this one\nChoose files - or drop or paste them while this idea is open";
    add.addEventListener("click", () => pickMore(it));
    box.appendChild(add);
    if (files.length === 1) box.appendChild(el("span", "vib-phint", "or drop · paste them here, while this idea is open"));
    return box;
  }

  /* the idea as the server has it now - into the copy held here and into
     the one in the list, which the box may have read again meanwhile */
  function takeItem(it, item) {
    if (!item) return;
    for (const x of new Set([it, byId(it.id)])) {
      if (!x) continue;
      delete x.more;
      Object.assign(x, item);
    }
  }

  async function setPics(it, list, msg) {
    if (!list.length) return;
    const r = await post(MORE_SET_URL, { id: it.id, file: list[0], more: list.slice(1) });
    if (!r.ok) { flash(r.error || "the pictures could not be changed", "err"); return; }
    takeItem(it, r.item);
    if (msg) flash(msg);
    if (S.look) paintLook(true);
    refreshAll(api_);
  }

  /* pictures - or addresses of pictures - into the idea open */
  async function addMore(it, blobs, urls) {
    let n = 0, err = "";
    flash("adding…");
    for (const b of blobs) {
      const q = new URLSearchParams({ id: it.id, name: b.name || "" });
      const r = await (await api.fetchApi(`${MORE_ADD_URL}?${q}`, { method: "POST", body: b })).json();
      if (r.ok) { takeItem(it, r.item); n += 1; } else err = r.error;
    }
    for (const u of urls) {
      const q = new URLSearchParams({ id: it.id, url: u });
      const r = await (await api.fetchApi(`${MORE_ADD_URL}?${q}`, { method: "POST" })).json();
      if (r.ok) { takeItem(it, r.item); n += 1; } else err = r.error;
    }
    if (n) flash(`${n === 1 ? "a picture" : `${n} pictures`} added - ${1 + (it.more || []).length} in this idea`);
    else flash(err || "nothing here is a picture", "err");
    if (S.look) paintLook(true);
    refreshAll(api_);
  }

  /* a still from the film open, put under it - the film is not opened
     again, so it stays where it was; only the strip is painted anew */
  async function addStill(it, blob, t) {
    if (!blob) throw new Error("no still could be taken");
    /* where in the film, when the player said - a film that did not say
       keeps its still without a time */
    const known = Number.isFinite(t);
    const at = known ? Math.max(0, t) : 0;
    const clock = clockWord(Math.floor(at)) || "0:00";
    const q = new URLSearchParams({ id: it.id, name: known ? `still ${clock.replace(/:/g, "-")}.jpg` : "still.jpg" });
    if (known) q.set("t", String(Math.round(at * 100) / 100));
    const r = await (await api.fetchApi(`${MORE_ADD_URL}?${q}`, { method: "POST", body: blob })).json();
    if (!r.ok) throw new Error(r.error || "the still could not be kept");
    takeItem(it, r.item);
    const n = (it.more || []).length;
    const old = lookEl && lookEl.querySelector(".vib-pstrip");
    if (old) old.replaceWith(picStrip(it));
    else if (lookEl) {
      const st = lookEl.querySelector(".vib-cmpR") || lookEl.querySelector(".vib-stage");
      const nav = st && st.querySelector(".vib-nav2");
      if (st) st.insertBefore(picStrip(it), nav && nav.parentNode === st ? nav : null);
    }
    flash(`${known ? `still at ${clock}` : "still"} kept under the film - ${it.kind === "video" ? `${n} ${n === 1 ? "still" : "stills"} under it now` : `${n + 1} pictures in this idea now`}`);
    paintWall();
    refreshAll(api_);
  }

  let morePick = null;
  function pickMore(it) {
    if (!morePick) {
      morePick = el("input");
      morePick.type = "file";
      morePick.accept = "image/*";
      morePick.multiple = true;
      morePick.style.display = "none";
      root.appendChild(morePick);
    }
    morePick.value = "";
    morePick.onchange = () => {
      const files = [...(morePick.files || [])].filter(f => /^image\//.test(f.type || ""));
      if (files.length) addMore(it, files, []);
    };
    morePick.click();
  }

  /* the idea open, if it is one that holds more pictures */
  function lookPicIdea() {
    const L = S.look;
    const it = L && byId(L.ids[L.at]);
    return it && it.kind === "image" ? it : null;
  }
  /* what was dropped or pasted, as pictures for the idea open - true when
     there were any */
  function addTransfer(dt) {
    const it = lookPicIdea();
    if (!it) return false;
    const files = [...(dt.files || [])].filter(f => /^image\//.test(f.type || ""));
    let urls = files.length ? [] : urlsOf(dt);
    if (!files.length && !urls.length) {
      const t = (dt.getData && dt.getData("text/plain") || "").trim();
      if (looksLikeURL(t) && /\.(jpe?g|png|webp|gif|avif|bmp)(\?|#|$)/i.test(t)) urls = [t];
    }
    if (!files.length && !urls.length) return false;
    addMore(it, files, urls.slice(0, 24));
    return true;
  }

  /* ---- keywords of an idea: those found in its words, then those given by
     hand; found ones put aside are left out */
  const KW_ORDER = ["Model", "Photo", "Styling", "Hair", "Make-up", "Casting", "Set", "Film", "For", "", "Site"];
  function keywordsOf(it, memoText) {
    const words = [memoText != null ? memoText : memoOf(it), it.kind === "text" ? it.text : ""].join("\n");
    const aside = new Set((it.untags || []).map(t => t.toLowerCase()));
    const found = foundKeywords(words, it.source)
      .filter(x => !aside.has(x.t.toLowerCase()))
      .sort((a, b) => KW_ORDER.indexOf(a.k) - KW_ORDER.indexOf(b.k));
    const seen = new Set(found.map(x => x.t.toLowerCase()));
    const own = (it.tags || []).filter(t => !seen.has(t.toLowerCase())).map(t => ({ t, k: "", own: true }));
    return found.concat(own);
  }
  /* a keyword clicked: every idea with it, over the whole box */
  function searchFor(t) {
    flushNote();
    closeLook();
    P.vib_folder = "all";
    q.value = "";
    S.kw = [t];
    wall.scrollTop = 0;
    paint();
  }
  function keywordBox(it) {
    const box = el("div", "vib-sec vib-kwsec");
    box.appendChild(el("span", "vib-h", "KEYWORDS"));
    const row = el("div", "vib-kws");
    const add = el("input", "vib-kwadd");
    add.placeholder = "+ keyword";
    add.setAttribute("aria-label", "Add a keyword");
    add.spellcheck = false;
    const paintKw = (memoText) => {
      row.textContent = "";
      const cur = byId(it.id) || it;
      for (const kw of keywordsOf(cur, memoText)) {
        const c = el("span", "vib-kw" + (kw.own ? " own" : ""));
        if (kw.k) c.appendChild(el("i", null, kw.k));
        const go = el("button", "t", kw.t);
        go.title = `Every idea with “${kw.t}”`;
        go.addEventListener("click", () => searchFor(kw.t));
        const x = el("button", "x", "×");
        x.title = kw.own ? "Take this keyword away" : "Put this keyword aside - it was found in the notes";
        x.addEventListener("click", () => {
          const now = byId(it.id) || it;
          if (kw.own) change(it.id, { tags: (now.tags || []).filter(t => t.toLowerCase() !== kw.t.toLowerCase()) });
          else change(it.id, { untags: [...(now.untags || []), kw.t] });
          paintKw(memoInput ? memoInput.value : null);
        });
        c.append(go, x);
        row.appendChild(c);
      }
      row.appendChild(add);
    };
    add.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") { add.value = ""; add.blur(); root.focus({ preventScroll: true }); return; }
      if (e.key !== "Enter") return;
      e.preventDefault();
      const words = add.value.split(/[,;]+/).map(w => w.replace(/\s+/g, " ").trim()).filter(Boolean);
      if (!words.length) return;
      const now = byId(it.id) || it;
      const tags = [...(now.tags || [])];
      let aside = [...(now.untags || [])];
      for (const w of words) {
        if (!tags.some(t => t.toLowerCase() === w.toLowerCase())) tags.push(w);
        aside = aside.filter(t => t.toLowerCase() !== w.toLowerCase());
      }
      change(it.id, { tags, untags: aside });
      add.value = "";
      paintKw(memoInput ? memoInput.value : null);
      add.focus();
    });
    add.addEventListener("pointerdown", (e) => e.stopPropagation());
    paintKw();
    box.appendChild(row);
    box.appendChild(el("span", "vib-hint", "Found in the notes · click one for every idea with it · Enter adds your own"));
    lookKw = paintKw;
    return box;
  }

  /* ---- keywords over the whole box
     Each idea's keywords, worked out once and again only when its words
     change. S.kw holds those chosen to look by - an idea is shown when it
     has them all. */
  const kwCache = new Map();
  const VIEWS = new Set(["all", "used", "starred", "keywords", "works", "sites"]);
  const viewOk = (f) => VIEWS.has(f) || (String(f || "").startsWith("w:") && S.items.some(it => it.work && `w:${it.wfolder || "Unsorted"}` === f));
  function kwOf(it) {
    const sig = [memoOf(it), it.kind === "text" ? it.text : "", it.source, (it.tags || []).join("\u0001"), (it.untags || []).join("\u0001")].join("\u0002");
    const hit = kwCache.get(it.id);
    if (hit && hit.sig === sig) return hit.kws;
    const kws = keywordsOf(it);
    kwCache.set(it.id, { sig, kws });
    return kws;
  }
  const hasKw = (it, t) => kwOf(it).some(k => k.t.toLowerCase() === t.toLowerCase());
  /* Keywords chosen of the same kind widen the wall - this photographer or
     that one; of different kinds they narrow it - this photographer, for
     that magazine. */
  function kwKinds() {
    const m = new Map();
    for (const e of kwIndex()) m.set(e.t.toLowerCase(), e.k);
    return m;
  }
  function kwTest() {
    const chosen = kwChosen();
    if (!chosen.length) return null;
    const kinds = kwKinds();
    const groups = new Map();
    for (const t of chosen) {
      const k = kinds.get(t.toLowerCase()) || "Name";
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(t);
    }
    const sets = [...groups.values()];
    return (it) => sets.every(ts => ts.some(t => hasKw(it, t)));
  }
  const kwChosen = () => (S.kw || []);
  /* every keyword in the box, with how many ideas have it and what it most
     often is - a photographer, a magazine, a name */
  function kwIndex() {
    const m = new Map();
    for (const it of S.items) {
      for (const k of kwOf(it)) {
        const key = k.t.toLowerCase();
        let e = m.get(key);
        if (!e) { e = { t: k.t, n: 0, kinds: {} }; m.set(key, e); }
        e.n += 1;
        const kind = k.own ? "Mine" : (k.k || "Name");
        e.kinds[kind] = (e.kinds[kind] || 0) + 1;
      }
    }
    for (const e of m.values()) e.k = Object.entries(e.kinds).sort((a, b) => b[1] - a[1])[0][0];
    return [...m.values()];
  }
  function toggleKw(t) {
    const cur = kwChosen();
    S.kw = cur.some(x => x.toLowerCase() === t.toLowerCase())
      ? cur.filter(x => x.toLowerCase() !== t.toLowerCase())
      : [...cur, t];
    wall.scrollTop = 0;
    paintWall();
  }
  /* the keywords chosen, as chips over the wall - × lets one go */
  function kwChips(bar) {
    const kinds = kwKinds();
    const order = KW_GROUPS.map(g => g[0]);
    const chosen = [...kwChosen()].sort((a, b) => order.indexOf(kinds.get(a.toLowerCase()) || "Name") - order.indexOf(kinds.get(b.toLowerCase()) || "Name"));
    let last = null;
    for (const t of chosen) {
      const k = kinds.get(t.toLowerCase()) || "Name";
      if (last !== null) bar.appendChild(el("i", "vib-kwjoin", k === last ? "or" : "+"));
      last = k;
      const c = el("span", "vib-kwon");
      c.appendChild(el("b", null, t));
      const x = el("button", null, "×");
      x.title = `Let “${t}” go`;
      x.addEventListener("click", (e) => { e.stopPropagation(); toggleKw(t); });
      c.appendChild(x);
      bar.appendChild(c);
    }
    if (chosen.length > 1) {
      const all = el("button", "vib-kwclear", "Clear");
      all.title = "Let every keyword go";
      all.addEventListener("click", (e) => { e.stopPropagation(); S.kw = []; paintWall(); });
      bar.appendChild(all);
    }
  }
  /* the Keywords view: every keyword, by what it is, the most used first */
  const KW_GROUPS = [["Model", "Models"], ["Photo", "Photographers"], ["Styling", "Styling"], ["Hair", "Hair"],
    ["Make-up", "Make-up"], ["Casting", "Casting"], ["Set", "Set design"], ["Film", "Directors"], ["For", "Magazines"],
    ["Name", "Names"], ["Mine", "My keywords"], ["Site", "Sites"]];
  /* Once a keyword is chosen the ideas come first: the keywords fold into a
     short scrolling band over them, or away to one line. Names - the most
     of them, and the least sure - show those in two ideas or more; the rest
     wait behind "more". */
  function kwPanel() {
    const box = el("div", "vib-kwindex");
    const idx = kwIndex();
    if (!idx.length) {
      box.appendChild(el("div", "vib-empty", "No keywords yet - they are found in the notes, or added under them."));
      return box;
    }
    const chosen = new Set(kwChosen().map(t => t.toLowerCase()));
    if (chosen.size) {
      box.classList.add("band");
      const head = el("div", "vib-kwhead");
      head.appendChild(el("span", "vib-h", `ALL KEYWORDS  ${idx.length}`));
      const fold = el("button", "vib-kwfold", S.kwFold ? "▾ Show" : "▴ Fold");
      fold.title = S.kwFold ? "Show every keyword again" : "Fold the keywords away - the ideas come up";
      fold.addEventListener("click", (e) => { e.stopPropagation(); S.kwFold = !S.kwFold; paintWall(); });
      head.appendChild(fold);
      box.appendChild(head);
      if (S.kwFold) { box.classList.add("folded"); return box; }
    }
    const inner = el("div", "vib-kwbody");
    box.appendChild(inner);
    if (chosen.size) {
      /* the band's height, dragged at its foot - kept with the node */
      const KWH = [70, 640];
      const paintH = () => box.style.setProperty("--kwh", `${Math.max(KWH[0], Math.min(KWH[1], Number(P.vib_kwh) || 190))}px`);
      paintH();
      const grip = el("div", "vib-kwgrip");
      grip.title = "Drag to give the keywords more room, or the ideas\nDouble click for the height it had";
      grip.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        e.preventDefault(); e.stopPropagation();
        const k = (root.offsetWidth ? root.getBoundingClientRect().width / root.offsetWidth : 1) || 1;
        const y0 = e.clientY, h0 = inner.offsetHeight;
        grip.classList.add("on");
        const mv = (ev) => { P.vib_kwh = Math.round(Math.max(KWH[0], Math.min(KWH[1], h0 + (ev.clientY - y0) / k))); paintH(); };
        const up = () => {
          grip.classList.remove("on");
          window.removeEventListener("pointermove", mv, true);
          window.removeEventListener("pointerup", up, true);
        };
        window.addEventListener("pointermove", mv, true);
        window.addEventListener("pointerup", up, true);
      });
      grip.addEventListener("dblclick", (e) => { e.stopPropagation(); delete P.vib_kwh; paintH(); });
      queueMicrotask(() => box.appendChild(grip));
    }
    for (const [k, label] of KW_GROUPS) {
      let list = idx.filter(e => e.k === k).sort((a, b) => b.n - a.n || a.t.localeCompare(b.t));
      if (!list.length) continue;
      const total = list.length;
      let hidden = 0;
      if (k === "Name" && !S.kwMore) {
        const keep = list.filter(e => e.n >= 2 || chosen.has(e.t.toLowerCase()));
        const shown = keep.length ? keep : list.slice(0, 12);
        hidden = total - shown.length;
        list = shown;
      }
      const g = el("div", "vib-kwgrp");
      g.appendChild(el("span", "vib-h", `${label.toUpperCase()}  ${total}`));
      const row = el("div", "vib-kws");
      for (const e of list) {
        const c = el("button", "vib-kwpick" + (chosen.has(e.t.toLowerCase()) ? " on" : ""));
        c.append(e.t);
        c.appendChild(el("em", null, String(e.n)));
        c.title = chosen.has(e.t.toLowerCase()) ? `Let “${e.t}” go` : `The ideas with “${e.t}” - choose more to narrow them down`;
        c.addEventListener("click", () => toggleKw(e.t));
        row.appendChild(c);
      }
      if (hidden || (k === "Name" && S.kwMore)) {
        const more = el("button", "vib-kwmore", S.kwMore ? "Fewer" : `+ ${hidden} more`);
        more.title = S.kwMore ? "Only the names in two ideas or more" : "The names found in one idea only, too";
        more.addEventListener("click", (ev) => { ev.stopPropagation(); S.kwMore = !S.kwMore; paintWall(); });
        row.appendChild(more);
      }
      g.appendChild(row);
      inner.appendChild(g);
    }
    return box;
  }

  /* ---- My works
     One's own renders - from the Series Layout, from the Image Viewer - kept
     apart from the references: a section of their own at the foot of the
     folders, in silver, growing upward as series are added, each series a
     row of its own over "All works". */
  const isWorkView = (f) => f === "works" || String(f || "").startsWith("w:");
  function workSeries() {
    /* the series in the order they first came - fixed, so rows don't jump */
    const first = new Map();
    for (const it of S.items) {
      if (!it.work) continue;
      const w = it.wfolder || "Unsorted";
      const t = it.added || 0;
      if (!first.has(w) || t < first.get(w)) first.set(w, t);
    }
    return [...first.entries()].sort((a, b) => a[1] - b[1]).map(e => e[0]);
  }
  function paintWorks() {
    worksList.textContent = "";
    const works = S.items.filter(it => it.work);
    const row = (key, label, n, cls) => {
      const b = el("button", "vib-f vib-wrow" + (cls ? " " + cls : "") + (P.vib_folder === key ? " on" : ""));
      b.appendChild(el("span", null, label));
      b.appendChild(el("em", null, String(n)));
      b.addEventListener("click", () => {
        P.vib_folder = key;
        wall.scrollTop = 0;
        paint();
      });
      return b;
    };
    worksList.appendChild(row("works", "All works", works.length, "allw"));
    for (const w of workSeries()) {
      const b = row(`w:${w}`, w, works.filter(it => (it.wfolder || "Unsorted") === w).length);
      b.title = `My works from ${w}`;
      worksList.appendChild(b);
    }
    worksHead.querySelector("em").textContent = String(works.length);
    worksBox.classList.toggle("on", isWorkView(P.vib_folder));
  }

  /* how a work was made: the folder it was rendered into - one scene,
     LoRA, sampler and enhancer, as the Series Lab files them, the band the
     Image Viewer shows - read from the "File:" line of its notes; without a
     folder there, its notes less that line */
  const howMade = (it) => {
    const lines = String(memoOf(it) || "").split("\n");
    const file = lines.find(l => /^File: /.test(l));
    const dir = file ? file.slice(6).replace(/\\/g, "/").replace(/\/[^/]*$/, "") : "";
    if (file && dir && dir !== file.slice(6)) return `dir:${dir}`;
    return lines.filter(l => !/^File: /.test(l)).join("\n").trim();
  };
  function alikeWorks(list) {
    const m = new Map();
    for (const it of list) {
      if (!it.work || it.kind !== "image" || !it.file) continue;
      const k = `${it.wfolder || ""}\u0001${howMade(it)}`;
      if (!howMade(it)) continue;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(it);
    }
    return [...m.values()].filter(g => g.length > 1)
      .map(g => g.sort((a, b) => (a.added || 0) - (b.added || 0)));
  }
  async function groupAlike(groups) {
    let n = 0;
    for (const g of groups) {
      const r = await post("/leiel_idea/merge", { ids: g.map(it => it.id) });
      if (r.ok) n += r.merged || 0;
    }
    flash(n ? `${n} put beside the ones made the same way` : "nothing put together", n ? "" : "err");
    await refresh(true);
    refreshAll(api_);
  }

  /* ---- comparing: an idea pinned beside the one looked at
     C, or ◫ Pin, keeps the idea open on the left; stepping on, every other
     idea comes up on the right beside it - a reference beside one's own
     renders, or the other way round. */
  /* The pinned idea, whole as the one beside it: its picture zooming as
     that one does, the pictures it holds in a strip under it, and its notes
     laid over it from the NOTES tab. */
  function pinPane(p) {
    const pane = el("div", "vib-cmpL" + (p.work ? " work" : ""));
    const head = el("div", "vib-cmphead");
    head.appendChild(el("b", null, p.work ? "MY WORK" : "REFERENCE"));
    head.appendChild(el("span", null, titleOf(p) || ""));
    const x = el("button", "vib-cmpx", "×");
    x.title = "Unpin - back to one at a time  (C)";
    x.addEventListener("click", (e) => { e.stopPropagation(); S.pin = null; paintLook(true); });
    head.appendChild(x);
    const files = picsOf(p);
    if (!files.includes(S.pinShown)) S.pinShown = p.file;
    const view = el("div", "vib-pic vib-cmppic");
    /* its own Unpin, on its own picture - so it is plain which is pinned */
    const unpin = () => {
      const b = el("button", "pin on", "◫ Unpin");
      b.title = "Let it go - back to one at a time  (C)";
      b.addEventListener("click", (e) => { e.stopPropagation(); S.pin = null; paintLook(true); });
      b.addEventListener("pointerdown", (e) => e.stopPropagation());
      return b;
    };
    let pinScroll = null, pinNotes = null;
    if (p.kind === "text") view.appendChild(el("div", "q", String(p.text || "")));
    else if (p.file && files.length > 1 && S.pinMode !== "one" && !videoOf(p.source)) {
      /* its pictures one under another, the wheel running down them */
      view.classList.add("scroll");
      const col = el("div", "vib-pscroll");
      const inner = el("div", "vib-pcol");
      for (const f of files) {
        const ent = picEntry(p, f);
        const im = el("img");
        im.alt = "";
        im.loading = "lazy";
        if (ent.w && ent.h) im.style.aspectRatio = `${ent.w} / ${ent.h}`;
        im.src = picURL(p, 1600, f);
        im.dataset.iid = p.id;
        im.dataset.file = f;
        im.addEventListener("click", () => { S.pinShown = f; S.pinMode = "one"; paintLook(true); });
        inner.appendChild(im);
      }
      col.appendChild(inner);
      view.appendChild(col);
      const tools = el("div", "vib-ztools");
      const cnt = el("span", "vib-pcount", "");
      const full = el("button", "full", "⤢");
      full.title = "The picture in view over the whole window";
      full.addEventListener("click", (e) => { e.stopPropagation(); fullOf(p, S.pinShown); });
      tools.append(unpin(), cnt, full);
      view.appendChild(tools);
      lookFullL = () => fullOf(p, S.pinShown);
      const inView = () => {
        const mid = col.scrollTop + col.clientHeight / 2;
        let at = 0;
        [...inner.children].forEach((x, k) => { if (x.offsetTop <= mid) at = k; });
        if (col.scrollTop + col.clientHeight >= col.scrollHeight - 2) at = files.length - 1;
        cnt.textContent = `${at + 1} / ${files.length}`;
        if (S.pinShown !== files[at]) {
          S.pinShown = files[at];
          for (const t of pane.querySelectorAll(".vib-pth")) t.classList.toggle("on", t.dataset.file === S.pinShown);
          if (pinNotes) pinNotes(picNote(p, S.pinShown));
        }
      };
      col.addEventListener("scroll", inView, { passive: true });
      col.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });
      const start = files.indexOf(S.pinShown);
      requestAnimationFrame(() => {
        if (start > 0 && inner.children[start]) col.scrollTop = inner.children[start].offsetTop;
        inView();
      });
      pinScroll = (f) => {
        const k = files.indexOf(f);
        if (k >= 0 && inner.children[k]) col.scrollTo({ top: inner.children[k].offsetTop, behavior: "smooth" });
      };
    }
    else if (p.file) {
      /* zoomed as the picture beside it is: click, wheel, drag */
      const shown = S.pinShown || p.file;
      const ent = picEntry(p, shown);
      const im = el("img");
      im.alt = titleOf(p);
      im.src = picURL(p, 1600, shown);
      im.dataset.iid = p.id;
      im.dataset.file = shown;
      view.appendChild(im);
      lookZoomL = zoomable(view, im, picURL(p, 0, shown), null, () => ent.w || 0);
      lookFullL = () => fullOf(p, shown);
      const tools = el("div", "vib-ztools");
      tools.appendChild(unpin());
      if (files.length > 1 && !videoOf(p.source)) {
        const all = el("button", "all", `↕ ${files.length}`);
        all.title = "All its pictures again, one under another";
        all.addEventListener("click", (e) => { e.stopPropagation(); S.pinMode = "scroll"; paintLook(true); });
        all.addEventListener("pointerdown", (e) => e.stopPropagation());
        tools.appendChild(all);
      }
      const full = el("button", "full", "⤢");
      full.title = "Over the whole window  (F)";
      full.addEventListener("click", (e) => { e.stopPropagation(); fullOf(p, shown); });
      full.addEventListener("pointerdown", (e) => e.stopPropagation());
      tools.appendChild(full);
      view.appendChild(tools);
    } else view.appendChild(el("div", "q", titleOf(p)));
    /* its notes, laid over it as on the right */
    const words = picNote(p, S.pinShown || p.file);
    let main = view;
    if (p.kind !== "text" && words.trim()) {
      const duo = el("div", "vib-duo");
      duo.appendChild(view);
      if (S.pinBeside) {
        const bn = el("div", "vib-beside");
        const close = el("button", "vib-besidex", "×");
        close.title = "Put the notes away";
        close.addEventListener("click", (e) => { e.stopPropagation(); S.pinBeside = false; paintLook(true); });
        const body = el("div", "vib-besidebody");
        pinNotes = (w) => {
          body.textContent = "";
          const t = String(w || "").replace(/^\s+/, "").replace(/\s+$/, "");
          const cut = t.indexOf("\n");
          body.append(el("b", null, cut > 0 ? t.slice(0, cut) : t));
          if (cut > 0) body.append(t.slice(cut + 1));
        };
        pinNotes(words);
        bn.append(close, body);
        bn.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });
        bn.addEventListener("pointerdown", (e) => e.stopPropagation());
        duo.appendChild(bn);
      } else {
        const tab = el("button", "vib-besidetab", "NOTES");
        tab.title = "Its notes over the picture";
        tab.addEventListener("click", (e) => { e.stopPropagation(); S.pinBeside = true; paintLook(true); });
        tab.addEventListener("pointerdown", (e) => e.stopPropagation());
        duo.appendChild(tab);
      }
      main = duo;
    }
    pane.append(head, main);
    pane.addEventListener("pointerenter", () => { S.overPin = true; });
    pane.addEventListener("pointerleave", () => { S.overPin = false; });
    /* the pictures it holds: a click shows one */
    if (files.length > 1) {
      const strip = el("div", "vib-pstrip");
      files.forEach((f, k) => {
        const t = el("div", "vib-pth" + (f === (S.pinShown || p.file) ? " on" : ""));
        t.dataset.file = f;
        const im = el("img");
        im.alt = "";
        im.loading = "lazy";
        im.src = picURL(p, 160, f);
        t.append(im, el("span", "no", String(k + 1)));
        t.addEventListener("click", () => {
          if (pinScroll) { pinScroll(f); return; }
          if (S.pinShown !== f) { S.pinShown = f; paintLook(true); }
        });
        strip.appendChild(t);
      });
      pane.appendChild(strip);
    }
    return pane;
  }
  function togglePin() {
    const L = S.look;
    const it = L && byId(L.ids[L.at]);
    if (!it) return;
    S.pin = S.pin === it.id ? null : (S.pin && S.pin !== it.id ? null : it.id);
    S.pinShown = S.pin ? (S.picFor === it.id ? S.picShown : it.file) : null;
    S.pinMode = "scroll";
    flash(S.pin ? "pinned - step on, and each idea comes up beside it" : "unpinned");
    paintLook(true);
  }

  // ---- keeping
  async function keepFile(file, source, via) {
    const media = /^(image|video|audio)\//.test(file && file.type || "") || (file && file.type === "application/pdf");
    if (!file || !media) {
      if (file && /^text\//.test(file.type || "")) return keepText(await file.text(), source, via);
      return { ok: false, error: "pictures, films, sounds, PDFs and text are kept" };
    }
    if (!/^image\//.test(file.type) && file.size > FILM_DROP_MAX) {
      return { ok: false, error: "a file this large goes in through the inbox folder - the path is at the bottom right" };
    }
    if (!/^image\//.test(file.type)) flash("keeping it…");
    return postBlob(file, file.name || "", source, via);
  }

  async function keepText(text, source, via) {
    text = String(text || "").trim();
    if (!text) return { ok: false, error: "nothing to keep" };
    return post(ADD_TEXT_URL, { text, source: source || "", via });
  }

  /* A web address: a picture of this server is read here, as it is already
     at hand; anything elsewhere is read by the server, which a page in the
     browser cannot do for another site. A picture is kept as it is. A story
     page - a magazine editorial - is kept whole as one idea: all its large
     pictures in order, its words and credits as the notes. Any other page as
     its card - the picture it offers for sharing, its title and its
     description - with the page as its source. Only an address that cannot
     be read at all is kept as a line. */
  async function keepURL(url, via, memo) {
    let same = false;
    try { same = new URL(url, location.href).origin === location.origin; } catch (e) { /* not an address */ }
    if (same) {
      try {
        const r = await fetch(url);
        const blob = await r.blob();
        if (/^image\//.test(blob.type)) return postBlob(blob, "", "", via, memo);
      } catch (e) { /* kept as a line below */ }
    } else {
      flash("reading the page - a story with many pictures takes a moment…");
      const r = await post(ADD_URL_URL, { url, source: url, via, memo: memo || "" });
      if (r.ok) return r;
    }
    return keepText(url, url, via);
  }

  async function kept(results, folder) {
    const good = results.filter(r => r && r.ok && r.item);
    const ok = good.length;
    const bad = results.find(r => r && !r.ok);
    /* a whole page kept as one idea: say how many of its pictures came */
    const many = ok === 1 && good[0].pictures > 1 ? ` - one idea, ${good[0].pictures} pictures` : "";
    /* dropped on a folder: kept and sorted in one go */
    if (folder && ok) {
      for (const r of good) await post(UPDATE_URL, { id: r.item.id, changes: { folders: [folder], new: false } });
      flash(`${ok === 1 ? "kept" : `${ok} kept`}${many} - into ${nameOf(folder)}`);
    } else if (ok) flash(`${ok === 1 ? "kept" : `${ok} kept`}${many} - with the new ones`);
    else if (bad) flash(bad.error || "nothing could be kept", "err");
    await refresh(true);
    refreshAll(api_);
  }

  function urlsOf(dt) {
    const list = (dt.getData("text/uri-list") || "").split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith("#"));
    if (list.length) return list;
    /* a picture dragged from a page often carries its <img> only */
    const html = dt.getData("text/html") || "";
    const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
    return m && looksLikeURL(m[1]) ? [m[1]] : [];
  }

  /* A picture dragged from a page brings a little of the page with it: the
     words written for it (its alt), and the link it sits in - often the
     article it leads to. The words go into the notes, the link is the source. */
  function pageWordsOf(dt) {
    const html = dt.getData("text/html") || "";
    if (!html) return { memo: "", link: "" };
    const doc = new DOMParser().parseFromString(html, "text/html");
    const img = doc.querySelector("img");
    let memo = (img && (img.getAttribute("alt") || img.getAttribute("title")) || "").replace(/\s+/g, " ").trim();
    /* a file name or a word like "image" says nothing */
    if (memo.length < 6 || !/\s/.test(memo) || /\.(jpe?g|png|webp|gif|avif)$/i.test(memo)) memo = "";
    const a = doc.querySelector("a[href]");
    const link = a && looksLikeURL(a.getAttribute("href")) ? a.getAttribute("href") : "";
    return { memo: memo.slice(0, 2000), link };
  }

  async function takeTransfer(dt, via, folder) {
    const files = [...(dt.files || [])].filter(f => /^(image|video|audio|text)\//.test(f.type || "") || f.type === "application/pdf");
    const urls = urlsOf(dt);
    const pw = pageWordsOf(dt);
    const out = [];
    if (files.length) {
      for (const f of files) {
        if (/^image\//.test(f.type || "")) out.push(await postBlob(f, f.name || "", pw.link || urls[0] || "", via, pw.memo));
        else out.push(await keepFile(f, urls[0] || "", via));
      }
    } else if (urls.length) {
      for (const u of urls.slice(0, 12)) {
        const r = await keepURL(u, via, urls.length === 1 ? pw.memo : "");
        /* the article it sat in is a better source than the picture's own address */
        if (r && r.ok && r.item && pw.link && urls.length === 1 && r.item.kind === "image" && !r.page) {
          await post(UPDATE_URL, { id: r.item.id, changes: { source: pw.link } });
        }
        out.push(r);
      }
    } else {
      const t = dt.getData("text/plain");
      if (t && t.trim()) out.push(looksLikeURL(t) ? await keepURL(t.trim(), via) : await keepText(t, "", via));
    }
    if (!out.length) { flash("nothing here a box can keep", "err"); return; }
    await kept(out, folder);
  }

  let overDepth = 0;
  /* A picture dragged out of the box - onto a Series Book anchor, to be
     read there - carries the address of the whole picture, not of the
     small copy on screen. Dropped on a folder, an idea goes into it;
     dropped anywhere else on the box it is not kept twice. */
  let selfDrag = null;          // the idea being dragged out of the wall
  root.addEventListener("dragstart", (e) => {
    const holder = e.target && e.target.closest && e.target.closest("[data-iid]");
    const it = holder && byId(holder.dataset.iid);
    if (!it || !e.dataTransfer) return;
    selfDrag = it.id;
    e.dataTransfer.effectAllowed = "copy";
    if (it.kind !== "image") { e.dataTransfer.setData("text/plain", it.text || ""); return; }
    document.body.classList.add("vib-dragging");
    if (!document.querySelector(".lvr-well")) {
      flash(bookNode() ? "drop it on a folder - or open the Reader in the Series Book and drop it there to read it"
                       : "drop it on a folder to put it there");
    }
    const full = new URL(picURL(it, 0, holder.dataset.file || it.file), location.href).href;
    e.dataTransfer.setData("text/uri-list", full);
    e.dataTransfer.setData("text/plain", full);
  });
  root.addEventListener("dragend", () => {
    selfDrag = null;
    document.body.classList.remove("vib-dragging");
    markFolder(null);
  });

  /* Where a drop lands: a folder row is that folder; the wall of an open
     folder is that folder too; anywhere else, the new ones. */
  function folderAt(target) {
    const row = target && target.closest && target.closest(".vib-f.own");
    if (row && row.dataset.f) return row.dataset.f;
    const onWall = target && target.closest && target.closest(".vib-wall, .vib-drop");
    if (onWall && S.folders.includes(P.vib_folder)) return P.vib_folder;
    return null;
  }
  /* the folder open on the wall, if it is one of the folders - what is
     pasted or written while it is open goes into it */
  function openFolder() {
    return S.folders.includes(P.vib_folder) ? P.vib_folder : null;
  }
  function markFolder(f) {
    for (const r of nav.querySelectorAll(".vib-f.own")) r.classList.toggle("drop-on", !!f && r.dataset.f === f);
  }
  function paintDropWords(f) {
    if (S.look && lookPicIdea()) {
      dropIn.querySelector("b").textContent = "Drop to add to this idea";
      dropIn.querySelector("span").textContent = "Kept with its picture - the pictures from the same page in one idea.";
      return;
    }
    dropIn.querySelector("b").textContent = f ? `Drop into ${nameOf(f)}` : "Drop to keep";
    dropIn.querySelector("span").textContent = f
      ? "Kept and sorted at once - the address comes along."
      : "The address comes along. It waits with the new ones - or drop it on a folder.";
  }

  root.addEventListener("dragenter", (e) => {
    e.preventDefault(); e.stopPropagation();
    /* a site being moved along the Sites page is not something to keep */
    if (selfDrag || dragAt >= 0) return;
    overDepth += 1;
    root.classList.add("over");
  });
  root.addEventListener("dragover", (e) => {
    e.preventDefault(); e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    if (dragAt >= 0) { if (e.dataTransfer) e.dataTransfer.dropEffect = "none"; return; }
    const f = folderAt(e.target);
    markFolder(f && (selfDrag || e.target.closest(".vib-f.own")) ? f : null);
    if (!selfDrag) paintDropWords(f);
  });
  root.addEventListener("dragleave", (e) => {
    e.stopPropagation();
    overDepth = Math.max(0, overDepth - 1);
    if (!overDepth) { root.classList.remove("over"); markFolder(null); }
  });
  root.addEventListener("drop", async (e) => {
    e.preventDefault(); e.stopPropagation();
    if (dragAt >= 0) { dragAt = -1; overDepth = 0; root.classList.remove("over"); paintSites(); return; }
    overDepth = 0;
    root.classList.remove("over");
    markFolder(null);
    const f = folderAt(e.target);
    if (selfDrag) {
      const it = byId(selfDrag);
      selfDrag = null;
      document.body.classList.remove("vib-dragging");
      const row = e.target.closest && e.target.closest(".vib-f.own");
      if (!it || !row || !f) return;
      if ((it.folders || []).includes(f)) { flash(`already in ${nameOf(f)}`); return; }
      const folders = [...(it.folders || []), f].sort((a, b) => S.folders.indexOf(a) - S.folders.indexOf(b));
      await change(it.id, { folders, new: false });
      flash(`into ${nameOf(f)}`);
      paint();
      refreshAll(api_);
      return;
    }
    /* with a picture idea open, what is dropped goes into it */
    if (e.dataTransfer && S.look && addTransfer(e.dataTransfer)) return;
    if (e.dataTransfer) takeTransfer(e.dataTransfer, "drop", f);
  });

  /* Ctrl+V on the node keeps what is on the clipboard - the graph never
     sees the paste, so no node is pasted by mistake. */
  root.addEventListener("paste", (e) => {
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) { e.stopPropagation(); return; }
    e.preventDefault(); e.stopPropagation();
    if (e.clipboardData && S.look && addTransfer(e.clipboardData)) return;
    if (e.clipboardData) takeTransfer(e.clipboardData, "paste", openFolder());
  });

  /* the jot box: a thought kept as it is typed or pasted, with the new ones */
  async function keepJot() {
    const t = jotText.value.trim();
    if (!t) { jotText.focus(); return; }
    const r = await keepText(t, "", "jot");
    if (r && r.ok) {
      jotText.value = "";
      jotText.classList.remove("full");
      jotText.blur();
    }
    await kept([r], openFolder());
  }
  jotBtn.addEventListener("click", keepJot);
  jotText.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); keepJot(); }
    if (e.key === "Escape") { e.preventDefault(); jotText.blur(); root.focus({ preventScroll: true }); }
  });
  /* it stays open while it holds words */
  jotText.addEventListener("input", () => jotText.classList.toggle("full", !!jotText.value.trim()));

  pasteBtn.addEventListener("click", async () => {
    if (!navigator.clipboard || !navigator.clipboard.read) {
      flash("this browser does not hand the clipboard over - press Ctrl+V on the node", "err");
      return;
    }
    try {
      const out = [];
      for (const item of await navigator.clipboard.read()) {
        const pic = item.types.find(t => t.startsWith("image/"));
        if (pic) { out.push(await postBlob(await item.getType(pic), "", "", "paste")); continue; }
        if (item.types.includes("text/plain")) {
          const t = await (await item.getType("text/plain")).text();
          out.push(looksLikeURL(t) ? await keepURL(t.trim(), "paste") : await keepText(t, "", "paste"));
        }
      }
      if (!out.length) { flash("the clipboard is empty", "err"); return; }
      await kept(out, openFolder());
    } catch (e) {
      flash("the clipboard was not handed over - press Ctrl+V on the node", "err");
    }
  });

  // ---- the manual, on the node
  let helpEl = null;
  function closeHelp() { if (helpEl) { helpEl.remove(); helpEl = null; } }
  helpBtn.addEventListener("click", () => {
    if (helpEl) { closeHelp(); return; }
    helpEl = el("div", "vib-helpbox");
    const hb = el("div", "hb-bar");
    hb.appendChild(el("b", null, "HOW THE BOX WORKS"));
    const x = el("button", "vib-btn", "Close");
    x.addEventListener("click", closeHelp);
    hb.appendChild(x);
    const body = el("div", "hb-body");
    body.innerHTML = HELP_HTML;
    helpEl.append(hb, body);
    root.appendChild(helpEl);
  });

  // ---- keys
  root.addEventListener("keydown", (e) => {
    const t = e.target;
    const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
    /* the graph never hears a key meant for the box */
    e.stopPropagation();
    if (typing) return;
    if (helpEl && e.key === "Escape") { e.preventDefault(); closeHelp(); return; }
    if (briefEl && e.key === "Escape") { e.preventDefault(); closeBrief(); return; }
    if (briefEl) return;
    if (!S.look) return;
    if (e.key === "Escape") { e.preventDefault(); closeLook(); return; }
    /* the zoom keys act on the picture the pointer is over - the pinned one
       on the left, or the one looked at */
    const Z = S.overPin && document.querySelector(".vib-cmpL") ? lookZoomL : lookZoom;
    const FULL = S.overPin && document.querySelector(".vib-cmpL") ? lookFullL : lookFull;
    if (Z && (e.key === "+" || e.key === "=")) { e.preventDefault(); Z.zoomBy(1.25); return; }
    if (Z && e.key === "-") { e.preventDefault(); Z.zoomBy(0.8); return; }
    if (Z && (e.key === "0" || e.key === "/")) { e.preventDefault(); Z.reset(); return; }
    if (Z && e.key === "*") { e.preventDefault(); Z.actual(); return; }
    if (FULL && (e.key === "f" || e.key === "F")) { e.preventDefault(); FULL(); return; }
    if ((e.key === "c" || e.key === "C") && !e.ctrlKey && !e.metaKey) { e.preventDefault(); togglePin(); return; }
    if ((e.key === "s" || e.key === "S") && !e.ctrlKey && !e.metaKey) {
      const it = byId(S.look.ids[S.look.at]);
      if (it) { e.preventDefault(); setStars(((it.stars || 0) + 1) % 4); }
      return;
    }
    /* zoomed in, the arrows move round the picture; at fit they step */
    if (Z && Z.z > 1 && ARROWS[e.key]) {
      e.preventDefault();
      const [dx, dy] = ARROWS[e.key], k = e.shiftKey ? 3 : 1;
      Z.pan(-dx * PAN_STEP * k, -dy * PAN_STEP * k);
      return;
    }
    /* Delete: the picture shown, of an idea of several - or the idea itself.
       Pressed once it asks, as the buttons do; again, it is done */
    if (e.key === "Delete" && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      const it = byId(S.look.ids[S.look.at]);
      if (!it) return;
      const files = picsOf(it);
      const shown = S.picFor === it.id && files.includes(S.picShown) ? S.picShown : it.file;
      const many = (it.kind === "image" && files.length > 1) || (it.kind === "video" && shown !== it.file);
      if (!many) {
        const again = armedDelete === it.id;
        deleteNow();
        if (!again) flash("Delete again to delete this idea - the picture goes to the trash folder");
        return;
      }
      clearTimeout(picArmTimer);
      if (picArmed !== shown) {
        picArmed = shown;
        picArmTimer = setTimeout(() => { picArmed = null; if (S.look) paintLook(true); }, 4000);
        paintLook(true);
        flash(`Delete again to take picture ${files.indexOf(shown) + (it.kind === "video" ? 0 : 1)} out of this idea`);
        return;
      }
      picArmed = null;
      const rest = files.filter(y => y !== shown);
      const k = files.indexOf(shown);
      S.picShown = rest[Math.min(k, rest.length - 1)] || null;
      if (it.kind === "video" && S.picShown === it.file && rest.length > 1) S.picShown = rest[1];
      setPics(it, rest, "taken out");
      return;
    }
    /* an idea of several pictures: ↓ ↑ the next and the one before,
       Page Down / End the last, Page Up / Home the first */
    if (PIC_KEYS[e.key]) {
      const it = byId(S.look.ids[S.look.at]);
      const files = it && it.kind === "image" ? picsOf(it) : [];
      if (files.length > 1) {
        e.preventDefault();
        /* pressed again while it still runs there: on from where it is going */
        const from = picAim && Date.now() - picAim.t < 700 && picAim.id === it.id ? picAim.k
          : Math.max(0, files.indexOf(S.picFor === it.id ? S.picShown : it.file));
        const k = PIC_KEYS[e.key] === "first" ? 0 : PIC_KEYS[e.key] === "last" ? files.length - 1
          : Math.max(0, Math.min(files.length - 1, from + PIC_KEYS[e.key]));
        picAim = { id: it.id, k, t: Date.now() };
        if (lookScroll) lookScroll(files[k]);
        else if (S.picShown !== files[k]) { S.picFor = it.id; S.picShown = files[k]; paintLook(true); }
        return;
      }
    }
    if (e.key === "ArrowRight") { e.preventDefault(); step(1, false); return; }
    if (e.key === "ArrowLeft") { e.preventDefault(); step(-1, false); return; }
    if (e.key === "Enter") { e.preventDefault(); step(1, true); return; }
    if (/^[1-9]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const f = topFolders()[Number(e.key) - 1];
      if (f) { e.preventDefault(); toggleFolder(f); }
    }
  });
  root.addEventListener("pointerdown", (e) => {
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "A")) return;
    root.focus({ preventScroll: true });
  });
  /* the wall scrolls; the canvas does not zoom under it */
  root.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });

  q.addEventListener("input", () => paintWall());
  q.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") { q.value = ""; paintWall(); }
  });

  shuffleBtn.addEventListener("click", () => {
    if (S.order) { S.order = null; shuffleBtn.classList.remove("on"); }
    else {
      const ids = S.items.map(x => x.id);
      for (let i = ids.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [ids[i], ids[j]] = [ids[j], ids[i]];
      }
      S.order = ids;
      shuffleBtn.classList.add("on");
      wall.scrollTop = 0;
    }
    paintWall();
  });

  sortBtn.addEventListener("click", () => {
    const list = newestFirst(fresh_());
    openLook(list.map(x => x.id), 0, true);
  });

  inboxBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(S.inbox);
      flash("inbox path copied - point a screenshot tool at it");
    } catch (e) { flash(S.inbox); }
  });

  // ---- the box from the server
  let busy = false;
  async function refresh(force) {
    if (S.dead || busy) return;
    busy = true;
    try {
      const r = await (await api.fetchApi(LIST_URL)).json();
      if (!r.ok) return;
      const sig = JSON.stringify([r.folders, r.items]);
      S.inbox = r.inbox || "";
      if (r.took) flash(`${r.took} came in from the inbox`);
      if (!force && sig === S.sig) return;
      S.sig = sig;
      S.folders = r.folders || [];
      S.items = r.items || [];
      if (!viewOk(P.vib_folder) && !S.folders.includes(P.vib_folder)) P.vib_folder = "all";
      /* a look in progress keeps its own list; only the wall moves under it */
      if (S.look) { paintFresh(); if (!S.editing) paintNav(); paintCount(); }
      else paint();
    } catch (e) {
      flash("the box could not be read - is the server up?", "err");
    } finally {
      busy = false;
    }
  }

  const poll = setInterval(() => {
    if (!root.isConnected || document.hidden) return;
    refresh(false);
  }, POLL_MS);

  const api_ = { refresh: () => refresh(false), tone: paintTone, destroy() { S.dead = true; clearInterval(poll); boxes.delete(api_); } };
  boxes.add(api_);
  node._vib = api_;

  const widget = node.addDOMWidget("idea_box", "LEIEL_IDEA_BOX", root, {
    serialize: false,
    hideOnZoom: false,
    getMinHeight: () => 420,
  });
  if (!node.size || node.size[0] < 760) node.setSize([900, 660]);
  setTimeout(() => refresh(true), 0);
  return widget;
}

app.registerExtension({
  name: "StudioLeiel.VisualIdeaBox",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== BOX) return;

    const onCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = onCreated ? onCreated.apply(this, arguments) : undefined;
      buildBox(this);
      return r;
    };

    /* properties arrive after the node is built when a workflow loads */
    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const r = onConfigure ? onConfigure.apply(this, arguments) : undefined;
      if (this._vib) setTimeout(() => this._vib.tone(), 0);
      return r;
    };

    const onRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      if (this._vib) this._vib.destroy();
      return onRemoved ? onRemoved.apply(this, arguments) : undefined;
    };
  },
});
