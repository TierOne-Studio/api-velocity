import { jest } from '@jest/globals';

jest.mock('@thallesp/nestjs-better-auth', () => ({
  Session: () => () => {},
  AllowAnonymous: () => () => {},
  BetterAuthGuard: class {},
  BetterAuthModule: { forRoot: jest.fn(() => ({ module: class {} })) },
}));

jest.mock('better-auth/crypto', () => ({
  hashPassword: jest.fn(async (p: string) => `hashed:${p}`),
  verifyPassword: jest.fn(async () => true),
}));

jest.mock('jose', () => ({
  SignJWT: jest.fn().mockImplementation(() => ({
    setProtectedHeader: jest.fn().mockReturnThis(),
    setIssuedAt: jest.fn().mockReturnThis(),
    setExpirationTime: jest.fn().mockReturnThis(),
    sign: jest.fn(async () => 'mock.jwt.token'),
  })),
  importPKCS8: jest.fn(async () => ({})),
  importSPKI: jest.fn(async () => ({})),
  jwtVerify: jest.fn(async () => ({ payload: {} })),
}));

import { Test, TestingModule } from '@nestjs/testing';
import { AdminOrganizationsService } from '../../../admin';
import { ProjectsService } from '../../../projects/application/services/projects.service';
import type { ConversationRow, MessageRow } from '../../api/dto/chat.dto';
import {
  CHAT_REPOSITORY,
  type IChatRepository,
} from '../../domain/repositories/chat.repository.interface';
import { ChatAgentService } from './chat-agent.service';
import { ChatService } from './chat.service';
import type {
  ProjectDataSource,
  ProjectRow,
} from '../../../projects/api/dto/project.dto';

