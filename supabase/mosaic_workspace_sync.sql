-- Optional desktop workspace sync. Apply to the user's private Supabase project.
-- The desktop client uses a locally configured secret key through Electron main only.
CREATE TABLE IF NOT EXISTS public.mosaic_workspace_records (
  workspace_id text NOT NULL,
  page text NOT NULL CHECK (page IN ('IT Projects', 'Meetings', 'Notebook', 'Notetaker')),
  record_id text NOT NULL,
  file_name text NOT NULL,
  record jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  PRIMARY KEY (workspace_id, page, record_id),
  CHECK ((deleted_at IS NULL AND record IS NOT NULL) OR (deleted_at IS NOT NULL AND record IS NULL))
);

ALTER TABLE public.mosaic_workspace_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mosaic_workspace_records FROM anon, authenticated;
GRANT ALL ON TABLE public.mosaic_workspace_records TO service_role;

CREATE INDEX IF NOT EXISTS mosaic_workspace_records_updated_at
  ON public.mosaic_workspace_records (workspace_id, updated_at DESC);
