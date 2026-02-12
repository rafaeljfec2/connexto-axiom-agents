import type BetterSqlite3 from "better-sqlite3";
import { logger } from "../config/logger.js";
import {
  getPullRequest,
  getPullRequestDetails,
  getCheckRunsStatus,
} from "../execution/shared/githubClient.js";
import type { PRDetails, CheckRunsStatus } from "../execution/shared/githubClient.js";
import { sendTelegramMessage } from "../interfaces/telegram.js";
import {
  getPullRequestById,
  getOpenPRs,
  updatePullRequestStatus,
  updateMergeStatus,
} from "../state/pullRequests.js";
import type { PullRequest } from "../state/pullRequests.js";

const DEFAULT_MERGE_MAX_RISK = 3;

export interface MergeReadinessResult {
  readonly success: boolean;
  readonly message: string;
  readonly mergeStatus: "ready" | "blocked" | "confirmed";
}

export interface MergeReport {
  readonly summary: string;
  readonly impact: {
    readonly changedFiles: number;
    readonly additions: number;
    readonly deletions: number;
  };
  readonly risks: readonly string[];
  readonly checks: {
    readonly totalCount: number;
    readonly passed: number;
    readonly failed: number;
    readonly pending: number;
    readonly allPassed: boolean;
  };
  readonly mergeable: boolean | null;
  readonly mergeableState: string;
  readonly rollbackCommand: string;
  readonly checklist: ReadonlyArray<{
    readonly passed: boolean;
    readonly description: string;
  }>;
}

function getMergeMaxRisk(): number {
  const envValue = process.env.MERGE_MAX_RISK;
  if (!envValue) return DEFAULT_MERGE_MAX_RISK;
  const parsed = Number.parseInt(envValue, 10);
  return Number.isNaN(parsed) ? DEFAULT_MERGE_MAX_RISK : parsed;
}

export async function checkMergeReadiness(
  db: BetterSqlite3.Database,
  prId: string,
): Promise<MergeReadinessResult> {
  const pr = getPullRequestById(db, prId);

  if (!pr) {
    return { success: false, message: `PR "${prId}" nao encontrado.`, mergeStatus: "blocked" };
  }

  if (pr.status !== "open") {
    return {
      success: false,
      message: `PR nao esta aberto (status: ${pr.status}).`,
      mergeStatus: "blocked",
    };
  }

  if (!pr.pr_number) {
    return {
      success: false,
      message: `PR nao possui numero do GitHub associado.`,
      mergeStatus: "blocked",
    };
  }

  let ghDetails: PRDetails;
  let checks: CheckRunsStatus;

  try {
    ghDetails = await getPullRequestDetails(pr.pr_number);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ prId, error: msg }, "Failed to fetch PR details from GitHub");
    return {
      success: false,
      message: `Erro ao buscar detalhes do PR: ${msg}`,
      mergeStatus: "blocked",
    };
  }

  try {
    checks = await getCheckRunsStatus(ghDetails.head_sha);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn({ prId, error: msg }, "Failed to fetch check runs, proceeding without CI data");
    checks = { totalCount: 0, passed: 0, failed: 0, pending: 0, allPassed: true };
  }

  if (ghDetails.merged) {
    updatePullRequestStatus(db, prId, { status: "merged" });
    return {
      success: true,
      message: `PR #${pr.pr_number} ja foi mergeado no GitHub. Status atualizado.`,
      mergeStatus: "ready",
    };
  }

  if (ghDetails.state === "closed") {
    updatePullRequestStatus(db, prId, { status: "closed" });
    return {
      success: false,
      message: `PR #${pr.pr_number} esta fechado no GitHub. Status atualizado.`,
      mergeStatus: "blocked",
    };
  }

  const report = generateMergeReport(pr, ghDetails, checks);
  const reportJson = JSON.stringify(report);

  const allChecksPassed = checks.allPassed || checks.totalCount === 0;
  const isMergeable = ghDetails.mergeable === true;
  const conditionsOk = allChecksPassed && isMergeable;

  const mergeMaxRisk = getMergeMaxRisk();

  if (!conditionsOk) {
    updateMergeStatus(db, prId, { mergeStatus: "blocked", mergeReport: reportJson });

    const blockReasons = buildBlockReasons(ghDetails, checks);
    const message = formatBlockedMessage(pr, blockReasons);
    await sendTelegramMessage(message);

    logger.info({ prId, blockReasons }, "PR merge blocked - conditions not met");
    return {
      success: true,
      message: `PR bloqueado para merge: ${blockReasons.join(", ")}`,
      mergeStatus: "blocked",
    };
  }

  if (pr.risk >= mergeMaxRisk) {
    updateMergeStatus(db, prId, { mergeStatus: "blocked", mergeReport: reportJson });

    const message = formatHighRiskMessage(pr, report, mergeMaxRisk);
    await sendTelegramMessage(message);

    logger.info(
      { prId, risk: pr.risk, mergeMaxRisk },
      "PR merge requires human confirmation (high risk)",
    );
    return {
      success: true,
      message: `PR requer confirmacao (risco ${pr.risk} >= limite ${mergeMaxRisk}). Use /confirm_merge.`,
      mergeStatus: "blocked",
    };
  }

  updateMergeStatus(db, prId, { mergeStatus: "ready", mergeReport: reportJson });

  const message = formatReadyMessage(pr, report);
  await sendTelegramMessage(message);

  logger.info({ prId, prNumber: pr.pr_number }, "PR is ready for merge");
  return {
    success: true,
    message: `PR #${pr.pr_number} pronto para merge.`,
    mergeStatus: "ready",
  };
}

