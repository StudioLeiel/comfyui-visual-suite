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
/* Four layers exist and this reading takes one of them. That is the whole
   idea of the node, and words were carrying it badly: a label naming one layer
   never shows that there are three others being left behind.

   So it is drawn. Four stacked bars, one lit - the stack says how many there
   are, the lit one says which, and the three dim ones are the answer to the
   question nobody thought to ask. Top to bottom in anchor order, the same
   order the sections are in, so position becomes the name once you have seen
   it twice. */
const LAYER_ORDER = ["quality", "subject", "scene", "camera"];

function layerGlyph(key) {
  const rows = LAYER_ORDER.map((layer, i) => {
    const on = key === "all" || layer === key;
    return `<rect x="1" y="${1 + i * 4}" width="12" height="3" rx="1"`
         + ` fill="currentColor" opacity="${on ? 1 : 0.22}"/>`;
  }).join("");
  return `<svg viewBox="0 0 14 17" width="11" height="13" aria-hidden="true">`
       + rows + `</svg>`;
}

function layerTitle(sec) {
  const key = sec.q || questionFor(sec.title);
  const names = { quality: "Quality", subject: "Subject",
                  scene: "Scene", camera: "Camera" };
  if (key === "custom") return "Your own question - the four layers do not apply";
  if (key === "all") return "All four layers: quality, subject, scene, camera";
  return `Four layers - reading ${names[key] || key} only, `
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

const DEFAULT_SECTIONS = [
  "LoRA Trigger", "Quality Anchor", "Subject Anchor",
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
const MARK_CLASSES = ["m-find", "m-b", "m-i", "m-u", "m-para", "m-key",
                      "m-hy", "m-hg", "m-hp", "m-hb",
                      "m-cy", "m-cg", "m-cr", "m-cw", "m-cb",
                      "m-z1", "m-z2", "m-z3", "m-z4", "m-z5", "m-z6",
                      "m-title", "m-auto"];

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
                 Array.from(el.classList).every(c => MARK_CLASSES.includes(c)) &&
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
      }
    }
    if (!dirty) break;
  }
  return tmp.innerHTML;
}

