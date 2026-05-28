"use client";

import type React from "react";
import { ChangeEvent, FormEvent, Fragment, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  Bot,
  CheckCircle2,
  CircleAlert,
  CircleDashed,
  Clock3,
  FolderOpen,
  Gauge,
  GripHorizontal,
  GitBranch,
  ImageIcon,
  Link2,
  LoaderCircle,
  MessageSquareText,
  Paperclip,
  Play,
  ShieldCheck,
  Sparkles,
  StopCircle,
  Trash2,
  Workflow,
  X
} from "lucide-react";
import type {
  AgentRun,
  BrokerArtifact,
  Task,
  TaskDetail,
  TaskPlanningMode,
  TaskVerificationMode,
  Verification
} from "@/lib/types";
import { repositoryName } from "@/lib/repository-name";
import styles from "./simple.module.css";

const defaultProjectPath = "D:\\dev\\Deluge";
const conversationStorageKey = "oh-my-codex-simple-conversation";
const settingsStorageKey = "oh-my-codex-simple-settings";
const agentSummaryHeightStorageKey = "oh-my-codex-simple-agent-summary-height";
const defaultAgentSummaryHeight = 260;
const minAgentSummaryHeight = 140;

type SimpleSettings = {
  targetProjectPath: string;
  baseBranch: string;
  planningMode: TaskPlanningMode;
  verificationMode: TaskVerificationMode;
  verificationCommand: string;
  approvalGrant: boolean;
};

type TasksResponse = {
  tasks: Task[];
};

type TaskResponse = {
  task: TaskDetail;
};

type LocalBranch = {
  name: string;
  isCurrent: boolean;
};

type BranchesResponse = {
  root: string;
  branches: LocalBranch[];
};

type FolderBrowserEntry = {
  name: string;
  path: string;
};

type FolderBrowserResult = {
  currentPath: string;
  parentPath: string | null;
  roots: string[];
  entries: FolderBrowserEntry[];
};

type PathSuggestion = {
  path: string;
  type: "file" | "directory";
  match: "exact" | "contains";
};

type ScopeMention = {
  start: number;
  end: number;
  query: string;
};

const defaultSettings: SimpleSettings = {
  targetProjectPath: defaultProjectPath,
  baseBranch: "",
  planningMode: "direct",
  verificationMode: "fast",
  verificationCommand: "",
  approvalGrant: true
};

const statusLabels: Record<Task["status"], string> = {
  queued: "대기 중",
  running: "실행 중",
  reviewing: "검토 중",
  verifying: "검증 중",
  waiting_for_user: "답변 대기",
  needs_fix: "수정 필요",
  ready_for_review: "검토 대기",
  done: "완료",
  blocked: "차단됨",
  canceled: "중단됨"
};

const artifactLabels: Record<BrokerArtifact["kind"], string> = {
  evidence_pack: "조사 근거",
  plan_questions: "Planner 질문",
  plan_answer: "Planner 답변",
  plan_brief: "구현 계획 요약",
  implementation_brief: "구현 요약",
  test_brief: "테스트 요약",
  test_result: "테스트 결과",
  final_brief: "최종 요약"
};

const roleLabels: Record<AgentRun["role"], string> = {
  researcher: "Researcher",
  planner: "Planner",
  implementer: "Implementer",
  tester: "Tester",
  verifier: "Verifier"
};

const visibleArtifactKinds = new Set<BrokerArtifact["kind"]>([
  "plan_questions",
  "plan_answer",
  "plan_brief",
  "implementation_brief",
  "test_result",
  "final_brief"
]);

function classNames(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

function safeRefPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "item";
}

function reviewBranchName(taskId: string): string {
  return `harness/review/${safeRefPart(taskId)}`;
}

function trimText(text: string, max = 900): string {
  const normalized = text.trim();
  if (normalized.length <= max) {
    return normalized;
  }
  return `${normalized.slice(0, max).trimEnd()}\n...`;
}

function titleFromPrompt(prompt: string): string {
  const firstLine = prompt.trim().split(/\r?\n/)[0] || "Simple UI task";
  return firstLine.length <= 72 ? firstLine : `${firstLine.slice(0, 69).trimEnd()}...`;
}

function normalizeTaskTags(input: string): string[] {
  return Array.from(
    new Set(
      input
        .split(/[\s,]+/)
        .map((tag) => tag.trim().replace(/^#+/, ""))
        .filter(Boolean)
    )
  );
}

function tailPath(text: string, max = 54): string {
  if (text.length <= max) {
    return text;
  }
  return `...${text.slice(-(max - 3))}`;
}

function activeScopeMention(value: string, cursor: number): ScopeMention | null {
  const beforeCursor = value.slice(0, cursor);
  const match = beforeCursor.match(/@(?:"([^"]*)$|'([^']*)$|`([^`]*)$|([^\s,;]*)$)/);
  if (!match || match.index === undefined) {
    return null;
  }
  const query = match[1] ?? match[2] ?? match[3] ?? match[4] ?? "";
  return {
    start: match.index,
    end: cursor,
    query: query.trim()
  };
}

