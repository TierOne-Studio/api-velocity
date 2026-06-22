import {
  BadRequestException,
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ConfigService } from '../../../../shared/config';
import { PublicChatService } from '../../application/public-chat.service';
import type { RequestWithEmbedScope } from '../../application/embed-scope';
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

  @Post('ask/stream')
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
        throw new UnauthorizedException('Embed scope missing');
      }

      const question = (body?.question ?? '').trim();
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
      const { statusCode, message } = this.toPublicError(
        error,
        'Failed to stream message',
      );
      this.writeSseEvent(response, 'error', { statusCode, message });
    } finally {
      response.off('close', onClientClose);
      response.end();
    }
  }
}
