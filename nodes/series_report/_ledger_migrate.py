"""One-time move of an old Series Report ledger (ledger.sqlite3, written by
1.5.x - 1.6.1) into the JSON files the report keeps now. Kept out of the
release build; it runs only where an old ledger is found."""
import json
import os
import sqlite3


def run(folder, files):
    old = os.path.join(folder, "ledger.sqlite3")
    if not os.path.isfile(old) or os.path.isfile(os.path.join(folder, files["rows"])):
        return False
    con = sqlite3.connect(old, timeout=15)
    con.row_factory = sqlite3.Row
    try:
        rows = []
        for r in con.execute("SELECT * FROM renders ORDER BY id"):
            d = dict(r)
            try:
                d["recipe"] = json.loads(d.get("recipe") or "{}")
            except ValueError:
                d["recipe"] = {}
            d.setdefault("away", 0)
            d.setdefault("carry", 0)
            rows.append(d)
        tables = {
            "rows": rows,
            "files": {r["path"]: [r["mtime"], r["fp"]] for r in con.execute("SELECT * FROM files")},
            "aliases": {r["name"]: r["same_as"] for r in con.execute("SELECT * FROM aliases")},
            "looks": {},
        }
        for r in con.execute("SELECT fp, v, data FROM looks"):
            try:
                look = json.loads(r["data"])
            except ValueError:
                continue
            look["_v"] = r["v"]
            tables["looks"][r["fp"]] = look
    finally:
        con.close()
    # rows last: its file is what says the move is done
    for name in ("files", "aliases", "looks", "rows"):
        path = os.path.join(folder, files[name])
        with open(path + ".tmp", "w", encoding="utf-8") as fh:
            json.dump(tables[name], fh, ensure_ascii=False, separators=(",", ":"))
        os.replace(path + ".tmp", path)
    try:
        os.replace(old, old + ".migrated")
    except OSError:
        pass
    print("[Visual Series Report] ledger moved to JSON: %d renders" % len(rows))
    return True
