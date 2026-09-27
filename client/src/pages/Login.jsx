import { useState } from "react";
import { Link, Navigate, useLocation } from "react-router";
import { useAuth } from "../auth/AuthContext.js";
import AuthCard, { SubmitButton } from "../components/AuthCard.jsx";
import PageMeta from "../components/PageMeta.jsx";
import FormField, { PasswordInput } from "../components/FormField.jsx";

const Login = () => {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  // Logging in now also unlocks the encryption key (PBKDF2 takes a moment).
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { currentUser, sessionEnded, login } = useAuth();
  const location = useLocation();

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      await login(identifier, password);
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
      <form onSubmit={handleLogin} className="space-y-6">
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

        <SubmitButton loading={isSubmitting}>Log in</SubmitButton>
      </form>
    </AuthCard>
  );
};

export default Login;
