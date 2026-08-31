"""Everything the Series Lab node decides, kept free of ComfyUI imports.

Separating it this way means the parts that can be wrong in a quiet, invisible
way - which LoRA is active, which trigger words survive, which configuration
comes next - can be tested on their own.
"""

STYLE = "style"
PLUS = "plus"
MODEL = "model"
OFF = "off"
TIERS = (STYLE, PLUS, MODEL, OFF)

ESSENTIAL = "essential"
COMBINED = "combined"
FULL = "full"
MODES = (ESSENTIAL, COMBINED, FULL)


# --------------------------------------------------------------------------
# reading what the loader is holding
# --------------------------------------------------------------------------

def parse_lora_text(text):
    """Pull (name, strength) out of a loader's lora text.

    Accepts the angle-bracket form the LoRA loaders write, and also a plain
    'name:strength' per line, so a list typed by hand still works.
    """
    out = []
    seen = set()
    s = str(text or "")

    i = 0
    while True:
        a = s.find("<", i)
        if a < 0:
            break
        b = s.find(">", a)
        if b < 0:
            break
        body = s[a + 1:b]
        i = b + 1
        parts = body.split(":")
        if len(parts) < 2 or parts[0].strip().lower() != "lora":
            continue
        name = parts[1].strip()
        if not name:
            continue
        strength = 1.0
        if len(parts) >= 3:
            try:
                strength = float(parts[2].strip())
            except ValueError:
                strength = 1.0
        if name in seen:
            continue
        seen.add(name)
        out.append((name, strength))

    if out:
        return out

    # Only treat the text as a hand-typed list when it is not bracket syntax
    # at all. A single unclosed bracket used to reach here and be read as a
    # LoRA called "<lora".
    if "<lora" in s.lower():
        return out

    for line in s.replace(",", "\n").split("\n"):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        name, _, rest = line.partition(":")
        name = name.strip()
        if not name:
            continue
        try:
            strength = float(rest.strip()) if rest.strip() else 1.0
        except ValueError:
            strength = 1.0
        if name in seen:
            continue
        seen.add(name)
        out.append((name, strength))
    return out


def fmt_strength(x):
    """A strength as it should read in a file name: 1 becomes 1.0."""
    try:
        f = float(x)
    except (TypeError, ValueError):
        return str(x)
    if f == int(f):
        return "%.1f" % f
    return ("%f" % f).rstrip("0").rstrip(".")


def short_name(full):
    """The bit a person recognises: no folder, no extension."""
    s = str(full or "").replace("\\", "/")
    s = s.rsplit("/", 1)[-1]
    for ext in (".safetensors", ".ckpt", ".pt"):
        if s.lower().endswith(ext):
            s = s[: -len(ext)]
            break
    return s


def apply_assignments(loras, assignments):
    """Split the loader's LoRAs into the three tiers.

    assignments maps a LoRA name to a tier. Anything unassigned is left off,
    so a LoRA that appears in the loader after the node was set up cannot
    silently join a sweep.
    """
    tiers = {STYLE: [], PLUS: [], MODEL: []}
    for name, strength in loras:
        tier = assignments.get(name, OFF)
        if tier in tiers:
            tiers[tier].append((name, strength))
    return tiers


# --------------------------------------------------------------------------
# trigger words
# --------------------------------------------------------------------------

def split_triggers(text):
    out = []
    for chunk in str(text or "").replace("\n", ",").split(","):
        chunk = chunk.strip()
        if chunk:
            out.append(chunk)
    return out


def filter_triggers(trigger_text, trigger_map, active_names):
    """Keep only the trigger words belonging to the LoRAs in this render.

    The loader hands over the trigger words for everything on its list. During
    a sweep only one style LoRA is active at a time, so without this the words
    belonging to the five that are switched off keep steering every render and
    the comparison means nothing.

    A word that is not claimed by any LoRA is kept - it was typed by hand and
    belongs to the prompt, not to a LoRA.
    """
    words = split_triggers(trigger_text)
    if not trigger_map:
        return words

    owned = {}
    for lora, ws in trigger_map.items():
        for w in split_triggers(ws):
            owned.setdefault(w.lower(), set()).add(lora)

    active = set(active_names)
    kept = []
    for w in words:
        owners = owned.get(w.lower())
        if owners is None or (owners & active):
            kept.append(w)
    return kept


def merge_prompt(prompt, triggers, separator=", ", position="prepend"):
    """Trigger words lead by default: a LoRA trigger is an identity token and
    the encoder weighs the front of the text most heavily."""
    trig = separator.join(triggers).strip()
    body = str(prompt or "").strip()
    if not trig:
        return body
    if not body:
        return trig
    if position == "append":
        return body + separator + trig
    return trig + separator + body