export async function confirmMerge(
  db: BetterSqlite3.Database,
  prId: string,
  confirmedBy: string,
): Promise<{ readonly success: boolean; readonly message: string }> {
  const pr = getPullRequestById(db, prId);

  if (!pr) {
    return { success: false, message: `PR "${prId}" nao encontrado.` };
  }

  if (pr.status !== "open") {
    return { success: false, message: `PR nao esta aberto (status: ${pr.status}).` };
  }

  const mergeMaxRisk = getMergeMaxRisk();
  if (pr.risk < mergeMaxRisk) {
    return {
      success: false,
      message: `PR nao requer confirmacao (risco ${pr.risk} < limite ${mergeMaxRisk}).`,
    };
  }

  if (pr.merge_status !== "blocked" && pr.merge_status !== "ready") {
    return {
      success: false,
      message: `PR nao esta em estado valido para confirmacao (merge_status: ${pr.merge_status ?? "null"}).`,
    };
  }

  updateMergeStatus(db, prId, { mergeStatus: "confirmed" });

  const prUrl = pr.pr_url ?? `PR #${pr.pr_number}`;
  const message = [
    `Merge confirmado por ${confirmedBy}`,
    `PR: ${prUrl}`,
    `Branch: ${pr.branch_name}`,
    `Risco: ${pr.risk}/5`,
    ``,
    `Faca o merge manualmente no GitHub.`,
  ].join("\n");

  await sendTelegramMessage(message);

  logger.info({ prId, confirmedBy }, "PR merge confirmed by human");
  return { success: true, message: `PR ${prId.slice(0, 8)} confirmado para merge.` };
}

