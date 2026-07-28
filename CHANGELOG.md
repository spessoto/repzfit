# Changelog

Todas as mudanças relevantes do projeto serão documentadas aqui.

## [2026-07-28] – Correção de encoding dos emojis nas mensagens do bot (v1.2.4)

### Corrigido
- Corrigidos 114 emojis e caracteres especiais corrompidos em `src/services/bot-engine.ts` que apareciam como sequências mojibake (`ðŸ"¥`, `â±`, `âœ…`, `1ï¸âƒ£` etc.) nas mensagens enviadas pelo bot ao WhatsApp dos alunos. A corrupção era causada por double-encoding Windows-1252→UTF-8 aplicado sobre os bytes originais dos emojis. Todos os emojis afetados foram restaurados: 🔥 💪 ✅ ⏱ 🎯 🏋️ 🤲 🧩 📝 📊 📋 📅 🎉 🎤 😅 🔸 💡 😊 1️⃣ 2️⃣ e o traço — (em dash).
- Removido o BOM UTF-8 desnecessário do início do arquivo `src/services/bot-engine.ts`.
- Corrigidos caracteres portugueses com double-encoding no mesmo arquivo: `Ó` (em RELATÓRIO), `Ú` (em Último) e `×` (sinal de multiplicação nas metas de séries).

### Operação de banco executada
- Nenhuma migration necessária (correção exclusivamente de mensagens de texto no código).

---

## [Unreleased]

### Corrigido / Melhorado
- **Duplicação de código**: `normalizeBrazilWhatsappNumber` e `buildWebhookUrlFromRequest` extraídas para `src/utils/whatsapp.ts` e `src/utils/request.ts` — removidas 4 cópias redundantes.
- **Código morto**: Estado `AWAITING_MONITORING_CHOICE` removido do bot (nunca era atingível após refactor do fluxo de rastreamento).
- **Funções duplicadas**: `isTrainingStartIntent` removida de `gemini-service.ts` (versão interna do `bot-engine.ts` é a usada). `generateFallbackReply` removida de `openai-service.ts` (redundante com a versão do Gemini).
- **Dependências mortas**: `node-fetch`, `@vercel/speed-insights` e `pg` removidos de `package.json` (nunca importados no código-fonte).
- **Vulnerabilidades**: 4 vulnerabilidades corrigidas via `npm audit fix` (`brace-expansion`, `esbuild`, `fast-uri`, `find-my-way`). Vulnerabilidade do `xlsx` sem fix disponível — documentada e mitigada por uso exclusivo em rotas autenticadas.
- **Segurança**: `ADMIN_PANEL_PASSWORD` comparada com `crypto.timingSafeEqual` em vez de `===` plaintext.
- **Segurança**: Avisos de credenciais padrão (`ADMIN_PANEL_PASSWORD`, `ADMIN_TOKEN_SECRET`) agora emitidos em **todos** os ambientes (antes só em produção).
- **Segurança**: Aviso emitido quando `CRON_SECRET` não está configurado em produção.
- **Segurança**: Endpoint `/api/internal/rest-timer/poll` protegido com `CRON_SECRET`.
- **URLs hardcoded**: Origens CORS de produção (`project-pxgam.vercel.app`, `app.ezpersonal.com.br`) removidas do código — controladas por `FRONTEND_URL`. Fallback do webhook usa `FRONTEND_URL` antes da constante.
- **TypeScript**: Criado `tsconfig.scripts.json` — a pasta `scripts/` agora é verificada pelo typecheck. Scripts corrigidos: `pg` readicionado como devDependency, `node-fetch` substituído por `fetch` nativo, tipos explicitados.

---

## [2026-07-16] – Correção da exclusão de exercícios no cadastro (v1.2.3)

### Corrigido
- Corrigida a exclusão de exercícios no endpoint `DELETE /api/exercise-catalog/:id`: exercícios compartilhados da base (`personal_id = NULL`), como "Abdominal máquina", não eram removidos por causa de filtro incorreto por `personal_id`.
- Removido bloqueio indevido que impedia apagar exercícios já usados em treinos. O banco já trata as referências automaticamente via `ON DELETE SET NULL`/`ON DELETE CASCADE` no modelo atual.

