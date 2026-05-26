import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkWorkouts() {
  console.log("🔍 Verificando treinos cadastrados...\n");

  // Buscar aluno
  const { data: student } = await supabase
    .from("students")
    .select("*")
    .eq("whatsapp_number", "5511937474389")
    .single();

  if (!student) {
    console.log("❌ Aluno não encontrado!");
    process.exit(1);
  }

  console.log(`👤 Aluno: ${student.name} (${student.whatsapp_number})\n`);

  // Buscar treinos do aluno
  const { data: workouts, error } = await supabase
    .from("workouts")
    .select("*, workout_exercises(*, exercises(*))")
    .eq("student_id", student.id);

  if (error) {
    console.error("❌ Erro ao buscar treinos:", error);
    process.exit(1);
  }

  if (!workouts || workouts.length === 0) {
    console.log("⚠️  Nenhum treino cadastrado para este aluno!");
    console.log("\n📝 Para cadastrar um treino:");
    console.log("   1. Acesse: https://project-pxgam.vercel.app/");
    console.log("   2. Vá em 'Treinos'");
    console.log("   3. Crie um treino para 'Caio de Teste'");
    console.log("   4. Defina o dia da semana (ex: Segunda)");
    console.log("   5. Adicione exercícios ao treino");
    process.exit(0);
  }

  console.log(`✅ ${workouts.length} treino(s) encontrado(s):\n`);

  const days = [
    "Domingo",
    "Segunda",
    "Terça",
    "Quarta",
    "Quinta",
    "Sexta",
    "Sábado",
  ];
  const today = new Date().getDay();
  const todayName = days[today];

  workouts.forEach((workout, index) => {
    const dayName = days[workout.day_of_week];
    const isToday = workout.day_of_week === today;

    console.log(`${index + 1}. ${workout.name}`);
    console.log(`   📅 Dia: ${dayName} ${isToday ? "← HOJE!" : ""}`);
    console.log(`   📊 Exercícios: ${workout.workout_exercises?.length || 0}`);
    console.log(`   🆔 ID: ${workout.id}`);
    console.log("");
  });

  console.log(`📌 Hoje é ${todayName} (dia ${today})`);
  console.log("📌 O bot só mostra treinos do dia atual!");
  console.log("\n💡 Para testar:");
  console.log("   1. Certifique-se de ter um treino para HOJE");
  console.log("   2. Envie 'Iniciar treino' pelo WhatsApp");
}

checkWorkouts();
