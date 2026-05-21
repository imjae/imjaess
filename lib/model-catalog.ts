import type { AgentProvider } from "@/lib/types";

export interface ModelOption {
  id: string;
  label: string;
  description: string;
}

const openAiModels: ModelOption[] = [
  {
    id: "gpt-5.5",
    label: "GPT-5.5",
    description: "Flagship model for complex reasoning, coding, and professional work."
  },
  {
    id: "gpt-5.4",
    label: "GPT-5.4",
    description: "Frontier model for coding and professional work with lower cost than GPT-5.5."
  },
  {
    id: "gpt-5.4-mini",
    label: "GPT-5.4 mini",
    description: "Lower-latency, lower-cost GPT-5.4-class model."
  },
  {
    id: "gpt-5.4-nano",
    label: "GPT-5.4 nano",
    description: "Cheapest GPT-5.4-class model for simple high-volume agent steps."
  },
  {
    id: "gpt-5.2",
    label: "GPT-5.2",
    description: "Previous frontier model for professional work."
  },
  {
    id: "chat-latest",
    label: "chat-latest",
    description: "Latest instant ChatGPT-style model; use GPT-5.5 for production agent work."
  }
];

const mockModels: ModelOption[] = [
  {
    id: "mock-agent",
    label: "Mock agent",
    description: "Local no-API test mode for queue, broker, and UI validation."
  }
];

export function modelsForProvider(provider: AgentProvider): ModelOption[] {
  return provider === "mock" ? mockModels : openAiModels;
}

export function defaultModelForProvider(provider: AgentProvider): string {
  return modelsForProvider(provider)[0]?.id || "gpt-5.5";
}

export function isValidModelForProvider(provider: AgentProvider, model: string): boolean {
  return modelsForProvider(provider).some((option) => option.id === model);
}

export function modelCatalog(): Record<AgentProvider, ModelOption[]> {
  return {
    openai: openAiModels,
    mock: mockModels
  };
}
