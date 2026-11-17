'use client';

import { createSupabaseClient } from '@/lib/supabase/client';

export type FranchiseRole = 'admin' | 'barista';

export async function getFranchiseContext() {
  const supabase = createSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  if (!user) throw new Error('Sign in to continue.');

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role, franchise_owner_id')
    .eq('id', user.id)
    .single();
  if (profileError) throw profileError;
  if (profile.role !== 'admin' && profile.role !== 'barista') {
    throw new Error('Your account does not have a recognized role.');
  }

  return {
    userId: user.id,
    franchiseId: profile.franchise_owner_id ?? user.id,
    role: profile.role as FranchiseRole,
  };
}
