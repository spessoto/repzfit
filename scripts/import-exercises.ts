import XLSX from "xlsx";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { supabaseAdmin } from "../src/config/supabase.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

type InputRow = {
  row: number;
  exerciseName: string;
  variationName: string;
  muscleGroup: string | null;
  description: string | null;
  gifUrl: string | null;
  equipments: string[];
};

type ExistingSharedExercise = {
  id: string;
  name: string;
  muscle_group: string | null;
  equipment: string | null;
  description: string | null;
};

function assertNoError(error: any, context: string) {
  if (!error) return;
  const serialized = JSON.stringify(error);
  const message = error?.message || serialized || String(error);
  throw new Error(`${context}: ${message}`);
}

function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeComparable(value: unknown): string {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function splitCsv(value: unknown): string[] {
  return normalizeText(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function chunkArray<T>(input: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < input.length; i += size) {
    chunks.push(input.slice(i, i + size));
  }
  return chunks;
}

function tokenizeComparableName(value: string): string[] {
  return normalizeComparable(value)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function scoreNameSimilarity(sourceName: string, targetName: string): number {
  const source = normalizeComparable(sourceName);
  const target = normalizeComparable(targetName);
  if (!source || !target) return 0;
  if (source === target) return 1;
  if (source.includes(target) || target.includes(source)) return 0.92;

  const sourceTokens = tokenizeComparableName(sourceName);
  const targetTokens = tokenizeComparableName(targetName);
  if (!sourceTokens.length || !targetTokens.length) return 0;

  const sourceSet = new Set(sourceTokens);
  const targetSet = new Set(targetTokens);
  let intersection = 0;
  sourceSet.forEach((token) => {
    if (targetSet.has(token)) intersection += 1;
  });

  const union = new Set([...sourceSet, ...targetSet]).size;
  if (!union) return 0;
  return intersection / union;
}

function resolveInputFilePath(): string {
  const cliPath = process.argv.find((arg) => arg.startsWith("--file="));
  if (cliPath) {
    return resolve(process.cwd(), cliPath.replace("--file=", ""));
  }

  const candidates = [
    "Tabela Completa de Exercícios de Academia (1).xlsx",
    "Tabela Completa de Exercícios de Academia.xlsx",
  ];

  for (const candidate of candidates) {
    const candidatePath = join(__dirname, "..", candidate);
    if (existsSync(candidatePath)) {
      return candidatePath;
    }
  }

  return join(__dirname, "..", candidates[0]);
}

function pickColumn(row: Record<string, unknown>, aliases: string[]): string {
  for (const alias of aliases) {
    if (row[alias] != null && normalizeText(row[alias])) {
      return normalizeText(row[alias]);
    }
  }
  return "";
}

function parseWorkbookRows(filePath: string): InputRow[] {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
    defval: "",
  });

  const parsed: InputRow[] = [];

  rawRows.forEach((row, index) => {
    const exerciseName = pickColumn(row, [
      "Exercício",
      "Exercicio",
      "Nome Exercício",
      "Nome do Exercício",
      "Nome",
      "exercise",
      "name",
    ]);

    const variationName =
      pickColumn(row, ["Variação", "Variacao", "variation", "Subcategoria"]) ||
      exerciseName;

    if (!exerciseName) {
      return;
    }

    const muscleGroup =
      pickColumn(row, ["Grupo Muscular", "Músculo", "Musculo", "muscle_group"]) ||
      null;
    const description =
      pickColumn(row, ["Descrição", "Descricao", "Execução", "Execucao", "description"]) ||
      null;
    const gifUrl =
      pickColumn(row, ["GIF", "Gif", "gif_url", "GIF URL", "Gif URL"]) ||
      null;

    const equipmentRaw = pickColumn(row, [
      "Equipamento",
      "Equipamentos",
      "equipment",
      "equipment_list",
    ]);

    parsed.push({
      row: index + 2,
      exerciseName,
      variationName,
      muscleGroup,
      description,
      gifUrl,
      equipments: splitCsv(equipmentRaw),
    });
  });

  return parsed;
}

function legacyExerciseKey(input: {
  name: string;
  muscleGroup?: string | null;
  equipmentCsv?: string | null;
}) {
  return [
    normalizeComparable(input.name),
    normalizeComparable(input.muscleGroup ?? ""),
    normalizeComparable(input.equipmentCsv ?? ""),
  ].join("|");
}

async function importExercises() {
  const filePath = resolveInputFilePath();
  const dryRun = process.argv.includes("--dry-run");

  if (!existsSync(filePath)) {
    console.error(`❌ Arquivo não encontrado: ${filePath}`);
    console.log("\nUse: npx tsx scripts/import-exercises.ts --file=<caminho.xlsx>");
    process.exit(1);
  }

  console.log(`📖 Lendo arquivo: ${filePath}`);
  const rows = parseWorkbookRows(filePath);

  if (!rows.length) {
    throw new Error("Nenhuma linha válida encontrada na planilha");
  }

  console.log(`✅ ${rows.length} linhas válidas lidas`);

  const uniqueMuscleGroups = Array.from(
    new Set(rows.map((r) => r.muscleGroup).filter(Boolean) as string[]),
  );
  const uniqueEquipments = Array.from(
    new Set(rows.flatMap((r) => r.equipments).filter(Boolean)),
  );
  const uniqueExerciseNames = Array.from(
    new Set(rows.map((r) => normalizeText(r.exerciseName)).filter(Boolean)),
  );
  const uniqueVariationNames = Array.from(
    new Set(rows.map((r) => normalizeText(r.variationName)).filter(Boolean)),
  );

  console.log(`🧠 Resumo: ${uniqueExerciseNames.length} exercícios, ${uniqueVariationNames.length} variações, ${uniqueEquipments.length} equipamentos`);

  if (dryRun) {
    console.log("🧪 Dry run habilitado, nenhuma alteração será aplicada.");
    return;
  }

  // Snapshot da base compartilhada antiga para remapeamento seguro.
  const { data: oldSharedExercises, error: oldSharedError } = await supabaseAdmin
    .from("exercises")
    .select("id,name,muscle_group,equipment,description")
    .is("personal_id", null);

  assertNoError(oldSharedError, "snapshot old shared exercises");

  const oldShared = (oldSharedExercises ?? []) as ExistingSharedExercise[];
  const oldSharedIds = oldShared.map((item) => item.id);
  const oldSharedMap = new Map<string, string>();
  oldShared.forEach((item) => {
    oldSharedMap.set(
      legacyExerciseKey({
        name: item.name,
        muscleGroup: item.muscle_group,
        equipmentCsv: item.equipment,
      }),
      item.id,
    );
  });

  console.log(`📦 Snapshot da base antiga capturado (${oldShared.length} exercícios compartilhados)`);

  // ── Muscle groups ──────────────────────────────────────────────────────────
  if (uniqueMuscleGroups.length) {
    const { error: muscleGroupError } = await supabaseAdmin
      .from("muscle_groups")
      .upsert(uniqueMuscleGroups.map((name) => ({ name })), { onConflict: "name" });
    assertNoError(muscleGroupError, "upsert muscle groups");
  }

  const { data: muscleGroups, error: muscleGroupsError } = await supabaseAdmin
    .from("muscle_groups")
    .select("id,name");
  assertNoError(muscleGroupsError, "read muscle groups");
  const muscleGroupIdByName = new Map<string, string>();
  (muscleGroups ?? []).forEach((mg: any) => {
    muscleGroupIdByName.set(normalizeComparable(mg.name), mg.id);
  });

  // ── Equipment catalog (upsert, stable IDs) ─────────────────────────────────
  if (uniqueEquipments.length) {
    const { error: equipmentError } = await supabaseAdmin
      .from("equipment_catalog")
      .upsert(uniqueEquipments.map((name) => ({ name })), { onConflict: "name" });
    assertNoError(equipmentError, "upsert equipment catalog");
  }

  // ── Exercise catalog (get-existing + insert-new, preserve IDs) ────────────
  const { data: existingCatalog, error: existingCatalogError } = await supabaseAdmin
    .from("exercise_catalog")
    .select("id,name")
    .is("personal_id", null);
  assertNoError(existingCatalogError, "read existing exercise catalog");

  const catalogByName = new Map<string, string>();
  for (const item of existingCatalog ?? []) {
    catalogByName.set(normalizeComparable(item.name), item.id);
  }

  const newExerciseNames = uniqueExerciseNames.filter(
    (name) => !catalogByName.has(normalizeComparable(name)),
  );

  if (newExerciseNames.length) {
    const { data: insertedCatalog, error: catalogError } = await supabaseAdmin
      .from("exercise_catalog")
      .insert(newExerciseNames.map((name) => ({ name, personal_id: null })))
      .select("id,name");
    assertNoError(catalogError, "insert new exercise catalog");
    for (const item of insertedCatalog ?? []) {
      catalogByName.set(normalizeComparable(item.name), item.id);
    }
  }

  console.log(`📂 Catálogo de exercícios: ${existingCatalog?.length ?? 0} existentes, ${newExerciseNames.length} novos`);

  // ── Exercise variations (get-existing + insert-new by name, preserve IDs) ──
  const { data: existingVariations, error: existingVariationsError } = await supabaseAdmin
    .from("exercise_variations")
    .select("id,name")
    .is("personal_id", null);
  assertNoError(existingVariationsError, "read existing exercise variations");

  const variationByName = new Map<string, string>();
  for (const item of existingVariations ?? []) {
    variationByName.set(normalizeComparable(item.name), item.id);
  }

  const newVariationRows = uniqueVariationNames
    .filter((name) => !variationByName.has(normalizeComparable(name)))
    .map((name) => {
      const matchRow = rows.find(
        (r) => normalizeComparable(r.variationName) === normalizeComparable(name),
      );
      return {
        personal_id: null,
        name,
        short_description: matchRow?.description ?? null,
        ai_default_description: matchRow?.description ?? null,
        ai_default_muscle_group_id: matchRow?.muscleGroup
          ? (muscleGroupIdByName.get(normalizeComparable(matchRow.muscleGroup)) ?? null)
          : null,
        gif_url: matchRow?.gifUrl ?? null,
      };
    });

  if (newVariationRows.length) {
    const { data: insertedVariations, error: variationError } = await supabaseAdmin
      .from("exercise_variations")
      .insert(newVariationRows)
      .select("id,name");
    assertNoError(variationError, "insert exercise variations");
    for (const item of insertedVariations ?? []) {
      variationByName.set(normalizeComparable(item.name), item.id);
    }
  }

  console.log(`🔄 Variações: ${existingVariations?.length ?? 0} existentes, ${newVariationRows.length} novas`);

  // ── Legacy exercises (recria a base compartilhada) ─────────────────────────
  const legacyInsert = rows.map((row) => ({
    personal_id: null,
    name: row.exerciseName,
    description: row.description,
    muscle_group: row.muscleGroup,
    equipment: row.equipments.join(", ") || null,
    tags: null,
    gif_url: row.gifUrl,
  }));

  const { data: newLegacyRows, error: newLegacyError } = await supabaseAdmin
    .from("exercises")
    .insert(legacyInsert)
    .select("id,name,muscle_group,equipment");

  assertNoError(newLegacyError, "insert legacy compatibility rows");

  const newLegacyByKey = new Map<string, string>();
  const newLegacyByName = new Map<string, string>();
  const newLegacyNameEntries: Array<{
    id: string;
    name: string;
    muscleGroup: string | null;
  }> = [];
  (newLegacyRows ?? []).forEach((row: any) => {
    newLegacyByKey.set(
      legacyExerciseKey({
        name: row.name,
        muscleGroup: row.muscle_group,
        equipmentCsv: row.equipment,
      }),
      row.id,
    );
    const normalizedName = normalizeComparable(row.name);
    if (!newLegacyByName.has(normalizedName)) {
      newLegacyByName.set(normalizedName, row.id);
    }
    newLegacyNameEntries.push({
      id: row.id,
      name: String(row.name ?? ""),
      muscleGroup: row.muscle_group ? String(row.muscle_group) : null,
    });
  });

  // Atualiza exercise_catalog.legacy_exercise_id
  for (const exerciseName of uniqueExerciseNames) {
    const catalogId = catalogByName.get(normalizeComparable(exerciseName));
    const legacyId = newLegacyByName.get(normalizeComparable(exerciseName));
    if (!catalogId || !legacyId) continue;
    await supabaseAdmin
      .from("exercise_catalog")
      .update({ legacy_exercise_id: legacyId })
      .eq("id", catalogId)
      .is("legacy_exercise_id", null);
  }

  // Remapeia treinos ativos/históricos dos exercícios antigos para a nova base legada.
  let remappedCount = 0;
  const mappedOldIds = new Set<string>();

  const { data: referencedRows, error: referencedRowsError } = await supabaseAdmin
    .from("workout_exercises")
    .select("exercise_id");
  assertNoError(referencedRowsError, "load referenced exercise ids");
  const referencedOldIds = new Set(
    (referencedRows ?? [])
      .map((row: any) => String(row.exercise_id ?? ""))
      .filter((id) => oldSharedMap.size > 0 && oldSharedIds.includes(id)),
  );

  for (const oldItem of oldShared) {
    const key = legacyExerciseKey({
      name: oldItem.name,
      muscleGroup: oldItem.muscle_group,
      equipmentCsv: oldItem.equipment,
    });

    let newId =
      newLegacyByKey.get(key) ??
      newLegacyByName.get(normalizeComparable(oldItem.name));

    if (!newId) {
      let bestScore = 0;
      let bestId: string | null = null;
      for (const candidate of newLegacyNameEntries) {
        const score = scoreNameSimilarity(oldItem.name, candidate.name);
        if (score > bestScore) {
          bestScore = score;
          bestId = candidate.id;
        }
      }
      if (bestId && bestScore >= 0.6) {
        newId = bestId;
      }
    }

    if (!newId && oldItem.muscle_group) {
      const normalizedMuscleGroup = normalizeComparable(oldItem.muscle_group);
      const candidateByMuscle = newLegacyNameEntries.find(
        (candidate) =>
          normalizeComparable(candidate.muscleGroup ?? "") === normalizedMuscleGroup,
      );
      if (candidateByMuscle) {
        newId = candidateByMuscle.id;
      }
    }

    if (!newId) continue;

    const { error: updateWorkoutError } = await supabaseAdmin
      .from("workout_exercises")
      .update({ exercise_id: newId })
      .eq("exercise_id", oldItem.id);

    assertNoError(updateWorkoutError, "remap workout_exercises references");
    mappedOldIds.add(oldItem.id);
    remappedCount += 1;
  }

  const unresolvedReferencedIds = oldSharedIds.filter(
    (id) => referencedOldIds.has(id) && !mappedOldIds.has(id),
  );
  const deletableOldIds = oldSharedIds.filter(
    (id) => !unresolvedReferencedIds.includes(id),
  );

  for (const idsChunk of chunkArray(deletableOldIds, 200)) {
    if (!idsChunk.length) continue;
    const { error: deleteOldSharedError } = await supabaseAdmin
      .from("exercises")
      .delete()
      .in("id", idsChunk);
    assertNoError(deleteOldSharedError, "delete old shared exercise rows");
  }

  if (unresolvedReferencedIds.length > 0) {
    console.warn(
      `⚠️ Base antiga parcialmente removida. ${unresolvedReferencedIds.length} exercícios antigos permanecem por ainda estarem referenciados e sem mapeamento seguro.`,
    );
  } else {
    console.log(`🧹 Base antiga removida (${oldSharedIds.length} registros compartilhados).`);
  }

  console.log("\n✅ Importação concluída com sucesso.");
  console.log(`   Exercícios canônicos: ${uniqueExerciseNames.length}`);
  console.log(`   Variações: ${uniqueVariationNames.length}`);
  console.log(`   Remapeados da base antiga: ${remappedCount}`);
}

importExercises().catch((error) => {
  console.error("\n❌ Falha na importação:", error?.message || error);
  process.exit(1);
});
