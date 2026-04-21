import Gamedig from "gamedig";

export async function checkServer(host, port) {
  try {
    await Gamedig.query({
      type: "dayz",
      host,
      port
    });
    return true;
  } catch {
    return false;
  }
}
