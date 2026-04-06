import { jest } from '@jest/globals';
import { HttpException, HttpStatus } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
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
      deleteConversation: jest.fn(),
    } as never;

    controller = new ChatController(chatService);
  });

  it('applies the class-level PermissionsGuard', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      ChatController,
    ) as unknown[];

    expect(guards).toContain(PermissionsGuard);
  });

  it('lists conversations for the current user and organization', async () => {
    chatService.listConversations.mockResolvedValue([]);

    await controller.listConversations(managerSession, undefined);

    expect(chatService.listConversations).toHaveBeenCalledWith({
      platformRole: 'manager',
      activeOrganizationId: 'org-1',
      organizationId: undefined,
      userId: 'user-1',
    });
  });

  it('creates a conversation with actor context', async () => {
    chatService.createConversation.mockResolvedValue({
      id: 'conversation-1',
    } as never);

    await controller.createConversation(managerSession, {
      title: ' First chat ',
    });

    expect(chatService.createConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        title: ' First chat ',
        userId: 'user-1',
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

  it('streams assistant message chunks over SSE', async () => {
    const response: MockSseResponse = {
      setHeader: jest.fn(),
      flushHeaders: jest.fn(),
      write: jest.fn(),
      end: jest.fn(),
      flush: jest.fn(),
    };

    chatService.sendMessage.mockResolvedValue({
      conversation: { id: 'conversation-1' },
      userMessage: { id: 'message-user-1', content: 'hello' },
      assistantMessage: {
        id: 'message-assistant-1',
        content: 'streamed assistant answer',
      },
    } as never);

    await controller.streamMessage(
      managerSession,
      ' conversation-1 ',
      { content: ' hello ' },
      response as never,
    );

    expect(chatService.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conversation-1',
        content: 'hello',
        userId: 'user-1',
      }),
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'text/event-stream',
    );
    expect(response.write).toHaveBeenCalledWith(
      expect.stringContaining('event: start'),
    );
    expect(response.write).toHaveBeenCalledWith(
      expect.stringContaining('event: chunk'),
    );
    expect(response.write).toHaveBeenCalledWith(
      expect.stringContaining('event: complete'),
    );
    expect(response.end).toHaveBeenCalled();
  });

  it('streams SSE error events when message generation fails', async () => {
    const response: MockSseResponse = {
      setHeader: jest.fn(),
      flushHeaders: jest.fn(),
      write: jest.fn(),
      end: jest.fn(),
      flush: jest.fn(),
    };

    chatService.sendMessage.mockRejectedValue(new Error('stream failure'));

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
      controller.listConversations(superadminSession, undefined),
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
});
