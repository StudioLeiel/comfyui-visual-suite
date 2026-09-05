"""Visual Prompt Composer.

The image reader lives in vlm.py and registers its own routes. It is imported
inside a try block on purpose: reading needs `transformers`, which the suite
does not require, and a machine without it should still get the composer. The
reader reports the missing dependency itself when the Read button is pressed,
so nothing is silently unavailable.
"""

import traceback

from .leiel_prompt import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS

try:
    from . import vlm
    vlm.register_routes()
except Exception:
    print("[Leiel Composer] the image reader failed to load; "
          "the composer itself is unaffected:")
    traceback.print_exc()

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
