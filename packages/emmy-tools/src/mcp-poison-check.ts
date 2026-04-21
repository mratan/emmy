// RED-phase stub. GREEN step will fill in the blocklist logic.
import { PoisonError } from "./errors";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function assertNoPoison(_text: string, _field: "name" | "description"): void {
  throw new Error("not implemented");
}
export { PoisonError } from "./errors";
