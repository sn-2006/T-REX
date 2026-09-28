const indianDateFormatter = new Intl.DateTimeFormat("en-IN", {
  calendar: "gregory",
  numberingSystem: "latn",
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "numeric",
});

export function getIndianFinancialYear(timestamp) {
  if (timestamp == null) return null;

  let date;
  try {
    date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  } catch {
    return null;
  }

  if (!Number.isFinite(date.getTime())) return null;

  const parts = indianDateFormatter.formatToParts(date);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return null;

  const startYear = month >= 4 ? year : year - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}