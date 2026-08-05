# Simulation Definition Schema v0.1
#
# Минимальный контракт для System Definitions.
# Определяет что Definition ОПИСЫВАЕТ и что ЗАПРЕЩЕНО писать.
#
# Статус: experimental — проверяется на river-hydrology и weather.

schemaVersion: "0.1.0"

# =============================================================================
# Что Definition ОПИСЫВАЕТ
# =============================================================================

allowed:

  # Identity — метаданные системы
  identity:
    required: [systemId, lifecycleStatus, version]
    optional: [provenance]

  # Public Contract —唯一ная часть, от которой зависят внешние потребители
  publicContract:
    dependencies:
      ownedAspects:        # аспекты, которыми владеет эта система
        - aspect           # имя аспекта
        - domain           # неформальное описание типа
      dependsOn:           # список systemId зависимостей (DAG)
      influences:          # на какие системы влияет
        - target           # systemId потребителя
        - dependencyEvidence  # машиночитаемая ссылка

    observableSurface:
      emits:               # Domain Events, которые создаёт система
        - event            # имя EventType
        - role             # genesis | state-transition | side-effect
      consumes:            # Domain Events, которые слушает система
        - event

    guarantees:            # инварианты системы
      - id                 # уникальный идентификатор
      - statement          # текстовое описание
      - kind               # invariant | impossibility | bounded
      - scope              # aspect | system | interaction
      - implementationEvidence  # доказательство реализации

  # Operational Profile — как система работает
  operationalProfile:
    updateModel:           # TickDriven | EventDriven | Hybrid
    budget:
      supports: [Full]     # Full | Aggregated (пока только Full)
    persistenceReplay:
      replayAssumptions:   # список допущений для replay

  # Private Design — внутренняя реализация
  privateDesign:
    stateSemantics:        # описание семантики состояний
    parameterSlots:        # объявление параметров (не значения!)
      - name
      - range             # неформальное описание диапазона
      - default

# =============================================================================
# что ЗАПРЕЩЕНО писать в Definition
# =============================================================================

forbidden:

  # Runtime state — это данные, а не контракт
  - path: "privateDesign.parameterSlots[*].value"
    reason: "Runtime state belongs to Binding, not Definition"

  - path: "publicContract.dependencies.ownedAspects[*].currentValue"
    reason: "Current values are projection state, not contract"

  # Specific parameter values
  - path: "privateDesign.parameterSlots[*].value = 40"
    reason: "Concrete values belong to Binding (pilot-region.yaml)"

  # Runtime implementation details
  - path: "privateDesign.algorithm"
    reason: "Algorithm is implementation, not contract"

  - path: "privateDesign.functionBody"
    reason: "Code belongs in packages/, not in Definition"

  # World-specific configuration
  - path: "worldSpecific"
    reason: "World-specific config belongs in Binding"

  - path: "pilot-region"
    reason: "Use Binding (docs/simulation/bindings/) for world-specific data"

  # UI/UX concerns
  - path: "presentation"
    reason: "Presentation belongs to PresentationTemplate, not Definition"

  - path: "playerFacing"
    reason: "Player-facing text belongs to Narrative, not Definition"

# =============================================================================
# Binding Schema (отдельный артефакт)
# =============================================================================

binding:
  description: |
    Binding связывает Definition с конкретным миром.
    Содержит значения параметров и world-specific конфигурацию.

  allowed:
    system:                 # reference to Definition
    world:
      region:               # reference to region
    parameters:             # concrete values for parameterSlots
      - name                # must match a parameterSlot in Definition
        value               # concrete value
    conditions:             # world-specific conditions
      - name
        value

  forbidden:
    - "New parameters not declared in Definition"
    - "World-independent defaults (those belong in Definition)"
    - "Runtime state or current values"

# =============================================================================
# Пример: river-hydrology Definition vs Binding
# =============================================================================

example_definition: |
  # Definition (what the system IS)
  identity:
    systemId: river-hydrology
    lifecycleStatus: Experimental
    version: 1.0.0

  publicContract:
    dependencies:
      ownedAspects:
        - aspect: RiverState
          domain: "{ level: ℝ, band: RiverBand }"

  privateDesign:
    parameterSlots:
      - name: baselineLevel
        range: "[minimumLevel, maximumLevel]"
        default: null    # must be set in Binding

example_binding: |
  # Binding (how it lives in THIS world)
  system: river-hydrology
  world:
    region: pilot-region
  parameters:
    - name: baselineLevel
      value: 40
    - name: minimumLevel
      value: 20
    - name: maximumLevel
      value: 90
    - name: cycleLengthTicks
      value: 16
    - name: phaseOffset
      value: 0
    - name: riseRate
      value: 8
    - name: fallRate
      value: 5
