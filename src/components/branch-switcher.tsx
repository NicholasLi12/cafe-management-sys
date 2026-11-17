'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseClient } from '@/lib/supabase/client';

type Branch = { id: string; branch_name: string };

export function BranchSwitcher({ instanceId }: { instanceId: string }) {
  const router = useRouter();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [activeBranchId, setActiveBranchId] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [branchName, setBranchName] = useState('');
  const [cloneFrom, setCloneFrom] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    let isMounted = true;
    const loadBranches = async () => {
      try {
        const supabase = createSupabaseClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError) throw authError;
        if (!user) throw new Error('Sign in to manage franchise branches.');

        const [profileResult, membershipResult] = await Promise.all([
          supabase.from('profiles').select('franchise_owner_id').eq('id', user.id).single(),
          supabase.from('user_branch_memberships').select('branch_id, role').eq('user_id', user.id).eq('role', 'admin'),
        ]);
        if (profileResult.error) throw profileResult.error;
        if (membershipResult.error) throw membershipResult.error;

        const branchIds = membershipResult.data.map((membership) => membership.branch_id);
        const branchResult = branchIds.length
          ? await supabase.from('franchise_branches').select('id, branch_name').in('id', branchIds).order('branch_name')
          : { data: [], error: null };
        if (branchResult.error) throw branchResult.error;
        if (isMounted) {
          setBranches(branchResult.data ?? []);
          setActiveBranchId(profileResult.data.franchise_owner_id ?? '');
        }
      } catch (error) {
        if (isMounted) setErrorMessage(error instanceof Error ? error.message : 'Could not load franchise branches.');
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };
    void loadBranches();
    return () => { isMounted = false; };
  }, []);

  const switchBranch = async (branchId: string) => {
    if (!branchId || branchId === activeBranchId) return;
    setErrorMessage('');
    setIsSaving(true);
    try {
      const { error } = await createSupabaseClient().rpc('switch_active_branch', { p_branch_id: branchId });
      if (error) throw error;
      setActiveBranchId(branchId);
      router.refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not switch branches.');
    } finally {
      setIsSaving(false);
    }
  };

  const createBranch = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage('');
    setIsSaving(true);
    try {
      const name = branchName.trim();
      if (!name) throw new Error('Enter a branch name.');
      const { data, error } = await createSupabaseClient().rpc('create_franchise_branch', {
        p_branch_name: name,
        p_clone_from_branch_id: cloneFrom || null,
      });
      if (error) throw error;
      if (typeof data !== 'string') throw new Error('Branch creation returned no branch ID.');
      setBranches((current) => [...current.filter((branch) => branch.id !== data), { id: data, branch_name: name }]
        .sort((a, b) => a.branch_name.localeCompare(b.branch_name)));
      setActiveBranchId(data);
      setBranchName('');
      setCloneFrom('');
      setIsCreating(false);
      router.refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not create branch.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="mt-4 space-y-2">
      <label className="block text-xs font-medium text-slate-400" htmlFor={`active-branch-${instanceId}`}>Active branch</label>
      <div className="flex gap-2">
        <select
          id={`active-branch-${instanceId}`}
          value={activeBranchId}
          onChange={(event) => void switchBranch(event.target.value)}
          disabled={isLoading || isSaving || branches.length === 0}
          className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-2 text-sm text-white disabled:opacity-60"
        >
          {isLoading && <option value="">Loading branches…</option>}
          {!isLoading && !branches.length && <option value="">No admin branches</option>}
          {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.branch_name}</option>)}
        </select>
        <button
          type="button"
          onClick={() => { setErrorMessage(''); setIsCreating(true); }}
          disabled={isLoading || isSaving}
          className="shrink-0 rounded-lg bg-brand-600 px-2.5 py-2 text-xs font-semibold text-white hover:bg-brand-500 disabled:opacity-50"
        >
          + Add Branch
        </button>
      </div>
      {errorMessage && <p role="alert" className="text-xs text-rose-300">{errorMessage}</p>}

      {isCreating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !isSaving) setIsCreating(false);
        }}>
          <section role="dialog" aria-modal="true" aria-labelledby={`create-branch-title-${instanceId}`} className="w-full max-w-lg rounded-2xl bg-white p-5 text-slate-900 shadow-2xl">
            <h2 id={`create-branch-title-${instanceId}`} className="text-xl font-bold">Add Franchise Branch</h2>
            <form onSubmit={createBranch} className="mt-4 space-y-4">
              <label className="block text-sm font-medium">Branch Name
                <input
                  required
                  autoFocus
                  value={branchName}
                  onChange={(event) => setBranchName(event.target.value)}
                  placeholder="HtutHtutCafe - Sukhumvit"
                  disabled={isSaving}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </label>
              <label className="block text-sm font-medium">Clone Setup From
                <select value={cloneFrom} onChange={(event) => setCloneFrom(event.target.value)} disabled={isSaving} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2">
                  <option value="">Start empty</option>
                  {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.branch_name}</option>)}
                </select>
                <span className="mt-1 block text-xs font-normal text-slate-500">Menu items, sizes, recipes, supplies, and modifier stock rules are copied. New supply stock starts at zero.</span>
              </label>
              {errorMessage && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{errorMessage}</p>}
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setIsCreating(false)} disabled={isSaving} className="rounded-lg border border-slate-300 px-4 py-2 text-sm">Cancel</button>
                <button type="submit" disabled={isSaving} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{isSaving ? 'Creating…' : 'Create Branch'}</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
