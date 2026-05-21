"use client";

import type React from "react";
import { FormEvent, Fragment, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ClipboardCheck,
  Database,
  FileDown,
  FolderOpen,
  Gauge,
  GitBranch,
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
  TerminalSquare
} from "lucide-react";
import type {
  AgentRun,
  AgentSetting,
  BrokerArtifact,
  ConventionNote,
  ShellLog,
  Task,
  TaskDetail,
  Verification
} from "@/lib/types";
import type { ModelOption } from "@/lib/model-catalog";

type Tab = "agents" | "artifacts" | "shell" | "verifications" | "conventions";

const defaultProjectPath = "D:\\dev\\Deluge";
type ModelCatalog = Record<AgentSetting["provider"], ModelOption[]>;
type NotionSettings = {
  parentPageId: string;
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

function statusLabel(status: Task["status"]): string {
  const labels: Record<Task["status"], string> = {
    queued: "Queued",
    running: "Running",
    reviewing: "Reviewing",
    verifying: "Verifying",
    needs_fix: "Needs Fix",
    done: "Done",
    blocked: "Blocked"
  };
  return labels[status];
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

export default function HomePage(): React.ReactElement {
  const scopeInputRef = useRef<HTMLTextAreaElement | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [taskDetail, setTaskDetail] = useState<TaskDetail | null>(null);
  const [tab, setTab] = useState<Tab>("agents");
  const [notes, setNotes] = useState<ConventionNote[]>([]);
  const [agentSettings, setAgentSettings] = useState<AgentSetting[]>([]);
  const [modelCatalog, setModelCatalog] = useState<ModelCatalog>({ openai: [], mock: [] });
  const [notionSettings, setNotionSettings] = useState<NotionSettings>({
    parentPageId: "",
    updatedAt: null,
    tokenConfigured: false
  });
  const [isSubmitting, setSubmitting] = useState(false);
  const [isSavingSettings, setSavingSettings] = useState(false);
  const [isSavingNotion, setSavingNotion] = useState(false);
  const [isSyncingNotion, setSyncingNotion] = useState(false);
  const [isSettingsOpen, setSettingsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportPreview, setExportPreview] = useState<string>("");
  const [scopeMention, setScopeMention] = useState<ScopeMention | null>(null);
  const [pathSuggestions, setPathSuggestions] = useState<PathSuggestion[]>([]);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
  const [isLoadingSuggestions, setLoadingSuggestions] = useState(false);
  const [isFolderBrowserOpen, setFolderBrowserOpen] = useState(false);
  const [isLoadingFolders, setLoadingFolders] = useState(false);
  const [folderBrowser, setFolderBrowser] = useState<FolderBrowserResult | null>(null);
  const [folderBrowserError, setFolderBrowserError] = useState<string | null>(null);

  const [taskForm, setTaskForm] = useState({
    title: "Unity convention-safe task",
    goal: "Investigate or implement a scoped Unity change with automatic review and verification.",
    scope: "Keep edits inside the selected project and preserve Unity asset/meta conventions.",
    targetProjectPath: defaultProjectPath,
    verificationCommand: "dotnet build Deluge.sln --no-restore",
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

  async function refreshTasks(): Promise<void> {
    const data = await jsonFetch<{ tasks: Task[] }>("/api/tasks");
    setTasks(data.tasks);
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
    const data = await jsonFetch<{ task: TaskDetail }>(`/api/tasks/${taskId}`);
    setTaskDetail(data.task);
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
      void refreshDetail(selectedTaskId);
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

  async function submitTask(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const data = await jsonFetch<{ task: Task }>("/api/tasks", {
        method: "POST",
        body: JSON.stringify(taskForm)
      });
      setSelectedTaskId(data.task.id);
      await refreshTasks();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
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

  async function syncSelectedTaskToNotion(): Promise<void> {
    if (!selectedTaskId) {
      return;
    }
    setSyncingNotion(true);
    setError(null);
    try {
      await jsonFetch("/api/notion/sync", {
        method: "POST",
        body: JSON.stringify({ taskId: selectedTaskId })
      });
      await refreshDetail(selectedTaskId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSyncingNotion(false);
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

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <Gauge size={20} aria-hidden="true" />
          </div>
          <div>
            <h1>Local Multi-Agent Harness</h1>
            <p>API agents, verifier loops, worktree isolation, Unity convention memory</p>
          </div>
        </div>
        <div className="top-actions">
          <ShieldCheck size={16} aria-hidden="true" />
          <span>localhost only / CLI through local worker</span>
          <button className="btn" onClick={() => setSettingsOpen(true)} title="Settings">
            <Settings size={16} aria-hidden="true" />
            Settings
          </button>
          <button className="btn" onClick={() => void refreshTasks()} title="Refresh tasks">
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
                New Task
              </div>
            </div>
            <div className="panel-body">
            <form className="form-grid" onSubmit={(event) => void submitTask(event)}>
              <div className="field">
                <label htmlFor="title">Title</label>
                <input
                  id="title"
                  value={taskForm.title}
                  onChange={(event) => setTaskForm({ ...taskForm, title: event.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="goal">Goal</label>
                <textarea
                  id="goal"
                  value={taskForm.goal}
                  onChange={(event) => setTaskForm({ ...taskForm, goal: event.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="scope">Scope</label>
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
                    placeholder={'Files, folders, and constraints. Type @ to search inside Target project path.'}
                  />
                  {scopeMention ? (
                    <div className="path-suggestions" role="listbox" aria-label="Scope path suggestions">
                      <div className="suggestion-hint">
                        {isLoadingSuggestions
                          ? "Searching target project..."
                          : pathSuggestions.length > 0
                            ? "Enter/Tab inserts selected path"
                            : "No matching files or folders"}
                      </div>
                      {pathSuggestions.map((suggestion, index) => (
                        <Fragment key={`${suggestion.type}:${suggestion.path}`}>
                          {suggestion.match === "contains" && pathSuggestions[index - 1]?.match === "exact" ? (
                            <div className="suggestion-divider">Contains matches</div>
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
                </div>
              </div>
              <div className="field">
                <label htmlFor="project">Target project path</label>
                <div className="input-with-button">
                  <input
                    id="project"
                    value={taskForm.targetProjectPath}
                    onChange={(event) => {
                      setTaskForm({ ...taskForm, targetProjectPath: event.target.value });
                      setNoteForm((current) => ({ ...current, projectPath: event.target.value }));
                    }}
                  />
                  <button className="btn icon-btn" onClick={openFolderBrowser} title="Browse folders" type="button">
                    <FolderOpen size={16} aria-hidden="true" />
                  </button>
                </div>
              </div>
              <div className="field">
                <label htmlFor="verify">Verification command</label>
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
                Grant task-level CLI permission
              </label>
              <button className="btn primary" disabled={isSubmitting} type="submit">
                <Play size={16} aria-hidden="true" />
                Create and Queue
              </button>
              {error ? <div className="error-text">{error}</div> : null}
            </form>
            </div>
          </section>
        </aside>

        <section className="detail-grid">
          <div className="summary-band">
            <div className="metric">
              <span>Active</span>
              <strong>{metrics.active}</strong>
            </div>
            <div className="metric">
              <span>Done</span>
              <strong>{metrics.done}</strong>
            </div>
            <div className="metric">
              <span>Blocked</span>
              <strong>{metrics.blocked}</strong>
            </div>
            <div className="metric">
              <span>Convention notes</span>
              <strong>{metrics.notes}</strong>
            </div>
          </div>

          <div className="split">
            <section className="panel">
              <div className="panel-header">
                <div className="panel-title">
                  <ListChecks size={18} aria-hidden="true" />
                  Parallel Tasks
                </div>
              </div>
              <div className="panel-body task-list">
                {tasks.length === 0 ? (
                  <div className="empty">No tasks yet.</div>
                ) : (
                  tasks.map((task) => (
                    <button
                      key={task.id}
                      className={`task-item ${selectedTaskId === task.id ? "selected" : ""}`}
                      onClick={() => setSelectedTaskId(task.id)}
                    >
                      <div className="meta-row">
                        <span className={`pill ${task.status}`}>{statusLabel(task.status)}</span>
                        <span className="pill">Round {task.currentRound}</span>
                      </div>
                      <span className="task-title">{task.title}</span>
                      <span className="task-goal">{shortText(task.goal)}</span>
                      <span className="workspace-path">{task.worktreePath || task.targetProjectPath}</span>
                    </button>
                  ))
                )}
              </div>
            </section>

            <section className="panel">
              <div className="panel-header">
                <div className="panel-title">
                  <Activity size={18} aria-hidden="true" />
                  Task Detail
                </div>
                <button className="btn" onClick={() => void startSelectedTask()} disabled={!selectedTaskId}>
                  <Play size={16} aria-hidden="true" />
                  Run
                </button>
                <button className="btn" onClick={() => void syncSelectedTaskToNotion()} disabled={!selectedTaskId || isSyncingNotion}>
                  <NotebookTabs size={16} aria-hidden="true" />
                  Sync Notion
                </button>
              </div>
              <div className="panel-body">
                {!taskDetail ? (
                  <div className="empty">Select a task to inspect agent output and verifier decisions.</div>
                ) : (
                  <TaskDetailView
                    task={taskDetail}
                    tab={tab}
                    setTab={setTab}
                    notes={notes}
                    noteForm={noteForm}
                    setNoteForm={setNoteForm}
                    submitNote={submitNote}
                    exportConventions={exportConventions}
                    exportPreview={exportPreview}
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
                Settings
              </div>
              <button className="btn" onClick={() => setSettingsOpen(false)}>
                Close
              </button>
            </div>
            <div className="settings-section">
              <div className="section-title">
                <SlidersHorizontal size={18} aria-hidden="true" />
                Agent Settings
              </div>
              <AgentSettingsForm
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
                Notion Sync
              </div>
              <NotionSettingsForm
                notionSettings={notionSettings}
                isSavingNotion={isSavingNotion}
                setNotionSettings={setNotionSettings}
                saveNotionSettings={saveNotionSettings}
              />
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
                Select Target Folder
              </div>
              <button className="btn" onClick={() => setFolderBrowserOpen(false)}>
                Close
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
                  Up
                </button>
                <button
                  className="btn primary"
                  disabled={!folderBrowser?.currentPath}
                  onClick={() => folderBrowser?.currentPath && selectProjectFolder(folderBrowser.currentPath)}
                  type="button"
                >
                  Select This Folder
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
                {isLoadingFolders ? <div className="empty">Loading folders...</div> : null}
                {!isLoadingFolders && folderBrowser?.entries.length === 0 ? (
                  <div className="empty">No child folders.</div>
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
            <div className="model-description">
              {(props.modelCatalog[setting.provider] || []).find((model) => model.id === setting.model)?.description ||
                setting.model}
            </div>
          </div>
        ))}
      </div>
      <button className="btn primary" type="submit" disabled={props.isSavingSettings || props.agentSettings.length === 0}>
        <SlidersHorizontal size={16} aria-hidden="true" />
        Save Settings
      </button>
    </form>
  );
}

function NotionSettingsForm(props: {
  notionSettings: NotionSettings;
  isSavingNotion: boolean;
  setNotionSettings: React.Dispatch<React.SetStateAction<NotionSettings>>;
  saveNotionSettings: (event: FormEvent) => Promise<void>;
}): React.ReactElement {
  return (
    <form className="form-grid" onSubmit={(event) => void props.saveNotionSettings(event)}>
      <div className="notice-line">
        Token: {props.notionSettings.tokenConfigured ? "configured" : "missing NOTION_TOKEN in .env.local"}
      </div>
      <div className="field">
        <label htmlFor="notion-parent">Parent page ID</label>
        <input
          id="notion-parent"
          value={props.notionSettings.parentPageId}
          onChange={(event) =>
            props.setNotionSettings((current) => ({ ...current, parentPageId: event.target.value }))
          }
          placeholder="Notion page ID to create task pages under"
        />
      </div>
      <button
        className="btn primary"
        type="submit"
        disabled={props.isSavingNotion || !props.notionSettings.parentPageId.trim()}
      >
        <NotebookTabs size={16} aria-hidden="true" />
        Save Notion Settings
      </button>
    </form>
  );
}

function TaskDetailView(props: {
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
}): React.ReactElement {
  const tabs: Array<{ id: Tab; label: string; icon: React.ReactElement }> = [
    { id: "agents", label: "Agents", icon: <Database size={15} aria-hidden="true" /> },
    { id: "artifacts", label: "Broker", icon: <ShieldQuestion size={15} aria-hidden="true" /> },
    { id: "shell", label: "Shell", icon: <TerminalSquare size={15} aria-hidden="true" /> },
    { id: "verifications", label: "Verifier", icon: <ClipboardCheck size={15} aria-hidden="true" /> },
    { id: "conventions", label: "Unity Rules", icon: <ScrollText size={15} aria-hidden="true" /> }
  ];

  return (
    <div className="detail-grid">
      <div className="meta-row">
        <span className={`pill ${props.task.status}`}>{statusLabel(props.task.status)}</span>
        <span className="pill">
          <GitBranch size={13} aria-hidden="true" />
          Round {props.task.currentRound}
        </span>
      </div>
      <div>
        <h2 style={{ margin: "0 0 6px", fontSize: 18 }}>{props.task.title}</h2>
        <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.5 }}>{props.task.goal}</p>
      </div>
      {props.task.failureReason ? <div className="error-text">{props.task.failureReason}</div> : null}
      <div className="workspace-path">{props.task.worktreePath || props.task.targetProjectPath}</div>

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

      {props.tab === "agents" ? <AgentRuns runs={props.task.agentRuns} /> : null}
      {props.tab === "artifacts" ? <BrokerArtifacts artifacts={props.task.brokerArtifacts} /> : null}
      {props.tab === "shell" ? <ShellLogs logs={props.task.shellLogs} /> : null}
      {props.tab === "verifications" ? <Verifications verifications={props.task.verifications} /> : null}
      {props.tab === "conventions" ? (
        <ConventionPanel
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

function BrokerArtifacts({ artifacts }: { artifacts: BrokerArtifact[] }): React.ReactElement {
  if (artifacts.length === 0) {
    return <div className="empty">No broker artifacts recorded yet.</div>;
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

function AgentRuns({ runs }: { runs: AgentRun[] }): React.ReactElement {
  if (runs.length === 0) {
    return <div className="empty">No agent runs recorded yet.</div>;
  }
  return (
    <div className="log-stack">
      {runs.map((run) => (
        <div className="log-entry" key={run.id}>
          <header>
            <span>
              {run.role} / {run.provider} / {run.model} / round {run.round}
            </span>
            <span>{run.status}</span>
          </header>
          <div className="run-budget">
            <span>{run.inputChars.toLocaleString()} input chars</span>
            <span>{run.outputChars.toLocaleString()} output chars</span>
            <span>{run.contextBudgetChars.toLocaleString()} context budget</span>
            <span>{Math.round(run.timeBudgetMs / 1000)}s time budget</span>
            {run.wasTrimmed ? <span className="budget-warn">trimmed</span> : null}
            {run.timedOut ? <span className="budget-danger">timed out</span> : null}
          </div>
          <pre>{run.error || run.output || "Running..."}</pre>
        </div>
      ))}
    </div>
  );
}

function ShellLogs({ logs }: { logs: ShellLog[] }): React.ReactElement {
  if (logs.length === 0) {
    return <div className="empty">No shell commands have been run.</div>;
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

function Verifications({ verifications }: { verifications: Verification[] }): React.ReactElement {
  if (verifications.length === 0) {
    return <div className="empty">No verifier decisions yet.</div>;
  }
  return (
    <div className="log-stack">
      {verifications.map((verification) => (
        <div className="log-entry" key={verification.id}>
          <header>
            <span>
              round {verification.round} / {verification.decision}
            </span>
            <span>{verification.exitCode === null ? "no command" : `exit ${verification.exitCode}`}</span>
          </header>
          <pre>{verification.summary}</pre>
        </div>
      ))}
    </div>
  );
}

function ConventionPanel(props: {
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
          <label htmlFor="note-rule">Rule</label>
          <input
            id="note-rule"
            value={props.form.rule}
            onChange={(event) => props.setForm((current) => ({ ...current, rule: event.target.value }))}
            placeholder="Example: Keep gameplay IDs separate from localized display text."
          />
        </div>
        <div className="split">
          <div className="field">
            <label htmlFor="note-category">Category</label>
            <input
              id="note-category"
              value={props.form.category}
              onChange={(event) => props.setForm((current) => ({ ...current, category: event.target.value }))}
            />
          </div>
          <div className="field">
            <label htmlFor="note-confidence">Confidence</label>
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
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
            </select>
          </div>
        </div>
        <div className="field">
          <label htmlFor="note-reason">Reason</label>
          <textarea
            id="note-reason"
            value={props.form.reason}
            onChange={(event) => props.setForm((current) => ({ ...current, reason: event.target.value }))}
          />
        </div>
        <div className="field">
          <label htmlFor="note-examples">Examples</label>
          <textarea
            id="note-examples"
            value={props.form.examples}
            onChange={(event) => props.setForm((current) => ({ ...current, examples: event.target.value }))}
          />
        </div>
        <div className="button-row">
          <button className="btn primary" type="submit" disabled={!props.form.rule.trim()}>
            <Plus size={16} aria-hidden="true" />
            Add Rule
          </button>
          <button className="btn" type="button" onClick={() => void props.exportConventions(false)}>
            <FileDown size={16} aria-hidden="true" />
            Preview Export
          </button>
          <button className="btn warn" type="button" onClick={() => void props.exportConventions(true)}>
            <FileDown size={16} aria-hidden="true" />
            Write AGENTS.md
          </button>
        </div>
      </form>

      <div className="log-stack">
        {props.notes.length === 0 ? (
          <div className="empty">No Unity convention notes for this project.</div>
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
            <span>Export preview</span>
            <span>AGENTS.md + CONVENTIONS.md</span>
          </header>
          <pre>{props.exportPreview}</pre>
        </div>
      ) : null}
    </div>
  );
}
