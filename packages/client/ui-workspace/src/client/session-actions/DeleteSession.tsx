/** Permanent Session deletion confirmation. */
import { useState } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionDeleteDialogInjected, SessionDeleteDialogProps, SessionDeleteTarget } from '../contract/slots.ts'
import css from '../rows/WorkspaceBrowser.module.css'

/** @param props - pending deletion, settlement callback, Host operation, and locale seat. @returns the dialog or null. */
export function SessionDeleteDialog({ useDeleteRequest, settleSessionDelete, deleteSession, t }: SessionDeleteDialogProps) {
  const request = useDeleteRequest(pending => pending)
  if (request === null) return null
  return <DeleteForm key={request.sessionId} request={request} settle={settleSessionDelete} deleteSession={deleteSession} t={t} />
}

function DeleteForm({ request, settle, deleteSession, t }: {
  request: SessionDeleteTarget
  settle: SessionDeleteDialogInjected['settleSessionDelete']
  deleteSession: SessionDeleteDialogInjected['deleteSession']
  t: SessionDeleteDialogProps['t']
}) {
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const close = () => { if (!deleting) settle() }
  const confirm = () => {
    setDeleting(true)
    setError(null)
    deleteSession(request.sessionId).then(() => {
      setDeleting(false)
      settle()
    }).catch((reason: unknown) => {
      setDeleting(false)
      setError(reason instanceof Error ? reason.message : String(reason))
    })
  }
  return (
    <Modal
      open
      onClose={close}
      closeLabel={t('close')}
      title={t('delete.session.title')}
      description={t('delete.session.desc', { title: request.displayTitle })}
      footer={(
        <>
          <Button variant="outline" disabled={deleting} onClick={close}>{t('cancel')}</Button>
          <Button variant="primary" className={css.deleteAction} disabled={deleting} onClick={confirm}>
            {t(deleting ? 'delete.session.pending' : 'delete.session.confirm')}
          </Button>
        </>
      )}
    >
      {error !== null && <div className={css.renameError} role="alert">{error}</div>}
    </Modal>
  )
}
