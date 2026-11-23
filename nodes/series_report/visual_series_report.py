# Copyright 2026 Studio Leiel
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""
Studio Leiel - Visual Series Report
--------------------------------------------------
What a series has made so far, counted. Every render says what made it - the
series and scene it belongs to, its LoRAs and their strengths, the sampler,
the options a recipe set - and every render ends up in one of three places:
picked, deleted, or left as it is. Put the two side by side and a folder of
several hundred pictures reads as a table: which recipe gets picked, which
one breaks, which scene still has nothing worth keeping.

And every render is measured once: how bright it is, how much contrast it
has, how saturated and how warm, the five colours it is mostly made of, and
where its detail sits in the frame. That is plain pixel arithmetic on a small
copy of the picture - no model, a fraction of a second a render - and it turns
the table into a look: where a series sits in tone, how its colour moves from
cut to cut, and how far each LoRA, sampler or option moves a picture.

Nothing here changes a picture. The recipe is read from the PNG the way the
Visual Image Viewer reads it, through the viewer's own code; a pick is a line
in the viewer's picks.json; a deleted picture is one sitting in a _deleted
folder. This module only measures and remembers.

A series named the way a season is - S1E4 The Burning Rose Garden - is an
episode: the episodes of a season are shown together, then one episode, then
one cut of it.

It has to remember because the pictures do not stay. A finished series is
often moved to another disk; its renders are kept in the ledger with what was
last seen of them - picked, left or deleted - and counted as archived, with
their measures, times and small copies, so the analysis does not lose them.
 Emptying the bin takes
the deleted renders away, and with them the only record that a recipe failed
- so each render is written once into a ledger, a single SQLite file in the
user folder, and a render last seen in the bin stays counted as deleted after
the bin is emptied. A render that vanishes any other way is left out of the
counts until it turns up again: moved pictures are recognised by what is
written inside them, not by where they are, and a copy of a render is not
counted twice.

