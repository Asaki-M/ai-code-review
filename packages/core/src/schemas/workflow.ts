import type { CommitResult } from './commit.js'
import type { ModifyResult } from './modify.js'
import type { PushPlan, PushResult } from './push.js'
import type { JudgeResult, ReviewResult } from './review.js'

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
  pushPlan?: PushPlan
}

export interface HumanFeedbackResponse {
  action: HumanFeedbackResponseAction
  message?: string
  instruction?: string
  pushOptionId?: string
}

export interface ReviewWorkflowInterrupt {
  kind: 'human_feedback' | 'push_feedback'
  request: HumanFeedbackRequest
}

export interface ReviewInput {
  repository?: string
  diff?: string
  commitLimit?: number
  humanFeedback?: HumanFeedbackResponse
  pushFeedback?: HumanFeedbackResponse
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
  commit?: CommitResult
  pushFeedbackRequest?: HumanFeedbackRequest
  pushFeedback?: HumanFeedbackResponse
  pushPlan?: PushPlan
  push?: PushResult
}

export interface ReviewSessionOptions {
  threadId?: string
  checkpointPath: string
}

export interface ReviewSessionResumeInput {
  threadId: string
  resume: HumanFeedbackResponse
}

export interface ReviewSessionInterruptedResult extends Partial<ReviewWorkflowResult> {
  status: 'interrupted'
  threadId: string
  interrupt: ReviewWorkflowInterrupt
}

export interface ReviewSessionCompletedResult extends ReviewWorkflowResult {
  status: 'completed'
  threadId: string
}

export interface ReviewSessionNotFoundResult {
  status: 'not_found'
  threadId: string
}

export type ReviewSessionResult = ReviewSessionInterruptedResult | ReviewSessionCompletedResult

export type ReviewSessionSnapshot = ReviewSessionInterruptedResult | ReviewSessionCompletedResult | ReviewSessionNotFoundResult
