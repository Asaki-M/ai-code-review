import type { ReviewInput, ReviewWorkflowResult } from './schemas/workflow.js'
import { END, START, StateGraph } from '@langchain/langgraph'
import { required } from './utils/required.js'
import { collect, humanFeedback, judge, planPush, push, pushFeedback, review, shouldExecutePush, shouldPush } from './workflow/nodes.js'
import { State } from './workflow/state.js'

/**
 * workflow:
 * - collect agent: 获取目标仓库 diff、commit metadata、branch 信息
 * - review agent: 基于 diff 输出结构化 review 结果
 * - judge agent: 根据 review 指标给出 PASS / REJECT
 * - human feedback:
 *    - PASS: 请求用户确认是否推送
 *    - REJECT: 展示问题和修改建议，请求用户选择自动修改、强制推送或取消
 * - modify agent: 根据 review 结果和用户反馈应用 patch 或修改工作区文件
 * - verify agent: 运行 lint / typecheck / test，失败则回到 human feedback
 * - rereview: 对修改后的 diff 再次进入 review agent
 * - push agent: 用户最终确认后推送
 */
export const reviewWorkflow = new StateGraph(State)
  .addNode('collect', async state => ({ commitContext: state.diff ?? await collect(state) }))
  .addNode('reviewStep', async state => ({ review: await review(required(state.commitContext, 'commitContext')) }))
  .addNode('judgeStep', async state => ({ judge: await judge(state.review) }))
  .addNode('humanFeedbackStep', async state => humanFeedback(state))
  .addNode('pushPlanStep', async state => ({ pushPlan: await planPush(state) }))
  .addNode('pushFeedbackStep', async state => pushFeedback(state))
  .addNode('pushStep', async state => ({ push: await push(state) }))
  .addEdge(START, 'collect')
  .addEdge('collect', 'reviewStep')
  .addEdge('reviewStep', 'judgeStep')
  .addEdge('judgeStep', 'humanFeedbackStep')
  .addConditionalEdges('humanFeedbackStep', shouldPush, {
    push: 'pushPlanStep',
    end: END,
  })
  .addEdge('pushPlanStep', 'pushFeedbackStep')
  .addConditionalEdges('pushFeedbackStep', shouldExecutePush, {
    push: 'pushStep',
    end: END,
  })
  .addEdge('pushStep', END)
  .compile()

export async function reviewCode(input: ReviewInput = {}): Promise<ReviewWorkflowResult> {
  const result = await reviewWorkflow.invoke(input)

  return {
    commitContext: required(result.commitContext, 'commitContext'),
    review: required(result.review, 'review'),
    judge: required(result.judge, 'judge'),
    feedbackRequest: result.feedbackRequest,
    humanFeedback: result.humanFeedback,
    pushFeedbackRequest: result.pushFeedbackRequest,
    pushFeedback: result.pushFeedback,
    pushPlan: result.pushPlan,
    push: result.push,
  }
}

export { collectAgent } from './agents/collectAgent.js'
export { judgeAgent } from './agents/judgeAgent.js'
export { pushAgent, pushPlannerAgent } from './agents/pushAgent.js'
export { reviewAgent } from './agents/reviewAgent/index.js'
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
  HumanFeedbackRequest,
  HumanFeedbackResponse,
  HumanFeedbackResponseAction,
  ReviewInput,
  ReviewWorkflowResult,
} from './schemas/workflow.js'
