import { jest } from '@jest/globals';

jest.mock('@thallesp/nestjs-better-auth', () => ({
  Session: () => () => {},
  AllowAnonymous: () => () => {},
  BetterAuthGuard: class {},
  BetterAuthModule: { forRoot: jest.fn(() => ({ module: class {} })) },
}));
jest.mock('better-auth/crypto', () => ({}));
jest.mock('jose', () => ({}));

import { HttpException, HttpStatus } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ThrottlerGuard } from '@nestjs/throttler';
import { PermissionsGuard } from '../../../../shared';
import { ChatController } from './chat.controller';
import { ChatService } from '../../application/services/chat.service';

describe('ChatController', () => {
  let controller: ChatController;
  let chatService: jest.Mocked<ChatService>;

  type MockSseResponse = {
    setHeader: jest.Mock;
    flushHeaders: jest.Mock;
    write: jest.Mock;
    end: jest.Mock;
    flush: jest.Mock;
  };

  const managerSession = {
    user: { id: 'user-1', role: 'manager' },
    session: { activeOrganizationId: 'org-1' },
  } as never;

  beforeEach(() => {
    chatService = {
      listConversations: jest.fn(),
      createConversation: jest.fn(),
      listMessages: jest.fn(),
      sendMessage: jest.fn(),
      sendMessageStreaming: jest.fn(),
      persistAssistantMessage: jest.fn(),
      getConversationForComplete: jest.fn(),
      deleteConversation: jest.fn(),
    } as never;

    controller = new ChatController(chatService);
  });

  it('applies the class-level PermissionsGuard and ThrottlerGuard', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      ChatController,
    ) as unknown[];

    expect(guards).toContain(PermissionsGuard);
    expect(guards).toContain(ThrottlerGuard);
  });

  it('applies @Throttle metadata on sendMessage and streamMessage', () => {
    const sendKeys = Reflect.getMetadataKeys(
      ChatController.prototype.sendMessage,
    );
    const streamKeys = Reflect.getMetadataKeys(
      ChatController.prototype.streamMessage,
    );

    expect(sendKeys).toEqual(
      expect.arrayContaining([expect.stringContaining('THROTTLER:')]),
    );
    expect(streamKeys).toEqual(
      expect.arrayContaining([expect.stringContaining('THROTTLER:')]),
    );
  });

  it('lists conversations for the current user and organization', async () => {
    chatService.listConversations.mockResolvedValue([]);

    await controller.listConversations(managerSession, undefined, undefined);

    expect(chatService.listConversations).toHaveBeenCalledWith({
      platformRole: 'manager',
      activeOrganizationId: 'org-1',
      organizationId: undefined,
      userId: 'user-1',
      projectId: undefined,
    });
  });

  it('creates a conversation with actor context', async () => {
    chatService.createConversation.mockResolvedValue({
      id: 'conversation-1',
    } as never);

    await controller.createConversation(managerSession, {
      title: ' First chat ',
      projectId: 'proj-1',
    });

    expect(chatService.createConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        title: ' First chat ',
        userId: 'user-1',
        projectId: 'proj-1',
      }),
    );
  });

  it('lists messages for one conversation', async () => {
    chatService.listMessages.mockResolvedValue([]);

    await controller.listMessages(
      managerSession,
      ' conversation-1 ',
      undefined,
    );

    expect(chatService.listMessages).toHaveBeenCalledWith({
      platformRole: 'manager',
      activeOrganizationId: 'org-1',
      organizationId: undefined,
      conversationId: 'conversation-1',
      userId: 'user-1',
    });
  });

  it('sends a message with trimmed content', async () => {
    chatService.sendMessage.mockResolvedValue({} as never);

    await controller.sendMessage(managerSession, ' conversation-1 ', {
      content: ' how do deployments work? ',
    });

    expect(chatService.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conversation-1',
        content: 'how do deployments work?',
        userId: 'user-1',
      }),
    );
  });

  it('deletes a conversation within the current scope', async () => {
    chatService.deleteConversation.mockResolvedValue({
      success: true,
    } as never);

    const result = await controller.deleteConversation(
      managerSession,
      ' conversation-1 ',
      undefined,
    );

    expect(chatService.deleteConversation).toHaveBeenCalledWith({
      platformRole: 'manager',
      activeOrganizationId: 'org-1',
      organizationId: undefined,
      conversationId: 'conversation-1',
      userId: 'user-1',
    });
    expect(result).toEqual({ success: true });
  });

  it('streams thinking, searching, chunk, and complete SSE events from the agent', async () => {
    const response: MockSseResponse = {
      setHeader: jest.fn(),
      flushHeaders: jest.fn(),
      write: jest.fn(),
      end: jest.fn(),
      flush: jest.fn(),
    };

    // Mock sendMessageStreaming as an async generator
    async function* fakeStream() {
      yield {
        type: 'start' as const,
        conversation: { id: 'conversation-1' },
        userMessage: { id: 'message-user-1', content: 'hello' },
      };
      yield { type: 'thinking' as const };
      yield { type: 'searching' as const, query: 'hello world' };
      yield { type: 'chunk' as const, content: 'answer text' };
      yield {
        type: 'done' as const,
        reply: {
          content: 'answer text',
          metadata: { generator: 'langchain-agent', sources: [] },
        },
      };
    }

    chatService.sendMessageStreaming.mockReturnValue(fakeStream() as never);
    chatService.persistAssistantMessage.mockResolvedValue({
      id: 'message-assistant-1',
      content: 'answer text',
    } as never);
    chatService.getConversationForComplete.mockResolvedValue({
      id: 'conversation-1',
    } as never);

    await controller.streamMessage(
      managerSession,
      ' conversation-1 ',
      { content: ' hello ' },
      response as never,
    );

    expect(response.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'text/event-stream',
    );
    expect(response.write).toHaveBeenCalledWith(
      expect.stringContaining('event: start'),
    );
    expect(response.write).toHaveBeenCalledWith(
      expect.stringContaining('event: thinking'),
    );
    expect(response.write).toHaveBeenCalledWith(
      expect.stringContaining('event: searching'),
    );
    expect(response.write).toHaveBeenCalledWith(
      expect.stringContaining('hello world'),
    );
    expect(response.write).toHaveBeenCalledWith(
      expect.stringContaining('event: chunk'),
    );
    expect(response.write).toHaveBeenCalledWith(
      expect.stringContaining('event: complete'),
    );
    expect(chatService.persistAssistantMessage).toHaveBeenCalled();
    expect(response.end).toHaveBeenCalled();
  });

  it('streams SSE error events when the streaming generator throws', async () => {
    const response: MockSseResponse = {
      setHeader: jest.fn(),
      flushHeaders: jest.fn(),
      write: jest.fn(),
      end: jest.fn(),
      flush: jest.fn(),
    };

    async function* failingStream() {
      yield* [] as never[];
      throw new Error('stream failure');
    }

    chatService.sendMessageStreaming.mockReturnValue(failingStream() as never);

    await controller.streamMessage(
      managerSession,
      ' conversation-1 ',
      { content: ' hello ' },
      response as never,
    );

    expect(response.write).toHaveBeenCalledWith(
      expect.stringContaining('event: error'),
    );
    expect(response.write).toHaveBeenCalledWith(
      expect.stringContaining('stream failure'),
    );
    expect(response.end).toHaveBeenCalled();
  });

  it('requires organizationId when a superadmin has no active organization', async () => {
    const superadminSession = {
      user: { id: 'user-1', role: 'superadmin' },
      session: {},
    } as never;
    chatService.listConversations.mockRejectedValueOnce(
      new HttpException(
        'organizationId is required for superadmin',
        HttpStatus.BAD_REQUEST,
      ),
    );

    await expect(
      controller.listConversations(superadminSession, undefined, undefined),
    ).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
    });
  });

  it('rejects blank content for message sends', async () => {
    await expect(
      controller.sendMessage(managerSession, 'conversation-1', {
        content: '   ',
      }),
    ).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
    });
  });

  it('throws FORBIDDEN when non-superadmin calls without an active organization', async () => {
    const noOrgSession = {
      user: { id: 'user-1', role: 'manager' },
      session: {},
    } as never;

    await expect(
      controller.listConversations(noOrgSession, undefined, undefined),
    ).rejects.toMatchObject({
      status: HttpStatus.FORBIDDEN,
    });
  });
});
