import { z } from 'zod'

export const commitResultSchema = z.object({
  success: z.boolean().describe('是否成功创建提交'),
  skipped: z.boolean().describe('是否跳过提交'),
  commitHash: z.string().optional().describe('新创建的 commit hash'),
  commitMessage: z.string().optional().describe('实际使用的提交信息'),
  stagedFiles: z.array(z.string()).optional().describe('本次提交包含的文件路径'),
  message: z.string().describe('提交结果说明'),
})

export type CommitResult = z.infer<typeof commitResultSchema>
