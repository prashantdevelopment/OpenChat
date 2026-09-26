import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { ArrowLeftIcon, UsersIcon } from "lucide-react";
import api from "../api/api.js";
import { INDIAN_STATES } from "../../../shared/indian-states.js";
import { useStatePresence } from "../hooks/useStatePresence.js";
import Avatar from "../components/Avatar.jsx";
import { Button } from "@/components/ui/button";
import { toastManager } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

// three.js is big: loaded only here, after the page itself.
const IndiaTileMap = lazy(() => import("../components/IndiaTileMap.jsx"));

const SEARCH_DELAY_MS = 300;
const stateName = (code) => INDIAN_STATES.find((state) => state.code === code)?.name ?? code;

// "12 online", or "< 5" when the server hides a small count (null).
const OnlineCount = ({ online, className }) =>
  online === null || online === undefined ? (
    <span className={className} title="Fewer than 5 people online. Small numbers are hidden so nobody can be picked out.">
      &lt; 5<span className="sr-only"> people online (fewer than 5)</span>
    </span>
  ) : (
    <span className={className}>
      {online}
      <span className="sr-only"> online</span>
    </span>
  );

// People from one state (only those who chose to be listed), with a
// username filter and "Load more". Never shows who is online.
const StatePeople = ({ state }) => {
  const navigate = useNavigate();
  const headingRef = useRef(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState({ query: null, users: [], hasMore: false, error: false });
  const [loadingMore, setLoadingMore] = useState(false);
  const [openingId, setOpeningId] = useState(null);
  const trimmed = query.trim();

  // A new state was chosen: focus the heading, and scroll to it only if it is
  // off screen (phones, where the list is above; on wide screens it's beside).
  useEffect(() => {
    const heading = headingRef.current;
    if (!heading) return;
    const { top, bottom } = heading.getBoundingClientRect();
    if (top < 0 || bottom > window.innerHeight) {
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      heading.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    }
    heading.focus({ preventScroll: true });
  }, [state]);

  // First page for the current filter (debounced while typing).
  useEffect(() => {
    let ignore = false;
    const timer = setTimeout(async () => {
      try {
        const res = await api.get("/users/discover", { params: { state, q: trimmed || undefined } });
        if (!ignore) setPage({ query: trimmed, users: res.data.users, hasMore: res.data.hasMore, error: false });
      } catch {
        if (!ignore) setPage({ query: trimmed, users: [], hasMore: false, error: true });
      }
    }, trimmed ? SEARCH_DELAY_MS : 0);
    return () => {
      ignore = true;
      clearTimeout(timer);
    };
  }, [state, trimmed]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const res = await api.get("/users/discover", { params: { state, q: trimmed || undefined, after: page.users.at(-1).username } });
      setPage((prev) => ({ ...prev, users: [...prev.users, ...res.data.users], hasMore: res.data.hasMore }));
    } catch {
      toastManager.add({ type: "error", title: "Couldn't load more people", description: "Check your connection and try again." });
    } finally {
      setLoadingMore(false);
    }
  };

  const message = async (user) => {
    setOpeningId(user._id);
    try {
      const res = await api.post("/conversations", { otherUserId: user._id });
      navigate(`/chat/${res.data.conversation._id}`);
    } catch (error) {
      setOpeningId(null);
      toastManager.add({ type: "error", title: `Couldn't open the chat with ${user.username}`, description: error.response?.data?.message ?? "Check your connection and try again." });
    }
  };

  const isLoading = page.query !== trimmed;

  return (
    <div>
      <h2 ref={headingRef} tabIndex={-1} id="people-heading" className="scroll-mt-4 text-lg outline-none">
        People in {stateName(state)}
      </h2>
      <label htmlFor="discover-search" className="mt-3 mb-1.5 block text-sm font-medium">
        Search by username
      </label>
      <input id="discover-search" type="search" className="w-full" autoComplete="off" value={query} onChange={(e) => setQuery(e.target.value)} />

      <div role="status" className="mt-3 text-sm text-muted-foreground">
        {isLoading ? "Loading..." : page.error ? "Couldn't load people. Check your connection." : page.users.length === 0 ? (trimmed ? "No one matches that username." : `No one from ${stateName(state)} is listed yet.`) : null}
      </div>

      {page.users.length > 0 ? (
        <ul className="mt-2 divide-y divide-border">
          {page.users.map((user) => (
            <li key={user._id} className="flex items-center gap-3 py-3">
              <Avatar name={user.username} avatarId={user.avatar} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{user.username}</span>
                {user.bio ? <span className="block truncate text-sm text-muted-foreground">{user.bio}</span> : null}
              </span>
              <Button variant="outline" size="sm" loading={openingId === user._id} onClick={() => message(user)}>
                Message
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {page.hasMore && !isLoading ? (
        <div className="mt-3 flex justify-center">
          <Button variant="outline" size="sm" loading={loadingMore} onClick={loadMore}>
            Load more
          </Button>
        </div>
      ) : null}
    </div>
  );
};

// Discover: how many people are online in each state (counts only), and who
// is from there. The chosen state is in the URL (?state=kerala), so the back
// button and shared links work.
const Discover = () => {
  const [params, setParams] = useSearchParams();
  const selected = INDIAN_STATES.some((state) => state.code === params.get("state")) ? params.get("state") : null;
  const snapshot = useStatePresence();
  const [filter, setFilter] = useState("");

  const onlineIn = (code) => snapshot?.states.find((state) => state.code === code)?.online ?? null;
  // Busiest first; hidden (< 5) counts after, alphabetical.
  const states = INDIAN_STATES.filter((state) => state.name.toLowerCase().includes(filter.trim().toLowerCase())).sort(
    (a, b) => (onlineIn(b.code) ?? -1) - (onlineIn(a.code) ?? -1) || a.name.localeCompare(b.name),
  );

  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-3">
          <Button render={<Link to="/chat" />} variant="ghost" size="icon" className="-ml-2" aria-label="Back to chats">
            <ArrowLeftIcon aria-hidden="true" />
          </Button>
          <h1 className="text-lg">Discover</h1>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">
        <p className="text-muted-foreground">
          Find people across India. You see how many are online in each state, never who.
        </p>
        <p className="mt-3 flex items-center gap-2 font-medium">
          <UsersIcon aria-hidden="true" className="size-5 text-primary" />
          {snapshot === null ? (
            "Loading..."
          ) : snapshot.total === null ? (
            "Fewer than 5 people online right now"
          ) : (
            `${snapshot.total} people online right now`
          )}
        </p>

        <div className="mt-4 h-64 overflow-hidden rounded-2xl border border-border bg-muted/40 sm:h-80 lg:h-96">
          <Suspense fallback={null}>
            <IndiaTileMap
              counts={Object.fromEntries((snapshot?.states ?? []).map((state) => [state.code, state.online]))}
              selected={selected}
              onSelect={(code) => setParams({ state: code })}
            />
          </Suspense>
        </div>

        <div className="mt-6 grid gap-8 md:grid-cols-[18rem_1fr]">
          <section aria-labelledby="states-heading" className="min-w-0">
            <h2 id="states-heading" className="text-lg">
              States and union territories
            </h2>
            <label htmlFor="state-filter" className="mt-3 mb-1.5 block text-sm font-medium">
              Filter
            </label>
            <input id="state-filter" type="search" className="w-full" autoComplete="off" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <ul className="mt-3 flex flex-col gap-0.5 md:max-h-[60dvh] md:overflow-y-auto">
              {states.map((state) => (
                <li key={state.code}>
                  <button
                    type="button"
                    data-slot="state-option"
                    aria-current={state.code === selected ? "true" : undefined}
                    onClick={() => setParams({ state: state.code })}
                    className={cn(
                      "flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-accent",
                      state.code === selected && "bg-accent font-semibold",
                    )}
                  >
                    <span className="min-w-0 truncate">{state.name}</span>
                    <OnlineCount online={onlineIn(state.code)} className="shrink-0 rounded-full bg-muted px-2 text-xs tabular-nums text-muted-foreground" />
                  </button>
                </li>
              ))}
            </ul>
            {states.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">No state or union territory matches.</p> : null}
          </section>

          <section aria-label="People" className="min-w-0">
            {selected ? (
              <StatePeople key={selected} state={selected} />
            ) : (
              <p className="rounded-xl border border-dashed border-border p-8 text-center text-muted-foreground">
                Choose a state to see people from there.
              </p>
            )}
          </section>
        </div>
      </main>
    </div>
  );
};

export default Discover;
