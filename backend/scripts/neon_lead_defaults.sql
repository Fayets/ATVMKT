-- Defaults y columna para canal de agenda (Chat / Youtube).
-- Pony ORM usa la tabla "Lead" por defecto. Si tu base tiene otra convención (p. ej. leads), renombrá el identificador.
--
-- El campo de fecha de agenda sigue siendo la columna agendo_en (timestamptz).
-- El texto Chat/Youtube vive en canal_agendo; la API expone ese valor como JSON "agendo_en".

ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS canal_agendo VARCHAR(64) DEFAULT '';

UPDATE "Lead" SET origen = 'Setter' WHERE origen IS NULL OR origen = '';
UPDATE "Lead" SET canal_agendo = 'Chat' WHERE canal_agendo IS NULL OR canal_agendo = '';
