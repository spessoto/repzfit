import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkWorkoutDetails() {
  const { data: workout } = await supabase
    .from("workouts")
    .select("*")
    .eq("id", "18eb7956-01a3-4b7e-8a6d-c6fa5f806d02")
    .single();

  console.log("📋 Dados do treino:");
  console.log(JSON.stringify(workout, null, 2));

  const { data: exercises } = await supabase
    .from("workout_exercises")
    .select("*")
    .eq("workout_id", "18eb7956-01a3-4b7e-8a6d-c6fa5f806d02");

  console.log("\n📋 Exercícios do treino:");
  console.log(JSON.stringify(exercises, null, 2));
}

checkWorkoutDetails();
