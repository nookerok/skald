/**
 * Prints the guarded browser acceptance procedure. The repository gate stays
 * deterministic; a real browser run is delegated to the NTFS QA task because
 * each gameplay command mutates the canonical Event Log.
 */
const output = {
  status: "MANUAL_REQUIRED",
  scenario: "riverwatch-old-course",
  deterministicCommand: "npm run acceptance:adventure",
  browserRoute: "$skald-ntfs-browser-qa",
  mutationBudget: {
    maxGameplayCommands: 35,
    offlineTicks: 24,
    allowedWorld: "a disposable living_region world only",
  },
  requiredEvidence: [
    "desktop and mobile screenshots of map fog/reveal before and after travel",
    "DOM/network evidence for player/master alternating chat",
    "clarification, rumor, route choice, condition change and discovery",
    "disconnect, 24-48 offline ticks, re-entry Presence and coherent chronicle",
    "no console errors and no Dev controls on the normal player surface",
  ],
  note: "This command does not mutate a world or claim browser success.",
};
console.log(JSON.stringify(output, null, 2));
