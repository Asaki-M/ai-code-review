import { z } from 'zod'

export const pushPlanOptionSchema = z.object({
  id: z.string().describe('稳定的选项 ID，例如 push-current、push-head-to-feat'),
  title: z.string().describe('给用户看的简短标题'),
  description: z.string().describe('说明这个推送方式适用场景和影响'),
  remote: z.string().describe('git remote 名称，例如 origin'),
  source: z.string().describe('本地推送源引用，例如 HEAD 或当前分支名'),
  destination: z.string().describe('远端目标分支名，不包含 refs/heads/ 前缀'),
  command: z.string().describe('展示给用户确认的 git push 命令'),
  risk: z.enum(['low', 'medium', 'high']).describe('推送风险等级'),
})

export const pushPlanSchema = z.object({
  summary: z.string().describe('当前仓库推送上下文总结'),
  recommendedOptionId: z.string().describe('推荐用户选择的选项 ID'),
  options: z.array(pushPlanOptionSchema).min(1).max(5).describe('候选推送方式'),
})

export const pushResultSchema = z.object({
  success: z.boolean().describe('是否推送成功'),
  skipped: z.boolean().describe('是否跳过推送'),
  selectedOption: pushPlanOptionSchema.optional().describe('实际选择并执行的推送方案'),
  command: z.string().optional().describe('实际执行的 git push 命令'),
  stdout: z.string().optional().describe('推送结果输出'),
  stderr: z.string().optional().describe('推送错误输出'),
  message: z.string().describe('推送结果说明'),
})

export type PushPlanOption = z.infer<typeof pushPlanOptionSchema>
export type PushPlan = z.infer<typeof pushPlanSchema>
export type PushResult = z.infer<typeof pushResultSchema>
