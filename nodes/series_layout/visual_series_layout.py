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
Studio Leiel - Visual Series Layout
--------------------------------------------------
A series laid out as spreads. The Series Book holds the words of a series -
its title, its note, and for every cut a number, a name, a frame and a
caption. The Visual Image Viewer holds the choice - the renders picked with
P. This node puts the two together on the pages of a magazine.

Nothing here makes a picture or writes a word. The cuts and captions are
read from the newest Series Book file of the series; the picks are the
Viewer's picks.json; which cut a render belongs to is read from the PNG
through the Visual Series Report's ledger, so a pick made a minute ago is
found without a scan. The page itself is drawn in the browser - the same
drawing on screen and in the exported file - and only the finished spreads
come back here, to be written into the output folder.
"""

import base64
import io
import json
import os
import re
import threading
import time

from PIL import Image

LAYOUT_DIRNAME = "layout"          # the folder in output/<series>/ the spreads go to
PREVIEW_SIDES = (400, 800, 1600)   # the sizes a picture is sent at for the screen
PREVIEW_KEEP = 160                 # small copies kept in memory


def _report():
    """The Visual Series Report of this pack - its ledger knows which series
    and cut every render belongs to."""
    try:
        from ..series_report import visual_series_report as r
    except Exception:
        import series_report.visual_series_report as r   # noqa: E402
    return r


def _output_dir():
    import folder_paths
    return folder_paths.get_output_directory()


# ------------------------------------------------------------- the book
def _book_files():
    """{series name: (mtime, path)} - the newest Series Book file of each."""
    folder = _report()._book_series_dir()
    try:
        names = [n for n in os.listdir(folder) if n.endswith(".json")]
    except OSError:
        return {}
    best = {}
    for n in names:
        path = os.path.join(folder, n)
        try:
            mtime = os.path.getmtime(path)
            with open(path, "r", encoding="utf-8") as fh:
                doc = json.load(fh)
        except Exception:
            continue
        name = str((doc.get("group") or {}).get("name") or "").strip()
        if name and (name not in best or mtime > best[name][0]):
            best[name] = (mtime, path, doc)
    return best


_CUT_NAME = re.compile(r"^\s*(C-?\s?\d+[A-Za-z]?)\s+(.*)$")
# a caption line in a scene's note: "Caption:", or the same word in the book's other language
_CAPTION = re.compile(r"^\s*(?:caption|\uc790\ub9c9)\s*[:\uff1a]\s*(.*)$", re.I)


def _cut_label(no, name):
    """('01', 'The Cape at Dawn') for 'C-01 The Cape at Dawn' - the number
    a scene's name starts with, or the Book's own number."""
    m = _CUT_NAME.match(name or "")
    if m:
        digits = re.sub(r"[^0-9A-Za-z]", "", m.group(1))[1:]
        return digits, m.group(2).strip()
    return ("%02d" % no if isinstance(no, int) else ""), (name or "").strip()


def _caption(note):
    for line in str(note or "").splitlines():
        m = _CAPTION.match(line)
        if m:
            return m.group(1).strip()
    return ""


def _body(note):
    """The scene's note without its Caption line - the text of the cut."""
    lines = [ln.rstrip() for ln in str(note or "").splitlines() if not _CAPTION.match(ln)]
    return "\n".join(lines).strip()


def _series_body():
    files = _book_files()
    out = []
    for name, (mtime, _path, doc) in files.items():
        g = doc.get("group") or {}
        out.append({"name": name, "no": g.get("no"), "mtime": mtime,
                    "n": len(doc.get("prompts") or [])})
    out.sort(key=lambda s: -s["mtime"])
    return {"ok": True, "list": out}


# ------------------------------------------------------------- the picks
_sync = {"lock": threading.Lock(), "sig": None}


def _sync_picks():
    """Make sure every picked render is in the ledger. A pick is a path in
    the Viewer's picks.json; a render the ledger has not read yet - made and
    picked since the last scan - is read now. Only the picks are looked at,
    so this stays quick however large the output folder is."""
    r = _report()
    v = r._viewer()
    picks = v._picks()
    r._load()
    with _sync["lock"]:
        for key in picks:
            known = r._mem["files"].get(key)
            try:
                mtime = os.path.getmtime(key)
            except OSError:
                continue
            if known and known[0] == mtime:
                continue
            r._ingest(key)
    return picks


def _book_body(series):
    files = _book_files()
    hit = files.get(series or "")
    if not hit:
        return {"ok": False, "error": "no Series Book file holds this series"}
    _mtime, _path, doc = hit
    g = doc.get("group") or {}

    r = _report()
    r._load()
    _sync_picks()
    with r._lock:
        rows = [row for row in r._mem["rows"].values() if row.get("series") == series]
    states = r._states(rows)
    picked = [row for row in rows if states.get(row["id"]) == "pick" and r._where(row) == "home"]
    picked.sort(key=lambda row: (row.get("mtime") or 0, row["id"]))

    by_no, by_name = {}, {}
    for row in picked:
        by_no.setdefault(str(row.get("scene_no") or ""), []).append(row)
        by_name.setdefault(str(row.get("scene_name") or ""), []).append(row)

    scenes, used = [], set()
    for q in doc.get("prompts") or []:
        if not isinstance(q, dict):
            continue
        try:
            no = int(q.get("no"))
        except (TypeError, ValueError):
            no = None
        name = str(q.get("name") or "")
        label, title = _cut_label(no, name)
        mine = by_no.get("%02d" % no, []) if no is not None else []
        if not mine and name:
            mine = by_name.get(name, [])
        mine = [row for row in mine if row["id"] not in used]
        used.update(row["id"] for row in mine)
        scenes.append({
            "no": "%02d" % no if no is not None else "",
            "label": label, "title": title, "name": name,
            "frame": str(q.get("orient") or ""),
            "caption": _caption(q.get("note")),
            "body": _body(q.get("note")),
            "picks": [{"id": row["id"], "w": row.get("w") or 0, "h": row.get("h") or 0,
                       "name": row.get("name") or ""} for row in mine],
        })
    note = str(g.get("note") or "").strip()
    hue = g.get("hue")
    return {"ok": True, "series": series, "no": g.get("no"), "note": note,
            "hue": hue if isinstance(hue, int) else None,
            "scenes": scenes, "loose": len(picked) - len(used)}


# ------------------------------------------------------------- pictures
_previews = {}
_previews_order = []
_previews_lock = threading.Lock()


def _picture_path(rid):
    """The file of a render the ledger knows - only those are ever served."""
    r = _report()
    r._load()
    try:
        row = r._mem["rows"].get(int(rid))
    except (TypeError, ValueError):
        return None
    if not row:
        return None
    path = row.get("home")
    return path if path and os.path.isfile(path) else None


def _preview_body(rid, side):
    path = _picture_path(rid)
    if not path:
        return None
    try:
        side = int(side)
    except (TypeError, ValueError):
        side = PREVIEW_SIDES[-1]
    if side <= 0:
        return ("file", path)
    side = min((s for s in PREVIEW_SIDES if s >= side), default=PREVIEW_SIDES[-1])
    key = (path, os.path.getmtime(path), side)
    with _previews_lock:
        hit = _previews.get(key)
    if hit:
        return ("jpeg", hit)
    with Image.open(path) as im:
        im = im.convert("RGB")
        im.thumbnail((side, side), Image.LANCZOS)
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=90)
    data = buf.getvalue()
    with _previews_lock:
        _previews[key] = data
        _previews_order.append(key)
        while len(_previews_order) > PREVIEW_KEEP:
            _previews.pop(_previews_order.pop(0), None)
    return ("jpeg", data)


# ------------------------------------------------------------- export
_UNSAFE = re.compile(r'[<>:"/\\|?*\x00-\x1f]+')


def _safe(name):
    return _UNSAFE.sub(" ", str(name or "")).strip().rstrip(".") or "series"


_KINDS = ("spread", "frame", "proof", "page")


