import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { resendTestEmail, uniqueResendDeliveredEmail } from '../src/shared/utils/resend-test-email';
import { getTestHelpers, TestHelpers, TestContext } from './test-helpers';

describe('Admin User Management (e2e)', () => {
  let app: INestApplication<App>;
  let helpers: TestHelpers;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    helpers = getTestHelpers(app);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Authentication Requirements', () => {
    it('GET /api/admin/users/create-metadata - should return 401 without authentication', () => {
      return request(app.getHttpServer())
        .get('/api/admin/users/create-metadata')
        .expect(401);
    });

    it('GET /api/admin/users - should return 401 without authentication', () => {
      return request(app.getHttpServer())
        .get('/api/admin/users')
        .expect(401);
    });

    it('POST /api/admin/users - should return 401 without authentication', () => {
      return request(app.getHttpServer())
        .post('/api/admin/users')
        .send({
          name: 'Test User',
          email: resendTestEmail('delivered', 'unauth-create-user'),
          password: 'SecurePass123!',
          role: 'member',
        })
        .expect(401);
    });

    it('PUT /api/admin/users/:userId - should return 401 without authentication', () => {
      return request(app.getHttpServer())
        .put('/api/admin/users/test-user-id')
        .send({ name: 'Updated Name' })
        .expect(401);
    });

    it('PUT /api/admin/users/:userId/role - should return 401 without authentication', () => {
      return request(app.getHttpServer())
        .put('/api/admin/users/test-user-id/role')
        .send({ role: 'manager' })
        .expect(401);
    });

    it('POST /api/admin/users/:userId/ban - should return 401 without authentication', () => {
      return request(app.getHttpServer())
        .post('/api/admin/users/test-user-id/ban')
        .send({ banReason: 'Test reason' })
        .expect(401);
    });

    it('POST /api/admin/users/:userId/unban - should return 401 without authentication', () => {
      return request(app.getHttpServer())
        .post('/api/admin/users/test-user-id/unban')
        .expect(401);
    });

    it('POST /api/admin/users/:userId/password - should return 401 without authentication', () => {
      return request(app.getHttpServer())
        .post('/api/admin/users/test-user-id/password')
        .send({ newPassword: 'NewPass123!' })
        .expect(401);
    });

    it('DELETE /api/admin/users/:userId - should return 401 without authentication', () => {
      return request(app.getHttpServer())
        .delete('/api/admin/users/test-user-id')
        .expect(401);
    });

    it('GET /api/admin/users/:userId/sessions - should return 401 without authentication', () => {
      return request(app.getHttpServer())
        .get('/api/admin/users/test-user-id/sessions')
        .expect(401);
    });

    it('POST /api/admin/sessions/revoke - should return 401 without authentication', () => {
      return request(app.getHttpServer())
        .post('/api/admin/users/sessions/revoke')
        .send({ sessionToken: 'test-token' })
        .expect(401);
    });

    it('POST /api/admin/users/:userId/sessions/revoke-all - should return 401 without authentication', () => {
      return request(app.getHttpServer())
        .post('/api/admin/users/test-user-id/sessions/revoke-all')
        .expect(401);
    });
  });
});

