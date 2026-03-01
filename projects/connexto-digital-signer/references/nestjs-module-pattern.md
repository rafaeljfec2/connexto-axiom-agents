---
tags: [nestjs, module, controller, service, turbo, monorepo]
applies_to: [IMPLEMENT, CREATE]
description: NestJS module structure for turbo monorepo with proper separation of concerns
---

## Module Structure

In this monorepo (NestJS + Next.js + Turbo), backend modules follow this pattern:

```
apps/api/src/modules/<module-name>/
  <module-name>.module.ts
  <module-name>.controller.ts
  <module-name>.service.ts
  dto/
    create-<entity>.dto.ts
    update-<entity>.dto.ts
  entities/
    <entity>.entity.ts
```

## Controller Pattern

```typescript
import { Controller, Get, Post, Body, Param } from "@nestjs/common";
import { ExampleService } from "./example.service";
import type { CreateExampleDto } from "./dto/create-example.dto";

@Controller("examples")
export class ExampleController {
  constructor(private readonly exampleService: ExampleService) {}

  @Post()
  create(@Body() dto: CreateExampleDto) {
    return this.exampleService.create(dto);
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.exampleService.findById(id);
  }
}
```

## DTO Pattern

```typescript
export class CreateExampleDto {
  readonly name!: string;
  readonly description?: string;
}
```

## Key Patterns

- Each module is self-contained with its own controller, service, and DTOs
- DTOs use `readonly` properties
- Services handle business logic, controllers handle HTTP concerns
- Entity-to-DTO mapping happens in the service layer
- Turbo paths: API lives in `apps/api/`, Web in `apps/web/`, shared in `packages/`
