-- Dev-only Analyze templates for the mock user. On a fresh DB the web falls
-- back to these ids (DEFAULT_TEMPLATES in web/src/pages/AnalyzePage.tsx), and
-- the DB adapter runs only a template the user owns, so without these rows
-- Generate 404s (#404). Rows match services/dev-api/src/analyze-fixture.ts.
INSERT INTO analyze_templates (template_id, user_id, name, prompt_template, source_categories, version)
VALUES
  (
    '11111111-1111-4111-8111-111111111111',
    '00000000-0000-4000-8000-000000000001',
    'Earnings template',
    'Assess revenue quality, margins, cash conversion, and management commentary.',
    '["filings", "transcripts", "news"]'::jsonb,
    1
  ),
  (
    '22222222-2222-4222-8222-222222222222',
    '00000000-0000-4000-8000-000000000001',
    'Variant view',
    'Compare the market narrative with evidence-backed counterpoints.',
    '["filings", "news", "transcripts"]'::jsonb,
    1
  )
ON CONFLICT (template_id) DO NOTHING;
