"""Built-in resolution tables for the Random Latent Size Picker.

Each model family holds a single flat list of (width, height) pairs.
Orientation presets (landscape / portrait / square) are derived at runtime
from the aspect ratio, so only one list per family has to be maintained.

Sources for the built-in numbers:
  krea2    - Krea 2 supports 1K-2K output, dimensions in multiples of 16.
             The list keeps the four sizes that were already in use and
             extends them to full ratio coverage at a matching ~1.6 MP.
  z-image  - Official bucket list from the Tongyi-MAI Z-Image-Turbo space
             (1024 band).
  flux     - Standard 1 MP FLUX buckets.
  boogu    - Boogu-Image 0.1 is most stable at 1K; ratio set from the
             model card (1:1, 4:3, 3:2, 16:9, 2:1 and mirrors).
  hidream  - The seven resolutions accepted by HiDream-I1.
  sdxl     - The SDXL training bucket list (0.5 to 3.0 ratio).
  sd1.5    - Common 512-based sizes.
"""

CUSTOM_FAMILY = "custom size"

MODEL_FAMILIES = [
    "krea2",
    "z-image",
    "flux",
    "boogu",
    "hidream",
    "sdxl",
    "sd1.5",
    CUSTOM_FAMILY,
]

MODEL_SIZES = {
    "krea2": [
        (1280, 1280),
        (1408, 1152),
        (1152, 1408),
        (1472, 1088),
        (1088, 1472),
        (1536, 1024),
        (1024, 1536),
        (1600, 960),
        (960, 1600),
        (1680, 944),
        (944, 1680),
        (1920, 816),
        (816, 1920),
    ],
    "z-image": [
        (1024, 1024),
        (1152, 896),
        (896, 1152),
        (1152, 864),
        (864, 1152),
        (1248, 832),
        (832, 1248),
        (1280, 720),
        (720, 1280),
        (1344, 576),
        (576, 1344),
    ],
    "flux": [
        (1024, 1024),
        (1152, 896),
        (896, 1152),
        (1216, 832),
        (832, 1216),
        (1344, 768),
        (768, 1344),
        (1536, 640),
        (640, 1536),
    ],
    "boogu": [
        (1024, 1024),
        (1152, 864),
        (864, 1152),
        (1216, 832),
        (832, 1216),
        (1344, 768),
        (768, 1344),
        (1408, 704),
        (704, 1408),
    ],
    "hidream": [
        (1024, 1024),
        (1168, 880),
        (880, 1168),
        (1248, 832),
        (832, 1248),
        (1360, 768),
        (768, 1360),
    ],
    "sdxl": [
        (704, 1408),
        (704, 1344),
        (768, 1344),
        (768, 1280),
        (832, 1216),
        (832, 1152),
        (896, 1152),
        (896, 1088),
        (960, 1088),
        (960, 1024),
        (1024, 1024),
        (1024, 960),
        (1088, 960),
        (1088, 896),
        (1152, 896),
        (1152, 832),
        (1216, 832),
        (1280, 768),
        (1344, 768),
        (1344, 704),
        (1408, 704),
        (1472, 704),
        (1536, 640),
        (1600, 640),
        (1664, 576),
        (1728, 576),
    ],
    "sd1.5": [
        (512, 512),
        (640, 640),
        (576, 768),
        (768, 576),
        (512, 768),
        (768, 512),
        (512, 896),
        (896, 512),
        (448, 832),
        (832, 448),
    ],
    CUSTOM_FAMILY: [],
}

# Written to the JSON store the first time it is created, so the custom
# family is never empty on a fresh install.
DEFAULT_CUSTOM_SIZES = [
    (1536, 1024),
    (1472, 1088),
    (1600, 960),
    (1408, 1152),
    (1024, 1536),
    (1088, 1472),
    (960, 1600),
    (1152, 1408),
    (1280, 1280),
]

RESOLUTION_PRESETS = ["landscape", "portrait", "square", "all", "custom"]

# Values written by older versions of this node, mapped onto the new names so
# that a workflow saved before the rewrite still resolves to something sane.
LEGACY_PRESET_ALIASES = {
    "Landscape": "landscape",
    "Portrait": "portrait",
    "Square": "square",
    "ALL": "all",
    "All": "all",
    "Custom_List": "custom",
}


def normalize_preset(preset):
    if preset in RESOLUTION_PRESETS:
        return preset
    return LEGACY_PRESET_ALIASES.get(preset, "all")


def orientation_of(width, height):
    if width > height:
        return "landscape"
    if width < height:
        return "portrait"
    return "square"


def filter_by_preset(sizes, preset):
    preset = normalize_preset(preset)
    if preset in ("all", "custom"):
        return list(sizes)
    return [wh for wh in sizes if orientation_of(*wh) == preset]


def sort_by_ratio(sizes):
    return sorted(sizes, key=lambda wh: (wh[0] / wh[1], wh[0], wh[1]))


def format_ratio(width, height):
    ratio = "%.2f" % (width / height)
    if ratio.endswith("0"):
        ratio = ratio[:-1]
    return ratio


def format_size(width, height):
    return "%d\u00d7%d (%s)" % (width, height, format_ratio(width, height))


def parse_size(text):
    """Parse one entry. Accepts '1536x1024', '1536,1024', '1536x1024 (1.5)'."""
    if not text:
        return None

    digits = []
    current = ""
    for char in str(text):
        if char.isdigit():
            current += char
            continue
        if current:
            digits.append(current)
            current = ""
        if char == "(":
            break
    if current:
        digits.append(current)

    if len(digits) < 2:
        return None

    try:
        width = int(digits[0])
        height = int(digits[1])
    except ValueError:
        return None

    if width < 64 or height < 64:
        return None
    if width > 16384 or height > 16384:
        return None

    return (width, height)


def parse_size_list(text):
    """Parse a free-form list. Entries split on newlines, '|' or ';'."""
    if not text:
        return []

    normalized = str(text).replace("|", "\n").replace(";", "\n")
    parsed = []
    for line in normalized.split("\n"):
        size = parse_size(line.strip())
        if size and size not in parsed:
            parsed.append(size)
    return parsed


def all_sizes(custom_sizes=None):
    """Every built-in size plus the stored custom ones, deduplicated."""
    collected = []
    for family in MODEL_FAMILIES:
        for size in MODEL_SIZES.get(family, []):
            if size not in collected:
                collected.append(size)

    for size in custom_sizes or []:
        size = tuple(size)
        if size not in collected:
            collected.append(size)

    return sort_by_ratio(collected)


def all_labels(custom_sizes=None):
    return [format_size(w, h) for w, h in all_sizes(custom_sizes)]


def get_family_sizes(family, custom_sizes=None):
    if family == CUSTOM_FAMILY:
        return list(custom_sizes or [])
    return list(MODEL_SIZES.get(family, []))
