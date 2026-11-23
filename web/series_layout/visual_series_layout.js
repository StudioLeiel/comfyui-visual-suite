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

/* Visual Series Layout.

   A series laid out for print or for the web. The words come from the
   Series Book - the series title and note, and for every cut its number,
   name, caption and note. The pictures are the renders picked in the Visual
   Image Viewer with P, one per cut.

   PRINT lays the series out as spreads of two pages - a magazine, A4, a
   square book or a landscape album. WEB lays it out as single frames, one
   after another as in a feed - 4:5, 1:1, 9:16 or 16:9.

   The same six layouts serve both:
     A  Opener        title, note and cover
     B  Full spread   one cut to the edge, its caption small in a corner
     C  Photo | text  one cut beside its number, title, caption and note
     D  Pair          two cuts side by side, both to the edge
     E  Framed        cuts inside the margins, their words below
     F  Closing       the list of every cut
   A cut is laid out by its shape; D and E are only ever chosen by hand.

   Every page is drawn on a canvas by one function, in units of the page -
   the node, the full-screen view and the exported file are the same drawing
   at three sizes. Everything chosen is kept in the node's properties and
   travels with the workflow. */

import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

const LAYOUT = "LeielSeriesLayout";

const SERIES_URL = "/leiel_layout/series";
const BOOK_URL = "/leiel_layout/book";
const PICTURE_URL = "/leiel_layout/picture";
const SAVE_URL = "/leiel_layout/save";
const PACKAGE_URL = "/leiel_layout/package";
const RELINK_URL = "/leiel_layout/relink";
const LINKED_URL = "/leiel_layout/linked";
const PDF_PAGE_URL = "/leiel_layout/pdf_page";
const PDF_DONE_URL = "/leiel_layout/pdf_done";
const MUSIC_URL = "/leiel_layout/music";
const MUSIC_LIST_URL = "/leiel_layout/music_list";
const MUSIC_FORGET_URL = "/leiel_layout/music_forget";
const MUSIC_SHELF_URL = "/leiel_layout/music_shelf";
const MUSIC_RENAME_URL = "/leiel_layout/music_rename";
const VIDEO_PART_URL = "/leiel_layout/video_part";
const VIDEO_DONE_URL = "/leiel_layout/video_done";
const LOGO_URL = "/leiel_layout/logo";
const POST_URL = "/leiel_layout/post";
const SAVE_LAYOUT_URL = "/leiel_layout/save_layout";

const POLL_MS = 6000;           // picks change in another node without telling this one
const DPI = 300;                // print exports
const BASE = 230;               // the short side every size is scaled from

// ---- sizes
const FORMATS = {
  print: [
    { id: "magazine", label: "Magazine", size: "230 × 300 mm", w: 230, h: 300 },
    { id: "a4", label: "A4", size: "210 × 297 mm", w: 210, h: 297 },
    { id: "square", label: "Square", size: "250 × 250 mm", w: 250, h: 250 },
    { id: "album", label: "Landscape", size: "300 × 240 mm", w: 300, h: 240 },
  ],
  web: [
    { id: "ig45", label: "Portrait 4:5", size: "1080 × 1350", px: [1080, 1350] },
    { id: "sq", label: "Square 1:1", size: "1080 × 1080", px: [1080, 1080] },
    { id: "story", label: "Vertical 9:16", size: "1080 × 1920", px: [1080, 1920] },
    { id: "wide", label: "Wide 16:9", size: "1920 × 1080", px: [1920, 1080] },
  ],
};

// a film is made at the sizes of the web
FORMATS.motion = FORMATS.web;

/* The geometry of one size, in page units: a printed page in millimetres,
   a web frame scaled so its short side is BASE units - so the type keeps
   the same proportion to the page whatever the size. */
function geometry(cat, fmtId, fonts, themeId, textPos, sizes) {
  const list = FORMATS[cat] || FORMATS.print;
  const fmt = list.find(f => f.id === fmtId) || list[0];
  let pw, ph, exportK;
  if (cat === "web") {
    const [w, h] = fmt.px;
    const per = Math.min(w, h) / BASE;
    pw = w / per;
    ph = h / per;
    exportK = per;
  } else {
    pw = fmt.w;
    ph = fmt.h;
    exportK = DPI / 25.4;
  }
  const s = Math.min(pw, ph);
  const f = s / BASE;
  return {
    cat, fmt, pw, ph, f,
    sheetW: cat === "web" ? pw : pw * 2,
    sheetH: ph,
    exportK,
    M: { outer: s * 0.078, inner: s * 0.07, top: s * 0.087, bottom: s * 0.104 },
    tf: fonts.title, bf: fonts.body,
    c: THEMES.find(t => t.id === themeId) || THEMES[0],
    tp: TEXT_POS.some(t => t.id === textPos) ? textPos : "middle",
    st: (sizes && sizes.title) || 1, sx: (sizes && sizes.text) || 1,
  };
}

const PT = 25.4 / 72;           // one point in millimetres

/* Colour themes: paper, the ink of titles, of text, and of numbers and rules. */
const THEMES = [
  { id: "ivory", label: "Ivory", paper: "#fbfaf7", ink: "#1d1c1a", soft: "#4a4741", accent: "#8a7a5a", empty: "#dcd8cf" },
  { id: "white", label: "White", paper: "#ffffff", ink: "#111111", soft: "#4b4b4b", accent: "#8a8a8a", empty: "#e2e2e2" },
  { id: "bone", label: "Bone", paper: "#efe8dc", ink: "#2a241c", soft: "#5a4f40", accent: "#8c6a3f", empty: "#d6cdbd" },
  { id: "charcoal", label: "Charcoal", paper: "#1c1b1a", ink: "#eeeae3", soft: "#b9b3a8", accent: "#b89a5e", empty: "#33312e" },
  { id: "black", label: "Black", paper: "#0c0c0c", ink: "#f2f2f2", soft: "#a6a6a6", accent: "#8f8f8f", empty: "#262626" },
];
/* Where the words sit on a page of their own. */
const TEXT_POS = [
  { id: "top", label: "Top" },
  { id: "middle", label: "Middle" },
  { id: "bottom", label: "Bottom" },
];
/* The studio's logo, at the foot of the closing page and of the film's last
   shot - in print, on the web and in motion alike. */
let LOGO = null;                  // { img, size } while one is set and loaded
// heights of the logo itself, its empty margin cut away
const LOGO_SIZES = { s: 4.5, m: 6.5, l: 9.5 };
function logoH(G) { return LOGO && LOGO.img ? (LOGO_SIZES[LOGO.size] || LOGO_SIZES.m) * G.f : 0; }
function drawLogo(ctx, k, G, x, bottom, maxW) {
  if (!LOGO || !LOGO.img) return;
  const im = LOGO.img;
  const iw = im.naturalWidth || im.width, ih = im.naturalHeight || im.height;
  const r = iw && ih ? iw / ih : 3;
  let h = logoH(G), w = h * r;
  const most = Math.min(maxW, 90 * G.f);
  if (w > most) { w = most; h = w / r; }
  ctx.drawImage(im, x * k, (bottom - h) * k, w * k, h * k);
}
/* A logo with the empty margin round it cut away - transparent, or the plain
   colour of its corners - so it lines up with the words above it. An SVG is
   drawn large first, to stay sharp. */
function trimLogo(im) {
  try {
    let w = im.naturalWidth || im.width, h = im.naturalHeight || im.height;
    if (!w || !h) return im;
    const svg = /\.svg(\?|$)/i.test(im.src || "") || /name=[^&]*\.svg/i.test(im.src || "");
    const up = svg ? Math.max(1, Math.min(12, 2400 / w)) : 1;
    w = Math.round(w * up); h = Math.round(h * up);
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(im, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;
    const at = (x, y) => (y * w + x) * 4;
    const corners = [at(0, 0), at(w - 1, 0), at(0, h - 1), at(w - 1, h - 1)];
    const clear = corners.every(i => d[i + 3] < 12);
    const c0 = corners[0];
    const same = !clear && corners.every(i => Math.abs(d[i] - d[c0]) + Math.abs(d[i + 1] - d[c0 + 1]) + Math.abs(d[i + 2] - d[c0 + 2]) < 24 && d[i + 3] > 240);
    if (!clear && !same) return cv;
    const empty = (i) => clear ? d[i + 3] < 12
      : Math.abs(d[i] - d[c0]) + Math.abs(d[i + 1] - d[c0 + 1]) + Math.abs(d[i + 2] - d[c0 + 2]) < 24;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (empty(at(x, y))) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    if (x1 < x0 || y1 < y0) return cv;
    const out = document.createElement("canvas");
    out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
    out.getContext("2d").drawImage(cv, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
    cv.width = cv.height = 0;
    return out;
  } catch (e) {
    return im;
  }
}
let EMPTY = "#dcd8cf";            // a picture still on its way - set from the theme
const ON_PHOTO = "#f4f1ea";

const TEMPLATES = {
  A: "Opener", A2: "Introduction", B: "Full", C: "Photo | text",
  D: "Pair", E: "Framed", F: "Closing", O: "Text on photo",
};

/* The Series Book's colours for a series, by its place in the book's list -
   the node wears the colour of the series it lays out. */
const SERIES_TONES = ["#22c3d6", "#c9a33f", "#f05aa8", "#2fcf7f", "#3a7bff",
                      "#9a7cff", "#ff8a3d", "#ff5555", "#a8b0bc",
                      "#b6e33a", "#e04cf0", "#58c8ff"];
const BOOK = "LeielSeriesBook";
function seriesTone(h) {
  return Number.isInteger(h) && SERIES_TONES[h] && h !== 1 ? SERIES_TONES[h] : SERIES_TONES[0];
}
/* A series' colour as the Series Book on the canvas wears it now. */
function liveTone(name) {
  const nodes = (app.graph && (app.graph._nodes || app.graph.nodes)) || [];
  for (const n of nodes) {
    if ((n.comfyClass || n.type) !== BOOK) continue;
    for (const w of n.widgets || []) {
      if (!w.element) continue;
      for (const box of w.element.querySelectorAll(".lsb-pbox")) {
        const nm = box.querySelector(".lsb-gname");
        if (!nm || nm.textContent.trim() !== name) continue;
        const tone = box.style.getPropertyValue("--sg").trim()
          || (box.querySelector(".lsb-gtone") && box.querySelector(".lsb-gtone").style.getPropertyValue("--gt").trim());
        if (tone) return tone;
      }
    }
  }
  return "";
}

// ---- fonts: two ship with the pack, so a page looks the same everywhere
const FONT_DIR = new URL("./fonts/", import.meta.url).href;
const LATIN = "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD";
const LATIN_EXT = "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF";
const SHIPPED = { "Cormorant Garamond": "VLY Serif", "Inter": "VLY Sans" };
const DEFAULT_FONTS = { title: "Cormorant Garamond", body: "Inter" };
let fontsReady = null;
function loadFonts() {
  if (fontsReady) return fontsReady;
  const faces = [];
  const add = (family, file, weight, style) => {
    for (const [sub, range] of [["latin", LATIN], ["latin-ext", LATIN_EXT]]) {
      faces.push(new FontFace(family, `url(${FONT_DIR}${file.replace("{s}", sub)})`,
        { weight: String(weight), style, unicodeRange: range }));
    }
  };
  add("VLY Serif", "cormorant-garamond-{s}-500-normal.woff2", 500, "normal");
  add("VLY Serif", "cormorant-garamond-{s}-500-italic.woff2", 500, "italic");
  add("VLY Sans", "inter-{s}-400-normal.woff2", 400, "normal");
  add("VLY Sans", "inter-{s}-500-normal.woff2", 500, "normal");
  fontsReady = Promise.all(faces.map(f => f.load().then(() => document.fonts.add(f)).catch(() => null)));
  return fontsReady;
}
/* A family as the canvas asks for it: the shipped faces under their own
   names, then a CJK and a generic face for what the chosen one lacks. */
function stack(name, serif) {
  const fam = SHIPPED[name] || name;
  return `"${fam}", "${serif ? "VLY Serif" : "VLY Sans"}", "Malgun Gothic", "Apple SD Gothic Neo", ${serif ? "serif" : "sans-serif"}`;
}
async function fontsFor(fonts) {
  await loadFonts();
  const want = [];
  for (const name of [fonts.title, fonts.body]) {
    if (SHIPPED[name]) continue;
    want.push(`500 20px "${name}"`, `italic 500 20px "${name}"`, `400 20px "${name}"`);
  }
  await Promise.all(want.map(w => document.fonts.load(w).catch(() => null)));
}
let localFonts = null;          // families on this computer, once asked for
async function askLocalFonts() {
  if (localFonts) return localFonts;
  if (!window.queryLocalFonts) throw new Error("this browser cannot list the fonts on the computer");
  const all = await window.queryLocalFonts();
  localFonts = [...new Set(all.map(f => f.family))].sort((a, b) => a.localeCompare(b));
  return localFonts;
}

// ---- pictures
const pictures = new Map();     // "id@side" -> Promise<HTMLImageElement|null>
function picture(id, side) {
  const key = `${id}@${side}`;
  let p = pictures.get(key);
  if (!p) {
    p = new Promise((resolve) => {
      const im = new Image();
      im.decoding = "async";
      im.onload = () => resolve(im);
      im.onerror = () => { pictures.delete(key); resolve(null); };
      im.src = `${api.apiURL(PICTURE_URL)}?id=${encodeURIComponent(id)}&s=${side}`;
    });
    pictures.set(key, p);
    // the full-size originals are only wanted for an export
    if (side === 0) p.then(() => setTimeout(() => pictures.delete(key), 1000));
  }
  return p;
}

function linkedPicture(path, side) {
  const key = `hd:${path}@${side}`;
  let p = pictures.get(key);
  if (!p) {
    p = new Promise((resolve) => {
      const im = new Image();
      im.decoding = "async";
      im.onload = () => resolve(im);
      im.onerror = () => { pictures.delete(key); resolve(null); };
      im.src = `${api.apiURL(LINKED_URL)}?path=${encodeURIComponent(path)}&s=${side}`;
    });
    pictures.set(key, p);
    if (side === 0) p.then(() => setTimeout(() => pictures.delete(key), 1000));
  }
  return p;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

const ICON = {
  note: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5.5l11-2.5v12.5"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="15.5" r="2.5"/></svg>`,
  layout: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><path d="M12 4.5v15M3.5 12h8.5"/></svg>`,
  left: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>`,
  right: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>`,
  full: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>`,
  refresh: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v4h-4"/></svg>`,
  open: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7.5V18a1.5 1.5 0 0 0 1.5 1.5h13.2a1.5 1.5 0 0 0 1.45-1.1L21 11.5H7.2a1.5 1.5 0 0 0-1.45 1.1L3.6 19M3 7.5V6a1.5 1.5 0 0 1 1.5-1.5h4l2 2.5h7A1.5 1.5 0 0 1 19 8.5v3"/></svg>`,
  close: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>`,
  // the Series Book's own save mark, a disk
  save: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M2.5 3.5a1 1 0 0 1 1-1h7.6l2.4 2.4v7.6a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z"/><path d="M5 2.5v3.2h5V2.5M5 13.5V9.5h6v4"/></svg>`,
  type: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7V5h11v2M9.5 5v14M7 19h5M14 12v-1.5h6V12M17 10.5V19M15.5 19h3"/></svg>`,
  undo: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6 4 10l4 4"/><path d="M4 10h10a6 6 0 0 1 0 12h-3"/></svg>`,
  redo: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16 6l4 4-4 4"/><path d="M20 10H10a6 6 0 0 0 0 12h3"/></svg>`,
};

// ------------------------------------------------------------ the layout
/* The picks of a scene chosen for the layout, in the order they were
   rendered - all of them go into the cut's place on the page. */
function chosenPicks(scene, st) {
  if (!scene.picks.length) return [];
  const sel = (st.sel && st.sel[scene.no]) || (st.pick && st.pick[scene.no] != null ? [st.pick[scene.no]] : null);
  if (sel && sel.length) {
    // in the order kept for the cut - the order rendered, unless a picture
    // was swapped into another one's place
    const byId = new Map(scene.picks.map(p => [String(p.id), p]));
    const hit = [];
    for (const id of sel) { const p = byId.get(String(id)); if (p && !hit.includes(p)) hit.push(p); }
    if (hit.length) return hit;
  }
  return [scene.picks[0]];
}
function chosenPick(scene, st) {
  return chosenPicks(scene, st)[0] || null;
}
function ratio(pick) {
  const p = pick && pick.hd ? pick.hd : pick;
  return p && p.w && p.h ? p.w / p.h : 0.75;
}
function isLand(pick, frame) {
  if (pick && pick.w && pick.h) return pick.w > pick.h * 1.05;
  return frame === "landscape";
}

/* A pick with the upscaled picture linked to it, when there is one. */
function withHd(pick, st) {
  const hd = pick && st.hd && st.hd[String(pick.id)];
  return hd ? { ...pick, hd } : pick;
}

/* The cuts on the page, each with every pick chosen for it. A cut whose
   page was removed is left out. */
function pickedCuts(book, st) {
  const cuts = [];
  for (const s of book.scenes) {
    if (st.off && st.off["c:" + s.no]) continue;
    const picks = chosenPicks(s, st).map(p => withHd(p, st));
    if (!picks.length) continue;
    cuts.push({ ...s, pick: picks[0], picks, land: isLand(picks[0], s.frame) });
  }
  return cuts;
}

/* All the picks of the series, for choosing the cover. */
function allPicks(book) {
  const out = [];
  for (const s of book.scenes) for (const p of s.picks) out.push({ ...p, scene: s });
  return out;
}

function coverOf(book, st, cuts) {
  for (const s of book.scenes) {
    const hit = s.picks.find(p => String(p.id) === String(st.cover));
    if (hit) return withHd(hit, st);
  }
  return (cuts.find(c => !c.land) || cuts[0] || {}).pick || null;
}

/* The shape of a web frame decides how it is laid out. */
function shapeOf(G) {
  const r = G.pw / G.ph;
  return r > 1.3 ? "wide" : r < 0.7 ? "tall" : "frame";
}

/* How the opener is laid out. */
const COVERS = {
  print: [
    { id: "split", label: "Title | Cover", hint: "The title and note on the left page, the cover on the right" },
    { id: "flip", label: "Cover | Title", hint: "The cover on the left page, the title and note on the right" },
    { id: "full", label: "Cover spread", hint: "The cover across both pages, the title on it" },
    { id: "type", label: "Title only", hint: "The title and note alone, no picture" },
  ],
  web: [
    { id: "on", label: "Title on cover", hint: "The cover fills the frame, the title on it" },
    { id: "under", label: "Title by cover", hint: "The cover and the title share the frame - beside it in a wide frame, under it otherwise" },
    { id: "type", label: "Title only", hint: "The title and note alone, no picture" },
  ],
};

/* The cuts of a series as sheets: spreads in print, frames on the web.
   Every sheet has an id, by which it can be removed and given its own
   placing of words. */
function buildSheets(book, st, G) {
  const cuts = pickedCuts(book, st);
  const cover = coverOf(book, st, cuts);
  const all = G.cat === "web" ? webSheets(book, st, G, cuts, cover) : printSheets(st, cuts, cover);
  const out = all.filter(sh => !(st.off && st.off[sh.id]));
  // how the pictures of a cut share their place, where the page says
  for (const sh of out) {
    const key = `${G.cat}:${sh.id}`;
    const sp = st.split && st.split[key];
    if (sp) sh.split = sp;
    const sw = st.splitW && st.splitW[key];
    if (sw) sh.splitW = sw;
  }
  return out;
}

function printSheets(st, cuts, cover) {
  const style = COVERS.print.some(c => c.id === st.coverStyle) ? st.coverStyle : "split";
  const sheets = [{ t: "A", cover: style === "type" ? null : cover, style, id: "A" }];
  if (!cuts.length) return sheets;
  // the last cut closes the series when it is a single portrait left to itself
  const last = cuts[cuts.length - 1];
  let tail = cuts.length > 1 && !last.land && !st.tpl[last.no] && last.picks.length === 1 ? last : null;
  const body = tail ? cuts.slice(0, -1) : cuts.slice();
  let side = 0;
  for (let i = 0; i < body.length;) {
    const c = body[i];
    let t = st.tpl[c.no] || (c.land ? "B" : "C");
    let partner = body[i + 1];
    if ((t === "D" || t === "E") && !partner && tail) { partner = tail; tail = null; }
    if ((t === "D" || t === "E") && partner) {
      sheets.push({ t, cuts: [c, partner], key: c.no, id: "c:" + c.no });
      i += partner === body[i + 1] ? 2 : 1;
      continue;
    }
    if (t === "D" || t === "E") t = c.land ? "B" : "C";
    if (t === "C") {
      let s = side % 2;
      if (st.flip[c.no]) s = 1 - s;
      sheets.push({ t, cuts: [c], side: s, key: c.no, id: "c:" + c.no, inset: !!(st.inset || {})[c.no] });
      side++;
    } else {
      sheets.push({ t, cuts: [c], key: c.no, id: "c:" + c.no, side: st.flip[c.no] ? 1 : 0, inset: !!(st.inset || {})[c.no] });
    }
    i++;
  }
  sheets.push({ t: "F", cuts: tail ? [tail] : [], list: cuts, id: "F" });
  return sheets;
}

function webSheets(book, st, G, cuts, cover) {
  const shape = shapeOf(G);
  const style = COVERS.web.some(c => c.id === st.coverStyleWeb) ? st.coverStyleWeb : "on";
  const sheets = [{ t: "A", cover: style === "type" ? null : cover, style, id: "A" }];
  // the note gets a frame of its own unless the opener already carries it
  const noteOnCover = style === "type" || (style === "under" && shape === "wide") || (style === "on" && shape === "wide");
  if (book.note && !noteOnCover) sheets.push({ t: "A2", id: "A2" });
  const frame = G.pw / G.ph;
  // a single picture close to the frame's shape fills it; any other sits
  // beside or under its words in a wide or tall frame, and inside the
  // margins in a 4:5 or square one. Several pictures fill the frame together.
  const fits = (c) => c.picks.length > 1 || Math.abs(Math.log(ratio(c.pick) / frame)) < 0.28;
  const auto = (c) => (fits(c) ? "B" : shape === "frame" ? "E" : "C");
  for (let i = 0; i < cuts.length;) {
    const c = cuts[i];
    let t = st.tpl[c.no] || auto(c);
    const partner = cuts[i + 1];
    if ((t === "D" || t === "E") && st.tpl[c.no] && partner) {
      sheets.push({ t, cuts: [c, partner], key: c.no, id: "c:" + c.no });
      i += 2;
      continue;
    }
    if (t === "D") t = auto(c);
    if (t === "C" && shape === "frame") {
      // a frame of the pictures, then a frame of their words
      const first = st.flip[c.no] ? 1 : 0;
      sheets.push({ t, cuts: [c], part: first, key: c.no, id: "c:" + c.no });
      sheets.push({ t, cuts: [c], part: 1 - first, key: c.no, id: `c:${c.no}:w` });
    } else {
      sheets.push({ t, cuts: [c], key: c.no, id: "c:" + c.no, flip: !!st.flip[c.no] });
    }
    i++;
  }
  if (cuts.length) sheets.push({ t: "F", cuts: [], list: cuts, id: "F" });
  return sheets;
}

function sheetPicks(sh) {
  const ids = [];
  if (sh.cover) ids.push(sh.cover);
  for (const c of sh.cuts || []) ids.push(...(c.picks || [c.pick]));
  return ids;
}

/* Sheets whose words have a place of their own on the page. */
function hasWords(sh, G) {
  if (sh.t === "A") return sh.style !== "full" || G.cat !== "web";
  if (sh.t === "A2" || sh.t === "O") return true;
  if (sh.t === "C") return G.cat !== "web" || shapeOf(G) !== "frame" || sh.part === 1;
  return false;
}

/* Cells for n pictures in a box, with a gap of paper between them. Every
   way of sharing the box is tried - side by side, one above the other, one
   picture large with the others beside or under it, grids - and the one
   that cuts the least off the pictures, given their shapes, is used. */
/* The ways several picks can share one place, by how many there are: each a
   tree of rows (h) and columns (v) whose leaves are the picks in order, with
   the share each part takes to begin with. The page chooses one, or Auto
   takes the one that cuts the least off the pictures; the lines between the
   parts are dragged to change the shares. Five picks and more: a row, a
   stack, or Auto's grid. */
const AH = (...k) => ({ d: "h", k }), AV = (...k) => ({ d: "v", k });
const ARRANGE = {
  2: [
    { id: "row", label: "Side by side", t: AH(0, 1) },
    { id: "col", label: "Stacked", t: AV(0, 1) },
    { id: "l1", label: "Large and small", t: AH(0, 1), w: { r: [0.64, 0.36] } },
    { id: "t1", label: "Large over small", t: AV(0, 1), w: { r: [0.64, 0.36] } },
  ],
  3: [
    { id: "row", label: "In a row", t: AH(0, 1, 2) },
    { id: "col", label: "Stacked", t: AV(0, 1, 2) },
    { id: "l1", label: "One left, two right", t: AH(0, AV(1, 2)), w: { r: [0.6, 0.4] } },
    { id: "r1", label: "Two left, one right", t: AH(AV(0, 1), 2), w: { r: [0.4, 0.6] } },
    { id: "t1", label: "One over two", t: AV(0, AH(1, 2)), w: { r: [0.58, 0.42] } },
    { id: "b1", label: "Two over one", t: AV(AH(0, 1), 2), w: { r: [0.42, 0.58] } },
  ],
  4: [
    { id: "grid", label: "Grid", t: AV(AH(0, 1), AH(2, 3)) },
    { id: "row", label: "In a row", t: AH(0, 1, 2, 3) },
    { id: "col", label: "Stacked", t: AV(0, 1, 2, 3) },
    { id: "l1", label: "One large, three beside", t: AH(0, AV(1, 2, 3)), w: { r: [0.66, 0.34] } },
    { id: "t1", label: "One large, three under", t: AV(0, AH(1, 2, 3)), w: { r: [0.62, 0.38] } },
  ],
};
function arrangeOf(n, id) {
  if (n >= 2 && n <= 4) return (ARRANGE[n] || []).find(a => a.id === id) || null;
  if (id === "row") return { id: "row", label: "In a row", t: AH(...Array.from({ length: n }, (_, i) => i)) };
  if (id === "col") return { id: "col", label: "Stacked", t: AV(...Array.from({ length: n }, (_, i) => i)) };
  return null;
}
/* The cells of an arrangement in a box, and the lines between its parts. */
function treeCells(a, W, x, y, w, h, gap, divs) {
  const out = [];
  const walk = (node, path, x, y, w, h) => {
    if (typeof node === "number") { out[node] = { x, y, w, h }; return; }
    const m = node.k.length, along = node.d === "h" ? w : h;
    const avail = Math.max(1e-6, along - gap * (m - 1));
    let ws = (W && W[path]) || (a.w && a.w[path]) || null;
    if (!ws || ws.length !== m) ws = Array(m).fill(1 / m);
    const sum = ws.reduce((p, q) => p + q, 0) || 1;
    let pos = node.d === "h" ? x : y;
    node.k.forEach((kid, i) => {
      const size = avail * ws[i] / sum;
      if (node.d === "h") walk(kid, `${path}.${i}`, pos, y, size, h);
      else walk(kid, `${path}.${i}`, x, pos, w, size);
      pos += size;
      if (i < m - 1) {
        if (divs) divs.push({ path, i, d: node.d, at: pos + gap / 2, box: { x, y, w, h }, avail, ws: ws.map(v => v / sum) });
        pos += gap;
      }
    });
  };
  walk(a.t, "r", x, y, w, h);
  return out;
}
/* How much an arrangement cuts off the pictures - the smaller the better. */
function cutScore(cells, rs) {
  let sc = 0;
  cells.forEach((c, i) => { sc += Math.abs(Math.log((c.w / c.h) / rs[i])); });
  return sc;
}
/* The arrangement a page uses: its own, or the one Auto finds. */
function resolveArrange(n, mode, x, y, w, h, gap, rs) {
  const own = mode && arrangeOf(n, mode);
  if (own) return own;
  if (n < 2 || n > 4) return null;
  let best = null, score = Infinity;
  for (const a of ARRANGE[n]) {
    const sc = cutScore(treeCells(a, null, x, y, w, h, gap), rs);
    if (sc < score - 1e-9) { score = sc; best = a; }
  }
  return best;
}
let DIVS = null;      // while the stage is drawn: the lines between pictures that can be dragged
function gridCells(n, x, y, w, h, gap, ratios, mode, W, tag) {
  if (n <= 1) return [{ x, y, w, h }];
  const rs0 = ratios && ratios.length === n ? ratios : Array(n).fill(w / h / n);
  const a = resolveArrange(n, mode, x, y, w, h, gap, rs0);
  if (a) {
    const divs = DIVS && tag ? [] : null;
    // the shares dragged on the page belong to the arrangement they were dragged in
    const own = W && W._a === a.id ? W : null;
    const cells = treeCells(a, own, x, y, w, h, gap, divs);
    if (divs) for (const d of divs) DIVS.push({ ...d, arr: a.id, tag });
    return cells;
  }

  const rs = ratios && ratios.length === n ? ratios : Array(n).fill(w / h / n);
  const rowsOf = (counts) => {
    // rows of equal height, each row split evenly
    const rh = (h - gap * (counts.length - 1)) / counts.length;
    const out = [];
    counts.forEach((m, r) => {
      const cw = (w - gap * (m - 1)) / m;
      for (let c = 0; c < m; c++) out.push({ x: x + c * (cw + gap), y: y + r * (rh + gap), w: cw, h: rh });
    });
    return out;
  };
  const colsOf = (counts) => {
    const cw = (w - gap * (counts.length - 1)) / counts.length;
    const out = [];
    counts.forEach((m, c) => {
      const rh = (h - gap * (m - 1)) / m;
      for (let r = 0; r < m; r++) out.push({ x: x + c * (cw + gap), y: y + r * (rh + gap), w: cw, h: rh });
    });
    return out;
  };
  const cands = [];
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const counts = Array.from({ length: rows }, (_, r) => Math.min(cols, n - r * cols));
    cands.push(rowsOf(counts));
    if (cols > 1 && n % cols) cands.push(colsOf(Array.from({ length: cols }, (_, c) => Math.ceil((n - c) / cols))));
  }
  if (n === 3) {
    const bw = (w - gap) * 0.6, sw = w - gap - bw, sh = (h - gap) / 2;
    cands.push([{ x, y, w: bw, h }, { x: x + bw + gap, y, w: sw, h: sh }, { x: x + bw + gap, y: y + sh + gap, w: sw, h: sh }]);
    const bh = (h - gap) * 0.6, s2 = h - gap - bh, hw = (w - gap) / 2;
    cands.push([{ x, y, w, h: bh }, { x, y: y + bh + gap, w: hw, h: s2 }, { x: x + hw + gap, y: y + bh + gap, w: hw, h: s2 }]);
  }
  let best = cands[0], score = Infinity;
  for (const cells of cands) {
    if (cells.length !== n) continue;
    // how much is cut off, and a little against cells far from even
    let sc = 0;
    cells.forEach((c, i) => { sc += Math.abs(Math.log((c.w / c.h) / rs[i])); });
    if (sc < score - 1e-9) { score = sc; best = cells; }
  }
  return best;
}
function gapOf(G) { return 3 * G.f; }

// ------------------------------------------------------------ drawing
function setFont(ctx, k, family, pt, weight, italic) {
  ctx.font = `${italic ? "italic " : ""}${weight} ${pt * PT * k}px ${family}`;
}
function setTrack(ctx, k, pt, em) {
  if ("letterSpacing" in ctx) ctx.letterSpacing = `${em * pt * PT * k}px`;
}
function wrapLine(ctx, text, maxW) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const w of words) {
    const next = line ? line + " " + w : w;
    if (line && ctx.measureText(next).width > maxW) {
      lines.push(line);
      line = w;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}
/* Paragraphs wrapped to a width: a line of text, or null for the gap
   between two paragraphs. */
function wrapText(ctx, k, text, width) {
  const out = [];
  String(text || "").split(/\n+/).map(p => p.trim()).filter(Boolean).forEach((p, i) => {
    if (i) out.push(null);
    out.push(...wrapLine(ctx, p, width * k));
  });
  return out;
}
function linesHeight(lines, lead) {
  let h = 0;
  lines.forEach((ln, i) => { if (i) h += ln === null || lines[i - 1] === null ? lead * 0.55 : lead; });
  return h;
}
/* While an InDesign document is made, every picture and block of words a
   page draws is also written down here - where it sits, in millimetres, and
   what it says - so the document is the page, frame for frame. */
let REC = null;
let LASTPICK = null;
/* Where each picture sits in a frame that crops it, per print or web size:
   pick id -> [fx, fy], each from -1 to 1, 0 the middle. HITS, while the
   stage is drawn, gathers every cropped picture so it can be dragged. */
let FOCUS = null;
let HITS = null;
function focusKey(G) { return `${G.cat}:${G.fmt.id}`; }
const KASC = 0.72;                 // the ascent of a line, as a share of its size
function faceOf(name, weight, italic) {
  if (name === "Cormorant Garamond") return italic ? "Medium Italic" : "Medium";
  if (name === "Inter") return weight >= 500 ? "Medium" : "Regular";
  if (italic) return weight >= 500 ? "Medium Italic" : "Italic";
  return weight >= 500 ? "Medium" : "Regular";
}
function para(role, text, font, weight, italic, pt, leadMm, track, color, align, beforeMm, more) {
  return { role, text, font, face: faceOf(font, weight, italic), size: pt, lead: leadMm * 72 / 25.4,
    track: Math.round((track || 0) * 1000), color, align: align || "left",
    before: beforeMm == null ? null : Math.max(0, beforeMm), ...(more || {}) };
}
function recText(x, y, w, h, first, paras) {
  if (REC) REC.push({ k: "text", x, y, w: Math.max(4, w), h: Math.max(4, h), first, paras });
}

/* Words set flush right are drawn from the right edge of their column:
   ALIGN holds that edge while a block set that way is drawn. */
let ALIGN = null;
/* Centred words: ALIGN is then the middle of the column, not its edge. */
let ALIGNC = false;
/* Set the side for a column from x, w wide, by the page's own setting -
   left leaves ALIGN as it was. Returns what to put back afterwards. */
function alignAt(G, x, w) {
  const before = [ALIGN, ALIGNC];
  if (G.al === "right") { ALIGN = x + w; ALIGNC = false; }
  else if (G.al === "center") { ALIGN = x + w / 2; ALIGNC = true; }
  return before;
}
function alignBack(before) { ALIGN = before[0]; ALIGNC = before[1]; }
function drawLines(ctx, k, lines, x, y, lead) {
  let by = y;
  const right = ALIGN != null;
  ctx.textAlign = right ? (ALIGNC ? "center" : "right") : "left";
  lines.forEach((ln, i) => {
    if (i) by += ln === null || lines[i - 1] === null ? lead * 0.55 : lead;
    if (ln) ctx.fillText(ln, (right ? ALIGN : x) * k, by * k);
  });
  ctx.textAlign = "left";
  return by;
}
/* A short rule under a title, at the side the words are set to. */
function rule(ctx, k, x, y, w, len) {
  const rx = ALIGN != null ? ALIGN - (ALIGNC ? len / 2 : len) : x;
  ctx.fillRect(rx * k, y * k, len * k, Math.max(1, 0.25 * k));
}
function clip(lines, max) {
  if (lines.length <= max) return lines;
  const out = lines.slice(0, Math.max(0, max));
  while (out.length && out[out.length - 1] === null) out.pop();
  if (out.length) out[out.length - 1] = String(out[out.length - 1]).replace(/\s*\S*$/, "") + "…";
  return out;
}

function photoCover(ctx, k, img, x, y, w, h) {
  const id = LASTPICK ? String(LASTPICK.id) : "";
  const fc = (id && FOCUS && FOCUS[id]) || null;
  const fx = fc ? Math.max(-1, Math.min(1, Number(fc[0]) || 0)) : 0;
  const fy = fc ? Math.max(-1, Math.min(1, Number(fc[1]) || 0)) : 0;
  if (REC && LASTPICK) REC.push({ k: "img", x, y, w, h, fit: "cover", id: LASTPICK.id, fx, fy });
  const ir = img ? img.naturalWidth / img.naturalHeight : (LASTPICK ? ratio(LASTPICK) : w / h);
  const br = w / h;
  // what the frame leaves out of the picture, in page units
  if (HITS && id) HITS.push({ x, y, w, h, id, ox: ir > br ? h * ir - w : 0, oy: ir > br ? 0 : w / ir - h });
  if (!img) {
    ctx.fillStyle = EMPTY;
    ctx.fillRect(x * k, y * k, w * k, h * k);
    return;
  }
  let sw = img.naturalWidth, sh = img.naturalHeight, sx = 0, sy = 0;
  // dragged right (fx > 0) the picture moves right, showing more of its left
  if (ir > br) { sw = sh * br; sx = (img.naturalWidth - sw) / 2 * (1 - fx); }
  else { sh = sw / br; sy = (img.naturalHeight - sh) / 2 * (1 - fy); }
  ctx.drawImage(img, sx, sy, sw, sh, x * k, y * k, w * k, h * k);
}

/* Fitted inside the box, nothing cut; returns where it landed. */
function photoContain(ctx, k, img, pick, x, y, w, h, alignTop) {
  const ir = img ? img.naturalWidth / img.naturalHeight : ratio(pick);
  let dw = w, dh = w / ir;
  if (dh > h) { dh = h; dw = h * ir; }
  const dx = x + (w - dw) / 2;
  const dy = alignTop ? y : y + (h - dh) / 2;
  if (REC && LASTPICK) REC.push({ k: "img", x: dx, y: dy, w: dw, h: dh, fit: "contain", id: LASTPICK.id });
  if (img) ctx.drawImage(img, dx * k, dy * k, dw * k, dh * k);
  else { ctx.fillStyle = EMPTY; ctx.fillRect(dx * k, dy * k, dw * k, dh * k); }
  return { x: dx, y: dy, w: dw, h: dh };
}

/* Every chosen picture of a cut in a box: one fills it, several share it. */
function photoSet(ctx, k, G, img, picks, x, y, w, h) {
  const cells = gridCells(picks.length, x, y, w, h, gapOf(G), picks.map(ratio), G.split, G.splitW, G.splitTag);
  picks.forEach((p, i) => photoCover(ctx, k, img(p), cells[i].x, cells[i].y, cells[i].w, cells[i].h));
  return cells;
}

/* Which words a page carries: its title, its text, both or neither. */
function showsTitle(G) { return G.show !== "text" && G.show !== "none"; }
function showsText(G) { return G.show !== "title" && G.show !== "none"; }

function cutLabel(cut) {
  return cut.label || cut.no;
}

function cornerLabel(ctx, k, G, cut, x, y, align, withCaption) {
  const pt = 6.5 * G.f * G.sx;
  const label = showsTitle(G) ? cutLabel(cut) : "";
  const rest = withCaption && showsText(G) ? (cut.caption || cut.title) : "";
  if (!label && !rest) return;
  if (REC) {
    const w = 200 * G.f;
    recText(align === "right" ? x - w : x, y - pt * PT * KASC, w, pt * PT * 2, pt * PT * KASC,
      [para("Label", rest && label ? `${label}  ${rest}` : label || rest, G.bf, 400, false, pt, pt * 1.3 * PT, 0.04, ON_PHOTO, align)]);
  }
  ctx.fillStyle = ON_PHOTO;
  ctx.textAlign = "left";
  setFont(ctx, k, stack(G.bf), pt, 500, false);
  setTrack(ctx, k, pt, 0.12);
  const lw = label ? ctx.measureText(label).width / k : 0;
  setTrack(ctx, k, pt, 0);
  setFont(ctx, k, stack(G.bf), pt, 400, false);
  const gap = rest && label ? 3 * G.f : 0;
  const rw = rest ? ctx.measureText(rest).width / k : 0;
  const x0 = align === "right" ? x - (lw + gap + rw) : x;
  setFont(ctx, k, stack(G.bf), pt, 500, false);
  setTrack(ctx, k, pt, 0.12);
  ctx.fillText(label, x0 * k, y * k);
  setTrack(ctx, k, pt, 0);
  if (rest) {
    setFont(ctx, k, stack(G.bf), pt, 400, false);
    ctx.fillText(rest, (x0 + lw + gap) * k, y * k);
  }
}

function kicker(ctx, k, G, text, x, y, color) {
  const pt = 7 * G.f * G.sx;
  ctx.fillStyle = color || G.c.accent;
  setFont(ctx, k, stack(G.bf), pt, 500, false);
  if (ALIGN != null) {
    // no tracking after the last letter, so the right edge stays true
    ctx.textAlign = ALIGNC ? "center" : "right";
    setTrack(ctx, k, pt, 0.22);
    const t = String(text).toUpperCase();
    const tail = ctx.measureText(t).width - ctx.measureText(t.slice(0, -1)).width
      - (setTrack(ctx, k, pt, 0), ctx.measureText(t.slice(-1)).width);
    setTrack(ctx, k, pt, 0.22);
    ctx.fillText(t, ALIGN * k + Math.max(0, tail) * (ALIGNC ? 0.5 : 1), y * k);
    ctx.textAlign = "left";
  } else {
    setTrack(ctx, k, pt, 0.22);
    ctx.fillText(String(text).toUpperCase(), x * k, y * k);
  }
  setTrack(ctx, k, pt, 0);
}

/* The box of the pictures of a sheet set inside the margins (Inset): on
   one page, or across the spread. */
function insetBox(G, spread, page) {
  const { pw, ph, M } = G;
  if (spread) return { x: M.outer, y: M.top, w: pw * 2 - M.outer * 2, h: ph - M.top - M.bottom };
  return { x: page === 0 ? M.outer : pw + M.inner, y: M.top, w: pw - M.outer - M.inner, h: ph - M.top - M.bottom };
}

/* The inks of words set on a picture. */
function onPhoto(G) {
  return { ...G, c: { ...G.c, ink: ON_PHOTO, soft: "#ebe6dc", accent: "#e6cf98" } };
}

/* The words of one cut in an area of their own: number, title, a short rule,
   the caption, the note, and at the foot of the area the text added in the
   layout. Where the block sits - top, middle or bottom - is the page's own
   or the layout's; a long note moves it up, and what still does not fit is
   cut with an ellipsis. */
function textPage(ctx, k, G, cut, extra, x, width, area) {
  const before = alignAt(G, x, width);
  try { textBlockOf(ctx, k, G, cut, extra, x, width, area); } finally { alignBack(before); }
}
function textBlockOf(ctx, k, G, cut, extra, x, width, area) {
  const f = G.f, ts = G.st, xs = G.sx;
  const top = (area ? area.top : G.M.top) + 6 * f, bottom = area ? area.bottom : G.ph - G.M.bottom;
  const T = { title: 22 * f * ts, cap: 11.5 * f * xs, body: 8.5 * f * xs, extra: 8 * f * xs };
  const lead = { title: T.title * 1.08 * PT, cap: T.cap * 1.42 * PT, body: T.body * 1.6 * PT, extra: T.extra * 1.55 * PT };

  // what the page shows: the number and title, the words under them, or both
  const showT = showsTitle(G), showX = showsText(G);
  setFont(ctx, k, stack(G.tf, true), T.title, 500, false);
  const titleL = showT ? clip(wrapText(ctx, k, cut.title, width), 3) : [];
  setFont(ctx, k, stack(G.tf, true), T.cap, 500, true);
  const capL = showX && cut.caption ? clip(wrapText(ctx, k, cut.caption, Math.min(width, 130 * f)), 4) : [];
  setFont(ctx, k, stack(G.bf), T.body, 400, false);
  let bodyL = showX && cut.body ? wrapText(ctx, k, cut.body, Math.min(width, 128 * f)) : [];
  setFont(ctx, k, stack(G.bf), T.extra, 400, false);
  const extraL = showX && extra ? clip(wrapText(ctx, k, extra, Math.min(width, 128 * f)), 8) : [];

  const extraH = extraL.length ? linesHeight(extraL, lead.extra) : 0;
  const extraFirst = bottom - extraH;
  const limit = extraL.length ? extraFirst - T.extra * PT - 9 * f : bottom;

  const head = (showT ? 11 * f * Math.max(1, ts) + linesHeight(titleL, lead.title) + 6 * f : 0)
    + (capL.length ? (showT ? 9 * f : 0) + linesHeight(capL, lead.cap) : 0);
  const bodyGap = showT || capL.length ? 9 * f : 0;
  const room = limit - top - head - (bodyL.length ? bodyGap : 0);
  let bodyH = bodyL.length ? linesHeight(bodyL, lead.body) : 0;
  while (bodyL.length && bodyH > room) {
    bodyL = clip(bodyL, bodyL.length - 1);
    bodyH = bodyL.length ? linesHeight(bodyL, lead.body) : 0;
  }
  const blockH = head + (bodyL.length ? bodyGap + bodyH : 0);
  const span = limit - top;
  const want = G.tp === "top" ? top + 8 * f
    : G.tp === "bottom" ? limit - blockH
      : top + span * (G.cat === "web" ? 0.3 : 0.38);
  const y0 = Math.max(top, Math.min(want, limit - blockH));

  if (REC) {
    const kp = 7 * f * xs, al = G.al;
    const ruleR = { color: G.c.accent, weight: 0.25, offset: 6 * f - 0.25,
      left: al === "right" ? Math.max(0, width - 10 * f) : al === "center" ? Math.max(0, (width - 10 * f) / 2) : 0,
      right: al === "right" ? 0 : al === "center" ? Math.max(0, (width - 10 * f) / 2) : Math.max(0, width - 10 * f) };
    const paras = showT ? [
      para("Number", String(cutLabel(cut)).toUpperCase(), G.bf, 500, false, kp, kp * 1.3 * PT, 0.22, G.c.accent, al),
      para("Title", cut.title, G.tf, 500, false, T.title, lead.title, 0, G.c.ink, al,
        11 * f * Math.max(1, ts) - lead.title, { rule: ruleR }),
    ] : [];
    if (capL.length) paras.push(para("Caption", cut.caption, G.tf, 500, true, T.cap, lead.cap, 0, G.c.soft, al,
      showT ? 15 * f - lead.cap : null, { indent: Math.max(0, width - 130 * f) }));
    if (bodyL.length) String(cut.body || "").split(/\n+/).map(t => t.trim()).filter(Boolean).forEach((t, i) => {
      paras.push(para("Body", t, G.bf, 400, false, T.body, lead.body, 0, G.c.soft, al,
        i === 0 ? (paras.length ? (capL.length ? 0 : 6 * f) + bodyGap + T.body * PT * 0.4 - lead.body : null) : lead.body * 0.1,
        { indent: Math.max(0, width - 128 * f) }));
    });
    const first = showT ? kp * PT * KASC : capL.length ? T.cap * PT * KASC : T.body * PT * KASC;
    const top0 = y0 - first;
    if (paras.length) recText(x, top0, width, limit - top0, first, paras);
    if (extraL.length) {
      const et = extraFirst - T.extra * PT * KASC;
      recText(x, et, width, bottom - et, T.extra * PT * KASC, [para("Foot", extra, G.bf, 400, false, T.extra, lead.extra, 0, G.c.ink, al, null,
        { indent: Math.max(0, width - 128 * f), rule_above: { color: G.c.accent, weight: 0.25, offset: T.extra * PT + 5 * f - 0.25,
          left: al === "right" ? Math.max(0, width - 6 * f) : al === "center" ? Math.max(0, (width - 6 * f) / 2) : 0,
          right: al === "right" ? 0 : al === "center" ? Math.max(0, (width - 6 * f) / 2) : Math.max(0, width - 6 * f) } })]);
    }
  }
  const rec = REC;
  REC = null;
  try {
  // with no title, the first line of the words sits where the number would
  let by = capL.length ? y0 - 9 * f * (showT ? 1 : 0) : y0 - bodyGap - T.body * PT * 0.4;
  if (showT) {
    kicker(ctx, k, G, cutLabel(cut), x, y0);
    ctx.fillStyle = G.c.ink;
    setFont(ctx, k, stack(G.tf, true), T.title, 500, false);
    by = drawLines(ctx, k, titleL, x, y0 + 11 * f * Math.max(1, ts), lead.title);
    ctx.fillStyle = G.c.accent;
    rule(ctx, k, x, by + 6 * f, width, 10 * f);
    by += 6 * f;
  }
  if (capL.length) {
    ctx.fillStyle = G.c.soft;
    setFont(ctx, k, stack(G.tf, true), T.cap, 500, true);
    by = drawLines(ctx, k, capL, x, showT ? by + 9 * f : y0, lead.cap);
  }
  if (bodyL.length) {
    ctx.fillStyle = G.c.soft;
    setFont(ctx, k, stack(G.bf), T.body, 400, false);
    drawLines(ctx, k, bodyL, x, by + bodyGap + T.body * PT * 0.4, lead.body);
  }
  if (extraL.length) {
    ctx.fillStyle = G.c.accent;
    rule(ctx, k, x, extraFirst - T.extra * PT - 5 * f, width, 6 * f);
    ctx.fillStyle = G.c.ink;
    setFont(ctx, k, stack(G.bf), T.extra, 400, false);
    drawLines(ctx, k, extraL, x, extraFirst, lead.extra);
  }
  } finally { REC = rec; }
}

/* Number, title and caption under a framed picture. */
function smallWords(ctx, k, G, cut, x, y, width) {
  const f = G.f, tp = 13 * f * G.st, cp = 10 * f * G.sx;
  const showT = showsTitle(G), showX = showsText(G) && !!cut.caption;
  if (REC && (showT || showX)) {
    const kp = 7 * f * G.sx;
    const al = G.al || "left";
    const paras = showT ? [para("Number", String(cutLabel(cut)).toUpperCase(), G.bf, 500, false, kp, kp * 1.3 * PT, 0.22, G.c.accent, al),
      para("Small title", cut.title, G.tf, 500, false, tp, tp * 1.08 * PT, 0, G.c.ink, al, 7 * f * Math.max(1, G.st) - tp * 1.08 * PT)] : [];
    if (showX) paras.push(para("Small caption", cut.caption, G.tf, 500, true, cp, cp * 1.42 * PT, 0, G.c.soft, al, showT ? 6 * f - cp * 1.42 * PT : null));
    const first = showT ? kp * PT * KASC : cp * PT * KASC;
    recText(x, y - first, width, 60 * f, first, paras);
  }
  const rec = REC;
  REC = null;
  const before = alignAt(G, x, width);
  try { smallWordsDraw(ctx, k, G, cut, x, y, width, tp, cp); } finally { REC = rec; alignBack(before); }
}
function smallWordsDraw(ctx, k, G, cut, x, y, width, tp, cp) {
  const f = G.f;
  const showT = showsTitle(G), showX = showsText(G);
  let by = y - 6 * f;
  if (showT) {
    kicker(ctx, k, G, cutLabel(cut), x, y);
    ctx.fillStyle = G.c.ink;
    setFont(ctx, k, stack(G.tf, true), tp, 500, false);
    by = drawLines(ctx, k, clip(wrapText(ctx, k, cut.title, width), 2), x, y + 7 * f * Math.max(1, G.st), tp * 1.08 * PT);
  }
  if (showX && cut.caption) {
    ctx.fillStyle = G.c.soft;
    setFont(ctx, k, stack(G.tf, true), cp, 500, true);
    drawLines(ctx, k, clip(wrapText(ctx, k, cut.caption, width), 3), x, by + 6 * f, cp * 1.42 * PT);
  }
}

/* The size of the series title: larger on the cover, the opener. */
const COVER_TITLE = 1.4;
function titlePt(G) {
  return (G.cat === "web" ? 30 : 34) * G.f * G.st * (G.cover ? COVER_TITLE : 1);
}
function titleBlock(ctx, k, G, book, x, y, width, light) {
  const f = G.f;
  kicker(ctx, k, G, book.no ? `Series ${book.no}` : "Series", x, y, light ? ON_PHOTO : null);
  ctx.fillStyle = light ? ON_PHOTO : G.c.ink;
  const pt = titlePt(G);
  setFont(ctx, k, stack(G.tf, true), pt, 500, false);
  return drawLines(ctx, k, clip(wrapText(ctx, k, book.series, width), 4), x, y + 15 * f + pt * PT * 0.6, pt * 1.06 * PT);
}
/* A column of words of width w inside an area from left to right: at its
   left edge, or - set flush right - against its right edge, so the margin
   on the outer side stays the page's own. */
function col(G, left, right, w) {
  const width = Math.min(w, right - left);
  return { x: G.al === "right" ? right - width : G.al === "center" ? left + (right - left - width) / 2 : left, w: width };
}
/* A block of words set at the side the page asks for. */
function aligned(G, x, w, fn) {
  const before = alignAt(G, x, w);
  try { return fn(); } finally { alignBack(before); }
}
function titleHeight(G) {
  const pt = titlePt(G);
  return 15 * G.f + pt * PT * 0.6 + pt * 1.06 * PT;
}

function noteBlock(ctx, k, G, text, x, y, width, maxBottom, light) {
  const f = G.f, pt = 8.5 * f * G.sx, lead = pt * 1.6 * PT;
  ctx.fillStyle = light ? "#ebe6dc" : G.c.soft;
  setFont(ctx, k, stack(G.bf), pt, 400, false);
  let lines = wrapText(ctx, k, text, width);
  while (lines.length && y + linesHeight(lines, lead) > maxBottom) lines = clip(lines, lines.length - 1);
  drawLines(ctx, k, lines, x, y, lead);
}

/* Where the series title sits in an area, by the page's placing of words. */
function titleTop(G, top, bottom) {
  return G.tp === "top" ? top + 10 * G.f : G.tp === "bottom" ? top + (bottom - top) * 0.58 : top + (bottom - top) * 0.3;
}

/* The title, and the note under it, in an area: the block is measured
   first, so Bottom sets its last line on the foot of the area and Middle
   centres it. */
function titleArea(ctx, k, G, book, x, w, top, bottom, light, withNote) {
  const before = alignAt(G, x, w);
  try {
    const f = G.f;
    const pt = titlePt(G);
    // what the page shows: the title, the note, or both
    const showT = showsTitle(G);
    const showN = showsText(G) && (withNote || !showT);
    if (!showT && !showN) return;
    setFont(ctx, k, stack(G.tf, true), pt, 500, false);
    const tl = showT ? clip(wrapText(ctx, k, book.series, w), 4) : [];
    const titleH = showT ? 15 * f + pt * PT * 0.6 + linesHeight(tl, pt * 1.06 * PT) : 0;
    const npt = 8.5 * f * G.sx, nlead = npt * 1.6 * PT;
    setFont(ctx, k, stack(G.bf), npt, 400, false);
    const nw = Math.min(w, 140 * f);
    let nl = showN && book.note ? wrapText(ctx, k, book.note, nw) : [];
    const gap = showT ? 13 * f : 0;
    const room = bottom - top - titleH - gap;
    while (nl.length && linesHeight(nl, nlead) > room) nl = clip(nl, nl.length - 1);
    const H = titleH + (nl.length ? gap + linesHeight(nl, nlead) : 0);
    const y0 = G.tp === "top" ? top + 10 * f
      : G.tp === "bottom" ? bottom - H
        : top + (bottom - top - H) * 0.42;
    if (REC) {
      const kp = 7 * f * G.sx, yy = Math.max(top, y0), al = G.al;
      const paras = showT ? [para("Number", (book.no ? `Series ${book.no}` : "Series").toUpperCase(), G.bf, 500, false, kp, kp * 1.3 * PT, 0.22,
        light ? ON_PHOTO : G.c.accent, al),
      para("Series title", book.series, G.tf, 500, false, pt, pt * 1.06 * PT, 0, light ? ON_PHOTO : G.c.ink, al,
        15 * f + pt * PT * 0.6 - pt * 1.06 * PT)] : [];
      if (nl.length) {
        String(book.note).split(/\n+/).map(t => t.trim()).filter(Boolean).forEach((t, i) => {
          paras.push(para("Note", t, G.bf, 400, false, npt, nlead, 0, light ? "#ebe6dc" : G.c.soft, al,
            i === 0 ? (showT ? gap - nlead : null) : nlead * 0.1, { indent: Math.max(0, w - nw) }));
        });
      }
      const first = showT ? kp * PT * KASC : npt * PT * KASC;
      if (paras.length) recText(x, yy - first, w, bottom - (yy - first), first, paras);
    }
    const rec = REC;
    REC = null;
    // with no title the note's first line sits where the title's number would
    let by = Math.max(top, y0) - gap;
    if (showT) {
      try { by = titleBlock(ctx, k, G, book, x, Math.max(top, y0), w, light); } finally { REC = rec; }
    } else REC = rec;
    const rec2 = REC;
    REC = null;
    try {
    if (nl.length) {
      ctx.fillStyle = light ? "#ebe6dc" : G.c.soft;
      setFont(ctx, k, stack(G.bf), npt, 400, false);
      if (ALIGN != null) ALIGN = ALIGNC ? x + w / 2 : x + w;
      drawLines(ctx, k, nl, x, by + gap, nlead);
    }
    } finally { REC = rec2; }
  } finally { alignBack(before); }
}

function closingList(ctx, k, G, book, list, x, width, top0, bottom0) {
  const f = G.f;
  const areaTop = top0 == null ? G.M.top : top0, areaBottom = bottom0 == null ? G.ph - G.M.bottom : bottom0;
  kicker(ctx, k, G, book.series, x, areaTop + 20 * f);
  const top = areaTop + 58 * f, room = areaBottom - 12 * f - top;
  // a long list in a wide frame runs in two columns
  const cols = width > 260 * f && list.length > 8 ? 2 : 1;
  const per = Math.ceil(list.length / cols);
  const step = Math.min(9 * f * G.st, per ? room / per : 9 * f);
  const colW = width / cols;
  if (REC) {
    const kp = 7 * f * G.sx, ty = areaTop + 20 * f;
    const lp = Math.min(12.5 * f * G.st, step / PT * 0.9);
    recText(x, ty - kp * PT * KASC, width, kp * PT * 2, kp * PT * KASC,
      [para("Number", String(book.series).toUpperCase(), G.bf, 500, false, kp, kp * 1.3 * PT, 0.22, G.c.accent, "left")]);
    for (let c0 = 0; c0 < cols; c0++) {
      const part = list.slice(c0 * per, (c0 + 1) * per);
      if (!part.length) continue;
      const fy = top - lp * PT * KASC;
      recText(x + c0 * colW, fy, colW - 4 * f, areaBottom - fy, lp * PT * KASC,
        part.map(c => para("List", `\t${c.title}`, G.tf, 500, false, lp, step, 0, G.c.ink, "left", null, { tab: 13 * f,
          lead_in: { text: String(c.label || c.no), font: G.bf, face: faceOf(G.bf, 500, false), size: 7 * f * G.sx, track: 120, color: G.c.accent } })));
    }
  }
  const rec = REC;
  REC = null;
  try { closingDraw(ctx, k, G, list, x, top, step, per, colW); } finally { REC = rec; }
}
function closingDraw(ctx, k, G, list, x, top, step, per, colW) {
  const f = G.f;
  list.forEach((c, i) => {
    const col = Math.floor(i / per), row = i % per;
    const cx = x + col * colW, y = top + row * step;
    ctx.fillStyle = G.c.accent;
    setFont(ctx, k, stack(G.bf), 7 * f * G.sx, 500, false);
    setTrack(ctx, k, 7 * f, 0.12);
    ctx.fillText(c.label || c.no, cx * k, y * k);
    setTrack(ctx, k, 7 * f, 0);
    ctx.fillStyle = G.c.ink;
    setFont(ctx, k, stack(G.tf, true), Math.min(12.5 * f * G.st, step / PT * 0.9), 500, false);
    const t = wrapLine(ctx, c.title, (colW - 16 * f) * k)[0] || "";
    ctx.fillText(t, (cx + 13 * f) * k, y * k);
  });
}

/* One sheet at k pixels a unit. pics: pick id -> image. */
function drawSheet(ctx, k, sh, G0, book, st, pics, preview) {
  const G = { ...G0, tp: (st.pos && st.pos[sh.id]) || G0.tp, al: (st.align && st.align[sh.id]) || "left",
    show: (st.show && st.show[`${G0.cat}:${sh.id}`]) || "both",
    split: (st.split && st.split[`${G0.cat}:${sh.id}`]) || "", splitW: (st.splitW && st.splitW[`${G0.cat}:${sh.id}`]) || null,
    splitTag: `${G0.cat}:${sh.id}`, cover: sh.t === "A" || sh.t === "A2" };
  const img = (pick) => { LASTPICK = pick || null; return pick ? pics.get(String(pick.id)) || null : null; };
  FOCUS = (st.focus && st.focus[focusKey(G)]) || null;
  const { pw, ph, M, f } = G;
  ctx.save();
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  EMPTY = G.c.empty;
  ctx.fillStyle = G.c.paper;
  ctx.fillRect(0, 0, G.sheetW * k, ph * k);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  const extraOf = (c) => String((st.extra || {})[c.no] || "").trim();

  if (G.cat === "web") {
    drawWeb(ctx, k, sh, G, book, img, extraOf);
  } else if (sh.t === "A") {
    const coverPage = (px) => {
      if (!sh.cover) return;
      if (isLand(sh.cover)) photoContain(ctx, k, img(sh.cover), sh.cover, px + (px ? M.inner : M.outer), M.top, pw - M.inner - M.outer, ph - M.top - M.bottom, false);
      else photoCover(ctx, k, img(sh.cover), px, 0, pw, ph);
    };
    if (sh.style === "full" && sh.cover) {
      photoCover(ctx, k, img(sh.cover), 0, 0, pw * 2, ph);
      const c0 = col(G, M.outer + 8 * f, pw * 2 - M.outer - 8 * f, Math.min(pw - M.outer - 40 * f, 190 * f));
      titleArea(ctx, k, G, book, c0.x, c0.w, M.top, ph - M.bottom, true, true);
    } else if (sh.style === "flip") {
      coverPage(0);
      const c0 = col(G, pw + M.inner + 10 * f, pw * 2 - M.outer - 8 * f, pw - M.inner - 40 * f);
      titleArea(ctx, k, G, book, c0.x, c0.w, M.top, ph - M.bottom, false, true);
    } else {
      const c0 = col(G, 26 * f, pw - M.inner - 10 * f, pw - 60 * f);
      titleArea(ctx, k, G, book, c0.x, c0.w, M.top, ph - M.bottom, false, true);
      if (sh.style !== "type") coverPage(pw);
    }
  } else if (sh.t === "B") {
    const c = sh.cuts[0];
    const b = sh.inset ? insetBox(G, true) : { x: 0, y: 0, w: pw * 2, h: ph };
    photoSet(ctx, k, G, img, c.picks, b.x, b.y, b.w, b.h);
    cornerLabel(ctx, k, G, c, b.x + b.w - (sh.inset ? 8 : 12) * f, b.y + b.h - (sh.inset ? 8 : 12) * f, "right", true);
  } else if (sh.t === "O") {
    // the pictures across the spread, the words set on them
    const c = sh.cuts[0];
    const b = sh.inset ? insetBox(G, true) : { x: 0, y: 0, w: pw * 2, h: ph };
    photoSet(ctx, k, G, img, c.picks, b.x, b.y, b.w, b.h);
    const area = sh.inset ? { top: b.y + 6 * f, bottom: b.y + b.h - 10 * f } : undefined;
    // flush right, the words go to the right edge of the spread; flush left,
    // to the page Flip chooses
    const c0 = G.al === "right" ? col(G, M.outer + 8 * f, pw * 2 - M.outer - 8 * f, 150 * f)
      : sh.side === 1 ? col(G, pw + M.inner + 8 * f, pw * 2 - M.outer - 8 * f, 150 * f)
        : col(G, M.outer + 8 * f, pw - M.inner - 8 * f, 150 * f);
    textPage(ctx, k, onPhoto(G), c, extraOf(c), c0.x, c0.w, area);
  } else if (sh.t === "C") {
    const c = sh.cuts[0];
    const photoX = sh.side === 0 ? 0 : pw;
    const b = sh.inset ? insetBox(G, false, sh.side) : { x: photoX, y: 0, w: pw, h: ph };
    const c0 = sh.side === 0 ? col(G, pw + M.inner + 8 * f, pw * 2 - M.outer - 8 * f, 150 * f)
      : col(G, M.outer + 8 * f, pw - M.inner - 8 * f, 150 * f);
    photoSet(ctx, k, G, img, c.picks, b.x, b.y, b.w, b.h);
    textPage(ctx, k, G, c, extraOf(c), c0.x, c0.w);
  } else if (sh.t === "D") {
    sh.cuts.forEach((c, i) => {
      photoSet(ctx, k, G, img, c.picks, i * pw, 0, pw, ph);
      cornerLabel(ctx, k, G, c, i === 0 ? 12 * f : pw * 2 - 12 * f, ph - 12 * f, i === 0 ? "left" : "right", false);
    });
  } else if (sh.t === "E") {
    sh.cuts.forEach((c, i) => {
      const x = i === 0 ? M.outer : pw + M.inner;
      const w = pw - M.outer - M.inner;
      let r;
      if (c.picks.length > 1) {
        const cells = photoSet(ctx, k, G, img, c.picks, x, M.top + 8 * f, w, ph * 0.63);
        r = { x, y: M.top + 8 * f, w, h: ph * 0.63 };
        void cells;
      } else {
        r = photoContain(ctx, k, img(c.pick), c.pick, x, M.top + 8 * f, w, ph * 0.63, true);
      }
      const sc = col(G, r.x, r.x + r.w, 150 * f);
      smallWords(ctx, k, G, c, sc.x, r.y + r.h + 11 * f, sc.w);
    });
  } else if (sh.t === "F") {
    if (sh.cuts.length) photoCover(ctx, k, img(sh.cuts[0].pick), 0, 0, pw, ph);
    const lh = logoH(G);
    closingList(ctx, k, G, book, sh.list || [], pw + 26 * f, pw - 52 * f, undefined, lh ? ph - M.bottom - lh - 12 * f : undefined);
    drawLogo(ctx, k, G, pw + 26 * f, ph - M.bottom, pw - 52 * f);
  }

  if (preview && G.cat !== "web") {
    ctx.fillStyle = "rgba(0,0,0,0.10)";
    ctx.fillRect(pw * k - 0.5, 0, 1, ph * k);
  }
  ctx.restore();
}

/* A web frame, laid out by its shape: a wide frame puts words beside the
   pictures, a tall one below them, a 4:5 or square frame gives words a
   frame of their own. */
function drawWeb(ctx, k, sh, G, book, img, extraOf) {
  const { pw, ph, M, f } = G;
  const shape = shapeOf(G);
  const tall = pw / ph < 0.75;
  if (sh.t === "A") {
    const x = M.outer + 6 * f;
    if (sh.style === "type" || !sh.cover) {
      const c0 = col(G, M.outer + 8 * f, pw - M.outer - 8 * f, 170 * f);
      titleArea(ctx, k, G, book, c0.x, c0.w, M.top, ph - M.bottom, false, shape === "wide" || sh.style === "type");
    } else if (shape === "wide" && sh.style === "on") {
      photoCover(ctx, k, img(sh.cover), 0, 0, pw, ph);
      const c0 = col(G, x + 4 * f, pw - M.outer - 8 * f, pw * 0.4);
      titleArea(ctx, k, G, book, c0.x, c0.w, M.top, ph - M.bottom, true, true);
    } else if (shape === "wide") {
      // the cover on the right, the title and the note beside it
      const split = pw * 0.56;
      photoCover(ctx, k, img(sh.cover), pw - split, 0, split, ph);
      titleArea(ctx, k, G, book, x, pw - split - x - M.inner, M.top, ph - M.bottom, false, true);
    } else if (sh.style === "under") {
      // the cover above, the title under it
      const ch = ph * (tall ? 0.62 : 0.66);
      photoCover(ctx, k, img(sh.cover), 0, 0, pw, ch);
      if (!showsTitle(G)) titleArea(ctx, k, { ...G, tp: "top" }, book, M.outer + 4 * f, pw - M.outer * 2 - 8 * f, ch + 4 * f, ph - M.bottom, false, true);
      else aligned(G, M.outer + 4 * f, pw - M.outer * 2 - 8 * f, () =>
        titleBlock(ctx, k, G, book, M.outer + 4 * f, ch + 12 * f, pw - M.outer * 2 - 8 * f, false));
    } else {
      photoCover(ctx, k, img(sh.cover), 0, 0, pw, ph);
      if (!showsTitle(G)) titleArea(ctx, k, { ...G, tp: "bottom" }, book, M.outer, Math.min(pw - M.outer * 2, 170 * f), M.top, ph - M.bottom, true, true);
      else aligned(G, M.outer, pw - M.outer * 2 - 2 * f, () =>
        titleBlock(ctx, k, G, book, M.outer, ph - M.bottom - titleHeight(G), pw - M.outer * 2, true));
    }
  } else if (sh.t === "A2") {
    const c0 = col(G, M.outer + 8 * f, pw - M.outer - 8 * f, 150 * f);
    titleArea(ctx, k, G, book, c0.x, c0.w, M.top, ph - M.bottom, false, true);
  } else if (sh.t === "B") {
    const c = sh.cuts[0];
    photoSet(ctx, k, G, img, c.picks, 0, 0, pw, ph);
    cornerLabel(ctx, k, G, c, pw - 10 * f, ph - 10 * f, "right", true);
  } else if (sh.t === "O") {
    const c = sh.cuts[0];
    photoSet(ctx, k, G, img, c.picks, 0, 0, pw, ph);
    const c0 = col(G, M.outer + 8 * f, pw - M.outer - 8 * f, 150 * f);
    textPage(ctx, k, onPhoto(G), c, extraOf(c), c0.x, c0.w);
  } else if (sh.t === "C") {
    const c = sh.cuts[0];
    if (shape === "wide") {
      // pictures on one half, words on the other
      const half = pw / 2;
      const px = sh.flip ? half : 0;
      photoSet(ctx, k, G, img, c.picks, px, 0, half, ph);
      const c0 = sh.flip ? col(G, M.outer + 8 * f, half - M.inner - 8 * f, 150 * f)
        : col(G, half + M.inner + 8 * f, pw - M.outer - 8 * f, 150 * f);
      textPage(ctx, k, G, c, extraOf(c), c0.x, c0.w);
    } else if (shape === "tall") {
      // pictures above, words below - or the other way round
      const ph2 = ph * 0.58;
      const py = sh.flip ? ph - ph2 : 0;
      photoSet(ctx, k, G, img, c.picks, 0, py, pw, ph2);
      const top = sh.flip ? M.top : ph2 + 4 * f, bottom = sh.flip ? ph - ph2 - 10 * f : ph - M.bottom;
      const c0 = col(G, M.outer + 8 * f, pw - M.outer - 8 * f, 150 * f);
      textPage(ctx, k, G, c, extraOf(c), c0.x, c0.w, { top, bottom });
    } else if (sh.part === 0) {
      photoSet(ctx, k, G, img, c.picks, 0, 0, pw, ph);
      cornerLabel(ctx, k, G, c, pw - 10 * f, ph - 10 * f, "right", false);
    } else {
      const c0 = col(G, M.outer + 8 * f, pw - M.outer - 8 * f, 150 * f);
      textPage(ctx, k, G, c, extraOf(c), c0.x, c0.w);
    }
  } else if (sh.t === "D") {
    sh.cuts.forEach((c, i) => {
      if (tall) photoSet(ctx, k, G, img, c.picks, 0, i * ph / 2, pw, ph / 2);
      else photoSet(ctx, k, G, img, c.picks, i * pw / 2, 0, pw / 2, ph);
    });
    sh.cuts.forEach((c, i) => {
      if (tall) cornerLabel(ctx, k, G, c, pw - 10 * f, (i + 1) * ph / 2 - 8 * f, "right", false);
      else cornerLabel(ctx, k, G, c, i === 0 ? 10 * f : pw - 10 * f, ph - 10 * f, i === 0 ? "left" : "right", false);
    });
  } else if (sh.t === "E") {
    const n = sh.cuts.length;
    const words = 30 * f;
    const place = (c, x, y, w, h, alignTop) => (c.picks.length > 1
      ? (photoSet(ctx, k, G, img, c.picks, x, y, w, h), { x, y, w, h })
      : photoContain(ctx, k, img(c.pick), c.pick, x, y, w, h, alignTop));
    if (n === 1 && shape === "wide") {
      // the pictures inside the margins, their words in a column beside them
      const colW = Math.min(130 * f, pw * 0.3);
      const c = sh.cuts[0];
      const r = place(c, M.outer, M.top, pw - M.outer * 2 - colW - M.inner, ph - M.top - M.bottom, false);
      smallWords(ctx, k, G, c, r.x + r.w + M.inner, r.y + r.h - 30 * f, colW - 6 * f);
    } else if (n === 1 || tall || pw / ph < 1.2) {
      const slot = (ph - M.top - M.bottom) / n;
      sh.cuts.forEach((c, i) => {
        const y = M.top + i * slot;
        const r = place(c, M.outer, y, pw - M.outer * 2, slot - words - 6 * f, false);
        const sc = col(G, r.x, r.x + r.w, 150 * f);
        smallWords(ctx, k, G, c, sc.x, r.y + r.h + 10 * f, sc.w);
      });
    } else {
      const gap = M.inner, w = (pw - M.outer * 2 - gap) / 2;
      sh.cuts.forEach((c, i) => {
        const x = M.outer + i * (w + gap);
        const r = place(c, x, M.top, w, ph - M.top - M.bottom - words, true);
        const sc = col(G, r.x, r.x + r.w, 150 * f);
        smallWords(ctx, k, G, c, sc.x, r.y + r.h + 10 * f, sc.w);
      });
    }
  } else if (sh.t === "F") {
    const x = M.outer + 8 * f;
    const lh = logoH(G);
    closingList(ctx, k, G, book, sh.list || [], x, pw - x * 2, undefined, lh ? ph - M.bottom - lh - 12 * f : undefined);
    drawLogo(ctx, k, G, x, ph - M.bottom, pw - x * 2);
  }
}

/* Where each picture of a sheet sits: its box in page units and how it
   fills it - to the edge (cover, cut to the box) or inside it (contain). */
function placements(sh, G) {
  const { pw, ph, M } = G;
  const out = [];
  const gap = gapOf(G);
  const add = (pick, cut, w, h, fit) => { if (pick) out.push({ pick, cut, w, h, fit }); };
  const set = (c, x, y, w, h) => {
    const cells = gridCells(c.picks.length, x, y, w, h, gap, c.picks.map(ratio), sh.split, sh.splitW);
    c.picks.forEach((p, i) => add(p, c, cells[i].w, cells[i].h, "cover"));
  };
  if (G.cat === "web") {
    const tall = pw / ph < 0.75, shape = shapeOf(G);
    if (sh.t === "A" && sh.cover) {
      if (shape === "wide" && sh.style !== "on") add(sh.cover, null, pw * 0.56, ph, "cover");
      else if (sh.style === "under" && shape !== "wide") add(sh.cover, null, pw, ph * 0.64, "cover");
      else add(sh.cover, null, pw, ph, "cover");
    }
    const c = (sh.cuts || [])[0];
    if (sh.t === "B" || sh.t === "O") set(c, 0, 0, pw, ph);
    if (sh.t === "C" && shape === "wide") set(c, 0, 0, pw / 2, ph);
    else if (sh.t === "C" && shape === "tall") set(c, 0, 0, pw, ph * 0.58);
    else if (sh.t === "C" && sh.part === 0) set(c, 0, 0, pw, ph);
    if (sh.t === "D") for (const d of sh.cuts) set(d, 0, 0, tall ? pw : pw / 2, tall ? ph / 2 : ph);
    if (sh.t === "E") {
      for (const d of sh.cuts) {
        const h = (ph - M.top - M.bottom) / sh.cuts.length;
        if (d.picks.length > 1) set(d, 0, 0, pw - M.outer * 2, h);
        else add(d.pick, d, pw - M.outer * 2, h, "contain");
      }
    }
    return out;
  }
  if (sh.t === "A" && sh.cover) {
    if (sh.style === "full") add(sh.cover, null, pw * 2, ph, "cover");
    else if (isLand(sh.cover)) add(sh.cover, null, pw - M.inner - M.outer, ph - M.top - M.bottom, "contain");
    else add(sh.cover, null, pw, ph, "cover");
  }
  if (sh.t === "B" || sh.t === "O") {
    const b = sh.inset ? insetBox(G, true) : { w: pw * 2, h: ph };
    set(sh.cuts[0], 0, 0, b.w, b.h);
  }
  if (sh.t === "C" && sh.inset) set(sh.cuts[0], 0, 0, pw - M.outer - M.inner, ph - M.top - M.bottom);
  else if (sh.t === "C" || sh.t === "D") for (const c of sh.cuts) set(c, 0, 0, pw, ph);
  if (sh.t === "F") for (const c of sh.cuts) add(c.pick, c, pw, ph, "cover");
  if (sh.t === "E") {
    for (const c of sh.cuts) {
      if (c.picks.length > 1) set(c, 0, 0, pw - M.outer - M.inner, ph * 0.63);
      else add(c.pick, c, pw - M.outer - M.inner, ph * 0.63, "contain");
    }
  }
  return out;
}

/* How sharp a placed picture prints: its pixels over the millimetres it is
   given, in dots per inch. */
function placedDpi(pl) {
  const { w: iw, h: ih } = pl.pick.hd || pl.pick;
  if (!iw || !ih) return 0;
  const mmPerPx = pl.fit === "cover" ? Math.max(pl.w / iw, pl.h / ih) : Math.min(pl.w / iw, pl.h / ih);
  return 25.4 / mmPerPx;
}

/* The lowest resolution a picture is printed at on this spread, in dpi. */
function sheetDpi(sh, G) {
  if (G.cat === "web") return 0;
  let low = Infinity;
  for (const pl of placements(sh, G)) {
    const d = placedDpi(pl);
    if (d) low = Math.min(low, d);
  }
  return Number.isFinite(low) ? Math.round(low) : 0;
}

function sheetName(sh) {
  const cuts = (sh.cuts || []).map(c => cutLabel(c) + (c.picks && c.picks.length > 1 ? ` (${c.picks.length})` : "")).join(" + ");
  let name = TEMPLATES[sh.t] || sh.t;
  if (sh.t === "C" && sh.part !== undefined) name += sh.part === 0 ? " · photo" : " · text";
  return cuts ? `${name} · ${cuts}` : name;
}

// ------------------------------------------------------------ styles
/* ------------------------------------------------------------- motion
   A series as a short film: the cover with the title, every chosen pick of
   every cut one after another, moving slowly, its caption on it, and the
   list of the cuts to close - set to music that fades out with the last
   frame. Nothing is drawn by hand: each shot's move, length and the way it
   passes to the next are chosen, and the film is recorded in the browser. */
const MOTION_SIZES = [
  { id: "ig45", tag: "4x5", label: "Instagram feed", note: "4:5 · 1080 × 1350" },
  { id: "sq", tag: "1x1", label: "Square posts", note: "1:1 · 1080 × 1080" },
  { id: "story", tag: "9x16", label: "Reels · Stories · Shorts", note: "9:16 · 1080 × 1920" },
  { id: "wide", tag: "16x9", label: "YouTube · X · websites", note: "16:9 · 1920 × 1080" },
];
const MOVES = [
  { id: "auto", label: "Auto", hint: "Chosen by the shape of the picture: a pan where the frame cuts it, a slow zoom where it fits - taking turns where it is cut only a little" },
  { id: "still", label: "Still", hint: "The picture does not move" },
  { id: "in", label: "In", hint: "A slow zoom in" },
  { id: "out", label: "Out", hint: "A slow zoom out" },
  { id: "left", label: "←", hint: "Pan to the left" },
  { id: "right", label: "→", hint: "Pan to the right" },
  { id: "up", label: "↑", hint: "Pan up" },
  { id: "down", label: "↓", hint: "Pan down" },
];
const LENGTHS = [2, 3, 4, 5, 6, 8];
// where a caption sits: top, middle or bottom, by left, centre or right
const CAP_POS = ["tl", "tc", "tr", "ml", "mc", "mr", "bl", "bc", "br"];
const PASSES = [
  { id: "fade", label: "Fade", hint: "The next shot fades in over this one" },
  { id: "cut", label: "Cut", hint: "Straight to the next shot" },
  { id: "black", label: "Black", hint: "Down to black and up again - a pause between two parts" },
];
const FADE_S = 0.8;             // a crossfade
const BLACK_S = 0.6;            // each half of a pass through black
const OPEN_S = 0.8;             // the film comes up from black
const CLOSE_S = 1.2;            // and goes down to black
const MOTION_FPS = 30;

function motionDefaults(st) {
  const m = st.motion && typeof st.motion === "object" ? st.motion : (st.motion = {});
  m.set = m.set && typeof m.set === "object" ? m.set : {};
  m.off = m.off && typeof m.off === "object" ? m.off : {};
  m.music = m.music && typeof m.music === "object" ? m.music : {};
  const mu = m.music;
  mu.start = Number(mu.start) || 0;
  mu.fade = [2, 3, 5, 8].includes(Number(mu.fade)) ? Number(mu.fade) : 3;
  mu.vol = mu.vol == null ? 0.9 : Math.max(0, Math.min(1, Number(mu.vol)));
  mu.loop = !!mu.loop;
  // the length of a picture shot that has none of its own
  m.len = Number(m.len) >= 1 && Number(m.len) <= 20 ? Math.round(Number(m.len) * 100) / 100 : 4;
  return m;
}

/* A shot's move as a small mark at the head of its place on the timeline:
   gold where it was set, pale where Auto chose it. */
const MOVE_MARK = {
  still: '<rect x="3.5" y="3.5" width="3" height="3" rx="0.5" fill="currentColor" stroke="none"/>',
  in: '<path d="M6 1.5h2.5V4M8.5 1.5 5.8 4.2M4 8.5H1.5V6M1.5 8.5l2.7-2.7"/>',
  out: '<path d="M1.8 5.8h2.4v2.4M4.2 5.8 1.5 8.5M8.2 4.2H5.8V1.8M5.8 4.2l2.7-2.7"/>',
  left: '<path d="M8.5 5h-7M4 2.5 1.5 5 4 7.5"/>',
  right: '<path d="M1.5 5h7M6 2.5 8.5 5 6 7.5"/>',
  up: '<path d="M5 8.5v-7M2.5 4 5 1.5 7.5 4"/>',
  down: '<path d="M5 1.5v7M2.5 6 5 8.5 7.5 6"/>',
};
/* In: arrows out to the corners, the picture growing; Out: arrows in from
   them, the picture drawing back. */
const MOVE_NAME = { still: "Still", in: "In", out: "Out", left: "\u2190", right: "\u2192", up: "\u2191", down: "\u2193" };
function moveMark(s) {
  const d = MOVE_MARK[s.move];
  if (!d) return "";
  const auto = !s.moveSet || s.moveSet === "auto";
  return `<span class="mvk${auto ? " auto" : ""}" title="Move: ${MOVE_NAME[s.move]}${auto ? " (Auto)" : ""}"><svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">${d}</svg></span>`;
}

const PV_PLAY = '<svg viewBox="0 0 10 10"><path d="M3 2v6l5-3z" fill="currentColor"/></svg>';
/* The piece playing shows pause: pressed, it pauses there. */
const PV_ON = '<svg viewBox="0 0 10 10"><rect x="2.4" y="2" width="1.9" height="6" rx=".4" fill="currentColor"/><rect x="5.7" y="2" width="1.9" height="6" rx=".4" fill="currentColor"/></svg>';
const PV_STOP = '<svg viewBox="0 0 10 10"><rect x="2.5" y="2.5" width="5" height="5" rx="0.6" fill="currentColor"/></svg>';

/* The shots of the film, in order, each with its move, length and pass. */
function frameOf(set, G) {
  const fr = set.frame && set.frame[G.fmt.id];
  return { fx: fr ? Number(fr[0]) || 0 : 0, fy: fr ? Number(fr[1]) || 0 : 0 };
}
function motionShots(book, st, G) {
  const m = motionDefaults(st);
  const cuts = pickedCuts(book, st);
  const cover = coverOf(book, st, cuts);
  const shots = [{ id: "T", kind: "title", pick: cover || null }];
  for (const c of cuts) c.picks.forEach((p, i) => shots.push({ id: "p:" + p.id, kind: "pick", cut: c, pick: p, first: i === 0 }));
  if (cuts.length) shots.push({ id: "E", kind: "end", list: cuts });
  const frameR = G.pw / G.ph;
  let n = 0;
  const out = [];
  for (const s of shots) {
    if (m.off[s.id]) continue;
    const set = m.set[s.id] || {};
    /* By the shape of the picture against the frame: a pan along the side the
       frame cuts, a slow zoom where it fits. Where it is cut only a little -
       a portrait picture in a tall frame - pans and zooms take turns, so a
       film in one size does not slide sideways from shot to shot. */
    const auto = () => {
      if (!s.pick) return "still";
      const r = ratio(s.pick) / frameR;
      const i = n++;
      const turn = (a, b) => ["", "in", "", "out"][i % 4] || (i % 4 === 0 ? a : b);
      if (r > 1.8) return i % 2 ? "left" : "right";
      if (r < 0.55) return i % 2 ? "down" : "up";
      if (r > 1.15) return turn("right", "left");
      if (r < 0.87) return turn("up", "down");
      return i % 2 ? "out" : "in";
    };
    const move = set.move && set.move !== "auto" ? set.move : (s.kind === "end" ? "still" : auto());
    out.push({ ...s, move, moveSet: set.move || "auto",
      dur: Number(set.dur) >= 1 && Number(set.dur) <= 20 ? Math.round(Number(set.dur) * 100) / 100 : (s.kind === "pick" ? m.len : 5),
      pass: PASSES.some(p => p.id === set.pass) ? set.pass : "fade",
      cap: s.kind === "pick" ? (set.cap == null ? !!s.first : !!set.cap) : false,
      cpos: CAP_POS.includes(set.cpos) ? set.cpos : "bc",
      // the framing belongs to the size it was dragged in: a wide frame and a
      // tall one cut the same picture differently
      ...frameOf(set, G) });
  }
  // when each shot starts, the passes overlapping or parting them
  let t = 0;
  out.forEach((s, i) => {
    s.start = t;
    const next = out[i + 1];
    t += s.dur - (next && s.pass === "fade" ? FADE_S : 0);
  });
  return out;
}
function motionLength(shots) {
  const last = shots[shots.length - 1];
  return last ? last.start + last.dur : 0;
}
/* A moment of the film as minutes, seconds and frames - 0:12:15 is twelve
   seconds and fifteen frames - and back. */
function tc(t) {
  const f = Math.max(0, Math.round(t * MOTION_FPS));
  const m = Math.floor(f / (60 * MOTION_FPS)), sec = Math.floor(f / MOTION_FPS) % 60, fr = f % MOTION_FPS;
  return `${m}:${String(sec).padStart(2, "0")}:${String(fr).padStart(2, "0")}`;
}
function parseTc(text) {
  const t = String(text || "").trim().replace(/[;.,]/g, (c) => (c === "." || c === "," ? "." : ":"));
  if (!t) return null;
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t);                       // seconds
  const p = t.split(":").map(Number);
  if (p.some(n => !Number.isFinite(n))) return null;
  if (p.length === 2) return p[0] * 60 + p[1];                            // m:ss
  if (p.length === 3) return p[0] * 60 + p[1] + p[2] / MOTION_FPS;       // m:ss:ff
  return null;
}
function clock(t) {
  t = Math.max(0, t);
  return `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
}

/* A picture moving across the frame: p runs from 0 to 1 over the shot. */
function kenBurns(ctx, k, img, move, p, W, H, fx, fy) {
  if (!img) {
    ctx.fillStyle = EMPTY;
    ctx.fillRect(0, 0, W * k, H * k);
    return;
  }
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const base = Math.max(W / iw, H / ih);
  const zoom = 0.09;
  let z = 1, ox = 0, oy = 0;          // ox, oy: shift of the picture's centre, in page units
  const pan = (axis, dir) => {
    const size = axis === "x" ? iw * base : ih * base, frame = axis === "x" ? W : H;
    // room to move: what the frame cuts, but never a race across the picture
    if (size - frame < frame * 0.06) z = 1 + zoom;
    const room = Math.min((size * z - frame) / 2, frame * 0.11);
    const v = (p - 0.5) * 2 * room * dir;
    if (axis === "x") ox = -v; else oy = -v;
  };
  if (move === "in") z = 1 + zoom * p;
  else if (move === "out") z = 1 + zoom * (1 - p);
  else if (move === "left") pan("x", -1);
  else if (move === "right") pan("x", 1);
  else if (move === "up") pan("y", -1);
  else if (move === "down") pan("y", 1);
  const s = base * z;
  const dw = iw * s, dh = ih * s;
  // the framing chosen by dragging, then the move from there - never past an edge
  const mx = Math.max(0, (dw - W) / 2), my = Math.max(0, (dh - H) / 2);
  const cx = Math.max(-mx, Math.min(mx, (fx || 0) * mx + ox));
  const cy = Math.max(-my, Math.min(my, (fy || 0) * my + oy));
  ctx.drawImage(img, (W / 2 - dw / 2 + cx) * k, (H / 2 - dh / 2 + cy) * k, dw * k, dh * k);
}

/* Words on a moving picture: the number and title of the cut, small, and
   its caption under it, centred near the foot of the frame. */
function motionCaption(ctx, k, G, cut, pos) {
  const { pw, ph, M, f } = G;
  const w = Math.min(pw - M.outer * 2, 210 * f);
  const v = (pos || "bc")[0], h = (pos || "bc")[1];
  const cx = h === "l" ? M.outer : h === "r" ? pw - M.outer : pw / 2;
  // sized to be read on a phone
  const cpt = 17 * f * G.sx, lead = cpt * 1.3 * PT;
  const kpt = 7.5 * f * G.sx;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.5)";
  ctx.shadowBlur = 10 * f * k / 4;
  ctx.textAlign = h === "l" ? "left" : h === "r" ? "right" : "center";
  setFont(ctx, k, stack(G.tf, true), cpt, 500, true);
  const lines = clip(wrapText(ctx, k, cut.caption || cut.title, w), 3).filter(l => l !== null);
  // the block: the kicker, then the lines of the caption
  const above = cpt * PT * 1.25 + 5 * f;
  const blockH = above + (lines.length - 1) * lead;
  const first = v === "t" ? M.top + kpt * PT + above
    : v === "m" ? ph / 2 - blockH / 2 + above
      : ph - M.bottom - (lines.length - 1) * lead;
  let y = first;
  // the kicker above
  setFont(ctx, k, stack(G.bf), kpt, 500, false);
  setTrack(ctx, k, kpt, 0.22);
  ctx.fillStyle = ON_PHOTO;
  ctx.globalAlpha *= 0.85;
  const kick = `${cut.label || cut.no}  ·  ${cut.title}`.toUpperCase();
  ctx.fillText(kick, cx * k, (y - cpt * PT * 1.25 - 5 * f) * k);
  ctx.globalAlpha /= 0.85;
  setTrack(ctx, k, kpt, 0);
  setFont(ctx, k, stack(G.tf, true), cpt, 500, true);
  ctx.fillStyle = ON_PHOTO;
  for (const ln of lines) { ctx.fillText(ln, cx * k, y * k); y += lead; }
  ctx.restore();
}

/* One shot at a moment of it: t in seconds from its start. */
function drawShot(ctx, k, G, book, shot, t, pics) {
  const { pw, ph, M, f } = G;
  const p = Math.max(0, Math.min(1, t / shot.dur));
  const img = shot.pick ? pics.get(String(shot.pick.id)) || null : null;
  // words come up a little after the picture and leave a little before it ends
  const words = Math.max(0, Math.min(1, (t - 0.5) / 0.7, (shot.dur - t) / 0.5));
  ctx.save();
  ctx.textBaseline = "alphabetic";
  EMPTY = G.c.empty;
  if (shot.kind === "end" || (shot.kind === "title" && !shot.pick)) {
    ctx.fillStyle = G.c.paper;
    ctx.fillRect(0, 0, pw * k, ph * k);
    const base = ctx.globalAlpha;
    ctx.globalAlpha = base * words;
    const x = M.outer + 8 * f;
    if (shot.kind === "end") {
      const lh = logoH(G);
      closingList(ctx, k, G, book, shot.list || [], x, pw - x * 2, undefined, lh ? ph - M.bottom - lh - 12 * f : undefined);
      drawLogo(ctx, k, G, x, ph - M.bottom, pw - x * 2);
    }
    else titleArea(ctx, k, { ...G, al: "left" }, book, x, pw - x * 2, M.top, ph - M.bottom, false, true);
    ctx.globalAlpha = base;
  } else {
    kenBurns(ctx, k, img, shot.move, p, pw, ph, shot.fx, shot.fy);
    const base = ctx.globalAlpha;
    ctx.globalAlpha = base * words;
    if (shot.kind === "title") {
      const x = M.outer + 6 * f;
      ctx.shadowColor = "rgba(0,0,0,0.45)";
      ctx.shadowBlur = 10 * f * k / 4;
      titleArea(ctx, k, { ...G, al: "left", tp: "bottom" }, book, x, Math.min(pw - x * 2, 170 * f), M.top, ph - M.bottom, true, false);
    } else if (shot.cap) {
      motionCaption(ctx, k, G, shot.cut, shot.cpos);
    }
    ctx.globalAlpha = base;
  }
  ctx.restore();
}

/* The film at a moment: the shots on screen then, the passes between them,
   up from black at the start and down to black at the end. */
function drawMotion(ctx, k, G, book, shots, T, pics) {
  const { pw, ph } = G;
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, pw * k, ph * k);
  const total = motionLength(shots);
  shots.forEach((s, i) => {
    const t = T - s.start;
    if (t < 0 || t > s.dur) return;
    const prev = shots[i - 1];
    let a = 1;
    if (prev && prev.pass === "fade" && t < FADE_S) a = t / FADE_S;
    ctx.globalAlpha = a;
    drawShot(ctx, k, G, book, s, t, pics);
    ctx.globalAlpha = 1;
    // through black
    let b = 0;
    if (s.pass === "black" && shots[i + 1] && t > s.dur - BLACK_S) b = (t - (s.dur - BLACK_S)) / BLACK_S;
    if (prev && prev.pass === "black" && t < BLACK_S) b = Math.max(b, 1 - t / BLACK_S);
    if (b > 0) {
      ctx.fillStyle = `rgba(0,0,0,${Math.min(1, b)})`;
      ctx.fillRect(0, 0, pw * k, ph * k);
    }
  });
  let d = 0;
  if (T < OPEN_S) d = 1 - T / OPEN_S;
  if (T > total - CLOSE_S) d = Math.max(d, (T - (total - CLOSE_S)) / CLOSE_S);
  if (d > 0) {
    ctx.fillStyle = `rgba(0,0,0,${Math.min(1, d)})`;
    ctx.fillRect(0, 0, pw * k, ph * k);
  }
  ctx.restore();
}

/* The loudness of the music over the film: up quickly when it starts part
   way in, down to nothing over the last seconds. */
function musicEnvelope(gain, ac, at, from, total, mu) {
  const g = gain.gain, vol = mu.vol, fade = Math.min(mu.fade, Math.max(0.5, total - 0.5));
  const lvl = (t) => vol * Math.min(mu.start > 0 ? Math.min(1, t / 0.4) : 1, t > total - fade ? Math.max(0, (total - t) / fade) : 1);
  g.cancelScheduledValues(0);
  g.setValueAtTime(lvl(from), at);
  if (mu.start > 0 && from < 0.4) g.linearRampToValueAtTime(vol, at + (0.4 - from));
  const fs = total - fade;
  if (from < fs) g.setValueAtTime(vol, at + (fs - from));
  g.linearRampToValueAtTime(0, at + Math.max(0.01, total - from));
}
/* A film written frame by frame - every frame drawn and handed to the
   browser's H.264 encoder at the bitrate asked for, the music mixed apart and
   encoded as AAC, both put into an MP4. Not tied to the clock, so nothing is
   dropped or squeezed; where the browser has no such encoder, the film is
   recorded as it plays instead. */
const MUXER_URL = new URL("./lib/mp4_muxer.js", import.meta.url).href;
const AUDIO_RATE = 48000;
async function videoConfig(w, h, mbit) {
  if (typeof VideoEncoder === "undefined" || typeof VideoFrame === "undefined") return null;
  for (const codec of ["avc1.640033", "avc1.640032", "avc1.640028", "avc1.4d0033", "avc1.4d0028"]) {
    const cfg = { codec, width: w, height: h, bitrate: Math.round(mbit * 1e6), framerate: MOTION_FPS,
      bitrateMode: "variable", latencyMode: "quality", avc: { format: "avc" } };
    try {
      const r = await VideoEncoder.isConfigSupported(cfg);
      if (r && r.supported) return r.config || cfg;
    } catch (e) { /* next */ }
  }
  return null;
}
/* AAC where the browser has it - every site takes it; else Opus, which an
   MP4 also holds. */
async function audioConfig() {
  if (typeof AudioEncoder === "undefined" || typeof AudioData === "undefined") return null;
  for (const [codec, mux] of [["mp4a.40.2", "aac"], ["opus", "opus"]]) {
    const cfg = { codec, sampleRate: AUDIO_RATE, numberOfChannels: 2, bitrate: 256000 };
    try {
      const r = await AudioEncoder.isConfigSupported(cfg);
      if (r && r.supported) return { cfg: r.config || cfg, mux };
    } catch (e) { /* next */ }
  }
  return null;
}
/* What this browser can write frame by frame: false, or the sound it uses. */
async function canEncode(withMusic) {
  const v = await videoConfig(1920, 1080, 40);
  if (!v) return false;
  if (!withMusic) return "none";
  const a = await audioConfig();
  return a ? a.mux : false;
}
const tick0 = () => new Promise(r => setTimeout(r, 0));

/* Returns the MP4 as bytes, null when this browser cannot encode it so, or
   "stopped". */
async function encodeFilm(G, book, shots, pics, buf, mu, mbit, progress, stopped) {
  const k = G.exportK;
  const W = Math.round(G.pw * k / 2) * 2, H = Math.round(G.ph * k / 2) * 2;
  const vcfg = await videoConfig(W, H, mbit);
  const acfg = buf ? await audioConfig() : null;
  if (!vcfg || (buf && !acfg)) return null;
  const { Muxer, ArrayBufferTarget } = await import(MUXER_URL);
  const total = motionLength(shots);
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: "avc", width: W, height: H, frameRate: MOTION_FPS },
    audio: buf ? { codec: acfg.mux, numberOfChannels: 2, sampleRate: AUDIO_RATE } : undefined,
    fastStart: "in-memory",
    firstTimestampBehavior: "offset",
  });
  let fail = null;
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext("2d", { alpha: false });
  const ve = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: (e) => { fail = e; } });
  ve.configure(vcfg);
  const n = Math.max(1, Math.round(total * MOTION_FPS));
  const step = 1e6 / MOTION_FPS;
  for (let i = 0; i < n; i++) {
    if (stopped()) { try { ve.close(); } catch (e) { /* closed */ } cv.width = cv.height = 0; return "stopped"; }
    if (fail) throw fail;
    drawMotion(ctx, k, G, book, shots, i / MOTION_FPS, pics);
    const fr = new VideoFrame(cv, { timestamp: Math.round(i * step), duration: Math.round(step) });
    ve.encode(fr, { keyFrame: i % (MOTION_FPS * 2) === 0 });
    fr.close();
    while (ve.encodeQueueSize > 6) await new Promise(r => setTimeout(r, 4));
    if (i % 5 === 0) { progress(i / n, cv, i / MOTION_FPS); await tick0(); }
  }
  await ve.flush();
  ve.close();
  if (fail) throw fail;
  if (buf) {
    progress(1, cv, total, "Mixing the music…");
    const mix = mixMusic(buf, mu, total);
    const ae = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: (e) => { fail = e; } });
    ae.configure(acfg.cfg);
    const L = mix.L, R = mix.R;
    const block = 4096;
    for (let off = 0; off < mix.length; off += block) {
      const m = Math.min(block, mix.length - off);
      const data = new Float32Array(m * 2);
      data.set(L.subarray(off, off + m), 0);
      data.set(R.subarray(off, off + m), m);
      const ad = new AudioData({ format: "f32-planar", sampleRate: AUDIO_RATE, numberOfFrames: m, numberOfChannels: 2,
        timestamp: Math.round((off / AUDIO_RATE) * 1e6), data });
      ae.encode(ad);
      ad.close();
    }
    await ae.flush();
    ae.close();
    if (fail) throw fail;
  }
  muxer.finalize();
  cv.width = cv.height = 0;
  return new Uint8Array(target.buffer);
}

/* A piece of music shorter than the film runs again from where it starts,
   when Loop is on: the source loops from START AT to its end. */
function setLoop(src, buf, mu) {
  if (!mu.loop || mu.start >= buf.duration - 0.5) return;
  src.loop = true;
  src.loopStart = mu.start;
  src.loopEnd = buf.duration;
}
/* The loudness of the music at t seconds into the film. */
function musicLevel(mu, t, total) {
  const vol = mu.vol, fade = Math.min(mu.fade, Math.max(0.5, total - 0.5));
  return vol * Math.min(mu.start > 0 ? Math.min(1, t / 0.4) : 1, t > total - fade ? Math.max(0, (total - t) / fade) : 1);
}
/* The film's music as two channels at AUDIO_RATE: START AT, Loop, the volume
   and its fades, worked out sample by sample. */
function mixMusic(buf, mu, total) {
  const n = Math.ceil(total * AUDIO_RATE);
  const L = new Float32Array(n), R = new Float32Array(n);
  const sr = buf.sampleRate, dur = buf.duration;
  const c0 = buf.getChannelData(0), c1 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : c0;
  const last = c0.length - 1;
  const loop = mu.loop && mu.start < dur - 0.5, span = dur - mu.start;
  for (let i = 0; i < n; i++) {
    const t = i / AUDIO_RATE;
    let at = mu.start + t;
    if (at >= dur) { if (!loop) break; at = mu.start + (t % span); }
    const g = musicLevel(mu, t, total);
    const x = at * sr, j = Math.min(last, Math.floor(x)), f = x - j, j1 = Math.min(last, j + 1);
    L[i] = (c0[j] * (1 - f) + c0[j1] * f) * g;
    R[i] = (c1[j] * (1 - f) + c1[j1] * f) * g;
  }
  return { L, R, length: n };
}
function musicOffset(buf, mu, t) {
  const at = mu.start + t;
  if (!mu.loop || at < buf.duration) return Math.min(buf.duration, at);
  const span = buf.duration - mu.start;
  return span > 0.5 ? mu.start + (t % span) : buf.duration;
}
function motionMime() {
  // MP4 only as H.264 and AAC, which every site takes; else WebM
  const want = ["video/mp4;codecs=avc1.640028,mp4a.40.2", "video/mp4;codecs=avc1.4d0028,mp4a.40.2",
    "video/mp4;codecs=avc1,mp4a.40.2", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
  if (typeof MediaRecorder === "undefined") return null;
  return want.find(m => MediaRecorder.isTypeSupported(m)) || null;
}

const CSS = `
.vly{--gold:#d9b45a;--sg:#22c3d6;--line:color-mix(in srgb,var(--sg) 14%,#25272c);--panel:color-mix(in srgb,var(--sg) 5%,#17181b);
  --ink:#e8e6e1;--mute:#8b9098;
  box-sizing:border-box;display:flex;flex-direction:column;height:auto;overflow:visible;
  font-family:system-ui,-apple-system,"Segoe UI",sans-serif;font-size:12px;color:var(--ink);
  background:color-mix(in srgb,var(--sg) 7%,#121315);border:2px solid color-mix(in srgb,var(--sg) 62%,#2a2c31);
  border-radius:10px;outline:none}
.vly *{box-sizing:border-box}
.vly svg{width:16px;height:16px;display:block}
.vly.drop{outline:2px dashed var(--gold);outline-offset:-6px}
.vly-top{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--line);
  background:color-mix(in srgb,var(--sg) 11%,#17181b);border-radius:8px 8px 0 0}
.vly-mark{font-size:11px;font-weight:700;letter-spacing:1.6px;color:var(--gold);padding-right:4px}
.vly-sel{appearance:none;-webkit-appearance:none;background:#121315;border:1px solid #33363c;color:var(--ink);
  border-radius:7px;padding:5px 26px 5px 10px;font:inherit;font-size:12px;cursor:pointer;max-width:220px;flex:0 0 auto;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%238b9098' stroke-width='2'%3E%3Cpath d='M7 10l5 5 5-5'/%3E%3C/svg%3E");
  background-repeat:no-repeat;background-position:right 7px center;background-size:13px}
.vly-sel:hover{border-color:#4a4e56}
.vly-sel option{background:#18191c;color:var(--ink)}
.vly-seg{display:inline-flex;background:#121315;border:1px solid #33363c;border-radius:7px;padding:2px;gap:2px}
.vly-seg button{background:transparent;border:0;color:var(--mute);font:inherit;font-size:10.5px;font-weight:700;
  letter-spacing:1.1px;padding:4px 10px;border-radius:5px;cursor:pointer}
.vly-seg button:hover{color:var(--ink)}
.vly-seg button.on{background:var(--gold);color:#1a1408}
.vly-div{width:1px;height:20px;background:var(--line);margin:0 2px}
.vly-live{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 10px;border-radius:999px;cursor:pointer;flex:0 0 auto;
  background:#14161a;border:1px solid #3a3e46;color:#8b9098;font:700 9.5px system-ui,sans-serif;letter-spacing:.8px}
.vly-live i{width:6px;height:6px;border-radius:50%;background:#5a5f68}
.vly-live:hover{border-color:#5a5f68;color:#c9ccd2}
.vly-live.on{border-color:#5fc08a;color:#c9f2d9;background:#15281e}
.vly-live.on i{background:#5fc08a}
.vly-ibtn{display:inline-flex;align-items:center;gap:6px;background:#121315;border:1px solid #33363c;color:#c9ccd2;
  border-radius:7px;padding:5px 8px;font:inherit;font-size:11.5px;cursor:pointer;white-space:nowrap}
.vly-ibtn.done{border-color:#7fbf8f;color:#9fe0b0}
.vly-ibtn:hover{border-color:#5a5f68;color:#fff;background:#0c0d0f}
.vly-ibtn:disabled{opacity:.35;cursor:default}
.vly-ibtn:disabled:hover{border-color:#33363c;color:#c9ccd2;background:#121315}
.vly-ibtn.fonts{flex:0 1 auto;min-width:60px;overflow:hidden}
.vly-ibtn.fonts svg,.vly-ibtn.fonts .sw{flex:0 0 auto}
.vly-ibtn .sw{width:12px;height:12px;border-radius:3px;border:2px solid #8a7a5a;flex:0 0 auto}
.vly-ibtn .fn{color:var(--mute);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vly-ibtn:hover .fn{color:#c9ccd2}
.vly-sp{flex:1}
.vly-meta{color:var(--mute);font-size:11px;white-space:nowrap;padding-right:4px}
.vly-pack{white-space:nowrap;flex:0 0 auto;background:transparent;border:1px solid #a8883f;color:#e8c977;border-radius:7px;padding:5px 12px;
  font:inherit;font-size:11.5px;font-weight:700;letter-spacing:.4px;cursor:pointer}
.vly-pack:hover{border-color:#e8c977;color:#fff3cf}
.vly-pack[disabled]{opacity:.35;cursor:default}
.vly-pack .lc{font-weight:600;color:#e0a35a;margin-left:3px}
.vly-pack.ready .lc{color:#8fc79b}
.vly-pop.wide{width:min(860px,96vw)}
.vly-pop .row{display:flex;gap:8px;align-items:center}
.vly-pop .row input{flex:1}
.vly-pop .note2{font-size:11.5px;color:#a8987c;line-height:1.5}
.vly-pop .tbl{overflow:auto;max-height:52vh;border:1px solid #3a2f1e;border-radius:8px;background:#140f0a}
.vly-pop table{width:100%;border-collapse:collapse;font-size:12px}
.vly-pop th{position:sticky;top:0;background:#1f1810;text-align:left;font-size:10px;font-weight:700;letter-spacing:1px;
  color:#a8987c;padding:8px 10px;border-bottom:1px solid #3a2f1e;white-space:nowrap}
.vly-pop td{padding:7px 10px;border-bottom:1px solid #2a2216;color:#e8e2d6;vertical-align:middle;white-space:nowrap}
.vly-pop td.n{color:#d9b26a;font-weight:700}
.vly-pop td.m{color:#a8987c}
.vly-pop td.f{max-width:260px;overflow:hidden;text-overflow:ellipsis}
.vly-pop td.r{text-align:right;font-variant-numeric:tabular-nums}
.vly-pop .st{font-size:9.5px;font-weight:700;letter-spacing:.8px;padding:2px 7px;border-radius:999px}
.vly-pop .st.ok{color:#9fe0b0;background:#1f3a29}
.vly-pop .st.low{color:#f0c27a;background:#3a2d17}
.vly-pop .st.bad{color:#ffb0a4;background:#3a1a16}
.vly-pop .ux{border:0;background:transparent;color:#a8987c;cursor:pointer;font-size:15px;line-height:1;padding:0 4px}
.vly-pop .ux:hover{color:#fff}
.vly-pop .warn{color:#ffb0a4}
.vly-export{white-space:nowrap;flex:0 0 auto;background:var(--gold);border:1px solid var(--gold);color:#1a1408;border-radius:7px;padding:5px 14px;
  font:inherit;font-size:11.5px;font-weight:700;letter-spacing:.4px;cursor:pointer}
.vly-export:hover{background:#ecc66a}
.vly-export[disabled]{opacity:.35;cursor:default}
.vly-ideapop{width:min(540px,94vw)}
.vly-ideapop .ex-opts{padding:16px 20px 8px;display:flex;flex-direction:column;gap:12px}
.vly-ideapop .row2{grid-template-columns:92px 1fr}
.vly-body{display:grid;grid-template-columns:252px minmax(0,1fr)}
.vly-side{border-right:1px solid var(--line);background:var(--panel);padding:12px 0 14px;border-radius:0 0 0 8px}
.vly-side-in>.vly-h{padding:0 14px}
/* the cuts never make the node taller than its page: they scroll beside it */
.vly-side{position:relative;padding:0;min-height:260px}
.vly-side-in{position:absolute;inset:12px 0 14px 0;display:flex;flex-direction:column;min-height:0}
.vly-side-in .vly-cuts{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;scrollbar-width:thin;scrollbar-color:#3a3d43 transparent}
.vly-side-in .vly-cuts::-webkit-scrollbar{width:8px}
.vly-side-in .vly-cuts::-webkit-scrollbar-thumb{background:#3a3d43;border-radius:4px}
.vly-h{display:flex;align-items:baseline;gap:7px;font-size:10px;font-weight:700;letter-spacing:1.4px;color:var(--mute);
  margin-bottom:9px}
.vly-h b{color:#5f646c;font-weight:600;letter-spacing:.5px}
.vly-h .hint{margin-left:auto;font-weight:500;letter-spacing:.3px;color:#5f646c}
.vly-cuts{display:flex;flex-direction:column;border-bottom:1px solid var(--line)}
.vly-cut{cursor:pointer;border-top:1px solid var(--line);background:transparent;padding:10px 14px 12px;transition:background .12s}
.vly-cut:hover{background:#00000026}
.vly-cut.cur{background:#00000066;box-shadow:inset 0 2px 0 var(--gold)}
.vly-cut.off{opacity:.4}
.vly-ch{display:grid;grid-template-columns:24px minmax(0,1fr) auto 18px;align-items:baseline;column-gap:4px}
.vly-ch .fd{grid-column:4;align-self:center;width:18px;height:18px;margin:-3px -4px -3px 0;padding:0;border:0;border-radius:4px;
  background:transparent;color:#5f646c;cursor:pointer;display:flex;align-items:center;justify-content:center}
.vly-ch .fd:hover{background:#ffffff0d;color:#e8c977}
.vly-ch .fd svg{width:10px;height:10px;transition:transform .12s}
.vly-cut.fold .vly-ch .fd svg{transform:rotate(-90deg)}
.vly-cut.fold{padding-bottom:10px}
.vly-cut.fold .vly-cp,.vly-cut.fold .vly-cx{display:none}
.vly-h .nc{white-space:nowrap}
.vly-h .fall{margin-left:auto;border:1px solid #2c2f34;background:transparent;color:var(--mute);border-radius:6px;padding:2px 7px;
  font:inherit;font-size:9.5px;font-weight:600;letter-spacing:.4px;cursor:pointer;white-space:nowrap}
.vly-h .fall:hover{color:#e8c977;border-color:#a8883f}
.vly-ch .n{font-size:10px;font-weight:700;letter-spacing:.9px;color:#8f7a4e;font-variant-numeric:tabular-nums}
.vly-cut.cur .vly-ch .n{color:var(--gold)}
.vly-ch .t{font-size:12px;font-weight:500;color:#b9bcc2;line-height:1.35;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vly-cut.cur .vly-ch .t,.vly-cut:hover .vly-ch .t{color:#f1ede5}
.vly-ch .c{font-size:10px;color:#5f646c;letter-spacing:.4px;white-space:nowrap;font-variant-numeric:tabular-nums}
.vly-cut.cur .vly-ch .c{color:#b89a5e}
.vly-cp{display:flex;flex-wrap:wrap;gap:5px;align-items:flex-end;padding:9px 0 0 28px}
.vly-cx{padding:6px 0 0 28px;font-size:10.5px;color:#5f646c;letter-spacing:.2px}
.vly-pkw{position:relative;display:block;line-height:0;overflow:visible}
.vly-pk{display:block;height:44px;border-radius:1px;object-fit:cover;background:#1a1c20;cursor:pointer;
  opacity:.38;transition:opacity .12s,outline-color .12s;outline:1px solid transparent;outline-offset:2px}
.vly-pk:hover{opacity:.85}
.vly-pk.on{opacity:1;outline-color:var(--gold)}
.vly-pkw .cv,.vly-pkw .hd{position:absolute;left:0;right:0;bottom:0;font-size:6.5px;font-weight:700;letter-spacing:1px;line-height:1;
  padding:3px 0 2px;text-align:center;background:#000000b0;pointer-events:none}
.vly-pkw .cv{color:var(--gold)}
.vly-pkw .hd{left:auto;right:0;padding:3px 3px 2px;color:#9fe0b0;border-radius:0}
.vly-pkw .cv + .hd{bottom:9px}
.vly-main{padding:14px;display:flex;flex-direction:column;gap:12px;min-width:0}
.vly-desk{position:relative;background:#0c0d0f;border:1px solid var(--line);border-radius:8px;padding:26px 58px 30px;
  display:flex;align-items:center;justify-content:center}
.vly-canvas{display:block;box-shadow:0 0 0 1px #00000040}
.vly-nav{position:absolute;top:50%;transform:translateY(-50%);width:36px;height:36px;border-radius:50%;
  border:1px solid #2e3136;background:#16171a;color:#aeb3bb;display:flex;align-items:center;justify-content:center;
  cursor:pointer;padding:0}
.vly-nav:hover{border-color:var(--gold);color:var(--gold)}
.vly-nav[disabled]{opacity:.25;cursor:default;border-color:#2e3136;color:#aeb3bb}
.vly-nav.l{left:11px}.vly-nav.r{right:11px}
.vly-nav svg{width:18px;height:18px}
.vly-count{position:absolute;bottom:8px;left:0;right:0;text-align:center;font-size:10.5px;letter-spacing:1px;color:#5f646c}
.vly-tools{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.vly-tools .nm{font-size:12px;color:var(--ink);margin-right:4px}
.vly-tools .nm b{color:var(--gold);font-weight:700;letter-spacing:.6px;margin-right:7px}
.vly-tools .dpi{margin-left:auto;color:var(--mute);font-size:11px}
.vly-tools .dpi b{color:#e0a35a;font-weight:600}
.vly-tseg{display:inline-flex;background:#121315;border:1px solid #2c2f34;border-radius:7px;padding:2px;gap:2px}
.vly-tseg button{background:transparent;border:0;color:var(--mute);font:inherit;font-size:11px;padding:4px 9px;
  border-radius:5px;cursor:pointer;white-space:nowrap}
.vly-tseg button:hover{color:var(--ink);background:#1d1f23}
.vly-tseg button.on{background:#2a2418;color:var(--gold);box-shadow:inset 0 0 0 1px #6a5a33}
.vly-flip{background:transparent;border:1px solid #2c2f34;color:var(--mute);border-radius:7px;padding:4px 10px;
  font:inherit;font-size:11px;cursor:pointer}
.vly-flip:hover{color:var(--ink);border-color:#4a4e56}
/* the caption's place: no taller than the buttons beside it, so the row
   keeps its height from shot to shot */
.vly-pos9{display:inline-grid;grid-template-columns:repeat(3,10px);grid-template-rows:repeat(3,6px);gap:1px;padding:2px 3px;
  background:#121315;border:1px solid #2c2f34;border-radius:6px;margin-left:2px;box-sizing:border-box;height:26px;align-content:center}
.vly-pos9 button{width:10px;height:6px;padding:0;border:0;border-radius:1.5px;background:#2a2c31;cursor:pointer}
.vly-pos9 button:hover{background:#4a4e56}
.vly-pos9 button.on{background:var(--gold)}
.vly-shotrow .mhint{margin-left:auto;font-size:10.5px;color:#5f646c}
.vly-canvas.frameable{cursor:grab}
.vly-canvas.splitx{cursor:col-resize}
.vly-canvas.splity{cursor:row-resize}
.vly-tseg.split button.ic{padding:3px 5px;display:inline-flex;align-items:center}
.vly-tseg.split svg{display:block;width:26px;height:auto}
.vly-tseg.split svg rect{fill:#6b6f77}
.vly-tseg.split svg rect.big{fill:#9aa0a9}
.vly-tseg.split button.on svg rect{fill:#e8c977}
.vly-tseg.split button.on svg rect.big{fill:#fff3cf}
.vly-canvas.frameable.dragging{cursor:grabbing}
.vly-pop .lgrow{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.vly-pop .slrow{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.vly-pop .slrow .sln-n{width:58px;height:28px;box-sizing:border-box;background:#120e09;border:1px solid #4a3b25;border-radius:7px;
  color:#f3e6c8;font:inherit;font-size:12.5px;text-align:center;padding:0 4px}
.vly-pop .slrow .sln-n:focus{outline:none;border-color:#d9b45a}
.vly-pop .slrow .u{font-size:11.5px;color:#a8987c;margin-left:-4px}
.vly-pop .slrow .pbtn[disabled]{opacity:.4;cursor:default}
.vly-pop .kb2{font-size:8.5px;font-weight:700;letter-spacing:.8px;padding:1px 6px;margin-left:6px;border-radius:999px;
  border:1px solid #6a5530;color:#d9b45a;vertical-align:1px}
.vly-pop .lgp{display:inline-flex;align-items:center;justify-content:center;height:34px;min-width:60px;padding:4px 8px;border-radius:5px;
  box-shadow:inset 0 0 0 1px #00000030}
.vly-pop .lgp img{max-height:26px;max-width:120px;display:block}
.vly-player{flex:1 1 100%;display:flex;align-items:center;gap:10px}
.vly-play{width:30px;height:26px;border-radius:7px;border:1px solid #6a5a33;background:#2a2418;color:var(--gold);
  font:inherit;font-size:11px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;padding:0}
.vly-play:hover{background:#3a3020;color:#ffd98a}
.vly-player .tm{font-size:11px;color:var(--mute);font-variant-numeric:tabular-nums;min-width:128px;display:inline-flex;align-items:center;gap:5px}
.vly-player .tm b{color:var(--ink);font-weight:600}
.vly-player .scrub{flex:1;accent-color:#e0b85a;height:4px}
.vly-player .nshots{font-size:10.5px;color:var(--mute)}
.vly-shotrow{flex:1 1 100%;display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-height:28px}
.vly-shotrow .nm{font-size:12px;color:var(--ink);margin-right:4px}
.vly-shotrow .nm b{color:var(--gold);font-weight:700;letter-spacing:.6px;margin-right:7px}
.vly-shotrow .lab2{font-size:10px;font-weight:700;letter-spacing:1.2px;color:var(--mute);margin-left:2px}
.vly-strip-row.tl{display:block;gap:0;padding:3px 0 6px}
.vly-tl{position:relative}
.vly-tl .tl-row{display:flex;align-items:stretch}
.vly-tl .vly-mshot{position:relative;flex:0 0 auto;display:flex;flex-direction:column;gap:5px;cursor:pointer;box-sizing:border-box;
  padding:0 1px;min-width:4px}
.vly-tl .film{height:58px;background:#16181c;border-radius:2px;overflow:hidden;outline:1px solid #2a2c31;outline-offset:-1px}
.vly-tl .film canvas{display:block}
.vly-tl .vly-mshot.sel .film{outline:1.5px solid #a8883f;outline-offset:-1.5px}
.vly-tl .vly-mshot.cur .film{outline:2px solid var(--gold);outline-offset:-2px}
.vly-tl .vly-mshot.sizing .film{outline:2px dashed var(--gold)}
.vly-strip .vly-h,.vly-tl{user-select:none;-webkit-user-select:none}
.vly-strip .tlz{display:inline-flex;align-items:center;gap:2px;margin-left:10px;background:#121315;border:1px solid #2c2f34;border-radius:7px;padding:1px}
.vly-strip .tlz button{width:22px;height:20px;border:0;border-radius:5px;background:transparent;color:var(--ink);font:inherit;font-size:13px;line-height:1;cursor:pointer;padding:0}
.vly-strip .tlz button:hover{background:#2a2c31}
.vly-strip .tlz span{min-width:30px;text-align:center;font-size:10.5px;color:var(--mute);letter-spacing:.3px}
.vly-tl .lb{font-size:10px;color:var(--mute);letter-spacing:.3px;white-space:nowrap;overflow:hidden;text-overflow:clip}
.vly-tl .lb b{color:#bfc3c9;font-weight:700;margin-right:4px}
.vly-tl .vly-mshot.cur .lb b,.vly-tl .vly-mshot.sel .lb b{color:var(--gold)}
.vly-tl .lb i{font-style:normal;color:#6c7179;margin-left:3px}
.vly-tl .edge{position:absolute;top:0;right:-3px;width:7px;height:58px;cursor:ew-resize;z-index:2}
.vly-tl .edge::after{content:"";position:absolute;top:18px;bottom:18px;left:3px;width:1px;background:#ffffff00}
.vly-tl .vly-mshot:hover .edge::after,.vly-tl .vly-mshot.sizing .edge::after{background:var(--gold)}
.vly-tl .tl-wave{display:block;margin-top:6px;cursor:pointer;background:#0a0b0d;border-radius:3px}
.vly-tl .tl-head{position:absolute;top:0;bottom:0;width:1px;background:#f3d27a;z-index:3;cursor:ew-resize}
.vly-tl .tl-head::before{content:"";position:absolute;top:0;bottom:0;left:-5px;width:11px}
.vly-tl .tl-head::after{content:"";position:absolute;top:-3px;left:-5px;width:11px;height:8px;background:#f3d27a;
  clip-path:polygon(0 0,100% 0,50% 100%)}
.vly-strip-row.scrubbing,.vly-strip-row.scrubbing *{cursor:ew-resize !important}
.vly-tl .tl-mk{position:absolute;bottom:0;width:9px;height:58px;margin-left:-4px;cursor:pointer;z-index:2}
.vly-tl .tl-mk::before{content:"";position:absolute;left:4px;bottom:0;width:1px;height:54px;background:#7fc4d8}
.vly-tl .tl-mk::after{content:"";position:absolute;left:0;bottom:50px;width:9px;height:7px;background:#7fc4d8;clip-path:polygon(0 0,100% 0,50% 100%)}
.vly-tl .tl-mk:hover::before,.vly-tl .tl-mk:hover::after,.vly-tl .tl-mk.snap::before,.vly-tl .tl-mk.snap::after{background:#fff}
.vly-strip .mkbar{display:inline-flex;align-items:center;gap:5px;margin-left:12px;flex:0 0 auto}
.vly-strip .vly-h{flex-wrap:nowrap;align-items:center}
.vly-strip .vly-h .hint{flex:1 1 auto;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;text-align:right}
.vly-strip .mkl{white-space:nowrap}
.vly-strip .tlz{flex:0 0 auto}
.vly-strip .mkl{font-size:10px;font-weight:700;letter-spacing:1.2px;color:#7fc4d8}
.vly-strip .mkl b{color:#c7ecf6;margin-left:3px}
.vly-strip .mkl i{font-style:normal;color:#4f8496;margin-left:4px;font-weight:600;letter-spacing:.4px}
.vly-strip .mkb{background:transparent;border:1px solid #3f7384;color:#9fd6e6;border-radius:6px;padding:3px 9px;font:inherit;font-size:11px;
  font-weight:600;letter-spacing:.2px;cursor:pointer;white-space:nowrap}
.vly-strip .mkb:hover{border-color:#7fc4d8;color:#e2f6fb;background:#0f2a33}
.vly-strip .mkb.armed{background:#c0473a;border-color:#c0473a;color:#fff}
.vly-strip .mkb.ic{width:28px;height:24px;padding:0;display:inline-flex;align-items:center;justify-content:center}
.vly-strip .mkb.ic svg{width:15px;height:15px;display:block}
.vly-tl .tl-head .tip{position:absolute;top:4px;left:7px;padding:2px 6px;border-radius:4px;background:#f3d27a;color:#1b1407;
  font-size:10.5px;font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap;pointer-events:none;opacity:0;transition:opacity .1s}
.vly-strip-row.scrubbing .tl-head .tip,.vly-tl .tl-head:hover .tip{opacity:1}
.vly-tl .tl-head.snap{background:#fff;box-shadow:0 0 0 1px #fff}
.vly-tl .tl-head.snap .tip{opacity:1;background:#fff}
.vly-tl .etip{position:absolute;top:4px;right:6px;padding:2px 6px;border-radius:4px;background:#000000c0;color:#f3d27a;
  font-size:10.5px;font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap;pointer-events:none;display:none;z-index:4}
.vly-tl .vly-mshot.sizing .etip{display:block}
.vly-tl .mvk{position:absolute;top:3px;left:4px;width:13px;height:13px;border-radius:3px;background:#000000b8;z-index:3;
  color:#f3d27a;display:flex;align-items:center;justify-content:center;pointer-events:auto}
.vly-tl .mvk.auto{color:#c9ccd2}
.vly-tl .mvk svg{width:9px;height:9px;display:block}
.vly-tl .pass{position:absolute;top:3px;right:5px;width:12px;height:12px;border-radius:3px;background:#000000b8;z-index:3;pointer-events:auto}
.vly-tl .pass::after{content:"";position:absolute;inset:3px}
.vly-tl .pass.p-fade::after{background:#f3d27a;clip-path:polygon(0 100%,100% 0,100% 100%)}
.vly-tl .pass.p-cut::after{left:5px;right:5px;background:#e8e2d6}
.vly-tl .pass.p-black::after{background:#000;box-shadow:0 0 0 1px #8a8f98}
.vly-tl .vly-mshot.rolling .film{outline:2px dashed #7fc4d8;outline-offset:-2px}
.vly-player .tmi{width:66px;background:#121315;border:1px solid #2c2f34;border-radius:6px;color:var(--ink);font:inherit;font-size:11px;
  font-weight:600;font-variant-numeric:tabular-nums;padding:3px 6px;text-align:center;outline:none}
.vly-player .tmi:focus{border-color:#a8883f}
.vly-strip .msel{color:var(--gold);margin-left:10px;font-weight:600;letter-spacing:.3px;white-space:nowrap;flex:0 0 auto}
.vly-shotrow .nm em{font-style:normal;color:var(--gold);font-size:11px;margin-left:4px}
.vly-shotrow .lnum{display:inline-flex;align-items:center;gap:3px;background:#121315;border:1px solid #2c2f34;border-radius:7px;padding:0 7px 0 3px;height:26px;box-sizing:border-box}
.vly-shotrow .lnum input{width:42px;background:transparent;border:0;color:var(--ink);font:inherit;font-size:11.5px;text-align:right;outline:none}
.vly-shotrow .lnum i{font-style:normal;color:var(--mute);font-size:11px}
.vly-mshot span i{font-style:normal;color:#6c7179;margin-left:3px}
.vly-mshot .mdel{position:absolute;top:4px;right:4px;width:18px;height:18px;border-radius:50%;border:0;padding:0;
  background:#000000b0;color:#fff;font-size:12px;line-height:18px;cursor:pointer;opacity:0;transition:opacity .12s}
.vly-mshot:hover .mdel{opacity:1}
/* on the timeline the corners above are the move and the pass: the
   button sits at the foot of the picture instead */
.vly-tl .vly-mshot .mdel{top:38px;right:4px;width:16px;height:16px;line-height:16px;font-size:11px}
.vly-mshot .mdel:hover{background:#c0473a}
.vly-strip .mlen{color:var(--gold);font-weight:600;margin-left:6px;letter-spacing:.3px}
.vly-mrestore{background:transparent;border:0;color:#e0b85a;font:inherit;font-size:10.5px;font-weight:700;cursor:pointer;margin-left:10px;letter-spacing:.4px}
.vly-music{display:flex;flex-direction:column;gap:9px;background:#0c0d0f;border:1px solid var(--line);border-radius:8px;padding:11px 12px 12px}
.vly-music .mu-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.vly-music .mu-name{font-size:12px;color:var(--mute)}
.vly-music .mu-name b{color:var(--ink);font-weight:500}
.vly-music .mu-x{width:22px;height:22px;border-radius:6px;border:1px solid #2c2f34;background:#121315;color:var(--mute);cursor:pointer;
  display:inline-flex;align-items:center;justify-content:center;padding:0}
.vly-music .mu-x svg{width:12px;height:12px}
.vly-music .mu-x:hover{color:#fff;border-color:#4a4e56}
.vly-music .lab2{font-size:10px;font-weight:700;letter-spacing:1.2px;color:var(--mute)}
.vly-music input[type=range]{accent-color:#e0b85a;width:120px}
.vly-music .mu-sv{font-size:11px;color:var(--ink);font-variant-numeric:tabular-nums;min-width:32px}
.vly-music .mu-info{font-size:11px;color:var(--mute)}
.vly-music .mu-lib{white-space:nowrap;background:transparent;border:1px solid #a8883f;color:#e8c977;border-radius:7px;padding:5px 12px;
  font:inherit;font-size:11.5px;font-weight:700;letter-spacing:.4px;cursor:pointer}
.vly-music .mu-lib b{color:#fff3cf;font-weight:700;margin:0 2px}
.vly-music .mu-lib i{font-style:normal;font-size:9px;margin-left:2px}
.vly-music .mu-lib:hover{border-color:#e8c977;color:#fff3cf}
.vly-music .mu-lib.on{background:#2a2113;border-color:#e8c977}
.vly-music .mu-list{display:flex;flex-direction:column;border-top:1px solid var(--line);max-height:220px;overflow-y:auto}
.vly-music.drop{outline:2px dashed var(--gold);outline-offset:-4px;background:#2a211333}
.vly-music .mu-mode{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 0 6px;border-top:1px solid var(--line)}
.vly-music .mu-mode .hint{font-size:10.5px;color:#5f646c}
.vly-music .mu-pv{width:22px;height:22px;border-radius:50%;border:1px solid #a8883f;background:transparent;color:#e8c977;cursor:pointer;
  display:inline-flex;align-items:center;justify-content:center;padding:0;flex:0 0 auto}
.vly-music .mu-pv svg{width:10px;height:10px;display:block}
.vly-music .mu-pv:hover{border-color:#e8c977;color:#fff3cf;background:#2a2113}
.vly-music .mu-pv.on{background:#e8c977;border-color:#e8c977;color:#241703}
.vly-music .mu-pt{font-size:10.5px;color:var(--gold);font-style:normal;font-variant-numeric:tabular-nums;min-width:0}
.vly-music .mu-it .mu-pv{width:20px;height:20px;justify-self:center}
.vly-music .mu-it{display:grid;grid-template-columns:22px 18px 18px minmax(0,1fr) auto 40px 60px 22px 22px;align-items:center;gap:8px;padding:6px 4px;
  border-bottom:1px solid #1d1f23;cursor:pointer;font-size:11.5px;color:#b9bcc2}
.vly-music .mu-it:hover{background:#00000030;color:#f1ede5}
.vly-music .mu-it .dot{width:6px;height:6px;border-radius:50%;background:#2c2f34;justify-self:center}
.vly-music .mu-it.playing,.vly-music .mu-it.playing:hover{color:var(--gold)}
.vly-music .mu-it.cur .dot{background:var(--gold)}
.vly-music .mu-it .nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vly-music .mu-it .sz{color:#5f646c;font-size:10.5px;font-variant-numeric:tabular-nums}
.vly-music .mu-it .du{color:#8a8e95;font-size:10.5px;font-variant-numeric:tabular-nums;text-align:right}
.vly-music .mu-mk{width:16px;height:16px;border-radius:4px;border:1px solid #3a3d43;background:transparent;color:transparent;cursor:pointer;
  display:inline-flex;align-items:center;justify-content:center;padding:0;justify-self:center}
.vly-music .mu-mk svg{width:10px;height:10px;display:block}
.vly-music .mu-mk:hover{border-color:#a8883f;color:#6a5a33}
.vly-music .mu-mk.on{background:#e8c977;border-color:#e8c977;color:#241703}
.vly-music .mu-st{display:inline-flex;align-items:center;gap:4px;margin-left:8px;padding:1px 7px 1px 5px;border-radius:9px;
  background:#2a2113;color:var(--gold);font-size:10px;font-style:normal;vertical-align:1px}
.vly-music .mu-st svg{width:11px;height:11px;display:block}
.vly-music .pvm button.ic{padding:3px 7px;display:inline-flex;align-items:center}
.vly-music .pvm button.ic svg{width:15px;height:15px;display:block}
.vly-music .mu-mode .mk{font-size:10.5px;color:var(--gold)}
.vly-music .mu-now{display:inline-flex;align-items:baseline;gap:8px;max-width:300px;min-width:0;font-size:11.5px;color:var(--gold)}
.vly-music .mu-now .nn{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.vly-music .mu-now .nt{flex:0 0 auto;font-size:10.5px;color:#a8883f;font-variant-numeric:tabular-nums}
.vly-music .mu-now .nt .mu-pt{color:var(--gold)}
.vly-music .mu-now.idle,.vly-music .mu-now.paused .nn{color:#8a8e95}
.vly.player .vly-top,.vly.player .vly-side,.vly.player .vly-desk,.vly.player .vly-tools,.vly.player .vly-coverpick,
.vly.player .vly-extra,.vly.player .vly-strip,.vly.player .vly-note{display:none!important}
.vly.player .vly-music>.vly-h,.vly.player .vly-music .mu-row,.vly.player .vly-music .mu-info{display:none}
.vly.player .vly-music .mu-mode{border-top:0;padding-top:2px}
.vly.player .vly-body{grid-template-columns:minmax(0,1fr)}
.vly.player .vly-music .mu-list{max-height:none}
.vly.player .vly-music .mu-mode>.lab2{color:var(--gold)}
.vly-music .mp-head{display:flex;flex-direction:column;gap:14px;padding:2px 2px 12px}
.vly-music .mp-top{display:flex;align-items:center;gap:12px}
.vly-music .mp-top .lab2{color:var(--gold)}
.vly-music .mp-where{font-size:11px;color:#8a8e95;margin-right:auto}
.vly-music .mp-main{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:22px;
  padding:14px 16px;border:1px solid color-mix(in srgb,var(--sg) 30%,#2c2f34);border-radius:12px;
  background:color-mix(in srgb,var(--sg) 13%,#1a1c1f)}
/* the display: a black window set into the body, the gold lit inside it */
.vly-music .mp-now{background:#050607;border:1px solid #000;border-radius:8px;padding:12px 16px 11px;
  box-shadow:inset 0 2px 8px rgba(0,0,0,.85),inset 0 0 0 1px rgba(255,255,255,.035),0 1px 0 rgba(255,255,255,.05)}
.vly-music .mp-tr{display:flex;align-items:center;gap:10px}
.vly-music .mp-tr button{width:36px;height:36px;border-radius:50%;border:0;background:transparent;color:#d6d8dc;cursor:pointer;padding:0;
  display:inline-flex;align-items:center;justify-content:center}
.vly-music .mp-tr button svg{width:18px;height:18px;display:block}
.vly-music .mp-tr button:hover{color:#fff3cf;background:#2a2113}
.vly-music .mp-tr button.pp{width:50px;height:50px;border:1px solid #a8883f;color:#e8c977}
.vly-music .mp-tr button.pp svg{width:20px;height:20px}
.vly-music .mp-tr button.pp.on,.vly-music .mp-tr button.pp:hover{background:#e8c977;border-color:#e8c977;color:#241703}
.vly-music .mp-now{min-width:0;display:flex;flex-direction:column;gap:7px}
.vly-music .mp-title{font-size:15px;font-weight:500;color:var(--gold);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vly-music .mp-now.idle .mp-title,.vly-music .mp-now.paused .mp-title{color:#b9bcc2}
.vly-music .mp-side{display:flex;flex-direction:column;align-items:stretch;gap:10px;width:max-content}
.vly-music .mp-row2{display:flex;align-items:center;justify-content:space-between;gap:10px}
.vly-music .mp-side .pvm{display:flex}
.vly-music .mu-fl{display:inline-flex;align-items:center;gap:4px;margin-left:8px;padding:1px 7px 1px 5px;border-radius:9px;
  border:1px solid #6a5a33;color:var(--gold);font-size:10px;vertical-align:1px}
.vly-music .mu-fl svg{width:11px;height:11px;display:block}
.vly-music .mp-here{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 11px;border-radius:7px;border:1px solid #2c2f34;
  background:#121315;color:#d6d8dc;font:inherit;font-size:11px;cursor:pointer;white-space:nowrap}
.vly-music .mp-here svg{width:13px;height:13px}
.vly-music .mp-here i{font-style:normal;color:var(--gold);font-variant-numeric:tabular-nums;min-width:28px}
.vly-music .mp-here:hover{border-color:var(--gold);color:#fff3cf}
.vly-music .mp-film{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 11px;border-radius:7px;border:1px solid #a8883f;
  background:transparent;color:#e8c977;font:inherit;font-size:11px;cursor:pointer;white-space:nowrap}
.vly-music .mp-film svg{width:13px;height:13px}
.vly-music .mp-film:hover:not(:disabled){background:#e8c977;color:#241703}
.vly-music .mp-film.on{background:#2a2418;border-color:#6a5a33;color:var(--gold);cursor:default}
.vly-music .mp-film:disabled:not(.on){border-color:#2c2f34;color:#5f646c;cursor:default}
.vly-music .mp-eqb{display:none!important}
.vly-music .mp-eqb-x{display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 9px;border-radius:7px;border:1px solid #2c2f34;
  background:#121315;color:#8a8e95;font:inherit;font-size:10.5px;letter-spacing:.06em;cursor:pointer}
.vly-music .mp-eqb svg{width:12px;height:12px}
.vly-music .mp-eqb:hover{color:var(--ink);border-color:#3a3d43}
.vly-music .mp-eqb.on{background:#2a2418;border-color:#6a5a33;color:var(--gold)}
.vly-music .mp-vol{display:flex;align-items:center;gap:6px;color:#8a8e95}
.vly-music .mp-vol svg{width:14px;height:14px;flex:0 0 auto}
.vly-music .mp-vol input.mp-volr{width:70px;-webkit-appearance:none;appearance:none;height:12px;background:transparent;cursor:pointer;margin:0}
.vly-music .mp-volr::-webkit-slider-runnable-track{height:2px;border-radius:1px;background:linear-gradient(to right,#e8c977 var(--v,100%),#3a3d43 var(--v,100%))}
.vly-music .mp-volr::-moz-range-track{height:2px;border-radius:1px;background:#3a3d43}
.vly-music .mp-volr::-moz-range-progress{height:2px;border-radius:1px;background:#e8c977}
.vly-music .mp-volr::-webkit-slider-thumb{-webkit-appearance:none;width:10px;height:10px;border-radius:50%;background:#e8c977;border:0;margin-top:-4px}
.vly-music .mp-volr::-moz-range-thumb{width:10px;height:10px;border-radius:50%;background:#e8c977;border:0}
.vly-music .mp-eq{display:block;width:100%;height:22px;color:var(--gold)}
.vly-music .mp-bar{display:flex;align-items:center;gap:10px;font-size:10.5px;color:#8a8e95;font-variant-numeric:tabular-nums}
.vly-music .mp-bar .mu-pt{color:var(--gold);min-width:30px}
.vly-music .mp-bar .t1{min-width:30px;text-align:right}
.vly-music .mp-track{flex:1;height:14px;display:flex;align-items:center;cursor:pointer;position:relative}
.vly-music .mp-track::before{content:"";position:absolute;left:0;right:0;top:6px;height:3px;border-radius:2px;background:#2c2f34}
.vly-music .mp-track i{position:relative;display:block;height:3px;border-radius:2px;background:var(--gold)}
.vly-music .mp-track:hover::before{background:#3a3d43}
.vly-music .mp-tabs{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.vly-music .mp-tabs .mk,.vly-music .mp-tabs .hint{margin-left:auto;font-size:10.5px}
.vly-music .mp-tabs .hint{color:#5f646c}
.vly-music .mp-tabs .mk{color:var(--gold)}
.vly-music .mp-tabs .mk button{background:transparent;border:0;color:#8a8e95;font:inherit;cursor:pointer;text-decoration:underline;padding:0 0 0 6px}
.vly-music .mu-back{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 11px;border-radius:7px;border:1px solid #2c2f34;
  background:#121315;color:#b9bcc2;font:inherit;font-size:11px;cursor:pointer}
.vly-music .mu-back svg{width:13px;height:13px}
.vly-music .mu-back:hover{border-color:var(--gold);color:#fff3cf}
.vly-music .mu-tr{display:inline-flex;align-items:center;gap:4px}
.vly-music .mu-tr button{width:28px;height:28px;border-radius:50%;border:0;background:transparent;color:#b9bcc2;cursor:pointer;padding:0;
  display:inline-flex;align-items:center;justify-content:center}
.vly-music .mu-tr button svg{width:14px;height:14px;display:block}
.vly-music .mu-tr button:hover{color:#fff3cf;background:#2a2113}
.vly-music .mu-tr button.pp{border:1px solid #a8883f;color:#e8c977}
.vly-music .mu-tr button.pp.on{background:#e8c977;border-color:#e8c977;color:#241703}
.vly-music .mu-tabs{display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap}
.vly-music .mu-mode .mk,.vly-music .mu-mode .hint{margin-left:auto}
.vly-music .mu-tab{display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 9px;border-radius:12px;border:1px solid #2c2f34;
  background:#121315;color:var(--mute);font:inherit;font-size:11px;cursor:pointer;white-space:nowrap}
.vly-music .mu-tab b{font-weight:600;color:#5f646c;font-variant-numeric:tabular-nums}
.vly-music .mu-tab svg{width:12px;height:12px;display:block;flex:0 0 auto}
.vly-music .mu-tab:hover{color:var(--ink);border-color:#3a3d43}
.vly-music .mu-tab.on{background:#2a2418;border-color:#6a5a33;color:var(--gold)}
.vly-music .mu-tab.on b{color:#a8883f}
.vly-music .mu-tab.over{border-color:var(--gold);background:#3a2e17;color:#fff3cf}
.vly-music .mu-tab.add{border-style:dashed;color:#8a8e95}
.vly-music .mu-tab .mu-fdx{display:inline-flex;width:14px;height:14px;border-radius:50%;align-items:center;justify-content:center;margin-right:-4px;color:#a8883f}
.vly-music .mu-tab .mu-fdx svg{width:9px;height:9px}
.vly-music .mu-tab .mu-fdx:hover{background:#00000040;color:#fff}
.vly-music .mu-tab .mu-fdx.armed{background:#c0473a;color:#fff}
.vly-music .mu-fin{height:24px;border-radius:12px;border:1px solid var(--gold);background:#121315;color:#f1ede5;font:inherit;font-size:11px;
  padding:0 10px;width:150px;outline:none}
.vly-music .mu-st2{width:16px;height:16px;border:0;background:transparent;color:#4a4d53;cursor:pointer;padding:0;
  display:inline-flex;align-items:center;justify-content:center;justify-self:center}
.vly-music .mu-st2 svg{width:13px;height:13px;display:block}
.vly-music .mu-st2:hover{color:#a8883f}
.vly-music .mu-st2.on{color:var(--gold)}
.vly-music .mu-rin{width:min(100%,420px);height:22px;border-radius:5px;border:1px solid var(--gold);background:#121315;color:#f1ede5;
  font:inherit;font-size:11.5px;padding:0 7px;outline:none}
.vly-music .mu-ord{display:inline-flex;gap:2px;opacity:0;justify-self:center}
.vly-music .mu-it:hover .mu-ord{opacity:1}
.vly-music .mu-ord button{width:18px;height:18px;border-radius:4px;border:0;background:transparent;color:#8a8e95;cursor:pointer;padding:0;
  display:inline-flex;align-items:center;justify-content:center}
.vly-music .mu-ord button svg{width:11px;height:11px;display:block}
.vly-music .mu-ord button:hover:not(:disabled){color:var(--gold);background:#2c2f34}
.vly-music .mu-ord button:disabled{opacity:.25;cursor:default}
.vly-music .mu-fb{width:20px;height:20px;border-radius:5px;border:0;background:transparent;color:#5f646c;cursor:pointer;opacity:0;
  display:inline-flex;align-items:center;justify-content:center;padding:0}
.vly-music .mu-fb svg{width:13px;height:13px}
.vly-music .mu-it:hover .mu-fb,.vly-music .mu-fb.on{opacity:1}
.vly-music .mu-fb:hover,.vly-music .mu-fb.on{color:var(--gold);background:#2c2f34}
.vly-music .mu-it.drag{opacity:.45}
.vly-music .mu-fm{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:6px 4px 8px 66px;border-bottom:1px solid #1d1f23;background:#00000026}
.vly-music .mu-fm .lab2{margin-right:4px}
.vly-music .mu-fm .mu-tab{height:22px}
.vly-music .mu-empty{padding:14px 4px;font-size:11px;color:#5f646c;border-bottom:1px solid #1d1f23}
.vly-music .mu-mode .mk button{background:transparent;border:0;color:#8a8e95;font:inherit;cursor:pointer;text-decoration:underline;padding:0 0 0 6px}
.vly-music .mu-mode .mk button:hover{color:#f1ede5}
.vly-music .mu-del{width:20px;height:20px;border-radius:5px;border:0;background:transparent;color:#5f646c;cursor:pointer;opacity:0;
  display:inline-flex;align-items:center;justify-content:center;padding:0}
.vly-music .mu-del svg{width:11px;height:11px}
.vly-music .mu-it:hover .mu-del{opacity:1}
.vly-music .mu-del:hover{color:#fff;background:#2c2f34}
.vly-music .mu-del.armed{opacity:1;color:#fff;background:#c0473a}
.vly-music .mu-info .warn{color:#e0a35a}
.vly-exp .fmtx{font-size:12px;color:#e8e2d6}
.vly-rec{width:min(520px,94vw)}
.vly-rec .rc-body{display:flex;justify-content:center;padding:18px;background:#0c0d0f}
.vly-rec canvas{display:block;max-width:100%;box-shadow:0 0 0 1px #00000060}
.vly-rec .kb2{font-variant-numeric:tabular-nums}
.vly-vsep{flex:0 0 auto;align-self:stretch;width:1px;background:#33363c;margin:3px 4px}
.vly-flip.on{background:#2a2113;border-color:#a8883f;color:#f0d08a}
.vly-coverpick{display:flex;flex-direction:column;gap:8px;background:#0c0d0f;border:1px solid var(--line);
  border-radius:8px;padding:11px 12px 12px}
.vly-coverpick .cps{display:flex;flex-wrap:wrap;gap:6px;align-items:flex-end}
.vly-coverpick .cp{display:block;border-radius:2px;object-fit:cover;cursor:pointer;opacity:.6;outline:1px solid #ffffff14;outline-offset:-1px}
.vly-coverpick .cp:hover{opacity:1}
.vly-coverpick .cp.on{opacity:1;outline:2px solid var(--gold);outline-offset:1px}
.vly-shotrow .mswap{white-space:nowrap;background:transparent;border:1px solid #a8883f;color:#e8c977;border-radius:7px;
  padding:4px 11px;font:inherit;font-size:11px;font-weight:700;letter-spacing:.4px;cursor:pointer}
.vly-shotrow .mswap i{font-style:normal;font-size:9px;margin-left:2px}
.vly-shotrow .mswap:hover{border-color:#e8c977;color:#fff3cf}
.vly-shotrow .mswap.on{background:#2a2113;border-color:#e8c977;color:#fff3cf}
.vly-coverpick .cpw{position:relative;display:block}
.vly-coverpick .cpw.used .cp{opacity:.35}
.vly-coverpick .cpw.used:hover .cp{opacity:.9}
.vly-coverpick .cpw i{position:absolute;right:4px;top:4px;width:6px;height:6px;border-radius:50%;background:#7fc4d8;pointer-events:none}
.vly-coverpick .cauto{align-self:center;background:transparent;border:1px solid #2c2f34;color:var(--mute);border-radius:7px;
  padding:4px 10px;font:inherit;font-size:11px;cursor:pointer}
.vly-coverpick .cauto.on{background:#2a2418;color:var(--gold);box-shadow:inset 0 0 0 1px #6a5a33;border-color:transparent}
.vly-extra{display:flex;flex-direction:column;gap:7px;background:#0c0d0f;border:1px solid var(--line);
  border-radius:8px;padding:11px 12px 12px}
.vly-extra textarea{width:100%;min-height:52px;resize:vertical;background:#101113;border:1px solid #2c2f34;color:var(--ink);
  border-radius:7px;padding:8px 10px;font:inherit;font-size:12px;line-height:1.5;outline:none}
.vly-extra textarea:focus{border-color:#6a5a33}
.vly-strip{background:#0c0d0f;border:1px solid var(--line);border-radius:8px;padding:11px 12px 12px}
.vly-strip-row{display:flex;gap:10px;align-items:flex-end;overflow-x:auto;padding:3px 3px 4px}
.vly-mini{position:relative;display:flex;flex-direction:column;gap:5px;cursor:pointer;flex:0 0 auto}
.vly-mini .del{position:absolute;top:4px;right:4px;width:18px;height:18px;border-radius:50%;border:0;padding:0;
  background:#000000b0;color:#fff;font-size:12px;line-height:18px;cursor:pointer;opacity:0;transition:opacity .12s}
.vly-mini:hover .del{opacity:1}
.vly-mini .del:hover{background:#c0473a}
.vly-restore{margin-left:8px;background:transparent;border:0;padding:0;font:inherit;font-size:10px;font-weight:600;
  letter-spacing:.4px;color:#b89a5e;cursor:pointer}
.vly-restore:hover{color:var(--gold)}
.vly-tools .lab2{font-size:10px;font-weight:700;letter-spacing:1.2px;color:var(--mute);margin-left:6px}
.vly-mini canvas{display:block;border-radius:2px;outline:1px solid #2a2c31;outline-offset:0}
.vly-mini:hover canvas{outline-color:#4a4e56}
.vly-mini.cur canvas{outline:2px solid var(--gold);outline-offset:1px}
.vly-mini span{font-size:10px;color:var(--mute);letter-spacing:.3px;white-space:nowrap}
.vly-mini span b{color:#bfc3c9;font-weight:700;margin-right:4px}
.vly-mini.cur span,.vly-mini.cur span b{color:var(--gold)}
.vly-note{color:var(--mute);font-size:11px;min-height:15px}
.vly-note.err{color:#ff8a8a}
.vly-full{display:none;position:fixed;inset:0;background:#0a0a0b;z-index:10000;align-items:center;justify-content:center}
.vly-full.on{display:flex}
.vly-full canvas{display:block;box-shadow:0 10px 50px #000}
.vly-full .vly-nav{width:48px;height:48px;background:#121315}
.vly-full .vly-nav.l{left:22px}.vly-full .vly-nav.r{right:22px}
.vly-full .vly-nav svg{width:22px;height:22px}
.vly-ftop{position:absolute;top:0;left:0;right:0;display:flex;align-items:center;gap:12px;padding:14px 20px;
  color:#c9ccd2;font-size:12px}
.vly-ftop .s{color:var(--gold);font-weight:700;letter-spacing:1.2px;font-size:11px}
.vly-ftop .x{margin-left:auto;width:32px;height:32px;border-radius:8px;border:0;background:transparent;color:#8b9098;
  display:flex;align-items:center;justify-content:center;cursor:pointer}
.vly-ftop .x:hover{background:#ffffff12;color:#fff}
.vly-fkeys{position:absolute;bottom:14px;left:0;right:0;text-align:center;font-size:11px;color:#5f646c;letter-spacing:.3px}
.vly-fkeys kbd{font-family:inherit;border:1px solid #33363c;border-radius:4px;padding:0 5px;color:#9aa0a8;margin:0 2px}
.vly-pop{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:10001;width:min(640px,94vw);max-height:86vh;
  display:flex;flex-direction:column;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;font-size:13px;color:#e8e2d6;
  background:#1b160f;border:1px solid #5e4b2c;border-radius:12px;box-shadow:0 24px 60px #000b,0 0 0 1px #0006}
.vly-pop svg{width:15px;height:15px;display:block}
.vly-pop .hd{display:flex;align-items:center;gap:10px;padding:13px 14px 12px 18px;border-bottom:1px solid #3a2f1e}
.vly-pop .tt{font-size:15px;font-weight:600;color:#f6eedf;letter-spacing:.2px}
.vly-pop .kb{font-size:10px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;padding:3px 9px;border-radius:999px;
  color:#d9b26a;border:1px solid #d9b26a88;background:#d9b26a1f}
.vly-pop .xx{margin-left:auto;width:28px;height:28px;border-radius:8px;border:0;background:transparent;color:#a8987c;
  display:flex;align-items:center;justify-content:center;cursor:pointer}
.vly-pop .xx:hover{background:#ffffff10;color:#fff}
.vly-pop .opts{display:flex;gap:28px;padding:16px 18px 2px;flex-wrap:wrap}
.vly-pop .grp{display:flex;flex-direction:column;gap:8px}
.vly-pop .sws{display:flex;gap:8px}
.vly-pop .th{display:flex;flex-direction:column;align-items:center;gap:5px;background:transparent;border:0;padding:0;cursor:pointer}
.vly-pop .th .chip{position:relative;width:52px;height:38px;border-radius:6px;display:flex;align-items:flex-end;
  padding:0 0 4px 7px;font-family:"VLY Serif",Georgia,serif;font-size:17px;box-shadow:0 0 0 1px #5e4b2c}
.vly-pop .th .chip b{position:absolute;left:7px;top:8px;width:12px;height:2px}
.vly-pop .th .nm{font-size:10.5px;color:#a8987c}
.vly-pop .th:hover .chip{box-shadow:0 0 0 1px #e0b85a}
.vly-pop .th.on .chip{box-shadow:0 0 0 2px #e0b85a}
.vly-pop .th.on .nm{color:#f0c27a}
.vly-pop .pseg{display:inline-flex;background:#120e09;border:1px solid #4a3b25;border-radius:7px;padding:2px;gap:2px}
.vly-pop .pseg button{background:transparent;border:0;color:#a8987c;font:inherit;font-size:12px;padding:6px 14px;border-radius:5px;cursor:pointer}
.vly-pop .pseg button:hover{color:#efe6d6}
.vly-pop .pseg button.on{background:#e0b85a;color:#241703;font-weight:600}
.vly-pop .sec{position:sticky;top:0;z-index:1;padding:6px 10px 4px;font-size:9.5px;font-weight:700;letter-spacing:1.2px;
  color:#a8987c;background:#1b150d;border-bottom:1px solid #2a2216}
.vly-pop .it{position:relative;padding-right:30px}
.vly-pop .star{position:absolute;right:6px;top:7px;border:0;background:transparent;color:#6a5636;font-size:15px;
  cursor:pointer;padding:0 3px;line-height:1}
.vly-pop .star:hover,.vly-pop .star.on{color:#f0c27a}
.vly-pop .sizes{align-items:flex-end;padding-top:12px}
.vly-pop .sz{min-width:170px}
.vly-pop .sz .v{color:#f0c27a;font-weight:600;margin-left:6px;letter-spacing:.3px}
.vly-pop .sz input{accent-color:#e0b85a;width:100%;padding:0;border:0;background:transparent}
.vly-pop .path{font-size:12.5px;color:#f0c27a;font-family:ui-monospace,Consolas,monospace}
.vly-pop .pk-grid{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:#3a2f1e;border:1px solid #3a2f1e;border-radius:8px;overflow:hidden}
.vly-pop .pk-grid div{background:#140f0a;padding:9px 12px;display:flex;flex-direction:column;gap:2px}
.vly-pop .pk-grid div:last-child:nth-child(odd){grid-column:span 2}
.vly-pop .pk-grid b{font-size:12px;color:#f3ead9;font-weight:600}
.vly-pop .pk-grid span{font-size:11px;color:#a8987c}
.vly-exp{width:min(900px,96vw)}
.vly-exp .kb2{font-size:12px;color:#a8987c}
.vly-exp .ex-body{display:grid;grid-template-columns:320px minmax(0,1fr);gap:20px;padding:18px;min-height:0;overflow:auto}
.vly-exp .ex-prev{display:flex;flex-direction:column;gap:8px;align-items:center;justify-content:flex-start;
  background:#0c0d0f;border:1px solid #3a2f1e;border-radius:8px;padding:14px 10px}
.vly-exp .ex-prev canvas{display:block;box-shadow:0 0 0 1px #00000060}
.vly-exp .ex-cap{font-size:11px;color:#a8987c;text-align:center}
.vly-exp .ex-opts{display:flex;flex-direction:column;gap:14px}
.vly-exp .row2{display:grid;grid-template-columns:110px minmax(0,1fr);align-items:center;gap:12px}
.vly-exp .row2.top{align-items:start}
.vly-exp .row2 .lab{padding-top:2px}
.vly-exp .pseg{justify-self:start}
.vly-exp .ex-sizes{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.vly-exp .ck{display:flex;gap:9px;align-items:flex-start;cursor:pointer;padding:8px 10px;border:1px solid #3a2f1e;border-radius:7px;
  background:#140f0a}
.vly-exp .ck:hover{border-color:#6a5636}
.vly-exp .ck.on{border-color:#e0b85a;background:#2a2113}
.vly-exp .ck .bx{width:13px;height:13px;border-radius:3px;border:1px solid #6a5636;flex:0 0 auto;margin-top:2px}
.vly-exp .ck.on .bx{background:#e0b85a;border-color:#e0b85a;box-shadow:inset 0 0 0 2px #2a2113}
.vly-exp .ck b{display:block;font-size:12px;color:#f3ead9;font-weight:600}
.vly-exp .ck i{display:block;font-style:normal;font-size:11px;color:#a8987c}
.vly-exp .ex-check{display:flex;flex-direction:column;gap:8px;font-size:12px;color:#e8e2d6}
.vly-exp .okk{color:#9fe0b0}
.vly-exp .lnk{background:transparent;border:0;padding:0;color:#f0c27a;font:inherit;font-size:12px;cursor:pointer;text-decoration:underline}
.vly-exp .ex-dir{display:flex;flex-direction:column;gap:6px}
.vly-exp .ex-post{display:flex;flex-direction:column;gap:8px;padding:14px 18px 16px;border-top:1px solid #3a2f1e}
.vly-exp .ex-post .ph{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.vly-exp .ex-post .ph .lab{min-width:100px}
.vly-exp .ex-post .sp{flex:1}
.vly-exp .ppseg{display:inline-flex;background:#140f0a;border:1px solid #3a2f1e;border-radius:999px;padding:2px}
.vly-exp .ppseg button{background:transparent;border:0;color:#a8987c;font:inherit;font-size:12px;padding:4px 12px;border-radius:999px;cursor:pointer}
.vly-exp .ppseg button.on{background:#e0b85a;color:#1b1407;font-weight:600}
.vly-exp .ck.mini{padding:4px 9px;align-items:center}
.vly-exp .ck.mini .bx{margin-top:0}
.vly-exp .ck.mini b{font-size:11.5px;font-weight:500}
.vly-exp .ptags{flex:1 1 160px;min-width:140px}
.vly-exp .ptext{width:100%;box-sizing:border-box;resize:vertical;min-height:110px;background:#0e0b07;color:#efe7d6;border:1px solid #3a2f1e;
  border-radius:7px;padding:10px 12px;font:12.5px/1.55 ui-sans-serif,system-ui,sans-serif}
.vly-exp .ptext:focus{outline:none;border-color:#a8883f}
.vly-exp .ft .w{color:#e8e2d6}
.vly-exp .ft .w b{color:#f0c27a;font-weight:600}
.vly-pop .bd{display:grid;grid-template-columns:1fr 1fr;gap:16px;padding:16px 18px;min-height:0;overflow:hidden}
.vly-pop .col{display:flex;flex-direction:column;gap:8px;min-height:0;min-width:0}
.vly-pop .lab{font-size:10px;font-weight:700;letter-spacing:1.2px;color:#a8987c}
.vly-pop .cur{font-size:12px;color:#f0c27a}
.vly-pop input{background:#120e09;border:1px solid #4a3b25;color:#efe6d6;border-radius:7px;padding:6px 9px;font:inherit;
  font-size:12px;outline:none}
.vly-pop input:focus{border-color:#e0b85a}
.vly-pop .list{overflow-y:auto;max-height:46vh;border:1px solid #3a2f1e;border-radius:8px;background:#140f0a}
.vly-pop .it{padding:7px 10px;cursor:pointer;border-bottom:1px solid #2a2216;display:flex;flex-direction:column;gap:1px}
.vly-pop .it:hover{background:#2a2216}
.vly-pop .it.on{background:#3a2d17}
.vly-pop .it .fam{font-size:10px;color:#a8987c;letter-spacing:.3px}
.vly-pop .it .smp{font-size:19px;color:#f3ead9;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vly-pop .ft{display:flex;align-items:center;gap:10px;padding:12px 18px 14px;border-top:1px solid #3a2f1e}
.vly-pop .ft .w{font-size:11.5px;color:#a8987c;flex:1}
.vly-pop .pbtn{font:inherit;font-size:12px;height:28px;padding:0 14px;border-radius:999px;cursor:pointer;
  border:1px solid #6a5636;background:transparent;color:#e8d8b8;white-space:nowrap}
.vly-pop .pbtn:hover{border-color:#e0b85a;color:#fff}
.vly-pop .ok{background:#e0b85a;border-color:#e0b85a;color:#241703;font-weight:600}
.vly-pop .ok:hover{background:#f0c86a;color:#241703}
/* tooltips drawn as cards, as in the Series Book: what it is, then each
   action under a gold label; a picture shows large */
.vly-tip{position:fixed;z-index:10002;max-width:420px;min-width:200px;padding:10px 12px;box-sizing:border-box;
  background:#121418;border:1px solid #e4c27a;border-radius:10px;box-shadow:0 8px 24px #000c;
  font-family:system-ui,sans-serif;color:#d8dbe0;display:flex;flex-direction:column;gap:7px;pointer-events:none}
.vly-tip.pic{max-width:none;min-width:0}
.vly-tip .ch{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.vly-tip .ch b{font-size:12px;color:#e4c27a}
.vly-tip .ch span{font-size:10px;color:#7d828b}
.vly-tip .big{display:block;border-radius:6px;object-fit:contain;background:#0b0c0e}
.vly-tip .en{font-size:11px;line-height:1.5;color:#b9bdc5;white-space:pre-wrap;max-height:220px;overflow:hidden}
.vly-tip .hint{font-size:10.5px;line-height:1.5;color:#8b909a;display:flex;flex-direction:column;gap:3px}
.vly-tip .en+.hint,.vly-tip .big+.hint{border-top:1px solid #23262c;padding-top:7px}
.vly-tip .en.nt{font-size:11.5px;line-height:1.6;color:#d8dbe0;max-height:180px}
.vly-tip .en.nt+.en{border-top:1px solid #23262c;padding-top:7px}
.vly-tip .hint .hr{display:grid;grid-template-columns:auto 1fr;gap:12px;align-items:baseline}
.vly-tip .hint .hr b{font-size:11px;font-weight:700;color:#e4c27a;white-space:nowrap}
.vly-tip .hint .hr span{color:#a9aeb7}
`;
function injectCss() {
  if (document.getElementById("vly-css")) return;
  const st = document.createElement("style");
  st.id = "vly-css";
  st.textContent = CSS;
  document.head.appendChild(st);
  installTips();
}

/* ---- tooltips ----
   Every title of the node is read on hover and shown as a card, as the
   Series Book shows its own: the first line is what the thing is, and each
   action - click, alt+click, drag... - gets a row under a gold label. A
   picture (data-big) shows large, so a pick can be seen before it is chosen. */
const TIP_ACT = "Ctrl\\+Shift\\+click|Shift\\+click|Ctrl\\+click|Alt\\+click|Shift\\+drag|Alt\\+wheel|Double-click|Double click|Right click|Click|Drag|Drop|Enter|Esc";
const TIP_SPLIT = new RegExp(`(?:\\n|\\s-\\s|(?<=\\.)\\s+|;\\s*|,\\s+|\\s\\u00b7\\s)(?=(?:${TIP_ACT})\\b)`, "i");
const TIP_HEAD = new RegExp(`^(${TIP_ACT})\\b[:\\s-]*`, "i");
function tipParse(text) {
  const segs = String(text || "").split(TIP_SPLIT).map(x => x.trim()).filter(Boolean);
  const rows = [], desc = [];
  for (const seg of segs) {
    const m = TIP_HEAD.exec(seg);
    if (m) {
      let rest = seg.slice(m[0].length).replace(/^(?:to|for)\s+/i, "").replace(/[\s.]+$/, "");
      rest = rest ? rest[0].toUpperCase() + rest.slice(1) : "";
      const k = m[1].replace(/\b\w/g, c => c.toUpperCase()).replace(/Click\b/g, (x, i) => i ? "click" : x)
        .replace(/Drag\b/g, (x, i) => i ? "drag" : x).replace(/Wheel\b/g, "wheel");
      rows.push([k, rest]);
    } else desc.push(seg);
  }
  const lines = desc.join("\n").split("\n").map(x => x.trim()).filter(Boolean);
  let head = "";
  if (lines.length && (lines.length > 1 || rows.length) && lines[0].length <= 70) head = lines.shift();
  const cap = (x) => x ? x[0].toUpperCase() + x.slice(1) : x;
  return { head: cap(head), body: cap(lines.join("\n")), rows };
}
let TIP = { el: null, card: null, t: 0 };
function tipHide() {
  clearTimeout(TIP.t);
  TIP.el = null;
  if (TIP.card) { TIP.card.remove(); TIP.card = null; }
}
function tipShow(el) {
  const t = tipParse(el.dataset.tip);
  const big = el.dataset.big || "";
  const head = el.dataset.tiphead || t.head;
  const body = el.dataset.tiphead && t.head ? (t.head + (t.body ? "\n" + t.body : "")) : t.body;
  if (!head && !body && !t.rows.length && !big) return;
  const card = document.createElement("div");
  card.className = "vly-tip" + (big ? " pic" : "");
  let bw = 0, bh = 0;
  if (big) {
    // as large as the screen allows beside the picture, its shape kept
    const r = el.naturalWidth && el.naturalHeight ? el.naturalWidth / el.naturalHeight
      : (el.clientWidth / Math.max(1, el.clientHeight)) || 1;
    const maxW = Math.min(480, window.innerWidth * 0.42), maxH = Math.min(480, window.innerHeight * 0.6);
    bw = Math.round(Math.min(maxW, maxH * r));
    bh = Math.round(bw / r);
  }
  card.innerHTML = (head ? `<div class="ch"><b>${esc(head)}</b>${el.dataset.tipmeta ? `<span>${esc(el.dataset.tipmeta)}</span>` : ""}</div>` : "")
    + (big ? `<img class="big" alt="" style="width:${bw}px;height:${bh}px" src="${big}">` : "")
    + (el.dataset.tipnote ? `<div class="en nt">${esc(el.dataset.tipnote)}</div>` : "")
    + (body ? `<div class="en">${esc(body)}</div>` : "")
    + (t.rows.length ? `<div class="hint">` + t.rows.map(([k, v]) =>
        `<div class="hr"><b>${esc(k)}</b><span>${esc(v)}</span></div>`).join("") + `</div>` : "");
  if (big) card.style.width = `${bw + 24}px`;
  document.body.appendChild(card);
  TIP.card = card;
  const r = el.getBoundingClientRect(), b = card.getBoundingClientRect();
  const W = window.innerWidth, H = window.innerHeight;
  let left, top;
  if (big) {
    // beside the picture, so the row of picks stays in view
    left = r.right + 10;
    if (left + b.width > W - 8) left = r.left - b.width - 10;
    if (left < 8) left = Math.max(8, Math.min(r.left, W - b.width - 8));
    top = Math.max(8, Math.min(r.top + r.height / 2 - b.height / 2, H - b.height - 8));
    if (left === Math.max(8, Math.min(r.left, W - b.width - 8))) {
      top = r.bottom + 8;
      if (top + b.height > H - 8) top = Math.max(8, r.top - b.height - 8);
    }
  } else {
    left = Math.max(8, Math.min(r.left, W - b.width - 8));
    top = r.bottom + 6;
    if (top + b.height > H - 8) top = Math.max(8, r.top - b.height - 6);
  }
  card.style.left = `${left}px`;
  card.style.top = `${top}px`;
}
function installTips() {
  if (window.__vlyTips) return;
  window.__vlyTips = true;
  document.addEventListener("pointerover", (e) => {
    const t = e.target instanceof Element ? e.target : null;
    let el = t ? t.closest("[title], [data-tip], [data-big]") : null;
    if (el && !el.closest(".vly, .vly-pop, .vly-full")) el = null;
    if (el && el.hasAttribute("title")) {
      const v = el.getAttribute("title");
      el.removeAttribute("title");
      if (v) el.dataset.tip = v;
    }
    if (el === TIP.el) return;
    tipHide();
    if (!el || (!el.dataset.tip && !el.dataset.big)) return;
    TIP.el = el;
    TIP.t = setTimeout(() => { if (TIP.el === el && el.isConnected) tipShow(el); }, el.dataset.big ? 300 : 450);
  });
  const off = () => tipHide();
  document.addEventListener("pointerdown", off, true);
  document.addEventListener("wheel", off, { passive: true, capture: true });
  document.addEventListener("dragstart", off, true);
  document.addEventListener("keydown", off, true);
  window.addEventListener("blur", off);
}

// ------------------------------------------------------------ the node
/* Every Layout node on the canvas: the film's music set in one reaches the
   others laid out on the same series, so a node kept as a music player and
   the node the film is made in agree. */
const VLY_ALL = new Set();

function buildLayout(node) {
  injectCss();
  loadFonts();
  const P = node.properties || (node.properties = {});
  function defaults() {
    if (typeof P.vly_series !== "string") P.vly_series = "";
    if (typeof P.vly_live !== "boolean") P.vly_live = true;
    if (!P.vly_state || typeof P.vly_state !== "object") P.vly_state = {};
    if (P.vly_cat !== "web" && P.vly_cat !== "motion") P.vly_cat = "print";
    if (!P.vly_fmt || typeof P.vly_fmt !== "object") P.vly_fmt = {};
    P.vly_fmt.print = P.vly_fmt.print || "magazine";
    P.vly_fmt.web = P.vly_fmt.web || "ig45";
    P.vly_fmt.motion = P.vly_fmt.motion || "story";
    if (!P.vly_font || typeof P.vly_font !== "object") P.vly_font = { ...DEFAULT_FONTS };
    if (!THEMES.some(t => t.id === P.vly_theme)) P.vly_theme = "ivory";
    if (!TEXT_POS.some(t => t.id === P.vly_textpos)) P.vly_textpos = "middle";
    if (!P.vly_size || typeof P.vly_size !== "object") P.vly_size = { title: 1, text: 1 };
  }
  defaults();

  const root = document.createElement("div");
  root.className = "vly";
  root.innerHTML = `
    <div class="vly-top">
      <span class="vly-mark">LAYOUT</span>
      <select class="vly-sel ser" title="The series to lay out - every series the Series Book has saved"></select>
      <button class="vly-live" title="LIVE - follow the Series Book: the series opened there is laid out here. Off - stay on the series chosen here"><i></i>LIVE</button>
      <span class="vly-div"></span>
      <span class="vly-seg cat">
        <button data-c="print" title="Spreads of two pages, for print">PRINT</button>
        <button data-c="web" title="Single frames, one after another as in a feed">WEB</button>
        <button data-c="motion" title="A short film of the series - the pictures moving slowly, their captions, set to music">MOTION</button>
      </span>
      <select class="vly-sel fmt" title="The size of the page or frame"></select>
      <button class="vly-ibtn fonts" title="Style - colour, typefaces and where the words sit">${ICON.type}<span class="sw"></span><span class="fn"></span></button>
      <span class="vly-sp"></span>
      <button class="vly-ibtn mp" title="Music player - the node becomes a player of the music kept here; everything else hides until you come back">${ICON.note}</button>
      <button class="vly-ibtn fs" title="Full screen (F or ↓) - ← → step through, Esc or ↑ to come back">${ICON.full}</button>
      <button class="vly-ibtn ud" title="Undo (Ctrl+Z) - back to the layout as it was before the last change" disabled>${ICON.undo}</button>
      <button class="vly-ibtn rd" title="Redo (Ctrl+Y or Ctrl+Shift+Z)" disabled>${ICON.redo}</button>
      <button class="vly-ibtn rf" title="Read the book and the picks again">${ICON.refresh}</button>
      <button class="vly-ibtn sv" title="Save the layout as it stands as a .layout file - into output / series / layout / saved, a new file every time">${ICON.save}</button>
      <button class="vly-ibtn op" title="Open a .layout file - saved, or from a package - or drop it on this node">${ICON.open}</button>
      <input class="opf" type="file" accept=".layout,application/json" style="display:none" />
      <button class="vly-pack links" title="Links - the pictures the layout uses, how sharp each prints, and the upscaled ones linked in their place">Links <b class="lc"></b></button>
      <button class="vly-pack pk" title="Package for print: the pictures the layout uses, its typefaces, a proof and a report, in one folder - upscale the pictures, then link them again">Package</button>
      <button class="vly-pack ibx" title="Send to the Visual Idea Box - pages as JPEG, PNG or a PDF; in Motion the film, exported first">Idea Box</button>
      <button class="vly-export" title="Export as JPEG, PNG, PDF or an InDesign package">Export</button>
    </div>
    <div class="vly-body">
      <div class="vly-side"><div class="vly-side-in">
        <div class="vly-h">CUTS <b class="nc"></b><button class="fall"></button></div>
        <div class="vly-cuts"></div>
      </div></div>
      <div class="vly-main">
        <div class="vly-desk">
          <button class="vly-nav l" title="Previous (←)">${ICON.left}</button>
          <canvas class="vly-canvas"></canvas>
          <button class="vly-nav r" title="Next (→)">${ICON.right}</button>
          <div class="vly-count"></div>
        </div>
        <div class="vly-tools"></div>
        <div class="vly-coverpick" style="display:none">
          <div class="vly-h" style="margin:0">COVER <span class="hint">the picture of the opener - any pick of the series</span></div>
          <div class="cps"></div>
        </div>
        <div class="vly-extra" style="display:none">
          <div class="vly-h" style="margin:0">TEXT AT THE FOOT OF THE PAGE <span class="hint">this cut only</span></div>
          <textarea placeholder="A paragraph of your own, set at the bottom of this cut's text page"></textarea>
        </div>
        <div class="vly-strip">
          <div class="vly-h sh"></div>
          <div class="vly-strip-row"></div>
        </div>
        <div class="vly-music" style="display:none"></div>
        <div class="vly-note"></div>
      </div>
    </div>
    <div class="vly-full">
      <div class="vly-ftop"><span class="s"></span><span class="nm"></span>
        <button class="x" title="Back to the node (Esc)">${ICON.close}</button></div>
      <button class="vly-nav l" title="Previous (←)">${ICON.left}</button>
      <canvas></canvas>
      <button class="vly-nav r" title="Next (→)">${ICON.right}</button>
      <div class="vly-fkeys"><kbd>←</kbd><kbd>→</kbd> step &nbsp;·&nbsp; <kbd>Esc</kbd> back to the node</div>
    </div>`;
  const $ = (s) => root.querySelector(s);
  const serSel = $(".ser"), fmtSel = $(".fmt"), catSeg = $(".cat"), fontsBtn = $(".fonts"), liveBtn = $(".vly-live");
  const cutsBox = $(".vly-cuts"), nCuts = $(".nc");
  const desk = $(".vly-desk"), canvas = $(".vly-canvas"), count = $(".vly-count");
  let STG = null, pdrag = null;      // the stage as drawn, and a picture being moved in its frame
  const navL = desk.querySelector(".vly-nav.l"), navR = desk.querySelector(".vly-nav.r");
  const coverBox = $(".vly-coverpick");
  const tools = $(".vly-tools"), extraBox = $(".vly-extra"), extraTa = extraBox.querySelector("textarea");
  const stripH = $(".vly-strip .sh"), strip = $(".vly-strip-row"), note = $(".vly-note");
  const exportBtn = $(".vly-export"), packBtn = $(".vly-pack.pk"), linksBtn = $(".vly-pack.links");
  const ideaBtn = $(".vly-pack.ibx");
  const full = $(".vly-full"), fullCanvas = full.querySelector("canvas");
  /* The full-screen view lives on the page itself: inside the node it would
     be scaled and moved with the canvas. */
  document.body.appendChild(full);
  full.addEventListener("pointerdown", (e) => e.stopPropagation());

  const S = { list: [], book: null, sig: "", sheets: [], cur: 0, exporting: false, dead: false, hovered: false };

  function state() {
    const name = P.vly_series || "";
    let st = P.vly_state[name];
    if (!st || typeof st !== "object") st = P.vly_state[name] = {};
    st.pick = st.pick || {};
    st.tpl = st.tpl || {};
    st.flip = st.flip || {};
    st.tplWeb = st.tplWeb || {};
    st.flipWeb = st.flipWeb || {};
    st.extra = st.extra || {};
    st.hd = st.hd || {};
    st.sel = st.sel || {};
    st.pos = st.pos || {};
    st.off = st.off || {};
    st.align = st.align || {};
    st.show = st.show || {};
    st.split = st.split || {};
    st.splitW = st.splitW || {};
    // a single pick per cut, as the first layouts kept it
    for (const [no, id] of Object.entries(st.pick)) if (!st.sel[no] && id != null) st.sel[no] = [id];
    if (st.cover === undefined) st.cover = null;
    return st;
  }
  function geo() {
    const G = geometry(P.vly_cat === "motion" ? "web" : P.vly_cat, P.vly_fmt[P.vly_cat], P.vly_font, P.vly_theme, P.vly_textpos, P.vly_size);
    G.motion = P.vly_cat === "motion";
    return G;
  }
  /* What the sheets are built from: a layout chosen by hand is kept apart
     for print and for the web, which read differently. */
  function view() {
    const st = state();
    const web = P.vly_cat !== "print";
    return { ...st, tpl: web ? st.tplWeb : st.tpl, flip: web ? st.flipWeb : st.flip };
  }

  // ---- logo
  const logoCache = new Map();
  function logoImg(name) {
    if (!logoCache.has(name)) {
      logoCache.set(name, new Promise((resolve) => {
        const im = new Image();
        im.onload = () => resolve(trimLogo(im));
        im.onerror = () => resolve(null);
        im.src = `${api.apiURL(LOGO_URL)}?name=${encodeURIComponent(name)}`;
      }));
    }
    return logoCache.get(name);
  }
  /* LOGO is set from this node's choice before anything is drawn; a logo
     still loading paints again once it is there. */
  let logoWant = "";
  function syncLogo() {
    const lg = P.vly_logo;
    if (!lg || !lg.name) { LOGO = null; logoWant = ""; return; }
    const key = lg.name;
    if (LOGO && LOGO.name === key) { LOGO.size = lg.size || "m"; return; }
    if (logoWant === key) return;
    logoWant = key;
    logoImg(key).then((im) => {
      if (logoWant !== key) return;
      LOGO = im ? { img: im, name: key, size: (P.vly_logo || {}).size || "m" } : null;
      logoWant = "";
      paint();
    });
  }
  async function logoReady() {
    const lg = P.vly_logo;
    if (!lg || !lg.name) { LOGO = null; return; }
    const im = await logoImg(lg.name);
    LOGO = im ? { img: im, name: lg.name, size: lg.size || "m" } : null;
  }

  function say(text, err) {
    note.textContent = text || "";
    note.classList.toggle("err", !!err);
  }

  // ---- size: the node is as tall as what it shows
  let fitH = 0;
  const DESK_PAD = 56;            // the desk's padding, above and below the page
  const DESK_MIN = 240;
  let natural = false;
  const widget = node.addDOMWidget("series_layout", "LEIEL_SERIES_LAYOUT", root, {
    serialize: false,
    hideOnZoom: false,
    // the node may be dragged shorter than it is - as short as a desk of the
    // smallest height - so the desk can be made smaller again
    getMinHeight: () => (natural ? fitH || 360 : shortest()),
    getMaxHeight: () => fitH || undefined,
  });
  /* The page grows with the node: drag the node taller and the desk the
     page sits on grows by as much, wider and the page grows with its width;
     the node then fits what it shows. */
  function shortest() {
    const h = fitH || 360;
    const desk0 = desk.clientHeight ? desk.clientHeight - DESK_PAD : DESK_MIN;
    return Math.max(200, h - Math.max(0, desk0 - DESK_MIN));
  }
  /* The node's height for what it shows now. */
  function naturalH() {
    natural = true;
    try { return node.computeSize()[1]; } finally { natural = false; }
  }
  function stageMaxH(maxW) {
    const h = Number(P.vly_deskH);
    if (h > 0) return h;
    return Math.max(240, Math.min(Math.max(620, maxW * 0.75), window.innerHeight * 0.85));
  }
  function deskHeight() {
    const h = Number(P.vly_deskH);
    // the page's height, plus the desk's padding and border round it
    desk.style.height = h > 0 ? `${h + DESK_PAD + 2}px` : "";
  }
  let snapT = 0;
  const onRes = node.onResize;
  node.onResize = function () {
    const r = onRes ? onRes.apply(this, arguments) : undefined;
    clearTimeout(snapT);
    snapT = setTimeout(() => {
      try {
        const want = naturalH();
        const delta = node.size[1] - want;
        if (Math.abs(delta) > 4 && S.book) {
          const now = desk.clientHeight - DESK_PAD;
          P.vly_deskH = Math.round(Math.max(DESK_MIN, Math.min(2400, now + delta)));
          deskHeight();
          if (P.vly_cat === "motion") paintMotionStage(); else paintStage();
          fitNode();
        } else if (Math.abs(delta) > 2) {
          node.setSize([node.size[0], want]);
          node.setDirtyCanvas(true, true);
        }
      } catch (e) { /* a node being taken off the canvas */ }
    }, 10);
    return r;
  };
  let fitFrame = 0;
  function fitNode() {
    cancelAnimationFrame(fitFrame);
    fitFrame = requestAnimationFrame(() => {
      if (!root.isConnected) return;
      const h = Math.ceil(root.offsetHeight);
      if (!h || Math.abs(h - fitH) < 2) return;
      fitH = h;
      try {
        node.setSize([node.size[0], naturalH()]);
        node.setDirtyCanvas(true, true);
      } catch (e) { /* a node being taken off the canvas */ }
    });
  }

  /* Which lines of the notes reach the pages, frames and films: every line,
     the lines in Latin script only - a note written in two languages keeps
     its English and leaves the rest - or none. Captions and titles always. */
  const NOTE_LINES = [
    { id: "all", label: "All lines", hint: "Every line of the series note and of each cut's note" },
    { id: "latin", label: "Latin script only", hint: "Lines in another script are left out; the English stays" },
    { id: "none", label: "None", hint: "No note on the pages - the titles and captions only" },
  ];
  const OTHER_SCRIPT = /[^\u0000-\u024F\u1E00-\u1EFF\u2000-\u206F\u20A0-\u20CF\u2100-\u214F\s]/;
  function keepLines(text) {
    const mode = P.vly_lines || "all";
    if (mode === "none") return "";
    if (mode === "all") return text;
    return String(text || "").split("\n").filter(ln => !OTHER_SCRIPT.test(ln))
      .join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }
  function bookWords(raw) {
    if (!raw) return raw;
    return { ...raw, note: keepLines(raw.note),
      scenes: (raw.scenes || []).map(sc => ({ ...sc, body: keepLines(sc.body) })) };
  }
  function rewords() { if (S.raw) { S.book = bookWords(S.raw); paint(); } }

  // ---- data
  async function loadList() {
    try {
      const r = await api.fetchApi(SERIES_URL);
      const j = await r.json();
      S.list = j.ok ? j.list : [];
    } catch (e) {
      S.list = [];
    }
    if (!P.vly_series && S.list.length) P.vly_series = S.list[0].name;
    const names = S.list.map(s => s.name);
    if (P.vly_series && !names.includes(P.vly_series)) names.unshift(P.vly_series);
    serSel.innerHTML = names.length
      ? names.map(n => `<option value="${esc(n)}"${n === P.vly_series ? " selected" : ""}>${esc(n)}</option>`).join("")
      : `<option value="">No series in the Series Book yet</option>`;
  }

  async function loadBook(quiet) {
    if (!P.vly_series) { S.book = null; paint(); return; }
    const asked = P.vly_series;
    let j;
    try {
      const r = await api.fetchApi(BOOK_URL, { method: "POST", body: JSON.stringify({ series: asked }) });
      j = await r.json();
    } catch (e) {
      j = { ok: false, error: String(e && e.message || e) };
    }
    // another series was chosen while this one was read
    if (asked !== P.vly_series) return;
    if (!j.ok) {
      S.book = null;
      S.sig = "";
      if (!quiet) say(j.error || "the series could not be read", true);
      paint();
      return;
    }
    const sig = JSON.stringify(j);
    if (sig === S.sig) return;
    S.sig = sig;
    S.raw = j;
    S.book = bookWords(j);
    followTone();
    paint();
    // another series: its history starts here
    if (HIST.series !== asked) {
      HIST.series = asked;
      HIST.undo.length = 0;
      HIST.redo.length = 0;
      HIST.cur = snapOf();
      HIST.t = 0;
      paintHist();
    }
  }

  // ---- painting
  function paintTop() {
    catSeg.querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.c === P.vly_cat));
    fmtSel.innerHTML = FORMATS[P.vly_cat].map(f =>
      `<option value="${f.id}"${f.id === P.vly_fmt[P.vly_cat] ? " selected" : ""}>${esc(f.label)} · ${esc(f.size.replace(/ × /g, "×"))}</option>`).join("");
    const th = THEMES.find(t => t.id === P.vly_theme) || THEMES[0];
    fontsBtn.querySelector(".sw").style.background = th.paper;
    fontsBtn.querySelector(".sw").style.borderColor = th.accent;
    fontsBtn.querySelector(".fn").textContent = `${th.label} \u00b7 ${P.vly_font.title} / ${P.vly_font.body}`;
  }

  /* Undo and redo: every change to the layout - its pages, picks, shots,
     style - is a step. A step is the whole of what the node keeps, so going
     back is exact; changes made within a moment of each other, as while
     typing, are one step. Choosing another series, or another size, is not
     a step. */
  const UNDO_KEYS = ["vly_state", "vly_theme", "vly_font", "vly_size", "vly_textpos", "vly_lines", "vly_logo", "vly_tags"];
  const HIST = { undo: [], redo: [], cur: null, t: 0, busy: false };
  function snapOf() {
    const o = {};
    for (const k of UNDO_KEYS) o[k] = P[k];
    return JSON.stringify(o);
  }
  function record() {
    if (HIST.busy || S.dead) return;
    const now = snapOf();
    if (HIST.cur === null) { HIST.cur = now; paintHist(); return; }
    if (now === HIST.cur) return;
    const t = performance.now();
    if (!(t - HIST.t < 450 && HIST.undo.length)) {
      HIST.undo.push(HIST.cur);
      if (HIST.undo.length > 120) HIST.undo.shift();
    }
    HIST.redo.length = 0;
    HIST.cur = now;
    HIST.t = t;
    paintHist();
  }
  function applySnap(text) {
    HIST.busy = true;
    try {
      const o = JSON.parse(text);
      for (const k of UNDO_KEYS) {
        if (o[k] === undefined) delete P[k];
        else P[k] = JSON.parse(JSON.stringify(o[k]));
      }
      HIST.cur = text;
      HIST.t = 0;
      LOGO = null;
      if (isMotion()) mpause();
      closePop();
      paint();
    } finally { HIST.busy = false; }
    paintHist();
  }
  function undo() {
    record();
    if (!HIST.undo.length) { say("Nothing to undo"); return; }
    HIST.redo.push(HIST.cur);
    applySnap(HIST.undo.pop());
    say(`Undone - ${HIST.undo.length} more step${HIST.undo.length === 1 ? "" : "s"} back`);
  }
  function redo() {
    record();
    if (!HIST.redo.length) { say("Nothing to redo"); return; }
    HIST.undo.push(HIST.cur);
    applySnap(HIST.redo.pop());
    say("Redone");
  }
  function paintHist() {
    const u = root.querySelector(".ud"), r = root.querySelector(".rd");
    if (u) u.disabled = !HIST.undo.length;
    if (r) r.disabled = !HIST.redo.length;
  }

  function paint() {
    if (S.dead) return;
    record();
    syncLogo();
    deskHeight();
    paintTop();
    root.classList.toggle("player", isPlayer());
    if (isPlayer()) {
      musicBox.style.display = "";
      paintMusic();
      fitNode();
      return;
    }
    const book = S.book;
    if (!book) {
      cutsBox.innerHTML = `<div class="vly-cx" style="border-radius:8px">Choose a series saved in the Series Book.</div>`;
      tools.innerHTML = "";
      strip.innerHTML = "";
      stripH.innerHTML = "";
      count.textContent = "";
      canvas.style.display = "none";
      extraBox.style.display = "none";
      coverBox.style.display = "none";
      exportBtn.disabled = true;
      packBtn.disabled = true;
      fitNode();
      return;
    }
    canvas.style.display = "";
    const G = geo();
    const v = view();
    const fsBtn = root.querySelector(".fs"), muBox = root.querySelector(".vly-music");
    if (P.vly_cat === "motion") {
      S.sheets = [];
      const picked = book.scenes.filter(s => s.picks.length).length;
      exportBtn.disabled = S.exporting || picked === 0;
      packBtn.style.display = linksBtn.style.display = fsBtn.style.display = "none";
      paintMotion(book, G, v);
      if (!picked) say("No cut of this series is picked yet - press P on a render in the Visual Image Viewer.");
      else if (/^No cut/.test(note.textContent)) say("");
      fitNode();
      return;
    }
    fsBtn.style.display = "";
    muBox.style.display = "none";
    strip.classList.remove("tl");
    canvas.classList.remove("frameable");
    S.sheets = buildSheets(book, v, G);
    S.cur = Math.max(0, Math.min(S.cur, S.sheets.length - 1));
    const picked = book.scenes.filter(s => s.picks.length).length;
    exportBtn.disabled = S.exporting || picked === 0;
    packBtn.style.display = linksBtn.style.display = G.cat === "web" ? "none" : "";
    packBtn.disabled = linksBtn.disabled = S.exporting || picked === 0;
    if (G.cat !== "web") {
      const ls = linksOf(S.sheets, G);
      const ok = ls.filter(l => l.dpi >= 300).length;
      linksBtn.querySelector(".lc").textContent = `${ok}/${ls.length}`;
      linksBtn.classList.toggle("ready", ls.length > 0 && ok === ls.length);
    }
    paintCuts(book, v);
    paintTools(G, v);
    paintStage();
    paintStrip(G);
    if (isFull()) paintFull();
    if (!picked) say("No cut of this series is picked yet - press P on a render in the Visual Image Viewer.");
    else if (/^No cut/.test(note.textContent)) say("");
    fitNode();
  }

  function paintCuts(book, v) {
    const cur = S.sheets[S.cur];
    const curKeys = new Set((cur && (cur.cut ? [cur.cut] : cur.cuts) || []).map(c => c.no));
    const picked = book.scenes.filter(s => s.picks.length).length;
    nCuts.textContent = `${picked} / ${book.scenes.length} picked`;
    const fold = P.vly_fold && typeof P.vly_fold === "object" ? P.vly_fold : (P.vly_fold = {});
    const allFold = book.scenes.length && book.scenes.every(s => fold[s.no]);
    const fall = root.querySelector(".vly-h .fall");
    fall.textContent = allFold ? "Unfold all" : "Fold all";
    fall.title = allFold ? "Open every cut to show its picks" : "Fold every cut to its title";
    // the scene's own note from the Series Book, as written - shown on the
    // cards of its picks, not laid out
    const rawOf = new Map(((S.raw && S.raw.scenes) || []).map(x => [x.no, x]));
    cutsBox.innerHTML = book.scenes.map((s) => {
      const raw = rawOf.get(s.no);
      const note = String((raw && raw.body) || s.body || "").trim();
      const chosen = new Set(chosenPicks(s, v).map(p => String(p.id)));
      const off = v.off && v.off["c:" + s.no];
      const thumbs = s.picks.map(p => {
        const on = chosen.has(String(p.id));
        const isCover = String(p.id) === String(v.cover);
        // the same area for every shape, so a portrait is not smaller than a landscape
        // one height for every pick, as on a contact sheet; the width shows its shape
        const r = ratio(p), h = 44, w = Math.round(Math.min(84, Math.max(26, h * r)));
        return `<span class="vly-pkw"><img class="vly-pk${on ? " on" : ""}" data-no="${esc(s.no)}" data-id="${p.id}"
          style="width:${w}px;height:${h}px" src="${api.apiURL(PICTURE_URL)}?id=${p.id}&s=400" loading="lazy" draggable="false"
          data-big="${api.apiURL(PICTURE_URL)}?id=${p.id}&s=1000" data-tiphead="${esc((s.label || s.no) + " " + s.title)}" data-tipmeta="${isCover ? "cover" : on ? "in the layout" : "not chosen"}" data-tipnote="${esc(note)}"
          title="Every chosen pick is laid out, the first one leads. Click to add it to the layout or take it out. Alt+click to make it the cover">${isCover ? `<span class="cv">COVER</span>` : ""}${v.hd && v.hd[String(p.id)] ? `<span class="hd" title="An upscaled picture is linked">HD</span>` : ""}</span>`;
      }).join("");
      const n = chosen.size;
      const fd = !!fold[s.no];
      return `<div class="vly-cut${curKeys.has(s.no) ? " cur" : ""}${off ? " off" : ""}${fd ? " fold" : ""}" data-no="${esc(s.no)}">
        <div class="vly-ch"><span class="n">${esc(s.label || s.no)}</span><span class="t">${esc(s.title)}</span>
          ${off ? `<span class="c">removed</span>` : s.picks.length > 1 ? `<span class="c">${n} / ${s.picks.length}</span>` : "<span></span>"}
          <button class="fd" data-fold="${esc(s.no)}" title="${fd ? "Open the cut to show its picks" : "Fold the cut to its title"}"><svg viewBox="0 0 10 10"><path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div>
        ${s.picks.length ? `<div class="vly-cp">${thumbs}</div>`
          : `<div class="vly-cx">No pick yet - P in the Viewer</div>`}
      </div>`;
    }).join("");
  }

  function paintTools(G, v) {
    const sh = S.sheets[S.cur];
    if (!sh) { tools.innerHTML = ""; extraBox.style.display = "none"; coverBox.style.display = "none"; return; }
    const own = sh.key ? v.tpl[sh.key] || "" : null;
    const btn = (code, label, title) =>
      `<button class="${own === code ? "on" : ""}" data-t="${code}" title="${esc(title)}">${label}</button>`;
    let html = `<span class="nm"><b>${String(S.cur + 1).padStart(2, "0")}</b>${esc(sheetName(sh))}</span>`;
    if (sh.key) {
      const web = G.cat === "web";
      html += `<span class="vly-tseg">`
        + btn("", "Auto", web ? "A picture close to the frame's shape fills it, any other sits inside it"
          : "Landscape cuts across the spread, portrait cuts facing their words")
        + btn("B", web ? "Full" : "Full spread", web ? "The picture fills the frame" : "Across both pages, the caption small in a corner")
        + btn("C", "Photo | text", web ? "A frame of the picture, then a frame of its words" : "On one page, its words on the other")
        + btn("D", "Pair", "With the next cut, both to the edge")
        + btn("E", "Framed", web ? "With the next cut, both inside the margins, words below"
          : "With the next cut, both inside the margins, words below")
        + btn("O", "Text on photo", web ? "The pictures fill the frame, the words set on them"
          : "The pictures across the spread, the words set on them")
        + `</span>`;
      if (sh.t === "C" || (sh.t === "O" && !web)) {
        html += `<button class="vly-flip" title="${web ? "The pictures and their words change places" : sh.t === "O" ? "The words on the other page" : "Put the photo on the other page"}">Flip</button>`;
      }
      if (!web && (sh.t === "B" || sh.t === "C" || sh.t === "O")) {
        html += `<button class="vly-flip vly-inset${sh.inset ? " on" : ""}" title="The pictures inside the margins of the ${sh.t === "C" ? "page" : "spread"}, the paper round them - not to the edge">Inset</button>`;
      }
    }
    if (sh.t === "A") {
      const cat = G.cat === "web" ? "web" : "print";
      const cur = sh.style;
      html += `<span class="vly-tseg cov">` + COVERS[cat].map(c =>
        `<button class="${c.id === cur ? "on" : ""}" data-cov="${c.id}" title="${esc(c.hint)}">${esc(c.label)}</button>`).join("") + `</span>`;
    }
    const multi = (sh.cuts || []).find(c => c.picks && c.picks.length > 1);
    if (multi) {
      const n = multi.picks.length;
      const sp = (v.split || {})[`${G.cat}:${sh.id}`] || "";
      const list = n <= 4 ? ARRANGE[n] : [arrangeOf(n, "row"), arrangeOf(n, "col")];
      // a small drawing of each arrangement, in the shape of the spread or frame
      const iw = 26, ih = Math.max(10, Math.round(26 * (G.sheetH / G.sheetW)));
      const icon = (a) => {
        const cells = treeCells(a, null, 0, 0, iw, ih, 1.5);
        return `<svg viewBox="0 0 ${iw} ${ih}" width="${iw}" height="${ih}">` + cells.map((c, i) =>
          `<rect x="${c.x.toFixed(2)}" y="${c.y.toFixed(2)}" width="${c.w.toFixed(2)}" height="${c.h.toFixed(2)}" rx="0.8"${i === 0 && a.w ? ' class="big"' : ""}/>`).join("") + `</svg>`;
      };
      html += `<span class="vly-vsep"></span><span class="lab2">PICKS</span><span class="vly-tseg split">`
        + `<button class="au${sp ? "" : " on"}" data-split="" title="Auto - the arrangement that cuts the least off the pictures. Drag a line between them to change their sizes">Auto</button>`
        + list.map(a => `<button class="ic${sp === a.id ? " on" : ""}" data-split="${a.id}" title="${esc((a.label || a.id) + " - drag a line between the pictures on the page to change their sizes; double-click it to even them")}">${icon(a)}</button>`).join("")
        + `</span>`;
    }
    if (sh.t !== "F") {
      // print and web each keep their own
      const sw = { show: (v.show || {})[`${G.cat}:${sh.id}`] || "both" };
      const op = sh.t === "A" || sh.t === "A2";
      // a picture to the edge carries only a small label in its corner - the
      // buttons say so, rather than Title and Text that would promise a block
      const corner = sh.t === "B" || sh.t === "D" || (G.cat === "web" && sh.t === "C" && sh.part === 0);
      const tg = (id, on, label, title) => `<button class="${on ? "on" : ""}" data-show="${id}" title="${esc(title)}">${label}</button>`;
      html += `<span class="vly-vsep"></span><span class="lab2">SHOW</span><span class="vly-tseg show">`;
      if (corner) {
        html += tg("title", showsTitle(sw), "Number", "The cut's number, small in the corner of the picture - on or off");
        if (sh.t === "B") html += tg("text", showsText(sw), "Caption", "The caption beside the number, small in the corner - on or off. For the title and note on the picture, choose Text on photo");
      } else {
        html += tg("title", showsTitle(sw), "Title", op ? "The series number and title - on or off" : "The number and title of the cut - on or off")
          + tg("text", showsText(sw), "Text", op ? "The note of the series - on or off" : "The caption and note of the cut - on or off");
      }
      html += `</span>`;
    }
    const wordsHere = hasWords(sh, G);
    if (wordsHere) {
      const own = (v.pos || {})[sh.id] || "";
      const pb = (id, label, title) => `<button class="${own === id ? "on" : ""}" data-pos="${id}" title="${esc(title)}">${label}</button>`;
      html += `<span class="vly-vsep"></span><span class="lab2">WORDS</span><span class="vly-tseg pos">`
        + pb("", "Auto", `As set in Style - ${P.vly_textpos}`)
        + TEXT_POS.map(t => pb(t.id, t.label, `On this page only: words at the ${t.id}`)).join("")
        + `</span>`;
    }
    // the side the words are set to - and under a framed picture, too
    if (wordsHere || sh.t === "E") {
      const al = (v.align || {})[sh.id] || "left";
      if (!wordsHere) html += `<span class="vly-vsep"></span><span class="lab2">WORDS</span>`;
      html += `<span class="vly-tseg al">`
        + `<button class="${al === "left" ? "on" : ""}" data-al="left" title="Words set flush left">Left</button>`
        + `<button class="${al === "center" ? "on" : ""}" data-al="center" title="Words centred, on this page">Center</button>`
        + `<button class="${al === "right" ? "on" : ""}" data-al="right" title="Words set flush right, on this page">Right</button>`
        + `</span>`;
    }
    const dpi = sheetDpi(sh, G);
    if (dpi) {
      html += `<span class="dpi" title="How sharp the smallest picture on this spread prints: its pixels over the width it is given. 300 dpi is print quality.">`
        + (dpi < 200 ? `<b>${dpi} dpi</b>` : `${dpi} dpi`) + ` at print size</span>`;
    }
    tools.innerHTML = html;
    if (sh.t === "A" && sh.style !== "type") {
      paintCoverPick(v);    } else {
      coverBox.style.display = "none";
    }
    if (sh.t === "C" || sh.t === "O") {
      const c = sh.cuts[0];
      extraBox.style.display = "";
      extraBox.dataset.no = c.no;
      if (document.activeElement !== extraTa) extraTa.value = state().extra[c.no] || "";
    } else {
      extraBox.style.display = "none";
    }
  }

  /* The cover picker: Auto, or any pick of the series. */
  function paintCoverPick(v) {
      const covId = v.cover != null ? String(v.cover) : "";
      const auto = !covId || !allPicks(S.book).some(p => String(p.id) === covId);
      coverBox.style.display = "";
      coverBox.dataset.mode = "cover";
      coverBox.querySelector(".vly-h").innerHTML = `COVER <span class="hint">the picture of the opener - any pick of the series</span>`;
      coverBox.querySelector(".cps").innerHTML =
        `<button class="cauto${auto ? " on" : ""}" title="The first portrait pick of the series">Auto</button>`
        + allPicks(S.book).map(p => {
          const r = ratio(p), area = 1500;
          const w = Math.round(Math.sqrt(area * r)), h = Math.round(Math.sqrt(area / r));
          return `<img class="cp${!auto && String(p.id) === covId ? " on" : ""}" data-id="${p.id}" style="width:${w}px;height:${h}px"
            src="${api.apiURL(PICTURE_URL)}?id=${p.id}&s=400" loading="lazy" draggable="false"
            data-big="${api.apiURL(PICTURE_URL)}?id=${p.id}&s=1000" data-tiphead="${esc((p.scene.label || p.scene.no) + " " + p.scene.title)}"
            data-tipmeta="${!auto && String(p.id) === covId ? "the cover" : ""}" title="Click to make it the cover">`;
        }).join("");
  }

  /* The scene of a shot's cut, with every pick of it - not only the chosen. */
  function cutScene(s) {
    return (S.book && s.cut && S.book.scenes.find(x => x.no === s.cut.no)) || { picks: [] };
  }
  /* MOTION's picker under the tools: the cover for the title shot, or the
     other picks of the cut for a picture shot, each in a panel that opens
     and closes. */
  /* The picture panel belongs to the shot it was opened on: choosing another
     shot, or any other work, closes it. */
  function swapOpen(s) {
    return !!(MZ.swapOpen && s && MZ.swapShot === s.id);
  }
  function paintPicker(v) {
    const s = isMotion() ? MZ.shots[MZ.cur] : null;
    if (MZ.swapOpen && !swapOpen(s)) MZ.swapOpen = false;
    if (s && s.kind === "title" && MZ.coverOpen) return paintCoverPick(v);
    if (s && s.kind === "pick" && swapOpen(s) && cutScene(s).picks.length > 1) return paintSwapPick(s);
    coverBox.style.display = "none";
  }
  function paintSwapPick(s) {
    const scene = cutScene(s);
    const inFilm = new Set(MZ.shots.filter(x => x.kind === "pick").map(x => String(x.pick.id)));
    const chosen = new Set(chosenPicks(scene, state()).map(p => String(p.id)));
    coverBox.style.display = "";
    coverBox.dataset.mode = "swap";
    coverBox.dataset.shot = s.id;
    coverBox.querySelector(".vly-h").innerHTML = `PICTURE <span class="hint">${esc((scene.label || scene.no) + " " + (scene.title || ""))} - click a pick to put it in this shot; one already in the film trades places with it</span>`;
    coverBox.querySelector(".cps").innerHTML = scene.picks.map(p => {
      const r = ratio(p), area = 2600;
      const w = Math.round(Math.sqrt(area * r)), h = Math.round(Math.sqrt(area / r));
      const id = String(p.id), on = id === String(s.pick.id);
      const used = !on && chosen.has(id);
      return `<span class="cpw${used ? " used" : ""}"><img class="cp${on ? " on" : ""}" data-id="${p.id}" style="width:${w}px;height:${h}px"
        src="${api.apiURL(PICTURE_URL)}?id=${p.id}&s=400" loading="lazy" draggable="false"
        data-big="${api.apiURL(PICTURE_URL)}?id=${p.id}&s=1000" data-tiphead="${esc((scene.label || scene.no) + " " + (scene.title || ""))}"
        data-tipmeta="${on ? "in this shot" : used ? (inFilm.has(id) ? "in another shot" : "chosen, its shot taken out") : "not in the film"}"
        title="${on ? "The picture of this shot" : used ? "Click to trade places with it" : "Click to put it in this shot"}">${used ? "<i></i>" : ""}</span>`;
    }).join("");
  }
  /* Puts another pick of the same cut in a shot. The shot keeps its place,
     length, move, passage and caption; the framing stays with each picture.
     A pick already chosen trades places with the one it replaces. */
  function swapShotPicture(s, newId) {
    const st = state(), m = mstate(), scene = cutScene(s);
    const oldId = Number(s.pick.id);
    newId = Number(newId);
    if (oldId === newId || !scene.picks.some(p => Number(p.id) === newId)) return false;
    const now = chosenPicks(scene, st).map(p => Number(p.id));
    const i = now.indexOf(oldId), j = now.indexOf(newId);
    if (i < 0) return false;
    if (j >= 0) now[j] = oldId;
    now[i] = newId;
    st.sel[scene.no] = now;
    delete st.pick[scene.no];
    const a = "p:" + oldId, b = "p:" + newId;
    const A = m.set[a] ? { ...m.set[a] } : null, B = m.set[b] ? { ...m.set[b] } : null;
    const fa = A && A.frame, fb = B && B.frame;
    const put = (key, set, frame) => {
      const o = { ...(set || {}) };
      delete o.frame;
      if (frame) o.frame = frame;
      if (Object.keys(o).length) m.set[key] = o; else delete m.set[key];
    };
    // the place's settings go to the picture now in it; each keeps its framing
    put(b, A, fb);
    if (j >= 0) put(a, B, fa); else put(a, null, fa);
    const oa = !!m.off[a], ob = !!m.off[b];
    if (j >= 0) { if (ob) m.off[a] = true; else delete m.off[a]; }
    else delete m.off[a];
    if (oa) m.off[b] = true; else delete m.off[b];
    if (MZ.sel) MZ.sel.clear();
    return true;
  }

  /* Pictures for a set of sheets at one size, as a map of id -> image. */
  async function picsFor(sheets, side, linked) {
    const want = new Map();
    for (const sh of sheets) for (const p of sheetPicks(sh)) if (p) want.set(String(p.id), p);
    const map = new Map();
    await Promise.all([...want.entries()].map(async ([id, p]) => {
      let im = null;
      // an export uses the upscaled picture where one is linked
      if (linked && p.hd) im = await linkedPicture(p.hd.path, side);
      map.set(id, im || await picture(id, side));
    }));
    return map;
  }

  /* Draws a sheet into a canvas fitted inside maxW x maxH css pixels. */
  async function drawInto(cv, sh, maxW, maxH, side, live) {
    const G = geo();
    const v = view();
    const scale = Math.min(maxW / G.sheetW, maxH / G.sheetH);
    const dpr = window.devicePixelRatio || 1;
    const k = scale * dpr;
    const draw = (pics) => {
      if (!live()) return;
      cv.width = Math.round(G.sheetW * k);
      cv.height = Math.round(G.sheetH * k);
      cv.style.width = `${G.sheetW * scale}px`;
      cv.style.height = `${G.sheetH * scale}px`;
      const stage = cv === canvas;
      if (stage) { HITS = []; DIVS = []; }
      try { drawSheet(cv.getContext("2d"), k, sh, G, S.book, v, pics, true); }
      finally {
        if (stage) {
          STG = { sh, G, k, pics, hits: HITS.filter(h => h.ox > 0.5 || h.oy > 0.5), divs: DIVS };
          HITS = null;
          DIVS = null;
          canvas.classList.toggle("frameable", !isMotion() && STG.hits.length > 0);
        }
      }
    };
    draw(new Map());
    await fontsFor(P.vly_font);
    const pics = await picsFor([sh], side);
    draw(pics);
  }

  /* Moving a picture inside its frame, in print and on the web: drag it, and
     the part the frame shows follows; double-click puts it back in the
     middle. Kept for each picture at each size. */
  function hitAt(e) {
    if (!STG || isMotion()) return null;
    const r = canvas.getBoundingClientRect();
    if (!r.width) return null;
    const u = STG.G.sheetW / r.width;
    const px = (e.clientX - r.left) * u, py = (e.clientY - r.top) * u;
    for (let i = STG.hits.length - 1; i >= 0; i--) {
      const h = STG.hits[i];
      if (px >= h.x && px <= h.x + h.w && py >= h.y && py <= h.y + h.h) return { h, u };
    }
    return null;
  }
  function focusMap(make) {
    const st = state();
    const key = focusKey(STG ? STG.G : geo());
    if (!st.focus) { if (!make) return null; st.focus = {}; }
    if (!st.focus[key]) { if (!make) return null; st.focus[key] = {}; }
    return st.focus[key];
  }
  function redrawStage() {
    if (!STG) return;
    const v = view();
    HITS = [];
    DIVS = [];
    try { drawSheet(canvas.getContext("2d"), STG.k, STG.sh, STG.G, S.book, v, STG.pics, true); }
    finally { STG.hits = HITS.filter(h => h.ox > 0.5 || h.oy > 0.5); STG.divs = DIVS; HITS = null; DIVS = null; }
  }
  /* The line between two pictures sharing a place, under the pointer. */
  function divAt(e) {
    if (!STG || isMotion() || !STG.divs || !STG.divs.length) return null;
    const r = canvas.getBoundingClientRect();
    if (!r.width) return null;
    const u = STG.G.sheetW / r.width;
    const px = (e.clientX - r.left) * u, py = (e.clientY - r.top) * u;
    const tol = 5 * u;
    for (const d of STG.divs) {
      const b = d.box;
      if (d.d === "h" ? Math.abs(px - d.at) <= tol && py >= b.y && py <= b.y + b.h
        : Math.abs(py - d.at) <= tol && px >= b.x && px <= b.x + b.w) return { d, u };
    }
    return null;
  }
  let ddrag = null, lastDiv = null;
  function shareMap(tag, arr) {
    const st = state();
    st.split = st.split || {};
    st.splitW = st.splitW || {};
    st.split[tag] = arr;
    if (!st.splitW[tag] || st.splitW[tag]._a !== arr) st.splitW[tag] = { _a: arr };
    return st.splitW[tag];
  }
  canvas.addEventListener("pointerdown", (e) => {
    if (isMotion() || e.button !== 0) return;
    // a line between pictures first: dragging it shares the place anew
    const dv = divAt(e);
    if (dv) {
      e.preventDefault();
      e.stopPropagation();
      // pressed twice on the same line: the pictures either side even again
      const now = performance.now();
      const same = lastDiv && lastDiv.tag === dv.d.tag && lastDiv.path === dv.d.path && lastDiv.i === dv.d.i && now - lastDiv.t < 400;
      lastDiv = { tag: dv.d.tag, path: dv.d.path, i: dv.d.i, t: now };
      if (same) {
        lastDiv = null;
        const sw = shareMap(dv.d.tag, dv.d.arr);
        delete sw[dv.d.path];
        paint();
        return;
      }
      canvas.setPointerCapture(e.pointerId);
      ddrag = { ...dv.d, u: dv.u, x: e.clientX, y: e.clientY, moved: false };
      canvas.classList.add("dragging");
      return;
    }
    const hit = hitAt(e);
    if (!hit) return;
    e.preventDefault();
    e.stopPropagation();
    canvas.setPointerCapture(e.pointerId);
    const fm = focusMap(false);
    const f0 = (fm && fm[hit.h.id]) || [0, 0];
    pdrag = { id: hit.h.id, x: e.clientX, y: e.clientY, u: hit.u, ox: hit.h.ox, oy: hit.h.oy, fx: f0[0], fy: f0[1], moved: false };
    canvas.classList.add("dragging");
  });
  canvas.addEventListener("pointermove", (e) => {
    if (ddrag) {
      const dd = ddrag.d === "h" ? (e.clientX - ddrag.x) * ddrag.u : (e.clientY - ddrag.y) * ddrag.u;
      const ws = ddrag.ws.slice();
      const i = ddrag.i, pair = ws[i] + ws[i + 1], min = Math.min(0.12, pair / 3);
      const a = Math.max(min, Math.min(pair - min, ws[i] + dd / ddrag.avail));
      ws[i] = Math.round(a * 1000) / 1000;
      ws[i + 1] = Math.round((pair - a) * 1000) / 1000;
      shareMap(ddrag.tag, ddrag.arr)[ddrag.path] = ws;
      ddrag.moved = true;
      redrawStage();
      return;
    }
    if (!pdrag) {
      if (!isMotion() && STG) {
        const dv = divAt(e);
        canvas.classList.toggle("splitx", !!dv && dv.d.d === "h");
        canvas.classList.toggle("splity", !!dv && dv.d.d === "v");
        canvas.classList.toggle("frameable", !dv && !!hitAt(e));
      }
      return;
    }
    const dx = (e.clientX - pdrag.x) * pdrag.u, dy = (e.clientY - pdrag.y) * pdrag.u;
    const cl = (v) => Math.max(-1, Math.min(1, v));
    const fx = pdrag.ox > 0.5 ? cl(pdrag.fx + dx / (pdrag.ox / 2)) : 0;
    const fy = pdrag.oy > 0.5 ? cl(pdrag.fy + dy / (pdrag.oy / 2)) : 0;
    const fm = focusMap(true);
    fm[pdrag.id] = [Math.round(fx * 1000) / 1000, Math.round(fy * 1000) / 1000];
    pdrag.moved = true;
    redrawStage();
  });
  const endPDrag = () => {
    if (ddrag) {
      const moved = ddrag.moved;
      ddrag = null;
      canvas.classList.remove("dragging");
      if (moved) paint();
      return;
    }
    if (!pdrag) return;
    const moved = pdrag.moved;
    pdrag = null;
    canvas.classList.remove("dragging");
    if (moved) paint();
  };
  canvas.addEventListener("pointerup", endPDrag);
  canvas.addEventListener("pointercancel", endPDrag);
  canvas.addEventListener("dblclick", (e) => {
    if (isMotion()) return;
    const dv = divAt(e);
    if (dv) {
      // the two pictures either side back to their first shares
      e.stopPropagation();
      const sw = shareMap(dv.d.tag, dv.d.arr);
      delete sw[dv.d.path];
      paint();
      return;
    }
    const hit = hitAt(e);
    if (!hit) return;
    e.stopPropagation();
    const fm = focusMap(false);
    if (fm && fm[hit.h.id]) { delete fm[hit.h.id]; paint(); }
  });

  let stageTicket = 0;
  async function paintStage() {
    const sh = S.sheets[S.cur];
    navL.disabled = S.cur <= 0;
    navR.disabled = S.cur >= S.sheets.length - 1;
    count.textContent = S.sheets.length ? `${S.cur + 1} / ${S.sheets.length}` : "";
    if (!sh) return;
    const t = ++stageTicket;
    const maxW = Math.max(200, desk.clientWidth - 118);
    const maxH = stageMaxH(maxW);
    const side = maxW * (window.devicePixelRatio || 1) > 1000 ? 1600 : 800;
    await drawInto(canvas, sh, maxW, maxH, side, () => t === stageTicket);
    fitNode();
  }

  let stripTicket = 0;
  async function paintStrip(G) {
    const ticket = ++stripTicket;
    const H = 64, dpr = window.devicePixelRatio || 1;
    const k = (H * dpr) / G.sheetH;
    const unit = G.cat === "web" ? "FRAMES" : "SPREADS";
    const removed = Object.keys(state().off).length;
    stripH.innerHTML = `${unit} <b>${S.sheets.length}</b>`
      + (removed ? `<button class="vly-restore" title="Bring back every page taken out">${removed} removed · Restore</button>` : "")
      + `<span class="hint">${esc(G.fmt.label)} · ${esc(G.fmt.size)}</span>`;
    strip.innerHTML = S.sheets.map((sh, i) =>
      `<div class="vly-mini${i === S.cur ? " cur" : ""}" data-i="${i}" title="${esc(sheetName(sh))}">
        <button class="del" data-id="${esc(sh.id)}" title="${String(sh.id).startsWith("c:") && !String(sh.id).endsWith(":w")
          ? "Take this cut out of the layout" : "Take this page out of the layout"}">×</button>
        <canvas width="${Math.round(G.sheetW * k)}" height="${Math.round(G.sheetH * k)}"
          style="width:${(H * G.sheetW) / G.sheetH}px;height:${H}px"></canvas>
        <span><b>${String(i + 1).padStart(2, "0")}</b>${esc(TEMPLATES[sh.t] || sh.t)}</span>
      </div>`).join("");
    const v = view();
    const draw = (pics) => {
      if (ticket !== stripTicket) return;
      strip.querySelectorAll(".vly-mini canvas").forEach((cv, i) => {
        drawSheet(cv.getContext("2d"), k, S.sheets[i], G, S.book, v, pics, true);
      });
    };
    draw(new Map());
    await fontsFor(P.vly_font);
    draw(await picsFor(S.sheets, 400));
  }

  function go(i) {
    const n = S.sheets.length;
    if (!n) return;
    const to = Math.max(0, Math.min(n - 1, i));
    if (to === S.cur) return;
    S.cur = to;
    paint();
    const mini = strip.querySelector(`.vly-mini[data-i="${to}"]`);
    if (mini) mini.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  // ---- full screen
  let fullTicket = 0;
  function isFull() { return full.classList.contains("on"); }
  async function paintFull() {
    const sh = S.sheets[S.cur];
    if (!sh || !S.book) return;
    full.querySelector(".s").textContent = S.book.series.toUpperCase();
    full.querySelector(".nm").textContent = `${S.cur + 1} / ${S.sheets.length} · ${sheetName(sh)}`;
    full.querySelector(".vly-nav.l").disabled = S.cur <= 0;
    full.querySelector(".vly-nav.r").disabled = S.cur >= S.sheets.length - 1;
    const t = ++fullTicket;
    await drawInto(fullCanvas, sh, window.innerWidth - 180, window.innerHeight - 120, 0, () => t === fullTicket);
  }
  function openFull() {
    if (!S.book || isFull()) return;
    full.classList.add("on");
    const ask = full.requestFullscreen || full.webkitRequestFullscreen;
    if (ask) Promise.resolve(ask.call(full)).catch(() => null);
    paintFull();
  }
  function closeFull() {
    if (!isFull()) return;
    full.classList.remove("on");
    if (document.fullscreenElement === full) document.exitFullscreen().catch(() => null);
  }
  function onFullChange() {
    if (!document.fullscreenElement && isFull()) full.classList.remove("on");
    else if (isFull()) paintFull();
  }
  document.addEventListener("fullscreenchange", onFullChange);

  // ---- typefaces
  let pop = null;
  function closePop() { if (pop) { pop.remove(); pop = null; } }
  /* Favourite typefaces, kept in this browser for every layout. */
  const FAV_KEY = "leiel.layout.fontFavs";
  function favs() {
    try { const v = JSON.parse(localStorage.getItem(FAV_KEY) || "[]"); return Array.isArray(v) ? v : []; }
    catch (e) { return []; }
  }
  function setFavs(list) {
    try { localStorage.setItem(FAV_KEY, JSON.stringify(list)); } catch (e) { /* storage refused */ }
  }

  function openFonts() {
    closePop();
    pop = document.createElement("div");
    pop.className = "vly-pop";
    const sample = (S.book && S.book.series) || "The Keeper's Letter";
    const pct = (x) => Math.round((x || 1) * 100);
    pop.innerHTML = `
      <div class="hd"><span class="tt">Style</span><span class="kb">Layout</span>
        <button class="xx" title="Close">${ICON.close}</button></div>
      <div class="opts">
        <div class="grp"><span class="lab">COLOUR</span><div class="sws"></div></div>
        <div class="grp"><span class="lab">WORDS ON THE PAGE</span><div class="pseg"></div>
          <span class="note2">Every page, unless a page sets its own.</span></div>
        <div class="grp"><span class="lab">WORDS FROM THE NOTES</span><div class="pseg nl"></div>
          <span class="note2">The series note and each cut's note, on the pages, frames and in the post. Titles and captions stay.</span></div>
        <div class="grp lgg"><span class="lab">LOGO</span><div class="lgrow"></div>
          <input class="lgf" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,.png,.jpg,.jpeg,.webp,.svg" style="display:none" />
          <span class="note2">At the foot of the closing page - in print, on the web and at the end of the film.</span></div>
        <div class="grp sln"><span class="lab">SHOT LENGTH <span class="kb2">MOTION</span></span><div class="slrow"></div>
          <span class="note2 sli"></span></div>
      </div>
      <div class="opts sizes">
        <div class="grp sz"><span class="lab">TITLE SIZE <b class="v" data-v="title">${pct(P.vly_size.title)}%</b></span>
          <input type="range" min="70" max="150" step="5" data-s="title" value="${pct(P.vly_size.title)}" /></div>
        <div class="grp sz"><span class="lab">TEXT SIZE <b class="v" data-v="text">${pct(P.vly_size.text)}%</b></span>
          <input type="range" min="70" max="150" step="5" data-s="text" value="${pct(P.vly_size.text)}" /></div>
        <button class="pbtn rs" title="Both back to 100%">Reset sizes</button>
      </div>
      <div class="bd">
        <div class="col" data-r="title"><span class="lab">TITLES</span><span class="cur"></span>
          <input class="q" placeholder="Find a typeface" /><div class="list"></div></div>
        <div class="col" data-r="body"><span class="lab">TEXT</span><span class="cur"></span>
          <input class="q" placeholder="Find a typeface" /><div class="list"></div></div>
      </div>
      <div class="ft"><span class="w"></span>
        <button class="pbtn load">Fonts on this computer</button>
        <button class="pbtn ok">Done</button></div>`;
    document.body.appendChild(pop);
    const w = pop.querySelector(".ft .w");
    const item = (n, role, fav) =>
      `<div class="it${n === P.vly_font[role] ? " on" : ""}" data-f="${esc(n)}">
        <button class="star${fav ? " on" : ""}" data-star="${esc(n)}" title="${fav ? "Take it out of the favourites" : "Keep it with the favourites, at the top"}">${fav ? "\u2605" : "\u2606"}</button>
        <span class="fam">${esc(n)}${SHIPPED[n] ? " \u00b7 with the pack" : ""}</span>
        <span class="smp" style="font-family:${esc(stack(n, role === "title"))}">${esc(role === "title" ? sample : "Forty miles from the nearest town")}</span></div>`;
    const fillLists = () => {
      const fv = favs();
      const fams = [...new Set(["Cormorant Garamond", "Inter", ...(localFonts || [])])];
      for (const col of pop.querySelectorAll(".col")) {
        const role = col.dataset.r;
        const q = col.querySelector(".q").value.trim().toLowerCase();
        const hit = (n) => !q || n.toLowerCase().includes(q);
        col.querySelector(".cur").textContent = P.vly_font[role];
        const top = fv.filter(hit);
        const rest = fams.filter(n => hit(n) && !fv.includes(n)).slice(0, 300);
        col.querySelector(".list").innerHTML =
          (top.length ? `<div class="sec">FAVOURITES</div>` + top.map(n => item(n, role, true)).join("") : "")
          + (rest.length ? `<div class="sec">${top.length ? "ALL" : "TYPEFACES"}</div>` + rest.map(n => item(n, role, false)).join("") : "");
      }
      w.textContent = localFonts
        ? `${localFonts.length} typefaces on this computer. On a computer without the chosen one, the pack's own is used.`
        : "The two typefaces of the pack look the same everywhere. Fonts on this computer asks the browser for the rest.";
    };
    const fillOpts = () => {
      pop.querySelector(".sws").innerHTML = THEMES.map(t =>
        `<button class="th${t.id === P.vly_theme ? " on" : ""}" data-th="${t.id}" title="${esc(t.label)}">
          <span class="chip" style="background:${t.paper};color:${t.ink}"><b style="background:${t.accent}"></b>Aa</span>
          <span class="nm">${esc(t.label)}</span></button>`).join("");
      pop.querySelector(".pseg").innerHTML = TEXT_POS.map(t =>
        `<button class="${t.id === P.vly_textpos ? "on" : ""}" data-tp="${t.id}">${esc(t.label)}</button>`).join("");
      pop.querySelector(".pseg.nl").innerHTML = NOTE_LINES.map(t =>
        `<button class="${(P.vly_lines || "all") === t.id ? "on" : ""}" data-nl="${t.id}" title="${esc(t.hint)}">${esc(t.label)}</button>`).join("");
      fillLen();
      const lg = P.vly_logo || {};
      pop.querySelector(".lgrow").innerHTML = lg.name
        ? `<span class="lgp" style="background:${(THEMES.find(t => t.id === P.vly_theme) || THEMES[0]).paper}"><img src="${api.apiURL(LOGO_URL)}?name=${encodeURIComponent(lg.name)}" /></span>
           <span class="pseg lgs">${[["s", "S"], ["m", "M"], ["l", "L"]].map(([v, l]) =>
             `<button class="${(lg.size || "m") === v ? "on" : ""}" data-lgs="${v}" title="${{ s: "Small", m: "Medium", l: "Large" }[v]}">${l}</button>`).join("")}</span>
           <button class="pbtn lgc">Change\u2026</button><button class="pbtn lgx">Remove</button>`
        : `<button class="pbtn lgc">Choose a logo\u2026</button><span class="note2">PNG, SVG, JPEG or WebP - a PNG or SVG with a clear background sits best.</span>`;
    };
    /* The length of every picture shot in the film of this series that has
       not been given its own - and a button to give it to those too. */
    function fillLen() {
      const row = pop.querySelector(".slrow");
      if (!row) return;
      if (!S.book) { row.innerHTML = ""; pop.querySelector(".sli").textContent = "Choose a series first."; return; }
      const m = mstate();
      const own = Object.entries(m.set).filter(([k, v]) => k.startsWith("p:") && v && v.dur != null).length;
      row.innerHTML = `<span class="pseg">${[2, 3, 4, 5, 6, 8].map(v =>
          `<button class="${m.len === v ? "on" : ""}" data-sl="${v}">${v}s</button>`).join("")}</span>
        <input class="sln-n" type="number" min="1" max="20" step="0.1" value="${m.len}" title="Any length from 1 to 20 seconds" /><span class="u">s</span>
        <button class="pbtn sla"${own ? "" : " disabled"} title="Give this length to the shots with a length of their own as well">Set every shot</button>`;
      pop.querySelector(".sli").textContent = own
        ? `Every picture shot of this film without a length of its own. ${own} shot${own === 1 ? " has" : "s have"} one - Set every shot gives them this length too. The title and closing keep theirs.`
        : "Every picture shot of this film. A length set on a shot itself stays its own. The title and closing keep theirs.";
    }
    const setLen = (v) => {
      v = Math.round(Math.max(1, Math.min(20, Number(v) || 4)) * 100) / 100;
      mstate().len = v;
      fillLen();
      paint();
    };
    pop.addEventListener("change", (e) => {
      if (e.target.closest(".sln-n")) setLen(e.target.value);
    });
    let sizeT = 0;
    pop.addEventListener("change", async (e) => {
      const inp = e.target.closest(".lgf");
      if (!inp || !inp.files || !inp.files[0]) return;
      const file = inp.files[0];
      try {
        const r = await api.fetchApi(`${LOGO_URL}?name=${encodeURIComponent(file.name)}`, { method: "POST", body: file });
        const j = await r.json();
        if (!j.ok) throw new Error(j.error || "the logo could not be kept");
        P.vly_logo = { name: j.name, size: (P.vly_logo || {}).size || "m" };
        LOGO = null;
        fillOpts();
        paint();
      } catch (err) {
        w.textContent = `Logo not set: ${err && err.message || err}`;
      }
      inp.value = "";
    });
    pop.addEventListener("input", (e) => {
      if (e.target.classList.contains("q")) { fillLists(); return; }
      const sl = e.target.closest("[data-s]");
      if (sl) {
        P.vly_size[sl.dataset.s] = Number(sl.value) / 100;
        pop.querySelector(`.v[data-v="${sl.dataset.s}"]`).textContent = `${sl.value}%`;
        clearTimeout(sizeT);
        sizeT = setTimeout(paint, 120);
      }
    });
    pop.addEventListener("click", async (e) => {
      if (e.target.closest(".xx") || e.target.closest(".ok")) { closePop(); return; }
      if (e.target.closest(".load")) {
        try { await askLocalFonts(); fillLists(); }
        catch (err) { w.textContent = `The fonts could not be listed: ${err && err.message || err}`; }
        return;
      }
      if (e.target.closest(".rs")) {
        P.vly_size = { title: 1, text: 1 };
        pop.querySelectorAll("[data-s]").forEach(sl => { sl.value = "100"; });
        pop.querySelectorAll(".v").forEach(v => { v.textContent = "100%"; });
        paint();
        return;
      }
      const star = e.target.closest("[data-star]");
      if (star) {
        const n = star.dataset.star, fv = favs();
        setFavs(fv.includes(n) ? fv.filter(x => x !== n) : [...fv, n]);
        fillLists();
        return;
      }
      const nl = e.target.closest("[data-nl]");
      if (nl) { P.vly_lines = nl.dataset.nl; fillOpts(); rewords(); return; }
      const sl = e.target.closest("[data-sl]");
      if (sl) { setLen(sl.dataset.sl); return; }
      if (e.target.closest(".sla")) {
        const m = mstate();
        for (const [k, v] of Object.entries(m.set)) if (k.startsWith("p:") && v) delete v.dur;
        MZ.fitUndo = null;
        fillLen();
        paint();
        return;
      }
      if (e.target.closest(".lgc")) { pop.querySelector(".lgf").click(); return; }
      if (e.target.closest(".lgx")) { delete P.vly_logo; fillOpts(); paint(); return; }
      const lgs = e.target.closest("[data-lgs]");
      if (lgs) { P.vly_logo = { ...(P.vly_logo || {}), size: lgs.dataset.lgs }; fillOpts(); paint(); return; }
      const th = e.target.closest(".th");
      if (th) { P.vly_theme = th.dataset.th; fillOpts(); paint(); return; }
      const tp = e.target.closest("[data-tp]");
      if (tp) { P.vly_textpos = tp.dataset.tp; fillOpts(); paint(); return; }
      const it = e.target.closest(".it");
      if (it) {
        const role = it.closest(".col").dataset.r;
        P.vly_font[role] = it.dataset.f;
        fillLists();
        paint();
      }
    });
    pop.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); closePop(); } });
    fillOpts();
    fillLists();
  }

  // ---- package
  const PROOF_DPI = 150;
  function linkName(label, title) {
    return `${label} ${title}`.replace(/[<>:"/\\|?*\x00-\x1f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
  }
  /* Every picture the layout uses, once, with the strictest place it is
     printed at - a cover used on its own spread as well counts twice. */
  function linksOf(sheets, G) {
    const byId = new Map();
    const sceneOf = (pick) => S.book.scenes.find(s => s.picks.some(p => String(p.id) === String(pick.id)));
    sheets.forEach((sh) => {
      for (const pl of placements(sh, G)) {
        const sc = pl.cut || sceneOf(pl.pick) || { no: "00", label: "00", title: "Cover" };
        const id = String(pl.pick.id);
        const dpi = placedDpi(pl);
        const name = `${TEMPLATES[sh.t] || sh.t}${pl.cut ? "" : " (cover)"}`;
        const hit = byId.get(id);
        if (!hit) {
          byId.set(id, { id: pl.pick.id, no: sc.no, label: sc.label || sc.no, title: sc.title, pick: pl.pick,
            dpi, placed: [name] });
        } else {
          hit.dpi = Math.min(hit.dpi, dpi);
          if (!hit.placed.includes(name)) hit.placed.push(name);
        }
      }
    });
    // two picks of one cut (a cover and the cut's own) need two names
    const seen = new Map();
    for (const l of byId.values()) {
      const base = linkName(l.label, l.title);
      const n = (seen.get(base) || 0) + 1;
      seen.set(base, n);
      l.file = n > 1 ? `${base} (${n})` : base;
    }
    return [...byId.values()].sort((a, b) => String(a.label).localeCompare(String(b.label), undefined, { numeric: true }));
  }
  /* Marked on every page of a proof: this is not the file to print. */
  function proofMark(ctx, k, G, i, n) {
    ctx.save();
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#c0473a";
    setFont(ctx, k, stack("Inter"), 7, 500, false);
    setTrack(ctx, k, 7, 0.2);
    ctx.textAlign = "right";
    ctx.fillText(`PROOF \u00b7 ${String(i + 1).padStart(2, "0")} / ${String(n).padStart(2, "0")}`,
      (G.sheetW - 8) * k, 9 * k);
    ctx.restore();
  }
  /* What a package will hold, shown before anything is written. */
  function openPackage() {
    if (!S.book) return;
    const G = geo();
    if (G.cat === "web") return;
    closePop();
    const ls = linksOf(S.sheets, G);
    const up = ls.filter(l => l.pick.hd).length;
    const low = ls.filter(l => l.dpi < 300).length;
    const safe = (x) => String(x).replace(/[<>:"/\\|?*\x00-\x1f]+/g, " ").trim();
    const name = safe(S.book.series);
    pop = document.createElement("div");
    pop.className = "vly-pop wide";
    pop.innerHTML = `
      <div class="hd"><span class="tt">Package</span><span class="kb">${esc(S.book.series)}</span>
        <button class="xx" title="Close">${ICON.close}</button></div>
      <div class="bd" style="display:flex;flex-direction:column;gap:12px">
        <div class="col" style="gap:6px"><span class="lab">NAME</span>
          <div class="row"><input class="pnm" value="${esc(name)}" spellcheck="false" /></div></div>
        <div class="col" style="gap:6px"><span class="lab">PACKAGE INTO</span>
          <div class="row"><input class="pdir" placeholder="output / ${esc(name)}  - leave empty for the series' own output folder" value="${esc((P.vly_pkgdir || {})[P.vly_series] || "")}" /></div>
          <span class="note2">Any folder on this computer; <b class="pkn">${esc(name)} - Package</b> is made inside it.
            A package of that name already there is never written over: (2), (3)\u2026 is added to the new one.</span></div>
        <div class="pk-grid">
          <div><b>Links</b><span>${ls.length} picture${ls.length === 1 ? "" : "s"} \u00b7 ${up ? `${up} upscaled, ${ls.length - up} as rendered` : "as rendered"}</span></div>
          <div><b>Fonts</b><span>${esc(P.vly_font.title)}${P.vly_font.body !== P.vly_font.title ? " \u00b7 " + esc(P.vly_font.body) : ""} \u00b7 every weight</span></div>
          <div><b>${esc(name)} - Proof.pdf</b><span>${S.sheets.length} spreads \u00b7 ${esc(G.fmt.size)} \u00b7 150 dpi \u00b7 marked PROOF</span></div>
          <div><b>Report.txt</b><span>how sharp each picture prints, and what it needs for 300 dpi</span></div>
          <div><b>${esc(name)}.layout</b><span>the layout, to open and link again</span></div>
        </div>
        <div class="tbl"><table><thead><tr><th>CUT</th><th>LINK</th><th>FROM</th><th style="text-align:right">DPI</th><th>STATUS</th></tr></thead><tbody>
        ${ls.map(l => `<tr><td class="n">${esc(l.label)}</td><td class="f">${esc(l.file)}</td>
          <td class="m">${l.pick.hd ? "Upscaled" : "Render"}</td><td class="r">${Math.round(l.dpi)}</td><td>${statusOf(l.dpi)}</td></tr>`).join("")}
        </tbody></table></div>
        <span class="note2">${low ? `<span class="warn">${low} of ${ls.length} below 300 dpi.</span> That is what a package is for: upscale the pictures in Links your own way, then link them in Links.`
          : "Every picture prints at 300 dpi or more - the package is ready for print."}
</span>
      </div>
      <div class="ft"><span class="w"></span>
        <button class="pbtn cancel">Cancel</button>
        <button class="pbtn ok go">Package</button></div>`;
    document.body.appendChild(pop);
    pop.addEventListener("click", (e) => {
      if (e.target.closest(".xx") || e.target.closest(".cancel")) { closePop(); return; }
      if (e.target.closest(".go")) {
        const dir = pop.querySelector(".pdir").value.trim();
        const nm = safe(pop.querySelector(".pnm").value) || name;
        P.vly_pkgdir = P.vly_pkgdir || {};
        if (dir) P.vly_pkgdir[P.vly_series] = dir; else delete P.vly_pkgdir[P.vly_series];
        closePop();
        packageAll(dir, false, nm);
      }
    });
    pop.addEventListener("input", (e) => {
      if (!e.target.closest(".pnm")) return;
      const nm = safe(e.target.value) || name;
      const b = pop.querySelectorAll(".pk-grid b");
      pop.querySelector(".pkn").textContent = `${nm} - Package`;
      if (b[2]) b[2].textContent = `${nm} - Proof.pdf`;
      if (b[4]) b[4].textContent = `${nm}.layout`;
    });
    pop.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); closePop(); } });
  }

  async function packageAll(dir, withIdml, name) {
    if (S.exporting || !S.book) return;
    const G = geo();
    if (G.cat === "web") return;
    S.exporting = true;
    packBtn.disabled = exportBtn.disabled = true;
    const sheets = S.sheets.slice();
    const book = S.book;
    const v = view();
    try {
      await fontsFor(P.vly_font);
      await logoReady();
      const k = PROOF_DPI / 25.4;
      const pages = [];
      for (let i = 0; i < sheets.length; i++) {
        say(`Packaging - proof of spread ${i + 1} of ${sheets.length}\u2026`);
        const pics = await picsFor([sheets[i]], 1600);
        const cv = document.createElement("canvas");
        cv.width = Math.round(G.sheetW * k);
        cv.height = Math.round(G.sheetH * k);
        const ctx = cv.getContext("2d");
        drawSheet(ctx, k, sheets[i], G, book, v, pics, false);
        proofMark(ctx, k, G, i, sheets.length);
        pages.push(cv.toDataURL("image/jpeg", 0.88));
        cv.width = cv.height = 0;
      }
      const links = linksOf(sheets, G);
      const report = links.map(l => {
        const f = 300 / l.dpi;
        const src = l.pick.hd || l.pick;
        return {
          cut: l.label, link: l.file + (l.pick.hd ? (l.pick.hd.name.match(/\.[^.]+$/) || [".png"])[0].toLowerCase() : ".png"),
          now: l.pick.hd ? `${l.pick.hd.w}\u00d7${l.pick.hd.h} (upscaled)` : `${l.pick.w}\u00d7${l.pick.h}`,
          placed: l.placed.join(", "), dpi: Math.round(l.dpi),
          needs: f <= 1 ? "-" : `${Math.ceil(src.w * f)}\u00d7${Math.ceil(src.h * f)}  (\u00d7${f.toFixed(1)})`,
        };
      });
      say("Packaging - copying the pictures and typefaces\u2026");
      const r = await api.fetchApi(PACKAGE_URL, {
        method: "POST",
        body: JSON.stringify({
          series: book.series,
          folder: dir || "",
          name: name || book.series,
          idml: withIdml ? idmlModel(sheets, G, book, v) : null,
          links: links.map(l => ({ id: l.id, no: l.no, label: l.label, title: l.file.slice(String(l.label).length + 1),
            hd: l.pick.hd ? l.pick.hd.path : null })),
          fonts: [P.vly_font.title, P.vly_font.body],
          pages, proof_dpi: PROOF_DPI, report,
          format_label: G.fmt.label, format_size: G.fmt.size,
          layout: {
            ...layoutDoc(),
          },
        }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "the package could not be written");
      const low = report.filter(x => x.dpi < 300).length;
      say(`Package written to ${j.folder} - ${j.links} pictures, ${j.fonts.length} typefaces`
        + (j.idml ? `, ${j.idml.split(/[\\/]/).pop()}` : "")
        + (j.fonts_missing.length ? ` (not found: ${j.fonts_missing.join(", ")})` : "")
        + (low ? ` \u00b7 ${low} below 300 dpi, see Report.txt` : " \u00b7 every picture at 300 dpi"));
    } catch (e) {
      say(`Package stopped: ${e && e.message || e}`, true);
    } finally {
      S.exporting = false;
      packBtn.disabled = exportBtn.disabled = false;
    }
  }

  // ---- links
  function statusOf(dpi) {
    if (dpi >= 300) return `<span class="st ok">300+</span>`;
    if (dpi >= 200) return `<span class="st low">LOW</span>`;
    return `<span class="st bad">PROOF ONLY</span>`;
  }
  function openLinks() {
    if (!S.book) return;
    closePop();
    const G = geo();
    pop = document.createElement("div");
    pop.className = "vly-pop wide";
    const dir = (P.vly_linkdir || {})[P.vly_series] || "";
    pop.innerHTML = `
      <div class="hd"><span class="tt">Links</span><span class="kb">${esc(S.book.series)}</span>
        <button class="xx" title="Close">${ICON.close}</button></div>
      <div class="bd" style="display:flex;flex-direction:column;gap:12px">
        <div class="col" style="gap:6px"><span class="lab">UPSCALED PICTURES</span>
          <div class="row"><input class="dir" placeholder="The folder the upscaled pictures are in - e.g. ComfyUI/output/upscale" value="${esc(dir)}" />
            <button class="pbtn ok find">Find</button></div>
          <span class="note2">Any folder, any names: each picture is recognised by what it shows, and must be larger than the render and of the same shape. Folders inside it are searched too.</span></div>
        <div class="tbl"><table><thead><tr><th>CUT</th><th>PLACED AS</th><th>RENDER</th><th>LINKED</th><th style="text-align:right">DPI</th><th>STATUS</th><th></th></tr></thead><tbody></tbody></table></div>
      </div>
      <div class="ft"><span class="w"></span><button class="pbtn ok done">Done</button></div>`;
    document.body.appendChild(pop);
    const body = pop.querySelector("tbody"), w = pop.querySelector(".ft .w");
    const fill = () => {
      const ls = linksOf(buildSheets(S.book, view(), G), G);
      body.innerHTML = ls.map(l => {
        const hd = l.pick.hd;
        return `<tr><td class="n">${esc(l.label)}</td><td class="m">${esc(l.placed.join(", "))}</td>
          <td class="m">${l.pick.w}\u00d7${l.pick.h}</td>
          <td class="f" title="${esc(hd ? hd.path : "")}">${hd ? `${hd.w}\u00d7${hd.h} \u00b7 ${esc(hd.name)}` : `<span class="m">-</span>`}</td>
          <td class="r">${Math.round(l.dpi)}</td><td>${statusOf(l.dpi)}</td>
          <td>${hd ? `<button class="ux" data-id="${l.id}" title="Unlink - back to the render">\u00d7</button>` : ""}</td></tr>`;
      }).join("");
      const ok = ls.filter(l => l.dpi >= 300).length;
      w.innerHTML = ok === ls.length ? `Every picture prints at 300 dpi or more - ready for print.`
        : `<span class="warn">${ls.length - ok} of ${ls.length} below 300 dpi.</span> Upscale them, then Find again.`;
    };
    const find = async () => {
      const folder = pop.querySelector(".dir").value.trim();
      if (!folder) return;
      P.vly_linkdir = P.vly_linkdir || {};
      P.vly_linkdir[P.vly_series] = folder;
      const ls = linksOf(buildSheets(S.book, view(), G), G);
      w.textContent = "Looking at the pictures in that folder\u2026";
      let j;
      try {
        const r = await api.fetchApi(RELINK_URL, { method: "POST", body: JSON.stringify({ folder, ids: ls.map(l => l.id) }) });
        j = await r.json();
      } catch (e) { j = { ok: false, error: String(e && e.message || e) }; }
      if (!j.ok) { w.innerHTML = `<span class="warn">${esc(j.error || "the folder could not be read")}</span>`; return; }
      const st = state();
      let n = 0;
      for (const [id, f] of Object.entries(j.found || {})) { st.hd[id] = f; n++; }
      fill();
      paint();
      w.innerHTML = `${n} of ${ls.length} linked from ${j.looked} pictures in the folder. ` + w.innerHTML;
    };
    pop.addEventListener("click", (e) => {
      if (e.target.closest(".xx") || e.target.closest(".done")) { closePop(); return; }
      if (e.target.closest(".find")) { find(); return; }
      const ux = e.target.closest(".ux");
      if (ux) { delete state().hd[ux.dataset.id]; fill(); paint(); }
    });
    pop.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.stopPropagation(); closePop(); }
      if (e.key === "Enter" && e.target.classList.contains("dir")) find();
    });
    fill();
  }

  // ---- export
  /* The sizes a web layout can be written at, by where it is going. */
  const WEB_PRESETS = [
    { id: "ig45", label: "Instagram feed", note: "4:5 · 1080 × 1350" },
    { id: "sq", label: "Square posts", note: "1:1 · 1080 × 1080" },
    { id: "story", label: "Stories · Reels · Shorts", note: "9:16 · 1080 × 1920" },
    { id: "wide", label: "YouTube · X · websites", note: "16:9 · 1920 × 1080" },
  ];
  function expOpts() {
    const o = P.vly_exp && typeof P.vly_exp === "object" ? P.vly_exp : (P.vly_exp = {});
    o.print = { fmt: "jpg", pages: "spreads", dpi: 300, ...(o.print || {}) };
    o.web = { fmt: "jpg", sizes: null, ...(o.web || {}) };
    o.dir = o.dir || {};
    o.range = o.range === "this" ? "this" : "all";
    o.name = o.name && typeof o.name === "object" ? o.name : {};
    return o;
  }

  /* The layout as an InDesign document: every spread drawn once more, with
     its pictures and blocks of words written down instead of only painted. */
  function idmlModel(sheets, G, book, v) {
    const cv = document.createElement("canvas");
    cv.width = cv.height = 8;
    const ctx = cv.getContext("2d");
    const spreads = sheets.map((sh) => {
      REC = [];
      try { drawSheet(ctx, 1, sh, G, book, v, new Map(), false); }
      finally { var items = REC; REC = null; }
      return { items };
    });
    return { page: [G.pw, G.ph], margins: G.M, paper: G.c.paper, spreads };
  }

  function openExport() {
    if (!S.book) return;
    closePop();
    const o = expOpts();
    const web = P.vly_cat === "web";
    const G = geo();
    if (web && !o.web.sizes) o.web.sizes = [G.fmt.id];
    const name = S.book.series;
    pop = document.createElement("div");
    let postOf = () => null;
    pop.className = "vly-pop wide vly-exp";
    pop.innerHTML = `
      <div class="hd"><span class="tt">Export</span><span class="kb">${web ? "Web" : "Print"}</span>
        <span class="kb2">${esc(name)}</span>
        <button class="xx" title="Close">${ICON.close}</button></div>
      <div class="ex-body">
        <div class="ex-prev"><canvas></canvas><span class="ex-cap"></span></div>
        <div class="ex-opts"></div>
      </div>
      <div class="ft"><span class="w"></span>
        <button class="pbtn cancel">Cancel</button>
        <button class="pbtn ok go">Export</button></div>`;
    document.body.appendChild(pop);
    const opts = pop.querySelector(".ex-opts"), w = pop.querySelector(".ft .w");
    const seg = (key, items, cur) => `<span class="pseg" data-k="${key}">` + items.map(([id, label, hint]) =>
      `<button class="${String(id) === String(cur) ? "on" : ""}" data-v="${id}" title="${esc(hint || "")}">${esc(label)}</button>`).join("") + `</span>`;
    const fill = () => {
      const G1 = geo();
      const v = view();
      const sheets = o.range === "this" ? [S.sheets[S.cur]].filter(Boolean) : S.sheets;
      const ls = linksOf(S.sheets, G1);
      const low = ls.filter(l => l.dpi < 300).length;
      let html = "";
      if (!web) {
        const p = o.print;
        html += `<div class="row2"><span class="lab">FORMAT</span>${seg("fmt", [["jpg", "JPEG", "Each spread or page as a JPEG"],
          ["png", "PNG", "Each spread or page as a PNG - larger, nothing lost"],
          ["pdf", "PDF", "One PDF of every spread or page, at its size"],
          ["idml", "InDesign", "A package with an InDesign document (IDML) of the layout, its pictures linked to the package"]], p.fmt)}</div>`;
        if (p.fmt !== "idml") {
          html += `<div class="row2"><span class="lab">PAGES</span>${seg("pages", [["spreads", "Spreads", "Two pages side by side, as they are seen"],
            ["single", "Single pages", "Every page on its own - as a printer imposes them"]], p.pages)}</div>`;
          html += `<div class="row2"><span class="lab">RESOLUTION</span>${seg("dpi", [[300, "300 dpi", "For print"], [150, "150 dpi", "For looking at and sending round"]], p.dpi)}</div>`;
        }
      } else {
        html += `<div class="row2"><span class="lab">FORMAT</span>${seg("wfmt", [["jpg", "JPEG", "Smaller files, for posting"], ["png", "PNG", "Nothing lost"]], o.web.fmt)}</div>`;
        html += `<div class="row2 top"><span class="lab">SIZES</span><div class="ex-sizes">` + WEB_PRESETS.map(ps =>
          `<label class="ck${o.web.sizes.includes(ps.id) ? " on" : ""}" data-size="${ps.id}"><span class="bx"></span>
            <span><b>${esc(ps.label)}</b><i>${esc(ps.note)}</i></span></label>`).join("") + `</div></div>`;
      }
      const idml = !web && o.print.fmt === "idml";
      if (!idml) html += `<div class="row2"><span class="lab">RANGE</span>${seg("range", [["all", `Every ${web ? "frame" : "spread"}`, ""], ["this", `This ${web ? "frame" : "spread"}`, ""]], o.range)}</div>`;
      if (!web) {
        html += `<div class="row2 top"><span class="lab">PRINT CHECK</span><div class="ex-check">`
          + (low ? `<div><span class="warn">${low} of ${ls.length} pictures print below 300 dpi.</span> <button class="lnk links">Links…</button></div>`
            : `<span class="okk">Every picture prints at 300 dpi or more.</span>`)
          + (idml ? "" : `<label class="ck${o.print.proof ?? low > 0 ? " on" : ""}" data-proof="1"><span class="bx"></span><span><b>Mark as proof</b><i>PROOF in the corner of every page, and in the file names</i></span></label>`)
          + `</div></div>`;
      }
      const key = idml ? "pkg" : web ? "web" : "print";
      html += `<div class="row2"><span class="lab">NAME</span><input class="enm" spellcheck="false" value="${esc(o.name[P.vly_series] || name)}" /></div>`;
      const dirVal = idml ? ((P.vly_pkgdir || {})[P.vly_series] || "") : (o.dir[`${P.vly_series}|${key}`] || "");
      html += `<div class="row2 top"><span class="lab">${idml ? "PACKAGE INTO" : "SAVE TO"}</span><div class="ex-dir">
        <input class="edir" value="${esc(dirVal)}" placeholder="${idml ? `output / ${esc(name)}` : `output / ${esc(name)} / layout / ${web ? "<size>" : esc(G1.fmt.id)}`}  - leave empty for this" />
        <span class="note2">${idml ? `<b>${esc(name)} - Package</b> is made inside it - Links, Fonts, Proof, Report and <b>${esc(name)}.idml</b>.`
          : web ? "Each size into a folder of its own inside it." : "Any folder on this computer."}
          Nothing is written over: when that name is there already, (2), (3)\u2026 is added.</span></div></div>`;
      opts.innerHTML = html;
      // what will be written
      const proof = !web && (o.print.proof ?? low > 0);
      if (idml) {
        w.innerHTML = `${S.sheets.length} spreads → a package and <b>${esc(name)}.idml</b> (${S.sheets.length * 2} pages, ${esc(G1.fmt.size)}), its ${ls.length} pictures linked to Links.`;
      } else if (web) {
        const n = sheets.length * o.web.sizes.length;
        w.innerHTML = o.web.sizes.length ? `${n} ${o.web.fmt === "png" ? "PNG" : "JPEG"} file${n === 1 ? "" : "s"} → ${o.web.sizes.length} size${o.web.sizes.length === 1 ? "" : "s"}, ${sheets.length} frame${sheets.length === 1 ? "" : "s"} each.`
          : `<span class="warn">Choose at least one size.</span>`;
      } else {
        const single = o.print.pages === "single";
        const per = single ? 2 : 1, k = o.print.dpi / 25.4;
        const px = `${Math.round((single ? G1.pw : G1.sheetW) * k)} × ${Math.round(G1.ph * k)} px`;
        const n = sheets.length * per;
        w.innerHTML = o.print.fmt === "pdf"
          ? `One PDF → ${n} ${single ? "pages" : "spreads"}${proof ? ", marked PROOF" : ""} · ${px} each`
          : `${n} ${o.print.fmt === "png" ? "PNG" : "JPEG"} file${n === 1 ? "" : "s"} → ${single ? "single pages" : "spreads"}${proof ? ", marked PROOF" : ""} · ${px} each`;
      }
      // the page in question, small
      const sh = S.sheets[S.cur];
      if (sh) {
        const pv = pop.querySelector(".ex-prev canvas");
        const t = ++prevTicket;
        drawInto(pv, sh, 300, 300, 800, () => t === prevTicket);
        pop.querySelector(".ex-cap").textContent = `${S.cur + 1} / ${S.sheets.length} · ${sheetName(sh)}`;
      }
    };
    let prevTicket = 0;
    pop.addEventListener("click", (e) => {
      if (e.target.closest(".xx") || e.target.closest(".cancel")) { closePop(); return; }
      if (e.target.closest(".links")) { openLinks(); return; }
      const b = e.target.closest(".pseg button");
      if (b) {
        const k2 = b.closest(".pseg").dataset.k, val = b.dataset.v;
        if (k2 === "fmt") o.print.fmt = val;
        if (k2 === "pages") o.print.pages = val;
        if (k2 === "dpi") o.print.dpi = Number(val);
        if (k2 === "wfmt") o.web.fmt = val;
        if (k2 === "range") o.range = val;
        fill();
        return;
      }
      const size = e.target.closest("[data-size]");
      if (size) {
        const id = size.dataset.size;
        o.web.sizes = o.web.sizes.includes(id) ? o.web.sizes.filter(x => x !== id) : [...o.web.sizes, id];
        o.web.sizes = WEB_PRESETS.map(p => p.id).filter(x => o.web.sizes.includes(x));
        fill();
        return;
      }
      if (e.target.closest("[data-proof]")) {
        const G1 = geo();
        const low = linksOf(S.sheets, G1).some(l => l.dpi < 300);
        o.print.proof = !(o.print.proof ?? low);
        fill();
        return;
      }
      if (e.target.closest(".go")) {
        const dir = (pop.querySelector(".edir") || {}).value || "";
        const idml = !web && o.print.fmt === "idml";
        if (idml) {
          P.vly_pkgdir = P.vly_pkgdir || {};
          if (dir.trim()) P.vly_pkgdir[P.vly_series] = dir.trim(); else delete P.vly_pkgdir[P.vly_series];
          closePop();
          packageAll(dir.trim(), true, cleanName(o.name[P.vly_series] || name));
          return;
        }
        if (web && !o.web.sizes.length) return;
        const key = web ? "web" : "print";
        if (dir.trim()) o.dir[`${P.vly_series}|${key}`] = dir.trim(); else delete o.dir[`${P.vly_series}|${key}`];
        closePop();
        const post = web ? postOf() : null;
        runExport(dir.trim(), cleanName(o.name[P.vly_series] || name), post);
      }
    });
    pop.addEventListener("input", (e) => {
      if (e.target.closest(".enm")) {
        const t = e.target.value.trim();
        if (t && t !== name) o.name[P.vly_series] = t; else delete o.name[P.vly_series];
      }
      if (e.target.closest(".edir")) {
        // what is typed stays when the format changes
        const t = e.target.value.trim();
        if (!web && o.print.fmt === "idml") {
          P.vly_pkgdir = P.vly_pkgdir || {};
          if (t) P.vly_pkgdir[P.vly_series] = t; else delete P.vly_pkgdir[P.vly_series];
        } else {
          const kk = `${P.vly_series}|${web ? "web" : "print"}`;
          if (t) o.dir[kk] = t; else delete o.dir[kk];
        }
      }
    });
    pop.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); closePop(); } });
    fill();
    if (web) postOf = mountPost(pop);
  }

  // ---- the words of a post
  /* A post for the film or the frames, put together from the book's own words
     - the title, the note, the captions, the cuts - in one of three shapes,
     with the hashtags chosen once. Nothing is written by AI. */
  const POST_TPLS = [
    { id: "short", label: "Short", hint: "The title, one caption and the hashtags - for Reels and Shorts" },
    { id: "story", label: "Story", hint: "The title, every caption in order, the cuts and the hashtags" },
    { id: "list", label: "List", hint: "The title, the series note and every cut with its caption - for a YouTube description" },
  ];
  function seriesTag(name) {
    const w = String(name || "").replace(/['’`]/g, "").split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    return w.length ? "#" + w.map(x => x[0].toUpperCase() + x.slice(1)).join("") : "";
  }
  function postOpts() {
    const o = expOpts();
    if (!o.post || typeof o.post !== "object") o.post = {};
    for (const [key, v] of Object.entries({ tpl: "story", save: true, auto: true })) if (o.post[key] === undefined) o.post[key] = v;
    if (!POST_TPLS.some(t => t.id === o.post.tpl)) o.post.tpl = "story";
    if (typeof P.vly_tags !== "string") P.vly_tags = "";
    return o.post;
  }
  function postText() {
    const book = S.book;
    if (!book) return "";
    const po = postOpts();
    const cuts = pickedCuts(book, view());
    const title = `${book.series}${book.no ? ` — Series ${book.no}` : ""}`;
    const caps = cuts.map(c => String(c.caption || "").trim()).filter(Boolean);
    const tags = [...new Set([...(po.auto ? [seriesTag(book.series)] : []),
      ...String(P.vly_tags || "").split(/[\s,]+/).filter(Boolean).map(t => (t.startsWith("#") ? t : "#" + t))])].filter(Boolean).join(" ");
    const parts = [title];
    if (po.tpl === "short") {
      if (caps[0]) parts.push(caps[0]);
    } else if (po.tpl === "story") {
      if (caps.length) parts.push(caps.join("\n"));
      if (cuts.length) parts.push(cuts.map(c => `${c.label || c.no} ${c.title}`).join(" · "));
    } else {
      const note = String(book.note || "").trim();
      if (note) parts.push(note);
      if (cuts.length) parts.push(cuts.map(c => `${c.label || c.no}  ${c.title}${c.caption ? ` — ${c.caption}` : ""}`).join("\n"));
    }
    if (tags) parts.push(tags);
    return parts.join("\n\n");
  }
  /* The post block of an export window; returns what to write, or null. */
  function mountPost(pop) {
    const po = postOpts();
    let draft = null;
    const box = document.createElement("div");
    box.className = "ex-post";
    const ft = pop.querySelector(".ft");
    ft.parentNode.insertBefore(box, ft);
    const fill = () => {
      box.innerHTML = `
        <div class="ph"><span class="lab">POST</span>
          <span class="ppseg">${POST_TPLS.map(t =>
            `<button class="${po.tpl === t.id ? "on" : ""}" data-pt="${t.id}" title="${esc(t.hint)}">${t.label}</button>`).join("")}</span>
          <label class="ck mini${po.auto ? " on" : ""}" data-pauto title="A hashtag made from the series title"><span class="bx"></span><span><b>${esc(seriesTag(S.book.series) || "#Series")}</b></span></label>
          <input class="ptags" spellcheck="false" placeholder="#editorial #portrait - hashtags for every post" value="${esc(P.vly_tags)}" />
          <span class="sp"></span>
          <button class="pbtn pcopy" title="Copy the post to paste it with the upload">Copy</button>
          <label class="ck mini${po.save ? " on" : ""}" data-psave title="Write it as a text file beside the export"><span class="bx"></span><span><b>Save as .txt</b></span></label></div>
        <textarea class="ptext" rows="7" spellcheck="false"></textarea>
        <span class="note2">Made from the book's own words - the title, the note, the captions and the cuts; nothing is written by AI. Edit it here before exporting.</span>`;
      box.querySelector(".ptext").value = draft != null ? draft : postText();
    };
    box.addEventListener("click", (e) => {
      e.stopPropagation();
      const pt = e.target.closest("[data-pt]");
      if (pt) { po.tpl = pt.dataset.pt; draft = null; fill(); return; }
      if (e.target.closest("[data-pauto]")) { e.preventDefault(); po.auto = !po.auto; draft = null; fill(); return; }
      if (e.target.closest("[data-psave]")) { e.preventDefault(); po.save = !po.save; fill(); return; }
      const cp = e.target.closest(".pcopy");
      if (cp) {
        const text = box.querySelector(".ptext").value;
        const done = () => { cp.textContent = "Copied"; setTimeout(() => { if (cp.isConnected) cp.textContent = "Copy"; }, 1400); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => { box.querySelector(".ptext").select(); });
        else { box.querySelector(".ptext").select(); document.execCommand("copy"); done(); }
      }
    });
    box.addEventListener("input", (e) => {
      e.stopPropagation();
      if (e.target.closest(".ptags")) {
        P.vly_tags = e.target.value;
        draft = null;
        box.querySelector(".ptext").value = postText();
      }
      if (e.target.closest(".ptext")) draft = e.target.value;
    });
    box.addEventListener("keydown", (e) => e.stopPropagation());
    fill();
    return () => (po.save ? box.querySelector(".ptext").value : null);
  }
  async function savePost(text, dir, name, kind) {
    if (!text || !S.book) return null;
    try {
      const r = await api.fetchApi(POST_URL, { method: "POST", body: JSON.stringify({ series: S.book.series, folder: dir, name, kind, text }) });
      const j = await r.json();
      return j.ok ? j.path : null;
    } catch (e) { return null; }
  }

  function cleanName(x) {
    return String(x || "").replace(/[<>:"/\\|?*\x00-\x1f]+/g, " ").replace(/\s+/g, " ").trim() || S.book.series;
  }

  async function runExport(dir, name, post) {
    if (S.exporting || !S.book) return;
    const o = expOpts();
    const web = P.vly_cat === "web";
    S.exporting = true;
    exportBtn.disabled = packBtn.disabled = true;
    const book = S.book;
    const v = view();
    const cur = S.cur;
    let written = 0, folders = new Set(), pdfPath = "", lastStem = "";
    try {
      await fontsFor(P.vly_font);
      await logoReady();
      const runs = web ? o.web.sizes.map(id => geometry("web", id, P.vly_font, P.vly_theme, P.vly_textpos, P.vly_size))
        : [geo()];
      for (const G of runs) {
        const all = buildSheets(book, v, G);
        const sheets = o.range === "this" ? [all[Math.min(cur, all.length - 1)]] : all;
        const low = !web && linksOf(all, G).some(l => l.dpi < 300);
        const proof = !web && (o.print.proof ?? low);
        const single = !web && o.print.pages === "single";
        const asPdf = !web && o.print.fmt === "pdf";
        const ext = web ? o.web.fmt : (o.print.fmt === "png" ? "png" : "jpg");
        const k = web ? G.exportK : o.print.dpi / 25.4;
        const kind = web ? "frame" : proof ? "proof" : single ? "page" : "spread";
        const token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
        let stem = null;
        const outs = sheets.length * (single ? 2 : 1);
        let n = 0;
        for (let i = 0; i < sheets.length; i++) {
          say(`Exporting ${web ? G.fmt.label + " - " : ""}${i + 1} of ${sheets.length}…`);
          const pics = await picsFor([sheets[i]], 0, true);
          const cv = document.createElement("canvas");
          cv.width = Math.round(G.sheetW * k);
          cv.height = Math.round(G.sheetH * k);
          const ctx = cv.getContext("2d");
          drawSheet(ctx, k, sheets[i], G, book, v, pics, false);
          if (proof) proofMark(ctx, k, G, i, sheets.length);
          const parts = [];
          if (single) {
            for (const side of [0, 1]) {
              const pc = document.createElement("canvas");
              pc.width = Math.round(G.pw * k);
              pc.height = cv.height;
              pc.getContext("2d").drawImage(cv, side * pc.width, 0, pc.width, pc.height, 0, 0, pc.width, pc.height);
              parts.push(pc);
            }
          } else {
            parts.push(cv);
          }
          for (const pc of parts) {
            n++;
            const data = asPdf || ext === "jpg" ? pc.toDataURL("image/jpeg", 0.95) : pc.toDataURL("image/png");
            let j;
            if (asPdf) {
              const r = await api.fetchApi(PDF_PAGE_URL, { method: "POST", body: JSON.stringify({ token, index: n, data }) });
              j = await r.json();
            } else {
              const r = await api.fetchApi(SAVE_URL, { method: "POST", body: JSON.stringify({ series: book.series, index: n, total: outs,
                data, ext, format: G.fmt.id, kind, folder: dir, name, stem }) });
              j = await r.json();
              if (j.folder) folders.add(j.folder);
              if (j.stem) stem = lastStem = j.stem;
            }
            if (!j.ok) throw new Error(j.error || "a page could not be written");
            written++;
            if (pc !== cv) pc.width = pc.height = 0;
          }
          cv.width = cv.height = 0;
        }
        if (asPdf) {
          say("Writing the PDF…");
          const r = await api.fetchApi(PDF_DONE_URL, { method: "POST", body: JSON.stringify({ token, series: book.series,
            format: G.fmt.id, folder: dir, name: `${name}${proof ? " - proof" : ""}`,
            page: [single ? G.pw : G.sheetW, G.ph] }) });
          const j = await r.json();
          if (!j.ok) throw new Error(j.error || "the PDF could not be written");
          pdfPath = j.path;
        }
      }
      const pp = post ? await savePost(post, dir, name, "web") : null;
      say((pdfPath ? `PDF written: ${pdfPath}` : `${written} file${written === 1 ? "" : "s"} written as ${lastStem || name} to ${[...folders].join(" \u00b7 ")}`)
        + (pp ? ` \u00b7 the post: ${pp.split(/[\\/]/).pop()}` : ""));
    } catch (e) {
      say(`Export stopped: ${e && e.message || e}`, true);
    } finally {
      S.exporting = false;
      exportBtn.disabled = packBtn.disabled = false;
    }
  }

  // ---- events
  root.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button, select, img, textarea, input, .vly-mini, .vly-cut, .vly-full, .vly-coverpick")) e.stopPropagation();
  });
  /* ComfyUI keeps its own undo of the whole workflow on Ctrl+Z, read on the
     page before any node hears the key - and it leaves the key alone while a
     text field has the focus. So while the pointer is over the node an
     unseen field holds the focus: Ctrl+Z is then the layout's own, and the
     workflow is not reloaded under it. A real field being typed in keeps
     its focus. */
  const sink = document.createElement("textarea");
  sink.className = "vly-sink";
  sink.tabIndex = -1;
  sink.setAttribute("aria-hidden", "true");
  sink.style.cssText = "position:absolute;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none;resize:none;border:0;padding:0;margin:0;overflow:hidden";
  root.appendChild(sink);
  sink.addEventListener("input", () => { sink.value = ""; });
  const holdKeys = () => {
    const a = document.activeElement;
    const free = !a || a === document.body || a === sink || a.tagName === "CANVAS"
      || (root.contains(a) && a.tagName === "BUTTON");
    if (free && S.hovered && !S.dead && root.isConnected && a !== sink) {
      try { sink.focus({ preventScroll: true }); } catch (e) { /* not focusable now */ }
    }
  };
  root.addEventListener("mouseenter", () => { S.hovered = true; holdKeys(); });
  root.addEventListener("mouseleave", () => {
    S.hovered = false;
    if (document.activeElement === sink) sink.blur();
  });
  // a button pressed takes the focus; give it back once the click is done
  root.addEventListener("click", () => setTimeout(holdKeys, 0));
  // ---- motion
  /* The film of the series: played here with its music, recorded at each
     size asked for and written to a folder. */
  const MZ = { t: 0, playing: false, ac: null, src: null, raf: 0, t0: 0, shots: [], cur: 0,
    pics: new Map(), want: null, bufs: new Map(), recording: false, swapOpen: false };
  const musicBox = $(".vly-music");
  function isMotion() { return P.vly_cat === "motion"; }
  /* Music player: the node shows only the music list and its player. */
  function isPlayer() { return !!P.vly_player; }
  function musicLive() { return isMotion() || isPlayer(); }
  function mstate() { return motionDefaults(state()); }
  function audioCtx() {
    if (!MZ.ac || MZ.ac.state === "closed") MZ.ac = new (window.AudioContext || window.webkitAudioContext)();
    return MZ.ac;
  }
  async function musicBuffer(name) {
    if (!name) return null;
    if (MZ.bufs.has(name)) return MZ.bufs.get(name);
    const p = (async () => {
      try {
        const r = await fetch(`${api.apiURL(MUSIC_URL)}?name=${encodeURIComponent(name)}`);
        if (!r.ok) return null;
        return await audioCtx().decodeAudioData(await r.arrayBuffer());
      } catch (e) { return null; }
    })();
    MZ.bufs.set(name, p);
    const b = await p;
    if (!b) MZ.bufs.delete(name);
    return b;
  }
  function shotAt(t) {
    let i = 0;
    MZ.shots.forEach((s, j) => { if (t >= s.start) i = j; });
    return i;
  }
  function restT(s) { return s.start + Math.min(1.6, s.dur * 0.45); }
  async function motionPics(shots, side, linked) {
    const map = new Map();
    await Promise.all(shots.filter(s => s.pick).map(async (s) => {
      const p = s.pick;
      let im = null;
      if (linked && p.hd) im = await linkedPicture(p.hd.path, side);
      map.set(String(p.id), im || await picture(p.id, side));
    }));
    return map;
  }

  function paintMotion(book, G, v) {
    // a repaint is other work: the picture panel closes, but for a swap made in it
    if (MZ.swapKeep) MZ.swapKeep = false; else MZ.swapOpen = false;
    MZ.shots = motionShots(book, v, G);
    if (MZ.want != null) {
      const i = MZ.shots.findIndex(s => s.cut && s.cut.no === MZ.want);
      if (i >= 0) { MZ.cur = i; MZ.t = restT(MZ.shots[i]); }
      MZ.want = null;
    }
    MZ.cur = Math.max(0, Math.min(MZ.cur, MZ.shots.length - 1));
    if (!MZ.playing && MZ.t > motionLength(MZ.shots)) MZ.t = MZ.shots[MZ.cur] ? restT(MZ.shots[MZ.cur]) : 0;
    extraBox.style.display = "none";
    musicBox.style.display = "";
    // the title shot is the cover: its picture is chosen here, as on the
    // opener, in a panel that opens and closes
    paintPicker(v);
    const sh0 = MZ.shots[MZ.cur];
    canvas.classList.toggle("frameable", !!(sh0 && sh0.pick));
    paintCuts(book, v);
    markCut();
    paintMotionTools();
    paintMotionStage();
    paintShots(G);
    paintMusic();
  }
  function markCut() {
    const s = MZ.shots[MZ.cur];
    cutsBox.querySelectorAll(".vly-cut").forEach(el => el.classList.toggle("cur", !!(s && s.cut && el.dataset.no === s.cut.no)));
  }

  function paintMotionTools() {
    const s = MZ.shots[MZ.cur];
    const total = motionLength(MZ.shots);
    let html = `<div class="vly-player">
      <button class="vly-play" title="Play the film with its music (Space)">${MZ.playing ? "❚❚" : "▶"}</button>
      <span class="tm"><input class="tmi" spellcheck="false" value="${tc(MZ.t)}" title="Type a moment - 0:12:15, 0:12 or 12.5 - and Enter to go there" /> / ${tc(total)}</span>
      <input class="scrub" type="range" min="0" max="${total.toFixed(2)}" step="0.05" value="${Math.min(MZ.t, total).toFixed(2)}" />
      <span class="nshots">${MZ.shots.length} shots</span></div>`;
    if (s) {
      const name = s.kind === "title" ? "Title" : s.kind === "end" ? "Closing" : `${s.cut.label || s.cut.no} ${s.cut.title}`;
      const many = selIds().length;
      html += `<div class="vly-shotrow"><span class="nm"><b>${String(MZ.cur + 1).padStart(2, "0")}</b>${esc(name)}${many > 1 ? ` <em>+ ${many - 1} more</em>` : ""}</span>`;
      if (s.kind === "title") {
        html += `<button class="vly-flip mcover${MZ.coverOpen ? " on" : ""}" title="Choose the picture of the title - open and close the cover picker">Cover ${MZ.coverOpen ? "\u25b4" : "\u25be"}</button>`;
      }
      if (s.kind === "pick" && cutScene(s).picks.length > 1) {
        const open = swapOpen(s);
        html += `<button class="mswap${open ? " on" : ""}" title="Swap this shot's picture for another pick of the same cut - its length, move and caption stay">Picture <i>${open ? "\u25b4" : "\u25be"}</i></button>`;
      }
      if (s.kind !== "end") {
        html += `<span class="lab2">MOVE</span><span class="vly-tseg mv">` + MOVES.map(m =>
          `<button class="${s.moveSet === m.id ? "on" : ""}" data-mv="${m.id}" title="${esc(m.hint)}">${m.label}</button>`).join("") + `</span>`;
      }
      html += `<span class="vly-vsep"></span><span class="lab2">LENGTH</span><span class="vly-tseg ln">` + LENGTHS.map(n =>
        `<button class="${s.dur === n ? "on" : ""}" data-ln="${n}" title="${n} seconds">${n}s</button>`).join("") + `</span>`
        + `<span class="lnum"><input type="number" min="1" max="20" step="0.1" value="${+s.dur.toFixed(2)}" title="Any length from 1 to 20 seconds - Enter to set" /><i>s</i></span>`;
      if (MZ.cur < MZ.shots.length - 1) {
        html += `<span class="vly-vsep"></span><span class="lab2">TO NEXT</span><span class="vly-tseg ps">` + PASSES.map(p =>
          `<button class="${s.pass === p.id ? "on" : ""}" data-ps="${p.id}" title="${esc(p.hint)}">${p.label}</button>`).join("") + `</span>`;
      }
      if (s.kind === "pick") {
        html += `<span class="vly-vsep"></span><span class="lab2">CAPTION</span><span class="vly-tseg cp">`
          + `<button class="${s.cap ? "on" : ""}" data-cap="1" title="The cut's number, title and caption on the picture">On</button>`
          + `<button class="${s.cap ? "" : "on"}" data-cap="0" title="The picture alone">Off</button></span>`;
        if (s.cap) {
          const nm = { t: "top", m: "middle", b: "bottom", l: "left", c: "centre", r: "right" };
          html += `<span class="vly-pos9" title="Where the caption sits">` + CAP_POS.map(p =>
            `<button class="${s.cpos === p ? "on" : ""}" data-cpos="${p}" title="${nm[p[0]]}, ${nm[p[1]]}"><i></i></button>`).join("") + `</span>`;
        }
      }
      if (s.pick) {
        html += `<span class="mhint">Drag the picture to frame it · double-click to centre it</span>`;
      }
      html += `</div>`;
    }
    tools.innerHTML = html;
  }
  function paintTime() {
    moveHead();
    const total = motionLength(MZ.shots);
    const tm = tools.querySelector(".tmi");
    if (tm && document.activeElement !== tm) tm.value = tc(MZ.t);
    const sc = tools.querySelector(".scrub");
    if (sc && document.activeElement !== sc) sc.value = Math.min(MZ.t, total).toFixed(2);
    const pb = tools.querySelector(".vly-play");
    if (pb) pb.textContent = MZ.playing ? "❚❚" : "▶";
  }

  let mstageTicket = 0;
  function stageScale(G) {
    const maxW = Math.max(200, desk.clientWidth - 118);
    const maxH = stageMaxH(maxW);
    return Math.min(maxW / G.pw, maxH / G.ph);
  }
  function drawStageNow() {
    const G = geo();
    const scale = stageScale(G), dpr = window.devicePixelRatio || 1, k = scale * dpr;
    const w = Math.round(G.pw * k), h = Math.round(G.ph * k);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    canvas.style.width = `${G.pw * scale}px`;
    canvas.style.height = `${G.ph * scale}px`;
    drawMotion(canvas.getContext("2d"), k, G, S.book, MZ.shots, MZ.t, MZ.pics);
  }
  async function paintMotionStage() {
    navL.disabled = MZ.cur <= 0;
    navR.disabled = MZ.cur >= MZ.shots.length - 1;
    count.textContent = MZ.shots.length ? `${MZ.cur + 1} / ${MZ.shots.length}` : "";
    const t = ++mstageTicket;
    drawStageNow();
    await fontsFor(P.vly_font);
    const side = desk.clientWidth * (window.devicePixelRatio || 1) > 1000 ? 1600 : 800;
    const pics = await motionPics(MZ.shots, side);
    if (t !== mstageTicket) return;
    MZ.pics = pics;
    drawStageNow();
    fitNode();
  }

  /* SHOTS as a timeline: each shot as wide as the time it is on screen, the
     music's waveform under them on the same scale, a playhead across both.
     Drag a shot's right edge to change its length; click to choose it, with
     Ctrl or Shift to choose several and set them together. */
  let shotsTicket = 0;
  let TL = { pps: 24, total: 0 };
  const TL_H = 58, WAVE_H = 48;
  function selIds() {
    const cur = MZ.shots[MZ.cur];
    // several chosen only while the shot on show is one of them
    if (!MZ.sel || MZ.sel.size < 2 || !cur || !MZ.sel.has(cur.id)) return cur ? [cur.id] : [];
    return MZ.shots.filter(s => MZ.sel.has(s.id)).map(s => s.id);
  }
  function cellW(i) {
    const s = MZ.shots[i], next = MZ.shots[i + 1];
    return ((next ? next.start : s.start + s.dur) - s.start) * TL.pps;
  }
  async function paintShots(G) {
    const ticket = ++shotsTicket;
    const m = mstate();
    const removed = Object.keys(m.off).length;
    const total = motionLength(MZ.shots);
    TL.total = total;
    TL.room = strip.clientWidth;
    const room = Math.max(300, strip.clientWidth - 8);
    // the whole film fits the width at 1x; + and - (or Alt + the wheel) zoom in
    TL.zoom = Math.max(1, Math.min(12, Number(P.vly_tlzoom) || 1));
    TL.pps = Math.max(6, room / Math.max(1, total)) * TL.zoom;
    const nsel = selIds().length;
    stripH.innerHTML = `SHOTS <b>${MZ.shots.length}</b> <span class="mlen">${clock(total)}</span>`
      + (nsel > 1 ? `<span class="msel">${nsel} chosen · set together</span>` : "")
      + (removed ? `<button class="vly-mrestore" title="Bring back every shot taken out">${removed} removed · Restore</button>` : "")
      + `<span class="hint">Ctrl or Shift + click to choose several · drag a shot's edge for its length, Shift + drag to move only that cut · Alt + wheel to zoom</span>`
      + `<span class="mkbar"></span>`
      + `<span class="tlz"><button data-z="-" title="Zoom out (Alt + wheel)">\u2212</button><span>${TL.zoom === 1 ? "Fit" : TL.zoom.toFixed(1).replace(/\.0$/, "") + "\u00d7"}</span><button data-z="+" title="Zoom in (Alt + wheel)">+</button></span>`;
    strip.classList.add("tl");
    const W = Math.ceil(total * TL.pps);
    strip.innerHTML = `<div class="vly-tl" style="width:${W}px">
      <div class="tl-row">${MZ.shots.map((s, i) => {
        const lab = s.kind === "title" ? "Title" : s.kind === "end" ? "Closing"
          : `${s.cut.label || s.cut.no}${s.cut.picks.length > 1 ? "·" + (s.cut.picks.indexOf(s.pick) + 1) : ""}`;
        const sel = MZ.sel && MZ.sel.has(s.id);
        return `<div class="vly-mshot${i === MZ.cur ? " cur" : ""}${sel ? " sel" : ""}" data-s="${i}" style="width:${cellW(i).toFixed(1)}px" title="${esc(lab)} · ${s.dur}s">
          <div class="film"><canvas></canvas></div>
          <span class="lb"><b>${String(i + 1).padStart(2, "0")}</b>${esc(lab)} <i>${+s.dur.toFixed(1)}s</i></span>
          ${moveMark(s)}
          <button class="mdel" data-id="${esc(s.id)}" title="Take this shot out of the film">×</button>
          ${MZ.shots[i + 1] ? `<span class="pass p-${s.pass}" title="To next: ${s.pass === "fade" ? "Fade" : s.pass === "black" ? "Black" : "Cut"}"></span>` : ""}
          <span class="edge" data-edge="${i}" title="Drag for the length of this shot - it snaps to the playhead"></span><span class="etip"></span></div>`;
      }).join("")}</div>
      <canvas class="tl-wave" style="width:${W}px;height:${WAVE_H}px"></canvas>
      <div class="tl-head" style="left:${(MZ.t * TL.pps).toFixed(1)}px"><span class="tip">${tc(MZ.t)}</span></div></div>`;
    paintWave();
    paintMarkers();
    const draw = (pics) => {
      if (ticket !== shotsTicket) return;
      const dpr = window.devicePixelRatio || 1;
      // one frame at the head of each shot, the rest of it left empty - as
      // a timeline shows a clip; a shot narrower than its frame shows part
      const fw = (TL_H * G.pw) / G.ph;
      strip.querySelectorAll(".vly-mshot").forEach((cell, i) => {
        const s = MZ.shots[i];
        const cv = cell.querySelector("canvas");
        const w = Math.max(4, Math.min(fw, cell.clientWidth - 2)), h = TL_H;
        cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
        cv.style.width = `${w}px`; cv.style.height = `${h}px`;
        const ctx = cv.getContext("2d");
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, cv.width, cv.height);
        const k = Math.max((w * dpr) / G.pw, (h * dpr) / G.ph);
        ctx.save();
        ctx.translate((w * dpr - G.pw * k) / 2, (h * dpr - G.ph * k) / 2);
        drawShot(ctx, k, G, S.book, s, Math.min(1.6, s.dur * 0.45), pics);
        ctx.restore();
      });
    };
    draw(TL.pics || new Map());
    await fontsFor(P.vly_font);
    TL.pics = await motionPics(MZ.shots, 400);
    draw(TL.pics);
  }

  /* The music over the film: its loudness, pixel by pixel on the timeline's
     scale - where it loops, where it fades, where it has ended. Read every
     2.5 ms, as the peak and as the body (RMS) of the sound. */
  const PEAK_HZ = 400;
  const peakCache = new Map();
  function peaksOf(buf) {
    if (peakCache.has(buf)) return peakCache.get(buf);
    const step = Math.max(1, Math.round(buf.sampleRate / PEAK_HZ));
    const n = Math.ceil(buf.length / step);
    const pk = new Float32Array(n), rms = new Float32Array(n);
    const chans = [];
    for (let c = 0; c < Math.min(2, buf.numberOfChannels); c++) chans.push(buf.getChannelData(c));
    for (let i = 0; i < n; i++) {
      let mx = 0, sq = 0, k = 0;
      const a = i * step, b = Math.min(buf.length, a + step);
      for (const d of chans) for (let j = a; j < b; j += 2) { const v = Math.abs(d[j]); if (v > mx) mx = v; sq += v * v; k++; }
      pk[i] = mx;
      rms[i] = k ? Math.sqrt(sq / k) : 0;
    }
    const out = { pk, rms };
    peakCache.set(buf, out);
    return out;
  }
  async function paintWave() {
    const cv = strip.querySelector(".tl-wave");
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const W = Math.ceil(TL.total * TL.pps);
    cv.width = Math.round(W * dpr); cv.height = Math.round(WAVE_H * dpr);
    const ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, cv.width, cv.height);
    const mu = mstate().music;
    const mid = cv.height / 2;
    ctx.fillStyle = "#1a1c20";
    ctx.fillRect(0, mid - 0.5 * dpr, cv.width, 1 * dpr);
    if (!mu.name) return;
    const buf = await musicBuffer(mu.name);
    if (!buf || !cv.isConnected) return;
    const { pk, rms } = peaksOf(buf);
    let top = 0;
    for (let i = 0; i < pk.length; i++) if (pk[i] > top) top = pk[i];
    top = top || 1;
    // a curve that keeps the hits tall and lets the steady part sit lower,
    // so the accents stand out of the mass of the sound
    const shape = (v) => Math.pow(Math.min(1, v / top), 1.7);
    const total = TL.total, fade = Math.min(mu.fade, Math.max(0.5, total - 0.5));
    const span = buf.duration - mu.start;
    for (let x = 0; x < cv.width; x++) {
      const t0 = (x / dpr) / TL.pps, t1 = ((x + 1) / dpr) / TL.pps;
      let a = mu.start + t0, b = mu.start + t1;
      if (a >= buf.duration) {
        if (!mu.loop || span <= 0.5) continue;
        a = mu.start + ((t0) % span); b = a + (t1 - t0);
      }
      let mx = 0, body = 0, k = 0;
      const i0 = Math.floor(a * PEAK_HZ), i1 = Math.min(pk.length - 1, Math.max(i0, Math.ceil(b * PEAK_HZ) - 1));
      for (let i = i0; i <= i1; i++) { if (pk[i] > mx) mx = pk[i]; body += rms[i]; k++; }
      body = k ? body / k : 0;
      // the level the film gives it: full, then down over the fade
      const fading = t0 > total - fade;
      const lvl = mu.vol * (fading ? Math.max(0, (total - t0) / fade) : 1);
      const room = mid - 1 * dpr;
      const h = Math.max(0.5 * dpr, shape(mx) * lvl * room);
      const hb = Math.min(h, shape(body * 1.6) * lvl * room);
      ctx.fillStyle = fading ? "#6b5c3c" : "#a8853f";
      ctx.fillRect(x, mid - h, 1, h * 2);
      ctx.fillStyle = fading ? "#9a8458" : "#efce7f";
      if (hb > 0) ctx.fillRect(x, mid - hb, 1, hb * 2);
    }
  }
  /* Markers: moments of the music worth cutting on - set by ear with M while
     it plays, or found in the music by its accents - shown on the waveform;
     a shot's end snaps to them as to the playhead. They are kept with the
     piece of music, in its own time, so they move with START AT. */
  function markerTimes() {
    const mu = mstate().music;
    if (!mu.name) return [];
    const list = (mstate().markers || {})[mu.name] || [];
    const total = motionLength(MZ.shots), out = [];
    const span = (mu.len || 0) - mu.start;
    for (const mt of list) {
      let t = mt - mu.start;
      if (t < 0) { if (!mu.loop || span <= 0.5) continue; t += Math.ceil(-t / span) * span; }
      out.push({ t, mt });
      if (mu.loop && span > 0.5) for (let k = 1; t + k * span <= total; k++) out.push({ t: t + k * span, mt });
    }
    return out.filter(m => m.t >= 0 && m.t <= total).sort((a, b) => a.t - b.t);
  }
  function markerList() {
    const m = mstate(), mu = m.music;
    m.markers = m.markers && typeof m.markers === "object" ? m.markers : {};
    return mu.name ? (m.markers[mu.name] = m.markers[mu.name] || []) : null;
  }
  function addMarker(t) {
    const list = markerList();
    if (!list) { say("Choose a piece of music first - markers belong to the music.", true); return; }
    const mu = mstate().music;
    let mt = mu.start + t;
    if (mu.loop && mu.len && mt >= mu.len) mt = mu.start + ((t) % (mu.len - mu.start));
    mt = Math.round(mt * MOTION_FPS) / MOTION_FPS;                    // on a frame
    if (list.some(x => Math.abs(x - mt) < 0.1)) return;
    list.push(mt);
    list.sort((a, b) => a - b);
    paintMarkers();
    paintMusic();
  }
  function paintMarkerBar() {
    const bar = stripH.querySelector(".mkbar");
    if (!bar) return;
    const mu = mstate().music;
    if (!mu.name) { bar.innerHTML = ""; return; }
    const n = ((mstate().markers || {})[mu.name] || []).length;
    // the count is of the markers in the film; the piece may hold more,
    // set elsewhere in it, which come back when START AT reaches them
    const inFilm = new Set(markerTimes().map(m => m.mt)).size;
    const sv = (d) => `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
    const IC = {
      add: sv('<path d="M3 2h5L5.5 5.2z" fill="currentColor"/><path d="M5.5 5.2v9.3"/><path d="M11.5 7.5v6M8.5 10.5h6"/>'),
      find: sv('<path d="M1.5 9h1.5l1-3 1.5 6 1.5-8 1.5 5h1"/><circle cx="12" cy="10.5" r="2.3"/><path d="M13.7 12.2l1.6 1.6"/>'),
      fit: sv('<path d="M4 2.5v5a4 4 0 0 0 8 0v-5"/><path d="M4 2.5h2.4v5M12 2.5H9.6v5"/><path d="M8 14.5v-1"/>'),
      undo: sv('<path d="M5 4.5 2.5 7 5 9.5"/><path d="M2.5 7h7a4 4 0 0 1 0 8H7"/>'),
      keep: sv('<path d="M2 3h12L9.5 8.5v4.5l-3 1.5v-6z"/>'),
      clear: sv('<path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4M6.8 6.5v5M9.2 6.5v5"/>'),
    };
    bar.innerHTML = `<span class="mkl" title="${inFilm} in the film${n > inFilm ? ` - ${n} in the whole piece, the rest outside the part the film uses` : ""}">MARKERS <b>${inFilm}</b>${n > inFilm ? `<i>/ ${n}</i>` : ""}</span>
      <button class="mkb ic mk-add" title="Add a marker at the playhead - M, even while it plays">${IC.add}</button>
      <button class="mkb ic mk-auto" title="Find accents - markers where the music rises sharply. Plain analysis of the sound, no AI">${IC.find}</button>
      ${inFilm ? `<button class="mkb ic mk-fit" title="Fit cuts - every cut onto the marker nearest it; the shots after it move along">${IC.fit}</button>` : ""}
      ${MZ.fitUndo ? `<button class="mkb ic mk-undo" title="Undo fit - the lengths of the shots as they were">${IC.undo}</button>` : ""}
      ${inFilm ? `<button class="mkb ic mk-keep" title="Keep on cuts - take away the markers no cut sits on; those outside the part the film uses stay">${IC.keep}</button>` : ""}
      ${n ? `<button class="mkb ic mk-clear" title="Clear - every marker of this music, press twice">${IC.clear}</button>` : ""}`;
  }
  function paintMarkers() {
    paintMarkerBar();
    const tl = strip.querySelector(".vly-tl");
    if (!tl) return;
    tl.querySelectorAll(".tl-mk").forEach(el => el.remove());
    const html = markerTimes().map(m =>
      `<span class="tl-mk" data-mt="${m.mt}" style="left:${(m.t * TL.pps).toFixed(1)}px" title="${tc(m.t)} - click to go there, Alt+click to delete"></span>`).join("");
    tl.insertAdjacentHTML("beforeend", html);
  }
  /* The accents of a piece: where its loudness rises sharply over what came
     just before - an onset - kept when strong against the passage around it,
     and at least a second apart. Plain arithmetic on the sound, no model. */
  function findAccents(buf, from, to) {
    const rate = buf.sampleRate, hop = Math.round(rate / 100);           // 10 ms
    const a = Math.floor(from * rate), b = Math.min(buf.length, Math.ceil(to * rate));
    const ch = [];
    for (let c = 0; c < Math.min(2, buf.numberOfChannels); c++) ch.push(buf.getChannelData(c));
    const n = Math.floor((b - a) / hop);
    const e = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let sum = 0;
      const s0 = a + i * hop;
      for (const d of ch) for (let j = s0; j < s0 + hop; j += 2) sum += d[j] * d[j];
      e[i] = Math.sqrt(sum / (hop / 2 * ch.length));
    }
    // the rise of loudness over the 120 ms before
    const flux = new Float32Array(n);
    for (let i = 12; i < n; i++) {
      let prev = 0;
      for (let j = i - 12; j < i; j++) prev += e[j];
      prev /= 12;
      flux[i] = Math.max(0, Math.log10(1e-4 + e[i]) - Math.log10(1e-4 + prev));
    }
    // strong against the 3 s around it
    const cands = [];
    for (let i = 1; i < n - 1; i++) {
      if (flux[i] <= flux[i - 1] || flux[i] < flux[i + 1]) continue;
      let m = 0, q = 0, c = 0;
      for (let j = Math.max(0, i - 150); j < Math.min(n, i + 150); j++) { m += flux[j]; q += flux[j] * flux[j]; c++; }
      m /= c;
      const sd = Math.sqrt(Math.max(0, q / c - m * m));
      if (flux[i] > m + 2.2 * sd && flux[i] > 0.12) cands.push({ t: from + i / 100, v: flux[i] });
    }
    cands.sort((x, y) => y.v - x.v);
    const keep = [];
    for (const c of cands) if (keep.every(k => Math.abs(k.t - c.t) >= 1)) keep.push(c);
    return keep.map(k => Math.round(k.t * MOTION_FPS) / MOTION_FPS).sort((x, y) => x - y);
  }
  /* Every cut on the nearest marker: shot by shot from the start, the moment
     the next shot takes over moves to the marker nearest it - if one is near
     enough, a third of the shot's length or a second - and the shots after it
     move along. Each marker takes one cut. The lengths before are kept, so
     it can be undone. */
  function fitToMarkers() {
    const marks = markerTimes().map(m => m.t);
    if (!marks.length) { say("No markers in the film - Find accents, or press M while it plays.", true); return; }
    const m = mstate();
    const before = {};
    for (const s of MZ.shots) before[s.id] = m.set[s.id] && m.set[s.id].dur != null ? m.set[s.id].dur : null;
    const used = new Set();
    let moved = 0, start = 0, lastCut = 0;
    const shots = MZ.shots;
    for (let i = 0; i < shots.length; i++) {
      const s = shots[i], next = shots[i + 1];
      let dur = s.dur;
      if (next) {
        const over = s.pass === "fade" ? FADE_S : 0;
        const cut = start + dur - over;                          // where the next shot takes over
        const tol = Math.max(1, dur * 0.34);
        let best = null;
        for (const t of marks) {
          if (used.has(t) || t <= lastCut + 0.99) continue;
          const d = t - start + over;
          if (d < 1 || d > 20 || Math.abs(t - cut) > tol) continue;
          if (best == null || Math.abs(t - cut) < Math.abs(best - cut)) best = t;
        }
        if (best != null) {
          used.add(best);
          const d = Math.round((best - start + over) * 100) / 100;
          if (Math.abs(d - dur) > 0.005) {
            (m.set[s.id] || (m.set[s.id] = {})).dur = d;
            dur = d;
            moved++;
          }
        }
        lastCut = start + dur - over;
        start += dur - over;
      }
    }
    MZ.fitUndo = before;
    say(moved ? `${moved} cut${moved === 1 ? "" : "s"} moved onto the markers - Undo fit puts the lengths back` : "Every cut is on a marker already, or none is near enough.");
    paint();
  }
  /* Markers that no cut sits on, in the film, are taken away - those set
     outside the part the film uses stay. */
  function keepOnCuts() {
    const list = markerList();
    if (!list || !list.length) return;
    const cuts = [];
    MZ.shots.forEach((s, i) => { if (MZ.shots[i + 1]) cuts.push(MZ.shots[i + 1].start); });
    const marks = markerTimes();
    const onCut = new Set(), inFilm = new Set();
    for (const m of marks) {
      inFilm.add(m.mt);
      if (cuts.some(c => Math.abs(c - m.t) < 1.5 / MOTION_FPS)) onCut.add(m.mt);
    }
    let gone = 0;
    for (let i = list.length - 1; i >= 0; i--) {
      if (inFilm.has(list[i]) && !onCut.has(list[i])) { list.splice(i, 1); gone++; }
    }
    say(gone ? `${gone} marker${gone === 1 ? "" : "s"} with no cut on ${gone === 1 ? "it" : "them"} taken away` : "Every marker in the film has a cut on it.");
    paintMarkers();
    paintMusic();
  }
  function undoFit() {
    const before = MZ.fitUndo;
    if (!before) return;
    const m = mstate();
    for (const [id, d] of Object.entries(before)) {
      if (!m.set[id]) continue;
      if (d == null) delete m.set[id].dur; else m.set[id].dur = d;
    }
    MZ.fitUndo = null;
    say("The lengths are back as they were.");
    paint();
  }

  async function autoMarkers() {
    const mu = mstate().music;
    const list = markerList();
    if (!list) return;
    const buf = await musicBuffer(mu.name);
    if (!buf) return;
    const total = motionLength(MZ.shots);
    // only the part of the music the film uses - from START AT, as long as the
    // film runs (a loop runs over that same part again)
    const to = Math.min(buf.duration, mu.start + total);
    const found = findAccents(buf, mu.start, to);
    let added = 0;
    for (const t of found) if (!list.some(x => Math.abs(x - t) < 0.3)) { list.push(t); added++; }
    list.sort((a, b) => a - b);
    say(added ? `${added} accent${added === 1 ? "" : "s"} found in the music - Alt+click a marker to delete it` : "No clear accent found in this part of the music.");
    paintMarkers();
    paintMusic();
  }

  function moveHead() {
    const hd = strip.querySelector(".tl-head");
    if (!hd) return;
    hd.style.left = `${(MZ.t * TL.pps).toFixed(1)}px`;
    const tip = hd.querySelector(".tip");
    if (tip) tip.textContent = tc(MZ.t);
  }

  function zoomTL(f, anchorX) {
    const before = TL.pps;
    const z = Math.max(1, Math.min(12, (Number(P.vly_tlzoom) || 1) * f));
    if (z === (Number(P.vly_tlzoom) || 1)) return;
    const ax = anchorX == null ? strip.clientWidth / 2 : anchorX;
    const t = (strip.scrollLeft + ax) / before;          // the moment under the pointer stays there
    P.vly_tlzoom = Math.round(z * 100) / 100;
    paintShots(geo());
    strip.scrollLeft = Math.max(0, t * TL.pps - ax);
  }
  stripH.addEventListener("click", (e) => {
    if (!isMotion()) return;
    const z = e.target.closest("[data-z]");
    if (z) { zoomTL(z.dataset.z === "+" ? 1.5 : 1 / 1.5); return; }
    if (e.target.closest(".mk-add")) { addMarker(MZ.t); return; }
    if (e.target.closest(".mk-auto")) { autoMarkers(); return; }
    if (e.target.closest(".mk-fit")) { mpause(); fitToMarkers(); return; }
    if (e.target.closest(".mk-undo")) { mpause(); undoFit(); return; }
    if (e.target.closest(".mk-keep")) { keepOnCuts(); return; }
    const clr = e.target.closest(".mk-clear");
    if (clr) {
      if (!clr.classList.contains("armed")) {
        clr.classList.add("armed");
        clr.title = "Press again to clear every marker";
        setTimeout(() => { if (clr.isConnected) { clr.classList.remove("armed"); clr.title = "Clear - every marker of this music, press twice"; } }, 4000);
        return;
      }
      const list = markerList();
      if (list) list.length = 0;
      paintMarkers();
      paintMarkerBar();
    }
  });
  strip.addEventListener("wheel", (e) => {
    if (!isMotion() || !e.altKey) return;
    e.preventDefault();
    e.stopPropagation();
    const r = strip.getBoundingClientRect();
    const zoom = r.width / (strip.offsetWidth || r.width);
    zoomTL(e.deltaY < 0 ? 1.2 : 1 / 1.2, (e.clientX - r.left) / zoom);
  }, { passive: false, capture: true });

  /* The playhead: drag it - or drag along the waveform - and the screen
     above follows, frame by frame. */
  let scrub = null;
  function scrubTo(clientX) {
    const tl = strip.querySelector(".vly-tl");
    if (!tl) return;
    const r = tl.getBoundingClientRect();
    const zoom = r.width / (tl.offsetWidth || r.width);
    MZ.t = Math.max(0, Math.min(TL.total, ((clientX - r.left) / zoom) / TL.pps));
    // the playhead snaps to a marker near it
    let near = null, best = 7;
    for (const m of markerTimes()) { const px = Math.abs(m.t - MZ.t) * TL.pps; if (px < best) { best = px; near = m.t; } }
    strip.querySelectorAll(".tl-mk.snap").forEach(el => el.classList.remove("snap"));
    if (near != null) {
      MZ.t = near;
      const mk = [...strip.querySelectorAll(".tl-mk")].find(el => Math.abs(parseFloat(el.style.left) - near * TL.pps) < 1);
      if (mk) mk.classList.add("snap");
    }
    const i = shotAt(MZ.t);
    if (i !== MZ.cur) {
      MZ.cur = i;
      strip.querySelectorAll(".vly-mshot").forEach((el, j) => el.classList.toggle("cur", j === i));
      markCut();
      count.textContent = `${MZ.cur + 1} / ${MZ.shots.length}`;
      scrub.moved = true;
    }
    drawStageNow();
    paintTime();
  }
  strip.addEventListener("pointerdown", (e) => {
    if (!isMotion() || e.button !== 0) return;
    if (!e.target.closest(".tl-head") && !e.target.closest(".tl-wave")) return;
    e.preventDefault();
    e.stopPropagation();
    mpause();
    scrub = { moved: false };
    e.target.setPointerCapture(e.pointerId);
    strip.classList.add("scrubbing");
    scrubTo(e.clientX);
  }, true);
  strip.addEventListener("pointermove", (e) => { if (scrub) scrubTo(e.clientX); });
  const endScrub = () => {
    if (!scrub) return;
    const moved = scrub.moved;
    scrub = null;
    strip.classList.remove("scrubbing");
    strip.querySelectorAll(".tl-mk.snap").forEach(el => el.classList.remove("snap"));
    // the tools follow the shot the playhead stopped on
    paintMotionTools();
    if (moved) {
      paintPicker(view());
    }
  };
  strip.addEventListener("pointerup", endScrub);
  strip.addEventListener("pointercancel", endScrub);

  /* Dragging a shot's right edge: its length, in half seconds - a tenth with
     Shift held. */
  let edge = null;
  strip.addEventListener("pointerdown", (e) => {
    if (!isMotion()) return;
    const h = e.target.closest(".edge");
    if (!h) return;
    e.preventDefault();
    e.stopPropagation();
    mpause();
    const i = Number(h.dataset.edge), s = MZ.shots[i];
    if (!s) return;
    h.setPointerCapture(e.pointerId);
    const zoom = app.canvas && app.canvas.ds ? app.canvas.ds.scale : 1;
    const nx = MZ.shots[i + 1];
    const nextCell = strip.querySelector(`.vly-mshot[data-s="${i + 1}"]`);
    edge = { i, id: s.id, x: e.clientX, dur: s.dur, zoom, h, cell: h.closest(".vly-mshot"), w0: cellW(i),
      next: nx ? { id: nx.id, dur: nx.dur, cell: nextCell, w0: nextCell ? cellW(i + 1) : 0 } : null };
    edge.cell.classList.add("sizing");
  }, true);
  strip.addEventListener("pointermove", (e) => {
    if (!edge) return;
    const dx = (e.clientX - edge.x) / edge.zoom;
    // a plain drag moves everything after it; with Shift held, only the cut
    // between this shot and the next moves - the next gives or takes the time
    edge.roll = e.shiftKey && !!edge.next;
    const q = e.ctrlKey || e.metaKey ? 0.1 : 0.5;
    let dur = Math.max(1, Math.min(20, Math.round((edge.dur + dx / TL.pps) / q) * q));
    // the end of the shot snaps to the playhead when it comes near it
    const s0 = MZ.shots[edge.i];
    const raw = edge.dur + dx / TL.pps;
    // ... and to the markers
    const over = MZ.shots[edge.i + 1] && s0.pass === "fade" ? FADE_S : 0;
    let snapped = false, best = 8;
    for (const at of [MZ.t, ...markerTimes().map(m => m.t)]) {
      const d = at - s0.start + over;
      const px = Math.abs((raw - d) * TL.pps);
      if (d >= 1 && d <= 20 && px < best) { best = px; dur = d; snapped = at; }
    }
    strip.querySelectorAll(".tl-mk.snap").forEach(el => el.classList.remove("snap"));
    if (snapped !== false && snapped !== MZ.t) {
      const mk = [...strip.querySelectorAll(".tl-mk")].find(el => Math.abs(parseFloat(el.style.left) - snapped * TL.pps) < 1);
      if (mk) mk.classList.add("snap");
    }
    snapped = snapped === MZ.t;
    if (edge.roll) {
      // the next shot keeps at least a second, and no more than twenty
      const room = edge.dur + edge.next.dur - 1;
      dur = Math.max(Math.max(1, edge.dur + edge.next.dur - 20), Math.min(room, dur));
    }
    edge.now = Math.round(dur * 100) / 100;
    if (edge.next) {
      const nd = edge.roll ? Math.round((edge.next.dur - (edge.now - edge.dur)) * 100) / 100 : edge.next.dur;
      edge.next.now = nd;
      if (edge.next.cell) {
        edge.next.cell.style.width = `${(edge.next.w0 - (edge.roll ? edge.now - edge.dur : 0) * TL.pps).toFixed(1)}px`;
        const ni = edge.next.cell.querySelector(".lb i");
        if (ni) ni.textContent = `${+nd.toFixed(2)}s`;
        edge.next.cell.classList.toggle("rolling", edge.roll);
      }
    }
    edge.cell.classList.toggle("rolling", edge.roll);
    const hd = strip.querySelector(".tl-head");
    if (hd) hd.classList.toggle("snap", snapped);
    edge.cell.style.width = `${(edge.w0 + (edge.now - edge.dur) * TL.pps).toFixed(1)}px`;
    const i = edge.cell.querySelector(".lb i");
    if (i) i.textContent = `${+edge.now.toFixed(2)}s`;
    const tip = edge.cell.querySelector(".etip");
    // where the next shot takes over: the end of the shot, less its fade
    if (tip) tip.textContent = `${edge.roll ? "Roll \u00b7 " : ""}${+edge.now.toFixed(2)}s \u00b7 next at ${tc(s0.start + edge.now - over)}`
      + (edge.roll ? ` \u00b7 next ${+edge.next.now.toFixed(2)}s` : "");
  });
  const endEdge = () => {
    if (!edge) return;
    const e0 = edge;
    edge = null;
    e0.cell.classList.remove("sizing", "rolling");
    if (e0.next && e0.next.cell) e0.next.cell.classList.remove("rolling");
    const hd = strip.querySelector(".tl-head");
    if (hd) hd.classList.remove("snap");
    strip.querySelectorAll(".tl-mk.snap").forEach(el => el.classList.remove("snap"));
    if (e0.now != null && e0.now !== e0.dur) {
      const m = mstate();
      (m.set[e0.id] || (m.set[e0.id] = {})).dur = e0.now;
      if (e0.roll && e0.next) (m.set[e0.next.id] || (m.set[e0.next.id] = {})).dur = e0.next.now;
      if (MZ.sel && !MZ.sel.has(e0.id)) MZ.sel = new Set();
      MZ.cur = e0.i;
      paint();
    }
  };
  strip.addEventListener("pointerup", endEdge);
  strip.addEventListener("pointercancel", endEdge);

  /* The music used before - every piece chosen here is kept - in the order
     it was first added; the list opens and closes. */
  let musicLib = null, libLoading = false;
  let ME = null, lastFilm;
  // favourites and folders of the list, and what is being edited in them
  let SHELF = { order: [], fav: [], folders: [] }, shelfBusy = null;
  const SH = { newf: false, rename: null, menu: null, drag: null, mren: null };
  async function loadLib(force) {
    if (libLoading || (musicLib && !force)) return;
    libLoading = true;
    try {
      if (shelfBusy) await shelfBusy;
      const r = await api.fetchApi(MUSIC_LIST_URL);
      const j = await r.json();
      musicLib = j.ok ? j.list : [];
      if (j.ok) shelfSet(j.shelf);
    } catch (e) { musicLib = []; }
    libLoading = false;
    if (musicLive()) paintMusic();
  }
  const mb = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

  /* Listening to a piece before or after it is set to the film: one at a
     time, from START AT for the piece in use, from the start for the others.
     The film playing stops it. */
  const PV = { audio: null, name: null, t: 0, paused: false, last: null };
  /* The player's spectrum: the piece listened to runs through an analyser of
     its own audio context, and a row of thin bars is drawn from it. */
  const EQ = { ac: null, an: null, src: null, raf: 0, bins: null, lv: null };
  const EQ_BARS = 56;
  function eqHook(a) {
    try {
      EQ.src = null;
    } catch (e) { EQ.src = null; /* plays on without the spectrum */ }
    eqRun();
  }
  function eqUnhook() {
    EQ.src = null;
  }
  function eqRun() {
    if (EQ.raf) return;
    const step = () => {
      EQ.raf = 0;
      const cv = musicBox.querySelector(".mp-eq");
      if (!cv || S.dead) return;
      const dpr = window.devicePixelRatio || 1;
      const w = cv.clientWidth, h = cv.clientHeight;
      if (!w || !h) return;
      if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
      const ctx = cv.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (!EQ.lv || EQ.lv.length !== EQ_BARS) EQ.lv = new Float32Array(EQ_BARS);
      const live = !!(EQ.src && PV.audio && !PV.paused);
      if (live) EQ.an.getByteFrequencyData(EQ.bins);
      const n = EQ.bins ? EQ.bins.length : 0;
      const nyq = EQ.ac ? EQ.ac.sampleRate / 2 : 22050;
      let moving = false;
      for (let i = 0; i < EQ_BARS; i++) {
        let v = 0;
        if (live && n) {
          // bands spaced on a log scale, 40 Hz to 14 kHz
          const f0 = 40 * Math.pow(14000 / 40, i / EQ_BARS), f1 = 40 * Math.pow(14000 / 40, (i + 1) / EQ_BARS);
          const b0 = Math.max(1, Math.floor(f0 / nyq * n)), b1 = Math.max(b0 + 1, Math.ceil(f1 / nyq * n));
          let m = 0;
          for (let k = b0; k < b1 && k < n; k++) m = Math.max(m, EQ.bins[k]);
          v = Math.pow(m / 255, 1.6);
        }
        // rise at once, fall slowly - and settle flat when the music stops
        EQ.lv[i] = v > EQ.lv[i] ? v : EQ.lv[i] * 0.88;
        if (EQ.lv[i] > 0.01) moving = true;
      }
      const gap = 2, bw = Math.max(1, (w - gap * (EQ_BARS - 1)) / EQ_BARS);
      ctx.fillStyle = getComputedStyle(cv).color;
      for (let i = 0; i < EQ_BARS; i++) {
        const bh = Math.max(1.5, EQ.lv[i] * h);
        ctx.globalAlpha = PV.paused || !PV.audio ? 0.35 : 0.9;
        ctx.fillRect(i * (bw + gap), h - bh, bw, bh);
      }
      ctx.globalAlpha = 1;
      if (live || moving) EQ.raf = requestAnimationFrame(step);
    };
    EQ.raf = requestAnimationFrame(step);
  }
  /* The player's own volume - the film keeps the one set in MUSIC. */
  function pvVol() {
    const v = Number(P.vly_pvvol);
    return Math.max(0, Math.min(1, isFinite(v) && P.vly_pvvol != null ? v : (Number(mstate().music.vol) || 1)));
  }
  const eqOn = () => false;
  /* One sound at a time across the canvas: a piece or a film starting in
     one Layout node pauses whatever plays in the others. */
  function hushOthers() {
    for (const o of VLY_ALL) if (o !== ME) { try { o.hush(); } catch (e) { /* a node going */ } }
  }
  function pvStop() {
    eqUnhook();
    PV.paused = false;
    if (PV.audio) { try { PV.audio.pause(); } catch (e) { /* gone */ } PV.audio.src = ""; }
    PV.audio = null;
    const was = PV.name;
    PV.name = null;
    PV.t = 0;
    if (was && musicLive()) paintMusic();
  }
  function pvPlay(name, from) {
    pvStop();
    if (MZ.playing) mpause();
    const a = new Audio(`${api.apiURL(MUSIC_URL)}?name=${encodeURIComponent(name)}`);
    a.volume = pvVol();
    PV.audio = a;
    PV.name = name;
    PV.last = name;
    PV.t = from || 0;
    a.addEventListener("loadedmetadata", () => { if (from && from < a.duration) a.currentTime = from; });
    a.addEventListener("timeupdate", () => {
      if (PV.audio !== a) return;
      PV.t = a.currentTime;
      for (const el of musicBox.querySelectorAll(".mu-pt")) if (el.dataset.pt === PV.name) el.textContent = clock(PV.t);
      const here = musicBox.querySelector(".mp-here-t");
      if (here) here.textContent = clock(PV.t);
      const bar = musicBox.querySelector(".mp-track i");
      if (bar) bar.style.width = `${pvFrac() * 100}%`;
    });
    a.addEventListener("ended", () => { if (PV.audio === a) pvNext(name); });
    a.addEventListener("error", () => { if (PV.audio === a) { say(`Could not play ${name}`, true); pvStop(); } });
    eqHook(a);
    hushOthers();
    a.play().catch(() => { if (PV.audio === a) pvStop(); });
    paintMusic();
  }

  /* What follows a piece when it ends: nothing, the next in the list, the
     same again, the list round and round, or any other at random. */
  const PV_IC = (d, extra) => `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/>${extra || ""}</svg>`;
  const PV_LOOP = "M2.5 8V6.5A2.5 2.5 0 0 1 5 4h8M11 2l2 2-2 2M13.5 8v1.5A2.5 2.5 0 0 1 11 12H3M5 14l-2-2 2-2";
  const PV_MODES = [
    { id: "once", label: "Once", title: "Once - stop when the piece ends",
      icon: PV_IC("M2 8h8.5M7.5 5l3 3-3 3M13.5 4v8") },
    { id: "all", label: "Play all", title: "Play all - the list through once, from the piece playing",
      icon: PV_IC("M2 4.5h8M2 8h8M2 11.5h5", '<path d="M10 9.5v4.5l3.5-2.25z" fill="currentColor" stroke="none"/>') },
    { id: "one", label: "Repeat one", title: "Repeat one - the same piece again and again",
      icon: PV_IC(PV_LOOP, '<text x="8" y="10.2" text-anchor="middle" font-size="6.2" font-weight="700" font-family="Arial,sans-serif" fill="currentColor" stroke="none">1</text>') },
    { id: "loop", label: "Repeat all", title: "Repeat all - the list round and round",
      icon: PV_IC(PV_LOOP) },
    { id: "shuffle", label: "Shuffle", title: "Shuffle - the pieces at random, without end",
      icon: PV_IC("M2 4.5h2.2c1.8 0 2.8 1 3.8 3l.6 1.1c1 2 2 3 3.8 3H14M12.3 10l2 1.6-2 1.6M2 11.6h2.2c1.2 0 2-.4 2.7-1.2M9.4 5.6c.7-.8 1.5-1.1 2.6-1.1H14M12.3 2.9l2 1.6-2 1.6") },
  ];
  const PV_CHECK = '<svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2 5.2l2 2 4-4.4"/></svg>';
  function pvMode() { return PV_MODES.some(m => m.id === P.vly_pvmode) ? P.vly_pvmode : "once"; }
  /* Marked pieces: when any are marked, listening goes round them only. */
  function pvMarks() {
    const have = new Set((musicLib || []).map(m => m.name));
    return (Array.isArray(P.vly_pvmark) ? P.vly_pvmark : []).filter(n => have.has(n));
  }
  function pvMark(name) {
    const set = new Set(Array.isArray(P.vly_pvmark) ? P.vly_pvmark : []);
    if (set.has(name)) set.delete(name); else set.add(name);
    P.vly_pvmark = [...set];
  }
  /* Listening keeps to the list shown, and within it to the marked pieces. */
  function pvMarked() {
    const shown = new Set(viewNames(muView()));
    return pvMarks().filter(n => shown.has(n));
  }
  function pvList() {
    const shown = viewNames(muView());
    const marks = new Set(pvMarked());
    return marks.size ? shown.filter(n => marks.has(n)) : shown;
  }
  function pvNext(name) {
    const list = pvList();
    const mode = pvMode();
    let next = null;
    if (mode === "one") next = name;
    else if (list.length) {
      const i = list.indexOf(name);
      if (mode === "all") next = i < list.length - 1 ? list[i + 1] : null;
      else if (mode === "loop") next = list[(i + 1 + list.length) % list.length];
      else if (mode === "shuffle") {
        const rest = list.filter(n => n !== name);
        next = rest.length ? rest[Math.floor(Math.random() * rest.length)] : name;
      }
    }
    if (next) pvPlay(next, 0); else pvStop();
  }
  /* What the playing piece will do next, shown after its name. */
  function pvState() {
    const m = PV_MODES.find(x => x.id === pvMode());
    const n = pvMarked().length;
    const v = muView();
    const where = v === "all" ? "" : ` \u00b7 ${esc(viewTitle(v))}`;
    return `<span class="mu-st" title="${m.title}">${m.icon}${m.label}${m.id !== "one" ? where : ""}${n && m.id !== "one" ? ` \u00b7 ${n} marked` : ""}</span>`;
  }
  /* Running time of each piece in the list, read once from the file. */
  const DUR = {};
  function loadDur() {
    for (const m of musicLib || []) {
      if (m.name in DUR) continue;
      DUR[m.name] = 0;
      const a = new Audio();
      a.preload = "metadata";
      a.addEventListener("loadedmetadata", () => {
        DUR[m.name] = a.duration || 0;
        a.src = "";
        for (const el of musicBox.querySelectorAll(".mu-it")) {
          if (el.dataset.mname === m.name) { const d = el.querySelector(".du"); if (d) d.textContent = clock(DUR[m.name]); }
        }
      });
      a.addEventListener("error", () => { a.src = ""; });
      a.src = `${api.apiURL(MUSIC_URL)}?name=${encodeURIComponent(m.name)}`;
    }
  }

  /* The transport on the LISTEN line: back, pause or play, forward - over
     the list shown and its marks, the same list the modes go round. */
  function pvPause() {
    if (!PV.audio) return;
    if (PV.paused) {
      if (MZ.playing) mpause();
      PV.paused = false;
      if (EQ.ac) EQ.ac.resume().catch(() => {});
      hushOthers();
      PV.audio.play().catch(() => { if (PV.audio) pvStop(); });
    } else {
      PV.audio.pause();
      PV.paused = true;
    }
    paintMusic();
  }
  function pvToggle() {
    if (PV.audio) { pvPause(); return; }
    const list = pvList();
    if (!list.length) return;
    pvPlay(list.includes(PV.last) ? PV.last : list[0], 0);
  }
  function pvSkip(dir) {
    const list = pvList();
    if (!list.length) return;
    const cur = PV.name || PV.last;
    if (dir < 0 && PV.audio && PV.t > 3) { pvPlay(PV.name, 0); return; } // back to its start first
    let next;
    if (pvMode() === "shuffle" && dir > 0) {
      const rest = list.filter(n => n !== cur);
      next = rest.length ? rest[Math.floor(Math.random() * rest.length)] : list[0];
    } else {
      const i = list.indexOf(cur);
      next = i < 0 ? list[dir > 0 ? 0 : list.length - 1] : list[(i + dir + list.length) % list.length];
    }
    pvPlay(next, 0);
  }
  const TR_PREV = '<svg viewBox="0 0 16 16"><path d="M3.5 3.5v9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M12.5 3.6v8.8L5.6 8z" fill="currentColor"/></svg>';
  const TR_NEXT = '<svg viewBox="0 0 16 16"><path d="M12.5 3.5v9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M3.5 3.6v8.8L10.4 8z" fill="currentColor"/></svg>';
  const TR_PLAY = '<svg viewBox="0 0 16 16"><path d="M5 3v10l8.5-5z" fill="currentColor"/></svg>';
  const TR_PAUSE = '<svg viewBox="0 0 16 16"><rect x="4" y="3" width="2.8" height="10" rx=".6" fill="currentColor"/><rect x="9.2" y="3" width="2.8" height="10" rx=".6" fill="currentColor"/></svg>';
  /* The piece playing, or paused, named on the LISTEN line. */
  function paintNow() {
    const name = PV.name || PV.last;
    if (!name) return `<span class="mu-now idle">Nothing playing</span>`;
    const len = DUR[name] ? ` / ${clock(DUR[name])}` : "";
    return `<span class="mu-now${PV.name ? "" : " idle"}${PV.paused ? " paused" : ""}" title="${esc(name)}">`
      + `<span class="nn">${esc(name.replace(/\.[^.]+$/, ""))}</span>`
      + (PV.name ? `<span class="nt"><i class="mu-pt" data-pt="${esc(name)}">${clock(PV.t)}</i>${len}</span>` : "")
      + `</span>`;
  }
  /* The film's music of the series open - a player reads it from a Layout
     node of the same series when there is one. */
  function filmName() {
    const ser = P.vly_series || "";
    if (!ser) return "";
    if (isPlayer()) for (const o of VLY_ALL) if (o !== ME && !o.player() && o.series() === ser) return o.film();
    return mstate().music.name || "";
  }
  async function setFilmEverywhere(name, start) {
    const ser = P.vly_series || "";
    for (const o of [...VLY_ALL]) if (o.series() === ser) { try { await o.setFilm(name, start); } catch (e) { /* a node going */ } }
  }
  function pvLen() {
    const name = PV.name || PV.last;
    return (PV.audio && isFinite(PV.audio.duration) && PV.audio.duration) || (name && DUR[name]) || 0;
  }
  function pvFrac() { const L = pvLen(); return PV.name && L ? Math.max(0, Math.min(1, PV.t / L)) : 0; }
  /* The player's head: the piece large with a bar to seek in, the buttons
     beside it, the modes, then the tabs - as a music player is laid out. */
  const EQ_IC = '<svg viewBox="0 0 16 16"><rect x="2" y="7" width="2" height="6" rx=".5" fill="currentColor"/><rect x="5.5" y="3" width="2" height="10" rx=".5" fill="currentColor"/><rect x="9" y="5.5" width="2" height="7.5" rx=".5" fill="currentColor"/><rect x="12.5" y="8.5" width="2" height="4.5" rx=".5" fill="currentColor"/></svg>';
  const HERE_IC = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 2.5v11"/><path d="M7 5.5l5 2.5-5 2.5z" fill="currentColor"/></svg>';
  const FILM_IC = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"><rect x="2" y="3.5" width="12" height="9" rx="1"/><path d="M5 3.5v9M11 3.5v9M2 6.5h3M2 9.5h3M11 6.5h3M11 9.5h3"/></svg>';
  const VOL_IC = '<svg viewBox="0 0 16 16"><path d="M2.5 6h2.5l3.5-3v10L5 10H2.5z" fill="currentColor"/><path d="M11 5.5a3.5 3.5 0 0 1 0 5M12.8 3.6a6 6 0 0 1 0 8.8" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';
  function paintPlayerHead() {
    const name = PV.name || PV.last;
    const going = PV.audio && !PV.paused;
    const L = pvLen();
    const marked = pvMarked().length;
    return `<div class="mp-head">
      <div class="mp-top"><span class="lab2">MUSIC PLAYER</span>
        <span class="mp-where">${esc(viewTitle(muView()))}${marked ? ` \u00b7 ${marked} marked` : ""}</span>
        ${PV.name && P.vly_series ? `<button class="mp-here" title="Start the film's music here - the piece playing, from where it is now">${HERE_IC}Start here <i class="mp-here-t">${clock(PV.t)}</i></button>` : ""}
        ${(() => {
              const nm = PV.name || PV.last, inFilm = nm && nm === filmName();
              const can = nm && P.vly_series && !inFilm;
              return `<button class="mp-film${inFilm ? " on" : ""}"${can ? "" : " disabled"} title="${!nm ? "Play a piece first" : !P.vly_series ? "Open a series to set its film's music" : inFilm ? "This piece is the music of the film" : "Set the piece playing as the music of the film"}">${FILM_IC}${inFilm ? "In the film" : "To the film"}</button>`;
            })()}
        <button class="mu-back" title="Back to the layout">${ICON.layout}Layout</button></div>
      <div class="mp-main">
        <div class="mp-tr">
          <button data-tr="prev" title="Previous piece - or back to the start of this one">${TR_PREV}</button>
          <button class="pp${going ? " on" : ""}" data-tr="pp" title="${going ? "Pause" : PV.paused ? "Play on" : "Play the list shown"}">${going ? TR_PAUSE : TR_PLAY}</button>
          <button data-tr="next" title="Next piece">${TR_NEXT}</button>
        </div>
        <div class="mp-now${PV.name ? "" : " idle"}${PV.paused ? " paused" : ""}">
          <div class="mp-title" title="${esc(name || "")}">${name ? esc(name.replace(/\.[^.]+$/, "")) : "Nothing playing"}</div>
          ${eqOn() ? `<canvas class="mp-eq"></canvas>` : ""}
          <div class="mp-bar"><span class="mu-pt" data-pt="${esc(PV.name || "")}">${PV.name ? clock(PV.t) : "0:00"}</span>
            <div class="mp-track" title="Click to move in the piece"><i style="width:${pvFrac() * 100}%"></i></div>
            <span class="t1">${L ? clock(L) : "-:--"}</span></div>
        </div>
        <div class="mp-side">
          <span class="vly-tseg pvm">${PV_MODES.map(m =>
            `<button class="ic${pvMode() === m.id ? " on" : ""}" data-pvm="${m.id}" title="${m.title}">${m.icon}</button>`).join("")}</span>
          <div class="mp-row2">
            <button class="mp-eqb${eqOn() ? " on" : ""}" title="${eqOn() ? "Hide the spectrum" : "Show the spectrum - bars that move with the music"}">${EQ_IC}EQ</button>
            <span class="mp-vol" title="Volume of the player - the film keeps its own">${VOL_IC}<input class="mp-volr" type="range" min="0" max="1" step="0.02" value="${pvVol()}" style="--v:${Math.round(pvVol() * 100)}%" /></span>
          </div>
        </div>
      </div>
      <div class="mp-tabs">${paintTabs()}
        ${marked ? `<span class="mk">Only the ${marked} marked pieces play<button class="mu-mkx" title="Unmark all - every piece plays again">Unmark all</button></span>`
          : `<span class="hint">tick pieces to play those only</span>`}</div>
    </div>`;
  }
  function paintTransport() {
    const going = PV.audio && !PV.paused;
    return `<span class="mu-tr">`
      + `<button data-tr="prev" title="Previous piece - or back to the start of this one">${TR_PREV}</button>`
      + `<button class="pp${going ? " on" : ""}" data-tr="pp" title="${going ? "Pause" : PV.paused ? "Play on" : "Play the list shown"}">${going ? TR_PAUSE : TR_PLAY}</button>`
      + `<button data-tr="next" title="Next piece">${TR_NEXT}</button></span>`;
  }

  /* Favourites and folders: kept with the music on the server, so every
     workflow sees the same shelf. A folder only gathers names. */
  const STAR = (on) => `<svg viewBox="0 0 16 16"><path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z" fill="${on ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>`;
  const FOLDER = '<svg viewBox="0 0 16 16"><path d="M1.8 4.2a1 1 0 0 1 1-1h3.1l1.5 1.5h5.8a1 1 0 0 1 1 1v6.6a1 1 0 0 1-1 1H2.8a1 1 0 0 1-1-1z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>';
  const FOLDER_ADD = '<svg viewBox="0 0 16 16"><path d="M1.8 4.2a1 1 0 0 1 1-1h3.1l1.5 1.5h5.8a1 1 0 0 1 1 1v6.6a1 1 0 0 1-1 1H2.8a1 1 0 0 1-1-1z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M8 7.2v4M6 9.2h4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';
  function shelfSet(doc) {
    const d = doc && typeof doc === "object" ? doc : {};
    SHELF = {
      order: Array.isArray(d.order) ? d.order.slice() : [],
      fav: Array.isArray(d.fav) ? d.fav.slice() : [],
      folders: Array.isArray(d.folders) ? d.folders.map(f => ({ id: String(f.id), name: String(f.name), items: Array.isArray(f.items) ? f.items.slice() : [] })) : [],
    };
  }
  function shelfSave() {
    shelfBusy = shelfPost();
    return shelfBusy;
  }
  async function shelfPost() {
    try {
      const r = await api.fetchApi(MUSIC_SHELF_URL, { method: "POST", body: JSON.stringify({ shelf: SHELF }) });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "not kept");
    } catch (err) { say(`Folders not kept: ${err && err.message || err}`, true); }
  }
  const folderBy = (id) => SHELF.folders.find(f => f.id === id) || null;
  function muView() {
    const v = String(P.vly_mview || "all");
    if (v === "fav") return v;
    if (v.startsWith("f:") && folderBy(v.slice(2))) return v;
    return "all";
  }
  /* The whole list in its order: as moved with the arrows, the pieces not
     moved yet after them in the order they were added. */
  function libNames() {
    const all = (musicLib || []).map(m => m.name);
    const have = new Set(all);
    const first = SHELF.order.filter(n => have.has(n));
    const seen = new Set(first);
    return first.concat(all.filter(n => !seen.has(n)));
  }
  function viewNames(v) {
    const all = libNames();
    if (v === "fav") { const have = new Set(all); return SHELF.fav.filter(n => have.has(n)); }
    if (v.startsWith("f:")) {
      const f = folderBy(v.slice(2));
      const have = new Set(all);
      return f ? f.items.filter(n => have.has(n)) : [];
    }
    return all;
  }
  const REN_IC = '<svg viewBox="0 0 10 10"><path d="M6.6 1.8l1.6 1.6-4.9 4.9-2 .4.4-2z" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/></svg>';
  const ORD_UP = '<svg viewBox="0 0 10 10"><path d="M2.2 6.4L5 3.6l2.8 2.8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const ORD_DN = '<svg viewBox="0 0 10 10"><path d="M2.2 3.6L5 6.4l2.8-2.8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  /* One step up or down in the list shown - the whole list, Favourites or a
     folder each keep their own order. */
  function moveIn(v, name, dir) {
    const list = viewNames(v);
    const i = list.indexOf(name), j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return false;
    [list[i], list[j]] = [list[j], list[i]];
    if (v === "all") SHELF.order = list;
    else if (v === "fav") SHELF.fav = list;
    else { const f = folderBy(v.slice(2)); if (!f) return false; f.items = list; }
    return true;
  }
  function addTo(v, names) {
    const list = v === "fav" ? SHELF.fav : (folderBy(v.slice(2)) || {}).items;
    if (!list) return 0;
    let n = 0;
    for (const name of names) if (!list.includes(name)) { list.push(name); n++; }
    return n;
  }
  function takeFrom(v, name) {
    if (v === "fav") SHELF.fav = SHELF.fav.filter(n => n !== name);
    else { const f = folderBy(v.slice(2)); if (f) f.items = f.items.filter(n => n !== name); }
  }
  const viewTitle = (v) => (v === "fav" ? "Favourites" : v.startsWith("f:") ? ((folderBy(v.slice(2)) || {}).name || "") : "All");
  function paintTabs() {
    const v = muView();
    const all = (musicLib || []).length;
    const tab = (key, inner, title) => `<button class="mu-tab${v === key ? " on" : ""}${key !== "all" ? " tgt" : ""}" data-mview="${key}" title="${title}">${inner}</button>`;
    return `<div class="mu-tabs">`
      + tab("all", `All <b>${all}</b>`, "Every piece kept here")
      + tab("fav", `${STAR(true)}Favourites <b>${viewNames("fav").length}</b>`, "The pieces starred - drag a piece here to star it")
      + SHELF.folders.map(f => SH.rename === f.id
        ? `<input class="mu-fin" data-ren="${f.id}" value="${esc(f.name)}" maxlength="40" />`
        : tab(`f:${f.id}`, `${FOLDER}${esc(f.name)} <b>${viewNames(`f:${f.id}`).length}</b>${v === `f:${f.id}` ? `<i class="mu-fdx" data-fdx="${f.id}" title="Delete this folder - the music in it stays">${ICON.close}</i>` : ""}`,
          "Drag a piece here to put it in this folder - double-click to rename")).join("")
      + (SH.newf ? `<input class="mu-fin" data-newf="1" placeholder="Folder name" maxlength="40" />`
        : `<button class="mu-tab add" data-addf="1" title="A new folder to gather pieces in">${FOLDER_ADD}Folder</button>`)
      + `</div>`;
  }
  function paintFolderMenu(name) {
    return `<div class="mu-fm"><span class="lab2">IN</span>`
      + `<button class="mu-tab${SHELF.fav.includes(name) ? " on" : ""}" data-fmin="fav" data-fmname="${esc(name)}">${STAR(true)}Favourites</button>`
      + SHELF.folders.map(f => `<button class="mu-tab${f.items.includes(name) ? " on" : ""}" data-fmin="f:${f.id}" data-fmname="${esc(name)}">${FOLDER}${esc(f.name)}</button>`).join("")
      + (SHELF.folders.length ? "" : `<span class="hint">No folders yet - make one with + Folder above</span>`)
      + `</div>`;
  }
  function focusFin() {
    const inp = musicBox.querySelector(".mu-fin");
    if (inp) { inp.focus(); inp.select(); }
  }
  /* A piece renamed: the file on the server first, then every place that
     knows it by name - the films of every series, their markers, the
     player, the marks - in every Layout node open. */
  async function finishRename(inp, keep) {
    if (!inp || inp.dataset.done) return;
    inp.dataset.done = "1";
    const old = inp.dataset.mren, to = inp.value.trim();
    SH.mren = null;
    if (!keep || !to || to === old.replace(/\.[^.]+$/, "")) { paintMusic(); return; }
    // a file being played is let go first, so the system lets it be renamed
    const was = PV.name === old && PV.audio ? { t: PV.t, held: PV.paused } : null;
    if (was) pvStop();
    const back = (name) => { if (was) { pvPlay(name, was.t); if (was.held) pvPause(); } };
    try {
      const r = await api.fetchApi(MUSIC_RENAME_URL, { method: "POST", body: JSON.stringify({ name: old, to }) });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "not renamed");
      for (const o of [...VLY_ALL]) { try { o.renamed(old, j.name); } catch (err) { /* a node going */ } }
      back(j.name);
      say(`Renamed: ${j.name}`);
    } catch (err) { back(old); say(`Not renamed: ${err && err.message || err}`, true); paintMusic(); }
  }
  function renamedHere(old, neu) {
    for (const st of Object.values(P.vly_state || {})) {
      const m = st && st.motion;
      if (!m || typeof m !== "object") continue;
      if (m.music && m.music.name === old) m.music.name = neu;
      if (m.markers && m.markers[old]) { m.markers[neu] = m.markers[old]; delete m.markers[old]; }
    }
    if (MZ.bufs.has(old)) { MZ.bufs.set(neu, MZ.bufs.get(old)); MZ.bufs.delete(old); }
    if (old in DUR) { DUR[neu] = DUR[old]; delete DUR[old]; }
    if (PV.last === old) PV.last = neu;
    // the piece playing goes on from where it was, read again under its new name
    if (PV.name === old && PV.audio) { const t = PV.t, held = PV.paused; pvPlay(neu, t); if (held) pvPause(); }
    if (Array.isArray(P.vly_pvmark)) P.vly_pvmark = P.vly_pvmark.map(n => (n === old ? neu : n));
    loadLib(true).then(() => { if (!S.dead) paint(); });
  }
  function finishFin(inp, keep) {
    if (!inp || inp.dataset.done) return;
    inp.dataset.done = "1";
    const name = inp.value.trim().slice(0, 40);
    if (keep && name) {
      if (inp.dataset.newf) {
        const id = (Date.now().toString(36) + Math.random().toString(36).slice(2, 6)).slice(0, 16);
        SHELF.folders.push({ id, name, items: [] });
        shelfSave();
      } else {
        const f = folderBy(inp.dataset.ren);
        if (f && f.name !== name) { f.name = name; shelfSave(); }
      }
    }
    SH.newf = false;
    SH.rename = null;
    paintMusic();
  }

  function paintList(mu) {
    const v = muView();
    const film = filmName();
    const names = viewNames(v);
    const rows = names.map(n => musicLib.find(m => m.name === n)).filter(Boolean);
    const inFolder = v !== "all";
    if (!rows.length) {
      return `<div class="mu-list"><div class="mu-empty">${v === "all" ? "No music yet - drop pieces from the computer here." : v === "fav" ? "No favourites yet - press the star beside a piece, or drag a piece onto Favourites."
        : "This folder is empty - drag pieces onto its tab, or use the folder button beside a piece. Music dropped here from the computer goes into it."}</div></div>`;
    }
    return `<div class="mu-list">${rows.map(m => {
      const marked = pvMarks().includes(m.name), fav = SHELF.fav.includes(m.name);
      return `<div class="mu-it${m.name === film ? " cur" : ""}${PV.name === m.name ? " playing" : ""}" data-mname="${esc(m.name)}" draggable="${SH.mren === m.name ? "false" : "true"}" title="${isPlayer() ? "Play this piece" : "Set this music to the film"} - drag it onto a folder">
          <button class="mu-pv${PV.name === m.name ? " on" : ""}" data-pv="${esc(m.name)}" data-from="0" title="${PV.name === m.name ? (PV.paused ? "Play on" : "Pause") : "Listen to it"}">${PV.name === m.name ? (PV.paused ? PV_PLAY : PV_ON) : PV_PLAY}</button><button class="mu-mk${marked ? " on" : ""}" data-pvmk="${esc(m.name)}" title="${marked ? "Unmark - back into the whole list" : "Mark - listen to the marked pieces only"}">${PV_CHECK}</button><button class="mu-st2${fav ? " on" : ""}" data-fav="${esc(m.name)}" title="${fav ? "Take it out of Favourites" : "Add to Favourites"}">${STAR(fav)}</button><span class="nm">${SH.mren === m.name ? `<input class="mu-rin" data-mren="${esc(m.name)}" value="${esc(m.name.replace(/\.[^.]+$/, ""))}" maxlength="120" />` : esc(m.name)}${m.name === film ? `<span class="mu-fl" title="The music of the film">${FILM_IC}film</span>` : ""}${PV.name === m.name ? ` <i class="mu-pt" data-pt="${esc(m.name)}">${clock(PV.t)}</i>${pvState()}` : ""}</span><span class="sz">${mb(m.bytes)}</span><span class="du">${DUR[m.name] ? clock(DUR[m.name]) : ""}</span>
          <span class="mu-ord"><button data-mren-go="${esc(m.name)}" title="Rename - the file keeps its extension">${REN_IC}</button><button data-mup="${esc(m.name)}"${names[0] === m.name ? " disabled" : ""} title="Move it up">${ORD_UP}</button><button data-mdn="${esc(m.name)}"${names[names.length - 1] === m.name ? " disabled" : ""} title="Move it down">${ORD_DN}</button></span>
          <button class="mu-fb${SH.menu === m.name ? " on" : ""}" data-fmenu="${esc(m.name)}" title="Folders this piece is in">${FOLDER}</button>
          ${inFolder ? `<button class="mu-del" data-mout="${esc(m.name)}" title="Take it out of ${esc(viewTitle(v))} - the file stays">${ICON.close}</button>`
            : `<button class="mu-del" data-mdel="${esc(m.name)}" title="Take it out of the list - the file is deleted">${ICON.close}</button>`}</div>`
        + (SH.menu === m.name ? paintFolderMenu(m.name) : "");
    }).join("")}</div>`;
  }

  function paintMusic() {
    const mu = mstate().music;
    const total = motionLength(MZ.shots);
    const len = mu.len || 0;
    let info = "";
    if (mu.name) {
      const end = mu.start + total;
      const short = len && end > len + 0.05;
      info = short && mu.loop
        ? `The film runs ${clock(total)}: the music from ${clock(mu.start)}, running again from ${clock(mu.start)} each time it ends, fading out over the last ${mu.fade} s.`
        : short
          ? `<span class="warn">The music ends at ${clock(len - mu.start)} - the film runs ${clock(total)}. Turn Loop on, start it earlier or choose a longer piece.</span>`
          : `The film runs ${clock(total)}: the music from ${clock(mu.start)} to ${clock(end)}, fading out over the last ${mu.fade} s.`;
    } else {
      info = `The film runs ${clock(total)}, without music.`;
    }
    musicBox.innerHTML = `
      <div class="vly-h" style="margin:0">MUSIC <span class="hint">fades out with the last shot</span></div>
      <div class="mu-row">
        <button class="vly-pack mu-pick" title="Choose a piece of music on this computer - MP3, WAV, M4A, OGG, FLAC">${mu.name ? "Change…" : "Choose music…"}</button>
        <input class="mu-file" type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac,.opus" style="display:none" />
        <span class="mu-name">${mu.name ? `<b>${esc(mu.name)}</b>${len ? ` · ${clock(len)}` : ""}` : "No music"}</span>
        ${mu.name ? `<button class="mu-pv${PV.name === mu.name ? " on" : ""}" data-pv="${esc(mu.name)}" data-from="${mu.start}" title="${PV.name === mu.name ? (PV.paused ? "Play on" : "Pause") : "Listen to it from START AT"}">${PV.name === mu.name ? (PV.paused ? PV_PLAY : PV_ON) : PV_PLAY}</button><span class="mu-pt" data-pt="${esc(mu.name)}">${PV.name === mu.name ? clock(PV.t) : ""}</span>` : ""}
        ${mu.name ? `<button class="mu-x" title="No music">${ICON.close}</button>` : ""}
        ${musicLib && musicLib.length ? `<button class="mu-lib${P.vly_mlib ? " on" : ""}" title="The music used before">Used before <b>${musicLib.length}</b> <i>${P.vly_mlib ? "\u25b4" : "\u25be"}</i></button>` : ""}
        ${mu.name ? `<span class="vly-vsep"></span>
        <span class="lab2">START AT</span><input class="mu-start" type="range" min="0" max="${Math.max(0, (len || 600) - 1).toFixed(1)}" step="0.5" value="${mu.start}" />
        <span class="mu-sv">${clock(mu.start)}</span>
        <span class="vly-vsep"></span><span class="lab2">FADE OUT</span><span class="vly-tseg fo">${[2, 3, 5, 8].map(n =>
          `<button class="${mu.fade === n ? "on" : ""}" data-fo="${n}" title="The music fades out over the last ${n} seconds">${n}s</button>`).join("")}</span>
        <span class="vly-vsep"></span><span class="lab2">LOOP</span><span class="vly-tseg lp">`
          + `<button class="${mu.loop ? "on" : ""}" data-loop="1" title="A piece shorter than the film runs again from START AT">On</button>`
          + `<button class="${mu.loop ? "" : "on"}" data-loop="0" title="The music plays once">Off</button></span>
        <span class="vly-vsep"></span><span class="lab2">VOLUME</span><input class="mu-vol" type="range" min="0" max="1" step="0.05" value="${mu.vol}" />` : ""}
      </div>
      <div class="mu-info">${info}</div>
      ${isPlayer() && musicLib ? paintPlayerHead() : ""}
      ${P.vly_mlib && !isPlayer() && musicLib && musicLib.length ? `<div class="mu-mode"><span class="lab2">LISTEN</span>${paintNow()}${paintTransport()}${PV.name && P.vly_series ? `<button class="mp-here" title="Start the film's music here - the piece playing, from where it is now">${HERE_IC}Start here <i class="mp-here-t">${clock(PV.t)}</i></button>` : ""}<span class="vly-vsep"></span><span class="vly-tseg pvm">${PV_MODES.map(m =>
        `<button class="ic${pvMode() === m.id ? " on" : ""}" data-pvm="${m.id}" title="${m.title}">${m.icon}</button>`).join("")}</span>
        <span class="vly-vsep"></span>${paintTabs()}
        ${pvMarked().length ? `<span class="mk">Only the ${pvMarked().length} marked pieces play<button class="mu-mkx" title="Unmark all - every piece plays again">Unmark all</button></span>`
          : `<span class="hint">tick pieces to play those only</span>`}</div>` : ""}
      ${(P.vly_mlib || isPlayer()) && musicLib && (musicLib.length || isPlayer()) ? paintList(mu) : ""}`;
    if (!musicLib) loadLib();
    else if (P.vly_mlib || isPlayer()) loadDur();
    if (SH.newf || SH.rename) focusFin();
    if (SH.mren) { const ri = musicBox.querySelector(".mu-rin"); if (ri) { ri.focus(); ri.select(); } }
    if (isPlayer()) { cancelAnimationFrame(EQ.raf); EQ.raf = 0; eqRun(); }
    else if (P.vly_series) {
      const fn = mu.name || "";
      if (fn !== lastFilm) {
        lastFilm = fn;
        for (const o of VLY_ALL) if (o !== ME && o.player() && o.series() === P.vly_series) o.refreshMusic();
      }
    }
    paintWave();
    if (mu.name && !mu.len) {
      musicBuffer(mu.name).then(b => { if (b && !mu.len) { mu.len = b.duration; if (musicLive()) paintMusic(); } });
    }
  }

  function mstop() {
    MZ.playing = false;
    cancelAnimationFrame(MZ.raf);
    if (MZ.src) { try { MZ.src.stop(); } catch (e) { /* not started */ } MZ.src = null; }
  }
  function mpause() {
    if (!MZ.playing) return;
    mstop();
    paintTime();
  }
  async function mplay() {
    if (MZ.playing) { mpause(); return; }
    if (PV.name) pvStop();
    hushOthers();
    if (!S.book || !MZ.shots.length) return;
    const total = motionLength(MZ.shots);
    if (MZ.t >= total - 0.05) MZ.t = 0;
    const ac = audioCtx();
    try { await ac.resume(); } catch (e) { /* no sound */ }
    const mu = mstate().music;
    const buf = mu.name ? await musicBuffer(mu.name) : null;
    MZ.playing = true;
    const at = ac.currentTime + 0.06;
    MZ.t0 = at - MZ.t;
    if (buf) {
      const a = new Audio(`${api.apiURL(MUSIC_URL)}?name=${encodeURIComponent(mu.name)}`);
      a.preload = "auto";
      a.currentTime = musicOffset(buf, mu, MZ.t);
      a.volume = Math.max(0, Math.min(1, musicLevel(mu, MZ.t, total)));
      const loops = mu.loop && mu.start < buf.duration - 0.5;
      a.addEventListener("ended", () => {
        if (loops && MZ.src && MZ.src.a === a) { a.currentTime = mu.start; a.play().catch(() => {}); }
      });
      a.play().catch(() => {});
      MZ.src = { a, total, mu, stop() { try { a.pause(); } catch (e) { /* gone */ } a.src = ""; } };
    }
    paintTime();
    const tick = () => {
      if (!MZ.playing || S.dead) return;
      MZ.t = Math.max(0, ac.currentTime - MZ.t0);
      if (MZ.src && MZ.src.a) MZ.src.a.volume = Math.max(0, Math.min(1, musicLevel(MZ.src.mu, MZ.t, MZ.src.total)));
      if (MZ.t >= total) { MZ.t = total; mstop(); }
      const i = shotAt(MZ.t);
      if (i !== MZ.cur) {
        MZ.cur = i;
        strip.querySelectorAll(".vly-mshot").forEach((el, j) => el.classList.toggle("cur", j === i));
        markCut();
        count.textContent = `${MZ.cur + 1} / ${MZ.shots.length}`;
        paintMotionTools();
        paintPicker(view());
      }
      drawStageNow();
      paintTime();
      if (MZ.playing) MZ.raf = requestAnimationFrame(tick);
      else paintMotionTools();
    };
    MZ.raf = requestAnimationFrame(tick);
  }
  function mgo(i) {
    if (!MZ.shots.length) return;
    mpause();
    MZ.cur = Math.max(0, Math.min(MZ.shots.length - 1, i));
    MZ.t = restT(MZ.shots[MZ.cur]);
    paint();
    const el = strip.querySelector(`.vly-mshot[data-s="${MZ.cur}"]`);
    if (el) el.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
  function setShot(key, val) {
    const s = MZ.shots[MZ.cur];
    if (!s) return;
    const m = mstate();
    // every chosen shot takes it - the move only where it has a picture
    for (const id of selIds()) {
      const sh = MZ.shots.find(x => x.id === id);
      if (!sh || (key === "move" && !sh.pick) || ((key === "cap" || key === "cpos") && sh.kind !== "pick")) continue;
      const set = m.set[id] || (m.set[id] = {});
      if (key === "pass" && sh !== MZ.shots[MZ.shots.length - 1]) {
        // a fade overlaps the next shot; a cut or black does not - the length
        // changes by the overlap, so the next shot still starts where it did
        const was = sh.pass === "fade" ? FADE_S : 0, now = val === "fade" ? FADE_S : 0;
        if (was !== now) set.dur = Math.round(Math.max(1, Math.min(20, sh.dur - was + now)) * 100) / 100;
      }
      set[key] = val;
    }
    MZ.t = Math.max(s.start, Math.min(MZ.t, s.start + s.dur));
    paint();
    if (key !== "cap" && key !== "pass" && key !== "cpos") MZ.t = restT(MZ.shots[MZ.cur]);
    drawStageNow();
  }
  tools.addEventListener("click", (e) => {
    if (!isMotion()) return;
    if (e.target.closest(".vly-play")) { mplay(); return; }
    if (e.target.closest(".mcover")) { MZ.coverOpen = !MZ.coverOpen; paint(); return; }
    if (e.target.closest(".mswap")) {
      const s = MZ.shots[MZ.cur];
      MZ.swapOpen = !swapOpen(s);
      MZ.swapShot = s ? s.id : null;
      paintPicker(view());
      paintMotionTools();
      return;
    }
    // any other work in the tools closes the picture panel
    if (MZ.swapOpen && e.target.closest("button, input")) MZ.swapOpen = false;
    const mv = e.target.closest("[data-mv]");
    if (mv) { setShot("move", mv.dataset.mv); return; }
    const ln = e.target.closest("[data-ln]");
    if (ln) { setShot("dur", Number(ln.dataset.ln)); return; }
    const ps = e.target.closest("[data-ps]");
    if (ps) { setShot("pass", ps.dataset.ps); return; }
    const cp = e.target.closest("[data-cap]");
    if (cp) { setShot("cap", cp.dataset.cap === "1"); return; }
    const cpos = e.target.closest("[data-cpos]");
    if (cpos) { setShot("cpos", cpos.dataset.cpos); return; }
  });
  tools.addEventListener("input", (e) => {
    if (!isMotion() || !e.target.closest(".scrub")) return;
    if (MZ.playing) mstop();
    MZ.t = Number(e.target.value);
    const i = shotAt(MZ.t);
    if (i !== MZ.cur) {
      MZ.cur = i;
      strip.querySelectorAll(".vly-mshot").forEach((el, j) => el.classList.toggle("cur", j === i));
      markCut();
      count.textContent = `${MZ.cur + 1} / ${MZ.shots.length}`;
    }
    drawStageNow();
    paintTime();
  });
  tools.addEventListener("change", (e) => {
    if (isMotion() && e.target.closest(".scrub")) paintMotionTools();
    const ln = isMotion() && e.target.closest(".lnum input");
    if (ln) {
      const v = Math.round(Math.max(1, Math.min(20, Number(ln.value) || 0)) * 10) / 10;
      if (v >= 1) setShot("dur", v);
    }
  });
  tools.addEventListener("keydown", (e) => {
    const ti = e.target.closest(".tmi");
    if (ti) {
      e.stopPropagation();
      if (e.key === "Enter") {
        const t = parseTc(ti.value);
        if (t != null) {
          mpause();
          MZ.t = Math.max(0, Math.min(motionLength(MZ.shots), t));
          MZ.cur = shotAt(MZ.t);
          ti.blur();
          paint();
        } else ti.value = tc(MZ.t);
      }
      if (e.key === "Escape") { ti.value = tc(MZ.t); ti.blur(); }
      return;
    }
    if (e.target.closest(".lnum input")) {
      e.stopPropagation();
      if (e.key === "Enter") e.target.blur();
    }
  });
  strip.addEventListener("click", (e) => {
    if (!isMotion()) return;
    const del = e.target.closest(".mdel");
    if (del) {
      e.stopPropagation();
      mpause();
      mstate().off[del.dataset.id] = true;
      paint();
      return;
    }
    if (e.target.closest(".edge")) return;
    const mk = e.target.closest(".tl-mk");
    if (mk) {
      e.stopPropagation();
      if (e.altKey) {
        const list = markerList();
        const mt = Number(mk.dataset.mt);
        if (list) { const i = list.findIndex(x => Math.abs(x - mt) < 0.001); if (i >= 0) list.splice(i, 1); }
        paintMarkers();
        paintMusic();
      } else {
        mpause();
        MZ.t = parseFloat(mk.style.left) / TL.pps;
        MZ.cur = shotAt(MZ.t);
        paint();
      }
      return;
    }
    const m = e.target.closest(".vly-mshot");
    if (m) {
      const i = Number(m.dataset.s), s = MZ.shots[i];
      if (!s) return;
      MZ.sel = MZ.sel || new Set();
      if (e.ctrlKey || e.metaKey) {
        if (!MZ.sel.size && MZ.shots[MZ.cur]) MZ.sel.add(MZ.shots[MZ.cur].id);
        if (MZ.sel.has(s.id) && MZ.sel.size > 1) MZ.sel.delete(s.id); else MZ.sel.add(s.id);
      } else if (e.shiftKey) {
        const a = Math.min(MZ.cur, i), b = Math.max(MZ.cur, i);
        MZ.sel = new Set(MZ.shots.slice(a, b + 1).map(x => x.id));
      } else {
        MZ.sel = new Set();
      }
      mgo(i);
      return;
    }
  }, true);
  stripH.addEventListener("click", (e) => {
    if (isMotion() && e.target.closest(".vly-mrestore")) { mstate().off = {}; paint(); }
  });
  musicBox.addEventListener("click", async (e) => {
    const mu = mstate().music;
    const pvm = e.target.closest("[data-pvm]");
    if (pvm) { P.vly_pvmode = pvm.dataset.pvm; paintMusic(); return; }
    if (e.target.closest(".mp-here")) {
      if (!PV.name || !P.vly_series) return;
      await setFilmEverywhere(PV.name, Math.floor(PV.t * 10) / 10);
      return;
    }
    if (e.target.closest(".mp-film")) {
      const name = PV.name || PV.last;
      if (!name || !P.vly_series || name === filmName()) return;
      await setFilmEverywhere(name);
      return;
    }
    if (e.target.closest(".mp-eqb")) { P.vly_eq = !eqOn(); paintMusic(); return; }
    const trk = e.target.closest(".mp-track");
    if (trk) {
      const L = pvLen();
      if (PV.audio && L) {
        const r = trk.getBoundingClientRect();
        PV.audio.currentTime = Math.max(0, Math.min(L - 0.2, (e.clientX - r.left) / r.width * L));
        PV.t = PV.audio.currentTime;
        trk.querySelector("i").style.width = `${pvFrac() * 100}%`;
      }
      return;
    }
    if (e.target.closest(".mu-back")) { P.vly_player = false; paint(); return; }
    const tr = e.target.closest("[data-tr]");
    if (tr) {
      e.stopPropagation();
      if (tr.dataset.tr === "pp") pvToggle(); else pvSkip(tr.dataset.tr === "next" ? 1 : -1);
      return;
    }
    const mk = e.target.closest("[data-pvmk]");
    if (mk) { e.stopPropagation(); pvMark(mk.dataset.pvmk); paintMusic(); return; }
    if (e.target.closest(".mu-mkx")) { P.vly_pvmark = []; paintMusic(); return; }
    if (e.target.closest(".mu-fin, .mu-rin")) return;
    const rg = e.target.closest("[data-mren-go]");
    if (rg) { e.stopPropagation(); SH.mren = rg.dataset.mrenGo; SH.menu = null; paintMusic(); return; }
    const fdx = e.target.closest("[data-fdx]");
    if (fdx) {
      e.stopPropagation();
      if (!fdx.classList.contains("armed")) {
        fdx.classList.add("armed");
        fdx.title = "Press again to delete the folder - the music stays";
        setTimeout(() => { if (fdx.isConnected) fdx.classList.remove("armed"); }, 4000);
        return;
      }
      SHELF.folders = SHELF.folders.filter(f => f.id !== fdx.dataset.fdx);
      P.vly_mview = "all";
      shelfSave();
      paintMusic();
      return;
    }
    const mv = e.target.closest("[data-mview]");
    if (mv) {
      if (mv.dataset.mview === muView()) return; // already shown - leaves a double-click to rename
      P.vly_mview = mv.dataset.mview; SH.menu = null; paintMusic(); return;
    }
    if (e.target.closest("[data-addf]")) { SH.newf = true; SH.rename = null; paintMusic(); return; }
    const fv = e.target.closest("[data-fav]");
    if (fv) {
      e.stopPropagation();
      const name = fv.dataset.fav;
      if (SHELF.fav.includes(name)) takeFrom("fav", name); else addTo("fav", [name]);
      shelfSave();
      paintMusic();
      return;
    }
    const fm = e.target.closest("[data-fmenu]");
    if (fm) { e.stopPropagation(); SH.menu = SH.menu === fm.dataset.fmenu ? null : fm.dataset.fmenu; paintMusic(); return; }
    const fin = e.target.closest("[data-fmin]");
    if (fin) {
      e.stopPropagation();
      const key = fin.dataset.fmin, name = fin.dataset.fmname;
      if (viewNames(key).includes(name)) takeFrom(key, name); else addTo(key, [name]);
      shelfSave();
      paintMusic();
      return;
    }
    if (e.target.closest(".mu-fm")) return;
    const up = e.target.closest("[data-mup]"), dn = e.target.closest("[data-mdn]");
    if (up || dn) {
      e.stopPropagation();
      if (moveIn(muView(), (up || dn).dataset[up ? "mup" : "mdn"], up ? -1 : 1)) { shelfSave(); paintMusic(); }
      return;
    }
    const out = e.target.closest("[data-mout]");
    if (out) {
      e.stopPropagation();
      takeFrom(muView(), out.dataset.mout);
      shelfSave();
      paintMusic();
      return;
    }
    const pv = e.target.closest("[data-pv]");
    if (pv) {
      e.stopPropagation();
      if (PV.name === pv.dataset.pv) pvPause();
      else pvPlay(pv.dataset.pv, Number(pv.dataset.from) || 0);
      return;
    }
    if (e.target.closest(".mu-pick")) { musicBox.querySelector(".mu-file").click(); return; }
    if (e.target.closest(".mu-x")) { mpause(); delete mu.name; delete mu.len; mu.start = 0; paint(); return; }
    if (e.target.closest(".mu-lib")) { P.vly_mlib = !P.vly_mlib; paintMusic(); fitNode(); return; }

    const del = e.target.closest("[data-mdel]");
    if (del) {
      e.stopPropagation();
      // twice to delete: the first press asks
      if (!del.classList.contains("armed")) {
        musicBox.querySelectorAll(".mu-del.armed").forEach(b => b.classList.remove("armed"));
        del.classList.add("armed");
        del.title = "Press again to delete it";
        setTimeout(() => { if (del.isConnected) { del.classList.remove("armed"); del.title = "Take it out of the list - the file is deleted"; } }, 4000);
        return;
      }
      const name = del.dataset.mdel;
      try {
        const r = await api.fetchApi(MUSIC_FORGET_URL, { method: "POST", body: JSON.stringify({ name }) });
        const j = await r.json();
        if (!j.ok) throw new Error(j.error || "could not be deleted");
        MZ.bufs.delete(name);
        if (mu.name === name) { mpause(); delete mu.name; delete mu.len; mu.start = 0; }
      } catch (err) { say(`Not deleted: ${err && err.message || err}`, true); }
      await loadLib(true);
      paint();
      return;
    }
    const it = e.target.closest("[data-mname]");
    if (it && isPlayer()) {
      // in the player a piece is only played, never set to the film
      const name = it.dataset.mname;
      if (PV.name === name) pvPause(); else pvPlay(name, 0);
      return;
    }
    if (it) {
      const name = it.dataset.mname;
      if (name === mu.name) return;
      mpause();
      mu.name = name;
      mu.start = 0;
      delete mu.len;
      const b = await musicBuffer(name);
      if (b) mu.len = b.duration;
      say(b ? `Music: ${name} \u00b7 ${clock(b.duration)}` : `This browser cannot play ${name}`, !b);
      paint();
      return;
    }
    const lp = e.target.closest("[data-loop]");
    if (lp) { mpause(); mu.loop = lp.dataset.loop === "1"; paintMusic(); return; }
    const fo = e.target.closest("[data-fo]");
    if (fo) { mu.fade = Number(fo.dataset.fo); paintMusic(); }
  });
  musicBox.addEventListener("dblclick", (e) => {
    const t = e.target.closest("[data-mview^='f:']");
    if (!t || e.target.closest("[data-fdx]")) return;
    SH.rename = t.dataset.mview.slice(2);
    SH.newf = false;
    paintMusic();
  });
  musicBox.addEventListener("keydown", (e) => {
    const ri = e.target.closest(".mu-rin");
    if (ri) {
      e.stopPropagation();
      if (e.key === "Enter") { e.preventDefault(); finishRename(ri, true); }
      else if (e.key === "Escape") { e.preventDefault(); finishRename(ri, false); }
      return;
    }
    const inp = e.target.closest(".mu-fin");
    if (!inp) return;
    e.stopPropagation();
    if (e.key === "Enter") { e.preventDefault(); finishFin(inp, true); }
    else if (e.key === "Escape") { e.preventDefault(); finishFin(inp, false); }
  });
  musicBox.addEventListener("focusout", (e) => {
    const ri = e.target.closest && e.target.closest(".mu-rin");
    if (ri) { setTimeout(() => finishRename(ri, true), 0); return; }
    const inp = e.target.closest && e.target.closest(".mu-fin");
    if (inp) setTimeout(() => finishFin(inp, true), 0);
  });
  /* A piece dragged from the list onto Favourites or a folder joins it. */
  musicBox.addEventListener("dragstart", (e) => {
    const it = e.target.closest && e.target.closest(".mu-it");
    if (!it) return;
    SH.drag = it.dataset.mname;
    it.classList.add("drag");
    try { e.dataTransfer.setData("text/x-vly-music", SH.drag); e.dataTransfer.effectAllowed = "copy"; } catch (err) { /* old browser */ }
  });
  musicBox.addEventListener("dragend", () => {
    SH.drag = null;
    musicBox.querySelectorAll(".mu-it.drag, .mu-tab.over").forEach(el => el.classList.remove("drag", "over"));
  });
  musicBox.addEventListener("dragover", (e) => {
    if (!SH.drag) return;
    const t = e.target.closest(".mu-tab.tgt");
    musicBox.querySelectorAll(".mu-tab.over").forEach(el => { if (el !== t) el.classList.remove("over"); });
    if (!t) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
    t.classList.add("over");
  });
  musicBox.addEventListener("drop", (e) => {
    if (!SH.drag) return;
    const t = e.target.closest(".mu-tab.tgt");
    const name = SH.drag;
    SH.drag = null;
    if (!t) return;
    e.preventDefault();
    e.stopPropagation();
    const key = t.dataset.mview;
    if (addTo(key, [name])) { shelfSave(); say(`${name} \u2192 ${viewTitle(key)}`); }
    else say(`${name} is already in ${viewTitle(key)}`);
    paintMusic();
  });
  musicBox.addEventListener("input", (e) => {
    const vr = e.target.closest(".mp-volr");
    if (vr) { P.vly_pvvol = Number(vr.value); vr.style.setProperty("--v", `${Math.round(pvVol() * 100)}%`); if (PV.audio) PV.audio.volume = pvVol(); return; }
    const mu = mstate().music;
    if (e.target.closest(".mu-start")) {
      mpause();
      mu.start = Number(e.target.value);
      const sv = musicBox.querySelector(".mu-sv");
      if (sv) sv.textContent = clock(mu.start);
    }
    if (e.target.closest(".mu-vol")) mu.vol = Number(e.target.value);
  });
  musicBox.addEventListener("change", async (e) => {
    if (e.target.closest(".mu-start") || e.target.closest(".mu-vol")) { paintMusic(); return; }
    const inp = e.target.closest(".mu-file");
    if (!inp || !inp.files || !inp.files[0]) return;
    const file = inp.files[0];
    mpause();
    say(`Reading ${file.name}…`);
    try {
      const r = await api.fetchApi(`${MUSIC_URL}?name=${encodeURIComponent(file.name)}`, { method: "POST", body: file });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "the music could not be kept");
      const mu = mstate().music;
      mu.name = j.name;
      mu.start = 0;
      delete mu.len;
      MZ.bufs.delete(j.name);
      const b = await musicBuffer(j.name);
      if (!b) throw new Error("this browser cannot play that file");
      mu.len = b.duration;
      say(`Music: ${j.name} · ${clock(b.duration)}`);
      loadLib(true);
    } catch (err) {
      say(`Music not set: ${err && err.message || err}`, true);
    }
    inp.value = "";
    paint();
  });

  /* Music dropped on the MUSIC panel: every piece is kept in the list. The
     film takes the first of them only when it has no music yet. */
  const AUDIO_EXT = /\.(mp3|wav|m4a|aac|ogg|oga|flac|opus|webm)$/i;
  const audioFiles = (dt) => [...((dt && dt.files) || [])].filter(f => AUDIO_EXT.test(f.name) || /^audio\//.test(f.type));
  const hasFiles = (dt) => !!dt && [...(dt.types || [])].includes("Files");
  musicBox.addEventListener("dragover", (e) => {
    if (!hasFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
    musicBox.classList.add("drop");
  });
  musicBox.addEventListener("dragleave", (e) => {
    if (!musicBox.contains(e.relatedTarget)) musicBox.classList.remove("drop");
  });
  musicBox.addEventListener("drop", async (e) => {
    if (!hasFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    musicBox.classList.remove("drop");
    const files = audioFiles(e.dataTransfer);
    if (!files.length) { say("Only music can be dropped here - MP3, WAV, M4A, OGG, FLAC", true); return; }
    const kept = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      say(`Keeping ${f.name}… ${files.length > 1 ? `(${i + 1} / ${files.length})` : ""}`);
      try {
        const r = await api.fetchApi(`${MUSIC_URL}?name=${encodeURIComponent(f.name)}`, { method: "POST", body: f });
        const j = await r.json();
        if (!j.ok) throw new Error(j.error || "could not be kept");
        kept.push(j.name);
      } catch (err) { say(`${f.name} not kept: ${err && err.message || err}`, true); }
    }
    if (!kept.length) return;
    const into = muView();
    if (into !== "all" && addTo(into, kept)) shelfSave();
    await loadLib(true);
    P.vly_mlib = true;
    const mu = mstate().music;
    if (!mu.name) {
      mpause();
      mu.name = kept[0];
      mu.start = 0;
      delete mu.len;
      MZ.bufs.delete(kept[0]);
      const b = await musicBuffer(kept[0]);
      if (b) mu.len = b.duration;
    }
    say(kept.length === 1 ? `${kept[0]} added to the list` : `${kept.length} pieces added to the list`);
    paint();
    fitNode();
  });

  /* Framing a shot: drag the picture where it should sit in the frame; the
     move runs from there. Double-click puts it back in the middle. */
  let drag = null;
  function frameRoom(s, G) {
    const im = s && s.pick ? MZ.pics.get(String(s.pick.id)) : null;
    const iw = im ? im.naturalWidth : (s && s.pick ? s.pick.w : 0), ih = im ? im.naturalHeight : (s && s.pick ? s.pick.h : 0);
    if (!iw || !ih) return null;
    const base = Math.max(G.pw / iw, G.ph / ih);
    const room = (a, frame) => {
      const r = (a * base - frame) / 2;
      return r > frame * 0.01 ? r : (a * base * 1.09 - frame) / 2;
    };
    return { x: Math.max(0, room(iw, G.pw)), y: Math.max(0, room(ih, G.ph)) };
  }
  canvas.addEventListener("pointerdown", (e) => {
    if (!isMotion() || e.button !== 0) return;
    const s = MZ.shots[MZ.cur];
    if (!s || !s.pick) return;
    mpause();
    const G = geo();
    const room = frameRoom(s, G);
    if (!room) return;
    e.preventDefault();
    e.stopPropagation();
    canvas.setPointerCapture(e.pointerId);
    drag = { id: s.id, x: e.clientX, y: e.clientY, fx: s.fx, fy: s.fy, room, scale: stageScale(G) * (app.canvas && app.canvas.ds ? app.canvas.ds.scale : 1) };
    canvas.classList.add("dragging");
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const s = MZ.shots[MZ.cur];
    if (!s || s.id !== drag.id) return;
    const dx = (e.clientX - drag.x) / drag.scale, dy = (e.clientY - drag.y) / drag.scale;
    const cl = (v) => Math.max(-1, Math.min(1, v));
    s.fx = drag.room.x > 0.01 ? cl(drag.fx + dx / drag.room.x) : 0;
    s.fy = drag.room.y > 0.01 ? cl(drag.fy + dy / drag.room.y) : 0;
    drawStageNow();
  });
  const endDrag = () => {
    if (!drag) return;
    const s = MZ.shots[MZ.cur];
    if (s && s.id === drag.id) {
      const m = mstate();
      const set = m.set[s.id] || (m.set[s.id] = {});
      set.frame = set.frame || {};
      set.frame[geo().fmt.id] = [Math.round(s.fx * 1000) / 1000, Math.round(s.fy * 1000) / 1000];
    }
    drag = null;
    canvas.classList.remove("dragging");
    paintShots(geo());
  };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("dblclick", (e) => {
    if (!isMotion()) return;
    const s = MZ.shots[MZ.cur];
    if (!s || !s.pick) return;
    e.stopPropagation();
    const m = mstate();
    const set = m.set[s.id] || (m.set[s.id] = {});
    if (set.frame) delete set.frame[geo().fmt.id];
    paint();
  });

  // ---- recording the film
  function openMotionExport() {
    if (!S.book || MZ.recording) return;
    closePop();
    mpause();
    const o = expOpts();
    o.motion = { sizes: null, rate: 40, ...(o.motion || {}) };
    if (![60, 40, 20].includes(o.motion.rate)) o.motion.rate = 40;
    if (!o.motion.sizes) o.motion.sizes = [P.vly_fmt.motion];
    const mime = motionMime();
    let enc = false;
    const name = S.book.series;
    pop = document.createElement("div");
    pop.className = "vly-pop wide vly-exp";
    pop.innerHTML = `
      <div class="hd"><span class="tt">Export</span><span class="kb">Motion</span>
        <span class="kb2">${esc(name)}</span>
        <button class="xx" title="Close">${ICON.close}</button></div>
      <div class="ex-body">
        <div class="ex-prev"><canvas></canvas><span class="ex-cap"></span></div>
        <div class="ex-opts"></div>
      </div>
      <div class="ft"><span class="w"></span>
        <button class="pbtn cancel">Cancel</button>
        <button class="pbtn ok go"${mime ? "" : " disabled"}>Export</button></div>`;
    document.body.appendChild(pop);
    const opts = pop.querySelector(".ex-opts"), w = pop.querySelector(".ft .w");
    const total = motionLength(MZ.shots);
    const fill = () => {
      const mo = o.motion;
      let html = `<div class="row2"><span class="lab">FORMAT</span><span class="fmtx">${enc ? `MP4 · H.264 video${enc === "aac" ? ", AAC sound" : enc === "opus" ? ", Opus sound" : ""} · 30 frames a second`
        : mime ? (mime.startsWith("video/mp4") ? "MP4 · H.264 video, AAC sound" : "WebM · VP9 video, Opus sound - this browser does not record MP4")
        : `<span class="warn">This browser cannot record video.</span>`}</span></div>`;
      html += `<div class="row2 top"><span class="lab">SIZES</span><div class="ex-sizes">` + MOTION_SIZES.map(ps =>
        `<label class="ck${mo.sizes.includes(ps.id) ? " on" : ""}" data-size="${ps.id}"><span class="bx"></span>
          <span><b>${esc(ps.label)}</b><i>${esc(ps.note)}</i></span></label>`).join("") + `</div></div>`;
      html += `<div class="row2"><span class="lab">QUALITY</span><span class="pseg" data-k="rate">`
        + [[60, "Best", "60 Mbit/s - for editing further or keeping"], [40, "High", "40 Mbit/s"], [20, "Standard", "20 Mbit/s - smaller files"]].map(([v, l, h]) =>
          `<button class="${mo.rate === v ? "on" : ""}" data-v="${v}" title="${h}">${l}</button>`).join("") + `</span></div>`;
      html += `<div class="row2"><span class="lab">NAME</span><input class="enm" spellcheck="false" value="${esc(o.name[P.vly_series] || name)}" /></div>`;
      html += `<div class="row2 top"><span class="lab">SAVE TO</span><div class="ex-dir">
        <input class="edir" value="${esc(o.dir[`${P.vly_series}|motion`] || "")}" placeholder="output / ${esc(name)} / layout / motion  - leave empty for this" />
        <span class="note2">The films are <b>${esc(o.name[P.vly_series] || name)} - 9x16.mp4</b> and so on, one for each size; a name already there gets (2), (3)… - nothing is written over.</span></div></div>`;
      html += `<div class="row2 top"><span class="lab">NOTE</span><span class="note2">${enc
        ? "The film is written frame by frame, with its music mixed apart - nothing dropped, as sharp as the bitrate allows."
        : `This browser has no H.264 encoder to write it frame by frame: the film is recorded as it plays, with its music - each size takes as long as the film runs (${clock(total)}). Keep this browser window in front while it records.`}</span></div>`;
      opts.innerHTML = html;
      const n = mo.sizes.length;
      w.innerHTML = n ? `${n} film${n === 1 ? "" : "s"} · ${clock(total)} each · ${MZ.shots.length} shots${mstate().music.name ? " · with music" : ""}`
        : `<span class="warn">Choose at least one size.</span>`;
      const pv = pop.querySelector(".ex-prev canvas");
      const G1 = geo();
      const sc = Math.min(300 / G1.pw, 300 / G1.ph), dpr = window.devicePixelRatio || 1;
      pv.width = Math.round(G1.pw * sc * dpr); pv.height = Math.round(G1.ph * sc * dpr);
      pv.style.width = `${G1.pw * sc}px`; pv.style.height = `${G1.ph * sc}px`;
      const at = MZ.t < OPEN_S && MZ.shots[MZ.cur] ? restT(MZ.shots[MZ.cur]) : MZ.t;
      drawMotion(pv.getContext("2d"), sc * dpr, G1, S.book, MZ.shots, at, MZ.pics);
      pop.querySelector(".ex-cap").textContent = `${clock(at)} / ${clock(total)}`;
    };
    pop.addEventListener("click", (e) => {
      if (e.target.closest(".xx") || e.target.closest(".cancel")) { closePop(); return; }
      const b = e.target.closest(".pseg button");
      if (b) { o.motion.rate = Number(b.dataset.v); fill(); return; }
      const size = e.target.closest("[data-size]");
      if (size) {
        const id = size.dataset.size, s0 = o.motion.sizes;
        o.motion.sizes = MOTION_SIZES.map(p => p.id).filter(x => (x === id ? !s0.includes(x) : s0.includes(x)));
        fill();
        return;
      }
      if (e.target.closest(".go")) {
        if (!o.motion.sizes.length || (!mime && !enc)) return;
        const post = postOf();
        closePop();
        recordMotion(o.motion.sizes.slice(), (o.dir[`${P.vly_series}|motion`] || "").trim(),
          cleanName(o.name[P.vly_series] || name), o.motion.rate, mime || "video/webm", post);
      }
    });
    pop.addEventListener("input", (e) => {
      if (e.target.closest(".enm")) {
        const t = e.target.value.trim();
        if (t && t !== name) o.name[P.vly_series] = t; else delete o.name[P.vly_series];
      }
      if (e.target.closest(".edir")) {
        const t = e.target.value.trim(), kk = `${P.vly_series}|motion`;
        if (t) o.dir[kk] = t; else delete o.dir[kk];
      }
    });
    pop.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); closePop(); } });
    fill();
    const postOf = mountPost(pop);
    const here = pop;
    canEncode(!!mstate().music.name).then((ok) => {
      if (pop !== here) return;
      enc = ok;
      if (enc) { const g = pop.querySelector(".go"); if (g) g.disabled = false; }
      fill();
    });
  }

  async function recordMotion(sizes, dir, name, rate, mime, post) {
    MZ.recording = S.exporting = true;
    exportBtn.disabled = true;
    const book = S.book, v = view();
    const ext = mime.startsWith("video/mp4") ? "mp4" : "webm";
    const mu = { ...mstate().music };
    const buf = mu.name ? await musicBuffer(mu.name) : null;
    const done = [];
    let stopped = false;
    // the recording, small, with its progress and a way to stop it
    const ov = document.createElement("div");
    ov.className = "vly-pop vly-rec";
    ov.innerHTML = `<div class="hd"><span class="tt">Exporting</span><span class="kb sz"></span><span class="kb2 pr"></span></div>
      <div class="rc-body"><canvas></canvas></div>
      <div class="ft"><span class="w">Each size is written in turn.</span>
        <button class="pbtn cancel">Stop</button></div>`;
    document.body.appendChild(ov);
    const pv = ov.querySelector("canvas");
    ov.querySelector(".cancel").addEventListener("click", () => { stopped = true; });
    try {
      await fontsFor(P.vly_font);
      await logoReady();
      for (const id of sizes) {
        if (stopped) break;
        const G = geometry("web", id, P.vly_font, P.vly_theme, P.vly_textpos, P.vly_size);
        const tag = (MOTION_SIZES.find(s => s.id === id) || {}).tag || id;
        const shots = motionShots(book, v, G);
        const total = motionLength(shots);
        ov.querySelector(".sz").textContent = tag.replace("x", ":");
        ov.querySelector(".pr").textContent = "Loading the pictures…";
        const pics = await motionPics(shots, 0, true);
        const sc0 = Math.min(420 / G.pw, 420 / G.ph);
        const film = await encodeFilm(G, book, shots, pics, buf, mu, rate, (p, src, t, msg) => {
          if (pv.width !== Math.round(G.pw * sc0)) { pv.width = Math.round(G.pw * sc0); pv.height = Math.round(G.ph * sc0); }
          pv.getContext("2d").drawImage(src, 0, 0, pv.width, pv.height);
          ov.querySelector(".pr").textContent = msg || `${clock(t)} / ${clock(total)} \u00b7 ${Math.round(p * 100)}%`;
        }, () => stopped);
        if (film === "stopped") break;
        if (film) {
          ov.querySelector(".pr").textContent = "Writing the film\u2026";
          const token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
          const PART = 8 * 1024 * 1024;
          for (let off = 0, idx = 1; off < film.byteLength; off += PART, idx++) {
            const r = await api.fetchApi(`${VIDEO_PART_URL}?token=${token}&index=${idx}`, { method: "POST", body: new Blob([film.subarray(off, off + PART)]) });
            const j = await r.json();
            if (!j.ok) throw new Error(j.error || "a part of the film could not be written");
          }
          const r = await api.fetchApi(VIDEO_DONE_URL, { method: "POST", body: JSON.stringify({ token, series: book.series,
            folder: dir, name, size: tag, ext: "mp4" }) });
          const j = await r.json();
          if (!j.ok) throw new Error(j.error || "the film could not be written");
          done.push(j.path);
          continue;
        }
        // no encoder here: record it as it plays
        ov.querySelector(".ft .w").textContent = "Keep this window in front - the film is recorded as it plays.";
        const k = G.exportK;
        const cv = document.createElement("canvas");
        cv.width = Math.round(G.pw * k);
        cv.height = Math.round(G.ph * k);
        const ctx = cv.getContext("2d");
        const sc = Math.min(420 / G.pw, 420 / G.ph);
        pv.width = Math.round(G.pw * sc); pv.height = Math.round(G.ph * sc);
        const pctx = pv.getContext("2d");
        drawMotion(ctx, k, G, book, shots, 0, pics);
        const stream = cv.captureStream(MOTION_FPS);
        const ac = new (window.AudioContext || window.webkitAudioContext)();
        const src = null;     // recorded as it plays: the picture only
        const token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
        let part = 0, sending = Promise.resolve(), failed = null;
        const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: rate * 1e6, audioBitsPerSecond: 192000 });
        rec.ondataavailable = (ev) => {
          if (!ev.data || !ev.data.size) return;
          const idx = ++part, blob = ev.data;
          sending = sending.then(async () => {
            if (failed) return;
            try {
              const r = await api.fetchApi(`${VIDEO_PART_URL}?token=${token}&index=${idx}`, { method: "POST", body: blob });
              const j = await r.json();
              if (!j.ok) failed = j.error || "a part of the film could not be written";
            } catch (err) { failed = String(err && err.message || err); }
          });
        };
        const ended = new Promise(res => { rec.onstop = res; });
        await ac.resume();
        rec.start(2000);
        const at = ac.currentTime + 0.25;
        await new Promise((resolve) => {
          const tick = () => {
            const T = ac.currentTime - at;
            drawMotion(ctx, k, G, book, shots, Math.max(0, T), pics);
            pctx.drawImage(cv, 0, 0, pv.width, pv.height);
            ov.querySelector(".pr").textContent = `${clock(Math.max(0, T))} / ${clock(total)}`;
            if (stopped || T >= total + 0.15) { resolve(); return; }
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
        rec.stop();
        await ended;
        await sending;
        if (src) { try { src.stop(); } catch (e) { /* ended */ } }
        stream.getTracks().forEach(t => t.stop());
        try { await ac.close(); } catch (e) { /* closed */ }
        cv.width = cv.height = 0;
        if (stopped) {
          await api.fetchApi(VIDEO_DONE_URL, { method: "POST", body: JSON.stringify({ token, cancel: true }) });
          break;
        }
        if (failed) throw new Error(failed);
        ov.querySelector(".pr").textContent = "Writing the film…";
        const r = await api.fetchApi(VIDEO_DONE_URL, { method: "POST", body: JSON.stringify({ token, series: book.series,
          folder: dir, name, size: tag, ext }) });
        const j = await r.json();
        if (!j.ok) throw new Error(j.error || "the film could not be written");
        done.push(j.path);
      }
      if (stopped) say(done.length ? `Stopped - ${done.length} film${done.length === 1 ? "" : "s"} written: ${done.join(" · ")}` : "Export stopped - nothing written.");
      else {
        const pp = post && done.length ? await savePost(post, dir, name, "motion") : null;
        say(`${done.length} film${done.length === 1 ? "" : "s"} written: ${done.join(" · ")}` + (pp ? ` \u00b7 the post: ${pp.split(/[\\/]/).pop()}` : ""));
      }
    } catch (err) {
      say(`Export stopped: ${err && err.message || err}`, true);
    } finally {
      ov.remove();
      MZ.recording = S.exporting = false;
      exportBtn.disabled = false;
    }
    return { done, stopped };      // the Idea Box sends what was written
  }

  serSel.addEventListener("change", () => {
    P.vly_series = serSel.value;
    S.cur = 0;
    S.sig = "";
    say("");
    loadBook();
  });

  /* LIVE: the series opened in the Series Book is the one laid out here, as
     the Lab, the Viewer and the Report follow it. Only a change in the book
     is followed, so a series chosen here by hand stays until the book opens
     another one. */
  function paintLive() {
    liveBtn.classList.toggle("on", !!P.vly_live);
  }
  async function goSeries(name, why) {
    const want = String(name || "").trim();
    if (!want || S.dead || S.exporting || MZ.recording) return;
    const find = () => (S.list || []).find(x => String(x.name).trim().toLowerCase() === want.toLowerCase());
    let hit = find();
    if (!hit) { await loadList(); hit = find(); }
    if (!hit) { say(`"${want}" is open in the book but not saved yet - save the series in the book to lay it out`); return; }
    if (hit.name === P.vly_series) return;
    if (P.vly_cat === "motion") mpause();
    closePop();
    P.vly_series = hit.name;
    serSel.value = hit.name;
    S.cur = 0;
    S.sig = "";
    MZ.cur = 0;
    say(`${hit.name} - ${why || "opened in the Series Book"}`);
    loadBook();
  }
  /* the series open in a Series Book on the canvas: the one with its prompt open */
  function bookSeries() {
    const nodes = (app.graph && (app.graph._nodes || app.graph.nodes)) || [];
    for (const n of nodes) {
      if ((n.comfyClass || n.type) !== BOOK) continue;
      for (const w of n.widgets || []) {
        if (!w.element) continue;
        const box = w.element.querySelector(".lsb-pbox.cur");
        const nm = box && box.querySelector(".lsb-gname");
        if (nm) return nm.textContent.trim();
      }
    }
    return "";
  }
  let seenBook = null;
  function followBook() {
    const cur = bookSeries();
    if (cur === seenBook) return;
    seenBook = cur;
    if (P.vly_live && cur) goSeries(cur);
  }
  const onSeriesOpened = (e) => {
    const names = (e && e.detail && e.detail.names) || [];
    if (S.dead || !P.vly_live || !names.length || !root.isConnected) return;
    goSeries(names[0], "opened in the Series Book");
  };
  window.addEventListener("leiel-series-opened", onSeriesOpened);
  liveBtn.addEventListener("click", () => {
    P.vly_live = !P.vly_live;
    paintLive();
    say(P.vly_live ? "LIVE - following the series opened in the Series Book" : "LIVE off - staying on this series");
    if (P.vly_live) { seenBook = null; followBook(); }
  });
  paintLive();
  catSeg.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b || b.dataset.c === P.vly_cat) return;
    if (P.vly_cat === "motion") mpause();
    P.vly_cat = b.dataset.c;
    S.cur = 0;
    paint();
  });
  fmtSel.addEventListener("change", () => {
    P.vly_fmt[P.vly_cat] = fmtSel.value;
    paint();
  });
  fontsBtn.addEventListener("click", openFonts);
  $(".ud").addEventListener("click", () => undo());
  $(".rd").addEventListener("click", () => redo());
  // changes painted only in part - a shot's tools, a slider - are caught here
  const histWatch = setInterval(() => { if (!S.dead && root.isConnected && !document.hidden) record(); }, 700);
  $(".rf").addEventListener("click", async () => {
    say("Reading the book and the picks…");
    S.sig = "";
    await loadList();
    await loadBook();
    say("");
  });
  $(".fs").addEventListener("click", openFull);
  $(".mp").addEventListener("click", () => { P.vly_player = true; P.vly_mlib = true; paint(); });
  exportBtn.addEventListener("click", () => (isMotion() ? openMotionExport() : openExport()));

  /* Idea Box: what is made here kept with the ideas. A small window asks
     how: in Print and Web as JPEG or PNG pictures - the page shown now or
     every page, each an idea of its own - or as one PDF; in Motion the film
     is exported as it would be (this size, high quality) and then sent.
     Everything sent waits with the new ones in the Idea Box, the series and
     the page in its notes. */
  const IDEA_LONG = 2400;          // pixels on the long side: enough to look closely, light to keep
  function ideaOpts() {
    const o = P.vly_idea && typeof P.vly_idea === "object" ? P.vly_idea : (P.vly_idea = {});
    if (!["jpg", "png", "pdf"].includes(o.fmt)) o.fmt = "jpg";
    if (!["this", "all"].includes(o.range)) o.range = "this";
    return o;
  }
  async function ideaPost(url, body, isJson) {
    const r = await api.fetchApi(url, isJson ? { method: "POST", body: JSON.stringify(body) } : { method: "POST", body });
    const j = await r.json().catch(() => ({ ok: false }));
    if (!j.ok) throw new Error(j.error || "is the Visual Idea Box installed?");
    return j;
  }
  function openIdeaBox() {
    if (!S.book || S.exporting) return;
    closePop();
    const o = ideaOpts();
    const motion = isMotion();
    const web = P.vly_cat === "web";
    pop = document.createElement("div");
    pop.className = "vly-pop vly-exp vly-ideapop";
    pop.innerHTML = `
      <div class="hd"><span class="tt">To the Idea Box</span><span class="kb">${motion ? "Motion" : web ? "Web" : "Print"}</span>
        <span class="kb2">${esc(S.book.series)}</span>
        <button class="xx" title="Close">${ICON.close}</button></div>
      <div class="ex-opts"></div>
      <div class="ft"><span class="w"></span>
        <button class="pbtn cancel">Cancel</button>
        <button class="pbtn ok go">Send</button></div>`;
    document.body.appendChild(pop);
    const opts = pop.querySelector(".ex-opts"), w = pop.querySelector(".ft .w");
    const seg = (key, items, cur) => `<span class="pseg" data-k="${key}">` + items.map(([id, label, hint]) =>
      `<button class="${id === cur ? "on" : ""}" data-v="${id}" title="${esc(hint || "")}">${esc(label)}</button>`).join("") + `</span>`;
    const unit = web ? "frame" : "spread";
    const fill = () => {
      let html = "";
      if (motion) {
        const size = (MOTION_SIZES.find(s => s.id === P.vly_fmt.motion) || {});
        html += `<div class="row2"><span class="lab">FILM</span><span class="fmtx">${esc((size.tag || P.vly_fmt.motion).replace("x", ":"))} · ${esc(size.label || "")} · High quality</span></div>`;
        html += `<div class="row2 top"><span class="lab">NOTE</span><span class="note2">The film is exported first, as Export would write it - into output / ${esc(S.book.series)} / layout / motion - and then sent. It takes as long as the export does.</span></div>`;
        w.textContent = "1 film → the Idea Box";
      } else {
        html += `<div class="row2"><span class="lab">FORMAT</span>${seg("fmt", [["jpg", "JPEG", "Each page a picture - light"],
          ["png", "PNG", "Each page a picture - nothing lost"], ["pdf", "PDF", "One PDF of the pages, to page through in the Idea Box"]], o.fmt)}</div>`;
        html += `<div class="row2"><span class="lab">PAGES</span>${seg("range", [["this", `This ${unit}`, ""], ["all", `Every ${unit}`, ""]], o.range)}</div>`;
        const n = o.range === "all" ? S.sheets.length : 1;
        html += `<div class="row2 top"><span class="lab">NOTE</span><span class="note2">${o.fmt === "pdf"
          ? `One PDF, ${IDEA_LONG} pixels on the long side of each page. It is written into output / ${esc(S.book.series)} / layout as well.`
          : `Each ${unit} is an idea of its own, ${IDEA_LONG} pixels on its long side, with the series and its number in the notes.`}</span></div>`;
        w.textContent = o.fmt === "pdf" ? `1 PDF of ${n} ${unit}${n === 1 ? "" : "s"} → the Idea Box`
          : `${n} ${o.fmt === "png" ? "PNG" : "JPEG"} picture${n === 1 ? "" : "s"} → the Idea Box`;
      }
      opts.innerHTML = html;
    };
    pop.addEventListener("click", (e) => {
      if (e.target.closest(".xx") || e.target.closest(".cancel")) { closePop(); return; }
      const b = e.target.closest(".pseg button");
      if (b) { o[b.closest(".pseg").dataset.k] = b.dataset.v; fill(); return; }
      if (e.target.closest(".go")) {
        closePop();
        if (motion) sendFilmToIdeaBox(); else sendPagesToIdeaBox(o.fmt, o.range);
      }
    });
    pop.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); closePop(); } });
    fill();
  }

  async function sendPagesToIdeaBox(fmt, range) {
    const book = S.book;
    S.exporting = true;
    ideaBtn.disabled = exportBtn.disabled = true;
    try {
      await fontsFor(P.vly_font);
      await logoReady();
      const G = geo();
      const v = view();
      const all = buildSheets(book, v, G);
      const at = Math.min(S.cur, all.length - 1);
      const list = range === "all" ? all.map((sh, i) => [sh, i]) : [[all[at], at]];
      const k = IDEA_LONG / Math.max(G.sheetW, G.sheetH);
      const token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
      let n = 0;
      for (const [sh, i] of list) {
        if (!sh) continue;
        n++;
        say(`Sending to the Idea Box - ${n} of ${list.length}…`);
        const pics = await picsFor([sh], 0, true);
        const cv = document.createElement("canvas");
        cv.width = Math.round(G.sheetW * k);
        cv.height = Math.round(G.sheetH * k);
        drawSheet(cv.getContext("2d"), k, sh, G, book, v, pics, false);
        const no = String(i + 1).padStart(2, "0");
        if (fmt === "pdf") {
          await ideaPost(PDF_PAGE_URL, { token, index: n, data: cv.toDataURL("image/jpeg", 0.92) }, true);
        } else {
          const type = fmt === "png" ? "image/png" : "image/jpeg";
          const blob = await new Promise(res => cv.toBlob(res, type, 0.92));
          const memo = `${book.series} · ${no} ${sheetName(sh)}\n${G.fmt.label}${G.fmt.size ? " · " + G.fmt.size : ""}`;
          /* one's own work: into My works, under its series */
          const q = new URLSearchParams({ name: `${book.series} ${no}.${fmt}`, via: "layout", memo, work: "1", wfolder: book.series });
          await ideaPost(`/leiel_idea/add?${q}`, blob, false);
        }
        cv.width = cv.height = 0;
      }
      if (fmt === "pdf") {
        say("Writing the PDF…");
        const j = await ideaPost(PDF_DONE_URL, { token, series: book.series, format: G.fmt.id, folder: "",
          name: `${book.series} - Idea Box`, page: [G.sheetW, G.sheetH] }, true);
        await ideaPost("/leiel_idea/add_file", { path: j.path, via: "layout", work: true, wfolder: book.series,
          memo: `${book.series} · PDF\n${n} ${P.vly_cat === "web" ? "frame" : "spread"}${n === 1 ? "" : "s"} · ${G.fmt.label}` }, true);
        say(`The PDF is in the Idea Box - My works › ${book.series}. (Also written: ${j.path})`);
      } else {
        say(`${n} ${n === 1 ? "page is" : "pages are"} in the Idea Box - My works › ${book.series}.`);
      }
    } catch (e) {
      say(`Not sent: ${e && e.message || e}`, true);
    } finally {
      S.exporting = false;
      ideaBtn.disabled = exportBtn.disabled = false;
    }
  }

  async function sendFilmToIdeaBox() {
    const mime = motionMime();
    const res = await recordMotion([P.vly_fmt.motion], "", cleanName(S.book.series), 40, mime || "video/webm", null);
    if (!res || !res.done.length) return;          // stopped, or it said why
    try {
      ideaBtn.disabled = true;
      for (const path of res.done) {
        say("Sending the film to the Idea Box…");
        await ideaPost("/leiel_idea/add_file", { path, via: "layout", work: true, wfolder: S.book.series,
          memo: `${S.book.series}\nFilm · ${path.split(/[\\/]/).pop()}` }, true);
      }
      say(`The film is in the Idea Box - My works › ${S.book.series}. (Also written: ${res.done.join(" · ")})`);
    } catch (e) {
      say(`Not sent: ${e && e.message || e}`, true);
    } finally {
      ideaBtn.disabled = false;
    }
  }
  ideaBtn.addEventListener("click", openIdeaBox);
  packBtn.addEventListener("click", openPackage);
  linksBtn.addEventListener("click", openLinks);
  navL.addEventListener("click", () => (isMotion() ? mgo(MZ.cur - 1) : go(S.cur - 1)));
  navR.addEventListener("click", () => (isMotion() ? mgo(MZ.cur + 1) : go(S.cur + 1)));
  full.querySelector(".vly-nav.l").addEventListener("click", () => go(S.cur - 1));
  full.querySelector(".vly-nav.r").addEventListener("click", () => go(S.cur + 1));
  full.querySelector(".x").addEventListener("click", closeFull);
  root.querySelector(".vly-h .fall").addEventListener("click", () => {
    if (!S.book) return;
    const all = S.book.scenes.length && S.book.scenes.every(x => P.vly_fold && P.vly_fold[x.no]);
    P.vly_fold = {};
    if (!all) for (const x of S.book.scenes) P.vly_fold[x.no] = 1;
    paintCuts(S.book, view());
    fitNode();
  });
  cutsBox.addEventListener("click", (e) => {
    if (!S.book) return;
    const fb = e.target.closest("[data-fold]");
    if (fb) {
      const fold = P.vly_fold || (P.vly_fold = {});
      if (fold[fb.dataset.fold]) delete fold[fb.dataset.fold]; else fold[fb.dataset.fold] = 1;
      paintCuts(S.book, view());
      fitNode();
      return;
    }
    const im = e.target.closest(".vly-pk");
    const st = state();
    if (im) {
      const no = im.dataset.no, id = Number(im.dataset.id);
      if (e.altKey) st.cover = String(st.cover) === im.dataset.id ? null : id;
      else {
        // every chosen pick is laid out; the last one cannot be taken out
        const scene = S.book.scenes.find(x => x.no === no);
        const now = chosenPicks(scene, st).map(p => Number(p.id));
        const has = now.includes(id);
        // in the order they were rendered, not the order they were clicked -
        // a pick added goes in its rendered place; the others keep theirs
        const order = scene.picks.map(p => Number(p.id));
        let next = now;
        if (has) next = now.length > 1 ? now.filter(x => x !== id) : now;
        else {
          const at = now.findIndex(x => order.indexOf(x) > order.indexOf(id));
          next = at < 0 ? [...now, id] : [...now.slice(0, at), id, ...now.slice(at)];
        }
        st.sel[no] = next;
        delete st.pick[no];
        delete st.off["c:" + no];
      }
    }
    const cut = e.target.closest(".vly-cut");
    if (cut && isMotion()) {
      mpause();
      MZ.want = cut.dataset.no;
    } else if (cut) {
      const sheets = buildSheets(S.book, view(), geo());
      const i = sheets.findIndex(sh => (sh.cuts || []).some(c => c.no === cut.dataset.no));
      if (i >= 0) S.cur = i;
    }
    paint();
  });
  tools.addEventListener("click", (e) => {
    const sh = S.sheets[S.cur];
    if (!sh) return;
    const v = view();
    const pb = e.target.closest("[data-pos]");
    const alb = e.target.closest("[data-al]");
    if (alb) {
      const st = state();
      if (alb.dataset.al === "right" || alb.dataset.al === "center") st.align[sh.id] = alb.dataset.al;
      else delete st.align[sh.id];
      paint();
      return;
    }
    const spb = e.target.closest("[data-split]");
    if (spb) {
      const st = state();
      st.split = st.split || {};
      const key = `${geo().cat}:${sh.id}`;
      if (spb.dataset.split) st.split[key] = spb.dataset.split; else delete st.split[key];
      // a new arrangement starts from its own shares
      st.splitW = st.splitW || {};
      delete st.splitW[key];
      paint();
      return;
    }
    const shw = e.target.closest("[data-show]");
    if (shw) {
      const st = state();
      st.show = st.show || {};
      const key = `${geo().cat}:${sh.id}`;
      const now = { show: st.show[key] || "both" };
      let t = showsTitle(now), x = showsText(now);
      if (shw.dataset.show === "title") t = !t; else x = !x;
      const next = t && x ? "both" : t ? "title" : x ? "text" : "none";
      if (next === "both") delete st.show[key]; else st.show[key] = next;
      paint();
      return;
    }
    const cov = e.target.closest("[data-cov]");
    if (cov) {
      const st = state();
      if (P.vly_cat === "web") st.coverStyleWeb = cov.dataset.cov; else st.coverStyle = cov.dataset.cov;
      paint();
      return;
    }
    if (pb) {
      const st = state();
      if (pb.dataset.pos) st.pos[sh.id] = pb.dataset.pos;
      else delete st.pos[sh.id];
      paint();
      return;
    }
    if (!sh.key) return;
    const b = e.target.closest(".vly-tseg button");
    if (b) {
      if (b.dataset.t) v.tpl[sh.key] = b.dataset.t;
      else delete v.tpl[sh.key];
      const key = sh.key;
      const sheets = buildSheets(S.book, view(), geo());
      const i = sheets.findIndex(s => s.key === key || (s.cuts || []).some(c => c.no === key));
      if (i >= 0) S.cur = i;
      paint();
      return;
    }
    if (e.target.closest(".vly-inset")) {
      const st = state();
      st.inset = st.inset || {};
      if (st.inset[sh.key]) delete st.inset[sh.key]; else st.inset[sh.key] = true;
      paint();
      return;
    }
    if (e.target.closest(".vly-flip")) {
      v.flip[sh.key] = !v.flip[sh.key];
      paint();
    }
  });
  coverBox.addEventListener("click", (e) => {
    const st = state();
    if (coverBox.dataset.mode === "swap") {
      const im = e.target.closest(".cp");
      const s = MZ.shots[MZ.cur];
      if (!im || !s || s.id !== coverBox.dataset.shot) return;
      if (swapShotPicture(s, im.dataset.id)) {
        // the panel stays open on the shot, to try the next one
        MZ.swapKeep = true;
        MZ.swapShot = "p:" + im.dataset.id;
        paint();
      }
      return;
    }
    if (e.target.closest(".cauto")) { st.cover = null; paint(); return; }
    const im = e.target.closest(".cp");
    if (im) { st.cover = Number(im.dataset.id); paint(); }
  });
  let extraT = 0;
  extraTa.addEventListener("input", () => {
    const no = extraBox.dataset.no;
    if (!no) return;
    state().extra[no] = extraTa.value;
    clearTimeout(extraT);
    extraT = setTimeout(() => { paintStage(); paintStrip(geo()); if (isFull()) paintFull(); }, 250);
  });
  stripH.addEventListener("click", (e) => {
    if (!e.target.closest(".vly-restore")) return;
    state().off = {};
    paint();
  });
  strip.addEventListener("click", (e) => {
    const del = e.target.closest(".del");
    if (del) {
      state().off[del.dataset.id] = true;
      paint();
      return;
    }
    const m = e.target.closest(".vly-mini");
    if (m) go(Number(m.dataset.i));
  });

  /* Keys, as in the Image Viewer: with the pointer over the node, the node
     selected, or the full-screen view open - left and right step, F or down
     opens full screen, Esc or up comes back. */
  function selected() {
    try { return !!(app.canvas && app.canvas.selected_nodes && app.canvas.selected_nodes[node.id]); }
    catch (e) { return false; }
  }
  function onKey(e) {
    if (S.dead || !S.book || pop) return;
    const t = e.target;
    if (t && t !== sink && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
    if (!isFull() && !S.hovered && !selected()) return;
    // the layout's own undo, before the canvas reads the key as its own
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      const key = e.key.toLowerCase();
      const isUndo = key === "z" && !e.shiftKey, isRedo = key === "y" || (key === "z" && e.shiftKey);
      if (isUndo || isRedo) {
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        if (MZ.recording || S.exporting) return;
        if (isUndo) undo(); else redo();
      }
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    let done = true;
    if (isMotion() && !isFull()) {
      switch (e.key) {
        case "ArrowLeft": mgo(MZ.cur - 1); break;
        case "ArrowRight": mgo(MZ.cur + 1); break;
        case "Home": mgo(0); break;
        case "End": mgo(MZ.shots.length - 1); break;
        case " ": mplay(); break;
        case "m": case "M": addMarker(MZ.t); break;
        default: done = false;
      }
      if (done) { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); }
      return;
    }
    switch (e.key) {
      case "ArrowLeft": go(S.cur - 1); break;
      case "ArrowRight": go(S.cur + 1); break;
      case "Home": go(0); break;
      case "End": go(S.sheets.length - 1); break;
      case "f": case "F": if (isFull()) closeFull(); else openFull(); break;
      case "ArrowDown": if (!isFull()) openFull(); else done = false; break;
      case "ArrowUp": case "Escape": if (isFull()) closeFull(); else done = false; break;
      default: done = false;
    }
    if (done) { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); }
  }
  window.addEventListener("keydown", onKey, true);
  const onWinResize = () => { if (isFull()) paintFull(); };
  window.addEventListener("resize", onWinResize);

  /* The node is fitted to the page whenever the page changes height, and the
     spread is drawn again when the node changes width. */
  let lastW = 0;
  const ro = new ResizeObserver(() => {
    fitNode();
    const w = desk.clientWidth;
    if (Math.abs(w - lastW) < 2) return;
    lastW = w;
    if (S.book) { if (isMotion()) paintMotionStage(); else paintStage(); }
  });
  ro.observe(root);
  /* The timeline is scaled to the width it has. Drawn before the node has
     its width - as on opening a workflow - it came out a few pixels wide;
     it is drawn again once the strip has its real width, and whenever the
     width changes. */
  let tlT = 0;
  const tlro = new ResizeObserver(() => {
    if (S.dead || !isMotion() || !S.book) return;
    const w = strip.clientWidth;
    if (!w || Math.abs(w - (TL.room || 0)) < 4) return;
    clearTimeout(tlT);
    tlT = setTimeout(() => { if (!S.dead && isMotion() && S.book) paintShots(geo()); }, 60);
  });
  tlro.observe(strip);

  /* A .layout written into a package brings its layout back: the series,
     print or web and the size, the style, and every choice made per cut -
     picks, cover, layouts, words, pages taken out, linked pictures. */
  /* Everything the node holds for the series on show. */
  function layoutDoc() {
    return {
      category: P.vly_cat, size: P.vly_fmt[P.vly_cat], theme: P.vly_theme, words: P.vly_textpos,
      typefaces: { ...P.vly_font }, sizes: { ...P.vly_size },
      logo: P.vly_logo ? { ...P.vly_logo } : null, tags: P.vly_tags || "", lines: P.vly_lines || "all",
      state: JSON.parse(JSON.stringify(state())),
    };
  }
  const svBtn = $(".sv");
  svBtn.addEventListener("click", async () => {
    if (!S.book || svBtn.disabled) return;
    svBtn.disabled = true;
    try {
      const r = await api.fetchApi(SAVE_LAYOUT_URL, { method: "POST", body: JSON.stringify({ series: S.book.series, layout: layoutDoc() }) });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "the layout could not be saved");
      say(`Saved: ${j.path}`);
      svBtn.classList.add("done");
      setTimeout(() => svBtn.classList.remove("done"), 1500);
    } catch (e) {
      say(`Not saved: ${e && e.message || e}`, true);
    } finally {
      svBtn.disabled = false;
    }
  });

  async function openLayout(file) {
    let doc;
    try { doc = JSON.parse(await file.text()); }
    catch (e) { say(`${file.name} could not be read`, true); return; }
    if (!doc || doc.format !== "visual-series-layout" || !doc.series) {
      say(`${file.name} is not a layout written by this node`, true);
      return;
    }
    P.vly_series = doc.series;
    if (["web", "print", "motion"].includes(doc.category)) P.vly_cat = doc.category;
    if (doc.size) P.vly_fmt[P.vly_cat] = doc.size;
    if (doc.theme) P.vly_theme = doc.theme;
    if (doc.words) P.vly_textpos = doc.words;
    if (doc.typefaces && doc.typefaces.title) P.vly_font = { ...DEFAULT_FONTS, ...doc.typefaces };
    if (doc.sizes) P.vly_size = { title: 1, text: 1, ...doc.sizes };
    if (doc.state && typeof doc.state === "object") P.vly_state[doc.series] = doc.state;
    if (doc.logo && doc.logo.name) P.vly_logo = { ...doc.logo };
    if (typeof doc.tags === "string" && doc.tags) P.vly_tags = doc.tags;
    if (NOTE_LINES.some(t => t.id === doc.lines)) P.vly_lines = doc.lines;
    if (doc.package) { P.vly_pkgdir = P.vly_pkgdir || {}; }
    S.cur = 0;
    S.sig = "";
    await loadList();
    await loadBook();
    say(S.book ? `Opened ${file.name} - ${doc.series}, as it was ${doc.saved ? "saved" : "packaged"} ${String(doc.written || "").replace("T", " ")}`
      : `${doc.series} is not in the Series Book on this computer - open the book that holds it first`, !S.book);
  }
  const opBtn = $(".op"), opFile = $(".opf");
  opBtn.addEventListener("click", () => opFile.click());
  opFile.addEventListener("change", () => {
    const f = opFile.files && opFile.files[0];
    if (f) openLayout(f);
    opFile.value = "";
  });
  // dropped on the node, a .layout is opened here - not handed to the canvas
  const isLayoutDrag = (e) => [...(e.dataTransfer && e.dataTransfer.items || [])].some(it => it.kind === "file");
  root.addEventListener("dragover", (e) => {
    if (!isLayoutDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    root.classList.add("drop");
  }, true);
  root.addEventListener("dragleave", (e) => { if (!root.contains(e.relatedTarget)) root.classList.remove("drop"); });
  root.addEventListener("drop", (e) => {
    root.classList.remove("drop");
    const f = [...(e.dataTransfer && e.dataTransfer.files || [])].find(x => /\.layout$/i.test(x.name));
    if (!f) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    openLayout(f);
  }, true);

  /* The colour of the series, followed as the Series Book changes it. */
  function followTone() {
    if (!S.book) return;
    const tone = liveTone(S.book.series) || seriesTone(S.book.hue);
    if (root.style.getPropertyValue("--sg").trim() !== tone) root.style.setProperty("--sg", tone);
  }
  const toneWatch = setInterval(() => {
    if (S.dead || !root.isConnected) return;
    followTone();
    try { followBook(); } catch (e) { /* a book being built */ }
  }, 400);

  const poll = setInterval(() => {
    if (S.dead || S.exporting || !root.isConnected || document.hidden) return;
    loadBook(true);
  }, POLL_MS);

  ME = {
    series: () => P.vly_series || "",
    player: () => isPlayer(),
    film: () => (P.vly_series ? mstate().music.name || "" : ""),
    refreshMusic: () => { if (!S.dead && musicLive()) paintMusic(); },
    renamed: (old, neu) => { if (!S.dead) renamedHere(old, neu); },
    hush: () => {
      if (S.dead) return;
      if (PV.audio && !PV.paused) pvPause();
      if (MZ.playing) mpause();
    },
    setFilm: async (name, start) => {
      const mu = mstate().music;
      const at = Number(start) > 0 ? Number(start) : 0;
      if (mu.name === name) {
        if (start != null && mu.start !== at) {
          mpause();
          mu.start = mu.len ? Math.min(at, Math.max(0, mu.len - 1)) : at;
          say(`The film's music now starts at ${clock(mu.start)}`);
          paint();
        } else if (musicLive()) paintMusic();
        return;
      }
      mpause();
      mu.name = name;
      mu.start = at;
      delete mu.len;
      const b = await musicBuffer(name);
      if (b) { mu.len = b.duration; mu.start = Math.min(at, Math.max(0, b.duration - 1)); }
      say(b ? `Music of the film: ${name} \u00b7 ${clock(b.duration)}${mu.start ? ` \u00b7 from ${clock(mu.start)}` : ""}` : `This browser cannot play ${name}`, !b);
      paint();
    },
  };
  VLY_ALL.add(ME);

  node._vly = {
    refresh: async () => { defaults(); await loadList(); S.sig = ""; await loadBook(); },
    destroy: () => {
      S.dead = true;
      VLY_ALL.delete(ME);
      mstop();
      if (MZ.ac) { try { MZ.ac.close(); } catch (e) { /* closed */ } }
      clearInterval(poll);
      clearInterval(toneWatch);
      clearInterval(histWatch);
      try { tlro.disconnect(); } catch (e) { /* gone */ }
      try { pvStop(); } catch (e) { /* gone */ }
      window.removeEventListener("leiel-series-opened", onSeriesOpened);
      ro.disconnect();
      closePop();
      closeFull();
      full.remove();
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", onWinResize);
      document.removeEventListener("fullscreenchange", onFullChange);
    },
  };
  setTimeout(() => node._vly.refresh(), 0);
  return widget;
}

app.registerExtension({
  name: "StudioLeiel.VisualSeriesLayout",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== LAYOUT) return;

    const onCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = onCreated ? onCreated.apply(this, arguments) : undefined;
      buildLayout(this);
      if (this.size[0] < 1080) this.setSize([1080, this.size[1]]);
      return r;
    };

    /* Properties arrive after the node is built when a workflow loads. */
    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const r = onConfigure ? onConfigure.apply(this, arguments) : undefined;
      if (this._vly) setTimeout(() => this._vly.refresh(), 0);
      return r;
    };

    const onRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      if (this._vly) this._vly.destroy();
      return onRemoved ? onRemoved.apply(this, arguments) : undefined;
    };
  },
});
