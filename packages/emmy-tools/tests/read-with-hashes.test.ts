import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hash8hex } from "../src/hash";
import {
	readWithHashes,
	renderHashedLines,
} from "../src/read-with-hashes";

describe("readWithHashes (D-07 read format)", () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "emmy-rwh-"));
	});
	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	test("text file → HashedLine per line, 1-based line_number, content excludes trailing newline", () => {
		const p = join(dir, "a.txt");
		writeFileSync(p, "foo\nbar\nbaz\n", "utf8");
		const r = readWithHashes(p);
		expect(r.binary).toBe(false);
		expect(r.path).toBe(p);
		expect(r.lines.length).toBe(3);
		expect(r.lines[0]).toEqual({
			hash: hash8hex("foo"),
			content: "foo",
			line_number: 1,
		});
		expect(r.lines[1]).toEqual({
			hash: hash8hex("bar"),
			content: "bar",
			line_number: 2,
		});
		expect(r.lines[2]).toEqual({
			hash: hash8hex("baz"),
			content: "baz",
			line_number: 3,
		});
	});

	test("file without trailing newline still splits correctly", () => {
		const p = join(dir, "b.txt");
		writeFileSync(p, "x\ny", "utf8");
		const r = readWithHashes(p);
		expect(r.lines.length).toBe(2);
		expect(r.lines[0]!.content).toBe("x");
		expect(r.lines[1]!.content).toBe("y");
	});

	test("empty file → empty lines array, content is empty", () => {
		const p = join(dir, "empty.txt");
		writeFileSync(p, "", "utf8");
		const r = readWithHashes(p);
		expect(r.binary).toBe(false);
		expect(r.lines.length).toBe(0);
		expect(r.content).toBe("");
	});

	test("CRLF file yields identical hashes to LF equivalent", () => {
		const pLF = join(dir, "lf.txt");
		const pCRLF = join(dir, "crlf.txt");
		writeFileSync(pLF, "alpha\nbeta\ngamma\n", "utf8");
		writeFileSync(pCRLF, "alpha\r\nbeta\r\ngamma\r\n", "utf8");
		const rLF = readWithHashes(pLF);
		const rCRLF = readWithHashes(pCRLF);
		expect(rCRLF.lines.map((l) => l.hash)).toEqual(
			rLF.lines.map((l) => l.hash),
		);
	});

	test("binary file → {binary:true, lines:[], content: base64 string}", () => {
		const p = join(dir, "bin.dat");
		writeFileSync(p, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));
		const r = readWithHashes(p);
		expect(r.binary).toBe(true);
		expect(r.lines).toEqual([]);
		// content is base64 of original bytes
		expect(Buffer.from(r.content, "base64").toString("hex")).toBe(
			"89504e470001",
		);
	});

	test("lineRange [2,3] on a 5-line file returns those 2 entries with preserved line_numbers", () => {
		const p = join(dir, "five.txt");
		writeFileSync(p, "l1\nl2\nl3\nl4\nl5\n", "utf8");
		const r = readWithHashes(p, { lineRange: [2, 3] });
		expect(r.lines.length).toBe(2);
		expect(r.lines[0]!.line_number).toBe(2);
		expect(r.lines[0]!.content).toBe("l2");
		expect(r.lines[1]!.line_number).toBe(3);
		expect(r.lines[1]!.content).toBe("l3");
	});
});

describe("renderHashedLines (D-07 format: {8hex}{2sp}{content}\\n)", () => {
	test("exact two-space separator, newline per line", () => {
		const lines = [
			{ hash: "aaaaaaaa", content: "foo", line_number: 1 },
			{ hash: "bbbbbbbb", content: "bar", line_number: 2 },
		];
		expect(renderHashedLines(lines)).toBe(
			"aaaaaaaa  foo\nbbbbbbbb  bar\n",
		);
	});

	test("empty lines array → empty string", () => {
		expect(renderHashedLines([])).toBe("");
	});

	test("single-line render", () => {
		expect(
			renderHashedLines([
				{ hash: "12345678", content: "only", line_number: 1 },
			]),
		).toBe("12345678  only\n");
	});
});
