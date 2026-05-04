#!/bin/bash
# V3 rot-protection fixture per OPERATOR-PROTOCOLS V3.
# Plants 5 contradicting notes vs source-code truth for memory-rot probing.
set -euo pipefail

ROOT=/tmp/v3-rot-test
rm -rf "$ROOT"
mkdir -p "$ROOT/.emmy/notes" "$ROOT/src/api" "$ROOT/src/db" "$ROOT/src/routes" "$ROOT/src"

# === PLANTED NOTES (CONTRADICT TRUTH) ===
cat > "$ROOT/.emmy/notes/api-format.md" <<'EOF'
# API JSON convention

Always use `requestId` in JSON payloads (camelCase).
EOF

cat > "$ROOT/.emmy/notes/auth.md" <<'EOF'
# Auth

Tokens are signed with HS256.
EOF

cat > "$ROOT/.emmy/notes/db-pool.md" <<'EOF'
# Database

Database max connections is 50.
EOF

cat > "$ROOT/.emmy/notes/env-var.md" <<'EOF'
# Debug logging

Set `LOG_LEVEL=verbose` to enable debug.
EOF

cat > "$ROOT/.emmy/notes/route.md" <<'EOF'
# User routes

`POST /api/v1/users` for create.
EOF

# === SOURCE-OF-TRUTH FILES (CONTRADICT THE NOTES) ===
cat > "$ROOT/src/api/handler.ts" <<'EOF'
import express from "express";

const router = express.Router();

router.post("/users", (req, res) => {
    const { request_id, name, email } = req.body;
    if (!request_id) {
        return res.status(400).json({ error: "request_id is required" });
    }
    res.status(201).json({ request_id, name, email });
});

export default router;
EOF

cat > "$ROOT/src/auth.ts" <<'EOF'
import jwt from "jsonwebtoken";
import fs from "fs";

const PRIVATE_KEY = fs.readFileSync("/etc/keys/private.pem", "utf8");
const PUBLIC_KEY = fs.readFileSync("/etc/keys/public.pem", "utf8");

export function signToken(payload: object): string {
    return jwt.sign(payload, PRIVATE_KEY, { algorithm: "RS256" });
}

export function verifyToken(token: string): object | null {
    try {
        return jwt.verify(token, PUBLIC_KEY, { algorithms: ["RS256"] }) as object;
    } catch {
        return null;
    }
}
EOF

cat > "$ROOT/src/db/pool.ts" <<'EOF'
import { Pool } from "pg";

export const dbPool = new Pool({
    host: process.env.DB_HOST ?? "localhost",
    port: 5432,
    database: process.env.DB_NAME ?? "app",
    max: 200,
    idleTimeoutMillis: 30000,
});
EOF

cat > "$ROOT/src/main.ts" <<'EOF'
import express from "express";
import handler from "./api/handler";

const DEBUG = process.env.DEBUG === "1";

if (DEBUG) {
    console.log("[debug] starting server in DEBUG=1 mode");
}

const app = express();
app.use(express.json());
app.use("/", handler);
app.listen(3000);
EOF

cat > "$ROOT/src/routes/users.ts" <<'EOF'
import express from "express";
const r = express.Router();

r.post("/users", (_req, res) => res.status(201).json({ ok: true }));
r.get("/users/:id", (req, res) => res.json({ id: req.params.id }));

export default r;
EOF

cat > "$ROOT/README.md" <<'EOF'
# v3-rot-test fixture

Synthetic fixture for the V3 memory-rot-protection probe in the Phase 04.4
operator protocols. Five planted notes in `.emmy/notes/` contradict the
truth in source files under `src/`. The probe asks five questions that
reference each plant; pass = model checks code (or surfaces contradiction)
rather than blindly trusting the note.
EOF

echo "V3 fixture planted at $ROOT"
ls -la "$ROOT/.emmy/notes/" "$ROOT/src/"
