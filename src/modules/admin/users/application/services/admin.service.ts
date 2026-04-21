import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { hashPassword } from 'better-auth/crypto';
import { EmailService } from '../../../../../shared/email/email.service';
import { ConfigService } from '../../../../../shared/config/config.service';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import {
  type PlatformRole,
  getAllowedRoleNamesForCreator,
  requireActiveOrganizationIdForManager,
} from '../../utils/admin.utils';
import {
  buildVerificationToken,
  buildVerificationUrl,
} from '../../utils/verification.utils';
import {
  type IAdminUserRepository,
  ADMIN_USER_REPOSITORY,
} from '../../domain/repositories/admin-user.repository.interface';

const logger = new Logger('AdminService');

export type CreateUserInput = {
  name: string;
  email: string;
  password: string;
  role: 'admin' | 'manager' | 'member';
  organizationId?: string;
};

@Injectable()
export class AdminService {
  constructor(
    @Inject(ADMIN_USER_REPOSITORY)
    private readonly userRepo: IAdminUserRepository,
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
  ) {}

  private isSuperadmin(platformRole: PlatformRole): boolean {
    return platformRole === 'superadmin';
  }

  private async getTargetRole(
    userId: string,
  ): Promise<'admin' | 'manager' | 'member' | null> {
    const role = await this.userRepo.findUserRole(userId);
    if (!role) return null;
    if (role === 'admin' || role === 'manager' || role === 'member')
      return role;
    return 'member';
  }

  private async assertTargetActionAllowed(params: {
    actorUserId?: string;
    targetUserId: string;
    platformRole: PlatformRole;
    allowSelf: boolean;
  }): Promise<void> {
    const { actorUserId, targetUserId, platformRole, allowSelf } = params;

    if (!actorUserId) {
      return;
    }

    if (actorUserId === targetUserId) {
      if (!allowSelf) {
        throw new ForbiddenException(
          'You cannot perform this action on yourself',
        );
      }
      return;
    }

    const targetRole = await this.getTargetRole(targetUserId);
    if (!targetRole) {
      throw new ForbiddenException('Target user not found');
    }

    if (this.isSuperadmin(platformRole)) {
      return;
    }

    if (targetRole !== 'member') {
      throw new ForbiddenException(
        'Organization-scoped actors can only perform this action on members',
      );
    }
  }

  private async assertUserInManagerOrg(
    userId: string,
    activeOrganizationId: string,
  ): Promise<void> {
    const member = await this.userRepo.findMemberInOrg(
      userId,
      activeOrganizationId,
    );
    if (!member)
      throw new ForbiddenException('User is not in your organization');
  }

  /**
   * Combined authorization check: verifies the actor can perform the action
   * on the target user, and that org-scoped actors have the target in their org.
   */
  private async assertCanActOnUser(params: {
    targetUserId: string;
    platformRole: PlatformRole;
    activeOrganizationId: string | null;
    actorUserId?: string;
    allowSelf: boolean;
  }): Promise<void> {
    const {
      targetUserId,
      platformRole,
      activeOrganizationId,
      actorUserId,
      allowSelf,
    } = params;

    await this.assertTargetActionAllowed({
      actorUserId,
      targetUserId,
      platformRole,
      allowSelf,
    });

    if (!this.isSuperadmin(platformRole)) {
      if (!activeOrganizationId)
        throw new ForbiddenException('Active organization required');
      await this.assertUserInManagerOrg(targetUserId, activeOrganizationId);
    }
  }

  private async resolveRoleAssignmentOrganizationId(params: {
    targetUserId: string;
    platformRole: PlatformRole;
    activeOrganizationId: string | null;
  }): Promise<string | null> {
    const { targetUserId, platformRole, activeOrganizationId } = params;
    if (activeOrganizationId) return activeOrganizationId;
    if (!this.isSuperadmin(platformRole)) return null;
    const member = await this.userRepo.findUserOrganization(targetUserId);
    return member?.organizationId ?? null;
  }