def _dest(series, fmt, kind, folder):
    """Where an export goes: the folder asked for, or output/<series>/layout/<size>/."""
    where = str(folder or "").strip().strip('"')
    if where:
        where = os.path.normpath(os.path.expanduser(where))
        if not os.path.isdir(where):
            return None, "that folder does not exist: %s" % where
        return where, None
    path = os.path.join(_output_dir(), _safe(series), LAYOUT_DIRNAME, _safe(fmt or kind))
    os.makedirs(path, exist_ok=True)
    return path, None


def _numbered(base, taken):
    """base, or base (2), base (3)... - the first that taken() says is free.
    Nothing an export or a package writes ever replaces an earlier one."""
    if not taken(base):
        return base
    n = 2
    while taken("%s (%d)" % (base, n)):
        n += 1
    return "%s (%d)" % (base, n)


def _blob(data):
    raw = str(data or "")
    if "," in raw:
        raw = raw.split(",", 1)[1]
    return base64.b64decode(raw)


def _save_body(series, index, total, data, ext, fmt, kind, folder=None, name=None, stem=None):
    """Write one exported spread, page or frame. The first one of an export
    chooses the name - the one asked for, or with (2), (3)... after it when
    files of that name are there already - and the rest follow it."""
    try:
        index, total = int(index), int(total)
    except (TypeError, ValueError):
        return {"ok": False, "error": "bad page number"}
    ext = "png" if ext == "png" else "jpg"
    try:
        blob = _blob(data)
    except Exception:
        return {"ok": False, "error": "the picture did not arrive whole"}
    kind = kind if kind in _KINDS else "spread"
    chosen = bool(str(folder or "").strip())
    folder, err = _dest(series, fmt, kind, folder)
    if err:
        return {"ok": False, "error": err}
    if chosen and kind == "frame":
        # web sizes go each into a folder of its own inside the one chosen
        folder = os.path.join(folder, _safe(fmt or "web"))
        os.makedirs(folder, exist_ok=True)
    if index == 1 or not stem:
        here = os.listdir(folder)

        def taken(st):
            pat = re.compile(re.escape(st) + r" - (spread|page|frame|proof) \d+\.(png|jpg)$")
            return any(pat.match(n) for n in here)
        stem = _numbered(_safe(name or series), taken)
    else:
        stem = _safe(stem)
    path = os.path.join(folder, "%s - %s %02d.%s" % (stem, kind, index, ext))
    with open(path, "wb") as fh:
        fh.write(blob)
    return {"ok": True, "path": path, "folder": folder, "stem": stem}


# ------------------------------------------------------------- pdf
# A PDF of the pages exported, written page by page: each page is a JPEG
# placed whole - not decoded and encoded again - at the page's size, so a
# book of large spreads needs no more memory than one of its pages.
_pdf_jobs = {}
_pdf_lock = threading.Lock()


def _pdf_dir(token):
    base = os.path.join(_report()._viewer()._user_dir(), "visual_series_layout", "pdf")
    token = re.sub(r"[^A-Za-z0-9_-]", "", str(token or ""))[:40] or "job"
    path = os.path.join(base, token)
    os.makedirs(path, exist_ok=True)
    return path


def _pdf_page_body(token, index, data):
    try:
        blob = _blob(data)
        index = int(index)
    except Exception:
        return {"ok": False, "error": "the page did not arrive whole"}
    path = os.path.join(_pdf_dir(token), "%04d.jpg" % index)
    with open(path, "wb") as fh:
        fh.write(blob)
    return {"ok": True}


def _write_pdf(path, pages, title):
    """pages: [(jpeg path, width pt, height pt, pixel w, pixel h)]."""
    objs = []                      # bytes of each object, numbered from 1

    def add(b):
        objs.append(b)
        return len(objs)

    catalog = add(b"")             # filled in at the end
    pages_obj = add(b"")
    kids = []
    for jpg, wpt, hpt, pw, ph in pages:
        with open(jpg, "rb") as fh:
            data = fh.read()
        img = add(b"<< /Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace /DeviceRGB "
                  b"/BitsPerComponent 8 /Filter /DCTDecode /Length %d >>\nstream\n" % (pw, ph, len(data))
                  + data + b"\nendstream")
        content = b"q %.3f 0 0 %.3f 0 0 cm /Im0 Do Q" % (wpt, hpt)
        cs = add(b"<< /Length %d >>\nstream\n" % len(content) + content + b"\nendstream")
        page = add(b"<< /Type /Page /Parent %d 0 R /MediaBox [0 0 %.3f %.3f] "
                   b"/Resources << /XObject << /Im0 %d 0 R >> >> /Contents %d 0 R >>"
                   % (pages_obj, wpt, hpt, img, cs))
        kids.append(page)
    objs[pages_obj - 1] = (b"<< /Type /Pages /Kids [" + b" ".join(b"%d 0 R" % k for k in kids)
                           + b"] /Count %d >>" % len(kids))
    objs[catalog - 1] = b"<< /Type /Catalog /Pages %d 0 R >>" % pages_obj
    safe_title = str(title or "").replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    info = add(b"<< /Title (" + safe_title.encode("latin-1", "replace") + b") /Producer (Visual Series Layout) >>")
    out = io.BytesIO()
    out.write(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = []
    for i, b in enumerate(objs, 1):
        offsets.append(out.tell())
        out.write(b"%d 0 obj\n" % i + b + b"\nendobj\n")
    xref = out.tell()
    out.write(b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1))
    for o in offsets:
        out.write(b"%010d 00000 n \n" % o)
    out.write(b"trailer\n<< /Size %d /Root %d 0 R /Info %d 0 R >>\nstartxref\n%d\n%%%%EOF\n"
              % (len(objs) + 1, catalog, info, xref))
    with open(path, "wb") as fh:
        fh.write(out.getvalue())


def _pdf_done_body(token, series, fmt, folder, name, page_mm):
    import shutil
    work = _pdf_dir(token)
    try:
        dest, err = _dest(series, fmt, "pdf", folder)
        if err:
            return {"ok": False, "error": err}
        files = sorted(n for n in os.listdir(work) if n.endswith(".jpg"))
        if not files:
            return {"ok": False, "error": "no pages arrived"}
        wpt, hpt = float(page_mm[0]) * 72 / 25.4, float(page_mm[1]) * 72 / 25.4
        pages = []
        for n in files:
            p = os.path.join(work, n)
            with Image.open(p) as im:
                pw, ph = im.size
            pages.append((p, wpt, hpt, pw, ph))
        stem = _numbered(_safe(name or series), lambda st: os.path.exists(os.path.join(dest, st + ".pdf")))
        path = os.path.join(dest, stem + ".pdf")
        _write_pdf(path, pages, name or series)
        return {"ok": True, "path": path, "folder": dest, "pages": len(pages)}
    finally:
        shutil.rmtree(work, ignore_errors=True)


# ------------------------------------------------------------- package
# A package is what a printer is sent: the pictures the layout uses, the
# typefaces it sets, a proof of every spread, a report of how sharp each
# picture prints, and the layout itself. The pictures are copied as they
# are, so they can be upscaled in any way and linked again.
PACKAGE_SUFFIX = " - Package"
_FONTS_HERE = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                           "web", "series_layout", "fonts")
# the pack's own typefaces: desktop files for the package, and their licences
_SHIPPED = {"Cormorant Garamond": ("CormorantGaramond_", "OFL-CormorantGaramond.txt"),
            "Inter": ("Inter_", "OFL-Inter.txt")}
_font_index = {"built": 0, "map": {}}
_font_lock = threading.Lock()


def _font_dirs():
    dirs = []
    win = os.environ.get("WINDIR") or os.environ.get("SystemRoot")
    if win:
        dirs.append(os.path.join(win, "Fonts"))
    local = os.environ.get("LOCALAPPDATA")
    if local:
        dirs.append(os.path.join(local, "Microsoft", "Windows", "Fonts"))
    home = os.path.expanduser("~")
    dirs += [os.path.join(home, "Library", "Fonts"), "/Library/Fonts", "/System/Library/Fonts",
             os.path.join(home, ".fonts"), os.path.join(home, ".local", "share", "fonts"), "/usr/share/fonts"]
    return [d for d in dirs if os.path.isdir(d)]


