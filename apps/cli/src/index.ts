#!/usr/bin/env node
import type {
  HumanFeedbackRequest,
  HumanFeedbackResponse,
  HumanFeedbackResponseAction,
  ReviewSessionResult,
  ReviewSessionSnapshot,
} from '@ai-code-review/core'
import { randomUUID } from 'node:crypto'
import process from 'node:process'
import { resolve } from 'node:path'
import { getReviewSession, reviewCode, resumeReviewSession, startReviewSession } from '@ai-code-review/core'
import { input, select } from '@inquirer/prompts'

const args = process.argv.slice(2)

if (args.includes('--help') || args.includes('-h')) {
  printHelp()
  process.exit(0)
}

const repository = readOption('--repo') ?? readOption('-r') ?? args.find(arg => !arg.startsWith('-')) ?? process.cwd()
const diff = readOption('--diff')
const commitLimitValue = readOption('--limit') ?? readOption('-l')
const commitLimit = commitLimitValue ? Number.parseInt(commitLimitValue, 10) : undefined
const checkpointPath = resolve(readOption('--checkpoint') ?? '.ai-code-review/checkpoints.sqlite')
const threadId = readOption('--thread')
const resumeMode = args.includes('--resume')
const statusMode = args.includes('--status')
const sessionMode = args.includes('--session')
let recoverableSessionContext: { threadId: string, checkpointPath: string } | undefined

process.on('SIGINT', () => {
  printManualInterruptNotice(recoverableSessionContext)
  process.exit(130)
})

try {
  if (statusMode) {
    if (!threadId) {
      throw new Error('`--status` requires `--thread <threadId>`.')
    }

    const session = await getReviewSession(threadId, { checkpointPath })
    console.log(JSON.stringify(session, null, 2))
    process.exit(session.status === 'not_found' ? 1 : 0)
  }

  if (resumeMode) {
    if (!threadId) {
      throw new Error('`--resume` requires `--thread <threadId>`.')
    }

    recoverableSessionContext = { threadId, checkpointPath }
    const snapshot = await getReviewSession(threadId, { checkpointPath })

    if (snapshot.status === 'not_found') {
      throw new Error(`No persisted session found for thread ${threadId}.`)
    }

    const result = snapshot.status === 'interrupted'
      ? await continueInterruptedSession(snapshot, checkpointPath)
      : snapshot

    recoverableSessionContext = undefined
    console.log(JSON.stringify(formatCliOutput(result), null, 2))
    process.exit(0)
  }

  if (sessionMode) {
    const sessionThreadId = threadId ?? randomUUID()
    recoverableSessionContext = { threadId: sessionThreadId, checkpointPath }

    const result = await startReviewSession({
      repository,
      diff,
      commitLimit,
    }, {
      threadId: sessionThreadId,
      checkpointPath,
    })

    const finalResult = result.status === 'interrupted'
      ? await continueInterruptedSession(result, checkpointPath)
      : result

    recoverableSessionContext = undefined
    console.log(JSON.stringify(formatCliOutput(finalResult), null, 2))
    process.exit(0)
  }

  const result = await reviewCode({
    repository,
    diff,
    commitLimit,
    requestHumanFeedback,
    requestPushFeedback,
  })

  console.log(JSON.stringify(formatCliOutput(result), null, 2))
}
catch (error) {
  if (isPromptCancelError(error)) {
    printManualInterruptNotice(recoverableSessionContext)
    process.exit(130)
  }

  const message = error instanceof Error ? error.message : String(error)
  console.error(`ai-code-review failed: ${message}`)
  process.exit(1)
}

async function continueInterruptedSession(
  session: Extract<ReviewSessionSnapshot, { status: 'interrupted' }>,
  checkpointPath: string,
): Promise<ReviewSessionResult> {
  let current: ReviewSessionResult = session

  while (current.status === 'interrupted') {
    printInterruptBanner(current.threadId, checkpointPath)
    const resume = current.interrupt.kind === 'human_feedback'
      ? await requestHumanFeedback(current.interrupt.request)
      : await requestPushFeedback(current.interrupt.request)

    current = await resumeReviewSession({
      threadId: current.threadId,
      resume,
    }, {
      checkpointPath,
    })
  }

  return current
}

function formatCliOutput(result: ReviewSessionResult | Awaited<ReturnType<typeof reviewCode>>) {
  if ('status' in result) {
    return result
  }

  return {
    review: result.review,
    judge: result.judge,
    humanFeedback: result.humanFeedback,
    modify: result.modify,
    commit: result.commit,
    pushPlan: result.pushPlan,
    pushFeedback: result.pushFeedback,
    push: result.push,
  }
}

async function requestHumanFeedback(request: HumanFeedbackRequest): Promise<HumanFeedbackResponse> {
  printFeedbackRequest(request)

  if (!process.stdin.isTTY) {
    return { action: 'declined', message: 'Non-interactive terminal declined by default.' }
  }

  const action = await select<HumanFeedbackResponseAction>({
    message: '请选择处理方式',
    choices: buildFeedbackChoices(request),
  })

  if (action === 'auto_modify') {
    const instruction = (await input({
      message: '可选：补充修改意见',
      default: '',
    })).trim()

    return {
      action,
      message: getFeedbackMessage(action),
      instruction: instruction || undefined,
    }
  }

  return {
    action,
    message: getFeedbackMessage(action),
  }
}

