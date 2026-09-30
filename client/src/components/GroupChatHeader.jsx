import { useState } from "react";
import { Link } from "react-router";
import { ArrowLeftIcon } from "lucide-react";
import Avatar from "./Avatar.jsx";
import GroupSheet from "./GroupSheet.jsx";
import { Button } from "@/components/ui/button";
import { useTypingPeople } from "../socket/useTyping.js";
import { memberCount } from "../lib/groups.js";

// An open group chat's top bar, like the 1:1 one: back (on phones), the
// group's initial and name, and one small line under it (how many members, or
// who is writing). Tapping the name opens the group info. (Group calls come
// in a later step.)
const GroupChatHeader = ({ group, currentUserId, nameOf, headingLevel: Heading = "h2" }) => {
  const [infoOpen, setInfoOpen] = useState(false);
  const typing = useTypingPeople(group._id, currentUserId);

  const status = typing.length ? (
    <span data-typing className="text-brand italic">
      {typing.length === 1 ? `${nameOf(typing[0])} is writing…` : `${typing.length} people are writing…`}
    </span>
  ) : (
    memberCount(group.members.length)
  );

  return (
    <header className="flex h-15 shrink-0 items-center gap-1 border-b border-border px-2 md:h-17 md:gap-2 md:px-5">
      <Button render={<Link to="/chat" />} variant="ghost" size="icon-lg" className="rounded-full md:hidden" aria-label="Back to conversations">
        <ArrowLeftIcon aria-hidden="true" strokeWidth={1.4} />
      </Button>
      <div className="relative flex min-h-[44px] min-w-0 flex-1 items-center gap-3 py-1 pr-2">
        <Avatar name={group.name} className="size-9.5 bg-brand text-lg text-brand-foreground italic md:size-10.5" />
        <span className="min-w-0">
          <Heading className="font-heading text-[1.1875rem] leading-tight md:text-[1.375rem]">
            <button
              type="button"
              data-slot="contact-trigger"
              aria-haspopup="dialog"
              onClick={() => setInfoOpen(true)}
              className="block w-full cursor-pointer truncate text-left after:absolute after:inset-0 after:rounded-lg"
            >
              {group.name}
            </button>
          </Heading>
          <p data-status className="truncate text-xs leading-snug text-muted-foreground">
            {status}
          </p>
        </span>
      </div>
      <GroupSheet open={infoOpen} onOpenChange={setInfoOpen} groupId={group._id} currentUserId={currentUserId} />
    </header>
  );
};

export default GroupChatHeader;
