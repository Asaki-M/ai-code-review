import type { CommitResult } from '../schemas/commit.js'
import type { WorkflowUserInstruction } from '../schemas/instruction.js'
import type { ModifyResult } from '../schemas/modify.js'
import type { PushResult } from '../schemas/push.js'
import type { ReviewInput } from '../schemas/workflow.js'
import type { ReviewWorkflowState } from './state.js'
import { collectAgent } from '../agents/collectAgent/index.js'
import { judgeAgent } from '../agents/judgeAgent/index.js'
import { modifyAgent } from '../agents/modifyAgent/index.js'
import { pushAgent, pushPlannerAgent } from '../agents/pushAgent/index.js'
import { reviewInstructionAgent } from '../agents/reviewInstructionAgent/index.js'
import { reviewAgent } from '../agents/reviewAgent/index.js'
import { createRepositoryGit } from '../utils/git.js'
import { required } from '../utils/required.js'
import { buildHumanFeedbackRequest, buildPushFeedbackRequest } from './feedback.js'
import { normalizePushPlan } from './push.js'
import { buildModifyInstructionPrompt, buildReviewInstructionPrompt, getLatestUserInstruction, hasNewUserInstruction } from './reviewInstruction.js'

export async function collect(input: ReviewInput) {
  if (!input.repository) {
    throw new Error('reviewCode requires either diff or repository.')
  }

  const result = await collectAgent.invoke({
    messages: [{ role: 'user', content: `repoPath: ${input.repository}\nlimit: ${input.commitLimit ?? 5}` }],
  })

  return String(result.messages.at(-1)?.content ?? '')
}

export async function review(commitContext: string, instruction?: string) {
  const result = await reviewAgent.invoke({
    messages: [{
      role: 'user',
      content: [
        '请审查以下 diff，并输出 ReviewResult。',
        '',
        '用户意见指令：',
        instruction ?? '(none)',
        '',
        commitContext,
      ].join('\n'),
    }],
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
  const feedbackRequest = buildHumanFeedbackRequest(reviewResult, judgeResult, {
    modify: state.modify,
    verify: state.verify,
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

  if (state.humanFeedback && !state.modify && !state.verify) {
    feedback = state.humanFeedback
  }
  else if (state.requestHumanFeedback) {
    feedback = await state.requestHumanFeedback(feedbackRequest)
  }
  else {
    return { feedbackRequest }
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

export async function commit(state: ReviewWorkflowState): Promise<CommitResult> {
  const repository = state.repository

  if (!repository) {
    return {
      success: false,
      skipped: true,
      message: '缺少 repository，无法执行 git commit。',
    }
  }

  const git = createRepositoryGit(repository)

  try {
    const status = await git.status()
    const stagedFiles = status.files.map(file => file.path)

    if (stagedFiles.length === 0) {
      return {
        success: true,
        skipped: true,
        message: '工作区无待提交改动，已跳过 git commit。',
      }
    }

    const commitMessage = buildCommitMessage(state)

    await git.raw(['add', '-A'])

    const result = await git.commit(commitMessage)

    return {
      success: true,
      skipped: false,
      commitHash: result.commit,
      commitMessage,
      stagedFiles,
      message: `已创建提交 ${result.commit.slice(0, 7)}。`,
    }
  }
  catch (error) {
    return {
      success: false,
      skipped: true,
      message: `执行 git commit 失败：${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

export function nextAfterCommit(state: ReviewWorkflowState) {
  return state.commit?.success ? 'push' : 'end'
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

  return buildWorkflowReset(await collect({ repository, commitLimit: state.commitLimit }))
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

function buildCommitMessage(state: ReviewWorkflowState) {
  if (state.modify?.success && !state.modify.skipped) {
    return 'fix: address review findings'
  }

  return 'chore: apply reviewed changes'
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
