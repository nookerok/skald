import { zodToJsonSchema } from "zod-to-json-schema";
import { beliefModelDTOSchema, observationRecordSchema } from "./schemas.js";

/** Generated JSON Schema for the v2.0 BeliefModelDTO boundary. */
export const beliefModelDTOJsonSchema = Object.freeze(zodToJsonSchema(beliefModelDTOSchema, {
  name: "BeliefModelDTO",
  $refStrategy: "none",
}));

/** Generated JSON Schema for the v1.0 ObservationRecord boundary. */
export const observationRecordJsonSchema = Object.freeze(zodToJsonSchema(observationRecordSchema, {
  name: "ObservationRecord",
  $refStrategy: "none",
}));
