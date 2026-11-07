import nodemailer from 'nodemailer'
import { smtp } from './env'
import { logger } from './logger'

export interface Mail {
  to: string
  subject: string
  text: string
  headers?: Record<string, string>
}

export interface MailTransport {
  sendMail: (mail: { from: string, to: string, subject: string, text: string, headers?: Record<string, string> }) => Promise<unknown>
}

function createTransport(): MailTransport | null {
  if (!smtp)
    return null
  return nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    // 465 is implicit TLS; 587/25 upgrade via STARTTLS.
    secure: smtp.port === 465,
    auth: smtp.user && smtp.pass ? { user: smtp.user, pass: smtp.pass } : undefined,
  })
}

const transport = createTransport()

export const mailerEnabled = transport !== null

// Awaitable delivery, for callers that must know the outcome (cron scripts that exit right after,
// or that only record a notification once it actually left). False when skipped or failed.
export async function deliverMail(mail: Mail, transportImpl: MailTransport | null = transport, from = smtp?.from): Promise<boolean> {
  if (!transportImpl || !from) {
    logger.info({ to: mail.to, subject: mail.subject }, 'smtp not configured, mail skipped')
    return false
  }
  try {
    await transportImpl.sendMail({ from, ...mail })
    logger.info({ to: mail.to, subject: mail.subject }, 'mail sent')
    return true
  }
  catch (error) {
    logger.error({ error, to: mail.to, subject: mail.subject }, 'mail send failed')
    return false
  }
}

// Fire-and-forget: auth flows must not await delivery (timing attacks) nor fail on it.
export function sendMail(mail: Mail, transportImpl: MailTransport | null = transport, from = smtp?.from): void {
  void deliverMail(mail, transportImpl, from)
}