def _font_files(family):
    """Every font file on this computer whose family is the one asked for -
    all its weights and styles. The fonts are read once, then remembered."""
    from PIL import ImageFont
    with _font_lock:
        if not _font_index["built"]:
            index = {}
            for d in _font_dirs():
                for base, _dirs, files in os.walk(d):
                    for n in files:
                        if not n.lower().endswith((".ttf", ".otf", ".ttc")):
                            continue
                        path = os.path.join(base, n)
                        try:
                            fam = ImageFont.truetype(path, 12).getname()[0]
                        except Exception:
                            continue
                        index.setdefault(str(fam).strip().lower(), []).append(path)
            _font_index.update(built=1, map=index)
        return list(_font_index["map"].get(str(family).strip().lower(), []))


def _link_name(label, title):
    name = ("%s %s" % (label, title)).strip() if title else str(label)
    return _safe(name)[:120]


def _package_body(data):
    series = str(data.get("series") or "")
    if not series:
        return {"ok": False, "error": "no series"}
    # into the folder asked for, or beside the series' own output
    where = str(data.get("folder") or "").strip().strip('"')
    if where:
        where = os.path.normpath(os.path.expanduser(where))
        if not os.path.isdir(where):
            return {"ok": False, "error": "that folder does not exist: %s" % where}
    else:
        where = os.path.join(_output_dir(), _safe(series))
        os.makedirs(where, exist_ok=True)
    # a package of the name asked for - or with (2), (3)... after it, so an
    # earlier package, upscaled pictures and all, is never written over
    nm = _numbered(_safe(data.get("name") or series),
                   lambda st: os.path.exists(os.path.join(where, st + PACKAGE_SUFFIX)))
    folder = os.path.join(where, nm + PACKAGE_SUFFIX)
    links_dir = os.path.join(folder, "Links")
    fonts_dir = os.path.join(folder, "Fonts")
    os.makedirs(links_dir, exist_ok=True)
    os.makedirs(fonts_dir, exist_ok=True)

    # the links: the picture of every cut, under its number and title
    for n in os.listdir(links_dir):
        if n.lower().endswith(RELINK_EXTS):
            try:
                os.remove(os.path.join(links_dir, n))
            except OSError:
                pass
    links, missing = {}, []
    for ln in data.get("links") or []:
        # the upscaled picture when one is linked, the render otherwise
        src = _linked_file(ln.get("hd")) if ln.get("hd") else None
        src = src or _picture_path(ln.get("id"))
        ext = os.path.splitext(src)[1].lower() if src else ".png"
        name = _link_name(ln.get("label") or ln.get("no") or "", ln.get("title") or "") + (ext or ".png")
        if not src:
            missing.append(name)
            continue
        import shutil
        shutil.copy2(src, os.path.join(links_dir, name))
        links[str(ln.get("id"))] = {"cut": str(ln.get("no")), "file": "Links/" + name, "source": src}

    # the typefaces: the pack's own, or the files of a typeface on this computer
    import shutil
    fonts_done, fonts_missing = [], []
    for fam in dict.fromkeys(data.get("fonts") or []):
        own = _SHIPPED.get(fam)
        if own:
            prefix, licence = own
            desk = os.path.join(_FONTS_HERE, "desktop")
            for n in os.listdir(desk):
                if n.startswith(prefix):
                    shutil.copy2(os.path.join(desk, n), os.path.join(fonts_dir, n))
            shutil.copy2(os.path.join(_FONTS_HERE, licence), os.path.join(fonts_dir, licence))
            fonts_done.append(fam)
            continue
        files = _font_files(fam)
        for p in files:
            try:
                shutil.copy2(p, os.path.join(fonts_dir, os.path.basename(p)))
            except OSError:
                pass
        (fonts_done if files else fonts_missing).append(fam)

    # the proof: every spread at screen sharpness, one PDF
    pages = []
    for raw in data.get("pages") or []:
        raw = str(raw or "")
        if "," in raw:
            raw = raw.split(",", 1)[1]
        try:
            pages.append(Image.open(io.BytesIO(base64.b64decode(raw))).convert("RGB"))
        except Exception:
            pass
    proof = os.path.join(folder, "%s - Proof.pdf" % nm)
    if pages:
        dpi = float(data.get("proof_dpi") or 150)
        pages[0].save(proof, "PDF", resolution=dpi, save_all=True, append_images=pages[1:],
                      title="%s - Proof" % series)

    # the report
    rows = data.get("report") or []
    lines = [
        "%s - Package" % nm,
        "Visual Series Layout - %s, %s" % (data.get("format_label") or "", data.get("format_size") or ""),
        "Written %s" % time.strftime("%Y-%m-%d %H:%M"),
        "",
        "LINKS - how sharp each picture prints where it is placed. 300 dpi is print quality.",
        "",
    ]
    head = ("CUT", "LINK", "NOW", "PLACED AS", "DPI", "NEEDS FOR 300 DPI")
    table = [head] + [(str(r.get("cut", "")), str(r.get("link", "")), str(r.get("now", "")),
                       str(r.get("placed", "")), str(r.get("dpi", "")), str(r.get("needs", ""))) for r in rows]
    widths = [max(len(t[i]) for t in table) for i in range(len(head))]
    for t in table:
        lines.append("  ".join(t[i].ljust(widths[i]) for i in range(len(head))).rstrip())
    low = [r for r in rows if isinstance(r.get("dpi"), (int, float)) and r["dpi"] < 300]
    lines += ["", ("%d of %d pictures are below 300 dpi - upscale them, then link them again."
                   % (len(low), len(rows))) if low else "Every picture prints at 300 dpi or more."]
    if missing:
        lines += ["", "Not found, not copied: " + ", ".join(missing)]
    lines += ["", "TYPEFACES", ""]
    lines += ["  %s - copied" % f for f in fonts_done]
    lines += ["  %s - not found on this computer, not copied" % f for f in fonts_missing]
    lines += ["", "Typefaces are copied for this job only. Their licences are the user's responsibility."]
    with open(os.path.join(folder, "Report.txt"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")

    # an InDesign document of the layout, its pictures linked to Links
    idml_path = None
    if data.get("idml"):
        link_paths = {i: os.path.join(folder, *l["file"].split("/")) for i, l in links.items()}
        try:
            idml_path = _idml_body(folder, nm, data["idml"], link_paths)
        except Exception as exc:
            return {"ok": False, "error": "the InDesign file could not be written: %s" % exc}

    # the layout itself, to open again and link again
    doc = dict(data.get("layout") or {})
    doc.update(format="visual-series-layout", version=1, series=series, links=links, package=folder,
               written=time.strftime("%Y-%m-%dT%H:%M:%S"))
    with open(os.path.join(folder, "%s.layout" % nm), "w", encoding="utf-8") as fh:
        json.dump(doc, fh, ensure_ascii=False, indent=2)

    return {"ok": True, "folder": folder, "name": nm, "links": len(links), "missing": missing, "idml": idml_path,
            "fonts": fonts_done, "fonts_missing": fonts_missing, "low": len(low)}


# ------------------------------------------------------------- relink
# A picture upscaled outside the suite comes back under any name, in any
# folder. It is recognised by what it shows: both pictures are reduced to a
# 9 x 8 grey grid and compared edge by edge (a difference hash), and the shape
# has to be the same. An upscale changes detail, not composition, so the two
# hashes stay a few bits apart while any other picture is far away.
HASH_NEAR = 10                     # of 64 bits - farther than this is another picture
SHAPE_NEAR = 0.015                 # the shapes may differ by this much (rounding of sizes)
RELINK_EXTS = (".png", ".jpg", ".jpeg", ".tif", ".tiff", ".webp")
RELINK_CAP = 3000                  # files read from one folder at most
_hashes = {}
_hash_lock = threading.Lock()


def _dhash(path):
    """(hash, width, height) of a picture, remembered by path and time."""
    try:
        mtime = os.path.getmtime(path)
    except OSError:
        return None
    key = (path, mtime)
    with _hash_lock:
        hit = _hashes.get(key)
    if hit:
        return hit
    try:
        with Image.open(path) as im:
            w, h = im.size
            im.draft("L", (64, 64))
            g = im.convert("L").resize((9, 8), Image.LANCZOS)
            px = list(g.getdata())
    except Exception:
        return None
    bits = 0
    for row in range(8):
        for col in range(8):
            bits = (bits << 1) | (1 if px[row * 9 + col] > px[row * 9 + col + 1] else 0)
    hit = (bits, w, h)
    with _hash_lock:
        _hashes[key] = hit
    return hit


def _links_file():
    folder = os.path.join(_report()._viewer()._user_dir(), "visual_series_layout")
    os.makedirs(folder, exist_ok=True)
    return os.path.join(folder, "links.json")


_linked = {"loaded": False, "paths": set()}
_linked_lock = threading.Lock()


def _linked_paths():
    with _linked_lock:
        if not _linked["loaded"]:
            try:
                with open(_links_file(), "r", encoding="utf-8") as fh:
                    _linked["paths"] = set(json.load(fh).get("paths") or [])
            except Exception:
                _linked["paths"] = set()
            _linked["loaded"] = True
        return _linked["paths"]


def _remember_linked(paths):
    with _linked_lock:
        known = _linked["paths"] if _linked["loaded"] else set()
        known.update(paths)
        _linked.update(loaded=True, paths=known)
        try:
            with open(_links_file(), "w", encoding="utf-8") as fh:
                json.dump({"paths": sorted(known)}, fh, ensure_ascii=False, indent=1)
        except OSError:
            pass


def _relink_body(folder, ids):
    folder = os.path.normpath(str(folder or "").strip().strip('"'))
    if not folder or not os.path.isdir(folder):
        return {"ok": False, "error": "that folder does not exist"}
    wanted = {}
    for i in ids or []:
        path = _picture_path(i)
        h = _dhash(path) if path else None
        if h:
            wanted[str(i)] = h
    files = []
    for base, dirs, names in os.walk(folder):
        dirs[:] = [d for d in dirs if not d.startswith(".") and d.lower() != "_deleted"]
        for n in names:
            if n.lower().endswith(RELINK_EXTS):
                files.append(os.path.join(base, n))
        if len(files) >= RELINK_CAP:
            break
    found = {}
    for path in files[:RELINK_CAP]:
        h = _dhash(path)
        if not h:
            continue
        bits, w, hh = h
        for i, (obits, ow, oh) in wanted.items():
            if w <= ow:                       # not larger: not an upscale of it
                continue
            if abs((w / hh) / (ow / oh) - 1) > SHAPE_NEAR:
                continue
            d = bin(bits ^ obits).count("1")
            if d > HASH_NEAR:
                continue
            best = found.get(i)
            if best is None or (d, -w) < (best["dist"], -best["w"]):
                found[i] = {"path": path, "w": w, "h": hh, "dist": d, "name": os.path.basename(path)}
    _remember_linked(f["path"] for f in found.values())
    return {"ok": True, "found": found, "looked": len(files), "folder": folder}


def _linked_file(path):
    path = os.path.normpath(str(path or ""))
    if path in _linked_paths() and os.path.isfile(path):
        return path
    return None


def _linked_preview(path, side):
    path = _linked_file(path)
    if not path:
        return None
    try:
        side = int(side)
    except (TypeError, ValueError):
        side = 0
    if side <= 0:
        return ("file", path)
    key = (path, os.path.getmtime(path), side)
    with _previews_lock:
        hit = _previews.get(key)
    if hit:
        return ("jpeg", hit)
    with Image.open(path) as im:
        im.draft("RGB", (side, side))
        im = im.convert("RGB")
        im.thumbnail((side, side), Image.LANCZOS)
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=90)
    data = buf.getvalue()
    with _previews_lock:
        _previews[key] = data
        _previews_order.append(key)
        while len(_previews_order) > PREVIEW_KEEP:
            _previews.pop(_previews_order.pop(0), None)
    return ("jpeg", data)


# ------------------------------------------------------------- idml
# An InDesign document of the layout, written beside the package: every
# spread as a spread of two pages, every picture a frame linked to the
# package's Links, every block of words a text frame with paragraph styles -
# Number, Title, Caption, Body, Foot - so a change to a style changes every
# page. The browser lays the pages out and says where everything is; this
# only writes it down in the form InDesign reads.
IDML_DOM = "16.0"
_IDML_NS = 'xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging"'


def _x(s):
    return (str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            .replace('"', "&quot;"))


def _pt(mm):
    return float(mm) * 72.0 / 25.4


def _hexrgb(h):
    h = str(h or "#000000").lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    try:
        return [int(h[i:i + 2], 16) for i in (0, 2, 4)]
    except ValueError:
        return [0, 0, 0]


def _path_geometry(x0, y0, x1, y1):
    pts = [(x0, y0), (x0, y1), (x1, y1), (x1, y0)]
    anchors = "".join(
        '<PathPointType Anchor="%.3f %.3f" LeftDirection="%.3f %.3f" RightDirection="%.3f %.3f"/>'
        % (x, y, x, y, x, y) for x, y in pts)
    return ('<Properties><PathGeometry><GeometryPathType PathOpen="false"><PathPointArray>%s'
            '</PathPointArray></GeometryPathType></PathGeometry></Properties>' % anchors)


def _native_size(path):
    """A linked picture's size in points, as InDesign places it: its pixels
    at the resolution written in the file, or 72 ppi when none is."""
    with Image.open(path) as im:
        w, h = im.size
        dpi = im.info.get("dpi") or (72, 72)
    try:
        dx, dy = float(dpi[0]) or 72.0, float(dpi[1]) or 72.0
    except Exception:
        dx = dy = 72.0
    return w * 72.0 / dx, h * 72.0 / dy


def _idml_body(folder, series, model, link_paths):
    """Write <series>.idml into the package folder. model: page size, colours
    and, for every spread, its items in millimetres from the spread's top
    left. link_paths: pick id -> the picture's path in Links."""
    import zipfile
    from pathlib import Path

    pw_mm, ph_mm = float(model["page"][0]), float(model["page"][1])
    W, H = _pt(pw_mm), _pt(ph_mm)
    spreads = model.get("spreads") or []
    colours = {}                        # hex -> swatch id

    def colour(h):
        h = str(h or "#000000").lower()
        if h not in colours:
            colours[h] = "Color/vly%d" % (len(colours) + 1)
        return colours[h]

    # spread coordinates: the spine at x 0, the middle of the page height at y 0
    def sx(mm):
        return _pt(mm) - W

    def sy(mm):
        return _pt(mm) - H / 2

    styles = {}                          # role -> properties of its first use
    stories = []
    spread_xml = []
    uid = [0]

    def nid(p):
        uid[0] += 1
        return "%s%d" % (p, uid[0])

    for si, sp in enumerate(spreads):
        items = []
        paper = model.get("paper")
        if paper and str(paper).lower() not in ("#ffffff", "#fff"):
            for px in (0, pw_mm):
                items.append('<Rectangle Self="%s" ContentType="Unassigned" StrokeWeight="0" FillColor="%s" '
                             'ItemLayer="ul" Locked="true" ItemTransform="1 0 0 1 0 0">%s</Rectangle>'
                             % (nid("pp"), colour(paper), _path_geometry(sx(px), sy(0), sx(px + pw_mm), sy(ph_mm))))
        for it in sp.get("items") or []:
            x0, y0 = sx(it["x"]), sy(it["y"])
            x1, y1 = sx(it["x"] + it["w"]), sy(it["y"] + it["h"])
            if it.get("k") == "img":
                link = link_paths.get(str(it.get("id")))
                if not link or not os.path.isfile(link):
                    items.append('<Rectangle Self="%s" ContentType="GraphicType" StrokeWeight="0" ItemLayer="ul" '
                                 'ItemTransform="1 0 0 1 0 0">%s</Rectangle>' % (nid("r"), _path_geometry(x0, y0, x1, y1)))
                    continue
                nw, nh = _native_size(link)
                bw, bh = x1 - x0, y1 - y0
                s = max(bw / nw, bh / nh) if it.get("fit") == "cover" else min(bw / nw, bh / nh)
                dw, dh = nw * s, nh * s
                ix, iy = x0 + (bw - dw) / 2, y0 + (bh - dh) / 2
                if it.get("fit") == "cover":
                    # where the picture was moved to in its frame on the page
                    fx = max(-1.0, min(1.0, float(it.get("fx") or 0)))
                    fy = max(-1.0, min(1.0, float(it.get("fy") or 0)))
                    ix = x0 + (bw - dw) / 2 * (1 - fx)
                    iy = y0 + (bh - dh) / 2 * (1 - fy)
                ext = os.path.splitext(link)[1].lower().lstrip(".")
                fmt = {"png": "$ID/Portable Network Graphics (PNG)", "jpg": "$ID/JPEG", "jpeg": "$ID/JPEG",
                       "tif": "$ID/TIFF", "tiff": "$ID/TIFF"}.get(ext, "$ID/" + ext.upper())
                items.append(
                    '<Rectangle Self="%s" ContentType="GraphicType" StrokeWeight="0" ItemLayer="ul" '
                    'ItemTransform="1 0 0 1 0 0">%s'
                    '<Image Self="%s" ItemTransform="%.6f 0 0 %.6f %.3f %.3f">'
                    '<Properties><Profile type="string">$ID/None</Profile>'
                    '<GraphicBounds Left="0" Top="0" Right="%.3f" Bottom="%.3f"/></Properties>'
                    '<Link Self="%s" LinkResourceURI="%s" LinkResourceFormat="%s" StoredState="Normal" '
                    'LinkClassID="35906" LinkClientID="257"/></Image></Rectangle>'
                    % (nid("r"), _path_geometry(x0, y0, x1, y1), nid("im"), s, s, ix, iy, nw, nh,
                       nid("ln"), _x(Path(link).resolve().as_uri()), _x(fmt)))
            elif it.get("k") == "text":
                st = nid("st")
                ranges = []
                paras = it.get("paras") or []
                for pi, p in enumerate(paras):
                    role = p.get("role") or "Body"
                    styles.setdefault(role, p)
                    attrs = 'AppliedParagraphStyle="ParagraphStyle/%s" Justification="%s"' % (
                        _x(role), "RightAlign" if p.get("align") == "right" else "LeftAlign")
                    if p.get("indent"):
                        attrs += ' %s="%.3f"' % ("LeftIndent" if p.get("align") == "right" else "RightIndent",
                                                 max(0.0, _pt(p["indent"])))
                    if p.get("before") is not None:
                        attrs += ' SpaceBefore="%.3f"' % max(0.0, _pt(p["before"]))
                    if p.get("rule"):
                        r = p["rule"]
                        attrs += (' RuleBelow="true" RuleBelowColor="%s" RuleBelowWeight="%.3f" RuleBelowOffset="%.3f"'
                                  ' RuleBelowWidth="ColumnWidth" RuleBelowLeftIndent="%.3f" RuleBelowRightIndent="%.3f"'
                                  % (colour(r["color"]), _pt(r["weight"]), _pt(r["offset"]),
                                     _pt(r["left"]), _pt(r["right"])))
                    if p.get("rule_above"):
                        r = p["rule_above"]
                        attrs += (' RuleAbove="true" RuleAboveColor="%s" RuleAboveWeight="%.3f" RuleAboveOffset="%.3f"'
                                  ' RuleAboveWidth="ColumnWidth" RuleAboveLeftIndent="%.3f" RuleAboveRightIndent="%.3f"'
                                  % (colour(r["color"]), _pt(r["weight"]), _pt(r["offset"]),
                                     _pt(r["left"]), _pt(r["right"])))
                    if p.get("tab") is not None:
                        attrs_tab = ('<Properties><TabList type="list"><ListItem type="record">'
                                     '<Alignment type="enumeration">LeftAlign</Alignment>'
                                     '<AlignmentCharacter type="string">.</AlignmentCharacter>'
                                     '<Leader type="string"></Leader>'
                                     '<Position type="unit">%.3f</Position></ListItem></TabList></Properties>'
                                     % _pt(p["tab"]))
                    else:
                        attrs_tab = ""
                    text = str(p.get("text") or "")
                    # a line break inside a paragraph stays one, a tab stays a tab
                    lines = text.split("\n")
                    body = ""
                    for j, part in enumerate(lines):
                        if part:
                            body += "<Content>%s</Content>" % _x(part)
                        if j < len(lines) - 1:
                            body += "<Br/>"
                    if pi < len(paras) - 1:
                        body += "<Br/>"
                    lead_in = ""
                    if p.get("lead_in"):
                        li = p["lead_in"]
                        lead_in = ('<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]" '
                                   'FillColor="%s" FontStyle="%s" PointSize="%.3f" Tracking="%d"><Properties>'
                                   '<AppliedFont type="string">%s</AppliedFont></Properties><Content>%s</Content>'
                                   '</CharacterStyleRange>' % (colour(li.get("color")), _x(li.get("face") or "Regular"),
                                                               float(li.get("size") or 7), int(li.get("track") or 0),
                                                               _x(li.get("font") or "Inter"), _x(li.get("text") or "")))
                    ranges.append(
                        '<ParagraphStyleRange %s>%s%s<CharacterStyleRange AppliedCharacterStyle='
                        '"CharacterStyle/$ID/[No character style]" FillColor="%s">%s</CharacterStyleRange>'
                        '</ParagraphStyleRange>' % (attrs, attrs_tab, lead_in, colour(p.get("color")), body))
                stories.append((st, ranges))
                first = _pt(it.get("first") or 0)
                items.append(
                    '<TextFrame Self="%s" ParentStory="%s" PreviousTextFrame="n" NextTextFrame="n" '
                    'ContentType="TextType" ItemLayer="ul" ItemTransform="1 0 0 1 0 0">%s'
                    '<TextFramePreference TextColumnCount="1" FirstBaselineOffset="FixedHeight" '
                    'MinimumFirstBaselineOffset="%.3f" VerticalJustification="TopAlign" '
                    'IgnoreWrap="false" AutoSizingType="Off"/></TextFrame>'
                    % (nid("tf"), st, _path_geometry(x0, y0, x1, y1), first))
        pages = []
        for side in (0, 1):
            num = si * 2 + side + 2
            pages.append(
                '<Page Self="pg%d" Name="%d" AppliedMaster="um" OverrideList="" '
                'GeometricBounds="0 0 %.3f %.3f" ItemTransform="1 0 0 1 %.3f %.3f">'
                '<Properties><PageColor type="enumeration">UseMasterColor</PageColor></Properties>'
                '<MarginPreference ColumnCount="1" ColumnGutter="12" Top="%.3f" Bottom="%.3f" Left="%.3f" Right="%.3f" '
                'ColumnDirection="Horizontal" ColumnsPositions="0 %.3f"/></Page>'
                % (num, num, H, W, -W if side == 0 else 0, -H / 2,
                   _pt(model["margins"]["top"]), _pt(model["margins"]["bottom"]),
                   _pt(model["margins"]["outer"] if side == 0 else model["margins"]["inner"]),
                   _pt(model["margins"]["inner"] if side == 0 else model["margins"]["outer"]),
                   W - _pt(model["margins"]["outer"]) - _pt(model["margins"]["inner"])))
        spread_xml.append((
            "s%d" % (si + 1),
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            '<idPkg:Spread %s DOMVersion="%s"><Spread Self="s%d" PageCount="2" BindingLocation="1" '
            'AllowPageShuffle="false" ShowMasterItems="true" PageTransitionType="None" ItemTransform="1 0 0 1 0 0">'
            '%s%s</Spread></idPkg:Spread>' % (_IDML_NS, IDML_DOM, si + 1, "".join(pages), "".join(items))))

    # paragraph styles, as first used
    def style_xml(role, p):
        fam, fst = str(p.get("font") or "Minion Pro"), str(p.get("face") or "Regular")
        return ('<ParagraphStyle Self="ParagraphStyle/%s" Name="%s" FontStyle="%s" PointSize="%.3f" '
                'Tracking="%d" FillColor="%s" Hyphenation="false">'
                '<Properties><BasedOn type="string">$ID/[No paragraph style]</BasedOn>'
                '<AppliedFont type="string">%s</AppliedFont>'
                '<Leading type="unit">%.3f</Leading></Properties></ParagraphStyle>'
                % (_x(role), _x(role), _x(fst), float(p.get("size") or 9), int(p.get("track") or 0),
                   colour(p.get("color")), _x(fam), float(p.get("lead") or 11)))

    # the fonts each style uses go on every range too, so a style edited
    # later still starts from the face the layout used
    style_list = "".join(style_xml(r, p) for r, p in styles.items())
    swatches = "".join(
        '<Color Self="%s" Model="Process" Space="RGB" ColorValue="%d %d %d" ColorOverride="Normal" '
        'AlternateSpace="NoAlternateColor" AlternateColorValue="" Name="%s" ColorEditable="true" '
        'ColorRemovable="true" Visible="true" SwatchCreatorID="7937"/>'
        % (cid, *_hexrgb(h), "Layout " + h.upper()) for h, cid in colours.items())

    graphic = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
               '<idPkg:Graphic %s DOMVersion="%s">'
               '<Color Self="Color/Black" Model="Process" Space="CMYK" ColorValue="0 0 0 100" ColorOverride="Specialblack" '
               'AlternateSpace="NoAlternateColor" AlternateColorValue="" Name="Black" ColorEditable="false" '
               'ColorRemovable="false" Visible="true" SwatchCreatorID="7937"/>'
               '<Color Self="Color/Paper" Model="Process" Space="CMYK" ColorValue="0 0 0 0" ColorOverride="Specialpaper" '
               'AlternateSpace="NoAlternateColor" AlternateColorValue="" Name="Paper" ColorEditable="true" '
               'ColorRemovable="false" Visible="true" SwatchCreatorID="7937"/>'
               '<Color Self="Color/Registration" Model="Registration" Space="CMYK" ColorValue="100 100 100 100" '
               'ColorOverride="Specialregistration" AlternateSpace="NoAlternateColor" AlternateColorValue="" '
               'Name="Registration" ColorEditable="false" ColorRemovable="false" Visible="true" SwatchCreatorID="7937"/>'
               '%s<Swatch Self="Swatch/None" Name="None" ColorEditable="false" ColorRemovable="false" Visible="true" '
               'SwatchCreatorID="7937"/></idPkg:Graphic>' % (_IDML_NS, IDML_DOM, swatches))
    styles_doc = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
                  '<idPkg:Styles %s DOMVersion="%s">'
                  '<RootCharacterStyleGroup Self="u79"><CharacterStyle Self="CharacterStyle/$ID/[No character style]" '
                  'Imported="false" Name="$ID/[No character style]"/></RootCharacterStyleGroup>'
                  '<RootParagraphStyleGroup Self="u78">'
                  '<ParagraphStyle Self="ParagraphStyle/$ID/[No paragraph style]" Name="$ID/[No paragraph style]" '
                  'Imported="false" FillColor="Color/Black" FontStyle="Regular" PointSize="12" Hyphenation="false">'
                  '<Properties><AppliedFont type="string">Minion Pro</AppliedFont>'
                  '<Leading type="enumeration">Auto</Leading></Properties></ParagraphStyle>'
                  '<ParagraphStyle Self="ParagraphStyle/$ID/NormalParagraphStyle" Name="$ID/NormalParagraphStyle" '
                  'Imported="false"><Properties><BasedOn type="string">$ID/[No paragraph style]</BasedOn></Properties>'
                  '</ParagraphStyle>%s</RootParagraphStyleGroup>'
                  '<RootObjectStyleGroup Self="u8d"><ObjectStyle Self="ObjectStyle/$ID/[None]" Name="$ID/[None]"/>'
                  '<ObjectStyle Self="ObjectStyle/$ID/[Normal Graphics Frame]" Name="$ID/[Normal Graphics Frame]"/>'
                  '<ObjectStyle Self="ObjectStyle/$ID/[Normal Text Frame]" Name="$ID/[Normal Text Frame]"/>'
                  '</RootObjectStyleGroup></idPkg:Styles>' % (_IDML_NS, IDML_DOM, style_list))
    m = model["margins"]
    prefs = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
             '<idPkg:Preferences %s DOMVersion="%s">'
             '<DocumentPreference PageHeight="%.3f" PageWidth="%.3f" FacingPages="true" '
             'DocumentBleedTopOffset="8.504" DocumentBleedBottomOffset="8.504" DocumentBleedInsideOrLeftOffset="8.504" '
             'DocumentBleedOutsideOrRightOffset="8.504" DocumentBleedUniformSize="true" AllowPageShuffle="false" '
             'PageBinding="LeftToRight" StartPageNumber="2"/>'
             '<MarginPreference ColumnCount="1" ColumnGutter="12" Top="%.3f" Bottom="%.3f" Left="%.3f" Right="%.3f"/>'
             '<ViewPreference HorizontalMeasurementUnits="Millimeters" VerticalMeasurementUnits="Millimeters" '
             'TypographicMeasurementUnits="Points" TextSizeMeasurementUnits="Points"/>'
             '</idPkg:Preferences>'
             % (_IDML_NS, IDML_DOM, H, W, _pt(m["top"]), _pt(m["bottom"]), _pt(m["inner"]), _pt(m["outer"])))
    master = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
              '<idPkg:MasterSpread %s DOMVersion="%s"><MasterSpread Self="um" Name="A-Master" NamePrefix="A" '
              'BaseName="Master" ShowMasterItems="true" PageCount="2" OverriddenPageItemProps="" PrimaryTextFrame="n" '
              'ItemTransform="1 0 0 1 0 0">'
              '<Page Self="mp1" Name="A" AppliedMaster="n" GeometricBounds="0 0 %.3f %.3f" ItemTransform="1 0 0 1 %.3f %.3f"/>'
              '<Page Self="mp2" Name="A" AppliedMaster="n" GeometricBounds="0 0 %.3f %.3f" ItemTransform="1 0 0 1 0 %.3f"/>'
              '</MasterSpread></idPkg:MasterSpread>' % (_IDML_NS, IDML_DOM, H, W, -W, -H / 2, H, W, -H / 2))
    tags = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            '<idPkg:Tags %s DOMVersion="%s"><XMLTag Self="XMLTag/Root" Name="Root"><Properties>'
            '<TagColor type="enumeration">LightBlue</TagColor></Properties></XMLTag></idPkg:Tags>' % (_IDML_NS, IDML_DOM))
    backing = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
               '<idPkg:BackingStory %s DOMVersion="%s"><XmlStory Self="ubs" AppliedTOCStyle="n" TrackChanges="false" '
               'StoryTitle="$ID/" AppliedNamedGrid="n"><ParagraphStyleRange AppliedParagraphStyle='
               '"ParagraphStyle/$ID/NormalParagraphStyle"><CharacterStyleRange AppliedCharacterStyle='
               '"CharacterStyle/$ID/[No character style]"/></ParagraphStyleRange></XmlStory></idPkg:BackingStory>'
               % (_IDML_NS, IDML_DOM))
    fonts = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
             '<idPkg:Fonts %s DOMVersion="%s"/>' % (_IDML_NS, IDML_DOM))

    def story_xml(sid, ranges):
        return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
                '<idPkg:Story %s DOMVersion="%s"><Story Self="%s" AppliedTOCStyle="n" TrackChanges="false" '
                'StoryTitle="$ID/" AppliedNamedGrid="n"><StoryPreference OpticalMarginAlignment="false" '
                'OpticalMarginSize="12" FrameType="TextFrameType" StoryOrientation="Horizontal" '
                'StoryDirection="LeftToRightDirection"/>%s</Story></idPkg:Story>'
                % (_IDML_NS, IDML_DOM, sid, "".join(ranges)))

    design = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
              '<?aid style="50" type="document" readerVersion="6.0" featureSet="257" product="16.0(1)" ?>\n'
              '<Document %s DOMVersion="%s" Self="d" StoryList="%s" Name="%s.indd" ZeroPoint="0 0" '
              'ActiveLayer="ul" CMYKProfile="Coated FOGRA39 (ISO 12647-2:2004)" RGBProfile="sRGB IEC61966-2.1" '
              'SolidColorIntent="UseColorSettings" AfterBlendingIntent="UseColorSettings" '
              'DefaultImageIntent="UseColorSettings" RGBPolicy="PreserveEmbeddedProfiles" '
              'CMYKPolicy="CombinationOfPreserveAndSafeCmyk" AccurateLABSpots="false">'
              '<idPkg:Graphic src="Resources/Graphic.xml"/><idPkg:Fonts src="Resources/Fonts.xml"/>'
              '<idPkg:Styles src="Resources/Styles.xml"/><idPkg:Preferences src="Resources/Preferences.xml"/>'
              '<idPkg:Tags src="XML/Tags.xml"/>'
              '<Layer Self="ul" Name="Layout" Visible="true" Locked="false" IgnoreWrap="false" ShowGuides="true" '
              'LockGuides="false" UI="true" Expendable="true" Printable="true"><Properties>'
              '<LayerColor type="enumeration">LightBlue</LayerColor></Properties></Layer>'
              '<idPkg:MasterSpread src="MasterSpreads/MasterSpread_um.xml"/>%s'
              '<Section Self="sec1" Length="%d" Name="" ContinueNumbering="false" IncludeSectionPrefix="false" '
              'PageNumberStyle="Arabic" PageStart="pg2" SectionPrefix="" Marker="" PageNumberStart="2"/>'
              '<idPkg:BackingStory src="XML/BackingStory.xml"/>%s'
              '<XMLElement Self="di2" MarkupTag="XMLTag/Root"/></Document>'
              % (_IDML_NS, IDML_DOM, " ".join(s for s, _r in stories), _x(_safe(series)),
                 "".join('<idPkg:Spread src="Spreads/Spread_%s.xml"/>' % s for s, _x2 in spread_xml),
                 len(spreads) * 2,
                 "".join('<idPkg:Story src="Stories/Story_%s.xml"/>' % s for s, _r in stories)))
    container = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
                 '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
                 '<rootfiles><rootfile full-path="designmap.xml" media-type="text/xml"/></rootfiles></container>')

    path = os.path.join(folder, "%s.idml" % _safe(series))
    with zipfile.ZipFile(path, "w") as z:
        z.writestr(zipfile.ZipInfo("mimetype"), "application/vnd.adobe.indesign-idml-package",
                   compress_type=zipfile.ZIP_STORED)
        def put(name, text):
            z.writestr(name, text.encode("utf-8"), compress_type=zipfile.ZIP_DEFLATED)
        put("designmap.xml", design)
        put("META-INF/container.xml", container)
        put("Resources/Graphic.xml", graphic)
        put("Resources/Fonts.xml", fonts)
        put("Resources/Styles.xml", styles_doc)
        put("Resources/Preferences.xml", prefs)
        put("MasterSpreads/MasterSpread_um.xml", master)
        for s, xml in spread_xml:
            put("Spreads/Spread_%s.xml" % s, xml)
        for s, ranges in stories:
            put("Stories/Story_%s.xml" % s, story_xml(s, ranges))
        put("XML/Tags.xml", tags)
        put("XML/BackingStory.xml", backing)
    return path


