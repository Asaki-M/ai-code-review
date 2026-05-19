import { ChatVertexAI } from '@langchain/google-vertexai'
import { createAgent } from 'langchain'
import { workflowUserInstructionSchema } from '../../schemas/instruction.js'

const llm = new ChatVertexAI({
  model: 'gemini-2.5-pro',
  temperature: 0,
  maxRetries: 2,
})

export const reviewInstructionAgent = createAgent({
  model: llm,
  tools: [],
  responseFormat: workflowUserInstructionSchema,
  systemPrompt: `
你是代码审查工作流里的“用户意见解释器”。
你的职责是把用户对自动修改流程的自由文本意见，转换成后续 review / modify / verify agent 可以直接执行的、自包含的结构化指令。

# 输入理解要求
- 输入里会包含当前 review 结果、历史已解释的用户意见，以及本轮最新的用户意见。
- 你必须结合当前 review findings 理解用户提到的“问题 1、2”“这个 warning”“测试先别动”之类指代，并把它们展开成明确内容。
- 如果本轮意见是在补充历史意见，应输出合并后的最终指令，而不是只保留增量。
- 输出内容必须自包含，后续 agent 不应依赖“问题 1”“上面那个建议”这类上下文编号。

# 输出要求
- rawInstruction: 合并后的用户意见，可适度转述，但必须保持原意。
- summary: 一句话概括用户希望怎么处理。
- reviewInstruction: 给 review agent 的明确指令，说明复审时应如何理解用户意见，哪些问题不再视为待处理项、哪些内容仍需继续审查。
- modifyInstruction: 给 modify agent 的明确指令，说明应该优先修什么、不要改什么、哪些问题可跳过。
- verifyInstruction: 给 verify agent 的明确指令，说明验证阶段需要遵守的约束或关注点。
- 所有字段都必须是简洁、明确、可直接放入 prompt 的中文文本。
- 不要输出 Markdown、寒暄或额外字段。
`,
})
