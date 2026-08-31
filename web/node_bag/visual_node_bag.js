import { app } from "../../../scripts/app.js";

const BAG_TYPE = "VisualNodeBag";

/* Layout -------------------------------------------------------------- */

const PAD = 14;
const HEADER = 30;
const CHIP_GAP = 14;
const ROW_GAP = 12;
const SHELF_LABEL = 20;
const SHELF_GAP = 14;
const SHELF_RADIUS = 24;
const SHELF_BOX_PAD = 12;
const EMPTY_ROW = 26;
const MIN_WIDTH = 300;
const MIN_HEIGHT = 110;
const PORT_MARGIN = 22;
const PORT_PITCH = 20;
const DRAG_SLOP = 5;

/* Palette -------------------------------------------------------------- */

const INK = "rgba(255, 255, 255, 0.32)";
const INK_FAINT = "rgba(255, 255, 255, 0.18)";
const YELLOW = "#d9b26a";
const HELP_ROW = 26;
const RED = "#d98b8b";
const BLUE = "#7fa8e8";
const LINE = "rgba(255, 255, 255, 0.10)";

const SHELF_DEFAULT = "#e0763a";
const SHELF_COLOURS = [
    SHELF_DEFAULT,
    "#8a929c",
    "#7fa8e8",
    "#b98fd6",
    "#7fc9a0",
    "#d9b26a",
    "#d98b8b",
    "#79c3d4",
    "#c9a27f",
];

const NAME_FONT = "600 12px Inter, system-ui, sans-serif";
const CAPS_FONT = "700 9px Inter, system-ui, sans-serif";
const LABEL_FONT = "10px Inter, system-ui, sans-serif";

/* Shared drag state ---------------------------------------------------- */

// The layout has to know which node the pointer is carrying, otherwise it
// snaps a chip back into its slot every frame and it can never be dragged out.
let activeDrag = null;
let hoverUI = null;

function draggedNode() {
    if (activeDrag) {
        return activeDrag;
    }
    const canvas = app.canvas;
    return (canvas && canvas.node_dragged) || null;
}

/* Small helpers -------------------------------------------------------- */

function titleHeight() {
    return (window.LiteGraph && window.LiteGraph.NODE_TITLE_HEIGHT) || 30;
}

function isBag(node) {
    return !!node && node.type === BAG_TYPE;
}

function darken(colour, amount) {
    const parsed = parseColour(colour);
    if (!parsed) {
        return colour;
    }
    const k = 1 - amount;
    return `rgb(${Math.round(parsed[0] * k)}, ${Math.round(
        parsed[1] * k
    )}, ${Math.round(parsed[2] * k)})`;
}

function withAlpha(colour, alpha) {
    const parsed = parseColour(colour);
    if (!parsed) {
        return colour;
    }
    return `rgba(${parsed[0]}, ${parsed[1]}, ${parsed[2]}, ${alpha})`;
}

function parseColour(colour) {
    const text = String(colour || "").trim();
    if (text.startsWith("#")) {
        const hex = text.slice(1);
        const full =
            hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
        if (full.length < 6) {
            return null;
        }
        return [
            parseInt(full.slice(0, 2), 16),
            parseInt(full.slice(2, 4), 16),
            parseInt(full.slice(4, 6), 16),
        ];
    }
    const parts = text.match(/[\d.]+/g);
    if (!parts || parts.length < 3) {
        return null;
    }
    return [Number(parts[0]), Number(parts[1]), Number(parts[2])];
}

function roundRect(ctx, x, y, w, h, r) {
    const radius = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
}

function pointInRect(x, y, rect) {
    return (
        x >= rect[0] && x <= rect[0] + rect[2] && y >= rect[1] && y <= rect[1] + rect[3]
    );
}

function rectCentre(rect) {
    return [rect[0] + rect[2] / 2, rect[1] + rect[3] / 2];
}

/* Geometry ------------------------------------------------------------- */

function bagRect(bag) {
    return [bag.pos[0], bag.pos[1], bag.size[0], bag.size[1]];
}

function nodeCentre(node) {
    const th = titleHeight();
    const collapsed = node.flags && node.flags.collapsed;
    const w = collapsed ? chipWidth(node) : node.size[0];
    const h = collapsed ? th : node.size[1] + th;
    return [node.pos[0] + w / 2, node.pos[1] - th + h / 2];
}

function chipWidth(node) {
    if (node.flags && node.flags.collapsed && node._collapsed_width) {
        node.__bagChipW = node._collapsed_width;
    }
    if (node.__bagChipW) {
        return node.__bagChipW;
    }
    const title = node.getTitle ? node.getTitle() : node.title || "";
    return Math.max(80, title.length * 6.5 + 54);
}

// A collapsed node draws its title bar above pos[1], so its visible box starts
// one title height higher than the node origin.
function chipRect(node) {
    const th = titleHeight();
    const collapsed = node.flags && node.flags.collapsed;
    const w = collapsed ? chipWidth(node) : node.size[0];
    const h = collapsed ? th : node.size[1] + th;
    return [node.pos[0], node.pos[1] - th, w, h];
}

function placeChip(node, x, y) {
    node.pos[0] = x;
    node.pos[1] = y + titleHeight();
}

/* Bag contents --------------------------------------------------------- */

function itemIds(bag) {
    bag.properties = bag.properties || {};
    if (!Array.isArray(bag.properties.items)) {
        bag.properties.items = [];
    }
    return bag.properties.items;
}

function shelfNames(bag) {
    bag.properties = bag.properties || {};
    const props = bag.properties;
    if (!Array.isArray(props.shelves) || props.shelves.length === 0) {
        // Carry over the earlier name for this list.
        props.shelves = Array.isArray(props.layers) && props.layers.length
            ? props.layers.slice()
            : [""];
        delete props.layers;
    }
    return props.shelves;
}

function entryShelf(bag, entry) {
    const count = shelfNames(bag).length;
    const value = Number(entry.shelf !== undefined ? entry.shelf : entry.layer) || 0;
    return Math.max(0, Math.min(count - 1, value));
}

function itemNodes(bag, shelf) {
    const graph = bag.graph;
    if (!graph) {
        return [];
    }
    const entries = itemIds(bag);
    let pruned = false;
    for (let i = entries.length - 1; i >= 0; i -= 1) {
        if (!graph.getNodeById(entries[i].id)) {
            // Copy and paste hands out fresh ids; a stale entry just drops out.
            entries.splice(i, 1);
            pruned = true;
        }
    }
    const nodes = [];
    for (const entry of entries) {
        if (shelf !== undefined && entryShelf(bag, entry) !== shelf) {
            continue;
        }
        const node = graph.getNodeById(entry.id);
        if (node) {
            nodes.push(node);
        }
    }
    if (pruned) {
        bag.setDirtyCanvas(true, true);
    }
    return nodes;
}

function bagsInGraph(graph) {
    if (!graph || !graph._nodes) {
        return [];
    }
    return graph._nodes.filter(isBag);
}

function bagHolding(node) {
    if (!node || !node.graph) {
        return null;
    }
    for (const bag of bagsInGraph(node.graph)) {
        if (itemIds(bag).some((entry) => entry.id === node.id)) {
            return bag;
        }
    }
    return null;
}

function hideBadges(node) {
    // The little source-pack labels above a node are noise once it is a chip.
    if (Array.isArray(node.badges) && node.badges.length) {
        if (!node.__bagBadges) {
            node.__bagBadges = node.badges.slice();
        }
        node.badges.length = 0;
    }
}

function restoreBadges(node) {
    if (node.__bagBadges) {
        if (Array.isArray(node.badges)) {
            node.badges.push(...node.__bagBadges);
        }
        delete node.__bagBadges;
    }
}

/* Port rail ------------------------------------------------------------ */

// Wires are drawn between whatever getConnectionPos reports, so overriding it
// on a chip moves the end of the real wire onto the bag's edge. Nothing about
// the link itself changes - this only decides where it is painted.
function captureConnectionPos(node) {
    if (node.__bagOrigConnectionPos) {
        return;
    }
    node.__bagOrigConnectionPos = node.getConnectionPos;
    node.getConnectionPos = function (isInput, slot, out) {
        const ports = this.__bagPorts;
        const port = ports && ports[(isInput ? "i" : "o") + slot];
        if (port) {
            if (out) {
                out[0] = port[0];
                out[1] = port[1];
                return out;
            }
            return [port[0], port[1]];
        }
        return this.__bagOrigConnectionPos.call(this, isInput, slot, out);
    };
}