# ------------------------------------------------------------- motion
# The music a motion is set to is kept beside the layouts, so a workflow
# finds it again; the film itself is recorded in the browser and arrives in
# parts, written down here under a name that never replaces an earlier one.
MUSIC_EXTS = {".mp3", ".wav", ".m4a", ".aac", ".ogg", ".oga", ".flac", ".opus", ".webm"}
VIDEO_EXTS = {"mp4", "webm"}
MOTION_DIRNAME = "motion"


def _music_dir():
    path = os.path.join(_report()._viewer()._user_dir(), "visual_series_layout", "music")
    os.makedirs(path, exist_ok=True)
    return path


def _music_save(name, blob):
    base, ext = os.path.splitext(os.path.basename(str(name or "")))
    ext = ext.lower()
    if ext not in MUSIC_EXTS:
        return {"ok": False, "error": "not a sound file this can play: %s" % (ext or "no extension")}
    if not blob:
        return {"ok": False, "error": "the file arrived empty"}
    stem = _safe(base) or "music"
    path = os.path.join(_music_dir(), stem + ext)
    if os.path.exists(path):
        with open(path, "rb") as fh:
            same = fh.read() == blob
        if not same:
            stem = _numbered(stem, lambda st: os.path.exists(os.path.join(_music_dir(), st + ext)))
            path = os.path.join(_music_dir(), stem + ext)
    with open(path, "wb") as fh:
        fh.write(blob)
    return {"ok": True, "name": stem + ext}


