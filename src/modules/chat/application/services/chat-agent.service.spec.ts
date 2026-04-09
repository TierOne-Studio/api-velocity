import { jest } from '@jest/globals';
import { ChatAgentService } from './chat-agent.service';

type ChatReply = {
  content: string;
  metadata: Record<string, unknown>;
};

type ChatAgentServiceInternals = ChatAgentService & {
  generateAgentReply: (apiKey: string, params: unknown) => Promise<ChatReply>;
  generateSingleShotReply: (
    apiKey: string,
    params: unknown,
  ) => Promise<ChatReply>;
};

describe('ChatAgentService', () => {
  let service: ChatAgentService;
  let airweaveService: { searchCollection: any };
  let configService: {
    getOpenAiApiKey: any;
    getOpenAiModel: any;
    getChatSystemPrompt: any;
    getChatAgentMaxIterations: any;
    getChatAgentToolResultCharCap: any;
  };
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;
  let consoleWarnSpy: jest.SpiedFunction<typeof console.warn>;
  let consoleInfoSpy: jest.SpiedFunction<typeof console.info>;

  beforeEach(() => {
    airweaveService = {
      searchCollection: jest.fn(),
    };
    configService = {
      getOpenAiApiKey: jest.fn().mockReturnValue(null),
      getOpenAiModel: jest.fn().mockReturnValue('gpt-4o'),
      getChatSystemPrompt: jest.fn().mockReturnValue('expert prompt'),
      getChatAgentMaxIterations: jest.fn().mockReturnValue(5),
      getChatAgentToolResultCharCap: jest.fn().mockReturnValue(1500),
    };
    service = new ChatAgentService(
      airweaveService as never,
      configService as never,
    );
    consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    consoleWarnSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    consoleInfoSpy = jest
      .spyOn(console, 'info')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleInfoSpy.mockRestore();
  });

  function makeSearchResult(overrides: Record<string, unknown> = {}) {
    return {
      entityId: 'entity-1',
      name: 'Deploy Guide',
      relevanceScore: 0.95,
      breadcrumbs: [],
      createdAt: null,
      updatedAt: null,
      text: 'Deployments run through CI and into Elastic Beanstalk.',
      sourceName: 'github',
      entityType: 'file',
      webUrl: 'https://example.com/deploy-guide',
      ...overrides,
    };
  }

  describe('three-tier fallback dispatcher', () => {
    it('uses the keyless fallback path when OpenAI is not configured', async () => {
      airweaveService.searchCollection.mockResolvedValue({
        results: [makeSearchResult()],
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

    it('returns the no-results fallback when there is no key and the search is empty', async () => {
      airweaveService.searchCollection.mockResolvedValue({ results: [] });

      const result = await service.generateReply({
        organizationName: 'Champion Velocity',
        collectionId: 'champion-velocity',
        question: 'How do deployments work?',
        previousMessages: [],
      });

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

    it('routes to the agent path when OpenAI is configured', async () => {
      configService.getOpenAiApiKey.mockReturnValue('sk-openai');
      const agentReply: ChatReply = {
        content: 'Agentic answer',
        metadata: {
          generator: 'langchain-agent',
          sources: [
            {
              name: 'Deploy Guide',
              webUrl: 'https://example.com/deploy-guide',
              sourceName: 'github',
              entityType: 'file',
            },
          ],
          resultCount: 1,
          toolCallCount: 2,
        },
      };
      const agentSpy = jest
        .spyOn(service as ChatAgentServiceInternals, 'generateAgentReply')
        .mockResolvedValue(agentReply);

      const result = await service.generateReply({
        organizationName: 'Champion Velocity',
        collectionId: 'champion-velocity',
        question: 'How does the invitation flow work?',
        previousMessages: [{ role: 'user', content: 'Previous question' }],
      });

      expect(agentSpy).toHaveBeenCalledWith(
        'sk-openai',
        expect.objectContaining({ organizationName: 'Champion Velocity' }),
      );
      expect(result.content).toBe('Agentic answer');
      expect(result.metadata).toEqual(
        expect.objectContaining({
          generator: 'langchain-agent',
          resultCount: 1,
          toolCallCount: 2,
        }),
      );
      // Dispatcher must not call the single-shot path on the happy agent path.
      expect(airweaveService.searchCollection).not.toHaveBeenCalled();
    });

    it('falls through from the failed agent path to the single-shot path', async () => {
      configService.getOpenAiApiKey.mockReturnValue('sk-openai');
      jest
        .spyOn(service as ChatAgentServiceInternals, 'generateAgentReply')
        .mockRejectedValue(new Error('agent exploded'));
      const singleShotSpy = jest
        .spyOn(service as ChatAgentServiceInternals, 'generateSingleShotReply')
        .mockResolvedValue({
          content: 'Single-shot answer',
          metadata: {
            generator: 'langchain-openai',
            sources: [],
            resultCount: 0,
          },
        });

      const result = await service.generateReply({
        organizationName: 'Champion Velocity',
        collectionId: 'champion-velocity',
        question: 'How do deployments work?',
        previousMessages: [],
      });

      expect(singleShotSpy).toHaveBeenCalledWith(
        'sk-openai',
        expect.any(Object),
      );
      expect(result.metadata).toEqual(
        expect.objectContaining({ generator: 'langchain-openai' }),
      );
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        '[ChatAgentService] Agent path failed, falling back to single-shot',
        expect.objectContaining({ error: 'agent exploded' }),
      );
    });

    it('falls all the way through to the keyless fallback when both agent and single-shot fail', async () => {
      configService.getOpenAiApiKey.mockReturnValue('sk-openai');
      airweaveService.searchCollection.mockResolvedValue({
        results: [makeSearchResult()],
      });
      jest
        .spyOn(service as ChatAgentServiceInternals, 'generateAgentReply')
        .mockRejectedValue(new Error('agent exploded'));
      jest
        .spyOn(service as ChatAgentServiceInternals, 'generateSingleShotReply')
        .mockRejectedValue(new Error('single-shot exploded'));

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
        '[ChatAgentService] Single-shot path also failed, falling back to raw search',
        expect.objectContaining({ error: 'single-shot exploded' }),
      );
    });
  });

  describe('observability', () => {
    it('logs a reply summary with generator, source count, and toolCallCount', async () => {
      airweaveService.searchCollection.mockResolvedValue({
        results: [makeSearchResult()],
      });

      await service.generateReply({
        organizationName: 'Champion Velocity',
        collectionId: 'champion-velocity',
        question: 'How do deployments work?',
        previousMessages: [],
      });

      expect(consoleInfoSpy).toHaveBeenCalledWith(
        '[ChatAgentService] reply generated',
        expect.objectContaining({
          generator: 'fallback-search-summary',
          sourceCount: 1,
          resultCount: 1,
          durationMs: expect.any(Number),
        }),
      );
    });

    it('includes toolCallCount in the log when the agent path succeeds', async () => {
      configService.getOpenAiApiKey.mockReturnValue('sk-openai');
      jest
        .spyOn(service as ChatAgentServiceInternals, 'generateAgentReply')
        .mockResolvedValue({
          content: 'Agentic answer',
          metadata: {
            generator: 'langchain-agent',
            sources: [],
            resultCount: 3,
            toolCallCount: 3,
          },
        });

      await service.generateReply({
        organizationName: 'Champion Velocity',
        collectionId: 'champion-velocity',
        question: 'How do deployments work?',
        previousMessages: [],
      });

      expect(consoleInfoSpy).toHaveBeenCalledWith(
        '[ChatAgentService] reply generated',
        expect.objectContaining({
          generator: 'langchain-agent',
          toolCallCount: 3,
        }),
      );
    });
  });

  describe('LLM caching', () => {
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
});
