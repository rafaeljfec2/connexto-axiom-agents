---
tags: [backend, nestjs, typescript, api, service, controller, dto, architecture]
applies_to: [IMPLEMENT, CREATE, REFACTOR, FIX]
description: Backend engineering rules with NestJS patterns, error handling, DTOs, and async best practices
---

## API Controller Pattern

```typescript
@Controller("documents")
export class DocumentController {
  constructor(private readonly documentService: DocumentService) {}

  @Post()
  create(@Body() dto: CreateDocumentDto): Promise<DocumentResponse> {
    return this.documentService.create(dto);
  }

  @Get(":id")
  findOne(@Param("id") id: string): Promise<DocumentResponse> {
    return this.documentService.findById(id);
  }
}
```

## DTO Pattern (always readonly)

```typescript
export class CreateDocumentDto {
  readonly title!: string;
  readonly description?: string;
  readonly type!: DocumentType;
}
```

## Service with Entity-to-DTO Mapping

```typescript
@Injectable()
export class DocumentService {
  constructor(private readonly repo: DocumentRepository) {}

  async findById(id: string): Promise<DocumentResponse> {
    const entity = await this.repo.findOne({ where: { id } });
    if (!entity) {
      throw new NotFoundException(`Document not found: ${id}`);
    }
    return this.toResponse(entity);
  }

  private toResponse(entity: DocumentEntity): DocumentResponse {
    return {
      id: entity.id,
      title: entity.title,
      createdAt: entity.createdAt.toISOString(),
    };
  }
}
```

## Async Patterns

```typescript
const [users, permissions] = await Promise.all([
  userService.findAll(),
  permissionService.findByRole(role),
]);

const results = await Promise.allSettled([
  notifyEmail(user),
  notifySlack(channel),
]);
```

## Nullish Coalescing (ALWAYS use ?? not ||)

```typescript
const name = user.name ?? "Anonymous";
const limit = options.limit ?? 10;
const fallback = config.timeout ?? 30_000;
```

## Error Handling

```typescript
async create(dto: CreateDocumentDto): Promise<DocumentResponse> {
  const existing = await this.repo.findByTitle(dto.title);
  if (existing) {
    throw new ConflictException(`Document already exists: ${dto.title}`);
  }

  try {
    const entity = await this.repo.save(dto);
    return this.toResponse(entity);
  } catch (error) {
    throw new InternalServerErrorException("Failed to create document");
  }
}
```

## What NOT to do

- NEVER expose database entities directly in API responses
- NEVER use `any` type for DTOs, services, or parameters
- NEVER use `||` for default values: always use `??`
- NEVER mix business logic with data access in controllers
- NEVER skip input validation on public endpoints
- NEVER put business logic in controllers: keep it in services
- NEVER create files with more than 800 lines: refactor and modularize
- NEVER add unnecessary comments to the code
