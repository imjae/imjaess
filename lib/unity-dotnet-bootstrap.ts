import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface UnityDotnetBootstrapResult {
  copiedFiles: string[];
  patchedProjects: string[];
  addedScripts: string[];
  removedScripts: string[];
  unitySerializedChanges: string[];
  warnings: string[];
}

interface NameStatusEntry {
  status: string;
  paths: string[];
}

const GENERATED_PROJECT_FILE = /\.(sln|csproj|csproj\.dotsettings)$/i;
const UNITY_SERIALIZED_FILE = /\.(prefab|unity|asset|mat|controller|anim|playable|overridecontroller)$/i;

function toProjectPath(filePath: string): string {
  return filePath.replaceAll("/", "\\");
}

function escapeXmlAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function recursiveGeneratedFiles(root: string): string[] {
  if (!fs.existsSync(root)) {
    return [];
  }
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && GENERATED_PROJECT_FILE.test(entry.name))
    .map((entry) => path.join(root, entry.name));
}

function copyGeneratedProjectFiles(sourceProjectPath: string, workspacePath: string): string[] {
  const copied: string[] = [];
  for (const source of recursiveGeneratedFiles(sourceProjectPath)) {
    const destination = path.join(workspacePath, path.basename(source));
    fs.copyFileSync(source, destination);
    copied.push(path.basename(destination));
  }
  return copied;
}

async function gitNameStatus(workspacePath: string, ref: string): Promise<NameStatusEntry[]> {
  try {
    const { stdout } = await execFileAsync("git", ["diff-tree", "--no-commit-id", "--name-status", "-r", ref], {
      cwd: workspacePath,
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 4
    });
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.split(/\t+/);
        return { status: parts[0], paths: parts.slice(1) };
      });
  } catch {
    return [];
  }
}

function scriptChanges(entries: NameStatusEntry[]): { added: string[]; removed: string[] } {
  const added: string[] = [];
  const removed: string[] = [];
  for (const entry of entries) {
    const status = entry.status[0];
    if (status === "A" && entry.paths[0]?.toLowerCase().endsWith(".cs")) {
      added.push(entry.paths[0]);
    } else if (status === "D" && entry.paths[0]?.toLowerCase().endsWith(".cs")) {
      removed.push(entry.paths[0]);
    } else if (status === "R" || status === "C") {
      const [oldPath, newPath] = entry.paths;
      if (oldPath?.toLowerCase().endsWith(".cs")) {
        removed.push(oldPath);
      }
      if (newPath?.toLowerCase().endsWith(".cs")) {
        added.push(newPath);
      }
    }
  }
  return { added, removed };
}

function unitySerializedChanges(entries: NameStatusEntry[]): string[] {
  return entries
    .flatMap((entry) => entry.paths)
    .filter((filePath) => UNITY_SERIALIZED_FILE.test(filePath))
    .filter((filePath, index, all) => all.indexOf(filePath) === index);
}

function findProjectFiles(workspacePath: string): string[] {
  return fs
    .readdirSync(workspacePath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".csproj"))
    .map((entry) => path.join(workspacePath, entry.name));
}

function chooseProjectFile(projectFiles: string[]): string | null {
  return projectFiles.find((filePath) => path.basename(filePath).toLowerCase() === "assembly-csharp.csproj")
    || projectFiles[0]
    || null;
}

function removeCompileInclude(projectXml: string, projectScriptPath: string): string {
  const escaped = projectScriptPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const linePattern = new RegExp(`^\\s*<Compile\\s+Include="${escaped}"\\s*/>\\s*\\r?\\n?`, "gim");
  const blockPattern = new RegExp(
    `^\\s*<Compile\\s+Include="${escaped}"\\s*>[\\s\\S]*?</Compile>\\s*\\r?\\n?`,
    "gim"
  );
  return projectXml.replace(linePattern, "").replace(blockPattern, "");
}

