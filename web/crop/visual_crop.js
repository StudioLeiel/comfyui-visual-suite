import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

const NODE_ID = "VisualCrop_StudioLeiel";

const ASPECTS = {
    "free": null,
    "1:1": 1 / 1,
    "4:5": 4 / 5,
    "5:4": 5 / 4,
    "3:2": 3 / 2,
    "2:3": 2 / 3,
    "16:9": 16 / 9,
};

const HANDLE_PX = 10;

/* Follow the image wire back to whatever is feeding this node.
   ComfyUI keeps the pictures a node is showing on node.imgs - Load Image fills
   that in the moment you pick a file, with no run needed - so the preview can
   be live instead of waiting for the graph to execute. */
function upstreamImageNode(node) {
    try {
        const inp = (node.inputs || []).find((i) => i.name === "image");
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

function upstreamImageSrc(node) {
    const up = upstreamImageNode(node);
    if (!up || up.mode === 2 || up.mode === 4) return null;
    const im = up.imgs?.[0];
    return im?.src || null;
}

function getWidget(node, name) {
    return node.widgets?.find((w) => w.name === name);
}

function widgetValue(node, name, fallback) {
    const w = getWidget(node, name);
    return w ? w.value : fallback;
}

function setWidget(node, name, value) {
    const w = getWidget(node, name);
    if (!w) return;
    w.value = value;
    if (w.callback) w.callback(value, app.canvas, node);
}

function snapTo(v, step) {
    if (step <= 1) return Math.round(v);
    return Math.round(v / step) * step;
}

/* The source view and the cropped view split the body evenly, so the result
   is as big as the picture you are dragging on rather than a thin strip. */
const RESULT_GAP = 16;     // room for each caption

function splitBody(node, top) {
    const margin = 8;
    const w = Math.max(16, node.size[0] - margin * 2);
    const total = node.size[1] - top - margin - RESULT_GAP;
    const each = Math.max(60, Math.floor((total - RESULT_GAP) / 2));
    return { margin, w, each, top };
}

// Where the image preview area lives inside the node body.
function computeImageArea(node) {
    let top = 0;
    if (node.widgets?.length) {
        for (const w of node.widgets) {
            if (typeof w.last_y === "number") {
                top = Math.max(top, w.last_y + LiteGraph.NODE_WIDGET_HEIGHT);
            }
        }
    }
    if (top === 0) {
        const count = node.widgets ? node.widgets.length : 0;
        top = 4 + count * (LiteGraph.NODE_WIDGET_HEIGHT + 4);
    }
    top += 10;

    const sp = splitBody(node, top);
    return { x: sp.margin, y: top, w: sp.w, h: sp.each };
}

// The lower half, showing only what the crop box currently covers.
function computeResultArea(node) {
    let top = 0;
    if (node.widgets?.length) {
        for (const w of node.widgets) {
            if (typeof w.last_y === "number") {
                top = Math.max(top, w.last_y + LiteGraph.NODE_WIDGET_HEIGHT);
            }
        }
    }
    if (top === 0) {
        const count = node.widgets ? node.widgets.length : 0;
        top = 4 + count * (LiteGraph.NODE_WIDGET_HEIGHT + 4);
    }
    top += 10;

    const sp = splitBody(node, top);
    return { x: sp.margin, y: top + sp.each + RESULT_GAP, w: sp.w, h: sp.each };
}

// Fit the source image inside the area, letterboxed.
function computeFitRect(node, area) {
    const sw = node._slSrcW || 1;
    const sh = node._slSrcH || 1;
    const scale = Math.min(area.w / sw, area.h / sh);
    const w = sw * scale;
    const h = sh * scale;
    return {
        x: area.x + (area.w - w) / 2,
        y: area.y + (area.h - h) / 2,
        w,
        h,
        scale,
    };
}

function localToSource(node, rect, lx, ly) {
    return {
        x: ((lx - rect.x) / rect.w) * (node._slSrcW || 1),
        y: ((ly - rect.y) / rect.h) * (node._slSrcH || 1),
    };
}

function sourceToLocal(node, rect, sx, sy) {
    return {
        x: rect.x + (sx / (node._slSrcW || 1)) * rect.w,
        y: rect.y + (sy / (node._slSrcH || 1)) * rect.h,
    };
}

function applyAspect(node, box, anchorRight, anchorBottom) {
    const name = widgetValue(node, "lock_aspect", "free");
    const ratio = ASPECTS[name];
    if (!ratio) return box;

    let { x, y, w, h } = box;
    // Drive height from width so the drag feels predictable.
    const newH = w / ratio;
    if (anchorBottom) y = y + h - newH;
    h = newH;
    return { x, y, w, h };
}

function clampBox(node, box) {
    const sw = node._slSrcW || 1;
    const sh = node._slSrcH || 1;
    let { x, y, w, h } = box;

    w = Math.max(8, Math.min(w, sw));
    h = Math.max(8, Math.min(h, sh));
    x = Math.max(0, Math.min(x, sw - w));
    y = Math.max(0, Math.min(y, sh - h));
    return { x, y, w, h };
}

function commitBox(node, box) {
    const step = widgetValue(node, "snap", 8);
    const clamped = clampBox(node, box);

    setWidget(node, "x", snapTo(clamped.x, step));
    setWidget(node, "y", snapTo(clamped.y, step));
    setWidget(node, "width", Math.max(step, snapTo(clamped.w, step)));
    setWidget(node, "height", Math.max(step, snapTo(clamped.h, step)));
    node.setDirtyCanvas(true, true);
}

function currentBox(node) {
    return {
        x: widgetValue(node, "x", 0),
        y: widgetValue(node, "y", 0),
        w: widgetValue(node, "width", 1024),
        h: widgetValue(node, "height", 1024),
    };
}

app.registerExtension({
    name: "StudioLeiel.VisualCrop",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_ID) return;

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const r = onNodeCreated?.apply(this, arguments);
            this._slImg = null;
            this._slSrcW = 0;
            this._slSrcH = 0;
            this._slDrag = null;
            this._slLiveSrc = null;
            this.size = [340, 760];

            /* Watch the upstream node for a picture it is already displaying.
               Cheap: it only compares a string until something changes. */
            const node = this;
            const iv = setInterval(() => {
                if (!node.graph) { clearInterval(iv); return; }
                const src = upstreamImageSrc(node);
                if (!src || src === node._slLiveSrc) return;
                node._slLiveSrc = src;
                const img = new Image();
                img.onload = () => {
                    node._slImg = img;
                    node._slSrcW = img.naturalWidth || img.width;
                    node._slSrcH = img.naturalHeight || img.height;
                    node.setDirtyCanvas(true, true);
                };
                img.src = src;
            }, 400);

            return r;
        };

        // Grab the source preview the backend wrote to temp.
        const onExecuted = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function (message) {
            onExecuted?.apply(this, arguments);

            const info = message?.slcrop?.[0] || message?.images?.[0];
            if (!info) return;

            this._slSrcW = info.source_width || 0;
            this._slSrcH = info.source_height || 0;

            const params = new URLSearchParams({
                filename: info.filename,
                subfolder: info.subfolder || "",
                type: info.type || "temp",
                rand: String(Math.random()),
            });

            const img = new Image();
            img.onload = () => {
                this._slImg = img;
                if (!this._slSrcW) this._slSrcW = img.width;
                if (!this._slSrcH) this._slSrcH = img.height;
                this._slLiveSrc = img.src;      // do not overwrite this with a stale live read
                this.setDirtyCanvas(true, true);
            };
            img.src = api.apiURL("/view?" + params.toString());
        };

        nodeType.prototype.onDrawBackground = function (ctx) {
            if (this.flags?.collapsed) return;

            const area = computeImageArea(this);

            ctx.save();
            ctx.fillStyle = "#161616";
            ctx.fillRect(area.x, area.y, area.w, area.h);

            if (!this._slImg) {
                ctx.fillStyle = "#7a7a7a";
                ctx.font = "12px sans-serif";
                ctx.textAlign = "center";
                ctx.fillText("Connect an image", area.x + area.w / 2, area.y + area.h / 2);

                const res0 = computeResultArea(this);
                ctx.fillStyle = "#101010";
                ctx.fillRect(res0.x, res0.y, res0.w, res0.h);
                ctx.strokeStyle = "#3a3a3a";
                ctx.lineWidth = 1;
                ctx.strokeRect(res0.x + 0.5, res0.y + 0.5, res0.w - 1, res0.h - 1);
                ctx.fillStyle = "#5a5a5a";
                ctx.font = "10px monospace";
                ctx.textAlign = "left";
                ctx.fillText("result", res0.x + 2, res0.y - 4);

                ctx.restore();
                return;
            }

            const rect = computeFitRect(this, area);
            this._slRect = rect;
            ctx.drawImage(this._slImg, rect.x, rect.y, rect.w, rect.h);

            const box = this._slDrag?.preview || currentBox(this);
            const tl = sourceToLocal(this, rect, box.x, box.y);
            const br = sourceToLocal(this, rect, box.x + box.w, box.y + box.h);
            const bw = br.x - tl.x;
            const bh = br.y - tl.y;

            // Dim everything outside the selection.
            ctx.fillStyle = "rgba(0,0,0,0.55)";
            ctx.fillRect(rect.x, rect.y, rect.w, tl.y - rect.y);
            ctx.fillRect(rect.x, br.y, rect.w, rect.y + rect.h - br.y);
            ctx.fillRect(rect.x, tl.y, tl.x - rect.x, bh);
            ctx.fillRect(br.x, tl.y, rect.x + rect.w - br.x, bh);

            ctx.strokeStyle = "#4ec9b0";
            ctx.lineWidth = 1.5;
            ctx.strokeRect(tl.x, tl.y, bw, bh);

            // Corner handles.
            ctx.fillStyle = "#4ec9b0";
            const hs = 5;
            for (const [hx, hy] of [
                [tl.x, tl.y], [br.x, tl.y], [tl.x, br.y], [br.x, br.y],
            ]) {
                ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
            }

            ctx.fillStyle = "#e6e6e6";
            ctx.font = "11px monospace";
            ctx.textAlign = "left";
            const label = `${Math.round(box.w)}x${Math.round(box.h)} @ ${Math.round(box.x)},${Math.round(box.y)}`;
            ctx.fillText(label, rect.x + 4, rect.y + rect.h + 13);

            /* The cropped view. Everything needed is already on screen - the
               source picture and the box - so this is just the same image drawn
               again through a different window. No run, no queue. */
            const res = computeResultArea(this);
            ctx.fillStyle = "#101010";
            ctx.fillRect(res.x, res.y, res.w, res.h);

            const sw = this._slSrcW || 1;
            const sh = this._slSrcH || 1;
            const bx = Math.max(0, Math.min(box.x, sw - 1));
            const by = Math.max(0, Math.min(box.y, sh - 1));
            const cw = Math.max(1, Math.min(box.w, sw - bx));
            const ch = Math.max(1, Math.min(box.h, sh - by));

            /* the loaded picture may be a downscaled preview */
            const px = (this._slImg.naturalWidth || this._slImg.width) / sw;
            const py = (this._slImg.naturalHeight || this._slImg.height) / sh;

            const fit = Math.min(res.w / cw, res.h / ch);
            const dw = Math.max(1, cw * fit);
            const dh = Math.max(1, ch * fit);
            const dx = res.x + (res.w - dw) / 2;
            const dy = res.y + (res.h - dh) / 2;

            try {
                ctx.drawImage(
                    this._slImg,
                    bx * px, by * py, cw * px, ch * py,
                    dx, dy, dw, dh,
                );
            } catch (e) { /* image not ready yet */ }

            ctx.strokeStyle = "#3a3a3a";
            ctx.lineWidth = 1;
            ctx.strokeRect(res.x + 0.5, res.y + 0.5, res.w - 1, res.h - 1);

            ctx.fillStyle = "#8fbfe0";
            ctx.font = "10px monospace";
            ctx.fillText("result  " + Math.round(cw) + " x " + Math.round(ch),
                         res.x + 2, res.y - 4);

            ctx.restore();
        };

        nodeType.prototype.onMouseDown = function (e, pos) {
            if (!this._slImg || !this._slRect) return false;

            const rect = this._slRect;
            const lx = pos[0];
            const ly = pos[1];

            if (lx < rect.x || lx > rect.x + rect.w || ly < rect.y || ly > rect.y + rect.h) {
                return false;
            }

            const box = currentBox(this);
            const tl = sourceToLocal(this, rect, box.x, box.y);
            const br = sourceToLocal(this, rect, box.x + box.w, box.y + box.h);

            const near = (a, b) => Math.abs(a - b) <= HANDLE_PX;
            let mode = "new";
            let corner = null;

            if (near(lx, tl.x) && near(ly, tl.y)) { mode = "resize"; corner = "tl"; }
            else if (near(lx, br.x) && near(ly, tl.y)) { mode = "resize"; corner = "tr"; }
            else if (near(lx, tl.x) && near(ly, br.y)) { mode = "resize"; corner = "bl"; }
            else if (near(lx, br.x) && near(ly, br.y)) { mode = "resize"; corner = "br"; }
            else if (lx > tl.x && lx < br.x && ly > tl.y && ly < br.y) { mode = "move"; }

            const src = localToSource(this, rect, lx, ly);

            this._slDrag = {
                mode,
                corner,
                startSrc: src,
                startBox: box,
                preview: box,
            };

            return true;
        };

        nodeType.prototype.onMouseMove = function (e, pos) {
            const drag = this._slDrag;
            if (!drag || !this._slRect) return false;

            const src = localToSource(this, this._slRect, pos[0], pos[1]);
            const dx = src.x - drag.startSrc.x;
            const dy = src.y - drag.startSrc.y;
            const sb = drag.startBox;

            let box;

            if (drag.mode === "move") {
                box = { x: sb.x + dx, y: sb.y + dy, w: sb.w, h: sb.h };
            } else if (drag.mode === "resize") {
                let x1 = sb.x, y1 = sb.y, x2 = sb.x + sb.w, y2 = sb.y + sb.h;
                if (drag.corner === "tl") { x1 += dx; y1 += dy; }
                if (drag.corner === "tr") { x2 += dx; y1 += dy; }
                if (drag.corner === "bl") { x1 += dx; y2 += dy; }
                if (drag.corner === "br") { x2 += dx; y2 += dy; }
                box = {
                    x: Math.min(x1, x2),
                    y: Math.min(y1, y2),
                    w: Math.abs(x2 - x1),
                    h: Math.abs(y2 - y1),
                };
                box = applyAspect(this, box, drag.corner === "tl" || drag.corner === "bl",
                                              drag.corner === "tl" || drag.corner === "tr");
            } else {
                const x1 = drag.startSrc.x, y1 = drag.startSrc.y;
                const x2 = src.x, y2 = src.y;
                box = {
                    x: Math.min(x1, x2),
                    y: Math.min(y1, y2),
                    w: Math.abs(x2 - x1),
                    h: Math.abs(y2 - y1),
                };
                box = applyAspect(this, box, x2 < x1, y2 < y1);
            }

            drag.preview = clampBox(this, box);
            this.setDirtyCanvas(true, true);
            return true;
        };

        nodeType.prototype.onMouseUp = function () {
            const drag = this._slDrag;
            if (!drag) return false;

            if (drag.preview && drag.preview.w >= 8 && drag.preview.h >= 8) {
                commitBox(this, drag.preview);
            }
            this._slDrag = null;
            this.setDirtyCanvas(true, true);
            return true;
        };

        const onResize = nodeType.prototype.onResize;
        nodeType.prototype.onResize = function (size) {
            size[0] = Math.max(300, size[0]);
            size[1] = Math.max(520, size[1]);
            onResize?.apply(this, arguments);
        };
    },
});
