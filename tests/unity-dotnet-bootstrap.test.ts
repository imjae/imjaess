import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  formatUnityDotnetBootstrapResult,
  prepareUnityDotnetVerificationWorkspace
} from "@/lib/unity-dotnet-bootstrap";

function git(args: string[], cwd: string): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

describe("Unity dotnet worktree bootstrap", () => {
  it("copies generated project files and patches added scripts for dotnet build", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-unity-source-"));
    git(["init"], root);
    git(["config", "user.email", "harness@example.local"], root);
    git(["config", "user.name", "Harness Test"], root);

    fs.mkdirSync(path.join(root, "Assets", "Scripts"), { recursive: true });
    fs.writeFileSync(path.join(root, "Assets", "Scripts", "Existing.cs"), "public class Existing {}\n");
    fs.writeFileSync(path.join(root, "Deluge.sln"), "Microsoft Visual Studio Solution File\n");
    fs.writeFileSync(
      path.join(root, "Assembly-CSharp.csproj"),
      [
        "<Project>",
        "  <ItemGroup>",
        "    <Compile Include=\"Assets\\Scripts\\Existing.cs\" />",
        "  </ItemGroup>",
        "</Project>",
        ""
      ].join("\n")
    );
    git(["add", "Assets/Scripts/Existing.cs"], root);
    git(["commit", "-m", "init"], root);

    const workspace = path.join(root, ".harness", "worktrees", "task", "r1-tester");
    fs.mkdirSync(path.dirname(workspace), { recursive: true });
    git(["worktree", "add", "-b", "harness/test", workspace, "HEAD"], root);
    fs.writeFileSync(path.join(workspace, "Assets", "Scripts", "NewScript.cs"), "public class NewScript {}\n");
    fs.writeFileSync(path.join(workspace, "Assets", "Changed.prefab"), "%YAML 1.1\n");
    git(["add", "Assets/Scripts/NewScript.cs", "Assets/Changed.prefab"], workspace);
    git(["commit", "-m", "add script and prefab"], workspace);

    const result = await prepareUnityDotnetVerificationWorkspace({
      sourceProjectPath: root,
      workspacePath: workspace,
      implementationRef: "HEAD",
      implementationCommitted: true
    });

    const csproj = fs.readFileSync(path.join(workspace, "Assembly-CSharp.csproj"), "utf8");
    expect(result.copiedFiles).toEqual(expect.arrayContaining(["Deluge.sln", "Assembly-CSharp.csproj"]));
    expect(result.patchedProjects).toEqual(["Assembly-CSharp.csproj"]);
    expect(result.addedScripts).toEqual(["Assets/Scripts/NewScript.cs"]);
    expect(result.unitySerializedChanges).toEqual(["Assets/Changed.prefab"]);
    expect(csproj).toContain("Assets\\Scripts\\Existing.cs");
    expect(csproj).toContain("Assets\\Scripts\\NewScript.cs");
    expect(formatUnityDotnetBootstrapResult(result)).toContain("Unity serialized assets changed");
  });
});
