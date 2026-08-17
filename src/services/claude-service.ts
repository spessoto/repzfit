/**
 * claude-service.ts
 *
 * Substituto drop-in do gemini-service.ts usando Claude Haiku 4.5
 * via Amazon Bedrock Converse API com AWS Signature V4 (fetch puro, sem SDK).
 *
 * Exporta exatamente as mesmas funções e constantes que gemini-service.ts
 * para que bot-engine.ts e personal.ts não precisem mudar além do import.
 */

import crypto from "node:crypto";
import { env } from "../config/env.js";

const BEDROCK_REGION   = "us-east-1";
const BEDROCK_SERVICE  = "bedrock";
const BEDROCK_MODEL_ID = "us.anthropic.claude-haiku-4-5-20251001-v1:0";
const BEDROCK_HOST     = `bedrock-runtime.${BEDROCK_REGION}.amazonaws.com`;
const BEDROCK_ENDPOINT = `https://${BEDROCK_HOST}/model/${BEDROCK_MODEL_ID}/converse`;

const MAX_EXERCISE_DESCRIPTION_CHARS = 150;

// ── AWS Signature V4 (implementação mínima via Node.js crypto) ────────────────

function hmacSha256(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac("sha256", key).update(data, "utf8").digest();
}

function sha256Hex(data: string): string {
  return crypto.createHash("sha256").update(data, "utf8").digest("hex");
}

function toAmzDate(date: Date): { amzDate: string; dateStamp: string } {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

function buildAuthHeaders(
  method: string,
  body: string,
  accessKeyId: string,
  secretAccessKey: string,
  sessionToken?: string,
): Record<string, string> {
  const now = new Date();
  const { amzDate, dateStamp } = toAmzDate(now);
  const payloadHash = sha256Hex(body);

  // Canonical request
  const canonicalHeaders = [
    `content-type:application/json`,
    `host:${BEDROCK_HOST}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${amzDate}`,
    ...(sessionToken ? [`x-amz-security-token:${sessionToken}`] : []),
  ].join("\n") + "\n";

  const signedHeaders = [
    "content-type",
    "host",
    "x-amz-content-sha256",
    "x-amz-date",
    ...(sessionToken ? ["x-amz-security-token"] : []),
  ].join(";");

  const canonicalPath = `/model/${encodeURIComponent(BEDROCK_MODEL_ID)}/converse`;

  const canonicalRequest = [
    method,
    canonicalPath,
    "",                   // query string
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  // String to sign
  const credentialScope = `${dateStamp}/${BEDROCK_REGION}/${BEDROCK_SERVICE}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  // Signing key
  const kDate    = hmacSha256(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion  = hmacSha256(kDate, BEDROCK_REGION);
  const kService = hmacSha256(kRegion, BEDROCK_SERVICE);
  const kSigning = hmacSha256(kService, "aws4_request");
  const signature = crypto.createHmac("sha256", kSigning).update(stringToSign).digest("hex");

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    "Content-Type":          "application/json",
    "X-Amz-Date":            amzDate,
    "X-Amz-Content-Sha256":  payloadHash,
    "Authorization":         authorization,
    ...(sessionToken ? { "X-Amz-Security-Token": sessionToken } : {}),
  };
}

// ── Retry com backoff exponencial ────────────────────────────────────────────

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = 3,
): Promise<Response> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const response = await fetch(url, options);
    if (response.status !== 503 && response.status !== 429) return response;
    lastError = new Error(
      `Bedrock API unavailable (${response.status}) after ${attempt + 1} attempt(s)`,
    );
    if (attempt < maxRetries - 1) {
      await new Promise((resolve) =>
        setTimeout(resolve, 1000 * Math.pow(2, attempt)),
      );
    }
  }
  throw lastError!;
}

// ── Helper interno: chama a Bedrock Converse API ──────────────────────────────

async function callClaude(
  systemPrompt: string,
  userMessage: string,
  maxTokens = 300,
  temperature = 0.7,
): Promise<string> {
  if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) {
    throw new Error("AWS_ACCESS_KEY_ID e AWS_SECRET_ACCESS_KEY não configurados");
  }

  const body = JSON.stringify({
    system:  [{ text: systemPrompt }],
    messages: [{ role: "user", content: [{ text: userMessage }] }],
    inferenceConfig: { maxTokens, temperature },
  });

  const headers = buildAuthHeaders(
    "POST",
    body,
    env.AWS_ACCESS_KEY_ID,
    env.AWS_SECRET_ACCESS_KEY,
    env.AWS_SESSION_TOKEN,
  );

  const response = await fetchWithRetry(BEDROCK_ENDPOINT, {
    method: "POST",
    headers,
    body,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Bedrock API error ${response.status}: ${error}`);
  }

  const data = (await response.json()) as {
    output?: {
      message?: {
        content?: Array<{ text?: string }>;
      };
    };
  };

  const text = data.output?.message?.content
    ?.map((b) => b.text ?? "")
    .join("")
    .trim();

  if (!text) {
    throw new Error("Bedrock retornou resposta vazia");
  }

  return text;
}

