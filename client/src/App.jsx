import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router";
import { m } from "motion/react";
import ProtectedRoute from "./auth/ProtectedRoute.jsx";
import PublicLayout from "./components/PublicLayout.jsx";
import Login from "./pages/Login.jsx";
import Register from "./pages/Register.jsx";
import Chat from "./pages/Chat.jsx";
import NotFound from "./pages/NotFound.jsx";
import Landing from "./pages/Landing.jsx";
import { Spinner } from "@/components/ui/spinner";

// Opened now and then, so it is downloaded only when needed (its own file).
const Settings = lazy(() => import("./pages/Settings.jsx"));
const Discover = lazy(() => import("./pages/Discover.jsx"));

const PageSpinner = () => (
  <div className="flex h-dvh items-center justify-center text-muted-foreground">
    <Spinner className="size-6" />
  </div>
);

// A short fade when a page appears (chats, Discover, Settings). Inside the
// Suspense of lazy pages, so it runs when the page is really there, not while
// its file loads. Opacity only: a transform would change how fixed elements
// in the page are positioned. Switching conversations keeps the Chat page.
const PageFade = ({ children }) => (
  <m.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15, ease: "easeOut" }}>
    {children}
  </m.div>
);

const App = () => {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />

      <Route element={<PublicLayout />}>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="*" element={<NotFound />} />
      </Route>

      <Route element={<ProtectedRoute />}>
        {/* One route for both /chat and /chat/:id, so the page (and its
            conversation list) stays mounted while switching conversations. */}
        <Route
          path="/chat/:conversationId?"
          element={
            <PageFade>
              <Chat />
            </PageFade>
          }
        />
        <Route
          path="/discover"
          element={
            <Suspense fallback={<PageSpinner />}>
              <PageFade>
                <Discover />
              </PageFade>
            </Suspense>
          }
        />
        <Route
          path="/settings"
          element={
            <Suspense fallback={<PageSpinner />}>
              <PageFade>
                <Settings />
              </PageFade>
            </Suspense>
          }
        />
      </Route>
    </Routes>
  );
};

export default App;