Only the places the viewer may open are read - the output folder and whatever
is listed in the viewer's allowed_folders.txt. The input folder is left
alone: what is in there is a copy of something already counted, or not a
render at all.
"""

import csv
import hashlib
import io
import json
import os
import re
import sqlite3
import threading
import time

from PIL import Image, ImageFilter, ImageStat

REPORT_DIRNAME = "visual_series_report"
DB_FILENAME = "ledger.sqlite3"

LOOK_VERSION = 2        # raised when what is measured changes: older looks are measured again
THUMB_DIRNAME = "thumbs"
THUMB_SIDE = 200        # the long side of the small copy kept for the wall
WALL_PER_CELL = 12      # pictures sent for one cell of the wall
LOOK_SIDE = 256         # the long side of the copy a render is measured on
PALETTE = 5             # main colours kept for a render, and for a cut
GRID = 8                # the detail map is GRID x GRID cells
METRICS = ("b", "c", "s", "w")   # brightness, contrast, saturation, warmth - all 0..100

SEASON_PREFIX = "season:"

# Render time. A: the seconds the Visual Suite writes into each PNG as it is
# saved (leiel_render). B, for pictures made before that or without the pack:
# the time between a render and the one saved before it - renders run one
# after another, so that gap is the render, as long as nothing else happened
# in between. A gap longer than GAP_CAP is a pause, not a render, and gives
# no time at all. B is always shown as an estimate.
RENDER_KEY = "leiel_render"
GAP_CAP = 15 * 60
# S1E4, s01e04, S1 E4 - anywhere in the name, not inside a longer word
_EPISODE = re.compile(r"(?<![A-Za-z0-9])S(\d{1,3})\s?E(\d{1,3})(?!\d)", re.I)

try:
    _MEDIANCUT = Image.Quantize.MEDIANCUT
except AttributeError:                               # pragma: no cover - old Pillow
    _MEDIANCUT = 0

ALWAYS_SHARE = 0.95     # a LoRA in this share of the renders compares nothing
THIN = 10               # fewer renders than this and a rate is only a hint
LISTING_TTL = 2.0       # seconds a folder's listing is trusted for
NO_SERIES = "\x00"      # how the browser asks for renders outside any series
FOLLOW_CAP = 1500       # files read at once when a folder is followed

# Settings every sampler has. They are read from the graph as it ran, so a
# sampler swept by the Series Lab and one set by hand land on the same axis.
_SETTINGS = ("sampler", "scheduler", "steps", "cfg")
_SETTING_WIDGETS = {"sampler_name", "scheduler", "steps", "cfg", "denoise",
                    "seed", "noise_seed"}

_SCHEMA = """
CREATE TABLE IF NOT EXISTS renders(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fp TEXT UNIQUE NOT NULL,
  home TEXT NOT NULL,
  name TEXT NOT NULL,
  mtime REAL,
  size INTEGER,
  w INTEGER,
  h INTEGER,
  series TEXT NOT NULL DEFAULT '',
  scene_id INTEGER,
  scene_no TEXT NOT NULL DEFAULT '',
  scene_name TEXT NOT NULL DEFAULT '',
  seed TEXT NOT NULL DEFAULT '',
  recipe TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT '',
  added REAL
);
CREATE INDEX IF NOT EXISTS renders_series ON renders(series);
CREATE TABLE IF NOT EXISTS files(
  path TEXT PRIMARY KEY,
  mtime REAL,
  fp TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS aliases(
  name TEXT PRIMARY KEY,
  same_as TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS looks(
  fp TEXT PRIMARY KEY,
  v INTEGER NOT NULL,
  data TEXT NOT NULL
);
"""


def _episode(series):
    """(season, episode) for a series named like S1E4 ..., else None."""
    m = _EPISODE.search(series or "")
    return (int(m.group(1)), int(m.group(2))) if m else None


def _viewer():
    """The Visual Image Viewer of this pack - as a package inside ComfyUI,
    or side by side when loaded on its own."""
    try:
        from ..image_viewer import visual_image_viewer as v
    except Exception:
        import image_viewer.visual_image_viewer as v          # noqa: E402
    return v


# ------------------------------------------------------------------ ledger
# One connection at a time, opened for the job and closed after it. The rows
# are also kept in memory, parsed, so a summary never reads the file: it is
# asked for every few seconds while a run is going.
_lock = threading.RLock()
_mem = {"loaded": False, "rows": {}, "by_fp": {}, "files": {}, "aliases": {}, "looks": {}}


def _db_path():
    return os.path.join(_viewer()._user_dir(), REPORT_DIRNAME, DB_FILENAME)


_migrated = set()


def _connect():
    path = _db_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    con = sqlite3.connect(path, timeout=15)
    con.row_factory = sqlite3.Row
    # write-ahead, so a summary can read while a scan is writing
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA synchronous=NORMAL")
    con.executescript(_SCHEMA)
    if path not in _migrated:
        # columns added after the first ledgers were written
        have = {r["name"] for r in con.execute("PRAGMA table_info(renders)")}
        for col in ("away", "carry"):
            if col not in have:
                con.execute("ALTER TABLE renders ADD COLUMN %s INTEGER NOT NULL DEFAULT 0" % col)
        con.commit()
        _migrated.add(path)
    return con


def _row_dict(r):
    d = dict(r)
    try:
        d["recipe"] = json.loads(d.get("recipe") or "{}")
    except ValueError:
        d["recipe"] = {}
    return d


def _load():
    with _lock:
        if _mem["loaded"]:
            return
        con = _connect()
        try:
            rows = {}
            for r in con.execute("SELECT * FROM renders ORDER BY id"):
                d = _row_dict(r)
                rows[d["id"]] = d
            _mem["rows"] = rows
            _mem["by_fp"] = {d["fp"]: d["id"] for d in rows.values()}
            _mem["files"] = {r["path"]: (r["mtime"], r["fp"])
                             for r in con.execute("SELECT * FROM files")}
            _mem["aliases"] = {r["name"]: r["same_as"]
                               for r in con.execute("SELECT * FROM aliases")}
            looks = {}
            # older looks are kept and shown until they are measured again;
            # one whose picture is gone keeps what it had
            for r in con.execute("SELECT fp, v, data FROM looks"):
                try:
                    look = json.loads(r["data"])
                except ValueError:
                    continue
                look["_v"] = r["v"]
                looks[r["fp"]] = look
            _mem["looks"] = looks
            _mem["loaded"] = True
        finally:
            con.close()


# ------------------------------------------------------- reading one render
def _home(path):
    """(where the picture lives when it is not in the bin, in the bin now)."""
    v = _viewer()
    folder, name = os.path.split(path)
    if os.path.basename(folder) == v.TRASH_DIR:
        return os.path.join(os.path.dirname(folder), name), True
    return path, False


def _linked(value):
    return isinstance(value, list) and len(value) == 2 and isinstance(value[1], int)


def _seed(graph):
    for key in ("noise_seed", "seed"):
        for n in graph.values():
            ins = n.get("inputs") if isinstance(n, dict) else None
            if not isinstance(ins, dict) or key not in ins or _linked(ins[key]):
                continue
            if key == "seed" and not any(k in ins for k in ("steps", "sampler_name")):
                continue
            return str(ins[key])
    return ""


def _title(graph, node_id):
    n = graph.get(str(node_id))
    if not isinstance(n, dict):
        return ""
    meta = n.get("_meta")
    title = meta.get("title") if isinstance(meta, dict) else None
    return str(title or n.get("class_type") or "")


def _lab_current(graph):
    """What the Series Lab wrote for this render, or None."""
    for n in graph.values():
        if isinstance(n, dict) and n.get("class_type") == "VisualSeriesLabSetup":
            try:
                cur = json.loads((n.get("inputs") or {}).get("current_json") or "{}")
            except (TypeError, ValueError):
                return None
            return cur if isinstance(cur, dict) else None
    return None


def _book_base():
    try:
        return int(_viewer()._lab_modules()[0].BOOK_SLOT_BASE)
    except Exception:
        return 1000


def _render_time(info):
    """{'secs': seconds, 'saved': unix time} from a PNG's leiel_render, or {}."""
    raw = info.get(RENDER_KEY)
    try:
        t = json.loads(raw) if isinstance(raw, str) else None
        secs = float(t.get("seconds"))
    except (TypeError, ValueError, AttributeError):
        return {}
    if not (0 < secs < 6 * 3600):
        return {}
    out = {"secs": round(secs, 2)}
    try:
        out["saved"] = float(t.get("saved"))
    except (TypeError, ValueError):
        pass
    return out


def _anchors(meta):
    """The cut's own words, anchor by anchor: {anchor: [short hash, capsule
    name]}, and the anchors a capsule swap stood in for. Trigger words and
    swapped capsules are left out - they are recipe, not the cut's prompt -
    so a version changes only when the prompt itself was written again."""
    words, swapped = {}, []
    secs = [x for x in meta.get("sections") or [] if isinstance(x, dict)]
    for x in secs:
        kind = str(x.get("kind") or "").strip().upper() or "PROMPT"
        if x.get("swapped"):
            if kind not in swapped:
                swapped.append(kind)
            continue
        text = " ".join(str(x.get("text") or "").split())
        if not text:
            continue
        h = hashlib.sha1(text.encode("utf-8", "replace")).hexdigest()[:8]
        if kind in words:
            words[kind] = [words[kind][0] + h, words[kind][1]]
        else:
            words[kind] = [h, str(x.get("name") or "")]
    if not secs:
        text = str(meta.get("prompt") or "")
        for t in meta.get("triggers") or []:
            text = text.replace(str(t), " ")
        text = " ".join(text.replace(",", " ").split())
        if text:
            words["PROMPT"] = [hashlib.sha1(text.encode("utf-8", "replace")).hexdigest()[:8], ""]
    return words, swapped


def _read(path):
    """A render as the ledger keeps it, or None when the file is not one.
    Raises OSError when the file cannot be read at all."""
    v = _viewer()
    st = os.stat(path)
    with Image.open(path) as im:
        info = dict(im.info or {})
        w, h = im.size
    raw = info.get("prompt")
    if not isinstance(raw, str) or not raw:
        return None
    try:
        graph = json.loads(raw)
    except ValueError:
        return None
    if not isinstance(graph, dict):
        return None
    meta = v._meta(path)
    if not meta.get("ok"):
        return None

    loras = []
    for e in meta.get("loras") or []:
        name = os.path.splitext(os.path.basename(str(e.get("name") or "").replace("\\", "/")))[0]
        if not name:
            continue
        try:
            strength = round(float(e.get("strength", 1.0)), 3)
        except (TypeError, ValueError):
            strength = 1.0
        loras.append([name, strength])

    opts, seen = [], set()
    for s in meta.get("settings") or []:
        label = str(s.get("label") or "")
        if label in _SETTINGS and label not in seen:
            seen.add(label)
            opts.append(["setting::" + label, label, str(s.get("value"))])

    scene_id, scene_no = None, ""
    cur = _lab_current(graph)
    if cur:
        try:
            slot = int(cur.get("prompt_slot") or 0)
        except (TypeError, ValueError):
            slot = 0
        base = _book_base()
        if slot >= base:
            scene_id = slot - base
        scene_no = str(cur.get("prompt_no") or "")
        for c in cur.get("chips") or []:
            if not isinstance(c, dict):
                continue
            key = str(c.get("key") or "")
            node_id, _, widget = key.partition("::")
            if not widget or widget in _SETTING_WIDGETS:
                continue
            title = _title(graph, node_id) or "node " + node_id
            okey = title + "::" + widget
            if okey in seen:
                continue
            seen.add(okey)
            opts.append([okey, title + " - " + widget, str(c.get("value"))])

    caps = [[str(s.get("kind") or ""), str(s.get("name") or ""), bool(s.get("swapped"))]
            for s in meta.get("sections") or [] if isinstance(s, dict) and s.get("name")]
    words, swapped = _anchors(meta)

    home, _ = _home(path)
    digest = hashlib.sha1(raw.encode("utf-8", "replace")).hexdigest()[:20]
    return {
        "fp": "%s-%d" % (digest, st.st_size),
        "home": home,
        "name": os.path.basename(path),
        "mtime": st.st_mtime,
        "size": st.st_size,
        "w": int(w), "h": int(h),
        "series": str(meta.get("series_name") or ""),
        "scene_id": scene_id,
        "scene_no": scene_no,
        "scene_name": str(meta.get("prompt_name") or "") if cur else "",
        "seed": _seed(graph),
        "recipe": {"loras": loras, "opts": opts, "caps": caps,
                   "triggers": [str(t) for t in meta.get("triggers") or []],
                   "av": words, "sw": swapped,
                   **_render_time(info)},
    }


# ------------------------------------------------------------ where it is
_listings = {}


def _listing(folder):
    """The names in a folder, lower-cased the way the system compares them -
    or None when the folder is not there. Kept for a moment: a summary asks
    about every render of a series, and they sit in a few folders."""
    now = time.time()
    hit = _listings.get(folder)
    if hit and now - hit[0] < LISTING_TTL:
        return hit[1]
    try:
        with os.scandir(folder) as it:
            names = frozenset(os.path.normcase(e.name) for e in it)
    except OSError:
        names = None
    if len(_listings) > 4000:
        _listings.clear()
    _listings[folder] = (now, names)
    return names


def _where(row):
    """'home', 'bin' or '' for a render that is in neither place."""
    v = _viewer()
    folder, name = os.path.split(row["home"])
    key = os.path.normcase(name)
    here = _listing(folder)
    if here is None:
        return ""
    if key in here:
        return "home"
    if os.path.normcase(v.TRASH_DIR) in here:
        binned = _listing(os.path.join(folder, v.TRASH_DIR))
        if binned and key in binned:
            return "bin"
    return ""


def _pick_key(row):
    """The render's path as picks.json spells it. Worked out once: resolving
    a path asks the disk about every folder on the way."""
    key = row.get("_key")
    if key is None or row.get("_key_of") != row["home"]:
        key = _viewer()._key(row["home"])
        row["_key"], row["_key_of"] = key, row["home"]
    return key


def _states(rows):
    """{id: 'pick' | 'kept' | 'deleted' | 'gone'} - and the ledger brought up
    to date with what is seen.

    What is seen of a render is written down every time: picked, left or
    deleted. A render whose picture is no longer where the report reads -
    a finished series moved to another disk - keeps what was last seen and
    is marked away: still counted, as archived. Only a render nothing was
    ever seen of is left out ('gone').

    A render moved by hand to a folder the report reads carries its pick
    with it (carry): the viewer keeps picks by path and would not know it."""
    v = _viewer()
    picks = v._picks()
    out, changed = {}, []
    for r in rows:
        at = _where(r)
        away = 0
        carry = r.get("carry") or 0
        if at == "home":
            if _pick_key(r) in picks:
                st, carry = "pick", 0
            elif carry and r["state"] == "pick":
                st = "pick"
            else:
                st, carry = "kept", 0
        elif at == "bin":
            st, carry = "deleted", 0
        elif r["state"] in ("pick", "kept", "deleted"):
            st, away = r["state"], 1
            if st == "deleted":
                away = 0                     # the bin was emptied: deleted, not archived
        else:
            st = "gone"
        out[r["id"]] = st
        if st != r["state"] or away != (r.get("away") or 0) or carry != (r.get("carry") or 0):
            changed.append((st, away, carry, r["id"]))
    if changed:
        with _lock:
            con = _connect()
            try:
                con.executemany("UPDATE renders SET state=?, away=?, carry=? WHERE id=?", changed)
                con.commit()
            finally:
                con.close()
            for st, away, carry, rid in changed:
                if rid in _mem["rows"]:
                    _mem["rows"][rid].update(state=st, away=away, carry=carry)
    return out


def _remember_all():
    """Write down what is seen of every render, not only the series on show -
    so a series moved away before anyone looked at it again is still
    archived with its picks."""
    try:
        _load()
        with _lock:
            rows = list(_mem["rows"].values())
        _states(rows)
    except Exception as exc:                         # pragma: no cover
        print("[Visual Series Report] remember: %s" % exc)


_remembered = {"done": False}


def _remember_once():
    if _remembered["done"]:
        return
    _remembered["done"] = True
    threading.Thread(target=_remember_all, daemon=True, name="leiel-series-report-remember").start()


# ---------------------------------------------------------------- ingest
def _ingest(path, con=None):
    """Read one file into the ledger. Returns (what happened, the row):
    'new', 'known', 'moved', 'copy' or 'skip'."""
    v = _viewer()
    _load()
    key = v._key(path)
    try:
        mtime = os.path.getmtime(path)
    except OSError:
        return "skip", None
    with _lock:
        seen = _mem["files"].get(key)
        if seen and seen[0] == mtime:
            row = _mem["rows"].get(_mem["by_fp"].get(seen[1]))
            if row is None or "av" in row["recipe"]:
                return "known", row
    try:
        rec = _read(path)
    except Exception:
        return "skip", None
    own = con is None
    with _lock:
        if own:
            con = _connect()
        try:
            fp = rec["fp"] if rec else ""
            con.execute("INSERT OR REPLACE INTO files(path, mtime, fp) VALUES(?,?,?)",
                        (key, mtime, fp))
            _mem["files"][key] = (mtime, fp)
            if rec is None:
                if own:
                    con.commit()
                return "skip", None
            home, binned = _home(path)
            rid = _mem["by_fp"].get(fp)
            if rid is None:
                state = "deleted" if binned else ""
                cur = con.execute(
                    "INSERT INTO renders(fp, home, name, mtime, size, w, h, series, scene_id,"
                    " scene_no, scene_name, seed, recipe, state, added)"
                    " VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (fp, home, rec["name"], rec["mtime"], rec["size"], rec["w"], rec["h"],
                     rec["series"], rec["scene_id"], rec["scene_no"], rec["scene_name"],
                     rec["seed"], json.dumps(rec["recipe"], ensure_ascii=False), state,
                     time.time()))
                row = dict(rec, id=cur.lastrowid, state=state)
                _mem["rows"][row["id"]] = row
                _mem["by_fp"][fp] = row["id"]
                what = "new"
            else:
                row = _mem["rows"][rid]
                what = "known"
                if "av" not in row["recipe"]:
                    # read before prompt versions were kept: add them now
                    row["recipe"].update(av=rec["recipe"]["av"], sw=rec["recipe"]["sw"])
                    con.execute("UPDATE renders SET recipe=? WHERE id=?",
                                (json.dumps(row["recipe"], ensure_ascii=False), rid))
                if _pick_key(row) != v._key(home):
                    # the same render somewhere else: it has been moved when
                    # the old place is empty, and is a copy when it is not
                    _listings.clear()
                    if _where(row):
                        what = "copy"
                    else:
                        carry = 1 if row.get("state") == "pick" else 0
                        con.execute("UPDATE renders SET home=?, name=?, away=0, carry=? WHERE id=?",
                                    (home, rec["name"], carry, rid))
                        row.update(home=home, name=rec["name"], away=0, carry=carry)
                        what = "moved"
            if own:
                con.commit()
            return what, row
        finally:
            if own:
                con.close()


# --------------------------------------------------------------- measure
# Each render is measured once, on a copy LOOK_SIDE pixels long, and the
# numbers go into the ledger beside its recipe - so a render deleted and
# emptied from the bin keeps its look as it keeps its recipe.
def _hex(rgb):
    return "#%02x%02x%02x" % tuple(int(max(0, min(255, round(x)))) for x in rgb[:3])


def _palette(im, k=PALETTE):
    """[[hex, share]] - the k colours an RGB image is mostly made of, the
    largest share first."""
    q = im.quantize(k, method=_MEDIANCUT)
    pal = q.getpalette() or []
    counts = q.getcolors(256) or []
    total = float(sum(c for c, _i in counts)) or 1.0
    out = []
    for c, idx in sorted(counts, reverse=True)[:k]:
        out.append([_hex(pal[idx * 3: idx * 3 + 3]), round(c / total, 3)])
    return out


def _thumb_path(fp, side=THUMB_SIDE):
    return os.path.join(_viewer()._user_dir(), REPORT_DIRNAME, THUMB_DIRNAME,
                        "%s-%d.jpg" % (fp, side))


def _save_thumb(im, fp, side=THUMB_SIDE):
    out = _thumb_path(fp, side)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    small = im.copy()
    small.thumbnail((side, side), Image.BILINEAR)
    tmp = out + ".tmp"
    small.save(tmp, "JPEG", quality=84)
    os.replace(tmp, out)
    return out


def _measure(path, fp=None):
    """The look of one picture. Brightness, contrast, saturation and warmth
    are on 0..100 (warmth -100..100: red over blue). The detail map is the
    edge energy of GRID x GRID cells, 0..255, row by row from the top left.
    With fp, the small copy for the wall is kept too - so a render emptied
    from the bin can still be seen there."""
    with Image.open(path) as src:
        big = src.convert("RGB")
    if fp:
        try:
            _save_thumb(big, fp)
        except Exception:
            pass
    im = big
    im.thumbnail((LOOK_SIDE, LOOK_SIDE), Image.BILINEAR)
    lum = im.convert("L")
    ls = ImageStat.Stat(lum)
    sat = ImageStat.Stat(im.convert("HSV").getchannel(1)).mean[0]
    red, green, blue = ImageStat.Stat(im).mean
    # the filter leaves the outermost pixels as they were, so they are cut
    # away: otherwise a bright picture has a bright frame of "detail"
    found = lum.filter(ImageFilter.FIND_EDGES)
    found = found.crop((1, 1, found.width - 1, found.height - 1))
    edges = found.resize((GRID, GRID), Image.BOX)
    return {
        "b": round(ls.mean[0] / 2.55, 2),
        "c": round(ls.stddev[0] / 2.55, 2),
        "s": round(sat / 2.55, 2),
        "w": round((red - blue) / 2.55, 2),
        "avg": _hex((red, green, blue)),
        "pal": _palette(im.resize((96, 96), Image.BILINEAR)),
        "grid": list(edges.tobytes()),
    }


_pal_cache = {}


def _merge_palettes(fps, pals):
    """The main colours of many renders together - each render's own colours,
    weighed by their shares, quantized again."""
    key = hashlib.sha1("|".join(sorted(fps)).encode("utf-8")).hexdigest()
    hit = _pal_cache.get(key)
    if hit is not None:
        return hit
    px = []
    for pal in pals:
        for hx, share in pal or []:
            try:
                rgb = (int(hx[1:3], 16), int(hx[3:5], 16), int(hx[5:7], 16))
            except (TypeError, ValueError):
                continue
            px.extend([rgb] * max(1, int(round(share * 40))))
    out = []
    if px:
        im = Image.new("RGB", (len(px), 1))
        im.putdata(px)
        out = _palette(im)
    if len(_pal_cache) > 1024:
        _pal_cache.clear()
    _pal_cache[key] = out
    return out


def _file_of(row):
    """Where the picture of a render can be opened now, or None."""
    at = _where(row)
    if at == "home":
        return row["home"]
    if at == "bin":
        folder, name = os.path.split(row["home"])
        return os.path.join(folder, _viewer().TRASH_DIR, name)
    return None


_measuring = {"running": False, "first": [], "failed": set(), "done": 0}


def _stale(look):
    return look is None or look.get("_v", 1) < LOOK_VERSION


def _measure_kick(fps=()):
    """Measure what is not measured yet - the renders named first, then the
    rest, newest first - in the background."""
    with _lock:
        if fps:
            ahead = [fp for fp in fps if _stale(_mem["looks"].get(fp))]
            if ahead:
                skip = set(ahead)
                _measuring["first"] = ahead + [f for f in _measuring["first"] if f not in skip]
        if _measuring["running"]:
            return
        _measuring["running"] = True
    threading.Thread(target=_measure_worker, daemon=True,
                     name="leiel-series-report-look").start()


def _next_to_measure(refill):
    with _lock:
        looks, failed, first = _mem["looks"], _measuring["failed"], _measuring["first"]
        if not first and refill:
            rest = [r for r in _mem["rows"].values()
                    if _stale(looks.get(r["fp"])) and r["fp"] not in failed and r["state"] != "gone"
                    and _counted(r)]
            rest.sort(key=lambda r: -(r.get("mtime") or 0))
            first.extend(r["fp"] for r in rest)
        while first:
            fp = first.pop(0)
            if not _stale(looks.get(fp)) or fp in failed:
                continue
            rid = _mem["by_fp"].get(fp)
            if rid is not None:
                return _mem["rows"][rid]
    return None


def _measure_worker():
    con = None
    try:
        _load()
        con = _connect()
        refilled = False
        while True:
            row = _next_to_measure(not refilled)
            if row is None:
                if refilled:
                    break
                refilled = True
                continue
            path = _file_of(row)
            look = None
            if path:
                try:
                    look = _measure(path, row["fp"])
                except Exception:
                    look = None
            with _lock:
                if look is None:
                    # cannot be opened now; tried again after a restart
                    _measuring["failed"].add(row["fp"])
                    continue
                con.execute("INSERT OR REPLACE INTO looks(fp, v, data) VALUES(?,?,?)",
                            (row["fp"], LOOK_VERSION, json.dumps(look)))
                # an old look is replaced in memory below; a stale one stays
                # in use until then
                con.commit()
                look["_v"] = LOOK_VERSION
                _mem["looks"][row["fp"]] = look
                _measuring["done"] += 1
    except Exception as exc:                         # pragma: no cover
        print("[Visual Series Report] measure: %s" % exc)
    finally:
        if con is not None:
            try:
                con.close()
            except Exception:
                pass
        with _lock:
            _measuring["running"] = False


# ------------------------------------------------------------------ scan
_scan = {"running": False, "stop": False, "seen": 0, "added": 0, "error": "",
         "finished": 0.0}


def _scan_roots():
    v = _viewer()
    return [p for label, p in v._roots() if label != "input"]


def _walk(root):
    """Every PNG under a root, the bins included - a deleted render is still
    a render, and the only place its recipe is written."""
    v = _viewer()
    stack = [root]
    # Links and junctions are followed - an output folder is often one - and
    # each real folder is walked once, so a link back up cannot loop.
    walked = set()
    while stack:
        folder = stack.pop()
        real = v._key(folder)
        if real in walked:
            continue
        walked.add(real)
        try:
            with os.scandir(folder) as it:
                entries = list(it)
        except OSError:
            continue
        for e in entries:
            name = e.name
            try:
                if e.is_dir():
                    if (name.startswith(".") or name.lower() in v._SKIP_DIRS
                            or name.lower() in _get_settings()["skip_folders"]
                            or _is_package(name)):
                        continue
                    stack.append(e.path)
                elif name.lower().endswith(".png"):
                    yield e
            except OSError:
                continue


def _versioned(fp):
    """True unless the file is a render read before prompt versions were kept."""
    row = _mem["rows"].get(_mem["by_fp"].get(fp)) if fp else None
    return row is None or "av" in row["recipe"]


def _scan_worker():
    v = _viewer()
    con = None
    try:
        _load()
        con = _connect()
        for root in _scan_roots():
            for e in _walk(root):
                if _scan["stop"]:
                    break
                _scan["seen"] += 1
                key = v._key(e.path)
                try:
                    mtime = e.stat().st_mtime
                except OSError:
                    continue
                known = _mem["files"].get(key)
                if known and known[0] == mtime and _versioned(known[1]):
                    continue
                # written at once: a change held back would keep the file
                # locked against the summary a browser is waiting for
                with _lock:
                    what, _row = _ingest(e.path, con)
                    con.commit()
                if what in ("new", "moved"):
                    _scan["added"] += 1
            if _scan["stop"]:
                break
    except Exception as exc:                         # pragma: no cover
        _scan["error"] = str(exc)
        print("[Visual Series Report] scan: %s" % exc)
    finally:
        if con is not None:
            try:
                con.close()
            except Exception:
                pass
        _scan.update(running=False, stop=False, finished=time.time())
        _remember_all()
        _measure_kick()


def _scan_start():
    with _lock:
        if _scan["running"]:
            return False
        _scan.update(running=True, stop=False, seen=0, added=0, error="")
    threading.Thread(target=_scan_worker, daemon=True,
                     name="leiel-series-report-scan").start()
    return True


def _status_body():
    _load()
    return {"ok": True, "scanning": _scan["running"], "seen": _scan["seen"],
            "added": _scan["added"], "error": _scan["error"],
            "finished": _scan["finished"], "renders": len(_mem["rows"]),
            "measuring": _measuring["running"], "measured": len(_mem["looks"])}


# --------------------------------------------------------------- summary
def _canon(name):
    """A LoRA under the name it is counted by. A LoRA file renamed half way
    through - Purple_Grainy to PG - is two names for one thing until someone
    says so; this is where they said so."""
    aliases = _mem["aliases"]
    hops = 0
    while name in aliases and hops < 8:
        name = aliases[name]
        hops += 1
    return name


def _frame(row):
    w, h = row.get("w") or 0, row.get("h") or 0
    if not w or not h:
        return ""
    return "portrait" if h > w else ("landscape" if w > h else "square")


def _scene_key(row):
    if row.get("scene_id") is not None:
        return "%s#%s" % (row["series"], row["scene_id"])
    if row.get("scene_name"):
        return "%s@%s" % (row["series"], row["scene_name"])
    return ""


# A node switched off by its own "enabled" widget still writes every other
# value it holds into the picture; none of them made the render. They are
# counted as "off" instead, so a strength or a scale is only ever compared
# among the renders that used it.
_SWITCH_WIDGETS = ("enabled", "enable", "active")
_OFF_VALUES = ("false", "0", "off", "no", "disabled", "none")


def _live_opts(opts):
    """The recipe's options as they acted: those of a node switched off read "off"."""
    opts = list(opts or [])
    dead = set()
    for key, _label, value in opts:
        node, sep, widget = str(key).rpartition("::")
        if sep and node != "setting" and widget.strip().lower() in _SWITCH_WIDGETS \
                and str(value).strip().lower() in _OFF_VALUES:
            dead.add(node)
    if not dead:
        return opts
    out = []
    for key, label, value in opts:
        node, sep, widget = str(key).rpartition("::")
        if sep and node in dead and widget.strip().lower() not in _SWITCH_WIDGETS:
            value = "off"
        out.append([key, label, value])
    return out


def _axis_opts(opts):
    """The options as they are counted. A node with its own on/off switch and
    two or more other values - an enhancer's strength and scale - is counted
    as one setting, its values read together ("0.5 · 1.85") or "off", since
    they are chosen together and mean little apart. Other options stay as
    they are."""
    live = _live_opts(opts)
    nodes, order = {}, []
    for key, label, value in live:
        node, sep, widget = str(key).rpartition("::")
        if not sep or node == "setting":
            continue
        if node not in nodes:
            nodes[node] = []
            order.append(node)
        nodes[node].append((widget, value))
    joined = {}
    for node in order:
        ws = nodes[node]
        switch = [v for w, v in ws if w.strip().lower() in _SWITCH_WIDGETS]
        parts = [(w, v) for w, v in ws if w.strip().lower() not in _SWITCH_WIDGETS]
        if not switch or len(parts) < 2:
            continue
        off = any(str(v).strip().lower() in _OFF_VALUES for v in switch)
        joined[node] = [node + "::*", node + " - " + " · ".join(w for w, _v in parts),
                        "off" if off else " · ".join(str(v) for _w, v in parts)]
    out, put = [], set()
    for key, label, value in live:
        node, sep, _widget = str(key).rpartition("::")
        if sep and node in joined:
            if node not in put:
                put.add(node)
                out.append(joined[node])
            continue
        out.append([key, label, value])
    return out


def _facets(row):
    """Everything a render can be counted under: {axis key: [values]}."""
    rec = row["recipe"]
    loras = []
    for n, _s in rec.get("loras") or []:
        name = _canon(n)
        if name not in loras:
            loras.append(name)
    out = {"lora": loras}
    for key, _label, value in _axis_opts(rec.get("opts")):
        out["opt:" + key] = [value]
    frame = _frame(row)
    if frame:
        out["frame"] = [frame]
    scene = _scene_key(row)
    if scene:
        out["scene"] = [scene]
    return out


def _passes(facets, filters, skip=None):
    for f in filters:
        axis = f["axis"]
        if axis == skip:
            continue
        if f["value"] not in facets.get(axis, ()):
            return False
    return True


def _tally():
    return {"n": 0, "pick": 0, "kept": 0, "deleted": 0}


def _add(t, state):
    t["n"] += 1
    t[state] += 1


def _clean_filters(filters):
    out = []
    for f in filters or []:
        if isinstance(f, dict) and isinstance(f.get("axis"), str) and f.get("value") is not None:
            out.append({"axis": f["axis"], "value": str(f["value"])})
    return out


# ------------------------------------------------------- the book's notes
# The Series Book keeps a file for each series: a note on the series - its
# story - and a note on each prompt. They are shown beside the counts, so a
# cut is read with what it was meant to be. Files are read again only when
# they change: they carry pictures and can be large.
_notes = {}


def _book_series_dir():
    return os.path.join(_viewer()._user_dir(), "visual_series_book", "series")


# A cut's shot, read from the words of its camera capsule: how much of the
# scene it takes in, and from how high. Plain words, as the capsules are
# written - "landscape extreme long shot from very high above...".
SHOT_SIZES = ("Wide", "Full", "Three-quarter", "Medium", "Close-up", "Other")
SHOT_ANGLES = ("High", "Eye level", "Low")


def _shot(words):
    t = " " + words.lower().replace("\u2011", "-") + " "
    def has(*keys):
        return any(k in t for k in keys)
    if has("extreme long", "extreme wide", "drone", "aerial", "establishing", "wide shot",
           "long shot", "far back", "panoram", " wide,", " wide |", "wide, ", "very wide",
           "ten metres", "far behind", "whole house", "whole set", "whole toy", "small in the",
           "small on the", "small beneath"):
        size = "Wide"
    elif has("medium close"):
        size = "Medium"
    elif has("macro", "close-up", "close up", "closeup", "close, ", "close |", "detail shot", "insert"):
        size = "Close-up"
    elif has("three-quarter shot", "three-quarter length", "three-quarter,", "knee", "3/4 length",
             "thighs", "to the calves", "head to calves"):
        size = "Three-quarter"
    elif has("full-length", "full length", "full body", "full-body", "full figure", "head to toe",
             "crown to", "whole figure", "bare feet", "to her feet", "walking figure", "braced figure",
             "full height of the frame", "dragging hem"):
        size = "Full"
    elif has("medium", "waist up", "waist-up", "mid-shot", "mid shot", "half-length", "chest up"):
        size = "Medium"
    else:
        size = "Other"
    if has("high angle", "from above", "overhead", "top-down", "top down", "looking down",
           "looking steeply down", "bird", "high above"):
        angle = "High"
    elif has("low angle", "from low", "from below", "low on", "worm", "looking up", "kneeling height",
             "ground level", "low in the"):
        angle = "Low"
    else:
        angle = "Eye level"
    return {"size": size, "angle": angle}


def _story(series):
    """{'note': str, 'cuts': {prompt number: note}} for a series, from the
    newest Series Book file of that name - or None."""
    hit = _book_index().get(series)
    return hit[2] if hit else None


def _book_index():
    """{series name: (mtime, name, story)} for every series the Series Book
    has saved - the newest file of each name."""
    folder = _book_series_dir()
    try:
        names = [n for n in os.listdir(folder) if n.endswith(".json")]
    except OSError:
        return {}
    best = {}
    for n in names:
        path = os.path.join(folder, n)
        try:
            mtime = os.path.getmtime(path)
        except OSError:
            continue
        hit = _notes.get(path)
        if not hit or hit[0] != mtime:
            try:
                with open(path, "r", encoding="utf-8") as fh:
                    doc = json.load(fh)
                group = doc.get("group") or {}
                cuts, shots, scenes = {}, {}, []
                caps = doc.get("caps") or {}
                for q in doc.get("prompts") or []:
                    if isinstance(q, dict):
                        try:
                            no = int(q.get("no"))
                        except (TypeError, ValueError):
                            no = None
                        scenes.append({"no": "%02d" % no if no is not None else "",
                                       "name": str(q.get("name") or ""),
                                       "note": str(q.get("note") or "").strip()[:4000],
                                       "frame": str(q.get("orient") or "")})
                        cam = [caps.get(str(c)) for c in q.get("caps") or []]
                        cam = [c for c in cam if isinstance(c, dict) and c.get("kind") == "camera"]
                        if cam:
                            c = cam[0]
                            shot = _shot(str(c.get("name") or "") + " | "
                                         + str((c.get("sec") or {}).get("text") or ""))
                            # by number, and by name for renders made before
                            # the Lab wrote the number down
                            if no is not None:
                                shots[no] = shot
                            if str(q.get("name") or ""):
                                shots["@" + str(q["name"])] = shot
                    if isinstance(q, dict) and str(q.get("note") or "").strip():
                        try:
                            cuts[int(q.get("no"))] = str(q["note"]).strip()[:4000]
                        except (TypeError, ValueError):
                            pass
                hue = group.get("hue")
                hit = (mtime, str(group.get("name") or ""),
                       {"note": str(group.get("note") or "").strip()[:4000], "cuts": cuts,
                        "shots": shots, "scenes": scenes,
                        # the series' own colour in the book, by its place in the book's list
                        "hue": hue if isinstance(hue, int) else None})
            except Exception:
                hit = (mtime, "", None)
            _notes[path] = hit
        if hit[1] and hit[2] is not None and (hit[1] not in best or hit[0] > best[hit[1]][0]):
            best[hit[1]] = hit
    return best


def _scope_hue(story, units, season):
    """The colour the scope is framed in: the series' own colour in the book;
    for a season, the colour of its latest episode."""
    if story:
        return story.get("hue")
    if season is not None:
        for u in reversed(units):
            st = _story(u["key"])
            if st and st.get("hue") is not None:
                return st["hue"]
    return None


def _cut_no(no):
    digits = "".join(ch for ch in str(no or "") if ch.isdigit())
    return int(digits) if digits else None


def _framed(look):
    """The detail map of a look, or None when it was measured before the
    map could be trusted."""
    grid = look.get("grid") if look else None
    if not grid or len(grid) != GRID * GRID or look.get("_v", 1) < 2:
        return None
    return grid


def _centroid(grid):
    """Where the detail of a picture sits, (x, y) on 0..1 from the top left:
    the middle of the cells that hold more than their share."""
    mean = sum(grid) / float(len(grid))
    weights = [max(0.0, g - mean) for g in grid]
    total = sum(weights)
    if total <= 0:
        return 0.5, 0.5
    cx = sum(w * ((i % GRID) + 0.5) for i, w in enumerate(weights)) / (total * GRID)
    cy = sum(w * ((i // GRID) + 0.5) for i, w in enumerate(weights)) / (total * GRID)
    return round(cx, 3), round(cy, 3)


def _mean_grid(grids):
    if not grids:
        return None
    n = float(len(grids))
    return [round(sum(g[i] for g in grids) / n, 1) for i in range(GRID * GRID)]


_gaps = {"sig": None, "secs": {}}


def _estimated():
    """{row id: seconds} for renders without a written time: the gap to the
    render saved just before, when it is short enough to be one. Worked out
    over every render in the ledger - the one before may be of another
    series - and kept until the ledger changes."""
    with _lock:
        rows = list(_mem["rows"].values())
    sig = (len(rows), max((r["id"] for r in rows), default=0))
    if _gaps["sig"] == sig:
        return _gaps["secs"]
    # the moment each one was saved: written in it when it can be, else the file's
    def saved(r):
        return r["recipe"].get("saved") or r.get("mtime") or 0
    rows.sort(key=lambda r: (saved(r), r["id"]))
    out, before = {}, None
    for r in rows:
        at = saved(r)
        if "secs" not in r["recipe"] and before is not None:
            gap = at - before
            if 0.5 < gap <= GAP_CAP:
                out[r["id"]] = round(gap, 2)
        if at:
            before = at
    _gaps.update(sig=sig, secs=out)
    return out


def _time_of(rows, picks):
    """Render time of a group: written, estimated, and what it adds up to."""
    est = _estimated()
    exact = [r["recipe"]["secs"] for r in rows if "secs" in r["recipe"]]
    guess = [est[r["id"]] for r in rows if "secs" not in r["recipe"] and r["id"] in est]
    every = sorted(exact + guess)
    total = sum(every)
    return {"exact": len(exact), "estimated": len(guess), "none": len(rows) - len(exact) - len(guess),
            "total": round(total, 1),
            "median": round(_quantile(every, 0.5), 1) if every else 0,
            # the renders with a time stand for the ones without
            "per_pick": round(total / len(every) * len(rows) / picks, 1) if every and picks else 0}


def _secs(r, est):
    """(seconds, written?) for a render, or (None, False)."""
    if "secs" in r["recipe"]:
        return r["recipe"]["secs"], True
    if r["id"] in est:
        return est[r["id"]], False
    return None, False


def _timeline(chosen):
    """Every render with a time, in the order they were saved."""
    est = _estimated()
    out = []
    for r, state, _facets, _look in chosen:
        secs, exact = _secs(r, est)
        if secs is None:
            continue
        out.append({"at": round(r["recipe"].get("saved") or r.get("mtime") or 0, 1),
                    "s": secs, "x": exact, "st": state, "se": r["series"], "sc": _scene_key(r),
                    "no": r.get("scene_no") or "", "nm": r.get("scene_name") or "", "f": r["name"]})
    out.sort(key=lambda p: p["at"])
    return out


def _speeds(chosen, out_axes, always):
    """How long a render takes under each value: the middle of its renders'
    times, so one slow render after a pause does not pull it."""
    est = _estimated()
    timed = []
    for r, _state, facets, _look in chosen:
        secs, exact = _secs(r, est)
        if secs is not None:
            timed.append((facets, secs, exact))
    out = []
    for a in out_axes:
        rows = []
        for v in a["values"]:
            value = v["value"]
            if a["axis"] == "lora" and value in always:
                continue
            ts = sorted(secs for facets, secs, _x in timed if value in facets.get(a["axis"], ()))
            if not ts:
                continue
            exact = sum(1 for facets, _s, x in timed if x and value in facets.get(a["axis"], ()))
            rows.append({"value": value, "n": len(ts), "exact": exact,
                         "median": round(_quantile(ts, 0.5), 1),
                         "total": round(sum(ts), 1), "thin": len(ts) < THIN})
        if len(rows) >= 2:
            out.append({"axis": a["axis"], "label": a["label"], "values": rows})
    return out


def _quantile(sorted_values, q):
    if not sorted_values:
        return 0.0
    at = (len(sorted_values) - 1) * q
    lo = int(at)
    hi = min(lo + 1, len(sorted_values) - 1)
    return sorted_values[lo] + (sorted_values[hi] - sorted_values[lo]) * (at - lo)


def _unit_look(entries):
    """The look of a group of renders: their main colours together, and how
    bright they are - the middle and the middle half."""
    measured = [(r["fp"], look) for r, look in entries if look]
    if not measured:
        return {"m": 0}
    bs = sorted(look["b"] for _fp, look in measured)
    grid = _mean_grid([g for g in (_framed(look) for _fp, look in measured) if g])
    framing = {}
    if grid:
        cx, cy = _centroid(grid)
        # each cut drawn in its own shape: a portrait cut beside a landscape one
        ars = sorted((r.get("h") or 1) / float(r.get("w") or 1) for r, look in entries if look)
        framing = {"grid": grid, "cx": cx, "cy": cy, "ar": round(ars[len(ars) // 2], 3)}
    return {
        **framing,
        "m": len(measured),
        "pal": _merge_palettes([fp for fp, _l in measured], [look.get("pal") for _fp, look in measured]),
        "b": round(sum(bs) / len(bs), 2),
        "b25": round(_quantile(bs, 0.25), 2),
        "b75": round(_quantile(bs, 0.75), 2),
    }


def _mean(looks, metric):
    return sum(look[metric] for look in looks) / len(looks)


def _recipes(entries, labels, lora_names, always):
    """How far each value moves a picture, measured inside each cut.

    Within one cut the subject, the light and the place are the same, so the
    renders with a value and the renders without it differ by the recipe -
    not by a night scene sitting beside a day scene. Each cut where both are
    found gives a difference; the cuts are weighed by how many renders they
    hold on both sides, and the result is the weighted mean."""
    groups = {}
    for r, facets, look in entries:
        key = _scene_key(r) or ("series:" + r["series"])
        groups.setdefault(key, []).append((facets, look))
    axis_order, values = [], {}
    for _r, facets, _look in entries:
        for axis, vals in facets.items():
            if axis in ("scene", "prompt"):
                continue
            if axis not in values:
                values[axis] = []
                axis_order.append(axis)
            for v in vals:
                if v not in values[axis]:
                    values[axis].append(v)

    def rank(axis):
        return (0 if axis == "lora" else 2 if axis == "frame" else 1, axis_order.index(axis))

    out = []
    for axis in sorted(axis_order, key=rank):
        rows = []
        for v in values[axis]:
            if axis == "lora" and v in always:
                continue
            acc = [0.0] * len(METRICS)
            weight, n_with, n_without, n = 0.0, 0, 0, 0
            for members in groups.values():
                with_v = [look for facets, look in members if v in facets.get(axis, ())]
                without = [look for facets, look in members if v not in facets.get(axis, ())]
                n += len(with_v)
                if not with_v or not without:
                    continue
                wt = len(with_v) * len(without) / float(len(with_v) + len(without))
                for i, m in enumerate(METRICS):
                    acc[i] += wt * (_mean(with_v, m) - _mean(without, m))
                weight += wt
                n_with += len(with_v)
                n_without += len(without)
            item = {"value": v, "n": n, "with": n_with, "without": n_without,
                    "d": [round(a / weight, 2) for a in acc] if weight else None,
                    "thin": n_with < THIN or n_without < THIN}
            if axis == "lora":
                item["names"] = sorted(lora_names.get(v, {v}))
            rows.append(item)
        if any(item["d"] for item in rows):
            out.append({"axis": axis, "label": labels.get(axis, axis), "values": rows})
    return out


def _versions(live):
    """Each cut's prompt as it was rewritten: version 1 is the words the cut
    was first rendered with, and every rewrite after it is the next version.
    A render with a capsule swapped in belongs to the version whose own words
    it shares. Returns {render id: 'cut|n'}, {cut: [version, ...]}, {cut:
    [(version, state), ...] oldest first} and {cut: (series, no, name)}."""
    by_cut = {}
    for r, state, _facets in live:
        key = _scene_key(r)
        if key and "av" in r["recipe"] and r["recipe"]["av"]:
            by_cut.setdefault(key, []).append((r, state))
    vid, cuts, hist, names = {}, {}, {}, {}
    for key, rows in by_cut.items():
        rows.sort(key=lambda e: (e[0].get("mtime") or 0, e[0]["id"]))
        versions, h = [], []
        for r, state in rows:
            av = r["recipe"]["av"]
            sw = set(r["recipe"].get("sw") or ())
            hit = None
            for ver in reversed(versions):
                kinds = (set(ver["av"]) | set(av)) - sw
                if all((ver["av"].get(k) or [None])[0] == (av.get(k) or [None])[0] for k in kinds):
                    hit = ver
                    break
            if hit is None:
                hit = {"v": len(versions) + 1, "av": dict(av)}
                versions.append(hit)
            vid[r["id"]] = "%s|%d" % (key, hit["v"])
            h.append((hit["v"], state))
        last = rows[-1][0]
        cuts[key], hist[key] = versions, h
        names[key] = (last["series"], last.get("scene_no") or "", last.get("scene_name") or "")
    return vid, cuts, hist, names


def _changed(versions):
    """{version: [anchors written again since the version before it]}"""
    out, prev = {}, None
    for ver in versions:
        ch = []
        if prev is not None:
            for k in list(ver["av"]) + [k for k in prev if k not in ver["av"]]:
                # older books named them "SUBJECT ANCHOR" - one anchor either way
                name = re.sub(r"\s+ANCHOR$", "", k)
                if (ver["av"].get(k) or [None])[0] != (prev.get(k) or [None])[0] and name not in ch:
                    ch.append(name)
        out[ver["v"]] = ch
        prev = ver["av"]
    return out


def _version_report(cuts, hist, names, by_version, units, with_cuts):
    """What the summary shows of prompt versions.

    The version a cut ended on is nearly always its best - that is why the
    writing stopped there - so the report asks other questions of them: how
    many rewrites and renders a cut took to its first pick, which anchor was
    written again when a cut finally got one, and which versions were left
    behind although they were picked more often than the one the cut ended on."""
    order = [u["key"] for u in units]
    given = {u["key"]: u.get("no") or "" for u in units}

    def place(key):
        if key in order:
            return (0, order.index(key), "")
        series, no, _name = names[key]
        digits = "".join(ch for ch in no if ch.isdigit())
        return (1, int(digits) if digits else 10 ** 6, series)

    out_cuts, rewrites, landed, missed = [], {}, {}, []
    first_try = after = none = 0
    for key in sorted(cuts, key=place):
        versions = cuts[key]
        series, no, name = names[key]
        no = no or given.get(key, "")
        changed = _changed(versions)
        h = hist[key]
        first_v = first_at = None
        for i, (v, st) in enumerate(h):
            if st == "pick":
                first_v, first_at = v, i + 1
                break
        for v, ch in changed.items():
            if v > 1:
                for k in ch:
                    rewrites[k] = rewrites.get(k, 0) + 1
        if first_v is None:
            none += 1
        elif first_v == 1:
            first_try += 1
        else:
            after += 1
            for k in changed[first_v]:
                landed[k] = landed.get(k, 0) + 1
        full = {}
        for v, st in h:
            if v not in full:
                full[v] = _tally()
            _add(full[v], st)
        now = h[-1][0]
        nt = full[now]
        for v in sorted(full):
            t = full[v]
            if v != now and t["n"] >= 3 and t["pick"] and t["pick"] * nt["n"] > nt["pick"] * t["n"]:
                missed.append({"key": key, "series": series, "no": no, "name": name, "v": v,
                               "id": "%s|%d" % (key, v), "n": t["n"], "pick": t["pick"],
                               "now": now, "now_n": nt["n"], "now_pick": nt["pick"]})
        if with_cuts and key in by_version:
            rows = []
            for ver in versions:
                t = by_version[key].get(ver["v"])
                if not t:
                    continue
                rows.append(dict(t, v=ver["v"], id="%s|%d" % (key, ver["v"]),
                                 changed=changed[ver["v"]],
                                 names={re.sub(r"\s+ANCHOR$", "", k): n
                                        for k, (_h, n) in ver["av"].items() if n},
                                 thin=t["n"] < THIN))
            if rows:
                out_cuts.append({"key": key, "series": series, "no": no, "name": name,
                                 "total": len(versions), "first_v": first_v,
                                 "first_at": first_at, "renders": len(h), "versions": rows})
    anchors = [{"anchor": k, "rewrites": n, "landed": landed.get(k, 0)}
               for k, n in sorted(rewrites.items(), key=lambda kv: (-kv[1], kv[0]))]
    return {"cuts": out_cuts, "anchors": anchors, "missed": missed,
            "first_try": first_try, "after": after, "none": none}


# ------------------------------------------------------ what is counted
# settings.json beside the ledger:
#   "from": "2026-09-12"   - renders of an earlier day are left out of every
#                            count, and stay in the ledger; empty counts all
#   "skip_folders": [...]  - folders by name that are never read, and whose
#                            renders already in the ledger are left out
#   "hidden": [...]        - series left out of every series together and of
#                            the history; still there to open on their own
SETTINGS_FILE = "settings.json"
_DEFAULT_SETTINGS = {"from": "", "skip_folders": ["upscale"], "hidden": []}
_settings = {"mtime": None, "data": dict(_DEFAULT_SETTINGS), "looked": 0.0}
_counted_cache = {"mtime": None, "ids": {}}
_DAY = re.compile(r"^(\d{4})[-_.]?(\d{2})[-_.]?(\d{2})$")


def _settings_path():
    return os.path.join(_viewer()._user_dir(), REPORT_DIRNAME, SETTINGS_FILE)


def _get_settings():
    """The settings, read again whenever the file changes. Written with the
    defaults the first time, so there is a file to edit. The file is looked
    at once a second at most: this is asked for every render counted."""
    now = time.time()
    if _settings["mtime"] is not None and now - _settings["looked"] < 1.0:
        return _settings["data"]
    _settings["looked"] = now
    path = _settings_path()
    try:
        mtime = os.path.getmtime(path)
    except OSError:
        try:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "w", encoding="utf-8") as fh:
                json.dump(_DEFAULT_SETTINGS, fh, indent=2)
            mtime = os.path.getmtime(path)
        except OSError:
            return _settings["data"]
    if mtime != _settings["mtime"]:
        data = dict(_DEFAULT_SETTINGS)
        try:
            with open(path, encoding="utf-8") as fh:
                got = json.load(fh)
            if isinstance(got, dict):
                start = str(got.get("from") or "").strip()
                m = _DAY.match(start)
                data["from"] = "%s-%s-%s" % m.groups() if m else ""
                skip = got.get("skip_folders")
                if isinstance(skip, list):
                    data["skip_folders"] = [str(x).strip().lower() for x in skip if str(x).strip()]
                hidden = got.get("hidden")
                if isinstance(hidden, list):
                    data["hidden"] = [str(x) for x in hidden if str(x).strip()]
        except (OSError, ValueError):
            pass
        _settings.update(mtime=mtime, data=data)
    return _settings["data"]


def _day_of(row):
    """The day a render belongs to: the dated folder it was saved in, as the
    output folders are kept by day, else the day its file was saved."""
    parts = str(row.get("home") or "").replace("\\", "/").split("/")
    for part in reversed(parts):
        m = _DAY.match(part)
        if m:
            return "%s-%s-%s" % m.groups()
    at = row.get("mtime")
    return time.strftime("%Y-%m-%d", time.localtime(at)) if at else ""


def _counted(row):
    """False for a render left out by the settings: from a day before
    "from", or kept under a skipped folder. Kept per render until the
    settings change; a render moved is a new answer."""
    st = _get_settings()
    if _counted_cache["mtime"] != _settings["mtime"]:
        _counted_cache.update(mtime=_settings["mtime"], ids={})
    key = (row["id"], row.get("home"))
    hit = _counted_cache["ids"].get(key)
    if hit is None:
        hit = _counted_cache["ids"][key] = _counted_now(row, st)
    return hit


# A Visual Series Layout package holds copies of picks for printing - never
# renders to count, wherever it was written.
PACKAGE_SUFFIX = " - package"


def _is_package(name):
    return str(name or "").strip().lower().endswith(PACKAGE_SUFFIX)


def _counted_now(row, st):
    parts = str(row.get("home") or "").replace("\\", "/").lower().split("/")
    if any(_is_package(p) for p in parts[:-1]):
        return False
    if st["skip_folders"]:
        if any(p in st["skip_folders"] for p in parts[:-1]):
            return False
    if st["from"]:
        day = _day_of(row)
        if day and day < st["from"]:
            return False
    return True


def _hide_body(name, hide):
    """Hide a series from the series together and the history, or show it
    again - written into settings.json, keeping what else is there."""
    name = str(name or "")
    if not name:
        return {"ok": False, "error": "no series"}
    path = _settings_path()
    _get_settings()
    try:
        with open(path, encoding="utf-8") as fh:
            got = json.load(fh)
        if not isinstance(got, dict):
            got = {}
    except (OSError, ValueError):
        got = {}
    hidden = [str(x) for x in got.get("hidden") or [] if str(x) != name]
    if hide:
        hidden.append(name)
    got["hidden"] = hidden
    for k, v in _DEFAULT_SETTINGS.items():
        got.setdefault(k, v)
    with _lock:
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(got, fh, indent=2, ensure_ascii=False)
        _settings["mtime"] = None
    _hist_cache["sig"] = None
    return {"ok": True, "hidden": _get_settings()["hidden"]}


_hist_cache = {"sig": None, "at": 0.0, "body": None}


def _history(days=0):
    """The history of the last so many days (0: all of it), worked out again
    when the ledger or the settings change, or a few seconds have passed -
    picks change without new renders."""
    try:
        days = max(0, int(days or 0))
    except (TypeError, ValueError):
        days = 0
    with _lock:
        sig = (len(_mem["rows"]), max(_mem["rows"], default=0), _settings["mtime"], days)
    if _hist_cache["sig"] == sig and time.time() - _hist_cache["at"] < 8:
        return _hist_cache["body"]
    body = {"days": days, "series": _history_now(time.time() - days * 86400 if days else 0)}
    _hist_cache.update(sig=sig, at=time.time(), body=body)
    return body


def _history_now(since=0):
    """Every named series in the order it was begun: what it cost and what
    it gave. Renders outside a series, and hidden series, are left out."""
    _load()
    with _lock:
        rows = [r for r in _mem["rows"].values() if _counted(r) and r["series"]]
    if since:
        # a series worked on within the period comes whole
        recent = {r["series"] for r in rows if (r.get("mtime") or 0) >= since}
        rows = [r for r in rows if r["series"] in recent]
    hidden = set(_get_settings()["hidden"])
    states = _states(rows)
    live = [(r, states[r["id"]], _facets(r)) for r in rows if states[r["id"]] != "gone"]
    _vid, cuts, hist, names = _versions(live)
    by_series = {}
    for r, state, _f in live:
        by_series.setdefault(r["series"], []).append((r, state))
    out = []
    for name, entries in by_series.items():
        t = _tally()
        for _r, state in entries:
            _add(t, state)
        srows = [r for r, _s in entries]
        mine = {k: v for k, v in cuts.items() if names[k][0] == name}
        rep = _version_report(mine, {k: hist[k] for k in mine}, names, {}, [], False)
        firsts = []
        for k in mine:
            for i, (_v, st) in enumerate(hist[k]):
                if st == "pick":
                    firsts.append(i + 1)
                    break
        firsts.sort()
        landed = max(rep["anchors"], key=lambda a: a["landed"]) if rep["anchors"] else None
        out.append(dict(t, name=name, hidden=name in hidden,
                        first=min(r.get("mtime") or 0 for r in srows),
                        last=max(r.get("mtime") or 0 for r in srows),
                        cuts=len({_scene_key(r) for r in srows if _scene_key(r)}),
                        time=_time_of(srows, t["pick"]),
                        to_first=round(_quantile(firsts, 0.5), 1) if firsts else None,
                        first_try=rep["first_try"], after=rep["after"], none=rep["none"],
                        rewrites=sum(a["rewrites"] for a in rep["anchors"]),
                        most=rep["anchors"][0]["anchor"] if rep["anchors"] else "",
                        landed=landed["anchor"] if landed and landed["landed"] else ""))
    out.sort(key=lambda x: x["first"])
    return out


_trend_cache = {"sig": None, "at": 0.0, "body": None}


def _trends(days=0):
    """The recipe report card and the shots' difficulty for the period."""
    try:
        days = max(0, int(days or 0))
    except (TypeError, ValueError):
        days = 0
    with _lock:
        sig = (len(_mem["rows"]), max(_mem["rows"], default=0), _settings["mtime"], days)
    if _trend_cache["sig"] == sig and time.time() - _trend_cache["at"] < 8:
        return _trend_cache["body"]
    body = dict(_trends_now(time.time() - days * 86400 if days else 0), days=days)
    _trend_cache.update(sig=sig, at=time.time(), body=body)
    return body


def _trends_now(since=0):
    _load()
    with _lock:
        rows = [r for r in _mem["rows"].values() if _counted(r) and r["series"]]
    hidden = set(_get_settings()["hidden"])
    rows = [r for r in rows if r["series"] not in hidden]
    if since:
        recent = {r["series"] for r in rows if (r.get("mtime") or 0) >= since}
        rows = [r for r in rows if r["series"] in recent]
    states = _states(rows)
    live = [(r, states[r["id"]], _facets(r)) for r in rows if states[r["id"]] != "gone"]

    # ---- the recipe report card: each LoRA and sampler, series by series
    first = {}
    for r, _st, _f in live:
        at = r.get("mtime") or 0
        if r["series"] not in first or at < first[r["series"]]:
            first[r["series"]] = at
    order = sorted(first, key=lambda n: first[n])
    total = len(live)
    cells, totals, kinds = {}, {}, {}
    for r, st, facets in live:
        for axis in ("lora", "opt:setting::sampler"):
            for v in facets.get(axis, ()):
                key = (axis, v)
                kinds[key] = True
                t = totals.setdefault(key, _tally())
                _add(t, st)
                c = cells.setdefault(key, {}).setdefault(r["series"], _tally())
                _add(c, st)
    card, always = [], []
    for (axis, v), t in totals.items():
        if t["n"] < THIN:
            continue
        if axis == "lora" and total and t["n"] >= total * ALWAYS_SHARE:
            always.append(v)
            continue
        used = [n for n in order if n in cells[(axis, v)]]
        # the last three series it was used in against the ones before
        trend = None
        if len(used) >= 2:
            cut = max(1, len(used) - 3)
            old, new = _tally(), _tally()
            for n in used[:cut]:
                for k in ("n", "pick"):
                    old[k] += cells[(axis, v)][n][k]
            for n in used[cut:]:
                for k in ("n", "pick"):
                    new[k] += cells[(axis, v)][n][k]
            if old["n"] >= THIN and new["n"] >= THIN:
                trend = round(100.0 * new["pick"] / new["n"] - 100.0 * old["pick"] / old["n"], 1)
        card.append({"axis": "lora" if axis == "lora" else "sampler", "value": v,
                     "n": t["n"], "pick": t["pick"], "deleted": t["deleted"], "trend": trend,
                     "last": max(first[n] for n in used) if used else 0,
                     "cells": {n: [c["n"], c["pick"]] for n, c in cells[(axis, v)].items()}})
    card.sort(key=lambda c: (c["axis"] != "lora", -c["n"]))

    # ---- the shots: how hard each kind of cut was to get
    _vid, cuts, hist, names = _versions(live)
    frames = {}
    for r, _st, _f in live:
        k = _scene_key(r)
        if k:
            fr = _frame(r)
            if fr:
                frames.setdefault(k, {}).setdefault(fr, 0)
                frames[k][fr] += 1
    groups = {"size": {}, "angle": {}, "frame": {}}
    known = 0
    for key in cuts:
        series, no, _name = names[key]
        st = _story(series)
        shot = None
        if st:
            shot = st.get("shots", {}).get(_cut_no(no)) or st.get("shots", {}).get("@" + _name)
        fr = max(frames.get(key, {"": 0}).items(), key=lambda kv: kv[1])[0]
        h = hist[key]
        hit = next(((i + 1, v_) for i, (v_, s_) in enumerate(h) if s_ == "pick"), (None, None))
        picks = sum(1 for _v, s_ in h if s_ == "pick")
        entry = (len(h), picks, hit[0], len(cuts[key]), hit[1])
        if shot:
            known += 1
            groups["size"].setdefault(shot["size"], []).append(entry)
            groups["angle"].setdefault(shot["angle"], []).append(entry)
        if fr:
            groups["frame"].setdefault(fr, []).append(entry)

    def sum_up(entries):
        firsts = sorted(e[2] for e in entries if e[2])
        n = sum(e[0] for e in entries)
        p = sum(e[1] for e in entries)
        return {"cuts": len(entries), "n": n, "pick": p,
                "at_once": sum(1 for e in entries if e[4] == 1),
                "to_first": round(_quantile(firsts, 0.5), 1) if firsts else None,
                "none": sum(1 for e in entries if not e[2]),
                "versions": round(sum(e[3] for e in entries) / float(len(entries)), 1) if entries else 0}
    shots = []
    for kind, labels in (("size", SHOT_SIZES), ("angle", SHOT_ANGLES), ("frame", ("portrait", "landscape", "square"))):
        for label in labels:
            entries = groups[kind].get(label)
            if entries:
                shots.append(dict(sum_up(entries), kind=kind, label=label))
    return {"series": order, "card": card, "always": always, "shots": shots,
            "cuts": len(cuts), "read": known}


def _scope(series):
    """(rows, every, season) for what the browser asked to see."""
    every = series in (None, "*")
    season = None
    if not every and series.startswith(SEASON_PREFIX):
        try:
            season = int(series[len(SEASON_PREFIX):])
        except ValueError:
            season = -1
    with _lock:
        rows = [r for r in _mem["rows"].values() if _counted(r)]
    if every or season is not None:
        hidden = set(_get_settings()["hidden"])
        rows = [r for r in rows if r["series"] not in hidden]
    if every:
        return rows, True, None
    if season is not None:
        return [r for r in rows if (_episode(r["series"]) or (None,))[0] == season], False, season
    return [r for r in rows if r["series"] == series], False, None


def _path(series, every, season):
    if every:
        return []
    if season is not None:
        return [{"label": "S%d" % season, "go": series, "title": "Season %d" % season}]
    ep = _episode(series)
    if ep:
        return [{"label": "S%d" % ep[0], "go": SEASON_PREFIX + str(ep[0]), "title": "Season %d" % ep[0]},
                {"label": "E%d" % ep[1], "go": series, "title": series}]
    return [{"label": series or "(no series)", "go": series or NO_SERIES, "title": series}]


def _wall(chosen, out_axes, always, want):
    """Renders laid out by two settings - LoRA down, sampler across, or any
    other two - so the same cut made two ways is seen side by side."""
    usable = []
    for a in out_axes:
        values = [v["value"] for v in a["values"] if not (a["axis"] == "lora" and v["value"] in always)]
        if len(values) >= 2:
            usable.append((a, values))
    choices = [{"axis": a["axis"], "label": a["label"], "n": len(vals)} for a, vals in usable]
    by_axis = {a["axis"]: vals for a, vals in usable}
    want = want if isinstance(want, dict) else {}
    rows = want.get("rows") if want.get("rows") in by_axis else None
    one_column = want.get("cols") == "-"
    cols = want.get("cols") if want.get("cols") in by_axis else None
    if rows is None:
        rows = "lora" if "lora" in by_axis else (usable[0][0]["axis"] if usable else None)
    if one_column:
        cols = None
    elif cols is None or cols == rows:
        pref = ["opt:setting::sampler", "opt:setting::scheduler"]
        cols = next((a for a in pref if a in by_axis and a != rows), None)
        if cols is None:
            cols = next((a["axis"] for a, _v in usable if a["axis"] != rows), None)
    out = {"choices": choices, "rows": rows, "cols": cols, "row_values": [], "col_values": [],
           "cells": {}}
    if rows is None:
        return out
    row_values = list(by_axis[rows])
    col_values = list(by_axis[cols]) if cols else [""]
    cells = {}
    newest = sorted(chosen, key=lambda e: -(e[0].get("mtime") or 0))
    for r, state, facets, _look in newest:
        rv = [v for v in facets.get(rows, ()) if v in row_values]
        cv = [v for v in facets.get(cols, ()) if v in col_values] if cols else [""]
        for a in rv:
            for b in cv:
                key = "%d|%d" % (row_values.index(a), col_values.index(b))
                c = cells.setdefault(key, {"n": 0, "pick": 0, "deleted": 0, "items": []})
                c["n"] += 1
                if state == "pick":
                    c["pick"] += 1
                elif state == "deleted":
                    c["deleted"] += 1
                if len(c["items"]) < WALL_PER_CELL:
                    c["items"].append({"fp": r["fp"], "st": state, "f": r["name"],
                                       "no": r.get("scene_no") or "", "nm": r.get("scene_name") or "",
                                       "se": r["series"], "sc": _scene_key(r)})
    out.update(row_values=row_values, col_values=col_values, cells=cells)
    return out


def _thumb_body(fp, side):
    """(path of a small copy of a render, or None). Made the first time it
    is asked for, then kept."""
    try:
        side = int(side)
    except (TypeError, ValueError):
        side = THUMB_SIDE
    side = THUMB_SIDE if side <= THUMB_SIDE else 960
    if not isinstance(fp, str) or not re.match(r"^[0-9a-f]{6,40}-\d+$", fp):
        return None
    path = _thumb_path(fp, side)
    if os.path.isfile(path):
        return path
    _load()
    with _lock:
        rid = _mem["by_fp"].get(fp)
        row = _mem["rows"].get(rid) if rid is not None else None
    src = _file_of(row) if row else None
    if not src:
        # the picture is away: the small copy kept for the wall stands in
        small = _thumb_path(fp, THUMB_SIDE)
        return small if os.path.isfile(small) else None
    try:
        with Image.open(src) as im:
            return _save_thumb(im.convert("RGB"), fp, side)
    except Exception:
        return None


def _summary_body(series, filters, wall=None, history=None, trends=None):
    _load()
    _remember_once()
    filters = _clean_filters(filters)
    if series == NO_SERIES:
        series = ""
    rows, every, season = _scope(series)
    states = _states(rows)
    # oldest first, so everything is listed in the order it was first used
    # and stays where it is as a run adds to it
    rows.sort(key=lambda r: (r.get("mtime") or 0, r["id"]))
    with _lock:
        looks = dict(_mem["looks"])
    live = [(r, states[r["id"]], _facets(r)) for r in rows if states[r["id"]] != "gone"]
    # each render under its cut's prompt version, so a version can be chosen
    # like any other value
    vid, cuts, hist, cut_names = _versions(live)
    for r, _state, facets in live:
        if r["id"] in vid:
            facets["prompt"] = [vid[r["id"]]]
    by_version = {}

    totals = _tally()
    units, unit_order, unit_entries = {}, [], {}
    axes, axis_order, labels = {}, [], {"lora": "LoRA", "frame": "frame"}
    lora_names = {}
    chosen = []                       # (row, facets, look) for every render that passes
    beside = []                       # and those that would, with the cut let go
    narrowed = any(f["axis"] == "scene" for f in filters)
    unmeasured = []
    for r, state, facets in live:
        look = looks.get(r["fp"])
        if _stale(look):
            unmeasured.append(r["fp"])
        for key, label, _value in _axis_opts(r["recipe"].get("opts")):
            labels.setdefault("opt:" + key, label)
        if _passes(facets, filters):
            _add(totals, state)
            chosen.append((r, state, facets, look))
        if r["id"] in vid and _passes(facets, filters, "prompt"):
            ck, _bar, n = vid[r["id"]].rpartition("|")
            per = by_version.setdefault(ck, {})
            if int(n) not in per:
                per[int(n)] = _tally()
            _add(per[int(n)], state)
        if narrowed and look and _passes(facets, filters, "scene"):
            beside.append((r, state, look))
        # the strip: episodes of a season, cuts of an episode
        uk = None
        if season is not None:
            uk = r["series"]
        elif not every:
            uk = _scene_key(r)
        if uk and _passes(facets, filters, "scene"):
            if uk not in units:
                units[uk] = dict(_tally(), key=uk, no="", name="", latest=0.0)
                unit_order.append(uk)
                unit_entries[uk] = []
            u = units[uk]
            _add(u, state)
            unit_entries[uk].append((r, look))
            if (r.get("mtime") or 0) >= u["latest"]:
                if season is not None:
                    ep = _episode(r["series"])
                    u.update(latest=r.get("mtime") or 0, no="E%d" % ep[1], name=r["series"])
                else:
                    u.update(latest=r.get("mtime") or 0, no=r.get("scene_no") or "",
                             name=r.get("scene_name") or "")
        for axis, values in facets.items():
            if axis in ("scene", "prompt") or not _passes(facets, filters, axis):
                continue
            if axis not in axes:
                axes[axis] = {"values": {}, "order": [], "n": 0}
                axis_order.append(axis)
            a = axes[axis]
            a["n"] += 1
            for value in values:
                if value not in a["values"]:
                    a["values"][value] = _tally()
                    a["order"].append(value)
                _add(a["values"][value], state)
        for n, _s in r["recipe"].get("loras") or []:
            lora_names.setdefault(_canon(n), set()).add(n)

    if unmeasured:
        _measure_kick(unmeasured)

    def rank(axis):
        return (0 if axis == "lora" else 2 if axis == "frame" else 1, axis_order.index(axis))

    out_axes, always = [], set()
    for axis in sorted(axis_order, key=rank):
        a = axes[axis]
        values = []
        for value in a["order"]:
            t = a["values"][value]
            item = dict(t, value=value, thin=t["n"] < THIN)
            if axis == "lora":
                item["names"] = sorted(lora_names.get(value, {value}))
                item["always"] = a["n"] >= THIN and t["n"] >= a["n"] * ALWAYS_SHARE
                if item["always"]:
                    always.add(value)
            values.append(item)
        out_axes.append({"axis": axis, "label": labels.get(axis, axis), "values": values})

    unit_list = [units[k] for k in unit_order]
    story = None if (every or season is not None) else _story(series)
    if story and story.get("scenes") and not any(f["axis"] == "scene" for f in filters):
        # the scenes the Series Book holds that have no render yet are shown
        # too, at nought - a series saved and not rendered shows all of them
        have_no = {_cut_no(u["no"]) for u in unit_list if _cut_no(u["no"]) is not None}
        have_name = {u["name"] for u in unit_list}
        for sc in story["scenes"]:
            if _cut_no(sc["no"]) in have_no or sc["name"] in have_name:
                continue
            key = "%s@%s" % (series, sc["name"])
            if key in units:
                continue
            units[key] = dict(_tally(), key=key, no=sc["no"], name=sc["name"], latest=0.0)
            unit_order.append(key)
            unit_entries[key] = []
        unit_list = [units[k] for k in unit_order]
    for u in unit_list:
        u.pop("latest", None)
        u["look"] = _unit_look(unit_entries[u["key"]])
        u["time"] = _time_of([r for r, _look in unit_entries[u["key"]]], u["pick"])
        if season is not None:
            st = _story(u["key"])
            u["note"] = st["note"] if st else ""
        elif story:
            u["note"] = story["cuts"].get(_cut_no(u["no"]), "")

    if season is not None:
        def unit_sort(u):
            ep = _episode(u["key"])
            return (ep[1] if ep else 0, unit_order.index(u["key"]))
    else:
        def unit_sort(u):
            digits = "".join(ch for ch in u["no"] if ch.isdigit())
            return (0, int(digits)) if digits else (1, unit_order.index(u["key"]))
    unit_list.sort(key=unit_sort)
    # cuts of a series made before the Series Lab wrote their numbers down
    # are numbered by the order they were first rendered in
    if season is None:
        for i, u in enumerate(unit_list):
            if not any(ch.isdigit() for ch in u["no"]):
                u["no"] = "%02d" % (i + 1)
                u["counted_no"] = True

    points = []
    for r, state, _facets_, look in chosen:
        if not look:
            continue
        p = {"b": look["b"], "c": look["c"], "s": look["s"], "w": look["w"],
             "avg": look["avg"], "st": state, "se": r["series"], "sc": _scene_key(r),
             "no": r.get("scene_no") or "", "nm": r.get("scene_name") or "",
             "f": r["name"], "fp": r["fp"],
             "ar": round((r.get("h") or 1) / float(r.get("w") or 1), 3)}
        grid = _framed(look)
        if grid:
            p["cx"], p["cy"] = _centroid(grid)
        points.append(p)
    # with a cut chosen, the other cuts' renders too - so pointing at one in
    # the palette can show it on the tone map beside the chosen one
    context = [{"b": look["b"], "c": look["c"], "avg": look["avg"], "st": state,
                "se": r["series"], "sc": _scene_key(r), "no": r.get("scene_no") or "",
                "nm": r.get("scene_name") or "", "f": r["name"],
                "s": look["s"], "w": look["w"]}
               for r, state, look in beside] if narrowed else None
    framed = [_framed(look) for _r, _st, _f, look in chosen if look]
    framed = [g for g in framed if g]
    frame = None
    if framed:
        ars = sorted(p["ar"] for p in points)
        inside = sum(1 for p in points if "cx" in p
                     and abs(p["cx"] - 0.5) < 1 / 6.0 and abs(p["cy"] - 0.5) < 1 / 6.0)
        frame = {"grid": _mean_grid(framed), "ar": ars[len(ars) // 2],
                 "centred": inside, "n": len(framed)}
    recipes = _recipes([(r, f, look) for r, _st, f, look in chosen if look],
                       labels, lora_names, always)

    with _lock:
        counts, first, last = {}, {}, {}
        for r in _mem["rows"].values():
            if not _counted(r):
                continue
            counts[r["series"]] = counts.get(r["series"], 0) + 1
            at = r.get("mtime") or 0
            if r["series"] not in first or at < first[r["series"]]:
                first[r["series"]] = at
            last[r["series"]] = max(at, last.get(r["series"], 0))
        aliases = dict(_mem["aliases"])
        measuring = _measuring["running"]
        # a series is archived when none of its counted renders is in reach
        # (deleted renders are out of reach either way; at least one away)
        counted, away, moved = {}, {}, set()
        for r in _mem["rows"].values():
            if r["state"] in ("pick", "kept", "deleted") and _counted(r):
                counted[r["series"]] = counted.get(r["series"], 0) + 1
                if r.get("away") or r["state"] == "deleted":
                    away[r["series"]] = away.get(r["series"], 0) + 1
                if r.get("away"):
                    moved.add(r["series"])
    hidden_now = set(_get_settings()["hidden"])
    for bname, bhit in _book_index().items():
        if bname not in counts and bname not in hidden_now:
            counts[bname] = 0
            first[bname] = last[bname] = bhit[0]
    names = sorted(counts, key=lambda k: (k == "", (_episode(k) or (10 ** 6, 0)), first[k]))
    seasons = {}
    for n in names:
        ep = _episode(n)
        if ep:
            seasons[ep[0]] = seasons.get(ep[0], 0) + counts[n]
    if every:
        kind = ""
    else:
        kind = "episode" if season is not None else "cut"
    return {
        "ok": True, "series": "*" if every else (series or NO_SERIES), "filters": filters,
        "path": _path(series, every, season),
        "story": story["note"] if story else "",
        "series_hue": _scope_hue(story, unit_list, season),
        "totals": totals,
        "time": _time_of([e[0] for e in chosen], totals["pick"]),
        "timeline": _timeline(chosen),
        "speeds": _speeds(chosen, out_axes, always),
        "units": unit_list, "units_kind": kind,
        "units_picked": sum(1 for u in unit_list if u["pick"]),
        "axes": out_axes,
        "points": points,
        "points_beside": context,
        "frame": frame,
        "wall": _wall(chosen, out_axes, always, wall) if wall is not None else None,
        "recipes": recipes,
        "versions": _version_report(cuts, hist, cut_names, by_version, unit_list, kind == "cut"),
        "looks": {"measured": len(points), "of": totals["n"],
                  "left": len([fp for fp in unmeasured if fp not in _measuring["failed"]]),
                  "running": measuring},
        "all_series": [{"name": n, "n": counts[n], "season": (_episode(n) or (None,))[0],
                        "last": last[n],
                        "archived": n in moved and away.get(n, 0) == counted.get(n, -1)}
                       for n in names],
        "archived": sum(1 for r, st, _f in live if r.get("away")),
        "seasons": [{"season": s, "n": seasons[s]} for s in sorted(seasons)],
        "aliases": aliases, "thin": THIN, "scanning": _scan["running"],
        "history": _history(history) if history is not None and history is not False else None,
        "trends": _trends(trends) if trends is not None and trends is not False else None,
        "settings": {"from": _get_settings()["from"], "hidden": _get_settings()["hidden"]},
    }


def _alias_body(name, same_as):
    """Count one LoRA name as another, or - with nothing to count it as -
    on its own again."""
    _load()
    name = str(name or "").strip()
    same_as = str(same_as or "").strip()
    if not name:
        return {"ok": False, "error": "no name"}
    with _lock:
        if same_as and _canon(same_as) == name:
            return {"ok": False, "error": "that would point two names at each other"}
        con = _connect()
        try:
            if same_as and same_as != name:
                con.execute("INSERT OR REPLACE INTO aliases(name, same_as) VALUES(?,?)",
                            (name, same_as))
                _mem["aliases"][name] = same_as
            else:
                con.execute("DELETE FROM aliases WHERE name=?", (name,))
                _mem["aliases"].pop(name, None)
            con.commit()
        finally:
            con.close()
    return {"ok": True}


def _ingest_body(folder, name):
    v = _viewer()
    path = v._locate(folder, name)
    if path is None or not path.lower().endswith(".png"):
        return {"ok": False, "error": "not a picture this report may read"}
    what, row = _ingest(path)
    if row is None:
        return {"ok": True, "what": what}
    _measure_kick([row["fp"]])
    return {"ok": True, "what": what, "series": row["series"], "scene": _scene_key(row)}


def _follow_body(folder, names):
    """Which series to show for a series opened in a Series Book (names) or
    a folder opened in an Image Viewer (folder).

    A folder is read first if it holds renders the ledger has not seen, so
    following the viewer works without a scan. A very large one is read in
    part here and the rest handed to the scan."""
    v = _viewer()
    _load()
    if names:
        asked = [str(n) for n in names if isinstance(n, str) and n]
        with _lock:
            known = {r["series"] for r in _mem["rows"].values()}
        known |= set(_book_index())
        hit = next((n for n in asked if n in known), None)
        return {"ok": True, "series": hit, "asked": asked[0] if asked else ""}

    roots = v._multi(folder)
    if roots is not None:
        dirs = [d for _tag, d in roots]
    else:
        path, err = v._folder(folder)
        if err:
            return {"ok": False, "error": err}
        dirs = [path]

    read, more = 0, False
    con = _connect()
    try:
        for d in dirs:
            for e in _walk(d):
                try:
                    mtime = e.stat().st_mtime
                except OSError:
                    continue
                known = _mem["files"].get(v._key(e.path))
                if known and known[0] == mtime:
                    continue
                if read >= FOLLOW_CAP:
                    more = True
                    break
                with _lock:
                    _ingest(e.path, con)
                    con.commit()
                read += 1
            if more:
                break
    finally:
        con.close()
    # Renders nobody had read means the ledger is behind, and the rest of
    # this series may sit in a folder beside this one - a second day of it.
    # The scan catches up on everything while the page shows what is known.
    if read:
        more = True
    if more:
        _scan_start()

    bases = [v._key(d).rstrip(os.sep) + os.sep for d in dirs]
    with _lock:
        every = list(_mem["rows"].values())
    inside = [r for r in every if any(_pick_key(r).startswith(b) for b in bases)]
    if not inside:
        return {"ok": True, "series": None, "n": 0, "read": read, "more": more}
    names_in = {r["series"] for r in inside}
    if len(names_in) == 1:
        series = next(iter(names_in))
    else:
        # a day's folder with several series in it: the one worked on last
        series = max(inside, key=lambda r: r.get("mtime") or 0)["series"]
    mine = [r for r in inside if r["series"] == series]
    scenes = {_scene_key(r) for r in mine}
    whole = sum(1 for r in every if r["series"] == series)
    # a folder that is one scene of a longer series narrows to that scene
    scene = next(iter(scenes)) if len(scenes) == 1 and len(mine) < whole else ""
    return {"ok": True, "series": series or NO_SERIES, "scene": scene,
            "n": len(mine), "read": read, "more": more}


def _export_csv(series):
    _load()
    if series == "":
        series = None
    if series == NO_SERIES:
        series = ""
    rows, _every, _season = _scope(series)
    rows.sort(key=lambda r: (r.get("mtime") or 0, r["id"]))
    states = _states(rows)
    with _lock:
        looks = dict(_mem["looks"])
    keys, labels = [], {}
    for r in rows:
        for key, label, _value in r["recipe"].get("opts") or []:
            if key not in labels:
                labels[key] = label
                keys.append(key)
    buf = io.StringIO()
    out = csv.writer(buf, lineterminator="\n")
    out.writerow(["series", "scene_no", "scene", "file", "state", "frame", "width", "height",
                  "seed", "loras", "brightness", "contrast", "saturation", "warmth",
                  "render_seconds", "time_source", "archived"]
                 + [labels[k] for k in keys])
    est = _estimated()
    for r in rows:
        if "secs" in r["recipe"]:
            secs, src = r["recipe"]["secs"], "written"
        elif r["id"] in est:
            secs, src = est[r["id"]], "estimated"
        else:
            secs, src = "", ""
        opts = {k: val for k, _l, val in _live_opts(r["recipe"].get("opts"))}
        loras = " + ".join("%s(%s)" % (_canon(n), s) for n, s in r["recipe"].get("loras") or [])
        out.writerow([r["series"], r["scene_no"], r["scene_name"], r["name"], states[r["id"]],
                      _frame(r), r["w"], r["h"], r["seed"], loras]
                     + [(looks.get(r["fp"]) or {}).get(m, "") for m in METRICS]
                     + [secs, src, "yes" if r.get("away") else ""]
                     + [opts.get(k, "") for k in keys])
    return buf.getvalue()


# ------------------------------------------------------------------ routes
try:                                                 # pragma: no cover
    import asyncio

    from aiohttp import web as _web
    from server import PromptServer as _PromptServer

    _routes = _PromptServer.instance.routes

    async def _json(request):
        try:
            return await request.json()
        except Exception:
            return {}

    async def _run(fn, *args):
        return await asyncio.get_running_loop().run_in_executor(None, fn, *args)

    @_routes.post("/leiel_report/summary")
    async def _report_summary(request):
        data = await _json(request)
        return _web.json_response(await _run(_summary_body, data.get("series"),
                                             data.get("filters"), data.get("wall"),
                                             data.get("history"), data.get("trends")))

    @_routes.get("/leiel_report/thumb")
    async def _report_thumb(request):
        q = request.rel_url.query
        path = await _run(_thumb_body, q.get("fp"), q.get("s"))
        if not path:
            return _web.Response(status=404)
        return _web.FileResponse(path, headers={"Cache-Control": "max-age=604800"})

    @_routes.post("/leiel_report/ingest")
    async def _report_ingest(request):
        data = await _json(request)
        return _web.json_response(await _run(_ingest_body, data.get("folder"),
                                             data.get("name")))

    @_routes.post("/leiel_report/scan")
    async def _report_scan(request):
        data = await _json(request)
        if data.get("stop"):
            _scan["stop"] = True
        else:
            _scan_start()
        return _web.json_response(await _run(_status_body))

    @_routes.get("/leiel_report/status")
    async def _report_status(request):
        return _web.json_response(await _run(_status_body))

    @_routes.post("/leiel_report/follow")
    async def _report_follow(request):
        data = await _json(request)
        return _web.json_response(await _run(_follow_body, data.get("folder"),
                                             data.get("names")))

    @_routes.post("/leiel_report/alias")
    async def _report_alias(request):
        data = await _json(request)
        return _web.json_response(await _run(_alias_body, data.get("name"),
                                             data.get("same_as")))

    @_routes.post("/leiel_report/hide")
    async def _report_hide(request):
        data = await _json(request)
        return _web.json_response(await _run(_hide_body, data.get("name"), bool(data.get("hide", True))))

    @_routes.get("/leiel_report/export")
    async def _report_export(request):
        series = request.rel_url.query.get("series")
        body = await _run(_export_csv, series)
        return _web.Response(text=body, content_type="text/csv", charset="utf-8", headers={
            "Content-Disposition": 'attachment; filename="series_report.csv"'})
except Exception:                                    # pragma: no cover
    pass


class LeielSeriesReport:
    """A window onto the ledger. It takes nothing and returns nothing, and
    is never run: everything it shows is counted when the browser asks."""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {}}

    RETURN_TYPES = ()
    FUNCTION = "noop"
    CATEGORY = "Studio Leiel"
    DESCRIPTION = (
        "What a series has made so far, and how it looks: the tone and colour "
        "of every render, cut by cut and episode by episode, how far each "
        "LoRA, sampler and option moves brightness, contrast, saturation and "
        "warmth, and what was picked or deleted in the Visual Image Viewer. "
        "Reads the recipe in each PNG and measures its pixels; changes no file."
    )

    def noop(self):
        return ()


NODE_CLASS_MAPPINGS = {
    "LeielSeriesReport": LeielSeriesReport,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "LeielSeriesReport": "Visual Series Report (Studio Leiel)",
}
