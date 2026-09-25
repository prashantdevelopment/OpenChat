import { startTransition, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import api from "../api/api.js";
import socket from "../socket/socket.js";
import { AuthContext } from "./AuthContext.js";

const AuthProvider = ({ children }) => {
  // null = logged out. "Logged in" is derived from this, not stored separately.
  const [currentUser, setCurrentUser] = useState(null);
  // True until we know whether the httpOnly cookie still holds a valid session.
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const isLoggedIn = currentUser !== null;
  const navigate = useNavigate();

  // Restore the session on page load. JavaScript cannot read the httpOnly
  // cookie, so we ask the server who we are.
  useEffect(() => {
    const restoreSession = async () => {
      try {
        const response = await api.get("/auth/me");
        setCurrentUser(response.data.user);
      } catch (error) {
        // 401 just means there is no valid session: show the login page.
        if (error.response?.status !== 401) {
          console.error("Error restoring session:", error);
        }
      } finally {
        setIsCheckingSession(false);
      }
    };

    restoreSession();
  }, []);

  // The socket lives exactly as long as the session.
  useEffect(() => {
    if (isLoggedIn) {
      socket.connect();
    }
    return () => {
      socket.disconnect();
    };
  }, [isLoggedIn]);

  const logout = async () => {
    try {
      await api.post("/auth/logout");
    } catch (error) {
      console.error("Error logging out:", error);
      return;
    }
    // Go to /login directly, so the next person to log in on this browser
    // doesn't get sent back to the previous user's conversation.
    // React Router runs navigations as transitions; putting both updates in
    // one transition makes React apply them in the same render. Otherwise the
    // user becomes null first, and ProtectedRoute would remember the old URL.
    startTransition(() => {
      navigate("/login", { replace: true });
      setCurrentUser(null);
    });
  };

  if (isCheckingSession) {
    return <p>Loading...</p>;
  }

  return (
    <AuthContext value={{ currentUser, setCurrentUser, logout }}>
      {children}
    </AuthContext>
  );
};

export default AuthProvider;
