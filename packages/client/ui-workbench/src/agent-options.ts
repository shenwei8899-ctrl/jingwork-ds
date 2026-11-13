/** Shared validation for optional assistant presentation and runtime preferences. */
import z from '@deepseek-ai/schemastery'

/** Runtime capability groups selectable in the assistant editor. */
export const AGENT_TOOL_GROUPS = ['files', 'web', 'shell', 'tasks', 'interaction'] as const

/** Optional fields accepted by both profile loading and configuration import. */
export const agentOptionSchema = {
  customKnowledgeBases: z.array(z.object({
    connector: z.string().pattern(/^[a-z0-9][a-z0-9_-]{0,31}$/).required(),
    id: z.string().min(1).max(256).required(),
    name: z.string().min(1).max(120).required(),
  })).max(100),
  knowledgeBases: z.array(z.string().min(1).max(256)).max(100),
  avatar: z
    .string()
    .max(7_000_000)
    .pattern(/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/),
  color: z.string().pattern(/^#[0-9a-fA-F]{6}$/),
  welcomeMessage: z.string().max(65536),
  quickPrompts: z
    .array(
      z.object({
        id: z.string().min(1).max(120).required(),
        title: z.string().min(1).max(120).required(),
        description: z.string().max(65536).required(),
        prompt: z.string().min(1).max(65536).required(),
      }),
    )
    .max(20),
  model: z.union([
    z.const(undefined),
    z.object({ provider: z.string().min(1).required(), model: z.string().min(1).required() }),
  ]),
  tools: z.union([z.const(undefined), z.array(z.union([...AGENT_TOOL_GROUPS]))]),
  subagents: z.union([
    z.const(undefined),
    z.array(z.string().pattern(/^[a-z0-9][a-z0-9_-]{0,31}$/)),
  ]),
}