function releaseConnectionPos(node) {
    if (node.__bagOrigConnectionPos) {
        node.getConnectionPos = node.__bagOrigConnectionPos;
        delete node.__bagOrigConnectionPos;
    }
    delete node.__bagPorts;
}

function truePos(node, isInput, slot) {
    const original = node.__bagOrigConnectionPos || node.getConnectionPos;
    return original.call(node, isInput, slot);
}

function linkColour(link) {
    try {
        const canvas = app.canvas;
        const byType =
            (canvas && canvas.default_connection_color_byType) ||
            (window.LGraphCanvas && window.LGraphCanvas.link_type_colors);
        if (byType && link && byType[link.type]) {
            return byType[link.type];
        }
    } catch (error) {
        /* fall through to the neutral colour */
    }
    return "#9aa0a8";
}

function nearestEdge(rect, point) {
    const distances = [
        ["left", Math.abs(point[0] - rect[0])],
        ["right", Math.abs(point[0] - (rect[0] + rect[2]))],
        ["top", Math.abs(point[1] - rect[1])],
        ["bottom", Math.abs(point[1] - (rect[1] + rect[3]))],
    ];
    distances.sort((a, b) => a[1] - b[1]);
    return distances[0][0];
}

function collectExternals(bag) {
    const graph = bag.graph;
    const nodes = itemNodes(bag);
    const inside = new Set(nodes);
    const found = [];

    for (const node of nodes) {
        for (let i = 0; i < (node.inputs || []).length; i += 1) {
            const input = node.inputs[i];
            if (!input || input.link == null) {
                continue;
            }
            const link = graph.links[input.link];
            const other = link && graph.getNodeById(link.origin_id);
            if (!other || inside.has(other)) {
                continue;
            }
            found.push({ node, isInput: true, slot: i, other, link });
        }

        for (let o = 0; o < (node.outputs || []).length; o += 1) {
            const output = node.outputs[o];
            for (const id of (output && output.links) || []) {
                const link = graph.links[id];
                const other = link && graph.getNodeById(link.target_id);
                if (!other || inside.has(other)) {
                    continue;
                }
                found.push({ node, isInput: false, slot: o, other, link });
                break;
            }
        }
    }
    return found;
}

function assignPorts(bag) {
    const nodes = itemNodes(bag);
    for (const node of nodes) {
        captureConnectionPos(node);
        node.__bagPorts = {};
    }
    if (!bag.graph) {
        bag.__ports = [];
        return;
    }

    const rect = bagRect(bag);
    const externals = collectExternals(bag);
    const byEdge = { left: [], right: [], top: [], bottom: [] };

    for (const item of externals) {
        const centre = nodeCentre(item.other);
        item.edge = nearestEdge(rect, centre);
        item.order = item.edge === "left" || item.edge === "right" ? centre[1] : centre[0];
        byEdge[item.edge].push(item);
    }

    const drawn = [];
    for (const edge of Object.keys(byEdge)) {
        const list = byEdge[edge];
        if (!list.length) {
            continue;
        }
        list.sort((a, b) => a.order - b.order);

        const vertical = edge === "left" || edge === "right";
        const start = (vertical ? rect[1] : rect[0]) + PORT_MARGIN;
        const end = (vertical ? rect[1] + rect[3] : rect[0] + rect[2]) - PORT_MARGIN;

        // Each port wants to sit where its wire naturally arrives; they are
        // then pushed apart just enough not to overlap, so the row stays
        // ordered without flinging the first and last to the corners.
        const wanted = list.map((item) =>
            Math.min(end, Math.max(start, item.order))
        );
        for (let i = 1; i < wanted.length; i += 1) {
            wanted[i] = Math.max(wanted[i], wanted[i - 1] + PORT_PITCH);
        }
        if (wanted.length && wanted[wanted.length - 1] > end) {
            wanted[wanted.length - 1] = end;
            for (let i = wanted.length - 2; i >= 0; i -= 1) {
                wanted[i] = Math.min(wanted[i], wanted[i + 1] - PORT_PITCH);
            }
        }
        if (wanted.length && wanted[0] < start) {
            wanted[0] = start;
            for (let i = 1; i < wanted.length; i += 1) {
                wanted[i] = Math.max(wanted[i], wanted[i - 1] + PORT_PITCH);
            }
        }

        for (let i = 0; i < list.length; i += 1) {
            const along = wanted[i];
            const point = vertical
                ? [edge === "left" ? rect[0] : rect[0] + rect[2], along]
                : [along, edge === "top" ? rect[1] : rect[1] + rect[3]];

            const item = list[i];
            item.node.__bagPorts[(item.isInput ? "i" : "o") + item.slot] = point;
            drawn.push({ x: point[0], y: point[1], colour: linkColour(item.link) });
        }
    }
    bag.__ports = drawn;
}

/* Contents ------------------------------------------------------------- */

function globalIndex(bag, shelf, position) {
    const entries = itemIds(bag);
    let seen = 0;
    for (let i = 0; i < entries.length; i += 1) {
        if (entryShelf(bag, entries[i]) !== shelf) {
            continue;
        }
        if (seen === position) {
            return i;
        }
        seen += 1;
    }
    for (let i = entries.length - 1; i >= 0; i -= 1) {
        if (entryShelf(bag, entries[i]) === shelf) {
            return i + 1;
        }
    }
    return entries.length;
}

function addToBag(bag, node, shelf, position) {
    if (!node || isBag(node) || node === bag) {
        return false;
    }
    const previous = bagHolding(node);
    if (previous && previous !== bag) {
        releaseFromBag(previous, node);
    }

    const entries = itemIds(bag);
    const existing = entries.findIndex((entry) => entry.id === node.id);
    const entry =
        existing === -1
            ? {
                  id: node.id,
                  w: node.size[0],
                  h: node.size[1],
                  collapsed: !!(node.flags && node.flags.collapsed),
              }
            : entries[existing];
    if (existing !== -1) {
        entries.splice(existing, 1);
    }
    entry.shelf = shelf || 0;
    delete entry.layer;
    entries.splice(globalIndex(bag, entry.shelf, position), 0, entry);

    node.flags = node.flags || {};
    node.flags.collapsed = true;
    node.__bagOpen = false;
    hideBadges(node);
    captureConnectionPos(node);
    return true;
}

// The node stays where it was dropped; only the state the bag changed is put
// back. Callers that empty a whole bag place the nodes themselves.
function releaseFromBag(bag, node) {
    const entries = itemIds(bag);
    const index = entries.findIndex((entry) => entry.id === node.id);
    if (index === -1) {
        return false;
    }
    const entry = entries[index];
    entries.splice(index, 1);

    node.flags = node.flags || {};
    // Whatever it looked like going in, it comes back out open.
    node.flags.collapsed = false;
    node.__bagOpen = false;
    delete node.__bagHidden;
    if (entry.w && entry.h) {
        node.size[0] = entry.w;
        node.size[1] = entry.h;
    }
    restoreBadges(node);
    releaseConnectionPos(node);
    return true;
}

/* Draw order ----------------------------------------------------------- */

// Links are painted before nodes, so a bag drawn before its chips hides every
// wire that runs underneath it while the chips stay on top of the body.
function enforceDrawOrder(graph) {
    if (!graph || !graph._nodes) {
        return;
    }
    const bags = bagsInGraph(graph);
    if (bags.length === 0) {
        return;
    }

    const owned = new Map();
    for (const bag of bags) {
        for (const node of itemNodes(bag)) {
            if (!owned.has(node)) {
                owned.set(node, bag);
            }
        }
    }
    if (owned.size === 0) {
        return;
    }

    const rest = graph._nodes.filter((node) => !owned.has(node));
    const ordered = [];
    for (const node of rest) {
        ordered.push(node);
        if (isBag(node)) {
            const chips = itemNodes(node).filter((chip) => owned.get(chip) === node);
            // An opened chip is a popover: it has to sit above its neighbours.
            chips.sort((a, b) => (a.__bagOpen ? 1 : 0) - (b.__bagOpen ? 1 : 0));
            ordered.push(...chips);
        }
    }

    if (ordered.length !== graph._nodes.length) {
        return;
    }
    for (let i = 0; i < ordered.length; i += 1) {
        if (graph._nodes[i] !== ordered[i]) {
            graph._nodes = ordered;
            return;
        }
    }
}

