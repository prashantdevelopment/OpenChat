import { cn } from "@/lib/utils";

// Round avatar with the first letter of the name (photos come with media
// uploads later). Decorative: the name is always shown next to it, so screen
// readers skip it. online: a green dot; the text next to it says it in words.
const Avatar = ({ name, online = false, className }) => (
  <span
    aria-hidden="true"
    className={cn(
      "relative flex size-10 shrink-0 items-center justify-center rounded-full bg-primary font-heading font-semibold text-primary-foreground",
      className,
    )}
  >
    {name?.[0]?.toUpperCase() ?? "?"}
    {online ? (
      <span data-online className="absolute right-0 bottom-0 size-3 rounded-full bg-success ring-2 ring-background" />
    ) : null}
  </span>
);

export default Avatar;
