const hierarchy = {};

hierarchy.Model = class {

    constructor(flat_model) {
        this.graphs = [];
        for (const graph of flat_model.graphs) {
            this.graphs.push(new hierarchy.Graph(graph));
        }
    }

    set_level(level) {
        for (const graph of this.graphs) {
            graph.set_level(level);
        }
    }

    build() {
        for (const graph of this.graphs) {
            graph.build();
        }
    }
};

hierarchy.Graph = class {

    constructor(graph) {
        this.graph = graph;
        this.inputs = graph.inputs;
        this.outputs = graph.outputs;
        this.nodes = [];

        this.analyze_graph();
        this.level = this.max_hierarchy_level;
        if (this.graph.nodes.length > 20) {
            // large graph detected. Use stack level to avoid hang
            this.level = this.stack_hierarchy_level;
        }
    }

    analyze_graph() {
        var max_layer_id = 0;
        this.max_hierarchy_level = 0;
        this.stack_layer_num = 0;
        this.stack_node_patterns = new Set();
        this.non_stack_node_names = new Array();

        const regexpSize = /([\w\/]*[layerlist]*)\.([\d]*)(\/[\w\/]*)/;
        for (const node of this.graph.nodes) {
            const matches = node.name.match(regexpSize);

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
        }
        this.stack_layer_num = max_layer_id + 1;

        console.log("- stack_layer_num:", this.stack_layer_num);
        console.log("- stack_hierarchy_level:", this.stack_hierarchy_level);
        console.log("- max_hierarchy_level:", this.max_hierarchy_level);
        // console.log("- non_stack_node_names:", this.non_stack_node_names);
    }

    set_level(level) {
        this.level = level;
    }

    build() {
        // pre-compute the node num in the specified level
        var nodes = new Set();
        for (const node of this.graph.nodes) {
            nodes.add(this.get_hierarchy_name(node.name, this.level));
        }
        var large_graph_detected = nodes.size > 20;
        if (large_graph_detected) {
            console.log("Level:", this.level, "node num:", nodes.size,
                        "It is a large graph that may cause netron hang. ",
                        "Only stack 0 is will be collapsed to avoid this.")
        }


        var stack_0_nodes = new Array();
        for (const name of this.stack_node_patterns) {
            stack_0_nodes.push(name.replace("{i}", "0"));
        }
        console.log(stack_0_nodes)

        var hierarchy_groups = new Map();
        for (const node of this.graph.nodes) {
            var hierarchy_name = "";
            // only collapse the stack 0, and keep the level of other stacks to layer/stack.X
            // console.log(large_graph_detected, node.name, stack_0_nodes.includes(node.name))
            if (large_graph_detected && stack_0_nodes.includes(node.name)) {
                hierarchy_name = this.get_hierarchy_name(node.name, this.level);
            } else {
                hierarchy_name = this.get_hierarchy_name(node.name, this.stack_hierarchy_level);
                // console.log(node.name, this.stack_hierarchy_level, hierarchy_name)
            }

            if (!hierarchy_groups.has(hierarchy_name)) {
                hierarchy_groups.set(hierarchy_name, new Array());
            }
            hierarchy_groups.get(hierarchy_name).push(node);
        }

        var use_num_map = new Map();
        for (const node of this.graph.nodes) {
            for (const inp of node.inputs) {
                for (const value of inp.value) {
                    var name = value.name;
                    if (!use_num_map.has(name)) {
                        use_num_map.set(name, 0);
                    }
                    use_num_map.set(name, use_num_map.get(name) + 1);
                }
            }
        }
        for (const output of this.graph.outputs) {
            var name = output.name;
            if (!use_num_map.has(name)) {
                use_num_map.set(name, 0);
            }
            use_num_map.set(name, use_num_map.get(name) + 1);
        }

        // console.log(use_num_map)
        // group_nodes_with_same_hierarchy
        for (let [hierarchy_name, group_nodes] of hierarchy_groups) {
            this.nodes.push(new hierarchy.Node(hierarchy_name, group_nodes, use_num_map));
        }
    }

    get_hierarchy_name(name, level) {
        if (this.non_stack_node_names.includes(name)) {
            return name;
        }

        var delimiter = "/";
        const hierarchies = name.split(delimiter);
        const len = Math.min(hierarchies.length, level);
        const hierarchy_name = hierarchies.slice(0, len).join(delimiter);

        return hierarchy_name;
    }
};

