import { jest } from '@jest/globals';
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
});
