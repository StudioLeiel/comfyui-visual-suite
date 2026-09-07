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
