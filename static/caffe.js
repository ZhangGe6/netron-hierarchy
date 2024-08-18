
const caffe = {};

caffe.ModelFactory = class {

    match(context) {
        const identifier = context.identifier;
        const extension = identifier.split('.').pop().toLowerCase();
        if (extension === 'caffemodel') {
            context.type = 'caffe.pb';
            return;
        }
        if (identifier === 'saved_model.pbtxt' || identifier === 'saved_model.prototxt' ||
            identifier.endsWith('predict_net.pbtxt') || identifier.endsWith('predict_net.prototxt') ||
            identifier.endsWith('init_net.pbtxt') || identifier.endsWith('init_net.prototxt')) {
            return;
        }
        const tags = context.tags('pbtxt');
        if (tags.has('layer') || tags.has('layers')) {
            context.type = 'caffe.pbtxt';
        } else if (tags.has('net') || tags.has('train_net') || tags.has('net_param')) {
            context.type = 'caffe.pbtxt.solver';
        }
    }

    async open(context) {
        caffe.proto = await context.require('./caffe-proto');
        caffe.proto = caffe.proto.caffe;
        const openModel = async (context, netParameter) => {
            const metadata = await context.metadata('caffe-metadata.json');
            return new caffe.Model(metadata, netParameter);
        };
        const openNetParameterText = (context, identifier, content) => {
            let netParameter = null;
            try {
                const reader = content.read('protobuf.text');
                reader.field = function(tag, message) {
                    const type = message.constructor.name;
                    if (tag.endsWith('_param') && (type === 'LayerParameter' || type === 'V1LayerParameter' || type === 'V0LayerParameter')) {
                        message[tag] = caffe.ModelFactory._decodeText(reader);
                        return;
                    } else if (message.constructor.name.endsWith('Parameter') || message.constructor.name === 'ParamSpec') {
                        if (message[tag]) {
                            if (!Array.isArray(message[tag])) {
                                message[tag] = [message[tag]];
                            }
                            message[tag].push(this.read());
                        } else {
                            message[tag] = this.read();
                        }
                        return;
                    }
                    throw new Error(`Unknown field '${tag}' ${this.location()}`);
                };
                reader.enum = function(type) {
                    const token = this.token();
                    this.next();
                    this.semicolon();
                    if (!Object.prototype.hasOwnProperty.call(type, token)) {
                        const value = Number.parseInt(token, 10);
                        if (!Number.isNaN(token - value)) {
                            return value;
                        }
                        return token;
                    }
                    return type[token];
                };
                if (/MobileNetSSD_train_template.prototxt/.exec(identifier)) {
                    reader.integer = function() {
                        const token = this.token();
                        const value = Number.parseInt(token, 10);
                        this.next();
                        this.semicolon();
                        if (Number.isNaN(token - value)) {
                            return token;
                        }
                        return value;
                    };
                }
                netParameter = caffe.proto.NetParameter.decodeText(reader);
            } catch (error) {
                const message = error && error.message ? error.message : error.toString();
                throw new caffe.Error(`File text format is not caffe.NetParameter (${message.replace(/\.$/, '')}).`);
            }
            return openModel(context, netParameter);
        };
        switch (context.type) {
            case 'caffe.pbtxt.solver': {
                const reader = context.read('protobuf.text');
                reader.field = function(tag, message) {
                    if (message instanceof caffe.proto.SolverParameter) {
                        message[tag] = this.read();
                        return;
                    }
                    throw new Error(`Unknown field '${tag}'${this.location()}`);
                };
                const solver = caffe.proto.SolverParameter.decodeText(reader);
                if (solver.net_param) {
                    return openModel(context, solver.net_param);
                }
                let name = solver.net || solver.train_net;
                name = name.split('/').pop();
                try {
                    const content = await context.fetch(name);
                    return openNetParameterText(context, name, content);
                } catch (error) {
                    const message = error.message ? error.message : error.toString();
                    throw new caffe.Error(`Failed to load '${name}' (${message.replace(/\.$/, '')}).`);
                }
            }
            case 'caffe.pbtxt': {
                return openNetParameterText(context, context.identifier, context);
            }
            case 'caffe.pb': {
                let netParameter = null;
                try {
                    const reader = context.read('protobuf.binary');
                    netParameter = caffe.proto.NetParameter.decode(reader);
                } catch (error) {
                    const message = error && error.message ? error.message : error.toString();
                    throw new caffe.Error(`File format is not caffe.NetParameter (${message.replace(/\.$/, '')}).`);
                }
                return openModel(context, netParameter);
            }
            default: {
                throw new caffe.Error(`Unsupported Caffe format '${context.type}'.`);
            }
        }
    }

    static _decodeText(reader) {
        const message = {};
        reader.start();
        while (!reader.end()) {
            const tag = reader.tag();
            const value = reader.read();
            if (message[tag]) {
                if (!Array.isArray(message[tag])) {
                    message[tag] = [message[tag]];
                }
                message[tag].push(value);
            } else {
                message[tag] = value;
            }
        }
        return message;
    }
};

