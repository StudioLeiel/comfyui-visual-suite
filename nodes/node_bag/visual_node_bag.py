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

class VisualNodeBag:
    """A purely visual container.

    The bag never touches the graph: it stores the ids of the nodes dropped
    into it, collapses them, and lays them out inside its own rectangle. Links,
    widget values and execution order are left exactly as they were, so the
    backend has nothing to do here. This class exists only so ComfyUI knows the
    node type; all of the behaviour lives in web/visual_node_bag.js.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {}}

    RETURN_TYPES = ()
    FUNCTION = "noop"
    CATEGORY = "utils"
    DESCRIPTION = (
        "Holds other nodes as chips without changing the graph. Drag a node in "
        "to collapse it, drag it out to restore it."
    )

    def noop(self):
        return ()
