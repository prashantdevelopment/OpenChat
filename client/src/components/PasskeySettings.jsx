import { useEffect, useState } from "react";
import { FingerprintIcon } from "lucide-react";
import { useAuth } from "../auth/AuthContext.js";
import { unlockPrivateKey } from "../crypto/keys.js";
import { canUsePasskeys, createPasskeyCopy, forgetPasskey } from "../crypto/passkeys.js";
import { deletePasskey, fetchPasskeys, passkeyProblem, savePasskey } from "../lib/passkeys.js";
import { formatFullDateTime } from "../lib/time.js";
import FormField, { PasswordInput } from "./FormField.jsx";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "@/components/ui/dialog";
import { toastManager } from "@/components/ui/toast";

// Settings: "Unlock with fingerprint or face" (step 79). The devices that can
// unlock this account's messages with a passkey, adding this one (after the
// password, which opens the key once to lock a passkey copy of it), removing
// one. The password always works too.
const PasskeySettings = () => {
  const { currentUser } = useAuth();
  const passwordName = currentUser.hasPassword === false ? "encryption password" : "password";
  const [passkeys, setPasskeys] = useState(null); // null while loading
  const [loadError, setLoadError] = useState(null);
  const [adding, setAdding] = useState(false);
  const [password, setPassword] = useState("");
  const [addError, setAddError] = useState("");
  const [busy, setBusy] = useState(null); // "add" or a passkey id

  useEffect(() => {
    let ignore = false;
    fetchPasskeys()
      .then((list) => !ignore && setPasskeys(list))
      .catch(() => !ignore && setLoadError("Couldn't load your devices. Check your connection and reload the page."));
    return () => {
      ignore = true;
    };
  }, []);

  const openAdding = (open) => {
    setAdding(open);
    setPassword("");
    setAddError("");
  };

  const add = async (e) => {
    e.preventDefault();
    setAddError("");
    setBusy("add");
    try {
      // The password first: no passkey is made on the device for nothing.
      try {
        await unlockPrivateKey(currentUser.encryptedPrivateKey, password);
      } catch {
        setAddError(`Incorrect ${passwordName}. Please try again.`);
        return;
      }
      let copy;
      try {
        copy = await createPasskeyCopy({ user: currentUser, encryptedPrivateKey: currentUser.encryptedPrivateKey, password, existing: passkeys });
      } catch (error) {
        setAddError(passkeyProblem(error.reason, passwordName));
        return;
      }
      try {
        const saved = await savePasskey(copy);
        setPasskeys((list) => [...list, saved]);
      } catch (error) {
        forgetPasskey(copy.credentialId);
        setAddError(error.response?.data?.message ?? "Could not reach the server. Please try again.");
        return;
      }
      openAdding(false);
      toastManager.add({ type: "success", title: "Done: this device unlocks with fingerprint or face", description: `Your ${passwordName} still works everywhere.` });
    } finally {
      setBusy(null);
    }
  };

  const remove = async (passkey) => {
    setBusy(passkey._id);
    try {
      await deletePasskey(passkey._id);
      forgetPasskey(passkey.credentialId);
      setPasskeys((list) => list.filter((item) => item._id !== passkey._id));
      toastManager.add({ title: `${passkey.name} removed`, description: `It unlocks with the ${passwordName} again.` });
    } catch (error) {
      toastManager.add({ type: "error", title: "Couldn't remove it", description: error.response?.data?.message ?? "Check your connection and try again." });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-8 border-t border-border pt-6">
      <h3 className="font-medium">Unlock with fingerprint or face</h3>
      <p className="mt-1 max-w-xl text-sm text-muted-foreground">
        On a new login or after clearing the browser, unlock your messages with this device&apos;s fingerprint, face or screen lock instead of typing
        your {passwordName}. The secret stays in the device: OpenChat never sees it.
      </p>
      {loadError ? (
        <p role="alert" className="mt-3 text-sm text-destructive-foreground">
          {loadError}
        </p>
      ) : passkeys === null ? (
        <p role="status" className="mt-3 text-sm text-muted-foreground">
          Loading...
        </p>
      ) : (
        <>
          {passkeys.length ? (
            <ul aria-label="Devices that unlock with a passkey" className="mt-3 divide-y divide-border border-y border-border">
              {passkeys.map((passkey) => (
                <li key={passkey._id} className="flex items-center gap-3 py-3">
                  <FingerprintIcon aria-hidden="true" strokeWidth={1.4} className="size-5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{passkey.name}</span>
                    <span className="block text-xs text-muted-foreground">Added {formatFullDateTime(passkey.createdAt)}</span>
                  </span>
                  <Button variant="outline" loading={busy === passkey._id} onClick={() => remove(passkey)} className="h-11 rounded-full border-foreground/25 px-5 sm:h-11">
                    Remove<span className="sr-only"> {passkey.name}</span>
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
          {canUsePasskeys() ? (
            <Button variant="outline" onClick={() => openAdding(true)} className="mt-4 h-11 rounded-full border-foreground px-6 sm:h-11">
              <FingerprintIcon aria-hidden="true" strokeWidth={1.4} />
              Add this device
            </Button>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">This browser can&apos;t use passkeys.</p>
          )}
        </>
      )}

      <Dialog open={adding} onOpenChange={openAdding}>
        <DialogPopup>
          <form onSubmit={add}>
            <DialogHeader>
              <DialogTitle className="font-heading text-3xl font-normal">Unlock with fingerprint or face</DialogTitle>
              <DialogDescription>
                Enter your {passwordName} once. Then your device asks for your fingerprint, face or screen lock to make a passkey for OpenChat.
              </DialogDescription>
            </DialogHeader>
            <DialogPanel className="space-y-4">
              {addError ? (
                <p role="alert" className="border border-destructive-foreground/40 px-3 py-2 text-sm text-destructive-foreground">
                  {addError}
                </p>
              ) : null}
              <input type="text" name="username" autoComplete="username" value={currentUser.username} readOnly hidden />
              <FormField id="passkey-password" label={passwordName === "password" ? "Password" : "Encryption password"}>
                {(props) => <PasswordInput {...props} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
              </FormField>
            </DialogPanel>
            <DialogFooter>
              <DialogClose render={<Button type="button" variant="outline" className="min-h-[44px] rounded-full px-5" />}>Cancel</DialogClose>
              <Button type="submit" className="min-h-[44px] rounded-full px-5" loading={busy === "add"} disabled={!password}>
                Continue
              </Button>
            </DialogFooter>
          </form>
        </DialogPopup>
      </Dialog>
    </div>
  );
};

export default PasskeySettings;
