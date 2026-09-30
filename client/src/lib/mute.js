// A chat's muted notifications (see MuteDialog and the server's setMute).

// Still muted at this moment? (A time in the past: no longer.)
export const isMutedNow = (mutedUntil) => Boolean(mutedUntil) && new Date(mutedUntil) > new Date();

// "Muted" (always) or "Muted until Tue, 6:30 pm".
export const mutedUntilText = (mutedUntil) =>
  new Date(mutedUntil).getUTCFullYear() >= 9999
    ? "Muted"
    : `Muted until ${new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" }).format(new Date(mutedUntil))}`;
