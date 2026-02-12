import type BetterSqlite3 from "better-sqlite3";
import { logger } from "../config/logger.js";
import { applyCodeChangeWithBranch } from "../execution/shared/codeApplier.js";
import type { FileChange } from "../execution/shared/codeApplier.js";
import { isGitHubConfigured } from "../execution/shared/githubClient.js";
import { deleteBranch } from "../execution/shared/gitManager.js";
import { createPRForCodeChange } from "./pullRequestService.js";
import {
  getCodeChangeById,
  getPendingApprovalChanges,
  updateCodeChangeStatus,
} from "../state/codeChanges.js";
import type { CodeChange } from "../state/codeChanges.js";

export interface CodeChangeActionResult {
  readonly success: boolean;
  readonly message: string;
}

export function listPendingCodeChanges(db: BetterSqlite3.Database): readonly CodeChange[] {
  return getPendingApprovalChanges(db);
}

export async function approveCodeChange(
  db: BetterSqlite3.Database,
  changeId: string,
  approvedBy: string,
): Promise<CodeChangeActionResult> {
  const change = getCodeChangeById(db, changeId);

  if (!change) {
    return { success: false, message: `Mudanca com ID "${changeId}" nao encontrada.` };
  }

  if (change.status !== "pending_approval") {
    return {
      success: false,
      message: `Mudanca nao esta aguardando aprovacao (status atual: ${change.status}).`,
    };
  }

  updateCodeChangeStatus(db, changeId, {
    status: "approved",
    approvedBy,
  });

  logger.info({ changeId, approvedBy }, "Code change approved, applying...");

  const files = reconstructFilesFromPendingFiles(change);

  if (!files) {
    updateCodeChangeStatus(db, changeId, {
      status: "failed",
      error: "Could not reconstruct files from stored change data",
    });
    return {
      success: false,
      message: "Erro ao reconstruir arquivos da mudanca. Status: failed.",
    };
  }

  const result = await applyCodeChangeWithBranch(db, changeId, files);

  if (result.success) {
    if (isGitHubConfigured()) {
      try {
        const prResult = await createPRForCodeChange(db, changeId);
        logger.info({ changeId, prResult: prResult.message }, "PR flow triggered after approve");
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error({ changeId, error: msg }, "Failed to trigger PR after approve");
      }
    }

    return {
      success: true,
      message: `Mudanca ${changeId.slice(0, 8)} aprovada e aplicada com sucesso.`,
    };
  }

  return {
    success: false,
    message: `Mudanca aprovada mas falhou ao aplicar: ${result.error}`,
  };
}

export async function rejectCodeChange(
  db: BetterSqlite3.Database,
  changeId: string,
  rejectedBy: string,
): Promise<CodeChangeActionResult> {
  const change = getCodeChangeById(db, changeId);

  if (!change) {
    return { success: false, message: `Mudanca com ID "${changeId}" nao encontrada.` };
  }

  if (change.status !== "pending_approval") {
    return {
      success: false,
      message: `Mudanca nao esta aguardando aprovacao (status atual: ${change.status}).`,
    };
  }

  if (change.branch_name) {
    try {
      await deleteBranch(change.branch_name);
      logger.info({ changeId, branchName: change.branch_name }, "Branch deleted on rejection");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn({ changeId, error: message }, "Failed to delete branch on rejection");
    }
  }

  updateCodeChangeStatus(db, changeId, { status: "rejected" });

  logger.info({ changeId, rejectedBy }, "Code change rejected");

  return {
    success: true,
    message: `Mudanca ${changeId.slice(0, 8)} rejeitada.`,
  };
}

function reconstructFilesFromPendingFiles(change: CodeChange): readonly FileChange[] | null {
  if (change.pending_files) {
    try {
      const files = JSON.parse(change.pending_files) as ReadonlyArray<{
        readonly path: string;
        readonly action: string;
        readonly content: string;
      }>;
      return files.map((entry) => ({
        path: entry.path,
        action: entry.action as "create" | "modify",
        content: entry.content,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ changeId: change.id, error: message }, "Failed to parse pending_files JSON");
    }
  }

  if (change.diff) {
    try {
      const diffEntries = JSON.parse(change.diff) as ReadonlyArray<{
        readonly path: string;
        readonly action: string;
        readonly after: string;
      }>;
      return diffEntries.map((entry) => ({
        path: entry.path,
        action: entry.action as "create" | "modify",
        content: entry.after,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(
        { changeId: change.id, error: message },
        "Failed to reconstruct files from diff",
      );
    }
  }

  logger.warn(
    { changeId: change.id },
    "No pending_files or diff available; files cannot be reconstructed",
  );
  return null;
}
