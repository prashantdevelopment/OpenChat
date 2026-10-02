import { useEffect, useState } from "react";
import { Link } from "react-router";
import api from "../api/api.js";
import { Button } from "@/components/ui/button";
import { SearchIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import Avatar from "./Avatar.jsx";
import { INDIAN_STATES } from "../../../shared/indian-states.js";
import { displayName, handle } from "../lib/people.js";

const SEARCH_DELAY_MS = 300;

const stateName = (code) => INDIAN_STATES.find((state) => state.code === code)?.name;

// Search box for finding people by username. Calls onMessageUser(user) when
// the user clicks "Message" on a result. inMasthead: the underlined field in
// the top bar, with results floating below it on a paper card.
const UserSearch = ({ onMessageUser, inMasthead = false }) => {
  const [query, setQuery] = useState("");
  // The last finished search, with the query it belongs to. Results are only
  // shown when they match what is in the box right now.
  const [search, setSearch] = useState({ query: "", users: [], error: null });
  const trimmedQuery = query.trim();

  useEffect(() => {
    if (!trimmedQuery) {
      return;
    }

    // Debounce: wait until typing pauses, so "rahul" sends 1 request, not 5.
    // ignore: a slow answer for an older query must not replace a newer one.
    let ignore = false;
    const timer = setTimeout(async () => {
      try {
        const res = await api.get("/users/search", { params: { q: trimmedQuery } });
        if (!ignore) setSearch({ query: trimmedQuery, users: res.data.users, error: null });
      } catch {
        if (!ignore) setSearch({ query: trimmedQuery, users: [], error: "Search failed. Please try again." });
      }
    }, SEARCH_DELAY_MS);

    return () => {
      ignore = true;
      clearTimeout(timer);
    };
  }, [trimmedQuery]);

  const hasResults = trimmedQuery !== "" && search.query === trimmedQuery;

  let status = null;
  if (trimmedQuery && !hasResults) status = "Searching...";
  else if (hasResults && search.error) status = search.error;
  else if (hasResults && search.users.length === 0) status = "No users found";

  const showPanel = Boolean(status) || (hasResults && search.users.length > 0);

  return (
    <div className={cn("relative", inMasthead && "w-72 max-lg:w-56")}>
      <label htmlFor="user-search" className={cn("mb-1.5 block text-sm font-medium", inMasthead && "sr-only")}>
        Find people
      </label>
      <div className={cn("flex items-center gap-2.5 border-b border-foreground focus-line", !inMasthead && "border-input")}>
        <SearchIcon aria-hidden="true" strokeWidth={1.3} className="size-4 shrink-0 text-muted-foreground" />
        <input
        id="user-search"
        type="search"
        className="h-10 w-full rounded-none border-0 bg-transparent px-0 outline-none focus-visible:outline-none"
        placeholder={inMasthead ? "Search people" : "Search by username"}
        autoComplete="off"
        maxLength={30}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      </div>
      <div
        className={cn(
          inMasthead && "absolute top-full right-0 z-40 mt-2 w-80 border border-border bg-card p-3 shadow-[0_24px_48px_-24px_rgb(10_30_25/0.45)]",
          inMasthead && !showPanel && "hidden",
        )}
      >

      {/* aria-live: screen readers announce "No users found" etc. */}
      <p
        aria-live="polite"
        className={cn(
          "text-sm",
          status && "mt-2",
          hasResults && search.error ? "text-destructive-foreground" : "text-muted-foreground",
        )}
      >
        {status}
      </p>

      {hasResults && search.users.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-1">
          {search.users.map((user) => (
            <li key={user._id} className="flex items-center gap-3 rounded-lg px-1 py-1.5">
              <Avatar name={displayName(user)} avatarId={user.avatar} className="size-9 text-sm" />
              <span className="min-w-0 flex-1">
                <Link to={`/u/${user.username}`} className="block truncate font-medium text-inherit no-underline hover:underline hover:decoration-1 hover:underline-offset-4">
                  {displayName(user)}
                </Link>
                {/* "@riya_k · Kerala · bio" on one line, cut off with … when too long. */}
                <span className="block truncate text-xs text-muted-foreground">
                  {[handle(user), stateName(user.state), user.bio].filter(Boolean).join(" · ")}
                </span>
              </span>
              <Button
                size="sm"
                className="rounded-full"
                onClick={() => {
                  setQuery("");
                  onMessageUser(user);
                }}
              >
                Message
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      </div>
    </div>
  );
};

export default UserSearch;
