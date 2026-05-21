import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getPathSuggestions } from "@/lib/path-suggestions";

describe("path suggestions", () => {
  it("suggests files and folders inside the target project path", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "path-suggestion-"));
    fs.mkdirSync(path.join(root, "Assets", "Scripts"), { recursive: true });
    fs.writeFileSync(path.join(root, "Assets", "Scripts", "TradeInventoryPopup.cs"), "");
    fs.writeFileSync(path.join(root, "Assets", "Scripts", "TradeButton.cs"), "");

    const suggestions = await getPathSuggestions({
      targetProjectPath: root,
      query: "Assets/Scripts/Trade"
    });

    expect(suggestions.map((item) => item.path)).toEqual([
      "Assets/Scripts/TradeButton.cs",
      "Assets/Scripts/TradeInventoryPopup.cs"
    ]);
  });

  it("prioritizes exact file matches when the query includes an extension", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "path-suggestion-"));
    fs.mkdirSync(path.join(root, "Assets", "Scripts"), { recursive: true });
    fs.writeFileSync(path.join(root, "Assets", "Scripts", "Trade.cs"), "");
    fs.writeFileSync(path.join(root, "Assets", "Scripts", "TradeHelper.cs"), "");
    fs.writeFileSync(path.join(root, "Assets", "Scripts", "OldTrade.cs"), "");

    const suggestions = await getPathSuggestions({
      targetProjectPath: root,
      query: "Assets/Scripts/Trade.cs"
    });

    expect(suggestions[0]).toEqual({
      path: "Assets/Scripts/Trade.cs",
      type: "file",
      match: "exact"
    });
    expect(suggestions.slice(1).every((item) => item.type === "file" && item.match === "contains")).toBe(true);
  });

  it("finds deep exact file matches before shallow contains matches", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "path-suggestion-"));
    fs.mkdirSync(path.join(root, "Assets", "Scripts", "GameSystem"), { recursive: true });
    fs.mkdirSync(path.join(root, "Assets", "01_Game", "Scripts", "Character", "Player"), { recursive: true });
    fs.writeFileSync(path.join(root, "Assets", "Scripts", "GameSystem", "SoundPlayer.cs"), "");
    fs.writeFileSync(path.join(root, "Assets", "01_Game", "Scripts", "Character", "Player", "Player.cs"), "");

    const suggestions = await getPathSuggestions({
      targetProjectPath: root,
      query: "Player.cs"
    });

    expect(suggestions[0]).toEqual({
      path: "Assets/01_Game/Scripts/Character/Player/Player.cs",
      type: "file",
      match: "exact"
    });
    expect(suggestions.map((item) => item.path)).toContain("Assets/Scripts/GameSystem/SoundPlayer.cs");
  });

  it("prioritizes exact folder and file stem matches when the query has no extension", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "path-suggestion-"));
    fs.mkdirSync(path.join(root, "Assets", "Scripts", "Trade"), { recursive: true });
    fs.writeFileSync(path.join(root, "Assets", "Scripts", "Trade.cs"), "");
    fs.writeFileSync(path.join(root, "Assets", "Scripts", "TradeHelper.cs"), "");
    fs.mkdirSync(path.join(root, "Assets", "Scripts", "TradeTools"));

    const suggestions = await getPathSuggestions({
      targetProjectPath: root,
      query: "Assets/Scripts/Trade"
    });

    expect(suggestions.slice(0, 2)).toEqual([
      {
        path: "Assets/Scripts/Trade",
        type: "directory",
        match: "exact"
      },
      {
        path: "Assets/Scripts/Trade.cs",
        type: "file",
        match: "exact"
      }
    ]);
    expect(suggestions.slice(2).every((item) => item.match === "contains")).toBe(true);
  });

  it("does not suggest paths outside the target project path", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "path-suggestion-"));
    const suggestions = await getPathSuggestions({
      targetProjectPath: root,
      query: "../"
    });

    expect(suggestions).toEqual([]);
  });
});
