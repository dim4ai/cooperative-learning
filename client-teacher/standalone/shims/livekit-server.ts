// 'livekit-server-sdk': the solo demo has no sound or video, so the rooms are only names; the page
// doesn't connect to LiveKit at all (App.tsx, STANDALONE)
export const TrackSource = { UNKNOWN: 0, CAMERA: 1, MICROPHONE: 2, SCREEN_SHARE: 3, SCREEN_SHARE_AUDIO: 4 } as const;

export class AccessToken {
  ttl: unknown;
  constructor(_key?: string, _secret?: string, _opts?: unknown) {}
  addGrant(_grant: unknown) {}
  async toJwt() { return 'standalone'; }
}

export class RoomServiceClient {
  constructor(_url?: string, _key?: string, _secret?: string) {}
  async createRoom(opts: { name: string }) { return { name: opts.name }; }
  async deleteRoom() {}
  async listRooms() { return []; }
  async listParticipants() { return []; }
  async removeParticipant() {}
  async updateParticipant() {}
  async mutePublishedTrack() {}
}
