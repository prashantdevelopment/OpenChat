import { useEffect, useState } from "react";
import socket from "../socket/socket.js";
import Avatar from "./Avatar.jsx";
import { Sheet, SheetPopup, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { toastManager } from "@/components/ui/toast";
import { cancelInvite, fetchGroup, memberCount } from "../lib/groups.js";
import { displayName, handle } from "../lib/people.js";

const Section = ({ title, aside, children }) => (
  <section className="border-t border-border px-6 py-5">
    <h3 className="flex items-baseline justify-between text-sm font-medium">
      {title}
      {aside ? <span className="font-mono text-xs font-normal text-muted-foreground">{aside}</span> : null}
    </h3>
    {children}
  </section>
);

const Person = ({ user, children }) => (
  <li className="flex min-h-[52px] items-center gap-3 py-2">
    <Avatar name={displayName(user)} avatarId={user.avatar} />
    <span className="min-w-0 flex-1">
      <span className="block truncate font-medium">{displayName(user)}</span>
      <span className="block truncate text-xs text-muted-foreground">{handle(user)}</span>
    </span>
    {children}
  </li>
);

// Group info: its members (admins marked) and the invites still open or
// recently declined; the inviter or an admin can take a pending invite back.
// Reloads while open when something changes (someone joins or declines).
const GroupSheet = ({ open, onOpenChange, groupId, currentUserId }) => {
  const [group, setGroup] = useState(null);
  const [error, setError] = useState(null);
  const [cancelling, setCancelling] = useState(null);

  useEffect(() => {
    if (!open || !groupId) return;
    let ignore = false;
    const load = () =>
      fetchGroup(groupId)
        .then((next) => {
          if (ignore) return;
          setGroup(next);
          setError(null);
        })
        .catch(() => !ignore && setError("Couldn't load the group. Check your connection and try again."));
    load();
    socket.on("groupsChanged", load);
    return () => {
      ignore = true;
      socket.off("groupsChanged", load);
    };
  }, [open, groupId]);

  const shown = group?._id === groupId ? group : null;
  const isAdmin = Boolean(shown?.admins.includes(currentUserId));

  const handleCancel = async (invite) => {
    setCancelling(invite._id);
    try {
      await cancelInvite(invite._id);
      setGroup((prev) => ({ ...prev, invites: prev.invites.filter((i) => i._id !== invite._id) }));
      toastManager.add({ title: `Invite to ${displayName(invite.to)} taken back` });
    } catch (err) {
      toastManager.add({ type: "error", title: "Couldn't take the invite back", description: err.response?.data?.message ?? "Check your connection and try again." });
    } finally {
      setCancelling(null);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetPopup title="Group info">
        {error && !shown ? (
          <p role="alert" className="px-6 py-8 text-sm">
            {error}
          </p>
        ) : !shown ? (
          <p role="status" className="px-6 py-8 text-sm text-muted-foreground">
            Loading...
          </p>
        ) : (
          <>
            <div className="flex flex-col items-center px-6 pt-8 pb-6 text-center">
              <Avatar name={shown.name} className="size-24 bg-brand text-5xl text-brand-foreground italic" />
              <SheetTitle className="mt-5 max-w-full wrap-break-word">{shown.name}</SheetTitle>
              <p className="mt-2 font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase">Group · {memberCount(shown.members.length)}</p>
            </div>

            <Section title="Members" aside={shown.members.length}>
              <ul aria-label="Members" className="mt-2">
                {shown.members.map((member) => (
                  <Person key={member._id} user={member}>
                    <span className="flex shrink-0 gap-1.5 font-mono text-[11px] text-muted-foreground">
                      {member._id === currentUserId ? <span>You</span> : null}
                      {shown.admins.includes(member._id) ? <span className="rounded-full border border-border px-2 py-0.5">Admin</span> : null}
                    </span>
                  </Person>
                ))}
              </ul>
            </Section>

            {shown.invites.length ? (
              <Section title="Invited" aside={shown.invites.length}>
                <p className="mt-1 text-sm text-muted-foreground">They join when they accept.</p>
                <ul aria-label="Invited" className="mt-2">
                  {shown.invites.map((invite) => (
                    <Person key={invite._id} user={invite.to}>
                      {invite.status === "declined" ? (
                        <span className="font-mono text-[11px] text-destructive-foreground">Declined</span>
                      ) : isAdmin || invite.from._id === currentUserId ? (
                        <Button
                          variant="outline"
                          className="min-h-[44px] shrink-0 rounded-full px-4 sm:h-8 sm:min-h-0"
                          loading={cancelling === invite._id}
                          onClick={() => handleCancel(invite)}
                          aria-label={`Cancel the invite to ${displayName(invite.to)}`}
                        >
                          Cancel
                        </Button>
                      ) : (
                        <span className="font-mono text-[11px] text-muted-foreground">Invited</span>
                      )}
                    </Person>
                  ))}
                </ul>
              </Section>
            ) : null}
          </>
        )}
      </SheetPopup>
    </Sheet>
  );
};

export default GroupSheet;
