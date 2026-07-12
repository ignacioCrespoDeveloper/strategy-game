// =============================================
//  supabase.js — Singleton Supabase client
//
//  Loaded after config.js so SUPABASE_URL and
//  SUPABASE_ANON_KEY are already defined.
// =============================================

const SupabaseService = (() => {
  const { createClient } = supabase; // from CDN
  const _client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  return { client: _client };
})();
