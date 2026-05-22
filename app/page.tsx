"use client";

import type React from "react";
import { FormEvent, Fragment, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Database,
  FileDown,
  FolderOpen,
  Gauge,
  GitBranch,
  ImageIcon,
  NotebookTabs,
  ListChecks,
  Play,
  Plus,
  RefreshCw,
  ScrollText,
  Settings,
  ShieldCheck,
  ShieldQuestion,
  SlidersHorizontal,
  TerminalSquare,
  Trash2,
  Upload
} from "lucide-react";
import type {
  AgentRun,
  AgentSetting,
  BrokerArtifact,
  ConventionNote,
  ShellLog,
  Task,
  TaskAttachment,
  TaskDetail,
  Verification
} from "@/lib/types";
import type { ModelOption } from "@/lib/model-catalog";
import { defaultUnityDotnetVerificationCommand } from "@/lib/verification-command";

type Tab = "agents" | "artifacts" | "shell" | "verifications" | "conventions";
type UiLanguage = "ko" | "en";

const defaultProjectPath = "D:\\dev\\Deluge";
const LANGUAGE_STORAGE_KEY = "oh-my-codex-language";

const UI_TEXT = {
  en: {
    active: "Active",
    addTag: "Add Tag",
    addRule: "Add Rule",
    agentSettings: "Agent Settings",
    agentsTab: "Agents",
    all: "All",
    artifactsTab: "Broker",
    attachments: "Attachments",
    blocked: "Blocked",
    browseFolders: "Browse folders",
    category: "Category",
    close: "Close",
    confidence: "Confidence",
    conventionNotes: "Convention notes",
    conventionsTab: "Unity Rules",
    createAndQueue: "Create and Queue",
    createFollowUpTask: "Create Follow-up Task",
    cleanupAllWorktrees: "Cleanup all inactive worktrees",
    cleanupCompletedWorktrees: "Cleanup completed worktrees",
    cleanupExpiredBlockedWorktrees: "Cleanup expired blocked worktrees",
    cleanupFailedWorktrees: "Cleanup failed worktrees",
    cleanupSummary: "Cleanup summary",
    deleteTag: "Delete tag",
    done: "Done",
    dropImages: "Drop images here or click to attach",
    examples: "Examples",
    exportPreview: "Export preview",
    followUp: "Follow-up",
    followUpOfTask: "Follow-up of task",
    followUpPlaceholder: "Ask a follow-up without reusing the full raw task context. A child task will be created.",
    followUpTasks: "Follow-up Tasks",
    goal: "Goal",
    grantCli: "Grant task-level CLI permission",
    imageLimit: "PNG, JPG, WEBP, GIF up to 12 MB each",
    insertSelectedPath: "Enter/Tab inserts selected path",
    language: "Language",
    loadingFolders: "Loading folders...",
    localOnly: "localhost only / CLI through local worker",
    newTask: "New Task",
    noBrokerArtifacts: "No broker artifacts recorded yet.",
    noChildFolders: "No child folders.",
    noGroup: "No tag",
    noImages: "No images attached yet.",
    noMatchingPaths: "No matching files or folders",
    noShellCommands: "No shell commands have been run.",
    noAgentRuns: "No agent runs recorded yet.",
    noTasksInGroup: "No tasks match these tags.",
    noTasksYet: "No tasks yet.",
    noUnityNotes: "No Unity convention notes for this project.",
    noVerifierDecisions: "No verifier decisions yet.",
    notionParentPageId: "Parent page ID",
    notionPlaceholder: "Notion page ID to create task pages under",
    notionSync: "Notion Sync",
    notionDatabase: "Task database",
    onlyImages: "Only image files can be attached.",
    originalOutput: "Original output",
    parallelTasks: "Parallel Tasks",
    pendingImages: "Images to attach when this task starts",
    previewExport: "Preview Export",
    reason: "Reason",
    reasoningEffort: "Reasoning",
    refreshTasks: "Refresh tasks",
    round: "Round",
    rule: "Rule",
    run: "Run",
    saveNotionSettings: "Save Notion Settings",
    saveSettings: "Save Settings",
    scope: "Scope",
    scopeDropImages: "Drop startup images here or click to attach",
    scopePlaceholder: "Files, folders, and constraints. Type @ to search inside Target project path.",
    scopeSuggestions: "Scope path suggestions",
    searchingTarget: "Searching target project...",
    selectTaskEmpty: "Select a task to inspect agent output and verifier decisions.",
    selectTargetFolder: "Select Target Folder",
    selectThisFolder: "Select This Folder",
    settings: "Settings",
    serviceTier: "Speed",
    shellTab: "Shell",
    syncNotionTasks: "Push Task DB",
    taskDetail: "Task Detail",
    taskGroup: "Task Tag",
    taskGroups: "Task tags",
    targetProjectPath: "Target project path",
    title: "Title",
    tokenConfigured: "configured",
    tokenMissing: "missing NOTION_TOKEN in .env.local",
    importNotionTasks: "Pull Task DB",
    ungrouped: "Untagged",
    uploadImages: "Uploading images...",
    verificationCommand: "Verification command",
    verificationsTab: "Verifier",
    worktreeCleanup: "Worktree cleanup",
    writeAgents: "Write AGENTS.md"
  },
  ko: {
    active: "진행 중",
    addTag: "태그 추가",
    addRule: "규칙 추가",
    agentSettings: "Agent 설정",
    agentsTab: "Agent",
    all: "전체",
    artifactsTab: "브로커",
    attachments: "첨부 이미지",
    blocked: "차단됨",
    browseFolders: "폴더 찾기",
    category: "분류",
    close: "닫기",
    confidence: "신뢰도",
    conventionNotes: "컨벤션 노트",
    conventionsTab: "Unity 규칙",
    createAndQueue: "생성하고 대기열에 추가",
    createFollowUpTask: "후속 Task 생성",
    cleanupAllWorktrees: "비활성 worktree 전체 정리",
    cleanupCompletedWorktrees: "완료 worktree 정리",
    cleanupExpiredBlockedWorktrees: "만료된 blocked worktree 정리",
    cleanupFailedWorktrees: "실패 worktree 정리",
    cleanupSummary: "정리 결과",
    done: "완료",
    dropImages: "이미지를 드롭하거나 클릭해서 첨부",
    examples: "예시",
    exportPreview: "내보내기 미리보기",
    followUp: "후속 작업",
    followUpOfTask: "상위 Task",
    followUpPlaceholder: "전체 원본 컨텍스트를 재사용하지 않고 이어서 요청합니다. 자식 Task가 생성됩니다.",
    followUpTasks: "후속 Task",
    goal: "목표",
    grantCli: "Task 단위 CLI 권한 부여",
    imageLimit: "PNG, JPG, WEBP, GIF, 파일당 최대 12 MB",
    insertSelectedPath: "Enter/Tab으로 선택 경로 입력",
    language: "언어",
    loadingFolders: "폴더를 불러오는 중...",
    localOnly: "localhost 전용 / CLI는 로컬 worker가 실행",
    newTask: "새 Task",
    noBrokerArtifacts: "아직 브로커 산출물이 없습니다.",
    noChildFolders: "하위 폴더가 없습니다.",
    noGroup: "태그 없음",
    noImages: "아직 첨부된 이미지가 없습니다.",
    noMatchingPaths: "일치하는 파일 또는 폴더가 없습니다.",
    noShellCommands: "아직 실행된 shell 명령이 없습니다.",
    noAgentRuns: "아직 agent 실행 기록이 없습니다.",
    noTasksInGroup: "선택한 태그와 일치하는 Task가 없습니다.",
    noTasksYet: "아직 Task가 없습니다.",
    noUnityNotes: "이 프로젝트의 Unity 컨벤션 노트가 없습니다.",
    noVerifierDecisions: "아직 verifier 판정이 없습니다.",
    notionParentPageId: "상위 페이지 ID",
    notionPlaceholder: "Task 페이지를 생성할 Notion 페이지 ID",
    notionSync: "Notion 동기화",
    notionDatabase: "Task 데이터베이스",
    onlyImages: "이미지 파일만 첨부할 수 있습니다.",
    originalOutput: "원문 출력",
    parallelTasks: "병렬 Task",
    pendingImages: "Task 시작 시 첨부할 이미지",
    previewExport: "내보내기 미리보기",
    reason: "이유",
    reasoningEffort: "추론 강도",
    refreshTasks: "Task 새로고침",
    round: "라운드",
    rule: "규칙",
    run: "실행",
    saveNotionSettings: "Notion 설정 저장",
    saveSettings: "설정 저장",
    scope: "범위",
    scopeDropImages: "시작 시 사용할 이미지를 드롭하거나 클릭해서 첨부",
    scopePlaceholder: "파일, 폴더, 제약 조건. @를 입력하면 Target project path 안에서 검색합니다.",
    scopeSuggestions: "Scope 경로 추천",
    searchingTarget: "대상 프로젝트 검색 중...",
    selectTaskEmpty: "Agent 출력과 verifier 판정을 확인할 Task를 선택하세요.",
    selectTargetFolder: "대상 폴더 선택",
    selectThisFolder: "이 폴더 선택",
    settings: "설정",
    serviceTier: "속도",
    shellTab: "Shell",
    syncNotionTasks: "Task DB 올리기",
    taskDetail: "Task 상세",
    taskGroup: "Task 태그",
    taskGroups: "Task 태그",
    targetProjectPath: "대상 프로젝트 경로",
    title: "제목",
    tokenConfigured: "설정됨",
    tokenMissing: ".env.local에 NOTION_TOKEN 없음",
    importNotionTasks: "Task DB 불러오기",
    ungrouped: "태그 없음",
    uploadImages: "이미지 업로드 중...",
    verificationCommand: "검증 명령",
    verificationsTab: "Verifier",
    worktreeCleanup: "Worktree 정리",
    writeAgents: "AGENTS.md 쓰기"
  }
} as const;

type UiTextKey = keyof typeof UI_TEXT.en;

