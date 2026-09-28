import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { Link, Navigate } from "react-router";
import api from "../api/api.js";
import { useAuth } from "../auth/AuthContext.js";
import { createKeyBundle } from "../crypto/keys.js";
import { KeyRoundIcon } from "lucide-react";
import AuthCard, { SubmitButton } from "../components/AuthCard.jsx";
import PageMeta from "../components/PageMeta.jsx";
import FormField, { PasswordInput } from "../components/FormField.jsx";
import StateSelect from "../components/StateSelect.jsx";
import GoogleButton from "../components/GoogleButton.jsx";
import { useProviders } from "../lib/providers.js";
import { Button } from "@/components/ui/button";

const FIELD_ORDER = ["name", "username", "email", "password", "state"];

// Two steps: the details, then the 6-digit code emailed to the address (a real
// inbox behind every account; server: emailCode.service.js). The keys are made
// only at the end, from the password, in the browser.
const Register = () => {
  const [form, setForm] = useState({ name: "", username: "", email: "", password: "", state: "" });
  const [step, setStep] = useState("details"); // "details" | "code"
  const [code, setCode] = useState("");
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  // Per-field messages from the server ({ username: "...", code: "..." })
  const [fieldErrors, setFieldErrors] = useState({});
  // Messages that belong to no single field (e.g. "Username already exists")
  const [formError, setFormError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { currentUser, login } = useAuth();
  const providers = useProviders();

  // The "Send a new code" countdown.
  useEffect(() => {
    if (step !== "code" || now >= resendAt) return;
    const timer = setTimeout(() => setNow(Date.now()), 1000);
    return () => clearTimeout(timer);
  }, [step, now, resendAt]);

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  // flushSync: render the messages now, then move focus to the first wrong
  // field, so a screen reader reads its label and its error.
  const showErrors = (errors) => {
    flushSync(() => setFieldErrors(errors));
    const firstInvalid = [...FIELD_ORDER, "code"].find((field) => errors[field]);
    if (firstInvalid) document.getElementById(firstInvalid)?.focus();
  };

  const sendCode = async () => {
    const res = await api.post("/users/email-code", { email: form.email });
    setResendAt(Date.now() + (res.data.resendAfter ?? 60) * 1000);
    setNow(Date.now());
  };

  const createAccount = async (emailCode) => {
    // End-to-end encryption: the key pair is created here in the browser. Only
    // the public key and the password-locked private key go to the server.
    let keys;
    try {
      keys = await createKeyBundle(form.password);
    } catch (error) {
      // crypto.subtle only exists on HTTPS or localhost.
      console.error("Could not create encryption keys:", error);
      setFormError("This browser could not create encryption keys. Please use an up-to-date browser over HTTPS.");
      return;
    }
    try {
      await api.post("/users", { ...form, ...(emailCode === undefined ? {} : { code: emailCode }), ...keys });
      // Registration doesn't start a session, so log in with the same details
      // (this also unlocks and stores the new private key).
      await login(form.username, form.password);
    } catch (error) {
      const data = error.response?.data;
      if (data?.errors?.code) return showErrors(data.errors);
      // Anything else is about the details: back to them.
      flushSync(() => setStep("details"));
      if (data?.errors) showErrors(data.errors);
      else setFormError(data?.message ?? "Could not reach the server. Please try again.");
    }
  };

  const handleDetails = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setFieldErrors({});
    setFormError("");
    // A server without email codes (only ever the test setup) creates the account at once.
    if (providers?.emailCode === false) {
      await createAccount(undefined);
      setIsSubmitting(false);
      return;
    }
    try {
      await sendCode();
      setCode("");
      setStep("code");
    } catch (error) {
      const data = error.response?.data;
      if (data?.errors) showErrors(data.errors);
      else setFormError(data?.message ?? "Could not reach the server. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCode = async (e) => {
    e.preventDefault();
    setFieldErrors({});
    setFormError("");
    if (!/^\d{6}$/.test(code.trim())) return showErrors({ code: "Enter the 6-digit code from the email" });
    setIsSubmitting(true);
    await createAccount(code.trim());
    setIsSubmitting(false);
  };

  const resend = async () => {
    setFieldErrors({});
    setFormError("");
    try {
      await sendCode();
      setCode("");
    } catch (error) {
      setFormError(error.response?.data?.message ?? "Could not reach the server. Please try again.");
    }
  };

  // Logged in (already, or just now): the chat is the next stop.
  if (currentUser) {
    return <Navigate to="/chat" replace />;
  }

  const waitSeconds = Math.max(0, Math.ceil((resendAt - now) / 1000));
  const alert = formError ? (
    <p role="alert" className="border border-destructive-foreground/40 px-3 py-2 text-sm text-destructive-foreground">
      {formError}
    </p>
  ) : null;

  if (step === "code") {
    return (
      <AuthCard
        title="Check your email"
        tagline={["From Kashmir", "to Kanyakumari."]}
        description={`We sent a 6-digit code to ${form.email.trim()}. It works for 10 minutes. Not there? Look in Spam or Promotions.`}
        footer={
          <>
            Wrong address?{" "}
            <Button variant="link" className="h-auto p-0 text-foreground underline sm:h-auto" onClick={() => setStep("details")}>
              Change your details
            </Button>
          </>
        }
      >
        <PageMeta title="Create account" />
        <form onSubmit={handleCode} noValidate className="space-y-6">
          {alert}
          <FormField id="code" label="Code from the email" error={fieldErrors.code}>
            {(props) => (
              <input
                {...props}
                name="code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                className="field font-mono text-2xl tracking-[0.4em]"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              />
            )}
          </FormField>
          <SubmitButton loading={isSubmitting}>Create account</SubmitButton>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {waitSeconds > 0 ? (
              `You can ask for a new code in ${waitSeconds} s.`
            ) : (
              <Button variant="link" className="h-auto p-0 text-foreground underline sm:h-auto" onClick={resend}>
                Send a new code
              </Button>
            )}
          </p>
        </form>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Create your account"
      tagline={["From Kashmir", "to Kanyakumari."]}
      description="Your messages are end-to-end encrypted: only you and the people you talk to can read them."
      footer={
        <>
          Already have an account? <Link to="/login">Log in</Link>
        </>
      }
    >
      <PageMeta title="Create account" />
      <GoogleButton />
      {providers && !providers.emailSignup ? (
        <p role="status" className="border-l-2 border-brand pl-4 text-sm">
          Sign-up with email is paused right now. Use Continue with Google above.
        </p>
      ) : (
        <form onSubmit={handleDetails} noValidate className="space-y-6">
          {alert}

          {/* Always sent, also empty: the server then says the name is missing. */}
          <FormField id="name" label="Name" hint="Shown in chats. Any language, up to 40 characters." error={fieldErrors.name}>
            {(props) => (
              <input {...props} name="name" type="text" className="field" autoComplete="name" maxLength={40} value={form.name} onChange={handleChange} />
            )}
          </FormField>

          <FormField
            id="username"
            label="Username"
            hint="How people find you. 3–30 characters: letters, numbers, dots and underscores; starts with a letter or number."
            error={fieldErrors.username}
          >
            {(props) => (
              <input
                {...props}
                name="username"
                type="text"
                className="field"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                value={form.username}
                onChange={handleChange}
              />
            )}
          </FormField>

          <FormField id="email" label="Email" error={fieldErrors.email}>
            {(props) => (
              <input
                {...props}
                name="email"
                type="email"
                className="field"
                autoComplete="email"
                value={form.email}
                onChange={handleChange}
              />
            )}
          </FormField>

          <FormField
            id="password"
            label="Password"
            hint="At least 8 characters. A short phrase is easy to remember and hard to guess."
            error={fieldErrors.password}
          >
            {(props) => (
              <PasswordInput {...props} name="password" autoComplete="new-password" value={form.password} onChange={handleChange} />
            )}
          </FormField>

          {/* The password is also the key to the messages: say so before it is chosen. */}
          <div className="flex gap-3 border-y border-border py-4 text-sm">
            <KeyRoundIcon aria-hidden="true" strokeWidth={1.4} className="mt-0.5 size-4 shrink-0 text-brand" />
            <p>
              <strong className="font-semibold">Don&apos;t lose your password.</strong> It also unlocks your
              encrypted messages. If you forget it, they can&apos;t be recovered, not even by OpenChat.
            </p>
          </div>

          <FormField id="state" label="Your state" error={fieldErrors.state}>
            {(props) => <StateSelect {...props} name="state" value={form.state} onChange={handleChange} />}
          </FormField>

          <SubmitButton loading={isSubmitting}>{providers?.emailCode === false ? "Create account" : "Continue"}</SubmitButton>
        </form>
      )}
    </AuthCard>
  );
};

export default Register;