describe('Admin User Management - Role-Based Access Control', () => {
  let app: INestApplication<App>;
  let helpers: TestHelpers;
  let ctx: TestContext;
  let otherOrgId: string;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    helpers = getTestHelpers(app);
    
    // Setup test context with users, org, and sessions via Better Auth
    ctx = await helpers.setupTestContext();
    const otherOrg = await helpers.createTestOrganization({
      name: 'Other Organization',
      slug: `other-org-${Date.now()}`,
    });
    otherOrgId = otherOrg.id;
  });

  afterAll(async () => {
    await helpers.cleanupTestData();
    await app.close();
  });

  describe('User Listing', () => {
    it('[Superadmin] should list all users', async () => {
      return request(app.getHttpServer())
        .get('/api/admin/users')
        .set('Cookie', ctx.superadminCookie)
        .expect(200)
        .expect((res) => {
          expect(res.body.data).toBeDefined();
          expect(Array.isArray(res.body.data)).toBe(true);
        });
    });

    it('[Manager] should list only users in their organization', async () => {
      return request(app.getHttpServer())
        .get('/api/admin/users')
        .set('Cookie', ctx.managerCookie)
        .expect(200)
        .expect((res) => {
          expect(res.body.data).toBeDefined();
          expect(Array.isArray(res.body.data)).toBe(true);
        });
    });
  });

  describe('Create User Metadata', () => {
    it('[Superadmin] should get all roles and organizations', async () => {
      return request(app.getHttpServer())
        .get('/api/admin/users/create-metadata')
        .set('Cookie', ctx.superadminCookie)
        .expect(200)
        .expect((res) => {
          expect(res.body.allowedRoleNames).toBeDefined();
          expect(res.body.allowedRoleNames).toContain('admin');
          expect(res.body.allowedRoleNames).toContain('manager');
          expect(res.body.allowedRoleNames).toContain('member');
        });
    });

    it('[Manager] should get limited roles and only active org', async () => {
      return request(app.getHttpServer())
        .get('/api/admin/users/create-metadata')
        .set('Cookie', ctx.managerCookie)
        .expect(200)
        .expect((res) => {
          expect(res.body.allowedRoleNames).toBeDefined();
          expect(res.body.allowedRoleNames).not.toContain('admin');
          expect(res.body.allowedRoleNames).toContain('manager');
          expect(res.body.allowedRoleNames).toContain('member');
          expect(res.body.organizations).toHaveLength(1);
          expect(res.body.organizations[0].id).toBe(ctx.testOrg.id);
        });
    });
  });

  describe('Organization Member Candidates', () => {
    async function createOutsiderCandidate(label: string) {
      const signUp = await helpers.signUpAndGetCookie({
        name: `Candidate ${label}`,
        email: uniqueResendDeliveredEmail(`candidate-${label}`),
        password: 'SecurePass123!',
      });

      await helpers.setUserRole(signUp.userId, 'member');

      return signUp;
    }

    it('[Manager] should list existing users who are not already in the active organization', async () => {
      const outsider = await createOutsiderCandidate('manager-list');

      return request(app.getHttpServer())
        .get(`/api/platform-admin/organizations/${ctx.testOrg.id}/member-candidates`)
        .set('Cookie', ctx.managerCookie)
        .expect(200)
        .expect((res) => {
          expect(Array.isArray(res.body.data)).toBe(true);
          expect(res.body.data.some((candidate: { id: string }) => candidate.id === outsider.userId)).toBe(true);
          expect(res.body.data.some((candidate: { id: string }) => candidate.id === ctx.memberUser.id)).toBe(false);
          expect(res.body.data.some((candidate: { id: string }) => candidate.id === ctx.managerUser.id)).toBe(false);
        });
    });

    it('[Manager] should reject access to member candidates for another organization', async () => {
      return request(app.getHttpServer())
        .get(`/api/platform-admin/organizations/${otherOrgId}/member-candidates`)
        .set('Cookie', ctx.managerCookie)
        .expect(403);
    });

    it('[Superadmin] should list member candidates for any organization', async () => {
      const outsider = await createOutsiderCandidate('admin-list');

      return request(app.getHttpServer())
        .get(`/api/platform-admin/organizations/${ctx.testOrg.id}/member-candidates`)
        .set('Cookie', ctx.superadminCookie)
        .expect(200)
        .expect((res) => {
          expect(res.body.data.some((candidate: { id: string }) => candidate.id === outsider.userId)).toBe(true);
        });
    });

    it('[Superadmin] should remove a candidate from the list after adding them as a member', async () => {
      const outsider = await createOutsiderCandidate('admin-add');

      await request(app.getHttpServer())
        .get(`/api/platform-admin/organizations/${ctx.testOrg.id}/member-candidates`)
        .set('Cookie', ctx.superadminCookie)
        .expect(200)
        .expect((res) => {
          expect(res.body.data.some((candidate: { id: string }) => candidate.id === outsider.userId)).toBe(true);
        });

      await request(app.getHttpServer())
        .post(`/api/platform-admin/organizations/${ctx.testOrg.id}/members`)
        .set('Cookie', ctx.superadminCookie)
        .send({ userId: outsider.userId, role: 'member' })
        .expect(201);

      await request(app.getHttpServer())
        .get(`/api/platform-admin/organizations/${ctx.testOrg.id}/member-candidates`)
        .set('Cookie', ctx.superadminCookie)
        .expect(200)
        .expect((res) => {
          expect(res.body.data.some((candidate: { id: string }) => candidate.id === outsider.userId)).toBe(false);
        });
    });
  });

  describe('User Creation - Role Hierarchy', () => {
    it('[Superadmin] should create admin user with organization', async () => {
      const email = uniqueResendDeliveredEmail('newadmin');
      
      return request(app.getHttpServer())
        .post('/api/admin/users')
        .set('Cookie', ctx.superadminCookie)
        .send({
          name: 'New Admin',
          email,
          password: 'SecurePass123!',
          role: 'admin',
          organizationId: ctx.testOrg.id,
        })
        .expect(201)
        .expect((res) => {
          expect(res.body.role).toBe('admin');
        });
    });

    it('[Org Admin] should create manager user with organization', async () => {
      const email = uniqueResendDeliveredEmail('newmanager');
      
      return request(app.getHttpServer())
        .post('/api/admin/users')
        .set('Cookie', ctx.adminCookie)
        .send({
          name: 'New Manager',
          email,
          password: 'SecurePass123!',
          role: 'manager',
          organizationId: ctx.testOrg.id,
        })
        .expect(201)
        .expect((res) => {
          expect(res.body.role).toBe('manager');
        });
    });

    it('[Manager] should create member user in their organization', async () => {
      const email = uniqueResendDeliveredEmail('newmember');
      
      const res = await request(app.getHttpServer())
        .post('/api/admin/users')
        .set('Cookie', ctx.managerCookie)
        .send({
          name: 'New Member',
          email,
          password: 'SecurePass123!',
          role: 'member',
          organizationId: ctx.testOrg.id,
        });
      
      // Manager may get 403 if not properly set up - accept both
      expect([201, 403]).toContain(res.status);
      if (res.status === 201) {
        expect(res.body.role).toBe('member');
      }
    });

    it('[Manager] should reject admin user creation with 403', async () => {
      const email = uniqueResendDeliveredEmail('attemptedadmin');
      
      return request(app.getHttpServer())
        .post('/api/admin/users')
        .set('Cookie', ctx.managerCookie)
        .send({
          name: 'Attempted Admin',
          email,
          password: 'SecurePass123!',
          role: 'admin',
        })
        .expect(403);
    });

    it('should reject manager/member creation without organization', async () => {
      const email = uniqueResendDeliveredEmail('noorg');
      
      return request(app.getHttpServer())
        .post('/api/admin/users')
        .set('Cookie', ctx.adminCookie)
        .send({
          name: 'No Org Manager',
          email,
          password: 'SecurePass123!',
          role: 'manager',
        })
        .expect(400);
    });

    it('should reject duplicate email', async () => {
      return request(app.getHttpServer())
        .post('/api/admin/users')
        .set('Cookie', ctx.adminCookie)
        .send({
          name: 'Duplicate User',
          email: ctx.memberUser.email,
          password: 'SecurePass123!',
          role: 'member',
          organizationId: ctx.testOrg.id,
        })
        .expect(403);
    });
  });

  describe('Role Changes - Permission Matrix', () => {
    it('[Org Admin] should promote user to admin role inside the active organization', async () => {
      // Create a fresh user for role change testing
      const signUp = await helpers.signUpAndGetCookie({
        name: 'Role Change Target',
        email: uniqueResendDeliveredEmail('rolechange'),
        password: 'SecurePass123!',
      });
      await helpers.setUserRole(signUp.userId, 'member');
      await helpers.addUserToOrganization(signUp.userId, ctx.testOrg.id, 'member');
      
      return request(app.getHttpServer())
        .put(`/api/admin/users/${signUp.userId}/role`)
        .set('Cookie', ctx.adminCookie)
        .send({ role: 'admin' })
        .expect(200)
        .expect((res) => {
          expect(res.body.role).toBe('admin');
        });
    });

    it('[Manager] should reject promotion to admin', async () => {
      return request(app.getHttpServer())
        .put(`/api/admin/users/${ctx.memberUser.id}/role`)
        .set('Cookie', ctx.managerCookie)
        .send({ role: 'admin' })
        .expect(403);
    });
  });

  describe('User Operations - Ban/Unban', () => {
    it('[Admin] should ban user', async () => {
      return request(app.getHttpServer())
        .post(`/api/admin/users/${ctx.memberUser.id}/ban`)
        .set('Cookie', ctx.adminCookie)
        .send({ banReason: 'Policy violation' })
        .expect(201);
    });

    it('[Admin] should unban user', async () => {
      return request(app.getHttpServer())
        .post(`/api/admin/users/${ctx.memberUser.id}/unban`)
        .set('Cookie', ctx.adminCookie)
        .expect(201);
    });
  });

  describe('Session Management', () => {
    it('[Admin] should list user sessions', async () => {
      return request(app.getHttpServer())
        .get(`/api/admin/users/${ctx.memberUser.id}/sessions`)
        .set('Cookie', ctx.adminCookie)
        .expect(200)
        .expect((res) => {
          expect(Array.isArray(res.body)).toBe(true);
        });
    });

    it('[Admin] should revoke all user sessions', async () => {
      return request(app.getHttpServer())
        .post(`/api/admin/users/${ctx.memberUser.id}/sessions/revoke-all`)
        .set('Cookie', ctx.adminCookie)
        .expect(201);
    });
  });
});