export async function markPRMerged(
  db: BetterSqlite3.Database,
  prId: string,
): Promise<{ readonly success: boolean; readonly message: string }> {
  const pr = getPullRequestById(db, prId);

  if (!pr) {
    return { success: false, message: `PR "${prId}" nao encontrado.` };
  }

  if (pr.status === "merged") {
    return { success: false, message: `PR ja esta marcado como merged.` };
  }

  if (pr.status !== "open") {
    return { success: false, message: `PR nao esta aberto (status: ${pr.status}).` };
  }

  if (pr.pr_number) {
    try {
      const ghPR = await getPullRequest(pr.pr_number);
      if (!ghPR.merged) {
        return {
          success: false,
          message: `PR #${pr.pr_number} ainda nao foi mergeado no GitHub.`,
        };
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn(
        { prId, error: msg },
        "Could not verify merge status on GitHub, marking as merged anyway",
      );
    }
  }

  updatePullRequestStatus(db, prId, { status: "merged" });

  const prUrl = pr.pr_url ?? `PR #${pr.pr_number}`;
  await sendTelegramMessage(`PR mergeado: ${prUrl}\nBranch: ${pr.branch_name}`);

  logger.info({ prId, prNumber: pr.pr_number }, "PR marked as merged");
  return { success: true, message: `PR ${prId.slice(0, 8)} marcado como mergeado.` };
}

export async function syncOpenPRsStatus(db: BetterSqlite3.Database): Promise<number> {
  const openPRs = getOpenPRs(db);
  let syncCount = 0;

  for (const pr of openPRs) {
    if (!pr.pr_number) continue;

    try {
      const ghPR = await getPullRequest(pr.pr_number);

      if (ghPR.merged) {
        updatePullRequestStatus(db, pr.id, { status: "merged" });
        logger.info({ prId: pr.id, prNumber: pr.pr_number }, "PR synced: merged on GitHub");
        syncCount++;
      } else if (ghPR.state === "closed") {
        updatePullRequestStatus(db, pr.id, { status: "closed" });
        logger.info({ prId: pr.id, prNumber: pr.pr_number }, "PR synced: closed on GitHub");
        syncCount++;
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn(
        { prId: pr.id, prNumber: pr.pr_number, error: msg },
        "Failed to sync PR status from GitHub",
      );
    }
  }

  if (syncCount > 0) {
    logger.info({ syncCount }, "PR status sync completed");
  }

  return syncCount;
}

function generateMergeReport(
  pr: PullRequest,
  ghDetails: PRDetails,
  checks: CheckRunsStatus,
): MergeReport {
  const risks: string[] = [];

  if (pr.risk >= 3) {
    risks.push(`Risco alto (${pr.risk}/5)`);
  }
  if (checks.failed > 0) {
    risks.push(`${checks.failed} check(s) falharam`);
  }
  if (checks.pending > 0) {
    risks.push(`${checks.pending} check(s) pendente(s)`);
  }
  if (ghDetails.mergeable === false) {
    risks.push("Conflitos detectados");
  }
  if (ghDetails.mergeable === null) {
    risks.push("Status de merge indeterminado (GitHub ainda processando)");
  }

  const checklist = [
    { passed: checks.allPassed || checks.totalCount === 0, description: "CI checks passaram" },
    { passed: ghDetails.mergeable === true, description: "Sem conflitos" },
    { passed: ghDetails.mergeable_state === "clean", description: "Branch limpa (clean)" },
    { passed: pr.risk < 3, description: "Risco aceitavel (< 3)" },
  ];

  return {
    summary: `${pr.title} — ${ghDetails.changed_files} arquivo(s), +${ghDetails.additions}/-${ghDetails.deletions}`,
    impact: {
      changedFiles: ghDetails.changed_files,
      additions: ghDetails.additions,
      deletions: ghDetails.deletions,
    },
    risks,
    checks: {
      totalCount: checks.totalCount,
      passed: checks.passed,
      failed: checks.failed,
      pending: checks.pending,
      allPassed: checks.allPassed,
    },
    mergeable: ghDetails.mergeable,
    mergeableState: ghDetails.mergeable_state,
    rollbackCommand: `git revert <merge_commit_hash>`,
    checklist,
  };
}

function buildBlockReasons(ghDetails: PRDetails, checks: CheckRunsStatus): readonly string[] {
  const reasons: string[] = [];

  if (checks.failed > 0) {
    reasons.push(`${checks.failed} CI check(s) falharam`);
  }
  if (checks.pending > 0) {
    reasons.push(`${checks.pending} CI check(s) pendente(s)`);
  }
  if (ghDetails.mergeable === false) {
    reasons.push("Conflitos com main");
  }
  if (ghDetails.mergeable === null) {
    reasons.push("GitHub ainda processando mergeability");
  }

  return reasons.length > 0 ? reasons : ["Condicoes de merge nao atendidas"];
}

function formatBlockedMessage(pr: PullRequest, reasons: readonly string[]): string {
  const prRef = pr.pr_url ?? `PR #${pr.pr_number}`;
  return [
    `*PR Bloqueado para Merge*`,
    `${prRef}`,
    `Branch: ${pr.branch_name}`,
    `Risco: ${pr.risk}/5`,
    ``,
    `Motivos:`,
    ...reasons.map((r) => `- ${r}`),
    ``,
    `Corrija os problemas e use /merge_check ${pr.id.slice(0, 8)} novamente.`,
  ].join("\n");
}

function formatHighRiskMessage(pr: PullRequest, report: MergeReport, mergeMaxRisk: number): string {
  const prRef = pr.pr_url ?? `PR #${pr.pr_number}`;
  const checklistLines = report.checklist.map(
    (item) => `${item.passed ? "[x]" : "[ ]"} ${item.description}`,
  );

  return [
    `*PR Requer Confirmacao (Alto Risco)*`,
    `${prRef}`,
    `Branch: ${pr.branch_name}`,
    `Risco: ${pr.risk}/5 (limite: ${mergeMaxRisk})`,
    ``,
    `Resumo: ${report.summary}`,
    ``,
    `Checklist:`,
    ...checklistLines,
    ``,
    `Rollback: ${report.rollbackCommand}`,
    ``,
    `Use /confirm_merge ${pr.id.slice(0, 8)} para confirmar.`,
    `Use /reject_pr ${pr.id.slice(0, 8)} para cancelar.`,
  ].join("\n");
}

function formatReadyMessage(pr: PullRequest, report: MergeReport): string {
  const prRef = pr.pr_url ?? `PR #${pr.pr_number}`;
  const checklistLines = report.checklist.map(
    (item) => `${item.passed ? "[x]" : "[ ]"} ${item.description}`,
  );

  return [
    `*PR Pronto para Merge*`,
    `${prRef}`,
    `Branch: ${pr.branch_name}`,
    `Risco: ${pr.risk}/5`,
    ``,
    `Resumo: ${report.summary}`,
    ``,
    `Checklist:`,
    ...checklistLines,
    ``,
    `Rollback: ${report.rollbackCommand}`,
    ``,
    `Faca o merge manualmente no GitHub.`,
    `Apos o merge, use /mark_merged ${pr.id.slice(0, 8)}.`,
  ].join("\n");
}
