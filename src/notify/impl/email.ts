// email notify adapter — Task 9. Renders the templated email (Task 4's `renderEmail`,
// src/render/email.ts) and pipes a MIME message to a sendmail-compatible command.
//
// NOT a bash port — the bash reference (small-model-skills monitor/bin/smon) has no email notify
// backend at all (grep for msmtp/smtp/mail across small-model-skills turns up nothing; email
// is new to the metaobjects model, see the Email adapter.notify node in
// metaobjects/meta.notify.json with @alertTemplateRef/@digestTemplateRef). The shape below is
// this task's own design, built to match the model's config keys: @requiredConfig
// ["SMON_EMAIL_TO"], @optionalConfig ["SMON_SMTP_CMD"] (default "msmtp -t" — msmtp's `-t` reads
// the recipient from the message's own `To:` header, the same sendmail-compatible convention
// `mail`/`sendmail -t` use, so swapping SMON_SMTP_CMD to another MTA needs no other change here).
//
// The command is run through a shell (`/bin/sh -c`) with the MIME text piped to its stdin,
// mirroring how bash would normally invoke msmtp (`... | msmtp -t`); the injected `exec` lets
// tests assert the exact piped bytes with zero real process spawn.

import type { NotifyAdapter } from "../../generated/notify/registry.data";
import type { AlertPayload, DigestPayload } from "../../generated";
import { renderEmail as defaultRenderEmail } from "../../render/email";
import { optionalConfig, requireConfig } from "../config";

const DEFAULT_SMTP_CMD = "msmtp -t";

export interface EmailExecResult {
  code: number;
  stderr?: string;
}

/** Runs `command` through a shell, piping `input` (the full MIME message) to its stdin,
 *  resolving to its exit code (+ captured stderr, for error messages). */
export type EmailExec = (command: string, input: string) => Promise<EmailExecResult>;

async function defaultExec(command: string, input: string): Promise<EmailExecResult> {
  const proc = Bun.spawn(["/bin/sh", "-c", command], {
    stdin: "pipe",
    stdout: "ignore",
    stderr: "pipe",
  });
  proc.stdin.write(input);
  await proc.stdin.end();
  const stderr = await new Response(proc.stderr).text();
  const code = await proc.exited;
  return { code, stderr: stderr || undefined };
}

export interface EmailAdapterDeps {
  /** Defaults to piping through `/bin/sh -c <SMON_SMTP_CMD>` via `Bun.spawn`. Inject a fake in tests. */
  exec?: EmailExec;
  /** Defaults to the real `renderEmail` (src/render/email.ts). Inject a fake in tests to avoid
   *  depending on the real templates/ directory. */
  renderEmail?: typeof defaultRenderEmail;
}

/** A minimal, RFC 5322-shaped multipart/alternative message: headers, a text/plain part, and a
 *  text/html part, boundary-delimited. Good enough for msmtp/sendmail -t to relay as-is. */
function buildMimeMessage(to: string, subject: string, text: string, html: string): string {
  const boundary = `smon-${crypto.randomUUID()}`;
  return [
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "",
    text,
    "",
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "",
    html,
    "",
    `--${boundary}--`,
    "",
  ].join("\n");
}

async function sendViaTemplate(
  exec: EmailExec,
  render: typeof defaultRenderEmail,
  templateName: "AlertEmail" | "DigestEmail",
  payload: AlertPayload | DigestPayload,
  cfg: Readonly<Record<string, string>>,
): Promise<void> {
  const to = requireConfig(cfg, "SMON_EMAIL_TO"); // fail fast, before rendering or exec'ing
  const smtpCmd = optionalConfig(cfg, "SMON_SMTP_CMD", DEFAULT_SMTP_CMD);

  const { subject, html, text } = await render(templateName, payload);
  const message = buildMimeMessage(to, subject, text, html);

  const result = await exec(smtpCmd, message);
  if (result.code !== 0) {
    const detail = result.stderr ? `: ${result.stderr}` : "";
    throw new Error(`email FAILED (exit ${result.code})${detail}`);
  }
}

export function createEmailAdapter(deps: EmailAdapterDeps = {}): NotifyAdapter<AlertPayload, DigestPayload> {
  const exec = deps.exec ?? defaultExec;
  const render = deps.renderEmail ?? defaultRenderEmail;

  return {
    async sendAlert(payload, cfg) {
      await sendViaTemplate(exec, render, "AlertEmail", payload, cfg);
    },
    async sendDigest(payload, cfg) {
      await sendViaTemplate(exec, render, "DigestEmail", payload, cfg);
    },
  } satisfies NotifyAdapter<AlertPayload, DigestPayload>;
}

/** Default instance (real `Bun.spawn` + real `renderEmail`) — what the wired registry
 *  (src/notify/registry.ts) uses. */
export const emailAdapter = createEmailAdapter();
