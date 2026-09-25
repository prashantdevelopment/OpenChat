import { Navigate, Outlet, useLocation } from "react-router";
import { useAuth } from "./AuthContext.js";

// Layout route: renders its child routes only for a logged-in user.
// Otherwise it redirects to /login and remembers where the user wanted to go.
// This is only for UX; the server still checks auth on every request.
const ProtectedRoute = () => {
  const { currentUser } = useAuth();
  const location = useLocation();

  return currentUser ? (
    <Outlet />
  ) : (
    <Navigate to="/login" replace state={{ from: location.pathname }} />
  );
};

export default ProtectedRoute;
