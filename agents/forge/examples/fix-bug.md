# Golden Example: FIX mode

## Task Input

```
Fix: getUserById returns null when user exists but has no email field
```

## Expected Behavior

1. Read `_PROJECT_TREE.txt` to find user-related files
2. Read the `getUserById` function source
3. Identify the root cause (likely a strict check on email field)
4. Apply the minimal fix
5. Verify with `tsc --noEmit`
6. Provide summary with root cause explanation

## Expected Fix (minimal diff)

```typescript
// Before (bug: returns null if email is undefined)
function getUserById(id: string): User | null {
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
  if (!row || !row.email) return null;
  return mapRowToUser(row);
}

// After (fix: email is optional, don't require it)
function getUserById(id: string): User | null {
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
  if (!row) return null;
  return mapRowToUser(row);
}
```

## What NOT to do

- Do NOT refactor the entire function
- Do NOT change the function signature
- Do NOT create new files
- Do NOT modify other functions
