/** Read-only repository skill descriptions, localized independently from instruction files. */
import { useState } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { builtinSkills } from './builtin-skills.ts'
import { BUILTIN_SKILL_COPY } from './builtin-skill-copy.ts'
import css from './page.module.css'

type Props = Pick<PropsLocale<'workbench'>, 't'> & { query: string }

/** Render packaged repository skill metadata without altering the session's invocable catalog.
 * @param props Localized labels and the page's search query.
 * @returns Built-in skill cards and their description dialog.
 */
export function BuiltinSkills({ t, query }: Props) {
  const [selectedName, setSelectedName] = useState<string | null>(null)
  const catalog = builtinSkills()
  const skills = Object.entries(BUILTIN_SKILL_COPY).flatMap(([name, copy]) => {
    const skill = catalog.find(item => item.name === name)
    return skill === undefined ? [] : [{ ...skill, title: t(copy.nameKey), summary: t(copy.descriptionKey) }]
  })
  const matching = skills.filter(skill =>
    `${skill.name} ${skill.title} ${skill.summary} ${skill.description}`
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  )
  const selected = skills.find(skill => skill.name === selectedName)
  return (
    <>
      <section className={css.skillCatalog} aria-label={t('builtinSkills')}>
        <div className={css.skillSectionHeader}>
          <h2>{t('builtinSkills')}</h2>
          <span>{skills.length}</span>
        </div>
        <p className={css.skillHint}>{t('builtinSkillHint')}</p>
        <div className={css.grid}>
          {matching.map(skill => (
            <article className={css.card} key={skill.name} data-builtin-skill={skill.name}>
              <small className={css.skillMeta}>{t('builtinSkillLabel')}</small>
              <h3 className={css.skillTitle}>{skill.title}</h3>
              <code className={css.skillMeta}>{skill.name}</code>
              <p>{skill.summary}</p>
              <div className={css.cardactions}>
                <Button onClick={() =>{  setSelectedName(skill.name) }}>{t('viewSkillDetails')}</Button>
              </div>
            </article>
          ))}
        </div>
        {!matching.length && <p className={css.empty}>{t('noResults')}</p>}
      </section>
      <Modal
        open={selected !== undefined}
        onClose={() =>{  setSelectedName(null) }}
        title={t('skillDetails')}
        closeLabel={t('close')}
      >
        {selected && (
          <div className={css.builtinSkillDetails}>
            <h3>{selected.title}</h3>
            <code>{selected.name}</code>
            <p>{selected.summary}</p>
            <dl>
              <dt>{t('skillSource')}</dt>
              <dd>{selected.path}</dd>
              <dt>{t('skillManualInvocation')}</dt>
              <dd>{t(selected.userInvocable ? 'skillSupported' : 'skillNotSupported')}</dd>
              <dt>{t('skillModelInvocation')}</dt>
              <dd>{t(selected.modelInvocable ? 'skillSupported' : 'skillNotSupported')}</dd>
            </dl>
            <p className={css.skillHint}>{t('builtinSkillAvailability')}</p>
          </div>
        )}
      </Modal>
    </>
  )
}
