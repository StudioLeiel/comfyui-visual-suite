/*
 * Copyright 2026 Studio Leiel
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

import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

/* ==================================================================
   Studio Leiel - Visual Prompt Composer
   Stacked prompt sections in one node: rename, toggle, reorder, resize,
   feed from an external input, and find-and-replace across all of them.
   ================================================================== */

const MAX_SLOTS = 8;
const MIN_H = 40;
/* Translation pane: the shortest it is worth showing, and the languages the
   arrow tag cycles through. Module scope, so restoreFrom can reach TR_MIN
   whatever order the per-node closure happens to be built in. */
/* the pane carries a 17px head strip, so anything under about this is a
   sliver with one clipped line in it */
const TR_MIN = 52;
/* How finely the text is cut before it is handed over. Every unit is also the
   unit the hover highlight lines up on, so this one setting trades translation
   quality against how precisely you can point at something. */
const TR_UNITS = [["para", "Paragraph"], ["sent", "Sentence"], ["clause", "Clause"]];
const TR_LANGS = [["en", "English"], ["ko", "Korean"], ["ja", "Japanese"],
                  ["zh", "Chinese"], ["zh-Hant", "Chinese (Traditional)"],
                  ["es", "Spanish"], ["fr", "French"], ["de", "German"],
                  ["pt", "Portuguese"], ["it", "Italian"], ["nl", "Dutch"],
                  ["pl", "Polish"], ["ru", "Russian"], ["uk", "Ukrainian"],
                  ["tr", "Turkish"], ["vi", "Vietnamese"], ["th", "Thai"],
                  ["id", "Indonesian"],
                  ["hi", "Hindi"], ["bn", "Bengali"], ["mr", "Marathi"],
                  ["ta", "Tamil"], ["te", "Telugu"], ["kn", "Kannada"],
                  ["ar", "Arabic"], ["he", "Hebrew"]];
/* Written right to left. The pane has to be flipped for these or the
   punctuation lands on the wrong end of every line. */
/* A language's name for messages - "no Korean to English model". It was
   called and never defined, so a missing model ended in a script error
   instead of saying which model was missing. */
function trName(code) {
  const hit = TR_LANGS.find(x => x[0] === code);
  return hit ? hit[1] : String(code || "");
}
const TR_RTL = new Set(["ar", "he", "fa", "ur"]);
const HEADER_H = 22;
/* The reading strip sits above the box and is dragged to size like the box
   itself. The picture is the point, so it starts big. */
const IMG_H = 210;
const IMG_MIN = 96;
const IMG_GRIP = 6;

/* The custom question box is a strip of its own, not a slice taken out of the
   picture: choosing "Custom..." used to halve the photograph. Its height is
   added to the strip rather than shared with it, so the picture stays the size
   it was measured to. */
const IMG_CUSTOM_H = 34;
const IMG_CUSTOM_GAP = 5;

function customExtra(sec) {
  const chosen = sec.q || questionFor(sec.title);
  return chosen === "custom" ? IMG_CUSTOM_H + IMG_CUSTOM_GAP : 0;
}

/* The height of the strip itself: what the picture was measured to need, plus
   the custom box when it is showing. */
function stripHeight(sec) {
  return Math.max(IMG_MIN, sec.imgH || IMG_H) + customExtra(sec);
}

/* Side by side.

   A portrait picture in a full-width strip is stranded between two wide bands
   of empty background, and the taller you drag the strip the worse it gets.
   Beside the text it uses that room instead. Landscape is the other way round:
   above the text it spans the whole node, beside it there is nothing left for
   the writing. So the shape of the picture decides, and the button overrides. */
const IMG_SIDE_W = 210;
/* wide enough for the control row - below this the buttons had nowhere to go */
const IMG_SIDE_MIN = 200;
const IMG_SIDE_MAX = 720;
/* padding and the control row, measured across and down */
const SIDE_PAD_X = 12;
const SIDE_CHROME_Y = 33;
/* how tall a picture beside the text opens: big enough to read a pose */
const SIDE_FIRST_H = 340;

function imgSideWidth(sec) {
  return Math.max(IMG_SIDE_MIN,
                  Math.min(IMG_SIDE_MAX, Math.round(sec.imgW || IMG_SIDE_W)));
}

/* The width a picture of this shape wants when the body is this tall, so
   switching sides keeps the picture whole instead of letterboxing it. */
function sideWidthFor(sec, bodyH) {
  const ar = sec.imgAR > 0 ? sec.imgAR : 1;
  const stage = Math.max(40, bodyH - SIDE_CHROME_Y - customExtra(sec));
  return Math.max(IMG_SIDE_MIN,
                  Math.min(IMG_SIDE_MAX, Math.round(stage * ar) + SIDE_PAD_X));
}

/* How much room a section gives up to its reading strip. Beside the text the
   picture costs no height at all - it shares the body with the box. */
function imgBlock(sec) {
  return sec.imgOpen && !sec.imgSide ? stripHeight(sec) + IMG_GRIP : 0;
}

/* Filled once from the backend. Everything the reader needs to draw itself
   before a model has ever been loaded. */
const VLM = {
  ready: false, problem: null, models: [], quants: ["none"],
  questions: {}, hints: [], defaultModel: "", defaultTokens: 220,
  loaded: null, loadedQuant: null,
  /* What the card can actually afford. The backend reads the total memory and
     picks from a table; this is only the starting point, and a setting the
     user has chosen is never overridden by it. */
  suggested: null,
};

async function vlmState() {
  try {
    const r = await api.fetchApi("/leiel_vpc/vlm/state");
    const d = await r.json();
    VLM.problem = d.problem || null;
    VLM.models = d.models || [];
    VLM.quants = d.quants || ["none"];
    VLM.questions = d.questions || {};
    VLM.hints = d.hints || [];
    VLM.defaultModel = d.default_model || (d.models || [])[0] || "";
    VLM.defaultTokens = d.default_max_tokens || 220;
    VLM.suggested = d.suggested || null;
    /* what the card is holding right now - the panel says so, because memory
       in use is the thing worth knowing at a glance */
    VLM.loaded = d.loaded || null;
    VLM.loadedQuant = d.loaded_quant || null;
    VLM.ready = true;
  } catch (e) {
    VLM.problem = "The reader could not be reached. Is the pack installed?";
    VLM.ready = true;
  }
  return VLM;
}

function imgUrl(ref) {
  if (!ref || !ref.filename) return "";
  const p = new URLSearchParams({
    filename: ref.filename,
    subfolder: ref.subfolder || "",
    type: ref.type || "input",
  });
  /* cache-buster: replacing a picture with one of the same name would
     otherwise keep showing the old thumbnail */
  p.set("t", String(ref.stamp || 0));
  return `/view?${p.toString()}`;
}

/* Reuses ComfyUI's own upload endpoint, so the picture lands in the input
   folder like any other and the workflow only has to remember its name. */
async function uploadImage(file) {
  const body = new FormData();
  body.append("image", file, file.name);
  body.append("subfolder", "prompt_composer");
  body.append("overwrite", "false");
  const r = await api.fetchApi("/upload/image", { method: "POST", body });
  if (!r.ok) throw new Error("The image could not be uploaded.");
  const d = await r.json();
  return {
    filename: d.name,
    subfolder: d.subfolder || "prompt_composer",
    type: d.type || "input",
    stamp: Date.now(),
  };
}

/* A landscape picture wants a short wide strip and a portrait one a tall
   narrow strip. Measuring it once on arrival saves dragging the grip every
   time. */
/* The canvas draws this widget through a CSS transform, so a pointer that has
   travelled 100 screen pixels has travelled 100/zoom pixels inside the node.
   Dragging by the raw screen delta therefore moved the edge by the zoom
   factor - at 2x the picture column ran twice as far as the hand did. The rest
   of the file already divides measured rects by this; the drags did not. */
function uiScale(el) {
  const host = (el && el.closest && el.closest(".lvp-wrap")) || el;
  const css = host && host.offsetWidth;
  if (!css) return 1;
  return host.getBoundingClientRect().width / css || 1;
}

function measureImage(url, boxWidth) {
  return new Promise((resolve) => {
    const probe = new Image();
    probe.onload = () => {
      const ar = (probe.naturalWidth / probe.naturalHeight) || 1;
      const w = Math.max(120, boxWidth - 16);
      const shown = Math.round(w / ar);
      resolve({ ar, h: Math.max(IMG_MIN, Math.min(560, shown + 34)) });
    };
    probe.onerror = () => resolve({ ar: 1, h: IMG_H });
    probe.src = url;
  });
}

async function readImage(ref, question, settings) {
  const r = await api.fetchApi("/leiel_vpc/vlm/analyse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image: ref,
      question,
      model: settings.model,
      quantization: settings.quant,
      max_tokens: settings.tokens,
      /* sent on every reading, so the clock restarts from the last thing the
         user actually did rather than from when the panel was last opened */
      idle_minutes: settings.idle,
      /* when set, the card gets its memory back the moment the answer is
         written rather than after the idle wait */
      unload_after: !!settings.after,
      /* ask ComfyUI to put its models away before the reader loads, rather
         than waiting for the card to refuse */
      purge_first: !!settings.purge,
    }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "The reader failed.");
  /* A reading that came back means the model is on the card. Recorded here
     rather than waiting for the panel to be opened, because the unload that
     runs when a render is queued reads this to decide whether there is
     anything to unload - and a stale "nothing loaded" would skip it. */
  VLM.loaded = settings.model;
  VLM.loadedQuant = settings.quant;
  return d.text || "";
}

/* A section called "Camera Anchor" opens on the camera question. */
/* Five layers exist and this reading takes one of them. That is the whole
   idea of the node, and words were carrying it badly: a label naming one layer
   never shows that there are four others being left behind.

   So it is drawn. Five stacked bars, one lit - the stack says how many there
   are, the lit one says which, and the dim ones are the answer to the
   question nobody thought to ask.

   Pose sits between subject and scene. The subject layer used to carry the
   clothes and the body's position together, so changing what she was doing
   meant rewriting what she was wearing; now one says how she looks and the
   other what she is doing, and either can change without the other.

   Top to bottom in anchor order, the same
   order the sections are in, so position becomes the name once you have seen
   it twice. */
const LAYER_ORDER = ["quality", "subject", "pose", "scene", "camera"];

/* One photograph usually holds several layers, and a series is designed by
   reading them all out of it. Reading was one section, one picture, one press,
   so the same image had to be dropped into four sections and read four times.
   Now a reading has targets: the picture stays where it is, and each chosen
   section is asked its OWN question in turn. The questions stay separate on
   purpose - one prompt answering for every layer at once is how scene nouns
   end up in the subject and lighting ends up in the camera. */
function readTargetsOf(sec, sections) {
  const ids = Array.isArray(sec.readTo) && sec.readTo.length ? sec.readTo : [sec.id];
  const want = new Set(ids);
  const list = sections.filter(x => want.has(x.id));
  return list.length ? list : [sec];
}

/* The question a section would ask of a picture, whoever is holding it. */
function questionOf(sec) {
  const key = sec.q || questionFor(sec.title);
  if (key === "custom") return (sec.qText || "").trim();
  return ((VLM.questions[key] || {}).question || "");
}

function layerGlyph(key) {
  const rows = LAYER_ORDER.map((layer, i) => {
    const on = key === "all" || layer === key;
    return `<rect x="1" y="${1 + i * 4}" width="12" height="3" rx="1"`
         + ` fill="currentColor" opacity="${on ? 1 : 0.22}"/>`;
  }).join("");
  const h = 1 + LAYER_ORDER.length * 4;
  /* the outer size stays what it was with four, so the control row does not
     grow; five bars simply sit a little closer together */
  return `<svg viewBox="0 0 14 ${h}" width="11" height="13" aria-hidden="true">`
       + rows + `</svg>`;
}

function layerTitle(sec) {
  const key = sec.q || questionFor(sec.title);
  const names = { quality: "Quality", subject: "Subject", pose: "Pose",
                  scene: "Scene", camera: "Camera" };
  if (key === "custom") return "Your own question - the layers do not apply";
  if (key === "all") return "All five layers: quality, subject, pose, scene, camera";
  return `Five layers - reading ${names[key] || key} only, `
       + `leaving ${LAYER_ORDER.filter(x => x !== key)
            .map(x => names[x]).join(", ")} to their own sections`;
}

function questionFor(title) {
  const t = (title || "").toLowerCase();
  for (const [word, key] of VLM.hints) if (t.includes(word)) return key;
  return "all";
}
/* Two bars lying down, two bars standing up: the arrangement itself, drawn.
   A word had to be read and then translated into a picture of the layout;
   this is the picture. Both are always on show with the current one lit, so
   there is nothing to work out from a label that names the other state. */
const ICON_ROW =
  `<svg viewBox="0 0 14 14" width="11" height="11" aria-hidden="true">` +
  `<rect x="1" y="1.5" width="12" height="4.5" rx="1"/>` +
  `<rect x="1" y="8" width="12" height="4.5" rx="1"/></svg>`;
const ICON_SIDE =
  `<svg viewBox="0 0 14 14" width="11" height="11" aria-hidden="true">` +
  `<rect x="1.5" y="1" width="4.5" height="12" rx="1"/>` +
  `<rect x="8" y="1" width="4.5" height="12" rx="1"/></svg>`;

/* The header marks. The duplicate one was the character U+29C9, which is two
   squares joined at a corner and reads as a diagram rather than as a button;
   drawn properly it is one sheet lying over another. The other two are new. */
const ICON_DUP =
  `<svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">` +
  `<rect x="1.2" y="1.2" width="6.6" height="6.6" rx="1.4"` +
  ` fill="none" stroke="currentColor" stroke-width="1.2"/>` +
  `<rect x="4.2" y="4.2" width="6.6" height="6.6" rx="1.4"` +
  ` fill="var(--sec-bg,#1a1a1a)" stroke="currentColor" stroke-width="1.2"/></svg>`;
/* The backspace key: a wedge pointing at what it removes, with a cross in it.
   The first try was an eraser lying on its side, which at ten pixels was a
   tilted rectangle above a line and read as nothing in particular. This one
   says erase because it is already the erase key, and its outline is legible
   even when the cross inside is barely two pixels across. */
const ICON_CLEAR =
  `<svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">` +
  `<path d="M4.3 2.2 H10 a1 1 0 0 1 1 1 v5.6 a1 1 0 0 1 -1 1 H4.3 L1 6 Z"` +
  ` fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>` +
  `<path d="M5.8 4.6 L8.6 7.4 M8.6 4.6 L5.8 7.4" stroke="currentColor"` +
  ` stroke-width="1.2" stroke-linecap="round" fill="none"/></svg>`;
/* two edges closing on the text between them */
const ICON_FIT =
  `<svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">` +
  `<path d="M1.4 1.5 h9.2 M1.4 10.5 h9.2" stroke="currentColor"` +
  ` stroke-width="1.2" stroke-linecap="round" fill="none"/>` +
  `<path d="M6 3.2 v1.9 M4.4 4.4 L6 5.6 L7.6 4.4" stroke="currentColor"` +
  ` stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>` +
  `<path d="M6 8.8 v-1.9 M4.4 7.6 L6 6.4 L7.6 7.6" stroke="currentColor"` +
  ` stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>`;

/* The move and delete marks, redrawn as outlines at the same 1.2 weight as
   the three above. They were solid glyphs from the font - a filled triangle
   and a bold letter - which put three drawn outlines and three typeset shapes
   in one row, at different weights and on different baselines. */
const ICON_UP =
  `<svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">` +
  `<path d="M6 2.6 L10.2 9 H1.8 Z" fill="none" stroke="currentColor"` +
  ` stroke-width="1.2" stroke-linejoin="round"/></svg>`;
const ICON_DOWN =
  `<svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">` +
  `<path d="M6 9.4 L1.8 3 H10.2 Z" fill="none" stroke="currentColor"` +
  ` stroke-width="1.2" stroke-linejoin="round"/></svg>`;
const ICON_DEL =
  `<svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">` +
  `<path d="M2.6 2.6 L9.4 9.4 M9.4 2.6 L2.6 9.4" fill="none"` +
  ` stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>`;

const GAP = 6;
/* Room under the last section. Scrolled to the bottom, its 6px grip used to
   sit flush against the edge of the list, so resizing the bottom section meant
   scrolling all the way down and then catching a strip that was half under the
   rim. This is counted into the node height as well, or the clearance would
   simply produce a scrollbar where there was none. */
const LIST_PAD = 8;
/* the room above the Series Book's "Editing" line, counted into the node */
const NOW_GAP = 6;
/* how far apart the book, the drawer and the anchors' bar may be dragged */
const PANEL_GAP_MAX = 40;

const DEFAULT_SECTIONS = [
  "LoRA Trigger", "Quality Anchor", "Subject Anchor", "Pose Anchor",
  "Scene Anchor", "Camera Anchor", "ABSOLUTE",
];

/* ---------- snapshot store (survives undo, paste, reloads) ---------- */
/* Text arriving on the ext_ wires, reported back by the node after each run so
   a section can show what it is actually being fed. */
const EXT_CACHE = {};          // nodeId -> { "1": "text from the wire", ... }
const VPC_NODES = new Map();   // nodeId -> redraw

/* Reading during a render fills the card and stops everything.

   ComfyUI announces what it is doing on two events: "status" carries how many
   prompts are left in the queue, and "executing" carries the node currently
   running, or null when the run has finished. Between them they cover both
   ends - the queue growing and the last node finishing - so the button knows
   to grey itself out and knows when to come back without anyone polling. */
const BUSY = { on: false, queued: 0, running: false, listeners: new Set() };

/* The two signals are kept apart deliberately. Between one queued prompt and
   the next, ComfyUI reports the run finished before it reports the queue
   still has work; folding both into a single flag let the button flicker back
   on in that gap, which is precisely the moment it must not. Busy means either
   is true. */
function recomputeBusy() {
  const on = BUSY.running || BUSY.queued > 0;
  if (BUSY.on === on) return;
  BUSY.on = on;
  /* The reader gets off the card the moment a render is queued, whatever the
     idle timer had left to run. The two never need the memory at the same
     time, and the idle clock was set for a pause between readings, not for
     this - waiting three more minutes with four gigabytes held is exactly the
     wrong thing to do while an image model is trying to load.

     Only our own model is unloaded. ComfyUI's stays entirely its own business:
     reaching into that from outside is what corrupted its patcher and killed
     renders for a day. */
  if (on) dropReaderForRender();
  for (const fn of BUSY.listeners) {
    try { fn(BUSY.on); } catch (e) { /* one bad listener is not the others' problem */ }
  }
}

/* Where a pasted screenshot goes.

   A paste arrives at the document, not at any one strip, so with six sections
   open something has to say which one is meant. Two answers, in order: the
   strip the pointer is over, and failing that the strip last clicked. Both are
   things the hand was already doing, so neither asks for an extra step, and
   between them a paste almost always has somewhere obvious to land. When it
   has neither, nothing happens - guessing at one of six is worse than doing
   nothing. */
const PASTE = { hover: null, last: null };

function isEditable(el) {
  if (!el || !el.closest) return false;
  return !!el.closest("input, textarea, [contenteditable=\"true\"]");
}

function pasteTarget() {
  /* Every render throws the strips away and builds new ones, so a remembered
     one has to be checked against the page before it is used. */
  if (PASTE.hover && !PASTE.hover.el.isConnected) PASTE.hover = null;
  if (PASTE.last && !PASTE.last.el.isConnected) PASTE.last = null;
  return PASTE.hover || PASTE.last;
}

/* Queued and running both raise the flag, and the flag can be raised again
   before the answer to the first request comes back, so this must not stack. */
let dropping = false;
async function dropReaderForRender() {
  if (dropping || !VLM.loaded) return;
  dropping = true;
  try {
    await api.fetchApi("/leiel_vpc/vlm/unload", { method: "POST" });
    VLM.loaded = null;
    VLM.loadedQuant = null;
  } catch (err) {
    /* nothing loaded, or the route is gone - either way the render carries on */
  } finally {
    dropping = false;
  }
}

/* One listener for the whole page rather than one per strip: the event only
   ever arrives once, at the document, whatever is focused. */
/* Capture phase, and the event is stopped once it is ours.

   ComfyUI listens for the same paste and answers a picture on the clipboard by
   building a Load Image node. Both of us were right and both of us acted, so
   one paste put the picture in the strip and dropped a Load Image node on the
   canvas as well. preventDefault only tells the browser not to do its default
   thing; it does nothing about another listener on the same event. Running
   first and stopping the event is what keeps a paste aimed at a strip from
   also being a paste aimed at the graph.

   When there is no strip to paste into, the event is left entirely alone -
   pasting a picture onto the canvas should still make a Load Image node. */
document.addEventListener("paste", (e) => {
  /* Typing somewhere means the paste is meant for what you are typing in.
     Without this, pasting a picture while the cursor sat in a text box would
     put it in whichever strip the pointer happened to be over. */
  if (isEditable(e.target)) return;
  const target = pasteTarget();
  if (!target) return;

  const items = (e.clipboardData && e.clipboardData.items) || [];
  let file = null;
  for (const item of items) {
    if (item.kind === "file" && /^image\//.test(item.type || "")) {
      file = item.getAsFile();
      if (file) break;
    }
  }
  /* Copying a file in the file manager puts a path on the clipboard, not the
     picture, and a browser is not allowed to open that path. Nothing to do but
     say so - dragging the file in still works. */
  if (!file) {
    if (items.length) {
      target.say("that clipboard holds no image - drag the file in instead", "err");
    }
    return;
  }

  e.preventDefault();
  e.stopPropagation();
  if (e.stopImmediatePropagation) e.stopImmediatePropagation();
  /* Which strip took it, shown for a moment: a paste that lands in the wrong
     section is otherwise silent. */
  target.drop.classList.add("over");
  setTimeout(() => target.drop.classList.remove("over"), 400);
  target.take(file);
}, true);

api.addEventListener("status", (e) => {
  const left = e?.detail?.exec_info?.queue_remaining;
  if (typeof left === "number") { BUSY.queued = left; recomputeBusy(); }
});
api.addEventListener("executing", (e) => {
  /* a node id means running; null means this run is over */
  BUSY.running = e?.detail?.node != null;
  recomputeBusy();
});

try {
  api.addEventListener("leiel.vpc.ext", (e) => {
    const d = e?.detail || {};
    if (!d.node) return;
    EXT_CACHE[String(d.node)] = d.ext || {};
    const fn = VPC_NODES.get(String(d.node));
    if (fn) fn();
  });
} catch (err) { /* older frontend: the panes just stay empty */ }

/* ---------- layout snapshots ----------
   In a file beside the presets, for the same reason: clearing site data used
   to take every saved version with it.

   Two kinds, counted apart. Automatic ones are taken before anything risky
   and rotate - they exist to catch the last minute, and UNDO covers that
   better anyway. The ones the user pressed Save for are a different thing
   entirely, and no automatic record is ever allowed to push one out. */
const LS_KEY = "leiel.vpc.snapshots";
const SNAP_URL = "/leiel_vpc/snapshots";
const SNAP_AUTO_MAX = 25;
const SNAP_KEEP_MAX = 200;

let SNAP_CACHE = null;
let SNAP_LOADING = null;

function snapLocalRead() {
  try {
    const v = JSON.parse(localStorage.getItem(LS_KEY) || "[]");
    return Array.isArray(v) ? v : [];
  } catch (e) { return []; }
}

/* An older list has no kind on it. "before ..." was written by the node, not
   by the user, so it becomes automatic; anything else was named by hand. */
function snapClassify(list) {
  return list.map(e => ({
    t: Number(e && e.t) || 0,
    label: String((e && e.label) || "auto"),
    kind: e && e.kind ? e.kind
        : (!e || e.label === "auto" || /^before /.test(String(e.label || "")))
          ? "auto" : "keep",
    sections: (e && e.sections) || [],
  })).filter(e => Array.isArray(e.sections) && e.sections.length);
}

/* the prompt actions on a series box, drawn rather than written so they
   read as acting on a prompt, not on the series */
const PICON_SORT = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 2.5v11M2.5 11.5l2 2 2-2"/><path d="M9 3.5h4.5M9 7h3.5M9 10.5h2.5"/></svg>`;
const PICON_NEW = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><rect x="2.5" y="2.5" width="11" height="11" rx="2.5"/><path d="M8 5.5v5M5.5 8h5"/></svg>`;
const PICON_DUP = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><rect x="5" y="5" width="8.5" height="8.5" rx="2"/><path d="M11 3.2V3a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 3v5.5A1.5 1.5 0 0 0 4 10h.8"/></svg>`;
const PICON_SAVE = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M2.5 3.5a1 1 0 0 1 1-1h7.6l2.4 2.4v7.6a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z"/><path d="M5 2.5v3.2h5V2.5M5 13.5V9.5h6v4"/></svg>`;
const PICON_PASTE = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="10" height="11" rx="2"/><path d="M6 3V2.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1V3M5.8 7h4.4M5.8 9.5h4.4M5.8 12h2.6"/></svg>`;
/* Paste All: two sheets, one over the other - a whole series at once */
const PICON_PASTE_ALL = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 3.5V2.6a1.1 1.1 0 0 1 1.1-1.1h5.8a1.1 1.1 0 0 1 1.1 1.1v8.3a1.1 1.1 0 0 1-1.1 1.1h-.9"/><rect x="2.5" y="4" width="8.5" height="10.5" rx="1.1"/><path d="M4.8 7.3h3.9M4.8 9.5h3.9M4.8 11.7h2.3"/></svg>`;
const PICON_DEL = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 4.5h11M6.5 4.5V3a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1.5M4 4.5l.7 8.6a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9l.7-8.6M6.8 7v4.5M9.2 7v4.5"/></svg>`;

function snapRead() {
  if (SNAP_CACHE) return SNAP_CACHE.slice();
  return snapClassify(snapLocalRead());
}

async function snapLoad() {
  if (SNAP_CACHE) return SNAP_CACHE;
  if (SNAP_LOADING) return SNAP_LOADING;
  SNAP_LOADING = (async () => {
    let list = null;
    try {
      const r = await fetch(SNAP_URL, { cache: "no-store" });
      if (r.ok) {
        const v = await r.json();
        if (Array.isArray(v)) list = v;
      }
    } catch (e) { /* no backend: stay on the browser copy */ }

    if (list === null) {
      SNAP_CACHE = snapClassify(snapLocalRead());
      return SNAP_CACHE;
    }
    if (!list.length) {
      const legacy = snapClassify(snapLocalRead());
      if (legacy.length) {
        SNAP_CACHE = legacy;
        snapSend(legacy);
        return SNAP_CACHE;
      }
    }
    SNAP_CACHE = snapClassify(list);
    return SNAP_CACHE;
  })();
  try { return await SNAP_LOADING; } finally { SNAP_LOADING = null; }
}

async function snapSend(list) {
  try {
    const r = await fetch(SNAP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(list),
    });
    if (r.ok) {
      const j = await r.json().catch(() => null);
      if (j && Array.isArray(j.snapshots)) SNAP_CACHE = j.snapshots;
      return true;
    }
  } catch (e) { /* fall through to the browser */ }
  try { localStorage.setItem(LS_KEY, JSON.stringify(list)); }
  catch (e) { /* quota or private mode */ }
  return false;
}

function snapWrite(list) {
  SNAP_CACHE = list.slice();
  snapSend(SNAP_CACHE);
}

/* kind is "keep" only when the user pressed Save. Returns why it did or did
   not happen, so the panel can say something useful. */
function snapPush(sections, label, kind) {
  if (!sections || !sections.length) return "empty";
  const keeping = kind === "keep";
  const body = JSON.stringify(sections);
  const list = snapRead();
  if (list.length && JSON.stringify(list[0].sections) === body &&
      list[0].label === label) return "same";

  const entry = { t: Date.now(), label: label || "auto",
                  kind: keeping ? "keep" : "auto",
                  sections: JSON.parse(body) };
  const keeps = list.filter(x => x.kind === "keep");
  const autos = list.filter(x => x.kind !== "keep");
  if (keeping) {
    if (keeps.length >= SNAP_KEEP_MAX) return "full";
    keeps.unshift(entry);
  } else {
    autos.unshift(entry);
  }
  snapWrite(keeps.concat(autos.slice(0, SNAP_AUTO_MAX))
                 .sort((a, b) => b.t - a.t));
  return "saved";
}
function snapLabel(e) {
  const d = new Date(e.t), p = x => String(x).padStart(2, "0");
  const when = `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  const chars = e.sections.reduce((n, s) => n + (s.text || "").length, 0);
  return `${when}  ${e.sections.length} sections, ${chars} chars` +
         (e.label === "auto" ? "" : `  ${e.label}`) +
         (e.kind === "keep" ? "  *" : "");
}

/* ---------- preset library ----------
   Presets are grouped by section title, so opening the library from
   "Quality Anchor" shows quality anchors first. Shared across workflows.

   They live in a JSON file in ComfyUI's user directory, not in the browser.
   Site data being cleared, or moving to another browser, used to take every
   saved anchor with it. localStorage is kept only long enough to carry an
   existing library across on the first run.

   The panel reads the list synchronously in a dozen places, so the file is
   mirrored in memory: psRead serves the cache, psWrite updates the cache and
   sends it on. A write that cannot reach the backend falls back to the
   browser rather than being lost. */
const PS_KEY = "leiel.vpc.presets";
/* Room for a working lifetime of anchors. A big anchor is a few kilobytes,
   so even a full library is a file of a few megabytes - read once a session
   and rewritten in milliseconds. The number is here to stop something going
   wrong quietly, not to ration anything. */
const PS_MAX = 2000;
const PS_URL = "/leiel_vpc/presets";
const SNIP_URL = "/leiel_vpc/snippets";

/* ---------- the Drawer ----------
   Anchors kept for good, outside any series: an outfit, a pose, a camera
   that worked, to be taken out again in another series later. One store for
   the whole page - every Series Book on the canvas shows the same drawer and
   repaints when any of them changes it. */
const DRAWER_URL = "/leiel_vpc/drawer";

/* The style bar's settings - paragraph and character styles, favourite fonts
   and colours, and which installed face each font mark points at - are kept
   in a file beside the books, so they survive a restart, another port or a
   cleared browser. The browser's own storage only keeps a copy; on the first
   load whatever it already held is carried over to the file. */
const PREFS_URL = "/leiel_vpc/ui_prefs";
const PREF_KEYS = ["lvp-pstyles", "lvp-cstyles", "lvp-font-fav", "lvp-font-reg", "lvp-rgb-fav"];
const PREFS = {};
let prefsTimer = null;
function prefRaw(key) {
  if (Object.prototype.hasOwnProperty.call(PREFS, key)) return PREFS[key];
  try { return localStorage.getItem(key); } catch (e) { return null; }
}
function prefPut(key, str) {
  PREFS[key] = str;
  try { localStorage.setItem(key, str); } catch (e) { /* storage off */ }
  clearTimeout(prefsTimer);
  prefsTimer = setTimeout(savePrefs, 400);
}
function savePrefs() {
  const out = {};
  for (const k of PREF_KEYS) { const v = prefRaw(k); if (typeof v === "string") out[k] = v; }
  fetch(PREFS_URL, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prefs: out }) }).catch(() => {});
}
fetch(PREFS_URL).then(r => r.json()).then((j) => {
  const got = (j && j.prefs) || {};
  let carry = false;
  for (const k of PREF_KEYS) {
    if (typeof got[k] === "string") PREFS[k] = got[k];
    else { try { if (localStorage.getItem(k)) carry = true; } catch (e) { /* ignore */ } }
  }
  if (carry) savePrefs();
  /* fonts used in notes already on screen can be drawn now */
  try { for (const el of document.querySelectorAll(".lvp-ta")) ensureRgbIn(el); } catch (e) { /* ignore */ }
}).catch(() => {});
const DRAWER_KINDS = ["quality", "subject", "outfit", "pose", "scene", "camera", "absolute"];
const drawerStore = { items: [], folders: [], loaded: false, loading: null, rev: 0, subs: new Set() };
function drawerNotify() {
  drawerStore.rev++;
  for (const f of drawerStore.subs) { try { f(); } catch (e) { /* a closed node */ } }
}
/* A folder belongs to one kind of anchor: a "Ballet" among the poses has
   nothing to do with one among the outfits. Kept as "pose::Ballet". */
const FOLDER_SEP = "::";
const fKey = (kind, name) => `${kind}${FOLDER_SEP}${name}`;
const fKind = (key) => { const i = String(key || "").indexOf(FOLDER_SEP); return i > 0 ? key.slice(0, i) : ""; };
const fName = (key) => { const i = String(key || "").indexOf(FOLDER_SEP); return i > 0 ? key.slice(i + FOLDER_SEP.length) : String(key || ""); };
/* Folders from before they had a kind take the kind of the cards in them;
   an empty one is let go. */
function drawerMigrateFolders() {
  const fs = drawerStore.folders || [];
  if (!fs.some(f => !fKind(f))) return false;
  const out = fs.filter(f => fKind(f));
  const items = drawerStore.items.map(i => {
    if (!i.folder || fKind(i.folder)) return i;
    const k = fKey(i.kind, i.folder);
    if (!out.includes(k)) out.push(k);
    return { ...i, folder: k };
  });
  drawerWrite(items, out);
  return true;
}
function drawerLoad() {
  if (drawerStore.loading) return drawerStore.loading;
  drawerStore.loading = fetch(DRAWER_URL)
    .then(r => r.json())
    .then(j => { drawerStore.items = Array.isArray(j && j.items) ? j.items : [];
                 drawerStore.folders = Array.isArray(j && j.folders) ? j.folders : []; })
    .catch(() => {})
    .finally(() => { drawerStore.loaded = true; if (!drawerMigrateFolders()) drawerNotify(); });
  return drawerStore.loading;
}
async function drawerWrite(items, folders) {
  drawerStore.items = items;
  if (Array.isArray(folders)) drawerStore.folders = folders;
  drawerNotify();
  try {
    const r = await fetch(DRAWER_URL, { method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items, folders: drawerStore.folders }) });
    const j = await r.json();
    return !!(j && j.ok);
  } catch (e) { return false; }
}
const drawerId = () => "d" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
/* A model's name at the front of a capsule name - "Amara, Denim Shirt" -
   is taken as a tag when the capsule is put in the drawer, so the drawer
   can be narrowed to one model without anything typed. */
function drawerGuessTags(name) {
  const m = /^\s*([A-Z][a-z]+)\s*,/.exec(String(name || ""));
  return m ? [m[1]] : [];
}
/* A picture made small enough to live inside the drawer file: 240px on its
   long side, as a JPEG. */
function drawerThumbFrom(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const k = 360 / Math.max(img.naturalWidth, img.naturalHeight);
        const w = Math.max(1, Math.round(img.naturalWidth * Math.min(1, k)));
        const h = Math.max(1, Math.round(img.naturalHeight * Math.min(1, k)));
        const cv = document.createElement("canvas");
        cv.width = w; cv.height = h;
        cv.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(cv.toDataURL("image/jpeg", 0.82));
      } catch (e) { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}
/* The picture an Image Viewer on the canvas is showing large; failing that
   the one framed in its grid (the last one opened), then a picked one, then
   the newest render. A grid picture that has not loaded yet (the grid loads
   lazily) still counts: its address is enough to read it from. */
function viewerPicture() {
  const vis = (i) => i && i.src && !/^data:,?$/.test(i.src);
  const bigs = [...document.querySelectorAll(".viv-stage.b img")]
    .filter(i => vis(i) && i.naturalWidth && i.offsetParent);
  if (bigs.length) return bigs[0].src;
  for (const sel of [".viv-cell.cur img", ".viv-cell.picked img", ".viv-cell.fresh img"]) {
    const hit = [...document.querySelectorAll(sel)].find(vis);
    if (hit) return hit.src;
  }
  return null;
}
/* Which library a section sees. Matched on a word inside the title rather than
   on the whole title, so "Camera Anchor", "Camera Details" and "camera" all
   reach the same shelf. The aliases are the reader's own: a section called
   Model Anchor holds a person, which is the subject shelf. Longest first, so
   "casting" is tried before "cast" could ever match something else. */
const SNIP_ALIAS = [
  ["quality", "quality"],
  ["outfit", "outfit"],
  ["wardrobe", "outfit"],
  ["styling", "outfit"],
  ["subject", "subject"],
  ["character", "subject"],
  ["casting", "subject"],
  ["model", "subject"],
  ["scene", "scene"],
  ["setting", "scene"],
  ["location", "scene"],
  ["background", "scene"],
  ["camera", "camera"],
  ["lens", "camera"],
  ["framing", "camera"],
  ["composition", "camera"],
  /* last, so a title that names another layer reaches that shelf first */
  ["pose", "pose"],
  ["posture", "pose"],
  ["gesture", "pose"],
  ["action", "pose"],
  ["movement", "pose"],
];
function snipKind(title) {
  const t = String(title || "").toLowerCase();
  for (const [word, kind] of SNIP_ALIAS) if (t.includes(word)) return kind;
  return t.trim().replace(/\s+/g, " ");
}

/* ---------- anchors by kind ----------
   What a section IS, as opposed to what it is called. Paste reads a reply by
   its labels, and the Series Book sorts its capsules into rows, and both need
   "Pose Anchor", "POSE" and "pose" to land in the same place. The two kinds
   the reader has no question for - the trigger line and ABSOLUTE - are named
   here as well, because a reply carries them like any other anchor. */
const KIND_ORDER = ["trigger", "quality", "subject", "outfit", "pose", "scene", "camera",
                    "absolute"];
const KIND_TITLE = {
  trigger: "LoRA Trigger", quality: "Quality Anchor", subject: "Subject Anchor",
  outfit: "Outfit Anchor",
  pose: "Pose Anchor", scene: "Scene Anchor", camera: "Camera Anchor",
  absolute: "ABSOLUTE",
};
const KIND_LABEL = {
  trigger: "Trigger", quality: "Quality", subject: "Subject", outfit: "Outfit", pose: "Pose",
  scene: "Scene", camera: "Camera", absolute: "Absolute", other: "Other",
};
/* A series' own colour, picked on a Series Lab's prompt shelf and kept in
   the book with the series. Same order as SERIES_HUES in the Lab; the Lab
   wears it bright, the book a step quieter, mixed into its own tone. */
const SERIES_TONES = ["#22c3d6", "#c9a33f", "#f05aa8", "#2fcf7f", "#3a7bff",
                      "#9a7cff", "#ff8a3d", "#ff5555", "#a8b0bc",
                      "#b6e33a", "#e04cf0", "#58c8ff"];
/* A series not given a colour yet wears the first one - the same teal the
   Lab's shelf starts every series in - so the two agree from the start. */
/* A second version of a capsule is "Name v2", not "Name 2": a bare number
   beside the use count read as one more count. Books from before are
   renamed on load - only where the plain "Name" is there beside it, so a
   name that simply ends in a number ("Comms Unit 7") is left as it is. */
const VER_RE = /\s+v?(\d+)$/i;
function versionNames(caps) {
  const list = Object.values(caps || {});
  const names = new Set(list.map(c => `${c.kind}|${c.g}|${String(c.name || "").trim().toLowerCase()}`));
  for (const c of list) {
    const m = /^(.*\S)\s+(\d+)$/.exec(String(c.name || "").trim());
    if (!m || Number(m[2]) < 2 || Number(m[2]) > 99) continue;
    const key = (n) => `${c.kind}|${c.g}|${n.toLowerCase()}`;
    const next = `${m[1]} v${m[2]}`;
    if (!names.has(key(m[1])) || names.has(key(next))) continue;
    names.delete(key(c.name.trim()));
    c.name = next;
    names.add(key(next));
  }
}
/* Gold is no longer offered: it is the colour of the capsule numbers, and a
   series in it read its figure as one more prompt number. A series that wore
   it wears the first colour now; the places in the list stay, so every other
   series keeps its own. The Series Lab leaves the same one out. */
const RETIRED_TONES = new Set([1]);
const toneIdx = (h) => (Number.isInteger(h) && SERIES_TONES[h] && !RETIRED_TONES.has(h) ? h : 0);
const seriesTone = (g) => g ? SERIES_TONES[toneIdx(g.hue)] : null;
/* The frame a prompt wants. A Series Lab rendering it narrows a Visual
   Latent Size Picker to sizes of that shape for the render; "all" leaves
   the picker alone. */
const ORIENTS = ["all", "portrait", "landscape", "square"];
const ORIENT_NAME = { all: "any frame", portrait: "portrait", landscape: "landscape", square: "square" };
const orientOf = (q) => (q && ORIENTS.includes(q.orient) ? q.orient : "all");
/* One hue per kind, taken from the section colours so a capsule and the box
   it opens into read as the same family. Fixed per kind on purpose: the row
   a capsule sits in should be recognisable before its name is read. */
/* The drawer's own tone - flat colours, one press each on its dot - and the
   card width its slider sets: [least, most, default] in pixels. */
const DRAWER_TONES = [
  ["Walnut", "#19140d", "#4d3d24"], ["Espresso", "#120e09", "#3b2e1c"], ["Graphite", "#16171a", "#30323a"],
  ["Ink", "#0e0f12", "#26282e"], ["Olive", "#14160f", "#363b27"], ["Navy", "#10141b", "#28313f"],
  ["Plum", "#17121a", "#3a2c3d"],
];
const DRAWER_SIZE = [80, 220, 100];
const KIND_HUE = {
  trigger: "#9a9a9a", quality: "#c98a3c", subject: "#c06a9c", outfit: "#8fa83f", pose: "#48a882",
  scene: "#4a92c8", camera: "#7b6ce0", absolute: "#c85f5f", other: "#8a8a8a",
};

/* ---- the anchor check ----
   A scene written in one go is written with every anchor in view: a close
   portrait gets a collar rather than shoes, a head turn rather than a stride.
   Anchors combined from a drawer were each written alone, and the commonest
   way they disagree is over how much of the body the picture holds. The
   model, asked for a face filling the frame and for loafers on wet cobbles,
   draws both - a large face and a small full figure beside it.

   This reads each anchor for what it asks of the frame and says, before a
   render, where they pull apart. It only warns; it never rewrites, since the
   same words in every scene is what keeps a series together. */
const CK_RE = {
  camFace: /\b(close[- ]?up|close portrait|head[- ]and[- ]shoulders|headshot|(head|chin) to the (shoulders|chest|collarbones?)|face fill(s|ing)|face filling|framed (tight|tightly) on the face|extreme close|beauty shot|macro)\b/i,
  camHalf: /\b(waist[- ]up|half[- ]length|to the (waist|hips|thighs|knees)|from the waist|chest up|from the chest|three[- ]quarter length|from the (knees|thighs|hips) up|knees up|mid[- ]shot|medium shot|cropped at the (waist|hips|thighs|knees))\b/i,
  camFull: /\b(full[- ]length|full[- ]body|whole figure|whole body|head to (the )?(toe|feet|foot)|top of the head to the feet|feet on the ground|from head to toe|entire figure)\b/i,
  camSmall: /\b(figure small|small in the (frame|lower|upper)|tiny figure|figure tiny|far back|from far away)\b/i,
  camLow: /\b(low angle|low near the ground|looking up at|worm'?s[- ]eye)\b/i,
  poseFull: /\b(walk(ing|s)?|stride|striding|mid[- ]stride|stepping|steps (forward|out|toward)|run(ning)?|jump(ing)?|danc(e|ing)|crouch(ing|ed)?|kneel(ing|s)?|squat(ting)?|lying|lies (on|back|down)|reclin(ing|es)|legs? (crossed|stretched|bent|out|apart)|one (foot|leg)|feet|weight on|knees? (up|drawn|bent|together))\b/i,
  outfitFeet: /\b(shoes?|loafers?|boots?|heels?|sneakers?|trainers?|sandals?|pumps|mules|brogues|oxfords|flats|stilettos?|socks?|barefoot|ankle)\b/i,
  outfitLegs: /\b(trousers|jeans|skirt|pants|shorts|leggings|tights|hem)\b/i,
  lensWords: /\b(\d{2,3}\s?mm lens|lens at f\/|f\/\d|close[- ]?up|full[- ]length|full[- ]body|wide[- ]angle|telephoto|framed from|camera (at|low|high|close))\b/i,
  aspectWords: /\b(vertical|horizontal|portrait orientation|landscape orientation|\d{1,2}\s?:\s?\d{1,2}\b(?! ?(am|pm))|aspect ratio|square format)\b/i,
  aspectTall: /\b(vertical|portrait orientation|2\s?:\s?3|3\s?:\s?4|4\s?:\s?5|9\s?:\s?16)\b/i,
  aspectWide: /\b(horizontal|landscape orientation|3\s?:\s?2|4\s?:\s?3|16\s?:\s?9|21\s?:\s?9)\b/i,
  camStance: /\b(both feet (on|planted|flat)|feet (planted |flat )?on the ground|knees? (straight|locked)|standing (still|straight|square)|weight (evenly )?on both|arms (at|by) (her|his|their|the) sides?)\b/i,
  poseMove: /\b(walk(ing|s)?|stride|striding|stepping|run(ning)?|jump(ing)?|danc(e|ing)|lift(ed|s|ing)? (from|off)|one (foot|leg|knee)|sitting|seated|kneel(ing)?|crouch(ing)?|squat(ting)?|lying|leaning|twist(ing)?|turning)\b/i,
  camNear: /\b(over the shoulder|past (her|his|the) shoulder|(shoulder|head|hair)[^.;]{0,40}\b(near )?foreground)\b/i,
  camBehind: /\b(behind the figure|from behind|seen from the back)\b/i,
  camFgShape: /\b(passing (shape|figure|person)|(figure|person|people|someone)[^.;]{0,30}(near )?foreground)\b/i,
  poseTravel: /\b(walk(ing|s)?|stride|striding|mid[- ]stride|steps? (away|toward|towards|forward)|run(ning)?)\b/i,
  poseFacing: /\b(toward(s)? the camera|at the camera|into the (lens|camera)|past the lens|facing the camera|look(s|ing)? back)\b/i,
  faceBits: /\b(cheekbones?|eyes|nose|lips|mouth|brows?|jaw(line)?|chin|lashes|freckles|(oval|narrow|angular|sculpted|refined|strong|elegant|warm|round|heart-shaped) face)\b/gi,
  others: /\b(friends?|crowd|couple|group of|two (women|men|people|girls|boys)|another (woman|man|person)|people (around|walking|in the background)|passers?-?by|companions?)\b/i,
  noOthers: /\b(no other people|nobody else|empty of people)\b/i,
  one: /\b(exactly one person|one person only|only one person|a single person|one figure)\b/i,
};
const CK_LABEL = { quality: "Quality", subject: "Subject", outfit: "Outfit", pose: "Pose",
  scene: "Scene", camera: "Camera", absolute: "Absolute" };

/* What the frame looks like on the canvas: a Latent Size Picker set to one
   size or one shape, or any node with a width and height. Sizes drawn at
   random across shapes are "mixed". */
function latentShape() {
  try {
    const nodes = (app.graph?._nodes || []).filter(n => n.mode !== 2 && n.mode !== 4);
    const w = (n, name) => (n.widgets || []).find(x => x.name === name);
    const shapeOf = (wd, ht) => {
      if (!(wd > 0 && ht > 0)) return null;
      const r = wd / ht;
      return r > 1.12 ? "wide" : r < 0.89 ? "tall" : "square";
    };
    for (const n of nodes) {
      const type = String(n.comfyClass || n.type || "");
      if (type !== "RandomLatentSizePicker") continue;
      const mode = w(n, "mode")?.value;
      if (mode === "fixed") {
        const m = String(w(n, "resolution_list")?.value || "").match(/(\d+)\s*[x×,]\s*(\d+)/);
        if (m) return shapeOf(Number(m[1]), Number(m[2]));
      }
      const pre = String(w(n, "resolution_preset")?.value || "").toLowerCase();
      if (pre === "landscape") return "wide";
      if (pre === "portrait") return "tall";
      if (pre === "square") return "square";
      return "mixed";
    }
    for (const n of nodes) {
      if (!/latent/i.test(String(n.comfyClass || n.type || ""))) continue;
      const s = shapeOf(Number(w(n, "width")?.value), Number(w(n, "height")?.value));
      if (s) return s;
    }
  } catch (e) { /* no graph */ }
  return null;
}

/* anchors: [{ kind, name, text }]. Returns [{ level: "warn" | "note",
   kinds: [..], title, why, fix }], the warnings first. */
function anchorCheck(anchors, shape) {
  const by = {};
  for (const a of anchors || []) {
    if (!a || !a.kind || !String(a.text || "").trim()) continue;
    (by[a.kind] = by[a.kind] || []).push(a);
  }
  const txt = (k) => (by[k] || []).map(a => String(a.text)).join(" \n ");
  const nm = (k) => (by[k] || []).map(a => a.name || CK_LABEL[k] || k).join(", ");
  const has = (k, re) => re.test(txt(k));
  const out = [];
  const cam = txt("camera");
  const frame = !cam ? null
    : CK_RE.camFace.test(cam) ? "face"
    : CK_RE.camSmall.test(cam) ? "small"
    : CK_RE.camHalf.test(cam) ? "half"
    : CK_RE.camFull.test(cam) ? "full" : null;
  const poseFull = has("pose", CK_RE.poseFull);
  const feet = has("outfit", CK_RE.outfitFeet);
  const legs = has("outfit", CK_RE.outfitLegs);

  /* 1. a crop the rest of the scene does not fit in */
  if (frame === "face" && (poseFull || feet)) {
    const why = [];
    if (poseFull) why.push(`the Pose "${nm("pose")}" is a whole-body action`);
    if (feet) why.push(`the Outfit "${nm("outfit")}" goes down to the shoes`);
    out.push({ level: poseFull ? "warn" : "note", kinds: ["camera"].concat(poseFull ? ["pose"] : [], feet ? ["outfit"] : []),
      title: poseFull ? "A face crop with a whole body asked for" : "A face crop, and shoes in the outfit", short: "Face crop vs whole body",
      why: `The Camera "${nm("camera")}" frames the head and shoulders, but ${why.join(" and ")}. `
        + "The model tends to draw both - a large face and a small full figure beside it.",
      fix: "Pair a close camera with a head or shoulder pose and an outfit that stops at the collar - or keep this pose and outfit with a wider camera." });
  } else if (frame === "half" && txt("pose").match(CK_RE.poseTravel)) {
    /* a walk is a whole-body action: under a waist-up crop it is drawn as a
       second, whole figure as often as a face crop is */
    const w = txt("pose").match(CK_RE.poseTravel)[0];
    out.push({ level: "warn", kinds: ["camera", "pose"].concat(feet ? ["outfit"] : []),
      title: "A waist-up crop with a walk", short: "Waist-up crop vs walk",
      why: `The Camera "${nm("camera")}" frames the head to the waist, but the Pose "${nm("pose")}" is "${w}" - an action of the legs`
        + (feet ? `, and the Outfit "${nm("outfit")}" goes down to the shoes` : "")
        + ". The model often answers both with two figures - one cropped at the waist, one walking whole.",
      fix: "A walk wants a full-length camera in a tall frame; with a waist-up crop, choose a still pose or a turn of the head and shoulders." });
  } else if (frame === "half" && poseFull && /\b(kneel|crouch|squat|feet|foot|leg)/i.test(txt("pose"))) {
    out.push({ level: "note", kinds: ["camera", "pose"],
      title: "Feet in the pose, out of the frame", short: "Feet out of frame",
      why: `The Camera "${nm("camera")}" cuts above the knees while the Pose "${nm("pose")}" is about the legs or feet. It can widen the view on its own, or crop the action badly.`,
      fix: "Usually fine; if the frame drifts wider than asked, choose a pose for the upper body." });
  }

  /* 1b. a camera that sets the stance the pose is meant to set */
  const stance = cam.match(CK_RE.camStance);
  const moving = txt("pose").match(CK_RE.poseMove);
  if (stance && moving) {
    out.push({ level: "warn", kinds: ["camera", "pose"], short: "Camera sets the stance",
      title: "The camera and the pose disagree on the body",
      why: `The Camera "${nm("camera")}" says "${stance[0]}", but the Pose "${nm("pose")}" says "${moving[0]}". `
        + "Two instructions for one body - the model may answer both, with two figures.",
      fix: "Leave the stance to the Pose: take the line about feet, knees or arms out of the Camera." });
  }

  /* 1c. a camera close behind her, and a pose that walks or turns to it */
  const near = cam.match(CK_RE.camNear) || cam.match(CK_RE.camBehind);
  const walks = txt("pose").match(CK_RE.poseTravel);
  const travel = walks || txt("pose").match(CK_RE.poseFacing);
  if (near && travel) {
    out.push({ level: "warn", kinds: ["camera", "pose"], short: walks ? "Behind her, and she walks" : "Behind her, she faces it",
      title: walks ? "A camera at her shoulder, a pose that walks off" : "A camera behind her, a pose that faces it",
      why: `The Camera "${nm("camera")}" stands close behind the figure ("${near[0]}"), but the Pose "${nm("pose")}" has her "${travel[0]}". `
        + (walks ? "Close behind and walking away cannot both hold" : "A camera at her back cannot see her face it")
        + " - the model draws a near shoulder or face and another figure further off, as two people.",
      fix: "Behind her, choose a still pose looking away into the scene; for a walk or a look back, choose a camera in front or full length." });
  }
  /* 1d. a shape in the foreground, where only one person may be */
  const fg = cam.match(CK_RE.camFgShape);
  if (fg) {
    out.push({ level: "warn", kinds: ["camera"], short: "A shape in the foreground",
      title: "Someone passing in the foreground",
      why: `The Camera "${nm("camera")}" puts "${fg[0]}" between the lens and the figure. A blurred shape in front is most often drawn as a second person - often her again.`,
      fix: "Name the foreground as a thing - leaves, a railing, a lamp post - or leave it out." });
  }

  /* 1e. a face described closely, in a picture where it is small. The
     model wants to show what it is told, and a face drawn small cannot show
     cheekbones, eyes, nose and lips - so it adds a close-up of her beside the
     figure. This, more than any camera, was behind the doubled pictures:
     with the Subject cut to age, build, skin and hair they stopped. */
  const faceN = new Set((txt("subject").match(CK_RE.faceBits) || []).map(w => w.toLowerCase())).size;
  if (faceN >= 3 && frame !== "face") {
    /* with a camera holding the frame the close-up rarely gets in - a scene
       written whole carries a full face and stands; without one it is the
       commonest cause of a doubled figure */
    out.push({ level: cam ? "note" : "warn", kinds: ["subject"], short: "Face described in detail",
      title: "A face described in detail, in a picture where it is small",
      why: `The Subject "${nm("subject")}" describes the face closely (${faceN} features), but `
        + (frame ? `the Camera "${nm("camera")}" does not frame the face` : "nothing frames the face close")
        + ". The model shows what it is told - often by adding a large close-up of her beside the figure.",
      fix: "Keep the Subject to age, build, skin and hair, and let the LoRA carry the face. Describe the face only with a close portrait." });
  }

  /* 2. the shape of the frame */
  const fullish = frame === "full" || (frame === null && CK_RE.camLow.test(cam));
  /* with no camera at all the pose and the outfit choose the framing: a
     standing pose and shoes are a full figure as surely as a full-length
     camera is */
  const bodyOnly = !cam && (poseFull || feet) && !!by.pose;
  if ((fullish || bodyOnly) && (shape === "wide" || shape === "mixed")) {
    const who = fullish ? `The Camera "${nm("camera")}" holds the whole standing figure. `
      : `There is no Camera, so the Pose "${nm("pose")}"${feet ? ` and the shoes in the Outfit "${nm("outfit")}"` : ""} decide the framing - a whole standing figure. `;
    out.push({ level: "warn", kinds: fullish ? ["camera"] : ["pose"].concat(feet ? ["outfit"] : []),
      title: shape === "wide" ? "A standing figure in a wide frame" : "A standing figure, and some sizes are wide", short: "Full figure, wide frame",
      why: who
        + (shape === "wide" ? "In a wide frame" : "In the wide sizes the size picker draws")
        + " that leaves room either side, and the model may fill it - often with a second figure or a large face.",
      fix: fullish
        ? "A tall size suits it - set the size picker to portrait. For a wide frame, choose a camera that crops at the knees or the waist, and keep One Person Only in the Absolute."
        : "A tall size suits it - set the size picker to portrait. For a wide frame, add a Camera that crops at the knees or the waist." });
  }
  if (frame === "face" && shape === "wide") {
    out.push({ level: "note", kinds: ["camera"],
      title: "A head and shoulders in a wide frame", short: "Close crop, wide frame",
      why: `The Camera "${nm("camera")}" fills the frame with a face; a wide frame leaves space beside it that the model may fill.`,
      fix: "A tall or square size suits a close portrait." });
  }

  /* 3. framing said outside the Camera. The fault is the anchor that says
     it, never the camera: so only that anchor is marked, and every camera
     card stays free to choose. With no camera it is only noted - the words
     are acting as one, and will clash with the first camera put in. */
  for (const k of ["quality", "scene", "pose", "outfit", "subject"]) {
    if (!by[k]) continue;
    const m = txt(k).match(CK_RE.lensWords);
    if (!m) continue;
    out.push({ level: cam ? "warn" : "note", kinds: [k],
      title: `${CK_LABEL[k]} talks about the camera`, short: "Camera words outside Camera",
      why: `"${m[0]}" in the ${CK_LABEL[k]} "${nm(k)}" is a lens or framing word. `
        + (cam ? `The Camera "${nm("camera")}" says its own, and two framings in one prompt is the commonest cause of a collapsed picture.`
               : "With no Camera it acts as one - and it will clash with any Camera put in."),
      fix: `Keep lens and framing in the Camera only - take "${m[0]}" out of the ${CK_LABEL[k]}.` });
  }

  /* 4. a shape written in words */
  for (const k of Object.keys(by)) {
    const t = txt(k);
    const m = t.match(CK_RE.aspectWords);
    if (!m) continue;
    const saysTall = CK_RE.aspectTall.test(t), saysWide = CK_RE.aspectWide.test(t);
    const clash = (saysTall && shape === "wide") || (saysWide && shape === "tall");
    out.push({ level: clash ? "warn" : "note", kinds: [k],
      title: clash ? "The words and the frame disagree on its shape" : "A frame shape written in words", short: "Shape in the words",
      why: `The ${CK_LABEL[k] || k} "${nm(k)}" says "${m[0]}"`
        + (clash ? `, but the latent is ${shape}. The picture is squeezed into a shape it was not composed for.` : ". The latent size decides the shape; words about it only pull against it."),
      fix: "Leave the shape to the latent size and take it out of the words." });
  }

  /* 5. one person, and someone else */
  const oneSaid = has("absolute", CK_RE.one) || has("scene", CK_RE.noOthers);
  for (const k of ["pose", "scene", "outfit"]) {
    if (!by[k]) continue;
    const m = txt(k).match(CK_RE.others);
    if (!m || !oneSaid) continue;
    out.push({ level: "warn", kinds: [k, "absolute"],
      title: "One person - and someone else", short: "One person vs others",
      why: `The ${CK_LABEL[k]} "${nm(k)}" brings in "${m[0]}" while ${has("absolute", CK_RE.one) ? `the Absolute "${nm("absolute")}"` : "the Scene"} allows only one person.`,
      fix: "Keep the others out of the words, or show them only as hands, backs or blurred shapes and drop the one-person rule." });
  }

  /* 6. a close camera with legs described - milder than shoes */
  if (frame === "face" && !feet && legs && !poseFull) {
    out.push({ level: "note", kinds: ["camera", "outfit"],
      title: "Trousers or skirt in a head-and-shoulders crop", short: "Legs in a face crop",
      why: `The Outfit "${nm("outfit")}" describes the legs, which a close portrait never shows.`,
      fix: "Usually harmless; if the frame widens, use an outfit that stops at the collar." });
  }
  return out.sort((a, b) => (a.level === b.level ? 0 : a.level === "warn" ? -1 : 1));
}

function kindOf(title) {
  const t = String(title || "").toLowerCase();
  if (t.includes("absolute")) return "absolute";
  if (t.includes("trigger") || /\blora\b/.test(t)) return "trigger";
  const k = snipKind(title);
  return KIND_ORDER.includes(k) ? k : "other";
}

/* ---------- reading a reply ----------
   A scene arrives as a short reply: a name, then one labelled block per
   anchor - the label on its own line, the text in a code box under it. Copying
   the whole reply and pasting it once has to fill every box, which means
   telling the labels apart from the prose around them.

   A label is a line that is nothing but an anchor word, optionally followed by
   "Anchor", a remark in brackets and a colon, and dressed in any markdown.
   Anything more on the line makes it a sentence that happens to start with the
   word, and it is left alone - "SCENE is fine as it is" is not a label.

   A label may also carry a short name for the capsule after a dot or a dash -
   "CAMERA · High Overhead, Long Lens". A scene's pose or camera is otherwise
   named after the scene, which says nothing about what it does. The name has
   to look like a title: a few words, a capital first, no full stop - so
   "SCENE: The canal at dusk." stays a sentence. */
const REPLY_LABEL =
  /^(LORA\s+TRIGGER|TRIGGER|QUALITY|SUBJECT|OUTFIT|WARDROBE|POSE|SCENE|CAMERA|ABSOLUTE)(\s+ANCHOR)?\b(.*)$/i;

/* Any alphabet, accents included - "Développé at the Barre" is a title as
   much as "Developpe" is; read as ASCII only, the é made it a sentence and
   the whole anchor was skipped. A capital or a figure first, as before. */
const CAP_NAME_OK = /^[\p{Lu}\p{Lt}\p{N}][\p{L}\p{M}\p{N} ,.'’&\-/()]*$/u;
function replyLabel(line) {
  const bare = String(line || "").trim()
    .replace(/^[#>*\-\s]+/, "").replace(/[*_`]+/g, "").trim();
  const m = REPLY_LABEL.exec(bare);
  if (!m) return null;
  /* Capitals, or the word "Anchor": either says it is a heading. A plain
     "Pose" at the start of a line is far more likely to be prose. */
  if (m[1] !== m[1].toUpperCase() && !m[2]) return null;
  let cap = null;
  if (!/^\s*(\([^)]*\))?\s*:?\s*$/.test(m[3])) {
    const n = /^\s*(?:\([^)]*\)\s*)?(?:·|•|—|–|-|:|\|)\s*(.+?)\s*$/.exec(m[3]);
    const v = n ? n[1].replace(/[:]$/, "").trim() : "";
    /* Generous on length: a name that says what a pose does can run to
       "Sitting Up on the Lounger, Tugging a Silk Scarf". What keeps sentences
       out is the shape - a capital first, no full stop - not the word count. */
    if (!v || v.length > 80 || !CAP_NAME_OK.test(v) || /\.$/.test(v)
        || v.split(/\s+/).length > 14) return null;
    cap = v;
  }
  const w = m[1].toUpperCase().replace(/\s+/g, " ");
  const kind = (w === "LORA TRIGGER" || w === "TRIGGER") ? "trigger"
    : w === "WARDROBE" ? "outfit" : w.toLowerCase();
  return { kind, cap };
}
/* A line that starts like a label - the anchor word in capitals, then a dot
   or a dash and a name - but was not taken as one. Pasting skips it, and
   says so, rather than quietly keeping the old anchor in its place. */
function missedLabel(line) {
  if (replyLabel(line)) return null;
  const bare = String(line || "").trim()
    .replace(/^[#>*\-\s]+/, "").replace(/[*_`]+/g, "").trim();
  const m = REPLY_LABEL.exec(bare);
  if (!m || m[1] !== m[1].toUpperCase()) return null;
  if (!/^\s*(?:\([^)]*\)\s*)?(?:·|•|—|–|\|)\s*\S/.test(m[3])) return null;
  const w = m[1].toUpperCase().replace(/\s+/g, " ");
  return (w === "LORA TRIGGER" || w === "TRIGGER") ? "trigger"
    : w === "WARDROBE" ? "outfit" : w.toLowerCase();
}
function replyLabelKind(line) {
  const l = replyLabel(line);
  return l ? l.kind : null;
}

/* A line written mostly in another script than the prompt is commentary,
   not prompt. Only used where there are no code boxes to say where a block
   ends - a reply copied as rendered text rather than as markdown. */
function foreignLine(line) {
  const letters = String(line).match(/\p{L}/gu);
  if (!letters || !letters.length) return false;
  const latin = String(line).match(/\p{Script=Latin}/gu) || [];
  return latin.length / letters.length < 0.5;
}

/* A scene's name: any letters - "Réveil" as much as "Bound" - and the
   marks a title uses. Long names are fine when set apart as a heading. */
const NAME_OK = /^[\p{L}\p{N}][\p{L}\p{N}\p{M} ,.'’"“”&\-–—:;/()#+!?~|]*$/u;
function replyName(lines, upto) {
  let decorated = null, plain = null, first = true;
  for (let i = 0; i < upto; i++) {
    const raw = lines[i].trim();
    if (!raw) continue;
    const top = first;
    first = false;
    let v = null, dressed = false;
    let m;
    if ((m = /^\*\*(.+?)\*\*:?$/.exec(raw)) || (m = /^__(.+?)__:?$/.exec(raw))
        || (m = /^#{1,6}\s+(.+?)\s*#*$/.exec(raw))
        || (m = /^["“'`](.+?)["”'`]$/.exec(raw))) {
      v = m[1]; dressed = true;
    } else {
      v = raw;
    }
    v = v.replace(/[*_`]+/g, "").replace(/:$/, "").trim();
    if (v.length < 2 || v.length > 140 || !NAME_OK.test(v)) continue;
    if (replyLabelKind(v)) continue;
    /* set apart as a heading, a name may run long; a bare line has to look
       like a title, not a sentence */
    if (v.split(/\s+/).length > (dressed ? 24 : 8)) continue;
    if (dressed) decorated = v;
    /* The very first line of a paste is where a name goes, so there it may
       run as long as a scene name does - "Act 01 - The Prima's Grand Solo 02"
       is nine words, and held to six it was not taken as a name at all: the
       paste then went into the open prompt instead of a new one. Further down,
       a bare line still has to be short to count. */
    else if (!/[.!?]$/.test(v) && /^[\p{Lu}\p{N}]/u.test(v) && v.split(/\s+/).length <= (top ? 16 : 6)) plain = v;
  }
  return decorated || plain || null;
}

function parseReply(raw) {
  const lines = normalizeText(raw).split("\n");
  const found = new Map();            // kind -> text, the last one wins
  const capName = new Map();          // kind -> the name its label gave
  let firstLabel = -1, fenced = false;

  /* Code boxes first: the label is the last line of prose above the box. A
     sentence in between ("use this line instead:") breaks the link, so a box
     only counts when a label is the thing directly over it. */
  let label = null;
  for (let i = 0; i < lines.length; i++) {
    const fm = /^\s*(`{3,}|~{3,})/.exec(lines[i]);
    if (fm) {
      fenced = true;
      const fence = fm[1];
      const body = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence)) {
        body.push(lines[i]); i++;
      }
      const text = body.join("\n").trim();
      if (label && text) {
        found.set(label.kind, text);
        if (label.cap) capName.set(label.kind, label.cap); else capName.delete(label.kind);
      }
      label = null;
      continue;
    }
    if (!lines[i].trim()) continue;
    const l = replyLabel(lines[i]);
    if (l && firstLabel < 0) firstLabel = i;
    label = l;
  }

  /* No boxes at all: the reply was copied as text. A block runs from its
     label to the next one, and stops early at commentary. */
  if (!fenced) {
    let cur = null;
    const close = () => {
      if (cur) {
        const text = cur.body.join("\n").trim();
        if (text) {
          found.set(cur.kind, text);
          if (cur.cap) capName.set(cur.kind, cur.cap); else capName.delete(cur.kind);
        }
      }
      cur = null;
    };
    for (let i = 0; i < lines.length; i++) {
      const l = replyLabel(lines[i]);
      if (l) {
        close();
        cur = { kind: l.kind, cap: l.cap, body: [] };
        if (firstLabel < 0) firstLabel = i;
        continue;
      }
      if (!cur) continue;
      if (foreignLine(lines[i])) { close(); continue; }
      cur.body.push(lines[i]);
    }
    close();
  }

  const anchors = KIND_ORDER.filter(k => found.has(k))
    .map(k => ({ kind: k, text: found.get(k), cap: capName.get(k) || null }));
  const name = anchors.length
    ? replyName(lines, firstLabel < 0 ? lines.length : firstLabel) : null;
  const missed = [...new Set(lines.map(missedLabel).filter(Boolean))]
    .filter(k => !found.has(k));
  return { name, anchors, missed };
}

/* Several scenes in one paste - a whole series copied out with Copy, or a
   reply that renames the capsules of every scene at once. A scene starts at a
   name set apart as a heading (bold, #, quoted) with labelled anchors after it
   before the next such name. A heading with no anchors under it - the series
   title, a remark - starts nothing. One scene, or none found, is the ordinary
   single reply. */
function dressedName(line) {
  const raw = String(line || "").trim();
  const m = /^\*\*(.+?)\*\*:?$/.exec(raw) || /^__(.+?)__:?$/.exec(raw)
    || /^#{1,6}\s+(.+?)\s*#*$/.exec(raw) || /^["“'`](.+?)["”'`]$/.exec(raw);
  if (!m) return null;
  const v = m[1].replace(/[*_`]+/g, "").replace(/:$/, "").trim();
  if (v.length < 2 || v.length > 140 || !NAME_OK.test(v) || replyLabel(raw)) return null;
  return v;
}
/* A note in a paste: "NOTE:" and the lines under it, up to the
   next label, scene name or series heading. Under a series heading it is the
   series' note; under a scene name, that prompt's note. */
const NOTE_MARK = /^\s*(?:\*\*)?(?:NOTE|MEMO)(?:\*\*)?\s*:\s*(.*)$/i;
/* "# Series 2 - Controluce", as Copy writes it, or "# Series - Controluce"
   with no number - the series is found by its name, or made */
const SERIES_HEAD = /^#{1,6}\s+Series(?:\s+(\d+))?\s*[-–—:]\s*(.+?)\s*$/i;
/* "FRAME: landscape" under a scene name - portrait, landscape, square or
   all: the prompt's frame, as the icon on its chip */
const FRAME_MARK = /^\s*(?:\*\*)?FRAME(?:\*\*)?\s*:\s*(.+?)\s*$/i;
function frameWord(v) {
  const w = String(v || "").trim().toLowerCase();
  if (/^(portrait|vertical)\b/.test(w)) return "portrait";
  if (/^(landscape|horizontal)\b/.test(w)) return "landscape";
  if (/^square\b/.test(w)) return "square";
  if (/^(all|any)\b/.test(w)) return "all";
  return null;
}
function splitScenes(raw) {
  const lines = normalizeText(raw).split("\n");
  const starts = [], series = [], notes = [], frames = [], serList = [];
  let fence = null, open = -1, ser = null, openNote = null, openFrame = null, last = null;
  const hardStop = (u) => /^\*\*.+\*\*:?$/.test(u) || /^__.+__:?$/.test(u) || /^#{1,6}\s/.test(u);
  for (let i = 0; i < lines.length; i++) {
    const fm = /^\s*(`{3,}|~{3,})/.exec(lines[i]);
    if (fm) { fence = fence ? (lines[i].trim().startsWith(fence) ? null : fence) : fm[1]; continue; }
    if (fence) continue;
    const t = lines[i].trim();
    const fr = FRAME_MARK.exec(t);
    if (fr && last === "scene" && frameWord(fr[1])) {
      if (open >= 0) openFrame = frameWord(fr[1]); else if (frames.length) frames[frames.length - 1] = frameWord(fr[1]);
      lines[i] = "";
      continue;
    }
    const nm = NOTE_MARK.exec(t);
    if (nm) {
      const body = nm[1] ? [nm[1]] : [];
      let j = i + 1;
      for (; j < lines.length; j++) {
        const u = lines[j].trim();
        if (replyLabel(u) || hardStop(u) || NOTE_MARK.test(u) || (FRAME_MARK.test(u) && frameWord(FRAME_MARK.exec(u)[1]))
            || /^\s*(`{3,}|~{3,})/.test(lines[j])) break;
        body.push(lines[j].replace(/\s+$/, ""));
      }
      const text = body.join("\n").trim();
      if (last === "series" && ser) ser.note = text;
      else if (last === "scene") { if (open >= 0) openNote = text; else if (notes.length) notes[notes.length - 1] = text; }
      else if (!ser) serList.top = text;          // above everything: the series the scenes go to
      for (let k = i; k < j; k++) lines[k] = "";  // a note is never read as an anchor
      i = j - 1;
      continue;
    }
    const sm = SERIES_HEAD.exec(t);
    if (sm) {
      ser = { no: sm[1] ? Number(sm[1]) : null, name: sm[2].trim(), note: null };
      serList.push(ser); open = -1; last = "series";
      continue;
    }
    if (dressedName(lines[i])) { open = i; openNote = null; openFrame = null; last = "scene"; continue; }
    if (open >= 0 && replyLabel(lines[i])) { starts.push(open); series.push(ser); notes.push(openNote); frames.push(openFrame); open = -1; }
  }
  const parts = starts.length
    ? starts.map((st, k) => ({
        text: lines.slice(st, k + 1 < starts.length ? starts[k + 1] : lines.length).join("\n"),
        series: series[k], note: notes[k] || null, frame: frames[k] || null }))
    : [{ text: lines.join("\n"), series: ser, note: openNote, frame: openFrame }];
  parts.seriesList = serList;
  return parts;
}

let PS_CACHE = null;          // null until the file has been read once
let PS_LOADING = null;

function psLocalRead() {
  try {
    const v = JSON.parse(localStorage.getItem(PS_KEY) || "[]");
    return Array.isArray(v) ? v : [];
  } catch (e) { return []; }
}

function psRead() {
  if (PS_CACHE) return PS_CACHE.slice();
  /* Asked for before the file came back: answer from the browser copy so the
     panel is never blank, and let psLoad correct it a moment later. */
  return psLocalRead();
}

async function psLoad() {
  if (PS_CACHE) return PS_CACHE;
  if (PS_LOADING) return PS_LOADING;
  PS_LOADING = (async () => {
    let list = null;
    try {
      const r = await fetch(PS_URL, { cache: "no-store" });
      if (r.ok) {
        const v = await r.json();
        if (Array.isArray(v)) list = v;
      }
    } catch (e) { /* no backend: stay on the browser copy */ }

    if (list === null) {                       // route missing entirely
      PS_CACHE = psLocalRead();
      return PS_CACHE;
    }
    if (!list.length) {
      /* First run against the file: carry the browser library across so
         nothing saved before this change is left behind. */
      const legacy = psLocalRead();
      if (legacy.length) {
        PS_CACHE = legacy;
        psPush(legacy);
        return PS_CACHE;
      }
    }
    PS_CACHE = list;
    return PS_CACHE;
  })();
  try { return await PS_LOADING; } finally { PS_LOADING = null; }
}

async function psPush(list) {
  try {
    const r = await fetch(PS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(list),
    });
    if (r.ok) {
      const j = await r.json().catch(() => null);
      if (j && Array.isArray(j.presets)) PS_CACHE = j.presets;
      return true;
    }
  } catch (e) { /* fall through to the browser */ }
  try { localStorage.setItem(PS_KEY, JSON.stringify(list.slice(0, PS_MAX))); }
  catch (e) { /* quota or private mode */ }
  return false;
}

function psWrite(list) {
  /* No slicing here. Quietly dropping the oldest entry to make room is how a
     library loses the thing its owner never thought to check on. Callers
     refuse instead, and say so. */
  PS_CACHE = list.slice();
  psPush(PS_CACHE);
}
function psKind(title) {
  return String(title || "").trim().toLowerCase().replace(/\s+/g, " ");
}
/* Returns why it did or did not happen, so the panel can say something more
   useful than nothing at all. */
function psSave(title, name, text) {
  if (!String(text || "").trim()) return "empty";
  const list = psRead();
  const kind = psKind(title);
  const i = list.findIndex(p => p.kind === kind && p.name === name);
  const entry = { kind, name, text, t: Date.now() };
  if (i >= 0) {
    list[i] = entry;                       // replacing one does not grow it
  } else {
    if (list.length >= PS_MAX) return "full";
    list.unshift(entry);
  }
  psWrite(list.sort((a, b) => b.t - a.t));
  return "saved";
}

/* The library still has to be able to leave as a file: a workflow handed to
   someone else arrives without it, and a second machine has its own. */
const PS_FORMAT = "leiel.vpc.presets";

function psExport() {
  const list = psRead();
  if (!list.length) return 0;
  const doc = { format: PS_FORMAT, version: 1, t: Date.now(), presets: list };
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" }));
  const d = new Date(), p = x => String(x).padStart(2, "0");
  const a = document.createElement("a");
  a.href = url;
  a.download = `vpc-presets-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ } }, 1000);
  return list.length;
}

/* Merge, never overwrite: an import adds to the library rather than replacing
   it, and when the same kind+name arrives twice the newer copy wins. Returns
   null when the file is not one of ours, so the caller can say so plainly
   instead of silently importing nothing. */
function psImport(text) {
  let doc;
  try { doc = JSON.parse(text); } catch (e) { return null; }
  const incoming = Array.isArray(doc) ? doc : (doc && doc.presets);
  if (!Array.isArray(incoming)) return null;

  const list = psRead();
  let added = 0, updated = 0, skipped = 0, refused = 0;
  for (const raw of incoming) {
    const name = String((raw && raw.name) || "").trim();
    const body = String((raw && raw.text) || "");
    if (!name || !body.trim()) { skipped++; continue; }
    const kind = psKind(raw && raw.kind);
    /* A timestamp of 0 is a timestamp. Testing it with || sent the oldest
       preset in a file to the top of the list and pushed the newest off the
       end of the cap. */
    const rt = Number(raw && raw.t);
    const t = Number.isFinite(rt) ? rt : Date.now();
    const i = list.findIndex(p => p.kind === kind && p.name === name);
    if (i < 0) {
      /* Full means full. Nothing already in the library is pushed out to fit
         something arriving from a file. */
      if (list.length >= PS_MAX) { refused++; continue; }
      list.push({ kind, name, text: body, t }); added++;
    } else if (t > (Number.isFinite(Number(list[i].t)) ? Number(list[i].t) : 0)) {
      list[i] = { kind, name, text: body, t }; updated++;
    } else skipped++;
  }
  list.sort((a, b) => b.t - a.t);
  psWrite(list);
  return { added, updated, skipped, refused };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

/* Both were lost when the old find panel was removed, so REPLACE was calling
   functions that no longer existed and silently did nothing. */
function findRegex(find, matchCase, wholeWord) {
  let pat = escapeRe(find);
  if (wholeWord) pat = "\\b" + pat + "\\b";
  return new RegExp(pat, matchCase ? "g" : "gi");
}

function countMatches(text, find, matchCase, wholeWord) {
  if (!find) return 0;
  return (String(text).match(findRegex(find, matchCase, wholeWord)) || []).length;
}

function doReplace(text, find, repl, matchCase, wholeWord) {
  if (!find) return text;
  return String(text).replace(findRegex(find, matchCase, wholeWord), repl);
}

/* Marks live inside the text as spans, not as character offsets, so editing a
   sentence carries its marks along instead of leaving them behind.
   Only the plain text is ever sent to the model. */
const MARK_CLASSES = ["m-find", "m-b", "m-i", "m-u", "m-para", "m-dot", "m-key",
                      "m-hy", "m-hg", "m-hp", "m-hb",
                      "m-hr", "m-ho", "m-hn",
                      "m-cy", "m-cg", "m-cr", "m-cw", "m-cb",
                      "m-co", "m-ck", "m-cv", "m-cc", "m-cn",
                      "m-z1", "m-z2", "m-z3", "m-z4", "m-z5", "m-z6",
                      "m-za", "m-zb", "m-zc", "m-zd", "m-ze", "m-zf", "m-zg",
                      "m-q1", "m-q2", "m-q3", "m-q4", "m-q5", "m-q6", "m-q7",
                      "m-q8", "m-q9", "m-q10", "m-q11", "m-q12", "m-q13",
                      "m-title", "m-auto"];

/* A colour picked on the RGB sliders is a class too - "m-x" and its six hex
   digits - so it is kept, copied and cleaned up exactly like the preset
   colours. The rule that paints it is written the first time the class is
   seen on the page. */
const RGB_RE = /^m-x[0-9a-f]{6}$/;
/* a size typed as a number works the same way: "m-s" and the percent */
const SIZEP_RE = /^m-s\d{2,3}$/;
const RGB_SEEN = new Set();
function ensureRgb(cls) {
  if (RGB_SEEN.has(cls)) return;
  let rule = null;
  if (RGB_RE.test(cls)) rule = `.lvp-ta .${cls}{color:#${cls.slice(3)};}`;
  else if (LFONT_RE.test(cls)) {
    const key = cls.slice(3), f = fontReg()[key];
    if (!f) return;                       // not known in this browser
    ensureFace(key, f);
    rule = `.lvp-ta .${cls}{${faceCss(key, f, '"')}}`;
  }
  else if (SIZEP_RE.test(cls)) rule = `.lvp-ta .${cls}{font-size:${(+cls.slice(3)) / 100}em;}`;
  else if (TRACK_RE.test(cls)) rule = `.lvp-ta .${cls}{letter-spacing:${trackOf(cls) / 1000}em;}`;
  else if (PARA_RE.test(cls)) rule = paraRule(cls);
  if (!rule) return;
  RGB_SEEN.add(cls);
  let st = document.getElementById("lvp-rgb-marks");
  if (!st) { st = document.createElement("style"); st.id = "lvp-rgb-marks"; document.head.appendChild(st); }
  st.appendChild(document.createTextNode(rule + "\n"));
}
function ensureRgbIn(el) {
  if (!el || el.nodeType !== 1) return;
  for (const c of el.classList || []) ensureRgb(c);
  for (const x of el.querySelectorAll('[class*="m-x"],[class*="m-s"],[class*="m-y"],[class*="m-t"],[class*="m-p"]')) for (const c of x.classList) ensureRgb(c);
}
/* A font taken from this computer is "m-y" and a short hash of its face's
   PostScript name. Which face that is lives in this browser's register, so
   the rule can be written again after a reload; on a machine without that
   face the text simply falls back to the font around it. */
const LFONT_RE = /^m-y[0-9a-z]{3,9}$/;
/* letter spacing, in thousandths of an em as in InDesign: m-t50, m-tn20 */
const TRACK_RE = /^m-tn?\d{1,3}$/;
const trackOf = (c) => c.startsWith("m-tn") ? -(+c.slice(4)) : +c.slice(3);
const isDynClass = (c) => RGB_RE.test(c) || SIZEP_RE.test(c) || LFONT_RE.test(c) || TRACK_RE.test(c);
function fontReg() {
  try { return JSON.parse(prefRaw("lvp-font-reg") || "{}") || {}; } catch (e) { return {}; }
}
function fontRegPut(key, face) {
  try { const r = fontReg(); r[key] = face; prefPut("lvp-font-reg", JSON.stringify(r)); } catch (e) { /* storage off */ }
}
function fontKey(ps) {
  let h = 5381;
  for (const ch of String(ps)) h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0;
  return h.toString(36);
}
const cssName = (t) => String(t || "").replace(/["\\\n\r]/g, "");
/* A family's Light, Medium or Black is reached by asking for the family at
   that weight - which also works for the variable fonts most families ship
   as now (the Noto families among them), where every weight lives in one file and
   pointing at the file alone always gives its default weight. The alias to
   the exact face is kept behind it, and put first only for widths
   (Condensed, Wide...) that a weight cannot express. */
const WEIGHT_WORDS = [["thin", 100], ["hairline", 100], ["extralight", 200], ["ultralight", 200],
  ["demilight", 350], ["semilight", 350], ["light", 300], ["book", 400], ["regular", 400], ["normal", 400],
  ["medium", 500], ["semibold", 600], ["demibold", 600], ["extrabold", 800], ["ultrabold", 800],
  ["bold", 700], ["extrablack", 950], ["heavy", 900], ["black", 900]];
function faceW(style) {
  const t = String(style || "").toLowerCase().replace(/[\s_-]/g, "");
  for (const [w, n] of WEIGHT_WORDS) if (t.includes(w)) return n;
  return 400;
}
const faceIt = (style) => /italic|oblique/i.test(String(style || ""));
function faceCss(key, f, q) {
  const fam = cssName(f.family).replace(/'/g, "");
  const wide = /condensed|narrow|compressed|expanded|extended|wide/i.test(f.style || "");
  const list = wide ? `${q}lvp-f-${key}${q},${q}${fam}${q}` : `${q}${fam}${q},${q}lvp-f-${key}${q}`;
  return `font-family:${list},sans-serif;font-weight:${faceW(f.style)};font-style:${faceIt(f.style) ? "italic" : "normal"};`;
}
function faceRule(key, f) {
  return `@font-face{font-family:"lvp-f-${key}";src:local("${cssName(f.ps)}"),local("${cssName(f.full)}");`
    + `font-weight:1 1000;font-style:${faceIt(f.style) ? "italic" : "normal"};}`;
}
const FACE_SEEN = new Set();
function ensureFace(key, f) {
  if (!f || FACE_SEEN.has(key)) return;
  FACE_SEEN.add(key);
  let st = document.getElementById("lvp-rgb-marks");
  if (!st) { st = document.createElement("style"); st.id = "lvp-rgb-marks"; document.head.appendChild(st); }
  st.appendChild(document.createTextNode(faceRule(key, f) + "\n"));
}
const isMarkClass = (c) => MARK_CLASSES.includes(c) || isDynClass(c);

/* Paragraph marks - the Production Notes only. Each line of the notes is a
   paragraph block, and these classes sit on the block, not on characters:
   line spacing (m-pl, percent), space before and after (m-pb / m-pe, px),
   left indent (m-pi, px), first-line indent (m-pf / m-pfn, px), tab width
   (m-pt, px), alignment (m-pac / m-par / m-paj), and the two dots. */
const PARA_RE = /^m-(pl|pb|pe|pi|pt)\d{1,3}$|^m-pfn?\d{1,3}$|^m-pa[crj]$|^m-pr[ab](05|10|15|20|30)$|^m-prc[gwyb]$|^m-prs[dow]$/;
const isParaClass = (c) => c === "m-para" || c === "m-dot" || PARA_RE.test(c);
function paraRule(cls) {
  const n = +(cls.match(/\d+$/) || [0])[0];
  const sel = `.lvp-ta .pg.${cls}`;
  if (/^m-pl/.test(cls)) return `${sel}{line-height:${n / 100};}`;
  if (/^m-pb/.test(cls)) return `${sel}{padding-top:${n}px;}`;
  if (/^m-pe/.test(cls)) return `${sel}{padding-bottom:${n}px;}`;
  if (/^m-pi/.test(cls)) return `${sel}{margin-left:${n}px;}`;
  if (/^m-pt/.test(cls)) return `${sel}{tab-size:${n}px;}`;
  if (/^m-pfn/.test(cls)) return `${sel}{text-indent:-${n}px;}`;
  if (/^m-pf/.test(cls)) return `${sel}{text-indent:${n}px;}`;
  return null;
}
/* stored notes keep their paragraph blocks; anything else is cleaned as
   marked text, which is also how notes written before blocks still load */
function sanitizeMemo(html) {
  const tmp = document.createElement("div");
  tmp.innerHTML = html || "";
  const kids = Array.from(tmp.childNodes);
  if (!kids.length || !kids.every(k => k.nodeType === 1 && k.tagName === "DIV")) return sanitizeMarkup(html);
  return kids.map(d => {
    const cls = ["pg"].concat(Array.from(d.classList).filter(isParaClass));
    for (const c of cls) ensureRgb(c);
    return `<div class="${cls.join(" ")}">${sanitizeMarkup(d.innerHTML)}</div>`;
  }).join("");
}

/* Text that arrives from a preset file, an upstream node or another editor
   can carry CRLF line endings. The DOM only ever holds LF, so a string kept
   with CR in it counts one character more per line than the text the marks
   are actually made of - which is exactly how a search hit ends up painted a
   few characters to the right of the word it found. Normalise on the way in. */
function normalizeText(s) { return String(s == null ? "" : s).replace(/\r\n?/g, "\n"); }

function htmlToText(root) {
  let out = "";
  (function walk(n) {
    for (const c of n.childNodes) {
      if (c.nodeType === 3) out += c.nodeValue;
      else if (c.nodeType === 1) {
        if (c.tagName === "BR") out += "\n";
        else walk(c);
      }
    }
  })(root);
  return out;
}

/* Chrome, Edge and Safari all wrap copied HTML in a full document and pad it
   with newlines of their own:

     <html>\n<body>\n<!--StartFragment-->the real run<!--EndFragment-->\n</body>

   Those newlines were never selected, but they land in textContent and made
   the faithfulness check below disagree with text/plain - so a copy from one
   section into another arrived stripped of its marks. Cut the wrapper off at
   the fragment markers, which is exactly what they are there for. */
const FRAG_OPEN = "<!--StartFragment-->";
const FRAG_CLOSE = "<!--EndFragment-->";

function clipboardFragment(html) {
  const s = String(html || "");
  const a = s.indexOf(FRAG_OPEN);
  const b = s.lastIndexOf(FRAG_CLOSE);
  if (a >= 0 && b > a) return s.slice(a + FRAG_OPEN.length, b);
  return s;
}

/* Some browsers still hand over a stray newline at one end of the fragment
   that text/plain does not carry. Shave whitespace off the two outer edges
   only, so the run that gets inserted matches the plain text exactly and
   nothing in the middle is disturbed. */
function trimEdgeWhitespace(root) {
  for (const end of ["first", "last"]) {
    for (let guard = 0; guard < 40; guard++) {
      let n = root;
      while (n && n.nodeType === 1) n = end === "first" ? n.firstChild : n.lastChild;
      if (!n || n.nodeType !== 3) break;
      const cut = end === "first"
        ? n.data.replace(/^[ \t\r\n]+/, "")
        : n.data.replace(/[ \t\r\n]+$/, "");
      if (cut === n.data) break;
      if (cut) { n.data = cut; break; }
      let p = n.parentNode;
      p.removeChild(n);
      while (p && p !== root && !p.firstChild) { const up = p.parentNode; p.remove(); p = up; }
    }
  }
}

/* Keep only our own markup. Anything pasted in gets unwrapped to plain text. */
function sanitizeMarkup(html) {
  const tmp = document.createElement("div");
  tmp.innerHTML = html || "";
  for (let pass = 0; pass < 6; pass++) {
    let dirty = false;
    for (const el of Array.from(tmp.querySelectorAll("*"))) {
      const tag = el.tagName.toLowerCase();
      if (tag === "br") { el.replaceWith(document.createTextNode("\n")); dirty = true; continue; }
      const ok = (tag === "span" || tag === "b") &&
                 Array.from(el.classList).every(isMarkClass) &&
                 el.classList.length > 0;
      if (!ok) {
        const f = document.createDocumentFragment();
        while (el.firstChild) f.appendChild(el.firstChild);
        el.replaceWith(f);
        dirty = true;
      } else {
        for (const a of Array.from(el.attributes)) {
          if (a.name !== "class") el.removeAttribute(a.name);
        }
        for (const c of el.classList) ensureRgb(c);
      }
    }
    if (!dirty) break;
  }
  return tmp.innerHTML;
}

function textToHtml(text) { return escapeHtml(text || ""); }

/* A snippet is dropped into the box beside whatever marks are already on it,
   so the colours and emphasis a section has been given survive a phrase being
   added or swapped. The run being replaced is found by counting characters
   through the text nodes, and only that run is touched. */
function markPoint(root, offset) {
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let seen = 0, n = null, last = null;
  while ((n = w.nextNode())) {
    const len = n.nodeValue.length;
    if (offset <= seen + len) return { node: n, off: offset - seen };
    seen += len;
    last = n;
  }
  return last ? { node: last, off: last.nodeValue.length } : null;
}

function spliceMarkup(root, start, end, insert) {
  const a = markPoint(root, start);
  const b = markPoint(root, end);
  if (!a || !b) return false;
  const r = document.createRange();
  r.setStart(a.node, a.off);
  r.setEnd(b.node, b.off);
  r.deleteContents();
  r.insertNode(document.createTextNode(insert));
  root.normalize();
  return true;
}

/* A snippet dropped at the caret sits between whatever is already on either
   side of it, so it needs its own spacing: a space in front unless a line
   break is already there, and a space behind unless the next character brings
   its own gap. */
function spliceAtCaret(root, at, piece) {
  const text = htmlToText(root);
  const before = text.charAt(at - 1);
  const after = text.charAt(at);
  const lead = (!before || /\s/.test(before)) ? "" : " ";
  const tail = (!after || /\s/.test(after)) ? "" : " ";
  return spliceMarkup(root, at, at, lead + piece + tail);
}

/* ---------- styles ---------- */
const CSS = `
/* One control face for the whole node.

   Every button used to carry its own fill, its own border colour and its own
   height, so a row of five was five unrelated objects and a header of three
   was three coloured blocks shouting at a photograph. They are one object now:
   a dark chip of the same height with a hairline border and white lettering.
   Colour is what happens when the pointer arrives - each control answers in
   its own hue - and what marks the one currently in force.

   The chip keeps its own dark ground rather than sitting on whatever is
   behind it. On a node the user has coloured, transparent controls let the
   node colour wash straight through the labels; these do not. */
/* declared on all three roots, not just the node: the reader panel and the
   help panel are attached to the page rather than to the node, so tokens set
   only on the node would leave the buttons inside them with no face at all */
.lvp-wrap,.lvr-panel,.lvp-help{
  --ctl-h:18px;--ctl-bg:#1c1c1c;--ctl-bd:#4a4a4a;--ctl-ink:#e2e2e2;
  --hue:#d9b26a;--hue-soft:#d9b26a24;}
.lvp-tog,.lvp-imgb,.lvp-trb,.lvr-lay,.lvr-read,.lvr-x,.lvr-q,.lvp-btn{
  height:var(--ctl-h);box-sizing:border-box;flex:0 0 auto;
  background:var(--ctl-bg);border:1px solid var(--ctl-bd);border-radius:4px;
  color:var(--ctl-ink);font-family:inherit;font-size:9px;font-weight:600;
  letter-spacing:.3px;line-height:1;cursor:pointer;padding:0 6px;white-space:nowrap;
  display:inline-flex;align-items:center;justify-content:center;
  transition:color .1s linear,border-color .1s linear,background-color .1s linear;}
.lvp-tog:hover,.lvp-imgb:hover,.lvp-trb:hover,.lvr-lay:hover,.lvr-read:hover,
.lvr-x:hover,.lvr-q:hover,.lvp-btn:hover{border-color:var(--hue);color:var(--hue);}
/* in force: the same hue, held rather than passing */
.lvp-tog.on,.lvp-imgb.on,.lvp-trb.on,.lvr-lay.on,.lvp-btn.on{
  background:var(--hue-soft);border-color:var(--hue);color:var(--hue);}
.lvp-wrap{display:flex;flex-direction:column;gap:5px;font-family:system-ui,sans-serif;
  font-size:11px;color:var(--fg-color,#ddd);height:100%;box-sizing:border-box;
  padding:4px;position:relative;}
.lvp-bar{display:flex;gap:3px;align-items:center;flex:0 0 auto;
  flex-wrap:wrap;row-gap:3px;}
/* the toolbar wears the shared face; sentence case, no tracked-out capitals */
.lvp-btn{--hue:#d9b26a;--hue-soft:#d9b26a24;--ctl-bd:#e8e8e8;
  font-size:10px;font-weight:500;letter-spacing:.2px;padding:0 8px;}
.lvp-btn:disabled{color:#4a4a4a;border-color:#333;cursor:default;}
.lvp-btn:disabled:hover{color:#4a4a4a;border-color:#333;}
/* The rule is the grouping. There used to be a tracked-out ALIGN and STEP
   label as well, which says the same thing twice and adds two more raised
   voices to a bar that already had eleven. */
.lvp-sep{width:1px;height:12px;background:#333;margin:0 5px;flex:0 0 auto;}
.lvp-list{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;
  display:flex;flex-direction:column;gap:6px;padding-right:2px;
  padding-bottom:${LIST_PAD}px;align-content:flex-start;}
.lvp-sec{border:1px solid var(--border-color,#444);border-radius:5px;background:#1b1b1b;
  display:flex;flex-direction:column;overflow:hidden;
  /* the translation pane reads these rather than hard-coding a colour, so one
     line per section colour below re-tints the whole pane */
  --tr-bg:#0f1511;--tr-hd:#131a15;--tr-fg:#a9d8b8;}
/* bypassed: ComfyUI's own bypass purple, so the meaning is already familiar */
/* a colour the user picks for the section, overridden by the state colours
   below so bypass and wired inputs stay recognisable */
/* The colour used to live only in the border and the header strip, which made
   it hard to tell two boxes apart once you had scrolled past their heads. The
   body now carries the same hue, mixed about a tenth of the way into the dark
   grey - enough to read as "this is the orange one", faint enough to leave the
   text at full contrast. */
.lvp-sec.kd{border-color:color-mix(in srgb, var(--kc) 70%, #222);background:color-mix(in srgb, var(--kc) 14%, #111317);
  --tr-bg:color-mix(in srgb, var(--kc) 8%, #0b0c0e);--tr-hd:color-mix(in srgb, var(--kc) 14%, #0e0f12);
  --tr-fg:color-mix(in srgb, var(--kc) 55%, #e8e8e8);}
.lvp-sec.kd .lvp-head{background:color-mix(in srgb, var(--kc) 30%, #111317);}
.lvp-sec.kd .lvp-ed{background:color-mix(in srgb, var(--kc) 9%, #0d0e11);}
.lvp-wrap.is-book .lvp-sec .lvp-swatch{display:none;}
.lvp-sec.k1{border-color:#c98a3c;background:#2e271f;}
.lvp-sec.k1 .lvp-head{background:#332818;} .lvp-sec.k1 .lvp-ed{background:#251e16;}
.lvp-sec.k1{--tr-bg:#191308;--tr-hd:#1e1a0e;--tr-fg:#e8c48a;}
.lvp-sec.k2{border-color:#4a92c8;background:#20282e;}
.lvp-sec.k2 .lvp-head{background:#1e2c3a;} .lvp-sec.k2 .lvp-ed{background:#171f25;}
.lvp-sec.k2{--tr-bg:#0c1219;--tr-hd:#111823;--tr-fg:#9dc0e8;}
.lvp-sec.k3{border-color:#48a882;background:#202b26;}
.lvp-sec.k3 .lvp-head{background:#1c3029;} .lvp-sec.k3 .lvp-ed{background:#17221d;}
.lvp-sec.k3{--tr-bg:#0d1712;--tr-hd:#121e18;--tr-fg:#9ad8b6;}
.lvp-sec.k4{border-color:#c06a9c;background:#2d2429;}
.lvp-sec.k4 .lvp-head{background:#361f2d;} .lvp-sec.k4 .lvp-ed{background:#241b20;}
.lvp-sec.k4{--tr-bg:#180d14;--tr-hd:#1e131a;--tr-fg:#e8a8ca;}
.lvp-sec.k5{border-color:#7b6ce0;background:#262431;}
.lvp-sec.k5 .lvp-head{background:#2b2740;} .lvp-sec.k5 .lvp-ed{background:#1d1b28;}
.lvp-sec.k5{--tr-bg:#110f1c;--tr-hd:#171524;--tr-fg:#c0b6f0;}
.lvp-sec.k6{border-color:#c85f5f;background:#2e2222;}
.lvp-sec.k6 .lvp-head{background:#3a2020;} .lvp-sec.k6 .lvp-ed{background:#251a1a;}
.lvp-sec.k6{--tr-bg:#180c0c;--tr-hd:#1e1212;--tr-fg:#f0a8a8;}
.lvp-sec.off{border-color:#a363a3;background:#221a22;}
.lvp-sec.off .lvp-head{background:#2c1f2c;}
.lvp-sec.off .lvp-ed{background:#1a141a;}
.lvp-sec.off{--tr-bg:#150f15;--tr-hd:#1a131a;--tr-fg:#c79ac7;}
.lvp-sec.off input.t{color:#c79ac7;text-decoration:line-through;}
/* one colour per external mode */
.lvp-sec.ext-replace{border-color:#5a8fd0;}
.lvp-sec.ext-replace .lvp-head{background:#1e2a38;}
.lvp-sec.ext-append{border-color:#5aa87a;}
.lvp-sec.ext-append .lvp-head{background:#1c2f26;}
.lvp-sec.ext-prepend{border-color:#c9923c;}
.lvp-sec.ext-prepend .lvp-head{background:#332818;}
.lvp-sec textarea.locked{opacity:.35;pointer-events:none;font-style:italic;}
.lvp-note{font-size:9px;padding:2px 6px;opacity:.65;background:#141414;
  border-top:1px solid #2a2a2a;flex:0 0 auto;}
.lvp-badge.m-replace{border-color:#5a8fd0;color:#9dc0e8;}
.lvp-badge.m-append{border-color:#5aa87a;color:#9ad8b6;}
.lvp-badge.m-prepend{border-color:#c9923c;color:#e8c48a;}
.lvp-tog.byp{--hue:#c79ac7;--hue-soft:#c79ac724;
  background:var(--hue-soft);border-color:var(--hue);color:var(--hue);}
/* the same face as PRESET at the other end of the row, so the two ends of the
   header are set in one voice rather than one typeset and one monospaced */
.lvp-cnt{font-size:9px;font-weight:600;letter-spacing:1px;opacity:.4;
  flex:0 0 auto;font-family:inherit;}
.lvp-sec.collapsed .lvp-grip,.lvp-sec.collapsed textarea,
.lvp-sec.collapsed .lvp-note{display:none;}
/* was a 9px grey triangle - nobody could tell it was a control */
.lvp-caret{cursor:pointer;opacity:.75;font-size:13px;line-height:1;flex:0 0 auto;
  width:15px;text-align:center;color:#b9b9b9;border-radius:3px;}
.lvp-caret:hover{opacity:1;color:#7ab8ff;background:#2f2f2f;}
.lvp-head{display:flex;align-items:center;gap:4px;padding:2px 5px;background:#232323;
  height:${HEADER_H}px;box-sizing:border-box;flex:0 0 auto;}
.lvp-swatch{cursor:pointer;font-size:10px;opacity:.65;flex:0 0 auto;
  padding:0 1px 0 0;color:#8a8a8a;}
.lvp-swatch:hover{opacity:1;}
.lvp-sec.k1 .lvp-swatch{color:#c98a3c;opacity:1;}
.lvp-sec.k2 .lvp-swatch{color:#4a92c8;opacity:1;}
.lvp-sec.k3 .lvp-swatch{color:#48a882;opacity:1;}
.lvp-sec.k4 .lvp-swatch{color:#c06a9c;opacity:1;}
.lvp-sec.k5 .lvp-swatch{color:#7b6ce0;opacity:1;}
.lvp-sec.k6 .lvp-swatch{color:#c85f5f;opacity:1;}
/* fixed, so a short title does not shrink the box you have to type into */
.lvp-head input.t{flex:0 0 170px;width:170px;min-width:0;background:transparent;border:1px solid transparent;
  color:#e6e6e6;font-size:11px;font-weight:600;padding:1px 3px;border-radius:3px;
  letter-spacing:.3px;}
.lvp-head input.t:hover{border-color:#444;}
.lvp-head input.t:focus{outline:none;border-color:#7ab8ff;background:#111;}
.lvp-tog{--hue:#e8a860;--hue-soft:#e8a86024;width:18px;padding:0;}
/* Lettered marks and drawn ones sat on different baselines: a glyph is placed
   by the font's line box, an svg by its own height, so the triangles, the X
   and the three icons all landed a pixel or two apart. Giving every mark the
   same box and centring in it puts them on one line whatever is inside. */
.lvp-mini{cursor:pointer;opacity:.5;font-size:11px;font-weight:700;padding:0 3px;
  flex:0 0 auto;letter-spacing:.3px;height:14px;line-height:1;
  display:inline-flex;align-items:center;justify-content:center;}
.lvp-mini.ico{padding:0 2px;}
.lvp-mini.ico svg{display:block;}
.lvp-tiny{background:#2b2b2b;border:1px solid #555;border-radius:3px;color:#ccc;
  font-size:9px;font-weight:600;letter-spacing:1px;padding:1px 6px;cursor:pointer;
  flex:0 0 auto;line-height:1.3;font-family:inherit;}
.lvp-tiny:hover{background:#3a5a7a;border-color:#7ab8ff;color:#fff;}
.lvp-bar-sep{width:1px;height:12px;background:#5a5a5a;margin:0 5px;flex:0 0 auto;}
.lvp-mini:hover{opacity:1;color:#7ab8ff;}
.lvp-mini.del{margin-right:1px;}
.lvp-mini.del:hover{color:#f88;}
.lvp-badge{font-size:9px;padding:0 4px;border-radius:7px;border:1px solid #5a7fb0;
  color:#9dc0e8;flex:0 0 auto;cursor:pointer;}
.lvp-ed{position:relative;flex:0 0 auto;min-height:0;border-top:1px solid #2a2a2a;
  background:#111;overflow:hidden;}
/* read-only view of whatever is wired into this section */
.lvp-ext{position:relative;flex:0 0 auto;min-height:0;border-top:1px solid #2a2a2a;
  background:#0c1218;overflow:hidden;}
.lvp-ext-tag{position:absolute;top:2px;right:4px;font-size:8px;letter-spacing:.4px;
  text-transform:uppercase;color:#6a8fc0;opacity:.8;pointer-events:none;}
.lvp-ext-body{position:absolute;inset:0;padding:4px 6px;overflow-y:auto;
  font-family:ui-monospace,Consolas,monospace;font-size:10px;line-height:1.45;
  white-space:pre-wrap;word-break:break-word;color:#9dc0e8;}
.lvp-ext-wait{opacity:.45;font-style:italic;}
/* Translation pane - a reading aid, nothing more. It is deliberately a
   different green from the blue wired-input pane, so at a glance you can tell
   "this text is going somewhere" from "this text is only for me". */
.lvp-trdiv{height:4px;background:#2a2a2a;cursor:ns-resize;flex:0 0 auto;}
.lvp-trdiv:hover{background:#3a6a4a;}
.lvp-tr{position:relative;flex:0 0 auto;min-height:0;border-top:1px solid #2a2a2a;
  background:var(--tr-bg);overflow:hidden;}
/* a strip of its own for the language picker - a floating control over the
   text collided with the first line on every short translation */
.lvp-tr-head{position:absolute;top:0;left:0;right:0;height:17px;z-index:2;
  display:flex;align-items:center;gap:6px;padding:0 4px;box-sizing:border-box;
  background:var(--tr-hd);border-bottom:1px solid #ffffff14;}
.lvp-tr-note{font-size:8px;letter-spacing:.4px;text-transform:uppercase;
  color:var(--tr-fg);opacity:.5;flex:1;min-width:0;overflow:hidden;white-space:nowrap;}
.lvp-tr-lang,.lvp-tr-unit{background:var(--tr-hd);border:1px solid #ffffff30;
  border-radius:3px;color:var(--tr-fg);font-size:11.5px;font-family:inherit;
  padding:0 3px;cursor:pointer;flex:0 0 auto;height:16px;}
.lvp-tr-lang:focus,.lvp-tr-unit:focus{outline:none;border-color:var(--tr-fg);}
.lvp-tr-body{position:absolute;inset:0;padding:21px 6px 4px;overflow-y:auto;
  font-size:10px;line-height:1.55;white-space:pre-wrap;word-break:break-word;
  color:var(--tr-fg);}
/* sentence matching: our own pane can use real spans, the editable box cannot
   (see trFocus) so it gets a CSS Custom Highlight instead */
.lvp-sent{border-radius:2px;}
.lvp-sent.on{background:#2a4a6a;color:#dbeaff;}
/* dimmed while the box underneath has moved on - what you are reading is the
   translation of the previous text, and the new one is on its way */
.lvp-tr-body.stale{opacity:.4;font-style:italic;}
.lvp-tr-body.err{color:#e6a0a0;font-style:italic;opacity:.9;}
/* the reading strip */
/* One field, one tone.

   The strip used to be a warm panel with a darker rectangle inside it and a
   dashed line drawn round that - three surfaces where there is only one
   subject. The dashes and the inner rectangle are gone; the picture now sits
   directly on a single dark ground, and the only edge is the one that
   separates the strip from the writing. */
.lvr-img{flex:0 0 auto;display:flex;flex-direction:column;gap:5px;
  box-sizing:border-box;padding:5px 6px;background:#17140c;
  border-bottom:1px solid #2e2612;}
.lvr-grip{height:6px;background:#1d190f;cursor:ns-resize;flex:0 0 auto;
  border-bottom:1px solid #2a2a2a;}
.lvr-grip:hover{background:#4a3c16;}
/* one thin row of controls under the section title, never a column of
   black space beside the picture */
.lvr-bar{flex:0 0 auto;display:flex;gap:5px;align-items:center;height:18px;
  min-width:0;}
.lvr-stage{flex:1 1 auto;min-height:0;display:flex;}
/* Sits on the picture, bottom left, dark enough to stay legible over anything
   and quiet enough not to compete with it. Never intercepts a click - the
   whole area is still the drop target. */
.lvr-badge{position:absolute;left:6px;bottom:6px;display:flex;align-items:center;
  gap:5px;padding:3px 7px 3px 5px;border-radius:4px;background:#0b0b0bcc;
  color:#e6c476;pointer-events:none;line-height:1;}
.lvr-badge svg{display:block;flex:0 0 auto;}
.lvr-badge b{font-size:9px;font-weight:600;letter-spacing:.9px;
  text-transform:uppercase;}
/* the layer bars in the control row, an indicator rather than a control */
.lvr-layers{flex:0 0 auto;display:inline-flex;align-items:center;
  justify-content:center;height:var(--ctl-h);padding:0 3px;color:#d9b26a;
  cursor:help;}
.lvr-layers svg{display:block;}
/* no border and no ground of its own - it is the same field as the strip,
   and only says so while something is being dragged over it */
.lvr-drop{flex:1 1 auto;min-width:0;border:1px solid transparent;border-radius:4px;
  display:flex;align-items:center;justify-content:center;text-align:center;
  color:#7c7261;font-size:9px;line-height:1.35;padding:3px;cursor:pointer;
  overflow:hidden;position:relative;background:transparent;}
/* one tone still, but a hairline while the pointer is over it: without a
   border there was no way to see where the target began and ended */
.lvr-drop:hover{color:#e6c476;border-color:#4a4132;}
.lvr-drop.over{border-color:#e6c476;background:#e6c47614;}
/* contain, never cover: a landscape picture is not cropped to a square */
.lvr-drop img{max-width:100%;max-height:100%;width:auto;height:auto;
  object-fit:contain;border-radius:3px;display:block;}
/* The strip and the text panes together: a column in ROW mode, a row in SIDE
   mode. Same markup either way, so nothing below has to know which it is. */
.lvp-body{flex:1 1 auto;min-height:0;min-width:0;display:flex;flex-direction:column;}
.lvp-body.side{flex-direction:row;}
.lvp-panes{flex:1 1 auto;min-height:0;min-width:0;display:flex;flex-direction:column;}
/* beside the text the strip is sized across, not down, and the rule that
   separated it from the box moves round with it */
.lvp-body.side>.lvr-img{height:auto;border-bottom:none;border-right:1px solid #2e2612;}
.lvp-body.side>.lvr-grip{width:6px;height:auto;cursor:ew-resize;
  border-bottom:none;border-right:1px solid #2a2a2a;}
.lvr-lay{--hue:#e6c476;--hue-soft:#e6c47624;width:22px;padding:0;}
/* the bars take the chip's colour, so they whiten, warm and light with it */
.lvr-lay svg{fill:currentColor;display:block;}
/* The row has to hold together when the picture column is dragged narrow.
   The select was a fixed 128px and refused to give any of it back, so READ,
   the arrangement buttons and the remove button were pushed off the end and
   simply disappeared. It gives way first now, and the buttons keep their
   place. */
/* Chrome and Firefox take the row height in the open list from the option,
   not from the select, so both are set. */
.lvp-wrap option,.lvr-panel option{font-size:11.5px;line-height:1.7;
  background:#1c1c1c;color:#e2e2e2;}
/* the heading that carries "only" for everything under it */
.lvp-wrap optgroup{font-size:10.5px;font-style:normal;font-weight:600;
  letter-spacing:.6px;background:#141414;color:#d9b26a;}
/* A native select draws its open list at the select's own font size, so this
   is what made every dropdown unreadable - not the list, the control. */
.lvr-q{--hue:#e6c476;flex:1 1 auto;min-width:46px;font-size:11.5px;font-weight:500;
  letter-spacing:0;padding:0 3px;}
.lvr-q:focus{outline:none;border-color:var(--hue);}
.lvr-read{--hue:#e6c476;font-size:10px;letter-spacing:.2px;padding:0 14px;
  min-width:54px;text-align:center;}
.lvr-stop{--hue:#e07a5f;font-size:10px;letter-spacing:.2px;padding:0 8px;
  background:#1a1207;border:1px solid #5a3226;border-radius:4px;color:#e07a5f;
  cursor:pointer;height:16px;line-height:14px;}
.lvr-stop:hover{border-color:#e07a5f;color:#f0947c;}
.lvr-targets{flex:0 0 auto;display:flex;flex-wrap:wrap;gap:4px;align-items:center;
  padding:1px 1px 0;}
.lvr-tlab{font-size:9px;letter-spacing:.9px;text-transform:uppercase;color:#6b6252;
  margin-right:2px;}
.lvr-t{font-size:10px;line-height:14px;height:16px;padding:0 7px;border-radius:4px;
  background:#15120b;border:1px solid #332c1d;color:#6b6252;cursor:pointer;
  white-space:nowrap;}
.lvr-t:hover{border-color:#e6c476;color:#bda877;}
.lvr-t.on{border-color:#e6c476;color:#e6c476;background:#e6c4761a;}
.lvr-read:disabled{color:#4a4a4a;border-color:#333;cursor:default;}
/* disabled because something else is using the card, not because there is
   nothing to read - worth telling apart */
.lvr-read.waiting:disabled{color:#7a6a4a;border-color:#4a3f2a;cursor:not-allowed;}
.lvr-read:disabled:hover{color:#4a4a4a;border-color:#333;}
.lvr-x{--hue:#e08a7a;width:20px;padding:0;font-size:10px;}
.lvr-note{font-size:9px;color:#7c7261;line-height:1.4;flex:1 1 0;min-width:0;
  overflow:hidden;white-space:nowrap;text-overflow:ellipsis;}
.lvr-note.busy{color:#d9b26a;}
.lvr-note.err{color:#e6a0a0;}
/* a fixed strip, never a competitor to the picture for the leftover space */
.lvr-custom{width:100%;box-sizing:border-box;background:#232323;border:1px solid #4a4a4a;
  border-radius:4px;color:#ddd;font:10px/1.4 monospace;padding:4px 6px;resize:none;
  flex:0 0 34px;height:34px;}
.lvr-custom:focus{outline:none;border-color:#8fb8ff;}
/* Reader was given its own amber face back when the accent lived only on the
   strip. The whole toolbar carries that amber now for whatever is live, so a
   second, permanently-lit version of it just put a box back in the row. */
/* amber on the way in, matching the strip it opens */
.lvp-imgb{--hue:#e6c476;--hue-soft:#e6c47624;font-size:8px;letter-spacing:0;}
/* Sized for reading rather than for the smallest box that would hold the
   controls: this panel is opened to check what the card is holding, often
   mid-render, and the old 9px labels were being squinted at. */
.lvr-panel{position:fixed;z-index:9999;width:600px;background:#1b1b1b;
  border:1px solid #555;border-radius:8px;padding:17px;color:#ccc;font-size:15px;
  box-shadow:0 10px 30px #000a;}
.lvr-panel h4{margin:0 0 12px;font-size:14px;letter-spacing:.1em;text-transform:uppercase;
  color:#d9b26a;}
.lvr-panel label{display:block;margin:12px 0 4px;font-size:13px;color:#9a9a9a;
  letter-spacing:.06em;text-transform:uppercase;}
/* Memory is the thing that stops the work, so the line about what is held is
   the one line in the panel allowed to be loud. */
.lvr-panel p.vram{margin:13px 0 0;font-size:16.5px;font-weight:600;
  line-height:1.4;letter-spacing:.2px;}
.lvr-panel p.vram.held{color:#f0a860;}
.lvr-panel p.vram.idle{color:#7e9e86;}
/* a remark about the card, not a reading of it */
.lvr-panel p.vram.advice{font-size:13.5px;font-weight:400;color:#8a8a8a;
  letter-spacing:0;margin-top:8px;}
/* The tick sits on the same line as its own words, which is why this one is
   not the block label every other control has. Its text keeps sentence case:
   it is a sentence, not a field name. */
.lvr-panel label.chk{display:flex;align-items:center;gap:8px;cursor:pointer;
  margin:14px 0 2px;font-size:15px;color:#ccc;letter-spacing:0;
  text-transform:none;}
.lvr-panel label.chk input{width:18px;height:18px;flex:0 0 auto;margin:0;
  accent-color:#d9b26a;}
.lvr-panel select,.lvr-panel input{width:100%;box-sizing:border-box;background:#2b2b2b;
  border:1px solid #555;border-radius:4px;color:#ddd;font-size:16px;padding:7px 9px;}
.lvr-panel .foot{display:flex;gap:10px;margin-top:16px;}
/* Scoped to this panel rather than raised on .lvp-btn itself: the same chip is
   the node's own toolbar button, where the small size is right. */
.lvr-panel .foot button{flex:1 1 0;height:36px;font-size:14px;
  letter-spacing:.3px;padding:0 14px;}
.lvr-warn{color:#e6a0a0;font-size:13.5px;line-height:1.5;margin:6px 0 0;}
/* the English-side highlight: bars drawn over the text, never in it */
.lvp-hl{position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:0;}
.lvp-hl i{position:absolute;background:#3a6ea5;opacity:.34;border-radius:2px;}
/* The brush takes over the pointer while it is loaded, so the cursor has to
   say so - a text caret over text that is about to be restyled is a lie. The
   stock crosshair and copy cursors both read as "+", which says nothing about
   which tool is live, so the dropper is drawn as the cursor too. The hotspot
   sits on the dropper's tip, not the middle of the image. */
.lvp-ta.picking{cursor:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24'><g transform='scale(1.5)'><path d='M10.6 1.9a2.2 2.2 0 0 1 3.1 3.1l-1.4 1.4 .7 .7-1.1 1.1-.7-.7-4.6 4.6-2.9 .8 .8-2.9 4.6-4.6-.7-.7 1.1-1.1 .7 .7z' fill='none' stroke='%23111' stroke-width='1.8' stroke-linejoin='round'/><path d='M10.6 1.9a2.2 2.2 0 0 1 3.1 3.1l-1.4 1.4 .7 .7-1.1 1.1-.7-.7-4.6 4.6-2.9 .8 .8-2.9 4.6-4.6-.7-.7 1.1-1.1 .7 .7z' fill='%23b48aff'/></g></svg>") 3 21, crosshair;}
.lvp-ta.painting{cursor:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24'><g transform='scale(1.5)'><path d='M10.6 1.9a2.2 2.2 0 0 1 3.1 3.1l-1.4 1.4 .7 .7-1.1 1.1-.7-.7-4.6 4.6-2.9 .8 .8-2.9 4.6-4.6-.7-.7 1.1-1.1 .7 .7z' fill='none' stroke='%23111' stroke-width='1.8' stroke-linejoin='round'/><path d='M10.6 1.9a2.2 2.2 0 0 1 3.1 3.1l-1.4 1.4 .7 .7-1.1 1.1-.7-.7-4.6 4.6-2.9 .8 .8-2.9 4.6-4.6-.7-.7 1.1-1.1 .7 .7z' fill='%23d8b4fe'/><circle cx='3.2' cy='12.8' r='1.5' fill='%23ffffff' stroke='%23111' stroke-width='.8'/></g></svg>") 3 21, crosshair;}
/* inline-flex, because an inline svg hangs off the text baseline and left the
   glyph riding high in the button */
/* stretch, not a matching padding: the row centres its items, so only taking
   the full line height keeps the button exactly as tall as STYLE */
.lvp-btn.brush{--hue:#ffffff;--hue-soft:#ffffff1c;width:24px;padding:0;}
.lvp-btn.brush svg{display:block;width:13px;height:13px;}
/* armed and loaded are told apart by how full the dropper is, which the svg
   already draws, rather than by two shades of one colour */
.lvp-btn.brush.loaded{background:#ffffff2e;border-color:#fff;color:#fff;}
/* the loaded state fills the dropper, so pick and apply are not two identical
   purple buttons */
.lvp-btn.brush svg .drop{display:none;}
.lvp-btn.brush.loaded svg .drop{display:block;}
/* TR sits next to the bypass square and is built the same way, so the two
   read as a pair of switches rather than a switch and a label */
.lvp-trb{--hue:#7ec9a0;--hue-soft:#7ec9a024;font-size:8px;letter-spacing:0;}
.lvp-trb.no{opacity:.25;cursor:default;}
.lvp-trb.no:hover{border-color:var(--ctl-bd);color:var(--ctl-ink);}
.lvp-ta{position:absolute;inset:0;box-sizing:border-box;margin:0;border:none;z-index:1;
  padding:4px 6px;font-family:ui-monospace,Consolas,monospace;font-size:10px;
  line-height:1.45;white-space:pre-wrap;word-break:break-word;
  overflow-wrap:break-word;overflow-y:auto;overflow-x:hidden;color:#ddd;
  outline:none;}
/* translucent, not a flat grey - a solid colour here would paint over the
   section tint the moment the box took focus */
.lvp-ta:focus{background:rgba(255,255,255,.035);}
/* HUE unlit. Every mark is still there in the markup - this only refuses to
   draw it, so switching back finds the bold, colours and sizes exactly where
   they were left. Search hits are put back in below: hiding those would make
   the find bar useless while the effects are off. */
.lvp-ta.plain span,.lvp-ta.plain b{font-weight:400;font-style:normal;
  text-decoration:none;background:transparent;color:inherit;font-size:1em;
  letter-spacing:normal;box-shadow:none;border-radius:0;}
.lvp-ta.plain .m-para::before,.lvp-ta.plain .m-dot::before{content:"";}
.lvp-ta[contenteditable="false"]{opacity:.35;font-style:italic;}
/* see-through, and the text keeps its own colour, so a colour or a
   highlight just put on the selected run shows while it is still selected */
.lvp-ta::selection,.lvp-ta ::selection{background:rgba(110,160,235,.32);}
/* marks the user applies by hand */
.lvp-ta b,.lvp-ta .m-b{font-weight:700;}
.lvp-ta .m-i{font-style:italic;}
.lvp-ta .m-u{text-decoration:underline;text-underline-offset:2px;}
/* the dot is drawn, not typed, so it never reaches the prompt */
/* the small dot - a quieter bullet for a list inside a paragraph */
.lvp-ta .m-dot::before{content:"•  ";color:#8a8f98;font-weight:700;font-style:normal;text-decoration:none;}
.lvp-ta .m-para::before{content:"●  ";color:#8a8f98;font-weight:700;
  text-decoration:none;font-style:normal;}
.lvp-ta .m-key{font-weight:700;color:#ffcf70;}
.lvp-ta .m-hy{background:#6b5a12;color:#ffe9a3;border-radius:2px;}
.lvp-ta .m-hg{background:#1d4d33;color:#b8f0cf;border-radius:2px;}
.lvp-ta .m-hp{background:#4a2350;color:#f0c2f7;border-radius:2px;}
.lvp-ta .m-hb{background:#14395e;color:#bcdcff;border-radius:2px;}
.lvp-ta .m-hr{background:#5c1f24;color:#ffc9c9;border-radius:2px;}
.lvp-ta .m-ho{background:#5e3814;color:#ffd9b0;border-radius:2px;}
.lvp-ta .m-hn{background:#3a3a3a;color:#eeeeee;border-radius:2px;}
.lvp-ta .m-cy{color:#ffcf70;}
.lvp-ta .m-cg{color:#8fe0a8;}
.lvp-ta .m-cr{color:#ff9a9a;}
.lvp-ta .m-cw{color:#ffffff;}
.lvp-ta .m-cb{color:#7fb6ff;}
.lvp-ta .m-co{color:#ffad66;}
.lvp-ta .m-ck{color:#ff9fd2;}
.lvp-ta .m-cv{color:#c3a6ff;}
.lvp-ta .m-cc{color:#7fe3e0;}
.lvp-ta .m-cn{color:#9a9a9a;}
/* size is a mark on a run of characters, not a setting for the whole node:
   em, so a marked run stays in proportion wherever it is moved to */
.lvp-ta .m-z1{font-size:.72em;}
.lvp-ta .m-z2{font-size:.85em;}
.lvp-ta .m-z3{font-size:1.25em;}
.lvp-ta .m-z4{font-size:1.6em;}
.lvp-ta .m-z5{font-size:2.1em;}
.lvp-ta .m-z6{font-size:2.8em;}
/* the finer steps that sit between the old ones - the old six keep their
   sizes, so text marked before still looks exactly as it did */
.lvp-ta .m-za{font-size:.64em;}
.lvp-ta .m-zb{font-size:.78em;}
.lvp-ta .m-zc{font-size:.92em;}
.lvp-ta .m-zd{font-size:1.12em;}
.lvp-ta .m-ze{font-size:1.42em;}
.lvp-ta .m-zf{font-size:1.85em;}
.lvp-ta .m-zg{font-size:2.45em;}
/* fonts: only the ones a Windows or Mac machine already has - each list
   falls through to the next family when the first is missing */
/* five marks of earlier versions, no longer offered: text that still carries
   them is shown in a plain face of the same kind */
.lvp-ta .m-q1,.lvp-ta .m-q5,.lvp-ta .m-q6{font-family:"Segoe UI","Helvetica Neue",Helvetica,Arial,sans-serif;}
.lvp-ta .m-q2{font-family:Georgia,"Times New Roman",serif;}
.lvp-ta .m-q4{font-family:"Segoe Script","Brush Script MT",cursive;}
.lvp-ta .m-q10{font-family:"Segoe UI","Helvetica Neue",Helvetica,Arial,sans-serif;}
.lvp-ta .m-q9{font-family:Arial,Helvetica,sans-serif;}
.lvp-ta .m-q12{font-family:"Trebuchet MS","Lucida Grande",sans-serif;}
.lvp-ta .m-q7{font-family:Georgia,serif;}
.lvp-ta .m-q11{font-family:"Palatino Linotype",Palatino,"Book Antiqua",serif;}
.lvp-ta .m-q8{font-family:"Times New Roman",Times,serif;}
.lvp-ta .m-q3{font-family:Consolas,Menlo,"Courier New",monospace;}
.lvp-ta .m-q13{font-family:"Courier New",Courier,monospace;}
/* a heading line found by the automatic pass */
.lvp-ta .m-title{color:#9fd4ff;font-weight:700;letter-spacing:.6px;
  font-size:1.15em;}
/* the automatic pass uses the same mechanism */
.h-key{color:#ffcf70;font-weight:700;}
.h-lora{color:#c0a6ff;background:#2a2440;border-radius:2px;}
.h-weight{color:#7fd4ff;}
.h-bracket{color:#9aa0a6;}
.lvp-grip{height:6px;background:#232323;cursor:ns-resize;flex:0 0 auto;
  border-top:1px solid #2a2a2a;}
.lvp-grip:hover{background:#33506e;}
.lvp-foot{flex:0 0 auto;font-size:10px;padding:0 2px;display:flex;
  align-items:center;gap:6px;}
.lvp-foot-txt{opacity:.5;white-space:nowrap;flex:0 0 auto;}
.lvp-btn.help{width:18px;padding:0;font-size:10px;border-radius:9px;
  letter-spacing:0;}
.lvp-help{position:absolute;z-index:40;background:#161616;
  border:1px solid #5b7fa6;border-radius:6px;padding:12px 14px;width:470px;
  max-height:70vh;overflow-y:auto;box-shadow:0 6px 24px #000c;
  font-family:ui-monospace,Consolas,monospace;font-size:11px;line-height:1.65;
  color:#ddd;}
.lvp-help h3{margin:0 0 8px;font-size:14px;color:#fff;letter-spacing:.5px;}
.lvp-help h5{margin:12px 0 3px;font-size:11px;color:#ffd479;
  letter-spacing:.5px;text-transform:uppercase;}
.lvp-help p{margin:0 0 4px;opacity:.85;}
.lvp-help code{background:#0d0d0d;border:1px solid #333;border-radius:3px;
  padding:0 4px;color:#9fd3f0;}
.lvp-help .close{margin-top:12px;text-align:right;}
/* The style bar: one quiet row, every family of marks behind its own
   dropdown so the bar never grows past one line */
.lvp-mark{position:absolute;z-index:30;display:flex;align-items:center;gap:1px;padding:4px;
  background:#1b1c20;border:1px solid #393c44;border-radius:10px;
  box-shadow:0 10px 28px rgba(0,0,0,.55);font-family:system-ui,"Segoe UI",sans-serif;
  white-space:nowrap;user-select:none;}
.lvp-mark .mb{height:26px;min-width:26px;padding:0 6px;border-radius:7px;border:1px solid transparent;
  background:transparent;color:#d6d9e0;font-size:12px;line-height:1;cursor:pointer;display:inline-flex;
  align-items:center;justify-content:center;gap:5px;font-family:inherit;letter-spacing:0;}
.lvp-mark .mb:hover{background:#2b2e35;color:#fff;}
.lvp-mark .mb.on,.lvp-mark .mb.open{background:#2f3d52;border-color:#4f6f99;color:#fff;}
.lvp-mark.dock{position:relative;left:auto;top:auto;width:max-content;max-width:calc(100% - 36px);
  margin:2px 12px 6px 24px;box-shadow:none;background:#16171a;}
.lvp-mark .sep{width:1px;height:16px;background:#34373e;margin:0 4px;flex:0 0 auto;}
.lvp-mark .car{font-size:7px;opacity:.55;margin-left:1px;}
.lvp-mark .zv{width:44px;height:22px;text-align:center;font-size:11px;color:#b9bec7;font-variant-numeric:tabular-nums;
  background:#111215;border:1px solid #33363d;border-radius:6px;outline:none;padding:0 2px;font-family:inherit;}
.lvp-mark .zv:focus{border-color:#4f6f99;color:#fff;}
.lvp-mark .ic{display:inline-flex;align-items:center;color:#8e939d;margin:0 3px 0 6px;}
.lvp-mark .tk,.lvp-mark .ld{width:42px;height:22px;text-align:center;font-size:11px;color:#b9bec7;font-variant-numeric:tabular-nums;
  background:#111215;border:1px solid #33363d;border-radius:6px;outline:none;padding:0 2px;font-family:inherit;}
.lvp-mark .tk:focus,.lvp-mark .ld:focus{border-color:#4f6f99;color:#fff;}
.lvp-mark .mb.rst{color:#c9a0a0;}
.lvp-mark .mb.st{min-width:20px;padding:0 4px;font-size:13px;color:#9aa0aa;}
.lvp-mark .pan.para{width:252px;max-height:520px;overflow-y:auto;}
.lvp-mark .pan .prow.rl{gap:3px;}
.lvp-mark .pan .rw,.lvp-mark .pan .rc{min-width:24px;width:24px;height:22px;padding:0;}
.lvp-mark .pan .rw i{display:block;width:14px;background:#d6d9e0;border-radius:1px;}
.lvp-mark .pan .rs{min-width:30px;width:30px;height:22px;padding:0;}
.lvp-mark .pan .rs i{display:block;width:18px;height:1px;margin:0 auto;}
.lvp-mark .pan .rs i.ls-s{background:#d6d9e0;}
.lvp-mark .pan .rs i.ls-d{background:linear-gradient(90deg,#d6d9e0 0 4px,transparent 4px 6px) 0 0/6px 1px repeat-x;}
.lvp-mark .pan .rs i.ls-o{background:linear-gradient(90deg,#d6d9e0 0 1px,transparent 1px 3px) 0 0/3px 1px repeat-x;}
.lvp-mark .pan .rs i.ls-w{height:3px;background:linear-gradient(#d6d9e0 0 1px,transparent 1px 2px,#d6d9e0 2px);}
.lvp-mark .pan .rc i{display:block;width:12px;height:12px;border-radius:3px;border:1px solid #ffffff33;}
.lvp-mark .pan.sty{width:262px;max-height:380px;overflow-y:auto;}
.lvp-mark .pan .psk{width:44px;flex:0 0 auto;height:24px;text-align:center;border-radius:6px;background:#111215;
  border:1px solid #33363d;color:#e6e8ec;font-size:12px;outline:none;font-family:inherit;}
.lvp-mark .pan .psk:focus{border-color:#4f6f99;}
.lvp-mark .pan .pss .ap{flex:1;}
.lvp-mark .pan .fv2 .it small{margin-right:16px;}
.lsb-gmbody.lvp-ta.picking,.lsb-gmbody.lvp-ta.picking[contenteditable="true"],.lsb-gmbody.lvp-ta.picking *{
  cursor:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 16 16'><path fill='white' stroke='black' stroke-width='.8' d='M13.4 2.6a2 2 0 0 0-2.8 0L8.9 4.3 8.2 3.6 7.1 4.7l.7.7-5 5a1 1 0 0 0-.3.6l-.3 2.2 2.2-.3a1 1 0 0 0 .6-.3l5-5 .7.7 1.1-1.1-.7-.7 1.7-1.7a2 2 0 0 0 0-2.8z'/></svg>") 1 18, crosshair;}
.lsb-gmbody.lvp-ta.painting,.lsb-gmbody.lvp-ta.painting[contenteditable="true"],.lsb-gmbody.lvp-ta.painting *{
  cursor:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 16 16'><path fill='%23ffcf70' stroke='black' stroke-width='.8' d='M13.4 2.6a2 2 0 0 0-2.8 0L8.9 4.3 8.2 3.6 7.1 4.7l.7.7-5 5a1 1 0 0 0-.3.6l-.3 2.2 2.2-.3a1 1 0 0 0 .6-.3l5-5 .7.7 1.1-1.1-.7-.7 1.7-1.7a2 2 0 0 0 0-2.8z'/></svg>") 1 18, copy;}
/* while the eyedropper is loaded the notes wear a thin gold frame too */
.lsb-gmbody.lvp-ta.picking[contenteditable="true"],.lsb-gmbody.lvp-ta.painting[contenteditable="true"]{
  border-color:#e8c76a;box-shadow:0 0 0 1px #e8c76a55;}
.lvp-mark .pan .hint .kb{color:#ffcf70;font-weight:700;}
.lvp-mark .pan .hint+.hint{padding-top:0;}
.lvp-mark .pan .row.al{gap:2px;margin-bottom:6px;}
.lvp-mark .pan .prow{display:flex;align-items:center;gap:2px;margin:3px 0;}
.lvp-mark .pan .prow>span{flex:1;font-size:11px;color:#b9bec7;padding-left:2px;}
.lvp-mark .pan .pvi{width:46px;height:22px;text-align:center;font-size:11px;color:#b9bec7;font-variant-numeric:tabular-nums;
  background:#111215;border:1px solid #33363d;border-radius:6px;outline:none;padding:0 2px;font-family:inherit;}
.lvp-mark .pan .pvi:focus{border-color:#4f6f99;color:#fff;}
.lvp-mark .pan .pss{display:flex;gap:6px;margin:6px 0 4px;}
.lvp-mark .pan .psn{flex:1;min-width:0;height:24px;padding:0 8px;border-radius:6px;background:#111215;
  border:1px solid #33363d;color:#e6e8ec;font-size:12px;outline:none;font-family:inherit;}
.lvp-mark .pan .psn:focus{border-color:#4f6f99;}
.lvp-mark .pan .pss .ap{height:24px;padding:0 10px;border-radius:6px;border:1px solid #4f6f99;background:#2f3d52;color:#fff;font-size:11px;cursor:pointer;}
.lvp-mark .pan .pdel{position:absolute;right:8px;width:14px;height:14px;border-radius:50%;background:#3a3d45;
  color:#fff;font-size:10px;line-height:13px;text-align:center;cursor:pointer;display:none;font-weight:400;}
.lvp-mark .pan .fv2:hover .pdel{display:block;}
.lvp-mark .pan .pdel:hover{background:#c0505a;}
.lvp-mark .mb.st:hover{color:#fff;}
.lvp-hold{position:absolute;left:0;top:0;width:0;height:0;overflow:visible;pointer-events:none;z-index:29;}
.lvp-hold i{position:absolute;background:rgba(110,160,235,.32);border-radius:2px;}
.lvp-mark .mb.rst:hover{color:#ffb0b0;}
.lvp-mark .fl{max-width:150px;overflow:hidden;text-overflow:ellipsis;font-size:12px;}
.lvp-mark .hs{width:14px;height:14px;border-radius:4px;border:1px solid #ffffff33;}
.lvp-mark .ca{font-weight:700;font-size:13px;padding-bottom:2px;border-bottom:3px solid #d6d9e0;line-height:11px;}
.lvp-mark .pan{position:absolute;left:0;top:calc(100% + 6px);z-index:31;display:none;
  background:#1b1c20;border:1px solid #393c44;border-radius:10px;padding:6px;
  box-shadow:0 10px 28px rgba(0,0,0,.55);}
.lvp-mark .pan.up{top:auto;bottom:calc(100% + 6px);}
.lvp-mark .pan.show{display:block;}
.lvp-mark .pan .row{display:flex;gap:5px;flex-wrap:wrap;}
.lvp-mark .pan .lbl{font-size:9px;letter-spacing:.8px;text-transform:uppercase;color:#7d828c;margin:2px 2px 6px;}
.lvp-mark .pan .it{display:flex;align-items:center;gap:8px;width:100%;height:28px;padding:0 10px;
  border:0;border-radius:6px;background:transparent;color:#d6d9e0;font-size:13px;cursor:pointer;text-align:left;}
.lvp-mark .pan .it:hover{background:#2b2e35;color:#fff;}
.lvp-mark .pan .it.on{background:#2f3d52;color:#fff;}
.lvp-mark .pan .it small{margin-left:auto;font-size:10px;color:#7d828c;font-family:system-ui,sans-serif;}
.lvp-mark .pan.fonts{width:250px;max-height:360px;overflow-y:auto;overflow-x:hidden;}
.lvp-mark .pan.fonts .it{min-width:0;}
.lvp-mark .pan.fonts .it .nm,.lvp-mark .pan.fonts .fv2 .it{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.lvp-mark .pan.fonts .it .nm{flex:1;min-width:0;}
.lvp-mark .pan.fonts .it small{flex:0 0 auto;}
.lvp-mark .pan .hint{font-size:10px;color:#7d828c;padding:4px 10px 6px;white-space:normal;line-height:1.4;}
.lvp-mark .pan .fq{width:100%;box-sizing:border-box;height:26px;margin:0 0 4px;padding:0 9px;border-radius:6px;
  background:#111215;border:1px solid #33363d;color:#e6e8ec;font-size:12px;outline:none;font-family:inherit;}
.lvp-mark .pan .fq:focus{border-color:#4f6f99;}
.lvp-mark .pan .it.ldf{color:#9ec3ff;font-size:12px;}
.lvp-mark .pan .faces{margin:0 0 4px 12px;border-left:1px solid #34373e;padding-left:4px;}
.lvp-mark .pan .fc,.lvp-mark .pan .fv2{position:relative;display:flex;align-items:center;}
.lvp-mark .pan .fc .it{padding-right:28px;}
.lvp-mark .pan .star{position:absolute;right:6px;font-size:12px;color:#5b5f68;cursor:pointer;font-weight:400;}
.lvp-mark .pan .star:hover{color:#e8c76a;}
.lvp-mark .pan .star.on{color:#e8c76a;}
.lvp-mark .pan .fv2 .it{padding-right:26px;}
.lvp-mark .pan .fdel{position:absolute;right:8px;width:14px;height:14px;border-radius:50%;background:#3a3d45;
  color:#fff;font-size:10px;line-height:13px;text-align:center;cursor:pointer;display:none;font-weight:400;}
.lvp-mark .pan .fv2:hover .fdel{display:block;}
.lvp-mark .pan .fdel:hover{background:#c0505a;}
.lvp-mark .sw{width:22px;height:22px;border-radius:6px;border:1px solid #ffffff22;cursor:pointer;padding:0;
  display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;background:#26282d;}
.lvp-mark .sw:hover{transform:scale(1.08);border-color:#ffffff66;}
.lvp-mark .sw.on{outline:2px solid #fff;outline-offset:1px;}
.lvp-mark .sw.none{color:#8e939d;font-weight:400;}
.lvp-mark .pan.cols{width:238px;}
.lvp-mark .rgb{margin-top:8px;padding-top:8px;border-top:1px solid #303339;}
.lvp-mark .ch{display:flex;align-items:center;gap:8px;margin:5px 0;}
.lvp-mark .ch b{width:10px;font-size:10px;color:#8e939d;font-weight:600;}
.lvp-mark .ch .tr{position:relative;flex:1;height:10px;border-radius:5px;cursor:pointer;border:1px solid #ffffff1a;}
.lvp-mark .ch .kn{position:absolute;top:50%;width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:50%;
  background:#fff;box-shadow:0 0 0 1px #0008,0 1px 3px #000a;pointer-events:none;}
.lvp-mark .ch .cv{width:34px;height:20px;text-align:center;font-size:10px;color:#b9bec7;font-variant-numeric:tabular-nums;
  background:#111215;border:1px solid #33363d;border-radius:5px;outline:none;padding:0;font-family:inherit;}
.lvp-mark .ch .cv:focus{border-color:#4f6f99;color:#fff;}
.lvp-mark .rgbf .eye{height:24px;width:26px;flex:0 0 auto;border-radius:6px;border:1px solid #4a4d55;background:transparent;
  color:#d6d9e0;cursor:pointer;padding:0;display:inline-flex;align-items:center;justify-content:center;}
.lvp-mark .rgbf .eye:hover{background:#2b2e35;border-color:#7ab8ff;color:#fff;}
.lvp-mark .rgbf .eye:disabled{opacity:.35;cursor:default;}
.lvp-mark .rgbf{display:flex;align-items:center;gap:6px;margin-top:8px;}
.lvp-mark .rgbf .pv{width:26px;height:24px;flex:0 0 auto;border-radius:6px;border:1px solid #ffffff33;}
.lvp-mark .rgbf .hx{flex:1;min-width:0;height:24px;font:11px ui-monospace,Consolas,monospace;color:#d6d9e0;
  background:#111215;border:1px solid #33363d;border-radius:6px;outline:none;padding:0 7px;}
.lvp-mark .rgbf .hx:focus{border-color:#4f6f99;color:#fff;}
.lvp-mark .rgbf .fav{height:24px;width:26px;border-radius:6px;border:1px solid #4a4d55;background:transparent;
  color:#e8c76a;font-size:13px;cursor:pointer;padding:0;}
.lvp-mark .rgbf .fav:hover{background:#2b2e35;border-color:#e8c76a;}
.lvp-mark .favs{display:contents;}
.lvp-mark .fv{position:relative;display:inline-flex;}
.lvp-mark .fv .del{position:absolute;top:-5px;right:-5px;width:13px;height:13px;border-radius:50%;
  background:#3a3d45;color:#fff;font-size:10px;line-height:12px;text-align:center;cursor:pointer;display:none;
  box-shadow:0 0 0 1px #1b1c20;}
.lvp-mark .fv:hover .del{display:block;}
.lvp-mark .fv .del:hover{background:#c0505a;}
.lvp-mark .rgbf .ap{height:24px;padding:0 10px;border-radius:6px;border:1px solid #4f6f99;background:#2f3d52;
  color:#fff;font-size:11px;cursor:pointer;}
.lvp-mark .rgbf .ap:hover{background:#3a4d68;}
.lvp-fr-marks .br{flex-basis:100%;height:0;}
.lvp-fr{flex:0 0 auto;display:flex;flex-direction:column;gap:4px;
  background:#1b1b1b;border:1px solid #5a5a5a;border-radius:5px;padding:5px;}
.lvp-fr-row{display:flex;gap:4px;align-items:center;}
.lvp-fr-lab{font-size:8px;letter-spacing:.6px;opacity:.45;width:28px;
  flex:0 0 auto;text-align:right;}
.lvp-fr input[type=text]{flex:1 1 auto;min-width:60px;background:#0d0d0d;
  border:1px solid #444;border-radius:4px;color:#ddd;font-size:11px;padding:3px 6px;}
.lvp-fr select{background:#0d0d0d;border:1px solid #444;border-radius:4px;
  color:#ddd;font-size:11.5px;padding:2px 3px;max-width:132px;}
/* The count now sits between the field and the buttons, so it is given a
   floor width - otherwise every keystroke that changes "11 found" to "none"
   would slide the whole button row sideways. */
.lvp-fr .hits{font-size:10px;opacity:.6;padding:0 2px;white-space:nowrap;
  min-width:52px;text-align:center;flex:0 0 auto;}
.lvp-panel{position:absolute;inset:0;background:#151515;border:1px solid #666;
  border-radius:6px;z-index:20;display:flex;flex-direction:column;gap:5px;padding:7px;
  font-size:11px;}
.lvp-panel h5{margin:0;font-size:11px;opacity:.75;letter-spacing:.4px;
  display:flex;align-items:center;}
.lvp-cap{margin-left:auto;font-size:9px;opacity:.4;letter-spacing:.5px;
  padding-right:8px;}
.lvp-cap.near{opacity:.9;color:#ffb0b0;}
.lvp-x{cursor:pointer;font-size:12px;font-weight:700;opacity:.55;
  padding:0 4px;border-radius:3px;line-height:1;}
.lvp-x:hover{opacity:1;color:#f88;background:#2f2f2f;}
.lvp-row{display:flex;gap:4px;align-items:center;}
.lvp-row input[type=text]{flex:1;min-width:0;background:#0d0d0d;border:1px solid #444;
  border-radius:4px;color:#ddd;font-size:11px;padding:3px 6px;}
.lvp-scroll{flex:1;overflow-y:auto;border:1px solid #333;border-radius:4px;
  background:#101010;padding:3px;display:flex;flex-direction:column;gap:2px;}
.lvp-hit{padding:3px 5px;border-radius:3px;font-family:ui-monospace,monospace;
  font-size:10px;line-height:1.4;}
.lvp-hit b{color:#ffd479;font-weight:600;}
.lvp-hit .src{opacity:.45;}
.lvp-snap{display:flex;align-items:center;gap:5px;padding:3px 5px;border-radius:3px;
  cursor:pointer;font-family:ui-monospace,monospace;font-size:10px;}
.lvp-snap:hover{background:#243040;}
.lvp-snap .del{margin-left:auto;opacity:.4;padding:0 3px;}
.lvp-snap .del:hover{opacity:1;color:#f88;}
.lvp-snap .del.armed{opacity:1;color:#fff;background:#8a2b2b;border-radius:3px;
  padding:1px 5px;font-size:9px;letter-spacing:.4px;}
/* Search hits, declared last on purpose. These rules carry no more weight
   than the highlight and colour rules above, so whichever comes last in the
   sheet wins - and a hit that lands inside text the user has just coloured
   has to stay visible, or styling the hits appears to erase them. */
.lvp-ta .m-find{background:#c8a020;color:#1a1a1a;border-radius:2px;
  box-shadow:0 0 0 1px #ffdf7a;}
.lvp-ta .m-find[data-cur]{background:#ffd45a;color:#1a1a1a;
  box-shadow:0 0 0 2px #fff2b0;}
.lvp-ta.plain .m-find{background:#c8a020;color:#1a1a1a;border-radius:2px;
  box-shadow:0 0 0 1px #ffdf7a;}
.lvp-ta.plain .m-find[data-cur]{background:#ffd45a;box-shadow:0 0 0 2px #fff2b0;}
/* find and replace bar */
.lvp-fr .lvp-btn.fnd{background:#2a3a4a;border-color:#5f88b0;color:#cfe4ff;
  font-weight:600;letter-spacing:.3px;}
.lvp-fr .lvp-btn.fnd:hover{background:#365068;color:#fff;}
.lvp-fr .lvp-btn.go{background:#2f6a4a;border-color:#5fc08e;color:#eaffef;
  font-weight:600;letter-spacing:.3px;}
.lvp-fr .lvp-btn.go:hover{background:#3c8560;color:#fff;}
.lvp-fr .lvp-btn.undo{background:#4a3320;border-color:#b08a4a;color:#ffd9a3;}
.lvp-fr .lvp-btn.step{padding:3px 7px;font-weight:700;}
.lvp-fr-marks{display:flex;gap:2px;align-items:center;flex-wrap:wrap;}
.lvp-fr-marks button{width:20px;height:20px;border-radius:3px;
  border:1px solid #555;background:#2b2b2b;color:#ddd;cursor:pointer;
  font-size:10px;line-height:1;padding:0;font-family:inherit;
  font-weight:600;letter-spacing:0;}
.lvp-fr-marks button:hover{border-color:#7ab8ff;color:#fff;}
.lvp-fr-marks .sep{width:1px;height:12px;background:#4a4a4a;margin:0 3px;}
/* ---------- the Series Book ---------- */
.lvp-msg{margin-left:10px;color:#9fd3a8;opacity:.9;white-space:nowrap;overflow:hidden;
  text-overflow:ellipsis;min-width:0;flex:0 1 auto;}
.lvp-msg.err{color:#e8a0a0;}
.lvp-pastebox{display:flex;gap:4px;align-items:stretch;flex:0 0 auto;}
.lvp-pastebox textarea{flex:1;height:44px;resize:none;background:#141414;color:#ddd;
  border:1px dashed #d9b26a;border-radius:4px;font:11px system-ui,sans-serif;padding:4px 6px;}
/* Dressed like the Node Bag: a near-black body, a gold name, and the prompts
   held in one rounded box edged in the book's own colour. The colours are a
   step darker than any section colour, so the book never reads as one more
   anchor. --bk is the colour, --bl how much of it shows through (the
   brightness slider). */
.lsb-book{flex:0 0 auto;display:flex;flex-direction:column;gap:5px;
  --bk:#2f6f73;--bl:.22;
  border:1px solid color-mix(in srgb, var(--bk) 45%, #1a1a1a);border-radius:7px;
  background:color-mix(in srgb, var(--bk) calc(var(--bl) * 40%), #08090b);
  padding:7px 9px 8px;}
.lsb-head{display:flex;align-items:center;gap:5px;min-height:18px;flex-wrap:wrap;row-gap:5px;}
.lsb-lab{font-size:10px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;
  color:#bdbdbd;}
.lsb-book .lsb-lab{color:#e0b85a;}
.lsb-tog{cursor:pointer;user-select:none;}
.lsb-tog:hover{color:#f3d48a !important;}
.lsb-count{font-size:9.5px;color:#7d7d7d;margin-right:4px;}
.lsb-found{font-size:10px;color:#e8d27a;margin-left:6px;}
.lsb-dot{width:10px;height:10px;border-radius:50%;background:var(--bk);cursor:pointer;
  flex:0 0 auto;box-shadow:0 0 0 1px #000, 0 0 0 2px color-mix(in srgb, var(--bk) 60%, #888);}
.lsb-dot:hover{filter:brightness(1.4);}
.lsb-light{-webkit-appearance:none;appearance:none;width:64px;height:12px;background:transparent;
  cursor:pointer;margin:0 4px;flex:0 0 auto;}
.lsb-light::-webkit-slider-runnable-track{height:2px;border-radius:1px;
  background:linear-gradient(90deg, #6c8fd6 var(--pct,22%), #3a3a3a var(--pct,22%));}
.lsb-light::-webkit-slider-thumb{-webkit-appearance:none;width:9px;height:9px;border-radius:50%;
  background:#6c8fd6;margin-top:-3.5px;border:none;}
.lsb-light::-moz-range-track{height:2px;background:#3a3a3a;}
.lsb-light::-moz-range-progress{height:2px;background:#6c8fd6;}
.lsb-light::-moz-range-thumb{width:9px;height:9px;border-radius:50%;background:#6c8fd6;border:none;}
/* the prompts are what a series is made of - given room to read as such */
.lsb-pbox{margin:9px 0 6px;border:2px solid color-mix(in srgb, var(--bk) 85%, #000);
  border-radius:12px;padding:10px 10px;
  background:color-mix(in srgb, var(--bk) calc(var(--bl) * 55% + 6%), #07080a);}
.lsb-prompts{display:flex;flex-wrap:wrap;gap:8px 7px;}
.lsb-p{display:inline-flex;align-items:center;gap:8px;font-size:11.5px;line-height:1;
  padding:7px 14px 7px 13px;border-radius:999px;cursor:pointer;
  background:#20232b;border:1px solid #2c303a;color:#d2d4da;white-space:nowrap;user-select:none;
  max-width:340px;overflow:hidden;text-overflow:ellipsis;}
.lsb-p .no{font-weight:700;font-size:10px;color:#7f8590;margin-right:-1px;
  font-variant-numeric:tabular-nums;letter-spacing:.3px;}
/* the prompts not open: a soft wash of the book's own colour rather than
   grey, which read as locked or unavailable */
.lsb-book .lsb-p{background:color-mix(in srgb, var(--bk) 42%, #1d2026);
  border-color:color-mix(in srgb, var(--bk) 70%, #3a3e46);color:#e6e8ec;}
.lsb-book .lsb-p .no{color:color-mix(in srgb, var(--bk) 45%, #c4c8cf);}
.lsb-book .lsb-p.on .no{color:#c9a453;}
.lsb-book .lsb-p:hover{border-color:#d9b26a;color:#f0d9a8;}
.lsb-book .lsb-p.on{background:#2c2618;border-color:#d9b26a;color:#f3dcaa;font-weight:600;}
.lsb-book .lsb-c{background:#111317;}
/* the Node Bag's buttons: dark pills, small spaced capitals, gold on hover */
.lsb-btn{height:20px;box-sizing:border-box;padding:0 11px;border-radius:999px;cursor:pointer;
  background:#14161a;border:1px solid #3a3e46;color:#aeb3bc;font-family:inherit;
  font-size:9px;font-weight:700;letter-spacing:.7px;text-transform:uppercase;line-height:1;
  display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;
  transition:color .1s linear,border-color .1s linear,background-color .1s linear;}
.lsb-btn:hover{border-color:#d9b26a;color:#f0d9a8;background:#1c1912;}
.lsb-btn:active{background:#2a2416;}
/* The toolbar wears the Node Bag's buttons - dark pills, small spaced
   capitals, gold on hover - in the Composer and the Book alike, so the whole
   suite has one kind of button. */
.lvp-wrap .lvp-bar .lvp-btn{height:20px;padding:0 8px;border-radius:999px;
  background:#14161a;border:1px solid #3a3e46;color:#aeb3bc;
  font-size:9px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;}
.lvp-wrap .lvp-bar .lvp-btn:hover{border-color:#d9b26a;color:#f0d9a8;background:#1c1912;}
.lvp-wrap .lvp-bar .lvp-btn.on{border-color:#d9b26a;color:#f3dcaa;background:#2a2416;}
.lvp-wrap .lvp-bar .lvp-btn.loaded{border-color:#d9b26a;color:#f3dcaa;}
.lvp-wrap .lvp-bar .lvp-btn:disabled,
.lvp-wrap .lvp-bar .lvp-btn:disabled:hover{color:#4a4d54;border-color:#2a2c31;background:#121317;}
.lvp-wrap .lvp-bar .lvp-btn.brush{padding:0 8px;}
.lvp-wrap .lvp-bar .lvp-sep{background:#4a4636;}
.lsb-prev,.lsb-next{width:22px;padding:0;font-size:12px;letter-spacing:0;}
.lsb-book .lvp-sep{background:#33363d;}
.lsb-p.drop,.lsb-c.drop{outline:2px dashed #d9b26a;outline-offset:1px;}
.lsb-shelf{display:flex;flex-direction:column;gap:0;max-height:none;padding-bottom:4px;}
/* The capsules sit in a panel of their own under the prompts: neutral, not
   in the book's colour, and inset like a drawer - the store the prompts are
   built from, not one more thing of the same rank. It folds to its header. */
.lsb-capbox{margin-top:6px;border:1px solid #2a2d34;border-radius:10px;
  background:linear-gradient(#0d0e11,#0b0c0e);box-shadow:inset 0 2px 6px #0008;
  padding:6px 10px 4px;}
.lsb-capbox.shut{padding-bottom:6px;background:#0d0e11;}
/* The drawer: under the capsules, the same inset panel but warmer, and its
   contents are cards - a picture first, then the name - since it is meant to
   be chosen from by eye. */
.lsb-drawer{margin-top:8px;border:1px solid var(--dbd,#4d3d24);border-radius:10px;
  background:var(--dbg,#19140d);box-shadow:0 0 0 1px #00000040;
  padding:6px 10px 8px;
  /* painted as one piece, so a change of card size repaints all of it */
  isolation:isolate;contain:paint;}
.lsb-dtone{width:12px;height:12px;border-radius:50%;cursor:pointer;flex:0 0 auto;background:var(--dbg);
  box-shadow:0 0 0 1px var(--dbd),0 0 0 3px #00000060;margin:0 4px 0 2px;}
.lsb-dtone:hover{box-shadow:0 0 0 1px #e0b85a,0 0 0 3px #00000060;}
.lsb-dtags .sp{flex:1;}
.lsb-dsz{display:inline-flex;align-items:center;gap:6px;flex:0 0 auto;margin-left:auto;}
.lsb-dnow .lsb-dsz{margin-left:12px;}
.lsb-dsz i{display:block;border:1.5px solid #8a7652;border-radius:2px;}
.lsb-dsz i.s{width:7px;height:9px;}
.lsb-dsz i.l{width:11px;height:14px;}
.lsb-dsz .lsb-light{width:80px;}
.lsb-drawer.shut{padding-bottom:6px;}
.lsb-drawer.drop{border-color:#e0b85a;box-shadow:inset 0 0 0 1px #e0b85a66;}
.lsb-drhead{cursor:pointer;padding:1px 0 6px;flex-wrap:wrap;row-gap:4px;}
.lsb-drawer.shut .lsb-drhead{padding-bottom:1px;}
.lsb-book .lsb-drhead .lsb-lab{color:#e3c58a;}
.lsb-drhead:hover .lsb-lab{color:#e0b85a;}
.lsb-drhead .tw{display:inline-block;font-style:normal;font-size:19px;line-height:1;width:20px;
  text-align:center;margin-right:5px;vertical-align:-3px;color:#a9aeb7;transition:transform .12s;}
.lsb-drawer.shut .lsb-drhead .tw{transform:rotate(-90deg);}
.lsb-dks{display:inline-flex;flex-wrap:wrap;gap:3px;}
.lsb-dk{font-size:9px;font-weight:700;letter-spacing:.4px;padding:2px 7px;border-radius:999px;cursor:pointer;
  user-select:none;border:1px solid #5a4a30;color:var(--k,#e3c58a);background:#16110b;text-transform:uppercase;}
.lsb-dk i{font-style:normal;opacity:.55;margin-left:4px;font-weight:400;}
.lsb-dk:hover{border-color:var(--k,#a7adb6);}
.lsb-dk.now{--k:#f3e2b8;color:#f3e2b8;border-color:#8a7148;background:#211a10;}
.lsb-dk.now.on{background:linear-gradient(180deg,#e9c46e,#cf9f45);border-color:#e9c46e;color:#2a1d08;}
.lsb-dk.now.on i{opacity:.7;}
.lsb-dsep{width:1px;align-self:stretch;margin:2px 3px;background:#5a4a30;}
.lsb-dnow{display:flex;align-items:center;gap:8px;padding:6px 2px 2px;border-top:1px solid #ffffff14;
  font-size:11px;color:#f1e6cf;}
.lsb-dnow b{color:#e0b85a;font-weight:700;}
.lsb-dnow span{color:#9c8b6c;font-size:10px;margin-left:auto;}
.lsb-dk.on{border-color:var(--k,#e0b85a);background:color-mix(in srgb, var(--k,#e0b85a) 18%, #16110b);color:#fff;}
.lsb-dq{width:110px;font-size:10px;padding:2px 8px;border-radius:999px;border:1px solid #5a4a30;
  background:#16110b;color:#ddd;outline:none;}
.lsb-dq:focus{border-color:#e0b85a;}
/* the drawer's folders: a row above the tags */
.lsb-dfs{display:flex;flex-wrap:wrap;align-items:center;gap:5px;padding:7px 0 6px;border-top:1px solid #ffffff14;}
/* the path: Drawer > folder */
.lsb-dcr{display:inline-flex;align-items:center;gap:5px;font-size:11px;padding:3px 8px;border-radius:6px;
  cursor:pointer;user-select:none;color:#d8d0bf;border:1px solid transparent;}
.lsb-dcr svg{fill:#c9a453;}
.lsb-dcr:hover{border-color:#e0b85a66;}
.lsb-dcr.on{color:#fff;font-weight:600;}
.lsb-dcr.cur{cursor:context-menu;}
.lsb-dcr.drop{outline:2px dashed #e0b85a;outline-offset:1px;}
.lsb-dcs{opacity:.5;font-size:13px;}
.lsb-dfs .sp{flex:1;}
.lsb-dsel{display:inline-flex;align-items:center;gap:6px;font-size:10.5px;color:#a9cbff;}
/* a folder in the grid, sized like a card */
.lsb-dfold{position:relative;display:flex;flex-direction:column;border-radius:10px;cursor:pointer;aspect-ratio:3/4;min-width:0;
  box-sizing:border-box;padding:9px 10px 0;overflow:hidden;user-select:none;
  background:color-mix(in srgb,var(--k) 15%,#0f1013);box-shadow:0 0 0 1px color-mix(in srgb,var(--k) 28%,transparent);}
.lsb-dfold:hover{background:color-mix(in srgb,var(--k) 20%,#0f1013);box-shadow:0 0 0 1px color-mix(in srgb,var(--k) 50%,transparent);}
.lsb-dfold .fkl{display:flex;align-items:center;gap:4px;font-size:8.5px;font-weight:700;letter-spacing:.9px;
  text-transform:uppercase;color:var(--k);}
.lsb-dfold .fkl svg{width:11px;height:11px;fill:var(--k);flex:0 0 auto;}
.lsb-dfold.menu{box-shadow:0 0 0 2px #e0b85a88;}
.lsb-dfold.drop{outline:3px dashed #e0b85a;outline-offset:-3px;background:#3a311c;}
.lsb-dfold .fic{position:relative;flex:1;display:flex;align-items:center;justify-content:center;padding:4px 2px;}
.lsb-dfold .fic svg{width:70%;max-width:120px;fill:#c9a453;opacity:.9;}
.lsb-dfold .pv{position:absolute;left:24%;right:24%;top:34%;bottom:20%;display:grid;gap:2px;grid-template-columns:1fr 1fr;
  grid-auto-rows:1fr;border-radius:4px;overflow:hidden;}
.lsb-dfold .pv.n1{grid-template-columns:1fr;}
.lsb-dfold .pv img{width:100%;height:100%;object-fit:cover;display:block;}
.lsb-dfold .cap{padding:4px 0 9px;}
.lsb-dfold .nm{font-size:12px;font-weight:700;color:#f1ece3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.lsb-dfold .tg{font-size:9.5px;opacity:.6;}
.lsb-dc.sel{outline:3px solid #5b9bff;outline-offset:-1px;}
.lsb-dc .ck{position:absolute;top:6px;left:6px;z-index:3;width:18px;height:18px;box-sizing:border-box;border-radius:5px;
  display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:transparent;
  background:#0009;border:1.5px solid #ffffffaa;opacity:0;cursor:pointer;transition:opacity .12s;}
.lsb-dc:hover .ck{opacity:.8;}
.lsb-dc .ck:hover{opacity:1;border-color:#9ec3ff;}
.lsb-drawer.picking .lsb-dc .ck{opacity:.85;}
.lsb-dc.sel .ck{opacity:1;background:#3d7fe6;border-color:#a9cbff;color:#fff;}
.lsb-dc .ck~.lv{left:28px;}
.lsb-dmarq{position:fixed;z-index:10000;pointer-events:none;border:1px solid #7fb0ff;background:rgba(91,155,255,.16);}
.lsb-dmarq.sub{border-color:#e07a6a;background:rgba(224,122,106,.14);}
.lsb-df.add.off{opacity:.4;}
.lsb-dfold .fic svg{fill:var(--k,#c9a453);}
.lsb-df{display:inline-flex;align-items:center;gap:5px;font-size:10.5px;padding:3px 9px 3px 7px;border-radius:6px;
  cursor:pointer;user-select:none;border:1px solid #ffffff24;background:#ffffff08;color:#d8d0bf;}
.lsb-df svg{fill:#c9a453;opacity:.85;flex:0 0 auto;}
.lsb-df i{font-style:normal;font-size:9px;opacity:.55;}
.lsb-df:hover{border-color:#e0b85a99;}
.lsb-df.on{border-color:#e0b85a;background:#3a311c;color:#fff;}
.lsb-df.on svg{fill:#f3d48f;opacity:1;}
.lsb-df.all{padding-left:9px;}
.lsb-df.none svg{fill:#8a8f98;}
.lsb-df.add{border-style:dashed;opacity:.75;padding-left:9px;}
.lsb-df.menu{box-shadow:0 0 0 1px #e0b85a66;}
.lsb-df.drop{outline:2px dashed #e0b85a;outline-offset:1px;}
.lsb-dfin{font-size:10.5px;padding:3px 9px;border-radius:6px;border:1px solid #e0b85a;background:#1a1712;
  color:#f3dcaa;width:130px;outline:none;}
.lsb-dfm{display:flex;align-items:center;gap:6px;padding:4px 8px 6px;margin-bottom:4px;border-radius:6px;
  background:#2a2416;border:1px solid #e0b85a55;font-size:10.5px;color:#d8d0bf;}
.lsb-dfm b{color:#f3d48f;}
.lsb-dfm .lsb-dfin{width:170px;}
.lsb-dfb{cursor:pointer;padding:2px 8px;border-radius:5px;border:1px solid #ffffff24;}
.lsb-dfb.del{margin-left:auto;color:#efb0b0;border-color:#c85f5f66;}
.lsb-dfb.del.armed{background:#c85f5f;color:#fff;}
.lsb-dfb.cls{opacity:.7;}
.lsb-dtags{display:flex;flex-wrap:wrap;align-items:center;gap:4px;padding:2px 0 6px;}
.lsb-dt{font-size:10px;padding:2px 8px;border-radius:999px;cursor:pointer;user-select:none;
  border:1px solid #6a5634;color:#e0cfa8;background:#1a140c;}
.lsb-dt:hover{border-color:#e0b85a;}
.lsb-dt.on{border-color:#e0b85a;background:#3a311c;color:#fff;}
.lsb-dt.none{opacity:.35;}
.lsb-dt.clr{border-style:dashed;opacity:.7;}
.lsb-dtin{font-size:10px;padding:2px 8px;border-radius:999px;border:1px solid #e0b85a;background:#1a1712;
  color:#f3dcaa;width:110px;outline:none;}
.lsb-dt.drop{outline:2px dashed #e0b85a;outline-offset:1px;opacity:1;}
.lsb-dgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(var(--dsz,100px),1fr));gap:10px;
  padding:6px 2px 4px;max-height:var(--dgh,calc(var(--dsz,100px) * 4.4));overflow-y:auto;}
/* A card is its picture: the image runs to the edges, the name sits on a
   shade across its foot, and the kind is a single coloured dot. A card with
   no picture yet wears a wash of its kind's colour in the same frame, so the
   grid stays even. */
.lsb-dc{position:relative;display:block;cursor:pointer;user-select:none;min-width:0;aspect-ratio:3/4;
  border-radius:10px;overflow:hidden;background:#0d0a06;
  box-shadow:0 0 0 1px #ffffff12,0 2px 6px #0007;
  transition:transform .16s ease,box-shadow .16s ease;}
.lsb-dc:hover{transform:translateY(-2px);
  box-shadow:0 0 0 1px color-mix(in srgb,var(--k) 75%,transparent),0 8px 18px #000a;}
.lsb-dc .th{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;}
.lsb-dc .th img{width:100%;height:100%;object-fit:cover;display:block;pointer-events:none;
  transition:transform .4s ease,filter .2s;filter:saturate(.95) brightness(.97);}
.lsb-dc:hover .th img{transform:scale(1.04);filter:none;}
.lsb-dc .th.none{background:
  radial-gradient(120% 80% at 30% 15%,color-mix(in srgb,var(--k) 22%,transparent),transparent 65%),
  linear-gradient(160deg,#1c160f,#0d0a06);}
.lsb-dc .th .ph{margin-bottom:34%;font-size:8.5px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;
  color:var(--k);opacity:.5;}
.lsb-dc .cap{position:absolute;left:0;right:0;bottom:0;padding:22px 9px 8px;
  background:linear-gradient(180deg,transparent,#000000b8 55%,#000000e0);}
.lsb-dc .th.none~.cap{background:none;}
.lsb-dc .nm{font-size:10.5px;font-weight:600;line-height:1.25;color:#fbf6ec;letter-spacing:.1px;
  overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;
  text-shadow:0 1px 2px #0009;}
.lsb-dc .tg{margin-top:2px;font-size:8.5px;color:#d9c9a8;opacity:.75;letter-spacing:.2px;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.lsb-dc .kd{position:absolute;top:8px;left:8px;width:5px;height:5px;border-radius:50%;background:var(--k);
  box-shadow:0 0 0 1.5px #0000008c;}
.lsb-dc .x{position:absolute;top:6px;right:6px;min-width:18px;height:18px;box-sizing:border-box;padding:0 5px;
  display:flex;align-items:center;justify-content:center;font-size:9px;line-height:1;border-radius:999px;
  background:#000000a6;color:#ddd;opacity:0;transition:opacity .12s,background .12s;backdrop-filter:blur(4px);}
.lsb-dc:hover .x,.lsb-dc.armed .x{opacity:1;}
.lsb-dc .x:hover{background:#b8483acc;color:#fff;}
/* the anchor check, under the This Prompt heading */
.lsb-chk{display:flex;flex-direction:column;gap:6px;margin:8px 0 2px;}
.lsb-chk.ok{flex-direction:row;align-items:center;gap:8px;font-size:10.5px;color:#9fc79a;padding:6px 10px;
  border-radius:8px;background:#7fd6a80d;border:1px solid #7fd6a830;}
.lsb-chk.ok i{font-style:normal;font-weight:700;}
.lsb-chk .ck{display:flex;gap:9px;padding:8px 10px;border-radius:8px;background:#ffffff06;border:1px solid #ffffff12;}
.lsb-chk .ck.warn{background:#e0a24a12;border-color:#e0a24a55;}
.lsb-chk .ck>i{flex:0 0 18px;height:18px;border-radius:50%;display:flex;align-items:center;justify-content:center;
  font-style:normal;font-weight:800;font-size:11px;background:#5a6470;color:#e9eef2;margin-top:1px;}
.lsb-chk .ck.warn>i{background:#e0a24a;color:#241703;}
.lsb-chk .b{flex:1;min-width:0;}
.lsb-chk .t{display:flex;flex-wrap:wrap;align-items:center;gap:6px;font-size:11.5px;font-weight:600;color:#f6ead2;}
.lsb-chk .ck.note .t{color:#d7dde3;}
.lsb-chk .ks{display:inline-flex;gap:4px;}
.lsb-chk .ck-k{font-size:8px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;padding:1px 6px;border-radius:999px;
  color:var(--k);border:1px solid color-mix(in srgb,var(--k) 55%,transparent);}
.lsb-chk .w{font-size:10.5px;line-height:1.5;color:#b9b2a3;margin-top:3px;}
.lsb-chk .f{font-size:10.5px;line-height:1.5;color:#e9c97e;margin-top:3px;}
.lsb-chk .ck.note .f{color:#a9b6c2;}
.lsb-chk .f::before{content:"→  ";}
.lsb-dc.now.flag{box-shadow:0 0 0 2px #e0a24a,0 0 14px #e0a24a40,0 2px 6px #0007;}
.lsb-dc.now .fl{position:absolute;top:6px;right:6px;width:18px;height:18px;border-radius:50%;display:flex;
  align-items:center;justify-content:center;font-size:11px;font-weight:800;background:#e0a24a;color:#241703;
  box-shadow:0 1px 4px #0009;}
.lsb-dc.risk{box-shadow:0 0 0 1px #e0a24a99,0 2px 6px #0007;}
.lsb-dc.risk .th{opacity:.72;}
.lsb-dc.live .rk{top:26px;}
.lsb-dc.live.risk{box-shadow:0 0 0 2px var(--k),0 0 0 4px #e0a24a,0 2px 6px #0007;}
.lsb-c.in.risk{border-style:dashed;border-color:#e0a24a;}
.lsb-dc .rk{position:absolute;left:6px;right:auto;max-width:calc(100% - 12px);box-sizing:border-box;top:24px;padding:2px 6px;border-radius:5px;font-size:8.5px;font-weight:700;
  line-height:1.3;color:#241703;background:#e0a24ae6;box-shadow:0 1px 4px #0008;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.lsb-c .rk{font-style:normal;display:inline-flex;align-items:center;justify-content:center;width:12px;height:12px;
  border-radius:50%;background:#e0a24a;color:#241703;font-size:8.5px;font-weight:800;margin-right:4px;flex:0 0 auto;}
.lsb-c.risk{border-style:dashed;}
.lsb-card .rk{display:flex;flex-direction:column;gap:2px;margin:2px 0 8px;padding:6px 8px;border-radius:6px;
  background:#e0a24a14;border:1px solid #e0a24a55;}
.lsb-card .rk b{font-size:11px;color:#f0c27a;}
.lsb-card .rk span{font-size:10.5px;line-height:1.45;color:#c9bfae;}
/* A card without a picture is a plain slip, as the Image Viewer shows a
   prompt: one flat tone, a rule of its kind's colour down the left, the
   kind, the start of its words, and its name. No gradient, nothing drawn
   to stand in for the missing picture. */
.lsb-dc.flat{display:flex;flex-direction:column;gap:5px;padding:9px 10px;box-sizing:border-box;
  background:color-mix(in srgb,var(--k) 15%,#0f1013);
  box-shadow:0 0 0 1px color-mix(in srgb,var(--k) 28%,transparent);}
.lsb-dc.flat:hover{transform:none;background:color-mix(in srgb,var(--k) 20%,#0f1013);
  box-shadow:0 0 0 1px color-mix(in srgb,var(--k) 50%,transparent);}
.lsb-dc.flat .kd{display:none;}
.lsb-dc.flat .fk,.lsb-dc.flat.now .kl{position:static;order:1;padding:0;background:none;backdrop-filter:none;
  font-size:8.5px;font-weight:700;letter-spacing:.9px;text-transform:uppercase;color:var(--k);}
.lsb-dc.flat.now .kl i{display:none;}
.lsb-dc.flat .lv,.lsb-dc.flat .rk{position:static;order:2;align-self:flex-start;max-width:100%;}
.lsb-dc.flat .th{position:static;order:3;flex:0 1 auto;min-height:0;display:block;overflow:hidden;padding-left:1px;background:none;outline:none;}
.lsb-dc.flat .cap{flex:0 0 auto;margin-top:auto;}
.dz-m .lsb-dc.flat .th .ex{-webkit-line-clamp:7;}
.dz-l .lsb-dc.flat .th .ex{-webkit-line-clamp:11;}
.dz-m .lsb-dc.flat.live .th .ex,.dz-m .lsb-dc.flat.risk .th .ex,.dz-m .lsb-dc.flat.loose .th .ex{-webkit-line-clamp:5;}
.dz-l .lsb-dc.flat.live .th .ex,.dz-l .lsb-dc.flat.risk .th .ex,.dz-l .lsb-dc.flat.loose .th .ex{-webkit-line-clamp:9;}
.lsb-dc.flat.live .th .ex,.lsb-dc.flat.risk .th .ex,.lsb-dc.flat.loose .th .ex{-webkit-line-clamp:2;}
.lsb-dc.flat.live.risk .th .ex{-webkit-line-clamp:1;}
.lsb-dc.flat .th .ex{font-size:9.5px;line-height:1.45;color:#a3a8b0;overflow:hidden;display:-webkit-box;
  -webkit-line-clamp:3;-webkit-box-orient:vertical;}
.lsb-dc.flat .th .ph{display:block;margin:5px 0 0;font-size:8.5px;font-weight:600;letter-spacing:.3px;text-transform:none;
  color:#7d6d52;opacity:1;}
.lsb-dc.flat .cap{position:static;order:4;padding:0;background:none;}
.lsb-dc.flat .nm{font-size:10.5px;color:#e6e8ec;text-shadow:none;}
.lsb-dc.flat .tg{color:#8b909a;opacity:1;}
.lsb-dc.flat.live{box-shadow:0 0 0 2px var(--k);}
.lsb-dc.flat.risk{box-shadow:0 0 0 1px #e0a24a99;}
.lsb-dc.flat.live.risk{box-shadow:0 0 0 2px var(--k),0 0 0 4px #e0a24a;}
.lsb-dc.flat.now.flag{box-shadow:0 0 0 2px #e0a24a;}
.lsb-dc.flat.now.loose{box-shadow:none;outline:1px dashed color-mix(in srgb,var(--k) 60%,transparent);outline-offset:-1px;}
.lsb-dc.flat.now.loose .th{outline:none;}
.lsb-dc.flat.armed{box-shadow:0 0 0 2px #e06a5a;}
.lsb-ckc{font-size:9px;font-weight:700;letter-spacing:.4px;padding:2px 8px;border-radius:999px;cursor:pointer;
  color:#241703;background:#e0a24a;border:1px solid #f0bf6e;user-select:none;}
.lsb-ckc:hover{background:#f0b45c;}
/* the cards of the open prompt name their kind in words - read as a row,
   a scene's look from light to rules */
.lsb-dc.now .kl{position:absolute;top:7px;left:7px;display:flex;align-items:center;gap:5px;padding:2px 7px 2px 5px;
  border-radius:999px;background:#000000a0;backdrop-filter:blur(4px);font-size:8px;font-weight:700;letter-spacing:.9px;
  text-transform:uppercase;color:var(--k);}
.lsb-dc.now .kl i{width:4px;height:4px;border-radius:50%;background:var(--k);}
/* every card with a picture names the anchor it belongs to, top left */
.lsb-dc:not(.flat) > .kl{position:absolute;top:7px;left:7px;z-index:2;display:flex;align-items:center;gap:5px;
  padding:2px 7px 2px 5px;border-radius:999px;background:#000000a0;backdrop-filter:blur(4px);font-size:8px;
  font-weight:700;letter-spacing:.9px;text-transform:uppercase;color:var(--k);pointer-events:none;}
.lsb-dc:not(.flat) > .kl i{width:4px;height:4px;border-radius:50%;background:var(--k);}
/* the pick box moves to the right, beside the cross, out of the label's way */
.lsb-dc:not(.flat) > .kl~.ck{left:auto;right:28px;}
.lsb-dc:not(.flat) > .kl~.ck~.lv{top:27px;left:7px;}
.lsb-dc:not(.flat) > .kl~.rk{top:27px;}
.lsb-dc:not(.flat) > .kl~.lv~.rk{top:46px;}
.lsb-dc.now .th .ph{text-transform:none;letter-spacing:.2px;font-weight:500;font-size:9px;opacity:.55;color:#cdb98f;}
.lsb-dc.now.loose{box-shadow:0 0 0 1px #ffffff10;}
.lsb-dc.now.loose .th{outline:1px dashed #5a4930;outline-offset:-5px;border-radius:10px;}
.lsb-dc.live{box-shadow:0 0 0 2px var(--k),0 0 14px color-mix(in srgb,var(--k) 35%,transparent),0 2px 6px #0007;}
.lsb-dc.live:hover{box-shadow:0 0 0 2px var(--k),0 0 18px color-mix(in srgb,var(--k) 45%,transparent),0 8px 18px #000a;}
.lsb-dc .lv{position:absolute;top:6px;left:20px;padding:2px 7px;border-radius:999px;font-size:8px;font-weight:700;
  letter-spacing:.8px;text-transform:uppercase;color:#14100a;background:var(--k);box-shadow:0 1px 4px #0008;}
.lsb-dc.armed{box-shadow:0 0 0 2px #e06a5a,0 8px 18px #000a;}
.lsb-dc.armed .x{background:#c0473a;color:#fff;font-weight:600;}
.lvp-help.lsb-dask{position:fixed;width:320px;font-family:system-ui,sans-serif;font-size:13px;line-height:1.5;
  padding:12px 14px;z-index:1000;border-color:#e0b85a;}
.lvp-help.lsb-dask .q{margin-bottom:6px;color:#e4c27a;font-weight:600;}
.lvp-help.lsb-dask .q b{color:#ffe2a3;}
.lvp-help.lsb-dask .w{opacity:.85;font-size:12px;}
.lvp-help.lsb-dask .rk{margin-top:8px;padding:6px 8px;border-radius:6px;font-size:11.5px;line-height:1.45;color:#d9cdb6;
  background:#e0a24a14;border:1px solid #e0a24a55;}
.lvp-help.lsb-dask .rk b{color:#f0c27a;}
.lvp-help.lsb-dask .close{margin-top:16px;display:flex;align-items:center;gap:6px;}
.lvp-help.lsb-dask .lvp-btn{font-size:12px;height:24px;padding:0 14px;border-radius:999px;}
.lvp-help.lsb-dask .ok{background:#e0b85a;border-color:#e0b85a;color:#241703;font-weight:600;}
.lvp-help.lsb-dask .ok:hover{background:#f0c86a;border-color:#f0c86a;color:#241703;}
.lvp-help.lsb-dedit{--kh:#d9b26a;position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);
  width:min(760px,94vw);max-height:92vh;overflow:hidden;display:flex;flex-direction:column;padding:0;z-index:1000;
  font-family:system-ui,-apple-system,"Segoe UI",sans-serif;font-size:13px;line-height:1.45;color:#e8e2d6;
  background:linear-gradient(180deg,#221b12 0%,#17130d 100%);border:1px solid #5e4b2c;border-radius:12px;
  box-shadow:0 24px 60px #000b,0 0 0 1px #0006,inset 0 1px 0 #ffffff0d;}
.lvp-help.lsb-dedit .hd{display:flex;align-items:center;gap:10px;padding:13px 16px 12px 18px;cursor:move;
  border-bottom:1px solid #3a2f1e;user-select:none;}
.lvp-help.lsb-dedit .tt{font-size:15px;font-weight:600;color:#f6eedf;letter-spacing:.2px;}
.lvp-help.lsb-dedit .kb{font-size:10px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;
  padding:3px 9px;border-radius:999px;color:var(--kh);border:1px solid color-mix(in srgb,var(--kh) 55%,transparent);
  background:color-mix(in srgb,var(--kh) 14%,transparent);}
.lvp-help.lsb-dedit .sp{flex:1;}
.lvp-help.lsb-dedit svg{width:15px;height:15px;flex:0 0 auto;display:block;}
.lvp-help.lsb-dedit .xx{width:28px;height:28px;border-radius:8px;border:0;background:transparent;color:#a8987c;
  display:flex;align-items:center;justify-content:center;cursor:pointer;}
.lvp-help.lsb-dedit .xx:hover{background:#ffffff10;color:#fff;}
.lvp-help.lsb-dedit .bd{display:flex;gap:20px;padding:18px;overflow-y:auto;min-height:0;}
.lvp-help.lsb-dedit .lf{flex:0 0 220px;display:flex;flex-direction:column;gap:8px;}
.lvp-help.lsb-dedit .rt{flex:1;min-width:0;display:flex;flex-direction:column;gap:14px;}
.lvp-help.lsb-dedit .pv{position:relative;aspect-ratio:3/4;border-radius:10px;overflow:hidden;
  background:#0e0b07;border:1px dashed #5a4930;display:flex;align-items:center;justify-content:center;
  transition:border-color .15s;}
.lvp-help.lsb-dedit .pv.has{border:1px solid #4a3b25;}
.lvp-help.lsb-dedit .pv.over{border-color:#e0b85a;border-style:solid;}
.lvp-help.lsb-dedit .pv img{width:100%;height:100%;object-fit:cover;display:block;}
.lvp-help.lsb-dedit .pv .em{display:flex;flex-direction:column;align-items:center;gap:6px;text-align:center;
  color:#8d7c5f;padding:0 14px;}
.lvp-help.lsb-dedit .pv .em svg{width:30px;height:30px;stroke-width:1.2;opacity:.7;}
.lvp-help.lsb-dedit .pv .em span{font-size:12.5px;color:#b9a581;font-weight:500;}
.lvp-help.lsb-dedit .pv .em small{font-size:11px;line-height:1.45;color:#7d6d52;}
.lvp-help.lsb-dedit .pv .clr{position:absolute;top:8px;right:8px;width:26px;height:26px;border-radius:999px;
  border:0;background:#000000a6;color:#eee;display:flex;align-items:center;justify-content:center;cursor:pointer;
  opacity:0;transition:opacity .15s,background .15s;backdrop-filter:blur(4px);}
.lvp-help.lsb-dedit .pv .clr svg{width:13px;height:13px;}
.lvp-help.lsb-dedit .pv:hover .clr{opacity:1;}
.lvp-help.lsb-dedit .pv .clr:hover{background:#b8483acc;}
.lvp-help.lsb-dedit .pbtn{display:flex;align-items:center;gap:9px;width:100%;box-sizing:border-box;
  padding:9px 12px;border-radius:8px;cursor:pointer;font:inherit;font-size:12.5px;font-weight:500;text-align:left;
  color:#ffe6b0;background:#e0b85a1c;border:1px solid #a8843f;transition:background .12s,border-color .12s,color .12s;}
.lvp-help.lsb-dedit .pbtn span{flex:1;line-height:1.25;}
.lvp-help.lsb-dedit .pbtn:hover{background:#e0b85a33;border-color:#e0b85a;color:#fff3d6;}
.lvp-help.lsb-dedit .pbtn.sub{color:#cbbd9f;background:transparent;border-color:#4a3c27;}
.lvp-help.lsb-dedit .pbtn.sub:hover{border-color:#8a7148;color:#f1e6cf;background:#ffffff08;}
.lvp-help.lsb-dedit .msg{font-size:11.5px;line-height:1.4;color:#9fc79a;min-height:16px;opacity:0;transition:opacity .2s;}
.lvp-help.lsb-dedit .msg.on{opacity:1;}
.lvp-help.lsb-dedit .msg.bad{color:#f0a48f;}
.lvp-help.lsb-dedit .f{display:flex;flex-direction:column;gap:6px;}
.lvp-help.lsb-dedit .f.grow{flex:1;}
.lvp-help.lsb-dedit .f.two{flex-direction:row;gap:12px;}
.lvp-help.lsb-dedit .f.two>div{display:flex;flex-direction:column;gap:6px;min-width:0;}
.lvp-help.lsb-dedit .f.two>div:first-child{flex:0 0 150px;}
.lvp-help.lsb-dedit .f.two>div:last-child{flex:1;}
.lvp-help.lsb-dedit label{font-size:10.5px;font-weight:600;color:#a8987c;text-transform:uppercase;letter-spacing:.9px;}
.lvp-help.lsb-dedit label em{font-style:normal;text-transform:none;letter-spacing:0;font-weight:400;color:#6f6249;margin-left:4px;}
.lvp-help.lsb-dedit input,.lvp-help.lsb-dedit select,.lvp-help.lsb-dedit textarea{width:100%;box-sizing:border-box;
  background:#0f0c08;color:#f0e9dc;border:1px solid #3d3121;border-radius:8px;padding:8px 11px;font:inherit;font-size:13px;
  outline:none;transition:border-color .12s,box-shadow .12s;}
.lvp-help.lsb-dedit input:hover,.lvp-help.lsb-dedit select:hover,.lvp-help.lsb-dedit textarea:hover{border-color:#5a4830;}
.lvp-help.lsb-dedit input:focus,.lvp-help.lsb-dedit select:focus,.lvp-help.lsb-dedit textarea:focus{
  border-color:#c9a04f;box-shadow:0 0 0 3px #e0b85a22;}
.lvp-help.lsb-dedit input::placeholder{color:#5f533f;}
.lvp-help.lsb-dedit select{cursor:pointer;}
.lvp-help.lsb-dedit select option{background:#17130d;}
.lvp-help.lsb-dedit textarea{flex:1;resize:vertical;line-height:1.55;min-height:190px;}
.lvp-help.lsb-dedit .ft{display:flex;align-items:center;gap:8px;padding:12px 16px 14px 18px;border-top:1px solid #3a2f1e;
  background:#0000001f;}
.lvp-help.lsb-dedit .ft .note{font-size:11.5px;color:#7d6d52;}
.lvp-help.lsb-dedit .fbtn{font:inherit;font-size:13px;font-weight:500;padding:7px 18px;border-radius:8px;cursor:pointer;
  transition:background .12s,border-color .12s,color .12s;}
.lvp-help.lsb-dedit .fbtn.cancel{background:transparent;color:#cbbd9f;border:1px solid #4a3c27;}
.lvp-help.lsb-dedit .fbtn.cancel:hover{border-color:#8a7148;color:#fff;}
.lvp-help.lsb-dedit .fbtn.ok{background:linear-gradient(180deg,#e9c46e,#cf9f45);color:#2a1d08;border:1px solid #e9c46e;font-weight:600;
  min-width:86px;}
.lvp-help.lsb-dedit .fbtn.ok:hover{background:linear-gradient(180deg,#f3d385,#dcad55);}
.lsb-caphead{cursor:pointer;padding:1px 0 6px;border-bottom:1px solid #22252b;margin-bottom:2px;}
.lsb-capbox.shut .lsb-caphead{border-bottom:none;margin-bottom:0;padding-bottom:1px;}
.lsb-book .lsb-caphead .lsb-lab{color:#a7adb6;}
.lsb-caphead:hover .lsb-lab{color:#e0b85a;}
.lsb-caphead .tw{display:inline-block;font-style:normal;font-size:19px;line-height:1;width:20px;
  text-align:center;margin-right:5px;vertical-align:-3px;color:#a9aeb7;transition:transform .12s;}
.lsb-capbox.shut .lsb-caphead .tw{transform:rotate(-90deg);}
/* one row per kind, ruled off from the next like the shelves of a bag */
.lsb-krow{display:flex;align-items:flex-start;gap:6px;padding:7px 0;
  border-top:1px solid #23262c;}
.lsb-krow:first-child{border-top:none;padding-top:3px;}
.lsb-klab{flex:0 0 64px;font-size:9px;font-weight:600;letter-spacing:.3px;
  text-transform:uppercase;color:var(--k);padding-top:4px;text-align:right;}
.lsb-caps{display:flex;flex-wrap:wrap;gap:6px 4px;flex:1;min-width:0;}
/* each kind folds on its label */
.lsb-klab{cursor:pointer;user-select:none;}
.lsb-klab:hover{filter:brightness(1.3);}
.lsb-klab .kt{display:inline-block;font-style:normal;font-size:10px;margin-right:3px;opacity:.7;
  transition:transform .12s;}
.lsb-krow.kf .lsb-klab .kt{transform:rotate(-90deg);}
.lsb-krow.kf{padding:5px 0;}
.lsb-kmore{display:inline-flex;align-items:center;height:20px;padding:0 9px;border-radius:999px;cursor:pointer;
  font-size:10px;font-weight:700;color:var(--k);border:1px dashed color-mix(in srgb, var(--k) 55%, #2a2d33);
  background:color-mix(in srgb, var(--k) 8%, #0d0e11);user-select:none;}
.lsb-kmore:hover{border-style:solid;}
.lsb-c{position:relative;display:inline-flex;align-items:center;gap:4px;font-size:10px;
  line-height:1;padding:3px 6px 3px 8px;border-radius:999px;cursor:grab;user-select:none;
  border:1px solid var(--k);color:var(--k);background:#1c1c1c;max-width:min(200px,100%);box-sizing:border-box;}
.lsb-c .nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;}
.lsb-c .u{font-size:8.5px;font-weight:600;opacity:.75;padding-left:5px;margin-left:1px;
  border-left:1px solid color-mix(in srgb, currentColor 45%, transparent);
  white-space:nowrap;flex:0 0 auto;}
/* the prompt the capsule is in - the first one, "+" when there are more */
.lsb-c .pn{font-size:8.5px;font-weight:400;color:#e8c766;font-variant-numeric:tabular-nums;margin-right:1px;
  white-space:nowrap;flex:0 0 auto;}
.lsb-c .pn.was{color:inherit;opacity:.75;}
.lsb-c .pn .sq{font-style:normal;opacity:.7;}
.lsb-c .pn .sn{font-style:normal;font-weight:800;color:var(--sn);margin-right:4px;
  padding-right:4px;border-right:1px solid color-mix(in srgb, var(--sn) 50%, transparent);}
.lsb-c .pn.was .sn{opacity:.8;}
.lsb-c .hn{font-size:8.5px;font-weight:700;color:#1a1a1a;background:#e8d27a;
  border-radius:999px;padding:1px 4px;}
.lsb-c .x{display:none;font-size:9px;opacity:.7;cursor:pointer;margin-left:1px;}
.lsb-c:hover .x{display:inline;}
.lsb-c .x:hover,.lsb-c .x.armed{opacity:1;color:#ff8a8a;display:inline;}
.lsb-book .lsb-c.in{background:color-mix(in srgb, var(--k) 32%, #111317);color:#f2f2f2;}
.lsb-c.idle .u{opacity:.45;}
.lsb-c.blank{border-style:dashed;background:transparent !important;color:var(--k) !important;
  font-style:italic;cursor:default;opacity:.85;}
.lsb-c.hit{box-shadow:0 0 0 2px #e8d27a;}
.lsb-c:hover{filter:brightness(1.25);}
.lsb-now{flex:0 0 auto;display:flex;align-items:center;gap:9px;padding:6px 12px;
  border:1px solid #d9b26a;border-radius:7px;background:#1d1910;
  margin-top:var(--pgap,${NOW_GAP}px);}
.lsb-now .lab{font-size:9px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;
  color:#a88c52;}
.lsb-now .no{font-size:12px;font-weight:700;color:#c9a453;font-variant-numeric:tabular-nums;}
.lsb-now .nm{font-size:13px;font-weight:600;color:#f3dcaa;cursor:text;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;}
/* one box per series; the open series' box is edged in gold */
.lsb-book .lsb-pbox{margin:6px 0 2px;padding:9px 12px 11px;border-radius:18px;}
.lsb-book .lsb-pbox+.lsb-pbox{margin-top:4px;}
.lsb-book .lsb-pbox.cur{border-color:color-mix(in srgb, #d9b26a 55%, var(--bk));}
.lsb-book .lsb-pbox.shut{padding-bottom:8px;}
.lsb-book .lsb-pbox.drop{outline:2px dashed #d9b26a;outline-offset:2px;}
/* The series box in three bands, each ruled off from the next: the title
   bar on a darker strip, the picture and note, then the prompts. */
.lsb-ghead{display:flex;align-items:center;gap:7px;margin:-10px -10px 0;padding:8px 10px;
  border-radius:10px 10px 0 0;background:#00000059;
  border-bottom:1px solid color-mix(in srgb, var(--sg, #c9a453) 30%, #ffffff14);}
.lsb-pbox.shut .lsb-ghead{margin-bottom:-10px;border-radius:10px;border-bottom-color:transparent;}
.lsb-pbox .lsb-grow{margin:0 -10px;padding:10px 12px;
  border-bottom:1px solid color-mix(in srgb, var(--sg, #c9a453) 22%, #ffffff10);}
.lsb-pbox .lsb-prompts{padding-top:10px;}
/* the memo band at the foot of a series: ruled off from the prompts, on
   the same dark strip as the title bar */
.lsb-gmemo{margin:10px -10px -10px;border-top:1px solid color-mix(in srgb, var(--sg, #c9a453) 30%, #ffffff14);
  background:#00000059;border-radius:0 0 10px 10px;}
.lsb-gmhead{display:flex;align-items:center;gap:7px;padding:7px 12px;cursor:pointer;user-select:none;}
.lsb-gmhead .car{color:#a9aeb7;font-size:13px;width:14px;text-align:center;}
.lsb-gmhead b{font-size:10px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;
  color:color-mix(in srgb, var(--sg, #c9a453) 60%, #cfc6b4);}
.lsb-gmhead .sum{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  font-size:11px;color:#8d8679;}
.lsb-gmbody{margin:0 12px 10px 33px;padding:4px 8px;border-radius:6px;font-size:11px;line-height:1.5;
  color:#c9c4ba;white-space:pre-wrap;cursor:text;min-height:18px;}
.lsb-gmbody:hover{background:#ffffff08;}
.lsb-gmbody.empty{color:#6f6a60;font-style:italic;}
/* the notes body is drawn with the anchors' own editor class, so bold,
   highlights, colours and sizes look the same here - but it sits in the flow
   of the box rather than filling a section */
/* the text starts exactly under the P of the bar's title: 12 padding, 14 caret,
   7 gap - in reading and in writing (the 1px border is taken off the padding) */
.lsb-gmbody.lvp-ta{position:static;inset:auto;z-index:auto;overflow:visible;margin:0 12px 10px 33px;
  font-family:inherit;font-size:11px;line-height:1.5;color:#c9c4ba;padding:4px 0;border-radius:0;}
.lsb-gmbody.lvp-ta:hover{background:none;}
/* paragraph blocks: every line of the notes */
.lsb-gmbody{tab-size:48px;}
.lsb-gmbody .pg{min-height:1em;}
.lsb-gmbody .pg:empty::after{content:"\u00a0";}
.lsb-gmbody .pg.m-pac{text-align:center;}
/* paragraph lines: drawn at the edge of the space before / after */
.lsb-gmbody .pg{--rc:#5d626b;}
.lsb-gmbody .pg.m-prcw{--rc:#e8e8e8;}
.lsb-gmbody .pg.m-prcy{--rc:#e8c76a;}
.lsb-gmbody .pg.m-prcb{--rc:#6f9bd6;}
/* Drawn as backgrounds, not borders: a browser rounds a border to whole
   screen pixels, so .5, 1 and 1.5 all came out the same. A background can
   carry a line lighter than a pixel, which reads as thinner, and a
   pattern - dashes, dots, a double rule. Each weight is a height and how
   much of the colour it takes; the style is one pattern for both lines. */
.lsb-gmbody .pg.m-pra05{--th:1px;--ta:42%;}
.lsb-gmbody .pg.m-pra10{--th:1px;--ta:100%;}
.lsb-gmbody .pg.m-pra15{--th:2px;--ta:62%;}
.lsb-gmbody .pg.m-pra20{--th:2px;--ta:100%;}
.lsb-gmbody .pg.m-pra30{--th:3px;--ta:100%;}
.lsb-gmbody .pg.m-prb05{--bh:1px;--ba:42%;}
.lsb-gmbody .pg.m-prb10{--bh:1px;--ba:100%;}
.lsb-gmbody .pg.m-prb15{--bh:2px;--ba:62%;}
.lsb-gmbody .pg.m-prb20{--bh:2px;--ba:100%;}
.lsb-gmbody .pg.m-prb30{--bh:3px;--ba:100%;}
.lsb-gmbody .pg[class*="m-pra"],.lsb-gmbody .pg[class*="m-prb"]{
  --tc:color-mix(in srgb,var(--rc) var(--ta,100%),transparent);
  --bc:color-mix(in srgb,var(--rc) var(--ba,100%),transparent);
  --ti:linear-gradient(var(--tc),var(--tc));
  --bi:linear-gradient(var(--bc),var(--bc));
  --tz:var(--th,0px);--bz:var(--bh,0px);
  background-image:var(--ti),var(--bi);
  background-repeat:repeat-x,repeat-x;
  background-position:left top,left bottom;
  background-size:100% var(--tz),100% var(--bz);
  padding-top:var(--tz);padding-bottom:var(--bz);}
/* dashed */
.lsb-gmbody .pg.m-prsd[class*="m-pr"]{
  --ti:linear-gradient(90deg,var(--tc) 0 6px,transparent 6px 10px);
  --bi:linear-gradient(90deg,var(--bc) 0 6px,transparent 6px 10px);
  background-size:10px var(--tz),10px var(--bz);}
/* dotted */
.lsb-gmbody .pg.m-prso[class*="m-pr"]{
  --ti:linear-gradient(90deg,var(--tc) 0 2px,transparent 2px 5px);
  --bi:linear-gradient(90deg,var(--bc) 0 2px,transparent 2px 5px);
  background-size:5px var(--tz),5px var(--bz);}
/* double: two rules with a gap the same as each of them */
.lsb-gmbody .pg.m-prsw[class*="m-pr"]{
  --tz:calc(var(--th,0px) * 3);--bz:calc(var(--bh,0px) * 3);
  --ti:linear-gradient(var(--tc) 0 33.34%,transparent 33.34% 66.66%,var(--tc) 66.66%);
  --bi:linear-gradient(var(--bc) 0 33.34%,transparent 33.34% 66.66%,var(--bc) 66.66%);}
.lsb-gmbody .pg.m-par{text-align:right;}
.lsb-gmbody .pg.m-paj{text-align:justify;}
/* a dotted line hangs: the second line starts under the text, not the dot */
.lsb-gmbody .pg.m-para,.lsb-gmbody .pg.m-dot{padding-left:1.3em;text-indent:-1.3em;}
.lsb-gmbody .pg.m-para::before,.lsb-gmbody .pg.m-dot::before{display:inline-block;width:1.3em;text-indent:0;
  color:#8a8f98;font-weight:700;font-style:normal;text-decoration:none;}
.lsb-gmbody .pg.m-para::before{content:"\u25CF";font-size:.8em;width:1.625em;}
.lsb-gmbody .pg.m-dot::before{content:"\u2022";}
.lsb-gmbody.lvp-ta.empty{color:#6f6a60;font-style:italic;}
.lsb-gmbody.lvp-ta[contenteditable="true"]{min-height:60px;outline:none;cursor:text;margin-left:24px;border-radius:6px;
  background:#0b0a08;border:1px solid color-mix(in srgb, var(--sg, #c9a453) 45%, #3a3e46);padding:5px 8px;
  color:#e6e1d6;opacity:1;font-style:normal;}
.lsb-book .lsb-pbox .lsb-gmemo{margin:11px -12px -11px;border-radius:0 0 16px 16px;}
/* In the Book the box has its own padding (9 / 12 / 11) and corners (18):
   the bands meet the border exactly, inside it, never over it, so the
   border is the same width all round */
.lsb-book .lsb-pbox .lsb-ghead{margin:-9px -12px 0;padding:8px 12px;border-radius:16px 16px 0 0;}
.lsb-book .lsb-pbox.shut .lsb-ghead{margin-bottom:-8px;border-radius:16px;}
.lsb-book .lsb-pbox .lsb-grow{margin:0 -12px;padding:10px 14px;}
.lsb-gcar{cursor:pointer;color:#a9aeb7;font-size:19px;line-height:1;width:20px;text-align:center;user-select:none;}
.lsb-gcar:hover{color:#f0d9a8;}
.lsb-gno{font-size:13px;font-weight:700;color:#c9a453;}
.lsb-gname{font-size:13.5px;font-weight:700;letter-spacing:.3px;color:#d8c9a6;cursor:text;}
.lsb-gx{font-size:13px;font-weight:800;color:#8d929b;cursor:pointer;padding:0 4px;white-space:nowrap;-webkit-text-stroke:.4px currentColor;}
.lsb-gx:hover{color:#e6e8ec;}
.lsb-gx.armed{font-size:10px;font-weight:600;-webkit-text-stroke:0;}
.lsb-gx:hover,.lsb-gx.armed{color:#ff8a8a;}
.lsb-pact{display:flex;align-items:center;gap:2px;padding:0 6px 0 0;margin-right:4px;
  border-right:1px solid #3a3e46;}
.lsb-pi{display:inline-flex;align-items:center;justify-content:center;width:24px;height:22px;
  border-radius:6px;color:#9aa0a9;cursor:pointer;}
.lsb-pi svg{width:14px;height:14px;display:block;}
.lsb-pi.psave{position:relative;}
.lsb-pi.psave.dirty{color:#e0b85a;}
.lsb-pi.psave.dirty::after{content:"";position:absolute;top:2px;right:2px;width:6px;height:6px;border-radius:50%;
  background:#e0b85a;box-shadow:0 0 0 1.5px #1a1612;}
/* Paste and Paste All drawn like the buttons on the bar above - the same
   pill and line - on their own dark fill, so they stand apart from the
   title strip they sit on */
.lsb-pi.ppaste{width:auto;height:22px;box-sizing:border-box;gap:5px;padding:0 11px 0 8px;margin-right:3px;
  border-radius:999px;
  border:1px solid color-mix(in srgb, var(--sg, #c9a453) 55%, #2a2620);
  background:color-mix(in srgb, var(--sg, #c9a453) 16%, #120f0a);
  color:color-mix(in srgb, var(--sg, #c9a453) 50%, #ece4d2);
  transition:color .1s linear,border-color .1s linear,background-color .1s linear;}
.lsb-pi.ppaste b{font-size:9.5px;font-weight:700;letter-spacing:.7px;text-transform:uppercase;}
.lsb-pi.ppaste:hover{border-color:color-mix(in srgb, var(--sg, #c9a453) 85%, #fff);color:#fff3da;
  background:color-mix(in srgb, var(--sg, #c9a453) 30%, #120f0a);}
/* the icons beside them in the same warm tone, so the whole set reads as
   the series' own, apart from the grey bar above */
.lsb-pact .lsb-pi:not(.ppaste){color:color-mix(in srgb, var(--sg, #c9a453) 45%, #a9a49a);}
.lsb-pact{border-right-color:color-mix(in srgb, var(--sg, #c9a453) 30%, #3a3e46) !important;}
.lsb-psep{background:color-mix(in srgb, var(--sg, #c9a453) 30%, #3a3e46) !important;}
.lsb-psep{display:inline-block;width:1px;height:16px;background:#3a3e46;margin:0 6px 0 4px;align-self:center;}
.lsb-pi:hover{background:#2a2d33;color:#f0d9a8;}
.lsb-pi.pdel:hover{color:#ff8a8a;}
.lsb-c .sg{font-size:8.5px;font-weight:700;color:#1a1a1a;background:#9a9a9a;
  border-radius:3px;padding:0 3px;}
.lsb-c.far{border-style:dotted;}
.lsb-now .gn{font-size:10px;color:#a88c52;margin-left:auto;white-space:nowrap;}
/* The editing bar is the lid of the anchors below it: click to fold them away
   or bring them back. Folded, it is all there is under the book. */
.lvp-wrap.is-book .lsb-now{cursor:pointer;user-select:none;}
.lvp-wrap.is-book .lsb-now:hover{background:#262013;}
.lsb-now .tw{font-style:normal;font-size:19px;line-height:1;color:#c9a453;width:20px;
  text-align:center;flex:0 0 auto;transition:transform .12s;}
.lvp-wrap.anch-shut .lsb-now .tw{transform:rotate(-90deg);}
.lsb-now .hint{font-size:10px;color:#7d7259;white-space:nowrap;}
.lsb-now .sp{flex:1 1 auto;}
.lsb-now .gn{margin-left:0;}
.lsb-now .nowpaste{flex:0 0 auto;height:22px;padding:0 14px;border-radius:999px;font-size:10px;font-weight:700;letter-spacing:.7px;text-transform:uppercase;cursor:pointer;border-color:#7a6430;color:#f0d9a8;background:#2a2416;}
.lsb-now .nowpaste:hover{background:#3a3120;border-color:#c9a453;}
.lvp-wrap.anch-shut .lsb-now{border-color:#6b5a33;background:#15130e;}
/* below the book, the anchors hang from the editing bar: set in from the
   left with a rule down their side, a level under the prompts above */
.lvp-wrap.is-book .lvp-bar,.lvp-wrap.is-book .lvp-list{margin-left:6px;}
.lvp-wrap.is-book .lvp-list{border-left:2px solid #3a3322;padding-left:7px;}
.lvp-wrap.is-book .lvp-bar{padding-left:7px;border-left:2px solid #3a3322;margin-top:-5px;padding-top:6px;}
.lsb-side{display:contents;}
/* the anchors beside the book: two columns, the footer across both */
.lsb-split{display:none;}
.lvp-wrap.is-book.side{display:grid;grid-template-columns:minmax(0,.53fr) 8px minmax(0,.47fr);
  grid-template-rows:minmax(0,1fr) auto;column-gap:4px;row-gap:5px;}
.lvp-wrap.is-book.side .lsb-book{grid-column:1;grid-row:1;align-self:start;min-width:0;}
.lvp-wrap.is-book.side .lsb-split{display:block;grid-column:2;grid-row:1;align-self:stretch;
  cursor:col-resize;border-radius:3px;background:transparent;position:relative;}
.lvp-wrap.is-book.side .lsb-split::after{content:"";position:absolute;left:3px;top:0;bottom:0;width:2px;
  border-radius:1px;background:#3a3322;}
.lvp-wrap.is-book.side .lsb-split:hover::after{background:#c9a453;}
.lvp-wrap.is-book.side .lsb-side{display:flex;flex-direction:column;gap:5px;
  grid-column:3;grid-row:1;min-width:0;min-height:0;}
.lvp-wrap.is-book.side .lvp-foot{grid-column:1 / -1;grid-row:2;}
.lvp-wrap.is-book.side .lsb-now{margin-top:0;}
.lvp-wrap.is-book.side .lsb-drside:not(:empty)+.lsb-now{margin-top:var(--pgap,${NOW_GAP}px);}
/* two small layout pictures, the one in use lit - like a window layout switch */
.lsb-now .nowlay{flex:0 0 auto;display:inline-flex;gap:2px;padding:2px;border:1px solid #5a4a26;
  border-radius:999px;background:#15120b;}
.lsb-now .nowlay .lay{width:26px;height:18px;padding:0;border:0;border-radius:999px;cursor:pointer;
  display:inline-flex;align-items:center;justify-content:center;background:transparent;color:#7d6a43;}
.lsb-now .nowlay .lay svg rect{fill:none;stroke:currentColor;stroke-width:1.4;}
.lsb-now .nowlay .lay:hover{color:#d9bf85;}
.lsb-now .nowlay .lay.on{background:#3a3120;color:#f3dcaa;}
.lsb-now .nowlay .lay.on svg rect{fill:color-mix(in srgb, currentColor 22%, transparent);}
/* the drawer in the anchors' column: the same switch, on its own header */
.lsb-dlay{flex:0 0 auto;display:inline-flex;gap:2px;padding:2px;border:1px solid #5a4a26;
  border-radius:999px;background:#15120b;margin-left:6px;}
.lsb-dlay .lay{width:26px;height:18px;padding:0;border:0;border-radius:999px;cursor:pointer;
  display:inline-flex;align-items:center;justify-content:center;background:transparent;color:#7d6a43;}
.lsb-dlay .lay svg rect{fill:none;stroke:currentColor;stroke-width:1.4;}
.lsb-dlay .lay:hover{color:#d9bf85;}
.lsb-dlay .lay.on{background:#3a3120;color:#f3dcaa;}
.lsb-dlay .lay.on svg rect{fill:color-mix(in srgb, currentColor 22%, transparent);}
/* the drawer's place beside the book: a bare holder, the drawer brings its own frame */
/* the drawer stands on its own, like the anchors' bar: out of the book's
   frame, under it or beside it */
.lsb-left{display:contents;}
.lvp-wrap.is-book.side .lsb-left{display:flex;flex-direction:column;gap:5px;grid-column:1;grid-row:1;
  align-self:start;min-width:0;}
.lsb-drbook{display:none;}
.lsb-drbook:not(:empty){display:flex;align-self:stretch;padding:0;border:0;
  background:transparent;min-width:0;flex:0 0 auto;}
.lvp-wrap.is-book.side .lsb-drbook:not(:empty){align-self:stretch;}
.lsb-drbook>.lsb-drawer{margin-top:0;flex:1 1 auto;min-width:0;}
/* under the book it keeps the same distance from the book as the anchors'
   bar keeps from it - one spacing for the whole column, set by dragging it */
.lsb-drunder:not(:empty){margin-top:var(--pgap,${NOW_GAP}px);}
/* out of the book the drawer is drawn like the anchors' bar beside it:
   the same corners, the same padding, the same title */
.lsb-drbook>.lsb-drawer{border-radius:7px;padding:6px 12px 8px;}
.lsb-drbook>.lsb-drawer.shut{padding:6px 12px;}
.lsb-drbook>.lsb-drawer .lsb-drhead{gap:9px;min-height:22px;}
.lsb-drbook>.lsb-drawer.shut .lsb-drhead{padding:0;}
.lsb-drbook>.lsb-drawer .lsb-drhead .tw{font-size:19px;color:#c9a453;margin-right:9px;vertical-align:-3px;}
.lsb-drbook .lsb-drhead .lsb-lab{font-size:9px;font-weight:700;letter-spacing:.8px;color:#a88c52;}
.lsb-drbook .lsb-drhead:hover .lsb-lab{color:#c9a453;}
.lsb-drbook>.lsb-drawer .lsb-drhead .lsb-count{font-size:12px;font-weight:700;color:#c9a453;
  font-variant-numeric:tabular-nums;}
/* the spacing between the panels, dragged */
.lvp-wrap.gapzone{cursor:row-resize;}
.lvp-wrap.anch-shut .lvp-bar,.lvp-wrap.anch-shut .lvp-list,.lvp-wrap.anch-shut .lvp-fr,.lvp-wrap.anch-shut .lvp-pastebox{display:none !important;}
.lsb-load{display:flex;flex-direction:column;gap:4px;padding:8px 10px;margin:4px 0;
  border:1px solid #3a3e46;border-radius:7px;background:#0d0e11;}
.lsb-load .lh{display:flex;align-items:center;justify-content:space-between;
  font-size:10px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:#e0b85a;}
.lsb-load .le{font-size:10.5px;color:#7d7d7d;}
.lsb-load .lh .sp{flex:1;}
.lsb-load .ls{margin-top:6px;font-size:10px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:#c9a453;}
.lsb-load .ls i{font-style:normal;font-weight:400;text-transform:none;letter-spacing:0;color:#6c7079;margin-left:8px;}
.lsb-load .lsave{display:flex;gap:8px;align-items:center;margin:4px 0 10px;padding:10px 10px 10px 12px;
  background:#1b1912;border:1px solid #4a3f26;border-left:3px solid #e0b85a;border-radius:6px;}
.lsb-load .lsave .lsl{flex:0 0 auto;color:#e0b85a;font-size:10px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;}
.lsb-load .lsave input{flex:1;min-width:0;height:22px;box-sizing:border-box;padding:0 8px;border-radius:5px;
  border:1px solid #3a3e46;background:#16181c;color:#e6e6e6;font-size:11px;}
.lsb-load .lfoot{display:flex;justify-content:flex-end;}
.lsb-load .lsave .bsc{height:22px;max-width:220px;padding:0 6px;border-radius:5px;border:1px solid #3a3e46;
  background:#16181c;color:#e6e6e6;font-size:11px;cursor:pointer;}
.lsb-load .lh .lsb-btn{text-transform:none;letter-spacing:0;font-weight:600;margin-left:6px;}
.lsb-load .lb{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;
  background:#1d1a12;border:1px solid #5a4c2c;color:#e6dcc4;font-size:10.5px;}
.lsb-load .lb span{flex:1;}
.lsb-load .lr{display:flex;align-items:center;gap:10px;padding:4px 6px;border-radius:5px;
  background:none;font-size:11px;}
.lsb-load .lr:hover{background:#1c1f24;}
.lsb-load .lsec>.lfd:not(:first-child){margin-top:8px;}
.lsb-load .lr b{color:#e6e6e6;font-weight:600;}
.lsb-load .lr .lpic{flex:0 0 auto;width:30px;height:30px;border-radius:4px;overflow:hidden;background:#0e0f12;
  margin:-2px 0;}
.lsb-load .lr .lpic img{width:100%;height:100%;object-fit:cover;display:block;}
.lsb-load .lr .lpic.none{background:none;}
.lsb-lnote .lncol{display:flex;gap:11px;align-items:flex-start;margin:6px 0 8px;}
.lsb-lnote .lncol:last-child{margin-bottom:0;}
.lsb-lnote .lnpic{flex:0 0 auto;display:block;width:120px;height:auto;max-height:200px;object-fit:cover;border-radius:6px;}
.lsb-lnote .lntx{flex:1;min-width:0;}
.lsb-lnote .lntx p{margin-top:0;}
.lsb-load .lr span{color:#5c6169;font-size:10px;flex:1;}
.lsb-load .lr i{color:#6c7079;font-size:10px;}
.lsb-load .lr.here{opacity:.6;}
.lsb-load .lh .lfq{flex:1;min-width:0;max-width:280px;height:20px;box-sizing:border-box;padding:0 8px;margin-left:10px;
  border-radius:5px;border:1px solid #3a3e46;background:#16181c;color:#e6e6e6;font-size:11px;
  text-transform:none;letter-spacing:0;font-weight:400;}
.lsb-load .ls[data-sec]{display:flex;align-items:center;cursor:pointer;user-select:none;}
.lsb-load .ls[data-sec]::before{content:"▾";display:inline-block;width:12px;font-size:9px;}
.lsb-load .ls[data-sec].shut::before{content:"▸";}
.lsb-load .lsec{display:flex;flex-direction:column;gap:4px;max-height:540px;overflow-y:auto;padding:2px;border-radius:6px;}
/* book files hold the folders, so they get the room: series files half */
.lsb-load .lsec[data-sec="book"]{max-height:810px;}
.lsb-load .lsec[data-sec="series"]{max-height:270px;}
.lsb-load .lsec.shut{display:none;}
.lsb-load .lsec.drop,.lsb-load .ls.drop{outline:1px dashed #e0b85a;outline-offset:1px;}
.lsb-load .lfd{display:flex;align-items:center;gap:8px;padding:5px 6px;border-radius:5px;cursor:pointer;
  background:#1a1812;border:1px solid #3b3424;font-size:11px;}
.lsb-load .lfd:hover{border-color:#5a4c2c;}
.lsb-load .lfd .car{width:10px;color:#c9a453;font-size:10px;}
.lsb-load .lfd svg{width:13px;height:13px;fill:var(--fc,#c9a453);flex:0 0 auto;}
.lsb-load .lfd .fcol{width:9px;height:9px;border-radius:50%;background:var(--fc,#c9a453);cursor:pointer;opacity:0;
  box-shadow:0 0 0 2px #0006;flex:0 0 auto;}
.lsb-load .lfd:hover .fcol{opacity:.9;}
.lsb-load .lfd:not(.sub){background:color-mix(in srgb,var(--fc,#c9a453) 9%,#141414);
  border-color:color-mix(in srgb,var(--fc,#c9a453) 32%,#1a1a1a);}
.lsb-load .lfd:not(.sub):hover{border-color:color-mix(in srgb,var(--fc,#c9a453) 55%,#1a1a1a);}
.lsb-load .lfd .car{color:var(--fc,#c9a453) !important;}
.lsb-load .lfd b{flex:0 1 auto;min-width:0;color:#e6dcc4;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.lsb-load .lfd .n{color:#8a7d5c;font-size:10px;font-variant-numeric:tabular-nums;padding:0 6px;border-radius:8px;background:#2a2518;}
.lsb-load .lfd .fsp{flex:1;}
.lsb-load .lfd .akeep{font-style:normal;font-size:9.5px;color:#7d828b;margin-left:2px;}
.lsb-load .lfd.arch{background:#15171b;border-color:#4a515c;border-style:solid;}
.lsb-load .lfd.arch:hover{border-color:#7a8492;}
.lsb-load .lfd.arch b{color:#d6dce4;}
/* a folder inside another reads as a chapter heading - gold words and a
   rule under them, not another box */
.lsb-load .lfd.sub{background:none;border:0;border-bottom:1px solid #3b3424;border-radius:0;padding:7px 4px 4px;margin-top:6px;}
.lsb-load .lfd.sub:hover{border-bottom-color:#7a6436;}
.lsb-load .lfd.sub b{color:color-mix(in srgb,var(--fc,#c9a453) 85%,#fff);font-size:11.5px;}
.lsb-load .lfd.sub{border-bottom-color:color-mix(in srgb,var(--fc,#c9a453) 30%,#1a1a1a) !important;}
.lsb-load .lfd.sub .n{background:none;padding:0 2px;}
.lsb-load .lfd.sub.drop{outline:2px dashed #e0b85a;outline-offset:0;background:#2a2518;}
.lsb-load .lfd .lsb-btn{opacity:0;}
.lsb-load .lfd:hover .lsb-btn,.lsb-load .lfd .lsb-btn.armed{opacity:1;}
.lsb-load .lfd .fdel.armed{color:#ff8a7a;border-color:#7a3a33;}
.lsb-load .lfd.drop{outline:2px dashed #e0b85a;outline-offset:-2px;background:#3a311c;}
.lsb-load .lfd.dropb{box-shadow:0 -3px 0 0 #e0b85a;}
.lsb-load .lfd.dropa{box-shadow:0 3px 0 0 #e0b85a;}
.lsb-load .lfd input.lfn{flex:1;min-width:0;height:20px;box-sizing:border-box;padding:0 6px;border-radius:4px;
  border:1px solid #e0b85a;background:#16181c;color:#e6e6e6;font-size:11px;}
.lsb-load .lr input.lrn{flex:0 1 320px;min-width:120px;height:20px;box-sizing:border-box;padding:0 6px;border-radius:4px;
  border:1px solid #e0b85a;background:#16181c;color:#e6e6e6;font-size:11px;}
.lsb-load .lfd[draggable="true"]{cursor:grab;}
.lsb-load .lfc{display:flex;flex-direction:column;gap:1px;margin-left:14px;padding-left:8px;
  border-left:1px solid color-mix(in srgb,var(--fc,#c9a453) 28%,#1a1a1a);}
.lsb-load .lfc.drop{outline:2px dashed #e0b85a;outline-offset:2px;border-radius:5px;background:#e0b85a12;}
.lsb-load .lr[draggable="true"]{cursor:grab;}
.lsb-load .lr .sdel{opacity:0;}
.lsb-load .lr .fmv{opacity:0;padding:0 6px;min-width:0;font-size:8px;}
.lsb-load .lr:hover .fmv{opacity:1;}
/* Open and Bring back show on the row under the pointer only, like the
   arrows and the delete mark - the list reads as names, not buttons */
.lsb-load .lr .bop,.lsb-load .lr .ld{opacity:0;}
.lsb-load .lr:hover .bop,.lsb-load .lr:hover .ld,.lsb-load .lr.sel .bop,.lsb-load .lr.sel .ld{opacity:1;}
.lsb-load .lr:hover .sdel,.lsb-load .lr .sdel.armed{opacity:1;}
.lsb-load .lr .lhide{opacity:0;}
.lsb-load .lr:hover .lhide,.lsb-load .lr .lhide.un{opacity:1;}
.lsb-load .lr.hid{opacity:.5;}
.lsb-load .lr.hid:hover{opacity:.85;}
.lsb-load .lr .sdel.armed{color:#ff8a7a;border-color:#7a3a33;}
.lsb-load .lh .lkw{margin-right:6px;font-weight:400;text-transform:none;letter-spacing:0;color:#6c7079;font-size:10px;}
.lsb-load .ls .lkw{margin-left:auto;font-weight:400;text-transform:none;letter-spacing:0;color:#6c7079;font-size:10px;}
.lsb-load .lold{display:flex;align-items:center;gap:10px;padding:4px 6px;color:#7d828b;font-size:10.5px;}
.lsb-load .lold .lsb-btn{margin-left:auto;}
.lsb-load .lkd{margin-left:6px;height:18px;padding:0 4px;border-radius:4px;border:1px solid #3a3e46;
  background:#16181c;color:#e6e6e6;font-size:10px;cursor:pointer;}
.lsb-load{position:relative;}
.lsb-lnote{position:absolute;z-index:50;max-width:520px;max-height:480px;overflow:hidden;padding:9px 11px;
  border-radius:7px;border:1px solid #5a4c2c;background:#0d0e11;box-shadow:0 6px 18px #0009;pointer-events:none;
  font-size:11px;line-height:1.5;color:#d6d0c2;}
.lsb-lnote b{display:block;color:#e0b85a;font-weight:600;font-size:10.5px;letter-spacing:.3px;}
.lsb-lnote p{margin:2px 0 8px;white-space:pre-wrap;}
.lsb-lnote p:last-child{margin-bottom:0;}
.lsb-lnote p.no{color:#7d828b;font-style:italic;}
.lsb-load .lr.sel{background:#221e14;box-shadow:inset 0 0 0 1px #e0b85a;opacity:1;}
/* the shelf's series: one chip each, the shown one lit */
.lsb-sv{display:inline-flex;flex-wrap:wrap;gap:4px;margin-left:4px;}
.lsb-svc{display:inline-flex;align-items:center;gap:5px;font-size:9.5px;font-weight:600;
  padding:3px 10px;border-radius:999px;cursor:pointer;user-select:none;
  background:#14161a;border:1px solid #3a3e46;color:#aeb3bc;}
.lsb-svc b{color:#c9a453;font-weight:700;}
.lsb-svc:hover{border-color:#d9b26a;color:#f0d9a8;}
.lsb-svc.on{background:#2a2416;border-color:#d9b26a;color:#f3dcaa;}
.lsb-svc.all{letter-spacing:.5px;text-transform:uppercase;font-size:9px;}
/* a series wearing the colour its Series Lab gave it - a step quieter here
   than on the Lab's shelf, mixed into the book's own tone */
.lsb-gnote{margin:2px 2px 8px;padding:4px 8px;border-radius:6px;font-size:11px;line-height:1.45;
  color:color-mix(in srgb, var(--sg, #c9a453) 30%, #c9c4ba);white-space:pre-wrap;cursor:text;
  border-left:2px solid color-mix(in srgb, var(--sg, #c9a453) 55%, transparent);}
.lsb-gnote:hover{background:#ffffff08;}
.lsb-grow{display:flex;align-items:stretch;gap:10px;margin:2px 2px 8px;}
.lsb-grow>.lsb-gnote{flex:1;min-width:0;margin:0;}
.lsb-gpic{flex:0 0 auto;width:84px;min-height:60px;border-radius:6px;overflow:hidden;cursor:pointer;display:flex;
  align-items:center;justify-content:center;background:#0e0f12;border:1px solid color-mix(in srgb,var(--sg,#c9a453) 40%,#222);}
.lsb-gpic img{width:100%;height:100%;object-fit:cover;display:block;}
.lsb-gpic.none{border-style:dashed;opacity:0;transition:opacity .15s;}
.lsb-gpic.none i{font-style:normal;font-size:18px;color:color-mix(in srgb,var(--sg,#c9a453) 70%,#888);}
.lsb-pbox:hover .lsb-gpic.none{opacity:.55;}
.lsb-gpic.over{outline:2px dashed #e0b85a;opacity:1;}
.lsb-gzoom{position:fixed;z-index:10050;padding:6px;border-radius:9px;background:#0e0f12;border:1px solid #6a5a33;
  box-shadow:0 10px 30px rgba(0,0,0,.6);cursor:zoom-out;}
.lsb-gzoom img{display:block;max-height:360px;max-width:360px;width:auto;height:auto;border-radius:6px;}
.lsb-gnote.empty{opacity:0;font-style:italic;transition:opacity .15s;}
.lsb-pbox:hover .lsb-gnote.empty{opacity:.45;}
.lsb-gnote-ed{width:100%;box-sizing:border-box;min-height:34px;resize:none;overflow:hidden;font:inherit;line-height:1.45;
  color:#ece6da;background:#0c0d10;border:1px solid color-mix(in srgb, var(--sg, #c9a453) 55%, #333);border-radius:5px;
  padding:4px 6px;outline:none;}
.lsb-gtone{width:12px;height:12px;border-radius:50%;cursor:pointer;flex:0 0 auto;margin-left:8px;
  background:var(--gt);box-shadow:0 0 0 1px #00000080,0 0 0 3px color-mix(in srgb, var(--gt) 30%, transparent);}
.lsb-gtone:hover{box-shadow:0 0 0 1px #00000080,0 0 0 3px var(--gt);}
.lsb-book .lsb-pbox.tint{border-color:color-mix(in srgb, var(--sg) 42%, #2a2620);
  background:color-mix(in srgb, var(--sg) 9%, color-mix(in srgb, var(--bk) calc(var(--bl) * 55% + 6%), #07080a));}
.lsb-book .lsb-pbox.tint.cur{border-color:color-mix(in srgb, var(--sg) 70%, #3a3428);}
.lsb-pbox.tint .lsb-gno{color:color-mix(in srgb, var(--sg) 70%, #b8b0a0);}
.lsb-pbox.tint .lsb-gname{color:color-mix(in srgb, var(--sg) 38%, #d8c9a6);}
.lsb-book .lsb-pbox.tint .lsb-p .no{color:color-mix(in srgb, var(--sg) 55%, #a8a49a);}
/* the prompts of a series: the ones not open drawn empty - an outline in
   the series' colour - and the open one filled with it, so the one you
   are in is the one that stands out */
.lsb-book .lsb-pbox.tint .lsb-p{background:transparent;
  border-color:color-mix(in srgb, var(--sg) 45%, #2e2a24);color:#c9c4ba;}
.lsb-book .lsb-pbox.tint .lsb-p:hover{border-color:color-mix(in srgb, var(--sg) 80%, #3a3428);color:#ece6da;}
.lsb-book .lsb-pbox.tint .lsb-p.on{border-color:color-mix(in srgb, var(--sg) 85%, #fff);
  background:color-mix(in srgb, var(--sg) 62%, #1a1814);color:#fff;font-weight:600;}
.lsb-book .lsb-pbox.tint .lsb-p.on .no{color:color-mix(in srgb, var(--sg) 25%, #fff);}
/* the frame a prompt asks for: a small outline of that shape after the name */
/* the name gives way to the frame mark: a long name in the bold of the open
   prompt is cut short with an ellipsis rather than the mark being cut off */
.lsb-p .pnm{min-width:0;flex:0 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.lsb-p .no{flex:0 0 auto;}
.lsb-p .lsb-or{flex:0 0 auto;box-sizing:border-box;display:inline-block;margin-left:2px;
  border:1.5px solid currentColor;border-radius:1.5px;cursor:pointer;opacity:.8;}
.lsb-p .lsb-or:hover{opacity:1;color:#e8c766;}
.lsb-p .lsb-or.o-portrait{width:8px;height:12px;}
.lsb-p .lsb-or.o-landscape{width:13px;height:8px;}
.lsb-p .lsb-or.o-square{width:10px;height:10px;}
.lsb-p .lsb-or.o-all{width:10px;height:10px;border-style:dashed;opacity:0;}
.lsb-p:hover .lsb-or.o-all,.lsb-p.on .lsb-or.o-all{opacity:.35;}
.lsb-p:hover .lsb-or.o-all:hover{opacity:1;}
/* a prompt's number as a capsule writes it: the series figure, a bar, and
   the prompt's own number in the gold of the capsule numbers */
.lsb-p .no .sn{font-style:normal;font-weight:800;margin-right:5px;padding-right:5px;
  border-right:1px solid color-mix(in srgb, currentColor 45%, transparent);}
.lsb-p .no .sq{font-style:normal;color:#e8c766;}
.lsb-book .lsb-pbox.tint .lsb-p .no .sn{color:color-mix(in srgb, var(--sg) 80%, #fff);}
.lsb-book .lsb-pbox.tint .lsb-p.on .no .sn{color:#fff;}
.lsb-book .lsb-p.on .no .sq{color:#ffe08a;}
.lsb-svc.tint b{color:color-mix(in srgb, var(--sg) 70%, #b8b0a0);}
.lsb-svc.tint.on{border-color:color-mix(in srgb, var(--sg) 62%, #3a3428);
  background:color-mix(in srgb, var(--sg) 16%, #1d1b16);}
.lsb-c .sg[style]{background:color-mix(in srgb, var(--sg) 60%, #8a8a8a);}
.lsb-trt{font-size:9px;font-weight:700;letter-spacing:.5px;padding:2px 7px;border-radius:999px;
  cursor:pointer;user-select:none;border:1px solid #3a3e46;color:#8a8f98;background:#14161a;}
.lsb-trt:hover{border-color:#48a882;color:#9ad8b6;}
.lsb-trt.on{border-color:#48a882;color:#b8f0d0;background:#13261d;}
.lsb-used,.lsb-tidy{font-size:9px;font-weight:700;letter-spacing:.5px;padding:2px 7px;border-radius:999px;
  cursor:pointer;user-select:none;border:1px solid #3a3e46;color:#8a8f98;background:#14161a;text-transform:uppercase;}
.lsb-used:hover{border-color:#7f9cc9;color:#b9cdef;}
.lsb-used.on{border-color:#7f9cc9;color:#d4e2fa;background:#18202d;}
.lsb-used.off{opacity:.45;}
.lsb-mine.on{border-color:#e8c766;color:#fbe7b0;background:#2a2414;}
.lsb-tidy:hover{border-color:#c98a5a;color:#f0c7a4;}
.lsb-tidy.armed{border-color:#e06a5a;color:#ffd6cf;background:#3a1714;}
.lsb-count .hid{font-style:normal;opacity:.5;margin-left:3px;font-size:.9em;}
.lsb-chelp{flex:0 0 auto;width:17px;height:17px;border-radius:50%;display:inline-flex;
  align-items:center;justify-content:center;font-size:10px;font-weight:700;cursor:pointer;
  user-select:none;border:1px solid #3a3e46;color:#8a8f98;background:#14161a;}
.lsb-chelp:hover{border-color:#e0b85a;color:#f3d79a;}
.lvp-help.lsb-caphelp{width:580px;font-family:system-ui,sans-serif;font-size:11.5px;}
.lvp-help.lsb-caphelp code{white-space:nowrap;}
.lvp-help.lsb-caphelp .sub{margin:0 0 6px;opacity:.75;}
.lvp-help.lsb-caphelp table{border-collapse:collapse;width:100%;}
.lvp-help.lsb-caphelp td{padding:4px 0;vertical-align:middle;border-bottom:1px solid #222;}
.lvp-help.lsb-caphelp td:first-child{white-space:nowrap;padding-right:14px;width:1%;}
.lvp-help.lsb-caphelp tr:last-child td{border-bottom:none;}
.lvp-help.lsb-caphelp .lsb-c{pointer-events:none;}
.lsb-trl{font-size:10px;padding:1px 4px;border-radius:999px;border:1px solid #2f5a47;
  background:#13261d;color:#b8f0d0;cursor:pointer;max-width:150px;}
.lsb-trl:focus{outline:none;border-color:#48a882;}
.lsb-card .th{display:block;align-self:flex-start;flex:0 0 auto;width:auto;height:auto;max-width:220px;max-height:240px;
  object-fit:contain;border-radius:6px;margin:2px 0 8px;}
.lsb-card{position:fixed;z-index:60;max-width:460px;min-width:260px;padding:10px 12px;
  background:#121418;border:1px solid var(--k);border-radius:10px;box-shadow:0 8px 24px #000c;
  font-family:system-ui,sans-serif;color:#d8dbe0;display:flex;flex-direction:column;gap:7px;
  pointer-events:none;}
.lsb-card .ch{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;}
.lsb-card .ch b{font-size:12px;color:var(--k);}
.lsb-card .ch span{font-size:10px;color:#7d828b;}
.lsb-card .en{font-size:11.5px;line-height:1.5;color:#c9ccd2;white-space:pre-wrap;
  max-height:220px;overflow:hidden;}
.lsb-card .tr{font-size:12px;line-height:1.6;color:#b8f0d0;white-space:pre-wrap;
  border-top:1px solid #23262c;padding-top:7px;max-height:240px;overflow:hidden;}
.lsb-card .tr.wait{color:#6c7079;font-style:italic;}
.lsb-card .tr.err{color:#e8a0a0;}
.lsb-card .hint{font-size:10.5px;line-height:1.5;color:#8b909a;border-top:1px solid #23262c;padding-top:7px;
  display:flex;flex-direction:column;gap:3px;}
.lsb-card .hint .hr{display:grid;grid-template-columns:118px 1fr;gap:10px;align-items:baseline;}
.lsb-card .hint .hr b{font-size:11px;font-weight:700;color:#e4c27a;white-space:nowrap;}
.lsb-card .hint .hr span{color:#a9aeb7;}
.lsb-pnote{position:fixed;z-index:70;max-width:calc(100vw - 16px);padding:10px 12px;box-sizing:border-box;
  background:#121418;border:1px solid #e4c27a;border-radius:10px;box-shadow:0 8px 24px #000c;
  font-family:system-ui,sans-serif;color:#d8dbe0;display:flex;flex-direction:column;gap:8px;}
.lsb-pnote .hd{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;}
.lsb-pnote .hd b{font-size:12px;color:#e4c27a;}
.lsb-pnote .hd span{font-size:10px;color:#7d828b;}
.lsb-pnote{width:520px;}
.lsb-pnote .bd{display:flex;gap:10px;align-items:stretch;}
.lsb-pnote .lf{flex:0 0 130px;display:flex;flex-direction:column;gap:5px;}
.lsb-pnote .pv{position:relative;width:130px;height:130px;border-radius:6px;overflow:hidden;border:1px dashed #4a3c27;
  background:#0e0f12;display:flex;align-items:center;justify-content:center;text-align:center;}
.lsb-pnote .pv.has{border-style:solid;border-color:#5a4c2c;}
.lsb-pnote .pv.over{border-color:#e0b85a;border-style:solid;}
.lsb-pnote .pv img{width:100%;height:100%;object-fit:cover;display:block;}
.lsb-pnote .pv span{font-size:10.5px;color:#7d6d52;line-height:1.4;}
.lsb-pnote .pv small{font-size:9.5px;opacity:.8;}
.lsb-pnote .pv .clr{position:absolute;top:5px;right:5px;width:20px;height:20px;border-radius:50%;border:0;
  background:#000a;color:#fff;cursor:pointer;font-size:13px;line-height:1;opacity:0;}
.lsb-pnote .pv:hover .clr{opacity:1;}
.lsb-pnote .lf .lsb-btn{width:100%;}
.lsb-pnote textarea{flex:1;width:auto;box-sizing:border-box;min-height:130px;resize:vertical;padding:8px 9px;border-radius:6px;
  border:1px solid #3a3e46;background:#16181c;color:#e6e6e6;font:12px/1.55 system-ui,sans-serif;outline:none;}
.lsb-pnote textarea:focus{border-color:#e4c27a;}
.lsb-pnote .ft{display:flex;align-items:center;gap:6px;}
.lsb-pnote .ft span{font-size:10px;color:#6c7079;}
.lsb-pnote .ft i{flex:1;}
.lsb-p.noted .pnm::after{content:"";display:inline-block;width:5px;height:5px;margin-left:7px;border-radius:50%;
  background:currentColor;opacity:.55;vertical-align:middle;}
/* the book's own tooltips, drawn as cards: what it is, then each action
   under a gold label */
.lsb-card.tip{--k:#e4c27a;min-width:200px;max-width:420px;}
.lsb-card.tip .en{font-size:11px;color:#b9bdc5;}
.lsb-card.tip .hint{border-top:0;padding-top:0;}
.lsb-card.tip .en+.hint{border-top:1px solid #23262c;padding-top:7px;}
.lsb-card.tip .hint .hr{grid-template-columns:auto 1fr;gap:12px;}
.lsb-none{font-size:10px;color:#777;padding:2px 0 0 4px;}
.lsb-ren{font:inherit;font-size:10.5px;background:#111;color:#fff;border:1px solid #d9b26a;
  border-radius:3px;padding:1px 4px;width:150px;}
.lsb-var{font-size:8.5px;font-weight:700;letter-spacing:.3px;color:#9aa0a9;cursor:pointer;
  border:1px dashed #555a62;border-radius:999px;padding:1px 6px;margin-left:4px;white-space:nowrap;
  flex:0 0 auto;opacity:0;transition:opacity .12s;}
.lvp-sec:hover .lsb-var{opacity:1;}
.lsb-var:hover{color:#f0d9a8;border-color:#d9b26a;border-style:solid;}
.lsb-shared{font-size:8.5px;font-weight:600;letter-spacing:.3px;color:var(--k);
  border:1px solid var(--k);border-radius:999px;padding:1px 6px;margin-left:4px;
  white-space:nowrap;flex:0 0 auto;opacity:.85;}
.lvp-sec.lsb-drop{outline:2px dashed #d9b26a;outline-offset:-2px;}
`;

/* This pack is a copy of the Prompt Composer and kept its class names, which
   means both stylesheets define .lvp-tog, .lvp-trb and the rest. Installed
   side by side, whichever loaded last won - which is why recolouring the
   header switches here had no effect while the Suite was installed.

   Every rule is therefore scoped to the node's own root class on the way into
   the page. The extra class raises specificity, so this pack's rules win
   inside this pack's nodes, and stops them reaching the Suite's nodes at all.
   Both directions, one pass, no renaming. */
const ROOT_CLASS = "lvc-root";

/* Not everything this node draws lives inside the node. The reader panel and
   the help panel hang off document.body so the canvas cannot clip them, which
   means they are not descendants of the root and a descendant-scoped rule
   never reaches them. They carry the scope class themselves instead, and the
   rules that target them are joined to it rather than nested under it. */
const ROOT_LEVEL = [".lvp-wrap", ".lvr-panel", ".lvp-help", ".lsb-card", ".lsb-pnote", ".lsb-gzoom"];

function scopeCss(css, scope) {
  let out = "", sel = "", depth = 0, i = 0;
  while (i < css.length) {
    if (css.startsWith("/*", i)) {
      const end = css.indexOf("*/", i + 2);
      const stop = end === -1 ? css.length : end + 2;
      /* Comments are passed straight through and never join the pending
         selector: the prose in them contains commas, and the split below
         would tear a rule in half on one. */
      out += css.slice(i, stop);
      i = stop;
      continue;
    }
    const ch = css[i];
    if (depth === 0 && ch === "{") {
      out += sel.replace(/(^|,)([^,{]+)/g, (m, lead, one) => {
        const t = one.trim();
        if (!t || t.startsWith("@")) return m;
        /* an element that carries the scope class itself is not a descendant
           of it: .lvr-panel becomes .lvc-root.lvr-panel, everything else
           becomes .lvc-root <selector> */
        const atRoot = ROOT_LEVEL.some(r => t === r || t.startsWith(r + " ")
                                         || t.startsWith(r + ":") || t.startsWith(r + "."));
        return lead + "." + scope + (atRoot ? "" : " ") + t;
      });
      out += ch; depth = 1; i++; continue;
    }
    if (depth > 0) {
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      out += ch; i++;
      if (depth === 0) sel = "";
      continue;
    }
    sel += ch; i++;
  }
  return out + sel;
}

app.registerExtension({
  name: "leiel.prompt.composer",

  async setup() {
    if (!document.getElementById("leiel-vpc-css")) {
      const st = document.createElement("style");
      st.id = "leiel-vpc-css";
      st.textContent = scopeCss(CSS, ROOT_CLASS);
      document.head.appendChild(st);
    }
  },

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "LeielPromptComposer"
        && nodeData.name !== "LeielSeriesBook") return;
    /* The Series Book is this same editor with a book on top: every prompt of
       a series kept as capsules, one prompt open in the sections below at a
       time. Sharing the editor rather than copying it is what keeps the two in
       step - anything added to the Composer arrives in the Book for free. */
    const BOOK = nodeData.name === "LeielSeriesBook";

    const orig = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      orig?.apply(this, arguments);
      const node = this;

      /* A Book saved with a different list of outputs keeps that list when
         the workflow loads, because the saved one wins. Outputs added since
         go on at the end, where nothing already wired is moved; outputs taken
         away since (open series name) come off the end, with their wires. */
      if (BOOK) setTimeout(() => {
        try {
          const names = nodeData.output_name || [];
          const types = nodeData.output || [];
          for (let i = (node.outputs || []).length; i < names.length; i++) {
            node.addOutput(names[i], types[i] || "STRING");
          }
          for (let i = (node.outputs || []).length - 1; i >= names.length; i--) {
            node.removeOutput(i);
          }
          /* and the find and replace inputs, which only the Composer keeps */
          for (let i = (node.inputs || []).length - 1; i >= 0; i--) {
            const n = node.inputs[i] && node.inputs[i].name;
            if (n === "find_text" || n === "replace_text") node.removeInput(i);
          }
          node.setDirtyCanvas?.(true, true);
        } catch (e) { /* ignore */ }
      }, 0);

      setTimeout(() => {
        const w = node.widgets?.find(x => x.name === "layout_json");
        if (w) {
          /* Taking no room is not the same as not being drawn: the canvas
             still paints a widget in its slot, and the Book's widgets used to
             be painted over it by the ones that followed. With none following,
             it has to be told not to draw at all. */
          w.type = "leiel-hidden";
          w.hidden = true;
          w.computeSize = () => [0, -4];
          w.draw = () => {};
          w.drawWidget = () => {};
          if (w.element) w.element.style.display = "none";
          node.setDirtyCanvas(true, true);
        }
      }, 0);

      psLoad();                     // the library, read once per session
      snapLoad();                   // and the snapshots beside it

      let gripDragging = false;
      /* Whether effects are drawn at all. Marks live in the sections either
         way; this only decides whether they are shown. */
      const state = { sections: [], fx: true, trTo: "en", trUnit: "sent",
                      reader: null };
      node._leielPrompt = state;
      /* The Series Book's own document: capsules and the prompts made of them.
         Null on a plain Composer, and every book path checks BOOK first. */
      let book = null;
      if (BOOK) node.leielBook = () => book;
      /* the anchor check, for the Series Lab to read a sweep's takes with */
      if (BOOK) { node.leielCheck = anchorCheck; node.leielShape = latentShape; node.leielCapNos = capNumbers; node.leielCapFor = capOfWords; node.leielUseWords = useWords; node.leielPutOne = putOne;
        node.leielKeepWords = async (kind, name, text, src) => { const r = await keepWords(kind, name, text, src); say(r.msg, r.ok ? undefined : "err"); return r; }; }
      /* A Series Lab on the "series" wire sets a series' colour here, so the
         book and the shelf show the same series in the same colour. */
      /* The Series Lab sets a prompt's frame from its queue too. */
      if (BOOK) node.leielSetPromptOrient = (pid, orient) => {
        const q = book && book.prompts.find(x => x.id === Number(pid));
        if (!q || !ORIENTS.includes(orient)) return false;
        if (orientOf(q) === orient) return true;
        if (orient === "all") delete q.orient; else q.orient = orient;
        touch(); save();
        paintBook(true);
        return true;
      };
      if (BOOK) node.leielSetSeriesHue = (uid, hue) => {
        const g = book && book.groups.find(x => x.uid === uid);
        const h = Number.isInteger(hue) && SERIES_TONES[hue] ? hue : null;
        if (!g || g.hue === h) return;
        g.hue = h;
        touch(); save();
      };

      let ready = false;       // nothing saves before the stored layout loads
      /* A multi-section reading outlives the DOM it was started from: every
         answer re-renders the node, so the button and the note the run began
         with are gone by the second step. The run lives here instead, and each
         fresh render reads it to draw the progress and the stop button. */
      let readRun = null;
      /* and what the run had to say when it ended, for the same reason */
      let readNote = null;
      let userTouched = false;  // tells a deliberate wipe from an undo wipe
      const touch = () => { userTouched = true; };

      /* ---------- DOM ---------- */
      /* ComfyUI pastes copied nodes when a paste reaches the canvas, and it
         only steps aside for inputs and textareas. The section box is a
         contenteditable div, so it was not recognised as somewhere text could
         be going: the words landed in the box and the nodes copied an hour ago
         landed on the graph beside it.

         One listener on the node's root catches every field inside it - the
         boxes, the title, find and replace, the reader panel - and stops the
         event there. The listeners deeper in have already run by then, and the
         browser still performs the paste, because stopping propagation is not
         the same as preventing what the event was for. */
      const root = document.createElement("div");
      root.className = "lvp-wrap " + ROOT_CLASS + (BOOK ? " is-book" : "");
      root.addEventListener("paste", e => e.stopPropagation());
      /* In the Book the toolbar sits under the book, right above the sections
         it works on: everything on it - reading, styling, search, the heights
         - belongs to the open prompt's anchors, not to the book. */
      root.innerHTML = `
        ${BOOK ? `<div class="lsb-left"><div class="lsb-book"></div><div class="lsb-book lsb-drbook lsb-drunder"></div></div><div class="lsb-split" title="Drag to share the width between the book and the anchors - double click for the default"></div><div class="lsb-side"><div class="lsb-book lsb-drbook lsb-drside"></div><div class="lsb-now"></div>` : ""}
        <div class="lvp-bar">
          <button class="lvp-btn reader" title="Which model reads your images, and how">Reader</button>
          <button class="lvp-btn fxb" title="Show every mark, and colour the structure. Press again to read the plain text - nothing is lost either way">Style</button>
          <button class="lvp-btn brush" title="Format brush - click styled text to pick its formatting up, then drag over other text to apply it. Escape puts it down"><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M10.6 1.9a2.2 2.2 0 0 1 3.1 3.1l-1.4 1.4 .7 .7-1.1 1.1-.7-.7-4.6 4.6-2.9 .8 .8-2.9 4.6-4.6-.7-.7 1.1-1.1 .7 .7z" fill="currentColor"/><circle class="drop" cx="3.2" cy="12.8" r="1.6" fill="currentColor"/></svg></button>
          <span class="lvp-sep"></span>
          <button class="lvp-btn add" title="Add a section">+</button>
          <button class="lvp-btn paste" title="${BOOK
            ? "Paste a whole reply - a scene name and its labelled anchors (POSE, SCENE, CAMERA...). A new name becomes a new prompt, a name already in the book updates that prompt. Ctrl+V with the pointer over the node does the same"
            : "Paste a whole reply - a scene name and its labelled anchors (POSE, SCENE, CAMERA...) - and each anchor lands in its own section. Ctrl+V with the pointer over the node does the same"}">Paste</button>
          <button class="lvp-btn find" title="Search, replace, and style every hit">Search</button>
          <button class="lvp-btn save" title="Layout snapshots - save and restore">Save</button>
          <span class="lvp-sep"></span>
          <button class="lvp-btn even" title="Give every section the same height">Even</button>
          <button class="lvp-btn fit" title="Size every section to the text it holds - no scrollbar, no empty space">Fit</button>
          <button class="lvp-btn compact" title="Shrink every section - press again to restore">Min</button>
          <span class="lvp-sep"></span>
          <button class="lvp-btn hundo" title="Undo the last change in this node (Ctrl+Z)">Undo</button>
          <button class="lvp-btn hredo" title="Redo (Ctrl+Shift+Z)">Redo</button>
          <span style="flex:1"></span>
        </div>
        <div class="lvp-list"></div>
        ${BOOK ? `</div>` : ""}
        <div class="lvp-foot">
          <span class="lvp-foot-txt"></span>
          <span class="lvp-msg"></span>
          <span style="flex:1"></span>
          <button class="lvp-btn help" title="What this node does">?</button>
        </div>`;

      for (const ev of ["pointerdown", "mousedown", "wheel", "contextmenu"]) {
        root.addEventListener(ev, e => e.stopPropagation());
      }

      const list = root.querySelector(".lvp-list");
      const foot = root.querySelector(".lvp-foot");
      if (BOOK) {
        root.querySelector(".lsb-now").addEventListener("click", (e) => {
          if (e.target.closest(".nm, input, .nowpaste, .nowlay")) return;     // the name renames
          setAnchorsOpen(!anchorsOpen());
        });
      }

      /* ---------- undo, for this node only ----------
         ComfyUI's own Ctrl+Z undoes a step of the whole graph, which pulls the
         node back to an older size and layout before it settles - jarring, and
         far more than was asked for. This keeps a stack of just the sections,
         recorded from save() so every path that changes anything is covered
         without each one having to remember. Bursts inside a second collapse
         into one step, or a sentence would come back one keystroke at a time. */
      const HIST_MAX = 80, HIST_MERGE_MS = 900;
      let hist = [], fut = [], lastShot = null, lastShotAt = 0, restoring = false;

      /* What one undo step holds. In the Book a step has to cover the whole
         book - a capsule placed, a prompt switched, a replace across every
         prompt - so the book is the record and the sections are rebuilt from
         it. The open sections have already been written into it by save(). */
      function shotOf() {
        if (BOOK) { writeBack(); return JSON.stringify(book); }
        return JSON.stringify(state.sections);
      }

      function recordHistory() {
        const now = shotOf();
        if (now === lastShot) return;
        if (lastShot !== null) {
          const t = Date.now();
          /* a burst of keystrokes keeps the entry it started from */
          if (!(t - lastShotAt < HIST_MERGE_MS && hist.length)) {
            hist.push(lastShot);
            if (hist.length > HIST_MAX) hist.shift();
          }
          lastShotAt = t;
          fut.length = 0;
        } else {
          lastShotAt = Date.now();
        }
        lastShot = now;
      }

      function applyShot(json) {
        restoring = true;
        try {
          /* An undo swaps in fresh section objects. Anything still holding the
             old one - the preset panel, the selection palette - would be
             writing into a copy nobody can see, so it is closed first. */
          hideMarkBar();
          root.querySelector(".lvp-panel")?.remove();
          if (BOOK) restoreFrom({ book: JSON.parse(json) }, null);
          else restoreFrom({ sections: JSON.parse(json) }, null);
          lastShot = shotOf();
          lastShotAt = 0;
          save();
        } finally { restoring = false; }
        /* The section list itself may have changed shape - the scope menu is
           rebuilt before the hits are painted again. */
        findState?.rescope?.();
        findState?.refresh?.();
        refreshToolbar();
      }

      function undoStep() {
        if (!hist.length) return;
        fut.push(shotOf());
        applyShot(hist.pop());
      }

      function redoStep() {
        if (!fut.length) return;
        hist.push(shotOf());
        applyShot(fut.pop());
      }

      /* ---------- persistence ---------- */
      const save = () => {
        if (!ready) return;
        const w = node.widgets?.find(x => x.name === "layout_json");
        if (!w) return;
        if (!userTouched && !state.sections.length && w.value) {
          try {
            const prev = JSON.parse(w.value);
            if (prev.sections?.length) { restoreFrom(prev, "recovered"); return; }
          } catch (e) { /* unreadable, fall through */ }
        }
        if (BOOK) writeBack();
        if (!restoring) recordHistory();
        /* Search hits are a viewing aid, not part of the document - strip them
           out of anything that gets written down. */
        const clean = state.sections.map(x => (x.html || "").includes("m-find")
          ? { ...x, html: stripFind(x.html) }
          : x);
        const doc = { sections: clean, fx: state.fx, trTo: state.trTo,
                      trUnit: state.trUnit, reader: state.reader };
        if (BOOK) doc.book = book;
        w.value = JSON.stringify(doc);
        snapPush(clean, "auto");
        if (BOOK) { paintBook(); scheduleSeriesSave(); }
        /* every change can now be undone - say so on the button at once */
        refreshToolbar();
      };

      function stripFind(html) {
        return String(html || "").replace(/\s*m-find\b/g, "")
          .replace(/<span class="">([^<]*)<\/span>/g, "$1");
      }

      /* ---------- the Series Book ----------
         A series is mostly the same words. Quality and Subject are written
         once and carried by every scene; Pose, Scene and Camera change. Ten
         Composers held ten copies of the shared parts, so changing a coat
         meant opening ten nodes, and missing one put two coats in the series.

         The Book keeps each anchor once, as a capsule, and a prompt is a list
         of capsules. Prompts that share a capsule share the text itself, not a
         copy of it: edit it in one and every prompt using it has changed.
         To change one prompt only, give it a different capsule.

         book = { seq, caps: {id: {id, kind, name, sec}}, prompts: [{id, name,
                  caps: [capsule ids, in section order]}], active, shelf }

         The open prompt is drawn into state.sections, so everything the editor
         can do it does here unchanged. save() writes the sections back into
         their capsules before anything is stored. */
      let bookFind = null;          // what the search found across the book
      let armedDel = null;          // a capsule or series waiting for its second click
      let armedTimer = 0;
      /* A delete waiting for its second click lets go after four seconds,
         on a click anywhere else in the node, or on Escape - a stray first
         click never leaves a button armed. The repaint waits a tick so the
         click that let go still reaches what it was aimed at. */
      function armDel(v) {
        armedDel = v;
        clearTimeout(armedTimer);
        armedTimer = setTimeout(disarmDel, 4000);
        paintBook();
      }
      function disarmDel() {
        clearTimeout(armedTimer);
        if (armedDel === null) return;
        armedDel = null;
        setTimeout(() => { if (armedDel === null) paintBook(); }, 0);
      }
      root.addEventListener("click", (e) => {
        if (armedDel !== null && !e.target.closest(".armed")) disarmDel();
      }, true);
      root.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && armedDel !== null) disarmDel();
      }, true);
      let lastPanelH = 0;

      /* Several series can live in one book, each a group of prompts with
         its own number: prompt 3 of series 2 is 2-03. Every capsule belongs
         to exactly one series. Prompts of the same series share capsules as
         before; a capsule taken into another series arrives there as a copy,
         so working on a new series can never reach back and change a
         finished one. */
      function bookNew() {
        return { v: 2, seq: 0, caps: {}, prompts: [], groups: [], active: 0,
                 shelf: true, shelfView: null, ui: { hue: 0, light: 0.22 } };
      }
      /* The book's colours: each a step darker and greyer than the section
         colours, so the book sits behind the anchors instead of beside them. */
      const BOOK_HUES = [
        ["teal", "#2f6f73"], ["slate", "#46596f"], ["moss", "#52633a"],
        ["umber", "#6e4f2e"], ["wine", "#6c2f40"], ["indigo", "#43437e"],
        ["graphite", "#4e4e52"],
      ];
      const SPLIT_DEFAULT = 0.53;
      function bookUi() {
        const u = (book && book.ui) || {};
        const hue = Number.isInteger(u.hue) && u.hue >= 0 && u.hue < BOOK_HUES.length ? u.hue : 0;
        const light = Number.isFinite(Number(u.light)) ? Math.max(0, Math.min(1, Number(u.light))) : 0.22;
        const trTo = typeof u.trTo === "string" && TR_LANGS.some(x => x[0] === u.trTo) && u.trTo !== "en"
          ? u.trTo : null;
        const split = Number.isFinite(Number(u.split)) && u.split !== null
          ? Math.max(0.25, Math.min(0.75, Number(u.split))) : SPLIT_DEFAULT;
        const d = (u.dr && typeof u.dr === "object") ? u.dr : {};
        const dr = { open: !!d.open, kind: DRAWER_KINDS.includes(d.kind) || d.kind === "now" ? d.kind : "all",
                     /* the tags picked - several at once, each narrowing the cards
                        further; a single tag from before reads as a list of one */
                     /* the folder on show: null for every card, "" for those in no folder */
                     folder: typeof d.folder === "string" ? d.folder : null,
                     tag: (Array.isArray(d.tag) ? d.tag : (typeof d.tag === "string" && d.tag ? [d.tag] : []))
                       .filter(t => typeof t === "string" && t),
                     size: Number.isFinite(Number(d.size)) ? Math.max(DRAWER_SIZE[0], Math.min(DRAWER_SIZE[1], Math.round(Number(d.size)))) : DRAWER_SIZE[2],
                     tone: Number.isInteger(Number(d.tone)) ? ((Number(d.tone) % DRAWER_TONES.length) + DRAWER_TONES.length) % DRAWER_TONES.length : 0,
                     side: !!d.side,
                     /* how tall the cards' window is, dragged from under the drawer */
                     h: Number.isFinite(Number(d.h)) && d.h !== null ? Math.max(80, Math.min(4000, Math.round(Number(d.h)))) : null };
        const gap = Number.isFinite(Number(u.gap)) && u.gap !== null
          ? Math.max(0, Math.min(PANEL_GAP_MAX, Math.round(Number(u.gap)))) : NOW_GAP;
        const kf = Array.isArray(u.kf) ? u.kf.filter(k => typeof k === "string") : [];
        return { hue, light, tr: !!u.tr, trTo, used: !!u.used, mine: !!u.mine, side: !!u.side, split, dr, gap, kf };
      }
      /* The drawer's own view - open or folded, which kind, which tag - is
         kept with the book like the rest of its look. */
      /* ---- the drawer's folders ----
         Laid out like a file window: folders and loose cards at the top,
         double click a folder to go in, the path above to come back out.
         Cards picked with Ctrl or Shift are dragged together. */
      function wireFolders(drw) {
        const folders = () => drawerStore.folders || [];
        const inline = (anchor, value, place, done) => {
          const inp = document.createElement("input");
          inp.className = "lsb-dfin";
          inp.value = value;
          inp.placeholder = place;
          anchor.replaceWith(inp);
          inp.focus(); inp.select();
          let over = false;
          const finish = (ok) => { if (over) return; over = true; done(ok ? inp.value.replace(/\s+/g, " ").trim() : null); };
          inp.addEventListener("keydown", (ev) => {
            ev.stopPropagation();
            if (ev.key === "Enter") { ev.preventDefault(); finish(true); }
            if (ev.key === "Escape") { ev.preventDefault(); finish(false); }
          });
          inp.addEventListener("blur", () => finish(true));
          inp.addEventListener("pointerdown", (ev) => ev.stopPropagation());
          inp.addEventListener("dblclick", (ev) => ev.stopPropagation());
        };
        const dropIds = (e) => {
          const many = e.dataTransfer.getData(DT_DRAWER_MANY);
          const one = e.dataTransfer.getData(DT_DRAWER);
          return (many ? many.split(",") : one ? [one] : []).filter(Boolean);
        };
        const moveInto = (ids, f) => {
          const set = new Set(ids);
          /* a folder takes only its own kind */
          const fits = (i) => set.has(i.id) && (!f || i.kind === fKind(f));
          const moved = drawerStore.items.filter(i => fits(i) && (i.folder || "") !== f).length;
          const other = drawerStore.items.filter(i => set.has(i.id) && f && i.kind !== fKind(f)).length;
          if (!moved) {
            say(other ? `a ${KIND_LABEL[fKind(f)].toLowerCase()} folder takes only ${KIND_LABEL[fKind(f)].toLowerCase()} cards`
              : f ? `already in ${fName(f)}` : "already at the top of the drawer", other ? "err" : undefined);
            return;
          }
          drSel.clear(); drSelAt = null;
          drawerWrite(drawerStore.items.map(i => fits(i) ? { ...i, folder: f } : i));
          say(`${moved} card${moved === 1 ? "" : "s"} ${f ? `moved into ${fName(f)}` : "taken out to the top of the drawer"}`
            + (other ? ` - ${other} of another kind left where ${other === 1 ? "it was" : "they were"}` : ""));
        };
        const dropTarget = (el, f) => {
          el.addEventListener("dragover", (e) => {
            if (!e.dataTransfer.types.includes(DT_DRAWER)) return;
            e.preventDefault(); e.stopPropagation();
            el.classList.add("drop");
          });
          el.addEventListener("dragleave", () => el.classList.remove("drop"));
          el.addEventListener("drop", (e) => {
            const ids = dropIds(e);
            if (!ids.length) return;
            e.preventDefault(); e.stopPropagation();
            el.classList.remove("drop");
            moveInto(ids, f);
          });
        };
        const openFolder = (f) => {
          fMenu = null; fDelArmed = false;
          drSel.clear(); drSelAt = null;
          setDrawerUi({ folder: f || null, tag: [] });
        };
        const openMenu = (f) => {
          fMenu = fMenu === f ? null : f;
          fDelArmed = false;
          paintBook(true);
        };
        /* + card: a blank card, written by hand - for an anchor no scene
           has used yet. Its kind is the tab that is open (or the open
           folder's), its tags the ones picked; it goes into the open folder. */
        drw.querySelector(".lsb-df.newc")?.addEventListener("click", (e) => {
          e.stopPropagation();
          const dr = bookUi().dr;
          const kind = DRAWER_KINDS.includes(dr.kind) ? dr.kind
            : dr.folder && DRAWER_KINDS.includes(fKind(dr.folder)) ? fKind(dr.folder) : "subject";
          editDrawerItem(null, null, { kind, name: "", text: "", tags: (dr.tag || []).slice(), thumb: null });
        });
        drw.querySelector(".lsb-df.add:not(.newc)")?.addEventListener("click", (e) => {
          e.stopPropagation();
          const kind = bookUi().dr.kind;
          if (!DRAWER_KINDS.includes(kind)) { say("pick a kind first - Pose, Outfit... - each kind keeps its own folders", "err"); return; }
          inline(e.currentTarget, "", `${KIND_LABEL[kind].toLowerCase()} folder name`, (v) => {
            if (!v) { paintBook(true); return; }
            const fs = folders();
            const key = fKey(kind, v);
            if (fs.includes(key)) { say(`there is already a ${KIND_LABEL[kind].toLowerCase()} folder "${v}"`, "err"); paintBook(true); return; }
            drawerWrite(drawerStore.items, [...fs, key]);
            say(`${KIND_LABEL[kind].toLowerCase()} folder "${v}" made - click it to go in; cards kept while it is open go into it`);
          });
        });
        const root = drw.querySelector(".lsb-dcr.root");
        if (root) {
          root.addEventListener("click", (e) => { e.stopPropagation(); if (bookUi().dr.folder) openFolder(null); });
          dropTarget(root, "");
        }
        const cur = drw.querySelector(".lsb-dcr.cur");
        if (cur) cur.addEventListener("contextmenu", (e) => { e.preventDefault(); e.stopPropagation(); openMenu(cur.dataset.f); });
        for (const el of drw.querySelectorAll(".lsb-dfold")) {
          const f = el.dataset.f;
          el.addEventListener("click", (e) => { e.stopPropagation(); openFolder(f); });
          el.addEventListener("contextmenu", (e) => { e.preventDefault(); e.stopPropagation(); openMenu(f); });
          dropTarget(el, f);
        }
        /* A box dragged across the empty part of the grid picks every card
           it touches - Ctrl held takes them out of the pick instead. Read in
           screen space, so the canvas zoom does not shift it. */
        const grid = drw.querySelector(".lsb-dgrid");
        if (grid && !drw.querySelector(".lsb-dnow")) {
          grid.addEventListener("pointerdown", (e) => {
            if (e.button !== 0 || e.target.closest(".lsb-dc, .lsb-dfold, input")) return;
            e.preventDefault(); e.stopPropagation();
            const sub = e.ctrlKey || e.metaKey, add = e.shiftKey;
            const base = new Set(drSel);
            const x0 = e.clientX, y0 = e.clientY;
            let box = null;
            const cards = [...grid.querySelectorAll(".lsb-dc:not(.now)")].filter(c => c.offsetParent);
            const move = (ev) => {
              if (!box) {
                if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
                box = document.createElement("div");
                box.className = "lsb-dmarq" + (sub ? " sub" : "");
                document.body.appendChild(box);
              }
              const l = Math.min(x0, ev.clientX), t = Math.min(y0, ev.clientY);
              const r = Math.max(x0, ev.clientX), b = Math.max(y0, ev.clientY);
              Object.assign(box.style, { left: l + "px", top: t + "px", width: (r - l) + "px", height: (b - t) + "px" });
              drSel.clear();
              if (sub || add) for (const id of base) drSel.add(id);
              for (const c of cards) {
                const q = c.getBoundingClientRect();
                const hit = q.left < r && q.right > l && q.top < b && q.bottom > t;
                if (hit) { if (sub) drSel.delete(c.dataset.id); else drSel.add(c.dataset.id); }
              }
              for (const c of cards) c.classList.toggle("sel", drSel.has(c.dataset.id));
            };
            const up = () => {
              window.removeEventListener("pointermove", move, true);
              window.removeEventListener("pointerup", up, true);
              if (box) { box.remove(); paintBook(true); }
              else if (drSel.size && !sub && !add) { drSel.clear(); drSelAt = null; paintBook(true); }
            };
            window.addEventListener("pointermove", move, true);
            window.addEventListener("pointerup", up, true);
          });
        }
        drw.querySelector(".clrsel")?.addEventListener("click", (e) => {
          e.stopPropagation(); drSel.clear(); drSelAt = null; paintBook(true);
        });
        const menu = drw.querySelector(".lsb-dfm");
        if (menu && fMenu !== null) {
          const f = fMenu;
          menu.querySelector(".ren").addEventListener("click", (e) => {
            e.stopPropagation();
            inline(menu.querySelector("b"), fName(f), "folder name", (v) => {
              const nk = v ? fKey(fKind(f), v) : null;
              if (!v || nk === f) { paintBook(true); return; }
              const fs = folders();
              if (fs.includes(nk)) { say(`there is already a folder "${v}"`, "err"); paintBook(true); return; }
              drawerWrite(drawerStore.items.map(i => i.folder === f ? { ...i, folder: nk } : i),
                fs.map(x => x === f ? nk : x));
              fMenu = nk;
              if (bookUi().dr.folder === f) setDrawerUi({ folder: nk }); else paintBook(true);
              say(`folder "${fName(f)}" is "${v}" now`);
            });
          });
          const ta = menu.querySelector(".tagall");
          ta.addEventListener("pointerdown", (e) => e.stopPropagation());
          ta.addEventListener("keydown", (e) => {
            e.stopPropagation();
            if (e.key === "Escape") { fMenu = null; paintBook(true); return; }
            if (e.key !== "Enter") return;
            e.preventDefault();
            const t = ta.value.replace(/\s+/g, " ").trim();
            if (!t) return;
            let n = 0;
            drawerWrite(drawerStore.items.map(i => {
              if (i.folder !== f || (i.tags || []).includes(t)) return i;
              n++;
              return { ...i, tags: [...(i.tags || []), t] };
            }));
            say(n ? `"${t}" added to ${n} card${n === 1 ? "" : "s"} in ${fName(f)}` : `every card in ${fName(f)} has "${t}" already`);
            ta.value = "";
          });
          menu.querySelector(".del").addEventListener("click", (e) => {
            e.stopPropagation();
            if (!fDelArmed) { fDelArmed = true; paintBook(true); return; }
            drawerWrite(drawerStore.items.map(i => i.folder === f ? { ...i, folder: "" } : i),
              folders().filter(x => x !== f));
            fMenu = null; fDelArmed = false;
            if (bookUi().dr.folder === f) setDrawerUi({ folder: null }); else paintBook(true);
            say(`folder "${fName(f)}" deleted - its cards are at the top of the drawer now`);
          });
          menu.querySelector(".cls").addEventListener("click", (e) => { e.stopPropagation(); fMenu = null; fDelArmed = false; paintBook(true); });
        }
      }

      function setDrawerUi(patch) {
        if (!book) return;
        book.ui = { ...bookUi(), dr: { ...bookUi().dr, ...patch } };
        save();
        paintBook();
        requestAnimationFrame(fitNodeToContent);
      }
      function applyBookLook(host) {
        const u = bookUi();
        host.style.setProperty("--bk", BOOK_HUES[u.hue][1]);
        host.style.setProperty("--bl", String(u.light));
        const r = host.querySelector(".lsb-light");
        if (r) r.style.setProperty("--pct", Math.round(u.light * 100) + "%");
      }
      function bookId() { return ++book.seq; }
      function newUid() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      }

      /* ---- series ---- */
      function groupById(gid) { return book.groups.find(g => g.id === gid) || null; }
      function groupOf(p) { return p ? groupById(p.g) : null; }
      function activeGroup() { return groupOf(activePrompt()) || book.groups[0] || null; }
      function promptsOf(g) { return g ? book.prompts.filter(p => p.g === g.id) : []; }
      function capsOf(g) { return g ? Object.values(book.caps).filter(c => c.g === g.id) : []; }
      /* What a series is now, in a few characters: its name, note, picture
         and every prompt with its anchors. Saved with the series when it is
         written to a book file, so the save icon can show what changed since. */
      function groupSig(g) {
        if (!g) return "";
        const parts = [g.name, g.note || "", g.memo || "", g.memoHtml || "", g.memoLead || "", g.thumb ? g.thumb.length : 0];
        for (const p of promptsOf(g)) {
          parts.push(p.name, p.note || "", p.thumb ? p.thumb.length : 0, p.orient || "");
          for (const cid of p.caps) {
            const c = book.caps[cid];
            if (c) parts.push(c.kind, c.name, c.sec.on === false ? 0 : 1, String(c.sec.text || "").trim());
          }
        }
        const str = JSON.stringify(parts);
        let h1 = 5381, h2 = 52711;
        for (let i = 0; i < str.length; i++) {
          const ch = str.charCodeAt(i);
          h1 = (h1 * 33) ^ ch; h2 = (h2 * 33) ^ ch;
        }
        return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36) + "." + str.length.toString(36);
      }
      const unsaved = (g) => !!g && g.savedSig !== groupSig(g);
      function newGroup(name) {
        const no = Math.max(0, ...book.groups.map(g => Number(g.no) || 0)) + 1;
        const g = { id: bookId(), no, name: String(name || `Series ${no}`),
                    uid: newUid(), nextNo: 1, open: true };
        book.groups.push(g);
        return g;
      }
      /* A prompt's number is given once, when it is made, and never reused:
         delete 1-04 and the next prompt of that series is still 1-11, so a
         number always says how far into its series a scene was made. */
      function nextNo(g) {
        g = g || activeGroup();
        g.nextNo = Math.max(Number(g.nextNo) || 1,
          ...promptsOf(g).map(q => (Number(q.no) || 0) + 1));
        return g.nextNo++;
      }
      const pad2 = (n) => String(n || 0).padStart(2, "0");
      /* Every capsule's number as the shelf writes it - "02-1", or "1-02-1"
         with several series - and a key to order them by, for the Series
         Lab to show the same numbers in its sweep. */
      /* Which capsule holds these words, for the Image Viewer: it reads the
         anchors back out of a picture and shows each one's number from the
         book, so a render can be read by number as the shelf is. The words
         must be the capsule's own - one edited since the render is not the
         one the picture was made with, and gets no number. Several capsules
         with the same words (a copy in another series) - the open series',
         then the one of that kind, then the first. */
      function capOfWords(kind, text) {
        if (!book) return null;
        const norm = (t) => String(t || "").replace(/\s+/g, " ").trim().toLowerCase();
        const want = norm(text);
        if (!want) return null;
        const nos = capNumbers();
        const ag = activeGroup();
        const k = String(kind || "").toLowerCase();
        const hits = Object.values(book.caps).filter(c => nos[c.id] && norm(c.sec.text) === want);
        if (!hits.length) return null;
        const score = (c) => (ag && c.g === ag.id ? 0 : 2) + (c.kind === k ? 0 : 1);
        hits.sort((a, b) => score(a) - score(b) || nos[a.id].key - nos[b.id].key);
        const c = hits[0];
        /* "+" as on the shelf, for a capsule more than one prompt uses */
        const uses = book.prompts.filter(q => q.caps.includes(c.id)).length;
        return { id: c.id, label: nos[c.id].label + (uses > 1 ? "+" : ""), kind: c.kind, name: c.name,
                 hue: KIND_HUE[c.kind] || KIND_HUE.other };
      }
      /* ---------- a capsule's number, for good ----------
         A capsule is numbered once, by the prompt it was first written for -
         series, prompt, and which try at that layer - and keeps that number
         wherever it is used afterwards. Taken into another prompt or another
         series, copied, left unused: "4 | 03-2" still says it was the second
         try at that layer of prompt 03 in series 4. Kept as numbers, not ids,
         so it survives series files and moves. */
      function cleanBorn(b) {
        if (!b || typeof b !== "object") return null;
        const no = Number(b.no), seq = Number(b.seq), sno = Number(b.sno);
        if (!(no > 0) || !(seq > 0)) return null;
        return { sg: typeof b.sg === "string" ? b.sg : "", sno: sno > 0 ? sno : 0, no, seq };
      }
      function stampOne(c, usedFirst) {
        if (!c || c.born || !String(((c.sec || {}).text) || "").trim()) return;
        let q = usedFirst;
        if (q === undefined) q = orderedPrompts().find(x => x.caps.includes(c.id)) || null;
        if (!q && c.was) q = book.prompts.find(x => x.g === c.g && x.no === c.was) || null;
        if (!q) return;
        const g = groupOf(q);
        if (!g) return;
        let seq = 0;
        for (const o of Object.values(book.caps)) {
          if (o.born && o.kind === c.kind && o.born.sg === g.uid && o.born.no === q.no) seq = Math.max(seq, o.born.seq);
        }
        c.born = { sg: g.uid, sno: g.no, no: q.no, seq: seq + 1 };
      }
      /* A prompt given a new number - renumbered, or moved to another series -
         takes the capsules first written for it along: their number follows
         the prompt, so "03-2" still names prompt 03's second try after 03
         has become 05. Every capsule that says where it came from is told. */
      function rebirth(moves) {
        if (!moves.length) return;
        stampBirths();
        const key = (sg, no) => sg + "|" + no;
        const to = new Map(moves.map(m => [key(m.fromSg, m.fromNo), m]));
        for (const c of Object.values(book.caps)) {
          const m = c.born && to.get(key(c.born.sg, c.born.no));
          if (m) c.born = { ...c.born, sg: m.toSg, sno: m.toSno, no: m.toNo };
        }
      }
      function stampBirths() {
        if (!book) return;
        const first = new Map();
        for (const q of orderedPrompts()) for (const cid of q.caps) if (!first.has(cid)) first.set(cid, q);
        for (const c of Object.values(book.caps).sort((a, b) => a.id - b.id)) {
          if (!c.born) stampOne(c, first.get(c.id) || null);
        }
      }
      /* what the number says, read now: the series by its colour if it is
         still in the book, its number as it was if not */
      function bornOf(c) {
        const b = c && c.born;
        if (!b) return null;
        const g = book.groups.find(x => x.uid === b.sg) || null;
        const multi = Object.values(book.caps).some(o => o !== c && o.born && o.kind === c.kind
          && o.born.sg === b.sg && o.born.no === b.no && o.born.seq !== b.seq);
        return { g, sno: g ? g.no : b.sno, no: b.no, seq: b.seq, multi };
      }
      function bornLabel(c, withSeries) {
        const r = bornOf(c);
        if (!r) return "";
        return (withSeries ? `${r.sno}-` : "") + pad2(r.no) + (r.multi || r.seq > 1 ? `-${r.seq}` : "");
      }
      function capNumbers() {
        const out = {};
        if (!book) return out;
        stampBirths();
        const many = book.groups.length > 1;
        for (const c of Object.values(book.caps)) {
          const r = bornOf(c);
          if (!r) continue;
          const own = groupById(c.g);
          out[c.id] = { label: bornLabel(c, many || !own || own.uid !== c.born.sg),
                        key: r.sno * 1e6 + r.no * 1e3 + r.seq };
        }
        return out;
      }
      function numOf(p) {
        const g = groupOf(p);
        return `${g ? g.no : 0}-${pad2(p.no)}`;
      }
      function activePrompt() {
        if (!book) return null;
        return book.prompts.find(p => p.id === book.active) || book.prompts[0] || null;
      }
      /* Prompts in the order they are shown: series by series. */
      function orderedPrompts() {
        const out = [];
        for (const g of book.groups) out.push(...promptsOf(g));
        return out;
      }
      const sameText = (a, b) =>
        String(a || "").replace(/\s+/g, " ").trim() === String(b || "").replace(/\s+/g, " ").trim();

      /* What a capsule keeps of a section: everything but the bookkeeping that
         only means something on screen. */
      function secOf(s) {
        const o = {};
        for (const k of Object.keys(s)) {
          if (k === "id" || k === "slot" || k === "_cap") continue;
          o[k] = s[k];
        }
        if (o.html && o.html.includes("m-find")) o.html = stripFind(o.html);
        return JSON.parse(JSON.stringify(o));
      }

      /* Names are kept apart within a series; two series may each have a
         "Scene", and their numbers tell them apart. */
      function uniquePromptName(base, g, except) {
        g = g || activeGroup();
        const taken = new Set(promptsOf(g).filter(p => p !== except)
          .map(p => p.name.trim().toLowerCase()));
        const stem = String(base || "Scene").trim() || "Scene";
        if (!taken.has(stem.toLowerCase())) return stem;
        for (let i = 2; i < 999; i++) {
          if (!taken.has(`${stem} ${i}`.toLowerCase())) return `${stem} ${i}`;
        }
        return stem;
      }

      function uniqueCapName(kind, base, gid) {
        const taken = new Set(Object.values(book.caps)
          .filter(c => c.kind === kind && c.g === gid && String(c.sec.text || "").trim())
          .map(c => c.name.trim().toLowerCase()));
        const given = String(base || KIND_LABEL[kind] || "Capsule").trim();
        if (!taken.has(given.toLowerCase())) return given;
        /* a copy of "Name v2" is "Name v3", never "Name v2 v2" */
        const stem = given.replace(/\s+v\d+$/i, "").trim() || given;
        for (let i = 2; i < 999; i++) {
          if (!taken.has(`${stem} v${i}`.toLowerCase())) return `${stem} v${i}`;
        }
        return stem;
      }

      /* What a new capsule is called. The layers a series shares are named
         for what they are - "Subject", "Subject 2" for the hatless one - and
         the layers that make a scene are named for the scene they came from,
         which is how they are looked for later. Double click renames either. */
      const SHARED_KINDS = new Set(["trigger", "quality", "subject", "outfit"]);
      function newCap(kind, name, sec, gid, given) {
        const id = bookId();
        const g = gid || (activeGroup() || {}).id || 0;
        const base = given || (SHARED_KINDS.has(kind) ? KIND_LABEL[kind] : name);
        book.caps[id] = { id, kind, g, name: uniqueCapName(kind, base, g), sec };
        return id;
      }

      /* A capsule as it stands in a given series: itself when it is already
         that series' own, otherwise that series' copy of it - reusing one
         with the same words if the series already has it. */
      function capFor(cid, gid) {
        const c = book.caps[cid];
        if (!c || c.g === gid) return cid;
        const twin = Object.values(book.caps).find(x => x.g === gid && x.kind === c.kind
          && sameText(x.sec.text, c.sec.text));
        if (twin) return twin.id;
        const id = bookId();
        stampOne(c);
        book.caps[id] = { id, kind: c.kind, g: gid, name: uniqueCapName(c.kind, c.name, gid),
                          sec: JSON.parse(JSON.stringify(c.sec)),
                          /* a copy keeps where the words were first written */
                          ...(c.born ? { born: { ...c.born } } : {}) };
        return id;
      }

      function sanitizeBook(b) {
        if (!b || typeof b !== "object" || !b.caps || !Array.isArray(b.prompts)) return null;
        const out = { v: 2, seq: Number(b.seq) || 0, caps: {}, prompts: [], groups: [],
                      active: Number(b.active) || 0, shelf: b.shelf !== false,
                      anchors: b.anchors !== false,
                      shelfView: b.shelfView === "all" ? "all"
                        : (Number(b.shelfView) || (b.shelfAll ? "all" : null)),
                      ui: (b.ui && typeof b.ui === "object")
                        ? { hue: Number(b.ui.hue) || 0, light: Number(b.ui.light), tr: !!b.ui.tr,
                            trTo: typeof b.ui.trTo === "string" ? b.ui.trTo : null,
                            /* kept too, or they came back off after a reload */
                            used: !!b.ui.used, mine: !!b.ui.mine, side: !!b.ui.side,
                            ...(b.ui.dr && typeof b.ui.dr === "object" ? { dr: { ...b.ui.dr } } : {}),
                            ...(Number.isFinite(Number(b.ui.split)) && b.ui.split !== null ? { split: Number(b.ui.split) } : {}),
                            ...(Number.isFinite(Number(b.ui.gap)) && b.ui.gap !== null ? { gap: Number(b.ui.gap) } : {}),
                            ...(Array.isArray(b.ui.kf) ? { kf: b.ui.kf.filter(k => typeof k === "string") } : {}) }
                        : { hue: 0, light: 0.22 } };
        let max = 0;
        for (const g of (Array.isArray(b.groups) ? b.groups : [])) {
          const id = Number(g && g.id);
          if (!id || out.groups.some(x => x.id === id)) continue;
          out.groups.push({ id, no: Number(g.no) || out.groups.length + 1,
                            name: String(g.name || `Series ${out.groups.length + 1}`),
                            uid: typeof g.uid === "string" && g.uid ? g.uid : newUid(),
                            nextNo: Number(g.nextNo) || 1, open: g.open !== false,
                            hue: Number.isInteger(g.hue) && SERIES_TONES[g.hue] ? g.hue : null,
                            ...(typeof g.note === "string" && g.note.trim() ? { note: g.note } : {}),
                            ...(typeof g.memo === "string" && g.memo.trim() ? { memo: g.memo.slice(0, 20000) } : {}),
                            ...(typeof g.memo === "string" && g.memo.trim() && typeof g.memoHtml === "string" && g.memoHtml.length < 80000
                                ? { memoHtml: sanitizeMemo(g.memoHtml) } : {}),
                            ...(Number.isFinite(g.memoLead) && g.memoLead >= 80 && g.memoLead <= 300 ? { memoLead: Math.round(g.memoLead) } : {}),
                            ...(g.memoOpen === false ? { memoOpen: false } : {}),
                            ...(typeof g.thumb === "string" && /^data:image\//.test(g.thumb) && g.thumb.length < 400000 ? { thumb: g.thumb } : {}),
                            ...(typeof g.savedSig === "string" && g.savedSig.length < 40 ? { savedSig: g.savedSig } : {}) });
          max = Math.max(max, id);
        }
        for (const [k, c] of Object.entries(b.caps)) {
          if (!c || typeof c !== "object" || !c.sec || typeof c.sec !== "object") continue;
          const id = Number(c.id || k);
          if (!id) continue;
          out.caps[id] = {
            id,
            kind: KIND_HUE[c.kind] ? c.kind : kindOf(c.sec.title),
            g: Number(c.g) || 0,
            name: String(c.name || KIND_LABEL[c.kind] || "Capsule"),
            sec: c.sec,
            ...(Number.isInteger(c.was) && c.was > 0 ? { was: c.was } : {}),
            ...(cleanBorn(c.born) ? { born: cleanBorn(c.born) } : {}),
          };
          max = Math.max(max, id);
        }
        for (const p of b.prompts) {
          if (!p || typeof p !== "object") continue;
          const id = Number(p.id);
          if (!id) continue;
          const seen = new Set();
          const caps = (Array.isArray(p.caps) ? p.caps : []).map(Number)
            .filter(x => out.caps[x] && !seen.has(x) && seen.add(x));
          out.prompts.push({ id, name: String(p.name || "Prompt"), caps,
                             g: Number(p.g) || 0, fresh: !!p.fresh,
                             ...(String(p.note || "").trim() ? { note: String(p.note).slice(0, 4000) } : {}),
                             ...(typeof p.thumb === "string" && /^data:image\//.test(p.thumb) && p.thumb.length < 400000 ? { thumb: p.thumb } : {}),
                             no: Number.isInteger(p.no) && p.no > 0 ? p.no : 0,
                             ...(ORIENTS.includes(p.orient) && p.orient !== "all" ? { orient: p.orient } : {}) });
          max = Math.max(max, id);
        }
        if (!out.prompts.length) return null;
        out.seq = Math.max(out.seq, max);

        /* A book from before series: everything is series 1, numbered as
           it was. */
        if (!out.groups.length) {
          out.groups.push({ id: ++out.seq, no: 1, name: "Series 1", uid: newUid(),
                            nextNo: Number(b.nextNo) || 1, open: true });
        }
        const gids = new Set(out.groups.map(g => g.id));
        for (const p of out.prompts) if (!gids.has(p.g)) p.g = out.groups[0].id;
        /* a capsule belongs to the series of the first prompt that uses it */
        const owner = new Map();
        for (const p of out.prompts) for (const c of p.caps) if (!owner.has(c)) owner.set(c, p.g);
        for (const c of Object.values(out.caps)) {
          if (!gids.has(c.g)) c.g = owner.get(c.id) || out.groups[0].id;
        }
        /* and a prompt holds only its own series' capsules */
        for (const p of out.prompts) {
          p.caps = p.caps.map(cid => {
            const c = out.caps[cid];
            if (c.g === p.g) return cid;
            const twin = Object.values(out.caps).find(x => x.g === p.g && x.kind === c.kind
              && sameText(x.sec.text, c.sec.text));
            if (twin) return twin.id;
            const id = ++out.seq;
            out.caps[id] = { ...JSON.parse(JSON.stringify(c)), id, g: p.g };
            return id;
          });
        }
        /* numbers, per series */
        for (const g of out.groups) {
          const mine = out.prompts.filter(p => p.g === g.id);
          let top = Math.max(0, ...mine.map(q => q.no));
          for (const q of mine) if (!q.no) q.no = ++top;
          g.nextNo = Math.max(g.nextNo || 1, top + 1);
        }
        if (!out.prompts.some(p => p.id === out.active)) out.active = out.prompts[0].id;
        versionNames(out.caps);
        return out;
      }

      function stockTitle() {
        return String((node.constructor && node.constructor.title) || "").trim();
      }

      /* A first prompt for a series: the given sections, or the empty anchors.
         An empty start is "fresh": the first named reply pasted into it fills
         it rather than adding a second prompt beside a blank one. */
      function startPrompt(g, name, rows) {
        const p = { id: bookId(), g: g.id, no: nextNo(g), name, caps: [],
                    fresh: !(rows && rows.length) };
        book.prompts.push(p);
        const src = rows && rows.length ? rows
          : DEFAULT_SECTIONS.map(title => ({
              title, text: "", html: "", on: true,
              h: title === "LoRA Trigger" ? 46 : 90, extMode: "replace" }));
        for (const s of src) p.caps.push(newCap(kindOf(s.title), p.name, secOf(s), g.id));
        return p;
      }

      /* A layout with no book becomes a book of one prompt. */
      function bookFromSections(rows) {
        book = bookNew();
        const t = String(node.title || "").trim();
        const g = newGroup("Series 1");
        const p = startPrompt(g, (t && t !== stockTitle()) ? t : "Scene 1", rows);
        book.active = p.id;
        return book;
      }

      /* The open prompt as sections. The id is the capsule's, offset, so a
         section keeps the same id whichever prompt it is opened from - the
         picture's "read into" choices are stored by id and would otherwise be
         lost every time the prompt changed. */
      function sectionsFromBook() {
        const p = activePrompt();
        if (!p) return [];
        return p.caps.filter(cid => book.caps[cid]).map(cid => ({
          ...JSON.parse(JSON.stringify(book.caps[cid].sec)),
          id: 100000 + Number(cid),
          _cap: cid,
        }));
      }

      /* The open sections back into their capsules. A section with no
         capsule - just added with +, or a duplicate of one already here -
         gets a capsule of its own. */
      /* A variant: the capsule on the section stays exactly as it is, and the
         section goes on with a copy of it to edit - a second pose from the
         first, a closer camera from the wide one. Both end up on the shelf,
         ready for a sweep. */
      function makeVariant(s) {
        if (!BOOK || !book) return;
        writeBack();
        const p = activePrompt();
        const old = s._cap && book.caps[s._cap];
        if (!p || !old) return;
        if (!String(old.sec.text || "").trim()) {
          say("the box is empty - write it or read a picture into it first", "err");
          return;
        }
        const cid = newCap(old.kind, p.name, secOf(s), p.g, old.name);
        s._cap = cid;
        const at = p.caps.indexOf(old.id);
        if (at >= 0) p.caps[at] = cid;
        touch(); save();
        reopen();
        paintBook(true);
        say(`"${old.name}" stays on the shelf - editing its copy "${book.caps[cid].name}"`);
      }

      function writeBack() {
        if (!BOOK || !book) return;
        const p = activePrompt();
        if (!p) return;
        const seen = new Set();
        const ids = [];
        const kept = [];
        let changed = false;
        for (const s of state.sections) {
          let cid = s._cap;
          const sec = secOf(s);
          if (!cid || !book.caps[cid] || seen.has(cid)) {
            cid = newCap(kindOf(s.title), p.name, sec, p.g);
            s._cap = cid;
            changed = true;
          } else if (!String(sec.text || "").trim() && String(book.caps[cid].sec.text || "").trim()) {
            /* A section emptied - cleared to read a new picture into it, or
               to write another pose. The capsule it was showing keeps its
               words and stays on the shelf, and the section goes on with a
               new capsule of its own. Emptying a box never throws a capsule
               away: that is what its x on the shelf is for. It also keeps
               the other prompts that share it exactly as they were. */
            const old = book.caps[cid];
            cid = newCap(kindOf(s.title), p.name, sec, p.g);
            s._cap = cid;
            changed = true;
            kept.push(old.name);
          } else {
            const c = book.caps[cid];
            /* only the writing counts as a change - heights and toggles move
               on their own as the editor lays itself out */
            if (!changed && (c.sec.text || "") !== (sec.text || "")) changed = true;
            c.sec = sec;
            c.kind = kindOf(s.title);
          }
          seen.add(cid);
          ids.push(cid);
        }
        if (ids.join(",") !== p.caps.join(",")) changed = true;
        p.caps = ids;
        if (changed) p.fresh = false;
        sweepCaps();
        if (kept.length) {
          setTimeout(() => {
            say(`"${kept.join('", "')}" stays on the shelf - this box is a new capsule now`);
            paintBook(true);
          }, 0);
        }
      }

      /* Said on the section itself, where the typing happens: this text is
         not only this prompt's. */
      function sharedBadge(s) {
        if (!book || !s._cap || !book.caps[s._cap]) return "";
        const n = useCounts().get(s._cap) || 0;
        if (n < 2) return "";
        const c = book.caps[s._cap];
        return `<span class="lsb-shared" style="--k:${KIND_HUE[c.kind] || KIND_HUE.other}"`
          + ` title="Capsule &quot;${escapeHtml(c.name)}&quot; - shared by ${n} prompts of this series. `
          + `Editing it here changes all of them">shared &middot; ${n}</span>`;
      }

      function useCounts() {
        const n = new Map();
        for (const p of book.prompts) for (const c of p.caps) n.set(c, (n.get(c) || 0) + 1);
        return n;
      }

      /* An empty capsule nobody uses is nothing - it goes. One with words in
         it stays on the shelf until it is deleted, so taking a capsule out of
         a prompt never throws writing away. */
      function sweepCaps() {
        const used = useCounts();
        for (const id of Object.keys(book.caps)) {
          const c = book.caps[id];
          if (!used.get(Number(id)) && !String(c.sec.text || "").trim()) delete book.caps[id];
        }
      }

      /* Open the book again from its own data: after a switch, a replace
         across every prompt, a capsule placed. */
      function reopen() {
        hideMarkBar();
        root.querySelector(".lvp-panel")?.remove();
        restoreFrom({ book }, null);
        findState?.rescope?.();
      }

      function activate(pid) {
        if (!book || !book.prompts.some(p => p.id === pid)) return;
        writeBack();
        if (book.active === pid) return;
        book.active = pid;
        reopen();
        touch(); save();
        fitNodeToContent();
        findState?.refresh?.();
      }

      /* after the last capsule of the same kind, or where the kind belongs */
      function insertBeside(p, cid) {
        const kind = book.caps[cid]?.kind;
        let last = -1;
        p.caps.forEach((x, i) => { if (book.caps[x]?.kind === kind) last = i; });
        if (last >= 0) p.caps.splice(last + 1, 0, cid);
        else insertByKind(p, cid);
      }

      function insertByKind(p, cid) {
        const want = KIND_ORDER.indexOf(book.caps[cid].kind);
        const at = p.caps.findIndex(x => {
          const k = KIND_ORDER.indexOf(book.caps[x]?.kind);
          return want >= 0 && k > want;
        });
        if (at < 0) p.caps.push(cid); else p.caps.splice(at, 0, cid);
      }

      /* Put a capsule into a prompt: in place of the one of the same kind, or
         at the given position, or where its kind belongs if the prompt has
         none. A prompt never holds the same capsule twice, and holds only
         its own series' capsules - from another series it takes a copy. */
      function placeCap(cid, p, at, stack) {
        if (!book.caps[cid] || !p) return false;
        cid = capFor(cid, p.g);
        const c = book.caps[cid];
        /* Beside, not instead: a second capsule of the same kind - the
           palace's front in one scene capsule, the day's own forecourt in
           another. It goes after the last of its kind; both render, in that
           order. */
        if (stack) {
          if (p.caps.includes(cid)) return false;
          insertBeside(p, cid);
          p.fresh = false;
          return true;
        }
        /* mark the slot being filled, so the copy that stays is that one */
        const PLACED = -1;
        if (at !== undefined && at !== null && at >= 0 && at < p.caps.length) {
          p.caps[at] = PLACED;
        } else {
          const idx = p.caps.findIndex(x => book.caps[x]?.kind === c.kind);
          if (idx >= 0) p.caps[idx] = PLACED;
          else {
            insertByKind(p, cid);
            p.caps[p.caps.indexOf(cid)] = PLACED;
          }
        }
        p.caps = p.caps.filter(x => x !== cid).map(x => x === PLACED ? cid : x);
        p.fresh = false;
        return true;
      }

      /* scope: falsy - the given prompt; "series" - every prompt of the open
         series; "all" - every prompt of every series, each series getting its
         own copy. */
      function putCap(cid, target, at, scope, stack) {
        writeBack();
        const list = scope === "all" ? book.prompts
          : scope === "series" ? promptsOf(activeGroup())
          : [target || activePrompt()];
        let n = 0;
        for (const p of list) if (placeCap(cid, p, stack ? null : at, stack)) n++;
        if (!n) {
          if (stack && book.caps[cid]) say(`"${book.caps[cid].name}" is already in this prompt`);
          return;
        }
        sweepCaps();
        reopen();
        touch(); save();
        fitNodeToContent();
        const c = book.caps[cid];
        if (c && stack) {
          const what = KIND_LABEL[c.kind].toLowerCase();
          say(scope === "all" || scope === "series"
            ? `"${c.name}" added beside the ${what} of ${n} prompt${n === 1 ? "" : "s"}`
            : `"${c.name}" added beside the ${what} of ${numOf(list[0])} ${list[0].name} - both are used`);
        } else if (c) {
          const what = KIND_LABEL[c.kind].toLowerCase();
          say(scope === "all"
            ? `"${c.name}" is now the ${what} of every prompt in every series - each series has its own copy`
            : scope === "series"
              ? `"${c.name}" is now the ${what} of every prompt in series ${activeGroup().no}`
              : `"${c.name}" placed in ${numOf(list[0])} ${list[0].name}`);
        }
      }

      /* The Image Viewer's "use in the book": the capsules a picture was made
         with, put back into one prompt in one step - the picture's own prompt
         when the book still has one by that name, the open one otherwise. A
         kind the picture had none of is taken out, so the prompt renders as
         the picture did. Anchors whose words no capsule holds any more are
         left as the prompt has them, and named. Undo takes it all back. */
      const USE_KINDS = ["quality", "subject", "outfit", "pose", "scene", "camera", "absolute"];
      /* One anchor from a picture into the prompt open in the book - the
         camera of one render with the light of another, say. In place of
         the capsule of its kind, as a click on the shelf does. */
      function putOne(cid) {
        if (!BOOK || !book || !book.caps[cid]) return null;
        const p = activePrompt();
        if (!p) return null;
        const already = p.caps.includes(cid);
        if (!already) putCap(cid, p);
        const c = book.caps[cid];
        return { prompt: `${numOf(p)} ${p.name}`, name: c ? c.name : "", kind: c ? c.kind : "", already };
      }
      function useWords(items, promptName) {
        if (!BOOK || !book) return null;
        writeBack();
        let p = null;
        const nm = String(promptName || "").trim();
        if (nm) {
          const ag = activeGroup();
          const same = book.prompts.filter(q => q.name === nm);
          p = same.find(q => ag && q.g === ag.id) || same[0] || null;
        }
        if (!p) p = activePrompt();
        if (!p) return null;
        const missing = [];
        const kinds = new Set();
        let placed = 0;
        for (const it of items || []) {
          const hit = capOfWords(it.kind, it.text);
          if (!hit) {
            const k = String(it.kind || "").toLowerCase();
            if (USE_KINDS.includes(k)) missing.push(k);
            continue;
          }
          kinds.add(book.caps[hit.id]?.kind);
          if (p.caps.includes(hit.id)) { placed++; continue; }
          if (placeCap(hit.id, p)) placed++;
        }
        const out = [];
        if (kinds.size) {
          const missingKinds = new Set(missing);
          p.caps = p.caps.filter(id => {
            const k = book.caps[id]?.kind;
            if (!USE_KINDS.includes(k) || kinds.has(k) || missingKinds.has(k)) return true;
            out.push(k);
            return false;
          });
        }
        if (!placed && !out.length) return { placed: 0, missing, out, prompt: `${numOf(p)} ${p.name}` };
        p.fresh = false;
        book.active = p.id;
        sweepCaps();
        reopen();
        touch(); save();
        fitNodeToContent();
        say(`${numOf(p)} ${p.name} - the picture's capsules put back` + (out.length ? `, ${out.join(", ")} taken out` : "")
          + (missing.length ? ` - ${missing.join(", ")} not in the book as written` : ""), missing.length ? "err" : undefined);
        return { placed, missing, out, prompt: `${numOf(p)} ${p.name}` };
      }

      function takeOutCap(cid, p) {
        writeBack();
        const c = book.caps[cid];
        if (!c || !p) return;
        p.caps = p.caps.filter(x => x !== cid);
        p.fresh = false;
        reopen();
        touch(); save();
        fitNodeToContent();
        say(`"${c.name}" taken out of ${numOf(p)} ${p.name} - it stays on the shelf; click it to put it back`);
      }

      function deleteCap(cid) {
        writeBack();
        const c = book.caps[cid];
        if (!c) return;
        for (const p of book.prompts) p.caps = p.caps.filter(x => x !== cid);
        delete book.caps[cid];
        armedDel = null;
        reopen();
        touch(); save();
        fitNodeToContent();
        say(`capsule "${c.name}" deleted - Undo brings it back`);
      }

      /* Every capsule no prompt uses, gone in one step. Read again here, so a
         capsule that came into use since the shelf was drawn is kept. */
      function tidyCaps(ids) {
        writeBack();
        const used = new Set();
        for (const p of book.prompts) for (const c of p.caps) used.add(c);
        const gone = ids.filter(id => book.caps[id] && !used.has(id));
        for (const id of gone) delete book.caps[id];
        armedDel = null;
        touch(); save();
        paintBook(true);
        requestAnimationFrame(fitNodeToContent);
        say(gone.length
          ? `${gone.length} unused capsule${gone.length === 1 ? "" : "s"} deleted - Undo brings ${gone.length === 1 ? "it" : "them"} back`
          : "nothing to tidy - every capsule is in a prompt");
      }

      function newPrompt(copyAll) {
        writeBack();
        const from = activePrompt();
        const g = groupOf(from) || activeGroup();
        const p = { id: bookId(), g: g.id, no: nextNo(g),
                    name: uniquePromptName(copyAll && from ? from.name : "Scene", g),
                    caps: [], fresh: true };
        if (copyAll && from) {
          p.caps = from.caps.slice();
          if (orientOf(from) !== "all") p.orient = from.orient;
        } else {
          /* A new scene starts empty - every anchor a fresh box to paste or
             write into. Only the LoRA trigger is carried over: it belongs to
             the LoRA, not to the scene. */
          const keep = new Set(["trigger"]);
          const kinds = from
            ? from.caps.map(x => book.caps[x]).filter(Boolean).map(c => c.kind)
            : KIND_ORDER;
          for (const kind of (kinds.length ? kinds : KIND_ORDER)) {
            const shared = from && from.caps.find(x => book.caps[x]?.kind === kind);
            if (shared && keep.has(kind)) { p.caps.push(shared); continue; }
            const tmpl = shared ? book.caps[shared].sec : null;
            p.caps.push(newCap(kind, p.name, {
              title: tmpl ? tmpl.title : (KIND_TITLE[kind] || "Section"),
              text: "", html: "", on: true, h: tmpl ? tmpl.h : 90,
              color: tmpl ? tmpl.color || 0 : 0, extMode: "replace",
            }, g.id));
          }
        }
        const at = book.prompts.indexOf(from);
        book.prompts.splice(at < 0 ? book.prompts.length : at + 1, 0, p);
        book.active = p.id;
        g.open = true;
        reopen();
        touch(); save();
        fitNodeToContent();
        say(copyAll
          ? `${numOf(p)} ${p.name} - a copy sharing every capsule; paste or drop in what changes`
          : `${numOf(p)} ${p.name} - a new empty prompt; paste a scene or write it in`);
      }

      function deletePrompt() {
        writeBack();
        const p = activePrompt();
        if (!p) return;
        const g = groupOf(p);
        if (promptsOf(g).length === 1) {
          say("the last prompt of a series - close the series instead", "err");
          return;
        }
        /* the neighbour in the same series takes over */
        const mine = promptsOf(g);
        const at = mine.indexOf(p);
        book.prompts.splice(book.prompts.indexOf(p), 1);
        const rest = mine.filter(x => x !== p);
        book.active = rest[Math.min(at, rest.length - 1)].id;
        sweepCaps();
        reopen();
        touch(); save();
        fitNodeToContent();
        say(`${numOf(p)} ${p.name} deleted - its capsules stay on the shelf, Undo brings it back`);
      }

      function stepPrompt(d) {
        const p = activePrompt();
        if (!p) return;
        /* through the open series only - the others are a click away */
        const list = promptsOf(groupOf(p));
        const at = list.indexOf(p);
        const next = list[(at + d + list.length) % list.length];
        if (next) activate(next.id);
      }

      /* A new series: its own number, its own empty first prompt. */
      function addSeries() {
        writeBack();
        const g = newGroup();
        const p = startPrompt(g, "Scene 1", null);
        book.active = p.id;
        reopen();
        touch(); save();
        fitNodeToContent();
        say(`series ${g.no} started - paste its first scene, or rename it with a double click`);
      }

      /* Take a series out of the book. It has been written to its own file
         all along, so Files brings it back exactly as it was. */
      function closeSeries(gid) {
        writeBack();
        const g = groupById(gid);
        if (!g) return;
        flushSeries(g);
        /* the last series closed: the book starts over with an empty one */
        const last = book.groups.length === 1;
        const gone = new Set(promptsOf(g).map(p => p.id));
        book.prompts = book.prompts.filter(p => !gone.has(p.id));
        for (const c of capsOf(g)) delete book.caps[c.id];
        book.groups = book.groups.filter(x => x !== g);
        if (last) {
          const ng = newGroup();
          const p = startPrompt(ng, "Scene 1", null);
          book.active = p.id;
        } else if (gone.has(book.active)) book.active = orderedPrompts()[0].id;
        armedDel = null;
        reopen();
        touch(); save();
        fitNodeToContent();
        say(`series ${g.no} "${g.name}" closed - its file is kept, Files brings it back`
          + (last ? " - an empty series is ready" : ""));
      }

      /* A series' prompts in number order. Prompts get their number when
         they are made, and a series rebuilt from the start runs 01, 08, 21,
         03... once they have been dragged about; this lines them up again. */
      function isBlankStarter(q) {
        return !!q && Number(q.no) === 1 && /^scene 1$/i.test(String(q.name || "").trim())
          && !q.caps.some(cid => String(((book.caps[cid] || {}).sec || {}).text || "").trim());
      }
      /* Shift on the sort button: number the series again from 01 in the
         order it stands - for a series that was built from prompts carried
         in from elsewhere and kept their gaps. */
      function renumberSeries(gid) {
        const g = groupById(gid);
        if (!g) return;
        writeBack();
        const mine = book.prompts.filter(q => q.g === g.id);
        rebirth(mine.map((q, i) => ({ fromSg: g.uid, fromNo: q.no, toSg: g.uid, toSno: g.no, toNo: i + 1 }))
          .filter(m => m.fromNo !== m.toNo));
        mine.forEach((q, i) => { q.no = i + 1; });
        g.nextNo = mine.length + 1;
        lastShotAt = 0;
        reopen();
        touch(); save();
        fitNodeToContent();
        say(`series ${g.no} "${g.name}" numbered again from 01 in the order shown`);
      }
      function sortSeries(gid) {
        const g = groupById(gid);
        if (!g) return;
        writeBack();
        const mine = book.prompts.filter(p => p.g === g.id);
        const sorted = mine.slice().sort((a, b) => (Number(a.no) || 0) - (Number(b.no) || 0));
        if (sorted.every((p, i) => p === mine[i])) { say(`series ${g.no} is already in number order`); return; }
        let k = 0;
        book.prompts = book.prompts.map(p => p.g === g.id ? sorted[k++] : p);
        lastShotAt = 0;              // its own step in Undo, not merged into the last edit
        reopen();
        touch(); save();
        fitNodeToContent();
        say(`series ${g.no} "${g.name}" put in number order`);
      }

      /* A prompt carried to another series: it takes a number there, and
         its capsules - its own copies where the old series still uses them. */
      function movePrompt(pid, gid) {
        writeBack();
        const p = book.prompts.find(x => x.id === pid);
        const g = groupById(gid);
        if (!p || !g || p.g === g.id) return;
        const from = p.g;
        const uses = useCounts();
        p.caps = p.caps.map(cid => {
          const c = book.caps[cid];
          if (c && c.g === from && (uses.get(cid) || 0) <= 1) { c.g = g.id; return cid; }
          return capFor(cid, g.id);
        });
        /* A series just started holds one empty "Scene 1" to paste into. A
           prompt brought in takes its place - and its number, 01 - instead
           of starting the series at 02 behind a scene that was never used. */
        const held = promptsOf(g);
        if (held.length === 1 && isBlankStarter(held[0])) {
          book.prompts.splice(book.prompts.indexOf(held[0]), 1);
          if (book.active === held[0].id) book.active = p.id;
          g.nextNo = 1;
        }
        const no = nextNo(g);        // before it joins, or its old number counts
        const fromG = groupById(from);
        if (fromG) rebirth([{ fromSg: fromG.uid, fromNo: p.no, toSg: g.uid, toSno: g.no, toNo: no }]);
        p.g = g.id;
        p.no = no;
        p.name = uniquePromptName(p.name, g, p);
        book.prompts.splice(book.prompts.indexOf(p), 1);
        book.prompts.push(p);
        g.open = true;
        reopen();
        touch(); save();
        fitNodeToContent();
        say(`moved to series ${g.no} as ${numOf(p)}`);
      }

      /* Every Prompt Composer on the canvas becomes a prompt of the open
         series, named as the node is, in the order a Series Lab has them
         wired when there is one and top to bottom otherwise. Identical
         anchors become one capsule, which is how the shared Subject of a
         series turns back into one piece of text. */
      function importComposers() {
        writeBack();
        const g = activeGroup();
        const all = (app.graph?._nodes || []);
        const comps = all.filter(n => n !== node
          && (n.comfyClass || n.type) === "LeielPromptComposer");
        if (!comps.length) { say("no Prompt Composer on the canvas to import", "err"); return; }
        const rank = new Map();
        for (const lab of all.filter(n => (n.comfyClass || n.type) === "VisualSeriesLabSetup")) {
          for (const inp of (lab.inputs || [])) {
            const m = /^prompt(\d+)$/.exec(inp.name || "");
            if (!m || inp.link === null || inp.link === undefined) continue;
            const link = app.graph.links[inp.link];
            if (link && !rank.has(link.origin_id)) rank.set(link.origin_id, Number(m[1]));
          }
        }
        comps.sort((a, b) => {
          const ra = rank.has(a.id) ? rank.get(a.id) : 1e6;
          const rb = rank.has(b.id) ? rank.get(b.id) : 1e6;
          if (ra !== rb) return ra - rb;
          return (a.pos?.[1] || 0) - (b.pos?.[1] || 0) || (a.pos?.[0] || 0) - (b.pos?.[0] || 0);
        });

        /* the untouched starting prompt of a series is replaced, not kept */
        const mine = promptsOf(g);
        if (mine.length === 1) {
          const only = mine[0];
          const blank = only.caps.every(x => !String(book.caps[x]?.sec?.text || "").trim());
          if (blank) {
            book.prompts = book.prompts.filter(p => p !== only);
            g.nextNo = 1;
            sweepCaps();
          }
        }

        let added = 0, skipped = 0, first = null;
        for (const n of comps) {
          let secs = [];
          try {
            const lw = (n.widgets || []).find(x => x.name === "layout_json");
            secs = JSON.parse(lw?.value || "{}").sections || [];
          } catch (e) { secs = []; }
          if (!secs.length) { skipped++; continue; }
          const t = String(n.title || "").trim();
          const nm = (t && t !== "Visual Prompt Composer (Studio Leiel)") ? t : `Prompt ${n.id}`;
          if (promptsOf(g).some(p => p.name.trim().toLowerCase() === nm.toLowerCase())) {
            skipped++; continue;
          }
          const p = { id: bookId(), g: g.id, no: nextNo(g), name: nm, caps: [] };
          for (const s of secs) {
            const kind = kindOf(s.title);
            const same = Object.values(book.caps).find(c => c.g === g.id && c.kind === kind
              && c.sec.title === s.title && sameText(c.sec.text, s.text)
              && !p.caps.includes(c.id));
            p.caps.push(same ? same.id : newCap(kind, nm, secOf(s), g.id));
          }
          book.prompts.push(p);
          if (!first) first = p;
          added++;
        }
        if (!promptsOf(g).length) startPrompt(g, "Scene 1", null);
        if (first) book.active = first.id;
        else if (!book.prompts.some(p => p.id === book.active)) book.active = promptsOf(g)[0].id;
        reopen();
        touch(); save();
        fitNodeToContent();
        say(added
          ? `imported ${added} prompt${added === 1 ? "" : "s"} into series ${g.no}`
            + (skipped ? ` - ${skipped} skipped (empty, or the name is already here)` : "")
            + " - the Composers are still on the canvas, delete them when you are happy"
          : "nothing imported - every Composer was empty or already here", added ? "" : "err");
      }

      /* Which capsules a search reaches: -2 the open series, -3 every one. */
      function capsInScope(scope) {
        return scope === -3 ? Object.values(book.caps) : capsOf(activeGroup());
      }

      function countBook(find, matchCase, wholeWord, scope) {
        const hits = new Map();
        let total = 0;
        if (!find) return null;
        writeBack();
        for (const c of capsInScope(scope)) {
          const n = matchSpans(normalizeText(c.sec.text || ""), find, matchCase, wholeWord).length;
          if (n) { hits.set(c.id, n); total += n; }
        }
        return { total, caps: hits.size, hits };
      }

      /* ---------- series files ----------
         Each series is written to its own file in the user folder a few
         seconds after it changes, so closing a series, a crash, or a workflow
         saved over by mistake never costs a series. */
      const seriesSaved = new Map();     // uid -> what was last written
      let seriesT = null;
      function seriesDoc(g) {
        const prompts = promptsOf(g).map(p => ({ name: p.name, no: p.no, caps: p.caps.slice(),
          ...(orientOf(p) !== "all" ? { orient: p.orient } : {}),
          ...(p.note ? { note: p.note } : {}), ...(p.thumb ? { thumb: p.thumb } : {}) }));
        const caps = {};
        for (const c of capsOf(g)) caps[c.id] = { id: c.id, kind: c.kind, name: c.name, sec: c.sec,
                                            ...(c.was ? { was: c.was } : {}),
                                            ...(c.born ? { born: c.born } : {}) };
        return { format: "leiel.series", v: 1,
                 group: { uid: g.uid, name: g.name, no: g.no, nextNo: g.nextNo, hue: g.hue,
                          ...(g.note ? { note: g.note } : {}), ...(g.memo ? { memo: g.memo } : {}),
                          ...(g.memo && g.memoHtml ? { memoHtml: g.memoHtml } : {}),
                          ...(g.memoLead ? { memoLead: g.memoLead } : {}),
                          ...(g.memoOpen === false ? { memoOpen: false } : {}), ...(g.thumb ? { thumb: g.thumb } : {}) },
                 prompts, caps };
      }
      /* A series with nothing written in it yet - every capsule empty but
         perhaps the LoRA trigger - is not worth a file: a series started and
         left, or the empty one a closed book leaves behind. */
      function seriesEmpty(g) {
        return capsOf(g).every(c => c.kind === "trigger" || !String((c.sec && c.sec.text) || "").trim());
      }
      async function flushSeries(only) {
        if (!BOOK || !book) return;
        for (const g of (only ? [only] : book.groups)) {
          if (seriesEmpty(g)) continue;
          const doc = seriesDoc(g);
          const sig = JSON.stringify(doc);
          if (seriesSaved.get(g.uid) === sig) continue;
          seriesSaved.set(g.uid, sig);
          doc.saved = Date.now();
          try {
            await api.fetchApi("/leiel_vpc/series", { method: "POST",
              headers: { "Content-Type": "application/json" }, body: JSON.stringify(doc) });
          } catch (e) { seriesSaved.delete(g.uid); }
        }
      }
      function scheduleSeriesSave() {
        if (!BOOK) return;
        if (seriesT) clearTimeout(seriesT);
        seriesT = setTimeout(() => { seriesT = null; flushSeries(); }, 2500);
      }

      /* A series opened from a file tells the page, so an Image Viewer can go
         to its pictures. Several opened at once - a book's series added in a
         row - are told once, the first of them first. */
      let annT = null, annNames = [];
      function announceSeries(names) {
        for (const n of names) if (n && !annNames.includes(n)) annNames.push(n);
        if (annT) clearTimeout(annT);
        annT = setTimeout(() => {
          annT = null;
          const names = annNames; annNames = [];
          try { window.dispatchEvent(new CustomEvent("leiel-series-opened", { detail: { names } })); }
          catch (e) { /* nothing listening */ }
        }, 250);
      }

      /* A series file back into the book, as a new series with the next
         number. The same series cannot be in the book twice. */
      function loadSeries(doc) {
        writeBack();
        const grp = (doc && doc.group) || {};
        if (book.groups.some(g => g.uid === grp.uid)) {
          say(`"${grp.name}" is already in this book`, "err");
          return;
        }
        const g = newGroup(grp.name);
        g.uid = grp.uid || g.uid;
        g.nextNo = Number(grp.nextNo) || 1;
        if (Number.isInteger(grp.hue) && SERIES_TONES[grp.hue]) g.hue = grp.hue;
        if (typeof grp.note === "string" && grp.note.trim()) g.note = grp.note;
        if (typeof grp.memo === "string" && grp.memo.trim()) g.memo = grp.memo.slice(0, 20000);
        if (g.memo && typeof grp.memoHtml === "string" && grp.memoHtml.length < 80000) g.memoHtml = sanitizeMemo(grp.memoHtml);
        if (grp.memoOpen === false) g.memoOpen = false;
        if (Number.isFinite(grp.memoLead) && grp.memoLead >= 80 && grp.memoLead <= 300) g.memoLead = Math.round(grp.memoLead);
        if (typeof grp.thumb === "string" && /^data:image\//.test(grp.thumb)) g.thumb = grp.thumb;
        const map = new Map();
        for (const [k, c] of Object.entries(doc.caps || {})) {
          if (!c || !c.sec) continue;
          const id = bookId();
          map.set(Number(c.id || k), id);
          book.caps[id] = { id, kind: KIND_HUE[c.kind] ? c.kind : kindOf(c.sec.title),
                            g: g.id, name: String(c.name || "Capsule"), sec: c.sec,
                            ...(Number.isInteger(c.was) && c.was > 0 ? { was: c.was } : {}) , ...(cleanBorn(c.born) ? { born: cleanBorn(c.born) } : {}) };
        }
        versionNames(book.caps);
        let first = null;
        for (const q of (doc.prompts || [])) {
          const p = { id: bookId(), g: g.id, no: Number(q.no) || nextNo(g),
                      name: String(q.name || "Scene"),
                      caps: (q.caps || []).map(x => map.get(Number(x))).filter(Boolean) };
          if (ORIENTS.includes(q.orient) && q.orient !== "all") p.orient = q.orient;
          if (typeof q.note === "string" && q.note.trim()) p.note = q.note.slice(0, 4000);
          if (typeof q.thumb === "string" && /^data:image\//.test(q.thumb)) p.thumb = q.thumb;
          book.prompts.push(p);
          if (!first) first = p;
        }
        if (!first) first = startPrompt(g, "Scene 1", null);
        g.nextNo = Math.max(g.nextNo, ...promptsOf(g).map(p => p.no + 1));
        seriesSaved.set(g.uid, JSON.stringify(seriesDoc(g)));
        book.active = first.id;
        reopen();
        touch(); save();
        fitNodeToContent();
        say(`series "${g.name}" loaded as series ${g.no}`);
        announceSeries([g.name]);
      }

      /* ---------- the whole book as a file ----------
         Every series, every prompt and capsule, the open prompt and the
         book's own look, written to one file in user/visual_series_book/books
         - and opened again into any Series Book, so one workflow serves every
         series instead of a workflow saved per series. */
      function bookDefaultName() {
        return book.groups.map(g => g.name).join(", ").slice(0, 100) || "Series Book";
      }
      /* gid: one series only - the book file holds that series' prompts and
         capsules and nothing of the others, as if it were the only one open */
      function bookFile(gid) {
        writeBack();
        save();
        const w = node.widgets?.find(x => x.name === "layout_json");
        let doc = null;
        try { doc = JSON.parse(w && w.value || "null"); } catch (e) { doc = null; }
        if (!doc || !doc.book) return null;
        if (gid) {
          const b = doc.book;
          const g = (b.groups || []).find(x => Number(x.id) === Number(gid));
          if (!g) return null;
          b.groups = [g];
          b.prompts = (b.prompts || []).filter(q => Number(q.g) === Number(gid));
          if (!b.prompts.length) return null;
          const used = new Set();
          for (const q of b.prompts) for (const c of (q.caps || [])) used.add(String(c));
          const caps = {};
          for (const [k, c] of Object.entries(b.caps || {})) {
            if (c && (Number(c.g) === Number(gid) || used.has(String(c.id || k)))) caps[k] = c;
          }
          b.caps = caps;
          if (!b.prompts.some(q => Number(q.id) === Number(b.active))) b.active = b.prompts[0].id;
          if (b.shelfView !== "all") b.shelfView = null;
          return { format: "leiel.book", v: 1, saved: Date.now(), series: [g.name], doc };
        }
        return { format: "leiel.book", v: 1, saved: Date.now(),
                 series: book.groups.map(g => g.name), doc };
      }
      async function saveBookFile(name, gid) {
        if (!book) return null;
        /* the series is stamped before it is written, so the file carries
           the stamp too and opening it again shows nothing unsaved */
        const sg = gid != null ? groupById(gid) : null;
        const was = sg ? sg.savedSig : undefined;
        if (sg) sg.savedSig = groupSig(sg);
        const file = bookFile(gid);
        if (!file) { if (sg) sg.savedSig = was; say("the book could not be written", "err"); return null; }
        try {
          const r = await api.fetchApi("/leiel_vpc/books", { method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: name || bookDefaultName(), file }) });
          const j = await r.json();
          if (!j || !j.ok) throw new Error(j && j.error);
          const bk = file.doc.book;
          say(`book ${j.replaced ? "updated" : "saved"} as "${j.name}" - ${bk.groups.length} series, ${bk.prompts.length} prompts`);
          if (sg) { touch(); save(); paintBook(true); }
          return j;
        } catch (e) {
          if (sg) sg.savedSig = was;
          say("the book could not be saved" + (e && e.message ? ` - ${e.message}` : ""), "err");
          return null;
        }
      }
      function readBookFile(j) {
        if (!j || typeof j !== "object") return null;
        /* a book file, or a layout copied out of a workflow */
        const doc = j.format === "leiel.book" ? j.doc : (j.book ? j : null);
        if (!doc || !sanitizeBook(doc.book)) return null;
        return doc;
      }
      function bookIsEmpty() {
        return !book || (book.prompts.length <= 1 && book.prompts.every(p =>
          p.caps.every(c => !String((book.caps[c] && book.caps[c].sec.text) || "").trim())));
      }
      function openBook(doc, name) {
        snapPush(state.sections, "before opening a book file");
        restoreFrom(doc, null);
        seriesSaved.clear();
        touch(); save();
        fitNodeToContent();
        say(`opened "${name}" - ${book.groups.length} series, ${book.prompts.length} prompts`);
        const act = book.prompts.find(p => p.id === book.active);
        const first = act && book.groups.find(g => g.id === act.g);
        announceSeries([first && first.name, ...book.groups.map(g => g.name)]);
      }
      /* A book file's series brought in beside the ones already here, each
         as a series of its own with the next number - the book on the node
         is left as it is. A series already in the book (the same series,
         saved in that file too) comes in as a copy under a new identity. */
      function addBookSeries(doc, name) {
        const nb = sanitizeBook(doc.book);
        if (!nb) return;
        let n = 0;
        for (const ng of nb.groups) {
          const prompts = nb.prompts.filter(p => p.g === ng.id);
          const caps = {};
          for (const c of Object.values(nb.caps)) if (c.g === ng.id) caps[c.id] = c;
          if (!prompts.length && !Object.keys(caps).length) continue;
          const clash = book.groups.some(g => g.uid === ng.uid);
          const uid = clash ? newUid() : ng.uid;
          if (clash) {
            for (const c of Object.values(caps)) {
              if (c.born && c.born.sg === ng.uid) c.born = { ...c.born, sg: uid };
            }
          }
          loadSeries({ format: "leiel.series", v: 1,
                       group: { uid, name: ng.name, nextNo: ng.nextNo, hue: ng.hue,
                                ...(ng.note ? { note: ng.note } : {}), ...(ng.memo ? { memo: ng.memo } : {}),
                                ...(ng.memo && ng.memoHtml ? { memoHtml: ng.memoHtml } : {}),
                                ...(ng.memoLead ? { memoLead: ng.memoLead } : {}),
                                ...(ng.memoOpen === false ? { memoOpen: false } : {}), ...(ng.thumb ? { thumb: ng.thumb } : {}) },
                       prompts: prompts.map(p => ({ name: p.name, no: p.no, caps: p.caps.slice(),
                         ...(p.orient ? { orient: p.orient } : {}), ...(p.note ? { note: p.note } : {}),
                         ...(p.thumb ? { thumb: p.thumb } : {}) })),
                       caps });
          n++;
        }
        say(n ? `"${name}" - ${n} series added to this book` : `"${name}" has no series to add`, n ? "" : "err");
      }
      /* Opening a file asks once, in place: add its series to this book, or
         put this book aside for it. Adding is the first choice - starting a
         new series from a file is what Open is reached for most. */
      function askOpen(box, doc, name) {
        if (bookIsEmpty()) { box.remove(); openBook(doc, name); return; }
        const nb = sanitizeBook(doc.book);
        box.querySelector(".lb")?.remove();
        const row = document.createElement("div");
        row.className = "lb";
        row.innerHTML = `<span>Open <b>${escapeHtml(name)}</b> (${nb.groups.length} series, ${nb.prompts.length} prompts):`
          + ` add ${nb.groups.length === 1 ? "it as a new series" : "its series as new series"} beside the ${book.groups.length} here,`
          + ` or replace this book with it? Its series files stay either way.</span>`
          + `<button class="lsb-btn add">Add as new series</button><button class="lsb-btn go">Replace this book</button><button class="lsb-btn no">Cancel</button>`;
        box.querySelector(".lh").insertAdjacentElement("afterend", row);
        row.querySelector(".no").addEventListener("click", (e) => { e.stopPropagation(); row.remove(); });
        row.querySelector(".add").addEventListener("click", (e) => {
          e.stopPropagation();
          box.remove();
          addBookSeries(doc, name);
        });
        row.querySelector(".go").addEventListener("click", (e) => {
          e.stopPropagation();
          flushSeries();
          box.remove();
          openBook(doc, name);
        });
        requestAnimationFrame(fitNodeToContent);
      }
      function pickBookFile(box) {
        const inp = document.createElement("input");
        inp.type = "file";
        inp.accept = ".json,application/json";
        inp.addEventListener("change", async () => {
          const f = inp.files && inp.files[0];
          if (!f) return;
          let j = null;
          try { j = JSON.parse(await f.text()); } catch (e) { j = null; }
          if (j && j.format === "leiel.series") {      // one series, saved on its own
            if (book.groups.some(g => g.uid === (j.group || {}).uid)) {
              j.group = { ...(j.group || {}), uid: newUid() };
            }
            box.remove();
            loadSeries(j);
            return;
          }
          const doc = readBookFile(j);
          if (!doc) { say("that file is not a Series Book file", "err"); return; }
          askOpen(box, doc, f.name.replace(/\.json$/i, ""));
        });
        inp.click();
      }

      /* ---------- folders in the Files panel ----------
         Book files and series files sorted into folders, the way the Drawer
         sorts its cards. Only an index is kept -
         user/visual_series_book/file_folders.json says which file sits in
         which folder - so the files themselves never move and a series keeps
         writing to its own file. One set of folders serves both lists: a
         story's book file and its series files can share one folder. */
      const DT_FILE = "application/x-leiel-file";
      /* more files than this in a list and the old ones leave it */
      const FILE_LIST_LONG = 20;
      const FILES_UI_KEY = "leiel.vsb.files.ui";
      const FOLDER_SVG = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 3h4.4l1.5 1.7h7.1V13H1.5z"/></svg>`;
      function filesUi() {
        try {
          const v = JSON.parse(localStorage.getItem(FILES_UI_KEY) || "{}");
          return v && typeof v === "object" ? v : {};
        } catch (e) { return {}; }
      }
      function setFilesUi(patch) {
        try { localStorage.setItem(FILES_UI_KEY, JSON.stringify({ ...filesUi(), ...patch })); }
        catch (e) { /* private window or blocked storage - the panel still works */ }
      }
      /* A folder is kept as its path - "Chronicle/Season 1" - so a folder
         can sit inside another. A name typed by hand never holds a slash. */
      function cleanFolderName(s) {
        return String(s || "").replace(/\//g, "-").replace(/\s+/g, " ").trim().slice(0, 90);
      }
      const fLeaf = (f) => String(f).split("/").pop();
      const fParent = (f) => { const i = String(f).lastIndexOf("/"); return i < 0 ? "" : f.slice(0, i); };
      const fDepth = (f) => String(f).split("/").length - 1;
      const fUnder = (f, top) => f === top || f.startsWith(top + "/");
      /* Five quiet folder colours - gold, slate, sage, wine, plum - picked
         with the dot on a folder's bar. A folder inside another wears its
         parent's colour until it is given one of its own. */
      const ARCHIVE = "Archive";
      const FOLDER_TONES = [["gold", "#c9a453"], ["slate", "#7f97b5"], ["sage", "#8aa585"],
                            ["wine", "#b47a78"], ["plum", "#9a88b3"]];
      /* Archive wears its own fixed silver, unlike any folder colour; the
         folders inside it wear it too until given a colour of their own */
      const ARCHIVE_TONE = ["silver", "#aeb6c2"];
      const folderToneOf = (ix, f) => {
        for (let p = f; p; p = fParent(p)) {
          if (p === ARCHIVE) return ARCHIVE_TONE;
          const v = ix.colors && ix.colors[p];
          if (Number.isInteger(v) && FOLDER_TONES[v]) return FOLDER_TONES[v];
        }
        return FOLDER_TONES[0];
      };
      const folderTone = (ix, f) => {
        for (let p = f; p; p = fParent(p)) {
          const v = ix.colors && ix.colors[p];
          if (Number.isInteger(v) && FOLDER_TONES[v]) return v;
        }
        return 0;
      };
      /* a folder and everything under it moved to a new path, the files and
         the open folders following */
      function movePath(ix, from, to) {
        const re = (x) => fUnder(x, from) ? to + x.slice(from.length) : x;
        ix.folders = ix.folders.map(re);
        ix.open = ix.open.map(re);
        if (ix.colors) {
          const c = {};
          for (const [k, v] of Object.entries(ix.colors)) c[re(k)] = v;
          ix.colors = c;
        }
        for (const m of [ix.books, ix.series]) {
          for (const k of Object.keys(m)) m[k] = re(m[k]);
        }
      }
      async function readFileFolders() {
        let ix = null;
        try {
          const r = await api.fetchApi("/leiel_vpc/file_folders");
          const j = await r.json();
          if (j && j.ok) ix = j.index;
        } catch (e) { ix = null; }
        ix = ix && typeof ix === "object" ? ix : {};
        /* Archive is always there, first: finished work put in it stays in
           the list for good, however old. It cannot be renamed or removed. */
        const fl = Array.isArray(ix.folders) ? ix.folders.slice() : [];
        if (!fl.includes(ARCHIVE)) fl.unshift(ARCHIVE);
        return { folders: fl,
                 books: ix.books && typeof ix.books === "object" ? { ...ix.books } : {},
                 series: ix.series && typeof ix.series === "object" ? { ...ix.series } : {},
                 open: Array.isArray(ix.open) ? ix.open.slice() : [],
                 colors: ix.colors && typeof ix.colors === "object" ? { ...ix.colors } : {},
                 order: { book: Array.isArray(ix.order && ix.order.book) ? ix.order.book.slice() : [],
                          series: Array.isArray(ix.order && ix.order.series) ? ix.order.series.slice() : [] },
                 keepDays: Number.isInteger(ix.keepDays) ? ix.keepDays : 30 };
      }
      async function writeFileFolders(ix) {
        try {
          const r = await api.fetchApi("/leiel_vpc/file_folders", { method: "POST",
            headers: { "Content-Type": "application/json" }, body: JSON.stringify(ix) });
          const j = await r.json();
          if (!j || !j.ok) throw new Error(j && j.error);
          return true;
        } catch (e) {
          say("the folders could not be saved" + (e && e.message ? ` - ${e.message}` : ""), "err");
          return false;
        }
      }

      async function openLoad(anchor) {
        /* Files again with the panel open closes it, the way the hand
           reaches for it anyway. */
        const open = root.querySelector(".lsb-load");
        document.querySelectorAll(".lsb-lnote").forEach(x => x.remove());
        if (open) { open.remove(); requestAnimationFrame(fitNodeToContent); return; }
        let list = [], books = [];
        try {
          const r = await api.fetchApi("/leiel_vpc/series");
          const j = await r.json();
          list = (j && j.list) || [];
        } catch (e) { list = []; }
        const readBooks = async () => {
          try {
            const r = await api.fetchApi("/leiel_vpc/books");
            const j = await r.json();
            return (j && j.list) || [];
          } catch (e) { return []; }
        };
        books = await readBooks();
        const ix = await readFileFolders();
        /* files taken off the list by hand - kept on disk */
        if (!ix.hidden || typeof ix.hidden !== "object") ix.hidden = {};
        for (const k of ["book", "series"]) if (!Array.isArray(ix.hidden[k])) ix.hidden[k] = [];
        const showHidden = { book: false, series: false };
        const isHidden = (sec, key) => ix.hidden[sec].includes(key);
        const box = document.createElement("div");
        box.className = "lsb-load";
        const here = new Set(book.groups.map(g => g.uid));
        const when = (t) => {
          const d = new Date(Number(t) || 0);
          return isNaN(d) ? "" : d.toLocaleString();
        };
        const dflt = bookDefaultName();
        let savedAs = null;          // the name this book was just saved under
        const ui = filesUi();
        const shut = { book: !!ui.bookShut, series: !!ui.seriesShut };
        /* rows picked with Ctrl or Shift, to drag into a folder together -
           from one list at a time */
        const sel = { sec: null, keys: new Set(), at: null };
        let q = "", renaming = null, delArmed = null, sdelArmed = null, bdelArmed = null, fileNaming = null;
        let lastName = { key: null, t: 0 };
        let lastRow = { key: null, t: 0 };
        const showOld = { book: false, series: false };   // old files, shown for now
        const mapOf = (sec) => sec === "book" ? ix.books : ix.series;
        /* Inside a folder, files stand in the order they were put in with the
           arrows; the rest by name, numbers read as numbers - S1E1 before
           S1E3 before S1E10. */
        const nameOfItem = (sec, it) => sec === "book" ? it.b.name : String(it.s.name || "");
        const inFolderOrder = (sec, items) => {
          const ord = ix.order[sec];
          return items.slice().sort((a, b) => {
            const ia = ord.indexOf(a.key), ib = ord.indexOf(b.key);
            if (ia >= 0 && ib >= 0) return ia - ib;
            if (ia >= 0) return -1;
            if (ib >= 0) return 1;
            return nameOfItem(sec, a).localeCompare(nameOfItem(sec, b), undefined, { numeric: true, sensitivity: "base" });
          });
        };
        const itemsOf = (sec) => sec === "book"
          ? books.map(b => ({ key: b.name, b,
              hay: (b.name + " " + (b.series || []).join(" ")).toLowerCase() }))
          : list.map(s => ({ key: s.uid, s, hay: String(s.name || "").toLowerCase() }));
        /* A book file's series are listed after its name only when they say
           something the name does not - a book saved under its series' names
           would otherwise read the same words twice. */
        const bookSeriesNote = (b) => {
          const s = (b.series || []).join(", ");
          return !s || s.trim().toLowerCase() === String(b.name).trim().toLowerCase() ? "" : s + " - ";
        };
        /* a file's picture, small, before its name - an empty slot keeps the
           names in line */
        const filePic = (url) => url
          ? `<span class="lpic"><img loading="lazy" src="${escapeHtml(api.apiURL ? api.apiURL(url) : url)}" alt=""></span>`
          : `<span class="lpic none"></span>`;
        const hideBtn = (sec, key) => isHidden(sec, key)
          ? `<button class="lsb-btn lhide un" title="Put it back on the list">Unhide</button>`
          : `<button class="lsb-btn lhide" title="Take it off the list only - the file stays on disk">Hide</button>`;
        const rowHtml = (sec, it, inFolder) => {
          const on = sel.sec === sec && sel.keys.has(it.key) ? " sel" : "";
          if (sec === "book") {
            const b = it.b;
            return `<div class="lr bk${b.name === (savedAs || dflt) ? " here" : ""}${on}${isHidden("book", b.name) ? " hid" : ""}" draggable="true" data-sec="book" data-key="${escapeHtml(b.name)}">`
              + filePic(b.thumb ? `/leiel_vpc/file_thumb?book=${encodeURIComponent(b.name)}&t=${Math.round(Number(b.saved) || 0)}` : "")
              + (fileNaming && fileNaming.sec === "book" && fileNaming.key === b.name
                  ? `<input class="lrn" type="text" spellcheck="false" value="${escapeHtml(b.name)}">`
                  : `<b title="double click to rename">${escapeHtml(b.name)}</b>`)
              + `<span>${escapeHtml(bookSeriesNote(b))}${b.prompts} prompt${b.prompts === 1 ? "" : "s"}`
              + ` - ${escapeHtml(when(b.saved))}</span>`
              + (inFolder ? `<button class="lsb-btn fmv up" title="Move up in this folder">&#9650;</button><button class="lsb-btn fmv dn" title="Move down in this folder">&#9660;</button>` : "")
              + `<button class="lsb-btn bop">Open</button>`
              + hideBtn("book", b.name)
              + `<button class="lsb-btn sdel bdel${bdelArmed === b.name ? " armed" : ""}" title="Delete this book file - click again to confirm">`
              + `${bdelArmed === b.name ? "Delete file?" : "&times;"}</button></div>`;
          }
          const s = it.s;
          return `<div class="lr${here.has(s.uid) ? " here" : ""}${on}${isHidden("series", s.uid) ? " hid" : ""}" draggable="true" data-sec="series" data-key="${escapeHtml(s.uid)}">`
            + filePic(s.thumb ? `/leiel_vpc/file_thumb?uid=${encodeURIComponent(s.uid)}&t=${Math.round(Number(s.saved) || 0)}` : "")
            + (fileNaming && fileNaming.sec === "series" && fileNaming.key === s.uid
                ? `<input class="lrn" type="text" spellcheck="false" value="${escapeHtml(s.name)}">`
                : `<b title="${here.has(s.uid) ? "open in this book - double click its name on the series bar to rename it" : "double click to rename"}">${escapeHtml(s.name)}</b>`)
            + `<span>${s.prompts} prompt${s.prompts === 1 ? "" : "s"}`
            + ` - ${escapeHtml(when(s.saved))}</span>`
            + (inFolder ? `<button class="lsb-btn fmv up" title="Move up in this folder">&#9650;</button><button class="lsb-btn fmv dn" title="Move down in this folder">&#9660;</button>` : "")
            + (here.has(s.uid) ? `<i>in this book</i>` : `<button class="lsb-btn ld">Bring back</button>`
              + hideBtn("series", s.uid)
              + `<button class="lsb-btn sdel${sdelArmed === s.uid ? " armed" : ""}" title="Delete this series file - click again to confirm">`
              + `${sdelArmed === s.uid ? "Delete file?" : "&times;"}</button>`)
            + `</div>`;
        };
        /* One list: its folders first, in the order they were made, then the
           files in no folder. A folder holding only the other list's files is
           left out; a folder holding nothing yet shows in both. */
        function secHtml(sec) {
          const every = itemsOf(sec), m = mapOf(sec);
          const hiddenN = every.filter(it => isHidden(sec, it.key)).length;
          /* hidden files stay out of the list - and out of the counts -
             until "Show them"; a search still finds them */
          const all = showHidden[sec] || q.trim() ? every : every.filter(it => !isHidden(sec, it.key));
          const other = Object.values(mapOf(sec === "book" ? "series" : "book"));
          const v = q.trim().toLowerCase();
          const hit = (it) => !v || it.hay.includes(v);
          let html = "";
          const under = (f) => ix.folders.filter(x => fParent(x) === f);
          const inTree = (f, mm) => Object.values(mm).filter(x => x && fUnder(x, f));
          const otherAll = Object.values(mapOf(sec === "book" ? "series" : "book"));
          function folderHtml(f) {
            const mine = all.filter(it => m[it.key] && fUnder(m[it.key], f));
            /* a folder holding only the other list's files is left out */
            if (!mine.length && otherAll.some(x => x && fUnder(x, f))) return "";
            const direct = inFolderOrder(sec, all.filter(it => m[it.key] === f));
            const fHit = !!v && fLeaf(f).toLowerCase().includes(v);
            const shown = v && !fHit ? direct.filter(hit) : direct;
            const subs = under(f).map(folderHtml).filter(Boolean);
            if (v && !fHit && !shown.length && !subs.length) return "";
            const opened = v ? true : ix.open.includes(f);
            const naming = renaming && renaming.f === f && renaming.sec === sec;
            const tone = folderToneOf(ix, f);
            const arch = f === ARCHIVE;
            let h = `<div class="lfd${opened ? " open" : ""}${fParent(f) ? " sub" : ""}${arch ? " arch" : ""}" draggable="${arch ? "false" : "true"}" data-f="${escapeHtml(f)}" data-sec="${sec}" style="--fc:${tone[1]}">`
              + `<span class="car">${opened ? "&#9662;" : "&#9656;"}</span>${FOLDER_SVG}`
              + (naming && !arch ? `<input class="lfn" type="text" spellcheck="false" value="${escapeHtml(fLeaf(f))}">`
                        : arch ? `<b>${escapeHtml(f)}</b><em class="akeep" title="Files in Archive - and in any folder - stay in the list for good, however old">kept for good</em>`
                        : `<b title="double click to rename">${escapeHtml(fLeaf(f))}</b>`)
              + `<span class="n">${mine.length}</span>`
              + (f === ARCHIVE ? "" : `<span class="fcol" title="Folder colour: ${tone[0]} - click for the next, Shift+click for the one before"></span>`)
              + `<span class="fsp"></span>`
              + `<button class="lsb-btn fsub" title="A folder inside this one">+ Folder</button>`
              + (arch ? `</div>` : `<button class="lsb-btn fren" title="Rename this folder">Rename</button>`
              + `<button class="lsb-btn fdel${delArmed === f ? " armed" : ""}" title="Remove this folder - what is in it moves up a level, nothing is deleted">`
              + `${delArmed === f ? "Remove folder?" : "&times;"}</button></div>`);
            if (opened) {
              const inner = subs.join("") + shown.map(it => rowHtml(sec, it, true)).join("");
              h += `<div class="lfc" style="--fc:${tone[1]}">` + (inner || `<div class="le">Empty - drag files or folders onto the folder.</div>`) + `</div>`;
            }
            return h;
          }
          for (const f of ix.folders.filter(x => !fParent(x))) html += folderHtml(f);
          let loose = all.filter(it => !m[it.key] || !ix.folders.includes(m[it.key])).filter(hit);
          /* Once a list grows long, files nobody has touched for a while drop
             out of it - only out of the list: the files stay, a search still
             finds them, and a file in a folder or open here is always shown.
             A short list is left whole. */
          let old = 0;
          if (ix.keepDays && !v && all.length > FILE_LIST_LONG) {
            const cutoff = Date.now() - ix.keepDays * 86400000;
            const cur = savedAs || dflt;
            const stale = sec === "book"
              ? (it) => Number(it.b.saved || 0) < cutoff && it.b.name !== cur
              : (it) => Number(it.s.saved || 0) < cutoff && !here.has(it.key);
            old = loose.filter(stale).length;
            if (!showOld[sec]) loose = loose.filter(it => !stale(it));
          }
          html += loose.map(it => rowHtml(sec, it)).join("");
          if (old) {
            const what = sec === "book" ? `book file${old === 1 ? "" : "s"}` : "series";
            html += `<div class="lold">${old} ${what} not ${sec === "book" ? "saved" : "changed"} for over ${ix.keepDays} days `
              + `${showOld[sec] ? "shown" : "hidden"} - the files are kept. Put what matters in Archive or any folder and it always stays`
              + `<button class="lsb-btn sho" data-sec="${sec}">${showOld[sec] ? "Hide them" : "Show them"}</button></div>`;
          }
          if (hiddenN && !q.trim()) {
            html += `<div class="lold">${hiddenN} ${sec === "book" ? `book file${hiddenN === 1 ? "" : "s"}` : "series"} taken off the list `
              + `${showHidden[sec] ? "shown" : "hidden"} - the files are kept`
              + `<button class="lsb-btn shh" data-sec="${sec}">${showHidden[sec] ? "Hide them" : "Show them"}</button></div>`;
          }
          if (!every.length) {
            html += `<div class="le">${sec === "book" ? "No book saved yet."
              : "No series saved yet - each series is written here as you work on it."}</div>`;
          } else if (v && !html) {
            html = `<div class="le">Nothing here matches.</div>`;
          }
          return html;
        }
        box.innerHTML = `<div class="lh"><span>Files</span>`
          + `<input class="lfq" type="text" spellcheck="false" placeholder="find a book, series or folder">`
          + `<span class="sp"></span>`
          + `<span class="lkw">hide old after <select class="lkd" title="When a list holds more than ${FILE_LIST_LONG} files, files not changed for this long are left out of it - never deleted. A search still finds them; files in a folder or open here are always shown.">`
          + [[0, "never"], [7, "7 days"], [14, "14 days"], [30, "30 days"], [60, "60 days"], [90, "90 days"]]
              .map(([v, l]) => `<option value="${v}"${ix.keepDays === v ? " selected" : ""}>${l}</option>`).join("")
          + `</select></span>`
          + `<button class="lsb-btn lnf" title="Make a folder - files picked with Ctrl or Shift go straight into it">+ Folder</button>`
          + `<button class="lsb-btn cls">Close</button></div>`
          + `<div class="ls" data-sec="book">Book files<i>the whole book - every series, prompt and capsule - in user/visual_series_book/books</i></div>`
          + `<div class="lsave"><span class="lsl" title="The book open in this node - every series, prompt and capsule - is saved under the name typed here">Save current book as</span>`
          + (book.groups.length > 1
              ? `<select class="bsc" title="Save every series open here as one book, or one series as a book of its own">`
                + `<option value="">All ${book.groups.length} series</option>`
                + book.groups.map(g => `<option value="${g.id}">${escapeHtml(g.name)}</option>`).join("")
                + `</select>`
              : "")
          + `<input class="bnm" type="text" spellcheck="false" value="${escapeHtml(dflt)}" placeholder="name of the book file">`
          + `<button class="lsb-btn bsave" title="Save the whole book under this name - the same name again updates it">Save book</button></div>`
          + `<div class="lsec" data-sec="book"></div>`
          + `<div class="lfoot"><button class="lsb-btn bimp" title="Open a book file from anywhere on this computer">Open a file from the computer...</button></div>`
          + `<div class="ls" data-sec="series">Series files<i>each series on its own, written as you work - closed ones come back from here</i></div>`
          + `<div class="lsec" data-sec="series"></div>`;

        function wireRename() {
          const fn = box.querySelector(".lfn");
          if (!fn) return;
          let done = false;
          const commit = async (keep) => {
            if (done) return;
            done = true;
            const old = renaming && renaming.f;
            renaming = null;
            const leaf = cleanFolderName(fn.value);
            const nv = leaf ? (fParent(old) ? fParent(old) + "/" : "") + leaf : "";
            if (!keep || !old || !leaf || nv === old) { paint(); return; }
            if (ix.folders.includes(nv)) {
              say(`there is already a folder called "${leaf}" here`, "err");
              paint();
              return;
            }
            movePath(ix, old, nv);
            await writeFileFolders(ix);
            paint();
          };
          ["keyup", "keypress", "pointerdown", "mousedown"].forEach(k => fn.addEventListener(k, e => e.stopPropagation()));
          fn.addEventListener("keydown", (e) => {
            e.stopPropagation();
            if (e.key === "Enter") { e.preventDefault(); commit(true); }
            else if (e.key === "Escape") { e.preventDefault(); commit(false); }
          });
          fn.addEventListener("blur", () => commit(true));
          fn.focus();
          fn.select();
        }
        /* A book file or a closed series under a new name: the book file is
           renamed on disk, the series' name written into its own file. */
        function wireFileRename() {
          const inp = box.querySelector(".lrn");
          if (!inp) return;
          let done = false;
          const commit = async (keep) => {
            if (done) return;
            done = true;
            const fnm = fileNaming;
            fileNaming = null;
            const nv = String(inp.value || "").replace(/\s+/g, " ").trim();
            if (!keep || !fnm || !nv) { paint(); return; }
            try {
              if (fnm.sec === "book") {
                if (nv === fnm.key) { paint(); return; }
                const r = await api.fetchApi("/leiel_vpc/book_rename", { method: "POST",
                  headers: { "Content-Type": "application/json" }, body: JSON.stringify({ old: fnm.key, new: nv }) });
                const j = await r.json();
                if (!j || !j.ok) throw new Error(j && j.error);
                if (ix.books[fnm.key] !== undefined) { ix.books[j.name] = ix.books[fnm.key]; delete ix.books[fnm.key]; }
                ix.order.book = ix.order.book.map(k => k === fnm.key ? j.name : k);
                ix.hidden.book = ix.hidden.book.map(k => k === fnm.key ? j.name : k);
                if (savedAs === fnm.key) savedAs = j.name;
                books = await readBooks();
                say(`book file renamed to "${j.name}"`);
              } else {
                const s0 = list.find(x => x.uid === fnm.key);
                if (s0 && s0.name === nv) { paint(); return; }
                const r = await api.fetchApi("/leiel_vpc/series_rename", { method: "POST",
                  headers: { "Content-Type": "application/json" }, body: JSON.stringify({ uid: fnm.key, name: nv }) });
                const j = await r.json();
                if (!j || !j.ok) throw new Error(j && j.error);
                if (s0) s0.name = j.name;
                say(`series renamed to "${j.name}"`);
              }
            } catch (err) {
              say("could not rename" + (err && err.message ? ` - ${err.message}` : ""), "err");
            }
            paint();
          };
          ["keyup", "keypress", "pointerdown", "mousedown", "click", "dblclick"].forEach(k => inp.addEventListener(k, e => e.stopPropagation()));
          inp.addEventListener("keydown", (e) => {
            e.stopPropagation();
            if (e.key === "Enter") { e.preventDefault(); commit(true); }
            else if (e.key === "Escape") { e.preventDefault(); commit(false); }
          });
          inp.addEventListener("blur", () => commit(true));
          inp.focus();
          inp.select();
        }
        /* the note written on a series, shown when the pointer rests on its
           row - a book file shows the note of each series it holds. Kept on
           the page body so the list's own scrolling never clips it. */
        let tip = null, tipT = null, tipRow = null;
        function hideTip() {
          if (tipT) { clearTimeout(tipT); tipT = null; }
          tipRow = null;
          if (tip) { tip.remove(); tip = null; }
        }
        function tipHtml(row) {
          const key = row.dataset.key;
          const old = `<p class="no">Restart ComfyUI so the Files list can read series notes.</p>`;
          const picOf = (url) => url ? `<img class="lnpic" src="${escapeHtml(api.apiURL ? api.apiURL(url) : url)}" alt="">` : "";
          /* picture on the left, the note on the right */
          const pair = (name, img, txt) => `<b>${escapeHtml(name)}</b>`
            + (img ? `<div class="lncol">${img}<div class="lntx">${txt}</div></div>` : txt);
          const one = (name, note, url) => pair(name, picOf(url), String(note || "").trim()
            ? `<p>${escapeHtml(String(note).trim())}</p>`
            : `<p class="no">No note yet - open the series and click "add a note about this series".</p>`);
          if (row.dataset.sec === "series") {
            const s = list.find(x => x.uid === key);
            if (!s) return "";
            /* a series open in this book: its note as it is now */
            const g = book.groups.find(x => x.uid === key);
            const surl = s.thumb ? `/leiel_vpc/file_thumb?uid=${encodeURIComponent(s.uid)}&t=${Math.round(Number(s.saved) || 0)}` : "";
            if (g) return g.thumb ? pair(s.name, `<img class="lnpic" src="${g.thumb}" alt="">`,
              String(g.note || "").trim() ? `<p>${escapeHtml(String(g.note).trim())}</p>` : "") : one(s.name, g.note, surl);
            return "note" in s ? one(s.name, s.note, surl) : `<b>${escapeHtml(s.name)}</b>` + old;
          }
          const b = books.find(x => x.name === key);
          if (!b) return "";
          if (!Array.isArray(b.notes)) return `<b>${escapeHtml(b.name)}</b>` + old;
          const burl = b.thumb ? `/leiel_vpc/file_thumb?book=${encodeURIComponent(b.name)}&t=${Math.round(Number(b.saved) || 0)}` : "";
          if (!b.notes.length) return one(b.name, "", burl);
          return b.notes.map((n, i) => one(n.name, n.note, i === 0 ? burl : "")).join("");
        }
        /* Drawn inside the panel, not on the page body: the node is scaled
           with the canvas, so the card is placed in the panel's own units. */
        function showTip(row) {
          const html = tipHtml(row);
          if (!html || !box.isConnected || !row.isConnected) return;
          tip = document.createElement("div");
          tip.className = "lsb-lnote";
          tip.innerHTML = html;
          box.appendChild(tip);
          const br = box.getBoundingClientRect(), r = row.getBoundingClientRect();
          const k = box.offsetWidth ? br.width / box.offsetWidth : 1;
          const w = tip.offsetWidth, h = tip.offsetHeight;
          let x = (r.left - br.left) / k + 24;
          let y = (r.bottom - br.top) / k + 6;
          if (y + h > box.offsetHeight - 4) y = Math.max(4, (r.top - br.top) / k - h - 6);
          x = Math.max(4, Math.min(x, box.offsetWidth - w - 4));
          tip.style.left = x + "px";
          tip.style.top = y + "px";
        }
        const tipOver = (e) => {
          const t = e.target instanceof Element ? e.target : null;
          if (t && t.closest(".lsb-lnote")) return;
          const row = t ? t.closest(".lr[data-key]") : null;
          if (row === tipRow) return;
          hideTip();
          if (!row) return;
          tipRow = row;
          tipT = setTimeout(() => { tipT = null; if (tipRow === row) showTip(row); }, 350);
        };
        box.addEventListener("pointermove", tipOver);
        box.addEventListener("mouseover", tipOver);
        box.addEventListener("pointerleave", hideTip);
        box.addEventListener("mouseleave", hideTip);
        box.addEventListener("wheel", hideTip, { passive: true });
        box.addEventListener("dragstart", hideTip);
        box.addEventListener("pointerdown", hideTip);

        function paint() {
          hideTip();
          const searching = !!q.trim();
          for (const sec of ["book", "series"]) {
            const s = shut[sec] && !searching;
            box.querySelector(`.lsec[data-sec="${sec}"]`).innerHTML = secHtml(sec);
            box.querySelector(`.lsec[data-sec="${sec}"]`).classList.toggle("shut", s);
            box.querySelector(`.ls[data-sec="${sec}"]`).classList.toggle("shut", s);
          }
          box.querySelector(".lnf").textContent = sel.keys.size
            ? `+ Folder (${sel.keys.size})` : "+ Folder";
          wireRename();
          wireFileRename();
          requestAnimationFrame(fitNodeToContent);
        }

        const head = root.querySelector(".lsb-book .lsb-head");
        head.insertAdjacentElement("afterend", box);
        ["pointerdown", "mousedown", "wheel"].forEach(k =>
          box.addEventListener(k, e => e.stopPropagation()));
        const nm = box.querySelector(".bnm");
        ["keydown", "keyup", "keypress"].forEach(k => nm.addEventListener(k, e => e.stopPropagation()));
        const fq = box.querySelector(".lfq");
        ["keyup", "keypress"].forEach(k => fq.addEventListener(k, e => e.stopPropagation()));
        fq.addEventListener("keydown", (e) => {
          e.stopPropagation();
          if (e.key === "Escape" && fq.value) { e.preventDefault(); fq.value = ""; q = ""; paint(); }
        });
        fq.addEventListener("input", () => { q = fq.value; paint(); });
        const close = () => { hideTip(); box.remove(); requestAnimationFrame(fitNodeToContent); };
        box.querySelector(".cls").addEventListener("click", close);
        /* the panel stays open after a save - the list is read again so the
           new or updated book shows in it */
        const bsc = box.querySelector(".bsc");
        if (bsc) {
          bsc.addEventListener("click", e => e.stopPropagation());
          /* picking a series names the file after it; All goes back to the
             name of the whole book */
          bsc.addEventListener("change", () => {
            const g = book.groups.find(x => String(x.id) === bsc.value);
            nm.value = g ? g.name : dflt;
          });
        }
        const doSave = async () => {
          const j = await saveBookFile(nm.value.trim(), bsc && bsc.value ? Number(bsc.value) : null);
          if (!j) return;
          savedAs = j.name;
          nm.value = j.name;
          books = await readBooks();
          paint();
        };
        box.querySelector(".bsave").addEventListener("click", (e) => { e.stopPropagation(); doSave(); });
        nm.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); doSave(); } });
        box.querySelector(".bimp").addEventListener("click", (e) => { e.stopPropagation(); pickBookFile(box); });
        const kd = box.querySelector(".lkd");
        kd.addEventListener("click", e => e.stopPropagation());
        kd.addEventListener("change", async () => {
          ix.keepDays = Number(kd.value) || 0;
          await writeFileFolders(ix);
          paint();
        });
        box.querySelector(".lnf").addEventListener("click", async (e) => {
          e.stopPropagation();
          let n = "New folder", i = 2;
          while (ix.folders.includes(n)) n = `New folder ${i++}`;
          ix.folders.push(n);
          ix.open.push(n);
          let sec = "book";
          if (sel.sec && sel.keys.size) {
            sec = sel.sec;
            const m = mapOf(sec);
            for (const k of sel.keys) m[k] = n;
            sel.sec = null; sel.keys.clear(); sel.at = null;
          }
          renaming = { f: n, sec };
          delArmed = null;
          await writeFileFolders(ix);
          paint();
        });

        /* every click inside the lists, read in one place - the lists are
           drawn again after each change */
        box.addEventListener("click", async (e) => {
          const t = e.target;
          if (!(t instanceof Element) || t.closest(".lfn") || t.closest(".lkd")) return;
          const fc = t.closest(".fcol");
          if (fc) {
            e.stopPropagation();
            const f = fc.closest(".lfd").dataset.f;
            const n = FOLDER_TONES.length;
            ix.colors = ix.colors || {};
            ix.colors[f] = (folderTone(ix, f) + (e.shiftKey ? n - 1 : 1)) % n;
            await writeFileFolders(ix);
            paint();
            return;
          }
          const mv = t.closest(".fmv");
          if (mv) {
            e.stopPropagation();
            const row = mv.closest(".lr[data-key]");
            const sec = row.dataset.sec, key = row.dataset.key, m = mapOf(sec);
            const folder = m[key];
            if (!folder) return;
            const sibs = inFolderOrder(sec, itemsOf(sec).filter(it => m[it.key] === folder)).map(it => it.key);
            const i = sibs.indexOf(key), j = i + (mv.classList.contains("up") ? -1 : 1);
            if (i < 0 || j < 0 || j >= sibs.length) return;
            [sibs[i], sibs[j]] = [sibs[j], sibs[i]];
            const ord = ix.order[sec].filter(k => !sibs.includes(k));
            ix.order[sec] = ord.concat(sibs);
            await writeFileFolders(ix);
            paint();
            return;
          }
          const shh = t.closest(".shh");
          if (shh) { e.stopPropagation(); showHidden[shh.dataset.sec] = !showHidden[shh.dataset.sec]; paint(); return; }
          const lh = t.closest(".lhide");
          if (lh) {
            e.stopPropagation();
            const row = lh.closest(".lr[data-key]");
            const sec = row.dataset.sec, key = row.dataset.key;
            const hid = ix.hidden[sec];
            if (hid.includes(key)) ix.hidden[sec] = hid.filter(k => k !== key);
            else ix.hidden[sec] = hid.concat([key]);
            sel.keys.delete(key);
            await writeFileFolders(ix);
            const nm = sec === "book" ? key : ((list.find(x => x.uid === key) || {}).name || key);
            say(isHidden(sec, key) ? `"${nm}" taken off the list - the file is kept` : `"${nm}" back on the list`);
            paint();
            return;
          }
          const sho = t.closest(".sho");
          if (sho) { e.stopPropagation(); showOld[sho.dataset.sec] = !showOld[sho.dataset.sec]; paint(); return; }
          const wasArmed = delArmed || sdelArmed || bdelArmed;
          const bd = t.closest(".bdel");
          if (bd) {
            e.stopPropagation();
            const name = bd.closest(".lr").dataset.key;
            delArmed = null; sdelArmed = null;
            if (bdelArmed !== name) { bdelArmed = name; paint(); return; }
            bdelArmed = null;
            try {
              const r = await api.fetchApi("/leiel_vpc/book_delete", { method: "POST",
                headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
              const j = await r.json();
              if (!j || !j.ok) throw new Error(j && j.error);
              books = books.filter(x => x.name !== name);
              delete ix.books[name];
              if (ix.order && ix.order.book) ix.order.book = ix.order.book.filter(k => k !== name);
              ix.hidden.book = ix.hidden.book.filter(k => k !== name);
              sel.keys.delete(name);
              if (savedAs === name) savedAs = null;
              say(`book file "${name}" deleted`);
            } catch (err) {
              say("that book file could not be deleted" + (err && err.message ? ` - ${err.message}` : ""), "err");
            }
            paint();
            return;
          }
          bdelArmed = null;
          const sd = t.closest(".sdel");
          if (sd) {
            e.stopPropagation();
            const uid = sd.closest(".lr").dataset.key;
            delArmed = null;
            if (sdelArmed !== uid) { sdelArmed = uid; paint(); return; }
            sdelArmed = null;
            const s = list.find(x => x.uid === uid);
            try {
              const r = await api.fetchApi("/leiel_vpc/series_delete", { method: "POST",
                headers: { "Content-Type": "application/json" }, body: JSON.stringify({ uid }) });
              const j = await r.json();
              if (!j || !j.ok) throw new Error(j && j.error);
              list = list.filter(x => x.uid !== uid);
              delete ix.series[uid];
              ix.hidden.series = ix.hidden.series.filter(k => k !== uid);
              sel.keys.delete(uid);
              say(`series file "${s ? s.name : uid}" deleted`);
            } catch (err) {
              say("that series file could not be deleted" + (err && err.message ? ` - ${err.message}` : ""), "err");
            }
            paint();
            return;
          }
          sdelArmed = null;
          const del = t.closest(".fdel");
          if (del) {
            e.stopPropagation();
            const f = del.closest(".lfd").dataset.f;
            if (delArmed !== f) { delArmed = f; paint(); return; }
            delArmed = null;
            const up = fParent(f);
            ix.folders = ix.folders.filter(x => x !== f);
            ix.open = ix.open.filter(x => x !== f);
            if (ix.colors) delete ix.colors[f];
            for (const m of [ix.books, ix.series]) {
              for (const k of Object.keys(m)) if (m[k] === f) { if (up) m[k] = up; else delete m[k]; }
            }
            /* the folders inside it move up a level, under new names if
               one already sits there */
            for (const sub of ix.folders.filter(x => fParent(x) === f)) {
              let to = (up ? up + "/" : "") + fLeaf(sub), i = 2;
              while (ix.folders.includes(to)) to = (up ? up + "/" : "") + fLeaf(sub) + " " + i++;
              movePath(ix, sub, to);
            }
            await writeFileFolders(ix);
            say(`folder "${fLeaf(f)}" removed - what was in it moved ${up ? `into "${fLeaf(up)}"` : "back to the list"}`);
            paint();
            return;
          }
          delArmed = null;
          const sub = t.closest(".fsub");
          if (sub) {
            e.stopPropagation();
            const parent = sub.closest(".lfd").dataset.f;
            let n = parent + "/New folder", i = 2;
            while (ix.folders.includes(n)) n = parent + "/New folder " + i++;
            const at = ix.folders.indexOf(parent);
            ix.folders.splice(at + 1, 0, n);
            if (!ix.open.includes(parent)) ix.open.push(parent);
            ix.open.push(n);
            renaming = { f: n, sec: sub.closest(".lfd").dataset.sec };
            await writeFileFolders(ix);
            paint();
            return;
          }
          const ren = t.closest(".fren");
          if (ren) {
            e.stopPropagation();
            const fd = ren.closest(".lfd");
            renaming = { f: fd.dataset.f, sec: fd.dataset.sec };
            paint();
            return;
          }
          /* A double click is read here, from two clicks on the same name:
             each click draws the list again, so the browser never sees the
             second click land on the element the first one did. */
          const nameHit = t.closest("b") && t.closest(".lfd, .lr[data-key]");
          const nameKey = nameHit ? (nameHit.dataset.f || (nameHit.dataset.sec + ":" + nameHit.dataset.key)) : null;
          const twice = nameKey && lastName.key === nameKey && Date.now() - lastName.t < 400;
          lastName = { key: nameKey, t: twice ? 0 : Date.now() };
          if (twice) {
            e.stopPropagation();
            if (nameHit.classList.contains("lfd")) {
              const f = nameHit.dataset.f;
              if (f === ARCHIVE) { paint(); return; }
              /* the first click folded or unfolded it - put that back */
              if (!q.trim()) {
                ix.open = ix.open.includes(f) ? ix.open.filter(x => x !== f) : [...ix.open, f];
                writeFileFolders(ix);
              }
              renaming = { f, sec: nameHit.dataset.sec };
            } else if (nameHit.dataset.sec === "series" && here.has(nameHit.dataset.key)) {
              say("this series is open in the book - rename it on its own bar (double click its name)");
            } else {
              sel.sec = null; sel.keys.clear(); sel.at = null;
              fileNaming = { sec: nameHit.dataset.sec, key: nameHit.dataset.key };
            }
            paint();
            return;
          }
          const fd = t.closest(".lfd");
          if (fd) {
            e.stopPropagation();
            if (!q.trim()) {
              const f = fd.dataset.f;
              ix.open = ix.open.includes(f) ? ix.open.filter(x => x !== f) : [...ix.open, f];
              writeFileFolders(ix);
            }
            paint();
            return;
          }
          const tog = t.closest(".ls[data-sec]");
          if (tog) {
            e.stopPropagation();
            const sec = tog.dataset.sec;
            shut[sec] = !shut[sec];
            setFilesUi({ [sec + "Shut"]: shut[sec] });
            paint();
            return;
          }
          /* A double click on a file row - anywhere but its name, which
             renames - opens it, the same as its Open / Bring back button.
             Read from two clicks for the same reason as the name above. */
          const rowHit = t.closest(".lr[data-key]");
          const rowKey = rowHit && !t.closest("b, button, input") && !e.ctrlKey && !e.metaKey && !e.shiftKey
            ? rowHit.dataset.sec + ":" + rowHit.dataset.key : null;
          const rowTwice = rowKey && lastRow.key === rowKey && Date.now() - lastRow.t < 400;
          lastRow = { key: rowKey, t: rowTwice ? 0 : Date.now() };
          if (rowTwice) {
            e.stopPropagation();
            if (rowHit.dataset.sec === "book") await openBookFile(rowHit.dataset.key);
            else if (here.has(rowHit.dataset.key)) say("this series is already open in the book");
            else await bringBackSeries(rowHit.dataset.key);
            return;
          }
          const bop = t.closest(".bop");
          if (bop) {
            e.stopPropagation();
            await openBookFile(bop.closest(".lr").dataset.key);
            return;
          }
          const ld = t.closest(".ld");
          if (ld) {
            e.stopPropagation();
            await bringBackSeries(ld.closest(".lr").dataset.key);
            return;
          }
          async function openBookFile(name) {
            try {
              const r = await api.fetchApi("/leiel_vpc/books?name=" + encodeURIComponent(name));
              const j = await r.json();
              const doc = j && j.ok ? readBookFile(j.book) : null;
              if (!doc) throw new Error("unreadable");
              askOpen(box, doc, name);
            } catch (err) {
              say("that book file could not be read", "err");
            }
          }
          async function bringBackSeries(uid) {
            try {
              const r = await api.fetchApi("/leiel_vpc/series?uid=" + encodeURIComponent(uid));
              const j = await r.json();
              if (!j || !j.ok) throw new Error(j && j.error);
              close();
              loadSeries(j.series);
            } catch (err) {
              say("that series file could not be read", "err");
            }
          }
          const row = t.closest(".lr[data-key]");
          if (row && !t.closest("button")) {
            e.stopPropagation();
            const sec = row.dataset.sec, key = row.dataset.key;
            if (e.ctrlKey || e.metaKey) {
              if (sel.sec !== sec) { sel.sec = sec; sel.keys.clear(); }
              if (sel.keys.has(key)) sel.keys.delete(key); else sel.keys.add(key);
              sel.at = key;
            } else if (e.shiftKey && sel.sec === sec && sel.at) {
              const order = [...box.querySelectorAll(`.lsec[data-sec="${sec}"] .lr[data-key]`)].map(r => r.dataset.key);
              const a = order.indexOf(sel.at), b = order.indexOf(key);
              if (a >= 0 && b >= 0) {
                for (let i = Math.min(a, b); i <= Math.max(a, b); i++) sel.keys.add(order[i]);
              }
            } else if (e.shiftKey) {
              sel.sec = sec; sel.keys.clear(); sel.keys.add(key); sel.at = key;
            } else {
              sel.sec = null; sel.keys.clear(); sel.at = null;
            }
            paint();
            return;
          }
          if (wasArmed) paint();
        });

        /* a double click on a name renames it - a folder, a book file or a
           closed series */
        box.addEventListener("dblclick", (e) => {
          const t = e.target instanceof Element ? e.target : null;
          if (!t || t.closest("input, button")) return;
          const fd = t.closest(".lfd");
          if (fd && t.closest("b")) {
            e.stopPropagation();
            renaming = { f: fd.dataset.f, sec: fd.dataset.sec };
            paint();
            return;
          }
          const row = t.closest(".lr[data-key]");
          if (row && t.closest("b")) {
            e.stopPropagation();
            if (row.dataset.sec === "series" && here.has(row.dataset.key)) {
              say("this series is open in the book - rename it on its own bar (double click its name)");
              return;
            }
            fileNaming = { sec: row.dataset.sec, key: row.dataset.key };
            paint();
          }
        });
        /* a file dragged onto a folder goes into it; dragged back onto its
           list, out of any folder. A folder dragged onto another goes inside
           it; onto the list, back to the top. */
        const DT_FOLDER = "application/x-leiel-file-folder";
        const dropTarget = (e) => {
          const t = e.target instanceof Element ? e.target : null;
          if (!t) return null;
          const fc = t.closest(".lfc");
          if (fc && fc.previousElementSibling && fc.previousElementSibling.classList.contains("lfd")) {
            return fc.previousElementSibling;
          }
          return t.closest(".lfd, .lsec, .ls[data-sec]");
        };
        const clearDrop = () => box.querySelectorAll(".drop, .dropb, .dropa").forEach(x => x.classList.remove("drop", "dropb", "dropa"));
        /* A folder dragged over another: the top quarter of its bar puts it
           before, the bottom quarter after, the middle inside. */
        const folderZone = (e, el) => {
          const r = el.getBoundingClientRect();
          const y = (e.clientY - r.top) / (r.height || 1);
          return y < 0.28 ? "before" : y > 0.72 ? "after" : "into";
        };
        box.addEventListener("dragstart", (e) => {
          const fdr = e.target instanceof Element ? e.target.closest(".lfd") : null;
          if (fdr && e.target === fdr) {
            e.stopPropagation();
            e.dataTransfer.setData(DT_FOLDER, fdr.dataset.f);
            e.dataTransfer.effectAllowed = "move";
            return;
          }
          const row = e.target instanceof Element ? e.target.closest(".lr[data-key]") : null;
          if (!row) return;
          e.stopPropagation();
          const sec = row.dataset.sec, key = row.dataset.key;
          const keys = sel.sec === sec && sel.keys.has(key) ? [...sel.keys] : [key];
          e.dataTransfer.setData(DT_FILE, JSON.stringify({ sec, keys }));
          e.dataTransfer.effectAllowed = "move";
        });
        /* The list does not scroll by itself while something is dragged, so a
           folder whose bar has gone off the top could not be reached. Held
           near the top or bottom edge, the list scrolls that way - faster the
           closer to the edge. */
        const dragScroll = (e) => {
          const t = e.target instanceof Element ? e.target : null;
          const sc = t && t.closest(".lsec");
          if (!sc || sc.scrollHeight <= sc.clientHeight) return;
          const r = sc.getBoundingClientRect();
          const EDGE = 48;
          const up = e.clientY - r.top, down = r.bottom - e.clientY;
          if (up < EDGE) sc.scrollTop -= Math.ceil((EDGE - up) / 3);
          else if (down < EDGE) sc.scrollTop += Math.ceil((EDGE - down) / 3);
        };
        box.addEventListener("dragover", (e) => {
          if (!e.dataTransfer.types.includes(DT_FILE) && !e.dataTransfer.types.includes(DT_FOLDER)) return;
          dragScroll(e);
          const tg = dropTarget(e);
          if (!tg) return;
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = "move";
          const zone = e.dataTransfer.types.includes(DT_FOLDER) && tg.classList.contains("lfd") ? folderZone(e, tg) : "into";
          const cls = zone === "before" ? "dropb" : zone === "after" ? "dropa" : "drop";
          /* inside a folder's list: the list lights up as well, since its bar
             may be scrolled out of sight */
          const t = e.target instanceof Element ? e.target : null;
          const fc = t && t.closest(".lfc");
          const inList = fc && fc.previousElementSibling === tg && cls === "drop" ? fc : null;
          if (!tg.classList.contains(cls) || (inList && !inList.classList.contains("drop"))) {
            clearDrop(); tg.classList.add(cls);
            if (inList) inList.classList.add("drop");
          }
        });
        box.addEventListener("dragleave", (e) => {
          if (!box.contains(e.relatedTarget)) clearDrop();
        });
        box.addEventListener("dragend", clearDrop);
        box.addEventListener("drop", async (e) => {
          const fsrc = e.dataTransfer.getData(DT_FOLDER);
          if (fsrc) {
            e.preventDefault();
            e.stopPropagation();
            const tg = dropTarget(e);
            clearDrop();
            if (!tg) return;
            const zone = tg.classList.contains("lfd") ? folderZone(e, tg) : "into";
            if (zone !== "into") {
              /* beside another folder: same parent as it, just before or after */
              const ref = tg.dataset.f;
              if (ref === fsrc || fUnder(ref, fsrc)) return;
              const parent = fParent(ref);
              let to = fsrc;
              if (fParent(fsrc) !== parent) {
                to = (parent ? parent + "/" : "") + fLeaf(fsrc);
                let i = 2;
                while (ix.folders.includes(to)) to = (parent ? parent + "/" : "") + fLeaf(fsrc) + " " + i++;
                movePath(ix, fsrc, to);
              }
              const moved = ix.folders.filter(x => fUnder(x, to));
              const rest = ix.folders.filter(x => !fUnder(x, to));
              let at;
              if (zone === "before") at = rest.indexOf(ref);
              else at = rest.reduce((a, x, k) => fUnder(x, ref) ? k : a, -1) + 1;
              ix.folders = [...rest.slice(0, at), ...moved, ...rest.slice(at)];
              await writeFileFolders(ix);
              paint();
              return;
            }
            const into = tg.classList.contains("lfd") ? tg.dataset.f : "";
            if (into === fsrc) return;
            if (into && fUnder(into, fsrc)) { say("a folder cannot go inside a folder of its own", "err"); return; }
            if (fParent(fsrc) === into) return;
            let to = (into ? into + "/" : "") + fLeaf(fsrc), i = 2;
            while (ix.folders.includes(to)) to = (into ? into + "/" : "") + fLeaf(fsrc) + " " + i++;
            movePath(ix, fsrc, to);
            /* keep the moved tree right after its new parent */
            const moved = ix.folders.filter(x => fUnder(x, to));
            const rest = ix.folders.filter(x => !fUnder(x, to));
            const at = into ? rest.reduce((a, x, k) => fUnder(x, into) ? k : a, -1) : rest.length - 1;
            ix.folders = [...rest.slice(0, at + 1), ...moved, ...rest.slice(at + 1)];
            if (into && !ix.open.includes(into)) ix.open.push(into);
            await writeFileFolders(ix);
            say(into ? `"${fLeaf(fsrc)}" moved into "${fLeaf(into)}"` : `"${fLeaf(fsrc)}" moved to the top`);
            paint();
            return;
          }
          const raw = e.dataTransfer.getData(DT_FILE);
          if (!raw) return;
          e.preventDefault();
          e.stopPropagation();
          const tg = dropTarget(e);
          clearDrop();
          if (!tg) return;
          let d = null;
          try { d = JSON.parse(raw); } catch (err) { d = null; }
          if (!d || !Array.isArray(d.keys) || (d.sec !== "book" && d.sec !== "series")) return;
          const folder = tg.classList.contains("lfd") ? tg.dataset.f : null;
          const m = mapOf(d.sec);
          let n = 0;
          for (const k of d.keys) {
            if ((m[k] || null) === folder) continue;
            if (folder) m[k] = folder; else delete m[k];
            n++;
          }
          sel.sec = null; sel.keys.clear(); sel.at = null;
          if (!n) { paint(); return; }
          await writeFileFolders(ix);
          const what = `${n} ${d.sec === "book" ? "book" : "series"} file${n === 1 ? "" : "s"}`;
          say(folder ? `${what} moved to "${fLeaf(folder)}"` : `${what} taken out of ${n === 1 ? "its" : "their"} folder`);
          paint();
        });

        paint();
        fq.focus();
      }

      /* ---------- the book panel ---------- */
      /* Drawn only when something on it has changed.

         save() runs far more often than the book changes - ComfyUI serialises
         the whole graph on every mouse release to track edits, and that calls
         save(). Rebuilding the panel each time replaced the button under the
         pointer between press and release, so the browser never delivered the
         click: Import, New and the rest simply did nothing. */
      let bookSig = "";
      /* ---------- the Drawer, drawn ----------
         Cards rather than chips: a thumbnail when one was kept, the name and
         its tags. Filtered by kind and by tag from the bar, and by the find
         box as it is typed - the find box hides cards in place rather than
         repainting, so the caret stays where it is. */
      let armedDr = null;
      /* the folder whose actions are open under the folder bar, and the
         second click its delete asks for */
      let fMenu = null, fDelArmed = false;
      /* cards picked with Ctrl or Shift, to drag into a folder together */
      const drSel = new Set();
      let drSelAt = null;
      let drQ = "";
      /* The open prompt read by the anchor check. */
      function promptCheck() {
        const p = activePrompt();
        if (!p) return [];
        const anchors = p.caps.map(id => book.caps[id]).filter(c => c && c.kind !== "trigger")
          .map(c => ({ kind: c.kind, name: c.name, text: String(c.sec.text || "") }));
        return anchorCheck(anchors, latentShape());
      }
      /* What putting one anchor in would start: the clashes the open prompt
         would have with it in place of its kind, which it itself is part of.
         Read before it is chosen, so a pose that cannot live with the camera
         says so on the shelf. */
      function riskCtx() {
        const p = activePrompt();
        if (!p) return null;
        const base = p.caps.map(id => book.caps[id]).filter(c => c && c.kind !== "trigger")
          .map(c => ({ kind: c.kind, name: c.name, text: String(c.sec.text || "") }));
        const shape = latentShape();
        return { base, shape, texts: new Set(base.map(a => a.text.replace(/\s+/g, " ").trim().toLowerCase())),
                 cur: anchorCheck(base, shape).filter(x => x.level === "warn") };
      }
      /* The clashes an anchor would be part of - with it in place of its
         kind, or as it stands when it is already in the prompt - keeping only
         the ones it decides: a clash that is there just the same with its
         kind left out is not its doing. With a walking pose under a close
         portrait every outfit has shoes, but changing the outfit mends
         nothing; the pose is the one to change, so only the pose is marked. */
      function riskOf(ctx, kind, name, text) {
        if (!ctx || !String(text || "").trim()) return [];
        const inIt = ctx.texts.has(String(text).replace(/\s+/g, " ").trim().toLowerCase());
        const rest = ctx.base.filter(a => a.kind !== kind);
        const withIt = inIt ? ctx.cur
          : anchorCheck(rest.concat([{ kind, name, text: String(text) }]), ctx.shape).filter(x => x.level === "warn");
        const mine = withIt.filter(x => x.kinds.includes(kind));
        if (!mine.length) return [];
        const key = (x) => x.short || x.title;
        const without = new Set(anchorCheck(rest, ctx.shape).filter(x => x.level === "warn").map(key));
        return mine.filter(x => !without.has(key(x)));
      }
      /* "vs Camera" - what the card would clash with, the camera first */
      function riskBadge(r, kind) {
        const others = r.kinds.filter(k => k !== kind);
        if (!others.length) return r.short || r.title;
        const k = others.includes("camera") ? "camera" : others[0];
        return "vs " + (KIND_LABEL[k] || k);
      }
      function checkHtml(list) {
        const kc = (k) => `<span class="ck-k" style="--k:${KIND_HUE[k] || KIND_HUE.other}">${KIND_LABEL[k] || k}</span>`;
        if (!list.length) return `<div class="lsb-chk ok"><i>&#10003;</i>The anchors agree - nothing pulls the frame two ways.</div>`;
        return `<div class="lsb-chk">` + list.map(x => `<div class="ck ${x.level}">`
          + `<i>${x.level === "warn" ? "!" : "i"}</i><div class="b">`
          + `<div class="t">${escapeHtml(x.title)}<span class="ks">${x.kinds.map(kc).join("")}</span></div>`
          + `<div class="w">${escapeHtml(x.why)}</div>`
          + `<div class="f">${escapeHtml(x.fix)}</div></div></div>`).join("") + `</div>`;
      }
      /* bigger cards read more of their words */
      function drawerSizeClass(n) { return n >= 180 ? "dz-l" : n >= 136 ? "dz-m" : "dz-s"; }
      function drawerHtml() {
        if (!drawerStore.loaded) drawerLoad();
        const dr = bookUi().dr;
        const every = drawerStore.items;
        const allFolders = drawerStore.folders || [];
        const fk = DRAWER_KINDS.includes(dr.kind) ? dr.kind : null;
        /* each kind has its own folders; All shows every kind's */
        const folders = allFolders.filter(f => !fk || fKind(f) === fk);
        const fOf = (x) => (x.folder && allFolders.includes(x.folder) && fKind(x.folder) === x.kind ? x.folder : "");
        /* Like a file window: at the top, the folders and the cards in no
           folder; double click a folder to go in. */
        const fsel = dr.folder && folders.includes(dr.folder) ? dr.folder : "";
        const all = every.filter(x => fOf(x) === fsel);
        const ofKind = dr.kind === "all" ? all : all.filter(x => x.kind === dr.kind);
        const tags = [...new Set(ofKind.flatMap(x => x.tags || []))].sort((a, b) => a.localeCompare(b));
        const picked = dr.tag.filter(t => tags.includes(t));
        const byKind = (xs) => dr.kind === "all" || dr.kind === "now" ? xs : xs.filter(x => x.kind === dr.kind);
        const hasAll = (x) => picked.every(t => (x.tags || []).includes(t));
        const cardHay = (x) => `${x.name} ${(x.tags || []).join(" ")} ${x.text}`.toLowerCase();
        /* A folder shows only while it holds something the picked tags let
           through - an empty-handed folder is not left standing among the
           cards that matched. Find does the same with the words below. */
        const folderTile = (f) => {
          const inF = byKind(every.filter(x => fOf(x) === f));
          const hits = picked.length ? inF.filter(hasAll) : inF;
          if (picked.length && !hits.length) return "";
          const fHay = [fName(f).toLowerCase()].concat(hits.map(cardHay)).join("\n");
          const pics = inF.filter(x => x.thumb).slice(0, 4);
          return `<div class="lsb-dfold${fMenu === f ? " menu" : ""}" data-f="${escapeHtml(f)}" data-hay="${escapeHtml(fHay)}" style="--k:${KIND_HUE[fKind(f)] || "#c9a453"}"`
            + ` title="${escapeHtml(fName(f))} - ${escapeHtml(KIND_LABEL[fKind(f)] || "")} folder\nclick to open; cards kept while it is open go into it\ndrop cards here to move them in\nright click: rename, tag every card, delete">`
            + `<span class="fkl"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 4.2c0-.7.5-1.2 1.2-1.2h3.4l1.4 1.6h5.8c.7 0 1.2.5 1.2 1.2v6.4c0 .7-.5 1.2-1.2 1.2H2.7c-.7 0-1.2-.5-1.2-1.2z"/></svg>${escapeHtml(KIND_LABEL[fKind(f)] || "")}</span>`
            + `<div class="fic"><svg viewBox="0 0 64 52" aria-hidden="true"><path d="M3 9a5 5 0 0 1 5-5h16l6 6h26a5 5 0 0 1 5 5v29a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5z"/></svg>`
            + (pics.length ? `<div class="pv n${pics.length}">${pics.map(x => `<img src="${x.thumb}" alt="">`).join("")}</div>` : "")
            + `</div><div class="cap"><div class="nm">${escapeHtml(fName(f))}</div><div class="tg">`
            + (picked.length ? `${hits.length} of ${inF.length} card${inF.length === 1 ? "" : "s"}` : `${inF.length} card${inF.length === 1 ? "" : "s"}`)
            + `</div></div></div>`;
        };
        const nSel = drSel.size;
        const folderBar = `<div class="lsb-dfs">`
          + `<span class="lsb-dcr root${fsel ? "" : " on"}" title="${fsel ? "Back to the top of the drawer - drop cards here to take them out of their folder" : "The top of the drawer"}">`
          + `<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M1.5 4.2c0-.7.5-1.2 1.2-1.2h3.4l1.4 1.6h5.8c.7 0 1.2.5 1.2 1.2v6.4c0 .7-.5 1.2-1.2 1.2H2.7c-.7 0-1.2-.5-1.2-1.2z"/></svg>Drawer</span>`
          + (fsel ? `<span class="lsb-dcs">&#8250;</span><span class="lsb-dcr on cur" data-f="${escapeHtml(fsel)}" title="right click: rename, tag every card, delete">${escapeHtml(fName(fsel))}</span>` : "")
          + `<span class="sp"></span>`
          + (nSel ? `<span class="lsb-dsel">${nSel} selected - drag onto a folder<span class="lsb-dfb clrsel">clear</span></span>` : "")
          + `<span class="lsb-df add newc" title="A new card written by hand - for an anchor that is in no scene yet${fsel ? `; it goes into ${escapeHtml(fName(fsel))}` : ""}">+ card</span>`
          + (fsel ? "" : fk
            ? `<span class="lsb-df add" title="A new ${KIND_LABEL[fk].toLowerCase()} folder - cards kept while it is open go into it">+ folder</span>`
            : `<span class="lsb-df add off" title="Pick a kind first - Pose, Outfit... - each kind keeps its own folders">+ folder</span>`)
          + `</div>`
          + (fMenu !== null && folders.includes(fMenu)
            ? `<div class="lsb-dfm"><b>${escapeHtml(fName(fMenu))}</b>`
              + `<span class="lsb-dfb ren" title="rename the folder">rename</span>`
              + `<input class="lsb-dfin tagall" placeholder="tag every card in it..." title="Enter adds this tag to every card in the folder">`
              + `<span class="lsb-dfb del${fDelArmed ? " armed" : ""}" title="The folder goes; its cards stay, at the top of the drawer">${fDelArmed ? "delete it?" : "delete folder"}</span>`
              + `<span class="lsb-dfb cls" title="close">&#10005;</span></div>`
            : "");
        const tiles = fsel ? "" : folders.map(folderTile).join("");
        /* every kind's folders just before that kind's cards, in the order
           of the kinds - not all the folders lumped at the front */
        const gridHtml = (cards) => fsel || fk ? tiles + cards.map(card).join("")
          : DRAWER_KINDS.map(k => folders.filter(f => fKind(f) === k).map(folderTile).join("")
              + cards.filter(x => x.kind === k).map(card).join("")).join("");
        const shown = ofKind.filter(hasAll);
        const count = (k) => k === "all" ? all.length : all.filter(x => x.kind === k).length;
        const tab = (k) => `<span class="lsb-dk${dr.kind === k ? " on" : ""}" data-k="${k}"`
          + (k === "all" ? "" : ` style="--k:${KIND_HUE[k]}"`)
          + ` title="${k === "all" ? "Everything in the drawer" : `Only ${KIND_LABEL[k].toLowerCase()} anchors`}">`
          + `${k === "all" ? "All" : KIND_LABEL[k]}<i>${count(k)}</i></span>`;
        const now = dr.kind === "now";
        const p = activePrompt();
        /* an emptied box is no anchor yet - it is not counted or shown */
        const nowCaps = p ? p.caps.map(id => book.caps[id])
          .filter(c => c && c.kind !== "trigger" && String((c.sec || {}).text || "").trim())
          .map((c, i) => ({ c, i })).sort((a, b) =>
            (KIND_ORDER.indexOf(a.c.kind) - KIND_ORDER.indexOf(b.c.kind)) || (a.i - b.i)).map(o => o.c) : [];
        /* This Prompt: the open prompt laid out as a set of cards, one per
           anchor in the order they are written - each wearing the picture of
           the drawer card with its words, so the whole look of a scene can be
           read at a glance. */
        const chk = now ? promptCheck() : [];
        const flagged = new Set(chk.filter(x => x.level === "warn").flatMap(x => x.kinds));
        const nowCard = (c) => {
          const m = drawerMatch(c.kind, c.sec.text, false);
          const th = m && m.thumb;
          const hue = KIND_HUE[c.kind] || KIND_HUE.other;
          const hay = `${c.name} ${KIND_LABEL[c.kind] || c.kind} ${String(c.sec.text || "")}`.toLowerCase();
          return `<div class="lsb-dc now${th ? "" : " flat"}${m ? "" : " loose"}${flagged.has(c.kind) ? " flag" : ""}" data-cap="${c.id}"${m ? ` data-id="${escapeHtml(m.id)}"` : ""}`
            + ` data-hay="${escapeHtml(hay)}" style="--k:${hue}">`
            + `<div class="th${th ? "" : " none"}">${th ? `<img src="${th}" alt="">`
              : `<div class="ex">${escapeHtml(String(c.sec.text || ""))}</div>`
                + (m ? "" : `<span class="ph">not in the drawer</span>`)}</div>`
            + `<span class="kl"><i></i>${escapeHtml(KIND_LABEL[c.kind] || c.kind)}</span>`
            + (flagged.has(c.kind) ? `<span class="fl" title="Part of a clash - see above">!</span>` : "")
            + `<div class="cap"><div class="nm">${escapeHtml(c.name || KIND_LABEL[c.kind] || "")}</div></div>`
            + `</div>`;
        };
        /* A card whose words the open prompt is using is framed, so a glance
           at the drawer says which one is in. */
        const normT = (t) => String(t || "").replace(/\s+/g, " ").trim().toLowerCase();
        const inUse = new Set(nowCaps.map(c => normT(c.sec.text)).filter(Boolean));
        const rctx = riskCtx();
        const card = (x) => {
          const hay = `${x.name} ${(x.tags || []).join(" ")} ${x.text}`.toLowerCase();
          const live = inUse.has(normT(x.text));
          const risk = riskOf(rctx, x.kind, x.name, x.text);
          return `<div class="lsb-dc${x.thumb ? "" : " flat"}${drSel.has(x.id) ? " sel" : ""}${armedDr === x.id ? " armed" : ""}${live ? " live" : ""}${risk.length ? " risk" : ""}" draggable="true" data-id="${escapeHtml(x.id)}"`
            + ` data-hay="${escapeHtml(hay)}" style="--k:${KIND_HUE[x.kind]}">`
            + (x.thumb ? "" : `<span class="fk">${KIND_LABEL[x.kind]}</span>`)
            + `<div class="th${x.thumb ? "" : " none"}">${x.thumb ? `<img src="${x.thumb}" alt="">`
              : `<div class="ex">${escapeHtml(x.text)}</div>`}</div>`
            /* a card with a picture names its anchor over it, as the
               cards of the open prompt do; a card of words names it in its
               own first line */
            + (x.thumb ? `<span class="kl"><i></i>${KIND_LABEL[x.kind]}</span>` : "")
            + `<span class="ck" title="pick - drag a picked card onto a folder and every picked card goes">&#10003;</span>`
            + (live ? `<span class="lv" title="In the open prompt">In use</span>` : "")
            + (risk.length ? `<span class="rk" title="${escapeHtml(risk[0].title)}">! ${escapeHtml(riskBadge(risk[0], x.kind))}</span>` : "")
            + `<div class="cap"><div class="nm">${escapeHtml(x.name)}</div>`
            + ((x.tags || []).length ? `<div class="tg">${x.tags.map(escapeHtml).join(" · ")}</div>` : "")
            + `</div>`
            + `<span class="x" title="${armedDr === x.id ? "click again to take it out of the drawer for good" : "take it out of the drawer"}">${armedDr === x.id ? "delete?" : "&#10005;"}</span>`
            + `</div>`;
        };
        const tone = DRAWER_TONES[dr.tone] || DRAWER_TONES[0];
        const pct = Math.round(100 * (dr.size - DRAWER_SIZE[0]) / (DRAWER_SIZE[1] - DRAWER_SIZE[0]));
        const sizer = `<span class="lsb-dsz" title="Card size">`
          + `<input class="lsb-light" type="range" min="${DRAWER_SIZE[0]}" max="${DRAWER_SIZE[1]}" step="2" value="${dr.size}" style="--pct:${pct}%"></span>`;
        return `<div class="lsb-drawer${dr.open ? "" : " shut"}${drSel.size ? " picking" : ""} ${drawerSizeClass(dr.size)}" style="--dbg:${tone[1]};--dbd:${tone[2]};--dsz:${dr.size}px${dr.h ? `;--dgh:${dr.h}px` : ""}">`
          + `<div class="lsb-head lsb-drhead" title="${dr.open ? "Fold" : "Open"} the drawer - anchors kept for good, for any series">`
          + `<span class="lsb-lab lsb-tog"><i class="tw">&#9662;</i>Drawer</span>`
          + `<span class="lsb-count" title="every card in the drawer">${every.length}</span>`
          + `<span class="lsb-dtone" title="Drawer colour: ${tone[0]} - click for the next one, Shift+click for the one before"></span>`
          + (dr.open ? `<span class="lsb-dks"><span class="lsb-dk now${now ? " on" : ""}" data-k="now"`
              + ` title="The open prompt as a set of cards - every anchor it uses, with its picture">This Prompt<i>${nowCaps.length}</i></span>`
              + `<span class="lsb-dsep"></span>${["all"].concat(DRAWER_KINDS).map(tab).join("")}</span>` : "")
          + `<span style="flex:1"></span>`
          + (dr.open ? `<input class="lsb-dq" type="text" placeholder="find" value="${escapeHtml(drQ)}" title="Narrow the drawer to cards whose name, tags or words contain this">` : "")
          + `<span class="lsb-dlay" title="Where the drawer sits: under the book, or beside it with the anchors so the node stays shorter">`
          + `<button class="lay${drawerBeside() ? "" : " on"}" data-side="0" title="Drawer under the book">`
          + `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="2.5" y="2.5" width="11" height="4.5" rx="1"/><rect x="2.5" y="9" width="11" height="4.5" rx="1"/></svg></button>`
          + `<button class="lay${drawerBeside() ? " on" : ""}" data-side="1" title="Drawer beside the book, above the anchors - turns the anchors beside the book on as well">`
          + `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="2.5" y="2.5" width="4.5" height="11" rx="1"/><rect x="9" y="2.5" width="4.5" height="11" rx="1"/></svg></button>`
          + `</span>`
          + `<span class="lsb-chelp lsb-dhelp" title="How the Drawer works - keeping, using, finding, pictures">?</span>`
          + `</div>`
          + (dr.open && now
            ? `<div class="lsb-dnow">${p ? `<b>${escapeHtml(numOf(p))}</b> ${escapeHtml(p.name || "")}`
                + `<span>${nowCaps.length} anchor${nowCaps.length === 1 ? "" : "s"} - `
                + `${nowCaps.filter(c => drawerThumbFor(c.kind, c.sec.text)).length} with a picture</span>` : "no prompt open"}${sizer}</div>`
              + `<div class="lsb-dgrid">${nowCaps.map(nowCard).join("")
                || `<div class="lsb-none">The open prompt has no anchors yet.</div>`}</div>`
              /* the cards first - what the scene is made of - and what to
                 watch for in them underneath */
              + (p && nowCaps.length ? checkHtml(chk) : "")
            : dr.open
            ? folderBar + `<div class="lsb-dtags">${tags.map(t => {
                const on = picked.includes(t);
                /* a tag that would leave nothing, with the ones already picked */
                const none = !on && !shown.some(x => (x.tags || []).includes(t));
                return `<span class="lsb-dt${on ? " on" : ""}${none ? " none" : ""}" data-t="${escapeHtml(t)}"`
                  + ` title="${on ? "click to drop this tag" : "click to add this tag - only cards with every picked tag are shown"}">${escapeHtml(t)}</span>`;
              }).join("")}`
              + (picked.length ? `<span class="lsb-dt clr" title="show every card again">clear</span>` : "")
              + `<span class="sp"></span>${sizer}</div>`
              + `<div class="lsb-dgrid">${gridHtml(shown)
                || `<div class="lsb-none">${all.length ? "Nothing here under this kind or tag."
                  : fsel && every.length ? "This folder is empty. Keep a card while it is open, or drop cards on it from the top of the drawer."
                  : "Empty. Drag a capsule here, or right click one, to keep it."}</div>`}</div>`
            : "")
          + `</div>`;
      }

      function paintBook(force) {
        if (!BOOK || !book) return;
        const host = root.querySelector(".lsb-book");
        if (!host) return;
        stampBirths();
        const sig = JSON.stringify([
          book.groups.map(g => [g.id, g.no, g.name, g.open, g.hue, g.note, g.memo || "", g.memoHtml || "", g.memoLead || 0, g.memoOpen !== false, g.thumb ? g.thumb.length : 0, unsaved(g)]),
          book.prompts.map(q => [q.id, q.g, q.no, q.name, q.caps, orientOf(q), q.note || "", q.thumb ? q.thumb.length : 0]), book.active,
          book.shelf, book.shelfView,
          Object.values(book.caps).map(c => [c.id, c.g, c.kind, c.name, c.born,
            String(c.sec.text || "").slice(0, 500)]),
          bookFind ? [...bookFind.hits] : null, armedDel, bookUi().tr, capTarget(), bookUi().used, bookUi().mine,
          book.prompts.length, drawerStore.rev, bookUi().dr, armedDr, fMenu, fDelArmed, [...drSel].join(","), latentShape(), sideMode(), bookUi().kf]);
        applyBookLook(host);
        paintNow();
        if (!force && sig === bookSig && host.firstChild) return;
        bookSig = sig;
        const p = activePrompt();
        const ag = activeGroup();
        const uses = useCounts();
        const open = new Set(p ? p.caps : []);
        const order = new Map();
        const usedBy = new Map();          // capsule id -> the prompts it is in, in shelf order
        orderedPrompts().forEach((q, i) => q.caps.forEach(c => {
          if (!order.has(c)) order.set(c, i);
          if (!usedBy.has(c)) usedBy.set(c, []);
          if (!usedBy.get(c).includes(q)) usedBy.get(c).push(q);
        }));
        const many = book.groups.length > 1;
        /* A capsule remembers the prompt it was last in, so one taken out
           still says where it came from. Kept as the prompt's number in its
           series - prompt ids change when a series is read back from file. */
        for (const [cid, qs] of usedBy) {
          const c = book.caps[cid];
          if (c && qs[0] && qs[0].g === c.g && qs[0].no > 0) c.was = qs[0].no;
        }
        const wasOf = (c) => {
          const has = (no) => book.prompts.some(q => q.g === c.g && q.no === no);
          if (c.was && has(c.was)) return c.was;
          /* older capsules carry no record: take it from a version of the
             same capsule still in use - "Herself Again" from "Herself Again 2" */
          const stem = String(c.name || "").replace(VER_RE, "").trim().toLowerCase();
          for (const [cid, qs] of usedBy) {
            const o = book.caps[cid];
            if (o && o.g === c.g && o.kind === c.kind && qs[0]
                && String(o.name || "").replace(VER_RE, "").trim().toLowerCase() === stem) return qs[0].no;
          }
          return 0;
        };
        const noLabel = (g, no) => many && g ? `${g.no}-${pad2(no)}` : pad2(no);
        /* On a capsule the series figure is set apart - bold, in the series'
           own colour, a gap before the scene - so "2-01-1" reads as series 2,
           scene 01, first try rather than a string of numbers. */
        const noHtml = (g, no) => many && g
          ? `<i class="sn" style="--sn:${seriesTone(g) || SERIES_TONES[0]}">${g.no}</i>${pad2(no)}`
          : pad2(no);

        const chipOf = (q) =>
          `<span class="lsb-p${q.id === book.active ? " on" : ""}${q.note || q.thumb ? " noted" : ""}" draggable="true"`
          + ` data-id="${q.id}" title="${numOf(q)} ${escapeHtml(q.name)}&#10;${q.note ? escapeHtml(String(q.note).trim()) + "&#10;" : ""}click to open - double click to rename - right click to ${q.note || q.thumb ? "edit its note and picture" : "write a note and give it a picture"} - drag to reorder, or onto another series to move it there&#10;drop a capsule here to put it in this prompt">`
          + `<b class="no">${many && groupOf(q) ? `<i class="sn">${groupOf(q).no}</i>` : ""}<i class="sq">${pad2(q.no)}</i></b><span class="pnm">${escapeHtml(q.name)}</span>`
          + `<i class="lsb-or o-${orientOf(q)}" title="Frame: ${ORIENT_NAME[orientOf(q)]} - click for the next, shift+click for the one before.&#10;A Series Lab rendering this prompt has a Visual Latent Size Picker pick only sizes of this shape"></i></span>`;

        const boxes = book.groups.map(g => {
          const mine = promptsOf(g);
          const isOpen = g.open !== false;
          const cur = ag && ag.id === g.id;
          const armed = armedDel === "g" + g.id;
          const tone = seriesTone(g);
          return `<div class="lsb-pbox${cur ? " cur" : ""}${isOpen ? "" : " shut"}${tone ? " tint" : ""}" data-g="${g.id}"`
            + (tone ? ` style="--sg:${tone}"` : "") + `>`
            + `<div class="lsb-ghead">`
            + `<span class="lsb-gcar" title="${isOpen ? "Fold" : "Unfold"} this series">${isOpen ? "&#9662;" : "&#9656;"}</span>`
            + `<b class="lsb-gno">${g.no}</b>`
            + `<span class="lsb-gname" title="double click to rename the series">${escapeHtml(g.name)}</span>`
            + `<span class="lsb-gtone" style="--gt:${tone || SERIES_TONES[0]}" title="Series colour - click for the next one, shift+click for the one before. The Series Lab wears it too"></span>`
            + `<span class="lsb-count">${mine.length}</span>`
            + `<span style="flex:1"></span>`
            + `<span class="lsb-pact">`
            + `<span class="lsb-pi ppaste" title="Paste scenes from the clipboard into this series - always this one, whichever series is open. A new scene name becomes a new prompt with only the anchors it brings; a name already here updates that prompt">${PICON_PASTE}<b>Paste</b></span>`
            + `<span class="lsb-pi ppaste ppall" title="Paste a whole series pack into this series - its name from the # Series heading, the series note, every scene with its note and frame. A scene already here (same name, or same cut code like C-08) is updated - changed anchors become new capsule versions (v2); new scenes are added in order. Nothing is deleted">${PICON_PASTE_ALL}<b>Paste All</b></span>`
            + `<span class="lsb-psep"></span>`
            + (mine.length > 1 || (mine[0] && Number(mine[0].no) !== 1) ? `<span class="lsb-pi psort" title="Put this series' prompts in number order - 01, 02, 03... Shift+click: number them again from 01 in the order they stand now. Undo puts either back">${PICON_SORT}</span>` : "")
            + `<span class="lsb-pi pnew" title="New empty prompt in this series - paste a scene into it or write it in">${PICON_NEW}</span>`
            + `<span class="lsb-pi psave${unsaved(g) ? " dirty" : ""}" title="${unsaved(g) ? "Changed since it was last saved - click to save this series as a book file under its own name" : "Saved - nothing changed since. Click to save this series as a book file under its own name again"}">${PICON_SAVE}</span>`

            + (cur ? `<span class="lsb-pi pdup" title="Duplicate the open prompt - the copy shares every capsule, replace only what changes">${PICON_DUP}</span>`
                   + `<span class="lsb-pi pdel" title="Delete the open prompt - its capsules stay on the shelf, and Undo brings it back">${PICON_DEL}</span>` : "")
            + `</span>`
            + `<span class="lsb-gx${armed ? " armed" : ""}" title="${armed
                ? "click again to close this series - its file is kept, Files brings it back"
                : "close this whole series - it is saved to its own file first"}">${armed ? "close series?" : "&#10005;"}</span>`
            + `</div>`
            + (isOpen ? `<div class="lsb-grow">`
                + `<span class="lsb-gpic${g.thumb ? "" : " none"}" title="The series' picture&#10;Click: see it larger (with no picture: set one)&#10;Double click: take the picture open in a Visual Image Viewer - or choose a file&#10;Drop: a picture onto it&#10;Right click: take it off">`
                + (g.thumb ? `<img src="${g.thumb}" alt="">` : `<i>+</i>`) + `</span>` : "")
            + (isOpen ? `<div class="lsb-gnote${g.note ? "" : " empty"}" title="What this series is - the story, the look, what was tried. Click to write">`
                + (g.note ? escapeHtml(g.note) : "add a note about this series...") + `</div></div>` : "")
            + (isOpen ? `<div class="lsb-prompts">${mine.map(chipOf).join("")}</div>` : "")
            /* the series' memo: working thoughts, kept apart from the note
               above - folds on its own */
            + (isOpen ? `<div class="lsb-gmemo${g.memoOpen === false ? " shut" : ""}">`
                + `<div class="lsb-gmhead" title="${g.memoOpen === false ? "Open" : "Fold"} the production notes">`
                + `<span class="car">${g.memoOpen === false ? "&#9656;" : "&#9662;"}</span><b>Production Notes</b>`
                + `</div>`
                + (g.memoOpen === false ? "" : `<div class="lsb-gmbody lvp-ta${g.memo ? "" : " empty"}"${g.memoLead ? ` style="line-height:${g.memoLead / 100}"` : ""}>`
                  + (g.memo ? (g.memoHtml ? sanitizeMemo(g.memoHtml) : escapeHtml(g.memo))
                     : "write production notes - the scene flow, render notes, ideas, what to fix...") + `</div>`)
                + `</div>` : "")
            + `</div>`;
        }).join("");

        /* Which series the shelf shows: the open one by default, one picked
           by name, or all of them. */
        const view = book.shelfView;
        const viewG = (typeof view === "number" && groupById(view)) ? groupById(view) : null;
        const inView = Object.values(book.caps)
          .filter(c => (String(c.sec.text || "").trim() || open.has(c.id))
            && (view === "all" || (viewG ? c.g === viewG.id : (!ag || c.g === ag.id))));
        /* Capsules no prompt uses: what Tidy would clear. "In use" only
           hides them; Tidy deletes them, and Undo brings them back. */
        const idleCaps = inView.filter(c => !(uses.get(c.id) || 0) && !open.has(c.id));
        /* "This prompt": the shelf as though it held only this scene - every
           capsule written for it (03, 03-1, 03-2, used or not) and whatever
           else it wears now, from whichever series. */
        const pg = p ? groupOf(p) : null;
        const forThis = (c) => open.has(c.id) || (p && (c.born
          ? (pg && c.born.sg === pg.uid && c.born.no === p.no)
          : (c.g === p.g && c.was === p.no)));
        const capList = bookUi().mine
          ? Object.values(book.caps).filter(c => String(c.sec.text || "").trim() && forThis(c))
          : bookUi().used
            ? inView.filter(c => (uses.get(c.id) || 0) || open.has(c.id))
            : inView;
        const shownG = view === "all" ? null : (viewG || ag);
        const capRisk = riskCtx();
        const rows = [];
        for (const kind of KIND_ORDER.concat(["other"])) {
          /* Versions of one capsule sit together: "Herself Again" and
             "Herself Again 2" are one family, placed where its earliest
             member is first used, and in number order inside it - so the
             one being replaced is always next to the one replacing it. */
          const ofKind = capList.filter(c => c.kind === kind);
          const famOf = (c) => `${c.g}|${String(c.name || "").replace(VER_RE, "").trim().toLowerCase()}`;
          const verOf = (c) => { const m = String(c.name || "").match(VER_RE); return m ? Number(m[1]) : 1; };
          const famRank = new Map();
          for (const c of ofKind) {
            /* one no prompt uses sits just after the prompt it was last in */
            const wi = order.has(c.id) ? -1
              : orderedPrompts().findIndex(q => q.g === c.g && q.no === wasOf(c));
            const r = [order.has(c.id) ? order.get(c.id) : wi >= 0 ? wi + 0.5 : 1e6, c.id];
            const k = famOf(c), had = famRank.get(k);
            if (!had || r[0] < had[0] || (r[0] === had[0] && r[1] < had[1])) famRank.set(k, r);
          }
          /* In the order of their numbers - 03-1, 03-2, 03-3 - and the
             order holds when one is picked: putting a capsule in changes
             which is lit, never where it stands. */
          const noOf = (c) => {
            const inP = usedBy.get(c.id) || [];
            return inP.length ? inP[0].no : wasOf(c);
          };
          /* by the number each was given - series, prompt, try - so a
             capsule stays where it was first written whatever uses it now */
          const bkey = (c) => { const r = bornOf(c); return r ? r.sno * 1e6 + r.no * 1e3 + r.seq : 1e12; };
          void noOf;
          const caps = ofKind.sort((a, b) => {
              const ga = groupById(a.g), gb = groupById(b.g);
              return ((ga ? ga.no : 0) - (gb ? gb.no : 0))
                || (bkey(a) - bkey(b))
                || a.id - b.id;
            });
          void famRank; void verOf;
          /* an emptied box is shown only beside capsules of its kind that
             it could go back to - a box that was never filled, like a
             trigger nobody uses, stays off the shelf */
          if (!caps.some(c => String(c.sec.text || "").trim())) continue;
          /* Several tries at one layer of one prompt all wear that prompt's
             number; a second figure counts them in the order they were made,
             so "03-2" is the second camera written for prompt 03. A number
             only one capsule wears stays bare. */
          const pnOf = (c) => {
            const inP = usedBy.get(c.id) || [];
            return inP.length ? inP[0].no : wasOf(c);
          };
          const seqOf = new Map();
          {
            const byNo = new Map();
            for (const c of caps) {
              if (!String(c.sec.text || "").trim()) continue;
              const no = pnOf(c);
              if (!no) continue;
              const k = c.g + "|" + no;
              if (!byNo.has(k)) byNo.set(k, []);
              byNo.get(k).push(c);
            }
            for (const list of byNo.values()) {
              if (list.length < 2) continue;
              list.sort((a, b) => a.id - b.id)
                .forEach((c, i) => seqOf.set(c.id, i + 1));
            }
          }
          const sq = (c) => seqOf.has(c.id) ? `<i class="sq">-${seqOf.get(c.id)}</i>` : "";
          const chipOf = (c) => {
            const u = uses.get(c.id) || 0;
            const risk = riskOf(capRisk, c.kind, c.name, c.sec.text);
            const hit = bookFind && bookFind.hits.get(c.id);
            const cg = groupById(c.g);
            const other = ag && c.g !== ag.id;
            const inP = usedBy.get(c.id) || [];
            const tip = `${c.name}${cg ? ` - series ${cg.no} ${cg.name}` : ""}`
              + (c.born ? `\nfirst written for prompt ${bornLabel(c, true)}` : "")
              + `\n${u ? `in ${u} prompt${u === 1 ? "" : "s"}: ${inP.map(q => `${many ? numOf(q) : pad2(q.no)} ${q.name}`).join(", ")}` : `in no prompt${wasOf(c) ? ` - last in prompt ${noLabel(cg, wasOf(c))}` : ""}`}`
              + `\n\n${String(c.sec.text || "").slice(0, 500)}`
              + `${String(c.sec.text || "").length > 500 ? "..." : ""}`
              + `\n\nclick: put in the open prompt`
              + `\nshift+click: every prompt of this series`
              + `\nctrl+shift+click: every prompt of every series (each gets its own copy)`
              + (other ? `\nfrom another series - it arrives as a copy` : "")
              + `\ndrag onto a section or a prompt - double click to rename`;
            /* The open prompt's own box, emptied to be filled again: shown
               where its capsule will be, so the row never looks as if the
               prompt had lost that layer. */
            const blank = !String(c.sec.text || "").trim();
            if (blank) {
              return `<span class="lsb-c in blank" data-id="${c.id}" title="The ${KIND_LABEL[kind] || kind} of the open prompt is empty - `
                + `read a picture into it or write it, and it becomes a capsule here.\nThe capsules beside it keep what they had - `
                + `click one to put it back.">`
                + `<span class="nm">empty - fill the box</span></span>`;
            }
            return `<span class="lsb-c${open.has(c.id) ? " in" : ""}${hit ? " hit" : ""}${u ? "" : " idle"}${other ? " far" : ""}${risk.length ? " risk" : ""}"`
              + ` draggable="true" data-id="${c.id}">`
              + (risk.length ? `<i class="rk">!</i>` : "")
              /* the series badge only where the number does not already say it */
              + (other && cg && !c.born ? `<b class="sg"${seriesTone(cg) ? ` style="--sg:${seriesTone(cg)}"` : ""}>${cg.no}</b>` : "")
              + (() => {
                  const r = bornOf(c);
                  if (!r) return "";
                  const showS = many || !cg || !c.born || cg.uid !== c.born.sg;
                  const sn = showS ? `<i class="sn" style="--sn:${(r.g && seriesTone(r.g)) || SERIES_TONES[0]}">${r.sno}</i>` : "";
                  const sqs = r.multi || r.seq > 1 ? `<i class="sq">-${r.seq}</i>` : "";
                  return `<b class="pn${u ? "" : " was"}">${sn}${pad2(r.no)}${sqs}${u > 1 ? "+" : ""}</b>`;
                })()
              + `<span class="nm">${escapeHtml(c.name)}</span>`
              + (hit ? `<b class="hn">${hit}</b>` : "")
              + `<b class="u">${u}</b>`
              + `<span class="x${armedDel === c.id ? " armed" : ""}" title="${u
                  ? `delete - it is in ${u} prompt${u === 1 ? "" : "s"}, so click twice`
                  : "delete"}">&#10005;</span>`
              + `</span>`;
          };
          const chips = kindFolded(kind) ? "" : caps.map(chipOf).join("");
          /* A folded kind keeps only what the open prompt uses (and what a
             search found) in view, and says how many more it holds. */
          const folded = kindFolded(kind);
          let shownChips = chips;
          if (folded) {
            const keep = caps.filter(c => open.has(c.id) || (bookFind && bookFind.hits.get(c.id)));
            const more = caps.length - keep.length;
            shownChips = keep.map(c => chipOf(c)).join("")
              + (more ? `<span class="lsb-kmore" title="${more} more ${KIND_LABEL[kind].toLowerCase()} capsule${more === 1 ? "" : "s"} - click to show them">+${more}</span>` : "");
          }
          rows.push(`<div class="lsb-krow${folded ? " kf" : ""}" data-kind="${kind}" style="--k:${KIND_HUE[kind]}">`
            + `<span class="lsb-klab" title="${folded ? "Show" : "Fold"} the ${KIND_LABEL[kind].toLowerCase()} capsules - the open prompt's own stay in view. Shift+click: every kind">`
            + `<i class="kt">&#9662;</i>${KIND_LABEL[kind]}</span>`
            + `<div class="lsb-caps">${shownChips}</div></div>`);
        }

        /* the drawer is rebuilt in the book below; an old one moved beside it goes */
        for (const slot of root.querySelectorAll(".lsb-drbook")) slot.replaceChildren();
        host.innerHTML = `
          <div class="lsb-head">
            <span class="lsb-lab" title="The storyboard - every series in this book, its scenes, pictures and notes">Storyboard</span>
            <span class="lsb-count" title="${book.groups.length} series, ${book.prompts.length} scenes">${book.prompts.length} scene${book.prompts.length === 1 ? "" : "s"}</span>
            <span class="lsb-dot" title="Colour of the book: ${escapeHtml(BOOK_HUES[bookUi().hue][0])} - click for the next one, Shift+click for the one before"></span>
            <input class="lsb-light" type="range" min="0" max="100" step="1" value="${Math.round(bookUi().light * 100)}" title="Brightness of the book">
            <button class="lsb-btn lsb-prev" title="Previous prompt of this series">&#8249;</button>
            <button class="lsb-btn lsb-next" title="Next prompt of this series">&#8250;</button>
            <span style="flex:1"></span>
            <button class="lsb-btn lsb-ser" title="Start a new series in this book, with its own numbers">+ Series</button>
            <button class="lsb-btn lsb-ld" title="Book files and series files: save the whole book, open a saved one, or bring back a series that was closed - click again to close">Files</button>
            <button class="lsb-btn lsb-cpy" title="Copy every prompt of the open series as text, one labelled block per anchor with its capsule's name - shift+click for every series. Pasted back, it applies whatever was changed">Copy Text</button>
            <button class="lsb-btn lsb-imp" title="Bring every Prompt Composer on the canvas into the open series - in Series Lab order when they are wired to one">From Canvas</button>
          </div>
          ${boxes}
          <div class="lsb-capbox${book.shelf ? "" : " shut"}">
          <div class="lsb-head lsb-caphead" title="${book.shelf ? "Fold" : "Open"} the capsules - the anchors the prompts are made of">
            <span class="lsb-lab lsb-tog"><i class="tw">&#9662;</i>Capsules</span>
            <span class="lsb-count" title="${bookUi().mine ? `${capList.length} for this prompt` : bookUi().used && idleCaps.length
              ? `${capList.length} in use shown - ${idleCaps.length} in no prompt hidden` : `${capList.length} capsules`}">${capList.length}${!bookUi().mine && bookUi().used && idleCaps.length ? `<i class="hid">+${idleCaps.length}</i>` : ""}</span>
            <span class="lsb-used lsb-mine${bookUi().mine ? " on" : ""}" title="${bookUi().mine
              ? "Showing only the capsules of the prompt open now - everything written for it and what it wears. Click to show the rest again"
              : "Show only the capsules of the prompt open now - every one written for it (03, 03-1, 03-2...) and what it wears"}">This prompt</span>
            <span class="lsb-used lsb-inuse${bookUi().used ? " on" : ""}${bookUi().mine ? " off" : ""}" title="${bookUi().used
              ? "Showing only the capsules a prompt uses - click to show the unused ones (0) as well"
              : "Hide the capsules no prompt uses (0) - they stay in the book, only out of sight"}">In use</span>
            ${idleCaps.length ? `<span class="lsb-tidy${armedDel === "tidy" ? " armed" : ""}" data-ids="${idleCaps.map(c => c.id).join(",")}" title="${armedDel === "tidy"
              ? `Click again to delete the ${idleCaps.length} capsule${idleCaps.length === 1 ? "" : "s"} no prompt uses - Undo brings them back`
              : `Delete every capsule no prompt uses (0) in ${view === "all" ? "every series" : "the series shown"} - ${idleCaps.length} of them. Asks for a second click; Undo brings them back`}">${armedDel === "tidy"
              ? `Delete ${idleCaps.length}?` : `Tidy ${idleCaps.length}`}</span>` : ""}
            <span class="lsb-trt${bookUi().tr ? " on" : ""}" title="${bookUi().tr
              ? "Translation on - hovering a capsule shows its text in your language as well. Click to turn it off"
              : "Show each capsule's text translated when you hover it - on your own machine, nothing is sent anywhere"}">TR</span>
            ${bookUi().tr ? `<select class="lsb-trl" title="Translate capsules into">`
              + TR_LANGS.filter(([c]) => c !== "en").map(([c, n]) =>
                `<option value="${c}"${capTarget() === c ? " selected" : ""}>${n}</option>`).join("")
              + `</select>` : ""}
            ${many ? `<span class="lsb-sv">`
              + book.groups.map(g => `<span class="lsb-svc${shownG && shownG.id === g.id ? " on" : ""}${seriesTone(g) ? " tint" : ""}" data-g="${g.id}"`
                + (seriesTone(g) ? ` style="--sg:${seriesTone(g)}"` : "")
                + ` title="Show the capsules of series ${g.no} - ${escapeHtml(g.name)}${ag && ag.id === g.id ? " (the open one)" : ""}">`
                + `<b>${g.no}</b>${escapeHtml(g.name)}</span>`).join("")
              + `<span class="lsb-svc all${view === "all" ? " on" : ""}" data-g="all" title="Show every series' capsules">All</span>`
              + `</span>` : ""}
            ${(() => {
              const w = promptCheck().filter(x => x.level === "warn");
              return w.length ? `<span class="lsb-ckc" title="${escapeHtml(w.map(x => "! " + x.title).join("\n"))}\n\nClick to read them - the Drawer's This Prompt tab">! ${w.length} to check</span>` : "";
            })()}
            ${bookFind ? `<span class="lsb-found">${bookFind.total} hit${bookFind.total === 1 ? "" : "s"} in ${bookFind.caps} capsule${bookFind.caps === 1 ? "" : "s"}</span>` : ""}
            <span style="flex:1"></span>
            <span class="lsb-chelp" title="How capsules work - what the numbers mean and what each click does">?</span>
          </div>
          ${book.shelf ? `<div class="lsb-shelf">${rows.join("") || `<div class="lsb-none">Nothing written yet - paste a reply or type into the sections below.</div>`}</div>` : ""}
          </div>
          ${drawerHtml()}`;

        wireBook(host);
        applyBookLook(host);
        placeDrawer();

        /* The panel is part of the node's height; when it changes size the
           node follows at once rather than handing the difference to the
           sections. */
        const h = host.offsetHeight;
        if (h && lastPanelH && h !== lastPanelH) requestAnimationFrame(fitNodeToContent);
        lastPanelH = h;
      }

      /* Which prompt the sections below belong to, said once more right above
         them: the gold chip is up in the book, a scroll away from the text
         being edited. Double click renames it here too. */
      function paintNow() {
        const el = root.querySelector(".lsb-now");
        const p = activePrompt();
        if (!el || !p) return;
        const g = groupOf(p);
        const many = book.groups.length > 1;
        const open = anchorsOpen();
        root.classList.toggle("anch-shut", !open);
        root.classList.toggle("side", sideMode());
        applySplit();
        root.style.setProperty("--pgap", NOW_GAP + "px");
        placeDrawer();
        const side = sideMode();
        const key = p.id + "|" + p.no + "|" + p.name + "|" + (g ? g.no + g.name : "") + many + open + side;
        if (el.dataset.key === key && el.firstChild && !el.querySelector("input")) return;
        el.dataset.key = key;
        el.title = open ? "Fold the anchors away - click the bar" : "Show the anchors of this prompt - click the bar";
        el.innerHTML = `<i class="tw">&#9662;</i><span class="lab">${open ? "Editing" : "Anchors"}</span>`
          + `<b class="no">${many ? numOf(p) : pad2(p.no)}</b>`
          + `<span class="nm" title="double click to rename">${escapeHtml(p.name)}</span>`
          + (open ? "" : `<span class="hint">${state.sections.length} anchors - click to open</span>`)
          + (many && g ? `<span class="gn">${escapeHtml(g.name)}</span>` : "")
          + `<span class="sp"></span>`
          + `<span class="nowlay" title="Where the anchors sit: under the book, or beside it so a long shelf of capsules does not push them down">`
          + `<button class="lay${side ? "" : " on"}" data-side="0" title="Anchors under the book">`
          + `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="2.5" y="2.5" width="11" height="4.5" rx="1"/><rect x="2.5" y="9" width="11" height="4.5" rx="1"/></svg></button>`
          + `<button class="lay${side ? " on" : ""}" data-side="1" title="Anchors beside the book">`
          + `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="2.5" y="2.5" width="4.5" height="11" rx="1"/><rect x="9" y="2.5" width="4.5" height="11" rx="1"/></svg></button>`
          + `</span>`
          + `<button class="lvp-btn nowpaste" title="Paste a whole reply - a scene name and its labelled anchors. A new name becomes a new prompt, a name already in the book updates that prompt. Works with the anchors folded">Paste</button>`;
        for (const b of el.querySelectorAll(".nowlay .lay")) {
          b.addEventListener("click", (e) => {
            e.stopPropagation();
            const want = b.dataset.side === "1";
            if (want !== sideMode()) setSideMode(want);
          });
        }
        el.querySelector(".nowpaste").addEventListener("click", async (e) => {
          e.stopPropagation();
          let text = null;
          try { text = await navigator.clipboard.readText(); } catch (err) { text = null; }
          if (text === null || text === undefined) {
            if (anchorsOpen()) openPasteBox();
            else say("the clipboard could not be read here - press Ctrl+V with the pointer over the book", "err");
            return;
          }
          applyReply(text);
        });
        el.querySelector(".nm").addEventListener("dblclick", (e) => {
          e.stopPropagation();
          const nm = e.currentTarget;
          renameInline(nm, p.name, (v) => {
            p.name = uniquePromptName(v, g, p);
            p.fresh = false;
            el.dataset.key = "";
            touch(); save();
          });
        });
      }

      /* The anchors under the book - the toolbar and the open prompt's
         sections - fold away into the editing bar, and come back when it is
         clicked. Kept with the book, so a workflow opens the way it was left. */
      function anchorsOpen() { return !BOOK || !book || book.anchors !== false; }
      /* The anchors beside the book instead of under it. With a long shelf of
         capsules - and more series, more capsules - the anchors ended up far
         below, the node taller than the screen. Kept with the book's look. */
      function sideMode() { return !!(BOOK && book && bookUi().side); }
      /* The drawer can follow the anchors into their column: with many series
         and a long shelf, the book alone made the node taller than the screen,
         and the drawer under it the most of all. Only beside the book - under
         it there is no other column to go to. */
      function kindFolded(kind) { return !!(BOOK && book && bookUi().kf.includes(kind)); }
      function setKindFold(kinds, on) {
        const now = new Set(bookUi().kf);
        for (const k of kinds) { if (on) now.add(k); else now.delete(k); }
        book.ui = { ...bookUi(), kf: [...now] };
        save();
        paintBook(true);
        requestAnimationFrame(() => requestAnimationFrame(fitNodeToContent));
      }
      function drawerBeside() { return sideMode() && !!bookUi().dr.side; }
      /* The drawer is built inside the book; this hands it to whichever column
         it belongs in. Its listeners are on its own elements, so it moves whole. */
      function placeDrawer() {
        if (!BOOK) return;
        const host = root.querySelector(".lsb-book:not(.lsb-drbook)");
        const d = root.querySelector(".lsb-drawer");
        const to = root.querySelector(drawerBeside() ? ".lsb-drside" : ".lsb-drunder");
        if (!host || !to || !d) return;
        if (d.parentElement !== to) to.appendChild(d);
      }
      let drSlotKnown = 0;
      function panelGap() { return NOW_GAP; }
      /* The open drawer is made taller or shorter by dragging the strip
         under it - between it and the anchors' bar. With many cards it was
         a small window to scroll through; dragged down it shows as many rows
         as there is room for. Double click the strip for the default. */
      function drZoneAt(e) {
        if (!BOOK || !book || !bookUi().dr.open) return false;
        const t = e.target;
        if (t !== root && !(t.classList && (t.classList.contains("lsb-side") || t.classList.contains("lsb-left")))) return false;
        const shown = (el) => el && el.offsetHeight > 0 ? el : null;
        const holder = shown(root.querySelector(drawerBeside() ? ".lsb-drside" : ".lsb-drunder"));
        if (!holder) return false;
        const next = drawerBeside() || !sideMode() ? shown(root.querySelector(".lsb-now")) : null;
        const a = holder.getBoundingClientRect();
        const bottom = next ? next.getBoundingClientRect().top + 1 : a.bottom + 12;
        return e.clientY >= a.bottom - 1 && e.clientY <= bottom
          && e.clientX >= a.left && e.clientX <= a.right;
      }
      if (BOOK) {
        root.addEventListener("pointermove", (e) => {
          if (e.buttons) return;
          root.classList.toggle("gapzone", drZoneAt(e));
        });
        root.addEventListener("pointerleave", () => root.classList.remove("gapzone"));
        root.addEventListener("pointerdown", (e) => {
          if (e.button !== 0 || !drZoneAt(e)) return;
          const grid = root.querySelector(".lsb-drawer .lsb-dgrid");
          const drw = root.querySelector(".lsb-drawer");
          if (!grid || !drw) return;
          /* the canvas must not take this press as the start of a node drag:
             it would hold the pointer, and the release never reached here */
          e.preventDefault(); e.stopPropagation();
          const y0 = e.clientY, h0 = grid.clientHeight;
          const r = root.getBoundingClientRect();
          const scale = (r.height / (root.offsetHeight || 1)) || 1;
          let h = h0;
          let frame = 0;
          let ended = false;
          const move = (ev) => {
            /* the button let go somewhere the release was not heard: stop */
            if (!ev.buttons) { up(); return; }
            h = Math.max(80, Math.min(4000, Math.round(h0 + (ev.clientY - y0) / scale)));
            drw.style.setProperty("--dgh", h + "px");
            if (!frame) frame = requestAnimationFrame(() => {
              frame = 0;
              bookPanelKnown = 0; drSlotKnown = 0; panelHKnown = 0;
              fitNodeToContent();
            });
          };
          const up = () => {
            if (ended) return;
            ended = true;
            window.removeEventListener("pointermove", move, true);
            window.removeEventListener("pointerup", up, true);
            window.removeEventListener("pointercancel", up, true);
            window.removeEventListener("blur", up);
            book.ui = { ...bookUi(), dr: { ...bookUi().dr, h } };
            bookPanelKnown = 0; drSlotKnown = 0; panelHKnown = 0;
            touch(); save();
            requestAnimationFrame(() => requestAnimationFrame(fitNodeToContent));
          };
          /* caught on the way down, before anything on the page can stop it */
          window.addEventListener("pointermove", move, true);
          window.addEventListener("pointerup", up, true);
          window.addEventListener("pointercancel", up, true);
          window.addEventListener("blur", up);
        });
        root.addEventListener("dblclick", (e) => {
          if (!drZoneAt(e)) return;
          e.stopPropagation();
          setDrawerUi({ h: null });
        });
      }
      /* The divider between the book and the anchors stores a share of the
         width, not pixels - the same as the Series Lab's - so it holds when
         the node is made wider or narrower, and comes back with the book. */
      function applySplit() {
        if (!BOOK) return;
        if (!sideMode()) { root.style.gridTemplateColumns = ""; return; }
        const r = bookUi().split;
        root.style.gridTemplateColumns = `minmax(0,${r}fr) 8px minmax(0,${(1 - r).toFixed(4)}fr)`;
      }
      if (BOOK) {
        const sp = root.querySelector(".lsb-split");
        sp.addEventListener("pointerdown", (e) => {
          e.stopPropagation(); e.preventDefault();
          const box = root.getBoundingClientRect();
          const move = (ev) => {
            const r = Math.max(0.25, Math.min(0.75, (ev.clientX - box.left) / (box.width || 1)));
            book.ui = { ...bookUi(), split: r };
            applySplit();
          };
          const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            bookPanelKnown = 0;
            touch(); save();
            requestAnimationFrame(() => requestAnimationFrame(fitNodeToContent));
          };
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", up);
        });
        sp.addEventListener("dblclick", (e) => {
          e.stopPropagation();
          book.ui = { ...bookUi(), split: SPLIT_DEFAULT };
          applySplit();
          bookPanelKnown = 0;
          touch(); save();
          requestAnimationFrame(() => requestAnimationFrame(fitNodeToContent));
        });
      }
      let widthBelow = 0;
      function setSideMode(on) {
        if (!BOOK || !book) return;
        book.ui = { ...bookUi(), side: !!on };
        root.classList.toggle("side", !!on);
        applySplit();
        try {
          if (on) {
            widthBelow = node.size[0];
            node.setSize([Math.max(node.size[0], 1180), node.size[1]]);
          } else if (widthBelow) {
            node.setSize([Math.max(420, widthBelow), node.size[1]]);
          }
        } catch (e) { /* ignore */ }
        bookPanelKnown = 0; nowKnown = 0;
        touch(); save();
        render();
        requestAnimationFrame(() => requestAnimationFrame(fitNodeToContent));
      }
      function setAnchorsOpen(on) {
        if (!BOOK || !book) return;
        book.anchors = !!on;
        root.classList.toggle("anch-shut", !on);
        const el = root.querySelector(".lsb-now");
        if (el) el.dataset.key = "";
        save();
        render();
        requestAnimationFrame(fitNodeToContent);
      }

      function renameInline(el, value, done) {
        const inp = document.createElement("input");
        inp.className = "lsb-ren";
        inp.value = value;
        inp.spellcheck = false;
        el.replaceChildren(inp);
        el.draggable = false;
        inp.focus();
        inp.select();
        let over = false;
        const finish = (keep) => {
          if (over) return;
          over = true;
          const v = inp.value.trim();
          if (keep && v && v !== value) done(v); else paintBook(true);
        };
        ["keyup", "keypress", "pointerdown", "mousedown", "click", "dblclick"].forEach(k =>
          inp.addEventListener(k, e => e.stopPropagation()));
        inp.addEventListener("keydown", (e) => {
          e.stopPropagation();
          if (e.key === "Enter") { e.preventDefault(); finish(true); }
          if (e.key === "Escape") { e.preventDefault(); finish(false); }
        });
        inp.addEventListener("blur", () => finish(true));
      }

      /* ---- the capsule card ----
         What a capsule says, shown on hover in place of the browser's own
         tooltip - which can only hold plain text it is handed up front, and
         so could never show a translation that arrives a moment later. With
         TR on, the text is translated on this machine with the browser's
         built-in translator, into the language the TR panes use (or the
         browser's own when that is English), and kept for next time. */
      const capTr = new Map();
      let capCard = null, capCardT = null;
      function capTarget() {
        const own = bookUi().trTo;
        if (own) return own;
        const want = state.trTo && state.trTo !== "en" ? state.trTo
          : String(navigator.language || "ko").split("-")[0];
        return want === "en" ? "ko" : want;
      }
      function capCardHide() {
        if (capCardT) { clearTimeout(capCardT); capCardT = null; }
        if (capCard) { capCard.remove(); capCard = null; }
      }
      /* ---- a note on a prompt ----
         What the scene is about, in your own words - written with a right
         click on its chip, read on hover. Kept with the prompt, so it goes
         with the series into its file and into every book. */
      let noteEd = null;
      function closePromptNote(keep) {
        if (!noteEd) return;
        const noteEd0 = noteEd;
        const { box, q, ta } = noteEd;
        noteEd = null;
        document.removeEventListener("pointerdown", noteOut, true);
        if (keep) {
          const v = String(ta.value || "").replace(/\s+$/g, "").replace(/^\s+/, "");
          const pic = noteEd0.pic ? noteEd0.pic() : q.thumb;
          if ((q.note || "") !== v || (q.thumb || null) !== (pic || null)) {
            if (v) q.note = v.slice(0, 4000); else delete q.note;
            if (pic) q.thumb = pic; else delete q.thumb;
            touch(); save();
            paintBook(true);
            say(`${numOf(q)} ${q.name} - note and picture kept`);
          }
        }
        box.remove();
      }
      function noteOut(e) {
        if (noteEd && !noteEd.box.contains(e.target)) closePromptNote(true);
      }
      function readPictureFile(f, done) {
        if (!f || !/^image\//.test(f.type)) return;
        const rd = new FileReader();
        rd.onload = () => done(rd.result);
        rd.readAsDataURL(f);
      }
      function pickPictureFile(done) {
        const inp = document.createElement("input");
        inp.type = "file"; inp.accept = "image/*";
        inp.onchange = () => readPictureFile(inp.files && inp.files[0], done);
        inp.click();
      }
      function openPromptNote(el, q) {
        closePromptNote(true);
        tipHide();
        const box = document.createElement("div");
        box.className = "lsb-pnote " + ROOT_CLASS;
        box.innerHTML = `<div class="hd"><b>${escapeHtml(numOf(q) + " " + q.name)}</b><span>note and picture of this scene</span></div>`
          + `<div class="bd"><div class="lf"><div class="pv" title="Paste or drop a picture here"></div>`
          + `<button class="lsb-btn fromv" title="The picture open large in a Visual Image Viewer, or the one framed in its grid">From viewer</button>`
          + `<button class="lsb-btn fromf">File...</button></div>`
          + `<textarea spellcheck="false" placeholder="What happens in this scene - who, where, why it matters"></textarea></div>`
          + `<div class="ft"><span>Ctrl+Enter keeps it - Esc leaves it</span><i></i>`
          + `<button class="lsb-btn cn">Cancel</button><button class="lsb-btn ok">Keep</button></div>`;
        const ta = box.querySelector("textarea");
        ta.value = q.note || "";
        const pv = box.querySelector(".pv");
        let pic = q.thumb || null;
        const paintPv = () => {
          pv.classList.toggle("has", !!pic);
          pv.innerHTML = pic ? `<img src="${pic}" alt=""><button class="clr" title="Take the picture off">&times;</button>`
            : `<span>no picture<br><small>paste, drop,<br>or pick one</small></span>`;
          pv.querySelector(".clr")?.addEventListener("click", (e) => { e.stopPropagation(); pic = null; paintPv(); });
        };
        paintPv();
        const take = async (src) => {
          if (!src) { say("no picture open in a Visual Image Viewer - open one large, or pick a file", "err"); return; }
          const t = await drawerThumbFrom(src);
          if (t) { pic = t; paintPv(); } else say("that picture could not be read", "err");
        };
        box.querySelector(".fromv").addEventListener("click", () => take(viewerPicture()));
        box.querySelector(".fromf").addEventListener("click", () => pickPictureFile(take));
        box.addEventListener("paste", (e) => {
          const f = [...(e.clipboardData?.files || [])].find(f => /^image\//.test(f.type));
          if (f) { e.preventDefault(); readPictureFile(f, take); }
        });
        box.addEventListener("dragover", (e) => { e.preventDefault(); e.stopPropagation(); pv.classList.add("over"); });
        box.addEventListener("dragleave", (e) => { if (!box.contains(e.relatedTarget)) pv.classList.remove("over"); });
        box.addEventListener("drop", (e) => {
          e.preventDefault(); e.stopPropagation(); pv.classList.remove("over");
          const f = [...(e.dataTransfer?.files || [])].find(f => /^image\//.test(f.type));
          if (f) readPictureFile(f, take); else take(e.dataTransfer.getData("text/uri-list") || null);
        });
        document.body.appendChild(box);
        const r = el.getBoundingClientRect(), b = box.getBoundingClientRect();
        let top = r.bottom + 6;
        if (top + b.height > window.innerHeight - 8) top = Math.max(8, r.top - b.height - 6);
        box.style.left = Math.max(8, Math.min(r.left, window.innerWidth - b.width - 8)) + "px";
        box.style.top = top + "px";
        noteEd = { box, q, ta, pic: () => pic };
        for (const k of ["keyup", "keypress", "pointerdown", "mousedown", "wheel", "contextmenu", "copy", "cut"]) {
          box.addEventListener(k, ev => ev.stopPropagation());
        }
        ta.addEventListener("keydown", (ev) => {
          ev.stopPropagation();
          if (ev.key === "Escape") { ev.preventDefault(); closePromptNote(false); }
          else if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); closePromptNote(true); }
        });
        box.querySelector(".cn").addEventListener("click", () => closePromptNote(false));
        box.querySelector(".ok").addEventListener("click", () => closePromptNote(true));
        setTimeout(() => { if (noteEd && noteEd.box === box) document.addEventListener("pointerdown", noteOut, true); }, 250);
        box.addEventListener("contextmenu", ev => ev.preventDefault());
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
      }
      /* ---- tooltips ----
         Every title in the book is read on hover and shown as a card like the
         capsules' own: the first line is what the thing is, and each action -
         click, shift+click, drag... - gets a row of its own under a gold
         label, so the book explains itself at a glance. */
      const TIP_ACT = "Ctrl\\+Shift\\+click|Shift\\+click|Ctrl\\+click|Alt\\+click|Double click|Right click|Click|Drag|Drop|Enter|Esc";
      const TIP_SPLIT = new RegExp(`(?:\\n|\\s-\\s|(?<=\\.)\\s+|;\\s*|,\\s+(?=(?:${TIP_ACT})\\b))(?=(?:${TIP_ACT})\\b)`, "i");
      const TIP_HEAD = new RegExp(`^(${TIP_ACT})\\b[:\\s-]*`, "i");
      function tipParse(text) {
        const segs = String(text || "").split(TIP_SPLIT).map(x => x.trim()).filter(Boolean);
        const rows = [], desc = [];
        for (const seg of segs) {
          const m = TIP_HEAD.exec(seg);
          if (m) {
            let rest = seg.slice(m[0].length).replace(/^to\s+/i, "").replace(/[\s.]+$/, "");
            rest = rest ? rest[0].toUpperCase() + rest.slice(1) : "";
            const k = m[1].replace(/\b\w/g, c => c.toUpperCase()).replace(/Click\b/g, (x, i) => i ? "click" : x);
            rows.push([k, rest]);
          } else {
            desc.push(seg);
          }
        }
        let lines = desc.join("\n").split("\n").map(x => x.trim()).filter(Boolean);
        let head = "";
        if (lines.length && (lines.length > 1 || rows.length) && lines[0].length <= 70) head = lines.shift();
        const cap = (x) => x ? x[0].toUpperCase() + x.slice(1) : x;
        return { head: cap(head), body: cap(lines.join("\n")), rows };
      }
      let tipEl = null, tipCardEl = null, tipT = null;
      function tipHide() {
        if (tipT) { clearTimeout(tipT); tipT = null; }
        tipEl = null;
        if (tipCardEl) { tipCardEl.remove(); tipCardEl = null; }
      }
      function tipShow(el) {
        const t = tipParse(el.dataset.tip);
        if (!t.head && !t.body && !t.rows.length) return;
        const card = document.createElement("div");
        card.className = "lsb-card tip " + ROOT_CLASS;
        const pq = el.classList.contains("lsb-p") ? book.prompts.find(x => x.id === Number(el.dataset.id)) : null;
        card.innerHTML = (t.head ? `<div class="ch"><b>${escapeHtml(t.head)}</b></div>` : "")
          + (pq && pq.thumb ? `<img class="th" src="${pq.thumb}" alt="">` : "")
          + (t.body ? `<div class="en">${escapeHtml(t.body)}</div>` : "")
          + (t.rows.length ? `<div class="hint">` + t.rows.map(([k, v]) =>
              `<div class="hr"><b>${escapeHtml(k)}</b><span>${escapeHtml(v)}</span></div>`).join("") + `</div>` : "");
        document.body.appendChild(card);
        tipCardEl = card;
        const place = () => {
          const r = el.getBoundingClientRect(), b = card.getBoundingClientRect();
          let top = r.bottom + 6;
          if (top + b.height > window.innerHeight - 8) top = Math.max(8, r.top - b.height - 6);
          card.style.left = Math.max(8, Math.min(r.left, window.innerWidth - b.width - 8)) + "px";
          card.style.top = top + "px";
        };
        place();
        const im = card.querySelector("img.th");
        if (im && !im.complete) im.addEventListener("load", () => { if (tipCardEl === card) place(); });
      }
      root.addEventListener("pointerover", (e) => {
        const t = e.target instanceof Element ? e.target : null;
        let el = t ? t.closest("[title], [data-tip]") : null;
        if (el && !root.contains(el)) el = null;
        /* a file row's name keeps the series-note card of the Files panel */
        if (el && el.closest(".lsb-load .lr")) el = null;
        if (el && el.hasAttribute("title")) {
          const v = el.getAttribute("title");
          el.removeAttribute("title");
          if (v) el.dataset.tip = v;
        }
        if (el === tipEl) return;
        tipHide();
        if (!el || !el.dataset.tip) return;
        tipEl = el;
        tipT = setTimeout(() => { tipT = null; if (tipEl === el && el.isConnected) tipShow(el); }, 450);
      });
      root.addEventListener("pointerleave", tipHide);
      root.addEventListener("pointerdown", tipHide, true);
      root.addEventListener("wheel", tipHide, { passive: true });
      root.addEventListener("dragstart", tipHide, true);
      function capCardSoon(el, id, hint) {
        capCardHide();
        capCardT = setTimeout(() => { capCardT = null; capCardShow(el, id, hint); }, 350);
      }
      async function capCardShow(el, id, hintOver) {
        const c = book && book.caps[id];
        if (!c || !el.isConnected) return;
        const cg = groupById(c.g);
        const ag = activeGroup();
        const u = useCounts().get(c.id) || 0;
        return hoverCardShow(el, {
          hue: KIND_HUE[c.kind] || KIND_HUE.other,
          name: c.name,
          meta: (cg && book.groups.length > 1 ? `series ${cg.no} ${cg.name} - ` : "") + (u ? `in ${u} prompt${u === 1 ? "" : "s"}` : "in no prompt"),
          text: String(c.sec.text || ""),
          thumb: drawerThumbFor(c.kind, c.sec.text),
          risk: riskOf(riskCtx(), c.kind, c.name, c.sec.text),
          hint: hintOver || [
            ["Click", "Put it in the open prompt - or take it out when it is in"],
            ["Shift+click", "Every prompt of this series"],
            ["Ctrl+Shift+click", "Every series, each its own copy"],
            ["Alt+click", "Beside the one of its kind - both are used"],
            ["Drag", "Onto a section or a prompt - with Alt, beside its kind"],
            ["Double click", "Rename"],
            ["Right click", "Keep it in the Drawer, with the viewer's picture"],
          ].concat(ag && c.g !== ag.id ? [["Note", "From another series - it arrives as a copy"]] : []),
        });
      }
      /* A capsule wears the picture of the drawer card holding the same words
         - taken from the drawer, or kept in it. Matched on the words rather
         than on where it came from, so a capsule whose words have since been
         changed no longer claims a picture that shows something else. */
      function drawerMatch(kind, text, needThumb) {
        const norm = (t) => String(t || "").replace(/\s+/g, " ").trim().toLowerCase();
        const want = norm(text);
        if (!want) return null;
        const ok = (i) => (!needThumb || i.thumb) && norm(i.text) === want;
        return drawerStore.items.find(i => ok(i) && i.kind === kind)
          || drawerStore.items.find(ok) || null;
      }
      function drawerThumbFor(kind, text) {
        const hit = drawerMatch(kind, text, true);
        return hit ? hit.thumb : null;
      }
      /* A drawer card read the same way as a capsule: the words, their
         translation when TR is on, and its picture larger than on the card. */
      function drawerCardSoon(el, did) {
        capCardHide();
        capCardT = setTimeout(() => {
          capCardT = null;
          const x = drawerStore.items.find(i => i.id === did);
          if (!x || !el.isConnected) return;
          hoverCardShow(el, {
            hue: KIND_HUE[x.kind] || KIND_HUE.other,
            name: x.name,
            meta: `Drawer - ${KIND_LABEL[x.kind]}${(x.tags || []).length ? " - " + x.tags.join(", ") : ""}`,
            text: String(x.text || ""),
            thumb: x.thumb || null,
            risk: riskOf(riskCtx(), x.kind, x.name, x.text),
            hint: [
              ["Click", "Put it in the open prompt - asks first"],
              ["Drag", "Onto a section - at once"],
              ["Double click", "Add it to the capsules of this series"],
              ["Right click", "Edit the card - name, words, picture"],
            ],
          });
        }, 350);
      }
      async function hoverCardShow(el, o) {
        const text = o.text;
        const card = document.createElement("div");
        card.className = "lsb-card " + ROOT_CLASS;
        card.style.setProperty("--k", o.hue);
        card.innerHTML = `<div class="ch"><b></b><span></span></div>`
          + (o.thumb ? `<img class="th" src="${o.thumb}" alt="">` : "")
          + ((o.risk || []).length ? `<div class="rk">` + o.risk.map(r => `<b>! ${escapeHtml(r.title)}</b>`
              + `<span>${escapeHtml(r.why)}</span>`).join("") + `</div>` : "")
          + `<div class="en"></div>`
          + (bookUi().tr ? `<div class="tr wait">translating...</div>` : "")
          + `<div class="hint">${Array.isArray(o.hint)
              ? o.hint.map(([k, v]) => `<div class="hr"><b>${escapeHtml(k)}</b><span>${escapeHtml(v)}</span></div>`).join("")
              : o.hint}</div>`;
        card.querySelector(".ch b").textContent = o.name;
        card.querySelector(".ch span").textContent = o.meta;
        card.querySelector(".en").textContent = text;
        document.body.appendChild(card);
        capCard = card;
        const thImg = card.querySelector("img.th");
        if (thImg && !thImg.complete) thImg.addEventListener("load", () => { if (capCard === card) place(); });
        const place = () => {
          const r = el.getBoundingClientRect();
          const b = card.getBoundingClientRect();
          let left = Math.min(r.left, window.innerWidth - b.width - 8);
          let top = r.bottom + 6;
          if (top + b.height > window.innerHeight - 8) top = Math.max(8, r.top - b.height - 6);
          card.style.left = Math.max(8, left) + "px";
          card.style.top = top + "px";
        };
        place();
        if (!bookUi().tr) return;
        const to = capTarget();
        const key = to + "|" + text;
        let out = capTr.get(key);
        const pane = card.querySelector(".tr");
        if (out === undefined) {
          try {
            if (!trHas()) throw new Error("translation needs Chrome or Edge 138 or later");
            const eng = await trEngineFor("en", to, (f) => {
              if (pane && capCard === card) {
                pane.textContent = `downloading the ${trName(to)} model... ${Math.round((f || 0) * 100)}%`;
              }
            });
            out = await eng.translate(text);
            capTr.set(key, out);
          } catch (err) {
            out = null;
            if (pane) { pane.textContent = String(err && err.message || err); pane.classList.add("err"); }
          }
        }
        if (capCard !== card || !pane || out === null) return;
        pane.textContent = out;
        pane.dir = TR_RTL.has(to.split("-")[0]) ? "rtl" : "ltr";
        pane.classList.remove("wait");
        place();
      }

      const DT_CAP = "application/x-leiel-capsule";
      const DT_DRAWER = "application/x-leiel-drawer";
      const DT_DRAWER_MANY = "application/x-leiel-drawer-many";
      const DT_PROMPT = "application/x-leiel-prompt";

      function wireBook(host) {
        for (const lab of host.querySelectorAll(".lsb-krow .lsb-klab")) {
          lab.addEventListener("click", (e) => {
            e.stopPropagation();
            const kind = lab.parentElement.dataset.kind;
            const fold = !kindFolded(kind);
            if (e.shiftKey) {
              const all = [...host.querySelectorAll(".lsb-krow")].map(r => r.dataset.kind);
              setKindFold(all, fold);
            } else setKindFold([kind], fold);
          });
        }
        for (const m of host.querySelectorAll(".lsb-kmore")) {
          m.addEventListener("click", (e) => {
            e.stopPropagation();
            setKindFold([m.closest(".lsb-krow").dataset.kind], false);
          });
        }
        host.querySelector(".lsb-prev").addEventListener("click", () => stepPrompt(-1));
        host.querySelector(".lsb-next").addEventListener("click", () => stepPrompt(1));
        host.querySelector(".lsb-imp").addEventListener("click", importComposers);
        host.querySelector(".lsb-cpy").addEventListener("click", (e) => copySeries(e.shiftKey));
        host.querySelector(".lsb-ser").addEventListener("click", addSeries);
        host.querySelector(".lsb-ld").addEventListener("click", (e) => openLoad(e.currentTarget));
        for (const el of host.querySelectorAll(".lsb-svc")) {
          el.addEventListener("click", () => {
            const v = el.dataset.g === "all" ? "all" : Number(el.dataset.g);
            /* the open series is the default view, so picking it goes back to
               following whichever series is open */
            const ag = activeGroup();
            book.shelfView = (v !== "all" && ag && v === ag.id) ? null
              : (book.shelfView === v ? null : v);
            if (!book.shelf) book.shelf = true;
            save();
            paintBook();
            requestAnimationFrame(fitNodeToContent);
          });
        }
        host.querySelector(".lsb-dot").addEventListener("click", (e) => {
          const u = bookUi();
          const n = BOOK_HUES.length;
          book.ui = { ...u, hue: (u.hue + (e.shiftKey ? n - 1 : 1)) % n };
          applyBookLook(host);
          e.currentTarget.title = `Colour of the book: ${BOOK_HUES[book.ui.hue][0]}`
            + " - click for the next one, Shift+click for the one before";
          save();
        });
        const light = host.querySelector(".lsb-light");
        /* follows the hand while dragging; written down when it is let go */
        light.addEventListener("input", () => {
          book.ui = { ...bookUi(), light: Number(light.value) / 100 };
          applyBookLook(host);
        });
        light.addEventListener("change", () => save());
        ["pointerdown", "mousedown"].forEach(k =>
          light.addEventListener(k, e => e.stopPropagation()));
        /* the capsule panel folds from anywhere on its header bar that is
           not a control of its own */
        host.querySelector(".lsb-caphead").addEventListener("click", (e) => {
          if (e.target.closest(".lsb-ckc")) {
            e.stopPropagation();
            setDrawerUi({ open: true, kind: "now", tag: [] });
            return;
          }
          if (e.target.closest(".lsb-svc, .lsb-trt, .lsb-trl, .lsb-found, .lsb-used, .lsb-tidy")) return;
          if (e.target.closest(".lsb-chelp")) {
            e.stopPropagation();
            openCapHelp(e.target.closest(".lsb-chelp"));
            return;
          }
          book.shelf = !book.shelf;
          save();
          paintBook();
          requestAnimationFrame(fitNodeToContent);
        });

        /* series boxes: fold, rename, close, and a drop target for prompts */
        for (const box of host.querySelectorAll(".lsb-pbox")) {
          const gid = Number(box.dataset.g);
          const g = groupById(gid);
          if (!g) continue;
          box.querySelector(".lsb-gcar").addEventListener("click", () => {
            g.open = g.open === false;
            save(); paintBook();
            requestAnimationFrame(fitNodeToContent);
          });
          box.querySelector(".lsb-gname").addEventListener("dblclick", (e) => {
            e.stopPropagation();
            renameInline(e.currentTarget, g.name, (v) => { g.name = v; touch(); save(); });
          });
          function hideGZoom() { document.querySelectorAll(".lsb-gzoom").forEach(x => x._close ? x._close() : x.remove()); }
          function showGZoom(anchor, src) {
            hideGZoom();
            if (!anchor.isConnected) return;
            const z = document.createElement("div");
            z.className = "lsb-gzoom " + ROOT_CLASS;
            z.innerHTML = `<img src="${src}" alt="">`;
            document.body.appendChild(z);
            const place = () => {
              const r = anchor.getBoundingClientRect(), w = z.offsetWidth, h = z.offsetHeight;
              let x = r.right + 8, y = r.top;
              if (x + w > innerWidth - 8) x = Math.max(8, r.left - w - 8);
              if (y + h > innerHeight - 8) y = Math.max(8, innerHeight - h - 8);
              z.style.left = x + "px"; z.style.top = y + "px";
            };
            const img = z.querySelector("img");
            if (img.complete) place(); else img.addEventListener("load", place);
            place();
            const away = (ev) => {
              if (ev.type === "keydown" && ev.key !== "Escape") return;
              if (ev.type === "pointerdown" && anchor.contains(ev.target)) anchor._shut = Date.now();
              close();
            };
            const close = () => {
              z.remove();
              document.removeEventListener("pointerdown", away, true);
              document.removeEventListener("keydown", away, true);
              window.removeEventListener("wheel", close, true);
            };
            z._close = close;
            setTimeout(() => {
              document.addEventListener("pointerdown", away, true);
              document.addEventListener("keydown", away, true);
              window.addEventListener("wheel", close, true);
            }, 0);
          }
          const gpic = box.querySelector(".lsb-gpic");
          if (gpic) {
            const setG = async (src) => {
              if (!src) return false;
              const t = await drawerThumbFrom(src);
              if (!t) { say("that picture could not be read", "err"); return false; }
              g.thumb = t;
              touch(); save(); paintBook(true);
              say(`series ${g.no} ${g.name} - picture set`);
              return true;
            };
            const takeNew = async () => {
              if (await setG(viewerPicture())) return;
              pickPictureFile(setG);
            };
            /* one click: a larger look; double click: replace it.
               The single click waits a moment so a double click is not also a look. */
            let clickT = null;
            gpic.addEventListener("click", (e) => {
              e.stopPropagation();
              if (!g.thumb) { takeNew(); return; }
              if (gpic._shut && Date.now() - gpic._shut < 400) { gpic._shut = 0; return; }
              if (clickT) return;
              clickT = setTimeout(() => { clickT = null; showGZoom(gpic, g.thumb); }, 260);
            });
            gpic.addEventListener("dblclick", (e) => {
              e.stopPropagation();
              if (clickT) { clearTimeout(clickT); clickT = null; }
              if (!g.thumb) return;
              hideGZoom();
              takeNew();
            });
            gpic.addEventListener("contextmenu", (e) => {
              e.preventDefault(); e.stopPropagation();
              if (!g.thumb) return;
              delete g.thumb;
              touch(); save(); paintBook(true);
              say(`series ${g.no} ${g.name} - picture taken off`);
            });
            gpic.addEventListener("pointerdown", (e) => { if (e.button === 2) e.stopPropagation(); });
            gpic.addEventListener("dragover", (e) => { e.preventDefault(); e.stopPropagation(); gpic.classList.add("over"); });
            gpic.addEventListener("dragleave", () => gpic.classList.remove("over"));
            gpic.addEventListener("drop", (e) => {
              e.preventDefault(); e.stopPropagation(); gpic.classList.remove("over");
              const f = [...(e.dataTransfer?.files || [])].find(f => /^image\//.test(f.type));
              if (f) readPictureFile(f, setG);
              else setG(e.dataTransfer.getData("text/uri-list") || null);
            });
          }
          box.querySelector(".lsb-gnote")?.addEventListener("click", (e) => {
            e.stopPropagation();
            const el = e.currentTarget;
            if (el.querySelector("textarea")) return;
            const ta = document.createElement("textarea");
            ta.className = "lsb-gnote-ed";
            ta.value = g.note || "";
            ta.placeholder = "What this series is - the story, the look, what was tried";
            el.replaceChildren(ta);
            el.classList.remove("empty");
            const fit = () => { ta.style.height = "auto"; ta.style.height = ta.scrollHeight + "px"; };
            fit();
            ta.focus();
            for (const k of ["keydown", "keyup", "keypress", "paste", "pointerdown", "mousedown", "wheel"]) {
              ta.addEventListener(k, ev => ev.stopPropagation());
            }
            ta.addEventListener("input", () => { fit(); requestAnimationFrame(fitNodeToContent); });
            let done = false;
            const finish = (keep) => {
              if (done) return;
              done = true;
              if (keep) {
                const v = ta.value.replace(/\s+$/, "");
                if (v) g.note = v; else delete g.note;
                touch(); save();
              }
              paintBook(true);
              requestAnimationFrame(fitNodeToContent);
            };
            ta.addEventListener("keydown", (ev) => {
              if (ev.key === "Escape") { ev.preventDefault(); finish(false); }
              if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); finish(true); }
            });
            ta.addEventListener("blur", () => finish(true));
          });
          box.querySelector(".lsb-gmhead")?.addEventListener("click", (e) => {
            e.stopPropagation();
            if (g.memoOpen === false) delete g.memoOpen; else g.memoOpen = false;
            touch(); save(); paintBook(true);
            requestAnimationFrame(fitNodeToContent);
          });
          box.querySelector(".lsb-gmbody")?.addEventListener("click", (e) => {
            e.stopPropagation();
            const ed = e.currentTarget;
            if (ed.getAttribute("contenteditable") === "true") return;
            /* A drag over the text while it is only being read ends in this
               click too. The run that was dragged over is remembered, kept
               selected once writing starts, and the palette comes up on it -
               nobody has to click in and select it a second time. */
            let pre = null;
            /* notes stored as paragraph blocks are measured as blocks */
            if (ed.querySelector(":scope > div")) ed._blocks = true;
            if (g.memo) {
              const s0 = window.getSelection();
              if (s0 && s0.rangeCount && !s0.isCollapsed && ed.contains(s0.getRangeAt(0).commonAncestorContainer)) {
                try { pre = rangeOffsets(ed, s0.getRangeAt(0)); } catch (err) { pre = null; }
              }
            }
            /* edited in place, as a marked-text editor like an anchor's: the
               same palette comes up over a selection */
            const was = ed.innerHTML;
            if (!g.memo) ed.innerHTML = "";
            ed.classList.remove("empty");
            ed.setAttribute("contenteditable", "true");
            ed.setAttribute("spellcheck", "false");
            ed.focus();
            /* every line becomes a paragraph block while the notes are written */
            ed._blocks = true;
            normalizeBlocks(ed, false);
            if (!pre) {
              const end = readMarks(ed).length;
              selectOffsets(ed, end, end);
            }
            const fitNode = () => requestAnimationFrame(fitNodeToContent);
            /* line spacing belongs to the whole notes, not to a run: set from
               the box on the bar, kept with the series when the notes are kept */
            const wasLead = g.memoLead;
            ed.dataset.lead = g.memoLead || 150;
            ed.addEventListener("lvp-lead", (ev) => {
              const v = ev.detail;
              ed.dataset.lead = v;
              ed.style.lineHeight = String(v / 100);
              if (v === 150) delete g.memoLead; else g.memoLead = v;
              fitNode();
            });
            for (const k of ["keyup", "keypress", "pointerdown", "mousedown", "wheel"]) {
              ed.addEventListener(k, ev => ev.stopPropagation());
            }
            ed.addEventListener("keyup", (ev) => { if (ev.key === "Alt") ev.preventDefault(); });
            /* the browser's own editing can leave stray text, <br> or nested
               blocks behind; the clean form is put back - never in the middle
               of composing a Korean syllable */
            let composing = false;
            ed.addEventListener("compositionstart", () => { composing = true; });
            ed.addEventListener("compositionend", () => {
              composing = false;
              if (!isCleanBlocks(ed)) normalizeBlocks(ed, true);
            });
            ed.addEventListener("input", () => {
              if (!composing && !isCleanBlocks(ed)) normalizeBlocks(ed, true);
              fitNode();
            });
            /* A drag that ends outside the text - or one the canvas swallowed -
               never gives the editor its own mouseup, so the pointer is watched
               on the whole page while writing */
            /* the eyedropper: loaded from the bar, it picks up the formatting
               of the next place clicked, then stamps it on every selection
               made after, until Esc or the button again puts it down */
            let brushMode = "off", brushFmt = null;
            const setBrush = (m) => {
              brushMode = m;
              if (m === "off") brushFmt = null;
              ed.classList.toggle("picking", m === "pick");
              ed.classList.toggle("painting", m === "apply");
            };
            ed.addEventListener("lvp-brush", () => {
              setBrush(brushMode === "off" ? "pick" : "off");
              hideMarkBar(true);
            });
            const onUp = (ev) => setTimeout(() => {
              if (done) return;
              /* a press on the style bar itself - opening a dropdown, picking
                 a colour - must not rebuild the bar it was made on */
              if (markBar && ev && markBar.contains(ev.target)) return;
              if (brushMode !== "off") {
                if (ev && ev.type !== "pointerup") return;
                const s1 = window.getSelection();
                if (!s1 || !s1.rangeCount || !ed.contains(s1.getRangeAt(0).commonAncestorContainer)) return;
                let [a, b] = rangeOffsets(ed, s1.getRangeAt(0));
                if (b < a) [a, b] = [b, a];
                if (brushMode === "pick") { brushFmt = formatAt(ed, a); setBrush("apply"); return; }
                /* a plain click, not a drag, puts the eyedropper down */
                if (b === a) { setBrush("off"); return; }
                if (brushFmt) {
                  paraOpAt(ed, a, b, () => brushFmt.para.slice(), null);
                  applyCharStyle(ed, a, b, { chars: brushFmt.chars });
                  selectOffsets(ed, b, b);
                }
                return;
              }
              const sel = window.getSelection();
              if (sel && sel.rangeCount && !sel.isCollapsed && ed.contains(sel.getRangeAt(0).commonAncestorContainer)) {
                showMarkBar(ed, { lead: true });
              }
            }, 0);
            document.addEventListener("pointerup", onUp, true);
            document.addEventListener("mouseup", onUp, true);
            /* the book stops clicks on its own empty space from taking the
               focus, so the editor would never blur: a press anywhere outside
               the text and its palette ends the writing */
            const onOut = (ev) => {
              if (done) return;
              const t = ev.target;
              if (ed.contains(t) || (markBar && markBar.contains(t))) return;
              finish(true);
            };
            document.addEventListener("pointerdown", onOut, true);
            let done = false;
            const finish = (keep) => {
              if (done) return;
              done = true;
              document.removeEventListener("pointerup", onUp, true);
              document.removeEventListener("mouseup", onUp, true);
              document.removeEventListener("pointerdown", onOut, true);
              hideMarkBar(true);
              ed.removeAttribute("contenteditable");
              if (keep) {
                const out = memoBlocksHtml(ed);
                const v = normalizeText(out.text).replace(/\s+$/, "");
                if (v) {
                  g.memo = v.slice(0, 20000);
                  const h = sanitizeMemo(out.html);
                  /* plain notes stay plain text; anything marked keeps its blocks */
                  if (/<(span|b)\b/.test(h) || /class="pg [^"]/.test(h)) g.memoHtml = h; else delete g.memoHtml;
                } else { delete g.memo; delete g.memoHtml; }
                touch(); save();
              } else {
                ed.innerHTML = was;
                if (wasLead) g.memoLead = wasLead; else delete g.memoLead;
              }
              paintBook(true);
              fitNode();
            };
            ed.addEventListener("keydown", (ev) => {
              ev.stopPropagation();
              if (ev.key === "Escape" && brushMode !== "off") { ev.preventDefault(); setBrush("off"); return; }
              if (ev.key === "Escape") { ev.preventDefault(); finish(false); return; }
              /* Ctrl+Alt+number: a paragraph style; with Shift, a character style */
              /* Ctrl+Shift and Alt+Shift switch the input language on Windows,
                 so a character style is Alt+number (Ctrl+Alt+Shift+number
                 still works where nothing takes it first) */
              const dg = /^(Digit|Numpad)([1-9])$/.exec(ev.code || "");
              const isPara = dg && ev.ctrlKey && ev.altKey && !ev.shiftKey;
              const isChar = dg && ev.altKey && (!ev.ctrlKey || ev.shiftKey) && !ev.metaKey;
              if (isPara || isChar) {
                const st = (isChar ? cStyles() : pStyles()).find(x => x.key === dg[2]);
                ev.preventDefault();
                if (st) {
                  const s1 = window.getSelection();
                  if (!s1 || !s1.rangeCount) return;
                  let [a, b] = rangeOffsets(ed, s1.getRangeAt(0));
                  if (b < a) [a, b] = [b, a];
                  if (isChar) { if (b > a) applyCharStyle(ed, a, b, st); }
                  else applyParaStyle(ed, a, b, st);
                  selectOffsets(ed, a, b);
                  if (markBar && markBar._ta === ed) keepMarkBar(ed, a, b);
                  fitNode();
                }
                return;
              }
              if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); finish(true); return; }
              if (ev.key === "Enter") { ev.preventDefault(); blockInsert(ed, "\n"); fitNode(); return; }
              if (ev.key === "Tab") { ev.preventDefault(); blockInsert(ed, "\t"); }
            });
            ed.addEventListener("paste", (ev) => {
              ev.preventDefault(); ev.stopPropagation();
              const cb = ev.clipboardData || window.clipboardData;
              const html = cb.getData("text/html");
              const plain = cb.getData("text");
              if (!(html && insertMarked(html, plain))) insertPlain(String(plain || "").replace(/\r\n/g, "\n"));
              normalizeBlocks(ed, true);
              fitNode();
            });
            ed.addEventListener("blur", () => setTimeout(() => {
              if (markBar && markBar.matches(":hover")) return;   // a click on the palette
              if (markBar && markBar.contains(document.activeElement)) return;
              if (document.activeElement === ed) return;
              finish(true);
            }, 200));
            if (pre) {
              let [a, b] = pre;
              if (b < a) [a, b] = [b, a];
              if (b > a && selectOffsets(ed, a, b)) showMarkBar(ed, { lead: true });
            }
          });
          box.querySelector(".lsb-gtone")?.addEventListener("click", (e) => {
            e.stopPropagation();
            const n = SERIES_TONES.length;
            let h = toneIdx(g.hue);
            do h = (h + (e.shiftKey ? n - 1 : 1)) % n; while (RETIRED_TONES.has(h));
            g.hue = h;
            touch(); save();
            paintBook(true);
            /* the Lab redraws the next time the canvas does - nudge it */
            try { app.graph.setDirtyCanvas(true, true); } catch (err) { /* ignore */ }
          });
          box.querySelector(".lsb-gtone")?.addEventListener("dblclick", (e) => e.stopPropagation());
          box.querySelector(".psort")?.addEventListener("click", (e) => {
            e.stopPropagation();
            if (e.shiftKey) renumberSeries(Number(box.dataset.g));
            else sortSeries(Number(box.dataset.g));
          });
          box.querySelector(".pnew")?.addEventListener("click", (e) => {
            e.stopPropagation();
            const cur = activePrompt();
            if (!cur || cur.g !== gid) {
              const mine = promptsOf(g);
              if (mine.length) activate(mine[mine.length - 1].id);
            }
            newPrompt(false);
          });
          box.querySelector(".psave")?.addEventListener("click", async (e) => {
            e.stopPropagation();
            writeBack();
            await saveBookFile(g.name, gid);
          });
          box.querySelector(".ppaste:not(.ppall)")?.addEventListener("click", async (e) => {
            e.stopPropagation();
            let text = null;
            try { text = await navigator.clipboard.readText(); } catch (err) { text = null; }
            if (text === null || text === undefined) { openPasteBox(gid); return; }
            applyReply(text, gid);
          });
          box.querySelector(".ppall")?.addEventListener("click", async (e) => {
            e.stopPropagation();
            let text = null;
            try { text = await navigator.clipboard.readText(); } catch (err) { text = null; }
            if (text === null || text === undefined) { openPasteBox(gid, true); return; }
            applyReply(text, gid, true);
          });
          box.querySelector(".pdup")?.addEventListener("click", (e) => { e.stopPropagation(); newPrompt(true); });
          box.querySelector(".pdel")?.addEventListener("click", (e) => { e.stopPropagation(); deletePrompt(); });
          box.querySelector(".lsb-gx")?.addEventListener("click", (e) => {
            e.stopPropagation();
            if (armedDel !== "g" + gid) { armDel("g" + gid); return; }
            closeSeries(gid);
          });
          box.addEventListener("dragover", (e) => {
            if (!e.dataTransfer.types.includes(DT_PROMPT)) return;
            if (e.target.closest(".lsb-p")) return;
            e.preventDefault();
            box.classList.add("drop");
          });
          box.addEventListener("dragleave", (e) => {
            if (!box.contains(e.relatedTarget)) box.classList.remove("drop");
          });
          box.addEventListener("drop", (e) => {
            box.classList.remove("drop");
            const pr = e.dataTransfer.getData(DT_PROMPT);
            if (!pr || e.target.closest(".lsb-p")) return;
            e.preventDefault();
            e.stopPropagation();
            movePrompt(Number(pr), gid);
          });
        }

        for (const el of host.querySelectorAll(".lsb-p")) {
          const id = Number(el.dataset.id);
          el.querySelector(".lsb-or")?.addEventListener("click", (e) => {
            e.stopPropagation();
            const q = book.prompts.find(x => x.id === id);
            if (!q) return;
            const n = ORIENTS.length;
            const next = ORIENTS[(ORIENTS.indexOf(orientOf(q)) + (e.shiftKey ? n - 1 : 1)) % n];
            if (next === "all") delete q.orient; else q.orient = next;
            touch(); save();
            paintBook(true);
            /* the Series Lab redraws the next time the canvas does - nudge it */
            try { app.graph.setDirtyCanvas(true, true); } catch (err) { /* ignore */ }
            say(`${numOf(q)} ${q.name} - ${ORIENT_NAME[next]}`);
          });
          el.querySelector(".lsb-or")?.addEventListener("dblclick", (e) => e.stopPropagation());
          let clickT = null;
          el.addEventListener("click", () => {
            /* a double click is a rename; wait a moment so its first click
               does not switch prompts underneath it */
            if (clickT) return;
            clickT = setTimeout(() => { clickT = null; activate(id); }, 220);
          });
          el.addEventListener("dblclick", (e) => {
            e.stopPropagation();
            if (clickT) { clearTimeout(clickT); clickT = null; }
            const q = book.prompts.find(x => x.id === id);
            if (!q) return;
            renameInline(el, q.name, (v) => {
              q.name = uniquePromptName(v, groupOf(q), q);
              q.fresh = false;
              touch(); save();
            });
          });
          /* Right click writes a note. Read from the right button going down
             as well as from the menu event: the canvas underneath can take
             the menu event for itself before it reaches the chip. */
          const noteFromChip = (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (clickT) { clearTimeout(clickT); clickT = null; }
            if (noteEd && noteEd.q && noteEd.q.id === id) return;
            const q = book.prompts.find(x => x.id === id);
            if (!q) return;
            try { openPromptNote(el, q); }
            catch (err) { say("the note could not be opened" + (err && err.message ? ` - ${err.message}` : ""), "err"); }
          };
          el.addEventListener("pointerdown", (e) => { if (e.button === 2) noteFromChip(e); });
          el.addEventListener("contextmenu", noteFromChip);
          el.addEventListener("dragstart", (e) => {
            e.dataTransfer.setData(DT_PROMPT, String(id));
            e.dataTransfer.effectAllowed = "move";
          });
          el.addEventListener("dragover", (e) => {
            const t = e.dataTransfer.types;
            if (!t.includes(DT_CAP) && !t.includes(DT_PROMPT)) return;
            e.preventDefault();
            el.classList.add("drop");
          });
          el.addEventListener("dragleave", () => el.classList.remove("drop"));
          el.addEventListener("drop", (e) => {
            el.classList.remove("drop");
            const cap = e.dataTransfer.getData(DT_CAP);
            const pr = e.dataTransfer.getData(DT_PROMPT);
            if (!cap && !pr) return;
            e.preventDefault();
            e.stopPropagation();
            const q = book.prompts.find(x => x.id === id);
            if (cap) { putCap(Number(cap), q); return; }
            const moving = book.prompts.find(x => x.id === Number(pr));
            if (!moving || moving === q) return;
            /* dropped on a prompt of another series: it moves there */
            if (moving.g !== q.g) { movePrompt(moving.id, q.g); return; }
            writeBack();
            book.prompts.splice(book.prompts.indexOf(moving), 1);
            book.prompts.splice(book.prompts.indexOf(q), 0, moving);
            touch(); save();
          });
        }

        host.querySelector(".lsb-mine")?.addEventListener("click", () => {
          book.ui = { ...bookUi(), mine: !bookUi().mine };
          save();
          paintBook(true);
          requestAnimationFrame(fitNodeToContent);
        });
        host.querySelector(".lsb-inuse")?.addEventListener("click", () => {
          book.ui = { ...bookUi(), used: !bookUi().used, mine: false };
          save();
          paintBook(true);
          requestAnimationFrame(fitNodeToContent);
        });
        host.querySelector(".lsb-tidy")?.addEventListener("click", (e) => {
          if (armedDel !== "tidy") { armDel("tidy"); return; }
          tidyCaps(String(e.currentTarget.dataset.ids || "").split(",").filter(Boolean).map(Number));
        });

        host.querySelector(".lsb-trt")?.addEventListener("click", async () => {
          const on = !bookUi().tr;
          book.ui = { ...bookUi(), tr: on };
          save();
          paintBook(true);
          if (!on) return;
          /* Asked for here, inside the click: a browser only lets a page
             fetch a translation model in answer to something the user did. */
          if (!trHas()) {
            say("translation needs Chrome or Edge 138 or later", "err");
            return;
          }
          try {
            await trEngineFor("en", capTarget(), null);
            say(`capsules translate into ${trName(capTarget())} on hover`);
          } catch (err) {
            say(String(err && err.message || err), "err");
          }
        });

        const trl = host.querySelector(".lsb-trl");
        if (trl) {
          for (const ev of ["pointerdown", "mousedown", "click"]) trl.addEventListener(ev, e => e.stopPropagation());
          trl.addEventListener("change", async () => {
            book.ui = { ...bookUi(), trTo: trl.value };
            save();
            /* inside the change, so the browser lets the model download */
            try {
              await trEngineFor("en", trl.value, null);
              say(`capsules translate into ${trName(trl.value)} on hover`);
            } catch (err) {
              say(String(err && err.message || err), "err");
            }
          });
        }

        for (const el of host.querySelectorAll(".lsb-c")) {
          const id = Number(el.dataset.id);
          let clickT = null;
          el.addEventListener("mouseenter", () => capCardSoon(el, id));
          el.addEventListener("mouseleave", capCardHide);
          el.addEventListener("pointerdown", capCardHide);
          el.addEventListener("dragstart", capCardHide);
          el.addEventListener("click", (e) => {
            if (e.target.closest(".x")) return;
            const scope = e.shiftKey ? ((e.ctrlKey || e.metaKey) ? "all" : "series") : null;
            const stack = e.altKey;
            if (clickT) return;
            clickT = setTimeout(() => {
              clickT = null;
              /* Alt: beside the capsule of its kind, not in its place */
              if (stack) { putCap(id, null, null, scope, true); return; }
              /* a capsule already in the open prompt is taken out of it by a
                 plain click - it stays on the shelf, unused, to be clicked
                 back in */
              const ap = activePrompt();
              if (!scope && ap && ap.caps.includes(id)) takeOutCap(id, ap);
              else putCap(id, null, null, scope);
            }, 220);
          });
          el.addEventListener("dblclick", (e) => {
            e.stopPropagation();
            if (e.target.closest(".x")) return;
            if (clickT) { clearTimeout(clickT); clickT = null; }
            const c = book.caps[id];
            if (!c) return;
            renameInline(el, c.name, (v) => {
              c.name = v;
              touch(); save();
            });
          });
          el.querySelector(".x")?.addEventListener("click", (e) => {
            e.stopPropagation();
            const used = useCounts().get(id) || 0;
            if (used && armedDel !== id) {
              armDel(id);
              say(`click the x again to delete it from ${used} prompt${used === 1 ? "" : "s"}`);
              return;
            }
            deleteCap(id);
          });
          el.addEventListener("dragstart", (e) => {
            e.dataTransfer.setData(DT_CAP, String(id));
            e.dataTransfer.effectAllowed = "copy";
          });
          /* right click: keep it in the drawer */
          el.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            e.stopPropagation();
            keepInDrawer(id);
          });
        }
        wireDrawer(host);
      }

      /* ---------- the Drawer, at work ---------- */
      /* Keeping a capsule takes the picture a Visual Image Viewer is showing
         along with it - the moment a capsule is worth keeping is usually the
         moment its render is on screen. A card already in the drawer without
         a picture is given that one. */
      async function keepInDrawer(cid) {
        const c = book && book.caps[cid];
        if (!c) return;
        const r = await keepWords(c.kind, c.name, c.sec.text, viewerPicture());
        say(r.msg, r.ok ? undefined : "err");
      }
      /* Keep words in the drawer, with a picture - from a capsule here, or
         straight from the Visual Image Viewer's prompt panel, which passes
         the very render the words were read from. A card with the same
         words already kept is given the picture if it had none. */
      async function keepWords(kind, name, text, src) {
        text = String(text || "").trim();
        if (!DRAWER_KINDS.includes(kind)) {
          return { ok: false, msg: `a ${KIND_LABEL[kind] || kind} anchor stays with its series - the drawer keeps the other kinds` };
        }
        if (!text) return { ok: false, msg: "an empty anchor - nothing to keep" };
        const thumb = src ? await drawerThumbFrom(src) : null;
        /* The folder open in the drawer is the one being filled: what is
           kept while "Ballet" is open goes into Ballet, nothing to sort later. */
        const dr = bookUi().dr;
        const folder = dr.folder && fKind(dr.folder) === kind && (drawerStore.folders || []).includes(dr.folder) ? dr.folder : "";
        const into = folder ? ` - into ${fName(folder)}` : "";
        const had = drawerStore.items.find(x => x.kind === kind && sameText(x.text, text));
        if (had) {
          const newPic = thumb && (!had.thumb || src !== viewerPicture());
          if (newPic) {
            drawerWrite(drawerStore.items.map(i => i.id === had.id ? { ...i, thumb } : i));
            return { ok: true, name: had.name, had: true, msg: `already in the drawer as "${had.name}" - it has this picture now` };
          }
          return { ok: true, name: had.name, had: true, msg: `already in the drawer, as "${had.name}"` };
        }
        const item = { id: drawerId(), kind, name: String(name || "").trim() || KIND_LABEL[kind], text,
                       tags: drawerGuessTags(name), thumb: thumb || null, added: Date.now(), folder };
        drawerWrite([item, ...drawerStore.items]);
        if (!dr.open || (dr.kind !== "all" && dr.kind !== kind))
          setDrawerUi({ open: true, kind: dr.kind === "all" ? "all" : kind });
        return { ok: true, name: item.name, msg: thumb
          ? `"${item.name}" kept in the drawer with the picture${into}`
          : `"${item.name}" kept in the drawer${into} - double click it there to give it a picture` };
      }
      /* A card onto the open series' capsule shelf without putting it in
         the prompt - several gathered this way are what a sweep goes
         through. The same words already on the shelf are that capsule. */
      function shelveFromDrawer(did) {
        const x = drawerStore.items.find(i => i.id === did);
        const g = activeGroup();
        if (!x || !g) { say("open a series first - the card goes onto its capsule shelf", "err"); return; }
        const twin = Object.values(book.caps)
          .find(c => c.g === g.id && c.kind === x.kind && sameText(c.sec.text, x.text));
        if (twin) { say(`already a capsule of this series, as "${twin.name}"`); return; }
        newCap(x.kind, x.name, {
          title: KIND_TITLE[x.kind] || "Section", text: x.text, html: "", on: true,
          h: 90, color: 0, extMode: "replace",
        }, g.id, x.name);
        book.shelf = true;
        /* a capsule added on purpose is meant to be seen: In use, which hides
           the ones no prompt uses, is turned off for it */
        const wasHiding = bookUi().used || bookUi().mine;
        if (wasHiding) book.ui = { ...bookUi(), used: false, mine: false };
        touch(); save();
        paintBook();
        requestAnimationFrame(fitNodeToContent);
        say(`${x.name} - added to the capsules of series ${g.no}` + (wasHiding ? " (the filter turned off to show it)" : ""));
      }
      function takeFromDrawer(did, beside) {
        const x = drawerStore.items.find(i => i.id === did);
        if (!x) return;
        const p = activePrompt();
        if (!p) { say("open a prompt first - the drawer fills the prompt that is open", "err"); return; }
        pasteIntoBook({ name: null, anchors: [{ kind: x.kind, text: x.text, cap: x.name, beside: !!beside }] }, true);
        const q = activePrompt();
        say(`${x.name} - ${beside ? "added beside the " + KIND_LABEL[x.kind].toLowerCase() + " of" : "put in"} ${q ? numOf(q) + " " + q.name : "the open prompt"}`);
      }
      /* A card clicked asks first, saying what it replaces: a drawer is
         browsed by clicking around, and a click that changed the prompt at
         once turned looking into editing. Dragging a card onto a section
         still puts it in straight away - that is already a decision. */
      let drAskBox = null;
      function closeDrawerAsk() {
        if (drAskBox) { drAskBox.remove(); drAskBox = null; }
        document.removeEventListener("pointerdown", drAskOut, true);
        document.removeEventListener("keydown", drAskKey, true);
      }
      function drAskOut(ev) {
        if (drAskBox && !drAskBox.contains(ev.target)) closeDrawerAsk();
      }
      function drAskKey(ev) {
        if (!drAskBox) return;
        if (ev.key === "Escape") { ev.stopPropagation(); closeDrawerAsk(); }
        if (ev.key === "Enter") { ev.stopPropagation(); ev.preventDefault(); drAskBox.querySelector(".ok")?.click(); }
      }
      function askTakeFromDrawer(did, el) {
        closeDrawerAsk();
        const x = drawerStore.items.find(i => i.id === did);
        if (!x) return;
        const p = activePrompt();
        if (!p) { say("open a prompt first - the drawer fills the prompt that is open", "err"); return; }
        const cur = p.caps.map(c => book.caps[c]).find(c => c && c.kind === x.kind);
        const same = cur && sameText(cur.sec.text, x.text);
        const box = document.createElement("div");
        box.className = "lvp-help lsb-dask " + ROOT_CLASS;
        box.innerHTML = `<div class="q">Put <b>${escapeHtml(x.name)}</b> into
          <b>${escapeHtml(numOf(p) + " " + p.name)}</b>?</div>
          <div class="w">${same ? "It is already the " + KIND_LABEL[x.kind].toLowerCase() + " of this prompt."
            : cur ? `It takes the place of its ${KIND_LABEL[x.kind].toLowerCase()}, <b>${escapeHtml(cur.name)}</b> - that capsule stays on the shelf.`
            : `The prompt has no ${KIND_LABEL[x.kind].toLowerCase()} yet; this becomes it.`}</div>
          ${same ? "" : riskOf(riskCtx(), x.kind, x.name, x.text).map(r => `<div class="rk"><b>! ${escapeHtml(r.title)}</b> ${escapeHtml(r.fix)}</div>`).join("")}
          <div class="close">${same ? "" : `<button class="lvp-btn ok">Put it in</button>`}<button class="lvp-btn edit" title="Open the card - name, kind, tags, words and picture">Edit card</button><button class="lvp-btn cancel">Cancel</button></div>`;
        document.body.appendChild(box);
        const r = el.getBoundingClientRect();
        const w = box.offsetWidth, h = box.offsetHeight;
        box.style.left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 8)) + "px";
        box.style.top = Math.max(8, Math.min(r.bottom + 6, window.innerHeight - h - 8)) + "px";
        drAskBox = box;
        box.querySelector(".cancel").addEventListener("click", (e) => { e.stopPropagation(); closeDrawerAsk(); });
        box.querySelector(".edit").addEventListener("click", (e) => {
          e.stopPropagation();
          closeDrawerAsk();
          editDrawerItem(did, el);
        });
        box.querySelector(".ok")?.addEventListener("click", (e) => {
          e.stopPropagation();
          closeDrawerAsk();
          takeFromDrawer(did);
        });
        for (const k of ["keyup", "keypress", "mousedown", "wheel"]) {
          box.addEventListener(k, ev => ev.stopPropagation());
        }
        setTimeout(() => {
          document.addEventListener("pointerdown", drAskOut, true);
          document.addEventListener("keydown", drAskKey, true);
        }, 0);
      }
      let drEditBox = null;
      let drEditTake = null;
      function closeDrawerEdit() {
        if (drEditBox) { drEditBox.remove(); drEditBox = null; }
        drEditTake = null;
        document.removeEventListener("keydown", drEditEsc, true);
        document.removeEventListener("pointerdown", drEditOut, true);
      }
      function drEditOut(ev) {
        if (!drEditBox || drEditBox.contains(ev.target)) return;
        /* A press on an Image Viewer is choosing the picture, not leaving:
           a picture clicked in its grid or its large view goes straight onto
           the card. */
        const t = ev.target;
        if (t.closest && t.closest(".viv")) {
          const cell = t.closest(".viv-cell, .viv-stage");
          const img = cell && cell.querySelector("img");
          if (img && img.src && drEditTake) drEditTake(img.src);
          return;
        }
        closeDrawerEdit();
      }
      function drEditEsc(ev) {
        if (ev.key === "Escape") { ev.stopPropagation(); closeDrawerEdit(); }
      }
      function editDrawerItem(did, anchor, draft) {
        closeDrawerEdit();
        /* no id: a new card, from the drawer's "+ card" */
        const isNew = !did;
        const x = isNew ? draft : drawerStore.items.find(i => i.id === did);
        if (!x) return;
        let thumb = x.thumb || null;
        const box = document.createElement("div");
        box.className = "lvp-help lsb-dedit " + ROOT_CLASS;
        const ico = (d) => `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
        const I_VIEW = ico(`<rect x="2" y="2.5" width="12" height="11" rx="1.5"/><circle cx="6" cy="6.3" r="1.3"/><path d="M2.5 12l3.6-3.4 2.6 2.4 2-1.8 2.8 2.6"/>`);
        const I_FILE = ico(`<path d="M2.5 4.5v8a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V6.5a1 1 0 0 0-1-1H8L6.5 3.5h-3a1 1 0 0 0-1 1z"/>`);
        const I_X = ico(`<path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>`);
        const kindOpts = DRAWER_KINDS.map(k =>
          `<option value="${k}"${k === x.kind ? " selected" : ""}>${KIND_LABEL[k]}</option>`).join("");
        box.innerHTML = `
          <div class="hd"><span class="kb"></span><span class="tt">${isNew ? "New drawer card" : "Drawer card"}</span><span class="sp"></span>
            <button class="xx" title="Close  (Esc)">${I_X}</button></div>
          <div class="bd">
            <div class="lf">
              <div class="pv" title="Click a picture in a Visual Image Viewer, or paste or drop one here"></div>
              <button class="pbtn fromv" title="Takes the picture open large in a Visual Image Viewer node, or the one framed in its grid. While this card is open, clicking a picture in the viewer puts it in too">${I_VIEW}<span>Select from Visual Image Viewer</span></button>
              <button class="pbtn sub fromf" title="A picture from your computer">${I_FILE}<span>Choose a file</span></button>
              <div class="msg"></div>
            </div>
            <div class="rt">
              <div class="f"><label>Name</label><input class="nm" type="text" value="${escapeHtml(x.name)}"${isNew ? ` placeholder="Nella, Freckled Grin"` : ""}></div>
              <div class="f two">
                <div><label>Kind</label><select class="kd">${kindOpts}</select></div>
                <div><label>Tags <em>comma separated</em></label><input class="tg" type="text" value="${escapeHtml((x.tags || []).join(", "))}" placeholder="Amara, summer, editorial"></div>
              </div>
              <div class="f grow"><label>Words</label><textarea class="tx" rows="11"${isNew ? ` placeholder="The anchor's words - paste them here"` : ""}>${escapeHtml(x.text)}</textarea></div>
            </div>
          </div>
          <div class="ft"><span class="note">Drag the top bar to move this card  ·  Esc closes</span><span class="sp"></span>
            <button class="fbtn cancel">Cancel</button><button class="fbtn ok">${isNew ? "Add to drawer" : "Save"}</button></div>`;
        /* In the middle of the window, whatever the zoom or wherever the card
           sat: placed beside the card it could open half off the screen with
           its buttons out of reach. A press anywhere outside closes it. */
        document.body.appendChild(box);
        drEditBox = box;
        const pv = box.querySelector(".pv");
        const msg = box.querySelector(".msg");
        let msgT = 0;
        const tell = (t, bad) => {
          msg.textContent = t; msg.classList.toggle("bad", !!bad); msg.classList.add("on");
          clearTimeout(msgT); msgT = setTimeout(() => msg.classList.remove("on"), 4200);
        };
        const setThumb = (t) => {
          thumb = t;
          pv.classList.toggle("has", !!t);
          pv.innerHTML = t
            ? `<img src="${t}" alt=""><button class="clr" title="Remove the picture">${I_X}</button>`
            : `<div class="em">${I_VIEW}<span>No picture yet</span><small>click one in a<br>Visual Image Viewer,<br>or paste or drop it here</small></div>`;
          const clr = pv.querySelector(".clr");
          if (clr) clr.addEventListener("click", (e) => { e.stopPropagation(); setThumb(null); });
        };
        setThumb(thumb);
        const fromSrc = async (src) => {
          if (!src) { tell("No picture chosen yet - click one in a Visual Image Viewer and it comes straight in.", true); return; }
          const t = await drawerThumbFrom(src);
          if (t) { setThumb(t); tell("Picture set - Save to keep it."); }
          else tell("That picture could not be read.", true);
        };
        const kb = box.querySelector(".kb"), kd = box.querySelector(".kd");
        const paintKind = () => {
          kb.textContent = KIND_LABEL[kd.value] || kd.value;
          box.style.setProperty("--kh", KIND_HUE[kd.value] || "#d9b26a");
        };
        kd.addEventListener("change", paintKind);
        paintKind();
        box.querySelector(".xx").addEventListener("click", (e) => { e.stopPropagation(); closeDrawerEdit(); });
        /* The header moves it, so the viewer underneath can be reached. */
        const hd = box.querySelector(".hd");
        hd.addEventListener("pointerdown", (e) => {
          if (e.target.closest("button")) return;
          const r = box.getBoundingClientRect();
          const ox = e.clientX - r.left, oy = e.clientY - r.top;
          box.style.transform = "none"; box.style.left = r.left + "px"; box.style.top = r.top + "px";
          hd.setPointerCapture(e.pointerId);
          const mv = (ev) => {
            box.style.left = Math.max(0, Math.min(innerWidth - 80, ev.clientX - ox)) + "px";
            box.style.top = Math.max(0, Math.min(innerHeight - 40, ev.clientY - oy)) + "px";
          };
          const up = () => { hd.removeEventListener("pointermove", mv); hd.removeEventListener("pointerup", up); };
          hd.addEventListener("pointermove", mv); hd.addEventListener("pointerup", up);
        });
        drEditTake = fromSrc;
        const fromFile = (f) => {
          if (!f || !/^image\//.test(f.type)) return;
          const rd = new FileReader();
          rd.onload = () => fromSrc(rd.result);
          rd.readAsDataURL(f);
        };
        box.querySelector(".fromv").addEventListener("click", (e) => { e.stopPropagation(); fromSrc(viewerPicture()); });
        box.querySelector(".fromf").addEventListener("click", (e) => {
          e.stopPropagation();
          const inp = document.createElement("input");
          inp.type = "file"; inp.accept = "image/*";
          inp.onchange = () => fromFile(inp.files && inp.files[0]);
          inp.click();
        });
        box.addEventListener("paste", (e) => {
          const f = [...(e.clipboardData?.files || [])].find(f => /^image\//.test(f.type));
          if (f) { e.preventDefault(); e.stopPropagation(); fromFile(f); }
        });
        box.addEventListener("dragover", (e) => { e.preventDefault(); e.stopPropagation(); pv.classList.add("over"); });
        box.addEventListener("dragleave", (e) => { if (!box.contains(e.relatedTarget)) pv.classList.remove("over"); });
        box.addEventListener("drop", (e) => {
          e.preventDefault(); e.stopPropagation(); pv.classList.remove("over");
          const f = [...(e.dataTransfer?.files || [])].find(f => /^image\//.test(f.type));
          if (f) fromFile(f);
          else fromSrc(e.dataTransfer.getData("text/uri-list") || null);
        });
        box.querySelector(".cancel").addEventListener("click", (e) => { e.stopPropagation(); closeDrawerEdit(); });
        box.querySelector(".ok").addEventListener("click", (e) => {
          e.stopPropagation();
          const text = box.querySelector(".tx").value.trim();
          if (!text) { tell("A drawer card needs its words.", true); return; }
          const tags = [...new Set(box.querySelector(".tg").value.split(",")
            .map(t => t.trim().replace(/\s+/g, " ")).filter(Boolean))].slice(0, 12);
          if (isNew) {
            const kind = box.querySelector(".kd").value;
            const had = drawerStore.items.find(i => i.kind === kind && sameText(i.text, text));
            if (had) { tell(`These words are already in the drawer, as "${had.name}".`, true); return; }
            const name = box.querySelector(".nm").value.trim() || KIND_LABEL[kind];
            /* the open folder is the one being filled, when it is of this kind */
            const dr = bookUi().dr;
            const folder = dr.folder && fKind(dr.folder) === kind && (drawerStore.folders || []).includes(dr.folder) ? dr.folder : "";
            drawerWrite([{ id: drawerId(), kind, name, text, tags: tags.length ? tags : drawerGuessTags(name),
                           thumb, added: Date.now(), folder, edited: true }, ...drawerStore.items]);
            closeDrawerEdit();
            if (dr.kind !== "all" && dr.kind !== kind) setDrawerUi({ open: true, kind, tag: [] });
            say(`"${name}" added to the drawer${folder ? ` - into ${fName(folder)}` : ""}`);
            return;
          }
          const next = drawerStore.items.map(i => i.id !== did ? i : {
            ...i, name: box.querySelector(".nm").value.trim() || i.name,
            kind: box.querySelector(".kd").value, tags, text, thumb,
            /* edited by hand: a later pack will not rewrite it */
            edited: i.edited || text !== i.text || box.querySelector(".kd").value !== i.kind });
          drawerWrite(next);
          closeDrawerEdit();
          say("drawer card saved");
        });
        for (const k of ["keydown", "keyup", "keypress", "pointerdown", "mousedown", "wheel"]) {
          box.addEventListener(k, ev => ev.stopPropagation());
        }
        document.addEventListener("keydown", drEditEsc, true);
        setTimeout(() => document.addEventListener("pointerdown", drEditOut, true), 0);
        box.querySelector(".nm").focus();
      }
      function wireDrawer(host) {
        const drw = host.querySelector(".lsb-drawer");
        if (!drw) return;
        for (const b of drw.querySelectorAll(".lsb-dlay .lay")) {
          b.addEventListener("click", (e) => {
            e.stopPropagation();
            const want = b.dataset.side === "1";
            if (want === drawerBeside()) return;
            book.ui = { ...bookUi(), dr: { ...bookUi().dr, side: want } };
            bookPanelKnown = 0; drSlotKnown = 0;
            if (want && !sideMode()) { setSideMode(true); return; }   // saves and repaints
            save();
            paintBook(true);
            requestAnimationFrame(() => requestAnimationFrame(fitNodeToContent));
          });
        }
        drw.querySelector(".lsb-drhead").addEventListener("click", (e) => {
          if (e.target.closest(".lsb-dk, .lsb-dq, .lsb-dtone, .lsb-dsz, .lsb-dlay")) return;
          if (e.target.closest(".lsb-dhelp")) {
            e.stopPropagation();
            openCapHelp(e.target.closest(".lsb-dhelp"), "drawer");
            return;
          }
          setDrawerUi({ open: !bookUi().dr.open });
        });
        const tn = drw.querySelector(".lsb-dtone");
        if (tn) tn.addEventListener("click", (e) => {
          e.stopPropagation();
          const n = DRAWER_TONES.length;
          setDrawerUi({ tone: (bookUi().dr.tone + (e.shiftKey ? n - 1 : 1)) % n });
        });
        const sz = drw.querySelector(".lsb-dsz input");
        if (sz) {
          /* the cards follow the slider as it moves; the size is kept when it is let go */
          /* The node follows the drawer as it grows, once a frame. Left to the
             end of the drag, the cards spilled past the node's edge, and the
             canvas kept the old frames of them on screen - every card drawn
             twice, a step apart. */
          let szFrame = 0;
          sz.addEventListener("input", () => {
            drw.style.setProperty("--dsz", sz.value + "px");
            sz.style.setProperty("--pct", Math.round(100 * (sz.value - DRAWER_SIZE[0]) / (DRAWER_SIZE[1] - DRAWER_SIZE[0])) + "%");
            drw.classList.remove("dz-s", "dz-m", "dz-l");
            drw.classList.add(drawerSizeClass(Number(sz.value)));
            if (!szFrame) szFrame = requestAnimationFrame(() => {
              szFrame = 0;
              bookPanelKnown = 0; drSlotKnown = 0;
              fitNodeToContent();
              try { node.setDirtyCanvas(true, true); } catch (e) { /* ignore */ }
            });
          });
          sz.addEventListener("change", () => { setDrawerUi({ size: Number(sz.value) }); });
          for (const k of ["pointerdown", "mousedown", "click", "keydown", "wheel"]) {
            sz.addEventListener(k, ev => ev.stopPropagation());
          }
        }
        for (const t of drw.querySelectorAll(".lsb-dk")) {
          t.addEventListener("click", (e) => { e.stopPropagation(); setDrawerUi({ kind: t.dataset.k, tag: [], folder: null }); drSel.clear(); fMenu = null; });
        }
        wireFolders(drw);
        for (const t of drw.querySelectorAll(".lsb-dt:not(.clr):not(.add)")) {
          /* a card dropped on a tag joins it - grouping after the fact */
          t.addEventListener("dragover", (e) => {
            if (!e.dataTransfer.types.includes(DT_DRAWER)) return;
            e.preventDefault(); e.stopPropagation();
            t.classList.add("drop");
          });
          t.addEventListener("dragleave", () => t.classList.remove("drop"));
          t.addEventListener("drop", (e) => {
            const did = e.dataTransfer.getData(DT_DRAWER);
            if (!did) return;
            e.preventDefault(); e.stopPropagation();
            t.classList.remove("drop");
            const v = t.dataset.t;
            const x = drawerStore.items.find(i => i.id === did);
            if (!x) return;
            if ((x.tags || []).includes(v)) { say(`"${x.name}" is already in ${v}`); return; }
            drawerWrite(drawerStore.items.map(i => i.id === did ? { ...i, tags: [...(i.tags || []), v] } : i));
            say(`"${x.name}" added to ${v}`);
          });
        }
        for (const t of drw.querySelectorAll(".lsb-dt")) {
          t.addEventListener("click", (e) => {
            e.stopPropagation();
            if (t.classList.contains("clr")) { setDrawerUi({ tag: [] }); return; }
            const cur = bookUi().dr.tag;
            const v = t.dataset.t;
            setDrawerUi({ tag: cur.includes(v) ? cur.filter(x => x !== v) : [...cur, v] });
          });
        }
        const q = drw.querySelector(".lsb-dq");
        if (q) {
          const filt = () => {
            drQ = q.value;
            const v = q.value.trim().toLowerCase();
            for (const c of drw.querySelectorAll(".lsb-dc, .lsb-dfold")) {
              c.style.display = !v || String(c.dataset.hay || "").includes(v) ? "" : "none";
            }
          };
          q.addEventListener("input", () => { filt(); requestAnimationFrame(fitNodeToContent); });
          filt();
          for (const k of ["keydown", "keyup", "keypress", "pointerdown", "mousedown", "click"]) {
            q.addEventListener(k, ev => ev.stopPropagation());
          }
        }
        drw.addEventListener("dragover", (e) => {
          if (!e.dataTransfer.types.includes(DT_CAP)) return;
          e.preventDefault();
          drw.classList.add("drop");
        });
        drw.addEventListener("dragleave", (e) => {
          if (!drw.contains(e.relatedTarget)) drw.classList.remove("drop");
        });
        drw.addEventListener("drop", (e) => {
          drw.classList.remove("drop");
          const id = e.dataTransfer.getData(DT_CAP);
          if (!id) return;
          e.preventDefault();
          e.stopPropagation();
          keepInDrawer(Number(id));
        });
        for (const el of drw.querySelectorAll(".lsb-dc.now")) {
          /* A card of the open prompt reads like its capsule; double click
             opens its drawer card, right click keeps a loose one. */
          const cid = Number(el.dataset.cap);
          /* the card of a capsule in the prompt does less than the capsule:
             it is there to be read, given a picture, or kept */
          el.addEventListener("mouseenter", () => capCardSoon(el, cid, el.dataset.id
            ? [["Double click", "Open its drawer card - to change the picture"],
               ["Right click", "Give it the viewer's picture, if the card has none"]]
            : [["Right click", "Keep it in the Drawer, with the viewer's picture"],
               ["Dashed", "Not in the Drawer yet"]]));
          el.addEventListener("mouseleave", capCardHide);
          el.addEventListener("pointerdown", capCardHide);
          el.addEventListener("dblclick", (e) => {
            e.stopPropagation();
            if (el.dataset.id) editDrawerItem(el.dataset.id, el);
            else say("not in the drawer yet - right click to keep it, with the viewer's picture");
          });
          el.addEventListener("contextmenu", (e) => {
            e.preventDefault(); e.stopPropagation();
            capCardHide();
            keepInDrawer(cid);
          });
        }
        for (const el of drw.querySelectorAll(".lsb-dc:not(.now)")) {
          const did = el.dataset.id;
          let clickT = null;
          el.addEventListener("mouseenter", () => drawerCardSoon(el, did));
          el.addEventListener("mouseleave", capCardHide);
          el.addEventListener("pointerdown", capCardHide);
          el.addEventListener("dragstart", capCardHide);
          el.addEventListener("click", (e) => {
            if (e.target.closest(".x")) return;
            /* Ctrl picks a card, Shift a run of them - to drag into a folder;
               the box at its corner picks it too */
            if (e.target.closest(".ck") && !e.shiftKey) {
              e.stopPropagation();
              if (drSel.has(did)) drSel.delete(did); else drSel.add(did);
              drSelAt = did;
              paintBook(true);
              return;
            }
            if (e.ctrlKey || e.metaKey || e.shiftKey) {
              e.stopPropagation();
              const ids = [...drw.querySelectorAll(".lsb-dc:not(.now)")].filter(c => c.offsetParent).map(c => c.dataset.id);
              if (e.shiftKey && drSelAt && ids.includes(drSelAt)) {
                const a = ids.indexOf(drSelAt), b = ids.indexOf(did);
                for (let k = Math.min(a, b); k <= Math.max(a, b); k++) drSel.add(ids[k]);
              } else {
                if (drSel.has(did)) drSel.delete(did); else drSel.add(did);
                drSelAt = did;
              }
              paintBook(true);
              return;
            }
            if (drSel.size) { drSel.clear(); drSelAt = null; paintBook(true); return; }
            if (clickT) return;
            clickT = setTimeout(() => { clickT = null; askTakeFromDrawer(did, el); }, 220);
          });
          /* Double click puts it straight in - the ask is for a single
             click, while browsing. Alt+double click only adds it to the
             series' capsules, to gather several for the Series Lab. */
          el.addEventListener("dblclick", (e) => {
            e.stopPropagation();
            if (clickT) { clearTimeout(clickT); clickT = null; }
            closeDrawerAsk();
            if (e.altKey) { shelveFromDrawer(did); return; }
            if (!activePrompt()) { say("open a prompt first - the drawer fills the prompt that is open", "err"); return; }
            takeFromDrawer(did);
          });
          el.addEventListener("contextmenu", (e) => {
            e.preventDefault(); e.stopPropagation();
            if (clickT) { clearTimeout(clickT); clickT = null; }
            capCardHide();
            closeDrawerAsk();
            editDrawerItem(did, el);
          });
          el.querySelector(".x").addEventListener("click", (e) => {
            e.stopPropagation();
            if (armedDr !== did) { armedDr = did; paintBook(); return; }
            armedDr = null;
            const gone = drawerStore.items.find(i => i.id === did);
            drawerWrite(drawerStore.items.filter(i => i.id !== did));
            say(`"${gone ? gone.name : "card"}" taken out of the drawer`);
          });
          el.addEventListener("dragstart", (e) => {
            e.dataTransfer.setData(DT_DRAWER, did);
            /* a picked card carries every picked card with it */
            const many = drSel.has(did) && drSel.size > 1 ? [...drSel] : [did];
            e.dataTransfer.setData(DT_DRAWER_MANY, many.join(","));
            e.dataTransfer.effectAllowed = "copyMove";
          });
        }
      }
      if (BOOK) drawerStore.subs.add(() => { if (root.isConnected) paintBook(); });

      /* A capsule dropped on a section takes that section's place in the open
         prompt, whatever kind it was - the drop says where on purpose. */
      list.addEventListener("dragover", (e) => {
        if (!BOOK || !(e.dataTransfer.types.includes(DT_CAP)
                       || e.dataTransfer.types.includes(DT_DRAWER))) return;
        const sec = e.target.closest?.(".lvp-sec");
        if (!sec) return;
        e.preventDefault();
        for (const x of list.querySelectorAll(".lvp-sec.lsb-drop")) {
          if (x !== sec) x.classList.remove("lsb-drop");
        }
        sec.classList.add("lsb-drop");
      });
      list.addEventListener("dragleave", (e) => {
        const sec = e.target.closest?.(".lvp-sec");
        if (sec && !sec.contains(e.relatedTarget)) sec.classList.remove("lsb-drop");
      });
      list.addEventListener("drop", (e) => {
        if (!BOOK) return;
        const fromDrawer = e.dataTransfer.getData(DT_DRAWER);
        if (fromDrawer) {
          e.preventDefault();
          e.stopPropagation();
          for (const x of list.querySelectorAll(".lsb-drop")) x.classList.remove("lsb-drop");
          takeFromDrawer(fromDrawer);
          return;
        }
        const cap = e.dataTransfer.getData(DT_CAP);
        if (!cap) return;
        const sec = e.target.closest?.(".lvp-sec");
        e.preventDefault();
        e.stopPropagation();
        for (const x of list.querySelectorAll(".lsb-drop")) x.classList.remove("lsb-drop");
        const at = sec ? Array.from(list.children).indexOf(sec) : -1;
        /* Alt held on the drop: beside its kind rather than over a box */
        if (e.altKey) { putCap(Number(cap), null, null, null, true); return; }
        putCap(Number(cap), null, at >= 0 ? at : null);
      });

      /* ---------- messages ---------- */
      /* Said in the footer only. The Book had a second line for it under the
         series, but a line that came and went moved everything below it, and
         one kept for it sat empty most of the time. */
      let sayT = null;
      let sayNow = null;
      function say(text, kind) {
        sayNow = { text, kind };
        const targets = [foot.querySelector(".lvp-msg")];
        for (const el of targets) {
          if (!el) continue;
          el.textContent = text;
          el.title = text;
          el.classList.toggle("err", kind === "err");
        }
        if (sayT) clearTimeout(sayT);
        sayT = setTimeout(() => {
          sayNow = null;
          for (const el of [foot.querySelector(".lvp-msg")]) {
            if (el) { el.textContent = ""; el.title = ""; }
          }
          requestAnimationFrame(fitNodeToContent);
        }, 6000);
        requestAnimationFrame(fitNodeToContent);
      }

      /* ---------- paste a reply ---------- */
      function autoFit() {
        /* Fit wants the boxes measured, which needs the new text on screen. */
        requestAnimationFrame(() => requestAnimationFrame(() =>
          root.querySelector(".fit")?.click()));
      }

      function pasteIntoComposer(r) {
        snapPush(state.sections, "before paste");
        const done = [];
        for (const a of r.anchors) {
          let s = state.sections.find(x => kindOf(x.title) === a.kind);
          if (!s) {
            if (state.sections.length >= MAX_SLOTS) continue;
            s = { id: nextId(), slot: 0, title: KIND_TITLE[a.kind], text: "", html: "",
                  on: true, h: 90, extMode: "replace" };
            const want = KIND_ORDER.indexOf(a.kind);
            const at = state.sections.findIndex(x => KIND_ORDER.indexOf(kindOf(x.title)) > want);
            if (at < 0) state.sections.push(s); else state.sections.splice(at, 0, s);
          }
          s.text = a.text;
          s.html = "";
          done.push(KIND_LABEL[a.kind]);
        }
        if (r.name) node.title = r.name;
        assignSlots();
        touch(); render(); save();
        autoFit();
        say((r.name ? `${r.name} - ` : "") + done.join(", ") + " pasted");
      }

      function pasteIntoBook(r, quiet, tg) {
        writeBack();
        const key = (s) => String(s || "").trim().toLowerCase();
        const act = activePrompt();
        /* the book is read back after every paste - a series is found again
           by its id, never held on to as an object */
        const g = (tg && groupById(tg.id)) || tg || groupOf(act) || activeGroup();
        /* where a new scene goes: after the open prompt when it is in this
           series, else after the series' last */
        const cur = act && act.g === g.id ? act : (promptsOf(g).slice(-1)[0] || null);
        /* a name is looked for in the open series only: updating a scene of
           another series by accident is worse than adding one here */
        let p = r.name ? promptsOf(g).find(x => key(x.name) === key(r.name)) : null;
        /* "C-08 The Riding Lesson" renamed "C-08 The Horse Rears" is still
           cut C-08: the same code updates that prompt and gives it the name */
        const code = (v) => key((/^([A-Z]{1,2}-\d+[A-Z]?)(?=[\s,.:]|$)/i.exec(String(v || "").trim()) || [])[1]);
        let renamedScene = false;
        if (!p && r.name && code(r.name)) {
          p = promptsOf(g).find(x => code(x.name) === code(r.name)) || null;
          if (p) { p.name = uniquePromptName(r.name, g, p); renamedScene = true; }
        }
        let how = "updated";
        if (!p && r.name) {
          if (cur && cur.fresh) {
            /* a copy just made and not touched yet: this is what it was for */
            p = cur;
            p.name = uniquePromptName(r.name, g, p);
            how = "filled in";
          } else {
            /* A pasted new scene starts from nothing: only the anchors it
               brings. An anchor it leaves out stays out, rather than being
               borrowed from the prompt that happened to be open. Only the
               LoRA trigger comes along - it belongs to the LoRA, not the scene. */
            /* a series just made has no prompt to take the trigger from:
               the open prompt's, copied into it */
            const trig = cur ? cur.caps.filter(x => book.caps[x]?.kind === "trigger")
              : (act ? act.caps.filter(x => book.caps[x]?.kind === "trigger").map(x => capFor(x, g.id)) : []);
            p = { id: bookId(), g: g.id, no: nextNo(g), name: uniquePromptName(r.name, g), caps: trig };
            book.prompts.splice(cur ? book.prompts.indexOf(cur) + 1 : book.prompts.length, 0, p);
            how = "added";
          }
        }
        if (!p) p = cur;
        if (!p) return;
        const done = [], named = [];
        /* A name from the label goes on the capsule even when the words are
           already there - which is how a reply renames capsules it does not
           change. */
        const nameCap = (cid, a) => {
          const c = book.caps[cid];
          if (!c || !a.cap || c.name.trim().toLowerCase() === a.cap.toLowerCase()) return;
          c.name = "";
          c.name = uniqueCapName(c.kind, a.cap, c.g);
          named.push(KIND_LABEL[a.kind]);
        };
        /* A pasted anchor takes the place of the capsule of its kind, as it
           always has. A prompt holding two of that kind - one added beside
           with Alt - keeps only the pasted one: the others are taken out and
           stay on the shelf. */
        for (const a of r.anchors) {
          const ofKind = p.caps.map((x, i) => (book.caps[x]?.kind === a.kind ? i : -1)).filter(i => i >= 0);
          const idx = a.beside ? -1 : (ofKind[0] ?? -1);
          const besideIt = !!a.beside;
          if (!a.beside && ofKind.length > 1) {
            const extra = new Set(ofKind.slice(1).map(i => p.caps[i]));
            p.caps = p.caps.filter(x => !extra.has(x));
          }
          const old = idx >= 0 ? book.caps[p.caps[idx]] : null;
          if (old && sameText(old.sec.text, a.text)) { nameCap(old.id, a); continue; }
          /* the same words already on this series' shelf are that capsule,
             not a second copy of it */
          const twin = Object.values(book.caps)
            .find(c => c.g === p.g && c.kind === a.kind && sameText(c.sec.text, a.text));
          if (twin) nameCap(twin.id, a);
          const cid = twin ? twin.id : newCap(a.kind, p.name, {
            title: old ? old.sec.title : KIND_TITLE[a.kind],
            text: a.text, html: "", on: true,
            h: old ? old.sec.h : 90, color: old ? old.sec.color || 0 : 0,
            extMode: "replace", tr: old ? !!old.sec.tr : false,
            trH: old ? old.sec.trH : undefined,
          }, p.g, a.cap);
          if (idx >= 0) p.caps[idx] = cid;
          else if (p.caps.includes(cid)) { /* already in this prompt */ }
          else if (besideIt) insertBeside(p, cid);
          else insertByKind(p, cid);
          done.push(KIND_LABEL[a.kind]);
        }
        if (r.note != null && String(r.note).trim()) p.note = String(r.note).trim().slice(0, 4000);
        if (r.frame) { if (r.frame === "all") delete p.orient; else p.orient = r.frame; }
        p.fresh = false;
        book.active = p.id;
        sweepCaps();
        reopen();
        touch(); save();
        fitNodeToContent();
        autoFit();
        if (quiet) return { how, named: named.length, pid: p.id, renamedScene };
        say(`${numOf(p)} ${p.name} ${how}` + (done.length ? ` - ${done.join(", ")}` : named.length ? "" : " - nothing had changed")
          + (named.length ? `${done.length ? "; " : " - "}renamed ${named.join(", ")}` : ""));
      }

      /* The series as text, in the very form Paste reads: each scene's name,
         then each anchor under a label carrying its capsule's name. Handed
         to someone - or to a chat - and pasted back, it changes only what was
         changed, and a label renamed on the way renames the capsule. */
      const LABEL_WORD = { trigger: "LORA TRIGGER", quality: "QUALITY", subject: "SUBJECT",
        outfit: "OUTFIT",
        pose: "POSE", scene: "SCENE", camera: "CAMERA", absolute: "ABSOLUTE" };
      function seriesText(groups) {
        writeBack();
        const out = [];
        for (const g of groups) {
          out.push(`# Series ${g.no} - ${g.name}`, "");
          if (String(g.note || "").trim()) out.push("NOTE:", String(g.note).trim(), "");
          for (const p of promptsOf(g)) {
            out.push(`**${p.name}**`, "");
            if (orientOf(p) !== "all") out.push(`FRAME: ${orientOf(p)}`);
            if (String(p.note || "").trim()) out.push("NOTE:", String(p.note).trim(), "");
            for (const cid of p.caps) {
              const c = book.caps[cid];
              const text = c && String(c.sec.text || "").trim();
              if (!text || !LABEL_WORD[c.kind]) continue;
              out.push(`${LABEL_WORD[c.kind]} · ${c.name}`, "```", text, "```", "");
            }
          }
        }
        return out.join("\n").trim() + "\n";
      }
      async function copySeries(all) {
        if (!book) return;
        const gs = all ? book.groups : [activeGroup()].filter(Boolean);
        const text = seriesText(gs);
        let ok = false;
        try { await navigator.clipboard.writeText(text); ok = true; } catch (e) {
          /* not https or localhost: the old way still works from a click */
          const ta = document.createElement("textarea");
          ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
          document.body.appendChild(ta); ta.select();
          try { ok = document.execCommand("copy"); } catch (e2) { ok = false; }
          ta.remove();
        }
        const n = gs.reduce((a, g) => a + promptsOf(g).length, 0);
        say(ok ? `${n} prompt${n === 1 ? "" : "s"} copied` + (all && gs.length > 1 ? ` from ${gs.length} series` : "")
          + " - paste them back here to apply any change" : "could not reach the clipboard", ok ? "" : "err");
      }

      /* The series' own Paste: whatever series is open, the scenes go to
         this one - its last prompt is made the open one first. */
      function focusGroup(gid) {
        const g = groupById(gid);
        if (!g) return false;
        if (groupOf(activePrompt()) === g) return true;
        const ps = promptsOf(g);
        if (!ps.length) return false;
        writeBack();
        book.active = ps[ps.length - 1].id;
        reopen();
        return true;
      }
      function applyReply(text, forceGid, whole) {
        const split = splitScenes(text || "");
        const r = parseReply(split.length === 1 ? split[0].text : (text || ""));
        const missedNote = (m) => (m && m.length)
          ? `${m.map(k => KIND_LABEL[k]).join(", ")} label not read - its capsule name is not a short title; that anchor was left as it was`
          : "";
        if (!r.anchors.length) {
          say(missedNote(r.missed) || "nothing to paste - no labelled anchors (QUALITY, SUBJECT, POSE, SCENE, CAMERA, ABSOLUTE) found", "err");
          return false;
        }
        if (BOOK) {
          const key = (v) => String(v || "").trim().toLowerCase();
          const parts = split.map(x => ({ ...parseReply(x.text), series: x.series, note: x.note, frame: x.frame }))
            .filter(x => x.anchors.length && x.name);
          /* where a series heading sends its scenes: the series of that name
             (and number, when it has one) - or a new one by that name */
          const made = new Map(), madeNew = [];
          const groupFor = (ser) => {
            if (forceGid != null) return groupById(forceGid);
            if (!ser) return null;
            const k = key(ser.name);
            if (made.has(k)) return groupById(made.get(k));
            let g = (ser.no != null && book.groups.find(q => q.no === ser.no && key(q.name) === k))
              || book.groups.find(q => key(q.name) === k) || null;
            if (!g) { g = newGroup(ser.name); madeNew.push(g.name); }
            made.set(k, g.id);
            return g;
          };
          const noted = new Set();
          const noteSeries = (gid, txt) => {
            const g = groupById(gid);
            if (!g || txt == null || !String(txt).trim() || noted.has(gid)) return;
            g.note = String(txt).trim().slice(0, 4000);
            noted.add(gid);
          };
          /* Paste All on a series: the series takes the name the pack gives it */
          if (whole && forceGid != null && split.seriesList.length) {
            const g = groupById(forceGid);
            if (g && split.seriesList[0].name) g.name = split.seriesList[0].name;
          }
          if (parts.length > 1 || split.seriesList.length) {
            const tally = { added: 0, updated: 0, renamed: 0, notes: 0 };
            for (const x of parts) {
              const g = groupFor(x.series);
              const res = pasteIntoBook(x, true, g || undefined);
              if (!res) continue;
              tally[res.how === "added" ? "added" : "updated"]++;
              tally.renamed += res.named;
              if (x.note) tally.notes++;
              const rp = book.prompts.find(q => q.id === res.pid);
              if (rp) noteSeries(rp.g, x.series ? x.series.note : split.seriesList.top);
            }
            /* a series note with no scenes under it still lands */
            for (const ser of split.seriesList) {
              const gid = forceGid != null ? forceGid : (made.get(key(ser.name))
                || (book.groups.find(q => key(q.name) === key(ser.name)) || {}).id);
              if (gid != null) noteSeries(gid, ser.note);
            }
            if (split.seriesList.top && forceGid != null) noteSeries(forceGid, split.seriesList.top);
            touch(); save(); paintBook(true);
            const sers = new Set(parts.map(x => x.series ? key(x.series.name) : "")).size;
            say(`${parts.length} scene${parts.length === 1 ? "" : "s"} pasted`
              + (madeNew.length ? ` - ${madeNew.length} new series (${madeNew.join(", ")})` : sers > 1 ? ` into ${sers} series` : "")
              + ` - ${tally.added} added, ${tally.updated} updated`
              + (tally.notes ? `, ${tally.notes} note${tally.notes === 1 ? "" : "s"}` : "")
              + (noted.size ? `, series note${noted.size === 1 ? "" : "s"}` : "")
              + (tally.renamed ? `, ${tally.renamed} capsule${tally.renamed === 1 ? "" : "s"} renamed` : ""));
            return true;
          }
          if (forceGid != null) focusGroup(forceGid);
          pasteIntoBook({ ...r, note: split[0] ? split[0].note : null, frame: split[0] ? split[0].frame : null });
          if (split.seriesList.top) { const ag = activeGroup(); if (ag) noteSeries(ag.id, split.seriesList.top); touch(); save(); paintBook(true); }
        } else pasteIntoComposer(r);
        if (r.missed && r.missed.length) {
          say((sayNow && sayNow.text ? sayNow.text + " - but " : "") + missedNote(r.missed), "err");
        }
        return true;
      }

      /* Where reading the clipboard is not allowed - an address that is not
         localhost or https - a box to paste into does the same job. */
      function openPasteBox(forceGid, whole) {
        root.querySelector(".lvp-pastebox")?.remove();
        const box = document.createElement("div");
        box.className = "lvp-pastebox";
        box.innerHTML = `<textarea spellcheck="false" placeholder="Press Ctrl+V here - the reply is read as soon as it lands"></textarea>
          <button class="lvp-btn cls" title="Close">&#10005;</button>`;
        root.querySelector(".lvp-bar").insertAdjacentElement("afterend", box);
        const ta = box.querySelector("textarea");
        ["keydown", "keyup", "keypress"].forEach(k => ta.addEventListener(k, e => {
          e.stopPropagation();
          if (k === "keydown" && e.key === "Escape") close();
        }));
        const close = () => { box.remove(); fitNodeToContent(); };
        ta.addEventListener("paste", (e) => {
          const t = e.clipboardData?.getData("text/plain");
          if (!t) return;
          e.preventDefault();
          close();
          applyReply(t, forceGid, whole);
        });
        box.querySelector(".cls").addEventListener("click", close);
        setTimeout(() => { fitNodeToContent(); ta.focus(); }, 0);
      }

      async function pasteFromClipboard() {
        let text = null;
        try { text = await navigator.clipboard.readText(); } catch (e) { text = null; }
        if (text === null || text === undefined) { openPasteBox(); return; }
        applyReply(text);
      }

      /* Ctrl+V with the pointer over the node and no text box focused. Only a
         reply with labelled anchors is taken; anything else is left for
         ComfyUI, so pasting nodes onto the canvas works as it always did. */
      const onDocPaste = (e) => {
        if (!node.graph || !root.isConnected) return;
        const t = e.clipboardData?.getData("text/plain");
        if (!t) return;
        if (isEditable(e.target)) {
          /* A box left focused after an edit still has the caret, and a whole
             reply pasted then went into that box as plain text - the scene's
             name lost, its anchors merged into the open prompt. A box never
             wants several labelled anchors, so those are read as a reply;
             anything else is the box's own paste, as before. */
          if (!root.contains(e.target) || e.target.closest(".lvp-pastebox")) return;
          if (parseReply(t).anchors.length < 2) return;
          e.target.blur?.();
        } else {
          if (!root.matches(":hover")) return;
          if (!parseReply(t).anchors.length) return;
        }
        e.preventDefault();
        e.stopPropagation();
        if (e.stopImmediatePropagation) e.stopImmediatePropagation();
        applyReply(t);
      };
      document.addEventListener("paste", onDocPaste, true);
      /* A Visual Image Viewer's right click - "picture for the open prompt"
         or "for the open series" - lands here. */
      const onSetPicture = async (e) => {
        if (!BOOK || !book || !node.graph || !root.isConnected) return;
        const d = e.detail || {};
        if (!d.src) return;
        const t = await drawerThumbFrom(d.src);
        if (!t) { say("that picture could not be read", "err"); return; }
        const key = (v) => String(v || "").replace(/\s+/g, " ").trim().toLowerCase();
        if (d.to === "own" || d.to === "own-series") {
          /* the scene the picture was rendered from - its series by name,
             then the prompt of that name in it */
          const sg = d.series_name ? book.groups.find(x => key(x.name) === key(d.series_name)) : null;
          if (d.to === "own-series") {
            if (!sg) { say(`series "${d.series_name}" is not open in this book`, "err"); return; }
            sg.thumb = t;
            say(`series ${sg.no} ${sg.name} - picture set from the viewer`);
          } else {
            const pool = sg ? promptsOf(sg) : book.prompts;
            const q = pool.find(x => key(x.name) === key(d.prompt_name));
            if (!q) { say(`"${d.prompt_name}" is not in this book - open its series first`, "err"); return; }
            q.thumb = t;
            say(`${numOf(q)} ${q.name} - picture set from the viewer`);
          }
        } else if (d.to === "series") {
          const g = activeGroup();
          if (!g) return;
          g.thumb = t;
          say(`series ${g.no} ${g.name} - picture set from the viewer`);
        } else {
          const q = activePrompt();
          if (!q) return;
          q.thumb = t;
          say(`${numOf(q)} ${q.name} - picture set from the viewer`);
        }
        touch(); save(); paintBook(true);
      };
      window.addEventListener("leiel-set-picture", onSetPicture);

      function restoreFrom(p, why) {
        if (!p) return false;
        if ("fx" in p) state.fx = p.fx !== false;
        if (typeof p.trTo === "string") state.trTo = p.trTo;
        if (p.reader && typeof p.reader === "object") state.reader = p.reader;
        if (TR_UNITS.some(u => u[0] === p.trUnit)) state.trUnit = p.trUnit;
        /* In the Book the book is the document and the sections are only the
           open prompt drawn out of it. A layout saved by a plain Composer -
           pasted in, or a node converted by hand - has no book yet and
           becomes the first prompt of one. */
        let rows = p.sections || [];
        /* Sections with no book beside them, arriving at a book that already
           exists, are a snapshot of one prompt being put back: they go into
           the open prompt, and the rest of the book is left alone. */
        let intoOpen = false;
        if (BOOK) {
          const given = sanitizeBook(p.book);
          if (given) book = given;
          else if (book && Array.isArray(p.sections)) intoOpen = true;
          else book = bookFromSections(rows);
          if (!intoOpen) rows = sectionsFromBook();
        }
        state.sections = rows.map(s => ({
          id: s.id ?? nextId(),
          slot: s.slot ?? 0,
          title: s.title ?? "section",
          text: normalizeText(s.text ?? ""),
          html: s.html ?? "",
          on: s.on !== false,
          h: Math.max(MIN_H, s.h || 90),
          prevH: s.prevH,
          collapsed: !!s.collapsed,
          color: s.color || 0,
          extMode: s.extMode || "replace",
          /* the toggle and the pane height persist; the translated text
             never does - it is remade on demand */
          tr: !!s.tr,
          trH: Math.max(TR_MIN, s.trH || 60),
          /* the picture and which question to ask of it are part of the
             document; the answer is not - it lands in the box as text */
          imgOpen: !!s.imgOpen,
          imgH: Math.max(IMG_MIN, s.imgH || IMG_H),
          /* which side the picture is on, how wide it is there, and its shape
             so the width can be worked out again after a mode change */
          imgSide: !!s.imgSide,
          imgLayLock: !!s.imgLayLock,
          imgW: Math.max(IMG_SIDE_MIN, s.imgW || IMG_SIDE_W),
          imgAR: Number(s.imgAR) > 0 ? Number(s.imgAR) : 0,
          img: s.img || null,
          q: s.q || "",
          qText: s.qText || "",
          /* which sections this picture fills when it is read */
          readTo: Array.isArray(s.readTo) ? s.readTo.slice() : null,
          /* the capsule this section is showing, in the Book */
          _cap: s._cap,
        }));
        if (intoOpen) writeBack();
        assignSlots();
        ready = true;
        render();
        if (why) console.log(`[Leiel VPC] layout ${why}`);
        return true;
      }

      let idSeq = 1;
      function nextId() { return idSeq++; }

      /* Slots are stable per section, so reordering or deleting a section
         never moves someone else's wire. */
      function assignSlots() {
        const used = new Set(state.sections.map(s => s.slot).filter(Boolean));
        for (const s of state.sections) {
          if (s.slot && s.slot <= MAX_SLOTS) continue;
          for (let i = 1; i <= MAX_SLOTS; i++) {
            if (!used.has(i)) { s.slot = i; used.add(i); break; }
          }
        }
      }

      /* Deleting and re-adding sections pushes slot numbers upward, and the
         outputs have to run 1..max without gaps - so unused low slots showed up
         as nameless out_1, out_2 ports. Renumber them from one when it is safe,
         which means when nothing is wired to a slot yet. */
      function compactSlots() {
        if (BOOK) return;
        const wired = (node.inputs || []).some(
          i => /^ext_\d+$/.test(i.name) && i.link !== null && i.link !== undefined)
          || (node.outputs || []).some(
          o => /^out_\d+$/.test(o.name) && o.links && o.links.length);
        if (wired) return;
        state.sections.forEach((x, i) => { x.slot = i + 1; });
      }

      /* Show only as many section outputs as there are sections, and only ever
         add or remove them at the END. Removing one from the middle would shift
         every later slot index and quietly move existing links onto the wrong
         section. */
      function syncOutputs() {
        if (BOOK) return;
        const maxSlot = state.sections.reduce((n, x) => Math.max(n, x.slot || 0), 0);
        const bySlot = new Map(state.sections.map(x => [x.slot, x]));

        for (let i = 1; i <= maxSlot; i++) {
          if (!(node.outputs || []).some(o => o.name === `out_${i}`)) {
            node.addOutput(`out_${i}`, "STRING");
          }
        }
        /* peel unused slots off the tail, repeatedly, so a whole run goes in
           one pass - and stop the moment one is wired or is not last */
        for (let guard = 0; guard < MAX_SLOTS; guard++) {
          const at = node.outputs.length - 1;
          const o = node.outputs[at];
          if (!o) break;
          const m = /^out_(\d+)$/.exec(o.name);
          if (!m || parseInt(m[1]) <= maxSlot) break;
          if (o.links && o.links.length) break;
          node.removeOutput(at);
        }
        for (const o of (node.outputs || [])) {
          const m = /^out_(\d+)$/.exec(o.name);
          if (!m) continue;
          const sec = bySlot.get(parseInt(m[1]));
          o.label = sec ? (sec.title || o.name) : o.name;
        }

        /* A shelf at the other end of the wire names a chip after the label on
           the output it is fed from, and "all prompt" is the same words on
           every composer on the canvas - so the series had to be named twice,
           once here as the node's title and again over there. The title is
           already the name of the series, so the whole-prompt output wears it:
           rename the node and the chip follows. Left alone, or renamed back to
           the node's own name, it says "all prompt" as before. */
        const whole = (node.outputs || []).find(o => o.name === "all prompt");
        if (whole) {
          const mine = String(node.title || "").trim();
          const stock = String((node.constructor && node.constructor.title) || "").trim();
          whole.label = (mine && mine !== stock) ? mine : "all prompt";
        }
      }

      /* Renaming a node is not a graph change anything tells us about, so the
         title itself reports in. */
      try {
        let titleText = node.title;
        Object.defineProperty(node, "title", {
          configurable: true,
          get() { return titleText; },
          set(v) {
            titleText = v;
            try { syncOutputs(); node.setDirtyCanvas(true, true); } catch (e) { /* ignore */ }
          },
        });
      } catch (e) { /* ignore */ }

      /* Keep one external input per section, named by its slot. */
      const FIXED_LABELS = {
        find_text: "find_text (or  a=>b  per line)",
        replace_text: "replace_text",
      };

      function syncInputs() {
        if (BOOK) return;
        for (const inp of (node.inputs || [])) {
          const lbl = FIXED_LABELS[inp.name];
          if (lbl && inp.label !== lbl) inp.label = lbl;
        }
        const want = new Map();
        for (const s of state.sections) {
          if (s.slot) want.set(`ext_${s.slot}`, s.title || `section ${s.slot}`);
        }
        for (let i = (node.inputs?.length || 0) - 1; i >= 0; i--) {
          const inp = node.inputs[i];
          if (!inp.name.startsWith("ext_")) continue;
          if (!want.has(inp.name)) {
            if (inp.link !== null && inp.link !== undefined) continue; // keep wired
            node.removeInput(i);
          }
        }
        for (const [name, label] of want) {
          let inp = (node.inputs || []).find(x => x.name === name);
          if (!inp) { node.addInput(name, "STRING"); inp = node.inputs[node.inputs.length - 1]; }
          inp.label = label;
        }
      }

      /* Read the wired text straight from the upstream node when it is simply
         a text widget - that updates as you type, with no run needed. Values
         that only exist while the graph runs fall back to what the node
         reported after the last run. */
      /* Which node feeds this input, and which of its outputs the wire left
         from. The output matters: a node with eight of them is not telling you
         the same thing on each one. */
      function upstreamOf(slot) {
        try {
          const inp = (node.inputs || []).find(x => x.name === `ext_${slot}`);
          if (!inp || inp.link === null || inp.link === undefined) return null;
          let link = app.graph.links[inp.link];
          let guard = 0;
          while (link && guard++ < 8) {
            const up = app.graph.getNodeById(link.origin_id);
            if (!up) return null;
            const type = String(up.comfyClass || up.type || "");
            if (/reroute/i.test(type) && up.inputs?.[0]?.link != null) {
              link = app.graph.links[up.inputs[0].link];   // hop through reroutes
              continue;
            }
            return { node: up, out: link.origin_slot };
          }
        } catch (e) { /* ignore */ }
        return null;
      }

      /* Another Prompt Composer upstream keeps every section in one
         layout_json widget, so the section this wire actually came from has to
         be picked out of it. Outputs run [all prompt, labeled prompt, out_1
         ... out_N], so the slot number is the output index less one. */
      function layoutSectionOf(up, out) {
        try {
          if (out === null || out === undefined || out < 2) return null;
          const lw = (up.widgets || []).find(x => x.name === "layout_json");
          const raw = lw && lw.value;
          if (typeof raw !== "string" || !raw.trim()) return null;
          const secs = JSON.parse(raw)?.sections;
          if (!Array.isArray(secs)) return null;
          const hit = secs.find(x => String(x?.slot) === String(out - 1));
          if (!hit) return null;
          return typeof hit.text === "string" ? hit.text : "";
        } catch (e) { return null; }
      }

      function liveExtText(slot) {
        const hop = upstreamOf(slot);
        if (!hop) return null;
        const up = hop.node;
        if (up.mode === 2 || up.mode === 4) return null;      // bypassed

        /* One of ours: read the one section, never the whole layout. This is
           what was wrong - the rule below simply took the longest string
           widget on the upstream node, and on a Composer the longest string by
           a mile is layout_json, so wiring a single anchor across dropped the
           entire serialised layout into the section. */
        const one = layoutSectionOf(up, hop.out);
        if (one !== null) return one;

        /* A node that publishes its own outputs. The guess below cannot work on
           a node with several outputs, because there is no way to tell which
           string belongs to which one - so a node that knows the answer says so
           by exposing leielLiveOutput(slot), returning the text for that output
           index or null. Any pack can implement it; the Idea Board does. */
        if (typeof up.leielLiveOutput === "function") {
          try {
            const said = up.leielLiveOutput(hop.out);
            if (typeof said === "string") return said;
          } catch (e) { /* fall through to the guess */ }
        }

        /* A plain text node: one output, one string, and reading the widget
           means it updates as you type with no run needed. That guess is only
           safe when there is nothing else the output could be, so anything
           with several outputs waits for the node to report after a run. */
        if ((up.outputs || []).length > 1) return null;
        let best = null;
        for (const w of (up.widgets || [])) {
          if (w?.name === "layout_json") continue;   // state, not prose
          const v = w?.value;
          if (typeof v !== "string" || !v.trim()) continue;
          if (!best || v.length > best.length) best = v;
        }
        return best;
      }

      function extTextFor(sec) {
        const live = liveExtText(sec.slot);
        if (live !== null && live !== undefined) return live;
        const cached = (EXT_CACHE[String(node.id)] || {})[String(sec.slot)];
        return cached ?? null;
      }

      function extLinked(s) {
        const inp = (node.inputs || []).find(x => x.name === `ext_${s.slot}`);
        return !!inp && inp.link !== null && inp.link !== undefined;
      }

      /* ---------- manual marks ---------- */
      function insertPlain(txt) {
        const sel = window.getSelection();
        if (!sel || !sel.rangeCount) return;
        const r = sel.getRangeAt(0);
        r.deleteContents();
        const n = document.createTextNode(txt);
        r.insertNode(n);
        r.setStartAfter(n); r.setEndAfter(n);
        sel.removeAllRanges(); sel.addRange(r);
      }

      /* Returns false when the clipboard HTML is not ours, so the caller can
         fall back to plain text. */
      function insertMarked(html, plain) {
        try {
          const want = String(plain || "").replace(/\r\n/g, "\n");
          const clean = sanitizeMarkup(clipboardFragment(html));
          const probe = document.createElement("div");
          probe.innerHTML = clean;
          if (!probe.querySelector("span,b")) return false;      // nothing to keep
          /* The check still has to be exact about the characters themselves -
             that is what stops foreign HTML smuggling in text that differs
             from what the plain flavour says. Only the whitespace at the two
             outer edges is allowed to disagree, and when it does the fragment
             is trimmed to match rather than pasted as-is. */
          if (probe.textContent.replace(/\r\n/g, "\n") !== want) {
            trimEdgeWhitespace(probe);
            if (probe.textContent.replace(/\r\n/g, "\n") !== want.trim()) return false;
          }

          const sel = window.getSelection();
          if (!sel || !sel.rangeCount) return false;
          const r = sel.getRangeAt(0);
          r.deleteContents();

          const frag = document.createDocumentFragment();
          while (probe.firstChild) frag.appendChild(probe.firstChild);
          const lastNode = frag.lastChild;
          r.insertNode(frag);
          if (lastNode) {
            r.setStartAfter(lastNode); r.setEndAfter(lastNode);
            sel.removeAllRanges(); sel.addRange(r);
          }
          return true;
        } catch (e) {
          return false;
        }
      }

      let markBar = null;
      ensureRgbIn(root);
      const rgbWatch = new MutationObserver((recs) => {
        for (const r of recs) for (const n of r.addedNodes) if (n.nodeType === 1) ensureRgbIn(n);
      });
      rgbWatch.observe(root, { childList: true, subtree: true });
      /* A bar docked over the Production Notes editor stays for as long as
         the notes are being written; only the editor itself takes it down. */
      function hideMarkBar(force) {
        if (!markBar) return;
        if (markBar._dock && !force && markBar.isConnected && markBar._ta && markBar._ta.isConnected) return;
        root.querySelectorAll(".lvp-hold").forEach(x => x.remove());
        markBar.remove(); markBar = null;
      }

      /* Marks live on three independent axes: weight, highlighter, text colour.

         Everything is done per character on a flat model, then written back as
         one span per run. Extracting the selection was not enough: when a
         selection sits inside an existing span, the extracted fragment does not
         carry that span, so the old code could not see the colour it was
         adding bold to (nested spans, white text) and "clear" put bare text
         straight back inside the coloured span (nothing appeared to happen). */
      const MARK_ORDER = ["m-find", "m-para", "m-dot", "m-b", "m-i", "m-u", "m-key",
                          "m-hy", "m-hg", "m-hp", "m-hb",
                          "m-hr", "m-ho", "m-hn",
                          "m-cy", "m-cg", "m-cr", "m-cw", "m-cb",
                          "m-co", "m-ck", "m-cv", "m-cc", "m-cn",
                          "m-za", "m-z1", "m-zb", "m-z2", "m-zc",
                          "m-zd", "m-z3", "m-ze", "m-z4", "m-zf", "m-z5", "m-zg", "m-z6",
                          "m-q1", "m-q2", "m-q3", "m-q4", "m-q5", "m-q6", "m-q7",
                          "m-q8", "m-q9", "m-q10", "m-q11", "m-q12", "m-q13",
                          "m-title", "m-auto"];
      const TOGGLES = ["m-b", "m-i", "m-u"];

      function readMarks(host) {
        if (host && host._blocks) return readBlocks(host);
        const cells = [];
        (function walk(n, inh) {
          for (const c of n.childNodes) {
            if (c.nodeType === 3) {
              for (const ch of c.nodeValue) cells.push({ ch, cls: inh });
            } else if (c.nodeType === 1) {
              if (c.tagName === "BR") { cells.push({ ch: "\n", cls: inh }); continue; }
              const own = c.tagName === "B"
                ? inh.concat("m-b")
                : inh.concat(Array.from(c.classList));
              walk(c, Array.from(new Set(own)));
            }
          }
        })(host, []);
        return cells;
      }

      function writeMarks(host, cells) {
        if (host && host._blocks) { writeBlocks(host, cells); return; }
        host.innerHTML = "";
        host.appendChild(runsFrag(cells));
      }

      /* one span per run of identically marked characters */
      function runsFrag(cells) {
        const frag = document.createDocumentFragment();
        let i = 0;
        while (i < cells.length) {
          const key = cells[i].cls.slice().sort().join(" ");
          let j = i, txt = "";
          while (j < cells.length && cells[j].cls.slice().sort().join(" ") === key) {
            txt += cells[j].ch; j++;
          }
          if (key) {
            const sp = document.createElement("span");
            const want = key.split(" ");
            sp.className = MARK_ORDER.filter(c => want.includes(c))
              .concat(want.filter(isDynClass)).join(" ");
            for (const c of want) ensureRgb(c);
            sp.appendChild(document.createTextNode(txt));
            frag.appendChild(sp);
          } else {
            frag.appendChild(document.createTextNode(txt));
          }
          i = j;
        }
        return frag;
      }

      /* ---------- paragraph blocks (Production Notes) ----------
         The notes keep the same flat model of characters - a line break is
         one "\n" cell - plus host._paras, the paragraph classes of each line.
         On screen every line is a <div class="pg">, which is what lets a line
         have its own spacing, indents, alignment and tabs. Reading accepts
         anything the browser left behind (stray text, <br>, nested blocks,
         older flat notes) and writing always puts back the clean form. */
      const PH = (br) => br.parentNode && br.parentNode !== br.getRootNode() && /^(DIV|P)$/.test(br.parentNode.tagName)
        && br.parentNode.childNodes.length === 1;
      function readBlocks(host) {
        const cells = [];
        const paras = [[]];
        let line = 0, atStart = true, pending = false;
        const brk = (para) => { cells.push({ ch: "\n", cls: [] }); line++; paras[line] = (para || []).slice(); atStart = true; };
        (function walk(n, inh, para) {
          for (const c of n.childNodes) {
            if (c.nodeType === 3) {
              for (const ch of c.nodeValue) {
                if (pending) { brk(para); pending = false; }
                if (ch === "\n") brk(para);
                else { cells.push({ ch, cls: inh }); atStart = false; }
              }
            } else if (c.nodeType === 1) {
              if (c.tagName === "BR") {
                if (PH(c)) continue;
                if (pending) { brk(para); pending = false; }
                brk(para);
                continue;
              }
              if (c.tagName === "DIV" || c.tagName === "P") {
                const own = Array.from(c.classList).filter(isParaClass);
                if (pending || !atStart) { brk(own); pending = false; }
                else paras[line] = own.slice();
                walk(c, inh, own);
                pending = true;
                continue;
              }
              const add = c.tagName === "B" ? ["m-b"] : Array.from(c.classList).filter(isMarkClass);
              walk(c, Array.from(new Set(inh.concat(add))), para);
            }
          }
        })(host, [], []);
        /* dots written before blocks sat on a line's first character */
        let L = 0, first = true;
        for (const cell of cells) {
          if (cell.ch === "\n") { L++; first = true; continue; }
          if (cell.cls.includes("m-para") || cell.cls.includes("m-dot")) {
            const d = cell.cls.includes("m-para") ? "m-para" : "m-dot";
            if (first && !paras[L].includes("m-para") && !paras[L].includes("m-dot")) paras[L].push(d);
            cell.cls = cell.cls.filter(c => c !== "m-para" && c !== "m-dot");
          }
          first = false;
        }
        host._paras = paras;
        return cells;
      }
      function writeBlocks(host, cells) {
        const paras = host._paras || [];
        const frag = document.createDocumentFragment();
        let L = 0, run = [];
        const flush = () => {
          const d = document.createElement("div");
          const pc = (paras[L] || []).filter(isParaClass);
          d.className = ["pg"].concat(pc).join(" ");
          for (const c of pc) ensureRgb(c);
          if (run.length) d.appendChild(runsFrag(run)); else d.appendChild(document.createElement("br"));
          frag.appendChild(d);
          L++; run = [];
        };
        for (const c of cells) { if (c.ch === "\n") flush(); else run.push(c); }
        flush();
        host._paras = paras.slice(0, L);
        while (host._paras.length < L) host._paras.push([]);
        host.innerHTML = "";
        host.appendChild(frag);
      }
      const blockLen = (b) => b.textContent.length;
      function blockPos(host, node, off) {
        const blocks = Array.from(host.children);
        if (node === host) {
          let n = 0;
          for (let i = 0; i < Math.min(off, blocks.length); i++) n += blockLen(blocks[i]) + 1;
          return Math.max(0, off >= blocks.length ? n - 1 : n);
        }
        let b = node;
        while (b && b.parentNode !== host) b = b.parentNode;
        if (!b) return 0;
        let n = 0;
        for (const x of blocks) { if (x === b) break; n += blockLen(x) + 1; }
        let k = 0, done = false;
        (function walk(x) {
          if (done) return;
          if (x === node && x.nodeType === 3) { k += off; done = true; return; }
          if (x.nodeType === 3) { k += x.nodeValue.length; return; }
          for (let i = 0; i < x.childNodes.length; i++) {
            if (done) return;
            if (x === node && i === off) { done = true; return; }
            walk(x.childNodes[i]);
          }
          if (!done && x === node) done = true;
        })(b);
        return n + k;
      }
      function pointAtB(host, off) {
        const blocks = Array.from(host.children);
        for (const b of blocks) {
          const len = blockLen(b);
          if (off <= len) {
            let n = 0, res = null;
            (function walk(x) {
              if (res) return;
              for (const c of x.childNodes) {
                if (res) return;
                if (c.nodeType === 3) {
                  if (off <= n + c.nodeValue.length) { res = [c, off - n]; return; }
                  n += c.nodeValue.length;
                } else if (c.nodeType === 1) walk(c);
              }
            })(b);
            return res || [b, 0];
          }
          off -= len + 1;
        }
        const last = blocks[blocks.length - 1];
        return last ? [last, last.childNodes.length] : [host, 0];
      }
      function isCleanBlocks(host) {
        if (!host.childNodes.length) return false;
        for (const b of host.childNodes) {
          if (b.nodeType !== 1 || b.tagName !== "DIV" || !b.classList.contains("pg")) return false;
          if (b.childNodes.length === 1 && b.firstChild.nodeType === 1 && b.firstChild.tagName === "BR") continue;
          if (!b.childNodes.length) return false;
          if (b.textContent.includes("\n")) return false;
          for (const x of b.querySelectorAll("*")) {
            if (!(x.tagName === "SPAN" || x.tagName === "B") || x.hasAttribute("style")) return false;
          }
        }
        return true;
      }
      /* the line each character position sits on */
      function lineIndexAt(cells, pos) {
        let n = 0;
        for (let i = 0; i < pos && i < cells.length; i++) if (cells[i].ch === "\n") n++;
        return n;
      }
      /* the lines a range touches - one that ends right after a line break
         does not reach into the next line */
      function linesOf(cells, from, to) {
        const a = lineIndexAt(cells, from);
        let e = to;
        if (to > from && cells[to - 1] && cells[to - 1].ch === "\n") e = to - 1;
        const b = Math.max(a, lineIndexAt(cells, e));
        const out = [];
        for (let L = a; L <= b; L++) out.push(L);
        return out;
      }
      /* put the clean block form back, keeping the caret where it was */
      function normalizeBlocks(host, keepCaret) {
        let mk = null;
        const sel = window.getSelection();
        if (keepCaret && sel && sel.rangeCount && host.contains(sel.getRangeAt(0).endContainer)) {
          const r = sel.getRangeAt(0).cloneRange();
          r.collapse(false);
          mk = document.createTextNode("\uE000");
          try { r.insertNode(mk); } catch (e) { mk = null; }
        }
        host._blocks = true;
        const cells = readBlocks(host);
        const at = cells.findIndex(c => c.ch === "\uE000");
        if (at >= 0) cells.splice(at, 1);
        writeBlocks(host, cells);
        if (at >= 0) selectOffsets(host, at, at);
      }
      /* typing a line break or a tab: the new line carries on the paragraph
         it was split from, and the new characters the marks before them */
      function blockInsert(host, text) {
        const sel = window.getSelection();
        if (!sel || !sel.rangeCount) return;
        if (!isCleanBlocks(host)) normalizeBlocks(host, true);
        let [a, b] = rangeOffsets(host, sel.getRangeAt(0));
        if (b < a) [a, b] = [b, a];
        const cells = readMarks(host);
        const paras = host._paras;
        a = Math.max(0, Math.min(a, cells.length)); b = Math.max(a, Math.min(b, cells.length));
        const La = lineIndexAt(cells, a), Lb = lineIndexAt(cells, b);
        cells.splice(a, b - a);
        paras.splice(La + 1, Lb - La);
        const src = (a > 0 && cells[a - 1].ch !== "\n") ? cells[a - 1] : (cells[a] && cells[a].ch !== "\n" ? cells[a] : null);
        const inh = src ? src.cls.filter(c => c !== "m-find" && c !== "m-auto") : [];
        const add = [];
        let L = La;
        for (const ch of text) {
          add.push({ ch, cls: ch === "\n" ? [] : inh });
          if (ch === "\n") { paras.splice(L + 1, 0, (paras[L] || []).slice()); L++; }
        }
        cells.splice(a, 0, ...add);
        host._paras = paras;
        writeBlocks(host, cells);
        selectOffsets(host, a + add.length, a + add.length);
        host.dispatchEvent(new Event("input"));
      }
      /* what is stored: the blocks, without the placeholder of an empty line,
         and with the empty lines at the very end let go */
      function memoBlocksHtml(host) {
        const cells = readMarks(host);
        const paras = host._paras.slice();
        while (cells.length && cells[cells.length - 1].ch === "\n"
               && !(paras[paras.length - 1] || []).length) { cells.pop(); paras.pop(); }
        const tmp = document.createElement("div");
        tmp._blocks = true; tmp._paras = paras;
        writeBlocks(tmp, cells);
        for (const br of tmp.querySelectorAll("br")) br.remove();
        return { html: tmp.innerHTML, text: cells.map(c => c.ch).join("") };
      }

      /* plain-text offsets of a range inside the editor */
      function rangeOffsets(host, range) {
        if (host && host._blocks) {
          return [blockPos(host, range.startContainer, range.startOffset),
                  blockPos(host, range.endContainer, range.endOffset)];
        }
        const pos = (node, off) => {
          let n = 0, done = false;
          (function walk(x) {
            if (done) return;
            if (x === node && x.nodeType === 3) { n += off; done = true; return; }
            if (x.nodeType === 3) { n += x.nodeValue.length; return; }
            if (x.nodeType === 1 && x.tagName === "BR") { n += 1; return; }
            for (let i = 0; i < x.childNodes.length; i++) {
              if (done) return;
              if (x === node && i === off) { done = true; return; }
              walk(x.childNodes[i]);
            }
            if (!done && x === node) done = true;
          })(host);
          return n;
        };
        return [pos(range.startContainer, range.startOffset),
                pos(range.endContainer, range.endOffset)];
      }

      /* One rule for what a mark does to a single character, shared by the
         selection palette and by styling every search hit at once. Search
         marks are deliberately never cleared here: they belong to the find
         bar, not to the document, and wiping them made hits vanish the
         moment anything was applied on top of them. */
      /* Size runs on its own axis, one class per step, so a run can be nudged
         up and down instead of being set to an absolute number. Level 0 wears
         no class at all - untouched text is left exactly as it was. */
      /* finer steps, about one tenth apart; the six older classes are kept
         at their places in the ladder so marked text keeps its size */
      const SIZE_CLASSES = ["m-za", "m-z1", "m-zb", "m-z2", "m-zc", "",
                            "m-zd", "m-z3", "m-ze", "m-z4", "m-zf", "m-z5", "m-zg", "m-z6"];
      const SIZE_ZERO = SIZE_CLASSES.indexOf("");
      const SIZE_MIN = -SIZE_ZERO, SIZE_MAX = SIZE_CLASSES.length - 1 - SIZE_ZERO;
      const SIZE_RE = /^m-z[0-9a-g]$/;

      const isSizeClass = (c) => SIZE_RE.test(c) || SIZEP_RE.test(c);
      /* the size a cell is drawn at, as a fraction of the text around it */
      function cellEm(cell) {
        const z = cell.cls.find(isSizeClass);
        if (!z) return 1;
        return SIZEP_RE.test(z) ? (+z.slice(3)) / 100 : (SIZE_EM[z] || 1);
      }
      function sizeLevel(cell) {
        const i = SIZE_CLASSES.findIndex(c => c && cell.cls.includes(c));
        if (i >= 0) return i - SIZE_ZERO;
        /* a typed size steps from the nearest rung of the ladder */
        const em = cellEm(cell);
        let best = SIZE_ZERO, d = Infinity;
        SIZE_CLASSES.forEach((c, k) => {
          const e = c ? SIZE_EM[c] : 1;
          if (Math.abs(e - em) < d) { d = Math.abs(e - em); best = k; }
        });
        return best - SIZE_ZERO;
      }

      function setCellPct(cell, pct) {
        const set = new Set(cell.cls.filter(c => !isSizeClass(c)));
        if (pct !== 100) { const c = "m-s" + pct; set.add(c); ensureRgb(c); }
        set.delete("m-auto");
        cell.cls = Array.from(set);
      }

      function setCellSize(cell, level) {
        const set = new Set(cell.cls.filter(c => !isSizeClass(c)));
        const cls = SIZE_CLASSES[level + SIZE_ZERO];
        if (cls) set.add(cls);
        set.delete("m-auto");
        cell.cls = Array.from(set);
      }

      /* One step for the whole run, taken from where the run starts, so a
         mixed selection lands on one size rather than fanning out. */
      function stepSize(cells, from, to, delta) {
        if (to <= from) return 0;
        const next = Math.max(SIZE_MIN, Math.min(SIZE_MAX, sizeLevel(cells[from]) + delta));
        for (let i = from; i < to && i < cells.length; i++) {
          setCellSize(cells[i], next);
        }
        return next;
      }

      const isSizeCmd = (cls) => cls === "size+" || cls === "size-";

      function setCellMark(cell, cls, axis, off) {
        if (axis === "clear") {
          cell.cls = cell.cls.filter(c => c === "m-find");
          return;
        }
        const set = new Set(cell.cls);
        if (axis === "toggle") {
          if (off) set.delete(cls); else set.add(cls);
        } else if (axis === "hl") {
          for (const c of Array.from(set)) if (c.startsWith("m-h")) set.delete(c);
          if (!off) set.add(cls);
        } else if (axis === "font") {
          for (const c of Array.from(set)) if (FONT_RE.test(c)) set.delete(c);
          if (!off) set.add(cls);
        } else {
          for (const c of Array.from(set)) if (c.startsWith("m-c") || RGB_RE.test(c)) set.delete(c);
          if (!off) set.add(cls);
        }
        set.delete("m-auto");
        cell.cls = Array.from(set);
      }

      /* writeMarks rebuilds the section, which throws away any live range.
         These put the caret back on the same characters so the palette can be
         pressed again and again without the selection evaporating. */
      function pointAt(host, off) {
        if (host && host._blocks) return pointAtB(host, off);
        let n = 0, res = null;
        (function walk(x) {
          if (res) return;
          for (const c of x.childNodes) {
            if (res) return;
            if (c.nodeType === 3) {
              const len = c.nodeValue.length;
              if (off <= n + len) { res = [c, off - n]; return; }
              n += len;
            } else if (c.nodeType === 1) {
              if (c.tagName === "BR") { if (off <= n) { res = [x, 0]; return; } n += 1; }
              else walk(c);
            }
          }
        })(host);
        return res || [host, host.childNodes.length];
      }

      function selectOffsets(host, from, to) {
        try {
          const [sn, so] = pointAt(host, from);
          const [en, eo] = pointAt(host, to);
          const r = document.createRange();
          r.setStart(sn, so);
          r.setEnd(en, eo);
          const sel = window.getSelection();
          if (sel) { sel.removeAllRanges(); sel.addRange(r); }
          return r;
        } catch (e) { return null; }
      }

      const FONT_RE = /^m-(q\d+|y[0-9a-z]{3,9})$/;
      function axisOf(cls) {
        if (!cls) return "clear";
        if (cls === "m-para" || cls === "m-dot") return "para";
        if (TOGGLES.includes(cls)) return "toggle";
        if (cls.startsWith("m-h")) return "hl";
        if (FONT_RE.test(cls)) return "font";
        return "color";
      }

      /* index of the first character of every line the range touches */
      function lineStarts(cells, from, to) {
        const starts = [];
        let i = from;
        while (i > 0 && cells[i - 1].ch !== "\n") i--;   // back up to this line
        starts.push(i);
        for (let k = Math.max(1, from); k < to; k++) {
          if (cells[k - 1] && cells[k - 1].ch === "\n") starts.push(k);
        }
        return starts.filter(x => x < cells.length);
      }

      function offsetsOf(bar) {
        if (!bar._range) return [0, 0];
        let [a, b] = rangeOffsets(bar._ta, bar._range);
        return a <= b ? [a, b] : [b, a];
      }
      function keepMarkBar(host, from, to) {
        const again = selectOffsets(host, from, to);
        if (markBar && again) { markBar._range = again.cloneRange(); paintMarkState(); }
        else hideMarkBar();
      }
      /* Each button on the palette that the whole selection already wears is
         lit - so a colour or a highlight put on shows on the palette at once,
         even while the selection colour sits over the text. */
      function paintMarkState() {
        if (!markBar || !markBar._ta || !markBar._range) return;
        try {
          const host = markBar._ta;
          const cells = readMarks(host);
          let [a, b] = rangeOffsets(host, markBar._range);
          if (b < a) [a, b] = [b, a];
          a = Math.max(0, Math.min(a, cells.length)); b = Math.max(0, Math.min(b, cells.length));
          const slice = cells.slice(a, b);
          const starts = b > a ? lineStarts(cells, a, b) : [];
          for (const btn of markBar.querySelectorAll("button[data-c]")) {
            const c = btn.dataset.c;
            let on = false;
            if (c && !isSizeCmd(c) && !c.startsWith("none:") && slice.length) {
              on = axisOf(c) === "para"
                ? (host._blocks ? linesOf(cells, a, b).every(L => (host._paras[L] || []).includes(c))
                  : starts.length > 0 && starts.every(i => cells[i].cls.includes(c)))
                : slice.every(x => x.cls.includes(c));
            }
            btn.classList.toggle("on", on);
          }
          /* what one class every selected character shares, on one axis */
          const common = (test) => {
            if (!slice.length) return null;
            const c0 = slice[0].cls.find(test);
            return c0 && slice.every(x => x.cls.includes(c0)) ? c0 : null;
          };
          const font = common(c => FONT_RE.test(c));
          const fl = markBar.querySelector(".fl");
          if (fl) {
            const f = MARK_FONTS.find(x => x[0] === font);
            const lf = font && LFONT_RE.test(font) ? fontReg()[font.slice(3)] : null;
            fl.textContent = f ? f[1] : lf ? faceLabel(lf) : "Font";
            fl.style.fontFamily = f ? f[3] : lf ? `"${cssName(lf.family)}","lvp-f-${font.slice(3)}"` : "";
            fl.style.fontWeight = lf ? String(faceW(lf.style)) : "";
            fl.style.fontStyle = lf && faceIt(lf.style) ? "italic" : "";
          }
          const hl = common(c => c.startsWith("m-h"));
          const hs = markBar.querySelector(".hs");
          if (hs) {
            const h = MARK_HL.find(x => x[0] === hl);
            hs.style.background = h ? h[2] : "transparent";
          }
          const col = common(c => c.startsWith("m-c") || RGB_RE.test(c));
          const ca = markBar.querySelector(".ca");
          if (ca) {
            const k = MARK_COLORS.find(x => x[0] === col);
            ca.style.borderBottomColor = k ? k[2] : (col && RGB_RE.test(col) ? "#" + col.slice(3) : "#d6d9e0");
            ca.style.color = k ? k[2] : (col && RGB_RE.test(col) ? "#" + col.slice(3) : "");
          }
          markBar._curCol = col ? (RGB_RE.test(col) ? col.slice(3)
            : (MARK_COLORS.find(x => x[0] === col) || [])[2]) : null;
          /* the paragraph panel shows the first selected line */
          if (host._blocks && markBar.querySelector(".pan.para")) {
            const pl = host._paras[lineIndexAt(cells, a)] || [];
            for (const inp of markBar.querySelectorAll(".pvi")) {
              if (document.activeElement !== inp) inp.value = paraGet(pl, inp.dataset.pk) + (PKEYS[inp.dataset.pk].u || "");
            }
            for (const btn of markBar.querySelectorAll("[data-prule]")) {
              const [side, w] = btn.dataset.prule.split(":");
              btn.classList.toggle("on", ruleGet(pl, side) === w);
            }
            for (const btn of markBar.querySelectorAll("[data-prulec]")) btn.classList.toggle("on", btn.dataset.prulec === ruleColGet(pl));
            for (const btn of markBar.querySelectorAll("[data-prules]")) btn.classList.toggle("on", btn.dataset.prules === ruleStyGet(pl));
            const al = paraGet(pl, "align");
            for (const btn of markBar.querySelectorAll("[data-palign]")) btn.classList.toggle("on", btn.dataset.palign === al);
          }
          const tk = markBar.querySelector(".tk");
          if (tk && slice.length && document.activeElement !== tk) {
            const t0 = slice[0].cls.find(c => TRACK_RE.test(c));
            tk.value = t0 ? String(trackOf(t0)) : "0";
          }
          const zv = markBar.querySelector(".zv");
          if (zv && slice.length && document.activeElement !== zv) {
            zv.value = Math.round(cellEm(slice[0]) * 100) + "%";
          }
        } catch (e) { /* the palette is only a hint */ }
      }
      /* the palette goes as soon as nothing is selected in its text any more -
         a click on empty space, a click into the text, Esc */
      const onMarkSelChange = () => {
        if (!markBar) return;
        if (markBar.contains(document.activeElement)) return;   // typing in the bar
        const sel = window.getSelection();
        const ta = markBar._ta;
        if (markBar._dock) {
          if (!ta || !ta.isConnected || !markBar.isConnected) { hideMarkBar(true); return; }
          if (sel && sel.rangeCount && ta.contains(sel.getRangeAt(0).commonAncestorContainer)) {
            markBar._range = sel.getRangeAt(0).cloneRange();
            paintMarkState();
          }
          return;
        }
        if (!sel || !sel.rangeCount || sel.isCollapsed || !ta || !ta.isConnected
            || !ta.contains(sel.getRangeAt(0).commonAncestorContainer)) hideMarkBar();
      };
      document.addEventListener("selectionchange", onMarkSelChange);

      function applyMark(cls) {
        const host = markBar?._ta;
        const saved = markBar?._range;
        if (!host || !saved) return;
        if (host.getAttribute("contenteditable") === "false") return;
        /* Applying a mark while nothing is being drawn would look like a dead
           button. Marking turns the view back on - without running the
           automatic pass, which is the HUE button's own business. */
        if (!state.fx) {
          state.fx = true;
          for (const t of list.querySelectorAll(".lvp-ta")) t.classList.remove("plain");
          refreshToolbar();
        }

        const cells = readMarks(host);
        let [from, to] = rangeOffsets(host, saved);
        if (to < from) [from, to] = [to, from];
        from = Math.max(0, Math.min(from, cells.length));
        to = Math.max(0, Math.min(to, cells.length));
        if (to <= from) { if (!markBar?._dock) hideMarkBar(); return; }

        /* Size is the one action that is used repeatedly - nobody lands on
           the right size first press. The bar stays up, the selection is put
           back on the same run, and the next click steps again. The search
           marks are not repainted here because not a character moved. */
        if (isSizeCmd(cls)) {
          const level = stepSize(cells, from, to, cls === "size+" ? 1 : -1);
          writeMarks(host, cells);
          host.dispatchEvent(new Event("input"));
          const again = selectOffsets(host, from, to);
          if (markBar && again) {
            markBar._range = again.cloneRange();
            markBar.dataset.level = String(level);
            paintMarkState();
          } else {
            hideMarkBar();
          }
          refreshToolbar();
          return;
        }

        /* letter spacing typed into its box, in thousandths of an em */
        if (cls && cls.startsWith("track=")) {
          const v = Math.max(-200, Math.min(800, Math.round(+cls.slice(6) || 0)));
          const tc = v === 0 ? null : (v < 0 ? "m-tn" + (-v) : "m-t" + v);
          for (let i = from; i < to; i++) {
            const set = new Set(cells[i].cls.filter(c => !TRACK_RE.test(c) && c !== "m-auto"));
            if (tc) set.add(tc);
            cells[i].cls = Array.from(set);
          }
          writeMarks(host, cells);
          host.dispatchEvent(new Event("input"));
          keepMarkBar(host, from, to);
          refreshToolbar();
          if (findState) findState.refresh();
          return;
        }
        /* a size typed into the box between the two size buttons */
        if (cls && cls.startsWith("size=")) {
          const pct = Math.max(30, Math.min(400, Math.round(+cls.slice(5) || 100)));
          for (let i = from; i < to; i++) setCellPct(cells[i], pct);
          writeMarks(host, cells);
          host.dispatchEvent(new Event("input"));
          keepMarkBar(host, from, to);
          refreshToolbar();
          if (findState) findState.refresh();
          return;
        }

        /* "Default" in a dropdown takes that one family of marks off */
        if (cls && cls.startsWith("none:")) {
          const ax = cls.slice(5);
          const drop = ax === "hl" ? (k => k.startsWith("m-h"))
            : ax === "font" ? (k => FONT_RE.test(k))
            : (k => k.startsWith("m-c") || RGB_RE.test(k));
          for (let i = from; i < to; i++) {
            cells[i].cls = cells[i].cls.filter(k => !drop(k) && k !== "m-auto");
          }
          writeMarks(host, cells);
          host.dispatchEvent(new Event("input"));
          keepMarkBar(host, from, to);
          refreshToolbar();
          if (findState) findState.refresh();
          return;
        }

        const axis = axisOf(cls);

        /* the paragraph dot belongs to a line, not to a selection */
        if (axis === "para" && host._blocks) {
          const paras = host._paras;
          const ls = linesOf(cells, from, to);
          const on = ls.every(L => (paras[L] || []).includes(cls));
          for (const L of ls) {
            const set = new Set(paras[L] || []);
            set.delete("m-para"); set.delete("m-dot");
            if (!on) set.add(cls);
            paras[L] = Array.from(set);
          }
          writeMarks(host, cells);
          host.dispatchEvent(new Event("input"));
          keepMarkBar(host, from, to);
          return;
        }
        if (axis === "para") {
          const starts = lineStarts(cells, from, to);
          /* the big dot and the small one are two sizes of the same mark: a
             line wears one or the other */
          const on = starts.every(i => cells[i].cls.includes(cls));
          for (const i of starts) {
            const set = new Set(cells[i].cls);
            set.delete("m-para"); set.delete("m-dot");
            if (!on) set.add(cls);
            cells[i].cls = Array.from(set);
          }
          writeMarks(host, cells);
          host.dispatchEvent(new Event("input"));
          keepMarkBar(host, from, to);
          refreshToolbar();
          if (findState) findState.refresh();
          return;
        }

        const slice = cells.slice(from, to);
        /* pressing the same button over an already-marked run clears it */
        const allHave = cls ? slice.every(c => c.cls.includes(cls)) : false;

        for (let i = from; i < to; i++) setCellMark(cells[i], cls, axis, allHave);

        writeMarks(host, cells);
        host.dispatchEvent(new Event("input"));
        /* The palette stays up over the same run, so a second effect - bold
           and then a colour - is one more click, not a new selection. It goes
           when the selection does. */
        keepMarkBar(host, from, to);
        refreshToolbar();
        /* The edit rewrote this section's markup, so the hits painted into it
           have to be laid down again against the new text. */
        if (findState) findState.refresh();
      }

      /* ---------- format brush ----------
         InDesign's eyedropper: click styled text to pick its formatting up,
         then drag over other text to stamp it on. It rides on the same cell
         model as the palette, so picking up is just reading one cell's class
         list and stamping is assigning it to a range.

         Three classes are deliberately left behind. m-find belongs to the
         search bar rather than the document, m-auto is whatever the automatic
         pass decided and is not the user's choice, and m-para marks a whole
         line - stamping it from a mid-sentence pick would put bullets on lines
         nobody pointed at. */
      const BRUSH_SKIP = ["m-find", "m-auto", "m-para", "m-dot", "m-title"];
      let brush = null;          // array of classes once loaded
      let brushMode = "off";     // "off" | "pick" | "apply"

      function brushLabel() {
        if (brushMode === "pick") return "click a word to pick up its formatting";
        if (!brush) return "";
        const names = { "m-b": "bold", "m-i": "italic", "m-u": "underline", "m-key": "key" };
        const parts = brush.map(c => names[c]
          || (c.startsWith("m-h") ? "highlight" : (c.startsWith("m-c") || RGB_RE.test(c)) ? "colour"
              : (c.startsWith("m-q") || c.startsWith("m-y")) ? "font"
              : TRACK_RE.test(c) ? "tracking" : "size"));
        return parts.length ? parts.join(" + ") : "plain text";
      }

      function setBrushMode(mode) {
        brushMode = mode;
        if (mode === "off") brush = null;
        for (const t of list.querySelectorAll(".lvp-ta")) {
          t.classList.toggle("picking", mode === "pick");
          t.classList.toggle("painting", mode === "apply");
        }
        refreshToolbar();
      }

      /* Read the formatting of the character the caret landed on. Picking at
         the very start of a run would otherwise read the character before it,
         so a collapsed caret looks forward and a selection reads its first
         character. */
      function brushPick(ta, from, to) {
        const cells = readMarks(ta);
        if (!cells.length) return false;
        const cell = cells[Math.max(0, Math.min(from, cells.length - 1))];
        brush = cell.cls.filter(c => !BRUSH_SKIP.includes(c));
        setBrushMode("apply");
        return true;
      }

      /* Stamp the brush over a range: the target ends up looking exactly like
         the source, so whatever it wore before is replaced rather than merged.
         Search hits are the one thing kept, for the same reason applyMark
         keeps them. */
      function brushApply(ta, from, to) {
        if (!brush || ta.getAttribute("contenteditable") === "false") return false;
        if (!state.fx) {
          state.fx = true;
          for (const t of list.querySelectorAll(".lvp-ta")) t.classList.remove("plain");
        }
        const cells = readMarks(ta);
        let a = Math.max(0, Math.min(from, cells.length));
        let b = Math.max(0, Math.min(to, cells.length));
        if (b <= a) return false;
        for (let i = a; i < b; i++) {
          const keep = cells[i].cls.filter(c => BRUSH_SKIP.includes(c));
          cells[i].cls = Array.from(new Set(keep.concat(brush)));
        }
        writeMarks(ta, cells);
        ta.dispatchEvent(new Event("input"));
        const sel = window.getSelection();
        if (sel) sel.removeAllRanges();
        refreshToolbar();
        if (findState) findState.refresh();
        return true;
      }

      /* The families of marks. Each has its own dropdown on the style bar;
         the find bar's "style every hit" row is built from the same lists. */
      const MARK_FONTS = [
        ["m-q10", "Segoe UI", "Sans", "'Segoe UI','Helvetica Neue',Arial,sans-serif"],
        ["m-q9", "Arial", "Sans", "Arial,Helvetica,sans-serif"],
        ["m-q12", "Trebuchet", "Sans", "'Trebuchet MS','Lucida Grande',sans-serif"],
        ["m-q7", "Georgia", "Serif", "Georgia,serif"],
        ["m-q11", "Palatino", "Serif", "'Palatino Linotype',Palatino,serif"],
        ["m-q8", "Times", "Serif", "'Times New Roman',Times,serif"],
        ["m-q3", "Consolas", "Mono", "Consolas,Menlo,'Courier New',monospace"],
        ["m-q13", "Courier", "Mono", "'Courier New',Courier,monospace"],
      ];
      const MARK_HL = [
        ["m-hy", "Yellow", "#6b5a12"], ["m-ho", "Orange", "#5e3814"], ["m-hr", "Red", "#5c1f24"],
        ["m-hp", "Purple", "#4a2350"], ["m-hb", "Blue", "#14395e"], ["m-hg", "Green", "#1d4d33"],
        ["m-hn", "Grey", "#3a3a3a"],
      ];
      const MARK_COLORS = [
        ["m-cy", "Yellow", "#ffcf70"], ["m-co", "Orange", "#ffad66"], ["m-cr", "Red", "#ff9a9a"],
        ["m-ck", "Pink", "#ff9fd2"], ["m-cv", "Violet", "#c3a6ff"], ["m-cb", "Blue", "#7fb6ff"],
        ["m-cc", "Cyan", "#7fe3e0"], ["m-cg", "Green", "#8fe0a8"], ["m-cw", "White", "#ffffff"],
        ["m-cn", "Grey", "#9a9a9a"],
      ];
      const SIZE_EM = { "m-za": .64, "m-z1": .72, "m-zb": .78, "m-z2": .85, "m-zc": .92,
        "m-zd": 1.12, "m-z3": 1.25, "m-ze": 1.42, "m-z4": 1.6, "m-zf": 1.85, "m-z5": 2.1,
        "m-zg": 2.45, "m-z6": 2.8 };
      /* the find bar keeps its flat row of buttons */
      const MARK_BUTTONS = [
        ["B", "m-b", "Bold", "font-weight:700"],
        ["I", "m-i", "Italic", "font-style:italic"],
        ["U", "m-u", "Underline", "text-decoration:underline"],
        ["A", "size-", "Smaller", "font-size:8px"],
        ["A", "size+", "Larger", "font-size:13px"],
        ["|"],
        ...MARK_HL.map(([c, t, bg]) => ["", c, "Highlight " + t.toLowerCase(), "background:" + bg]),
        ["|"],
        ...MARK_COLORS.map(([c, t, col]) => ["A", c, "Text " + t.toLowerCase(), "color:" + col]),
        ["|"],
        ["✕", "", "Clear marks", "color:#f88"],
      ];

      /* colours made on the sliders and starred, kept in this browser and
         shown after the preset colours */
      function favRgb() {
        try { return JSON.parse(prefRaw("lvp-rgb-fav") || "[]").filter(h => /^[0-9a-f]{6}$/.test(h)); }
        catch (e) { return []; }
      }
      function saveFav(list) {
        try { prefPut("lvp-rgb-fav", JSON.stringify(list.slice(0, 30))); }
        catch (e) { /* storage may be off */ }
      }
      function favHtml() {
        return favRgb().map(h =>
          `<span class="fv"><button class="sw" data-c="m-x${h}" title="#${h.toUpperCase()}" style="color:#${h}">A</button>`
          + `<b class="del" data-del="${h}" title="Remove from favourites">\u00D7</b></span>`).join("");
      }
      const hexOf = (v) => v.map(x => x.toString(16).padStart(2, "0")).join("");
      function parseHex(t) {
        let h = String(t || "").trim().replace(/^#/, "").toLowerCase();
        if (/^[0-9a-f]{3}$/.test(h)) h = h.split("").map(c => c + c).join("");
        return /^[0-9a-f]{6}$/.test(h) ? h : null;
      }
      let rgbVal = [255, 207, 112];

      /* ---------- fonts on this computer ----------
         Chrome can list the fonts installed here (it asks once). They are
         grouped by family; a family opens into its faces - Thin to Black,
         italics - and each face can be put on or starred. */
      const lfState = { fams: null, open: null, q: "" };
      const faceWeight = (style) => faceW(style) + (faceIt(style) ? 1 : 0);
      const escAttr = (t) => String(t || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
      function fontFavs() {
        try { return JSON.parse(prefRaw("lvp-font-fav") || "[]").filter(k => /^[0-9a-z]{3,9}$/.test(k)); }
        catch (e) { return []; }
      }
      function saveFontFavs(l) {
        try { prefPut("lvp-font-fav", JSON.stringify(l.slice(0, 40))); } catch (e) { /* storage off */ }
      }
      /* "Paperlogy 3" + "3 Light" reads "Paperlogy 3 Light", not "3 3" */
      function faceLabel(f) {
        let st = String(f.style || "");
        const last = String(f.family || "").trim().split(/\s+/).pop();
        if (last && st.split(/\s+/)[0] === last) st = st.slice(last.length).trim();
        return f.family + (st && st !== "Regular" ? " " + st : "");
      }
      function fontFavHtml() {
        const reg = fontReg();
        const l = fontFavs().filter(k => reg[k]);
        if (!l.length) return `<div class="hint">Star a face below to keep it here.</div>`;
        return l.map(k => { ensureFace(k, reg[k]); return `<span class="fv2"><button class="it" data-c="m-y${k}" style="${faceCss(k, reg[k], "'")}">${escAttr(faceLabel(reg[k]))}</button>`
          + `<b class="fdel" data-fdel="${k}" title="Remove from favourites">×</b></span>`; }).join("");
      }
      function myFontsHtml(q) {
        if (!lfState.fams) {
          return typeof window.queryLocalFonts === "function"
            ? `<button class="it ldf" title="Chrome asks once for permission">Show the fonts on this computer…</button>`
            : `<div class="hint">Listing this computer's fonts needs Chrome or Edge on http://127.0.0.1 or https.</div>`;
        }
        const needle = String(q || "").trim().toLowerCase();
        const fams = lfState.fams.filter(f => !needle || f.name.toLowerCase().includes(needle));
        /* every family is listed - the panel scrolls, and the search box
           narrows it */
        const shown = fams;
        return `<input class="fq" placeholder="Search ${lfState.fams.length} families" spellcheck="false" value="${escAttr(q)}">`
          + `<div class="fl2">` + shown.map((f) => {
            const fi = lfState.fams.indexOf(f);
            const open = lfState.open === fi;
            let h = `<button class="it fam${open ? " on" : ""}" data-fi="${fi}" style="font-family:'${cssName(f.name).replace(/'/g, "")}'"><span class="nm">${escAttr(f.name)}</span><small>${f.faces.length}</small></button>`;
            if (open) {
              const favs = fontFavs();
              h += `<div class="faces">` + f.faces.map((x, k) => {
                const key = fontKey(x.ps);
                ensureFace(key, x);
                return `<span class="fc"><button class="it face" data-fi="${fi}" data-k="${k}" style="${faceCss(key, x, "'")}">${escAttr(x.style || "Regular")}</button>`
                  + `<b class="star${favs.includes(key) ? " on" : ""}" data-fi="${fi}" data-k="${k}" title="Add to favourites">★</b></span>`;
              }).join("") + `</div>`;
            }
            return h;
          }).join("")
          + (fams.length ? "" : `<div class="hint">No family matches.</div>`) + `</div>`;
      }
      async function loadLocalFonts() {
        const list = await window.queryLocalFonts();
        const by = new Map();
        for (const f of list) {
          const face = { ps: f.postscriptName, full: f.fullName, family: f.family, style: f.style };
          if (!by.has(f.family)) by.set(f.family, []);
          by.get(f.family).push(face);
        }
        lfState.fams = Array.from(by, ([name, faces]) => ({
          name, faces: faces.sort((a, b) => faceWeight(a.style) - faceWeight(b.style)),
        })).sort((a, b) => a.name.localeCompare(b.name));
      }
      function repaintMyFonts(bar, keepFocus) {
        const box = bar.querySelector(".myf");
        if (!box) return;
        const pan = box.closest(".pan");
        const top = pan ? pan.scrollTop : 0;
        box.innerHTML = myFontsHtml(lfState.q);
        if (pan) pan.scrollTop = top;
        if (keepFocus) {
          const fq = box.querySelector(".fq");
          if (fq) { fq.focus(); fq.setSelectionRange(fq.value.length, fq.value.length); }
        }
      }
      function faceAt(fi, k) {
        const f = lfState.fams && lfState.fams[fi];
        return f ? f.faces[k] : null;
      }
      function registerFace(x) {
        const key = fontKey(x.ps);
        fontRegPut(key, x);
        ensureFace(key, x);
        return key;
      }

      /* paragraph settings: class prefix, default, range and step */
      const PKEYS = {
        lead:   { re: /^m-pl\d+$/, mk: v => "m-pl" + v, def: 150, min: 80, max: 300, step: 10, u: "%", label: "Line spacing" },
        before: { re: /^m-pb\d+$/, mk: v => "m-pb" + v, def: 0, min: 0, max: 120, step: 2, u: "", label: "Space before" },
        after:  { re: /^m-pe\d+$/, mk: v => "m-pe" + v, def: 0, min: 0, max: 120, step: 2, u: "", label: "Space after" },
        indent: { re: /^m-pi\d+$/, mk: v => "m-pi" + v, def: 0, min: 0, max: 300, step: 4, u: "", label: "Left indent" },
        first:  { re: /^m-pfn?\d+$/, mk: v => v < 0 ? "m-pfn" + (-v) : "m-pf" + v, def: 0, min: -150, max: 300, step: 4, u: "", label: "First line" },
        tab:    { re: /^m-pt\d+$/, mk: v => "m-pt" + v, def: 48, min: 8, max: 400, step: 8, u: "", label: "Tab width" },
      };
      /* lines above and below a paragraph, as InDesign's paragraph rules:
         a weight for each, one colour for both */
      const RULE_W = ["05", "10", "15", "20", "30"];
      const RULE_C = [["g", "#5d626b", "Grey"], ["w", "#e8e8e8", "White"], ["y", "#e8c76a", "Gold"], ["b", "#6f9bd6", "Blue"]];
      function ruleGet(list, side) {
        const c = list.find(x => new RegExp("^m-pr" + side + "\\d\\d$").test(x));
        return c ? c.slice(5) : "";
      }
      function ruleSet(list, side, w) {
        const out = list.filter(x => !new RegExp("^m-pr" + side + "\\d\\d$").test(x));
        if (w) out.push("m-pr" + side + w);
        return out;
      }
      function ruleColGet(list) { const c = list.find(x => /^m-prc[gwyb]$/.test(x)); return c ? c.slice(5) : "g"; }
      /* the line's pattern, one for both lines: s solid, d dashed, o dotted, w double */
      const RULE_S = [["s", "Solid"], ["d", "Dashed"], ["o", "Dotted"], ["w", "Double"]];
      function ruleStyGet(list) { const c = list.find(x => /^m-prs[dow]$/.test(x)); return c ? c.slice(5) : "s"; }
      function ruleStySet(list, k) {
        const out = list.filter(x => !/^m-prs[dow]$/.test(x));
        if (k && k !== "s") out.push("m-prs" + k);
        return out;
      }
      function ruleColSet(list, k) {
        const out = list.filter(x => !/^m-prc[gwyb]$/.test(x));
        if (k && k !== "g") out.push("m-prc" + k);
        return out;
      }
      function paraGet(list, key) {
        if (key === "align") {
          const c = list.find(x => /^m-pa[crj]$/.test(x));
          return c ? c.slice(4) : "l";
        }
        const k = PKEYS[key], c = list.find(x => k.re.test(x));
        if (!c) return k.def;
        return c.startsWith("m-pfn") ? -(+c.slice(5)) : +c.match(/\d+$/)[0];
      }
      function paraSet(list, key, v) {
        if (key === "align") {
          const out = list.filter(x => !/^m-pa[crj]$/.test(x));
          if (v && v !== "l") out.push("m-pa" + v);
          return out;
        }
        const k = PKEYS[key];
        const n = Math.max(k.min, Math.min(k.max, Math.round(v)));
        const out = list.filter(x => !k.re.test(x));
        if (n !== k.def) out.push(k.mk(n));
        return out;
      }
      /* paragraph styles: the marks of the first character and the settings
         of its paragraph, under a name, kept in this browser */
      function pStyles() {
        try { return (JSON.parse(prefRaw("lvp-pstyles") || "[]") || []).filter(x => x && x.name); }
        catch (e) { return []; }
      }
      function savePStyles(l) {
        try { prefPut("lvp-pstyles", JSON.stringify(l.slice(0, 30))); } catch (e) { /* storage off */ }
      }
      function cStyles() {
        try { return (JSON.parse(prefRaw("lvp-cstyles") || "[]") || []).filter(x => x && x.name); }
        catch (e) { return []; }
      }
      function saveCStyles(l) {
        try { prefPut("lvp-cstyles", JSON.stringify(l.slice(0, 30))); } catch (e) { /* storage off */ }
      }
      const keyChip = (k, chr) => k ? `<small>${chr ? "Alt" : "Ctrl+Alt"}+${k}</small>` : "";
      function pStylesHtml() {
        const l = pStyles();
        if (!l.length) return `<div class="hint">None yet.</div>`;
        return l.map((x, i) => `<span class="fv2"><button class="it" data-pst="${i}">${escAttr(x.name)}${keyChip(x.key, false)}</button>`
          + `<b class="pdel" data-pstdel="${i}" title="Delete this style">×</b></span>`).join("");
      }
      function cStylesHtml() {
        const l = cStyles();
        if (!l.length) return `<div class="hint">None yet.</div>`;
        return l.map((x, i) => `<span class="fv2"><button class="it" data-cst="${i}">${escAttr(x.name)}${keyChip(x.key, true)}</button>`
          + `<b class="pdel" data-cstdel="${i}" title="Delete this style">×</b></span>`).join("");
      }
      function stylesPanelHtml() {
        return `<div class="lbl">Paragraph styles</div><div class="psl">${pStylesHtml()}</div>`
          + `<div class="lbl" style="margin-top:10px">Character styles</div><div class="csl">${cStylesHtml()}</div>`
          + `<div class="lbl" style="margin-top:10px">New style from the selection</div>`
          + `<div class="pss"><input class="psn" placeholder="Style name" maxlength="30" spellcheck="false">`
          + `<input class="psk" maxlength="1" placeholder="1-9" spellcheck="false" title="Shortcut number, 1 to 9 - optional"></div>`
          + `<div class="pss"><button class="ap" data-pssave="p" title="The line's paragraph settings and its first character's marks">¶ Paragraph</button>`
          + `<button class="ap" data-pssave="c" title="The first selected character's marks">A Character</button></div>`
          + `<div class="hint"><b class="kb">Ctrl+Alt+number</b> puts a paragraph style on the lines the selection touches.</div>`
          + `<div class="hint"><b class="kb">Alt+number</b> puts a character style on the selected text.</div>`;
      }
      function repaintStyles(bar) {
        const ps = bar.querySelector(".psl"); if (ps) ps.innerHTML = pStylesHtml();
        const cs = bar.querySelector(".csl"); if (cs) cs.innerHTML = cStylesHtml();
      }
      /* a paragraph style over the lines from..to, a character style over
         the characters - both usable from the bar and from the keyboard */
      function paraOpAt(host, from, to, fn, charsFn) {
        const cells = readMarks(host);
        const paras = host._paras;
        from = Math.max(0, Math.min(from, cells.length)); to = Math.max(from, Math.min(to, cells.length));
        const ls = linesOf(cells, from, to);
        for (const L of ls) paras[L] = fn(paras[L] || [], L);
        if (charsFn) {
          let L = 0;
          for (const c of cells) { if (c.ch === "\n") { L++; continue; } if (ls.includes(L)) c.cls = charsFn(c.cls); }
        }
        writeMarks(host, cells);
        host.dispatchEvent(new Event("input"));
      }
      function applyParaStyle(host, from, to, st) {
        paraOpAt(host, from, to, () => (st.para || []).slice(), cls => cls.filter(c => c === "m-find").concat(st.chars || []));
      }
      function applyCharStyle(host, from, to, st) {
        const cells = readMarks(host);
        from = Math.max(0, Math.min(from, cells.length)); to = Math.max(from, Math.min(to, cells.length));
        for (let i = from; i < to; i++) {
          if (cells[i].ch === "\n") continue;
          cells[i].cls = cells[i].cls.filter(c => c === "m-find").concat(st.chars || []);
        }
        writeMarks(host, cells);
        host.dispatchEvent(new Event("input"));
      }
      /* the formatting of one place in the notes: its character's marks and
         its line's paragraph - what the eyedropper picks up */
      function formatAt(host, pos) {
        const cells = readMarks(host);
        let i = Math.max(0, Math.min(pos, cells.length - 1));
        if (cells[i] && cells[i].ch === "\n" && i > 0 && cells[i - 1].ch !== "\n") i--;
        const chars = cells[i] && cells[i].ch !== "\n" ? cells[i].cls.filter(c => c !== "m-find" && c !== "m-auto") : [];
        return { chars, para: (host._paras[lineIndexAt(cells, pos)] || []).slice() };
      }

      function paraPanelHtml() {
        const ico = {
          l: '<path d="M1 2h14v1.3H1zm0 3.5h9v1.3H1zM1 9h14v1.3H1zm0 3.5h9v1.3H1z"/>',
          c: '<path d="M1 2h14v1.3H1zm2.5 3.5h9v1.3h-9zM1 9h14v1.3H1zm2.5 3.5h9v1.3h-9z"/>',
          r: '<path d="M1 2h14v1.3H1zm5 3.5h9v1.3H6zM1 9h14v1.3H1zm5 3.5h9v1.3H6z"/>',
          j: '<path d="M1 2h14v1.3H1zm0 3.5h14v1.3H1zM1 9h14v1.3H1zm0 3.5h14v1.3H1z"/>',
        };
        const al = ["l", "c", "r", "j"].map(k => `<button class="mb" data-palign="${k}" title="${{ l: "Align left", c: "Centre", r: "Align right", j: "Justify" }[k]}">`
          + `<svg viewBox="0 0 16 14" width="15" height="13" fill="currentColor">${ico[k]}</svg></button>`).join("");
        const row = (k) => `<div class="prow"><span>${PKEYS[k].label}</span>`
          + `<button class="mb st" data-pstep="${k}-">−</button>`
          + `<input class="pvi" data-pk="${k}" spellcheck="false" title="Enter to apply">`
          + `<button class="mb st" data-pstep="${k}+">+</button></div>`;
        const rule = (side, label) => `<div class="prow rl"><span>${label}</span>`
          + `<button class="mb rw" data-prule="${side}:" title="No line">\u2215</button>`
          + RULE_W.map(w => `<button class="mb rw" data-prule="${side}:${w}" title="${+w / 10} px">`
            + `<i style="height:${{ "05": 1, "10": 1, "15": 2, "20": 2, "30": 3 }[w]}px;opacity:${{ "05": .42, "15": .62 }[w] || 1}"></i></button>`).join("") + `</div>`;
        const stys = `<div class="prow rl"><span>Line style</span>`
          + RULE_S.map(([k, t]) => `<button class="mb rs" data-prules="${k}" title="${t}"><i class="ls-${k}"></i></button>`).join("")
          + `</div>`;
        const cols = `<div class="prow rl"><span>Line colour</span>`
          + RULE_C.map(([k, col, t]) => `<button class="mb rc" data-prulec="${k}" title="${t}"><i style="background:${col}"></i></button>`).join("")
          + `</div>`;
        return `<div class="lbl">Paragraph</div><div class="row al">${al}</div>`
          + ["lead", "before", "after", "indent", "first", "tab"].map(row).join("")
          + `<div class="lbl" style="margin-top:10px">Lines</div>`
          + rule("a", "Line above") + rule("b", "Line below") + stys + cols
          + `<button class="it" data-preset="1" style="margin-top:6px">Reset paragraph<small>dots stay</small></button>`;
      }
      /* run one change over every line the selection touches */
      function paraOp(fn, charsFn) {
        const host = markBar?._ta, saved = markBar?._range;
        if (!host || !host._blocks || !saved) return;
        let [from, to] = rangeOffsets(host, saved);
        if (to < from) [from, to] = [to, from];
        paraOpAt(host, from, to, fn, charsFn);
        keepMarkBar(host, from, to);
      }

      function markBarHtml(dock) {
        const sep = `<span class="sep"></span>`;
        const fonts = MARK_FONTS.map(([c, name, kind, fam]) =>
          `<button class="it" data-c="${c}" style="font-family:${fam}">${name}<small>${kind}</small></button>`).join("");
        const hls = MARK_HL.map(([c, t, bg]) =>
          `<button class="sw" data-c="${c}" title="${t}" style="background:${bg}"></button>`).join("");
        const cols = MARK_COLORS.map(([c, t, col]) =>
          `<button class="sw" data-c="${c}" title="${t}" style="color:${col}">A</button>`).join("");
        const ch = (k) => `<div class="ch" data-k="${k}"><b>${"RGB"[k]}</b><div class="tr"><span class="kn"></span></div><input class="cv" data-k="${k}" maxlength="3" spellcheck="false" title="0 - 255, Enter to apply"></div>`;
        return ``
          + `<button class="mb" data-c="m-b" title="Bold" style="font-weight:800">B</button>`
          + `<button class="mb" data-c="m-i" title="Italic" style="font-style:italic;font-family:Georgia,serif">I</button>`
          + `<button class="mb" data-c="m-u" title="Underline" style="text-decoration:underline">U</button>`
          + `<span class="dd"><button class="mb" data-dd="dots" title="Paragraph dot"><span style="color:#8a8f98">●</span><span class="car">▾</span></button>`
          + `<div class="pan" data-p="dots"><button class="it" data-c="m-para"><span style="color:#8a8f98">●</span>Large dot</button>`
          + `<button class="it" data-c="m-dot"><span style="color:#8a8f98">•</span>Small dot</button></div></span>`
          + sep
          + `<span class="dd"><button class="mb" data-dd="hl" title="Highlight"><span class="hs" style="background:transparent"></span><span class="car">▾</span></button>`
          + `<div class="pan" data-p="hl"><div class="lbl">Highlight</div><div class="row">`
          + `<button class="sw none" data-c="none:hl" title="No highlight">∕</button>${hls}</div></div></span>`
          + `<span class="dd"><button class="mb" data-dd="col" title="Text colour"><span class="ca">A</span><span class="car">▾</span></button>`
          + `<div class="pan cols" data-p="col"><div class="lbl">Text colour</div><div class="row">`
          + `<button class="sw none" data-c="none:col" title="Default colour">∕</button>${cols}<span class="favs">${favHtml()}</span></div>`
          + `<div class="rgb"><div class="lbl">RGB</div>${ch(0)}${ch(1)}${ch(2)}`
          + `<div class="rgbf"><span class="pv"></span>`
          + `<button class="eye" data-eye="1" title="${typeof EyeDropper === "function" ? "Pick a colour from anywhere on the screen" : "The eyedropper needs Chrome or Edge"}"${typeof EyeDropper === "function" ? "" : " disabled"}>`
          + `<svg viewBox="0 0 16 16" width="13" height="13"><path fill="currentColor" d="M13.4 2.6a2 2 0 0 0-2.8 0L8.9 4.3 8.2 3.6 7.1 4.7l.7.7-5 5a1 1 0 0 0-.3.6l-.3 2.2 2.2-.3a1 1 0 0 0 .6-.3l5-5 .7.7 1.1-1.1-.7-.7 1.7-1.7a2 2 0 0 0 0-2.8zM4.6 12.2l-1 .1.1-1 4.9-4.9.9.9z"/></svg></button>`
          + `<input class="hx" maxlength="7" spellcheck="false" title="Type a colour - #DB4070 - and press Enter">`
          + `<button class="fav" data-fav="1" title="Add to the colours above">★</button>`
          + `<button class="ap" data-rgb="1">Apply</button></div></div>`
          + `</div></span>`
          + sep
          + `<button class="mb" data-c="size-" title="Smaller - a small step" style="font-size:9px">A</button>`
          + `<input class="zv" value="100%" spellcheck="false" title="Type a size in percent and press Enter">`
          + `<button class="mb" data-c="size+" title="Larger - a small step" style="font-size:14px">A</button>`
          + sep
          + `<span class="ic" title="Letter spacing - thousandths of an em, as in InDesign"><svg viewBox="0 0 16 12" width="15" height="11"><path fill="currentColor" d="M2.2 9 4.6 2h1.3l2.4 7H7.1l-.6-1.8H4l-.6 1.8zm2.1-2.8h1.9l-.9-2.9zM8.6 2h1.2l1.6 5.2L13 2h1.2l-2.3 7h-1z"/><path fill="currentColor" d="M1 11h14v.8H1z"/></svg></span>`
          + `<button class="mb st" data-step="tk-" title="Tighter - 10">\u2212</button>`
          + `<input class="tk" value="0" spellcheck="false" title="Letter spacing - thousandths of an em (-200 to 800), Enter to apply">`
          + `<button class="mb st" data-step="tk+" title="Looser - 10">+</button>`
          + (dock ? sep + `<span class="dd"><button class="mb" data-dd="para" title="Paragraph - spacing, indents, alignment, tabs, styles" style="font-weight:700">\u00B6<span class="car">\u25BE</span></button>`
            + `<div class="pan para" data-p="para">${paraPanelHtml()}</div></span>`
            + `<span class="dd"><button class="mb" data-dd="sty" title="Paragraph and character styles"><span style="font-size:11px">Styles</span><span class="car">\u25BE</span></button>`
            + `<div class="pan sty" data-p="sty">${stylesPanelHtml()}</div></span>`
            + `<button class="mb" data-brush="1" title="Eyedropper - click text to pick up its formatting, then select text to stamp it on. Esc puts it down.">`
            + `<svg viewBox="0 0 16 16" width="13" height="13"><path fill="currentColor" d="M13.4 2.6a2 2 0 0 0-2.8 0L8.9 4.3 8.2 3.6 7.1 4.7l.7.7-5 5a1 1 0 0 0-.3.6l-.3 2.2 2.2-.3a1 1 0 0 0 .6-.3l5-5 .7.7 1.1-1.1-.7-.7 1.7-1.7a2 2 0 0 0 0-2.8zM4.6 12.2l-1 .1.1-1 4.9-4.9.9.9z"/></svg></button>` : "")
          + sep
          + `<span class="dd"><button class="mb" data-dd="font" title="Font"><span class="fl">Font</span><span class="car">\u25BE</span></button>`
          + `<div class="pan fonts" data-p="font">`
          + `<button class="it" data-c="none:font">Default<small>as the text</small></button>`
          + `<div class="lbl" style="margin-top:8px">Favourites</div><div class="ffav">${fontFavHtml()}</div>`
          + `<div class="lbl" style="margin-top:8px">My fonts</div><div class="myf">${myFontsHtml("")}</div>`
          + `<div class="lbl" style="margin-top:8px">Basic</div>${fonts}</div></span>`
          + sep
          + `<button class="mb rst" data-c="" title="Clear marks - back to plain text">`
          + `<svg viewBox="0 0 16 16" width="14" height="14"><path fill="currentColor" d="M8 2.5a5.5 5.5 0 1 1-5.4 6.6h1.5A4 4 0 1 0 5.3 5L7 6.7H2.5V2.2l1.8 1.8A5.5 5.5 0 0 1 8 2.5z"/></svg></button>`;
      }

      function paintRgb(bar) {
        const hex = rgbVal.map(v => v.toString(16).padStart(2, "0")).join("");
        bar.querySelectorAll(".ch").forEach(row => {
          const k = +row.dataset.k;
          const lo = rgbVal.slice(), hi = rgbVal.slice();
          lo[k] = 0; hi[k] = 255;
          row.querySelector(".tr").style.background = `linear-gradient(90deg, rgb(${lo}), rgb(${hi}))`;
          row.querySelector(".kn").style.left = (rgbVal[k] / 255 * 100) + "%";
          const cv = row.querySelector(".cv");
          if (cv && document.activeElement !== cv) cv.value = rgbVal[k];
        });
        const pv = bar.querySelector(".rgbf .pv");
        if (pv) pv.style.background = "#" + hex;
        const hx = bar.querySelector(".rgbf .hx");
        if (hx && document.activeElement !== hx) hx.value = "#" + hex.toUpperCase();
        return hex;
      }

      /* any press outside an open dropdown closes it; Esc does too */
      const onPanelOut = (e) => {
        if (!markBar || !markBar.querySelector(".pan.show")) return;
        if (markBar.contains(e.target)) return;
        closePanels(markBar, null);
      };
      const onPanelEsc = (e) => {
        if (e.key !== "Escape" || !markBar || !markBar.querySelector(".pan.show")) return;
        closePanels(markBar, null);
        e.stopPropagation();
      };
      document.addEventListener("pointerdown", onPanelOut, true);
      document.addEventListener("keydown", onPanelEsc, true);
      function closePanels(bar, except) {
        bar.querySelectorAll(".pan.show").forEach(p => { if (p !== except) p.classList.remove("show"); });
        bar.querySelectorAll(".mb.open").forEach(b => { if (!except || b.dataset.dd !== except.dataset.p) b.classList.remove("open"); });
      }

      function openPanel(bar, key) {
        const pan = bar.querySelector(`.pan[data-p="${key}"]`);
        const trig = bar.querySelector(`.mb[data-dd="${key}"]`);
        if (!pan || !trig) return;
        const was = pan.classList.contains("show");
        closePanels(bar, null);
        if (was) return;
        /* the panel hangs under its own button, and opens upward when the
           node has no room for it below */
        pan.style.left = (trig.offsetLeft) + "px";
        pan.classList.remove("up");
        pan.classList.add("show");
        trig.classList.add("open");
        const rr = root.getBoundingClientRect();
        const sc = (rr.width / (root.offsetWidth || 1)) || 1;
        const br = bar.getBoundingClientRect();
        const below = (rr.bottom - br.bottom) / sc - 6, above = (br.top - rr.top) / sc - 6;
        if (pan.offsetHeight > below && above > below) pan.classList.add("up");
        const pr = pan.getBoundingClientRect();
        const overR = (pr.right - rr.right) / sc + 4;
        if (overR > 0) pan.style.left = Math.max(-(br.left - rr.left) / sc + 2, trig.offsetLeft - overR) + "px";
        if (key === "col") {
          /* the sliders start from the colour the selection already wears */
          const cur = parseHex(bar._curCol);
          if (cur) rgbVal = [0, 2, 4].map(i => parseInt(cur.slice(i, i + 2), 16));
          paintRgb(bar);
        }
      }

      function showMarkBar(ta, opts) {
        const dock = !!(opts && opts.dock);
        const sel = window.getSelection();
        if (dock) {
          /* docked: one bar sits above the editor for as long as it is open,
             and follows whatever is selected in it */
          if (markBar && markBar._dock && markBar._ta === ta && markBar.isConnected) return;
          hideMarkBar(true);
          const bar = document.createElement("div");
          bar.className = "lvp-mark dock";
          bar._ta = ta;
          bar._dock = true;
          const r0 = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
          bar._range = r0 && ta.contains(r0.commonAncestorContainer) ? r0.cloneRange() : null;
          bar.innerHTML = markBarHtml(true);
          ta.parentNode.insertBefore(bar, ta);
          wireMarkBar(bar);
          return;
        }
        if (!sel || !sel.rangeCount || sel.isCollapsed) { hideMarkBar(); return; }
        const r = sel.getRangeAt(0);
        if (!ta.contains(r.commonAncestorContainer)) { hideMarkBar(); return; }
        if (ta.getAttribute("contenteditable") === "false") return;
        /* the same run is already under the bar: leave it, with whatever
           dropdown is open, instead of putting up a fresh one */
        if (markBar && markBar._ta === ta && markBar._range) {
          try {
            const [a, b] = rangeOffsets(ta, r), [c, d] = rangeOffsets(ta, markBar._range);
            if (Math.min(a, b) === Math.min(c, d) && Math.max(a, b) === Math.max(c, d)) return;
          } catch (e) { /* draw a new one */ }
        }

        hideMarkBar(true);
        const bar = document.createElement("div");
        bar.className = "lvp-mark";
        bar._ta = ta;
        /* Hold on to the range. Clicking a button can drop the live selection,
           and then the action had nothing to work on - that was the "sometimes
           the clear button does nothing" behaviour. */
        bar._range = r.cloneRange();
        bar.innerHTML = markBarHtml(!!(opts && opts.lead));
        bar.style.visibility = "hidden";      // measure before it is seen
        root.appendChild(bar);

        /* The canvas scales this element with a CSS transform, so measured
           rectangles are in screen pixels while left/top are in the element's
           own pixels. Divide by the scale or the bar drifts away - or lands
           off-screen entirely - as soon as the graph is zoomed. */
        const rootRect = root.getBoundingClientRect();
        const scale = (rootRect.width / (root.offsetWidth || 1)) || 1;
        const rects = r.getClientRects();
        const first = rects[0] || r.getBoundingClientRect();
        const last = rects[rects.length - 1] || first;

        const barW = bar.offsetWidth || 300;
        const barH = bar.offsetHeight || 34;
        let left = (first.left - rootRect.left) / scale;
        let top = (first.top - rootRect.top) / scale - barH - 6;
        if (top < 2) {
          top = (last.bottom - rootRect.top) / scale + 6;   // flip below
        }
        const maxL = Math.max(2, (root.offsetWidth || 400) - barW - 4);
        const maxT = Math.max(2, (root.offsetHeight || 400) - barH - 4);
        bar.style.left = Math.round(Math.min(Math.max(2, left), maxL)) + "px";
        bar.style.top = Math.round(Math.min(Math.max(2, top), maxT)) + "px";
        bar.style.visibility = "";
        wireMarkBar(bar);
      }

      /* Typing into a box on the bar takes the focus, and with it the
         browser's own selection colour. The run the box will act on is
         painted with a highlight of its own until the focus comes back. */
      function holdRun(bar, on) {
        root.querySelectorAll(".lvp-hold").forEach(x => x.remove());
        if (!on || !bar._range || bar._range.collapsed || !bar._ta || !bar._ta.isConnected) return;
        try {
          const rr = root.getBoundingClientRect();
          const sc = (rr.width / (root.offsetWidth || 1)) || 1;
          const box = document.createElement("div");
          box.className = "lvp-hold";
          for (const r of bar._range.getClientRects()) {
            if (r.width < 1) continue;
            const d = document.createElement("i");
            d.style.left = ((r.left - rr.left) / sc + root.scrollLeft) + "px";
            d.style.top = ((r.top - rr.top) / sc + root.scrollTop) + "px";
            d.style.width = (r.width / sc) + "px";
            d.style.height = (r.height / sc) + "px";
            box.appendChild(d);
          }
          root.appendChild(box);
        } catch (e) { /* only a hint */ }
      }

      /* the buttons, boxes and panels of a bar, floating or docked */
      function wireMarkBar(bar) {
        bar.addEventListener("focusin", (e) => { if (e.target.tagName === "INPUT") holdRun(bar, true); });
        bar.addEventListener("focusout", (e) => {
          if (e.target.tagName !== "INPUT") return;
          setTimeout(() => { if (!bar.contains(document.activeElement)) holdRun(bar, false); }, 0);
        });

        /* Nothing on the bar may take the focus or the selection would go -
           every press is caught on pointerdown and its default stopped. The
           two typing boxes are the exception: they take the focus, and the
           run they act on is the one the bar was opened over. */
        const isBox = (el) => el && el.tagName === "INPUT" && bar.contains(el);
        /* The eyedropper is only allowed right after a real mouse press, and
           Chrome counts the press on mousedown - which never comes when
           pointerdown has its default stopped. So that one button keeps its
           default and opens on click; the run is put back afterwards. */
        const isEye = (el) => !!(el && el.closest && el.closest(".eye, .ldf") && bar.contains(el));
        const backToText = () => { try { bar._ta.focus({ preventScroll: true }); } catch (err) { /* ignore */ } };
        bar.addEventListener("pointerdown", (e) => {
          e.stopPropagation();
          if (isBox(e.target) || isEye(e.target)) return;
          const t = e.target.closest("button, .tr, .del, .fdel, .star, .pdel");
          if (!t || !bar.contains(t)) { e.preventDefault(); return; }
          e.preventDefault();
          if (t.classList.contains("pdel")) {              // a style out
            if (t.dataset.cstdel !== undefined) { const l = cStyles(); l.splice(+t.dataset.cstdel, 1); saveCStyles(l); }
            else { const l = pStyles(); l.splice(+t.dataset.pstdel, 1); savePStyles(l); }
            repaintStyles(bar);
            return;
          }
          if (t.dataset.brush) {                         // the eyedropper picked up
            const host = bar._ta;
            if (host) host.dispatchEvent(new CustomEvent("lvp-brush"));
            return;
          }
          if (t.dataset.cst !== undefined) {             // a character style put on
            const st = cStyles()[+t.dataset.cst];
            if (!st || !bar._ta) return;
            if (isBox(document.activeElement)) backToText();
            const [a, b] = offsetsOf(bar);
            applyCharStyle(bar._ta, a, b, st);
            keepMarkBar(bar._ta, a, b);
            if (markBar === bar) closePanels(bar, null);
            return;
          }
          if (t.dataset.palign) {
            const v = t.dataset.palign;
            if (isBox(document.activeElement)) backToText();
            paraOp(list => paraSet(list, "align", v));
            return;
          }
          if (t.dataset.prule !== undefined) {           // a line above or below
            const [side, w] = t.dataset.prule.split(":");
            if (isBox(document.activeElement)) backToText();
            paraOp(list => ruleSet(list, side, w));
            return;
          }
          if (t.dataset.prulec) {
            const k = t.dataset.prulec;
            if (isBox(document.activeElement)) backToText();
            paraOp(list => ruleColSet(list, k));
            return;
          }
          if (t.dataset.prules) {                        // the line's pattern
            const k = t.dataset.prules;
            if (isBox(document.activeElement)) backToText();
            paraOp(list => ruleStySet(list, k));
            return;
          }
          if (t.dataset.pstep) {
            const key = t.dataset.pstep.slice(0, -1), up = t.dataset.pstep.endsWith("+");
            if (isBox(document.activeElement)) backToText();
            paraOp(list => paraSet(list, key, paraGet(list, key) + (up ? 1 : -1) * PKEYS[key].step));
            return;
          }
          if (t.dataset.preset) {
            if (isBox(document.activeElement)) backToText();
            paraOp(list => list.filter(c => c === "m-para" || c === "m-dot"));
            return;
          }
          if (t.dataset.pssave) {                        // the selection, kept as a style
            const nm = String(bar.querySelector(".psn")?.value || "").trim();
            const kv = String(bar.querySelector(".psk")?.value || "").trim();
            const key = /^[1-9]$/.test(kv) ? kv : "";
            const host = bar._ta;
            if (!nm || !host || !host._blocks || !bar._range) return;
            const [a] = offsetsOf(bar);
            const f = formatAt(host, a);
            if (t.dataset.pssave === "c") {
              const l = cStyles().filter(x => x.name !== nm).map(x => key && x.key === key ? { ...x, key: "" } : x);
              l.push({ name: nm, chars: f.chars, key });
              saveCStyles(l);
            } else {
              const l = pStyles().filter(x => x.name !== nm).map(x => key && x.key === key ? { ...x, key: "" } : x);
              l.push({ name: nm, chars: f.chars, para: f.para, key });
              savePStyles(l);
            }
            repaintStyles(bar);
            for (const q of [".psn", ".psk"]) { const inp = bar.querySelector(q); if (inp) inp.value = ""; }
            backToText(); keepMarkBar(host, ...offsetsOf(bar));
            return;
          }
          if (t.dataset.pst !== undefined) {             // a paragraph style put on
            const st = pStyles()[+t.dataset.pst];
            if (!st) return;
            if (isBox(document.activeElement)) backToText();
            paraOp(() => (st.para || []).slice(), cls => cls.filter(c => c === "m-find").concat(st.chars || []));
            if (markBar === bar) closePanels(bar, null);
            return;
          }
          if (t.classList.contains("fdel")) {              // a font favourite out
            saveFontFavs(fontFavs().filter(k => k !== t.dataset.fdel));
            const ff = bar.querySelector(".ffav"); if (ff) ff.innerHTML = fontFavHtml();
            repaintMyFonts(bar);
            return;
          }
          if (t.classList.contains("star")) {              // a face starred
            const x = faceAt(+t.dataset.fi, +t.dataset.k);
            if (!x) return;
            const key = registerFace(x);
            const l = fontFavs();
            saveFontFavs(l.includes(key) ? l.filter(k => k !== key) : l.concat(key));
            const ff = bar.querySelector(".ffav"); if (ff) ff.innerHTML = fontFavHtml();
            repaintMyFonts(bar);
            return;
          }
          if (t.classList.contains("fam")) {               // a family opened
            const fi = +t.dataset.fi;
            lfState.open = lfState.open === fi ? null : fi;
            repaintMyFonts(bar);
            return;
          }
          if (t.classList.contains("face")) {              // a face put on
            const x = faceAt(+t.dataset.fi, +t.dataset.k);
            if (!x) return;
            const key = registerFace(x);
            ensureRgb("m-y" + key);
            if (isBox(document.activeElement)) backToText();
            applyMark("m-y" + key);
            if (markBar === bar) closePanels(bar, null);
            return;
          }
          if (t.classList.contains("del")) {               // a favourite out
            saveFav(favRgb().filter(h => h !== t.dataset.del));
            const fv = bar.querySelector(".favs");
            if (fv) fv.innerHTML = favHtml();
            paintMarkState();
            return;
          }
          if (t.classList.contains("tr")) {              // an RGB channel
            const k = +t.parentElement.dataset.k;
            const setFrom = (ev) => {
              const rc = t.getBoundingClientRect();
              const v = Math.round(Math.max(0, Math.min(1, (ev.clientX - rc.left) / (rc.width || 1))) * 255);
              rgbVal[k] = v;
              paintRgb(bar);
            };
            setFrom(e);
            try { t.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
            const mv = (ev) => setFrom(ev);
            const up = () => { t.removeEventListener("pointermove", mv); t.removeEventListener("pointerup", up); };
            t.addEventListener("pointermove", mv);
            t.addEventListener("pointerup", up);
            return;
          }
          if (t.dataset.dd) { openPanel(bar, t.dataset.dd); return; }
          if (t.dataset.step) {                          // letter / line spacing nudged
            const st = t.dataset.step;
            if (st.startsWith("tk")) {
              const tkv = parseInt(bar.querySelector(".tk")?.value, 10) || 0;
              applyMark("track=" + (tkv + (st === "tk+" ? 10 : -10)));
            } else {
              const cur = +(bar._ta.dataset.lead || 150);
              const v = Math.max(80, Math.min(300, cur + (st === "ld+" ? 10 : -10)));
              bar._ta.dispatchEvent(new CustomEvent("lvp-lead", { detail: v }));
              const ld = bar.querySelector(".ld"); if (ld) ld.value = v + "%";
            }
            return;
          }
          if (t.dataset.fav) {                           // the current colour starred
            const hex = paintRgb(bar);
            /* added at the end, in the order they were made */
            saveFav(favRgb().filter(h => h !== hex).concat(hex));
            const fv = bar.querySelector(".favs");
            if (fv) fv.innerHTML = favHtml();
            paintMarkState();
            return;
          }
          if (t.dataset.rgb) {
            const hex = paintRgb(bar);
            if (isBox(document.activeElement)) backToText();
            applyMark("m-x" + hex);
            return;
          }
          if (t.dataset.c !== undefined) {
            const inPanel = t.closest(".pan");
            if (isBox(document.activeElement)) backToText();
            applyMark(t.dataset.c);
            if (inPanel && markBar === bar) closePanels(bar, null);
          }
        });
        for (const ev of ["mousedown", "wheel"]) {
          bar.addEventListener(ev, e => e.stopPropagation());
        }
        bar.addEventListener("mousedown", e => { if (!isBox(e.target) && !isEye(e.target)) e.preventDefault(); });
        bar.addEventListener("click", (e) => {
          if (!isEye(e.target)) return;
          e.stopPropagation();
          if (e.target.closest(".ldf")) {                 // the fonts on this computer
            const [a, b] = offsetsOf(bar);
            loadLocalFonts().then(() => { if (markBar === bar) repaintMyFonts(bar); })
              .catch(() => {
                const box = bar.querySelector(".myf");
                if (box) box.innerHTML = `<div class="hint">Chrome did not allow the font list. It can be allowed from the address bar's site settings.</div>`;
              })
              .finally(() => { if (markBar === bar) { backToText(); keepMarkBar(bar._ta, a, b); } });
            return;
          }
          if (typeof EyeDropper !== "function") return;
          const [a, b] = offsetsOf(bar);
          const back = () => { if (markBar === bar) { backToText(); keepMarkBar(bar._ta, a, b); } };
          let ed;
          try { ed = new EyeDropper().open(); } catch (err) { back(); return; }
          ed.then((res) => {
            const h = parseHex(res && res.sRGBHex);
            if (h && markBar === bar) {
              rgbVal = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
              paintRgb(bar);
            }
            back();
          }).catch(() => back());               // Esc - nothing picked
        });
        /* keys typed into the boxes stay with them, away from the canvas */
        for (const ev of ["keydown", "keyup", "keypress"]) {
          bar.addEventListener(ev, e => e.stopPropagation());
        }
        /* the search box over this computer's fonts is drawn again with the
           list, so it is listened for on the bar */
        bar.addEventListener("input", (e) => {
          if (!e.target.classList || !e.target.classList.contains("fq")) return;
          lfState.q = e.target.value;
          lfState.open = null;
          repaintMyFonts(bar, true);
        });
        const hx = bar.querySelector(".hx");
        hx.addEventListener("input", () => {
          const h = parseHex(hx.value);
          if (h) { rgbVal = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); paintRgb(bar); }
        });
        hx.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            const h = parseHex(hx.value);
            if (!h) return;
            rgbVal = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
            paintRgb(bar);
            backToText();
            applyMark("m-x" + h);
          } else if (e.key === "Escape") { e.preventDefault(); backToText(); keepMarkBar(bar._ta, ...offsetsOf(bar)); }
        });
        /* each channel can be typed as a number too */
        bar.querySelectorAll(".cv").forEach(cv => {
          const k = +cv.dataset.k;
          cv.addEventListener("focus", () => cv.select());
          cv.addEventListener("input", () => {
            const n = parseInt(String(cv.value).replace(/\D/g, ""), 10);
            if (!isNaN(n)) { rgbVal[k] = Math.max(0, Math.min(255, n)); paintRgb(bar); }
          });
          cv.addEventListener("blur", () => { cv.value = rgbVal[k]; });
          cv.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              const hex = paintRgb(bar);
              backToText();
              applyMark("m-x" + hex);
            } else if (e.key === "Escape") { e.preventDefault(); backToText(); keepMarkBar(bar._ta, ...offsetsOf(bar)); }
          });
        });
        /* the number boxes of the paragraph panel */
        bar.querySelectorAll(".pvi").forEach(inp => {
          inp.addEventListener("focus", () => { inp.value = String(inp.value).replace(/%$/, ""); inp.select(); });
          inp.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              const n = parseFloat(String(inp.value).replace(/[^\d.-]/g, ""));
              if (isNaN(n)) return;
              const key = inp.dataset.pk;
              backToText();
              paraOp(list => paraSet(list, key, n));
            } else if (e.key === "Escape") { e.preventDefault(); backToText(); keepMarkBar(bar._ta, ...offsetsOf(bar)); }
          });
          inp.addEventListener("blur", () => setTimeout(() => paintMarkState(), 0));
        });
        const psn = bar.querySelector(".psn");
        if (psn) psn.addEventListener("keydown", (e) => {
          if (e.key === "Enter") { e.preventDefault(); bar.querySelector('[data-pssave="p"]')?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); }
        });
        const tk = bar.querySelector(".tk");
        tk.addEventListener("focus", () => tk.select());
        tk.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            const n = parseInt(String(tk.value).replace(/[^\d-]/g, ""), 10);
            if (isNaN(n)) return;
            backToText();
            applyMark("track=" + n);
          } else if (e.key === "Escape") { e.preventDefault(); backToText(); keepMarkBar(bar._ta, ...offsetsOf(bar)); }
        });
        tk.addEventListener("blur", () => setTimeout(() => paintMarkState(), 0));
        const ld = bar.querySelector(".ld");
        if (ld) {
          ld.value = (bar._ta.dataset.lead || 150) + "%";
          ld.addEventListener("focus", () => { ld.value = ld.value.replace(/%$/, ""); ld.select(); });
          ld.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              const n = Math.round(parseFloat(String(ld.value).replace(/[^\d.]/g, "")));
              if (!(n > 0)) return;
              const v = Math.max(80, Math.min(300, n));
              bar._ta.dispatchEvent(new CustomEvent("lvp-lead", { detail: v }));
              ld.value = v + "%";
              backToText();
              keepMarkBar(bar._ta, ...offsetsOf(bar));
            } else if (e.key === "Escape") { e.preventDefault(); backToText(); keepMarkBar(bar._ta, ...offsetsOf(bar)); }
          });
          ld.addEventListener("blur", () => { ld.value = (bar._ta.dataset.lead || 150) + "%"; });
        }
        const zv = bar.querySelector(".zv");
        zv.addEventListener("focus", () => { zv.value = zv.value.replace(/%$/, ""); zv.select(); });
        zv.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            const n = parseFloat(String(zv.value).replace(/[^\d.]/g, ""));
            if (!(n > 0)) return;
            backToText();
            applyMark("size=" + Math.round(n));
          } else if (e.key === "Escape") { e.preventDefault(); backToText(); keepMarkBar(bar._ta, ...offsetsOf(bar)); }
        });
        zv.addEventListener("blur", () => setTimeout(() => paintMarkState(), 0));
        markBar = bar;
        paintMarkState();
      }

      /* ---------- translation ---------- */
      /* A read-only view of a section in the language you read.

         It cannot reach the prompt, and that is structural rather than a
         promise kept by hand: compose() on the Python side reads text, title,
         on, slot and extMode, and nothing below writes to any of them. The
         translated text lives in this Map instead of on the section object,
         because save() serialises sections wholesale - parked on a section it
         would land in layout_json and get baked into the metadata of every
         PNG the workflow renders.

         Chrome's on-device Translator is used, so there is no key, no cost
         and no request leaving the machine - which is also what makes it
         cheap enough to re-run automatically as the text is edited. */
      const trCache = new Map();
      let trEngine = null, trEngineKey = "";

      const trHas = () => typeof Translator !== "undefined";

      /* ---- segmentation ----
         The text is cut into sentences before anything is translated, for two
         reasons. Sending the whole section as one blob came back as one wall
         of Korean with the paragraph breaks gone; and a sentence is the only
         unit that can be lined up across two languages afterwards, because a
         translator is free to reorder everything inside one.

         Every token carries the exact slice it came from and where it starts,
         so the concatenation of raw is the source text character for
         character - that is what lets a token be mapped back onto a range in
         the editable box without touching its markup. */
      /* Cut a sentence at its clause joints. A long FORMAT: line runs to forty
         words across half a dozen commas and dashes, and one highlight over
         the whole thing does not answer "which bit is that bit" - which is the
         only question this pane is here to answer. */
      const CLAUSE_RE = /[,;:]\s+|\s+[\u2014\u2013-]\s+/g;
      const CLAUSE_MIN = 14;          // shorter than this is a sliver, not a clause

      function trClauses(str, base, out) {
        const cuts = [];
        let last = 0, m;
        CLAUSE_RE.lastIndex = 0;
        while ((m = CLAUSE_RE.exec(str))) {
          const end = m.index + m[0].length;
          cuts.push([last, end]);
          last = end;
        }
        if (last < str.length) cuts.push([last, str.length]);
        /* Glue slivers onto the piece before them. "her face, the linen weave,
           the loafer leather" is three clauses; ", and" is not a fourth. */
        const kept = [];
        for (const [a, b] of cuts) {
          const prev = kept[kept.length - 1];
          if (prev && (b - a < CLAUSE_MIN || prev[1] - prev[0] < CLAUSE_MIN)) prev[1] = b;
          else kept.push([a, b]);
        }
        for (const [a, b] of kept) out.push({ kind: "s", raw: str.slice(a, b), at: base + a });
      }

      function trSentences(str, base, out, clause) {
        const take = (seg, at) => clause ? trClauses(seg, at, out)
                                         : out.push({ kind: "s", raw: seg, at });
        try {
          const seg = new Intl.Segmenter(undefined, { granularity: "sentence" });
          for (const p of seg.segment(str)) take(p.segment, base + p.index);
          return;
        } catch (e) { /* older engine - fall through */ }
        const re = /[.!?]+["')\]]*[ \t]+/g;
        let last = 0, m;
        while ((m = re.exec(str))) {
          const end = m.index + m[0].length;
          take(str.slice(last, end), base + last);
          last = end;
        }
        if (last < str.length) take(str.slice(last), base + last);
      }

      function trSplit(text) {
        const unit = state.trUnit || "sent";
        const tokens = [];
        const re = /\n[ \t]*\n\s*/g;          // a blank line ends a paragraph
        let last = 0, m;
        const piece = (str, base) => {
          /* a whole paragraph is one token, so the translator sees every
             sentence's neighbours and pronouns still point at something */
          if (unit === "para") tokens.push({ kind: "s", raw: str, at: base });
          else trSentences(str, base, tokens, unit === "clause");
        };
        while ((m = re.exec(text))) {
          piece(text.slice(last, m.index), last);
          tokens.push({ kind: "gap", raw: m[0], at: m.index });
          last = m.index + m[0].length;
        }
        piece(text.slice(last), last);
        /* whitespace-only pieces are structure, not content */
        for (const t of tokens) if (t.kind === "s" && !t.raw.trim()) t.kind = "gap";
        return tokens;
      }

      /* The source language is detected rather than assumed - a section can
         hold anything, and translating Korean as if it were English produces
         confident nonsense. Falls back to English when the detector is not
         there or is not sure. */
      async function trSourceOf(text) {
        try {
          if (typeof LanguageDetector === "undefined") return "en";
          const det = await LanguageDetector.create();
          const top = (await det.detect(text.slice(0, 400)))?.[0];
          return top && top.confidence > 0.35
            ? String(top.detectedLanguage).split("-")[0]
            : "en";
        } catch (e) { return "en"; }
      }

      async function trEngineFor(from, to, onLoad) {
        const key = `${from}>${to}`;
        if (trEngine && trEngineKey === key) return trEngine;
        const avail = await Translator.availability(
          { sourceLanguage: from, targetLanguage: to });
        if (avail === "unavailable") {
          throw new Error(`no ${trName(from)} to ${trName(to)} model available`);
        }
        const eng = await Translator.create({
          sourceLanguage: from, targetLanguage: to,
          monitor(m) {
            m.addEventListener("downloadprogress", e => onLoad?.(e.loaded));
          },
        });
        trEngine = eng; trEngineKey = key;
        return eng;
      }

      function trCell(s) {
        let c = trCache.get(s.id);
        if (!c) { c = { src: null, tokens: [], status: "idle", err: "" }; trCache.set(s.id, c); }
        return c;
      }

      const trSecEl = (s) => {
        const i = state.sections.indexOf(s);
        return i >= 0 ? list.children[i] : null;
      };

      function trBodyHtml(c) {
        return c.tokens.map((t, i) => t.kind === "gap"
          ? escapeHtml(t.raw)
          : `<span class="lvp-sent" data-si="${i}">${escapeHtml(t.out || "")}</span> `
        ).join("");
      }

      /* Repaint one pane in place. A render() here would tear the caret out of
         the box being typed into, which is the whole reason this exists. */
      function trPaint(s) {
        const body = trSecEl(s)?.querySelector(".lvp-tr-body");
        if (!body) return;
        const c = trCell(s);
        const behind = c.src !== sectionText(s).trim();
        body.classList.toggle("err", c.status === "error");
        body.classList.toggle("stale",
          c.status !== "error" && (behind || c.status === "working" || c.status === "load"));
        // The pane carries whatever direction the target language is written
        // in; the source box above it is left alone.
        const rtl = TR_RTL.has(String(state.trTo || "").split("-")[0]);
        body.dir = rtl ? "rtl" : "ltr";
        body.style.textAlign = rtl ? "right" : "";

        if (c.status === "error") { body.textContent = c.err; return; }
        if (c.status === "load") { body.textContent = `getting the language model - ${c.pct}%`; return; }
        if (!c.tokens.length) {
          body.textContent = c.status === "working" ? "translating..." : "";
          return;
        }
        body.innerHTML = trBodyHtml(c);
      }

      /* What the section is actually showing. A wired section keeps its own
         s.text untouched and displays what arrived on the input instead, so
         anything that reads a section has to ask for this rather than for
         s.text - the translate pane used to read s.text and so translated the
         empty local buffer while the incoming English sat right above it. */
      function sectionText(s) {
        if (extLinked(s)) {
          const inc = extTextFor(s);
          return typeof inc === "string" ? inc : "";
        }
        return s.text || "";
      }

      function trSchedule(s, delay) {
        const c = trCell(s);
        clearTimeout(c.timer);
        c.timer = setTimeout(() => trRun(s), delay == null ? 700 : delay);
      }

      async function trRun(s) {
        const c = trCell(s);
        const live = sectionText(s);
        const src = live.trim();
        /* one at a time per section - a second request while the first is out
           is remembered and run after it, so fast typing cannot pile up */
        if (c.status === "working" || c.status === "load") { c.again = true; return; }
        if (!src) { c.src = ""; c.tokens = []; c.status = "done"; trPaint(s); return; }
        if (c.status === "done" && c.src === src) { trPaint(s); return; }
        c.status = "working";
        c.tokens = trSplit(live);
        trPaint(s);
        try {
          if (!trHas()) {
            throw new Error("on-device translation needs Chrome or Edge 138+ on desktop");
          }
          const to = state.trTo || "en";
          const from = await trSourceOf(src);
          const eng = from === to ? null : await trEngineFor(from, to, (p) => {
            c.status = "load"; c.pct = Math.round((p || 0) * 100); trPaint(s);
          });
          c.status = "working";
          /* sentence at a time, painting as each one lands, so a long section
             fills in rather than sitting blank for several seconds */
          /* Sentence at a time, painting as each one lands, so a long section
             fills in rather than sitting blank for several seconds.

             The finished flag matters: an interrupted run used to fall through
             and set c.src anyway, so the restart it asked for looked up the
             cache, decided the text was already translated and returned. That
             is what left everything after the first paragraph blank. */
          let finished = true;
          for (const t of c.tokens) {
            if (t.kind !== "s") continue;
            const body = t.raw.trim();
            t.out = eng ? await eng.translate(body) : body;
            trPaint(s);
            if (c.again) { finished = false; break; }   // the text moved on
          }
          if (finished) { c.src = src; c.status = "done"; c.err = ""; }
          else { c.src = null; c.status = "idle"; }
        } catch (e) {
          c.status = "error";
          c.err = String(e?.message || e);
        }
        trPaint(s);
        if (c.again) { c.again = false; trRun(s); }
      }

      /* ---- sentence matching ----
         Hovering either side lights up the same sentence in both. The
         translation pane is ours, so its sentences are real spans. The English
         box is the user's contenteditable and must not be touched: wrapping
         its sentences in spans would end up in s.html and in the prompt. So it
         is painted with the CSS Custom Highlight API instead, which colours a
         Range without putting anything in the DOM. */
      /* The English side is painted with an overlay of plain divs positioned
         over the Range's client rects, rather than the CSS Custom Highlight
         API. The Highlight route registered without throwing and then simply
         drew nothing here, and it is not worth a feature that silently does
         half its job - rects are boring and they work everywhere.

         The overlay is a sibling of the box, never a child, so nothing is
         added inside the contenteditable and nothing can reach s.html. */
      function trClearHl(el) {
        const host = el || list;
        for (const h of host.querySelectorAll(".lvp-hl")) h.textContent = "";
      }

      function trPaintSrc(el, range) {
        const hl = el.querySelector(".lvp-hl");
        const ed = el.querySelector(".lvp-ed");
        if (!hl || !ed) return;
        hl.textContent = "";
        if (!range) return;
        const box = ed.getBoundingClientRect();
        /* the canvas scales the whole widget with a transform, so measured
           rects are in scaled pixels while the overlay is laid out in CSS
           pixels - divide the difference out or the bars drift with zoom */
        const scale = (ed.offsetWidth && box.width) ? box.width / ed.offsetWidth : 1;
        for (const q of range.getClientRects()) {
          if (!q.width || !q.height) continue;
          const bar = document.createElement("i");
          bar.style.left = `${(q.left - box.left) / scale}px`;
          bar.style.top = `${(q.top - box.top) / scale}px`;
          bar.style.width = `${q.width / scale}px`;
          bar.style.height = `${q.height / scale}px`;
          hl.appendChild(bar);
        }
      }

      /* offset in s.text -> a Range in the box. Mirrors htmlToText exactly:
         text nodes concatenated, a BR worth one newline. */
      function trRangeIn(ta, from, to) {
        let pos = 0, startNode = null, startOff = 0, out = null;
        (function walk(n) {
          for (const c of n.childNodes) {
            if (out) return;
            if (c.nodeType === 3) {
              const len = c.nodeValue.length;
              if (!startNode && pos + len > from) { startNode = c; startOff = from - pos; }
              if (startNode && pos + len >= to) {
                out = document.createRange();
                out.setStart(startNode, Math.max(0, startOff));
                out.setEnd(c, Math.max(0, to - pos));
                return;
              }
              pos += len;
            } else if (c.nodeType === 1) {
              if (c.tagName === "BR") pos += 1; else walk(c);
            }
          }
        })(ta);
        return out;
      }

      /* the reverse: a point on screen -> offset in s.text */
      function trOffsetAt(ta, x, y) {
        let node = null, off = 0;
        if (document.caretPositionFromPoint) {
          const p = document.caretPositionFromPoint(x, y);
          if (!p) return -1;
          node = p.offsetNode; off = p.offset;
        } else if (document.caretRangeFromPoint) {
          const r = document.caretRangeFromPoint(x, y);
          if (!r) return -1;
          node = r.startContainer; off = r.startOffset;
        } else return -1;
        if (!node || !ta.contains(node)) return -1;
        let pos = 0, found = -1;
        (function walk(n) {
          for (const c of n.childNodes) {
            if (found >= 0) return;
            if (c.nodeType === 3) {
              if (c === node) { found = pos + off; return; }
              pos += c.nodeValue.length;
            } else if (c.nodeType === 1) {
              if (c.tagName === "BR") pos += 1; else walk(c);
            }
          }
        })(ta);
        return found;
      }

      function trTokenAt(c, offset) {
        for (let i = 0; i < c.tokens.length; i++) {
          const t = c.tokens[i];
          if (t.kind !== "s") continue;
          if (offset >= t.at && offset < t.at + t.raw.length) return i;
        }
        return -1;
      }

      /* Light sentence i on both sides; -1 clears. Does nothing while the
         translation is behind the text, because the offsets it holds describe
         a version of the box that no longer exists. */
      /* Nudge a scroller just far enough to show a box that is off its edge.
         Rects are measured in scaled pixels and scrollTop is not, so the
         difference is divided back down before it is used. */
      function trReveal(scroller, rect) {
        const box = scroller.getBoundingClientRect();
        const scale = (scroller.clientHeight && box.height)
          ? box.height / scroller.clientHeight : 1;
        if (rect.top < box.top) {
          scroller.scrollTop += (rect.top - box.top) / scale - 6;
        } else if (rect.bottom > box.bottom) {
          scroller.scrollTop += (rect.bottom - box.bottom) / scale + 6;
        }
      }

      /* Light sentence i on both sides; -1 clears. "from" says which pane the
         pointer is in, so the OTHER one is scrolled into view - moving the
         pane under the cursor would just chase the pointer around. */
      function trFocus(s, i, from) {
        const el = trSecEl(s);
        if (!el) return;
        const c = trCell(s);
        c.hover = i;
        const body = el.querySelector(".lvp-tr-body");
        const ta = el.querySelector(".lvp-ta");
        const t = i >= 0 ? c.tokens[i] : null;
        /* the offsets describe the text as it was translated - once the box
           has moved on they point at nothing in particular */
        const stale = c.src !== sectionText(s).trim();

        if (body) {
          const was = body.querySelector(".lvp-sent.on");
          if (was) was.classList.remove("on");
          const hit = i >= 0 ? body.querySelector(`.lvp-sent[data-si="${i}"]`) : null;
          if (hit) {
            hit.classList.add("on");
            if (from === "src") trReveal(body, hit.getBoundingClientRect());
          }
        }

        if (!t || !ta || stale) { trPaintSrc(el, null); return; }
        const r = trRangeIn(ta, t.at, t.at + t.raw.replace(/\s+$/, "").length);
        /* scroll first, then measure - the rects move with the scroll */
        if (r && from === "tr") {
          const q = r.getClientRects()[0];
          if (q) trReveal(ta, q);
        }
        trPaintSrc(el, r);
      }

      /* ---------- render ---------- */
      function render() {
        /* The Book has no per-section sockets: what leaves it is the whole
           series, on one wire. */
        if (!BOOK) {
          compactSlots();
          syncInputs();
          syncOutputs();
        } else {
          paintBook();
        }
        /* a deleted section must not leave its translation behind */
        const live = new Set(state.sections.map(x => x.id));
        for (const k of Array.from(trCache.keys())) {
          if (!live.has(k)) trCache.delete(k);
        }
        hideMarkBar();
        /* the previous pass's buttons are about to be thrown away; their
           listeners would otherwise pile up on every render */
        (node._lvaBusyOff || []).forEach(off => off());
        node._lvaBusyOff = [];
        list.innerHTML = "";
        state.sections.forEach((s, i) => {
          const linked = extLinked(s);
          /* the box is dead weight when an input replaces it, or when bypassed */
          const locked = !s.on || (linked && s.extMode === "replace");
          const note = !s.on ? "bypassed - this section is left out of the prompt"
                     : (linked && s.extMode === "replace")
                       ? "the wired text is used as-is - anything typed here is ignored"
                       : (linked && s.extMode === "append")
                         ? "typed text first, then the wired text"
                         : (linked && s.extMode === "prepend")
                           ? "wired text first, then what you type" : "";

          /* Show the text coming down the wire, laid out in the order it will
             appear in the output - so the panel reads like the final string. */
          const incoming = linked ? extTextFor(s) : null;
          const extBox = (h) => `
            <div class="lvp-ext" style="height:${h}px">
              <div class="lvp-ext-tag">from input</div>
              <div class="lvp-ext-body">${incoming === null
                ? `<span class="lvp-ext-wait">run once to see the incoming text</span>`
                : escapeHtml(incoming)}</div>
            </div>`;
          const editBox = (h) => `
            <div class="lvp-ed" style="height:${h}px">
              <div class="lvp-ta" spellcheck="false"
                   contenteditable="${s.on ? "true" : "false"}"></div>
              <div class="lvp-hl"></div>
            </div>`;
          const trBox = (h) => `
            <div class="lvp-trdiv" title="Drag to change how the box and the translation share this section"></div>
            <div class="lvp-tr" style="height:${h}px">
              <div class="lvp-tr-head">
                <span class="lvp-tr-note" title="This pane is never saved with the layout and never reaches the model">reading only</span>
                <select class="lvp-tr-unit" title="How the text is cut up before translating. Paragraph reads best; Clause matches most precisely">
                  ${TR_UNITS.map(([c, n]) =>
                    `<option value="${c}"${(state.trUnit || "sent") === c ? " selected" : ""}>${n}</option>`
                  ).join("")}
                </select>
                <select class="lvp-tr-lang" title="Translate into - applies to every section">
                  ${TR_LANGS.map(([c, n]) =>
                    `<option value="${c}"${(state.trTo || "en") === c ? " selected" : ""}>${n}</option>`
                  ).join("")}
                </select>
              </div>
              <div class="lvp-tr-body"></div>
            </div>`;

          /* One chip per section, lit when this picture will fill it. The
             section holding the picture starts as the only lit one, so a
             single press behaves exactly as it always did. */
          const targetChips = (sec) => {
            const want = new Set(readTargetsOf(sec, state.sections).map(x => x.id));
            return state.sections.map((x) => {
              const key = x.q || questionFor(x.title);
              const lit = want.has(x.id);
              const label = key === "custom" ? "own question"
                : ((VLM.questions[key] || {}).label || key);
              return `<button class="lvr-t${lit ? " on" : ""}" data-id="${x.id}"`
                + ` title="${escapeHtml(x.title)} - asks its own question: `
                + `${escapeHtml(label)}. Chosen sections are overwritten.">`
                + `${escapeHtml(x.title)}</button>`;
            }).join("");
          };

          const imgBox = () => {
            const chosen = s.q || questionFor(s.title);
            /* "Read only" is said once, above the layers, instead of once inside
               each of them. The heading carries the restriction for everything
               under it, and what does not belong under it - the whole picture,
               a question of your own - sits outside the group and is visibly
               a different kind of thing. */
            const opt = (k, v) =>
              `<option value="${k}"${k === chosen ? " selected" : ""}>${escapeHtml(v.label)}</option>`;
            const inGroup = LAYER_ORDER.filter(k => VLM.questions[k]);
            const rest = Object.keys(VLM.questions).filter(k => !inGroup.includes(k));
            const opts =
              (inGroup.length
                ? `<optgroup label="Read only">`
                  + inGroup.map(k => opt(k, VLM.questions[k])).join("")
                  + `</optgroup>`
                : "")
              + rest.map(k => opt(k, VLM.questions[k])).join("")
              + `<option value="custom"${chosen === "custom" ? " selected" : ""}>Custom…</option>`;
            /* And once more on the picture. The eye is on the photograph, not
               on the control row above it, so the scope is stated where the
               looking actually happens - the way a contact sheet is annotated
               rather than the way a form is labelled. */
            const scopeKey = s.q || questionFor(s.title);
            const scopeName = { quality: "quality", subject: "subject",
                                pose: "pose", scene: "scene", camera: "camera",
                                all: "whole picture" }[scopeKey];
            const badge = s.img && scopeName
              ? `<span class="lvr-badge">${layerGlyph(scopeKey)}`
                + `<b>${escapeHtml(scopeName)}</b></span>`
              : "";
            const thumb = s.img
              ? `<img src="${imgUrl(s.img)}" alt="">${badge}`
              : `drop or paste an image here<br>or click to choose`;
            /* one axis is fixed and the other follows the section: down the
               page in ROW mode, across it in SIDE mode */
            const geom = s.imgSide
              ? `width:${imgSideWidth(s)}px`
              : `height:${stripHeight(s)}px`;
            return `
            <div class="lvr-img" style="${geom}">
              <div class="lvr-bar">
                <span class="lvr-layers" title="${escapeHtml(layerTitle(s))}"
                  >${layerGlyph(s.q || questionFor(s.title))}</span>
                <select class="lvr-q" title="Reads only this layer of the picture and ignores the rest - the section's name picks it, and you can change it here">${opts}</select>
                <button class="lvr-read"${s.img && !readRun ? "" : " disabled"}>${
                  readRun && readRun.owner === s.id
                    ? `${readRun.i} / ${readRun.n}` : "Read"}</button>
                ${readRun && readRun.owner === s.id
                  ? `<button class="lvr-stop" title="Stop after the reading that is running">Stop</button>`
                  : ""}
                <button class="lvr-lay${s.imgSide ? "" : " on"}" data-side="0"
                  title="Picture above the text">${ICON_ROW}</button>
                <button class="lvr-lay${s.imgSide ? " on" : ""}" data-side="1"
                  title="Picture beside the text">${ICON_SIDE}</button>
                ${s.img ? `<button class="lvr-x" title="Take the image out">&#10005;</button>` : ""}
                <span class="lvr-note"></span>
              </div>
              ${s.img ? `<div class="lvr-targets">
                <span class="lvr-tlab">read into</span>
                ${targetChips(s)}
              </div>` : ""}
              ${chosen === "custom"
                ? `<textarea class="lvr-custom" spellcheck="false" placeholder="What should it describe?">${escapeHtml(s.qText || "")}</textarea>`
                : ""}
              <div class="lvr-stage">
                <div class="lvr-drop" title="${s.img ? "Click to replace" : "Click to choose an image"}">${thumb}</div>
              </div>
            </div>
            <div class="lvr-grip" title="Drag to resize the picture"></div>`;
          };

          const split = paneSplit(s, linked);
          let extPane;
          /* The translation pane belongs to every branch, not just the
             unwired one. It used to be built only in the else, so on a wired
             section the TR switch lit up and nothing appeared: there was no
             pane in the markup for the text to be painted into. */
          const trPane = s.tr ? trBox(split.tr) : "";
          if (linked && s.extMode === "replace") {
            extPane = extBox(split.ext) + trPane;         // the box is ignored
          } else if (linked && (s.extMode === "prepend" || s.extMode === "append")) {
            extPane = (s.extMode === "prepend"
              ? extBox(split.ext) + editBox(split.edit)
              : editBox(split.edit) + extBox(split.ext)) + trPane;
          } else {
            extPane = editBox(split.edit) + trPane;
          }
          /* above the box: the picture is what you are reading from, and the
             text it produces belongs underneath it */
          if (s.imgOpen) {
            extPane = `<div class="lvp-body${s.imgSide ? " side" : ""}">`
                    + imgBox()
                    + `<div class="lvp-panes">${extPane}</div></div>`;
          }

          const el = document.createElement("div");
          el.className = "lvp-sec" + (s.on ? "" : " off") +
                         (s.collapsed ? " collapsed" : "") +
                         (s.on && !linked && s.color && !BOOK ? " k" + s.color : "") +
                         /* in the Book an anchor wears its kind's colour, the
                            same as its capsule on the shelf */
                         (s.on && !linked && BOOK ? " kd" : "") +
                         (s.on && linked ? " ext-" + s.extMode : "");
          el.style.height = s.collapsed
            ? `${HEADER_H}px`
            : `${HEADER_H + s.h + 6 + (note ? 15 : 0) + imgBlock(s)}px`;
          el.style.flex = "0 0 auto";
          if (BOOK) el.style.setProperty("--kc", KIND_HUE[kindOf(s.title)] || KIND_HUE.other);

          el.innerHTML = `
            <div class="lvp-head">
              <div class="lvp-tog ${s.on ? "on" : "byp"}"
                   title="${s.on ? "Click to bypass this section" : "Bypassed - click to enable"}"
                   >B</div>
              <div class="lvp-imgb imgb${s.imgOpen ? " on" : ""}"
                   title="Read a reference image into this section"
                   >IMG</div>
              <div class="lvp-trb trb${s.tr ? " on" : ""}"
                   title="${linked
                     ? "Read the incoming text in another language. The translation is never saved and never reaches the model"
                     : "Read this section in another language. The translation is never saved and never reaches the model"}"
                   >TR</div>
              <span class="lvp-caret" title="${s.collapsed ? "Expand this section" : "Collapse this section"}"
                    >${s.collapsed ? "&#9654;" : "&#9660;"}</span>
              <span class="lvp-swatch" title="Section colour">&#9679;</span>
              <input class="t" value="${escapeHtml(s.title)}" spellcheck="false"
                     ${s.on ? "" : "disabled"}>
              ${BOOK ? sharedBadge(s) : ""}
              ${BOOK ? `<span class="lsb-var" title="Make a variant: keep this capsule as it is and go on editing a copy of it - another pose, another camera, for the same scene">+ variant</span>` : ""}
              <span style="flex:1"></span>
              ${!s.on ? `<span class="lvp-badge" style="border-color:#a363a3;color:#c79ac7">BYPASSED</span>` : ""}
              ${s.on && linked ? `<span class="lvp-badge m-${s.extMode}"
                 title="Click to change how the connected input combines with this box"
                 >ext: ${s.extMode}</span>` : ""}
              <span class="lvp-cnt">${(s.text || "").length}</span>
              <span class="lvp-mini ico fit1" title="Fit this section to its text"
                    >${ICON_FIT}</span>
              <span class="lvp-mini ico clr" title="Clear this section's text"
                    >${ICON_CLEAR}</span>
              <span class="lvp-mini ico dup" title="Duplicate section"
                    >${ICON_DUP}</span>
              <span class="lvp-mini ico up" title="Move up">${ICON_UP}</span>
              <span class="lvp-mini ico down" title="Move down">${ICON_DOWN}</span>
              <span class="lvp-mini ico del" title="Delete section">${ICON_DEL}</span>
              <span class="lvp-bar-sep"></span>
              <button class="lvp-tiny snip" title="Snippet library - add a saved phrase to what is already here">SNIP</button>
              <button class="lvp-tiny pre" title="Preset library for this section">PRESET</button>
            </div>
            ${extPane}
            ${note ? `<div class="lvp-note">${escapeHtml(note)}</div>` : ""}
            <div class="lvp-grip" title="Drag to resize this section - the node grows and shrinks with it.&#10;Hold Shift to keep the node the same size and trade height with the section below instead."></div>`;

          const ta = el.querySelector(".lvp-ta");
          if (ta) {
          ta.classList.toggle("plain", !state.fx);
          /* A layout saved before this was fixed can still hold CRLF. Clean it
             once, on the way to the screen, so the stored string and the
             characters on screen count the same. */
          if (s.text && s.text.indexOf("\r") >= 0) s.text = normalizeText(s.text);
          ta.innerHTML = s.html ? sanitizeMarkup(s.html) : textToHtml(s.text);

          const cntEl = el.querySelector(".lvp-cnt");
          const pull = () => {
            s.text = normalizeText(htmlToText(ta));
            s.html = sanitizeMarkup(ta.innerHTML);
            touch(); save(); updateFoot();
            if (cntEl) cntEl.textContent = s.text.length;
            /* the pane dims the moment the text moves ahead of it, then
               catches up once the typing stops */
            if (s.tr) { trClearHl(); trPaint(s); trSchedule(s); }
          };
          ta.addEventListener("input", pull);

          /* Enter and paste are handled by hand so the content stays a flat run
             of text and marks - no stray divs, no pasted styling. */
          ta.addEventListener("keydown", (e) => {
            e.stopPropagation();
            if (e.key === "Enter") {
              e.preventDefault();
              insertPlain("\n");
              pull();
            }
          });
          ["keyup", "keypress"].forEach(k =>
            ta.addEventListener(k, e => e.stopPropagation()));
          /* Paste from another section keeps its marks; paste from anywhere
             else is flattened. The HTML flavour of the clipboard is only
             trusted when it carries our own classes and nothing more, which is
             exactly what sanitizeMarkup checks for. */
          ta.addEventListener("paste", (e) => {
            e.preventDefault();
            const cb = e.clipboardData || window.clipboardData;
            const html = cb.getData("text/html");
            const plain = cb.getData("text");

            if (html && insertMarked(html, plain)) { pull(); return; }
            insertPlain(String(plain || "").replace(/\r\n/g, "\n"));
            pull();
          });
          ta.addEventListener("pointerdown", e => e.stopPropagation());
          ta.addEventListener("mouseup", () => {
            /* The brush owns the pointer while it is loaded, so a drag stamps
               formatting instead of raising the palette. */
            if (brushMode !== "off") {
              const sel = window.getSelection();
              if (sel && sel.rangeCount && ta.contains(sel.getRangeAt(0).commonAncestorContainer)) {
                let [a, b] = rangeOffsets(ta, sel.getRangeAt(0));
                if (b < a) [a, b] = [b, a];
                if (brushMode === "pick") { brushPick(ta, a, b); return; }
                if (b > a) { brushApply(ta, a, b); return; }
              }
              return;
            }
            showMarkBar(ta);
          });
          ta.addEventListener("blur", () => setTimeout(() => {
            if (markBar && markBar.matches(":hover")) return;   // clicking the bar
            if (markBar && markBar.contains(document.activeElement)) return;
            hideMarkBar();
          }, 200));
          }

          const ti = el.querySelector("input.t");
          /* The title names an output port as well as an input, so both sides
             have to move together. This used to call syncInputs only, which
             left the output port showing the previous title until some other
             action happened to trigger a render - the one-step lag. */
          const commitTitle = () => {
            if (s.title === ti.value) return;
            s.title = ti.value;
            touch(); save();
            syncInputs(); syncOutputs();
            node.setDirtyCanvas(true, true);
          };
          ti.addEventListener("input", commitTitle);
          /* An IME holds the last syllable back until the composition closes,
             so Korean titles need this to land the final character. */
          ti.addEventListener("compositionend", commitTitle);
          ti.addEventListener("change", commitTitle);
          ti.addEventListener("dblclick", e => e.stopPropagation());
          ["keydown", "keyup", "keypress"].forEach(k =>
            ti.addEventListener(k, e => e.stopPropagation()));
          /* Enter commits and leaves the field; Escape puts the old title back.
             Neither did anything before - the key was swallowed on its way to
             the canvas and never handled here. */
          ti.addEventListener("keydown", (e) => {
            if (e.isComposing || e.keyCode === 229) return;   // IME still going
            if (e.key === "Enter") {
              e.preventDefault();
              commitTitle();
              ti.blur();
            } else if (e.key === "Escape") {
              e.preventDefault();
              ti.value = s.title;
              ti.blur();
            }
          });
          ti.addEventListener("pointerdown", e => e.stopPropagation());

          el.querySelector(".lvp-tog").addEventListener("click", () => {
            s.on = !s.on; touch(); render(); save();
          });
          el.querySelector(".lvp-swatch").addEventListener("click", () => {
            s.color = ((s.color || 0) + 1) % 7;      // 0 = no colour
            touch(); render(); save();
          });
          el.querySelector(".lsb-var")?.addEventListener("click", (e) => {
            e.stopPropagation();
            makeVariant(s);
          });

          const imgb = el.querySelector(".imgb");
          if (imgb) {
            imgb.addEventListener("click", () => {
              s.imgOpen = !s.imgOpen;
              if (s.imgOpen && !s.q) s.q = questionFor(s.title);
              touch(); render(); save();
            });
          }

          if (s.imgOpen) {
            const drop = el.querySelector(".lvr-drop");
            const qSel = el.querySelector(".lvr-q");
            const readBtn = el.querySelector(".lvr-read");
            const noteEl = el.querySelector(".lvr-note");
            const custom = el.querySelector(".lvr-custom");
            const xBtn = el.querySelector(".lvr-x");

            const say = (msg, kind) => {
              if (!noteEl) return;
              noteEl.className = "lvr-note" + (kind ? " " + kind : "");
              noteEl.textContent = msg;
            };
            if (noteEl && VLM.problem) say(VLM.problem, "err");

            const take = async (file) => {
              if (!file || !/^image\//.test(file.type)) return;
              try {
                say("uploading…", "busy");
                s.img = await uploadImage(file);
                const m = await measureImage(imgUrl(s.img), list.clientWidth || 400);
                s.imgAR = m.ar;
                s.imgH = m.h;
                /* Portrait goes beside the text, landscape above it - but only
                   until the button is pressed, after which the section keeps
                   what was asked for no matter what is dropped on it next. */
                if (!s.imgLayLock) s.imgSide = m.ar < 0.9;
                if (s.imgSide) {
                  /* Beside the text the picture is as tall as the box. An
                     empty box is a few lines high, which made a portrait a
                     sliver nobody could see - so the box is opened to a size
                     the picture can be read at, and only ever grows here. */
                  const want = Math.min(SIDE_FIRST_H, Math.max(160, m.h || SIDE_FIRST_H));
                  s.h = Math.max(s.h, want + SIDE_CHROME_Y + customExtra(s) - 6);
                  s.imgW = sideWidthFor(s, s.h + 6);
                }
                touch(); render(); save();
                fitNodeToContent();
              } catch (err) {
                say(String(err.message || err), "err");
              }
            };

            drop.addEventListener("click", () => {
              const input = document.createElement("input");
              input.type = "file";
              input.accept = "image/*";
              input.addEventListener("change", () => take(input.files[0]));
              input.click();
            });
            /* A screenshot in the clipboard is the same thing as a dropped
               file once it is out of the clipboard, so it goes down the same
               path - upload, measure, choose an arrangement. */
            const claim = () => { PASTE.last = { el: drop, take, say, drop }; };
            drop.addEventListener("pointerenter", () => {
              PASTE.hover = { el: drop, take, say, drop };
            });
            drop.addEventListener("pointerleave", () => {
              if (PASTE.hover && PASTE.hover.el === drop) PASTE.hover = null;
            });
            drop.addEventListener("pointerdown", claim);

            ["dragenter", "dragover"].forEach(k =>
              drop.addEventListener(k, (e) => {
                e.preventDefault(); e.stopPropagation();
                drop.classList.add("over");
              }));
            ["dragleave", "dragend"].forEach(k =>
              drop.addEventListener(k, () => drop.classList.remove("over")));
            drop.addEventListener("drop", (e) => {
              e.preventDefault(); e.stopPropagation();
              drop.classList.remove("over");
              take(e.dataTransfer && e.dataTransfer.files[0]);
            });

            if (xBtn) xBtn.addEventListener("click", () => {
              /* The strip was measured for a particular picture - a tall
                 portrait can push it to 560px. Taking the picture out used to
                 leave that height behind, so an empty strip sat there at the
                 size of something that is no longer in it and crushed the
                 writing box underneath. Back to the default until there is
                 another picture to measure. */
              s.img = null;
              s.imgH = IMG_H;
              s.imgAR = 0;
              s.imgW = IMG_SIDE_W;
              touch(); render(); save();
            });

            el.querySelectorAll(".lvr-lay").forEach((layBtn) => {
              layBtn.addEventListener("pointerdown", e => e.stopPropagation());
              layBtn.addEventListener("click", (ev) => {
                ev.stopPropagation();
                const wantSide = layBtn.dataset.side === "1";
                if (wantSide === !!s.imgSide) return;      // already there
                s.imgSide = wantSide;
                /* an explicit choice, so dropping another picture in must not
                   quietly move it back */
                s.imgLayLock = true;
                if (s.imgSide) {
                  /* the strip's own height becomes the body's height, so the
                     picture comes out of the move about the size it went in */
                  s.h = Math.max(s.h, stripHeight(s) - 6);
                  s.imgW = sideWidthFor(s, s.h + 6);
                }
                touch(); render(); save();
              });
            });

            qSel.addEventListener("change", () => {
              s.q = qSel.value; touch(); render(); save();
            });
            qSel.addEventListener("pointerdown", e => e.stopPropagation());

            if (custom) {
              custom.addEventListener("input", () => { s.qText = custom.value; save(); });
              ["keydown", "keyup", "keypress", "pointerdown"].forEach(k =>
                custom.addEventListener(k, e => e.stopPropagation()));
            }

            const igrip = el.querySelector(".lvr-grip");
            if (igrip) igrip.addEventListener("pointerdown", (e) => {
              e.preventDefault(); e.stopPropagation();
              /* the grip is under the picture in ROW mode and beside it in
                 SIDE mode, so it drags down the page or across it */
              const side = !!s.imgSide;
              const startY = side ? e.clientX : e.clientY;
              const startH = side ? imgSideWidth(s)
                                  : Math.max(IMG_MIN, s.imgH || IMG_H);
              const zoom = uiScale(igrip);
              gripDragging = true;
              igrip.setPointerCapture(e.pointerId);
              const move = (ev) => {
                const moved = ((side ? ev.clientX : ev.clientY) - startY) / zoom;
                if (side) s.imgW = Math.max(IMG_SIDE_MIN,
                                            Math.min(IMG_SIDE_MAX, startH + moved));
                else s.imgH = Math.max(IMG_MIN, startH + moved);
                renderHeights();
                fitNodeToContent();
              };
              const up = () => {
                gripDragging = false;
                igrip.releasePointerCapture(e.pointerId);
                igrip.removeEventListener("pointermove", move);
                igrip.removeEventListener("pointerup", up);
                fitNodeToContent(); touch(); save();
              };
              igrip.addEventListener("pointermove", move);
              igrip.addEventListener("pointerup", up);
            });

            /* Greyed out while ComfyUI is working, and back on its own the
               moment the queue empties - nobody should have to remember to
               come back and re-enable it. The "reading" flag keeps the two
               reasons for being disabled from undoing each other. */
            let reading = false;
            const setReadState = () => {
              if (!readBtn) return;
              const blocked = BUSY.on && !reading && !readRun;
              readBtn.disabled = reading || BUSY.on || !s.img || !!readRun;
              /* The note under the strip carries the same word, but a tall
                 picture pushes it out of sight - so the button says it too. */
              readBtn.textContent = readRun && readRun.owner === s.id
                ? `${readRun.i} / ${readRun.n}`
                : (reading ? "Reading" : "Read");
              readBtn.classList.toggle("waiting", blocked);
              readBtn.title = blocked
                ? "ComfyUI is rendering - reading now would run the card out of "
                  + "memory. This comes back when the queue is done."
                : "";
              if (blocked) say("waiting for the render to finish", "busy");
              else if (noteEl && noteEl.textContent
                       === "waiting for the render to finish") say("");
            };
            setReadState();
            BUSY.listeners.add(setReadState);
            /* the listener outlives the button unless it is taken off the set */
            (node._lvaBusyOff || (node._lvaBusyOff = [])).push(
              () => BUSY.listeners.delete(setReadState));

            /* The chips decide where the answers land. Stored on the section
               that holds the picture, so a workflow reopens with the same
               targets it was designed with. */
            for (const chip of el.querySelectorAll(".lvr-t")) {
              chip.addEventListener("click", () => {
                if (readRun) return;
                const id = Number(chip.dataset.id);
                const have = new Set(readTargetsOf(s, state.sections).map(x => x.id));
                if (have.has(id)) have.delete(id); else have.add(id);
                /* kept in section order so the reading runs top to bottom */
                s.readTo = state.sections.filter(x => have.has(x.id)).map(x => x.id);
                touch(); render(); save();
              });
            }

            const stopBtn = el.querySelector(".lvr-stop");
            if (stopBtn) {
              stopBtn.addEventListener("click", () => {
                if (!readRun) return;
                readRun.stop = true;
                say("stopping after this one…", "busy");
              });
            }

            /* Re-announced on every render: the run survives the rebuild, so
               the new note has to be told where the run got to. */
            if (readRun && readRun.owner === s.id) {
              say(`reading ${readRun.i} / ${readRun.n} - ${readRun.title}`, "busy");
            } else if (readNote && readNote.owner === s.id) {
              say(readNote.msg, readNote.kind);
            }

            readBtn.addEventListener("click", async () => {
              if (!s.img || BUSY.on || readRun) return;

              const jobs = [];
              for (const x of readTargetsOf(s, state.sections)) {
                const question = questionOf(x);
                if (!question) {
                  say(`${x.title} has no question to ask.`, "err");
                  return;
                }
                jobs.push({ sec: x, question });
              }

              readNote = null;
              readRun = { owner: s.id, i: 1, n: jobs.length,
                          title: jobs[0].sec.title, stop: false };
              render();
              let failed = "";
              try {
                for (let i = 0; i < jobs.length; i++) {
                  const { sec, question } = jobs[i];
                  readRun.i = i + 1;
                  readRun.title = sec.title;
                  render();
                  const text = await readImage(s.img, question, readerSettings());
                  if (!text) { failed = `${sec.title}: the reader returned nothing.`; }
                  else {
                    sec.text = normalizeText(text);
                    sec.html = escapeHtml(sec.text);
                    /* a section filling itself in should be seen doing it -
                       reading a picture is how a series gets designed, and a
                       collapsed section hides the one thing worth watching */
                    sec.collapsed = false;
                    touch(); save(); updateFoot();
                  }
                  if (readRun.stop && i < jobs.length - 1) {
                    failed = "stopped";
                    break;
                  }
                  render();
                }
              } catch (err) {
                failed = String(err.message || err);
              } finally {
                readRun = null;
                render();
              }
              if (failed) {
                readNote = { owner: s.id, msg: failed, kind: "err" };
                render();
              }
            });
          }

          const trb = el.querySelector(".trb");
          if (trb) {
            trb.addEventListener("click", () => {
              /* Measured before the toggle, while the panes are still laid
                 out the way the user is looking at them. */
              const linked = !!el.querySelector(".lvp-ext");
              const edEl = el.querySelector(".lvp-ed");
              const edH = edEl ? Math.round(edEl.offsetHeight) : null;
              const boxNeed = linked ? null : paneNeed(el.querySelector(".lvp-ta"));

              s.tr = !s.tr;
              if (s.tr) {
                s.trH = Math.min(360, Math.max(TR_MIN,
                  s.trH || Math.min(300, Math.round(s.h * 0.6))));
                /* The section used to GROW by the whole pane every time. That
                   was right when the box was full - carving the pane out of
                   the existing height cut the English down to a few lines -
                   and wrong whenever the box had room to spare, which is most
                   readings: a four-sentence answer in a box sized for twelve
                   pushed the node taller for no reason, and the height had to
                   be dragged back by hand afterwards.
                   So grow by what the box cannot spare, and nothing more. The
                   box keeps exactly the height its text needs; the pane takes
                   the slack first and asks for new height only once the slack
                   runs out. An empty-ish box grows by nothing, a full one
                   still grows by the whole pane, and everything between lands
                   in between. Same arithmetic FIT uses, so opening a
                   translation on a full box now settles where FIT would put
                   it.
                   A wired section keeps the old behaviour: its height is
                   shared between two panes by a rule of its own, and one
                   measurement of the box does not describe it. */
                if (boxNeed === null) {
                  s.h += s.trH + 4;
                } else {
                  s.h = Math.max(s.h, Math.max(MIN_H, boxNeed) + s.trH + 4);
                }
              } else if (s.trH) {
                /* Hand back whatever the pane was using and not a pixel of the
                   box. Taken from the box's own measured height rather than by
                   subtracting trH, because the section grip moves trH while
                   the pane is open - subtracting it then returns a different
                   height than the one the box has been sitting at. */
                s.h = (!linked && edH !== null)
                  ? Math.max(MIN_H, edH)
                  : Math.max(MIN_H, s.h - (s.trH + 4));
              }
              touch();
              /* Started before render, not after. trRun marks the cell working
                 synchronously, so render's own catch-up scheduler sees a run
                 already going and stays out of the way - two runs racing is
                 what interrupted the first one a sentence or two in.
                 Still called straight off the click, because the first use may
                 have to fetch a language model and Chrome only allows that on
                 a user gesture. */
              if (s.tr) trRun(s);
              render(); save();
            });
          }

          /* Both dropdowns invalidate every cached translation - one changes
             the language it is in, the other changes what a token even is. */
          const trReset = (dropEngine) => {
            if (dropEngine) { trEngine = null; trEngineKey = ""; }
            for (const c of trCache.values()) {
              c.src = null; c.tokens = []; c.status = "idle";
            }
            touch();
            for (const x of state.sections) if (x.tr) trRun(x);
            render(); save();
          };
          const trStopBubble = (sel) => {
            for (const ev of ["pointerdown", "mousedown", "click", "wheel", "keydown"]) {
              sel.addEventListener(ev, e => e.stopPropagation());
            }
          };

          const trLang = el.querySelector(".lvp-tr-lang");
          if (trLang) {
            trStopBubble(trLang);
            trLang.addEventListener("change", () => {
              state.trTo = trLang.value;
              trReset(true);
            });
          }

          const trUnit = el.querySelector(".lvp-tr-unit");
          if (trUnit) {
            trStopBubble(trUnit);
            trUnit.addEventListener("change", () => {
              state.trUnit = trUnit.value;
              trReset(false);
            });
          }

          /* Hovering either pane lights the matching sentence in the other. */
          const trBody = el.querySelector(".lvp-tr-body");
          if (trBody) {
            let lastTr = -2;
            trBody.addEventListener("mousemove", (e) => {
              const hit = e.target.closest?.(".lvp-sent");
              const i = hit ? parseInt(hit.dataset.si, 10) : -1;
              if (i === lastTr) return;
              lastTr = i;
              trFocus(s, i, "tr");
            });
            trBody.addEventListener("mouseleave", () => { lastTr = -2; trFocus(s, -1); });
            trBody.addEventListener("pointerdown", e => e.stopPropagation());
            trBody.addEventListener("wheel", e => e.stopPropagation());
          }
          if (ta && s.tr) {
            let lastHover = -2;
            ta.addEventListener("mousemove", (e) => {
              const c = trCell(s);
              if (!c.tokens.length) return;
              const off = trOffsetAt(ta, e.clientX, e.clientY);
              const i = off < 0 ? -1 : trTokenAt(c, off);
              if (i === lastHover) return;         // only repaint when it moves
              lastHover = i;
              trFocus(s, i, "src");
            });
            ta.addEventListener("mouseleave", () => { lastHover = -2; trFocus(s, -1); });
            /* the bars are drawn at absolute positions, so they have to be
               redrawn when the text slides under them rather than cleared */
            ta.addEventListener("scroll", () => {
              const c = trCell(s);
              if (c.hover >= 0) trFocus(s, c.hover);
            });
          }

          const trDiv = el.querySelector(".lvp-trdiv");
          if (trDiv) {
            trDiv.addEventListener("pointerdown", (e) => {
              e.preventDefault(); e.stopPropagation();
              const startY = e.clientY;
              const startTr = paneSplit(s, false).tr;
              const zoom = uiScale(trDiv);
              gripDragging = true;
              trDiv.setPointerCapture(e.pointerId);
              /* this divider only moves the line inside the section - the
                 section keeps its height, so the node never moves */
              const move = (ev) => {
                const want = startTr - (ev.clientY - startY) / zoom;
                s.trH = Math.round(Math.min(Math.max(TR_MIN, want),
                                             s.h - 4 - trEditFloor(s.h)));
                renderHeights();
              };
              const up = () => {
                gripDragging = false;
                trDiv.releasePointerCapture(e.pointerId);
                trDiv.removeEventListener("pointermove", move);
                trDiv.removeEventListener("pointerup", up);
                touch(); save();
              };
              trDiv.addEventListener("pointermove", move);
              trDiv.addEventListener("pointerup", up);
            });
          }
          el.querySelector(".pre").addEventListener("click", () => openPresets(s, el));
          el.querySelector(".snip")?.addEventListener("click", () => openSnips(s, el));
          el.querySelector(".lvp-caret").addEventListener("click", () => {
            s.collapsed = !s.collapsed; touch(); render(); save();
          });
          /* Empty this box and nothing else. The picture, the colour, the
             title and the height all stay - it is the writing that is being
             thrown away, and usually to write something else in its place. */
          el.querySelector(".clr").addEventListener("click", () => {
            if (!(s.text || "").length && !(s.html || "").length) return;
            s.text = "";
            s.html = "";
            touch(); render(); save();
          });

          /* The toolbar's Fit, aimed at one section. Useful because the
             toolbar one moves every section at once, and most of the time only
             the one just written into is the wrong height. */
          el.querySelector(".fit1").addEventListener("click", () => {
            if (s.collapsed) return;
            s.h = fitNeed(s, el);
            delete s.prevH;
            touch();
            fitNodeToContent();
            render();
            save();
          });

          el.querySelector(".dup").addEventListener("click", () => {
            if (state.sections.length >= MAX_SLOTS) return;
            const copy = JSON.parse(JSON.stringify(s));
            copy.id = nextId(); copy.slot = 0;
            copy.title = s.title + " copy";
            state.sections.splice(i + 1, 0, copy);
            assignSlots(); touch(); render(); save();
          });
          el.querySelector(".up").addEventListener("click", () => move(i, -1));
          el.querySelector(".down").addEventListener("click", () => move(i, 1));
          el.querySelector(".del").addEventListener("click", () => {
            snapPush(state.sections, "before delete");
            state.sections.splice(i, 1); touch(); render(); save();
          });
          const badge = el.querySelector(".lvp-badge");
          if (badge) badge.addEventListener("click", () => {
            const order = ["replace", "append", "prepend"];
            s.extMode = order[(order.indexOf(s.extMode) + 1) % order.length];
            touch(); render(); save();
          });

          /* Drag the grip to resize this box.

             Plain drag: the node follows, both ways. Growing already did that;
             shrinking used to leave the node at its old height, and the size
             pass then handed the spare room straight back to the sections - so
             the box you were shrinking sprang back while its neighbours grew.

             Shift-drag: the node stays put and the height is traded with the
             neighbouring section instead. */
          const grip = el.querySelector(".lvp-grip");
          grip.addEventListener("pointerdown", (e) => {
            e.preventDefault(); e.stopPropagation();
            const startY = e.clientY, startH = s.h;
            const zoom = uiScale(grip);
            const paired = e.shiftKey;
            /* Which pane the new height belongs to.

               paneSplit gives the translation whatever trH says and the box
               the rest, so dragging the section taller made the box taller and
               left the translation exactly as cramped as it was - the reason
               to have dragged in the first place. Every drag then had to be
               done twice, once on the section and once on the divider.

               With a translation open the section grip now moves trH by the
               same amount, so the box keeps its size and the room goes where
               it was wanted. Without one there is nothing to decide. */
            const growsTr = !paired && !!s.tr && !extLinked(s);
            const startTrH = Math.max(TR_MIN, Math.round(s.trH
              || Math.round(Math.max(MIN_H + TR_MIN + 4, s.h) * 0.4)));
            const open = state.sections.filter(x => !x.collapsed);
            const at = open.indexOf(s);
            const mate = paired ? (open[at + 1] || open[at - 1] || null) : null;
            const mateH = mate ? mate.h : 0;
            const mateAbove = !!mate && open.indexOf(mate) < at;

            gripDragging = true;
            grip.setPointerCapture(e.pointerId);

            const move = (ev) => {
              const dy = (ev.clientY - startY) / zoom;
              if (mate) {
                /* whatever this box gains, the neighbour gives up */
                const room = startH + mateH - MIN_H;
                const want = Math.min(Math.max(MIN_H, startH + dy), room);
                s.h = want;
                mate.h = Math.max(MIN_H, startH + mateH - want);
                renderHeights();
              } else {
                s.h = Math.max(MIN_H, startH + dy);
                if (growsTr) {
                  /* the box keeps startH - startTrH - 4; the rest is the
                     translation's, floored so it cannot be dragged away */
                  s.trH = Math.max(TR_MIN, startTrH + (s.h - startH));
                }
                renderHeights();
                fitNodeToContent();
              }
            };
            const up = () => {
              gripDragging = false;
              grip.releasePointerCapture(e.pointerId);
              grip.removeEventListener("pointermove", move);
              grip.removeEventListener("pointerup", up);
              if (!mate) fitNodeToContent();
              touch(); save();
            };
            grip.addEventListener("pointermove", move);
            grip.addEventListener("pointerup", up);
            if (mateAbove) { /* dragging the last box pulls from the one above */ }
          });

          list.appendChild(el);

          if (brushMode !== "off") {
            ta?.classList.toggle("picking", brushMode === "pick");
            ta?.classList.toggle("painting", brushMode === "apply");
          }

          /* Repaint from cache after every render, wired or not. This was
             gated on !linked, so any redraw - clicking a switch, opening
             another section's pane - rebuilt the wired section's markup with
             an empty pane and left it that way: the translation was still in
             the cache, nothing ever put it back on screen. */
          if (s.tr) {
            trPaint(s);
            const c = trCell(s);
            if (c.status !== "working" && c.status !== "load"
                && c.src !== sectionText(s).trim()) trSchedule(s, 120);
          }
        });
        updateFoot();
        refreshToolbar();
        /* Deliberate shrinking has to take the node's height back, not hand
           it round the sections.

           snapNode's "node is taller than its contents" branch exists for a
           node the user has dragged bigger: the spare room goes to the boxes
           rather than snapping away under the hand. But closing a translation
           pane shrinks the contents by exactly that much, so it hit the same
           branch and dealt the height out to every section - press TR twice
           and the whole node had grown. Deleting a section had the same shape,
           which is what the count test was patching.

           Measuring the content instead catches all of them: closing a
           translation, closing a picture, moving one beside the text,
           collapsing, deleting. */
        const contentNow = contentHeight();
        if (lastContent && contentNow < lastContent - 1) refit = true;
        lastContent = contentNow;
        node.setDirtyCanvas(true, true);
        snapNode();
        requestAnimationFrame(snapNode);
      }

      function move(i, d) {
        const j = i + d;
        if (j < 0 || j >= state.sections.length) return;
        state.sections.splice(j, 0, state.sections.splice(i, 1)[0]);
        touch(); render(); save();
      }

      function updateFoot() {
        const on = state.sections.filter(s => s.on);
        const chars = on.reduce((n, s) => n + (s.text || "").length, 0);
        const txt = foot.querySelector(".lvp-foot-txt");
        if (txt) {
          txt.textContent =
            `${on.length}/${state.sections.length} sections active - ${chars} chars`;
        }
      }

      /* Everything in the node that is not the list of sections: the toolbar,
         the find panel when it is open, the footer, and the wrapper's own
         padding and gaps.

         This used to be two constants, 34 and 18, and they were right for one
         arrangement only - toolbar on a single row, no find panel. Open Search
         and the panel took about seventy pixels that nothing accounted for, so
         the list was handed seventy pixels less than the node had been sized
         for: a scrollbar that would not go away however large the node was
         dragged, the bottom section's grip pushed under the rim, and Fit
         leaving the last section cut off. The same went for a narrow node,
         where the toolbar wraps onto a second row.

         Measured instead, so whatever is up there is counted. The fallbacks
         are only for the first pass, before the browser has laid anything
         out. */
      const WRAP_PAD = 4, WRAP_GAP = 5;
      function chromeHeight() {
        const bar = root.querySelector(".lvp-bar");
        const fr = root.querySelector(".lvp-fr");
        const barH = (bar && bar.offsetHeight) || 26;
        const footH = (foot && foot.offsetHeight) || 14;
        const frH = (fr && fr.offsetHeight) ? fr.offsetHeight + WRAP_GAP : 0;
        const pb = root.querySelector(".lvp-pastebox");
        const pbH = (pb && pb.offsetHeight) ? pb.offsetHeight + WRAP_GAP : 0;
        return WRAP_PAD * 2 + barH + WRAP_GAP + frH + pbH + stackH() + WRAP_GAP + footH;
      }

      /* The book panel's share of the node, measured like the rest of the
         chrome. Zero on a plain Composer. */
      /* While the node is off screen ComfyUI takes its widget out of the
         layout, and everything measures zero. The panel then counted as no
         height at all, the node looked a whole panel taller than its contents,
         and that room was handed to the sections - every pan that took the
         node out of view and back grew the boxes by the height of the book.
         The last real measurement stands in until there is a new one. */
      let panelHKnown = 0;
      /* Side by side the book and the editing bar are measured on their own:
         only the bar sits above the anchors, and the book is a column of its
         own whose height the node has to cover as well. */
      let bookPanelKnown = 0, nowKnown = 0;
      function bookOnlyH() {
        const el = root.querySelector(".lsb-left");
        if (el && el.offsetHeight) bookPanelKnown = el.offsetHeight;
        return bookPanelKnown;
      }
      function nowOnlyH() {
        const el = root.querySelector(".lsb-now");
        if (el && el.offsetHeight) nowKnown = el.offsetHeight;
        return nowKnown;
      }
      /* The drawer when it sits in the anchors' column, counted with the rest
         of that column's chrome so the sections are not handed its height */
      function drSlotH() {
        if (!drawerBeside()) return 0;
        const el = root.querySelector(".lsb-drside");
        if (el && el.offsetHeight) drSlotKnown = el.offsetHeight + WRAP_GAP + panelGap();
        return drSlotKnown;
      }
      /* What sits above the anchors in their own column */
      function stackH() {
        return sideMode() ? nowOnlyH() + WRAP_GAP + drSlotH() : bookPanelH();
      }
      function bookPanelH() {
        if (!BOOK) return 0;
        const el = root.querySelector(".lsb-book");
        const now = root.querySelector(".lsb-now");
        const under = root.querySelector(".lsb-drunder");
        if (el && el.offsetHeight) {
          panelHKnown = el.offsetHeight + WRAP_GAP
            + (under && under.offsetHeight ? under.offsetHeight + panelGap() + WRAP_GAP : 0)
            + (now && now.offsetHeight ? now.offsetHeight + panelGap() + WRAP_GAP : 0);
        }
        return panelHKnown;
      }

      /* Each section is drawn with a 1px border, top and bottom, and the sum
         below is of what sits inside them. Two pixels a section: with six
         sections that is twelve, which is about the height of one scrollbar
         appearing and refusing to leave. */
      const SEC_BORDER = 2;
      function contentHeight() {
        if (sideMode()) {
          const footH = (foot && foot.offsetHeight) || 14;
          const left = WRAP_PAD * 2 + bookOnlyH() + WRAP_GAP + footH;
          if (!anchorsOpen()) return Math.max(left, WRAP_PAD * 2 + nowOnlyH() + WRAP_GAP + drSlotH() + footH);
          return Math.max(left, chromeHeight() + secsH() + LIST_PAD);
        }
        if (!anchorsOpen()) {
          const footH = (foot && foot.offsetHeight) || 14;
          return WRAP_PAD * 2 + bookPanelH() + WRAP_GAP + footH;
        }
        return chromeHeight() + secsH() + LIST_PAD;
      }
      function secsH() {
        return state.sections.reduce((n, s) => {
          if (s.collapsed) return n + HEADER_H + SEC_BORDER + GAP;
          const linked = extLinked(s);
          const noteH = (!s.on || linked) ? 15 : 0;
          return n + HEADER_H + SEC_BORDER + s.h + 6 + noteH + GAP
            + imgBlock(s);
        }, 0);
      }

      /* Dragging the node's corner turns into section heights.

         The chrome (slots, plain widgets, padding) is measured, never guessed:
         node.computeSize() totals the node using the height this widget just
         reported, so subtracting the content height leaves it exactly.
         Only section heights are written here; node.size belongs to LiteGraph
         while it is dragging, and snapNode stays out of the way until the drag
         is over. */
      /* Shrinking was blocked because LiteGraph clamps a resize to
         node.computeSize() *before* anything else runs: the minimum was the
         current content height, so the node could not get smaller, so the
         sections never shrank, so the minimum never dropped.

         The fix is ordering. These listeners are attached in the capture
         phase, so they run before the canvas handler: the sections shrink
         first, the reported minimum drops with them, and LiteGraph then finds
         a smaller clamp waiting for it. node.size is never read or written
         here - the pointer alone drives it. */
      let drag = null;

      /* Removing a section makes the content shorter, which leaves the node
         taller than it needs to be - and snapNode's "give the spare room to
         the sections" rule cannot tell that apart from the user having dragged
         the node taller on purpose. So it handed the deleted box's height to
         its neighbours, the node never came back down, and duplicate-then-
         delete inflated every remaining box a little more each time.
         Counting sections is enough to separate the two cases. */
      let lastContent = 0;
      let refit = false;

      function onDragMove(e) {
        /* Do not try to catch pointerdown: LiteGraph sets resizing_node in its
           own pointerdown handler, which runs after a capture-phase listener,
           so the flag is not set yet and the drag would never start. Pick it
           up on the first move instead - by then the flag is reliable. */
        if (app.canvas?.resizing_node !== node) {
          if (drag) onDragUp();
          return;
        }
        if (!anchorsOpen()) return;            // nothing below to give the height to
        if (!drag) {
          drag = {
            y: e.clientY,
            base: state.sections.map(x => x.h),
            start: contentHeight(),
          };
          return;                       // this move is the reference point
        }

        const target = drag.start + (e.clientY - drag.y);
        const open = [];
        state.sections.forEach((x, i) => { if (!x.collapsed) open.push([x, i]); });
        if (!open.length) return;

        const fixed = state.sections.reduce((n, x) => n + (x.collapsed
          ? HEADER_H + GAP
          : HEADER_H + 6 + GAP + ((!x.on || extLinked(x)) ? 15 : 0)
            + imgBlock(x)), 0);
        const space = target - fixed - 52 - stackH();   // toolbar + footer + padding
        const totalBase = open.reduce((n, [x, i]) => n + drag.base[i], 0) || 1;

        if (space < open.length * MIN_H) {
          for (const [x] of open) x.h = MIN_H;
        } else {
          let left = space;
          open.forEach(([x, i], k) => {
            const want = (k === open.length - 1)
              ? left
              : Math.round(space * (drag.base[i] / totalBase));
            x.h = Math.max(MIN_H, want);
            left -= x.h;
          });
        }
        renderHeights();
      }

      function onDragUp() {
        if (!drag) return;
        drag = null;
        /* One last pass so the sections match the height the node was left at,
           rather than snapNode yanking it back to the pre-drag size. */
        adoptNodeHeight();
        touch();
        save();
        render();
      }

      /* Turn the node's current height into section heights. Used when a drag
         ends, and as a safety net if a resize slipped past the move handler. */
      /* Returns whether it actually took the height up.

         It used to return nothing, so a caller could not tell "I spread the
         extra room over the boxes" from "there was nowhere to put it". On the
         second one snapNode did nothing at all and the node kept its slack
         for good, which is why the node could grow but never come back. */
      function adoptNodeHeight() {
        if (!anchorsOpen()) return false;
        try {
          const chrome = node.computeSize()[1] - contentHeight();
          /* the chrome is slots and padding: a small positive number. Negative
             means the reported height is not the content height and every sum
             below would be built on it */
          if (chrome < 0) return false;
          const target = node.size[1] - chrome;
          if (target < 60) return false;
          const open = [];
          state.sections.forEach((x, i) => { if (!x.collapsed) open.push(x); });
          if (!open.length) return false;
          const fixed = state.sections.reduce((n, x) => n + (x.collapsed
            ? HEADER_H + GAP
            : HEADER_H + 6 + GAP + ((!x.on || extLinked(x)) ? 15 : 0)
            + imgBlock(x)), 0);
          const space = target - fixed - 52 - stackH();
          if (space < open.length * MIN_H) return false;
          const total = open.reduce((n, x) => n + x.h, 0) || 1;
          let left = space;
          open.forEach((x, k) => {
            const want = (k === open.length - 1) ? left : Math.round(space * (x.h / total));
            x.h = Math.max(MIN_H, want);
            left -= x.h;
          });
          return true;
        } catch (e) { return false; }
      }

      /* move stays in the capture phase so the sections shrink before
         LiteGraph works out its clamp */
      window.addEventListener("pointermove", onDragMove, true);
      window.addEventListener("pointerup", onDragUp, true);
      window.addEventListener("pointercancel", onDragUp, true);
      node._lvpDragCleanup = () => {
        window.removeEventListener("pointermove", onDragMove, true);
        window.removeEventListener("pointerup", onDragUp, true);
        window.removeEventListener("pointercancel", onDragUp, true);
      };

      /* How a section's height splits between the editor and the wired-text
         pane. Used both when building the markup and when only the heights
         change, so the two can never disagree - they used to, which left a
         black gap under the box while dragging. */
      /* How little of a section the box itself may be squeezed to once a
         translation is open. MIN_H alone was too generous to the pane: a
         trH left over from a FIT could push the English down to two lines,
         which is the one thing this pane exists to sit beside. */
      const trEditFloor = (total) => Math.max(MIN_H, Math.min(90, Math.round(total * 0.25)));

      function paneSplit(sec, linked) {
        if (!linked) {
          if (!sec.tr) return { edit: sec.h, ext: 0, tr: 0 };
          /* the translation sits under the box with a 4px divider between */
          const total = Math.max(MIN_H + TR_MIN + 4, sec.h);
          const room = Math.max(TR_MIN, total - 4 - trEditFloor(total));
          let th = Math.round(sec.trH || Math.round(total * 0.4));
          th = Math.min(Math.max(TR_MIN, th), room);
          return { edit: total - th - 4, ext: 0, tr: th };
        }
        /* A wired section can carry a translation pane as well. The height is
           taken off the bottom first and whatever the mode wanted is fitted
           into what is left, so turning TR on grows the section rather than
           squeezing the text you were reading. */
        const th = sec.tr
          ? Math.min(Math.max(TR_MIN, Math.round(sec.trH || Math.round(sec.h * 0.4))),
                     Math.max(TR_MIN, sec.h - 4 - 24))
          : 0;
        const rest = sec.tr ? Math.max(24, sec.h - th - 4) : sec.h;

        if (sec.extMode === "replace") return { edit: 0, ext: rest, tr: th };
        const total = Math.max(2 * 24 + 4, rest);
        let eh = Math.round(total * 0.4);
        eh = Math.min(Math.max(24, eh), total - 4 - 24);
        return { edit: total - eh - 4, ext: eh, tr: th };
      }

      /* Cheap path used while dragging: only touch the box heights. */
      function renderHeights() {
        const els = list.children;
        state.sections.forEach((s, i) => {
          const el = els[i];
          if (!el) return;
          if (s.collapsed) { el.style.height = `${HEADER_H}px`; return; }
          const noteH = el.querySelector(".lvp-note") ? 15 : 0;
          /* the strip is part of the section's height: leaving it out is what
             made the picture vanish the moment a section was resized */
          el.style.height = `${HEADER_H + s.h + 6 + noteH + imgBlock(s)}px`;
          const img = el.querySelector(".lvr-img");
          if (img) {
            /* clear the other axis, or a strip that has been both ways keeps
               the size it had in the mode it is no longer in */
            if (s.imgSide) {
              img.style.height = "";
              img.style.width = `${imgSideWidth(s)}px`;
            } else {
              img.style.width = "";
              img.style.height = `${stripHeight(s)}px`;
            }
          }
          /* the inner panes have to follow, or the extra height just shows up
             as a black gap below the box */
          const split = paneSplit(s, !!el.querySelector(".lvp-ext"));
          const ed = el.querySelector(".lvp-ed");
          const ex = el.querySelector(".lvp-ext");
          const tr = el.querySelector(".lvp-tr");
          if (ed) ed.style.height = `${split.edit}px`;
          if (ex) ex.style.height = `${split.ext}px`;
          if (tr) tr.style.height = `${split.tr}px`;
        });
        /* Heights are on the page now, so this is the moment to see whether
           they actually fit. Next frame, because the browser has not measured
           them yet. */
        absorbed = false;
        requestAnimationFrame(() => absorbOverflow());
      }

      /* ---------- find and replace ---------- */
      /* Find and replace, docked under the toolbar instead of covering the
         text. Hits are painted straight into the sections with a temporary
         mark, so you can see what you are about to change and watch it change. */
      let findState = null;

      function clearFindMarks() {
        let touched = false;
        for (const sec of state.sections) {
          if (!sec.html || !sec.html.includes("m-find")) continue;
          const tmp = document.createElement("div");
          tmp.innerHTML = sec.html;
          for (const el of Array.from(tmp.querySelectorAll(".m-find"))) {
            el.classList.remove("m-find");
            if (!el.className.trim()) {
              const f = document.createDocumentFragment();
              while (el.firstChild) f.appendChild(el.firstChild);
              el.replaceWith(f);
            }
          }
          sec.html = tmp.innerHTML;
          touched = true;
        }
        return touched;
      }

      /* The characters a section is really made of, with their marks.
         Everything that searches, replaces or styles works from this, so an
         offset can never mean one thing to the search and another to the
         painting. */
      function cellsOf(sec) {
        const host = document.createElement("div");
        host.innerHTML = sec.html ? sanitizeMarkup(sec.html)
                                  : textToHtml(normalizeText(sec.text));
        return { host, cells: readMarks(host) };
      }

      function matchSpans(text, find, matchCase, wholeWord) {
        const re = findRegex(find, matchCase, wholeWord);
        const spans = [];
        let m;
        re.lastIndex = 0;
        while ((m = re.exec(text)) !== null) {
          if (m[0].length) spans.push([m.index, m.index + m[0].length]);
          else re.lastIndex++;
        }
        return spans;
      }

      /* Wrap every hit in a temporary mark, keeping the marks already there.

         The offsets come from the cell text and NOT from sec.text. The two
         can disagree - a stored string may still carry CRLF, or be a step
         behind an edit - and every character of disagreement slid the mark
         further to the right of the word it had found. Reading both the
         search text and the marks off the same cells removes the whole class
         of drift rather than the one cause. */
      function paintFindMarks(find, matchCase, wholeWord, only) {
        clearFindMarks();
        if (!find) return 0;

        let total = 0;
        state.sections.forEach((sec, idx) => {
          if (only >= 0 && idx !== only) return;
          const { host, cells } = cellsOf(sec);
          const spans = matchSpans(cells.map(c => c.ch).join(""),
                                   find, matchCase, wholeWord);
          if (!spans.length) return;
          total += spans.length;
          for (const [from, to] of spans) {
            for (let i = from; i < to && i < cells.length; i++) {
              if (!cells[i].cls.includes("m-find")) {
                cells[i].cls = cells[i].cls.concat("m-find");
              }
            }
          }
          writeMarks(host, cells);
          sec.html = host.innerHTML;
        });
        return total;
      }

      /* Give every hit a mark instead of replacing it: the same buttons as the
         selection palette, applied to all the hits in scope at once. */
      function styleMatches(cls, find, matchCase, wholeWord, only, list) {
        if (!find) return 0;
        const size = isSizeCmd(cls);
        const axis = size ? "size" : axisOf(cls);
        let total = 0;
        (list || state.sections).forEach((sec, idx) => {
          if (only >= 0 && idx !== only) return;
          const { host, cells } = cellsOf(sec);
          const spans = matchSpans(cells.map(c => c.ch).join(""),
                                   find, matchCase, wholeWord);
          if (!spans.length) return;
          /* Pressing the same button again over hits that already carry the
             mark takes it off, exactly like the palette. */
          const off = cls && !size
            ? spans.every(([a, b]) => {
                for (let i = a; i < b && i < cells.length; i++) {
                  if (!cells[i].cls.includes(cls)) return false;
                }
                return true;
              })
            : false;
          for (const [from, to] of spans) {
            if (size) { stepSize(cells, from, to, cls === "size+" ? 1 : -1); continue; }
            for (let i = from; i < to && i < cells.length; i++) {
              setCellMark(cells[i], cls, axis, off);
            }
          }
          total += spans.length;
          writeMarks(host, cells);
          sec.html = host.innerHTML;
          sec.text = cells.map(c => c.ch).join("");
        });
        return total;
      }

      /* Replace on the character model rather than on the raw string, so only
         the words that actually change lose anything. Everything around them
         keeps its colour, and the new text inherits the marks of the text it
         replaced - a highlighted phrase stays highlighted. */
      function replaceInSection(sec, find, repl, matchCase, wholeWord) {
        const { host, cells } = cellsOf(sec);
        const text = cells.map(c => c.ch).join("");

        const re = findRegex(find, matchCase, wholeWord);
        const out = [];
        let last = 0, m, n = 0;
        while ((m = re.exec(text)) !== null) {
          for (let i = last; i < m.index; i++) out.push(cells[i]);
          const inherit = cells[m.index] ? cells[m.index].cls.filter(c => c !== "m-find") : [];
          for (const ch of repl) out.push({ ch, cls: inherit });
          last = m.index + m[0].length;
          n++;
          if (m[0].length === 0) re.lastIndex++;
        }
        if (!n) return 0;
        for (let i = last; i < cells.length; i++) out.push(cells[i]);

        writeMarks(host, out);
        sec.html = host.innerHTML;
        sec.text = out.map(c => c.ch).join("");
        return n;
      }

      function closeFind() {
        if (!findState) return;
        findState.bar.remove();
        findState = null;
        bookFind = null;
        /* Before anything is redrawn, not after. The panel's height belonged
           to the node, and for the moment between the panel going and the
           node coming down the node is taller than its contents - which is
           exactly the state that means "the user dragged the node bigger,
           hand the room to the sections". Every open and close of Search was
           dealing the panel's height out to the boxes and they crept up a
           little each time. Taking it off the node first means that state
           never exists. */
        fitNodeToContent();
        if (clearFindMarks()) { render(); save(); }
        else render();
      }

      function openFind() {
        if (findState) { closeFind(); return; }      // the button toggles it

        const bar = document.createElement("div");
        bar.className = "lvp-fr";
        /* Two rows: whole sentences need the width, and a single row pushed
           the fields down to a few characters each. */
        /* Typing still searches as you go. FIND is for the times that is not
           what you want: after an edit, or to walk the hits one at a time. */
        bar.innerHTML = `
          <div class="lvp-fr-row">
            <span class="lvp-fr-lab">FIND</span>
            <input type="text" class="f" placeholder="word or sentence to find">
            <span class="hits"></span>
            <button class="lvp-btn step prev" title="Previous hit">&#8249;</button>
            <button class="lvp-btn step next" title="Next hit">&#8250;</button>
            <button class="lvp-btn cs" title="Match case">Aa</button>
            <button class="lvp-btn ww" title="Whole word">|W|</button>
            <button class="lvp-btn cls" title="Close">&#10005;</button>
            <button class="lvp-btn fnd" title="Search again and jump to the next hit">FIND</button>
          </div>
          <div class="lvp-fr-row">
            <span class="lvp-fr-lab">WITH</span>
            <input type="text" class="r" placeholder="text to put in its place">
            <select class="sc"></select>
            <button class="lvp-btn go" title="Replace every hit">REPLACE ALL</button>
            <button class="lvp-btn undo" style="display:none">UNDO</button>
          </div>
          <div class="lvp-fr-row">
            <span class="lvp-fr-lab">EFFECT</span>
            <div class="lvp-fr-marks"></div>
            <span style="flex:1"></span>
          </div>`;
        root.querySelector(".lvp-bar").insertAdjacentElement("afterend", bar);
        /* The panel needs its own room, or it takes it from the sections and
           every one of them gains a scrollbar. Measured after the browser has
           laid it out. */
        setTimeout(fitNodeToContent, 0);

        for (const ev of ["pointerdown", "mousedown", "wheel", "contextmenu"]) {
          bar.addEventListener(ev, e => e.stopPropagation());
        }
        bar.querySelectorAll("input,select").forEach(el =>
          ["keydown", "keyup", "keypress"].forEach(k =>
            el.addEventListener(k, e => e.stopPropagation())));

        const fEl = bar.querySelector(".f");
        const rEl = bar.querySelector(".r");
        const scope = bar.querySelector(".sc");
        const hits = bar.querySelector(".hits");
        const undoBtn = bar.querySelector(".undo");
        let matchCase = false, wholeWord = false, backup = null;

        /* In the Book the widest scope is the whole book, and it comes first:
           a word to change in a series is a word to change everywhere it was
           written, which is the reason the series lives in one node. */
        function fillScope() {
          const keep = scope.value;
          scope.innerHTML = (BOOK ? `<option value="-2">this series</option>`
              + (book && book.groups.length > 1 ? `<option value="-3">every series</option>` : "") : "")
            + `<option value="-1">${BOOK ? "this prompt" : "all sections"}</option>` +
            state.sections.map((x, i) =>
              `<option value="${i}">${escapeHtml(x.title)}</option>`).join("");
          scope.value = [...scope.options].some(o => o.value === keep) ? keep
            : (BOOK ? "-2" : "-1");
        }
        fillScope();

        findState = { bar, refresh: () => run(true), rescope: fillScope };
        let cur = -1;                       // which hit the stepper is on

        /* One hit can end up as more than one span - a word half of which was
           already coloured splits in two - so hits are counted as runs of
           neighbouring marks, not as elements. writeMarks lays the spans out
           flat, so neighbours really are siblings. */
        function hitGroups() {
          const groups = [];
          for (const ta of list.querySelectorAll(".lvp-ta")) {
            let group = null, prev = null;
            for (const el of ta.querySelectorAll(".m-find")) {
              if (prev && prev.nextSibling === el && group) group.push(el);
              else { group = [el]; groups.push(group); }
              prev = el;
            }
          }
          return groups;
        }

        function showCount(n) {
          const groups = hitGroups();
          const wide = BOOK && parseInt(scope.value) <= -2 && bookFind;
          const elsewhere = wide
            ? ` - ${bookFind.total} in ${bookFind.caps} capsule${bookFind.caps === 1 ? "" : "s"}`
            : "";
          hits.textContent = !fEl.value ? ""
            : (!n && !(wide && bookFind.total)) ? "none"
            : (cur >= 0 && cur < groups.length)
              ? `${cur + 1} / ${groups.length}${elsewhere}`
              : `${n} here${elsewhere}`;
          if (!wide && n) hits.textContent = hits.textContent.replace(" here", " found");
        }

        /* The scope the open sections are painted with. "Every prompt" paints
           the open one like "this prompt" and lights the capsules for the
           rest. */
        const localOnly = () => {
          const v = parseInt(scope.value);
          return v <= -2 ? -1 : v;
        };

        function run(keepPlace) {
          const before = cur;
          const n = paintFindMarks(fEl.value, matchCase, wholeWord, localOnly());
          if (BOOK) {
            bookFind = (fEl.value && parseInt(scope.value) <= -2)
              ? countBook(fEl.value, matchCase, wholeWord, parseInt(scope.value)) : null;
          }
          cur = keepPlace ? before : -1;
          render();
          if (cur >= 0) markCurrent();
          showCount(n);
          return n;
        }

        function markCurrent() {
          const groups = hitGroups();
          if (!groups.length) { cur = -1; return; }
          if (cur >= groups.length) cur = groups.length - 1;
          for (const g of groups) for (const el of g) el.removeAttribute("data-cur");
          for (const el of groups[cur]) el.setAttribute("data-cur", "1");
        }

        /* Step through the hits. A collapsed section is opened on the way, or
           the jump lands somewhere the eye cannot follow. */
        function step(delta) {
          if (!fEl.value) return;
          let groups = hitGroups();
          if (!groups.length) {
            const collapsed = state.sections.some(x => x.collapsed);
            if (collapsed) {
              for (const x of state.sections) {
                if ((x.html || "").includes("m-find")) x.collapsed = false;
              }
              render();
              groups = hitGroups();
            }
            if (!groups.length) { showCount(0); return; }
          }
          cur = cur < 0
            ? (delta < 0 ? groups.length - 1 : 0)
            : (cur + delta + groups.length) % groups.length;
          markCurrent();
          const el = hitGroups()[cur]?.[0];
          if (el && el.scrollIntoView) {
            el.scrollIntoView({ block: "center", inline: "nearest" });
          }
          showCount(groups.length);
        }

        fEl.addEventListener("input", () => run(false));
        fEl.addEventListener("keydown", (e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          step(e.shiftKey ? -1 : 1);
        });
        bar.querySelector(".fnd").addEventListener("click", () => {
          run(false);
          step(1);
        });
        bar.querySelector(".prev").addEventListener("click", () => step(-1));
        bar.querySelector(".next").addEventListener("click", () => step(1));
        scope.addEventListener("change", () => run(false));

        /* Styling the hits: the palette buttons, applied to everything the
           search found in scope. The paragraph dot is left out - it belongs to
           a line, not to a word. */
        const marksEl = bar.querySelector(".lvp-fr-marks");
        const HIT_MARKS = MARK_BUTTONS.filter(([, c]) => c !== "m-para" && c !== "m-dot");
        marksEl.innerHTML = HIT_MARKS.map(([label, cls, title, style]) => label === "|"
          ? `<span class="sep"></span>`
          : `<button data-c="${cls}" title="${title} - every hit" ` +
            `style="${style}">${label}</button>`).join("");
        marksEl.querySelectorAll("button").forEach(b => {
          b.addEventListener("click", (e) => {
            e.stopPropagation();
            const find = fEl.value;
            if (!find) { hits.textContent = "type something to find first"; return; }
            snapPush(state.sections, "before styling hits");
            let n;
            if (BOOK && parseInt(scope.value) <= -2) {
              /* every capsule in the book, then the open prompt drawn again
                 from them so what is on screen is what was changed */
              clearFindMarks();
              writeBack();
              n = 0;
              for (const c of capsInScope(parseInt(scope.value))) {
                n += styleMatches(b.dataset.c, find, matchCase, wholeWord, -1, [c.sec]);
              }
              restoreFrom({ book }, null);
            } else {
              n = styleMatches(b.dataset.c, find, matchCase, wholeWord,
                               parseInt(scope.value));
            }
            touch(); save();
            /* Repaint, so the hits stay lit on top of what was just applied. */
            run(true);
            hits.textContent = n ? `styled ${n}` : "none";
          });
        });
        bar.querySelector(".cs").addEventListener("click", (e) => {
          matchCase = !matchCase; e.target.classList.toggle("on", matchCase); run(false);
        });
        bar.querySelector(".ww").addEventListener("click", (e) => {
          wholeWord = !wholeWord; e.target.classList.toggle("on", wholeWord); run(false);
        });

        bar.querySelector(".go").addEventListener("click", () => {
          const find = fEl.value;
          if (!find) return;
          snapPush(state.sections, "before replace");
          const only = parseInt(scope.value);
          let n = 0;
          if (BOOK && only <= -2) {
            /* Every capsule, once each. A capsule shared by six prompts is
               one piece of text, so it is changed once and all six follow. */
            clearFindMarks();
            writeBack();
            backup = { book: JSON.stringify(book) };
            for (const c of capsInScope(only)) {
              n += replaceInSection(c.sec, find, rEl.value, matchCase, wholeWord);
            }
            restoreFrom({ book }, null);
          } else {
            backup = { sections: JSON.parse(JSON.stringify(state.sections)) };
            state.sections.forEach((sec, i) => {
              if (only >= 0 && i !== only) return;
              n += replaceInSection(sec, find, rEl.value, matchCase, wholeWord);
            });
          }
          touch(); save();
          undoBtn.style.display = n ? "" : "none";
          run(false);                     // repaint against the new text
          hits.textContent = `replaced ${n}`;
        });

        undoBtn.addEventListener("click", () => {
          if (!backup) return;
          if (backup.book) restoreFrom({ book: JSON.parse(backup.book) }, null);
          else state.sections = backup.sections;
          backup = null;
          undoBtn.style.display = "none";
          touch(); save(); run(false);
        });

        bar.querySelector(".cls").addEventListener("click", closeFind);
        fEl.focus();
      }

      /* Put a panel where the work is. Both libraries used to cover the whole
         node, so opening one from the bottom section showed its text far above
         the button that was just pressed, and choosing meant scrolling up and
         back down each time. Anchored to the section instead, clamped so it
         cannot hang off either end of the node. */
      function placePanel(box, secEl) {
        if (!secEl) return;
        const avail = root.clientHeight;
        const h = Math.min(380, Math.max(170, avail - 16));
        /* Measured on screen, not added up from offsets. The section's
           offsetTop is already counted from the node, so adding the list's
           own offset on top counted everything above the list twice - a few
           pixels under the Composer's toolbar, but in the Series Book the
           whole book panel, which put the library a section or two below the
           one it was opened from. The canvas zoom is divided back out. */
        const k = uiScale(root);
        const at = (secEl.getBoundingClientRect().top - root.getBoundingClientRect().top) / k;
        const top = Math.max(4, Math.min(at, avail - h - 4));
        box.style.inset = "auto";
        box.style.left = "0";
        box.style.right = "0";
        box.style.top = `${Math.round(top)}px`;
        box.style.height = `${h}px`;
      }

      /* ---------- snippet library ---------- */
      /* The one thing a preset cannot do: add to a section instead of taking
         it over. The reader writes what the photograph shows and stops there,
         so a shot size it could not make out, a film stock, a time of day -
         all of that is typed in by hand, every time. This keeps them.
         Three places to land: where the caret was left in the box, the front,
         which is where a shot size or a person wants to be, and the end, which
         is where another line about the light belongs. The caret is read as a
         character count through the text nodes, the same counting the group
         swap already uses, so the marks on the box survive the insertion. */
      async function openSnips(sec, secEl) {
        if (root.querySelector(".lvp-panel")) return;
        const kind = snipKind(sec.title);
        const box = document.createElement("div");
        box.className = "lvp-panel";
        box.innerHTML = `
          <h5>SNIPPETS &mdash; ${escapeHtml(sec.title)}<span class="lvp-cap"></span><span class="lvp-x" title="Close">&#10005;</span></h5>
          <div class="lvp-row">
            <input type="text" class="nm" placeholder="name for the selected text">
            <input type="text" class="gp" placeholder="group (optional)" style="max-width:120px"
              title="Snippets sharing a group replace one another - shot, lens, time. Leave it empty to stack.">
            <button class="lvp-btn keep" title="Save the selected text, or the whole section if nothing is selected">Save</button>
          </div>
          <div class="lvp-row">
            <input type="text" class="q" placeholder="filter">
            <label style="display:flex;align-items:center;gap:4px;opacity:.7;font-size:10px">
              <input type="checkbox" class="all"> all sections
            </label>
            <button class="lvp-btn rl" title="Read the library again">Reload</button>
          </div>
          <div class="lvp-scroll"></div>
          <div class="lvp-row">
            <span class="msg" style="opacity:.6">click a name to put it where the caret is (or at the front), or END for the bottom</span>
            <span style="flex:1"></span>
            <button class="lvp-btn cls">Close</button>
          </div>`;
        root.appendChild(box);
        placePanel(box, secEl);
        box.querySelector(".lvp-x")?.addEventListener("click", () => box.remove());
        for (const ev of ["pointerdown", "mousedown", "wheel", "contextmenu"]) {
          box.addEventListener(ev, e => e.stopPropagation());
        }
        box.querySelectorAll("input").forEach(el =>
          ["keydown", "keyup", "keypress"].forEach(k =>
            el.addEventListener(k, e => e.stopPropagation())));

        const scroll = box.querySelector(".lvp-scroll");
        const msg = box.querySelector(".msg");
        const qEl = box.querySelector(".q");
        const allEl = box.querySelector(".all");
        let list = [];

        /* Whatever was highlighted in the box when the panel opened. Reading
           it now rather than at save time, because opening the panel and
           typing a name both drop the selection. */
        let picked = "";
        try {
          const selNow = window.getSelection();
          const ta = secEl && secEl.querySelector(".lvp-ta");
          if (selNow && selNow.rangeCount && ta
              && ta.contains(selNow.getRangeAt(0).commonAncestorContainer)) {
            picked = String(selNow.toString() || "").trim();
          }
        } catch (e) { /* no selection to read */ }
        if (picked) msg.textContent = `Save will keep the ${picked.length} selected chars`;

        /* Where the caret sat in the box, counted in characters through the
           text nodes so it can be found again in the copy the snippet is
           spliced into. Read now, because opening the panel takes the caret
           away. Null means the box was never clicked into, and the snippet
           goes to the front as before. */
        let caretAt = null;
        try {
          const selNow = window.getSelection();
          const ta = secEl && secEl.querySelector(".lvp-ta");
          if (selNow && selNow.rangeCount && ta) {
            const r = selNow.getRangeAt(0);
            if (ta.contains(r.startContainer)) {
              const probe = document.createRange();
              probe.selectNodeContents(ta);
              probe.setEnd(r.startContainer, r.startOffset);
              const w = document.createTreeWalker(
                probe.cloneContents(), NodeFilter.SHOW_TEXT);
              let n = null, count = 0;
              while ((n = w.nextNode())) count += n.nodeValue.length;
              caretAt = count;
            }
          }
        } catch (e) { caretAt = null; }

        async function pull(force) {
          scroll.textContent = "reading\u2026";
          try {
            const r = await api.fetchApi(SNIP_URL + (force ? "?t=" + Date.now() : ""));
            const j = await r.json();
            list = Array.isArray(j && j.snippets) ? j.snippets : [];
          } catch (e) {
            list = [];
          }
          paint();
        }

        async function push(next) {
          try {
            const r = await api.fetchApi(SNIP_URL, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ snippets: next }),
            });
            const j = await r.json();
            if (!j || !j.ok) {
              msg.textContent = (j && j.error) || "could not write snippets.json";
              return false;
            }
            list = Array.isArray(j.snippets) ? j.snippets : [];
            paint();
            return true;
          } catch (e) {
            msg.textContent = "could not reach the server";
            return false;
          }
        }

        function put(sn, atEnd) {
          snapPush(state.sections, "before snippet");
          const piece = normalizeText(sn.text).trim();
          /* Worked on as markup whenever the section has any, so a snippet
             going in no longer costs the box every mark on it. */
          const host = document.createElement("div");
          host.innerHTML = sec.html ? sanitizeMarkup(sec.html)
            : textToHtml(normalizeText(sec.text || ""));
          const marked = !!sec.html;
          const had = htmlToText(host);
          /* One shot size, one lens, one time of day. Where a snippet from the
             same group is already sitting in the box, the new one takes its
             place where it stands - so a medium shot becomes a close-up rather
             than arguing with one. Matched against the library's own text, so
             it works whether the old one went in at the front or the end, and
             it still works after a reload because nothing is remembered on the
             section. A snippet that has since been edited by hand no longer
             matches and is left alone; the new one is added instead, which is
             visible and easy to fix. Groupless snippets always stack - a warm
             cast and available light are both true at once. */
          let swapped = false;
          if (sn.group) {
            for (const other of list) {
              if (other === sn || other.kind !== sn.kind
                  || other.group !== sn.group) continue;
              const old = normalizeText(other.text).trim();
              const at = old ? had.indexOf(old) : -1;
              if (at < 0) continue;
              swapped = spliceMarkup(host, at, at + old.length, piece);
              break;
            }
          }
          if (!swapped) {
            if (!had.trim()) {
              host.textContent = piece;
            } else if (had.indexOf(piece) >= 0) {
              /* already there; nothing to add */
            } else if (atEnd) {
              host.appendChild(document.createTextNode("\n\n" + piece));
            } else if (caretAt !== null && caretAt > 0 && caretAt < had.length
                       && spliceAtCaret(host, caretAt, piece)) {
              /* landed at the caret */
            } else {
              host.insertBefore(
                document.createTextNode(piece + "\n\n"), host.firstChild);
            }
          }
          trimEdgeWhitespace(host);
          sec.text = htmlToText(host);
          sec.html = marked ? sanitizeMarkup(host.innerHTML) : "";
          touch(); render(); save();
          box.remove();
        }

        function paint() {
          scroll.innerHTML = "";
          const q = (qEl.value || "").trim().toLowerCase();
          const shown = list
            .filter(x => allEl.checked || x.kind === kind)
            .filter(x => !q || x.name.toLowerCase().includes(q)
              || x.text.toLowerCase().includes(q));
          if (!shown.length) {
            scroll.innerHTML = list.length
              ? `<span style="opacity:.55">Nothing here for this section.`
                + ` Tick <b>all sections</b> to see the rest, or select some`
                + ` text in the box, name it above and press Save.</span>`
              : `<span style="opacity:.55">The library is empty.<br><br>`
                + `Select a phrase in the box, type a name above and press`
                + ` <b>Save</b>. It is filed under this section, so Camera`
                + ` keeps camera phrases and Scene keeps scene ones.</span>`;
            return;
          }
          for (const sn of shown) {
            const row = document.createElement("div");
            row.className = "lvp-snap";
            row.innerHTML =
              `<span>`
              + (sn.group
                ? `<span style="color:#e0b658">${escapeHtml(sn.group)}</span>  ` : "")
              + `<b style="color:#cfe6ff">${escapeHtml(sn.name)}</b>`
              + (allEl.checked && sn.kind !== kind
                ? `<span style="opacity:.4">  [${escapeHtml(sn.kind)}]</span>` : "")
              + `<br><span style="opacity:.5">${escapeHtml(sn.text.slice(0, 110))}${sn.text.length > 110 ? "\u2026" : ""}</span>`
              + `</span>`
              + `<span class="end" title="Add it at the bottom instead"
                   style="opacity:.5;font-size:10px;padding:0 6px;cursor:pointer">END</span>`
              + `<span class="del" title="Remove from the library">&#10005;</span>`;
            row.title = sn.text;
            row.addEventListener("click", () => put(sn, false));
            row.querySelector(".end").addEventListener("click", (ev) => {
              ev.stopPropagation(); put(sn, true);
            });
            const del = row.querySelector(".del");
            del.addEventListener("click", async (ev) => {
              ev.stopPropagation();
              if (del.dataset.armed !== "1") {
                scroll.querySelectorAll(".del").forEach(d => {
                  d.dataset.armed = ""; d.textContent = "\u2715";
                });
                del.dataset.armed = "1";
                del.textContent = "delete?";
                setTimeout(() => {
                  if (!del.isConnected || del.dataset.armed !== "1") return;
                  del.dataset.armed = ""; del.textContent = "\u2715";
                }, 4000);
                return;
              }
              const next = list.filter(
                x => !(x.kind === sn.kind && x.name === sn.name));
              if (await push(next)) msg.textContent = `deleted "${sn.name}"`;
            });
            scroll.appendChild(row);
          }
        }

        box.querySelector(".keep").addEventListener("click", async () => {
          const nm = box.querySelector(".nm").value.trim();
          if (!nm) { msg.textContent = "give it a name first"; return; }
          const body = (picked || normalizeText(sec.text || "")).trim();
          if (!body) { msg.textContent = "nothing to save"; return; }
          const gp = box.querySelector(".gp").value.trim().toLowerCase();
          const had = list.some(x => x.kind === kind && x.name === nm);
          const next = list.filter(x => !(x.kind === kind && x.name === nm))
            .concat([{ kind, group: gp, name: nm, text: body }]);
          if (await push(next)) {
            box.querySelector(".nm").value = "";
            msg.textContent = (had ? `replaced "${nm}"` : `saved "${nm}"`)
              + `  ${body.length} chars`;
          }
        });
        qEl.addEventListener("input", paint);
        allEl.addEventListener("change", paint);
        box.querySelector(".rl").addEventListener("click", () => pull(true));
        box.querySelector(".cls").addEventListener("click", () => box.remove());
        pull(false);
      }

      /* ---------- preset library ---------- */
      function openPresets(sec, secEl) {
        if (root.querySelector(".lvp-panel")) return;
        const box = document.createElement("div");
        box.className = "lvp-panel";
        box.innerHTML = `
          <h5>PRESETS &mdash; ${escapeHtml(sec.title)}<span class="lvp-cap"></span><span class="lvp-x" title="Close">&#10005;</span></h5>
          <div class="lvp-row">
            <input type="text" class="nm" placeholder="name for the current text">
            <button class="lvp-btn keep">Save current</button>
          </div>
          <div class="lvp-row">
            <input type="text" class="q" placeholder="filter">
            <button class="lvp-btn all" title="Include presets saved from other sections">All sections</button>
          </div>
          <div class="lvp-scroll"></div>
          <div class="lvp-row">
            <button class="lvp-btn exp" title="Write every preset to a .json file">Export</button>
            <button class="lvp-btn imp" title="Merge presets from a .json file">Import</button>
            <input type="file" class="fi" accept="application/json,.json" style="display:none">
            <span class="msg" style="opacity:.6"></span>
            <span style="flex:1"></span>
            <button class="lvp-btn undo" style="display:none">Undo</button>
            <button class="lvp-btn cls">Close</button>
          </div>`;
        root.appendChild(box);
        placePanel(box, secEl);
        box.querySelector(".lvp-x")?.addEventListener("click", () => box.remove());
        for (const ev of ["pointerdown", "mousedown", "wheel", "contextmenu"]) {
          box.addEventListener(ev, e => e.stopPropagation());
        }
        box.querySelectorAll("input").forEach(el =>
          ["keydown", "keyup", "keypress"].forEach(k =>
            el.addEventListener(k, e => e.stopPropagation())));

        const scroll = box.querySelector(".lvp-scroll");
        const msg = box.querySelector(".msg");
        const undoBtn = box.querySelector(".undo");
        let showAll = false, backup = null;

        function paint() {
          const q = box.querySelector(".q").value.trim().toLowerCase();
          const kind = psKind(sec.title);
          let list = psRead();
          /* How full the library is, shown before it matters rather than at
             the moment a save is refused. */
          const capEl = box.querySelector(".lvp-cap");
          if (capEl) {
            const held = psRead().length;
            capEl.textContent = `${held} / ${PS_MAX}`;
            capEl.classList.toggle("near", held >= PS_MAX * 0.9);
            capEl.title = held >= PS_MAX
              ? "Full. Delete a preset to make room - nothing is ever dropped for you."
              : "Presets stored in user/visual_prompt_composer/presets.json";
          }
          if (!showAll) list = list.filter(p => p.kind === kind);
          if (q) list = list.filter(p =>
            (p.name + " " + p.text).toLowerCase().includes(q));
          scroll.innerHTML = "";
          if (!list.length) {
            scroll.innerHTML = `<span style="opacity:.4;padding:4px">` +
              (showAll ? "no presets yet" :
               "nothing saved for this section yet - press All sections to widen") +
              `</span>`;
            return;
          }
          for (const p of list) {
            const all = psRead();
            const idx = all.findIndex(x => x.kind === p.kind && x.name === p.name);
            const row = document.createElement("div");
            row.className = "lvp-snap";
            const d = new Date(p.t), pad = x => String(x).padStart(2, "0");
            row.innerHTML =
              `<span><b style="color:#cfe6ff">${escapeHtml(p.name)}</b>` +
              `<span style="opacity:.45">  ${p.text.length} chars  ` +
              `${pad(d.getMonth() + 1)}/${pad(d.getDate())}` +
              (showAll && p.kind !== kind ? `  [${escapeHtml(p.kind)}]` : "") +
              `</span></span><span class="del" title="Delete">&#10005;</span>`;
            row.title = p.text.slice(0, 400);
            row.addEventListener("click", () => {
              backup = sec.text;
              snapPush(state.sections, "before preset");
              sec.text = normalizeText(p.text);
              sec.html = "";
              touch(); render(); save();
              undoBtn.style.display = "";
              msg.textContent = `loaded "${p.name}"`;
            });
            /* Presets live only in this browser, so a delete cannot be undone
               the way a snapshot can. Ask once, in place, rather than wiping it
               on a stray click. */
            const del = row.querySelector(".del");
            del.addEventListener("click", ev => {
              ev.stopPropagation();
              if (del.dataset.armed === "1") {
                const a = psRead(); a.splice(idx, 1); psWrite(a);
                msg.textContent = `deleted "${p.name}"`;
                paint();
                return;
              }
              /* disarm any other row that is waiting */
              scroll.querySelectorAll(".del").forEach(d => {
                d.dataset.armed = ""; d.textContent = "\u2715"; d.classList.remove("armed");
              });
              del.dataset.armed = "1";
              del.textContent = "delete?";
              del.classList.add("armed");
              del.title = "This cannot be undone - click again to delete";
              setTimeout(() => {
                if (del.dataset.armed !== "1") return;
                del.dataset.armed = ""; del.textContent = "\u2715";
                del.classList.remove("armed");
              }, 3000);
            });
            scroll.appendChild(row);
          }
        }
        paint();
        /* The file may still be on its way. Paint once from whatever is in
           hand so the panel is never blank, then again when it lands. */
        psLoad().then(() => { if (box.isConnected) paint(); });

        box.querySelector(".q").addEventListener("input", paint);
        box.querySelector(".all").addEventListener("click", (e) => {
          showAll = !showAll; e.target.classList.toggle("on", showAll); paint();
        });
        box.querySelector(".keep").addEventListener("click", () => {
          const nm = box.querySelector(".nm").value.trim();
          if (!nm) { msg.textContent = "give it a name first"; return; }
          const how = psSave(sec.title, nm, sec.text);
          if (how === "empty") {
            msg.textContent = "nothing to save - the box is empty"; return;
          }
          if (how === "full") {
            msg.textContent =
              `the library is full at ${PS_MAX} - delete one to make room`;
            return;
          }
          box.querySelector(".nm").value = "";
          msg.textContent = `saved "${nm}"`;
          paint();
        });
        undoBtn.addEventListener("click", () => {
          if (backup === null) return;
          sec.text = backup; sec.html = ""; backup = null;
          undoBtn.style.display = "none";
          msg.textContent = "reverted";
          touch(); render(); save();
        });
        box.querySelector(".exp").addEventListener("click", () => {
          const n = psExport();
          msg.textContent = n ? `exported ${n} presets` : "nothing to export yet";
        });
        const fi = box.querySelector(".fi");
        box.querySelector(".imp").addEventListener("click", () => fi.click());
        fi.addEventListener("change", () => {
          const f = fi.files && fi.files[0];
          if (!f) return;
          const rd = new FileReader();
          rd.onload = () => {
            const r = psImport(String(rd.result || ""));
            fi.value = "";
            if (!r) { msg.textContent = "that file is not a preset export"; return; }
            msg.textContent =
              `imported ${r.added} new, ${r.updated} updated` +
              (r.skipped ? `, ${r.skipped} skipped` : "") +
              (r.refused ? ` - ${r.refused} could not fit: the library is ` +
                           `full at ${PS_MAX}, delete some first` : "");
            paint();
          };
          rd.onerror = () => { fi.value = ""; msg.textContent = "could not read that file"; };
          rd.readAsText(f);
        });
        box.querySelector(".cls").addEventListener("click", () => box.remove());
        box.querySelector(".nm").focus();
      }

      /* ---------- snapshots panel ---------- */
      function openSave() {
        if (root.querySelector(".lvp-panel")) return;
        const box = document.createElement("div");
        box.className = "lvp-panel";
        box.innerHTML = `
          <h5>LAYOUT SNAPSHOTS<span class="lvp-cap"></span><span class="lvp-x" title="Close">&#10005;</span></h5>
          <div class="lvp-row">
            <input type="text" class="nm" placeholder="name this snapshot (optional)">
            <button class="lvp-btn keep">Save now</button>
          </div>
          <div class="lvp-scroll"></div>
          <div class="lvp-row">
            <button class="lvp-btn exp">Copy all as text</button>
            <span class="snapmsg" style="opacity:.6"></span>
            <span style="flex:1"></span>
            <button class="lvp-btn cls">Close</button>
          </div>`;
        root.appendChild(box);
        box.querySelector(".lvp-x")?.addEventListener("click", () => box.remove());
        for (const ev of ["pointerdown", "mousedown", "wheel", "contextmenu"]) {
          box.addEventListener(ev, e => e.stopPropagation());
        }
        box.querySelectorAll("input").forEach(el =>
          ["keydown", "keyup", "keypress"].forEach(k =>
            el.addEventListener(k, e => e.stopPropagation())));

        const scroll = box.querySelector(".lvp-scroll");
        function paint() {
          const all = snapRead();
          const capEl = box.querySelector(".lvp-cap");
          if (capEl) {
            const kept = all.filter(x => x.kind === "keep").length;
            capEl.textContent = `${kept} / ${SNAP_KEEP_MAX} saved`;
            capEl.classList.toggle("near", kept >= SNAP_KEEP_MAX * 0.9);
            capEl.title = "Snapshots you saved by hand, marked *. The " +
              "automatic ones above them rotate and are not counted here.";
          }
          scroll.innerHTML = "";
          if (!all.length) {
            scroll.innerHTML = `<span style="opacity:.4;padding:4px">no snapshots yet</span>`;
            return;
          }
          all.forEach((e, i) => {
            const row = document.createElement("div");
            row.className = "lvp-snap";
            row.innerHTML = `<span>${escapeHtml(snapLabel(e))}</span>` +
                            `<span class="del" title="Delete">&#10005;</span>`;
            row.addEventListener("click", () => {
              snapPush(state.sections, "before restore");
              restoreFrom({ sections: JSON.parse(JSON.stringify(e.sections)) },
                          "restored from snapshot");
              touch(); save(); paint();
            });
            /* same two-step as presets - a named snapshot is not recoverable */
            const del = row.querySelector(".del");
            del.addEventListener("click", ev => {
              ev.stopPropagation();
              if (del.dataset.armed === "1") {
                const a = snapRead(); a.splice(i, 1); snapWrite(a); paint();
                return;
              }
              scroll.querySelectorAll(".del").forEach(d => {
                d.dataset.armed = ""; d.textContent = "\u2715"; d.classList.remove("armed");
              });
              del.dataset.armed = "1";
              del.textContent = "delete?";
              del.classList.add("armed");
              del.title = "This cannot be undone - click again to delete";
              setTimeout(() => {
                if (del.dataset.armed !== "1") return;
                del.dataset.armed = ""; del.textContent = "\u2715";
                del.classList.remove("armed");
              }, 3000);
            });
            scroll.appendChild(row);
          });
        }
        paint();
        snapLoad().then(() => { if (box.isConnected) paint(); });

        box.querySelector(".keep").addEventListener("click", () => {
          const nm = box.querySelector(".nm").value.trim();
          const how = snapPush(state.sections, nm || "saved", "keep");
          const note = box.querySelector(".snapmsg");
          if (how === "full") {
            if (note) {
              note.textContent =
                `${SNAP_KEEP_MAX} saved snapshots already - delete one first`;
            }
            return;
          }
          if (note) {
            note.textContent = how === "same"
              ? "that is already the newest snapshot"
              : `saved "${nm || "saved"}"`;
          }
          box.querySelector(".nm").value = "";
          paint();
        });
        box.querySelector(".exp").addEventListener("click", (e) => {
          const txt = state.sections.filter(s => s.on)
            .map(s => `${s.title}\n${s.text}`).join("\n\n");
          const ta = document.createElement("textarea");
          ta.value = txt; document.body.appendChild(ta); ta.select();
          try { document.execCommand("copy"); } catch (err) { /* ignore */ }
          ta.remove();
          e.target.textContent = "Copied";
          setTimeout(() => { e.target.textContent = "Copy all as text"; }, 1200);
        });
        box.querySelector(".cls").addEventListener("click", () => box.remove());
      }

      /* ---------- toolbar ---------- */
      /* One-shot pass that colours the structural bits as real marks. Doing it
         on every keystroke would fight the caret, so it is a command. */
      /* The automatic pass, expressed as spans over the plain text instead of
         as a rebuilt HTML string. That is what lets HUE stop destroying hand
         made marks: the auto classes are laid over the cells that are already
         there, and lifted off again by the m-auto tag they carry. */
      const AUTO_CLASSES = ["m-title", "m-key", "m-cg", "m-cy", "m-hp"];

      function autoSpans(rawText) {
        const text = normalizeText(rawText);
        const taken = new Array(text.length).fill(false);
        const out = [];
        const claim = (re, cls) => {
          re.lastIndex = 0;
          let m;
          while ((m = re.exec(text)) !== null) {
            if (!m[0].length) { re.lastIndex++; continue; }
            const a = m.index, b = a + m[0].length;
            let free = true;
            for (let i = a; i < b; i++) if (taken[i]) { free = false; break; }
            if (free) {
              for (let i = a; i < b; i++) taken[i] = true;
              out.push([a, b, cls]);
            }
          }
        };

        /* Titles first, and always a whole line at a time. A heading gets
           written a dozen ways - ===== X =====, ## X, **X**, [X], (X), 【X】,
           or a line simply shouted in capitals. Claiming the line before the
           inline rules run is also what stops a heading being torn in half by
           them: [X] alone on a line is a heading, [x] inside a sentence is
           prompt syntax and stays green. */
        claim(/^[ \t]*#{1,6}[ \t]+\S[^\n]{0,80}$/gm, "m-title");
        claim(/^[ \t]*[=~*_+-]{2,}[ \t]*\S[^\n]{0,80}?[ \t]*[=~*_+-]{2,}[ \t]*$/gm, "m-title");
        claim(/^[ \t]*\*\*[^*\n]{1,80}\*\*[ \t]*$/gm, "m-title");
        claim(/^[ \t]*\[[^\[\]\n]{1,80}\][ \t]*$/gm, "m-title");
        claim(/^[ \t]*[【《][^】》\n]{1,80}[】》][ \t]*$/gm, "m-title");
        /* a lone bracketed line, unless it is a weight - (subject:1.2) is a knob */
        claim(/^[ \t]*\((?![^()\n]*:\s*-?[\d.]+\s*\))[^()\n]{1,80}\)[ \t]*$/gm, "m-title");
        /* a line shouted in capitals, with no colon to make it a key */
        claim(/^[ \t]*[A-Z][A-Z0-9 _/'’&\-]{2,60}[ \t]*$/gm, "m-title");

        claim(/<\s*lora:[^>\n]*?>/gi, "m-hp");
        claim(/\[[^\[\]\n]{1,90}\]/g, "m-cg");
        claim(/\([^()\n]{1,90}?:\s*-?[\d.]+\)/g, "m-cy");
        claim(/^[A-Z][A-Z0-9 _/'’\-]{1,44}:/gm, "m-key");
        return out;
      }

      /* Which axis a class belongs to, for deciding whether an automatic mark
         is allowed to sit on a character the user has already marked. */
      function axisOfClass(cls) {
        if (cls === "m-title" || cls === "m-key") return "auto";
        return axisOf(cls);
      }

      function stripAutoMarks(sec) {
        if (!sec.html || !sec.html.includes("m-auto")) return false;
        const { host, cells } = cellsOf(sec);
        for (const cell of cells) {
          if (!cell.cls.includes("m-auto")) continue;      // hand made, keep
          cell.cls = cell.cls.filter(c => c !== "m-auto" && !AUTO_CLASSES.includes(c));
        }
        writeMarks(host, cells);
        /* Nothing left but plain text means no marks at all - store it as
           empty so the section goes back to its lightest form. */
        sec.html = cells.some(c => c.cls.length) ? host.innerHTML : "";
        return true;
      }

      function addAutoMarks(sec) {
        const { host, cells } = cellsOf(sec);
        const spans = autoSpans(cells.map(c => c.ch).join(""));
        if (!spans.length) return false;
        let painted = 0;
        for (const [from, to, cls] of spans) {
          const axis = axisOfClass(cls);
          for (let i = from; i < to && i < cells.length; i++) {
            const cell = cells[i];
            /* A mark the user put here by hand outranks the automatic one on
               the same axis: HUE is a reading aid, not an editor. */
            const handMade = !cell.cls.includes("m-auto") &&
              cell.cls.some(c => axisOfClass(c) === axis);
            if (handMade) continue;
            const set = new Set(cell.cls.filter(c => !AUTO_CLASSES.includes(c)));
            set.add(cls);
            set.add("m-auto");
            cell.cls = Array.from(set);
            painted++;
          }
        }
        if (!painted) return false;
        writeMarks(host, cells);
        sec.html = host.innerHTML;
        return true;
      }

      /* Even heights, keeping the node about the size it already is. */
      /* Level the open sections at their average, so the node keeps roughly
         the height it has now but the boxes line up. */
      root.querySelector(".even").addEventListener("click", () => {
        const open = state.sections.filter(x => !x.collapsed);
        if (!open.length) return;
        const each = Math.max(MIN_H,
          Math.round(open.reduce((n, x) => n + x.h, 0) / open.length));
        for (const x of open) x.h = each;
        touch(); render(); save();
      });

      /* Size every open section to the text it actually holds.

         The measurement cannot come from scrollHeight as the pane sits: the
         pane is an overflow:auto box, so scrollHeight reports the box height
         whenever the box is TALLER than the text - which would let FIT grow a
         section but never shrink one. So each pane is briefly released from
         its absolute bottom edge, measured while it is free to size itself,
         and put straight back. It is all inside one task, so nothing paints
         half-done. */
      function paneNeed(el) {
        if (!el) return null;
        const prevBottom = el.style.bottom;
        const prevHeight = el.style.height;
        const prevOver = el.style.overflowY;
        el.style.bottom = "auto";
        el.style.height = "auto";
        el.style.overflowY = "hidden";
        const h = el.offsetHeight;            // border-box, padding included
        el.style.bottom = prevBottom;
        el.style.height = prevHeight;
        el.style.overflowY = prevOver;
        /* Two small things that Fit used to lose, and together they are why
           fitting always left a scrollbar and a second drag to be rid of it.
           The box is absolutely positioned inside its wrapper, so its own
           height covers the text and its padding but not the wrapper's
           border. And offsetHeight is an integer, while a 10px font on a 1.45
           line height produces fractions all day - a box wanting 100.6px
           reports 100 and clips the last line by a whisker.
           The wrapper's chrome is measured rather than assumed, so it stays
           right if the border ever changes, and one pixel covers the
           rounding. */
        const wrap = el.parentElement;
        const chrome = wrap
          ? Math.max(0, wrap.offsetHeight - wrap.clientHeight) : 0;
        return h + chrome + 1;
      }

      /* A ceiling per section, so one very long piece of text cannot swallow
         the screen: past this it is better left scrolling than made into a
         node nobody can see around. */
      const FIT_MAX = 600;
      /* And a ceiling on what one press of Fit may produce in total. This used
         to be phrased as the widget's own cap - the widget has none any more,
         because that cap was what made the node run away. It is a limit on
         what this button does, nothing more, and it steps aside when the
         pictures already account for the room. */
      const FIT_TOTAL_MAX = 2400;

      /* The height one section wants for the text it is holding.
         Split out so the button in a section header and the one in the toolbar
         cannot drift apart - the same measurement, applied to one or to all. */
      function fitNeed(s, el) {
        const ed = paneNeed(el.querySelector(".lvp-ta"));
        const ex = paneNeed(el.querySelector(".lvp-ext-body"));
        const tr = paneNeed(el.querySelector(".lvp-tr-body"));
        let need;
        if (ex !== null && ed !== null) {
          /* both panes are on screen: paneSplit gives the wired text 40% and
             the box the rest less a 4px divider, so invert that and take
             whichever pane demands the taller section */
          need = Math.max((ed + 4) / 0.6, ex / 0.4);
        } else if (ed === null) {
          need = ex;                                     // wired text replaces it
        } else if (tr !== null) {
          /* box plus translation: the divider between them is a fixed 4px,
             so each pane simply gets what it asks for */
          const th = Math.min(Math.round(FIT_MAX * 0.6), Math.max(TR_MIN, tr));
          s.trH = th;
          need = Math.max(MIN_H, ed) + th + 4;
        } else {
          need = ed;                                     // plain box
        }
        if (!need) need = s.h;                             // nothing to measure
        return Math.min(FIT_MAX, Math.max(MIN_H, Math.ceil(need)));
      }

      root.querySelector(".fit").addEventListener("click", () => {
        const els = list.children;
        const open = [];
        state.sections.forEach((s, i) => {
          if (!s.collapsed && els[i]) open.push([s, els[i]]);
        });
        if (!open.length) return;

        const want = new Map();
        for (const [s, el] of open) want.set(s, fitNeed(s, el));

        /* If the fitted total would run past that ceiling, scale back
           proportionally rather than letting one press produce a node the
           length of a page - every section still keeps its share of the room.
           When the pictures alone have used the budget there is nothing left
           to scale, and the guard below leaves the fitted heights alone. */
        const fixed = state.sections.reduce((n, x) => n + (x.collapsed
          ? HEADER_H + GAP
          : HEADER_H + 6 + GAP + ((!x.on || extLinked(x)) ? 15 : 0)
            + imgBlock(x)), 0);
        const budget = FIT_TOTAL_MAX - chromeHeight() - LIST_PAD - fixed;
        let total = 0;
        for (const h of want.values()) total += h;
        if (total > budget && budget >= open.length * MIN_H) {
          const k = budget / total;
          for (const [s, h] of want) want.set(s, Math.max(MIN_H, Math.floor(h * k)));
        }

        for (const [s, h] of want) { s.h = h; delete s.prevH; }
        /* same order as MIN: the node comes down first, or render's size pass
           hands the reclaimed height straight back to the sections */
        touch();
        fitNodeToContent();
        render();
        save();
      });

      /* Shrink everything down to get the node out of the way, remembering the
         heights so the same button puts them back. */
      const COMPACT_H = 46;
      /* How small this particular section may go.

         Above the text the strip carries its own height, so MIN never touched
         the picture and a landscape reference came through the shrink intact.
         Beside the text there is no separate height to carry: the picture and
         the box share the section's, so squeezing the section to 46px squeezed
         the picture out of existence. Same button, opposite outcome, purely
         because of which way the strip was facing.

         The floor is therefore worked out per section: with a picture beside
         the text, the section may only come down to what that picture needs at
         its current width. Both arrangements now keep their reference and give
         up the writing space, which is what MIN was for. */
      function compactHeightFor(sec) {
        if (!sec.imgOpen || !sec.imgSide || !sec.img) return COMPACT_H;
        const ar = sec.imgAR > 0 ? sec.imgAR : 1;
        const stage = Math.max(40,
          Math.round((imgSideWidth(sec) - SIDE_PAD_X) / ar));
        return Math.max(COMPACT_H,
                        stage + SIDE_CHROME_Y + customExtra(sec) - 6);
      }
      /* Measured against each section's own floor, or a section holding a tall
         picture would never count as shrunk and the button would stay lit with
         no way to press it back. */
      function isCompact() {
        const open = state.sections.filter(x => !x.collapsed);
        return open.length > 0
          && open.every(x => x.h <= compactHeightFor(x) + 2);
      }
      root.querySelector(".compact").addEventListener("click", () => {
        const open = state.sections.filter(x => !x.collapsed);
        if (!open.length) return;
        if (isCompact()) {
          for (const x of state.sections) {
            if (x.prevH) { x.h = Math.max(MIN_H, x.prevH); delete x.prevH; }
          }
        } else {
          for (const x of state.sections) {
            if (!x.collapsed) { x.prevH = x.h; x.h = compactHeightFor(x); }
          }
        }
        /* The node has to come down BEFORE the redraw. render() runs the size
           pass, and that pass hands any spare height back to the sections - so
           shrinking first and resizing afterwards just undid the shrink, which
           is what made this behave exactly like EVEN. */
        touch();
        fitNodeToContent();
        render();
        save();
        refreshToolbar();
      });

      /* Anything marked at all, search hits aside - those are a viewing aid
         and must not make the button look lit. */
      function hasAnyMarks() {
        return state.sections.some(x =>
          (x.html || "").replace(/m-find/g, "").includes("m-"));
      }

      function hasAutoMarks() {
        return state.sections.some(x => (x.html || "").includes("m-auto"));
      }
      /* HUE is a switch on the view, not an edit. Off, the automatic marks
         are lifted and everything else is simply not drawn, so the section
         reads as the plain text that will be sent to the model. On, the
         automatic pass runs again and every hand-made mark - which never left
         the markup - is visible where it was. */
      /* Lit means marks exist and are being drawn, so the press turns them
         off. Unlit means either they are hidden or there are none yet, and
         the press turns them on - running the automatic pass, which is what
         puts something there the first time. Two branches, both of them the
         obvious reading of the button in front of you. */
      const styleIsLit = () => state.fx && hasAnyMarks();

      root.querySelector(".fxb").addEventListener("click", () => {
        const goingOff = styleIsLit();
        snapPush(state.sections,
                 goingOff ? "before hiding effects" : "before showing effects");
        state.fx = !goingOff;
        for (const x of state.sections) {
          if (goingOff) stripAutoMarks(x); else addAutoMarks(x);
        }
        touch(); render(); save();
        /* If nothing matched - empty boxes, or prose with no keywords, LoRA
           tags or brackets - there is nothing to light up, so the button must
           not stay lit. */
        refreshToolbar();
      });

      /* Button states always come from the data, never from a stored flag. */
      root.querySelector(".hundo").addEventListener("click", () => undoStep());
      root.querySelector(".hredo").addEventListener("click", () => redoStep());

      /* Caught in the capture phase and stopped dead, so ComfyUI never sees it
         and the graph is not rolled back underneath the node. */
      root.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && brushMode !== "off") {
          e.preventDefault();
          e.stopPropagation();
          setBrushMode("off");
          return;
        }
        const mod = e.ctrlKey || e.metaKey;
        if (!mod) return;
        const k = (e.key || "").toLowerCase();
        const isUndo = k === "z" && !e.shiftKey;
        const isRedo = (k === "z" && e.shiftKey) || k === "y";
        if (!isUndo && !isRedo) return;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        if (isUndo) undoStep(); else redoStep();
      }, true);

      /* ---------- help ---------- */
      const HELP = `
        <h3>Visual Prompt Composer</h3>
        <p>One prompt, kept in named sections that can be reordered, switched
        off, wired to other nodes, and marked up while staying plain text on
        the way out. Marks are a reading aid: nothing the model receives ever
        contains them.</p>

        <h5>Sections</h5>
        <p><b>+</b> adds one. <b>B</b> bypasses a section - it stays on screen
        and drops out of the prompt. The arrows move it, <b>X</b> deletes it,
        and the dot cycles its colour. Drag the grip under a section to resize
        it; hold <code>Shift</code> to trade height with the section below
        instead of growing the node.</p>
        <p><b>ALIGN &mdash; EVEN</b> levels the open sections, <b>FIT</b> sizes
        each one to the text it holds, and <b>MIN</b> shrinks them all and puts
        them back on a second press.</p>
        <p>The <b>brush</b> next to STYLE is an eyedropper. Press it, click a
        word whose formatting you want, then drag across any other text to
        stamp the same look on it. It stays loaded until you press it again or
        hit <code>Escape</code>, so one pick can be applied all over. It carries
        bold, italic, underline, key, highlight, colour and size - not the
        paragraph dot, and not search hits.</p>
        <p><b>TR</b>, the green switch beside the bypass square, opens a
        translation of that box
        underneath it. It is a reading aid only: it is never saved with the
        layout and never reaches the model. Hovering a piece of text on either side lights
        up its match on the other. The two dropdowns set the language and how
        finely the text is cut before translating: <b>Paragraph</b> reads best
        because the translator can see whole sentences in context,
        <b>Sentence</b> is the middle ground, and <b>Clause</b> breaks long
        sentences at their commas and dashes so you can point at one phrase -
        at the cost of translating fragments. Both apply to every section. Needs Chrome or Edge 138+ on desktop; the
        translation runs on your own machine, so nothing is sent anywhere.</p>
        <p>Marks never reach the model. Whatever is bold, coloured or resized
        here leaves this node as plain text.</p>

        <h5>Marking text</h5>
        <p>Select any run to raise the palette: bold, italic, underline, a
        paragraph dot, four highlights, five text colours, and two size steps.
        The size buttons keep the palette open, so press them as many times as
        you like - four steps up, two down. <b>&#10005;</b> clears the marks
        on the selection.</p>

        <h5>STYLE</h5>
        <p>The switch for everything on screen. Press it unlit and every mark
        is drawn, plus an automatic pass over the structure: headings,
        <code>KEY:</code> lines, <code>[brackets]</code>,
        <code>(weights:1.2)</code> and <code>&lt;lora:name:0.8&gt;</code>.
        Press it lit and it all goes away, leaving the plain text that will
        actually be sent. Nothing is deleted either way - the marks are still
        in the section, waiting.</p>
        <p>It lights up on its own the moment anything is marked, and marking
        something while the effects are hidden switches them back on rather
        than leaving you pressing a button with no visible result.</p>
        <p>A heading is recognised whole-line in any of these shapes:
        <code>===== X =====</code>, <code>## X</code>, <code>**X**</code>,
        <code>[X]</code>, <code>(X)</code>, <code>&#12304;X&#12305;</code>, or a
        line in capitals. Inside a sentence the same brackets stay prompt
        syntax.</p>

        <h5>IMG &mdash; reading a picture</h5>
        <p><b>IMG</b> in a section header opens a strip for the picture. Drop a
        reference image on the square - or copy a screenshot and paste it, with
        the pointer over the strip you mean - then choose which part of it to
        read and press <b>Read</b>. The answer replaces the text in that
        section.</p>
        <p>A landscape picture opens above the box and a portrait one beside
        it, which is where each has room. The two small squares in the strip
        &mdash; bars lying down, bars standing up &mdash; move it the other way, and once you have pressed it that section keeps
        what you chose whatever you drop on it next. The grip resizes the
        picture in either arrangement &mdash; downwards above the box, sideways
        beside it.</p>
        <p>The question is chosen for you from the section's name &mdash; a
        section called <i>Camera Anchor</i> opens on the camera question, which
        describes angle, distance, depth of field and light and leaves the
        subject and the setting alone. Pick a different one, or
        <b>Custom&hellip;</b> to write your own. One picture for each section,
        each read for one layer, is what this node is for. <i>Subject Anchor</i>
        reads how the person looks and what they wear; <i>Pose Anchor</i> reads
        only what the body is doing, so a pose can be taken from one picture
        and the clothes from another.</p>
        <p><b>READER</b> in the toolbar chooses the model, the quantization and
        how long an answer may run, and unloads the model when you want the
        memory back. Reading needs <code>transformers</code> installed in the
        environment ComfyUI runs in; the button says so if it is missing.</p>

        <h5>SEARCH</h5>
        <p>Typing searches as you go. <b>FIND</b> and the arrows walk the hits
        one at a time - <code>Enter</code> for the next,
        <code>Shift+Enter</code> for the previous - opening any collapsed
        section on the way. <b>Aa</b> matches case, <b>|W|</b> whole words, and
        the menu limits the search to one section.</p>
        <p><b>REPLACE ALL</b> swaps the text and leaves the marks around it
        alone; <b>UNDO</b> next to it puts that one replacement back. The
        <b>EFFECT</b> row applies any palette mark to every hit at once, which
        is the quick way to colour or resize a word everywhere it appears.</p>

        <h5>STEP &mdash; UNDO / REDO</h5>
        <p>Undoes changes inside this node only, so the graph and the node's
        own size are left alone. <code>Ctrl+Z</code> and
        <code>Ctrl+Shift+Z</code> do the same while the pointer is over the
        node. Typing in a burst counts as one step.</p>

        <h5>SAVE and PRESET</h5>
        <p><b>SAVE</b> keeps snapshots of the whole layout in
        <code>user/visual_prompt_composer/snapshots.json</code>. The ones
        taken automatically before a risky action rotate; the ones you save by
        hand are marked <code>*</code>, counted separately, and never dropped
        to make room for an automatic one.</p>
        <p><b>PRESET</b> on a section keeps named versions of that section's
        text, shared by every workflow on this machine. The library is a file -
        <code>user/visual_prompt_composer/presets.json</code> - so clearing
        site data or changing browser no longer loses it. Export writes the
        same file for another machine; import merges rather than replaces, and
        the newer copy of a name wins.</p>
        <p>The panel header shows how full the library is. At the cap a save is
        refused and says so - nothing already saved is ever dropped to make
        room for something new.</p>

        <h5>PASTE</h5>
        <p>Copy a whole reply - a scene name, then each anchor under its own
        label (<code>QUALITY</code>, <code>SUBJECT</code>, <code>POSE</code>,
        <code>SCENE</code>, <code>CAMERA</code>, <code>ABSOLUTE</code>) with
        its text in a code box or on the lines below - and press <b>Paste</b>,
        or hover the node and press <code>Ctrl+V</code>. Each anchor lands in
        its own section, sections the reply does not mention are left alone,
        the node takes the scene's name, and every box is fitted to its text.
        Commentary around the blocks is ignored.</p>

        <h5>Wired sections</h5>
        <p>A section with an <code>ext_</code> input shows what is arriving on
        it. The section then either replaces its own text with what came in,
        or joins the two - the badge in its header switches between the two
        and says which is in force.</p>`;

      const BOOK_HELP = `
        <h3>Visual Series Book</h3>
        <p>A whole series in one node. Every anchor is kept once, as a
        <b>capsule</b>, and a <b>prompt</b> is a list of capsules. Prompts that
        share a capsule share the words themselves: edit the Subject in one
        prompt and every prompt using it has changed. Everything below the book
        is the Prompt Composer, working on the prompt that is open.</p>

        <h5>Series</h5>
        <p>One book can hold several series. Each has its own box, its own
        number and its own capsules, and its prompts are numbered within it:
        <code>2-03</code> is the third scene of series 2. <b>+ Series</b>
        starts one; double click its name to rename it, the caret folds it,
        and dragging a prompt onto another series' box moves it there.</p>
        <p>A capsule belongs to one series. Prompts of the same series share
        capsules; a capsule taken into another series arrives there as a copy,
        so work on a new series never changes a finished one.</p>
        <p>Every series is written to its own file in
        <code>user/visual_series_book/series/</code> a few seconds after it
        changes. <b>&#10005;</b> on a series box closes the whole series - the
        file is kept, and closing the last one leaves an empty series to start
        on. <b>Files</b> brings any saved series back.</p>
        <p>The whole book can be kept as one file as well. In <b>Files</b>,
        <b>Save book</b> writes every series, prompt and capsule, the open
        prompt included, to <code>user/visual_series_book/books/</code> under
        the name typed; the same name again updates it. <b>Open</b> beside a
        saved book brings it into any Series Book - so one workflow serves
        every series. Opening takes the place of the book on the node, after
        asking. A book file kept elsewhere opens with <b>Open a file from the
        computer</b>.</p>

        <h5>Prompts</h5>
        <p>Click a prompt to open it, double click to rename it, drag to
        reorder. The small outline after a prompt's name is the frame it wants
        - portrait, landscape, square, or dashed for any; click it to change.
        A Series Lab rendering the prompt makes a Visual Latent Size Picker
        pick only sizes of that shape. The icons at the top right of a series box act on its
        prompts: <b>new</b> starts an empty scene, keeping only the LoRA
        trigger; <b>duplicate</b>
        copies the open prompt, sharing every capsule; <b>delete</b> removes
        it, and its capsules stay on the shelf. <b>Copy Text</b> copies the
        open series as text, the way Paste reads it. <b>From Canvas</b> brings
        in every Prompt Composer on the canvas, in Series
        Lab order when they are wired to one, and turns identical anchors into
        one capsule.</p>

        <h5>Paste</h5>
        <p>Paste a reply with a scene name the book does not have and it
        becomes a new prompt, carrying over whatever the reply leaves out from
        the prompt that is open. A name the book already has updates that
        prompt. Right after <b>new</b> or <b>duplicate</b>, the paste fills the
        fresh prompt instead. Pasted text that matches a capsule already on the
        shelf reuses it.</p>

        <h5>Capsules</h5>
        <p>One row per kind of anchor, one colour per row. The number is how
        many prompts use the capsule; 0 means it is in none. <b>Click</b>
        puts it in the open prompt in place of the one of its kind,
        <b>Shift+click</b> puts it in every prompt of the open series, and
        <b>Ctrl+Shift+click</b> in every prompt of every series - each series
        getting its own copy. <b>Alt+click</b> adds it beside the capsule of its
        kind instead of in its place - two scene capsules, say, the palace and
        the day's forecourt - and both are used. Dragging it onto a section or
        onto a prompt does the same there; hold Alt on the drop to add it beside. With several series, the series are named beside
        CAPSULES: click one to see only its capsules, or <b>All</b>. Double click renames,
        <b>&#10005;</b> deletes - twice when a prompt is using it.</p>
        <p>A capsule no prompt uses reads <b>0</b>. <b>In use</b> hides those
        without deleting them; <b>Tidy</b> deletes all of them in the series
        shown at once, after a second click, and Undo brings them back.</p>
        <p>To change one prompt only, give it its own capsule: paste the new
        text, or duplicate the section and edit the copy.</p>
        <p><b>Reading a capsule's number.</b> <code>03</code> - the capsule of
        prompt 03. <code>03-2</code> - the second try at that layer for prompt
        03. <code>03+</code> - more prompts use it as well. With several series
        the series comes first, in its colour: <code>2 | 03-1</code> is series
        2, prompt 03, first try. The number is given once, by the prompt the
        capsule was first written for, and kept: used in another prompt,
        copied into another series, left unused - it still says where it came
        from. When that prompt is renumbered or moved, its capsules' numbers
        follow it. A dim number is a capsule no prompt uses now; the
        tooltip names the prompts that do.</p>
        <p>Click a label - QUALITY, POSE... - to fold that row down to the
        open prompt's own capsules; shift+click folds or opens every row.</p>

        <h5>Series</h5>
        <p>Start a new series when the story starts over - the numbers then
        run 01, 02, 03 again instead of carrying on behind the first attempt.
        Drag a prompt onto another series to move it there: it takes that
        series' next number, and an untouched <i>Scene 1</i> gives up its
        place to it. The dot beside the name sets the series' colour, here and
        in the Series Lab. Click under the name to write a note about the
        series - what it is, what was tried. A new prompt starts empty.
        The sort button lines the prompts up in number order;
        shift+click numbers them again from 01 as they stand.</p>

        <h5>Drawer</h5>
        <p>Anchors kept for good, for any series and any workflow - one drawer
        for the whole computer. <b>Keep</b> one by right clicking a capsule or
        dragging it onto the Drawer; the picture on the Image Viewer goes with
        it. <b>Click</b> a card and it asks before putting it in the open
        prompt, naming the capsule it would replace; <b>double click</b> puts
        it on the open series' shelf; <b>right click</b> edits the card;
        <b>drag</b> it onto a section or a prompt.
        The tabs narrow the drawer by kind and the tags under them by tag;
        <b>This Prompt</b> lays the open prompt out as cards, with the anchor
        check above them. The slider sizes the cards, the dot sets the drawer's
        colour, the two layout pictures put it under the book or beside it,
        and the strip under it, dragged, makes it taller.</p>

        <h5>Search</h5>
        <p><b>this series</b> is the first scope, <b>every series</b> the
        next. The open prompt is marked as usual and every capsule with a hit
        lights up on the shelf; REPLACE ALL changes each capsule once, so
        every prompt using it follows.</p>

        <h5>Series Lab</h5>
        <p>Wire <code>series</code> into the Series Lab's <code>series</code>
        socket and every prompt appears on its prompt shelf, named as it is
        here. A book prompt in a recipe offers a <b>&#8644; sweep</b> chip:
        one render per capsule - every camera, every light, every pose on the
        shelf - or per combination you put together, a pose from one series
        with a camera from another.</p>`;

      let helpBox = null;
      function readerSettings() {
        const r = state.reader || {};
        const sug = VLM.suggested || {};
        /* Only the blanks are filled in. Once a value is in state.reader it is
           the user's, and stays theirs however much memory the card has. */
        return {
          model: r.model || sug.model || VLM.defaultModel,
          quant: r.quant || sug.quant || "none",
          tokens: Number(r.tokens) || VLM.defaultTokens,
          idle: r.idle === undefined || r.idle === null
            ? (sug.idle_minutes === undefined ? 2 : sug.idle_minutes)
            : Number(r.idle),
          after: !!r.after,
          purge: !!r.purge,
        };
      }

      /* What the card is holding, drawn on its own so it can be redrawn.
         It used to be built once with the panel and then never touched, so it
         still said "No model in memory" while the model was plainly loaded and
         the reading was running. */
      function memoryLines() {
        /* Two lines that were saying different kinds of thing in the same
           voice. The suggestion is a one-off remark about the card; what is in
           memory changes minute by minute and is the reason anyone opens this
           panel. They are no longer the same weight.

           And the suggestion only appears where it has something to add. It
           used to sit there reading "unload after 3 min" while the box above
           said 2, in the same colour, which reads as the setting not having
           taken rather than as advice being declined. Now silence means the
           settings match the advice, and the line appearing means they do
           not - which is the only time it is worth a word. */
        const sug = VLM.suggested;
        const cur = readerSettings();
        const differs = [];
        if (sug) {
          if (sug.quant && sug.quant !== cur.quant) differs.push(sug.quant);
          if (sug.idle_minutes !== undefined
              && Number(sug.idle_minutes) !== Number(cur.idle)) {
            differs.push(`unloading after ${sug.idle_minutes} min`);
          }
        }
        const advice = differs.length
          ? `<p class="vram advice">${escapeHtml(
              `${sug.note} - ${differs.join(" and ")} suggested`)}</p>`
          : "";
        const held = VLM.loaded
          ? `<p class="vram held">Holding ${escapeHtml(String(VLM.loaded).split("/").pop())}`
            + `${VLM.loadedQuant ? ` at ${escapeHtml(VLM.loadedQuant)}` : ""}`
            + ` in memory now</p>`
          : `<p class="vram idle">No model in memory</p>`;
        return advice + held;
      }

      let readerBox = null;
      function closeReader() {
        if (!readerBox) return;
        if (readerBox.__place) window.removeEventListener("resize", readerBox.__place);
        if (readerBox.__raf) cancelAnimationFrame(readerBox.__raf);
        if (readerBox.__away)
          document.removeEventListener("pointerdown", readerBox.__away, true);
        if (readerBox.__poll) clearInterval(readerBox.__poll);
        readerBox.remove();
        readerBox = null;
      }
      root.querySelector(".reader").addEventListener("click", (e) => {
        e.stopPropagation();
        if (readerBox) { closeReader(); return; }
        const cur = readerSettings();
        const box = document.createElement("div");
        box.className = "lvr-panel " + ROOT_CLASS;
        box.innerHTML = `
          <h4>Image reader</h4>
          ${VLM.problem ? `<p class="lvr-warn">${escapeHtml(VLM.problem)}</p>` : ""}
          <label>Model</label>
          <select class="m">${VLM.models.map(m =>
            `<option value="${m}"${m === cur.model ? " selected" : ""}>${m.split("/").pop()}</option>`
          ).join("")}</select>
          <label>Quantization</label>
          <select class="q">${VLM.quants.map(q =>
            `<option value="${q}"${q === cur.quant ? " selected" : ""}>${q}</option>`
          ).join("")}</select>
          <label>Longest answer (tokens)</label>
          <input class="t" type="number" min="32" max="1024" step="10" value="${cur.tokens}">
          <label>Unload after idle (minutes, 0 = never)</label>
          <input class="i" type="number" min="0" max="120" step="1" value="${cur.idle}">
          <label class="chk">
            <input class="u" type="checkbox"${cur.after ? " checked" : ""}>
            <span>Unload as soon as a reading is done</span>
          </label>
          <label class="chk">
            <input class="p" type="checkbox"${cur.purge ? " checked" : ""}>
            <span>Free ComfyUI's models before every reading</span>
          </label>
          <div class="mem">${memoryLines()}</div>
          <div class="foot">
            <button class="lvp-btn drop">Unload model</button>
            <button class="lvp-btn done">Close</button>
          </div>`;
        document.body.appendChild(box);
        const btn = root.querySelector(".reader");
        const place = () => {
          const r = btn.getBoundingClientRect();
          const w = box.offsetWidth || 600;
          const h = box.offsetHeight || 220;
          /* under the button, and only pushed back when the window would
             otherwise cut it off */
          box.style.left = Math.round(Math.max(
            8, Math.min(r.left, window.innerWidth - w - 8))) + "px";
          box.style.top = Math.round(r.bottom + 6 + h < window.innerHeight
            ? r.bottom + 6
            : Math.max(8, r.top - h - 6)) + "px";
        };
        place();
        window.addEventListener("resize", place);
        box.__place = place;

        /* The panel lives on the page, the button lives on a canvas that pans
           and zooms underneath it. Nothing fires an event when the graph is
           dragged, so the anchor is watched instead and the panel is moved
           only when it has actually shifted. When the button is no longer
           laid out at all - node collapsed, scrolled away, deleted - there is
           nothing left to anchor to and the panel closes rather than parking
           itself in the top corner. */
        let mark = "";
        const follow = () => {
          if (!readerBox) return;
          const r = btn.getBoundingClientRect();
          if (!r.width || !btn.isConnected) { closeReader(); return; }
          const key = Math.round(r.left) + "," + Math.round(r.bottom);
          if (key !== mark) { mark = key; place(); }
          box.__raf = requestAnimationFrame(follow);
        };
        box.__raf = requestAnimationFrame(follow);

        /* click anywhere else and it goes away, like every other popover on
           the canvas */
        const away = (ev) => {
          if (box.contains(ev.target) || btn.contains(ev.target)) return;
          closeReader();
        };
        document.addEventListener("pointerdown", away, true);
        box.__away = away;

        /* The model comes and goes while the panel is open - a reading loads
           it, the idle timer drops it - so the panel asks rather than
           remembering. Only while it is open, and it stops with it. */
        const drawMemory = () => {
          const mem = readerBox && readerBox.querySelector(".mem");
          if (mem) mem.innerHTML = memoryLines();
        };
        const refreshMemory = async () => {
          const before = `${VLM.loaded}|${VLM.loadedQuant}`;
          try { await vlmState(); } catch (e) { return; }
          if (!readerBox) return;
          if (`${VLM.loaded}|${VLM.loadedQuant}` === before) return;
          drawMemory();
        };
        box.__poll = setInterval(refreshMemory, 1500);
        refreshMemory();

        readerBox = box;

        const keep = () => {
          const idleRaw = box.querySelector(".i").value;
          state.reader = {
            model: box.querySelector(".m").value,
            quant: box.querySelector(".q").value,
            tokens: Number(box.querySelector(".t").value) || VLM.defaultTokens,
            /* 0 is a real choice here - never unload - so an empty box falls
               back to the suggestion while a typed 0 is kept */
            idle: idleRaw === "" ? null : Math.max(0, Math.min(120, Number(idleRaw) || 0)),
            /* the idle wait still stands for anyone who leaves this off */
            after: !!box.querySelector(".u").checked,
            purge: !!box.querySelector(".p").checked,
          };
          save();
        };
        box.querySelectorAll("select,input").forEach(el =>
          el.addEventListener("change", () => { keep(); drawMemory(); }));
        box.querySelector(".drop").addEventListener("click", async (ev) => {
          ev.stopPropagation();
          try { await api.fetchApi("/leiel_vpc/vlm/unload", { method: "POST" }); }
          catch (err) { /* nothing loaded is not a problem */ }
        });
        box.querySelector(".done").addEventListener("click", (ev) => {
          ev.stopPropagation(); keep(); closeReader();
        });
        ["keydown", "keyup", "keypress", "pointerdown", "wheel"].forEach(k =>
          box.addEventListener(k, ev => ev.stopPropagation()));
      });

      function closeHelp() {
        if (helpBox) { helpBox.remove(); helpBox = null; }
      }
      /* The capsule guide: the shelf's own figures, drawn as the shelf draws
         them, each with one line on what it means - a key, not an essay.
         Opened from the ? on the CAPSULES bar; a second press, Close or Esc
         puts it away. */
      const capChip = (pn, cls, name, u) =>
        `<span class="lsb-c${cls}" style="--k:${KIND_HUE.camera};cursor:default">`
        + pn + `<span class="nm">${name}</span><b class="u">${u}</b></span>`;
      const capHelp = () => `
        <h3>Capsules</h3>
        <p class="sub">Every anchor of a prompt is a capsule. Prompts that use
        the same capsule share its words: change it once and every prompt
        using it follows.</p>
        <h5>Reading a capsule</h5>
        <table>
          <tr><td>${capChip(`<b class="pn">03</b>`, "", "Low, Whole Van", 1)}</td>
            <td>In prompt <b>03</b>. The last figure is how many prompts use it.</td></tr>
          <tr><td>${capChip(`<b class="pn">03+</b>`, "", "Ochre Head Scarf", 4)}</td>
            <td>In several prompts - <b>03</b> is the first of them.</td></tr>
          <tr><td>${capChip(`<b class="pn was">03</b>`, " idle", "Side-On, Whole Van", 0)}</td>
            <td>In no prompt now. The faint figure is the prompt it was last in.</td></tr>
          <tr><td>${capChip(`<b class="pn">03<i class="sq">-2</i></b>`, "", "Wide, Whole Van", 1)}</td>
            <td>The second capsule of this row written for prompt 03 -
            <b>-1</b> is the first try, <b>-3</b> the third. Shown only when
            a prompt has more than one.</td></tr>
          <tr><td>${capChip(`<b class="pn">03</b>`, "", "High Sun v2", 1)}</td>
            <td><b>v2</b>: new words pasted under a name already on the
            shelf. The first version is kept beside it.</td></tr>
        </table>
        <h5>Mouse</h5>
        <table>
          <tr><td><b>Click</b></td><td>Put it in the open prompt, in place of the one of its kind. Click a lit one to take it out again - it stays on the shelf.</td></tr>
          <tr><td><b>Shift+click</b></td><td>Put it in every prompt of the open series.</td></tr>
          <tr><td><b>Ctrl+Shift+click</b></td><td>Every prompt of every series - each series gets its own copy.</td></tr>
          <tr><td><b>Drag</b></td><td>Onto a section or a prompt chip, to put it there.</td></tr>
          <tr><td><b>Double click</b></td><td>Rename.</td></tr>
          <tr><td><b>Hover</b></td><td>Read the whole text - translated as well when <b>TR</b> is on.</td></tr>
          <tr><td><b>Right click</b></td><td>Keep it in the Drawer, for any series later - with the picture a Visual Image Viewer is showing.</td></tr>
          <tr><td><b>&#10005;</b></td><td>Delete. Twice when a prompt is using it; Undo brings it back.</td></tr>
        </table>
        <h5>The bar</h5>
        <table>
          <tr><td><b>This prompt</b></td><td>Show only the capsules of the prompt open now - every one written for it, used or not, and what it wears. Nothing is deleted.</td></tr>
          <tr><td><b>In use</b></td><td>Hide the capsules no prompt uses. Nothing is deleted.</td></tr>
          <tr><td><b>Tidy</b></td><td>Delete every capsule no prompt uses - two clicks, Undo brings them back.</td></tr>
          <tr><td><b>TR</b></td><td>Translate capsules on hover, on your own machine.</td></tr>
          <tr><td><b>Series names</b></td><td>With several series, show one series' capsules, or <b>All</b>.</td></tr>
        </table>
        <h5>Pasting a reply</h5>
        <table>
          <tr><td><code>CAMERA&nbsp;&middot;&nbsp;Name</code></td><td>The name after the dot becomes the capsule's name.</td></tr>
          <tr><td>Same words</td><td>Words already on the shelf reuse that capsule - no copy is made.</td></tr>
          <tr><td>New words</td><td>Become a new capsule for this prompt; the old one stays for the prompts still using it.</td></tr>
        </table>
        <h5>The Drawer</h5>
        <p><b>Right click</b> a capsule, or drag it onto the Drawer below,
        to keep it for any series later. The <b>?</b> on the Drawer's bar
        explains the rest.</p>
        ${TOGETHER_HELP}`;
      /* What both guides say: the way a series is kept together, and why the
         person and the clothes sit in two capsules. */
      const TOGETHER_HELP = `
        <h5>Keeping a series together</h5>
        <p>Give Quality and Subject the same words in every scene and one
        capsule serves them all. Keep the person in Subject - face, build,
        age - and the clothes in <b>Outfit</b>: then a change of clothes is
        one click, and the same face carries from one series to the next.
        Put what differs from scene to scene in Pose and Scene.</p>
        <p><b>Outfit</b> is optional. A reply with an <code>OUTFIT</code>
        label (or <code>WARDROBE</code>) adds it; a prompt without one works
        as before.</p>`;
      const drawerHelp = () => `
        <h3>Drawer</h3>
        <p class="sub">Anchors kept for good - an outfit, a pose, a camera
        that worked - outside any series. One drawer for every Series Book on
        this computer, whatever workflow is open, so what was kept in one
        series is there in the next.</p>
        <h5>Keeping</h5>
        <table>
          <tr><td><b>Right click a capsule</b></td><td>Keep it in the Drawer. The Drawer opens to show it. The picture open in a Visual Image Viewer - or the one framed in its grid - comes along as the card's picture.</td></tr>
          <tr><td><b>Drag a capsule</b></td><td>Onto the Drawer - the same thing.</td></tr>
          <tr><td><b>Tags</b></td><td>A capsule named <code>Amara,&nbsp;Denim&nbsp;Shirt</code> is tagged <b>Amara</b> on its own.</td></tr>
          <tr><td><b>Same words</b></td><td>Kept once: words already in the Drawer are not kept twice.</td></tr>
        </table>
        <h5>Using a card</h5>
        <table>
          <tr><td><b>Click</b></td><td>Asks first, naming the capsule it would replace. <b>Put it in</b> or Enter puts it in the open prompt, in place of the one of its kind.</td></tr>
          <tr><td><b>Drag</b></td><td>Onto a section - put in at once, without asking.</td></tr>
          <tr><td><b>Hover</b></td><td>Read its words.</td></tr>
          <tr><td><b>Double click</b></td><td>Put it in the open prompt at once, without asking - in place of the one of its kind.</td></tr>
          <tr><td><b>Alt+double click</b></td><td>Add it to the capsules of the open series, without putting it in the prompt - gather several, then sweep them in the Series Lab.</td></tr>
          <tr><td><b>Right click</b></td><td>Open the card: name, kind, tags, words and picture. <b>Edit card</b> in the ask does the same.</td></tr>
          <tr><td><b>Orange !</b></td><td>Putting this one in would clash with the open prompt - most often a pose or outfit against its camera. Hover it to read why.</td></tr>
          <tr><td><b>&#10005;</b></td><td>Take it out of the Drawer - two clicks.</td></tr>
        </table>
        <h5>Finding</h5>
        <table>
          <tr><td><b>Kinds</b></td><td>Along the bar, in the order of the capsule rows. The figure is how many cards.</td></tr>
          <tr><td><b>Tags</b></td><td>Under the bar - one at a time; click again to show all.</td></tr>
          <tr><td><b>find</b></td><td>Narrows by name, tag and words as you type.</td></tr>
        </table>
        <h5>This Prompt</h5>
        <table>
          <tr><td><b>The tab</b></td><td>The open prompt as a set of cards, light to rules - each with the picture of the drawer card holding its words.</td></tr>
          <tr><td><b>Dashed</b></td><td>Not in the drawer yet. Right click it to keep it, with the viewer's picture.</td></tr>
          <tr><td><b>Double click</b></td><td>Open its drawer card - to change the picture.</td></tr>
          <tr><td><b>The check</b></td><td>Above the cards, where the anchors pull apart - a face crop with a walking pose and shoes, a standing figure in a wide frame, lens words outside the Camera. Orange is likely to show in the picture, grey is worth knowing. It only warns; the words are never changed. The orange <b>! to check</b> on the Capsules bar opens it.</td></tr>
        </table>
        <h5>Pictures</h5>
        <table>
          <tr><td><b>Click in the viewer</b></td><td>With a card open, click a picture in a Visual Image Viewer and it goes on the card.</td></tr>
          <tr><td><b>Right click a capsule</b></td><td>Keeps it with the picture a Visual Image Viewer is showing.</td></tr>
          <tr><td><b>Paste, drop, file</b></td><td>Any picture, pasted or dropped onto the open card, or chosen from disk.</td></tr>
          <tr><td><b>Where</b></td><td>Made small and kept inside the drawer file itself - the original is not copied, and can be moved or deleted.</td></tr>
        </table>
        <h5>Cards that mix</h5>
        <p>A card from one scene meets cards from others, so each should
        say only its own part: light and film in <b>Quality</b>, lens,
        distance and framing in <b>Camera</b>, the place in <b>Scene</b>,
        the body in <b>Pose</b>. A quality that names a lens, or a camera
        that names the frame's shape, fights the cards beside it - and the
        picture can come out as two pictures in one. Leave the frame's
        shape to the latent size.</p>
        <h5>The drawer file</h5>
        <p>Everything - cards, tags, pictures - is one file:
        <code>user/visual_series_book/drawer.json</code>. Copy it to keep a
        backup or to take the Drawer to another computer. Updating the pack
        does not touch it. It starts with a set of ready-made cards; cards
        added to the pack later arrive on their own, and a card taken out
        does not come back.</p>
        ${TOGETHER_HELP}`;
      let capHelpBox = null;
      let capHelpWhich = null;
      function closeCapHelp() {
        if (capHelpBox) { capHelpBox.remove(); capHelpBox = null; }
        capHelpWhich = null;
        document.removeEventListener("keydown", capHelpEsc, true);
        document.removeEventListener("pointerdown", capHelpOut, true);
      }
      /* a press anywhere else puts the guide away - but not on a ? itself,
         which toggles it on its own click */
      function capHelpOut(ev) {
        if (!capHelpBox || capHelpBox.contains(ev.target) || ev.target.closest?.(".lsb-chelp")) return;
        closeCapHelp();
      }
      function capHelpEsc(ev) {
        if (ev.key === "Escape") { ev.stopPropagation(); closeCapHelp(); }
      }
      /* One guide open at a time: the ? that opened it closes it, the other
         ? swaps it for its own. */
      function openCapHelp(btn, which = "caps") {
        const again = capHelpBox && capHelpWhich === which;
        closeCapHelp();
        if (again) return;
        const box = document.createElement("div");
        box.className = "lvp-help lsb-caphelp " + ROOT_CLASS;
        box.innerHTML = (which === "drawer" ? drawerHelp() : capHelp()) +
          '<div class="close"><button class="lvp-btn hclose">Close</button></div>';
        const r = btn.getBoundingClientRect();
        document.body.appendChild(box);
        const w = box.getBoundingClientRect().width;
        box.style.left = Math.max(8, Math.min(r.right - w,
          window.innerWidth - w - 8)) + "px";
        /* on whichever side of the ? has more room, and never over the ?
           itself - the guide scrolls inside when the window is short */
        const below = window.innerHeight - r.bottom - 14, above = r.top - 14;
        const room = Math.max(160, Math.max(below, above));
        box.style.maxHeight = room + "px";
        const h = Math.min(box.getBoundingClientRect().height, room);
        box.style.top = (below >= above || below >= h)
          ? (r.bottom + 6) + "px"
          : Math.max(8, r.top - h - 6) + "px";
        capHelpBox = box;
        capHelpWhich = which;
        box.querySelector(".hclose").addEventListener("click", (ev) => {
          ev.stopPropagation();
          closeCapHelp();
        });
        ["keyup", "keypress", "pointerdown", "wheel"].forEach(k =>
          box.addEventListener(k, ev => ev.stopPropagation()));
        document.addEventListener("keydown", capHelpEsc, true);
        setTimeout(() => document.addEventListener("pointerdown", capHelpOut, true), 0);
      }
      root.querySelector(".help").addEventListener("click", (e) => {
        e.stopPropagation();
        if (helpBox) { closeHelp(); return; }
        const box = document.createElement("div");
        box.className = "lvp-help " + ROOT_CLASS;
        box.innerHTML = (BOOK ? BOOK_HELP : "") + HELP +
          '<div class="close"><button class="lvp-btn hclose">Close</button></div>';
        /* The button sits at the bottom of the node, so the panel opens above
           it whenever there is not enough room underneath. */
        const r = e.currentTarget.getBoundingClientRect();
        box.style.left = Math.max(8, Math.min(r.left - 440,
          window.innerWidth - 490)) + "px";
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
        ["keydown", "keyup", "keypress", "pointerdown", "wheel"].forEach(k =>
          box.addEventListener(k, ev => ev.stopPropagation()));
      });

      function refreshToolbar() {
        const un = root.querySelector(".hundo");
        const re = root.querySelector(".hredo");
        if (un) un.disabled = !hist.length;
        if (re) re.disabled = !fut.length;
        const c = root.querySelector(".compact");
        const h = root.querySelector(".fxb");
        if (c) c.classList.toggle("on", isCompact());
        if (h) h.classList.toggle("on", styleIsLit());
        const br = root.querySelector(".brush");
        if (br) {
          br.classList.toggle("on", brushMode === "pick");
          br.classList.toggle("loaded", brushMode === "apply");
          br.title = brushMode === "off"
            ? "Format brush - click styled text to pick its formatting up, then drag over other text to apply it. Escape puts it down"
            : `Format brush: ${brushLabel()} - drag over text to apply, Escape to put it down`;
        }
      }
      root.querySelector(".brush").addEventListener("click", () => {
        /* one button, three states: idle -> waiting to pick -> loaded. Pressing
           it while loaded puts the formatting down again. */
        setBrushMode(brushMode === "off" ? "pick" : "off");
        if (brushMode === "pick") hideMarkBar();
      });

      root.querySelector(".add").addEventListener("click", () => {
        if (state.sections.length >= MAX_SLOTS) return;
        state.sections.push({
          id: nextId(), slot: 0, title: "New Section", text: "", html: "",
          on: true, h: 90, extMode: "replace",
        });
        assignSlots(); touch(); render(); save();
      });
      root.querySelector(".find").addEventListener("click", openFind);
      root.querySelector(".paste").addEventListener("click", pasteFromClipboard);
      root.querySelector(".save").addEventListener("click", openSave);
      /* ---------- widget mount ---------- */
      const w = node.addDOMWidget("leiel_vpc", "div", root, { serialize: false });
      /* The node is sized by its contents, full stop.

         Reading node.size to decide this widget's height is a trap: LiteGraph
         treats the widget height as the node's minimum, so once the node grows
         it can never shrink again. So nothing here ever reads or writes
         node.size - the section heights are the only input, and the node
         follows them. Resize by dragging a section's grip, or FILL / FIT /
         collapse. */
      /* ComfyUI does not stretch a DOM widget: the element is exactly as tall
         as this returns. So the widget reports the height its sections need,
         and the node is then snapped to that total - which is the only way to
         guarantee no dead space under the last box. Depends on nothing but
         the section heights. */
      /* No ceiling.

         There used to be a Math.min(2400) here, and it was the cause of the
         runaway. Everything that sizes this node is derived from the gap
         between what this reports and what the sections actually need:
         adoptNodeHeight works out the chrome as computeSize - contentHeight.
         While the content stayed under the cap that gap was a small positive
         constant. Four pictures put the content at roughly 2700, the reported
         height stuck at 2400, and the gap went negative - so the node was told
         it had 300px more room than it had, handed that room to the boxes,
         grew the content further, and came back 200ms later to do it again.
         The cap could never be reached, so it never stopped.

         Four full-height references genuinely are a very tall node. Saying so
         is the honest answer; MIN and collapse are there for when it is too
         tall to work in. */
      /* What the layout model is short of, as the browser measured it. Kept
         apart from the section heights on purpose - see absorbOverflow. */
      let overflowPad = 0;
      const OVERFLOW_MAX = 32;
      /* Side by side the book is a column of its own over a footer row that
         spans both. The node's box holds a little less than the height asked
         for, and in one column that difference is a list scrolling; in the
         book's column there is nothing to scroll, so the book ran down over
         the footer's line - above all with the anchors folded. What the book
         is actually short of is measured on the page and carried here. It
         cannot run away: the book's height does not depend on the node's. */
      let sidePad = 0;
      function measureSidePad() {
        if (!sideMode() || !root.clientHeight) return false;
        const b = root.querySelector(".lsb-left");
        if (!b || !b.offsetHeight) return false;
        const short = Math.ceil(b.offsetTop + b.offsetHeight + WRAP_GAP
          + ((foot && foot.offsetHeight) || 14) + WRAP_PAD - root.clientHeight);
        const next = Math.max(0, Math.min(200, sidePad + short));
        if (Math.abs(next - sidePad) < 1) return false;
        sidePad = next;
        return true;
      }

      w.computeSize = function (width) {
        return [width, Math.max(120, contentHeight() + overflowPad + (sideMode() ? sidePad : 0))];
      };

      /* Keep the node exactly as tall as its contents.
         Safe from the runaway that happened before: nothing overrides
         onResize any more, so setSize cannot come back around to us. */
      const beingResized = () => app.canvas?.resizing_node === node;

      let snapping = false;
      /* Force the node down to whatever the sections now need. Without this,
         shrinking the boxes just leaves the node the same size and the
         next size pass hands the spare room straight back to them - which is
         why COMPACT looked identical to EVEN. */
      function fitNodeToContent() {
        try {
          measureSidePad();
          node.setSize([Math.max(node.size[0], 420), node.computeSize()[1]]);
          node.setDirtyCanvas(true, true);
          /* the book's shortfall shows only once the new size is laid out */
          if (sideMode()) requestAnimationFrame(() => requestAnimationFrame(snapNode));
        } catch (e) { /* ignore */ }
      }

      /* The arithmetic above is a model of the layout, and a model can always
         be a pixel or two behind the browser - a font that renders a line
         taller, a border that changes. Rather than trust it absolutely, look
         at what actually happened: if the list is still scrolling, the node
         takes on exactly the overflow. Once per render, never while the node
         is being dragged, and the height goes to the node rather than to the
         sections, so it cannot feed back into the content and run away. */
      /* This used to add the overflow to node.size, and that was a ratchet.
         snapNode reads any node taller than its contents as the user having
         dragged it taller, and hands the slack to the sections - so the
         correction became section height, was saved with the workflow, and
         the next measurement started from the bigger boxes. Harmless while
         the overflow was a real pixel or two. But coming back to a workflow
         tab re-renders the node before the canvas has put the element at its
         final size, the list reads as overflowing by tens of pixels that are
         not there, and every visit grew every Prompt Composer a little more.

         Now the correction lives in overflowPad, which only computeSize reads.
         It never touches a section, so it cannot be saved or compound, and
         it is capped: a rounding difference is a few pixels, and anything
         bigger is a layout that has not settled, not something to absorb.
         The list is also only measured when it is actually laid out. */
      let absorbed = false;
      function absorbOverflow() {
        if (absorbed || !ready || drag || gripDragging || beingResized()) return;
        if (!root.isConnected || root.offsetParent === null || !root.clientHeight) return;
        const listOver = list.clientHeight ? list.scrollHeight - list.clientHeight : 0;
        const over = listOver;
        if (over <= 0) return;
        absorbed = true;
        if (over > OVERFLOW_MAX) return;
        const next = Math.min(OVERFLOW_MAX, overflowPad + over);
        if (next === overflowPad) return;
        overflowPad = next;
        try {
          node.setSize([Math.max(node.size[0], 420), node.computeSize()[1]]);
          node.setDirtyCanvas(true, true);
        } catch (e) { /* ignore */ }
      }

      function snapNode() {
        if (snapping || !ready || drag || gripDragging || beingResized()) return;
        /* Not laid out - off screen, or a tab that is not showing. Nothing
           measured now is true, so nothing is decided on it. */
        if (!root.isConnected || !root.offsetHeight) return;
        snapping = true;
        try {
          measureSidePad();
          const want = node.computeSize()[1];
          const diff = node.size[1] - want;
          if (refit) {
            /* a section was removed - take the height back rather than
               spreading it over the boxes that are left */
            refit = false;
            node.setSize([Math.max(node.size[0], 420), want]);
            node.setDirtyCanvas(true, true);
          } else if (diff > 8) {
            /* taller than its contents - give the extra to the sections
               instead of shrinking the node back under the user. When there is
               nowhere to put it, snap the node down instead of leaving dead
               space under the last box for ever. */
            /* Not in the Book. There a box's height belongs to its capsule
               and travels with it from prompt to prompt; the node is only
               what holds them. Spare room there is the book panel having got
               shorter - a message gone, the shelf rewrapped, a workflow
               opened with a saved size a few pixels off - and pouring it into
               the boxes made every box grow a little more each time, and kept
               it. So the node comes down to its boxes instead. */
            if (!BOOK && adoptNodeHeight()) renderHeights();
            else {
              node.setSize([Math.max(node.size[0], 420), want]);
              node.setDirtyCanvas(true, true);
            }
          } else if (Math.abs(diff) > 1) {
            node.setSize([Math.max(node.size[0], 420), node.computeSize()[1]]);
            node.setDirtyCanvas(true, true);
          }
        } catch (e) { /* ignore */ } finally { snapping = false; }
      }
      function syncWidgetHeight() { snapNode(); }

      node.size[0] = Math.max(node.size[0] || 0, 460);
      setTimeout(snapNode, 80);

      /* ---------- load ---------- */
      function loadStored(info) {
        let raw = null;
        const lw = node.widgets?.find(x => x.name === "layout_json");
        if (lw?.value) raw = lw.value;
        if (!raw && info?.widgets_values) {
          const i = node.widgets?.findIndex(x => x.name === "layout_json");
          if (i >= 0 && typeof info.widgets_values[i] === "string") raw = info.widgets_values[i];
        }
        if (!raw) return false;
        try { return restoreFrom(JSON.parse(raw)); } catch (e) { return false; }
      }

      const origConfigure = node.onConfigure;
      node.onConfigure = function (info) {
        const r = origConfigure?.apply(this, arguments);
        try { loadStored(info); } catch (e) { /* ignore */ }
        ready = true;
        setTimeout(() => {
          render();
          if (lastShot === null) lastShot = shotOf();
        }, 0);
        return r;
      };

      setTimeout(() => {
        if (!ready) {
          if (!loadStored() && BOOK) {
            restoreFrom({});            // a book of one empty prompt
          } else if (!state.sections.length && !BOOK) {
            state.sections = DEFAULT_SECTIONS.map((t, i) => ({
              id: nextId(), slot: i + 1, title: t, text: "", html: "",
              on: true, h: t === "LoRA Trigger" ? 46 : 90, extMode: "replace",
            }));
          }
          ready = true;
        }
        render();
        /* What the node opened with is the first undo step's starting point,
           so the very first change - an import, a paste - can be undone. */
        if (lastShot === null) lastShot = shotOf();
        /* The question list and the model names come from the backend; the
           panel and the per-section dropdowns are redrawn once they land. */
        (VLM.ready ? Promise.resolve(VLM) : vlmState()).then(() => render());
      }, 60);

      const origSerialize = node.onSerialize;
      node.onSerialize = function (o) {
        try {
          if (!ready) return origSerialize?.apply(this, arguments);
          save();
          const lw = node.widgets?.find(x => x.name === "layout_json");
          const i = node.widgets?.indexOf(lw);
          if (o?.widgets_values && i >= 0) o.widgets_values[i] = lw.value;
        } catch (e) { /* ignore */ }
        return origSerialize?.apply(this, arguments);
      };

      /* keep external-input styling in step with wiring changes */
      const origRemoved = node.onRemoved;
      node.onRemoved = function () {
        return origRemoved?.apply(this, arguments);
      };

      VPC_NODES.set(String(node.id), () => render());

      const iv = setInterval(() => {
        if (!node.graph) {
          clearInterval(iv);
          VPC_NODES.delete(String(node.id));
          /* a panel anchored to a node that no longer exists has nothing to
             sit under */
          try { closeReader(); closeHelp(); } catch (e) { /* ignore */ }
          try { node._lvpDragCleanup?.(); } catch (e) { /* ignore */ }
          document.removeEventListener("paste", onDocPaste, true);
          window.removeEventListener("leiel-set-picture", onSetPicture);
          document.removeEventListener("selectionchange", onMarkSelChange);
          document.removeEventListener("pointerdown", onPanelOut, true);
          document.removeEventListener("keydown", onPanelEsc, true);
          try { rgbWatch.disconnect(); } catch (e) { /* ignore */ }
          return;
        }
        snapNode();
        if (!ready) return;
        const sig = state.sections
          .map(s => (extLinked(s) ? s.extMode : "-") + (s.on ? "1" : "0") +
                    "|" + (extLinked(s) ? (extTextFor(s) || "") : "")).join("\u0001");
        if (sig !== node._lvpExtSig) {
          node._lvpExtSig = sig;
          /* Text arriving on an input changes what an open pane should say, and
             nothing else would notice: the pane is normally rerun by typing. */
          for (const s of state.sections) {
            if (s.tr && extLinked(s)) trSchedule(s, 250);
          }
          render();
        }
      }, 200);

      return this;
    };
  },
});
