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

export const errorText = err => err?.response?.data?.error || err?.message || 'Something went wrong';
