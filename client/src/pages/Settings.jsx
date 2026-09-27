import { useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { ArrowDownIcon, CircleCheckIcon, MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import api from "../api/api.js";
import { useAuth } from "../auth/AuthContext.js";
import { rewrapPrivateKey } from "../crypto/keys.js";
import { applyThemeChoice, getThemeChoice } from "../lib/theme.js";
import { getNotificationPrefs, setNotificationPrefs } from "../lib/notifications.js";
import { promptInstall, useInstallState } from "../lib/pwa.js";
import FormField, { PasswordInput } from "../components/FormField.jsx";
import StateSelect from "../components/StateSelect.jsx";
import Avatar from "../components/Avatar.jsx";
import { makeAvatar } from "../lib/images.js";
import Masthead from "../components/Masthead.jsx";
import { Button } from "@/components/ui/button";

const MAX_BIO_LENGTH = 160; // same limit as the server

// One part of the page, set like a chapter: its number, the title in the
// serif and a line of explanation on the left (wide screens), the controls on
// the right; hairline rules between chapters. The heading names the region
// for screen readers.
const Section = ({ number, title, description, children }) => {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="border-t border-border py-10 md:grid md:grid-cols-[240px_minmax(0,1fr)] md:gap-12">
      <div>
        <p aria-hidden="true" className="font-mono text-xs text-muted-foreground">
          {number}
        </p>
        <h2 id={headingId} className="mt-1 text-[32px] leading-tight">
          {title}
        </h2>
        {description ? <p className="mt-2 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      <div className="mt-6 md:mt-2">{children}</div>
    </section>
  );
};

// Save buttons: an ink pill (keeps its size on desktop too).
const PILL = "h-11 rounded-full px-6 sm:h-11";

const FormAlert = ({ children }) => (
  <p role="alert" className="border border-destructive-foreground/40 px-3 py-2 text-sm text-destructive-foreground">
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

// Profile photo: cropped to a small square in the browser, then uploaded.
// Public (everyone who finds you sees it), unlike messages.
const ProfilePhoto = () => {
  const { currentUser, updateCurrentUser } = useAuth();
  const fileInput = useRef(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedMessage, setSavedMessage] = useState("");

  const run = async (action, message) => {
    setIsSaving(true);
    setError("");
    setSavedMessage("");
    try {
      await action();
      setSavedMessage(message);
    } catch (err) {
      setError(err.response?.data?.message ?? err.message ?? "Could not save. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  const choose = (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    run(async () => {
      const photo = await makeAvatar(file);
      const res = await api.put("/users/me/avatar", photo, { headers: { "Content-Type": "image/jpeg" } });
      updateCurrentUser({ avatar: res.data.avatar });
    }, "Photo saved.");
  };

  const remove = () =>
    run(async () => {
      await api.delete("/users/me/avatar");
      updateCurrentUser({ avatar: "" });
    }, "Photo removed.");

  return (
    <div className="mb-8 flex items-center gap-5">
      <Avatar name={currentUser.username} avatarId={currentUser.avatar} className="size-20 bg-brand text-4xl text-brand-foreground italic" />
      <div className="min-w-0 flex-1 space-y-2">
        <p className="font-mono text-[11px] tracking-[0.16em] text-muted-foreground uppercase">Profile photo</p>
        <div className="flex flex-wrap gap-2">
          <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden onChange={choose} />
          <Button type="button" variant="outline" size="sm" className="rounded-full border-foreground px-4" loading={isSaving} onClick={() => fileInput.current?.click()}>
            {currentUser.avatar ? "Change photo" : "Add photo"}
          </Button>
          {currentUser.avatar ? (
            <Button type="button" variant="ghost" size="sm" className="rounded-full px-4" disabled={isSaving} onClick={remove}>
              Remove photo
            </Button>
          ) : null}
        </div>
        {error ? <FormAlert>{error}</FormAlert> : <SavedStatus>{savedMessage}</SavedStatus>}
      </div>
    </div>
  );
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
    <Section number="01" title="Profile" description="Your photo, username, bio and state are visible to people who search for you.">
      <ProfilePhoto />
      <form onSubmit={handleSubmit} noValidate className="space-y-6">
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
              className="field"
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
              className="field h-auto min-h-16 resize-none"
              value={form.bio}
              onChange={handleChange}
            />
          )}
        </FormField>

        <FormField id="state" label="State" error={fieldErrors.state}>
          {(props) => <StateSelect {...props} name="state" value={form.state} onChange={handleChange} />}
        </FormField>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" className={PILL} loading={isSaving} disabled={!hasChanges}>
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
      number="02"
      title="Password"
      description="Your messages stay readable: your encryption key is re-locked with the new password, in this browser."
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-6">
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
          <Button type="submit" className={PILL} loading={isSaving} disabled={!form.current || !form.next || !form.confirm}>
            Change password
          </Button>
          <SavedStatus>{savedMessage}</SavedStatus>
        </div>
      </form>
    </Section>
  );
};

