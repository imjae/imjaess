const UNITY_BATCHMODE_TIMEOUT_MS = 600_000;
const DEFAULT_VERIFICATION_TIMEOUT_MS = 180_000;
const DEFAULT_UNITY_DOTNET_COMMAND = "dotnet build Deluge.sln --no-restore";

export function defaultUnityDotnetVerificationCommand(): string {
  return DEFAULT_UNITY_DOTNET_COMMAND;
}

export function unityBatchmodeVerificationCommand(): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    "$unity = $env:UNITY_EXECUTABLE_PATH",
    "if (-not $unity) { $candidate = Get-ChildItem 'C:\\Program Files\\Unity\\Hub\\Editor\\*\\Editor\\Unity.exe' -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1; if ($candidate) { $unity = $candidate.FullName } }",
    "if (-not $unity) { $unity = 'Unity.exe' }",
    "& $unity -batchmode -quit -nographics -accept-apiupdate -projectPath . -logFile -",
    "exit $LASTEXITCODE"
  ].join("; ");
}

export function isLegacyDotnetUnityVerificationCommand(command: string): boolean {
  const normalized = command.trim().toLowerCase();
  return normalized === "dotnet build deluge.sln --no-restore" || normalized.startsWith("dotnet build deluge.sln ");
}

export function isUnityDotnetVerificationCommand(command: string): boolean {
  const normalized = command.trim().toLowerCase();
  return normalized.startsWith("dotnet build ") && normalized.includes(".sln");
}

export function normalizeVerificationCommand(command?: string | null): string {
  const trimmed = command?.trim() || "";
  if (!trimmed) {
    return defaultUnityDotnetVerificationCommand();
  }
  return trimmed;
}

export function verificationTimeoutMs(command?: string | null): number {
  const normalized = command?.toLowerCase() || "";
  if (normalized.includes("-batchmode") && normalized.includes("-projectpath")) {
    return UNITY_BATCHMODE_TIMEOUT_MS;
  }
  return DEFAULT_VERIFICATION_TIMEOUT_MS;
}
