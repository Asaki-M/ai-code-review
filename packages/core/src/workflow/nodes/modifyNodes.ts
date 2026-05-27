import type { ModifyResult } from '../../schemas/modify.js'
import type { ReviewWorkflowState } from '../state.js'
import { modifyAgent } from '../../agents/modifyAgent/index.js'
import { required } from '../../utils/required.js'
import { buildModifyInstructionPrompt } from '../helpers/reviewInstruction.js'
import { collect, collectWorkingTree } from './reviewNodes.js'

export async function modify(state: ReviewWorkflowState): Promise<ModifyResult> {
  const repository = state.repository
  const reviewResult = required(state.review, 'review')

  if (!repository) {
    return {
      success: false,
      skipped: true,
      message: '缺少 repository，无法执行自动修改。',
    }
  }

  const result = await modifyAgent.invoke({
    messages: [
      {
        role: 'user',
        content: JSON.stringify({
          repository,
          review: reviewResult,
          commitContext: state.commitContext,
          instruction: buildModifyInstructionPrompt(state.userInstruction),
        }, null, 2),
      },
    ],
  })

  return result.structuredResponse
}

export function nextAfterModify(state: ReviewWorkflowState) {
  return state.modify?.success ? 'rereview' : 'retry'
}

export async function prepareRetry(state: ReviewWorkflowState) {
  const repository = state.repository

  return buildWorkflowReset(
    repository ? await collect({ repository, commitLimit: state.commitLimit }) : state.commitContext,
  )
}

export async function rereviewCollect(state: ReviewWorkflowState) {
  const repository = state.repository

  if (!repository) {
    throw new Error('缺少 repository，无法收集重新审查所需上下文。')
  }

  return buildWorkflowReset(await collectWorkingTree(repository))
}

function buildWorkflowReset(commitContext: string | undefined) {
  return {
    commitContext,
    humanFeedback: undefined,
    feedbackRequest: undefined,
    pushFeedback: undefined,
    pushFeedbackRequest: undefined,
    commit: undefined,
    pushPlan: undefined,
    push: undefined,
  }
}