### Alterado
- O delete de `exercise_catalog` agora aceita registros `personal_id IS NULL` e do personal autenticado, alinhando o comportamento com o restante das rotas de catálogo.

### Operação de banco executada
- Nenhuma migration nova foi necessária para esta correção de lógica de API.

---

## [2026-07-14] – Grupo muscular no fluxo do bot para exercícios sem vínculo legado (v1.2.2)

### Corrigido
- Revisão completa do fluxo de conversa do bot (`src/services/bot-engine.ts`) em busca de efeitos colaterais das mudanças recentes em exercícios/treinos.
- O bot deixou de mostrar o grupo muscular ("💪 Músculo: ...") para exercícios cadastrados apenas no catálogo novo (sem vínculo legado): a busca só lia `exercises.muscle_group` e ignorava o `muscle_group_id` opcional adicionado ao `exercise_catalog`. Isso afetava a mensagem de início de exercício, o menu de seleção de exercícios e o aviso de fim de descanso ao avançar para o próximo exercício.
- Corrigido o tipo `WorkoutExercise.exercise_id` para refletir que ele pode ser `null` (exercício sem vínculo legado), evitando inconsistência de tipos com o novo modelo de dados.

## [2026-07-14] – Exercício como único campo obrigatório e IA sem dependência de campos opcionais (v1.2.1)

### Corrigido
- Corrigido o erro `exercise_id or exercise_variation_id must be provided` ao salvar um treino: o exercício (catálogo) sozinho já era suficiente no fluxo novo, mas o backend ainda exigia um vínculo legado ou uma execução selecionada. Agora `exercise_catalog_id` isoladamente satisfaz a validação, tanto na criação do treino quanto na adição de um item a um treino existente.
- Corrigida a geração de descrição por IA para não exigir mais Execução, Equipamento, Pegada/Pisada ou Método preenchidos: o botão "Gerar descrição com IA" agora só depende do exercício selecionado, e a IA usa apenas as informações que o personal realmente preencheu.
- Corrigidos ~407 caracteres especiais que apareciam como `�` em toda a tela de Exercícios e Treinos (rótulos, alertas, placeholders), causados por uma corrupção de codificação pré-existente no arquivo. O conteúdo textual foi restaurado para UTF-8 correto sem alterar nenhuma lógica.
- Corrigida a mensagem enviada pelo bot do WhatsApp ao término do descanso: quando o exercício não tinha vínculo legado, o aluno recebia o nome genérico "Exercício" em vez do nome real cadastrado no catálogo.
- Corrigido o resumo de sessões concluídas (histórico do aluno no painel do personal), que também exibia "Exercício" genérico para itens de treino sem vínculo legado em vez do nome do catálogo/execução.

### Alterado
- `POST /api/exercise-combos/generate-description` passou a aceitar `exercise_variation_id`, `equipment_id`, `grip_footing_id` e `method_id` como opcionais; o cache de descrição por combinação só é usado/gravado quando uma execução é selecionada.

## [2026-07-14] – Exercícios cadastrados completos na seleção de treino (v1.2.0)

### Corrigido
- Corrigida a causa raiz de exercícios cadastrados (ex.: "Abdominal com anilha") não aparecerem na busca ao montar um treino: o seletor da aba de edição de treino carregava um conjunto de funções de busca duplicado e desatualizado, que sobrescrevia silenciosamente a versão já corrigida e limitava a lista às combinações pré-cadastradas da planilha original. As duplicidades foram removidas.
- O campo Exercício (tanto na criação quanto na edição de treino) agora busca diretamente em todo o catálogo cadastrado, em vez de depender apenas de combinações pré-existentes.

### Alterado
- Grupo muscular agora é um vínculo opcional do próprio exercício (`exercise_catalog.muscle_group_id`), usado apenas como filtro: ao selecioná-lo, a lista de exercícios mostra todas as opções cadastradas ligadas àquele grupo.
- O formulário de cadastro de exercício ganhou um seletor opcional de grupo muscular, e a listagem de exercícios permite atribuir/alterar o grupo de cada exercício já cadastrado.
- O filtro de grupo muscular no editor de treino passou a listar todos os grupos cadastrados (via `/api/muscle-groups`), não apenas os presentes nas combinações antigas.

