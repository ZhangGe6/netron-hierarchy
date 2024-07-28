from transformers import AutoConfig, MODEL_MAPPING
from transformers.models.auto.auto_factory import _get_model_class

# model_name = "huggyllama/llama-7b"
# model_name = "baichuan-inc/Baichuan-7B"
model_name = "google-bert/bert-base-uncased"

config = AutoConfig.from_pretrained(model_name)
model_class = _get_model_class(config, MODEL_MAPPING)
model = model_class(config)
print(model)

# TODO: export the model as ONNX