let orderScheduled = false;

function scheduleDrawOrder(graph) {
    if (orderScheduled) {
        return;
    }
    orderScheduled = true;
    // Never reorder while the canvas is walking the array.
    queueMicrotask(() => {
        orderScheduled = false;
        try {
            enforceDrawOrder(graph);
        } catch (error) {
            console.error("[VisualNodeBag] draw order", error);
        }
    });
}

/* Layout --------------------------------------------------------------- */

function layoutBag(bag) {
    const dragging = draggedNode();
    const shelves = shelfNames(bag);
    const th = titleHeight();

    const left = bag.pos[0] + PAD + SHELF_BOX_PAD;
    const maxRight = bag.pos[0] + Math.max(MIN_WIDTH, bag.size[0]) - PAD - SHELF_BOX_PAD;

    const slots = [];
    const bands = [];
    let y = bag.pos[1] + HEADER + PAD;

    for (let index = 0; index < shelves.length; index += 1) {
        const top = y;
        const folded = shelfFolded(bag, index);
        y += SHELF_LABEL;

        const boxTop = y;
        const nodes = itemNodes(bag, index);
        let boxBottom = boxTop;

        if (folded) {
            for (const node of nodes) {
                node.__bagHidden = true;
                node.pos[0] = bag.pos[0] + PAD;
                node.pos[1] = top + th;
            }
        } else {
            y += SHELF_BOX_PAD;
            let x = left;
            for (const node of nodes) {
                delete node.__bagHidden;
                const width = chipWidth(node);
                if (x > left && x + width > maxRight) {
                    x = left;
                    y += th + ROW_GAP;
                }
                slots.push({ node, shelf: index, x, y, w: width, h: th });
                if (node !== dragging) {
                    placeChip(node, x, y);
                }
                // Collapse is driven by LiteGraph itself: the dot on the chip
                // and a double click both toggle it, and the bag follows along.
                node.__bagOpen = !(node.flags && node.flags.collapsed);
                hideBadges(node);
                x += width + CHIP_GAP;
            }
            y += (nodes.length ? th : EMPTY_ROW) + SHELF_BOX_PAD;
            boxBottom = y;
        }

        bands.push({
            index,
            top,
            labelTop: top,
            bottom: y + SHELF_GAP,
            box: folded
                ? null
                : [
                      bag.pos[0] + PAD,
                      boxTop,
                      Math.max(MIN_WIDTH, bag.size[0]) - PAD * 2,
                      boxBottom - boxTop,
                  ],
            folded,
            empty: nodes.length === 0,
        });
        y += SHELF_GAP;
    }

    bag.__slots = slots;
    bag.__bands = bands;

    // onResize is not called by every frontend build, so a height that no
    // longer matches what we last wrote is taken as the user's own resize.
    if (
        bag.__appliedHeight !== undefined &&
        Math.abs(bag.size[1] - bag.__appliedHeight) > 0.5
    ) {
        bag.properties.height = Math.max(MIN_HEIGHT, Math.round(bag.size[1]));
    }
    const needed = y - SHELF_GAP + PAD + HELP_ROW - bag.pos[1];
    const wanted = Number(bag.properties.height) || MIN_HEIGHT;
    bag.size[0] = Math.max(MIN_WIDTH, bag.size[0]);
    bag.size[1] = Math.max(MIN_HEIGHT, needed, wanted);
    bag.__appliedHeight = bag.size[1];

    if (bands.length) {
        bands[bands.length - 1].bottom = bag.pos[1] + bag.size[1];
    }

    assignPorts(bag);
}

/* Drawing -------------------------------------------------------------- */

function drawHeader(bag, ctx) {
    const count = itemNodes(bag).length;
    const name = bag.properties.name || "";

    ctx.save();
    ctx.textBaseline = "middle";

    ctx.font = NAME_FONT;
    ctx.fillStyle = name ? YELLOW : INK_FAINT;
    const shown = name || "name this bag";
    ctx.fillText(shown, PAD, 16);
    const nameWidth = ctx.measureText(shown).width;
    bag.__nameRect = [PAD - 4, 5, Math.max(60, nameWidth) + 8, 22];

    ctx.font = LABEL_FONT;
    ctx.fillStyle = INK;
    ctx.fillText(
        count === 0 ? "drag nodes in here" : `${count} node${count === 1 ? "" : "s"}`,
        PAD + nameWidth + 12,
        16
    );

    const specs = [
        { id: "shelf", label: "+ shelf", on: false, colour: YELLOW },
        { id: "sort", label: "sort", on: false, colour: BLUE },
        { id: "unpack", label: "unpack all", on: false, colour: RED },
    ];

    ctx.font = CAPS_FONT;
    const buttons = [];
    let right = bag.size[0] - PAD;
    for (let i = specs.length - 1; i >= 0; i -= 1) {
        const spec = specs[i];
        const width = ctx.measureText(spec.label.toUpperCase()).width + 18;
        right -= width;
        buttons.push({ ...spec, x: right, y: 6, w: width, h: 19 });
        right -= 5;
    }
    buttons.reverse();
    bag.__buttons = buttons;

    // Drag left and right to fade the body: handy for checking the wiring
    // underneath without unpacking anything.
    const trackW = 54;
    const trackX = (buttons.length ? buttons[0].x : bag.size[0] - PAD) - trackW - 12;
    const trackY = 15;
    const opacity =
        bag.properties.opacity === undefined ? 1 : Number(bag.properties.opacity);
    bag.__opacityRect = [trackX, trackY - 9, trackW, 18];

    const hotTrack = hoverUI && hoverUI.bag === bag && hoverUI.kind === "opacity";
    ctx.strokeStyle = hotTrack ? withAlpha(BLUE, 0.8) : LINE;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(trackX, trackY);
    ctx.lineTo(trackX + trackW, trackY);
    ctx.stroke();

    ctx.strokeStyle = hotTrack ? BLUE : withAlpha(BLUE, 0.5);
    ctx.beginPath();
    ctx.moveTo(trackX, trackY);
    ctx.lineTo(trackX + trackW * opacity, trackY);
    ctx.stroke();
    ctx.lineWidth = 1;

    ctx.beginPath();
    ctx.arc(trackX + trackW * opacity, trackY, hotTrack ? 5 : 4, 0, Math.PI * 2);
    ctx.fillStyle = hotTrack ? "#ffffff" : BLUE;
    ctx.fill();

    ctx.textAlign = "center";
    for (const button of buttons) {
        const hot =
            hoverUI &&
            hoverUI.bag === bag &&
            hoverUI.kind === "button" &&
            hoverUI.button &&
            hoverUI.button.id === button.id;
        roundRect(ctx, button.x, button.y, button.w, button.h, 9);
        if (hot || button.on) {
            ctx.fillStyle = withAlpha(button.colour, hot ? 0.26 : 0.13);
            ctx.fill();
        }
        ctx.strokeStyle = hot
            ? withAlpha(button.colour, 0.95)
            : button.on
            ? withAlpha(button.colour, 0.55)
            : LINE;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = hot ? "#ffffff" : button.on ? button.colour : INK;
        ctx.fillText(
            button.label.toUpperCase(),
            button.x + button.w / 2,
            button.y + button.h / 2 + 0.5
        );
    }
    ctx.textAlign = "left";

    ctx.restore();
}

const HELP_TEXT = `WHAT IT IS
A visual container. It never touches the graph - links, ids
and execution are untouched, and deleting a bag gives every
node back exactly as it was.

IN AND OUT
Drag a node in and it folds into a chip. Drag a chip out and
the node comes back open, at full size, where you let go.
Drag a chip within the bag to move it.

SHELVES
+ SHELF adds a row. Drag a shelf's label, or empty space
inside its box, to reorder the shelves. The caret folds a
shelf to its title, the dot cycles its colour, UNPACK takes
out only that shelf, and the cross removes it.

HEADER
Click the yellow name to rename the bag. The slider fades
the body so the wiring underneath can be checked without
unpacking. SORT lines the chips up by what feeds what.
UNPACK ALL empties the whole bag below it.

CHIPS
Double click a chip, or press the dot on its left, to open
it in place; click anywhere else to close it again. Source
badges are hidden while a node is in the bag.`;

