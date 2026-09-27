import axios from "axios";

// Vite only exposes env variables that start with VITE_ to browser code.
// Never put secrets here: everything in the client bundle is public.
// The server's address. Empty = the same site that serves this page (the
// production setup: one server for the API and the app).
export const API_URL = import.meta.env.VITE_API_URL;

if (API_URL === undefined) {
  throw new Error("VITE_API_URL is not defined. Copy client/.env.example to client/.env");
}

// One place for the base URL and cookie settings, so every request
// sends the httpOnly auth cookie without repeating withCredentials.
const api = axios.create({
  baseURL: `${API_URL}/api`,
  withCredentials: true,
});

// The server's answers when the session itself is gone (expired, or ended by
// logging out in another tab). Other 401s, like a wrong current password in
// Settings, are ordinary errors. Keep in sync with server/src/session.js and
// middleware/auth.middleware.js.
const SESSION_GONE = ["Invalid or expired token", "Authentication token is missing"];
let onSessionGone = null;
export const setSessionGoneHandler = (handler) => {
  onSessionGone = handler;
};
api.interceptors.response.use(undefined, (error) => {
  if (error.response?.status === 401 && SESSION_GONE.includes(error.response.data?.message)) onSessionGone?.();
  return Promise.reject(error);
});

export default api;
