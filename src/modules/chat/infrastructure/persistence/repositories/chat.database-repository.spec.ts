import { jest } from '@jest/globals';
import { ChatDatabaseRepository } from './chat.database-repository';

const mockQuery: any = jest.fn();
const mockQueryOne: any = jest.fn();
const mockTransaction: any = jest.fn();

describe('ChatDatabaseRepository', () => {
  let repository: ChatDatabaseRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    mockTransaction.mockImplementation(async (callback: any) => callback(mockQuery));
    repository = new ChatDatabaseRepository({
      query: mockQuery,
      queryOne: mockQueryOne,
      transaction: mockTransaction,
    } as never);
  });

  it('lists conversations for a user inside one organization scope', async () => {
    mockQuery.mockResolvedValue([{ id: 'conversation-1' }]);

    const result = await repository.listConversations('user-1', 'org-1');

    expect(result).toEqual([{ id: 'conversation-1' }]);
    expect(mockQuery.mock.calls[0][0]).toContain('FROM conversation c');
    expect(mockQuery.mock.calls[0][1]).toEqual(['user-1', 'org-1']);
  });

  it('finds a conversation scoped by user and organization', async () => {
    mockQueryOne.mockResolvedValue({ id: 'conversation-1' });

    await repository.findConversationById('conversation-1', 'user-1', 'org-1');

    expect(mockQueryOne.mock.calls[0][0]).toContain(
      'WHERE c.id = $1 AND c.user_id = $2',
    );
    expect(mockQueryOne.mock.calls[0][1]).toEqual([
      'conversation-1',
      'user-1',
      'org-1',
    ]);
  });

  it('creates a conversation row', async () => {
    mockQueryOne.mockResolvedValue({ id: 'conversation-1' });

    const result = await repository.createConversation({
      id: 'conversation-1',
      title: 'First chat',
      organizationId: 'org-1',
      userId: 'user-1',
    });

    expect(result).toEqual({ id: 'conversation-1' });
    expect(mockQueryOne.mock.calls[0][0]).toContain('INSERT INTO conversation');
    expect(mockQueryOne.mock.calls[0][1]).toEqual([
      'conversation-1',
      'First chat',
      'org-1',
      'user-1',
    ]);
  });

  it('lists messages with a default limit to prevent unbounded queries', async () => {
    mockQuery.mockResolvedValue([]);

    await repository.listMessages('conversation-1', 'user-1', 'org-1');

    expect(mockQuery.mock.calls[0][0]).toContain('LIMIT');
    expect(mockQuery.mock.calls[0][1]).toEqual([
      'conversation-1',
      'user-1',
      'org-1',
      200,
    ]);
  });

  it('creates a message and touches the parent conversation timestamp inside a transaction', async () => {
    mockQuery
      .mockResolvedValueOnce([{
        id: 'message-1',
        conversation_id: 'conversation-1',
        role: 'assistant',
        content: 'Hello',
        metadata: { generator: 'fallback' },
        created_at: new Date(),
      }])
      .mockResolvedValueOnce([]);

    await repository.createMessage({
      id: 'message-1',
      conversationId: 'conversation-1',
      role: 'assistant',
      content: 'Hello',
      metadata: { generator: 'fallback' },
    });

    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO message'),
      [
        'message-1',
        'conversation-1',
        'assistant',
        'Hello',
        JSON.stringify({ generator: 'fallback' }),
      ],
    );
    expect(mockQuery).toHaveBeenCalledWith(
      'UPDATE conversation SET updated_at = NOW() WHERE id = $1',
      ['conversation-1'],
    );
  });

  it('deletes a conversation within the user and organization scope', async () => {
    mockQuery.mockResolvedValue([{ id: 'conversation-1' }]);

    const result = await repository.deleteConversation(
      'conversation-1',
      'user-1',
      'org-1',
    );

    expect(result).toBe(true);
    expect(mockQuery.mock.calls[0][0]).toContain(
      'DELETE FROM conversation WHERE id = $1 AND user_id = $2',
    );
    expect(mockQuery.mock.calls[0][1]).toEqual([
      'conversation-1',
      'user-1',
      'org-1',
    ]);
  });
});
