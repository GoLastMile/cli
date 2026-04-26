import { readFile, writeFile, mkdir } from 'fs/promises';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { createServer } from 'http';

const AUTH_FILE = join(homedir(), '.lastmile', 'auth.json');

interface AuthSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  user: {
    id: string;
    email: string;
    name?: string;
  };
}

/**
 * Get stored auth session
 */
export async function getAuthSession(): Promise<AuthSession | null> {
  try {
    const content = await readFile(AUTH_FILE, 'utf-8');
    const session = JSON.parse(content) as AuthSession;

    // Check if expired (with 5 min buffer)
    if (session.expiresAt && Date.now() > session.expiresAt - 5 * 60 * 1000) {
      // TODO: Implement token refresh
      return null;
    }

    return session;
  } catch {
    return null;
  }
}

/**
 * Save auth session to disk
 */
export async function saveAuthSession(session: AuthSession): Promise<void> {
  await mkdir(dirname(AUTH_FILE), { recursive: true });
  await writeFile(AUTH_FILE, JSON.stringify(session, null, 2));
}

/**
 * Clear stored auth session
 */
export async function clearAuthSession(): Promise<void> {
  try {
    const { unlink } = await import('fs/promises');
    await unlink(AUTH_FILE);
  } catch {
    // File doesn't exist, that's fine
  }
}

/**
 * Check if user is logged in
 */
export async function isLoggedIn(): Promise<boolean> {
  const session = await getAuthSession();
  return session !== null;
}

/**
 * Get auth token for API requests
 */
export async function getAuthToken(): Promise<string | null> {
  const session = await getAuthSession();
  return session?.accessToken ?? null;
}

/**
 * Start local server to receive OAuth callback
 * Returns the auth code received from Supabase
 */
export function startAuthCallbackServer(port: number = 9876): Promise<{ code: string; close: () => void }> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url || '', `http://localhost:${port}`);

      // Handle the callback with auth code
      if (url.pathname === '/callback') {
        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');
        const errorDescription = url.searchParams.get('error_description');

        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <body style="font-family: system-ui; padding: 40px; text-align: center;">
                <h1>Authentication Failed</h1>
                <p>${errorDescription || error}</p>
                <p>You can close this window.</p>
              </body>
            </html>
          `);
          reject(new Error(errorDescription || error));
          return;
        }

        if (code) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <body style="font-family: system-ui; padding: 40px; text-align: center;">
                <h1>Success!</h1>
                <p>You're now logged in to LastMile.</p>
                <p>You can close this window and return to your terminal.</p>
                <script>window.close()</script>
              </body>
            </html>
          `);
          resolve({
            code,
            close: () => server.close(),
          });
          return;
        }
      }

      // Handle hash fragment redirect (Supabase sends tokens in hash)
      if (url.pathname === '/auth') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <html>
            <body style="font-family: system-ui; padding: 40px; text-align: center;">
              <h1>Processing...</h1>
              <script>
                // Extract tokens from hash and send to callback
                const hash = window.location.hash.substring(1);
                const params = new URLSearchParams(hash);
                const accessToken = params.get('access_token');
                const refreshToken = params.get('refresh_token');

                if (accessToken) {
                  fetch('/complete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      access_token: accessToken,
                      refresh_token: refreshToken,
                      expires_in: params.get('expires_in'),
                    })
                  }).then(() => {
                    document.body.innerHTML = '<h1>Success!</h1><p>You can close this window.</p>';
                    window.close();
                  });
                } else {
                  document.body.innerHTML = '<h1>Error</h1><p>No token received.</p>';
                }
              </script>
            </body>
          </html>
        `);
        return;
      }

      // Handle token submission from hash redirect
      if (url.pathname === '/complete' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          try {
            const tokens = JSON.parse(body);
            res.writeHead(200);
            res.end('OK');
            resolve({
              code: JSON.stringify(tokens), // Pass tokens as "code"
              close: () => server.close(),
            });
          } catch {
            res.writeHead(400);
            res.end('Invalid data');
          }
        });
        return;
      }

      res.writeHead(404);
      res.end('Not found');
    });

    server.listen(port, () => {
      // Server started
    });

    server.on('error', (err) => {
      reject(err);
    });

    // Timeout after 5 minutes
    setTimeout(() => {
      server.close();
      reject(new Error('Authentication timed out'));
    }, 5 * 60 * 1000);
  });
}

/**
 * Build Supabase auth URL
 */
export function buildAuthUrl(supabaseUrl: string, redirectPort: number = 9876): string {
  const redirectUri = `http://localhost:${redirectPort}/auth`;

  // Supabase auth URL format
  return `${supabaseUrl}/auth/v1/authorize?provider=github&redirect_to=${encodeURIComponent(redirectUri)}`;
}
