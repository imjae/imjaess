import { Client } from "@notionhq/client";
import type { BlockObjectRequest } from "@notionhq/client/build/src/api-endpoints";
import {
  getNotionSettings,
  getNotionSync,
  getProjectByPath,
  getTaskDetail,
  listTasks,
  updateNotionSettings,
  upsertImportedTask,
  upsertNotionSync
} from "@/lib/db";
import { taskReportMarkdown, type TaskReportLanguage } from "@/lib/task-report";
import type { Task, TaskPlanningMode, TaskStatus, TaskVerificationMode } from "@/lib/types";

const TASK_DATABASE_TITLE = "Oh My Codex Tasks";
const TASK_STATUSES: TaskStatus[] = [
  "queued",
  "running",
  "reviewing",
  "verifying",
  "waiting_for_user",
  "needs_fix",
  "ready_for_review",
  "done",
  "blocked",
  "canceled"
];
const TASK_PLANNING_MODES: TaskPlanningMode[] = ["direct", "plan"];
const TASK_VERIFICATION_MODES: TaskVerificationMode[] = ["fast", "balanced"];

type NotionPage = {
  id: string;
  url?: string;
  object?: string;
  archived?: boolean;
  in_trash?: boolean;
  parent?: { type?: string; data_source_id?: string };
  properties?: Record<string, unknown>;
};

type ImportedTask = {
  id: string;
  parentTaskId: string | null;
  taskTags: string[];
  title: string;
  goal: string;
  scope: string;
  targetProjectPath: string;
  worktreePath: string | null;
  agentPlan: string;
  planningMode: TaskPlanningMode;
  verificationMode: TaskVerificationMode;
  approvalGrant: boolean;
  status: TaskStatus;
  currentRound: number;
  failureReason: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  verificationCommand: string | null;
  notionPageId: string;
  notionUrl: string | null;
};

function notionClient(): Client {
  if (!process.env.NOTION_TOKEN) {
    throw new Error("NOTION_TOKEN is not configured. Add it to .env.local and restart the dev server.");
  }
  return new Client({ auth: process.env.NOTION_TOKEN });
}

function normalizePageId(pageId: string): string {
  return pageId.trim().replace(/-/g, "");
}

