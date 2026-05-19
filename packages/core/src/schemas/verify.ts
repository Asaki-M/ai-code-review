import { z } from 'zod'

export const verificationTaskNameSchema = z.enum(['lint', 'typecheck', 'test', 'build'])

export const verificationInputSchema = z.object({
  repository: z.string().describe('项目本地路径'),
  instruction: z.string().optional().describe('用户对验证阶段的补充说明'),
})

export const verificationTaskSchema = z.object({
  name: verificationTaskNameSchema.describe('验证任务类型'),
  command: z.string().describe('要执行的验证命令'),
  required: z.boolean().describe('失败时是否导致整体验证失败'),
  source: z.string().describe('命令来源，例如 package.json、go.mod、Cargo.toml'),
  timeoutMs: z.number().int().positive().optional().describe('单个命令超时时间'),
})

export const verificationPlanSchema = z.object({
  cwd: z.string().describe('执行验证命令的工作目录'),
  packageManager: z.enum(['pnpm', 'npm', 'yarn', 'bun']).optional().describe('检测到的 JS 包管理器'),
  tasks: z.array(verificationTaskSchema).describe('检测到并准备执行的验证任务'),
})

export const verificationTaskResultSchema = z.object({
  name: verificationTaskNameSchema,
  command: z.string(),
  required: z.boolean(),
  source: z.string(),
  ok: z.boolean(),
  exitCode: z.number().int().nullable(),
  signal: z.string().nullable(),
  timedOut: z.boolean(),
  stdout: z.string(),
  stderr: z.string(),
  durationMs: z.number().int().nonnegative(),
})

export const verificationResultSchema = z.object({
  ok: z.boolean().describe('所有 required 验证任务是否通过'),
  skipped: z.boolean().describe('是否因为没有检测到任务而跳过执行'),
  plan: verificationPlanSchema,
  tasks: z.array(verificationTaskResultSchema),
  message: z.string().describe('验证结果摘要'),
})

export type VerificationTaskName = z.infer<typeof verificationTaskNameSchema>
export type VerificationInput = z.infer<typeof verificationInputSchema>
export type VerificationTask = z.infer<typeof verificationTaskSchema>
export type VerificationPlan = z.infer<typeof verificationPlanSchema>
export type VerificationTaskResult = z.infer<typeof verificationTaskResultSchema>
export type VerificationResult = z.infer<typeof verificationResultSchema>
