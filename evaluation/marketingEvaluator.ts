export type MarketingGrade = "STRONG" | "AVERAGE" | "WEAK";

const STRONG_THRESHOLD = 70;
const AVERAGE_THRESHOLD = 30;

export function evaluateMarketingPerformance(engagementScore: number): MarketingGrade {
  if (engagementScore >= STRONG_THRESHOLD) {
    return "STRONG";
  }

  if (engagementScore >= AVERAGE_THRESHOLD) {
    return "AVERAGE";
  }

  return "WEAK";
}
