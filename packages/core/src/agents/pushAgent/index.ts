import type { BranchSummary, LogResult, RemoteWithRefs, StatusResult } from 'simple-git'
import { tool } from '@langchain/core/tools'
import { ChatVertexAI } from '@langchain/google-vertexai'
import { createAgent } from 'langchain'
import { simpleGit } from 'simple-git'
import { z } from 'zod'
import { pushPlanSchema, pushResultSchema } from '../../schemas/push.js'

const llm = new ChatVertexAI({
  model: 'gemini-2.5-pro',
  temperature: 0,
  maxRetries: 2,
})

const collectPushContextTool = tool(
  async ({ repository }) => collectPushContext(repository),
  {
    name: 'collectPushContext',
    description: '收集当前仓库分支、upstream、remote、最近提交、变更文件等 Git 推送上下文。',
    schema: z.object({
      repository: z.string().describe('项目本地路径'),
    }),
  },
)

const gitPushTool = tool(
  async ({ repository, remote, source, destination }) => {
    const command = buildPushCommand({ remote, source, destination })
    const git = simpleGit({ baseDir: repository, maxConcurrentProcesses: 1, trimmed: true })

    try {
      const result = await git.push(remote, `${source}:${destination}`)

      return JSON.stringify({
        success: true,
        skipped: false,
        command,
        stdout: JSON.stringify(result),
        message: '推送成功。',
      })
    }
    catch (error) {
      const gitError = error as Error & { stdout?: string, stderr?: string }

      return JSON.stringify({
        success: false,
        skipped: false,
        command,
        stdout: gitError.stdout,
        stderr: gitError.stderr,
        message: gitError.message,
      })
    }
  },
  {
    name: 'gitPush',
    description: '执行 git push <remote> <source>:<destination>。仅在用户已明确选择推送方案后调用。',
    schema: z.object({
      repository: z.string().describe('项目本地路径'),
      remote: z.string().describe('remote 名称，例如 origin'),
      source: z.string().describe('本地推送源引用，例如 HEAD 或分支名'),
      destination: z.string().describe('远端目标分支名，不包含 refs/heads/ 前缀'),
    }),
  },
)

export const pushPlannerAgent = createAgent({
  model: llm,
  tools: [collectPushContextTool],
  responseFormat: pushPlanSchema,
  systemPrompt: `
你是一个 Git 推送策略助手。你负责先调用 collectPushContext 获取仓库上下文，再生成安全、可解释的推送方案，不执行推送。

# 生成规则
- 必须先调用 collectPushContext。
- 必须输出符合 PushPlan 的结构化结果。
- 至少给出一个低风险或中风险方案。
- 如果当前分支是 main/master/develop，且存在改动需要推送，应优先建议 git push origin HEAD:<feature-branch> 形式，避免直接推主干。
- <feature-branch> 不能使用 feat/xx、feat/demo、feat/update 这类占位或泛化名称。
- 如果已有本地或远端 feature/fix/chore/refactor 分支和最近提交、变更文件、当前任务高度相关，应优先复用已有分支名。
- 如果没有合适的已有分支，应根据最近提交标题、变更文件路径、功能语义生成具体分支名，例如 feat/push-agent、fix/review-workflow-routing。
- 生成分支名时优先使用 feat/<topic>；如果提交语义明显是修复/重构/文档/配置，可使用 fix/refactor/docs/chore 前缀。
- 如果当前分支已有 upstream 且不是受保护主干，可以给出 git push 或 git push <remote> <branch> 方案。
- command 只能是 git push 命令，不要包含 &&、;、|、重定向、环境变量或其他 shell 语法。
- remote、source、destination 必须能组成 git push <remote> <source>:<destination>。
- 风险较高的方案必须在 description 里说明原因。
- 不要输出 Markdown、寒暄或额外字段。
`,
})

export const pushAgent = createAgent({
  model: llm,
  tools: [gitPushTool],
  responseFormat: pushResultSchema,
  systemPrompt: `
你是 Git 推送执行助手。你只负责执行用户已经选择的推送方案。

# 执行规则
- 必须调用 gitPush tool 执行推送。
- 只允许执行输入中的 selectedOption，不要自行更换 remote、source、destination。
- selectedOption.command 仅用于展示和校验；实际执行参数必须来自 selectedOption.remote/source/destination。
- 输出必须符合 PushResult。
- 如果 gitPush 返回失败，success 必须为 false，并保留错误 message/stdout/stderr。
- 不要输出 Markdown、寒暄或额外字段。
`,
})

async function collectPushContext(repository: string) {
  const git = simpleGit({ baseDir: repository, maxConcurrentProcesses: 1, trimmed: true })
  const [branchSummary, status, remotes, head, upstream, remoteBranches, recentCommits, changedFiles] = await Promise.all([
    safe(() => git.branch()),
    safe(() => git.status()),
    safe(() => git.getRemotes(true)),
    safe(() => git.revparse(['--short', 'HEAD'])),
    safe(() => git.revparse(['--abbrev-ref', '--symbolic-full-name', '@{u}'])),
    safe(() => git.branch(['-r'])),
    safe(() => git.log({ maxCount: 5 })),
    safe(() => git.diff(['--name-only', 'HEAD~5..HEAD'])),
  ])

  const currentBranch = branchSummary?.current || status?.current || '(unknown)'

  return [
    `repository: ${repository}`,
    `currentBranch: ${currentBranch}`,
    `head: ${head ?? '(unknown)'}`,
    `upstream: ${upstream || '(none)'}`,
    '',
    'status:',
    formatStatus(status),
    '',
    'remotes:',
    formatRemotes(remotes),
    '',
    'localBranches:',
    formatLocalBranches(branchSummary),
    '',
    'remoteBranches:',
    formatRemoteBranches(remoteBranches),
    '',
    'recentCommits:',
    formatRecentCommits(recentCommits),
    '',
    'changedFiles:',
    changedFiles || '(none)',
  ].join('\n')
}

async function safe<T>(task: () => Promise<T>): Promise<T | undefined> {
  try {
    return await task()
  }
  catch {
    return undefined
  }
}

function formatStatus(status: StatusResult | undefined) {
  if (!status) {
    return '(unknown)'
  }

  const lines = [
    `branch: ${status.current ?? '(unknown)'}`,
    `tracking: ${status.tracking ?? '(none)'}`,
    `ahead: ${status.ahead}`,
    `behind: ${status.behind}`,
    ...status.files.map(file => `${file.index}${file.working_dir} ${file.path}`),
  ]

  return lines.join('\n') || '(clean)'
}

function formatRemotes(remotes: RemoteWithRefs[] | undefined) {
  return remotes?.map(remote => `${remote.name}\tfetch=${remote.refs.fetch}\tpush=${remote.refs.push}`).join('\n') || '(none)'
}

function formatLocalBranches(branchSummary: BranchSummary | undefined) {
  return branchSummary?.all
    .filter(branch => !branch.startsWith('remotes/'))
    .map(branch => branch === branchSummary.current ? `* ${branch}` : `  ${branch}`)
    .join('\n') || '(none)'
}

function formatRemoteBranches(branchSummary: BranchSummary | undefined) {
  return branchSummary?.all.join('\n') || '(none)'
}

function formatRecentCommits(log: LogResult | undefined) {
  return log?.all.map(commit => `${commit.hash.slice(0, 7)} ${commit.message}`).join('\n') || '(none)'
}

function buildPushCommand(option: { remote: string, source: string, destination: string }) {
  return `git push ${option.remote} ${option.source}:${option.destination}`
}
