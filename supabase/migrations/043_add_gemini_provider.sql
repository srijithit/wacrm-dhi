-- ============================================================
-- Migration: 043_add_gemini_provider.sql
-- Description: Expand ai_configs provider check constraint to allow 'gemini'
-- ============================================================

DO $$
BEGIN
  -- Drop any existing check constraint on provider
  ALTER TABLE public.ai_configs DROP CONSTRAINT IF EXISTS ai_configs_provider_check;

  -- Add updated check constraint including 'gemini'
  ALTER TABLE public.ai_configs
    ADD CONSTRAINT ai_configs_provider_check
    CHECK (provider IN ('openai', 'anthropic', 'gemini'));
END $$;