// ── Exportações compatíveis com gemini-service.ts ────────────────────────────

export function normalizeExerciseAIDescription(
  text: string,
  maxChars = MAX_EXERCISE_DESCRIPTION_CHARS,
): string {
  const compact = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();

  if (compact.length <= maxChars) return compact;

  const sliced    = compact.slice(0, maxChars);
  const lastSpace = sliced.lastIndexOf(" ");
  const safeCut   = lastSpace >= Math.floor(maxChars * 0.6) ? lastSpace : maxChars;

  return sliced
    .slice(0, safeCut)
    .trim()
    .replace(/[,:;\-\s]+$/, "");
}

export const COACH_SYSTEM_PROMPT = `Você é o REPZ, um coach de treino virtual via WhatsApp. Sua personalidade é:

- **Motivador e energético**: Use linguagem animada, emojis de treino (💪, 🔥, 🏋️) com moderação
- **Empático e paciente**: Entenda que treinar é difícil, celebre pequenas vitórias
- **Direto e objetivo**: Mensagens curtas (máx 2-3 linhas), foco na ação
- **Profissional mas descontraído**: Trate por "você", seja amigável mas respeite limites

**REGRAS IMPORTANTES**:
1. SEMPRE responda em português brasileiro
2. Seja breve - máximo 2-3 linhas por mensagem
3. Guie o aluno para a próxima ação específica
4. Celebre conquistas e motive em dificuldades
5. Use linguagem simples e acessível
6. Não invente dados - sempre peça confirmação quando necessário`;

export async function generateBotResponse(context: {
  systemPrompt: string;
  userMessage: string;
  conversationHistory?: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }>;
}): Promise<string> {
  return callClaude(context.systemPrompt, context.userMessage, 300, 0.7);
}

export async function generateExerciseDescription(params: {
  exerciseName: string;
  variationName?: string | null;
  equipmentName?: string | null;
  gripFootingName?: string | null;
  methodName?: string | null;
  muscleGroups: Array<{ id: string; name: string }>;
}): Promise<{
  description: string;
  muscleGroupId: string | null;
  muscleGroupName: string | null;
}> {
  const {
    exerciseName, variationName, equipmentName,
    gripFootingName, methodName, muscleGroups,
  } = params;

  const muscleGroupList = muscleGroups.map((mg) => `- ${mg.name}`).join("\n");

  const detailLines = [
    `Exercício: ${exerciseName}`,
    variationName    ? `Execução: ${variationName}`       : null,
    equipmentName   ? `Equipamento: ${equipmentName}`     : null,
    gripFootingName ? `Pegada/Pisada: ${gripFootingName}` : null,
    methodName      ? `Método: ${methodName}`             : null,
  ].filter(Boolean).join("\n");

  const prompt = `Você é especialista em musculação. Escreva uma descrição técnica curta, clara e objetiva para o aluno executar este exercício com segurança, usando apenas as informações fornecidas abaixo (não invente detalhes que não foram informados).

${detailLines}

Responda APENAS com JSON no formato exato abaixo (sem texto extra):
{"description":"texto com no máximo 150 caracteres","muscleGroup":"nome do grupo muscular"}

Regras obrigatórias para o campo description:
- Máximo de 150 caracteres
- Linguagem simples e direta
- Frase única, sem enrolação
- Foco na execução principal

Grupos musculares disponíveis (use exatamente um da lista):
${muscleGroupList}`;

  const text = await callClaude(
    "Você é um especialista em musculação e biomecânica. Responda sempre em JSON válido, sem texto extra.",
    prompt, 250, 0.2,
  );

  let parsed: { description: string; muscleGroup: string };
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);
  } catch {
    throw new Error(`Bedrock retornou resposta inválida: ${text}`);
  }

  const mgName  = (parsed.muscleGroup ?? "").trim();
  const matched = muscleGroups.find(
    (mg) => mg.name.toLowerCase() === mgName.toLowerCase(),
  );

  return {
    description:     normalizeExerciseAIDescription(parsed.description ?? ""),
    muscleGroupId:   matched?.id ?? null,
    muscleGroupName: matched?.name ?? (mgName || null),
  };
}

export async function generateFallbackReply(context: {
  studentName?: string;
  currentState: string;
  userInput: string;
  expectedInput: string;
}): Promise<string> {
  const userMessage = `
Estado atual: ${context.currentState}
Input esperado: ${context.expectedInput}
O que o aluno disse: "${context.userInput}"
Nome do aluno: ${context.studentName ?? "Aluno"}

Responda de forma motivadora e gentil, pedindo para ele confirmar o dado solicitado. Seja breve e direto.
`.trim();

  try {
    return await generateBotResponse({ systemPrompt: COACH_SYSTEM_PROMPT, userMessage });
  } catch {
    return `Entendi! Mas preciso que você me confirme ${context.expectedInput} para eu registrar direitinho. Pode me passar? 💪`;
  }
}
