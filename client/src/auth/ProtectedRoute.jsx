import { Navigate, Outlet, useLocation } from "react-router";
import { useAuth } from "./AuthContext.js";
import Unlock from "../pages/Unlock.jsx";
import PublicLayout from "../components/PublicLayout.jsx";
import CallProvider from "../calls/CallProvider.jsx";
import MessageAlerts from "../notifications/MessageAlerts.jsx";

// Layout route: renders its child routes only for a logged-in user whose
// private key is unlocked on this device. Not logged in: redirect to /login
// and remember where the user wanted to go. Logged in but no key: ask for the
// password (the URL stays, so the user lands where they wanted afterwards).
// This is only for UX; the server still checks auth on every request.
const ProtectedRoute = () => {
  const { currentUser, privateKey } = useAuth();
  const location = useLocation();

  if (!currentUser) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  // Calls and new-message alerts live here, above the pages, so they keep
  // going between chat, Discover and settings.
  return privateKey ? (
    <CallProvider>
      <MessageAlerts>
        <Outlet />
      </MessageAlerts>
    </CallProvider>
  ) : (
    <PublicLayout>
      <Unlock />
    </PublicLayout>
  );
};

export default ProtectedRoute;
