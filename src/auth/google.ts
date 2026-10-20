import { create } from 'zustand';

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
const PROFILE_SCOPES = 'openid email profile';
export const PICKER_SCOPE = 'https://www.googleapis.com/auth/photospicker.mediaitems.readonly';

export interface GoogleUser {
  name: string;
  email: string;
  picture?: string;
}

interface Token {
  value: string;
  scopes: Set<string>;
  expiresAt: number;
}

interface AuthState {
  user?: GoogleUser;
  token?: Token;
}

export const useAuth = create<AuthState>(() => {
  try {
    const raw = sessionStorage.getItem('tt-auth');
    if (raw) {
      const s = JSON.parse(raw);
      if (s.token.expiresAt > Date.now()) return { user: s.user, token: { ...s.token, scopes: new Set(s.token.scopes) } };
    }
  } catch {
    // ignore unreadable session state
  }
  return {};
});

useAuth.subscribe(({ user, token }) => {
  try {
    if (user && token) sessionStorage.setItem('tt-auth', JSON.stringify({ user, token: { ...token, scopes: [...token.scopes] } }));
    else sessionStorage.removeItem('tt-auth');
  } catch {
    // storage may be blocked
  }
});

export const googleConfigured = () => !!CLIENT_ID;

function gis(): typeof google.accounts.oauth2 {
  if (!CLIENT_ID) throw new Error('Google sign-in is not configured. Set VITE_GOOGLE_CLIENT_ID in .env (see README).');
  if (typeof google === 'undefined' || !google.accounts?.oauth2) throw new Error('Google sign-in script has not loaded yet. Check your connection and try again.');
  return google.accounts.oauth2;
}

function requestToken(scope: string, prompt: '' | 'consent' | 'select_account'): Promise<Token> {
  return new Promise((resolve, reject) => {
    const client = gis().initTokenClient({
      client_id: CLIENT_ID!,
      scope,
      include_granted_scopes: true,
      prompt,
      callback: (res) => {
        if (res.error || !res.access_token) return reject(new Error(res.error_description || res.error || 'Google sign-in failed'));
        resolve({ value: res.access_token, scopes: new Set(res.scope.split(' ')), expiresAt: Date.now() + (Number(res.expires_in) - 60) * 1000 });
      },
      error_callback: (err) => reject(new Error(err.type === 'popup_closed' ? 'Sign-in window was closed' : err.message || 'Google sign-in failed')),
    });
    client.requestAccessToken();
  });
}

export async function signIn(): Promise<GoogleUser> {
  const token = await requestToken(PROFILE_SCOPES, 'select_account');
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${token.value}` } });
  if (!res.ok) throw new Error('Could not load your Google profile');
  const info = await res.json();
  const user: GoogleUser = { name: info.name ?? info.email, email: info.email, picture: info.picture };
  useAuth.setState({ user, token });
  return user;
}

export function signOut() {
  const t = useAuth.getState().token;
  if (t && typeof google !== 'undefined') google.accounts.oauth2.revoke(t.value, () => undefined);
  useAuth.setState({ user: undefined, token: undefined });
}

/** Returns an access token that carries `scope`, asking the user for consent if needed. */
export async function tokenFor(scope: string): Promise<string> {
  const t = useAuth.getState().token;
  if (t && t.expiresAt > Date.now() && t.scopes.has(scope)) return t.value;
  const token = await requestToken(`${PROFILE_SCOPES} ${scope}`, '');
  if (!token.scopes.has(scope)) throw new Error('Google Photos access was not granted');
  useAuth.setState({ token });
  return token.value;
}
