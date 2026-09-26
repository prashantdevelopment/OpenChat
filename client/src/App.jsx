import { Navigate, Route, Routes } from "react-router";
import ProtectedRoute from "./auth/ProtectedRoute.jsx";
import Login from "./pages/Login.jsx";
import Register from "./pages/Register.jsx";
import Chat from "./pages/Chat.jsx";
import NotFound from "./pages/NotFound.jsx";
import ThemeToggle from "./components/ThemeToggle.jsx";

const App = () => {
  return (
    <>
      {/* On every page for now; the app layout (step 20) gives it a place in the header. */}
      <div className="fixed top-3 right-3 z-50">
        <ThemeToggle />
      </div>

      <Routes>
      <Route path="/" element={<Navigate to="/chat" replace />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />

      <Route element={<ProtectedRoute />}>
        {/* One route for both /chat and /chat/:id, so the page (and its
            conversation list) stays mounted while switching conversations. */}
        <Route path="/chat/:conversationId?" element={<Chat />} />
      </Route>

      <Route path="*" element={<NotFound />} />
      </Routes>
    </>
  );
};

export default App;
