import type { Env } from './index';

/*
 * Sending the sign-in email. The worker sends it through Resend's HTTP API
 * (https://resend.com), which needs only `fetch`; swapping services means
 * changing `mailerOf` alone. Locally, with `LOG_LOGIN_LINKS`, the email is
 * printed in the `wrangler dev` console instead, so nothing needs setting up.
 */

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Sends one email; true if the service took it. */
export type Mailer = (mail: Mail) => Promise<boolean>;

const RESEND_URL = 'https://api.resend.com/emails';

/** How this environment sends email, or null if it can't (sign-in by email is off). */
export function mailerOf(env: Env, fetchFn: typeof fetch = fetch): Mailer | null {
  const { RESEND_API_KEY: key, EMAIL_FROM: from } = env;
  if (key && from) {
    return async (mail) => {
      const response = await fetchFn(RESEND_URL, {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from, to: [mail.to], subject: mail.subject, text: mail.text, html: mail.html }),
      }).catch(() => null);
      return response?.ok ?? false;
    };
  }
  if (env.LOG_LOGIN_LINKS === 'true') {
    return async (mail) => {
      console.log(`Email to ${mail.to}: ${mail.subject}\n${mail.text}`);
      return true;
    };
  }
  return null;
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The sign-in email: one link, which works once, for 15 minutes. */
export function loginMail(to: string, link: string): Mail {
  const subject = 'Sign in to Word Mastermind';
  const note = 'The link works once, for 15 minutes. If you didn’t ask to sign in, ignore this email.';
  return {
    to,
    subject,
    text: `Tap this link to sign in to Word Mastermind:\n\n${link}\n\n${note}\n`,
    html: `<p>Tap the button to sign in to Word Mastermind.</p>`
      + `<p><a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 20px;border-radius:8px;`
      + `background:#1f7a4d;color:#ffffff;font-weight:bold;text-decoration:none">Sign in</a></p>`
      + `<p style="color:#555555">${escapeHtml(note)}</p>`,
  };
}
