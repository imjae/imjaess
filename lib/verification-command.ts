const DEFAULT_VERIFICATION_TIMEOUT_MS = 180_000;

export function isUnityDotnetVerificationCommand(command: string): boolean {
  const normalized = command.trim().toLowerCase();
  return normalized.startsWith("dotnet build ") && normalized.includes(".sln");
}

export function normalizeVerificationCommand(command?: string | null): string {
  return command?.trim() || "";
}

export function verificationTimeoutMs(command?: string | null): number {
  void command;
  return DEFAULT_VERIFICATION_TIMEOUT_MS;
}
