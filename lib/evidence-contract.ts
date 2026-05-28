export type EvidenceContractStatus = "pass" | "fail" | "unknown";
export type EvidenceConfidence = "low" | "medium" | "high";
export type EvidenceReferenceType = "file" | "command" | "diff" | "test" | "shell_log" | "user_answer" | "artifact";
export type EvidenceContractKind =
  | "evidence_pack"
  | "plan_questions"
  | "plan_answer"
  | "plan_brief"
  | "implementation_brief"
  | "test_brief"
  | "test_result"
  | "final_brief";

export interface EvidenceContractClaim {
  id: string;
  text: string;
  confidence: EvidenceConfidence;
  evidenceIds: string[];
}

export interface EvidenceContractReference {
  id: string;
  type: EvidenceReferenceType;
  reference: string;
  excerpt?: string;
}

export interface EvidenceContractCommand {
  command: string;
  cwd: string;
  exitCode: number | null;
  purpose: string;
}

export interface EvidenceContractCriterion {
  criterion: string;
  status: EvidenceContractStatus;
  evidenceIds: string[];
  notes?: string;
}

export interface EvidenceContract {
  version: "1";
  kind: EvidenceContractKind;
  summary: string;
  claims: EvidenceContractClaim[];
  evidence: EvidenceContractReference[];
  filesTouched?: string[];
  commandsRun?: EvidenceContractCommand[];
  unverifiedAssumptions: string[];
  residualRisks: string[];
  acceptanceCriteriaStatus: EvidenceContractCriterion[];
}

const MAX_EXCERPT_CHARS = 1600;
const MAX_SUMMARY_CHARS = 500;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function trimText(value: string, maxChars: number): string {
  const trimmed = value.trim();
  return trimmed.length <= maxChars ? trimmed : `${trimmed.slice(0, maxChars - 3).trimEnd()}...`;
}

function normalizeConfidence(value: unknown): EvidenceConfidence {
  return value === "high" || value === "medium" || value === "low" ? value : "low";
}

function normalizeStatus(value: unknown): EvidenceContractStatus {
  return value === "pass" || value === "fail" || value === "unknown" ? value : "unknown";
}

function normalizeReferenceType(value: unknown): EvidenceReferenceType {
  const allowed: EvidenceReferenceType[] = ["file", "command", "diff", "test", "shell_log", "user_answer", "artifact"];
  return allowed.includes(value as EvidenceReferenceType) ? (value as EvidenceReferenceType) : "artifact";
}

function normalizeClaim(value: unknown, index: number): EvidenceContractClaim {
  const record = asRecord(value) || {};
  return {
    id: trimText(stringValue(record.id, `claim-${index + 1}`), 80),
    text: trimText(stringValue(record.text, "Unspecified claim."), MAX_EXCERPT_CHARS),
    confidence: normalizeConfidence(record.confidence),
    evidenceIds: stringList(record.evidenceIds)
  };
}

function normalizeEvidence(value: unknown, index: number): EvidenceContractReference {
  const record = asRecord(value) || {};
  const excerpt = stringValue(record.excerpt);
  return {
    id: trimText(stringValue(record.id, `ev-${index + 1}`), 80),
    type: normalizeReferenceType(record.type),
    reference: trimText(stringValue(record.reference, "unspecified"), 260),
    ...(excerpt ? { excerpt: trimText(excerpt, MAX_EXCERPT_CHARS) } : {})
  };
}

function normalizeCommand(value: unknown): EvidenceContractCommand | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  return {
    command: trimText(stringValue(record.command), 500),
    cwd: trimText(stringValue(record.cwd), 500),
    exitCode: typeof record.exitCode === "number" ? record.exitCode : null,
    purpose: trimText(stringValue(record.purpose, "Evidence command."), 260)
  };
}

function normalizeCriterion(value: unknown): EvidenceContractCriterion {
  const record = asRecord(value) || {};
  const notes = stringValue(record.notes);
  return {
    criterion: trimText(stringValue(record.criterion, "Unspecified criterion."), 500),
    status: normalizeStatus(record.status),
    evidenceIds: stringList(record.evidenceIds),
    ...(notes ? { notes: trimText(notes, MAX_EXCERPT_CHARS) } : {})
  };
}

export function normalizeEvidenceContract(value: EvidenceContract): EvidenceContract {
  const evidence = (Array.isArray(value.evidence) ? value.evidence : []).map(normalizeEvidence);
  const evidenceIds = new Set(evidence.map((item) => item.id));
  const claims = (Array.isArray(value.claims) ? value.claims : []).map(normalizeClaim).map((claim) => {
    const linkedEvidenceIds = claim.evidenceIds.filter((id) => evidenceIds.has(id));
    return {
      ...claim,
      evidenceIds: linkedEvidenceIds,
      confidence: linkedEvidenceIds.length > 0 ? claim.confidence : "low"
    };
  });
  return {
    version: "1",
    kind: value.kind,
    summary: trimText(stringValue(value.summary), MAX_SUMMARY_CHARS),
    claims,
    evidence,
    filesTouched: stringList(value.filesTouched).map((item) => trimText(item, 500)),
    commandsRun: (Array.isArray(value.commandsRun) ? value.commandsRun : [])
      .map(normalizeCommand)
      .filter((item): item is EvidenceContractCommand => Boolean(item)),
    unverifiedAssumptions: stringList(value.unverifiedAssumptions).map((item) => trimText(item, MAX_EXCERPT_CHARS)),
    residualRisks: stringList(value.residualRisks).map((item) => trimText(item, MAX_EXCERPT_CHARS)),
    acceptanceCriteriaStatus: (Array.isArray(value.acceptanceCriteriaStatus) ? value.acceptanceCriteriaStatus : []).map(
      normalizeCriterion
    )
  };
}

