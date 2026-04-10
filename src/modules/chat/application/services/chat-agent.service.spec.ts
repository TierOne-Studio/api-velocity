import { jest } from '@jest/globals';
import { ChatAgentService } from './chat-agent.service';

type ChatReply = {
  content: string;
  metadata: Record<string, unknown>;
};

type ChatAgentServiceInternals = ChatAgentService & {
  generateAgentReply: (apiKey: string, params: unknown) => Promise<ChatReply>;
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
    getChatAgentToolResultLimit: any;
    getChatAgentMaxSources: any;
    getChatAgentHistoryWindow: any;
    getChatAgentSearchTier: any;
    getChatAgentRetrievalStrategy: any;
  };
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;
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
      getChatAgentToolResultCharCap: jest.fn().mockReturnValue(3000),
      getChatAgentToolResultLimit: jest.fn().mockReturnValue(12),
      getChatAgentMaxSources: jest.fn().mockReturnValue(15),
      getChatAgentHistoryWindow: jest.fn().mockReturnValue(6),
      getChatAgentSearchTier: jest.fn().mockReturnValue('classic'),
      getChatAgentRetrievalStrategy: jest.fn().mockReturnValue(undefined),
    };
    service = new ChatAgentService(
      airweaveService as never,
      configService as never,
    );
    consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    consoleInfoSpy = jest
      .spyOn(console, 'info')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
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

  describe('two-tier fallback dispatcher', () => {
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
      // Dispatcher must not call Airweave directly on the agent happy path.
      expect(airweaveService.searchCollection).not.toHaveBeenCalled();
    });

    it('falls back to keyless when the agent path fails', async () => {
      configService.getOpenAiApiKey.mockReturnValue('sk-openai');
      airweaveService.searchCollection.mockResolvedValue({
        results: [makeSearchResult()],
      });
      jest
        .spyOn(service as ChatAgentServiceInternals, 'generateAgentReply')
        .mockRejectedValue(new Error('agent exploded'));

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
        '[ChatAgentService] Agent path failed, falling back to raw search',
        expect.objectContaining({ error: 'agent exploded' }),
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

  describe('agent prompt construction', () => {
    it('returns the raw user question as the agent user message (no Organization prefix)', () => {
      const message = (
        service as unknown as {
          buildAgentUserMessage: (params: { question: string }) => string;
        }
      ).buildAgentUserMessage({
        question: 'what projects do you see?',
      });

      expect(message).toBe('what projects do you see?');
      expect(message).not.toContain('Organization');
      expect(message).not.toContain('Question:');
    });

    it('puts organization context in the system prompt, not the user message', () => {
      configService.getChatSystemPrompt.mockReturnValue('expert persona body');

      const systemPrompt = (
        service as unknown as {
          buildAgentSystemPrompt: (params: {
            organizationName: string;
          }) => string;
        }
      ).buildAgentSystemPrompt({
        organizationName: 'TierOne',
      });

      expect(systemPrompt).toContain('expert persona body');
      expect(systemPrompt).toContain('TierOne');
      expect(systemPrompt).toContain('Tool usage protocol');
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
