import { Link } from "react-router";
import AuthCard from "../components/AuthCard.jsx";
import { Button } from "@/components/ui/button";

const NotFound = () => {
  return (
    <AuthCard title="Page not found" description="This page doesn't exist or was moved." tagline={["Nothing", "printed here."]}>
      <Button render={<Link to="/chat" />} className="h-12 rounded-full px-6 sm:h-12">
        Go to your chats
      </Button>
    </AuthCard>
  );
};

export default NotFound;
