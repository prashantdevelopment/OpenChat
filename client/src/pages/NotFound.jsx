import { Link } from "react-router";
import AuthCard from "../components/AuthCard.jsx";

const NotFound = () => {
  return (
    <AuthCard title="Page not found" description="This page doesn't exist or was moved.">
      <Link to="/chat">Go to your chats</Link>
    </AuthCard>
  );
};

export default NotFound;
