import type { ModifyResult } from './modify.js'
import type { PushPlan, PushResult } from './push.js'
import type { JudgeResult, ReviewResult } from './review.js'
import type { VerificationResult } from './verify.js'

export type HumanFeedbackAction = 'confirm_push' | 'approve_changes' | 'select_push'

export type HumanFeedbackResponseAction = 'approved' | 'declined' | 'auto_modify' | 'force_push' | 'push_selected' | 'skipped'

export interface HumanFeedbackRequest {
  action: HumanFeedbackAction
  title: string
  message: string
  options: HumanFeedbackResponseAction[]
  review: ReviewResult
  judge: JudgeResult
  modify?: ModifyResult
  verify?: VerificationResult
  pushPlan?: PushPlan
}

export interface HumanFeedbackResponse {
  action: HumanFeedbackResponseAction
  message?: string
  pushOptionId?: string
}

export interface ReviewInput {
  repository?: string
  diff?: string
  commitLimit?: number
  humanFeedback?: HumanFeedbackResponse
  requestHumanFeedback?: (request: HumanFeedbackRequest) => Promise<HumanFeedbackResponse> | HumanFeedbackResponse
  requestPushFeedback?: (request: HumanFeedbackRequest) => Promise<HumanFeedbackResponse> | HumanFeedbackResponse
}

export interface ReviewWorkflowResult {
  commitContext: string
  review: ReviewResult
  judge: JudgeResult
  feedbackRequest?: HumanFeedbackRequest
  humanFeedback?: HumanFeedbackResponse
  modify?: ModifyResult
  verify?: VerificationResult
  pushFeedbackRequest?: HumanFeedbackRequest
  pushFeedback?: HumanFeedbackResponse
  pushPlan?: PushPlan
  push?: PushResult
}
