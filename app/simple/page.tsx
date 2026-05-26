"use client";

import type React from "react";
import { ChangeEvent, FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  Bot,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  CircleDashed,
  Clock3,
  FolderOpen,
  Gauge,
  GitBranch,
  ImageIcon,
  Laptop,
  Link2,
  LoaderCircle,
  MessageSquareText,
  Mic,
  Paperclip,
  Play,
  ShieldCheck,
  Sparkles,
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
import styles from "./simple.module.css";

const defaultProjectPath = "D:\\dev\\Deluge";
const conversationStorageKey = "oh-my-codex-simple-conversation";
const settingsStorageKey = "oh-my-codex-simple-settings";

type SimpleSettings = {
  targetProjectPath: string;
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

const defaultSettings: SimpleSettings = {
  targetProjectPath: defaultProjectPath,
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
  done: "완료",
  blocked: "차단됨"
};

const artifactLabels: Record<BrokerArtifact["kind"], string> = {
  evidence_pack: "Evidence pack",
  plan_questions: "Planner question",
  plan_answer: "Planner answer",
  plan_brief: "Plan brief",
  implementation_brief: "Implementation brief",
  test_brief: "Test brief",
  test_result: "Test result",
  final_brief: "Final brief"
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

function latestBranch(task: TaskDetail | null): string {
  if (!task) {
    return "main";
  }
  const runWithBranch = [...task.agentRuns].reverse().find((run) => Boolean(run.branchName));
  return runWithBranch?.branchName || "main";
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
      planningMode: parsed.planningMode === "plan" ? "plan" : "direct",
      verificationMode: parsed.verificationMode === "balanced" ? "balanced" : "fast",
      verificationCommand: parsed.verificationCommand || "",
      approvalGrant: typeof parsed.approvalGrant === "boolean" ? parsed.approvalGrant : true
    };
  } catch {
    return defaultSettings;
  }
}

export default function SimplePage(): React.ReactElement {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [message, setMessage] = useState("");
  const [conversationIds, setConversationIds] = useState<string[]>([]);
  const [taskDetails, setTaskDetails] = useState<TaskDetail[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [settings, setSettings] = useState<SimpleSettings>(defaultSettings);
  const [pendingImages, setPendingImages] = useState<File[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeTask = taskDetails[taskDetails.length - 1] || null;
  const plannerQuestions = latestArtifact(activeTask, "plan_questions");
  const isAnsweringPlanner = activeTask?.status === "waiting_for_user" && Boolean(plannerQuestions);
  const canSend = message.trim().length > 0 && !isSending;
  const branchLabel = latestBranch(activeTask);

  const orderedDetails = useMemo(() => {
    const byId = new Map(taskDetails.map((task) => [task.id, task]));
    return conversationIds.map((id) => byId.get(id)).filter((task): task is TaskDetail => Boolean(task));
  }, [conversationIds, taskDetails]);

  useEffect(() => {
    setConversationIds(loadStoredConversation());
    setSettings(loadStoredSettings());
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
        taskTags: ["Simple UI"],
        taskGroup: "Simple UI",
        goal: prompt,
        scope: "Submitted from the Simple UI chat surface.",
        targetProjectPath: settings.targetProjectPath,
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
        verificationCommand: settings.verificationCommand,
        approvalGrant: shouldDelayStart ? false : settings.approvalGrant
      })
    });
    await attachImagesAndMaybeStart(data.task.id, pendingImages, shouldDelayStart);
    return data.task;
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
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submitMessage();
    }
  }

  function updateSettings(next: Partial<SimpleSettings>): void {
    setSettings((current) => ({ ...current, ...next }));
  }

  function clearConversation(): void {
    setConversationIds([]);
    setTaskDetails([]);
    setMessage("");
    setPendingImages([]);
    setError(null);
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
          <h1 className={styles.headline}>oh-my-codex에서 무엇을 빌드할까요?</h1>
          <ConversationTranscript
            activeTaskId={activeTask?.id || null}
            details={orderedDetails}
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
              aria-label={isAnsweringPlanner ? "Planner 답변" : "Simple UI 메시지"}
              className={styles.composerInput}
              disabled={isSending}
              onChange={(event) => setMessage(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              placeholder={
                isAnsweringPlanner
                  ? "planner 질문에 답변하기"
                  : "지금 만든 하네스에서 무엇을 만들지 입력하세요"
              }
              rows={3}
              value={message}
            />
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
                value={settings.targetProjectPath}
                onChange={(value) => updateSettings({ targetProjectPath: value })}
              />
              <span className={styles.toolPill}>
                <Laptop size={15} aria-hidden="true" />
                로컬에서 작업
                <ChevronDown size={14} aria-hidden="true" />
              </span>
              <span className={styles.toolPill} title={branchLabel}>
                <GitBranch size={15} aria-hidden="true" />
                {branchLabel}
                <ChevronDown size={14} aria-hidden="true" />
              </span>
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
              <input
                aria-label="검증 명령"
                className={styles.verifyInput}
                onChange={(event) => updateSettings({ verificationCommand: event.target.value })}
                placeholder="verification command"
                value={settings.verificationCommand}
              />
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
              <button className={styles.micButton} disabled type="button" title="음성 입력 준비 중">
                <Mic size={17} aria-hidden="true" />
              </button>
              <button className={styles.sendButton} disabled={!canSend} type="submit" title="전송">
                {isSending ? <LoaderCircle className={styles.spin} size={19} aria-hidden="true" /> : <ArrowUp size={19} aria-hidden="true" />}
              </button>
            </div>
            {error ? <div className={styles.errorLine}>{error}</div> : null}
          </form>
          <RecentTasks tasks={tasks} activeTaskId={activeTask?.id || null} onOpen={(taskId) => setConversationIds([taskId])} />
        </div>
      </section>
    </main>
  );
}

function ToolbarSelect(props: {
  icon: React.ReactNode;
  label: string;
  value: string;
  onChange: (value: string) => void;
}): React.ReactElement {
  return (
    <label className={styles.workspaceField}>
      {props.icon}
      <span>{props.label}</span>
      <input value={props.value} onChange={(event) => props.onChange(event.target.value)} />
    </label>
  );
}

function ConversationTranscript(props: {
  activeTaskId: string | null;
  details: TaskDetail[];
  plannerQuestions: BrokerArtifact | null;
}): React.ReactElement | null {
  if (props.details.length === 0) {
    return null;
  }

  return (
    <section className={styles.transcript} aria-label="Simple UI conversation transcript">
      {props.details.map((task, index) => (
        <TaskConversationItem
          isActive={task.id === props.activeTaskId}
          isRoot={index === 0}
          key={task.id}
          plannerQuestions={task.id === props.activeTaskId ? props.plannerQuestions : latestArtifact(task, "plan_questions")}
          task={task}
        />
      ))}
    </section>
  );
}

function TaskConversationItem(props: {
  task: TaskDetail;
  isRoot: boolean;
  isActive: boolean;
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
      <div className={classNames(styles.agentCard, props.isActive && styles.activeAgentCard)}>
        <div className={styles.agentHeader}>
          <span className={classNames(styles.statusDot, styles[`status-${props.task.status}`])} />
          <div>
            <strong>{props.task.title}</strong>
            <span>{statusLabels[props.task.status]}</span>
          </div>
          {hasActiveRun ? <LoaderCircle className={styles.spin} size={16} aria-hidden="true" /> : <Bot size={17} aria-hidden="true" />}
        </div>
        <AgentRunRail runs={props.task.agentRuns} />
        {props.task.status === "waiting_for_user" && props.plannerQuestions ? (
          <div className={styles.plannerCard}>
            <CircleAlert size={16} aria-hidden="true" />
            <div>
              <strong>Planner question</strong>
              <pre>{trimText(props.plannerQuestions.content, 1200)}</pre>
            </div>
          </div>
        ) : null}
        {artifacts.length > 0 ? (
          <div className={styles.artifactList}>
            {artifacts.slice(-4).map((artifact) => (
              <details key={artifact.id} className={styles.artifactItem} open={artifact.kind === "final_brief"}>
                <summary>
                  <Sparkles size={14} aria-hidden="true" />
                  {artifactLabels[artifact.kind]}
                </summary>
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
