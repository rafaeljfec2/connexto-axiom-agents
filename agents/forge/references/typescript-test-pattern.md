---
tags: [test, typescript, unit, spec, vitest, jest]
applies_to: [IMPLEMENT, FIX, CREATE]
description: Unit test pattern with proper typing, isolated tests, and descriptive names
---

## Unit Test Pattern

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";
import { UserService } from "./user.service";
import type { UserRepository } from "./user.repository";

function createMockRepository(): UserRepository {
  return {
    findOne: vi.fn(),
    save: vi.fn(),
    delete: vi.fn(),
  } as unknown as UserRepository;
}

describe("UserService", () => {
  let service: UserService;
  let repository: UserRepository;

  beforeEach(() => {
    repository = createMockRepository();
    service = new UserService(repository);
  });

  describe("findById", () => {
    it("should return user response when user exists", async () => {
      const mockUser = {
        id: "user-123",
        name: "John Doe",
        email: "john@example.com",
        createdAt: new Date("2026-01-01"),
      };
      vi.mocked(repository.findOne).mockResolvedValue(mockUser);

      const result = await service.findById("user-123");

      expect(result).toEqual({
        id: "user-123",
        name: "John Doe",
        email: "john@example.com",
        createdAt: "2026-01-01T00:00:00.000Z",
      });
    });

    it("should throw NotFoundException when user does not exist", async () => {
      vi.mocked(repository.findOne).mockResolvedValue(null);

      await expect(service.findById("nonexistent")).rejects.toThrow(
        "User not found: nonexistent",
      );
    });
  });
});
```

## Key Patterns

- All `describe` and `it` blocks MUST be in English
- Create mock factories (`createMockRepository`) for reusable test setup
- Type mocks properly — avoid `any`
- Each test should be independent and isolated
- Use descriptive test names that explain expected behavior

## What NOT to do

- Do NOT use `any` for mock types
- Do NOT share mutable state between tests
- Do NOT test implementation details — test behavior
- Do NOT skip error case tests
