'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseClient } from '@/lib/supabase/client';

type Branch = { id: string; branch_name: string; owner_user_id: string };

export function BranchSwitcher({ instanceId }: { instanceId: string }) {
  const router = useRouter();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [hasHQAccess, setHasHQAccess] = useState(false);
  const [activeBranchId, setActiveBranchId] = useState('');
  const [currentUserId, setCurrentUserId] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isManaging, setIsManaging] = useState(false);
  const [branchName, setBranchName] = useState('');
  const [cloneFrom, setCloneFrom] = useState('');
  const [editingBranchId, setEditingBranchId] = useState<string | null>(null);
  const [editingBranchName, setEditingBranchName] = useState('');
  const [deletingBranchId, setDeletingBranchId] = useState<string | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
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
          ? await supabase.from('franchise_branches')
            .select('id, branch_name, owner_user_id')
            .in('id', branchIds)
            .eq('owner_user_id', user.id)
            .order('branch_name')
          : { data: [], error: null };
        if (branchResult.error) throw branchResult.error;
        if (isMounted) {
          setBranches(branchResult.data ?? []);
          setHasHQAccess((branchResult.data ?? []).length > 0);
          setActiveBranchId(profileResult.data.franchise_owner_id ?? '');
          setCurrentUserId(user.id);
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
      setBranches((current) => [...current.filter((branch) => branch.id !== data), { id: data, branch_name: name, owner_user_id: currentUserId }]
        .sort((a, b) => a.branch_name.localeCompare(b.branch_name)));
      setActiveBranchId(data);
      setBranchName('');
      setCloneFrom('');
      router.refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not create branch.');
    } finally {
      setIsSaving(false);
    }
  };

  const saveBranchName = async (branch: Branch) => {
    setErrorMessage('');
    setIsSaving(true);
    try {
      const name = editingBranchName.trim();
      if (!name) throw new Error('Branch name cannot be empty.');
      const { error } = await createSupabaseClient().rpc('update_franchise_branch', {
        p_branch_id: branch.id,
        p_branch_name: name,
      });
      if (error) throw error;
      setBranches((current) => current.map((entry) => entry.id === branch.id ? { ...entry, branch_name: name } : entry)
        .sort((a, b) => a.branch_name.localeCompare(b.branch_name)));
      setEditingBranchId(null);
      setEditingBranchName('');
      router.refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not rename branch.');
    } finally {
      setIsSaving(false);
    }
  };

  const deleteBranch = async (branch: Branch) => {
    setErrorMessage('');
    setIsSaving(true);
    try {
      const { data, error } = await createSupabaseClient().rpc('delete_franchise_branch', {
        p_branch_id: branch.id,
      });
      if (error) throw error;
      if (typeof data !== 'string') throw new Error('Branch deletion returned no fallback branch ID.');
      setBranches((current) => current.filter((entry) => entry.id !== branch.id));
      if (activeBranchId === branch.id) setActiveBranchId(data);
      setDeletingBranchId(null);
      setDeleteConfirmation('');
      router.refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not delete branch.');
    } finally {
      setIsSaving(false);
    }
  };

  if (!hasHQAccess) return null;

  return (
    <div className="mt-4 space-y-2 border-t border-white/10 pt-3">
      <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-400" htmlFor={`active-branch-${instanceId}`}>Active branch</label>
      <div className="flex gap-2">
        <select
          id={`active-branch-${instanceId}`}
          value={activeBranchId}
          onChange={(event) => void switchBranch(event.target.value)}
          disabled={isLoading || isSaving || branches.length === 0}
          className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-2 text-sm text-white focus:border-orange-400 focus:ring-orange-400/20"
        >
          {isLoading && <option value="">Loading branches…</option>}
          {!isLoading && !branches.length && <option value="">No admin branches</option>}
          {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.branch_name}</option>)}
        </select>
      </div>
      <button
        type="button"
        onClick={() => { setErrorMessage(''); setIsManaging(true); }}
        disabled={isLoading || isSaving}
        className="w-full rounded-lg border border-white/10 px-3 py-2 text-left text-xs font-medium text-slate-300 transition hover:border-white/20 hover:bg-white/5 hover:text-white disabled:opacity-50"
      >
        Manage Branches
      </button>
      {errorMessage && <p role="alert" className="text-xs text-rose-300">{errorMessage}</p>}

      {isManaging && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !isSaving) setIsManaging(false);
        }}>
          <section role="dialog" aria-modal="true" aria-labelledby={`manage-branches-title-${instanceId}`} className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 text-slate-900 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id={`manage-branches-title-${instanceId}`} className="text-xl font-bold">Manage Branches</h2>
                <p className="mt-1 text-sm text-slate-500">Rename, add, or remove branches in your franchise.</p>
              </div>
              <button type="button" onClick={() => setIsManaging(false)} disabled={isSaving} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm">Close</button>
            </div>
            {errorMessage && <p role="alert" className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{errorMessage}</p>}

            <div className="mt-4 space-y-3">
              {branches.map((branch) => (
                <article key={branch.id} className="rounded-xl border border-slate-200 p-3">
                  {editingBranchId === branch.id ? (
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <input
                        aria-label={`Rename ${branch.branch_name}`}
                        autoFocus
                        value={editingBranchName}
                        onChange={(event) => setEditingBranchName(event.target.value)}
                        disabled={isSaving}
                        className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      />
                      <button type="button" onClick={() => void saveBranchName(branch)} disabled={isSaving} className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{isSaving ? 'Saving…' : 'Save'}</button>
                      <button type="button" onClick={() => { setEditingBranchId(null); setEditingBranchName(''); }} disabled={isSaving} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">Cancel</button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="font-semibold">{branch.branch_name}{branch.id === activeBranchId && <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">Active</span>}</p>
                        <p className="mt-1 text-xs text-slate-500">{branch.id}</p>
                      </div>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => { setEditingBranchId(branch.id); setEditingBranchName(branch.branch_name); setDeletingBranchId(null); }} disabled={isSaving} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm">Edit</button>
                        <button
                          type="button"
                          title={branches.length <= 1 ? 'Cannot delete your last branch' : undefined}
                          onClick={() => { setDeletingBranchId(branch.id); setDeleteConfirmation(''); setEditingBranchId(null); }}
                          disabled={isSaving || branches.length <= 1}
                          className="rounded-lg border border-rose-200 px-3 py-1.5 text-sm text-rose-700 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  )}
                  {deletingBranchId === branch.id && (
                    <div className="mt-3 rounded-lg bg-rose-50 p-3">
                      <p className="text-sm font-semibold text-rose-800">This permanently deletes the branch and its cafe data.</p>
                      <p className="mt-1 text-xs text-rose-700">Type <strong>{branch.branch_name}</strong> exactly to confirm.</p>
                      <input
                        aria-label={`Type ${branch.branch_name} to confirm deletion`}
                        value={deleteConfirmation}
                        onChange={(event) => setDeleteConfirmation(event.target.value)}
                        disabled={isSaving}
                        className="mt-2 w-full rounded-lg border border-rose-200 bg-white px-3 py-2 text-sm"
                      />
                      <div className="mt-2 flex justify-end gap-2">
                        <button type="button" onClick={() => { setDeletingBranchId(null); setDeleteConfirmation(''); }} disabled={isSaving} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm">Cancel</button>
                        <button type="button" onClick={() => void deleteBranch(branch)} disabled={isSaving || deleteConfirmation !== branch.branch_name} className="rounded-lg bg-rose-700 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40">{isSaving ? 'Deleting…' : 'Confirm Delete'}</button>
                      </div>
                    </div>
                  )}
                </article>
              ))}
            </div>

            <section className="mt-6 border-t border-slate-200 pt-5">
              <h3 className="font-semibold">Add Branch</h3>
              <form onSubmit={createBranch} className="mt-3 space-y-3">
                <label className="block text-sm font-medium">Branch Name
                  <input required value={branchName} onChange={(event) => setBranchName(event.target.value)} placeholder="HtutHtutCafe - Sukhumvit" disabled={isSaving} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
                </label>
                <label className="block text-sm font-medium">Clone Setup From
                  <select value={cloneFrom} onChange={(event) => setCloneFrom(event.target.value)} disabled={isSaving} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2">
                    <option value="">Start empty</option>
                    {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.branch_name}</option>)}
                  </select>
                  <span className="mt-1 block text-xs font-normal text-slate-500">Menu items, sizes, recipes, supplies, and modifier rules are copied. New supply stock starts at zero.</span>
                </label>
                <div className="flex justify-end">
                  <button type="submit" disabled={isSaving} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{isSaving ? 'Creating…' : '+ Create Branch'}</button>
                </div>
              </form>
            </section>
          </section>
        </div>
      )}
    </div>
  );
}
