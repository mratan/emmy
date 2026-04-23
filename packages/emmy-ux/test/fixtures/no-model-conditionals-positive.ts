// packages/emmy-ux/test/fixtures/no-model-conditionals-positive.ts
//
// Deliberate positive for the no-model-conditionals audit (D-19 LOCKED).
// MUST be caught by packages/emmy-ux/test/no-model-conditionals.test.ts self-test.
// Do NOT add to allowlist — if the self-test ever misses this, the regex is broken.
//
// Lives under packages/emmy-ux/test/fixtures/ which IS allowlisted for the
// real-mode audit (path fragment "/test/fixtures/"), so these deliberate
// violations only ever get read by the explicit self-test file-targeted
// assertion.

export function exampleViolation(model: string): string {
    if (model.includes("qwen")) return "A";      // <- MUST trigger audit
    else if (model.includes("gemma")) return "B"; // <- MUST trigger audit
    return "C";
}
