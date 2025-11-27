/* BEGIN GPT CHANGE: env module */
export const ENV = {
  SUPABASE_URL: window?.__ENV?.SUPABASE_URL ?? "",
  SUPABASE_ANON_KEY: window?.__ENV?.SUPABASE_ANON_KEY ?? "",
  // AI feature flags / provider selection
  // Set `CLAUDE_SONNET_45_ENABLED` to true by default so clients enable it.
  AI_PROVIDER: window?.__ENV?.AI_PROVIDER ?? "",
  AI_MODEL: window?.__ENV?.AI_MODEL ?? "",
  CLAUDE_SONNET_45_ENABLED:
    typeof window?.__ENV?.CLAUDE_SONNET_45_ENABLED !== 'undefined'
      ? window.__ENV.CLAUDE_SONNET_45_ENABLED === 'true' || window.__ENV.CLAUDE_SONNET_45_ENABLED === true
      : true,
};
/* END GPT CHANGE */
