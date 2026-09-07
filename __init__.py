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

"""Visual Suite (Studio Leiel).

Six nodes that share one design language. Each one lives in its own package
under nodes/ and is loaded separately, so a node that fails to import - a
frontend change, a missing dependency - takes only itself down and the rest
of the suite still loads.

Everything under web/ is served from /extensions/<this folder>/, one
sub-folder per node.
"""

import importlib
import traceback

WEB_DIRECTORY = "./web"

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}

# Load order is only cosmetic: it decides the order of the console lines.
_MODULES = (
    "crop",
    "filename_manager",
    "prompt_composer",
    "series_lab",
    "latent_size_picker",
    "node_bag",
)

_loaded = []
_failed = []

for _name in _MODULES:
    try:
        _module = importlib.import_module(".nodes." + _name, __name__)
        NODE_CLASS_MAPPINGS.update(_module.NODE_CLASS_MAPPINGS)
        NODE_DISPLAY_NAME_MAPPINGS.update(_module.NODE_DISPLAY_NAME_MAPPINGS)
        _loaded.append(_name)
    except Exception:
        _failed.append(_name)
        print(f"[Visual Suite] '{_name}' failed to load and was skipped:")
        traceback.print_exc()

print(
    "[Visual Suite] %d node%s loaded from %d module%s"
    % (
        len(NODE_CLASS_MAPPINGS),
        "" if len(NODE_CLASS_MAPPINGS) == 1 else "s",
        len(_loaded),
        "" if len(_loaded) == 1 else "s",
    )
    + (" (%d skipped: %s)" % (len(_failed), ", ".join(_failed)) if _failed else "")
)

__all__ = [
    "NODE_CLASS_MAPPINGS",
    "NODE_DISPLAY_NAME_MAPPINGS",
    "WEB_DIRECTORY",
]
