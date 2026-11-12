// 'express' for the server running in the page: the routes are registered as usual, and ../api.ts
// hands them the page's fetch() calls to the API address
/* eslint-disable @typescript-eslint/no-explicit-any */
type Fn = (...args: any[]) => any;
interface Layer { method: string | null; path: RegExp | null; keys: string[]; fns: Fn[] }
export interface Answer { status: number; body: unknown }

function compile(path: string): { re: RegExp; keys: string[] } {
  const keys: string[] = [];
  const re = new RegExp('^' + path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\?:([A-Za-z_]+)/g, (_m, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  return { re, keys };
}

export interface Request { [k: string]: any }
export interface Response { [k: string]: any }
export type NextFunction = (err?: unknown) => void;

function express() {
  const stack: Layer[] = [];
  const route = (method: string) => (path: string, ...fns: Fn[]) => {
    const { re, keys } = compile(path);
    stack.push({ method, path: re, keys, fns: fns.flat() });
    return app;
  };
  const app = {
    disable() { return app; },
    set() { return app; },
    use(...fns: Fn[]) { stack.push({ method: null, path: null, keys: [], fns: fns.flat().filter(f => typeof f === 'function') }); return app; },
    get: route('GET'),
    post: route('POST'),
    put: route('PUT'),
    delete: route('DELETE'),
    listen() { return app; },

    handle(method: string, url: string, headers: Record<string, string>, body: unknown): Promise<Answer> {
      const u = new URL(url, 'http://local');
      const steps: { fn: Fn; params: Record<string, string> }[] = [];
      for (const l of stack) {
        if (l.method && l.method !== method) continue;
        let params: Record<string, string> = {};
        if (l.path) {
          const m = l.path.exec(u.pathname);
          if (!m) continue;
          params = Object.fromEntries(l.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
        }
        for (const fn of l.fns) steps.push({ fn, params });
      }
      return new Promise<Answer>(resolve => {
        let done = false;
        const finish = (status: number, b: unknown) => { if (!done) { done = true; resolve({ status, body: b }); } };
        const req: Request = {
          method, path: u.pathname, url: u.pathname + u.search, query: Object.fromEntries(u.searchParams), params: {},
          headers, body, ip: '127.0.0.1', socket: { remoteAddress: '127.0.0.1' }, get: (h: string) => headers[h.toLowerCase()],
        };
        const res: Response = {
          statusCode: 200,
          status(c: number) { res.statusCode = c; return res; },
          json(b: unknown) { finish(res.statusCode, b); return res; },
          send(b: unknown) { finish(res.statusCode, b ?? null); return res; },
          sendStatus(c: number) { finish(c, null); return res; },
          end() { finish(res.statusCode, null); return res; },
          header() { return res; }, set() { return res; }, setHeader() { return res; }, type() { return res; },
        };
        let i = 0;
        const next = (err?: unknown): void => {
          if (done) return;
          const step = steps[i++];
          if (!step) { finish(err ? 500 : 404, { error: err ? 'server error' : 'not found' }); return; }
          const errorHandler = step.fn.length === 4;
          if (!!err !== errorHandler) { next(err); return; }
          req.params = step.params;
          try {
            const r = errorHandler ? step.fn(err, req, res, next) : step.fn(req, res, next);
            if (r && typeof r.then === 'function') r.catch((e: unknown) => { console.error(e); next(e); });
          } catch (e) { console.error(e); next(e); }
        };
        next();
      });
    },
  };
  current = app;
  return app;
}

express.json = (_opts?: unknown) => (_req: unknown, _res: unknown, next: Fn) => next();

let current: ReturnType<typeof express> | null = null;
export const theApp = () => current;
export default express;
