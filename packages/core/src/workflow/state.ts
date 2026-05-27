import type { CommitResult } from '../schemas/commit.js'
import type { WorkflowUserInstruction } from '../schemas/instruction.js'
import type { ModifyResult } from '../schemas/modify.js'
import type { PushPlan, PushResult } from '../schemas/push.js'
import type { JudgeResult, ReviewResult } from '../schemas/review.js'
import type { HumanFeedbackRequest, HumanFeedbackResponse } from '../schemas/workflow.js'
import { Annotation } from '@langchain/langgraph'

export const State = Annotation.Root({
  repository: Annotation<string | undefined>,
  diff: Annotation<string | undefined>,
  commitLimit: Annotation<number | undefined>,
  commitContext: Annotation<string | undefined>,
  review: Annotation<ReviewResult | undefined>,
  judge: Annotation<JudgeResult | undefined>,
  userInstruction: Annotation<WorkflowUserInstruction | undefined>,
  humanFeedback: Annotation<HumanFeedbackResponse | undefined>,
  modify: Annotation<ModifyResult | undefined>,
  commit: Annotation<CommitResult | undefined>,
  pushFeedback: Annotation<HumanFeedbackResponse | undefined>,
  feedbackRequest: Annotation<HumanFeedbackRequest | undefined>,
  pushFeedbackRequest: Annotation<HumanFeedbackRequest | undefined>,
  pushPlan: Annotation<PushPlan | undefined>,
  push: Annotation<PushResult | undefined>,
})

export type ReviewWorkflowState = typeof State.State
