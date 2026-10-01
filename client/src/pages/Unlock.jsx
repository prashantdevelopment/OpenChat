import { useEffect, useState } from "react";
import { FingerprintIcon } from "lucide-react";
import { useAuth } from "../auth/AuthContext.js";
import AuthCard, { SubmitButton } from "../components/AuthCard.jsx";
import PageMeta from "../components/PageMeta.jsx";
import FormField, { PasswordInput } from "../components/FormField.jsx";
import { Button } from "@/components/ui/button";
import { displayName } from "../lib/people.js";
import { canUsePasskeys } from "../crypto/passkeys.js";
import { fetchPasskeys, passkeyProblem } from "../lib/passkeys.js";

// Shown instead of the app when the user is logged in (valid cookie) but the
// private key is not available on this device, e.g. after clearing site data.
// Only the password can unlock it (or a passkey made for it on one of the
// user's devices, step 79): the server cannot, by design.
const Unlock = () => {
  const { currentUser, unlock, unlockWithPasskey, logout } = useAuth();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isUnlocking, setIsUnlocking] = useState(false);
  // This account's passkey copies (none: only the password is offered).
  const [passkeys, setPasskeys] = useState([]);
  const [isUsingPasskey, setIsUsingPasskey] = useState(false);
  // Accounts made with Google lock their key with a separate encryption password.
  const passwordName = currentUser.hasPassword === false ? "encryption password" : "password";

  useEffect(() => {
    if (!canUsePasskeys() || !currentUser.encryptedPrivateKey) return;
    let ignore = false;
    fetchPasskeys()
      .then((list) => !ignore && setPasskeys(list))
      .catch(() => {}); // the password still works
    return () => {
      ignore = true;
    };
  }, [currentUser.encryptedPrivateKey]);

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
      setError(`Incorrect ${passwordName}. Please try again.`);
      setIsUnlocking(false);
    }
  };

  const handlePasskey = async () => {
    setError("");
    setIsUsingPasskey(true);
    try {
      await unlockWithPasskey(passkeys);
    } catch (passkeyError) {
      setError(passkeyProblem(passkeyError.reason, passwordName));
      setIsUsingPasskey(false);
    }
  };

  return (
    <AuthCard
      title="Unlock your messages"
      tagline={["Your key", "stays with you."]}
      description={`Hi ${displayName(currentUser)}, your messages are end-to-end encrypted. ${passkeys.length ? `Use your fingerprint, face or ${passwordName}` : `Enter your ${passwordName}`} to unlock them on this device.`}
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
      {error ? (
        <p role="alert" className="mb-6 border border-destructive-foreground/40 px-3 py-2 text-sm text-destructive-foreground">
          {error}
        </p>
      ) : null}
      {passkeys.length ? (
        <>
          <Button className="h-12 w-full gap-3 rounded-full text-[0.9375rem] sm:h-12" loading={isUsingPasskey} onClick={handlePasskey}>
            <FingerprintIcon aria-hidden="true" strokeWidth={1.5} />
            Unlock with fingerprint or face
          </Button>
          <p className="my-6 flex items-center gap-3 font-mono text-[11px] tracking-[0.16em] text-muted-foreground uppercase">
            <span aria-hidden="true" className="h-px flex-1 bg-border" />
            or with your {passwordName}
            <span aria-hidden="true" className="h-px flex-1 bg-border" />
          </p>
        </>
      ) : null}
      <form onSubmit={handleSubmit} className="space-y-6">

        <FormField id="unlock-password" label={passwordName === "password" ? "Password" : "Encryption password"}>
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
        <strong className="font-semibold text-foreground">Forgot your {passwordName}?</strong> Your messages are
        end-to-end encrypted, so nobody, not even OpenChat, can recover them without it. You can log out and
        create a new account, but the old messages will stay locked.
      </p>
    </AuthCard>
  );
};

export default Unlock;