caffe.Model = class {

    constructor(metadata, net) {
        this.name = net.name;
        this.format = 'Caffe';
        this.graphs = [];
        let version = -1;
        if (net.layers && net.layers.length > 0) {
            if (net.layers.every((layer) => Object.prototype.hasOwnProperty.call(layer, 'layer'))) {
                version = 0;
                net.layer = net.layers;
            } else {
                version = 1;
                net.layer = net.layers;
            }
        } else if (net.layer && net.layer.length > 0) {
            version = 2;
        }
        this.format = `Caffe v${version}`;
        const phases = new Set();
        for (const layer of net.layer) {
            for (const include of layer.include) {
                if (include.phase !== undefined) {
                    phases.add(include.phase);
                }
            }
        }
        if (phases.size === 0) {
            phases.add(-1);
        }
        for (const phase of phases) {
            const graph = new caffe.Graph(metadata, phase, net, version);
            this.graphs.push(graph);
        }
    }
};

caffe.Graph = class {

    constructor(metadata, phase, net, version) {
        switch (phase) {
            case 0: this.name = 'TRAIN'; break;
            case 1: this.name = 'TEST'; break;
            case -1: this.name = ''; break;
            default: this.name = phase.toString(); break;
        }
        this.nodes = [];
        this.inputs = [];
        this.outputs = [];
        for (const layer of net.layer) {
            layer.input = layer.bottom.slice(0);
            layer.output = layer.top.slice(0);
            layer.chain = [];
        }
        const layers = [];
        for (const layer of net.layer) {
            if (phase === -1 || layer.include.every((include) => include.phase === phase)) {
                layers.push(layer);
            }
        }
        const scopes = new Map();
        let index = 0;
        for (const layer of layers) {
            layer.input = layer.input.map((input) => scopes.has(input) ? scopes.get(input) : input);
            layer.output = layer.output.map((output) => {
                const value = scopes.has(output) ? `${output}\n${index}` : output;
                scopes.set(output, value);
                return value;
            });
            index++;
        }
        // Graph Inputs
        const usedOutputs = new Set();
        for (const layer of layers) {
            for (const output of layer.output) {
                usedOutputs.add(output);
            }
        }
        const unusedInputs = [];
        for (const layer of layers) {
            for (const input of layer.input) {
                if (!usedOutputs.has(input)) {
                    unusedInputs.push(input);
                }
            }
        }
        const values = new Map();
        const value = (name, type) => {
            if (!values.has(name)) {
                values.set(name, new caffe.Value(name, type));
            } else if (type) {
                throw new caffe.Error(`Duplicate value '${name}'.`);
            }
            return values.get(name);
        };
        const nodes = [];
        let lastLayer = null;
        let lastTop = null;
        while (layers.length > 0) {
            let layer = layers.shift();
            if (layer.output.length === 1 && layer.input.length === 1 &&
                layer.output[0].split('\n').shift() === layer.input[0].split('\n').shift() &&
                lastLayer &&
                lastTop === layer.output[0].split('\n').shift()) {
                lastLayer.chain = lastLayer.chain || [];
                lastLayer.chain.push(layer);
            } else {
                if (layer.type === 'Input' && layer.input.length === 0) {
                    for (let i = 0; i < layer.output.length; i++) {
                        const output = layer.output[i];
                        const dim = layer.input_param && layer.input_param.shape && i < layer.input_param.shape.length ? layer.input_param.shape[i].dim : null;
                        const shape = dim ? new caffe.TensorShape(dim.map((dim) => dim.toNumber())) : null;
                        const type = shape ? new caffe.TensorType(null, shape) : null;
                        const argument = new caffe.Argument(output, [value(output, type)]);
                        this.inputs.push(argument);
                    }
                    layer = null;
                }
                if (layer) {
                    nodes.push(layer);
                    lastLayer = null;
                    lastTop = null;
                    if (layer.output.length === 1) {
                        lastLayer = layer;
                        lastTop = layer.output[0].split('\n').shift();
                    }
                }
            }
        }
        if (net.input) {
            for (let i = 0; i < net.input.length; i++) {
                const input = net.input[i];
                if (this.inputs.some((item) => item.name === input)) {
                    continue;
                }
                let inputType = null;
                if (net.input_shape && i < net.input_shape.length) {
                    const blobShape = net.input_shape[i];
                    if (blobShape && blobShape.dim) {
                        const shape = new caffe.TensorShape(blobShape.dim.map((dim) => dim.toNumber()));
                        inputType = new caffe.TensorType(null, shape);
                    }
                }
                const dim = i * 4;
                if (!inputType && net.input_dim && net.input_dim.length >= dim) {
                    const shape = new caffe.TensorShape(net.input_dim.slice(dim, dim + 4));
                    inputType = new caffe.TensorType(null, shape);
                }
                this.inputs.push(new caffe.Argument(input, [value(input, inputType, null)]));
            }
        }

        for (const layer of nodes) {
            const node = new caffe.Node(metadata, layer, version, value);
            if (layer.chain && layer.chain.length > 0) {
                for (const chain of layer.chain) {
                    node.chain.push(new caffe.Node(metadata, chain, version, value));
                }
            }
            this.nodes.push(node);
        }

        if (this.inputs.length === 0 && unusedInputs.length === 1) {
            this.inputs.push(new caffe.Argument(unusedInputs[0], [value(unusedInputs[0], null)]));
        }
    }
};

