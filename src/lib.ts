import { z } from "zod";
import { zodToTs, printNode } from "zod-to-ts";

export type Requester = (text: string, systemPrompt: string) => Promise<string>;

const hashString = (str: string, seed = 0) => {
  let h1 = 0xdeadbeef ^ seed,
    h2 = 0x41c6ce57 ^ seed;
  for (let i = 0, ch; i < str.length; i++) {
    ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);

  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
};

/**
 * Can be set on a library wide basis
 */
let globalRequester: Requester = async () => {
  throw new Error("Requester not implemented");
};

export function setGlobalRequester(r: Requester) {
  globalRequester = r;
}

export class Base {
  private requester: Requester = globalRequester;

  calls: { input: string; output: string }[] = [];

  constructor(requester?: Requester) {
    if (requester) {
      this.requester = requester;
    }
  }

  async request(input: string, systemPrompt: string) {
    const output = await this.requester(input, systemPrompt);
    this.calls.push({ input, output });
    return output;
  }
}

export class Output<S extends z.AnyZodObject> extends Base {
  schema: S;
  constructor(s: S, requester?: Requester) {
    super(requester);
    this.schema = s;
  }

  validate(data: string) {
    return this.schema.parse(data);
  }
}

interface BaseConfig {
  requester?: Requester;
}

interface Example {
  input: string;
  output: string;
}

type PredictorConfig<S extends z.AnyZodObject> = BaseConfig & {
  output: Output<S>;
  examples?: Example[];
};

export class Predictor<O extends z.AnyZodObject> extends Base {
  config: PredictorConfig<O>;
  examples: Example[] = [];
  constructor(config: PredictorConfig<O>) {
    super(config.requester);
    this.config = config;
    if (config.examples) {
      this.examples = config.examples;
    }
  }

  private systemPrompt() {
    let prompt = `You are an expert at turning any plain text into json that matches typescript types.
Respond with a json payload that matches the following typescript type exactly:
\`\`\`
\n${printNode(zodToTs(this.config.output.schema).node)}
\`\`\``;

    if (this.examples.length > 0) {
      prompt += `\n----\n\nHere are some examples:\n\n`;
      for (const example of this.examples) {
        prompt += `Input: ${example.input}\nOutput: ${example.output}\n\n`;
      }
    }
    return prompt;
  }

  async forward(prompt: string): Promise<z.infer<O>> {
    const res = await this.request(prompt, this.systemPrompt());
    return this.config.output.schema.parse(JSON.parse(res));
  }
}

interface ExecProps {
  predict: <O extends z.AnyZodObject>(conf: PredictorConfig<O>) => Predictor<O>;
  input: string;
}

export class Program<T extends unknown> {
  private exec: (props: ExecProps) => Promise<T>;
  private predictors: Predictor<any>[] = [];

  constructor(exec: (props: ExecProps) => Promise<T>) {
    this.exec = exec;
  }

  private addPredictor(predictor: Predictor<any>) {
    this.predictors.push(predictor);
  }

  async forward(input: string): Promise<T> {
    const predict = <O extends z.AnyZodObject>(
      predictProps: PredictorConfig<O>
    ) => {
      const predictor = new Predictor<O>(predictProps);
      this.addPredictor(predictor);
      return predictor;
    };

    const props = {
      input,
      predict,
    };
    return this.exec(props);
  }

  private get hash() {
    const exec = this.exec.toString().replace(/[\s\n\t]+/gi, "");
    const shapes = this.predictors.map((predictor) => {
      JSON.stringify(predictor.config.output.schema.shape);
    });
    return hashString(exec + shapes.join(""));
  }

  async train(
    /**
     * The number of examples that should be generated per Predictor
     */
    exampleCount: number,
    /**
     * Evaluates the output of the program
     * If the output is correct, return true.
     * Every corerect output will be used as an example for the Predictor
     */
    evaluate: (output: T) => Promise<boolean>
  ) {
    return {
      hash: this.hash,
    };
  }
}
