// Statement.bind accepts primitive values. JSON is serialized and size-checked
// by the caller before binding. postgres.js otherwise JSON.stringify's that
// string again after PostgreSQL describes a JSON/JSONB parameter.
export const databaseJsonType = {
  to: 114,
  from: [114, 3802],
  serialize(value) {
    if (typeof value === "string") {
      try { JSON.parse(value); } catch { throw new TypeError("Invalid serialized database JSON"); }
      return value;
    }
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new TypeError("Invalid database JSON");
    return serialized;
  },
  parse: JSON.parse,
};