### Migration executada
- `supabase/migrations/202607140002_add_muscle_group_to_exercise_catalog.sql` (adiciona `muscle_group_id` a `exercise_catalog` e faz backfill a partir das combinações pré-existentes).

## [2026-07-14] – Autocomplete completo nos campos de treino (v1.1.9)

### Alterado
- O carregamento dos campos de treino passou a buscar listas completas em vez de cortes parciais de 20 ou 50 itens.
- O autocomplete de exercício, execução, equipamento, pegada/pisada e método agora carrega todas as opções disponíveis no foco, respeitando o grupo muscular quando ele está selecionado.

### Corrigido
- Evitado truncamento de opções no dropdown principal de exercícios causado pelo limite da árvore de combinações.

### Ajuste técnico
- O endpoint `GET /api/exercise-combos/tree` passou a aceitar um volume maior de registros para suportar listas completas no editor de treino.

## [2026-07-14] – Salvamento de treino sem vínculo legado obrigatório (v1.1.8)

### Corrigido
- O salvamento de treino voltou a funcionar quando a variação selecionada não possui `exercise_id` legado.
- A coluna `exercise_id` em `workout_exercises` passou a aceitar `NULL`, alinhando o banco ao fluxo normalizado de exercícios.

### Migration executada
- `supabase/migrations/202607140001_make_workout_exercise_id_nullable.sql`

## [2026-07-14] – Criação de treino com filtros flexíveis e fallback de variações (v1.1.7)

### Alterado
- O grupo muscular na criação e edição de treino passou a funcionar como filtro opcional para simplificar a seleção de exercícios.
- Os campos de Equipamento, Execução, Pegada/Pisada e Método passaram a buscar e aceitar qualquer valor registrado nos catálogos, sem depender apenas das combinações relacionais.

### Corrigido
- O cadastro de treino deixou de falhar com a mensagem `Exercise variation is not linked to a legacy exercise. Please re-import exercises.` quando a variação selecionada não possui vínculo legado.

### Operação de banco executada
- Nenhuma migration nova foi necessária para esta correção; o esquema remoto já estava sincronizado com as migrations locais.

## [2026-07-13] – Correção do login no painel (v1.1.6)

### Corrigido
- O login voltou a expor corretamente a função global `login()` no carregamento da página.
- O formulário inicial volta a responder ao botão `Entrar` e ao clique no botão de mostrar senha.
- Removida a declaração duplicada que impedia o script do painel de ser carregado no navegador.

## [2026-07-13] – Correção do dropdown de grupo muscular no treino (v1.1.5)

### Corrigido
- O campo de grupo muscular voltou a aparecer no formulário de criação de treino.
- O dropdown de grupo muscular agora abre ao clicar no campo e lista as opções disponíveis mesmo sem digitação.
- A seleção em cascata do treino segue iniciando por grupo muscular antes de filtrar exercício, execução e demais campos.

## [2026-07-13] – Editor de treino em cascata por base original (v1.1.4)

### Alterado
- Criação e edição de treinos agora começam por grupo muscular e seguem a cascata da planilha original: grupo muscular → exercício → execução → equipamento → pegada/pisada → método.
- Campos do editor de treino foram reorganizados em duas colunas para facilitar o preenchimento.
- Os campos continuam com busca por digitação, mas agora o dropdown exibe todas as opções disponíveis do passo atual ao receber foco.

### Adicionado
- Endpoint `GET /api/exercise-combos/tree` para servir a árvore de combinações derivada da planilha `src/exercicios seed 150.xlsx`.
- Tabela `exercise_combo_options` para materializar cada linha da planilha como combinação exata usada pelo editor de treino.

### Operação de banco executada
- `exercise_combo_options` preenchida com as 150 combinações originais da planilha.

### Migrações relevantes
- `supabase/migrations/202607130003_add_exercise_combo_dimensions.sql`
- `supabase/migrations/202607130004_add_exercise_combo_options.sql`

## [2026-07-13] – Seed completo da base de exercícios (v1.1.3)

