-- Adicionar campo para armazenar a chave API do Gemini de forma segura
alter table public.personals add column if not exists gemini_api_key text;

-- Criar comentário explicativo
comment on column public.personals.gemini_api_key is 'Chave API do Google Gemini para integração de IA';
