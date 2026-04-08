import { type SessionDoom } from "./doom"

export namespace SessionReplan {
  export function prompt(hit: SessionDoom.Hit) {
    return [
      "<system-reminder>",
      "REPLAN REQUIRED",
      "Two failed strategies in the same category were detected, so tool use is disabled for this response.",
      hit.category ? `Category: ${hit.category}` : "",
      hit.target ? `Target: ${hit.target}` : "",
      hit.failures?.length ? `Failure classes: ${hit.failures.join(", ")}` : "",
      "",
      "Respond with text only.",
      "You must:",
      "1. State the blocker clearly.",
      "2. Explain why the current strategy is not making progress.",
      "3. Propose a materially different next strategy.",
      "4. If no materially different strategy exists, ask the user to repair the environment or provide a new path.",
      "Do not call tools in this response.",
      "</system-reminder>",
    ]
      .filter(Boolean)
      .join("\n")
  }
}
