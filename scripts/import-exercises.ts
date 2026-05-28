import XLSX from "xlsx";
import { supabaseAdmin } from "../src/config/supabase.js";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function importExercises() {
  try {
    console.log("📖 Lendo arquivo Excel...\n");

    // Ler o arquivo Excel
    const filePath = join(
      __dirname,
      "..",
      "Tabela Completa de Exercícios de Academia.xlsx",
    );
    const workbook = XLSX.readFile(filePath);

    // Pegar a primeira planilha
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];

    // Converter para JSON
    const data = XLSX.utils.sheet_to_json(worksheet);

    console.log(`✅ ${data.length} exercícios encontrados no Excel\n`);

    console.log("📝 Importando exercícios para biblioteca compartilhada\n");

    // Processar e inserir exercícios
    const exercises = data
      .map((row: any) => {
        // Mapear colunas do Excel para campos do banco
        // Ajuste os nomes das colunas conforme estão no seu Excel
        const name =
          row["Nome"] || row["Exercício"] || row["nome"] || row["exercicio"];
        const muscleGroup =
          row["Grupo Muscular"] || row["Músculo"] || row["muscle_group"];
        const equipment =
          row["Equipamento"] || row["Equipamentos"] || row["equipment"];
        const description =
          row["Descrição"] || row["Execução"] || row["description"];
        const tagsRaw = row["Tags"] || row["tags"] || "";

        // Processar tags
        let tags = null;
        if (tagsRaw) {
          tags =
            typeof tagsRaw === "string"
              ? tagsRaw
                  .split(",")
                  .map((t: string) => t.trim())
                  .filter((t: string) => t.length > 0)
              : [];
        }

        return {
          personal_id: null,
          name: name || "Exercício sem nome",
          muscle_group: muscleGroup || null,
          equipment: equipment || null,
          tags: tags,
          description: description || null,
        };
      })
      .filter((ex) => ex.name !== "Exercício sem nome"); // Remover exercícios sem nome

    console.log(`🔄 Inserindo ${exercises.length} exercícios no banco...\n`);

    // Inserir em lotes de 100
    const batchSize = 100;
    let inserted = 0;
    let errors = 0;

    for (let i = 0; i < exercises.length; i += batchSize) {
      const batch = exercises.slice(i, i + batchSize);

      const { data, error } = await supabaseAdmin
        .from("exercises")
        .insert(batch)
        .select("id");

      if (error) {
        console.error(
          `❌ Erro no lote ${Math.floor(i / batchSize) + 1}:`,
          error.message,
        );
        errors += batch.length;
      } else {
        inserted += data?.length || 0;
        console.log(
          `✅ Lote ${Math.floor(i / batchSize) + 1}: ${data?.length} exercícios inseridos`,
        );
      }
    }

    console.log("\n" + "=".repeat(60));
    console.log(`✨ Importação concluída!`);
    console.log(`   ✅ Inseridos: ${inserted}`);
    console.log(`   ❌ Erros: ${errors}`);
    console.log("=".repeat(60));

    // Mostrar exemplos
    const { data: sample } = await supabaseAdmin
      .from("exercises")
      .select("name, muscle_group, equipment, tags")
      .limit(5);

    console.log("\n📋 Exemplos de exercícios importados:");
    sample?.forEach((ex, idx) => {
      console.log(`\n${idx + 1}. ${ex.name}`);
      console.log(`   Grupo: ${ex.muscle_group || "-"}`);
      console.log(`   Equipamento: ${ex.equipment || "-"}`);
      console.log(`   Tags: ${ex.tags?.join(", ") || "-"}`);
    });
  } catch (error: any) {
    console.error("\n❌ Erro durante importação:", error.message);

    if (error.code === "ENOENT") {
      console.log("\n📋 INSTRUÇÕES:");
      console.log("   1. Coloque o arquivo Excel na raiz do projeto");
      console.log(
        "   2. Renomeie para: 'Tabela Completa de Exercícios de Academia.xlsx'",
      );
      console.log(
        "   3. Execute novamente: npx tsx scripts/import-exercises.ts",
      );
    }
  }
}

importExercises();