// Chips are painted after the bag, so the manual can only be readable if they
// step aside while it is open.
const HELP_HEIGHT = (() => {
    let height = 28;
    for (const line of HELP_TEXT.split("\n")) {
        const heading = line && line === line.toUpperCase() && /[A-Z]/.test(line);
        height += heading ? 16 : 14;
    }
    return height + HELP_ROW;
})();

function drawHelp(bag, ctx) {
    roundRect(ctx, 4, 4, bag.size[0] - 8, bag.size[1] - 8, 8);
    ctx.fillStyle = "#14161a";
    ctx.fill();
    ctx.strokeStyle = LINE;
    ctx.stroke();

    ctx.save();
    ctx.textBaseline = "top";
    let y = 14;
    for (const line of HELP_TEXT.split("\n")) {
        const heading = line && line === line.toUpperCase() && /[A-Z]/.test(line);
        ctx.font = heading ? CAPS_FONT : "10px ui-monospace, Consolas, monospace";
        ctx.fillStyle = heading ? YELLOW : "rgba(255,255,255,0.6)";
        ctx.fillText(line, 14, y);
        y += heading ? 16 : 14;
    }
    ctx.restore();
}

function drawHelpButton(bag, ctx) {
    const size = 18;
    const x = bag.size[0] - PAD - size - 8;
    const y = bag.size[1] - PAD - size + 2;
    bag.__helpRect = [x, y, size, size];

    const hot = hoverUI && hoverUI.bag === bag && hoverUI.kind === "help";
    roundRect(ctx, x, y, size, size, 9);
    if (hot || bag.__helpOpen) {
        ctx.fillStyle = withAlpha(YELLOW, hot ? 0.26 : 0.14);
        ctx.fill();
    }
    ctx.strokeStyle = hot || bag.__helpOpen ? withAlpha(YELLOW, 0.9) : LINE;
    ctx.stroke();

    ctx.save();
    ctx.font = CAPS_FONT;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = hot || bag.__helpOpen ? "#ffffff" : INK;
    ctx.fillText("?", x + size / 2, y + size / 2 + 0.5);
    ctx.restore();
}

function drawShelves(bag, ctx) {
    const shelves = shelfNames(bag);
    const bands = bag.__bands || [];
    bag.__shelfUI = [];

    ctx.save();
    ctx.textBaseline = "middle";
    for (const band of bands) {
        const colour = shelfColour(bag, band.index);
        const y = band.labelTop - bag.pos[1] + SHELF_LABEL / 2;
        const name = (shelves[band.index] || `shelf ${band.index + 1}`).toUpperCase();
        const hot = (kind) =>
            hoverUI &&
            hoverUI.bag === bag &&
            hoverUI.index === band.index &&
            hoverUI.kind === `shelf-${kind}`;

        ctx.strokeStyle = hot("fold") ? "#ffffff" : withAlpha(colour, 0.85);
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        if (band.folded) {
            ctx.moveTo(PAD + 1, y - 3.5);
            ctx.lineTo(PAD + 5.5, y);
            ctx.lineTo(PAD + 1, y + 3.5);
        } else {
            ctx.moveTo(PAD - 1.5, y - 2);
            ctx.lineTo(PAD + 3, y + 2.5);
            ctx.lineTo(PAD + 7.5, y - 2);
        }
        ctx.stroke();
        ctx.lineWidth = 1;

        const swatchX = PAD + 18;
        ctx.beginPath();
        ctx.arc(swatchX, y, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = colour;
        ctx.fill();
        if (hot("swatch")) {
            ctx.strokeStyle = "#ffffff";
            ctx.stroke();
        }

        const textX = swatchX + 12;
        ctx.font = CAPS_FONT;
        ctx.fillStyle = hot("name") ? "#ffffff" : withAlpha(colour, 0.9);
        ctx.fillText(name, textX, y);
        const nameWidth = ctx.measureText(name).width;

        const count = itemNodes(bag, band.index).length;
        const countText = `${count} node${count === 1 ? "" : "s"}`;
        ctx.font = LABEL_FONT;
        ctx.fillStyle = withAlpha(colour, 0.45);
        ctx.fillText(countText, textX + nameWidth + 8, y);
        const width = nameWidth + 8 + ctx.measureText(countText).width;
        ctx.font = CAPS_FONT;

        const closeX = bag.size[0] - PAD - 6;
        const unpackW = ctx.measureText("UNPACK").width;
        const unpackX = closeX - 16 - unpackW;

        ctx.strokeStyle = withAlpha(colour, 0.25);
        ctx.beginPath();
        ctx.moveTo(textX + width + 10, y);
        ctx.lineTo(unpackX - 10, y);
        ctx.stroke();

        ctx.fillStyle = hot("unpack") ? "#ffffff" : withAlpha(colour, 0.6);
        ctx.fillText("UNPACK", unpackX, y);

        ctx.strokeStyle = hot("close") ? "#ffffff" : withAlpha(colour, 0.5);
        ctx.beginPath();
        ctx.moveTo(closeX - 3.5, y - 3.5);
        ctx.lineTo(closeX + 3.5, y + 3.5);
        ctx.moveTo(closeX + 3.5, y - 3.5);
        ctx.lineTo(closeX - 3.5, y + 3.5);
        ctx.stroke();

        const box = band.box
            ? [
                  band.box[0] - bag.pos[0],
                  band.box[1] - bag.pos[1],
                  band.box[2],
                  band.box[3],
              ]
            : null;

        bag.__shelfUI.push({
            index: band.index,
            fold: [PAD - 6, y - 9, 18, 18],
            swatch: [swatchX - 8, y - 9, 16, 18],
            name: [textX - 4, y - 9, width + 10, 18],
            unpack: [unpackX - 5, y - 9, unpackW + 10, 18],
            close: [closeX - 8, y - 9, 16, 18],
            row: [PAD - 6, y - 9, bag.size[0] - (PAD - 6) * 2, 18],
            box,
        });

        if (box) {
            roundRect(ctx, box[0], box[1], box[2], box[3], SHELF_RADIUS);
            ctx.fillStyle = withAlpha(colour, 0.07);
            ctx.fill();
            ctx.strokeStyle = withAlpha(colour, 0.85);
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.lineWidth = 1;

            if (band.empty) {
                ctx.font = LABEL_FONT;
                ctx.fillStyle = withAlpha(colour, 0.35);
                ctx.fillText(
                    "drop nodes here",
                    box[0] + SHELF_BOX_PAD + 8,
                    box[1] + box[3] / 2
                );
            }
        }

        if (bag.__shelfDropAt === band.index) {
            ctx.strokeStyle = YELLOW;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(PAD, band.labelTop - bag.pos[1] - 5);
            ctx.lineTo(bag.size[0] - PAD, band.labelTop - bag.pos[1] - 5);
            ctx.stroke();
            ctx.lineWidth = 1;
        }
    }
    ctx.restore();
}

// The colour picker still owns the bag's colour; it is simply painted half a
// step darker. A value we did not write ourselves is a fresh choice.
// Some builds drop the alpha channel of node.bgcolor, so the body is left
// transparent and painted here instead.
const CLEAR = "rgba(0,0,0,0)";

function applyBodyColour(bag) {
    const LG = window.LiteGraph;
    const fallback = (LG && LG.NODE_DEFAULT_BGCOLOR) || "#353535";
    // Anything in bgcolor that is not our transparent stand-in was put there by
    // the colour picker or by loading a workflow, so that is the colour to
    // keep. An empty value means the picker was used to clear it.
    if (bag.bgcolor !== CLEAR) {
        bag.properties.baseColor = bag.bgcolor || null;
    }
    bag.bgcolor = CLEAR;

    const opacity =
        bag.properties.opacity === undefined ? 1 : Number(bag.properties.opacity);
    bag.__bodyFill = withAlpha(
        darken(bag.properties.baseColor || fallback, 0.72),
        Math.max(0.05, Math.min(1, opacity))
    );
}

function drawBody(bag, ctx) {
    const LG = window.LiteGraph;
    const radius = (LG && LG.ROUND_RADIUS) || 8;
    roundRect(ctx, 0, 0, bag.size[0], bag.size[1], radius);
    ctx.fillStyle = bag.__bodyFill || "#111214";
    ctx.fill();
}

function shelfColour(bag, index) {
    const colours = bag.properties.shelfColours;
    return (Array.isArray(colours) && colours[index]) || SHELF_DEFAULT;
}

function shelfFolded(bag, index) {
    const folded = bag.properties.shelfFolded;
    return Array.isArray(folded) ? !!folded[index] : false;
}

function toggleShelfFold(bag, index) {
    if (!Array.isArray(bag.properties.shelfFolded)) {
        bag.properties.shelfFolded = [];
    }
    bag.properties.shelfFolded[index] = !bag.properties.shelfFolded[index];
}

function cycleShelfColour(bag, index) {
    if (!Array.isArray(bag.properties.shelfColours)) {
        bag.properties.shelfColours = [];
    }
    const colours = bag.properties.shelfColours;
    const at = SHELF_COLOURS.indexOf(colours[index] || SHELF_DEFAULT);
    colours[index] = SHELF_COLOURS[(at + 1) % SHELF_COLOURS.length];
}

function drawPorts(bag, ctx) {
    for (const port of bag.__ports || []) {
        const x = port.x - bag.pos[0];
        const y = port.y - bag.pos[1];
        ctx.beginPath();
        ctx.arc(x, y, 5.5, 0, Math.PI * 2);
        ctx.fillStyle = bag.bgcolor || "#353535";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x, y, 3.4, 0, Math.PI * 2);
        ctx.fillStyle = port.colour;
        ctx.fill();
    }
}

