import { useState } from "react";
import { API_URL } from "../api/api.js";
import { cn } from "@/lib/utils";

// Round avatar: the profile photo if there is one, otherwise the first letter
// of the name (also if the photo fails to load). Decorative: the name is
// always shown next to it, so screen readers skip it. online: a green dot;
// the text next to it says it in words.
const Avatar = ({ name, avatarId, online = false, className }) => {
  const [failedId, setFailedId] = useState(null);
  const showPhoto = Boolean(avatarId) && failedId !== avatarId;

  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative flex size-10 shrink-0 items-center justify-center rounded-full bg-primary font-heading text-primary-foreground",
        className,
      )}
    >
      {showPhoto ? (
        <img
          src={`${API_URL}/api/avatars/${avatarId}`}
          alt=""
          loading="lazy"
          className="size-full rounded-full object-cover"
          onError={() => setFailedId(avatarId)}
        />
      ) : (
        ([...(name ?? "")][0]?.toUpperCase() ?? "?")
      )}
      {online ? (
        <span data-online className="absolute right-0 bottom-0 size-3 rounded-full bg-success ring-2 ring-background" />
      ) : null}
    </span>
  );
};

export default Avatar;