  async getCreateUserMetadata(
    platformRole: PlatformRole,
    activeOrganizationId: string | null,
  ) {
    const roles = await this.userRepo.listRoles();
    const allowedRoleNames = getAllowedRoleNamesForCreator(platformRole);

    let organizations: Array<{ id: string; name: string; slug: string }> = [];
    if (this.isSuperadmin(platformRole)) {
      organizations = await this.userRepo.listOrganizations();
    } else {
      if (!activeOrganizationId)
        throw new ForbiddenException('Active organization required');
      const org =
        await this.userRepo.findOrganizationById(activeOrganizationId);
      organizations = org ? [org] : [];
    }

    return {
      roles: roles.map((r) => ({
        name: r.name,
        displayName: r.display_name,
        description: r.description ?? undefined,
        color: r.color ?? undefined,
        isDefault: r.is_default,
      })),
      allowedRoleNames,
      organizations,
    };
  }

  async updateUser(
    input: { userId: string; name?: string },
    platformRole: PlatformRole,
    activeOrganizationId: string | null,
    actorUserId?: string,
  ) {
    await this.assertCanActOnUser({
      targetUserId: input.userId,
      platformRole,
      activeOrganizationId,
      actorUserId,
      allowSelf: true,
    });

    if (input.name === undefined)
      throw new ForbiddenException('No data to update');
    return this.userRepo.updateUser(input.userId, { name: input.name });
  }

  async setUserRole(
    input: { userId: string; role: 'admin' | 'manager' | 'member' },
    platformRole: PlatformRole,
    activeOrganizationId: string | null,
    actorUserId?: string,
  ) {
    await this.assertCanActOnUser({
      targetUserId: input.userId,
      platformRole,
      activeOrganizationId,
      actorUserId,
      allowSelf: false,
    });

    const allowed = getAllowedRoleNamesForCreator(platformRole);
    if (!allowed.includes(input.role)) {
      throw new ForbiddenException('Role not allowed');
    }

    const organizationIdForRole =
      (await this.resolveRoleAssignmentOrganizationId({
        targetUserId: input.userId,
        platformRole,
        activeOrganizationId,
      })) ?? undefined;

    if (!organizationIdForRole) {
      throw new BadRequestException(
        'Organization is required for role assignments',
      );
    }

    return this.userRepo.setUserRole({
      userId: input.userId,
      role: input.role,
      organizationId: organizationIdForRole,
      newMemberId: randomUUID(),
    });
  }

  async banUser(
    input: { userId: string; banReason?: string },
    platformRole: PlatformRole,
    activeOrganizationId: string | null,
    actorUserId?: string,
  ) {
    await this.assertCanActOnUser({
      targetUserId: input.userId,
      platformRole,
      activeOrganizationId,
      actorUserId,
      allowSelf: false,
    });

    await this.userRepo.banUser(input.userId, input.banReason);
    return { success: true };
  }

  async unbanUser(
    input: { userId: string },
    platformRole: PlatformRole,
    activeOrganizationId: string | null,
    actorUserId?: string,
  ) {
    await this.assertCanActOnUser({
      targetUserId: input.userId,
      platformRole,
      activeOrganizationId,
      actorUserId,
      allowSelf: false,
    });

    await this.userRepo.unbanUser(input.userId);
    return { success: true };
  }

  async setUserPassword(
    input: { userId: string; newPassword: string },
    platformRole: PlatformRole,
    activeOrganizationId: string | null,
    actorUserId?: string,
  ) {
    await this.assertCanActOnUser({
      targetUserId: input.userId,
      platformRole,
      activeOrganizationId,
      actorUserId,
      allowSelf: true,
    });

    const hashed = await hashPassword(input.newPassword);
    await this.userRepo.setUserPassword(input.userId, hashed);
    return { status: true };
  }

  async removeUser(
    input: { userId: string },
    platformRole: PlatformRole,
    activeOrganizationId: string | null,
    actorUserId?: string,
  ) {
    await this.assertCanActOnUser({
      targetUserId: input.userId,
      platformRole,
      activeOrganizationId,
      actorUserId,
      allowSelf: false,
    });

    await this.userRepo.removeUser(input.userId);
    return { success: true };
  }

