import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ArrowUpRightIcon } from "lucide-react";
import api from "../api/api.js";
import { useAuth } from "../auth/AuthContext.js";
import { computeSafetyNumber } from "../crypto/safetyNumber.js";
import { INDIAN_STATES } from "../../../shared/indian-states.js";
import ViewableAvatar from "../components/PhotoViewer.jsx";
import Masthead from "../components/Masthead.jsx";
import PageMeta from "../components/PageMeta.jsx";
import PersonActions from "../components/PersonActions.jsx";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toastManager } from "@/components/ui/toast";
import { displayName, handle } from "../lib/people.js";

const stateName = (code) => INDIAN_STATES.find((state) => state.code === code)?.name;

// A person's public page (/u/:username): the same public facts as search
// (name, photo, bio, state), set like a magazine profile, with a "Message"
// button, the safety number to compare, and Block / Report. Never shows
// whether they are online (that is only for people who already chat).
const Profile = () => {
  const { username } = useParams();
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  // { username, user, status }: "loading" | "ready" | "missing" | "error", for this username.
  const [result, setResult] = useState({ username: null, user: null, status: "loading" });
  const [safety, setSafety] = useState(null);
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    let ignore = false;
    api
      .get(`/users/${encodeURIComponent(username)}`)
      .then((res) => !ignore && setResult({ username, user: res.data.user, status: "ready" }))
      .catch((error) => !ignore && setResult({ username, user: null, status: error.response?.status === 404 ? "missing" : "error" }));
    return () => {
      ignore = true;
    };
  }, [username]);

  const state = result.username === username ? result : { user: null, status: "loading" };
  const user = state.user;
  const isMe = user?._id === currentUser._id;

  useEffect(() => {
    if (!user?.publicKey || isMe) return;
    let ignore = false;
    computeSafetyNumber(currentUser.publicKey, user.publicKey).then((number) => !ignore && setSafety({ key: user.publicKey, number }));
    return () => {
      ignore = true;
    };
  }, [currentUser.publicKey, user?.publicKey, isMe]);

  const message = async () => {
    setOpening(true);
    try {
      const res = await api.post("/conversations", { otherUserId: user._id });
      navigate(`/chat/${res.data.conversation._id}`);
    } catch (error) {
      setOpening(false);
      toastManager.add({ type: "error", title: `Couldn't open the chat with ${displayName(user)}`, description: error.response?.data?.message ?? "Check your connection and try again." });
    }
  };

  const setBlocked = (blocked) => setResult((current) => ({ ...current, user: { ...current.user, blockedByMe: blocked } }));

  const number = safety && user && safety.key === user.publicKey ? safety.number : null;
  const place = stateName(user?.state);

  return (
    <div className="min-h-dvh bg-background">
      {/* "Riya Nair (@riya_k)"; just the username when there is no other name. */}
      <PageMeta title={state.status !== "ready" ? "Profile" : user.name && user.name !== user.username ? `${user.name} (${handle(user)})` : user.username} noindex />
      <Masthead />
      <main id="main" className="mx-auto max-w-3xl px-5 py-10 md:px-10 md:py-16">
        <p className="font-mono text-[11px] tracking-[0.16em] text-muted-foreground uppercase">Profile</p>
        {state.status === "loading" ? (
          <div role="status" className="mt-6 space-y-4">
            <span className="sr-only">Loading profile...</span>
            <Skeleton className="size-24 rounded-full" />
            <Skeleton className="h-14 w-2/3" />
            <Skeleton className="h-6 w-1/2" />
          </div>
        ) : state.status === "missing" || state.status === "error" ? (
          <div role="alert" className="mt-6">
            <h1 className="text-[2.125rem] leading-tight md:text-5xl">{state.status === "missing" ? `No one called ${username}` : "Couldn't load this profile"}</h1>
            <p className="mt-3 text-muted-foreground">
              {state.status === "missing" ? "Check the spelling, or find people in the search." : "Check your connection and try again."}
            </p>
            <Button render={<Link to="/chat" />} variant="outline" className="mt-6 rounded-full border-foreground px-5">
              Back to chats
            </Button>
          </div>
        ) : (
          <article className="mt-6">
            <ViewableAvatar name={displayName(user)} avatarId={user.avatar} className="size-24 bg-brand text-5xl text-brand-foreground" />
            <h1 className="mt-6 text-[2.375rem] leading-none wrap-break-word md:text-7xl">{displayName(user)}</h1>
            <p className="mt-3 text-muted-foreground">{handle(user)}</p>
            {user.bio ? <p className="mt-6 max-w-xl font-heading text-2xl leading-snug md:text-3xl">“{user.bio}”</p> : null}
            <p className="mt-4 font-mono text-xs tracking-[0.14em] text-muted-foreground uppercase">
              {place ? `${place} · ` : ""}on OpenChat
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              {isMe ? (
                <Button render={<Link to="/settings" />} variant="outline" className="h-12 rounded-full border-foreground px-6 sm:h-12">
                  Edit your profile
                </Button>
              ) : (
                <Button onClick={message} loading={opening} className="h-12.5 gap-3 rounded-full pr-1.5 pl-6 text-[0.9375rem] sm:h-12.5 sm:text-[0.9375rem]">
                  Message {displayName(user)}
                  <span className="grid size-9.5 place-items-center rounded-full bg-primary-foreground text-primary">
                    <ArrowUpRightIcon aria-hidden="true" strokeWidth={1.7} />
                  </span>
                </Button>
              )}
            </div>

            {user.blockedByMe ? (
              <p role="status" className="mt-6 max-w-xl border-l-2 border-brand pl-4 text-sm">
                You blocked {displayName(user)}. Neither of you can message or call the other until you unblock them.
              </p>
            ) : null}

            {!isMe ? (
              <section aria-labelledby="safety-heading" className="mt-12 border-t border-border pt-6">
                <h2 id="safety-heading" className="text-2xl">
                  Safety number
                </h2>
                <p className="mt-2 max-w-xl text-sm text-muted-foreground">
                  Your chats with {displayName(user)} are end-to-end encrypted. To be sure nobody is in the middle, compare this
                  number with them in person or on a call. It must be the same on both screens.
                </p>
                <p className="mt-4 grid max-w-md grid-cols-4 gap-x-4 gap-y-2 font-mono text-base tracking-wider">
                  {number ? number.split(" ").map((group, i) => <span key={i}>{group}</span>) : <span className="col-span-4">Calculating...</span>}
                </p>
              </section>
            ) : null}

            {!isMe ? (
              <section aria-labelledby="safety-actions-heading" className="mt-10 border-t border-border pt-6">
                <h2 id="safety-actions-heading" className="text-2xl">
                  Block or report
                </h2>
                <p className="mt-2 mb-5 max-w-xl text-sm text-muted-foreground">
                  If {displayName(user)} bothers you, block them. Report them if they break the rules; they won&apos;t know who reported them.
                </p>
                <PersonActions user={user} blocked={Boolean(user.blockedByMe)} onBlockedChange={setBlocked} />
              </section>
            ) : null}
          </article>
        )}
      </main>
    </div>
  );
};

export default Profile;
