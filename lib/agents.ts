import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import OpenAI from "openai";
import type { AgentProvider, AgentReasoningEffort, AgentRole, AgentServiceTier } from "@/lib/types";
import type { ShellResult } from "@/lib/shell";
import { shouldUseMockAgents } from "@/lib/config";
import { insertShellLog } from "@/lib/db";
import { runShell } from "@/lib/shell";

interface AgentInput {
  role: AgentRole;
  provider: AgentProvider;
  model: string;
  reasoningEffort: AgentReasoningEffort;
  serviceTier: AgentServiceTier;
  prompt: string;
  taskId: string;
  workspacePath: string;
  round: number;
  attachmentPaths?: string[];
  signal?: AbortSignal;
}

function openAiReasoningEffort(effort: AgentReasoningEffort): "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | null {
  return effort === "default" ? null : effort;
}

function openAiServiceTier(tier: AgentServiceTier): "auto" | "priority" | null {
  if (tier === "auto") {
    return "auto";
  }
  if (tier === "fast") {
    return "priority";
  }
  return null;
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
  if (input.role === "planner") {
    return [
      `Mock planner 라운드 ${input.round} 완료.`,
      "질문:",
      "1. 구현자가 반드시 유지해야 할 제약은 무엇인가요?",
      "2. 가장 중요하게 봐야 할 검증 근거는 무엇인가요?",
      "",
      "임시 구현 계획: 질문에 답변을 받은 뒤 범위가 지정된 변경만 구현합니다."
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
    input.role === "planner"
      ? "All planner-facing summaries, questions, draft plans, and handoff text must be written in Korean. Keep code identifiers, file paths, commands, and API names unchanged."
      : "",
    input.role === "verifier"
      ? 'Return a final JSON object with keys "decision" and "summary". decision must be pass, needs_fix, or blocked.'
      : ""
  ]
    .filter(Boolean)
    .join("\n");
}

function normalizeProviderError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  const status = typeof (error as { status?: unknown }).status === "number" ? (error as { status: number }).status : null;
  const code = typeof (error as { code?: unknown }).code === "string" ? (error as { code: string }).code : "";
  const isQuotaError =
    status === 429 ||
    code === "insufficient_quota" ||
    /exceeded your current quota|billing details|insufficient_quota/i.test(message);

  if (!isQuotaError) {
    return error instanceof Error ? error : new Error(message);
  }

  return new Error(
    [
      "OpenAI quota exceeded for the selected agent provider/model.",
      "The task was blocked before the current agent could finish.",
      "Check OpenAI billing/usage limits for the API key in .env.local, or switch this role to the mock provider in Settings for local harness testing.",
      `Original provider error: ${message}`
    ].join("\n")
  );
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
      workspacePath: input.workspacePath,
      signal: input.signal
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
    const request = {
      model: input.model,
      instructions,
      input: nextInput as never,
      previous_response_id: previousResponseId,
      tools: tools as never
    } as Parameters<typeof client.responses.create>[0];
    const reasoningEffort = openAiReasoningEffort(input.reasoningEffort);
    const serviceTier = openAiServiceTier(input.serviceTier);
    if (reasoningEffort) {
      request.reasoning = { effort: reasoningEffort };
    }
    if (serviceTier) {
      request.service_tier = serviceTier;
    }
    const response = (await client.responses.create(request, { signal: input.signal } as never)) as unknown as { id: string };

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

const MAX_CODEX_OUTPUT_CHARS = 1_000_000;

function appendCapped(current: string, chunk: Buffer): string {
  const next = current + chunk.toString("utf8");
  return next.length > MAX_CODEX_OUTPUT_CHARS ? next.slice(-MAX_CODEX_OUTPUT_CHARS) : next;
}

function displayCommand(args: string[], imageCount: number): string {
  const renderedArgs = args
    .map((arg) => (/\s/.test(arg) ? JSON.stringify(arg) : arg))
    .join(" ")
    .replace(/\s-\s*$/, " -");
  const imageSuffix = imageCount > 0 ? `, ${imageCount} image(s)` : "";
  return `codex ${renderedArgs} [stdin prompt omitted${imageSuffix}]`;
}

function codexCliSandboxMode(): "read-only" | "workspace-write" | "danger-full-access" {
  const value = process.env.CODEX_CLI_SANDBOX;
  if (value === "read-only" || value === "workspace-write" || value === "danger-full-access") {
    return value;
  }
  return "danger-full-access";
}

function extractCodexCommandLogs(stdout: string): Array<{ command: string; output: string; exitCode: number | null }> {
  const logs: Array<{ command: string; output: string; exitCode: number | null }> = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim().startsWith("{")) {
      continue;
    }
    try {
      const event = JSON.parse(line) as {
        type?: string;
        item?: {
          type?: string;
          command?: string;
          aggregated_output?: string;
          exit_code?: number | null;
          status?: string;
        };
      };
      if (event.type === "item.completed" && event.item?.type === "command_execution" && event.item.command) {
        logs.push({
          command: event.item.command,
          output: event.item.aggregated_output || "",
          exitCode: typeof event.item.exit_code === "number" ? event.item.exit_code : null
        });
      }
    } catch {
      // Codex CLI can print non-JSON warnings around JSON mode; ignore those here.
    }
  }
  return logs;
}

