import type { VerificationInput, VerificationPlan } from '../../schemas/verify.js'
import { tool } from '@langchain/core/tools'
import { ChatVertexAI } from '@langchain/google-vertexai'
import { createOpencode } from '@opencode-ai/sdk/v2'
import { createAgent } from 'langchain'
import { z } from 'zod'
import { verificationInputSchema, verificationPlanSchema, verificationResultSchema } from '../../schemas/verify.js'
import { formatOpencodeError, formatSchemaIssues, getTextFromParts, parseJsonResponse } from '../../shared/opencode.js'

const verificationPlanJsonSchema = z.toJSONSchema(verificationPlanSchema)
const verificationResultJsonSchema = z.toJSONSchema(verificationResultSchema)
const llm = new ChatVertexAI({
  model: 'gemini-2.5-pro',
  temperature: 0,
  maxRetries: 2,
})

async function verifyRepository(input: VerificationInput) {
  const { repository } = input
  const { client, server } = await createOpencode()

  try {
    const session = (await client.session.create({
      directory: repository,
      title: 'Code Review Verification',
    })).data

    if (!session?.id) {
      return JSON.stringify(buildFallbackResult(repository, 'Opencode session 创建失败'))
    }

    const planPromptResponse = await client.session.prompt({
      directory: repository,
      sessionID: session.id,
      parts: [
        {
          type: 'text',
          text: buildPlanPrompt(input),
        },
      ],
    })

    if (!planPromptResponse.data) {
      return JSON.stringify(buildFallbackResult(
        repository,
        planPromptResponse.error ? `未收到验证计划结果：${JSON.stringify(planPromptResponse.error)}` : '未收到验证计划结果',
        session.id,
      ))
    }

    const planResponse = planPromptResponse.data

    if (planResponse.info.error) {
      return JSON.stringify(buildFallbackResult(
        repository,
        `验证计划返回错误：${formatOpencodeError(planResponse.info.error)}`,
        session.id,
      ))
    }

    const { validated: validatedPlan } = parseJsonResponse(planResponse.parts, verificationPlanSchema)

    if (!validatedPlan?.success) {
      return JSON.stringify(buildFallbackResult(
        repository,
        validatedPlan
          ? `验证计划 JSON 不符合 VerificationPlan：${formatSchemaIssues(validatedPlan.error)}`
          : '验证计划未返回可解析的 JSON 文本',
        session.id,
      ))
    }

    const plan = validatedPlan.data

    if (plan.tasks.length === 0) {
      return JSON.stringify({
        ok: true,
        skipped: true,
        plan,
        tasks: [],
        message: '未检测到可执行的 lint/typecheck/test/build 命令，已跳过验证。',
        sessionId: session.id,
        response: getTextFromParts(planResponse.parts),
      })
    }

    const executePromptResponse = await client.session.prompt({
      directory: repository,
      sessionID: session.id,
      parts: [
        {
          type: 'text',
          text: buildExecutePrompt(plan, input),
        },
      ],
    })

    if (!executePromptResponse.data) {
      return JSON.stringify(buildFallbackResult(
        repository,
        executePromptResponse.error ? `未收到验证执行结果：${JSON.stringify(executePromptResponse.error)}` : '未收到验证执行结果',
        session.id,
        plan,
      ))
    }

    const executeResponse = executePromptResponse.data

    if (executeResponse.info.error) {
      return JSON.stringify(buildFallbackResult(
        repository,
        `验证执行返回错误：${formatOpencodeError(executeResponse.info.error)}`,
        session.id,
        plan,
      ))
    }

    const { validated: validatedResult } = parseJsonResponse(executeResponse.parts, verificationResultSchema)

    if (!validatedResult?.success) {
      return JSON.stringify(buildFallbackResult(
        repository,
        validatedResult
          ? `验证执行 JSON 不符合 VerificationResult：${formatSchemaIssues(validatedResult.error)}`
          : '验证执行未返回可解析的 JSON 文本',
        session.id,
        plan,
      ))
    }

    return JSON.stringify({
      ...validatedResult.data,
      plan,
      sessionId: session.id,
      response: getTextFromParts(executeResponse.parts),
    })
  }
  catch (error) {
    return JSON.stringify(buildFallbackResult(
      repository,
      `执行验证失败：${error instanceof Error ? error.message : String(error)}`,
    ))
  }
  finally {
    server.close()
  }
}

