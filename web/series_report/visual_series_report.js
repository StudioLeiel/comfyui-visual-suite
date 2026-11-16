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

/* Visual Series Report.

   What a series has made so far, and how it looks. The server reads the
   recipe written in each PNG and measures the picture once - brightness,
   contrast, saturation, warmth, its five main colours - and this file draws
   it and asks again when something may have changed.

   A series named like S1E4 ... is an episode of a season. The season is the
   widest view, an episode the next, one cut of it the narrowest; the path at
   the top says where the page is, and every part of it goes back up. A series
   without that name is a series with its cuts.

   The tabs look at the same renders from different sides:
     LOOK      where they sit in tone, and how colour and light move cut by cut
     RECIPES   how far each LoRA, sampler or option moves a picture
     VERDICTS  what was picked and deleted in the Visual Image Viewer
   A pick or a deletion is otherwise only a ring around a dot.

   A cut, a bar or a value is a filter: click one and everything else is
   counted among those renders only, click it again to let go.

   LIVE keeps the report on what is being worked on: each render is read as
   it is saved, a series opened in a Series Book is shown, and a folder
   opened in a Visual Image Viewer brings up the series its pictures belong
   to - narrowed to the cut when the folder is one cut's.

   The view, the tab, the filters, the sort and LIVE are kept in the node's
   properties, so they travel with the workflow. */

import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

const REPORT = "LeielSeriesReport";

const SUMMARY_URL = "/leiel_report/summary";
const INGEST_URL = "/leiel_report/ingest";
const SCAN_URL = "/leiel_report/scan";
const STATUS_URL = "/leiel_report/status";
const ALIAS_URL = "/leiel_report/alias";
const EXPORT_URL = "/leiel_report/export";
const FOLLOW_URL = "/leiel_report/follow";
const THUMB_URL = "/leiel_report/thumb";
const HIDE_URL = "/leiel_report/hide";

const VIEWER = "LeielImageViewer";
const WATCH_MS = 1000;          // how often the viewers' folders are looked at

const ALL = "*";
const NONE = "\u0000";           // the renders that belong to no series
const SEASON = "season:";
const POLL_MS = 5000;           // picks and bins change without telling anyone
const SCAN_POLL_MS = 1000;
const MEASURE_POLL_MS = 1500;   // while pictures are still being measured

const TABS = [
  ["verdicts", "Verdicts", "What was picked and deleted in the Image Viewer"],
  ["prompts", "Prompts", "How each cut's prompt was written again, and what brought its first pick"],
  ["wall", "Wall", "The renders laid out by two settings - LoRA down, sampler across - side by side"],
  ["look", "Look", "Tone and colour: where the renders sit, and how each cut looks"],
  ["framing", "Framing", "Where the detail sits in the frame"],
  ["recipes", "Recipes", "How far each LoRA, sampler and option moves a picture"],
  ["time", "Time", "How long the renders took - by cut, one after another, and under each setting"],
  ["history", "History", "Every series in the order it was begun - what it cost and what it gave"],
  ["trends", "Trends", "How each LoRA and sampler has fared series after series, and how hard each kind of shot is"],
];
const LATER = new Set();
/* tabs about every series together, not the one on show; read only when opened */
const ACROSS = new Set(["history", "trends"]);

/* what each tab is for, written under the tabs */
const LEDES = {
  verdicts: "What became of the renders in the Image Viewer - picked, left as they are, or deleted - "
    + "counted under every LoRA and setting that made them.",
  prompts: "Each cut's prompt as it was written again - v1, v2, v3 - how many rewrites and renders it took "
    + "to the first pick, which anchor was rewritten when it came, and the versions left behind that did better.",
  wall: "The renders themselves, laid out by two settings, so the same cut made different ways "
    + "is seen side by side.",
  look: "Where the renders sit in tone, and how colour and light move from cut to cut through the story. "
    + "With a cut chosen, the map shows that cut and the palette shows it among the others.",
  framing: "Where the detail of the pictures sits in the frame - what draws the eye, render by render "
    + "and cut by cut. With a cut chosen, the map shows that cut and the strip shows it among the others.",
  time: "How long the renders took: where the hours went cut by cut, how each render ran one after "
    + "another, and how fast each setting renders. A time written in the picture is exact; one read from "
    + "when the files were saved is an estimate, shown lighter and marked ~.",
  trends: "Across the series of a period: how often each LoRA and sampler was picked, series by series, and "
    + "whether it is doing better or worse lately - and how long each kind of shot, by size, angle and frame, "
    + "took to its first pick.",
  history: "Every series, the latest first: how many renders it took, how many were picked, the "
    + "renders for each pick and the hours, where a cut's first pick usually came, and which anchor was "
    + "written again. Per pick: the three lowest in blue, the three highest in gold. The same list whatever is "
    + "on show above; click a series to open it.",
  recipes: "How far each value moves a picture, against the renders made beside it in the same cut "
    + "without it - points on a 0\u2013100 scale. Comparing inside a cut keeps a night scene from passing "
    + "for a dark LoRA.",
};

const METRICS = [
  ["b", "Brightness", "brighter", "darker"],
  ["c", "Contrast", "more contrast", "flatter"],
  ["s", "Saturation", "more saturated", "less saturated"],
  ["w", "Warmth", "warmer", "cooler"],
];

/* the same reading of S1E4 the server makes */
const EPISODE = /(?<![A-Za-z0-9])S(\d{1,3})\s?E(\d{1,3})(?!\d)/i;
function seasonOf(name) {
  const m = EPISODE.exec(name || "");
  return m ? Number(m[1]) : null;
}

// --------------------------------------------------------------- helpers
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

