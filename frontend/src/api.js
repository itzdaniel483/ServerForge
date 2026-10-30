// One place for the login token, axios and the live-log socket (claude, 2026-10-30).
// The backend now refuses sockets without a token, so every component shares this socket.
import axios from 'axios';
import { io } from 'socket.io-client';
import { WS_URL } from './config';

let socket = null;

export function setToken(token) {
    if (token) axios.defaults.headers.common.Authorization = `Bearer ${token}`;
    else delete axios.defaults.headers.common.Authorization;
    if (socket) { socket.disconnect(); socket = null; }
}

export function getSocket() {
    if (!socket) {
        socket = io(WS_URL, { auth: cb => cb({ token: localStorage.getItem('token') || '' }) });
    }
    return socket;
}

// End the session and show `notice` on the sign-in screen (e.g. after a password change,
// which makes the server refuse every older token, including this browser's).
export function signOut(notice) {
    if (notice) sessionStorage.setItem('loginNotice', notice);
    window.dispatchEvent(new Event('serverforge:signout'));
}

// SteamCMD output contains terminal colour codes; strip them for plain <pre> logs.
// eslint-disable-next-line no-control-regex
export const stripAnsi = text => String(text).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\x1b/g, '');

// Remote-node failures carry a stable code; these get plain words. OUTCOME_UNKNOWN means a change may
// or may not have happened, so it never suggests simply trying again (multi-node UI contract item 3).
const NODE_ERRORS = {
    NODE_OFFLINE: 'That machine is offline. Try again when it reconnects.',
    NODE_UNKNOWN: 'That machine is no longer joined to this panel.',
    ACTION_UNSUPPORTED: "That machine can't do this yet.",
    OUTCOME_UNKNOWN: 'We lost contact while doing this. Check the server before trying again.',
};
export const errorText = err => NODE_ERRORS[err?.response?.data?.code] || err?.response?.data?.error || err?.message || 'Something went wrong';
