import os
import argparse
import re
import logging
import onnx
from utils import (output2node,
                   get_group_inputs,
                   get_group_outputs,
                   remove_input_constant)

logging.basicConfig(level=logging.INFO)
LARGE_GRAPH_THRESH = 2000

# match: /transformer/block_list.0/attention/Constant_205
pattern = "([\w/]*[layerlist]*)\.([\d]*)(/[\w/]*)"

class hierarchyModel:
  def __init__(self, model_path):
    self.model = onnx.load(model_path, load_external_data=False)
    self.graph = self.model.graph

    self.analyse_graph()
    self.gen_name2module_map()

  def analyse_graph(self):
    '''get the following attributes for the given graph
      - stack_node_patterns
      - stack_layer_num
      - max_hierarchy_level (TODO)
      - head_tail_nodes (for convinient coding)
    '''
    max_layer_id = 0
    self.max_hierarchy_level = 0
    self.stack_node_patterns = set()
    self.head_tail_nodes = []
    for node in self.graph.node:
      ret = re.search(pattern, node.name)
      if ret:
        layer_id = int(ret.groups()[1])
        max_layer_id = max(max_layer_id, layer_id)
        hierarchy_level = len(node.name.split("/"))
        self.max_hierarchy_level = max(self.max_hierarchy_level, hierarchy_level)
        node_pattern = ret.groups()[0] + ".{i}" + ret.groups()[2]
        self.stack_node_patterns.add(node_pattern)
      else:
        self.head_tail_nodes.append(node.name)

    self.stack_layer_num = max_layer_id + 1
    logging.info(
      f"Analyzing done! Here is what I get:\n"
      f"  - stack_layer_num: {self.stack_layer_num}\n"
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

  def set_group_schema(self, level):
    hierarchy_nodes_preview = set()
    for node in self.graph.node:
      hierachies = node.name.split("/")
      hierarchy_name = "/".join(hierachies[:min(len(hierachies), level)])
      if "Constant" in node.name: continue
      hierarchy_nodes_preview.add(hierarchy_name)
    logging.info(f"level {level}, node num {len(hierarchy_nodes_preview)}")

    large_model_detected = False
    if len(hierarchy_nodes_preview) > LARGE_GRAPH_THRESH:
      logging.info("Large graph that may cause netron hang")
      large_model_detected = True

    if large_model_detected:
      # TODO: only collapse the stack 0, and keep the level of other stacks to layer/stack.X
      pass

  def group_nodes_with_same_hierarchy(self, level):
    hierarchy_group = dict()

    for node in self.graph.node:
      hierachies = node.name.split("/")
      hierarchy_name = "/".join(hierachies[:min(len(hierachies), level)])
      if hierarchy_name not in hierarchy_group.keys():
        hierarchy_group[hierarchy_name] = []
      hierarchy_group[hierarchy_name].append(node)

    # https://onnxruntime.ai/docs/extensions/add-op.html
    hierarchy_nodes = []
    for hierarchy_name in hierarchy_group.keys():
      nodes = hierarchy_group[hierarchy_name]
      group_inputs = get_group_inputs(nodes)
      group_outputs = get_group_outputs(nodes)
      grouped_node = onnx.helper.make_node(
                            op_type=hierarchy_name,
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
        inputs=self.graph.input,  # Graph input
        outputs=self.graph.output,  # Graph output
        initializer=self.graph.initializer,
    )
    # hierarchy_graph = remove_isolated_nodes(hierarchy_graph, self.name2module)

    model_def = onnx.helper.make_model(hierarchy_graph,
                                       producer_name="netron-hierarchy")

    return model_def

def parse_args():
  parser = argparse.ArgumentParser()
  parser.add_argument('-i', '--model-path', type=str,
                      help='path to load the model')
  parser.add_argument('-l', '--hierarchy-level', type=int,
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





