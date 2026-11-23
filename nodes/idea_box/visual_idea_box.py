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
Studio Leiel - Visual Idea Box
--------------------------------------------------
A box for the things seen on the way: a picture from the web, a screenshot
of a film, a line of dialogue, a thought written straight into the node.
Keeping one takes a second - drop it on the node, paste it, write it, or let
a screenshot land in the inbox folder - and nothing is asked at that moment.
The new ones wait at the top of the node until there is a minute to give
each a line, a note and a folder.

Everything lives in user/visual_idea_box/:
    ideas.json   the folders and every idea, in the order they came
    files/       the pictures, one file per idea
    inbox/       a folder anything can be saved into; read on every look
    trash/       pictures of ideas that were deleted, kept just in case

Nothing here makes a picture. The node is never run.
"""

import html as _html
import io
import json
import os
import re
import shutil
import threading
import time
import uuid
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen

from PIL import Image

DIRNAME = "visual_idea_box"
DEFAULT_FOLDERS = ["Light", "Place", "Outfit", "Pose", "Colour", "Story", "Object"]
PICTURE_EXT = (".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".avif")
_MIME = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
         ".gif": "image/gif", ".bmp": "image/bmp", ".avif": "image/avif",
         ".mp4": "video/mp4", ".m4v": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
         ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".ogg": "audio/ogg",
         ".flac": "audio/flac", ".pdf": "application/pdf"}
TEXT_EXT = (".txt", ".md")
VIDEO_EXT = (".mp4", ".webm", ".mov", ".m4v")
AUDIO_EXT = (".mp3", ".wav", ".m4a", ".ogg", ".flac")
MEDIA_EXT = VIDEO_EXT + AUDIO_EXT + (".pdf",)   # kept as they are, moved in from the inbox
VIDEO_MAX = 2 * 1024 * 1024 * 1024      # a film through the inbox
VIDEO_URL_MAX = 300 * 1024 * 1024       # a film fetched from an address
MAX_BYTES = 40 * 1024 * 1024
THUMB_SIDE = 480
INBOX_PER_LOOK = 40
THUMB_KEEP = 400
FETCH_TIMEOUT = 20

_lock = threading.RLock()
_thumbs = {}            # (id, file, side) -> jpeg bytes
_sizes = {}             # a film in the inbox -> its size at the last look


def _user_dir():
    import folder_paths
    get = getattr(folder_paths, "get_user_directory", None)
    try:
        d = get() if get else None
    except Exception:
        d = None
    if not d:
        d = os.path.join(os.path.dirname(folder_paths.get_output_directory()), "user")
    return d


def _root():
    return os.path.join(_user_dir(), DIRNAME)


def _dir(name):
    path = os.path.join(_root(), name)
    os.makedirs(path, exist_ok=True)
    return path


def _store_path():
    return os.path.join(_root(), "ideas.json")


# ------------------------------------------------------------- the store
def _read():
    try:
        with open(_store_path(), "r", encoding="utf-8") as fh:
            doc = json.load(fh)
    except Exception:
        doc = {}
    folders = doc.get("folders")
    if not isinstance(folders, list):
        folders = list(DEFAULT_FOLDERS)
    items = [x for x in (doc.get("items") or []) if isinstance(x, dict) and x.get("id")]
    return {"v": 1, "folders": [str(f) for f in folders], "items": items}


def _write(doc):
    os.makedirs(_root(), exist_ok=True)
    tmp = _store_path() + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, ensure_ascii=False, indent=1)
    os.replace(tmp, _store_path())


def _new_id():
    return time.strftime("%y%m%d%H%M%S") + "-" + uuid.uuid4().hex[:6]


def _host(url):
    try:
        h = urlparse(url or "").hostname or ""
    except Exception:
        h = ""
    return h[4:] if h.startswith("www.") else h


def _item(kind, **kw):
    it = {"id": _new_id(), "kind": kind, "note": "", "folders": [], "source": "",
          "via": "", "added": time.time(), "new": True, "used": False}
    it.update({k: v for k, v in kw.items() if v is not None})
    return it


def _save_picture(blob, name_hint=""):
    """Write a picture into files/ - checked with PIL, so a page or an error
    that came back instead of an image is refused. Returns (file, w, h)."""
    if not blob or len(blob) > MAX_BYTES:
        raise ValueError("no picture, or one over 40 MB")
    still = _still_brand(blob)
    if still:
        _picture_plugins()
    try:
        im = Image.open(io.BytesIO(blob))
        im.load()
    except Exception:
        if still and blob[8:12] in (b"avif", b"avis") or (still and b"avif" in bytes(blob[16:40])):
            # an AVIF this Pillow cannot read: kept as it is - the browser
            # shows it - with the size it states for itself
            w, h = _ispe(blob)
            name = uuid.uuid4().hex[:12] + ".avif"
            with open(os.path.join(_dir("files"), name), "wb") as fh:
                fh.write(blob)
            return name, w or None, h or None
        raise ValueError("that is not a picture this box can read")
    fmt = (im.format or "").lower()
    if fmt in ("avif", "heif", "heic") or still:
        # an AVIF or HEIF read here is kept as a JPEG - or a PNG, if it has
        # see-through parts - so the Series Book and everything else can read it
        alpha = im.mode in ("RGBA", "LA") or "transparency" in im.info
        out = io.BytesIO()
        if alpha:
            im.convert("RGBA").save(out, "PNG")
            ext = ".png"
        else:
            im.convert("RGB").save(out, "JPEG", quality=95)
            ext = ".jpg"
        name = uuid.uuid4().hex[:12] + ext
        with open(os.path.join(_dir("files"), name), "wb") as fh:
            fh.write(out.getvalue())
        return name, im.width, im.height
    ext = {"jpeg": ".jpg", "png": ".png", "webp": ".webp", "gif": ".gif", "bmp": ".bmp"}.get(fmt)
    if not ext:
        ext = os.path.splitext(name_hint or "")[1].lower()
    if ext not in PICTURE_EXT:
        ext = ".png"
    name = uuid.uuid4().hex[:12] + ext
    with open(os.path.join(_dir("files"), name), "wb") as fh:
        fh.write(blob)
    return name, im.width, im.height


def _add(it):
    with _lock:
        doc = _read()
        doc["items"].append(it)
        _write(doc)
    return it


# ------------------------------------------------------------- the inbox
def _clean_path(f):
    """A folder's path, tidied: "VOGUE/Runway" is Runway inside VOGUE."""
    segs = [re.sub(r"\s+", " ", x).strip()[:40] for x in str(f or "").replace("\\", "/").split("/")]
    return "/".join(x for x in segs if x)[:200]


def _with_folder(folders, path):
    """The folder list with this folder in it, and every folder it sits in -
    each new one placed at the end of its parent's folders, so the list
    still reads as the tree does."""
    parts = path.split("/")
    for k in range(1, len(parts) + 1):
        a = "/".join(parts[:k])
        if a in folders:
            continue
        parent = "/".join(parts[:k - 1])
        if not parent:
            folders.append(a)
            continue
        at = max(i for i, f in enumerate(folders) if f == parent or f.startswith(parent + "/"))
        folders.insert(at + 1, a)
    return folders


