import { jest } from '@jest/globals';
import { ChatAgentService } from './chat-agent.service';

type ChatAgentServiceWithLangChain = ChatAgentService & {
  generateLangChainReply: (
    apiKey: string,
    params: unknown,
    results: unknown[],
  ) => Promise<string>;
};

describe('ChatAgentService', () => {
  let service: ChatAgentService;
  let airweaveService: { searchCollection: any };
  let configService: {
    getOpenAiApiKey: any;
    getOpenAiModel: any;
    getChatSystemPrompt: any;
  };
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;

  beforeEach(() => {
    airweaveService = {
      searchCollection: jest.fn(),
    };
    configService = {
      getOpenAiApiKey: jest.fn().mockReturnValue(null),
      getOpenAiModel: jest.fn().mockReturnValue('gpt-4o'),
      getChatSystemPrompt: jest
        .fn()
        .mockReturnValue(
          'You answer questions about organization knowledge bases. Use only the provided source context. Respond in structured markdown with sections ## Answer, ### Key Findings, and ### Sources. Keep attribution brief and factual.',
        ),
    };
    service = new ChatAgentService(
      airweaveService as never,
      configService as never,
    );
    consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('returns a helpful empty-state answer when search yields no results', async () => {
    airweaveService.searchCollection.mockResolvedValue({ results: [] });

    const result = await service.generateReply({
      organizationName: 'Champion Velocity',
      collectionId: 'champion-velocity',
      question: 'How do deployments work?',
      previousMessages: [],
    });

    expect(result.content).toContain('## Answer');
    expect(result.content).toContain(
      'I could not find relevant indexed material',
    );
    expect(result.metadata).toEqual(
      expect.objectContaining({
        generator: 'fallback-no-results',
        resultCount: 0,
      }),
    );
  });

  it('falls back to a markdown summary when OpenAI is not configured', async () => {
    airweaveService.searchCollection.mockResolvedValue({
      results: [
        {
          entityId: 'entity-1',
          name: 'Deploy Guide',
          relevanceScore: 0.95,
          breadcrumbs: [],
          createdAt: null,
          updatedAt: null,
          text: 'Deployments run through the CI workflow and then into Elastic Beanstalk.',
          sourceName: 'github',
          entityType: 'file',
          webUrl: 'https://example.com/deploy-guide',
        },
      ],
    });

    const result = await service.generateReply({
      organizationName: 'Champion Velocity',
      collectionId: 'champion-velocity',
      question: 'How do deployments work?',
      previousMessages: [],
    });

    expect(result.content).toContain('### Key Findings');
    expect(result.content).toContain('### Sources');
    expect(result.metadata).toEqual(
      expect.objectContaining({
        generator: 'fallback-search-summary',
        resultCount: 1,
      }),
    );
  });

  it('uses the LangChain-backed path when OpenAI is configured', async () => {
    configService.getOpenAiApiKey.mockReturnValue('sk-openai');
    airweaveService.searchCollection.mockResolvedValue({
      results: [
        {
          entityId: 'entity-1',
          name: 'Deploy Guide',
          relevanceScore: 0.95,
          breadcrumbs: [],
          createdAt: null,
          updatedAt: null,
          text: 'Deployments run through the CI workflow and then into Elastic Beanstalk.',
          sourceName: 'github',
          entityType: 'file',
          webUrl: 'https://example.com/deploy-guide',
        },
      ],
    });
    const langChainReplySpy = jest
      .spyOn(service as ChatAgentServiceWithLangChain, 'generateLangChainReply')
      .mockResolvedValue('## Answer\n\nLangChain reply');

    const result = await service.generateReply({
      organizationName: 'Champion Velocity',
      collectionId: 'champion-velocity',
      question: 'How do deployments work?',
      previousMessages: [{ role: 'user', content: 'Previous question' }],
    });

    expect(langChainReplySpy).toHaveBeenCalledWith(
      'sk-openai',
      expect.objectContaining({ organizationName: 'Champion Velocity' }),
      expect.any(Array),
    );
    expect(result.content).toContain('LangChain reply');
    expect(result.metadata).toEqual(
      expect.objectContaining({
        generator: 'langchain-openai',
        resultCount: 1,
      }),
    );
  });

  it('falls back when the LangChain-backed path fails', async () => {
    configService.getOpenAiApiKey.mockReturnValue('sk-openai');
    airweaveService.searchCollection.mockResolvedValue({
      results: [
        {
          entityId: 'entity-1',
          name: 'Deploy Guide',
          relevanceScore: 0.95,
          breadcrumbs: [],
          createdAt: null,
          updatedAt: null,
          text: 'Deployments run through the CI workflow and then into Elastic Beanstalk.',
          sourceName: 'github',
          entityType: 'file',
          webUrl: 'https://example.com/deploy-guide',
        },
      ],
    });
    jest
      .spyOn(service as ChatAgentServiceWithLangChain, 'generateLangChainReply')
      .mockRejectedValue(new Error('langchain failed'));

    const result = await service.generateReply({
      organizationName: 'Champion Velocity',
      collectionId: 'champion-velocity',
      question: 'How do deployments work?',
      previousMessages: [],
    });

    expect(result.metadata).toEqual(
      expect.objectContaining({
        generator: 'fallback-search-summary',
        resultCount: 1,
      }),
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[ChatAgentService] Failed to generate LangChain reply',
      expect.objectContaining({ error: 'langchain failed' }),
    );
  });

  it('reads system prompt from the config service', async () => {
    configService.getOpenAiApiKey.mockReturnValue('sk-openai');
    configService.getChatSystemPrompt.mockReturnValue('custom prompt');
    airweaveService.searchCollection.mockResolvedValue({
      results: [
        {
          entityId: 'entity-1',
          name: 'Guide',
          relevanceScore: 0.9,
          breadcrumbs: [],
          createdAt: null,
          updatedAt: null,
          text: 'content',
          sourceName: 'github',
          entityType: 'file',
          webUrl: 'https://example.com',
        },
      ],
    });
    jest
      .spyOn(service as ChatAgentServiceWithLangChain, 'generateLangChainReply')
      .mockResolvedValue('## Answer\n\nOK');

    await service.generateReply({
      organizationName: 'Test',
      collectionId: 'test',
      question: 'test?',
      previousMessages: [],
    });

    expect(configService.getChatSystemPrompt).toHaveBeenCalled();
  });

  it('reuses the same ChatOpenAI instance for identical config', () => {
    const serviceInstance = service as unknown as {
      getOrCreateLlm: (apiKey: string) => unknown;
    };

    configService.getOpenAiModel.mockReturnValue('gpt-4o');

    const llm1 = serviceInstance.getOrCreateLlm('sk-openai');
    const llm2 = serviceInstance.getOrCreateLlm('sk-openai');

    expect(llm1).toBe(llm2);
  });

  it('creates a new ChatOpenAI instance when config changes', () => {
    const serviceInstance = service as unknown as {
      getOrCreateLlm: (apiKey: string) => unknown;
    };

    configService.getOpenAiModel.mockReturnValue('gpt-4o');
    const llm1 = serviceInstance.getOrCreateLlm('sk-openai');

    configService.getOpenAiModel.mockReturnValue('gpt-4o-mini');
    const llm2 = serviceInstance.getOrCreateLlm('sk-openai');

    expect(llm1).not.toBe(llm2);
  });
});
