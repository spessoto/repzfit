import { env } from "../config/env.js";

const OPENAI_TRANSCRIPT_ENDPOINT =
  "https://api.openai.com/v1/audio/transcriptions";

export async function transcribeAudioFromUrl(
  audioUrl: string,
): Promise<string> {
  if (!env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required to transcribe audio");
  }

  const audioResponse = await fetch(audioUrl);
  if (!audioResponse.ok) {
    throw new Error(
      `Failed to download audio from Evolution: ${audioResponse.status}`,
    );
  }

  const blob = await audioResponse.blob();
  const form = new FormData();
  form.append("model", "whisper-1");
  form.append("file", blob, "audio.ogg");

  const response = await fetch(OPENAI_TRANSCRIPT_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: form,
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Whisper API error ${response.status}: ${details}`);
  }

  const data = (await response.json()) as { text?: string };
  return data.text?.trim() ?? "";
}

export async function generateFallbackReply(context: {
  studentName?: string;
  state: string;
  input: string;
}): Promise<string> {
  if (!env.OPENAI_API_KEY) {
    return "Perfeito. Vamos continuar o treino. Me confirma o valor solicitado em formato numerico.";
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      temperature: 0.4,
      messages: [
        {
          role: "system",
          content:
            "Voce e um coach de treino via WhatsApp. Responda curto, motivador e sempre conduza para o proximo passo numerico do fluxo.",
        },
        {
          role: "user",
          content: `Estado: ${context.state}. Aluno disse: ${context.input}. Nome: ${context.studentName ?? "Aluno"}.`,
        },
      ],
    }),
  });

  if (!response.ok) {
    return "Bora! Me confirma o dado numerico para eu registrar certinho.";
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  return (
    payload.choices?.[0]?.message?.content?.trim() ??
    "Bora! Me confirma o dado numerico para eu registrar certinho."
  );
}