function makeAirweaveSource(
  overrides: Partial<
    Extract<ProjectDataSource, { kind: 'airweave_collection' }>
  > = {},
): ProjectDataSource {
  return {
    id: 'src-1',
    projectId: 'proj-1',
    kind: 'airweave_collection',
    name: 'General',
    config: {
      collectionReadableId: 'collection-1',
      collectionName: 'General',
    },
    status: 'ready',
    statusDetail: null,
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeProjectRow(overrides: Partial<ProjectRow> = {}): ProjectRow {
  return {
    id: 'proj-1',
    organization_id: 'org-1',
    name: 'General',
    description: null,
    created_by_user_id: 'user-1',
    created_at: '2026-04-01T00:00:00.000Z',
    updated_at: '2026-04-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeConversationRow(
  overrides: Partial<ConversationRow> = {},
): ConversationRow {
  return {
    id: 'conversation-1',
    title: null,
    organization_id: 'org-1',
    user_id: 'user-1',
    project_id: 'proj-1',
    project_name: 'General',
    project_source_count: 1,
    created_at: new Date('2026-04-03T00:00:00.000Z'),
    updated_at: new Date('2026-04-03T00:00:00.000Z'),
    last_message_preview: null,
    last_message_at: null,
    message_count: 0,
    ...overrides,
  };
}

function makeMessageRow(overrides: Partial<MessageRow> = {}): MessageRow {
  return {
    id: 'message-1',
    conversation_id: 'conversation-1',
    role: 'user',
    content: 'hello',
    metadata: null,
    created_at: new Date('2026-04-03T00:00:00.000Z'),
    ...overrides,
  };
}

describe('ChatService', () => {
  let service: ChatService;
  let repository: jest.Mocked<IChatRepository>;
  let organizationsService: jest.Mocked<AdminOrganizationsService>;
  let chatAgentService: jest.Mocked<ChatAgentService>;
  let projectsService: jest.Mocked<ProjectsService>;

  beforeEach(async () => {
    repository = {
      listConversations: jest.fn(),
      findConversationById: jest.fn(),
      createConversation: jest.fn(),
      updateConversationTitle: jest.fn(),
      listMessages: jest.fn(),
      createMessage: jest.fn(),
      deleteConversation: jest.fn(),
    };

    organizationsService = {
      findById: jest.fn(),
    } as never;

    chatAgentService = {
      generateReply: jest.fn(),
      generateReplyStreaming: jest.fn(),
    } as never;

    projectsService = {
      resolveProjectSources: jest.fn(),
    } as never;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        { provide: CHAT_REPOSITORY, useValue: repository },
        { provide: AdminOrganizationsService, useValue: organizationsService },
        { provide: ChatAgentService, useValue: chatAgentService },
        { provide: ProjectsService, useValue: projectsService },
      ],
    }).compile();

    service = module.get(ChatService);

    organizationsService.findById.mockResolvedValue({
      id: 'org-1',
      organizationId: 'org-1',
      name: 'Champion Velocity',
      slug: 'champion-velocity',
      logo: null,
      metadata: {},
      createdAt: new Date('2026-04-01T00:00:00.000Z'),
      memberCount: 1,
    } as never);

    projectsService.resolveProjectSources.mockResolvedValue({
      project: makeProjectRow(),
      sources: [makeAirweaveSource()],
    });
  });

  it('lists conversations for an accessible organization', async () => {
    repository.listConversations.mockResolvedValue([
      makeConversationRow({
        title: 'First chat',
        last_message_preview: 'Hello',
        last_message_at: new Date('2026-04-03T00:01:00.000Z'),
        message_count: 2,
      }),
    ]);

    const result = await service.listConversations({
      platformRole: 'manager',
      activeOrganizationId: 'org-1',
      userId: 'user-1',
    });

    expect(organizationsService.findById).toHaveBeenCalledWith('org-1');
    expect(repository.listConversations).toHaveBeenCalledWith(
      'user-1',
      'org-1',
      undefined,
    );
    expect(result[0].messageCount).toBe(2);
    expect(result[0].projectId).toBe('proj-1');
    expect(result[0].projectName).toBe('General');
    expect(result[0].projectSourceCount).toBe(1);
  });

  it('forwards projectId filter when listing conversations', async () => {
    repository.listConversations.mockResolvedValue([]);

    await service.listConversations({
      platformRole: 'manager',
      activeOrganizationId: 'org-1',
      userId: 'user-1',
      projectId: 'proj-1',
    });

    expect(repository.listConversations).toHaveBeenCalledWith(
      'user-1',
      'org-1',
      'proj-1',
    );
  });

  it('creates a conversation inside the active organization scope', async () => {
    repository.createConversation.mockResolvedValue(makeConversationRow());

    await service.createConversation({
      platformRole: 'manager',
      activeOrganizationId: 'org-1',
      userId: 'user-1',
      title: null,
      projectId: 'proj-1',
    });

    expect(projectsService.resolveProjectSources).toHaveBeenCalledWith(
      'proj-1',
      'org-1',
    );
    expect(repository.createConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        userId: 'user-1',
        projectId: 'proj-1',
      }),
    );
  });

  it('rejects createConversation without projectId', async () => {
    await expect(
      service.createConversation({
        platformRole: 'manager',
        activeOrganizationId: 'org-1',
        userId: 'user-1',
        title: null,
        projectId: '',
      }),
    ).rejects.toMatchObject({ message: 'projectId is required' });
  });

  it('sends a message, auto-titles untitled conversations, and stores the assistant reply', async () => {
    repository.findConversationById
      .mockResolvedValueOnce(makeConversationRow())
      .mockResolvedValueOnce(
        makeConversationRow({
          title: 'How do deployments work?',
          updated_at: new Date('2026-04-03T00:00:01.000Z'),
          last_message_preview: '## Answer',
          last_message_at: new Date('2026-04-03T00:00:01.000Z'),
          message_count: 2,
        }),
      );
    repository.listMessages.mockResolvedValue([]);
    repository.createMessage
      .mockResolvedValueOnce(
        makeMessageRow({
          role: 'user',
          content: 'How do deployments work?',
        }),
      )
      .mockResolvedValueOnce(
        makeMessageRow({
          id: 'message-2',
          role: 'assistant',
          content: '## Answer\n\nUse the deployment workflow.',
          metadata: { generator: 'fallback' },
          created_at: new Date('2026-04-03T00:00:01.000Z'),
        }),
      );
    chatAgentService.generateReply.mockResolvedValue({
      content: '## Answer\n\nUse the deployment workflow.',
      metadata: { generator: 'fallback' },
    });

    const result = await service.sendMessage({
      platformRole: 'manager',
      activeOrganizationId: 'org-1',
      conversationId: 'conversation-1',
      userId: 'user-1',
      content: 'How do deployments work?',
    });

    expect(repository.updateConversationTitle).toHaveBeenCalledWith(
      'conversation-1',
      'user-1',
      'org-1',
      'How do deployments work?',
    );
    expect(chatAgentService.generateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationName: 'Champion Velocity',
        projectName: 'General',
        projectId: 'proj-1',
        question: 'How do deployments work?',
        sources: [expect.objectContaining({ kind: 'airweave_collection' })],
      }),
    );
    expect(result.assistantMessage.content).toContain('## Answer');
  });

  it('propagates BadRequestException when the conversation is not linked to a project', async () => {
    repository.findConversationById.mockResolvedValue(
      makeConversationRow({ project_id: null, project_name: null }),
    );
    repository.listMessages.mockResolvedValue([]);

    await expect(
      service.sendMessage({
        platformRole: 'manager',
        activeOrganizationId: 'org-1',
        conversationId: 'conversation-1',
        userId: 'user-1',
        content: 'How do deployments work?',
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining('not linked to a project'),
    });
  });

  it('deletes an existing conversation', async () => {
    repository.deleteConversation.mockResolvedValue(true);

    const result = await service.deleteConversation({
      platformRole: 'manager',
      activeOrganizationId: 'org-1',
      conversationId: 'conversation-1',
      userId: 'user-1',
    });

    expect(result).toEqual({ success: true });
  });

  it('throws NotFoundException when deleteConversation returns false', async () => {
    repository.deleteConversation.mockResolvedValue(false);

    await expect(
      service.deleteConversation({
        platformRole: 'manager',
        activeOrganizationId: 'org-1',
        conversationId: 'conversation-1',
        userId: 'user-1',
      }),
    ).rejects.toMatchObject({ message: 'Conversation not found' });
  });

  it('lists messages for a conversation', async () => {
    repository.findConversationById.mockResolvedValue(
      makeConversationRow({ title: 'Chat', message_count: 1 }),
    );
    repository.listMessages.mockResolvedValue([
      makeMessageRow({ content: 'Hello' }),
    ]);

    const result = await service.listMessages({
      platformRole: 'manager',
      activeOrganizationId: 'org-1',
      conversationId: 'conversation-1',
      userId: 'user-1',
    });

    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('Hello');
  });

  it('throws NotFoundException when requireConversation finds nothing', async () => {
    repository.findConversationById.mockResolvedValue(null);

    await expect(
      service.listMessages({
        platformRole: 'manager',
        activeOrganizationId: 'org-1',
        conversationId: 'nonexistent',
        userId: 'user-1',
      }),
    ).rejects.toMatchObject({ message: 'Conversation not found' });
  });

  it('throws NotFoundException when the updated conversation is not found after sendMessage', async () => {
    repository.findConversationById
      .mockResolvedValueOnce(
        makeConversationRow({ title: 'Existing Title', message_count: 1 }),
      )
      .mockResolvedValueOnce(null);
    repository.listMessages.mockResolvedValue([]);
    repository.createMessage
      .mockResolvedValueOnce(makeMessageRow({ content: 'Test', role: 'user' }))
      .mockResolvedValueOnce(
        makeMessageRow({
          id: 'message-2',
          role: 'assistant',
          content: 'Reply',
          metadata: {},
          created_at: new Date('2026-04-03T00:00:01.000Z'),
        }),
      );
    chatAgentService.generateReply.mockResolvedValue({
      content: 'Reply',
      metadata: {},
    });

    await expect(
      service.sendMessage({
        platformRole: 'manager',
        activeOrganizationId: 'org-1',
        conversationId: 'conversation-1',
        userId: 'user-1',
        content: 'Test',
      }),
    ).rejects.toMatchObject({ message: 'Conversation not found' });
  });

  it('throws NotFoundException when requireOrganization finds nothing', async () => {
    repository.findConversationById.mockResolvedValue(makeConversationRow());
    repository.listMessages.mockResolvedValue([]);
    organizationsService.findById.mockResolvedValue(null);

    await expect(
      service.sendMessage({
        platformRole: 'manager',
        activeOrganizationId: 'org-1',
        conversationId: 'conversation-1',
        userId: 'user-1',
        content: 'Hello',
      }),
    ).rejects.toMatchObject({ message: 'Organization not found' });
  });

  it('does not update title when conversation already has a title', async () => {
    repository.findConversationById
      .mockResolvedValueOnce(
        makeConversationRow({ title: 'Already set', message_count: 1 }),
      )
      .mockResolvedValueOnce(
        makeConversationRow({
          title: 'Already set',
          updated_at: new Date('2026-04-03T00:00:01.000Z'),
          last_message_preview: 'Reply',
          last_message_at: new Date('2026-04-03T00:00:01.000Z'),
          message_count: 2,
        }),
      );
    repository.listMessages.mockResolvedValue([]);
    repository.createMessage
      .mockResolvedValueOnce(makeMessageRow({ role: 'user', content: 'Hello' }))
      .mockResolvedValueOnce(
        makeMessageRow({
          id: 'message-2',
          role: 'assistant',
          content: 'Reply',
          metadata: {},
          created_at: new Date('2026-04-03T00:00:01.000Z'),
        }),
      );
    chatAgentService.generateReply.mockResolvedValue({
      content: 'Reply',
      metadata: {},
    });

    await service.sendMessage({
      platformRole: 'manager',
      activeOrganizationId: 'org-1',
      conversationId: 'conversation-1',
      userId: 'user-1',
      content: 'Hello',
    });

    expect(repository.updateConversationTitle).not.toHaveBeenCalled();
  });

  describe('resolveScopedOrganizationId — branch coverage', () => {
    it('throws BadRequestException for superadmin when organizationId is blank string', async () => {
      await expect(
        service.listConversations({
          platformRole: 'superadmin',
          activeOrganizationId: null,
          organizationId: '   ',
          userId: 'user-1',
        }),
      ).rejects.toMatchObject({ message: 'organizationId cannot be blank' });
    });

    it('throws BadRequestException for superadmin when neither organizationId nor activeOrganizationId is set', async () => {
      await expect(
        service.listConversations({
          platformRole: 'superadmin',
          activeOrganizationId: null,
          userId: 'user-1',
        }),
      ).rejects.toMatchObject({
        message: 'organizationId is required for superadmin',
      });
    });

    it('throws ForbiddenException for non-superadmin when no active organization', async () => {
      await expect(
        service.listConversations({
          platformRole: 'member',
          activeOrganizationId: null,
          userId: 'user-1',
        }),
      ).rejects.toMatchObject({ message: 'Active organization required' });
    });

    it('throws ForbiddenException when explicit organizationId differs from active org', async () => {
      await expect(
        service.listConversations({
          platformRole: 'member',
          activeOrganizationId: 'org-1',
          organizationId: 'org-2',
          userId: 'user-1',
        }),
      ).rejects.toMatchObject({
        message: expect.stringContaining('active organization'),
      });
    });
  });

  describe('sendMessageStreaming', () => {
    it('streams start event, then agent events', async () => {
      const conversation = makeConversationRow();

      repository.findConversationById
        .mockResolvedValueOnce(conversation)
        .mockResolvedValueOnce(conversation);

      repository.listMessages.mockResolvedValue([]);
      repository.createMessage.mockResolvedValue(
        makeMessageRow({ content: 'Test', role: 'user' }),
      );
      repository.updateConversationTitle.mockResolvedValue(undefined);

      async function* mockAgentStream() {
        yield { type: 'chunk' as const, content: 'Hello' };
        yield {
          type: 'done' as const,
          reply: { content: 'Hello world', metadata: {} },
        };
      }

      chatAgentService.generateReplyStreaming.mockReturnValue(
        mockAgentStream() as never,
      );

      const events: unknown[] = [];
      const stream = service.sendMessageStreaming({
        platformRole: 'manager',
        activeOrganizationId: 'org-1',
        conversationId: 'conversation-1',
        userId: 'user-1',
        content: 'Test',
      });

      for await (const event of stream) {
        events.push(event);
      }

      expect(events[0]).toMatchObject({ type: 'start' });
      expect(events).toHaveLength(3); // start + chunk + done
    });

    it('throws BadRequestException in streaming when the conversation has no project', async () => {
      repository.findConversationById.mockResolvedValue(
        makeConversationRow({ project_id: null, project_name: null }),
      );
      repository.listMessages.mockResolvedValue([]);

      const stream = service.sendMessageStreaming({
        platformRole: 'manager',
        activeOrganizationId: 'org-1',
        conversationId: 'conversation-1',
        userId: 'user-1',
        content: 'Test',
      });

      await expect(
        (async () => {
          for await (const _event of stream) {
            void _event;
          }
        })(),
      ).rejects.toMatchObject({
        message: expect.stringContaining('not linked to a project'),
      });
    });
  });

  describe('persistAssistantMessage', () => {
    it('creates an assistant message and returns mapped row', async () => {
      repository.createMessage.mockResolvedValue(
        makeMessageRow({
          id: 'msg-1',
          conversation_id: 'conv-1',
          role: 'assistant',
          content: 'Hello',
          metadata: { generator: 'claude' },
        }),
      );

      const result = await service.persistAssistantMessage(
        'conv-1',
        'user-1',
        'org-1',
        { content: 'Hello', metadata: { generator: 'claude' } },
      );

      expect(result.content).toBe('Hello');
    });
  });

  describe('getConversationForComplete', () => {
    it('returns conversation summary when found', async () => {
      repository.findConversationById.mockResolvedValue(
        makeConversationRow({ id: 'conv-1', title: 'Test' }),
      );

      const result = await service.getConversationForComplete(
        'conv-1',
        'user-1',
        'org-1',
      );

      expect(result).not.toBeNull();
      expect(result.id).toBe('conv-1');
    });

    it('returns null when conversation not found', async () => {
      repository.findConversationById.mockResolvedValue(null);

      const result = await service.getConversationForComplete(
        'conv-1',
        'user-1',
        undefined,
      );

      expect(result).toBeNull();
    });
  });
});
