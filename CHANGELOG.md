# Changelog

Todas as mudanças relevantes do projeto serão documentadas aqui.

## [Unreleased]

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