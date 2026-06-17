import { jest } from '@jest/globals';

jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn(),
}));

import Anthropic from '@anthropic-ai/sdk';
import { ClaudeImageDescriberAdapter } from './claude-image-describer.adapter';
import { ConfigService } from '../../../../shared/config/config.service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const MockAnthropic = Anthropic as any;

function makeConfig(overrides: Partial<Record<string, unknown>> = {}): ConfigService {
  return {
    getAnthropicApiKey: () => 'sk-ant-test',
    getImageExtractionModel: () => 'claude-haiku-4-5',
    ...overrides,
  } as unknown as ConfigService;
}

describe('ClaudeImageDescriberAdapter', () => {
  let mockCreate: jest.MockedFunction<(...a: unknown[]) => Promise<unknown>>;

  beforeEach(() => {
    mockCreate = jest.fn<(...a: unknown[]) => Promise<unknown>>();
    MockAnthropic.mockImplementation(
      () => ({ messages: { create: mockCreate } }),
    );
  });

  afterEach(() => {
    MockAnthropic.mockReset();
  });

  it('throws during construction when ANTHROPIC_API_KEY is missing', () => {
    const config = makeConfig({ getAnthropicApiKey: () => null });
    expect(() => new ClaudeImageDescriberAdapter(config)).toThrow(
      'ANTHROPIC_API_KEY is required',
    );
  });

  it('returns the text block from the Claude response', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'A bar chart showing quarterly revenue.' }],
    });
    const adapter = new ClaudeImageDescriberAdapter(makeConfig());
    const result = await adapter.describe(Buffer.from('fake-image'), 'image/jpeg');
    expect(result).toBe('A bar chart showing quarterly revenue.');
  });

  it('calls the API with the image as base64 and the configured model', async () => {
    mockCreate.mockResolvedValue({ content: [{ type: 'text', text: 'desc' }] });
    const imageBuffer = Buffer.from([0xff, 0xd8, 0xff]);
    const adapter = new ClaudeImageDescriberAdapter(makeConfig());
    await adapter.describe(imageBuffer, 'image/jpeg');

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-haiku-4-5',
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: 'user',
            content: expect.arrayContaining([
              expect.objectContaining({
                type: 'image',
                source: expect.objectContaining({
                  type: 'base64',
                  media_type: 'image/jpeg',
                  data: imageBuffer.toString('base64'),
                }),
              }),
            ]),
          }),
        ]),
      }),
    );
  });

  it('returns an empty string when the response has no text block', async () => {
    mockCreate.mockResolvedValue({ content: [{ type: 'tool_use', id: 'x' }] });
    const adapter = new ClaudeImageDescriberAdapter(makeConfig());
    const result = await adapter.describe(Buffer.from('img'), 'image/png');
    expect(result).toBe('');
  });

  it('propagates API errors so the caller can handle them per-image', async () => {
    mockCreate.mockRejectedValue(new Error('rate_limit_error'));
    const adapter = new ClaudeImageDescriberAdapter(makeConfig());
    await expect(
      adapter.describe(Buffer.from('img'), 'image/jpeg'),
    ).rejects.toThrow('rate_limit_error');
  });
});
