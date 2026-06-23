import {
  Controller,
  Get,
  Logger,
  Res,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Response } from 'express';
import { readFile } from 'fs/promises';
import { ConfigService } from '../../../../shared/config';

/**
 * Serves the standalone public web-chat widget bundle (SPEC-003 Slice 3) at the
 * version-pinned path `GET /api/public/widget/v1/widget.js`.
 *
 * Deliberately guard-free: the bundle is a public static asset loaded by a
 * `<script>` tag BEFORE any embed key is in play (the key authenticates the
 * subsequent `/ask` and `/config` calls, not the script fetch). It is served
 * public + uncredentialed + cacheable; it never carries the credentialed CORS
 * of the private channel (that is keyed to `trustedOrigins` in main.ts).
 */
@Controller('api/public/widget')
export class PublicWidgetController {
  private readonly logger = new Logger(PublicWidgetController.name);
  // The bundle is immutable for the lifetime of the process (rebuilt only on
  // deploy, which restarts the process). Read once, then serve from memory.
  private cached: Buffer | null = null;

  constructor(private readonly config: ConfigService) {}

  @Get('v1/widget.js')
  async serveBundle(@Res() response: Response): Promise<void> {
    const bundle = await this.load();
    response.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    response.setHeader('Cache-Control', 'public, max-age=3600');
    response.send(bundle);
  }

  private async load(): Promise<Buffer> {
    if (this.cached) {
      return this.cached;
    }
    const path = this.config.getWidgetBundlePath();
    try {
      this.cached = await readFile(path);
      return this.cached;
    } catch {
      // Fail loud INTERNALLY with the resolved absolute path (actionable for the
      // operator); return a generic message so the public response body never
      // discloses a server filesystem path.
      this.logger.error(
        `Widget bundle not found at ${path}. Run "npm run build:widget".`,
      );
      throw new ServiceUnavailableException('Widget bundle unavailable');
    }
  }
}
