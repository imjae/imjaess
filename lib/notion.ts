import { Client } from "@notionhq/client";
import type { BlockObjectRequest } from "@notionhq/client/build/src/api-endpoints";
import { getNotionSettings, getNotionSync, getTaskDetail, upsertNotionSync } from "@/lib/db";
import { taskReportMarkdown, type TaskReportLanguage } from "@/lib/task-report";

function notionClient(): Client {
  if (!process.env.NOTION_TOKEN) {
    throw new Error("NOTION_TOKEN is not configured. Add it to .env.local and restart the dev server.");
  }
  return new Client({ auth: process.env.NOTION_TOKEN });
}

function normalizePageId(pageId: string): string {
  return pageId.trim().replace(/-/g, "");
}

function richText(text: string): Array<{ type: "text"; text: { content: string } }> {
  const chunks: Array<{ type: "text"; text: { content: string } }> = [];
  const normalized = text.slice(0, 18000);
  for (let index = 0; index < normalized.length; index += 1900) {
    chunks.push({
      type: "text",
      text: {
        content: normalized.slice(index, index + 1900)
      }
    });
  }
  return chunks.length > 0 ? chunks : [{ type: "text", text: { content: " " } }];
}

function markdownToBlocks(markdown: string): BlockObjectRequest[] {
  const blocks: BlockObjectRequest[] = [];
  const parts = markdown.split("\n");
  let paragraph: string[] = [];
  let code: string[] | null = null;

  function flushParagraph(): void {
    const text = paragraph.join("\n").trim();
    if (text) {
      blocks.push({
        object: "block",
        type: "paragraph",
        paragraph: { rich_text: richText(text) }
      });
    }
    paragraph = [];
  }

  for (const line of parts) {
    if (line.trim() === "```") {
      if (code) {
        blocks.push({
          object: "block",
          type: "code",
          code: {
            language: "plain text",
            rich_text: richText(code.join("\n"))
          }
        });
        code = null;
      } else {
        flushParagraph();
        code = [];
      }
      continue;
    }

    if (code) {
      code.push(line);
      continue;
    }

    if (line.startsWith("# ")) {
      flushParagraph();
      blocks.push({ object: "block", type: "heading_1", heading_1: { rich_text: richText(line.slice(2)) } });
      continue;
    }
    if (line.startsWith("## ")) {
      flushParagraph();
      blocks.push({ object: "block", type: "heading_2", heading_2: { rich_text: richText(line.slice(3)) } });
      continue;
    }
    if (line.startsWith("### ")) {
      flushParagraph();
      blocks.push({ object: "block", type: "heading_3", heading_3: { rich_text: richText(line.slice(4)) } });
      continue;
    }
    if (line.startsWith("- ")) {
      flushParagraph();
      blocks.push({
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: { rich_text: richText(line.slice(2)) }
      });
      continue;
    }
    if (line.trim() === "") {
      flushParagraph();
      continue;
    }
    paragraph.push(line);
  }
  flushParagraph();
  return blocks.slice(0, 95);
}

async function replaceChildren(client: Client, pageId: string, blocks: BlockObjectRequest[]): Promise<void> {
  let cursor: string | undefined;
  do {
    const response = await client.blocks.children.list({
      block_id: pageId,
      start_cursor: cursor
    });
    for (const block of response.results) {
      await client.blocks.delete({ block_id: block.id });
    }
    cursor = response.has_more ? response.next_cursor || undefined : undefined;
  } while (cursor);

  if (blocks.length > 0) {
    await client.blocks.children.append({
      block_id: pageId,
      children: blocks
    });
  }
}

export async function syncTaskToNotion(
  taskId: string,
  options: { language?: TaskReportLanguage } = {}
): Promise<{ pageId: string; url: string | null; markdown: string }> {
  const task = getTaskDetail(taskId);
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }
  const settings = getNotionSettings();
  if (!settings.parentPageId) {
    throw new Error("Notion parent page ID is not configured.");
  }

  const client = notionClient();
  const markdown = taskReportMarkdown(task, { language: options.language || "en" });
  const blocks = markdownToBlocks(markdown);
  const existing = getNotionSync(taskId);

  let pageId = existing?.notionPageId;
  let url = existing?.notionUrl || null;

  if (!pageId) {
    const page = await client.pages.create({
      parent: { page_id: normalizePageId(settings.parentPageId) },
      properties: {
        title: {
          title: richText(task.title)
        }
      },
      children: blocks
    });
    pageId = page.id;
    url = "url" in page && typeof page.url === "string" ? page.url : null;
  } else {
    await client.pages.update({
      page_id: pageId,
      properties: {
        title: {
          title: richText(task.title)
        }
      }
    });
    await replaceChildren(client, pageId, blocks);
  }

  upsertNotionSync({
    taskId,
    notionPageId: pageId,
    notionUrl: url
  });

  return { pageId, url, markdown };
}
