import { env } from "../config/env.js";

type SendTextInput = {
  instanceName: string;
  number: string;
  text: string;
};

type SendButtonsInput = {
  instanceName: string;
  number: string;
  text: string;
  buttons: Array<{ id: string; text: string }>;
};

type EvolutionConnectionState = {
  state?: string;
  status?: string;
  [key: string]: unknown;
};

type EvolutionWebhookConfig = {
  url?: string;
  enabled?: boolean;
  events?: string[];
  headers?: Record<string, string>;
  [key: string]: unknown;
};

async function evolutionRequest(path: string, body: unknown) {
  const response = await fetch(`${env.EVOLUTION_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: env.EVOLUTION_GLOBAL_KEY,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Evolution API error ${response.status}: ${details}`);
  }

  return response.json().catch(() => ({}));
}

async function evolutionGet(path: string) {
  const response = await fetch(`${env.EVOLUTION_BASE_URL}${path}`, {
    method: "GET",
    headers: {
      apikey: env.EVOLUTION_GLOBAL_KEY,
    },
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Evolution API error ${response.status}: ${details}`);
  }

  return response.json().catch(() => ({}));
}

export async function sendTextMessage(input: SendTextInput) {
  await evolutionRequest(`/message/sendText/${input.instanceName}`, {
    number: input.number,
    text: input.text,
  });
}

export async function sendButtonsMessage(input: SendButtonsInput) {
  await evolutionRequest(`/message/sendButtons/${input.instanceName}`, {
    number: input.number,
    title: "Repz Fit",
    description: input.text,
    footer: "Selecione uma opcao",
    buttons: input.buttons.map((button) => ({
      type: "reply",
      displayText: button.text,
      id: button.id,
    })),
  });
}

export async function ensureEvolutionInstance(instanceName: string) {
  // Some Evolution deployments return conflict/validation when instance exists.
  // We treat create as idempotent by swallowing non-critical failures.
  try {
    await evolutionRequest(`/instance/create`, {
      instanceName,
      integration: "WHATSAPP-BAILEYS",
      qrcode: true,
    });
  } catch {
    // no-op
  }
}

export async function getEvolutionQrCode(instanceName: string): Promise<{
  qrcode?: string;
  base64?: string;
  code?: string;
  pairingCode?: string;
}> {
  const payload = (await evolutionGet(
    `/instance/connect/${instanceName}`,
  )) as Record<string, unknown>;

  const normalizeBase64Image = (value: unknown): string | undefined => {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    if (trimmed.startsWith("data:image/")) return trimmed;
    // Evolution may return raw base64 without data URI prefix.
    if (/^[A-Za-z0-9+/=\n\r]+$/.test(trimmed) && trimmed.length > 100) {
      return `data:image/png;base64,${trimmed.replace(/\s+/g, "")}`;
    }
    return undefined;
  };

  const nestedQr =
    payload.qrcode && typeof payload.qrcode === "object"
      ? (payload.qrcode as Record<string, unknown>)
      : undefined;

  const base64 =
    normalizeBase64Image(payload.base64) ??
    normalizeBase64Image(payload.qrcode) ??
    normalizeBase64Image(payload.code) ??
    normalizeBase64Image(payload.qr) ??
    normalizeBase64Image(nestedQr?.base64) ??
    normalizeBase64Image(nestedQr?.qrcode) ??
    normalizeBase64Image(nestedQr?.code);

  const qrcode =
    typeof payload.qrcode === "string"
      ? payload.qrcode
      : typeof nestedQr?.qrcode === "string"
        ? nestedQr.qrcode
        : undefined;

  const code =
    typeof payload.code === "string"
      ? payload.code
      : typeof nestedQr?.code === "string"
        ? nestedQr.code
        : undefined;

  return {
    qrcode,
    base64,
    code,
    pairingCode:
      typeof payload.pairingCode === "string" ? payload.pairingCode : undefined,
  };
}

export async function getEvolutionConnectionStatus(
  instanceName: string,
): Promise<EvolutionConnectionState> {
  const payload = (await evolutionGet(
    `/instance/connectionState/${instanceName}`,
  )) as EvolutionConnectionState;

  return payload;
}

export async function ensureEvolutionWebhook(
  instanceName: string,
  webhookUrl: string,
) {
  const normalize = (value: string) => value.trim().replace(/\/+$/, "");
  const desiredUrl = normalize(webhookUrl);
  const desiredEvents = ["MESSAGES_UPSERT"];
  const desiredSecret = env.EVOLUTION_WEBHOOK_SECRET;

  let current: EvolutionWebhookConfig | null = null;

  try {
    const found = await evolutionGet(`/webhook/find/${instanceName}`);
    if (found && typeof found === "object") {
      current = found as EvolutionWebhookConfig;
    }
  } catch {
    // If lookup fails, we still try to set webhook below.
  }

  const currentUrl =
    typeof current?.url === "string" ? normalize(current.url) : "";
  const currentEnabled = Boolean(current?.enabled);
  const currentEvents = Array.isArray(current?.events)
    ? current.events.map((event) => String(event).toUpperCase())
    : [];
  const currentSecret =
    current?.headers && typeof current.headers["x-webhook-secret"] === "string"
      ? current.headers["x-webhook-secret"]
      : "";

  const needsUpdate =
    currentUrl !== desiredUrl ||
    !currentEnabled ||
    !desiredEvents.every((event) => currentEvents.includes(event)) ||
    currentSecret !== desiredSecret;

  if (!needsUpdate) {
    return;
  }

  await evolutionRequest(`/webhook/set/${instanceName}`, {
    webhook: {
      enabled: true,
      url: desiredUrl,
      webhook_by_events: false,
      webhook_base64: false,
      events: desiredEvents,
      headers: {
        "x-webhook-secret": desiredSecret,
      },
    },
  });
}

export async function logoutEvolutionInstance(instanceName: string) {
  const response = await fetch(
    `${env.EVOLUTION_BASE_URL}/instance/logout/${instanceName}`,
    {
      method: "DELETE",
      headers: {
        apikey: env.EVOLUTION_GLOBAL_KEY,
      },
    },
  );

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Evolution API error ${response.status}: ${details}`);
  }

  return response.json().catch(() => ({}));
}