def _music_list():
    """Every piece of music used before, in the order it was first added."""
    out = []
    folder = _music_dir()
    for n in os.listdir(folder):
        p = os.path.join(folder, n)
        if os.path.splitext(n)[1].lower() in MUSIC_EXTS and os.path.isfile(p):
            st = os.stat(p)
            out.append({"name": n, "bytes": st.st_size, "added": getattr(st, "st_ctime", st.st_mtime)})
    out.sort(key=lambda m: (m["added"], m["name"].lower()))
    return {"ok": True, "list": out}


def _music_forget(name):
    path = _music_path(name)
    if not path:
        return {"ok": False, "error": "that music is not in the list"}
    try:
        os.remove(path)
    except OSError as exc:
        return {"ok": False, "error": str(exc)}
    return {"ok": True}


def _music_path(name):
    name = os.path.basename(str(name or ""))
    path = os.path.join(_music_dir(), name)
    if os.path.splitext(name)[1].lower() in MUSIC_EXTS and os.path.isfile(path):
        return path
    return None


LOGO_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".svg"}


def _logo_dir():
    path = os.path.join(_report()._viewer()._user_dir(), "visual_series_layout", "logos")
    os.makedirs(path, exist_ok=True)
    return path


def _logo_save(name, blob):
    base, ext = os.path.splitext(os.path.basename(str(name or "")))
    ext = ext.lower()
    if ext not in LOGO_EXTS:
        return {"ok": False, "error": "a logo is a PNG, SVG, JPEG or WebP - not %s" % (ext or "a file without an extension")}
    if not blob:
        return {"ok": False, "error": "the file arrived empty"}
    stem = _safe(base) or "logo"
    path = os.path.join(_logo_dir(), stem + ext)
    if os.path.exists(path):
        with open(path, "rb") as fh:
            same = fh.read() == blob
        if not same:
            stem = _numbered(stem, lambda st: os.path.exists(os.path.join(_logo_dir(), st + ext)))
            path = os.path.join(_logo_dir(), stem + ext)
    with open(path, "wb") as fh:
        fh.write(blob)
    return {"ok": True, "name": stem + ext}


