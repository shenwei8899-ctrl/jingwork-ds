/** Jingwork connector catalog using profile settings and Host-owned secrets. */
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { useState } from 'react'
import {
  Button,
  Input,
  Modal,
  Tooltip,
  IconEditOutlineRegular,
  IconTrashOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { Connector } from '../types.ts'
import { CONNECTOR_CATALOG, builtinConnector } from '../connector-catalog.ts'
import type { WorkbenchFace } from './page.tsx'
import type { WorkbenchKey } from './locales.ts'
import cardStyles from './card.module.css'
import css from './connectors.module.css'
import tencentDocs from './assets/connectors/tencent-docs.png'
import tencentIma from './assets/connectors/tencent-ima.png'
import tencentMeeting from './assets/connectors/tencent-meeting.png'
import tencentNews from './assets/connectors/tencent-news.png'
import wechatReading from './assets/connectors/wechat-reading.png'
import tencentLexiang from './assets/connectors/tencent-lexiang.png'
import tencentWeiyun from './assets/connectors/tencent-weiyun.png'
import mail from './assets/connectors/qq-mail.png'
import qqMusic from './assets/connectors/qq-music.png'

const logos = {
  'tencent-docs': tencentDocs,
  'tencent-ima': tencentIma,
  'tencent-meeting': tencentMeeting,
  'tencent-news': tencentNews,
  'wechat-reading': wechatReading,
  'tencent-lexiang': tencentLexiang,
  'tencent-weiyun': tencentWeiyun,
  'qq-mail': mail,
  'qq-music': qqMusic,
}
const fieldLabels = {
  token: 'connectorToken',
  api_key: 'connectorApiKey',
  client_id: 'connectorClientId',
  email: 'connectorEmail',
  password: 'connectorPassword',
  imap_host: 'connectorImapHost',
  imap_port: 'connectorImapPort',
  smtp_host: 'connectorSmtpHost',
  smtp_port: 'connectorSmtpPort',
} as const
const categories = {
  office: 'connectorOffice',
  knowledge: 'connectorKnowledge',
  media: 'connectorMedia',
  productivity: 'connectorProductivity',
} as const

type Props = PropsLocale<'workbench'> & {
  data: readonly Connector[]
  query: string
  writable: boolean
  revision: number | undefined
  save: WorkbenchFace['save']
  saveCredentials: WorkbenchFace['saveConnectorCredentials']
  editCustom: (row: Connector) => void
  notify: (key: WorkbenchKey, success: boolean) => void
  remove: (row: Connector) => void
}
type Draft = { row: Connector; original: string | undefined; revision: number | undefined }

/** Render the built-in catalog and saved connector collections.
 * @param props Profile data, localized copy and existing Host commands.
 * @returns Searchable connector cards and a credential dialog.
 */
export function Connectors(props: Props) {
  const { t } = props
  const [tab, setTab] = useState<'enabled' | 'builtin'>('builtin')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [credentials, setCredentials] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<WorkbenchKey | null>(null)
  const matches = (value: string) =>
    value.toLocaleLowerCase().includes(props.query.trim().toLocaleLowerCase())
  const selected = builtinConnector(draft?.row.builtin)
  const conflict = draft !== null && draft.revision !== props.revision
  const open = (row: Connector, original?: string) => {
    setDraft({ row: structuredClone(row), original, revision: props.revision })
    setCredentials({})
    setError(null)
  }
  const configure = (entry: (typeof CONNECTOR_CATALOG)[number]) => {
    const kind = entry.kind
    const existing = props.data.find(row => row.builtin === kind)
    if (existing) {
      open(existing, existing.slug)
      return
    }
    open({
      slug: `${kind.slice(0, 18)}-${randomUUID().slice(0, 8)}`,
      name: t(entry.nameKey),
      builtin: kind,
      transport: 'streamable-http',
      url: '',
      command: '',
      args: [],
      enabled: true,
    })
  }
  const close = () => {
    if (!busy) {
      setDraft(null)
      setError(null)
      setCredentials({})
    }
  }
  const save = async () => {
    if (!draft || !selected || busy || conflict) return
    const replacing = Object.values(credentials).some(value => value.trim())
    if (
      (draft.original === undefined || replacing) &&
      selected.fields.some(field => !credentials[field]?.trim())
    ) {
      setError('connectorRequired')
      return
    }
    setBusy(true)
    setError(null)
    let credentialsSaved = false
    try {
      if (draft.original === undefined || replacing) {
        const failure = await props.saveCredentials(draft.row.slug, credentials)
        if (failure) {
          setError(failure)
          return
        }
        credentialsSaved = true
      }
      const failure = await props.save(
        'connectors',
        { ...draft.row, enabled: true },
        draft.original,
        draft.revision,
      )
      if (failure) {
        setError(credentialsSaved ? 'connectorPartialSave' : failure)
        return
      }
      props.notify('connectorSaved', true)
      setDraft(null)
      setCredentials({})
    } finally {
      setBusy(false)
    }
  }
  const toggle = async (row: Connector) => {
    if (busy) return
    setBusy(true)
    try {
      const failure = await props.save(
        'connectors',
        { ...row, enabled: !row.enabled },
        row.slug,
        props.revision,
      )
      props.notify(failure ?? 'connectorStatusSaved', failure === null)
    } finally {
      setBusy(false)
    }
  }
  const saved = props.data.filter(row => row.enabled && matches(`${row.name} ${row.slug}`))
  return (
    <section className={css.catalog} aria-label={t('connectors')}>
      <nav className={css.tabs} aria-label={t('connectors')}>
        {(['enabled', 'builtin'] as const).map(value => (
          <Button
            key={value}
            aria-pressed={tab === value}
            onClick={() => {
              setTab(value)
            }}
          >
            {t(value === 'enabled' ? 'connectorEnabled' : 'connectorBuiltin')}
          </Button>
        ))}
      </nav>
      <p className={css.hint}>{t('connectorCredentialHint')}</p>
      <div className={css.grid}>
        {tab === 'builtin'
          ? CONNECTOR_CATALOG.filter(entry =>
            matches(`${t(entry.nameKey)} ${t(entry.descriptionKey)}`),
          ).map((entry) => {
            const installed = props.data.find(row => row.builtin === entry.kind)
            return (
              <article className={`${cardStyles.surface} ${cardStyles.catalogSurface} ${css.card}`} key={entry.kind}>
                <header className={css.identity}>
                  <img src={logos[entry.kind]} alt="" />
                  <div>
                    <h2>{t(entry.nameKey)}</h2>
                    <span className={css.badge}>{t(categories[entry.category])}</span>
                  </div>
                </header>
                <p>{t(entry.descriptionKey)}</p>
                <Button
                  className={css.cardMainAction}
                  variant="ghost"
                  disabled={!props.writable || busy}
                  onClick={() => {
                    configure(entry)
                  }}
                >
                  {t(installed?.enabled ? 'connectorConfigure' : 'connectorConnect')}
                </Button>
              </article>
            )
          })
          : saved.map((row) => {
            const entry = builtinConnector(row.builtin)
            return (
              <article className={`${cardStyles.surface} ${cardStyles.catalogSurface} ${css.card}`} key={row.slug}>
                <header className={css.identity}>
                  {entry && <img src={logos[entry.kind]} alt="" />}
                  <div>
                    <h2>{row.name}</h2>
                    <span className={`${css.badge} ${css.connectedBadge}`}>
                      {t('connectorConnected')}
                    </span>
                  </div>
                </header>
                <p>{entry ? t(entry.descriptionKey) : row.transport}</p>
                <div className={css.actions}>
                  <Tooltip label={t('edit')}>
                    <Button
                      className={css.cardIconAction}
                      aria-label={t('edit')}
                      icon={<IconEditOutlineRegular size={20} />}
                      disabled={!props.writable || busy}
                      onClick={() => {
                        if (entry) open(row, row.slug)
                        else props.editCustom(row)
                      }}
                    >
                      {t('edit')}
                    </Button>
                  </Tooltip>
                  <Button
                    disabled={!props.writable || busy}
                    onClick={() => {
                      void toggle(row)
                    }}
                  >
                    {t(row.enabled ? 'connectorDisable' : 'connectorEnable')}
                  </Button>
                  <Tooltip label={t('remove')}>
                    <Button
                      className={css.cardIconAction}
                      aria-label={t('remove')}
                      icon={<IconTrashOutlineRegular size={20} />}
                      disabled={!props.writable || busy}
                      onClick={() => {
                        props.remove(row)
                      }}
                    >
                      {t('remove')}
                    </Button>
                  </Tooltip>
                </div>
              </article>
            )
          })}
      </div>
      {tab === 'builtin' &&
        !CONNECTOR_CATALOG.some(entry => matches(`${t(entry.nameKey)} ${t(entry.descriptionKey)}`)) && (
        <p className={css.empty}>{t('noResults')}</p>
      )}
      {tab !== 'builtin' && saved.length === 0 && (
        <p className={css.empty}>
          {t(props.query.trim() ? 'noResults' : 'connectorNoEnabled')}
        </p>
      )}
      <Modal
        open={draft !== null}
        title={selected ? t(selected.nameKey) : t('connectorConfigure')}
        closeLabel={t('close')}
        onClose={close}
        footer={
          <>
            <Button disabled={busy} onClick={close}>
              {t('cancel')}
            </Button>
            <Button
              variant="primary"
              disabled={busy || conflict || !props.writable}
              onClick={() => {
                void save()
              }}
            >
              {t('save')}
            </Button>
          </>
        }
      >
        {selected && (
          <div className={css.form}>
            <p>{t(selected.descriptionKey)}</p>
            <a href={selected.authorizationUrl} target="_blank" rel="noreferrer">
              {t('connectorAuthorize')}
            </a>
            {draft?.original !== undefined && <p>{t('connectorSavedCredentials')}</p>}
            {selected.fields.map(field => (
              <label key={field}>
                {t(fieldLabels[field])}
                <Input
                  type={['token', 'api_key', 'password'].includes(field) ? 'password' : 'text'}
                  autoComplete="off"
                  value={credentials[field] ?? ''}
                  disabled={busy}
                  onChange={(event) => {
                    setCredentials({ ...credentials, [field]: event.target.value })
                  }}
                />
              </label>
            ))}
            {conflict && <p role="alert">{t('saveError')}</p>}
            {error && <p role="alert">{t(error)}</p>}
          </div>
        )}
      </Modal>
    </section>
  )
}
