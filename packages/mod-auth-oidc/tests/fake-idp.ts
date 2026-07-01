/**
 * A minimal in-test OIDC issuer: discovery + JWKS + token endpoint, one
 * generated RS256 keypair, zero state. The trick that keeps it stateless:
 * `/token` echoes the incoming `code` back as the ID token's `nonce` claim —
 * the test drives `/start`, lifts state+nonce from the authorize redirect,
 * and calls the callback with `code=<nonce>`, closing the loop without ever
 * visiting an authorize page.
 */

import { createServer, type Server } from "node:http";
import { exportJWK, generateKeyPair, SignJWT } from "jose";

export interface FakeIdpClaims {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
}

export interface FakeIdp {
  issuer: string;
  /** Mutable per-test knobs for what the ID token asserts. */
  claims: FakeIdpClaims;
  /** Every urlencoded body the token endpoint received. */
  tokenRequests: Array<Record<string, string>>;
  close(): Promise<void>;
}

export async function startFakeIdp(port: number): Promise<FakeIdp> {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "test-key", alg: "RS256", use: "sig" };
  const issuer = `http://localhost:${port}`;

  const idp: FakeIdp = {
    issuer,
    claims: { sub: "idp-user-1", email: "ada@x.io", email_verified: true, name: "Ada" },
    tokenRequests: [],
    close: async () => {},
  };

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", issuer);
    const json = (body: unknown, status = 200) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };

    if (url.pathname === "/.well-known/openid-configuration") {
      return json({
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
      });
    }
    if (url.pathname === "/jwks") return json({ keys: [jwk] });
    if (url.pathname === "/token" && req.method === "POST") {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c as Buffer));
      req.on("end", () => {
        const params = Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString("utf8")));
        idp.tokenRequests.push(params);
        void new SignJWT({ ...idp.claims, nonce: params.code })
          .setProtectedHeader({ alg: "RS256", kid: "test-key" })
          .setIssuedAt()
          .setIssuer(issuer)
          .setAudience(params.client_id ?? "unknown-client")
          .setExpirationTime("5m")
          .sign(privateKey)
          .then((idToken) => json({ id_token: idToken, access_token: "at-1", token_type: "Bearer" }));
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(port, resolve));
  idp.close = () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  return idp;
}
