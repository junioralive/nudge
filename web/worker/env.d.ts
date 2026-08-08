// The guided setup adds the concrete D1 database binding before deployment.
// Keep the Worker type-safe while the neutral public config has no database ID.
interface Env {
  DB: D1Database;
}
