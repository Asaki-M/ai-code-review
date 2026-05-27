import type { CommitResult } from '../../schemas/commit.js'
import type { PushResult } from '../../schemas/push.js'
import type { ReviewWorkflowState } from '../state.js'
import { pushAgent, pushPlannerAgent } from '../../agents/pushAgent/index.js'
import { createRepositoryGit } from '../../utils/git.js'
import { required } from '../../utils/required.js'
import { normalizePushPlan } from '../helpers/push.js'

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
