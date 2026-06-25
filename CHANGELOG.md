# Changelog

Todas as mudanças relevantes do projeto serão documentadas aqui.

## [Unreleased]

### Adicionado
- Integração do snippet de Vercel Speed Insights nas páginas principais do app.
- Página de logs administrativos e registro de anomalias do bot.
- Testes de regressão para o tratamento de contatos do personal e para as mensagens de transição de descanso.

### Corrigido
- Remoção da duplicidade do pedido de confirmação “feito” nas mensagens de descanso e transição entre séries/exercícios.
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
