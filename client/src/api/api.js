import axios from "axios";

// Vite only exposes env variables that start with VITE_ to browser code.
// Never put secrets here: everything in the client bundle is public.
export const API_URL = import.meta.env.VITE_API_URL;

if (!API_URL) {
  throw new Error("VITE_API_URL is not defined. Copy client/.env.example to client/.env");
}

// One place for the base URL and cookie settings, so every request
// sends the httpOnly auth cookie without repeating withCredentials.
const api = axios.create({
  baseURL: `${API_URL}/api`,
  withCredentials: true,
});

export default api;
