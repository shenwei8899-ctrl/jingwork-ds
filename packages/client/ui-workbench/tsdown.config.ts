import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import type { UserConfig } from 'tsdown'
import { clientBundle } from '../tsdown.client.ts'
import { readBuiltinSkillCatalog } from './build/builtin-skills.ts'
import { BUILTIN_SKILL_COPY } from './src/client/builtin-skill-copy.ts'

const bundle = clientBundle(import.meta.dirname, ['lib/types/index.js'])

export default (options: Parameters<typeof bundle>[0]): UserConfig[] => bundle(options).flatMap(config =>
  config.platform === 'browser' ? {
    ...config,
    alias: {
      ...config.alias,
      yaml: join(dirname(createRequire(import.meta.url).resolve('yaml/package.json')), 'browser/index.js'),
    },
    define: {
      ...config.define,
      __DSH_WORKBENCH_BUILTIN_SKILLS__: JSON.stringify(readBuiltinSkillCatalog(
        join(import.meta.dirname, '../../../.agents/skills'),
        Object.keys(BUILTIN_SKILL_COPY),
      )),
    },
  } : config.platform === 'node' ? [config, { ...config, entry: ['lib/types/connector.js'] }] : config,
)
