import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
);

async function resetPassword() {
  const email = "personal.teste@repzfit.com";
  const newPassword = "123456";

  console.log(`🔐 Resetando senha do usuário: ${email}`);

  // Buscar o usuário
  const { data: users, error: listError } =
    await supabase.auth.admin.listUsers();

  if (listError) {
    console.error("❌ Erro ao listar usuários:", listError.message);
    return;
  }

  const user = users.users.find((u) => u.email === email);

  if (!user) {
    console.error("❌ Usuário não encontrado");
    return;
  }

  // Atualizar senha
  const { data, error } = await supabase.auth.admin.updateUserById(user.id, {
    password: newPassword,
  });

  if (error) {
    console.error("❌ Erro ao resetar senha:", error.message);
  } else {
    console.log("✅ Senha resetada com sucesso!");
    console.log(`\n📋 Credenciais de acesso:`);
    console.log(`   Email: ${email}`);
    console.log(`   Senha: ${newPassword}`);
    console.log(`\n🌐 Acesse: https://project-pxgam.vercel.app/`);
  }
}

resetPassword().catch(console.error);