/* Bag actions ---------------------------------------------------------- */

function spillBelow(bag, nodes) {
    const th = titleHeight();
    let x = bag.pos[0];
    let y = bag.pos[1] + bag.size[1] + 40;
    for (const node of nodes) {
        node.pos[0] = x;
        node.pos[1] = y + th;
        x += Math.max(node.size[0], chipWidth(node)) + 24;
        if (x > bag.pos[0] + 1400) {
            x = bag.pos[0];
            y += 220;
        }
    }
}

function unpackShelf(bag, index) {
    const nodes = itemNodes(bag, index).slice();
    for (const node of nodes) {
        releaseFromBag(bag, node);
    }
    spillBelow(bag, nodes);
    scheduleDrawOrder(bag.graph);
}

function moveShelf(bag, from, to) {
    const shelves = shelfNames(bag);
    let target = to > from ? to - 1 : to;
    target = Math.max(0, Math.min(shelves.length - 1, target));
    if (target === from) {
        return false;
    }

    const order = shelves.map((_, i) => i);
    const [moved] = order.splice(from, 1);
    order.splice(target, 0, moved);

    const [name] = shelves.splice(from, 1);
    shelves.splice(target, 0, name);

    const colours = bag.properties.shelfColours;
    if (Array.isArray(colours)) {
        const [colour] = colours.splice(from, 1);
        colours.splice(target, 0, colour === undefined ? null : colour);
    }

    const map = {};
    order.forEach((old, index) => {
        map[old] = index;
    });
    for (const entry of itemIds(bag)) {
        const shelf = Number(entry.shelf !== undefined ? entry.shelf : entry.layer) || 0;
        entry.shelf = map[shelf] === undefined ? shelf : map[shelf];
        delete entry.layer;
    }
    return true;
}

// A node let go over the bag would otherwise unfold across it. Slide it clear
// along whichever side it is nearest.
function pushClear(bag, node) {
    const th = titleHeight();
    const rect = [node.pos[0], node.pos[1] - th, node.size[0], node.size[1] + th];
    const box = bagRect(bag);
    const overlaps =
        rect[0] < box[0] + box[2] &&
        rect[0] + rect[2] > box[0] &&
        rect[1] < box[1] + box[3] &&
        rect[1] + rect[3] > box[1];
    if (!overlaps) {
        return;
    }
    const moves = [
        [box[0] - (rect[0] + rect[2]) - 24, 0],
        [box[0] + box[2] - rect[0] + 24, 0],
        [0, box[1] - (rect[1] + rect[3]) - 24],
        [0, box[1] + box[3] - rect[1] + 24],
    ];
    moves.sort(
        (a, b) => Math.abs(a[0] + a[1]) - Math.abs(b[0] + b[1])
    );
    node.pos[0] += moves[0][0];
    node.pos[1] += moves[0][1];
}

function emptyBag(bag) {
    const nodes = itemNodes(bag).slice();
    for (const node of nodes) {
        releaseFromBag(bag, node);
    }
    spillBelow(bag, nodes);
    scheduleDrawOrder(bag.graph);
}

// Order the chips by following the wiring between them, so a chip lands next
// to the one that feeds it.
function sortBag(bag) {
    const graph = bag.graph;
    if (!graph) {
        return;
    }
    const entries = itemIds(bag);
    const byId = new Map(entries.map((entry) => [entry.id, entry]));

    for (let shelf = 0; shelf < shelfNames(bag).length; shelf += 1) {
        const nodes = itemNodes(bag, shelf);
        const inside = new Set(nodes.map((node) => node.id));

        const feeders = (node) => {
            const found = [];
            for (const input of node.inputs || []) {
                if (!input || input.link == null) {
                    continue;
                }
                const link = graph.links[input.link];
                if (link && inside.has(link.origin_id)) {
                    found.push(link.origin_id);
                }
            }
            return found;
        };

        const placed = [];
        const seen = new Set();
        const walk = (node) => {
            if (seen.has(node.id)) {
                return;
            }
            seen.add(node.id);
            for (const id of feeders(node)) {
                const source = graph.getNodeById(id);
                if (source) {
                    walk(source);
                }
            }
            placed.push(node.id);
        };
        for (const node of nodes) {
            walk(node);
        }

        let cursor = 0;
        for (let i = 0; i < entries.length; i += 1) {
            if (entryShelf(bag, entries[i]) !== shelf) {
                continue;
            }
            const wanted = byId.get(placed[cursor]);
            cursor += 1;
            if (wanted) {
                entries[i] = wanted;
            }
        }
    }
    scheduleDrawOrder(graph);
}

function addShelf(bag) {
    const shelves = shelfNames(bag);
    if (shelves.length === 1 && !shelves[0]) {
        shelves[0] = "shelf 1";
    }
    shelves.push(`shelf ${shelves.length + 1}`);
}

function removeShelf(bag, index) {
    const shelves = shelfNames(bag);
    if (shelves.length < 2) {
        return;
    }
    shelves.splice(index, 1);
    for (const entry of itemIds(bag)) {
        const shelf = Number(entry.shelf !== undefined ? entry.shelf : entry.layer) || 0;
        if (shelf === index) {
            entry.shelf = Math.max(0, index - 1);
        } else if (shelf > index) {
            entry.shelf = shelf - 1;
        }
        delete entry.layer;
    }
    if (shelves.length === 1) {
        shelves[0] = "";
    }
}

/* Inline text editing -------------------------------------------------- */

// An input element parked exactly over the text it replaces, so renaming
// happens on the node rather than in a browser dialog.
function editInPlace(bag, localRect, value, commit) {
    const canvas = app.canvas;
    const element = canvas && canvas.canvas;
    const scale = canvas && canvas.ds ? canvas.ds.scale : null;
    const offset = canvas && canvas.ds ? canvas.ds.offset : null;

    if (!element || !scale || !offset) {
        const typed = window.prompt("Name", value);
        if (typed !== null) {
            commit(typed);
        }
        return;
    }

    const bounds = element.getBoundingClientRect();
    const left = bounds.left + (bag.pos[0] + localRect[0] + offset[0]) * scale;
    const top = bounds.top + (bag.pos[1] + localRect[1] + offset[1]) * scale;

    const input = document.createElement("input");
    input.type = "text";
    input.value = value;
    input.spellcheck = false;
    Object.assign(input.style, {
        position: "fixed",
        left: `${left}px`,
        top: `${top}px`,
        width: `${Math.max(90, localRect[2]) * scale}px`,
        height: `${localRect[3] * scale}px`,
        boxSizing: "border-box",
        padding: `0 ${4 * scale}px`,
        border: `1px solid ${YELLOW}`,
        borderRadius: `${5 * scale}px`,
        background: "#12151a",
        color: "#fff",
        font: `${Math.max(9, 11 * scale)}px Inter, system-ui, sans-serif`,
        outline: "none",
        zIndex: 10000,
    });

    let done = false;
    const close = (save) => {
        if (done) {
            return;
        }
        done = true;
        if (save) {
            commit(input.value);
        }
        input.remove();
        if (app.canvas) {
            app.canvas.setDirty(true, true);
        }
    };

    input.addEventListener("keydown", (event) => {
        event.stopPropagation();
        if (event.key === "Enter") {
            close(true);
        } else if (event.key === "Escape") {
            close(false);
        }
    });
    input.addEventListener("blur", () => close(true));
    input.addEventListener("pointerdown", (event) => event.stopPropagation());

    document.body.appendChild(input);
    input.focus();
    input.select();
}

