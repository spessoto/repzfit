import { supabaseAdmin } from "../src/config/supabase.js";

type ExerciseRow = {
  id: string;
  name: string;
  muscle_group: string | null;
  equipment: string | null;
  personal_id: string | null;
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
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  setA.forEach((token) => {
    if (setB.has(token)) intersection += 1;
  });
  const union = new Set([...setA, ...setB]).size;
  return union ? intersection / union : 0;
}

function score(source: ExerciseRow, target: ExerciseRow): number {
  const sName = normalizeComparable(source.name);
  const tName = normalizeComparable(target.name);

  let value = 0;
  if (sName === tName) value += 1;
  else if (sName.includes(tName) || tName.includes(sName)) value += 0.75;
  else value += jaccard(tokenizeComparable(sName), tokenizeComparable(tName)) * 0.7;

  const sGroup = normalizeComparable(source.muscle_group);
  const tGroup = normalizeComparable(target.muscle_group);
  if (sGroup && tGroup && (sGroup.includes(tGroup) || tGroup.includes(sGroup))) {
    value += 0.2;
  }

  const sEq = normalizeComparable(source.equipment);
  const tEq = normalizeComparable(target.equipment);
  if (sEq && tEq && (sEq.includes(tEq) || tEq.includes(sEq))) {
    value += 0.1;
  }

  return value;
}

async function run() {
  const { data: workoutRows, error: workoutError } = await supabaseAdmin
    .from("workout_exercises")
    .select("exercise_id");
  if (workoutError) throw workoutError;

  const referencedIds = new Set(
    (workoutRows ?? []).map((row: any) => String(row.exercise_id ?? "")).filter(Boolean),
  );

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

  const linkedIds = new Set(
    (linkedVariations ?? [])
      .map((row: any) => String(row.legacy_exercise_id ?? ""))
      .filter(Boolean),
  );

  const unresolved = exercises.filter(
    (e) => e.personal_id === null && referencedIds.has(e.id) && !linkedIds.has(e.id),
  );

  const candidates = exercises.filter(
    (e) => e.personal_id === null && !unresolved.some((u) => u.id === e.id),
  );

  if (!unresolved.length) {
    console.log("No unresolved legacy exercises.");
    return;
  }

  for (const item of unresolved) {
    const top = candidates
      .map((c) => ({ c, score: score(item, c) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    console.log(`\n# ${item.name} [${item.id}]`);
    console.log(`  grupo=${item.muscle_group ?? "-"} | equipamento=${item.equipment ?? "-"}`);
    top.forEach((entry, idx) => {
      console.log(
        `  ${idx + 1}. ${entry.c.name} | grupo=${entry.c.muscle_group ?? "-"} | equipamento=${entry.c.equipment ?? "-"} | score=${entry.score.toFixed(2)} | id=${entry.c.id}`,
      );
    });
  }
}

run().catch((error) => {
  console.error("Failed:", error?.message || error);
  process.exit(1);
});
