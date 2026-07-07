import { supabaseAdmin } from "../src/config/supabase.js";

type ExerciseRow = {
  id: string;
  name: string;
  muscle_group: string | null;
  equipment: string | null;
  personal_id: string | null;
};

type WorkoutExerciseRow = {
  id: string;
  exercise_id: string;
};

function normalizeComparable(value: unknown): string {
  return String(value ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function tokenizeComparable(value: unknown): string[] {
  return normalizeComparable(value)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function jaccard(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const aSet = new Set(a);
  const bSet = new Set(b);
  let intersection = 0;
  aSet.forEach((token) => {
    if (bSet.has(token)) intersection += 1;
  });
  const union = new Set([...aSet, ...bSet]).size;
  return union ? intersection / union : 0;
}

function similarityScore(source: ExerciseRow, target: ExerciseRow): number {
  const sourceName = normalizeComparable(source.name);
  const targetName = normalizeComparable(target.name);

  if (!sourceName || !targetName) return 0;

  let score = 0;

  if (sourceName === targetName) score += 1.0;
  else if (targetName.includes(sourceName) || sourceName.includes(targetName))
    score += 0.88;
  else score += jaccard(tokenizeComparable(sourceName), tokenizeComparable(targetName)) * 0.75;

  const sourceGroup = normalizeComparable(source.muscle_group);
  const targetGroup = normalizeComparable(target.muscle_group);
  if (sourceGroup && targetGroup && (sourceGroup.includes(targetGroup) || targetGroup.includes(sourceGroup))) {
    score += 0.2;
  }

  const sourceEquipment = normalizeComparable(source.equipment);
  const targetEquipment = normalizeComparable(target.equipment);
  if (
    sourceEquipment &&
    targetEquipment &&
    (sourceEquipment.includes(targetEquipment) || targetEquipment.includes(sourceEquipment))
  ) {
    score += 0.1;
  }

  return score;
}

async function resolveUnmappedLegacyExercises() {
  const { data: allWorkoutExercises, error: allWorkoutExercisesError } = await supabaseAdmin
    .from("workout_exercises")
    .select("id,exercise_id");

  if (allWorkoutExercisesError) throw allWorkoutExercisesError;

  const workoutRows = (allWorkoutExercises ?? []) as WorkoutExerciseRow[];
  const referencedExerciseIds = new Set(workoutRows.map((row) => row.exercise_id));

  const { data: allExercises, error: allExercisesError } = await supabaseAdmin
    .from("exercises")
    .select("id,name,muscle_group,equipment,personal_id");

  if (allExercisesError) throw allExercisesError;

  const exercises = (allExercises ?? []) as ExerciseRow[];

  const { data: linkedVariations, error: linkedVariationsError } = await supabaseAdmin
    .from("exercise_variations")
    .select("legacy_exercise_id")
    .not("legacy_exercise_id", "is", null);

  if (linkedVariationsError) throw linkedVariationsError;

  const alreadyLinkedLegacyIds = new Set(
    (linkedVariations ?? [])
      .map((row: any) => String(row.legacy_exercise_id ?? ""))
      .filter(Boolean),
  );

  const unresolvedLegacy = exercises.filter(
    (ex) => ex.personal_id === null && referencedExerciseIds.has(ex.id) && !alreadyLinkedLegacyIds.has(ex.id),
  );

  const candidates = exercises.filter(
    (ex) => ex.personal_id === null && !unresolvedLegacy.some((u) => u.id === ex.id),
  );

  if (!unresolvedLegacy.length) {
    console.log("✅ Nenhum legado pendente para resolver.");
    return;
  }

  let remapped = 0;
  let stillUnmapped = 0;

  for (const legacy of unresolvedLegacy) {
    const ranked = candidates
      .map((candidate) => ({ candidate, score: similarityScore(legacy, candidate) }))
      .sort((a, b) => b.score - a.score);

    const best = ranked[0];
    if (!best || best.score < 0.65) {
      stillUnmapped += 1;
      console.log(
        `⚠️ Sem match seguro para: ${legacy.name} (grupo: ${legacy.muscle_group ?? "-"})`,
      );
      continue;
    }

    const { error: updateWorkoutError } = await supabaseAdmin
      .from("workout_exercises")
      .update({ exercise_id: best.candidate.id })
      .eq("exercise_id", legacy.id);

    if (updateWorkoutError) {
      throw updateWorkoutError;
    }

    const { error: updateVariationError } = await supabaseAdmin
      .from("exercise_variations")
      .update({ legacy_exercise_id: best.candidate.id })
      .eq("legacy_exercise_id", legacy.id);

    if (updateVariationError) {
      throw updateVariationError;
    }

    remapped += 1;
    console.log(
      `✅ ${legacy.name} -> ${best.candidate.name} (score ${best.score.toFixed(2)})`,
    );
  }

  // After remap, delete leftover legacy rows no longer referenced.
  const { data: remainingRefsRows, error: remainingRefsRowsError } = await supabaseAdmin
    .from("workout_exercises")
    .select("exercise_id");

  if (remainingRefsRowsError) throw remainingRefsRowsError;

  const remainingRefIds = new Set(
    (remainingRefsRows ?? []).map((row: any) => String(row.exercise_id ?? "")).filter(Boolean),
  );

  const deletableLegacy = unresolvedLegacy.filter((legacy) => !remainingRefIds.has(legacy.id));
  if (deletableLegacy.length) {
    const { error: deleteLegacyError } = await supabaseAdmin
      .from("exercises")
      .delete()
      .in(
        "id",
        deletableLegacy.map((item) => item.id),
      );

    if (deleteLegacyError) throw deleteLegacyError;
  }

  console.log(`\nResumo:`);
  console.log(`- Legados pendentes analisados: ${unresolvedLegacy.length}`);
  console.log(`- Remapeados automaticamente: ${remapped}`);
  console.log(`- Ainda sem match seguro: ${stillUnmapped}`);
}

resolveUnmappedLegacyExercises().catch((error) => {
  console.error("❌ Falha ao resolver legados:", error?.message || error);
  process.exit(1);
});
