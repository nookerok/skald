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
  for (const section of ['locations','landmarks','relations','travel','settlements','observations','content','discoveryDefinitions','simulationMetadata','resourceDefinitions','hydrography','elevation','toponymIndex']) checkRefs(projection[section], section);
  if (projection.bootstrap?.startLocationId && !(projection.locations ?? []).some((entry) => entry.id === projection.bootstrap.startLocationId)) throw new Error('bootstrap startLocationId is not a declared location: ' + projection.bootstrap.startLocationId);
  for (const resource of projection.resourceDefinitions ?? []) {
    if (!resource.id || !resource.resourceKind || !resource.locationId) throw new Error('resource definition requires id, resourceKind and locationId');
    if (!Number.isInteger(resource.capacityUnits) || resource.capacityUnits <= 0 || !Number.isInteger(resource.initialStockUnits) || resource.initialStockUnits < 0 || resource.initialStockUnits > resource.capacityUnits) throw new Error('resource definition has invalid integer stock bounds: ' + resource.id);
    for (const method of resource.extractionMethods ?? []) if (!method.id || !Number.isInteger(method.maximumPerAction) || method.maximumPerAction <= 0) throw new Error('resource extraction method has invalid maximum: ' + resource.id);
    if (resource.regeneration && (!Number.isInteger(resource.regeneration.intervalWorldTime) || resource.regeneration.intervalWorldTime <= 0 || !Number.isInteger(resource.regeneration.amountUnits) || resource.regeneration.amountUnits <= 0 || !Number.isInteger(resource.regeneration.maximumUnits) || resource.regeneration.maximumUnits > resource.capacityUnits)) throw new Error('resource regeneration is invalid: ' + resource.id);
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
  return { ...projection, ...sections, canonicalRefs: [...(projection.canonicalRefs ?? [])].sort(), locations: sorted(projection.locations), landmarks: sorted(projection.landmarks), relations: sorted(projection.relations), travel: sorted(projection.travel, 'relationId'), settlements: sorted(projection.settlements, 'settlementId'), observations: [...(projection.observations ?? [])], content: sorted(projection.content), discoveryDefinitions: sorted(projection.discoveryDefinitions), simulationMetadata: sorted(projection.simulationMetadata, 'locationId'), resourceDefinitions: sorted(projection.resourceDefinitions) };
}
