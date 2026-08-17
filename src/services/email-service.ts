/**
 * Serviço de envio de e-mail via Resend API (https://resend.com).
 * Usa fetch nativo — sem dependências adicionais no package.json.
 *
 * Se RESEND_API_KEY não estiver definido, o e-mail é apenas logado
 * no console e a função retorna sem erro (fail-soft).
 */

import { env } from "../config/env.js";

const RESEND_API_URL = "https://api.resend.com/emails";

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
}

/**
 * Envia e-mail via Resend.
 * Nunca lança exceção — erros são logados e a função retorna `false`.
 * @returns `true` se enviado com sucesso, `false` caso contrário.
 */
export async function sendAlertEmail(opts: SendEmailOptions): Promise<boolean> {
  if (!env.RESEND_API_KEY) {
    console.warn(
      "[email] RESEND_API_KEY não configurado — e-mail não enviado:",
      opts.subject,
    );
    return false;
  }

  const to = Array.isArray(opts.to) ? opts.to : [opts.to];

  try {
    const res = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.ALERT_EMAIL_FROM,
        to,
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "(sem corpo)");
      console.error(
        `[email] Falha ao enviar "${opts.subject}": HTTP ${res.status} — ${body}`,
      );
      return false;
    }

    console.info(`[email] Enviado com sucesso: "${opts.subject}" → ${to.join(", ")}`);
    return true;
  } catch (err) {
    console.error(`[email] Erro inesperado ao enviar "${opts.subject}":`, err);
    return false;
  }
}

/** Retorna os destinatários padrão de alerta a partir de ALERT_EMAIL_TO */
export function getAlertRecipients(): string[] {
  return env.ALERT_EMAIL_TO
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
}
