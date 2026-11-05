/** IMAP and SMTP connector using maintained protocol and MIME clients. */
import { ImapFlow } from 'imapflow'
import nodemailer from 'nodemailer'
import { simpleParser } from 'mailparser'
import { z } from 'zod'
import {
  ConnectorRequestError,
  type ConnectorCredentials,
  type ConnectorRequestPolicy,
} from './connector-gateway.ts'

/** Run one mailbox operation with fresh credentials and bounded socket lifetimes.
 * @param creds Host-only mailbox settings and app password.
 * @param name Mail tool name.
 * @param args Validated tool arguments.
 * @param signal Tool cancellation.
 * @param policy Request and response limits.
 * @returns JSON text for the durable tool result.
 */
export async function callConnectorMail(
  creds: ConnectorCredentials,
  name: string,
  args: Record<string, unknown>,
  signal: AbortSignal,
  policy: ConnectorRequestPolicy & { maxMailResults: number },
): Promise<string> {
  const auth = { user: z.email().parse(creds.email), pass: z.string().min(1).parse(creds.password) }
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(policy.timeoutMs)])
  requestSignal.throwIfAborted()
  if (name === 'send_email') {
    const transport = nodemailer.createTransport({
      host: z.string().min(1).parse(creds.smtp_host),
      port: z.coerce.number().int().min(1).max(65535).parse(creds.smtp_port),
      secure: creds.smtp_port === '465',
      requireTLS: true,
      auth,
      connectionTimeout: policy.timeoutMs,
      greetingTimeout: policy.timeoutMs,
      socketTimeout: policy.timeoutMs,
    })
    const close = () => {
      transport.close()
    }
    requestSignal.addEventListener('abort', close, { once: true })
    try {
      const to = z.email().parse(args.to)
      await transport.sendMail({
        from: auth.user,
        to,
        subject: z.string().parse(args.subject),
        text: z.string().parse(args.body),
      })
      requestSignal.throwIfAborted()
      return JSON.stringify({ ok: true, to })
    } catch (_error: unknown) {
      throw new ConnectorRequestError('network')
    } finally {
      requestSignal.removeEventListener('abort', close)
      transport.close()
    }
  }
  const client = new ImapFlow({
    host: z.string().min(1).parse(creds.imap_host),
    port: z.coerce.number().int().min(1).max(65535).parse(creds.imap_port),
    secure: true,
    auth,
    logger: false,
    connectionTimeout: policy.timeoutMs,
    greetingTimeout: policy.timeoutMs,
    socketTimeout: policy.timeoutMs,
    maxLiteralSize: policy.maxResponseBytes,
    clientInfo: { name: 'DeepSeek Harness', version: '1.0.0' },
  })
  // Connection errors are also rejected by the awaited operation. Contain the EventEmitter path.
  client.on('error', () => {
    client.close()
  })
  const close = () => {
    client.close()
  }
  requestSignal.addEventListener('abort', close, { once: true })
  try {
    await client.connect()
    await client.mailboxOpen('INBOX', { readOnly: true })
    if (name === 'search_emails') {
      const query = z.string().parse(args.query ?? 'ALL')
      const limit = Math.max(
        1,
        Math.min(
          policy.maxMailResults,
          z
            .number()
            .int()
            .parse(args.limit ?? 10),
        ),
      )
      const uids = await client.search(query === 'ALL' ? { all: true } : { body: query }, { uid: true })
      const rows: { uid: string; from: string; subject: string; date: string }[] = []
      for (const uid of (uids || []).slice(-limit).reverse()) {
        const message = await client.fetchOne(String(uid), { envelope: true }, { uid: true })
        if (message)
          rows.push({
            uid: String(uid),
            from: message.envelope?.from?.map(item => item.address).join(', ') ?? '',
            subject: message.envelope?.subject ?? '',
            date: String(message.envelope?.date ?? ''),
          })
      }
      const text = JSON.stringify(rows)
      if (Buffer.byteLength(text) > policy.maxResponseBytes) throw new ConnectorRequestError('response')
      return text
    }
    if (name !== 'read_email') throw new ConnectorRequestError('response')
    const uid = z
      .string()
      .regex(/^[1-9][0-9]*$/)
      .parse(args.uid)
    const message = await client.fetchOne(uid, { source: true }, { uid: true })
    if (!message || !message.source) throw new ConnectorRequestError('response')
    const parsed = await simpleParser(message.source, { skipHtmlToText: true, skipTextToHtml: true })
    const text = JSON.stringify({
      uid,
      from: parsed.from?.text ?? '',
      subject: parsed.subject ?? '',
      date: parsed.date?.toISOString() ?? '',
      body: parsed.text ?? '',
    })
    if (Buffer.byteLength(text) > policy.maxResponseBytes) throw new ConnectorRequestError('response')
    requestSignal.throwIfAborted()
    return text
  } catch (error: unknown) {
    if (requestSignal.aborted) throw requestSignal.reason
    if (error instanceof ConnectorRequestError) throw error
    throw new ConnectorRequestError('network')
  } finally {
    requestSignal.removeEventListener('abort', close)
    client.close()
  }
}
