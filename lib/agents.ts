import OpenAI from "openai";
import type { AgentProvider, AgentRole } from "@/lib/types";
import type { ShellResult } from "@/lib/shell";
import { shouldUseMockAgents } from "@/lib/config";
import { runShell } from "@/lib/shell";

interface AgentInput {
  role: AgentRole;
  provider: AgentProvider;
  model: string;
  prompt: string;
  taskId: string;
  workspacePath: string;
  round: number;
}

interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

function extractOutputText(response: unknown): string {
  const maybe = response as {
    output_text?: string;
    output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }>; text?: string }>;
  };
  if (maybe.output_text) {
    return maybe.output_text;
  }
  const chunks: string[] = [];
  for (const item of maybe.output || []) {
    if (item.text) {
      chunks.push(item.text);
    }
    for (const content of item.content || []) {
      if (content.type?.includes("text") && content.text) {
        chunks.push(content.text);
      }
    }
  }
  return chunks.join("\n").trim();
}

function extractFunctionCalls(response: unknown): Array<{ call_id: string; name: string; arguments: string }> {
  const maybe = response as {
    output?: Array<{ type?: string; call_id?: string; name?: string; arguments?: string }>;
  };
  return (maybe.output || [])
    .filter((item) => item.type === "function_call" && item.call_id && item.name)
    .map((item) => ({
      call_id: String(item.call_id),
      name: String(item.name),
      arguments: item.arguments || "{}"
    }));
}

function mockAgent(input: AgentInput): string {
  if (input.role === "researcher") {
    return [
      `Mock researcher round ${input.round} completed.`,
      "Evidence: target project is reachable in mock mode.",
      "Risk: real repository facts require MOCK_AGENTS=0 and shell inspection."
    ].join("\n");
  }
  if (input.role === "implementer") {
    return [
      `Mock implementer round ${input.round} completed.`,
      `No ${input.provider} API call was made because MOCK_AGENTS=1 or the mock provider is selected.`,
      "No implementation changes were made in mock mode."
    ].join("\n");
  }
  if (input.role === "tester") {
    return "Mock tester: no blocking issues found from the broker test brief. Continue to verifier.";
  }
  return JSON.stringify({
    decision: "pass",
    summary:
      "Mock verifier passed. Configure OPENAI_API_KEY and set MOCK_AGENTS=0 for live isolated Codex validation."
  });
}

function buildInstructions(input: AgentInput): string {
  return [
    `You are the ${input.role} agent in a local multi-agent coding harness.`,
    `Provider identity: ${input.provider}.`,
    "Respect the current task scope. Use run_shell only for commands relevant to this task.",
    "You are context-isolated from other agents. Trust only the prompt and your own tool observations.",
    "Do not claim that another agent said something unless it appears in a broker artifact in your prompt.",
    "Keep outputs concise and decision-oriented.",
    input.role === "verifier"
      ? 'Return a final JSON object with keys "decision" and "summary". decision must be pass, needs_fix, or blocked.'
      : ""
  ]
    .filter(Boolean)
    .join("\n");
}

async function runShellTool(input: AgentInput, call: ToolCall): Promise<ShellResult | { error: string }> {
  if (call.name !== "run_shell") {
    return { error: `Unknown tool: ${call.name}` };
  }
  const command = typeof call.arguments.command === "string" ? call.arguments.command : "";
  try {
    return await runShell({
      taskId: input.taskId,
      agentRole: input.role,
      command,
      cwd: input.workspacePath,
      workspacePath: input.workspacePath
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

async function runOpenAiAgent(input: AgentInput): Promise<string> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required for openai provider. Set MOCK_AGENTS=1 for local mock mode.");
  }
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const tools = [
    {
      type: "function",
      name: "run_shell",
      description:
        "Run a PowerShell command in the approved task workspace. Use this for inspection, tests, and verification.",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "PowerShell command to run."
          }
        },
        required: ["command"],
        additionalProperties: false
      }
    }
  ];

  const instructions = buildInstructions(input);

  let previousResponseId: string | undefined;
  let nextInput: unknown = input.prompt;

  for (let step = 0; step < 8; step += 1) {
    const response = await client.responses.create({
      model: input.model,
      instructions,
      input: nextInput as never,
      previous_response_id: previousResponseId,
      tools: tools as never
    });

    previousResponseId = response.id;
    const functionCalls = extractFunctionCalls(response);
    if (functionCalls.length === 0) {
      return extractOutputText(response) || JSON.stringify(response);
    }

    const toolOutputs: Array<{ type: "function_call_output"; call_id: string; output: string }> = [];
    for (const call of functionCalls) {
      if (call.name !== "run_shell") {
        toolOutputs.push({
          type: "function_call_output",
          call_id: call.call_id,
          output: JSON.stringify({ error: `Unknown tool: ${call.name}` })
        });
        continue;
      }
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.arguments) as Record<string, unknown>;
      } catch {
        args = {};
      }
      const result = await runShellTool(input, {
        id: call.call_id,
        name: call.name,
        arguments: args
      });
      toolOutputs.push({
        type: "function_call_output",
        call_id: call.call_id,
        output: JSON.stringify(result)
      });
    }
    nextInput = toolOutputs;
  }

  return JSON.stringify({
    decision: input.role === "verifier" ? "blocked" : undefined,
    summary: "Agent exceeded the maximum tool-call loop."
  });
}

export async function runAgent(input: AgentInput): Promise<string> {
  if (shouldUseMockAgents() || input.provider === "mock") {
    return mockAgent(input);
  }
  return runOpenAiAgent(input);
}