def _inbox_files(inbox):
    """(path, folder) for every file in the inbox: those at the top go to
    the new ones, those in a sub-folder into the folder of that path -
    inbox/VOGUE/Runway/ into Runway inside VOGUE. The box's own
    sub-folders (_taken, _unread) and hidden ones are passed by."""
    out = []
    try:
        top = sorted(os.listdir(inbox))
    except OSError:
        return out
    for n in top:
        path = os.path.join(inbox, n)
        if n.startswith((".", "_")):
            continue
        if os.path.isfile(path):
            out.append((path, None))
        elif os.path.isdir(path):
            for base, dirs, files in os.walk(path):
                dirs[:] = sorted(d for d in dirs if not d.startswith((".", "_")))
                folder = _clean_path(os.path.relpath(base, inbox).replace(os.sep, "/"))
                for f in sorted(files):
                    if not f.startswith("."):
                        out.append((os.path.join(base, f), folder))
    return out


def _scan_inbox():
    """Take in whatever was saved into inbox/ since the last look.

    A file at the top of the inbox waits with the new ones. A file in a
    sub-folder - inbox/VOGUE/, inbox/VOGUE/Runway/ - goes straight into the
    folder of that path, sorted, and a folder the box does not have yet is
    made, inside the one it is in.
    So a collection already kept in folders comes in as it is, by copying
    its folders into the inbox.

    A file still being copied waits for a later look. Taken files are moved
    to inbox/_taken/ (keeping their sub-folder), so nothing comes in twice
    and nothing is ever deleted."""
    inbox = _dir("inbox")
    found = _inbox_files(inbox)
    if not found:
        return 0
    now = time.time()
    new_items, new_folders, moves = [], [], []
    for path, folder in found:
        # a few dozen a look, so a folder of hundreds comes in over a minute
        # or two without holding the node up
        if len(new_items) >= INBOX_PER_LOOK:
            break
        ext = os.path.splitext(path)[1].lower()
        if ext not in PICTURE_EXT + TEXT_EXT + MEDIA_EXT:
            continue
        try:
            # creation time too: a copied file keeps its old modified time
            touched = max(os.path.getmtime(path), os.path.getctime(path))
            if now - touched < 2:
                continue
            blob = b""
            if ext not in MEDIA_EXT:
                with open(path, "rb") as fh:
                    blob = fh.read()
        except OSError:
            continue
        if ext in MEDIA_EXT:
            # a film is large and may still be coming in: it is taken only
            # once its size has stood still from one look to the next
            try:
                size = os.path.getsize(path)
            except OSError:
                continue
            if not size or _sizes.get(path) != size:
                _sizes[path] = size
                continue
            _sizes.pop(path, None)
        try:
            if ext in MEDIA_EXT:
                try:
                    kind, f = _take_media(path)
                except OSError:
                    continue                  # still held by the copy
                it = _item(kind, file=f, name=_file_name(path), via="inbox")
            elif ext in TEXT_EXT:
                text = blob.decode("utf-8", "replace").strip()
                if not text:
                    raise ValueError("empty")
                it = _item("text", text=text[:8000], via="inbox")
            else:
                f, w, h = _save_picture(blob, os.path.basename(path))
                it = _item("image", file=f, w=w, h=h, via="inbox")
        except ValueError:
            # a picture or film half copied fails too: only an old one is set aside
            if now - touched > 30:
                moves.append((path, "unread"))
            continue
        it["added"] = now + len(new_items) * 0.001
        if folder:
            it["folders"] = [folder]
            it["new"] = False
            if folder not in new_folders:
                new_folders.append(folder)
        new_items.append(it)
        if it["kind"] in ("image", "text"):  # the others were moved into the box already
            moves.append((path, "taken"))
    if new_items:
        with _lock:
            doc = _read()
            for f in new_folders:
                _with_folder(doc["folders"], f)
            doc["items"].extend(new_items)
            _write(doc)
    for path, sub in moves:
        _move_aside(path, sub)
    return len(new_items)


def _move_aside(path, sub):
    """Out of the inbox into inbox/_<sub>/, keeping the sub-folder it was
    in - moved, never deleted."""
    inbox = _dir("inbox")
    rel = os.path.relpath(os.path.dirname(path), inbox)
    to = os.path.join(inbox, "_" + sub, "" if rel in (".", "") else rel)
    os.makedirs(to, exist_ok=True)
    base = os.path.basename(path)
    dst = os.path.join(to, base)
    if os.path.exists(dst):
        stem, ext = os.path.splitext(base)
        dst = os.path.join(to, "%s-%s%s" % (stem, uuid.uuid4().hex[:4], ext))
    try:
        shutil.move(path, dst)
    except OSError:
        pass


# ------------------------------------------------------------- the bodies
def _list_body():
    took = _scan_inbox()
    with _lock:
        doc = _read()
        # a PDF's first page as its picture, tried once for each PDF; and
        # what the file info shows - its size on the disk, a PDF's pages
        tried = False
        for it in doc["items"]:
            # an AVIF picture kept as a film before the box knew them apart:
            # made a picture again, once
            if it.get("kind") == "video" and not it.get("sniffed") and it.get("file"):
                it["sniffed"] = True
                tried = True
                path = os.path.join(_dir("files"), os.path.basename(it["file"]))
                try:
                    with open(path, "rb") as fh:
                        blob = fh.read() if os.path.getsize(path) <= MAX_BYTES else fh.read(40)
                    if _still_brand(blob) and len(blob) > 40:
                        f, w, h = _save_picture(blob, "")
                        it.update({"kind": "image", "file": f, "w": w, "h": h, "bytes": os.path.getsize(os.path.join(_dir("files"), f))})
                        it.pop("coverT", None)
                        _to_trash(os.path.basename(path))
                except Exception:
                    pass
            if it.get("kind") == "pdf" and "thumb" not in it:
                it["thumb"] = bool(_pdf_thumb(it))
                tried = True
            if it.get("file") and "bytes" not in it:
                path = os.path.join(_dir("files"), os.path.basename(it["file"]))
                try:
                    it["bytes"] = os.path.getsize(path)
                except OSError:
                    it["bytes"] = 0
                if it.get("kind") == "pdf":
                    it["pages"] = _pdf_pages(path)
                tried = True
        if tried:
            _write(doc)
    return {"ok": True, "folders": doc["folders"], "items": doc["items"], "took": took,
            "inbox": _dir("inbox")}


# ------------------------------------------------------------- PDF pictures
PDF_THUMB = 1200          # the long side of a PDF's first page, as a picture


def _pdf_first_page(path):
    """The first page of a PDF as a PIL picture, or None. A PDF renderer is
    used where one is installed (pypdfium2, PyMuPDF); without one, the first
    picture inside the PDF is taken - which is the first page for a PDF of
    photographs or scans, as the Series Layout writes them. A PDF of text
    alone then has no picture, and keeps its plain card."""
    try:
        import pypdfium2 as pdfium                      # noqa: F401
        doc = pdfium.PdfDocument(path)
        try:
            page = doc[0]
            w, h = page.get_size()
            im = page.render(scale=PDF_THUMB / max(w, h, 1)).to_pil()
            return im.convert("RGB")
        finally:
            doc.close()
    except Exception:
        pass
    try:
        import fitz                                     # PyMuPDF
        with fitz.open(path) as doc:
            page = doc[0]
            r = page.rect
            pix = page.get_pixmap(matrix=fitz.Matrix(PDF_THUMB / max(r.width, r.height, 1),
                                                     PDF_THUMB / max(r.width, r.height, 1)))
            return Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    except Exception:
        pass
    try:
        with open(path, "rb") as fh:
            blob = fh.read(60 * 1024 * 1024)
        at = 0
        while True:
            at = blob.find(b"/DCTDecode", at)
            if at < 0:
                return None
            start = blob.find(b"stream", at)
            soi = blob.find(b"\xff\xd8", start)
            end = blob.find(b"endstream", soi)
            at += 10
            if start < 0 or soi < 0 or end < 0:
                continue
            try:
                im = Image.open(io.BytesIO(blob[soi:end]))
                im.load()
            except Exception:
                continue
            if max(im.size) >= 200:                     # not an icon or a logo
                return im.convert("RGB")
    except Exception:
        return None


