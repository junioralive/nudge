import {
  disablePushDevice,
  fetchPushStatus,
  getVapidPublicKey,
  saveSubscription,
  sendTestPush as requestTestPush,
} from "./api.js";

const DEVICE_ID_KEY = "nudge-push-device-id";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

function deviceId() {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID?.() || `device-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

function deviceName() {
  const platform = navigator.userAgentData?.platform || navigator.platform || "Device";
  const browser = /Firefox/i.test(navigator.userAgent) ? "Firefox"
    : /Edg/i.test(navigator.userAgent) ? "Edge"
      : /CriOS|Chrome/i.test(navigator.userAgent) ? "Chrome"
        : /Safari/i.test(navigator.userAgent) ? "Safari" : "Browser";
  return `${browser} on ${platform}`.slice(0, 120);
}

function needsIosInstall() {
  const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const standalone = window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true;
  return ios && !standalone;
}

function baseState(state, detail, extra = {}) {
  return { state, detail, deviceId: deviceId(), deviceName: deviceName(), ...extra };
}

export async function reconcilePushNotifications() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return baseState("unsupported", "This browser does not support web push.");
  }
  if (needsIosInstall()) return baseState("install-required", "Install Nudge to your Home Screen, then enable notifications from the installed app.");
  if (Notification.permission === "denied") return baseState("blocked", "Notifications are blocked in browser settings.");

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  const server = await fetchPushStatus(deviceId());
  if (subscription && !server.current?.enabled_at) {
    await saveSubscription(deviceId(), deviceName(), subscription.toJSON());
  }
  const refreshed = subscription && !server.current?.enabled_at ? await fetchPushStatus(deviceId()) : server;
  if (!subscription) {
    return baseState("disconnected", "Enable this device to receive due-time reminders.", { server: refreshed });
  }
  if (refreshed.current?.disabled_at) {
    return baseState("disconnected", "This device registration expired. Enable it again.", { server: refreshed });
  }
  return baseState("enabled", "This device is registered with Nudge.", { server: refreshed });
}

export async function enablePushNotifications() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    throw new Error("Push notifications are not supported in this browser.");
  }
  if (needsIosInstall()) throw new Error("Install Nudge to your Home Screen first, then enable notifications there.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notification permission was not granted. Check browser settings.");
  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    const publicKey = await getVapidPublicKey();
    subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
  }
  await saveSubscription(deviceId(), deviceName(), subscription.toJSON());
  return reconcilePushNotifications();
}

export async function disablePushNotifications() {
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  await Promise.allSettled([subscription?.unsubscribe(), disablePushDevice(deviceId())]);
  return reconcilePushNotifications();
}

export async function sendPushTest() {
  await requestTestPush(deviceId());
  return reconcilePushNotifications();
}
