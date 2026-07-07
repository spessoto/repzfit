import { supabaseAdmin } from "../src/config/supabase.js";

type ExerciseRow = {
  id: string;
  name: string;
  muscle_group: string | null;
  equipment: string | null;
};

async function reportUnmappedLegacyExercises() {
  const { data: referencedRows, error: refError } = await supabaseAdmin
    .from("workout_exercises")
    .select("exercise_id, exercises!inner(id,name,muscle_group,equipment,personal_id)");

  if (refError) {
    throw refError;
  }

  const unresolved = new Map<string, ExerciseRow>();

  for (const row of referencedRows ?? []) {
    const exercise = Array.isArray((row as any).exercises)
      ? (row as any).exercises[0]
      : (row as any).exercises;

    if (!exercise) continue;
    if (exercise.personal_id !== null) continue;

    const exerciseId = String((row as any).exercise_id ?? exercise.id ?? "");
    if (!exerciseId) continue;

    const { data: linkedVariation } = await supabaseAdmin
      .from("exercise_variations")
      .select("id")
      .eq("legacy_exercise_id", exerciseId)
      .limit(1)
      .maybeSingle();

    if (linkedVariation) continue;

    unresolved.set(exerciseId, {
      id: exerciseId,
      name: String(exercise.name ?? ""),
      muscle_group: exercise.muscle_group ?? null,
      equipment: exercise.equipment ?? null,
    });
  }

  const list = Array.from(unresolved.values()).sort((a, b) =>
    a.name.localeCompare(b.name, "pt-BR"),
  );

  if (!list.length) {
    console.log("✅ Nenhum exercício legado referenciado sem mapeamento.");
    return;
  }

  console.log(`⚠️ ${list.length} exercícios legados referenciados sem mapeamento:`);
  list.forEach((item, idx) => {
    console.log(
      `${idx + 1}. ${item.name} | grupo: ${item.muscle_group ?? "-"} | equipamento: ${item.equipment ?? "-"} | id: ${item.id}`,
    );
  });
}

reportUnmappedLegacyExercises().catch((error) => {
  console.error("❌ Falha ao gerar relatório:", error?.message || error);
  process.exit(1);
});
