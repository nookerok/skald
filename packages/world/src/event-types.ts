/** Canonical Domain Event type strings. */
export const EventType = {
  // Legacy events (Iteration 0–14, kept for backward compatibility)
  PlayerSpawned: "PlayerSpawned",
  WallPlaced: "WallPlaced",
  CommandRejected: "CommandRejected",
  MoveRequested: "MoveRequested",
  MovementSucceeded: "MovementSucceeded",
  MovementBlocked: "MovementBlocked",
  ObservationUpdated: "ObservationUpdated",
  TickPassed: "TickPassed",
  ConsequenceCreated: "ConsequenceCreated",
  ConsequenceExpired: "ConsequenceExpired",
  ConsequenceFired: "ConsequenceFired",
  AudacityTriggered: "AudacityTriggered",
  SituationStarted: "SituationStarted",
  SituationEnded: "SituationEnded",
  ForestFireStarted: "ForestFireStarted",
  TreeBurned: "TreeBurned",
  GiveRequested: "GiveRequested",
  RelationChanged: "RelationChanged",
  HeatSourcePlaced: "HeatSourcePlaced",
  HeatRadiated: "HeatRadiated",
  ActionRejected: "ActionRejected",
  ActionValidated: "ActionValidated",
  GiveValidated: "GiveValidated",
  ActionCompleted: "ActionCompleted",
  StrategySet: "StrategySet",

  // Iteration 15 — Open Intent & Critical Checks
  ActionAttempted: "ActionAttempted",
  ActionResolved: "ActionResolved",
  ActionBlocked: "ActionBlocked",
  ActionHadNoObservableEffect: "ActionHadNoObservableEffect",
  LocationDefined: "LocationDefined",
  PlayerLocationChanged: "PlayerLocationChanged",
  WorldObjectPlaced: "WorldObjectPlaced",
  ObjectObserved: "ObjectObserved",
  ObjectTemperatureChanged: "ObjectTemperatureChanged",
  ObjectIntegrityChanged: "ObjectIntegrityChanged",
  PassageOpened: "PassageOpened",
  SoundProduced: "SoundProduced",
  CriticalCheckRequested: "CriticalCheckRequested",
  CriticalCheckRolled: "CriticalCheckRolled",
  CriticalCheckResolved: "CriticalCheckResolved",

  // World Interaction Model — first vertical slice (examine/perception)
  ObjectPlaced: "ObjectPlaced",
  InteractionRequested: "InteractionRequested",
  InteractionTimeValidated: "InteractionTimeValidated",
  TargetResolved: "TargetResolved",
  InteractionValidated: "InteractionValidated",
  EntityExamined: "EntityExamined",

  // Interaction Model v1 — Slice 2 (listening law)
  SoundObserved: "SoundObserved",
  RumorHeard: "RumorHeard",

  // Canon compiler provenance — design-time input committed before bootstrap
  CanonGenesisRecorded: "CanonGenesisRecorded",

  // First living region — spatial bootstrap and observer evidence
  RegionDefined: "RegionDefined",
  SpatialObservationRecorded: "SpatialObservationRecorded",

  // Spatial Movement (ADR-0015)
  TravelMetadataAttached: "TravelMetadataAttached",
  JourneyRequested: "JourneyRequested",
  JourneyValidated: "JourneyValidated",
  JourneyBlocked: "JourneyBlocked",
  JourneyStarted: "JourneyStarted",
  JourneyStepRequested: "JourneyStepRequested",
  JourneyInterruptRequested: "JourneyInterruptRequested",
  JourneyInterruptValidated: "JourneyInterruptValidated",
  JourneyInterrupted: "JourneyInterrupted",
  JourneyCompleted: "JourneyCompleted",
  CrossingConditionChanged: "CrossingConditionChanged",
  RoadConditionChanged: "RoadConditionChanged",
  RouteBlocked: "RouteBlocked",
  RouteReopened: "RouteReopened",

  // River Hydrology (ADR-0017)
  RiverProcessDefined: "RiverProcessDefined",
  RiverLevelChanged: "RiverLevelChanged",
  CrossingConditionInitialized: "CrossingConditionInitialized",

  // Weather (ADR-0020, influences graph)
  WeatherProcessDefined: "WeatherProcessDefined",
  WeatherStateChanged: "WeatherStateChanged",

  // Heat Transfer (PR-7.1, second independent system)
  HeatProcessDefined: "HeatProcessDefined",
  HeatStateChanged: "HeatStateChanged",

  // Settlement Pattern (PR-7.4, first long-lived object)
  SettlementCreated: "SettlementCreated",
  SettlementStateChanged: "SettlementStateChanged",

  // Resource nodes and deterministic extraction/recovery
  ResourceNodeDefined: "ResourceNodeDefined",
  ResourceExtractionRequested: "ResourceExtractionRequested",
  ResourceExtracted: "ResourceExtracted",
  ResourceRegenerated: "ResourceRegenerated",
  ResourceRegenerationBlocked: "ResourceRegenerationBlocked",
  ResourceExtractionRejected: "ResourceExtractionRejected",
  ResourceTransferRequested: "ResourceTransferRequested",
  ResourceTransferred: "ResourceTransferred",
  ResourceTransferRejected: "ResourceTransferRejected",
  ResourceConsumeRequested: "ResourceConsumeRequested",
  ResourceConsumed: "ResourceConsumed",
  ResourceConsumeRejected: "ResourceConsumeRejected",
  ResourceProcessDefined: "ResourceProcessDefined",
  ResourceProcessRequested: "ResourceProcessRequested",
  ResourceProcessStarted: "ResourceProcessStarted",
  ResourceProcessCompleted: "ResourceProcessCompleted",
  ResourceProcessRejected: "ResourceProcessRejected",
  ResourceDemandDefined: "ResourceDemandDefined",
  ResourceShortageStarted: "ResourceShortageStarted",
  ResourceShortageEnded: "ResourceShortageEnded",

} as const;

export type EventType = (typeof EventType)[keyof typeof EventType];