def _pdf_pages(path):
    """How many pages a PDF has - by a renderer if there is one, else by
    counting its page objects."""
    try:
        import pypdfium2 as pdfium
        doc = pdfium.PdfDocument(path)
        try:
            return len(doc)
        finally:
            doc.close()
    except Exception:
        pass
    try:
        with open(path, "rb") as fh:
            blob = fh.read(80 * 1024 * 1024)
        return len(re.findall(rb"/Type\s*/Page(?![s\w])", blob)) or None
    except OSError:
        return None


def _pdf_thumb(it):
    """Make the picture of a PDF's first page beside it, once. True when
    there is one."""
    f = it.get("file")
    if not f:
        return False
    path = os.path.join(_dir("files"), os.path.basename(f))
    thumb = path + ".page1.jpg"
    if os.path.isfile(thumb):
        return True
    im = _pdf_first_page(path)
    if im is None:
        return False
    im.thumbnail((PDF_THUMB, PDF_THUMB))
    im.save(thumb, "JPEG", quality=88)
    it["w"], it["h"] = im.size
    return True


def _file_name(path):
    """The name a file came with, without its folder - shown for a sound or
    a PDF, which have no picture to show."""
    return os.path.basename(str(path or "")).strip()[:160]


_STILL_BRANDS = (b"avif", b"avis", b"heic", b"heix", b"heim", b"heis", b"mif1", b"msf1")


def _still_brand(blob):
    head = bytes(blob[:40])
    if head[4:8] != b"ftyp":
        return False
    if head[8:12] in _STILL_BRANDS:
        return True
    # a film names its own brand first; a picture may hide behind mif1 in the
    # list that follows
    return head[8:12] not in (b"isom", b"mp41", b"mp42", b"M4V ", b"qt  ", b"M4A ", b"M4B ", b"dash", b"iso5", b"iso6") \
        and any(b in head[16:40] for b in (b"avif", b"heic", b"mif1"))


_plugins_tried = False


def _picture_plugins():
    """AVIF and HEIF for Pillow, where they can be had: Pillow 11.3 and later
    read AVIF by themselves; otherwise a plugin, if one is installed."""
    global _plugins_tried
    if _plugins_tried:
        return
    _plugins_tried = True
    try:
        import pillow_avif  # noqa: F401
    except Exception:
        pass
    try:
        import pillow_heif
        pillow_heif.register_heif_opener()
        try:
            pillow_heif.register_avif_opener()
        except Exception:
            pass
    except Exception:
        pass


def _ispe(blob):
    """The width and height an AVIF or HEIF file states for itself."""
    i = bytes(blob[:65536]).find(b"ispe")
    if i < 0:
        return 0, 0
    return int.from_bytes(blob[i + 8:i + 12], "big"), int.from_bytes(blob[i + 12:i + 16], "big")


def _media(blob):
    """(kind, extension) of a film, a sound or a PDF by its first bytes - or
    None for anything else. The name a file came with is not trusted."""
    head = bytes(blob[:16])
    if head[:4] == b"%PDF":
        return ("pdf", ".pdf")
    if head[4:8] == b"ftyp":
        brand = head[8:12]
        # AVIF and HEIF pictures are made the same way as films - by brand
        # they are pictures, and kept as pictures
        if _still_brand(blob):
            return None
        if brand in (b"M4A ", b"M4B "):
            return ("audio", ".m4a")
        return ("video", ".mov" if brand == b"qt  " else ".mp4")
    if head[:4] == b"\x1a\x45\xdf\xa3":
        return ("video", ".webm")
    if head[:4] == b"RIFF" and head[8:12] == b"WAVE":
        return ("audio", ".wav")
    if head[:4] == b"OggS":
        return ("audio", ".ogg")
    if head[:4] == b"fLaC":
        return ("audio", ".flac")
    if head[:3] == b"ID3" or (len(head) > 1 and head[0] == 0xFF and (head[1] & 0xE0) == 0xE0):
        return ("audio", ".mp3")
    return None


_MEDIA_WORD = {"video": "film", "audio": "sound", "pdf": "PDF"}


