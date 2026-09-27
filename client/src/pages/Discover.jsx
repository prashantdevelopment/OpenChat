import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { ArrowDownIcon, XIcon } from "lucide-react";
import api from "../api/api.js";
import { INDIAN_STATES } from "../../../shared/indian-states.js";
import { useStatePresence } from "../hooks/useStatePresence.js";
import { useMediaQuery } from "../hooks/useMediaQuery.js";
import Avatar from "../components/Avatar.jsx";
import Masthead from "../components/Masthead.jsx";
import { Button } from "@/components/ui/button";
import { toastManager } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

// The map's drawing (~60 kB) is loaded only here, after the page itself.
const IndiaMap = lazy(() => import("../components/IndiaMap.jsx"));

const SEARCH_DELAY_MS = 300;
const POPUP_PEOPLE = 3;
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

// Opens (or starts) a chat with someone and goes there.
const useStartChat = () => {
  const navigate = useNavigate();
  const [openingId, setOpeningId] = useState(null);
  const start = async (user) => {
    setOpeningId(user._id);
    try {
      const res = await api.post("/conversations", { otherUserId: user._id });
      navigate(`/chat/${res.data.conversation._id}`);
    } catch (error) {
      setOpeningId(null);
      toastManager.add({ type: "error", title: `Couldn't open the chat with ${user.username}`, description: error.response?.data?.message ?? "Check your connection and try again." });
    }
  };
  return { start, openingId };
};

