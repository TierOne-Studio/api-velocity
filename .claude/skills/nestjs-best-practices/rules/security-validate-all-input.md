---
title: Validate All Input with DTOs and Pipes
impact: HIGH
impactDescription: First line of defense against attacks
tags: security, validation, dto, pipes
---

## Validate All Input with DTOs and Pipes

Every endpoint validates user-controlled input before processing. Invalid input produces a structured 400 response with a clear field-level message. Validation is required for all request bodies, query parameters, and route parameters.

> ⚠️ **Approach gate (per `nestjs-best-practices/SKILL.md` "How rules are structured"):** This rule has two valid implementations. **Before writing any code, ASK the user which approach they prefer:**
>
> > "Input validation can be implemented two ways:
> > - **Approach A — Custom abstraction (no new deps):** Validator helper functions (`requireString`, `requireEmail`, `requireInt`, ...) called manually at controller boundaries; DTOs stay as TypeScript interfaces.
> > - **Approach B — Library:** install `class-validator` + `class-transformer` for decorator-based DTO validation with global `ValidationPipe`.
> >
> > Which approach should I use?"
>
> Wait for explicit response. Do NOT silently choose.

## Outcome

- Every user-controlled input is checked at the controller boundary before reaching service code.
- Invalid input → `BadRequestException` with a clear field-level message.
- Validation is composable and unit-testable.
- Type safety: services receive validated, typed inputs (not `any`).

## Approach A — Custom abstraction (no new deps)

Build small, composable validator helpers in `src/shared/utils/validation.ts`:

```ts
// src/shared/utils/validation.ts
import { BadRequestException } from '@nestjs/common';

export function requireString(
  value: unknown,
  name: string,
  opts?: { min?: number; max?: number; pattern?: RegExp },
): string {
  if (typeof value !== 'string') {
    throw new BadRequestException(`${name} must be a string`);
  }
  if (opts?.min !== undefined && value.length < opts.min) {
    throw new BadRequestException(`${name} must be at least ${opts.min} characters`);
  }
  if (opts?.max !== undefined && value.length > opts.max) {
    throw new BadRequestException(`${name} must be at most ${opts.max} characters`);
  }
  if (opts?.pattern && !opts.pattern.test(value)) {
    throw new BadRequestException(`${name} has invalid format`);
  }
  return value;
}

export function requireEmail(value: unknown, name: string): string {
  const s = requireString(value, name, { min: 3, max: 254 });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) {
    throw new BadRequestException(`${name} must be a valid email`);
  }
  return s.toLowerCase().trim();
}

export function requireInt(
  value: unknown,
  name: string,
  opts?: { min?: number; max?: number },
): number {
  const n = typeof value === 'string' ? parseInt(value, 10) : value;
  if (!Number.isInteger(n)) {
    throw new BadRequestException(`${name} must be an integer`);
  }
  if (opts?.min !== undefined && (n as number) < opts.min) {
    throw new BadRequestException(`${name} must be at least ${opts.min}`);
  }
  if (opts?.max !== undefined && (n as number) > opts.max) {
    throw new BadRequestException(`${name} must be at most ${opts.max}`);
  }
  return n as number;
}

export function requireUuid(value: unknown, name: string): string {
  const s = requireString(value, name);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) {
    throw new BadRequestException(`${name} must be a valid UUID`);
  }
  return s;
}
```

DTOs remain TypeScript interfaces; controllers validate manually:

```ts
// src/modules/users/api/dto/user.dto.ts
export interface CreateUserInput {
  name: string;
  email: string;
  age: number;
}

// src/modules/users/api/users.controller.ts
@Controller('users')
export class UsersController {
  @Post()
  async create(@Body() body: unknown): Promise<User> {
    const input: CreateUserInput = {
      name:  requireString(body?.['name'], 'name', { min: 2, max: 100 }),
      email: requireEmail(body?.['email'], 'email'),
      age:   requireInt(body?.['age'], 'age', { min: 0, max: 150 }),
    };
    return this.usersService.create(input);
  }

  @Get()
  async findAll(@Query() query: unknown): Promise<User[]> {
    const limit  = requireInt(query?.['limit']  ?? 20, 'limit',  { min: 1, max: 100 });
    const offset = requireInt(query?.['offset'] ?? 0,  'offset', { min: 0 });
    const search = query?.['search'] !== undefined
      ? requireString(query['search'], 'search', { max: 100 })
      : undefined;
    return this.usersService.findAll({ limit, offset, search });
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<User> {
    requireUuid(id, 'id');
    return this.usersService.findById(id);
  }
}
```

Validators are pure functions, easily unit-testable in isolation. Composition handled by composing helpers.

**Limitations:** boilerplate per route; no automatic transformation; harder to keep validation declarations consistent across endpoints. These are real costs but documented and intentional per `repo-conventions` § DTOs.

**Anti-patterns regardless of approach:**

```ts
// ❌ Trust raw input
@Post()
create(@Body() body: any) {
  return this.usersService.create(body); // body could contain anything
}

// ❌ DTOs without validation
export interface CreateUserDto {
  name: string;    // No check
  email: string;   // Could be "not-an-email"
  age: number;     // Could be -999
}
```

## Approach B — Library: `class-validator` + `class-transformer` ⚠️ Adoption-gated

> ⚠️ Adopting this approach adds `class-validator` AND `class-transformer` to `package.json`. **Do NOT implement this section without explicit user approval naming both packages.**

```typescript
// Enable ValidationPipe globally in main.ts
async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,              // Strip unknown properties
      forbidNonWhitelisted: true,   // Throw on unknown properties
      transform: true,              // Auto-transform to DTO types
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  await app.listen(3000);
}

// Create well-validated DTOs
import {
  IsString,
  IsEmail,
  IsInt,
  Min,
  Max,
  IsOptional,
  MinLength,
  MaxLength,
  Matches,
  IsNotEmpty,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(100)
  @Transform(({ value }) => value?.trim())
  name: string;

  @IsEmail()
  @Transform(({ value }) => value?.toLowerCase().trim())
  email: string;

  @IsInt()
  @Min(0)
  @Max(150)
  age: number;

  @IsString()
  @MinLength(8)
  @MaxLength(100)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
    message: 'Password must contain uppercase, lowercase, and number',
  })
  password: string;
}

// Query DTO with defaults and transformation
export class FindUsersQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset: number = 0;
}

// Param validation
export class UserIdParamDto {
  @IsUUID('4')
  id: string;
}

@Controller('users')
export class UsersController {
  @Post()
  create(@Body() dto: CreateUserDto): Promise<User> {
    // dto is guaranteed to be valid
    return this.usersService.create(dto);
  }

  @Get()
  findAll(@Query() query: FindUsersQueryDto): Promise<User[]> {
    // query.limit is a number, query.search is sanitized
    return this.usersService.findAll(query);
  }

  @Get(':id')
  findOne(@Param() params: UserIdParamDto): Promise<User> {
    // params.id is a valid UUID
    return this.usersService.findById(params.id);
  }
}
```

Reference: [NestJS Validation](https://docs.nestjs.com/techniques/validation)
