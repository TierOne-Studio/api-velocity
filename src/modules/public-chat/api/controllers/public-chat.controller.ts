import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import { ConfigService } from '../../../../shared/config';
import { PublicChatService } from '../../application/public-chat.service';
import type {
  EmbedScope,
  RequestWithEmbedScope,
} from '../../application/embed-scope';
import type { PublicAskBody } from '../dto/public-chat.dto';
import { PublicEmbedGuard } from '../guards/public-embed.guard';
import { PublicRateLimitGuard } from '../guards/public-rate-limit.guard';

/**
 * Anonymous public web-chat channel (SPEC-003). No better-auth session, no RBAC
 * — authorization is the embed key + origin allowlist enforced by the guards.
 * Per-request CORS is applied by PublicCorsMiddleware on the `api/public/*`
 * prefix. v1 is stateless ask-only.
 *
 * Guard order: rate-limit (cheap, pre-DB) → embed auth (resolves scope).
 */
@Controller('api/public/chat')
@UseGuards(PublicRateLimitGuard, PublicEmbedGuard)
export class PublicChatController {
  private readonly logger = new Logger(PublicChatController.name);

  constructor(
    private readonly publicChatService: PublicChatService,
    private readonly config: ConfigService,
  ) {}

  private writeSseEvent(
    response: Response,
    event: string,
    data: unknown,
  ): void {
    response.write(`event: ${event}\n`);
    response.write(`data: ${JSON.stringify(data)}\n\n`);
    (response as Response & { flush?: () => void }).flush?.();
  }

  /**
   * Map an error to a public-safe { statusCode, message }. Only HttpException
   * messages (our own intentional, client-facing strings) are surfaced; any
   * other error returns a generic message so internal detail (e.g. raw repo
   * Error text, stack-adjacent strings) never reaches the anonymous client.
   */
  private toPublicError(
    error: unknown,
    genericMessage: string,
  ): { statusCode: number; message: string } {
    if (error instanceof HttpException) {
      return { statusCode: error.getStatus(), message: error.message };
    }
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: genericMessage,
    };
  }

  /**
   * Contextual log for a public-channel failure. Single sink for both the
   * pre-stream and mid-stream paths (this channel can't use Nest's exception
   * layer — ADR-003 — so mapping/logging is local). Only IDs are logged (no
   * request body, no session); internal 5xx carry the error for ops, expected
   * 4xx are a concise warn.
   */
  private logPublicFailure(
    label: string,
    statusCode: number,
    error: unknown,
    scope?: EmbedScope,
  ): void {
    const context = {
      statusCode,
      organizationId: scope?.organizationId,
      embedSiteId: scope?.embedSiteId,
    };
    if (statusCode >= (HttpStatus.INTERNAL_SERVER_ERROR as number)) {
      this.logger.error(label, { ...context, error });
    } else {
      this.logger.warn(label, context);
    }
  }

  /**
   * Public widget theming. Same guards as `ask` (per-key throttle + embed auth
   * + per-request CORS) so it can't be a cheap key-enumeration oracle (§4).
   */
  @Get('config')
  @AllowAnonymous()
  async getConfig(
    @Req() request: Request & RequestWithEmbedScope,
  ): Promise<{ theme: Record<string, unknown> | null }> {
    const scope = request.embedScope;
    if (!scope) {
      // Defensive: the guard always sets this on success. Log if it ever fires
      // — it would mean an unexpected auth-bypass path reached the handler.
      this.logger.error('embed scope missing despite guard success', {
        path: 'config',
      });
      throw new UnauthorizedException('Embed scope missing');
    }
    return this.publicChatService.getPublicConfig(scope);
  }

  @Post('ask/stream')
  @AllowAnonymous()
  async askStream(
    @Req() request: Request & RequestWithEmbedScope,
    @Body() body: PublicAskBody,
    @Res() response: Response,
  ): Promise<void> {
    const abortController = new AbortController();
    const onClientClose = (): void => abortController.abort();
    response.on('close', onClientClose);

    // Pre-stream phase: validate + resolve + enforce cap. Any failure here is a
    // clean HTTP/JSON status (no SSE headers flushed yet).
    let stream: AsyncGenerator<{ type: string }> | null = null;
    try {
      const scope = request.embedScope;
      if (!scope) {
        // Defensive: the guard always sets this on success.
        this.logger.error('embed scope missing despite guard success', {
          path: 'ask/stream',
        });
        throw new UnauthorizedException('Embed scope missing');
      }

      // Runtime type guard at the boundary (ADR-005: no ValidationPipe). A
      // non-string `question` must fail as a 400, not throw a TypeError on
      // `.trim()` that would surface as a generic 500.
      const rawQuestion = body?.question;
      if (rawQuestion !== undefined && typeof rawQuestion !== 'string') {
        throw new BadRequestException('question must be a string');
      }
      const question = (rawQuestion ?? '').trim();
      if (!question) {
        throw new BadRequestException('question is required');
      }
      if (question.length > this.config.getEmbedPublicMaxQuestionLength()) {
        throw new BadRequestException('question exceeds maximum length');
      }

      stream = (await this.publicChatService.prepareStream({
        scope,
        question,
        signal: abortController.signal,
      })) as AsyncGenerator<{ type: string }>;
    } catch (error) {
      response.off('close', onClientClose);
      const { statusCode, message } = this.toPublicError(
        error,
        'Failed to start stream',
      );
      this.logPublicFailure(
        'public ask failed before streaming',
        statusCode,
        error,
        request.embedScope,
      );
      if (!response.headersSent) {
        response.status(statusCode).json({ statusCode, message });
      }
      return;
    }

    // Stream phase: SSE. Mid-stream failures surface as an `error` event.
    response.status(HttpStatus.OK); // override Nest's default 201 for POST
    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.flushHeaders?.();

    try {
      for await (const event of stream) {
        // Reuse the existing chat stream event shapes (token deltas + terminal
        // done event). sql_* events cannot occur — SQL sources are excluded.
        this.writeSseEvent(response, event.type, event);
      }
    } catch (error) {
      // If the client already went away, the socket is gone — emitting an SSE
      // error (or end()) would throw a write-after-close. Treat disconnect as
      // terminal and stay silent.
      const connectionClosed =
        response.writableEnded ||
        response.destroyed ||
        abortController.signal.aborted;
      if (!connectionClosed) {
        const { statusCode, message } = this.toPublicError(
          error,
          'Failed to stream message',
        );
        this.logPublicFailure(
          'public ask failed mid-stream',
          statusCode,
          error,
          request.embedScope,
        );
        this.writeSseEvent(response, 'error', { statusCode, message });
      }
    } finally {
      response.off('close', onClientClose);
      if (!response.writableEnded && !response.destroyed) {
        response.end();
      }
    }
  }
}