/* Node definition ------------------------------------------------------ */

function setupBag(node) {
    node.properties = node.properties || {};
    if (!Array.isArray(node.properties.items)) {
        node.properties.items = [];
    }
    if (node.properties.name === undefined) {
        node.properties.name = "";
    }
    shelfNames(node);

    node.resizable = true;
    if (!node.__bagSized) {
        node.__bagSized = true;
        node.size = [Math.max(MIN_WIDTH, node.size[0] || 0), MIN_HEIGHT];
    }

    node.onDrawBackground = function (ctx) {
        if (this.flags && this.flags.collapsed) {
            return;
        }
        try {
            applyBodyColour(this);
            if (this.__helpOpen) {
                this.size[0] = Math.max(MIN_WIDTH, this.size[0]);
                this.size[1] = Math.max(this.size[1], HELP_HEIGHT);
                this.__appliedHeight = this.size[1];
                for (const item of itemNodes(this)) {
                    item.__bagHidden = true;
                }
                drawBody(this, ctx);
                return;
            }
            drawBody(this, ctx);
            layoutBag(this);
            drawPorts(this, ctx);
            scheduleDrawOrder(this.graph);
        } catch (error) {
            console.error("[VisualNodeBag] draw", error);
        }
    };

    node.onDrawForeground = function (ctx) {
        if (this.flags && this.flags.collapsed) {
            return;
        }
        try {
            drawHeader(this, ctx);
            if (this.__helpOpen) {
                drawHelp(this, ctx);
                drawHelpButton(this, ctx);
                return;
            }
            drawShelves(this, ctx);
            drawHelpButton(this, ctx);
            if (this.__bagHover !== null && this.__bagHover !== undefined) {
                const band = (this.__bands || [])[this.__bagHover];
                if (band) {
                    roundRect(
                        ctx,
                        4,
                        band.top - this.pos[1] - 4,
                        this.size[0] - 8,
                        band.bottom - band.top,
                        8
                    );
                    ctx.strokeStyle = YELLOW;
                    ctx.setLineDash([5, 4]);
                    ctx.lineWidth = 1.5;
                    ctx.stroke();
                    ctx.setLineDash([]);
                }
            }
        } catch (error) {
            console.error("[VisualNodeBag] header", error);
        }
    };

    node.onMouseDown = function (event, pos) {
        for (const button of this.__buttons || []) {
            if (pointInRect(pos[0], pos[1], [button.x, button.y, button.w, button.h])) {
                if (button.id === "sort") {
                    sortBag(this);
                } else if (button.id === "unpack") {
                    emptyBag(this);
                } else if (button.id === "shelf") {
                    addShelf(this);
                }
                this.setDirtyCanvas(true, true);
                return true;
            }
        }

        for (const ui of this.__shelfUI || []) {
            if (pointInRect(pos[0], pos[1], ui.close)) {
                removeShelf(this, ui.index);
                this.setDirtyCanvas(true, true);
                return true;
            }
            if (pointInRect(pos[0], pos[1], ui.name)) {
                const bag = this;
                const shelves = shelfNames(bag);
                editInPlace(bag, ui.name, shelves[ui.index] || "", (value) => {
                    shelves[ui.index] = value.trim() || `shelf ${ui.index + 1}`;
                });
                return true;
            }
        }

        if (this.__nameRect && pointInRect(pos[0], pos[1], this.__nameRect)) {
            const bag = this;
            editInPlace(bag, this.__nameRect, bag.properties.name || "", (value) => {
                bag.properties.name = value.trim();
            });
            return true;
        }
        return false;
    };

    node.onSerialize = function (data) {
        // The body is painted by hand, so bgcolor is held transparent while the
        // node is on screen. Save the real colour instead, or the workflow
        // comes back colourless.
        if (this.properties && this.properties.baseColor) {
            data.bgcolor = this.properties.baseColor;
        } else {
            delete data.bgcolor;
        }
    };

    node.onResize = function (size) {
        this.size[0] = Math.max(MIN_WIDTH, this.size[0]);
        // Remember what the user asked for: the layout only ever grows past it.
        this.properties.height = Math.max(MIN_HEIGHT, Math.round(this.size[1]));
        if (size) {
            size[0] = this.size[0];
        }
        this.setDirtyCanvas(true, true);
    };

    node.onRemoved = function () {
        // Never leave nodes stranded in a collapsed state with no bag around.
        try {
            const items = itemNodes(this).slice();
            for (const item of items) {
                releaseFromBag(this, item);
            }
            spillBelow(this, items);
        } catch (error) {
            console.error("[VisualNodeBag] removed", error);
        }
    };
}

/* Interaction ---------------------------------------------------------- */

function canvasPoint(event) {
    const canvas = app.canvas;
    if (!canvas || typeof canvas.convertEventToCanvasOffset !== "function") {
        return null;
    }
    return canvas.convertEventToCanvasOffset(event);
}

// Menus, dialogs and DOM widgets float above the canvas. A press that landed
// on one of those is none of the bag's business, even though it sits over the
// bag in canvas coordinates.
function isCanvasEvent(event) {
    // Any canvas will do: some builds stack a background and a front canvas,
    // and which one receives the press is not ours to predict. What matters is
    // that it is not a menu, a dialog or a DOM widget.
    const target = event && event.target;
    return !!target && target.tagName === "CANVAS";
}

// The bag places every chip itself, so its own arithmetic is more reliable
// here than asking the graph what is under the pointer.
function chipAt(bag, point) {
    for (const node of itemNodes(bag)) {
        if (node.__bagHidden) {
            continue;
        }
        if (pointInRect(point[0], point[1], chipRect(node))) {
            return node;
        }
    }
    return null;
}

function nodeAt(point) {
    if (!point || !app.graph || !app.graph.getNodeOnPos) {
        return null;
    }
    return app.graph.getNodeOnPos(point[0], point[1], app.graph._nodes);
}

function bandAt(bag, y) {
    const bands = bag.__bands || [];
    for (const band of bands) {
        if (y >= band.top && y <= band.bottom) {
            return band.index;
        }
    }
    return bands.length ? bands[bands.length - 1].index : 0;
}

function bagUnderPoint(graph, point) {
    const [cx, cy] = point;
    for (const bag of bagsInGraph(graph)) {
        if (bag.flags && bag.flags.collapsed) {
            continue;
        }
        if (pointInRect(cx, cy, bagRect(bag))) {
            return bag;
        }
    }
    return null;
}

function positionInShelf(bag, shelf, x, y) {
    const slots = (bag.__slots || []).filter((slot) => slot.shelf === shelf);
    for (let i = 0; i < slots.length; i += 1) {
        const slot = slots[i];
        if (y < slot.y + slot.h / 2 && x < slot.x + slot.w / 2) {
            return i;
        }
    }
    return slots.length;
}

function movedNodes(dragged) {
    const canvas = app.canvas;
    const selected = canvas && canvas.selected_nodes;
    if (selected && selected[dragged.id]) {
        return Object.values(selected);
    }
    // selected_nodes is not present on every build; the flag on the node is.
    const graph = app.graph;
    if (graph && graph._nodes && dragged.selected) {
        const flagged = graph._nodes.filter((node) => node.selected);
        if (flagged.length > 1 && flagged.includes(dragged)) {
            return flagged;
        }
    }
    return [dragged];
}

