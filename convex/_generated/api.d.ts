/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import type * as agent_conversation from "../agent/conversation.js";
import type * as agent_embeddingsCache from "../agent/embeddingsCache.js";
import type * as agent_memory from "../agent/memory.js";
import type * as aiTown_affinity from "../aiTown/affinity.js";
import type * as aiTown_agent from "../aiTown/agent.js";
import type * as aiTown_agentDescription from "../aiTown/agentDescription.js";
import type * as aiTown_agentInputs from "../aiTown/agentInputs.js";
import type * as aiTown_agentOperations from "../aiTown/agentOperations.js";
import type * as aiTown_conversation from "../aiTown/conversation.js";
import type * as aiTown_conversationMembership from "../aiTown/conversationMembership.js";
import type * as aiTown_deliberation from "../aiTown/deliberation.js";
import type * as aiTown_game from "../aiTown/game.js";
import type * as aiTown_gameTime from "../aiTown/gameTime.js";
import type * as aiTown_generatedScenario from "../aiTown/generatedScenario.js";
import type * as aiTown_ids from "../aiTown/ids.js";
import type * as aiTown_inputHandler from "../aiTown/inputHandler.js";
import type * as aiTown_inputs from "../aiTown/inputs.js";
import type * as aiTown_insertInput from "../aiTown/insertInput.js";
import type * as aiTown_location from "../aiTown/location.js";
import type * as aiTown_main from "../aiTown/main.js";
import type * as aiTown_movement from "../aiTown/movement.js";
import type * as aiTown_observation from "../aiTown/observation.js";
import type * as aiTown_player from "../aiTown/player.js";
import type * as aiTown_playerDescription from "../aiTown/playerDescription.js";
import type * as aiTown_relationshipEvents from "../aiTown/relationshipEvents.js";
import type * as aiTown_scenarios from "../aiTown/scenarios.js";
import type * as aiTown_shortTerm from "../aiTown/shortTerm.js";
import type * as aiTown_shortTermEvents from "../aiTown/shortTermEvents.js";
import type * as aiTown_world from "../aiTown/world.js";
import type * as aiTown_worldInputs from "../aiTown/worldInputs.js";
import type * as aiTown_worldMap from "../aiTown/worldMap.js";
import type * as constants from "../constants.js";
import type * as crons from "../crons.js";
import type * as decider from "../decider.js";
import type * as dryRun from "../dryRun.js";
import type * as engine_abstractGame from "../engine/abstractGame.js";
import type * as engine_historicalObject from "../engine/historicalObject.js";
import type * as evaluationExport from "../evaluationExport.js";
import type * as evaluator from "../evaluator.js";
import type * as focal from "../focal.js";
import type * as groundTruth from "../groundTruth.js";
import type * as http from "../http.js";
import type * as init from "../init.js";
import type * as messages from "../messages.js";
import type * as music from "../music.js";
import type * as scenarioGen from "../scenarioGen.js";
import type * as scoring from "../scoring.js";
import type * as testing from "../testing.js";
import type * as util_assertNever from "../util/assertNever.js";
import type * as util_asyncMap from "../util/asyncMap.js";
import type * as util_compression from "../util/compression.js";
import type * as util_factMerge from "../util/factMerge.js";
import type * as util_FastIntegerCompression from "../util/FastIntegerCompression.js";
import type * as util_geometry from "../util/geometry.js";
import type * as util_isSimpleObject from "../util/isSimpleObject.js";
import type * as util_llm from "../util/llm.js";
import type * as util_llmJson from "../util/llmJson.js";
import type * as util_minheap from "../util/minheap.js";
import type * as util_object from "../util/object.js";
import type * as util_sleep from "../util/sleep.js";
import type * as util_types from "../util/types.js";
import type * as util_xxhash from "../util/xxhash.js";
import type * as world from "../world.js";

/**
 * A utility for referencing Convex functions in your app's API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
declare const fullApi: ApiFromModules<{
  "agent/conversation": typeof agent_conversation;
  "agent/embeddingsCache": typeof agent_embeddingsCache;
  "agent/memory": typeof agent_memory;
  "aiTown/affinity": typeof aiTown_affinity;
  "aiTown/agent": typeof aiTown_agent;
  "aiTown/agentDescription": typeof aiTown_agentDescription;
  "aiTown/agentInputs": typeof aiTown_agentInputs;
  "aiTown/agentOperations": typeof aiTown_agentOperations;
  "aiTown/conversation": typeof aiTown_conversation;
  "aiTown/conversationMembership": typeof aiTown_conversationMembership;
  "aiTown/deliberation": typeof aiTown_deliberation;
  "aiTown/game": typeof aiTown_game;
  "aiTown/gameTime": typeof aiTown_gameTime;
  "aiTown/generatedScenario": typeof aiTown_generatedScenario;
  "aiTown/ids": typeof aiTown_ids;
  "aiTown/inputHandler": typeof aiTown_inputHandler;
  "aiTown/inputs": typeof aiTown_inputs;
  "aiTown/insertInput": typeof aiTown_insertInput;
  "aiTown/location": typeof aiTown_location;
  "aiTown/main": typeof aiTown_main;
  "aiTown/movement": typeof aiTown_movement;
  "aiTown/observation": typeof aiTown_observation;
  "aiTown/player": typeof aiTown_player;
  "aiTown/playerDescription": typeof aiTown_playerDescription;
  "aiTown/relationshipEvents": typeof aiTown_relationshipEvents;
  "aiTown/scenarios": typeof aiTown_scenarios;
  "aiTown/shortTerm": typeof aiTown_shortTerm;
  "aiTown/shortTermEvents": typeof aiTown_shortTermEvents;
  "aiTown/world": typeof aiTown_world;
  "aiTown/worldInputs": typeof aiTown_worldInputs;
  "aiTown/worldMap": typeof aiTown_worldMap;
  constants: typeof constants;
  crons: typeof crons;
  decider: typeof decider;
  dryRun: typeof dryRun;
  "engine/abstractGame": typeof engine_abstractGame;
  "engine/historicalObject": typeof engine_historicalObject;
  evaluationExport: typeof evaluationExport;
  evaluator: typeof evaluator;
  focal: typeof focal;
  groundTruth: typeof groundTruth;
  http: typeof http;
  init: typeof init;
  messages: typeof messages;
  music: typeof music;
  scenarioGen: typeof scenarioGen;
  scoring: typeof scoring;
  testing: typeof testing;
  "util/assertNever": typeof util_assertNever;
  "util/asyncMap": typeof util_asyncMap;
  "util/compression": typeof util_compression;
  "util/factMerge": typeof util_factMerge;
  "util/FastIntegerCompression": typeof util_FastIntegerCompression;
  "util/geometry": typeof util_geometry;
  "util/isSimpleObject": typeof util_isSimpleObject;
  "util/llm": typeof util_llm;
  "util/llmJson": typeof util_llmJson;
  "util/minheap": typeof util_minheap;
  "util/object": typeof util_object;
  "util/sleep": typeof util_sleep;
  "util/types": typeof util_types;
  "util/xxhash": typeof util_xxhash;
  world: typeof world;
}>;
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;
