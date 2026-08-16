function sorted(items, key = 'id') { return [...(items ?? [])].sort((a, b) => String(a?.[key] ?? '').localeCompare(String(b?.[key] ?? ''))); }

function normalizeSections(projection) {
  const hydrography = projection.hydrography ? {
    ...projection.hydrography,
    waterBodies: sorted(projection.hydrography.waterBodies),
    watercourses: sorted(projection.hydrography.watercourses),
    catchments: sorted(projection.hydrography.catchments),
    wetlands: sorted(projection.hydrography.wetlands),
  } : undefined;
  const elevation = projection.elevation ? {
    ...projection.elevation,
    bands: sorted(projection.elevation.bands),
    controlAreas: sorted(projection.elevation.controlAreas),
    constraints: sorted(projection.elevation.constraints),
  } : undefined;
  const toponymIndex = projection.toponymIndex ? { ...projection.toponymIndex, subjects: sorted(projection.toponymIndex.subjects) } : undefined;
  return { hydrography, elevation, toponymIndex };
}

export function buildRegionIR(projection, canonIds = new Set()) {
  if (!projection?.region?.id || projection.regionId !== projection.region.id) throw new Error('projection regionId must match region.id');
  const checkRefs = (value, label) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach((entry, index) => checkRefs(entry, label + '[' + index + ']')); return; }
    for (const ref of value.canonicalRefs ?? []) if (canonIds.size && !canonIds.has(ref)) throw new Error(label + ' references unknown Canon id: ' + ref);
    for (const [key, child] of Object.entries(value)) if (key !== 'canonicalRefs' && child && typeof child === 'object') checkRefs(child, label + '.' + key);
  };
  for (const section of ['locations','landmarks','relations','travel','settlements','observations','content','discoveryDefinitions','simulationMetadata','resourceDefinitions','resourceProcessDefinitions','resourceDemandDefinitions','hydrography','elevation','toponymIndex','backgroundBindings']) checkRefs(projection[section], section);
  const locationIds = new Set((projection.locations ?? []).map((entry) => entry.id));
  const relationIds = new Set((projection.relations ?? []).map((entry) => entry.id));
  const entrypointIds = new Set();
  const approvedEntrypointIds = new Set();
  const declaredBackgroundIds = new Set((projection.backgroundBindings ?? []).map((entry) => entry.id));
  const observationKeys = new Set((projection.observations ?? []).map((entry) => `${entry.subjectKind}:${entry.subjectId}`));
  for (const entrypoint of projection.bootstrap?.entrypoints ?? []) {
    if (!entrypoint.id || entrypointIds.has(entrypoint.id)) throw new Error('duplicate bootstrap entrypoint: ' + entrypoint.id);
    entrypointIds.add(entrypoint.id);
    if (!['approved', 'proposal', 'rejected'].includes(entrypoint.status ?? 'approved')) throw new Error('bootstrap entrypoint has invalid status: ' + entrypoint.id);
    if (entrypoint.status !== 'approved') continue;
    approvedEntrypointIds.add(entrypoint.id);
    if (!locationIds.has(entrypoint.locationId)) throw new Error('bootstrap entrypoint location is not declared: ' + entrypoint.locationId);
    for (const field of ['arrivalScene', 'openingSituation', 'openingProblem']) if (typeof entrypoint[field] !== 'string' || entrypoint[field].trim().length === 0) throw new Error('bootstrap entrypoint has invalid ' + field + ': ' + entrypoint.id);
    if (!entrypoint.localContact || typeof entrypoint.localContact.id !== 'string' || typeof entrypoint.localContactRef !== 'string' || entrypoint.localContactRef !== entrypoint.localContact.id || typeof entrypoint.localContact.name !== 'string' || typeof entrypoint.localContact.description !== 'string' || typeof entrypoint.localContact.relationKind !== 'string') throw new Error('bootstrap entrypoint local contact is invalid: ' + entrypoint.id);
    if (typeof entrypoint.openingProblemRef !== 'string' || !entrypoint.openingProblemRef || !['presentation_only', 'simulation'].includes(entrypoint.openingProblemMode ?? 'presentation_only')) throw new Error('bootstrap entrypoint problem reference is invalid: ' + entrypoint.id);
    const routeRefs = entrypoint.initialRouteRefs ?? entrypoint.availableRouteRefs;
    if (!Array.isArray(routeRefs) || routeRefs.length === 0 || routeRefs.some((ref) => !relationIds.has(ref))) throw new Error('bootstrap entrypoint has unknown route: ' + entrypoint.id);
    for (const routeRef of routeRefs) {
      const relation = (projection.relations ?? []).find((candidate) => candidate.id === routeRef);
      if (!relation || (relation.fromId !== entrypoint.locationId && relation.toId !== entrypoint.locationId)) throw new Error('bootstrap entrypoint route does not touch start location ' + routeRef + ': ' + entrypoint.id);
    }
    const bridges = entrypoint.backgroundConnections ?? Object.entries(entrypoint.backgroundBridges ?? {}).map(([backgroundId, arrivalHook]) => ({ backgroundId, arrivalHook }));
    if (!Array.isArray(bridges) || bridges.length === 0 || new Set(bridges.map((bridge) => bridge.backgroundId)).size !== bridges.length || bridges.some((bridge) => typeof bridge.backgroundId !== 'string' || typeof bridge.arrivalHook !== 'string' || bridge.arrivalHook.trim().length === 0)) throw new Error('bootstrap entrypoint background connections are invalid: ' + entrypoint.id);
    for (const backgroundId of entrypoint.availableBackgroundIds ?? []) {
      if (!declaredBackgroundIds.has(backgroundId)) throw new Error('bootstrap entrypoint references unknown background: ' + backgroundId);
      if (!bridges.some((bridge) => bridge.backgroundId === backgroundId)) throw new Error('bootstrap entrypoint has no background bridge: ' + entrypoint.id + '/' + backgroundId);
    }
    if (!Array.isArray(entrypoint.availableBackgroundIds) || entrypoint.availableBackgroundIds.length === 0 || entrypoint.availableBackgroundIds.some((id) => typeof id !== 'string' || id.length === 0)) throw new Error('bootstrap entrypoint has no valid backgrounds: ' + entrypoint.id);
    for (const field of ['initialObservationRefs', 'initialKnowledgeRefs', 'initialRevealRefs']) {
      if (!Array.isArray(entrypoint[field]) || entrypoint[field].some((ref) => typeof ref !== 'string' || ref.length === 0)) throw new Error('bootstrap entrypoint has invalid ' + field + ': ' + entrypoint.id);
      for (const ref of entrypoint[field]) if (!observationKeys.has(ref)) throw new Error('bootstrap entrypoint references unknown observation ' + ref + ': ' + entrypoint.id);
    }
    const observations = new Set(entrypoint.initialObservationRefs);
    for (const ref of entrypoint.initialRevealRefs) if (!observations.has(ref)) throw new Error('bootstrap entrypoint reveal is not an initial observation ' + ref + ': ' + entrypoint.id);
    for (const observation of projection.observations ?? []) {
      const ref = `${observation.subjectKind}:${observation.subjectId}`;
      if (observations.has(ref) && ['observed', 'traversed'].includes(observation.knowledge) && !entrypoint.initialRevealRefs.includes(ref)) throw new Error('bootstrap entrypoint omits reveal for visible observation ' + ref + ': ' + entrypoint.id);
    }
  }
  const backgroundIds = new Set();
  for (const background of projection.backgroundBindings ?? []) {
    if (!background || typeof background.id !== 'string' || !background.id) throw new Error('background binding requires id');
    if (backgroundIds.has(background.id)) throw new Error('duplicate background binding: ' + background.id);
    backgroundIds.add(background.id);
    if (!['approved', 'proposal'].includes(background.status)) throw new Error('background binding has invalid status: ' + background.id);
    if (!Array.isArray(background.canonicalRefs)) throw new Error('background binding has invalid canonicalRefs: ' + background.id);
    if (background.status !== 'approved') continue;
    const available = new Set([...(projection.bootstrap?.entrypoints ?? [])].flatMap((entry) => entry.availableBackgroundIds ?? []));
    if (available.size > 0 && !available.has(background.id)) throw new Error('approved background is not available at any entrypoint: ' + background.id);
    if (!background.testimony || typeof background.testimony.claimId !== 'string' || typeof background.testimony.proposition !== 'string') throw new Error('approved background testimony is invalid: ' + background.id);
    if (!background.contact || typeof background.contact.id !== 'string' || typeof background.contact.name !== 'string' || typeof background.contact.locationId !== 'string') throw new Error('approved background contact is invalid: ' + background.id);
    if (!locationIds.has(background.contact.locationId)) throw new Error('background contact location is not declared: ' + background.id);
    if (!background.relation || typeof background.relation.from !== 'string' || typeof background.relation.to !== 'string' || typeof background.relation.kind !== 'string') throw new Error('approved background relation is invalid: ' + background.id);
    if (background.relation.to !== background.contact.id) throw new Error('background relation target must be its contact: ' + background.id);
    if (!background.item || typeof background.item.id !== 'string' || typeof background.item.locationId !== 'string') throw new Error('approved background item is invalid: ' + background.id);
    if (!locationIds.has(background.item.locationId)) throw new Error('background item location is not declared: ' + background.id);
    if (!Array.isArray(background.observations) || background.observations.some((observation) => !observation || typeof observation.subjectKind !== 'string' || typeof observation.subjectId !== 'string')) throw new Error('background observations are invalid: ' + background.id);
    if (!Array.isArray(background.knowledge) || background.knowledge.some((knowledge) => !knowledge || typeof knowledge.knowledgeId !== 'string' || typeof knowledge.proposition !== 'string')) throw new Error('background knowledge is invalid: ' + background.id);
    if (typeof background.openingHookRef !== 'string' || !background.openingHookRef) throw new Error('background openingHookRef is invalid: ' + background.id);
  }
  if (projection.bootstrap?.startLocationId && !(projection.locations ?? []).some((entry) => entry.id === projection.bootstrap.startLocationId)) throw new Error('bootstrap startLocationId is not a declared location: ' + projection.bootstrap.startLocationId);
  const defaultEntrypointId = projection.bootstrap?.defaultEntrypointId;
  if (entrypointIds.size > 0 && !defaultEntrypointId) throw new Error('bootstrap defaultEntrypointId is required when authored entrypoints exist');
  if (defaultEntrypointId && !approvedEntrypointIds.has(defaultEntrypointId)) throw new Error('bootstrap defaultEntrypointId must reference an approved entrypoint: ' + defaultEntrypointId);
  const resourceIds = new Set();
  for (const resource of projection.resourceDefinitions ?? []) {
    if (!resource.id || !resource.resourceKind || !resource.locationId) throw new Error('resource definition requires id, resourceKind and locationId');
    if (resourceIds.has(resource.id)) throw new Error('duplicate resource definition: ' + resource.id);
    resourceIds.add(resource.id);
    if (resource.sourceModel && !['stock', 'renewable', 'produced'].includes(resource.sourceModel)) throw new Error('resource definition has invalid sourceModel: ' + resource.id);
    if (!Number.isInteger(resource.capacityUnits) || resource.capacityUnits <= 0 || !Number.isInteger(resource.initialStockUnits) || resource.initialStockUnits < 0 || resource.initialStockUnits > resource.capacityUnits) throw new Error('resource definition has invalid integer stock bounds: ' + resource.id);
    for (const method of resource.extractionMethods ?? []) {
      if (!method.id || !Number.isInteger(method.maximumPerAction) || method.maximumPerAction <= 0) throw new Error('resource extraction method has invalid maximum: ' + resource.id);
      if (method.actionCostWorldTime !== undefined && (!Number.isInteger(method.actionCostWorldTime) || method.actionCostWorldTime <= 0)) throw new Error('resource extraction method has invalid action cost: ' + resource.id);
      if (method.requiredInstruments !== undefined && (!Array.isArray(method.requiredInstruments) || method.requiredInstruments.some((entry) => typeof entry !== 'string' || !entry))) throw new Error('resource extraction method has invalid instruments: ' + resource.id);
    }
    if (resource.regeneration) {
      if (resource.regeneration.model !== undefined && resource.regeneration.model !== 'interval') throw new Error('resource regeneration model is invalid: ' + resource.id);
      if (!Number.isInteger(resource.regeneration.intervalWorldTime) || resource.regeneration.intervalWorldTime <= 0 || !Number.isInteger(resource.regeneration.amountUnits) || resource.regeneration.amountUnits <= 0 || !Number.isInteger(resource.regeneration.maximumUnits) || resource.regeneration.maximumUnits > resource.capacityUnits) throw new Error('resource regeneration is invalid: ' + resource.id);
      for (const blocker of resource.regeneration.blockedBy ?? []) {
        if (typeof blocker === 'string') continue;
        if (!blocker || typeof blocker.situationType !== 'string' || !['same_location', 'region'].includes(blocker.scope)) throw new Error('resource regeneration blocker is invalid: ' + resource.id);
      }
    }
  }
  const processIds = new Set();
  for (const process of projection.resourceProcessDefinitions ?? []) {
    if (!process.id || !process.locationId || !Number.isInteger(process.durationWorldTime) || process.durationWorldTime <= 0) throw new Error(String(process.id));
    if (processIds.has(process.id)) throw new Error(String(process.id));
    processIds.add(process.id);
    for (const side of Object.keys({ inputs: 1, outputs: 1 })) {
      if (!Array.isArray(process[side]) || process[side].some((entry) => !entry.resourceKind || !Number.isInteger(entry.amountUnits) || entry.amountUnits <= 0)) throw new Error(String(process.id));
    }
  }
  const demandIds = new Set();
  for (const demand of projection.resourceDemandDefinitions ?? []) {
    if (!demand.id || !demand.ownerId || !demand.resourceKind || !Number.isInteger(demand.amountPerInterval) || demand.amountPerInterval <= 0 || !Number.isInteger(demand.intervalWorldTime) || demand.intervalWorldTime <= 0) throw new Error(String(demand.id));
    if (demandIds.has(demand.id)) throw new Error(String(demand.id));
    demandIds.add(demand.id);
  }
  const sections = normalizeSections(projection);
  if (sections.hydrography) {
    const bodyIds = new Set(sections.hydrography.waterBodies.map((entry) => entry.id));
    const watercourseIds = new Set(sections.hydrography.watercourses.map((entry) => entry.id));
    for (const watercourse of sections.hydrography.watercourses) {
      if (watercourse.sinkRef && !bodyIds.has(watercourse.sinkRef) && !watercourseIds.has(watercourse.sinkRef)) throw new Error('hydrography watercourse has dangling sink: ' + watercourse.id);
      for (const ref of watercourse.tributaryRefs ?? []) if (!watercourseIds.has(ref)) throw new Error('hydrography watercourse has dangling tributary: ' + ref);
    }
    for (const body of sections.hydrography.waterBodies) for (const ref of body.inflows ?? []) if (!watercourseIds.has(ref)) throw new Error('hydrography water body has dangling inflow: ' + ref);
  }
  return { ...projection, ...sections, canonicalRefs: [...(projection.canonicalRefs ?? [])].sort(), locations: sorted(projection.locations), landmarks: sorted(projection.landmarks), relations: sorted(projection.relations), travel: sorted(projection.travel, 'relationId'), settlements: sorted(projection.settlements, 'settlementId'), observations: [...(projection.observations ?? [])], content: sorted(projection.content), discoveryDefinitions: sorted(projection.discoveryDefinitions), simulationMetadata: sorted(projection.simulationMetadata, 'locationId'), resourceDefinitions: sorted(projection.resourceDefinitions), resourceProcessDefinitions: sorted(projection.resourceProcessDefinitions), resourceDemandDefinitions: sorted(projection.resourceDemandDefinitions), backgroundBindings: sorted(projection.backgroundBindings), bootstrap: { ...(projection.bootstrap ?? {}), entrypoints: [...(projection.bootstrap?.entrypoints ?? [])].sort((a, b) => a.id.localeCompare(b.id)) } };
}