const verifyRepositoryTool = tool(verifyRepository, {
  name: 'verifyRepositoryTool',
  description: '调用 opencode sdk 识别仓库中的 lint/typecheck/test/build 命令并执行验证。',
  schema: verificationInputSchema,
})

export const verifyAgent = createAgent({
  model: llm,
  tools: [verifyRepositoryTool],
  responseFormat: verificationResultSchema,
  systemPrompt: `
你是代码验证执行助手。你负责识别项目里的 lint、typecheck、test、build 命令，并执行这些验证。

# 执行规则
- 必须调用 verifyRepositoryTool。
- 必须把输入中的 repository、instruction 原样传给 tool，不要自行编造路径。
- 优先使用仓库中真实存在的命令，例如 package.json scripts、Makefile、go test、cargo test 等。
- 不要修改代码，不要执行 git commit、git push。
- 输出必须符合 VerificationResult。
- 不要输出 Markdown、寒暄或额外字段。
`,
})

function buildPlanPrompt({ instruction }: VerificationInput) {
  return [
    '你是代码验证规划助手，请检查当前仓库中可用的验证命令，并生成 JSON 文本形式的验证计划。',
    '',
    '要求：',
    '- 优先从 package.json、Makefile、justfile、go.mod、Cargo.toml、pyproject.toml 等实际配置中查找命令。',
    '- 只识别 lint、typecheck、test、build 四类任务。',
    '- command 必须是可以直接在 shell 中执行的单条命令。',
    '- source 必须指出命令来源，例如 package.json:scripts.lint。',
    '- cwd 使用实际应执行命令的目录。',
    '- 如果仓库没有某类任务，不要臆造命令。',
    '- 如果完全找不到可执行验证命令，返回空 tasks。',
    '- 不要使用结构化输出能力，直接返回 JSON 文本，建议放在 ```json 代码块里。',
    '',
    '用户补充说明：',
    instruction ?? '(none)',
    '',
    'JSON Schema 参考：',
    JSON.stringify(verificationPlanJsonSchema, null, 2),
  ].join('\n')
}

function buildExecutePrompt(plan: VerificationPlan, { instruction }: VerificationInput) {
  return [
    '你是代码验证执行助手，请按给定验证计划在当前仓库执行命令，并返回 JSON 文本形式的验证结果。',
    '',
    '执行要求：',
    '- 严格按 plan.cwd 和每个 task.command 执行。',
    '- 需要真实执行命令，不要猜测结果。',
    '- stdout/stderr 尽量保留关键输出；如果过长，可以摘要但要保留失败原因。',
    '- durationMs、exitCode、timedOut、signal、ok 必须按实际执行情况填写。',
    '- ok 表示所有 required 任务都通过；skipped 仅在没有任务执行时为 true。',
    '- plan 字段必须与输入计划一致。',
    '- 不要修改代码或安装新依赖，除非仓库本身已有明确脚本并且执行脚本本身会触发必要准备步骤。',
    '- 不要使用结构化输出能力，直接返回 JSON 文本，建议放在 ```json 代码块里。',
    '',
    '验证计划：',
    JSON.stringify(plan, null, 2),
    '',
    '用户补充说明：',
    instruction ?? '(none)',
    '',
    'JSON Schema 参考：',
    JSON.stringify(verificationResultJsonSchema, null, 2),
  ].join('\n')
}

function buildFallbackResult(
  repository: string,
  message: string,
  sessionId?: string,
  plan: VerificationPlan = { cwd: repository, tasks: [] },
) {
  return {
    ok: false,
    skipped: true,
    plan,
    tasks: [],
    message,
    sessionId,
  }
}