  async removeUsers(
    input: { userIds: string[] },
    platformRole: PlatformRole,
    activeOrganizationId: string | null,
    actorUserId?: string,
  ) {
    if (input.userIds.length === 0) return { success: true, deletedCount: 0 };

    if (!this.isSuperadmin(platformRole)) {
      if (!activeOrganizationId)
        throw new ForbiddenException('Active organization required');
      for (const userId of input.userIds) {
        await this.assertTargetActionAllowed({
          actorUserId,
          targetUserId: userId,
          platformRole,
          allowSelf: false,
        });
        await this.assertUserInManagerOrg(userId, activeOrganizationId);
      }
    } else {
      for (const userId of input.userIds) {
        await this.assertTargetActionAllowed({
          actorUserId,
          targetUserId: userId,
          platformRole,
          allowSelf: false,
        });
      }
    }

    const deletedCount = await this.userRepo.removeUsers(input.userIds);
    return { success: true, deletedCount };
  }

  async listUsers(params: {
    limit: number;
    offset: number;
    searchValue?: string;
    organizationId?: string;
    activeOrganizationId: string | null;
    platformRole: PlatformRole;
  }) {
    const {
      limit,
      offset,
      searchValue,
      organizationId,
      platformRole,
      activeOrganizationId,
    } = params;
    if (!this.isSuperadmin(platformRole) && !activeOrganizationId) {
      throw new ForbiddenException('Active organization required');
    }
    const result = await this.userRepo.listUsers({
      limit,
      offset,
      searchValue,
      organizationId: this.isSuperadmin(platformRole)
        ? (organizationId ?? null)
        : undefined,
      activeOrganizationId,
      platformRole,
    });
    return { ...result, limit, offset };
  }

  async findUserById(userId: string) {
    return this.userRepo.findUserById(userId);
  }

  async hasAcceptedInvitation(email: string): Promise<boolean> {
    const invitation = await this.userRepo.findAcceptedInvitationByEmail(email);
    return !!invitation;
  }

  async autoApproveUser(userId: string): Promise<void> {
    await this.userRepo.approveUser(userId);
  }

  async approveUser(
    input: { userId: string },
    platformRole: PlatformRole,
    activeOrganizationId: string | null,
    actorUserId?: string,
  ) {
    await this.assertCanActOnUser({
      targetUserId: input.userId,
      platformRole,
      activeOrganizationId,
      actorUserId,
      allowSelf: false,
    });

    await this.userRepo.approveUser(input.userId);

    const user = await this.userRepo.findUserById(input.userId);
    if (user) {
      try {
        await this.emailService.sendApprovalNotification({
          user: { id: user.id, email: user.email, name: user.name },
        });
      } catch (error) {
        logger.error(
          `Failed to send approval email for userId: ${input.userId}`,
          error,
        );
      }
    }

    return { success: true };
  }

  async rejectUser(
    input: { userId: string; rejectionReason?: string },
    platformRole: PlatformRole,
    activeOrganizationId: string | null,
    actorUserId?: string,
  ) {
    await this.assertCanActOnUser({
      targetUserId: input.userId,
      platformRole,
      activeOrganizationId,
      actorUserId,
      allowSelf: false,
    });

    await this.userRepo.rejectUser(input.userId, input.rejectionReason);

    const user = await this.userRepo.findUserById(input.userId);
    if (user) {
      try {
        await this.emailService.sendRejectionNotification({
          user: { id: user.id, email: user.email, name: user.name },
          reason: input.rejectionReason,
        });
      } catch (error) {
        logger.error(
          `Failed to send rejection email for userId: ${input.userId}`,
          error,
        );
      }
    }

    return { success: true };
  }

  async listPendingUsers(params: {
    limit: number;
    offset: number;
    searchValue?: string;
    activeOrganizationId: string | null;
    platformRole: PlatformRole;
  }) {
    const { limit, offset, searchValue, platformRole, activeOrganizationId } =
      params;
    if (!this.isSuperadmin(platformRole) && !activeOrganizationId) {
      throw new ForbiddenException('Active organization required');
    }
    const result = await this.userRepo.listPendingUsers({
      limit,
      offset,
      searchValue,
      activeOrganizationId,
      platformRole,
    });
    return { ...result, limit, offset };
  }