function handleDrop(dropped) {
    const graph = app.graph;
    if (!graph || !dropped) {
        return;
    }
    let changed = false;

    // Everything dragged together goes to the shelf the pointer is over, in
    // the order the nodes were laid out on the canvas. Letting each one find
    // its own shelf scatters a selection across the bag.
    const lead = dropped.find((item) => item.point);
    if (lead && dropped.length > 1) {
        const probe = lead.point;
        const target = bagUnderPoint(graph, probe);
        if (target) {
            try {
                layoutBag(target);
            } catch (error) {
                /* use whatever the last frame produced */
            }
            const shelf = bandAt(target, probe[1]);
            let position = positionInShelf(target, shelf, probe[0], probe[1]);
            const group = dropped
                .filter((item) => item.node && !isBag(item.node))
                .sort(
                    (a, b) =>
                        a.pos[1] - b.pos[1] || a.pos[0] - b.pos[0]
                );
            for (const item of group) {
                const holder = bagHolding(item.node);
                if (holder && holder.flags && holder.flags.collapsed) {
                    continue;
                }
                if (holder === target) {
                    const entries = itemIds(target);
                    const from = entries.findIndex((e) => e.id === item.node.id);
                    if (from !== -1) {
                        const [entry] = entries.splice(from, 1);
                        entry.shelf = shelf;
                        delete entry.layer;
                        entries.splice(
                            globalIndex(target, shelf, position),
                            0,
                            entry
                        );
                        changed = true;
                    }
                } else if (addToBag(target, item.node, shelf, position)) {
                    changed = true;
                }
                position += 1;
            }
            for (const bag of bagsInGraph(graph)) {
                bag.__bagHover = null;
            }
            if (changed) {
                scheduleDrawOrder(graph);
            }
            if (app.canvas) {
                app.canvas.setDirty(true, true);
            }
            return;
        }
    }

    for (const item of dropped) {
        const node = item.node;
        if (!node || isBag(node)) {
            continue;
        }
        const rect = chipRect(node);
        rect[0] = item.pos[0];
        rect[1] = item.pos[1] - titleHeight();
        // The pointer is what the eye is aiming with. Using the middle of the
        // node instead makes a tall node land half its own height too low.
        const probe = item.point || rectCentre(rect);
        const current = bagHolding(node);
        if (current && current.flags && current.flags.collapsed) {
            // Nothing inside a folded bag can be dropped anywhere.
            continue;
        }
        const target = bagUnderPoint(graph, probe);

        if (target) {
            try {
                layoutBag(target);
            } catch (error) {
                /* use whatever the last frame produced */
            }
            const shelf = bandAt(target, probe[1]);
            const position = positionInShelf(target, shelf, probe[0], probe[1]);
            if (current === target) {
                const entries = itemIds(target);
                const from = entries.findIndex((entry) => entry.id === node.id);
                if (from !== -1) {
                    const [entry] = entries.splice(from, 1);
                    entry.shelf = shelf;
                    delete entry.layer;
                    entries.splice(globalIndex(target, shelf, position), 0, entry);
                    changed = true;
                }
            } else {
                changed = addToBag(target, node, shelf, position) || changed;
            }
        } else if (current) {
            if (releaseFromBag(current, node)) {
                // A frame may already have snapped it back into its slot, so
                // the position it was let go at is put back first.
                node.pos[0] = item.pos[0];
                node.pos[1] = item.pos[1];
                pushClear(current, node);
                changed = true;
            }
        }
    }

    for (const bag of bagsInGraph(graph)) {
        bag.__bagHover = null;
    }

    if (changed) {
        scheduleDrawOrder(graph);
    }
    if (app.canvas) {
        app.canvas.setDirty(true, true);
    }
}

function highlightTarget(dragged, point) {
    const graph = app.graph;
    if (!graph) {
        return;
    }
    let target = null;
    let band = null;
    if (dragged && !isBag(dragged) && point) {
        target = bagUnderPoint(graph, point);
        if (target) {
            band = bandAt(target, point[1]);
        }
    }
    let changed = false;
    for (const bag of bagsInGraph(graph)) {
        const wanted = bag === target ? band : null;
        if (bag.__bagHover !== wanted) {
            bag.__bagHover = wanted;
            changed = true;
        }
    }
    if (changed && app.canvas) {
        app.canvas.setDirty(true, true);
    }
}

function closeOpenChips(except) {
    const graph = app.graph;
    if (!graph) {
        return;
    }
    let changed = false;
    for (const bag of bagsInGraph(graph)) {
        for (const node of itemNodes(bag)) {
            if (node !== except && node.__bagOpen) {
                node.__bagOpen = false;
                node.flags.collapsed = true;
                changed = true;
            }
        }
    }
    if (changed) {
        scheduleDrawOrder(graph);
        if (app.canvas) {
            app.canvas.setDirty(true, true);
        }
    }
}

function applyCursor(event) {
    const canvas = app.canvas;
    const element = canvas && canvas.canvas;
    if (!element || activeDrag || !isCanvasEvent(event)) {
        return;
    }
    const point = canvasPoint(event);
    const node = nodeAt(point);
    const ui = hitBagUI(point);
    const previous = hoverUI;
    hoverUI = ui && ui.kind !== "body" && ui.kind !== "resize" ? ui : null;
    if (
        (previous && previous.kind) !== (hoverUI && hoverUI.kind) ||
        (previous && previous.index) !== (hoverUI && hoverUI.index) ||
        (previous && previous.button && previous.button.id) !==
            (hoverUI && hoverUI.button && hoverUI.button.id)
    ) {
        if (app.canvas) {
            app.canvas.setDirty(true, true);
        }
    }
    if (node && bagHolding(node)) {
        element.style.cursor = "pointer";
        return;
    }
    if (ui) {
        if (ui.kind === "opacity") {
            element.style.cursor = "ew-resize";
        } else if (ui.kind === "resize") {
            element.style.cursor = "nwse-resize";
        } else if (ui.kind === "body") {
            element.style.cursor = "default";
        } else {
            element.style.cursor = "pointer";
        }
    }
}

// Some frontend builds never call node.onMouseDown, so every piece of bag
// chrome is hit-tested here instead, straight from the canvas coordinates.
function hitBagUI(point) {
    const graph = app.graph;
    if (!graph || !point) {
        return null;
    }
    for (const bag of bagsInGraph(graph)) {
        if (bag.flags && bag.flags.collapsed) {
            continue;
        }
        if (!pointInRect(point[0], point[1], bagRect(bag))) {
            continue;
        }
        // Chips are painted on top of the bag, so they own any point they
        // cover.
        if (chipAt(bag, point)) {
            return null;
        }

        const local = [point[0] - bag.pos[0], point[1] - bag.pos[1]];

        // While a chip is open its body spreads over the shelves underneath,
        // and a widget of its own may sit anywhere in there. Rather than try to
        // work out exactly where it ends, the bag simply stops claiming the
        // area below its header until the chip is put away again.
        const opened = itemNodes(bag).some(
            (node) => !(node.flags && node.flags.collapsed)
        );
        if (opened && local[1] > HEADER) {
            return null;
        }

        for (const button of bag.__buttons || []) {
            if (pointInRect(local[0], local[1], [button.x, button.y, button.w, button.h])) {
                return { bag, kind: "button", button };
            }
        }
        for (const ui of bag.__shelfUI || []) {
            for (const kind of ["close", "unpack", "fold", "swatch", "name", "row"]) {
                if (ui[kind] && pointInRect(local[0], local[1], ui[kind])) {
                    return { bag, kind: `shelf-${kind}`, index: ui.index, rect: ui.name };
                }
            }
        }
        // Empty space inside a shelf box drags the shelf.
        for (const ui of bag.__shelfUI || []) {
            if (ui.box && pointInRect(local[0], local[1], ui.box)) {
                return { bag, kind: "shelf-row", index: ui.index, rect: ui.name };
            }
        }
        if (bag.__helpRect && pointInRect(local[0], local[1], bag.__helpRect)) {
            return { bag, kind: "help" };
        }
        if (bag.__opacityRect && pointInRect(local[0], local[1], bag.__opacityRect)) {
            return { bag, kind: "opacity", rect: bag.__opacityRect };
        }
        if (bag.__nameRect && pointInRect(local[0], local[1], bag.__nameRect)) {
            return { bag, kind: "bagName", rect: bag.__nameRect };
        }
        if (
            local[0] > bag.size[0] - 16 &&
            local[1] > bag.size[1] - 16
        ) {
            return { bag, kind: "resize" };
        }
        return { bag, kind: "body" };
    }
    return null;
}

