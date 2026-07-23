import * as lpSupabase from './lp-supabase.js';
import { downloadOnLogin, runFullSync, resetDownloadState } from './sync-engine.js';

window.lpSupabase = lpSupabase;

let authListenerRegistered = false;

async function hydrateFromCloud(onAfterLogin, { forceDownload = false } = {}) {
  const result = await downloadOnLogin({ force: forceDownload });
  if (!result.hydrated) return result;
  await runFullSync({ force: true });
  onAfterLogin?.();
  return result;
}

async function handleLogin(session, onAfterLogin, { forceDownload = false } = {}) {
  if (!session?.user) return;

  let profile = null;
  try {
    profile = await lpSupabase.fetchProfile();
  } catch {
    profile = null;
  }
  if (typeof lpLogin !== 'undefined') {
    lpLogin.setUserFromSupabase(session.user, profile);
  }
  await hydrateFromCloud(onAfterLogin, { forceDownload });
}

export function setupSupabaseAuth({ onAfterLogin, onAfterLogout } = {}) {
  if (authListenerRegistered) return;
  authListenerRegistered = true;

  lpSupabase.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT' || !session?.user) {
      resetDownloadState();
      if (typeof lpLogin !== 'undefined' && lpLogin.getUser()?.isSupabaseUser) {
        if (window.lpGuestReset?.clearGuestLocalProgress) {
          window.lpGuestReset.clearGuestLocalProgress();
        }
        lpLogin.setUser(null);
        onAfterLogout?.();
      }
      return;
    }
    if (event === 'SIGNED_IN') {
      resetDownloadState();
    }
    handleLogin(session, onAfterLogin, { forceDownload: event === 'SIGNED_IN' });
  });

  lpSupabase.isAuthenticated().then(async (authed) => {
    if (!authed) return;
    const {
      data: { session },
    } = await lpSupabase.getSession();
    if (!session?.user) return;

    const current = typeof lpLogin !== 'undefined' ? lpLogin.getUser() : null;
    if (!current?.isSupabaseUser) {
      let profile = null;
      try {
        profile = await lpSupabase.fetchProfile();
      } catch {
        profile = null;
      }
      if (typeof lpLogin !== 'undefined') {
        lpLogin.setUserFromSupabase(session.user, profile);
      }
    }

    await hydrateFromCloud(onAfterLogin);
  });
}