def _save_media(blob, limit=VIDEO_MAX):
    """Write a film, a sound or a PDF into files/ as it is. The browser shows
    and plays it from the file itself, so nothing else is made.
    Returns (kind, file)."""
    hit = _media(blob)
    if not hit:
        raise ValueError("not a file this box can keep")
    kind, ext = hit
    if len(blob) > limit:
        raise ValueError("a %s over %d MB - save it into the inbox folder instead"
                         % (_MEDIA_WORD[kind], limit // (1024 * 1024)))
    name = uuid.uuid4().hex[:12] + ext
    with open(os.path.join(_dir("files"), name), "wb") as fh:
        fh.write(blob)
    return kind, name


def _take_media(path):
    """A film, a sound or a PDF from the inbox, moved into files/ as it is -
    it may be large, so it is neither read into memory nor kept twice on
    the disk. Returns (kind, file)."""
    with open(path, "rb") as fh:
        head = fh.read(16)
    hit = _media(head)
    if not hit:
        raise ValueError("not a file this box can keep")
    if os.path.getsize(path) > VIDEO_MAX:
        raise ValueError("too large")
    kind, ext = hit
    name = uuid.uuid4().hex[:12] + ext
    shutil.move(path, os.path.join(_dir("files"), name))
    return kind, name


def _add_picture_body(blob, name, source, via, memo=None):
    memo = str(memo or "").strip()[:20000] or None
    if _media(blob):
        try:
            kind, f = _save_media(blob)
        except ValueError as e:
            return {"ok": False, "error": str(e)}
        it = _add(_item(kind, file=f, name=_file_name(name), source=str(source or "")[:2000],
                        via=via or "drop", memo=memo))
        return {"ok": True, "item": it}
    try:
        f, w, h = _save_picture(blob, name)
    except ValueError as e:
        return {"ok": False, "error": str(e)}
    it = _add(_item("image", file=f, w=w, h=h, source=str(source or "")[:2000], via=via or "drop",
                    memo=memo))
    return {"ok": True, "item": it}


_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
       "(KHTML, like Gecko) Chrome/131.0 Safari/537.36")
PAGE_BYTES = 3 * 1024 * 1024


def _fetch(url, referer=None, limit=MAX_BYTES):
    req = Request(url, headers={"User-Agent": _UA, "Accept-Language": "en,ko;q=0.8",
                                "Referer": referer or url})
    with urlopen(req, timeout=FETCH_TIMEOUT) as r:
        kind = (r.headers.get("Content-Type") or "").lower()
        charset = r.headers.get_content_charset() or ""
        if kind.startswith(("video/", "audio/")) or kind.startswith("application/pdf"):
            limit = VIDEO_URL_MAX
        blob = r.read(limit + 1)
        final = r.geturl() or url
    return blob, kind, charset, final


def _meta(page, *names):
    """The content of the first <meta> of these property or name values."""
    for name in names:
        for m in re.finditer(r"<meta\b[^>]*>", page, re.I):
            tag = m.group(0)
            if not re.search(r"(?:property|name|itemprop)\s*=\s*[\"']%s[\"']" % re.escape(name), tag, re.I):
                continue
            c = re.search(r"content\s*=\s*(\"([^\"]*)\"|'([^']*)')", tag, re.I | re.S)
            if c:
                v = _html.unescape((c.group(2) if c.group(2) is not None else c.group(3)) or "").strip()
                if v:
                    return v
    return ""


def _page_card(page, base):
    """What a page says about itself: its title, its description and the
    picture it offers for sharing - the same three a link preview shows."""
    title = _meta(page, "og:title", "twitter:title")
    if not title:
        m = re.search(r"<title[^>]*>(.*?)</title>", page, re.I | re.S)
        title = _html.unescape(re.sub(r"\s+", " ", m.group(1))).strip() if m else ""
    desc = _meta(page, "og:description", "twitter:description", "description")
    pic = _meta(page, "og:image:secure_url", "og:image", "og:image:url", "twitter:image", "twitter:image:src")
    if pic:
        pic = urljoin(base, pic)
    return title[:300], desc[:1500], pic


def _as_work(r, wfolder=None):
    """An idea sent from the Series Layout or the Image Viewer is one's own
    work: kept in My works - under the series it belongs to - not with the new
    ones waiting to be sorted."""
    if not r or not r.get("ok") or not r.get("item"):
        return r
    iid = r["item"]["id"]
    with _lock:
        doc = _read()
        it = next((x for x in doc["items"] if x["id"] == iid), None)
        if it:
            it["work"] = True
            it["new"] = False
            w = " ".join(str(wfolder or "").split())[:120]
            if w:
                it["wfolder"] = w
            _write(doc)
            r = dict(r, item=it)
    return r


def _add_file_body(path, memo, via):
    """A file the Visual Suite wrote into the output folder - a film or a
    page the Series Layout exported - copied into the box. Only a file
    inside the output folder is taken."""
    import folder_paths
    out = os.path.realpath(folder_paths.get_output_directory())
    path = os.path.realpath(str(path or ""))
    if not path.startswith(out + os.sep) or not os.path.isfile(path):
        return {"ok": False, "error": "only a file in the output folder can be sent here"}
    memo = str(memo or "").strip()[:20000] or None
    with open(path, "rb") as fh:
        head = fh.read(16)
    hit = _media(head)
    try:
        if hit:
            kind, ext = hit
            if os.path.getsize(path) > VIDEO_MAX:
                return {"ok": False, "error": "too large"}
            name = uuid.uuid4().hex[:12] + ext
            shutil.copyfile(path, os.path.join(_dir("files"), name))
            it = _item(kind, file=name, name=_file_name(path), via=via or "layout", memo=memo)
        else:
            with open(path, "rb") as fh:
                f, w, h = _save_picture(fh.read(), path)
            it = _item("image", file=f, w=w, h=h, name=_file_name(path), via=via or "layout", memo=memo)
    except (OSError, ValueError) as e:
        return {"ok": False, "error": str(e)}
    return {"ok": True, "item": _add(it)}


# ------------------------------------------------- a whole page as one idea
# An editorial page - a magazine story on fashioneditorials.com, a show on a
# runway site - is kept as one idea: every large picture of the story, in
# the page's order, and the story's words (its credits among them) as the
# notes. Only the story is looked through when the page marks it out, so
# the logo, the advertising and the other stories' thumbnails stay out;
# small pictures are left out after they are read.
GALLERY_MAX = 40
GALLERY_MIN_SIDE = 400
GALLERY_WORKERS = 6
_SKIP_PIC = re.compile(r"(logo|icon|avatar|sprite|favicon|banner|/ads?/|advert|placeholder|gravatar|emoji|"
                       r"pixel|spacer|badge|button|loader|spinner)", re.I)
_WP_SIZE = re.compile(r"-(\d{2,4})x(\d{2,4})(?=\.(?:jpe?g|png|webp|avif)(?:$|\?))", re.I)
_PIC_EXT = re.compile(r"\.(?:jpe?g|png|webp|avif)(?:$|[?#])", re.I)


def _block(page, start, tag):
    """The element that opens at start, to its own closing tag - nested ones
    of the same name counted, as a regular expression cannot."""
    depth, i = 0, start
    pat = re.compile(r"<(/?)%s\b[^>]*>" % tag, re.I)
    for m in pat.finditer(page, start):
        depth += -1 if m.group(1) else 1
        if depth == 0:
            return page[start:m.end()]
    return page[start:]


def _story_part(page):
    """The part of the page that is the story: an <article>, or the block a
    blog gives its post. The whole page when nothing marks it."""
    finds = []
    for tag, pat in (("article", r"<article\b[^>]*>"),
                     ("div", r"<div\b[^>]*class=[\"'][^\"']*\b(?:entry-content|post-content|article-content|"
                             r"article-body|story-body|post-body|single-content|gallery)\b[^\"']*[\"'][^>]*>"),
                     ("main", r"<main\b[^>]*>")):
        best = ""
        for m in re.finditer(pat, page, re.I | re.S):
            blk = _block(page, m.start(), tag)
            if len(re.findall(r"<img\b", blk, re.I)) > len(re.findall(r"<img\b", best, re.I)):
                best = blk
        if len(re.findall(r"<img\b", best, re.I)) >= 2:
            finds.append(best)
    if finds:
        # the block holding the most pictures - of those, the tightest
        n = lambda b: len(re.findall(r"<img\b", b, re.I))
        most = max(n(b) for b in finds)
        return min((b for b in finds if n(b) == most), key=len)
    return page


def _srcset_best(v):
    best, bw = "", -1
    for part in (v or "").split(","):
        bits = part.strip().split()
        if not bits:
            continue
        w = 0
        if len(bits) > 1:
            m = re.match(r"(\d+(?:\.\d+)?)([wx])", bits[1])
            if m:
                w = float(m.group(1)) * (1000 if m.group(2) == "x" else 1)
        if w > bw:
            best, bw = bits[0], w
    return best


def _attr(tag, name):
    m = re.search(r"\b%s\s*=\s*(\"([^\"]*)\"|'([^']*)'|([^\s>]+))" % re.escape(name), tag, re.I | re.S)
    if not m:
        return ""
    return _html.unescape(next(g for g in m.groups()[1:] if g is not None)).strip()


def _story_pictures(part, base):
    """The pictures of the story, largest version of each, in order. A
    picture wrapped in a link to its own full-size file is taken from the
    link."""
    out, seen = [], set()

    def keep(cands, w_attr=0, h_attr=0):
        for u in cands:
            if not u or u.startswith("data:"):
                continue
            u = urljoin(base, u)
            if not re.match(r"^https?://", u, re.I) or _SKIP_PIC.search(u) or u.lower().split("?")[0].endswith((".svg", ".gif")):
                continue
            key = _WP_SIZE.sub("", u.split("?")[0]).lower()
            if key in seen:
                return
            if (w_attr and w_attr < 200) or (h_attr and h_attr < 200):
                return
            seen.add(key)
            out.append(u)
            return

    for m in re.finditer(r"<a\b[^>]*>\s*(?:<[^>]+>\s*)*?<img\b[^>]*>|<img\b[^>]*>|<source\b[^>]*>", part, re.I | re.S):
        chunk = m.group(0)
        img = re.search(r"<(?:img|source)\b[^>]*>", chunk, re.I | re.S).group(0)
        cands = []
        if chunk.lower().startswith("<a"):
            href = _attr(chunk[:chunk.find(">") + 1], "href")
            if href and _PIC_EXT.search(href):
                cands.append(href)
        for a in ("data-orig-file", "data-large-file", "data-full-url", "data-src-large"):
            v = _attr(img, a)
            if v:
                cands.append(v)
        for a in ("srcset", "data-srcset", "data-lazy-srcset"):
            v = _srcset_best(_attr(img, a))
            if v:
                cands.append(v)
        for a in ("data-src", "data-lazy-src", "data-original", "src"):
            v = _attr(img, a)
            if v:
                cands.append(v)
        try:
            w = int(re.sub(r"\D", "", _attr(img, "width")) or 0)
            h = int(re.sub(r"\D", "", _attr(img, "height")) or 0)
        except ValueError:
            w = h = 0
        keep(cands, w, h)
        if len(out) >= GALLERY_MAX * 2:
            break
    return out


def _story_words(part, title):
    """The story's words, a line to a paragraph: headings, paragraphs and
    list lines, so the credits come along line by line."""
    part = re.sub(r"<(script|style|noscript|figure|button|form|nav|footer|aside)\b.*?</\1>", " ", part, flags=re.I | re.S)
    lines = []
    for m in re.finditer(r"<(h[1-4]|p|li|figcaption|dt|dd)\b[^>]*>(.*?)</\1>", part, re.I | re.S):
        t = re.sub(r"<br\s*/?>", "\n", m.group(2), flags=re.I)
        t = _html.unescape(re.sub(r"<[^>]+>", " ", t))
        for ln in t.split("\n"):
            ln = re.sub(r"[ \t ]+", " ", ln).strip()
            if len(ln) < 3 or ln == title or ln in lines:
                continue
            if re.match(r"^(share|tweet|pin it|read more|advertisement|related|previous|next|comments?)\b", ln, re.I):
                continue
            lines.append(ln)
    return "\n".join(lines)[:6000]


def _fetch_picture(u, referer):
    """One picture of the story, at its full size where the site keeps one:
    a WordPress size like -1024x1536 is tried without it first."""
    tries = [u]
    full = _WP_SIZE.sub("", u)
    if full != u:
        tries.insert(0, full)
    for t in tries:
        try:
            blob, kind, _c, final = _fetch(t, referer)
        except Exception:
            continue
        if kind and not kind.startswith("image/"):
            continue
        try:
            from PIL import Image
            import io
            with Image.open(io.BytesIO(blob)) as im:
                w, h = im.size
            if min(w, h) < GALLERY_MIN_SIDE:
                return None
        except Exception:
            pass
        return blob, os.path.basename(urlparse(final).path)
    return None


def _add_gallery(page, final, url, via, memo):
    """The story as one idea, or None when the page is not one - fewer than
    two large pictures in it."""
    from concurrent.futures import ThreadPoolExecutor
    part = _story_part(page)
    pics = _story_pictures(part, final)
    if len(pics) < 2:
        return None
    # The picture the page offers for sharing is its lead picture - on many
    # sites the first of the story, set above the story's own block, where
    # it is not looked for. It goes first, unless it is one already found.
    _t, _d, lead = _page_card(page, final)
    if lead and not _SKIP_PIC.search(lead):
        key = lambda u: _WP_SIZE.sub("", u.split("?")[0]).lower()
        if key(lead) not in {key(u) for u in pics}:
            pics.insert(0, lead)
    with ThreadPoolExecutor(GALLERY_WORKERS) as pool:
        got = [g for g in pool.map(lambda u: _fetch_picture(u, final), pics) if g][:GALLERY_MAX]
    if len(got) < 2:
        return None
    title, desc, _pic = _page_card(page, final)
    h1 = re.search(r"<h1\b[^>]*>(.*?)</h1>", part, re.I | re.S) or re.search(r"<h1\b[^>]*>(.*?)</h1>", page, re.I | re.S)
    if h1:
        t = _html.unescape(re.sub(r"<[^>]+>", " ", h1.group(1)))
        t = re.sub(r"\s+", " ", t).strip()
        if t:
            title = t[:300]
    words = _story_words(part, title) or desc
    notes = "\n".join(x for x in (title, words, str(memo or "").strip()) if x)
    try:
        f, w, h = _save_picture(got[0][0], got[0][1])
    except ValueError:
        return None
    it = _add(_item("image", file=f, w=w, h=h, memo=notes[:20000], source=url[:2000], via=via))
    n = 1
    for blob, name in got[1:]:
        if _more_add_body(it["id"], blob, name).get("ok"):
            n += 1
    with _lock:
        doc = _read()
        it = next((x for x in doc["items"] if x["id"] == it["id"]), it)
    return {"ok": True, "item": it, "page": True, "pictures": n}


def _add_url_body(url, source, via=None, memo=None):
    """A web address. A picture is kept as a picture. A page is kept as its
    card: the picture it offers for sharing, with its title and description
    as the notes and the page's address as the source - so a pasted link is
    an idea that can be looked at, not just an address. A page that cannot
    be read is kept as its address."""
    url = str(url or "").strip()
    via = via or "drop"
    if not re.match(r"^https?://", url, re.I):
        return {"ok": False, "error": "not a web address"}
    try:
        blob, kind, charset, final = _fetch(url, source)
    except Exception as e:
        return {"ok": False, "error": "the address could not be read (%s)" % type(e).__name__}
    if kind.startswith(("image/", "video/", "audio/", "application/pdf")) or not ("html" in kind or blob[:600].lstrip()[:1] == b"<"):
        r = _add_picture_body(blob, os.path.basename(urlparse(final).path), source or url, via, memo)
        if r.get("ok") or kind.startswith(("image/", "video/", "audio/", "application/pdf")):
            return r
    try:
        page = blob[:PAGE_BYTES].decode(charset or "utf-8", "replace")
    except LookupError:
        page = blob[:PAGE_BYTES].decode("utf-8", "replace")
    try:
        g = _add_gallery(page, final, url, via, memo)
    except Exception:
        g = None
    if g:
        return g
    title, desc, pic = _page_card(page, final)
    memo = "\n".join(x for x in (title, desc) if x)
    if pic:
        try:
            pblob, _k, _c, pfinal = _fetch(pic, final)
            f, w, h = _save_picture(pblob, os.path.basename(urlparse(pfinal).path))
            it = _add(_item("image", file=f, w=w, h=h, memo=memo, source=url[:2000], via=via))
            return {"ok": True, "item": it, "page": True}
        except Exception:
            pass
    it = _add(_item("text", text=memo or url, source=url[:2000], via=via))
    return {"ok": True, "item": it, "page": True}


def _add_text_body(text, source, via):
    text = str(text or "").strip()
    if not text:
        return {"ok": False, "error": "nothing to keep"}
    it = _add(_item("text", text=text[:8000], source=str(source or "")[:2000], via=via or "paste"))
    return {"ok": True, "item": it}


_EDITABLE = ("note", "memo", "folders", "used", "new", "text", "source", "stars", "seen", "coverT", "tags", "untags",
             "work", "wfolder")


def _update_body(iid, changes):
    with _lock:
        doc = _read()
        it = next((x for x in doc["items"] if x["id"] == iid), None)
        if not it:
            return {"ok": False, "error": "no such idea"}
        for k in _EDITABLE:
            if k not in (changes or {}):
                continue
            v = changes[k]
            if k == "folders":
                v = [str(f) for f in (v or []) if str(f) in doc["folders"]]
            elif k in ("tags", "untags"):            # keywords given by hand; found ones put aside
                seen, out = set(), []
                for t in (v if isinstance(v, list) else []):
                    t = " ".join(str(t).split())[:60]
                    if t and t.lower() not in seen:
                        seen.add(t.lower())
                        out.append(t)
                v = out[:60]
            elif k in ("used", "new", "work"):
                v = bool(v)
            elif k == "wfolder":                     # the series a work belongs to
                v = " ".join(str(v or "").split())[:120]
            elif k == "stars":                      # 0 none, 1 like, 2 love, 3 for the next series
                try:
                    v = max(0, min(3, int(v)))
                except (TypeError, ValueError):
                    v = 0
            elif k == "coverT":                     # the moment of a film shown as its picture
                try:
                    v = max(0.0, float(v))
                except (TypeError, ValueError):
                    continue
            elif k == "seen":                       # when it was last opened
                try:
                    v = float(v)
                except (TypeError, ValueError):
                    continue
            elif k == "memo":
                v = str(v or "")[:20000]
            else:
                v = str(v or "")[:8000]
            it[k] = v
        _write(doc)
    return {"ok": True, "item": it}


def _delete_body(iid):
    with _lock:
        doc = _read()
        it = next((x for x in doc["items"] if x["id"] == iid), None)
        if not it:
            return {"ok": False, "error": "no such idea"}
        doc["items"] = [x for x in doc["items"] if x["id"] != iid]
        _write(doc)
    for f in [it.get("file")] + [m.get("file") for m in it.get("more") or []]:
        if f:
            _to_trash(f)
    with _lock:
        for k in [k for k in _thumbs if k[0] == iid]:
            _thumbs.pop(k, None)
    return {"ok": True}


def _to_trash(f):
    src = os.path.join(_dir("files"), os.path.basename(f))
    if os.path.exists(src):
        try:
            shutil.move(src, os.path.join(_dir("trash"), os.path.basename(f)))
        except OSError:
            pass


# ------------------------------------------------------------- more pictures
# An idea can hold more than one picture - the ones beside it on the same
# page. The first is the idea's own picture, on the wall and wherever the idea
# goes; the rest are kept in "more", in their order, and shown under it when
# the idea is opened. Only a picture idea holds more.
MORE_MAX = 60


def _more_add_body(iid, blob=None, name="", url=None, memo=None, t=None):
    if url:
        try:
            blob, _k, _c, final = _fetch(str(url), str(url))
            name = os.path.basename(urlparse(final).path)
        except Exception as e:
            return {"ok": False, "error": "the address could not be read (%s)" % type(e).__name__}
    try:
        f, w, h = _save_picture(blob, name)
    except ValueError as e:
        return {"ok": False, "error": str(e)}
    err = None
    with _lock:
        doc = _read()
        it = next((x for x in doc["items"] if x["id"] == iid), None)
        if not it or it.get("kind") not in ("image", "video"):
            err = "only a picture or a film holds more pictures"
        elif len(it.get("more") or []) >= MORE_MAX:
            err = "this idea holds as many pictures as it can"
        else:
            entry = {"file": f, "w": w, "h": h, "bytes": len(blob)}
            if memo:                                 # the words this picture came with
                entry["note"] = str(memo)[:20000]
            try:                                     # a still: where in the film it was taken
                if t is not None and str(t) != "":
                    entry["t"] = round(max(0.0, float(t)), 2)
            except ValueError:
                pass
            it.setdefault("more", []).append(entry)
            _write(doc)
    if err:
        _to_trash(f)
        return {"ok": False, "error": err}
    return {"ok": True, "item": it}


def _more_set_body(iid, main, more):
    """The pictures of an idea as the node has them now: which is its own
    picture and the order of the rest. One left out goes to the trash; one
    named that is in the trash - put back by Cancel - comes out of it."""
    main = os.path.basename(str(main or ""))
    more = [os.path.basename(str(x)) for x in (more or []) if x]
    with _lock:
        doc = _read()
        it = next((x for x in doc["items"] if x["id"] == iid), None)
        if not it or it.get("kind") not in ("image", "video") or not main:
            return {"ok": False, "error": "no such picture idea"}
        if it.get("kind") == "video" and main != it.get("file"):
            return {"ok": False, "error": "a film stays first - its stills come after it"}
        known = {it["file"]: {"file": it["file"], "w": it.get("w"), "h": it.get("h"), "bytes": it.get("bytes")}}
        for m in it.get("more") or []:
            known[m["file"]] = dict(m)
        want = list(dict.fromkeys([main] + more))
        for f in want:
            if f in known:
                continue
            back = os.path.join(_dir("trash"), f)
            if not os.path.isfile(back):
                return {"ok": False, "error": "a picture of this idea is gone"}
            path = os.path.join(_dir("files"), f)
            shutil.move(back, path)
            try:
                with Image.open(path) as im:
                    w, h = im.size
            except Exception:
                w = h = None
            known[f] = {"file": f, "w": w, "h": h, "bytes": os.path.getsize(path)}
        gone = [f for f in known if f not in want]
        first = known[want[0]]
        it["file"], it["w"], it["h"] = first["file"], first.get("w"), first.get("h")
        if first.get("bytes") is not None:
            it["bytes"] = first["bytes"]
        it["more"] = [known[f] for f in want[1:]]
        if not it["more"]:
            it.pop("more")
        _write(doc)
    for f in gone:
        _to_trash(f)
    with _lock:
        for k in [k for k in _thumbs if k[0] == iid and k[1] in gone]:
            _thumbs.pop(k, None)
    return {"ok": True, "item": it}


def _merge_body(ids):
    """Several picture ideas made one: the first keeps its notes; the
    pictures of the rest come in under its own, in order, and the rest go.
    Renders made the same way - one LoRA, one setting - are one idea."""
    ids = [str(i) for i in (ids or [])]
    if len(ids) < 2:
        return {"ok": False, "error": "nothing to put together"}
    with _lock:
        doc = _read()
        byid = {x["id"]: x for x in doc["items"]}
        its = [byid[i] for i in ids if i in byid and byid[i].get("kind") == "image" and byid[i].get("file")]
        if len(its) < 2:
            return {"ok": False, "error": "nothing to put together"}
        head = its[0]
        more = list(head.get("more") or [])
        for it in its[1:]:
            entry = {"file": it["file"], "w": it.get("w"), "h": it.get("h"), "bytes": it.get("bytes")}
            words = "\n".join(x for x in (str(it.get("note") or "").strip(), str(it.get("memo") or "").strip()) if x)
            if words:                                # each picture keeps the words it came with
                entry["note"] = words
            more.append(entry)
            more.extend(it.get("more") or [])
            head["stars"] = max(head.get("stars") or 0, it.get("stars") or 0)
            for k in ("folders", "tags"):
                for v in it.get(k) or []:
                    if v not in head.setdefault(k, []):
                        head[k].append(v)
        head["more"] = more[:MORE_MAX]
        gone = {it["id"] for it in its[1:]}
        doc["items"] = [x for x in doc["items"] if x["id"] not in gone]
        _write(doc)
    return {"ok": True, "item": head, "merged": len(gone)}


def _folders_body(folders, renamed):
    """The folder list as the node has it now, in its order - folders inside
    folders as paths, each right after its parent. A renamed folder takes
    its ideas with it; a folder taken away leaves its ideas where they are,
    in the others or in none."""
    clean = []
    for f in folders or []:
        f = _clean_path(f)
        if f and f not in clean:
            _with_folder(clean, f)
    renamed = renamed if isinstance(renamed, dict) else {}
    with _lock:
        doc = _read()
        for it in doc["items"]:
            fs = [renamed.get(f, f) for f in it.get("folders") or []]
            it["folders"] = [f for f in dict.fromkeys(fs) if f in clean]
        doc["folders"] = clean
        _write(doc)
    return {"ok": True, "folders": clean}


# ---------------------------------------------------------- the sites
# Bookmarks of the sites the ideas are gathered from - fashion, photography,
# museums - kept apart from the ideas in sites.json, in the order they were
# put in or dragged into.
SITES_MAX = 120


def _sites_path():
    return os.path.join(_root(), "sites.json")


def _clean_sites(rows):
    out, seen = [], set()
    for r in rows or []:
        if not isinstance(r, dict):
            continue
        url = str(r.get("url") or "").strip()[:500]
        if not url:
            continue
        if not re.match(r"^https?://", url, re.I):
            url = "https://" + url.lstrip("/")
        if url in seen:
            continue
        seen.add(url)
        name = str(r.get("name") or "").strip()[:60]
        out.append({"name": name, "url": url})
        if len(out) >= SITES_MAX:
            break
    return out


def _sites_body():
    path = _sites_path()
    if not os.path.isfile(path):
        return {"ok": True, "sites": None}
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return {"ok": True, "sites": _clean_sites((json.load(fh) or {}).get("sites"))}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


def _sites_save_body(rows):
    clean = _clean_sites(rows)
    os.makedirs(_root(), exist_ok=True)
    tmp = _sites_path() + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump({"v": 1, "sites": clean}, fh, ensure_ascii=False, indent=1)
    os.replace(tmp, _sites_path())
    return {"ok": True, "sites": clean}


def _picture_path(iid, which=None):
    # the idea's picture - or, named, another of its pictures
    with _lock:
        doc = _read()
    it = next((x for x in doc["items"] if x["id"] == iid), None)
    if not it or not it.get("file"):
        return None
    f = it["file"]
    if which and which != f and any(m.get("file") == which for m in it.get("more") or []):
        f = which
    path = os.path.join(_dir("files"), os.path.basename(f))
    return path if os.path.isfile(path) else None


def _picture_body(iid, side, which=None):
    path = _picture_path(iid, which)
    if not path:
        return None
    try:
        side = int(side or 0)
    except ValueError:
        side = 0
    if side > 0 and path.lower().endswith(".pdf"):
        page = path + ".page1.jpg"
        if not os.path.isfile(page):
            return None
        path = page                                     # its first page, made small below
    elif side <= 0 or os.path.splitext(path)[1].lower() in MEDIA_EXT:
        return ("file", path)
    side = min(max(side, 120), 1600)
    key = (iid, os.path.basename(path), side)
    with _lock:
        hit = _thumbs.get(key)
    if hit:
        return ("jpeg", hit)
    try:
        im = Image.open(path)
        # a moving GIF or WebP is sent whole, so it moves on the wall too
        if getattr(im, "is_animated", False):
            return ("file", path)
        im.seek(0)
        im = im.convert("RGB")
        im.thumbnail((side, side))
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=86)
        body = buf.getvalue()
    except Exception:
        return ("file", path)
    with _lock:
        if len(_thumbs) > THUMB_KEEP:
            _thumbs.clear()
        _thumbs[key] = body
    return ("jpeg", body)


