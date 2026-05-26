import { env } from "../config/env.js";

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_MODEL = "gemini-2.0-flash-exp"; // Gemini Flash-Lite Latest

type GeminiMessage = {
  role: "user" | "model";
  parts: Array<{ text: string }>;
};

/**
 * Gera uma resposta personalizada usando Gemini Flash-Lite Latest
 * com personalidade de coach motivador e empático
 */
export async function generateBotResponse(context: {
  systemPrompt: string;
  userMessage: string;
  conversationHistory?: GeminiMessage[];
}): Promise<string> {
  if (!env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY não configurada");
  }

  const endpoint = `${GEMINI_API_BASE}/models/${GEMINI_MODEL}:generateContent?key=${env.GEMINI_API_KEY}`;

  const messages: GeminiMessage[] = [
    ...(context.conversationHistory ?? []),
    {
      role: "user",
      parts: [{ text: context.userMessage }],
    },
  ];

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      system_instruction: {
        parts: [{ text: context.systemPrompt }],
      },
      contents: messages,
      generationConfig: {
        temperature: 0.7,
        topK: 40,
        topP: 0.95,
        maxOutputTokens: 300,
      },
      safetySettings: [
        {
          category: "HARM_CATEGORY_HARASSMENT",
          threshold: "BLOCK_NONE",
        },
        {
          category: "HARM_CATEGORY_HATE_SPEECH",
          threshold: "BLOCK_NONE",
        },
        {
          category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
          threshold: "BLOCK_NONE",
        },
        {
          category: "HARM_CATEGORY_DANGEROUS_CONTENT",
          threshold: "BLOCK_NONE",
        },
      ],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${error}`);
  }

  const data = (await response.json()) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{ text?: string }>;
      };
    }>;
  };

  const generatedText =
    data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

  if (!generatedText) {
    throw new Error("Gemini retornou resposta vazia");
  }

  return generatedText;
}

/**
 * Prompt padrão para o coach de treino
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
 * Gera resposta de fallback quando o aluno envia input inesperado
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
  } catch (error) {
    // Fallback caso o Gemini falhe
    return `Entendi! Mas preciso que você me confirme ${context.expectedInput} para eu registrar direitinho. Pode me passar? 💪`;
  }
}

/**
 * Verifica se a mensagem é uma intenção de iniciar treino
 * Aceita variações como: "iniciar treino", "começar treino", "bora treinar", etc.
 */
export function isTrainingStartIntent(message: string): boolean {
  const normalized = message.toLowerCase().trim();

  // Padrões que indicam intenção de iniciar treino
  const patterns = [
    /iniciar\s+(treino|treinamento|sessao|exercicio)/,
    /come[cç]ar\s+(treino|treinamento|sessao|exercicio)/,
    /bora\s+(treinar|malhar|treino)/,
    /vamos\s+(treinar|malhar|começar|come[cç]ar)/,
    /quero\s+treinar/,
    /inicio\s+(treino|treinamento)/,
    /start\s+(treino|workout|training)/,
  ];

  return patterns.some((pattern) => pattern.test(normalized));
}
