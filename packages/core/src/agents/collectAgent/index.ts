import { tool } from '@langchain/core/tools'
import { ChatVertexAI } from '@langchain/google-vertexai'
import { createAgent } from 'langchain'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { createRepositoryGit, formatGitStatus } from '../../utils/git.js'

const llm = new ChatVertexAI({
  model: 'gemini-2.5-pro',
  temperature: 0,
  maxRetries: 2,
})

async function collectCommitContext({ repoPath, limit = 5 }: { repoPath: string, limit?: number }) {
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 10)
  const git = createRepositoryGit(repoPath)

  try {
    const [log, status, stagedDiff, unstagedDiff, untrackedFiles] = await Promise.all([
      git.raw([
        'log',
        `-${safeLimit}`,
        '--date=iso-strict',
        '--format=commit %H%nAuthor: %an <%ae>%nDate: %ad%nSubject: %s%nBody:%n%b',
        '--patch',
        '--stat',
      ]),
      git.status(),
      safeGitRaw(git, ['diff', '--cached', '--stat', '--patch']),
      safeGitRaw(git, ['diff', '--stat', '--patch']),
      safeGitRaw(git, ['ls-files', '--others', '--exclude-standard']),
    ])

    const untrackedContext = await formatUntrackedFiles(repoPath, untrackedFiles)

    return [
      'recent commits:',
      log.trim() || '未查询到提交记录。',
      '',
      'working tree status:',
      formatGitStatus(status),
      '',
      'staged diff:',
      stagedDiff || '(none)',
      '',
      'unstaged diff:',
      unstagedDiff || '(none)',
      '',
      'untracked files:',
      untrackedContext,
    ].join('\n')
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return `获取提交上下文失败：${message}`
  }
}

const collectCommitContextTool = tool(collectCommitContext, {
  name: 'collectCommitContext',
  description: '获取目标仓库最近提交和当前工作区的上下文，包括 commit metadata、diff、stat 和未提交改动，用于后续代码审查',
  schema: z.object({
    repoPath: z.string().describe('项目的本地路径，例如 /Users/dev/my-project'),
    limit: z.number().int().positive().max(10).optional().describe('需要查询的提交记录条数，默认 5，最多 10'),
  }),
})

export const collectAgent = createAgent({
  model: llm,
  tools: [collectCommitContextTool],
  systemPrompt: '你负责收集代码审查所需的仓库上下文，包括 commit metadata、历史 diff、当前工作区 diff 和统计信息。不要做审查结论。',
})

async function safeGitRaw(git: ReturnType<typeof createRepositoryGit>, args: string[]) {
  try {
    return (await git.raw(args)).trim() || '(none)'
  }
  catch {
    return '(none)'
  }
}

async function formatUntrackedFiles(repoPath: string, raw: string) {
  const files = raw
    .split('\n')
    .map(file => file.trim())
    .filter(Boolean)

  if (files.length === 0) {
    return '(none)'
  }

  const sections = await Promise.all(files.map(async (file) => {
    try {
      const content = await readFile(join(repoPath, file), 'utf8')
      return [
        `file: ${file}`,
        '```',
        content.trimEnd(),
        '```',
      ].join('\n')
    }
    catch {
      return `file: ${file}\n(unable to read file content)`
    }
  }))

  return sections.join('\n\n')
}
