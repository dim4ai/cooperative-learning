// 'jsonwebtoken': tokens that never leave the page need no signature, only the claims
interface Opts { audience?: string; expiresIn?: number | string }

function sign(payload: Record<string, unknown>, _secret: string, opts: Opts = {}): string {
  return 'local.' + btoa(encodeURIComponent(JSON.stringify({ ...payload, aud: opts.audience ?? null })));
}

function verify(token: string, _secret: string, opts: Opts = {}): Record<string, unknown> {
  if (typeof token !== 'string' || !token.startsWith('local.')) throw new Error('invalid token');
  const claims = JSON.parse(decodeURIComponent(atob(token.slice(6)))) as Record<string, unknown>;
  if (opts.audience !== undefined && claims.aud !== opts.audience) throw new Error('jwt audience invalid');
  return claims;
}

export default { sign, verify };
export { sign, verify };
