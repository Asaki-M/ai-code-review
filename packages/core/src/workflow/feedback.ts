import type { PushPlan } from '../schemas/push.js'
import type { JudgeResult, ReviewResult } from '../schemas/review.js'
import type { HumanFeedbackRequest } from '../schemas/workflow.js'

export function buildHumanFeedbackRequest(reviewResult: ReviewResult, judgeResult: JudgeResult): HumanFeedbackRequest {
  if (judgeResult.decision === 'PASS') {
    return {
      action: 'confirm_push',
      title: '确认是否推送',
      message: `${judgeResult.reason}\n\n审查已通过，请确认是否继续推送。`,
      options: ['approved', 'declined'],
      review: reviewResult,
      judge: judgeResult,
    }
  }

  return {
    action: 'approve_changes',
    title: '审查未通过，请选择处理方式',
    message: formatChangeRequestMessage(reviewResult, judgeResult),
    options: ['auto_modify', 'force_push', 'declined'],
    review: reviewResult,
    judge: judgeResult,
  }
}

export function buildPushFeedbackRequest(reviewResult: ReviewResult, judgeResult: JudgeResult, pushPlan: PushPlan): HumanFeedbackRequest {
  return {
    action: 'select_push',
    title: '选择推送方式',
    message: formatPushPlanMessage(pushPlan),
    options: ['push_selected', 'declined'],
    review: reviewResult,
    judge: judgeResult,
    pushPlan,
  }
}

function formatPushPlanMessage(pushPlan: PushPlan) {
  const options = pushPlan.options.map((option, index) => {
    const recommended = option.id === pushPlan.recommendedOptionId ? '（推荐）' : ''

    return [
      `${index + 1}. ${option.title}${recommended}`,
      `   命令：${option.command}`,
      `   风险：${option.risk}`,
      `   说明：${option.description}`,
    ].join('\n')
  })

  return [pushPlan.summary, '', '请选择实际推送方式：', options.join('\n')].join('\n')
}

function formatChangeRequestMessage(reviewResult: ReviewResult, judgeResult: JudgeResult) {
  const findings = reviewResult.findings.map((finding, index) => {
    const location = [finding.file, finding.line].filter(Boolean).join(':')
    const prefix = location ? `${index + 1}. ${location}` : `${index + 1}.`
    const suggestion = finding.suggestion ? `\n   建议：${finding.suggestion}` : ''

    return `${prefix} [${finding.level}] ${finding.message}${suggestion}`
  })

  return [
    judgeResult.reason,
    '',
    '请确认如何处理以下问题：',
    findings.length > 0 ? findings.join('\n') : '- 无具体问题列表',
  ].join('\n')
}
