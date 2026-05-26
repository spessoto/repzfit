import { supabaseAdmin } from "../src/config/supabase.js";
import { createClient } from "@supabase/supabase-js";
import { env } from "../src/config/env.js";

async function testQueries() {
  console.log("🧪 Testando queries com RLS...\n");

  // 1. Login como personal.teste@repzfit.com
  console.log("1️⃣ Fazendo login...");
  const authClient = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);

  const { data: authData, error: authError } =
    await authClient.auth.signInWithPassword({
      email: "personal.teste@repzfit.com",
      password: "SenhaForte123!",
    });

  if (authError) {
    console.error("❌ Erro no login:", authError.message);
    return;
  }

  console.log("✅ Login bem-sucedido!");
  console.log(
    `   Token: ${authData.session?.access_token?.substring(0, 20)}...`,
  );
  console.log(`   User ID: ${authData.user?.id}\n`);

  // 2. Criar cliente com token de usuário (simula RLS)
  const userClient = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    global: {
      headers: {
        Authorization: `Bearer ${authData.session?.access_token}`,
      },
    },
  });

  // 3. Testar query de alunos
  console.log("2️⃣ Buscando alunos (com RLS)...");
  const { data: students, error: studentsError } = await userClient
    .from("students")
    .select("*");

  if (studentsError) {
    console.error("❌ Erro ao buscar alunos:", studentsError.message);
  } else {
    console.log(`✅ ${students?.length || 0} alunos encontrados:`);
    students?.forEach((s) => {
      console.log(`   - ${s.name} (${s.whatsapp_number})`);
    });
  }

  // 4. Testar query de exercícios
  console.log("\n3️⃣ Buscando exercícios (com RLS)...");
  const { data: exercises, error: exercisesError } = await userClient
    .from("exercises")
    .select("id,name,muscle_group,equipment,tags,description")
    .order("created_at", { ascending: false });

  if (exercisesError) {
    console.error("❌ Erro ao buscar exercícios:", exercisesError.message);
  } else {
    console.log(`✅ ${exercises?.length || 0} exercícios encontrados:`);
    exercises?.slice(0, 10).forEach((e) => {
      console.log(`   - ${e.name} (${e.muscle_group || "sem grupo"})`);
    });
    if (exercises && exercises.length > 10) {
      console.log(`   ... e mais ${exercises.length - 10} exercícios`);
    }
  }

  // 5. Verificar contagem total sem RLS
  console.log("\n4️⃣ Contagem total (sem RLS - admin)...");
  const { count: totalExercises } = await supabaseAdmin
    .from("exercises")
    .select("*", { count: "exact", head: true });

  const { count: totalStudents } = await supabaseAdmin
    .from("students")
    .select("*", { count: "exact", head: true });

  console.log(`   Total de exercícios (todos os personais): ${totalExercises}`);
  console.log(`   Total de alunos (todos os personais): ${totalStudents}`);

  console.log("\n" + "=".repeat(60));
  console.log("✨ Teste concluído!");
  console.log("=".repeat(60));
}

testQueries();
