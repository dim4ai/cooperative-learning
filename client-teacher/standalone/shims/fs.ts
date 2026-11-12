// 'fs': there's no machine to read the load of (server/src/loadSampler.ts then gives nothing)
export function readFileSync(): never { throw new Error('no file system in the page'); }
export default { readFileSync };
