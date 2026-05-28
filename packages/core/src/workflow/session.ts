import type { ReviewInput, ReviewSessionOptions, ReviewSessionResult, ReviewSessionResumeInput, ReviewSessionSnapshot, ReviewWorkflowResult } from '../schemas/workflow.js'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { Command } from '@langchain/langgraph'
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite'
import { compileReviewWorkflow } from './graph.js'
import { createRunnableConfig, formatSessionResult, formatWorkflowResult, normalizeReviewInput } from './result.js'

function createSqliteCheckpointer(checkpointPath: string) {
  const resolvedPath = resolve(checkpointPath)
  mkdirSync(dirname(resolvedPath), { recursive: true })
  return SqliteSaver.fromConnString(resolvedPath)
}

export function createReviewCheckpointer(options: ReviewSessionOptions) {
  if (!options?.checkpointPath) {
    throw new Error('Session checkpointPath is required for persistent review sessions.')
  }

  return createSqliteCheckpointer(options.checkpointPath)
}

export async function startReviewSession(
  input: ReviewInput = {},
  options: ReviewSessionOptions,
): Promise<ReviewSessionResult> {
  const threadId = options.threadId ?? randomUUID()
  const graph = compileReviewWorkflow(createReviewCheckpointer(options))
  await graph.invoke(normalizeReviewInput(input), createRunnableConfig(threadId))
  const snapshot = await graph.getState(createRunnableConfig(threadId))
  return formatSessionResult(threadId, snapshot)
}

export async function resumeReviewSession(
  input: ReviewSessionResumeInput,
  options: ReviewSessionOptions,
): Promise<ReviewSessionResult> {
  const graph = compileReviewWorkflow(createReviewCheckpointer(options))
  await graph.invoke(new Command({ resume: input.resume }), createRunnableConfig(input.threadId))
  const snapshot = await graph.getState(createRunnableConfig(input.threadId))
  return formatSessionResult(input.threadId, snapshot)
}

export async function getReviewSession(
  threadId: string,
  options: ReviewSessionOptions,
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
  const result = await compileReviewWorkflow().invoke(normalizeReviewInput(input))
  return formatWorkflowResult(result)
}