# ------------------------------------------------------------- briefs
def _safe(name, fallback="Brief"):
    name = re.sub(r'[\\/:*?"<>|\x00-\x1f]+', " ", str(name or "")).strip().strip(".")
    return re.sub(r"\s+", " ", name)[:80] or fallback


def _brief_files_body(ids, title):
    """The pictures of a brief, written in its order - 01, 02... - into
    output/Idea Box/Briefs/<title>/, to be attached where the brief is sent.
    A film, a sound or a PDF has no picture there; its place in the
    numbering is kept, so the numbers of the brief and the files agree.
    On Windows the folder is opened."""
    import folder_paths
    with _lock:
        doc = _read()
    by = {x["id"]: x for x in doc["items"]}
    base = os.path.join(folder_paths.get_output_directory(), "Idea Box", "Briefs")
    stem = _safe(title, time.strftime("Brief %Y-%m-%d %H%M"))
    dest = os.path.join(base, stem)
    k = 2
    while os.path.exists(dest):
        dest = os.path.join(base, "%s (%d)" % (stem, k))
        k += 1
    os.makedirs(dest, exist_ok=True)
    written = 0
    for n, iid in enumerate(ids or [], 1):
        it = by.get(iid)
        if not it or not it.get("file"):
            continue
        src = os.path.join(_dir("files"), os.path.basename(it["file"]))
        if it.get("kind") == "pdf":
            src = src + ".page1.jpg"                    # its first page stands for it
        elif it.get("kind") != "image":
            continue
        if not os.path.isfile(src):
            continue
        ext = os.path.splitext(src)[1].lower() or ".jpg"
        name = _safe(it.get("memo") and str(it["memo"]).strip().splitlines()[0] or it.get("name") or "", "")
        shutil.copyfile(src, os.path.join(dest, "%02d%s%s" % (n, " " + name[:60] if name else "", ext)))
        written += 1
        # the pictures beside it on its page: 01-2, 01-3...
        for k, m in enumerate(it.get("more") or [], 2):
            msrc = os.path.join(_dir("files"), os.path.basename(m.get("file") or ""))
            if os.path.isfile(msrc):
                mext = os.path.splitext(msrc)[1].lower() or ".jpg"
                shutil.copyfile(msrc, os.path.join(dest, "%02d-%d%s%s" % (n, k, " " + name[:60] if name else "", mext)))
                written += 1
    if os.name == "nt":
        try:
            os.startfile(dest)                          # noqa: the user's own folder, opened for them
        except Exception:
            pass
    return {"ok": True, "folder": dest, "written": written}


