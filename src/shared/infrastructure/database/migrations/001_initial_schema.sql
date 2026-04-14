-- ============================================================================
-- Initial Schema Migration for NestJS API Starter
-- ============================================================================
-- This migration creates all required tables for a fresh installation.
-- 
-- Tables created:
-- 1. Better Auth Core: user, session, account, verification
-- 2. Better Auth Organization: organization, member, invitation
-- 3. Better Auth Admin: jwks
-- 4. RBAC: roles, permissions, role_permissions
--
-- Run with: psql -d your_database -f 001_initial_schema.sql
-- ============================================================================

-- ============================================================================
-- BETTER AUTH CORE TABLES
-- ============================================================================

-- User table
CREATE TABLE IF NOT EXISTS "user" (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    image TEXT,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    role TEXT DEFAULT 'member',
    banned BOOLEAN DEFAULT false,
    "banReason" TEXT,
    "banExpires" TIMESTAMP WITH TIME ZONE
);

-- Session table
CREATE TABLE IF NOT EXISTS session (
    id TEXT PRIMARY KEY,
    "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    token TEXT NOT NULL UNIQUE,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    "impersonatedBy" TEXT,
    "activeOrganizationId" TEXT
);

-- Account table (for OAuth providers)
CREATE TABLE IF NOT EXISTS account (
    id TEXT PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP WITH TIME ZONE,
    "refreshTokenExpiresAt" TIMESTAMP WITH TIME ZONE,
    scope TEXT,
    password TEXT,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Verification table (for email verification, password reset tokens)
CREATE TABLE IF NOT EXISTS verification (
    id TEXT PRIMARY KEY,
    identifier TEXT NOT NULL,
    value TEXT NOT NULL,
    "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- JWKS table (for JWT key storage)
CREATE TABLE IF NOT EXISTS jwks (
    id TEXT PRIMARY KEY,
    "publicKey" TEXT NOT NULL,
    "privateKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- BETTER AUTH ORGANIZATION TABLES
-- ============================================================================

-- Organization table
CREATE TABLE IF NOT EXISTS organization (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    logo TEXT,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    metadata TEXT
);

-- Member table (organization membership)
CREATE TABLE IF NOT EXISTS member (
    id TEXT PRIMARY KEY,
    "organizationId" TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
    "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member',
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Invitation table
CREATE TABLE IF NOT EXISTS invitation (
    id TEXT PRIMARY KEY,
    "organizationId" TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    status TEXT NOT NULL DEFAULT 'pending',
    "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "inviterId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- RBAC TABLES
-- ============================================================================

-- Roles table
CREATE TABLE IF NOT EXISTS roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(50) UNIQUE NOT NULL,
    display_name VARCHAR(100) NOT NULL,
    description TEXT,
    color VARCHAR(20) DEFAULT 'gray',
    is_system BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Permissions table
CREATE TABLE IF NOT EXISTS permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    resource VARCHAR(50) NOT NULL,
    action VARCHAR(50) NOT NULL,
    description TEXT,
    UNIQUE(resource, action)
);

-- Role-Permission junction table
CREATE TABLE IF NOT EXISTS role_permissions (
    role_id UUID REFERENCES roles(id) ON DELETE CASCADE,
    permission_id UUID REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS "user_email_idx" ON "user"(email);
CREATE INDEX IF NOT EXISTS "session_userId_idx" ON session("userId");
CREATE INDEX IF NOT EXISTS "session_token_idx" ON session(token);
CREATE INDEX IF NOT EXISTS "account_userId_idx" ON account("userId");
CREATE INDEX IF NOT EXISTS "member_userId_idx" ON member("userId");
CREATE INDEX IF NOT EXISTS "member_organizationId_idx" ON member("organizationId");
CREATE INDEX IF NOT EXISTS "invitation_organizationId_idx" ON invitation("organizationId");
CREATE INDEX IF NOT EXISTS "invitation_email_idx" ON invitation(email);

-- ============================================================================
-- SEED DATA: Unified Role Model (Admin, Manager, Member)
-- ============================================================================

-- Insert default permissions
INSERT INTO permissions (resource, action, description) VALUES
    -- User permissions
    ('user', 'create', 'Create new users'),
    ('user', 'read', 'View user details'),
    ('user', 'update', 'Update user information'),
    ('user', 'delete', 'Delete users'),
    ('user', 'ban', 'Ban/unban users'),
    ('user', 'impersonate', 'Impersonate users'),
    ('user', 'set-role', 'Change user roles'),
    ('user', 'set-password', 'Reset user passwords'),
    -- Session permissions
    ('session', 'read', 'View sessions'),
    ('session', 'revoke', 'Revoke sessions'),
    -- Organization permissions
    ('organization', 'create', 'Create organizations'),
    ('organization', 'read', 'View organizations'),
    ('organization', 'update', 'Update organizations'),
    ('organization', 'delete', 'Delete organizations'),
    ('organization', 'invite', 'Invite members'),
    -- Role permissions
    ('role', 'create', 'Create roles'),
    ('role', 'read', 'View roles'),
    ('role', 'update', 'Update roles'),
    ('role', 'delete', 'Delete roles'),
    ('role', 'assign', 'Assign permissions to roles')
ON CONFLICT (resource, action) DO NOTHING;

-- Insert unified roles
INSERT INTO roles (name, display_name, description, color, is_system) VALUES
    ('admin', 'Admin', 'Global platform administrator with full access to all organizations and settings', 'red', true),
    ('manager', 'Manager', 'Organization manager with full access within their assigned organization', 'blue', true),
    ('member', 'Member', 'Organization member with basic access within their assigned organization', 'gray', true)
ON CONFLICT (name) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    description = EXCLUDED.description,
    color = EXCLUDED.color,
    is_system = EXCLUDED.is_system;

-- Assign ALL permissions to admin role
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'admin'
ON CONFLICT DO NOTHING;

-- Assign manager permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'manager'
AND (
    (p.resource = 'user' AND p.action IN ('read', 'update', 'ban'))
    OR (p.resource = 'session' AND p.action IN ('read', 'revoke'))
    OR (p.resource = 'organization' AND p.action IN ('read', 'update', 'invite'))
    OR (p.resource = 'role' AND p.action = 'read')
)
ON CONFLICT DO NOTHING;

-- Assign member permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'member'
AND (
    (p.resource = 'user' AND p.action = 'read')
    OR (p.resource = 'organization' AND p.action = 'read')
    OR (p.resource = 'role' AND p.action = 'read')
)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

SELECT 'Schema created successfully!' AS status;
SELECT 'Tables:' AS info, COUNT(*) AS count FROM information_schema.tables WHERE table_schema = 'public';
SELECT 'Roles:' AS info, COUNT(*) AS count FROM roles;
SELECT 'Permissions:' AS info, COUNT(*) AS count FROM permissions;
