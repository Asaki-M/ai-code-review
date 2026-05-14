import type { PushResult } from '../schemas/push.js'
import type { ReviewInput } from '../schemas/workflow.js'
import type { ReviewWorkflowState } from './state.js'
import { collectAgent } from '../agents/collectAgent.js'
import { judgeAgent } from '../agents/judgeAgent.js'
import { pushAgent, pushPlannerAgent } from '../agents/pushAgent.js'
import { reviewAgent } from '../agents/reviewAgent/index.js'
import { required } from '../utils/required.js'
import { buildHumanFeedbackRequest, buildPushFeedbackRequest } from './feedback.js'
import { normalizePushPlan } from './push.js'

export async function collect(input: ReviewInput) {
  if (!input.repository) {
    throw new Error('reviewCode requires either diff or repository.')
  }

  const result = await collectAgent.invoke({
    messages: [{ role: 'user', content: `repoPath: ${input.repository}\nlimit: ${input.commitLimit ?? 5}` }],
  })

  return String(result.messages.at(-1)?.content ?? '')
}

export async function review(commitContext: string) {
  const result = await reviewAgent.invoke({
    messages: [{ role: 'user', content: `请审查以下 diff，并输出 ReviewResult：\n\n${commitContext}` }],
  })

  return result.structuredResponse
}

export async function judge(reviewResult: ReviewWorkflowState['review']) {
  const result = await judgeAgent.invoke({
    messages: [{ role: 'user', content: JSON.stringify(required(reviewResult, 'review'), null, 2) }],
  })

  return result.structuredResponse
}

export async function humanFeedback(state: ReviewWorkflowState) {
  const reviewResult = required(state.review, 'review')
  const judgeResult = required(state.judge, 'judge')
  const feedbackRequest = buildHumanFeedbackRequest(reviewResult, judgeResult)

  if (!judgeResult.shouldRequestUserFeedback) {
    return {
      feedbackRequest,
      humanFeedback: {
        action: 'skipped',
        message: judgeResult.reason,
      },
    }
  }

  if (state.humanFeedback) {
    return { feedbackRequest, humanFeedback: state.humanFeedback }
  }

  if (state.requestHumanFeedback) {
    return {
      feedbackRequest,
      humanFeedback: await state.requestHumanFeedback(feedbackRequest),
    }
  }

  return { feedbackRequest }
}

export function shouldPush(state: ReviewWorkflowState) {
  const action = state.humanFeedback?.action

  return action === 'approved' || action === 'force_push' ? 'push' : 'end'
}

export async function planPush(state: ReviewWorkflowState) {
  const repository = state.repository

  if (!repository) {
    throw new Error('缺少 repository，无法分析推送方式。')
  }

  const result = await pushPlannerAgent.invoke({
    messages: [{ role: 'user', content: `repository: ${repository}` }],
  })

  return normalizePushPlan(result.structuredResponse)
}

export async function pushFeedback(state: ReviewWorkflowState) {
  const reviewResult = required(state.review, 'review')
  const judgeResult = required(state.judge, 'judge')
  const pushPlan = required(state.pushPlan, 'pushPlan')
  const pushFeedbackRequest = buildPushFeedbackRequest(reviewResult, judgeResult, pushPlan)

  if (state.pushFeedback) {
    return { pushFeedbackRequest, pushFeedback: state.pushFeedback }
  }

  if (state.requestPushFeedback) {
    return {
      pushFeedbackRequest,
      pushFeedback: await state.requestPushFeedback(pushFeedbackRequest),
    }
  }

  return { pushFeedbackRequest }
}

export function shouldExecutePush(state: ReviewWorkflowState) {
  return state.pushFeedback?.action === 'push_selected' ? 'push' : 'end'
}

export async function push(state: ReviewWorkflowState): Promise<PushResult> {
  const repository = state.repository
  const pushPlan = required(state.pushPlan, 'pushPlan')
  const pushFeedback = required(state.pushFeedback, 'pushFeedback')

  if (!repository) {
    return {
      success: false,
      skipped: true,
      message: '缺少 repository，无法执行 git push。',
    }
  }

  const selectedOption = pushPlan.options.find(option => option.id === pushFeedback.pushOptionId)

  if (!selectedOption) {
    return {
      success: false,
      skipped: true,
      message: '未选择有效的推送方式，已跳过 git push。',
    }
  }

  const result = await pushAgent.invoke({
    messages: [
      {
        role: 'user',
        content: JSON.stringify({ repository, selectedOption }, null, 2),
      },
    ],
  })

  return result.structuredResponse
}
