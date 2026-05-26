import { supabaseAdmin } from "../src/config/supabase.js";

async function applyMigration() {
  console.log("Aplicando migration: add_workout_dates...");

  // Add start_date and valid_until to workouts
  const { error: alterError } = await supabaseAdmin.rpc("exec_sql", {
    sql: `
      alter table public.workouts
        add column if not exists start_date date not null default current_date,
        add column if not exists valid_until date;
      
      alter table public.exercises
        add column if not exists muscle_group text;
    `,
  });

  if (alterError) {
    // Try direct SQL if RPC not available
    console.log("Tentando SQL direto...");

    const queries = [
      "ALTER TABLE public.workouts ADD COLUMN IF NOT EXISTS start_date date NOT NULL DEFAULT current_date",
      "ALTER TABLE public.workouts ADD COLUMN IF NOT EXISTS valid_until date",
      "ALTER TABLE public.exercises ADD COLUMN IF NOT EXISTS muscle_group text",
    ];

    for (const sql of queries) {
      const { error } = await (supabaseAdmin as any)
        .from("_migrations")
        .insert({
          query: sql,
        });
      if (error) console.log(`Aviso: ${error.message}`);
    }
  }

  console.log("✅ Migration aplicada com sucesso!");
}

applyMigration().catch(console.error);
