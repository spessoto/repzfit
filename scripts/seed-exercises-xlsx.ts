/**
 * Seed exercises from spreadsheet into the normalized catalog tables.
 * Columns: Grupo Muscular, Exercício, Equipamento, Execução, Pegada/Pisada, Método, Observações
 *
 * Usage: npx tsx scripts/seed-exercises-xlsx.ts [--file=<path>]
 */

import XLSX from "xlsx";
import { existsSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { supabaseAdmin } from "../src/config/supabase.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function resolveFilePath(): string {
  const cliPath = process.argv.find((a) => a.startsWith("--file="));
  if (cliPath) return resolve(process.cwd(), cliPath.replace("--file=", ""));
  const candidate = join(__dirname, "..", "src", "exercicios seed 150.xlsx");
  return candidate;
}

function cell(row: Record<string, unknown>, key: string): string {
  return String(row[key] ?? "").trim();
}

function unique(arr: string[]): string[] {
  return [...new Set(arr.filter(Boolean))].sort();
}

async function upsertCatalog(
  table: string,
  names: string[],
  conflictCol = "name",
): Promise<Map<string, string>> {
  if (!names.length) return new Map();
  const { data, error } = await supabaseAdmin
    .from(table)
    .upsert(
      names.map((name) => ({ name })),
      { onConflict: conflictCol, ignoreDuplicates: false },
    )
    .select("id,name");
  if (error) throw new Error(`${table}: ${error.message}`);
  const map = new Map<string, string>();
  for (const row of data ?? []) map.set(String(row.name).trim(), String(row.id));
  return map;
}

async function seedExercises() {
  const filePath = resolveFilePath();
  if (!existsSync(filePath)) {
    console.error(`Arquivo não encontrado: ${filePath}`);
    process.exit(1);
  }

  console.log(`📖 Lendo: ${filePath}`);
  const workbook = XLSX.readFile(filePath);
  const worksheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
    defval: "",
  });
  console.log(`✅ ${rows.length} linhas lidas`);

  // ── Extrair valores únicos por coluna ──────────────────────────────────────
  const muscleGroupNames = unique(rows.map((r) => cell(r, "Grupo Muscular")));
  const exerciseEntries = new Map<string, string>(); // name → notes
  for (const row of rows) {
    const name = cell(row, "Exercício");
    const notes = cell(row, "Observações");
    if (!name) continue;
    if (!exerciseEntries.has(name) || (!exerciseEntries.get(name) && notes)) {
      exerciseEntries.set(name, notes);
    }
  }
  const equipmentNames = unique(rows.map((r) => cell(r, "Equipamento")));
  const variationNames = unique(rows.map((r) => cell(r, "Execução")));
  const gripNames = unique(rows.map((r) => cell(r, "Pegada/Pisada")));
  const methodNames = unique(rows.map((r) => cell(r, "Método")));

  console.log(
    `\n📊 Resumo:` +
      `\n   Grupo Muscular: ${muscleGroupNames.length}` +
      `\n   Exercício:      ${exerciseEntries.size}` +
      `\n   Equipamento:    ${equipmentNames.length}` +
      `\n   Execução:       ${variationNames.length}` +
      `\n   Pegada/Pisada:  ${gripNames.length}` +
      `\n   Método:         ${methodNames.length}`,
  );

  // ── 1. Grupo Muscular → muscle_groups ─────────────────────────────────────
  console.log("\n⏳ Inserindo Grupo Muscular...");
  const { error: mgError } = await supabaseAdmin
    .from("muscle_groups")
    .upsert(muscleGroupNames.map((name) => ({ name })), { onConflict: "name" });
  if (mgError) throw new Error(`muscle_groups: ${mgError.message}`);
  console.log(`   ✅ ${muscleGroupNames.length} grupos musculares inseridos`);

  // ── 2. Exercício → exercise_catalog (com notes) ──────────────────────────
  console.log("⏳ Inserindo Exercícios...");
  const exerciseRows = Array.from(exerciseEntries.entries()).map(
    ([name, notes]) => ({
      name,
      personal_id: null,
      notes: notes || null,
    }),
  );
  const { error: ecError } = await supabaseAdmin
    .from("exercise_catalog")
    .insert(exerciseRows);
  if (ecError) throw new Error(`exercise_catalog: ${ecError.message}`);
  console.log(`   ✅ ${exerciseRows.length} exercícios inseridos`);

  // ── 3. Equipamento → equipment_catalog ───────────────────────────────────
  console.log("⏳ Inserindo Equipamentos...");
  await upsertCatalog("equipment_catalog", equipmentNames);
  console.log(`   ✅ ${equipmentNames.length} equipamentos inseridos`);

  // ── 4. Execução → exercise_variations ────────────────────────────────────
  console.log("⏳ Inserindo Execuções...");
  const { error: evError } = await supabaseAdmin
    .from("exercise_variations")
    .insert(variationNames.map((name) => ({ name, personal_id: null })));
  if (evError) throw new Error(`exercise_variations: ${evError.message}`);
  console.log(`   ✅ ${variationNames.length} execuções inseridas`);

  // ── 5. Pegada/Pisada → grip_footing_catalog ───────────────────────────────
  console.log("⏳ Inserindo Pegadas/Pisadas...");
  await upsertCatalog("grip_footing_catalog", gripNames);
  console.log(`   ✅ ${gripNames.length} pegadas/pisadas inseridas`);

  // ── 6. Método → method_catalog ────────────────────────────────────────────
  console.log("⏳ Inserindo Métodos...");
  await upsertCatalog("method_catalog", methodNames);
  console.log(`   ✅ ${methodNames.length} métodos inseridos`);

  console.log("\n🎉 Seed concluído com sucesso!");
}

seedExercises().catch((error) => {
  console.error("\n❌ Falha no seed:", error?.message || error);
  process.exit(1);
});
