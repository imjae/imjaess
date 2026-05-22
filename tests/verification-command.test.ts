import { describe, expect, it } from "vitest";
import {
  defaultUnityDotnetVerificationCommand,
  isLegacyDotnetUnityVerificationCommand,
  isUnityDotnetVerificationCommand,
  normalizeVerificationCommand,
  unityBatchmodeVerificationCommand,
  verificationTimeoutMs
} from "@/lib/verification-command";

describe("verification command defaults", () => {
  it("uses dotnet build as the default Unity validation gate", () => {
    expect(defaultUnityDotnetVerificationCommand()).toBe("dotnet build Deluge.sln --no-restore");
    expect(normalizeVerificationCommand("")).toBe("dotnet build Deluge.sln --no-restore");
  });

  it("keeps the legacy Deluge dotnet command instead of escalating to batchmode", () => {
    expect(isLegacyDotnetUnityVerificationCommand("dotnet build Deluge.sln --no-restore")).toBe(true);
    expect(isUnityDotnetVerificationCommand("dotnet build Deluge.sln --no-restore")).toBe(true);
    expect(normalizeVerificationCommand("dotnet build Deluge.sln --no-restore")).toBe("dotnet build Deluge.sln --no-restore");
  });

  it("uses a longer timeout for Unity batchmode", () => {
    expect(verificationTimeoutMs(unityBatchmodeVerificationCommand())).toBe(600_000);
    expect(verificationTimeoutMs("npm test")).toBe(180_000);
  });
});