### Adicionado
- Script de seed `scripts/seed-exercises-xlsx.ts` para popular a base normalizada diretamente da planilha `src/exercicios seed 150.xlsx`.
- Mapeamento explícito das colunas da planilha para `muscle_groups`, `exercise_catalog`, `equipment_catalog`, `exercise_variations`, `grip_footing_catalog` e `method_catalog`.

### Operação de banco executada
- Base de exercícios populada do zero a partir da planilha de 150 linhas, respeitando os títulos de coluna.

### Migrações relevantes
- Nenhuma migration adicional foi necessária para esta carga de seed.

---

## [2026-07-13] – Reorganização completa da base de exercícios (v1.1.2)

### Adicionado
- Painel **Grupo Muscular** na tela de Exercícios com CRUD completo (cadastrar/excluir), backed pelo `muscle_groups`.
- Painel **Observações** na tela de Exercícios: exibe todos os exercícios com campo de notas editável por linha.
- Campo `notes` em `exercise_catalog` para armazenar observações por exercício.
- Endpoint PATCH `/api/exercise-catalog/:id/notes` para salvar observações.
- Endpoints GET/POST/DELETE `/api/muscle-groups` para CRUD de grupos musculares.

### Alterado
- Painéis da tela de Exercícios reorganizados na ordem: **Grupo Muscular → Exercício → Equipamento → Execução → Pegada/Pisada → Método → Observações**.

### Operação de banco executada
- Base de exercícios limpa totalmente (exercises, exercise_catalog, exercise_variations, equipment_catalog, grip_footing_catalog, method_catalog, muscle_groups, exercise_combo_cache, workout_exercises).

### Migrações relevantes
- supabase/migrations/202607130002_exercise_catalog_notes_and_muscle_group_crud.sql

---
## [2026-07-13] – Ajustes finais de pagamentos e nova base de exercícios (v1.1.1)

### Alterado
- Lista de controle de pagamentos na edição de aluno agora mostra somente meses entre a inclusão do aluno e o mês atual.
- Janela de meses no controle de pagamentos limitada aos últimos 5 meses, com atualização automática do mês corrente.
- Layout da edição de aluno reorganizado em 2 colunas para os blocos de Controle de pagamentos e Atribuição de treino.
- Modelo XLS de importação de exercícios ampliado com colunas opcionais e aba de instruções.

### Scripts operacionais
- scripts/import-exercises.ts atualizado para mapear colunas da planilha de seed (Grupo Muscular, Exercício, Equipamento, Execução, Pegada/Pisada, Método e Observações).
- scripts/sql/reset-exercise-base.sql adicionado para limpeza rápida da base de exercícios normalizada.

### Operação de banco executada
- Seed importado a partir de src/exercicios seed 150.xlsx para preencher a nova base normalizada.
- Registros legados remanescentes removidos após validação de impacto em workout_exercises.

---

## [2026-07-13] – Financeiro, importação XLS e reset de base de exercícios

### Adicionado

#### Financeiro
- Nova aba Financeiro no painel do personal com indicadores do mês: valor recebido, total de alunos, pendentes/atrasados e próximos do vencimento.
- Listas de alunos em atraso e alunos próximos do vencimento.
- Novos campos no aluno: monthly_fee (valor da mensalidade) e payment_day (dia de pagamento).
- Histórico mensal de recebimentos por aluno (mês/ano) com controle de status Recebido.
- Endpoint GET /api/finance/dashboard para consolidado financeiro do personal.
- Endpoints GET /api/students/:id/payments e PATCH /api/students/:id/payments/:referenceMonth para leitura e atualização de recebimentos.

#### Exercícios
- Botão Importar XLS no catálogo de exercícios para cadastro em massa.
- Botão Baixar Modelo XLS para download de planilha padrão de importação.
- Endpoint GET /api/exercise-catalog/import-template para geração do modelo XLSX.
- Endpoint POST /api/exercise-catalog/import-xls para importação em massa com opção de reset prévio.
- Botão Zerar Minha Base no módulo de exercícios.
- Endpoint POST /api/exercise-catalog/reset-base para limpeza segura da base própria do personal.