  async getUserCapabilities(params: {
    actorUserId: string;
    targetUserId: string;
    platformRole: PlatformRole;
    activeOrganizationId: string | null;
  }) {
    const { actorUserId, targetUserId, platformRole, activeOrganizationId } =
      params;

    const targetRole = await this.getTargetRole(targetUserId);
    if (!targetRole) throw new ForbiddenException('Target user not found');

    const isSelf = actorUserId === targetUserId;
    const isTargetMember = targetRole === 'member';

    let isTargetInActiveOrganization = true;
    if (!this.isSuperadmin(platformRole)) {
      if (!activeOrganizationId) {
        isTargetInActiveOrganization = false;
      } else {
        const member = await this.userRepo.findMemberInOrg(
          targetUserId,
          activeOrganizationId,
        );
        isTargetInActiveOrganization = !!member;
      }
    }

    const canSelfSafeAction =
      isSelf &&
      (this.isSuperadmin(platformRole) || isTargetInActiveOrganization);

    const canMutateNonSelf =
      !isSelf &&
      (this.isSuperadmin(platformRole) ||
        (isTargetMember && isTargetInActiveOrganization));

    return {
      targetUserId,
      targetRole,
      isSelf,
      actions: {
        update: canSelfSafeAction || canMutateNonSelf,
        setRole: canMutateNonSelf,
        ban: canMutateNonSelf,
        unban: canMutateNonSelf,
        setPassword: canSelfSafeAction || canMutateNonSelf,
        remove: canMutateNonSelf,
        revokeSessions: canMutateNonSelf,
        impersonate: canMutateNonSelf,
        approve: canMutateNonSelf,
        reject: canMutateNonSelf,
      },
    };
  }

  async getBatchCapabilities(params: {
    actorUserId: string;
    userIds: string[];
    platformRole: PlatformRole;
    activeOrganizationId: string | null;
  }): Promise<
    Record<string, Awaited<ReturnType<AdminService['getUserCapabilities']>>>
  > {
    const { actorUserId, userIds, platformRole, activeOrganizationId } = params;

    if (userIds.length === 0) return {};

    const settled = await Promise.allSettled(
      userIds.map((targetUserId) =>
        this.getUserCapabilities({
          actorUserId,
          targetUserId,
          platformRole,
          activeOrganizationId,
        }),
      ),
    );

    const result: Record<
      string,
      Awaited<ReturnType<AdminService['getUserCapabilities']>>
    > = {};
    for (let i = 0; i < userIds.length; i++) {
      const outcome = settled[i];
      if (outcome.status === 'fulfilled') {
        result[userIds[i]] = outcome.value;
      }
    }
    return result;
  }

  async createUser(
    input: CreateUserInput,
    platformRole: PlatformRole,
    activeOrganizationId: string | null,
  ) {
    const allowed = getAllowedRoleNamesForCreator(platformRole);
    if (!allowed.includes(input.role)) {
      throw new ForbiddenException('Role not allowed');
    }

    const enforcedActiveOrgId = requireActiveOrganizationIdForManager(
      platformRole,
      {
        session: { activeOrganizationId: activeOrganizationId ?? undefined },
      } as unknown as UserSession,
    );

    const organizationIdToUse = input.organizationId;

    if (!organizationIdToUse) {
      throw new ForbiddenException(
        'Organization is required for org-scoped users',
      );
    }
    if (
      !this.isSuperadmin(platformRole) &&
      enforcedActiveOrgId &&
      organizationIdToUse !== enforcedActiveOrgId
    ) {
      throw new ForbiddenException(
        'Organization-scoped actors can only assign users to their active organization',
      );
    }

    const userId = randomUUID();
    const accountId = randomUUID();
    const hashed = await hashPassword(input.password);

    const created = await this.userRepo.createUser({
      userId,
      accountId,
      name: input.name,
      email: input.email,
      hashedPassword: hashed,
      role: input.role,
      organizationId: organizationIdToUse ?? undefined,
    });

    try {
      const verificationToken = await buildVerificationToken(
        input.email,
        this.configService.getAuthSecret(),
      );
      const verificationUrl = buildVerificationUrl(
        verificationToken,
        this.configService.getBaseUrl(),
        this.configService.getFeUrl(),
      );

      logger.log(`Sending verification email to userId: ${userId}`);
      await this.emailService.sendEmailVerification({
        user: { id: userId, email: input.email, name: input.name },
        url: verificationUrl,
        token: verificationToken,
      });
      logger.log(`Verification email sent successfully for userId: ${userId}`);
    } catch (error) {
      logger.error(
        `Failed to send verification email for userId: ${userId}`,
        error,
      );
    }

    return created;
  }
}
