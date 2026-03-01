---
tags: [frontend, react, nextjs, component, mobile-first, typescript, ui, ux]
applies_to: [IMPLEMENT, CREATE, REFACTOR, FIX]
description: Frontend engineering rules with mobile-first design, React patterns, and component architecture
---

## Mobile-First Component (MANDATORY)

Always start with mobile layout, then add breakpoints for larger screens:

```typescript
interface PageHeaderProps {
  readonly title: string;
  readonly subtitle?: string;
  readonly actions?: React.ReactNode;
}

export function PageHeader({ title, subtitle, actions }: Readonly<PageHeaderProps>) {
  return (
    <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-4">
      <div>
        <h1 className="text-lg font-semibold sm:text-xl lg:text-2xl">{title}</h1>
        {subtitle ? (
          <p className="mt-0.5 text-xs text-muted-foreground sm:text-sm">{subtitle}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex gap-2">{actions}</div>
      ) : null}
    </div>
  );
}
```

## Props Pattern (always readonly)

```typescript
interface CardProps {
  readonly id: string;
  readonly title: string;
  readonly status: "active" | "inactive";
  readonly onClick?: (id: string) => void;
}

export function Card({ id, title, status, onClick }: Readonly<CardProps>) {
  const handleClick = useCallback(() => {
    onClick?.(id);
  }, [id, onClick]);

  return (
    <button
      onClick={handleClick}
      className="w-full rounded-lg border p-3 text-left sm:p-4"
    >
      <span className="text-sm font-medium sm:text-base">{title}</span>
      <span className="mt-1 block text-xs text-muted-foreground">{status}</span>
    </button>
  );
}
```

## Conditional Rendering (use ternary with null)

```typescript
{isLoading ? (
  <Skeleton className="h-8 w-full" />
) : null}

{items.length > 0 ? (
  <ul>{items.map(item => <li key={item.id}>{item.name}</li>)}</ul>
) : (
  <EmptyState message="No items found" />
)}
```

## Data Fetching Hook Pattern

```typescript
interface UseDocumentsResult {
  readonly documents: readonly Document[];
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly refetch: () => void;
}

export function useDocuments(projectId: string): UseDocumentsResult {
  const [documents, setDocuments] = useState<readonly Document[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchDocuments(projectId);
      setDocuments(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { documents, isLoading, error, refetch };
}
```

## Responsive Grid (mobile-first)

```typescript
<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
  {items.map(item => (
    <Card key={item.id} {...item} />
  ))}
</div>
```

## What NOT to do

- NEVER start with desktop layout: always build mobile-first
- NEVER use `any` for props, state, or event handlers
- NEVER use `&&` for conditional rendering: use ternary with `null`
- NEVER inline complex logic in JSX: extract to functions or hooks
- NEVER use `||` for default values: use `??`
- NEVER skip `readonly` on prop interfaces (SonarQube S6759)
- NEVER create components with more than 800 lines: extract sub-components
- NEVER add unnecessary comments to the code
- NEVER use prop drilling for deep trees: extract hooks or use composition
