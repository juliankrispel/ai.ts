import { z } from 'zod'
import { Output, Predictor, Program, setGlobalRequester } from "./lib";

import OpenAI from "openai";

export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  dangerouslyAllowBrowser: true,
});

console.log("Hello via Bun!");

/**
 * setting the requester globally (can be set / overridden per predictor)
 */
setGlobalRequester(async (text: string, systemPrompt: string) => {
  const res = await openai.chat.completions.create({
    model: "gpt-3.5-turbo",
    messages: [
      {
        role: "system",
        content: systemPrompt,
      },
      { role: "user", content: text },
    ],
  });

  return typeof res.choices[0].message.content === "string"
    ? res.choices[0].message.content
    : "";
});


async function example() {
  console.log("running simple");
  const output = new Output(
    z.object({
      answer: z.string(),
    })
  );

  const pipe = new Predictor({
    output,
  });

  const res = await pipe.forward("Who is Margareth Thatcher?");
  console.log(res);
}

example();
// runProgram()