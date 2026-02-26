# Golden Example: IMPLEMENT mode

## Task Input

```
Implement a health check endpoint at GET /health that returns { status: "ok", uptime: <seconds> }
```

## Expected Behavior

1. Read `_PROJECT_TREE.txt` to understand project layout
2. Read the main app/server file to understand routing patterns
3. Create or modify the route file to add the health check endpoint
4. Implement the handler with proper types
5. Run `tsc --noEmit` to verify
6. Provide summary

## Expected Output (code)

```typescript
interface HealthCheckResponse {
  readonly status: "ok";
  readonly uptime: number;
}

const startTime = process.hrtime.bigint();

export function healthCheckHandler(_req: Request, res: Response): void {
  const uptimeSeconds = Number(process.hrtime.bigint() - startTime) / 1e9;
  const response: HealthCheckResponse = {
    status: "ok",
    uptime: Math.floor(uptimeSeconds),
  };
  res.json(response);
}
```

## What NOT to do

- Do NOT use `any` type for request/response
- Do NOT add unnecessary comments
- Do NOT modify unrelated files
- Do NOT skip type checking
