import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

async function createTestStudent() {
  const whatsappNumber = "5511964099351"; // Número da instância personal-teste

  console.log(`🔍 Verificando se já existe aluno com ${whatsappNumber}...`);

  // Verificar se já existe
  const { data: existing } = await supabase
    .from("students")
    .select("*")
    .eq("whatsapp_number", whatsappNumber)
    .single();

  if (existing) {
    console.log("✅ Aluno já existe:");
    console.log(`   Nome: ${existing.name}`);
    console.log(`   WhatsApp: ${existing.whatsapp_number}`);
    console.log(`   Ativo: ${existing.is_active}`);
    return;
  }

  console.log("📝 Criando novo aluno...\n");

  // Buscar personal_id
  const { data: personal } = await supabase
    .from("personals")
    .select("id")
    .limit(1)
    .single();

  if (!personal) {
    console.error("❌ Nenhum personal encontrado!");
    process.exit(1);
  }

  // Criar aluno
  const { data: student, error } = await supabase
    .from("students")
    .insert({
      personal_id: personal.id,
      name: "Aluno WhatsApp",
      whatsapp_number: whatsappNumber,
      is_active: true,
    })
    .select()
    .single();

  if (error) {
    console.error("❌ Erro ao criar aluno:", error);
    process.exit(1);
  }

  console.log("✅ Aluno criado com sucesso!");
  console.log(`   Nome: ${student.name}`);
  console.log(`   WhatsApp: ${student.whatsapp_number}`);
  console.log(`   ID: ${student.id}`);
  console.log("\n📌 Agora você pode enviar mensagens do WhatsApp conectado!");
  console.log(
    "📌 Mas ATENÇÃO: você ainda precisa cadastrar um TREINO para este aluno!",
  );
}

createTestStudent();
