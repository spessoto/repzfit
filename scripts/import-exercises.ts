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
  method: string | null;
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
    const method =
      pickColumn(row, ["Método", "Metodo", "method", "Method"]) ||
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
      method,
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
  const uniqueExercises = Array.from(
    new Set(rows.map((r) => normalizeText(r.exerciseName)).filter(Boolean)),
  );

  const variationKeySet = new Set(
    rows.map((r) =>
      `${normalizeComparable(r.exerciseName)}|${normalizeComparable(r.variationName)}`,
    ),
  );

  console.log(`🧠 Resumo: ${uniqueExercises.length} exercícios, ${variationKeySet.size} variações, ${uniqueEquipments.length} equipamentos`);

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

  // Limpa somente os dados compartilhados normalizados, preservando dados privados.
  const { data: sharedVariationIds, error: sharedVariationIdsError } = await supabaseAdmin
    .from("exercise_variations")
    .select("id")
    .is("personal_id", null);

  assertNoError(sharedVariationIdsError, "list shared variation ids");

  const variationIds = (sharedVariationIds ?? []).map((v: any) => v.id);
  if (variationIds.length) {
    const { error: deleteVariationEquipmentsError } = await supabaseAdmin
      .from("exercise_variation_equipments")
      .delete()
      .in("exercise_variation_id", variationIds);
    assertNoError(
      deleteVariationEquipmentsError,
      "delete shared variation equipments",
    );
  }

  const { error: deleteSharedVariationsError } = await supabaseAdmin
    .from("exercise_variations")
    .delete()
    .is("personal_id", null);
  assertNoError(deleteSharedVariationsError, "delete shared variations");

  const { error: deleteSharedCatalogError } = await supabaseAdmin
    .from("exercise_catalog")
    .delete()
    .is("personal_id", null);
  assertNoError(deleteSharedCatalogError, "delete shared catalog");

  if (uniqueMuscleGroups.length) {
    const { error: muscleGroupError } = await supabaseAdmin
      .from("muscle_groups")
      .upsert(uniqueMuscleGroups.map((name) => ({ name })), { onConflict: "name" });
    assertNoError(muscleGroupError, "upsert muscle groups");
  }

  if (uniqueEquipments.length) {
    const { error: equipmentError } = await supabaseAdmin
      .from("equipment_catalog")
      .upsert(uniqueEquipments.map((name) => ({ name })), { onConflict: "name" });
    assertNoError(equipmentError, "upsert equipment catalog");
  }

  const { data: insertedCatalog, error: catalogError } = await supabaseAdmin
    .from("exercise_catalog")
    .insert(uniqueExercises.map((name) => ({ name, personal_id: null })))
    .select("id,name");

  assertNoError(catalogError, "insert exercise catalog");

  const catalogByName = new Map<string, string>();
  for (const item of insertedCatalog ?? []) {
    catalogByName.set(normalizeComparable(item.name), item.id);
  }

  const { data: muscleGroups, error: muscleGroupsError } = await supabaseAdmin
    .from("muscle_groups")
    .select("id,name");
  assertNoError(muscleGroupsError, "read muscle groups");
  const muscleGroupIdByName = new Map<string, string>();
  (muscleGroups ?? []).forEach((mg: any) => {
    muscleGroupIdByName.set(normalizeComparable(mg.name), mg.id);
  });

  const variationInput = rows.map((row) => ({
    personal_id: null,
    exercise_catalog_id: catalogByName.get(normalizeComparable(row.exerciseName)),
    name: row.variationName,
    method: row.method,
    short_description: row.description,
    ai_default_description: row.description,
    ai_default_muscle_group_id: row.muscleGroup
      ? muscleGroupIdByName.get(normalizeComparable(row.muscleGroup)) ?? null
      : null,
    gif_url: row.gifUrl,
  }));

  const invalidVariationRows = variationInput.filter((row) => !row.exercise_catalog_id);
  if (invalidVariationRows.length) {
    throw new Error("Falha ao mapear catálogo para todas as variações");
  }

  const { data: insertedVariations, error: variationError } = await supabaseAdmin
    .from("exercise_variations")
    .insert(variationInput)
    .select("id,name,exercise_catalog_id");
  assertNoError(variationError, "insert exercise variations");

  const { data: equipmentCatalog, error: equipmentCatalogError } = await supabaseAdmin
    .from("equipment_catalog")
    .select("id,name");
  assertNoError(equipmentCatalogError, "read equipment catalog");
  const equipmentIdByName = new Map<string, string>();
  (equipmentCatalog ?? []).forEach((item: any) => {
    equipmentIdByName.set(normalizeComparable(item.name), item.id);
  });

  const variationLookup = new Map<string, string>();
  (insertedVariations ?? []).forEach((variation: any, index: number) => {
    const row = rows[index];
    const key = `${normalizeComparable(row.exerciseName)}|${normalizeComparable(row.variationName)}`;
    variationLookup.set(key, variation.id);
  });

  const variationEquipmentRows: Array<{ exercise_variation_id: string; equipment_id: string }> = [];
  rows.forEach((row) => {
    const key = `${normalizeComparable(row.exerciseName)}|${normalizeComparable(row.variationName)}`;
    const variationId = variationLookup.get(key);
    if (!variationId) return;

    row.equipments.forEach((equipmentName) => {
      const equipmentId = equipmentIdByName.get(normalizeComparable(equipmentName));
      if (!equipmentId) return;
      variationEquipmentRows.push({
        exercise_variation_id: variationId,
        equipment_id: equipmentId,
      });
    });
  });

  if (variationEquipmentRows.length) {
    const dedupMap = new Map<string, { exercise_variation_id: string; equipment_id: string }>();
    variationEquipmentRows.forEach((item) => {
      dedupMap.set(`${item.exercise_variation_id}|${item.equipment_id}`, item);
    });

    const { error: linkError } = await supabaseAdmin
      .from("exercise_variation_equipments")
      .insert(Array.from(dedupMap.values()));

    assertNoError(linkError, "insert variation equipment links");
  }

  // Recria base legada compartilhada (compatibilidade com telas e bot atuais).
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

  // Atualiza relacionamento das variações para compatibilidade.
  for (const variation of rows) {
    const variationKey = `${normalizeComparable(variation.exerciseName)}|${normalizeComparable(variation.variationName)}`;
    const variationId = variationLookup.get(variationKey);
    const legacyId = newLegacyByKey.get(
      legacyExerciseKey({
        name: variation.exerciseName,
        muscleGroup: variation.muscleGroup,
        equipmentCsv: variation.equipments.join(", "),
      }),
    );
    if (!variationId || !legacyId) continue;
    await supabaseAdmin
      .from("exercise_variations")
      .update({ legacy_exercise_id: legacyId })
      .eq("id", variationId);
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
          normalizeComparable(candidate.muscleGroup ?? "") ===
          normalizedMuscleGroup,
      );

      if (candidateByMuscle) {
        newId = candidateByMuscle.id;
      }
    }

    if (!newId) {
      continue;
    }

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
  console.log(`   Exercícios canônicos: ${uniqueExercises.length}`);
  console.log(`   Variações: ${variationKeySet.size}`);
  console.log(`   Remapeados da base antiga: ${remappedCount}`);
}

importExercises().catch((error) => {
  console.error("\n❌ Falha na importação:", error?.message || error);
  process.exit(1);
});
