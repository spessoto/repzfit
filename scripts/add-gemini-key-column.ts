import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config();

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function addGeminiApiKeyColumn() {
  try {
    console.log("🔧 Executando migration: add_gemini_api_key...");

    // Tentar atualizar a tabela verificando se o campo já existe
    const { data: testData, error: testError } = await supabase
      .from("personals")
      .select("gemini_api_key")
      .limit(1);

    if (testError && testError.message.includes("column")) {
      console.log(
        "📝 Campo gemini_api_key não existe, será necessário adicionar via SQL direto no Supabase Dashboard",
      );
      console.log("\nExecute no SQL Editor do Supabase:");
      console.log(
        "ALTER TABLE public.personals ADD COLUMN IF NOT EXISTS gemini_api_key text;",
      );
      console.log(
        "COMMENT ON COLUMN public.personals.gemini_api_key IS 'Chave API do Google Gemini para integração de IA';",
      );
    } else {
      console.log(
        "✅ Campo gemini_api_key já existe ou foi criado com sucesso!",
      );
    }
  } catch (error) {
    console.error("❌ Falha na verificação:", error);
  }
}

addGeminiApiKeyColumn();
