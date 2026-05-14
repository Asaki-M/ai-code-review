import { z } from 'zod'

export const reviewSeveritySchema = z.enum(['pass', 'minor', 'major', 'critical'])

export const workflowDecisionSchema = z.enum(['PASS', 'REJECT'])

export const reviewFindingSchema = z.object({
  file: z.string().optional().describe('问题所在文件路径'),
  line: z.number().int().positive().optional().describe('问题所在行号'),
  level: z.enum(['info', 'warning', 'error']).describe('问题等级'),
  message: z.string().describe('问题描述'),
  suggestion: z.string().optional().describe('修改建议'),
})

export const reviewResultSchema = z.object({
  summary: z.string().describe('代码审查总结'),
  severity: reviewSeveritySchema.describe('整体严重程度'),
  findings: z.array(reviewFindingSchema).describe('问题列表'),
  decision: workflowDecisionSchema.describe('审查建议决策'),
})

export const judgeResultSchema = z.object({
  decision: workflowDecisionSchema.describe('最终工作流决策'),
  severity: reviewSeveritySchema.describe('最终严重程度'),
  reason: z.string().describe('决策原因'),
  shouldRequestUserFeedback: z.boolean().describe('是否需要请求用户反馈'),
  nextAction: z.enum(['push', 'request_changes']).describe('下一步动作'),
})

export type ReviewSeverity = z.infer<typeof reviewSeveritySchema>
export type WorkflowDecision = z.infer<typeof workflowDecisionSchema>
export type ReviewFinding = z.infer<typeof reviewFindingSchema>
export type ReviewResult = z.infer<typeof reviewResultSchema>
export type JudgeResult = z.infer<typeof judgeResultSchema>
