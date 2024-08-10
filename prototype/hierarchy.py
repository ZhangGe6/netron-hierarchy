import os
import argparse
import re
import logging
import onnx
from utils import *

logging.basicConfig(level=logging.INFO)
LARGE_GRAPH_THRESH = 2000

# TODO: handle nodes without "/" in names
# match: /transformer/block_list.0/attention/Constant_205
pattern = "([\w/]*[layerlist]*)\.([\d]*)(/[\w/]*)"

class hierarchyModel:
  def __init__(self, model_path):
    self.model = onnx.load(model_path, load_external_data=False)
    self.graph = self.model.graph

    self.analyse_graph()
    self.gen_name2module_map()

  def analyse_graph(self):
    max_layer_id = 0
    self.max_hierarchy_level = 0
    self.stack_node_patterns = set()
    self.non_stack_node_names = list()
    for node in self.graph.node:
      ret = re.search(pattern, node.name)
      if ret:
        layer_id = int(ret.groups()[1])
        max_layer_id = max(max_layer_id, layer_id)
        hierarchy_level = len(node.name.split("/"))
        self.max_hierarchy_level = max(self.max_hierarchy_level, hierarchy_level)
        node_pattern = ret.groups()[0] + ".{i}" + ret.groups()[2]
        self.stack_node_patterns.add(node_pattern)
        self.stack_hierarchy_level = len(ret.groups()[0].split("/"))
      else:
        self.non_stack_node_names.append(node.name)

    self.stack_layer_num = max_layer_id + 1
    logging.info(
      f"Analyzing done! Here is what I get:\n"
      f"  - stack_layer_num: {self.stack_layer_num}\n"
      f"  - stack_hierarchy_level: {self.stack_hierarchy_level}\n"
      f"  - max_hierarchy_level: {self.max_hierarchy_level}"
    )

  def gen_name2module_map(self):
      # node name => node
      self.name2module = dict()
      for node in self.graph.node:
        self.name2module[node.name] = node

      for inp in self.graph.input:
        self.name2module[inp.name] = inp

      for out in self.graph.output:
        # add `out_` in case the output has the same name with the last node
        self.name2module["out_" + out.name] = out

  def get_hierarchy_name(self, name, level, delimiter="/"):
    if name in self.non_stack_node_names:
      return name

    hierarchies = name.split(delimiter)
    hierarchy_name = delimiter.join(hierarchies[:min(len(hierarchies), level)])

    return hierarchy_name

  def set_group_schema(self, level):
    # pre-compute the node num in the specified level
    hierarchy_groups = set()
    for node in self.graph.node:
      if "Constant" in node.name: continue
      hierarchy_name = self.get_hierarchy_name(node.name, level)
      hierarchy_groups.add(hierarchy_name)

    large_graph_detected = len(hierarchy_groups) > LARGE_GRAPH_THRESH
    if large_graph_detected:
      logging.info(f"Level {level}, node num {len(hierarchy_groups)}. "
                   f"It is a large graph that may cause netron hang. "
                   f"Only stack 0 is will be collapsed to avoid this.")

    stack_0_nodes = [name.replace("{i}", "0") for name in self.stack_node_patterns]
    hierarchy_groups = dict()
    for node in self.graph.node:
      if "Constant" in node.name: continue
      # only collapse the stack 0, and keep the level of other stacks to layer/stack.X
      if large_graph_detected and node.name not in stack_0_nodes:
        hierarchy_name = self.get_hierarchy_name(node.name, self.stack_hierarchy_level)
      else:
        hierarchy_name = self.get_hierarchy_name(node.name, level)

      if hierarchy_name not in hierarchy_groups.keys():
        hierarchy_groups[hierarchy_name] = []
      hierarchy_groups[hierarchy_name].append(node)

    return hierarchy_groups

  def group_nodes_with_same_hierarchy(self, level):
    hierarchy_groups = self.set_group_schema(level)

    # https://onnxruntime.ai/docs/extensions/add-op.html
    hierarchy_nodes = []
    for hierarchy_name in hierarchy_groups.keys():
      nodes = hierarchy_groups[hierarchy_name]
      # TODO: why are the nodes in netron uncolored?
      group_op_type = get_group_op_type(nodes, hierarchy_name)
      group_inputs = get_group_inputs(nodes)
      group_outputs = get_group_outputs(nodes)

      grouped_node = onnx.helper.make_node(
                            op_type=group_op_type,
                            inputs=group_inputs,
                            outputs=group_outputs,
                            name=hierarchy_name,
                            domain='netron.hierarchy')
      hierarchy_nodes.append(grouped_node)

    return hierarchy_nodes

  def build_model(self, hierarchy_level):
    grouped_nodes = self.group_nodes_with_same_hierarchy(hierarchy_level)
    grouped_nodes = remove_input_constant(grouped_nodes)
    logging.info(f"Building model with {len(grouped_nodes)} nodes")

    hierarchy_graph = onnx.helper.make_graph(
        nodes=grouped_nodes,
        name="hierarchy_" + str(hierarchy_level),
        inputs=self.graph.input,
        outputs=self.graph.output,
        initializer=self.graph.initializer,
    )

    model_def = onnx.helper.make_model(hierarchy_graph,
                                       producer_name="netron-hierarchy")

    return model_def

def parse_args():
  parser = argparse.ArgumentParser()
  parser.add_argument('-i', '--model-path', type=str,
                      help='path to load the model')
  parser.add_argument('-l', '--hierarchy-level', type=int, required=True,
                      help='specify which level of hierarchy to export')
  parser.add_argument('-o', '--output-path', type=str, default=None,
                      help='path to save the result model')

  args = parser.parse_args()
  return args


if __name__ == "__main__":
  args = parse_args()
  if not args.model_path.endswith(".onnx"):
    raise RuntimeError("Only ONNX models are supported now!")

  model = hierarchyModel(args.model_path)
  hierarchy_model = model.build_model(args.hierarchy_level)

  output_path = args.output_path
  if args.output_path is None:
    path_base, ext = os.path.splitext(args.model_path)
    output_path = path_base + f"_hierarchy_{str(args.hierarchy_level)}" + ext

  onnx.save(hierarchy_model, output_path)





