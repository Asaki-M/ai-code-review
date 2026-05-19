import { tool } from '@langchain/core/tools'
import { ChatVertexAI } from '@langchain/google-vertexai'
import { createAgent } from 'langchain'
import { simpleGit } from 'simple-git'
import { z } from 'zod'

const llm = new ChatVertexAI({
  model: 'gemini-2.5-pro',
  temperature: 0,
  maxRetries: 2,
})

async function collectCommitContext({ repoPath, limit = 5 }: { repoPath: string, limit?: number }) {
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 10)
  const git = simpleGit({ baseDir: repoPath, maxConcurrentProcesses: 1, trimmed: true })

  try {
    const log = await git.raw([
      'log',
      `-${safeLimit}`,
      '--date=iso-strict',
      '--format=commit %H%nAuthor: %an <%ae>%nDate: %ad%nSubject: %s%nBody:%n%b',
      '--patch',
      '--stat',
    ])

    return log.trim() || '未查询到提交记录。'
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return `获取提交上下文失败：${message}`
  }
}

const collectCommitContextTool = tool(collectCommitContext, {
  name: 'collectCommitContext',
  description: '获取目标仓库最近提交的元信息、diff 和 stat，用于后续代码审查',
  schema: z.object({
    repoPath: z.string().describe('项目的本地路径，例如 /Users/dev/my-project'),
    limit: z.number().int().positive().max(10).optional().describe('需要查询的提交记录条数，默认 5，最多 10'),
  }),
})

export const collectAgent = createAgent({
  model: llm,
  tools: [collectCommitContextTool],
  systemPrompt: '你负责收集代码审查所需的仓库提交上下文，包括 commit metadata、diff 和统计信息。不要做审查结论。',
})
