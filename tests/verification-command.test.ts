import { describe, expect, it } from "vitest";
import { isUnityDotnetVerificationCommand, normalizeVerificationCommand, verificationTimeoutMs } from "@/lib/verification-command";

describe("verification command defaults", () => {
  it("keeps shell verification disabled when the command is blank", () => {
    expect(normalizeVerificationCommand("")).toBe("");
    expect(normalizeVerificationCommand("   ")).toBe("");
  });

  it("preserves explicit dotnet verification commands", () => {
    expect(isUnityDotnetVerificationCommand("dotnet build Deluge.sln --no-restore")).toBe(true);
    expect(normalizeVerificationCommand("dotnet build Deluge.sln --no-restore")).toBe("dotnet build Deluge.sln --no-restore");
  });

  it("uses the default shell verification timeout", () => {
    expect(verificationTimeoutMs("npm test")).toBe(180_000);
  });
});
