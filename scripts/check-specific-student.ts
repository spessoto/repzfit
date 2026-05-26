import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkSpecificStudent() {
  const whatsapp = "5511937474389";

  console.log(`🔍 Verificando aluno: ${whatsapp}\n`);

  // Buscar aluno
  const { data: student } = await supabase
    .from("students")
    .select("*")
    .eq("whatsapp_number", whatsapp)
    .single();

  if (!student) {
    console.log("❌ Aluno não encontrado!");
    process.exit(1);
  }

  console.log(`✅ Aluno encontrado:`);
  console.log(`   Nome: ${student.name}`);
  console.log(`   WhatsApp: ${student.whatsapp_number}`);
  console.log(`   Ativo: ${student.is_active}`);
  console.log(`   ID: ${student.id}\n`);

  // Buscar treinos
  const { data: workouts, error } = await supabase
    .from("workouts")
    .select("*, workout_exercises(*, exercises(*))")
    .eq("student_id", student.id);

  if (error) {
    console.error("❌ Erro ao buscar treinos:", error);
    process.exit(1);
  }

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

  console.log(`📅 Hoje é: ${todayName} (dia ${today})\n`);

  if (!workouts || workouts.length === 0) {
    console.log("❌ Nenhum treino cadastrado para este aluno!");
    console.log("\n📝 AÇÃO NECESSÁRIA:");
    console.log("   1. Acesse: https://project-pxgam.vercel.app/");
    console.log("   2. Vá em 'Treinos'");
    console.log("   3. Crie um treino para 'Caio de Teste'");
    console.log(`   4. Configure para ${todayName} (dia ${today})`);
    console.log("   5. Adicione exercícios ao treino");
    process.exit(0);
  }

  console.log(`📋 Treinos encontrados: ${workouts.length}\n`);

  let hasTodayWorkout = false;

  workouts.forEach((workout, index) => {
    // day_of_week agora é um array de inteiros
    const dayNames =
      workout.day_of_week && workout.day_of_week.length > 0
        ? workout.day_of_week.map((d: number) => days[d]).join(", ")
        : "NÃO DEFINIDO";
    const isToday = workout.day_of_week?.includes(today);
    const exerciseCount = workout.workout_exercises?.length || 0;

    if (isToday) hasTodayWorkout = true;

    console.log(`${index + 1}. ${workout.name}`);
    console.log(`   📅 Dia: ${dayNames} ${isToday ? "← HOJE!" : ""}`);
    console.log(`   📊 Exercícios: ${exerciseCount}`);
    console.log(`   🆔 ID: ${workout.id}`);

    if (isToday) {
      if (exerciseCount === 0) {
        console.log(`   ⚠️  SEM EXERCÍCIOS - O BOT NÃO VAI FUNCIONAR!`);
      } else {
        console.log(`   ✅ PRONTO PARA USAR!`);
        workout.workout_exercises?.forEach((we: any, i: number) => {
          console.log(
            `      ${i + 1}. ${we.exercises?.name || "Exercício"} - ${we.target_sets}x${we.target_reps}`,
          );
        });
      }
    }
    console.log("");
  });

  if (!hasTodayWorkout) {
    console.log(`❌ NÃO HÁ TREINO PARA ${todayName.toUpperCase()}!`);
    console.log("\n📝 AÇÃO NECESSÁRIA:");
    console.log("   1. Acesse: https://project-pxgam.vercel.app/");
    console.log("   2. Vá em 'Treinos'");
    console.log("   3. Crie ou edite um treino");
    console.log(`   4. Configure para ${todayName} (dia ${today})`);
    console.log("   5. Adicione exercícios");
  } else {
    console.log("✅ Aluno está pronto para usar o bot!");
    console.log("\n📱 Para testar:");
    console.log(`   1. Do WhatsApp ${whatsapp}`);
    console.log("   2. Mande mensagem para: 5511964099351");
    console.log("   3. Digite: Iniciar treino");
  }
}

checkSpecificStudent();
