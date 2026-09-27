// The tab title ("Settings · OpenChat") and, for pages search engines
// shouldn't list, noindex: everything behind the login (people's chats and
// profiles are nobody's search result) and the 404. React puts both in the
// document head. The landing page sets its own, richer head (Landing.jsx).
const PageMeta = ({ title, noindex = false }) => (
  <>
    <title>{title ? `${title} · OpenChat` : "OpenChat"}</title>
    {noindex ? <meta name="robots" content="noindex" /> : null}
  </>
);

export default PageMeta;
