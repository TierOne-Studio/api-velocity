/**
 * Request/response shapes for the embed-sites admin API (SPEC-003 §9.4).
 * Plain TypeScript types — no class-validator / ValidationPipe (ADR-005);
 * runtime validation is done manually in the service.
 */

export interface CreateEmbedSiteInput {
  name: string;
  projectId: string;
  allowedOrigins: string[];
  theme?: Record<string, unknown> | null;
}

export interface UpdateEmbedSiteInput {
  name?: string;
  allowedOrigins?: string[];
  enabled?: boolean;
  theme?: Record<string, unknown> | null;
}

/**
 * Admin response shape. Includes the publishable `publicKey` (an identifier, not
 * a secret — SPEC-003 §9.1); deliberately omits `organizationId` (the caller
 * already knows their org; §9.4).
 */
export interface EmbedSiteSummary {
  id: string;
  name: string;
  projectId: string;
  publicKey: string;
  allowedOrigins: string[];
  enabled: boolean;
  theme: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}
