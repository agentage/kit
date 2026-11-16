import { createServer } from 'node:http';
import { type AddressInfo } from 'node:net';

// The auth get-session the cli checks: a known bearer is its user, any other is 200 + null.
export const fakeIssuer = async (users: Record<string, string>) => {
  let calls = 0;
  const server = createServer((req, res) => {
    calls += 1;
    const bearer = (req.headers.authorization ?? '').slice(7);
    const user = req.url === '/api/auth/mcp/get-session' ? users[bearer] : undefined;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(user ? { userId: user, accessTokenExpiresAt: '2026-12-01' } : null));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    issuer,
    calls: () => calls,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
};

// auth.json as cli signIn writes it: no user, no platform token, an opaque session bearer.
export const signedInAuth = (issuer: string, bearer: string, extra: object = {}) =>
  JSON.stringify({
    siteFqdn: 'agentage.io',
    issuer,
    clientId: 'c',
    tokens: { accessToken: bearer, refreshToken: 'r' },
    ...extra,
  });
