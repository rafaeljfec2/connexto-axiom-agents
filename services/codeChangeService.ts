import type BetterSqlite3 from "better-sqlite3";
import { logger } from "../config/logger.js";
import { applyCodeChange } from "../execution/codeApplier.js";
import type { FileChange } from "../execution/codeApplier.js";
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

  const files = reconstructFilesFromChange(change);

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

  const result = await applyCodeChange(db, changeId, files);

  if (result.success) {
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

export function rejectCodeChange(
  db: BetterSqlite3.Database,
  changeId: string,
  rejectedBy: string,
): CodeChangeActionResult {
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

  updateCodeChangeStatus(db, changeId, { status: "rejected" });

  logger.info({ changeId, rejectedBy }, "Code change rejected");

  return {
    success: true,
    message: `Mudanca ${changeId.slice(0, 8)} rejeitada.`,
  };
}

function reconstructFilesFromChange(change: CodeChange): readonly FileChange[] | null {
  try {
    if (change.diff) {
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
    }

    logger.warn(
      { changeId: change.id },
      "No diff available; code change files cannot be reconstructed from stored data alone",
    );
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ changeId: change.id, error: message }, "Failed to reconstruct files from diff");
    return null;
  }
}
