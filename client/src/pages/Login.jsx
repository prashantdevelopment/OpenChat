import { useState } from "react";
import { Link, Navigate, useLocation } from "react-router";
import { useAuth } from "../auth/AuthContext.js";
import AuthCard, { SubmitButton } from "../components/AuthCard.jsx";
import PageMeta from "../components/PageMeta.jsx";
import FormField, { PasswordInput } from "../components/FormField.jsx";
import GoogleButton from "../components/GoogleButton.jsx";
import { toastManager } from "@/components/ui/toast";

// What the Google sign-in's way back (server: google.controller.js) says.
const GOOGLE_NOTES = {
  link: "This email already has an OpenChat account. Log in with its password once to connect Google; after that, Google logs you in.",
  cancelled: "Google sign-in was cancelled.",
  error: "Couldn't sign in with Google. Please try again.",
  taken: "This email's OpenChat account is connected to a different Google account.",
};

const Login = () => {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  // "Keep me logged in": on, like most apps; off on a shared computer.
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState("");
  // Logging in now also unlocks the encryption key (PBKDF2 takes a moment).
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { currentUser, sessionEnded, login } = useAuth();
  const location = useLocation();
  const googleNote = GOOGLE_NOTES[new URLSearchParams(location.search).get("google")];

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      const { linkedGoogle } = await login(identifier, password, remember);
      if (linkedGoogle) toastManager.add({ type: "success", title: "Google is connected", description: "Next time, “Continue with Google” logs you in." });
    } catch (error) {
      setError(error.response?.data?.message ?? "Could not reach the server. Please try again.");
      setIsSubmitting(false);
    }
  };

  // Already logged in (or just logged in): go where the user wanted to go.
  if (currentUser) {
    return <Navigate to={location.state?.from ?? "/chat"} replace />;
  }

  return (
    <AuthCard
      title="Log in"
      description="Welcome back. Your messages are end-to-end encrypted."
      footer={
        <>
          No account yet? <Link to="/register">Create one</Link>
        </>
      }
    >
      <PageMeta title="Log in" />
      <GoogleButton remember={remember} />
      <form onSubmit={handleLogin} className="space-y-6">
        {googleNote && !error ? (
          <p role="status" className="border-l-2 border-brand pl-4 text-sm">
            {googleNote}
          </p>
        ) : null}
        {sessionEnded && !error ? (
          <p role="status" className="border-l-2 border-brand pl-4 text-sm">
            Your session ended. Log in again to carry on where you were.
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="border border-destructive-foreground/40 px-3 py-2 text-sm text-destructive-foreground">
            {error}
          </p>
        ) : null}

        <FormField id="identifier" label="Email or username">
          {(props) => (
            <input
              {...props}
              type="text"
              className="field"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
            />
          )}
        </FormField>

        <FormField id="login-password" label="Password">
          {(props) => (
            <PasswordInput
              {...props}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </FormField>

        <label className="flex cursor-pointer items-start justify-between gap-6">
          <span>
            <span className="block text-sm font-medium">Keep me logged in</span>
            <span id="remember-hint" className="mt-0.5 block text-xs text-muted-foreground">
              Turn off on a shared computer: you&apos;re logged out when the browser closes.
            </span>
          </span>
          <input
            id="remember"
            type="checkbox"
            role="switch"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            aria-describedby="remember-hint"
            className="switch mt-0.5"
          />
        </label>

        <SubmitButton loading={isSubmitting}>Log in</SubmitButton>
      </form>
    </AuthCard>
  );
};

export default Login;
