import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET;

// Verifies the Bearer token and attaches { id, role, name, externalId } to
// req.user. This is the structure every route below relies on for both
// authentication (is there a valid session?) and authorization (does this
// role own/may access this resource?).
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Missing or malformed Authorization header." });
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired session — please sign in again." });
  }
}

// Restricts a route to one or more roles, e.g. requireRole("auditor").
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "You don't have access to this resource." });
    }
    next();
  };
}
