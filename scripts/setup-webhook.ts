import "dotenv/config";

const EVOLUTION_BASE_URL =
  process.env.EVOLUTION_BASE_URL || "https://evolution.pododesk.com.br";
const EVOLUTION_GLOBAL_KEY = process.env.EVOLUTION_GLOBAL_KEY;
const EVOLUTION_WEBHOOK_SECRET = process.env.EVOLUTION_WEBHOOK_SECRET;
const INSTANCE_NAME = "personal-teste"; // Instância conectada via plataforma

// URL do webhook - use a URL pública do Vercel
const WEBHOOK_URL = "https://project-pxgam.vercel.app/webhooks/evolution";

async function setupWebhook() {
  if (!EVOLUTION_GLOBAL_KEY) {
    console.error("❌ EVOLUTION_GLOBAL_KEY não configurada no .env");
    process.exit(1);
  }

  if (!EVOLUTION_WEBHOOK_SECRET) {
    console.error("❌ EVOLUTION_WEBHOOK_SECRET não configurada no .env");
    process.exit(1);
  }

  try {
    console.log("🔍 Verificando instância...");

    // Buscar informações da instância
    const fetchResponse = await fetch(
      `${EVOLUTION_BASE_URL}/instance/fetchInstances`,
      {
        method: "GET",
        headers: {
          apikey: EVOLUTION_GLOBAL_KEY,
          "Content-Type": "application/json",
        },
      },
    );

    if (!fetchResponse.ok) {
      console.error(`❌ Erro ao buscar instâncias: ${fetchResponse.status}`);
      const text = await fetchResponse.text();
      console.error(text);
      process.exit(1);
    }

    const instances = await fetchResponse.json();
    console.log("📱 Instâncias encontradas:", instances);

    // Configurar webhook na instância
    console.log("\n🔧 Configurando webhook...");

    const webhookPayload = {
      webhook: {
        enabled: true,
        url: WEBHOOK_URL,
        webhook_by_events: false,
        webhook_base64: false,
        events: ["MESSAGES_UPSERT"],
        headers: {
          "x-webhook-secret": EVOLUTION_WEBHOOK_SECRET,
        },
      },
    };

    console.log("📤 Payload:", JSON.stringify(webhookPayload, null, 2));

    const webhookResponse = await fetch(
      `${EVOLUTION_BASE_URL}/webhook/set/${INSTANCE_NAME}`,
      {
        method: "POST",
        headers: {
          apikey: EVOLUTION_GLOBAL_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(webhookPayload),
      },
    );

    if (!webhookResponse.ok) {
      console.error(`❌ Erro ao configurar webhook: ${webhookResponse.status}`);
      const text = await webhookResponse.text();
      console.error(text);
      process.exit(1);
    }

    const result = await webhookResponse.json();
    console.log("\n✅ Webhook configurado com sucesso!");
    console.log("📋 Resposta:", JSON.stringify(result, null, 2));

    console.log("\n📌 Configuração:");
    console.log(`   URL: ${WEBHOOK_URL}`);
    console.log(`   Eventos: MESSAGES_UPSERT`);
    console.log(`   Instância: ${INSTANCE_NAME}`);
  } catch (error) {
    console.error("❌ Erro:", error);
    process.exit(1);
  }
}

setupWebhook();
