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
        this.graph = graph;
        this.inputs = graph.inputs;
        this.outputs = graph.outputs;
        this.level = level;
        this.nodes = [];

        this.stack_regex = /([\w\/]*[layerlist]*)\.([\d]*)(\/[\w\/]*)/gm;
        this.analyze_graph();

        // set_group_schema
        var hierarchy_groups = new Map();
        for (const node of graph.nodes) {
            // console.log(node);
            var hierarchy_name = this.get_hierarchy_name(node.name, level);

            if (!hierarchy_groups.has(hierarchy_name)) {
                hierarchy_groups.set(hierarchy_name, new Array());
            }
            hierarchy_groups.get(hierarchy_name).push(node);
        }
        // console.log(hierarchy_groups)

        // group_nodes_with_same_hierarchy
        for (let [hierarchy_name, group_nodes] of hierarchy_groups) {
            this.nodes.push(new hierarchy.Node(hierarchy_name, group_nodes));
        }
    }

    analyze_graph() {
        var max_layer_id = 0;
        this.max_hierarchy_level = 0;
        this.stack_layer_num = 0;
        this.stack_node_patterns = new Set();
        this.non_stack_node_names = new Array();

        for (const node of this.graph.nodes) {
            // console.log(node.name)
            var matches = this.stack_regex.exec(node.name);
            if (matches) {
                var layer_id = matches[2];
                max_layer_id = Math.max(max_layer_id, layer_id);

                var hierarchy_level = node.name.split("/").length;
                this.max_hierarchy_level = Math.max(this.max_hierarchy_level, hierarchy_level)

                var node_pattern = matches[1] + ".{i}" + matches[3];
                this.stack_node_patterns.add(node_pattern);
                this.stack_hierarchy_level = matches[1].split("/").length;
            } else {
                this.non_stack_node_names.push(node.name);
            }

            this.stack_layer_num = max_layer_id + 1
        }

        console.log("- stack_layer_num:", this.stack_layer_num);
        console.log("- stack_hierarchy_level:", this.stack_hierarchy_level);
        console.log("- max_hierarchy_level:", this.max_hierarchy_level);

        // const match = imageDescription.match(regexpSize);
        // console.log(`Width: ${match[1]} / Height: ${match[2]}.`);

    }


    get_hierarchy_name(name, level) {
        // TODO: eliminate pre/post nodes
        var delimiter = "/";
        const hierarchies = name.split(delimiter);
        const len = Math.min(hierarchies.length, level);
        const hierarchy_name = hierarchies.slice(0, len).join(delimiter);

        return hierarchy_name;
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