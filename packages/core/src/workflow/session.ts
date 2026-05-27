import type { HumanFeedbackResponse, ReviewInput, ReviewSessionOptions, ReviewSessionResult, ReviewSessionResumeInput, ReviewSessionSnapshot, ReviewWorkflowInterrupt, ReviewWorkflowResult } from '../schemas/workflow.js'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { Command, MemorySaver } from '@langchain/langgraph'
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite'
import { compileReviewWorkflow } from './graph.js'
import { createRunnableConfig, formatSessionResult, formatWorkflowResult, normalizeReviewInput } from './result.js'

function createMemoryCheckpointer() {
  return new MemorySaver()
}

function createSqliteCheckpointer(checkpointPath: string) {
  const resolvedPath = resolve(checkpointPath)
  mkdirSync(dirname(resolvedPath), { recursive: true })
  return SqliteSaver.fromConnString(resolvedPath)
}

export function createReviewCheckpointer(options: ReviewSessionOptions = {}) {
  if (options.checkpointPath) {
    return createSqliteCheckpointer(options.checkpointPath)
  }

  return createMemoryCheckpointer()
}

export async function startReviewSession(
  input: ReviewInput = {},
  options: ReviewSessionOptions = {},
): Promise<ReviewSessionResult> {
  const threadId = options.threadId ?? randomUUID()
  const graph = compileReviewWorkflow(createReviewCheckpointer(options))
  await graph.invoke(normalizeReviewInput(input), createRunnableConfig(threadId))
  const snapshot = await graph.getState(createRunnableConfig(threadId))
  return formatSessionResult(threadId, snapshot)
}

export async function resumeReviewSession(
  input: ReviewSessionResumeInput,
  options: ReviewSessionOptions = {},
): Promise<ReviewSessionResult> {
  const graph = compileReviewWorkflow(createReviewCheckpointer(options))
  await graph.invoke(new Command({ resume: input.resume }), createRunnableConfig(input.threadId))
  const snapshot = await graph.getState(createRunnableConfig(input.threadId))
  return formatSessionResult(input.threadId, snapshot)
}

export async function getReviewSession(
  threadId: string,
  options: ReviewSessionOptions = {},
): Promise<ReviewSessionSnapshot> {
  const graph = compileReviewWorkflow(createReviewCheckpointer(options))
  const snapshot = await graph.getState(createRunnableConfig(threadId))

  if (!snapshot.next.length && !Object.keys(snapshot.values ?? {}).length) {
    return {
      status: 'not_found',
      threadId,
    }
  }

  return formatSessionResult(threadId, snapshot)
}

export async function reviewCode(input: ReviewInput = {}): Promise<ReviewWorkflowResult> {
  if (!input.requestHumanFeedback && !input.requestPushFeedback) {
    const result = await compileReviewWorkflow().invoke(normalizeReviewInput(input))
    return formatWorkflowResult(result)
  }

  const threadId = randomUUID()
  const checkpointer = createMemoryCheckpointer()
  const graph = compileReviewWorkflow(checkpointer)
  await graph.invoke(normalizeReviewInput(input), createRunnableConfig(threadId))
  let session = formatSessionResult(threadId, await graph.getState(createRunnableConfig(threadId)))

  while (session.status === 'interrupted') {
    const response = await resolveInterruptResponse(session.interrupt, input)
    await graph.invoke(new Command({ resume: response }), createRunnableConfig(threadId))
    session = formatSessionResult(threadId, await graph.getState(createRunnableConfig(threadId)))
  }

  return formatWorkflowResult(session)
}

async function resolveInterruptResponse(
  interrupt: ReviewWorkflowInterrupt,
  input: ReviewInput,
): Promise<HumanFeedbackResponse> {
  if (interrupt.kind === 'human_feedback' && input.requestHumanFeedback) {
    return input.requestHumanFeedback(interrupt.request)
  }

  if (interrupt.kind === 'push_feedback' && input.requestPushFeedback) {
    return input.requestPushFeedback(interrupt.request)
  }

  throw new Error(`Workflow interrupted at ${interrupt.kind}, but no matching resume handler was provided.`)
}
