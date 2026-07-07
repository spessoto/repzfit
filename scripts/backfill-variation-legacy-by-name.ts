import { supabaseAdmin } from "../src/config/supabase.js";

type VariationRow = {
  id: string;
  legacy_exercise_id: string | null;
  exercise_catalog: { name: string } | { name: string }[] | null;
};

type ExerciseRow = {
  id: string;
  name: string;
  personal_id: string | null;
};

function normalizeComparable(value: unknown): string {
  return String(value ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

async function run() {
  const { data: variationsRaw, error: variationsError } = await supabaseAdmin
    .from("exercise_variations")
    .select("id,legacy_exercise_id,exercise_catalog(name)")
    .is("personal_id", null);

  if (variationsError) throw variationsError;

  const { data: exercisesRaw, error: exercisesError } = await supabaseAdmin
    .from("exercises")
    .select("id,name,personal_id")
    .is("personal_id", null)
    .order("created_at", { ascending: false });

  if (exercisesError) throw exercisesError;

  const variations = (variationsRaw ?? []) as VariationRow[];
  const exercises = (exercisesRaw ?? []) as ExerciseRow[];

  const byName = new Map<string, ExerciseRow[]>();
  for (const ex of exercises) {
    const key = normalizeComparable(ex.name);
    if (!key) continue;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key)!.push(ex);
  }

  let updated = 0;
  let skipped = 0;

  for (const variation of variations) {
    if (variation.legacy_exercise_id) {
      skipped += 1;
      continue;
    }

    const catalog = Array.isArray(variation.exercise_catalog)
      ? variation.exercise_catalog[0]
      : variation.exercise_catalog;
    const catalogName = catalog?.name ? normalizeComparable(catalog.name) : "";
    if (!catalogName) {
      skipped += 1;
      continue;
    }

    const candidates = byName.get(catalogName) ?? [];
    const candidate = candidates[0];
    if (!candidate) {
      skipped += 1;
      continue;
    }

    const { error: updateError } = await supabaseAdmin
      .from("exercise_variations")
      .update({ legacy_exercise_id: candidate.id })
      .eq("id", variation.id);

    if (updateError) throw updateError;
    updated += 1;
  }

  console.log(`✅ Variações atualizadas com legacy_exercise_id: ${updated}`);
  console.log(`ℹ️ Variações sem atualização: ${skipped}`);
}

run().catch((error) => {
  console.error("❌ Falha no backfill:", error?.message || error);
  process.exit(1);
});
