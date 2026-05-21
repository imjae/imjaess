import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { browseFolders } from "@/lib/folder-browser";

describe("folder browser", () => {
  it("lists child folders for a requested directory", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "folder-browser-"));
    fs.mkdirSync(path.join(root, "Assets"));
    fs.mkdirSync(path.join(root, "Packages"));
    fs.writeFileSync(path.join(root, "README.md"), "");

    const result = await browseFolders(root);

    expect(result.currentPath).toBe(path.resolve(root));
    expect(result.entries.map((entry) => entry.name)).toEqual(["Assets", "Packages"]);
    expect(result.entries.every((entry) => path.dirname(entry.path) === path.resolve(root))).toBe(true);
  });

  it("falls back to an existing root for missing paths", async () => {
    const result = await browseFolders(path.join(os.tmpdir(), "missing-folder-browser-path"));

    expect(result.currentPath).toBeTruthy();
    expect(result.roots.length).toBeGreaterThan(0);
  });
});
