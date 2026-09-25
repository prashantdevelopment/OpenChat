import { createContext, use } from "react";

// Holds { currentUser, privateKey, login, unlock, logout } for the whole app.
// The provider lives in AuthProvider.jsx.
export const AuthContext = createContext(null);

export const useAuth = () => {
  const auth = use(AuthContext);
  if (!auth) {
    throw new Error("useAuth must be used inside <AuthProvider>");
  }
  return auth;
};
