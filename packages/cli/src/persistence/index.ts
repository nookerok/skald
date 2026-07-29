export {
  createMultiWorldStore,
  DuplicateRequestError,
  type MultiWorldStore,
  type CommitOptions,
  type CreateWorldParams,
  type CreateWorldResult,
} from "./sqlite-store.js";
export { migrateV1ToV2, migrateV2ToV3, validateUserVersion, verifyIntegrity } from "./migrations.js";
export { configureDatabase, execSchemaV2, execSchemaV3, USER_VERSION } from "./schema.js";
export type {
  WorldId,
  CharacterProfileId,
  WorldTemplateId,
  WorldTemplate,
  CharacterProfile,
  WorldRecord,
} from "./types.js";
export { LEGACY_WORLD_ID, DEFAULT_TEMPLATE } from "./types.js";
