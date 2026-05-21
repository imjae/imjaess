import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { modelFor, providerFor, shouldUseMockAgents } from "@/lib/config";
import { resetDbForTests, upsertAgentSetting } from "@/lib/db";

describe("provider config", () => {
  afterEach(() => {
    resetDbForTests();
    delete process.env.HARNESS_DB_PATH;
    delete process.env.MOCK_AGENTS;
    delete process.env.RESEARCHER_PROVIDER;
    delete process.env.IMPLEMENTER_PROVIDER;
    delete process.env.TESTER_PROVIDER;
    delete process.env.VERIFIER_PROVIDER;
  });

  function useTempDb(): void {
    process.env.HARNESS_DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "harness-config-")), "test.sqlite");
    resetDbForTests();
  }

  it("defaults all isolated Codex roles to openai", () => {
    useTempDb();
    expect(providerFor("researcher")).toBe("openai");
    expect(providerFor("implementer")).toBe("openai");
    expect(providerFor("tester")).toBe("openai");
    expect(providerFor("verifier")).toBe("openai");
    expect(modelFor("researcher")).toBe("gpt-5.5");
  });

  it("prefers web-saved settings over environment defaults", () => {
    useTempDb();
    process.env.RESEARCHER_MODEL = "gpt-5.4";
    upsertAgentSetting({
      role: "researcher",
      provider: "openai",
      model: "gpt-5.5"
    });
    expect(modelFor("researcher")).toBe("gpt-5.5");
  });

  it("uses mock mode unless explicitly disabled", () => {
    expect(shouldUseMockAgents()).toBe(true);
    process.env.MOCK_AGENTS = "0";
    expect(shouldUseMockAgents()).toBe(false);
  });
});
