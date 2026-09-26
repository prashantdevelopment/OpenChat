import { useId, useState } from "react";
import { flushSync } from "react-dom";
import { Link } from "react-router";
import { ArrowLeftIcon, CircleCheckIcon, MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import api from "../api/api.js";
import { useAuth } from "../auth/AuthContext.js";
import { rewrapPrivateKey } from "../crypto/keys.js";
import { applyThemeChoice, getThemeChoice } from "../lib/theme.js";
import FormField, { PasswordInput } from "../components/FormField.jsx";
import StateSelect from "../components/StateSelect.jsx";
import { Button } from "@/components/ui/button";

const MAX_BIO_LENGTH = 160; // same limit as the server

// One card on the page, with a heading that names the region for screen readers.
const Section = ({ title, description, children }) => {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="rounded-xl border border-border bg-card p-5 text-card-foreground sm:p-6">
      <h2 id={headingId} className="text-lg">
        {title}
      </h2>
      {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      <div className="mt-5">{children}</div>
    </section>
  );
};

const FormAlert = ({ children }) => (
  <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground">
    {children}
  </p>
);

// "Saved" confirmation. role="status": screen readers announce it politely.
const SavedStatus = ({ children }) => (
  <p role="status" className="flex items-center gap-1.5 text-sm text-success-foreground">
    {children ? <CircleCheckIcon aria-hidden="true" className="size-4 shrink-0" /> : null}
    {children}
  </p>
);

// Renders the messages now, then moves focus to the first field that has one,
// so a screen reader reads that field with its error.
const showFieldErrors = (setFieldErrors, errors, order) => {
  flushSync(() => setFieldErrors(errors));
  const first = order.find((field) => errors[field]);
  if (first) document.getElementById(first)?.focus();
};

// Field ids match the server's field names, so its errors map straight on.
const PROFILE_ORDER = ["username", "bio", "state"];

const ProfileSection = () => {
  const { currentUser, updateCurrentUser } = useAuth();
  const [form, setForm] = useState({ username: currentUser.username, bio: currentUser.bio ?? "", state: currentUser.state ?? "" });
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [savedMessage, setSavedMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // Only what changed is sent.
  const changes = Object.fromEntries(
    Object.entries(form).filter(([field, value]) => value !== (currentUser[field] ?? "")),
  );
  const hasChanges = Object.keys(changes).length > 0;

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
    setSavedMessage("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSaving(true);
    setFieldErrors({});
    setFormError("");
    try {
      const res = await api.patch("/users/me", changes);
      const { username, bio, state } = res.data.updatedUser;
      updateCurrentUser({ username, bio, state });
      // The server tidies values (lowercase username, trimmed bio): show what was saved.
      setForm({ username, bio, state });
      setSavedMessage("Profile saved.");
    } catch (error) {
      const data = error.response?.data;
      if (data?.errors) showFieldErrors(setFieldErrors, data.errors, PROFILE_ORDER);
      // 409: "Username already exists"
      else if (error.response?.status === 409) showFieldErrors(setFieldErrors, { username: data.message }, PROFILE_ORDER);
      else setFormError(data?.message ?? "Could not reach the server. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Section title="Profile" description="Your username, bio and state are visible to people who search for you.">
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {formError ? <FormAlert>{formError}</FormAlert> : null}

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
              className="w-full"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={form.username}
              onChange={handleChange}
            />
          )}
        </FormField>

        <FormField
          id="bio"
          label="Bio"
          hint={`${form.bio.length} of ${MAX_BIO_LENGTH} characters`}
          error={fieldErrors.bio}
        >
          {(props) => (
            <textarea
              {...props}
              name="bio"
              rows={2}
              maxLength={MAX_BIO_LENGTH}
              className="block w-full resize-none"
              value={form.bio}
              onChange={handleChange}
            />
          )}
        </FormField>

        <FormField id="state" label="State" error={fieldErrors.state}>
          {(props) => <StateSelect {...props} name="state" value={form.state} onChange={handleChange} />}
        </FormField>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" loading={isSaving} disabled={!hasChanges}>
            Save changes
          </Button>
          <SavedStatus>{savedMessage}</SavedStatus>
        </div>
      </form>
    </Section>
  );
};

const PASSWORD_ORDER = ["current-password", "new-password", "confirm-password"];

const PasswordSection = () => {
  const { currentUser, updateCurrentUser } = useAuth();
  const [form, setForm] = useState({ current: "", next: "", confirm: "" });
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [savedMessage, setSavedMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
    setSavedMessage("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFieldErrors({});
    setFormError("");
    if (form.next !== form.confirm) {
      showFieldErrors(setFieldErrors, { "confirm-password": "The new passwords don't match" }, PASSWORD_ORDER);
      return;
    }

    setIsSaving(true);
    try {
      // The private key is locked with the password. Re-lock it with the new
      // one here in the browser; the server only ever sees it locked. Opening
      // it also proves the current password.
      let encryptedPrivateKey;
      try {
        encryptedPrivateKey = await rewrapPrivateKey(currentUser.encryptedPrivateKey, form.current, form.next);
      } catch {
        showFieldErrors(setFieldErrors, { "current-password": "Current password is incorrect" }, PASSWORD_ORDER);
        return;
      }

      await api.patch("/users/me/password", { currentPassword: form.current, newPassword: form.next, encryptedPrivateKey });
      updateCurrentUser({ encryptedPrivateKey });
      setForm({ current: "", next: "", confirm: "" });
      setSavedMessage("Password changed. Use the new one next time you log in.");
    } catch (error) {
      const status = error.response?.status;
      const message = error.response?.data?.message;
      if (status === 401) showFieldErrors(setFieldErrors, { "current-password": message }, PASSWORD_ORDER);
      else if (status === 400 && message) showFieldErrors(setFieldErrors, { "new-password": message }, PASSWORD_ORDER);
      else setFormError(message ?? "Could not reach the server. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Section
      title="Password"
      description="Your messages stay readable: your encryption key is re-locked with the new password, in this browser."
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {formError ? <FormAlert>{formError}</FormAlert> : null}
        {/* Lets password managers link the change to this account. */}
        <input type="text" name="username" autoComplete="username" value={currentUser.username} readOnly hidden />

        <FormField id="current-password" label="Current password" error={fieldErrors["current-password"]}>
          {(props) => <PasswordInput {...props} name="current" autoComplete="current-password" value={form.current} onChange={handleChange} />}
        </FormField>
        <FormField
          id="new-password"
          label="New password"
          hint="At least 8 characters. Don't lose it: it's the only way to unlock your messages."
          error={fieldErrors["new-password"]}
        >
          {(props) => <PasswordInput {...props} name="next" autoComplete="new-password" value={form.next} onChange={handleChange} />}
        </FormField>
        <FormField id="confirm-password" label="Confirm new password" error={fieldErrors["confirm-password"]}>
          {(props) => <PasswordInput {...props} name="confirm" autoComplete="new-password" value={form.confirm} onChange={handleChange} />}
        </FormField>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" loading={isSaving} disabled={!form.current || !form.next || !form.confirm}>
            Change password
          </Button>
          <SavedStatus>{savedMessage}</SavedStatus>
        </div>
      </form>
    </Section>
  );
};

const PrivacySection = () => {
  const { currentUser, updateCurrentUser } = useAuth();
  const [isOn, setIsOn] = useState(currentUser.readReceipts !== false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  // Saved as soon as it is switched (no Save button for one switch). The
  // switch moves at once and moves back if saving fails.
  const handleChange = async (e) => {
    const readReceipts = e.target.checked;
    setIsOn(readReceipts);
    setIsSaving(true);
    setError("");
    try {
      await api.patch("/users/me", { readReceipts });
      updateCurrentUser({ readReceipts });
    } catch (err) {
      setIsOn(!readReceipts);
      setError(err.response?.data?.message ?? "Could not save. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Section title="Privacy">
      <div className="space-y-3">
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            role="switch"
            checked={isOn}
            disabled={isSaving}
            onChange={handleChange}
            aria-describedby="read-receipts-hint"
            className="mt-0.5 size-4 shrink-0 accent-primary"
          />
          <span>
            <span className="block text-sm font-medium">Read receipts</span>
            <span id="read-receipts-hint" className="mt-0.5 block text-sm text-muted-foreground">
              Let people see when you&apos;ve read their messages. If you turn this off, you won&apos;t see
              when others read yours either. Delivered ticks are always shown.
            </span>
          </span>
        </label>
        {error ? <FormAlert>{error}</FormAlert> : null}
      </div>
    </Section>
  );
};

const THEMES = [
  { value: "light", label: "Light", Icon: SunIcon },
  { value: "dark", label: "Dark", Icon: MoonIcon },
  { value: "system", label: "Match device", Icon: MonitorIcon },
];

const AppearanceSection = () => {
  const [choice, setChoice] = useState(getThemeChoice);
  const choose = (value) => {
    applyThemeChoice(value);
    setChoice(value);
  };

  return (
    <Section title="Appearance">
      {/* Real radio buttons: arrow keys move between them. */}
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Theme</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {THEMES.map(({ value, label, Icon }) => (
            <label
              key={value}
              className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-input p-3 text-sm has-checked:border-primary has-checked:bg-primary/5"
            >
              <input
                type="radio"
                name="theme"
                value={value}
                checked={choice === value}
                onChange={() => choose(value)}
                className="size-4 accent-primary"
              />
              <Icon aria-hidden="true" className="size-4 text-muted-foreground" />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
    </Section>
  );
};

const AccountSection = () => {
  const { currentUser, logout } = useAuth();
  return (
    <Section title="Account">
      <dl className="text-sm">
        <dt className="text-muted-foreground">Email</dt>
        <dd className="mt-0.5 font-medium break-all">{currentUser.email}</dd>
      </dl>
      <Button variant="outline" className="mt-5" onClick={logout}>
        Log out
      </Button>
    </Section>
  );
};

const Settings = () => (
  <div className="min-h-dvh bg-background">
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-2xl items-center gap-2 px-4 py-3">
        <Button render={<Link to="/chat" />} variant="ghost" size="icon" className="-ml-2" aria-label="Back to chats">
          <ArrowLeftIcon aria-hidden="true" />
        </Button>
        <h1 className="text-lg">Settings</h1>
      </div>
    </header>
    <main className="mx-auto max-w-2xl space-y-6 px-4 py-6">
      <ProfileSection />
      <PasswordSection />
      <PrivacySection />
      <AppearanceSection />
      <AccountSection />
    </main>
  </div>
);

export default Settings;
