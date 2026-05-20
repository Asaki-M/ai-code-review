import type { WorkflowUserInstruction } from '../schemas/instruction.js'

export function hasNewUserInstruction(instruction: string | undefined) {
  return Boolean(normalizeInstruction(instruction))
}

export function getLatestUserInstruction(instruction: string | undefined) {
  return normalizeInstruction(instruction)
}

export function buildReviewInstructionPrompt(userInstruction: WorkflowUserInstruction | undefined) {
  return userInstruction?.reviewInstruction
}

export function buildModifyInstructionPrompt(userInstruction: WorkflowUserInstruction | undefined) {
  return userInstruction?.modifyInstruction
}

function normalizeInstruction(instruction: string | undefined) {
  const normalized = instruction?.trim()
  return normalized || undefined
}
