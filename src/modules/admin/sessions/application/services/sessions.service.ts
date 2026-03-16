import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import {
  type ISessionRepository,
  SESSION_REPOSITORY,
} from '../../domain/repositories/session.repository.interface';
import type { PlatformRole } from '../../../users/utils/admin.utils';

@Injectable()
export class SessionsService {
  constructor(
    @Inject(SESSION_REPOSITORY) private readonly sessionRepo: ISessionRepository,
  ) {}

  private async assertUserInManagerOrg(userId: string, activeOrganizationId: string): Promise<void> {
    const member = await this.sessionRepo.findMemberInOrg(userId, activeOrganizationId);
    if (!member) throw new ForbiddenException('User is not in your organization');
  }

  async listUserSessions(params: {
    userId: string;
    platformRole: PlatformRole;
    activeOrganizationId: string | null;
  }) {
    const { userId, platformRole, activeOrganizationId } = params;

    if (platformRole !== 'superadmin') {
      if (!activeOrganizationId) throw new ForbiddenException('Active organization required');
      await this.assertUserInManagerOrg(userId, activeOrganizationId);
    }
    return this.sessionRepo.listUserSessions(userId);
  }

  async revokeSession(
    input: { sessionToken: string },
    platformRole: PlatformRole,
    activeOrganizationId: string | null,
  ) {
    if (platformRole !== 'superadmin') {
      if (!activeOrganizationId) throw new ForbiddenException('Active organization required');
      const session = await this.sessionRepo.findSessionByToken(input.sessionToken);
      if (!session) return { success: true };
      await this.assertUserInManagerOrg(session.userId, activeOrganizationId);
    }
    await this.sessionRepo.revokeSession(input.sessionToken);
    return { success: true };
  }

  async revokeAllSessions(
    input: { userId: string },
    platformRole: PlatformRole,
    activeOrganizationId: string | null,
  ) {
    if (platformRole !== 'superadmin') {
      if (!activeOrganizationId) throw new ForbiddenException('Active organization required');
      await this.assertUserInManagerOrg(input.userId, activeOrganizationId);
    }
    await this.sessionRepo.revokeAllSessions(input.userId);
    return { success: true };
  }
}
