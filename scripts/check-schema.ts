import { supabaseAdmin } from "../src/config/supabase.js";

async function testAndAddColumns() {
  console.log("🔍 Testando estrutura atual das tabelas...\n");

  // Test workouts table
  try {
    const { data, error } = await supabaseAdmin
      .from("workouts")
      .select(
        "id, student_id, name, start_date, valid_until, day_of_week, created_at",
      )
      .limit(1);

    if (error && error.message.includes("start_date")) {
      console.log("❌ Coluna start_date não existe em workouts");
      console.log(
        "   Você precisa adicionar manualmente no Supabase Dashboard:",
      );
      console.log(
        "   ALTER TABLE public.workouts ADD COLUMN start_date date NOT NULL DEFAULT current_date;",
      );
    } else {
      console.log("✅ Coluna start_date existe em workouts");
    }

    if (error && error.message.includes("valid_until")) {
      console.log("❌ Coluna valid_until não existe em workouts");
      console.log(
        "   Você precisa adicionar manualmente no Supabase Dashboard:",
      );
      console.log(
        "   ALTER TABLE public.workouts ADD COLUMN valid_until date;",
      );
    } else {
      console.log("✅ Coluna valid_until existe em workouts");
    }

    if (!error) {
      console.log("✅ Tabela workouts está completa!");
      console.log("   Colunas encontradas:", Object.keys(data?.[0] || {}));
    }
  } catch (e: any) {
    console.log("⚠️  Erro ao testar workouts:", e.message);
  }

  // Test exercises table
  console.log("");
  try {
    const { data, error } = await supabaseAdmin
      .from("exercises")
      .select("id, personal_id, name, description, muscle_group, created_at")
      .limit(1);

    if (error && error.message.includes("muscle_group")) {
      console.log("❌ Coluna muscle_group não existe em exercises");
      console.log(
        "   Você precisa adicionar manualmente no Supabase Dashboard:",
      );
      console.log(
        "   ALTER TABLE public.exercises ADD COLUMN muscle_group text;",
      );
    } else {
      console.log("✅ Coluna muscle_group existe em exercises");
    }

    if (!error) {
      console.log("✅ Tabela exercises está completa!");
      console.log("   Colunas encontradas:", Object.keys(data?.[0] || {}));
    }
  } catch (e: any) {
    console.log("⚠️  Erro ao testar exercises:", e.message);
  }

  console.log("\n📝 SQL para executar no Supabase SQL Editor:");
  console.log("=".repeat(60));
  console.log(`
-- Adicionar colunas em workouts
ALTER TABLE public.workouts 
  ADD COLUMN IF NOT EXISTS start_date date NOT NULL DEFAULT current_date,
  ADD COLUMN IF NOT EXISTS valid_until date;

-- Adicionar coluna em exercises  
ALTER TABLE public.exercises 
  ADD COLUMN IF NOT EXISTS muscle_group text;

-- Verificar
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'workouts' 
  AND column_name IN ('start_date', 'valid_until');

SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'exercises' 
  AND column_name = 'muscle_group';
`);
  console.log("=".repeat(60));
}

testAndAddColumns().catch(console.error);
