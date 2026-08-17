/**
 * connection-monitor.ts
 *
 * Cron de monitoramento da conexão WhatsApp (Evolution API).
 * Roda a cada 5 minutos e envia e-mail se detectar desconexão.
 *
 * Mecanismo anti-spam: só envia 1 e-mail por desconexão.
 * Após reconexão detectada, reseta o estado para poder alertar novamente
 * na próxima desconexão.
 */

import type { FastifyInstance } from "fastify";
import {
  getEvolutionConnectionStatus,
  getUnifiedEvolutionInstanceName,
} from "../services/evolution-service.js";
import { sendAlertEmail, getAlertRecipients } from "../services/email-service.js";
import { logAction } from "../utils/system-logger.js";

const MONITOR_INTERVAL_MS = 5 * 60 * 1000; // 5 minutos

/** Estado em memória da conexão — persiste apenas no processo atual */
let lastKnownState: "open" | "close" | "connecting" | "unknown" = "unknown";
let disconnectEmailSent = false;
let consecutiveErrors = 0;
const MAX_CONSECUTIVE_ERRORS = 3; // Só alerta após 3 falhas seguidas (evita alertas por instabilidade momentânea)

function buildDisconnectEmailHtml(instanceName: string, state: string): string {
  const now = new Date().toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  });

  return `
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"></head>
<body style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; background: #f9fafb;">
  <div style="background: #fff; border-radius: 12px; padding: 32px; border: 1px solid #e5e7eb;">
    <div style="margin-bottom: 24px;">
      <span style="background: #fee2e2; color: #991b1b; padding: 4px 12px; border-radius: 20px; font-size: 13px; font-weight: 700;">⚠️ ALERTA DE DESCONEXÃO</span>
    </div>
    <h1 style="font-size: 22px; color: #111827; margin: 0 0 8px;">WhatsApp Desconectado</h1>
    <p style="color: #6b7280; margin: 0 0 24px;">O bot do EZ Personal foi desconectado do WhatsApp e pode estar fora do ar.</p>

    <table style="width: 100%; border-collapse: collapse; background: #f9fafb; border-radius: 8px; overflow: hidden;">
      <tr>
        <td style="padding: 12px 16px; font-weight: 600; color: #374151; border-bottom: 1px solid #e5e7eb;">Instância</td>
        <td style="padding: 12px 16px; color: #1f2937; border-bottom: 1px solid #e5e7eb;">${instanceName}</td>
      </tr>
      <tr>
        <td style="padding: 12px 16px; font-weight: 600; color: #374151; border-bottom: 1px solid #e5e7eb;">Estado detectado</td>
        <td style="padding: 12px 16px; color: #dc2626; font-weight: 700; border-bottom: 1px solid #e5e7eb;">${state}</td>
      </tr>
      <tr>
        <td style="padding: 12px 16px; font-weight: 600; color: #374151;">Horário (BRT)</td>
        <td style="padding: 12px 16px; color: #1f2937;">${now}</td>
      </tr>
    </table>

    <div style="margin-top: 24px; padding: 16px; background: #fffbeb; border-radius: 8px; border: 1px solid #fde68a;">
      <p style="margin: 0; color: #92400e; font-size: 14px;">
        <strong>Ação necessária:</strong> Acesse o painel admin em
        <a href="https://app.ezpersonal.com.br" style="color: #d97706;">app.ezpersonal.com.br</a>
        e reconecte o WhatsApp escaneando o QR code.
      </p>
    </div>
  </div>
  <p style="text-align: center; color: #9ca3af; font-size: 12px; margin-top: 16px;">
    EZ Personal · Sistema de monitoramento automático
  </p>
</body>
</html>`;
}

