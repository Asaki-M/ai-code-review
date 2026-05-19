import type { ModifyInput, ModifyResult } from '../../schemas/modify.js'
import { tool } from '@langchain/core/tools'
import { ChatVertexAI } from '@langchain/google-vertexai'
import { createOpencode } from '@opencode-ai/sdk/v2'
import { createAgent } from 'langchain'
import { z } from 'zod'
import { modifyInputSchema, modifyResultSchema } from '../../schemas/modify.js'
import { formatOpencodeError, formatSchemaIssues, parseJsonResponse } from '../../shared/opencode.js'

const modifyResultJsonSchema = z.toJSONSchema(modifyResultSchema)
const llm = new ChatVertexAI({
  model: 'gemini-2.5-pro',
  temperature: 0,
  maxRetries: 2,
})

async function modifyCommitContext(input: ModifyInput) {
  const { repository } = input
  const { client, server } = await createOpencode()

  try {
    const session = (await client.session.create({
      directory: repository,
      title: 'Code Review Modification',
    })).data

    if (!session || !session.id) {
      return JSON.stringify(buildFallbackResult('Opencode session 创建失败'))
    }

    const promptResponse = await client.session.prompt({
      directory: repository,
      sessionID: session.id,
      parts: [
        {
          type: 'text',
          text: buildModifyPrompt(input),
        },
      ],
    })

    if (!promptResponse.data) {
      return JSON.stringify(buildFallbackResult(
        promptResponse.error ? `Opencode 未返回 data：${JSON.stringify(promptResponse.error)}` : 'Opencode 未返回 data',
        session.id,
      ))
    }

    const result = promptResponse.data

    if (result.info.error) {
      return JSON.stringify(buildFallbackResult(
        `Opencode prompt 返回错误：${formatOpencodeError(result.info.error)}`,
        session.id,
      ))
    }

    const diff = (await client.session.diff({
      sessionID: session.id,
      directory: repository,
      messageID: result.info.id,
    })).data

    const { response, validated } = parseJsonResponse(result.parts, modifyResultSchema)
    const changedFiles = summarizeDiff(diff)

    if (!validated?.success) {
      return JSON.stringify(buildFallbackResult(
        validated
          ? `Opencode 返回的 JSON 不符合 ModifyResult：${formatSchemaIssues(validated.error)}`
          : 'Opencode 未返回可解析的 JSON 文本',
        session.id,
        response,
        changedFiles,
      ))
    }

    return JSON.stringify({
      ...validated.data,
      sessionId: session.id,
      response,
      changedFiles: validated.data.changedFiles?.length ? validated.data.changedFiles : changedFiles,
    } satisfies ModifyResult)
  }
  catch (error) {
    return JSON.stringify(buildFallbackResult(
      `修改提交内容失败：${error instanceof Error ? error.message : String(error)}`,
    ))
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
    '- 完成后直接返回 JSON 文本，不要使用结构化输出能力，建议放在 ```json 代码块里。',
    '- 文本回复可简短说明做了什么，但 JSON 必须符合给定 Schema。',
    '',
    'review 结果：',
    JSON.stringify(review, null, 2),
    '',
    'commit context：',
    commitContext ?? '(none)',
    '',
    '用户补充说明：',
    instruction ?? '(none)',
    '',
    'JSON Schema 参考：',
    JSON.stringify(modifyResultJsonSchema, null, 2),
  ].join('\n')
}

function summarizeDiff(diff: Array<{
  file?: string
  status?: 'added' | 'deleted' | 'modified'
  additions: number
  deletions: number
}> | undefined) {
  if (!diff?.length) {
    return undefined
  }

  return diff.map(change => ({
    file: change.file ?? '(unknown)',
    summary: `${change.status ?? 'modified'} (+${change.additions}/-${change.deletions})`,
  }))
}

function buildFallbackResult(
  message: string,
  sessionId?: string,
  response?: string,
  changedFiles?: ModifyResult['changedFiles'],
): ModifyResult {
  return {
    success: false,
    skipped: true,
    message,
    sessionId,
    response,
    changedFiles,
  }
}
