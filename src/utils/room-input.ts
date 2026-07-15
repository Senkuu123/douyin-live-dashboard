const LIVE_HOSTS = new Set(["live.douyin.com", "www.live.douyin.com"]);

function roomIdFromUrl(url: URL): string | null {
  if (!LIVE_HOSTS.has(url.hostname.toLowerCase())) return null;
  const roomId = url.pathname.split("/").filter(Boolean)[0];
  return roomId && /^\d+$/.test(roomId) ? roomId : null;
}

export async function resolveRoomInput(input: string): Promise<string> {
  const trimmed = input.trim();
  if (/^\d+$/.test(trimmed)) return trimmed;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("直播间输入必须是数字房间号或抖音直播链接");
  }

  const directRoomId = roomIdFromUrl(url);
  if (directRoomId) return directRoomId;

  if (url.hostname.toLowerCase() === "v.douyin.com") {
    const response = await fetch(url, { method: "HEAD", redirect: "follow" });
    const redirectedRoomId = roomIdFromUrl(new URL(response.url));
    if (redirectedRoomId) return redirectedRoomId;
  }

  throw new Error("无法从链接中识别抖音直播间房间号");
}
