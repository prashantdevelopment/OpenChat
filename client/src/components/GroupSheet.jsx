import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { BellIcon, BellOffIcon, EllipsisVerticalIcon, LogOutIcon, ShieldIcon, Trash2Icon, UserMinusIcon, UserPlusIcon } from "lucide-react";
import api from "../api/api.js";
import socket from "../socket/socket.js";
import { useAuth } from "../auth/AuthContext.js";
import Avatar from "./Avatar.jsx";
import FormField from "./FormField.jsx";
import MuteDialog from "./MuteDialog.jsx";
import { isMutedNow, mutedUntilText } from "../lib/mute.js";
import { Sheet, SheetPopup, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "@/components/ui/menu";
import { Dialog, DialogClose, DialogDescription, DialogFooter, DialogHeader, DialogPopup, DialogTitle } from "@/components/ui/dialog";
import { toastManager } from "@/components/ui/toast";
import { cancelInvite, deleteGroup, fetchGroup, leaveGroup, makeAdmin, memberCount, removeMember, updateGroup } from "../lib/groups.js";
import { inviteWithKey, rotateGroupKey } from "../lib/groupKeys.js";
import { displayName, handle } from "../lib/people.js";

const MAX_NAME_LENGTH = 50;
const fail = (title) => (err) =>
  toastManager.add({ type: "error", title, description: err.response?.data?.message ?? err.message ?? "Check your connection and try again." });

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

// Rename (admins): the name, then Save or Cancel.
const RenameForm = ({ group, onDone }) => {
  const [name, setName] = useState(group.name);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await updateGroup(group._id, { name });
      onDone(true);
    } catch (err) {
      setError(err.response?.data?.errors?.name ?? err.response?.data?.message ?? "Couldn't rename the group. Check your connection and try again.");
      setSaving(false);
    }
  };
  return (
    <form onSubmit={save} noValidate className="mt-5 w-full space-y-3 text-left">
      <FormField id="group-rename" label="Group name" error={error}>
        {(props) => (
          <input {...props} autoFocus type="text" className="field" maxLength={MAX_NAME_LENGTH} autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
        )}
      </FormField>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" className="min-h-[44px] rounded-full px-5 sm:h-9 sm:min-h-0" onClick={() => onDone(false)}>
          Cancel
        </Button>
        <Button type="submit" className="min-h-[44px] rounded-full px-5 sm:h-9 sm:min-h-0" loading={saving}>
          Save
        </Button>
      </div>
    </form>
  );
};