function buildReconnectEmailHtml(instanceName: string): string {
  const now = new Date().toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  });

  return `
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"></head>
<body style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; background: #f9fafb;">
  <div style="background: #fff; border-radius: 12px; padding: 32px; border: 1px solid #e5e7eb;">
    <div style="margin-bottom: 24px;">
      <span style="background: #dcfce7; color: #15803d; padding: 4px 12px; border-radius: 20px; font-size: 13px; font-weight: 700;">✅ RECONECTADO</span>
    </div>
    <h1 style="font-size: 22px; color: #111827; margin: 0 0 8px;">WhatsApp Reconectado</h1>
    <p style="color: #6b7280; margin: 0 0 24px;">O bot do EZ Personal voltou a ficar online no WhatsApp.</p>
    <table style="width: 100%; border-collapse: collapse; background: #f9fafb; border-radius: 8px; overflow: hidden;">
      <tr>
        <td style="padding: 12px 16px; font-weight: 600; color: #374151; border-bottom: 1px solid #e5e7eb;">Instância</td>
        <td style="padding: 12px 16px; color: #1f2937; border-bottom: 1px solid #e5e7eb;">${instanceName}</td>
      </tr>
      <tr>
        <td style="padding: 12px 16px; font-weight: 600; color: #374151;">Horário (BRT)</td>
        <td style="padding: 12px 16px; color: #1f2937;">${now}</td>
      </tr>
    </table>
  </div>
  <p style="text-align: center; color: #9ca3af; font-size: 12px; margin-top: 16px;">
    EZ Personal · Sistema de monitoramento automático
  </p>
</body>
</html>`;
}

export async function runConnectionMonitor(app: FastifyInstance): Promise<void> {
  const instanceName = getUnifiedEvolutionInstanceName();

  let state: string;
  try {
    const status = await getEvolutionConnectionStatus(instanceName);
    const instanceData = (status as any).instance || status;
    state = String(instanceData.state || instanceData.status || "unknown").toLowerCase();
    consecutiveErrors = 0;
  } catch (err) {
    consecutiveErrors++;
    app.log.warn(
      { err, consecutiveErrors },
      "[connection-monitor] Falha ao verificar status da conexão",
    );

    // Só registra como desconexão após N falhas consecutivas
    if (consecutiveErrors < MAX_CONSECUTIVE_ERRORS) return;
    state = "error";
  }

  const isConnected = state === "open";
  const wasConnected = lastKnownState === "open";

  // ── Detectou desconexão ──────────────────────────────────────────────────────
  if (!isConnected && wasConnected && !disconnectEmailSent) {
    disconnectEmailSent = true;
    lastKnownState = state as any;

    app.log.error(
      { state, instanceName },
      "[connection-monitor] WhatsApp desconectado — enviando alerta por e-mail",
    );

    // Registra no log do sistema
    await logAction(app, {
      severity: "error",
      area: "connection",
      action: "whatsapp_disconnected",
      message: `WhatsApp desconectado — estado: ${state}`,
      context: { instanceName, state, consecutiveErrors },
    });

    // Envia e-mail de alerta
    await sendAlertEmail({
      to: getAlertRecipients(),
      subject: `⚠️ WhatsApp Desconectado — EZ Personal (${instanceName})`,
      html: buildDisconnectEmailHtml(instanceName, state),
      text: `O WhatsApp do EZ Personal (instância ${instanceName}) foi desconectado às ${new Date().toLocaleString("pt-BR")}. Acesse app.ezpersonal.com.br para reconectar.`,
    });

    return;
  }

  // ── Reconectou após desconexão ───────────────────────────────────────────────
  if (isConnected && !wasConnected && disconnectEmailSent) {
    disconnectEmailSent = false;
    lastKnownState = "open";
    consecutiveErrors = 0;

    app.log.info(
      { instanceName },
      "[connection-monitor] WhatsApp reconectado",
    );

    await logAction(app, {
      severity: "info",
      area: "connection",
      action: "whatsapp_reconnected",
      message: "WhatsApp reconectado com sucesso",
      context: { instanceName },
    });

    await sendAlertEmail({
      to: getAlertRecipients(),
      subject: `✅ WhatsApp Reconectado — EZ Personal (${instanceName})`,
      html: buildReconnectEmailHtml(instanceName),
      text: `O WhatsApp do EZ Personal (instância ${instanceName}) voltou a ficar online às ${new Date().toLocaleString("pt-BR")}.`,
    });

    return;
  }

  // Atualiza estado sem enviar e-mail (transição normal ou estado repetido)
  if (isConnected) {
    lastKnownState = "open";
  } else if (state !== "unknown") {
    lastKnownState = state as any;
  }
}

export function scheduleConnectionMonitor(app: FastifyInstance): void {
  // Primeira execução após 30s (aguarda app estar totalmente pronto)
  const warmup = setTimeout(() => {
    void runConnectionMonitor(app);
  }, 30_000);
  warmup.unref();

  const timer = setInterval(() => {
    void runConnectionMonitor(app);
  }, MONITOR_INTERVAL_MS);
  timer.unref();
}
