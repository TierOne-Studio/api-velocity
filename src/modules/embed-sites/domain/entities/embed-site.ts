/**
 * Domain shape of an embed site (service-layer type). Pure TypeScript — no ORM
 * decorators, no NestJS runtime imports (clean-architecture dependency rule).
 *
 * An embed site is org-owned and bound 1:1 to a project. Its `publicKey` is a
 * publishable identifier (not a secret); security comes from `allowedOrigins`
 * plus server-side scoping. See SPEC-003 and ADR-018.
 */
export interface EmbedSite {
  id: string;
  organizationId: string;
  projectId: string;
  name: string;
  publicKey: string;
  allowedOrigins: string[];
  enabled: boolean;
  theme: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}