// Invite people from my chats (someone wrote in them, not blocked, not in the
// group already); each gets a copy of the group's key.
const InvitePeople = ({ group, onDone }) => {
  const { currentUser, privateKey } = useAuth();
  const [people, setPeople] = useState(null);
  const [chosen, setChosen] = useState([]);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let ignore = false;
    const inGroup = new Set([...group.members.map((m) => m._id), ...group.invites.filter((i) => i.status === "pending").map((i) => i.to._id)]);
    api
      .get("/conversations")
      .then(({ data }) => {
        if (ignore) return;
        setPeople(
          data.conversations
            .filter((c) => c.lastMessageAt && !c.blockedByMe)
            .map((c) => c.participants.find((p) => p._id !== currentUser._id))
            .filter((person) => person && !inGroup.has(person._id)),
        );
      })
      .catch(() => !ignore && setPeople([]));
    return () => {
      ignore = true;
    };
  }, [group, currentUser._id]);

  const send = async () => {
    setSending(true);
    try {
      const { invited } = await inviteWithKey(currentUser, privateKey, group._id, people.filter((p) => chosen.includes(p._id)));
      toastManager.add({ type: "success", title: invited === 1 ? "1 invite sent" : `${invited} invites sent`, description: "They join when they accept." });
      onDone();
    } catch (err) {
      fail("Couldn't send the invites")(err);
      setSending(false);
    }
  };

  if (!people) return <p role="status" className="mt-3 text-sm text-muted-foreground">Loading your chats...</p>;
  if (people.length === 0) return <p className="mt-3 text-sm text-muted-foreground">Everyone you chat with is in the group or invited already.</p>;
  return (
    <fieldset className="mt-3">
      <legend className="sr-only">Invite people</legend>
      <ul>
        {people.map((person) => (
          <li key={person._id}>
            <label className="flex min-h-[52px] cursor-pointer items-center gap-3 rounded-lg px-1 hover:bg-accent/60">
              <Avatar name={displayName(person)} avatarId={person.avatar} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{displayName(person)}</span>
                <span className="block truncate text-xs text-muted-foreground">{handle(person)}</span>
              </span>
              <input
                type="checkbox"
                className="size-5 shrink-0 accent-brand"
                checked={chosen.includes(person._id)}
                onChange={() => setChosen((prev) => (prev.includes(person._id) ? prev.filter((id) => id !== person._id) : [...prev, person._id]))}
              />
            </label>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex justify-end gap-2">
        <Button type="button" variant="outline" className="min-h-[44px] rounded-full px-5 sm:h-9 sm:min-h-0" onClick={onDone}>
          Cancel
        </Button>
        <Button type="button" className="min-h-[44px] rounded-full px-5 sm:h-9 sm:min-h-0" disabled={chosen.length === 0} loading={sending} onClick={send}>
          {chosen.length ? `Invite ${chosen.length}` : "Invite"}
        </Button>
      </div>
    </fieldset>
  );
};

// What each confirm says (removing someone, leaving, deleting the group).
const CONFIRM = {
  remove: {
    title: (person) => `Remove ${displayName(person)}?`,
    description: "They won't get new messages. The group gets a new key, so they can't read what comes next.",
    action: "Remove",
    failed: "Couldn't remove them",
  },
  leave: {
    title: (_person, name) => `Leave “${name}”?`,
    description: "You won't get its messages any more. To come back, someone has to invite you again.",
    action: "Leave",
    failed: "Couldn't leave the group",
  },
  delete: {
    title: (_person, name) => `Delete “${name}”?`,
    description: "It goes for everyone in it, with all its messages, photos, videos and files. This can't be undone.",
    action: "Delete group",
    failed: "Couldn't delete the group",
  },
};

// Group info: members (admins marked), invites, and what each person may do.
// Admins: rename, invite, make admin, remove someone (the group then gets a
// new key at once, made here), let all members invite, delete the group for
// everyone. Everyone: leave.
// Reloads while open when something changes.
// mutedUntil / onMuteChange: my notifications for this group (MuteDialog).
const GroupSheet = ({ open, onOpenChange, groupId, currentUserId, mutedUntil, onMuteChange }) => {
  const [muteOpen, setMuteOpen] = useState(false);
  const { currentUser, privateKey } = useAuth();
  const navigate = useNavigate();
  const [group, setGroup] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null); // what is in progress: an invite id, "switch", "confirm"
  const [renaming, setRenaming] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [confirm, setConfirm] = useState(null); // { kind: "remove", person } | { kind: "leave" } | { kind: "delete" }
  const [reloads, setReloads] = useState(0);

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
  }, [open, groupId, reloads]);
  const reload = () => setReloads((n) => n + 1);

  const shown = group?._id === groupId ? group : null;
  const isAdmin = Boolean(shown?.admins.includes(currentUserId));
  const canInvite = isAdmin || Boolean(shown?.membersCanInvite);

  const act = async (key, action) => {
    setBusy(key);
    try {
      await action();
    } finally {
      setBusy(null);
    }
  };

  const handleCancel = (invite) =>
    act(invite._id, async () => {
      await cancelInvite(invite._id);
      setGroup((prev) => ({ ...prev, invites: prev.invites.filter((i) => i._id !== invite._id) }));
      toastManager.add({ title: `Invite to ${displayName(invite.to)} taken back` });
    }).catch(fail("Couldn't take the invite back"));

  const handleMakeAdmin = (person) =>
    makeAdmin(groupId, person._id)
      .then(() => {
        toastManager.add({ type: "success", title: `${displayName(person)} is now an admin` });
        reload();
      })
      .catch(fail("Couldn't make them an admin"));

  // The switch moves at once; back again if the server says no.
  const handleSwitch = (membersCanInvite) => {
    setGroup((prev) => ({ ...prev, membersCanInvite }));
    act("switch", async () => setGroup(await updateGroup(groupId, { membersCanInvite }))).catch((err) => {
      setGroup((prev) => ({ ...prev, membersCanInvite: !membersCanInvite }));
      fail("Couldn't change the setting")(err);
    });
  };

  const handleConfirm = () =>
    act("confirm", async () => {
      if (confirm.kind === "remove") {
        await removeMember(groupId, confirm.person._id);
        setConfirm(null);
        toastManager.add({ title: `${displayName(confirm.person)} was removed`, description: "The group has a new key: they can't read what comes next." });
        // They held the group key: a new one at once (else the next message makes it).
        await rotateGroupKey(currentUser, privateKey, groupId).catch((err) => console.error("New group key not made yet:", err));
        reload();
      } else if (confirm.kind === "delete") {
        // The chat closes and the toast shows when "groupDeleted" arrives (Chat.jsx).
        await deleteGroup(groupId);
        setConfirm(null);
        onOpenChange(false);
      } else {
        await leaveGroup(groupId);
        setConfirm(null);
        onOpenChange(false);
        toastManager.add({ title: `You left “${shown.name}”` });
        navigate("/chat");
      }
    }).catch(fail(CONFIRM[confirm.kind].failed));

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
              {renaming ? (
                <RenameForm
                  group={shown}
                  onDone={(saved) => {
                    setRenaming(false);
                    if (saved) reload();
                  }}
                />
              ) : (
                <>
                  <SheetTitle className="mt-5 max-w-full wrap-break-word">{shown.name}</SheetTitle>
                  <p className="mt-2 font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase">Group · {memberCount(shown.members.length)}</p>
                  {isAdmin ? (
                    <Button variant="outline" className="mt-4 min-h-[44px] rounded-full px-5 sm:h-8 sm:min-h-0" onClick={() => setRenaming(true)}>
                      Rename
                    </Button>
                  ) : null}
                </>
              )}
            </div>

            <Section title="Members" aside={shown.members.length}>
              <ul aria-label="Members" className="mt-2">
                {shown.members.map((member) => {
                  const memberIsAdmin = shown.admins.includes(member._id);
                  return (
                    <Person key={member._id} user={member}>
                      <span className="flex shrink-0 items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
                        {member._id === currentUserId ? <span>You</span> : null}
                        {memberIsAdmin ? <span className="rounded-full border border-border px-2 py-0.5">Admin</span> : null}
                      </span>
                      {isAdmin && member._id !== currentUserId ? (
                        <Menu>
                          <MenuTrigger render={<Button variant="ghost" size="icon-lg" className="size-11 shrink-0 rounded-full sm:size-9" aria-label={`Options for ${displayName(member)}`} />}>
                            <EllipsisVerticalIcon aria-hidden="true" strokeWidth={1.4} />
                          </MenuTrigger>
                          <MenuPopup>
                            {!memberIsAdmin ? (
                              <MenuItem onClick={() => handleMakeAdmin(member)}>
                                <ShieldIcon aria-hidden="true" strokeWidth={1.5} />
                                Make admin
                              </MenuItem>
                            ) : null}
                            <MenuItem onClick={() => setConfirm({ kind: "remove", person: member })}>
                              <UserMinusIcon aria-hidden="true" strokeWidth={1.5} />
                              Remove from group
                            </MenuItem>
                          </MenuPopup>
                        </Menu>
                      ) : null}
                    </Person>
                  );
                })}
              </ul>
              {canInvite ? (
                inviting ? (
                  <InvitePeople
                    group={shown}
                    onDone={() => {
                      setInviting(false);
                      reload();
                    }}
                  />
                ) : (
                  <Button variant="outline" className="mt-3 min-h-[44px] rounded-full px-5 sm:h-9 sm:min-h-0" onClick={() => setInviting(true)}>
                    <UserPlusIcon aria-hidden="true" strokeWidth={1.4} />
                    Invite people
                  </Button>
                )
              ) : null}
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
                          loading={busy === invite._id}
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

            {isAdmin ? (
              <Section title="Settings">
                <label className="mt-3 flex cursor-pointer items-start justify-between gap-6">
                  <span>
                    <span className="block">All members can invite</span>
                    <span className="mt-1 block text-sm text-muted-foreground">Off: only admins invite people.</span>
                  </span>
                  <input
                    type="checkbox"
                    role="switch"
                    className="switch mt-0.5"
                    checked={shown.membersCanInvite}
                    onChange={(e) => handleSwitch(e.target.checked)}
                  />
                </label>
              </Section>
            ) : null}

            <Section title="Notifications">
              <p className="mt-1 mb-3 text-sm text-muted-foreground">{isMutedNow(mutedUntil) ? `${mutedUntilText(mutedUntil)}.` : "On: new messages and calls alert you."}</p>
              <Button variant="outline" className="min-h-[44px] rounded-full px-5 sm:h-9 sm:min-h-0" onClick={() => setMuteOpen(true)}>
                {isMutedNow(mutedUntil) ? <BellIcon aria-hidden="true" strokeWidth={1.4} /> : <BellOffIcon aria-hidden="true" strokeWidth={1.4} />}
                {isMutedNow(mutedUntil) ? "Unmute" : "Mute"}
              </Button>
            </Section>

            <Section title="Leave">
              <p className="mt-1 mb-3 text-sm text-muted-foreground">
                You&apos;ll stop getting its messages.{isAdmin && shown.admins.length === 1 && shown.members.length > 1 ? " The member here longest becomes admin." : ""}
              </p>
              <Button variant="destructive-outline" className="min-h-[44px] rounded-full px-5 sm:h-9 sm:min-h-0" onClick={() => setConfirm({ kind: "leave" })}>
                <LogOutIcon aria-hidden="true" strokeWidth={1.4} />
                Leave group
              </Button>
            </Section>

            {isAdmin ? (
              <Section title="Delete group">
                <p className="mt-1 mb-3 text-sm text-muted-foreground">For everyone: the group, all its messages, photos, videos and files go for good.</p>
                <Button variant="destructive" className="min-h-[44px] rounded-full px-5 sm:h-9 sm:min-h-0" onClick={() => setConfirm({ kind: "delete" })}>
                  <Trash2Icon aria-hidden="true" strokeWidth={1.4} />
                  Delete group
                </Button>
              </Section>
            ) : null}
          </>
        )}
      </SheetPopup>

      {shown ? (
        <MuteDialog open={muteOpen} onOpenChange={setMuteOpen} conversationId={groupId} name={shown.name} mutedUntil={mutedUntil} onChanged={(until) => onMuteChange?.(until)} />
      ) : null}
      <Dialog open={confirm !== null} onOpenChange={(next) => !next && setConfirm(null)}>
        <DialogPopup>
          <DialogHeader>
            <DialogTitle className="font-heading text-3xl font-normal">
              {confirm ? CONFIRM[confirm.kind].title(confirm.person, shown?.name ?? "this group") : null}
            </DialogTitle>
            <DialogDescription>{confirm ? CONFIRM[confirm.kind].description : null}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" className="min-h-[44px] rounded-full px-5" />}>Cancel</DialogClose>
            <Button type="button" variant="destructive" className="min-h-[44px] rounded-full px-5" loading={busy === "confirm"} onClick={handleConfirm}>
              {confirm ? CONFIRM[confirm.kind].action : null}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </Sheet>
  );
};

export default GroupSheet;
