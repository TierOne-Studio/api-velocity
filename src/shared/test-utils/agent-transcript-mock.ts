// Shared test utilities for mocking the langchain agent layer with a
// deterministic, scripted transcript. Used by the chat-agent pin tests.
//
// WHY THIS EXISTS (per docs/langchain-agent-refactor-proposal.md §0.1).
// This repo runs Jest in ESM mode (`useESM: true` in package.json's `jest`
// block + `node --experimental-vm-modules`). The legacy `jest.mock(...)`
// pattern from CJS does NOT work here — the static `import` of a module
// resolves to the real implementation before the mock factory registers.
// Every chat-agent spec that needs to control LLM behavior MUST use
// `jest.unstable_mockModule` + dynamic `import()` of the SUT.
//
// The proposal's earlier draft mocked `@langchain/openai`. After reading
// the existing `chat-agent-streaming-fence.integration.spec.ts` we discovered
// the cleaner pattern is to mock `langchain.createAgent` directly — the
// returned agent's `stream()` and `invoke()` are what the chat-agent service
// drives, and faking those is sufficient. The underlying `ChatOpenAI` is
// never instantiated under the mock.
//
// This file exports building blocks. The spec wires them up like so:
//
//   import { jest } from '@jest/globals';
//   import {
//     installCreateAgentMock,
//     resetCapturedTools,
//     streamFromTranscript,
//   } from '../../../../shared/test-utils/agent-transcript-mock';
//
//   const createAgentMock = installCreateAgentMock();
//   jest.unstable_mockModule('langchain', () => ({
//     createAgent: (...args: unknown[]) =>
//       (createAgentMock as unknown as (...a: unknown[]) => unknown)(...args),
//   }));
//   const { ChatAgentService } = await import('./chat-agent.service');

import { jest } from '@jest/globals';
import { AIMessage, ToolMessage } from '@langchain/core/messages';

/**
 * A single step in a scripted agent run. A spec composes a sequence of
 * these to replace what would otherwise be 1+ LLM round-trips with a
 * deterministic outcome.
 */
export type TranscriptStep =
  | {
      type: 'tool_call';
      /**
       * Name of the tool. MUST match a tool that the chat agent constructs
       * (either the built-in `search_knowledge_base` or one contributed by
       * the DataSourceRegistry mock). The helper invokes the captured tool
       * BEFORE yielding the corresponding tool-message so any side effects
       * (e.g. pushing `sql_executed` onto `ctx.eventSink`) have happened by
       * the time the chat-agent's drain runs.
       */
      toolName: string;
      args: Record<string, unknown>;
      /** JSON-string payload the tool-message carries back to the agent. */
      toolResult: string;
    }
  | {
      type: 'content';
      /** Plain assistant text. Becomes the final synthesis chunk. */
      text: string;
    };

type CapturedTool = {
  name: string;
  invoke: (input: unknown) => Promise<unknown>;
};

// Module-scope to bridge between `installCreateAgentMock` (top-level mock
// factory) and the `streamFromTranscript` helper called later in each test.
// Reset via `resetCapturedTools()` in the spec's `beforeEach`.
let capturedTools: CapturedTool[] = [];

/**
 * Clears the tools array captured by the most recent `createAgent` invocation.
 * Call in `beforeEach`.
 */
export function resetCapturedTools(): void {
  capturedTools = [];
}

/**
 * Returns the tools captured by the most recent `createAgent` call. Useful
 * for assertions like "did the agent receive a `query_database` tool?".
 */
export function getCapturedTools(): readonly CapturedTool[] {
  return capturedTools;
}

/**
 * Builds the Jest mock for `langchain.createAgent`. The spec wires this into
 * `jest.unstable_mockModule('langchain', ...)`. Returns a jest.Mock with no
 * default implementation — each test MUST call `mockCreateAgentWithTranscript`
 * (or set a custom impl) to specify how the mocked agent responds.
 */
export function installCreateAgentMock(): ReturnType<typeof jest.fn> {
  return jest.fn();
}

