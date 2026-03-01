---
tags: [refactor, typescript, clean-code, extract, simplify]
applies_to: [REFACTOR]
description: Safe refactoring pattern preserving external behavior while improving internal structure
---

## Refactoring Approach

### Before: Complex function with multiple responsibilities

```typescript
async function processOrder(orderId: string, db: Database): Promise<void> {
  const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId);
  if (!order) throw new Error("Order not found");
  if (order.status !== "pending") throw new Error("Invalid status");
  const items = db.prepare("SELECT * FROM order_items WHERE order_id = ?").all(orderId);
  let total = 0;
  for (const item of items) {
    total += item.price * item.quantity;
    if (item.quantity > item.stock) throw new Error(`Insufficient stock for ${item.name}`);
  }
  db.prepare("UPDATE orders SET status = 'confirmed', total = ? WHERE id = ?").run(total, orderId);
}
```

### After: Extracted functions with single responsibility

```typescript
function findOrderOrThrow(db: Database, orderId: string): Order {
  const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId) as Order | undefined;
  if (!order) throw new NotFoundException(`Order not found: ${orderId}`);
  return order;
}

function validateOrderStatus(order: Order, expected: OrderStatus): void {
  if (order.status !== expected) {
    throw new BadRequestException(`Expected status "${expected}", got "${order.status}"`);
  }
}

function calculateTotal(items: readonly OrderItem[]): number {
  return items.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

function validateStock(items: readonly OrderItem[]): void {
  for (const item of items) {
    if (item.quantity > item.stock) {
      throw new BadRequestException(`Insufficient stock for ${item.name}`);
    }
  }
}

async function processOrder(orderId: string, db: Database): Promise<void> {
  const order = findOrderOrThrow(db, orderId);
  validateOrderStatus(order, "pending");
  const items = db.prepare("SELECT * FROM order_items WHERE order_id = ?").all(orderId) as OrderItem[];
  validateStock(items);
  const total = calculateTotal(items);
  db.prepare("UPDATE orders SET status = 'confirmed', total = ? WHERE id = ?").run(total, orderId);
}
```

## Key Patterns

- Extract pure functions that can be tested independently
- Keep the same external API (function signature unchanged)
- Add proper types instead of implicit `any`
- Mark parameters as `readonly` when they should not be mutated
- Name extracted functions to describe their intent

## What NOT to do

- Do NOT change function signatures without explicit request
- Do NOT add new dependencies during a refactor
- Do NOT change behavior — only structure
- Do NOT refactor and add features at the same time
