import pg from "pg";
import { env } from "../src/config/env.js";

const { Client } = pg;

async function runMigrations() {
  // Connection string do Supabase
  const connectionString = `postgresql://postgres.ofergzualxqqovktyxwu:${env.SUPABASE_SERVICE_KEY}@aws-0-us-east-1.pooler.supabase.com:6543/postgres`;

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  try {
    console.log("🔌 Conectando ao PostgreSQL...");
    await client.connect();
    console.log("✅ Conectado ao Supabase!\n");

    const migrations = [
      {
        name: "Adicionar start_date em workouts",
        sql: "ALTER TABLE public.workouts ADD COLUMN IF NOT EXISTS start_date date NOT NULL DEFAULT current_date;",
      },
      {
        name: "Adicionar valid_until em workouts",
        sql: "ALTER TABLE public.workouts ADD COLUMN IF NOT EXISTS valid_until date;",
      },
      {
        name: "Adicionar muscle_group em exercises",
        sql: "ALTER TABLE public.exercises ADD COLUMN IF NOT EXISTS muscle_group text;",
      },
    ];

    for (const migration of migrations) {
      console.log(`📝 ${migration.name}...`);
      try {
        await client.query(migration.sql);
        console.log(`✅ ${migration.name} - OK\n`);
      } catch (error: any) {
        if (error.message.includes("already exists")) {
          console.log(`ℹ️  Coluna já existe - OK\n`);
        } else {
          console.log(`❌ Erro: ${error.message}\n`);
        }
      }
    }

    // Verificar as colunas
    console.log("🔍 Verificando estrutura final...\n");

    const checkWorkouts = await client.query(`
      SELECT column_name, data_type, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' 
        AND table_name = 'workouts'
        AND column_name IN ('start_date', 'valid_until')
      ORDER BY column_name;
    `);

    console.log("📋 Colunas em workouts:");
    checkWorkouts.rows.forEach((row) => {
      console.log(
        `   - ${row.column_name}: ${row.data_type} ${row.column_default ? `(default: ${row.column_default})` : ""}`,
      );
    });

    const checkExercises = await client.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public' 
        AND table_name = 'exercises'
        AND column_name = 'muscle_group';
    `);

    console.log("\n📋 Colunas em exercises:");
    checkExercises.rows.forEach((row) => {
      console.log(`   - ${row.column_name}: ${row.data_type}`);
    });

    console.log("\n✨ Migrations executadas com sucesso!");
  } catch (error: any) {
    console.error("\n❌ Erro:", error.message);
    throw error;
  } finally {
    await client.end();
    console.log("\n🔌 Conexão encerrada.");
  }
}

runMigrations().catch((error) => {
  console.error("Erro fatal:", error);
  process.exit(1);
});
