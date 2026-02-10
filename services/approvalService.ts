import type BetterSqlite3 from "better-sqlite3";
import { logger } from "../config/logger.js";
import {
  getArtifactById,
  getAllPendingDrafts,
  updateArtifactStatus,
  type Artifact,
} from "../state/artifacts.js";

export interface ApprovalResult {
  readonly success: boolean;
  readonly message: string;
  readonly artifact?: Artifact;
}

export function listPendingDrafts(db: BetterSqlite3.Database): readonly Artifact[] {
  return getAllPendingDrafts(db);
}

export function approveDraft(
  db: BetterSqlite3.Database,
  artifactId: string,
  approvedBy: string,
): ApprovalResult {
  const artifact = getArtifactById(db, artifactId);

  if (!artifact) {
    return { success: false, message: `Artifact ${artifactId} nao encontrado.` };
  }

  if (artifact.status !== "draft") {
    return {
      success: false,
      message: `Artifact ${artifactId} nao e um draft (status atual: ${artifact.status}).`,
    };
  }

  updateArtifactStatus(db, artifactId, "approved", approvedBy);

  logger.info({ artifactId, approvedBy }, "Draft approved");

  const updated = getArtifactById(db, artifactId);
  return {
    success: true,
    message: `Draft "${artifact.title}" aprovado com sucesso.`,
    artifact: updated,
  };
}

export function rejectDraft(
  db: BetterSqlite3.Database,
  artifactId: string,
  rejectedBy: string,
): ApprovalResult {
  const artifact = getArtifactById(db, artifactId);

  if (!artifact) {
    return { success: false, message: `Artifact ${artifactId} nao encontrado.` };
  }

  if (artifact.status !== "draft") {
    return {
      success: false,
      message: `Artifact ${artifactId} nao e um draft (status atual: ${artifact.status}).`,
    };
  }

  updateArtifactStatus(db, artifactId, "rejected", rejectedBy);

  logger.info({ artifactId, rejectedBy }, "Draft rejected");

  const updated = getArtifactById(db, artifactId);
  return {
    success: true,
    message: `Draft "${artifact.title}" rejeitado.`,
    artifact: updated,
  };
}
