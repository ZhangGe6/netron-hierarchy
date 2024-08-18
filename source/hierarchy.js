const hierarchy = {};

hierarchy.Model = class {

    constructor(flat_model, level) {
        this.graphs = [];
        for (const graph of flat_model.graphs) {
            this.graphs.push(new hierarchy.Graph(graph, level));
        }
    }
};

hierarchy.Graph = class {

    constructor(graph, level) {
        this.inputs = graph.inputs;
        this.outputs = graph.outputs;
        this.level = level;
        this.nodes = [];

        // set_group_schema
        var hierarchy_groups = new Map();
        for (const node of graph.nodes) {
            // console.log(node);
            // eliminate pre/post nodes
            var delimiter = "/";
            const hierarchies = node.name.split(delimiter);
            const len = Math.min(hierarchies.length, level);
            const hierarchy_name = hierarchies.slice(0, len).join(delimiter);

            if (!hierarchy_groups.has(hierarchy_name)) {
                hierarchy_groups.set(hierarchy_name, new Array());
            }
            hierarchy_groups.get(hierarchy_name).push(node);
        }
        console.log(hierarchy_groups)

        // group_nodes_with_same_hierarchy
        for (let [hierarchy_name, group_nodes] of hierarchy_groups) {
            this.nodes.push(new hierarchy.Node(hierarchy_name, group_nodes));
        }
    }
};

hierarchy.Node = class {

    constructor(name, nodes) {
        // squeeeze into a big node
        this.name = name;
        this.inputs = [];
        this.outputs = [];
        this.type = null;

        for (const node of nodes) {
            this.inputs = this.inputs.concat(node.inputs);
            this.outputs = this.outputs.concat(node.outputs);
        }
        if (nodes.length == 1) {
            this.type = nodes[0].type;
        } else {
            this.type = new hierarchy.NodeType(nodes);
        }
    }
};

hierarchy.NodeType = class {

    constructor(nodes) {
        this.name = "hierarchy"; // TODO: change to more readable one
    }
}


export const Model = hierarchy.Model;
export const Node = hierarchy.Node;