function userPromptFromTask(task: TaskDetail): string {
  const marker = "\n\nParent task context summary follows.";
  const markerIndex = task.goal.indexOf(marker);
  const prompt = markerIndex >= 0 ? task.goal.slice(0, markerIndex) : task.goal;
  return trimText(prompt, 1200);
}

function latestArtifact(task: TaskDetail | null, kind: BrokerArtifact["kind"]): BrokerArtifact | null {
  if (!task) {
    return null;
  }
  return [...task.brokerArtifacts].reverse().find((artifact) => artifact.kind === kind) || null;
}

function latestVerification(task: TaskDetail): Verification | null {
  return [...task.verifications].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] || null;
}

function canCancelTask(task: Task): boolean {
  return ["queued", "running", "reviewing", "verifying", "waiting_for_user", "needs_fix"].includes(task.status);
}

function formatTime(value: string): string {
  try {
    return new Intl.DateTimeFormat("ko-KR", {
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date(value));
  } catch {
    return "";
  }
}

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {})
    }
  });
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error || `Request failed: ${response.status}`);
  }
  return payload;
}

async function uploadImages(taskId: string, files: File[]): Promise<void> {
  if (files.length === 0) {
    return;
  }
  const formData = new FormData();
  for (const file of files) {
    formData.append("images", file);
  }
  const response = await fetch(`/api/tasks/${taskId}/attachments`, {
    method: "POST",
    body: formData
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error || `Attachment upload failed: ${response.status}`);
  }
}

