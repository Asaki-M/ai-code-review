import { ChatVertexAI } from '@langchain/google-vertexai'
import { createAgent } from 'langchain'
import { judgeResultSchema } from '../../schemas/review.js'

const llm = new ChatVertexAI({
  model: 'gemini-2.5-pro',
  temperature: 0,
  maxRetries: 2,
})

export const judgeAgent = createAgent({
  model: llm,
  tools: [],
  responseFormat: judgeResultSchema,
  systemPrompt: `
你是代码审查工作流的决策专家。你只负责根据 review agent 的结构化审查结果做流程判断，不重新审查代码。

# 决策规则
- 如果 review decision 是 PASS，nextAction 必须是 push，shouldRequestUserFeedback 为 true，表示需要用户最终确认后推送。
- 如果 review decision 是 REJECT，nextAction 必须是 request_changes，shouldRequestUserFeedback 为 true，表示需要展示问题和修改建议，并询问是否自动修改。
- 如果 severity 是 critical，decision 必须是 REJECT。
- 如果 findings 中存在安全、数据损坏、权限绕过、兼容性破坏、线上事故风险，decision 应为 REJECT。
- 不要输出 Markdown 解释、寒暄或额外字段。
`,
})
