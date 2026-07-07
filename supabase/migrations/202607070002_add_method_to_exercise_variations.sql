-- Add method column to exercise_variations to store training method (e.g. Pirâmide, Drop-set, Tradicional)
ALTER TABLE exercise_variations
  ADD COLUMN IF NOT EXISTS method text;
