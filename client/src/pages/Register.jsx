import { useState } from "react";
import { flushSync } from "react-dom";
import { Link, Navigate } from "react-router";
import api from "../api/api.js";
import { useAuth } from "../auth/AuthContext.js";
import { createKeyBundle } from "../crypto/keys.js";
import { KeyRoundIcon } from "lucide-react";
import AuthCard, { SubmitButton } from "../components/AuthCard.jsx";
import FormField, { PasswordInput } from "../components/FormField.jsx";
import StateSelect from "../components/StateSelect.jsx";

const FIELD_ORDER = ["username", "email", "password", "state"];

const Register = () => {
  const [form, setForm] = useState({ username: "", email: "", password: "", state: "" });
  // Per-field messages from the server ({ username: "...", state: "..." })
  const [fieldErrors, setFieldErrors] = useState({});
  // Messages that belong to no single field (e.g. "Username already exists")
  const [formError, setFormError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { currentUser, login } = useAuth();

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setFieldErrors({});
    setFormError("");

    // End-to-end encryption: the key pair is created here in the browser. Only
    // the public key and the password-locked private key go to the server.
    let keys;
    try {
      keys = await createKeyBundle(form.password);
    } catch (error) {
      // crypto.subtle only exists on HTTPS or localhost.
      console.error("Could not create encryption keys:", error);
      setFormError("This browser could not create encryption keys. Please use an up-to-date browser over HTTPS.");
      setIsSubmitting(false);
      return;
    }

    try {
      await api.post("/users", { ...form, ...keys });
      // Registration doesn't start a session, so log in with the same details
      // (this also unlocks and stores the new private key).
      await login(form.username, form.password);
    } catch (error) {
      const data = error.response?.data;
      if (data?.errors) {
        // flushSync: render the messages now, then move focus to the first
        // wrong field, so a screen reader reads its label and its error.
        flushSync(() => setFieldErrors(data.errors));
        const firstInvalid = FIELD_ORDER.find((field) => data.errors[field]);
        if (firstInvalid) document.getElementById(firstInvalid)?.focus();
      } else {
        setFormError(data?.message ?? "Could not reach the server. Please try again.");
      }
      setIsSubmitting(false);
    }
  };

  // Logged in (already, or just now): the chat is the next stop.
  if (currentUser) {
    return <Navigate to="/chat" replace />;
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
      <form onSubmit={handleSubmit} noValidate className="space-y-6">
        {formError ? (
          <p role="alert" className="border border-destructive-foreground/40 px-3 py-2 text-sm text-destructive-foreground">
            {formError}
          </p>
        ) : null}

        <FormField
          id="username"
          label="Username"
          hint="3–30 characters: letters, numbers, dots and underscores. Must start with a letter or number."
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

        <SubmitButton loading={isSubmitting}>Create account</SubmitButton>
      </form>
    </AuthCard>
  );
};

export default Register;