// The card next to the chosen state on the map: its count and the first few
// people you could write to. Only people who chose to be listed; never who
// is online.
const MapPopup = ({ state, online, onClose, onSeeEveryone, className, style }) => {
  const [people, setPeople] = useState({ state: null, users: [] });
  const { start, openingId } = useStartChat();

  useEffect(() => {
    let ignore = false;
    api
      .get("/users/discover", { params: { state } })
      .then((res) => !ignore && setPeople({ state, users: res.data.users.slice(0, POPUP_PEOPLE) }))
      .catch(() => !ignore && setPeople({ state, users: [] }));
    return () => {
      ignore = true;
    };
  }, [state]);

  const users = people.state === state ? people.users : null;
  return (
    <section
      aria-label={`${stateName(state)}: people you could write to`}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
      className={cn("border border-border bg-card p-5 text-card-foreground shadow-[0_30px_60px_-34px_rgb(60_40_20/0.5)]", className)}
      style={style}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-heading text-[36px] leading-none">{stateName(state)}</p>
          <p className="mt-1.5 font-mono text-xs text-success">
            ● {online === null || online === undefined ? "fewer than 5 online" : `${online} online`}
          </p>
        </div>
        <Button variant="ghost" size="icon" className="-mr-2 -mt-1 rounded-full" aria-label="Close" onClick={onClose}>
          <XIcon aria-hidden="true" strokeWidth={1.4} />
        </Button>
      </div>
      <p className="mt-2 font-heading text-[15px] text-muted-foreground italic">
        {users === null ? "Looking…" : users.length ? `${users.length === 1 ? "Someone" : users.length === 2 ? "Two people" : "Three people"} you could write to.` : "No one from here is listed yet."}
      </p>
      {users?.length ? (
        <ul className="mt-3">
          {users.map((user) => (
            <li key={user._id} className="flex items-center gap-3 border-t border-border py-2.5">
              <Avatar name={user.username} avatarId={user.avatar} className="size-9.5 border border-foreground bg-transparent text-lg text-foreground italic" />
              <span className="min-w-0 flex-1">
                <Link to={`/u/${user.username}`} className="block truncate text-sm font-semibold text-inherit no-underline hover:underline hover:decoration-1 hover:underline-offset-4">
                  {user.username}
                </Link>
                {user.bio ? <span className="block truncate text-[12.5px] text-muted-foreground">{user.bio}</span> : null}
              </span>
              <Button size="sm" className="rounded-full px-3.5" loading={openingId === user._id} onClick={() => start(user)}>
                Write
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <button
        type="button"
        onClick={onSeeEveryone}
        className="mt-2 flex w-full cursor-pointer items-center justify-between border-0 border-t border-border bg-transparent px-0 pt-3 text-sm text-foreground hover:text-brand"
      >
        See everyone from {stateName(state)}
        <ArrowDownIcon aria-hidden="true" strokeWidth={1.4} className="size-4" />
      </button>
    </section>
  );
};

// People from one state (only those who chose to be listed), with a
// username filter and "Load more". Never shows who is online.
const StatePeople = ({ state, scrollOnChange }) => {
  const headingRef = useRef(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState({ query: null, users: [], hasMore: false, error: false });
  const [loadingMore, setLoadingMore] = useState(false);
  const { start, openingId } = useStartChat();
  const trimmed = query.trim();

  // A new state was chosen: focus the heading. On phones (the list is above
  // it) also scroll to it if it is off screen; on wide screens the map's
  // popup already shows the state, so the page stays where it is.
  useEffect(() => {
    const heading = headingRef.current;
    if (!heading) return;
    const { top, bottom } = heading.getBoundingClientRect();
    if (scrollOnChange && (top < 0 || bottom > window.innerHeight)) {
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      heading.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    }
    heading.focus({ preventScroll: true });
    // Only when the state changes (not when the screen is resized).
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const isLoading = page.query !== trimmed;

  return (
    <div>
      <h2 ref={headingRef} tabIndex={-1} id="people-heading" className="scroll-mt-4 text-[34px] leading-tight outline-none">
        People in {stateName(state)}
      </h2>
      <label htmlFor="discover-search" className="mt-4 block font-mono text-[11px] tracking-[0.16em] text-muted-foreground uppercase">
        Search by username
      </label>
      <input
        id="discover-search"
        type="search"
        autoComplete="off"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="mt-1 h-11 w-full max-w-sm rounded-none border-0 border-b border-foreground bg-transparent px-0 focus-visible:outline-none"
      />

      <div role="status" className="mt-3 text-sm text-muted-foreground">
        {isLoading ? "Loading..." : page.error ? "Couldn't load people. Check your connection." : page.users.length === 0 ? (trimmed ? "No one matches that username." : `No one from ${stateName(state)} is listed yet.`) : null}
      </div>

      {page.users.length > 0 ? (
        <ul className="mt-2 border-b border-border">
          {page.users.map((user) => (
            <li key={user._id} className="flex items-center gap-3 border-t border-border py-3">
              <Avatar name={user.username} avatarId={user.avatar} className="bg-foreground text-lg text-background italic" />
              <span className="min-w-0 flex-1">
                <Link to={`/u/${user.username}`} className="block truncate font-semibold text-inherit no-underline hover:underline hover:decoration-1 hover:underline-offset-4">
                  {user.username}
                </Link>
                {user.bio ? <span className="block truncate text-sm text-muted-foreground">{user.bio}</span> : null}
              </span>
              <Button size="sm" className="rounded-full px-4" loading={openingId === user._id} onClick={() => start(user)}>
                Message
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {page.hasMore && !isLoading ? (
        <div className="mt-4 flex justify-center">
          <Button variant="outline" size="sm" className="rounded-full border-foreground" loading={loadingMore} onClick={loadMore}>
            Load more
          </Button>
        </div>
      ) : null}
    </div>
  );
};

// Discover, "the India edition": how many people are online in each state
// (counts only), a map of India to choose a state, and who is from there.
// The chosen state is in the URL (?state=kerala), so back and shared links work.
const Discover = () => {
  const [params, setParams] = useSearchParams();
  const selected = INDIAN_STATES.some((state) => state.code === params.get("state")) ? params.get("state") : null;
  const snapshot = useStatePresence();
  const [filter, setFilter] = useState("");
  const isWide = useMediaQuery("(min-width: 1024px)");

  const onlineIn = (code) => snapshot?.states.find((state) => state.code === code)?.online ?? null;
  const counts = Object.fromEntries((snapshot?.states ?? []).map((state) => [state.code, state.online]));
  // Busiest first; hidden (< 5) counts after, alphabetical.
  const states = INDIAN_STATES.filter((state) => state.name.toLowerCase().includes(filter.trim().toLowerCase())).sort(
    (a, b) => (onlineIn(b.code) ?? -1) - (onlineIn(a.code) ?? -1) || a.name.localeCompare(b.name),
  );
  const choose = (code) => setParams({ state: code });
  const close = () => setParams({});
  const seeEveryone = () => {
    const heading = document.getElementById("people-heading");
    heading?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    heading?.focus({ preventScroll: true });
  };

  const people = (
    <section aria-label="People" className="border-t border-border pt-8">
      {selected ? (
        <StatePeople key={selected} state={selected} scrollOnChange={!isWide} />
      ) : (
        <p className="font-heading text-2xl text-muted-foreground italic">Choose a state to see people from there.</p>
      )}
    </section>
  );

  return (
    // Desktop: the page fits the screen and never scrolls; only the left
    // column (states, then the people of the chosen state) scrolls inside,
    // and the map grows or shrinks with the window. Phones scroll normally.
    // (relative: screen-reader-only text, which is position: absolute, stays
    // inside the scrolling column instead of making the page taller.)
    <div className="min-h-dvh bg-background lg:relative lg:flex lg:h-dvh lg:flex-col lg:overflow-hidden">
      <Masthead discover={false} />

      <main id="main" className="lg:grid lg:min-h-0 lg:flex-1 lg:grid-cols-[440px_minmax(0,1fr)] xl:grid-cols-[480px_minmax(0,1fr)]">
        <section
          aria-labelledby="discover-heading"
          className="relative flex flex-col gap-6 px-5 pt-8 pb-8 md:px-10 lg:min-h-0 lg:overflow-y-auto lg:border-r lg:border-border lg:pt-10"
        >
          <h1 id="discover-heading" className="text-[56px] leading-[0.92] md:text-[76px]">
            India,
            <br />
            <span className="text-brand italic">tonight.</span>
          </h1>
          <p className="max-w-[400px] text-base leading-relaxed text-muted-foreground">
            Pick a state and write to someone new. We print how many people are online — never their names — and keep
            small numbers to ourselves.
          </p>
          <p className="font-mono text-xs tracking-[0.12em] text-foreground uppercase">
            {snapshot === null
              ? "Loading..."
              : snapshot.total === null
                ? "Fewer than 5 people online right now"
                : `${snapshot.total} people online right now`}
          </p>

          <div>
            <label htmlFor="state-filter" className="block font-mono text-[11px] tracking-[0.16em] text-muted-foreground uppercase">
              Filter
            </label>
            <input
              id="state-filter"
              type="search"
              autoComplete="off"
              placeholder="Kerala, Goa, Punjab…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="mt-1 h-10 w-full rounded-none border-0 border-b border-foreground bg-transparent px-0 focus-line focus-visible:outline-none"
            />
          </div>

          <ol aria-label="States and union territories" className="-mt-2 flex flex-col">
            {states.map((state, i) => {
              const isChosen = state.code === selected;
              return (
                <li key={state.code}>
                  <button
                    type="button"
                    data-slot="state-option"
                    aria-current={isChosen ? "true" : undefined}
                    onClick={() => choose(state.code)}
                    className={cn(
                      "flex w-full cursor-pointer items-baseline gap-3.5 border-0 border-t border-border bg-transparent px-1 py-3 text-left hover:text-brand",
                      isChosen ? "text-brand" : "text-foreground",
                    )}
                  >
                    <span aria-hidden="true" className="w-5 font-mono text-xs text-muted-foreground">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className={cn("min-w-0 truncate font-heading text-[26px] leading-tight", isChosen && "italic")}>{state.name}</span>
                    <span aria-hidden="true" className="min-w-4 flex-1 -translate-y-1.5 border-b border-dotted border-muted-foreground/60" />
                    <OnlineCount online={onlineIn(state.code)} className="shrink-0 font-mono text-[13px]" />
                  </button>
                </li>
              );
            })}
          </ol>
          {states.length === 0 ? <p className="text-sm text-muted-foreground">No state or union territory matches.</p> : null}

          {isWide ? people : null}

          <p className="mt-auto font-mono text-[10.5px] tracking-[0.08em] text-muted-foreground uppercase">
            Boundaries: Survey of India · fewer than 5 online: not shown
          </p>
        </section>

        {/* container-type: size, so the map can be as big as fits both ways
            (cqw / cqh: the width and height of this area). */}
        <div className="min-w-0 px-5 pb-16 md:px-10 lg:flex lg:min-h-0 lg:items-center lg:justify-center lg:p-8 lg:[container-type:size]">
          <div className="mx-auto w-full max-w-[663px] pt-6 lg:w-[min(100cqw,calc(100cqh*900/1031))] lg:max-w-none lg:pt-0">
            <Suspense fallback={<div className="aspect-[900/1031] w-full" />}>
              <IndiaMap
                counts={counts}
                selected={selected}
                onSelect={choose}
                renderPopup={
                  isWide
                    ? (code, place) => (
                        <>
                          {/* A hairline from the pin to the card. */}
                          <span
                            aria-hidden="true"
                            className="absolute h-px w-8 bg-foreground"
                            style={{ top: `${place.y}%`, ...(place.side === "right" ? { left: `${place.x}%` } : { right: `${100 - place.x}%` }) }}
                          />
                          <MapPopup
                            key={code}
                            state={code}
                            online={onlineIn(code)}
                            onClose={close}
                            onSeeEveryone={seeEveryone}
                            className="absolute z-10 w-[330px]"
                            style={{
                              top: `clamp(0px, calc(${place.y}% - 150px), calc(100% - 400px))`,
                              ...(place.side === "right" ? { left: `calc(${place.x}% + 32px)` } : { right: `calc(${100 - place.x}% + 32px)` }),
                            }}
                          />
                        </>
                      )
                    : null
                }
              />
            </Suspense>
            {selected && !isWide ? (
              <MapPopup key={selected} state={selected} online={onlineIn(selected)} onClose={close} onSeeEveryone={seeEveryone} className="mt-4" />
            ) : null}
          </div>

          {isWide ? null : <div className="mx-auto mt-12 max-w-2xl">{people}</div>}
        </div>
      </main>
    </div>
  );
};

export default Discover;
