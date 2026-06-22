import { level1Doc, level1Graph, level2Doc, level2Graph } from "../../graph/sampleWorkflow";
import type { QuestLevel } from "./types";

const level1: QuestLevel = {
  id: "level1",
  title: "An HTTP endpoint",
  tagline: "GET /hello/:name",
  goal: level1Graph,
  doc: level1Doc,
  stages: ["Trigger", "Transform", "Respond", "Run"],
  input: { label: "name", placeholder: "world", initial: "world" },
  result: (input) => ({ label: "200 OK", value: { message: `Hello, ${input || "world"}!` } }),
  steps: [
    { id: "s1", stage: 0, kind: "place", placeNode: "in", narration: "Every workflow starts with a trigger. Add the HTTP request that opens the route." },
    { id: "s2", stage: 1, kind: "place", placeNode: "msg", narration: "Now do something with the request. Add a string template to build a greeting." },
    { id: "s3", stage: 1, kind: "wire", wireEdge: "e1", narration: "Wire the request's params into the template. A value wire carries one resolved value.", hint: "Click the glowing Template node to draw the wire." },
    { id: "s4", stage: 2, kind: "place", placeNode: "body", narration: "Shape the response body. Add an object builder with a message field." },
    { id: "s5", stage: 2, kind: "wire", wireEdge: "e2", narration: "Feed the rendered string into the body's message field." },
    { id: "s6", stage: 2, kind: "place", placeNode: "out", narration: "Send it back. Add the HTTP response out-gate." },
    { id: "s7", stage: 3, kind: "wire", wireEdge: "e3", narration: "Wire the built object into the response body. Your endpoint is complete." },
    { id: "s8", stage: 3, kind: "run", narration: "That is a real endpoint. Run it and watch the data flow." },
  ],
};

const level2: QuestLevel = {
  id: "level2",
  title: "A streaming agent",
  tagline: "POST /ask",
  goal: level2Graph,
  doc: level2Doc,
  stages: ["Trigger", "Agent", "Run", "Stream"],
  input: { label: "question", placeholder: "Ask anything", initial: "What is Pattern?" },
  result: (input) => ({
    label: "200 OK · text/event-stream",
    value: { streaming: true },
    streamed: input.toLowerCase().includes("pattern")
      ? "Pattern is a workflow engine. You wire typed ops into a graph and it runs."
      : "Sure. Here is a concise, streamed answer to your question.",
  }),
  steps: [
    { id: "s1", stage: 0, kind: "place", placeNode: "in", narration: "Start with a trigger. Add the POST /ask request." },
    { id: "s2", stage: 1, kind: "place", placeNode: "agent", narration: "Define an agent: a name, instructions, and a model. It is a value you can pass around." },
    { id: "s3", stage: 2, kind: "place", placeNode: "run", narration: "Add the runner. It takes an agent and an input and produces a live event stream." },
    { id: "s4", stage: 2, kind: "wire", wireEdge: "e2", narration: "Wire the agent into the runner.", hint: "Click the glowing Run agent node to draw the wire." },
    { id: "s5", stage: 2, kind: "wire", wireEdge: "e1", narration: "Feed the request body in as the agent's input." },
    { id: "s6", stage: 3, kind: "place", placeNode: "out", narration: "Stream the answer back. Add the response, in server-sent-events mode." },
    { id: "s7", stage: 3, kind: "wire", wireEdge: "e3", narration: "Wire the runner's events into the response. This is a stream wire: tokens flow through it live." },
    { id: "s8", stage: 3, kind: "run", narration: "Run it and watch the tokens stream out along the violet wire." },
  ],
};

export const LEVELS: QuestLevel[] = [level1, level2];
