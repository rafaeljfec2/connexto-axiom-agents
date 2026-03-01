---
tags: [react, nextjs, component, frontend, mobile-first]
applies_to: [IMPLEMENT, CREATE, REFACTOR]
description: React component pattern for Next.js with mobile-first design and proper typing
---

## Component Pattern

```typescript
import { useState, useCallback } from "react";

interface DocumentCardProps {
  readonly id: string;
  readonly title: string;
  readonly status: "pending" | "signed" | "expired";
  readonly onSign?: (id: string) => void;
}

export function DocumentCard({ id, title, status, onSign }: Readonly<DocumentCardProps>) {
  const [isLoading, setIsLoading] = useState(false);

  const handleSign = useCallback(async () => {
    if (!onSign) return;
    setIsLoading(true);
    try {
      onSign(id);
    } finally {
      setIsLoading(false);
    }
  }, [id, onSign]);

  return (
    <div className="w-full rounded-lg border p-3 sm:p-4">
      <h3 className="text-sm font-medium sm:text-base">{title}</h3>
      <span className="mt-1 inline-block rounded-full px-2 py-0.5 text-xs">
        {status}
      </span>
      {status === "pending" && onSign ? (
        <button
          onClick={handleSign}
          disabled={isLoading}
          className="mt-2 w-full rounded bg-blue-600 px-3 py-1.5 text-sm text-white sm:mt-3 sm:w-auto"
        >
          {isLoading ? "Signing..." : "Sign"}
        </button>
      ) : null}
    </div>
  );
}
```

## Key Patterns

- Props interface with `readonly` on all properties
- Component params wrapped in `Readonly<Props>`
- Mobile-first CSS: base styles for mobile, `sm:` breakpoints for larger screens
- Use `null` return instead of conditional rendering with `&&`
- Use `useCallback` for event handlers passed as props

## What NOT to do

- Do NOT use `any` for props or state
- Do NOT start with desktop layout: always mobile-first
- Do NOT use `&&` for conditional rendering: use ternary with `null`
- Do NOT inline complex logic in JSX: extract to functions or hooks