# ------------------------------------------------------------- page capture
CAPTURE_SIZE = (1440, 1800)
CAPTURE_WAIT_MS = 6000
CAPTURE_TIMEOUT = 60


def _browser():
    """A Chromium browser already on this computer - Edge, which every
    Windows has, or Chrome - to capture a page with, unseen."""
    import shutil
    env = os.environ
    found = []
    for base in (env.get("PROGRAMFILES(X86)"), env.get("PROGRAMFILES"), env.get("LOCALAPPDATA")):
        if not base:
            continue
        found += [os.path.join(base, "Microsoft", "Edge", "Application", "msedge.exe"),
                  os.path.join(base, "Google", "Chrome", "Application", "chrome.exe")]
    found += ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
              "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
              "/Applications/Chromium.app/Contents/MacOS/Chromium"]
    for path in found:
        if os.path.isfile(path):
            return path
    for name in ("msedge", "microsoft-edge", "google-chrome", "chrome", "chromium", "chromium-browser"):
        hit = shutil.which(name)
        if hit:
            return hit
    return None


def _capture_body(iid):
    """The page an idea came from, captured as it opens on a wide screen,
    in place of its picture. The browser runs in a profile of its own, so
    it never touches the browser in use - and so it is signed in nowhere."""
    import subprocess
    import tempfile
    with _lock:
        doc = _read()
    it = next((x for x in doc["items"] if x["id"] == iid), None)
    if not it:
        return {"ok": False, "error": "no such idea"}
    url = str(it.get("source") or "")
    if not re.match(r"^https?://", url, re.I):
        return {"ok": False, "error": "this idea has no web address to capture"}
    exe = _browser()
    if not exe:
        return {"ok": False, "error": "no Edge or Chrome found on this computer to capture with"}
    work = tempfile.mkdtemp(prefix="idea_capture_")
    shot = os.path.join(work, "page.png")
    w, h = CAPTURE_SIZE
    cmd = [exe, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--mute-audio",
           "--no-first-run", "--no-default-browser-check", "--disable-extensions",
           "--user-data-dir=" + os.path.join(work, "profile"),
           "--window-size=%d,%d" % (w, h), "--virtual-time-budget=%d" % CAPTURE_WAIT_MS,
           "--screenshot=" + shot, url]
    try:
        kw = {}
        if os.name == "nt":
            kw["creationflags"] = 0x08000000          # no console window
        subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                       timeout=CAPTURE_TIMEOUT, **kw)
        with open(shot, "rb") as fh:
            blob = fh.read()
        f, pw, ph = _save_picture(blob, "page.png")
    except subprocess.TimeoutExpired:
        shutil.rmtree(work, ignore_errors=True)
        return {"ok": False, "error": "the page took too long to open"}
    except Exception:
        shutil.rmtree(work, ignore_errors=True)
        return {"ok": False, "error": "the page could not be captured"}
    shutil.rmtree(work, ignore_errors=True)
    with _lock:
        doc = _read()
        it = next((x for x in doc["items"] if x["id"] == iid), None)
        if not it:
            return {"ok": False, "error": "no such idea"}
        old = it.get("file")
        if it.get("kind") == "text":
            words = str(it.get("text") or "").strip()
            memo = str(it.get("memo") or "").strip()
            if words and words != url and words not in memo:
                it["memo"] = (words + ("\n" + memo if memo else "")).strip()
            it.pop("text", None)
            it["kind"] = "image"
        it.update({"file": f, "w": pw, "h": ph, "captured": True})
        _write(doc)
    if old:
        src = os.path.join(_dir("files"), os.path.basename(old))
        if os.path.exists(src):
            try:
                shutil.move(src, os.path.join(_dir("trash"), os.path.basename(old)))
            except OSError:
                pass
    with _lock:
        for k in [k for k in _thumbs if k[0] == iid]:
            _thumbs.pop(k, None)
    return {"ok": True, "item": it}


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

    @_routes.get("/leiel_idea/list")
    async def _idea_list(request):
        return _web.json_response(await _run(_list_body))

    @_routes.post("/leiel_idea/add")
    async def _idea_add(request):
        q = request.rel_url.query
        blob = await request.read()
        r = await _run(_add_picture_body, blob, q.get("name"), q.get("source"), q.get("via"), q.get("memo"))
        if q.get("work"):
            r = await _run(_as_work, r, q.get("wfolder"))
        return _web.json_response(r)

    @_routes.post("/leiel_idea/add_file")
    async def _idea_add_file(request):
        data = await _json(request)
        r = await _run(_add_file_body, data.get("path"), data.get("memo"), data.get("via"))
        if data.get("work"):
            r = await _run(_as_work, r, data.get("wfolder"))
        return _web.json_response(r)

    @_routes.post("/leiel_idea/add_url")
    async def _idea_add_url(request):
        data = await _json(request)
        return _web.json_response(await _run(_add_url_body, data.get("url"), data.get("source"),
                                             data.get("via"), data.get("memo")))

    @_routes.post("/leiel_idea/add_text")
    async def _idea_add_text(request):
        data = await _json(request)
        return _web.json_response(await _run(_add_text_body, data.get("text"),
                                             data.get("source"), data.get("via")))

    @_routes.post("/leiel_idea/update")
    async def _idea_update(request):
        data = await _json(request)
        return _web.json_response(await _run(_update_body, data.get("id"), data.get("changes")))

    @_routes.post("/leiel_idea/delete")
    async def _idea_delete(request):
        data = await _json(request)
        return _web.json_response(await _run(_delete_body, data.get("id")))

    @_routes.get("/leiel_idea/sites")
    async def _idea_sites(request):
        return _web.json_response(await _run(_sites_body))

    @_routes.post("/leiel_idea/sites")
    async def _idea_sites_save(request):
        data = await _json(request)
        return _web.json_response(await _run(_sites_save_body, data.get("sites")))

    @_routes.post("/leiel_idea/folders")
    async def _idea_folders(request):
        data = await _json(request)
        return _web.json_response(await _run(_folders_body, data.get("folders"), data.get("renamed")))

    @_routes.post("/leiel_idea/more_add")
    async def _idea_more_add(request):
        q = request.rel_url.query
        if q.get("url"):
            return _web.json_response(await _run(_more_add_body, q.get("id"), None, "", q.get("url"), q.get("memo")))
        blob = await request.read()
        return _web.json_response(await _run(_more_add_body, q.get("id"), blob, q.get("name") or "", None, q.get("memo"), q.get("t")))

    @_routes.post("/leiel_idea/merge")
    async def _idea_merge(request):
        data = await _json(request)
        return _web.json_response(await _run(_merge_body, data.get("ids")))

    @_routes.post("/leiel_idea/more_set")
    async def _idea_more_set(request):
        data = await _json(request)
        return _web.json_response(await _run(_more_set_body, data.get("id"), data.get("file"), data.get("more")))

    @_routes.post("/leiel_idea/brief_files")
    async def _idea_brief_files(request):
        data = await _json(request)
        return _web.json_response(await _run(_brief_files_body, data.get("ids"), data.get("title")))

    @_routes.post("/leiel_idea/capture")
    async def _idea_capture(request):
        data = await _json(request)
        return _web.json_response(await _run(_capture_body, data.get("id")))

    @_routes.get("/leiel_idea/picture")
    async def _idea_picture(request):
        q = request.rel_url.query
        hit = await _run(_picture_body, q.get("id"), q.get("s"), q.get("v"))
        if not hit:
            return _web.Response(status=404)
        kind, body = hit
        if kind == "file":
            # said outright: Windows does not always know .webp, and a picture
            # sent as "octet-stream" is not taken as a picture elsewhere
            ctype = _MIME.get(os.path.splitext(body)[1].lower(), "application/octet-stream")
            return _web.FileResponse(body, headers={"Cache-Control": "max-age=86400",
                                                    "Content-Type": ctype})
        return _web.Response(body=body, content_type="image/jpeg",
                             headers={"Cache-Control": "max-age=86400"})
except Exception:                                    # pragma: no cover
    pass


class LeielIdeaBox:
    """The ideas kept for later. It takes nothing and returns nothing, and is
    never run: everything happens in the node itself."""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {}}

    RETURN_TYPES = ()
    FUNCTION = "noop"
    CATEGORY = "Studio Leiel"
    DESCRIPTION = (
        "A box for ideas seen anywhere - pictures dropped from the browser, "
        "screenshots pasted or saved into its inbox folder, lines of text. "
        "Kept in a second, sorted later with a line and a folder, found again "
        "by search or shuffle, and handed to the Series Book to start a series."
    )

    def noop(self):
        return ()


NODE_CLASS_MAPPINGS = {
    "LeielIdeaBox": LeielIdeaBox,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "LeielIdeaBox": "Visual Idea Box (Studio Leiel)",
}
