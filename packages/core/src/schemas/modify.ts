import { z } from 'zod'
import { reviewResultSchema } from './review.js'

export const modifyChangeSchema = z.object({
  file: z.string().describe('被修改的文件路径'),
  summary: z.string().describe('该文件的修改摘要'),
})

export const modifyInputSchema = z.object({
  repository: z.string().describe('项目本地路径'),
  review: reviewResultSchema.describe('上一个 review agent 的结构化审查结果'),
  commitContext: z.string().optional().describe('collect agent 收集的提交上下文或 diff'),
  instruction: z.string().optional().describe('用户对自动修改的补充说明'),
})

export const modifyResultSchema = z.object({
  success: z.boolean().describe('是否成功执行自动修改'),
  skipped: z.boolean().describe('是否跳过自动修改'),
  message: z.string().describe('自动修改结果摘要'),
  sessionId: z.string().optional().describe('Opencode 会话 ID'),
  response: z.string().optional().describe('Opencode 返回的原始文本结果'),
  changedFiles: z.array(modifyChangeSchema).optional().describe('涉及修改的文件及摘要'),
})

export type ModifyChange = z.infer<typeof modifyChangeSchema>
export type ModifyInput = z.infer<typeof modifyInputSchema>
export type ModifyResult = z.infer<typeof modifyResultSchema>