async function requestPushFeedback(request: HumanFeedbackRequest): Promise<HumanFeedbackResponse> {
  printFeedbackRequest(request)

  if (!process.stdin.isTTY) {
    return { action: 'declined', message: 'Non-interactive terminal declined push by default.' }
  }

  const selectedOptionId = await select<string>({
    message: '请选择推送方式',
    choices: [
      ...(request.pushPlan?.options.map(option => ({
        name: option.title,
        value: option.id,
        description: `${option.command} · ${option.risk}`,
      })) ?? []),
      { name: '取消', value: '__declined__', description: '停止推送' },
    ],
  })

  if (selectedOptionId === '__declined__') {
    return { action: 'declined', message: '用户已取消推送。' }
  }

  const selectedOption = request.pushPlan?.options.find(option => option.id === selectedOptionId)

  return {
    action: 'push_selected',
    pushOptionId: selectedOptionId,
    message: selectedOption ? `用户选择推送方式：${selectedOption.command}` : '用户选择了推送方式。',
  }
}

function printInterruptBanner(threadId: string, checkpointPath: string) {
  console.log('')
  console.log(`threadId: ${threadId}`)
  console.log(`checkpoint: ${checkpointPath}`)
  console.log('')
}

function printManualInterruptNotice(context?: { threadId: string, checkpointPath: string }) {
  if (!context) {
    console.error('\n已手动中断。')
    return
  }

  console.error('\n已手动中断，后续可基于以下信息恢复会话：')
  console.error(`threadId: ${context.threadId}`)
  console.error(`checkpoint: ${context.checkpointPath}`)
  console.error(`resume: ai-code-review --resume --thread ${context.threadId} --checkpoint ${context.checkpointPath}`)
}

function isPromptCancelError(error: unknown) {
  return error instanceof Error && error.name === 'ExitPromptError'
}

function printFeedbackRequest(request: HumanFeedbackRequest) {
  console.log(`\n${request.title}`)
  console.log('='.repeat(request.title.length))
  console.log(request.message)

  if (request.modify) {
    printModifySummary(request.modify)
  }

  console.log('')
}

function buildFeedbackChoices(request: HumanFeedbackRequest) {
  if (request.action === 'confirm_push') {
    return [
      { name: '确认推送', value: 'approved' as const, description: '进入推送方式选择' },
      { name: '取消', value: 'declined' as const, description: '停止后续操作' },
    ]
  }

  return [
    { name: '自动修改', value: 'auto_modify' as const, description: '调用 modify/rereview 流程自动修复并复审' },
    { name: '强制推送', value: 'force_push' as const, description: '忽略本次 REJECT 并进入推送方式选择' },
    { name: '取消', value: 'declined' as const, description: '停止后续操作' },
  ]
}

function getFeedbackMessage(action: HumanFeedbackResponseAction) {
  if (action === 'approved') {
    return '用户已确认进入推送方式选择。'
  }

  if (action === 'auto_modify') {
    return '用户选择自动修改。'
  }

  if (action === 'force_push') {
    return '用户选择强制进入推送方式选择。'
  }

  if (action === 'push_selected') {
    return '用户已选择推送方式。'
  }

  return '用户已取消。'
}

function printModifySummary(modify: NonNullable<HumanFeedbackRequest['modify']>) {
  console.log('自动修改')
  console.log(`- 状态: ${modify.success ? 'success' : 'failed'}${modify.skipped ? ' (skipped)' : ''}`)
  console.log(`- 摘要: ${modify.message}`)

  if (modify.changedFiles?.length) {
    console.log('- 修改文件:')
    for (const change of modify.changedFiles) {
      console.log(`  - ${change.file}: ${change.summary}`)
    }
  }
}

function readOption(name: string) {
  const index = args.indexOf(name)

  if (index === -1) {
    return undefined
  }

  return args[index + 1]
}

function printHelp() {
  console.log(`ai-code-review

Usage:
  ai-code-review [repoPath]
  ai-code-review --session --repo <repoPath>
  ai-code-review --resume --thread <threadId>
  ai-code-review --status --thread <threadId>

Options:
  -r, --repo           Repository path. Defaults to current working directory.
  -l, --limit          Commit count for collect step. Defaults to 5.
  --diff               Raw diff text. Skips collect step.
  --session            Run with persisted checkpoints and interrupt/resume support. Manual interrupt prints threadId.
  --resume             Resume an interrupted persisted session.
  --status             Print the latest persisted session snapshot.
  --thread             Explicit thread id for session/resume/status.
  --checkpoint         Checkpoint file path. Defaults to ./.ai-code-review/checkpoints.json
  -h, --help           Show this help message.
`)
}
