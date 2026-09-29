import { useState } from "react";
import { CircleAlertIcon } from "lucide-react";
import Avatar from "./Avatar.jsx";
import FormField from "./FormField.jsx";
import { Sheet, SheetPopup, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { createGroup } from "../lib/groups.js";
import { displayName, handle } from "../lib/people.js";

const MAX_NAME_LENGTH = 50;

// "New group": a name and people from my chats. They get an invite; nobody is
// added before accepting. Only chats someone wrote in are offered (the server
// accepts only those), and nobody I blocked.
// onClosed: runs once the sheet has finished closing.
const NewGroupSheet = ({ open, onOpenChange, onClosed, conversations, currentUserId, onCreated }) => {
  const [name, setName] = useState("");
  const [filter, setFilter] = useState("");
  const [chosen, setChosen] = useState([]);
  const [nameError, setNameError] = useState(null);
  const [formError, setFormError] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const people = conversations
    .filter((conversation) => conversation.lastMessageAt && !conversation.blockedByMe)
    .map((conversation) => conversation.participants.find((participant) => participant._id !== currentUserId))
    .filter(Boolean);
  const query = filter.trim().toLowerCase();
  const shown = query ? people.filter((person) => `${person.name ?? ""} ${person.username}`.toLowerCase().includes(query)) : people;

  const reset = () => {
    setName("");
    setFilter("");
    setChosen([]);
    setNameError(null);
    setFormError(null);
  };
  const toggle = (id) => setChosen((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const handleSubmit = async (event) => {
    event.preventDefault();
    setNameError(null);
    setFormError(null);
    if (!name.trim()) {
      setNameError("Give the group a name");
      document.getElementById("group-name")?.focus();
      return;
    }
    if (chosen.length === 0) {
      setFormError("Choose at least one person to invite");
      return;
    }
    setIsSubmitting(true);
    try {
      const group = await createGroup(name, chosen);
      reset();
      onCreated(group);
    } catch (error) {
      const data = error.response?.data;
      if (data?.errors?.name) {
        setNameError(data.errors.name);
        document.getElementById("group-name")?.focus();
      } else setFormError(data?.message ?? "Couldn't create the group. Check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
      onOpenChangeComplete={(next) => !next && onClosed?.()}
    >
      <SheetPopup title="New group">
        <form onSubmit={handleSubmit} noValidate className="flex min-h-full flex-col">
          <div className="space-y-5 px-6 pt-6 pb-4">
            <SheetTitle>Start a group</SheetTitle>
            <p className="text-sm text-muted-foreground">Pick people you already chat with. Each gets an invite and joins only if they accept.</p>
            <FormField id="group-name" label="Group name" hint={`Up to ${MAX_NAME_LENGTH} characters, any language.`} error={nameError}>
              {(props) => (
                <input {...props} type="text" className="field" maxLength={MAX_NAME_LENGTH} autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
              )}
            </FormField>
          </div>

          <fieldset className="min-h-0 flex-1 border-t border-border px-6 pt-4">
            <legend className="float-left mb-3 w-full font-mono text-[11px] tracking-[0.16em] text-muted-foreground uppercase">
              Invite · {chosen.length} chosen
            </legend>
            {people.length > 6 ? (
              <input
                type="search"
                aria-label="Search your chats"
                placeholder="Search your chats"
                className="field mb-2"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            ) : null}
            {people.length === 0 ? (
              <p className="clear-both py-4 text-sm text-muted-foreground">Write to someone first: groups are made from your chats.</p>
            ) : shown.length === 0 ? (
              <p className="clear-both py-4 text-sm text-muted-foreground">No chat matches “{filter}”.</p>
            ) : (
              <ul className="clear-both">
                {shown.map((person) => (
                  <li key={person._id}>
                    <label className="flex min-h-[56px] cursor-pointer items-center gap-3 rounded-lg px-1 hover:bg-accent/60">
                      <Avatar name={displayName(person)} avatarId={person.avatar} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{displayName(person)}</span>
                        <span className="block truncate text-xs text-muted-foreground">{handle(person)}</span>
                      </span>
                      <input type="checkbox" className="size-5 shrink-0 accent-brand" checked={chosen.includes(person._id)} onChange={() => toggle(person._id)} />
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </fieldset>

          <div className="sticky bottom-0 space-y-3 border-t border-border bg-background px-6 py-4">
            {formError ? (
              <p role="alert" className="flex items-start gap-1.5 text-sm text-destructive-foreground">
                <CircleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                {formError}
              </p>
            ) : null}
            <Button type="submit" className="min-h-[44px] w-full rounded-full" loading={isSubmitting}>
              {chosen.length ? `Create and invite ${chosen.length}` : "Create group"}
            </Button>
          </div>
        </form>
      </SheetPopup>
    </Sheet>
  );
};

export default NewGroupSheet;
