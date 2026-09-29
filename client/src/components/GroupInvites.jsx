import { useState } from "react";
import Avatar from "./Avatar.jsx";
import { Button } from "@/components/ui/button";
import { toastManager } from "@/components/ui/toast";
import { answerInvite, memberCount } from "../lib/groups.js";
import { displayName } from "../lib/people.js";

const expiryDate = (value) => new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(new Date(value));

// One invite: who wants to add me to which group; Accept joins, Deny doesn't
// (the inviter sees "declined").
const Invite = ({ invite, onAnswered }) => {
  const [busy, setBusy] = useState(null); // "accept" | "decline" | null
  const from = displayName(invite.from);

  const respond = async (accept) => {
    setBusy(accept ? "accept" : "decline");
    try {
      await answerInvite(invite._id, accept);
      toastManager.add(
        accept
          ? { type: "success", title: `You joined “${invite.group.name}”` }
          : { title: "Invite declined", description: `You weren't added to “${invite.group.name}”.` },
      );
      onAnswered(invite._id, accept);
    } catch (error) {
      toastManager.add({ type: "error", title: "Couldn't answer the invite", description: error.response?.data?.message ?? "Check your connection and try again." });
      // Expired, taken back or answered elsewhere: it no longer applies.
      if ([404, 409, 410].includes(error.response?.status)) onAnswered(invite._id, false);
      setBusy(null);
    }
  };

  return (
    <li className="border-t border-border px-5 py-4 md:px-7">
      <div className="flex gap-3">
        <Avatar name={invite.group.name} className="bg-brand text-lg text-brand-foreground italic" />
        <div className="min-w-0 flex-1">
          <p className="text-[0.9375rem] leading-snug">
            <span className="font-medium">{from}</span> wants to add you to{" "}
            <span className="font-heading text-[1.125rem] wrap-break-word">“{invite.group.name}”</span>. Join the group?
          </p>
          <p className="mt-1 font-mono text-[11px] text-muted-foreground">
            {memberCount(invite.group.memberCount)} · open until {expiryDate(invite.expiresAt)}
          </p>
        </div>
      </div>
      <div className="mt-3 flex gap-2 pl-13">
        <Button className="min-h-[44px] rounded-full px-5 sm:h-9 sm:min-h-0" loading={busy === "accept"} disabled={busy !== null} onClick={() => respond(true)}>
          Accept
        </Button>
        <Button variant="outline" className="min-h-[44px] rounded-full px-5 sm:h-9 sm:min-h-0" loading={busy === "decline"} disabled={busy !== null} onClick={() => respond(false)}>
          Deny
        </Button>
      </div>
    </li>
  );
};

// Open group invites, at the top of the chat list.
const GroupInvites = ({ invites, onAnswered }) => {
  if (invites.length === 0) return null;
  return (
    <section aria-labelledby="group-invites-heading">
      <h2 id="group-invites-heading" className="px-5 pb-2 font-mono text-[11px] tracking-[0.16em] text-brand uppercase md:px-7">
        Group invites · {invites.length}
      </h2>
      <ul>
        {invites.map((invite) => (
          <Invite key={invite._id} invite={invite} onAnswered={onAnswered} />
        ))}
      </ul>
    </section>
  );
};

export default GroupInvites;
