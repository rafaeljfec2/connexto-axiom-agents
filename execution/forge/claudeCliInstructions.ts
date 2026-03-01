import { classifyTaskType } from "./openclawInstructions.js";
import type { ForgeTaskType } from "./openclawInstructions.js";
import type { TaskComplexity, ExecutionPhase } from "./claudeCliTypes.js";
import type { NexusResearchContext, GoalContext } from "./forgeTypes.js";
import {
  buildIdentitySection,
  buildPlanningIdentitySection,
  buildTestingIdentitySection,
  buildDecisionProtocolSection,
  buildComplexityHintSection,
  buildTaskContextSection,
  buildGoalSection,
  buildNexusSection,
  buildRepositorySection,
  buildWorkflowSection,
  buildPlanningWorkflowSection,
  buildTestingWorkflowSection,
  buildCorrectionWorkflowSection,
  buildProjectInstructionsSection,
  buildReferenceExamplesSection,
} from "./forgeInstructionSections.js";
import {
  buildQualityRulesSection,
  buildSecurityRulesSection,
  buildTestingRulesSection,
  buildDependencyRulesSection,
  buildArchitectureRulesSection,
  buildFrontendRulesSection,
} from "./forgeInstructionRules.js";

export interface ClaudeCliInstructionsContext {
  readonly task: string;
  readonly expectedOutput: string;
  readonly language: string;
  readonly framework: string;
  readonly projectId: string;
  readonly nexusResearch?: readonly NexusResearchContext[];
  readonly goalContext?: GoalContext;
  readonly repositoryIndexSummary?: string;
  readonly baselineBuildFailed: boolean;
  readonly projectInstructions?: string;
  readonly referenceExamples?: string;
  readonly complexity?: TaskComplexity;
  readonly executionPhase?: ExecutionPhase;
}

export function buildClaudeMdContent(ctx: ClaudeCliInstructionsContext): string {
  const taskType = classifyTaskType(ctx.task);
  const phase = ctx.executionPhase ?? "implementation";

  if (phase === "planning") return buildPlanningPhaseMd(ctx, taskType);
  if (phase === "testing") return buildTestingPhaseMd(ctx, taskType);
  if (phase === "correction") return buildCorrectionPhaseMd(ctx, taskType);

  return buildImplementationPhaseMd(ctx, taskType);
}

function buildCorrectionPhaseMd(ctx: ClaudeCliInstructionsContext, taskType: ForgeTaskType): string {
  const sections: string[] = [
    buildIdentitySection(),
    buildDecisionProtocolSection(taskType),
    buildTaskContextSection(ctx),
    buildCorrectionWorkflowSection(ctx.baselineBuildFailed),
    buildQualityRulesSection(),
    buildSecurityRulesSection(),
  ];
  return sections.filter(Boolean).join("\n\n");
}

function buildPlanningPhaseMd(ctx: ClaudeCliInstructionsContext, taskType: ForgeTaskType): string {
  const sections: string[] = [
    buildPlanningIdentitySection(),
    buildTaskContextSection(ctx),
    buildGoalSection(ctx.goalContext),
    buildNexusSection(ctx.nexusResearch),
    buildRepositorySection(ctx.repositoryIndexSummary, taskType),
    buildReferenceExamplesSection(ctx.referenceExamples),
    buildPlanningWorkflowSection(),
    buildArchitectureRulesSection(),
    buildProjectInstructionsSection(ctx.projectInstructions),
    buildSecurityRulesSection(),
  ];
  return sections.filter(Boolean).join("\n\n");
}

function buildTestingPhaseMd(ctx: ClaudeCliInstructionsContext, _taskType: ForgeTaskType): string {
  const sections: string[] = [
    buildTestingIdentitySection(),
    buildTaskContextSection(ctx),
    buildReferenceExamplesSection(ctx.referenceExamples),
    buildTestingWorkflowSection(),
    buildTestingRulesSection(),
    buildQualityRulesSection(),
    buildProjectInstructionsSection(ctx.projectInstructions),
    buildSecurityRulesSection(),
  ];
  return sections.filter(Boolean).join("\n\n");
}

function buildImplementationPhaseMd(ctx: ClaudeCliInstructionsContext, taskType: ForgeTaskType): string {
  const complexity = ctx.complexity ?? "standard";

  const sections: string[] = [
    buildIdentitySection(),
    buildDecisionProtocolSection(taskType),
    buildComplexityHintSection(complexity),
    buildTaskContextSection(ctx),
    buildGoalSection(ctx.goalContext),
    buildNexusSection(ctx.nexusResearch),
    buildRepositorySection(ctx.repositoryIndexSummary, taskType),
    buildReferenceExamplesSection(ctx.referenceExamples),
    buildWorkflowSection(ctx.baselineBuildFailed),
    buildQualityRulesSection(),
  ];

  const isSimple = complexity === "simple";
  const conditionalSections = [
    ...(isSimple ? [] : [buildArchitectureRulesSection()]),
    buildFrontendRulesSection(ctx.language, ctx.framework),
    buildTestingRulesSection(),
    ...(isSimple ? [] : [buildDependencyRulesSection()]),
    buildProjectInstructionsSection(ctx.projectInstructions),
    buildSecurityRulesSection(),
  ];

  sections.push(...conditionalSections);

  return sections.filter(Boolean).join("\n\n");
}