function shelfDropIndex(bag, y) {
    const bands = bag.__bands || [];
    for (const band of bands) {
        if (y < band.top + (band.bottom - band.top) / 2) {
            return band.index;
        }
    }
    return bands.length;
}

function installListeners() {
    let pressed = null;
    let pressedClient = null;
    let shelfPending = null;
    let shelfDrag = null;
    let opacityDrag = null;

    const setOpacity = (bag, x) => {
        const rect = bag.__opacityRect;
        if (!rect) {
            return;
        }
        const value = (x - bag.pos[0] - rect[0]) / rect[2];
        bag.properties.opacity = Math.max(0.05, Math.min(1, value));
        bag.setDirtyCanvas(true, true);
    };

    const clearShelfDrag = () => {
        if (shelfDrag) {
            shelfDrag.bag.__shelfDropAt = null;
            shelfDrag.bag.setDirtyCanvas(true, true);
        }
        shelfPending = null;
        shelfDrag = null;
    };

    window.addEventListener(
        "pointerdown",
        (event) => {
            if (!isCanvasEvent(event)) {
                return;
            }
            activeDrag = null;
            pressed = null;
            pressedClient = null;
            const point = canvasPoint(event);
            const ui = hitBagUI(point);
            if (ui && ui.kind !== "body" && ui.kind !== "resize") {
                event.preventDefault();
                event.stopPropagation();
                const bag = ui.bag;
                // Touching the bag's own chrome also puts an opened chip away.
                closeOpenChips(null);
                if (ui.kind === "button") {
                    if (ui.button.id === "sort") {
                        sortBag(bag);
                    } else if (ui.button.id === "unpack") {
                        emptyBag(bag);
                    } else if (ui.button.id === "shelf") {
                        addShelf(bag);
                    }
                } else if (ui.kind === "shelf-close") {
                    removeShelf(bag, ui.index);
                } else if (ui.kind === "shelf-unpack") {
                    unpackShelf(bag, ui.index);
                } else if (ui.kind === "shelf-swatch") {
                    cycleShelfColour(bag, ui.index);
                } else if (ui.kind === "shelf-fold") {
                    toggleShelfFold(bag, ui.index);
                } else if (ui.kind === "help") {
                    bag.__helpOpen = !bag.__helpOpen;
                } else if (ui.kind === "opacity") {
                    opacityDrag = bag;
                    setOpacity(bag, point[0]);
                } else {
                    // A name can be clicked to rename or dragged to reorder;
                    // which one it is only becomes clear on the next move.
                    shelfPending = {
                        bag,
                        index: ui.index,
                        rename: ui.kind === "shelf-name",
                        rect: ui.rect,
                        client: [event.clientX, event.clientY],
                    };
                }
                bag.setDirtyCanvas(true, true);
                return;
            }
            let hit = nodeAt(point);
            if (!hit && point) {
                for (const bag of bagsInGraph(app.graph)) {
                    hit = chipAt(bag, point);
                    if (hit) {
                        break;
                    }
                }
            }
            closeOpenChips(hit);
            if (hit) {
                pressed = hit;
                pressedClient = [event.clientX, event.clientY];
            }
        },
        true
    );

    // The layout snaps a held chip back into place every frame, so its own
    // position can never be used to detect the drag. Pointer travel can.
    const draggingNow = (event) => {
        const canvas = app.canvas;
        if (canvas && canvas.node_dragged) {
            return canvas.node_dragged;
        }
        if (!pressed || !pressedClient || !event) {
            return null;
        }
        const dx = event.clientX - pressedClient[0];
        const dy = event.clientY - pressedClient[1];
        return dx * dx + dy * dy > DRAG_SLOP * DRAG_SLOP ? pressed : null;
    };

    window.addEventListener(
        "pointermove",
        (event) => {
            if (opacityDrag) {
                const point = canvasPoint(event);
                if (point) {
                    setOpacity(opacityDrag, point[0]);
                }
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            if (shelfPending) {
                const dx = event.clientX - shelfPending.client[0];
                const dy = event.clientY - shelfPending.client[1];
                if (dx * dx + dy * dy > DRAG_SLOP * DRAG_SLOP) {
                    shelfDrag = shelfPending;
                    shelfPending = null;
                }
            }
            if (shelfDrag) {
                const point = canvasPoint(event);
                if (point) {
                    shelfDrag.bag.__shelfDropAt = shelfDropIndex(
                        shelfDrag.bag,
                        point[1]
                    );
                    shelfDrag.bag.setDirtyCanvas(true, true);
                }
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            const node = draggingNow(event);
            if (node) {
                activeDrag = node;
                highlightTarget(node, canvasPoint(event));
            }
        },
        true
    );

    // Bubble phase, so LiteGraph has already set its own cursor for the frame.
    window.addEventListener("pointermove", (event) => {
        try {
            applyCursor(event);
        } catch (error) {
            /* cursor styling is cosmetic */
        }
    });

    const finish = (event) => {
        if (opacityDrag) {
            opacityDrag = null;
            return;
        }
        if (shelfDrag) {
            const bag = shelfDrag.bag;
            const to = bag.__shelfDropAt;
            if (to !== null && to !== undefined) {
                moveShelf(bag, shelfDrag.index, to);
            }
            clearShelfDrag();
            return;
        }
        if (shelfPending) {
            const { bag, index, rename, rect } = shelfPending;
            shelfPending = null;
            if (rename) {
                const shelves = shelfNames(bag);
                editInPlace(bag, rect, shelves[index] || "", (value) => {
                    shelves[index] = value.trim() || `shelf ${index + 1}`;
                });
            }
            return;
        }
        const node = activeDrag || draggingNow(event);
        activeDrag = null;
        pressed = null;
        pressedClient = null;
        if (!node) {
            return;
        }
        // Where things were let go. A frame can be drawn before the timeout
        // fires, and that frame snaps every chip back into its slot.
        const point = canvasPoint(event);
        const dropped = movedNodes(node).map((item) => ({
            node: item,
            pos: [item.pos[0], item.pos[1]],
            // Only the node under the cursor gets to use it; anything else
            // dragged along with it falls back to its own middle.
            point: item === node ? point : null,
        }));
        // Let LiteGraph settle its own bookkeeping first.
        setTimeout(() => {
            try {
                handleDrop(dropped);
            } catch (error) {
                console.error("[VisualNodeBag] drop", error);
            }
        }, 0);
    };

    window.addEventListener("pointerup", finish, true);
    window.addEventListener("pointercancel", finish, true);
}

// A folded shelf hides its chips. They stay in the graph untouched; the canvas
// is simply told to skip painting them.
function patchNodeDrawing() {
    const LGC = window.LGraphCanvas;
    if (!LGC || !LGC.prototype || LGC.prototype.__bagDrawPatched) {
        return;
    }
    const original = LGC.prototype.drawNode;
    if (typeof original !== "function") {
        return;
    }
    LGC.prototype.drawNode = function (node) {
        if (node && node.__bagHidden) {
            return;
        }
        return original.apply(this, arguments);
    };
    LGC.prototype.__bagDrawPatched = true;
}

/* Registration --------------------------------------------------------- */

app.registerExtension({
    name: "StudioLeiel.VisualNodeBag",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== BAG_TYPE) {
            return;
        }

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const result = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;
            this.title = this.title || "Visual Node Bag";
            setupBag(this);
            return result;
        };

        const onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            const result = onConfigure ? onConfigure.apply(this, arguments) : undefined;
            setupBag(this);
            const node = this;
            setTimeout(() => {
                try {
                    for (const item of itemNodes(node)) {
                        item.flags = item.flags || {};
                        item.flags.collapsed = true;
                        hideBadges(item);
                        captureConnectionPos(item);
                    }
                    scheduleDrawOrder(node.graph);
                } catch (error) {
                    console.error("[VisualNodeBag] configure", error);
                }
            }, 0);
            return result;
        };
    },

    async setup() {
        installListeners();
        patchNodeDrawing();
    },
});
