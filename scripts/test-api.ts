import "dotenv/config";

const TOKEN =
  "eyJhbGciOiJFUzI1NiIsImtpZCI6ImExNGYxMTY0LTVmYjktNDE4MC05NzRlLWU4NzEzOTIwYTBjNiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJodHRwczovL29mZXJnenVhbHhxcW92a3R5eHd1LnN1cGFiYXNlLmNvL2F1dGgvdjEiLCJzdWIiOiI1MTM5NDhhOC1jOTAxLTRkNzctYjk3MC05MDA5MjE2YTYwMTgiLCJhdWQiOiJhdXRoZW50aWNhdGVkIiwiZXhwIjoxNzc5ODEzMzMwLCJpYXQiOjE3Nzk4MDk3MzAsImVtYWlsIjoicGVyc29uYWwudGVzdGVAcmVwemZpdC5jb20iLCJwaG9uZSI6IiIsImFwcF9tZXRhZGF0YSI6eyJwcm92aWRlciI6ImVtYWlsIiwicHJvdmlkZXJzIjpbImVtYWlsIl19LCJ1c2VyX21ldGFkYXRhIjp7ImVtYWlsX3ZlcmlmaWVkIjp0cnVlfSwicm9sZSI6ImF1dGhlbnRpY2F0ZWQiLCJhYWwiOiJhYWwxIiwiYW1yIjpbeyJtZXRob2QiOiJwYXNzd29yZCIsInRpbWVzdGFtcCI6MTc3OTgwOTczMH1dLCJzZXNzaW9uX2lkIjoiYzJiMTE0NjktZTFiZS00YzVjLWFmMGItZDI1NmE3MzY5YmMxIiwiaXNfYW5vbnltb3VzIjpmYWxzZX0.QGRAx5HD17ZUz3w3SAwiJsz_E7-J5rI8QytP1R1THFMUSLw14m137tjKbeJopMv4JsgJV80wklUBDnzcpsQt1Q";

const BASE = "http://localhost:3333/api";

async function testAPI() {
  const headers = {
    Authorization: `Bearer ${TOKEN}`,
    "Content-Type": "application/json",
  };

  console.log("=== Testing API Endpoints ===\n");

  // Test 1: Create Exercise
  console.log("1. Creating exercise...");
  const exercise = await fetch(`${BASE}/exercises`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: "Supino Reto",
      description: "Exercício para peitoral",
      muscle_group: "Peito",
    }),
  });
  const exerciseData = await exercise.json();
  console.log("✅ Exercise created:", exerciseData);

  // Test 2: List Exercises
  console.log("\n2. Listing exercises...");
  const listExercises = await fetch(`${BASE}/exercises`, { headers });
  const exercisesList = await listExercises.json();
  console.log("✅ Exercises:", exercisesList);

  // Test 3: Create Workout
  console.log("\n3. Creating workout...");
  const students = await (await fetch(`${BASE}/students`, { headers })).json();
  const studentId = students[0]?.id;

  if (studentId) {
    const workout = await fetch(`${BASE}/workouts`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "Treino A",
        student_id: studentId,
        start_date: "2026-05-26",
      }),
    });
    const workoutData = await workout.json();
    console.log("✅ Workout created:", workoutData);

    // Test 4: Add Exercise to Workout
    if (workoutData.id && exerciseData.id) {
      console.log("\n4. Adding exercise to workout...");
      const addExercise = await fetch(
        `${BASE}/workouts/${workoutData.id}/exercises`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            exercise_id: exerciseData.id,
            target_sets: 3,
            target_reps: 10,
            target_weight: 60,
            order_index: 0,
          }),
        },
      );
      const addExerciseData = await addExercise.json();
      console.log("✅ Exercise added to workout:", addExerciseData);
    }
  }

  console.log("\n=== All Tests Completed ===");
}

testAPI().catch(console.error);
