import { supabaseAdmin } from "../src/config/supabase.js";

async function checkAndFixData() {
  try {
    console.log("🔍 Verificando dados no banco...\n");

    // 1. Verificar personals
    const { data: personals, error: personalError } = await supabaseAdmin
      .from("personals")
      .select("*");

    if (personalError) {
      console.error("❌ Erro ao buscar personals:", personalError.message);
      return;
    }

    console.log("👥 Personals cadastrados:");
    personals?.forEach((p) => {
      console.log(`   ID: ${p.id}`);
      console.log(`   Email: ${p.email}`);
      console.log(`   Nome: ${p.name}\n`);
    });

    // 2. Verificar usuários do Supabase Auth
    const { data: authUsers, error: authError } =
      await supabaseAdmin.auth.admin.listUsers();

    if (authError) {
      console.error("❌ Erro ao buscar usuários Auth:", authError.message);
    } else {
      console.log("🔐 Usuários Supabase Auth:");
      authUsers?.users?.forEach((u) => {
        console.log(`   ID: ${u.id}`);
        console.log(`   Email: ${u.email}\n`);
      });
    }

    // 3. Verificar exercícios
    const { data: exercises, error: exError } = await supabaseAdmin
      .from("exercises")
      .select("id, personal_id, name")
      .limit(5);

    if (exError) {
      console.error("❌ Erro ao buscar exercícios:", exError.message);
    } else {
      console.log(`💪 Exercícios no banco: ${exercises?.length || 0}`);
      exercises?.forEach((ex) => {
        console.log(`   ${ex.name} (personal_id: ${ex.personal_id})`);
      });
    }

    // 4. Verificar students
    const { data: students, error: studError } = await supabaseAdmin
      .from("students")
      .select("id, personal_id, name");

    if (studError) {
      console.error("❌ Erro ao buscar students:", studError.message);
    } else {
      console.log(`\n👨‍🎓 Alunos no banco: ${students?.length || 0}`);
      students?.forEach((s) => {
        console.log(`   ${s.name} (personal_id: ${s.personal_id})`);
      });
    }

    console.log("\n" + "=".repeat(70));
    console.log("🔧 DIAGNÓSTICO:");
    console.log("=".repeat(70));

    // Verificar se os IDs coincidem
    const personalIds = new Set(personals?.map((p) => p.id) || []);
    const authIds = new Set(authUsers?.users?.map((u) => u.id) || []);

    const matching = [...personalIds].filter((id) => authIds.has(id));
    const onlyInPersonals = [...personalIds].filter((id) => !authIds.has(id));
    const onlyInAuth = [...authIds].filter((id) => !personalIds.has(id));

    console.log(
      `\n✅ IDs que coincidem (Auth ↔ Personals): ${matching.length}`,
    );
    if (matching.length > 0) {
      console.log(`   IDs: ${matching.join(", ")}`);
    }

    console.log(
      `\n⚠️  IDs apenas em Personals (sem Auth): ${onlyInPersonals.length}`,
    );
    if (onlyInPersonals.length > 0) {
      console.log(`   IDs: ${onlyInPersonals.join(", ")}`);
      console.log(
        "   PROBLEMA: Estes registros não podem ser acessados via RLS!",
      );
    }

    console.log(
      `\n⚠️  IDs apenas em Auth (sem Personal): ${onlyInAuth.length}`,
    );
    if (onlyInAuth.length > 0) {
      console.log(`   IDs: ${onlyInAuth.join(", ")}`);
      console.log("   PROBLEMA: Estes usuários não têm perfil de personal!");
    }

    // Solução
    if (onlyInPersonals.length > 0 && exercises && exercises.length > 0) {
      console.log("\n" + "=".repeat(70));
      console.log("💡 SOLUÇÃO:");
      console.log("=".repeat(70));
      console.log(
        "\nOs exercícios foram criados para personal_id que não existe em Auth.",
      );
      console.log(
        "Vou atualizar os exercícios para o personal_id correto...\n",
      );

      if (matching.length > 0) {
        const correctPersonalId = matching[0];
        const wrongPersonalId = onlyInPersonals[0];

        console.log(
          `📝 Atualizando exercícios de ${wrongPersonalId} para ${correctPersonalId}...`,
        );

        const { error: updateError } = await supabaseAdmin
          .from("exercises")
          .update({ personal_id: correctPersonalId })
          .eq("personal_id", wrongPersonalId);

        if (updateError) {
          console.error("❌ Erro ao atualizar:", updateError.message);
        } else {
          console.log("✅ Exercícios atualizados com sucesso!");
        }

        // Atualizar students também
        const { error: updateStudError } = await supabaseAdmin
          .from("students")
          .update({ personal_id: correctPersonalId })
          .eq("personal_id", wrongPersonalId);

        if (!updateStudError) {
          console.log("✅ Alunos atualizados com sucesso!");
        }

        // Deletar personal órfão
        const { error: deleteError } = await supabaseAdmin
          .from("personals")
          .delete()
          .eq("id", wrongPersonalId);

        if (!deleteError) {
          console.log("✅ Personal órfão removido!");
        }
      }
    }
  } catch (error: any) {
    console.error("\n❌ Erro:", error.message);
  }
}

checkAndFixData();
