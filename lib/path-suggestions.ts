import fs from "node:fs/promises";
import path from "node:path";

export interface PathSuggestion {
  path: string;
  type: "file" | "directory";
  match: "exact" | "contains";
}

const ignoredNames = new Set([".git", ".next", ".harness", ".data", "node_modules", "Library", "Temp", "Obj"]);
const maxSuggestions = 24;
const maxScannedEntries = 1200;
const maxExactScannedEntries = 30000;
const rootSearchDepth = 3;
const exactSearchDepth = 10;

function normalizeForCompare(input: string): string {
  return path.resolve(input).toLowerCase();
}

function isInside(basePath: string, candidatePath: string): boolean {
  const base = normalizeForCompare(basePath);
  const candidate = normalizeForCompare(candidatePath);
  return candidate === base || candidate.startsWith(`${base}${path.sep}`);
}

function toReferencePath(rootPath: string, candidatePath: string): string {
  return path.relative(rootPath, candidatePath).split(path.sep).join("/");
}

function splitQuery(query: string): { directoryPart: string; namePart: string; hasDirectoryPart: boolean } {
  const normalized = query.trim().replaceAll("\\", "/").replace(/^@/, "");
  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash < 0) {
    return { directoryPart: "", namePart: normalized, hasDirectoryPart: false };
  }
  return {
    directoryPart: normalized.slice(0, lastSlash),
    namePart: normalized.slice(lastSlash + 1),
    hasDirectoryPart: true
  };
}

