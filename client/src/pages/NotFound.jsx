import { Link } from "react-router";

const NotFound = () => {
  return (
    <div>
      <h1>Page not found</h1>
      <p>
        <Link to="/chat">Go to your chats</Link>
      </p>
    </div>
  );
};

export default NotFound;
