import { precacheAndRoute } from "workbox-precaching";

precacheAndRoute(self.__WB_MANIFEST);

// Authenticated API responses are intentionally never cached.

self.skipWaiting();
self.addEventListener("activate", () => self.clients.claim());

self.addEventListener("push", (event) => {
  let data = { title: "Nudge", body: "You have a task due.", url: "/" };
  try {
    const incoming = event.data?.json();
    if (incoming && typeof incoming === "object") {
      data = {
        title: typeof incoming.title === "string" ? incoming.title.slice(0, 80) : data.title,
        body: typeof incoming.body === "string" ? incoming.body.slice(0, 240) : data.body,
        url: typeof incoming.url === "string" && incoming.url.startsWith("/") ? incoming.url : "/",
        taskId: Number.isInteger(incoming.taskId) ? incoming.taskId : undefined,
        workspace: typeof incoming.workspace === "string" ? incoming.workspace.slice(0, 80) : undefined,
      };
    }
  } catch {
    // Keep the safe generic payload.
  }
  event.waitUntil((async () => {
    await self.registration.showNotification(data.title || "Nudge", {
      body: data.body || "",
      icon: "/icon.svg",
      badge: "/icon.svg",
      tag: data.taskId ? `task-${data.taskId}` : "nudge-test",
      vibrate: [180, 80, 180],
      data: { url: data.url || "/", taskId: data.taskId, workspace: data.workspace },
    });
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  clients.forEach((client) => client.postMessage({ type: "nudge:push-received", payload: data }));
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows[0];
    if (existing) {
      await existing.focus();
      existing.postMessage({ type: "nudge:notification-open", taskId: event.notification.data?.taskId });
      return;
    }
    await self.clients.openWindow(url);
  })());
});

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(self.registration.pushManager.subscribe(event.oldSubscription?.options || { userVisibleOnly: true }));
});
