import { useState } from "react";
import { useAuth } from "../auth/AuthContext.js";
import AuthCard, { SubmitButton } from "../components/AuthCard.jsx";
import PageMeta from "../components/PageMeta.jsx";
import FormField, { PasswordInput } from "../components/FormField.jsx";
import { Button } from "@/components/ui/button";

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
      <AuthCard title="Encryption is not set up">
        <PageMeta title="Unlock" noindex />
        <p role="alert" className="text-sm">
          This account was created before OpenChat had end-to-end encryption, so it has no keys.
          Please log out and create a new account.
        </p>
        <Button variant="outline" className="mt-6 h-12 w-full rounded-full border-foreground sm:h-12" onClick={logout}>
          Log out
        </Button>
      </AuthCard>
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
    <AuthCard
      title="Unlock your messages"
      tagline={["Your key", "stays with you."]}
      description={`Hi ${currentUser.username}, your messages are end-to-end encrypted. Enter your password to unlock them on this device.`}
      footer={
        <>
          Not you?{" "}
          <Button variant="link" className="h-auto p-0 text-foreground underline sm:h-auto" onClick={logout}>
            Log out
          </Button>
        </>
      }
    >
      <PageMeta title="Unlock" noindex />
      <form onSubmit={handleSubmit} className="space-y-6">
        {error ? (
          <p role="alert" className="border border-destructive-foreground/40 px-3 py-2 text-sm text-destructive-foreground">
            {error}
          </p>
        ) : null}

        <FormField id="unlock-password" label="Password">
          {(props) => (
            <PasswordInput
              {...props}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </FormField>

        <SubmitButton loading={isUnlocking}>Unlock</SubmitButton>
      </form>

      <p className="mt-6 text-sm text-muted-foreground">
        <strong className="font-semibold text-foreground">Forgot your password?</strong> Your messages are
        end-to-end encrypted, so nobody, not even OpenChat, can recover them without it. You can log out and
        create a new account, but the old messages will stay locked.
      </p>
    </AuthCard>
  );
};

export default Unlock;
