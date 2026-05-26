import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

async function createTestPersonal() {
  const email = "personal.teste@repzfit.com";
  const password = "SenhaForte123!";

  console.log("Signing in with existing user...");

  const { data: signInData, error: signInError } =
    await supabase.auth.signInWithPassword({
      email,
      password,
    });

  if (signInError) {
    console.error("Error signing in:", signInError);
    console.log(
      "\nIf user doesn't exist, create it manually in Supabase dashboard.",
    );
    return;
  }

  const userId = signInData.user.id;

  console.log("✅ Signed in successfully");
  console.log("User ID:", userId);

  // Check if personal record already exists
  const { data: existingPersonal } = await supabase
    .from("personals")
    .select("*")
    .eq("id", userId)
    .single();

  if (existingPersonal) {
    console.log("✅ Personal record already exists");
  } else {
    console.log("Creating personal record...");

    const { data: personalData, error: personalError } = await supabase
      .from("personals")
      .insert({
        id: userId,
        name: "Personal Teste",
        email: email,
        evolution_instance_name: "personal-teste",
      })
      .select()
      .single();

    if (personalError) {
      console.error("Error creating personal record:", personalError);
      return;
    }

    console.log("✅ Personal record created:", personalData.id);
  }

  console.log("\n📋 Test Credentials:");
  console.log("Email:", email);
  console.log("Password:", password);
  console.log("User ID:", userId);
  console.log("Evolution Instance: personal-teste");
  console.log("\n🔑 Authorization Header:");
  console.log(`Authorization: Bearer ${signInData.session.access_token}`);
  console.log("\n✨ Access Token:");
  console.log(signInData.session.access_token);
}

createTestPersonal().catch(console.error);
