import { join } from 'node:path'
import type { UserConfig } from 'tsdown'
import { clientBundle } from '../tsdown.client.ts'
import { readBuiltinSkillCatalog } from './build/builtin-skills.ts'
import { BUILTIN_SKILL_COPY } from './src/client/builtin-skill-copy.ts'

const bundle = clientBundle(import.meta.dirname, ['lib/types/index.js'])

export default (options: Parameters<typeof bundle>[0]): UserConfig[] => bundle(options).map(config =>
  config.platform === 'browser' ? {
    ...config,
    define: {
      ...config.define,
      __DSH_WORKBENCH_BUILTIN_SKILLS__: JSON.stringify(readBuiltinSkillCatalog(
        join(import.meta.dirname, '../../../.agents/skills'),
        Object.keys(BUILTIN_SKILL_COPY),
      )),
    },
  } : config,
)
