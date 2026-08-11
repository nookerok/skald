export {
  createMultiWorldStore,
  DuplicateRequestError,
  type MultiWorldStore,
  type CommitOptions,
  type CreateWorldParams,
  type CreateWorldResult,
  type AcknowledgeObserverCheckpointParams,
  type AcknowledgeObserverCheckpointResult,
} from "./sqlite-store.js";
export { migrateV1ToV2, migrateV2ToV3, migrateV3ToV4, migrateV4ToV5, migrateV5ToV6, validateUserVersion, verifyIntegrity } from "./migrations.js";
export { configureDatabase, execSchemaV2, execSchemaV3, execSchemaV4, execSchemaV5, execSchemaV6, USER_VERSION } from "./schema.js";
export type {
  WorldId,
  CharacterProfileId,
  WorldTemplateId,
  WorldTemplate,
  CharacterProfile,
  WorldRecord,
} from "./types.js";
export { LEGACY_WORLD_ID, DEFAULT_TEMPLATE } from "./types.js";