caffe.Argument = class {

    constructor(name, value, type, visible) {
        this.name = name;
        this.value = value;
        this.type = type || null;
        this.visible = visible !== false;
    }
};

caffe.Value = class {

    constructor(name, type, initializer) {
        if (typeof name !== 'string') {
            throw new caffe.Error(`Invalid value identifier '${JSON.stringify(name)}'.`);
        }
        this.name = name;
        this.type = type || null;
        this.initializer = initializer || null;
    }
};

caffe.Node = class {

    constructor(metadata, layer, version, value) {
        this.attributes = [];
        this.chain = [];
        let type = '';
        switch (version) {
            case 0: {
                this.name = layer.layer.name;
                type = layer.layer.type;
                break;
            }
            case 1: {
                this.name = layer.name;
                type = caffe.Utility.layerType(layer.type);
                break;
            }
            case 2: {
                this.name = layer.name;
                type = layer.type;
                break;
            }
            default: {
                throw new new caffe.Error(`Unsupported Caffe version '${version}'.`);
            }
        }
        this.type = metadata.type(type) || { name: type };
        let initializers = [];
        const attributes = [];
        switch (version) {
            case 0: {
                for (const name of Object.keys(layer.layer)) {
                    if (name !== 'type' && name !== 'name' && name !== 'blobs' && name !== 'blobs_lr') {
                        const value = layer.layer[name];
                        const schema = metadata.attribute(type, name);
                        attributes.push([schema, name, value]);
                    }
                }
                initializers = layer.layer.blobs.map((blob) => new caffe.Tensor(blob));
                break;
            }
            case 1:
            case 2: {
                for (const layer_kind of Object.keys(layer)) {
                    if (layer_kind.endsWith('_param') || layer_kind === 'transform_param') {
                        const param = layer[layer_kind];
                        if (type === 'Deconvolution') {
                            type = 'Convolution';
                        }
                        const prototype = Object.getPrototypeOf(param);
                        for (const name of Object.keys(param)) {
                            const defaultValue = prototype[name];
                            const value = param[name];
                            const schema = metadata.attribute(type, name);
                            attributes.push([schema, name, value, defaultValue]);
                        }
                    }
                }
                if (layer.include && layer.include.length > 0) {
                    const schema = metadata.attribute(type, 'include');
                    attributes.push([schema, 'include', layer.include]);
                }
                if (layer.exclude && layer.exclude.length > 0) {
                    const schema = metadata.attribute(type, 'exclude');
                    attributes.push([schema, 'exclude', layer.exclude]);
                }
                if (this.type === 'Data' && layer.input_param && layer.input_param.shape) {
                    const schema = metadata.attribute(type, 'shape');
                    attributes.push([schema, 'shape', layer.input_param.shape]);
                }
                initializers = layer.blobs.map((blob) => new caffe.Tensor(blob));
                break;
            }
            default: {
                throw new caffe.Error(`Unsupported Caffe version '${version}'.`);
            }
        }
        this.inputs = [];
        const inputs = layer.input.concat(initializers);
        let inputIndex = 0;
        if (this.type && this.type.inputs) {
            for (const inputDef of this.type.inputs) {
                if (inputIndex < inputs.length || inputDef.option !== 'optional') {
                    const count = inputDef.option === 'variadic' ? inputs.length - inputIndex : 1;
                    const values = inputs.slice(inputIndex, inputIndex + count).filter((input) => input !== '' || inputDef.option !== 'optional').map((input) => {
                        return input instanceof caffe.Tensor ? new caffe.Value('', input.type, input) : value(input, null, null);
                    });
                    const argument = new caffe.Argument(inputDef.name, values);
                    this.inputs.push(argument);
                    inputIndex += count;
                }
            }
        }
        this.inputs.push(...inputs.slice(inputIndex).map((input) => {
            return new caffe.Argument(inputIndex.toString(), [
                input instanceof caffe.Tensor ? new caffe.Value('', input.type, input) : value(input, null, null)
            ]);
        }));

        this.outputs = [];
        const outputs = layer.output;
        let outputIndex = 0;
        if (this.type && this.type.outputs) {
            for (const outputDef of this.type.outputs) {
                if (outputIndex < outputs.length) {
                    const count = (outputDef.option === 'variadic') ? (outputs.length - outputIndex) : 1;
                    const values = outputs.slice(outputIndex, outputIndex + count).map((output) => value(output, null, null));
                    const argument = new caffe.Argument(outputDef.name, values);
                    this.outputs.push(argument);
                    outputIndex += count;
                }
            }
        }
        this.outputs.push(...outputs.slice(outputIndex).map((output, index) => {
            return new caffe.Argument((outputIndex + index).toString(), [value(output, null, null)]);
        }));
        this.attributes = attributes.map(([metadata, name, value, defaultValue]) => {
            let visible = true;
            let type = null;
            if (metadata && metadata.type) {
                type = metadata.type;
            }
            if (value instanceof caffe.proto.BlobShape) {
                value = new caffe.TensorShape(value.dim.map((dim) => dim.toNumber()));
                type = 'shape';
            }
            if (metadata && metadata.visible === false) {
                visible = false;
            }
            if (metadata && metadata.default !== undefined) {
                defaultValue = metadata.default;
            }
            if (defaultValue !== undefined) {
                if (value === defaultValue) {
                    visible = false;
                } else if (Array.isArray(value) && Array.isArray(defaultValue)) {
                    if (value.length === defaultValue.length && value.every((item, index) => item === defaultValue[index])) {
                        visible = false;
                    }
                }
            }
            value = type ? caffe.Utility.enum(type, value) : value;
            return new caffe.Argument(name, value, type, visible);
        });
    }
};

