import XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

// Carregar variáveis de ambiente
config();

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function importExercises() {
  try {
    console.log("📖 Lendo arquivo Excel...");

    // Caminho do arquivo - ajuste conforme necessário
    const filePath =
      process.argv[2] || "Tabela Completa de Exercícios de Academia.xlsx";

    console.log(`📁 Procurando arquivo em: ${filePath}`);

    // Ler o arquivo Excel
    const workbook = XLSX.readFile(filePath);

    // Pegar a primeira planilha
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];

    // Converter para JSON
    const data = XLSX.utils.sheet_to_json(worksheet);

    console.log(`📊 Encontrados ${data.length} exercícios no arquivo`);
    console.log("📝 Primeiras 3 linhas:");
    console.log(JSON.stringify(data.slice(0, 3), null, 2));

    // Descobrir os nomes das colunas
    if (data.length > 0) {
      console.log("\n📋 Colunas disponíveis:");
      console.log(Object.keys(data[0]));
    }

    // Agora vamos processar os dados
    // Primeiro, vou buscar o ID do personal (assumindo que existe apenas 1)
    const { data: personals, error: personalError } = await supabase
      .from("personals")
      .select("id");

    if (personalError) {
      console.error("❌ Erro ao buscar personal:", personalError);
      throw new Error(`Erro ao buscar personal: ${personalError.message}`);
    }

    if (!personals || personals.length === 0) {
      console.log(
        "⚠️  Nenhum personal encontrado. Criando um personal padrão...",
      );

      const { data: newPersonal, error: createError } = await supabase
        .from("personals")
        .insert({
          name: "Admin",
          email: "admin@repzfit.com",
        })
        .select()
        .single();

      if (createError || !newPersonal) {
        throw new Error("Não foi possível criar personal padrão");
      }

      const personalId = newPersonal.id;
      console.log(`👤 Personal criado com ID: ${personalId}`);
    } else {
      const personalId = personals[0].id;
      console.log(`👤 Personal ID: ${personalId}`);
    }

    const personalId =
      personals && personals.length > 0 ? personals[0].id : null;

    if (!personalId) {
      throw new Error("Não foi possível obter ID do personal");
    }

    // Mapear os dados do Excel para o formato esperado
    const exercises = (data as any[])
      .filter((row) => row["Nome"] && row["Nome"].toString().trim().length > 0)
      .map((row) => {
        const name = row["Nome"] || "";
        const muscleGroup = row["Grupo muscular"] || "";
        const equipment = row["Equipamento"] || "";
        const description = row["Descrição de execução"] || "";
        const tags = row["Tags (separadas por ;)"] || "";

        // Converter tags de string para array
        let tagsArray: string[] = [];
        if (tags && typeof tags === "string") {
          tagsArray = tags
            .split(";")
            .map((t) => t.trim())
            .filter((t) => t.length > 0);
        }

        return {
          personal_id: personalId,
          name: name.toString().trim(),
          muscle_group: muscleGroup.toString().trim(),
          equipment: equipment.toString().trim(),
          description: description.toString().trim(),
          tags: tagsArray,
        };
      });

    console.log(`\n✅ Preparados ${exercises.length} exercícios para inserção`);
    console.log("📝 Exemplo do primeiro exercício formatado:");
    console.log(JSON.stringify(exercises[0], null, 2));

    console.log("\n🗑️  Deletando exercícios antigos...");
    const { error: deleteError } = await supabase
      .from("exercises")
      .delete()
      .eq("personal_id", personalId);

    if (deleteError) {
      console.error("❌ Erro ao deletar exercícios antigos:", deleteError);
    } else {
      console.log("✅ Exercícios antigos deletados");
    }

    console.log("\n📤 Iniciando inserção de exercícios...");

    // Inserir exercícios em lotes de 100
    const batchSize = 100;
    let inserted = 0;

    for (let i = 0; i < exercises.length; i += batchSize) {
      const batch = exercises.slice(i, i + batchSize);

      const { data: insertedData, error: insertError } = await supabase
        .from("exercises")
        .insert(batch)
        .select();

      if (insertError) {
        console.error(
          `❌ Erro ao inserir lote ${i / batchSize + 1}:`,
          insertError,
        );
      } else {
        inserted += insertedData?.length || 0;
        console.log(
          `✅ Lote ${i / batchSize + 1} inserido (${insertedData?.length} exercícios)`,
        );
      }
    }

    console.log(`\n🎉 Total de ${inserted} exercícios inseridos com sucesso!`);
  } catch (error) {
    console.error("❌ Erro:", error);
    throw error;
  }
}

importExercises();
