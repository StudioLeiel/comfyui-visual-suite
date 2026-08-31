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