/**
 * Configures the `createAgent` mock for one test. The impl set here:
 *   1. Captures the tools array passed to `createAgent` so the transcript
 *      can invoke them at `tool_call` step boundaries.
 *   2. Returns a fake agent whose `stream()` and `invoke()` replay the
 *      transcript via `streamFromTranscript` / `invokeResultFromTranscript`.
 *
 * Call this once per test (or in `beforeEach`) AFTER `createAgentMock.mockReset()`
 * if you've reset the mock. If you don't reset, the most recent
 * `mockImplementation` wins — Jest mocks don't stack.
 */
export function mockCreateAgentWithTranscript(
  createAgentMock: ReturnType<typeof jest.fn>,
  steps: readonly TranscriptStep[],
): void {
  createAgentMock.mockImplementation((config: unknown) => {
    const tools = (config as { tools?: CapturedTool[] }).tools ?? [];
    capturedTools = tools;
    return {
      stream: jest
        .fn()
        .mockImplementation(async () => streamFromTranscript(steps)),
      invoke: jest
        .fn()
        .mockImplementation(async () => invokeResultFromTranscript(steps)),
    };
  });
}

/**
 * Async-iterable suitable for `agent.stream(...)`'s return value, mirroring
 * the `streamMode: 'messages'` shape (yields `[BaseMessage, metadata]` tuples).
 *
 * For each `tool_call` step:
 *   1. Yields an AIMessage carrying the tool_call (so the streaming loop
 *      emits a `searching` event for `search_knowledge_base` tools).
 *   2. Awaits the captured tool's `.invoke(...)` so any synchronous side
 *      effects (e.g. `ctx.eventSink.push({type:'sql_executed', ...})`) run.
 *   3. Yields a ToolMessage so the streaming loop's tool-message handler
 *      runs `drainSqlEvents(ctx)` — this is what surfaces `sql_executed`.
 *
 * For each `content` step: yields an AIMessage with the text as the final
 * synthesis chunk.
 */
export function streamFromTranscript(steps: readonly TranscriptStep[]) {
  return (async function* () {
    let toolCallId = 0;
    for (const step of steps) {
      if (step.type === 'content') {
        yield [
          new AIMessage({
            content: step.text,
            usage_metadata: {
              input_tokens: 100,
              output_tokens: 50,
              total_tokens: 150,
            },
          }),
          { langgraph_node: 'agent' },
        ] as const;
        continue;
      }
      const callId = `call-${++toolCallId}`;
      yield [
        new AIMessage({
          content: '',
          tool_calls: [
            {
              id: callId,
              name: step.toolName,
              args: step.args,
              type: 'tool_call',
            },
          ],
        }),
        { langgraph_node: 'agent' },
      ] as const;
      const captured = capturedTools.find((t) => t.name === step.toolName);
      if (captured) {
        try {
          await captured.invoke(step.args);
        } catch {
          // Tool-side errors surface via the tool-message content (the test
          // controls that via `toolResult`). Swallowing here keeps the
          // transcript driver from masking real assertion failures.
        }
      }
      yield [
        new ToolMessage({
          content: step.toolResult,
          tool_call_id: callId,
        }),
        { langgraph_node: 'tools' },
      ] as const;
    }
  })();
}

/**
 * Eager counterpart to `streamFromTranscript`, suitable for `agent.invoke(...)`'s
 * return value (which the chat-agent service uses in `generateAgentReply`).
 */
export async function invokeResultFromTranscript(
  steps: readonly TranscriptStep[],
): Promise<{ messages: Array<AIMessage | ToolMessage> }> {
  const messages: Array<AIMessage | ToolMessage> = [];
  let toolCallId = 0;
  for (const step of steps) {
    if (step.type === 'content') {
      messages.push(
        new AIMessage({
          content: step.text,
          usage_metadata: {
            input_tokens: 100,
            output_tokens: 50,
            total_tokens: 150,
          },
        }),
      );
      continue;
    }
    const callId = `call-${++toolCallId}`;
    messages.push(
      new AIMessage({
        content: '',
        tool_calls: [
          {
            id: callId,
            name: step.toolName,
            args: step.args,
            type: 'tool_call',
          },
        ],
      }),
    );
    const captured = capturedTools.find((t) => t.name === step.toolName);
    if (captured) {
      try {
        await captured.invoke(step.args);
      } catch {
        // see streamFromTranscript above
      }
    }
    messages.push(
      new ToolMessage({ content: step.toolResult, tool_call_id: callId }),
    );
  }
  return { messages };
}