function tr(language: UiLanguage, key: UiTextKey): string {
  return (UI_TEXT[language] as Partial<Record<UiTextKey, string>>)[key] || UI_TEXT.en[key];
}
type ModelCatalog = Record<AgentSetting["provider"], ModelOption[]>;
type NotionSettings = {
  parentPageId: string;
  databaseId: string | null;
  dataSourceId: string | null;
  updatedAt: string | null;
  tokenConfigured: boolean;
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
type TaskTagFilter = "__untagged__" | string;
type WorktreeCleanupMode = "completed" | "failed" | "all" | "expired-blocked";
type WorktreeCleanupSummary = {
  mode: WorktreeCleanupMode;
  removedWorktrees: string[];
  removedBranches: string[];
  skippedActiveTasks: string[];
  errors: string[];
};
const REASONING_EFFORT_OPTIONS: AgentSetting["reasoningEffort"][] = [
  "default",
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh"
];
const SERVICE_TIER_OPTIONS: AgentSetting["serviceTier"][] = ["default", "auto", "fast"];
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
type TaskTreeNode = {
  task: Task;
  children: TaskTreeNode[];
};

function statusLabel(status: Task["status"], language: UiLanguage): string {
  const labels: Record<UiLanguage, Record<Task["status"], string>> = {
    en: {
      queued: "Queued",
      running: "Running",
      reviewing: "Reviewing",
      verifying: "Verifying",
      needs_fix: "Needs Fix",
      done: "Done",
      blocked: "Blocked"
    },
    ko: {
      queued: "대기",
      running: "실행 중",
      reviewing: "리뷰 중",
      verifying: "검증 중",
      needs_fix: "수정 필요",
      done: "완료",
      blocked: "차단됨"
    }
  };
  return labels[language][status];
}

function taskTagsOf(task: Pick<Task, "taskGroup" | "tags">): string[] {
  const tags = task.tags || [];
  return tags.length > 0 ? tags : task.taskGroup.trim() ? [task.taskGroup.trim()] : [];
}

function buildTaskTree(tasks: Task[]): TaskTreeNode[] {
  const nodes = new Map<string, TaskTreeNode>();
  const roots: TaskTreeNode[] = [];
  for (const task of tasks) {
    nodes.set(task.id, { task, children: [] });
  }
  for (const task of tasks) {
    const node = nodes.get(task.id);
    if (!node) {
      continue;
    }
    const parent = task.parentTaskId ? nodes.get(task.parentTaskId) : null;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

function taskTagLabel(tag: string, language: UiLanguage): string {
  return tag.trim() || tr(language, "ungrouped");
}

function normalizeTaskTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const tag of tags) {
    const trimmed = tag.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    normalized.push(trimmed);
  }
  return normalized;
}

function confidenceLabel(confidence: ConventionNote["confidence"], language: UiLanguage): string {
  const labels: Record<UiLanguage, Record<ConventionNote["confidence"], string>> = {
    en: { low: "low", medium: "medium", high: "high" },
    ko: { low: "낮음", medium: "보통", high: "높음" }
  };
  return labels[language][confidence];
}

function tabLabels(language: UiLanguage): Array<{ id: Tab; label: string; icon: React.ReactElement }> {
  return [
    { id: "agents", label: tr(language, "agentsTab"), icon: <Database size={15} aria-hidden="true" /> },
    { id: "artifacts", label: tr(language, "artifactsTab"), icon: <ShieldQuestion size={15} aria-hidden="true" /> },
    { id: "shell", label: tr(language, "shellTab"), icon: <TerminalSquare size={15} aria-hidden="true" /> },
    { id: "verifications", label: tr(language, "verificationsTab"), icon: <ClipboardCheck size={15} aria-hidden="true" /> },
    { id: "conventions", label: tr(language, "conventionsTab"), icon: <ScrollText size={15} aria-hidden="true" /> }
  ];
}

function shortText(text: string, max = 120): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function tailPath(text: string, max = 54): string {
  if (text.length <= max) {
    return text;
  }
  return `...${text.slice(-(max - 3))}`;
}

function decisionLabel(value: string): string {
  const labels: Record<string, string> = {
    pass: "통과",
    needs_fix: "수정 필요",
    blocked: "차단됨"
  };
  return labels[value] || value;
}

function translateCommonAgentText(text: string): string {
  const replacements: Array<[RegExp, string]> = [
    [/\bMock researcher round (\d+) completed\./gi, "Mock researcher 라운드 $1 완료."],
    [/\bMock implementer round (\d+) completed\./gi, "Mock implementer 라운드 $1 완료."],
    [/\bMock tester:/gi, "Mock tester:"],
    [/\bMock verifier passed\./gi, "Mock verifier 통과."],
    [/\bEvidence:/gi, "근거:"],
    [/\bRisk:/gi, "위험:"],
    [/\bSummary:/gi, "요약:"],
    [/\bDecision:/gi, "판정:"],
    [/\bTarget project\b/gi, "대상 프로젝트"],
    [/\bis reachable in mock mode\b/gi, "는 mock 모드에서 접근 가능합니다"],
    [/\breal repository facts require MOCK_AGENTS=0 and shell inspection\b/gi, "실제 저장소 사실 확인에는 MOCK_AGENTS=0 및 shell 검사가 필요합니다"],
    [/\bNo implementation changes were made in mock mode\./gi, "mock 모드에서는 구현 변경이 수행되지 않았습니다."],
    [/\bNo blocking issues found from the broker test brief\./gi, "브로커 테스트 brief에서 차단 이슈는 발견되지 않았습니다."],
    [/\bContinue to verifier\./gi, "verifier로 진행합니다."],
    [/\bConfigure OPENAI_API_KEY and set MOCK_AGENTS=0 for live isolated Codex validation\./gi, "실제 격리 Codex 검증을 실행하려면 OPENAI_API_KEY를 설정하고 MOCK_AGENTS=0으로 지정하세요."],
    [/\bOpenAI quota exceeded for the selected agent provider\/model\./gi, "선택한 agent provider/model의 OpenAI quota를 초과했습니다."],
    [/\bThe task was blocked before the current agent could finish\./gi, "현재 agent가 완료되기 전에 Task가 차단되었습니다."],
    [/\bCheck OpenAI billing\/usage limits for the API key in \.env\.local\b/gi, ".env.local의 API key에 대한 OpenAI billing/usage 제한을 확인하세요"],
    [/\bor switch this role to the mock provider in Settings for local harness testing\./gi, "또는 로컬 harness 테스트를 위해 Settings에서 해당 role을 mock provider로 바꾸세요."],
    [/\bOriginal provider error:/gi, "원본 provider 오류:"],
    [/\bCodex CLI exited with code\b/gi, "Codex CLI 종료 코드"],
    [/\bSTDOUT:/g, "표준 출력:"],
    [/\bSTDERR:/g, "표준 오류:"],
    [/\bRunning\.\.\./g, "실행 중..."],
    [/\bcompleted\b/gi, "완료"],
    [/\bfailed\b/gi, "실패"],
    [/\bblocked\b/gi, "차단됨"],
    [/\bpass\b/gi, "통과"],
    [/\bneeds_fix\b/gi, "수정 필요"]
  ];
  return replacements.reduce((current, [pattern, replacement]) => current.replace(pattern, replacement), text);
}

function localizedAgentOutput(text: string, language: UiLanguage): string {
  if (language !== "ko") {
    return text;
  }
  const trimmed = text.trim();
  if (!trimmed) {
    return "실행 중...";
  }
  try {
    const parsed = JSON.parse(trimmed) as { decision?: string; summary?: string };
    if (parsed && (parsed.decision || parsed.summary)) {
      return [
        parsed.decision ? `판정: ${decisionLabel(String(parsed.decision))}` : "",
        parsed.summary ? `요약: ${translateCommonAgentText(String(parsed.summary))}` : ""
      ]
        .filter(Boolean)
        .join("\n");
    }
  } catch {
    // Plain text agent output stays plain text and receives common harness-term localization below.
  }
  return translateCommonAgentText(trimmed);
}

function canDeleteTask(task: Task): boolean {
  return task.status === "queued" || task.status === "done" || task.status === "blocked";
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

function isNotFoundError(error: unknown): boolean {
  return error instanceof Error && error.message === "Task not found";
}

export default function HomePage(): React.ReactElement {
  const scopeInputRef = useRef<HTMLTextAreaElement | null>(null);
  const [language, setLanguage] = useState<UiLanguage>("ko");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [taskTags, setTaskTags] = useState<string[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [expandedTaskIds, setExpandedTaskIds] = useState<Set<string>>(new Set());
  const [selectedTaskTags, setSelectedTaskTags] = useState<TaskTagFilter[]>([]);
  const [taskDetail, setTaskDetail] = useState<TaskDetail | null>(null);
  const [tab, setTab] = useState<Tab>("agents");
  const [notes, setNotes] = useState<ConventionNote[]>([]);
  const [agentSettings, setAgentSettings] = useState<AgentSetting[]>([]);
  const [modelCatalog, setModelCatalog] = useState<ModelCatalog>({ openai: [], "codex-cli": [], mock: [] });
  const [notionSettings, setNotionSettings] = useState<NotionSettings>({
    parentPageId: "",
    databaseId: null,
    dataSourceId: null,
    updatedAt: null,
    tokenConfigured: false
  });
  const [isSubmitting, setSubmitting] = useState(false);
  const [isSavingSettings, setSavingSettings] = useState(false);
  const [isSavingNotion, setSavingNotion] = useState(false);
  const [isSyncingNotionTasks, setSyncingNotionTasks] = useState(false);
  const [isImportingNotionTasks, setImportingNotionTasks] = useState(false);
  const [isUploadingAttachment, setUploadingAttachment] = useState(false);
  const [isCleaningWorktrees, setCleaningWorktrees] = useState(false);
  const [isSettingsOpen, setSettingsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportPreview, setExportPreview] = useState<string>("");
  const [worktreeCleanupSummary, setWorktreeCleanupSummary] = useState<string>("");
  const [scopeMention, setScopeMention] = useState<ScopeMention | null>(null);
  const [scopeImages, setScopeImages] = useState<File[]>([]);
  const [pathSuggestions, setPathSuggestions] = useState<PathSuggestion[]>([]);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
  const [isLoadingSuggestions, setLoadingSuggestions] = useState(false);
  const [followUpMessage, setFollowUpMessage] = useState("");
  const [isCreatingFollowUp, setCreatingFollowUp] = useState(false);
  const [isFolderBrowserOpen, setFolderBrowserOpen] = useState(false);
  const [isLoadingFolders, setLoadingFolders] = useState(false);
  const [folderBrowser, setFolderBrowser] = useState<FolderBrowserResult | null>(null);
  const [folderBrowserError, setFolderBrowserError] = useState<string | null>(null);

  const [taskForm, setTaskForm] = useState({
    title: "",
    taskTags: [] as string[],
    taskTagInput: "",
    goal: "",
    scope: "",
    targetProjectPath: defaultProjectPath,
    verificationCommand: defaultUnityDotnetVerificationCommand(),
    agentPlan: "",
    approvalGrant: true
  });

  const [noteForm, setNoteForm] = useState({
    projectPath: defaultProjectPath,
    category: "Unity C#",
    rule: "",
    reason: "",
    source: "manual",
    confidence: "medium" as ConventionNote["confidence"],
    examples: ""
  });

  useEffect(() => {
    const savedLanguage = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (savedLanguage === "ko" || savedLanguage === "en") {
      setLanguage(savedLanguage);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  }, [language]);

  async function refreshTasks(): Promise<void> {
    const data = await jsonFetch<{ tasks: Task[]; taskTags?: string[]; taskGroups?: string[] }>("/api/tasks");
    setTasks(data.tasks);
    setTaskTags(data.taskTags || data.taskGroups || []);
    if (selectedTaskId && !data.tasks.some((task) => task.id === selectedTaskId)) {
      setSelectedTaskId(data.tasks[0]?.id || null);
      setTaskDetail(null);
      return;
    }
    if (!selectedTaskId && data.tasks[0]) {
      setSelectedTaskId(data.tasks[0].id);
    }
  }

  async function refreshSettings(): Promise<void> {
    const data = await jsonFetch<{ settings: AgentSetting[]; modelCatalog: ModelCatalog }>("/api/settings");
    setAgentSettings(data.settings);
    setModelCatalog(data.modelCatalog);
  }

  async function refreshNotionSettings(): Promise<void> {
    const data = await jsonFetch<{ settings: NotionSettings }>("/api/notion/settings");
    setNotionSettings(data.settings);
  }

  async function refreshDetail(taskId: string): Promise<void> {
    try {
      const data = await jsonFetch<{ task: TaskDetail }>(`/api/tasks/${taskId}`);
      setTaskDetail(data.task);
    } catch (err) {
      if (isNotFoundError(err)) {
        setTaskDetail(null);
        setSelectedTaskId((current) => (current === taskId ? null : current));
        return;
      }
      throw err;
    }
  }

  async function refreshNotes(projectPath = noteForm.projectPath): Promise<void> {
    const data = await jsonFetch<{ notes: ConventionNote[] }>(
      `/api/conventions?projectPath=${encodeURIComponent(projectPath)}`
    );
    setNotes(data.notes);
  }

  useEffect(() => {
    void refreshTasks().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
    void refreshSettings().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
    void refreshNotionSettings().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => {
    if (!selectedTaskId) {
      return;
    }
    void refreshDetail(selectedTaskId).catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
    const interval = window.setInterval(() => {
      void refreshTasks();
      void refreshDetail(selectedTaskId).catch((err: unknown) => {
        if (!isNotFoundError(err)) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });
    }, 1500);
    return () => window.clearInterval(interval);
  }, [selectedTaskId]);

  useEffect(() => {
    void refreshNotes().catch(() => undefined);
  }, [noteForm.projectPath]);

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
          targetProjectPath: taskForm.targetProjectPath,
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
          setLoadingSuggestions(false);
        });
    }, 150);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [scopeMention, taskForm.targetProjectPath]);

  const metrics = useMemo(() => {
    return {
      active: tasks.filter((task) => ["queued", "running", "reviewing", "verifying", "needs_fix"].includes(task.status))
        .length,
      done: tasks.filter((task) => task.status === "done").length,
      blocked: tasks.filter((task) => task.status === "blocked").length,
      notes: notes.length
    };
  }, [tasks, notes]);

  const taskTagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const task of tasks) {
      for (const tag of taskTagsOf(task)) {
        counts.set(tag, (counts.get(tag) || 0) + 1);
      }
    }
    return counts;
  }, [tasks]);

  const knownTaskTags = useMemo(() => {
    return Array.from(new Set([...taskTags, ...tasks.flatMap((task) => taskTagsOf(task))].filter(Boolean))).sort((a, b) =>
      a.localeCompare(b)
    );
  }, [taskTags, tasks]);

  const hasUntaggedTasks = useMemo(() => tasks.some((task) => taskTagsOf(task).length === 0), [tasks]);

  const visibleTasks = useMemo(() => {
    if (selectedTaskTags.length === 0) {
      return tasks;
    }
    return tasks.filter((task) => {
      const tags = taskTagsOf(task);
      return selectedTaskTags.some((selectedTag) =>
        selectedTag === "__untagged__" ? tags.length === 0 : tags.includes(selectedTag)
      );
    });
  }, [selectedTaskTags, tasks]);

  const visibleTaskTree = useMemo(() => {
    if (selectedTaskTags.length === 0) {
      return buildTaskTree(tasks);
    }
    const visibleTaskIds = new Set(visibleTasks.map((task) => task.id));
    const allTasksById = new Map(tasks.map((task) => [task.id, task]));
    for (const task of visibleTasks) {
      let parentId = task.parentTaskId;
      while (parentId) {
        visibleTaskIds.add(parentId);
        parentId = allTasksById.get(parentId)?.parentTaskId || null;
      }
    }
    return buildTaskTree(tasks.filter((task) => visibleTaskIds.has(task.id)));
  }, [selectedTaskTags.length, tasks, visibleTasks]);

  useEffect(() => {
    if (!selectedTaskId) {
      return;
    }
    const tasksById = new Map(tasks.map((task) => [task.id, task]));
    const ancestors: string[] = [];
    let parentId = tasksById.get(selectedTaskId)?.parentTaskId || null;
    while (parentId) {
      ancestors.push(parentId);
      parentId = tasksById.get(parentId)?.parentTaskId || null;
    }
    if (ancestors.length === 0) {
      return;
    }
    setExpandedTaskIds((current) => {
      const next = new Set(current);
      let changed = false;
      for (const id of ancestors) {
        if (!next.has(id)) {
          next.add(id);
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [selectedTaskId, tasks]);

  useEffect(() => {
    const validTags = new Set<TaskTagFilter>(knownTaskTags);
    if (hasUntaggedTasks) {
      validTags.add("__untagged__");
    }
    const nextSelected = selectedTaskTags.filter((tag) => validTags.has(tag));
    if (nextSelected.length !== selectedTaskTags.length) {
      setSelectedTaskTags(nextSelected);
    }
  }, [hasUntaggedTasks, knownTaskTags, selectedTaskTags]);

  async function submitTask(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const taskTags = normalizeTaskTags([...taskForm.taskTags, taskForm.taskTagInput]);
      const taskPayload = {
        ...taskForm,
        taskTags,
        taskGroup: taskTags[0] || ""
      };
      const shouldStartAfterImageUpload = taskForm.approvalGrant && scopeImages.length > 0;
      const data = await jsonFetch<{ task: Task }>("/api/tasks", {
        method: "POST",
        body: JSON.stringify(shouldStartAfterImageUpload ? { ...taskPayload, approvalGrant: false } : taskPayload)
      });
      if (scopeImages.length > 0) {
        await uploadImagesToTask(data.task.id, scopeImages);
        setScopeImages([]);
      }
      if (shouldStartAfterImageUpload) {
        await jsonFetch(`/api/tasks/${data.task.id}/start`, { method: "POST" });
      }
      setSelectedTaskId(data.task.id);
      if (data.task.tags.length > 0) {
        setSelectedTaskTags([data.task.tags[0]]);
      }
      await refreshTasks();
      await refreshDetail(data.task.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  function addTaskFormTag(tag: string): void {
    setTaskForm((current) => ({
      ...current,
      taskTags: normalizeTaskTags([...current.taskTags, tag]),
      taskTagInput: ""
    }));
  }

  function toggleTaskFormTag(tag: string): void {
    setTaskForm((current) => {
      const normalizedTag = tag.trim();
      if (!normalizedTag) {
        return current;
      }
      const hasTag = current.taskTags.includes(normalizedTag);
      return {
        ...current,
        taskTags: hasTag ? current.taskTags.filter((item) => item !== normalizedTag) : normalizeTaskTags([...current.taskTags, normalizedTag])
      };
    });
  }

  function toggleSelectedTaskTag(tag: TaskTagFilter): void {
    setSelectedTaskTags((current) =>
      current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag]
    );
  }

  async function updateTaskTags(taskId: string, tags: string[]): Promise<void> {
    setError(null);
    try {
      const data = await jsonFetch<{ task: TaskDetail }>(`/api/tasks/${taskId}`, {
        method: "PATCH",
        body: JSON.stringify({ taskTags: normalizeTaskTags(tags) })
      });
      setTaskDetail(data.task);
      await refreshTasks();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function deleteGlobalTaskTag(tag: string): Promise<void> {
    const confirmed = window.confirm(`Delete tag "${tag}" from the tag list and all tasks?`);
    if (!confirmed) {
      return;
    }
    setError(null);
    try {
      await jsonFetch(`/api/task-tags/${encodeURIComponent(tag)}`, { method: "DELETE" });
      setSelectedTaskTags((current) => current.filter((item) => item !== tag));
      setTaskForm((current) => ({
        ...current,
        taskTags: current.taskTags.filter((item) => item !== tag)
      }));
      await refreshTasks();
      if (selectedTaskId) {
        await refreshDetail(selectedTaskId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function updateScopeMention(textArea: HTMLTextAreaElement): void {
    setScopeMention(activeScopeMention(textArea.value, textArea.selectionStart));
  }

  function insertScopeSuggestion(suggestion: PathSuggestion): void {
    if (!scopeMention) {
      return;
    }
    const textArea = scopeInputRef.current;
    const currentScope = taskForm.scope;
    const needsQuotes = /\s/.test(suggestion.path);
    const replacement = needsQuotes ? `@"${suggestion.path}"` : `@${suggestion.path}`;
    const nextScope = `${currentScope.slice(0, scopeMention.start)}${replacement}${currentScope.slice(scopeMention.end)}`;
    const nextCursor = scopeMention.start + replacement.length;

    setTaskForm((current) => ({ ...current, scope: nextScope }));
    setScopeMention(null);
    setPathSuggestions([]);

    window.setTimeout(() => {
      textArea?.focus();
      textArea?.setSelectionRange(nextCursor, nextCursor);
    }, 0);
  }

  function handleScopeKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (!scopeMention || pathSuggestions.length === 0) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedSuggestionIndex((current) => (current + 1) % pathSuggestions.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedSuggestionIndex((current) => (current - 1 + pathSuggestions.length) % pathSuggestions.length);
      return;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      insertScopeSuggestion(pathSuggestions[selectedSuggestionIndex]);
      return;
    }
    if (event.key === "Escape") {
      setScopeMention(null);
      setPathSuggestions([]);
    }
  }

  function addScopeImages(files: File[]): void {
    const imageFiles = files.filter((file) => file.type.startsWith("image/"));
    if (imageFiles.length === 0) {
      setError(tr(language, "onlyImages"));
      return;
    }
    setError(null);
    setScopeImages((current) => [...current, ...imageFiles]);
  }

  function removeScopeImage(index: number): void {
    setScopeImages((current) => current.filter((_, itemIndex) => itemIndex !== index));
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
    void loadFolderBrowser(taskForm.targetProjectPath);
  }

  function selectProjectFolder(pathValue: string): void {
    setTaskForm((current) => ({ ...current, targetProjectPath: pathValue }));
    setNoteForm((current) => ({ ...current, projectPath: pathValue }));
    setFolderBrowserOpen(false);
  }

  async function saveAgentSettings(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSavingSettings(true);
    setError(null);
    try {
      const data = await jsonFetch<{ settings: AgentSetting[]; modelCatalog: ModelCatalog }>("/api/settings", {
        method: "PUT",
        body: JSON.stringify({ settings: agentSettings })
      });
      setAgentSettings(data.settings);
      setModelCatalog(data.modelCatalog);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingSettings(false);
    }
  }

  async function saveNotionSettings(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSavingNotion(true);
    setError(null);
    try {
      const data = await jsonFetch<{ settings: NotionSettings }>("/api/notion/settings", {
        method: "PUT",
        body: JSON.stringify({ parentPageId: notionSettings.parentPageId })
      });
      setNotionSettings(data.settings);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingNotion(false);
    }
  }

  async function syncAllTasksToNotionDb(): Promise<void> {
    setSyncingNotionTasks(true);
    setError(null);
    try {
      await jsonFetch("/api/notion/tasks", {
        method: "POST",
        body: JSON.stringify({ direction: "push", language })
      });
      await refreshNotionSettings();
      await refreshTasks();
      if (selectedTaskId) {
        await refreshDetail(selectedTaskId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSyncingNotionTasks(false);
    }
  }

  async function importTasksFromNotionDb(): Promise<void> {
    setImportingNotionTasks(true);
    setError(null);
    try {
      await jsonFetch("/api/notion/tasks", {
        method: "POST",
        body: JSON.stringify({ direction: "pull", language })
      });
      await refreshNotionSettings();
      await refreshTasks();
      if (selectedTaskId) {
        await refreshDetail(selectedTaskId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImportingNotionTasks(false);
    }
  }

  async function startSelectedTask(): Promise<void> {
    if (!selectedTaskId) {
      return;
    }
    await jsonFetch(`/api/tasks/${selectedTaskId}/start`, { method: "POST" });
    await refreshTasks();
    await refreshDetail(selectedTaskId);
  }

  async function deleteSelectedTask(task: Task): Promise<void> {
    if (!canDeleteTask(task)) {
      setError("Running tasks cannot be deleted until they finish or block.");
      return;
    }
    const confirmed = window.confirm(`Delete task "${task.title}" and its local run logs?`);
    if (!confirmed) {
      return;
    }

    setError(null);
    try {
      await jsonFetch(`/api/tasks/${task.id}`, { method: "DELETE" });
      const remainingTasks = tasks.filter((item) => item.id !== task.id);
      setTasks(remainingTasks);
      if (selectedTaskId === task.id) {
        const nextTask = remainingTasks[0] || null;
        setSelectedTaskId(nextTask?.id || null);
        setTaskDetail(null);
        if (nextTask) {
          await refreshDetail(nextTask.id);
        }
      }
      await refreshTasks();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function cleanupHarnessWorktrees(mode: WorktreeCleanupMode): Promise<void> {
    const labels: Record<WorktreeCleanupMode, string> = {
      completed: tr(language, "cleanupCompletedWorktrees"),
      failed: tr(language, "cleanupFailedWorktrees"),
      all: tr(language, "cleanupAllWorktrees"),
      "expired-blocked": tr(language, "cleanupExpiredBlockedWorktrees")
    };
    const confirmed = window.confirm(`${labels[mode]}? ${language === "ko" ? "Task 기록은 삭제하지 않습니다." : "Task records will not be deleted."}`);
    if (!confirmed) {
      return;
    }
    setCleaningWorktrees(true);
    setError(null);
    try {
      const data = await jsonFetch<{ summary: WorktreeCleanupSummary }>("/api/worktrees/cleanup", {
        method: "POST",
        body: JSON.stringify({ mode })
      });
      const summary = data.summary;
      setWorktreeCleanupSummary(
        [
          `${labels[mode]}`,
          `worktrees: ${summary.removedWorktrees.length}`,
          `branches: ${summary.removedBranches.length}`,
          summary.skippedActiveTasks.length ? `skipped active tasks: ${summary.skippedActiveTasks.length}` : "",
          summary.errors.length ? `errors: ${summary.errors.join(" | ")}` : ""
        ]
          .filter(Boolean)
          .join("\n")
      );
      await refreshTasks();
      if (selectedTaskId) {
        await refreshDetail(selectedTaskId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCleaningWorktrees(false);
    }
  }

  async function createFollowUpForSelectedTask(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!selectedTaskId || !followUpMessage.trim()) {
      return;
    }

    setCreatingFollowUp(true);
    setError(null);
    try {
      const data = await jsonFetch<{ task: Task }>(`/api/tasks/${selectedTaskId}/follow-up`, {
        method: "POST",
        body: JSON.stringify({
          message: followUpMessage,
          approvalGrant: true,
          verificationCommand: taskDetail?.targetProjectPath ? taskForm.verificationCommand : ""
        })
      });
      setFollowUpMessage("");
      setExpandedTaskIds((current) => new Set(current).add(selectedTaskId));
      setSelectedTaskId(data.task.id);
      await refreshTasks();
      await refreshDetail(data.task.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreatingFollowUp(false);
    }
  }

  async function uploadImagesToTask(taskId: string, files: File[]): Promise<void> {
    const imageFiles = files.filter((file) => file.type.startsWith("image/"));
    if (imageFiles.length === 0) {
      setError(tr(language, "onlyImages"));
      return;
    }

    const formData = new FormData();
    for (const file of imageFiles) {
      formData.append("images", file);
    }

    const response = await fetch(`/api/tasks/${taskId}/attachments`, {
      method: "POST",
      body: formData
    });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) {
      throw new Error(payload.error || `Upload failed: ${response.status}`);
    }
  }

  async function uploadTaskImages(files: File[]): Promise<void> {
    if (!selectedTaskId || files.length === 0) {
      return;
    }

    setUploadingAttachment(true);
    setError(null);
    try {
      await uploadImagesToTask(selectedTaskId, files);
      await refreshDetail(selectedTaskId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploadingAttachment(false);
    }
  }

  async function submitNote(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    await jsonFetch("/api/conventions", {
      method: "POST",
      body: JSON.stringify(noteForm)
    });
    setNoteForm((current) => ({ ...current, rule: "", reason: "", examples: "" }));
    await refreshNotes();
  }

  async function exportConventions(writeFiles: boolean): Promise<void> {
    const data = await jsonFetch<{ files: { agents: string; conventions: string }; wrote: boolean }>(
      "/api/conventions/export",
      {
        method: "POST",
        body: JSON.stringify({
          projectPath: noteForm.projectPath,
          writeFiles
        })
      }
    );
    setExportPreview([data.files.agents, "\n\n---\n\n", data.files.conventions].join(""));
  }

  function toggleTaskExpanded(taskId: string): void {
    setExpandedTaskIds((current) => {
      const next = new Set(current);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  }

  function renderTaskTreeNode(node: TaskTreeNode, depth: number): React.ReactElement {
    const task = node.task;
    const hasChildren = node.children.length > 0;
    const isExpanded = expandedTaskIds.has(task.id) || selectedTaskTags.length > 0;
    return (
      <Fragment key={task.id}>
        <div
          className={`task-item ${task.parentTaskId ? "follow-up-task" : ""} ${selectedTaskId === task.id ? "selected" : ""}`}
          onClick={() => setSelectedTaskId(task.id)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setSelectedTaskId(task.id);
            }
            if (hasChildren && event.key === "ArrowRight") {
              event.preventDefault();
              setExpandedTaskIds((current) => new Set(current).add(task.id));
            }
            if (hasChildren && event.key === "ArrowLeft") {
              event.preventDefault();
              setExpandedTaskIds((current) => {
                const next = new Set(current);
                next.delete(task.id);
                return next;
              });
            }
          }}
          role="treeitem"
          aria-expanded={hasChildren ? isExpanded : undefined}
          aria-level={depth + 1}
          tabIndex={0}
          style={{ "--task-depth-indent": `${depth * 18}px` } as React.CSSProperties}
        >
          <div className="meta-row">
            {hasChildren ? (
              <button
                aria-label={isExpanded ? "Collapse follow-up tasks" : "Expand follow-up tasks"}
                className="tree-toggle"
                onClick={(event) => {
                  event.stopPropagation();
                  toggleTaskExpanded(task.id);
                }}
                title={isExpanded ? "Collapse" : "Expand"}
                type="button"
              >
                {isExpanded ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
              </button>
            ) : task.parentTaskId ? (
              <span className="tree-toggle-spacer" />
            ) : null}
            <span className={`pill ${task.status}`}>{statusLabel(task.status, language)}</span>
            {taskTagsOf(task).map((tag) => (
              <span className="pill group" key={tag}>
                {taskTagLabel(tag, language)}
              </span>
            ))}
            <span className="pill">
              {tr(language, "round")} {task.currentRound}
            </span>
            {hasChildren ? <span className="pill follow-up-count">{node.children.length} follow-up</span> : null}
            <span className="spacer" />
            <button
              aria-label={`Delete ${task.title}`}
              className="icon-action"
              disabled={!canDeleteTask(task)}
              onClick={(event) => {
                event.stopPropagation();
                void deleteSelectedTask(task);
              }}
              type="button"
              title={canDeleteTask(task) ? (language === "ko" ? "Task 삭제" : "Delete task") : (language === "ko" ? "Task 실행 중" : "Task is running")}
            >
              <Trash2 size={14} aria-hidden="true" />
            </button>
          </div>
          <span className="task-title">{task.title}</span>
          <span className="task-goal">{shortText(task.goal)}</span>
          <span className="workspace-path">{task.worktreePath || task.targetProjectPath}</span>
        </div>
        {hasChildren && isExpanded ? node.children.map((child) => renderTaskTreeNode(child, depth + 1)) : null}
      </Fragment>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <Gauge size={20} aria-hidden="true" />
          </div>
          <div>
            <h1>Local Multi-Agent Harness</h1>
            <p>
              {language === "ko"
                ? "API agent, 검증 루프, worktree 격리, Unity 컨벤션 메모리"
                : "API agents, verifier loops, worktree isolation, Unity convention memory"}
            </p>
          </div>
        </div>
        <div className="top-actions">
          <ShieldCheck size={16} aria-hidden="true" />
          <span>{tr(language, "localOnly")}</span>
          <div className="language-toggle" aria-label={tr(language, "language")}>
            <button
              className={language === "ko" ? "active" : ""}
              onClick={() => setLanguage("ko")}
              type="button"
            >
              한국어
            </button>
            <button
              className={language === "en" ? "active" : ""}
              onClick={() => setLanguage("en")}
              type="button"
            >
              English
            </button>
          </div>
          <button className="btn" onClick={() => setSettingsOpen(true)} title={tr(language, "settings")}>
            <Settings size={16} aria-hidden="true" />
            {tr(language, "settings")}
          </button>
          <button className="btn" onClick={() => void refreshTasks()} title={tr(language, "refreshTasks")}>
            <RefreshCw size={16} aria-hidden="true" />
          </button>
        </div>
      </header>

      <section className="main-grid">
        <aside className="side-stack">
          <section className="panel">
            <div className="panel-header">
              <div className="panel-title">
                <Plus size={18} aria-hidden="true" />
                {tr(language, "newTask")}
              </div>
            </div>
            <div className="panel-body">
            <form className="form-grid" onSubmit={(event) => void submitTask(event)}>
              <div className="field">
                <label htmlFor="title">{tr(language, "title")}</label>
                <input
                  id="title"
                  value={taskForm.title}
                  onChange={(event) => setTaskForm({ ...taskForm, title: event.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="task-tag">{tr(language, "taskGroup")}</label>
                <div className="tag-input-row">
                  <input
                    id="task-tag"
                    value={taskForm.taskTagInput}
                    onChange={(event) => setTaskForm({ ...taskForm, taskTagInput: event.target.value })}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === ",") {
                        event.preventDefault();
                        addTaskFormTag(taskForm.taskTagInput);
                      }
                    }}
                  />
                  <button className="btn" onClick={() => addTaskFormTag(taskForm.taskTagInput)} type="button">
                    <Plus size={16} aria-hidden="true" />
                    {tr(language, "addTag")}
                  </button>
                </div>
                <div className="task-tag-picker" aria-label={tr(language, "taskGroups")}>
                  <button
                    className={`task-tag ${taskForm.taskTags.length === 0 ? "active" : ""}`}
                    onClick={() => setTaskForm({ ...taskForm, taskTags: [] })}
                    type="button"
                  >
                    {tr(language, "noGroup")}
                  </button>
                  {knownTaskTags.map((tag) => (
                    <button
                      className={`task-tag ${taskForm.taskTags.includes(tag) ? "active" : ""}`}
                      key={tag}
                      onClick={() => toggleTaskFormTag(tag)}
                      title={tag}
                      type="button"
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              </div>
              <div className="field">
                <label htmlFor="goal">{tr(language, "goal")}</label>
                <textarea
                  id="goal"
                  value={taskForm.goal}
                  onChange={(event) => setTaskForm({ ...taskForm, goal: event.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="scope">{tr(language, "scope")}</label>
                <div className="scope-reference-field">
                  <textarea
                    ref={scopeInputRef}
                    id="scope"
                    value={taskForm.scope}
                    onChange={(event) => {
                      setTaskForm({ ...taskForm, scope: event.target.value });
                      updateScopeMention(event.target);
                    }}
                    onClick={(event) => updateScopeMention(event.currentTarget)}
                    onKeyUp={(event) => updateScopeMention(event.currentTarget)}
                    onKeyDown={handleScopeKeyDown}
                    placeholder={tr(language, "scopePlaceholder")}
                  />
                  {scopeMention ? (
                    <div className="path-suggestions" role="listbox" aria-label={tr(language, "scopeSuggestions")}>
                      <div className="suggestion-hint">
                        {isLoadingSuggestions
                          ? tr(language, "searchingTarget")
                          : pathSuggestions.length > 0
                            ? tr(language, "insertSelectedPath")
                            : tr(language, "noMatchingPaths")}
                      </div>
                      {pathSuggestions.map((suggestion, index) => (
                        <Fragment key={`${suggestion.type}:${suggestion.path}`}>
                          {suggestion.match === "contains" && pathSuggestions[index - 1]?.match === "exact" ? (
                            <div className="suggestion-divider">{language === "ko" ? "포함 일치" : "Contains matches"}</div>
                          ) : null}
                          <button
                            className={`suggestion-item ${index === selectedSuggestionIndex ? "active" : ""}`}
                            onMouseDown={(event) => {
                              event.preventDefault();
                              insertScopeSuggestion(suggestion);
                            }}
                            role="option"
                            aria-selected={index === selectedSuggestionIndex}
                            type="button"
                          >
                            <span className="suggestion-type">{suggestion.type === "directory" ? "DIR" : "FILE"}</span>
                            <span className="suggestion-path" title={suggestion.path}>
                              {tailPath(suggestion.path)}
                            </span>
                          </button>
                        </Fragment>
                      ))}
                    </div>
                  ) : null}
                  <ScopeImageAttachments
                    images={scopeImages}
                    language={language}
                    addImages={addScopeImages}
                    removeImage={removeScopeImage}
                  />
                </div>
              </div>
              <div className="field">
                <label htmlFor="project">{tr(language, "targetProjectPath")}</label>
                <div className="input-with-button">
                  <input
                    id="project"
                    value={taskForm.targetProjectPath}
                    onChange={(event) => {
                      setTaskForm({ ...taskForm, targetProjectPath: event.target.value });
                      setNoteForm((current) => ({ ...current, projectPath: event.target.value }));
                    }}
                  />
                  <button className="btn icon-btn" onClick={openFolderBrowser} title={tr(language, "browseFolders")} type="button">
                    <FolderOpen size={16} aria-hidden="true" />
                  </button>
                </div>
              </div>
              <div className="field">
                <label htmlFor="verify">{tr(language, "verificationCommand")}</label>
                <input
                  id="verify"
                  value={taskForm.verificationCommand}
                  onChange={(event) => setTaskForm({ ...taskForm, verificationCommand: event.target.value })}
                />
              </div>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={taskForm.approvalGrant}
                  onChange={(event) => setTaskForm({ ...taskForm, approvalGrant: event.target.checked })}
                />
                {tr(language, "grantCli")}
              </label>
              <button className="btn primary" disabled={isSubmitting} type="submit">
                <Play size={16} aria-hidden="true" />
                {tr(language, "createAndQueue")}
              </button>
              {error ? <div className="error-text">{error}</div> : null}
            </form>
            </div>
          </section>
        </aside>

        <section className="detail-grid">
          <div className="summary-band">
            <div className="metric">
              <span>{tr(language, "active")}</span>
              <strong>{metrics.active}</strong>
            </div>
            <div className="metric">
              <span>{tr(language, "done")}</span>
              <strong>{metrics.done}</strong>
            </div>
            <div className="metric">
              <span>{tr(language, "blocked")}</span>
              <strong>{metrics.blocked}</strong>
            </div>
            <div className="metric">
              <span>{tr(language, "conventionNotes")}</span>
              <strong>{metrics.notes}</strong>
            </div>
          </div>

          <div className="split">
            <section className="panel">
              <div className="panel-header">
                <div className="panel-title">
                  <ListChecks size={18} aria-hidden="true" />
                  {tr(language, "parallelTasks")}
                </div>
              </div>
              <div className="panel-body task-list">
                <div className="task-group-tabs" aria-label={tr(language, "taskGroups")}>
                  <button
                    className={`task-group-tab ${selectedTaskTags.length === 0 ? "active" : ""}`}
                    onClick={() => setSelectedTaskTags([])}
                    type="button"
                  >
                    <span>{tr(language, "all")}</span>
                    <strong>{tasks.length}</strong>
                  </button>
                  {knownTaskTags.map((tag) => (
                    <span className="task-group-tab-shell" key={tag}>
                      <button
                        className={`task-group-tab ${selectedTaskTags.includes(tag) ? "active" : ""}`}
                        onClick={() => toggleSelectedTaskTag(tag)}
                        type="button"
                      >
                        <span>{tag}</span>
                        <strong>{taskTagCounts.get(tag) || 0}</strong>
                      </button>
                      <button
                        aria-label={`${tr(language, "deleteTag")}: ${tag}`}
                        className="tag-delete-btn"
                        onClick={() => void deleteGlobalTaskTag(tag)}
                        title={`${tr(language, "deleteTag")}: ${tag}`}
                        type="button"
                      >
                        <Trash2 size={12} aria-hidden="true" />
                      </button>
                    </span>
                  ))}
                  {hasUntaggedTasks ? (
                    <button
                      className={`task-group-tab ${selectedTaskTags.includes("__untagged__") ? "active" : ""}`}
                      onClick={() => toggleSelectedTaskTag("__untagged__")}
                      type="button"
                    >
                      <span>{tr(language, "ungrouped")}</span>
                      <strong>{tasks.filter((task) => taskTagsOf(task).length === 0).length}</strong>
                    </button>
                  ) : null}
                </div>
                {tasks.length === 0 ? (
                  <div className="empty">{tr(language, "noTasksYet")}</div>
                ) : visibleTasks.length === 0 ? (
                  <div className="empty">{tr(language, "noTasksInGroup")}</div>
                ) : (
                  <div className="task-tree" role="tree">
                    {visibleTaskTree.map((node) => renderTaskTreeNode(node, 0))}
                  </div>
                )}
              </div>
            </section>

            <section className="panel">
              <div className="panel-header">
                <div className="panel-title">
                  <Activity size={18} aria-hidden="true" />
                  {tr(language, "taskDetail")}
                </div>
                <button className="btn" onClick={() => void startSelectedTask()} disabled={!selectedTaskId}>
                  <Play size={16} aria-hidden="true" />
                  {tr(language, "run")}
                </button>
              </div>
              <div className="panel-body">
                {!taskDetail ? (
                  <div className="empty">{tr(language, "selectTaskEmpty")}</div>
                ) : (
                  <TaskDetailView
                    language={language}
                    task={taskDetail}
                    tab={tab}
                    setTab={setTab}
                    notes={notes}
                    noteForm={noteForm}
                    setNoteForm={setNoteForm}
                    submitNote={submitNote}
                    exportConventions={exportConventions}
                    exportPreview={exportPreview}
                    followUpMessage={followUpMessage}
                    setFollowUpMessage={setFollowUpMessage}
                    createFollowUp={createFollowUpForSelectedTask}
                    isCreatingFollowUp={isCreatingFollowUp}
                    uploadAttachments={uploadTaskImages}
                    isUploadingAttachment={isUploadingAttachment}
                    selectTask={setSelectedTaskId}
                    knownTaskTags={knownTaskTags}
                    updateTaskTags={updateTaskTags}
                    deleteTaskTag={deleteGlobalTaskTag}
                  />
                )}
              </div>
            </section>
          </div>
        </section>
      </section>

      {isSettingsOpen ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setSettingsOpen(false)}>
          <section
            aria-modal="true"
            className="settings-modal"
            role="dialog"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div className="panel-title">
                <Settings size={18} aria-hidden="true" />
                {tr(language, "settings")}
              </div>
              <button className="btn" onClick={() => setSettingsOpen(false)}>
                {tr(language, "close")}
              </button>
            </div>
            <div className="settings-section">
              <div className="section-title">
                <SlidersHorizontal size={18} aria-hidden="true" />
                {tr(language, "agentSettings")}
              </div>
              <AgentSettingsForm
                language={language}
                agentSettings={agentSettings}
                modelCatalog={modelCatalog}
                isSavingSettings={isSavingSettings}
                setAgentSettings={setAgentSettings}
                saveAgentSettings={saveAgentSettings}
              />
            </div>
            <div className="settings-section">
              <div className="section-title">
                <NotebookTabs size={18} aria-hidden="true" />
                {tr(language, "notionSync")}
              </div>
              <NotionSettingsForm
                language={language}
                notionSettings={notionSettings}
                isSavingNotion={isSavingNotion}
                isSyncingNotionTasks={isSyncingNotionTasks}
                isImportingNotionTasks={isImportingNotionTasks}
                setNotionSettings={setNotionSettings}
                saveNotionSettings={saveNotionSettings}
                syncAllTasksToNotionDb={syncAllTasksToNotionDb}
                importTasksFromNotionDb={importTasksFromNotionDb}
              />
            </div>
            <div className="settings-section">
              <div className="section-title">
                <GitBranch size={18} aria-hidden="true" />
                {tr(language, "worktreeCleanup")}
              </div>
              <div className="button-row">
                <button
                  className="btn"
                  disabled={isCleaningWorktrees}
                  onClick={() => void cleanupHarnessWorktrees("completed")}
                  type="button"
                >
                  <Trash2 size={16} aria-hidden="true" />
                  {tr(language, "cleanupCompletedWorktrees")}
                </button>
                <button
                  className="btn"
                  disabled={isCleaningWorktrees}
                  onClick={() => void cleanupHarnessWorktrees("expired-blocked")}
                  type="button"
                >
                  <Trash2 size={16} aria-hidden="true" />
                  {tr(language, "cleanupExpiredBlockedWorktrees")}
                </button>
                <button
                  className="btn"
                  disabled={isCleaningWorktrees}
                  onClick={() => void cleanupHarnessWorktrees("failed")}
                  type="button"
                >
                  <Trash2 size={16} aria-hidden="true" />
                  {tr(language, "cleanupFailedWorktrees")}
                </button>
                <button
                  className="btn"
                  disabled={isCleaningWorktrees}
                  onClick={() => void cleanupHarnessWorktrees("all")}
                  type="button"
                >
                  <Trash2 size={16} aria-hidden="true" />
                  {tr(language, "cleanupAllWorktrees")}
                </button>
              </div>
              {worktreeCleanupSummary ? (
                <div className="notice-line">
                  <strong>{tr(language, "cleanupSummary")}</strong>
                  <pre>{worktreeCleanupSummary}</pre>
                </div>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
      {isFolderBrowserOpen ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setFolderBrowserOpen(false)}>
          <section
            aria-modal="true"
            className="settings-modal folder-browser-modal"
            role="dialog"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div className="panel-title">
                <FolderOpen size={18} aria-hidden="true" />
                {tr(language, "selectTargetFolder")}
              </div>
              <button className="btn" onClick={() => setFolderBrowserOpen(false)}>
                {tr(language, "close")}
              </button>
            </div>
            <div className="settings-section">
              <div className="folder-browser-toolbar">
                <button
                  className="btn"
                  disabled={!folderBrowser?.parentPath || isLoadingFolders}
                  onClick={() => folderBrowser?.parentPath && void loadFolderBrowser(folderBrowser.parentPath)}
                  type="button"
                >
                  {language === "ko" ? "상위" : "Up"}
                </button>
                <button
                  className="btn primary"
                  disabled={!folderBrowser?.currentPath}
                  onClick={() => folderBrowser?.currentPath && selectProjectFolder(folderBrowser.currentPath)}
                  type="button"
                >
                  {tr(language, "selectThisFolder")}
                </button>
              </div>
              <div className="folder-current-path" title={folderBrowser?.currentPath || ""}>
                {folderBrowser?.currentPath || "Loading..."}
              </div>
              {folderBrowser?.roots.length ? (
                <div className="folder-roots">
                  {folderBrowser.roots.map((root) => (
                    <button
                      className="btn"
                      key={root}
                      onClick={() => void loadFolderBrowser(root)}
                      title={root}
                      type="button"
                    >
                      {root}
                    </button>
                  ))}
                </div>
              ) : null}
              {folderBrowserError ? <div className="error-text">{folderBrowserError}</div> : null}
              <div className="folder-list">
                {isLoadingFolders ? <div className="empty">{tr(language, "loadingFolders")}</div> : null}
                {!isLoadingFolders && folderBrowser?.entries.length === 0 ? (
                  <div className="empty">{tr(language, "noChildFolders")}</div>
                ) : null}
                {!isLoadingFolders
                  ? folderBrowser?.entries.map((entry) => (
                      <button
                        className="folder-row"
                        key={entry.path}
                        onClick={() => void loadFolderBrowser(entry.path)}
                        title={entry.path}
                        type="button"
                      >
                        <FolderOpen size={15} aria-hidden="true" />
                        <span>{entry.name}</span>
                      </button>
                    ))
                  : null}
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

function AgentSettingsForm(props: {
  language: UiLanguage;
  agentSettings: AgentSetting[];
  modelCatalog: ModelCatalog;
  isSavingSettings: boolean;
  setAgentSettings: React.Dispatch<React.SetStateAction<AgentSetting[]>>;
  saveAgentSettings: (event: FormEvent) => Promise<void>;
}): React.ReactElement {
  return (
    <form className="form-grid" onSubmit={(event) => void props.saveAgentSettings(event)}>
      <div className="settings-grid">
        {props.agentSettings.map((setting) => (
          <div className="role-setting" key={setting.role}>
            <div className="role-name">{setting.role}</div>
            <select
              aria-label={`${setting.role} provider`}
              value={setting.provider}
              onChange={(event) =>
                props.setAgentSettings((current) =>
                  current.map((item) => {
                    if (item.role !== setting.role) {
                      return item;
                    }
                    const provider = event.target.value as AgentSetting["provider"];
                    const firstModel = props.modelCatalog[provider]?.[0]?.id || item.model;
                    return { ...item, provider, model: firstModel };
                  })
                )
              }
            >
              <option value="openai">openai</option>
              <option value="codex-cli">codex-cli</option>
              <option value="mock">mock</option>
            </select>
            <select
              aria-label={`${setting.role} model`}
              value={setting.model}
              onChange={(event) =>
                props.setAgentSettings((current) =>
                  current.map((item) => (item.role === setting.role ? { ...item, model: event.target.value } : item))
                )
              }
            >
              {(props.modelCatalog[setting.provider] || []).map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}
                </option>
              ))}
            </select>
            <label className="inline-field">
              <span>{tr(props.language, "reasoningEffort")}</span>
              <select
                aria-label={`${setting.role} reasoning effort`}
                value={setting.reasoningEffort}
                onChange={(event) =>
                  props.setAgentSettings((current) =>
                    current.map((item) =>
                      item.role === setting.role
                        ? { ...item, reasoningEffort: event.target.value as AgentSetting["reasoningEffort"] }
                        : item
                    )
                  )
                }
              >
                {REASONING_EFFORT_OPTIONS.map((effort) => (
                  <option key={effort} value={effort}>
                    {effort}
                  </option>
                ))}
              </select>
            </label>
            <label className="inline-field">
              <span>{tr(props.language, "serviceTier")}</span>
              <select
                aria-label={`${setting.role} service tier`}
                value={setting.serviceTier}
                onChange={(event) =>
                  props.setAgentSettings((current) =>
                    current.map((item) =>
                      item.role === setting.role
                        ? { ...item, serviceTier: event.target.value as AgentSetting["serviceTier"] }
                        : item
                    )
                  )
                }
              >
                {SERVICE_TIER_OPTIONS.map((tier) => (
                  <option key={tier} value={tier}>
                    {tier}
                  </option>
                ))}
              </select>
            </label>
            <div className="model-description">
              {(props.modelCatalog[setting.provider] || []).find((model) => model.id === setting.model)?.description ||
                setting.model}
            </div>
          </div>
        ))}
      </div>
      <button className="btn primary" type="submit" disabled={props.isSavingSettings || props.agentSettings.length === 0}>
        <SlidersHorizontal size={16} aria-hidden="true" />
        {tr(props.language, "saveSettings")}
      </button>
    </form>
  );
}

function NotionSettingsForm(props: {
  language: UiLanguage;
  notionSettings: NotionSettings;
  isSavingNotion: boolean;
  isSyncingNotionTasks: boolean;
  isImportingNotionTasks: boolean;
  setNotionSettings: React.Dispatch<React.SetStateAction<NotionSettings>>;
  saveNotionSettings: (event: FormEvent) => Promise<void>;
  syncAllTasksToNotionDb: () => Promise<void>;
  importTasksFromNotionDb: () => Promise<void>;
}): React.ReactElement {
  const canUseNotionDatabase = props.notionSettings.tokenConfigured && Boolean(props.notionSettings.parentPageId.trim());
  return (
    <form className="form-grid" onSubmit={(event) => void props.saveNotionSettings(event)}>
      <div className="notice-line">
        Token: {props.notionSettings.tokenConfigured ? tr(props.language, "tokenConfigured") : tr(props.language, "tokenMissing")}
      </div>
      <div className="notice-line">
        {tr(props.language, "notionDatabase")}:{" "}
        {props.notionSettings.dataSourceId ? tr(props.language, "tokenConfigured") : "-"}
      </div>
      <div className="field">
        <label htmlFor="notion-parent">{tr(props.language, "notionParentPageId")}</label>
        <input
          id="notion-parent"
          value={props.notionSettings.parentPageId}
          onChange={(event) =>
            props.setNotionSettings((current) => ({ ...current, parentPageId: event.target.value }))
          }
          placeholder={tr(props.language, "notionPlaceholder")}
        />
      </div>
      <button
        className="btn primary"
        type="submit"
        disabled={props.isSavingNotion || !props.notionSettings.parentPageId.trim()}
      >
        <NotebookTabs size={16} aria-hidden="true" />
        {tr(props.language, "saveNotionSettings")}
      </button>
      <div className="button-row">
        <button
          className="btn"
          disabled={!canUseNotionDatabase || props.isSyncingNotionTasks}
          onClick={() => void props.syncAllTasksToNotionDb()}
          type="button"
        >
          <NotebookTabs size={16} aria-hidden="true" />
          {tr(props.language, "syncNotionTasks")}
        </button>
        <button
          className="btn"
          disabled={!canUseNotionDatabase || props.isImportingNotionTasks}
          onClick={() => void props.importTasksFromNotionDb()}
          type="button"
        >
          <RefreshCw size={16} aria-hidden="true" />
          {tr(props.language, "importNotionTasks")}
        </button>
      </div>
    </form>
  );
}

function ScopeImageAttachments(props: {
  images: File[];
  language: UiLanguage;
  addImages: (files: File[]) => void;
  removeImage: (index: number) => void;
}): React.ReactElement {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setDragging] = useState(false);
  const previews = useMemo(
    () =>
      props.images.map((file) => ({
        file,
        url: URL.createObjectURL(file)
      })),
    [props.images]
  );

  useEffect(() => {
    return () => {
      for (const preview of previews) {
        URL.revokeObjectURL(preview.url);
      }
    };
  }, [previews]);

  function addFiles(fileList: FileList | null): void {
    const files = Array.from(fileList || []);
    if (files.length > 0) {
      props.addImages(files);
    }
  }

  return (
    <div className="scope-image-box">
      <div
        className={`scope-image-dropzone ${isDragging ? "dragging" : ""}`}
        onClick={() => fileInputRef.current?.click()}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          addFiles(event.dataTransfer.files);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            fileInputRef.current?.click();
          }
        }}
        role="button"
        tabIndex={0}
      >
        <ImageIcon size={16} aria-hidden="true" />
        <span>{tr(props.language, "scopeDropImages")}</span>
        <small>{tr(props.language, "imageLimit")}</small>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          onChange={(event) => {
            addFiles(event.target.files);
            event.target.value = "";
          }}
        />
      </div>
      {previews.length > 0 ? (
        <div className="scope-image-preview">
          <div className="scope-image-heading">{tr(props.language, "pendingImages")}</div>
          <div className="scope-image-grid">
            {previews.map((preview, index) => (
              <div className="scope-image-card" key={`${preview.file.name}-${preview.file.lastModified}-${index}`}>
                <img src={preview.url} alt={preview.file.name} />
                <span title={preview.file.name}>{preview.file.name}</span>
                <button
                  aria-label={`${props.language === "ko" ? "이미지 제거" : "Remove image"} ${preview.file.name}`}
                  onClick={() => props.removeImage(index)}
                  type="button"
                >
                  <Trash2 size={13} aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TaskDetailView(props: {
  language: UiLanguage;
  task: TaskDetail;
  tab: Tab;
  setTab: (tab: Tab) => void;
  notes: ConventionNote[];
  noteForm: {
    projectPath: string;
    category: string;
    rule: string;
    reason: string;
    source: string;
    confidence: ConventionNote["confidence"];
    examples: string;
  };
  setNoteForm: React.Dispatch<React.SetStateAction<{
    projectPath: string;
    category: string;
    rule: string;
    reason: string;
    source: string;
    confidence: ConventionNote["confidence"];
    examples: string;
  }>>;
  submitNote: (event: FormEvent) => Promise<void>;
  exportConventions: (writeFiles: boolean) => Promise<void>;
  exportPreview: string;
  followUpMessage: string;
  setFollowUpMessage: React.Dispatch<React.SetStateAction<string>>;
  createFollowUp: (event: FormEvent) => Promise<void>;
  isCreatingFollowUp: boolean;
  uploadAttachments: (files: File[]) => Promise<void>;
  isUploadingAttachment: boolean;
  selectTask: (taskId: string) => void;
  knownTaskTags: string[];
  updateTaskTags: (taskId: string, tags: string[]) => Promise<void>;
  deleteTaskTag: (tag: string) => Promise<void>;
}): React.ReactElement {
  const tabs = tabLabels(props.language);
  const [detailTagInput, setDetailTagInput] = useState("");
  const currentTags = taskTagsOf(props.task);
  const allDetailTags = Array.from(new Set([...props.knownTaskTags, ...currentTags])).sort((a, b) => a.localeCompare(b));

  function toggleDetailTag(tag: string): void {
    const nextTags = currentTags.includes(tag) ? currentTags.filter((item) => item !== tag) : [...currentTags, tag];
    void props.updateTaskTags(props.task.id, nextTags);
  }

  function addDetailTag(): void {
    const trimmedTag = detailTagInput.trim();
    if (!trimmedTag) {
      return;
    }
    setDetailTagInput("");
    void props.updateTaskTags(props.task.id, normalizeTaskTags([...currentTags, trimmedTag]));
  }

  return (
    <div className="detail-grid">
      <div className="meta-row">
        <span className={`pill ${props.task.status}`}>{statusLabel(props.task.status, props.language)}</span>
        {currentTags.map((tag) => (
          <span className="pill group" key={tag}>
            {taskTagLabel(tag, props.language)}
          </span>
        ))}
        <span className="pill">
          <GitBranch size={13} aria-hidden="true" />
          {tr(props.language, "round")} {props.task.currentRound}
        </span>
      </div>
      <div>
        <h2 style={{ margin: "0 0 6px", fontSize: 18 }}>{props.task.title}</h2>
        <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.5 }}>{props.task.goal}</p>
      </div>
      {props.task.failureReason ? <div className="error-text">{props.task.failureReason}</div> : null}
      <div className="workspace-path">{props.task.worktreePath || props.task.targetProjectPath}</div>

      <section className="tag-editor">
        <div className="section-title">{tr(props.language, "taskGroups")}</div>
        <div className="tag-input-row">
          <input
            value={detailTagInput}
            onChange={(event) => setDetailTagInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === ",") {
                event.preventDefault();
                addDetailTag();
              }
            }}
          />
          <button className="btn" onClick={addDetailTag} type="button">
            <Plus size={16} aria-hidden="true" />
            {tr(props.language, "addTag")}
          </button>
        </div>
        <div className="task-tag-picker" aria-label={tr(props.language, "taskGroups")}>
          <button
            className={`task-tag ${currentTags.length === 0 ? "active" : ""}`}
            onClick={() => void props.updateTaskTags(props.task.id, [])}
            type="button"
          >
            {tr(props.language, "noGroup")}
          </button>
          {allDetailTags.map((tag) => (
            <span className="task-tag-shell" key={tag}>
              <button
                className={`task-tag ${currentTags.includes(tag) ? "active" : ""}`}
                onClick={() => toggleDetailTag(tag)}
                type="button"
              >
                {tag}
              </button>
              <button
                aria-label={`${tr(props.language, "deleteTag")}: ${tag}`}
                className="tag-delete-btn"
                onClick={() => void props.deleteTaskTag(tag)}
                title={`${tr(props.language, "deleteTag")}: ${tag}`}
                type="button"
              >
                <Trash2 size={12} aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      </section>

      {props.task.parentTaskId ? (
        <div className="notice-line">
          {tr(props.language, "followUpOfTask")} {props.task.parentTaskId}
        </div>
      ) : null}

      <TaskAttachments
        language={props.language}
        attachments={props.task.attachments}
        isUploading={props.isUploadingAttachment}
        uploadAttachments={props.uploadAttachments}
      />

      <form className="follow-up-box" onSubmit={(event) => void props.createFollowUp(event)}>
        <label htmlFor="follow-up-message">{tr(props.language, "followUp")}</label>
        <textarea
          id="follow-up-message"
          value={props.followUpMessage}
          onChange={(event) => props.setFollowUpMessage(event.target.value)}
          placeholder={tr(props.language, "followUpPlaceholder")}
        />
        <button className="btn primary" disabled={props.isCreatingFollowUp || !props.followUpMessage.trim()} type="submit">
          <Play size={16} aria-hidden="true" />
          {tr(props.language, "createFollowUpTask")}
        </button>
      </form>

      {props.task.childTasks.length > 0 ? (
        <div className="follow-up-list">
          <div className="section-title">{tr(props.language, "followUpTasks")}</div>
          {props.task.childTasks.map((task) => (
            <button className="follow-up-item" key={task.id} onClick={() => props.selectTask(task.id)} type="button">
              <span className={`pill ${task.status}`}>{statusLabel(task.status, props.language)}</span>
              <span>{task.title}</span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="tabs">
        {tabs.map((item) => (
          <button
            className={`tab ${props.tab === item.id ? "active" : ""}`}
            key={item.id}
            onClick={() => props.setTab(item.id)}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </div>

      {props.tab === "agents" ? <AgentRuns language={props.language} runs={props.task.agentRuns} /> : null}
      {props.tab === "artifacts" ? <BrokerArtifacts language={props.language} artifacts={props.task.brokerArtifacts} /> : null}
      {props.tab === "shell" ? <ShellLogs language={props.language} logs={props.task.shellLogs} /> : null}
      {props.tab === "verifications" ? <Verifications language={props.language} verifications={props.task.verifications} /> : null}
      {props.tab === "conventions" ? (
        <ConventionPanel
          language={props.language}
          notes={props.notes}
          form={props.noteForm}
          setForm={props.setNoteForm}
          submitNote={props.submitNote}
          exportConventions={props.exportConventions}
          exportPreview={props.exportPreview}
        />
      ) : null}
    </div>
  );
}

function TaskAttachments(props: {
  language: UiLanguage;
  attachments: TaskAttachment[];
  isUploading: boolean;
  uploadAttachments: (files: File[]) => Promise<void>;
}): React.ReactElement {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setDragging] = useState(false);

  function uploadFiles(fileList: FileList | null): void {
    const files = Array.from(fileList || []);
    if (files.length > 0) {
      void props.uploadAttachments(files);
    }
  }

  return (
    <section className="attachment-panel">
      <div className="section-title">
        <ImageIcon size={16} aria-hidden="true" />
        {tr(props.language, "attachments")}
      </div>
      <div
        className={`attachment-dropzone ${isDragging ? "dragging" : ""}`}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          uploadFiles(event.dataTransfer.files);
        }}
        role="button"
        tabIndex={0}
        onClick={() => fileInputRef.current?.click()}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            fileInputRef.current?.click();
          }
        }}
      >
        <Upload size={18} aria-hidden="true" />
        <span>{props.isUploading ? tr(props.language, "uploadImages") : tr(props.language, "dropImages")}</span>
        <small>{tr(props.language, "imageLimit")}</small>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          onChange={(event) => {
            uploadFiles(event.target.files);
            event.target.value = "";
          }}
        />
      </div>
      {props.attachments.length > 0 ? (
        <div className="attachment-grid">
          {props.attachments.map((attachment) => (
            <a
              className="attachment-card"
              href={`/api/attachments/${attachment.id}`}
              key={attachment.id}
              target="_blank"
              rel="noreferrer"
              title={attachment.originalName}
            >
              <img src={`/api/attachments/${attachment.id}`} alt={attachment.originalName} />
              <span>{attachment.originalName}</span>
              <small>{(attachment.sizeBytes / 1024).toFixed(1)} KB</small>
            </a>
          ))}
        </div>
      ) : (
        <div className="empty compact">{tr(props.language, "noImages")}</div>
      )}
    </section>
  );
}

function BrokerArtifacts({ language, artifacts }: { language: UiLanguage; artifacts: BrokerArtifact[] }): React.ReactElement {
  if (artifacts.length === 0) {
    return <div className="empty">{tr(language, "noBrokerArtifacts")}</div>;
  }
  return (
    <div className="log-stack">
      {artifacts.map((artifact) => (
        <div className="log-entry" key={artifact.id}>
          <header>
            <span>
              {artifact.kind} / {artifact.sourceRole} / round {artifact.round}
            </span>
            <span>{artifact.createdAt}</span>
          </header>
          <pre>{artifact.content}</pre>
        </div>
      ))}
    </div>
  );
}

function AgentRuns({ language, runs }: { language: UiLanguage; runs: AgentRun[] }): React.ReactElement {
  if (runs.length === 0) {
    return <div className="empty">{tr(language, "noAgentRuns")}</div>;
  }
  return (
    <div className="log-stack">
      {runs.map((run) => {
        const rawOutput = run.error || run.output || "Running...";
        const displayOutput = localizedAgentOutput(rawOutput, language);
        const showOriginal = language === "ko" && displayOutput !== rawOutput;
        return (
          <div className="log-entry" key={run.id}>
            <header>
              <span>
                {run.role} / {run.provider} / {run.model} / {run.reasoningEffort} / {run.serviceTier} / round {run.round}
              </span>
              <span>{run.status}</span>
            </header>
            <div className="run-budget">
              <span>{run.inputChars.toLocaleString()} {language === "ko" ? "입력 문자" : "input chars"}</span>
              <span>{run.outputChars.toLocaleString()} {language === "ko" ? "출력 문자" : "output chars"}</span>
              <span>{run.contextBudgetChars.toLocaleString()} {language === "ko" ? "컨텍스트 예산" : "context budget"}</span>
              <span>{Math.round(run.timeBudgetMs / 1000)}s {language === "ko" ? "시간 예산" : "time budget"}</span>
              {run.wasTrimmed ? <span className="budget-warn">{language === "ko" ? "잘림" : "trimmed"}</span> : null}
              {run.timedOut ? <span className="budget-danger">{language === "ko" ? "시간 초과" : "timed out"}</span> : null}
            </div>
            {run.workspacePath || run.branchName ? (
              <div className="run-budget">
                {run.branchName ? <span>branch: {run.branchName}</span> : null}
                {run.workspacePath ? <span title={run.workspacePath}>worktree: {tailPath(run.workspacePath, 80)}</span> : null}
              </div>
            ) : null}
            <pre>{displayOutput}</pre>
            {showOriginal ? (
              <details className="original-output">
                <summary>{tr(language, "originalOutput")}</summary>
                <pre>{rawOutput}</pre>
              </details>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function ShellLogs({ language, logs }: { language: UiLanguage; logs: ShellLog[] }): React.ReactElement {
  if (logs.length === 0) {
    return <div className="empty">{tr(language, "noShellCommands")}</div>;
  }
  return (
    <div className="log-stack">
      {logs.map((log) => (
        <div className="log-entry" key={log.id}>
          <header>
            <span>
              {log.agentRole} / exit {log.exitCode ?? "signal"} / {log.durationMs}ms
            </span>
            <span>{log.createdAt}</span>
          </header>
          <pre>{`PS ${log.cwd}> ${log.command}\n\nSTDOUT\n${log.stdout}\n\nSTDERR\n${log.stderr}`}</pre>
        </div>
      ))}
    </div>
  );
}

function Verifications({ language, verifications }: { language: UiLanguage; verifications: Verification[] }): React.ReactElement {
  if (verifications.length === 0) {
    return <div className="empty">{tr(language, "noVerifierDecisions")}</div>;
  }
  return (
    <div className="log-stack">
      {verifications.map((verification) => (
        <div className="log-entry" key={verification.id}>
          <header>
            <span>
              {tr(language, "round")} {verification.round} / {verification.decision}
            </span>
            <span>{verification.exitCode === null ? (language === "ko" ? "명령 없음" : "no command") : `exit ${verification.exitCode}`}</span>
          </header>
          <pre>{verification.summary}</pre>
        </div>
      ))}
    </div>
  );
}

function ConventionPanel(props: {
  language: UiLanguage;
  notes: ConventionNote[];
  form: {
    projectPath: string;
    category: string;
    rule: string;
    reason: string;
    source: string;
    confidence: ConventionNote["confidence"];
    examples: string;
  };
  setForm: React.Dispatch<React.SetStateAction<{
    projectPath: string;
    category: string;
    rule: string;
    reason: string;
    source: string;
    confidence: ConventionNote["confidence"];
    examples: string;
  }>>;
  submitNote: (event: FormEvent) => Promise<void>;
  exportConventions: (writeFiles: boolean) => Promise<void>;
  exportPreview: string;
}): React.ReactElement {
  return (
    <div className="detail-grid">
      <form className="form-grid" onSubmit={(event) => void props.submitNote(event)}>
        <div className="field">
          <label htmlFor="note-rule">{tr(props.language, "rule")}</label>
          <input
            id="note-rule"
            value={props.form.rule}
            onChange={(event) => props.setForm((current) => ({ ...current, rule: event.target.value }))}
            placeholder={
              props.language === "ko"
                ? "예: gameplay ID와 현지화된 표시 텍스트는 분리한다."
                : "Example: Keep gameplay IDs separate from localized display text."
            }
          />
        </div>
        <div className="split">
          <div className="field">
            <label htmlFor="note-category">{tr(props.language, "category")}</label>
            <input
              id="note-category"
              value={props.form.category}
              onChange={(event) => props.setForm((current) => ({ ...current, category: event.target.value }))}
            />
          </div>
          <div className="field">
            <label htmlFor="note-confidence">{tr(props.language, "confidence")}</label>
            <select
              id="note-confidence"
              value={props.form.confidence}
              onChange={(event) =>
                props.setForm((current) => ({
                  ...current,
                  confidence: event.target.value as ConventionNote["confidence"]
                }))
              }
            >
              <option value="low">{confidenceLabel("low", props.language)}</option>
              <option value="medium">{confidenceLabel("medium", props.language)}</option>
              <option value="high">{confidenceLabel("high", props.language)}</option>
            </select>
          </div>
        </div>
        <div className="field">
          <label htmlFor="note-reason">{tr(props.language, "reason")}</label>
          <textarea
            id="note-reason"
            value={props.form.reason}
            onChange={(event) => props.setForm((current) => ({ ...current, reason: event.target.value }))}
          />
        </div>
        <div className="field">
          <label htmlFor="note-examples">{tr(props.language, "examples")}</label>
          <textarea
            id="note-examples"
            value={props.form.examples}
            onChange={(event) => props.setForm((current) => ({ ...current, examples: event.target.value }))}
          />
        </div>
        <div className="button-row">
          <button className="btn primary" type="submit" disabled={!props.form.rule.trim()}>
            <Plus size={16} aria-hidden="true" />
            {tr(props.language, "addRule")}
          </button>
          <button className="btn" type="button" onClick={() => void props.exportConventions(false)}>
            <FileDown size={16} aria-hidden="true" />
            {tr(props.language, "previewExport")}
          </button>
          <button className="btn warn" type="button" onClick={() => void props.exportConventions(true)}>
            <FileDown size={16} aria-hidden="true" />
            {tr(props.language, "writeAgents")}
          </button>
        </div>
      </form>

      <div className="log-stack">
        {props.notes.length === 0 ? (
          <div className="empty">{tr(props.language, "noUnityNotes")}</div>
        ) : (
          props.notes.map((note) => (
            <div className="log-entry" key={note.id}>
              <header>
                <span>
                  {note.category} / {note.confidence}
                </span>
                <span>{note.source}</span>
              </header>
              <pre>{[note.rule, note.reason, note.examples].filter(Boolean).join("\n\n")}</pre>
            </div>
          ))
        )}
      </div>

      {props.exportPreview ? (
        <div className="log-entry">
          <header>
            <span>{tr(props.language, "exportPreview")}</span>
            <span>AGENTS.md + CONVENTIONS.md</span>
          </header>
          <pre>{props.exportPreview}</pre>
        </div>
      ) : null}
    </div>
  );
}
