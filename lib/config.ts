import type { AgentProvider, AgentReasoningEffort, AgentRole, AgentServiceTier } from "@/lib/types";
import { getAgentSetting } from "@/lib/db";
import { defaultModelForProvider } from "@/lib/model-catalog";

export const agentRoles = ["researcher", "implementer", "tester", "verifier"] as const satisfies AgentRole[];

const reasoningEfforts = new Set<AgentReasoningEffort>([
  "default",
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh"
]);
const serviceTiers = new Set<AgentServiceTier>(["default", "auto", "fast"]);

export function modelFor(role: AgentRole): string {
  const setting = getAgentSetting(role);
  if (setting) {
    return setting.model;
  }
  const key = `${role.toUpperCase()}_MODEL`;
  const provider = providerFor(role);
  return process.env[key] || defaultModelForProvider(provider);
}

export function providerFor(role: AgentRole): AgentProvider {
  const setting = getAgentSetting(role);
  if (setting) {
    return setting.provider;
  }
  const key = `${role.toUpperCase()}_PROVIDER`;
  const value = (process.env[key] || "").toLowerCase();
  if (value === "openai" || value === "codex-cli" || value === "mock") {
    return value;
  }
  return "openai";
}

function roleEnv(role: AgentRole, suffix: string): string | undefined {
  return process.env[`${role.toUpperCase()}_${suffix}`] || process.env[`AGENT_${suffix}`];
}

export function reasoningEffortFor(role: AgentRole): AgentReasoningEffort {
  const setting = getAgentSetting(role);
  if (setting) {
    return setting.reasoningEffort;
  }
  const value = (roleEnv(role, "REASONING_EFFORT") || "").toLowerCase() as AgentReasoningEffort;
  return reasoningEfforts.has(value) ? value : "default";
}

export function serviceTierFor(role: AgentRole): AgentServiceTier {
  const setting = getAgentSetting(role);
  if (setting) {
    return setting.serviceTier;
  }
  const value = (roleEnv(role, "SERVICE_TIER") || "").toLowerCase() as AgentServiceTier;
  return serviceTiers.has(value) ? value : "default";
}

export function effectiveAgentSettings() {
  return agentRoles.map((role) => ({
    role,
    provider: providerFor(role),
    model: modelFor(role),
    reasoningEffort: reasoningEffortFor(role),
    serviceTier: serviceTierFor(role),
    updatedAt: getAgentSetting(role)?.updatedAt || null
  }));
}

export function maxAgentRounds(): number {
  const parsed = Number.parseInt(process.env.MAX_AGENT_ROUNDS || "3", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3;
}

export function shouldUseMockAgents(): boolean {
  return process.env.MOCK_AGENTS !== "0";
}
