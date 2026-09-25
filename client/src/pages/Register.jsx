import { useState } from "react";
import { Link, Navigate } from "react-router";
import api from "../api/api.js";
import { useAuth } from "../auth/AuthContext.js";
import { INDIAN_STATES } from "../../../shared/indian-states.js";

const Register = () => {
  const [form, setForm] = useState({ username: "", email: "", password: "", state: "" });
  // Per-field messages from the server ({ username: "...", state: "..." })
  const [fieldErrors, setFieldErrors] = useState({});
  // Messages that belong to no single field (e.g. "Username already exists")
  const [formError, setFormError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { currentUser, setCurrentUser } = useAuth();

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setFieldErrors({});
    setFormError("");

    try {
      await api.post("/users", form);
      // Registration doesn't start a session, so log in with the same details.
      const response = await api.post("/auth/login", {
        identifier: form.username,
        password: form.password,
      });
      setCurrentUser(response.data.user);
    } catch (error) {
      const data = error.response?.data;
      if (data?.errors) {
        setFieldErrors(data.errors);
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
    <div>
      <h1>Create your account</h1>

      <form onSubmit={handleSubmit} noValidate>
        {formError ? <p role="alert">{formError}</p> : null}

        <p>
          <label htmlFor="username">Username</label>
          <br />
          <input
            id="username"
            name="username"
            type="text"
            autoComplete="username"
            value={form.username}
            onChange={handleChange}
            aria-describedby="username-hint username-error"
          />
          <br />
          <small id="username-hint">8–30 characters: letters, numbers, dots and underscores.</small>
          {fieldErrors.username ? <><br /><small id="username-error" role="alert">{fieldErrors.username}</small></> : null}
        </p>

        <p>
          <label htmlFor="email">Email</label>
          <br />
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            value={form.email}
            onChange={handleChange}
            aria-describedby="email-error"
          />
          {fieldErrors.email ? <><br /><small id="email-error" role="alert">{fieldErrors.email}</small></> : null}
        </p>

        <p>
          <label htmlFor="password">Password</label>
          <br />
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            value={form.password}
            onChange={handleChange}
            aria-describedby="password-hint"
          />
          <br />
          <small id="password-hint">At least 8 characters. A short phrase is easy to remember and hard to guess.</small>
        </p>

        <p>
          <label htmlFor="state">Your state</label>
          <br />
          <select id="state" name="state" value={form.state} onChange={handleChange} aria-describedby="state-error">
            <option value="">Select your state</option>
            {INDIAN_STATES.map((state) => (
              <option key={state.code} value={state.code}>
                {state.name}
              </option>
            ))}
          </select>
          {fieldErrors.state ? <><br /><small id="state-error" role="alert">{fieldErrors.state}</small></> : null}
        </p>

        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Creating account..." : "Create account"}
        </button>
      </form>

      <p>
        Already have an account? <Link to="/login">Log in</Link>
      </p>
    </div>
  );
};

export default Register;
