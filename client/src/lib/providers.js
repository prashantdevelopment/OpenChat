import { useEffect, useState } from "react";
import api from "../api/api.js";

// How people can sign up / in on this server (GET /api/auth/providers):
// { google, emailSignup, emailCode, full }. Asked once per page load. If the server
// can't be asked, the email form stays (the server has the last word anyway).
let providers;
const getProviders = () => {
  providers ??= api.get("/auth/providers").then(
    (res) => res.data,
    () => ({ google: false, emailSignup: true, emailCode: true, full: false }),
  );
  return providers;
};

// null while asking.
export const useProviders = () => {
  const [value, setValue] = useState(null);
  useEffect(() => {
    let ignore = false;
    getProviders().then((result) => !ignore && setValue(result));
    return () => {
      ignore = true;
    };
  }, []);
  return value;
};
