// Debug-only OAuth redirect for the side-by-side local Metti build.
// The release asset in src/main keeps the production metti:// callback.
window.METTI_SUPABASE_CONFIG = Object.freeze({
  url: 'https://fkicjvawvaddjdmcpiei.supabase.co',
  publishableKey: 'sb_publishable_yCONBgzsJZ_V-rDjoKFzBg_UoB_JGom',
  oauthRedirectTo: 'metti://auth-callback'
});
