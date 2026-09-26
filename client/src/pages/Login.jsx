import { useState } from "react";
import { Link, Navigate, useLocation } from "react-router";
import { useAuth } from "../auth/AuthContext.js";
import AuthCard from "../components/AuthCard.jsx";
import FormField, { PasswordInput } from "../components/FormField.jsx";
import { Button } from "@/components/ui/button";

const Login = () => {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  // Logging in now also unlocks the encryption key (PBKDF2 takes a moment).
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { currentUser, login } = useAuth();
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
      <form onSubmit={handleLogin} className="space-y-4">
        {error ? (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground">
            {error}
          </p>
        ) : null}

        <FormField id="identifier" label="Email or username">
          {(props) => (
            <input
              {...props}
              type="text"
              className="w-full"
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

        <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
          Log in
        </Button>
      </form>
    </AuthCard>
  );
};

export default Login;