async function runCodexCliAgent(input: AgentInput): Promise<string> {
  const startedAt = Date.now();
  const codexPath = process.env.CODEX_CLI_PATH || "codex";
  const outputFile = path.join(
    os.tmpdir(),
    `oh-my-codex-${input.taskId}-${input.role}-${input.round}-${Date.now()}.txt`
  );
  const args = [
    "--ask-for-approval",
    "never",
    "exec",
    "--cd",
    input.workspacePath,
    "--sandbox",
    codexCliSandboxMode(),
    "--output-last-message",
    outputFile,
    "--color",
    "never",
    "--json",
    "--skip-git-repo-check"
  ];

  if (input.model && input.model !== "default") {
    args.push("--model", input.model);
  }
  if (input.reasoningEffort !== "default") {
    args.push("--config", `model_reasoning_effort="${input.reasoningEffort}"`);
  }
  if (input.serviceTier !== "default") {
    args.push("--config", `service_tier="${input.serviceTier}"`);
  }

  for (const attachmentPath of input.attachmentPaths || []) {
    if (fs.existsSync(attachmentPath)) {
      args.push("--image", attachmentPath);
    }
  }

  args.push("-");

  const prompt = [
    buildInstructions(input),
    "You are running through Codex CLI. Treat the approved task worktree as your only writable workspace.",
    input.role === "researcher" || input.role === "planner" || input.role === "tester" || input.role === "verifier"
      ? "Do not modify files unless the role prompt explicitly requires it."
      : "",
    input.attachmentPaths?.length
      ? `The task includes ${input.attachmentPaths.length} image attachment(s). They are passed to Codex CLI as image inputs when present on disk.`
      : "",
    "",
    input.prompt
  ]
    .filter(Boolean)
    .join("\n");

  let stdout = "";
  let stderr = "";
  let exitCode: number | null = null;

  try {
    const result = await new Promise<{ exitCode: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(codexPath, args, {
        cwd: input.workspacePath,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        signal: input.signal
      });

      child.stdout.on("data", (chunk: Buffer) => {
        stdout = appendCapped(stdout, chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr = appendCapped(stderr, chunk);
      });
      child.on("error", (error) => {
        reject(error);
      });
      child.on("close", (code) => {
        exitCode = code;
        resolve({ exitCode: code, stdout, stderr });
      });
      child.stdin.end(prompt, "utf8");
    });

    exitCode = result.exitCode;
    stdout = result.stdout;
    stderr = result.stderr;

    if (exitCode !== 0) {
      throw new Error(
        [
          `Codex CLI exited with code ${exitCode ?? "unknown"}.`,
          stderr ? `STDERR:\n${stderr}` : "",
          stdout ? `STDOUT:\n${stdout}` : ""
        ]
          .filter(Boolean)
          .join("\n\n")
      );
    }

    if (fs.existsSync(outputFile)) {
      const output = fs.readFileSync(outputFile, "utf8").trim();
      if (output) {
        return output;
      }
    }

    return stdout.trim() || "Codex CLI completed without a final message.";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error("Codex CLI was not found. Install Codex CLI or set CODEX_CLI_PATH in .env.local.");
    }
    throw error;
  } finally {
    const durationMs = Date.now() - startedAt;
    for (const log of extractCodexCommandLogs(stdout)) {
      insertShellLog({
        taskId: input.taskId,
        agentRole: input.role,
        command: log.command,
        cwd: input.workspacePath,
        exitCode: log.exitCode,
        stdout: log.output,
        stderr: "",
        durationMs
      });
    }

    insertShellLog({
      taskId: input.taskId,
      agentRole: input.role,
      command: displayCommand(args, input.attachmentPaths?.length || 0),
      cwd: input.workspacePath,
      exitCode,
      stdout,
      stderr,
      durationMs
    });

    if (fs.existsSync(outputFile)) {
      fs.rmSync(outputFile, { force: true });
    }
  }
}

export async function runAgent(input: AgentInput): Promise<string> {
  if (shouldUseMockAgents() || input.provider === "mock") {
    return mockAgent(input);
  }
  try {
    if (input.provider === "codex-cli") {
      return await runCodexCliAgent(input);
    }
    return await runOpenAiAgent(input);
  } catch (error) {
    throw normalizeProviderError(error);
  }
}