// An on/off account setting, saved as soon as it is switched (no Save
// button). The switch moves at once and moves back if saving fails.
const SettingSwitch = ({ setting, label, hintId, children }) => {
  const { currentUser, updateCurrentUser } = useAuth();
  const [isOn, setIsOn] = useState(currentUser[setting] !== false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  const handleChange = async (e) => {
    const value = e.target.checked;
    setIsOn(value);
    setIsSaving(true);
    setError("");
    try {
      await api.patch("/users/me", { [setting]: value });
      updateCurrentUser({ [setting]: value });
    } catch (err) {
      setIsOn(!value);
      setError(err.response?.data?.message ?? "Could not save. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <label className="flex cursor-pointer items-start justify-between gap-6">
        <span>
          <span className="block font-medium">{label}</span>
          <span id={hintId} className="mt-1 block text-sm text-muted-foreground">
            {children}
          </span>
        </span>
        <input
          type="checkbox"
          role="switch"
          checked={isOn}
          disabled={isSaving}
          onChange={handleChange}
          aria-describedby={hintId}
          className="switch mt-0.5"
        />
      </label>
      {error ? <FormAlert>{error}</FormAlert> : null}
    </div>
  );
};

const PrivacySection = () => (
  <Section number="03" title="Privacy" description="Who can see what about you.">
    <div className="divide-y divide-border [&>*]:py-5 [&>*:first-child]:pt-0">
      <SettingSwitch setting="readReceipts" label="Read receipts" hintId="read-receipts-hint">
        Let people see when you&apos;ve read their messages. If you turn this off, you won&apos;t see when
        others read yours either. Delivered ticks are always shown.
      </SettingSwitch>
      <SettingSwitch setting="discoverable" label="Show me in Discover" hintId="discoverable-hint">
        List me among the people of my state on the Discover page. If you turn this off, only people who
        type your username can find you.
      </SettingSwitch>
    </div>
  </Section>
);

const NotificationsSection = () => {
  const isSupported = "Notification" in window;
  const [prefs, setPrefs] = useState(getNotificationPrefs);
  const [permission, setPermission] = useState(isSupported ? Notification.permission : "unsupported");
  const isOn = prefs.enabled && permission === "granted";

  const save = (changes) => {
    setNotificationPrefs(changes);
    setPrefs((current) => ({ ...current, ...changes }));
  };

  // The browser asks for permission only now, after the user chose this
  // (never on page load).
  const handleToggle = async (e) => {
    if (!e.target.checked) {
      save({ enabled: false });
      return;
    }
    const result = permission === "granted" ? "granted" : await Notification.requestPermission();
    setPermission(result);
    save({ enabled: result === "granted" });
  };

  return (
    <Section number="04" title="Notifications" description="Get a notification for new messages while OpenChat is open in a tab you aren't looking at.">
      {!isSupported ? (
        <p className="text-sm text-muted-foreground">This browser doesn&apos;t support notifications.</p>
      ) : (
        <div className="space-y-4">
          <label className="flex cursor-pointer items-center justify-between gap-6">
            <span className="font-medium">Desktop notifications</span>
            <input
              type="checkbox"
              role="switch"
              checked={isOn}
              disabled={permission === "denied"}
              onChange={handleToggle}
              className="switch"
            />
          </label>
          {permission === "denied" ? (
            <p role="status" className="text-sm text-muted-foreground">
              Notifications are blocked for this site. Allow them in your browser&apos;s site settings, then reload.
            </p>
          ) : null}
          <label className="flex cursor-pointer items-start gap-3 has-disabled:cursor-not-allowed has-disabled:opacity-60">
            <input
              type="checkbox"
              checked={prefs.preview}
              disabled={!isOn}
              onChange={(e) => save({ preview: e.target.checked })}
              aria-describedby="notification-preview-hint"
              className="mt-1 size-4.5 shrink-0 accent-brand"
            />
            <span>
              <span className="block font-medium">Show message text</span>
              <span id="notification-preview-hint" className="mt-0.5 block text-sm text-muted-foreground">
                Messages are decrypted on this device. Turn this off if others can see your screen: the notification
                will only say &quot;New message&quot;.
              </span>
            </span>
          </label>
        </div>
      )}
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
    <Section number="05" title="Appearance" description="Paper by day, ink by night.">
      {/* Real radio buttons: arrow keys move between them. */}
      <fieldset>
        <legend className="mb-3 font-mono text-[11px] tracking-[0.16em] text-muted-foreground uppercase">Theme</legend>
        <div className="flex flex-wrap gap-2">
          {THEMES.map(({ value, label, Icon }) => (
            <label
              key={value}
              className="relative flex h-11 cursor-pointer items-center gap-2.5 rounded-full border border-border px-4 has-checked:border-foreground has-checked:bg-foreground has-checked:text-background has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring"
            >
              <input
                type="radio"
                name="theme"
                value={value}
                checked={choice === value}
                onChange={() => choose(value)}
                className="absolute inset-0 cursor-pointer appearance-none rounded-full opacity-0"
              />
              <Icon aria-hidden="true" strokeWidth={1.4} className="size-4" />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
    </Section>
  );
};

// What each install state tells the user (see lib/pwa.js).
const INSTALL_TEXT = {
  standalone: "You're using the installed app.",
  installed: "Installed. Open OpenChat from your home screen or app list.",
  ios: "In Safari, tap Share, then Add to Home Screen.",
  unavailable: "To install, open OpenChat in Chrome, Edge or Samsung Internet and choose Install app from the menu.",
};

const AppSection = () => {
  const state = useInstallState();
  return (
    <Section number="06" title="App" description="Install OpenChat to open it like an app, in its own window, from your home screen.">
      {state === "prompt" ? (
        // An ink pill with the arrow in its own red circle, like the other main buttons.
        <Button className="h-12.5 gap-3 rounded-full pr-1.5 pl-6 text-[15px] sm:h-12.5 sm:text-[15px]" onClick={promptInstall}>
          Install OpenChat
          <span aria-hidden="true" className="grid size-9.5 place-items-center rounded-full bg-brand text-brand-foreground">
            <ArrowDownIcon strokeWidth={1.7} />
          </span>
        </Button>
      ) : (
        <p role="status" className="max-w-md">
          {INSTALL_TEXT[state]}
        </p>
      )}
    </Section>
  );
};

const AccountSection = () => {
  const { currentUser, logout } = useAuth();
  return (
    <Section number="07" title="Account">
      <dl>
        <dt className="font-mono text-[11px] tracking-[0.16em] text-muted-foreground uppercase">Email</dt>
        <dd className="mt-1 break-all">{currentUser.email}</dd>
      </dl>
      <Button variant="outline" className={`mt-6 border-foreground ${PILL}`} onClick={logout}>
        Log out
      </Button>
    </Section>
  );
};

const Settings = () => (
  <div className="min-h-dvh bg-background">
    <Masthead discover={false} />
    <main className="mx-auto max-w-5xl px-5 pt-10 pb-16 md:px-10 md:pt-14">
      <p className="font-mono text-[11px] tracking-[0.16em] text-muted-foreground uppercase">Your account</p>
      <h1 className="mt-2 mb-10 text-[56px] leading-none md:text-[72px]">Settings</h1>
      <ProfileSection />
      <PasswordSection />
      <PrivacySection />
      <NotificationsSection />
      <AppearanceSection />
      <AppSection />
      <AccountSection />
    </main>
  </div>
);

export default Settings;
