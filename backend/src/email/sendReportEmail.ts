import { getAuthHeader, API_BASE } from '../config';
import { ApiError } from '../services/iosenseApi';

export interface EmailAttachment {
  /** Publicly reachable URL IOsense will GET to fetch the file — see fileServer.ts. */
  url: string;
  fileName: string;
}

export interface SendReportEmailParams {
  to: string[];
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
 * IOsense's account-level email API. Attachments are PULL-based: IOsense's servers issue a GET
 * against each attachment's `url` themselves to fetch the file bytes — this call does not upload
 * anything. That means the URLs must be reachable from the public internet (see fileServer.ts /
 * getReportBaseUrl), and the file must still exist there by the time IOsense gets to it.
 *
 * No `template` is specified — IOsense falls back to its documented default
 * ("triggerEngine triggerType1"). We previously sent `template: "reports reportMail"`, copied
 * from a different project's setup and never confirmed for THIS organisation — confirmed live
 * (test emails) that it silently swallows the send: the API still returns `success:true`, but
 * nothing ever arrives, because that template isn't registered for this org. The default
 * template DOES deliver (confirmed live) — its content comes from `additionalInfo.message` and
 * `additionalInfo.time`, per IOsense's documented example, so that's what we populate.
 */
export async function sendReportEmail(params: SendReportEmailParams): Promise<void> {
  if (params.to.length === 0) {
    throw new ApiError('No recipients configured for this report — refusing to send.');
  }

  console.log(
    `[sendReportEmail] Sending "${params.subject}" to ${params.to.join(', ')} ` +
      `(attachments: ${params.attachments.map((a) => a.fileName).join(', ')})`,
  );

  const response = await fetch(`${API_BASE}/account/sendEmail`, {
    method: 'PUT',
    headers: {
      Authorization: getAuthHeader(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      to: params.to,
      cc: [],
      subject: params.subject,
      attachments: params.attachments.map((a) => ({ url: a.url, method: 'GET', fileName: a.fileName })),
      additionalInfo: {
        message: `${params.reportTitle}\n\n${params.message}`,
        time: new Date().toISOString(),
      },
    }),
  });

  const body = (await response.json()) as SendEmailResponse;
  console.log(`[sendReportEmail] Raw API response (status ${response.status}):`, JSON.stringify(body));
  if (!response.ok || !body.success) {
    throw new ApiError(`Failed to send report email: ${body.errors?.join(', ') ?? 'unknown error'}`);
  }

  console.log(`[sendReportEmail] Sent successfully to ${params.to.join(', ')}`);
}
