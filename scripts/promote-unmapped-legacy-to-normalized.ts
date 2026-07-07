import { supabaseAdmin } from "../src/config/supabase.js";

type LegacyExercise = {
  id: string;
  name: string;
  muscle_group: string | null;
  equipment: string | null;
};

function normalizeComparable(value: unknown): string {
  return String(value ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

async function getUnmappedReferencedLegacy(): Promise<LegacyExercise[]> {
  const { data: referencedRows, error: referencedError } = await supabaseAdmin
    .from("workout_exercises")
    .select("exercise_id, exercises!inner(id,name,muscle_group,equipment,personal_id)");

  if (referencedError) throw referencedError;

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

  const unresolved = new Map<string, LegacyExercise>();

  for (const row of referencedRows ?? []) {
    const ex = Array.isArray((row as any).exercises)
      ? (row as any).exercises[0]
      : (row as any).exercises;

    if (!ex) continue;
    if (ex.personal_id !== null) continue;

    const exerciseId = String((row as any).exercise_id ?? ex.id ?? "");
    if (!exerciseId || linkedIds.has(exerciseId)) continue;

    unresolved.set(exerciseId, {
      id: exerciseId,
      name: String(ex.name ?? ""),
      muscle_group: ex.muscle_group ?? null,
      equipment: ex.equipment ?? null,
    });
  }

  return Array.from(unresolved.values());
}

async function run() {
  const unresolved = await getUnmappedReferencedLegacy();
  if (!unresolved.length) {
    console.log("✅ Nenhum legado pendente para promover.");
    return;
  }

  const { data: allMuscleGroups, error: muscleGroupsError } = await supabaseAdmin
    .from("muscle_groups")
    .select("id,name");
  if (muscleGroupsError) throw muscleGroupsError;

  const muscleMap = new Map<string, string>();
  (allMuscleGroups ?? []).forEach((mg: any) => {
    muscleMap.set(normalizeComparable(mg.name), mg.id);
  });

  const createdCatalogByName = new Map<string, string>();
  let createdCatalog = 0;
  let createdVariation = 0;

  for (const legacy of unresolved) {
    const normalizedName = normalizeComparable(legacy.name);

    let catalogId = createdCatalogByName.get(normalizedName);
    if (!catalogId) {
      const { data: existingCatalog, error: existingCatalogError } = await supabaseAdmin
        .from("exercise_catalog")
        .select("id,name")
        .is("personal_id", null)
        .eq("name", legacy.name)
        .limit(1)
        .maybeSingle();

      if (existingCatalogError) throw existingCatalogError;

      if (existingCatalog?.id) {
        catalogId = existingCatalog.id;
      } else {
        const { data: insertedCatalog, error: insertedCatalogError } = await supabaseAdmin
          .from("exercise_catalog")
          .insert({
            personal_id: null,
            name: legacy.name,
          })
          .select("id")
          .single();

        if (insertedCatalogError) throw insertedCatalogError;
        catalogId = insertedCatalog.id;
        createdCatalog += 1;
      }

      createdCatalogByName.set(normalizedName, catalogId);
    }

    const { data: existingVariation, error: existingVariationError } = await supabaseAdmin
      .from("exercise_variations")
      .select("id")
      .eq("legacy_exercise_id", legacy.id)
      .limit(1)
      .maybeSingle();

    if (existingVariationError) throw existingVariationError;
    if (existingVariation?.id) continue;

    const muscleId = legacy.muscle_group
      ? muscleMap.get(normalizeComparable(legacy.muscle_group)) ?? null
      : null;

    const { error: insertedVariationError } = await supabaseAdmin
      .from("exercise_variations")
      .insert({
        personal_id: null,
        exercise_catalog_id: catalogId,
        name: legacy.name,
        short_description: null,
        ai_default_description: null,
        ai_default_muscle_group_id: muscleId,
        legacy_exercise_id: legacy.id,
      });

    if (insertedVariationError) throw insertedVariationError;
    createdVariation += 1;
  }

  console.log(`✅ Catálogos criados: ${createdCatalog}`);
  console.log(`✅ Variações criadas para legados: ${createdVariation}`);
  console.log(`✅ Legados promovidos: ${unresolved.length}`);
}

run().catch((error) => {
  console.error("❌ Falha na promoção:", error?.message || error);
  process.exit(1);
});
