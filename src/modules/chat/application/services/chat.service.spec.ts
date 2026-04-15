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
import {
  CHAT_REPOSITORY,
  type IChatRepository,
} from '../../domain/repositories/chat.repository.interface';
import { ChatAgentService } from './chat-agent.service';
import { ChatService } from './chat.service';

describe('ChatService', () => {
  let service: ChatService;
  let repository: jest.Mocked<IChatRepository>;
  let organizationsService: jest.Mocked<AdminOrganizationsService>;
  let chatAgentService: jest.Mocked<ChatAgentService>;

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
    } as never;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        { provide: CHAT_REPOSITORY, useValue: repository },
        { provide: AdminOrganizationsService, useValue: organizationsService },
        { provide: ChatAgentService, useValue: chatAgentService },
      ],
    }).compile();

    service = module.get(ChatService);
  });

  it('lists conversations for an accessible organization', async () => {
    organizationsService.findById.mockResolvedValue({
      organizationId: 'org-1',
      id: 'org-1',
      name: 'Champion Velocity',
      slug: 'champion-velocity',
      logo: null,
      metadata: { airweaveCollectionId: 'collection-1' },
      createdAt: new Date('2026-04-01T00:00:00.000Z'),
      memberCount: 1,
    } as never);
    repository.listConversations.mockResolvedValue([
      {
        id: 'conversation-1',
        title: 'First chat',
        organization_id: 'org-1',
        user_id: 'user-1',
        created_at: new Date('2026-04-03T00:00:00.000Z'),
        updated_at: new Date('2026-04-03T00:00:00.000Z'),
        last_message_preview: 'Hello',
        last_message_at: new Date('2026-04-03T00:01:00.000Z'),
        message_count: 2,
      },
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
    );
    expect(result[0].messageCount).toBe(2);
  });

  it('creates a conversation inside the active organization scope', async () => {
    organizationsService.findById.mockResolvedValue({
      id: 'org-1',
      name: 'Champion Velocity',
      slug: 'champion-velocity',
      logo: null,
      metadata: { airweaveCollectionId: 'collection-1' },
      createdAt: new Date('2026-04-01T00:00:00.000Z'),
      memberCount: 1,
      organizationId: 'org-1',
    } as never);
    repository.createConversation.mockResolvedValue({
      id: 'conversation-1',
      title: null,
      organization_id: 'org-1',
      user_id: 'user-1',
      created_at: new Date('2026-04-03T00:00:00.000Z'),
      updated_at: new Date('2026-04-03T00:00:00.000Z'),
      last_message_preview: null,
      last_message_at: null,
      message_count: 0,
    });

    await service.createConversation({
      platformRole: 'manager',
      activeOrganizationId: 'org-1',
      userId: 'user-1',
      title: null,
    });

    expect(repository.createConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        userId: 'user-1',
      }),
    );
  });

  it('sends a message, auto-titles untitled conversations, and stores the assistant reply', async () => {
    repository.findConversationById.mockResolvedValue({
      id: 'conversation-1',
      title: null,
      organization_id: 'org-1',
      user_id: 'user-1',
      created_at: new Date('2026-04-03T00:00:00.000Z'),
      updated_at: new Date('2026-04-03T00:00:00.000Z'),
      last_message_preview: null,
      last_message_at: null,
      message_count: 0,
    });
    repository.listMessages.mockResolvedValue([]);
    organizationsService.findById.mockResolvedValue({
      id: 'org-1',
      name: 'Champion Velocity',
      slug: 'champion-velocity',
      logo: null,
      metadata: { airweaveCollectionId: 'collection-1' },
      createdAt: new Date('2026-04-01T00:00:00.000Z'),
      memberCount: 1,
    } as never);
    repository.createMessage
      .mockResolvedValueOnce({
        id: 'message-1',
        conversation_id: 'conversation-1',
        role: 'user',
        content: 'How do deployments work?',
        metadata: null,
        created_at: new Date('2026-04-03T00:00:00.000Z'),
      })
      .mockResolvedValueOnce({
        id: 'message-2',
        conversation_id: 'conversation-1',
        role: 'assistant',
        content: '## Answer\n\nUse the deployment workflow.',
        metadata: { generator: 'fallback' },
        created_at: new Date('2026-04-03T00:00:01.000Z'),
      });
    chatAgentService.generateReply.mockResolvedValue({
      content: '## Answer\n\nUse the deployment workflow.',
      metadata: { generator: 'fallback' },
    });
    repository.findConversationById
      .mockResolvedValueOnce({
        id: 'conversation-1',
        title: null,
        organization_id: 'org-1',
        user_id: 'user-1',
        created_at: new Date('2026-04-03T00:00:00.000Z'),
        updated_at: new Date('2026-04-03T00:00:00.000Z'),
        last_message_preview: null,
        last_message_at: null,
        message_count: 0,
      })
      .mockResolvedValueOnce({
        id: 'conversation-1',
        title: 'How do deployments work?',
        organization_id: 'org-1',
        user_id: 'user-1',
        created_at: new Date('2026-04-03T00:00:00.000Z'),
        updated_at: new Date('2026-04-03T00:00:01.000Z'),
        last_message_preview: '## Answer',
        last_message_at: new Date('2026-04-03T00:00:01.000Z'),
        message_count: 2,
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
        collectionId: 'collection-1',
        question: 'How do deployments work?',
      }),
    );
    expect(result.assistantMessage.content).toContain('## Answer');
  });

  it('fails fast when the organization has no configured collection', async () => {
    repository.findConversationById.mockResolvedValue({
      id: 'conversation-1',
      title: null,
      organization_id: 'org-1',
      user_id: 'user-1',
      created_at: new Date('2026-04-03T00:00:00.000Z'),
      updated_at: new Date('2026-04-03T00:00:00.000Z'),
      last_message_preview: null,
      last_message_at: null,
      message_count: 0,
    });
    repository.listMessages.mockResolvedValue([]);
    organizationsService.findById.mockResolvedValue({
      id: 'org-1',
      name: 'Champion Velocity',
      slug: 'champion-velocity',
      logo: null,
      metadata: {},
      createdAt: new Date('2026-04-01T00:00:00.000Z'),
      memberCount: 1,
    } as never);

    await expect(
      service.sendMessage({
        platformRole: 'manager',
        activeOrganizationId: 'org-1',
        conversationId: 'conversation-1',
        userId: 'user-1',
        content: 'How do deployments work?',
      }),
    ).rejects.toMatchObject({
      message:
        'Organization does not have an Airweave collection configured. Set one in Admin > Organizations.',
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
    repository.findConversationById.mockResolvedValue({
      id: 'conversation-1',
      title: 'Chat',
      organization_id: 'org-1',
      user_id: 'user-1',
      created_at: new Date('2026-04-03T00:00:00.000Z'),
      updated_at: new Date('2026-04-03T00:00:00.000Z'),
      last_message_preview: null,
      last_message_at: null,
      message_count: 1,
    });
    repository.listMessages.mockResolvedValue([
      {
        id: 'message-1',
        conversation_id: 'conversation-1',
        role: 'user',
        content: 'Hello',
        metadata: null,
        created_at: new Date('2026-04-03T00:00:00.000Z'),
      },
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
      .mockResolvedValueOnce({
        id: 'conversation-1',
        title: 'Existing Title',
        organization_id: 'org-1',
        user_id: 'user-1',
        created_at: new Date('2026-04-03T00:00:00.000Z'),
        updated_at: new Date('2026-04-03T00:00:00.000Z'),
        last_message_preview: null,
        last_message_at: null,
        message_count: 1,
      })
      .mockResolvedValueOnce(null); // updated conversation not found

    repository.listMessages.mockResolvedValue([]);
    organizationsService.findById.mockResolvedValue({
      id: 'org-1',
      name: 'Champion Velocity',
      slug: 'champion-velocity',
      logo: null,
      metadata: { airweaveCollectionId: 'collection-1' },
      createdAt: new Date('2026-04-01T00:00:00.000Z'),
      memberCount: 1,
    } as never);
    repository.createMessage
      .mockResolvedValueOnce({
        id: 'message-1',
        conversation_id: 'conversation-1',
        role: 'user',
        content: 'Test',
        metadata: null,
        created_at: new Date('2026-04-03T00:00:00.000Z'),
      })
      .mockResolvedValueOnce({
        id: 'message-2',
        conversation_id: 'conversation-1',
        role: 'assistant',
        content: 'Reply',
        metadata: {},
        created_at: new Date('2026-04-03T00:00:01.000Z'),
      });
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
    repository.findConversationById.mockResolvedValue({
      id: 'conversation-1',
      title: null,
      organization_id: 'org-1',
      user_id: 'user-1',
      created_at: new Date('2026-04-03T00:00:00.000Z'),
      updated_at: new Date('2026-04-03T00:00:00.000Z'),
      last_message_preview: null,
      last_message_at: null,
      message_count: 0,
    });
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
      .mockResolvedValueOnce({
        id: 'conversation-1',
        title: 'Already set',
        organization_id: 'org-1',
        user_id: 'user-1',
        created_at: new Date('2026-04-03T00:00:00.000Z'),
        updated_at: new Date('2026-04-03T00:00:00.000Z'),
        last_message_preview: null,
        last_message_at: null,
        message_count: 1,
      })
      .mockResolvedValueOnce({
        id: 'conversation-1',
        title: 'Already set',
        organization_id: 'org-1',
        user_id: 'user-1',
        created_at: new Date('2026-04-03T00:00:00.000Z'),
        updated_at: new Date('2026-04-03T00:00:01.000Z'),
        last_message_preview: 'Reply',
        last_message_at: new Date('2026-04-03T00:00:01.000Z'),
        message_count: 2,
      });

    repository.listMessages.mockResolvedValue([]);
    organizationsService.findById.mockResolvedValue({
      id: 'org-1',
      name: 'Champion Velocity',
      slug: 'champion-velocity',
      logo: null,
      metadata: { airweaveCollectionId: 'collection-1' },
      createdAt: new Date('2026-04-01T00:00:00.000Z'),
      memberCount: 1,
    } as never);
    repository.createMessage
      .mockResolvedValueOnce({
        id: 'message-1',
        conversation_id: 'conversation-1',
        role: 'user',
        content: 'Hello',
        metadata: null,
        created_at: new Date('2026-04-03T00:00:00.000Z'),
      })
      .mockResolvedValueOnce({
        id: 'message-2',
        conversation_id: 'conversation-1',
        role: 'assistant',
        content: 'Reply',
        metadata: {},
        created_at: new Date('2026-04-03T00:00:01.000Z'),
      });
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
      organizationsService.findById.mockResolvedValue({
        id: 'org-1',
        name: 'Test',
        slug: 'test',
        logo: null,
        metadata: {},
        createdAt: new Date(),
        memberCount: 1,
      } as never);

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
      ).rejects.toMatchObject({ message: 'organizationId is required for superadmin' });
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
      ).rejects.toMatchObject({ message: expect.stringContaining('active organization') });
    });
  });

  describe('sendMessageStreaming', () => {
    it('streams start event, then agent events', async () => {
      const mockConversation = {
        id: 'conversation-1',
        title: null,
        organization_id: 'org-1',
        user_id: 'user-1',
        created_at: new Date('2026-04-03T00:00:00.000Z'),
        updated_at: new Date('2026-04-03T00:00:00.000Z'),
        last_message_preview: null,
        last_message_at: null,
        message_count: 0,
      };

      repository.findConversationById
        .mockResolvedValueOnce(mockConversation)  // requireConversation
        .mockResolvedValueOnce(mockConversation); // updatedConversationForStart

      repository.listMessages.mockResolvedValue([]);
      organizationsService.findById.mockResolvedValue({
        id: 'org-1',
        name: 'Champion Velocity',
        slug: 'champion-velocity',
        logo: null,
        metadata: { airweaveCollectionId: 'collection-1' },
        createdAt: new Date('2026-04-01T00:00:00.000Z'),
        memberCount: 1,
      } as never);
      repository.createMessage.mockResolvedValue({
        id: 'message-1',
        conversation_id: 'conversation-1',
        role: 'user',
        content: 'Test',
        metadata: null,
        created_at: new Date('2026-04-03T00:00:00.000Z'),
      });
      repository.updateConversationTitle.mockResolvedValue(undefined);

      async function* mockAgentStream() {
        yield { type: 'chunk', content: 'Hello' };
        yield { type: 'done', content: 'Hello world', metadata: {} };
      }

      (chatAgentService as any).generateReplyStreaming = jest.fn().mockReturnValue(mockAgentStream());

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

    it('throws BadRequestException in streaming when no collection configured', async () => {
      repository.findConversationById.mockResolvedValue({
        id: 'conversation-1',
        title: null,
        organization_id: 'org-1',
        user_id: 'user-1',
        created_at: new Date('2026-04-03T00:00:00.000Z'),
        updated_at: new Date('2026-04-03T00:00:00.000Z'),
        last_message_preview: null,
        last_message_at: null,
        message_count: 0,
      });
      repository.listMessages.mockResolvedValue([]);
      organizationsService.findById.mockResolvedValue({
        id: 'org-1',
        name: 'Champion Velocity',
        slug: 'champion-velocity',
        logo: null,
        metadata: {},
        createdAt: new Date('2026-04-01T00:00:00.000Z'),
        memberCount: 1,
      } as never);

      const stream = service.sendMessageStreaming({
        platformRole: 'manager',
        activeOrganizationId: 'org-1',
        conversationId: 'conversation-1',
        userId: 'user-1',
        content: 'Test',
      });

      await expect(
        (async () => {
          for await (const _ of stream) { /* drain */ }
        })(),
      ).rejects.toMatchObject({ message: expect.stringContaining('Airweave collection') });
    });
  });

  describe('persistAssistantMessage', () => {
    it('creates an assistant message and returns mapped row', async () => {
      repository.createMessage.mockResolvedValue({
        id: 'msg-1',
        conversation_id: 'conv-1',
        role: 'assistant',
        content: 'Hello',
        metadata: { generator: 'claude' },
        created_at: new Date('2026-04-03T00:00:00.000Z'),
      });

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
      repository.findConversationById.mockResolvedValue({
        id: 'conv-1',
        title: 'Test',
        organization_id: 'org-1',
        user_id: 'user-1',
        created_at: new Date('2026-04-03T00:00:00.000Z'),
        updated_at: new Date('2026-04-03T00:00:00.000Z'),
        last_message_preview: null,
        last_message_at: null,
        message_count: 0,
      });

      const result = await service.getConversationForComplete('conv-1', 'user-1', 'org-1');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('conv-1');
    });

    it('returns null when conversation not found', async () => {
      repository.findConversationById.mockResolvedValue(null);

      const result = await service.getConversationForComplete('conv-1', 'user-1', undefined);

      expect(result).toBeNull();
    });
  });
});
