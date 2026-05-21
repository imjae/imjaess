import fs from "node:fs/promises";
import path from "node:path";

const maxFileChars = 6000;
const maxTotalChars = 20000;
const maxDirectoryEntries = 80;
const maxDirectoryDepth = 2;

interface ScopeReference {
  raw: string;
  value: string;
}

function normalizeForCompare(input: string): string {
  return path.resolve(input).toLowerCase();
}

function isInside(basePath: string, candidatePath: string): boolean {
  const base = normalizeForCompare(basePath);
  const candidate = normalizeForCompare(candidatePath);
  return candidate === base || candidate.startsWith(`${base}${path.sep}`);
}

export function extractScopeReferences(scope: string): ScopeReference[] {
  const references: ScopeReference[] = [];
  const pattern = /@(?:"([^"]+)"|'([^']+)'|`([^`]+)`|([^\s,;]+))/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(scope)) !== null) {
    const value = match[1] || match[2] || match[3] || match[4] || "";
    const trimmed = value.trim();
    if (trimmed) {
      references.push({
        raw: match[0],
        value: trimmed
      });
    }
  }

  return references;
}

function resolveReference(workspacePath: string, reference: ScopeReference): string {
  const normalizedValue = reference.value.replaceAll("/", path.sep).replaceAll("\\", path.sep);
  const candidate = path.isAbsolute(normalizedValue)
    ? path.resolve(normalizedValue)
    : path.resolve(workspacePath, normalizedValue);

  if (!isInside(workspacePath, candidate)) {
    throw new Error(`Scope reference ${reference.raw} resolves outside the task workspace.`);
  }

  return candidate;
}

function relativeDisplay(workspacePath: string, targetPath: string): string {
  const relative = path.relative(workspacePath, targetPath);
  return relative || ".";
}

function clipText(text: string, limit: number): string {
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit)}\n[scope reference trimmed: ${text.length - limit} chars omitted]`;
}

function looksBinary(buffer: Buffer): boolean {
  return buffer.subarray(0, Math.min(buffer.length, 8000)).includes(0);
}

async function renderFileReference(workspacePath: string, targetPath: string): Promise<string> {
  const buffer = await fs.readFile(targetPath);
  const relative = relativeDisplay(workspacePath, targetPath);
  if (looksBinary(buffer)) {
    return [`### @${relative}`, "Type: file", `Size: ${buffer.length} bytes`, "Content: binary file omitted"].join("\n");
  }

  const content = buffer.toString("utf8");
  return [
    `### @${relative}`,
    "Type: file",
    `Size: ${buffer.length} bytes`,
    "Content:",
    "```text",
    clipText(content, maxFileChars),
    "```"
  ].join("\n");
}

async function walkDirectory(input: {
  workspacePath: string;
  directoryPath: string;
  currentDepth: number;
  output: string[];
  count: { value: number };
}): Promise<void> {
  if (input.currentDepth > maxDirectoryDepth || input.count.value >= maxDirectoryEntries) {
    return;
  }

  const entries = await fs.readdir(input.directoryPath, { withFileTypes: true });
  entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) {
      return a.isDirectory() ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });

  for (const entry of entries) {
    if (input.count.value >= maxDirectoryEntries) {
      input.output.push(`[directory reference trimmed after ${maxDirectoryEntries} entries]`);
      return;
    }
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === ".next") {
      continue;
    }

    const entryPath = path.join(input.directoryPath, entry.name);
    if (!isInside(input.workspacePath, entryPath)) {
      continue;
    }
    const relative = relativeDisplay(input.workspacePath, entryPath);
    input.output.push(`${"  ".repeat(input.currentDepth)}${entry.isDirectory() ? "[dir]" : "[file]"} ${relative}`);
    input.count.value += 1;

    if (entry.isDirectory()) {
      await walkDirectory({
        ...input,
        directoryPath: entryPath,
        currentDepth: input.currentDepth + 1
      });
    }
  }
}

async function renderDirectoryReference(workspacePath: string, targetPath: string): Promise<string> {
  const relative = relativeDisplay(workspacePath, targetPath);
  const output: string[] = [];
  await walkDirectory({
    workspacePath,
    directoryPath: targetPath,
    currentDepth: 0,
    output,
    count: { value: 0 }
  });

  return [
    `### @${relative}`,
    "Type: directory",
    `Listing: max depth ${maxDirectoryDepth}, max entries ${maxDirectoryEntries}`,
    "```text",
    output.length > 0 ? output.join("\n") : "[empty directory]",
    "```"
  ].join("\n");
}

export async function buildScopeReferenceContext(scope: string, workspacePath: string): Promise<string> {
  const references = extractScopeReferences(scope);
  if (references.length === 0) {
    return "";
  }

  const sections: string[] = [
    "Referenced scope resources",
    "These resources were expanded from @ references in Scope. File content is clipped and folder references are listings only."
  ];

  let totalChars = sections.join("\n\n").length;
  for (const reference of references) {
    let section: string;
    try {
      const targetPath = resolveReference(workspacePath, reference);
      const stat = await fs.stat(targetPath);
      section = stat.isDirectory()
        ? await renderDirectoryReference(workspacePath, targetPath)
        : await renderFileReference(workspacePath, targetPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      section = [`### ${reference.raw}`, "Type: unresolved", `Error: ${message}`].join("\n");
    }

    if (totalChars + section.length > maxTotalChars) {
      sections.push(`[scope references trimmed: total context budget ${maxTotalChars} chars reached]`);
      break;
    }
    sections.push(section);
    totalChars += section.length;
  }

  return sections.join("\n\n");
}