async function readDirectorySafe(directoryPath: string): Promise<Array<import("node:fs").Dirent>> {
  try {
    return await fs.readdir(directoryPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

interface CandidateEntry {
  path: string;
  name: string;
  type: "file" | "directory";
}

function queryHasExtension(query: string): boolean {
  return path.posix.extname(query.replaceAll("\\", "/")).length > 0;
}

function candidateMatch(candidate: CandidateEntry, query: string): PathSuggestion["match"] | null {
  const loweredQuery = query.toLowerCase();
  if (!loweredQuery) {
    return "contains";
  }

  const loweredName = candidate.name.toLowerCase();
  const stem = candidate.type === "file" ? path.parse(candidate.name).name.toLowerCase() : loweredName;
  const hasExtension = queryHasExtension(query);

  if (hasExtension) {
    if (candidate.type !== "file") {
      return null;
    }
    if (loweredName === loweredQuery) {
      return "exact";
    }
    return loweredName.includes(loweredQuery) ? "contains" : null;
  }

  if (stem === loweredQuery || loweredName === loweredQuery) {
    return "exact";
  }
  return stem.includes(loweredQuery) || loweredName.includes(loweredQuery) ? "contains" : null;
}

function sortSuggestions(suggestions: PathSuggestion[]): PathSuggestion[] {
  return suggestions
    .sort((a, b) => {
      if (a.match !== b.match) {
        return a.match === "exact" ? -1 : 1;
      }
      if (a.type !== b.type) {
        return a.type === "directory" ? -1 : 1;
      }
      return a.path.localeCompare(b.path);
    })
    .slice(0, maxSuggestions);
}

function pushUnique(map: Map<string, PathSuggestion>, suggestion: PathSuggestion): void {
  const key = `${suggestion.type}:${suggestion.path}`;
  if (!map.has(key)) {
    map.set(key, suggestion);
  }
}

async function suggestFromDirectory(input: {
  rootPath: string;
  directoryPath: string;
  namePart: string;
}): Promise<PathSuggestion[]> {
  const entries = await readDirectorySafe(input.directoryPath);
  const suggestions: PathSuggestion[] = [];

  for (const entry of entries) {
    if (ignoredNames.has(entry.name)) {
      continue;
    }
    const candidatePath = path.join(input.directoryPath, entry.name);
    if (!isInside(input.rootPath, candidatePath)) {
      continue;
    }
    const candidate: CandidateEntry = {
      path: toReferencePath(input.rootPath, candidatePath),
      name: entry.name,
      type: entry.isDirectory() ? "directory" : "file"
    };
    const match = candidateMatch(candidate, input.namePart);
    if (!match) {
      continue;
    }
    suggestions.push({
      path: candidate.path,
      type: candidate.type,
      match
    });
  }

  return sortSuggestions(suggestions);
}

async function suggestFromRootSearch(rootPath: string, query: string): Promise<PathSuggestion[]> {
  const suggestions = new Map<string, PathSuggestion>();
  const exactQueue: Array<{ directoryPath: string; depth: number }> = [{ directoryPath: rootPath, depth: 0 }];
  let exactScanned = 0;

  while (exactQueue.length > 0 && exactScanned < maxExactScannedEntries) {
    const current = exactQueue.shift();
    if (!current) {
      break;
    }
    const entries = await readDirectorySafe(current.directoryPath);
    for (const entry of entries) {
      if (exactScanned >= maxExactScannedEntries) {
        break;
      }
      exactScanned += 1;
      if (ignoredNames.has(entry.name)) {
        continue;
      }
      const candidatePath = path.join(current.directoryPath, entry.name);
      if (!isInside(rootPath, candidatePath)) {
        continue;
      }
      const candidate: CandidateEntry = {
        path: toReferencePath(rootPath, candidatePath),
        name: entry.name,
        type: entry.isDirectory() ? "directory" : "file"
      };
      const match = candidateMatch(candidate, query);
      if (match === "exact") {
        pushUnique(suggestions, {
          path: candidate.path,
          type: candidate.type,
          match
        });
      }
      if (entry.isDirectory() && current.depth < exactSearchDepth) {
        exactQueue.push({ directoryPath: candidatePath, depth: current.depth + 1 });
      }
    }
  }

  const queue: Array<{ directoryPath: string; depth: number }> = [{ directoryPath: rootPath, depth: 0 }];
  let scanned = 0;

  while (queue.length > 0 && scanned < maxScannedEntries && suggestions.size < maxSuggestions * 4) {
    const current = queue.shift();
    if (!current) {
      break;
    }
    const entries = await readDirectorySafe(current.directoryPath);
    for (const entry of entries) {
      if (scanned >= maxScannedEntries) {
        break;
      }
      scanned += 1;
      if (ignoredNames.has(entry.name)) {
        continue;
      }
      const candidatePath = path.join(current.directoryPath, entry.name);
      if (!isInside(rootPath, candidatePath)) {
        continue;
      }
      const candidate: CandidateEntry = {
        path: toReferencePath(rootPath, candidatePath),
        name: entry.name,
        type: entry.isDirectory() ? "directory" : "file"
      };
      const match = candidateMatch(candidate, query);
      if (match) {
        pushUnique(suggestions, {
          path: candidate.path,
          type: candidate.type,
          match
        });
      }
      if (entry.isDirectory() && current.depth < rootSearchDepth) {
        queue.push({ directoryPath: candidatePath, depth: current.depth + 1 });
      }
    }
  }

  return sortSuggestions(Array.from(suggestions.values()));
}

export async function getPathSuggestions(input: {
  targetProjectPath: string;
  query: string;
}): Promise<PathSuggestion[]> {
  const rootPath = path.resolve(input.targetProjectPath);
  const rootStat = await fs.stat(rootPath);
  if (!rootStat.isDirectory()) {
    throw new Error("Target project path must be a directory.");
  }

  const split = splitQuery(input.query);
  if (split.hasDirectoryPart) {
    const directoryPath = path.resolve(rootPath, split.directoryPart);
    if (!isInside(rootPath, directoryPath)) {
      return [];
    }
    return suggestFromDirectory({
      rootPath,
      directoryPath,
      namePart: split.namePart
    });
  }

  return suggestFromRootSearch(rootPath, split.namePart);
}