function plainRichText(items: unknown): string {
  if (!Array.isArray(items)) {
    return "";
  }
  return items.map((item) => (typeof item?.plain_text === "string" ? item.plain_text : "")).join("");
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

function titleProperty(text: string): unknown {
  return { title: richText(text) };
}

function richTextProperty(text: string | null | undefined): unknown {
  return { rich_text: richText(text || "") };
}

function selectProperty(name: string): unknown {
  return { select: { name } };
}

function multiSelectProperty(names: string[]): unknown {
  return { multi_select: names.filter(Boolean).map((name) => ({ name })) };
}

function dateProperty(value: string | null | undefined): unknown {
  return value ? { date: { start: value } } : { date: null };
}

function taskDatabaseProperties(): Record<string, unknown> {
  return {
    Name: { title: {} },
    "Task ID": { rich_text: {} },
    "Parent Task ID": { rich_text: {} },
    Status: {
      select: {
        options: TASK_STATUSES.map((name) => ({ name }))
      }
    },
    Tags: { multi_select: {} },
    Goal: { rich_text: {} },
    Scope: { rich_text: {} },
    "Target Project Path": { rich_text: {} },
    "Worktree Path": { rich_text: {} },
    "Agent Plan": { rich_text: {} },
    "Planning Mode": {
      select: {
        options: TASK_PLANNING_MODES.map((name) => ({ name }))
      }
    },
    "Verification Mode": {
      select: {
        options: TASK_VERIFICATION_MODES.map((name) => ({ name }))
      }
    },
    "Approval Grant": { checkbox: {} },
    "Current Round": { number: { format: "number" } },
    "Failure Reason": { rich_text: {} },
    "Created At": { date: {} },
    "Updated At": { date: {} },
    "Verification Command": { rich_text: {} }
  };
}

function taskPageProperties(task: Task): Record<string, unknown> {
  const verificationCommand = getProjectByPath(task.targetProjectPath)?.verificationCommand || "";
  return {
    Name: titleProperty(task.title),
    "Task ID": richTextProperty(task.id),
    "Parent Task ID": richTextProperty(task.parentTaskId || ""),
    Status: selectProperty(task.status),
    Tags: multiSelectProperty(task.tags || []),
    Goal: richTextProperty(task.goal),
    Scope: richTextProperty(task.scope),
    "Target Project Path": richTextProperty(task.targetProjectPath),
    "Worktree Path": richTextProperty(task.worktreePath || ""),
    "Agent Plan": richTextProperty(task.agentPlan),
    "Planning Mode": selectProperty(task.planningMode),
    "Verification Mode": selectProperty(task.verificationMode),
    "Approval Grant": { checkbox: task.approvalGrant },
    "Current Round": { number: task.currentRound },
    "Failure Reason": richTextProperty(task.failureReason || ""),
    "Created At": dateProperty(task.createdAt),
    "Updated At": dateProperty(task.updatedAt),
    "Verification Command": richTextProperty(verificationCommand)
  };
}

async function ensureTaskDataSourceSchema(client: Client, dataSourceId: string): Promise<void> {
  await client.dataSources.update({
    data_source_id: dataSourceId,
    properties: taskDatabaseProperties()
  } as never);
}

function property(properties: Record<string, unknown> | undefined, name: string): Record<string, unknown> {
  const value = properties?.[name];
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function titleValue(properties: Record<string, unknown> | undefined, name: string): string {
  return plainRichText(property(properties, name).title);
}

function richTextValue(properties: Record<string, unknown> | undefined, name: string): string {
  return plainRichText(property(properties, name).rich_text);
}

function selectValue(properties: Record<string, unknown> | undefined, name: string): string {
  const select = property(properties, name).select as { name?: unknown } | null | undefined;
  return typeof select?.name === "string" ? select.name : "";
}

function multiSelectValue(properties: Record<string, unknown> | undefined, name: string): string[] {
  const values = property(properties, name).multi_select;
  if (!Array.isArray(values)) {
    return [];
  }
  return values.map((item) => (typeof item?.name === "string" ? item.name : "")).filter(Boolean);
}

function checkboxValue(properties: Record<string, unknown> | undefined, name: string): boolean {
  return property(properties, name).checkbox === true;
}

function numberValue(properties: Record<string, unknown> | undefined, name: string): number {
  const value = property(properties, name).number;
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function dateValue(properties: Record<string, unknown> | undefined, name: string): string | null {
  const date = property(properties, name).date as { start?: unknown } | null | undefined;
  return typeof date?.start === "string" ? date.start : null;
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

function dataSourceFromDatabase(database: unknown): string | null {
  const dataSources = (database as { data_sources?: Array<{ id?: string }> }).data_sources || [];
  return typeof dataSources[0]?.id === "string" ? dataSources[0].id : null;
}

function isArchivedNotionObject(value: unknown): boolean {
  const object = value as { archived?: unknown; in_trash?: unknown };
  return object.archived === true || object.in_trash === true;
}

async function findTaskDatabases(client: Client, parentPageId: string): Promise<string[]> {
  const databaseIds: string[] = [];
  let cursor: string | undefined;
  do {
    const response = await client.blocks.children.list({
      block_id: normalizePageId(parentPageId),
      start_cursor: cursor
    });
    for (const block of response.results as Array<{ id: string; type?: string; child_database?: { title?: string } }>) {
      if (block.type === "child_database" && block.child_database?.title === TASK_DATABASE_TITLE) {
        databaseIds.push(block.id);
      }
    }
    cursor = response.has_more ? response.next_cursor || undefined : undefined;
  } while (cursor);
  return databaseIds;
}

async function ensureTaskDataSource(client: Client): Promise<{ databaseId: string; dataSourceId: string }> {
  const settings = getNotionSettings();
  if (!settings.parentPageId) {
    throw new Error("Notion parent page ID is not configured.");
  }

  if (settings.databaseId && settings.dataSourceId) {
    try {
      const [database, dataSource] = await Promise.all([
        client.databases.retrieve({ database_id: settings.databaseId }),
        client.dataSources.retrieve({ data_source_id: settings.dataSourceId })
      ]);
      if (!isArchivedNotionObject(database) && !isArchivedNotionObject(dataSource)) {
        await ensureTaskDataSourceSchema(client, settings.dataSourceId);
        return { databaseId: settings.databaseId, dataSourceId: settings.dataSourceId };
      }
    } catch {
      // Fall through and rediscover or recreate below.
    }
  }

  const discoveredDatabaseIds = await findTaskDatabases(client, settings.parentPageId);
  for (const discoveredDatabaseId of discoveredDatabaseIds) {
    const database = await client.databases.retrieve({ database_id: discoveredDatabaseId });
    const dataSourceId = dataSourceFromDatabase(database);
    if (!isArchivedNotionObject(database) && dataSourceId) {
      const dataSource = await client.dataSources.retrieve({ data_source_id: dataSourceId });
      if (!isArchivedNotionObject(dataSource)) {
        await ensureTaskDataSourceSchema(client, dataSourceId);
        updateNotionSettings({
          parentPageId: settings.parentPageId,
          databaseId: discoveredDatabaseId,
          dataSourceId
        });
        return { databaseId: discoveredDatabaseId, dataSourceId };
      }
    }
  }

  const database = await client.databases.create({
    parent: { type: "page_id", page_id: normalizePageId(settings.parentPageId) },
    title: richText(TASK_DATABASE_TITLE),
    initial_data_source: {
      properties: taskDatabaseProperties()
    }
  } as never);
  const databaseId = database.id;
  const dataSourceId = dataSourceFromDatabase(database);
  if (!dataSourceId) {
    throw new Error("Notion created the task database but did not return a data source ID.");
  }
  updateNotionSettings({
    parentPageId: settings.parentPageId,
    databaseId,
    dataSourceId
  });
  return { databaseId, dataSourceId };
}

async function findTaskPage(client: Client, dataSourceId: string, taskId: string): Promise<NotionPage | null> {
  const response = await client.dataSources.query({
    data_source_id: dataSourceId,
    filter: {
      property: "Task ID",
      rich_text: { equals: taskId }
    },
    page_size: 1
  } as never);
  const first = response.results.find((item) => item.object === "page") as NotionPage | undefined;
  return first || null;
}

async function queryTaskPages(client: Client, dataSourceId: string): Promise<NotionPage[]> {
  const pages: NotionPage[] = [];
  let cursor: string | undefined;
  do {
    const response = await client.dataSources.query({
      data_source_id: dataSourceId,
      start_cursor: cursor,
      page_size: 100
    } as never);
    pages.push(...(response.results.filter((item) => item.object === "page") as NotionPage[]));
    cursor = response.has_more ? response.next_cursor || undefined : undefined;
  } while (cursor);
  return pages;
}

function pageToImportedTask(page: NotionPage): ImportedTask | null {
  const props = page.properties;
  const id = richTextValue(props, "Task ID").trim();
  if (!id) {
    return null;
  }
  const status = selectValue(props, "Status") as TaskStatus;
  const safeStatus = TASK_STATUSES.includes(status) ? status : "queued";
  const planningMode = selectValue(props, "Planning Mode") as TaskPlanningMode;
  const verificationMode = selectValue(props, "Verification Mode") as TaskVerificationMode;
  return {
    id,
    parentTaskId: richTextValue(props, "Parent Task ID").trim() || null,
    taskTags: multiSelectValue(props, "Tags"),
    title: titleValue(props, "Name") || "Untitled Task",
    goal: richTextValue(props, "Goal"),
    scope: richTextValue(props, "Scope"),
    targetProjectPath: richTextValue(props, "Target Project Path"),
    worktreePath: richTextValue(props, "Worktree Path") || null,
    agentPlan: richTextValue(props, "Agent Plan"),
    planningMode: TASK_PLANNING_MODES.includes(planningMode) ? planningMode : "direct",
    verificationMode: TASK_VERIFICATION_MODES.includes(verificationMode) ? verificationMode : "fast",
    approvalGrant: checkboxValue(props, "Approval Grant"),
    status: safeStatus,
    currentRound: numberValue(props, "Current Round"),
    failureReason: richTextValue(props, "Failure Reason") || null,
    createdAt: dateValue(props, "Created At"),
    updatedAt: dateValue(props, "Updated At"),
    verificationCommand: richTextValue(props, "Verification Command") || null,
    notionPageId: page.id,
    notionUrl: page.url || null
  };
}

async function upsertTaskPage(input: {
  client: Client;
  dataSourceId: string;
  task: Task;
  blocks: BlockObjectRequest[];
}): Promise<{ pageId: string; url: string | null }> {
  const existingSync = getNotionSync(input.task.id);
  let pageId = existingSync?.notionPageId;
  let url = existingSync?.notionUrl || null;

  if (pageId) {
    try {
      const page = (await input.client.pages.retrieve({ page_id: pageId })) as NotionPage;
      const parentDataSourceId = page.parent?.type === "data_source_id" ? page.parent.data_source_id : null;
      if (isArchivedNotionObject(page) || parentDataSourceId !== input.dataSourceId) {
        pageId = undefined;
        url = null;
      }
    } catch {
      pageId = undefined;
      url = null;
    }
  }

  if (!pageId) {
    const existingPage = await findTaskPage(input.client, input.dataSourceId, input.task.id);
    pageId = existingPage?.id;
    url = existingPage?.url || null;
  }

  if (!pageId) {
    const page = await input.client.pages.create({
      parent: { type: "data_source_id", data_source_id: input.dataSourceId },
      properties: taskPageProperties(input.task),
      children: input.blocks
    } as never);
    pageId = page.id;
    url = "url" in page && typeof page.url === "string" ? page.url : null;
  } else {
    try {
      const page = await input.client.pages.update({
        page_id: pageId,
        properties: taskPageProperties(input.task)
      } as never);
      url = "url" in page && typeof page.url === "string" ? page.url : url;
      await replaceChildren(input.client, pageId, input.blocks);
    } catch {
      const page = await input.client.pages.create({
        parent: { type: "data_source_id", data_source_id: input.dataSourceId },
        properties: taskPageProperties(input.task),
        children: input.blocks
      } as never);
      pageId = page.id;
      url = "url" in page && typeof page.url === "string" ? page.url : null;
    }
  }

  return { pageId, url };
}

export async function syncTaskToNotion(
  taskId: string,
  options: { language?: TaskReportLanguage } = {}
): Promise<{ pageId: string; url: string | null; markdown: string }> {
  const task = getTaskDetail(taskId);
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }

  const client = notionClient();
  const { dataSourceId } = await ensureTaskDataSource(client);
  const markdown = taskReportMarkdown(task, { language: options.language || "en" });
  const blocks = markdownToBlocks(markdown);
  const result = await upsertTaskPage({ client, dataSourceId, task, blocks });

  upsertNotionSync({
    taskId,
    notionPageId: result.pageId,
    notionUrl: result.url
  });

  return { pageId: result.pageId, url: result.url, markdown };
}

export async function syncAllTasksToNotion(
  options: { language?: TaskReportLanguage } = {}
): Promise<{ pushed: number; databaseId: string; dataSourceId: string }> {
  const client = notionClient();
  const { databaseId, dataSourceId } = await ensureTaskDataSource(client);
  const tasks = listTasks();
  for (const task of tasks) {
    await syncTaskToNotion(task.id, options);
  }
  return { pushed: tasks.length, databaseId, dataSourceId };
}

export async function importTasksFromNotion(): Promise<{ imported: number; databaseId: string; dataSourceId: string }> {
  const client = notionClient();
  const { databaseId, dataSourceId } = await ensureTaskDataSource(client);
  const pages = await queryTaskPages(client, dataSourceId);
  const incoming = pages.map(pageToImportedTask).filter((task): task is ImportedTask => Boolean(task));
  const pending = [...incoming];
  const incomingIds = new Set(incoming.map((task) => task.id));
  const imported = new Set<string>();

  while (pending.length > 0) {
    let progressed = false;
    for (let index = 0; index < pending.length; index += 1) {
      const task = pending[index];
      const parentReady = !task.parentTaskId || imported.has(task.parentTaskId) || !incomingIds.has(task.parentTaskId);
      if (!parentReady) {
        continue;
      }
      upsertImportedTask(task);
      imported.add(task.id);
      pending.splice(index, 1);
      progressed = true;
      index -= 1;
    }
    if (!progressed) {
      for (const task of pending.splice(0)) {
        upsertImportedTask({ ...task, parentTaskId: null });
        imported.add(task.id);
      }
    }
  }

  return { imported: imported.size, databaseId, dataSourceId };
}
