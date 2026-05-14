#!/usr/bin/env node
import process from 'node:process'
import { reviewCode } from '@ai-code-review/core'
import { select } from '@inquirer/prompts'
import type { HumanFeedbackRequest, HumanFeedbackResponse, HumanFeedbackResponseAction } from '@ai-code-review/core'

const args = process.argv.slice(2)

if (args.includes('--help') || args.includes('-h')) {
  printHelp()
  process.exit(0)
}

const repository = readOption('--repo') ?? readOption('-r') ?? args.find(arg => !arg.startsWith('-')) ?? process.cwd()
const diff = readOption('--diff')
const commitLimitValue = readOption('--limit') ?? readOption('-l')
const commitLimit = commitLimitValue ? Number.parseInt(commitLimitValue, 10) : undefined

try {
  const result = await reviewCode({
    repository,
    diff,
    commitLimit,
    requestHumanFeedback,
    requestPushFeedback,
  })

  console.log(JSON.stringify(formatCliResult(result), null, 2))
}
catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`ai-code-review failed: ${message}`)
  process.exit(1)
}

function formatCliResult(result: Awaited<ReturnType<typeof reviewCode>>) {
  return {
    review: result.review,
    judge: result.judge,
    humanFeedback: result.humanFeedback,
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

  return {
    action,
    message: getFeedbackMessage(action),
  }
}

function printFeedbackRequest(request: HumanFeedbackRequest) {
  console.log(`\n${request.title}`)
  console.log('='.repeat(request.title.length))
  console.log(request.message)
  console.log('')
}

function buildFeedbackChoices(request: HumanFeedbackRequest) {
  if (request.action === 'select_push') {
    return [
      ...(request.pushPlan?.options.map(option => ({
        name: option.title,
        value: 'push_selected' as const,
        description: option.command,
      })) ?? []),
      { name: '取消', value: 'declined' as const, description: '停止推送' },
    ]
  }

  if (request.action === 'confirm_push') {
    return [
      { name: '确认推送', value: 'approved' as const, description: '进入推送方式选择' },
      { name: '取消', value: 'declined' as const, description: '停止后续操作' },
    ]
  }

  return [
    { name: '自动修改', value: 'auto_modify' as const, description: '后续接入 modify agent 后自动修复问题' },
    { name: '强制推送', value: 'force_push' as const, description: '忽略本次 REJECT 并进入推送方式选择' },
    { name: '取消', value: 'declined' as const, description: '停止后续操作' },
  ]
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
  ai-code-review --repo <repoPath> --limit <n>
  ai-code-review --diff <diffText>

Options:
  -r, --repo    Repository path. Defaults to current working directory.
  -l, --limit   Commit count for collect step. Defaults to 5.
  --diff        Raw diff text. Skips collect step.
  -h, --help    Show this help message.
`)
}
