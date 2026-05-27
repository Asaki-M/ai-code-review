import type { ReviewInput } from '../../schemas/workflow.js'
import type { ReviewWorkflowState } from '../state.js'
import { collectCommitContext } from '../../agents/collectAgent/index.js'
import { judgeAgent } from '../../agents/judgeAgent/index.js'
import { reviewAgent } from '../../agents/reviewAgent/index.js'
import { required } from '../../utils/required.js'

export async function collect(input: ReviewInput) {
  if (!input.repository) {
    throw new Error('reviewCode requires either diff or repository.')
  }

  return collectCommitContext({
    repoPath: input.repository,
    limit: input.commitLimit ?? 5,
  })
}

export async function collectWorkingTree(repository: string) {
  return collectCommitContext({
    repoPath: repository,
    includeRecentCommits: false,
  })
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
