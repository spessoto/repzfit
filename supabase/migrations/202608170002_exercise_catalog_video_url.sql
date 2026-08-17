-- Adiciona campo de vídeo demonstrativo ao catálogo de exercícios.
-- Aceita qualquer URL válida (YouTube, Vimeo, etc.).

ALTER TABLE public.exercise_catalog
  ADD COLUMN IF NOT EXISTS video_url text;

COMMENT ON COLUMN public.exercise_catalog.video_url IS 'URL do vídeo demonstrativo do exercício (ex: https://youtu.be/...).';
