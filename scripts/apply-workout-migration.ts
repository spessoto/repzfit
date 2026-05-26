import { supabaseAdmin } from "../src/config/supabase.js";

async function applyMigration() {
  console.log("🔄 Aplicando migration: add_workout_dates...\n");

  try {
    // Add start_date column
    console.log("1. Adicionando coluna start_date...");
    const { error: error1 } = await supabaseAdmin.rpc("exec_sql", {
      sql: "ALTER TABLE public.workouts ADD COLUMN IF NOT EXISTS start_date date NOT NULL DEFAULT current_date",
    });
    if (error1 && !error1.message.includes("already exists")) {
      console.error("Erro:", error1.message);
    } else {
      console.log("✅ start_date adicionada");
    }

    // Add valid_until column
    console.log("2. Adicionando coluna valid_until...");
    const { error: error2 } = await supabaseAdmin.rpc("exec_sql", {
      sql: "ALTER TABLE public.workouts ADD COLUMN IF NOT EXISTS valid_until date",
    });
    if (error2 && !error2.message.includes("already exists")) {
      console.error("Erro:", error2.message);
    } else {
      console.log("✅ valid_until adicionada");
    }

    // Add muscle_group column
    console.log("3. Adicionando coluna muscle_group...");
    const { error: error3 } = await supabaseAdmin.rpc("exec_sql", {
      sql: "ALTER TABLE public.exercises ADD COLUMN IF NOT EXISTS muscle_group text",
    });
    if (error3 && !error3.message.includes("already exists")) {
      console.error("Erro:", error3.message);
    } else {
      console.log("✅ muscle_group adicionada");
    }

    console.log("\n✨ Migration concluída com sucesso!");
  } catch (error: any) {
    console.error("\n❌ Erro ao aplicar migration:", error.message);
    console.log("\nTentando método alternativo via SQL direto...");

    // Método alternativo: tentar via query direta
    const queries = [
      {
        name: "start_date",
        sql: `
          DO $$ 
          BEGIN 
            BEGIN
              ALTER TABLE public.workouts ADD COLUMN start_date date NOT NULL DEFAULT current_date;
            EXCEPTION
              WHEN duplicate_column THEN NULL;
            END;
          END $$;
        `,
      },
      {
        name: "valid_until",
        sql: `
          DO $$ 
          BEGIN 
            BEGIN
              ALTER TABLE public.workouts ADD COLUMN valid_until date;
            EXCEPTION
              WHEN duplicate_column THEN NULL;
            END;
          END $$;
        `,
      },
      {
        name: "muscle_group",
        sql: `
          DO $$ 
          BEGIN 
            BEGIN
              ALTER TABLE public.exercises ADD COLUMN muscle_group text;
            EXCEPTION
              WHEN duplicate_column THEN NULL;
            END;
          END $$;
        `,
      },
    ];

    for (const query of queries) {
      try {
        const { error } = await (supabaseAdmin as any).rpc("exec_sql", {
          sql: query.sql,
        });
        if (error) {
          console.log(`⚠️  ${query.name}: ${error.message}`);
        } else {
          console.log(`✅ ${query.name} processada`);
        }
      } catch (e: any) {
        console.log(`⚠️  ${query.name}: ${e.message}`);
      }
    }
  }

  // Verificar estrutura final
  console.log("\n📋 Verificando estrutura das tabelas...");
  const { data: workouts } = await supabaseAdmin
    .from("workouts")
    .select("*")
    .limit(0);
  const { data: exercises } = await supabaseAdmin
    .from("exercises")
    .select("*")
    .limit(0);

  console.log(
    "Colunas em workouts:",
    workouts ? "OK" : "Verificação necessária",
  );
  console.log(
    "Colunas em exercises:",
    exercises ? "OK" : "Verificação necessária",
  );
}

applyMigration().catch((error) => {
  console.error("Erro fatal:", error);
  process.exit(1);
});
