import { cache } from 'react';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const getDashboardContext = cache(async () => {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return { supabase, user: null, profile: null, authError, profileError: null };
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('email, owner_name, cafe_name, role, franchise_owner_id')
    .eq('id', user.id)
    .maybeSingle();

  return { supabase, user, profile, authError: null, profileError };
});
