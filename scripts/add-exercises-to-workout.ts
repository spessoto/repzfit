import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

async function addExercisesToWorkout() {
  const workoutId = "18eb7956-01a3-4b7e-8a6d-c6fa5f806d02";

  console.log("🔍 Verificando exercícios disponíveis...\n");

  // Buscar exercícios
  const { data: exercises } = await supabase
    .from("exercises")
    .select("*")
    .limit(3);

  if (!exercises || exercises.length === 0) {
    console.log("❌ Não há exercícios cadastrados!");
    process.exit(1);
  }

  console.log(`📋 ${exercises.length} exercício(s) encontrado(s):\n`);
  exercises.forEach((ex, i) => {
    console.log(`   ${i + 1}. ${ex.name}`);
  });

  // Verificar se já tem exercícios no treino
  const { data: existing } = await supabase
    .from("workout_exercises")
    .select("*")
    .eq("workout_id", workoutId);

  if (existing && existing.length > 0) {
    console.log(
      `\n⚠️  Treino já tem ${existing.length} exercício(s) cadastrado(s)`,
    );
    console.log("   Removendo para adicionar novos...\n");

    await supabase
      .from("workout_exercises")
      .delete()
      .eq("workout_id", workoutId);
  }

  console.log("\n➕ Adicionando exercícios ao treino...\n");

  // Adicionar cada exercício
  const workoutExercises = exercises.map((exercise, index) => ({
    workout_id: workoutId,
    exercise_id: exercise.id,
    target_sets: 3,
    target_reps: 12,
    target_weight: 20.0,
    order_index: index + 1,
  }));

  const { data: inserted, error } = await supabase
    .from("workout_exercises")
    .insert(workoutExercises)
    .select();

  if (error) {
    console.error("❌ Erro ao adicionar exercícios:", error);
    process.exit(1);
  }

  console.log(
    `✅ ${inserted?.length || 0} exercício(s) adicionado(s) ao treino!\n`,
  );

  inserted?.forEach((we, i) => {
    const ex = exercises.find((e) => e.id === we.exercise_id);
    console.log(`   ${i + 1}. ${ex?.name}`);
    console.log(`      Séries: ${we.target_sets}x${we.target_reps}`);
    console.log(`      Peso: ${we.target_weight}kg\n`);
  });

  console.log("✅ Treino está pronto!");
  console.log("\n📱 Agora você pode testar:");
  console.log("   1. Do WhatsApp 5511937474389");
  console.log("   2. Mande mensagem para: 5511964099351");
  console.log("   3. Digite: Iniciar treino");
  console.log("\n   O bot deve responder! 🎉");
}

addExercisesToWorkout();
