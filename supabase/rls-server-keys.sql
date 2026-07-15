-- =============================================
--  RLS: Block client writes on server-authoritative keys
--
--  Run this in the Supabase SQL editor:
--  Dashboard → SQL Editor → paste → Run
--
--  After running this:
--    - Clients can SELECT all their own rows (unchanged)
--    - Clients can INSERT/UPDATE/DELETE only non-sensitive keys
--    - 'players', 'lords', 'cities', 'armies' can only be written
--      by the service role key (used by the Node server)
-- =============================================

-- Step 1: Drop the existing catch-all policy that allows writes.
-- Supabase's default RLS template for user-owned tables uses one of these names:
DROP POLICY IF EXISTS "Users can manage their own data"     ON storage;
DROP POLICY IF EXISTS "users can manage their own data"     ON storage;
DROP POLICY IF EXISTS "Enable all for own rows"             ON storage;
DROP POLICY IF EXISTS "Enable read access for own rows"     ON storage;
DROP POLICY IF EXISTS "Allow authenticated users full access" ON storage;
DROP POLICY IF EXISTS "storage_read_own"                    ON storage;
DROP POLICY IF EXISTS "storage_write_nonsensitive"          ON storage;
DROP POLICY IF EXISTS "storage_update_nonsensitive"         ON storage;
DROP POLICY IF EXISTS "storage_delete_own"                  ON storage;

-- Step 2: Read — clients may read all their own rows (unchanged).
CREATE POLICY "storage_read_own" ON storage
  FOR SELECT
  TO authenticated
  USING (player_id = auth.uid());

-- Step 3: Insert — clients may only write non-server-authoritative keys.
--   'players', 'lords', 'cities', 'armies' are server-only.
CREATE POLICY "storage_write_nonsensitive" ON storage
  FOR INSERT
  TO authenticated
  WITH CHECK (
    player_id = auth.uid()
    AND key NOT IN ('players', 'lords', 'cities', 'armies')
  );

-- Step 4: Update — same restriction.
CREATE POLICY "storage_update_nonsensitive" ON storage
  FOR UPDATE
  TO authenticated
  USING (
    player_id = auth.uid()
    AND key NOT IN ('players', 'lords', 'cities', 'armies')
  )
  WITH CHECK (
    player_id = auth.uid()
    AND key NOT IN ('players', 'lords', 'cities', 'armies')
  );

-- Step 5: Delete — clients can delete any of their own rows
--   (needed for discovery cleanup, etc.).
CREATE POLICY "storage_delete_own" ON storage
  FOR DELETE
  TO authenticated
  USING (player_id = auth.uid());

-- Verify: this query should return 4 policies.
-- SELECT policyname, cmd FROM pg_policies WHERE tablename = 'storage';
