import { needsOAuthCallbackRedirect } from './oauthCallback';

describe('needsOAuthCallbackRedirect', () => {
  test('keeps password recovery codes on the reset page', () => {
    expect(needsOAuthCallbackRedirect({
      pathname: '/reset-password',
      search: '?code=recovery-code',
      hash: '',
    })).toBe(false);
  });

  test('continues redirecting ordinary auth codes to the callback', () => {
    expect(needsOAuthCallbackRedirect({
      pathname: '/',
      search: '?code=oauth-code',
      hash: '',
    })).toBe(true);
  });
});
