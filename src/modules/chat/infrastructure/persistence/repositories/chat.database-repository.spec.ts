import { jest } from '@jest/globals';
import { ChatDatabaseRepository } from './chat.database-repository';

const mockQuery: any = jest.fn();
const mockQueryOne: any = jest.fn();
const mockTransaction: any = jest.fn();

describe('ChatDatabaseRepository', () => {
  let repository: ChatDatabaseRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    mockTransaction.mockImplementation(async (callback: any) =>
      callback(mockQuery),
    );
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
      .mockResolvedValueOnce([
        {
          id: 'message-1',
          conversation_id: 'conversation-1',
          role: 'assistant',
          content: 'Hello',
          metadata: { generator: 'fallback' },
          created_at: new Date(),
        },
      ])
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

  it('throws when createConversation returns no row', async () => {
    mockQueryOne.mockResolvedValue(null);

    await expect(
      repository.createConversation({
        id: 'conversation-1',
        title: 'Test',
        organizationId: 'org-1',
        userId: 'user-1',
      }),
    ).rejects.toThrow('Failed to create conversation');
  });

  it('updates conversation title without organization scope when organizationId is null', async () => {
    await repository.updateConversationTitle(
      'conversation-1',
      'user-1',
      null,
      'New Title',
    );

    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain('UPDATE conversation SET title = $1');
    expect(sql).not.toContain('organization_id');
    expect(mockQuery.mock.calls[0][1]).toEqual([
      'New Title',
      'conversation-1',
      'user-1',
    ]);
  });

  it('updates conversation title with organization scope when organizationId is provided', async () => {
    await repository.updateConversationTitle(
      'conversation-1',
      'user-1',
      'org-1',
      'New Title',
    );

    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain('organization_id');
  });

  it('lists messages without organization scope when organizationId is null', async () => {
    mockQuery.mockResolvedValue([]);

    await repository.listMessages('conversation-1', 'user-1', null);

    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).not.toContain('organization_id');
    expect(mockQuery.mock.calls[0][1]).toEqual([
      'conversation-1',
      'user-1',
      200,
    ]);
  });

  it('throws when createMessage transaction returns empty rows', async () => {
    mockQuery
      .mockResolvedValueOnce([]) // INSERT returns empty array
      .mockResolvedValueOnce([]); // UPDATE conversation

    await expect(
      repository.createMessage({
        id: 'message-1',
        conversationId: 'conversation-1',
        role: 'user',
        content: 'Hi',
        metadata: {},
      }),
    ).rejects.toThrow('Failed to create message');
  });

  it('deletes a conversation without organization scope when organizationId is null', async () => {
    mockQuery.mockResolvedValue([]);

    const result = await repository.deleteConversation(
      'conversation-1',
      'user-1',
      null,
    );

    expect(result).toBe(false);
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).not.toContain('organization_id');
  });
});