caffe.Tensor = class {

    constructor(blob) {
        let shape = [];
        if (Object.prototype.hasOwnProperty.call(blob, 'num') &&
            Object.prototype.hasOwnProperty.call(blob, 'channels') &&
            Object.prototype.hasOwnProperty.call(blob, 'width') &&
            Object.prototype.hasOwnProperty.call(blob, 'height')) {
            if (blob.num !== 1) {
                shape.push(blob.num);
            }
            if (blob.channels !== 1) {
                shape.push(blob.channels);
            }
            if (blob.height !== 1) {
                shape.push(blob.height);
            }
            if (blob.width !== 1) {
                shape.push(blob.width);
            }
        } else if (Object.prototype.hasOwnProperty.call(blob, 'shape')) {
            shape = blob.shape.dim.map((dim) => Number(dim));
        }
        let dataType = '?';
        if (blob.data.length > 0) {
            dataType = 'float32';
            this.values = blob.data;
        } else if (blob.double_data.length > 0) {
            dataType = 'float64';
            this.values = blob.double_data;
        }
        this.category = 'Blob';
        this.encoding = '|';
        this.type = new caffe.TensorType(dataType, new caffe.TensorShape(shape));
    }
};

caffe.TensorType = class {

    constructor(dataType, shape) {
        this.dataType = dataType;
        this.shape = shape;
    }

    toString() {
        return (this.dataType || '?') + this.shape.toString();
    }
};

