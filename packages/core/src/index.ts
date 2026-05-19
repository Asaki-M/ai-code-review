import type { ReviewInput, ReviewWorkflowResult } from './schemas/workflow.js'
import { resolve } from 'node:path'
import { END, START, StateGraph } from '@langchain/langgraph'
import { required } from './utils/required.js'
import { collect, commit, humanFeedback, judge, modify, nextAfterCommit, nextAfterHumanFeedback, nextAfterModify, planPush, prepareRetry, push, pushFeedback, rereviewCollect, review, shouldExecutePush } from './workflow/nodes.js'
import { buildReviewInstructionPrompt } from './workflow/reviewInstruction.js'
import { State } from './workflow/state.js'

/**
 * workflow:
 * - collect:
 *   获取目标仓库的 commit context；如果调用方直接传入 diff，则跳过仓库采集
 * - reviewStep:
 *   review agent 基于 commit context / diff 输出结构化 ReviewResult
 * - judgeStep:
 *   judge agent 根据 review 结果给出 PASS / REJECT 和下一步动作
 * - humanFeedbackStep:
 *   - PASS: 请求用户确认是否继续推送
 *   - REJECT: 展示问题列表，请用户选择自动修改、强制推送或取消
 * - modifyStep:
 *   当用户选择 auto_modify 时，modify agent 根据 review 结果修改代码
 * - prepareRetryStep:
 *   如果 modify 失败，刷新最新 commit context，并回到 humanFeedbackStep 再次让用户决策
 * - rereviewCollectStep:
 *   modify 成功后，重新收集修改后的 commit context，再次进入 reviewStep / judgeStep 做复审
 * - pushPlanStep:
 *   当用户确认可以推送时，分析并生成候选 git push 方案
 * - pushFeedbackStep:
 *   让用户从 push 方案中选择一种实际执行方式
 * - commitStep:
 *   当用户已选定推送方案时，自动执行 git add / git commit，确保后续推送包含本次修改
 * - pushStep:
 *   按用户选择执行 git push
 *
 * 整体流程是一个带回环的审查工作流：
 * 初审未通过时可以自动修改 -> 自动复审；
 * 自动修改失败时回到人工决策；
 * 最终只有在审查通过且用户确认后才会进入推送阶段。
 */
export const reviewWorkflow = new StateGraph(State)
  .addNode('collect', async state => ({ commitContext: state.diff ?? await collect(state) }))
  .addNode('reviewStep', async state => ({
    review: await review(
      required(state.commitContext, 'commitContext'),
      buildReviewInstructionPrompt(state.userInstruction),
    ),
  }))
  .addNode('judgeStep', async state => ({ judge: await judge(state.review) }))
  .addNode('humanFeedbackStep', async state => humanFeedback(state))
  .addNode('modifyStep', async state => ({ modify: await modify(state) }))
  .addNode('commitStep', async state => ({ commit: await commit(state) }))
  .addNode('prepareRetryStep', async state => prepareRetry(state))
  .addNode('rereviewCollectStep', async state => rereviewCollect(state))
  .addNode('pushPlanStep', async state => ({ pushPlan: await planPush(state) }))
  .addNode('pushFeedbackStep', async state => pushFeedback(state))
  .addNode('pushStep', async state => ({ push: await push(state) }))
  .addEdge(START, 'collect')
  .addEdge('collect', 'reviewStep')
  .addEdge('reviewStep', 'judgeStep')
  .addEdge('judgeStep', 'humanFeedbackStep')
  .addConditionalEdges('humanFeedbackStep', nextAfterHumanFeedback, {
    modify: 'modifyStep',
    push: 'pushPlanStep',
    end: END,
  })
  .addConditionalEdges('modifyStep', nextAfterModify, {
    rereview: 'rereviewCollectStep',
    retry: 'prepareRetryStep',
  })
  .addEdge('prepareRetryStep', 'humanFeedbackStep')
  .addEdge('rereviewCollectStep', 'reviewStep')
  .addEdge('pushPlanStep', 'pushFeedbackStep')
  .addConditionalEdges('pushFeedbackStep', shouldExecutePush, {
    push: 'commitStep',
    end: END,
  })
  .addConditionalEdges('commitStep', nextAfterCommit, {
    push: 'pushStep',
    end: END,
  })
  .addEdge('pushStep', END)
  .compile()

export async function reviewCode(input: ReviewInput = {}): Promise<ReviewWorkflowResult> {
  const result = await reviewWorkflow.invoke({
    ...input,
    repository: input.repository ? resolve(input.repository) : input.repository,
  })

  return {
    commitContext: required(result.commitContext, 'commitContext'),
    review: required(result.review, 'review'),
    judge: required(result.judge, 'judge'),
    feedbackRequest: result.feedbackRequest,
    humanFeedback: result.humanFeedback,
    modify: result.modify,
    verify: result.verify,
    commit: result.commit,
    pushFeedbackRequest: result.pushFeedbackRequest,
    pushFeedback: result.pushFeedback,
    pushPlan: result.pushPlan,
    push: result.push,
  }
}

export { collectAgent } from './agents/collectAgent/index.js'
export { judgeAgent } from './agents/judgeAgent/index.js'
export { modifyAgent } from './agents/modifyAgent/index.js'
export { pushAgent, pushPlannerAgent } from './agents/pushAgent/index.js'
export { reviewAgent } from './agents/reviewAgent/index.js'
export { reviewInstructionAgent } from './agents/reviewInstructionAgent/index.js'
export { verifyAgent } from './agents/verifyAgent/index.js'
export type {
  CommitResult,
} from './schemas/commit.js'
export type {
  WorkflowUserInstruction,
} from './schemas/instruction.js'
export type {
  ModifyChange,
  ModifyInput,
  ModifyResult,
} from './schemas/modify.js'
export type {
  PushPlan,
  PushPlanOption,
  PushResult,
} from './schemas/push.js'
export type {
  JudgeResult,
  ReviewFinding,
  ReviewResult,
  ReviewSeverity,
  WorkflowDecision,
} from './schemas/review.js'
export type {
  VerificationInput,
  VerificationPlan,
  VerificationResult,
  VerificationTask,
  VerificationTaskName,
  VerificationTaskResult,
} from './schemas/verify.js'
export type {
  HumanFeedbackRequest,
  HumanFeedbackResponse,
  HumanFeedbackResponseAction,
  ReviewInput,
  ReviewWorkflowResult,
} from './schemas/workflow.js'
