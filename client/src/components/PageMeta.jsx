import { useContext } from "react";
import { titleWithUnread } from "../lib/notifications.js";
import { UnreadContext } from "../notifications/UnreadContext.js";

// The tab title ("Settings · OpenChat", "(3) Settings · OpenChat" with unread
// messages) and, for pages search engines
// shouldn't list, noindex: everything behind the login (people's chats and
// profiles are nobody's search result) and the 404. React puts both in the
// document head. The landing page sets its own, richer head (Landing.jsx).
const PageMeta = ({ title, noindex = false }) => {
  const unread = useContext(UnreadContext);
  return (
    <>
      <title>{titleWithUnread(unread, title ? `${title} · OpenChat` : "OpenChat")}</title>
      {noindex ? <meta name="robots" content="noindex" /> : null}
    </>
  );
};

export default PageMeta;
