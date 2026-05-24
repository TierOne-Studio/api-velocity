export interface OrgRawRow {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  metadata: string | null;
  createdAt: Date;
}

export interface OrgWithCountRow extends OrgRawRow {
  member_count: string;
}

export interface OrgBasicRow {
  id: string;
  name: string;
  slug: string;
}

export interface MemberWithUserRow {
  id: string;
  userId: string;
  role: string;
  createdAt: Date;
  user_name: string;
  user_email: string;
  user_image: string | null;
}

export interface MemberCandidateRow {
  id: string;
  name: string;
  email: string;
  role: string;
  image: string | null;
}

export interface MemberRow {
  id: string;
  organizationId: string;
  userId: string;
  role: string;
  createdAt: Date;
}

export interface MemberBasicRow {
  id: string;
  role: string;
  userId: string;
}

export interface InvitationRow {
  id: string;
  organizationId: string;
  email: string;
  role: string;
  status: string;
  expiresAt: Date;
  inviterId: string;
  createdAt: Date;
}

export interface RoleRow {
  name: string;
  display_name: string;
  description: string | null;
  color: string | null;
  is_default: boolean;
}

export interface CreateOrgParams {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  metadataJson: string | null;
  actorId: string;
  actorRole?: string;
  memberId?: string;
}

export interface UpdateOrgFields {
  name?: string;
  slug?: string;
  logo?: string | null;
  metadataJson?: string | null;
}

export const ADMIN_ORG_REPOSITORY = 'ADMIN_ORG_REPOSITORY';

export interface IAdminOrgRepository {
  // Organization
  findAll(
    search?: string,
    limit?: number,
    offset?: number,
  ): Promise<OrgWithCountRow[]>;
  countAll(search?: string): Promise<number>;
  findAllForUser(
    userId: string,
    search?: string,
    limit?: number,
    offset?: number,
  ): Promise<OrgWithCountRow[]>;
  countAllForUser(userId: string, search?: string): Promise<number>;
  canUserReadOrganization(
    userId: string,
    organizationId: string,
  ): Promise<boolean>;
  findById(id: string): Promise<OrgWithCountRow | null>;
  findBasicById(id: string): Promise<OrgBasicRow | null>;
  findBySlug(slug: string): Promise<{ id: string } | null>;
  createOrg(params: CreateOrgParams): Promise<void>;
  updateOrg(id: string, updates: UpdateOrgFields): Promise<OrgRawRow | null>;
  deleteOrg(id: string): Promise<void>;

  // Members
  getMembers(organizationId: string): Promise<MemberWithUserRow[]>;
  listMemberCandidates(
    organizationId: string,
    params?: { search?: string; limit?: number },
  ): Promise<MemberCandidateRow[]>;
  findMemberById(
    memberId: string,
    organizationId: string,
  ): Promise<MemberBasicRow | null>;
  findMemberByUserId(
    userId: string,
    organizationId: string,
  ): Promise<{ id: string } | null>;
  findMemberByEmail(
    organizationId: string,
    email: string,
  ): Promise<{ id: string } | null>;
  countMembersWithManageCapability(organizationId: string): Promise<number>;
  roleGrantsManagePermission(
    roleName: string,
    organizationId: string,
  ): Promise<boolean>;
  addMember(
    id: string,
    organizationId: string,
    userId: string,
    role: string,
  ): Promise<MemberRow>;
  updateMemberRole(
    memberId: string,
    organizationId: string,
    role: string,
  ): Promise<MemberRow | null>;
  removeMember(memberId: string, organizationId: string): Promise<boolean>;
  findUserById(
    userId: string,
  ): Promise<{ id: string; role?: string | null } | null>;

  // Invitations
  findPendingInvitation(
    organizationId: string,
    email: string,
  ): Promise<{ id: string } | null>;
  findInvitationById(invitationId: string): Promise<{ id: string } | null>;
  createInvitation(
    id: string,
    organizationId: string,
    email: string,
    role: string,
    expiresAt: Date,
    inviterId: string,
  ): Promise<InvitationRow>;
  getInvitations(organizationId: string): Promise<InvitationRow[]>;
  deleteInvitation(
    invitationId: string,
    organizationId: string,
  ): Promise<boolean>;

  // Roles
  getRoles(organizationId: string | null): Promise<RoleRow[]>;

  // Airweave collection ownership (per ADR-011)
  //
  // The allowlist `organization.metadata.allowedAirweaveCollectionIds: string[]`
  // is mutated field-locally via `jsonb_set` to avoid stomping concurrent
  // writes to other `metadata` fields (the existing `updateOrg` path is a
  // full-overwrite of the JSON blob). All three methods are idempotent.
  addAirweaveCollectionToAllowlist(
    organizationId: string,
    collectionReadableId: string,
  ): Promise<void>;
  removeAirweaveCollectionFromAllowlist(
    organizationId: string,
    collectionReadableId: string,
  ): Promise<void>;
  isAirweaveCollectionInAllowlist(
    organizationId: string,
    collectionReadableId: string,
  ): Promise<boolean>;
}