caffe.TensorShape = class {

    constructor(dimensions) {
        this.dimensions = dimensions;
    }

    toString() {
        return this.dimensions ? (`[${this.dimensions.map((dimension) => dimension.toString()).join(',')}]`) : '';
    }
};

caffe.Utility = class {

    static layerType(type) {
        type = type || 0;
        if (!caffe.Utility._layerTypeMap) {
            caffe.Utility._layerTypeMap = new Map();
            const known = { 'BNLL': 'BNLL', 'HDF5': 'HDF5', 'LRN': 'LRN', 'RELU': 'ReLU', 'TANH': 'TanH', 'ARGMAX': 'ArgMax', 'MVN': 'MVN', 'ABSVAL': 'AbsVal' };
            for (const key of Object.keys(caffe.proto.V1LayerParameter.LayerType)) {
                const value = caffe.proto.V1LayerParameter.LayerType[key];
                caffe.Utility._layerTypeMap.set(value, key.split('_').map((item) => known[item] || item.substring(0, 1) + item.substring(1).toLowerCase()).join(''));
            }
        }
        return caffe.Utility._layerTypeMap.has(type) ? caffe.Utility._layerTypeMap.get(type) : type.toString();
    }

    static enum(name, value) {
        let type = caffe.proto;
        const parts = name.split('.');
        while (type && parts.length > 0) {
            type = type[parts.shift()];
        }
        if (type) {
            caffe.Utility._enumKeyMap = caffe.Utility._enumKeyMap || new Map();
            if (!caffe.Utility._enumKeyMap.has(name)) {
                const map = new Map(Object.entries(type).map(([name, value]) => [value, name]));
                caffe.Utility._enumKeyMap.set(name, map);
            }
            const map = caffe.Utility._enumKeyMap.get(name);
            if (map.has(value)) {
                return map.get(value);
            }
        }
        return value;
    }
};

caffe.Error = class extends Error {

    constructor(message) {
        super(message);
        this.name = 'Error loading Caffe model.';
    }
};

export const ModelFactory = caffe.ModelFactory;
