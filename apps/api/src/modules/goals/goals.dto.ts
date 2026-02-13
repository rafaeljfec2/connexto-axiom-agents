export class CreateGoalDto {
  readonly title!: string;
  readonly description?: string;
  readonly priority?: number;
  readonly project_id?: string;
}

export class UpdateGoalDto {
  readonly title?: string;
  readonly description?: string;
  readonly status?: "active" | "completed" | "cancelled";
  readonly priority?: number;
}
