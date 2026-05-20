import { z } from 'zod'

export const workflowUserInstructionSchema = z.object({
  rawInstruction: z.string().describe('归并后的用户意见原文或等价转述'),
  summary: z.string().describe('对用户意见的简洁摘要'),
  reviewInstruction: z.string().describe('提供给后续 review agent 的自包含执行指令'),
  modifyInstruction: z.string().describe('提供给 modify agent 的自包含执行指令'),
})

export type WorkflowUserInstruction = z.infer<typeof workflowUserInstructionSchema>
