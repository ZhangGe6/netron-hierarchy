import copy
import onnx

def output2node(graph, output):
  for node in graph.node:
    for i, out in enumerate(node.output):
      if out == output:
        return node, i

  return None, None

def get_group_inputs(group_nodes):
  # get the inputs that are not the output of any node in group_nodes
  group_inputs = []
  outputs = []
  for node in group_nodes:
    outputs += node.output

  for node in group_nodes:
    for input in node.input:
      if input not in outputs:
        group_inputs.append(input)

  return group_inputs

def get_group_outputs(group_nodes):
  # get the outputs that are not the inputs of any node in group_nodes
  group_outputs = []
  inputs = []
  for node in group_nodes:
    inputs += node.input

  for node in group_nodes:
    for output in node.output:
      if output not in inputs:
        group_outputs.append(output)

  return group_outputs

# remove constant inputs for clearer visialization
def remove_input_constant(nodes):
  # for node in nodes:
  #   print(node.name, node.op_type)
  filtered_nodes = [node for node in nodes if "Constant" not in node.op_type]
  return filtered_nodes

def get_tail_outputs(graph):
    def collect_backtrack(input):
        if input not in input2nodes.keys(): # if the node has no child node
            tail_outputs.add(input)
            return

        node = input2nodes[input]
        if node in traversed_nodes: return  # if the node has been traversed
        traversed_nodes.append(node)

        for node in input2nodes[input]:
            for output in node.output:
                collect_backtrack(output)

    input2nodes = dict()
    for node in graph.node:
        for input in node.input:
            if not (input in input2nodes.keys()):
                input2nodes[input] = []
            input2nodes[input].append(node)

    tail_outputs = set()
    traversed_nodes = []
    for inp in graph.input:
        collect_backtrack(inp.name)
    # print(tail_outputs)
    return tail_outputs

def remove_isolated_nodes(graph, name2module):
    def collect_reverse_backtrack(output):
        if output not in output2node.keys(): return # if the node has no parent node
        node = output2node[output]
        if node in connected_nodes: return # if the node has been traversed
        connected_nodes.append(node)

        for input in node.input:
            collect_reverse_backtrack(input)

    output2node = dict()
    for node in graph.node:
        for output in node.output:
            output2node[output] = node


    connected_nodes = []
    model_tail_outputs = get_tail_outputs(graph)
    for output in model_tail_outputs:
        collect_reverse_backtrack(output)

    graph_connected_nodes = []
    graph_connected_initializers = []
    # The initializer could be shared by multiple nodes. We should check
    # whether the initializer has been added to the initializer list before adding it.
    visited_initializer_names = set()
    for node in graph.node:
        if node in connected_nodes:
            # graph_connected_nodes.append(copy.deepcopy(self.node_name2module[node.name]))
            graph_connected_nodes.append(copy.deepcopy(name2module[node.name]))
            # for inp in node.input:
            #     if inp in self.initializer_name2module.keys() and inp not in visited_initializer_names:
            #         graph_connected_initializers.append(copy.deepcopy(self.initializer_name2module[inp]))
            #         visited_initializer_names.add(inp)
    del graph.node[:]
    # del self.initializer[:]
    graph.node.extend(graph_connected_nodes)
    # self.initializer.extend(graph_connected_initializers)
    # self.need_topsort = True

    return graph

