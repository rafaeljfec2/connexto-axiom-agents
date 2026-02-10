import type { RiskProfile } from "../../projects/manifest.schema.js";

export interface ProjectLimits {
  readonly maxRiskLevel: number;
  readonly maxFilesPerChange: number;
  readonly approvalRequiredAboveRisk: number;
}

const LIMITS_BY_PROFILE: Readonly<Record<RiskProfile, ProjectLimits>> = {
  low: {
    maxRiskLevel: 2,
    maxFilesPerChange: 5,
    approvalRequiredAboveRisk: 3,
  },
  medium: {
    maxRiskLevel: 3,
    maxFilesPerChange: 3,
    approvalRequiredAboveRisk: 3,
  },
  high: {
    maxRiskLevel: 4,
    maxFilesPerChange: 2,
    approvalRequiredAboveRisk: 2,
  },
};

export function getProjectLimits(riskProfile: RiskProfile): ProjectLimits {
  return LIMITS_BY_PROFILE[riskProfile];
}
