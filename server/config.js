export const MAX_MEMBERS = 10;
export const RETENTION_DAYS = 7;
export const LIMITS = { create: 10, write: 60, read: 1200 }; // per visitor, per hour
export const GROUP_WRITES_PER_HOUR = 120; // per group, across all visitors
export const MAX_LIFETIME_DAYS = 30; // hard cap from created_at, however often the group is edited
