import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router";
import ProtectedRoute from "./auth/ProtectedRoute.jsx";
import PublicLayout from "./components/PublicLayout.jsx";
import Login from "./pages/Login.jsx";
import Register from "./pages/Register.jsx";
import Chat from "./pages/Chat.jsx";
import NotFound from "./pages/NotFound.jsx";
import { Spinner } from "@/components/ui/spinner";

// Opened now and then, so it is downloaded only when needed (its own file).
const Settings = lazy(() => import("./pages/Settings.jsx"));

const PageSpinner = () => (
  <div className="flex h-dvh items-center justify-center text-muted-foreground">
    <Spinner className="size-6" />
  </div>
);

const App = () => {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/chat" replace />} />

      <Route element={<PublicLayout />}>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="*" element={<NotFound />} />
      </Route>

      <Route element={<ProtectedRoute />}>
        {/* One route for both /chat and /chat/:id, so the page (and its
            conversation list) stays mounted while switching conversations. */}
        <Route path="/chat/:conversationId?" element={<Chat />} />
        <Route
          path="/settings"
          element={
            <Suspense fallback={<PageSpinner />}>
              <Settings />
            </Suspense>
          }
        />
      </Route>
    </Routes>
  );
};

export default App;
