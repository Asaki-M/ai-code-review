import type { PushPlan } from '../../schemas/push.js'

export function normalizePushPlan(pushPlan: PushPlan): PushPlan {
  const options = pushPlan.options.map(option => ({
    ...option,
    command: `git push ${option.remote} ${option.source}:${option.destination}`,
  }))
  const recommendedOptionId = options.some(option => option.id === pushPlan.recommendedOptionId)
    ? pushPlan.recommendedOptionId
    : options[0].id

  return {
    ...pushPlan,
    recommendedOptionId,
    options,
  }
}
