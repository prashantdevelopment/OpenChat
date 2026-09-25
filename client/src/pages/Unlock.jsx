import { useState } from "react";
import { useAuth } from "../auth/AuthContext.js";

// Shown instead of the app when the user is logged in (valid cookie) but the
// private key is not available on this device, e.g. after clearing site data.
// Only the password can unlock it: the server cannot, by design.
const Unlock = () => {
  const { currentUser, unlock, logout } = useAuth();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isUnlocking, setIsUnlocking] = useState(false);

  // Accounts created before end-to-end encryption existed have no keys.
  if (!currentUser.encryptedPrivateKey) {
    return (
      <div>
        <h1>Encryption is not set up</h1>
        <p role="alert">
          This account was created before OpenChat had end-to-end encryption, so it has no keys.
          Please log out and create a new account.
        </p>
        <button type="button" onClick={logout}>Log out</button>
      </div>
    );
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setIsUnlocking(true);
    try {
      await unlock(password);
    } catch {
      // AES-GCM refuses to open the key with a wrong password.
      setError("Incorrect password. Please try again.");
      setIsUnlocking(false);
    }
  };

  return (
    <div>
      <h1>Unlock your messages</h1>
      <p>
        Hi {currentUser.username}, your messages are end-to-end encrypted. Enter your password to
        unlock them on this device.
      </p>

      <form onSubmit={handleSubmit}>
        {error ? <p role="alert">{error}</p> : null}
        <label htmlFor="unlock-password">Password</label>
        <br />
        <input
          id="unlock-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button type="submit" disabled={isUnlocking}>
          {isUnlocking ? "Unlocking..." : "Unlock"}
        </button>
      </form>

      <p>
        Not you? <button type="button" onClick={logout}>Log out</button>
      </p>
    </div>
  );
};

export default Unlock;
