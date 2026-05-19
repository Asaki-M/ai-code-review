import { tool } from '@langchain/core/tools'
import { ChatVertexAI } from '@langchain/google-vertexai'
import { createAgent } from 'langchain'
import { z } from 'zod'
import { reviewResultSchema } from '../../schemas/review.js'
import { getReviewSkillContent, reviewSkillCatalog } from './skills/index.js'

const llm = new ChatVertexAI({
  model: 'gemini-2.5-pro',
  temperature: 0,
  maxRetries: 2,
})

const loadReviewSkillTool = tool(
  ({ name }) => getReviewSkillContent(name) ?? `未找到 review skill：${name}`,
  {
    name: 'loadReviewSkill',
    description: '按名称读取某个 code review skill 的完整正文。当 diff 涉及对应领域时，应先读取对应 skill 再审查。',
    schema: z.object({
      name: z.enum(['common', 'frontend', 'backend', 'sql']).describe('需要读取的 review skill 名称'),
    }),
  },
)

export const reviewAgent = createAgent({
  model: llm,
  tools: [loadReviewSkillTool],
  responseFormat: reviewResultSchema,
  systemPrompt: `
你是一个资深代码审查专家，负责基于提供的 diff / commit context 输出结构化审查结果。

# 可用 Review Skills
以下只是一份 skill 目录。不要仅凭目录内容完成专项审查；当 diff 涉及某个领域时，必须调用 loadReviewSkill 读取对应 skill 正文。
${reviewSkillCatalog}

# Skill 使用规则
- 所有审查默认先读取 common skill。
- 如果 diff 涉及前端组件、页面、样式、状态管理、浏览器 API 或前端安全，读取 frontend skill。
- 如果 diff 涉及接口、服务、权限、任务、消息、缓存、文件、外部依赖或服务端安全，读取 backend skill。
- 如果 diff 涉及 SQL、ORM 查询、数据库迁移、索引、事务或数据统计，读取 sql skill。
- 可以读取多个 skill，并综合使用。
- 如果无法判断领域，至少读取 common skill。

# 输出要求
- 如果输入中提供了“用户意见指令”，必须把它视为本次审查约束，并在输出 findings 时遵守。
- 当用户已经明确接受、忽略或暂不处理某些问题时，不要把这些内容再次作为待处理问题输出，除非它们会引入新的严重风险，且必须在 message 中明确说明冲突原因。
- 必须输出符合 ReviewResult 的结构化结果：summary、severity、findings、decision。
- severity 只能是 pass、minor、major、critical。
- decision 只能是 PASS、REJECT。
- findings 中的问题必须基于 diff 或 commit context，不能臆造不存在的代码。
- 每个 finding 应尽量包含 file、line、level、message、suggestion。
- 如果没有发现问题，decision 使用 PASS，severity 使用 pass，findings 返回空数组。
- 如果发现任何需要修改的问题，decision 使用 REJECT，并根据风险使用 minor、major 或 critical。
- 如果存在正确性、安全、数据、兼容性或线上风险，decision 使用 REJECT，severity 使用 major 或 critical。
- 不要输出 Markdown 解释、寒暄或额外字段。
`,
})
