import { startTransition, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import api, { setSessionGoneHandler } from "../api/api.js";
import socket from "../socket/socket.js";
import { unlockPrivateKey } from "../crypto/keys.js";
import { clearKeys, loadKey, saveKey } from "../crypto/keyStore.js";
import { AuthContext } from "./AuthContext.js";
import { Spinner } from "@/components/ui/spinner";

const AuthProvider = ({ children }) => {
  // null = logged out. "Logged in" is derived from this, not stored separately.
  const [currentUser, setCurrentUser] = useState(null);
  // The unlocked (non-extractable) private key; null until it is unlocked.
  // Logged in without a key = ProtectedRoute shows the unlock screen.
  const [privateKey, setPrivateKey] = useState(null);
  // True until we know whether the httpOnly cookie still holds a valid session.
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  // The session ended by itself (expired, or logged out elsewhere): the login
  // page says so.
  const [sessionEnded, setSessionEnded] = useState(false);
  // While logging out: the server ends the session and tells this tab's
  // socket too; that is not "your session ended".
  const loggingOut = useRef(false);
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

  // The server no longer accepts this session: after an hour, or after
  // logging out in another tab of this browser. Back to the login page (it
  // remembers where the user was). The stored key stays: it only ever
  // unlocks for this account, after its password.
  useEffect(() => {
    if (!isLoggedIn) return;
    const endSession = () => {
      if (loggingOut.current) return;
      setSessionEnded(true);
      setCurrentUser(null);
      setPrivateKey(null);
    };
    const onConnectError = (error) => {
      if (/authentication token/i.test(error.message)) endSession();
    };
    setSessionGoneHandler(endSession);
    socket.on("sessionExpired", endSession);
    socket.on("connect_error", onConnectError);
    return () => {
      setSessionGoneHandler(null);
      socket.off("sessionExpired", endSession);
      socket.off("connect_error", onConnectError);
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
    setSessionEnded(false);
    loggingOut.current = false;
  };

  // Used by the unlock screen (logged in, key not available on this device).
  const unlock = async (password) => {
    setPrivateKey(await unlockAndStore(currentUser, password));
  };

  const logout = async () => {
    loggingOut.current = true;
    try {
      await api.post("/auth/logout");
    } catch (error) {
      console.error("Error logging out:", error);
      loggingOut.current = false;
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
      setSessionEnded(false);
    });
  };

  // After a profile or password change. Merged, because the server's answer
  // to a profile update leaves out the locked private key.
  const updateCurrentUser = (changes) => setCurrentUser((user) => ({ ...user, ...changes }));

  if (isCheckingSession) {
    return (
      <div className="flex h-dvh items-center justify-center bg-background text-muted-foreground">
        <Spinner className="size-6" aria-label="Loading OpenChat" />
      </div>
    );
  }

  return (
    <AuthContext value={{ currentUser, privateKey, sessionEnded, login, unlock, logout, updateCurrentUser }}>
      {children}
    </AuthContext>
  );
};

export default AuthProvider;
