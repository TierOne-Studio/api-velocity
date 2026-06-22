/**
 * The org/project scope an anonymous public request runs under, resolved SOLELY
 * from the embed site (never from client input). Attached to the request by
 * PublicEmbedGuard and read by the controller/service. SPEC-003 §5.
 */
export interface EmbedScope {
  organizationId: string;
  projectId: string;
  embedSiteId: string;
}

/** Express request augmented with the resolved embed scope. */
export type RequestWithEmbedScope = { embedScope?: EmbedScope };
