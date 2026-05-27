import type { StateSnapshot } from '@langchain/langgraph'
import type {
  ReviewInput,
  ReviewSessionResult,
  ReviewWorkflowInterrupt,
  ReviewWorkflowResult,
} from '../schemas/workflow.js'
import { resolve } from 'node:path'
import { required } from '../utils/required.js'

export function createRunnableConfig(threadId: string) {
  return {
    configurable: {
      thread_id: threadId,
    },
  }
}

export function normalizeReviewInput(input: ReviewInput = {}) {
  return {
    ...input,
    repository: input.repository ? resolve(input.repository) : input.repository,
  }
}

export function formatWorkflowResult(result: Partial<ReviewWorkflowResult>): ReviewWorkflowResult {
  return {
    commitContext: required(result.commitContext, 'commitContext'),
    review: required(result.review, 'review'),
    judge: required(result.judge, 'judge'),
    feedbackRequest: result.feedbackRequest,
    humanFeedback: result.humanFeedback,
    modify: result.modify,
    commit: result.commit,
    pushFeedbackRequest: result.pushFeedbackRequest,
    pushFeedback: result.pushFeedback,
    pushPlan: result.pushPlan,
    push: result.push,
  }
}

export function formatSessionResult(
  threadId: string,
  snapshot: StateSnapshot | undefined,
): ReviewSessionResult {
  const interrupt = getInterruptFromSnapshot(snapshot)
  const state = getWorkflowSnapshotState(snapshot)

  if (interrupt) {
    return {
      status: 'interrupted',
      threadId,
      interrupt,
      ...state,
    }
  }

  return {
    status: 'completed',
    threadId,
    ...formatWorkflowResult(state),
  }
}

function getInterruptFromSnapshot(snapshot: StateSnapshot | undefined): ReviewWorkflowInterrupt | undefined {
  const taskInterrupt = snapshot?.tasks.find(task => task.interrupts.length > 0)?.interrupts[0]
  const value = taskInterrupt?.value

  if (!value || typeof value !== 'object') {
    return undefined
  }

  const interrupt = value as { kind?: unknown, request?: unknown }

  if (
    (interrupt.kind === 'human_feedback' || interrupt.kind === 'push_feedback')
    && interrupt.request
  ) {
    return interrupt as ReviewWorkflowInterrupt
  }

  return undefined
}

function getWorkflowSnapshotState(snapshot: StateSnapshot | undefined) {
  return (snapshot?.values ?? {}) as Partial<ReviewWorkflowResult>
}
