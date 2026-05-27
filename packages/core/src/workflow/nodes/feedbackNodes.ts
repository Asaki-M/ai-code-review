import type { WorkflowUserInstruction } from '../../schemas/instruction.js'
import type { HumanFeedbackRequest, HumanFeedbackResponse, ReviewWorkflowInterrupt } from '../../schemas/workflow.js'
import type { ReviewWorkflowState } from '../state.js'
import { interrupt } from '@langchain/langgraph'
import { reviewInstructionAgent } from '../../agents/reviewInstructionAgent/index.js'
import { required } from '../../utils/required.js'
import { buildHumanFeedbackRequest, buildPushFeedbackRequest } from '../builders/feedback.js'
import { getLatestUserInstruction, hasNewUserInstruction } from '../helpers/reviewInstruction.js'

export async function humanFeedback(state: ReviewWorkflowState) {
  const reviewResult = required(state.review, 'review')
  const judgeResult = required(state.judge, 'judge')
  const feedbackRequest = buildHumanFeedbackRequest(reviewResult, judgeResult, {
    modify: state.modify,
  })
  let feedback = state.humanFeedback

  if (!judgeResult.shouldRequestUserFeedback) {
    return {
      feedbackRequest,
      humanFeedback: {
        action: 'skipped',
        message: judgeResult.reason,
      },
    }
  }

  if (!feedback) {
    feedback = interrupt(buildInterruptPayload('human_feedback', feedbackRequest)) as HumanFeedbackResponse
  }

  return {
    feedbackRequest,
    humanFeedback: feedback,
    userInstruction: await resolveUserInstruction(state.userInstruction, reviewResult, feedback),
  }
}

export function nextAfterHumanFeedback(state: ReviewWorkflowState) {
  const action = state.humanFeedback?.action

  if (action === 'auto_modify') {
    return 'modify'
  }

  return action === 'approved' || action === 'force_push' ? 'push' : 'end'
}

export async function pushFeedback(state: ReviewWorkflowState) {
  const reviewResult = required(state.review, 'review')
  const judgeResult = required(state.judge, 'judge')
  const pushPlan = required(state.pushPlan, 'pushPlan')
  const pushFeedbackRequest = buildPushFeedbackRequest(reviewResult, judgeResult, pushPlan)

  const pushFeedback = state.pushFeedback

  if (pushFeedback) {
    return { pushFeedbackRequest, pushFeedback }
  }

  return {
    pushFeedbackRequest,
    pushFeedback: interrupt(buildInterruptPayload('push_feedback', pushFeedbackRequest)) as HumanFeedbackResponse,
  }
}

export function shouldExecutePush(state: ReviewWorkflowState) {
  return state.pushFeedback?.action === 'push_selected' ? 'push' : 'end'
}

async function resolveUserInstruction(
  previousInstruction: WorkflowUserInstruction | undefined,
  reviewResult: ReviewWorkflowState['review'],
  feedback: ReviewWorkflowState['humanFeedback'],
) {
  const latestInstruction = getLatestUserInstruction(feedback?.instruction)

  if (!hasNewUserInstruction(latestInstruction)) {
    return previousInstruction
  }

  const result = await reviewInstructionAgent.invoke({
    messages: [{
      role: 'user',
      content: JSON.stringify({
        review: required(reviewResult, 'review'),
        previousInstruction,
        latestInstruction,
      }, null, 2),
    }],
  })

  return result.structuredResponse
}

function buildInterruptPayload(
  kind: ReviewWorkflowInterrupt['kind'],
  request: HumanFeedbackRequest,
): ReviewWorkflowInterrupt {
  return { kind, request }
}
