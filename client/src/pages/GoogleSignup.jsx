import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { Link, Navigate } from "react-router";
import { KeyRoundIcon } from "lucide-react";
import api from "../api/api.js";
import { useAuth } from "../auth/AuthContext.js";
import { createKeyBundle } from "../crypto/keys.js";
import AuthCard, { SubmitButton } from "../components/AuthCard.jsx";
import PageMeta from "../components/PageMeta.jsx";
import FormField, { PasswordInput } from "../components/FormField.jsx";
import StateSelect from "../components/StateSelect.jsx";

const FIELD_ORDER = ["name", "username", "encryptionPassword", "state"];
const MIN_PASSWORD = 8;

// After "Continue with Google" for someone new (server: google.controller.js):
// Google has vouched for the email; this page picks the name, username and
// state, and the encryption password. Google proves who you are but must never
// hold the key to your messages, so the private key is locked with this
// password, in the browser; it never leaves it.
const GoogleSignup = () => {
  const { currentUser, startSession } = useAuth();
  const [pending, setPending] = useState({ status: "loading" });
  const [form, setForm] = useState({ name: "", username: "", encryptionPassword: "", state: "" });
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let ignore = false;
    api
      .get("/auth/google/pending")
      .then((res) => {
        if (ignore) return;
        if (res.data.kind !== "signup") return setPending({ status: "expired" });
        setPending({ status: "ready", email: res.data.email });
        setForm((f) => ({ ...f, name: res.data.name ?? "", username: res.data.suggestedUsername ?? "" }));
      })
      .catch(() => !ignore && setPending({ status: "expired" }));
    return () => {
      ignore = true;
    };
  }, []);

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const showErrors = (errors) => {
    // flushSync: render the messages, then focus the first wrong field.
    flushSync(() => setFieldErrors(errors));
    const first = FIELD_ORDER.find((field) => errors[field]);
    if (first) document.getElementById(first)?.focus();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFieldErrors({});
    setFormError("");
    // The server never sees this password, so the browser checks its length.
    if (form.encryptionPassword.length < MIN_PASSWORD) {
      showErrors({ encryptionPassword: `At least ${MIN_PASSWORD} characters.` });
      return;
    }
    setIsSubmitting(true);
    let keys;
    try {
      keys = await createKeyBundle(form.encryptionPassword);
    } catch (error) {
      console.error("Could not create encryption keys:", error);
      setFormError("This browser could not create encryption keys. Please use an up-to-date browser over HTTPS.");
      setIsSubmitting(false);
      return;
    }
    try {
      const { name, username, state } = form;
      const res = await api.post("/auth/google/complete", { name, username, state, ...keys });
      await startSession(res.data.user, form.encryptionPassword);
    } catch (error) {
      const data = error.response?.data;
      if (data?.errors) showErrors(data.errors);
      else if (error.response?.status === 409 && /username/i.test(data?.message ?? "")) showErrors({ username: data.message });
      else setFormError(data?.message ?? "Could not reach the server. Please try again.");
      setIsSubmitting(false);
    }
  };

  if (currentUser) return <Navigate to="/chat" replace />;

  if (pending.status !== "ready") {
    return (
      <AuthCard title={pending.status === "loading" ? "One moment…" : "Start again"}>
        <PageMeta title="Create account" noindex />
        {pending.status === "expired" ? (
          <p role="alert" className="text-sm">
            This Google sign-in has expired. <Link to="/login">Continue with Google again</Link>.
          </p>
        ) : (
          <p role="status" className="text-sm text-muted-foreground">
            Loading your Google details…
          </p>
        )}
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Almost there"
      tagline={["From Kashmir", "to Kanyakumari."]}
      description={`Signed in with Google as ${pending.email}. Pick how people see you, and a password for your messages.`}
      footer={
        <>
          Not you? <Link to="/login">Use another account</Link>
        </>
      }
    >
      <PageMeta title="Create account" noindex />
      <form onSubmit={handleSubmit} noValidate className="space-y-6">
        {formError ? (
          <p role="alert" className="border border-destructive-foreground/40 px-3 py-2 text-sm text-destructive-foreground">
            {formError}
          </p>
        ) : null}

        <FormField id="name" label="Name" hint="Shown in chats. Any language, up to 40 characters." error={fieldErrors.name}>
          {(props) => <input {...props} name="name" type="text" className="field" autoComplete="name" maxLength={40} value={form.name} onChange={handleChange} />}
        </FormField>

        <FormField
          id="username"
          label="Username"
          hint="How people find you. 3–30 characters: letters, numbers, dots and underscores; starts with a letter or number."
          error={fieldErrors.username}
        >
          {(props) => (
            <input {...props} name="username" type="text" className="field" autoComplete="username" autoCapitalize="none" spellCheck={false} value={form.username} onChange={handleChange} />
          )}
        </FormField>

        <FormField
          id="encryptionPassword"
          label="Encryption password"
          hint="Locks your messages on your devices. Asked when you sign in on a new device. Google never sees it."
          error={fieldErrors.encryptionPassword}
        >
          {(props) => <PasswordInput {...props} name="encryptionPassword" autoComplete="new-password" value={form.encryptionPassword} onChange={handleChange} />}
        </FormField>

        <div className="flex gap-3 border-y border-border py-4 text-sm">
          <KeyRoundIcon aria-hidden="true" strokeWidth={1.4} className="mt-0.5 size-4 shrink-0 text-brand" />
          <p>
            <strong className="font-semibold">Don&apos;t lose this password.</strong> Only it unlocks your encrypted messages. If you
            forget it, they can&apos;t be recovered, not even by OpenChat or Google.
          </p>
        </div>

        <FormField id="state" label="Your state" error={fieldErrors.state}>
          {(props) => <StateSelect {...props} name="state" value={form.state} onChange={handleChange} />}
        </FormField>

        <SubmitButton loading={isSubmitting}>Create account</SubmitButton>
      </form>
    </AuthCard>
  );
};

export default GoogleSignup;
