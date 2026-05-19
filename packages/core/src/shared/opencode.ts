import type { z } from 'zod'

const jsonBlockPattern = /```(?:json)?\r?\n([\s\S]*?)\r?\n```/

export interface OpencodeTextPart {
  type?: string
  text?: string
}

export interface OpencodeError {
  name: string
  data?: {
    message?: string
  }
}

export function getTextFromParts(parts: OpencodeTextPart[] | undefined) {
  const textParts = parts
    ?.filter(part => part.type === 'text' && typeof part.text === 'string')
    .map(part => part.text?.trim())
    .filter(Boolean)

  return textParts?.join('\n').trim()
}

export function extractJson(text: string) {
  const fenced = text.match(jsonBlockPattern)?.[1] ?? text

  try {
    return JSON.parse(fenced) as unknown
  }
  catch {
    return null
  }
}

export function parseJsonResponse<T>(parts: OpencodeTextPart[] | undefined, schema: z.ZodType<T>) {
  const response = getTextFromParts(parts)
  const parsed = response ? extractJson(response) : null
  const validated = parsed ? schema.safeParse(parsed) : null

  return { response, validated }
}

export function formatSchemaIssues(error: z.ZodError) {
  return error.issues
    .map(issue => `${issue.path.join('.') || '(root)'} ${issue.message}`)
    .join('; ')
}

export function formatOpencodeError(error: OpencodeError) {
  return error.data?.message ? `${error.name}: ${error.data.message}` : error.name
}
