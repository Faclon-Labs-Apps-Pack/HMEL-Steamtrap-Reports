import { getAuthHeader, API_BASE } from '../config';
import { ApiError } from '../services/iosenseApi';

export interface EmailAttachment {
  /** Publicly reachable URL IOsense will GET to fetch the file — see fileServer.ts. */
  url: string;
  fileName: string;
}

export interface SendReportEmailParams {
  to: string[];
  /** CC recipients (optional). */
  cc?: string[];
  subject: string;
  reportTitle: string;
  message: string;
  attachments: EmailAttachment[];
}

interface SendEmailResponse {
  success: boolean;
  errors?: string[];
  [key: string]: unknown;
}

/**
 * Why the sendEmail call failed, as reported by IOsense's (upgraded) endpoint. Before 2026-11-17
 * the API always returned `success:true` and these failures were silent; it now returns
 * `success:false` with a reason, so we classify it to drive the right recovery:
 *  - 'quota'      — IOsense is out of email-send quota ("Not sending email due to no quota").
 *                   TRANSIENT and fleet-wide: every other unit in the run is almost certainly
 *                   failing too; retry the whole batch once the quota resets.
 *  - 'attachment' — IOsense couldn't fetch the report file ("Error in getting attachment data").
 *                   OUR problem: the /report URL was unreachable or the file was already gone.
 *                   Retrying blind won't help until the file/URL is healthy.
 *  - 'unknown'    — any other `success:false` / non-2xx.
 */
export type SendEmailFailureKind = 'quota' | 'attachment' | 'unknown';

export class SendEmailError extends ApiError {
  constructor(
    message: string,
    readonly kind: SendEmailFailureKind,
    readonly rawErrors: string[],
  ) {
    super(message);
    this.name = 'SendEmailError';
  }
}

/** Maps IOsense's error strings to a failure kind. Matches on substrings so small wording changes
 *  on their side (e.g. "no quota" vs "quota exceeded") still classify correctly. */
export function classifySendErrors(errors: string[]): SendEmailFailureKind {
  const joined = errors.join(' ').toLowerCase();
  if (joined.includes('quota')) return 'quota';
  if (joined.includes('attachment')) return 'attachment';
  return 'unknown';
}

/** True when a send failed specifically because IOsense's email quota is exhausted (retryable). */
export function isQuotaError(err: unknown): err is SendEmailError {
  return err instanceof SendEmailError && err.kind === 'quota';
}

/**
 * IOsense's account-level email API. Attachments are PULL-based: IOsense's servers issue a GET
 * against each attachment's `url` themselves to fetch the file bytes — this call does not upload
 * anything. That means the URLs must be reachable from the public internet (see fileServer.ts /
 * getReportBaseUrl), and the file must still exist there by the time IOsense gets to it.
 *
 * `template: "reports reportMail"` is a fixed, platform-side email template name — its HTML
 * layout lives on the IOsense side, not in this codebase. `additionalInfo` supplies the
 * variables that template renders (title, generation time, message body). (We briefly suspected
 * this template wasn't registered for this org after some inconsistent test deliveries, but
 * confirmed it does work — the intermittent failures were unrelated to the template.)
 */
export async function sendReportEmail(params: SendReportEmailParams): Promise<void> {
  if (params.to.length === 0) {
    throw new ApiError('No recipients configured for this report — refusing to send.');
  }

  const cc = params.cc ?? [];
  console.log(
    `[sendReportEmail] Sending "${params.subject}" to ${params.to.join(', ')}` +
      (cc.length > 0 ? ` | cc: ${cc.join(', ')}` : '') +
      ` (attachments: ${params.attachments.map((a) => a.fileName).join(', ')})`,
  );

  const response = await fetch(`${API_BASE}/account/sendEmail`, {
    method: 'PUT',
    headers: {
      Authorization: getAuthHeader(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      to: params.to,
      cc,
      subject: params.subject,
      template: 'reports reportMail',
      attachments: params.attachments.map((a) => ({ url: a.url, method: 'GET', fileName: a.fileName })),
      additionalInfo: {
        reportTitle: params.reportTitle,
        reportGenerationTime: new Date().toISOString(),
        message: params.message,
      },
    }),
  });

  const body = (await response.json()) as SendEmailResponse;
  console.log(`[sendReportEmail] Raw API response (status ${response.status}):`, JSON.stringify(body));
  if (!response.ok || !body.success) {
    const errors = body.errors ?? [];
    const kind = classifySendErrors(errors);
    const raw = errors.length > 0 ? errors.join(', ') : `unknown error (HTTP ${response.status})`;
    // A human-readable lead so the report log and ops alert state plainly that the email did NOT
    // go out and why — the whole point of IOsense's new typed errors (prior to this they always
    // returned success and non-delivery was invisible to us).
    const lead =
      kind === 'quota'
        ? 'IOsense refused to send — email quota exhausted (report NOT delivered)'
        : kind === 'attachment'
          ? 'IOsense could not fetch the report attachment (report NOT delivered)'
          : 'IOsense rejected the send (report NOT delivered)';
    throw new SendEmailError(`${lead}: ${raw}`, kind, errors);
  }

  console.log(`[sendReportEmail] Sent successfully to ${params.to.join(', ')}`);
}
