---
title: Sanitize Output to Prevent XSS
impact: HIGH
impactDescription: XSS vulnerabilities can compromise user sessions and data
tags: security, xss, sanitization, html
---

## Sanitize Output to Prevent XSS

Three concerns are bundled in this rule:
1. **Security headers** (CSP, X-Frame-Options, etc.) — prevent the browser from executing untrusted scripts.
2. **Output escaping** (URL encoding, error message safety) — prevent reflected XSS.
3. **Stored HTML sanitization** — strip dangerous tags/attributes from user-submitted HTML before storage.

> ⚠️ **Approach gate (per `nestjs-best-practices/SKILL.md` "How rules are structured"):** Each concern has different gating:
> - **Security headers + output escaping**: Approach A (no new dep, manual headers) OR Approach B (`helmet`). **ASK before installing `helmet`.**
> - **HTML sanitization**: NO clean abstraction — writing your own HTML sanitizer is unsafe. **ASK before installing `sanitize-html`.**
>
> When the change involves any of these concerns, ASK the user. Do NOT silently install `helmet` or `sanitize-html`.
>
> > "Output sanitization can be implemented:
> > - **Security headers**: manual headers in middleware (no dep) OR install `helmet` for a comprehensive default set.
> > - **HTML sanitization**: only `sanitize-html` is safe. Adopting it adds the package; writing one yourself is a security risk.
> >
> > For this change, which scope applies and which approach should I use?"
>
> Wait for explicit response.

## Outcome

- The browser receives the right CSP / X-Frame / X-Content-Type-Options headers.
- Reflected user input in error messages or HTML responses is escaped or sanitized.
- Stored user-submitted HTML strips `<script>`, event handlers, javascript: URIs, etc.
- Validated input formats (UUIDs, emails) prevent reflection of arbitrary content in error messages.

## Approach A — Custom abstraction for headers + escaping (no new deps)

Manual security-headers middleware:

```ts
// src/shared/infrastructure/security/security-headers.middleware.ts
import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class SecurityHeadersMiddleware implements NestMiddleware {
  use(_req: Request, res: Response, next: NextFunction) {
    // Subset of helmet defaults adequate for a JSON API:
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    // CSP for HTML responses (skip for JSON-only APIs):
    // res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'");
    next();
  }
}
```

For URL/output encoding, use built-ins:

```ts
// In controllers, escape user input that goes back into responses
import { Controller, Get, Param, NotFoundException, ParseUUIDPipe } from '@nestjs/common';

@Controller('users')
export class UsersController {
  // Validate the path-param format so the error message can't reflect arbitrary content
  @Get(':id')
  async findOne(@Param('id', ParseUUIDPipe) id: string): Promise<User> {
    const user = await this.usersService.findById(id);
    if (!user) {
      // Safe: id is guaranteed UUID format
      throw new NotFoundException('User not found');
    }
    return user;
  }
}
```

For URL building, use `encodeURIComponent`:

```ts
// Don't string-concatenate user data into URLs
const url = `https://api.example.com/users/${encodeURIComponent(userId)}`;
```

**Limitations:** the manual header set is a subset of `helmet`'s defaults. If you need the full helmet feature surface (HPKP, expectCT, permissions-policy, etc.), Approach B is appropriate.

**Anti-patterns regardless of approach:**

```ts
// ❌ Reflect raw user input in errors
@Get(':id')
async findOne(@Param('id') id: string): Promise<User> {
  const user = await this.repo.findOne({ where: { id } });
  if (!user) {
    // If id contains <script>...</script> and the response is rendered as HTML, XSS
    throw new NotFoundException(`User ${id} not found`);
  }
  return user;
}

// ❌ Return raw HTML containing user content
@Get(':slug')
@Header('Content-Type', 'text/html')
async getPage(@Param('slug') slug: string): Promise<string> {
  const page = await this.pagesService.findBySlug(slug);
  return `<html><body>${page.content}</body></html>`; // page.content might contain user-submitted scripts
}
```

## Approach B — Library: `helmet` for headers ⚠️ Adoption-gated

> ⚠️ Adopting `helmet` adds it to `package.json`. **Do NOT install without explicit user approval.** `helmet` provides a richer default set than the manual middleware above.

```typescript
import helmet from 'helmet';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'https:'],
        },
      },
    }),
  );

  await app.listen(3000);
}
```

## HTML sanitization (`sanitize-html`) — adoption-gated, no abstraction

> ⚠️ Adopting `sanitize-html` adds it to `package.json`. **Do NOT install without explicit user approval.** **Writing your own HTML sanitizer is a security risk.** If the change requires accepting user-submitted HTML (rich text editor output, etc.), `sanitize-html` is the recommended adoption.

```typescript
import * as sanitizeHtml from 'sanitize-html';

@Injectable()
export class CommentsService {
  private readonly sanitizeOptions: sanitizeHtml.IOptions = {
    allowedTags: ['b', 'i', 'em', 'strong', 'a', 'p', 'br'],
    allowedAttributes: {
      a: ['href', 'title'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
  };

  async create(dto: CreateCommentDto): Promise<Comment> {
    return this.repo.save({
      content: sanitizeHtml(dto.content, this.sanitizeOptions),
      authorId: dto.authorId,
    });
  }
}
```

**If the change does NOT involve accepting user-submitted HTML** (e.g., the API only returns JSON, no rich text fields), the dep isn't needed.

Reference: [OWASP XSS Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html)
