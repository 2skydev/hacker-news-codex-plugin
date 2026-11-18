const dates = new Intl.RelativeTimeFormat("ko", { numeric: "auto" });
export const numbers = new Intl.NumberFormat("ko");
export function since(time: number) {
  const min = Math.max(0, Math.floor((Date.now() / 1000 - time) / 60));
  if (min < 1) return "방금";
  if (min < 60) return dates.format(-min, "minute");
  if (min < 1440) return dates.format(-Math.floor(min / 60), "hour");
  return dates.format(-Math.floor(min / 1440), "day");
}
