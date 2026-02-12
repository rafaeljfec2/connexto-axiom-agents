import crypto from "node:crypto";
import type BetterSqlite3 from "better-sqlite3";
import { logger } from "../../config/logger.js";
import { generateStubMetrics } from "../../services/metricsCollector.js";
import { getArtifactById, updateArtifactStatus } from "../../state/artifacts.js";
import { savePublication } from "../../state/publications.js";

export interface PublishResult {
  readonly success: boolean;
  readonly message: string;
  readonly publicationId?: string;
  readonly externalId?: string;
}

const ALLOWED_CHANNELS = new Set(["stub"]);

export function publishArtifact(
  db: BetterSqlite3.Database,
  artifactId: string,
  channel: string = "stub",
): PublishResult {
  const artifact = getArtifactById(db, artifactId);

  if (!artifact) {
    return { success: false, message: `Artifact ${artifactId} nao encontrado.` };
  }

  if (artifact.status !== "approved") {
    return {
      success: false,
      message: `Artifact ${artifactId} nao esta aprovado (status atual: ${artifact.status}). Use /approve primeiro.`,
    };
  }

  if (!ALLOWED_CHANNELS.has(channel)) {
    return {
      success: false,
      message: `Canal "${channel}" nao permitido. Canais disponiveis: ${[...ALLOWED_CHANNELS].join(", ")}.`,
    };
  }

  const stubResult = publishViaStub(artifact.title);

  const publicationId = savePublication(db, {
    artifactId,
    channel: "stub",
    status: "published",
    externalId: stubResult.externalId,
  });

  updateArtifactStatus(db, artifactId, "published");

  generateStubMetrics(db, artifactId, channel);

  logger.info(
    { artifactId, publicationId, channel, externalId: stubResult.externalId },
    "Artifact published via stub",
  );

  return {
    success: true,
    message: `"${artifact.title}" publicado com sucesso (stub). ID externo: ${stubResult.externalId}`,
    publicationId,
    externalId: stubResult.externalId,
  };
}

interface StubPublishResult {
  readonly externalId: string;
}

function publishViaStub(title: string): StubPublishResult {
  const externalId = `stub-${crypto.randomUUID().slice(0, 8)}`;

  logger.info({ title, externalId }, "STUB: Simulated publication (no external API called)");

  return { externalId };
}
