import fs from "node:fs/promises";
import path from "node:path";

export interface FolderBrowserEntry {
  name: string;
  path: string;
}

export interface FolderBrowserResult {
  currentPath: string;
  parentPath: string | null;
  roots: string[];
  entries: FolderBrowserEntry[];
}

const ignoredDirectoryNames = new Set([
  "$recycle.bin",
  ".git",
  ".harness",
  ".next",
  "library",
  "node_modules",
  "obj",
  "system volume information",
  "temp"
]);

async function directoryExists(directoryPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(directoryPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function windowsRoots(): Promise<string[]> {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  const checks = await Promise.all(
    letters.map(async (letter) => {
      const root = `${letter}:\\`;
      return (await directoryExists(root)) ? root : null;
    })
  );
  return checks.filter((root): root is string => Boolean(root));
}

async function rootsForPlatform(): Promise<string[]> {
  if (process.platform === "win32") {
    const roots = await windowsRoots();
    return roots.length > 0 ? roots : [path.parse(process.cwd()).root];
  }
  return ["/"];
}

function parentFor(directoryPath: string): string | null {
  const parsed = path.parse(directoryPath);
  const parent = path.dirname(directoryPath);
  return path.resolve(directoryPath) === path.resolve(parsed.root) ? null : parent;
}

export async function browseFolders(requestedPath?: string): Promise<FolderBrowserResult> {
  const roots = await rootsForPlatform();
  const fallbackPath = roots[0] || process.cwd();
  const resolvedPath = path.resolve(requestedPath?.trim() || fallbackPath);
  const currentPath = (await directoryExists(resolvedPath)) ? resolvedPath : fallbackPath;

  const entries = await fs.readdir(currentPath, { withFileTypes: true });
  const folders = entries
    .filter((entry) => entry.isDirectory() && !ignoredDirectoryNames.has(entry.name.toLowerCase()))
    .map((entry) => ({
      name: entry.name,
      path: path.join(currentPath, entry.name)
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    currentPath,
    parentPath: parentFor(currentPath),
    roots,
    entries: folders
  };
}
