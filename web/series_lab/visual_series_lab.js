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

/* Visual Series Lab (Studio Leiel) - node face.
 *
 * Left:  what is available (LoRAs, options) and the recipe being built.
 * Right: the queue, what it adds up to, and what is rendering right now.
 *
 * Everything reacts as it is clicked. The loader upstream is re-read while
 * the graph sits idle, the same way the crop node reads its image, so a box
 * ticked over there shows up here without a run.
 */
import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

/* The LoRA shelf, kept on the server rather than in the workflow.

   A series is saved and opened from the Series Book now, so a shelf that
   lived inside the workflow came back empty every time a series was opened,
   and the workflow had to be saved again only to keep it. It lives in
   user/visual_series_lab/lora_shelf.json instead: one shelf, and the groups
   it is sorted into, for every Series Lab on every workflow. When the server
   does not answer (ComfyUI not restarted since the update) the shelf goes on
   being kept in the workflow, as before. */
const LSHELF = { loaded: false, failed: false, exists: false, loading: null,
                 picked: [], groups: [], subs: new Set(), saveT: 0 };
function lshelfLoad() {
  if (LSHELF.loading) return LSHELF.loading;
  LSHELF.loading = api.fetchApi("/visual_series_lab/shelf", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error("no route"))))
    .then((d) => {
      if (!d || !Array.isArray(d.picked)) throw new Error("not a shelf");
      LSHELF.picked = d.picked;
      LSHELF.groups = Array.isArray(d.groups) ? d.groups : [];
      LSHELF.exists = !!d.exists;
      LSHELF.loaded = true;
    })
    .catch(() => { LSHELF.loaded = true; LSHELF.failed = true; });
  return LSHELF.loading;
}
/* Written a moment after the last change, and every other Lab on the page
   is told at once so they all show the same shelf. */
function lshelfSave(from) {
  if (LSHELF.failed) return;
  LSHELF.exists = true;
  clearTimeout(LSHELF.saveT);
  LSHELF.saveT = setTimeout(() => {
    api.fetchApi("/visual_series_lab/shelf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ picked: LSHELF.picked, groups: LSHELF.groups }),
    }).catch(() => { /* kept in the workflow as well */ });
  }, 350);
  for (const fn of LSHELF.subs) {
    if (fn === from) continue;
    try { fn(); } catch (e) { /* a Lab that has gone away */ }
  }
}
const lshelfCopy = (list) => list.map((x) => ({ name: x.name, strength: x.strength }));

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

const NODE = "VisualSeriesLabSetup";

/* Queue row marks, drawn at the Series Book's weight (16 box, 1.6 stroke) so
   the two nodes read as one set. Copy and delete are the Book's own marks.
   A LoRA is drawn as a layer laid over the model and an option as a pair of
   sliders; each carries a small plus, since what they do is add one. */
const RI = (body, extra = "") =>
  `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor"` +
  ` stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"` +
  ` aria-hidden="true"${extra}>${body}</svg>`;
const RICON_LESS = RI(`<path d="M4 8h8"/>`);
const RICON_MORE = RI(`<path d="M8 4v8M4 8h8"/>`);
const RICON_LORA = RI(
  `<path d="M7 1.9 12.6 4.8 7 7.7 1.4 4.8Z"/>` +
  `<path d="M1.4 8.3 7 11.2 8.4 10.5"/>` +
  `<path d="M12.6 9.4v5.2M10 12h5.2"/>`);
const RICON_OPT = RI(
  `<path d="M1.6 3.8h4.2M9.8 3.8h4.6M1.6 8.6h1.2M6.6 8.6h1.6"/>` +
  `<circle cx="7.8" cy="3.8" r="1.9"/><circle cx="4.7" cy="8.6" r="1.9"/>` +
  `<path d="M12.6 9.4v5.2M10 12h5.2"/>`);
const RICON_PROMPT = RI(
  `<path d="M2 3.2h8M2 6.4h8M2 9.6h4.6"/>` +
  `<path d="M12.6 9.4v5.2M10 12h5.2"/>`);
/* three stacked passes - the sweep under a recipe */
const RICON_SWEEP = RI(
  `<path d="M2 3.5h9M2 8h9M2 12.5h9"/>` +
  `<path d="M11.5 1.8 13.8 3.5 11.5 5.2M11.5 6.3 13.8 8 11.5 9.7M11.5 10.8 13.8 12.5 11.5 14.2"/>`);
const RICON_COPY = RI(
  `<rect x="5" y="5" width="8.5" height="8.5" rx="2"/>` +
  `<path d="M11 3.2V3a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 3v5.5` +
  `A1.5 1.5 0 0 0 4 10h.8"/>`);
/* an arrow going round - back to the start */
const RICON_RESET = RI(
  `<path d="M2.8 8a5.2 5.2 0 1 0 1.6-3.8"/><path d="M2.6 1.9v2.9h2.9"/>`);
const RICON_DEL = RI(
  `<path d="M2.5 4.5h11M6.5 4.5V3a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1.5` +
  `M4 4.5l.7 8.6a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9l.7-8.6M6.8 7v4.5M9.2 7v4.5"/>`);

/* Chip colour by the kind of widget, so a scanned option still reads at a
   glance the way the hand-written ones did. */
const KIND_CLS = { combo: "c-sampler", number: "c-strength", bool: "c-model",
                   text: "c-text" };

/* An option's colour says which node it came from, not what kind of control
   it is. Colouring by kind meant one node's settings came out in four
   different colours while the pod around them took the colour of whichever
   happened to be first - the group read as noise. The kind is still plain
   from the value itself: true/false, a number, a word.

   The colour is chosen from the node's own name, so it is the same every
   time the graph is scanned and the same in the flat view, where the pod
   border is not there to group them. */
const NODE_CLS = ["c-n0", "c-n1", "c-n2", "c-n3", "c-n4",
                  "c-n5", "c-n6", "c-n7", "c-n8", "c-n9"];

function nodeColourClass(title) {
  const t = String(title || "");
  let h = 0;
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
  return NODE_CLS[h % NODE_CLS.length];
}

const CSS = `
.vsl-root{font-family:ui-monospace,Consolas,monospace;font-size:11px;color:#ddd;
  display:flex;gap:8px;padding:2px 4px 6px;align-items:stretch;
  box-sizing:border-box;}
.vsl-col{display:flex;flex-direction:column;gap:6px;min-width:0;
  height:100%;min-height:0;overflow:hidden;}
.vsl-root{overflow:hidden;}
/* the flexible panel takes whatever the fixed ones leave, so no arithmetic
   here has to agree with anything */
.vsl-zone.flexi{flex:1 1 0;min-height:40px;}
.vsl-zone.flexi .vsl-chips,.vsl-zone.flexi .vsl-list{flex:1 1 0;
  min-height:0;overflow-y:auto;}
.vsl-rest{flex:1 1 0;min-height:0;}
/* a thin band by default - it holds a few words, not a gallery */
.vsl-chips.trig{}
/* the per-recipe row of the trigger panel */
.vsl-trigv{display:flex;align-items:flex-start;gap:8px;margin-top:6px;padding-top:6px;
  border-top:1px dashed #5a4a2a;}
.vsl-trigv .tvl{flex:0 0 auto;display:flex;flex-direction:column;gap:1px;padding-top:2px;cursor:help;}
.vsl-trigv .tvl b{font-size:9px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:#e0b85a;}
.vsl-trigv .tvl i{font-style:normal;font-size:8.5px;color:#a8946a;white-space:nowrap;}
.vsl-trigv .tvh em{font-style:normal;font-weight:700;color:#e0b85a;}
.vsl-zone .trighint{font-size:10px;color:rgba(214,208,196,.55);margin:-2px 0 6px;line-height:1.4;}
.vsl-zone .trighint em{font-style:normal;font-weight:700;color:#e0b85a;}
.vsl-chips.trig.over,.vsl-trigv.over{outline:1px dashed #e0b85a;outline-offset:2px;border-radius:5px;background:rgba(224,184,90,.06);}
.vsl-trigv .vsl-chips{flex:1;min-width:0;}
.vsl-trigv .tvh{font-size:10px;color:rgba(214,208,196,.5);padding-top:3px;}
.vsl-chip.c-text.var{border-style:dashed;}
/* the per-recipe words on a recipe's header: lit when they go with it */
.tvw{display:inline-flex;flex-wrap:wrap;gap:3px;margin-left:4px;}
.vsl-tv{display:inline-flex;align-items:center;gap:5px;font-size:9px;font-weight:500;letter-spacing:.2px;
  text-transform:none;padding:1px 7px 1px 2px;border-radius:999px;white-space:nowrap;line-height:15px;cursor:pointer;
  user-select:none;border:1px solid #4a4232;color:#7d7358;background:transparent;}
.vsl-tv .st{font-size:7.5px;font-weight:800;letter-spacing:.6px;padding:0 5px;border-radius:999px;line-height:13px;
  background:#3a3426;color:#7d7358;}
.vsl-tv.on{border-color:#6b5b38;color:#cdb784;}
.vsl-tv.on .st{background:#e0b85a;color:#241703;}
.vsl-tv:not(.on) span{text-decoration:line-through;text-decoration-color:#7d735888;}
.vsl-tv:hover{border-color:#a8905a;}
.vsl-left{flex:1.15;}
.vsl-right{flex:1;padding-left:2px;}
.vsl-split{width:6px;flex:0 0 auto;cursor:col-resize;border-radius:3px;
  align-self:stretch;
  background:#333;margin:0 1px;}
.vsl-split:hover{background:#5b7fa6;}
.vsl-grip{height:5px;cursor:row-resize;border-radius:3px;background:#2a2a2a;
  margin:1px 0;flex:none;}
.vsl-grip:hover{background:#5b7fa6;}
.vsl-scroll{overflow-y:auto;overflow-x:hidden;min-height:0;flex:none;}
.vsl-zone{border:1px solid var(--border-color,#444);border-radius:5px;
  background:#1b1b1b;padding:4px 5px;display:flex;flex-direction:column;gap:3px;
  overflow:hidden;min-height:0;flex:0 1 auto;}
/* a panel with a stored height keeps it; only the flexible ones give way */
.vsl-zone.pinned{flex:0 0 auto;}
/* in the colour of the series, as the Series Layout and Report */
.vsl-root.tinted{background:color-mix(in srgb,var(--sg) 7%,#121315);box-shadow:inset 0 0 0 2px color-mix(in srgb,var(--sg) 62%,#2a2c31);border-radius:10px;padding:6px 8px 8px;}
.vsl-root.tinted .vsl-zone{background:color-mix(in srgb,var(--sg) 5%,#17181b);border-color:color-mix(in srgb,var(--sg) 24%,#2c2e33);}
.vsl-zone h4{margin:0;font-size:13px;opacity:.85;letter-spacing:.5px;
  font-weight:700;display:flex;align-items:center;gap:6px;}
.vsl-zone h4 .hint{font-weight:400;opacity:.5;letter-spacing:0;font-size:9px;}
.vsl-zone h4 .sp{flex:1;}
.vsl-zone h4 .vsl-btn{flex:0 0 auto;}
/* 2px of room on every side. A chip that sits flush against the edge of a
   scrolling box has its border and its lit outline shaved off by the clip. */
.vsl-chips{display:flex;flex-wrap:wrap;gap:4px;align-content:flex-start;
  padding:2px;}
/* Each chip states its own colour just below, rather than inheriting one.
   A coloured pod sets a text colour for its heading, and without this every
   chip inside it quietly took that colour - which is how a recipe bundle
   turned all of its chips yellow. This is only the fallback. */
.vsl-chip{display:inline-flex;align-items:center;gap:4px;background:#333;
  color:#d6d6d6;border:1px solid #555;border-radius:11px;padding:2px 7px;
  cursor:pointer;user-select:none;white-space:nowrap;max-width:100%;
  min-width:0;}
.vsl-chip:hover{background:#3d3d3d;}
.vsl-chip .lbl,.vsl-chip .x{flex:0 0 auto;}
/* a book prompt's number, as the Series Book writes it: series | prompt */
.vsl-pno{flex:0 0 auto;display:inline-flex;align-items:center;font-size:9.5px;font-weight:700;
  font-variant-numeric:tabular-nums;letter-spacing:.2px;}
.vsl-pno i{font-style:normal;}
.vsl-pno .sn{color:var(--sb,#c9cdd4);font-weight:800;margin-right:5px;padding-right:5px;
  border-right:1px solid color-mix(in srgb, currentColor 45%, transparent);}
.vsl-pno .sq{color:#e8c766;}
.vsl-chip .pre{flex:0 0 auto;font-size:8px;letter-spacing:.3px;opacity:.5;
  max-width:80px;overflow:hidden;text-overflow:ellipsis;}
.vsl-chip .v{min-width:0;max-width:170px;overflow:hidden;text-overflow:ellipsis;
  opacity:.55;font-size:10px;}
.vsl-chip .badge{flex:0 0 auto;cursor:pointer;opacity:.55;padding:0 1px;
  font-size:13px;line-height:1;}
.vsl-chip .badge:hover{opacity:1;color:#8fd6de;}
.vsl-chip .x{cursor:pointer;opacity:.45;padding:0 1px;}
.vsl-chip .x:hover{opacity:1;color:#f88;}
.vsl-chip.muted{opacity:.38;}
/* the one prompt this recipe will use */
.vsl-chip.picked{box-shadow:0 0 0 2px #3fa8b4aa;}
/* the shelf asking to be used */
.vsl-chip.nogo{border-color:#c05f6a;background:#361d21;color:#eda9b1;
  cursor:default;}
.vsl-chip.dragging{opacity:.4;}
.vsl-chip.dropinto{outline:2px solid #7fb6d8;}
/* pods: each node a large rounded chip, several to a line when small.
   lines: one node per row, ruled off from the next. */
.vsl-chips.view-pods{flex-direction:row;flex-wrap:wrap;gap:6px;
  align-items:flex-start;align-content:flex-start;}
.vsl-chips.view-lines{flex-direction:column;flex-wrap:nowrap;gap:0;}
.vsl-pod{border:1px solid #444;border-radius:14px;padding:5px 9px 8px;
  flex:0 1 auto;max-width:100%;}
/* the recipe bundle: the same container the options use, in the one colour
   kept for it, and roomier because it is the thing being assembled */
.vsl-pod.recipe{padding:6px 10px 9px;border-radius:16px;
  background:#c9a33f1f;border-color:#c9a33f;}
.vsl-pod.recipe .gt{color:#e8d089;display:flex;align-items:center;gap:8px;}
.vsl-pod.recipe .gt .ct{margin-left:auto;opacity:.75;letter-spacing:0;
  font-size:9px;}
.vsl-pod .gt{font-size:9px;letter-spacing:.6px;margin-bottom:4px;
  padding-left:2px;opacity:.85;}
.vsl-line{display:flex;align-items:flex-start;gap:10px;padding:6px 2px;
  border-bottom:1px solid #2b2b2b;width:100%;box-sizing:border-box;}
.vsl-line:last-child{border-bottom:0;}
.vsl-line .gt{flex:0 0 128px;font-size:10px;padding-top:5px;opacity:.9;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.vsl-pod .gw,.vsl-line .gw{display:flex;flex-wrap:wrap;gap:4px;flex:1 1 0;
  min-width:0;}
.vsl-pod.c-lora,.vsl-line.c-lora .gt{border-color:#7b6ce0;color:#b9aef5;}
.vsl-pod.c-sampler,.vsl-line.c-sampler .gt{border-color:#4a92c8;color:#a7d2ef;}
.vsl-pod.c-model,.vsl-line.c-model .gt{border-color:#48a882;color:#93d9bd;}
.vsl-pod.c-text,.vsl-line.c-text .gt{border-color:#c06a9c;color:#e3aecb;}
.vsl-pod.c-free,.vsl-line.c-free .gt{border-color:#c85f5f;color:#efb0b0;}
.vsl-pod.c-strength,.vsl-line.c-strength .gt{border-color:#a89040;color:#dcc884;}
.vsl-pod.c-other,.vsl-line.c-other .gt{border-color:#555;color:#bbb;}
.vsl-pod.c-lora{background:#7b6ce01f;}
.vsl-pod.c-sampler{background:#4a92c81f;}
.vsl-pod.c-model{background:#48a8821f;}
.vsl-pod.c-text{background:#c06a9c1f;}
.vsl-pod.c-free{background:#c85f5f1f;}
.vsl-pod.c-strength{background:#a890401f;}
.vsl-pod.c-other{background:#ffffff10;}
/* One colour per source node. Grey is deliberately not in here: it reads as
   "nothing special about this one", which is never what is meant - every
   option came from some node, and the colour is what says which. */
.vsl-pod.c-n0,.vsl-line.c-n0 .gt{border-color:#4a92c8;color:#a7d2ef;}
.vsl-pod.c-n1,.vsl-line.c-n1 .gt{border-color:#48a882;color:#93d9bd;}
.vsl-pod.c-n2,.vsl-line.c-n2 .gt{border-color:#c06a9c;color:#e3aecb;}
.vsl-pod.c-n3,.vsl-line.c-n3 .gt{border-color:#c9a33f;color:#e8d089;}
.vsl-pod.c-n4,.vsl-line.c-n4 .gt{border-color:#7b6ce0;color:#b9aef5;}
.vsl-pod.c-n5,.vsl-line.c-n5 .gt{border-color:#c8794a;color:#efbb95;}
.vsl-pod.c-n6,.vsl-line.c-n6 .gt{border-color:#3fa8b4;color:#96dde5;}
.vsl-pod.c-n7,.vsl-line.c-n7 .gt{border-color:#c05f6a;color:#eda9b1;}
.vsl-pod.c-n8,.vsl-line.c-n8 .gt{border-color:#8fa83f;color:#cfe08c;}
.vsl-pod.c-n9,.vsl-line.c-n9 .gt{border-color:#9a6cc0;color:#cfaee8;}
.vsl-pod.c-n0{background:#4a92c81f;}
.vsl-pod.c-n1{background:#48a8821f;}
.vsl-pod.c-n2{background:#c06a9c1f;}
.vsl-pod.c-n3{background:#c9a33f1f;}
.vsl-pod.c-n4{background:#7b6ce01f;}
.vsl-pod.c-n5{background:#c8794a1f;}
.vsl-pod.c-n6{background:#3fa8b41f;}
.vsl-pod.c-n7{background:#c05f6a1f;}
.vsl-pod.c-n8{background:#8fa83f1f;}
.vsl-pod.c-n9{background:#9a6cc01f;}
/* a fixed box, so a taller glyph cannot stretch the button */
.vsl-btn.optview{background:#2b2340;border-color:#7b6ce0;color:#cfc6ff;
  font-weight:600;width:80px;height:20px;line-height:18px;padding:0;
  display:inline-flex;align-items:center;justify-content:center;gap:5px;
  flex:0 0 auto;box-sizing:border-box;font-size:10px;}
.vsl-btn.optview:hover{background:#3a2f5c;color:#fff;}
.vsl-btn.optview .ic{font-size:10px;line-height:1;width:10px;
  display:inline-block;text-align:center;}
.optq{flex:1 1 0;min-width:40px;width:auto;background:#141414;
  border:1px solid #3a3a3a;
  border-radius:4px;color:#ddd;font-family:inherit;font-size:10px;
  padding:2px 6px;}
/* the yellow border alone marks it; an outline on top doubled the ring */
/* a trigger word riding along with the render on the way out */
.vsl-chip.c-text.live{border-color:#ffd479;background:#3a3320;color:#ffe9a3;}
.vsl-chip.c-lora{border-color:#7b6ce0;background:#2f2b45;color:#b9aef5;}
/* a LoRA the shelf does not hold - sent from a picture made with another loader */
.vsl-chip.c-lora.nogo{border-color:#c05f6a;background:#361d21;color:#eda9b1;cursor:pointer;}
/* its file is not in the loras folder at all: the recipe will not run */
.vsl-chip.c-lora.nofile{text-decoration:line-through;text-decoration-color:#eda9b1;border-style:dashed;}
.vsl-chip.c-sampler{border-color:#4a92c8;background:#1e2c3a;color:#a7d2ef;}
.vsl-chip.c-model{border-color:#48a882;background:#1c3029;color:#93d9bd;}
.vsl-chip.c-text{border-color:#c06a9c;background:#361f2d;color:#ddd;}
.vsl-chip.c-free{border-color:#c85f5f;background:#3a2020;}
.vsl-chip.c-strength{border-color:#a89040;background:#302b18;color:#e8d089;}
.vsl-chip.c-other{border-color:#555;background:#333;color:#ccc;}
.vsl-chip.c-n0{border-color:#4a92c8;background:#243d52;color:#a7d2ef;}
.vsl-chip.c-n1{border-color:#48a882;background:#22453a;color:#93d9bd;}
.vsl-chip.c-n2{border-color:#c06a9c;background:#4a2b3e;color:#e3aecb;}
.vsl-chip.c-n3{border-color:#c9a33f;background:#473b1e;color:#e8d089;}
.vsl-chip.c-n4{border-color:#7b6ce0;background:#3d3760;color:#b9aef5;}
.vsl-chip.c-n5{border-color:#c8794a;background:#4c3220;color:#efbb95;}
.vsl-chip.c-n6{border-color:#3fa8b4;background:#1d4348;color:#96dde5;}
/* the sweep: the prompt's own colour, a step darker, so it reads as part of
   the prompt and still as a different thing */
.vsl-chip.c-sw{border-color:#2a7880;background:#0f2a2d;color:#7cc3cb;}
/* the frame a book prompt asks for: a small outline of that shape */
.vsl-frame{display:inline-flex;align-items:center;justify-content:center;align-self:center;
  width:26px;height:24px;border-radius:999px;border:1px solid #3a3a3a;background:#151515;
  cursor:pointer;color:#cfc8b8;box-sizing:border-box;flex:0 0 auto;}
.vsl-frame:hover{border-color:#e0b85a;color:#e8c766;}
.vsl-frame i{display:block;box-sizing:border-box;border:1.5px solid currentColor;border-radius:1.5px;}
.vsl-frame.f-portrait i{width:8px;height:12px;}
.vsl-frame.f-landscape i{width:13px;height:8px;}
.vsl-frame.f-square i{width:10px;height:10px;}
.vsl-frame.f-all i{width:10px;height:10px;border-style:dashed;opacity:.5;}
.vsl-chip.c-sw.muted{opacity:.6;}
/* the sweep wears its prompt's series colour, a step darker */
.vsl-chip.picked.sg{box-shadow:0 0 0 2px color-mix(in srgb, var(--sb) 66%, transparent);}
.vsl-chip.c-sw.sg{border-color:color-mix(in srgb, var(--sb) 72%, #000);
  background:color-mix(in srgb, var(--sbg) 62%, #000);color:var(--sfg);}
.vsl-sweep .sw-n{margin-left:auto;display:inline-flex;align-items:center;gap:2px;flex:0 0 auto;align-self:center;}
.vsl-sweep .sw-n button{width:18px;height:18px;padding:0;border-radius:999px;border:1px solid #3a3e46;
  background:#14161a;color:#c9cdd4;cursor:pointer;font:700 11px system-ui;line-height:1;}
.vsl-sweep .sw-n button:hover{border-color:#d9b26a;color:#f0d9a8;}
.vsl-sweep .sw-n .n{min-width:28px;text-align:center;font:700 11px ui-monospace,Consolas,monospace;
  color:#e8d089;cursor:pointer;}
.vsl-sweep .sw-n .n.dflt{color:#7d828b;font-weight:600;}
.vsl-sweep{min-width:380px;max-width:520px;}
/* the sweep read on hover - the Series Book's capsule card, for a sweep */
.vsl-swcard{position:fixed;z-index:60;width:380px;max-width:calc(100vw - 16px);box-sizing:border-box;
  padding:12px 12px 10px;border-radius:10px;background:linear-gradient(180deg,#181a1e,#121417);
  border:1px solid #3a5a5e;box-shadow:0 16px 40px #000c,inset 0 1px 0 #ffffff0a;pointer-events:none;
  font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#dfe3e8;}
.vsl-swcard .hd{display:flex;align-items:center;gap:6px;}
.vsl-swcard .hd b{font-size:12.5px;font-weight:600;color:#9fe0e6;margin-right:2px;}
.vsl-swcard .kp{font-size:8.5px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;padding:2px 7px;
  border-radius:999px;color:var(--k);border:1px solid color-mix(in srgb,var(--k) 55%,transparent);
  background:color-mix(in srgb,var(--k) 14%,transparent);}
.vsl-swcard .sp{flex:1;}
.vsl-swcard .sum{font:600 10px ui-monospace,Consolas,monospace;color:#8a949c;}
.vsl-swcard .sub{font-size:10.5px;color:#7d868e;margin:3px 0 9px;}
.vsl-swcard .tks{display:flex;flex-direction:column;gap:5px;}
.vsl-swcard .tk{position:relative;display:flex;align-items:center;gap:9px;padding:5px 8px 5px 6px;border-radius:8px;
  background:#ffffff06;border:1px solid #ffffff0d;overflow:hidden;}
.vsl-swcard .tk.now{border-color:#d9b26a;background:#d9b26a12;}
.vsl-swcard .tk.done{opacity:.6;}
.vsl-swcard .no{flex:0 0 14px;text-align:right;font:700 10px ui-monospace,Consolas,monospace;color:#6fb8c0;}
.vsl-swcard .pics{display:flex;flex:0 0 auto;}
.vsl-swcard .pic{width:36px;height:48px;border-radius:5px;overflow:hidden;flex:0 0 auto;
  box-shadow:0 0 0 1px #00000080,0 0 0 2px color-mix(in srgb,var(--k) 60%,transparent);}
.vsl-swcard .pic+.pic{margin-left:-8px;}
.vsl-swcard .pic img{width:100%;height:100%;object-fit:cover;display:block;}
.vsl-swcard .pic.none{display:flex;align-items:center;justify-content:center;
  background:radial-gradient(120% 80% at 30% 15%,color-mix(in srgb,var(--k) 30%,transparent),transparent 70%),#15120d;}
.vsl-swcard .pic.none i{font-style:normal;font-weight:700;font-size:11px;color:var(--k);opacity:.7;text-transform:uppercase;}
.vsl-swcard .nms{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;}
.vsl-swcard .nm{font-size:11.5px;color:#eef1f4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.vsl-swcard .nm.gone{color:#8a8a8a;text-decoration:line-through;}
.vsl-swcard .nm em{font-style:normal;font-size:8px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;
  color:var(--k);margin-right:6px;}
.vsl-swcard .ct{flex:0 0 auto;display:flex;align-items:center;gap:5px;font:600 10.5px ui-monospace,Consolas,monospace;color:#9aa3ab;}
.vsl-swcard .ct b{color:#f3dcaa;}
.vsl-swcard .ok{font-style:normal;color:#7fd6a8;}
.vsl-swcard .dot{width:7px;height:7px;border-radius:50%;background:#d9b26a;box-shadow:0 0 0 3px #d9b26a33;
  animation:vslPulse 1.2s ease-in-out infinite;}
@keyframes vslPulse{50%{opacity:.35;}}
.vsl-swcard .bar{position:absolute;left:0;right:0;bottom:0;height:2px;background:#ffffff0a;}
.vsl-swcard .bar span{display:block;height:100%;background:linear-gradient(90deg,#48a882,#d9b26a);}
.vsl-swcard .tk.flag{border-color:#e0a24a66;background:#e0a24a0f;}
.vsl-swcard .ckl{display:flex;align-items:center;gap:5px;font-size:10px;color:#e9c97e;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.vsl-swcard .ckl.note{color:#9aa6b2;}
.vsl-swcard .ckl i{flex:0 0 13px;height:13px;border-radius:50%;display:flex;align-items:center;justify-content:center;
  font-style:normal;font-weight:800;font-size:8.5px;background:#e0a24a;color:#241703;}
.vsl-swcard .ckl.note i{background:#5a6470;color:#e9eef2;}
.vsl-swcard .ckl em{font-style:normal;color:#8a8f96;}
.vsl-swcard .ckh{display:flex;align-items:flex-start;gap:7px;font-size:10.5px;line-height:1.45;color:#f1d9a6;
  background:#e0a24a14;border:1px solid #e0a24a55;border-radius:8px;padding:6px 9px;margin:-2px 0 8px;}
.vsl-swcard .ckh i{flex:0 0 15px;height:15px;border-radius:50%;display:flex;align-items:center;justify-content:center;
  font-style:normal;font-weight:800;font-size:9.5px;background:#e0a24a;color:#241703;margin-top:1px;}
.vsl-chip.c-sw.ckwarn{box-shadow:0 0 0 1px #e0a24a,0 0 8px #e0a24a55;}
.vsl-swcard .ft{margin-top:9px;padding-top:7px;border-top:1px solid #ffffff10;font-size:9.5px;color:#6c757d;}
/* the takes: one render setting a line, its capsules as pills */
.vsl-sweep .sw-takes{display:flex;flex-direction:column;gap:3px;max-height:200px;overflow:auto;}
.vsl-sweep .sw-empty{font-size:11px;color:#8a9496;line-height:1.45;padding:6px 8px;
  border:1px dashed #3a3e46;border-radius:6px;}
.vsl-sweep .sw-take{display:flex;align-items:center;gap:6px;padding:4px 6px;border-radius:6px;
  border:1px solid #2a7880;background:#0f2a2d;}
.vsl-sweep .sw-take.act{border-color:#d9b26a;background:#2a2516;box-shadow:0 0 0 1px #d9b26a55;}
.vsl-sweep .sw-take.done{opacity:.55;}
.vsl-sweep .sw-take .ord{flex:0 0 16px;font:700 10px ui-monospace,Consolas,monospace;color:#7cc3cb;text-align:right;}
.vsl-sweep .sw-take .caps{display:flex;flex-wrap:wrap;align-items:center;gap:4px;flex:1;min-width:0;}
.vsl-sweep .sw-cap{--k:#7cc3cb;display:inline-flex;align-items:center;gap:5px;padding:2px 4px 2px 7px;border-radius:999px;
  background:color-mix(in srgb,var(--k) 12%,#141619);border:1px solid color-mix(in srgb,var(--k) 55%,transparent);
  color:#e6eaee;font-size:11.5px;font-weight:600;max-width:100%;}
.vsl-sweep .sw-cap i{font-style:normal;font-size:9px;font-weight:700;letter-spacing:.5px;
  text-transform:uppercase;color:var(--k);}
.vsl-sweep .sw-cap .sw-sg{margin-right:0;}
.vsl-sweep .sw-cap.gone{color:#8a8f96;text-decoration:line-through;}
.vsl-sweep .sw-cap .x{cursor:pointer;color:#7d828b;font-size:12px;padding:0 3px;font-weight:700;}
.vsl-sweep .sw-cap .x:hover{color:#ff9a9a;}
.vsl-sweep .sw-del{width:20px;height:20px;padding:0;border-radius:999px;cursor:pointer;
  background:transparent;font:700 12px system-ui;line-height:1;flex:0 0 auto;}
/* adding a capsule of another kind to a take is the step people miss: a
   labelled yellow pill rather than a faint plus */
.vsl-sweep .sw-add{height:20px;padding:0 9px;border-radius:999px;cursor:pointer;flex:0 0 auto;
  border:1px solid #d9b26a;background:#d9b26a26;color:#f3d48f;font:700 10.5px system-ui,sans-serif;line-height:1;
  letter-spacing:.2px;white-space:nowrap;}
.vsl-sweep .sw-add:hover{background:#d9b26a4d;color:#ffe9b8;}
.vsl-sweep .sw-add.on{background:#d9b26a;color:#1a1408;}
.vsl-sweep .sw-del{border:none;color:#7d828b;}
.vsl-sweep .sw-del:hover{color:#ff9a9a;}
.vsl-sweep .sw-take .tag{font-size:9px;font-weight:700;letter-spacing:.4px;color:#888;
  border:1px solid #444;border-radius:3px;padding:1px 4px;}
.vsl-sweep .sw-take .tag.now{color:#ffd479;border-color:#ffd479;}
.vsl-sweep .sw-take .sw-n{margin-left:0;}
.vsl-sweep .sw-sum{font-size:11px;color:#9aa0a8;}
.vsl-sweep .sw-shelf{display:flex;flex-direction:column;gap:6px;padding-top:7px;border-top:1px solid #2b2e34;}
.vsl-sweep .sw-hint{font-size:11px;color:#f0d9a8;background:#2a2516;border:1px solid #6b5a33;
  border-radius:6px;padding:5px 8px;line-height:1.4;}
.vsl-sweep .sw-hint .sw-sbtn{margin-left:4px;padding:1px 9px;}
.vsl-sweep .sw-tabs .vsl-btn.has{box-shadow:inset 0 -2px 0 #d9b26a;}
.vsl-sweep .sw-row.into.on{border-color:#d9b26a;background:#2a2516;}
.vsl-sweep .sw-in{align-self:center;font:700 10px ui-monospace,Consolas,monospace;color:#7cc3cb;
  border:1px solid #2a7880;border-radius:999px;padding:0 6px;white-space:nowrap;}
.vsl-sweep .sw-tabs{display:flex;flex-wrap:wrap;gap:4px;}
.vsl-sweep .sw-tabs .vsl-btn{font-size:11px;padding:3px 11px;border-radius:999px;color:var(--k,#ccc);
  border-color:color-mix(in srgb,var(--k,#888) 50%,transparent);background:transparent;}
.vsl-sweep .sw-tabs .vsl-btn:hover{border-color:var(--k,#aaa);}
.vsl-sweep .rowb .vsl-btn{border-radius:999px;padding:3px 13px;}
.vsl-sweep .sw-tabs .vsl-btn.on{background:color-mix(in srgb,var(--k,#2a7880) 30%,#141619);border-color:var(--k,#3fa8b4);color:#fff;}
.vsl-sweep .sw-sg{display:inline-block;margin-right:6px;padding:0 6px;border-radius:999px;
  font:700 9.5px system-ui,sans-serif;letter-spacing:.3px;vertical-align:1px;
  --sb:#22c3d6;--sbg:#0f4a52;--sfg:#a6f0f8;border:1px solid var(--sb);background:var(--sbg);color:var(--sfg);}
.vsl-sweep .sw-scope{display:flex;align-items:center;gap:4px;padding:5px 6px;border-radius:7px;
  background:#16181c;border:1px solid #2b2e34;}
.vsl-sweep .sw-slab{font-size:9px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;
  color:#7d828b;margin-right:4px;}
.vsl-sweep .sw-sbtn{font:600 11px system-ui,sans-serif;padding:3px 10px;border-radius:999px;cursor:pointer;
  border:1px solid #3a3e46;background:#101215;color:#aeb3bc;white-space:nowrap;}
.vsl-sweep .sw-sbtn:hover{border-color:#d9b26a;color:#f0d9a8;}
.vsl-sweep .sw-sbtn.on{background:#3a3220;border-color:#d9b26a;color:#f6dfa9;}
/* a Series Book's series on the prompt shelf: one group each, folding,
   in a colour of its own */
.vsl-sgrp{flex-basis:100%;display:flex;flex-direction:column;gap:4px;margin:2px 0 4px;
  --sb:#22c3d6;--sbg:#0f4a52;--sfg:#a6f0f8;}
.vsl-sghead{display:flex;align-items:center;gap:7px;padding:3px 8px 3px 6px;border-radius:5px;
  background:#1d1e22;border:1px solid #2c2e33;border-left:3px solid var(--sb);cursor:pointer;
  user-select:none;min-width:0;}
.vsl-sghead:hover{background:#232429;}
.vsl-sghead .tw{color:var(--sb);font-size:14px;line-height:1;width:14px;text-align:center;flex:0 0 auto;transition:transform .12s;}
.vsl-sgrp.shut .vsl-sghead .tw{transform:rotate(-90deg);}
.vsl-sghead .no{font:700 10px ui-monospace,Consolas,monospace;color:var(--sfg);flex:0 0 auto;}
.vsl-sghead .nm{font-size:11px;font-weight:700;color:#e2e4e8;white-space:nowrap;overflow:hidden;
  text-overflow:ellipsis;min-width:0;}
.vsl-sghead .ct{margin-left:auto;font:600 10px ui-monospace,Consolas,monospace;color:#8b909a;flex:0 0 auto;}
.vsl-sghead .dot{width:12px;height:12px;border-radius:50%;background:var(--sb);flex:0 0 auto;
  border:1px solid #0008;box-shadow:0 0 0 1px #ffffff22;cursor:pointer;}
.vsl-sghead .dot:hover{box-shadow:0 0 0 2px #ffffff55;}
.vsl-sgpal{display:flex;gap:4px;flex:0 0 auto;}
.vsl-sgpal i{width:14px;height:14px;border-radius:50%;cursor:pointer;border:1px solid #0008;}
.vsl-sgpal i:hover,.vsl-sgpal i.on{box-shadow:0 0 0 2px #fff;}
.vsl-sgbody{display:flex;flex-wrap:wrap;gap:4px;padding-left:4px;}
/* LoRA groups on the LoRAs Shelf: the same folding band as a series on the
   prompt shelf, in the LoRAs' own violet */
.vsl-sgrp.lgrp{--sb:#7b6ce0;--sbg:#2f2b45;--sfg:#b9aef5;margin:4px 0 2px;}
.vsl-sgrp.lgrp .vsl-sghead .nm{color:#d6cffb;}
.vsl-sgrp.lgrp .vsl-sghead .gx{flex:0 0 auto;width:16px;height:16px;border-radius:4px;display:inline-flex;
  align-items:center;justify-content:center;color:#6c6f78;font-size:10px;margin-left:2px;}
.vsl-sgrp.lgrp .vsl-sghead .gx:hover{color:#ff8a8a;background:#3a2222;}
.vsl-sgrp.lgrp .vsl-sghead .gx.armed{color:#fff;background:#a83a3a;}
.vsl-sgrp.lgrp .vsl-sgbody{min-height:6px;}
/* the same groups in the LoRA picker of a queued recipe */
.vsl-pkgrp{margin:3px 0 1px;gap:3px;}
.vsl-pkbody{display:flex;flex-direction:column;gap:3px;padding-left:9px;}
.vsl-pkgrp.shut .vsl-pkbody{display:none;}
.vsl-lgempty{font-size:10px;color:#6c6f78;padding:2px 2px 3px;}
/* with groups the shelf grows long: it scrolls inside its own height */
.vsl-chips.pool{flex:1 1 auto;min-height:0;}
/* while a LoRA is dragged a folded group stays folded - its band is the
   place to drop it - and only an open one shows its dashed outline */
.vsl-chips.pool.lgdrag .vsl-sgrp.lgrp:not(.shut) .vsl-sgbody{border:1px dashed #4a4470;border-radius:6px;padding:4px;}
.vsl-chips.pool .vsl-sgrp.lgrp.over .vsl-sghead,.vsl-chips.pool .vsl-sgrp.lgrp.over .vsl-sgbody{border-color:#b9aef5;background:#2f2b45;}
.vsl-chips.pool.over-loose{outline:1px dashed #7b6ce0;outline-offset:2px;border-radius:6px;}
.vsl-chip.c-lora[draggable="true"]{cursor:grab;}
.vsl-btn.wide.poolclear.armed{background:#5a2020;border-color:#e06a6a;color:#ffd6d6;}
.vsl-sgrp.shut .vsl-sgbody{display:none;}
.vsl-chip.c-n6.sg{border-color:var(--sb);background:var(--sbg);color:var(--sfg);}
/* the prompt picker: number badge, then the name - tinted by the series */
.vsl-pg{display:flex;align-items:center;gap:6px;margin:6px 0 3px;padding:3px 6px;border-radius:6px;cursor:pointer;
  user-select:none;font-size:10.5px;color:var(--sfg);background:color-mix(in srgb, var(--sbg) 45%, transparent);}
.vsl-pg:hover{background:color-mix(in srgb, var(--sbg) 80%, transparent);}
.vsl-pg .tw{font-style:normal;font-size:10px;width:10px;transition:transform .12s;}
.vsl-pg.shut .tw{transform:rotate(-90deg);}
.vsl-pg b{color:var(--sb);font-weight:800;}
.vsl-pg .gn{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;}
.vsl-pg .ct{opacity:.6;font-size:9.5px;}
.vsl-pgl{display:flex;flex-direction:column;gap:3px;padding-left:4px;}
.vsl-edit .vsl-btn.vsl-pp{display:flex;align-items:center;gap:8px;text-align:left;}
.vsl-pp .pno{flex:0 0 auto;font-size:10px;font-weight:700;padding:1px 6px;border-radius:999px;
  font-variant-numeric:tabular-nums;background:#2a2d33;color:#c9cdd4;}
.vsl-pp .pnm{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.vsl-pp.sg{border-color:color-mix(in srgb, var(--sb) 55%, #000);background:color-mix(in srgb, var(--sbg) 70%, #111);
  color:var(--sfg);}
.vsl-pp.sg .pno{background:var(--sb);color:#111;}
.vsl-pp.sg:hover{border-color:var(--sb);}
.vsl-pp.sg.on{border-color:var(--sfg);box-shadow:0 0 0 1px var(--sb);font-weight:600;}
.vsl-sglab{flex-basis:100%;font-size:9px;font-weight:700;letter-spacing:.5px;
  color:#7cc3cb;opacity:.8;margin:4px 0 0 2px;text-transform:uppercase;}
.vsl-sglab:first-child{margin-top:0;}
.vsl-sweep .sw-list{max-height:340px;gap:3px;}
.vsl-sweep .sw-row{display:flex;align-items:flex-start;gap:7px;padding:5px 6px;
  border:1px solid #2c2c2c;border-radius:5px;cursor:pointer;opacity:1 !important;
  font-size:12px;}
.vsl-sweep .sw-row.on{border-color:#2a7880;background:#0f2a2d;}
.vsl-sweep .sw-row input{margin-top:2px;padding:0;}
.vsl-sweep .sw-row .ord{flex:0 0 16px;font-size:10px;color:#7cc3cb;font-weight:700;
  text-align:right;padding-top:2px;}
.vsl-sweep .sw-row .txt{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1;}
.vsl-sweep .sw-row .txt b{color:#d9eef0;font-size:12px;}
.vsl-sweep .sw-no{font-style:normal;font:700 10.5px ui-monospace,Consolas,monospace;color:#e4c27a;margin-right:7px;}
.vsl-sweep .sw-cap .sw-no{margin-right:1px;font-size:10px;}
.vsl-sweep .sw-row .txt i{font-style:normal;color:#8a9496;font-size:11px;line-height:1.35;
  overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;}
.vsl-sweep .sw-row .tag{font-size:9px;font-weight:700;letter-spacing:.4px;color:#888;
  border:1px solid #444;border-radius:3px;padding:1px 4px;align-self:center;}
.vsl-sweep .sw-row .tag.now{color:#ffd479;border-color:#ffd479;}
.vsl-sweep .sw-row.done{opacity:.55 !important;}
.vsl-chip.c-n7{border-color:#c05f6a;background:#4a282e;color:#eda9b1;}
.vsl-chip.c-n8{border-color:#8fa83f;background:#3a4220;color:#cfe08c;}
.vsl-chip.c-n9{border-color:#9a6cc0;background:#3c2d58;color:#cfaee8;}
.vsl-btn{background:#2b2b2b;border:1px solid #555;border-radius:4px;color:#ddd;
  padding:2px 8px;cursor:pointer;font-size:10px;font-family:inherit;}
.vsl-btn:hover{background:#3a3a3a;color:#fff;}
.vsl-btn.go{background:#2d4a5a;border-color:#4a7f9e;color:#cfe8ff;}
.vsl-bar2{display:flex;gap:6px;align-items:stretch;}
/* the two share the row four to one, and stand the same height */
.vsl-btn.wide{flex:1 1 0;min-width:0;padding:3px 6px;font-size:11px;
  letter-spacing:1px;font-weight:600;}
.vsl-btn.wide.big{flex:2 1 0;font-size:12px;font-weight:700;letter-spacing:2px;}
/* the mark and the word sit on one line, the mark holding its size while the
   word takes whatever room is left */
.vsl-btn.wide.run{display:flex;align-items:center;justify-content:center;gap:6px;}
.vsl-btn.wide.run svg{display:block;flex:0 0 auto;fill:currentColor;}
.vsl-btn.wide.run span{min-width:0;overflow:hidden;text-overflow:ellipsis;
  white-space:nowrap;}
.vsl-btn.wide.run.paused{background:#6a5a2d;border-color:#d4b26f;color:#fff;}
/* the two actions read differently at a glance: one starts a run, the other
   only adds to the list */
/* the same orange as the box it starts: the button and the place it acts on
   should be recognisably the same thing */
.vsl-btn.wide.run{background:#a8471f;border-color:#e0763f;color:#fff;}
.vsl-btn.wide.run:hover{background:#c2542a;}
.vsl-btn.wide.addq{background:#2f6a4a;border-color:#5fc08e;color:#e8fff2;}
.vsl-btn.wide.addq:hover{background:#3c8560;}
.vsl-btn.wide.browse{background:#3a2f5c;border-color:#8b7ae0;color:#ded6ff;}
.vsl-btn.wide.browse:hover{background:#4b3d75;color:#fff;}
.vsl-btn.warn{background:#3a2020;border-color:#c85f5f;color:#ffb0b0;}
/* Queue row buttons: small and quiet. They sit beside the recipe all the
   time, and the chips are what should be read - five coloured buttons on
   every row turned the queue into a lightshow. What they do is on hover. */
.vsl-btn.rb{min-width:22px;padding:1px 5px;font-size:9px;font-weight:600;
  letter-spacing:.4px;opacity:.75;}
.vsl-btn.rb:hover{opacity:1;}
/* The marks: bare, like the Series Book's, with a ground only under the
   pointer. LoRA and option keep the colour of the chips they add, so the
   two plus marks are told apart before they are read. */
.vsl-btn.ib{display:inline-flex;align-items:center;justify-content:center;
  min-width:20px;height:18px;padding:0 3px;background:transparent;
  border-color:transparent;color:#a8a8a8;opacity:1;}
.vsl-btn.ib svg{width:13px;height:13px;display:block;flex:0 0 auto;}
.vsl-btn.ib:hover{background:#3a3a3a;border-color:#555;color:#fff;}
.vsl-btn.ib.step svg{width:11px;height:11px;}
.vsl-btn.ib.b-lora{color:#b9aef5;}
.vsl-btn.ib.b-opt{color:#efbb95;}
.vsl-btn.ib.b-prompt{color:#96dde5;}
.vsl-btn.ib.b-sweep{color:#9a9a9a;position:relative;}
.vsl-btn.ib.b-sweep.on{color:#ffd479;border-color:#8a7a3f;background:#332b16;}
.vsl-btn.ib.b-sweep.has:not(.on)::after{content:"";position:absolute;top:2px;right:2px;
  width:5px;height:5px;border-radius:50%;background:#ffd479;}
/* The sweep under a queued recipe: three rows, each a list of chips that
   are run one after another. Hidden until it is switched on, or until a
   chip is picked up to be dropped into it. */
.vsl-sw{display:none;margin-top:8px;border-top:1px dashed #5a4f2e;padding:7px 8px 4px;
  background:#00000059;border-radius:0 0 10px 10px;}
.vsl-pod.rowpod.swon .vsl-sw,.vsl-pod.rowpod.swdrag .vsl-sw{display:block;}
.vsl-pod.rowpod.swdrag .vsl-sw{border:1px dashed #b39642;border-radius:10px;
  padding:6px 7px;background:#2a24133a;}
.vsl-sw.over{background:#4a3c1640 !important;border-color:#ffd479 !important;}
/* the sweep's heading: a darker band of its own, so it reads as a title */
.vsl-sw .swh{display:flex;align-items:center;gap:7px;font-size:9px;
  letter-spacing:.6px;color:#c9b06a;margin:-7px -8px 6px;padding:6px 9px;
  background:#00000066;border-bottom:1px solid #ffffff12;}
.vsl-sw .swh b{font-weight:800;color:#141008;background:#d9b75e;border-radius:4px;
  padding:1px 6px;letter-spacing:.8px;}
.vsl-sw .swh .ds{color:#d8cfb2;font-weight:600;letter-spacing:.2px;text-transform:none;}
.vsl-sw .swh .bar{color:#5a5240;}
.vsl-sw .swh .ct{opacity:.8;letter-spacing:.2px;}
.vsl-sw .swr{display:flex;align-items:flex-start;gap:6px;padding:9px 0;}
/* A row with nothing in it is hidden: the sweep shows only what it sweeps.
   It comes back while a chip is being dragged, so there is somewhere to
   drop it, and its add button waits in the heading meanwhile. When the
   sweep is still empty all three are shown, as the place to start. */
.vsl-sw .swr.empty{display:none;}
.vsl-pod.rowpod.swdrag .vsl-sw .swr.empty,.vsl-sw.allempty .swr.empty{display:flex;}
.vsl-sw .swr.full ~ .swr.full,.vsl-pod.rowpod.swdrag .vsl-sw .swr + .swr,
.vsl-sw.allempty .swr + .swr{border-top:1px solid #4a422a;}
.vsl-sw .swh .adds{margin-left:auto;display:flex;gap:4px;}
.vsl-sw .swh .adds .vsl-btn.ib{opacity:.7;}
.vsl-sw .swh .adds .vsl-btn.ib:hover{opacity:1;}
.vsl-sw.allempty .swh .adds,.vsl-pod.rowpod.swdrag .vsl-sw .swh .adds{display:none;}
.vsl-sw .swr .k{flex:0 0 68px;font-size:9.5px;color:#f2f0ea;font-weight:700;padding-top:5px;
  text-transform:uppercase;letter-spacing:.6px;}
.vsl-sw .swr .cs{flex:1;display:flex;flex-wrap:wrap;gap:6px;min-height:22px;
  align-items:center;border-radius:8px;}
.vsl-sw .swr .cs .hint{font-size:10px;color:#6f6a5c;font-style:italic;}
/* options on different settings: one group per setting, a dashed rule
   between them and its number on the left - option 1, option 2 */
.vsl-sw .swr .cs.grp{flex-direction:column;align-items:stretch;gap:0;}
.vsl-sw .swr .og{display:flex;align-items:flex-start;gap:6px;padding:8px 0;position:relative;}
.vsl-sw .swr .dupopt{opacity:.45;border-style:dashed;}
.vsl-sw .swr .og:first-child{padding-top:0;}
.vsl-sw .swr .og:last-child{padding-bottom:0;}
.vsl-sw .swr .og + .og{border-top:1px dashed #5a5038;}
.vsl-sw .swr .og .ol{position:absolute;left:-20px;width:12px;text-align:center;
  font-size:8.5px;color:#a89c7a;font-weight:600;padding-top:6px;white-space:nowrap;}
.vsl-sw .swr .og .ogc{flex:1;display:flex;flex-wrap:wrap;gap:6px;align-items:center;}
.vsl-sw .swr .vsl-btn.ib{flex:0 0 auto;}
/* the order number, set off from the name by a thin rule: 1 | CP */
.vsl-sw .swr .ord{font-size:8px;opacity:.6;padding-right:5px;margin-right:1px;
  border-right:1px solid currentColor;line-height:10px;}
/* the image count on a sweep chip: minus, the count, plus */
.vsl-sw .cnt{display:inline-flex;align-items:center;gap:1px;margin-left:3px;
  height:16px;box-sizing:border-box;border:1px solid #ffffff14;border-radius:8px;
  padding:0 2px;font-style:normal;cursor:default;background:#00000038;
  color:#8d8a9c;}
/* every part the same box and line, so the count sits in the middle */
.vsl-sw .cnt i{display:inline-flex;align-items:center;justify-content:center;
  height:14px;font-style:normal;font-size:10px;line-height:1;padding:0 3px;
  border-radius:6px;cursor:pointer;opacity:.75;}
.vsl-sw .cnt i:hover{opacity:1;background:#ffffff14;color:#d6d3e2;}
.vsl-sw .cnt i.nv{opacity:.6;}
/* lifted by another chip's count: what it really gets, in italic */
.vsl-sw .cnt i.nv.lift{font-style:italic;opacity:.85;}
.vsl-sw .cnt.ro{background:transparent;border-color:transparent;}
.vsl-sw .cnt.ro i{cursor:default;}
.vsl-sw .cnt.ro i:hover{background:transparent;color:inherit;}
/* its own count reads plainly; the gold is only for while it is changed */
.vsl-sw .cnt.own i.nv{opacity:.95;font-weight:700;}
.vsl-sw .cnt.edit{border-color:#ffd479;}
.vsl-sw .cnt.edit i.nv{opacity:1;color:#ffd479;font-weight:700;}
/* the sweep chip whose picture is being made right now */
/* Every sweep chip that has started fills from the left with a darker shade,
   as far as its renders have got - 3 of 16 covers a fifth of it. The one
   being made is the one still filling. */
.vsl-sw .vsl-chip.swprog{position:relative;overflow:hidden;}
/* the one being made now: its order number turns into a small dot that
   breathes slowly, like a camera's recording light */
.vsl-sw .vsl-chip.swnow > .ord{font-size:0;opacity:1;}
.vsl-sw .vsl-chip.swnow > .ord::before{content:"";display:inline-block;width:6px;height:6px;
  border-radius:50%;background:currentColor;vertical-align:middle;margin-bottom:1px;
  animation:vslSwRec 1.8s ease-in-out infinite;}
@keyframes vslSwRec{0%,100%{opacity:1;}50%{opacity:.3;}}
.vsl-sw .vsl-chip.swprog::before{content:"";position:absolute;left:0;top:0;bottom:0;
  width:calc(var(--pf, 0) * 100%);background:#0000006b;pointer-events:none;
  transition:width .5s ease;}
/* each chip's own progress, like the recipe's badge in small */
.vsl-sw .swp{font-size:8px;font-weight:500;letter-spacing:.3px;color:#ffd479;
  border:1px solid #8a7a3f;border-radius:7px;padding:0 4px;line-height:12px;
  background:#332b16;margin-left:3px;}
.vsl-sw .swp.done{color:#1b1b1b;border-color:#f2f0ea;background:#f2f0ea;
  font-size:6.5px;line-height:9px;padding:0 3px;letter-spacing:.2px;border-radius:5px;}
/* the chip fades, its done badge stays readable */
.vsl-sw .vsl-chip.swdone .swp.done{opacity:1;}
/* a sweep chip whose renders are all out: faded, on a dashed edge */
.vsl-sw .vsl-chip.swdone{opacity:.5;border-style:dashed;}
.vsl-sw .vsl-chip.swdone:hover{opacity:.85;}
.vsl-pod.rowpod.backover{outline:1px dashed #7fb6d8;outline-offset:-2px;}
.vsl-btn.ib.b-del:hover{background:#3a2020;border-color:#c85f5f;color:#ffb0b0;}
/* between the image count and the actions on the recipe */
.vsl-pod.rowpod .gt .rsep{flex:0 0 1px;align-self:stretch;margin:2px 4px;
  background:#5a5a5a;}
/* queue info: plain words and numbers, told apart by colour alone */
.vsl-info .stat{color:#8f8f8f;white-space:nowrap;}
.vsl-info .stat b{color:#e6e6e6;font-weight:700;}
/* orange for the box these renders are coming out of, purple for what is
   still waiting - the same two colours those things wear elsewhere */
.vsl-info .stat.live b{color:#ff8c47;}
.vsl-info .stat.left b{color:#b9aef5;}
/* one takes a queue out, the other brings one in - not the same action */
.vsl-btn.qexp{background:#2a3a4a;border-color:#5f88b0;color:#cfe4ff;}
.vsl-btn.qexp:hover{background:#365068;}
.vsl-btn.qimp{background:#2f3a2a;border-color:#7fa85f;color:#dcf0c8;}
.vsl-btn.qimp:hover{background:#3f5038;}
.vsl-row{display:flex;align-items:flex-start;gap:5px;padding:3px 4px;
  border:1px solid #303030;border-radius:4px;background:#161616;}
.vsl-row.now{border-color:#ffd479;background:#241f12;}
.vsl-row.dragging{opacity:.4;}
.vsl-row.dropinto{outline:2px solid #7fb6d8;}
.vsl-row .body{flex:1;min-width:0;display:flex;flex-wrap:wrap;gap:3px;}
.vsl-row .n{font-size:9px;opacity:.5;flex:none;padding-top:3px;width:16px;}
.vsl-row .ct{font-size:9px;opacity:.6;flex:none;padding-top:3px;}
.vsl-list{display:flex;flex-direction:column;gap:3px;overflow-y:auto;}
.vsl-empty{opacity:.5;font-size:10px;padding:4px 2px;line-height:1.6;}
.vsl-empty b{display:block;opacity:.85;font-weight:600;margin-bottom:2px;}
.vsl-tcard{position:fixed;z-index:72;min-width:200px;max-width:420px;padding:10px 12px;box-sizing:border-box;
  background:#121418;border:1px solid #e4c27a;border-radius:10px;box-shadow:0 8px 24px #000c;pointer-events:none;
  font-family:system-ui,sans-serif;color:#d8dbe0;display:flex;flex-direction:column;gap:7px;}
.vsl-tcard .ch b{font-size:12px;color:#e4c27a;}
.vsl-tcard .en{font-size:11px;line-height:1.5;color:#b9bdc5;white-space:pre-wrap;}
.vsl-tcard .hint{display:flex;flex-direction:column;gap:2px;font-size:10.5px;line-height:1.5;}
.vsl-tcard .en+.hint,.vsl-tcard .ch+.hint{border-top:1px solid #23262c;padding-top:7px;}
.vsl-tcard .hr{display:grid;grid-template-columns:auto 1fr;gap:12px;align-items:baseline;}
.vsl-tcard .hr b{font-size:11px;font-weight:700;color:#e4c27a;white-space:nowrap;}
.vsl-tcard .hr span{color:#a9aeb7;}
.vsl-hover{position:fixed;z-index:70;background:#141414;border:1px solid #5b7fa6;
  border-radius:6px;padding:4px;box-shadow:0 6px 20px #000b;pointer-events:none;
  font-family:ui-monospace,Consolas,monospace;font-size:10px;color:#ddd;}
.vsl-hover img{display:block;width:180px;height:180px;object-fit:cover;
  border-radius:4px;}
.vsl-hover div{padding:4px 2px 2px;text-align:center;opacity:.8;}
.vsl-hover.ex{pointer-events:auto;width:min(410px,90vw);}
.vsl-hover.ex>img.big{width:100%;height:min(410px,42vh);object-fit:contain;background:#0c0c0c;cursor:zoom-in;}
.vsl-hover .exs{display:flex;flex-wrap:wrap;gap:4px;margin-top:5px;padding:0;opacity:1;}
.vsl-hover .exs img{width:50px;height:50px;object-fit:cover;border-radius:3px;cursor:pointer;
  border:1px solid transparent;opacity:.75;}
.vsl-hover .exs img:hover,.vsl-hover .exs img.on{opacity:1;border-color:#9cc3e8;}
.vsl-hover .exn{padding:3px 2px 0;font-size:9px;opacity:.55;text-align:center;}
.vsl-exv{position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.88);display:flex;
  align-items:center;justify-content:center;cursor:zoom-out;}
.vsl-exv .fr{position:relative;display:inline-block;line-height:0;}
.vsl-exv img{max-width:94vw;max-height:90vh;object-fit:contain;border-radius:4px;box-shadow:0 10px 40px #000;}
.vsl-exv .ar{position:absolute;top:50%;transform:translateY(-50%);width:52px;height:52px;border-radius:50%;
  border:1px solid #ffffff40;background:#0009;color:#fff;font-size:26px;line-height:1;cursor:pointer;
  display:flex;align-items:center;justify-content:center;padding:0;}
.vsl-exv .ar:hover{background:#000c;border-color:#9cc3e8;}
.vsl-exv .ar.l{left:14px;}
.vsl-exv .ar.r{right:14px;}
.vsl-exv .nv{position:fixed;bottom:16px;left:50%;transform:translateX(-50%);
  font:11px ui-monospace,Consolas,monospace;color:#ccc;opacity:.7;}
.vsl-ov{position:fixed;inset:0;z-index:60;background:rgba(0,0,0,.5);
  display:flex;align-items:center;justify-content:center;}
.vsl-br{width:min(960px,92vw);height:min(720px,86vh);background:#181818;
  border:1px solid #5b7fa6;border-radius:8px;display:flex;
  flex-direction:column;overflow:hidden;color:#ddd;
  font-family:ui-monospace,Consolas,monospace;}
.vsl-br .hd{display:flex;align-items:center;gap:10px;padding:8px 12px;
  border-bottom:1px solid #333;font-size:13px;}
.vsl-br .q{flex:1;background:#252525;border:1px solid #444;border-radius:5px;
  color:#eee;padding:6px 9px;font-family:inherit;font-size:12px;}
.vsl-br .ct{opacity:.5;font-size:11px;}
.vsl-br .bd{flex:1;display:flex;min-height:0;}
.vsl-br .tree{width:240px;overflow:auto;border-right:1px solid #333;padding:8px;}
.vsl-br .fd{padding:6px 7px;cursor:pointer;border-radius:4px;font-size:13px;
  white-space:nowrap;display:flex;align-items:center;gap:5px;}
.vsl-br .fd .tw{width:16px;flex:0 0 auto;text-align:center;opacity:.8;
  font-size:11px;line-height:1;}
.vsl-br .fd .tw:hover{opacity:1;color:#7ab8ff;}
.vsl-br .fd .tw.none{cursor:default;}
/* the same column the arrows sit in, so the star lines up with them */
.vsl-br .fd .tw.star{color:#f0c040;opacity:1;font-size:15px;}
.vsl-br .fd .tw.star:hover{color:#f0c040;}
.vsl-br .fd:hover,.vsl-br .fd.on{background:#333;}
.vsl-br .grid{flex:1;overflow-y:auto;overflow-x:hidden;padding:12px;
  display:grid;grid-template-columns:repeat(auto-fill,minmax(135px,1fr));
  gap:12px;align-content:start;min-height:0;}
/* a fixed height per card, or a full folder squashes every picture flat
   instead of running on past the bottom of the panel */
.vsl-br .cd{background:#222;border:1px solid #3a3a3a;border-radius:7px;
  overflow:hidden;cursor:pointer;position:relative;height:186px;
  display:flex;flex-direction:column;}
.vsl-br .cd:hover{border-color:#7fb6d8;background:#2a2a2a;}
.vsl-br .st{position:absolute;top:5px;right:5px;width:26px;height:26px;
  border:0;border-radius:50%;background:rgba(0,0,0,.55);color:#ffd34d;
  cursor:pointer;font-size:15px;line-height:1;}
.vsl-br .pk{position:absolute;top:5px;left:5px;width:26px;height:26px;
  border:1px solid #777;border-radius:6px;background:rgba(0,0,0,.55);
  color:#9fe6c0;cursor:pointer;font-size:15px;line-height:1;font-weight:700;}
.vsl-br .cd.sel{border-color:#5fc08e;box-shadow:0 0 0 2px #5fc08e55;}
.vsl-br .cd.sel .pk{background:#2f6a4a;border-color:#5fc08e;color:#fff;}
.vsl-br .brbtn{font-size:12px;font-weight:600;padding:6px 14px;
  background:#2a3a4a;border-color:#5f88b0;color:#cfe4ff;}
.vsl-br .brbtn:hover{background:#365068;color:#fff;}
.vsl-br .brbtn.ready{background:#2f6a4a;border-color:#5fc08e;color:#eaffef;}
.vsl-br .brbtn.ready:hover{background:#3c8560;}
.vsl-br .th{height:135px;min-height:135px;flex:0 0 135px;background:#111;
  display:flex;align-items:center;justify-content:center;overflow:hidden;}
.vsl-br .th img{width:100%;height:100%;object-fit:cover;display:block;}
.vsl-br .th.none{color:#666;font-size:10px;}
/* a favourite whose file is not installed right now: still on the list,
   plainly marked, and removable - never deleted on the user's behalf */
.vsl-br .cd.miss{border-style:dashed;border-color:#6d5252;cursor:default;
  opacity:.62;}
.vsl-br .cd.miss:hover{border-color:#8a6a6a;background:#222;}
.vsl-br .th.gone{color:#c98a8a;font-size:10px;text-align:center;
  padding:0 8px;line-height:1.4;}
.vsl-br .cd.miss .ti{color:#a58a8a;}
.vsl-br .ti{padding:6px;font-size:10px;line-height:1.3;word-break:break-word;
  flex:1 1 0;min-height:0;overflow:hidden;}
.vsl-empty i{font-style:normal;color:#7fb6d8;}
.vsl-topbar{display:flex;align-items:center;gap:6px;padding:0 2px;
  flex:0 0 auto;}
.vsl-brand{font-size:11px;opacity:.45;letter-spacing:1px;}
.vsl-btn.help{width:24px;padding:2px 0;font-size:13px;font-weight:700;
  border-radius:12px;line-height:1;}
.vsl-help{position:absolute;z-index:40;background:#161616;
  border:1px solid #5b7fa6;border-radius:6px;padding:12px 14px;width:460px;
  max-height:70vh;overflow-y:auto;box-shadow:0 6px 24px #000c;
  font-family:ui-monospace,Consolas,monospace;font-size:11px;line-height:1.65;
  color:#ddd;}
.vsl-help h3{margin:0 0 8px;font-size:14px;color:#fff;letter-spacing:.5px;}
.vsl-help h5{margin:12px 0 3px;font-size:11px;color:#ffd479;
  letter-spacing:.5px;text-transform:uppercase;}
.vsl-help p{margin:0 0 4px;opacity:.85;}
.vsl-help code{background:#0d0d0d;border:1px solid #333;border-radius:3px;
  padding:0 4px;color:#9fd3f0;}
.vsl-help .close{margin-top:12px;text-align:right;}
.vsl-info{display:flex;gap:10px;font-size:10px;opacity:.75;flex-wrap:wrap;
  align-items:center;}
.vsl-info b{color:#ffd479;font-weight:600;}
/* the run counters are the one thing read from across the room, so their
   chips are bigger than the rest */
.vsl-info.counts{opacity:1;gap:14px;font-size:10px;}
.vsl-info.counts .stat b{font-size:13px;}
/* The queue is two places: what has been made, and what is actually going to
   run. A recipe is dragged from one to the other, so both have to look like
   somewhere a thing can be put down. */
.vsl-stack{display:flex;flex-direction:column;gap:4px;min-height:0;}
.vsl-stack.vsl-scroll{overflow:hidden;}
.vsl-stack .vsl-list{overflow-y:auto;overflow-x:hidden;min-height:0;}
.vsl-sub{font-size:9px;letter-spacing:1px;font-weight:700;opacity:.6;
  display:flex;align-items:center;gap:8px;padding:2px 2px 0;}
.vsl-sub .hint{font-weight:400;letter-spacing:0;opacity:.75;font-size:9px;}
.vsl-sub.box{color:#e0763f;opacity:.95;}
/* Same spacing as the queue box below. The bench was on the base gap of 3px
   while the box had been given 8, so two lists of the same rows, read one
   after the other, breathed differently - and the bench is the longer of the
   two and the one being dragged around. */
.vsl-list.bench{flex:1 1 auto;min-height:44px;gap:8px;}
/* the box the renders happen in: thicker, warmer, and lit from inside */
/* Burnt orange, not the yellow the recipes wear: the box has to read as a
   different kind of thing from the bundles sitting inside it, and warmer
   than everything else on the node says "this is the part that is running".
   Red on its own would say "wrong". */
.vsl-list.box{flex:0 0 auto;min-height:74px;border:4px solid #c25a2f;
  border-radius:24px;background:#c25a2f1f;padding:9px;
  display:flex;flex-direction:column-reverse;justify-content:flex-start;
  gap:8px;}
.vsl-list.box.over{border-color:#ff9a5c;background:#c25a2f38;}
.vsl-list.bench.over{outline:1px dashed #7ab8ff;outline-offset:-2px;}
/* A queued recipe is drawn exactly like the one being built - same bundle,
   same corners - because it is the same thing, just further along. */
.vsl-pod.rowpod{width:100%;box-sizing:border-box;cursor:grab;
  padding:6px 10px 9px;border-radius:16px;}
.vsl-pod.rowpod.dragging{opacity:.45;}
/* a queued recipe not rendering now has no fill of its own - only its gold
   edge - so the one that is rendering is the only lit one */
.vsl-pod.rowpod.c-n3{background:transparent;}
.vsl-pod.rowpod.now{border-color:#ff8c47;background:#c25a2f38;}
.vsl-pod.rowpod.now .gt{color:#ffb27a;}
/* No divider line: each recipe already has its own border, and drawing one
   more only repainted the bundle's own edge. Space does the separating. */
/* the recipe's title row: a darker band across the top of the capsule, the
   same way the sweep's heading is set off below */
.vsl-pod.rowpod .gt{display:flex;align-items:center;gap:5px;margin:-6px -10px 8px;
  padding:6px 10px;background:#00000059;border-radius:15px 15px 0 0;}
/* the recipe's number: what it is called by, so it is large enough to read */
.vsl-pod.rowpod .gt .n{flex:0 0 auto;min-width:22px;height:20px;padding:0 6px;box-sizing:border-box;
  display:inline-flex;align-items:center;justify-content:center;border-radius:6px;
  font-size:12px;font-weight:800;letter-spacing:.2px;font-variant-numeric:tabular-nums;
  color:#f2c97a;background:#3a2d17;border:1px solid #8a6a30;cursor:pointer;}
.vsl-pod.rowpod.now .gt .n{color:#1b1209;background:#ff8c47;border-color:#ff8c47;}
/* fold: a recipe shut to its title row - its number, what it renders, its count */
.vsl-pod.rowpod .gt .tw{flex:0 0 auto;width:18px;font-size:15px;line-height:1;color:#d9bf8a;cursor:pointer;
  text-align:center;user-select:none;}
.vsl-pod.rowpod .gt .tw:hover,.vsl-pod.rowpod .gt .n:hover{filter:brightness(1.2);}
.vsl-pod.rowpod .gt .sum{flex:1 1 auto;min-width:0;overflow:hidden;white-space:nowrap;
  text-overflow:ellipsis;font-size:11px;color:#d8cdb8;}
.vsl-pod.rowpod .gt .sum b{color:#f0c27a;font-weight:600;}
.vsl-pod.rowpod .gt .sum i{font-style:normal;color:#a99bd8;}
.vsl-pod.rowpod.shut .body,.vsl-pod.rowpod.shut .vsl-sw{display:none!important;}
.vsl-pod.rowpod.shut .gt{margin-bottom:-6px;border-radius:15px;}
.vsl-sub .vsl-foldall{font:inherit;font-size:9px;letter-spacing:.5px;font-weight:700;cursor:pointer;
  background:transparent;color:inherit;border:1px solid #ffffff2e;border-radius:6px;padding:1px 7px;}
.vsl-sub .vsl-foldall:hover{border-color:#ffffff66;}
.vsl-pod.rowpod .gt .prog{flex:0 0 auto;white-space:nowrap;font-size:9px;font-weight:700;letter-spacing:.4px;
  color:#ffd479;border:1px solid #8a7a3f;border-radius:9px;padding:1px 7px;
  background:#332b16;}
.vsl-pod.rowpod .gt .prog.done{color:#1b1b1b;border-color:#f2f0ea;
  background:#f2f0ea;font-size:8px;padding:0 5px;line-height:12px;}
.vsl-pod.rowpod .body{display:flex;flex-wrap:wrap;gap:7px;}
.vsl-track{height:3px;background:#262626;border-radius:2px;overflow:hidden;}
.vsl-fill{height:100%;background:#a8471f;width:0;transition:width .2s;}
.vsl-heroes{display:flex;gap:6px;align-items:flex-start;flex-wrap:wrap;
  justify-content:center;}
/* Two or three share the width and follow the node as it is resized, which
   is what made them look right. A lone one used to stretch to the full width
   and, being square, stood just as tall - burying the queue info and the
   status under it. Capping the height instead only traded that for a cropped
   picture. So the box is capped and the row is centred: one LoRA sits at a
   sensible size in the middle, several still divide the row between them,
   and nothing is ever cut off. */
.vsl-hero{display:flex;flex-direction:column;align-items:center;gap:2px;
  flex:1 1 0;min-width:0;max-width:200px;}
.vsl-hero .pic{width:100%;aspect-ratio:1/1;height:auto;border-radius:4px;
  object-fit:cover;background:#111;border:1px solid #444;}
.vsl-hero .pic.none{display:flex;align-items:center;justify-content:center;
  font-size:9px;opacity:.3;}
.vsl-hero .cap{font-size:9px;opacity:.75;max-width:100%;overflow:hidden;
  text-overflow:ellipsis;white-space:nowrap;}
.vsl-note{opacity:.45;font-size:9px;}
/* Said once, where the confusion happens: a person who pressed the canvas
   Run button got one picture and a queue that looks stuck, and nothing on
   the node told them the rest are waiting on RUN ALL. Not the dim grey of
   the status line - this one has to be read. */
.vsl-tip{margin-top:6px;padding:5px 7px;border:1px solid #c25a2f;
  border-radius:6px;background:#2a1a12;color:#e8b48a;font-size:10px;
  line-height:1.5;}
.vsl-warn{display:none;font-size:10px;line-height:1.5;color:#ffb0b0;
  background:#3a2020;border:1px solid #c85f5f;border-radius:4px;
  padding:4px 6px;margin-top:3px;}
.vsl-fname{font-size:9px;line-height:1.5;word-break:break-all;color:#ffd479;
  background:#141414;border:1px solid #333;border-radius:4px;padding:4px 6px;}
.vsl-edit{position:absolute;z-index:30;background:#1e1e1e;border:1px solid #666;
  border-radius:6px;padding:10px 12px;display:flex;flex-direction:column;gap:6px;
  box-shadow:0 4px 14px #000a;font-size:13px;}
.vsl-edit .eh{font-size:13px;font-weight:700;color:#ffd479;letter-spacing:.4px;
  margin-bottom:2px;}
.vsl-edit label{font-size:12px;opacity:.7;}
.vsl-hint{font-size:11px;line-height:1.4;opacity:.55;margin-top:3px;max-width:230px;}
.vsl-edit input,.vsl-edit select{background:#0d0d0d;border:1px solid #444;
  border-radius:4px;color:#ddd;font-family:inherit;font-size:14px;
  padding:6px 8px;}
.vsl-edit .rowb .vsl-btn{font-size:12px;padding:4px 12px;}
.vsl-edit select[multiple] option{padding:2px 4px;}
.vsl-edit select[multiple] option:checked{background:#3a6a86;color:#fff;}
.vsl-edit .rowb{display:flex;gap:4px;justify-content:flex-end;}
/* A flex item only keeps its content height while its overflow is visible.
   The option rows clip their text, so without this they are shrunk to a
   line the moment the list is taller than the panel. */
.vsl-edit>*{flex-shrink:0;}
.vsl-pick{max-height:420px;overflow-y:auto;overflow-x:hidden;
  display:flex;flex-direction:column;gap:4px;}
.vsl-pick>*{flex-shrink:0;}
/* The node heading in the picker does something, so it has to look as though
   it might: the options below it are its own, and taking them one at a time
   is a lot of clicks for a node that holds eight. */
.vsl-pick label.grab{cursor:pointer;border-radius:4px;padding:1px 4px;
  margin:0 -4px;display:flex;align-items:baseline;gap:6px;}
.vsl-pick label.grab:hover{background:#2b2b2b;color:#fff;}
.vsl-pick label.grab .n{margin-left:auto;font-size:10px;opacity:.5;}
.vsl-pick label.grab:hover .n{opacity:.9;}
.vsl-btn.optpick{display:flex;align-items:baseline;gap:8px;width:100%;
  box-sizing:border-box;text-align:left;overflow:hidden;}
.vsl-btn.optpick .w{flex:0 0 auto;color:#ffd479;}
/* already in the recipe - still offered, a second copy can be set apart */
.vsl-btn.optpick.taken{opacity:.62;}
.vsl-btn.optpick.taken .w::after{content:" \u2713";color:#8fcf9f;}
.vsl-btn.optpick .v{flex:1 1 auto;min-width:0;overflow:hidden;
  white-space:nowrap;text-overflow:ellipsis;opacity:.75;}
.vsl-btn.optpick .v:empty{display:none;}
/* the favourite star at the end of an option, and the favourites on top */
.vsl-btn.optpick .st{flex:0 0 auto;margin-left:auto;padding:0 2px;font-size:12px;
  color:#8d8a82;opacity:.45;cursor:pointer;}
.vsl-btn.optpick:hover .st{opacity:.9;}
.vsl-btn.optpick .st.on{color:#ffd479;opacity:1;}
.vsl-btn.optpick .st:hover{color:#ffd479;}
.vsl-btn.optpick .fn{flex:0 0 auto;font-size:9.5px;opacity:.55;}
.vsl-pick label.favh{color:#ffd479;font-weight:700;}
.vsl-pick .favsep{border-top:1px dashed #5a5038;margin:6px 0 4px;}
`;

/* ---------- upstream ---------- */

function upstreamNode(node, inputName) {
  try {
    const inp = (node.inputs || []).find((i) => i.name === inputName);
    if (!inp || inp.link === null || inp.link === undefined) return null;
    let link = app.graph.links[inp.link];
    let guard = 0;
    while (link && guard++ < 8) {
      const up = app.graph.getNodeById(link.origin_id);
      if (!up) return null;
      const type = String(up.comfyClass || up.type || "");
      if (/reroute/i.test(type) && up.inputs?.[0]?.link != null) {
        link = app.graph.links[up.inputs[0].link];
        continue;
      }
      return up;
    }
  } catch (e) { /* ignore */ }
  return null;
}

/* LoraManager registers every LoRA it knows about but only some are switched
   on, and the on/off state lives in the loader node's own data - so it can be
   read without running the graph. Only trust that state when explicit flags
   are actually present; a flat "<lora:...>" string lists everything. */
function stemFull(nm) {
  let t = String(nm || "").replace(/\\/g, "/");
  t = t.slice(t.lastIndexOf("/") + 1);
  return t.replace(/\.(safetensors|ckpt|pt)$/i, "");
}

function numOr(v, fallback) {
  const f = parseFloat(v);
  return Number.isNaN(f) ? fallback : f;
}

function scanActiveLoras(n) {
  /* One LoRA can turn up several times while walking the node (widgets,
     widgets_values and properties may each hold a copy). Key by name and
     keep whichever copy carries an explicit on/off flag. */
  const byName = new Map();
  let sawFlags = false;
  const seen = new WeakSet();

  const visit = (v, d) => {
    if (!v || d > 6 || typeof v !== "object") return;
    if (seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v)) { for (const x of v) visit(x, d + 1); return; }

    const nm = v.name ?? v.lora ?? v.lora_name ?? v.file ?? v.path ?? v.modelName;
    if (typeof nm === "string" && nm.trim()) {
      const flagged = ("active" in v) || ("on" in v) || ("enabled" in v);
      if (flagged) sawFlags = true;
      const st = v.strength ?? v.strength_model ?? v.modelStrength ??
                 v.strengthModel ?? v.weight ?? 1;
      const entry = {
        name: nm.trim(),
        strength: numOr(st, 1),
        on: !!(v.active ?? v.on ?? v.enabled ?? true),
        flagged,
      };
      const prev = byName.get(entry.name);
      if (!prev || (entry.flagged && !prev.flagged)) byName.set(entry.name, entry);
    }
    for (const k in v) {
      if (k === "graph" || k === "_graph" || k === "node") continue;
      visit(v[k], d + 1);
    }
  };

  for (const w of (n.widgets || [])) visit(w.value, 0);
  visit(n.properties, 0);
  visit(n.widgets_values, 0);
  return { found: Array.from(byName.values()), sawFlags };
}

function parseLoras(text) {
  const out = [];
  const seen = new Set();
  const s = String(text || "");
  let i = 0;
  for (;;) {
    const a = s.indexOf("<", i);
    if (a < 0) break;
    const b = s.indexOf(">", a);
    if (b < 0) break;
    const parts = s.slice(a + 1, b).split(":");
    i = b + 1;
    if (parts.length < 2 || parts[0].trim().toLowerCase() !== "lora") continue;
    const name = parts[1].trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({ name, strength: parts.length >= 3 ? numOr(parts[2], 1) : 1 });
  }
  return out;
}

/* Any node whose class or title mentions a LoRA is a candidate loader. */
const LORA_NODE = /lora/i;

/* Loaders spell the name field differently, so resolve it in one place. */
function entryName(e) {
  if (!e || typeof e !== "object") return "";
  const nm = e.name ?? e.lora ?? e.lora_name ?? e.file ?? e.path ?? e.modelName;
  return typeof nm === "string" ? nm.trim() : "";
}

function entryStrength(e) {
  const v = e.strength ?? e.strength_model ?? e.modelStrength ??
            e.strengthModel ?? e.weight;
  return numOr(v, 1);
}

/* The entries themselves, not copies, so their on/off flag and strength can
   be set. */
function loraEntries(n) {
  const out = [];
  const seen = new WeakSet();
  const visit = (v, d) => {
    if (!v || d > 6 || typeof v !== "object" || seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v)) { for (const x of v) visit(x, d + 1); return; }
    const flagged = ("active" in v) || ("on" in v) || ("enabled" in v);
    if (entryName(v) && flagged) out.push(v);
    for (const k in v) {
      if (k === "graph" || k === "_graph" || k === "node") continue;
      visit(v[k], d + 1);
    }
  };
  for (const w of n.widgets || []) visit(w.value, 0);
  visit(n.properties, 0);
  visit(n.widgets_values, 0);
  return out;
}

/* The one loader this node speaks for: the nearest LoRA loader on the way to
   the model input. Touching every loader in the graph meant switching LoRAs
   off in loaders this node has no business touching. */
function isLoraLoader(n) {
  return n && n.mode !== 2 && n.mode !== 4 &&
    LORA_NODE.test(String(n.comfyClass || n.type || "") + " " +
                   String(n.title || ""));
}

/* Walk back from model and clip, and say whether a loader is in the way. */
function loaderInModelPath(node) {
  for (const port of ["model", "clip"]) {
    let up = upstreamNode(node, port);
    let guard = 0;
    while (up && guard++ < 24) {
      if (isLoraLoader(up)) return up;
      const inp = (up.inputs || []).find((i) => i.name === port) ||
                  (up.inputs || [])[0];
      if (!inp || inp.link == null) break;
      const link = app.graph.links[inp.link];
      up = link ? app.graph.getNodeById(link.origin_id) : null;
    }
  }
  return null;
}

/* The loader this node reads its list from. Preferably one kept aside as a
   picker; a loader in the model path works too, but then it applies its own
   LoRAs as well and the warning below says so. */
function primaryLoader(node) {
  const inPath = loaderInModelPath(node);
  for (const n of (app.graph && app.graph._nodes) || []) {
    if (n === node || n === inPath) continue;
    if (isLoraLoader(n)) return n;
  }
  return inPath;
}

/* What that loader currently has switched on. The values this node writes are
   put back the moment the prompt has been built, so what is on screen is
   always what the person set, never what a sweep left behind. */
function collectLoras(node) {
  const out = [];
  const seen = new Set();
  const add = (name, strength) => {
    const key = String(name || "");
    if (!key.trim() || seen.has(key)) return;
    seen.add(key);
    out.push({ name: key, strength: numOr(strength, 1) });
  };
  const primary = primaryLoader(node);
  if (!primary) return out;
  /* A loader that keeps a switch per LoRA is the authority. Its text listing
     names every LoRA it knows about, switched on or not, so reading both and
     merging them put the switched-off ones back on the list. */
  const flagged = loraEntries(primary);
  if (flagged.length) {
    for (const e of flagged) {
      const on = e.active ?? e.on ?? e.enabled;
      if (on === false) continue;
      add(entryName(e), entryStrength(e));
    }
    return out;
  }
  for (const w of primary.widgets || []) {
    const v = w && w.value;
    if (typeof v === "string" && v.toLowerCase().includes("<lora:")) {
      for (const l of parseLoras(v)) add(l.name, l.strength);
    } else if (typeof v === "string" &&
               /\.(safetensors|ckpt|pt)$/i.test(v) &&
               /lora/i.test(String(w.name || ""))) {
      add(v, 1);
    }
  }
  return out;
}

function shortName(full) {
  let s = String(full || "").replace(/\\/g, "/");
  s = s.slice(s.lastIndexOf("/") + 1);
  return s.replace(/\.(safetensors|ckpt|pt)$/i, "");
}

function num(x) {
  const f = Number(x);
  return Number.isNaN(f) ? String(x) : String(f);
}

/* A LoRA strength is always written with a decimal: "1" and "1.0" are the
   same number but only one of them reads as a strength at a glance. */
function strengthText(x) {
  const f = Number(x);
  if (Number.isNaN(f)) return String(x);
  return Number.isInteger(f) ? f.toFixed(1) : String(f);
}

/* How many renders one recipe produces - the same arithmetic the python side
   does, so the number on screen is the number that will actually run. */
function optCombos(opts) {
  let combos = 1;
  for (const o of opts || []) {
    const v = o && o.values;
    if (Array.isArray(v) && v.length) combos *= v.length;
  }
  return combos;
}

/* The sweep under a queued recipe - three rows, each multiplying the run:
     prompts  each one rendered in turn (they cannot be stacked)
     loras    each one put first, the recipe's own LoRAs following it
     opts     each one applied on its own, on top of the recipe's options
   { on, prompts: [n], loras: [{ name, strength }], opts: [option] }
   Switched off it is kept but left out of the run, so a sweep can be
   paused without being taken apart. */
function swOf(row) {
  const sw = row && row.sw;
  return sw && typeof sw === "object" ? sw : null;
}
function swOn(row) {
  const sw = swOf(row);
  return !!(sw && sw.on);
}
/* Every LoRA a recipe carries, the sweep's included - for the trigger
   words, which belong to a LoRA wherever it sits on the recipe. */
function rowLoras(row) {
  const out = ((row && row.loras) || []).slice();
  const sw = swOf(row);
  for (const l of (sw && sw.loras) || []) {
    if (!out.some((x) => x.name === l.name)) out.push(l);
  }
  return out;
}
function swCount(row) {
  const sw = swOf(row);
  if (!sw) return 0;
  return (sw.prompts || []).length + (sw.loras || []).length + (sw.opts || []).length;
}

/* The prompts on the recipe's own body: its prompt and any added beside
   it, less those moved into the sweep. */
function bodyPrompts(row) {
  const sw = swOf(row);
  const inSw = new Set(((sw && sw.prompts) || []).map(Number));
  const out = [];
  for (const n of [row && row.prompt].concat((row && row.prompts) || [])) {
    const k = Number(n) || 0;
    if (k > 0 && !inSw.has(k) && !out.includes(k)) out.push(k);
  }
  return out;
}

/* Every prompt the recipe renders, in order: the body's, then the sweep's. */
function promptList(row) {
  const out = bodyPrompts(row);
  if (swOn(row)) {
    for (const n of swOf(row).prompts || []) {
      const k = Number(n) || 0;
      if (k > 0 && !out.includes(k)) out.push(k);
    }
  }
  if (!out.length) out.push(Number(row && row.prompt) || 0);
  return out;
}

/* The LoRA line-ups: one per swept LoRA, that one first. */
function loraSets(row) {
  const own = (row && row.loras) || [];
  const sw = swOn(row) ? swOf(row) : null;
  const list = (sw && sw.loras) || [];
  if (!list.length) return [own];
  return list.map((l) => [l].concat(own.filter((x) => x.name !== l.name)));
}

/* The option sets. Options on the same setting take turns (euler, then
   er_sde); options on different settings combine, every one with every
   other (each sampler with the enhancer off, then on). The setting that
   came into the sweep first changes slowest. */
function optAxes(row) {
  const sw = swOn(row) ? swOf(row) : null;
  const list = ((sw && sw.opts) || []).filter((o) => o && o.key)
    .filter((o, i, all) => all.findIndex((x) => sameOptOf(x, o)) === i);
  const axes = [];
  for (const o of list) {
    const a = axes.find((x) => x[0].key === o.key);
    if (a) a.push(o); else axes.push([o]);
  }
  return axes;
}
function optSets(row) {
  let sets = [[]];
  for (const axis of optAxes(row)) {
    const next = [];
    for (const pre of sets) for (const o of axis) next.push(pre.concat([o]));
    sets = next;
  }
  return sets;
}
/* the same widget at the same values - one pass, however often it is in */
function sameOptOf(a, b) {
  return !!a && !!b && a.key === b.key &&
    JSON.stringify(a.values || []) === JSON.stringify(b.values || []);
}
function isDupOpt(sw, o) {
  const list = (sw && sw.opts) || [];
  const i = list.indexOf(o);
  return i > 0 && list.slice(0, i).some((x) => sameOptOf(x, o));
}
/* the name of one option inside a pass */
function optId(o) {
  return o.key + "=" + JSON.stringify(o.values || []);
}
/* whether a render's pass used this option - older renders named a
   single option, newer ones list every option combined in the pass */
function hitHasOpt(h, oid) {
  if (!h) return false;
  if (Array.isArray(h.opts)) return h.opts.includes(oid);
  return h.opt === oid;
}

/* An image count a sweep chip was given of its own, or 0 for "as the
   recipe does". */
function itemN(x) {
  const n = Math.round(Number(x));
  return n >= 1 ? Math.min(999, n) : 0;
}

/* Every pass a recipe makes - one prompt, one LoRA line-up, one option set -
   with the image count it was given, if any. A prompt chip's count covers
   all of that prompt's passes; a LoRA chip's lifts its own passes above it,
   never below. Without one the recipe's own (or a capsule take's) applies. Each pass is named by what the sweep put
   in it, so its finished images stay finished when counts change. */
function passPlan(row) {
  const own = ((row && row.opts) || []).filter((o) => o && o.key);
  const sw = swOn(row) ? swOf(row) : null;
  const pn = (sw && sw.pn) || {};
  const swP = ((sw && sw.prompts) || []).map(Number);
  const swL = (sw && sw.loras && sw.loras.length) ? sw.loras : null;
  const out = [];
  for (const p of promptList(row)) {
    loraSets(row).forEach((ls, li) => {
      for (const set of optSets(row)) {
        /* a swept option the recipe also sets replaces it for that pass */
        const opts = own.filter((o) => !set.some((x) => x.key === o.key)).concat(set);
        /* Levels, top down: a prompt's count is the least every one of its
           passes gets; a LoRA's lifts its own passes above that; an
           option's lifts only the passes it is in. A count lower down
           never pulls one above it down - the highest wins. */
        const n = Math.max(0, ...set.map((o) => itemN(o.n)),
          (swL && itemN(swL[li].n)) || 0,
          (swP.includes(Number(p)) && itemN(pn[p])) || 0);
        const lora = swL ? swL[li].name : "";
        /* one option keeps the name it always had, so its finished
           pictures stay finished */
        const optIds = set.map(optId);
        const opt = optIds.join("&");
        out.push({ p, ls, set, opts, n, lora, opt, optIds, key: [p, lora, opt].join("|") });
      }
    });
  }
  return out;
}

function rowTotal(row) {
  const repeat = Math.max(1, (row && row.repeat) || 1);
  /* a capsule sweep renders the recipe once per take - each take as many
     times as it asks for, or as the recipe does */
  const takes = sweepTakes(row && row.sweep);
  let total = 0;
  for (const ps of passPlan(row)) {
    const per = takes.length
      ? takes.reduce((a, t) => a + (ps.n || capRepeat(t, repeat)), 0)
      : (ps.n || repeat);
    total += optCombos(ps.opts) * per;
  }
  return total;
}

/* The takes of a sweep. A take is one render setting: one capsule, or a
   combination - a pose from one series with a camera from another - each
   capsule standing in for the prompt's own part of its kind.

     { takes: [ { caps: [{ kind, id, name }], n? } ] }

   A sweep saved before combinations, { kind, caps: [{ id, name, n? }] }, is
   one take per capsule. */
function sweepTakes(sw) {
  if (!sw || typeof sw !== "object") return [];
  if (Array.isArray(sw.takes)) {
    return sw.takes.filter((t) => t && Array.isArray(t.caps) && t.caps.length);
  }
  if (sw.kind && Array.isArray(sw.caps)) {
    return sw.caps.filter((c) => c && c.id != null).map((c) => {
      const t = { caps: [{ kind: sw.kind, id: c.id, name: c.name }] };
      if (Math.round(Number(c.n)) >= 1) t.n = c.n;
      return t;
    });
  }
  return [];
}

/* How many times one take of a sweep is rendered: its own count when it has
   been given one, otherwise the recipe's. */
function capRepeat(c, repeat) {
  const n = Math.round(Number(c && c.n));
  return n >= 1 ? n : Math.max(1, repeat || 1);
}

function queueTotal(queue) {
  return (queue || []).reduce((a, r) => a + rowTotal(r), 0);
}

/* ---------- reading the workflow ----------
   The options offered are whatever this graph actually has, not a list typed
   in here: every widget on every live node becomes a candidate. Graph data
   is read straight from app.graph._nodes, so no run is needed. */

const SKIP_WIDGET_TYPES = ["button", "converted-widget", "hidden",
                           "hidden_leiel", "leiel-hidden"];
const SKIP_WIDGETS = new Set([
  "control_after_generate", "log_to_console", "debug", "queue_json",
]);
/* No class is filtered out. Every node in the workflow is offered as a sweep
   candidate; this node excludes only itself, by identity, in the scan below. */

function optionKey(nodeId, widget) {
  return nodeId + "::" + widget;
}

/* Every widget in the graph that could be swept, as option candidates. */
function scanWorkflowOptions(self) {
  const out = [];
  const nodes = (app.graph && app.graph._nodes ? app.graph._nodes : [])
    .filter((n) => n !== self && n.mode !== 2 && n.mode !== 4)
    .sort((a, b) => (a.order || 0) - (b.order || 0));

  for (const n of nodes) {
    const title = String(n.title || n.type || "").trim() || ("#" + n.id);
    for (const w of n.widgets || []) {
      if (!w || !w.name) continue;
      if (SKIP_WIDGET_TYPES.includes(w.type)) continue;
      if (SKIP_WIDGETS.has(w.name)) continue;
      const v = w.value;
      const isNum = typeof v === "number";
      const isCombo = Array.isArray(w.options && w.options.values);
      const isBool = typeof v === "boolean";
      /* Long strings are offered too. The chip truncates on screen, so there is
         no reason to hide a prompt or a path from the sweep list. */
      const isText = typeof v === "string" && !isCombo;
      if (!isNum && !isCombo && !isBool && !isText) continue;
      out.push({
        key: optionKey(n.id, w.name),
        nodeId: n.id,
        title,
        cls: String(n.comfyClass || n.type || ""),
        widget: w.name,
        value: v,
        choices: isCombo ? w.options.values.slice() : null,
        kind: isCombo ? "combo" : isBool ? "bool" : isNum ? "number" : "text",
      });
    }
  }
  return out;
}

/* ---------- the node face ---------- */

app.registerExtension({
  name: "studioleiel.visual.series.lab",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE) return;

    const created = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      created?.apply(this, arguments);
      const node = this;

      if (!document.getElementById("vsl-css")) {
        const st = document.createElement("style");
        st.id = "vsl-css";
        st.textContent = CSS;
        document.head.appendChild(st);
      }

      /* The queue and the render in hand are kept in two STRING widgets. They
         are the node's own bookkeeping, never something to wire, so they are
         given no height and never drawn.

         Hiding them is not enough. Recent ComfyUI gives every widget an input
         socket of its own, always present, sitting at the widget's place
         inside the node - and these two sit under the panel where nothing can
         be seen. A prompt wire dragged anywhere near the body would snap into
         one of them, silently replacing the queue with prompt text. So the
         socket is asked not to exist, and refused as well: asking alone
         depends on a frontend option, and refusing works whatever the
         frontend does. */
      const SEALED = new Set(["queue_json", "current_json"]);
      for (const name of SEALED) {
        const w = node.widgets?.find((x) => x.name === name);
        if (!w) continue;
        w.computeSize = () => [0, -4];
        w.draw = () => {};
        w.hidden = true;
        w.options = w.options || {};
        w.options.socketless = true;
      }

      const sealedAt = (slot) => {
        const inp = (node.inputs || [])[slot];
        return !!(inp && (SEALED.has(inp.name)
                          || SEALED.has(inp.widget && inp.widget.name)));
      };

      /* Asking for no socket is not enough on every frontend: the socket is
         refused but still drawn, and a grey dot appears above "model" the
         moment a STRING wire is picked up - two dots in the same place, since
         both widgets sit at the same zero height. A dot with nothing behind it
         is worse than a dot that works, so the entries are taken out of the
         input list as well. */
      function dropSealedSockets() {
        try {
          for (let i = (node.inputs || []).length - 1; i >= 0; i--) {
            const inp = node.inputs[i];
            const name = (inp && inp.widget && inp.widget.name)
              || (inp && inp.name);
            if (!SEALED.has(name)) continue;
            if (inp.link !== null && inp.link !== undefined) {
              node.disconnectInput(i);
            }
            node.inputs.splice(i, 1);
          }
          node.setDirtyCanvas(true, true);
        } catch (e) { /* ignore */ }
      }
      dropSealedSockets();
      setTimeout(dropSealedSockets, 0);

      const prevConnectInput = node.onConnectInput;
      node.onConnectInput = function (slot, ...rest) {
        if (sealedAt(slot)) return false;
        return prevConnectInput
          ? prevConnectInput.call(this, slot, ...rest)
          : true;
      };
      const store = node.widgets?.find((w) => w.name === "queue_json");

      const state = {
        loras: [],
        picked: [],      // brought in from the browser, kept on the shelf
        triggers: {},    // lora name -> the words filed beside it
        trigOff: {},     // words the person has switched off
        /* Words that change from one recipe to the next - "looking at
           viewer", say. They sit in their own row of the Trigger words panel
           and on every recipe, where each recipe turns them on or off for
           itself. word -> true */
        trigVar: {},
        trigPos: "prepend",
        thumbs: {},
        note: "",
        draft: { loras: [], opts: [], repeat: 4 },
        options: [],
        optQuery: "",
        promptNames: {}, // prompt slot -> the name given to it on the shelf
        promptNameSrc: {}, // and which wire that name was typed about
        done: {},        // recipe id -> how many of its images have come back
        sent: {},        // recipe id -> how many have gone to the server
        brSort: "name",  // how the browser orders what it shows
        optView: "flat",
        queue: [],
        live: { index: -1, total: 0, remaining: 0, status: "not run yet",
                chips: [], files: [], label: "", rowId: "" },
        running: false,
        paused: false,
        heights: {},
        h: 470,
        split: 0.55,
      };

      /* What survives a workflow being closed, switched away from, or
         reloaded. The queue was the only thing kept before, which is why the
         LoRAs picked in the browser and a half-built recipe vanished the
         moment the node was rebuilt - they lived in memory and nowhere else.

         The scanned options are deliberately NOT kept: they are read back off
         the graph, so storing them would only be a copy going stale. */
      const STORE_V = 2;
      let lastStore = null;

      /* Whichever copy actually made it back. A value of "[]" or "{}" is what
         a dropped widget looks like after ComfyUI fills in the default, so a
         stored copy in properties wins over an empty widget rather than the
         other way round. */
      const storedText = () => {
        const fromWidget = String(store?.value ?? "");
        const fromProps = String(node.properties?.vsl_store ?? "");
        const empty = (t) => !t || t === "[]" || t === "{}" || t === "null";
        if (!empty(fromWidget)) return fromWidget;
        if (!empty(fromProps)) return fromProps;
        return fromWidget || fromProps || "[]";
      };

      const readStore = () => {
        try {
          const v = JSON.parse(storedText() || "[]");
          if (Array.isArray(v)) {                 // written by an older build
            state.queue = v;
          } else if (v && typeof v === "object") {
            state.queue = Array.isArray(v.queue) ? v.queue : [];
            state.picked = Array.isArray(v.picked) ? v.picked : [];
            /* once the shared shelf is in, a workflow's old copy never
               replaces it */
            if (node._vslShelfReady) state.picked = lshelfCopy(LSHELF.picked);
            if (v.done && typeof v.done === "object") state.done = v.done;
            if (Array.isArray(v.optFavs)) optFavMerge(v.optFavs);
            if (v.promptNames && typeof v.promptNames === "object") {
              state.promptNames = v.promptNames;
              state.promptNameSrc =
                (v.promptNameSrc && typeof v.promptNameSrc === "object")
                  ? v.promptNameSrc : {};
            }
            if (v.sent && typeof v.sent === "object") state.sent = v.sent;
            if (v.seriesLook && typeof v.seriesLook === "object") state.seriesLook = v.seriesLook;
            if (v.pickFold && typeof v.pickFold === "object") state.pickFold = v.pickFold;
            const SH = v.shelf;
            if (SH && typeof SH === "object") {
              if (SH.trigOff && typeof SH.trigOff === "object") state.trigOff = { ...SH.trigOff };
              if (SH.trigVar && typeof SH.trigVar === "object") state.trigVar = { ...SH.trigVar };
              if (["prepend", "append", "off"].includes(SH.trigPos)) state.trigPos = SH.trigPos;
              if (typeof SH.optView === "string") state.optView = SH.optView;
              if (typeof SH.brSort === "string") state.brSort = SH.brSort;
            }
            const L = v.layout;
            if (L && typeof L === "object") {
              const sp = Number(L.split);
              if (Number.isFinite(sp) && sp >= 0.25 && sp <= 0.75) state.split = sp;
              if (L.heights && typeof L.heights === "object") {
                const hs = {};
                for (const [k, x] of Object.entries(L.heights)) {
                  if (Number.isFinite(Number(x)) && Number(x) > 0) hs[k] = Number(x);
                }
                state.heights = hs;
              }
              if (Number.isFinite(Number(L.h)) && Number(L.h) > 0) state.h = Number(L.h);
            }
            const d = v.draft;
            if (d && typeof d === "object") {
              state.draft = {
                loras: Array.isArray(d.loras) ? d.loras : [],
                opts: Array.isArray(d.opts) ? d.opts : [],
                repeat: Math.max(1, Math.round(Number(d.repeat) || 1)),
                prompt: Number(d.prompt) || 0,
                sweep: (d.sweep && typeof d.sweep === "object") ? d.sweep : null,
                trig: (d.trig && typeof d.trig === "object") ? d.trig : {},
              };
            }
          }
        } catch (e) {
          state.queue = [];
        }
        assignNumbers();
        /* Put back whichever copy was read, so the widget carries it from
           here on even if it arrived empty. */
        const text = storedText();
        if (store && store.value !== text) store.value = text;
        lastStore = text;
      };

      /* Called from paint, so anything that changes the face is kept without
         each of those places having to remember to say so. The comparison
         keeps it to an actual write when something actually changed. */
      const persist = () => {
        /* the shelf itself goes to the server, for every workflow */
        if (node._vslShelfReady && LSHELF.loaded && !LSHELF.failed) {
          const mine = JSON.stringify(lshelfCopy(state.picked));
          if (mine !== JSON.stringify(lshelfCopy(LSHELF.picked))) {
            LSHELF.picked = lshelfCopy(state.picked);
            lshelfSave(node._vslShelfSub);
          }
        }
        if (!store) return;
        const doc = JSON.stringify({
          v: STORE_V,
          queue: state.queue,
          picked: state.picked,
          draft: state.draft,
          done: state.done,
          sent: state.sent,
          promptNames: state.promptNames,
          promptNameSrc: state.promptNameSrc,
          seriesLook: state.seriesLook || {},
          pickFold: state.pickFold || {},
          optFavs: optFavList(),
          /* the column divider and the panel heights, so the layout someone
             set up comes back after a reload or a trip to another tab */
          layout: { split: state.split, heights: state.heights, h: state.h },
          /* the shelves' own switches: trigger words turned off, where the
             triggers go, how the options are laid out, the browser's sort */
          shelf: { trigOff: state.trigOff, trigPos: state.trigPos,
                   trigVar: state.trigVar,
                   optView: state.optView, brSort: state.brSort },
        });
        if (doc === lastStore) return;
        lastStore = doc;
        store.value = doc;
        /* Written down twice, on purpose. widgets_values is the normal place
           and the one the backend reads, but it is also the part of a node
           another extension is most likely to rewrite on the way to disk -
           an encrypting or sanitising pass over the saved workflow can drop a
           value it does not recognise. node.properties travels by a different
           road and is left alone, so if either survives the round trip the
           queue comes back. */
        try {
          node.properties = node.properties || {};
          node.properties.vsl_store = doc;
        } catch (e) { /* frozen properties: the widget still has it */ }
        node.setDirtyCanvas(true, true);
      };

      const writeStore = () => {
        /* Nothing to reset any more: progress is counted per recipe, so a
           change to the plan leaves every finished image exactly where it
           was and the totals simply recount. */
        persist();
      };
      /* A workflow saved by an older version of this pack carries output
         slots that no longer exist. ComfyUI keeps them and renames by index,
         which is how a second "status" appeared. Trim the extras from the
         tail only - never from the middle, or the links that remain would be
         shifted onto the wrong outputs. */
      function trimStaleOutputs() {
        try {
          const want = (nodeData.output_name || []).length ||
                       (nodeData.output || []).length;
          if (!want) return;
          while ((node.outputs || []).length > want) {
            const last = node.outputs.length - 1;
            const o = node.outputs[last];
            if (o && o.links && o.links.length) break;   // still wired
            node.removeOutput(last);
          }
          /* And the other way. A workflow saved before an output was added,
             or before the outputs were reordered, carries its own list, and
             that list wins when it loads - while the backend answers in the
             new order. Left alone, a wire on "status" would quietly receive
             the series name. So the outputs are laid out again in the order
             the node now has them, and every wire is carried to the place
             its output moved to. */
          const names = nodeData.output_name || [];
          const types = nodeData.output || [];
          const have = node.outputs || [];
          const same = have.length === names.length
            && have.every((o, i) => o && o.name === names[i]);
          if (!same && names.length) {
            const byName = new Map(have.map((o) => [o && o.name, o]));
            const next = names.map((n, i) => byName.get(n)
              || { name: n, type: types[i] || "STRING", links: null });
            /* anything no longer in the node stays only while it is wired */
            for (const o of have) {
              if (o && !names.includes(o.name) && o.links && o.links.length) next.push(o);
            }
            const L = app.graph && app.graph.links;
            next.forEach((o, i) => {
              for (const id of (o.links || [])) {
                const link = L ? (typeof L.get === "function" ? L.get(id) : L[id]) : null;
                if (link) link.origin_slot = i;
              }
            });
            node.outputs = next;
            node.setDirtyCanvas(true, true);
          }
        } catch (e) { /* ignore */ }
      }
      /* The prompt sockets grow as they are used: one empty one is always on
         offer, and a new one appears behind it as soon as that is wired, up
         to ten. Ten empty sockets on a fresh node would say "you must fill
         these in", which is not true of any of them. Must match MAX_PROMPTS
         in the node, which decides how many the backend will accept. */
      const MAX_PROMPTS = 10;

      /* A Series Book on the "series" wire puts every one of its prompts on
         the shelf. They are numbered past the sockets - BOOK_BASE plus the
         prompt's id inside the book - so a recipe names a book prompt with the
         same field it uses for a socket, and the id survives the prompt being
         renamed or moved. Must match BOOK_SLOT_BASE in the node. */
      const BOOK_BASE = 1000;

      function seriesBook() {
        const up = bookNode();
        return up ? up.leielBook() : null;
      }
      function bookNode() {
        try {
          const inp = (node.inputs || []).find((x) => x.name === "series");
          if (!inp || inp.link === null || inp.link === undefined) return null;
          let link = app.graph.links[inp.link];
          for (let guard = 0; link && guard < 8; guard++) {
            const up = app.graph.getNodeById(link.origin_id);
            if (!up) return null;
            if (typeof up.leielBook === "function") {
              if (up.mode === 2 || up.mode === 4) return null;   // muted or bypassed
              return up;
            }
            const type = String(up.comfyClass || up.type || "");
            if (/reroute/i.test(type) && up.inputs?.[0]?.link != null) {
              link = app.graph.links[up.inputs[0].link];
              continue;
            }
            return null;
          }
        } catch (e) { /* ignore */ }
        return null;
      }

      function bookPrompt(n) {
        if (n < BOOK_BASE) return null;
        const b = seriesBook();
        if (!b || !Array.isArray(b.prompts)) return null;
        return b.prompts.find((p) => p.id === n - BOOK_BASE) || null;
      }

      /* The note written on a book prompt in the Series Book - what the
         scene is about - shown on the prompt's chips here too. */
      function promptNote(n) {
        const p = bookPrompt(Number(n));
        const t = p && typeof p.note === "string" ? p.note.trim() : "";
        return t ? t + "\n" : "";
      }

      /* A book's prompts in the order the book shows them: series by series. */
      function bookOrder(b) {
        const ps = (b && Array.isArray(b.prompts)) ? b.prompts : [];
        if (!Array.isArray(b.groups) || !b.groups.length) return ps;
        const out = [];
        for (const g of b.groups) out.push(...ps.filter((p) => p.g === g.id));
        return out;
      }
      function seriesNoOf(b, gid) {
        const g = (b && Array.isArray(b.groups)) ? b.groups.find((x) => x.id === gid) : null;
        return g ? g.no : 0;
      }
      /* The number the book gives a prompt - 2-03, or 03 when the book holds
         one series. Shown beside the name, never part of it, so the name
         that goes out to file names stays exactly what it was. */
      function promptNo(n) {
        if (Number(n) < BOOK_BASE) return "";
        const b = seriesBook();
        const p = bookPrompt(n);
        if (!b || !p) return "";
        const no = String(p.no || 0).padStart(2, "0");
        return (Array.isArray(b.groups) && b.groups.length > 1)
          ? seriesNoOf(b, p.g) + "-" + no : no;
      }

      /* A book prompt's number drawn as the Series Book draws it: the series
         figure in the series' colour, a bar, and the prompt's own number in
         the gold of the capsule numbers - "3 | 03". */
      function pnoEl(n) {
        if (Number(n) < BOOK_BASE) return null;
        const b = seriesBook();
        const p = bookPrompt(n);
        if (!b || !p) return null;
        const el = document.createElement("span");
        el.className = "vsl-pno";
        if (Array.isArray(b.groups) && b.groups.length > 1) {
          const sn = document.createElement("i");
          sn.className = "sn";
          sn.textContent = String(seriesNoOf(b, p.g));
          el.appendChild(sn);
        }
        const sq = document.createElement("i");
        sq.className = "sq";
        sq.textContent = String(p.no || 0).padStart(2, "0");
        el.appendChild(sq);
        return el;
      }

      /* The name of the series a book prompt belongs to, for file names. */
      function seriesName(n) {
        if (Number(n) < BOOK_BASE) return "";
        const b = seriesBook();
        const p = bookPrompt(n);
        if (!b || !p || !Array.isArray(b.groups)) return "";
        const g = b.groups.find((x) => x.id === p.g);
        return g ? String(g.name || "") : "";
      }

      /* ---- series on the shelf ----
         Each series of a Series Book is a group on the prompt shelf: it
         folds, and it can wear a colour of its own, which its prompts carry
         onto the recipe and the queue too. Kept per series by the id the
         series file is saved under, so it survives renaming and reordering. */
      const SERIES_HUES = [
        ["#22c3d6", "#0f4a52", "#a6f0f8"],   // the shelf's own teal
        ["#c9a33f", "#473b1e", "#e8d089"],   // retired - capsule numbers' gold
        ["#f05aa8", "#561d3c", "#ffb8dd"],
        ["#2fcf7f", "#124a30", "#a3f2c8"],
        ["#3a7bff", "#14305e", "#b3ccff"],
        ["#9a7cff", "#36295e", "#d4c7ff"],
        ["#ff8a3d", "#5a2c10", "#ffc9a3"],
        ["#ff5555", "#5a1a1a", "#ffb3b3"],
        ["#a8b0bc", "#33363c", "#e2e6ec"],
        ["#b6e33a", "#3e4d12", "#e3f7a8"],
        ["#e04cf0", "#4f1a56", "#f3b6fa"],
        ["#58c8ff", "#16405a", "#bfe9ff"],
      ];
      const seriesKey = (g) => String((g && (g.uid || "g" + g.id)) || "");
      /* The colour lives in the book, with the series, so the book wears
         it too (a step quieter) and every Lab on that book agrees. Folding
         stays here: it is how this shelf is laid out, nothing more. */
      function seriesLook(g) {
        state.seriesLook = state.seriesLook || {};
        const look = state.seriesLook[seriesKey(g)] || {};
        if (g && Number.isInteger(g.hue)) return Object.assign({}, look, { hue: g.hue });
        if (g && Number.isInteger(look.hue)) pushHue(g, look.hue);   // a colour from before the book kept it
        return look;
      }
      function pushHue(g, hue) {
        const up = bookNode();
        if (up && typeof up.leielSetSeriesHue === "function" && g && g.uid) {
          try { up.leielSetSeriesHue(g.uid, hue); } catch (e) { /* ignore */ }
        }
      }
      function setSeriesLook(g, patch) {
        state.seriesLook = state.seriesLook || {};
        const k = seriesKey(g);
        state.seriesLook[k] = Object.assign({}, state.seriesLook[k] || {}, patch);
        writeStore();
        if (Number.isInteger(patch.hue)) pushHue(g, patch.hue);
      }
      /* gold is retired - it reads as a capsule number; the Series Book
         leaves the same one out */
      const RETIRED_HUES = new Set([1]);
      function hueVars(el, hue) {
        const h = (!RETIRED_HUES.has(hue) && SERIES_HUES[hue]) || SERIES_HUES[0];
        el.style.setProperty("--sb", h[0]);
        el.style.setProperty("--sbg", h[1]);
        el.style.setProperty("--sfg", h[2]);
      }
      /* A prompt chip from the book wears its series' colour wherever it is. */
      function tintPrompt(el, n) {
        if (Number(n) < BOOK_BASE) return el;
        const b = seriesBook();
        const p = bookPrompt(Number(n));
        const g = b && p && Array.isArray(b.groups) ? b.groups.find((x) => x.id === p.g) : null;
        if (!g) return el;
        el.classList.add("sg");
        hueVars(el, Number(seriesLook(g).hue) || 0);
        return el;
      }

      /* ---- capsule sweep ----
         A recipe on a Series Book prompt can render once per capsule of one
         kind: the same scene through every camera on the shelf, or every
         light, or every pose. The capsules are taken when the recipe is
         queued, so a queued sweep does not change under it when the book is
         edited later. */
      const SWEEP_KINDS = ["pose", "scene", "camera", "outfit", "subject", "quality",
                           "absolute", "trigger"];
      const SWEEP_LABEL = { trigger: "trigger", quality: "quality",
        subject: "subject", outfit: "outfit", pose: "pose", scene: "scene", camera: "camera",
        absolute: "absolute" };
      /* By default the capsules of the prompt's own series; every series
         when asked. A kind is offered once it has `min` capsules - two to
         sweep it on its own, one is enough to put into a combination. */
      function sweepable(n, all, min) {
        const out = new Map();
        if (Number(n) < BOOK_BASE) return out;
        const b = seriesBook();
        if (!b || !b.caps) return out;
        const me = bookPrompt(n);
        const order = new Map();
        bookOrder(b).forEach((q, i) =>
          (q.caps || []).forEach((c) => { if (!order.has(c)) order.set(c, i); }));
        /* the Series Book's own capsule numbers, and its order by them */
        let nos = {};
        try { const up = bookNode(); if (up && up.leielCapNos) nos = up.leielCapNos() || {}; } catch (e) { nos = {}; }
        const keyOf = (c) => nos[c.id] ? nos[c.id].key : (order.has(c.id) ? 9e8 + order.get(c.id) : 1e9);
        for (const kind of SWEEP_KINDS) {
          const caps = Object.values(b.caps)
            .filter((c) => c && c.kind === kind && String((c.sec || {}).text || "").trim()
              && (all || !me || !c.g || c.g === me.g))
            .sort((a, z) => keyOf(a) - keyOf(z) || a.id - z.id)
            .map((c) => ({ id: c.id, kind, no: nos[c.id] ? nos[c.id].label : "", name: String(c.name || SWEEP_LABEL[kind]),
                           text: String((c.sec || {}).text || ""),
                           series: seriesNoOf(b, c.g) }));
          if (caps.length >= (min || 2)) out.set(kind, caps);
        }
        return out;
      }

      /* A sweep is { takes: [{ caps: [{ kind, id, name }], n? }], view? } on
         the recipe or the queued row alike, so the same chip and the same
         picker edit both - `view` is only the kind the picker last showed.
         Older forms are read and rewritten in place: a bare kind (every
         capsule of it), and { kind, caps } (one take per capsule). */
      function sweepOf(target) {
        const sw = target && target.sweep;
        if (!sw) return null;
        if (typeof sw === "string") {
          const caps = sweepable(target.prompt).get(sw) || [];
          if (!caps.length) return null;
          target.sweep = { view: sw, takes: caps.map((c) =>
            ({ caps: [{ kind: sw, id: c.id, name: c.name }] })) };
          return target.sweep;
        }
        if (typeof sw !== "object") return null;
        if (Array.isArray(sw.takes)) return sw;
        if (sw.kind && Array.isArray(sw.caps)) {
          target.sweep = { view: sw.kind, takes: sweepTakes(sw) };
          return target.sweep;
        }
        return null;
      }

      /* the kinds a sweep touches, in the book's order - "pose + camera" */
      function sweepKinds(sw) {
        const seen = new Set();
        for (const t of sweepTakes(sw)) for (const c of t.caps) seen.add(c.kind);
        return SWEEP_KINDS.filter((k) => seen.has(k)).concat([...seen].filter((k) => !SWEEP_KINDS.includes(k)));
      }

      function takeName(t) {
        return t.caps.map((c) => c.name).join(" + ");
      }

      /* The frame a book prompt asks for, shown and changed beside the
         prompt in the recipe and the queue. It is the book's own setting, so
         a change here is a change in the book, and the other way round. */
      const FRAMES = ["all", "portrait", "landscape", "square"];
      const FRAME_NAME = { all: "any frame", portrait: "portrait", landscape: "landscape", square: "square" };
      function frameChip(target) {
        const n = Number(target.prompt);
        if (n < BOOK_BASE) return null;
        const bp = bookPrompt(n);
        if (!bp) return null;
        const cur = FRAMES.includes(bp.orient) ? bp.orient : "all";
        const b = document.createElement("span");
        b.className = "vsl-frame f-" + cur;
        b.innerHTML = "<i></i>";
        b.title = "Frame: " + FRAME_NAME[cur] +
          " - click for the next, shift+click for the one before.\n" +
          "Set in the Series Book prompt; a Visual Latent Size Picker picks only sizes of this shape";
        b.addEventListener("click", (ev) => {
          ev.stopPropagation();
          const up = bookNode();
          if (!up || typeof up.leielSetPromptOrient !== "function") return;
          const k = FRAMES.length;
          const next = FRAMES[(FRAMES.indexOf(cur) + (ev.shiftKey ? k - 1 : 1)) % k];
          try { up.leielSetPromptOrient(n - BOOK_BASE, next); } catch (e) { /* ignore */ }
          paint();
        });
        b.addEventListener("pointerdown", (ev) => ev.stopPropagation());
        return b;
      }

      function sweepChip(target) {
        if (Number(target.prompt) < BOOK_BASE) return null;
        const kinds = sweepable(target.prompt);
        const sw = sweepOf(target);
        if (!sw && !kinds.size && !sweepable(target.prompt, true).size) return null;
        const takes = sweepTakes(sw);
        const rep0 = Math.max(1, target.repeat || 1);
        const ks = sweepKinds(sw);
        const ckWarn = !!sw && takes.some((t) => takeCheck(target, t).some((x) => x.level === "warn"));
        return tintPrompt(chip("c-sw" + (ckWarn ? " ckwarn" : ""), sw ? (ckWarn ? "! " : "") + "⇄ " + (ks.length ? ks.map((k) => SWEEP_LABEL[k] || k).join(" + ") : "sweep") : "⇄ sweep",
          sw ? (takes.length
            ? takes.length + " · " + takes.reduce((a, t) => a + capRepeat(t, rep0), 0)
            : "pick") : "", {
          on: !!sw,
          muted: !sw,
          title: sw ? null
            : "capsule sweep - off\nclick to render this prompt once per capsule, or per combination of capsules",
          onClick: (ev) => { sweepCardHide(); openSweepPicker(target, ev.currentTarget); },
          onRemove: sw ? () => { sweepCardHide(); target.sweep = null; writeStore(); paint(); } : null,
          hover: sw ? (el) => sweepCardSoon(el, target) : null,
          hoverKey: target.id != null ? target.id : "draft",
        }), target.prompt);
      }

      /* ---- the sweep, read on hover ----
         The takes in order as a strip of small cards: the picture of each
         capsule's drawer card, its kind and name, how many renders it gets
         and, on a queued recipe, how far the run has got. The pictures come
         from the Series Book's drawer, matched on the capsule's words. */
      const LAB_KIND_HUE = {
        trigger: "#9a9a9a", quality: "#c98a3c", subject: "#c06a9c", outfit: "#8fa83f", pose: "#48a882",
        scene: "#4a92c8", camera: "#7b6ce0", absolute: "#c85f5f", other: "#8a8a8a",
      };
      const labDrawer = { items: [], at: 0, busy: null };
      function labDrawerLoad() {
        if (labDrawer.busy || Date.now() - labDrawer.at < 15000) return labDrawer.busy || Promise.resolve();
        labDrawer.busy = fetch("/leiel_vpc/drawer").then((r) => r.ok ? r.json() : null).then((j) => {
          if (j && Array.isArray(j.items)) labDrawer.items = j.items;
        }).catch(() => {}).finally(() => { labDrawer.at = Date.now(); labDrawer.busy = null; });
        return labDrawer.busy;
      }
      function labThumb(kind, text) {
        const norm = (t) => String(t || "").replace(/\s+/g, " ").trim().toLowerCase();
        const want = norm(text);
        if (!want) return null;
        const ok = (i) => i && i.thumb && norm(i.text) === want;
        const hit = labDrawer.items.find((i) => ok(i) && i.kind === kind) || labDrawer.items.find(ok);
        return hit ? hit.thumb : null;
      }
      /* One take read by the Series Book's anchor check: the prompt's own
         anchors with the take's capsules in place of their kinds. */
      function takeCheck(target, take) {
        const up = bookNode();
        if (!up || typeof up.leielCheck !== "function") return [];
        const bk = up.leielBook();
        const me = bookPrompt(target.prompt);
        if (!bk || !me || !bk.caps) return [];
        const swapped = new Set(take.caps.map((c) => c.kind));
        const ids = me.caps.filter((id) => bk.caps[id] && !swapped.has(bk.caps[id].kind))
          .concat(take.caps.map((c) => c.id));
        const anchors = ids.map((id) => bk.caps[id]).filter((c) => c && c.kind !== "trigger")
          .map((c) => ({ kind: c.kind, name: c.name, text: String((c.sec || {}).text || "") }));
        try { return up.leielCheck(anchors, up.leielShape ? up.leielShape() : null) || []; }
        catch (e) { return []; }
      }
      let swCard = null, swCardT = null;
      function sweepCardHide() {
        if (swCardT) { clearTimeout(swCardT); swCardT = null; }
        if (swCard) { swCard.remove(); swCard = null; }
      }
      function sweepCardSoon(el, target) {
        sweepCardHide();
        labDrawerLoad();
        swCardT = setTimeout(() => { swCardT = null; sweepCardShow(el, target); }, 300);
      }
      function sweepCardShow(el, target) {
        if (!el.isConnected) return;
        const sw = sweepOf(target);
        const takes = sweepTakes(sw);
        if (!takes.length) return;
        const bk = seriesBook();
        const rep0 = Math.max(1, target.repeat || 1);
        const total = takes.reduce((a, t) => a + capRepeat(t, rep0), 0);
        const queued = state.queue.includes(target);
        const sent = queued ? sentOf(target) : 0;
        const per = rowTotal(target) / (total || 1);
        let acc = 0;
        const esc = (t) => String(t == null ? "" : t).replace(/[&<>"]/g, (c) =>
          ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
        const card = document.createElement("div");
        card.className = "vsl-swcard";
        const ks = sweepKinds(sw);
        let warnN = 0;
        const rows = takes.map((t, ti) => {
          const n = capRepeat(t, rep0);
          const a0 = acc, a1 = acc + per * n;
          acc = a1;
          const st = !queued ? "" : a1 <= sent ? "done" : a0 < sent ? "now" : "";
          const got = queued ? Math.max(0, Math.min(n, Math.round((sent - a0) / (per || 1)))) : 0;
          const caps = t.caps.slice().sort((p, q) => SWEEP_KINDS.indexOf(p.kind) - SWEEP_KINDS.indexOf(q.kind));
          const info = caps.map((c) => {
            const cap = bk && bk.caps ? bk.caps[c.id] : null;
            const text = cap ? String((cap.sec || {}).text || "") : "";
            return { kind: c.kind || (cap && cap.kind), name: cap ? String(cap.name || c.name) : c.name,
              gone: !cap, thumb: cap ? labThumb(c.kind || cap.kind, text) : null };
          });
          const pics = info.map((c) => {
            const hue = LAB_KIND_HUE[c.kind] || LAB_KIND_HUE.other;
            return `<span class="pic${c.thumb ? "" : " none"}" style="--k:${hue}">`
              + (c.thumb ? `<img src="${c.thumb}" alt="">` : `<i>${esc((SWEEP_LABEL[c.kind] || c.kind || "").slice(0, 1))}</i>`)
              + `</span>`;
          }).join("");
          const names = info.map((c) => {
            const hue = LAB_KIND_HUE[c.kind] || LAB_KIND_HUE.other;
            return `<span class="nm${c.gone ? " gone" : ""}"><em style="--k:${hue}">${esc(SWEEP_LABEL[c.kind] || c.kind)}</em>${esc(c.name)}</span>`;
          }).join("");
          const ck = takeCheck(target, t);
          const warn = ck.find((x) => x.level === "warn");
          const note = !warn && ck.find((x) => x.level === "note");
          if (warn) warnN++;
          const ckLine = warn || note
            ? `<span class="ckl ${warn ? "warn" : "note"}"><i>${warn ? "!" : "i"}</i>${esc((warn || note).title)}`
              + (ck.length > 1 ? ` <em>+${ck.length - 1}</em>` : "") + `</span>` : "";
          return `<div class="tk${st ? " " + st : ""}${warn ? " flag" : ""}">`
            + `<span class="no">${ti + 1}</span><span class="pics">${pics}</span>`
            + `<span class="nms">${names}${ckLine}</span>`
            + `<span class="ct">${queued ? `<b>${got}</b>/${n}` : `&times;${n}`}`
            + (st === "done" ? `<i class="ok">&#10003;</i>` : st === "now" ? `<i class="dot"></i>` : "")
            + `</span>`
            + (queued ? `<span class="bar"><span style="width:${Math.round(100 * got / (n || 1))}%"></span></span>` : "")
            + `</div>`;
        }).join("");
        card.innerHTML = `<div class="hd"><b>Capsule sweep</b>`
          + ks.map((k) => `<span class="kp" style="--k:${LAB_KIND_HUE[k] || LAB_KIND_HUE.other}">${esc(SWEEP_LABEL[k] || k)}</span>`).join("")
          + `<span class="sp"></span><span class="sum">${takes.length} take${takes.length === 1 ? "" : "s"} &middot; ${total} render${total === 1 ? "" : "s"}</span></div>`
          + `<div class="sub">${esc(promptName(target.prompt))} &middot; one setting after another, in this order</div>`
          + (warnN ? `<div class="ckh"><i>!</i>${warnN} take${warnN === 1 ? "" : "s"} where the anchors pull apart - `
            + `put that take's capsule in the prompt and the Series Book's This Prompt tab explains it</div>` : "")
          + `<div class="tks">${rows}</div>`
          + `<div class="ft">click - change the takes &nbsp;&middot;&nbsp; x - turn the sweep off</div>`;
        document.body.appendChild(card);
        swCard = card;
        const place = () => {
          const r = el.getBoundingClientRect();
          const b = card.getBoundingClientRect();
          let left = Math.min(r.left, innerWidth - b.width - 8);
          let top = r.bottom + 8;
          if (top + b.height > innerHeight - 8) top = Math.max(8, r.top - b.height - 8);
          card.style.left = Math.max(8, left) + "px";
          card.style.top = top + "px";
        };
        place();
        /* pictures that arrive after the card opened are put in place */
        if (labDrawer.busy) labDrawer.busy.then(() => {
          if (swCard === card && el.isConnected) { card.remove(); swCard = null; sweepCardShow(el, target); }
        });
        /* the queue repaints under a run, and a chip replaced never hears the
           mouse leave - the card goes with the chip it was opened from */
        const watch = setInterval(() => {
          if (swCard !== card) { clearInterval(watch); return; }
          if (!el.isConnected) {
            clearInterval(watch);
            const nu = document.querySelector(`.vsl-chip.c-sw[data-swrow="${el.dataset.swrow}"]`);
            if (nu && nu.matches(":hover")) { card.remove(); swCard = null; sweepCardShow(nu, target); }
            else sweepCardHide();
            return;
          }
          if (!el.matches(":hover")) { clearInterval(watch); sweepCardHide(); }
        }, 400);
      }

      /* The picker. At the top the takes - each one render setting, one
         capsule or several of different kinds, with its own count. Below,
         the capsules of one kind at a time, each shown with the start of its
         text so a capsule named after a scene still says what it does.

         Clicking a capsule makes it a take of its own, or takes it away
         again - a sweep of one kind is just that. To combine, press + on a
         take: until it is pressed again, a capsule clicked goes into that
         take, in place of any of its kind already there. On a queued row the
         takes also show how far the run has got. */
      function openSweepPicker(target, anchor) {
        closeEditor();
        const bk = seriesBook();
        const manySeries = !!(bk && Array.isArray(bk.groups) && bk.groups.length > 1);
        const me = bookPrompt(target.prompt);
        const myNo = me ? seriesNoOf(bk, me.g) : 0;
        /* a sweep with nothing in it is no sweep - it is put on the recipe
           with its first take and taken off again with its last */
        let swLocal = sweepOf(target) || { takes: [] };
        /* a sweep that already reaches into another series opens showing all */
        let all = manySeries && me && sweepTakes(swLocal).some((t) => t.caps.some((c) => {
          const cap = bk.caps && bk.caps[c.id];
          return cap && cap.g && cap.g !== me.g;
        }));
        let kinds = sweepable(target.prompt, all, 1);
        let active = -1;
        const box = document.createElement("div");
        box.className = "vsl-edit vsl-sweep";
        const queued = state.queue.includes(target);

        /* everything known of a capsule, from the book when it still has it */
        const capInfo = (c) => {
          const cap = bk && bk.caps ? bk.caps[c.id] : null;
          return cap && String((cap.sec || {}).text || "").trim()
            ? { id: c.id, kind: c.kind || cap.kind, name: String(cap.name || c.name),
                text: String(cap.sec.text), series: seriesNoOf(bk, cap.g) }
            : { ...c, gone: true };
        };
        /* which series a capsule comes from, whenever it is not this
           prompt's own - or always, when every series is on offer */
        const seriesTag = (no) => {
          if (!manySeries || !no || (!all && no === myNo)) return null;
          const g = bk.groups.find((x) => x.no === no);
          const tag = document.createElement("span");
          tag.className = "sw-sg";
          tag.textContent = no + (g ? "  " + g.name : "");
          if (g) hueVars(tag, Number(seriesLook(g).hue) || 0);
          return tag;
        };
        const save = () => {
          target.sweep = swLocal.takes.length ? swLocal : null;
          writeStore(); paint(); draw();
        };

        let listScroll = 0;
        const draw = () => {
          /* the list is rebuilt on every click - keep where it was scrolled,
             or each click would throw it back to the top */
          const oldList = box.querySelector(".sw-list");
          if (oldList) listScroll = oldList.scrollTop;
          box.innerHTML = "";
          const sw = sweepOf(target) || swLocal;
          swLocal = sw;
          if (!Array.isArray(sw.takes)) sw.takes = [];
          sw.takes = sw.takes.filter((t) => t && Array.isArray(t.caps) && t.caps.length);
          const takes = sw.takes;
          if (active >= takes.length) active = -1;
          const rep0 = Math.max(1, target.repeat || 1);

          const head = document.createElement("div");
          head.className = "eh";
          head.textContent = "Capsule sweep - " + promptName(target.prompt);
          box.appendChild(head);

          /* ---- the takes ---- */
          const tbox = document.createElement("div");
          tbox.className = "sw-takes";
          const span = [];
          let acc = 0;
          const per = takes.length
            ? rowTotal(target) / takes.reduce((a, t) => a + capRepeat(t, rep0), 0) : 0;
          for (const t of takes) {
            const len = per * capRepeat(t, rep0);
            span.push([acc, acc + len]);
            acc += len;
          }
          const sent = queued ? sentOf(target) : 0;
          if (!takes.length) {
            const e = document.createElement("div");
            e.className = "sw-empty";
            e.textContent = "No takes yet - click capsules below. Each one becomes a take; "
              + "+ on a take adds a capsule of another kind to it.";
            tbox.appendChild(e);
          }
          takes.forEach((t, ti) => {
            let st = "";
            if (queued && span[ti]) {
              const [a0, a1] = span[ti];
              if (a1 <= sent) st = "done";
              else if (a0 < sent) st = "now";
            }
            const row = document.createElement("div");
            row.className = "sw-take" + (ti === active ? " act" : "") + (st ? " " + st : "");
            const ord = document.createElement("span");
            ord.className = "ord";
            ord.textContent = String(ti + 1);
            row.appendChild(ord);
            const caps = document.createElement("span");
            caps.className = "caps";
            const ordered = t.caps.slice().sort((p, q) =>
              SWEEP_KINDS.indexOf(p.kind) - SWEEP_KINDS.indexOf(q.kind));
            for (const c of ordered) {
              const info = capInfo(c);
              const pill = document.createElement("span");
              pill.className = "sw-cap" + (info.gone ? " gone" : "");
              pill.style.setProperty("--k", LAB_KIND_HUE[c.kind] || LAB_KIND_HUE.other);
              pill.title = info.gone ? info.name + " - no longer in the book" : info.text;
              const k = document.createElement("i");
              k.textContent = SWEEP_LABEL[c.kind] || c.kind;
              pill.appendChild(k);
              const tag = seriesTag(info.series);
              if (tag) pill.appendChild(tag);
              const capNo = (() => { try { const up = bookNode(); const m = up && up.leielCapNos ? up.leielCapNos() : {}; return m[c.id] ? m[c.id].label : ""; } catch (e) { return ""; } })();
              if (capNo) { const n = document.createElement("em"); n.className = "sw-no"; n.textContent = capNo; pill.appendChild(n); }
              pill.appendChild(document.createTextNode(info.name));
              const x = document.createElement("b");
              x.className = "x";
              x.textContent = "×";
              x.title = "take this capsule out of the take";
              x.addEventListener("click", (e) => {
                e.stopPropagation();
                t.caps = t.caps.filter((y) => y !== c);
                if (!t.caps.length) { takes.splice(ti, 1); if (active === ti) active = -1; else if (active > ti) active--; }
                save();
              });
              pill.appendChild(x);
              caps.appendChild(pill);
            }
            const add = document.createElement("button");
            add.className = "sw-add" + (ti === active ? " on" : "");
            add.textContent = ti === active ? "✓ Done" : "+ Add";
            add.title = ti === active
              ? "done adding to this take"
              : "add a capsule of another kind to this take - a camera to this pose, a light to both";
            add.addEventListener("click", (e) => {
              e.stopPropagation();
              active = active === ti ? -1 : ti;
              if (active >= 0) {
                /* show a kind the take has not got yet */
                const have = new Set(t.caps.map((c) => c.kind));
                if (have.has(sw.view)) {
                  const next = [...kinds.keys()].find((k) => !have.has(k));
                  if (next) { sw.view = next; listScroll = 0; }
                }
              }
              draw();
            });
            caps.appendChild(add);
            row.appendChild(caps);
            if (st) {
              const tg = document.createElement("span");
              tg.className = "tag" + (st === "now" ? " now" : "");
              tg.textContent = st;
              row.appendChild(tg);
            }
            const own = Math.round(Number(t.n)) >= 1;
            const n = document.createElement("span");
            n.className = "sw-n";
            n.title = "How many renders of this take - the recipe's count until you change it";
            n.innerHTML = `<button class="m">−</button><b class="n${own ? "" : " dflt"}">×${capRepeat(t, rep0)}</b><button class="p">+</button>`;
            const bump = (d) => (e) => {
              e.preventDefault(); e.stopPropagation();
              t.n = Math.max(1, Math.min(99, capRepeat(t, rep0) + d));
              save();
            };
            n.querySelector(".m").addEventListener("click", bump(-1));
            n.querySelector(".p").addEventListener("click", bump(1));
            const nEl = n.querySelector(".n");
            nEl.title = own ? "click to follow the recipe's count again" : "the recipe's count";
            nEl.addEventListener("click", (e) => {
              e.preventDefault(); e.stopPropagation();
              delete t.n;
              save();
            });
            row.appendChild(n);
            const del = document.createElement("button");
            del.className = "sw-del";
            del.textContent = "×";
            del.title = "remove this take";
            del.addEventListener("click", (e) => {
              e.stopPropagation();
              takes.splice(ti, 1);
              if (active === ti) active = -1; else if (active > ti) active--;
              save();
            });
            row.appendChild(del);
            tbox.appendChild(row);
          });
          box.appendChild(tbox);
          const sum = document.createElement("label");
          sum.className = "sw-sum";
          const total = rowTotal(target);
          sum.textContent = takes.length
            ? takes.length + " take" + (takes.length === 1 ? "" : "s") + " - "
              + total + " render" + (total === 1 ? "" : "s")
            : "nothing picked - the prompt renders as it is";
          box.appendChild(sum);

          /* ---- the capsules ---- */
          const shelf = document.createElement("div");
          shelf.className = "sw-shelf";

          /* Whose capsules: this prompt's own series by name, or every
             series. */
          if (manySeries) {
            const myG = me && Array.isArray(bk.groups) ? bk.groups.find((g) => g.id === me.g) : null;
            const scope = document.createElement("div");
            scope.className = "sw-scope";
            const lab = document.createElement("span");
            lab.className = "sw-slab";
            lab.textContent = "capsules from";
            scope.appendChild(lab);
            const opt = (label, val, title) => {
              const b = document.createElement("button");
              b.className = "sw-sbtn" + (all === val ? " on" : "");
              b.textContent = label;
              b.title = title;
              b.addEventListener("click", (e) => {
                e.stopPropagation();
                if (all === val) return;
                all = val;
                kinds = sweepable(target.prompt, all, 1);
                listScroll = 0;
                draw();
              });
              scope.appendChild(b);
            };
            opt(myG ? `${myG.no}  ${myG.name}` : "this series", false,
                "Only the capsules of this prompt's own series");
            opt("all series", true, "The capsules of every series in the book");
            shelf.appendChild(scope);
          }

          const kindList = [...kinds.keys()];
          if (!sw.view || !kindList.includes(sw.view)) {
            sw.view = kindList.includes(sweepKinds(sw)[0]) ? sweepKinds(sw)[0] : kindList[0];
          }
          const tabs = document.createElement("div");
          tabs.className = "sw-tabs";
          const actTake = active >= 0 ? takes[active] : null;
          for (const k of kindList) {
            const b = document.createElement("button");
            const inAct = actTake && actTake.caps.some((c) => c.kind === k);
            b.className = "vsl-btn" + (sw.view === k ? " on" : "") + (inAct ? " has" : "");
            b.style.setProperty("--k", LAB_KIND_HUE[k] || LAB_KIND_HUE.other);
            b.textContent = SWEEP_LABEL[k] || k;
            b.addEventListener("click", (e) => {
              e.stopPropagation();
              if (sw.view === k) return;
              sw.view = k;
              listScroll = 0;
              if (target.sweep) writeStore();
              draw();
            });
            tabs.appendChild(b);
          }
          shelf.appendChild(tabs);

          if (actTake) {
            const hint = document.createElement("div");
            hint.className = "sw-hint";
            hint.textContent = "Adding to take " + (active + 1)
              + " - a capsule clicked goes into it, in place of one of its kind. ";
            const stop = document.createElement("button");
            stop.className = "sw-sbtn";
            stop.textContent = "done";
            stop.addEventListener("click", (e) => { e.stopPropagation(); active = -1; draw(); });
            hint.appendChild(stop);
            shelf.appendChild(hint);
          }

          const live = kinds.get(sw.view) || [];
          if (!kindList.length) {
            const lab = document.createElement("label");
            lab.textContent = "This book has no capsules to sweep yet.";
            shelf.appendChild(lab);
          }
          const list = document.createElement("div");
          list.className = "vsl-pick sw-list";
          for (const c of live) {
            /* which takes hold it: a single take is a tick, a combination a
               number */
            const holds = [];
            takes.forEach((t, ti) => { if (t.caps.some((x) => x.id === c.id)) holds.push(ti); });
            const solo = takes.findIndex((t) => t.caps.length === 1 && t.caps[0].id === c.id);
            const inAct = actTake ? actTake.caps.some((x) => x.id === c.id) : false;
            const on = actTake ? inAct : solo >= 0;
            const row = document.createElement("label");
            row.className = "sw-row" + (on ? " on" : "") + (actTake ? " into" : "");
            row.innerHTML = `<input type="checkbox"${on ? " checked" : ""}>`
              + `<span class="txt"><b></b><i></i></span>`;
            const bEl = row.querySelector("b");
            bEl.textContent = c.name;
            if (c.no) { const n = document.createElement("em"); n.className = "sw-no"; n.textContent = c.no; bEl.prepend(n); }
            const tag = seriesTag(c.series);
            if (tag) bEl.prepend(tag);
            if (holds.length) {
              const h = document.createElement("span");
              h.className = "sw-in";
              h.textContent = holds.map((i) => i + 1).join(" ");
              h.title = "in take " + holds.map((i) => i + 1).join(", ");
              row.appendChild(h);
            }
            row.querySelector("i").textContent = c.text.replace(/\s+/g, " ").slice(0, 120);
            row.title = c.text;
            row.querySelector("input").addEventListener("change", (e) => {
              e.stopPropagation();
              const mine = { kind: c.kind, id: c.id, name: c.name };
              if (actTake) {
                if (inAct) {
                  actTake.caps = actTake.caps.filter((x) => x.id !== c.id);
                  if (!actTake.caps.length) { takes.splice(active, 1); active = -1; }
                } else {
                  actTake.caps = actTake.caps.filter((x) => x.kind !== c.kind).concat([mine]);
                }
              } else if (solo >= 0) {
                takes.splice(solo, 1);
              } else {
                takes.push({ caps: [mine] });
              }
              save();
            });
            list.appendChild(row);
          }
          shelf.appendChild(list);
          box.appendChild(shelf);
          list.scrollTop = listScroll;

          const bar = document.createElement("div");
          bar.className = "rowb";
          if (live.length && !actTake) {
            const allB = document.createElement("button");
            allB.className = "vsl-btn";
            allB.textContent = "All";
            allB.title = "every capsule of this kind as a take of its own";
            allB.addEventListener("click", (e) => {
              e.stopPropagation();
              for (const c of live) {
                if (!takes.some((t) => t.caps.length === 1 && t.caps[0].id === c.id)) {
                  takes.push({ caps: [{ kind: c.kind, id: c.id, name: c.name }] });
                }
              }
              save();
            });
            bar.appendChild(allB);
          }
          if (takes.length) {
            const clr = document.createElement("button");
            clr.className = "vsl-btn";
            clr.textContent = "Clear";
            clr.title = "remove every take";
            clr.addEventListener("click", (e) => {
              e.stopPropagation();
              sw.takes = []; active = -1;
              save();
            });
            bar.appendChild(clr);
          }
          const done = document.createElement("button");
          done.className = "vsl-btn";
          done.textContent = "Done";
          done.addEventListener("click", (e) => { e.stopPropagation(); closeEditor(); });
          bar.appendChild(done);
          box.appendChild(bar);
        };
        draw();
        editor = box;
        placeNear(box, anchor);
        dismissOnOutside(box);
      }

      function promptSlots() {
        const out = [];
        for (let i = 1; i <= MAX_PROMPTS; i++) {
          const inp = (node.inputs || []).find((x) => x.name === "prompt" + i);
          if (inp && inp.link !== null && inp.link !== undefined) out.push(i);
        }
        const b = seriesBook();
        if (b && Array.isArray(b.prompts)) {
          for (const p of bookOrder(b)) out.push(BOOK_BASE + p.id);
        }
        return out;
      }

      function syncPromptInputs() {
        /* A node from before the shelf carries a plain "prompt" socket. It
           has no chip and no way to be picked, so it only confuses - take it
           off and let prompt1 do the job. */
        const stale = (node.inputs || []).findIndex((x) => x.name === "prompt");
        if (stale >= 0) node.removeInput(stale);
        /* A workflow saved before the Series Book carries its own list of
           sockets, which wins over the node's definition when it loads - so
           the series socket is added here rather than trusted to appear. */
        let seriesAdded = false;
        if (!(node.inputs || []).some((x) => x.name === "series")) {
          node.addInput("series", "LEIEL_SERIES");
          seriesAdded = true;
        }

        const has = (i) => (node.inputs || [])
          .some((x) => x.name === "prompt" + i);
        const linked = (i) => {
          const inp = (node.inputs || []).find((x) => x.name === "prompt" + i);
          return !!(inp && inp.link !== null && inp.link !== undefined);
        };
        /* one past the last one in use, and never fewer than one */
        let want = 1;
        for (let i = 1; i <= MAX_PROMPTS; i++) if (linked(i)) want = i + 1;
        want = Math.min(MAX_PROMPTS, want);

        let changed = seriesAdded;
        for (let i = 1; i <= want; i++) {
          if (!has(i)) {
            node.addInput("prompt" + i, "STRING");
            changed = true;
          }
        }
        /* spare empty ones at the end go away again */
        for (let i = MAX_PROMPTS; i > want; i--) {
          const at = (node.inputs || []).findIndex((x) => x.name === "prompt" + i);
          if (at >= 0 && !linked(i)) {
            node.removeInput(at);
            changed = true;
          }
        }
        if (changed) node.setDirtyCanvas(true, true);
        return changed;
      }

      trimStaleOutputs();
      syncPromptInputs();

      const prevConn = node.onConnectionsChange;
      node.onConnectionsChange = function (...args) {
        const r = prevConn ? prevConn.apply(this, args) : undefined;
        /* A wire landing on the last empty socket is what makes the next one
           appear, and the shelf has to show the new prompt straight away. */
        try {
          /* A frontend that connected one of the sealed sockets without
             asking gets the wire taken back off, so the queue is never
             overwritten by something dropped on the body. */
          dropSealedSockets();
          syncPromptInputs();
          paint();
        } catch (e) { /* ignore */ }
        return r;
      };

      readStore();

      /* onNodeCreated runs before saved widget values are put back, so the
         queue has to be picked up again once the graph has been configured. */
      function warmQueueTriggers() {
        for (const row of state.queue) warmTriggers(rowLoras(row));
      }

      const prevConfigure = node.onConfigure;
      node.onConfigure = function () {
        if (prevConfigure) prevConfigure.apply(this, arguments);
        try {
          trimStaleOutputs();
          /* the frontend rebuilds widget sockets while restoring a workflow */
          dropSealedSockets();
          setTimeout(dropSealedSockets, 0);
          readStore();
          applyShelf();
          warmQueueTriggers();
          try { paintOptView(); } catch (e) { /* not built yet */ }
          paint();
        } catch (e) { /* ignore */ }
      };

      const root = document.createElement("div");
      root.className = "vsl-root";
      wearTone(root);
      root.innerHTML = `
        <div class="vsl-col vsl-left">
          <div class="vsl-zone promptzone">
            <h4>Prompt Shelf
              <span class="hint">click one to put it in the recipe</span></h4>
            <div class="vsl-chips prompts"></div>
          </div>
          <div class="vsl-zone">
            <h4>LoRAs Shelf <span class="hint">click to put in the recipe · drag into a group</span></h4>
            <div class="vsl-chips pool vsl-scroll"></div>
            <div class="vsl-bar2">
              <button class="vsl-btn wide poolclear">CLEAR ALL</button>
              <button class="vsl-btn wide poolgroup" title="Add a group to sort the LoRAs into - drag a LoRA onto a group to put it there, back onto the shelf to take it out">+ GROUP</button>
              <button class="vsl-btn wide big browse">BROWSE</button>
            </div>
          </div>
          <div class="vsl-zone">
            <h4>Trigger words
              <span class="sp" style="flex:1"></span>
              <button class="vsl-btn tpos">prepend</button></h4>
            <div class="trighint"></div>
            <div class="vsl-chips trig vsl-scroll"></div>
            <div class="vsl-trigv"><span class="tvl" title="Words that change from recipe to recipe. Each recipe in the queue shows them on its header and turns them on or off for itself. Right click a word, or drag it, to move it between the rows"><b>each recipe</b><i>on / off per queue</i></span><div class="vsl-chips trigvar"></div></div>
          </div>
          <div class="vsl-zone">
            <h4>Options Shelf
              <input class="optq" placeholder="Search...">
              <button class="vsl-btn refresh">Refresh</button>
              <button class="vsl-btn optview" title="How the options are laid out">flat</button></h4>
            <div class="vsl-chips opts"></div>
          </div>
          <div class="vsl-zone flexi">
            <h4>Recipe <span class="sp"></span></h4>
            <div class="vsl-chips draft"></div>
            <div class="vsl-bar2">
              <button class="vsl-btn wide drop">CLEAR</button>
              <button class="vsl-btn wide big addq add">+ ADD TO QUEUE</button>
            </div>
          </div>
        </div>
        <div class="vsl-split"></div>
        <div class="vsl-col vsl-right">
          <div class="vsl-zone">
            <h4>Queue <span class="sp"></span>
              <button class="vsl-btn qexp">Export</button>
              <button class="vsl-btn qimp">Import</button>
              <input type="file" class="qfi" accept="application/json,.json"
                     style="display:none">
              <button class="vsl-btn warn wipe">Clear all</button></h4>
            <div class="vsl-stack queue">
              <div class="vsl-sub">BENCH
                <span class="hint">made, waiting - drag one down to run it</span>
                <span class="sp" style="flex:1"></span>
                <span class="benchct"></span>
                <button class="vsl-foldall" data-fold="bench" title="Fold every recipe on the bench to its title row - or open them all">Fold all</button></div>
              <div class="vsl-list bench"></div>
              <div class="vsl-sub box">        QUEUE BOX
                <span class="hint">only what is in here renders</span>
                <span class="sp" style="flex:1"></span>
                <span class="boxct"></span>
                <button class="vsl-foldall" data-fold="box" title="Fold every recipe in the queue box to its title row - or open them all">Fold all</button></div>
              <div class="vsl-list box"></div>
            </div>
          </div>
          <div class="vsl-zone pinned">
            <h4>Queue info</h4>
            <div class="vsl-info counts info"></div>
            <div class="vsl-track"><div class="vsl-fill"></div></div>
            <div class="vsl-bar2">
              <button class="vsl-btn wide reset" title="back to the first render, widgets put back">RESET</button>
              <button class="vsl-btn wide big run runall">RUN ALL</button>
            </div>
            <div class="vsl-tip tip" hidden></div>
          </div>
          <div class="vsl-zone">
            <h4>Now rendering</h4>
            <div class="vsl-heroes heroes"></div>
            <div class="vsl-chips nowchips"></div>
            <h4 style="margin-top:2px">Status</h4>
            <div class="vsl-note note"></div>
            <div class="vsl-warn warn"></div>
          </div>
          <div class="vsl-zone">
            <h4>File name</h4>
            <div class="vsl-fname fname"></div>
          </div>
          <div class="vsl-rest"></div>
          <div class="vsl-topbar">
            <span class="vsl-brand">Visual Series Lab</span>
            <span class="sp" style="flex:1"></span>
            <button class="vsl-btn help" title="How this node works">?</button>
          </div>
        </div>`;

      const $ = (s) => root.querySelector(s);
      const elPool = $(".pool"), elOpts = $(".opts"), elDraft = $(".draft");
      const elInfo = $(".info");
      const elFill = $(".vsl-fill");
      const elHeroes = $(".heroes"), elNowChips = $(".nowchips");
      const elNote = $(".note");
      const elTip = $(".tip");
      const elPrompts = $(".prompts");
      const elBench = $(".bench"), elBox = $(".box.vsl-list") || $(".vsl-list.box");
      const elBenchCt = $(".benchct"), elBoxCt = $(".boxct");
      for (const b of root.querySelectorAll(".vsl-foldall")) {
        b.addEventListener("pointerdown", (e) => e.stopPropagation());
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          const rows = (state.queue || []).filter((r) => (b.dataset.fold === "box") === isStaged(r));
          const shut = !rows.every((r) => r.shut);
          for (const r of rows) r.shut = shut;
          writeStore();
          paint();
        });
      }
      const elWarn = $(".warn");
      const elFname = $(".fname");
      const elOptQ = $(".optq"), elOptView = $(".optview");
      const elTrig = $(".trig"), elTPos = $(".tpos"), elTVar = $(".trigvar");
      const elTHint = $(".trighint");
      /* a trigger word being dragged between the two rows */
      let dragTrig = null;
      const trigZones = () => [elTrig, elTVar && elTVar.parentElement].filter(Boolean);
      for (const z of trigZones()) {
        const toVar = z !== elTrig;
        z.addEventListener("dragover", (e) => {
          if (!dragTrig) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          z.classList.toggle("over", isVar(dragTrig) !== toVar);
        });
        z.addEventListener("dragleave", (e) => {
          if (!z.contains(e.relatedTarget)) z.classList.remove("over");
        });
        z.addEventListener("drop", (e) => {
          if (!dragTrig) return;
          e.preventDefault();
          e.stopPropagation();
          const k = dragTrig;
          dragTrig = null;
          for (const y of trigZones()) y.classList.remove("over");
          if (isVar(k) !== toVar) moveWord(k);
        });
      }
      const elRunAll = $(".runall");
      /* A triangle to start, two bars to hold - the same pair ComfyUI uses on
         its own queue button, so the gesture is already known. currentColor
         so they follow the button through its running and paused states. */
      const ICON_PLAY =
        '<svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">' +
        '<path d="M3 1.6 L10 6 L3 10.4 Z"/></svg>';
      const ICON_PAUSE =
        '<svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">' +
        '<rect x="2.5" y="1.8" width="2.8" height="8.4" rx="0.7"/>' +
        '<rect x="6.7" y="1.8" width="2.8" height="8.4" rx="0.7"/></svg>';

      /* ---- the LoRA files there are ----
         Kept from the list the server gives, so a recipe naming a LoRA whose
         file is not in the loras folder is marked before it is run. Matched
         the way the server finds a file: the path as given, or the file name
         alone. Until the list has come, every LoRA counts as there. */
      const normLora = (n) => String(n || "").replace(/\\/g, "/").trim().toLowerCase();
      function rememberFiles(list) {
        const full = new Set(), bare = new Set();
        for (const it of list || []) {
          if (!it || !it.full_name) continue;
          full.add(normLora(it.full_name));
          bare.add(shortName(it.full_name).toLowerCase());
        }
        state.loraFiles = { full, bare };
      }
      function loraFileThere(name) {
        const f = state.loraFiles;
        if (!f) return true;
        const n = normLora(name);
        return f.full.has(n) || f.full.has(n + ".safetensors") || f.bare.has(shortName(name).toLowerCase());
      }
      function missingFiles(rows) {
        const out = [];
        for (const r of rows || []) {
          for (const l of rowLoras(r)) {
            if (!loraFileThere(l.name) && !out.includes(shortName(l.name))) out.push(shortName(l.name));
          }
        }
        return out;
      }

      /* ---- thumbnails ---- */
      const loadThumbs = async () => {
        /* api.fetchApi puts /api in front, and the route is registered
           without it, so try the bare path first. A failure is reported on
           the node - an empty strip gives no clue what went wrong. */
        const tries = [
          () => fetch("/visual_series_lab/loras"),
          () => api.fetchApi("/visual_series_lab/loras"),
        ];
        let last = "";
        for (const attempt of tries) {
          try {
            const r = await attempt();
            if (!r || !r.ok) { last = "HTTP " + (r && r.status); continue; }
            const list = await r.json();
            if (!Array.isArray(list)) { last = "unexpected reply"; continue; }
            rememberFiles(list);
            let hits = 0;
            for (const it of list) {
              if (it.thumbnail) {
                /* The loader hands over bare names like "canon1D" while
                   the file on disk is "krea2/film/canon1D.safetensors", so
                   index both ways or the lookup can never match. The full
                   path is exact and always wins; the bare name is a fallback
                   and the first one registered keeps it, so two LoRAs of the
                   same name in different folders cannot swap pictures. */
                state.thumbs[it.full_name] = it.thumbnail;
                const bare = shortName(it.full_name);
                if (!(bare in state.thumbs)) state.thumbs[bare] = it.thumbnail;
                hits++;
              }
            }
            state.note = hits ? ""
              : `no preview image found beside any of ${list.length} LoRA files`;
            paint();
            return;
          } catch (e) { last = String(e && e.message ? e.message : e); }
        }
        state.note = "thumbnails unavailable: " + (last || "no route");
        paint();
      };

      /* A picture on hover, after a short pause. Long enough not to flash
         while the pointer crosses the row, short enough to feel immediate. */
      let hoverTimer = null, hoverBox = null, hoverLeave = null;

      function hideHover() {
        if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
        if (hoverLeave) { clearTimeout(hoverLeave); hoverLeave = null; }
        if (hoverBox) { hoverBox.remove(); hoverBox = null; }
      }
      /* The model page's sample pictures, asked for once per LoRA. */
      const exampleCache = new Map();
      function examplesOf(loraName) {
        if (!exampleCache.has(loraName)) {
          exampleCache.set(loraName, fetch("/visual_series_lab/examples?lora=" +
            encodeURIComponent(loraName))
            .then(r => r.ok ? r.json() : { images: [] })
            .then(j => Array.isArray(j.images) ? j.images : [])
            .catch(() => []));
        }
        return exampleCache.get(loraName);
      }
      /* The card stays while the pointer is on the chip or on the card, so
         the strip of sample pictures under the preview can be reached:
         pointing at one shows it large. */
      function placeHover(box, el) {
        const r = el.getBoundingClientRect();
        const b = box.getBoundingClientRect();
        box.style.left = Math.max(8, Math.min(r.left,
          window.innerWidth - b.width - 8)) + "px";
        box.style.top = (r.top - b.height - 6 > 8)
          ? (r.top - b.height - 6) + "px"
          : Math.min(r.bottom + 6, window.innerHeight - b.height - 8) + "px";
      }
      /* Click the large picture: it opens over the whole window. Arrows or
         the wheel go through the others; a click or Esc closes it. */
      let exOpen = false, exAway = null;
      function openExampleView(list, at) {
        /* the "click elsewhere closes the card" watch from an earlier visit
           would catch the click that closes this view - it goes for now */
        if (exAway) { document.removeEventListener("pointerdown", exAway, true); exAway = null; }
        if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
        if (hoverLeave) { clearTimeout(hoverLeave); hoverLeave = null; }
        exOpen = true;
        let i = at;
        const ov = document.createElement("div");
        ov.className = "vsl-exv";
        ov.innerHTML = `<div class="fr"><img alt=""><button class="ar l" title="previous">&#8249;</button>`
          + `<button class="ar r" title="next">&#8250;</button></div><div class="nv"></div>`;
        const img = ov.querySelector("img"), nv = ov.querySelector(".nv");
        const show = () => {
          img.src = list[i];
          nv.textContent = `${i + 1} / ${list.length}   -   arrows, wheel or the buttons: next, click or Esc: back`;
        };
        const step = (d) => { i = (i + d + list.length) % list.length; show(); };
        /* Closing goes back to the card it came from, which stays open until
           the pointer leaves it or a click lands elsewhere. */
        const close = () => {
          ov.remove();
          document.removeEventListener("keydown", key, true);
          exOpen = false;
          const card = hoverBox;
          if (!card) return;
          const away = (e) => {
            if (exOpen || card.contains(e.target) || e.target.closest?.(".vsl-exv")) return;
            document.removeEventListener("pointerdown", away, true);
            if (exAway === away) exAway = null;
            if (hoverBox === card) hideHover();
          };
          setTimeout(() => {
            if (exOpen || hoverBox !== card) return;
            exAway = away;
            document.addEventListener("pointerdown", away, true);
          }, 0);
        };
        const key = (e) => {
          if (e.key === "Escape") { e.stopPropagation(); close(); }
          else if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); e.stopPropagation(); step(1); }
          else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); e.stopPropagation(); step(-1); }
        };
        ov.querySelector(".ar.l").addEventListener("click", (e) => { e.stopPropagation(); step(-1); });
        ov.querySelector(".ar.r").addEventListener("click", (e) => { e.stopPropagation(); step(1); });
        ov.addEventListener("click", close);
        ov.addEventListener("wheel", (e) => { e.preventDefault(); e.stopPropagation(); step(e.deltaY > 0 ? 1 : -1); }, { passive: false });
        ov.addEventListener("pointerdown", (e) => e.stopPropagation());
        document.addEventListener("keydown", key, true);
        document.body.appendChild(ov);
        show();
      }
      function attachHoverPreview(el, loraName) {
        el.dataset.notip = "1";
        const leaveSoon = () => {
          if (exOpen) return;            // the full view is over it
          if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
          if (hoverLeave) clearTimeout(hoverLeave);
          hoverLeave = setTimeout(() => { hoverLeave = null; if (!exOpen) hideHover(); }, 220);
        };
        /* the x that deletes the chip is left alone: pointing at it never
           opens the pictures, and moving onto it puts them away */
        let onX = false;
        el.addEventListener("pointerover", (e) => {
          const x = e.target && e.target.closest ? e.target.closest(".x") : null;
          if (x && el.contains(x)) {
            onX = true;
            if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
            if (hoverLeave) { clearTimeout(hoverLeave); hoverLeave = null; }
            if (!exOpen) hideHover();
          } else if (onX) {
            onX = false;
            el.dispatchEvent(new PointerEvent("pointerenter"));
          }
        });
        el.addEventListener("pointerenter", () => {
          hideHover();
          if (onX) return;
          hoverTimer = setTimeout(async () => {
            hoverTimer = null;
            if (onX) return;
            const src = state.thumbs[loraName] ||
                        state.thumbs[shortName(loraName)];
            const box = document.createElement("div");
            box.className = "vsl-hover";
            box.innerHTML = (src ? `<img class="big" src="${src}">` : "")
              + `<div>${String(shortName(loraName)).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c])}</div>`;
            box.addEventListener("pointerenter", () => {
              if (hoverLeave) { clearTimeout(hoverLeave); hoverLeave = null; }
            });
            box.addEventListener("pointerleave", leaveSoon);
            box.addEventListener("pointerdown", (e) => e.stopPropagation());
            box.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });
            if (src) {
              document.body.appendChild(box);
              placeHover(box, el);
              hoverBox = box;
            }
            const pics = await examplesOf(loraName);
            if (!pics.length) return;
            /* moved on, or the card was closed, while the list was coming */
            if (hoverBox && hoverBox !== box) return;
            if (src ? !box.isConnected : !el.matches(":hover")) return;
            box.classList.add("ex");
            let big = box.querySelector("img.big");
            if (!big) {
              big = document.createElement("img");
              big.className = "big";
              big.src = pics[0];
              box.insertBefore(big, box.firstChild);
            }
            const strip = document.createElement("div");
            strip.className = "exs";
            const all = src ? [src].concat(pics) : pics;
            big.addEventListener("click", (e) => {
              e.stopPropagation();
              openExampleView(all, Math.max(0, all.indexOf(big.getAttribute("src"))));
            });
            all.forEach((u, i) => {
              const t = document.createElement("img");
              t.loading = "lazy";
              t.src = u;
              if (i === 0) t.classList.add("on");
              t.addEventListener("pointerenter", () => {
                big.src = u;
                strip.querySelectorAll("img").forEach(x => x.classList.toggle("on", x === t));
              });
              t.addEventListener("click", (e) => {
                e.stopPropagation();
                openExampleView(all, Math.max(0, all.indexOf(u)));
              });
              t.addEventListener("error", () => t.remove());
              strip.appendChild(t);
            });
            box.appendChild(strip);
            const n = document.createElement("div");
            n.className = "exn";
            n.textContent = `${pics.length} sample picture${pics.length === 1 ? "" : "s"} - point to see it here, click for full screen`;
            box.appendChild(n);
            if (!box.isConnected) document.body.appendChild(box);
            hoverBox = box;
            placeHover(box, el);
          }, 500);
        });
        el.addEventListener("pointerleave", leaveSoon);
        el.addEventListener("pointerdown", hideHover);
      }

      /* ---- tooltips ----
         Every title in the Lab is shown as a card, the way the Series Book
         shows its own: what the thing is on top, then each action - click,
         right click, drag... - on its own row under a gold label. Chips that
         open a picture card on hover keep that card instead. */
      const TIP_ACT = "Ctrl\\+Shift\\+click|Shift\\+click|Ctrl\\+click|Alt\\+click|Double click|Right click|Click|Drag|Drop|Enter|Esc";
      const TIP_SPLIT = new RegExp(`(?:\\n|\\s-\\s|(?<=\\.)\\s+|;\\s*|,\\s+(?=(?:${TIP_ACT})\\b))(?=(?:${TIP_ACT})\\b)`, "i");
      const TIP_HEAD = new RegExp(`^(${TIP_ACT})\\b[:\\s-]*`, "i");
      function labTipParse(text) {
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
      let labTipEl = null, labTipCard = null, labTipT = null;
      function labTipHide() {
        if (labTipT) { clearTimeout(labTipT); labTipT = null; }
        labTipEl = null;
        if (labTipCard) { labTipCard.remove(); labTipCard = null; }
      }
      const tipEsc = (t) => String(t == null ? "" : t).replace(/[&<>"]/g, (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
      function labTipShow(el) {
        const t = labTipParse(el.dataset.tip);
        if (!t.head && !t.body && !t.rows.length) return;
        const card = document.createElement("div");
        card.className = "vsl-tcard";
        card.innerHTML = (t.head ? `<div class="ch"><b>${tipEsc(t.head)}</b></div>` : "")
          + (t.body ? `<div class="en">${tipEsc(t.body)}</div>` : "")
          + (t.rows.length ? `<div class="hint">` + t.rows.map(([k, v]) =>
              `<div class="hr"><b>${tipEsc(k)}</b><span>${tipEsc(v)}</span></div>`).join("") + `</div>` : "");
        document.body.appendChild(card);
        labTipCard = card;
        const r = el.getBoundingClientRect(), b = card.getBoundingClientRect();
        let top = r.bottom + 6;
        if (top + b.height > window.innerHeight - 8) top = Math.max(8, r.top - b.height - 6);
        card.style.left = Math.max(8, Math.min(r.left, window.innerWidth - b.width - 8)) + "px";
        card.style.top = top + "px";
      }
      root.addEventListener("pointerover", (e) => {
        const tg = e.target instanceof Element ? e.target : null;
        let el = tg ? tg.closest("[title], [data-tip]") : null;
        if (el && !root.contains(el)) el = null;
        if (el && el.hasAttribute("title")) {
          const v = el.getAttribute("title");
          el.removeAttribute("title");
          if (v) el.dataset.tip = v;
        }
        if (el && el.dataset.notip) el = null;
        if (el === labTipEl) return;
        labTipHide();
        if (!el || !el.dataset.tip) return;
        labTipEl = el;
        labTipT = setTimeout(() => { labTipT = null; if (labTipEl === el && el.isConnected) labTipShow(el); }, 450);
      });
      root.addEventListener("pointerleave", labTipHide);
      root.addEventListener("pointerdown", labTipHide, true);
      root.addEventListener("wheel", labTipHide, { passive: true });
      root.addEventListener("dragstart", labTipHide, true);

      /* ---- chips ---- */
      function chip(cls, label, value, opts) {
        opts = opts || {};
        const el = document.createElement("span");
        el.className = "vsl-chip " + cls + (opts.muted ? " muted" : "") +
          (opts.live ? " live" : "") + (opts.on ? " picked" : "");
        /* The node a setting came from is context, not the setting's name.
           Written small and dim it still tells two "steps" apart without
           taking half the chip. Inside a pod it is left off entirely - the
           pod's heading already says which node these belong to. */
        if (opts.pno) {
          el.appendChild(opts.pno);
        } else if (opts.prefix) {
          const p = document.createElement("span");
          p.className = "pre";
          /* Cut at 12 characters. The node name is here to tell two settings
             of the same name apart, and the first few letters do that; the
             whole name is on the tooltip. */
          const pre = String(opts.prefix);
          p.textContent = pre.length > 12 ? pre.slice(0, 11) + "\u2026" : pre;
          p.title = pre;
          el.appendChild(p);
        }
        /* A small mark before the name that does something when pressed.
           Only chips in a state worth escaping wear one, so an untouched
           shelf stays quiet. */
        if (opts.badge) {
          const b = document.createElement("span");
          b.className = "badge";
          b.textContent = opts.badge.text;
          if (opts.badge.title) b.title = opts.badge.title;
          if (opts.badge.onClick) {
            b.addEventListener("click", (e) => {
              e.stopPropagation(); opts.badge.onClick(e);
            });
          }
          el.appendChild(b);
        }
        const l = document.createElement("b");
        l.className = "lbl";
        l.textContent = label;
        el.appendChild(l);
        if (value !== undefined && value !== null && value !== "") {
          const v = document.createElement("span");
          v.className = "v";
          v.textContent = value;
          el.appendChild(v);
        }
        if (opts.onRemove) {
          const x = document.createElement("span");
          x.className = "x";
          x.textContent = "x";
          x.addEventListener("click", (e) => {
            e.stopPropagation(); opts.onRemove();
          });
          el.appendChild(x);
        }
        if (opts.onClick) {
          el.addEventListener("click", (e) => {
            e.stopPropagation(); opts.onClick(e);
          });
        }
        if (opts.onContext) {
          el.addEventListener("contextmenu", (e) => {
            e.preventDefault(); e.stopPropagation(); opts.onContext(e);
          });
        }
        if (opts.title) el.title = opts.title;
        if (opts.hover) {
          if (opts.hoverKey != null) el.dataset.swrow = String(opts.hoverKey);
          el.addEventListener("mouseenter", () => opts.hover(el));
          el.addEventListener("mouseleave", sweepCardHide);
          el.addEventListener("pointerdown", sweepCardHide);
        }
        return el;
      }

      /* ---- the little value editor ---- */
      let editor = null;
      function closeEditor() {
        if (editor) { editor.remove(); editor = null; }
      }

      /* Keep a popup on screen. Opened straight under a chip near the bottom
         edge, its buttons ended up below the window with no way to reach them
         - and no way to cancel, since the panel does not scroll with the
         canvas. */
      function placeNear(box, anchor) {
        document.body.appendChild(box);
        const r = anchor.getBoundingClientRect();
        const b = box.getBoundingClientRect();
        const pad = 8;
        let left = r.left;
        if (left + b.width > window.innerWidth - pad) {
          left = window.innerWidth - b.width - pad;
        }
        box.style.left = Math.max(pad, left) + "px";
        let top = r.bottom + 4;
        if (top + b.height > window.innerHeight - pad) {
          top = r.top - b.height - 4;               // above the chip instead
        }
        if (top < pad) {
          /* taller than the window: pin it and let it scroll inside */
          top = pad;
          box.style.maxHeight = (window.innerHeight - pad * 2) + "px";
          box.style.overflowY = "auto";
        }
        box.style.top = top + "px";
      }

      /* Clicking anywhere else puts a popup away, so it can always be
         dismissed even when a button cannot be reached. */
      function dismissOnOutside(box) {
        const away = (e) => {
          if (box.contains(e.target)) return;
          window.removeEventListener("pointerdown", away, true);
          if (editor === box) closeEditor();
        };
        setTimeout(() => window.addEventListener("pointerdown", away, true), 0);
        box.addEventListener("keydown", (e) => {
          if (e.key === "Escape") { e.stopPropagation(); closeEditor(); }
        });
      }
      function openEditor(fields, defaults, choices, values, anchor, onSave,
                          extras) {
        closeEditor();
        const box = document.createElement("div");
        box.className = "vsl-edit";
        const inputs = [];
        for (let i = 0; i < fields.length; i++) {
          const lab = document.createElement("label");
          lab.textContent = fields[i];
          box.appendChild(lab);
          let inp;
          if (choices && i === 0) {
            inp = document.createElement("select");
            const opts = new Set(choices);
            if (values[i] !== undefined) opts.add(String(values[i]));
            for (const c of opts) {
              const o = document.createElement("option");
              o.value = c;
              o.textContent = c;
              inp.appendChild(o);
            }
            inp.value = String(values[i] !== undefined ? values[i] : defaults[i]);
          } else {
            inp = document.createElement("input");
            inp.value = String(values[i] !== undefined ? values[i] : defaults[i]);
            /* An empty field that means something - "follow the name upstream"
               - has to say so, or nobody finds the way back to it. */
            if (extras && extras.placeholder && i === 0) {
              inp.placeholder = String(extras.placeholder);
            }
          }
          box.appendChild(inp);
          inputs.push(inp);
        }
        if (extras && extras.note) {
          const note = document.createElement("div");
          note.className = "vsl-hint";
          note.textContent = extras.note;
          box.appendChild(note);
        }
        const bar = document.createElement("div");
        bar.className = "rowb";
        const cancel = document.createElement("button");
        cancel.className = "vsl-btn";
        cancel.textContent = "Cancel";
        const ok = document.createElement("button");
        ok.className = "vsl-btn go";
        ok.textContent = "OK";
        bar.appendChild(cancel);
        bar.appendChild(ok);
        box.appendChild(bar);

        cancel.addEventListener("click", (e) => {
          e.stopPropagation(); closeEditor();
        });
        ok.addEventListener("click", (e) => {
          e.stopPropagation();
          const out = inputs.map((inp, i) => {
            const raw = String(inp.value).trim();
            if (choices && i === 0) return raw;
            const f = parseFloat(raw);
            return Number.isNaN(f) ? raw : f;
          });
          closeEditor();
          onSave(out);
        });
        for (const inp of inputs) {
          ["keydown", "keyup", "keypress"].forEach((k) =>
            inp.addEventListener(k, (e) => e.stopPropagation()));
          inp.addEventListener("keydown", (e) => {
            if (e.key === "Enter") ok.click();
            if (e.key === "Escape") closeEditor();
          });
        }
        editor = box;
        placeNear(box, anchor);
        dismissOnOutside(box);
        if (inputs[0]) inputs[0].focus();
      }

      /* One chip carries a whole node. There are no output ports to wire any
         more, so there is nothing to gain from splitting a node's settings
         across several chips - and a lot of clutter to lose. */
      /* "Visual Prompt Composer (Studio Leiel)" is most of a chip on its own.
         Trim the bracketed part; the full name is on hover. */
      function shortNodeName(title) {
        return String(title).replace(/\s*\([^)]*\)\s*$/, "").trim() || title;
      }

      const OPT_VIEWS = ["flat", "pods", "lines"];

      function addOneToDraft(o) {
        let entry = state.draft.opts.find((x) => x.key === o.key);
        if (!entry) {
          state.draft.opts.push({
            key: o.key, nodeId: o.nodeId, title: o.title, widget: o.widget,
            kind: o.kind, choices: o.choices, values: [o.value], out: true,
          });
        }
        paint();
      }

      function addGroupToDraft(title, list) {
        state.draft.opts = state.draft.opts.filter((x) => x.title !== title);
        for (const o of list) {
          state.draft.opts.push({
            key: o.key, nodeId: o.nodeId, title: o.title, widget: o.widget,
            kind: o.kind, choices: o.choices, values: [o.value], out: true,
          });
        }
        paint();
      }

      /* Options saved before the full list was kept carry a shortened copy
         of it. When the node is still in the graph, take its list as it is
         now, so every choice the node offers can be picked. */
      function refreshChoices(o) {
        if (o.kind !== "combo") return;
        const w = widgetOf(o.nodeId, o.widget);
        const live = w && w.options && w.options.values;
        if (Array.isArray(live) && live.length) o.choices = live.slice();
      }

      /* Typed numbers are kept as numbers and shown the way the node shows
         them: ".5" is 0.5, and a whole number on a float setting reads "2.0".
         An integer setting stays "30". */
      const NUM_RE = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;
      function asNum(t) {
        return (typeof t === "string" && NUM_RE.test(t.trim()))
          ? Number(t.trim()) : t;
      }
      function isFloatOpt(o) {
        const w = widgetOf(o.nodeId, o.widget);
        const op = w && w.options;
        if (op) {
          if (typeof op.precision === "number") return op.precision > 0;
          if (typeof op.round === "number") return op.round > 0 && op.round < 1;
          if (typeof op.step === "number" && op.step > 0) {
            return !Number.isInteger(op.step / 10);
          }
        }
        const seen = [o.value, ...(o.values || [])].map(asNum);
        return seen.some((v) => typeof v === "number" && !Number.isInteger(v));
      }
      /* The node's own limits. A strength of 100 on a setting that stops at
         2 is taken as 2, the same as the node's own field would. */
      function optRange(nodeId, widget) {
        const w = widgetOf(nodeId, widget);
        const op = w && w.options;
        if (!op || typeof w.value !== "number") return null;
        const min = typeof op.min === "number" ? op.min : -Infinity;
        const max = typeof op.max === "number" ? op.max : Infinity;
        return (min === -Infinity && max === Infinity) ? null : { min, max };
      }
      function clampOpt(nodeId, widget, v) {
        const w = widgetOf(nodeId, widget);
        if (w && typeof w.value !== "number") return v;   /* text stays text */
        const n = asNum(v);
        if (typeof n !== "number" || Number.isNaN(n)) return v;
        const r = optRange(nodeId, widget);
        return r ? Math.min(r.max, Math.max(r.min, n)) : n;
      }
      function fmtOptVal(o, v, float) {
        const n = asNum(v);
        if (typeof n !== "number" || Number.isNaN(n)) return String(v);
        return (float && Number.isInteger(n)) ? n.toFixed(1) : String(n);
      }
      function fmtOptVals(o, sep) {
        const float = o.kind === "number" && isFloatOpt(o);
        return o.values.map((v) =>
          fmtOptVal(o, clampOpt(o.nodeId, o.widget, v), float)).join(sep);
      }

      /* Every setting of that node at once. A comma separated list sweeps
         that setting: "euler, dpmpp_sde" renders both. */
      function openGroupEditor(title, list, anchor, onSaved) {
        closeEditor();
        const box = document.createElement("div");
        box.className = "vsl-edit";
        box.style.maxHeight = "560px";
        box.style.overflowY = "auto";
        box.style.minWidth = "300px";
        const head = document.createElement("div");
        head.className = "eh";
        head.textContent = title;
        box.appendChild(head);
        const sub = document.createElement("label");
        sub.textContent = "comma separated sweeps a setting";
        box.appendChild(sub);
        const rows = [];
        for (const o of list) {
          refreshChoices(o);
          const lab = document.createElement("label");
          const rng = optRange(o.nodeId, o.widget);
          const fl = o.kind === "number" && isFloatOpt(o);
          const end = (x) => Number.isFinite(x) ? fmtOptVal(o, x, fl) : "";
          lab.textContent = o.widget +
            (o.choices ? "   (pick one or several)"
              : rng ? "   (" + end(rng.min) + " - " + end(rng.max) + ")" : "");
          box.appendChild(lab);
          let inp;
          if (o.kind === "bool") {
            /* the original node offers a switch, so offer a switch */
            inp = document.createElement("select");
            for (const c of ["true", "false"]) {
              const op = document.createElement("option");
              op.value = c;
              op.textContent = c;
              if (String(o.values[0]) === c) op.selected = true;
              inp.appendChild(op);
            }
          } else if (o.choices && o.choices.length) {
            /* the same list the original node offers, so nothing has to be
               typed from memory - and several picks sweep them all */
            inp = document.createElement("select");
            inp.multiple = true;
            inp.size = Math.min(10, Math.max(4, o.choices.length));
            const chosen = new Set(o.values.map((v) => String(v)));
            for (const c of o.choices) {
              const op = document.createElement("option");
              op.value = String(c);
              op.textContent = String(c);
              if (chosen.has(String(c))) op.selected = true;
              inp.appendChild(op);
            }
            for (const v of chosen) {
              if (!o.choices.some((c) => String(c) === v)) {
                const op = document.createElement("option");
                op.value = v;
                op.textContent = v + "  (not in the list)";
                op.selected = true;
                inp.appendChild(op);
              }
            }
          } else {
            inp = document.createElement("input");
            inp.value = fmtOptVals(o, ", ");
          }
          box.appendChild(inp);
          rows.push([o, inp]);
          ["keydown", "keyup", "keypress"].forEach((k) =>
            inp.addEventListener(k, (e) => e.stopPropagation()));
          /* typing a value and pressing enter should accept it, the same as
             it does in the single-value editor */
          inp.addEventListener("keydown", (e) => {
            if (e.key === "Enter") { e.preventDefault(); ok.click(); }
            if (e.key === "Escape") { e.preventDefault(); closeEditor(); }
          });
        }
        const bar = document.createElement("div");
        bar.className = "rowb";
        const cancel = document.createElement("button");
        cancel.className = "vsl-btn";
        cancel.textContent = "Cancel";
        const ok = document.createElement("button");
        ok.className = "vsl-btn go";
        ok.textContent = "OK";
        bar.appendChild(cancel);
        bar.appendChild(ok);
        box.appendChild(bar);
        cancel.addEventListener("click", (e) => {
          e.stopPropagation(); closeEditor();
        });
        ok.addEventListener("click", (e) => {
          e.stopPropagation();
          for (const [o, inp] of rows) {
            const parts = inp.tagName === "SELECT"
              ? Array.from(inp.selectedOptions).map((op) =>
                  op.value === "true" ? true
                    : op.value === "false" ? false : op.value)
              : String(inp.value).split(",")
                  .map((t) => t.trim()).filter((t) => t !== "");
            o.values = parts.length
              ? parts.map((t) => clampOpt(o.nodeId, o.widget, t)) : [""];
          }
          closeEditor();
          if (onSaved) onSaved();
          paint();
        });
        editor = box;
        placeNear(box, anchor);
        dismissOnOutside(box);
        if (rows[0]) rows[0][1].focus();
      }

      /* ---- building a recipe ---- */
      function addLoraToDraft(l) {
        if (state.draft.loras.some((x) => x.name === l.name)) return;
        state.draft.loras.push({ name: l.name, strength: l.strength });
        paint();
      }
      function importQueue(text) {
        let doc;
        try { doc = JSON.parse(text); } catch (e) { return null; }
        const rows = Array.isArray(doc) ? doc : (doc && doc.queue);
        if (!Array.isArray(rows)) return null;
        let added = 0;
        for (const row of rows) {
          if (!row || typeof row !== "object") continue;
          state.queue.push({
            id: "r" + Date.now().toString(36) + added,
            no: nextNumber(),
            loras: Array.isArray(row.loras) ? row.loras : [],
            opts: Array.isArray(row.opts) ? row.opts : [],
            repeat: Math.max(1, Number(row.repeat) || 1),
            staged: row.staged === true,
          });
          added++;
        }
        return added;
      }

      /* A picture sent back from the Image Viewer ("→ Lab"): the recipe that
         made it, read from its PNG, becomes a new recipe on the bench - the
         same prompt, LoRAs and strengths, option chips and swapped capsules.
         The prompt is the scene as the Book holds it now, so a scene whose
         words were rewritten renders the new words with the old settings. */
      function takeFromViewer(detail) {
        const wired = promptSlots();
        const opts = scanWorkflowOptions(node);
        const book = seriesBook();
        let lostPrompt = 0, lostOpts = 0;
        /* a LoRA is matched to the shelf by its name, and failing that by its
           file name alone - the same file kept in another folder, or named
           with or without its extension - so the recipe uses the shelf's own
           entry. One the shelf does not have at all stays as it came. */
        const bare = (n) => shortName(n).toLowerCase();
        const offShelf = new Set();
        const toShelf = (name) => {
          const shelf = state.loras || [];
          const hit = shelf.find((x) => x.name === name) || shelf.find((x) => bare(x.name) === bare(name));
          if (!hit) offShelf.add(shortName(name));
          return hit ? hit.name : name;
        };
        for (const r of detail.recipes || []) {
          /* the prompt: by its slot, and failing that by its name */
          let pn = Number(r.prompt_slot) || 0;
          if (pn >= BOOK_BASE && !bookPrompt(pn)) {
            const named = book && Array.isArray(book.prompts)
              ? book.prompts.find((q) => q.name === r.prompt_name) : null;
            pn = named ? BOOK_BASE + named.id : 0;
          }
          if (!pn || !wired.includes(pn)) { lostPrompt += 1; continue; }
          const row = {
            id: "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
            no: nextNumber(),
            loras: (r.loras || []).filter((l) => l && l.name)
              .map((l) => ({ name: toShelf(l.name), strength: Number(l.strength) })),
            opts: [],
            repeat: Math.max(1, state.draft.repeat || 1),
            prompt: pn,
            sweep: null,
            staged: false,
          };
          for (const c of r.chips || []) {
            const o = opts.find((x) => x.key === c.key);
            if (!o) { lostOpts += 1; continue; }
            if (row.opts.some((x) => x.key === o.key)) continue;
            let v = c.value;
            if (o.kind === "bool") v = String(v).toLowerCase() === "true";
            else if (o.kind === "number") v = clampOpt(o.nodeId, o.widget, v);
            row.opts.push({ key: o.key, nodeId: o.nodeId, title: o.title, widget: o.widget,
                            kind: o.kind, choices: o.choices, values: [v], out: true });
          }
          const sw = r.swap && Array.isArray(r.swap.caps) ? r.swap.caps : [];
          if (sw.length) {
            row.sweep = { view: sw[0].kind, takes: [{ caps: sw.map((c) =>
              ({ kind: c.kind, id: c.cap, name: c.name })) }] };
          }
          /* the per-recipe words, on or off as the picture had them */
          const used = new Set((r.triggers || []).map((w) => String(w).toLowerCase()));
          row.trig = {};
          for (const k of Object.keys(state.trigVar || {})) row.trig[k] = used.has(k);
          if (!row.loras.length && !row.opts.length && !row.sweep) { lostPrompt += 1; continue; }
          warmTriggers(row.loras);
          state.queue.push(row);
          detail.added += 1;
        }
        if (lostPrompt) detail.notes.push(`${lostPrompt} left out: its prompt is not in this Lab's Book or shelf`);
        if (offShelf.size) detail.notes.push(`not on the LoRA shelf: ${[...offShelf].join(", ")} - marked red; it renders if its file is in the loras folder, or click it to swap`);
        if (lostOpts) detail.notes.push(`${lostOpts} ${lostOpts === 1 ? "setting" : "settings"} left out: the node is no longer in this workflow`);
        state.live.status = `${detail.added} from the Image Viewer`;
        writeStore();
        paint();
      }
      node._vslTakeFromViewer = (d) => { takeFromViewer(d); loadThumbs(); };

      /* Fetch the words for a recipe as it is queued. Collecting them at
         render time is too late: that runs synchronously, and a LoRA nobody
         had hovered over yet would simply contribute nothing. */
      function warmTriggers(loras) {
        for (const l of loras || []) loadTriggers(l.name);
      }

      function addToQueue() {
        const d = state.draft;
        /* a capsule sweep is a recipe in its own right - the prompt changes */
        if (!d.loras.length && !d.opts.length && !d.sweep) return;
        /* A recipe has to say which prompt it is for - but only once there is
           a choice to make. With nothing wired to the prompt shelf the node
           works exactly as it always did, on the plain prompt input. */
        /* Most people wire one prompt and never think about the shelf again.
           Making them click a chip to say "yes, that one" is a question with
           only one possible answer, so the first wired prompt is taken as the
           default and the recipe just goes through. */
        const wired = promptSlots();
        if (!wired.length) {
          /* Nothing wired anywhere. There is no text to render, and a plain
             workflow with an empty prompt would not run either. */
          state.warn = "Connect a text node to prompt1 first - a recipe has " +
            "nothing to render without one.";
          paint();
          return;
        }
        if (Number(d.prompt) > 0 && !wired.includes(Number(d.prompt))) {
          /* A prompt was chosen and its wire has since gone. Quietly moving
             the recipe onto a different prompt would be answering a question
             that was already answered, differently - so it is refused and the
             red chip in the recipe says which one to fix. */
          state.warn = "The prompt this recipe used is no longer connected - " +
            "pick another one.";
          paint();
          return;
        }
        if (!Number(d.prompt)) d.prompt = wired[0];
        state.warn = "";
        warmTriggers(d.loras);
        state.queue.push({
          id: "r" + Date.now().toString(36),
          no: nextNumber(),
          loras: d.loras.map((l) => ({ name: l.name, strength: l.strength })),
          opts: JSON.parse(JSON.stringify(d.opts)),
          repeat: Math.max(1, d.repeat || 1),
          prompt: Number(d.prompt) || 0,
          /* its own copy: the recipe stays as it is for the next one */
          sweep: sweepOf(d) ? JSON.parse(JSON.stringify(sweepOf(d))) : null,
          /* the recipe's own per-recipe trigger words go with it - the
             ones it has not switched, as they stand right now */
          trig: (() => { const t = { loras: d.loras, trig: d.trig }; stampVar(t); return t.trig; })(),
          /* Onto the bench. Adding a recipe and starting to render it are two
             decisions, and joining them would mean a recipe queued while a
             run is going joins that run without being asked. */
          staged: false,
        });
        /* The recipe is left exactly as it was. A series is built by queueing
           one, changing a single thing, and queueing again - emptying the
           recipe each time would mean rebuilding it from the shelves over and
           over. CLEAR is there for when a fresh start is what is wanted. */
        writeStore();
        paint();
      }

      /* Chips can be dragged into a different order within their own row.
         The drop target is whichever chip the pointer is over, so nothing has
         to be aimed at a gap between them. */
      let dragItem = null;
      let dragGroup = null;
      let dragRow = null;
      /* a chip on its way between a recipe's body and its sweep */
      let dragSw = null;
      /* the sweep counter being changed, lit until the pointer leaves it */
      let cntEdit = null, cntEditTimer = null;

      function makeSwDraggable(el, row, kind, item, from) {
        el.draggable = true;
        el.addEventListener("dragstart", (e) => {
          e.stopPropagation();
          dragSw = { row, kind, item, from: from || "body" };
          try { e.dataTransfer.setData("text/plain", ""); } catch (err) { }
          e.dataTransfer.effectAllowed = "move";
          /* shown a moment later: changing the page in the same instant the
             drag starts can cancel it */
          const pod = el.closest(".rowpod");
          if (pod && dragSw.from === "body") setTimeout(() => pod.classList.add("swdrag"), 0);
        });
        el.addEventListener("dragend", () => {
          dragSw = null;
          for (const p of document.querySelectorAll(".rowpod.swdrag, .rowpod.backover")) {
            p.classList.remove("swdrag", "backover");
          }
        });
      }

      /* Two options are one only when everything about them matches - the
         same widget set to the same values. "enabled false" and "enabled
         true" are two passes of a sweep, not a duplicate. */
      function sameOpt(a, b) {
        return !!a && !!b && a.key === b.key &&
          JSON.stringify(a.values || []) === JSON.stringify(b.values || []);
      }

      function swEnsure(row) {
        const sw = swOf(row) || {};
        sw.prompts = Array.isArray(sw.prompts) ? sw.prompts : [];
        sw.loras = Array.isArray(sw.loras) ? sw.loras : [];
        sw.opts = Array.isArray(sw.opts) ? sw.opts : [];
        row.sw = sw;
        return sw;
      }

      /* Moves a chip into the sweep, or back to the recipe's body. A move,
         not a copy: a LoRA in the sweep is the one put first, and the same
         LoRA left on the body as well would only be dropped again. */
      function swMove(d, toSweep) {
        const row = d.row;
        const sw = swEnsure(row);
        if (toSweep) {
          if (d.kind === "prompt") {
            const n = Number(d.item);
            row.prompts = (row.prompts || []).filter((x) => Number(x) !== n);
            if (!sw.prompts.includes(n)) sw.prompts.push(n);
          } else if (d.kind === "lora") {
            row.loras = (row.loras || []).filter((x) => x !== d.item);
            if (!sw.loras.some((x) => x.name === d.item.name)) sw.loras.push(d.item);
          } else if (d.kind === "opt") {
            row.opts = (row.opts || []).filter((x) => x !== d.item);
            sw.opts.push(d.item);
          }
          sw.on = true;
        } else {
          if (d.item && typeof d.item === "object") delete d.item.n;
          if (d.kind === "prompt") {
            const n = Number(d.item);
            sw.prompts = sw.prompts.filter((x) => Number(x) !== n);
            if (sw.pn) delete sw.pn[n];
            if (n !== Number(row.prompt) && !(row.prompts || []).map(Number).includes(n)) {
              row.prompts = (row.prompts || []).concat([n]);
            }
          } else if (d.kind === "lora") {
            sw.loras = sw.loras.filter((x) => x !== d.item);
            if (!(row.loras || []).some((x) => x.name === d.item.name)) {
              row.loras = (row.loras || []).concat([d.item]);
            }
          } else if (d.kind === "opt") {
            sw.opts = sw.opts.filter((x) => x !== d.item);
            if (!(row.opts || []).some((x) => sameOpt(x, d.item))) {
              row.opts = (row.opts || []).concat([d.item]);
            }
          }
          if (!swCount(row)) sw.on = false;
        }
        writeStore();
        paint();
      }

      /* The three rows under a queued recipe. */
      function sweepArea(row) {
        const sw = swEnsure(row);
        /* An option exactly like one before it is kept while the sweep is
           being built - it is usually added to be changed next. It counts
           as nothing and is shown dimmed; Run takes it out. */
        /* a count the same as the recipe's is no count of its own */
        {
          const d0 = Math.max(1, row.repeat || 1);
          for (const x of sw.loras.concat(sw.opts)) if (itemN(x.n) === d0) delete x.n;
          for (const k of Object.keys(sw.pn || {})) if (itemN(sw.pn[k]) === d0) delete sw.pn[k];
          /* a prompt raised to or past a LoRA's count carries that LoRA with
             it: the LoRA follows the prompt again */
          const pf = Math.max(0, ...sw.prompts.map((n) => itemN((sw.pn || {})[n])));
          if (pf) for (const x of sw.loras) if (itemN(x.n) && itemN(x.n) <= pf) delete x.n;
        }
        const wrap = document.createElement("div");
        wrap.className = "vsl-sw";
        const h = document.createElement("div");
        h.className = "swh";
        const hb = document.createElement("b");
        hb.textContent = "SWEEP";
        h.appendChild(hb);
        const ds = document.createElement("span");
        ds.className = "ds";
        ds.textContent = "each in turn";
        const bar = document.createElement("span");
        bar.className = "bar";
        bar.textContent = "|";
        h.append(ds, bar);
        const np = promptList(row).length, nl = loraSets(row).length,
              no = optSets(row).length;
        const ct = document.createElement("span");
        ct.className = "ct";
        const parts = [];
        if (sw.prompts.length) parts.push(np + " prompt" + (np === 1 ? "" : "s"));
        if (sw.loras.length) parts.push(nl + " LoRA" + (nl === 1 ? "" : "s"));
        if (sw.opts.length) {
          const ax = optAxes(row).map((a) => a.length);
          parts.push(ax.length > 1 ? "(" + ax.join(" \u00d7 ") + ") options"
            : no + " option" + (no === 1 ? "" : "s"));
        }
        ct.textContent = parts.length
          ? parts.join(" \u00d7 ") + "  =  " + rowTotal(row) + " renders"
          : "drag a prompt, LoRA or option here";
        h.appendChild(ct);
        const adds = document.createElement("span");
        adds.className = "adds";
        h.appendChild(adds);
        wrap.appendChild(h);
        if (!swCount(row)) wrap.classList.add("allempty");

        const line = (kind, label, items, mk, add, addTitle, hint, groupOf) => {
          const r = document.createElement("div");
          r.className = "swr " + (items.length ? "full" : "empty");
          r.dataset.k = kind;
          const k = document.createElement("span");
          k.className = "k";
          k.textContent = label;
          const cs = document.createElement("div");
          cs.className = "cs";
          /* grouped, when a row's items fall under more than one heading -
             the options of two different settings. Each group numbered in
             the order the sweep runs them, its chips numbered within it. */
          const groups = [];
          if (groupOf) {
            for (const it of items) {
              const g = groupOf(it);
              let gr = groups.find((x) => x.g === g);
              if (!gr) { gr = { g, items: [] }; groups.push(gr); }
              gr.items.push(it);
            }
          }
          if (groups.length > 1) {
            cs.classList.add("grp");
            groups.forEach((gr, gi) => {
              const og = document.createElement("div");
              og.className = "og";
              const ol = document.createElement("span");
              ol.className = "ol";
              ol.textContent = String(gi + 1);
              const ogc = document.createElement("div");
              ogc.className = "ogc";
              gr.items.forEach((it, i) => {
                const c = mk(it, i);
                if (c) ogc.appendChild(c);
              });
              og.append(ol, ogc);
              cs.appendChild(og);
            });
          } else {
            items.forEach((it, i) => {
              const c = mk(it, i);
              if (c) cs.appendChild(c);
            });
          }
          if (!items.length) {
            const e = document.createElement("span");
            e.className = "hint";
            e.textContent = hint;
            cs.appendChild(e);
          }
          const b = document.createElement("button");
          b.className = "vsl-btn ib " + add.cls;
          b.innerHTML = add.icon;
          b.title = addTitle;
          b.setAttribute("aria-label", addTitle);
          b.addEventListener("click", (ev) => { ev.stopPropagation(); add.fn(ev); });
          r.append(k, cs, b);
          wrap.appendChild(r);
          /* the row is hidden, so its add button sits in the heading */
          if (!items.length) {
            const hb = document.createElement("button");
            hb.className = "vsl-btn ib " + add.cls;
            hb.innerHTML = add.icon;
            hb.title = addTitle;
            hb.setAttribute("aria-label", addTitle);
            hb.addEventListener("click", (ev) => { ev.stopPropagation(); add.fn(ev); });
            adds.appendChild(hb);
          }
        };
        const ordEl = (i) => {
          const o = document.createElement("span");
          o.className = "ord";
          o.textContent = String(i + 1);
          return o;
        };
        /* how many images this one chip's passes get - minus and plus right
           on the chip, so a reworked prompt or a LoRA worth a closer look
           gets more without touching the rest; the number itself goes back
           to the recipe's own count */
        const def = Math.max(1, row.repeat || 1);
        /* the chip that is "now" - lit while its picture is being made */
        const live = state.running && state.live && state.live.rowId === row.id
          ? state.live.hit : null;
        const lit = (c, on) => { if (on) c.classList.add("swnow"); return c; };
        /* How far each chip has got: its own renders sent out of its own
           total, the way the recipe's badge does it for the whole recipe.
           Shown once the recipe has started, so a sweep that has not run
           stays quiet. */
        const plan = expandRow(row);
        const smap = tallyMap(state.sent, row), dmap = tallyMap(state.done, row);
        const started = plan.some((r) => Math.max(smap[r.pass] || 0, dmap[r.pass] || 0) >= r.shot);
        const progEl = (match) => {
          if (!started) return null;
          const mine = plan.filter((r) => r.hit && match(r.hit));
          if (!mine.length) return null;
          const sent = mine.filter((r) => Math.max(smap[r.pass] || 0, dmap[r.pass] || 0) >= r.shot).length;
          const b = document.createElement("span");
          b.className = "swp" + (sent >= mine.length ? " done" : "");
          b.dataset.f = String(mine.length ? sent / mine.length : 0);
          b.textContent = sent >= mine.length ? "done" : sent + "/" + mine.length;
          b.title = sent >= mine.length
            ? "every render of this one is out"
            : `${sent} of ${mine.length} sent - ${mine.length - sent} left`;
          return b;
        };
        /* A chip that is done and is dragged to a new place in its row is
           asked for again: its renders are cleared and it runs once more
           from where it now sits - the way a finished recipe dropped back
           into the box starts over. One still under way keeps its count. */
        const rerun = (match) => {
          const mine = plan.filter((r) => r.hit && match(r.hit));
          if (!mine.length) return;
          const doneAll = mine.every((r) => Math.max(smap[r.pass] || 0, dmap[r.pass] || 0) >= r.shot);
          if (!doneAll) return;
          for (const r of mine) { delete smap[r.pass]; delete dmap[r.pass]; }
          writeStore();
        };
        const withProg = (c, match) => {
          const pg = progEl(match);
          if (pg && pg.classList.contains("done")) c.classList.add("swdone");
          if (pg) {
            c.classList.add("swprog");
            c.style.setProperty("--pf", pg.dataset.f || "0");
          }
          if (pg) {
            const at = c.querySelector(":scope > .cnt") || c.querySelector(":scope > .x");
            c.insertBefore(pg, at || null);
          }
          return c;
        };
        /* What a chip's passes actually get - a chip that follows the recipe
           can still be lifted by another chip's higher count (BSS x6 makes
           every BSS pass six, whatever option it meets). "6", or "4-6" when
           its passes differ. */
        const effOf = (match) => {
          const ns = [...new Set(plan.filter((r) => r.hit && match(r.hit)).map((r) => r.repeat))]
            .sort((a, b) => a - b);
          if (!ns.length) return "";
          return ns.length === 1 ? String(ns[0]) : ns[0] + "\u2013" + ns[ns.length - 1];
        };
        /* the highest count a swept prompt was given: a LoRA cannot go below
           it, only above */
        const pFloor = Math.max(0, ...sw.prompts.map((n) => itemN((sw.pn || {})[n])));
        const cntEl = (cur, set, what, id, eff, floor) => {
          const ek = row.id + ":" + id;
          const w = document.createElement("span");
          w.className = "cnt" + (cur ? " own" : "") + (cntEdit === ek ? " edit" : "");
          /* the counter is for numbers: the LoRA's picture card stays shut
             while the pointer is on it, and only the name opens it */
          w.addEventListener("pointerenter", () => {
            if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
            hideHover();
            if (cntEditTimer) { clearTimeout(cntEditTimer); cntEditTimer = null; }
          });
          w.addEventListener("pointermove", () => {
            if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
          });
          /* lit gold while it is being changed, back to plain a moment after
             the pointer leaves it */
          w.addEventListener("pointerleave", () => {
            if (cntEdit !== ek) return;
            if (cntEditTimer) clearTimeout(cntEditTimer);
            cntEditTimer = setTimeout(() => { cntEditTimer = null; cntEdit = null; paint(); }, 900);
          });
          const mk2 = (t, cls, title, fn) => {
            const b = document.createElement("i");
            b.className = cls;
            b.textContent = t;
            b.title = title;
            b.addEventListener("click", (e) => {
              e.stopPropagation(); cntEdit = ek; fn(); writeStore(); paint();
            });
            return b;
          };
          /* back at the recipe's own count is the same as following it; a
             LoRA brought down to a prompt's count follows that prompt */
          const set0 = set;
          set = (v) => set0(v === def || (floor && v <= floor) ? 0 : v);
          /* following the recipe, but lifted by another chip: shown as what
             it really gets */
          const lifted = !cur && eff && eff !== String(def);
          const num = mk2("\u00d7" + (cur || (lifted ? eff : def)), "nv" + (lifted ? " lift" : ""),
            cur ? `${cur} images for each ${what} pass - click to follow the recipe's x${def} again`
                : lifted ? `follows the recipe's x${def}, but another chip in the sweep asks for more - its passes get x${eff}`
                : `as the recipe - x${def}`,
            () => set(0));
          /* the steps start from what it shows */
          const base = cur || (lifted ? Number(String(eff).split("\u2013").pop()) || def : def);
          w.append(
            mk2("\u2212", "st", "one image fewer for this " + what, () => set(Math.max(1, base - 1))),
            num,
            mk2("+", "st", "one image more for this " + what, () => set(Math.min(999, base + 1))));
          for (const ev of ["mousedown", "pointerdown", "dragstart"]) {
            w.addEventListener(ev, (e) => { e.stopPropagation(); if (ev === "dragstart") e.preventDefault(); });
          }
          w.draggable = false;
          return w;
        };
        const withCnt = (c, cnt) => {
          const x = c.querySelector(":scope > .x");
          c.insertBefore(cnt, x || null);
          return c;
        };
        const wired = promptSlots();
        line("prompt", "prompt", sw.prompts, (n, i) => {
          const c = tintPrompt(chip("c-n6", promptName(n), "", {
            pno: pnoEl(n),
            title: promptName(n) + "\n" + promptNote(n) + "rendered in turn, after the recipe's own prompt" +
              "\nclick to swap it\ndrag to reorder, or back onto the recipe to take it out of the sweep",
            /* swapped in place: the new prompt takes this one's turn and its
               count; one already in the sweep only closes the gap */
            onClick: (ev) => openPromptPicker({
              get prompt() { return Number(n); },
              set prompt(v) {
                v = Number(v);
                if (!(v > 0) || v === Number(n)) return;
                sw.pn = sw.pn || {};
                if (sw.prompts.map(Number).includes(v)) {
                  sw.prompts = sw.prompts.filter((x) => Number(x) !== Number(n));
                } else {
                  sw.prompts = sw.prompts.map((x) => (Number(x) === Number(n) ? v : x));
                  if (sw.pn[n] != null) sw.pn[v] = sw.pn[n];
                }
                delete sw.pn[n];
                releaseMain(row, n, v);
                healMain(row);
              },
              sweep: null,
            }, ev.currentTarget),
            onRemove: () => {
              sw.prompts = sw.prompts.filter((x) => Number(x) !== Number(n));
              releaseMain(row, n);
              if (!swCount(row)) sw.on = false;
              writeStore(); paint();
            },
          }), n);
          if (!wired.includes(Number(n))) c.classList.add("nogo");
          makeSortable(c, sw.prompts, n, (m) => rerun((h) => Number(h.p) === Number(m)));
          makeSwDraggable(c, row, "prompt", n, "sweep");
          c.prepend(ordEl(i));
          sw.pn = sw.pn || {};
          return lit(withCnt(c, cntEl(itemN(sw.pn[n]), (v) => {
            if (v) sw.pn[n] = v; else delete sw.pn[n];
          }, "prompt", "p" + n, effOf((h) => Number(h.p) === Number(n)))), live && Number(live.p) === Number(n)) &&
            withProg(c, (h) => Number(h.p) === Number(n));
        }, { cls: "b-prompt", icon: RICON_PROMPT, fn: (ev) => openPromptPicker({
            get prompt() { return 0; },
            set prompt(n) { n = Number(n); if (n > 0 && !sw.prompts.includes(n)) sw.prompts.push(n); sw.on = true; healMain(row); },
            sweep: null,
          }, ev.currentTarget) },
          "Add a prompt to the sweep", "each prompt here renders in turn");
        line("lora", "lora", sw.loras, (l, i) => {
          const c = chip("c-lora", shortName(l.name), strengthText(l.strength), {
            title: l.name + "\nput first, the recipe's own LoRAs following - one pass per LoRA here" +
              "\nright click to change its strength",
            onClick: (ev) => openLoraPicker(sw, l, ev.currentTarget),
            onContext: (ev) => openEditor(["strength"], [1], null,
              [l.strength], ev.currentTarget, (v) => {
                l.strength = Number(v[0]) || 0;
                writeStore();
                paint();
              }),
            onRemove: () => {
              sw.loras = sw.loras.filter((x) => x !== l);
              if (!swCount(row)) sw.on = false;
              writeStore(); paint();
            },
          });
          attachHoverPreview(c, l.name);
          makeSortable(c, sw.loras, l, (m) => rerun((h) => h.lora === m.name));
          makeSwDraggable(c, row, "lora", l, "sweep");
          c.prepend(ordEl(i));
          return lit(withCnt(c, cntEl(itemN(l.n), (v) => {
            if (v) l.n = v; else delete l.n;
          }, "LoRA", "l" + l.name, effOf((h) => h.lora === l.name), pFloor)), live && live.lora === l.name) &&
            withProg(c, (h) => h.lora === l.name);
        }, { cls: "b-lora", icon: RICON_LORA, fn: (ev) => { sw.on = true; openLoraPicker(sw, null, ev.currentTarget); } },
          "Add a LoRA to the sweep", "each LoRA here goes first, one pass each");
        line("opt", "options", sw.opts, (o, i) => {
          const c = chip(nodeColourClass(o.title), o.widget,
            fmtOptVals({ ...o, values: o.values || [] }, " / "), {
              prefix: shortNodeName(o.title),
              title: o.title + " . " + o.widget + "\noptions on the same setting take turns; different settings combine" +
                "\nclick to edit",
              onClick: (ev) => openGroupEditor(o.title, [o], ev.currentTarget, writeStore),
              onRemove: () => {
                sw.opts = sw.opts.filter((x) => x !== o);
                if (!swCount(row)) sw.on = false;
                writeStore(); paint();
              },
            });
          if (isDupOpt(sw, o)) {
            c.classList.add("dupopt");
            c.title = "the same as an option before it - change it, or it is taken out when the render starts\n" + c.title;
          }
          makeSortable(c, sw.opts, o, (m) => rerun((h) => hitHasOpt(h, optId(m))));
          makeSwDraggable(c, row, "opt", o, "sweep");
          c.prepend(ordEl(i));
          const oid = optId(o);
          /* an option's count lifts only its own passes; brought down to
             what the prompt asks it follows again */
          return lit(withCnt(c, cntEl(itemN(o.n), (v) => {
            if (v) o.n = v; else delete o.n;
          }, "option", "o" + oid, effOf((h) => hitHasOpt(h, oid)), pFloor)), hitHasOpt(live, oid)) &&
            withProg(c, (h) => hitHasOpt(h, oid));
        }, { cls: "b-opt", icon: RICON_OPT, fn: (ev) => { sw.on = true; openOptionPicker(sw, ev.currentTarget); } },
          "Add an option to the sweep", "same setting: one pass each - different settings: every combination",
          (o) => o.key);

        wrap.addEventListener("dragover", (e) => {
          /* a chip from this sweep let go between rows stays where it was */
          if (dragSw && dragSw.row === row && dragSw.from === "sweep") {
            e.preventDefault(); e.stopPropagation(); return;
          }
          if (!dragSw || dragSw.row !== row || dragSw.from !== "body") return;
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = "move";
          wrap.classList.add("over");
        });
        wrap.addEventListener("dragleave", (e) => {
          if (!wrap.contains(e.relatedTarget)) wrap.classList.remove("over");
        });
        wrap.addEventListener("drop", (e) => {
          wrap.classList.remove("over");
          if (dragSw && dragSw.row === row && dragSw.from === "sweep") {
            e.preventDefault(); e.stopPropagation(); return;
          }
          if (!dragSw || dragSw.row !== row || dragSw.from !== "body") return;
          e.preventDefault();
          e.stopPropagation();
          const d = dragSw;
          dragSw = null;
          swMove(d, true);
        });
        return wrap;
      }

      /* A chip dragged out of the sweep and dropped anywhere else on its own
         recipe goes back to the body. */
      function makePodTakeBack(el, row) {
        el.addEventListener("dragover", (e) => {
          if (!dragSw || dragSw.row !== row || dragSw.from !== "sweep") return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          el.classList.add("backover");
        });
        el.addEventListener("dragleave", (e) => {
          if (!el.contains(e.relatedTarget)) el.classList.remove("backover");
        });
        el.addEventListener("drop", (e) => {
          el.classList.remove("backover");
          if (!dragSw || dragSw.row !== row || dragSw.from !== "sweep") return;
          e.preventDefault();
          e.stopPropagation();
          const d = dragSw;
          dragSw = null;
          swMove(d, false);
        });
      }

      /* Whole recipes can be dragged into a different order. */
      /* A recipe is dragged whole, between the bench and the box and within
         either of them. The drop lands where the pointer is - above or below
         whichever recipe it is over - rather than always at the end, because
         the order in the box is the order things will run in.

         The box is drawn bottom-up (column-reverse), so "below" on screen is
         earlier in the list. The maths below is in list order and the drawing
         takes care of the flip. */
      function moveRow(row, staged, beforeRow) {
        const q = state.queue;
        const from = q.indexOf(row);
        if (from < 0) return;
        q.splice(from, 1);
        /* Dropped back in: a recipe that had finished runs again from the
           start; one taken out part way picks up where it stopped (its own
           reset button starts it over). Only what came back counts - a
           render sent but never returned is sent again. */
        if (staged && !row.staged) {
          if (doneOf(row) >= rowTotal(row)) delete state.done[row.id];
          delete state.sent[row.id];
        }
        row.staged = !!staged;
        let at = q.length;
        if (beforeRow && beforeRow !== row) {
          const i = q.indexOf(beforeRow);
          if (i >= 0) at = i;
        }
        q.splice(at, 0, row);
        writeStore();
        paint();
      }

      function makeRowDraggable(el, row) {
        el.draggable = true;
        el.addEventListener("dragstart", (e) => {
          dragRow = row;
          el.classList.add("dragging");
          try { e.dataTransfer.setData("text/plain", ""); } catch (err) { }
          e.dataTransfer.effectAllowed = "move";
        });
        el.addEventListener("dragend", () => {
          el.classList.remove("dragging");
          dragRow = null;
          for (const l of [elBench, elBox]) l.classList.remove("over");
        });
      }

      /* Which recipe the pointer is sitting before, in list order. */
      function dropTargetIn(list, e) {
        const pods = [...list.querySelectorAll(".rowpod")]
          .filter((x) => !x.classList.contains("dragging"));
        const reversed = list.classList.contains("box");
        for (const pod of pods) {
          const r = pod.getBoundingClientRect();
          const past = e.clientY < r.top + r.height / 2;
          if (reversed ? !past : past) return pod.__vslRow || null;
        }
        return null;
      }

      function makeListDroppable(list, staged) {
        list.addEventListener("dragover", (e) => {
          if (!dragRow) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          list.classList.add("over");
        });
        list.addEventListener("dragleave", (e) => {
          if (e.target === list) list.classList.remove("over");
        });
        list.addEventListener("drop", (e) => {
          const moving = dragRow;
          dragRow = null;
          list.classList.remove("over");
          if (!moving) return;
          e.preventDefault();
          e.stopPropagation();
          moveRow(moving, staged, dropTargetIn(list, e));
        });
      }

      /* Most of the time a recipe is right except for one LoRA. Swapping or
         adding one in place beats rebuilding the whole thing in the Recipe
         and queueing it again. */
      function openLoraPicker(row, current, anchor) {
        closeEditor();
        const box = document.createElement("div");
        box.className = "vsl-edit";
        box.style.minWidth = "260px";
        box.style.maxHeight = "420px";
        box.style.overflowY = "auto";
        const head = document.createElement("div");
        head.className = "eh";
        head.textContent = current
          ? `Swap this LoRA - keeps its strength, ${strengthText(current.strength)}`
          : "Add a LoRA";
        box.appendChild(head);
        const inUse = new Set((row.loras || []).map((l) => l.name));
        let any = false;
        const pickBtn = (l) => {
          any = true;
          const b = document.createElement("button");
          b.className = "vsl-btn" +
            (current && l.name === current.name ? " go" : "");
          b.style.textAlign = "left";
          /* A swap keeps the strength the recipe already had: trying another
             LoRA in the same place should not reset what was tuned there. */
          b.textContent = shortName(l.name) + "   "
            + strengthText(current ? current.strength : l.strength);
          b.addEventListener("click", (e) => {
            e.stopPropagation();
            if (current) {
              current.name = l.name;
            } else {
              row.loras = (row.loras || []).concat(
                [{ name: l.name, strength: l.strength }]);
            }
            closeEditor();
            writeStore();
            paint();
          });
          return b;
        };
        const offered = state.loras.filter((l) =>
          !(inUse.has(l.name) && l.name !== (current && current.name)));
        /* The shelf's own groups, in the shelf's order: the ones in no group
           first, then each group under a band that folds. A group opens
           here as it is on the shelf - folded there, folded here - and the
           one holding the LoRA being swapped always opens. Folding here does
           not change the shelf. */
        const groups = LSHELF.failed ? [] : LSHELF.groups;
        const home = new Map();
        for (const g of groups) for (const n of g.items) if (!home.has(n)) home.set(n, g.id);
        for (const l of offered) if (!home.has(l.name)) box.appendChild(pickBtn(l));
        for (const g of groups) {
          const members = offered.filter((l) => home.get(l.name) === g.id);
          if (!members.length) continue;
          const grp = document.createElement("div");
          const holds = current && members.some((l) => l.name === current.name);
          grp.className = "vsl-sgrp lgrp vsl-pkgrp" + (g.shut && !holds ? " shut" : "");
          const head = document.createElement("div");
          head.className = "vsl-sghead";
          head.innerHTML = `<span class="tw">\u25BE</span><span class="nm"></span><span class="ct">${members.length}</span>`;
          head.querySelector(".nm").textContent = g.name;
          head.addEventListener("click", (e) => {
            e.stopPropagation();
            grp.classList.toggle("shut");
          });
          const body = document.createElement("div");
          body.className = "vsl-pkbody";
          for (const l of members) body.appendChild(pickBtn(l));
          grp.append(head, body);
          box.appendChild(grp);
        }
        if (!any) {
          const e2 = document.createElement("label");
          e2.textContent = "every LoRA the loader offers is already in this recipe";
          box.appendChild(e2);
        }
        const bar = document.createElement("div");
        bar.className = "rowb";
        const cancel = document.createElement("button");
        cancel.className = "vsl-btn";
        cancel.textContent = "Cancel";
        cancel.addEventListener("click", (e) => {
          e.stopPropagation(); closeEditor();
        });
        bar.appendChild(cancel);
        box.appendChild(bar);
        editor = box;
        placeNear(box, anchor);
        dismissOnOutside(box);
      }

      /* Add an option to a recipe that is already in the queue, without
         rebuilding it from the shelf. Grouped by node, the same way the shelf
         is, so a long list stays findable. */
      /* Favourite options: starred in the option picker, listed first.
         Named by the node's title and the widget - "KSamplerSelect .
         sampler_name" - not by its id, so a star made in one workflow holds
         in the next one with a node of that name. Kept in this browser and
         with the workflow, so neither alone loses them. */
      const OPT_FAV_KEY = "leiel.vsl.optfavs";
      let optFavSet = null;
      function optFavLoad() {
        if (optFavSet) return optFavSet;
        optFavSet = new Set();
        try {
          const v = JSON.parse(localStorage.getItem(OPT_FAV_KEY) || "[]");
          if (Array.isArray(v)) for (const x of v) if (typeof x === "string") optFavSet.add(x);
        } catch (e) { /* private mode */ }
        return optFavSet;
      }
      function optFavList() { return [...optFavLoad()]; }
      function optFavSave() {
        try { localStorage.setItem(OPT_FAV_KEY, JSON.stringify(optFavList())); } catch (e) { /* private mode */ }
      }
      function optFavMerge(list) {
        const set = optFavLoad();
        let added = false;
        for (const x of list) if (typeof x === "string" && !set.has(x)) { set.add(x); added = true; }
        if (added) optFavSave();
      }
      const optFavId = (o) => String(o.title || "") + " . " + String(o.widget || "");
      const isOptFav = (o) => optFavLoad().has(optFavId(o));
      function toggleOptFav(o) {
        const set = optFavLoad();
        const id = optFavId(o);
        if (set.has(id)) set.delete(id); else set.add(id);
        optFavSave();
        writeStore();
      }

      function openOptionPicker(row, anchor) {
        closeEditor();
        const box = document.createElement("div");
        box.className = "vsl-edit";
        box.style.minWidth = "300px";
        /* A width as well as a height. Options are widget values, and one of
           those widgets is a Prompt Composer section holding a whole prompt -
           a few thousand characters on one button, which stretched the picker
           across the screen. The list is allowed to be as long as it likes;
           it is the line length that has to be held. The scrolling belongs to
           the list and not to the panel, so the heading and the Cancel button
           stay put while it moves. */
        box.style.maxWidth = "440px";
        const head = document.createElement("div");
        head.className = "eh";
        head.textContent = "Add an option  -  or a node name for all of its";
        box.appendChild(head);
        const list = document.createElement("div");
        list.className = "vsl-pick";
        box.appendChild(list);

        /* Everything is offered, what the recipe already holds included: the
           same option twice, set two ways, is how a sweep tries both. Those
           already in are marked, so it is still clear what a press adds. */
        const taken = new Set((row.opts || []).map((o) => o.key));
        const groups = new Map();
        for (const o of state.options) {
          if (!groups.has(o.title)) groups.set(o.title, []);
          groups.get(o.title).push(o);
        }
        /* Exactly the shape the recipe builder makes, so a row built here and
           a row built from the shelf are the same thing. */
        const asOpt = (o) => ({
          key: o.key, nodeId: o.nodeId, title: o.title, widget: o.widget,
          kind: o.kind, choices: o.choices, values: [o.value], out: true,
        });

        let any = false;
        const optButton = (o) => {
          const b = document.createElement("button");
          b.className = "vsl-btn optpick" + (taken.has(o.key) ? " taken" : "");
          const wn = document.createElement("span");
          wn.className = "w";
          wn.textContent = o.widget;
          const vv = document.createElement("span");
          vv.className = "v";
          const flat = String(o.value).replace(/\s+/g, " ").trim();
          vv.textContent = flat.length > 90 ? flat.slice(0, 90) + "\u2026" : flat;
          /* the star: on, it puts this option at the top of the list */
          const st = document.createElement("span");
          const fav = isOptFav(o);
          st.className = "st" + (fav ? " on" : "");
          st.textContent = fav ? "\u2605" : "\u2606";
          st.title = fav ? "take it out of the favourites" : "keep it at the top - a favourite";
          st.addEventListener("click", (e) => {
            e.stopPropagation();
            toggleOptFav(o);
            const keep = list.scrollTop;
            openOptionPicker(row, anchor);
            const nl = editor && editor.querySelector(".vsl-pick");
            if (nl) nl.scrollTop = keep;
          });
          b.appendChild(wn);
          b.appendChild(vv);
          b.appendChild(st);
          b.title = o.widget + "\n" + String(o.value) +
            (taken.has(o.key) ? "\nalready in this recipe - adds it once more" : "");
          b.addEventListener("click", (e) => {
            e.stopPropagation();
            row.opts = (row.opts || []).concat([asOpt(o)]);
            closeEditor();
            writeStore();
            paint();
          });
          return b;
        };
        const favs = state.options.filter(isOptFav);
        if (favs.length) {
          const fh = document.createElement("label");
          fh.className = "favh";
          fh.textContent = "\u2605 Favourites";
          list.appendChild(fh);
          for (const o of favs) {
            any = true;
            const b = optButton(o);
            const node = document.createElement("span");
            node.className = "fn";
            node.textContent = shortNodeName(o.title);
            b.insertBefore(node, b.firstChild);
            list.appendChild(b);
          }
          const sep = document.createElement("div");
          sep.className = "favsep";
          list.appendChild(sep);
        }
        for (const [title, opts] of groups) {
          const lab = document.createElement("label");
          lab.className = "grab";
          /* A node with no title of its own still has to be findable, so it
             falls back to its class and then to its id. */
          const nameText = shortNodeName(title) || String(opts[0].cls || "")
            || ("#" + opts[0].nodeId);
          const nm = document.createElement("span");
          nm.textContent = nameText;
          const count = document.createElement("span");
          count.className = "n";
          count.textContent = "+ all " + opts.length;
          lab.appendChild(nm);
          lab.appendChild(count);
          lab.title = "Add every option under " + nameText
            + " that is not in this recipe yet";
          /* Only what is missing: the list here already leaves out whatever
             the recipe holds, so nothing that was set by hand is overwritten
             by a press meant to save time. */
          lab.addEventListener("click", (e) => {
            e.stopPropagation();
            row.opts = (row.opts || []).concat(opts.filter((o) => !taken.has(o.key)).map(asOpt));
            closeEditor();
            writeStore();
            paint();
          });
          list.appendChild(lab);
          for (const o of opts) {
            any = true;
            const b = optButton(o);
            list.appendChild(b);
          }
        }
        if (!any) {
          const e2 = document.createElement("label");
          e2.textContent = "no options found - press Refresh on the Options Shelf";
          list.appendChild(e2);
        }
        const bar = document.createElement("div");
        bar.className = "rowb";
        const cancel = document.createElement("button");
        cancel.className = "vsl-btn";
        cancel.textContent = "Cancel";
        cancel.addEventListener("click", (e) => {
          e.stopPropagation(); closeEditor();
        });
        bar.appendChild(cancel);
        box.appendChild(bar);
        editor = box;
        placeNear(box, anchor);
        dismissOnOutside(box);
      }

      /* Swap the prompt on a recipe that is already built, from the recipe
         itself or from a row in the queue - the same way a LoRA is swapped. */
      function openPromptPicker(target, anchor) {
        closeEditor();
        const slots = promptSlots();
        const box = document.createElement("div");
        box.className = "vsl-edit";
        const head = document.createElement("div");
        head.className = "eh";
        head.textContent = "Which prompt";
        box.appendChild(head);

        if (!slots.length) {
          const lab = document.createElement("label");
          lab.textContent = "nothing is wired to the prompt sockets";
          box.appendChild(lab);
        }
        /* Book prompts gathered under their series, each series folding on
           its heading - with many series the list was taller than the
           screen. The series of the recipe's own prompt opens; the rest are
           as they were last left. */
        const sb = seriesBook();
        const groupOfN = (n) => {
          const bp = bookPrompt(n);
          return bp && sb && Array.isArray(sb.groups) ? sb.groups.find((g) => g.id === bp.g) || null : null;
        };
        const curG = groupOfN(Number(target.prompt));
        state.pickFold = state.pickFold || {};
        const folded = (g) => {
          const k = seriesKey(g);
          if (curG && g.id === curG.id) return false;
          return Object.prototype.hasOwnProperty.call(state.pickFold, k) ? !!state.pickFold[k] : true;
        };
        let lastG;
        let holder = box;
        for (const n of slots) {
          const g = groupOfN(n);
          if (g !== lastG) {
            lastG = g;
            if (g) {
              const fold = folded(g);
              const gh = document.createElement("div");
              gh.className = "vsl-pg" + (fold ? " shut" : "");
              hueVars(gh, Number(seriesLook(g).hue) || 0);
              const count = slots.filter((x) => groupOfN(x) === g).length;
              gh.innerHTML = `<i class="tw">\u25BE</i><b>${g.no}</b><span class="gn"></span><span class="ct">${count}</span>`;
              gh.querySelector(".gn").textContent = g.name;
              const list = document.createElement("div");
              list.className = "vsl-pgl";
              if (fold) list.style.display = "none";
              gh.addEventListener("click", (e) => {
                e.stopPropagation();
                const now = list.style.display !== "none";
                list.style.display = now ? "none" : "";
                gh.classList.toggle("shut", now);
                state.pickFold[seriesKey(g)] = now;
                writeStore();
              });
              box.appendChild(gh);
              box.appendChild(list);
              holder = list;
            } else holder = box;
          }
          const b = document.createElement("button");
          b.className = "vsl-btn" +
            (Number(target.prompt) === n ? " on" : "");
          b.classList.add("vsl-pp");
          /* the book's number in its own badge, apart from a number the name
             may begin with, both in the series' colour */
          const no = pnoEl(n);
          if (no) {
            const nb = no;
            b.appendChild(nb);
          }
          const nm = document.createElement("span");
          nm.className = "pnm";
          nm.textContent = promptName(n);
          b.appendChild(nm);
          if (promptNote(n)) b.title = promptName(n) + "\n" + promptNote(n).trim();
          tintPrompt(b, n);
          b.addEventListener("click", (e) => {
            e.stopPropagation();
            target.prompt = n;
            /* a sweep is made of a book's capsules - not for a socket prompt */
            if (n < BOOK_BASE) target.sweep = null;
            closeEditor();
            writeStore();
            paint();
          });
          holder.appendChild(b);
        }

        const bar = document.createElement("div");
        bar.className = "rowb";
        /* No "take it out" here: a recipe with no prompt cannot render, so
           removing one is never a thing to want. Swapping is. */
        const cancel = document.createElement("button");
        cancel.className = "vsl-btn";
        cancel.textContent = "Cancel";
        cancel.addEventListener("click", (e) => {
          e.stopPropagation(); closeEditor();
        });
        bar.appendChild(cancel);
        box.appendChild(bar);
        editor = box;
        placeNear(box, anchor);
        dismissOnOutside(box);
      }

      /* One LoRA, gone from the shelf, the recipe and every queued row.
         Rows are left in place even when this empties them: a row is a set of
         options as much as a set of LoRAs, and the person who queued it is
         the one who decides whether it is still worth rendering. */
      function dropLoraEverywhere(name, quiet) {
        state.picked = state.picked.filter((x) => x.name !== name);
        state.loras = state.loras.filter((x) => x.name !== name);
        state.draft.loras = state.draft.loras.filter((x) => x.name !== name);
        for (const row of state.queue) {
          if (!row.loras) continue;
          row.loras = row.loras.filter((x) => x.name !== name);
        }
        if (quiet) return;
        writeStore();
        paint();
      }

      function makeSortable(el, list, item, onMoved) {
        el.draggable = true;
        el.addEventListener("dragstart", (e) => {
          e.stopPropagation();
          dragItem = { list, item };
          el.classList.add("dragging");
          try { e.dataTransfer.setData("text/plain", ""); } catch (err) { }
          e.dataTransfer.effectAllowed = "move";
        });
        el.addEventListener("dragend", (e) => {
          e.stopPropagation();
          el.classList.remove("dragging");
          dragItem = null;
        });
        el.addEventListener("dragover", (e) => {
          if (!dragItem || dragItem.list !== list) return;
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = "move";
          el.classList.add("dropinto");
        });
        el.addEventListener("dragleave", () => el.classList.remove("dropinto"));
        el.addEventListener("drop", (e) => {
          el.classList.remove("dropinto");
          if (!dragItem || dragItem.list !== list) return;
          e.preventDefault();
          e.stopPropagation();
          const from = list.indexOf(dragItem.item);
          const to = list.indexOf(item);
          dragItem = null;
          if (from < 0 || to < 0 || from === to) return;
          const moved = list[from];
          list.splice(to, 0, ...list.splice(from, 1));
          if (onMoved) onMoved(moved);
          paint();
        });
      }

      /* An option chip stands for every setting of one node, so dragging it
         moves the whole group rather than one entry of the flat list. */
      function makeGroupSortable(el, title, order) {
        el.draggable = true;
        el.addEventListener("dragstart", (e) => {
          e.stopPropagation();
          dragGroup = title;
          el.classList.add("dragging");
          try { e.dataTransfer.setData("text/plain", ""); } catch (err) { }
          e.dataTransfer.effectAllowed = "move";
        });
        el.addEventListener("dragend", (e) => {
          e.stopPropagation();
          el.classList.remove("dragging");
          dragGroup = null;
        });
        el.addEventListener("dragover", (e) => {
          if (!dragGroup || dragGroup === title) return;
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = "move";
          el.classList.add("dropinto");
        });
        el.addEventListener("dragleave", () => el.classList.remove("dropinto"));
        el.addEventListener("drop", (e) => {
          el.classList.remove("dropinto");
          const moving = dragGroup;
          dragGroup = null;
          if (!moving || moving === title) return;
          e.preventDefault();
          e.stopPropagation();
          const next = order.filter((t) => t !== moving);
          next.splice(next.indexOf(title), 0, moving);
          const byTitle = new Map();
          for (const o of state.draft.opts) {
            if (!byTitle.has(o.title)) byTitle.set(o.title, []);
            byTitle.get(o.title).push(o);
          }
          state.draft.opts = next.flatMap((t) => byTitle.get(t) || []);
          paint();
        });
      }

      /* Trigger words come from the metadata filed beside each LoRA, so they
         are available whether or not a loader is on the canvas. Fetched once
         per LoRA and kept. */
      async function loadTriggers(name) {
        if (state.triggers[name] !== undefined) return;
        state.triggers[name] = [];
        const q = "?lora=" + encodeURIComponent(name);
        for (const attempt of [() => fetch("/visual_series_lab/triggers" + q),
                               () => api.fetchApi("/visual_series_lab/triggers" + q)]) {
          try {
            const r = await attempt();
            if (!r || !r.ok) continue;
            const j = await r.json();
            if (j && Array.isArray(j.words)) {
              state.triggers[name] = j.words;
              paint();
              return;
            }
          } catch (e) { /* try the next */ }
        }
      }

      /* The words this render will actually use: those of the LoRAs in the
         recipe, minus any switched off. */
      /* A word in the "per recipe" row is decided by each recipe: what the
         recipe says, or - for one that has not said - the word's switch in
         that row. Every other word follows its switch for every render. */
      function isVar(k) { return !!(state.trigVar && state.trigVar[k]); }
      /* A word into the row of its own - or back up - by a right click or
         by dragging it there. */
      function moveWord(k) {
        followDefault(k);
        state.trigVar = Object.assign({}, state.trigVar || {});
        if (state.trigVar[k]) delete state.trigVar[k];
        else state.trigVar[k] = true;
        writeStore();
        paint();
      }
      /* A recipe takes the per-recipe words as they stand when it is made,
         and keeps them: changing a word's default afterwards is for the
         recipes still to come. */
      function carriesWord(rec, k) {
        return rowLoras(rec).some((l) => (state.triggers[l.name] || []).some((w) => w.toLowerCase() === k));
      }
      function stampVar(rec) {
        if (!rec) return;
        rec.trig = Object.assign({}, rec.trig || {});
        for (const k of Object.keys(state.trigVar || {})) {
          if (!Object.prototype.hasOwnProperty.call(rec.trig, k) && carriesWord(rec, k)) rec.trig[k] = !state.trigOff[k];
        }
      }
      /* The recipe being built goes back to the default for this word. A
         switch flipped on it once stayed with it, so every recipe queued
         from it came out that way however the default was set - the default
         seemed to do nothing. Setting the default is the clearest way of
         saying what the next ones should be. */
      function followDefault(k) {
        if (state.draft && state.draft.trig && Object.prototype.hasOwnProperty.call(state.draft.trig, k)) {
          state.draft.trig = Object.assign({}, state.draft.trig);
          delete state.draft.trig[k];
        }
      }
      function freezeVar(k) {
        for (const row of state.queue) {
          if (row.trig && Object.prototype.hasOwnProperty.call(row.trig, k)) continue;
          if (!carriesWord(row, k)) continue;
          row.trig = Object.assign({}, row.trig || {});
          row.trig[k] = !state.trigOff[k];
        }
      }
      function wordOnFor(k, rec) {
        if (isVar(k) && rec && rec.trig && Object.prototype.hasOwnProperty.call(rec.trig, k)) return !!rec.trig[k];
        return !state.trigOff[k];
      }
      /* The per-recipe words a recipe's LoRAs carry, as small switches on
         its header - lit when the word goes out with it. */
      function trigSwitches(rec, into) {
        if (!rec) return;
        const seen = new Set();
        for (const l of rowLoras(rec)) {
          for (const w of state.triggers[l.name] || []) {
            const k = w.toLowerCase();
            if (!isVar(k) || seen.has(k)) continue;
            seen.add(k);
            const on = wordOnFor(k, rec) && state.trigPos !== "off";
            const t = document.createElement("span");
            t.className = "vsl-tv" + (on ? " on" : "");
            /* a small state badge inside, the word beside it - the badge says
               whether it goes out, the word stays quiet */
            const st = document.createElement("b");
            st.className = "st";
            st.textContent = on ? "ON" : "OFF";
            const wd = document.createElement("span");
            wd.textContent = w;
            t.append(st, wd);
            t.title = `${w} - ${on ? "goes out with this recipe" : "left out of this recipe"}\nclick to ${on ? "leave it out" : "put it in"} - this recipe only`;
            t.addEventListener("pointerdown", (e) => e.stopPropagation());
            t.addEventListener("mousedown", (e) => e.stopPropagation());
            t.addEventListener("click", (e) => {
              e.stopPropagation();
              rec.trig = Object.assign({}, rec.trig || {});
              rec.trig[k] = !wordOnFor(k, rec);
              writeStore();
              paint();
            });
            into.appendChild(t);
          }
        }
      }

      function activeTriggers(loras, rec) {
        const out = [];
        const seen = new Set();
        for (const l of loras || []) {
          for (const w of state.triggers[l.name] || []) {
            const k = w.toLowerCase();
            if (seen.has(k) || !wordOnFor(k, rec)) continue;
            seen.add(k);
            out.push(w);
          }
        }
        return out;
      }

      makeListDroppable(elBench, false);
      makeListDroppable(elBox, true);

      /* The bench and the box divide the queue panel between them. Which of
         the two needs the room changes with what is being done - building a
         batch, or watching one run - so it is a number the user sets, kept
         with the rest of the layout. */
      /* The box has no size of its own to drag. It is exactly as tall as the
         recipes inside it and no taller, so its shape never gets cut off by a
         height somebody set earlier, and the bench keeps whatever is left.
         One less thing to adjust, and the two panes can never disagree. */
      const BOX_MIN = 74;
      function applyBenchSplit() {
        const stack = $(".vsl-stack");
        const room = (stack && stack.clientHeight) || hOf("queue");
        /* A ceiling all the same: a box holding twenty recipes must not push
           the bench off the panel. Past it the box scrolls. */
        elBox.style.maxHeight = Math.max(BOX_MIN, Math.round(room * 0.72)) + "px";
      }


      /* What the thing on the other end of the wire calls itself. A node like
         the Prompt Composer names its outputs after the sections they carry,
         which is exactly the name this shelf wants. A plain text node calls
         its output STRING, which says nothing - in that case the node's own
         title is a better guess, and failing that the socket number. */
      const GENERIC_OUT =
        /^(string|text|value|out|output|out_?\d*|prompt\d*|conditioning|all prompt|labeled prompt)$/i;

      function promptSource(n) {
        if (n >= BOOK_BASE) {
          const p = bookPrompt(n);
          return p ? { key: "book:" + p.id, name: p.name } : null;
        }
        try {
          const inp = (node.inputs || []).find((x) => x.name === "prompt" + n);
          if (!inp || inp.link === null || inp.link === undefined) return null;
          const link = app.graph.links[inp.link];
          if (!link) return null;
          const up = app.graph.getNodeById(link.origin_id);
          if (!up) return null;
          const out = (up.outputs || [])[link.origin_slot];
          const label = String((out && (out.label || out.name)) || "").trim();
          return {
            key: link.origin_id + ":" + link.origin_slot,
            name: (label && !GENERIC_OUT.test(label))
              ? label
              : String(up.title || up.comfyClass || up.type || "").trim(),
          };
        } catch (e) { return null; }
      }

      const promptSourceName = (n) => (promptSource(n) || {}).name || "";

      /* A name typed here wins - it was typed on purpose, and a chip should
         not rename itself under the user's hand. But it was typed about ONE
         wire. Rewire the socket to a different output and the old name is no
         longer a nickname for anything, which is how a shelf ends up showing
         "windows medium" next to a socket now carrying Quality Anchor. So the
         source is remembered with the name and the override is dropped the
         moment they disagree. */
      function promptName(n) {
        /* a book prompt is named in the book, and only there */
        if (n >= BOOK_BASE) {
          const p = bookPrompt(n);
          return p ? p.name : "Book prompt " + (n - BOOK_BASE);
        }
        const src = promptSource(n);
        const typed = String(state.promptNames[n] || "").trim();
        if (typed && src) {
          const was = state.promptNameSrc ? state.promptNameSrc[n] : undefined;
          /* Undefined means the name was saved before names were tied to a
             wire, so there is nothing to say it still describes what is
             plugged in. Keeping those was the wrong call: every workflow that
             already existed carries them, which is exactly the case where the
             shelf was showing the wrong names. An unanchored name is dropped
             the first time the chip is drawn, and anything typed from now on
             is anchored and survives. */
          if (was === undefined || was !== src.key) {
            delete state.promptNames[n];
            if (state.promptNameSrc) delete state.promptNameSrc[n];
          } else {
            return typed;
          }
        } else if (typed) {
          return typed;             // nothing wired - nothing to disagree with
        }
        return (src && src.name) || ("Prompt " + n);
      }

      /* Renaming the node on the other end of a wire changes what the chip
         should say, and nothing over here is told about it. Being drawn is the
         one moment the canvas is certainly live, so the names are gathered
         then and compared with the ones on the shelf; the shelf is repainted
         only when one has actually changed, so an untouched graph costs a
         string compare a frame. */
      let shelfNames = null;
      const prevDrawFg = node.onDrawForeground;
      node.onDrawForeground = function (...args) {
        const r = prevDrawFg ? prevDrawFg.apply(this, args) : undefined;
        try {
          let now = "";
          for (let i = 1; i <= MAX_PROMPTS; i++) now += "\u0001" + promptName(i);
          /* a book's prompts come and go and are renamed inside the book */
          for (const n of promptSlots()) if (n >= BOOK_BASE) now += "\u0002" + n + promptName(n);
          /* and the series themselves - renamed, renumbered - in the book */
          const sb = seriesBook();
          if (sb && Array.isArray(sb.groups)) {
            for (const g of sb.groups) now += "\u0003" + g.id + ":" + g.no + ":" + g.name + ":" + g.hue;
          }
          /* and the frame each prompt asks for */
          if (sb && Array.isArray(sb.prompts)) {
            for (const p of sb.prompts) now += "\u0004" + p.id + ":" + (p.orient || "all");
          }
          if (shelfNames === null) shelfNames = now;
          else if (now !== shelfNames) { shelfNames = now; paint(); }
        } catch (e) { /* ignore */ }
        return r;
      };

      /* ---- paint ---- */
      function paint() {
        /* The shelf mirrors the sockets: one chip per prompt actually wired
           up. Names are the user's - the socket says prompt3, but what is on
           the end of it is "Sofia opening", and that is what belongs on a
           recipe. */
        elPrompts.innerHTML = "";
        const slots = promptSlots();
        if (!slots.length) {
          const e = document.createElement("div");
          e.className = "vsl-empty";
          e.innerHTML = "<b>No prompt wired up</b>" +
            "Connect a text node to <i>prompt1</i> and it appears here. " +
            "Another socket opens up each time you use one, up to ten. " +
            "A Series Book on <i>series</i> brings all of its prompts at once.";
          elPrompts.appendChild(e);
        }
        let lastSeries = null;
        let groupBody = null;
        for (const n of slots) {
          const chosen = Number(state.draft.prompt) === n;
          if (n >= BOOK_BASE) {
            /* A Series Book: each series is a group of its own - a heading
               that folds it away, and a colour its prompts carry. */
            const bk = seriesBook();
            const bp = bookPrompt(n);
            const g = bk && bp && Array.isArray(bk.groups) ? bk.groups.find((x) => x.id === bp.g) : null;
            if (g && bp.g !== lastSeries) {
              lastSeries = bp.g;
              const look = seriesLook(g);
              const grp = document.createElement("div");
              grp.className = "vsl-sgrp" + (look.fold ? " shut" : "");
              hueVars(grp, Number(look.hue) || 0);
              const head = document.createElement("div");
              head.className = "vsl-sghead";
              const count = bk.prompts.filter((x) => x.g === g.id).length;
              head.innerHTML = '<span class="tw">\u25BC</span><span class="no"></span>'
                + '<span class="nm"></span><span class="ct"></span><span class="dot"></span>';
              head.querySelector(".no").textContent = String(g.no);
              head.querySelector(".nm").textContent = g.name || "";
              head.querySelector(".ct").textContent = String(count);
              head.title = (look.fold ? "show" : "fold away") + " series " + g.no + " - " + (g.name || "");
              head.addEventListener("click", () => {
                setSeriesLook(g, { fold: !seriesLook(g).fold });
                paint();
              });
              const dot = head.querySelector(".dot");
              dot.title = "colour of this series";
              dot.addEventListener("click", (e) => {
                e.stopPropagation();
                const open = head.querySelector(".vsl-sgpal");
                if (open) { open.remove(); return; }
                const pal = document.createElement("span");
                pal.className = "vsl-sgpal";
                SERIES_HUES.forEach((h, k) => {
                  if (RETIRED_HUES.has(k)) return;
                  const sw = document.createElement("i");
                  sw.style.background = h[0];
                  if ((Number(seriesLook(g).hue) || 0) === k) sw.className = "on";
                  sw.addEventListener("click", (ev) => {
                    ev.stopPropagation();
                    setSeriesLook(g, { hue: k });
                    paint();
                  });
                  pal.appendChild(sw);
                });
                dot.after(pal);
              });
              grp.appendChild(head);
              groupBody = document.createElement("div");
              groupBody.className = "vsl-sgbody";
              grp.appendChild(groupBody);
              elPrompts.appendChild(grp);
            }
            /* From a Series Book: named and renamed in the book, so there is
               no name to pin here and nothing to follow back to. */
            (groupBody || elPrompts).appendChild(tintPrompt(chip("c-n6", promptName(n), "", {
              pno: pnoEl(n),
              muted: chosen,
              title: "from the Series Book\n" + promptName(n) + "\n" + promptNote(n)
                + "click to put it in the recipe"
                + "\nrename it in the book",
              onClick: () => {
                state.draft.prompt = chosen ? 0 : n;
                paint();
              },
            }), n));
            continue;
          }
          /* A name typed here wins over the one on the node upstream, which is
             right - it was typed on purpose - but until now nothing said so.
             A chip that follows its node and a chip that has been fixed looked
             identical, and the way back (clear the name) was invisible. So a
             fixed name carries a dot, and its tooltip says what it is
             ignoring. */
          const src = promptSource(n);
          const upstream = (src && src.name) || "";
          const pinned = !!(state.promptNames && state.promptNames[n]);
          elPrompts.appendChild(chip("c-n6", promptName(n), "", {
            /* Following the node upstream is the ordinary state and wears no
               mark - a row of chips all carrying the same badge would say
               nothing. A name typed here has left that behind, so it carries
               a dot, and the dot is the way back: press it and the typed name
               is dropped and the node's own name takes over again. */
            badge: pinned ? {
              text: "\u25cf",
              title: upstream
                ? "name fixed here\nclick to follow \"" + upstream + "\" again"
                : "name fixed here\nclick to follow the node upstream again",
              onClick: () => {
                delete state.promptNames[n];
                if (state.promptNameSrc) delete state.promptNameSrc[n];
                writeStore();
                paint();
              },
            } : null,
            /* Dimmed once it is in the recipe, exactly like a LoRA: the
               shelf shows what is still available. */
            muted: chosen,
            title: "prompt" + n
              + (pinned
                ? "\nname fixed here"
                  + (upstream ? "\nthe node upstream is called \"" + upstream + "\"" : "")
                  + "\nclick the dot to follow that again"
                : "\nname follows the node upstream")
              + "\nclick to put it in the recipe"
              + "\nright click to rename it",
            onClick: () => {
              /* one prompt to a recipe: picking another swaps it */
              state.draft.prompt = chosen ? 0 : n;
              paint();
            },
            onContext: (ev) => openEditor(["name"], [""], null,
              [pinned ? state.promptNames[n] : ""], ev.currentTarget, (v) => {
                const t = String(v[0] || "").trim();
                if (!state.promptNameSrc) state.promptNameSrc = {};
                if (t) {
                  state.promptNames[n] = t;
                  const src = promptSource(n);
                  state.promptNameSrc[n] = src ? src.key : "";
                } else {
                  delete state.promptNames[n];
                  delete state.promptNameSrc[n];
                }
                writeStore();
                paint();
              },
              { placeholder: upstream || ("Prompt " + n),
                note: upstream
                  ? "Leave it empty to follow the node upstream (" + upstream + ")."
                  : "Leave it empty to follow the name of the node upstream." }),
          }));
        }

        elPool.innerHTML = "";
        if (!state.loras.length) {
          const e = document.createElement("div");
          e.className = "vsl-empty";
          e.innerHTML = "<b>No LoRAs yet</b>" +
            "Press <i>BROWSE</i> to pick from every LoRA on disk - folders, " +
            "pictures, favourites and all. What you pick stays on this shelf " +
            "for every workflow, and can be sorted into groups.";
          elPool.appendChild(e);
        }
        const loraChip = (l) => {
          const used = state.draft.loras.some((x) => x.name === l.name);
          const c = chip("c-lora", shortName(l.name), strengthText(l.strength), {
            muted: used,
            title: l.name + "\nclick to reserve, x to take off the shelf\ndrag into a group to sort it",
            onClick: () => addLoraToDraft(l),
            onRemove: () => {
              /* Off the shelf and out of everywhere it was going to be used:
                 the recipe being built and every row waiting in the queue.
                 Its trigger words follow on their own. A LoRA the loader
                 still has switched on comes back on the next scan, which is
                 the loader's business, not this node's. */
              dropLoraEverywhere(l.name);
            },
          });
          attachHoverPreview(c, l.name);
          if (!LSHELF.failed) {
            c.draggable = true;
            c.addEventListener("dragstart", (e) => {
              e.stopPropagation();
              e.dataTransfer.setData("text/x-vsl-lora", l.name);
              e.dataTransfer.effectAllowed = "move";
              setTimeout(() => elPool.classList.add("lgdrag"), 0);
            });
            c.addEventListener("dragend", () => {
              elPool.classList.remove("lgdrag", "over-loose");
              for (const g of elPool.querySelectorAll(".lgrp.over")) g.classList.remove("over");
            });
          }
          return c;
        };
        /* Groups: a LoRA sits in at most one. The ones in no group come
           first, where new picks land; the groups follow in the order they
           were made. */
        const groups = LSHELF.failed ? [] : LSHELF.groups;
        const home = new Map();
        for (const g of groups) for (const n of g.items) if (!home.has(n)) home.set(n, g.id);
        for (const l of state.loras) if (!home.has(l.name)) elPool.appendChild(loraChip(l));
        for (const g of groups) {
          const members = state.loras.filter((l) => home.get(l.name) === g.id);
          const box = document.createElement("div");
          box.className = "vsl-sgrp lgrp" + (g.shut ? " shut" : "");
          const head = document.createElement("div");
          head.className = "vsl-sghead";
          head.title = "click to fold · double click the name to rename";
          head.innerHTML = `<span class="tw">\u25BE</span><span class="nm"></span><span class="ct">${members.length}</span><span class="gx" title="Remove the group - its LoRAs stay on the shelf">x</span>`;
          head.querySelector(".nm").textContent = g.name;
          head.addEventListener("click", (e) => {
            e.stopPropagation();
            if (e.target.closest(".gx")) return;
            g.shut = !g.shut;
            lshelfSave(null);
          });
          const rename = (e) => {
            e.preventDefault(); e.stopPropagation();
            openEditor(["group name"], [""], null, [g.name], head, (v) => {
              const t = String(v[0] || "").trim();
              if (t) { g.name = t.slice(0, 80); lshelfSave(null); }
            }, { placeholder: "Group" });
          };
          head.querySelector(".nm").addEventListener("dblclick", rename);
          head.addEventListener("contextmenu", rename);
          const gx = head.querySelector(".gx");
          gx.addEventListener("click", (e) => {
            e.stopPropagation();
            /* the second click removes; the first only arms it */
            if (!gx.classList.contains("armed")) {
              gx.classList.add("armed");
              gx.title = "click again to remove the group";
              setTimeout(() => gx.classList.remove("armed"), 3000);
              return;
            }
            LSHELF.groups = LSHELF.groups.filter((x) => x !== g);
            lshelfSave(null);
          });
          const body = document.createElement("div");
          body.className = "vsl-sgbody";
          if (!members.length) {
            const em = document.createElement("span");
            em.className = "vsl-lgempty";
            em.textContent = "drag LoRAs here";
            body.appendChild(em);
          }
          for (const l of members) body.appendChild(loraChip(l));
          box.append(head, body);
          box.addEventListener("dragover", (e) => {
            if (!e.dataTransfer.types.includes("text/x-vsl-lora")) return;
            e.preventDefault(); e.stopPropagation();
            elPool.classList.remove("over-loose");
            box.classList.add("over");
          });
          box.addEventListener("dragleave", (e) => {
            if (!box.contains(e.relatedTarget)) box.classList.remove("over");
          });
          box.addEventListener("drop", (e) => {
            const n = e.dataTransfer.getData("text/x-vsl-lora");
            if (!n) return;
            e.preventDefault(); e.stopPropagation();
            moveLoraToGroup(n, g.id);
          });
          elPool.appendChild(box);
        }

        elOpts.innerHTML = "";
        if (!state.options.length) {
          const e = document.createElement("div");
          e.className = "vsl-empty";
          e.innerHTML = "<b>No options found</b>" +
            "These are the settings of the other nodes in this workflow - " +
            "sampler, scheduler, shift and the rest. Press <i>Refresh</i> " +
            "if the graph has changed since.";
          elOpts.appendChild(e);
        }
        /* The settings themselves are on screen, each with its own click.
           Hiding them behind a per-node popup read well but cost a click for
           every one, and the quick rhythm of tapping a setting straight into
           the recipe was what made this usable. Only the arrangement
           changes. */
        {
          const q = (state.optQuery || "").trim().toLowerCase();
          const groups = new Map();
          for (const o of state.options) {
            const blob = (o.title + " " + o.widget + " " + o.value)
              .toLowerCase();
            if (q && !blob.includes(q)) continue;
            if (!groups.has(o.title)) groups.set(o.title, []);
            groups.get(o.title).push(o);
          }

          const optChip = (o, inPod) => {
            const taken = state.draft.opts.some((x) => x.key === o.key);
            return chip(nodeColourClass(o.title), o.widget,
              String(o.value), {
                prefix: inPod ? "" : shortNodeName(o.title),
                muted: taken,
                title: o.title + " . " + o.widget + "\ncurrent: " + o.value,
                onClick: () => addOneToDraft(o),
              });
          };

          const view = OPT_VIEWS.includes(state.optView)
            ? state.optView : "flat";
          elOpts.className = "vsl-chips opts view-" + view + " vsl-scroll";
          if (view === "flat") {
            for (const [, list] of groups) {
              for (const o of list) elOpts.appendChild(optChip(o));
            }
          } else {
            for (const [title, list] of groups) {
              const cls = nodeColourClass(title);
              const box = document.createElement("div");
              box.className = (view === "pods" ? "vsl-pod" : "vsl-line") +
                " " + cls;
              const h = document.createElement("div");
              h.className = "gt";
              h.textContent = shortNodeName(title);
              h.title = title;
              const wrap = document.createElement("div");
              wrap.className = "gw";
              for (const o of list) wrap.appendChild(optChip(o, true));
              box.appendChild(h);
              box.appendChild(wrap);
              elOpts.appendChild(box);
            }
          }
          if (!elOpts.children.length && state.options.length) {
            const e = document.createElement("div");
            e.className = "vsl-empty";
            e.textContent = "nothing matched that search";
            elOpts.appendChild(e);
          }
        }

        elTrig.innerHTML = "";
        elTPos.textContent = state.trigPos;
        elTPos.classList.toggle("go", state.trigPos !== "off");
        {
          /* Every LoRA that has a part to play: the recipe being built and
             the ones already queued. Reading only the recipe meant the
             words vanished the moment a recipe was added, even though those
             LoRAs were the ones about to render. */
          const seenLora = new Set();
          const sources = [];
          for (const l of state.draft.loras) {
            if (seenLora.has(l.name)) continue;
            seenLora.add(l.name);
            sources.push({ name: l.name, queued: false });
          }
          for (const row of state.queue) {
            for (const l of rowLoras(row)) {
              if (seenLora.has(l.name)) continue;
              seenLora.add(l.name);
              sources.push({ name: l.name, queued: true });
            }
          }

          /* This box lists every word the recipe and the queue know
             about, which reads as though all of them go out with every
             render. They do not: a render only carries the words of the
             LoRAs in its own row. While one is on the way, those are lit and
             the rest are dimmed, so the box shows what is actually being
             sent rather than what could be. */
          const liveWords = new Set();
          if (state.live.index >= 0 && Array.isArray(state.live.trig)) {
            for (const w of state.live.trig) liveWords.add(w);
          } else if (state.live.index >= 0) {
            for (const n of state.live.files || []) {
              for (const w of state.triggers[n] || []) {
                liveWords.add(w.toLowerCase());
              }
            }
          }
          const showingLive = liveWords.size > 0 && state.trigPos !== "off";
          if (elTHint) {
            elTHint.innerHTML = (showingLive ? "lit ones go out now &middot; " : "") +
              "<em>click</em> on / off &middot; <em>right click</em> or <em>drag</em> to the row below";
          }
          if (elTVar) elTVar.innerHTML = "";
          let anyVar = false;

          const seenWord = new Set();
          let any = false;
          for (const src of sources) {
            loadTriggers(src.name);
            for (const w of state.triggers[src.name] || []) {
              const k = w.toLowerCase();
              if (seenWord.has(k)) continue;
              seenWord.add(k);
              any = true;
              const vary = isVar(k);
              if (vary) anyVar = true;
              const off = !!state.trigOff[k] || state.trigPos === "off";
              const inThisRender = showingLive && liveWords.has(k);
              (vary && elTVar ? elTVar : elTrig).appendChild(chip("c-text" + (vary ? " var" : ""), w, "", {
                /* the per-recipe row shows each word's default, not a render */
                /* The switch is always what is drawn, so a click while a run
                   is going shows at once. During a run the words that go out
                   are lit gold - the next render's, as the switches now stand. */
                muted: off,
                live: !vary && showingLive && !off,
                title: shortName(src.name) +
                  (src.queued ? "  (queued)" : "  (in the recipe)") +
                  (showingLive
                    ? (inThisRender ? "  -  in this render"
                                    : "  -  not in this render")
                    : ""),
                onClick: () => {
                  /* In the per-recipe row this is the word's default: what a
                     new recipe starts with. The recipes already made keep
                     what they had - only the next ones follow. */
                  if (vary) { freezeVar(k); followDefault(k); }
                  if (state.trigOff[k]) delete state.trigOff[k];
                  else state.trigOff[k] = true;
                  writeStore();
                  paint();
                },
                onContext: () => moveWord(k),
              }));
              const ch = (vary && elTVar ? elTVar : elTrig).lastChild;
              ch.draggable = true;
              ch.addEventListener("dragstart", (e) => {
                dragTrig = k;
                ch.classList.add("dragging");
                try { e.dataTransfer.setData("text/plain", w); } catch (err) { }
                e.dataTransfer.effectAllowed = "move";
              });
              ch.addEventListener("dragend", () => {
                dragTrig = null;
                ch.classList.remove("dragging");
                for (const z of trigZones()) z.classList.remove("over");
              });
            }
          }
          if (elTVar && !anyVar) {
            const e = document.createElement("span");
            e.className = "tvh";
            e.innerHTML = "<em>right click</em> or <em>drag</em> a word here - each recipe in the queue then turns it on or off for itself";
            elTVar.appendChild(e);
          }
          if (!any) {
            const e = document.createElement("div");
            e.className = "vsl-empty";
            e.textContent = sources.length
              ? "no trigger words filed beside these LoRAs"
              : "reserve or queue a LoRA to see its trigger words";
            elTrig.appendChild(e);
          }
        }

        elDraft.innerHTML = "";
        if (!state.draft.loras.length && !state.draft.opts.length) {
          const e = document.createElement("div");
          e.className = "vsl-empty";
          e.innerHTML = "<b>Nothing in the recipe yet</b>" +
            "Click a <i>prompt</i>, then any <i>LoRAs</i> and <i>options</i> " +
            "on the shelves above to bring them down here.<br>" +
            "A recipe renders one prompt, so one is required.<br>" +
            "Press <i>+ ADD TO QUEUE</i> and the recipe stays as it is - " +
            "change one thing, add it again, and you have a series. " +
            "<i>CLEAR</i> empties it.";
          elDraft.appendChild(e);
        }
        /* Everything in the recipe goes into one bundle, laid out in the order
           it will be read: prompt, then LoRAs, then options. It is drawn as a
           pod because that is what a pod already means here - a container
           with things in it - and because the bundle is what will be dragged
           into the queue box, so it has to look like one object. */
        const bundle = document.createElement("div");
        bundle.className = "vsl-pod recipe c-n3";
        const bhead = document.createElement("div");
        bhead.className = "gt";
        bhead.textContent = "RECIPE";
        {
          const tvw = document.createElement("span");
          tvw.className = "tvw";
          trigSwitches(state.draft, tvw);
          if (tvw.childNodes.length) bhead.appendChild(tvw);
        }
        const bwrap = document.createElement("div");
        bwrap.className = "gw";
        bundle.appendChild(bhead);
        bundle.appendChild(bwrap);
        const hasAny = state.draft.loras.length || state.draft.opts.length ||
          Number(state.draft.prompt) > 0;
        /* an empty recipe stays empty - the warning belongs to a recipe that
           has something in it and cannot go anywhere */
        if (hasAny) elDraft.appendChild(bundle);

        /* First in the bundle, because it is the first thing read: which
           prompt this recipe is for.

           The queued rows already say "no prompt" in red when their wire is
           gone; the recipe being built said nothing and went on showing the
           name of a prompt that is no longer connected. Same warning here, so
           the two halves of the panel agree with each other. */
        /* Not simply !runnable: a recipe with nothing picked yet is fine,
           because ADD TO QUEUE takes the first wired prompt for it. The two
           cases that really cannot go anywhere are a picked prompt whose wire
           has since gone, and no wire anywhere at all. */
        const pickedGone = Number(state.draft.prompt) > 0 && !runnable(state.draft);
        if (pickedGone || !promptSlots().length) {
          const warn = chip("c-cr", "no prompt", "", {
            title: promptSlots().length
              ? "The prompt this recipe used is no longer connected. Click to choose another."
              : "Nothing is wired to prompt1, so there is no text to render.",
            onClick: (ev) => openPromptPicker(state.draft, ev.currentTarget),
          });
          warn.classList.add("nogo");
          bwrap.appendChild(warn);
          /* the stale name is not shown beside the warning - two chips saying
             different things is worse than one */
        } else if (Number(state.draft.prompt) > 0) {
          bwrap.appendChild(tintPrompt(chip("c-n6", promptName(state.draft.prompt), "", {
            pno: pnoEl(state.draft.prompt),
            title: promptName(state.draft.prompt) + "\n" + promptNote(state.draft.prompt) + "the prompt this recipe uses\nclick to swap it",
            onClick: (ev) => openPromptPicker(state.draft, ev.currentTarget),
            onRemove: () => { state.draft.prompt = 0; state.draft.sweep = null; paint(); },
          }), state.draft.prompt));
          const fc = frameChip(state.draft);
          if (fc) bwrap.appendChild(fc);
          const sc = sweepChip(state.draft);
          if (sc) bwrap.appendChild(sc);
        }

        for (const l of state.draft.loras) {
          const lchip = chip("c-lora", shortName(l.name), strengthText(l.strength), {
            title: l.name + "\nclick to change strength, drag to reorder",
            onClick: (e) => openEditor(["strength"], [1], null, [l.strength],
              e.currentTarget, (v) => {
                l.strength = Number(v[0]) || 0;
                paint();
              }),
            onRemove: () => {
              state.draft.loras = state.draft.loras.filter((x) => x !== l);
              paint();
            },
          });
          attachHoverPreview(lchip, l.name);
          makeSortable(lchip, state.draft.loras, l);
          bwrap.appendChild(lchip);
        }
        const dgroups = new Map();
        for (const o of state.draft.opts) {
          if (!dgroups.has(o.title)) dgroups.set(o.title, []);
          dgroups.get(o.title).push(o);
        }
        for (const [title, list] of dgroups) {
          for (const o of list) {
            const gchip = chip(nodeColourClass(title), o.widget,
              fmtOptVals(o, " / "), {
                prefix: shortNodeName(title),
                title: title + " . " + o.widget +
                  "\nclick to set its values, drag to reorder",
                onClick: (e) => openGroupEditor(title, list, e.currentTarget),
                onRemove: () => {
                  state.draft.opts = state.draft.opts.filter((x) => x !== o);
                  paint();
                },
              });
            makeGroupSortable(gchip, title, [...dgroups.keys()]);
            bwrap.appendChild(gchip);
          }
        }
        bwrap.appendChild(chip("c-other", "images each",
          String(state.draft.repeat), {
            title: "how many images per combination",
            onClick: (e) => openEditor(["images"], [4], null,
              [state.draft.repeat], e.currentTarget, (v) => {
                state.draft.repeat = Math.max(1, Math.round(Number(v[0]) || 1));
                paint();
              }),
          }));
        const dTotal = rowTotal({ opts: state.draft.opts,
                                  repeat: state.draft.repeat,
                                  sweep: sweepOf(state.draft) });
        if (hasAny) {
          const bct = document.createElement("span");
          bct.className = "ct";
          bct.textContent = dTotal + (dTotal === 1 ? " render" : " renders");
          bhead.appendChild(bct);
        }

        elBench.innerHTML = "";
        elBox.innerHTML = "";
        if (!state.queue.length) {
          const e = document.createElement("div");
          e.className = "vsl-empty";
          e.innerHTML = "<b>Nothing queued yet</b>" +
            "<i>1.</i> Build a recipe on the left and press " +
            "<i>+ ADD TO QUEUE</i>. It lands here, on the <i>bench</i>.<br>" +
            "<i>2.</i> <b>Drag it down into the QUEUE BOX.</b> Only what is " +
            "in the box renders, from the bottom up.<br>" +
            "<i>3.</i> Press <i>RUN ALL</i>.<br><br>" +
            "Everything stays live while it runs: drag recipes in or out, " +
            "reorder them, change how many images one gets - the counts " +
            "follow at once and nothing already rendered is repeated. " +
            "A recipe that finishes goes back to the bench marked done.<br><br>" +
            "An option given several values sweeps them: two samplers render " +
            "twice, once with each.";
          elBench.appendChild(e);
        }
        /* Only what is in the box counts towards the render being shown, so
           the walk that works out "which recipe is on screen right now" runs
           over the staged ones in their own order. */
        let seen = 0;
        const stagedOrder = stagedRows();
        state.queue.forEach((row, i) => {
          const n = rowTotal(row);
          const staged = isStaged(row);
          /* Where this recipe sits in the run, so it can say how far through
             it is on its own rather than only through the panel total. */
          const doneHere = Math.min(sentOf(row), n);
          /* A recipe that has run keeps its badge after it leaves the box:
             on the bench "done" is what tells it apart from one that has
             never been near a render, and a part-finished one shows where it
             got to. */
          /* "done" is for a recipe that has left the box - which happens
             once its last picture has really come back. While it is still in
             there its badge counts the image being made. */
          const finished = n > 0 && !staged && doneOf(row) >= n;
          /* The one being worked on is the first staged recipe with anything
             left. Read straight from the tallies, so dragging a recipe in or
             out moves the marker at once. */
          const isNow = staged && !finished && state.running &&
            stagedOrder.find((r) => doneOf(r) < rowTotal(r)) === row;
          seen += n;
          const el = document.createElement("div");
          el.className = "vsl-pod rowpod c-n3" + (isNow ? " now" : "");
          const head = document.createElement("div");
          head.className = "gt";
          const idx = document.createElement("span");
          idx.className = "n";
          idx.textContent = String(Number(row.no) || (i + 1));
          const body = document.createElement("div");
          body.className = "body gw";
          healMain(row);
          if (!promptSlots().includes(Number(row.prompt) || 0)) {
            const warn = chip("c-cr", "no prompt", "", {
              title: "This recipe has no prompt, so it cannot render. " +
                "Click to choose one.",
              onClick: (ev) => openPromptPicker(row, ev.currentTarget),
            });
            warn.classList.add("nogo");
            body.appendChild(warn);
            /* and nothing else: the stale name beside the warning is two chips
               saying different things, which is worse than one */
          } else if (Number(row.prompt) > 0) {
            /* No x on a queued recipe: taking the prompt out would leave it
               unable to render, which is never the intention once it is in
               the queue. It can still be swapped for another. */
            const bps = bodyPrompts(row);
            const main = Number(row.prompt);
            /* the recipe's own prompt, unless it was moved into the sweep -
               and back on show whenever the sweep is off and the body would
               otherwise have no prompt at all, since that is what renders */
            if (bps.includes(main) || (!swOn(row) && !bps.length)) {
              const mc = tintPrompt(chip("c-n6", promptName(row.prompt), "", {
                pno: pnoEl(row.prompt),
                title: promptName(row.prompt) + "\n" + promptNote(row.prompt) + "the prompt this recipe uses\nclick to swap it\ndrag into the sweep to render it in turn with others",
                onClick: (ev) => openPromptPicker(row, ev.currentTarget),
              }), row.prompt);
              makeSwDraggable(mc, row, "prompt", main, "body");
              body.appendChild(mc);
            }
            const fc = frameChip(row);
            if (fc) body.appendChild(fc);
            const sc = sweepChip(row);
            if (sc) body.appendChild(sc);
            /* prompts added beside it - each rendered in turn */
            for (const n of bps.filter((x) => x !== main)) {
              const pc = tintPrompt(chip("c-n6", promptName(n), "", {
                pno: pnoEl(n),
                title: promptName(n) + "\nrendered in turn after the one before it\nclick to swap it - drag into the sweep",
                onClick: (ev) => openPromptPicker({
                  get prompt() { return n; },
                  set prompt(v) { row.prompts = (row.prompts || []).map((x) => Number(x) === n ? Number(v) : x); },
                  sweep: null,
                }, ev.currentTarget),
                onRemove: () => {
                  row.prompts = (row.prompts || []).filter((x) => Number(x) !== n);
                  writeStore(); paint();
                },
              }), n);
              if (!promptSlots().includes(n)) pc.classList.add("nogo");
              makeSwDraggable(pc, row, "prompt", n, "body");
              body.appendChild(pc);
            }
          }
          for (const l of row.loras || []) {
            /* Draggable here too. The order decides the file name and which
               LoRA counts as "the first one", so it has to be changeable
               after a recipe is queued, not only while it is being built. */
            const qchip = chip("c-lora", shortName(l.name), strengthText(l.strength), {
              title: l.name + "\nclick to swap this LoRA - the strength stays" +
                "\nright click to change its strength",
              onClick: (ev) => openLoraPicker(row, l, ev.currentTarget),
              onContext: (ev) => openEditor(["strength"], [1], null,
                [l.strength], ev.currentTarget, (v) => {
                  l.strength = Number(v[0]) || 0;
                  writeStore();
                  paint();
                }),
              onRemove: () => {
                row.loras = (row.loras || []).filter((x) => x !== l);
                writeStore();
                paint();
              },
            });
            /* The queue is the box that stays open. The shelf and the recipe
               have shown a preview on hover since they were built, and this
               one - the one actually being read all day - was the only place
               a LoRA was just a name. */
            /* a LoRA the shelf does not hold - one sent from a picture made
               with another loader - says so, and a click swaps it */
            if (!loraFileThere(l.name)) {
              qchip.classList.add("nogo", "nofile");
              qchip.title = l.name + "\nits file is not in the loras folder - this recipe will not run" +
                "\nclick to swap it for one on the shelf - the strength stays";
            } else if (!(state.loras || []).some((x) => x.name === l.name)) {
              qchip.classList.add("nogo");
              qchip.title = l.name + "\nnot on the LoRA shelf - its file is there, so it renders" +
                "\nclick to swap it for one on the shelf - the strength stays";
            }
            attachHoverPreview(qchip, l.name);
            makeSortable(qchip, row.loras, l);
            makeSwDraggable(qchip, row, "lora", l, "body");
            body.appendChild(qchip);
          }
          const rg = new Map();
          for (const o of row.opts || []) {
            if (!rg.has(o.title)) rg.set(o.title, []);
            rg.get(o.title).push(o);
          }
          for (const [title, list] of rg) {
            for (const o of list) {
            const oc = chip(nodeColourClass(title), o.widget,
              fmtOptVals({ ...o, values: o.values || [] }, " / "), {
                prefix: shortNodeName(title),
                title: title + " . " + o.widget + "\nclick to edit this recipe\ndrag into the sweep to apply it on its own",
                onClick: (ev) => openGroupEditor(title, list, ev.currentTarget,
                  writeStore),
                onRemove: () => {
                  row.opts = (row.opts || []).filter((x) => x !== o);
                  writeStore();
                  paint();
                },
              });
            makeSwDraggable(oc, row, "opt", o, "body");
            body.appendChild(oc);
            }
          }
          const ct = document.createElement("button");
          ct.className = "vsl-btn rb";
          ct.title = `${row.repeat || 1} images per combination - ` +
                     `${n} renders in this recipe`;
          ct.textContent = "x" + (row.repeat || 1);
          ct.addEventListener("click", (ev) => {
            openEditor(["images each"], [4], null, [row.repeat || 1],
              ev.currentTarget, (v) => {
                row.repeat = Math.max(1, Math.round(Number(v[0]) || 1));
                writeStore();
                paint();
              });
          });
          /* Short labels, coloured by what they do. The row is where the eye
             goes to read the recipe, so the buttons beside it should be
             recognisable without being read - and every one of them says what
             it does on hover, since a single letter cannot. */
          const rowBtn = (icon, cls, title, fn) => {
            const b = document.createElement("button");
            b.className = "vsl-btn ib" + (cls ? " " + cls : "");
            b.innerHTML = icon;
            b.title = title;
            b.setAttribute("aria-label", title);
            b.addEventListener("click", (ev) => {
              ev.stopPropagation();
              fn(ev);
            });
            return b;
          };

          const less = rowBtn(RICON_LESS, "step", "One image fewer per combination",
            () => {
              row.repeat = Math.max(1, (Number(row.repeat) || 1) - 1);
              writeStore();
              paint();
            });
          const more = rowBtn(RICON_MORE, "step", "One image more per combination", () => {
            row.repeat = Math.min(999, (Number(row.repeat) || 1) + 1);
            writeStore();
            paint();
          });

          const addL = rowBtn(RICON_LORA, "b-lora", "Add another LoRA to this recipe",
            (ev) => openLoraPicker(row, null, ev.currentTarget));
          const addO = rowBtn(RICON_OPT, "b-opt", "Add an option to this recipe",
            (ev) => openOptionPicker(row, ev.currentTarget));
          /* Another prompt beside the recipe's own. Prompts cannot be laid
             over each other, so every one on the recipe renders in turn. */
          const addP = rowBtn(RICON_PROMPT, "b-prompt",
            "Add another prompt - each prompt renders in turn",
            (ev) => openPromptPicker({
              get prompt() { return 0; },
              set prompt(n) {
                n = Number(n);
                if (n > 0 && n !== Number(row.prompt) &&
                    !(row.prompts || []).map(Number).includes(n)) {
                  row.prompts = (row.prompts || []).concat([n]);
                }
              },
              sweep: null,
            }, ev.currentTarget));
          const swc = swCount(row);
          const swBtn = rowBtn(RICON_SWEEP,
            "b-sweep" + (swOn(row) ? " on" : "") + (swc ? " has" : ""),
            swOn(row)
              ? "Sweep on - click to pause it (what is in it is kept)"
              : swc ? "Sweep paused with " + swc + " in it - click to run it again"
                : "Open the sweep - or just drag a chip down onto the recipe",
            () => {
              const sw = swEnsure(row);
              sw.on = !sw.on;
              writeStore();
              paint();
            });
          const dup = rowBtn(RICON_COPY, "b-copy",
            "Copy this recipe - the copy is placed right below", () => {
              const c = JSON.parse(JSON.stringify(row));
              c.id = "r" + Date.now().toString(36);
              c.no = nextNumber();
              delete c.staged;
              c.staged = row.staged === true;
              state.queue.splice(i + 1, 0, c);
              writeStore();
              paint();
            });
          /* this recipe's own progress back to nothing - the others keep theirs */
          const rst = (doneHere > 0 || finished) && !isNow
            ? rowBtn(RICON_RESET, "b-reset", "Start this recipe over - its count goes back to 0, the other recipes keep theirs",
              () => {
                delete state.done[row.id];
                delete state.sent[row.id];
                writeStore();
                paint();
              })
            : null;
          const del = rowBtn(RICON_DEL, "b-del", "Remove this recipe from the queue",
            () => {
              state.queue.splice(i, 1);
              writeStore();
              paint();
            });
          el.__vslRow = row;
          makeRowDraggable(el, row);
          makePodTakeBack(el, row);
          if (swOn(row)) el.classList.add("swon");
          /* folded: only the title row, with what the recipe renders written
             in it, so a box of several recipes fits without a scroll bar */
          if (row.shut) el.classList.add("shut");
          const fold = () => { row.shut = !row.shut; writeStore(); paint(); };
          const tw = document.createElement("span");
          tw.className = "tw";
          tw.textContent = row.shut ? "\u25B8" : "\u25BE";
          tw.title = row.shut ? "Open this recipe" : "Fold this recipe to its title row";
          for (const x of [tw, idx]) {
            x.addEventListener("click", (e) => { e.stopPropagation(); fold(); });
            x.addEventListener("pointerdown", (e) => e.stopPropagation());
          }
          idx.title = "Recipe " + idx.textContent + " - click to " + (row.shut ? "open it" : "fold it");
          head.appendChild(tw);
          head.appendChild(idx);
          if (row.shut) {
            const sum = document.createElement("span");
            sum.className = "sum";
            const pn = Number(row.prompt) > 0 ? promptName(row.prompt) : "no prompt";
            const ls = rowLoras(row).map((l) => shortName(l.name));
            const swn = swOn(row) ? swCount(row) : 0;
            const sb = document.createElement("b");
            sb.textContent = pn;
            sum.appendChild(sb);
            if (ls.length) {
              sum.appendChild(document.createTextNode(" \u00B7 "));
              const si = document.createElement("i");
              si.textContent = ls.join(" \u00B7 ");
              sum.appendChild(si);
            }
            if (swn) sum.appendChild(document.createTextNode(" \u00B7 sweep " + swn));
            sum.title = pn + (ls.length ? "\n" + ls.join(", ") : "");
            head.appendChild(sum);
          }
          if (isNow || finished || doneHere > 0) {
            const prog = document.createElement("span");
            prog.className = "prog" + (finished ? " done" : "");
            prog.textContent = finished
              ? "done"
              : doneHere + " / " + n;
            prog.title = finished
              ? "every render in this recipe is finished"
              : `on render ${doneHere} of ${n} in this recipe`;
            head.appendChild(prog);
          }
          /* the per-recipe trigger words, switched here for this recipe */
          const tvw = document.createElement("span");
          tvw.className = "tvw";
          trigSwitches(row, tvw);
          if (tvw.childNodes.length) head.appendChild(tvw);
          const sp = document.createElement("span");
          sp.className = "sp";
          sp.style.flex = "1";
          if (!row.shut) head.appendChild(sp);       // folded, the summary takes the room
          head.appendChild(less);
          head.appendChild(ct);
          head.appendChild(more);
          const rsep = document.createElement("span");
          rsep.className = "rsep";
          head.appendChild(rsep);
          head.appendChild(addP);
          head.appendChild(addL);
          head.appendChild(addO);
          head.appendChild(swBtn);
          if (rst) head.appendChild(rst);
          head.appendChild(dup);
          head.appendChild(del);
          el.appendChild(head);
          el.appendChild(body);
          el.appendChild(sweepArea(row));
          (staged ? elBox : elBench).appendChild(el);
        });
        for (const b of root.querySelectorAll(".vsl-foldall")) {
          const rows = (state.queue || []).filter((r) => (b.dataset.fold === "box") === isStaged(r));
          b.style.display = rows.length ? "" : "none";
          b.textContent = rows.length && rows.every((r) => r.shut) ? "Open all" : "Fold all";
        }
        elBenchCt.textContent = (() => {
          const rows = (state.queue || []).filter((r) => !isStaged(r));
          return rows.length ? rows.length + " waiting" : "";
        })();
        elBoxCt.textContent = stagedOrder.length
          ? stagedOrder.length + " staged - " + queueTotal(stagedOrder) + " renders"
          : "empty";

        const total = queueTotal(stagedRows());
        const live = state.live;
        elInfo.innerHTML = "";
        elInfo.className = "vsl-info counts info";
        /* Plain text. These four numbers sit under a queue already full of
           bundles and chips; giving them borders too made the panel read as
           nothing but rounded boxes. */
        const add = (label, value, cls) => {
          const s = document.createElement("span");
          s.className = "stat" + (cls ? " " + cls : "");
          s.appendChild(document.createTextNode(label + " "));
          const v = document.createElement("b");
          v.textContent = String(value);
          s.appendChild(v);
          elInfo.appendChild(s);
          return s;
        };
        /* What is going to run, like every other number on this line. The
           ones on the bench are counted beside the bench. */
        const doneNow = atCount();
        add("recipes", stagedOrder.length);
        add("renders", total);
        const sentNow = (state.queue || []).some((r) => sentOf(r) > 0);
        if (doneNow > 0 || sentNow || state.running) {
          add("at", Math.min(doneNow, total) + " / " + total, "live");
          add("left", Math.max(0, total - doneNow), "left");
        }
        /* Only while it is true: the moment RUN ALL is pressed, or the queue
           runs out, there is nothing to warn about. */
        if (elTip) {
          const show = state.tipRunAll && !state.running && runRemaining() > 0;
          elTip.hidden = !show;
          if (show) {
            elTip.textContent = "That was one render. The other " +
              runRemaining() + " in the queue box are waiting - press RUN ALL " +
              "to render them all.";
          }
        }
        elFill.style.width = live.total
          ? Math.round(((live.index + 1) / live.total) * 100) + "%" : "0";
        const left = runRemaining();
        /* The mark says which of the three it is before the word does, the way
           the queue button above the canvas does. Pause is the only one that
           is not a triangle, which is the whole point of drawing it. */
        const label = state.running
          ? (state.paused ? "RESUME (" + left + ")" : "PAUSE (" + left + ")")
          : (left ? "RUN ALL (" + left + ")" : "RUN ALL");
        elRunAll.innerHTML =
          (state.running && !state.paused ? ICON_PAUSE : ICON_PLAY) +
          "<span>" + label + "</span>";
        elRunAll.classList.toggle("paused", state.running && state.paused);

        elHeroes.innerHTML = "";
        if (!live.files.length) {
          const e = document.createElement("div");
          e.className = "vsl-empty";
          e.textContent = live.status || "not running";
          elHeroes.appendChild(e);
        }
        for (const f of live.files) {
          const box = document.createElement("div");
          box.className = "vsl-hero";
          const src = state.thumbs[f] || state.thumbs[shortName(f)];
          const pic = document.createElement(src ? "img" : "div");
          pic.className = "pic" + (src ? "" : " none");
          if (src) pic.src = src; else pic.textContent = "no preview";
          const cap = document.createElement("div");
          cap.className = "cap";
          cap.textContent = shortName(f);
          cap.title = f;
          box.appendChild(pic);
          box.appendChild(cap);
          elHeroes.appendChild(box);
        }
        elNowChips.innerHTML = "";
        for (const c of live.chips || []) {
          elNowChips.appendChild(chip("c-other", c.label,
            c.value, {
              muted: !c.explicit,
              title: c.explicit ? "from the recipe" : "fallback value",
            }));
        }
        elNote.textContent = [live.status, state.note]
          .filter(Boolean).join("   -   ");
        const preview = live.filename || (() => {
          const r = expandQueue();
          return r.length ? r[0].filename : "";
        })();
        elFname.textContent = preview || "nothing queued yet";
        elWarn.textContent = state.warn || "";
        elWarn.style.display = state.warn ? "block" : "none";

        applyHeights();
        applyBenchSplit();
        fit();
        persist();
      }

      /* --- height ---
         One number is stored: how tall the whole widget is. Everything
         inside divides that space with CSS. Nothing here adds up panel
         heights, measures the DOM, or reads the node size, so content
         appearing or disappearing cannot change how tall the node is - only
         the person dragging it can. The panels that carry a stored height
         keep it; the flexible one takes whatever is left over. */
      const H_MIN = 200, H_MAX = 2000;
      const H_DEFAULT = 470;   // one number, so the two readers cannot drift
      const STORED = ["prompts", "pool", "trig", "opts", "queue"];
      const DEF_H = { prompts: 46, pool: 118, trig: 48, opts: 92, queue: 230 };
      const MIN_H = { prompts: 24, pool: 26, trig: 24, opts: 26, queue: 120 };
      const bodyOf = {};

      const ROOM = 138;   // left for the zones that carry no stored height
      const hOf = (k) => {
        const raw = state.heights[k] === undefined ? DEF_H[k] : state.heights[k];
        const ceiling = Math.max(MIN_H[k],
          (state.h || H_DEFAULT) - ROOM);
        return Math.min(Math.max(MIN_H[k], raw), ceiling);
      };

      function contentHeight() {
        return Math.min(H_MAX, Math.max(H_MIN, state.h || H_DEFAULT));
      }

      /* Everything the node needs besides the widget: title, slots, widgets.
         Measured against the floor the widget reports, so it is a constant. */
      function chromeOf() {
        try { return node.computeSize()[1] - H_MIN; } catch (e) { return 96; }
      }

      function applyHeights() {
        root.style.height = contentHeight() + "px";
        if (typeof applySplit === "function") applySplit();
        for (const k of STORED) {
          if (bodyOf[k]) bodyOf[k].style.height = hOf(k) + "px";
        }
      }

      let snapping = false, gripDragging = false;
      const beingResized = () => app.canvas && app.canvas.resizing_node === node;

      function fitNodeToContent() {
        try {
          node.setSize([Math.max(node.size[0], 720),
                        chromeOf() + contentHeight()]);
          node.setDirtyCanvas(true, true);
        } catch (e) { /* ignore */ }
      }

      /* Whatever the node was given beyond what it needs goes into the one
         stored number, and whatever was taken away comes out of it. */
      /* The node's height is the authority; the widget takes what is left
         after the chrome. Shrinking works because the widget only ever claims
         the floor as its minimum. */
      /* Every panel takes the same share of a height change as it already
         has of the widget, so growing the node grows all of them together
         rather than handing the lot to whichever one happens to be flexible.
         What the stored panels do not take is left over for the ones that
         carry no height of their own, which is their share. */
      function share(delta) {
        const before = contentHeight();
        if (!before) return;
        for (const k of STORED) {
          const h = hOf(k);
          const next = h + Math.round(delta * (h / before));
          state.heights[k] = Math.max(MIN_H[k], next);
        }
      }

      function absorb(nodeHeight) {
        const want = Math.min(H_MAX,
          Math.max(H_MIN, Math.round(nodeHeight - chromeOf())));
        const delta = want - contentHeight();
        if (Math.abs(delta) <= 1) return false;
        share(delta);
        state.h = want;
        applyHeights();
        return true;
      }

      function snapNode() {
        if (snapping || gripDragging || beingResized()) return;
        snapping = true;
        try {
          absorb(node.size[1]);
          const want = chromeOf() + contentHeight();
          if (Math.abs(node.size[1] - want) > 1) {
            node.setSize([Math.max(node.size[0], 720), want]);
            node.setDirtyCanvas(true, true);
          }
        } catch (e) { /* ignore */ } finally { snapping = false; }
      }

      /* Dragging the node's corner does not repaint the widget, so without
         this nothing tells the panels that more room arrived and the extra
         just sat at the bottom as dead space. */
      const prevOnResize = node.onResize;
      node.onResize = function (size) {
        if (prevOnResize) prevOnResize.apply(this, arguments);
        try { absorb(size[1]); } catch (e) { /* ignore */ }
      };

      /* change -> settle the node -> draw, in that order. */
      function fit() {
        snapNode();
        requestAnimationFrame(snapNode);
      }

      /* A grip grows its own panel and the widget with it. Held with shift it
         trades height with the panel below instead, leaving the node alone. */
      function addGrip(zone, key, below) {
        if (!zone) return;
        /* A stack counts as the body: the queue zone holds two lists inside
           one, and the grip has to size the pair, not whichever list happens
           to come first. */
        const body = zone.querySelector(".vsl-stack, .vsl-chips, .vsl-list");
        if (!body) return;
        bodyOf[key] = body;
        body.classList.add("vsl-scroll");
        const grip = document.createElement("div");
        grip.className = "vsl-grip";
        grip.title = "drag to resize, hold shift to trade with the panel below";
        zone.after(grip);
        grip.addEventListener("pointerdown", (e) => {
          e.stopPropagation();
          e.preventDefault();
          const y0 = e.clientY;
          const h0 = hOf(key);
          const hb0 = below ? hOf(below) : 0;
          const wh0 = contentHeight();
          gripDragging = true;
          const move = (ev) => {
            const d = ev.clientY - y0;
            if (ev.shiftKey) {
              /* the widget height is untouched, so the node cannot move.
                 With a stored panel below, the two trade; with the flexible
                 panel below, it simply gives up or takes the room. */
              if (below) {
                const room = h0 + hb0 - MIN_H[below];
                const h = Math.min(Math.max(MIN_H[key], h0 + d), room);
                state.heights[key] = h;
                state.heights[below] = h0 + hb0 - h;
              } else {
                state.heights[key] = Math.max(MIN_H[key], h0 + d);
              }
              applyHeights();
            } else {
              const h = Math.max(MIN_H[key], h0 + d);
              state.heights[key] = h;
              state.h = Math.min(H_MAX, Math.max(H_MIN, wh0 + (h - h0)));
              applyHeights();
              fitNodeToContent();
            }
          };
          const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            gripDragging = false;
            fitNodeToContent();
            paint();
          };
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", up);
        });
      }

      /* A short guide, not a manual: the things that cannot be worked out by
         looking at the node, and nothing else. Anything longer goes stale. */
      const HELP = `
        <h3>Visual Series Lab</h3>
        <p>Builds a list of recipes - a prompt, some LoRAs, some settings -
        and renders them one after another, so a whole series can be tried
        without rewiring the graph between shots.</p>

        <h5>Your first run</h5>
        <p>1. Wire a prompt into <code>prompt1</code> and click its chip -
        and a LoRA chip too, if you want one. 2. Press <code>+ ADD TO QUEUE</code>
        and drag the recipe from the bench into the orange QUEUE BOX.
        3. Press <code>RUN ALL</code>. Everything else here is for later.</p>

        <h5>The four shelves</h5>
        <p><b>Prompt Shelf</b> shows one chip per prompt wired into the node.
        Connect a text node to <code>prompt1</code> and a chip appears; the
        next socket opens as soon as that one is used, up to ten. A chip is
        named after whatever it is connected to - right click to rename it. A
        name you type is dropped again if you rewire that socket to something
        else, so a chip never keeps the old thing's name. A recipe renders one
        prompt: click a chip to say which, or leave it and the first one is
        used.</p>
        <p><b>LoRAs Shelf</b> holds whatever was picked in <b>BROWSE</b>, which
        reads every LoRA on disk with its folders and preview pictures. The
        tree folds - the arrow opens a branch, the name selects it - and a
        folder shows everything underneath it, not only what sits directly in
        it. Search looks at the file names first and falls back to the folders
        when nothing is named that; several words all have to match, and
        spaces, underscores and dashes count as the same thing.</p>
        <p><b>CLEAR ALL</b> asks first: the first press shows how many it will
        take off, and only a second press within a few seconds clears.</p>
        <p>The shelf is kept apart from the workflow, the same in every
        workflow and every Series Lab, so opening a series never empties it.
        <b>+ GROUP</b> adds a group; drag a LoRA onto a group to sort it, back
        onto the shelf to take it out. Click a group to fold it, double click
        its name to rename it, and press its x twice to remove it - its LoRAs
        stay on the shelf. The LoRA list of a queued recipe shows the same
        groups.</p>
        <p><b>Trigger words</b> are read from the LoRAs themselves. Click one
        to leave it out. While a render is on its way, the words actually
        going with it are lit and the rest are dimmed.</p>
        <p><b>Options Shelf</b> lists the widgets of every other node in the
        workflow. Nothing needs wiring: values are written onto those nodes
        for each render and put back afterwards.</p>

        <h5>Recipe</h5>
        <p>Click a prompt, then LoRAs and options, to bring them down here.
        One prompt per recipe, and it is required - a recipe without one
        cannot render.</p>
        <p><b>+ ADD TO QUEUE</b> leaves the recipe standing. Change one thing,
        add it again, and a series is built in a few clicks. <b>CLEAR</b>
        empties it.</p>

        <h5>Sweeping a setting</h5>
        <p>Give a setting more than one value and every one is rendered.
        Values multiply: two samplers, two strengths and four images each is
        <code>2 x 2 x 4 = 16</code> renders. Pick several from the list for a
        setting that has one, or separate numbers with commas.</p>

        <h5>Bench and Queue Box</h5>
        <p>A queued recipe lands on the <b>bench</b>, where it waits.
        <b>Drag it down into the QUEUE BOX</b> to have it rendered - only what
        is in the box runs, from the bottom upwards. Drag to reorder, or drag
        one back out to take it off the run.</p>
        <p>All of that works while a run is going. The counts follow every
        change at once, nothing already rendered is repeated, and a recipe
        that runs out goes back to the bench marked <code>done</code>. Put it
        in the box again and it starts over.</p>
        <p>Each recipe keeps the number it was given when it was made,
        wherever it is and whatever is deleted around it.</p>
        <p><b>x4</b> is how many images each combination gets; the buttons
        either side step it up and down, mid-run included. Past the line,
        the purple layer adds a LoRA and the orange sliders add an option to a
        recipe that is already queued, the two sheets copy it and the bin
        removes it.</p>

        <h5>Outputs</h5>
        <p><code>model</code> and <code>conditioning</code> carry the render.
        <code>this render's lora names</code> and <code>this render's prompt name</code>
        name what went into the picture on its way out - both are meant for a
        file manager node downstream. <code>status</code> says where the run
        has got to, and <code>filename</code> is a name describing the
        combination, holding no folder.</p>

        <h5>Keeping a queue</h5>
        <p>Everything - the shelves, the recipe, the queue and how far it has
        got - is saved with the workflow. <b>Export</b> writes the queue to a
        file and <b>Import</b> adds a file to what is already there, so two
        plans can be merged.</p>
        <p><b>RESET</b> forgets what has been rendered and puts every widget
        this node touched back the way it was found.</p>`;

      let helpBox = null;
      function closeHelp() {
        if (helpBox) { helpBox.remove(); helpBox = null; }
      }
      $(".help").addEventListener("click", (e) => {
        e.stopPropagation();
        if (helpBox) { closeHelp(); return; }
        const box = document.createElement("div");
        box.className = "vsl-help";
        box.innerHTML = HELP +
          '<div class="close"><button class="vsl-btn go hclose">Close</button></div>';
        const r = e.currentTarget.getBoundingClientRect();
        /* the button sits low, so open the panel above it when there is not
           enough room below */
        box.style.left = Math.max(8, Math.min(r.left - 240,
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
        ["keydown", "keyup", "keypress", "pointerdown"].forEach((k) =>
          box.addEventListener(k, (ev) => ev.stopPropagation()));
      });

      /* A folder tree with pictures, so a LoRA can be found by looking rather
         than by remembering its name. Picking one puts it straight into the
         recipe being built - the loader on the canvas is not involved. */
      /* Favourites are stored by the ComfyUI backend in favorites.json.
         localStorage is kept only as a migration/fallback path, so an old
         browser list is not lost when upgrading this node. */
      const FAV_KEY = "leiel.vsl.favorites";

      function readLocalFavs() {
        try {
          const v = JSON.parse(localStorage.getItem(FAV_KEY) || "[]");
          return Array.isArray(v) ? v : [];
        } catch (e) { return []; }
      }

      async function readFavs() {
        try {
          const r = await fetch("/visual_series_lab/favorites", { cache: "no-store" });
          if (r.ok) {
            const v = await r.json();
            if (Array.isArray(v)) return v;
          }
        } catch (e) { /* backend route unavailable; use legacy storage */ }
        return readLocalFavs();
      }

      /* Returns the list that actually got stored, not a success flag: the
         caller redraws from it, so a star on screen always reflects what is
         on disk rather than what was hoped for. */
      async function writeFavs(list) {
        const clean = [...new Set(list)];
        try {
          const r = await fetch("/visual_series_lab/favorites", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(clean),
          });
          if (r.ok) {
            const j = await r.json().catch(() => null);
            if (j && Array.isArray(j.favorites)) return j.favorites;
            return clean;
          }
        } catch (e) { /* use legacy storage below */ }
        try {
          localStorage.setItem(FAV_KEY, JSON.stringify(clean));
        } catch (e) { /* private mode */ }
        return clean;
      }

      let browser = null;
      function closeBrowser() {
        if (browser) { browser.remove(); browser = null; }
      }

      async function openBrowser() {
        closeBrowser();
        let list = [];
        for (const attempt of [() => fetch("/visual_series_lab/loras"),
                               () => api.fetchApi("/visual_series_lab/loras")]) {
          try {
            const r = await attempt();
            if (!r || !r.ok) continue;
            const j = await r.json();
            if (Array.isArray(j)) {
              list = j;
              /* the browser has just fetched every thumbnail path, so the
                 hover preview does not have to ask again */
              for (const it of j) {
                if (!it.thumbnail) continue;
                state.thumbs[it.full_name] = it.thumbnail;
                const bare = shortName(it.full_name);
                if (!(bare in state.thumbs)) state.thumbs[bare] = it.thumbnail;
              }
              break;
            }
          } catch (e) { /* try the next */ }
        }

        const ov = document.createElement("div");
        ov.className = "vsl-ov";
        ov.innerHTML = `
          <div class="vsl-br">
            <div class="hd">
              <b>Browse LoRAs</b>
              <input class="q" placeholder="Search names - several words all have to match">
              <button class="vsl-btn brbtn sortby" title="Sort order">A-Z</button>
              <span class="ct"></span>
              <button class="vsl-btn brbtn addsel">Add selected</button>
              <button class="vsl-btn brbtn addall">Add all shown</button>
              <button class="vsl-btn cls">Close</button>
            </div>
            <div class="bd">
              <div class="tree"></div>
              <div class="grid"></div>
            </div>
          </div>`;
        document.body.appendChild(ov);
        browser = ov;

        const treeEl = ov.querySelector(".tree");
        const gridEl = ov.querySelector(".grid");
        const qEl = ov.querySelector(".q");
        const ctEl = ov.querySelector(".ct");
        const sortEl = ov.querySelector(".sortby");
        /* Newest first is the other way people look for a LoRA: the one just
           downloaded, whose name is not remembered yet. */
        const SORTS = [
          { key: "name", label: "A-Z",
            cmp: (a, b) => a.full_name.localeCompare(b.full_name) },
          { key: "name-desc", label: "Z-A",
            cmp: (a, b) => b.full_name.localeCompare(a.full_name) },
          { key: "new", label: "Newest",
            cmp: (a, b) => (b.mtime || 0) - (a.mtime || 0) ||
                           a.full_name.localeCompare(b.full_name) },
          { key: "old", label: "Oldest",
            cmp: (a, b) => (a.mtime || 0) - (b.mtime || 0) ||
                           a.full_name.localeCompare(b.full_name) },
        ];
        let sortAt = Math.max(0, SORTS.findIndex(
          (x) => x.key === (state.brSort || "name")));
        sortEl.textContent = SORTS[sortAt].label;
        sortEl.addEventListener("click", (e) => {
          e.stopPropagation();
          sortAt = (sortAt + 1) % SORTS.length;
          state.brSort = SORTS[sortAt].key;
          sortEl.textContent = SORTS[sortAt].label;
          drawGrid();
        });
        /* Load the disk-backed list before the first draw. This also makes
           favourites survive browser-cache clearing and browser changes. */
        let favs = await readFavs();
        /* One-time migration for installations that already had favourites in
           the browser. If the disk list is empty, preserve the old list. */
        if (!favs.length) {
          const legacy = readLocalFavs();
          if (legacy.length) favs = await writeFavs(legacy);
        }
        let path = "";
        /* Ticking is separate from taking: a folder is skimmed, a few are
           picked out, and they all go over at once. */
        const chosen = new Set();

        const dirOf = (f) => {
          const parts = String(f).split("/");
          parts.pop();
          return parts.join("/");
        };

        /* Everything the installation actually has right now. A favourite
           outside this set is not gone, only unavailable - a drive left
           unplugged, a file renamed - so it is shown rather than dropped. */
        const installed = new Set(list.map((it) => it.full_name));
        const missingFavs = () => favs.filter((f) => !installed.has(f));

        /* ---- matching ----
           The old test was full_name.includes(q), and full_name carries the
           folders. Typing "krea" therefore matched all 231 files under krea2/
           rather than the five actually called Krea-something, so the grid
           barely changed and the search looked broken. It also meant a name
           written with underscores on disk could not be found by typing it the
           way the card spells it.

           So: separators are flattened, every word has to match, and the file
           name is tried before the path. Folder matches are the fallback for
           when nothing is named that - "leiel" still finds the folder's
           contents, "krea" now finds the five files. */
        const trNorm = (x) => String(x || "").toLowerCase()
          .replace(/\.(safetensors|ckpt|pt)$/i, "")
          .replace(/[\s_\-.]+/g, " ").trim();
        const trTerms = (q) => trNorm(q).split(" ").filter(Boolean);

        function matches(list_, q) {
          const terms = trTerms(q);
          if (!terms.length) return list_;
          const hits = (hay) => terms.every((t) => hay.includes(t));
          const byName = list_.filter((it) => hits(trNorm(it.name)));
          if (byName.length) return byName;
          return list_.filter((it) => hits(trNorm(it.full_name)));
        }

        /* Selecting a folder shows everything under it, not just the files
           sitting directly in it. krea2 with nothing of its own looked empty
           even though it holds hundreds. */
        const inFolderOf = (full) =>
          path === "" || full === path || String(full).startsWith(path + "/");

        const folders = new Set(["", "__fav__"]);
        for (const it of list) {
          const parts = String(it.full_name).split("/");
          let acc = "";
          for (let i = 0; i < parts.length - 1; i++) {
            acc = acc ? acc + "/" + parts[i] : parts[i];
            folders.add(acc);
          }
        }
        const folderList = [...folders].sort((a, b) =>
          a === "" ? -1 : b === "" ? 1 : a.localeCompare(b));

        /* Open folders. Only the top level starts open, so a tree with a
           hundred branches does not arrive already unrolled. */
        const open = new Set([""]);
        const parentOf = (f) => f.split("/").slice(0, -1).join("/");
        const hasKids = (f) => folderList.some((x) => parentOf(x) === f && x !== f);

        function visibleFolders() {
          return folderList.filter((f) => {
            if (f === "" || f === "__fav__") return true;
            /* every ancestor has to be open for a row to show */
            let up = parentOf(f);
            for (;;) {
              if (!open.has(up)) return false;
              if (up === "") return true;
              up = parentOf(up);
            }
          });
        }

        function drawTree() {
          treeEl.innerHTML = "";
          for (const f of visibleFolders()) {
            const el = document.createElement("div");
            el.className = "fd" + (f === path ? " on" : "");
            const depth = (f === "" || f === "__fav__") ? 0 : f.split("/").length - 1;
            el.style.paddingLeft = (7 + depth * 14) + "px";
            const kids = f !== "__fav__" && f !== "" && hasKids(f);
            const arrow = document.createElement("span");
            arrow.className = "tw" + (kids ? "" : " none")
              + (f === "__fav__" ? " star" : "");
            arrow.textContent = f === "__fav__"
              ? "\u2605"
              : kids ? (open.has(f) ? "\u25bc" : "\u25b6") : "";
            const label = document.createElement("span");
            label.textContent = f === ""
              ? "All"
              : f === "__fav__" ? "Favourites" : f.split("/").pop();
            el.appendChild(arrow);
            el.appendChild(label);
            /* the arrow folds, the name selects - one click should not have to
               mean both */
            arrow.addEventListener("click", (e) => {
              e.stopPropagation();
              if (!kids) return;
              if (open.has(f)) open.delete(f); else open.add(f);
              drawTree();
            });
            el.addEventListener("click", () => {
              path = f;
              if (kids) open.add(f);          // stepping in opens the branch
              drawTree(); drawGrid();
            });
            treeEl.appendChild(el);
          }
        }

        function drawGrid() {
          const q = qEl.value.trim().toLowerCase();
          gridEl.innerHTML = "";
          const inFolder = list.filter((it) => path === "__fav__"
            ? favs.includes(it.full_name)
            : inFolderOf(it.full_name));
          const shown = matches(inFolder, q).sort(SORTS[sortAt].cmp);
          const gone = path === "__fav__"
            ? matches(missingFavs().map((f) => ({ name: dirOf(f) ? f.split("/").pop() : f, full_name: f })), q)
                .map((x) => x.full_name)
            : [];
          ctEl.textContent = shown.length + " of " + list.length +
            (gone.length ? "   -   " + gone.length + " not installed" : "") +
            (chosen.size ? "   -   " + chosen.size + " selected" : "");
          const selBtn = ov.querySelector(".addsel");
          selBtn.textContent = chosen.size
            ? "Add selected (" + chosen.size + ")" : "Add selected";
          selBtn.classList.toggle("ready", chosen.size > 0);
          for (const it of shown) {
            const card = document.createElement("div");
            card.className = "cd";
            const fav = favs.includes(it.full_name);
            if (chosen.has(it.full_name)) card.classList.add("sel");
            card.innerHTML =
              `<button class="pk" title="select">${
                chosen.has(it.full_name) ? "\u2713" : ""}</button>` +
              `<button class="st" title="favourite">${fav ? "\u2605" : "\u2606"}</button>` +
              (it.thumbnail
                ? `<div class="th"><img loading="lazy" src="${it.thumbnail}"></div>`
                : `<div class="th none">no preview</div>`) +
              `<div class="ti">${it.name}</div>`;
            card.querySelector(".pk").addEventListener("click", (e) => {
              e.stopPropagation();
              if (chosen.has(it.full_name)) chosen.delete(it.full_name);
              else chosen.add(it.full_name);
              drawGrid();
            });
            card.querySelector(".st").addEventListener("click", async (e) => {
              e.stopPropagation();
              /* Draw once for the click, once for what the disk accepted. */
              favs = fav ? favs.filter((x) => x !== it.full_name)
                         : favs.concat([it.full_name]);
              drawGrid();
              favs = await writeFavs(favs);
              drawGrid();
            });
            card.addEventListener("click", () => {
              /* Onto the shelf, not into the recipe. Browsing is choosing
                 what is available; putting it in a recipe is a separate
                 decision, made by clicking the chip. */
              if (!state.picked.some((x) => x.name === it.full_name)) {
                state.picked.push({ name: it.full_name, strength: 1 });
              }
              closeBrowser();
              paint();
            });
            gridEl.appendChild(card);
          }
          /* Favourites with no file behind them, listed after the real ones.
             They cannot be ticked or put on the shelf, only un-starred: the
             list is the user's, so nothing leaves it without a click. */
          for (const name of gone) {
            const card = document.createElement("div");
            card.className = "cd miss";
            card.innerHTML =
              `<button class="st" title="remove from favourites">\u2605</button>` +
              `<div class="th gone">file not found<br>(drive offline or renamed)</div>` +
              `<div class="ti">${shortName(name)}</div>`;
            card.title = name;
            card.querySelector(".st").addEventListener("click", async (e) => {
              e.stopPropagation();
              favs = favs.filter((x) => x !== name);
              drawGrid();
              favs = await writeFavs(favs);
              drawGrid();
            });
            gridEl.appendChild(card);
          }
          if (!shown.length && !gone.length) {
            gridEl.innerHTML = `<div class="vsl-empty">nothing here</div>`;
          }
        }

        /* Whatever the folder and the search have narrowed things down to.
           Picking a favourites folder apart one card at a time is exactly the
           chore this is meant to remove. */
        function takeAll(names) {
          let added = 0;
          for (const n of names) {
            if (state.picked.some((x) => x.name === n)) continue;
            state.picked.push({ name: n, strength: 1 });
            added++;
          }
          closeBrowser();
          state.live.status = added
            ? "added " + added + " LoRAs to the shelf"
            : "those are all on the shelf already";
          paint();
        }

        ov.querySelector(".addsel").addEventListener("click", (e) => {
          e.stopPropagation();
          if (!chosen.size) {
            state.live.status = "tick a few cards first";
            paint();
            return;
          }
          takeAll([...chosen]);
        });

        ov.querySelector(".addall").addEventListener("click", (e) => {
          e.stopPropagation();
          const q2 = qEl.value;
          const shown = matches(list.filter((it) => path === "__fav__"
            ? favs.includes(it.full_name)
            : inFolderOf(it.full_name)), q2);
          takeAll(shown.map((it) => it.full_name));
        });

        qEl.addEventListener("input", drawGrid);
        ["keydown", "keyup", "keypress"].forEach((k) =>
          ov.addEventListener(k, (e) => e.stopPropagation()));
        ov.querySelector(".cls").addEventListener("click", closeBrowser);
        ov.addEventListener("mousedown", (e) => {
          if (e.target === ov) closeBrowser();
        });
        drawTree();
        drawGrid();
        qEl.focus();
      }

      /* ---- buttons ---- */
      elTPos.addEventListener("click", (e) => {
        e.stopPropagation();
        const order = ["prepend", "append", "off"];
        state.trigPos = order[(order.indexOf(state.trigPos) + 1) % order.length];
        paint();
      });
      $(".poolclear").addEventListener("click", (e) => {
        e.stopPropagation();
        /* Asked twice. The shelf is shared by every workflow now, so one
           stray press used to empty it everywhere at once. The first press
           only arms the button; a second within a few seconds clears. */
        const btn = e.currentTarget;
        if (!btn.classList.contains("armed")) {
          if (!state.loras.length) return;
          btn.classList.add("armed");
          btn.textContent = "CLEAR " + state.loras.length + "?";
          btn.title = "click again to take all " + state.loras.length + " LoRAs off the shelf";
          clearTimeout(btn._armT);
          btn._armT = setTimeout(() => {
            btn.classList.remove("armed");
            btn.textContent = "CLEAR ALL";
          }, 3500);
          return;
        }
        clearTimeout(btn._armT);
        btn.classList.remove("armed");
        btn.textContent = "CLEAR ALL";
        /* Clearing the shelf clears what the shelf was feeding, for the same
           reason one chip does. The groups stay, empty. */
        for (const l of state.loras.slice()) dropLoraEverywhere(l.name, true);
        state.picked = [];
        state.loras = [];
        writeStore();
        paint();
      });
      $(".browse").addEventListener("click", (e) => {
        e.stopPropagation();
        openBrowser();
      });
      /* A LoRA dropped on the shelf outside any group leaves its group. */
      function moveLoraToGroup(name, gid) {
        for (const g of LSHELF.groups) g.items = g.items.filter((x) => x !== name);
        const g = gid && LSHELF.groups.find((x) => x.id === gid);
        /* a folded group stays folded; its count says it went in */
        if (g) g.items.push(name);
        lshelfSave(null);
      }
      elPool.addEventListener("dragover", (e) => {
        if (!e.dataTransfer.types.includes("text/x-vsl-lora")) return;
        e.preventDefault();
        elPool.classList.add("over-loose");
      });
      elPool.addEventListener("dragleave", (e) => {
        if (!elPool.contains(e.relatedTarget)) elPool.classList.remove("over-loose");
      });
      elPool.addEventListener("drop", (e) => {
        const n = e.dataTransfer.getData("text/x-vsl-lora");
        elPool.classList.remove("over-loose", "lgdrag");
        if (!n) return;
        e.preventDefault();
        moveLoraToGroup(n, null);
      });
      $(".poolgroup").addEventListener("click", (e) => {
        e.stopPropagation();
        const btn = e.currentTarget;
        if (LSHELF.failed) {
          btn.title = "Groups need the server part of this update - restart ComfyUI once";
          btn.textContent = "RESTART COMFYUI";
          setTimeout(() => { btn.textContent = "+ GROUP"; }, 2600);
          return;
        }
        openEditor(["group name"], [""], null, ["Group " + (LSHELF.groups.length + 1)], btn, (v) => {
          const t = String(v[0] || "").trim() || ("Group " + (LSHELF.groups.length + 1));
          LSHELF.groups.push({ id: "g" + Date.now().toString(36), name: t.slice(0, 80), shut: false, items: [] });
          lshelfSave(null);
        }, { placeholder: "Group" });
      });

      /* The shelf from the server replaces the one the workflow carried. The
         very first time - no shelf file yet - the workflow's own shelf is
         what it starts from, so nothing picked before the update is lost. */
      const shelfSub = () => {
        state.picked = lshelfCopy(LSHELF.picked);
        if (!rescan()) paint();
      };
      function applyShelf() {
        if (!LSHELF.loaded || LSHELF.failed) return;
        node._vslShelfReady = true;
        if (!LSHELF.exists) {
          if (state.picked.length) {
            LSHELF.picked = lshelfCopy(state.picked);
            lshelfSave(shelfSub);
          }
          return;
        }
        state.picked = lshelfCopy(LSHELF.picked);
        if (!rescan()) paint();
      }
      node._vslShelfSub = shelfSub;
      LSHELF.subs.add(shelfSub);
      lshelfLoad().then(applyShelf);
      const OPT_ICON = { flat: "\u25A6", pods: "\u25A2", lines: "\u2261" };
      function paintOptView() {
        elOptView.innerHTML =
          `<span class="ic">${OPT_ICON[state.optView] || ""}</span>` +
          `<span>${state.optView}</span>`;
      }
      paintOptView();
      elOptView.addEventListener("click", (e) => {
        e.stopPropagation();
        const i = OPT_VIEWS.indexOf(state.optView);
        state.optView = OPT_VIEWS[(i + 1) % OPT_VIEWS.length];
        paintOptView();
        paint();
      });
      elOptQ.addEventListener("input", () => {
        state.optQuery = elOptQ.value;
        paint();
      });
      ["keydown", "keyup", "keypress"].forEach((k) =>
        elOptQ.addEventListener(k, (e) => e.stopPropagation()));

      $(".refresh").addEventListener("click", () => {
        state.options = [];
        refreshOptions();
      });
      $(".add").addEventListener("click", addToQueue);
      $(".drop").addEventListener("click", () => {
        /* CLEAR means clear - the prompt goes with everything else. */
        state.draft = { loras: [], opts: [], repeat: state.draft.repeat,
                        prompt: 0, sweep: null, trig: {} };
        paint();
      });
      /* A queue is a plan for a series, worth keeping and worth handing to
         someone else. Import adds to what is already there rather than
         replacing it, so two plans can be merged. */
      $(".qexp").addEventListener("click", () => {
        if (!state.queue.length) {
          state.live.status = "nothing to export";
          paint();
          return;
        }
        const doc = { format: "leiel.vsl.queue", version: 1,
                      t: Date.now(), queue: state.queue };
        const text = JSON.stringify(doc, null, 2);
        const d = new Date(), p2 = (x) => String(x).padStart(2, "0");
        const suggested = "vsl-queue-" + d.getFullYear() + p2(d.getMonth() + 1) +
          p2(d.getDate()) + ".json";
        /* Ask where it should go when the browser allows it, rather than
           dropping it in the downloads folder without asking. */
        if (window.showSaveFilePicker) {
          (async () => {
            try {
              const handle = await window.showSaveFilePicker({
                suggestedName: suggested,
                types: [{ description: "Queue", accept: { "application/json": [".json"] } }],
              });
              const w2 = await handle.createWritable();
              await w2.write(text);
              await w2.close();
              state.live.status = "exported " + state.queue.length + " recipes";
            } catch (e) {
              state.live.status = "export cancelled";
            }
            paint();
          })();
          return;
        }
        const url = URL.createObjectURL(
          new Blob([text], { type: "application/json" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = suggested;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) {} }, 1000);
        state.live.status = "exported " + state.queue.length + " recipes";
        paint();
      });

      const qfi = $(".qfi");
      $(".qimp").addEventListener("click", () => qfi.click());
      qfi.addEventListener("change", () => {
        const f = qfi.files && qfi.files[0];
        if (!f) return;
        const rd = new FileReader();
        rd.onload = () => {
          qfi.value = "";
          const added = importQueue(String(rd.result || ""));
          state.live.status = added === null
            ? "that file is not a queue export"
            : "imported " + added + " recipes";
          if (added) { warmQueueTriggers(); writeStore(); }
          paint();
        };
        rd.onerror = () => { qfi.value = ""; };
        rd.readAsText(f);
      });

      $(".wipe").addEventListener("click", () => {
        state.running = false;
        state.queue = [];
        writeStore();
        paint();
      });
      $(".reset").addEventListener("click", () => {
        state.running = false;
        state.paused = false;
        state.done = {};
        state.sent = {};
        restoreValues();
        state.live = { index: -1, total: 0, remaining: 0,
                       status: "back to the start, widgets put back",
                       chips: [], files: [], label: "", rowId: "" };
        paint();
      });
      /* One render at a time.
         Sending the whole run at once put every prompt on the server before
         the first picture came back, so deleting a recipe part way through
         changed nothing - the renders were already gone. Sending one and
         waiting means the queue is read afresh for each, and a recipe removed
         while a run is going simply never gets sent. */
      let stepping = false;

      function runRemaining() {
        return Math.max(0, queueTotal(stagedRows()) - atCount());
      }

      async function stepRun() {
        if (!state.running || state.paused || stepping) return;
        if (sendRemaining() <= 0) {
          state.running = false;
          retireFinished();
          state.live.status = "the queue has finished";
          /* Nothing is on its way out any more. Other nodes read this to see
             what is rendering right now, so leaving the last row sitting in
             it would have them showing a render already filed and done. */
          const cur = node.widgets?.find((w) => w.name === "current_json");
          if (cur) cur.value = "{}";
          paint();
          return;
        }
        stepping = true;
        try {
          await app.queuePrompt(0, 1);
        } catch (e) {
          state.running = false;
          state.live.status = "could not queue: " +
            (e && e.message ? e.message : e);
        } finally {
          stepping = false;
        }
        paint();
      }

      /* Finished recipes leave the box by themselves - but only once their
         last image has actually come back. Retiring them at the moment the
         last one was *sent* moved a recipe to the bench while its picture was
         still being made, which for a one-image recipe meant it left the
         instant it started. */
      function retireFinished() {
        let changed = false;
        for (const row of state.queue || []) {
          const n = rowTotal(row);
          if (isStaged(row) && n > 0 && doneOf(row) >= n) {
            row.staged = false;
            changed = true;
          }
        }
        if (changed) {
          writeStore();
          paint();
        }
        return changed;
      }

      node._vslOnIdle = () => {
        /* The server has nothing left to do, so whatever was on its way has
           arrived: what was sent is now what is finished. */
        let arrived = false;
        for (const row of state.queue || []) {
          const sm = tallyMap(state.sent, row), dm = tallyMap(state.done, row);
          for (const [k, v] of Object.entries(sm)) {
            if (v > (dm[k] || 0)) { dm[k] = v; arrived = true; }
          }
        }
        /* Draw straight away: the counters and the badges are how a person
           sees that a picture landed, and waiting for the next send to
           repaint would hold them a step behind. */
        /* Arrived without this node driving the queue, which means the
           picture came from the canvas Run button. If the queue box still
           holds renders, they are not going to happen on their own. */
        if (arrived && !state.running) state.tipRunAll = true;
        if (arrived) paint();
        retireFinished();
        if (state.running && !state.paused) stepRun();
      };

      node._vslOnFailure = (d) => {
        state.running = false;
        const msg = String((d && (d.exception_message || d.message)) || "");
        const m = msg.match(/LoRA file not found:[^\n]*/);
        state.live.status = m ? "stopped - " + m[0] : "stopped - the last render did not finish";
        paint();
      };

      elRunAll.addEventListener("click", () => {
        /* Pressed: the point has been made, and the line does not come back
           in this session. */
        state.tipRunAll = false;
        if (state.running) {
          /* Pause after the picture being made, not during it. */
          state.paused = !state.paused;
          state.live.status = state.paused
            ? "pausing - the render in progress will finish"
            : "carrying on";
          if (!state.paused) stepRun();
          paint();
          return;
        }
        if (!queueTotal(stagedRows())) {
          state.live.status = state.queue.length
            ? "nothing in the queue box - drag a recipe down into it"
            : "nothing queued yet";
          paint();
          return;
        }
        if (runRemaining() <= 0) {
          state.live.status = "the queue has finished - press Reset";
          paint();
          return;
        }
        /* a LoRA whose file is not there: nothing runs until it is swapped */
        {
          const gone = missingFiles(stagedRows());
          if (gone.length) {
            state.live.status = "not run - no file in the loras folder for " + gone.join(", ") +
              " - swap the struck-through LoRA, or put its file back";
            paint();
            return;
          }
        }
        /* the same option twice in a sweep is one pass: the copies go now */
        for (const r of stagedRows()) {
          const sw = swOf(r);
          if (sw && Array.isArray(sw.opts)) {
            sw.opts = sw.opts.filter((o, i) => sw.opts.findIndex((x) => sameOptOf(x, o)) === i);
          }
        }
        writeStore();
        state.running = true;
        state.paused = false;
        stepRun();
      });

      /* ---- resizing ----
         LiteGraph fills resizing_node inside its own pointerdown handler, so
         a capture-phase check here would still see it empty. Claiming the
         pointer on the splitter itself keeps the canvas out of it. */
      /* The divider stores a ratio, not two pixel widths: a ratio survives
         the node being made wider or narrower, and it can be re-applied on
         every repaint so the columns never drift back. Width has nothing to
         do with height here, so this cannot disturb the panel sizing. */
      const split = root.querySelector(".vsl-split");
      const leftEl = root.querySelector(".vsl-left");
      const rightEl = root.querySelector(".vsl-right");

      function applySplit() {
        const raw = Number(state.split);
        const r = Math.min(0.75, Math.max(0.25,
          Number.isFinite(raw) && raw > 0 ? raw : 0.55));
        for (const [el, g] of [[leftEl, r], [rightEl, 1 - r]]) {
          el.style.flexGrow = String(g);
          el.style.flexShrink = "1";
          el.style.flexBasis = "0";
        }
      }

      split.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        e.preventDefault();
        const box = root.getBoundingClientRect();
        const move = (ev) => {
          const w = box.width || 1;
          state.split = Math.min(0.75, Math.max(0.25,
            (ev.clientX - box.left) / w));
          applySplit();
          node.setDirtyCanvas(true, true);
        };
        const up = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          persist();
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      });
      split.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        state.split = 0.55;
        applySplit();
        persist();
      });

      /* ---- driving the render ----
         Rather than sending option values down wires, the values are written
         straight onto the widgets they belong to, moments before ComfyUI
         turns the graph into a prompt. Nothing needs connecting: a recipe
         that leaves an option out simply does not touch it, so the node keeps
         whatever it was already holding. */

      /* every render the queue asks for, in order */
      /* A recipe with no staged flag is one made before the queue box
         existed. Those were all going to run, so that is what they keep
         meaning. */
      /* A recipe keeps the number it was given when it was made. Numbering by
         position meant the same recipe was 3 on the bench and 1 in the box,
         and everything below a deleted one shifted up - so the number could
         not be used to remember anything. Numbers are not reused. */
      function assignNumbers() {
        let max = 0;
        for (const r of state.queue || []) {
          const n = Number(r.no) || 0;
          if (n > max) max = n;
        }
        for (const r of state.queue || []) {
          if (!Number(r.no)) r.no = ++max;
        }
        return max;
      }

      function nextNumber() {
        return assignNumbers() + 1;
      }

      const isStaged = (row) => !row || row.staged !== false;
      const stagedRows = () => (state.queue || []).filter(isStaged);

      /* How far each recipe has got, kept per recipe rather than as one
         running number over the whole plan. That is what lets the plan change
         underneath a run: adding a recipe, dragging one out, or asking for
         two more images does not move anything already finished, because
         nothing counts positions any more - each recipe just remembers how
         many of its own images are done. */
      /* Two tallies, because "sent to the server" and "finished" are not the
         same moment and the screen must show the second one. Counting a
         picture as done the instant it was sent is what made a fresh run open
         at 1 of 2 with the first image still being made, and made the recipe
         at the bottom look as though it had been skipped. */
      /* Kept per pass now, not as one number per recipe: a sweep's chips
         can each be given more or fewer images while it runs, which moves
         every position after them. A pass remembers how many of its own
         shots have gone, so "two more of BSS" adds exactly those two and
         nothing finished is made again. A plain number, from a store
         written before, is read as that many renders from the top. */
      function tallyMap(store, row) {
        const m = store[row.id];
        if (m && typeof m === "object") return m;
        const k = Math.max(0, Number(m) || 0);
        const map = {};
        if (k > 0) {
          const list = expandRow(row);
          for (let i = 0; i < Math.min(k, list.length); i++) {
            const r = list[i];
            map[r.pass] = Math.max(map[r.pass] || 0, r.shot);
          }
        }
        store[row.id] = map;
        return map;
      }
      function tallyCount(store, row) {
        const m = tallyMap(store, row);
        let n = 0;
        for (const r of expandRow(row)) if ((m[r.pass] || 0) >= r.shot) n++;
        return n;
      }
      const doneOf = (row) => tallyCount(state.done, row);
      const sentOf = (row) => Math.max(doneOf(row), tallyCount(state.sent, row));

      /* Counts the image being made as the one it is on: "at 1 of 2" while
         the first is in the oven, not "at 0". Finishing is a separate thing -
         that is what turns a recipe's badge to done and sends it back to the
         bench, and it waits for the picture to actually come back. */
      function atCount() {
        let n = 0;
        for (const row of stagedRows()) n += Math.min(sentOf(row), rowTotal(row));
        return n;
      }

      /* The next image to send: the first staged recipe with anything left
         to send, taken from the bottom of the box upwards. This one counts
         what has gone out, not what has come back. */
      function nextRender() {
        for (const row of stagedRows()) {
          if (!runnable(row)) continue;
          const list = expandRow(row);
          const sm = tallyMap(state.sent, row), dm = tallyMap(state.done, row);
          const k = list.findIndex((r) =>
            Math.max(sm[r.pass] || 0, dm[r.pass] || 0) < r.shot);
          if (k >= 0) return { row, list, k };
        }
        return null;
      }

      /* Recipes queued before a prompt was picked, or whose prompt has since
         been unwired. They cannot render, so they are not counted as work.

         The first line here used to be "no sockets wired at all? then every
         row is fine" - a leftover from when the node still carried a plain
         prompt socket to fall back on. syncPromptInputs removes that socket
         now and the Python side falls back to prompt1, so with nothing wired
         there is no text at all: the recipe went out and rendered whatever an
         empty prompt gives you. Nothing is runnable without a live wire. */
      function runnable(row) {
        const wired = promptSlots();
        return promptList(row).every((n) => wired.includes(Number(n) || 0));
      }

      /* A recipe whose own prompt is gone - never picked, or a prompt from a
         book that is no longer loaded - but whose sweep holds live prompts.
         Built straight in the sweep panel, without dragging the prompt in
         first, it would sit with "no prompt" and never render. The first
         live sweep prompt becomes its own prompt instead: it stays in the
         sweep, so nothing new appears on the body and nothing renders twice. */
      /* The recipe's own prompt, once moved into the sweep, is one of the
         sweep's prompts like the others: taken out of the sweep or swapped
         there, it lets go of the recipe too, which takes another prompt as
         its own - the one swapped in, one left in the body, else the first
         left in the sweep. The last prompt of all stays, so the recipe can
         still render. */
      function releaseMain(row, n, to) {
        if (!row || Number(row.prompt) !== Number(n)) return;
        if (Number(to) > 0) { row.prompt = Number(to); return; }
        const sw = swOf(row);
        const inSw = ((sw && sw.prompts) || []).map(Number);
        const body = ((row.prompts) || []).map(Number).filter((k) => k > 0 && k !== Number(n) && !inSw.includes(k));
        if (body.length) {
          row.prompt = body[0];
          row.prompts = (row.prompts || []).filter((k) => Number(k) !== body[0]);
          return;
        }
        const left = inSw.filter((k) => k > 0 && k !== Number(n));
        if (left.length) row.prompt = left[0];
      }

      function healMain(row) {
        if (!row) return false;
        const wired = promptSlots();
        if (wired.includes(Number(row.prompt) || 0)) return false;
        const sw = swOf(row);
        if (!sw || !swOn(row)) return false;
        const n = (sw.prompts || []).map(Number).find((x) => wired.includes(x));
        if (!n) return false;
        row.prompt = n;
        return true;
      }

      function sendRemaining() {
        let left = 0;
        for (const row of stagedRows()) {
          if (!runnable(row)) continue;
          left += Math.max(0, rowTotal(row) - sentOf(row));
        }
        return left;
      }

      function expandQueue() {
        const out = [];
        for (const row of stagedRows()) out.push(...expandRow(row));
        return out;
      }

      /* one chip per capsule a render takes, named after its kind */
      function swapChips(swap) {
        return swap && Array.isArray(swap.caps)
          ? swap.caps.map((c) => ({ key: "swap:" + c.kind, label: c.kind,
                                    value: c.name, explicit: true }))
          : [];
      }

      function optCombosOf(opts) {
        let combos = [[]];
        for (const o of opts) {
          const vals = (o.values && o.values.length) ? o.values : [undefined];
          const next = [];
          for (const prefix of combos) {
            for (const v of vals) next.push(prefix.concat([[o, v]]));
          }
          combos = next;
        }
        return combos;
      }

      function expandRow(row) {
        const out = [];
        {
          const prompts = promptList(row);
          /* the order the sweep runs in: prompt, then LoRA line-up, then
             option - so one prompt's pictures come out together */
          const passes = [];
          for (const ps of passPlan(row)) {
            optCombosOf(ps.opts).forEach((combo, ci) =>
              passes.push({ p: ps.p, ls: ps.ls, combo, n: ps.n, key: ps.key + "|" + ci,
                            hit: { p: ps.p, lora: ps.lora, opt: ps.opt, opts: ps.optIds } }));
          }
          const repeat = Math.max(1, row.repeat || 1);
          const takes = sweepTakes(row.sweep);
          const swaps = takes.length
            ? takes.map((t) => ({ n: capRepeat(t, repeat),
                /* in the book's order, so a combination is named the same
                   whichever capsule went in first */
                caps: t.caps.slice().sort((p, q) => SWEEP_KINDS.indexOf(p.kind) - SWEEP_KINDS.indexOf(q.kind))
                  .map((c) => ({ kind: c.kind, cap: c.id, name: c.name })) }))
            : [null];
          swaps.forEach((swap, wi) => {
          for (const { p, ls, combo, n, key, hit } of passes) {
            const times = n || (swap ? swap.n : repeat);
            const pass = wi + "|" + key;
            const values = [], bits = [];
            for (const [o, v] of combo) {
              if (v === undefined) continue;
              values.push({ key: o.key, nodeId: o.nodeId, title: o.title,
                            widget: o.widget,
                            value: clampOpt(o.nodeId, o.widget, v) });
              bits.push(String(v));
            }
            /* shown on the node while it runs; the file name is the file
               manager's business, not this node's */
            const swapBit = swap ? swap.caps
              .map((c) => fileSafe(c.kind) + "(" + fileSafe(c.name) + ")").join("_") : "";
            const label = [prompts.length > 1 ? slug(promptName(p)) : "",
              ls.map((l) => slug(shortName(l.name))).join("_"),
              describeValues(values), swapBit].filter(Boolean).join("_") || "empty";
            const filename = [buildFileName(ls, values), swapBit]
              .filter(Boolean).join("_");
            for (let shot = 1; shot <= times; shot++) {
              out.push({ rowId: row.id, prompt: p, loras: ls, values, label,
                         filename, shot, repeat: times, pass, hit,
                         swap: swap ? { caps: swap.caps } : null });
            }
          }
          });
        }
        return out;
      }

      /* A file name only - no folders. Where the picture is filed is the
         file manager's business; this is just a name that says which
         combination made it. */
      function fileSafe(v) {
        return String(v).replace(/[^A-Za-z0-9_.()\[\]-]+/g, "-")
          .replace(/-+/g, "-").replace(/^-|-$/g, "") || "x";
      }

      /* Settings are grouped under the node they belong to. On its own a
         setting reads plainly; two or more from the same node are gathered in
         brackets so it stays clear which node they came from. */
      function describeValues(values) {
        const groups = new Map();
        for (const v of values) {
          const t = v.title || v.widget;
          if (!groups.has(t)) groups.set(t, []);
          groups.get(t).push(v);
        }
        const parts = [];
        for (const [title, list] of groups) {
          if (list.length === 1) {
            const v = list[0];
            parts.push(v.widget === "sampler_name" || v.widget === "scheduler"
              ? fileSafe(v.value)
              : fileSafe(v.widget) + "(" + fileSafe(v.value) + ")");
          } else {
            /* No node name, no brackets. Wrapping them made a name that was
               already long unreadable, and the parts say plenty alone. */
            for (const v of list) {
              parts.push(fileSafe(v.widget) + "(" + fileSafe(v.value) + ")");
            }
          }
        }
        return parts.join("_");
      }

      /* No date. Where and when a picture is filed is the file manager's
         business; this names the combination that made it, nothing else. */
      function buildFileName(loras, values) {
        const loraPart = loras
          .map((l) => fileSafe(shortName(l.name)) + "(" + l.strength + ")")
          .join("_");
        return [loraPart, describeValues(values)].filter(Boolean).join("_");
      }

      function slug(v) {
        let t = String(v).replace(/[^A-Za-z0-9_-]+/g, "-");
        while (t.indexOf("--") >= 0) t = t.replace("--", "-");
        return t.replace(/^-|-$/g, "") || "none";
      }

      /* What each widget held before the sweep touched it, so the workflow
         can be put back the way it was found. */
      const originals = new Map();

      function widgetOf(nodeId, name) {
        const n = app.graph && app.graph.getNodeById
          ? app.graph.getNodeById(Number(nodeId)) : null;
        if (!n) return null;
        return (n.widgets || []).find((w) => w.name === name) || null;
      }

      /* The loader in the model path is the one place LoRAs are applied. Rather
         than applying them again here, the recipe simply switches that loader:
         the LoRAs it asks for are turned on at the strength it asks for, and
         everything else is turned off. One place applies them, so the same
         LoRA can never be applied twice. */
      function applyValues(render) {
        for (const v of render.values || []) {
          const w = widgetOf(v.nodeId, v.widget);
          if (!w) continue;
          const key = v.nodeId + "::" + v.widget;
          if (!originals.has(key)) originals.set(key, w.value);
          /* a ".5" typed before numbers were kept as numbers */
          w.value = typeof w.value === "number"
            ? clampOpt(v.nodeId, v.widget, v.value) : v.value;
          if (typeof w.callback === "function") {
            try { w.callback(w.value); } catch (e) { /* ignore */ }
          }
        }
      }

      /* The frame the book asks of a prompt - portrait, landscape, square -
         passed to every Visual Latent Size Picker for this render, so its
         random or sequential pick stays among sizes of that shape. A picker
         set to a custom list, or one the recipe sets itself, is left alone.
         Put back with the rest once the render is sent. */
      const LATENT_PICKER = "RandomLatentSizePicker";
      function applyOrient(row, r) {
        const bp = bookPrompt(Number((r && r.prompt) || (row && row.prompt)));
        const o = bp && ["portrait", "landscape", "square"].includes(bp.orient) ? bp.orient : "";
        if (!o) return "";
        let used = false;
        for (const n of (app.graph && app.graph._nodes) || []) {
          if ((n.comfyClass || n.type) !== LATENT_PICKER) continue;
          const w = (n.widgets || []).find((x) => x.name === "resolution_preset");
          if (!w || w.value === "custom") continue;
          if ((r.values || []).some((v) => String(v.nodeId) === String(n.id) && v.widget === "resolution_preset")) continue;
          const key = n.id + "::resolution_preset";
          if (!originals.has(key)) originals.set(key, w.value);
          w.value = o;
          if (typeof w.callback === "function") {
            try { w.callback(w.value); } catch (e) { /* ignore */ }
          }
          used = true;
        }
        return used ? o : "";
      }

      function restoreValues() {
        for (const [key, value] of originals) {
          if (value && value.widgetRef) {
            /* put the text back just as quietly */
            value.widgetRef.value = value.text;
            continue;
          }
          if (value && value.entry) {
            const e = value.entry;
            if ("active" in e) e.active = value.on;
            if ("on" in e) e.on = value.on;
            if ("enabled" in e) e.enabled = value.on;
            if ("strength" in e) e.strength = value.strength;
            if ("strength_model" in e) e.strength_model = value.strength;
            if ("strength_clip" in e) e.strength_clip = value.strength;
            if ("weight" in e) e.weight = value.strength;
            continue;
          }
          const at = key.indexOf("::");
          const w = widgetOf(key.slice(0, at), key.slice(at + 2));
          if (!w) continue;
          w.value = value;
          if (typeof w.callback === "function") {
            try { w.callback(w.value); } catch (e) { /* ignore */ }
          }
        }
        originals.clear();
        node.setDirtyCanvas(true, true);
      }

      /* Called once per prompt, just before the graph is serialised. */
      /* Called the instant the prompt has been assembled: the values are
         already captured, so the graph can be handed straight back to the
         person exactly as they left it. */
      node._vslRelease = function () {
        try { restoreValues(); } catch (e) { /* ignore */ }
      };

      node._vslPrepare = function () {
        const store = node.widgets?.find((w) => w.name === "current_json");
        /* Worked out fresh every time, from what is in the box at this
           moment. Whatever was dragged in or out, or asked for more images,
           between the last render and this one is already accounted for. */
        const pick = nextRender();
        if (!pick) {
          if (store) store.value = "{}";
          return false;
        }
        const total = queueTotal(stagedRows());
        const i = atCount();
        const r = pick.list[pick.k];
        applyValues(r);
        const frame = applyOrient(pick.row, r);
        const frameChip = frame ? [{ key: "frame", label: "frame", value: frame, explicit: true }] : [];
        /* No slashes: this line is for reading, but if it is ever wired into
           something that saves a file, a slash would be taken for a folder
           and the render would fail on a path that cannot be made. */
        const status = `${i + 1} of ${total}  -  shot ` +
          `${pick.k + 1} of ${pick.list.length}  -  ${r.label}`;
        /* the prompt of this very render - a swept recipe has several */
        const pn = Number(r.prompt) || Number(pick.row.prompt) || 0;
        if (store) {
          store.value = JSON.stringify({
            loras: r.loras, label: r.label, filename: r.filename, status,
            prompt_slot: pn,
            prompt_name: pn ? promptName(pn) : "",
            series_name: seriesName(pn),
            /* the prompt's number within its series - 03 - for the name
               output, so folders sort the way the book does. Kept apart from
               prompt_name, which is how the prompt is found again. */
            prompt_no: (() => { const bp = bookPrompt(pn);
              return bp ? String(bp.no || 0).padStart(2, "0") : ""; })(),
            index: i, total,
            triggers: state.trigPos === "off"
              ? [] : activeTriggers(r.loras, pick.row),
            trigger_position: state.trigPos,
            swap: r.swap ? { caps: r.swap.caps.map((c) => ({ kind: c.kind, cap: c.cap })) } : null,
            chips: (r.values || []).map((v) => ({
              key: v.key, label: v.widget, value: String(v.value),
              explicit: true,
            })).concat(frameChip, swapChips(r.swap)),
          });
        }
        {
          const sm = tallyMap(state.sent, pick.row);
          sm[r.pass] = Math.max(sm[r.pass] || 0, r.shot);
        }
        state.live = {
          index: i, total,
          remaining: Math.max(0, total - (i + 1)),
          status, chips: (r.values || []).map((v) => ({
            key: v.key, label: v.widget, value: String(v.value),
            explicit: true })).concat(frameChip, swapChips(r.swap)),
          files: (r.loras || []).map((l) => l.name),
          /* the words that actually went - the scene's own included */
          trig: state.trigPos === "off" ? [] : activeTriggers(r.loras, pick.row).map((w) => w.toLowerCase()),
          label: r.label, filename: r.filename, rowId: r.rowId,
          /* which sweep chips this render belongs to, so they can light */
          hit: r.hit || null,
        };
        paint();
        return true;
      };

      /* ---- live upstream reading ---- */
      function refreshOptions() {
        const found = scanWorkflowOptions(node);
        const before = state.options.map((o) => o.key + o.value).join("|");
        const after = found.map((o) => o.key + o.value).join("|");
        if (before === after) return false;
        state.options = found;
        paint();
        return true;
      }

      /* This node applies the recipe's LoRAs itself. A loader left in the
         model path applies its own on top, and the same LoRA at double
         strength quietly wrecks the picture instead of raising an error. */
      function checkModelPath() {
        const bad = loaderInModelPath(node);
        const warn = bad
          ? "The model comes through " + (bad.title || bad.type) +
            ", which applies its LoRAs itself. Wire the plain model and clip " +
            "loaders into this node instead and keep that loader aside as a " +
            "picker, or every LoRA is applied twice."
          : "";
        if (warn !== state.warn) { state.warn = warn; paint(); }
      }

      function rescan() {
        const fromLoader = collectLoras(node);
        const found = fromLoader.concat(state.picked.filter((p) =>
          !fromLoader.some((l) => l.name === p.name)));
        const before = state.loras.map((l) => l.name + l.strength).join("|");
        const after = found.map((l) => l.name + l.strength).join("|");
        if (before === after) return false;
        state.loras = found;
        paint();
        return true;
      }

      const w = node.addDOMWidget("visual_series_lab", "div", root,
        { serialize: false });
      /* Always the floor, never the height it currently has. LiteGraph will
         not let a node be dragged below what this reports, so reporting the
         current height locks the node at its largest and it can never be
         made smaller again. */
      w.computeSize = function (width) {
        return [width, H_MIN];
      };

      /* Merge, never replace. The face already put this render's LoRAs and
         chips on screen before the graph was sent; the message coming back
         only carries a status, and overwriting with it blanked the strip a
         moment after it appeared. */
      /* Pressing Run all builds every prompt at once, so the face races
         ahead to the last recipe before the first one has even started. What
         comes back from a render is therefore the authority for what is
         running now - including the file name, which used to be left showing
         whatever the last prepared recipe had. */
      node._vslApply = (p) => {
        const live = state.live || {};
        if (p.index !== undefined && p.index !== null) live.index = p.index;
        if (p.total !== undefined && p.total !== null) live.total = p.total;
        if (typeof live.index === "number" && typeof live.total === "number") {
          live.remaining = Math.max(0, live.total - live.index - 1);
        }
        if (p.remaining !== undefined) live.remaining = p.remaining;
        if (p.status) live.status = p.status;
        if (p.label) live.label = p.label;
        if (p.filename) live.filename = p.filename;
        if (Array.isArray(p.chips) && p.chips.length) live.chips = p.chips;
        if (Array.isArray(p.lora_files) && p.lora_files.length) {
          live.files = p.lora_files;
        }
        state.live = live;
        paint();
      };

      let timer = setInterval(() => {
        if (!node.graph) { clearInterval(timer); timer = null; return; }
        rescan();
        refreshOptions();
        checkModelPath();
        snapNode();
      }, 700);
      const removed = node.onRemoved;
      node.onRemoved = function () {
        if (timer) { clearInterval(timer); timer = null; }
        if (node._vslShelfSub) LSHELF.subs.delete(node._vslShelfSub);
        closeEditor();
        closeHelp();
        closeBrowser();
        hideHover();
        try { restoreValues(); } catch (e) { /* ignore */ }
        removed?.apply(this, arguments);
      };

      /* Pick the boxes by what they hold, not by their position. A new box
         between them silently moved the grips onto the wrong ones. */
      const zoneOf = (sel) => {
        const el = root.querySelector(sel);
        return el ? el.closest(".vsl-zone") : null;
      };
      addGrip(zoneOf(".prompts"), "prompts", "pool");
      addGrip(zoneOf(".pool"), "pool", "trig");
      addGrip(zoneOf(".trig"), "trig", "opts");
      addGrip(zoneOf(".opts"), "opts", null);
      addGrip(root.querySelectorAll(".vsl-right .vsl-zone")[0], "queue", null);
      /* by content, like the grips above - a new box between them must not
         move these onto the wrong ones either */
      const poolZone = zoneOf(".pool");
      const trigZone = zoneOf(".trig");
      const optsZone = zoneOf(".opts");
      if (poolZone) poolZone.classList.add("pinned");
      if (trigZone) trigZone.classList.add("pinned");
      if (optsZone) optsZone.classList.add("pinned");
      root.querySelectorAll(".vsl-right .vsl-zone")[0].classList.add("pinned");
      applyHeights();

      setTimeout(() => {
        rescan();
        refreshOptions();
        checkModelPath();
        loadThumbs();
        paint();
      }, 60);
    };
  },
});

/* ComfyUI turns the graph into a prompt once per queued render, so that is
   the moment to write this render's values onto the widgets. Only advance
   while renders are actually pending - the same call is used for saving and
   exporting a workflow, and those must not move the queue along. */
let pending = 0;

const origQueuePrompt = app.queuePrompt;
app.queuePrompt = function (number, batchCount) {
  const n = batchCount === undefined ? 1 : Number(batchCount) || 1;
  pending += n;
  return origQueuePrompt.apply(this, arguments);
};

const origGraphToPrompt = app.graphToPrompt;
app.graphToPrompt = async function () {
  if (pending > 0) {
    pending--;
    for (const n of (app.graph && app.graph._nodes) || []) {
      if (n && typeof n._vslPrepare === "function" &&
          n.mode !== 2 && n.mode !== 4) {
        try { n._vslPrepare(); } catch (e) { console.error(e); }
      }
    }
  }
  const built = await origGraphToPrompt.apply(this, arguments);
  for (const n of (app.graph && app.graph._nodes) || []) {
    if (n && typeof n._vslRelease === "function") {
      try { n._vslRelease(); } catch (e) { console.error(e); }
    }
  }
  return built;
};

/* The server reports how much is left in its own queue. When that reaches
   zero the picture is finished and the next one may be sent. */
api.addEventListener("status", (e) => {
  const left = e && e.detail && e.detail.exec_info
    ? e.detail.exec_info.queue_remaining : null;
  if (left !== 0) return;
  for (const n of (app.graph && app.graph._nodes) || []) {
    if (n && typeof n._vslOnIdle === "function") {
      try { n._vslOnIdle(); } catch (err) { console.error(err); }
    }
  }
});

for (const ev of ["execution_error", "execution_interrupted"]) {
  api.addEventListener(ev, (e) => {
    for (const n of (app.graph && app.graph._nodes) || []) {
      if (n && typeof n._vslOnFailure === "function") {
        try { n._vslOnFailure(e && e.detail); } catch (err) { console.error(err); }
      }
    }
  });
}

/* "→ Lab" in the Image Viewer. One Lab takes the recipes: the one selected
   on the canvas, or else the first. */
window.addEventListener("leiel-to-lab", (e) => {
  const d = e.detail;
  if (!d || d.taken) return;
  const labs = ((app.graph && app.graph._nodes) || [])
    .filter((n) => n && typeof n._vslTakeFromViewer === "function" && n.mode !== 2 && n.mode !== 4);
  if (!labs.length) return;
  const sel = (app.canvas && app.canvas.selected_nodes) || {};
  const lab = labs.find((n) => sel[n.id]) || labs[0];
  d.taken = true;
  try { lab._vslTakeFromViewer(d); } catch (err) { console.error(err); }
});

api.addEventListener("visual_series_lab.progress", (e) => {
  const d = e.detail || {};
  const node = app.graph?.getNodeById?.(Number(d.node));
  if (node && node._vslApply) node._vslApply(d);
});