def _logo_path(name):
    name = os.path.basename(str(name or ""))
    path = os.path.join(_logo_dir(), name)
    if os.path.splitext(name)[1].lower() in LOGO_EXTS and os.path.isfile(path):
        return path
    return None


def _post_save(data):
    """The words of a post, as a text file beside the export: in the folder
    chosen, or in output/<series>/layout/motion/ for a film and
    output/<series>/layout/ for frames."""
    series = str(data.get("series") or "")
    text = str(data.get("text") or "").strip()
    if not text:
        return {"ok": False, "error": "the post is empty"}
    where = str(data.get("folder") or "").strip().strip('"')
    if where:
        where = os.path.normpath(os.path.expanduser(where))
        if not os.path.isdir(where):
            return {"ok": False, "error": "that folder does not exist: %s" % where}
    else:
        where = os.path.join(_output_dir(), _safe(series), LAYOUT_DIRNAME)
        if data.get("kind") == "motion":
            where = os.path.join(where, MOTION_DIRNAME)
        os.makedirs(where, exist_ok=True)
    base = "%s - post" % (_safe(data.get("name") or series) or "series")
    stem = _numbered(base, lambda st: os.path.exists(os.path.join(where, st + ".txt")))
    path = os.path.join(where, stem + ".txt")
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text + "\n")
    return {"ok": True, "path": path}