export function parseEvidenceContractJson(value: unknown): EvidenceContract | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as EvidenceContract;
    if (parsed?.version !== "1" || !parsed.kind) {
      return null;
    }
    return normalizeEvidenceContract(parsed);
  } catch {
    return null;
  }
}

export function serializeEvidenceContract(contract?: EvidenceContract | null): string | null {
  return contract ? JSON.stringify(normalizeEvidenceContract(contract)) : null;
}

export function summarizeText(text: string, fallback = "No summary provided."): string {
  const firstUseful = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return trimText(firstUseful || fallback, MAX_SUMMARY_CHARS);
}

export function createEvidenceContract(input: {
  kind: EvidenceContractKind;
  summary: string;
  claims?: EvidenceContractClaim[];
  evidence?: EvidenceContractReference[];
  filesTouched?: string[];
  commandsRun?: EvidenceContractCommand[];
  unverifiedAssumptions?: string[];
  residualRisks?: string[];
  acceptanceCriteriaStatus?: EvidenceContractCriterion[];
}): EvidenceContract {
  return normalizeEvidenceContract({
    version: "1",
    kind: input.kind,
    summary: input.summary,
    claims: input.claims || [],
    evidence: input.evidence || [],
    filesTouched: input.filesTouched || [],
    commandsRun: input.commandsRun || [],
    unverifiedAssumptions: input.unverifiedAssumptions || [],
    residualRisks: input.residualRisks || [],
    acceptanceCriteriaStatus: input.acceptanceCriteriaStatus || []
  });
}

export function contractHasFailedCriteria(contract?: EvidenceContract | null): boolean {
  return Boolean(contract?.acceptanceCriteriaStatus.some((criterion) => criterion.status === "fail"));
}

export function formatEvidenceContract(contract: EvidenceContract): string {
  return [
    `Summary: ${contract.summary}`,
    "",
    "Contract JSON:",
    "```json",
    JSON.stringify(normalizeEvidenceContract(contract), null, 2),
    "```"
  ].join("\n");
}

export function formatBrokerArtifactForHandoff(artifact: { content: string; contract?: EvidenceContract | null }): string {
  return artifact.contract ? formatEvidenceContract(artifact.contract) : artifact.content;
}

export function formatEvidenceContractMarkdown(contract: EvidenceContract): string {
  const sections: string[] = [`Summary: ${contract.summary}`];
  if (contract.claims.length > 0) {
    sections.push(
      "#### Claims",
      ...contract.claims.map(
        (claim) =>
          `- ${claim.id} [${claim.confidence}]: ${claim.text}${
            claim.evidenceIds.length > 0 ? ` (evidence: ${claim.evidenceIds.join(", ")})` : ""
          }`
      )
    );
  }
  if (contract.evidence.length > 0) {
    sections.push(
      "#### Evidence",
      ...contract.evidence.map((evidence) =>
        [`- ${evidence.id} [${evidence.type}]: ${evidence.reference}`, evidence.excerpt ? `  ${evidence.excerpt}` : ""]
          .filter(Boolean)
          .join("\n")
      )
    );
  }
  if (contract.filesTouched && contract.filesTouched.length > 0) {
    sections.push("#### Files Touched", ...contract.filesTouched.map((file) => `- ${file}`));
  }
  if (contract.commandsRun && contract.commandsRun.length > 0) {
    sections.push(
      "#### Commands",
      ...contract.commandsRun.map((command) => `- ${command.command} (exit: ${command.exitCode ?? "n/a"}) - ${command.purpose}`)
    );
  }
  if (contract.acceptanceCriteriaStatus.length > 0) {
    sections.push(
      "#### Acceptance Criteria",
      ...contract.acceptanceCriteriaStatus.map(
        (criterion) =>
          `- [${criterion.status}] ${criterion.criterion}${
            criterion.evidenceIds.length > 0 ? ` (evidence: ${criterion.evidenceIds.join(", ")})` : ""
          }${criterion.notes ? ` - ${criterion.notes}` : ""}`
      )
    );
  }
  if (contract.unverifiedAssumptions.length > 0) {
    sections.push("#### Unverified Assumptions", ...contract.unverifiedAssumptions.map((item) => `- ${item}`));
  }
  if (contract.residualRisks.length > 0) {
    sections.push("#### Residual Risks", ...contract.residualRisks.map((item) => `- ${item}`));
  }
  return sections.join("\n");
}
