// The server calls timer.unref() (Node): in the page a timer is a number, and there is nothing to unref.
// Imported first in main.tsx, before the server's code runs
const proto = Number.prototype as unknown as Record<string, unknown>;
for (const m of ['unref', 'ref', 'refresh']) if (!proto[m]) proto[m] = function (this: number) { return this; };
if (!proto.hasRef) proto.hasRef = () => true;


// setImmediate is Node's too (the server drops an ended lesson with it)
const g = globalThis as unknown as Record<string, unknown>;
if (!g.setImmediate) g.setImmediate = (fn: (...a: unknown[]) => void, ...args: unknown[]) => setTimeout(fn, 0, ...args);
export {};
