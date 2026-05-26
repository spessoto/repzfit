import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

async function fixWorkout() {
  const workoutId = "18eb7956-01a3-4b7e-8a6d-c6fa5f806d02";
  const today = new Date().getDay(); // Terça = 2

  console.log(`🔧 Corrigindo treino para dia ${today} (Terça)...\n`);

  // Atualizar dia da semana
  const { error: updateError } = await supabase
    .from("workouts")
    .update({
      day_of_week: [today], // Array com o dia de hoje
    })
    .eq("id", workoutId);

  if (updateError) {
    console.error("❌ Erro ao atualizar treino:", updateError);
    process.exit(1);
  }

  console.log("✅ Treino atualizado:");
  console.log(`   Dia da semana: Terça (${today})`);
  console.log(`   Válido de: hoje até +30 dias\n`);

  // Verificar exercícios
  const { data: exercises } = await supabase
    .from("exercises")
    .select("*")
    .limit(3);

  if (!exercises || exercises.length === 0) {
    console.log("⚠️  Não há exercícios cadastrados no sistema!");
    console.log(
      "   Você precisa criar exercícios antes de adicioná-los ao treino.\n",
    );
    console.log("📝 Para criar exercícios:");
    console.log("   1. Acesse: https://project-pxgam.vercel.app/");
    console.log("   2. Vá em 'Exercícios'");
    console.log("   3. Cadastre alguns exercícios");
    console.log("   4. Depois volte em 'Treinos' e adicione ao treino");
    process.exit(0);
  }

  console.log(`📋 ${exercises.length} exercício(s) disponível(is):`);
  exercises.forEach((ex, i) => {
    console.log(`   ${i + 1}. ${ex.name}`);
  });

  console.log("\n💡 Agora você precisa adicionar exercícios ao treino:");
  console.log("   1. Acesse: https://project-pxgam.vercel.app/");
  console.log("   2. Vá em 'Treinos'");
  console.log("   3. Edite o 'Treino A'");
  console.log("   4. Adicione exercícios da lista acima");
  console.log("   5. Defina séries e repetições");
  console.log("   6. Salve o treino");
  console.log("\n   Depois disso, o bot vai funcionar!");
}

fixWorkout();
