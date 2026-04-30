---
title: Use Event-Driven Architecture for Decoupling
impact: MEDIUM-HIGH
impactDescription: Enables async processing and modularity
tags: architecture, events, decoupling
---

## Use Event-Driven Architecture for Decoupling

Modules react to changes without direct dependencies on each other. The producing module knows nothing about consumers.

> ⚠️ **Approach gate (per `nestjs-best-practices/SKILL.md` "How rules are structured"):** This rule has two valid implementations. **Before writing any code, ASK the user which approach they prefer:**
>
> > "Event-driven decoupling can be implemented two ways:
> > - **Approach A — Custom abstraction (no new deps):** A `DomainEvents` service wrapping Node's built-in `EventEmitter` from `node:events`.
> > - **Approach B — Library:** install `@nestjs/event-emitter` for `@OnEvent()` decorator support and richer event-handling features (wildcards, async waitFor, etc.).
> >
> > Which approach should I use?"
>
> Wait for explicit response. Do NOT silently choose.

## Outcome

- The emitting service knows nothing about consumers — only emits events.
- Listeners subscribe in their own modules; adding a new consumer doesn't modify the emitter.
- Events carry just enough data for consumers to act (entity IDs preferred over full objects).
- Event handlers run async, with errors logged but not blocking the main flow.

## Approach A — Custom abstraction (no new deps)

Wrap Node's built-in `EventEmitter` from `node:events`:

```ts
// src/shared/infrastructure/events/domain-events.service.ts
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import { LoggerService } from '../logging/logger.service';

@Injectable()
export class DomainEvents implements OnModuleDestroy {
  private readonly emitter = new EventEmitter({ captureRejections: true });

  constructor(private readonly logger: LoggerService) {
    // Async handler errors must be logged, not crash the process
    this.emitter.on('error', (err) => {
      this.logger.error('domain-event.handler.failed', err);
    });
  }

  emit<T>(eventName: string, payload: T): void {
    this.emitter.emit(eventName, payload);
  }

  on<T>(eventName: string, handler: (payload: T) => void | Promise<void>): void {
    this.emitter.on(eventName, async (payload: T) => {
      try {
        await handler(payload);
      } catch (err) {
        this.emitter.emit('error', err);
      }
    });
  }

  onModuleDestroy() {
    this.emitter.removeAllListeners();
  }
}
```

Define events as plain TypeScript types (not classes):

```ts
// src/modules/orders/domain/events.ts
export interface OrderCreatedEvent {
  orderId: string;
  userId: string;
  items: { productId: string; quantity: number }[];
  total: number;
}
```

Producer emits:

```ts
@Injectable()
export class OrdersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly events: DomainEvents,
  ) {}

  async createOrder(input: CreateOrderInput): Promise<Order> {
    const order = await this.db.transaction(async (query) => {
      const [order] = await query<Order>(`INSERT INTO orders ... RETURNING *`, [...]);
      // ... create line items
      return order;
    });

    // Emit AFTER the DB write commits — handlers shouldn't block the response
    this.events.emit<OrderCreatedEvent>('order.created', {
      orderId: order.id,
      userId: order.userId,
      items: order.items,
      total: order.total,
    });

    return order;
  }
}
```

Consumers subscribe in their own modules:

```ts
@Injectable()
export class InventoryListener implements OnModuleInit {
  constructor(
    private readonly events: DomainEvents,
    private readonly inventory: InventoryService,
  ) {}

  onModuleInit() {
    this.events.on<OrderCreatedEvent>('order.created', async (e) => {
      await this.inventory.reserve(e.items);
    });
  }
}
```

**Limitations:** no wildcard subscription (`order.*`), no `waitFor()` API, no built-in metrics. Sufficient for in-process domain events; if you need cross-service messaging, that's a separate decision (queues, see `micro-use-queues`).

**Anti-pattern regardless of approach:**

```ts
// ❌ Direct service coupling
@Injectable()
export class OrdersService {
  constructor(
    private inventoryService: InventoryService,
    private emailService: EmailService,
    private analyticsService: AnalyticsService,
    private notificationService: NotificationService,
    private loyaltyService: LoyaltyService,
  ) {}

  async createOrder(dto: CreateOrderDto): Promise<Order> {
    const order = await this.repo.save(dto);

    // OrdersService knows about all consumers — adding a new one means modifying this service
    await this.inventoryService.reserve(order.items);
    await this.emailService.sendConfirmation(order);
    await this.analyticsService.track('order_created', order);
    await this.notificationService.push(order.userId, 'Order placed');
    await this.loyaltyService.addPoints(order.userId, order.total);

    return order;
  }
}
```

## Approach B — Library: `@nestjs/event-emitter` ⚠️ Adoption-gated

> ⚠️ Adopting this approach adds `@nestjs/event-emitter` (transitively `eventemitter2`) to `package.json`. **Do NOT implement this section without explicit user approval.**

```typescript
// Use EventEmitter for decoupling
import { EventEmitter2 } from '@nestjs/event-emitter';

// Define event
export class OrderCreatedEvent {
  constructor(
    public readonly orderId: string,
    public readonly userId: string,
    public readonly items: OrderItem[],
    public readonly total: number,
  ) {}
}

// Service emits events
@Injectable()
export class OrdersService {
  constructor(
    private eventEmitter: EventEmitter2,
    private repo: Repository<Order>,
  ) {}

  async createOrder(dto: CreateOrderDto): Promise<Order> {
    const order = await this.repo.save(dto);

    // Emit event - no knowledge of consumers
    this.eventEmitter.emit(
      'order.created',
      new OrderCreatedEvent(order.id, order.userId, order.items, order.total),
    );

    return order;
  }
}

// Listeners in separate modules
@Injectable()
export class InventoryListener {
  @OnEvent('order.created')
  async handleOrderCreated(event: OrderCreatedEvent): Promise<void> {
    await this.inventoryService.reserve(event.items);
  }
}

@Injectable()
export class EmailListener {
  @OnEvent('order.created')
  async handleOrderCreated(event: OrderCreatedEvent): Promise<void> {
    await this.emailService.sendConfirmation(event.orderId);
  }
}

@Injectable()
export class AnalyticsListener {
  @OnEvent('order.created')
  async handleOrderCreated(event: OrderCreatedEvent): Promise<void> {
    await this.analyticsService.track('order_created', {
      orderId: event.orderId,
      total: event.total,
    });
  }
}
```

Reference: [NestJS Events](https://docs.nestjs.com/techniques/events)