function loadStoredConversation(): string[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const parsed = JSON.parse(window.localStorage.getItem(conversationStorageKey) || "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function loadStoredSettings(): SimpleSettings {
  if (typeof window === "undefined") {
    return defaultSettings;
  }
  try {
    const parsed = JSON.parse(window.localStorage.getItem(settingsStorageKey) || "{}") as Partial<SimpleSettings>;
    return {
      targetProjectPath: parsed.targetProjectPath || defaultSettings.targetProjectPath,
      baseBranch: parsed.baseBranch || "",
      planningMode: parsed.planningMode === "plan" ? "plan" : "direct",
      verificationMode: parsed.verificationMode === "balanced" ? "balanced" : "fast",
      verificationCommand: parsed.verificationCommand || "",
      approvalGrant: typeof parsed.approvalGrant === "boolean" ? parsed.approvalGrant : true
    };
  } catch {
    return defaultSettings;
  }
}

function clampAgentSummaryHeight(value: number): number {
  return Math.max(minAgentSummaryHeight, Math.round(value));
}

function loadStoredAgentSummaryHeight(): number {
  if (typeof window === "undefined") {
    return defaultAgentSummaryHeight;
  }
  const parsed = Number.parseInt(window.localStorage.getItem(agentSummaryHeightStorageKey) || "", 10);
  return Number.isFinite(parsed) ? clampAgentSummaryHeight(parsed) : defaultAgentSummaryHeight;
}

export default function SimplePage(): React.ReactElement {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messageInputRef = useRef<HTMLTextAreaElement | null>(null);
  const [message, setMessage] = useState("");
  const [conversationIds, setConversationIds] = useState<string[]>([]);
  const [taskDetails, setTaskDetails] = useState<TaskDetail[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [settings, setSettings] = useState<SimpleSettings>(defaultSettings);
  const [tagInput, setTagInput] = useState("");
  const [pendingImages, setPendingImages] = useState<File[]>([]);
  const [localBranches, setLocalBranches] = useState<LocalBranch[]>([]);
  const [branchError, setBranchError] = useState<string | null>(null);
  const [isLoadingBranches, setLoadingBranches] = useState(false);
  const [isFolderBrowserOpen, setFolderBrowserOpen] = useState(false);
  const [isLoadingFolders, setLoadingFolders] = useState(false);
  const [folderBrowser, setFolderBrowser] = useState<FolderBrowserResult | null>(null);
  const [folderBrowserError, setFolderBrowserError] = useState<string | null>(null);
  const [scopeMention, setScopeMention] = useState<ScopeMention | null>(null);
  const [pathSuggestions, setPathSuggestions] = useState<PathSuggestion[]>([]);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
  const [isLoadingSuggestions, setLoadingSuggestions] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agentSummaryHeight, setAgentSummaryHeight] = useState(defaultAgentSummaryHeight);

  const activeTask = taskDetails[taskDetails.length - 1] || null;
  const plannerQuestions = latestArtifact(activeTask, "plan_questions");
  const isAnsweringPlanner = activeTask?.status === "waiting_for_user" && Boolean(plannerQuestions);
  const canSend = message.trim().length > 0 && !isSending;
  const selectedBranch =
    settings.baseBranch || localBranches.find((branch) => branch.isCurrent)?.name || localBranches[0]?.name || "";
  const taskTags = normalizeTaskTags(tagInput);

  const orderedDetails = useMemo(() => {
    const byId = new Map(taskDetails.map((task) => [task.id, task]));
    return conversationIds.map((id) => byId.get(id)).filter((task): task is TaskDetail => Boolean(task));
  }, [conversationIds, taskDetails]);

  useEffect(() => {
    setConversationIds(loadStoredConversation());
    setSettings(loadStoredSettings());
    setAgentSummaryHeight(loadStoredAgentSummaryHeight());
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }
    window.localStorage.setItem(conversationStorageKey, JSON.stringify(conversationIds));
  }, [conversationIds, isHydrated]);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }
    window.localStorage.setItem(settingsStorageKey, JSON.stringify(settings));
  }, [settings, isHydrated]);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }
    window.localStorage.setItem(agentSummaryHeightStorageKey, String(agentSummaryHeight));
  }, [agentSummaryHeight, isHydrated]);

  async function refreshConversation(ids = conversationIds): Promise<void> {
    const tasksData = await jsonFetch<TasksResponse>("/api/tasks");
    setTasks(tasksData.tasks);
    if (ids.length === 0) {
      return;
    }
    const details = await Promise.all(
      ids.map(async (taskId) => {
        try {
          const data = await jsonFetch<TaskResponse>(`/api/tasks/${taskId}`);
          return data.task;
        } catch {
          return null;
        }
      })
    );
    const existingDetails = details.filter((task): task is TaskDetail => Boolean(task));
    setTaskDetails(existingDetails);
    if (existingDetails.length !== ids.length) {
      setConversationIds(existingDetails.map((task) => task.id));
    }
  }

  useEffect(() => {
    if (!isHydrated) {
      return;
    }
    void refreshConversation().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
    const interval = window.setInterval(() => {
      void refreshConversation().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
    }, 1500);
    return () => window.clearInterval(interval);
  }, [conversationIds.join("|"), isHydrated]);

  useEffect(() => {
    if (!isHydrated || !settings.targetProjectPath.trim()) {
      return;
    }
    const controller = new AbortController();
    setLoadingBranches(true);
    setBranchError(null);
    void jsonFetch<BranchesResponse>(
      `/api/git/branches?targetProjectPath=${encodeURIComponent(settings.targetProjectPath)}`,
      { signal: controller.signal }
    )
      .then((data) => {
        setLocalBranches(data.branches);
        setSettings((current) => {
          if (current.baseBranch && data.branches.some((branch) => branch.name === current.baseBranch)) {
            return current;
          }
          return {
            ...current,
            baseBranch: data.branches.find((branch) => branch.isCurrent)?.name || data.branches[0]?.name || ""
          };
        });
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }
        setLocalBranches([]);
        setBranchError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoadingBranches(false);
        }
      });
    return () => controller.abort();
  }, [isHydrated, settings.targetProjectPath]);

  useEffect(() => {
    if (!scopeMention) {
      setPathSuggestions([]);
      setSelectedSuggestionIndex(0);
      setLoadingSuggestions(false);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoadingSuggestions(true);
      void jsonFetch<{ suggestions: PathSuggestion[] }>("/api/path-suggestions", {
        method: "POST",
        signal: controller.signal,
        body: JSON.stringify({
          targetProjectPath: settings.targetProjectPath,
          query: scopeMention.query
        })
      })
        .then((data) => {
          setPathSuggestions(data.suggestions);
          setSelectedSuggestionIndex(0);
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === "AbortError") {
            return;
          }
          setPathSuggestions([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setLoadingSuggestions(false);
          }
        });
    }, 150);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [scopeMention, settings.targetProjectPath]);

  function addPendingImages(files: FileList | null): void {
    if (!files) {
      return;
    }
    const images = Array.from(files).filter((file) => file.type.startsWith("image/"));
    if (images.length === 0) {
      setError("이미지 파일만 첨부할 수 있습니다.");
      return;
    }
    setError(null);
    setPendingImages((current) => [...current, ...images]);
  }

  async function attachImagesAndMaybeStart(taskId: string, files: File[], shouldStartAfterUpload: boolean): Promise<void> {
    await uploadImages(taskId, files);
    if (shouldStartAfterUpload) {
      await jsonFetch(`/api/tasks/${taskId}/start`, { method: "POST" });
    }
  }

  async function createRootTask(prompt: string): Promise<Task> {
    const shouldDelayStart = settings.approvalGrant && pendingImages.length > 0;
    const data = await jsonFetch<{ task: Task }>("/api/tasks", {
      method: "POST",
      body: JSON.stringify({
        title: titleFromPrompt(prompt),
        taskTags,
        taskGroup: taskTags[0] || "",
        goal: prompt,
        scope: "Submitted from the Simple UI chat surface.",
        targetProjectPath: settings.targetProjectPath,
        baseBranch: selectedBranch,
        planningMode: settings.planningMode,
        verificationMode: settings.verificationMode,
        verificationCommand: settings.verificationCommand,
        approvalGrant: shouldDelayStart ? false : settings.approvalGrant
      })
    });
    await attachImagesAndMaybeStart(data.task.id, pendingImages, shouldDelayStart);
    return data.task;
  }

  async function createFollowUpTask(parentTaskId: string, prompt: string): Promise<Task> {
    const shouldDelayStart = settings.approvalGrant && pendingImages.length > 0;
    const data = await jsonFetch<{ task: Task }>(`/api/tasks/${parentTaskId}/follow-up`, {
      method: "POST",
      body: JSON.stringify({
        message: prompt,
        baseBranch: selectedBranch,
        verificationCommand: settings.verificationCommand,
        approvalGrant: shouldDelayStart ? false : settings.approvalGrant
      })
    });
    await attachImagesAndMaybeStart(data.task.id, pendingImages, shouldDelayStart);
    return data.task;
  }

  async function cancelTask(taskId: string): Promise<void> {
    setError(null);
    try {
      await jsonFetch(`/api/tasks/${taskId}/cancel`, { method: "POST" });
      await refreshConversation();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function submitMessage(event?: FormEvent): Promise<void> {
    event?.preventDefault();
    const prompt = message.trim();
    if (!prompt || isSending) {
      return;
    }
    setIsSending(true);
    setError(null);
    try {
      if (isAnsweringPlanner && activeTask) {
        await jsonFetch(`/api/tasks/${activeTask.id}/plan-answer`, {
          method: "POST",
          body: JSON.stringify({ answer: prompt })
        });
      } else if (!activeTask) {
        const task = await createRootTask(prompt);
        setConversationIds([task.id]);
      } else {
        const task = await createFollowUpTask(activeTask.id, prompt);
        setConversationIds((current) => [...current, task.id]);
      }
      setMessage("");
      setPendingImages([]);
      await refreshConversation();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSending(false);
    }
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (scopeMention) {
      if (pathSuggestions.length > 0 && event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedSuggestionIndex((current) => (current + 1) % pathSuggestions.length);
        return;
      }
      if (pathSuggestions.length > 0 && event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedSuggestionIndex((current) => (current - 1 + pathSuggestions.length) % pathSuggestions.length);
        return;
      }
      if (pathSuggestions.length > 0 && event.key === "Tab") {
        event.preventDefault();
        insertScopeSuggestion(pathSuggestions[selectedSuggestionIndex]);
        return;
      }
      if (event.key === "Escape") {
        setScopeMention(null);
        setPathSuggestions([]);
        return;
      }
    }
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submitMessage();
    }
  }

  function updateScopeMention(textArea: HTMLTextAreaElement): void {
    setScopeMention(activeScopeMention(textArea.value, textArea.selectionStart));
  }

  function insertScopeSuggestion(suggestion: PathSuggestion): void {
    if (!scopeMention) {
      return;
    }
    const textArea = messageInputRef.current;
    const needsQuotes = /\s/.test(suggestion.path);
    const replacement = needsQuotes ? `@"${suggestion.path}"` : `@${suggestion.path}`;
    const nextMessage = `${message.slice(0, scopeMention.start)}${replacement}${message.slice(scopeMention.end)}`;
    const nextCursor = scopeMention.start + replacement.length;

    setMessage(nextMessage);
    setScopeMention(null);
    setPathSuggestions([]);

    window.setTimeout(() => {
      textArea?.focus();
      textArea?.setSelectionRange(nextCursor, nextCursor);
    }, 0);
  }

  function updateSettings(next: Partial<SimpleSettings>): void {
    setSettings((current) => ({ ...current, ...next }));
  }

  async function loadFolderBrowser(pathValue: string): Promise<void> {
    setLoadingFolders(true);
    setFolderBrowserError(null);
    try {
      const data = await jsonFetch<{ result: FolderBrowserResult }>("/api/folder-browser", {
        method: "POST",
        body: JSON.stringify({ path: pathValue })
      });
      setFolderBrowser(data.result);
    } catch (err) {
      setFolderBrowserError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingFolders(false);
    }
  }

  function openFolderBrowser(): void {
    setFolderBrowserOpen(true);
    void loadFolderBrowser(settings.targetProjectPath);
  }

  function selectWorkspaceFolder(pathValue: string): void {
    updateSettings({ targetProjectPath: pathValue, baseBranch: "" });
    setFolderBrowserOpen(false);
  }

  function clearConversation(): void {
    setConversationIds([]);
    setTaskDetails([]);
    setMessage("");
    setTagInput("");
    setPendingImages([]);
    setError(null);
  }

  function startAgentSummaryResize(event: React.PointerEvent<HTMLButtonElement>): void {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = agentSummaryHeight;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;

    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none";

    const handlePointerMove = (moveEvent: PointerEvent) => {
      setAgentSummaryHeight(clampAgentSummaryHeight(startHeight + moveEvent.clientY - startY));
    };
    const handlePointerUp = () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
    window.addEventListener("pointercancel", handlePointerUp, { once: true });
  }

  return (
    <main className={styles.simpleShell}>
      <section className={classNames(styles.heroStage, orderedDetails.length > 0 && styles.hasConversation)}>
        <div className={styles.topStrip}>
          <a className={styles.dashboardLink} href="/">
            <Workflow size={16} aria-hidden="true" />
            Dashboard
          </a>
          <button className={styles.ghostButton} onClick={clearConversation} type="button">
            <Trash2 size={15} aria-hidden="true" />
            새 대화
          </button>
        </div>

        <div className={styles.heroInner}>
          <h1 className={styles.headline}>{repositoryName}에서 무엇을 빌드할까요?</h1>
          <ConversationTranscript
            activeTaskId={activeTask?.id || null}
            agentSummaryHeight={agentSummaryHeight}
            details={orderedDetails}
            onCancelTask={cancelTask}
            onSummaryResizeStart={startAgentSummaryResize}
            plannerQuestions={plannerQuestions}
          />
          <form className={styles.composer} onSubmit={(event) => void submitMessage(event)}>
            {isAnsweringPlanner ? (
              <div className={styles.modeNotice}>
                <CircleAlert size={16} aria-hidden="true" />
                Planner가 답변을 기다리고 있습니다. 아래 입력은 새 작업이 아니라 planner answer로 제출됩니다.
              </div>
            ) : null}
            <textarea
              ref={messageInputRef}
              aria-label={isAnsweringPlanner ? "Planner 답변" : "Simple UI 메시지"}
              className={styles.composerInput}
              disabled={isSending}
              onChange={(event) => {
                setMessage(event.target.value);
                updateScopeMention(event.target);
              }}
              onClick={(event) => updateScopeMention(event.currentTarget)}
              onKeyDown={handleComposerKeyDown}
              onKeyUp={(event) => updateScopeMention(event.currentTarget)}
              placeholder={
                isAnsweringPlanner
                  ? "planner 질문에 답변하기"
                  : "지금 만든 하네스에서 무엇을 만들지 입력하세요"
              }
              rows={3}
              value={message}
            />
            {scopeMention ? (
              <div className={styles.pathSuggestions} role="listbox" aria-label="채팅 경로 추천">
                <div className={styles.suggestionHint}>
                  {isLoadingSuggestions
                    ? "대상 프로젝트 검색 중..."
                    : pathSuggestions.length > 0
                      ? "Enter/Tab으로 선택 경로 삽입"
                      : "일치하는 파일 또는 폴더가 없습니다"}
                </div>
                {pathSuggestions.map((suggestion, index) => (
                  <Fragment key={`${suggestion.type}:${suggestion.path}`}>
                    {suggestion.match === "contains" && pathSuggestions[index - 1]?.match === "exact" ? (
                      <div className={styles.suggestionDivider}>포함 일치</div>
                    ) : null}
                    <button
                      aria-selected={index === selectedSuggestionIndex}
                      className={classNames(styles.suggestionItem, index === selectedSuggestionIndex && styles.suggestionItemActive)}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        insertScopeSuggestion(suggestion);
                      }}
                      role="option"
                      type="button"
                    >
                      <span className={styles.suggestionType}>{suggestion.type === "directory" ? "DIR" : "FILE"}</span>
                      <span className={styles.suggestionPath} title={suggestion.path}>
                        {tailPath(suggestion.path)}
                      </span>
                    </button>
                  </Fragment>
                ))}
              </div>
            ) : null}
            <div className={styles.tagRow}>
              <span>#</span>
              <input
                aria-label="task tags"
                disabled={Boolean(activeTask) || isAnsweringPlanner || isSending}
                onChange={(event) => setTagInput(event.target.value)}
                placeholder="#태그 입력, 공백 또는 쉼표로 여러 개"
                value={tagInput}
              />
            </div>
            {pendingImages.length > 0 ? (
              <div className={styles.attachmentTray}>
                {pendingImages.map((file, index) => (
                  <span className={styles.attachmentChip} key={`${file.name}:${file.lastModified}:${index}`}>
                    <ImageIcon size={13} aria-hidden="true" />
                    {file.name}
                    <button
                      aria-label={`${file.name} 제거`}
                      onClick={() => setPendingImages((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                      type="button"
                    >
                      <X size={12} aria-hidden="true" />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
            <div className={styles.toolbar}>
              <input
                ref={fileInputRef}
                accept="image/*"
                className={styles.fileInput}
                multiple
                onChange={(event: ChangeEvent<HTMLInputElement>) => {
                  addPendingImages(event.target.files);
                  event.target.value = "";
                }}
                type="file"
              />
              <button
                className={styles.iconTool}
                disabled={isAnsweringPlanner}
                onClick={() => fileInputRef.current?.click()}
                title="이미지 첨부"
                type="button"
              >
                <Paperclip size={18} aria-hidden="true" />
              </button>
              <ToolbarSelect
                icon={<FolderOpen size={15} aria-hidden="true" />}
                label="workspace"
                onBrowse={openFolderBrowser}
                value={settings.targetProjectPath}
                onChange={(value) => updateSettings({ targetProjectPath: value, baseBranch: "" })}
              />
              <BranchSelect
                branches={localBranches}
                error={branchError}
                isLoading={isLoadingBranches}
                onChange={(baseBranch) => updateSettings({ baseBranch })}
                value={selectedBranch}
              />
              <button
                className={styles.segment}
                onClick={() => updateSettings({ planningMode: settings.planningMode === "direct" ? "plan" : "direct" })}
                type="button"
              >
                <MessageSquareText size={14} aria-hidden="true" />
                {settings.planningMode === "direct" ? "Direct" : "Plan"}
              </button>
              <button
                className={styles.segment}
                onClick={() =>
                  updateSettings({ verificationMode: settings.verificationMode === "fast" ? "balanced" : "fast" })
                }
                type="button"
              >
                <Gauge size={14} aria-hidden="true" />
                {settings.verificationMode === "fast" ? "Fast" : "Balanced"}
              </button>
              <button
                aria-pressed={settings.approvalGrant}
                className={classNames(styles.segment, settings.approvalGrant && styles.segmentActive)}
                onClick={() => updateSettings({ approvalGrant: !settings.approvalGrant })}
                title="task-level CLI permission"
                type="button"
              >
                <ShieldCheck size={14} aria-hidden="true" />
                권한
              </button>
              <button className={styles.sendButton} disabled={!canSend} type="submit" title="Ctrl+Enter">
                {isSending ? <LoaderCircle className={styles.spin} size={19} aria-hidden="true" /> : <ArrowUp size={19} aria-hidden="true" />}
              </button>
            </div>
            {error ? <div className={styles.errorLine}>{error}</div> : null}
          </form>
          {isFolderBrowserOpen ? (
            <div className={styles.folderBackdrop} role="presentation" onMouseDown={() => setFolderBrowserOpen(false)}>
              <section
                aria-modal="true"
                className={styles.folderModal}
                role="dialog"
                onMouseDown={(event) => event.stopPropagation()}
              >
                <div className={styles.folderHeader}>
                  <strong>Workspace 선택</strong>
                  <button onClick={() => setFolderBrowserOpen(false)} type="button">
                    닫기
                  </button>
                </div>
                <div className={styles.folderActions}>
                  <button
                    disabled={!folderBrowser?.parentPath || isLoadingFolders}
                    onClick={() => folderBrowser?.parentPath && void loadFolderBrowser(folderBrowser.parentPath)}
                    type="button"
                  >
                    상위
                  </button>
                  <button
                    disabled={!folderBrowser?.currentPath}
                    onClick={() => folderBrowser?.currentPath && selectWorkspaceFolder(folderBrowser.currentPath)}
                    type="button"
                  >
                    이 폴더 선택
                  </button>
                </div>
                <div className={styles.folderCurrentPath} title={folderBrowser?.currentPath || ""}>
                  {folderBrowser?.currentPath || "Loading..."}
                </div>
                {folderBrowser?.roots.length ? (
                  <div className={styles.folderRoots}>
                    {folderBrowser.roots.map((root) => (
                      <button key={root} onClick={() => void loadFolderBrowser(root)} title={root} type="button">
                        {root}
                      </button>
                    ))}
                  </div>
                ) : null}
                {folderBrowserError ? <div className={styles.folderError}>{folderBrowserError}</div> : null}
                <div className={styles.folderList}>
                  {isLoadingFolders ? <div className={styles.folderEmpty}>폴더를 불러오는 중...</div> : null}
                  {!isLoadingFolders && folderBrowser?.entries.length === 0 ? (
                    <div className={styles.folderEmpty}>하위 폴더가 없습니다.</div>
                  ) : null}
                  {!isLoadingFolders
                    ? folderBrowser?.entries.map((entry) => (
                        <button key={entry.path} onClick={() => void loadFolderBrowser(entry.path)} title={entry.path} type="button">
                          <FolderOpen size={15} aria-hidden="true" />
                          <span>{entry.name}</span>
                        </button>
                      ))
                    : null}
                </div>
              </section>
            </div>
          ) : null}
          <RecentTasks tasks={tasks} activeTaskId={activeTask?.id || null} onOpen={(taskId) => setConversationIds([taskId])} />
        </div>
      </section>
    </main>
  );
}

function ToolbarSelect(props: {
  icon: React.ReactNode;
  label: string;
  onBrowse: () => void;
  value: string;
  onChange: (value: string) => void;
}): React.ReactElement {
  return (
    <div className={styles.workspaceField}>
      <button aria-label="Workspace 폴더 찾아보기" onClick={props.onBrowse} title="Workspace 폴더 찾아보기" type="button">
        {props.icon}
      </button>
      <span>{props.label}</span>
      <input value={props.value} onChange={(event) => props.onChange(event.target.value)} />
    </div>
  );
}

function BranchSelect(props: {
  branches: LocalBranch[];
  error: string | null;
  isLoading: boolean;
  value: string;
  onChange: (value: string) => void;
}): React.ReactElement {
  const title = props.error || (props.isLoading ? "Loading local branches" : props.value || "No branch selected");
  return (
    <label className={styles.branchField} title={title}>
      <GitBranch size={15} aria-hidden="true" />
      <select
        aria-label="base branch"
        disabled={props.isLoading || props.branches.length === 0}
        onChange={(event) => props.onChange(event.target.value)}
        value={props.value}
      >
        {props.branches.length === 0 ? (
          <option value="">{props.isLoading ? "Loading branches" : "No local branches"}</option>
        ) : (
          props.branches.map((branch) => (
            <option key={branch.name} value={branch.name}>
              {branch.isCurrent ? `${branch.name} *` : branch.name}
            </option>
          ))
        )}
      </select>
    </label>
  );
}

function ConversationTranscript(props: {
  activeTaskId: string | null;
  agentSummaryHeight: number;
  details: TaskDetail[];
  onCancelTask: (taskId: string) => Promise<void>;
  onSummaryResizeStart: (event: React.PointerEvent<HTMLButtonElement>) => void;
  plannerQuestions: BrokerArtifact | null;
}): React.ReactElement | null {
  if (props.details.length === 0) {
    return null;
  }

  return (
    <section className={styles.transcriptFrame}>
      <div className={styles.transcript} aria-label="Simple UI conversation transcript">
        {props.details.map((task, index) => (
          <TaskConversationItem
            agentSummaryHeight={props.agentSummaryHeight}
            isActive={task.id === props.activeTaskId}
            isRoot={index === 0}
            key={task.id}
            onCancelTask={props.onCancelTask}
            plannerQuestions={task.id === props.activeTaskId ? props.plannerQuestions : latestArtifact(task, "plan_questions")}
            task={task}
          />
        ))}
      </div>
      <button
        aria-label="Resize agent summary height"
        className={styles.resizeHandle}
        onPointerDown={props.onSummaryResizeStart}
        title="Resize agent summary height"
        type="button"
      >
        <GripHorizontal size={18} aria-hidden="true" />
      </button>
    </section>
  );
}

function TaskConversationItem(props: {
  task: TaskDetail;
  agentSummaryHeight: number;
  isRoot: boolean;
  isActive: boolean;
  onCancelTask: (taskId: string) => Promise<void>;
  plannerQuestions: BrokerArtifact | null;
}): React.ReactElement {
  const verification = latestVerification(props.task);
  const artifacts = props.task.brokerArtifacts.filter((artifact) => visibleArtifactKinds.has(artifact.kind));
  const hasActiveRun = props.task.agentRuns.some((run) => run.status === "running");

  return (
    <article className={styles.threadItem}>
      <div className={styles.userBubble}>
        <div className={styles.bubbleMeta}>
          <span>{props.isRoot ? "첫 요청" : "후속 요청"}</span>
          <time>{formatTime(props.task.createdAt)}</time>
        </div>
        <p>{userPromptFromTask(props.task)}</p>
      </div>
      <div
        className={classNames(styles.agentCard, props.isActive && styles.activeAgentCard)}
        style={{ "--agent-summary-height": `${props.agentSummaryHeight}px` } as React.CSSProperties}
      >
        <div className={styles.agentHeader}>
          <span className={classNames(styles.statusDot, styles[`status-${props.task.status}`])} />
          <div>
            <strong>{props.task.title}</strong>
            <span>{statusLabels[props.task.status]}</span>
          </div>
          <div className={styles.agentActions}>
            {canCancelTask(props.task) ? (
              <button
                aria-label="Cancel task"
                className={styles.iconButton}
                onClick={() => void props.onCancelTask(props.task.id)}
                title="Cancel task"
                type="button"
              >
                <StopCircle size={15} aria-hidden="true" />
              </button>
            ) : null}
            {hasActiveRun ? <LoaderCircle className={styles.spin} size={16} aria-hidden="true" /> : <Bot size={17} aria-hidden="true" />}
          </div>
        </div>
        <AgentRunRail runs={props.task.agentRuns} />
        {props.task.status === "waiting_for_user" && props.plannerQuestions ? (
          <div className={styles.plannerCard}>
            <CircleAlert size={16} aria-hidden="true" />
            <div className={styles.summaryBody}>
              <strong>Planner 질문</strong>
              <pre>{trimText(props.plannerQuestions.content, 1200)}</pre>
            </div>
          </div>
        ) : null}
        {props.task.status === "ready_for_review" ? (
          <div className={styles.plannerCard}>
            <GitBranch size={16} aria-hidden="true" />
            <div className={styles.summaryBody}>
              <strong>검토 브랜치</strong>
              <pre>{`git checkout ${reviewBranchName(props.task.id)}`}</pre>
            </div>
          </div>
        ) : null}
        {artifacts.length > 0 ? (
          <div className={styles.artifactList}>
            {artifacts.slice(-4).map((artifact) => (
              <details
                key={artifact.id}
                className={styles.artifactItem}
                open={artifact.kind === "final_brief" || (props.task.status === "canceled" && artifact.kind === "plan_questions")}
              >
                <summary>
                  <Sparkles size={14} aria-hidden="true" />
                  {artifactLabels[artifact.kind]}
                </summary>
                {artifact.contract ? (
                  <div className={styles.contractBox}>
                    <strong>{artifact.contract.summary}</strong>
                    {artifact.contract.claims.length > 0 ? (
                      <ul>
                        {artifact.contract.claims.slice(0, 3).map((claim) => (
                          <li key={claim.id}>
                            {claim.id} [{claim.confidence}]: {claim.text}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : null}
                <pre>{trimText(artifact.content)}</pre>
              </details>
            ))}
          </div>
        ) : (
          <div className={styles.waitingLine}>
            <CircleDashed size={15} aria-hidden="true" />
            broker artifact를 기다리는 중
          </div>
        )}
        {verification ? <VerificationSummary verification={verification} /> : null}
      </div>
    </article>
  );
}

function AgentRunRail(props: { runs: AgentRun[] }): React.ReactElement {
  const roles: AgentRun["role"][] = ["researcher", "planner", "implementer", "tester", "verifier"];
  const latestByRole = new Map<AgentRun["role"], AgentRun>();
  for (const run of props.runs) {
    latestByRole.set(run.role, run);
  }

  return (
    <div className={styles.runRail}>
      {roles.map((role) => {
        const run = latestByRole.get(role);
        const state = run?.status || "pending";
        return (
          <span className={classNames(styles.runChip, styles[`run-${state}`])} key={role}>
            {state === "done" ? (
              <CheckCircle2 size={13} aria-hidden="true" />
            ) : state === "running" ? (
              <LoaderCircle className={styles.spin} size={13} aria-hidden="true" />
            ) : state === "failed" ? (
              <CircleAlert size={13} aria-hidden="true" />
            ) : (
              <Clock3 size={13} aria-hidden="true" />
            )}
            {roleLabels[role]}
          </span>
        );
      })}
    </div>
  );
}

function VerificationSummary(props: { verification: Verification }): React.ReactElement {
  const isPass = props.verification.decision === "pass";
  return (
    <div className={classNames(styles.verification, isPass ? styles.verificationPass : styles.verificationWarn)}>
      {isPass ? <CheckCircle2 size={16} aria-hidden="true" /> : <CircleAlert size={16} aria-hidden="true" />}
      <div>
        <strong>Verifier: {props.verification.decision}</strong>
        <p>{trimText(props.verification.summary, 500)}</p>
        {props.verification.command ? <code>{props.verification.command}</code> : null}
      </div>
    </div>
  );
}

function RecentTasks(props: {
  tasks: Task[];
  activeTaskId: string | null;
  onOpen: (taskId: string) => void;
}): React.ReactElement | null {
  const recent = props.tasks.slice(0, 5);
  if (recent.length === 0) {
    return null;
  }

  return (
    <div className={styles.recentTasks}>
      {recent.map((task) => (
        <button
          className={classNames(styles.recentTask, task.id === props.activeTaskId && styles.recentTaskActive)}
          key={task.id}
          onClick={() => props.onOpen(task.id)}
          type="button"
          title={task.title}
        >
          <Link2 size={13} aria-hidden="true" />
          {task.title}
        </button>
      ))}
    </div>
  );
}
