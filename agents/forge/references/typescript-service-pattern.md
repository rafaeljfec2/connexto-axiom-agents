---
tags: [service, typescript, nestjs, pattern, injectable]
applies_to: [IMPLEMENT, CREATE]
description: TypeScript service with dependency injection, proper error handling, and readonly interfaces
---

## Service Pattern

```typescript
import { Injectable, NotFoundException } from "@nestjs/common";

interface CreateUserDto {
  readonly name: string;
  readonly email: string;
}

interface UserResponse {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly createdAt: string;
}

@Injectable()
export class UserService {
  constructor(private readonly userRepository: UserRepository) {}

  async create(dto: CreateUserDto): Promise<UserResponse> {
    const user = await this.userRepository.save({
      name: dto.name,
      email: dto.email,
    });

    return this.toResponse(user);
  }

  async findById(id: string): Promise<UserResponse> {
    const user = await this.userRepository.findOne({ where: { id } });

    if (!user) {
      throw new NotFoundException(`User not found: ${id}`);
    }

    return this.toResponse(user);
  }

  private toResponse(user: UserEntity): UserResponse {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      createdAt: user.createdAt.toISOString(),
    };
  }
}
```

## Key Patterns

- Mark all DTO and response properties as `readonly`
- Use proper NestJS exceptions (NotFoundException, BadRequestException)
- Map entities to response DTOs: never expose entities directly
- Use `??` for nullish coalescing, never `||`
- Keep service methods focused on single responsibility

## What NOT to do

- Do NOT expose database entities in API responses
- Do NOT use `any` type for DTOs or service parameters
- Do NOT mix business logic with data access logic
- Do NOT use `||` for default values: use `??`