### Alterado
- GIF passou a ficar vinculado apenas ao exercício base; removido do cadastro de execuções/variações.
- Payload de criação/edição de treino ajustado para não enviar IDs opcionais como null quando não selecionados.
- Validação de criação de treino ajustada para aceitar IDs opcionais nulos no backend, evitando erro de tipo em campos opcionais.

### Corrigido
- Correção do erro ao criar treino com campos opcionais vazios (ex.: equipment_id), que retornava invalid_type/expected string/received null.

### Migrações relevantes
- supabase/migrations/202607130001_add_financial_control.sql

---

## [2026-07-07] – Modelo normalizado de exercícios, nova base, GIF e descrição customizada

### Adicionado

#### Banco de dados
- Novas tabelas: muscle_groups, exercise_catalog, exercise_variations, equipment_catalog, exercise_variation_equipments.
- Colunas gif_url e gif_storage_path em exercises e exercise_variations.
- Coluna exercise_variation_id em workout_exercises para vincular ao modelo normalizado.
- Coluna custom_description em workout_exercises: o personal pode sobrescrever a descrição por item de treino sem alterar o padrão global.
- RLS configurado para todas as novas tabelas.

#### API
- POST /api/exercises/:id/gif/upload-url – URL assinada para upload de GIF no Supabase Storage.
- POST /api/exercises/:id/gif/finalize – persiste path e URL pública do GIF após upload.
- GET /api/workouts/:id/exercises retorna description resolvida (custom → padrão), description_default, custom_description, equipment e gif_url.
- Criação e edição de item de treino aceitam exercise_variation_id e custom_description.

#### Bot
- Descrição exibida durante treino prioriza custom_description do item; padrão permanece inalterado no sistema.

#### Frontend
- Campo de URL do GIF no formulário de exercício e coluna GIF na tabela.
- Editor de item de treino exibe descrição padrão e campo editável de descrição personalizada por item.

#### Scripts operacionais
- scripts/import-exercises.ts – importador normalizado com swap seguro da base antiga e remapeamento de histórico.
- scripts/report-unmapped-legacy-exercises.ts – auditoria de exercícios legados sem vínculo ao modelo normalizado.
- scripts/promote-unmapped-legacy-to-normalized.ts – promove legados referenciados para o modelo normalizado preservando histórico.
- scripts/cleanup-unlinked-shared-exercises.ts – remove exercícios compartilhados sem referência ativa.
- scripts/apply-sql-file.ts / scripts/apply-sql-file-rpc.ts – execução de SQL arbitrário via Postgres ou RPC Supabase.

### Alterado
- Schemas de validação de exercício e item de treino atualizados para os novos campos.
- Importador de exercícios reescrito para o modelo de três entidades com mapeamento robusto e backfill idempotente.
- .gitignore passou a excluir arquivos .xlsx do controle de versão.

### Migrações relevantes
- supabase/migrations/202607070001_normalize_exercises_and_custom_descriptions.sql

---

## [2026-06-25] – Logs admin, melhorias de bot e consolidação de dados

### Adicionado
- Integração do snippet de Vercel Speed Insights nas páginas principais do app.
- Página de logs administrativos e registro de anomalias do bot.
- Testes de regressão para o tratamento de contatos do personal e para as mensagens de transição de descanso.

### Corrigido
- Remoção da duplicidade do pedido de confirmação feito nas mensagens de descanso e transição entre séries/exercícios.
- Melhoria na entrega das notificações para personais ao iniciar e finalizar treinos.
- Normalização mais robusta do número do personal para WhatsApp, aceitando formatos variados.
- Ajuste do fluxo do bot para evitar mensagens repetitivas em momentos consecutivos.
- Consolidação do modelo de dados no Supabase para reduzir colunas duplicadas e centralizar datas de atribuição.

### Alterado
- O bot passou a usar mensagens mais curtas e objetivas nas transições de descanso.
- As rotas de personal passaram a consumir a fonte canônica de datas de treino em student_workouts.
- O fluxo de relatórios para personais ficou mais consistente e passível de rastreamento em logs.

### Migrações relevantes
- supabase/migrations/202606250001_consolidate_contact_and_assignment_dates.sql