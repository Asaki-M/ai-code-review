import type { ModifyInput, ModifyResult } from '../../schemas/modify.js'
import { tool } from '@langchain/core/tools'
import { ChatVertexAI } from '@langchain/google-vertexai'
import { createOpencode } from '@opencode-ai/sdk/v2'
import { createAgent } from 'langchain'
import { z } from 'zod'
import { modifyInputSchema, modifyResultSchema } from '../../schemas/modify.js'

const modifyResultJsonSchema = z.toJSONSchema(modifyResultSchema)

async function modifyCommitContext(input: ModifyInput) {
  const { repository } = input
  const { client, server } = await createOpencode()

  try {
    const session = (await client.session.create({
      directory: repository,
      title: 'Code Review Modification',
    })).data

    if (!session || !session.id) {
      return JSON.stringify({
        success: false,
        skipped: true,
        message: 'Opencode session 创建失败',
      } satisfies ModifyResult)
    }

    const result = (await client.session.prompt({
      directory: repository,
      sessionID: session.id,
      format: {
        type: 'json_schema',
        schema: modifyResultJsonSchema,
        retryCount: 2,
      },
      parts: [
        {
          type: 'text',
          text: buildModifyPrompt(input),
        },
      ],
    })).data

    if (!result) {
      return JSON.stringify({
        success: false,
        skipped: true,
        sessionId: session.id,
        message: '未收到 Opencode 的修改结果',
      } satisfies ModifyResult)
    }

    if (result.info.error?.name === 'StructuredOutputError') {
      return JSON.stringify({
        success: false,
        skipped: true,
        sessionId: session.id,
        response: getTextFromParts(result.parts),
        message: `结构化输出失败：${result.info.error.data.message}`,
      } satisfies ModifyResult)
    }

    const structured = modifyResultSchema.parse(result.info.structured)

    return JSON.stringify({
      ...structured,
      sessionId: session.id,
      response: getTextFromParts(result.parts),
    } satisfies ModifyResult)
  }
  catch (error) {
    return JSON.stringify({
      success: false,
      skipped: true,
      message: `修改提交内容失败：${error instanceof Error ? error.message : String(error)}`,
    } satisfies ModifyResult)
  }
  finally {
    server.close()
  }
}

const modifyCommitTool = tool(modifyCommitContext, {
  name: 'modifyCommitTool',
  description: '调用 opencode sdk，根据 review 结果自动修改仓库工作区中的代码。',
  schema: modifyInputSchema,
})

const llm = new ChatVertexAI({
  model: 'gemini-2.5-pro',
  temperature: 0,
  maxRetries: 2,
})

export const modifyAgent = createAgent({
  model: llm,
  tools: [modifyCommitTool],
  responseFormat: modifyResultSchema,
  systemPrompt: `
你是代码自动修改执行助手。你负责把 review agent 的结构化结果转换为实际代码修改动作。

# 执行规则
- 必须调用 modifyCommitTool。
- 必须把输入中的 repository、review、commitContext、instruction 原样传给 tool，不要自行编造路径或审查结果。
- 自动修改的目标是修复 review findings 中明确指出的问题，优先采用最小必要修改。
- 不要执行 git commit、git push 或其他与修复无关的操作。
- 输出必须符合 ModifyResult。
- 不要输出 Markdown、寒暄或额外字段。
`,
})

function buildModifyPrompt({ review, commitContext, instruction }: ModifyInput) {
  return [
    '你是代码修改执行助手，请直接修改当前仓库工作区代码来修复 review 结果中的问题。',
    '',
    '执行要求：',
    '- 只做解决问题所需的最小修改。',
    '- 优先修复 findings 中明确的问题。',
    '- 不要执行 git commit、git push 或改写无关文件。',
    '- 如果某个问题信息不足以安全修改，可以跳过并在结果里说明原因。',
    '- 完成后通过结构化输出返回修改结果；文本回复可简短说明做了什么。',
    '',
    'review 结果：',
    JSON.stringify(review, null, 2),
    '',
    'commit context：',
    commitContext ?? '(none)',
    '',
    '用户补充说明：',
    instruction ?? '(none)',
  ].join('\n')
}

function getTextFromParts(parts: Array<{ type?: string, text?: string }> | undefined) {
  const textParts = parts
    ?.filter(part => part.type === 'text' && typeof part.text === 'string')
    .map(part => part.text?.trim())
    .filter(Boolean)

  return textParts?.join('\n').trim()
}
