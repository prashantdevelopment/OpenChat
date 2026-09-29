import { useEffect, useEffectEvent } from "react";
import { useLocation, useNavigate } from "react-router";
import socket from "../socket/socket.js";
import { getNotificationPrefs, playChime } from "../lib/notifications.js";
import { displayName } from "../lib/people.js";
import { toastManager } from "@/components/ui/toast";

// Group invites on every page of the app:
// - someone invites me: an alert with "See invite" (the invite waits at the top
//   of the chat list, which shows it by itself, so no alert there);
// - someone answers my invite: "Riya joined …" / "Riya declined …".
// With OpenChat closed or in the background, the server sends a push instead.
const GroupAlerts = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const onInvite = useEffectEvent((invite) => {
    if (location.pathname === "/chat") return;
    if (getNotificationPrefs().sound) playChime();
    toastManager.add({
      title: "Group invite",
      description: `${displayName(invite.from)} wants to add you to “${invite.group.name}”.`,
      actionProps: { children: "See invite", onClick: () => navigate("/chat") },
    });
  });

  useEffect(() => {
    const handleInvite = (invite) => onInvite(invite);
    const handleAnswered = ({ user, groupName, accepted }) =>
      toastManager.add({
        type: accepted ? "success" : undefined,
        title: accepted ? `${displayName(user)} joined “${groupName}”` : `${displayName(user)} declined your invite`,
        description: accepted ? undefined : `They weren't added to “${groupName}”.`,
      });
    socket.on("groupInvite", handleInvite);
    socket.on("groupInviteAnswered", handleAnswered);
    return () => {
      socket.off("groupInvite", handleInvite);
      socket.off("groupInviteAnswered", handleAnswered);
    };
  }, []);

  return null;
};

export default GroupAlerts;
