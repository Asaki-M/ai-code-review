import process from 'node:process'
import { reviewCode } from '@ai-code-review/core'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'

const app = new Hono()

app.get('/health', context => context.json({ ok: true }))

app.post('/review', async (context) => {
  const input = await context.req.json().catch(() => ({}))
  const result = await reviewCode(input)

  return context.json(result)
})

const port = Number(process.env.PORT ?? 3000)

serve({ fetch: app.fetch, port }, (info) => {
  console.warn(`API listening on http://localhost:${info.port}`)
})
