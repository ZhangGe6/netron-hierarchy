def output2node(graph, output):
  for node in graph.node:
    for i, out in enumerate(node.output):
      if out == output:
        return node, i

  return None, None

def get_group_op_type(group_nodes, hierarchy_name):
  if len(group_nodes) == 1:
    return group_nodes[0].op_type

  return hierarchy_name

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
  filtered_nodes = [node for node in nodes if "Constant" not in node.op_type]
  return filtered_nodes

def get_hierarchy_name(name, level, delimiter="/"):
  hierarchies = name.split(delimiter)
  hierarchy_name = delimiter.join(hierarchies[:min(len(hierarchies), level)])

  return hierarchy_name