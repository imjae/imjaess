import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";
import { listConventionNotes } from "@/lib/db";

export const dynamic = "force-dynamic";

const exportSchema = z.object({
  projectPath: z.string().min(1),
  writeFiles: z.boolean().optional().default(false)
});

function renderConventions(projectPath: string): { agents: string; conventions: string } {
  const notes = listConventionNotes(projectPath);
  const grouped = new Map<string, typeof notes>();
  for (const note of notes) {
    const key = `${note.ruleTarget}:${note.category}`;
    grouped.set(key, [...(grouped.get(key) || []), note]);
  }

  const conventions = [
    "# Unity Project Conventions",
    "",
    `Project: ${projectPath}`,
    "",
    ...[...grouped.entries()].flatMap(([key, categoryNotes]) => {
      const [ruleTarget, category] = key.split(":", 2);
      const targetLabel = ruleTarget === "research_planning" ? "Research And Planning" : "Implementation";
      return [
        `## ${category}`,
        "",
        `Applies to: ${targetLabel}`,
        "",
        ...categoryNotes.flatMap((note) => [
          `- ${note.rule}`,
          note.reason ? `  - Reason: ${note.reason}` : "",
          note.examples ? `  - Examples: ${note.examples}` : "",
          `  - Source: ${note.source}; confidence: ${note.confidence}`,
          ""
        ])
      ];
    })
  ]
    .filter(Boolean)
    .join("\n");

  const agents = [
    "# AGENTS.md",
    "",
    "## Project Guidance",
    "",
    "Follow the Unity conventions in `CONVENTIONS.md` before editing gameplay, UI, assets, or generated project files.",
    "",
    "## Verification",
    "",
    "- Prefer the project-configured verification command from the harness.",
    "- For Deluge-like Unity C# work, `dotnet build Deluge.sln --no-restore` is the default compile gate when available.",
    "- Preserve Unity `.meta` files and generated project-file sensitivity when adding or moving C# scripts.",
    "",
    "## Current Convention Summary",
    "",
    notes.length === 0 ? "- No convention notes recorded yet." : "- See `CONVENTIONS.md`."
  ].join("\n");

  return { agents, conventions };
}

export async function POST(request: Request): Promise<NextResponse> {
  const body = exportSchema.parse(await request.json());
  const projectPath = path.resolve(body.projectPath);
  const rendered = renderConventions(projectPath);

  if (body.writeFiles) {
    fs.writeFileSync(path.join(projectPath, "AGENTS.md"), rendered.agents, "utf8");
    fs.writeFileSync(path.join(projectPath, "CONVENTIONS.md"), rendered.conventions, "utf8");
  }

  return NextResponse.json({
    files: rendered,
    wrote: body.writeFiles
  });
}
