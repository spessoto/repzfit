import { env } from "../src/config/env.js";

const EVOLUTION_BASE_URL = "https://evolution.pododesk.com.br";

async function checkInstance() {
  try {
    console.log("🔍 Verificando instância personal-teste...\n");

    const response = await fetch(
      `${EVOLUTION_BASE_URL}/instance/fetchInstances?instanceName=personal-teste`,
      {
        headers: {
          apikey: env.EVOLUTION_GLOBAL_KEY,
        },
      },
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }

    const instances = await response.json();
    console.log("📱 Resposta:", JSON.stringify(instances, null, 2));

    if (Array.isArray(instances) && instances.length > 0) {
      const instance = instances[0];
      console.log("\n📊 Status:");
      console.log(`   Nome: ${instance.name}`);
      console.log(`   Conexão: ${instance.connectionStatus}`);
      console.log(`   Número: ${instance.ownerJid}`);
      console.log(`   Última atualização: ${instance.updatedAt}`);

      if (instance.connectionStatus !== "open") {
        console.log("\n⚠️  PROBLEMA: Instância não está conectada!");
        console.log(
          "   A instância precisa estar com status 'open' para receber mensagens.",
        );

        if (instance.disconnectionReasonCode) {
          console.log(
            `   Código de desconexão: ${instance.disconnectionReasonCode}`,
          );
        }
        if (instance.disconnectionObject) {
          console.log(`   Detalhes: ${instance.disconnectionObject}`);
        }
      } else {
        console.log("\n✅ Instância conectada e pronta!");
      }

      // Verificar webhook
      console.log("\n🔧 Verificando webhook...");
      const webhookResponse = await fetch(
        `${EVOLUTION_BASE_URL}/webhook/find/personal-teste`,
        {
          headers: {
            apikey: env.EVOLUTION_GLOBAL_KEY,
          },
        },
      );

      if (webhookResponse.ok) {
        const webhook = await webhookResponse.json();
        console.log("📋 Webhook:", JSON.stringify(webhook, null, 2));
      }
    }
  } catch (error) {
    console.error("❌ Erro:", error);
    process.exit(1);
  }
}

checkInstance();