hierarchy.Node = class {

    constructor(name, nodes, use_num_map) {
        // squeeeze into a big node
        this.name = name;
        this.inputs = [];
        this.outputs = [];
        this.type = null;

        // for (const node of nodes) {
        //     this.inputs = this.inputs.concat(node.inputs);
        //     this.outputs = this.outputs.concat(node.outputs);
        // }
        this.inputs = this.get_group_inputs(nodes);
        this.outputs = this.get_group_outputs(nodes, use_num_map);
        if (nodes.length == 1) {
            this.type = nodes[0].type;
        } else {
            this.type = new hierarchy.NodeType(nodes, name);
        }
    }

    get_group_outputs(nodes, use_num_map) {
        var group_outputs = [];
        for (const node of nodes) {
            for (const input of node.inputs) {
                // console.log(input)
                for (const value of input.value) {
                    var name = value.name;
                    if (node.name == "/pooler/activation/Tanh") {
                        console.log(use_num_map.get(name));
                    }
                    use_num_map.set(name, use_num_map.get(name) - 1);
                }
            }
        }

        for (const node of nodes) {
            for (const output of node.outputs) {
                for (const value of output.value) {
                    var name = value.name;
                    if (use_num_map.get(name) > 0) {
                        group_outputs.push(output);
                    }
                }
            }
        }
        console.log(nodes);
        console.log(group_outputs)
        return group_outputs;
    }
        // get the inputs that are not the output of any node in group_nodes
        get_group_inputs(nodes) {
            console.log(nodes);
            var group_inputs = [];
            var outputs = [];
            for (const node of nodes) {
                for (const output of node.outputs) {
                    for (const value of output.value) {
                        outputs.push(value.name);
                    }
                }
            }
            // console.log(outputs);
            for (const node of nodes) {
                for (const input of node.inputs) {
                    // console.log(input.name, outputs.includes(input.name));
                    var is_group_input = false;
                    for (const value of input.value) {
                        // mark it as group_input if there are value that attach to external world
                        if (!(outputs.includes(value.name))) {
                            is_group_input = true;
                            break;
                        }
                    }

                    if (is_group_input) {
                        group_inputs.push(input);
                    }

                }
            }
            // console.log(group_inputs)

            return group_inputs;
        }

        // get the outputs that are not the inputs of any node in group_nodes
        get_group_outputs_v0(nodes) {
            var group_outputs = [];
            var inputs = [];
            for (const node of nodes) {
                for (const input of node.inputs) {
                    for (const value of input.value) {
                        inputs.push(value.name);
                    }
                }
            }

            // console.log(inputs);
            for (const node of nodes) {
                console.log(node)
                for (const output of node.outputs) {
                    var is_group_output = false;
                    for (const value of output.value) {
                        if (!(inputs.includes(value.name))) {
                            is_group_output = true;
                            break;
                        }
                    }

                    if (is_group_output) {
                        group_outputs.push(output);
                    }

                }
            }

            // for (const node of nodes) {
            //     for (const output of node.outputs) {
            //         if (!(inputs.includes(output.name))) {
            //             group_outputs.push(output);
            //         }
            //     }
            // }

            return group_outputs;
        }
};

hierarchy.NodeType = class {

    constructor(nodes, name) {
        this.name = name; // TODO: change to more readable one
    }
}


export const Model = hierarchy.Model;
export const Node = hierarchy.Node;