function textToHtml(text) { return escapeHtml(text || ""); }

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
  align-content:flex-start;}
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
/* the four bars in the control row, an indicator rather than a control */
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
.lvr-read{--hue:#e6c476;font-size:10px;letter-spacing:.2px;padding:0 9px;}
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
.lvr-panel{position:fixed;z-index:9999;width:420px;background:#1b1b1b;
  border:1px solid #555;border-radius:8px;padding:10px;color:#ccc;font-size:11px;
  box-shadow:0 10px 30px #000a;}
.lvr-panel h4{margin:0 0 8px;font-size:10px;letter-spacing:.1em;text-transform:uppercase;
  color:#d9b26a;}
.lvr-panel label{display:block;margin:6px 0 2px;font-size:9px;color:#8a8a8a;
  letter-spacing:.06em;text-transform:uppercase;}
/* Memory is the thing that stops the work, so the line about what is held is
   the one line in the panel allowed to be loud. */
.lvr-panel p.vram{margin:9px 0 0;font-size:12.5px;font-weight:600;
  line-height:1.4;letter-spacing:.2px;}
.lvr-panel p.vram.held{color:#f0a860;}
.lvr-panel p.vram.idle{color:#7e9e86;}
/* a remark about the card, not a reading of it */
.lvr-panel p.vram.advice{font-size:10.5px;font-weight:400;color:#8a8a8a;
  letter-spacing:0;margin-top:8px;}
.lvr-panel label.chk{display:flex;align-items:center;gap:6px;cursor:pointer;
  margin-top:9px;}
.lvr-panel label.chk input{width:auto;flex:0 0 auto;margin:0;}
.lvr-panel select,.lvr-panel input{width:100%;box-sizing:border-box;background:#2b2b2b;
  border:1px solid #555;border-radius:4px;color:#ddd;font-size:12px;padding:4px 5px;}
.lvr-panel .foot{display:flex;gap:6px;margin-top:10px;}
.lvr-panel .foot button{flex:1 1 0;}
.lvr-warn{color:#e6a0a0;font-size:10px;line-height:1.5;margin:4px 0 0;}
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
.lvp-ta.plain .m-para::before{content:"";}
.lvp-ta[contenteditable="false"]{opacity:.35;font-style:italic;}
.lvp-ta::selection,.lvp-ta ::selection{background:#2f5b8a;color:#fff;}
/* marks the user applies by hand */
.lvp-ta b,.lvp-ta .m-b{font-weight:700;}
.lvp-ta .m-i{font-style:italic;}
.lvp-ta .m-u{text-decoration:underline;text-underline-offset:2px;}
/* the dot is drawn, not typed, so it never reaches the prompt */
.lvp-ta .m-para::before{content:"●  ";color:#7ab8ff;font-weight:700;
  text-decoration:none;font-style:normal;}
.lvp-ta .m-key{font-weight:700;color:#ffcf70;}
.lvp-ta .m-hy{background:#6b5a12;color:#ffe9a3;border-radius:2px;}
.lvp-ta .m-hg{background:#1d4d33;color:#b8f0cf;border-radius:2px;}
.lvp-ta .m-hp{background:#4a2350;color:#f0c2f7;border-radius:2px;}
.lvp-ta .m-hb{background:#14395e;color:#bcdcff;border-radius:2px;}
.lvp-ta .m-cy{color:#ffcf70;}
.lvp-ta .m-cg{color:#8fe0a8;}
.lvp-ta .m-cr{color:#ff9a9a;}
.lvp-ta .m-cw{color:#ffffff;}
.lvp-ta .m-cb{color:#7fb6ff;}
/* size is a mark on a run of characters, not a setting for the whole node:
   em, so a marked run stays in proportion wherever it is moved to */
.lvp-ta .m-z1{font-size:.72em;}
.lvp-ta .m-z2{font-size:.85em;}
.lvp-ta .m-z3{font-size:1.25em;}
.lvp-ta .m-z4{font-size:1.6em;}
.lvp-ta .m-z5{font-size:2.1em;}
.lvp-ta .m-z6{font-size:2.8em;}
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
.lvp-foot-txt{opacity:.5;}
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
.lvp-mark{position:absolute;z-index:30;display:flex;gap:2px;padding:3px;
  background:#1e1e1e;border:1px solid #666;border-radius:5px;
  box-shadow:0 3px 10px rgba(0,0,0,.5);}
.lvp-mark button{width:20px;height:20px;border-radius:3px;border:1px solid #555;
  cursor:pointer;font-size:10px;line-height:1;padding:0;background:#2b2b2b;
  color:#ddd;font-family:inherit;font-weight:600;letter-spacing:0;}
.lvp-mark button:hover{border-color:#7ab8ff;color:#fff;}
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
const ROOT_LEVEL = [".lvp-wrap", ".lvr-panel", ".lvp-help"];

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
    if (nodeData.name !== "LeielPromptComposer") return;

    const orig = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      orig?.apply(this, arguments);
      const node = this;

      setTimeout(() => {
        const w = node.widgets?.find(x => x.name === "layout_json");
        if (w) {
          w.type = "leiel-hidden";
          w.computeSize = () => [0, -4];
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

      let ready = false;        // nothing saves before the stored layout loads
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
      root.className = "lvp-wrap " + ROOT_CLASS;
      root.addEventListener("paste", e => e.stopPropagation());
      root.innerHTML = `
        <div class="lvp-bar">
          <button class="lvp-btn reader" title="Which model reads your images, and how">Reader</button>
          <button class="lvp-btn fxb" title="Show every mark, and colour the structure. Press again to read the plain text - nothing is lost either way">Style</button>
          <button class="lvp-btn brush" title="Format brush - click styled text to pick its formatting up, then drag over other text to apply it. Escape puts it down"><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M10.6 1.9a2.2 2.2 0 0 1 3.1 3.1l-1.4 1.4 .7 .7-1.1 1.1-.7-.7-4.6 4.6-2.9 .8 .8-2.9 4.6-4.6-.7-.7 1.1-1.1 .7 .7z" fill="currentColor"/><circle class="drop" cx="3.2" cy="12.8" r="1.6" fill="currentColor"/></svg></button>
          <span class="lvp-sep"></span>
          <button class="lvp-btn add" title="Add a section">+</button>
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
        <div class="lvp-foot">
          <span class="lvp-foot-txt"></span>
          <span style="flex:1"></span>
          <button class="lvp-btn help" title="What this node does">?</button>
        </div>`;

      for (const ev of ["pointerdown", "mousedown", "wheel", "contextmenu"]) {
        root.addEventListener(ev, e => e.stopPropagation());
      }

      const list = root.querySelector(".lvp-list");
      const foot = root.querySelector(".lvp-foot");

      /* ---------- undo, for this node only ----------
         ComfyUI's own Ctrl+Z undoes a step of the whole graph, which pulls the
         node back to an older size and layout before it settles - jarring, and
         far more than was asked for. This keeps a stack of just the sections,
         recorded from save() so every path that changes anything is covered
         without each one having to remember. Bursts inside a second collapse
         into one step, or a sentence would come back one keystroke at a time. */
      const HIST_MAX = 80, HIST_MERGE_MS = 900;
      let hist = [], fut = [], lastShot = null, lastShotAt = 0, restoring = false;

      function recordHistory() {
        const now = JSON.stringify(state.sections);
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
          restoreFrom({ sections: JSON.parse(json) }, null);
          lastShot = JSON.stringify(state.sections);
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
        fut.push(JSON.stringify(state.sections));
        applyShot(hist.pop());
      }

      function redoStep() {
        if (!fut.length) return;
        hist.push(JSON.stringify(state.sections));
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
        if (!restoring) recordHistory();
        /* Search hits are a viewing aid, not part of the document - strip them
           out of anything that gets written down. */
        const clean = state.sections.map(x => (x.html || "").includes("m-find")
          ? { ...x, html: x.html.replace(/\s*m-find\b/g, "")
                                .replace(/<span class="">([^<]*)<\/span>/g, "$1") }
          : x);
        w.value = JSON.stringify({ sections: clean, fx: state.fx, trTo: state.trTo,
                                   trUnit: state.trUnit, reader: state.reader });
        snapPush(clean, "auto");
      };

      function restoreFrom(p, why) {
        if (!p) return false;
        if ("fx" in p) state.fx = p.fx !== false;
        if (typeof p.trTo === "string") state.trTo = p.trTo;
        if (p.reader && typeof p.reader === "object") state.reader = p.reader;
        if (TR_UNITS.some(u => u[0] === p.trUnit)) state.trUnit = p.trUnit;
        state.sections = (p.sections || []).map(s => ({
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
        }));
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
      }

      /* Keep one external input per section, named by its slot. */
      const FIXED_LABELS = {
        find_text: "find_text (or  a=>b  per line)",
        replace_text: "replace_text",
      };

      function syncInputs() {
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
      function hideMarkBar() {
        if (markBar) { markBar.remove(); markBar = null; }
      }

      /* Marks live on three independent axes: weight, highlighter, text colour.

         Everything is done per character on a flat model, then written back as
         one span per run. Extracting the selection was not enough: when a
         selection sits inside an existing span, the extracted fragment does not
         carry that span, so the old code could not see the colour it was
         adding bold to (nested spans, white text) and "clear" put bare text
         straight back inside the coloured span (nothing appeared to happen). */
      const MARK_ORDER = ["m-find", "m-para", "m-b", "m-i", "m-u", "m-key",
                          "m-hy", "m-hg", "m-hp", "m-hb",
                          "m-cy", "m-cg", "m-cr", "m-cw", "m-cb",
                          "m-z1", "m-z2", "m-z3", "m-z4", "m-z5", "m-z6",
                          "m-title", "m-auto"];
      const TOGGLES = ["m-b", "m-i", "m-u"];

      function readMarks(host) {
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
            sp.className = MARK_ORDER.filter(c => want.includes(c)).join(" ");
            sp.appendChild(document.createTextNode(txt));
            frag.appendChild(sp);
          } else {
            frag.appendChild(document.createTextNode(txt));
          }
          i = j;
        }
        host.innerHTML = "";
        host.appendChild(frag);
      }

      /* plain-text offsets of a range inside the editor */
      function rangeOffsets(host, range) {
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
      const SIZE_CLASSES = ["m-z1", "m-z2", "",
                            "m-z3", "m-z4", "m-z5", "m-z6"];   // -2 .. +4
      const SIZE_RE = /^m-z\d$/;

      function sizeLevel(cell) {
        const i = SIZE_CLASSES.findIndex(c => c && cell.cls.includes(c));
        return i < 0 ? 0 : i - 2;
      }

      function setCellSize(cell, level) {
        const set = new Set(cell.cls.filter(c => !SIZE_RE.test(c)));
        const cls = SIZE_CLASSES[level + 2];
        if (cls) set.add(cls);
        set.delete("m-auto");
        cell.cls = Array.from(set);
      }

      /* One step for the whole run, taken from where the run starts, so a
         mixed selection lands on one size rather than fanning out. */
      function stepSize(cells, from, to, delta) {
        if (to <= from) return 0;
        const next = Math.max(-2, Math.min(4, sizeLevel(cells[from]) + delta));
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
        } else {
          for (const c of Array.from(set)) if (c.startsWith("m-c")) set.delete(c);
          if (!off) set.add(cls);
        }
        set.delete("m-auto");
        cell.cls = Array.from(set);
      }

      /* writeMarks rebuilds the section, which throws away any live range.
         These put the caret back on the same characters so the palette can be
         pressed again and again without the selection evaporating. */
      function pointAt(host, off) {
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

      function axisOf(cls) {
        if (!cls) return "clear";
        if (cls === "m-para") return "para";
        if (TOGGLES.includes(cls)) return "toggle";
        if (cls.startsWith("m-h")) return "hl";
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
        if (to <= from) { hideMarkBar(); return; }

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
          } else {
            hideMarkBar();
          }
          refreshToolbar();
          return;
        }

        const axis = axisOf(cls);

        /* the paragraph dot belongs to a line, not to a selection */
        if (axis === "para") {
          const starts = lineStarts(cells, from, to);
          const on = starts.every(i => cells[i].cls.includes("m-para"));
          for (const i of starts) {
            const set = new Set(cells[i].cls);
            if (on) set.delete("m-para"); else set.add("m-para");
            cells[i].cls = Array.from(set);
          }
          writeMarks(host, cells);
          host.dispatchEvent(new Event("input"));
          const sel2 = window.getSelection();
          if (sel2) sel2.removeAllRanges();
          hideMarkBar();
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
        const after = window.getSelection();
        if (after) after.removeAllRanges();
        hideMarkBar();
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
      const BRUSH_SKIP = ["m-find", "m-auto", "m-para", "m-title"];
      let brush = null;          // array of classes once loaded
      let brushMode = "off";     // "off" | "pick" | "apply"

      function brushLabel() {
        if (brushMode === "pick") return "click a word to pick up its formatting";
        if (!brush) return "";
        const names = { "m-b": "bold", "m-i": "italic", "m-u": "underline", "m-key": "key" };
        const parts = brush.map(c => names[c]
          || (c.startsWith("m-h") ? "highlight" : c.startsWith("m-c") ? "colour" : "size"));
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

      const MARK_BUTTONS = [
        ["B", "m-b", "Bold", "font-weight:700"],
        ["I", "m-i", "Italic", "font-style:italic"],
        ["U", "m-u", "Underline", "text-decoration:underline"],
        ["\u25CF", "m-para", "Mark the paragraph", "color:#7ab8ff"],
        ["", "m-hy", "Highlight yellow", "background:#6b5a12"],
        ["", "m-hg", "Highlight green", "background:#1d4d33"],
        ["", "m-hp", "Highlight purple", "background:#4a2350"],
        ["", "m-hb", "Highlight blue", "background:#14395e"],
        ["A", "m-cy", "Text yellow", "color:#ffcf70"],
        ["A", "m-cg", "Text green", "color:#8fe0a8"],
        ["A", "m-cr", "Text red", "color:#ff9a9a"],
        ["A", "m-cw", "Text white", "color:#ffffff"],
        ["A", "m-cb", "Text blue", "color:#7fb6ff"],
        ["A", "size-", "Smaller - selection only", "font-size:8px"],
        ["A", "size+", "Larger - selection only", "font-size:13px"],
        ["\u2715", "", "Clear marks", "color:#f88"],
      ];

      function showMarkBar(ta) {
        const sel = window.getSelection();
        if (!sel || !sel.rangeCount || sel.isCollapsed) { hideMarkBar(); return; }
        const r = sel.getRangeAt(0);
        if (!ta.contains(r.commonAncestorContainer)) { hideMarkBar(); return; }
        if (ta.getAttribute("contenteditable") === "false") return;

        hideMarkBar();
        const bar = document.createElement("div");
        bar.className = "lvp-mark";
        bar._ta = ta;
        /* Hold on to the range. Clicking a button can drop the live selection,
           and then the action had nothing to work on - that was the "sometimes
           the clear button does nothing" behaviour. */
        bar._range = r.cloneRange();
        bar.innerHTML = MARK_BUTTONS.map(([label, cls, title, style]) =>
          `<button data-c="${cls}" title="${title}" style="${style}">${label}</button>`
        ).join("");
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

        const barW = bar.offsetWidth || 168;
        const barH = bar.offsetHeight || 24;
        let left = (first.left - rootRect.left) / scale;
        let top = (first.top - rootRect.top) / scale - barH - 4;
        if (top < 2) {
          top = (last.bottom - rootRect.top) / scale + 4;   // flip below
        }
        const maxL = Math.max(2, (root.offsetWidth || 400) - barW - 4);
        const maxT = Math.max(2, (root.offsetHeight || 400) - barH - 4);
        bar.style.left = Math.round(Math.min(Math.max(2, left), maxL)) + "px";
        bar.style.top = Math.round(Math.min(Math.max(2, top), maxT)) + "px";
        bar.style.visibility = "";

        bar.querySelectorAll("button").forEach(b => {
          b.addEventListener("pointerdown", (e) => {
            e.preventDefault(); e.stopPropagation();
            applyMark(b.dataset.c);
          });
        });
        for (const ev of ["pointerdown", "mousedown", "wheel"]) {
          bar.addEventListener(ev, e => e.stopPropagation());
        }
        markBar = bar;
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
        const behind = c.src !== (s.text || "").trim();
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

      function trSchedule(s, delay) {
        const c = trCell(s);
        clearTimeout(c.timer);
        c.timer = setTimeout(() => trRun(s), delay == null ? 700 : delay);
      }

      async function trRun(s) {
        const c = trCell(s);
        const src = (s.text || "").trim();
        /* one at a time per section - a second request while the first is out
           is remembered and run after it, so fast typing cannot pile up */
        if (c.status === "working" || c.status === "load") { c.again = true; return; }
        if (!src) { c.src = ""; c.tokens = []; c.status = "done"; trPaint(s); return; }
        if (c.status === "done" && c.src === src) { trPaint(s); return; }
        c.status = "working";
        c.tokens = trSplit(s.text || "");
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
        const stale = c.src !== (s.text || "").trim();

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
        compactSlots();
        syncInputs();
        syncOutputs();
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

          const imgBox = () => {
            const chosen = s.q || questionFor(s.title);
            /* "Read only" is said once, above the four, instead of once inside
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
                                scene: "scene", camera: "camera",
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
                <button class="lvr-read"${s.img ? "" : " disabled"}>Read</button>
                <button class="lvr-lay${s.imgSide ? "" : " on"}" data-side="0"
                  title="Picture above the text">${ICON_ROW}</button>
                <button class="lvr-lay${s.imgSide ? " on" : ""}" data-side="1"
                  title="Picture beside the text">${ICON_SIDE}</button>
                ${s.img ? `<button class="lvr-x" title="Take the image out">&#10005;</button>` : ""}
                <span class="lvr-note"></span>
              </div>
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
          if (linked && s.extMode === "replace") {
            extPane = extBox(split.ext);                  // the box is ignored
          } else if (linked && (s.extMode === "prepend" || s.extMode === "append")) {
            extPane = s.extMode === "prepend"
              ? extBox(split.ext) + editBox(split.edit)
              : editBox(split.edit) + extBox(split.ext);
          } else {
            extPane = editBox(split.edit) + (s.tr ? trBox(split.tr) : "");
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
                         (s.on && !linked && s.color ? " k" + s.color : "") +
                         (s.on && linked ? " ext-" + s.extMode : "");
          el.style.height = s.collapsed
            ? `${HEADER_H}px`
            : `${HEADER_H + s.h + 6 + (note ? 15 : 0) + imgBlock(s)}px`;
          el.style.flex = "0 0 auto";

          el.innerHTML = `
            <div class="lvp-head">
              <div class="lvp-tog ${s.on ? "on" : "byp"}"
                   title="${s.on ? "Click to bypass this section" : "Bypassed - click to enable"}"
                   >B</div>
              <div class="lvp-imgb imgb${s.imgOpen ? " on" : ""}"
                   title="Read a reference image into this section"
                   >IMG</div>
              <div class="lvp-trb trb${s.tr ? " on" : ""}${linked ? " no" : ""}"
                   title="${linked
                     ? "not available while an input is wired into this section"
                     : "Read this section in another language. The translation is never saved and never reaches the model"}"
                   >TR</div>
              <span class="lvp-caret" title="${s.collapsed ? "Expand this section" : "Collapse this section"}"
                    >${s.collapsed ? "&#9654;" : "&#9660;"}</span>
              <span class="lvp-swatch" title="Section colour">&#9679;</span>
              <input class="t" value="${escapeHtml(s.title)}" spellcheck="false"
                     ${s.on ? "" : "disabled"}>
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
                if (s.imgSide) s.imgW = sideWidthFor(s, s.h + 6);
                touch(); render(); save();
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
              const blocked = BUSY.on && !reading;
              readBtn.disabled = reading || BUSY.on || !s.img;
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

            readBtn.addEventListener("click", async () => {
              if (!s.img || BUSY.on) return;
              const key = s.q || questionFor(s.title);
              const question = key === "custom"
                ? (s.qText || "").trim()
                : ((VLM.questions[key] || {}).question || "");
              if (!question) { say("There is no question to ask.", "err"); return; }

              reading = true;
              setReadState();
              say("reading…", "busy");
              try {
                const text = await readImage(s.img, question, readerSettings());
                if (!text) { say("The reader returned nothing.", "err"); return; }
                s.text = normalizeText(text);
                s.html = escapeHtml(s.text);
                touch(); render(); save(); updateFoot();
              } catch (err) {
                say(String(err.message || err), "err");
              } finally {
                reading = false;
                setReadState();
              }
            });
          }

          const trb = el.querySelector(".trb");
          if (trb && !linked) {
            trb.addEventListener("click", () => {
              s.tr = !s.tr;
              if (s.tr) {
                /* The section GROWS by the pane. The old line only guaranteed
                   the box 40px and then carved the pane out of the height the
                   section already had, so opening a translation on a long
                   section cut the English down to a few lines. */
                s.trH = Math.min(360, Math.max(TR_MIN,
                  s.trH || Math.min(300, Math.round(s.h * 0.6))));
                s.h += s.trH + 4;
              } else if (s.trH) {
                s.h = Math.max(MIN_H, s.h - (s.trH + 4));   // and hand it back
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
          el.querySelector(".pre").addEventListener("click", () => openPresets(s));
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

          if (s.tr && !linked) {
            trPaint(s);
            const c = trCell(s);
            if (c.status !== "working" && c.status !== "load"
                && c.src !== (s.text || "").trim()) trSchedule(s, 120);
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

      function contentHeight() {
        const secs = state.sections.reduce((n, s) => {
          if (s.collapsed) return n + HEADER_H + GAP;
          const linked = extLinked(s);
          const noteH = (!s.on || linked) ? 15 : 0;
          return n + HEADER_H + s.h + 6 + noteH + GAP + imgBlock(s);
        }, 0);
        return 34 + secs + 18;
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
        const space = target - fixed - 52;          // toolbar + footer + padding
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
          const space = target - fixed - 52;
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
        if (sec.extMode === "replace") return { edit: 0, ext: sec.h, tr: 0 };
        const total = Math.max(2 * 24 + 4, sec.h);
        let eh = Math.round(total * 0.4);
        eh = Math.min(Math.max(24, eh), total - 4 - 24);
        return { edit: total - eh - 4, ext: eh, tr: 0 };
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
      function styleMatches(cls, find, matchCase, wholeWord, only) {
        if (!find) return 0;
        const size = isSizeCmd(cls);
        const axis = size ? "size" : axisOf(cls);
        let total = 0;
        state.sections.forEach((sec, idx) => {
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

        function fillScope() {
          const keep = scope.value;
          scope.innerHTML = `<option value="-1">all sections</option>` +
            state.sections.map((x, i) =>
              `<option value="${i}">${escapeHtml(x.title)}</option>`).join("");
          scope.value = [...scope.options].some(o => o.value === keep) ? keep : "-1";
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
          hits.textContent = !fEl.value ? ""
            : !n ? "none"
            : (cur >= 0 && cur < groups.length)
              ? `${cur + 1} / ${groups.length}`
              : `${n} found`;
        }

        function run(keepPlace) {
          const before = cur;
          const n = paintFindMarks(fEl.value, matchCase, wholeWord,
                                   parseInt(scope.value));
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
        const HIT_MARKS = MARK_BUTTONS.filter(([, c]) => c !== "m-para");
        marksEl.innerHTML = HIT_MARKS.map(([label, cls, title, style], i) =>
          (i === 3 || i === 7 ? `<span class="sep"></span>` : "") +
          `<button data-c="${cls}" title="${title} - every hit" ` +
          `style="${style}">${label}</button>`).join("");
        marksEl.querySelectorAll("button").forEach(b => {
          b.addEventListener("click", (e) => {
            e.stopPropagation();
            const find = fEl.value;
            if (!find) { hits.textContent = "type something to find first"; return; }
            snapPush(state.sections, "before styling hits");
            const n = styleMatches(b.dataset.c, find, matchCase, wholeWord,
                                   parseInt(scope.value));
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
          backup = JSON.parse(JSON.stringify(state.sections));
          snapPush(state.sections, "before replace");
          const only = parseInt(scope.value);
          let n = 0;
          state.sections.forEach((sec, i) => {
            if (only >= 0 && i !== only) return;
            n += replaceInSection(sec, find, rEl.value, matchCase, wholeWord);
          });
          touch(); save();
          undoBtn.style.display = n ? "" : "none";
          run(false);                     // repaint against the new text
          hits.textContent = `replaced ${n}`;
        });

        undoBtn.addEventListener("click", () => {
          if (!backup) return;
          state.sections = backup; backup = null;
          undoBtn.style.display = "none";
          touch(); save(); run(false);
        });

        bar.querySelector(".cls").addEventListener("click", closeFind);
        fEl.focus();
      }

      /* ---------- preset library ---------- */
      function openPresets(sec) {
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
        return h;
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
        const budget = FIT_TOTAL_MAX - 34 - 18 - fixed;
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
        <b>Custom&hellip;</b> to write your own. Four images in four sections,
        each read for one layer, is what this node is for.</p>
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

        <h5>Wired sections</h5>
        <p>A section with an <code>ext_</code> input shows what is arriving on
        it. The section then either replaces its own text with what came in,
        or joins the two - the badge in its header switches between the two
        and says which is in force.</p>`;

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
          <div class="mem">${memoryLines()}</div>
          <div class="foot">
            <button class="lvp-btn drop">Unload model</button>
            <button class="lvp-btn done">Close</button>
          </div>`;
        document.body.appendChild(box);
        const btn = root.querySelector(".reader");
        const place = () => {
          const r = btn.getBoundingClientRect();
          const w = box.offsetWidth || 420;
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
      root.querySelector(".help").addEventListener("click", (e) => {
        e.stopPropagation();
        if (helpBox) { closeHelp(); return; }
        const box = document.createElement("div");
        box.className = "lvp-help " + ROOT_CLASS;
        box.innerHTML = HELP +
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
      w.computeSize = function (width) {
        return [width, Math.max(120, contentHeight())];
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
          node.setSize([Math.max(node.size[0], 420), node.computeSize()[1]]);
          node.setDirtyCanvas(true, true);
        } catch (e) { /* ignore */ }
      }

      function snapNode() {
        if (snapping || !ready || drag || gripDragging || beingResized()) return;
        snapping = true;
        try {
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
            if (adoptNodeHeight()) renderHeights();
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
        setTimeout(render, 0);
        return r;
      };

      setTimeout(() => {
        if (!ready) {
          if (!loadStored()) {
            state.sections = DEFAULT_SECTIONS.map((t, i) => ({
              id: nextId(), slot: i + 1, title: t, text: "", html: "",
              on: true, h: t === "LoRA Trigger" ? 46 : 90, extMode: "replace",
            }));
          }
          ready = true;
        }
        render();
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
          return;
        }
        snapNode();
        if (!ready) return;
        const sig = state.sections
          .map(s => (extLinked(s) ? s.extMode : "-") + (s.on ? "1" : "0") +
                    "|" + (extLinked(s) ? (extTextFor(s) || "") : "")).join("\u0001");
        if (sig !== node._lvpExtSig) { node._lvpExtSig = sig; render(); }
      }, 200);

      return this;
    };
  },
});
