import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getTask, insertTaskAttachment } from "@/lib/db";
import type { TaskAttachment } from "@/lib/types";

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MIME_EXTENSIONS: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif"
};
const DEFAULT_ATTACHMENT_ROOT = path.join(/*turbopackIgnore: true*/ process.cwd(), ".data", "attachments");

function attachmentRoot(): string {
  const configuredPath = process.env.HARNESS_ATTACHMENT_DIR?.trim();
  if (!configuredPath) {
    return DEFAULT_ATTACHMENT_ROOT;
  }
  if (!path.isAbsolute(configuredPath)) {
    throw new Error("HARNESS_ATTACHMENT_DIR must be an absolute path.");
  }
  return configuredPath;
}

function cleanOriginalName(name: string): string {
  const baseName = path.basename(name).trim();
  return baseName.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_") || "image";
}

export function isSupportedImageMime(mimeType: string): boolean {
  return Object.prototype.hasOwnProperty.call(MIME_EXTENSIONS, mimeType);
}

export async function saveTaskImageAttachment(input: {
  taskId: string;
  file: File;
}): Promise<TaskAttachment> {
  const task = getTask(input.taskId);
  if (!task) {
    throw new Error("Task not found");
  }
  if (!isSupportedImageMime(input.file.type)) {
    throw new Error("Only png, jpg, webp, and gif image files can be attached.");
  }
  if (input.file.size > MAX_IMAGE_BYTES) {
    throw new Error("Image attachment is too large. Maximum size is 12 MB.");
  }

  const originalName = cleanOriginalName(input.file.name);
  const extension = MIME_EXTENSIONS[input.file.type];
  const taskDir = path.join(/*turbopackIgnore: true*/ attachmentRoot(), input.taskId);
  fs.mkdirSync(taskDir, { recursive: true });

  const storedPath = path.join(/*turbopackIgnore: true*/ taskDir, `${randomUUID()}${extension}`);
  const bytes = Buffer.from(await input.file.arrayBuffer());
  fs.writeFileSync(storedPath, bytes, { flag: "wx" });

  return insertTaskAttachment({
    taskId: input.taskId,
    originalName,
    storedPath,
    mimeType: input.file.type,
    sizeBytes: bytes.byteLength
  });
}
