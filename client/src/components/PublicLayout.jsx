import { Outlet } from "react-router";
import ThemeToggle from "./ThemeToggle.jsx";

// Frame for pages outside the chat (login, register, 404, unlock): the theme
// toggle in the corner. Used as a layout route (renders the child route) or
// around children directly.
const PublicLayout = ({ children }) => {
  return (
    <>
      <div className="fixed top-3 right-3 z-50">
        <ThemeToggle />
      </div>
      {children ?? <Outlet />}
    </>
  );
};

export default PublicLayout;
