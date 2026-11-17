ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS modifiers jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS notes text;

UPDATE public.order_items
SET modifiers = '[]'::jsonb
WHERE modifiers IS NULL;

ALTER TABLE public.order_items
  ALTER COLUMN modifiers SET DEFAULT '[]'::jsonb,
  ALTER COLUMN modifiers SET NOT NULL;

NOTIFY pgrst, 'reload schema';
