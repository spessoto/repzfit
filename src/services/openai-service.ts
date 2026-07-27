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


