// Live sessions: session id -> a function that sends one frame to that session's browser, plus
// listeners that want to see the frames pushed to a session (the proxy watches for intake_recorded
// to run the End flow). The proxy registers a session when it starts and removes it on shutdown;
// the tool routes (src/toolRoutes.js) push the session_details / intake_recorded / urgent_flag
// frames through here.
const senders = new Map();
const listeners = new Map(); // session id -> Set of (frame) => void

export function registerSession(id, send) {
  senders.set(id, send);
}

export function unregisterSession(id) {
  senders.delete(id);
  listeners.delete(id);
}

// Subscribe to every frame pushed to one session; returns the unsubscribe function.
export function onSessionFrame(id, listener) {
  let set = listeners.get(id);
  if (!set) {
    set = new Set();
    listeners.set(id, set);
  }
  set.add(listener);
  return () => {
    set.delete(listener);
    if (!set.size && listeners.get(id) === set) listeners.delete(id);
  };
}

// True when the frame was handed to a connected browser; false when the session is not live.
// Listeners are told either way.
export function pushToSession(id, frame) {
  const send = senders.get(id);
  let delivered = false;
  if (send) {
    try {
      send(frame);
      delivered = true;
    } catch {}
  }
  for (const listener of listeners.get(id) ?? []) {
    try { listener(frame); } catch {}
  }
  return delivered;
}

export const liveSessionCount = () => senders.size;
