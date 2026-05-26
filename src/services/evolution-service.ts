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
      buttonId: button.id,
      buttonText: { displayText: button.text },
      type: 1,
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
  pairingCode?: string;
}> {
  const payload = (await evolutionGet(
    `/instance/connect/${instanceName}`,
  )) as Record<string, unknown>;

  return {
    qrcode: typeof payload.qrcode === "string" ? payload.qrcode : undefined,
    base64: typeof payload.base64 === "string" ? payload.base64 : undefined,
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
