/**
 * claude-service.ts
 *
 * Substituto drop-in do gemini-service.ts usando Claude claude-haiku-4-5
 * via Anthropic Messages API (fetch puro — sem SDK).
 *
 * Exporta exatamente as mesmas funções e constantes que gemini-service.ts
 * para que bot-engine.ts e personal.ts não precisem mudar além do import.
 */

import { env } from "../config/env.js";

const ANTHROPIC_API_BASE = "https://api.anthropic.com/v1";
const CLAUDE_MODEL        = "claude-haiku-4-5";
const ANTHROPIC_VERSION   = "2023-06-01";

// Reutilizado por generateExerciseDescription
const MAX_EXERCISE_DESCRIPTION_CHARS = 150;

// ── Retry com backoff exponencial ────────────────────────────────────────────

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = 3,
): Promise<Response> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const response = await fetch(url, options);
    // Anthropic usa 529 (overloaded) além de 503
    if (response.status !== 503 && response.status !== 529) return response;
    lastError = new Error(
      `Anthropic API unavailable (${response.status}) after ${attempt + 1} attempt(s)`,
    );
    if (attempt < maxRetries - 1) {
      await new Promise((resolve) =>
        setTimeout(resolve, 1000 * Math.pow(2, attempt)),
      );
    }
  }
  throw lastError!;
}

// ── Helper interno: chama a Messages API ─────────────────────────────────────

async function callClaude(
  systemPrompt: string,
  userMessage: string,
  maxTokens = 300,
  temperature = 0.7,
): Promise<string> {
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY não configurada");
  }

  const response = await fetchWithRetry(`${ANTHROPIC_API_BASE}/messages`, {
    method: "POST",
    headers: {
      "Content-Type":         "application/json",
      "x-api-key":            env.ANTHROPIC_API_KEY,
      "anthropic-version":    ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model:      CLAUDE_MODEL,
      max_tokens: maxTokens,
      temperature,
      system:     systemPrompt,
      messages: [
        { role: "user", content: userMessage },
      ],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${error}`);
  }

  const data = (await response.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };

  const text = data.content
    ?.filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("")
    .trim();

  if (!text) {
    throw new Error("Claude retornou resposta vazia");
  }

  return text;
}

// ── Exportações compatíveis com gemini-service.ts ────────────────────────────

/**
 * Normaliza a descrição gerada pela IA (trunca, remove pontuação final).
 * Idêntica à versão do gemini-service.
 */
export function normalizeExerciseAIDescription(
  text: string,
  maxChars = MAX_EXERCISE_DESCRIPTION_CHARS,
): string {
  const compact = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();

  if (compact.length <= maxChars) return compact;

  const sliced  = compact.slice(0, maxChars);
  const lastSpace = sliced.lastIndexOf(" ");
  const safeCut = lastSpace >= Math.floor(maxChars * 0.6) ? lastSpace : maxChars;

  return sliced
    .slice(0, safeCut)
    .trim()
    .replace(/[,:;\-\s]+$/, "");
}

/**
 * Prompt padrão para o coach de treino (persona REPZ).
 * Idêntico ao do gemini-service para manter o comportamento do bot.
 */
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

/**
 * Gera uma resposta personalizada usando Claude claude-haiku-4-5
 * com personalidade de coach motivador e empático.
 *
 * API idêntica a generateBotResponse do gemini-service.
 */
export async function generateBotResponse(context: {
  systemPrompt: string;
  userMessage: string;
  conversationHistory?: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }>;
}): Promise<string> {
  return callClaude(context.systemPrompt, context.userMessage, 300, 0.7);
}

/**
 * Gera descrição técnica e grupo muscular para uma variação de exercício via IA.
 * API idêntica a generateExerciseDescription do gemini-service.
 */
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
    exerciseName,
    variationName,
    equipmentName,
    gripFootingName,
    methodName,
    muscleGroups,
  } = params;

  const muscleGroupList = muscleGroups.map((mg) => `- ${mg.name}`).join("\n");

  const detailLines = [
    `Exercício: ${exerciseName}`,
    variationName    ? `Execução: ${variationName}`       : null,
    equipmentName   ? `Equipamento: ${equipmentName}`     : null,
    gripFootingName ? `Pegada/Pisada: ${gripFootingName}` : null,
    methodName      ? `Método: ${methodName}`             : null,
  ]
    .filter(Boolean)
    .join("\n");

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
    prompt,
    250,
    0.2,
  );

  let parsed: { description: string; muscleGroup: string };
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);
  } catch {
    throw new Error(`Claude retornou resposta inválida: ${text}`);
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

/**
 * Gera resposta de fallback quando o aluno envia input inesperado.
 * API idêntica a generateFallbackReply do gemini-service.
 */
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
    return await generateBotResponse({
      systemPrompt: COACH_SYSTEM_PROMPT,
      userMessage,
    });
  } catch {
    return `Entendi! Mas preciso que você me confirme ${context.expectedInput} para eu registrar direitinho. Pode me passar? 💪`;
  }
}
