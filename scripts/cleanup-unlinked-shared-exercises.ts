import { supabaseAdmin } from "../src/config/supabase.js";

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

async function run() {
  const { data: sharedRows, error: sharedError } = await supabaseAdmin
    .from("exercises")
    .select("id")
    .is("personal_id", null);
  if (sharedError) throw sharedError;

  const sharedIds = (sharedRows ?? []).map((row: any) => String(row.id));
  if (!sharedIds.length) {
    console.log("✅ Nenhum exercício compartilhado para limpar.");
    return;
  }

  const { data: refRows, error: refError } = await supabaseAdmin
    .from("workout_exercises")
    .select("exercise_id");
  if (refError) throw refError;
  const referencedIds = new Set(
    (refRows ?? []).map((row: any) => String(row.exercise_id ?? "")).filter(Boolean),
  );

  const { data: linkedRows, error: linkedError } = await supabaseAdmin
    .from("exercise_variations")
    .select("legacy_exercise_id")
    .not("legacy_exercise_id", "is", null);
  if (linkedError) throw linkedError;
  const linkedIds = new Set(
    (linkedRows ?? [])
      .map((row: any) => String(row.legacy_exercise_id ?? ""))
      .filter(Boolean),
  );

  const deletableIds = sharedIds.filter(
    (id) => !referencedIds.has(id) && !linkedIds.has(id),
  );

  let deleted = 0;
  for (const chunk of chunkArray(deletableIds, 200)) {
    if (!chunk.length) continue;
    const { error: deleteError } = await supabaseAdmin
      .from("exercises")
      .delete()
      .in("id", chunk);
    if (deleteError) throw deleteError;
    deleted += chunk.length;
  }

  console.log(`✅ Exercícios compartilhados analisados: ${sharedIds.length}`);
  console.log(`✅ Removidos (sem vínculo): ${deleted}`);
  console.log(`ℹ️ Mantidos por referência/vínculo: ${sharedIds.length - deleted}`);
}

run().catch((error) => {
  console.error("❌ Falha na limpeza:", error?.message || error);
  process.exit(1);
});
