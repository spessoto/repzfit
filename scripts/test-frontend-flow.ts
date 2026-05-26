import fetch from "node-fetch";

async function testFrontendFlow() {
  console.log("🧪 Simulando fluxo do frontend...\n");

  // 1. Login
  console.log("1️⃣ Login...");
  const loginResponse = await fetch(
    "https://ofergzualxqqovktyxwu.supabase.co/auth/v1/token?grant_type=password",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey:
          "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9mZXJnenVhbHhxcW92a3R5eHd1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3ODg1OTksImV4cCI6MjA5NTM2NDU5OX0.6MSmrE1CgGSM0c07vZ7UA3zYwYy9EzlSpPTovaIuy4o",
      },
      body: JSON.stringify({
        email: "personal.teste@repzfit.com",
        password: "SenhaForte123!",
      }),
    },
  );

  const loginData = await loginResponse.json();

  if (!loginData.access_token) {
    console.error("❌ Falha no login:", loginData);
    return;
  }

  console.log("✅ Login OK");
  const token = loginData.access_token;

  // 2. Testar endpoint local
  console.log("\n2️⃣ Testando endpoint local (localhost:3333)...");
  try {
    const localStudents = await fetch("http://localhost:3333/api/students", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const localStudentsData = await localStudents.json();
    console.log(`✅ Alunos (local): ${localStudentsData.length}`);

    const localExercises = await fetch("http://localhost:3333/api/exercises", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const localExercisesData = await localExercises.json();
    console.log(`✅ Exercícios (local): ${localExercisesData.length}`);
  } catch (error) {
    console.log("⚠️  Servidor local não está rodando");
  }

  // 3. Testar endpoint de produção
  console.log("\n3️⃣ Testando endpoint de produção (Vercel)...");
  try {
    const prodStudents = await fetch(
      "https://project-pxgam.vercel.app/api/students",
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );

    if (!prodStudents.ok) {
      console.error(
        `❌ Erro ${prodStudents.status}: ${prodStudents.statusText}`,
      );
      const errorText = await prodStudents.text();
      console.log("Resposta:", errorText);
    } else {
      const prodStudentsData = await prodStudents.json();
      console.log(`✅ Alunos (prod): ${prodStudentsData.length}`);
      prodStudentsData.forEach((s) => {
        console.log(`   - ${s.name}`);
      });
    }

    const prodExercises = await fetch(
      "https://project-pxgam.vercel.app/api/exercises",
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );

    if (!prodExercises.ok) {
      console.error(
        `❌ Erro ${prodExercises.status}: ${prodExercises.statusText}`,
      );
      const errorText = await prodExercises.text();
      console.log("Resposta:", errorText);
    } else {
      const prodExercisesData = await prodExercises.json();
      console.log(`✅ Exercícios (prod): ${prodExercisesData.length}`);
      console.log(`   Primeiros 5:`);
      prodExercisesData.slice(0, 5).forEach((e) => {
        console.log(`   - ${e.name} (${e.muscle_group || "sem grupo"})`);
      });
    }
  } catch (error) {
    console.error("❌ Erro ao acessar produção:", error.message);
  }

  console.log("\n" + "=".repeat(60));
  console.log("✨ Teste concluído!");
  console.log("=".repeat(60));
}

testFrontendFlow();
