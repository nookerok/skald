/** Canonical Domain Event type strings for MVP-0. */
export const EventType = {
  PlayerSpawned: "PlayerSpawned",
  WallPlaced: "WallPlaced",
  CommandRejected: "CommandRejected",
  MoveRequested: "MoveRequested",
  MovementSucceeded: "MovementSucceeded",
  MovementBlocked: "MovementBlocked",
  ObservationUpdated: "ObservationUpdated",
} as const;

export type EventType = (typeof EventType)[keyof typeof EventType];