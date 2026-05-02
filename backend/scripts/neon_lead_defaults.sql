-- Defaults y columna para canal de agenda (Chat / Youtube).
-- En Postgres con Pony la tabla suele ser `lead` (minúsculas). Ajustá si tu esquema difiere.
--
-- El campo de fecha de agenda sigue siendo la columna agendo_en (timestamptz).
-- El texto Chat/Youtube vive en canal_agendo; la API expone ese valor como JSON "agendo_en".
-- El arranque del backend también intenta ADD COLUMN (ver src/db.py).

ALTER TABLE lead ADD COLUMN IF NOT EXISTS canal_agendo VARCHAR(64) DEFAULT '';

UPDATE lead SET origen = 'Setter' WHERE origen IS NULL OR origen = '';
UPDATE lead SET canal_agendo = 'Chat' WHERE canal_agendo IS NULL OR canal_agendo = '';
