import { supabaseAdmin } from "../src/config/supabase.js";

async function seedExercises() {
  try {
    console.log("🌱 Populando banco com exercícios de exemplo...\n");

    console.log("📝 Adicionando exercícios na biblioteca compartilhada\n");

    const exercises = [
      // PEITO
      {
        name: "Supino Reto com Barra",
        muscle_group: "Peito",
        equipment: "Barra, Banco",
        tags: ["composto", "hipertrofia", "força"],
        description:
          "Deitar no banco, pegar a barra com pegada média, descer controlado até o peito e empurrar de volta.",
      },
      {
        name: "Supino Inclinado com Halteres",
        muscle_group: "Peito",
        equipment: "Halteres, Banco Inclinado",
        tags: ["composto", "hipertrofia", "peitoral superior"],
        description:
          "Banco inclinado a 30-45°, halteres na linha dos ombros, empurrar para cima unindo no topo.",
      },
      {
        name: "Crucifixo Reto",
        muscle_group: "Peito",
        equipment: "Halteres, Banco",
        tags: ["isolamento", "hipertrofia", "alongamento"],
        description:
          "Deitado no banco, abrir os braços em arco com cotovelos levemente flexionados.",
      },
      {
        name: "Crossover na Polia",
        muscle_group: "Peito",
        equipment: "Polia Alta",
        tags: ["isolamento", "definição", "contração"],
        description:
          "Puxar as polias de cima para baixo cruzando na frente do corpo, contraindo o peitoral.",
      },

      // COSTAS
      {
        name: "Barra Fixa",
        muscle_group: "Costas",
        equipment: "Barra Fixa",
        tags: ["composto", "peso corporal", "largura"],
        description:
          "Segurar a barra com pegada pronada, puxar o corpo até o queixo passar a barra.",
      },
      {
        name: "Remada Curvada com Barra",
        muscle_group: "Costas",
        equipment: "Barra",
        tags: ["composto", "hipertrofia", "espessura"],
        description:
          "Inclinado a 45°, puxar a barra em direção ao abdômen, contraindo as escápulas.",
      },
      {
        name: "Pulley Frente",
        muscle_group: "Costas",
        equipment: "Polia Alta",
        tags: ["composto", "largura", "dorsais"],
        description:
          "Puxar a barra até a altura do peito, focando na contração dos dorsais.",
      },
      {
        name: "Remada Unilateral com Halter",
        muscle_group: "Costas",
        equipment: "Halter, Banco",
        tags: ["unilateral", "hipertrofia", "correção"],
        description:
          "Apoiado no banco, puxar halter em direção ao quadril, rotando o tronco minimamente.",
      },
      {
        name: "Levantamento Terra",
        muscle_group: "Costas",
        equipment: "Barra",
        tags: ["composto", "força", "completo"],
        description:
          "Levantar a barra do chão mantendo costas retas, quadril para trás, até extensão completa.",
      },

      // PERNAS
      {
        name: "Agachamento Livre",
        muscle_group: "Pernas",
        equipment: "Barra, Rack",
        tags: ["composto", "força", "completo"],
        description:
          "Barra nas costas, descer até coxas paralelas ao chão, mantendo costas retas.",
      },
      {
        name: "Leg Press 45°",
        muscle_group: "Pernas",
        equipment: "Leg Press",
        tags: ["composto", "hipertrofia", "seguro"],
        description:
          "Empurrar a plataforma com os pés na largura dos ombros, descer controlado.",
      },
      {
        name: "Cadeira Extensora",
        muscle_group: "Pernas",
        equipment: "Máquina Extensora",
        tags: ["isolamento", "quadríceps", "definição"],
        description:
          "Sentado, estender as pernas até extensão completa, contraindo quadríceps.",
      },
      {
        name: "Mesa Flexora",
        muscle_group: "Pernas",
        equipment: "Máquina Flexora",
        tags: ["isolamento", "posterior", "definição"],
        description:
          "Deitado de bruços, flexionar pernas trazendo calcanhares em direção aos glúteos.",
      },
      {
        name: "Stiff",
        muscle_group: "Pernas",
        equipment: "Barra ou Halteres",
        tags: ["posterior", "isquiotibiais", "glúteos"],
        description:
          "Pernas quase estendidas, descer o peso mantendo coluna reta, sentindo alongamento posterior.",
      },

      // OMBROS
      {
        name: "Desenvolvimento com Barra",
        muscle_group: "Ombros",
        equipment: "Barra",
        tags: ["composto", "força", "deltoide"],
        description:
          "Empurrar barra acima da cabeça até extensão completa dos braços.",
      },
      {
        name: "Elevação Lateral com Halteres",
        muscle_group: "Ombros",
        equipment: "Halteres",
        tags: ["isolamento", "deltoide médio", "definição"],
        description:
          "Elevar halteres lateralmente até altura dos ombros, cotovelos levemente flexionados.",
      },
      {
        name: "Elevação Frontal",
        muscle_group: "Ombros",
        equipment: "Halteres ou Barra",
        tags: ["isolamento", "deltoide anterior"],
        description: "Elevar peso à frente do corpo até altura dos olhos.",
      },
      {
        name: "Crucifixo Inverso",
        muscle_group: "Ombros",
        equipment: "Halteres",
        tags: ["isolamento", "deltoide posterior"],
        description:
          "Inclinado à frente, abrir halteres lateralmente focando na parte posterior dos ombros.",
      },

      // BRAÇOS - BÍCEPS
      {
        name: "Rosca Direta com Barra",
        muscle_group: "Bíceps",
        equipment: "Barra",
        tags: ["isolamento", "hipertrofia", "massa"],
        description:
          "Flexionar cotovelos trazendo barra em direção aos ombros, sem balançar o corpo.",
      },
      {
        name: "Rosca Alternada com Halteres",
        muscle_group: "Bíceps",
        equipment: "Halteres",
        tags: ["isolamento", "alternado", "controle"],
        description:
          "Alternar flexão de cada braço, girando levemente o punho no topo.",
      },
      {
        name: "Rosca Martelo",
        muscle_group: "Bíceps",
        equipment: "Halteres",
        tags: ["isolamento", "braquial", "antebraço"],
        description:
          "Flexionar com pegada neutra (palmas voltadas para o corpo).",
      },
      {
        name: "Rosca Scott",
        muscle_group: "Bíceps",
        equipment: "Barra W, Banco Scott",
        tags: ["isolamento", "concentração", "pico"],
        description:
          "Braços apoiados no banco, flexionar sem tirar cotovelos do apoio.",
      },

      // BRAÇOS - TRÍCEPS
      {
        name: "Tríceps Testa (Francês)",
        muscle_group: "Tríceps",
        equipment: "Barra W",
        tags: ["isolamento", "hipertrofia", "cabeça longa"],
        description:
          "Deitado, descer barra em direção à testa, estender braços.",
      },
      {
        name: "Tríceps Pulley Corda",
        muscle_group: "Tríceps",
        equipment: "Polia Alta, Corda",
        tags: ["isolamento", "definição", "contração"],
        description:
          "Puxar corda para baixo abrindo as pontas no final do movimento.",
      },
      {
        name: "Mergulho em Paralelas",
        muscle_group: "Tríceps",
        equipment: "Paralelas",
        tags: ["composto", "peso corporal", "força"],
        description:
          "Descer o corpo flexionando cotovelos, empurrar de volta até extensão completa.",
      },
      {
        name: "Tríceps Coice",
        muscle_group: "Tríceps",
        equipment: "Halter",
        tags: ["isolamento", "unilateral", "definição"],
        description:
          "Inclinado, estender o braço para trás contraindo o tríceps.",
      },

      // ABDÔMEN
      {
        name: "Abdominal Supra",
        muscle_group: "Abdômen",
        equipment: "Peso Corporal",
        tags: ["isolamento", "reto abdominal", "básico"],
        description: "Deitado, flexionar tronco em direção aos joelhos.",
      },
      {
        name: "Prancha Isométrica",
        muscle_group: "Abdômen",
        equipment: "Peso Corporal",
        tags: ["isométrico", "core", "estabilização"],
        description: "Apoiar antebraços e pés, manter corpo reto e contraído.",
      },
      {
        name: "Abdominal Bicicleta",
        muscle_group: "Abdômen",
        equipment: "Peso Corporal",
        tags: ["dinâmico", "oblíquos", "rotação"],
        description:
          "Alternar cotovelo com joelho oposto em movimento de pedalada.",
      },
      {
        name: "Elevação de Pernas",
        muscle_group: "Abdômen",
        equipment: "Barra Fixa ou Solo",
        tags: ["abdominal inferior", "difícil"],
        description:
          "Elevar pernas mantendo-as estendidas ou semi-flexionadas.",
      },

      // GLÚTEOS
      {
        name: "Hip Thrust",
        muscle_group: "Glúteos",
        equipment: "Barra, Banco",
        tags: ["composto", "hipertrofia", "potência"],
        description:
          "Apoiar costas no banco, empurrar quadril para cima com barra sobre a pélvis.",
      },
      {
        name: "Cadeira Abdutora",
        muscle_group: "Glúteos",
        equipment: "Máquina Abdutora",
        tags: ["isolamento", "glúteo médio", "lateral"],
        description: "Abrir as pernas contra a resistência da máquina.",
      },
      {
        name: "Afundo",
        muscle_group: "Glúteos",
        equipment: "Halteres",
        tags: ["unilateral", "funcional", "equilíbrio"],
        description:
          "Dar passo à frente, descer até joelho de trás quase tocar o chão.",
      },

      // PANTURRILHA
      {
        name: "Panturrilha em Pé",
        muscle_group: "Panturrilha",
        equipment: "Máquina ou Smith",
        tags: ["isolamento", "gastrocnêmio"],
        description: "Elevar o corpo na ponta dos pés, descer controlado.",
      },
      {
        name: "Panturrilha Sentado",
        muscle_group: "Panturrilha",
        equipment: "Máquina Sentado",
        tags: ["isolamento", "sóleo"],
        description: "Sentado, elevar calcanhares contra a resistência.",
      },
    ];

    // Inserir como exercícios compartilhados para todos os personals.
    const exercisesWithPersonal = exercises.map((ex) => ({
      ...ex,
      personal_id: null,
    }));

    console.log(`🔄 Inserindo ${exercisesWithPersonal.length} exercícios...\n`);

    const { data, error } = await supabaseAdmin
      .from("exercises")
      .insert(exercisesWithPersonal)
      .select("id, name, muscle_group");

    if (error) {
      console.error("❌ Erro ao inserir exercícios:", error.message);
      return;
    }

    console.log("✅ Exercícios inseridos com sucesso!\n");
    console.log("=".repeat(60));
    console.log(`✨ Total: ${data?.length} exercícios`);
    console.log("=".repeat(60));

    // Resumo por grupo muscular
    const groups = exercisesWithPersonal.reduce((acc: any, ex) => {
      const group = ex.muscle_group || "Sem grupo";
      acc[group] = (acc[group] || 0) + 1;
      return acc;
    }, {});

    console.log("\n📊 Resumo por grupo muscular:");
    Object.entries(groups)
      .sort(([, a]: any, [, b]: any) => b - a)
      .forEach(([group, count]) => {
        console.log(`   ${group}: ${count} exercícios`);
      });
  } catch (error: any) {
    console.error("\n❌ Erro durante seed:", error.message);
  }
}

seedExercises();
