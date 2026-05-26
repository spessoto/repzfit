import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkStudents() {
  console.log("🔍 Verificando alunos cadastrados...\n");

  const { data: students, error } = await supabase
    .from("students")
    .select("*")
    .eq("is_active", true);

  if (error) {
    console.error("❌ Erro ao buscar alunos:", error);
    process.exit(1);
  }

  if (!students || students.length === 0) {
    console.log("⚠️  Nenhum aluno ativo cadastrado!");
    console.log("\n📝 Para cadastrar um aluno, acesse:");
    console.log("   https://project-pxgam.vercel.app/");
    console.log("   Email: personal.teste@repzfit.com");
    console.log("   Senha: 123456");
    console.log(
      "\n   Depois vá em 'Alunos' e cadastre um aluno com o número do WhatsApp",
    );
    process.exit(0);
  }

  console.log(`✅ ${students.length} aluno(s) encontrado(s):\n`);

  students.forEach((student, index) => {
    console.log(`${index + 1}. ${student.name}`);
    console.log(`   📱 WhatsApp: ${student.whatsapp_number}`);
    console.log(`   ✅ Ativo: ${student.is_active}`);
    console.log(`   🆔 ID: ${student.id}`);
    console.log("");
  });

  console.log("📌 O bot só responde para números cadastrados acima!");
  console.log("📌 Número da instância WhatsApp: +5511937474389");
  console.log(
    "\n💡 Para testar, envie 'Iniciar treino' de um dos números acima",
  );
}

checkStudents();
