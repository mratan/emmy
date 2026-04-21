// RED stub — Plan 02-03 Task 1.
import { HasherError } from "./errors";

export function normalizeText(_raw: string): string {
	throw new HasherError("not implemented");
}

export function hash8hex(_text: string): string {
	throw new HasherError("not implemented");
}

export { HasherError } from "./errors";
