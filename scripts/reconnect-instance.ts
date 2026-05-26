import { env } from "../src/config/env.js";

const EVOLUTION_BASE_URL = "https://evolution.pododesk.com.br";

async function reconnectInstance() {
  try {
    console.log("🔄 Tentando conectar instância...\n");

    // Verificar status atual
    const statusResponse = await fetch(
      `${EVOLUTION_BASE_URL}/instance/connectionState/personal-teste`,
      {
        headers: {
          apikey: env.EVOLUTION_GLOBAL_KEY,
        },
      },
    );

    const status = await statusResponse.json();
    console.log("📊 Status atual:", JSON.stringify(status, null, 2));

    // Se não estiver conectado, tentar reconectar
    if (status.state !== "open") {
      console.log("\n🔄 Reconectando...");

      const connectResponse = await fetch(
        `${EVOLUTION_BASE_URL}/instance/connect/personal-teste`,
        {
          method: "GET",
          headers: {
            apikey: env.EVOLUTION_GLOBAL_KEY,
          },
        },
      );

      const connectResult = await connectResponse.json();
      console.log("📱 Resultado:", JSON.stringify(connectResult, null, 2));

      if (connectResult.code) {
        console.log("\n📲 QR Code disponível!");
        console.log("   Acesse para escanear:");
        console.log(
          `   https://evolution.pododesk.com.br/instance/connect/personal-teste`,
        );
        console.log(
          "\n   Ou use o QR Code base64 (muito grande para exibir aqui)",
        );
      }
    } else {
      console.log("\n✅ Instância já está conectada!");
    }
  } catch (error) {
    console.error("❌ Erro:", error);
    process.exit(1);
  }
}

reconnectInstance();