def _layout_save(data):
    """The layout as it stands, as a .layout file - to open again on this
    node or another, whatever happens to the workflow. Every save is a file
    of its own, named for when it was saved."""
    series = str(data.get("series") or "")
    if not series:
        return {"ok": False, "error": "no series to save"}
    where = os.path.join(_output_dir(), _safe(series), LAYOUT_DIRNAME, "saved")
    os.makedirs(where, exist_ok=True)
    base = "%s - %s" % (_safe(series), time.strftime("%Y-%m-%d %H%M"))
    stem = _numbered(base, lambda st: os.path.exists(os.path.join(where, st + ".layout")))
    doc = dict(data.get("layout") or {})
    doc.update(format="visual-series-layout", version=1, series=series, saved=True,
               written=time.strftime("%Y-%m-%dT%H:%M:%S"))
    path = os.path.join(where, stem + ".layout")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, ensure_ascii=False, indent=2)
    return {"ok": True, "path": path, "folder": where}


def _video_dir(token):
    token = re.sub(r"[^A-Za-z0-9_-]", "", str(token or ""))[:40] or "job"
    path = os.path.join(_report()._viewer()._user_dir(), "visual_series_layout", "video", token)
    os.makedirs(path, exist_ok=True)
    return path


def _video_part(token, index, blob):
    try:
        index = int(index)
    except (TypeError, ValueError):
        return {"ok": False, "error": "bad part number"}
    with open(os.path.join(_video_dir(token), "%05d.part" % index), "wb") as fh:
        fh.write(blob or b"")
    return {"ok": True}


