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

const NODE = "VisualSeriesLabSetup";

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
.vsl-chips.trig{height:48px;}
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
.vsl-chip .pre{flex:0 0 auto;font-size:8px;letter-spacing:.3px;opacity:.5;
  max-width:80px;overflow:hidden;text-overflow:ellipsis;}
.vsl-chip .v{min-width:0;max-width:170px;overflow:hidden;text-overflow:ellipsis;
  opacity:.55;font-size:10px;}
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
.vsl-chip.live{outline:1px solid #ffd479;}
/* a trigger word riding along with the render on the way out */
.vsl-chip.c-text.live{border-color:#ffd479;background:#3a3320;color:#ffe9a3;}
.vsl-chip.c-lora{border-color:#7b6ce0;background:#2f2b45;color:#b9aef5;}
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
.vsl-hover{position:fixed;z-index:70;background:#141414;border:1px solid #5b7fa6;
  border-radius:6px;padding:4px;box-shadow:0 6px 20px #000b;pointer-events:none;
  font-family:ui-monospace,Consolas,monospace;font-size:10px;color:#ddd;}
.vsl-hover img{display:block;width:180px;height:180px;object-fit:cover;
  border-radius:4px;}
.vsl-hover div{padding:4px 2px 2px;text-align:center;opacity:.8;}
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
.vsl-list.bench{flex:1 1 auto;min-height:44px;}
/* the box the renders happen in: thicker, warmer, and lit from inside */
/* Burnt orange, not the yellow the recipes wear: the box has to read as a
   different kind of thing from the bundles sitting inside it, and warmer
   than everything else on the node says "this is the part that is running".
   Red on its own would say "wrong". */
.vsl-list.box{flex:0 0 auto;min-height:74px;border:3px solid #c25a2f;
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
.vsl-pod.rowpod.now{border-color:#ff8c47;background:#c25a2f38;}
.vsl-pod.rowpod.now .gt{color:#ffb27a;}
/* No divider line: each recipe already has its own border, and drawing one
   more only repainted the bundle's own edge. Space does the separating. */
.vsl-pod.rowpod .gt{display:flex;align-items:center;gap:5px;margin-bottom:5px;}
.vsl-pod.rowpod .gt .n{font-size:9px;opacity:.55;width:14px;}
.vsl-pod.rowpod .gt .prog{font-size:9px;font-weight:700;letter-spacing:.4px;
  color:#ffd479;border:1px solid #8a7a3f;border-radius:9px;padding:1px 7px;
  background:#332b16;}
.vsl-pod.rowpod .gt .prog.done{color:#b8f0cf;border-color:#48a882;
  background:#1c3029;}
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
.vsl-edit input,.vsl-edit select{background:#0d0d0d;border:1px solid #444;
  border-radius:4px;color:#ddd;font-family:inherit;font-size:14px;
  padding:6px 8px;}
.vsl-edit .rowb .vsl-btn{font-size:12px;padding:4px 12px;}
.vsl-edit select[multiple] option{padding:2px 4px;}
.vsl-edit select[multiple] option:checked{background:#3a6a86;color:#fff;}
.vsl-edit .rowb{display:flex;gap:4px;justify-content:flex-end;}
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
function rowTotal(row) {
  let n = 1;
  for (const o of (row && row.opts) || []) {
    const v = o && o.values;
    if (Array.isArray(v) && v.length) n *= v.length;
  }
  return n * Math.max(1, (row && row.repeat) || 1);
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
/* Nodes that hold text or files rather than anything worth sweeping. */
const SKIP_CLASS = /^(Leiel|VisualSeries|Note|MarkdownNote|Reroute|PrimitiveNode|SaveImage|PreviewImage|CLIPTextEncode|.*Loader.*)$/i;

function optionKey(nodeId, widget) {
  return nodeId + "::" + widget;
}

/* Every widget in the graph that could be swept, as option candidates. */
function scanWorkflowOptions(self) {
  const out = [];
  const nodes = (app.graph && app.graph._nodes ? app.graph._nodes : [])
    .filter((n) => n !== self && n.mode !== 2 && n.mode !== 4)
    .filter((n) => !SKIP_CLASS.test(String(n.comfyClass || n.type || "")))
    .sort((a, b) => (a.order || 0) - (b.order || 0));

  for (const n of nodes) {
    const title = String(n.title || n.type || "node");
    for (const w of n.widgets || []) {
      if (!w || !w.name) continue;
      if (SKIP_WIDGET_TYPES.includes(w.type)) continue;
      if (SKIP_WIDGETS.has(w.name)) continue;
      const v = w.value;
      const isNum = typeof v === "number";
      const isCombo = Array.isArray(w.options && w.options.values);
      const isBool = typeof v === "boolean";
      const isText = typeof v === "string" && !isCombo && v.length <= 40;
      if (!isNum && !isCombo && !isBool && !isText) continue;
      out.push({
        key: optionKey(n.id, w.name),
        nodeId: n.id,
        title,
        cls: String(n.comfyClass || n.type || ""),
        widget: w.name,
        value: v,
        choices: isCombo ? w.options.values.slice(0, 40) : null,
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

      for (const name of ["queue_json", "current_json"]) {
        const w = node.widgets?.find((x) => x.name === name);
        if (!w) continue;
        w.computeSize = () => [0, -4];
        w.draw = () => {};
        w.hidden = true;
      }
      const store = node.widgets?.find((w) => w.name === "queue_json");

      const state = {
        loras: [],
        picked: [],      // brought in from the browser, kept on the shelf
        triggers: {},    // lora name -> the words filed beside it
        trigOff: {},     // words the person has switched off
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
            if (v.done && typeof v.done === "object") state.done = v.done;
            if (v.promptNames && typeof v.promptNames === "object") {
              state.promptNames = v.promptNames;
              state.promptNameSrc =
                (v.promptNameSrc && typeof v.promptNameSrc === "object")
                  ? v.promptNameSrc : {};
            }
            if (v.sent && typeof v.sent === "object") state.sent = v.sent;
            const d = v.draft;
            if (d && typeof d === "object") {
              state.draft = {
                loras: Array.isArray(d.loras) ? d.loras : [],
                opts: Array.isArray(d.opts) ? d.opts : [],
                repeat: Math.max(1, Math.round(Number(d.repeat) || 1)),
                prompt: Number(d.prompt) || 0,
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
        } catch (e) { /* ignore */ }
      }
      /* The prompt sockets grow as they are used: one empty one is always on
         offer, and a new one appears behind it as soon as that is wired, up
         to six. Six empty sockets on a fresh node would say "you must fill
         these in", which is not true of any of them. */
      const MAX_PROMPTS = 6;

      function promptSlots() {
        const out = [];
        for (let i = 1; i <= MAX_PROMPTS; i++) {
          const inp = (node.inputs || []).find((x) => x.name === "prompt" + i);
          if (inp && inp.link !== null && inp.link !== undefined) out.push(i);
        }
        return out;
      }

      function syncPromptInputs() {
        /* A node from before the shelf carries a plain "prompt" socket. It
           has no chip and no way to be picked, so it only confuses - take it
           off and let prompt1 do the job. */
        const stale = (node.inputs || []).findIndex((x) => x.name === "prompt");
        if (stale >= 0) node.removeInput(stale);

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

        let changed = false;
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
          syncPromptInputs();
          paint();
        } catch (e) { /* ignore */ }
        return r;
      };

      readStore();

      /* onNodeCreated runs before saved widget values are put back, so the
         queue has to be picked up again once the graph has been configured. */
      function warmQueueTriggers() {
        for (const row of state.queue) warmTriggers(row.loras);
      }

      const prevConfigure = node.onConfigure;
      node.onConfigure = function () {
        if (prevConfigure) prevConfigure.apply(this, arguments);
        try {
          trimStaleOutputs();
          readStore();
          warmQueueTriggers();
          paint();
        } catch (e) { /* ignore */ }
      };

      const root = document.createElement("div");
      root.className = "vsl-root";
      root.innerHTML = `
        <div class="vsl-col vsl-left">
          <div class="vsl-zone promptzone">
            <h4>Prompt Shelf
              <span class="hint">click one to put it in the recipe</span></h4>
            <div class="vsl-chips prompts"></div>
          </div>
          <div class="vsl-zone">
            <h4>LoRAs Shelf <span class="hint">click to put in the recipe</span></h4>
            <div class="vsl-chips pool"></div>
            <div class="vsl-bar2">
              <button class="vsl-btn wide poolclear">CLEAR ALL</button>
              <button class="vsl-btn wide big browse">BROWSE</button>
            </div>
          </div>
          <div class="vsl-zone">
            <h4>Trigger words
              <span class="hint trighint">click one to leave it out</span>
              <span class="sp" style="flex:1"></span>
              <button class="vsl-btn tpos">prepend</button></h4>
            <div class="vsl-chips trig vsl-scroll"></div>
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
                <span class="benchct"></span></div>
              <div class="vsl-list bench"></div>
              <div class="vsl-sub box">        QUEUE BOX
                <span class="hint">only what is in here renders</span>
                <span class="sp" style="flex:1"></span>
                <span class="boxct"></span></div>
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
      const elPrompts = $(".prompts");
      const elBench = $(".bench"), elBox = $(".box.vsl-list") || $(".vsl-list.box");
      const elBenchCt = $(".benchct"), elBoxCt = $(".boxct");
      const elWarn = $(".warn");
      const elFname = $(".fname");
      const elOptQ = $(".optq"), elOptView = $(".optview");
      const elTrig = $(".trig"), elTPos = $(".tpos");
      const elTHint = $(".trighint");
      const elRunAll = $(".runall");

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
      let hoverTimer = null, hoverBox = null;

      function hideHover() {
        if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
        if (hoverBox) { hoverBox.remove(); hoverBox = null; }
      }

      function attachHoverPreview(el, loraName) {
        el.addEventListener("pointerenter", () => {
          hideHover();
          hoverTimer = setTimeout(() => {
            const src = state.thumbs[loraName] ||
                        state.thumbs[shortName(loraName)];
            if (!src) return;
            const box = document.createElement("div");
            box.className = "vsl-hover";
            box.innerHTML = `<img src="${src}"><div>${shortName(loraName)}</div>`;
            document.body.appendChild(box);
            const r = el.getBoundingClientRect();
            const b = box.getBoundingClientRect();
            box.style.left = Math.max(8, Math.min(r.left,
              window.innerWidth - b.width - 8)) + "px";
            box.style.top = (r.top - b.height - 6 > 8)
              ? (r.top - b.height - 6) + "px"
              : (r.bottom + 6) + "px";
            hoverBox = box;
          }, 500);
        });
        el.addEventListener("pointerleave", hideHover);
        el.addEventListener("pointerdown", hideHover);
      }

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
        if (opts.prefix) {
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
      function openEditor(fields, defaults, choices, values, anchor, onSave) {
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
          }
          box.appendChild(inp);
          inputs.push(inp);
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
          const lab = document.createElement("label");
          lab.textContent = o.widget +
            (o.choices ? "   (pick one or several)" : "");
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
            inp.value = o.values.join(", ");
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
            o.values = parts.length ? parts.map((t) => {
              const f = parseFloat(t);
              return (!Number.isNaN(f) && String(f) === t) ? f : t;
            }) : [""];
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

      /* Fetch the words for a recipe as it is queued. Collecting them at
         render time is too late: that runs synchronously, and a LoRA nobody
         had hovered over yet would simply contribute nothing. */
      function warmTriggers(loras) {
        for (const l of loras || []) loadTriggers(l.name);
      }

      function addToQueue() {
        const d = state.draft;
        if (!d.loras.length && !d.opts.length) return;
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
        /* Dropped back in to be run again: whatever it did last time is not
           this run's business. */
        if (staged && !row.staged) {
          delete state.done[row.id];
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
        head.textContent = current ? "Swap this LoRA" : "Add a LoRA";
        box.appendChild(head);
        const inUse = new Set((row.loras || []).map((l) => l.name));
        let any = false;
        for (const l of state.loras) {
          if (inUse.has(l.name) && l.name !== (current && current.name)) continue;
          any = true;
          const b = document.createElement("button");
          b.className = "vsl-btn" +
            (current && l.name === current.name ? " go" : "");
          b.style.textAlign = "left";
          b.textContent = shortName(l.name) + "   " + strengthText(l.strength);
          b.addEventListener("click", (e) => {
            e.stopPropagation();
            if (current) {
              current.name = l.name;
              current.strength = l.strength;
            } else {
              row.loras = (row.loras || []).concat(
                [{ name: l.name, strength: l.strength }]);
            }
            closeEditor();
            writeStore();
            paint();
          });
          box.appendChild(b);
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
      function openOptionPicker(row, anchor) {
        closeEditor();
        const box = document.createElement("div");
        box.className = "vsl-edit";
        box.style.minWidth = "300px";
        box.style.maxHeight = "420px";
        box.style.overflowY = "auto";
        const head = document.createElement("div");
        head.className = "eh";
        head.textContent = "Add an option";
        box.appendChild(head);

        const taken = new Set((row.opts || []).map((o) => o.key));
        const groups = new Map();
        for (const o of state.options) {
          if (taken.has(o.key)) continue;
          if (!groups.has(o.title)) groups.set(o.title, []);
          groups.get(o.title).push(o);
        }
        let any = false;
        for (const [title, list] of groups) {
          const lab = document.createElement("label");
          lab.textContent = shortNodeName(title);
          box.appendChild(lab);
          for (const o of list) {
            any = true;
            const b = document.createElement("button");
            b.className = "vsl-btn";
            b.style.textAlign = "left";
            b.textContent = o.widget + "   " + String(o.value);
            b.addEventListener("click", (e) => {
              e.stopPropagation();
              /* Exactly the shape the recipe builder makes, so a row built
                 here and a row built from the shelf are the same thing. */
              row.opts = (row.opts || []).concat([{
                key: o.key, nodeId: o.nodeId, title: o.title, widget: o.widget,
                kind: o.kind, choices: o.choices, values: [o.value], out: true,
              }]);
              closeEditor();
              writeStore();
              paint();
            });
            box.appendChild(b);
          }
        }
        if (!any) {
          const e2 = document.createElement("label");
          e2.textContent = state.options.length
            ? "every option is already in this recipe"
            : "no options found - press Refresh on the Options Shelf";
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
        for (const n of slots) {
          const b = document.createElement("button");
          b.className = "vsl-btn" +
            (Number(target.prompt) === n ? " on" : "");
          b.style.textAlign = "left";
          b.textContent = promptName(n);
          b.addEventListener("click", (e) => {
            e.stopPropagation();
            target.prompt = n;
            closeEditor();
            writeStore();
            paint();
          });
          box.appendChild(b);
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

      function makeSortable(el, list, item) {
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
          list.splice(to, 0, ...list.splice(from, 1));
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
      function activeTriggers(loras) {
        const out = [];
        const seen = new Set();
        for (const l of loras || []) {
          for (const w of state.triggers[l.name] || []) {
            const k = w.toLowerCase();
            if (seen.has(k) || state.trigOff[k]) continue;
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
        /^(string|text|value|out|output|out_?\d*|prompt\d*|conditioning)$/i;

      function promptSource(n) {
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
            "Another socket opens up each time you use one, up to six.";
          elPrompts.appendChild(e);
        }
        for (const n of slots) {
          const chosen = Number(state.draft.prompt) === n;
          elPrompts.appendChild(chip("c-n6", promptName(n), "", {
            /* Dimmed once it is in the recipe, exactly like a LoRA: the
               shelf shows what is still available. */
            muted: chosen,
            title: "prompt" + n + "\nclick to put it in the recipe" +
              "\nright click to rename it",
            onClick: () => {
              /* one prompt to a recipe: picking another swaps it */
              state.draft.prompt = chosen ? 0 : n;
              paint();
            },
            onContext: (ev) => openEditor(["name"], [""], null,
              [promptName(n)], ev.currentTarget, (v) => {
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
              }),
          }));
        }

        elPool.innerHTML = "";
        if (!state.loras.length) {
          const e = document.createElement("div");
          e.className = "vsl-empty";
          e.innerHTML = "<b>No LoRAs yet</b>" +
            "Press <i>BROWSE</i> to pick from every LoRA on disk - folders, " +
            "pictures, favourites and all. What you pick stays on this shelf " +
            "and is saved with the workflow.";
          elPool.appendChild(e);
        }
        for (const l of state.loras) {
          const used = state.draft.loras.some((x) => x.name === l.name);
          const c = chip("c-lora", shortName(l.name), strengthText(l.strength), {
            muted: used,
            title: l.name + "\nclick to reserve, x to take off the shelf",
            onClick: () => addLoraToDraft(l),
            onRemove: () => {
              /* Off the shelf and out of the recipe being built. A LoRA the
                 loader still has switched on comes back on the next scan,
                 which is the loader's business, not this node's. */
              state.picked = state.picked.filter((x) => x.name !== l.name);
              state.loras = state.loras.filter((x) => x.name !== l.name);
              state.draft.loras = state.draft.loras
                .filter((x) => x.name !== l.name);
              paint();
            },
          });
          attachHoverPreview(c, l.name);
          elPool.appendChild(c);
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
            for (const l of row.loras || []) {
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
          if (state.live.index >= 0) {
            for (const n of state.live.files || []) {
              for (const w of state.triggers[n] || []) {
                liveWords.add(w.toLowerCase());
              }
            }
          }
          const showingLive = liveWords.size > 0 && state.trigPos !== "off";
          if (elTHint) {
            elTHint.textContent = showingLive
              ? "lit ones are going out with this render"
              : "click one to leave it out";
          }

          const seenWord = new Set();
          let any = false;
          for (const src of sources) {
            loadTriggers(src.name);
            for (const w of state.triggers[src.name] || []) {
              const k = w.toLowerCase();
              if (seenWord.has(k)) continue;
              seenWord.add(k);
              any = true;
              const off = !!state.trigOff[k] || state.trigPos === "off";
              const inThisRender = showingLive && liveWords.has(k) && !off;
              elTrig.appendChild(chip("c-text", w, "", {
                muted: off || (showingLive && !inThisRender),
                live: inThisRender,
                title: shortName(src.name) +
                  (src.queued ? "  (queued)" : "  (in the recipe)") +
                  (showingLive
                    ? (inThisRender ? "  -  in this render"
                                    : "  -  not in this render")
                    : ""),
                onClick: () => {
                  if (state.trigOff[k]) delete state.trigOff[k];
                  else state.trigOff[k] = true;
                  paint();
                },
              }));
            }
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
          bwrap.appendChild(chip("c-n6", promptName(state.draft.prompt), "", {
            title: "the prompt this recipe uses\nclick to swap it",
            onClick: (ev) => openPromptPicker(state.draft, ev.currentTarget),
            onRemove: () => { state.draft.prompt = 0; paint(); },
          }));
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
              o.values.join(" / "), {
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
                                  repeat: state.draft.repeat });
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
          if (!runnable(row)) {
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
            body.appendChild(chip("c-n6", promptName(row.prompt), "", {
              title: "the prompt this recipe uses\nclick to swap it",
              onClick: (ev) => openPromptPicker(row, ev.currentTarget),
            }));
          }
          for (const l of row.loras || []) {
            /* Draggable here too. The order decides the file name and which
               LoRA counts as "the first one", so it has to be changeable
               after a recipe is queued, not only while it is being built. */
            const qchip = chip("c-lora", shortName(l.name), strengthText(l.strength), {
              title: l.name + "\nclick to swap this LoRA" +
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
            makeSortable(qchip, row.loras, l);
            body.appendChild(qchip);
          }
          const rg = new Map();
          for (const o of row.opts || []) {
            if (!rg.has(o.title)) rg.set(o.title, []);
            rg.get(o.title).push(o);
          }
          for (const [title, list] of rg) {
            for (const o of list) {
            body.appendChild(chip(nodeColourClass(title), o.widget,
              (o.values || []).join(" / "), {
                prefix: shortNodeName(title),
                title: title + " . " + o.widget + "\nclick to edit this recipe",
                onClick: (ev) => openGroupEditor(title, list, ev.currentTarget,
                  writeStore),
                onRemove: () => {
                  row.opts = (row.opts || []).filter((x) => x !== o);
                  writeStore();
                  paint();
                },
              }));
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
          const rowBtn = (label, cls, title, fn) => {
            const b = document.createElement("button");
            b.className = "vsl-btn rb";
            b.textContent = label;
            b.title = title;
            b.addEventListener("click", (ev) => {
              ev.stopPropagation();
              fn(ev);
            });
            return b;
          };

          const less = rowBtn("\u2212", "", "One image fewer per combination",
            () => {
              row.repeat = Math.max(1, (Number(row.repeat) || 1) - 1);
              writeStore();
              paint();
            });
          const more = rowBtn("+", "", "One image more per combination", () => {
            row.repeat = Math.min(999, (Number(row.repeat) || 1) + 1);
            writeStore();
            paint();
          });

          const addL = rowBtn("+L", "b-lora", "Add another LoRA to this recipe",
            (ev) => openLoraPicker(row, null, ev.currentTarget));
          const addO = rowBtn("+O", "b-opt", "Add an option to this recipe",
            (ev) => openOptionPicker(row, ev.currentTarget));
          const dup = rowBtn("C", "b-copy",
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
          const del = rowBtn("X", "b-del", "Remove this recipe from the queue",
            () => {
              state.queue.splice(i, 1);
              writeStore();
              paint();
            });
          el.__vslRow = row;
          makeRowDraggable(el, row);
          head.appendChild(idx);
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
          const sp = document.createElement("span");
          sp.className = "sp";
          sp.style.flex = "1";
          head.appendChild(sp);
          head.appendChild(less);
          head.appendChild(ct);
          head.appendChild(more);
          head.appendChild(addL);
          head.appendChild(addO);
          head.appendChild(dup);
          head.appendChild(del);
          el.appendChild(head);
          el.appendChild(body);
          (staged ? elBox : elBench).appendChild(el);
        });
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
        elFill.style.width = live.total
          ? Math.round(((live.index + 1) / live.total) * 100) + "%" : "0";
        const left = runRemaining();
        elRunAll.textContent = state.running
          ? (state.paused ? "RESUME (" + left + ")" : "PAUSE (" + left + ")")
          : (left ? "RUN ALL (" + left + ")" : "RUN ALL");
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
      const STORED = ["prompts", "pool", "opts", "queue"];
      const DEF_H = { prompts: 46, pool: 118, opts: 92, queue: 230 };
      const MIN_H = { prompts: 24, pool: 26, opts: 26, queue: 120 };
      const bodyOf = {};

      const ROOM = 186;   // left for the zones that carry no stored height
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

        <h5>The four shelves</h5>
        <p><b>Prompt Shelf</b> shows one chip per prompt wired into the node.
        Connect a text node to <code>prompt1</code> and a chip appears; the
        next socket opens as soon as that one is used, up to six. A chip is
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
        either side step it up and down, mid-run included. <b>+L</b> and
        <b>+O</b> add a LoRA or an option to a recipe that is already queued,
        <b>C</b> copies it, <b>X</b> removes it.</p>

        <h5>Outputs</h5>
        <p><code>model</code> and <code>conditioning</code> carry the render.
        <code>this render's prompt</code> and <code>this render's loras</code>
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
        state.picked = [];
        state.loras = [];
        paint();
      });
      $(".browse").addEventListener("click", (e) => {
        e.stopPropagation();
        openBrowser();
      });
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
                        prompt: 0 };
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
          const s2 = Number(state.sent[row.id]) || 0;
          if (s2 > (Number(state.done[row.id]) || 0)) {
            state.done[row.id] = s2;
            arrived = true;
          }
        }
        /* Draw straight away: the counters and the badges are how a person
           sees that a picture landed, and waiting for the next send to
           repaint would hold them a step behind. */
        if (arrived) paint();
        retireFinished();
        if (state.running && !state.paused) stepRun();
      };

      node._vslOnFailure = () => {
        state.running = false;
        state.live.status = "stopped - the last render did not finish";
        paint();
      };

      elRunAll.addEventListener("click", () => {
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
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      });
      split.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        state.split = 0.55;
        applySplit();
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
      const doneOf = (row) => Math.max(0, Number(state.done[row.id]) || 0);
      const sentOf = (row) =>
        Math.max(doneOf(row), Number(state.sent[row.id]) || 0);

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
          const k = sentOf(row);
          if (k < list.length) return { row, list, k };
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
        return promptSlots().includes(Number(row.prompt) || 0);
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

      function expandRow(row) {
        const out = [];
        {
          const opts = (row.opts || []).filter((o) => o && o.key);
          let combos = [[]];
          for (const o of opts) {
            const vals = (o.values && o.values.length) ? o.values : [undefined];
            const next = [];
            for (const prefix of combos) {
              for (const v of vals) next.push(prefix.concat([[o, v]]));
            }
            combos = next;
          }
          const repeat = Math.max(1, row.repeat || 1);
          for (const combo of combos) {
            const values = [], bits = [];
            for (const [o, v] of combo) {
              if (v === undefined) continue;
              values.push({ key: o.key, nodeId: o.nodeId, title: o.title,
                            widget: o.widget, value: v });
              bits.push(String(v));
            }
            /* shown on the node while it runs; the file name is the file
               manager's business, not this node's */
            const label = [(row.loras || [])
              .map((l) => slug(shortName(l.name))).join("_"),
              describeValues(values)].filter(Boolean).join("_") || "empty";
            for (let shot = 1; shot <= repeat; shot++) {
              out.push({ rowId: row.id, loras: row.loras || [], values, label,
                         filename: buildFileName(row.loras || [], values),
                         shot, repeat });
            }
          }
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
          w.value = v.value;
          if (typeof w.callback === "function") {
            try { w.callback(w.value); } catch (e) { /* ignore */ }
          }
        }
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
        /* No slashes: this line is for reading, but if it is ever wired into
           something that saves a file, a slash would be taken for a folder
           and the render would fail on a path that cannot be made. */
        const status = `${i + 1} of ${total}  -  shot ` +
          `${pick.k + 1} of ${pick.list.length}  -  ${r.label}`;
        if (store) {
          store.value = JSON.stringify({
            loras: r.loras, label: r.label, filename: r.filename, status,
            prompt_slot: Number(pick.row.prompt) || 0,
            prompt_name: Number(pick.row.prompt)
              ? promptName(pick.row.prompt) : "",
            index: i, total,
            triggers: state.trigPos === "off"
              ? [] : activeTriggers(r.loras),
            trigger_position: state.trigPos,
            chips: (r.values || []).map((v) => ({
              key: v.key, label: v.widget, value: String(v.value),
              explicit: true,
            })),
          });
        }
        state.sent[pick.row.id] = pick.k + 1;
        state.live = {
          index: i, total,
          remaining: Math.max(0, total - (i + 1)),
          status, chips: (r.values || []).map((v) => ({
            key: v.key, label: v.widget, value: String(v.value),
            explicit: true })),
          files: (r.loras || []).map((l) => l.name),
          label: r.label, filename: r.filename, rowId: r.rowId,
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
      addGrip(zoneOf(".pool"), "pool", "opts");
      addGrip(zoneOf(".opts"), "opts", null);
      addGrip(root.querySelectorAll(".vsl-right .vsl-zone")[0], "queue", null);
      /* by content, like the grips above - a new box between them must not
         move these onto the wrong ones either */
      const poolZone = zoneOf(".pool");
      const optsZone = zoneOf(".opts");
      if (poolZone) poolZone.classList.add("pinned");
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
  api.addEventListener(ev, () => {
    for (const n of (app.graph && app.graph._nodes) || []) {
      if (n && typeof n._vslOnFailure === "function") {
        try { n._vslOnFailure(); } catch (err) { console.error(err); }
      }
    }
  });
}

api.addEventListener("visual_series_lab.progress", (e) => {
  const d = e.detail || {};
  const node = app.graph?.getNodeById?.(Number(d.node));
  if (node && node._vslApply) node._vslApply(d);
});
