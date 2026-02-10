import type BetterSqlite3 from "better-sqlite3";
import { logger } from "../config/logger.js";
import { evaluateMarketingPerformance } from "../evaluation/marketingEvaluator.js";
import { getArtifactById } from "../state/artifacts.js";
import { saveMarketingFeedback } from "../state/marketingFeedback.js";
import { saveMarketingMetrics } from "../state/marketingMetrics.js";

const STUB_IMPRESSIONS_MIN = 50;
const STUB_IMPRESSIONS_MAX = 500;
const STUB_CLICKS_MIN = 5;
const STUB_CLICKS_MAX = 50;
const STUB_ENGAGEMENT_MAX = 100;

export interface MetricsCollectionResult {
  readonly success: boolean;
  readonly message: string;
  readonly grade?: string;
}

export function generateStubMetrics(
  db: BetterSqlite3.Database,
  artifactId: string,
  channel: string,
): MetricsCollectionResult {
  const artifact = getArtifactById(db, artifactId);
  if (!artifact) {
    return { success: false, message: `Artifact ${artifactId} nao encontrado.` };
  }

  const impressions = randomInt(STUB_IMPRESSIONS_MIN, STUB_IMPRESSIONS_MAX);
  const clicks = randomInt(STUB_CLICKS_MIN, STUB_CLICKS_MAX);
  const engagementScore = Math.round(Math.random() * STUB_ENGAGEMENT_MAX * 10) / 10;

  saveMarketingMetrics(db, {
    artifactId,
    channel,
    impressions,
    clicks,
    engagementScore,
    source: "stub",
  });

  const grade = evaluateMarketingPerformance(engagementScore);

  saveMarketingFeedback(db, {
    artifactId,
    messageType: artifact.type,
    grade,
    engagementScore,
  });

  logger.info(
    { artifactId, channel, impressions, clicks, engagementScore, grade },
    "Stub marketing metrics generated and evaluated",
  );

  return {
    success: true,
    message: `Metricas stub geradas: ${impressions} impressoes, ${clicks} cliques, engagement ${engagementScore} (${grade})`,
    grade,
  };
}

export function saveManualMetrics(
  db: BetterSqlite3.Database,
  artifactId: string,
  impressions: number,
  clicks: number,
  engagementScore: number,
): MetricsCollectionResult {
  const artifact = getArtifactById(db, artifactId);
  if (!artifact) {
    return { success: false, message: `Artifact ${artifactId} nao encontrado.` };
  }

  if (artifact.status !== "published") {
    return {
      success: false,
      message: `Artifact ${artifactId} nao esta publicado (status: ${artifact.status}).`,
    };
  }

  saveMarketingMetrics(db, {
    artifactId,
    channel: "manual",
    impressions,
    clicks,
    engagementScore,
    source: "manual",
  });

  const grade = evaluateMarketingPerformance(engagementScore);

  saveMarketingFeedback(db, {
    artifactId,
    messageType: artifact.type,
    grade,
    engagementScore,
  });

  logger.info(
    { artifactId, impressions, clicks, engagementScore, grade },
    "Manual marketing metrics saved and evaluated",
  );

  return {
    success: true,
    message: `Metricas manuais salvas: ${impressions} impressoes, ${clicks} cliques, engagement ${engagementScore} (${grade})`,
    grade,
  };
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