async function postJSON(path, body) {
  const res = await api.fetchApi(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  return res.json();
}

async function getJSON(path) {
  const res = await api.fetchApi(path);
  return res.json();
}

function pct(part, whole) {
  return whole ? Math.round((100 * part) / whole) : 0;
}

/* 45s, 12m, 6h 40m */
function duration(secs) {
  const v = Math.round(Number(secs) || 0);
  if (v < 90) return `${v}s`;
  if (v < 90 * 60) return `${Math.round(v / 60)}m`;
  const h = Math.floor(v / 3600);
  const m = Math.round((v - h * 3600) / 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}

/* an axis mark: 30s, 1m30, 2m */
function tick(secs) {
  const v = Math.round(secs);
  if (v < 60) return `${v}s`;
  const m = Math.floor(v / 60);
  const r = v - m * 60;
  return r ? `${m}m${String(r).padStart(2, "0")}` : `${m}m`;
}

function signed(v) {
  if (v === null || v === undefined) return "";
  if (Math.abs(v) < 0.05) return "0";
  return (v > 0 ? "+" : "−") + Math.abs(v).toFixed(1);
}

function lightness(hex) {
  const n = parseInt(String(hex).slice(1), 16);
  if (Number.isNaN(n)) return 0;
  return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
}

/* Where a finished save put its picture - the same reading the Visual Image
   Viewer makes of it. */
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

/* the first line of a hover text as its heading, the rest under it */
function fillTip(tip, text) {
  const [head, ...rest] = String(text || "").split("\n");
  tip.textContent = "";
  tip.append(el("b", "", head), document.createTextNode(rest.join("\n")));
}

/* Hover cards in the Series Book's style, for everything with a title in
   the report: the text's first short line is the heading, a part that names
   an action - Click, Right click, Shift+click - gets a row of its own. */
const TIP_ACT = "Ctrl\\+Shift\\+click|Shift\\+click|Ctrl\\+click|Alt\\+click|Double click|Right click|Click";
const TIP_SPLIT = new RegExp(`(?:\\n|\\s-\\s|(?<=\\.)\\s+|;\\s*|,\\s+(?=(?:${TIP_ACT})\\b))(?=(?:${TIP_ACT})\\b)`, "i");
const TIP_HEAD = new RegExp(`^(${TIP_ACT})\\b[:\\s-]*`, "i");

function tipParse(text) {
  const segs = String(text || "").split(TIP_SPLIT).map((x) => x.trim()).filter(Boolean);
  const rows = [];
  const desc = [];
  for (const seg of segs) {
    const m = TIP_HEAD.exec(seg);
    if (m) {
      let rest = seg.slice(m[0].length).replace(/^to\s+/i, "").replace(/[\s.]+$/, "");
      rest = rest ? rest[0].toUpperCase() + rest.slice(1) : "";
      rows.push([m[1].replace(/\b\w/g, (c) => c.toUpperCase()).replace(/Click\b/g, (x, i) => (i ? "click" : x)), rest]);
    } else desc.push(seg);
  }
  const lines = desc.join("\n").split("\n").map((x) => x.trim()).filter(Boolean);
  let head = "";
  if (lines.length && (lines.length > 1 || rows.length) && lines[0].length <= 70) head = lines.shift();
  return { head, body: lines.join("\n"), rows };
}

function hoverCards(root) {
  let on = null;
  let card = null;
  let timer = 0;
  const hide = () => {
    clearTimeout(timer);
    on = null;
    if (card) { card.remove(); card = null; }
  };
  const show = (target) => {
    const t = tipParse(target.dataset.tip);
    if (!t.head && !t.body && !t.rows.length) return;
    card = el("div", "vsr-card");
    if (t.head) {
      const ch = el("div", "ch");
      ch.append(el("b", "", t.head));
      card.append(ch);
    }
    if (t.body) {
      /* the figures stand out from the words around them */
      const en = el("div", "en");
      for (const part of t.body.split(/(\d+(?:\.\d+)?%?)/)) {
        if (/^\d/.test(part)) en.append(el("b", "num", part));
        else if (part) en.append(document.createTextNode(part));
      }
      card.append(en);
    }
    if (t.rows.length) {
      const hint = el("div", "hint");
      for (const [k, v] of t.rows) {
        const row = el("div", "hr");
        row.append(el("b", "", k), el("span", "", v));
        hint.append(row);
      }
      card.append(hint);
    }
    document.body.append(card);
    const r = target.getBoundingClientRect();
    const b = card.getBoundingClientRect();
    let top = r.bottom + 6;
    if (top + b.height > window.innerHeight - 8) top = Math.max(8, r.top - b.height - 6);
    card.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - b.width - 8))}px`;
    card.style.top = `${top}px`;
  };
  root.addEventListener("pointerover", (e) => {
    const t = e.target instanceof Element ? e.target : null;
    let target = t ? t.closest("[title], [data-tip]") : null;
    if (target && !root.contains(target)) target = null;
    /* a list keeps its own: its options cannot carry a card */
    if (target && target.tagName === "SELECT") target = null;
    if (target && target.hasAttribute("title")) {
      const v = target.getAttribute("title");
      target.removeAttribute("title");
      if (v) target.dataset.tip = v;
    }
    if (target === on) return;
    hide();
    if (!target || !target.dataset.tip) return;
    on = target;
    timer = setTimeout(() => { if (on === target && target.isConnected) show(target); }, 400);
  });
  root.addEventListener("pointerleave", hide);
  root.addEventListener("pointerdown", hide, true);
  root.addEventListener("wheel", hide, { passive: true });
  return hide;
}

// ------------------------------------------------------------------- css
/* the Series Book's colours, so the two can be set alike */
const HUES = [
  ["teal", "#2f6f73"], ["slate", "#46596f"], ["moss", "#52633a"],
  ["umber", "#6e4f2e"], ["wine", "#6c2f40"], ["indigo", "#43437e"],
  ["graphite", "#4e4e52"],
];
const HUE_DEFAULT = 6;
const LIGHT_DEFAULT = 0.22;

/* A series' own colour in the Series Book - the same list, so a series is
   framed here in the colour it wears there. The second one (gold) is no
   longer offered there; a series that wore it wears the first. */
const SERIES_TONES = ["#22c3d6", "#c9a33f", "#f05aa8", "#2fcf7f", "#3a7bff",
                      "#9a7cff", "#ff8a3d", "#ff5555", "#a8b0bc",
                      "#b6e33a", "#e04cf0", "#58c8ff"];
function seriesTone(h) {
  return Number.isInteger(h) && SERIES_TONES[h] && h !== 1 ? SERIES_TONES[h] : SERIES_TONES[0];
}
const BOOK = "LeielSeriesBook";

/* the three that took longest in a time graph: first the brightest */
const RANK_GOLD = ["#ffd36b", "#d9a640", "#9c7a35"];

/* and the three that went fastest: first the brightest */
const RANK_BLUE = ["#8cc8ff", "#4f93d6", "#36628f"];

/* {slow: Map(key -> 0|1|2), fast: Map(key -> 0|1|2)} - the slowest and the
   fastest, at most three each and never more than half of them, so with
   only a few values the two never take the same one */
function ranked(items, value, key) {
  const list = items.map((it, i) => [value(it) || 0, i, it]).filter(([v]) => v > 0);
  const each = Math.min(3, Math.floor(list.length / 2));
  const slow = new Map();
  const fast = new Map();
  list.slice().sort((a, b) => b[0] - a[0] || a[1] - b[1]).slice(0, each)
    .forEach(([, , it], rank) => slow.set(key(it), rank));
  list.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]).slice(0, each)
    .forEach(([, , it], rank) => fast.set(key(it), rank));
  return { slow, fast };
}

/* the colour of a ranked item, or null */
function rankTone(r, k) {
  if (r.slow.has(k)) return RANK_GOLD[r.slow.get(k)];
  if (r.fast.has(k)) return RANK_BLUE[r.fast.get(k)];
  return null;
}

const PICK = "#d9b26a";
const DEL = "#c8645a";

const CSS = `
.vsr{--bk:#4e4e52;--bl:.22;
  --vsr-bg:color-mix(in srgb, var(--bk) calc(var(--bl) * 40%), #0b0c0e);
  --vsr-bar:color-mix(in srgb, var(--bk) calc(var(--bl) * 45% + 4%), #121315);
  display:flex;flex-direction:column;width:100%;height:100%;box-sizing:border-box;position:relative;
  background:var(--vsr-bg);border:1px solid color-mix(in srgb, var(--bk) 40%, #1f2125);border-radius:8px;overflow:hidden;
  font:12px/1.3 system-ui,-apple-system,"Segoe UI",sans-serif;color:#cfd2d8;outline:none}
.vsr *{box-sizing:border-box}
.vsr-bar{display:flex;align-items:center;gap:6px;padding:7px 8px 6px;background:var(--vsr-bar);flex:0 0 auto}
.vsr-bar2{display:flex;align-items:center;gap:6px;padding:0 8px 6px;background:var(--vsr-bar);
  flex:0 0 auto;min-width:0;height:28px}
.vsr-series{flex:1 1 auto;min-width:80px;height:22px;border-radius:999px;border:1px solid #33363d;
  background:#0f1012;color:#d6d9de;padding:0 8px;font:11px system-ui,sans-serif;outline:none}
.vsr-series:focus{border-color:#d9b26a}
.vsr-btn{height:22px;padding:0 10px;border-radius:999px;cursor:pointer;
  background:#14161a;border:1px solid #3a3e46;color:#aeb3bc;font-family:inherit;
  font-size:9.5px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;line-height:1;
  display:inline-flex;align-items:center;justify-content:center;gap:5px;flex:0 0 auto;white-space:nowrap}
.vsr-btn:hover{border-color:#d9b26a;color:#f0d9a8;background:#1c1912}
.vsr-btn.sq{padding:0;width:24px;font-size:12px;letter-spacing:0}
.vsr-btn.on{border-color:#d9b26a;color:#f3dcaa;background:#2a2416}
.vsr-btn.live.on{border-color:#5fc08a;color:#c9f2d9;background:#15281e}
.vsr-btn.live.on::before{content:"";width:6px;height:6px;border-radius:50%;background:#5fc08a}
.vsr-btn.busy{border-color:#5fc08a;color:#c9f2d9;background:#15281e}
.vsr-seg{display:inline-flex;border:1px solid #3a3e46;border-radius:999px;overflow:hidden;flex:0 0 auto}
.vsr-seg .vsr-btn{border:none;border-radius:0;height:20px}
.vsr-seg .vsr-btn+.vsr-btn{border-left:1px solid #3a3e46}
.vsr-path{display:flex;align-items:center;flex:0 0 auto;min-width:0;max-width:55%;overflow:hidden}
.vsr-crumb{background:none;border:0;border-radius:4px;padding:2px 5px;cursor:pointer;color:#aeb3bc;
  font:600 12px system-ui,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;
  font-variant-numeric:tabular-nums}
.vsr-crumb:hover{color:#f0d9a8;background:#1c1912}
.vsr-crumb.last{color:#f3dcaa;cursor:default;background:none;border-radius:0;
  box-shadow:inset 0 -2px 0 #d9b26a}
.vsr-path i{font-style:normal;color:#5d626b;padding:0 1px;flex:0 0 auto}
.vsr-filters{flex:1 1 auto;min-width:0;display:flex;align-items:center;gap:5px;overflow:hidden;
  color:#6f747d;font-size:11px;white-space:nowrap}
.vsr-chip{display:inline-flex;align-items:center;gap:5px;height:20px;padding:0 4px 0 9px;border-radius:999px;
  border:1px solid #6b5a33;background:#2a2416;color:#f3dcaa;font-size:11px;flex:0 1 auto;min-width:0;cursor:pointer}
.vsr-chip span{overflow:hidden;text-overflow:ellipsis}
.vsr-chip b{font-weight:400;color:#c9a453;padding:0 4px;font-size:13px;line-height:1}
.vsr-chip:hover b{color:#fff}
.vsr-tone-set{display:inline-flex;align-items:center;gap:6px;flex:0 0 auto;margin-left:4px}
.vsr-dot{width:11px;height:11px;border-radius:50%;background:var(--bk);cursor:pointer;flex:0 0 auto;
  box-shadow:0 0 0 1px #000, 0 0 0 2px color-mix(in srgb, var(--bk) 60%, #888)}
.vsr-dot:hover{filter:brightness(1.4)}
.vsr-light{-webkit-appearance:none;appearance:none;width:72px;height:12px;background:transparent;cursor:pointer;
  margin:0 2px;flex:0 0 auto}
.vsr-light::-webkit-slider-runnable-track{height:2px;border-radius:1px;
  background:linear-gradient(90deg, #6c8fd6 var(--pct,22%), #3a3a3a var(--pct,22%))}
.vsr-light::-webkit-slider-thumb{-webkit-appearance:none;width:10px;height:10px;border-radius:50%;
  background:#6c8fd6;margin-top:-4px;border:none}
.vsr-light::-moz-range-track{height:2px;background:#3a3a3a}
.vsr-light::-moz-range-progress{height:2px;background:#6c8fd6}
.vsr-light::-moz-range-thumb{width:10px;height:10px;border-radius:50%;background:#6c8fd6;border:none}
.vsr-info{color:#8b909a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;
  font-size:11px;flex:0 1 auto;max-width:40%;text-align:right}
.vsr-info.flash{color:#f0d9a8}
.vsr-tabs{display:flex;gap:2px;padding:0 16px;margin:14px -10px 12px;background:var(--vsr-bar);
  border-top:1px solid #26282d;border-bottom:1px solid #26282d;position:sticky;top:-10px;z-index:4}
.vsr-tab{background:none;border:0;border-bottom:2px solid transparent;margin-bottom:-1px;padding:6px 9px 6px;
  cursor:pointer;color:#8b909a;font:700 9.5px system-ui,sans-serif;letter-spacing:.9px;text-transform:uppercase}
.vsr-tab:hover{color:#d6d9de}
.vsr-tab.on{color:#f3dcaa;border-bottom-color:#d9b26a}
.vsr-tab.later{color:#4d515a;cursor:default}
.vsr-body{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;padding:10px 10px 14px}
.vsr-tiles{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-bottom:12px}
.vsr-tile{background:#17181b;border:1px solid #26282d;border-radius:7px;padding:8px 10px;min-width:0}
.vsr-tile em{display:block;font-style:normal;font-size:9.5px;font-weight:700;letter-spacing:.8px;
  text-transform:uppercase;color:#8b909a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vsr-tile b{display:block;font-size:20px;font-weight:600;color:#eef0f3;margin-top:2px;
  font-variant-numeric:tabular-nums;white-space:nowrap}
.vsr-tile b small{font-size:11px;font-weight:400;color:#8b909a;margin-left:6px}
.vsr-tile.pick b{color:#f3d48f}
.vsr-tile.del b{color:#e0958a}
.vsr-sec{margin-top:14px}
.vsr-sec:first-child{margin-top:0}
.vsr-sec.ax{border-top:1px solid #33363d;padding-top:12px}
.vsr-sec h6{display:flex;align-items:baseline;gap:8px;margin:0 0 6px;white-space:nowrap;font:700 9.5px system-ui,sans-serif;
  letter-spacing:.9px;text-transform:uppercase;color:#e4c27a}
.vsr-sec h6 i{font-style:normal;font-weight:400;letter-spacing:0;text-transform:none;color:#7d828b;font-size:11px;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.vsr-scenes{display:grid;grid-template-columns:repeat(auto-fill,minmax(40px,1fr));gap:4px}
.vsr-scene{border:1px solid #33363d;border-radius:6px;background:#17181b;padding:4px 4px 5px;cursor:pointer;
  text-align:center;min-width:0}
.vsr-scene:hover{border-color:#d9b26a}
.vsr-scene.none{border-style:dashed;background:none}
.vsr-scene.sel{border-color:#d9b26a;background:#2a2416}
.vsr-scene.fresh{border-color:#5fc08a}
.vsr-scene u{display:block;text-decoration:none;font-size:10px;color:#8b909a;font-variant-numeric:tabular-nums;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vsr-scene b{display:block;font-size:14px;font-weight:600;color:#f3d48f;font-variant-numeric:tabular-nums;line-height:1.25}
.vsr-scene b.n{color:#d6d9de}
.vsr-scene.none b{color:#5d626b}
.vsr-scene b small{font-size:9.5px;font-weight:400;color:#8b909a;margin-left:1px}
.vsr-scene .mini{display:flex;height:3px;border-radius:2px;overflow:hidden;background:#26282d;margin-top:3px}
.vsr-scene .pal{display:flex;height:5px;border-radius:2px;overflow:hidden;background:#26282d;margin-top:3px}
.vsr-scene .pal span{display:block;height:100%}
.vsr-row{display:grid;grid-template-columns:minmax(70px,26%) minmax(0,1fr) 138px;gap:8px;align-items:center;
  height:22px;padding:0 6px 0 5px;border-left:3px solid transparent;border-radius:4px;cursor:pointer}
.vsr-row:hover{background:#1a1c20}
.vsr-row.sel{border-left-color:#d9b26a;background:#1c1a14}
.vsr-row.thin .vsr-name,.vsr-row.thin .vsr-track,.vsr-row.thin .vsr-num{opacity:.5}
.vsr-name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#d6d9de}
.vsr-name sup{color:#c9a453;font-size:9px;margin-left:3px}
.vsr-name.lora,.vsr-wr.lora,.vsr-chip .lora{font-weight:700;color:#eef0f3}
.vsr-chip .lora{color:#fff3d6}
.vsr-wh.lora{font-weight:800}
.vsr-track{height:12px;min-width:0}
.vsr-barfill{display:flex;height:100%;border-radius:0 3px 3px 0;overflow:hidden;min-width:3px}
.vsr-barfill span{display:block;height:100%}
.vsr .p{background:#d9b26a}
.vsr .k{background:#3d4149}
.vsr .d{background:#a8554b}
.vsr-barfill span+span,.vsr-scene .mini span+span{margin-left:1px}
.vsr-num{display:grid;grid-template-columns:34px 1fr 46px;gap:4px;font-size:11px;color:#8b909a;
  font-variant-numeric:tabular-nums;white-space:nowrap}
.vsr-num b{font-weight:600;color:#f3d48f;text-align:right}
.vsr-num i{font-style:normal;text-align:right}
.vsr-num s{text-decoration:none;color:#c98479;text-align:right}
.vsr-note{color:#7d828b;font-size:11px;padding:3px 6px 0 8px}
.vsr-ver .vsr-name{display:flex;align-items:baseline;gap:8px}
.vsr-ver .vsr-name b{font-weight:700;color:#eef0f3}
.vsr-ver .vsr-name b.hit{color:#ffd36b}
.vsr-ver .vsr-name span,.vsr-anc .vsr-name{font:700 9.5px system-ui,sans-serif;letter-spacing:.6px;color:#8b909a;
  overflow:hidden;text-overflow:ellipsis}
.vsr-anc .vsr-name{color:#c9cdd4}
.vsr-vrow{display:grid;grid-template-columns:minmax(70px,26%) minmax(0,1fr) auto;gap:8px;align-items:center;
  min-height:24px;padding:2px 6px 2px 8px;border-radius:4px}
.vsr-vrow:hover{background:#1a1c20}
.vsr-miss{grid-template-columns:minmax(70px,26%) minmax(0,1fr);cursor:pointer}
.vsr-vcut{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;color:#8b909a;font-size:11px}
.vsr-vcut b{font-weight:700;color:#eef0f3;margin-right:6px;font-size:11.5px}
.vsr-vcut:hover b{color:#f3d48f}
.vsr-vchain{display:flex;flex-wrap:wrap;align-items:center;gap:4px}
.vsr-vchain>i{font-style:normal;color:#5d616a}
.vsr-vpill{display:inline-flex;align-items:baseline;gap:5px;height:20px;line-height:18px;padding:0 8px;
  border:1px solid #33363d;border-radius:999px;background:#17181b;cursor:pointer;font-size:11px;font-weight:700;color:#c9cdd4}
.vsr-vpill small{color:#7d828b;font-size:10px;font-weight:400}
.vsr-vpill.pre{color:#6f747d;border-color:#26282d}
.vsr-vpill.hit{color:#ffd36b;border-color:#9c7a35;background:#1f1a10}
.vsr-vpill:hover{border-color:#d9b26a}
.vsr-vend,.vsr-vfoot{font-size:11px;color:#7d828b;white-space:nowrap;text-align:right;font-variant-numeric:tabular-nums}
.vsr-vend b,.vsr-vfoot b{color:#f3d48f;font-weight:600}
.vsr-vend s,.vsr-vfoot s{text-decoration:none;color:#c98479}
.vsr-vfoot{text-align:left;padding:5px 6px 0 8px}
.vsr-tbody{border-bottom:1px solid #3a3e46}
.vsr-hrow.thin>div{opacity:.5}
.vsr-vno{font-weight:700;color:#eef0f3}
.vsr-vno.hit{color:#ffd36b}
.vsr-vname{color:#8b909a;overflow:hidden;display:block !important;line-height:26px;text-overflow:ellipsis}
.vsr-vwhat{gap:8px;font:700 9px system-ui,sans-serif;letter-spacing:.6px;color:#8b909a;overflow:hidden}
.vsr-vwhat em{font-style:normal;color:#ffd36b;border:1px solid #9c7a35;border-radius:999px;padding:0 6px;line-height:14px}
.vsr-vslots{gap:4px}
.vsr-vslot{flex:0 0 29px;height:18px;line-height:16px;text-align:center;border:1px solid #33363d;border-radius:999px;
  background:#17181b;font:700 10px system-ui,sans-serif;color:#c9cdd4;cursor:pointer}
.vsr-vslot.pre{color:#5d616a;border-color:#26282d}
.vsr-vslot.hit{color:#1b1610;background:#d9b26a;border-color:#d9b26a}
.vsr-vslot:hover{border-color:#f3d48f}
.vsr-vat{gap:8px}
.vsr-vat b{color:#f3d48f;font-weight:600;flex:0 0 auto}
.vsr-vat s{text-decoration:none;color:#c98479;font-size:11px}
.vsr-vline{position:relative;flex:1 1 auto;height:3px;border-radius:2px;background:#33363d}
.vsr-vline i{position:absolute;top:-3px;width:3px;height:9px;margin-left:-1px;border-radius:1px;background:#ffd36b}
.vsr-vof{color:#6f747d}
.vsr-vanc{font:700 9.5px system-ui,sans-serif;letter-spacing:.6px;color:#c9cdd4}
/* ---- the tabs about every series wear orange, so they never pass for the series on show */
.vsr-drawer.across{background:#1c120b;border-color:#6b4226}
.vsr-drawer.across .vsr-dhead{background:#100a06;border-bottom-color:#4a2e1a}
.vsr-drawer.across .vsr-dlab{color:#f0a868}
.vsr-drawer.across .vsr-sec h6{color:#f29a5a}
.vsr-drawer.across .vsr-lede.rule,.vsr-drawer.across .vsr-sec.ax{border-color:#4a2e1a}
.vsr-drawer.across .vsr-tile{background:#1a110b;border-color:#3e2818}
.vsr-drawer.across .vsr-tile em{color:#d98c55}
.vsr-drawer.across .vsr-btn:hover{border-color:#e8803c;color:#f7c9a0;background:#26170d}
.vsr-drawer.across .vsr-btn.on{border-color:#e8803c;color:#f7c39a;background:#2e1b0e}
.vsr-drawer.across .vsr-seg{border-color:#5a3a22}
.vsr-drawer.across .vsr-seg .vsr-btn+.vsr-btn{border-left-color:#5a3a22}
.vsr-drawer.across .vsr-htable{border-top-color:#5a3a22}
.vsr-drawer.across .vsr-hgroups{color:#f29a5a}
.vsr-drawer.across .vsr-hgroups>div.g{box-shadow:inset 0 -1px 0 #7a4a28}
.vsr-drawer.across .vsr-hhead,.vsr-drawer.across .vsr-hist,.vsr-drawer.across .vsr-tbody{border-bottom-color:#4a2e1a}
.vsr-drawer.across .vsr-hrow>.g{border-left-color:#3a2516}
.vsr-drawer.across .vsr-hmonth{background:#160e08;color:#d98c55;border-bottom-color:#3a2516}
.vsr-drawer.across .vsr-hrow:hover{background:#25170e}
.vsr-drawer.across .vsr-hrow.sel{border-left-color:#e8803c;background:#2a1a0e}
.vsr-drawer.across .vsr-hhidden span:hover,.vsr-drawer.across .vsr-tmore:hover{border-color:#e8803c;color:#f7c39a}
.vsr-drawer.across .vsr-legend{border-top-color:#4a2e1a}
.vsr-hrow>.c{justify-content:center}
.vsr-empty{padding:14px 8px 4px;font-size:11.5px}
.vsr-dhead .vsr-tacross{margin-left:auto;margin-right:6px;align-self:center;height:14px;padding:0;border-left:1px solid #4d3d24;
  font:700 8.5px system-ui,sans-serif;letter-spacing:1px;text-transform:uppercase;color:#c97a3f;white-space:nowrap;
  border-left-color:#6b4226}
.vsr-dhead .vsr-tab.across{color:#b87a4c}
.vsr-dhead .vsr-tab.across:hover{color:#f2b07a}
.vsr-dhead .vsr-tab.across.on{color:#f29a5a;border-bottom-color:#e8803c}
.vsr-drawer.shut .vsr-dhead .vsr-tab.across.on{border-bottom-color:#e8803c}
.vsr-tmore{padding:7px 10px 0;font-size:11px;color:#8b909a;cursor:pointer}
.vsr-tmore:hover{color:#f3d48f}
.vsr-hmonth.vsr-tgroup{position:static;top:auto;z-index:auto;padding:7px 10px 3px}
.vsr-tname{font-weight:600;color:#d6d9de;overflow:hidden;display:block !important;line-height:26px;text-overflow:ellipsis}
.vsr-tname.lora{font-weight:700;color:#eef0f3}
.vsr-hhead .vsr-tcol{font-size:8.5px;letter-spacing:.3px;text-transform:none}
.vsr-tcell{font-weight:600}
.vsr-tcell.s4{color:#ffd36b}
.vsr-tcell.s3{color:#d9b26a}
.vsr-tcell.s2{color:#a8885a}
.vsr-tcell.s1{color:#7d6a48}
.vsr-tcell.s0{color:#5d616a}
.vsr-tcell.none{color:#3d4047}
.vsr-tcell.thin{font-weight:400;opacity:.6}
.vsr-ttrend{font-size:10.5px;color:#6f747d}
.vsr-ttrend.up{color:#f3d48f}
.vsr-ttrend.down{color:#c98479}
.vsr-tbar{gap:8px}
.vsr-tbar b{color:#f3d48f;font-weight:600;flex:0 0 auto;width:18px;text-align:right}
.vsr-tbar s{text-decoration:none;color:#c98479;font-size:11px}
.vsr-tfill{display:block;height:8px;border-radius:2px;background:#5a6070}
.vsr-tfill.hard{background:#a8554b}
.vsr-tfill.easy{background:#d9b26a}
.vsr-legend .ls4::before{background:#ffd36b !important}
.vsr-legend .ls3::before{background:#d9b26a !important}
.vsr-legend .ls2::before{background:#a8885a !important}
.vsr-legend .ls1::before{background:#7d6a48 !important}
.vsr-legend .lhard::before{background:#a8554b !important}
.vsr-legend .leasy::before{background:#d9b26a !important}
.vsr-sortrow.vsr-hspan{justify-content:space-between;align-items:center;margin:0 0 10px}
.vsr-hrange{font-size:11px;color:#8b909a}
.vsr-htable{border-top:1px solid #3a3e46;font-variant-numeric:tabular-nums}
.vsr-hist{max-height:600px;overflow-y:auto;overflow-x:hidden;border-bottom:1px solid #3a3e46}
.vsr-hrow{display:grid;grid-template-columns:40px minmax(110px,1.5fr) minmax(50px,1fr) 66px 52px 46px 54px 50px 52px 42px minmax(70px,104px) 22px;
  align-items:stretch;height:26px;border-left:3px solid transparent;cursor:pointer;font-size:11.5px;color:#c9cdd4}
.vsr-hrow>div{display:flex;align-items:center;min-width:0;padding:0 7px;white-space:nowrap}
.vsr-hrow>.r{justify-content:flex-end}
.vsr-hrow>.g{border-left:1px solid #2a2c31}
.vsr-hrow>.l{justify-content:flex-start}
.vsr-hrow:hover{background:#1a1c20}
.vsr-hrow.sel{border-left-color:#d9b26a;background:#1c1a14}
.vsr-hrow.zero>div:not(.vsr-hhide){opacity:.45}
.vsr-hgroups,.vsr-hhead{cursor:default;height:20px;font:700 9px system-ui,sans-serif;letter-spacing:.8px;
  text-transform:uppercase;color:#7d828b}
.vsr-hgroups{height:22px;color:#c9a453;letter-spacing:1.2px}
.vsr-hgroups>div{align-items:flex-end;padding-bottom:3px}
.vsr-hgroups>div.g{border-left:none;box-shadow:inset 0 -1px 0 #5a4c2c;margin-left:7px}
.vsr-hhead{border-bottom:1px solid #3a3e46}
.vsr-hgroups:hover,.vsr-hhead:hover{background:none}
.vsr-hmonth{position:sticky;top:0;z-index:1;background:#141518;padding:8px 10px 3px;font:700 9px system-ui,sans-serif;
  letter-spacing:1.2px;text-transform:uppercase;color:#8b909a;border-bottom:1px solid #26282d}
.vsr-hday{color:#6f747d;font-size:10.5px}
.vsr-hname{font-weight:700;color:#eef0f3;overflow:hidden}
.vsr-hname{display:block !important;line-height:26px;text-overflow:ellipsis}
.vsr-hrow .vsr-track{flex:1 1 auto}
.vsr-hrow b{color:#f3d48f;font-weight:600}
.vsr-hrow small{color:#6f747d;font-size:10.5px;white-space:pre}
.vsr-hrow .ranked{font-weight:700}
.vsr-hok{color:#f3d48f}
.vsr-hnone{color:#c98479}
.vsr-hanc{gap:5px;font:700 9px system-ui,sans-serif;letter-spacing:.6px;overflow:hidden}
.vsr-hanc span{color:#8b909a}
.vsr-hanc i{font-style:normal;color:#5d616a}
.vsr-hanc b{color:#d9b26a;font-weight:700}
.vsr-hhide{justify-content:center;padding:0 !important;color:#3d4047;font-size:14px;cursor:pointer}
.vsr-hrow:hover .vsr-hhide{color:#8b909a}
.vsr-hhide:hover{color:#e07a6e}
.vsr-legend .lb::before{background:#4f93d6 !important}
.vsr-legend .lg::before{background:#d9a640 !important}
.vsr-hhidden{display:flex;flex-wrap:wrap;gap:5px;padding:2px 6px 0 8px}
.vsr-hhidden span{height:20px;line-height:18px;padding:0 9px;border:1px solid #33363d;border-radius:999px;
  color:#8b909a;font-size:11px;cursor:pointer}
.vsr-hhidden span:hover{border-color:#d9b26a;color:#eef0f3}
.vsr-always{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:10px 0 2px;padding:7px 10px;
  border:1px solid #5a4c2c;border-radius:6px;background:#1f1a10;color:#e4c27a;font-size:11.5px}
.vsr-always em{font-style:normal;font:700 9.5px system-ui,sans-serif;letter-spacing:.8px;color:#c9a453;margin-right:4px}
.vsr-always b{font-weight:700;color:#fff3d6;padding:1px 8px;border:1px solid #7a6535;border-radius:999px;background:#17140c}
.vsr-lede{color:#8b909a;font-size:11px;margin:0 0 10px;line-height:1.45}
.vsr-lede:first-child{margin-top:0}
.vsr-legend{display:flex;flex-wrap:wrap;gap:12px;margin-top:14px;padding-top:9px;border-top:1px solid #33363d;color:#8b909a;font-size:11px}
.vsr-legend span{display:inline-flex;align-items:center;gap:5px}
.vsr-legend span::before{content:"";width:9px;height:9px;border-radius:2px;background:#3d4149}
.vsr-legend .lp::before{background:#d9b26a}
.vsr-legend .ld::before{background:#a8554b}
.vsr-legend .vsr-lring::before{border-radius:50%;background:#5a6070;box-shadow:0 0 0 1.5px #d9b26a}
.vsr-legend .vsr-lring.vsr-ldel::before{box-shadow:0 0 0 1.5px #c8645a;background:#5a6070}
.vsr-legend .vsr-ldot::before{border-radius:50%;background:#5a6070}
.vsr-tone{position:relative;height:240px;background:#0f1012;border:1px solid #26282d;border-radius:6px}
.vsr-tone canvas{display:block;width:100%;height:100%;cursor:crosshair}
.vsr-tip{position:absolute;z-index:3;display:none;pointer-events:none;background:#121418;border:1px solid #e4c27a;
  border-radius:10px;box-shadow:0 8px 24px #000c;padding:8px 11px;font-size:11px;line-height:1.5;color:#b9bdc5;
  white-space:pre;max-width:300px}
.vsr-tip b{display:block;font-size:12px;color:#e4c27a;margin-bottom:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vsr-story,.vsr-labels{display:grid;gap:3px}
.vsr-col{height:92px;display:flex;flex-direction:column;border-radius:3px;overflow:hidden;cursor:pointer;
  outline:1px solid transparent;outline-offset:1px;min-width:0}
.vsr-col span{display:block;width:100%;flex:0 0 auto}
.vsr-col:hover{outline-color:#6b5a33}
.vsr-col.sel{outline-color:#d9b26a}
.vsr-col.none{border:1px dashed #33363d;background:none}
.vsr-curve{display:block;width:100%;height:70px;margin-top:6px}
.vsr-labels{margin-top:4px}
.vsr-labels span{display:block;font-size:10px;color:#aeb3bc;text-align:center;white-space:nowrap;overflow:hidden;
  text-overflow:ellipsis;font-variant-numeric:tabular-nums;min-width:0;cursor:pointer}
.vsr-labels span small{display:block;font-size:9px;color:#6f747d;overflow:hidden;text-overflow:ellipsis;margin-top:1px}
.vsr-labels span.sel{color:#f3dcaa}
.vsr-labels span.sel small{color:#c9a453}
.vsr-rhead,.vsr-rrow{display:grid;grid-template-columns:minmax(70px,22%) 30px repeat(4,minmax(0,1fr));
  gap:8px;align-items:center}
.vsr-rhead{position:sticky;top:20px;z-index:2;background:var(--vsr-bg);padding:6px 6px 6px 8px;margin:0 0 2px;
  color:#8b909a;font:700 9px system-ui,sans-serif;letter-spacing:.8px;text-transform:uppercase}
.vsr-rhead span{text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vsr-rrow{height:22px;padding:0 6px 0 5px;border-left:3px solid transparent;border-radius:4px;cursor:pointer}
.vsr-rrow:hover{background:#1a1c20}
.vsr-rrow.sel{border-left-color:#d9b26a;background:#1c1a14}
.vsr-rrow.thin>*{opacity:.5}
.vsr-rrow .n{font-size:10px;color:#7d828b;text-align:right;font-variant-numeric:tabular-nums}
.vsr-cell{display:grid;grid-template-columns:minmax(0,1fr) 30px;gap:4px;align-items:center;min-width:0}
.vsr-dv{position:relative;height:14px}
.vsr-dv::before{content:"";position:absolute;left:50%;top:0;bottom:0;width:1px;background:#3a3e46}
.vsr-dv span{position:absolute;top:3px;height:8px}
.vsr-dn{font-size:10px;color:#aeb3bc;text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.vsr-dn.none{color:#4d515a}
.vsr-note-box{margin-top:10px;background:#17181b;border:1px solid #26282d;border-radius:7px;padding:9px 12px 10px;
  max-height:220px;overflow:auto}
.vsr-note-box em{display:block;font-style:normal;font:700 9.5px system-ui,sans-serif;letter-spacing:.8px;
  text-transform:uppercase;color:#e4c27a;margin-bottom:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vsr-note-box em i{font-style:normal;font-weight:400;letter-spacing:0;text-transform:none;color:#8b909a;margin-left:6px}
.vsr-note-box p{margin:0;white-space:pre-wrap;color:#d6d9de;font-size:10px;line-height:1.55}
.vsr-note-box.none p{color:#6f747d}
.vsr-sortrow{display:flex;justify-content:flex-end;margin:0 0 4px}
.vsr-tcols{display:grid;gap:3px;align-items:end;height:130px;border-bottom:1px solid #33363d}
.vsr-tcol{display:flex;flex-direction:column;justify-content:flex-end;height:100%;cursor:pointer;min-width:0;position:relative}
.vsr-tcol .v{font-size:10px;color:#d6d9de;text-align:center;white-space:nowrap;margin-bottom:3px;
  font-variant-numeric:tabular-nums}
.vsr-tcol .bar{display:flex;flex-direction:column;justify-content:flex-end;border-radius:3px 3px 0 0;overflow:hidden;min-height:2px}
.vsr-tcol .bar span{display:block;width:100%}
.vsr-tcol .bar .ex{background:#8f96a3}
.vsr-tcol .bar .es{background:#8f96a355}
.vsr-tcol:hover .bar .ex{background:#b9bfca}
.vsr-tcol:hover .bar .es{background:#b9bfca66}
.vsr-tcol.sel .bar{box-shadow:0 0 0 2px #d9b26a}
.vsr-tlabels{display:grid;gap:3px;margin-top:4px}
.vsr-tlabels span{display:block;text-align:center;font-size:10px;color:#aeb3bc;white-space:nowrap;overflow:hidden;
  text-overflow:ellipsis;min-width:0;font-variant-numeric:tabular-nums}
.vsr-tlabels span small{display:block;font-size:9px;color:#d9b26a;margin-top:1px}
.vsr-tlabels span.sel{color:#f3dcaa}
.vsr-log{position:relative;height:200px;background:#0f1012;border:1px solid #26282d;border-radius:6px}
.vsr-log canvas{display:block;width:100%;height:100%;cursor:crosshair}
.vsr-srow{display:grid;grid-template-columns:minmax(70px,26%) minmax(0,1fr) 110px;gap:8px;align-items:center;
  height:22px;padding:0 6px 0 5px;border-left:3px solid transparent;border-radius:4px;cursor:pointer}
.vsr-srow:hover{background:#1a1c20}
.vsr-srow.sel{border-left-color:#d9b26a;background:#1c1a14}
.vsr-srow.thin>*{opacity:.5}
.vsr-srow .trk{height:10px;min-width:0}
.vsr-srow .trk span{display:block;height:100%;border-radius:0 3px 3px 0;background:#8f96a3;min-width:2px}
.vsr-srow .num{font-size:11px;color:#8b909a;text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.vsr-srow .num b{font-weight:600;color:#eef0f3;margin-right:6px}
.vsr-tkey{display:flex;flex-wrap:wrap;gap:14px;margin-top:8px;color:#8b909a;font-size:11px}
.vsr-tkey span{display:inline-flex;align-items:center;gap:6px}
.vsr-tkey i{display:inline-block;width:12px;height:10px;border-radius:2px}
.vsr-wallbox{background:#17181b;border:1px solid #26282d;border-radius:7px;padding:9px 12px;margin:0 0 12px}
.vsr-wallbar{display:flex;align-items:center;gap:8px;color:#aeb3bc;font-size:11px;flex-wrap:wrap}
.vsr-wallbar label{font:700 9.5px system-ui,sans-serif;letter-spacing:.8px;text-transform:uppercase;color:#e4c27a}
.vsr-wallkey{display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:8px;padding-top:8px;border-top:1px solid #26282d;
  color:#8b909a;font-size:11px}
.vsr-wallkey span{display:inline-flex;align-items:center;gap:6px}
.vsr-wallkey i{display:inline-block;width:11px;height:15px;border-radius:2px;background:#3d4149;box-shadow:0 0 0 1px #26282d}
.vsr-wallkey i.pick{box-shadow:0 0 0 2px #d9b26a}
.vsr-wallkey i.deleted{box-shadow:0 0 0 2px #c8645a}
.vsr-wallbar select{height:22px;border-radius:999px;border:1px solid #33363d;background:#0f1012;color:#d6d9de;
  padding:0 8px;font:11px system-ui,sans-serif;outline:none;max-width:200px}
.vsr-wallbar select:focus{border-color:#d9b26a}
.vsr-wall{display:grid;gap:6px;align-items:start}
.vsr-wh{font:700 9.5px system-ui,sans-serif;letter-spacing:.8px;text-transform:uppercase;color:#e4c27a;
  padding:2px 4px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;min-width:0}
.vsr-wh:hover{color:#f3dcaa}
.vsr-wh.sel{color:#fff3d6;text-decoration:underline;text-underline-offset:3px}
.vsr-wr{font-size:11px;color:#d6d9de;padding:6px 4px 0 2px;overflow:hidden;text-overflow:ellipsis;cursor:pointer;
  word-break:break-word;line-height:1.3;min-width:0}
.vsr-wr:hover{color:#f3dcaa}
.vsr-wr.sel{color:#f3dcaa}
.vsr-wc{background:#17181b;border:1px solid #26282d;border-radius:6px;padding:5px;min-width:0;min-height:40px}
.vsr-wc.empty{background:none;border-style:dashed}
.vsr-wc .h{display:flex;gap:6px;font-size:10px;color:#8b909a;margin:0 1px 4px;font-variant-numeric:tabular-nums}
.vsr-wc .h b{font-weight:600;color:#f3d48f}
.vsr-wc .h s{text-decoration:none;color:#c98479}
.vsr-thumbs{display:flex;flex-wrap:wrap;gap:7px}
.vsr-th{width:52px;height:76px;border-radius:3px;overflow:hidden;cursor:zoom-in;background:#0f1012;
  box-shadow:0 0 0 1px #26282d;flex:0 0 auto}
.vsr-th.land{width:76px;height:52px}
.vsr-th.pick{box-shadow:0 0 0 2px #d9b26a}
.vsr-th.deleted{box-shadow:0 0 0 2px #c8645a}
.vsr-th img{display:block;width:100%;height:100%;object-fit:cover}
.vsr-more{font-size:10px;color:#8b909a;align-self:center;padding:0 3px}
.vsr-view{position:absolute;inset:0;z-index:7;display:none;background:rgba(10,11,12,.94);cursor:zoom-out;
  flex-direction:column;align-items:center;justify-content:center;padding:14px;gap:8px}
.vsr.viewing .vsr-view{display:flex}
.vsr-view img{max-width:100%;max-height:calc(100% - 44px);object-fit:contain;border-radius:4px}
.vsr-view img.pick{box-shadow:0 0 0 2px #d9b26a}
.vsr-view img.deleted{box-shadow:0 0 0 2px #c8645a}
.vsr-view div{color:#aeb3bc;font-size:11px;text-align:center;white-space:pre-line}
.vsr-frames{display:grid;grid-template-columns:repeat(auto-fill,minmax(64px,1fr));gap:8px}
.vsr-fr{cursor:pointer;min-width:0}
.vsr-fr canvas{display:block;width:100%;border-radius:3px;outline:1px solid #26282d}
.vsr-fr.sel canvas{outline:2.5px solid #d9b26a;outline-offset:1px}
.vsr-fr:hover canvas{outline-color:#6b5a33}
.vsr-fr span{display:block;text-align:center;font-size:10px;color:#8b909a;margin-top:3px;white-space:nowrap;
  overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}
.vsr-fr.sel span{color:#f3dcaa}
.vsr-detail{display:grid;grid-template-columns:minmax(0,38%) minmax(0,1fr);gap:14px;align-items:start}
.vsr-detail .map{position:relative}
.vsr-detail canvas{display:block;width:100%;border-radius:4px;cursor:crosshair}
.vsr-stat{color:#8b909a;font-size:11px;line-height:1.55}
.vsr-stat b{display:block;font-size:20px;font-weight:600;color:#eef0f3;font-variant-numeric:tabular-nums}
.vsr-stat p{margin:0 0 12px}
.vsr-key{margin:4px 0 0;padding-top:10px;border-top:1px solid #26282d;display:grid;gap:6px}
.vsr-key div{display:grid;grid-template-columns:30px minmax(0,1fr);gap:8px;align-items:center;font-size:11px;color:#aeb3bc}
.vsr-key i{display:block;height:12px;border-radius:2px}
.vsr-key i.dot{width:10px;height:10px;border-radius:50%;margin-left:10px}
.vsr-key i.line{height:0;border-top:1px dashed rgba(255,255,255,.4);margin:0 2px}
.vsr-empty{padding:34px 20px;text-align:center;color:#8b909a;line-height:1.6}
.vsr-empty b{display:block;color:#d6d9de;font-size:13px;margin-bottom:4px}
.vsr-help{position:absolute;inset:0;z-index:6;display:none;background:rgba(10,11,12,.9);overflow:auto;padding:14px}
.vsr.help .vsr-help{display:block}
.vsr-help-box{max-width:640px;margin:0 auto;background:#16171a;border:1px solid #33363d;border-radius:9px;padding:14px 16px}
.vsr-help-box h3{margin:0 0 4px;font-size:14px;color:#fff}
.vsr-help-box p{margin:0 0 10px;color:#8b909a}
.vsr-help-box h5{margin:12px 0 4px;font:700 10px system-ui,sans-serif;color:#e4c27a;letter-spacing:.8px;text-transform:uppercase}
.vsr-help-box table{border-collapse:collapse;width:100%}
.vsr-help-box td{padding:3px 0;vertical-align:top}
.vsr-help-box td:first-child{white-space:nowrap;padding-right:14px;width:1%;color:#f0d9a8}
.vsr-card{position:fixed;z-index:10002;max-width:420px;min-width:200px;padding:10px 12px;
  background:#121418;border:1px solid #e4c27a;border-radius:10px;box-shadow:0 8px 24px #000c;
  font-family:system-ui,sans-serif;color:#d8dbe0;display:flex;flex-direction:column;gap:7px;pointer-events:none}
.vsr-card .ch b{font-size:12px;color:#e4c27a;font-weight:700}
.vsr-card .en{font-size:11px;line-height:1.6;color:#b9bdc5;white-space:pre-wrap}
.vsr-card .en b.num{font-size:13px;font-weight:600;color:#ffffff;font-variant-numeric:tabular-nums}
.vsr-card .hint{font-size:10.5px;line-height:1.5;color:#8b909a;display:grid;gap:3px}
.vsr-card .en+.hint{border-top:1px solid #23262c;padding-top:7px}
.vsr-card .hint .hr{display:grid;grid-template-columns:auto 1fr;gap:12px;align-items:baseline}
.vsr-card .hint .hr b{font-size:11px;font-weight:700;color:#e4c27a;white-space:nowrap}
.vsr-card .hint .hr span{color:#a9aeb7}
.vsr-ctx{position:fixed;z-index:10001;min-width:220px;max-width:340px;max-height:60vh;overflow:auto;padding:5px;
  background:#121418;border:1px solid #e4c27a;border-radius:9px;font:12px system-ui,sans-serif;color:#d8dbe0}
.vsr-ctx .h{padding:4px 8px 6px;font-size:10px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:#e4c27a}
.vsr-ctx button{display:block;width:100%;text-align:left;padding:6px 9px;border:0;border-radius:6px;background:none;
  color:#d8dbe0;font:inherit;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vsr-ctx button:hover{background:#e4c27a22;color:#fff3d6}
.vsr-ctx .sep{height:1px;background:#2a2d33;margin:4px 6px}
/* the head: a title bar like the Series Book's, and the scope in a frame */
.vsr-bar{padding:8px 10px 8px;border-bottom:1px solid color-mix(in srgb, var(--bk) 35%, #26282d)}
.vsr-title{font:700 10.5px system-ui,sans-serif;letter-spacing:1px;text-transform:uppercase;color:#e4c27a;
  white-space:nowrap;flex:0 0 auto}
.vsr-title-n{font-size:11px;color:#8b909a;white-space:nowrap;flex:0 0 auto;margin-right:2px}
.vsr-grow{flex:1 1 auto;min-width:0}
.vsr-frame{border:1.5px solid color-mix(in srgb, var(--bk) 70%, #8a8f99);border-radius:10px;overflow:hidden;
  background:color-mix(in srgb, var(--bk) 8%, #121315)}
.vsr-fhead{padding:10px 12px 9px;background:color-mix(in srgb, var(--bk) 22%, #16171a);
  border-bottom:1px solid color-mix(in srgb, var(--bk) 45%, #26282d)}
.vsr-head-top{display:flex;align-items:center;gap:12px;min-width:0}
.vsr-head-top .vsr-path{flex:1 1 auto;max-width:none;min-width:0;align-items:baseline}
.vsr-head-top .vsr-crumb{font:700 15px/1.15 system-ui,sans-serif;padding:2px 5px 4px;color:#9aa0aa;letter-spacing:.2px}
.vsr-head-top .vsr-crumb:hover{color:#f0d9a8}
.vsr-head-top .vsr-crumb.last{color:#f3dcaa;box-shadow:inset 0 -2.5px 0 #d9b26a}
.vsr-head-top .vsr-path i{font-size:13px;color:#5d626b;padding:0 2px}
.vsr-subtitle{margin-left:10px;font-size:12.5px;color:#c9ccd2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
  min-width:0;flex:0 1 auto}
.vsr-head-top .vsr-series{flex:0 1 230px;max-width:230px;min-width:120px}
.vsr-head-sub{display:flex;align-items:center;gap:6px;margin-top:7px;min-height:20px;min-width:0}
.vsr-head-sub .vsr-info{max-width:55%}
.vsr-fbody{padding:10px 12px 12px}
/* ---- dressed as the Series Book: its colour behind, the series' colour around */
.vsr{border:1px solid color-mix(in srgb, var(--bk) 45%, #1a1a1a);border-radius:7px;
  background:color-mix(in srgb, var(--bk) calc(var(--bl) * 40%), #08090b)}
.vsr-bar{background:transparent;border-bottom:none;padding:8px 10px 2px}
.vsr-body{padding:6px 10px 14px}
.vsr-frame{--sg:#22c3d6;margin:4px 0 0;border:2px solid color-mix(in srgb, var(--sg) 70%, #3a3428);border-radius:12px;
  overflow:visible;background:color-mix(in srgb, var(--sg) 9%, color-mix(in srgb, var(--bk) calc(var(--bl) * 55% + 6%), #07080a))}
.vsr-fhead{padding:8px 12px 8px;border-radius:10px 10px 0 0;background:#00000059;
  border-bottom:1px solid color-mix(in srgb, var(--sg) 30%, #ffffff14)}
.vsr-head-top .vsr-crumb{color:color-mix(in srgb, var(--sg) 55%, #b8b0a0)}
.vsr-head-top .vsr-crumb:hover{color:#f3ead8;background:none}
.vsr-head-top .vsr-crumb.last{color:#f3ead8;box-shadow:inset 0 -2.5px 0 color-mix(in srgb, var(--sg) 85%, #fff)}
.vsr-head-top .vsr-path i{color:color-mix(in srgb, var(--sg) 35%, #5d626b)}
.vsr-subtitle{color:color-mix(in srgb, var(--sg) 38%, #d8c9a6)}
.vsr-frame .vsr-scene{background:transparent;border-color:color-mix(in srgb, var(--sg) 45%, #2e2a24)}
.vsr-frame .vsr-scene:hover{border-color:color-mix(in srgb, var(--sg) 80%, #3a3428)}
.vsr-frame .vsr-scene u{color:color-mix(in srgb, var(--sg) 55%, #a8a49a)}
.vsr-frame .vsr-scene.sel{border-color:color-mix(in srgb, var(--sg) 85%, #fff);
  background:color-mix(in srgb, var(--sg) 62%, #1a1814)}
.vsr-frame .vsr-scene.sel u,.vsr-frame .vsr-scene.sel b,.vsr-frame .vsr-scene.sel b small{color:#fff}
.vsr-frame .vsr-scene.fresh{border-color:#5fc08a}
.vsr-frame .vsr-tile{background:#00000033;border-color:color-mix(in srgb, var(--sg) 45%, #2e2a24)}
.vsr-frame .vsr-tile em{color:color-mix(in srgb, var(--sg) 40%, #a8a49a)}
/* the story at the foot of the frame, as the Series Book keeps its notes */
.vsr-fstory{border-top:1px solid color-mix(in srgb, var(--sg) 30%, #ffffff14);background:#00000059;
  border-radius:0 0 10px 10px}
.vsr-fstory .sh{display:flex;align-items:baseline;gap:7px;padding:7px 12px;cursor:pointer;user-select:none;min-width:0}
.vsr-fstory .sh .car{color:#a9aeb7;font-size:13px;width:14px;text-align:center;flex:0 0 auto}
.vsr-fstory .sh b{font-size:10px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;flex:0 0 auto;
  color:color-mix(in srgb, var(--sg) 60%, #cfc6b4)}
.vsr-fstory .sh i{font-style:normal;font-size:11px;color:#8d8679;min-width:0;overflow:hidden;
  text-overflow:ellipsis;white-space:nowrap}
.vsr-fstory .sh:hover b{color:#f3ead8}
.vsr-fstory p{margin:0 12px 0 33px;padding-bottom:10px;font-size:10px;line-height:1.55;color:#c9c4ba;white-space:pre-wrap}
.vsr-fstory.none p{color:#6f6a60;font-style:italic}
/* the analysis in a drawer of its own, folding like the Series Book's */
.vsr-drawer{margin-top:10px;border:1px solid #4d3d24;border-radius:10px;background:#19140d;
  box-shadow:0 0 0 1px #00000040;padding:0 10px 10px}
.vsr-drawer.shut{padding-bottom:0}
.vsr-dhead{display:flex;align-items:center;gap:2px;position:sticky;top:-6px;z-index:4;background:#0d0b08;
  margin:0 -10px;padding:3px 10px 0 6px;border-radius:10px 10px 0 0;border-bottom:1px solid #3a2e1c}
.vsr-drawer.shut .vsr-dhead{border-bottom-color:transparent;border-radius:10px;padding-bottom:1px}
.vsr-dhead .tw{display:inline-block;font-size:19px;line-height:1;width:22px;text-align:center;color:#a9aeb7;
  cursor:pointer;user-select:none;transition:transform .12s;flex:0 0 auto}
.vsr-dhead .tw:hover{color:#e0b85a}
.vsr-drawer.shut .vsr-dhead .tw{transform:rotate(-90deg)}
.vsr-dhead .vsr-tabs{margin:0;padding:0;background:none;border:0;position:static;flex:1 1 auto}
.vsr-drawer.shut .vsr-tab.on{border-bottom-color:transparent}
.vsr-dbody{padding-top:10px}
.vsr-rhead{top:26px;background:#19140d}
/* ---- the node as tall as what it shows, as the Series Book is: nothing
   scrolls but the wall, which can hold a whole series */
.vsr{height:auto;overflow:visible}
.vsr-body{flex:0 0 auto;overflow:visible;padding:6px 10px 0}
.vsr-drawer{margin:10px 10px 10px}
.vsr-dhead{position:static;top:auto;gap:6px;padding:0 10px 0 6px;flex-wrap:wrap;row-gap:0;align-items:stretch}
.vsr-dhead>.tw,.vsr-dhead>.vsr-dlab{align-self:center}
.vsr-drawer.shut .vsr-dhead{padding-bottom:0}
.vsr-dlab{font-size:10px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:#e3c58a;
  cursor:pointer;user-select:none;margin-right:6px;flex:0 0 auto}
.vsr-dlab:hover{color:#e0b85a}
.vsr-dhead .vsr-tabs{display:inline-flex;flex-wrap:wrap;gap:0 2px;align-self:stretch}
.vsr-dhead .vsr-tab{font-size:9.5px;letter-spacing:.7px;padding:10px 8px 8px;margin:0 0 -1px;border:0;
  border-bottom:3px solid transparent;border-radius:0;color:#8f8676;background:transparent}
.vsr-dhead .vsr-tab:hover{color:#e8d3a4}
.vsr-dhead .vsr-tab.on{color:#f3d48f;border-bottom-color:#d9b26a;background:transparent}
.vsr-drawer.shut .vsr-dhead .vsr-tab.on{border-bottom-color:#d9b26a}
.vsr-lede.rule{border-bottom:1px solid #33363d;padding-bottom:10px;margin-bottom:12px}
.vsr-rhead{position:static}
.vsr-wallscroll{max-height:640px;overflow:auto;padding-right:4px}
.vsr{background:transparent;border:0;border-radius:0}
.vsr-main{border:1px solid color-mix(in srgb, var(--bk) 45%, #1a1a1a);border-radius:7px;
  background:color-mix(in srgb, var(--bk) calc(var(--bl) * 40%), #08090b);padding-bottom:10px}
.vsr-drawer{margin:10px 0 0;padding:0 10px 10px}
`;

/* bar colours of the four measures, and for warmth its two sides */
const METRIC_COLOR = { b: "#cfd2d8", c: "#8f96a3", s: "#a98bc9" };
const WARM = "#d9975a";
const COOL = "#6f97c9";

function ensureCSS() {
  if (document.getElementById("vsr-css")) return;
  const s = document.createElement("style");
  s.id = "vsr-css";
  s.textContent = CSS;
  document.head.appendChild(s);
}

function setDefaults(node) {
  node.properties = node.properties || {};
  const P = node.properties;
  if (typeof P.vsr_series !== "string") P.vsr_series = "";
  if (!["order", "pick", "deleted"].includes(P.vsr_sort)) P.vsr_sort = "order";
  if (![30, 90, 182, 365, 0].includes(P.vsr_hist_days)) P.vsr_hist_days = 30;
  if (typeof P.vsr_live !== "boolean") P.vsr_live = true;
  if (!Array.isArray(P.vsr_filters)) P.vsr_filters = [];
  if (!TABS.some(([k]) => k === P.vsr_tab) || LATER.has(P.vsr_tab)) P.vsr_tab = "verdicts";
  /* a workflow opens on the series on show: the tabs about every series are
     read only when someone opens them */
  if (ACROSS.has(P.vsr_tab)) P.vsr_tab = "verdicts";
  if (!P.vsr_wall || typeof P.vsr_wall !== "object") P.vsr_wall = {};
  if (!Number.isInteger(P.vsr_hue) || P.vsr_hue < 0 || P.vsr_hue >= HUES.length) P.vsr_hue = HUE_DEFAULT;
  /* the Series Book's colour and brightness, as last seen on the canvas */
  if (typeof P.vsr_bk !== "string" || !P.vsr_bk) P.vsr_bk = HUES[P.vsr_hue][1];
  if (typeof P.vsr_tabs_open !== "boolean") P.vsr_tabs_open = true;
  if (typeof P.vsr_story_open !== "boolean") P.vsr_story_open = true;
  if (!Number.isFinite(Number(P.vsr_light))) P.vsr_light = LIGHT_DEFAULT;
  P.vsr_light = Math.max(0, Math.min(1, Number(P.vsr_light)));
}

const HELP = `
<div class="vsr-help-box">
  <h3>Visual Series Report</h3>
  <p>Every render of a series, measured and counted: its tone and colour, the recipe
  that made it, and what became of it in the Visual Image Viewer.</p>
  <h5>Where you are</h5>
  <table>
    <tr><td>S1 &rsaquo; E4 &rsaquo; C-04</td><td>season, episode, cut - read from series named like S1E4.
      Click a part to go back up</td></tr>
    <tr><td>The strip</td><td>episodes of a season, or cuts of an episode - click one to go in</td></tr>
  </table>
  <h5>Always on top</h5>
  <table>
    <tr><td>Strip, four numbers</td><td>picks in each cut or episode, and the renders, picks and
      deletions of what is on show</td></tr>
    <tr><td>Story box</td><td>the Series Book's note on the episode on show - or, with a cut
      clicked, that cut's own note</td></tr>
  </table>
  <h5>Wall</h5>
  <table>
    <tr><td>Grid</td><td>the renders laid out by two settings - LoRA down, sampler across, or any
      other two. Newest first; gold ring picked, red deleted</td></tr>
    <tr><td>Click a picture</td><td>see it large - click again to close</td></tr>
    <tr><td>Click a row or column name</td><td>narrow to it</td></tr>
  </table>
  <h5>Framing</h5>
  <table>
    <tr><td>Detail map</td><td>where the edges and texture sit in the frame, all renders together;
      each dot is one render's centre of detail. Dashed lines are the thirds</td></tr>
    <tr><td>By cut</td><td>the same map for each cut, in story order</td></tr>
  </table>
  <h5>Look</h5>
  <table>
    <tr><td>Tone map</td><td>each dot one render: brightness across, contrast up, in the picture's
      own average colour. Gold ring picked, red ring deleted. Click a dot to go to its cut</td></tr>
    <tr><td>Story palette</td><td>the five main colours of each cut in story order, and the line
      under it how bright each cut is - the band is the middle half of its renders</td></tr>
  </table>
  <h5>Recipes</h5>
  <table>
    <tr><td>+6.2</td><td>renders with this value are 6.2 points brighter (on 0-100) than the
      renders beside them in the same cut without it</td></tr>
    <tr><td>&ndash;</td><td>never rendered beside the others in one cut, so nothing to compare</td></tr>
    <tr><td>Faded row</td><td>fewer than ten renders on one side: a hint, not a result</td></tr>
  </table>
  <h5>Verdicts</h5>
  <table>
    <tr><td>Gold / grey / red</td><td>picked / left as it is / deleted</td></tr>
    <tr><td>13% &nbsp;12/94 &nbsp;&minus;12%</td><td>share picked, picks of renders, share deleted</td></tr>
    <tr><td>ORDER / PICKED / DELETED</td><td>as first used, or by share picked or deleted</td></tr>
    <tr><td>Prompts tab: v1 &rsaquo; v2 &rsaquo; v3</td><td>a cut's prompt each time it was written again; the version of its
      first pick in gold, those before it dim</td></tr>
    <tr><td>What a rewrite changed</td><td>how often each anchor was written again, and how often that brought
      the cut its first pick</td></tr>
    <tr><td>History tab</td><td>every series in the order it was begun; &times; at the end of a row hides a
      test series from the series together and the history</td></tr>
    <tr><td>Left behind</td><td>an earlier version picked more often than the one the cut ended on</td></tr>
  </table>
  <h5>Narrowing</h5>
  <table>
    <tr><td>Click a cut, a bar, a row</td><td>count only those renders - click again to let go</td></tr>
    <tr><td>Right click a LoRA</td><td>count two file names as one LoRA, or apart again</td></tr>
  </table>
  <h5>Archived</h5>
  <table>
    <tr><td>archived</td><td>renders moved to a disk the report does not read - still counted
      as last seen, with their measures, times and small pictures</td></tr>
  </table>
  <h5>Buttons</h5>
  <table>
    <tr><td>LIVE</td><td>follow the work: each render as it is saved, a series opened
      in a Series Book, a folder opened in an Image Viewer</td></tr>
    <tr><td>SCAN</td><td>read and measure every render in the output folder that is not known yet</td></tr>
    <tr><td>CSV</td><td>the renders on show as a table, one line each, with their measures</td></tr>
  </table>
  <p style="margin:12px 0 0">Click anywhere, or ? again, to close.</p>
</div>`;

// ------------------------------------------------------------------ build
function buildReport(node) {
  ensureCSS();
  setDefaults(node);
  const P = node.properties;

  const root = el("div", "vsr");
  root.tabIndex = -1;

  const bar = el("div", "vsr-bar");
  const seriesSel = el("select", "vsr-series");
  seriesSel.title = "The season, episode or series on show";
  const liveBtn = el("button", "vsr-btn live", "Live");
  liveBtn.title = "Follow the work: each render as it is saved, a series opened in a Series Book, a folder opened in an Image Viewer";
  const scanBtn = el("button", "vsr-btn", "Scan");
  scanBtn.title = "Read and measure every render in the output folder that the report does not know yet";
  const csvBtn = el("button", "vsr-btn", "CSV");
  csvBtn.title = "The renders on show as a table";
  const helpBtn = el("button", "vsr-btn sq", "?");
  helpBtn.title = "What the report shows";
  const titleEl = el("div", "vsr-title", "Series Report");
  const titleN = el("span", "vsr-title-n", "");

  const bar2 = el("div", "vsr-bar2");
  const pathBox = el("div", "vsr-path");
  const filterBox = el("div", "vsr-filters");
  const info = el("div", "vsr-info");
  const sortSeg = el("div", "vsr-seg");
  const sortBtns = {};
  for (const [key, label, tip] of [
    ["order", "Order", "Listed as first used - nothing moves"],
    ["pick", "Picked", "Largest share picked first"],
    ["deleted", "Deleted", "Largest share deleted first"],
  ]) {
    const b = el("button", "vsr-btn", label);
    b.title = tip;
    b.addEventListener("click", () => { P.vsr_sort = key; paint(); });
    sortBtns[key] = b;
    sortSeg.append(b);
  }
  const toneSet = el("span", "vsr-tone-set");
  const hueDot = el("span", "vsr-dot");
  const light = el("input", "vsr-light");
  light.type = "range";
  light.min = "0";
  light.max = "100";
  light.step = "1";
  light.title = "Brightness of the report";
  toneSet.append(hueDot, light);
  bar.append(titleEl, titleN, el("span", "vsr-grow"), liveBtn, scanBtn, csvBtn, helpBtn);
  /* the scope on show, at the top of the frame: where, which series, what narrows it */
  const headTop = el("div", "vsr-head-top");
  headTop.append(pathBox, seriesSel);
  const headSub = el("div", "vsr-head-sub");
  headSub.append(filterBox, info);

  const tabsRow = el("div", "vsr-tabs");
  const tabBtns = {};
  for (const [key, label, tip] of TABS) {
    /* the tabs about every series stand apart, at the right, under a name */
    if (ACROSS.has(key) && !tabsRow.querySelector(".vsr-tacross")) {
      const sep = el("span", "vsr-tacross");
      sep.title = "These tabs look at every series of a period, whatever is on show above";
      tabsRow.append(sep);
    }
    const b = el("button", "vsr-tab" + (ACROSS.has(key) ? " across" : ""), label);
    b.title = tip;
    if (LATER.has(key)) b.classList.add("later");
    else b.addEventListener("click", () => { P.vsr_tab = key; P.vsr_tabs_open = true; S.sig = ""; paint(); refresh(); });
    tabBtns[key] = b;
    tabsRow.append(b);
  }

  const body = el("div", "vsr-body");
  const help = el("div", "vsr-help");
  help.innerHTML = HELP;
  const viewer = el("div", "vsr-view");
  const viewImg = el("img");
  const viewCap = el("div");
  viewer.append(viewImg, viewCap);
  viewer.addEventListener("click", () => { root.classList.remove("viewing"); viewImg.removeAttribute("src"); });
  /* two boxes with the node showing between them, as the Series Book's
     storyboard and its Drawer: the scope above, the analysis below */
  const main = el("div", "vsr-main");
  main.append(bar, body);
  root.append(main, help, viewer);
  const hideCard = hoverCards(root);

  /* the report's colour and how much of it shows, kept with the workflow */
  /* The report wears the Series Book's colour and brightness: read from the
     book on the canvas, and kept for when there is none. */
  function bookLook() {
    const nodes = (app.graph && (app.graph._nodes || app.graph.nodes)) || [];
    for (const n of nodes) {
      if ((n.comfyClass || n.type) !== BOOK) continue;
      for (const w of n.widgets || []) {
        const host = w.element && (w.element.querySelector(".lsb-book") || w.element);
        if (!host || !host.isConnected) continue;
        const cs = getComputedStyle(host);
        const bk = cs.getPropertyValue("--bk").trim();
        const bl = Number(cs.getPropertyValue("--bl").trim());
        if (bk && Number.isFinite(bl)) return { bk, bl };
      }
    }
    return null;
  }
  /* Each series' colour as the Series Book on the canvas wears it now - so a
     colour changed there shows here at once, as it does in the Series Lab,
     instead of after the book has saved it and the report asked again. */
  function bookTones() {
    const out = {};
    const nodes = (app.graph && (app.graph._nodes || app.graph.nodes)) || [];
    for (const n of nodes) {
      if ((n.comfyClass || n.type) !== BOOK) continue;
      for (const w of n.widgets || []) {
        if (!w.element) continue;
        for (const box of w.element.querySelectorAll(".lsb-pbox")) {
          const name = box.querySelector(".lsb-gname");
          const tone = box.style.getPropertyValue("--sg").trim()
            || (box.querySelector(".lsb-gtone") && box.querySelector(".lsb-gtone").style.getPropertyValue("--gt").trim());
          if (name && tone) out[name.textContent.trim()] = tone;
        }
      }
    }
    return out;
  }
  /* the series whose colour frames the page: the one on show, or a season's latest episode */
  function framedSeries() {
    const d = S.data;
    if (!d) return "";
    if (d.units_kind === "episode") {
      const u = (d.units || [])[d.units.length - 1];
      return u ? u.key : "";
    }
    return P.vsr_series && P.vsr_series !== ALL && !P.vsr_series.startsWith(SEASON) ? P.vsr_series : "";
  }
  function frameTone() {
    const name = framedSeries();
    const live = name && S.tones && S.tones[name];
    return live || seriesTone(S.data && S.data.series_hue);
  }
  function followTones() {
    S.tones = bookTones();
    const frame = body.querySelector(".vsr-frame");
    if (!frame) return;
    const tone = frameTone();
    if (frame.style.getPropertyValue("--sg").trim() !== tone) frame.style.setProperty("--sg", tone);
  }
  function followBook() {
    const look = bookLook();
    if (!look) return;
    if (look.bk === P.vsr_bk && Math.abs(look.bl - P.vsr_light) < 0.001) return;
    P.vsr_bk = look.bk;
    P.vsr_light = Math.max(0, Math.min(1, look.bl));
    paintTone();
  }
  function paintTone() {
    root.style.setProperty("--bk", P.vsr_bk || HUES[P.vsr_hue][1]);
    root.style.setProperty("--bl", String(P.vsr_light));
    const pct = Math.round(P.vsr_light * 100);
    light.value = String(pct);
    light.style.setProperty("--pct", `${pct}%`);
    hueDot.title = `Colour of the report: ${HUES[P.vsr_hue][0]} - click for the next one, Shift+click for the one before`;
    delete hueDot.dataset.tip;
  }
  hueDot.addEventListener("click", (e) => {
    const step = e.shiftKey ? -1 : 1;
    P.vsr_hue = (P.vsr_hue + step + HUES.length) % HUES.length;
    paintTone();
  });
  light.addEventListener("input", () => {
    P.vsr_light = Math.max(0, Math.min(1, Number(light.value) / 100));
    paintTone();
  });
  /* the slider is dragged, not the node */
  light.addEventListener("pointerdown", (e) => e.stopPropagation());
  paintTone();

  /* The node is as tall as what it shows, as the Series Book is: the page
     is laid out at its own height and the node made to fit it. */
  let fitH = 0;
  const domWidget = node.addDOMWidget("series_report", "LEIEL_SERIES_REPORT", root, {
    serialize: false,
    hideOnZoom: false,
    getMinHeight: () => fitH || 320,
    getMaxHeight: () => fitH || undefined,
  });
  let fitFrame = 0;
  function fitNode() {
    cancelAnimationFrame(fitFrame);
    fitFrame = requestAnimationFrame(() => {
      if (!root.isConnected) return;
      const h = Math.ceil(root.offsetHeight);
      if (!h || Math.abs(h - fitH) < 2) return;
      fitH = h;
      try {
        node.setSize([node.size[0], node.computeSize()[1]]);
        node.setDirtyCanvas(true, true);
      } catch (e) { /* a node being taken off the canvas */ }
    });
  }

  // ---- state
  const S = {
    data: null,         // the last summary
    sig: "",            // what was last drawn, to leave the page alone when nothing changed
    fresh: "",          // the cut the last render landed in
    freshSeries: "",    // and its episode
    busy: false,
    again: false,       // asked for while an answer was on its way
    listSig: null,
    scanning: false,
    dead: false,
    draws: [],          // canvases to draw again when the node is resized
  };
  let flashTimer = 0;
  let freshTimer = 0;
  let measureTimer = 0;

  /* the line under the path shows only when it has something to say */
  function syncHeadSub() {
    headSub.style.display = filterBox.textContent || info.textContent ? "" : "none";
  }

  function flash(text) {
    info.textContent = text;
    syncHeadSub();
    info.classList.add("flash");
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { info.classList.remove("flash"); paintInfo(); syncHeadSub(); }, 2600);
  }

  function paintInfo() {
    if (info.classList.contains("flash")) return;
    const d = S.data;
    if (d && d.looks && d.looks.left > 0) {
      info.textContent = `measuring · ${d.looks.left} left`;
      return;
    }
    const narrowed = d && d.filters && d.filters.some((f) => f.axis !== "scene");
    info.title = "";
    delete info.dataset.tip;
    if (d && d.archived && !narrowed) {
      info.textContent = `archived \u00b7 ${d.archived} renders kept from the ledger`;
      info.title = "These renders are no longer where the report reads - moved to another disk. "
        + "They are counted as they were last seen: picked, left or deleted.";
      return;
    }
    info.textContent = narrowed && d.totals ? `${d.totals.n} renders match` : "";
  }

  function filterIndex(axis, value) {
    return P.vsr_filters.findIndex((f) => f.axis === axis && f.value === value);
  }

  function toggleFilter(axis, value) {
    const at = filterIndex(axis, value);
    if (at >= 0) {
      P.vsr_filters.splice(at, 1);
      if (axis === "scene") P.vsr_filters = P.vsr_filters.filter((f) => f.axis !== "prompt");
    } else {
      /* one value of an axis at a time, except LoRAs, which stack */
      if (axis !== "lora") P.vsr_filters = P.vsr_filters.filter((f) => f.axis !== axis);
      /* a prompt version belongs to one cut */
      if (axis === "scene") P.vsr_filters = P.vsr_filters.filter((f) => f.axis !== "prompt");
      P.vsr_filters.push({ axis, value });
    }
    refresh();
  }

  /* go to a season, an episode or a series - the recipe filters stay, the
     cut is let go */
  function goTo(series) {
    if (series !== P.vsr_series) S.fresh = "";
    P.vsr_series = series;
    P.vsr_filters = P.vsr_filters.filter((f) => f.axis !== "scene" && f.axis !== "prompt");
    refresh();
  }

  function goCut(series, scene) {
    P.vsr_series = series;
    P.vsr_filters = P.vsr_filters.filter((f) => f.axis !== "scene" && f.axis !== "prompt");
    if (scene) P.vsr_filters.push({ axis: "scene", value: scene });
    refresh();
  }

  function openUnit(u) {
    if (S.data && S.data.units_kind === "episode") goTo(u.key);
    else toggleFilter("scene", u.key);
  }

  function axisLabel(axis) {
    const a = S.data && S.data.axes.find((x) => x.axis === axis);
    return a ? a.label : axis.replace(/^opt:(setting::)?/, "");
  }

  function cutUnit() {
    const f = P.vsr_filters.find((x) => x.axis === "scene");
    if (!f) return null;
    const u = S.data && (S.data.units || []).find((x) => x.key === f.value);
    return u || { key: f.value, no: "", name: f.value };
  }

  function paintPath() {
    pathBox.textContent = "";
    const d = S.data;
    const crumbs = ((d && d.path) || []).map((c) => ({ ...c }));
    const cut = cutUnit();
    if (cut) crumbs.push({ label: unitLabel(cut), title: cut.name, cut: true });
    if (!crumbs.length && d && d.series === ALL) crumbs.push({ label: "All series" });
    crumbs.forEach((c, i) => {
      if (i) pathBox.append(el("i", "", "›"));
      const last = i === crumbs.length - 1;
      const b = el("button", "vsr-crumb" + (last ? " last" : ""), c.label);
      b.title = c.title || c.label;
      if (!last && c.go !== undefined) b.addEventListener("click", () => goTo(c.go));
      pathBox.append(b);
    });
    /* what the last part is called: a cut's name, an episode's title */
    let sub = "";
    if (cut) sub = String(cut.name || "").replace(/^\s*C-\d+[A-Z]?\b\s*/i, "");
    else if (d && d.path && d.path.length) {
      const lastPart = d.path[d.path.length - 1];
      sub = String(lastPart.title || "").replace(/^\s*S\d+\s?E\d+\s*/i, "");
      if (sub === lastPart.label) sub = "";
    }
    if (sub) pathBox.append(el("span", "vsr-subtitle", sub));
  }

  function paintFilters() {
    filterBox.textContent = "";
    const shown = P.vsr_filters.filter((f) => f.axis !== "scene");
    if (!shown.length) return;
    for (const f of shown) {
      const chip = el("div", "vsr-chip");
      const lab = el("span", "", `${axisLabel(f.axis)}: `);
      lab.append(el("span", f.axis === "lora" ? "lora" : "",
        f.axis === "prompt" ? `v${f.value.split("|").pop()}` : f.value));
      chip.append(lab, el("b", "", "\u00d7"));
      chip.title = "Click to let go of this filter";
      chip.addEventListener("click", () => toggleFilter(f.axis, f.value));
      filterBox.append(chip);
    }
  }

  function paintControls() {
    liveBtn.classList.toggle("on", !!P.vsr_live);
    for (const k of Object.keys(sortBtns)) sortBtns[k].classList.toggle("on", P.vsr_sort === k);
    for (const k of Object.keys(tabBtns)) tabBtns[k].classList.toggle("on", P.vsr_tab === k);
    scanBtn.classList.toggle("busy", S.scanning);
  }

  function paintSeries() {
    const d = S.data || {};
    const nSeries = (d.all_series || []).filter((x) => x.name !== "").length;
    titleN.textContent = nSeries ? `${nSeries} series` : "";
    const list = d.all_series || [];
    const seasons = d.seasons || [];
    /* built again only when the list has changed, so an open dropdown is
       not pulled shut by a render landing */
    const sig = JSON.stringify([list, seasons]);
    if (sig !== S.listSig) {
      S.listSig = sig;
      seriesSel.textContent = "";
      for (const s of seasons) {
        const o = el("option", "", `Season ${s.season}  ·  ${s.n}`);
        o.value = SEASON + s.season;
        seriesSel.append(o);
        for (const e of list) {
          if (e.season !== s.season) continue;
          const oe = el("option", "", ` ${e.name}  ·  ${e.n}${e.archived ? "  ·  archived" : ""}`);
          oe.value = e.name;
          seriesSel.append(oe);
        }
      }
      for (const e of list) {
        if (e.season !== null && e.season !== undefined) continue;
        const o = el("option", "", `${e.name || "(no series)"}  ·  ${e.n}${e.archived ? "  ·  archived" : ""}`);
        o.value = e.name === "" ? NONE : e.name;
        seriesSel.append(o);
      }
      const all = el("option", "", "All series");
      all.value = ALL;
      seriesSel.append(all);
    }
    if (seriesSel.value !== P.vsr_series) seriesSel.value = P.vsr_series;
  }

  function split(t) {
    const f = document.createDocumentFragment();
    for (const [cls, n] of [["p", t.pick], ["k", t.kept], ["d", t.deleted]]) {
      if (!n) continue;
      const s = el("span", cls);
      s.style.flex = `${n} 0 0`;
      f.append(s);
    }
    return f;
  }

  function sorted(values) {
    if (P.vsr_sort === "order") return values;
    const key = P.vsr_sort === "pick" ? "pick" : "deleted";
    return values.slice().sort((a, b) => {
      if (a.thin !== b.thin) return a.thin ? 1 : -1;      // hints go last
      return b[key] / (b.n || 1) - a[key] / (a.n || 1);
    });
  }

  function tile(cls, label, value, sub) {
    const t = el("div", "vsr-tile " + cls);
    const b = el("b", "", String(value));
    if (sub) b.append(el("small", "", sub));
    t.append(el("em", "", label), b);
    return t;
  }

  function section(title, note, cls) {
    const sec = el("div", "vsr-sec" + (cls ? " " + cls : ""));
    const h = el("h6", "", title);
    if (note) h.append(el("i", "", note));
    sec.append(h);
    return sec;
  }

  function isSel(u) {
    return S.data.units_kind === "cut" && filterIndex("scene", u.key) >= 0;
  }

  /* a cut by its own number in the book - "C-04" from "C-04 From the High
     Balcony" - or the number the Series Lab wrote */
  function unitLabel(u) {
    const m = /^\s*(C-\d+[A-Z]?)\b/i.exec(u.name || "");
    return m ? m[1].toUpperCase() : (u.no || "\u2013");
  }

  function unitTitle(u) {
    /* a name that starts with its own number - "C-04 From the High Balcony" -
       is not given the number twice */
    const named = /^\s*C-\d+[A-Z]?\b/i.test(u.name || "") ? u.name : [u.no, u.name].filter(Boolean).join(" ");
    return `${named}\n${u.n} renders\n${u.pick} picked \u00b7 ${u.deleted} deleted \u00b7 ${u.kept} left`;
  }

  // ---- the overview: the strip, the four numbers, the story
  function paintStrip(d) {
    const units = d.units || [];
    if (!units.length) return;
    const episodes = d.units_kind === "episode";
    const sec = section(episodes ? "Episodes" : "Cuts",
      episodes ? "picks / renders in each - click one to open it"
        : "picks / renders in each - click one to look at it alone");
    const grid = el("div", "vsr-scenes");
    for (const u of units) {
      const c = el("div", "vsr-scene");
      if (isSel(u)) c.classList.add("sel");
      if (S.fresh === u.key || (episodes && S.freshSeries === u.key)) c.classList.add("fresh");
      const mark = el("div", "mini");
      mark.append(split(u));
      /* picks, large, over the renders they came from */
      const fig = el("b", "", String(u.pick));
      fig.append(el("small", "", `/${u.n}`));
      c.append(el("u", "", episodes ? (u.no || "\u2013") : unitLabel(u)), fig, mark);
      c.title = unitTitle(u);
      c.addEventListener("click", () => openUnit(u));
      grid.append(c);
    }
    sec.append(grid);
    body.append(sec);
  }

  function paintTiles(d) {
    const t = d.totals;
    const tiles = el("div", "vsr-tiles");
    tiles.style.margin = "10px 0 0";
    /* what one keeper costs: renders made for every pick */
    const per = t.pick ? t.n / t.pick : 0;
    const cost = tile("", "Renders per pick", t.pick ? (per < 10 ? per.toFixed(1) : String(Math.round(per))) : "\u2013");
    cost.title = t.pick
      ? `Renders per pick\n${t.n} renders for ${t.pick} picks - one keeper in every ${Math.round(per)} renders. Lower is a recipe that works sooner`
      : "Renders per pick\nNo pick yet among these renders";
    /* render time: written in the picture (exact), or read from when the files
       were saved (estimated) - an estimate is marked with ~ */
    const tm = d.time || {};
    const timed = (tm.exact || 0) + (tm.estimated || 0);
    const approx = tm.estimated ? "~" : "";
    const renders = tile("", "Renders", t.n, timed ? `${approx}${duration(tm.total)}` : "");
    const timeNote = timed
      ? `\n${tm.exact} with the time written in the picture, ${tm.estimated} estimated from when the files were saved`
        + (tm.none ? `, ${tm.none} with no time` : "")
        + `\nA render takes ${duration(tm.median)} in the middle`
      : "\nNo render time is known for these renders";
    renders.title = `Renders\n${t.n} renders` + (timed ? `, ${approx}${duration(tm.total)} of rendering` : "") + timeNote;
    if (t.pick && tm.per_pick) {
      cost.querySelector("b").append(el("small", "", `${approx}${duration(tm.per_pick)} a pick`));
      cost.title += `\nAbout ${duration(tm.per_pick)} of rendering for each pick`;
    }
    tiles.append(
      renders,
      tile("pick", "Picked", t.pick, `${pct(t.pick, t.n)}%`),
      tile("del", "Deleted", t.deleted, `${pct(t.deleted, t.n)}%`),
      cost);
    body.append(tiles);
  }

  /* what the Series Book says: the story of the episode on show, or the
     note of the cut narrowed to */
  function paintStory(d) {
    const cut = cutUnit();
    let head = "";
    let sub = "";
    let text = "";
    if (cut) {
      head = unitLabel(cut);
      sub = String(cut.name || "").replace(/^\s*C-\d+[A-Z]?\b\s*/i, "");
      text = cut.note || "";
      if (!text) text = "No note for this cut in the Series Book.";
    } else if (d.units_kind === "cut" && d.path && d.path.length) {
      const last = d.path[d.path.length - 1];
      head = last.label;
      sub = last.title && last.title !== last.label ? last.title : "";
      text = d.story || "";
      if (!text) text = "No story for this series in the Series Book.";
    } else return;
    /* at the foot of the frame, folding as the Series Book's notes do */
    const band = el("div", "vsr-fstory");
    if (!(cut ? cut.note : d.story)) band.classList.add("none");
    const sh = el("div", "sh");
    sh.title = P.vsr_story_open ? "Fold the story" : "Open the story";
    sh.append(el("span", "car", P.vsr_story_open ? "\u25BE" : "\u25B8"),
      el("b", "", cut ? `${head} \u00b7 Cut` : `${head} \u00b7 Story`));
    if (sub) sh.append(el("i", "", sub));
    sh.addEventListener("click", () => { P.vsr_story_open = !P.vsr_story_open; S.sig = ""; paint(); });
    band.append(sh);
    if (P.vsr_story_open) band.append(el("p", "", text));
    return band;
  }

  // ---- LOOK
  function paintLook(d) {
    const points = d.points || [];
    if (!points.length) {
      const e = el("div", "vsr-empty");
      if (d.looks && d.looks.left > 0) {
        e.append(el("b", "", "Measuring the pictures"),
          document.createTextNode(`${d.looks.left} to go - the page fills in as they are measured.`));
      } else {
        e.append(el("b", "", "Nothing to show"),
          document.createTextNode("No render on show could be opened and measured."));
      }
      body.append(e);
      return;
    }
    toneMap(points, d);
    if ((d.units || []).length) storyPalette(d);
    const legend = el("div", "vsr-legend");
    /* class names of our own: the page's stylesheet has a "ring" of its own */
    legend.append(el("span", "vsr-ldot", "dot colour: the picture's average colour"),
      el("span", "vsr-lring", "picked"), el("span", "vsr-lring vsr-ldel", "deleted"));
    body.append(legend);
  }

  function range(values, pad, span, lo, hi) {
    let a = Math.min(...values) - pad;
    let b = Math.max(...values) + pad;
    if (b - a < span) {
      const mid = (a + b) / 2;
      a = mid - span / 2;
      b = mid + span / 2;
    }
    a = Math.max(lo, Math.floor(a / 5) * 5);
    b = Math.min(hi, Math.ceil(b / 5) * 5);
    return [a, b];
  }

  function median(values) {
    const v = values.slice().sort((x, y) => x - y);
    if (!v.length) return 0;
    const m = v.length >> 1;
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  }

  function canvasFor(wrap, canvas) {
    const w = wrap.clientWidth || canvas.clientWidth;
    const h = canvas.clientHeight || wrap.clientHeight;
    if (!w || !h) return null;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext && canvas.getContext("2d");
    if (!ctx) return null;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  }

  function toneMap(points, d) {
    const sec = section("Tone map", "brightness across, contrast up - each dot one render");
    const wrap = el("div", "vsr-tone");
    const canvas = el("canvas");
    const tip = el("div", "vsr-tip");
    wrap.append(canvas, tip);
    sec.append(wrap);
    body.append(sec);

    /* with a cut chosen, the other cuts' renders are kept aside: pointing at
       one in the palette brings it up beside the chosen one */
    const beside = d.points_beside || null;
    const span = beside && beside.length ? beside : points;
    const [x0, x1] = range(span.map((p) => p.b), 3, 25, 0, 100);
    const [y0, y1] = range(span.map((p) => p.c), 2, 12, 0, 100);
    const mx = median(points.map((p) => p.b));
    const my = median(points.map((p) => p.c));
    /* picks last, so a ring is never hidden under a plain dot */
    const order = { kept: 0, deleted: 1, pick: 2 };
    const drawn = points.slice().sort((a, b) => order[a.st] - order[b.st]);
    const M = { l: 30, r: 10, t: 10, b: 22 };
    let placed = [];
    /* a cut or an episode pointed at in the story palette: its renders are
       drawn on top, the rest faded */
    let hiKey = null;
    const isHi = (p) => (d.units_kind === "episode" ? p.se : p.sc) === hiKey;

    function draw() {
      const c = canvasFor(wrap, canvas);
      if (!c) return;
      const { ctx, w, h } = c;
      const X = (v) => M.l + ((v - x0) / (x1 - x0 || 1)) * (w - M.l - M.r);
      const Y = (v) => h - M.b - ((v - y0) / (y1 - y0 || 1)) * (h - M.t - M.b);
      ctx.font = "10px system-ui,sans-serif";
      ctx.lineWidth = 1;
      const xstep = x1 - x0 > 50 ? 10 : 5;
      const ystep = y1 - y0 > 30 ? 10 : 5;
      ctx.fillStyle = "#5d626b";
      ctx.strokeStyle = "#1f2125";
      ctx.textAlign = "center";
      for (let v = Math.ceil(x0 / xstep) * xstep; v <= x1; v += xstep) {
        ctx.beginPath(); ctx.moveTo(X(v) + 0.5, M.t); ctx.lineTo(X(v) + 0.5, h - M.b); ctx.stroke();
        ctx.fillText(String(v), X(v), h - 8);
      }
      ctx.textAlign = "right";
      for (let v = Math.ceil(y0 / ystep) * ystep; v <= y1; v += ystep) {
        ctx.beginPath(); ctx.moveTo(M.l, Y(v) + 0.5); ctx.lineTo(w - M.r, Y(v) + 0.5); ctx.stroke();
        ctx.fillText(String(v), M.l - 5, Y(v) + 3);
      }
      ctx.fillStyle = "#7d828b";
      ctx.textAlign = "right";
      ctx.fillText("brighter →", w - M.r - 2, h - M.b - 5);
      ctx.textAlign = "left";
      ctx.fillText("↑ more contrast", M.l + 5, M.t + 10);
      /* the middle of what is on show */
      ctx.save();
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = "#3a3e46";
      ctx.beginPath(); ctx.moveTo(X(mx) + 0.5, M.t); ctx.lineTo(X(mx) + 0.5, h - M.b); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(M.l, Y(my) + 0.5); ctx.lineTo(w - M.r, Y(my) + 0.5); ctx.stroke();
      ctx.restore();
      const r0 = drawn.length > 600 ? 2.6 : drawn.length > 200 ? 3.2 : 3.8;
      placed = [];
      let list = drawn;
      if (hiKey !== null) {
        const lit = beside ? beside.filter(isHi).sort((a, b) => order[a.st] - order[b.st]) : drawn.filter(isHi);
        list = drawn.filter((p) => !isHi(p)).concat(lit);
      }
      for (const p of list) {
        const px = X(p.b);
        const py = Y(p.c);
        const lit = hiKey === null || isHi(p);
        const r = hiKey !== null && lit ? r0 + 1.2 : r0;
        ctx.globalAlpha = lit ? 1 : 0.12;
        if (lit) placed.push([px, py, p]);
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fillStyle = p.avg;
        ctx.fill();
        if (p.st === "pick" || p.st === "deleted") {
          ctx.lineWidth = 1.6;
          ctx.strokeStyle = p.st === "pick" ? PICK : DEL;
          ctx.beginPath();
          ctx.arc(px, py, r + 1.3, 0, Math.PI * 2);
          ctx.stroke();
        } else {
          ctx.lineWidth = hiKey !== null && lit ? 1.2 : 0.8;
          ctx.strokeStyle = hiKey !== null && lit ? "#eef0f3" : "rgba(0,0,0,.65)";
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    }
    S.toneHi = (key) => {
      if (key === hiKey) return;
      hiKey = key;
      try { draw(); } catch (e) { /* the page has moved on */ }
    };

    function hit(e) {
      const box = canvas.getBoundingClientRect();
      const x = e.clientX - box.left;
      const y = e.clientY - box.top;
      let best = null;
      let bd = 81;
      for (let i = placed.length - 1; i >= 0; i--) {
        const [px, py, p] = placed[i];
        const dd = (px - x) ** 2 + (py - y) ** 2;
        if (dd < bd) { bd = dd; best = [px, py, p]; }
      }
      return best;
    }

    canvas.addEventListener("mousemove", (e) => {
      const h = hit(e);
      if (!h) { tip.style.display = "none"; canvas.style.cursor = "crosshair"; return; }
      const [px, py, p] = h;
      canvas.style.cursor = "pointer";
      const where = [d.units_kind === "episode" ? p.se : "", p.no, p.nm].filter(Boolean).join("  ");
      const state = p.st === "pick" ? "  ·  picked" : p.st === "deleted" ? "  ·  deleted" : "";
      fillTip(tip, `${where || p.f}\n${where ? p.f : ""}${state}\n`
        + `brightness ${Math.round(p.b)}  \u00b7  contrast ${Math.round(p.c)}\n`
        + `saturation ${Math.round(p.s)}  \u00b7  warmth ${signed(p.w)}`);
      tip.style.display = "block";
      const tw = tip.offsetWidth || 200;
      const th = tip.offsetHeight || 60;
      const ww = wrap.clientWidth;
      tip.style.left = `${Math.max(4, Math.min(px + 12, ww - tw - 4))}px`;
      tip.style.top = `${py - th - 10 < 4 ? py + 12 : py - th - 10}px`;
    });
    canvas.addEventListener("mouseleave", () => { tip.style.display = "none"; });
    canvas.addEventListener("click", (e) => {
      const h = hit(e);
      if (h && h[2].sc) goCut(h[2].se, h[2].sc);
    });
    S.draws.push(draw);
  }

  function storyPalette(d) {
    const units = d.units;
    const episodes = d.units_kind === "episode";
    const sec = section("Story palette",
      `the five main colours of each ${episodes ? "episode" : "cut"} in story order - point at one to find it above`);
    const cols = el("div", "vsr-story");
    const labels = el("div", "vsr-labels");
    const tmpl = `repeat(${units.length}, minmax(0, 1fr))`;
    cols.style.gridTemplateColumns = tmpl;
    labels.style.gridTemplateColumns = tmpl;
    for (const u of units) {
      const look = u.look || {};
      const col = el("div", "vsr-col");
      if (!look.m) col.classList.add("none");
      if (isSel(u)) col.classList.add("sel");
      /* light at the top, dark at the bottom, each as tall as its share */
      const pal = (look.pal || []).slice().sort((a, b) => lightness(b[0]) - lightness(a[0]));
      for (const [hex, share] of pal) {
        const s = el("span");
        s.style.background = hex;
        s.style.height = `${(share * 100).toFixed(2)}%`;
        col.append(s);
      }
      col.title = unitTitle(u);
      col.addEventListener("click", () => openUnit(u));
      col.addEventListener("mouseenter", () => S.toneHi && S.toneHi(u.key));
      col.addEventListener("mouseleave", () => S.toneHi && S.toneHi(null));
      cols.append(col);
      const lab = el("span", isSel(u) ? "sel" : "", episodes ? (u.no || "\u2013") : unitLabel(u));
      const rest = episodes ? String(u.name || "").replace(/^\s*S\d+\s?E\d+\s*/i, "")
        : String(u.name || "").replace(/^\s*C-\d+[A-Z]?\b\s*/i, "");
      if (rest) lab.append(el("small", "", rest));
      lab.title = unitTitle(u);
      lab.addEventListener("click", () => openUnit(u));
      lab.addEventListener("mouseenter", () => S.toneHi && S.toneHi(u.key));
      lab.addEventListener("mouseleave", () => S.toneHi && S.toneHi(null));
      labels.append(lab);
    }
    const canvas = el("canvas", "vsr-curve");
    sec.append(cols, labels, canvas);
    body.append(sec);

    const measured = units.filter((u) => u.look && u.look.m);
    const lows = measured.map((u) => u.look.b25);
    const highs = measured.map((u) => u.look.b75);
    const [y0, y1] = measured.length ? range(lows.concat(highs), 2, 20, 0, 100) : [0, 100];

    function draw() {
      const c = canvasFor(cols, canvas);
      if (!c) return;
      const { ctx, w, h } = c;
      const n = units.length;
      const gap = 3;
      const cw = (w - gap * (n - 1)) / n;
      const cx = (i) => i * (cw + gap) + cw / 2;
      const Y = (v) => h - 12 - ((v - y0) / (y1 - y0 || 1)) * (h - 22);
      ctx.font = "10px system-ui,sans-serif";
      ctx.fillStyle = "#5d626b";
      ctx.textAlign = "left";
      ctx.fillText(`brightness ${y0}–${y1}`, 2, 9);
      /* the middle half of each cut's renders */
      ctx.fillStyle = "#2a2d33";
      units.forEach((u, i) => {
        if (!u.look || !u.look.m) return;
        const bw = Math.min(cw * 0.5, 14);
        ctx.fillRect(cx(i) - bw / 2, Y(u.look.b75), bw, Math.max(1.5, Y(u.look.b25) - Y(u.look.b75)));
      });
      ctx.strokeStyle = "#cfd2d8";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      let started = false;
      units.forEach((u, i) => {
        if (!u.look || !u.look.m) { started = false; return; }
        if (!started) { ctx.moveTo(cx(i), Y(u.look.b)); started = true; } else ctx.lineTo(cx(i), Y(u.look.b));
      });
      ctx.stroke();
      units.forEach((u, i) => {
        if (!u.look || !u.look.m) return;
        ctx.beginPath();
        ctx.arc(cx(i), Y(u.look.b), isSel(u) ? 3.6 : 2.6, 0, Math.PI * 2);
        ctx.fillStyle = isSel(u) ? PICK : "#cfd2d8";
        ctx.fill();
      });
    }
    S.draws.push(draw);
  }

  // ---- WALL: the renders laid out by two settings
  function thumbURL(fp, side) {
    const path = `${THUMB_URL}?fp=${encodeURIComponent(fp)}&s=${side}`;
    return api.apiURL ? api.apiURL(path) : "/api" + path;
  }

  function showPicture(it, ar) {
    viewImg.className = it.st === "pick" || it.st === "deleted" ? it.st : "";
    viewImg.src = thumbURL(it.fp, 960);
    const state = it.st === "pick" ? "  \u00b7  picked" : it.st === "deleted" ? "  \u00b7  deleted" : "";
    viewCap.textContent = `${[it.no, it.nm].filter(Boolean).join("  ")}\n${it.f}${state}`;
    root.classList.add("viewing");
  }

  function axisName(choices, axis) {
    const c = (choices || []).find((x) => x.axis === axis);
    return c ? c.label : axis;
  }

  function paintWall(d) {
    const w = d.wall;
    if (!w || !w.rows) {
      const e = el("div", "vsr-empty");
      e.append(el("b", "", "Nothing to lay out"),
        document.createTextNode("The wall needs a setting that took at least two values among the renders on show - two LoRAs, two samplers."));
      body.append(e);
      return;
    }
    const wb = el("div", "vsr-wallbar");
    const pick = (which) => {
      const sel = el("select");
      for (const c of w.choices) {
        const o = el("option", "", `${c.label} (${c.n})`);
        o.value = c.axis;
        sel.append(o);
      }
      if (which === "cols") {
        const o = el("option", "", "nothing - one column");
        o.value = "-";
        sel.append(o);
      }
      sel.value = w[which] || (which === "cols" ? "-" : "");
      sel.addEventListener("change", () => {
        P.vsr_wall = { ...P.vsr_wall, [which]: sel.value };
        if (which === "rows" && sel.value === w.cols) P.vsr_wall.cols = "";
        refresh();
      });
      return sel;
    };
    wb.append(el("label", "", "Rows"), pick("rows"), el("label", "", "Columns"), pick("cols"));
    const key = el("div", "vsr-wallkey");
    const swatch = (cls, text) => {
      const sp = el("span");
      sp.append(el("i", cls), document.createTextNode(text));
      return sp;
    };
    key.append(swatch("pick", "picked"), swatch("deleted", "deleted"), swatch("", "left as it is"),
      el("span", "", "\u00b7  newest first, up to 12 a cell"), el("span", "", "\u00b7  click a picture to see it large"),
      el("span", "", "\u00b7  click a row or column name to narrow"));
    const panel = el("div", "vsr-wallbox");
    panel.append(wb, key);
    body.append(panel);

    const cols = w.col_values;
    const grid = el("div", "vsr-wall");
    grid.style.gridTemplateColumns = `minmax(64px, 15%) repeat(${cols.length}, minmax(0, 1fr))`;
    grid.append(el("div"));
    for (const c of cols) {
      const h = el("div", "vsr-wh" + (w.cols === "lora" ? " lora" : ""), c || axisName(w.choices, w.rows));
      if (w.cols && c) {
        if (filterIndex(w.cols, c) >= 0) h.classList.add("sel");
        h.title = `Count only renders with ${c}`;
        h.addEventListener("click", () => toggleFilter(w.cols, c));
      }
      grid.append(h);
    }
    w.row_values.forEach((r, ri) => {
      const rh = el("div", "vsr-wr" + (w.rows === "lora" ? " lora" : ""), r);
      if (filterIndex(w.rows, r) >= 0) rh.classList.add("sel");
      rh.title = `Count only renders with ${r}`;
      rh.addEventListener("click", () => toggleFilter(w.rows, r));
      grid.append(rh);
      cols.forEach((c, ci) => {
        const cell = w.cells[`${ri}|${ci}`];
        const box = el("div", "vsr-wc");
        if (!cell) {
          box.classList.add("empty");
          box.title = "Never rendered this way";
          grid.append(box);
          return;
        }
        const h = el("div", "h");
        h.append(el("span", "", `${cell.n}`), el("b", "", cell.pick ? `${cell.pick} picked` : ""),
          el("s", "", cell.deleted ? `${cell.deleted} deleted` : ""));
        const th = el("div", "vsr-thumbs");
        for (const it of cell.items) {
          const t = el("div", "vsr-th");
          if (it.st === "pick" || it.st === "deleted") t.classList.add(it.st);
          const img = el("img");
          img.loading = "lazy";
          img.decoding = "async";
          img.src = thumbURL(it.fp, 200);
          img.addEventListener("load", () => { if (img.naturalWidth > img.naturalHeight) t.classList.add("land"); });
          t.append(img);
          t.title = `${[it.no, it.nm].filter(Boolean).join(" ")}\n${it.f}`;
          t.addEventListener("click", () => showPicture(it));
          th.append(t);
        }
        if (cell.n > cell.items.length) th.append(el("span", "vsr-more", `+${cell.n - cell.items.length}`));
        box.append(h, th);
        grid.append(box);
      });
    });
    /* the one part that scrolls: a whole series of pictures would make the
       node taller than any screen */
    const scroller = el("div", "vsr-wallscroll");
    scroller.append(grid);
    body.append(scroller);
  }

  // ---- FRAMING: where the detail sits
  function drawGrid(canvas, grid, ar, dots, opts) {
    const w = canvas.clientWidth || canvas.parentElement.clientWidth;
    if (!w) return null;
    const h = Math.round(w * (ar || 1.5));
    canvas.style.height = `${h}px`;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext && canvas.getContext("2d");
    if (!ctx) return null;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#0f1012";
    ctx.fillRect(0, 0, w, h);
    const n = Math.round(Math.sqrt(grid.length));
    const lo = Math.min(...grid);
    const hi = Math.max(...grid);
    const cw = w / n;
    const ch = h / n;
    for (let i = 0; i < grid.length; i++) {
      const a = hi > lo ? (grid[i] - lo) / (hi - lo) : 0;
      ctx.fillStyle = `rgba(217,178,106,${(0.06 + 0.8 * a).toFixed(3)})`;
      ctx.fillRect((i % n) * cw, Math.floor(i / n) * ch, cw + 0.5, ch + 0.5);
    }
    /* thirds */
    ctx.strokeStyle = "rgba(255,255,255,.14)";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    for (const f of [1 / 3, 2 / 3]) {
      ctx.beginPath(); ctx.moveTo(w * f, 0); ctx.lineTo(w * f, h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, h * f); ctx.lineTo(w, h * f); ctx.stroke();
    }
    ctx.setLineDash([]);
    const placed = [];
    for (const p of dots || []) {
      const x = p.cx * w;
      const y = p.cy * h;
      placed.push([x, y, p]);
      const r = (opts && opts.r) || 3.2;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = p.avg || "#eef0f3";
      ctx.fill();
      if (p.st === "pick" || p.st === "deleted") {
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = p.st === "pick" ? PICK : DEL;
        ctx.beginPath(); ctx.arc(x, y, r + 1.2, 0, Math.PI * 2); ctx.stroke();
      } else {
        ctx.lineWidth = 0.8;
        ctx.strokeStyle = "rgba(0,0,0,.7)";
        ctx.stroke();
      }
    }
    return { placed, w, h };
  }

  function paintFraming(d) {
    const f = d.frame;
    if (!f) {
      const e = el("div", "vsr-empty");
      if (d.looks && d.looks.left > 0) {
        e.append(el("b", "", "Measuring the pictures"),
          document.createTextNode(`${d.looks.left} to go - the map fills in as they are measured.`));
      } else {
        e.append(el("b", "", "Nothing to show"), document.createTextNode("No render on show has a detail map yet."));
      }
      body.append(e);
      return;
    }
    const sec = section("Detail map", "gold is more detail - each dot is one render's centre");
    const wrap = el("div", "vsr-detail");
    const mapBox = el("div", "map");
    const canvas = el("canvas");
    const tip = el("div", "vsr-tip");
    mapBox.append(canvas, tip);
    const stat = el("div", "vsr-stat");
    const share = pct(f.centred, f.n);
    const p1 = el("p");
    p1.append(el("b", "", `${share}%`), document.createTextNode("of the renders have their detail in the middle ninth of the frame - the subject in the centre."));
    const dots = (d.points || []).filter((p) => p.cx !== undefined);
    const left = dots.filter((p) => p.cx < 1 / 3).length;
    const right = dots.filter((p) => p.cx > 2 / 3).length;
    const p2 = el("p");
    p2.append(el("b", "", `${pct(left, dots.length)}% \u00b7 ${pct(right, dots.length)}%`),
      document.createTextNode("sit in the left third \u00b7 the right third."));
    stat.append(p1, p2);
    const keyBox = el("div", "vsr-key");
    const keyRow = (style, cls, text) => {
      const row = el("div");
      const sw = el("i", cls || "");
      if (style) sw.style.cssText = style;
      row.append(sw, el("span", "", text));
      keyBox.append(row);
    };
    keyRow("background:rgba(217,178,106,.86)", "", "bright gold - the most detail: texture, faces, edges, what draws the eye");
    keyRow("background:rgba(217,178,106,.45)", "", "mid gold - some detail");
    keyRow("background:rgba(217,178,106,.08);box-shadow:inset 0 0 0 1px #33363d", "",
      "dark - little detail: sky, plain wall, smooth fabric, deep shadow");
    keyRow("background:#8a7a6a;box-shadow:0 0 0 1px rgba(0,0,0,.7)", "dot", "a dot - one render's centre of detail, in its average colour");
    keyRow("background:#8a7a6a;box-shadow:0 0 0 1.5px #d9b26a", "dot", "gold ring - picked");
    keyRow("background:#8a7a6a;box-shadow:0 0 0 1.5px #c8645a", "dot", "red ring - deleted");
    keyRow("", "line", "dashed lines - the thirds of the frame");
    const note = el("p", "", "Gold is read against the rest of the same map, not on a fixed scale. "
      + "In the maps by cut, the white dot is the cut's centre. Click a dot to go to its cut.");
    note.style.margin = "10px 0 0";
    stat.append(keyBox, note);
    wrap.append(mapBox, stat);
    sec.append(wrap);
    body.append(sec);
    let placed = [];
    S.draws.push(() => {
      const r = drawGrid(canvas, f.grid, f.ar, dots, { r: dots.length > 300 ? 2.4 : 3.2 });
      placed = r ? r.placed : [];
    });
    const hit = (e) => {
      const box = canvas.getBoundingClientRect();
      const x = e.clientX - box.left;
      const y = e.clientY - box.top;
      let best = null;
      let bd = 64;
      for (const q of placed) {
        const dd = (q[0] - x) ** 2 + (q[1] - y) ** 2;
        if (dd < bd) { bd = dd; best = q; }
      }
      return best;
    };
    canvas.addEventListener("mousemove", (e) => {
      const h = hit(e);
      if (!h) { tip.style.display = "none"; return; }
      const p = h[2];
      fillTip(tip, `${[p.no, p.nm].filter(Boolean).join("  ") || p.f}\n${p.f}`);
      tip.style.display = "block";
      tip.style.left = `${Math.min(h[0] + 10, mapBox.clientWidth - (tip.offsetWidth || 160))}px`;
      tip.style.top = `${h[1] + 10}px`;
    });
    canvas.addEventListener("mouseleave", () => { tip.style.display = "none"; });
    canvas.addEventListener("click", (e) => {
      const h = hit(e);
      if (h && h[2].sc) goCut(h[2].se, h[2].sc);
    });

    const units = (d.units || []).filter((u) => u.look && u.look.grid);
    if (!units.length) return;
    const episodes = d.units_kind === "episode";
    const sec2 = section(episodes ? "Framing by episode" : "Framing by cut",
      "in story order - a row of maps alike is a row of pictures framed alike");
    const strip = el("div", "vsr-frames");
    for (const u of units) {
      const fr = el("div", "vsr-fr");
      if (isSel(u)) fr.classList.add("sel");
      const c = el("canvas");
      fr.append(c, el("span", "", episodes ? (u.no || "\u2013") : unitLabel(u)));
      fr.title = unitTitle(u);
      fr.addEventListener("click", () => openUnit(u));
      strip.append(fr);
      S.draws.push(() => drawGrid(c, u.look.grid, u.look.ar || f.ar, [{ cx: u.look.cx, cy: u.look.cy, avg: "#eef0f3" }], { r: 2.6 }));
    }
    sec2.append(strip);
    body.append(sec2);
  }

  // ---- TIME: how long the renders took
  function paintTime(d) {
    const tm = d.time || {};
    const units = d.units || [];
    const log = d.timeline || [];
    if (!log.length) {
      const e = el("div", "vsr-empty");
      e.append(el("b", "", "No render time yet"),
        document.createTextNode("Renders made with the Visual Suite carry their render time. Older ones are timed from "
          + "when their files were saved, when they were saved one after another."));
      body.append(e);
      return;
    }
    const episodes = d.units_kind === "episode";

    /* where the hours went */
    if (units.some((u) => u.time && u.time.total)) {
      const sec = section(episodes ? "Time by episode" : "Time by cut",
        "all the rendering each one took - longest in gold, shortest in blue; under each, the time for one pick - point at one to find it below");
      const cols = el("div", "vsr-tcols");
      const labels = el("div", "vsr-tlabels");
      const tmpl = `repeat(${units.length}, minmax(0, 1fr))`;
      cols.style.gridTemplateColumns = tmpl;
      labels.style.gridTemplateColumns = tmpl;
      const most = Math.max(1, ...units.map((u) => (u.time && u.time.total) || 0));
      const ranks = ranked(units, (u) => u.time && u.time.total, (u) => u.key);
      for (const u of units) {
        const t = u.time || {};
        const col = el("div", "vsr-tcol");
        if (isSel(u)) col.classList.add("sel");
        const timed = (t.exact || 0) + (t.estimated || 0);
        const mark = t.estimated ? "~" : "";
        col.append(el("div", "v", t.total ? `${mark}${duration(t.total)}` : ""));
        const bar = el("div", "bar");
        bar.style.height = `${Math.max(1, (88 * (t.total || 0)) / most)}%`;
        /* the written part below, the estimated part on top */
        const part = (n) => (timed ? (100 * n) / timed : 0);
        const es = el("span", "es");
        es.style.height = `${part(t.estimated || 0)}%`;
        const ex = el("span", "ex");
        ex.style.height = `${part(t.exact || 0)}%`;
        const tone = rankTone(ranks, u.key);
        if (tone) {
          ex.style.background = tone;
          es.style.background = `${tone}66`;
          col.firstChild.style.color = tone;
          col.firstChild.style.fontWeight = "700";
        }
        bar.append(es, ex);
        col.append(bar);
        col.title = `${unitTitle(u).split("\n")[0]}\n${mark}${duration(t.total || 0)} of rendering, ${u.n} renders`
          + (t.per_pick ? `\n${mark}${duration(t.per_pick)} for each pick` : "\nNo pick yet")
          + `\n${t.exact || 0} written, ${t.estimated || 0} estimated` + (t.none ? `, ${t.none} with no time` : "");
        col.addEventListener("click", () => openUnit(u));
        col.addEventListener("mouseenter", () => S.logHi && S.logHi(u.key));
        col.addEventListener("mouseleave", () => S.logHi && S.logHi(null));
        cols.append(col);
        const lab = el("span", isSel(u) ? "sel" : "", episodes ? (u.no || "\u2013") : unitLabel(u));
        lab.append(el("small", "", t.per_pick ? `${mark}${duration(t.per_pick)}` : "\u2013"));
        lab.style.cursor = "pointer";
        lab.addEventListener("click", () => openUnit(u));
        lab.addEventListener("mouseenter", () => S.logHi && S.logHi(u.key));
        lab.addEventListener("mouseleave", () => S.logHi && S.logHi(null));
        labels.append(lab);
      }
      sec.append(cols, labels);
      body.append(sec);
    }

    /* one render after another */
    const sec2 = section("Render log", "each dot one render, in the order they were saved - height is how long it took");
    const wrap = el("div", "vsr-log");
    const canvas = el("canvas");
    const tip = el("div", "vsr-tip");
    wrap.append(canvas, tip);
    sec2.append(wrap);
    const key = el("div", "vsr-tkey");
    const sw = (style, text) => {
      const sp = el("span");
      const i = el("i");
      i.style.cssText = style;
      sp.append(i, document.createTextNode(text));
      return sp;
    };
    key.append(sw("background:#b9bfca;border-radius:50%;width:9px;height:9px", "written in the picture"),
      sw("border:1px solid #8f96a3;border-radius:50%;width:9px;height:9px", "estimated"),
      sw("background:#b9bfca;border-radius:50%;width:9px;height:9px;box-shadow:0 0 0 1.5px #d9b26a", "picked"),
      sw("background:#b9bfca;border-radius:50%;width:9px;height:9px;box-shadow:0 0 0 1.5px #c8645a", "deleted"),
      sw(`background:${RANK_GOLD[0]};border-radius:50%;width:9px;height:9px`, "slowest"),
      sw(`background:${RANK_BLUE[0]};border-radius:50%;width:9px;height:9px`, "fastest - brightest first"),
      el("span", "", "dashed - a new day"));
    sec2.append(key);
    body.append(sec2);

    const sorted = log.map((p) => p.s).slice().sort((a, b) => a - b);
    const top = Math.max(10, sorted[Math.floor(sorted.length * 0.97)] * 1.15 || 10);
    const mid = sorted[Math.floor(sorted.length / 2)] || 0;
    let placed = [];
    /* a cut or an episode pointed at above: its renders lit, the rest faded */
    let hiKey = null;
    const isHi = (p) => (episodes ? p.se : p.sc) === hiKey;
    const drawLog = () => {
      const c = canvasFor(wrap, canvas);
      if (!c) return;
      const { ctx, w, h } = c;
      const M = { l: 38, r: 10, t: 10, b: 20 };
      const X = (i) => M.l + (log.length > 1 ? (i / (log.length - 1)) * (w - M.l - M.r) : (w - M.l - M.r) / 2);
      const Y = (v) => h - M.b - (Math.min(v, top) / top) * (h - M.t - M.b);
      ctx.font = "10px system-ui,sans-serif";
      ctx.textAlign = "right";
      ctx.lineWidth = 1;
      const step = top > 600 ? 300 : top > 240 ? 60 : top > 90 ? 30 : 10;
      for (let v = 0; v <= top; v += step) {
        ctx.strokeStyle = "#1f2125";
        ctx.beginPath(); ctx.moveTo(M.l, Y(v) + 0.5); ctx.lineTo(w - M.r, Y(v) + 0.5); ctx.stroke();
        ctx.fillStyle = "#5d626b";
        ctx.fillText(tick(v), M.l - 5, Y(v) + 3);
      }
      /* the middle render time */
      ctx.save();
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = "#3a3e46";
      ctx.beginPath(); ctx.moveTo(M.l, Y(mid) + 0.5); ctx.lineTo(w - M.r, Y(mid) + 0.5); ctx.stroke();
      /* a new day */
      ctx.strokeStyle = "rgba(255,255,255,.12)";
      ctx.textAlign = "left";
      let day = "";
      log.forEach((p, i) => {
        const dt = new Date(p.at * 1000);
        const dd = `${dt.getMonth() + 1}/${dt.getDate()}`;
        if (dd !== day) {
          if (day) { ctx.beginPath(); ctx.moveTo(X(i) + 0.5, M.t); ctx.lineTo(X(i) + 0.5, h - M.b); ctx.stroke(); }
          ctx.fillStyle = "#6f747d";
          ctx.fillText(dd, X(i) + 3, h - 6);
          day = dd;
        }
      });
      ctx.restore();
      const r0 = log.length > 800 ? 2 : log.length > 300 ? 2.6 : 3.2;
      placed = [];
      const ranks = ranked(log, (p) => p.s, (p) => p);
      /* the ranked ones drawn last, on top - and a pointed-at cut above all */
      const weight = (p) => (hiKey !== null && isHi(p) ? 2 : 0) + (rankTone(ranks, p) ? 1 : 0);
      const order = log.map((p, i) => [p, i]);
      order.sort((a, b) => weight(a[0]) - weight(b[0]));
      order.forEach(([p, i]) => {
        const x = X(i);
        const y = Y(p.s);
        const tone = rankTone(ranks, p);
        const lit = hiKey === null || isHi(p);
        const r = (tone ? r0 + 1.4 : r0) + (hiKey !== null && lit ? 0.8 : 0);
        ctx.globalAlpha = lit ? 1 : 0.12;
        if (lit) placed.push([x, y, p]);
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        if (p.x) {
          ctx.fillStyle = tone || "#b9bfca";
          ctx.fill();
        } else {
          ctx.lineWidth = tone ? 1.6 : 1;
          ctx.strokeStyle = tone || "#8f96a3";
          ctx.stroke();
        }
        if (p.st === "pick" || p.st === "deleted") {
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = p.st === "pick" ? PICK : DEL;
          ctx.beginPath(); ctx.arc(x, y, r + 1.4, 0, Math.PI * 2); ctx.stroke();
        }
        if (p.s > top) {
          ctx.fillStyle = "#c8645a";
          ctx.fillText("\u2191", x - 3, M.t + 8);
        }
      });
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#7d828b";
      ctx.textAlign = "right";
      ctx.fillText(`middle ${tick(mid)}`, w - M.r - 4, Y(mid) - 4);
    };
    S.draws.push(drawLog);
    S.logHi = (key) => {
      if (key === hiKey) return;
      hiKey = key;
      try { drawLog(); } catch (e) { /* the page has moved on */ }
    };
    const hit = (e) => {
      const box = canvas.getBoundingClientRect();
      const x = e.clientX - box.left;
      const y = e.clientY - box.top;
      let best = null;
      let bd = 64;
      for (const q of placed) {
        const dd = (q[0] - x) ** 2 + (q[1] - y) ** 2;
        if (dd < bd) { bd = dd; best = q; }
      }
      return best;
    };
    canvas.addEventListener("mousemove", (e) => {
      const h = hit(e);
      if (!h) { tip.style.display = "none"; canvas.style.cursor = "crosshair"; return; }
      const p = h[2];
      canvas.style.cursor = "pointer";
      const when = new Date(p.at * 1000);
      const clock = `${when.getMonth() + 1}/${when.getDate()} ${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")}`;
      const state = p.st === "pick" ? "  \u00b7  picked" : p.st === "deleted" ? "  \u00b7  deleted" : "";
      fillTip(tip, `${[episodes ? p.se : "", p.no, p.nm].filter(Boolean).join("  ") || p.f}\n${p.f}${state}\n`
        + `${p.x ? "" : "~"}${duration(p.s)}${p.x ? " - written in the picture" : " - estimated"}\nsaved ${clock}`);
      tip.style.display = "block";
      const tw = tip.offsetWidth || 200;
      tip.style.left = `${Math.max(4, Math.min(h[0] + 12, wrap.clientWidth - tw - 4))}px`;
      tip.style.top = `${Math.max(4, h[1] - (tip.offsetHeight || 60) - 10)}px`;
    });
    canvas.addEventListener("mouseleave", () => { tip.style.display = "none"; });
    canvas.addEventListener("click", (e) => {
      const h = hit(e);
      if (h && h[2].sc) goCut(h[2].se, h[2].sc);
    });

    /* how fast each setting renders */
    const speeds = d.speeds || [];
    if (speeds.length) {
      const most = Math.max(1, ...speeds.flatMap((a) => a.values.map((v) => v.median)));
      for (const a of speeds) {
        const sec = section(`${a.label} \u00b7 seconds per render`, "slowest in gold, fastest in blue", "ax");
        const ranks = ranked(a.values, (v) => v.median, (v) => v.value);
        for (const v of a.values) {
          const row = el("div", "vsr-srow");
          if (v.thin) row.classList.add("thin");
          if (filterIndex(a.axis, v.value) >= 0) row.classList.add("sel");
          const name = el("div", "vsr-name" + (a.axis === "lora" ? " lora" : ""), v.value);
          const trk = el("div", "trk");
          const fill = el("span");
          fill.style.width = `${Math.max(1, (100 * v.median) / most)}%`;
          if (v.exact < v.n) fill.style.background = v.exact ? "#8f96a3" : "#8f96a366";
          const tone = rankTone(ranks, v.value);
          if (tone) fill.style.background = v.exact ? tone : `${tone}88`;
          trk.append(fill);
          const num = el("div", "num");
          const mark = v.exact < v.n ? "~" : "";
          const fig = el("b", "", `${mark}${duration(v.median)}`);
          if (tone) fig.style.color = tone;
          num.append(fig, document.createTextNode(`${v.n}`));
          row.append(name, trk, num);
          row.title = `${v.value}\nA render takes ${mark}${duration(v.median)} in the middle, over ${v.n} renders`
            + `\n${mark}${duration(v.total)} in all - ${v.exact} written, ${v.n - v.exact} estimated`
            + (v.thin ? `\nFewer than ${d.thin} renders: a hint, not a result` : "");
          row.addEventListener("click", () => toggleFilter(a.axis, v.value));
          sec.append(row);
        }
        body.append(sec);
      }
    }
  }

  // ---- RECIPES
  function paintRecipes(d) {
    const recipes = d.recipes || [];
    if (!recipes.length) {
      const e = el("div", "vsr-empty");
      if (d.looks && d.looks.left > 0) {
        e.append(el("b", "", "Measuring the pictures"),
          document.createTextNode(`${d.looks.left} to go - the comparison fills in as they are measured.`));
      } else {
        e.append(el("b", "", "Nothing to compare yet"),
          document.createTextNode("A value is compared with the renders made beside it in the same cut without it. Render a cut with two LoRAs or two samplers and it shows here."));
      }
      body.append(e);
      return;
    }
    /* one scale per measure across the tab, so bars can be compared down a column */
    const scale = {};
    METRICS.forEach(([m], i) => {
      let most = 2;
      for (const a of recipes) for (const v of a.values) if (v.d) most = Math.max(most, Math.abs(v.d[i]));
      scale[m] = most;
    });
    const head = el("div", "vsr-rhead");
    head.append(el("span", "", ""), el("span", "", "n"));
    for (const [, label] of METRICS) head.append(el("span", "", label));
    body.append(head);

    for (const a of recipes) {
      const sec = section(a.label, "", "ax");
      for (const v of a.values) {
        const row = el("div", "vsr-rrow");
        if (v.thin) row.classList.add("thin");
        if (filterIndex(a.axis, v.value) >= 0) row.classList.add("sel");
        const name = el("div", "vsr-name" + (a.axis === "lora" ? " lora" : ""), v.value);
        if (v.names && v.names.length > 1) name.append(el("sup", "", `+${v.names.length - 1}`));
        row.append(name, el("div", "n", String(v.n)));
        METRICS.forEach(([m, label, more, less], i) => {
          const cell = el("div", "vsr-cell");
          const dv = el("div", "vsr-dv");
          const val = v.d ? v.d[i] : null;
          if (val !== null && Math.abs(val) >= 0.05) {
            const bar2el = el("span");
            const half = Math.min(50, (50 * Math.abs(val)) / scale[m]);
            bar2el.style.width = `${half}%`;
            bar2el.style.left = val > 0 ? "50%" : `${50 - half}%`;
            bar2el.style.borderRadius = val > 0 ? "0 2px 2px 0" : "2px 0 0 2px";
            bar2el.style.background = m === "w" ? (val > 0 ? WARM : COOL) : METRIC_COLOR[m];
            dv.append(bar2el);
          }
          const num = el("div", "vsr-dn" + (val === null ? " none" : ""), val === null ? "–" : signed(val));
          cell.append(dv, num);
          cell.title = val === null
            ? `${label}: never rendered beside the others in one cut`
            : `${label}: ${signed(val)} - ${val > 0 ? more : less} than the renders beside it`
              + `\n${v.with} renders with it, ${v.without} without, in the same cuts`;
          row.append(cell);
        });
        row.title = (v.names && v.names.length > 1 ? v.names.join(" = ") : v.value)
          + (v.thin ? `\nFewer than ${d.thin} renders on one side: a hint, not a result` : "");
        row.addEventListener("click", () => toggleFilter(a.axis, v.value));
        if (a.axis === "lora") {
          row.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const all = (S.data.axes.find((x) => x.axis === "lora") || { values: [] }).values;
            loraMenu(e, v, all);
          });
        }
        sec.append(row);
      }
      body.append(sec);
    }
  }

  // ---- VERDICTS: what was picked and deleted
  /* PROMPT VERSIONS. The version a cut ended on is nearly always its best -
     that is why the writing stopped there - so this asks what is worth
     knowing instead: how many rewrites and renders each cut took to its
     first pick, which anchor was written again when a cut finally got one,
     and which versions were left behind although they did better. */
  function cutTag(c) {
    const ep = /S\d+E(\d+)/i.exec(c.series || "");
    const cut = unitLabel(c);
    return S.data.units_kind === "cut" || !ep ? cut : `E${ep[1]} ${cut}`;
  }
  function cutRest(c) {
    return (c.name || "").replace(/^\s*C-\d+[A-Z]?\b\s*/i, "");
  }
  function versionTitle(c, v) {
    const lines = [`v${v.v} of ${c.total}`,
      `${v.n} renders - ${v.pick} picked (${pct(v.pick, v.n)}%), ${v.kept} left, ${v.deleted} deleted (${pct(v.deleted, v.n)}%)`];
    if (v.changed.length) {
      lines.push("Written again: " + v.changed.map((k) => (v.names[k] ? `${k} (${v.names[k]})` : k)).join(", "));
    } else if (v.v === 1) lines.push("The prompt as the cut was first rendered");
    if (c.first_v === v.v) lines.push(`The cut's first pick: render ${c.first_at} of ${c.renders}`);
    if (v.thin) lines.push(`Fewer than ${S.data.thin} renders: a hint, not a result`);
    return lines.join("\n");
  }
  function goVersion(series, key, id) {
    if (series && series !== P.vsr_series) { P.vsr_series = series; S.fresh = ""; }
    P.vsr_filters = P.vsr_filters.filter((f) => f.axis !== "scene" && f.axis !== "prompt");
    P.vsr_filters.push({ axis: "scene", value: key }, { axis: "prompt", value: id });
    refresh();
  }
  /* a table in the history's manner: groups under gold rules, a head, rows
     on one grid */
  function mkTable(template, groups, heads) {
    const table = el("div", "vsr-htable");
    const grid = (r) => { r.style.gridTemplateColumns = template; return r; };
    if (groups) {
      const g = grid(el("div", "vsr-hrow vsr-hgroups"));
      for (const [label, span, cls] of groups) {
        const c = el("div", cls || "", label);
        c.style.gridColumn = `span ${span}`;
        g.append(c);
      }
      table.append(g);
    }
    const h = grid(el("div", "vsr-hrow vsr-hhead"));
    for (const [label, tip, cls] of heads) {
      const c = el("div", cls || "", label);
      if (tip) c.title = tip;
      h.append(c);
    }
    const tbody = el("div", "vsr-tbody");
    table.append(h, tbody);
    return {
      table,
      row(cells, cls) {
        const r = grid(el("div", "vsr-hrow" + (cls ? " " + cls : "")));
        for (const c of cells) r.append(c);
        tbody.append(r);
        return r;
      },
    };
  }
  const cellOf = (cls, text) => el("div", cls || "", text == null ? "" : String(text));
  const pad2 = (n, w) => (n == null ? "–" : String(Math.round(n)).padStart(Math.max(2, w || 2), "0"));
  function barCell(t, most, cls) {
    const c = el("div", cls || "g l");
    const track = el("div", "vsr-track");
    const fill = el("div", "vsr-barfill");
    fill.style.width = `${Math.max(1.5, (100 * t.n) / most)}%`;
    fill.append(split(t));
    track.append(fill);
    c.append(track);
    return c;
  }
  function paintVersions(d) {
    const vr = d.versions || {};
    const cuts = vr.cuts || [];
    const cu = cutUnit();
    if (cu) {
      const c = cuts.find((x) => x.key === cu.key);
      if (!c) return false;
      const tiles = el("div", "vsr-tiles");
      tiles.append(
        tile("", "Versions", c.total, c.total > 1 ? `${c.total - 1} rewrites` : "one prompt"),
        tile("", "Renders", c.renders),
        tile("pick", "First pick", c.first_v ? `v${c.first_v}` : "–", c.first_v ? `render ${pad2(c.first_at)}` : "none yet"),
        tile("", "Picked", c.versions.reduce((a, v) => a + v.pick, 0)));
      body.append(tiles);
      const sec = section("Versions of this cut's prompt", "click one to see only its renders");
      const most = Math.max(1, ...c.versions.map((v) => v.n));
      const t = mkTable("52px minmax(150px,1.3fr) minmax(90px,1fr) 70px 54px 54px",
        [["", 2, ""], ["Renders", 4, "g"]],
        [["", "", ""], ["Written again", "the anchors written again since the version before", ""],
          ["Renders", "picked, left as they are, deleted", "g l"], ["Picked", "picks / renders", "r"],
          ["Share", "share picked", "r"], ["Deleted", "share deleted", "r"]]);
      for (const v of c.versions) {
        const no = cellOf("vsr-vno" + (c.first_v === v.v ? " hit" : ""), `v${v.v}`);
        const what = cellOf("vsr-vwhat", v.changed.length ? v.changed.join(" · ") : v.v === 1 ? "FIRST WRITTEN" : "");
        if (c.first_v === v.v) what.append(el("em", "", "FIRST PICK"));
        const picks = el("div", "r");
        picks.append(el("b", "", String(v.pick)), el("small", "", ` / ${v.n}`));
        const r = t.row([no, what, barCell(v, most), picks, cellOf("r vsr-hok", `${pct(v.pick, v.n)}%`),
          cellOf("r vsr-hnone", v.deleted ? `${pct(v.deleted, v.n)}%` : "·")],
        filterIndex("prompt", v.id) >= 0 ? "sel" : "");
        r.title = versionTitle(c, v);
        r.addEventListener("click", () => toggleFilter("prompt", v.id));
      }
      sec.append(t.table);
      body.append(sec);
      return true;
    }
    if (!cuts.length && !(vr.anchors || []).length) return false;
    /* the series in four numbers */
    const nCuts = vr.first_try + vr.after + vr.none;
    if (nCuts) {
      const tiles = el("div", "vsr-tiles");
      const rew = cuts.reduce((a, c) => a + c.total - 1, 0);
      tiles.append(
        tile("", "Cuts", nCuts, cuts.length ? `${rew} rewrites` : ""),
        tile("pick", "Picked at once", vr.first_try, `${pct(vr.first_try, nCuts)}%`),
        tile("", "After a rewrite", vr.after, `${pct(vr.after, nCuts)}%`),
        tile("del", "No pick yet", vr.none, `${pct(vr.none, nCuts)}%`));
      body.append(tiles);
    }
    let shown = false;
    /* each cut: its versions in slots that line up, and where the first pick came */
    if (cuts.length) {
      const sec = section("Prompt versions", "each cut's prompt as it was written again - click a version to see only its renders");
      const slots = Math.max(...cuts.map((c) => c.total));
      const wide = Math.max(2, ...cuts.map((c) => String(c.renders).length));
      const t = mkTable(`52px minmax(140px,1.2fr) ${Math.max(150, slots * 33 + 8)}px 54px 66px 92px 54px`,
        [["", 2, ""], ["Versions", 2, "g"], ["First pick", 3, "g"]],
        [["Cut", "", ""], ["Scene", "", ""],
          ["In order", "the version of the first pick in gold, those before it dim", "g l"],
          ["Rewrites", "times the prompt was written again", "r"],
          ["Version", "the version that brought the first pick", "g l"],
          ["At render", "the render that was the first pick, of all the cut's renders", "l"],
          ["Of", "the cut's renders", "r"]]);
      for (const c of cuts) {
        const chain = el("div", "g l vsr-vslots");
        for (const v of c.versions) {
          const when = !c.first_v || v.v < c.first_v ? " pre" : v.v === c.first_v ? " hit" : "";
          const pill = el("span", "vsr-vslot" + when, `v${v.v}`);
          pill.title = versionTitle(c, v);
          pill.addEventListener("click", (e) => { e.stopPropagation(); goVersion(c.series, c.key, v.id); });
          chain.append(pill);
        }
        /* where the first pick came, along the cut's renders */
        const at = el("div", "l vsr-vat");
        if (c.first_at) {
          const line = el("span", "vsr-vline");
          const mark = el("i");
          mark.style.left = `${(100 * (c.first_at - 1)) / Math.max(1, c.renders - 1)}%`;
          line.append(mark);
          at.append(el("b", "", pad2(c.first_at, wide)), line);
        } else at.append(el("s", "", "none yet"));
        const r = t.row([cellOf("vsr-vno", cutTag(c)), cellOf("vsr-vname", cutRest(c)), chain,
          cellOf("r", c.total > 1 ? String(c.total - 1) : "·"),
          cellOf("g l vsr-hok", c.first_v ? `v${c.first_v}` : "–"), at,
          cellOf("r vsr-vof", pad2(c.renders, wide))], c.first_v ? "" : "zero");
        r.title = `${cutTag(c)} ${cutRest(c)}\n${c.total} version${c.total > 1 ? "s" : ""}, ${c.renders} renders`
          + (c.first_v ? `\nFirst pick: v${c.first_v}, render ${c.first_at} of ${c.renders}` : "\nNo pick yet")
          + "\nClick to open this cut";
        r.addEventListener("click", () => goCut(c.series, c.key));
      }
      sec.append(t.table);
      body.append(sec);
      shown = true;
    }
    /* which anchor was written again when a cut finally got its first pick */
    const anchors = vr.anchors || [];
    if (anchors.length) {
      const sec = section("What a rewrite changed", "how often each anchor was written again, and how often that brought a cut its first pick", shown ? "ax" : "");
      const most = Math.max(1, ...anchors.map((a) => a.rewrites));
      const t = mkTable("minmax(100px,170px) minmax(120px,1fr) 70px 90px 60px",
        null,
        [["Anchor", "", ""], ["In gold: brought a first pick", "", "g l"],
          ["Rewrites", "times this anchor was written again", "r"],
          ["First picks", "rewrites that brought the cut its first pick", "r"], ["Share", "", "r"]]);
      for (const a of anchors) {
        const bar = barCell({ n: a.rewrites, pick: a.landed, kept: a.rewrites - a.landed, deleted: 0 }, most);
        const r = t.row([cellOf("vsr-vanc", a.anchor), bar, cellOf("r", a.rewrites),
          cellOf("r vsr-hok", a.landed || "·"), cellOf("r", `${pct(a.landed, a.rewrites)}%`)]);
        r.style.cursor = "default";
        r.title = `${a.anchor}\nwritten again ${a.rewrites} times\n${a.landed} of them brought the cut its first pick (${pct(a.landed, a.rewrites)}%)`;
      }
      sec.append(t.table);
      body.append(sec);
      shown = true;
    }
    /* versions left behind that were picked more often than the one now */
    const missed = vr.missed || [];
    if (missed.length) {
      const sec = section("Left behind", "an earlier version picked more often than the one the cut ended on - a prompt worth going back to", "ax");
      const t = mkTable("52px minmax(140px,1.2fr) 50px 60px 60px 50px 60px 60px",
        [["", 2, ""], ["Earlier", 3, "g"], ["Now", 3, "g"]],
        [["Cut", "", ""], ["Scene", "", ""], ["Version", "", "g l"], ["Picked", "", "r"], ["Share", "", "r"],
          ["Version", "", "g l"], ["Picked", "", "r"], ["Share", "", "r"]]);
      for (const m of missed) {
        const r = t.row([cellOf("vsr-vno", cutTag(m)), cellOf("vsr-vname", cutRest(m)),
          cellOf("g l vsr-hok", `v${m.v}`), cellOf("r", `${m.pick} / ${m.n}`), cellOf("r vsr-hok", `${pct(m.pick, m.n)}%`),
          cellOf("g l", `v${m.now}`), cellOf("r", `${m.now_pick} / ${m.now_n}`), cellOf("r", `${pct(m.now_pick, m.now_n)}%`)]);
        r.title = `Click to see the renders of v${m.v}`
          + (m.n < (d.thin || 10) ? `\nFewer than ${d.thin} renders: a hint, not a result` : "");
        r.addEventListener("click", () => goVersion(m.series, m.key, m.id));
      }
      sec.append(t.table);
      body.append(sec);
    }
    return true;
  }

  /* HISTORY: the series of a period, the latest first - what each cost and
     what it gave, set as a table: what came out, how the cuts went, what
     the prompts needed. */
  const SPANS = [[30, "30 days"], [90, "90 days"], [182, "6 months"], [365, "1 year"], [0, "All"]];
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August",
    "September", "October", "November", "December"];
  /* the period chooser shared by HISTORY and TRENDS */
  function periodRow(text) {
    const top = el("div", "vsr-sortrow vsr-hspan");
    const range = el("div", "vsr-hrange", text);
    const seg = el("div", "vsr-seg");
    for (const [days, label] of SPANS) {
      const b = el("button", "vsr-btn" + (P.vsr_hist_days === days ? " on" : ""), label);
      b.title = days ? `The series worked on in the last ${label}` : "Every series counted";
      b.addEventListener("click", () => { P.vsr_hist_days = days; S.sig = ""; refresh(); });
      seg.append(b);
    }
    top.append(range, seg);
    body.append(top);
    return range;
  }
  function periodText(d) {
    const from = d.settings && d.settings.from;
    return (P.vsr_hist_days ? `The last ${SPANS.find(([k]) => k === P.vsr_hist_days)[1]}` : "Every series")
      + (from ? ` · counted from ${from}` : "");
  }
  /* a series in a column head: S1E5 for an episode, else its first word */
  function shortName(n) {
    const m = /S\d+E\d+[A-Z0-9]*/i.exec(n || "");
    if (m) return m[0].toUpperCase();
    const w = String(n || "").replace(/^(the|le|la|les|l'|il)\s+/i, "");
    return w.length > 8 ? w.slice(0, 7) + "…" : w;
  }
  const SHOT_WORDS = {
    size: "Shot size", angle: "Angle", frame: "Frame",
    Wide: "Wide · extreme long", Full: "Full length", "Three-quarter": "Three-quarter",
    Medium: "Medium", "Close-up": "Close-up · macro", Other: "Not named",
    High: "High", "Eye level": "Eye level", Low: "Low",
    portrait: "Portrait", landscape: "Landscape", square: "Square",
  };

  /* TRENDS: how each recipe has fared series after series, and how hard
     each kind of shot is to get */
  function paintTrends(d) {
    periodRow(periodText(d));
    const tr = d.trends;
    if (!tr || tr.days !== P.vsr_hist_days) {
      body.append(el("div", "vsr-note", "Reading the trends…"));
      return;
    }
    const sizes = (tr.shots || []).filter((x) => x.kind === "size" && x.label !== "Other" && x.cuts >= 5 && x.to_first != null);
    const hard = sizes.length ? sizes.reduce((a, b) => (b.to_first > a.to_first ? b : a)) : null;
    const easy = sizes.length ? sizes.reduce((a, b) => (b.to_first < a.to_first ? b : a)) : null;
    const tiles = el("div", "vsr-tiles");
    tiles.append(
      tile("", "Series", tr.series.length, `${tr.cuts} cuts`),
      tile("", "Recipes compared", tr.card.length, `with ${d.thin || 10} renders or more`),
      tile("del", "Hardest shot", hard ? hard.label : "–", hard ? `1st pick at ${pad2(hard.to_first)}` : ""),
      tile("pick", "Easiest shot", easy ? easy.label : "–", easy ? `1st pick at ${pad2(easy.to_first)}` : ""));
    body.append(tiles);

    /* ---- the recipe report card */
    const cols = tr.series.slice(-8);
    if (tr.card.length) {
      const sec = section("Recipe report card", "share picked, series by series - the last eight series of the period, oldest at the left");
      const template = `minmax(110px,1.4fr) repeat(${cols.length}, minmax(38px,52px)) 54px 62px 58px`;
      const t = mkTable(template,
        [["", 1, ""], ["Series, oldest to newest", cols.length, "g"], ["Whole period", 2, "g"], ["", 1, "g"]],
        [["Recipe", "", ""]].concat(cols.map((n, i) => [shortName(n), n, (i ? "c" : "g c") + " vsr-tcol"]),
          [["Picked", "share picked over the period", "g r"], ["Renders", "", "r"],
            ["Trend", "the last three series it was used in against the ones before", "g r"]]));
      /* the recipes used in the series on show; the rest folded away */
      const inCols = tr.card.filter((c) => cols.some((n) => c.cells[n]));
      const rest = tr.card.length - inCols.length;
      const list = S.trendAll ? tr.card : inCols;
      let axis = "";
      for (const c of list) {
        if (c.axis !== axis) {
          axis = c.axis;
          const g = el("div", "vsr-hmonth vsr-tgroup", axis === "lora" ? "LoRA" : "Sampler");
          t.table.querySelector(".vsr-tbody").append(g);
        }
        const name = cellOf("vsr-tname" + (c.axis === "lora" ? " lora" : ""), c.value);
        const cells = cols.map((n, i) => {
          const v = c.cells[n];
          const cl = (i ? "c" : "g c") + " vsr-tcell";
          if (!v) return cellOf(cl + " none", "·");
          const share = v[0] ? (100 * v[1]) / v[0] : 0;
          const cell = cellOf(cl + " " + (share >= 25 ? "s4" : share >= 15 ? "s3" : share >= 8 ? "s2" : share > 0 ? "s1" : "s0"),
            `${Math.round(share)}`);
          cell.title = `${c.value} in ${n}\n${v[0]} renders, ${v[1]} picked (${Math.round(share)}%)`
            + (v[0] < (d.thin || 10) ? `\nFewer than ${d.thin} renders: a hint, not a result` : "");
          if (v[0] < (d.thin || 10)) cell.classList.add("thin");
          return cell;
        });
        const trend = cellOf("g r vsr-ttrend", "·");
        if (c.trend != null && Math.abs(c.trend) >= 3) {
          trend.textContent = `${c.trend > 0 ? "▲" : "▼"} ${Math.abs(c.trend).toFixed(0)}`;
          trend.classList.add(c.trend > 0 ? "up" : "down");
        } else if (c.trend != null) trend.textContent = "=";
        const r = t.row([name].concat(cells, [cellOf("g r vsr-hok", `${pct(c.pick, c.n)}%`), cellOf("r", c.n), trend]));
        r.style.cursor = "default";
        r.title = `${c.value}\n${c.n} renders over the period, ${c.pick} picked (${pct(c.pick, c.n)}%)`
          + (c.trend != null ? `\nThe last three series it was used in: ${c.trend > 0 ? "+" : ""}${c.trend} points against the ones before` : "");
      }
      sec.append(t.table);
      if (rest) {
        const more = el("div", "vsr-tmore", S.trendAll ? `Show only the recipes used in these ${cols.length} series`
          : `+ ${rest} more recipe${rest > 1 ? "s" : ""} of the period, not used in these ${cols.length} series`);
        more.addEventListener("click", () => { S.trendAll = !S.trendAll; S.sig = ""; paint(); });
        sec.append(more);
      }
      if (tr.always.length) {
        const box = el("div", "vsr-always");
        box.title = "In nearly every render of the period, so there is nothing to compare them against";
        box.append(el("em", "", "IN NEARLY EVERY RENDER · NOT COMPARED"));
        for (const v of tr.always) box.append(el("b", "", v));
        sec.append(box);
      }
      body.append(sec);
    }

    /* ---- the shots */
    const shots = tr.shots || [];
    if (shots.length) {
      const sec = section("Difficulty by shot", `how long each kind of cut took to its first pick - read from the camera capsule of ${tr.read} of ${tr.cuts} cuts`, "ax");
      const most = Math.max(1, ...shots.map((x) => x.to_first || 0));
      const t = mkTable("minmax(130px,1.2fr) 52px 62px 62px minmax(120px,1fr) 62px 66px",
        [["", 1, ""], ["Cuts", 3, "g"], ["Until the first pick", 2, "g"], ["", 1, "g"]],
        [["Shot", "", ""], ["Cuts", "", "g r"], ["At once", "cuts picked on their first prompt", "r"],
          ["No pick", "cuts with no pick yet", "r"],
          ["1st pick at render", "the render at which a cut's first pick usually came (median)", "g l"],
          ["Per pick", "renders for each pick", "r"], ["Versions", "prompt versions a cut took, on average", "g r"]]);
      let kind = "";
      const rankIn = {};
      for (const k of ["size", "angle", "frame"]) {
        const list = shots.filter((x) => x.kind === k && x.label !== "Other" && x.cuts >= 5 && x.to_first != null);
        if (list.length >= 2) {
          rankIn[k] = { hard: list.reduce((a, b) => (b.to_first > a.to_first ? b : a)).label,
            easy: list.reduce((a, b) => (b.to_first < a.to_first ? b : a)).label };
        }
      }
      for (const x of shots) {
        if (x.kind !== kind) {
          kind = x.kind;
          t.table.querySelector(".vsr-tbody").append(el("div", "vsr-hmonth vsr-tgroup", SHOT_WORDS[kind]));
        }
        const bar = el("div", "g l vsr-tbar");
        if (x.to_first != null) {
          const line = el("span", "vsr-tfill");
          line.style.width = `${Math.max(3, (100 * x.to_first) / most)}%`;
          const rk = rankIn[x.kind];
          if (rk && rk.hard === x.label) line.classList.add("hard");
          if (rk && rk.easy === x.label) line.classList.add("easy");
          bar.append(el("b", "", pad2(x.to_first)), line);
        } else bar.append(el("s", "", "none yet"));
        const r = t.row([cellOf("vsr-tname", SHOT_WORDS[x.label] || x.label), cellOf("g r", x.cuts),
          cellOf("r vsr-hok", x.at_once || "·"), cellOf("r vsr-hnone", x.none || "·"), bar,
          cellOf("r", x.pick ? (x.n / x.pick).toFixed(1) : "–"), cellOf("g r", x.versions.toFixed(1))],
        x.cuts < 5 ? "zero" : "");
        r.style.cursor = "default";
        r.title = `${SHOT_WORDS[x.label] || x.label}\n${x.cuts} cuts, ${x.n} renders, ${x.pick} picked`
          + `\n${x.at_once} picked on the first prompt, ${x.none} with no pick yet`
          + (x.to_first != null ? `\nA cut's first pick came at render ${pad2(x.to_first)} (median)` : "")
          + `\n${x.versions.toFixed(1)} prompt versions a cut, on average`;
      }
      sec.append(t.table);
      sec.append(el("div", "vsr-note", "Size and angle come from the words of each cut's camera capsule in the Series Book - "
        + "“extreme long shot”, “three-quarter”, “high angle”. A cut whose book is gone is counted under its frame only."));
      body.append(sec);
    }
    const legend = el("div", "vsr-legend");
    legend.append(el("span", "ls4", "25% picked or more"), el("span", "ls3", "15%"), el("span", "ls2", "8%"),
      el("span", "ls1", "under 8%"), el("span", "lhard", "hardest shot"), el("span", "leasy", "easiest shot"));
    body.append(legend);
  }

  function paintHistory(d) {
    const range = periodRow("");
    const hb = d.history;
    if (!hb || hb.days !== P.vsr_hist_days) {
      body.append(el("div", "vsr-note", "Reading the history…"));
      return;
    }
    const all = hb.series || [];
    const shown = all.filter((x) => !x.hidden).reverse();     // the latest first
    const hidden = all.filter((x) => x.hidden);
    const day = (t) => { const v = new Date(t * 1000); return `${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`; };
    const from = d.settings && d.settings.from;
    range.textContent = (P.vsr_hist_days ? `The last ${SPANS.find(([k]) => k === P.vsr_hist_days)[1]}` : "Every series")
      + (from ? ` · counted from ${from}` : "");
    if (!shown.length) {
      body.append(el("div", "vsr-note", "No series worked on in this period."));
    } else {
      /* the period in four numbers */
      const tot = shown.reduce((a, x) => {
        a.n += x.n; a.pick += x.pick; a.cuts += x.cuts; a.secs += (x.time && x.time.total) || 0;
        return a;
      }, { n: 0, pick: 0, cuts: 0, secs: 0 });
      const tiles = el("div", "vsr-tiles");
      tiles.append(
        tile("", "Series", shown.length, `${tot.cuts} cuts`),
        tile("", "Renders", tot.n, tot.secs ? duration(tot.secs) : ""),
        tile("pick", "Picked", tot.pick, `${pct(tot.pick, tot.n)}%`),
        tile("", "Renders per pick", tot.pick ? (tot.n / tot.pick).toFixed(1) : "–"));
      body.append(tiles);

      const table = el("div", "vsr-htable");
      const groups = el("div", "vsr-hrow vsr-hgroups");
      for (const [label, span, cls] of [["", 2, ""], ["Output", 4, "g"], ["Cuts", 4, "g"], ["Prompt", 2, "g"]]) {
        const c = el("div", cls, label);
        c.style.gridColumn = `span ${span}`;
        groups.append(c);
      }
      const head = el("div", "vsr-hrow vsr-hhead");
      for (const [t, tip, cls] of [
        ["", "", ""], ["Series", "", ""],
        ["Renders", "picked, left as they are, deleted", "g l"], ["Picked", "picks of renders", "r"],
        ["Per pick", "renders for each pick", "r"], ["Hours", "render time, written or estimated", "r"],
        ["1st pick", "the render at which a cut's first pick usually came (median)", "g r"],
        ["At once", "cuts picked on the first prompt", "r"], ["Rewrite", "cuts picked after the prompt was written again", "r"],
        ["None", "cuts with no pick yet", "r"],
        ["Rewritten", "the anchor written again most; in gold, the one whose rewrite most often brought a first pick", "g l"],
        ["", "", ""]]) {
        const c = el("div", cls, t);
        if (tip) c.title = tip;
        head.append(c);
      }
      table.append(groups, head);
      const box = el("div", "vsr-hist");
      const most = Math.max(1, ...shown.map((x) => x.n));
      const rank = ranked(shown.filter((x) => x.pick >= 5), (x) => x.n / x.pick, (x) => x.name);
      const two = (n) => (n == null ? "–" : String(Math.round(n)).padStart(2, "0"));
      let month = "";
      for (const x of shown) {
        const at = new Date(x.first * 1000);
        const m = `${MONTHS[at.getMonth()]} ${at.getFullYear()}`;
        if (m !== month) {
          month = m;
          box.append(el("div", "vsr-hmonth", m));
        }
        const row = el("div", "vsr-hrow" + (x.pick ? "" : " zero"));
        if (x.name === P.vsr_series) row.classList.add("sel");
        const cell = (cls, text) => el("div", cls, text);
        const name = cell("vsr-hname", x.name);
        const bar = el("div", "g l");
        const track = el("div", "vsr-track");
        const fill = el("div", "vsr-barfill");
        fill.style.width = `${Math.max(1.5, (100 * x.n) / most)}%`;
        fill.append(split(x));
        track.append(fill);
        bar.append(track);
        const picks = el("div", "r");
        picks.append(el("b", "", String(x.pick)), el("small", "", ` / ${x.n}`));
        const per = cell("r", x.pick ? (x.n / x.pick).toFixed(1) : "–");
        const tone = rankTone(rank, x.name);
        if (tone) { per.style.color = tone; per.classList.add("ranked"); }
        const hours = cell("r", x.time && x.time.total ? (x.time.total / 3600).toFixed(1) : "–");
        const anc = el("div", "g l vsr-hanc");
        if (x.most && x.landed === x.most) anc.append(el("b", "", x.most));
        else {
          if (x.most) anc.append(el("span", "", x.most));
          if (x.landed) anc.append(el("i", "", "›"), el("b", "", x.landed));
        }
        const hide = cell("vsr-hhide", "×");
        hide.title = "Hide this series from the series together and from the history";
        hide.addEventListener("click", (e) => { e.stopPropagation(); hideSeries(x.name, true); });
        row.append(cell("vsr-hday", day(x.first)), name, bar, picks, per, hours,
          cell("g r", x.to_first == null ? "–" : two(x.to_first)),
          cell("r vsr-hok", x.first_try ? String(x.first_try) : "·"),
          cell("r", x.after ? String(x.after) : "·"),
          cell("r vsr-hnone", x.none ? String(x.none) : "·"),
          anc, hide);
        row.title = `${x.name}\n${x.n} renders - ${x.pick} picked, ${x.kept} left, ${x.deleted} deleted`
          + `\n${x.pick ? (x.n / x.pick).toFixed(1) + " renders a pick" : "no pick"}`
          + (x.time && x.time.total ? ` · ${duration(x.time.total)} of rendering` : "")
          + `\n${x.cuts} cuts: ${x.first_try} picked on the first prompt, ${x.after} after a rewrite, ${x.none} with no pick yet`
          + (x.to_first != null ? `\nA cut's first pick came at render ${two(x.to_first)} (median)` : "")
          + (x.most ? `\nWritten again most: ${x.most} (${x.rewrites} rewrites in all)` : "")
          + (x.landed ? `\nMost first picks after rewriting: ${x.landed}` : "")
          + "\nClick to open this series";
        row.addEventListener("click", () => goTo(x.name));
        box.append(row);
      }
      table.append(box);
      body.append(table);
    }
    if (hidden.length) {
      const sec = section("Hidden", "left out of the series together and of the history - click one to bring it back", "ax");
      const wrap = el("div", "vsr-hhidden");
      for (const x of hidden) {
        const b = el("span", "", x.name);
        b.title = `${x.n} renders - click to show it again`;
        b.addEventListener("click", () => hideSeries(x.name, false));
        wrap.append(b);
      }
      sec.append(wrap);
      body.append(sec);
    }
    const legend = el("div", "vsr-legend");
    legend.append(el("span", "lp", "picked"), el("span", "", "left as it is"), el("span", "ld", "deleted"),
      el("span", "lb", "fewest renders a pick"), el("span", "lg", "most renders a pick"));
    body.append(legend);
  }
  async function hideSeries(name, hide) {
    try { await postJSON(HIDE_URL, { name, hide }); } catch (e) { /* the next look says */ }
    S.sig = "";
    refresh();
  }

  function paintPrompts(d) {
    if (!paintVersions(d)) {
      body.append(el("div", "vsr-note", "No prompt versions here yet - they are read from renders made "
        + "with the Series Lab and the Series Book."));
      return;
    }
    if (cutUnit()) {
      const legend = el("div", "vsr-legend");
      legend.append(el("span", "lp", "picked"), el("span", "", "left as it is"), el("span", "ld", "deleted"));
      body.append(legend);
    }
  }

  function paintVerdicts(d) {
    const sortRow = el("div", "vsr-sortrow");
    sortRow.append(sortSeg);
    body.append(sortRow);
    let first = true;
    for (const a of d.axes) {
      const filtered = P.vsr_filters.some((f) => f.axis === a.axis);
      const shown = a.values.filter((v) => !v.always || filterIndex(a.axis, v.value) >= 0);
      const always = a.values.filter((v) => v.always && filterIndex(a.axis, v.value) < 0);
      /* an axis with one value compares nothing */
      if (shown.length < 2 && !filtered && !(a.axis === "lora" && shown.length)) continue;
      const sec = section(a.label, "", first ? "" : "ax");
      first = false;
      const most = Math.max(1, ...shown.map((v) => v.n));
      for (const v of sorted(shown)) {
        const row = el("div", "vsr-row");
        if (v.thin) row.classList.add("thin");
        if (filterIndex(a.axis, v.value) >= 0) row.classList.add("sel");
        const name = el("div", "vsr-name" + (a.axis === "lora" ? " lora" : ""), v.value);
        if (v.names && v.names.length > 1) name.append(el("sup", "", `+${v.names.length - 1}`));
        const track = el("div", "vsr-track");
        const fill = el("div", "vsr-barfill");
        fill.style.width = `${Math.max(1.5, (100 * v.n) / most)}%`;
        fill.append(split(v));
        track.append(fill);
        const num = el("div", "vsr-num");
        num.append(el("b", "", `${pct(v.pick, v.n)}%`), el("i", "", `${v.pick}/${v.n}`),
          el("s", "", v.deleted ? `−${pct(v.deleted, v.n)}%` : ""));
        row.append(name, track, num);
        row.title = `${v.names && v.names.length > 1 ? v.names.join(" = ") : v.value}\n`
          + `${v.n} renders - ${v.pick} picked (${pct(v.pick, v.n)}%), ${v.kept} left, ${v.deleted} deleted (${pct(v.deleted, v.n)}%)`
          + (v.thin ? `\nFewer than ${d.thin} renders: a hint, not a result` : "");
        row.addEventListener("click", () => toggleFilter(a.axis, v.value));
        if (a.axis === "lora") {
          row.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            e.stopPropagation();
            loraMenu(e, v, a.values);
          });
        }
        sec.append(row);
      }
      if (always.length) {
        const box = el("div", "vsr-always");
        box.title = "These LoRAs are in nearly every render, so there are no renders without them to compare against";
        box.append(el("em", "", "IN NEARLY EVERY RENDER · NOT COMPARED"));
        for (const v of always) box.append(el("b", "", v.value));
        sec.append(box);
      }
      body.append(sec);
    }
    const legend = el("div", "vsr-legend");
    legend.append(el("span", "lp", "picked"), el("span", "", "left as it is"), el("span", "ld", "deleted"));
    body.append(legend);
  }

  function runDraws() {
    for (const f of S.draws) {
      try { f(); } catch (e) { /* a canvas the page has let go of */ }
    }
  }

  function paintBody() {
    const d = S.data;
    const top = body.scrollTop;
    body.textContent = "";
    S.draws = [];
    S.toneHi = null;
    S.logHi = null;
    if (S.drawer) { S.drawer.remove(); S.drawer = null; }
    fitNode();
    if (!d || !d.ok) {
      const e = el("div", "vsr-empty");
      e.append(el("b", "", "The report could not be read"), document.createTextNode((d && d.error) || ""));
      body.append(e);
      return;
    }
    if (!d.all_series.length) {
      const frame = el("div", "vsr-frame");
      const fhead = el("div", "vsr-fhead");
      fhead.append(headTop, headSub);
      frame.append(fhead);
      body.append(frame);
      const e = el("div", "vsr-empty");
      e.append(el("b", "", "Nothing is recorded yet"),
        document.createTextNode("Press SCAN to read the renders already in the output folder, or leave LIVE on and render: each picture is counted and measured as it is saved."));
      body.append(e);
      return;
    }
    /* the frame, in the series' own colour: the scope's head, its overview,
       and its story at the foot */
    const frame = el("div", "vsr-frame");
    frame.style.setProperty("--sg", frameTone());
    const fhead = el("div", "vsr-fhead");
    fhead.append(headTop, headSub);
    const fbody = el("div", "vsr-fbody");
    frame.append(fhead, fbody);
    body.append(frame);
    let mark = body.childNodes.length;
    paintStrip(d);
    paintTiles(d);
    while (body.childNodes.length > mark) fbody.append(body.childNodes[mark]);
    if (!fbody.childNodes.length) fbody.remove();
    const story = paintStory(d);
    if (story) frame.append(story);

    /* the analysis, in a drawer of its own below the frame, folding by its
       name as the Series Book's Drawer does */
    const drawer = el("div", "vsr-drawer" + (P.vsr_tabs_open ? "" : " shut")
      + (P.vsr_tabs_open && ACROSS.has(P.vsr_tab) ? " across" : ""));
    const dhead = el("div", "vsr-dhead");
    const tw = el("span", "tw", "\u25BE");
    const dlab = el("span", "vsr-dlab", "Analysis");
    for (const x of [tw, dlab]) {
      x.title = P.vsr_tabs_open ? "Fold the analysis" : "Open the analysis";
      x.addEventListener("click", () => { P.vsr_tabs_open = !P.vsr_tabs_open; S.sig = ""; paint(); });
    }
    dhead.append(tw, dlab, tabsRow);
    drawer.append(dhead);
    if (S.drawer) S.drawer.remove();
    S.drawer = drawer;
    root.insertBefore(drawer, help);
    if (!P.vsr_tabs_open) {
      runDraws();
      fitNode();
      return;
    }
    const dbody = el("div", "vsr-dbody");
    drawer.append(dbody);
    mark = body.childNodes.length;
    /* the tabs that go straight on into text get a rule under their lede */
    if (LEDES[P.vsr_tab]) {
      const ruled = ["verdicts", "look", "framing", "recipes", "time", "history", "trends"].includes(P.vsr_tab);
      body.append(el("p", "vsr-lede" + (ruled ? " rule" : ""), LEDES[P.vsr_tab]));
    }
    /* a series saved in the Series Book with nothing rendered yet */
    const unrendered = !ACROSS.has(P.vsr_tab) && d.totals && d.totals.n === 0 && (d.units || []).length;
    if (unrendered) {
      body.append(el("div", "vsr-note vsr-empty", "Nothing rendered yet. The scenes above come from the Series Book; "
        + "this tab fills in as soon as the first render of the series is saved."));
    } else if (P.vsr_tab === "recipes") paintRecipes(d);
    else if (P.vsr_tab === "wall") paintWall(d);
    else if (P.vsr_tab === "framing") paintFraming(d);
    else if (P.vsr_tab === "time") paintTime(d);
    else if (P.vsr_tab === "verdicts") paintVerdicts(d);
    else if (P.vsr_tab === "prompts") paintPrompts(d);
    else if (P.vsr_tab === "history") paintHistory(d);
    else if (P.vsr_tab === "trends") paintTrends(d);
    else paintLook(d);
    while (body.childNodes.length > mark) dbody.append(body.childNodes[mark]);
    runDraws();
    fitNode();
  }

  function paint() {
    paintControls();
    paintSeries();
    paintPath();
    paintFilters();
    paintBody();
    paintInfo();
    syncHeadSub();
  }

  const resize = typeof ResizeObserver === "function"
    ? new ResizeObserver(() => requestAnimationFrame(() => { runDraws(); fitNode(); })) : null;
  if (resize) resize.observe(body);

  // ---- the LoRA menu: two names, one LoRA
  let ctx = null;
  function closeCtx() {
    if (!ctx) return;
    ctx.remove();
    ctx = null;
    document.removeEventListener("pointerdown", onAway, true);
  }
  function onAway(e) {
    if (ctx && !ctx.contains(e.target)) closeCtx();
  }
  function loraMenu(e, v, values) {
    closeCtx();
    ctx = el("div", "vsr-ctx");
    ctx.append(el("div", "h", v.value));
    const names = v.names || [v.value];
    for (const n of names) {
      if (n === v.value) continue;
      const b = el("button", "", `Count ${n} on its own again`);
      b.addEventListener("click", async () => {
        closeCtx();
        await postJSON(ALIAS_URL, { name: n, same_as: "" });
        refresh();
      });
      ctx.append(b);
    }
    const others = values.filter((o) => o.value !== v.value);
    if (names.length > 1 && others.length) ctx.append(el("div", "sep"));
    if (others.length) ctx.append(el("div", "h", "The same LoRA as"));
    for (const o of others) {
      const b = el("button", "", o.value);
      b.title = `Count ${v.value} and ${o.value} as one LoRA, under the name ${o.value}`;
      b.addEventListener("click", async () => {
        closeCtx();
        const j = await postJSON(ALIAS_URL, { name: v.value, same_as: o.value });
        if (j && j.ok) {
          P.vsr_filters = P.vsr_filters.filter((f) => !(f.axis === "lora" && f.value === v.value));
          flash(`${v.value} is counted as ${o.value}`);
        } else flash((j && j.error) || "could not be joined");
        refresh();
      });
      ctx.append(b);
    }
    document.body.append(ctx);
    const w = ctx.offsetWidth || 240;
    const h = ctx.offsetHeight || 200;
    ctx.style.left = `${Math.max(4, Math.min(e.clientX, window.innerWidth - w - 6))}px`;
    ctx.style.top = `${Math.max(4, Math.min(e.clientY, window.innerHeight - h - 6))}px`;
    document.addEventListener("pointerdown", onAway, true);
  }

  // ---- asking
  function known(d, value) {
    if (value === ALL) return true;
    if (value.startsWith(SEASON)) return (d.seasons || []).some((s) => SEASON + s.season === value);
    return d.all_series.some((s) => (s.name === "" ? NONE : s.name) === value);
  }

  /* the view a render of this series belongs in, if it is not on show */
  function inView(series) {
    const v = P.vsr_series;
    if (v === ALL || v === series) return true;
    return v.startsWith(SEASON) && seasonOf(series) === Number(v.slice(SEASON.length));
  }

  async function refresh() {
    if (S.dead) return;
    if (S.busy) { S.again = true; return; }
    S.busy = true;
    try {
      const wall = P.vsr_tab === "wall" ? P.vsr_wall : null;
      const history = P.vsr_tab === "history" ? P.vsr_hist_days : null;
      const trends = P.vsr_tab === "trends" ? P.vsr_hist_days : null;
      let d = await postJSON(SUMMARY_URL, { series: P.vsr_series || null, filters: P.vsr_filters, wall, history, trends });
      /* nothing chosen yet, or a series that is no longer there: the one
         rendered last */
      if (d && d.ok && d.all_series.length && !known(d, P.vsr_series)) {
        const named = d.all_series.filter((s) => s.name !== "");
        const latest = named.reduce((a, b) => ((b.last || 0) > (a.last || 0) ? b : a), named[0]);
        P.vsr_series = latest ? latest.name : NONE;
        P.vsr_filters = [];
        d = await postJSON(SUMMARY_URL, { series: P.vsr_series, filters: [], wall, history, trends });
      }
      const sig = JSON.stringify([d, P.vsr_sort, P.vsr_live, P.vsr_tab, S.fresh, S.freshSeries, S.scanning]);
      S.data = d;
      if (sig !== S.sig) {
        S.sig = sig;
        paint();
      }
    } catch (err) {
      S.data = { ok: false, error: String((err && err.message) || err) };
      S.sig = "";
      paint();
    } finally {
      S.busy = false;
      if (S.again) { S.again = false; refresh(); }
      clearTimeout(measureTimer);
      if (!S.dead && S.data && S.data.looks && S.data.looks.left > 0) {
        measureTimer = setTimeout(refresh, MEASURE_POLL_MS);
      }
    }
  }

  // ---- controls
  seriesSel.addEventListener("change", () => {
    P.vsr_series = seriesSel.value;
    P.vsr_filters = [];
    S.fresh = "";
    refresh();
  });
  liveBtn.addEventListener("click", () => {
    P.vsr_live = !P.vsr_live;
    paintControls();
    flash(P.vsr_live ? "live - following renders, the book and the viewer" : "live off - staying on this series");
    if (P.vsr_live) { seenFolders.clear(); watchViewers(); }
  });
  csvBtn.addEventListener("click", () => {
    const base = api.apiURL ? api.apiURL(EXPORT_URL) : "/api" + EXPORT_URL;
    window.open(`${base}?series=${encodeURIComponent(P.vsr_series || ALL)}`, "_blank");
  });
  helpBtn.addEventListener("click", (e) => { e.stopPropagation(); root.classList.toggle("help"); });
  help.addEventListener("click", () => root.classList.remove("help"));

  let scanTimer = 0;
  function paintScan(st) {
    S.scanning = !!(st && st.scanning);
    scanBtn.classList.toggle("busy", S.scanning);
    scanBtn.textContent = S.scanning ? `Stop · ${st.seen}` : "Scan";
    scanBtn.title = S.scanning
      ? `Reading - ${st.seen} files looked at, ${st.added} new. Click to stop`
      : "Read and measure every render in the output folder that the report does not know yet";
  }
  async function watchScan() {
    clearTimeout(scanTimer);
    if (S.dead) return;
    let st = null;
    try { st = await getJSON(STATUS_URL); } catch (e) { st = null; }
    const was = S.scanning;
    paintScan(st);
    if (S.scanning) {
      if (st.seen % 5 === 0) refresh();
      scanTimer = setTimeout(watchScan, SCAN_POLL_MS);
    } else if (was) {
      flash(st && st.error ? `scan stopped: ${st.error}` : `scan done - ${st ? st.added : 0} new`);
      refresh();
    }
  }
  scanBtn.addEventListener("click", async () => {
    const st = await postJSON(SCAN_URL, S.scanning ? { stop: true } : {});
    paintScan(st);
    scanTimer = setTimeout(watchScan, SCAN_POLL_MS);
  });

  // ---- live: a save node's output arrives with the "executed" event
  const onExecuted = async (e) => {
    if (S.dead || !P.vsr_live) return;
    const saved = savedFrom(e && e.detail && e.detail.output);
    if (!saved) return;
    let j = null;
    try { j = await postJSON(INGEST_URL, saved); } catch (err) { return; }
    if (!j || !j.ok || j.series === undefined) return;
    if (j.series && !inView(j.series)) {
      P.vsr_series = j.series;
      P.vsr_filters = [];
    }
    if (j.what === "new") {
      S.fresh = j.scene || "";
      S.freshSeries = j.series || "";
      clearTimeout(freshTimer);
      freshTimer = setTimeout(() => { S.fresh = ""; S.freshSeries = ""; refresh(); }, 4000);
    }
    refresh();
  };
  api.addEventListener("executed", onExecuted);

  // ---- live: a Series Book opening a series, an Image Viewer opening a folder
  function showSeries(series, scene) {
    if (series !== P.vsr_series) {
      P.vsr_series = series;
      P.vsr_filters = [];
      S.fresh = "";
    }
    if (scene !== undefined) {
      P.vsr_filters = P.vsr_filters.filter((f) => f.axis !== "scene" && f.axis !== "prompt");
      if (scene) P.vsr_filters.push({ axis: "scene", value: scene });
    }
    refresh();
  }

  const onSeriesOpened = async (e) => {
    const names = (e && e.detail && e.detail.names) || [];
    if (S.dead || !P.vsr_live || !names.length || !root.isConnected) return;
    let j = null;
    try { j = await postJSON(FOLLOW_URL, { names }); } catch (err) { return; }
    if (!j || !j.ok) return;
    if (j.series === null) { flash(`no renders of "${j.asked}" are recorded yet`); return; }
    showSeries(j.series);
    flash(`series "${j.series}" - opened in the book`);
  };
  window.addEventListener("leiel-series-opened", onSeriesOpened);

  /* The viewers say nothing when their folder changes, so their folders are
     looked at instead. What each one shows is remembered, and only a change
     is followed - the report is free to be turned to another series while a
     viewer stays where it is. */
  const seenFolders = new Map();
  let following = false;
  async function followFolder(folder) {
    if (following) return;
    following = true;
    flash("reading the viewer's folder...");
    try {
      const j = await postJSON(FOLLOW_URL, { folder });
      if (S.dead || !j || !j.ok) return;
      if (j.series === null || j.series === undefined) {
        flash("the viewer's folder holds no renders with a recipe");
        return;
      }
      showSeries(j.series, j.scene || "");
      flash(`following the viewer - ${j.n} render${j.n === 1 ? "" : "s"} in its folder`
        + (j.more ? ", still reading" : ""));
      if (j.more) scanTimer = setTimeout(watchScan, SCAN_POLL_MS);
    } catch (err) {
      /* the next change is tried again */
    } finally {
      following = false;
    }
  }
  function watchViewers() {
    if (S.dead || !root.isConnected) return;
    try { followBook(); } catch (e) { /* no book, or one being built */ }
    const nodes = (app.graph && (app.graph._nodes || app.graph.nodes)) || [];
    let changed = null;
    const alive = new Set();
    for (const n of nodes) {
      if ((n.comfyClass || n.type) !== VIEWER) continue;
      alive.add(n.id);
      const folder = String((n.properties && n.properties.viv_folder) || "");
      if (seenFolders.get(n.id) === folder) continue;
      seenFolders.set(n.id, folder);
      /* an empty folder is the whole output folder: too wide to mean a series */
      if (folder) changed = folder;
    }
    for (const id of [...seenFolders.keys()]) if (!alive.has(id)) seenFolders.delete(id);
    if (changed !== null && P.vsr_live) followFolder(changed);
  }
  const watch = setInterval(watchViewers, WATCH_MS);
  const lookWatch = setInterval(() => {
    if (S.dead || !root.isConnected) return;
    try { followBook(); followTones(); } catch (e) { /* a book being built */ }
  }, 250);

  const poll = setInterval(() => {
    if (S.dead || document.hidden || !root.isConnected || S.scanning) return;
    if (root.classList.contains("help") || root.classList.contains("viewing") || ctx) return;
    refresh();
  }, POLL_MS);

  node._vsr = {
    refresh,
    tone: paintTone,
    destroy() {
      S.dead = true;
      clearInterval(poll);
      clearInterval(watch);
      clearInterval(lookWatch);
      if (resize) resize.disconnect();
      try { window.removeEventListener("leiel-series-opened", onSeriesOpened); } catch (e) { /* gone */ }
      clearTimeout(scanTimer);
      clearTimeout(flashTimer);
      clearTimeout(freshTimer);
      clearTimeout(measureTimer);
      closeCtx();
      hideCard();
      try { api.removeEventListener("executed", onExecuted); } catch (e) { /* older api */ }
    },
  };

  if (node.size[0] < 520) node.size[0] = 520;
  paint();
  setTimeout(() => { refresh(); watchScan(); }, 0);
  return domWidget;
}

app.registerExtension({
  name: "StudioLeiel.VisualSeriesReport",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== REPORT) return;

    const onCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = onCreated ? onCreated.apply(this, arguments) : undefined;
      buildReport(this);
      return r;
    };

    /* Properties arrive after the node is built when a workflow loads, so
       the series is asked for again once they are in. */
    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const r = onConfigure ? onConfigure.apply(this, arguments) : undefined;
      setDefaults(this);
      if (this._vsr) setTimeout(() => { this._vsr.tone(); this._vsr.refresh(); }, 0);
      return r;
    };

    const onRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      if (this._vsr) this._vsr.destroy();
      return onRemoved ? onRemoved.apply(this, arguments) : undefined;
    };
  },
});
