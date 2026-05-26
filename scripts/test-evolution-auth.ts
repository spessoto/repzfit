// Teste de conexão com Evolution API
const EVOLUTION_URL = "https://evolution.pododesk.com.br";

const configs = [
  { name: "GLOBAL_API_KEY (atual)", key: "ifivudovioibfvoduiyovdovcbodifvbo" },
  { name: "AUTHENTICATION_API_KEY", key: "PodoDesk00!" },
];

async function testarConexao() {
  console.log("🔍 Testando conexões com Evolution API...\n");

  for (const config of configs) {
    console.log(`\n📋 Testando: ${config.name}`);
    console.log(`Header: apikey: ${config.key}\n`);

    try {
      // Teste 1: Criar instância
      console.log("  1️⃣ Testando POST /instance/create");
      const createResponse = await fetch(`${EVOLUTION_URL}/instance/create`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: config.key,
        },
        body: JSON.stringify({
          instanceName: "test-connection",
          integration: "WHATSAPP-BAILEYS",
          qrcode: true,
        }),
      });

      console.log(`     Status: ${createResponse.status}`);

      if (createResponse.status === 401) {
        console.log("     ❌ Não autorizado (401)\n");
        continue;
      }

      if (createResponse.ok || createResponse.status === 409) {
        console.log("     ✅ Autenticação OK!");

        // Teste 2: Buscar QR Code
        console.log("\n  2️⃣ Testando GET /instance/connect/test-connection");
        const qrResponse = await fetch(
          `${EVOLUTION_URL}/instance/connect/test-connection`,
          {
            method: "GET",
            headers: {
              apikey: config.key,
            },
          },
        );

        console.log(`     Status: ${qrResponse.status}`);

        if (qrResponse.ok) {
          const qrData = await qrResponse.json();
          console.log("     ✅ QR Code disponível!");
          console.log(
            `     Campos retornados: ${Object.keys(qrData).join(", ")}`,
          );
        }

        console.log(`\n✨ CONFIGURAÇÃO CORRETA: ${config.name}`);
        console.log(`   Use: apikey: ${config.key}`);
        return;
      }
    } catch (error) {
      console.log(`     ❌ Erro: ${error.message}`);
    }
  }

  console.log("\n\n⚠️ Nenhuma configuração funcionou. Verifique se:");
  console.log(
    "   - A Evolution API está acessível em https://evolution.pododesk.com.br",
  );
  console.log("   - O container está rodando (docker ps)");
  console.log("   - Não há firewall bloqueando");
}

testarConexao();
