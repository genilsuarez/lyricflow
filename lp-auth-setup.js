import * as lpSupabase from './lp-supabase.js';
import { downloadOnLogin, runFullSync, resetDownloadState } from './sync-engine.js';

window.lpSupabase = lpSupabase;

let authListenerRegistered = false;

async function handleLogin(session, onAfterLogin) {
  if (!session?.user) return;
  const profile = await lpSupabase.fetchProfile();
  if (typeof lpLogin !== 'undefined') {
    lpLogin.setUserFromSupabase(session.user, profile);
  }
  await downloadOnLogin();
  await runFullSync({ force: true });
  onAfterLogin?.();
}

export function setupSupabaseAuth({ onAfterLogin } = {}) {
  if (authListenerRegistered) return;
  authListenerRegistered = true;

  lpSupabase.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT' || !session?.user) {
      resetDownloadState();
      if (typeof lpLogin !== 'undefined' && lpLogin.getUser()?.isSupabaseUser) {
        lpLogin.setUser(null);
      }
      return;
    }
    handleLogin(session, onAfterLogin);
  });

  lpSupabase.isAuthenticated().then(async (authed) => {
    if (!authed) return;
    const { data: { session } } = await lpSupabase.getSession();
    if (!session?.user) return;

    const current = typeof lpLogin !== 'undefined' ? lpLogin.getUser() : null;
    if (!current?.isSupabaseUser) {
      const profile = await lpSupabase.fetchProfile();
      if (typeof lpLogin !== 'undefined') {
        lpLogin.setUserFromSupabase(session.user, profile);
      }
    }

    await downloadOnLogin();
    onAfterLogin?.();
    await runFullSync();
  });
}