function addCompileInclude(projectXml: string, projectScriptPath: string): string {
  const include = `<Compile Include="${escapeXmlAttribute(projectScriptPath)}" />`;
  const line = `    ${include}`;
  if (projectXml.includes(include) || projectXml.includes(`Include="${projectScriptPath}"`)) {
    return projectXml;
  }

  const itemGroupWithCompile = /([\t ]*)<\/ItemGroup>/g;
  let match: RegExpExecArray | null;
  let insertAt = -1;
  while ((match = itemGroupWithCompile.exec(projectXml)) !== null) {
    const itemGroupStart = projectXml.lastIndexOf("<ItemGroup", match.index);
    const itemGroup = itemGroupStart >= 0 ? projectXml.slice(itemGroupStart, match.index) : "";
    if (itemGroup.includes("<Compile ")) {
      insertAt = match.index;
    }
  }
  if (insertAt >= 0) {
    return `${projectXml.slice(0, insertAt)}${line}\n${projectXml.slice(insertAt)}`;
  }

  const projectClose = projectXml.lastIndexOf("</Project>");
  if (projectClose >= 0) {
    return `${projectXml.slice(0, projectClose)}  <ItemGroup>\n${line}\n  </ItemGroup>\n${projectXml.slice(projectClose)}`;
  }
  return `${projectXml}\n<ItemGroup>\n${line}\n</ItemGroup>\n`;
}

function patchProjects(workspacePath: string, addedScripts: string[], removedScripts: string[]): string[] {
  const projectFiles = findProjectFiles(workspacePath);
  const fallbackProject = chooseProjectFile(projectFiles);
  if (!fallbackProject) {
    return [];
  }

  const patched = new Set<string>();
  for (const projectFile of projectFiles) {
    let xml = fs.readFileSync(projectFile, "utf8");
    const original = xml;
    for (const removed of removedScripts) {
      xml = removeCompileInclude(xml, toProjectPath(removed));
    }
    if (xml !== original) {
      fs.writeFileSync(projectFile, xml);
      patched.add(path.basename(projectFile));
    }
  }

  let fallbackXml = fs.readFileSync(fallbackProject, "utf8");
  const originalFallbackXml = fallbackXml;
  const allProjectXml = projectFiles.map((projectFile) => fs.readFileSync(projectFile, "utf8")).join("\n");
  for (const added of addedScripts) {
    const projectScriptPath = toProjectPath(added);
    if (!allProjectXml.includes(`Include="${projectScriptPath}"`)) {
      fallbackXml = addCompileInclude(fallbackXml, projectScriptPath);
    }
  }
  if (fallbackXml !== originalFallbackXml) {
    fs.writeFileSync(fallbackProject, fallbackXml);
    patched.add(path.basename(fallbackProject));
  }

  return [...patched];
}

export async function prepareUnityDotnetVerificationWorkspace(input: {
  sourceProjectPath: string;
  workspacePath: string;
  implementationRef: string;
  implementationCommitted: boolean;
}): Promise<UnityDotnetBootstrapResult> {
  const copiedFiles = copyGeneratedProjectFiles(input.sourceProjectPath, input.workspacePath);
  const entries = input.implementationCommitted ? await gitNameStatus(input.workspacePath, input.implementationRef) : [];
  const { added, removed } = scriptChanges(entries);
  const patchedProjects = patchProjects(input.workspacePath, added, removed);
  const warnings: string[] = [];

  if (copiedFiles.length === 0) {
    warnings.push("No generated Unity .sln/.csproj files were found in the source checkout.");
  }
  if (added.length > 0 && patchedProjects.length === 0) {
    warnings.push("New C# scripts were detected, but no .csproj file could be patched for dotnet build.");
  }

  return {
    copiedFiles,
    patchedProjects,
    addedScripts: added,
    removedScripts: removed,
    unitySerializedChanges: unitySerializedChanges(entries),
    warnings
  };
}

export function formatUnityDotnetBootstrapResult(result: UnityDotnetBootstrapResult): string {
  return [
    "Unity dotnet bootstrap:",
    `Copied generated project files: ${result.copiedFiles.length ? result.copiedFiles.join(", ") : "none"}`,
    `Patched project files: ${result.patchedProjects.length ? result.patchedProjects.join(", ") : "none"}`,
    `Added C# scripts: ${result.addedScripts.length ? result.addedScripts.join(", ") : "none"}`,
    `Removed C# scripts: ${result.removedScripts.length ? result.removedScripts.join(", ") : "none"}`,
    result.unitySerializedChanges.length
      ? `Unity serialized assets changed but editor import was not run: ${result.unitySerializedChanges.join(", ")}`
      : "Unity serialized assets changed but editor import was not run: none",
    result.warnings.length ? `Warnings: ${result.warnings.join(" | ")}` : "Warnings: none"
  ].join("\n");
}
