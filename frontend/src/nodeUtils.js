// Multi-node helpers (claude, phase 2 2026-10-30). Servers on other machines carry nodeId/nodeName/
// nodeOs/nodeOnline/nodeHost and an `actions` allow-list from the hub; local servers have none of these
// and keep every control, exactly as before nodes existed.
export const isRemote = s => !!s?.nodeId && s.nodeId !== 'local';
export const nodeOffline = s => isRemote(s) && s.nodeOnline === false;

// Only show a control if the server's machine supports it right now (UI contract item 2).
export function can(s, action) {
    if (!isRemote(s)) return true;
    if (nodeOffline(s)) return false;
    return Array.isArray(s.actions) && s.actions.includes(action);
}

export const osLabel = os => (os === 'win32' ? 'Windows' : os === 'linux' ? 'Linux' : os === 'darwin' ? 'macOS' : os || 'Unknown');
