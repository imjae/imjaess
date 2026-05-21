import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildScopeReferenceContext, extractScopeReferences } from "@/lib/scope-references";

describe("scope references", () => {
  it("extracts plain and quoted @ references", () => {
    const refs = extractScopeReferences('Check @src/index.ts and @"folder with spaces" plus @Assets/Scripts; then stop.');
    expect(refs.map((ref) => ref.value)).toEqual(["src/index.ts", "folder with spaces", "Assets/Scripts"]);
  });

  it("expands file content and directory listings inside the workspace", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "scope-ref-"));
    fs.mkdirSync(path.join(root, "src"));
    fs.writeFileSync(path.join(root, "src", "index.ts"), "export const value = 1;\n");
    fs.writeFileSync(path.join(root, "src", "other.ts"), "export const other = 2;\n");

    const context = await buildScopeReferenceContext("@src/index.ts @src", root);

    expect(context).toContain("Referenced scope resources");
    expect(context).toContain("export const value = 1;");
    expect(context).toContain("[file] src");
    expect(context).toContain(`src${path.sep}index.ts`);
  });

  it("does not expand paths outside the workspace", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "scope-ref-"));
    const outside = path.join(os.tmpdir(), "outside-scope-reference.txt");
    fs.writeFileSync(outside, "secret");

    const context = await buildScopeReferenceContext(`@${outside}`, root);

    expect(context).toContain("Type: unresolved");
    expect(context).toContain("outside the task workspace");
    expect(context).not.toContain("secret");
  });
});