def _video_done(data):
    import shutil
    work = _video_dir(data.get("token"))
    try:
        if data.get("cancel"):
            return {"ok": True, "cancelled": True}
        series = str(data.get("series") or "")
        where = str(data.get("folder") or "").strip().strip('"')
        if where:
            where = os.path.normpath(os.path.expanduser(where))
            if not os.path.isdir(where):
                return {"ok": False, "error": "that folder does not exist: %s" % where}
        else:
            where = os.path.join(_output_dir(), _safe(series), LAYOUT_DIRNAME, MOTION_DIRNAME)
            os.makedirs(where, exist_ok=True)
        ext = str(data.get("ext") or "mp4").lower()
        ext = ext if ext in VIDEO_EXTS else "mp4"
        base = _safe(data.get("name") or series) or "motion"
        size = _safe(data.get("size") or "")
        stem = "%s - %s" % (base, size) if size else base
        stem = _numbered(stem, lambda st: any(os.path.exists(os.path.join(where, st + "." + e)) for e in VIDEO_EXTS))
        path = os.path.join(where, stem + "." + ext)
        parts = sorted(n for n in os.listdir(work) if n.endswith(".part"))
        if not parts:
            return {"ok": False, "error": "no part of the film arrived"}
        with open(path, "wb") as out:
            for n in parts:
                with open(os.path.join(work, n), "rb") as fh:
                    shutil.copyfileobj(fh, out)
        return {"ok": True, "path": path, "folder": where, "bytes": os.path.getsize(path)}
    finally:
        shutil.rmtree(work, ignore_errors=True)


# ------------------------------------------------------------- routes
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

    @_routes.get("/leiel_layout/series")
    async def _layout_series(request):
        return _web.json_response(await _run(_series_body))

    @_routes.post("/leiel_layout/book")
    async def _layout_book(request):
        data = await _json(request)
        return _web.json_response(await _run(_book_body, data.get("series")))

    @_routes.get("/leiel_layout/picture")
    async def _layout_picture(request):
        q = request.rel_url.query
        hit = await _run(_preview_body, q.get("id"), q.get("s"))
        if not hit:
            return _web.Response(status=404)
        kind, body = hit
        if kind == "file":
            return _web.FileResponse(body)
        return _web.Response(body=body, content_type="image/jpeg",
                             headers={"Cache-Control": "max-age=3600"})

    @_routes.post("/leiel_layout/relink")
    async def _layout_relink(request):
        data = await _json(request)
        return _web.json_response(await _run(_relink_body, data.get("folder"), data.get("ids")))

    @_routes.get("/leiel_layout/linked")
    async def _layout_linked(request):
        q = request.rel_url.query
        hit = await _run(_linked_preview, q.get("path"), q.get("s"))
        if not hit:
            return _web.Response(status=404)
        kind, body = hit
        if kind == "file":
            return _web.FileResponse(body)
        return _web.Response(body=body, content_type="image/jpeg",
                             headers={"Cache-Control": "max-age=3600"})

    @_routes.post("/leiel_layout/package")
    async def _layout_package(request):
        data = await _json(request)
        return _web.json_response(await _run(_package_body, data))

    @_routes.post("/leiel_layout/save")
    async def _layout_save(request):
        data = await _json(request)
        return _web.json_response(await _run(_save_body, data.get("series"), data.get("index"),
                                             data.get("total"), data.get("data"), data.get("ext"),
                                             data.get("format"), data.get("kind"), data.get("folder"),
                                             data.get("name"), data.get("stem")))

    @_routes.post("/leiel_layout/pdf_page")
    async def _layout_pdf_page(request):
        data = await _json(request)
        return _web.json_response(await _run(_pdf_page_body, data.get("token"), data.get("index"), data.get("data")))

    @_routes.post("/leiel_layout/pdf_done")
    async def _layout_pdf_done(request):
        data = await _json(request)
        return _web.json_response(await _run(_pdf_done_body, data.get("token"), data.get("series"),
                                             data.get("format"), data.get("folder"), data.get("name"),
                                             data.get("page") or [230, 300]))
    @_routes.post("/leiel_layout/music")
    async def _layout_music_up(request):
        blob = await request.read()
        return _web.json_response(await _run(_music_save, request.rel_url.query.get("name"), blob))

    @_routes.get("/leiel_layout/music_list")
    async def _layout_music_list(request):
        return _web.json_response(await _run(_music_list))

    @_routes.post("/leiel_layout/music_forget")
    async def _layout_music_forget(request):
        data = await _json(request)
        return _web.json_response(await _run(_music_forget, data.get("name")))

    @_routes.get("/leiel_layout/music")
    async def _layout_music(request):
        path = await _run(_music_path, request.rel_url.query.get("name"))
        if not path:
            return _web.Response(status=404)
        return _web.FileResponse(path)

    @_routes.post("/leiel_layout/logo")
    async def _layout_logo_up(request):
        blob = await request.read()
        return _web.json_response(await _run(_logo_save, request.rel_url.query.get("name"), blob))

    @_routes.get("/leiel_layout/logo")
    async def _layout_logo(request):
        path = await _run(_logo_path, request.rel_url.query.get("name"))
        if not path:
            return _web.Response(status=404)
        return _web.FileResponse(path, headers={"Cache-Control": "max-age=3600"})

    @_routes.post("/leiel_layout/post")
    async def _layout_post(request):
        data = await _json(request)
        return _web.json_response(await _run(_post_save, data))

    @_routes.post("/leiel_layout/save_layout")
    async def _layout_save_layout(request):
        data = await _json(request)
        return _web.json_response(await _run(_layout_save, data))

    @_routes.post("/leiel_layout/video_part")
    async def _layout_video_part(request):
        q = request.rel_url.query
        blob = await request.read()
        return _web.json_response(await _run(_video_part, q.get("token"), q.get("index"), blob))

    @_routes.post("/leiel_layout/video_done")
    async def _layout_video_done(request):
        data = await _json(request)
        return _web.json_response(await _run(_video_done, data))
except Exception:                                    # pragma: no cover
    pass


class LeielSeriesLayout:
    """The spreads of a series. It takes nothing and returns nothing, and is
    never run: the pages are drawn in the browser and saved from there."""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {}}

    RETURN_TYPES = ()
    FUNCTION = "noop"
    CATEGORY = "Studio Leiel"
    DESCRIPTION = (
        "A series laid out for print or the web: the cuts picked in the Visual "
        "Image Viewer, with the numbers, titles, captions and notes of the "
        "Series Book, in the order of the book - as magazine spreads or as "
        "frames for a feed. Exports spreads at 300 dpi and frames at their size."
    )

    def noop(self):
        return ()


NODE_CLASS_MAPPINGS = {
    "LeielSeriesLayout": LeielSeriesLayout,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "LeielSeriesLayout": "Visual Series Layout (Studio Leiel)",
}
