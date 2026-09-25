import { startTransition, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import api from "../api/api.js";
import socket from "../socket/socket.js";
import { unlockPrivateKey } from "../crypto/keys.js";
import { clearKeys, loadKey, saveKey } from "../crypto/keyStore.js";
import { AuthContext } from "./AuthContext.js";

const AuthProvider = ({ children }) => {
  // null = logged out. "Logged in" is derived from this, not stored separately.
  const [currentUser, setCurrentUser] = useState(null);
  // The unlocked (non-extractable) private key; null until it is unlocked.
  // Logged in without a key = ProtectedRoute shows the unlock screen.
  const [privateKey, setPrivateKey] = useState(null);
  // True until we know whether the httpOnly cookie still holds a valid session.
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const isLoggedIn = currentUser !== null;
  const navigate = useNavigate();

  // Restore the session on page load. JavaScript cannot read the httpOnly
  // cookie, so we ask the server who we are; the key comes from IndexedDB.
  useEffect(() => {
    const restoreSession = async () => {
      try {
        const response = await api.get("/auth/me");
        const user = response.data.user;
        // IndexedDB can be empty (cleared site data) or blocked (some private
        // windows): then the unlock screen asks for the password.
        const key = await loadKey(user._id).catch(() => null);
        setPrivateKey(key);
        setCurrentUser(user);
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

  // Unlocks the private key with the password and remembers it for refreshes.
  // Throws if the password is wrong.
  const unlockAndStore = async (user, password) => {
    const key = await unlockPrivateKey(user.encryptedPrivateKey, password);
    await saveKey(user._id, key).catch((error) => console.error("Could not store the key:", error));
    return key;
  };

  // Used by Login and Register. The password is needed twice: the server
  // checks it, and the browser uses it to unlock the private key (the server
  // never can).
  const login = async (identifier, password) => {
    const response = await api.post("/auth/login", { identifier, password });
    const user = response.data.user;

    let key = null;
    if (user.encryptedPrivateKey) {
      key = await unlockAndStore(user, password).catch((error) => {
        // Should not happen with the right password; the unlock screen takes over.
        console.error("Could not unlock the private key:", error);
        return null;
      });
    }
    // Both together, so the unlock screen never flashes after a normal login.
    setPrivateKey(key);
    setCurrentUser(user);
  };

  // Used by the unlock screen (logged in, key not available on this device).
  const unlock = async (password) => {
    setPrivateKey(await unlockAndStore(currentUser, password));
  };

  const logout = async () => {
    try {
      await api.post("/auth/logout");
    } catch (error) {
      console.error("Error logging out:", error);
      return;
    }
    // The next person on this browser must not find this user's key.
    await clearKeys().catch((error) => console.error("Could not clear the stored key:", error));
    // Go to /login directly, so the next person to log in on this browser
    // doesn't get sent back to the previous user's conversation.
    // React Router runs navigations as transitions; putting both updates in
    // one transition makes React apply them in the same render. Otherwise the
    // user becomes null first, and ProtectedRoute would remember the old URL.
    startTransition(() => {
      navigate("/login", { replace: true });
      setCurrentUser(null);
      setPrivateKey(null);
    });
  };

  if (isCheckingSession) {
    return <p>Loading...</p>;
  }

  return (
    <AuthContext value={{ currentUser, privateKey, login, unlock, logout }}>
      {children}
    </AuthContext>
  );
};

export default AuthProvider;
