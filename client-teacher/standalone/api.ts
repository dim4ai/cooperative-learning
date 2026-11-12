// The page's fetch() to the API address goes to the server running in this tab (shims/express.ts);
// anything else — the sample lesson, voices, the real server's /feedback — goes out as usual
import { theApp } from './shims/express';

const API = import.meta.env.VITE_API_URL as string;

export function routeApiInPage() {
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(API)) return realFetch(input, init);
    const app = theApp();
    if (!app) return new Response(JSON.stringify({ error: 'no server' }), { status: 503 });
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => { headers[k.toLowerCase()] = v; });
    let body: unknown;
    if (typeof init?.body === 'string') { try { body = JSON.parse(init.body); } catch { body = init.body; } }
    const answer = await app.handle((init?.method ?? 'GET').toUpperCase(), url.slice(API.length) || '/', headers, body);
    const empty = answer.status === 204 || answer.status === 304 || answer.body === null || answer.body === undefined;
    return new Response(empty ? null : JSON.stringify(answer.body), { status: answer.status, headers: { 'Content-Type': 'application/json' } });
  };
}
