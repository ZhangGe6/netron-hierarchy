# Introduction

[netron](https://github.com/lutzroeder/netron) is great. However, it struggles for models with a large number of nodes. Too much time is consumed for graph rendering, which causes the visualization to get stuck.

<center>
 <img src="./docs/netron_stuck.png" style="zoom:60%;" />
</center>

Then [netron-hierarchy](https://github.com/ZhangGe6/netron-hierarchy) comes to help. `netron-hierarchy` is based on the observation that deep learning models can be views in a hierarchy way. More specifically:

1. Deep learning models are generally stacks of the same blocks;
2. Each block is composed of several high-level layers, like `Attention`, `LayerNorm`;
3. ...
4. In the most fine-grained view, each layer is composed of "atomic" modules, such as `Linear`, and `Add`.

The higher the hierarchy is, the coarser the node grainity is. From the higher hierarchy, we can view the model topology from an overview perspective, and most importantly, the number of nodes is reduced dramatically, relieving the stress of graph rendering.

`netron-hierarchy` is built based on netron. Hope it helps!


# Get started
Clone the repo and launch the application
```bash
git clone https://github.com/ZhangGe6/netron-hierarchy.git
cd netron-hierarchy

python package.py build start --browse
```
Then `netron-hierarchy` will be hosted in `http://localhost:8080` automatically in the web browser.


# Usage

Take the [LlamaV2_7B_float16.onnx](https://huggingface.co/alpindale/Llama-2-7b-ONNX/resolve/main/FP16/LlamaV2_7B_float16.onnx?download=true) as example (Yes, LLM models can be opened!), the following images show the model graph of hierarchy 2 and 3, respectively. Hitting the "+" or "-" to switch hierarchy levels.

<img src="./docs/llama_level_2.png" />

<img src="./docs/llama_level_3.png"  />