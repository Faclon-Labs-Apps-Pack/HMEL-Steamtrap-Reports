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
    throw new ApiError(`Failed to send report email: ${body.errors?.join(', ') ?? 'unknown error'}`);
  }

  console.log(`[sendReportEmail] Sent successfully to ${params.to.join(', ')}`);
}
