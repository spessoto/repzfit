import { env } from "../src/config/env.js";

const EVOLUTION_BASE_URL = "https://evolution.pododesk.com.br";

async function sendTestMessage() {
  try {
    console.log("📤 Enviando mensagem de teste do bot para o usuário...\n");

    const payload = {
      number: "5511937474389",
      text: "🤖 Mensagem de teste do bot!\n\nSe você receber isso, significa que o bot consegue enviar mensagens.\n\nAgora tente responder: *Iniciar treino*",
    };

    console.log("📋 Payload:", JSON.stringify(payload, null, 2));

    const response = await fetch(
      `${EVOLUTION_BASE_URL}/message/sendText/personal-teste`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: env.EVOLUTION_GLOBAL_KEY,
        },
        body: JSON.stringify(payload),
      },
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`HTTP ${response.status}: ${error}`);
    }

    const result = await response.json();
    console.log("\n✅ Mensagem enviada!");
    console.log("📋 Resposta:", JSON.stringify(result, null, 2));

    console.log(
      "\n📱 Verifique seu WhatsApp (5511937474389) e responda 'Iniciar treino'",
    );
  } catch (error) {
    console.error("❌ Erro:", error);
    process.exit(1);
  }
}

sendTestMessage();
